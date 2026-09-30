/**
 * The acceptance gate for the bridge.
 *
 * Spawns the real CLI the way `npx pokemon-ar-bridge` would, then drives it with a
 * scripted WebSocket client that does exactly what the lens will do: pair, list, pull a
 * ROM in chunks, reassemble it, and check the SHA-1 before it would start baking.
 *
 * The pass condition is a hash, not an impression. If the reassembled megabyte does not
 * hash to the canonical Pokemon Red SHA-1, this exits non-zero.
 *
 *   node test/verify-transfer.ts [--rom <path>]
 *   POKEMON_AR_BRIDGE_TEST_ROM=<path> node test/verify-transfer.ts
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeChunkFrame } from "../src/protocol/binheader.js";
const CANONICAL_RED_SHA1 = "ea9bcae617fdf159b045185467ae58b2e4a48b9a";

const DEFAULT_ROM = (process.env.HOME || "") + "/Downloads/Pokemon - Red Version (USA, Europe).gb";

const HTTP_PORT = 8880;

const WS_PORT = 8881;

const PAIRING_CODE = "135790";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function romPath() {
  const index = process.argv.indexOf("--rom");
  if (index >= 0 && process.argv[index + 1])
    return resolve(process.argv[index + 1]);
  const fromEnv = process.env.POKEMON_AR_BRIDGE_TEST_ROM;
  return fromEnv && fromEnv.length > 0 ? resolve(fromEnv) : DEFAULT_ROM;
}

let failures = 0;

let checks = 0;

function check(label, passed, detail) {
  checks += 1;
  if (!passed)
    failures += 1;
  const mark = passed ? "PASS" : "FAIL";
  process.stdout.write("  [" + mark + "] " + label + (detail.length > 0 ? "  " + detail : "") + "\n");
}

function sha1Hex(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitForBridge() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:" + HTTP_PORT + "/api/state");
      if (response.ok)
        return;
    }
    catch {
      // Not listening yet.
    }
    await sleep(100);
  }
  throw new Error("the bridge never came up on port " + HTTP_PORT);
}

/** Minimal lens-shaped client: JSON in, JSON and binary chunk frames out. */

class ScriptedLens {
  #socket;
  /** @type {{ [key: string]: (message: any) => void }} */
  #pending = {};
  /** @type {((frame: Uint8Array) => void) | null} */
  #onChunk = null;
  /** @type {((message: any) => void) | null} */
  #onJson = null;
  /** @type {{ type: string, resolve: (message: any) => void }[]} */
  #waiters = [];
  constructor(socket) {
    this.#socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        if (this.#onChunk !== null)
          this.#onChunk(new Uint8Array(event.data));
        return;
      }
      const message = JSON.parse(event.data);
      const id = message.id;
      if (typeof id === "string" && this.#pending[id]) {
        const resolve = this.#pending[id];
        delete this.#pending[id];
        resolve(message);
        return;
      }
      if (this.#onJson !== null)
        this.#onJson(message);
      const index = this.#waiters.findIndex((waiter) => waiter.type === message.type);
      if (index >= 0) {
        const waiter = this.#waiters[index];
        this.#waiters.splice(index, 1);
        waiter.resolve(message);
      }
    };
  }
  static connect(url) {
    return new Promise((done, fail) => {
      const socket = new WebSocket(url);
      socket.onopen = () => done(new ScriptedLens(socket));
      socket.onerror = () => fail(new Error("could not connect to " + url));
    });
  }
  onChunk(handler) {
    this.#onChunk = handler;
  }
  /** Every unsolicited JSON message, which is how base64 chunks arrive. */
  onJson(handler) {
    this.#onJson = handler;
  }
  /** Sends a request and resolves with the reply that carries the same id. */
  request(body) {
    const id = randomBytes(4).toString("hex");
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error("timed out waiting for a reply to " + body.type)), 20000);
      this.#pending[id] = (message) => {
        clearTimeout(timer);
        done(message);
      };
      this.#socket.send(JSON.stringify({ ...body, id }));
    });
  }
  send(body) {
    this.#socket.send(JSON.stringify(body));
  }
  sendBinary(frame) {
    this.#socket.send(frame);
  }
  /** Waits for the next unsolicited message of a given type. */
  waitFor(type) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error("timed out waiting for " + type)), 30000);
      this.#waiters.push({
        type,
        resolve: (message) => {
          clearTimeout(timer);
          done(message);
        },
      });
    });
  }
  close() {
    this.#socket.close();
  }
}

