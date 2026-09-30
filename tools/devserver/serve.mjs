#!/usr/bin/env node
// Minimal bridge stand-in: serves a baked world bundle to the lens over a WebSocket.
//
// This exists so the lens side can be developed and tested without waiting on the
// full pairing bridge, and it speaks the same protocol, so the real bridge is a
// drop-in replacement. Dependency-free: the WebSocket handshake and framing are
// short enough to write out, and adding a dependency to a dev tool that has to run
// on someone else's machine is a cost with no payoff here.
//
//   node tools/devserver/serve.mjs <bundle.json> [port]
//
// RESTART IT AFTER EVERY BAKE. The bundle is read ONCE, here at startup, and
// held in memory for the life of the process. On 7 September this server had
// been up since 16:38 while the bundle gained its sound banks at 17:27, so the
// glasses were handed a stale world all evening and the silence was read as an
// audio bug for hours. The log line below prints the char count and sha1 of
// what is actually being served: compare it with the file if anything looks
// older than it should.

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
// 16 KiB, not 48. On 7 September a 1.70 MB bundle went out in 35 chunks of 48
// KiB and the glasses reported "bad frame from bridge" twice and then
// "incomplete transfer: 33/35" -- exactly the two frames that failed to parse.
// A frame that large has to survive the socket, the headset's own reassembly
// and a JSON.parse at the far end in one piece, and at 48 KiB it sometimes does
// not. Smaller frames cost a few more round trips and nothing else: the whole
// transfer is still under a second on a LAN.
const CHUNK_CHARS = 16 * 1024;

const bundlePath = process.argv[2];
const port = Number(process.argv[3] || 8781);
if (!bundlePath) {
  console.error("usage: serve.mjs <bundle.json> [port]");
  process.exit(2);
}

const bundleText = readFileSync(bundlePath, "utf8");
const bundleSha1 = createHash("sha1").update(bundleText).digest("hex");
const chunks = [];
for (let i = 0; i < bundleText.length; i += CHUNK_CHARS) {
  chunks.push(bundleText.slice(i, i + CHUNK_CHARS));
}

function lanAddresses() {
  const out = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

/** Encodes one text frame. Payloads here exceed 125 bytes but stay under 64 KiB. */
function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Pulls complete client frames out of a rolling buffer. Client frames are masked. */
function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    let mask = null;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (cursor + length > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    cursor += length;
    offset = cursor;
    if (opcode === 0x8) {
      messages.push({ close: true });
    } else if (opcode === 0x1) {
      messages.push({ text: payload.toString("utf8") });
    }
  }
  return { messages, rest: buffer.subarray(offset) };
}

/**
 * The first complete JSON object in a frame, and nothing after it.
 *
 * Lens Studio's WebSocket client overstates its payload length: a `send()` of
 * the 32-byte hello arrives as a frame declaring 55 bytes -- the JSON, then
 * whatever was in the buffer behind it. Measured on 5.15.3 against the raw
 * bytes: `81 b7` (text, masked, length 55) with 23 bytes of tail after the
 * closing brace, different every time.
 *
 * The frame still has to be CONSUMED at its declared length or the stream
 * desynchronises, so the fix is here rather than in the framing: read the
 * object, ignore the tail. Braces inside strings do not count, which is why
 * this walks the text instead of looking for the last `}`.
 */
function firstJsonObject(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  return text;
}

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("pokemon-ar dev bridge\nbundle sha1 " + bundleSha1 + "\n");
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );
  console.log("lens connected from", socket.remoteAddress);

  const send = (object) => socket.write(encodeTextFrame(JSON.stringify(object)));

  /**
   * Sends, and WAITS if the kernel says it has had enough.
   *
   * 10 September, the glasses, the third time this bundle has failed to
   * arrive: 103 chunks -- 1.7 MB -- went out in 471 milliseconds, which is
   * 3.6 MB/s at a headset, and two frames near the end of that burst reached
   * the lens truncated:
   *
   *   17:44:25.188  bad frame from bridge: 10964 chars starting stWarp":1},{"x":11,"
   *   17:44:25.422  bad frame from bridge: 9016 chars starting ,"CeruleanGym":{"2":
   *
   * Both start MID-JSON, which is a receiver whose framing has come apart
   * rather than a sender writing nonsense -- and once it has come apart
   * everything after it is lost too, including bundleEnd. That is why the
   * wearer sat on "Receiving world 92%" with no error and nothing to press.
   *
   * The previous two answers to this were "make the chunks smaller": 48 KiB
   * failed on 7 September, 16 KiB failed today. A third halving would be the
   * same guess a third time. The size was never the problem -- socket.write
   * returning false and being ignored was, 103 times in a row.
   */
  const sendSlowly = (object) => new Promise((resolve) => {
    if (socket.write(encodeTextFrame(JSON.stringify(object)))) {
      resolve();
      return;
    }
    socket.once("drain", resolve);
  });

  let buffered = Buffer.alloc(0);

  socket.on("data", (data) => {
    buffered = Buffer.concat([buffered, data]);
    const { messages, rest } = decodeFrames(buffered);
    buffered = rest;
    for (const message of messages) {
      if (message.close) {
        socket.end();
        continue;
      }
      let parsed;
      const json = firstJsonObject(message.text);
      try {
        parsed = JSON.parse(json);
      } catch {
        // Say WHAT could not be parsed. "bad json" on its own sent us reading
        // both sides of a protocol that turned out to be fine.
        console.log("bad json from lens (" + message.text.length + " chars): " +
                    JSON.stringify(message.text.slice(0, 200)));
        send({ type: "error", message: "bad json" });
        continue;
      }
      if (parsed.type === "hello") {
        send({ type: "catalog", bundles: [{ id: "kanto", bytes: bundleText.length, sha1: bundleSha1 }] });
      } else if (parsed.type === "getBundle") {
        console.log("sending bundle:", bundleText.length, "chars in", chunks.length, "chunks");
        // Fire and forget the promise: the socket handler cannot be async
        // without changing how every other message is dispatched, and nothing
        // here needs to wait for the transfer to finish.
        (async () => {
          await sendSlowly({ type: "bundleStart", id: parsed.id, bytes: bundleText.length,
                             chunks: chunks.length, sha1: bundleSha1 });
          for (let i = 0; i < chunks.length; i++) {
            await sendSlowly({ type: "chunk", index: i, data: chunks[i] });
          }
          await sendSlowly({ type: "bundleEnd", id: parsed.id, sha1: bundleSha1 });
          console.log("bundle sent");
        })().catch((e) => console.log("bundle send failed:", e && e.message ? e.message : e));
      } else {
        send({ type: "error", message: "unknown type " + parsed.type });
      }
    }
  });

  socket.on("error", () => socket.destroy());
});

server.listen(port, "0.0.0.0", () => {
  console.log("pokemon-ar dev bridge on port " + port);
  console.log("  bundle " + bundlePath);
  console.log("  " + bundleText.length.toLocaleString() + " chars, sha1 " + bundleSha1);
  console.log("  chunks " + chunks.length);
  console.log("  preview: ws://127.0.0.1:" + port);
  for (const address of lanAddresses()) {
    console.log("  device:  ws://" + address + ":" + port);
  }
});
