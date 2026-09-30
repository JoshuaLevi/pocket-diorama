import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { PING_INTERVAL_MS, WS_MAX_MESSAGE_BYTES } from "../config.js";
import { CLOSE_GOING_AWAY, CLOSE_PROTOCOL_ERROR, encodeClose, encodeFrame, FrameDecoder, OPCODE_BINARY, OPCODE_CLOSE, OPCODE_PING, OPCODE_PONG, OPCODE_TEXT } from "./frame.js";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key) {
  return createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
}

/**
 * Resolves when the socket has drained, and rejects if it dies first: a plain
 * once("drain") would hang forever on a lens that walked out of wifi range.
 *
 * @param {import("node:stream").Duplex} socket
 * @returns {Promise<void>}
 */
function waitForDrain(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("drain", onDrain);
      socket.off("close", onGone);
      socket.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onGone = () => {
      cleanup();
      reject(new Error("socket closed while draining"));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    socket.once("drain", onDrain);
    socket.once("close", onGone);
    socket.once("error", onError);
  });
}

/**
 * One live lens. Writes are serialized through a promise chain and honour socket
 * backpressure, which is what makes a 1 MiB transfer to a constrained client behave:
 * without it, sixteen 64 KiB frames land in the kernel buffer at once and the progress
 * bar on the glasses jumps from 0 to 100 with a long stall in between.
 */