/** Pulls one ROM the way the lens will, and returns the reassembled bytes. */

async function pullRom(lens, romId, encoding, extra) {
  const ackEvery = Number(extra.ackEvery ?? 0);
  let assembled = new Uint8Array(0);
  let transferId = -1;
  let received = 0;
  let chunks = 0;
  let lastIndex = -1;
  let ordered = true;
  const accept = (chunkIndex, byteOffset, payload) => {
    if (chunkIndex !== lastIndex + 1)
      ordered = false;
    lastIndex = chunkIndex;
    assembled.set(payload, byteOffset);
    received += payload.length;
    chunks += 1;
    if (ackEvery > 0)
      lens.send({ type: "rom.ack", transferId, chunkIndex });
  };
  // Handlers go on BEFORE the request, the way a real lens client keeps one socket
  // handler for the whole session. Installing them in reaction to rom.begin is a race.
  if (encoding === "binary") {
    lens.onChunk((frame) => {
      const parsed = decodeChunkFrame(frame);
      if (parsed === null)
        throw new Error("a binary frame was not a PAR1 chunk");
      if (parsed.header.transferId !== transferId)
        throw new Error("chunk from a foreign transfer");
      accept(parsed.header.chunkIndex, parsed.header.byteOffset, parsed.payload);
    });
  }
  else {
    lens.onJson((message) => {
      if (message.type !== "rom.chunk" || message.transferId !== transferId)
        return;
      accept(message.chunkIndex, message.byteOffset, new Uint8Array(Buffer.from(message.data, "base64")));
    });
  }
  const endPromise = lens.waitFor("rom.end");
  const begin = await lens.request({ type: "rom.get", romId, encoding, ...extra });
  if (begin.type !== "rom.begin") {
    throw new Error("expected rom.begin, got " + begin.type + " " + (begin.message ?? ""));
  }
  transferId = begin.transferId;
  assembled = new Uint8Array(begin.sizeBytes);
  const end = await endPromise;
  lens.onChunk(null);
  lens.onJson(null);
  if (!ordered)
    throw new Error("chunks arrived out of order");
  if (received !== begin.sizeBytes) {
    throw new Error("received " + String(received) + " of " + String(begin.sizeBytes) + " bytes");
  }
  return { bytes: assembled, begin, end, chunks };
}

