import { createServer } from "node:http";
import { MAX_ROM_UPLOAD_BYTES, MAX_SAVE_UPLOAD_BYTES } from "../config.js";
import { readStaticFile } from "./static.js";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { ...JSON_HEADERS, "content-length": Buffer.byteLength(text) });
  response.end(text);
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(text + "\n");
}

/**
 * Reads a request body with a hard ceiling, aborting the connection rather than
 * buffering an unbounded upload from something that is not the local browser.
 */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("body exceeds " + String(limit) + " bytes"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const joined = Buffer.concat(chunks, total);
      resolve(new Uint8Array(joined.buffer, joined.byteOffset, joined.byteLength));
    });
    request.on("error", reject);
  });
}

/**
 * A cross-site page cannot make the browser send a matching Origin, and a non-browser
 * client (curl, the verification script) sends none at all. Checking it is enough to
 * stop a random web page from quietly deleting the user's library over localhost.
 */
function originAllowed(request, port) {
  const origin = request.headers.origin;
  if (origin === undefined)
    return true;
  const allowed = [
    "http://127.0.0.1:" + String(port),
    "http://localhost:" + String(port),
    "http://[::1]:" + String(port),
  ];
  return allowed.indexOf(String(origin)) >= 0;
}

function headerString(request, name) {
  const value = request.headers[name];
  if (typeof value === "string")
    return value;
  if (Array.isArray(value) && value.length > 0)
    return value[0];
  return "";
}

/** The browser UI and the small JSON API behind it. */

export function startHttpServer(options) {
  const { hub, port } = options;
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      sendJson(response, 500, { error: String(error) });
    });
  });
  async function handle(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && !originAllowed(request, port)) {
      sendJson(response, 403, { error: "cross origin requests are not accepted" });
      return;
    }
    if (method === "GET" && path === "/api/state") {
      sendJson(response, 200, hub.state());
      return;
    }
    if (method === "GET" && path === "/api/events") {
      streamEvents(request, response);
      return;
    }
    if (method === "POST" && path === "/api/roms") {
      await addRom(request, response);
      return;
    }
    if (method === "DELETE" && path.startsWith("/api/roms/")) {
      const id = decodeURIComponent(path.slice("/api/roms/".length));
      const removed = hub.library.remove(id);
      if (!removed) {
        sendJson(response, 404, { error: "no rom with that id" });
        return;
      }
      hub.activity("removed a rom from the library");
      hub.notifyLibraryChanged();
      sendJson(response, 200, { ok: true });
      return;
    }
    if (method === "POST" && path === "/api/saves") {
      await addSave(request, response);
      return;
    }
    if (method === "GET" && path.startsWith("/api/saves/") && path.endsWith("/file")) {
      const id = decodeURIComponent(path.slice("/api/saves/".length, path.length - "/file".length));
      downloadSave(response, id);
      return;
    }
    if (method === "DELETE" && path.startsWith("/api/saves/")) {
      const id = decodeURIComponent(path.slice("/api/saves/".length));
      const removed = hub.saves.remove(id);
      if (!removed) {
        sendJson(response, 404, { error: "no save with that id" });
        return;
      }
      hub.activity("deleted a save");
      hub.changed();
      sendJson(response, 200, { ok: true });
      return;
    }
    if (method === "POST" && path === "/api/pairing/rotate") {
      const code = hub.pairing.rotate();
      hub.activity("pairing code rotated");
      hub.changed();
      sendJson(response, 200, { pairingCode: code });
      return;
    }
    const asset = method === "GET" || method === "HEAD" ? readStaticFile(path) : null;
    if (asset !== null) {
      response.writeHead(200, {
        "content-type": asset.contentType,
        "content-length": asset.body.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (method === "HEAD")
        response.end();
      else
        response.end(asset.body);
      return;
    }
    sendText(response, 404, "not found");
  }
  function streamEvents(request, response) {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    response.write("retry: 2000\n\n");
    response.write("data: " + JSON.stringify(hub.state()) + "\n\n");
    const unsubscribe = hub.subscribe((state) => {
      response.write("data: " + JSON.stringify(state) + "\n\n");
    });
    const keepAlive = setInterval(() => response.write(": ping\n\n"), 25000);
    if (typeof keepAlive.unref === "function")
      keepAlive.unref();
    const stop = () => {
      clearInterval(keepAlive);
      unsubscribe();
    };
    request.on("close", stop);
    request.on("error", stop);
  }
  async function addRom(request, response) {
    let bytes;
    try {
      bytes = await readBody(request, MAX_ROM_UPLOAD_BYTES);
    }
    catch (error) {
      sendJson(response, 413, { error: String(error) });
      return;
    }
    const filename = headerString(request, "x-filename") || "rom.gb";
    try {
      const result = hub.library.add(decodeURIComponent(filename), bytes);
      const record = result.record;
      if (result.created) {
        hub.activity(record.verified
          ? "added " + (record.label ?? record.filename) + " to the library"
          : "rejected " + record.filename + ": sha1 " + record.sha1 + " is not a known cartridge");
        hub.notifyLibraryChanged();
      }
      sendJson(response, result.created ? 201 : 200, { created: result.created, rom: record });
    }
    catch (error) {
      sendJson(response, 400, { error: String(error) });
    }
  }
  async function addSave(request, response) {
    let bytes;
    try {
      bytes = await readBody(request, MAX_SAVE_UPLOAD_BYTES);
    }
    catch (error) {
      sendJson(response, 413, { error: String(error) });
      return;
    }
    const filename = headerString(request, "x-filename") || "upload.sav";
    const romId = headerString(request, "x-rom-id");
    try {
      const record = hub.saves.add({
        bytes,
        romId: romId.length > 0 ? romId : null,
        filename: decodeURIComponent(filename),
        source: "upload",
      });
      hub.activity("stored uploaded save " + record.filename);
      hub.changed();
      sendJson(response, 201, { save: record });
    }
    catch (error) {
      sendJson(response, 400, { error: String(error) });
    }
  }
  function downloadSave(response, id) {
    const record = hub.saves.get(id);
    if (record === null) {
      sendJson(response, 404, { error: "no save with that id" });
      return;
    }
    let bytes;
    try {
      bytes = hub.saves.readBytes(id);
    }
    catch (error) {
      sendJson(response, 500, { error: String(error) });
      return;
    }
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": bytes.length,
      "content-disposition": 'attachment; filename="' + record.filename.replace(/"/g, "") + '"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(Buffer.from(bytes));
  }
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
        server.close(() => done());
        server.closeAllConnections();
      });
      resolve({ server, close: closeAll });
    });
  });
}