export class WsConnection {
  id;
  remoteAddress;
  connectedAt;
  #socket;
  #decoder;
  #handlers = {};
  #tail = Promise.resolve();
  #closed = false;
  /** @type {NodeJS.Timeout | null} */
  #pingTimer = null;
  #awaitingPong = false;
  /** @type {((code: number, reason: string) => void)[]} */
  #closeListeners = [];
  constructor(socket, remoteAddress) {
    this.id = randomUUID();
    this.remoteAddress = remoteAddress;
    this.connectedAt = Date.now();
    this.#socket = socket;
    this.#decoder = new FrameDecoder(WS_MAX_MESSAGE_BYTES);
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("error", () => this.#finish(1006, "socket error"));
    socket.on("close", () => this.#finish(1006, "socket closed"));
    this.#pingTimer = setInterval(() => this.#heartbeat(), PING_INTERVAL_MS);
    if (typeof this.#pingTimer.unref === "function")
      this.#pingTimer.unref();
  }
  get closed() {
    return this.#closed;
  }
  setHandlers(handlers) {
    this.#handlers = handlers;
  }
  /**
   * Close hooks that survive a later setHandlers call. The server uses one to keep its
   * connection list honest; the session layer uses setHandlers for everything else.
   */
  addCloseListener(listener) {
    this.#closeListeners = this.#closeListeners.concat([listener]);
  }
  #heartbeat() {
    if (this.#closed)
      return;
    if (this.#awaitingPong) {
      this.close(CLOSE_GOING_AWAY, "no pong");
      return;
    }
    this.#awaitingPong = true;
    void this.#enqueue(encodeFrame(OPCODE_PING, Buffer.alloc(0))).catch(() => undefined);
  }
  #onData(chunk) {
    const events = this.#decoder.push(chunk);
    for (const event of events) {
      if (event.kind === "failure") {
        this.close(event.code, event.reason);
        return;
      }
      if (event.kind === "control") {
        if (event.opcode === OPCODE_PING) {
          void this.#enqueue(encodeFrame(OPCODE_PONG, event.data)).catch(() => undefined);
        }
        else if (event.opcode === OPCODE_PONG) {
          this.#awaitingPong = false;
        }
        else if (event.opcode === OPCODE_CLOSE) {
          const code = event.data.length >= 2 ? event.data.readUInt16BE(0) : 1005;
          const reason = event.data.length > 2 ? event.data.subarray(2).toString("utf8") : "";
          this.close(code === 1005 ? 1000 : code, reason);
        }
        continue;
      }
      if (event.opcode === OPCODE_TEXT) {
        const handler = this.#handlers.onText;
        if (handler)
          handler(event.data.toString("utf8"));
      }
      else if (event.opcode === OPCODE_BINARY) {
        const handler = this.#handlers.onBinary;
        if (handler) {
          handler(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
        }
      }
    }
  }
  #enqueue(frame) {
    const next = this.#tail.then(async () => {
      if (this.#closed)
        throw new Error("connection is closed");
      const flushed = this.#socket.write(frame);
      if (!flushed)
        await waitForDrain(this.#socket);
    });
    this.#tail = next.then(() => undefined, () => undefined);
    return next;
  }
  /** Resolves once the frame has been handed to the kernel, not when it is acked. */
  sendText(text) {
    return this.#enqueue(encodeFrame(OPCODE_TEXT, Buffer.from(text, "utf8")));
  }
  sendBinary(data) {
    return this.#enqueue(encodeFrame(OPCODE_BINARY, data));
  }
  close(code, reason) {
    if (this.#closed) {
      this.#finish(code, reason);
      return;
    }
    const socket = this.#socket;
    this.#tail
      .then(() => {
      if (!socket.destroyed)
        socket.write(encodeClose(code, reason));
    })
      .catch(() => undefined)
      .finally(() => {
      this.#finish(code, reason);
      if (!socket.destroyed)
        socket.end();
      setTimeout(() => {
        if (!socket.destroyed)
          socket.destroy();
      }, 250).unref();
    });
  }
  #finish(code, reason) {
    if (this.#closed)
      return;
    this.#closed = true;
    if (this.#pingTimer !== null) {
      clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
    const handler = this.#handlers.onClose;
    if (handler)
      handler(code, reason);
    for (const listener of this.#closeListeners)
      listener(code, reason);
  }
}

function rejectUpgrade(socket, status, message) {
  const body = message + "\n";
  socket.write("HTTP/1.1 " +
    status +
    "\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: " +
    Buffer.byteLength(body) +
    "\r\n\r\n" +
    body);
  socket.destroy();
}

/** Starts the WebSocket endpoint. Plain HTTP requests to it get a one line hint. */

export function startWsServer(options) {
  const live = [];
  const server = createServer((request, response) => {
    response.writeHead(426, {
      "content-type": "text/plain",
      "x-content-type-options": "nosniff",
    });
    response.end("pokemon-ar-bridge: this port speaks WebSocket only. See PROTOCOL.md.\n");
  });
  server.on("upgrade", (request, socket) => {
    const upgradeHeader = String(request.headers.upgrade ?? "").toLowerCase();
    const key = request.headers["sec-websocket-key"];
    const version = String(request.headers["sec-websocket-version"] ?? "");
    if (upgradeHeader !== "websocket" || typeof key !== "string") {
      rejectUpgrade(socket, "400 Bad Request", "expected a websocket upgrade");
      return;
    }
    if (version !== "13") {
      rejectUpgrade(socket, "426 Upgrade Required", "websocket version 13 required");
      return;
    }
    socket.write("HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " +
      acceptKey(key) +
      "\r\n\r\n");
    const netSocket = /** @type {import("node:net").Socket} */ (socket);
    if (typeof netSocket.setNoDelay === "function")
      netSocket.setNoDelay(true);
    const remote = netSocket.remoteAddress ?? "unknown";
    const connection = new WsConnection(socket, remote);
    live.push(connection);
    connection.addCloseListener(() => {
      const index = live.indexOf(connection);
      if (index >= 0)
        live.splice(index, 1);
    });
    options.onConnection(connection, request);
  });
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      /** @returns {Promise<void>} */
      const closeAll = () => new Promise((done) => {
        for (const connection of live.slice()) {
          connection.close(CLOSE_GOING_AWAY, "bridge shutting down");
        }
        server.close(() => done());
        server.closeAllConnections();
      });
      resolve({ server, connections: () => live.slice(), close: closeAll });
    });
  });
}

export { CLOSE_PROTOCOL_ERROR };