async function main() {
  const rom = romPath();
  let romBytes;
  try {
    const buffer = readFileSync(rom);
    romBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  catch (error) {
    process.stderr.write("cannot read the test ROM at " + rom + ": " + String(error) + "\n");
    process.stderr.write("pass --rom <path> or set POKEMON_AR_BRIDGE_TEST_ROM.\n");
    return 2;
  }
  const dataDir = mkdtempSync(join(tmpdir(), "pokemon-ar-bridge-test-"));
  process.stdout.write("bridge data dir: " + dataDir + "\n");
  process.stdout.write("source ROM:      " + rom + " (" + romBytes.length + " bytes)\n\n");
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  try {
    child = spawn(process.execPath, [
      join(packageDir, "bin", "pokemon-ar-bridge.mjs"),
      "--data-dir", dataDir,
      "--port", String(HTTP_PORT),
      "--ws-port", String(WS_PORT),
      "--code", PAIRING_CODE,
      "--add", rom,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const serverLog = [];
    child.stdout?.on("data", (chunk) => serverLog.push(chunk.toString()));
    child.stderr?.on("data", (chunk) => serverLog.push(chunk.toString()));
    await waitForBridge();
    const url = "ws://127.0.0.1:" + WS_PORT;
    const lens = await ScriptedLens.connect(url);
    const hello = await lens.waitFor("hello");
    check("hello announces the protocol version", hello.protocolVersion === 1, "v" + hello.protocolVersion);
    check("hello advertises a 64 KiB frame ceiling", hello.capabilities.maxFrameBytes === 65536, String(hello.capabilities.maxFrameBytes) + " bytes");
    const badPair = await lens.request({ type: "pair", code: "000000", client: { name: "verify" } });
    check("a wrong pairing code is refused", badPair.type === "error" && badPair.code === "E_BAD_CODE", badPair.code ?? "");
    const unpaired = await lens.request({ type: "rom.list" });
    check("an unpaired client cannot list ROMs", unpaired.code === "E_NOT_PAIRED", unpaired.code ?? "");
    const paired = await lens.request({
      type: "pair",
      code: PAIRING_CODE,
      client: { name: "verify-transfer", platform: "node", version: "1.0.0" },
    });
    check("the right pairing code is accepted", paired.type === "paired", paired.type);
    const list = await lens.request({ type: "rom.list" });
    check("the library lists exactly one verified ROM", list.roms.length === 1, String(list.roms.length) + " listed");
    const entry = list.roms[0];
    check("the listed ROM is Pokemon Red", entry.game === "red", entry.label ?? "");
    check("the listing carries the canonical SHA-1", entry.sha1 === CANONICAL_RED_SHA1, entry.sha1);
    process.stdout.write("\n  transferring " + entry.label + " in binary chunks...\n");
    const started = Date.now();
    const binary = await pullRom(lens, entry.romId, "binary", {});
    const elapsed = Date.now() - started;
    check("the transfer was chunked into frames of at most 64 KiB", binary.begin.chunkBytes + hello.capabilities.chunkHeaderBytes <= 65536, String(binary.begin.chunkBytes) + " byte payloads");
    check("every announced chunk arrived", binary.chunks === binary.begin.chunkCount, String(binary.chunks) + " of " + String(binary.begin.chunkCount));
    check("the reassembled size matches", binary.bytes.length === romBytes.length, String(binary.bytes.length) + " bytes");
    const assembledSha1 = sha1Hex(binary.bytes);
    check("the closing rom.end carries a checksum", typeof binary.end.sha1 === "string", binary.end.sha1 ?? "");
    check("rom.end agrees with the reassembled bytes", binary.end.sha1 === assembledSha1, binary.end.sha1);
    check("SHA-1 of the reassembled ROM is canonical Red", assembledSha1 === CANONICAL_RED_SHA1, assembledSha1);
    check("the reassembled bytes equal the source file", Buffer.compare(Buffer.from(binary.bytes), Buffer.from(romBytes)) === 0, "byte for byte");
    process.stdout.write("         " + String(binary.chunks) + " chunks in " + String(elapsed) + " ms (" +
      (romBytes.length / 1024 / (elapsed || 1)).toFixed(1) + " MiB/s)\n\n");
    // A paced transfer: the lens throttles the sender by acking every 4th chunk.
    process.stdout.write("  transferring again with ackEvery=4 (client paced)...\n");
    const paced = await pullRom(lens, entry.romId, "binary", { ackEvery: 4, chunkBytes: 65516 });
    check("a paced transfer completes", sha1Hex(paced.bytes) === CANONICAL_RED_SHA1, sha1Hex(paced.bytes));
    check("a 65516 byte chunk request is honoured", paced.begin.chunkBytes === 65516 && paced.begin.chunkCount === 17, String(paced.begin.chunkCount) + " chunks of " + String(paced.begin.chunkBytes));
    process.stdout.write("  transferring once more as base64 JSON chunks...\n");
    const base64 = await pullRom(lens, entry.romId, "base64", {});
    check("a base64 transfer reassembles to the same ROM", sha1Hex(base64.bytes) === CANONICAL_RED_SHA1, sha1Hex(base64.bytes));
    check("base64 chunks stay inside the frame budget", Math.ceil(base64.begin.chunkBytes / 3) * 4 + 200 <= 65536, String(base64.begin.chunkBytes) + " byte payloads");
    // Save round trip: push one up, list it, pull it back down.
    process.stdout.write("\n  pushing a save up...\n");
    const save = new Uint8Array(32768);
    for (let i = 0; i < save.length; i += 1)
      save[i] = (i * 7 + 13) & 0xff;
    const saveSha1 = sha1Hex(save);
    const ready = await lens.request({
      type: "save.put",
      romId: entry.romId,
      filename: "verify.sav",
      sizeBytes: save.length,
      sha1: saveSha1,
      encoding: "binary",
      chunkBytes: 8192,
    });
    check("the bridge accepts a save upload", ready.type === "save.ready", ready.type);
    const chunkBytes = ready.chunkBytes;
    const chunkCount = Math.ceil(save.length / chunkBytes);
    for (let index = 0; index < chunkCount; index += 1) {
      const offset = index * chunkBytes;
      const slice = save.subarray(offset, Math.min(offset + chunkBytes, save.length));
      const frame = new Uint8Array(20 + slice.length);
      const view = new DataView(frame.buffer);
      frame.set([0x50, 0x41, 0x52, 0x31, 1, 2], 0);
      view.setUint16(6, ready.uploadId, true);
      view.setUint32(8, index, true);
      view.setUint32(12, chunkCount, true);
      view.setUint32(16, offset, true);
      frame.set(slice, 20);
      lens.sendBinary(frame);
    }
    const stored = await lens.request({ type: "save.commit", uploadId: ready.uploadId });
    check("the save commits with a matching SHA-1", stored.type === "save.ok", stored.type + " " + (stored.message ?? ""));
    check("the stored save hashes to what was sent", stored.sha1 === saveSha1, stored.sha1 ?? "");
    const saveList = await lens.request({ type: "save.list" });
    check("the save appears in the listing", saveList.saves.length === 1, String(saveList.saves.length) + " listed");
    const pulled = new Uint8Array(save.length);
    let pulledChunks = 0;
    lens.onChunk((frame) => {
      const parsed = decodeChunkFrame(frame);
      if (parsed === null)
        return;
      pulled.set(parsed.payload, parsed.header.byteOffset);
      pulledChunks += 1;
    });
    const saveEnd = lens.waitFor("save.end");
    const saveBegin = await lens.request({ type: "save.get", saveId: stored.saveId, encoding: "binary" });
    check("save.begin announces the right size", saveBegin.sizeBytes === save.length, String(saveBegin.sizeBytes) + " bytes");
    await saveEnd;
    check("every save chunk arrived", pulledChunks === saveBegin.chunkCount, String(pulledChunks) + " of " + String(saveBegin.chunkCount));
    lens.onChunk(null);
    check("the save comes back down byte for byte", sha1Hex(pulled) === saveSha1, sha1Hex(pulled));
    // An unverified ROM must never reach a lens.
    process.stdout.write("\n  checking the verification gate...\n");
    const junk = new Uint8Array(1048576);
    junk.fill(0x5a);
    const upload = await fetch("http://127.0.0.1:" + HTTP_PORT + "/api/roms", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-filename": "not-a-real-rom.gb" },
      body: junk,
    });
    const uploadBody = await upload.json();
    check("a non-canonical ROM is stored but marked unverified", uploadBody.rom.verified === false, uploadBody.rom.sha1);
    const listAfter = await lens.request({ type: "rom.list" });
    check("an unverified ROM is not listed to the lens", listAfter.roms.length === 1, String(listAfter.roms.length) + " listed");
    const refused = await lens.request({ type: "rom.get", romId: uploadBody.rom.id });
    check("asking for an unverified ROM is refused", refused.type === "error" && refused.code === "E_ROM_UNVERIFIED", refused.code ?? refused.type);
    const state = await (await fetch("http://127.0.0.1:" + HTTP_PORT + "/api/state")).json();
    check("the UI state shows the attached lens", state.clients.length === 1 && state.clients[0].paired === true, state.clients.length + " client(s)");
    check("the UI state lists both ROMs with verdicts", state.roms.length === 2, String(state.roms.length) + " rows");
    lens.close();
    await sleep(200);
    process.stdout.write("\n" + (failures === 0 ? "ALL GREEN" : "FAILURES") + ": " + String(checks - failures) + "/" + String(checks) + " checks passed\n");
    if (failures > 0)
      process.stdout.write("\nbridge log:\n" + serverLog.join(""));
    return failures === 0 ? 0 : 1;
  }
  finally {
    if (child !== null)
      child.kill("SIGTERM");
    await sleep(200);
    rmSync(dataDir, { recursive: true, force: true });
  }
}
process.exitCode = await main();
