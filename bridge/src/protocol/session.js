import { CHUNK_BYTES_DEFAULT, CHUNK_BYTES_MAX_BASE64, CHUNK_BYTES_MAX_BINARY, MAX_FRAME_BYTES, MAX_PAIRING_ATTEMPTS, MAX_SAVE_UPLOAD_BYTES, PAIRING_GRACE_MS, PROTOCOL_VERSION } from "../config.js";
import { CHUNK_HEADER_BYTES, CHUNK_KIND_ROM, CHUNK_KIND_SAVE, decodeChunkFrame } from "./binheader.js";
import { ChunkDownload } from "./download.js";
import { parseClientMessage } from "./inbound.js";
import { clampChunkBytes, romSummary, saveSummary } from "./summaries.js";
import { SaveUpload } from "./upload.js";
/**
 * Every reply to a request echoes that request's id. A client that correlates replies by
 * id (any client with a promise based request helper) hangs forever on an error that
 * forgets to, so this is read off the raw message rather than each handler remembering.
 */
function messageId(message) {
  const carrier = message;
  return typeof carrier.id === "string" ? carrier.id : undefined;
}

const BRIDGE_NAME = "pokemon-ar-bridge";

const BRIDGE_VERSION = "1.0.0";

/**
 * One lens, from handshake to goodbye.
 *
 * At most one download and one save upload run per connection. That is a deliberate
 * limit rather than a shortcut: a lens asking for two ROMs at once gets E_BUSY with a
 * reason, which is far easier to debug from inside a headset than an interleaved pair
 * of transfers sharing a progress bar.
 */
export class LensSession {
  #connection;
  #context;
  #paired;
  #pairAttempts = 0;
  #clientName = "unknown";
  #clientPlatform = "unknown";
  /** @type {ChunkDownload | null} */
  #download = null;
  /** @type {SaveUpload | null} */
  #upload = null;
  #nextTransferId = 1;
  /** @type {NodeJS.Timeout | null} */
  #pairingTimer = null;
  #closed = false;
  constructor(connection, context) {
    this.#connection = connection;
    this.#context = context;
    this.#paired = !context.pairing.required;
    connection.setHandlers({
      onText: (text) => void this.#onText(text),
      onBinary: (data) => this.#onBinary(data),
      onClose: () => this.#onClose(),
    });
    if (context.pairing.required) {
      this.#pairingTimer = setTimeout(() => {
        if (this.#paired || this.#closed)
          return;
        context.activity("lens at " + connection.remoteAddress + " never paired, dropping it");
        connection.close(1008, "pairing timeout");
      }, PAIRING_GRACE_MS);
      if (typeof this.#pairingTimer.unref === "function")
        this.#pairingTimer.unref();
    }
    void this.#send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      server: { name: BRIDGE_NAME, version: BRIDGE_VERSION },
      sessionId: connection.id,
      pairingRequired: context.pairing.required,
      capabilities: {
        maxFrameBytes: MAX_FRAME_BYTES,
        chunkBytesDefault: CHUNK_BYTES_DEFAULT,
        chunkBytesMaxBinary: CHUNK_BYTES_MAX_BINARY,
        chunkBytesMaxBase64: CHUNK_BYTES_MAX_BASE64,
        encodings: ["binary", "base64"],
        chunkHeaderBytes: CHUNK_HEADER_BYTES,
      },
    });
  }
  get paired() {
    return this.#paired;
  }
  snapshot() {
    /** @type {import("../types.js").TransferSnapshot | null} */
    let transfer = null;
    if (this.#download !== null)
      transfer = this.#download.snapshot();
    else if (this.#upload !== null)
      transfer = this.#upload.snapshot();
    return {
      id: this.#connection.id,
      remoteAddress: this.#connection.remoteAddress,
      connectedAt: this.#connection.connectedAt,
      paired: this.#paired,
      clientName: this.#clientName,
      clientPlatform: this.#clientPlatform,
      transfer,
    };
  }
  /** Pushed when the ROM library changes underneath a connected lens. */
  notifyLibraryChanged() {
    if (!this.#paired || this.#closed)
      return;
    void this.#send({
      type: "event",
      event: "library.changed",
      roms: this.#context.library.listVerified().map(romSummary),
    });
  }
  #send = (message) => {
    if (this.#closed)
      return Promise.resolve();
    return this.#connection.sendText(JSON.stringify(message)).catch(() => undefined);
  };
  #fail(code, message, id) {
    return this.#send({ type: "error", id, code, message });
  }
  #takeTransferId() {
    const id = this.#nextTransferId;
    this.#nextTransferId = id >= 65535 ? 1 : id + 1;
    return id;
  }
  #onClose() {
    this.#closed = true;
    if (this.#pairingTimer !== null)
      clearTimeout(this.#pairingTimer);
    if (this.#download !== null)
      this.#download.cancel("connection closed");
    this.#upload = null;
    this.#context.changed();
  }
  async #onText(text) {
    const parsed = parseClientMessage(text);
    if (!parsed.ok) {
      await this.#fail(parsed.code, parsed.reason, parsed.id);
      return;
    }
    const message = parsed.message;
    if (message.type === "pair") {
      await this.#handlePair(message);
      return;
    }
    if (message.type === "ping") {
      await this.#send({ type: "pong", id: message.id, serverTime: Date.now() });
      return;
    }
    if (!this.#paired) {
      await this.#fail("E_NOT_PAIRED", "send a pair message with the code shown on the bridge first", messageId(message));
      return;
    }
    await this.#route(message);
  }
  async #handlePair(message) {
    const info = message.client ?? {};
    this.#clientName = info.name ?? "unknown";
    this.#clientPlatform = info.platform ?? "unknown";
    if (this.#paired) {
      await this.#send({ type: "paired", id: message.id, pairedAt: new Date().toISOString() });
      this.#context.changed();
      return;
    }
    if (!this.#context.pairing.matches(message.code)) {
      this.#pairAttempts += 1;
      const remaining = MAX_PAIRING_ATTEMPTS - this.#pairAttempts;
      this.#context.activity("wrong pairing code from " + this.#connection.remoteAddress + ", " + String(Math.max(0, remaining)) + " tries left");
      if (remaining <= 0) {
        await this.#fail("E_RATE_LIMIT", "too many wrong pairing codes", message.id);
        this.#connection.close(1008, "too many wrong pairing codes");
        return;
      }
      await this.#fail("E_BAD_CODE", "that is not the pairing code shown on the bridge", message.id);
      return;
    }
    this.#paired = true;
    if (this.#pairingTimer !== null)
      clearTimeout(this.#pairingTimer);
    this.#context.activity("lens paired: " + this.#clientName + " at " + this.#connection.remoteAddress);
    this.#context.changed();
    await this.#send({ type: "paired", id: message.id, pairedAt: new Date().toISOString() });
  }
  async #route(message) {
    switch (message.type) {
      case "rom.list":
        await this.#send({
          type: "rom.list.ok",
          id: message.id,
          roms: this.#context.library.listVerified().map(romSummary),
        });
        return;
      case "rom.get":
        await this.#sendRom(message);
        return;
      case "rom.ack":
        if (this.#download !== null && this.#download.transferId === message.transferId) {
          this.#download.ack(message.chunkIndex);
        }
        return;
      case "rom.cancel":
        if (this.#download === null || this.#download.transferId !== message.transferId) {
          await this.#fail("E_UNKNOWN_TRANSFER", "no transfer with id " + String(message.transferId));
          return;
        }
        this.#download.cancel("cancelled by the lens");
        return;
      case "save.list":
        await this.#send({
          type: "save.list.ok",
          id: message.id,
          saves: this.#context.saves.list(message.romId ?? null).map(saveSummary),
        });
        return;
      case "save.get":
        await this.#sendSave(message);
        return;
      case "save.put":
        await this.#beginUpload(message);
        return;
      case "save.chunk":
        this.#acceptChunk(message.uploadId, message.byteOffset, Buffer.from(message.data, "base64"));
        return;
      case "save.commit":
        await this.#commitUpload(message.uploadId, message.id);
        return;
      case "save.abort":
        if (this.#upload !== null && this.#upload.uploadId === message.uploadId) {
          this.#upload = null;
          this.#context.activity("lens aborted a save upload");
          this.#context.changed();
        }
        return;
      default:
        await this.#fail("E_UNSUPPORTED", "unhandled message type", messageId(message));
    }
  }
  async #sendRom(message) {
    if (this.#download !== null) {
      await this.#fail("E_BUSY", "a transfer is already running on this connection", message.id);
      return;
    }
    const record = this.#context.library.get(message.romId);
    if (record === null) {
      await this.#fail("E_UNKNOWN_ROM", "no rom with id " + message.romId, message.id);
      return;
    }
    if (!record.verified) {
      await this.#fail("E_ROM_UNVERIFIED", "that file does not match a known Gen 1 cartridge hash, so the bridge will not send it", message.id);
      return;
    }
    let bytes;
    try {
      bytes = this.#context.library.readBytes(record.id);
    }
    catch (error) {
      await this.#fail("E_INTERNAL", "could not read the rom: " + String(error), message.id);
      return;
    }
    const encoding = message.encoding ?? "binary";
    const chunkBytes = clampChunkBytes(message.chunkBytes, encoding);
    const transferId = this.#takeTransferId();
    const name = record.label ?? record.filename;
    const download = new ChunkDownload({ connection: this.#connection, send: this.#send, changed: this.#context.changed }, {
      transferId,
      kind: "rom",
      chunkKind: CHUNK_KIND_ROM,
      name,
      bytes,
      chunkBytes,
      encoding,
      ackEvery: Math.max(0, message.ackEvery ?? 0),
    });
    this.#download = download;
    this.#context.activity("sending " + name + " to " + this.#clientName + ": " + String(download.chunkCount) + " chunks of " +
      String(chunkBytes) + " bytes, " + encoding);
    const result = await download.run({
      type: "rom.begin",
      id: message.id,
      transferId,
      romId: record.id,
      game: record.game,
      sha1: record.sha1,
      crc32: record.crc32,
      sizeBytes: bytes.length,
      chunkBytes,
      chunkCount: download.chunkCount,
      encoding,
      ackEvery: Math.max(0, message.ackEvery ?? 0),
    }, (elapsedMs) => ({
      type: "rom.end",
      transferId,
      romId: record.id,
      sha1: record.sha1,
      crc32: record.crc32,
      sizeBytes: bytes.length,
      chunkCount: download.chunkCount,
      elapsedMs,
    }));
    this.#download = null;
    this.#context.activity(result.completed
      ? "sent " + name + " in " + String(download.elapsedMs) + " ms, sha1 " + record.sha1
      : "transfer of " + name + " stopped: " + result.reason);
    this.#context.changed();
  }
  async #sendSave(message) {
    if (this.#download !== null) {
      await this.#fail("E_BUSY", "a transfer is already running on this connection", message.id);
      return;
    }
    const record = this.#context.saves.get(message.saveId);
    if (record === null) {
      await this.#fail("E_UNKNOWN_SAVE", "no save with id " + message.saveId, message.id);
      return;
    }
    let bytes;
    try {
      bytes = this.#context.saves.readBytes(record.id);
    }
    catch (error) {
      await this.#fail("E_INTERNAL", "could not read the save: " + String(error), message.id);
      return;
    }
    const encoding = message.encoding ?? "binary";
    const chunkBytes = clampChunkBytes(message.chunkBytes, encoding);
    const transferId = this.#takeTransferId();
    const download = new ChunkDownload({ connection: this.#connection, send: this.#send, changed: this.#context.changed }, {
      transferId,
      kind: "save",
      chunkKind: CHUNK_KIND_SAVE,
      name: record.filename,
      bytes,
      chunkBytes,
      encoding,
      ackEvery: Math.max(0, message.ackEvery ?? 0),
    });
    this.#download = download;
    const result = await download.run({
      type: "save.begin",
      id: message.id,
      transferId,
      saveId: record.id,
      sha1: record.sha1,
      crc32: record.crc32,
      sizeBytes: bytes.length,
      chunkBytes,
      chunkCount: download.chunkCount,
      encoding,
      ackEvery: Math.max(0, message.ackEvery ?? 0),
    }, (elapsedMs) => ({
      type: "save.end",
      transferId,
      saveId: record.id,
      sha1: record.sha1,
      crc32: record.crc32,
      sizeBytes: bytes.length,
      chunkCount: download.chunkCount,
      elapsedMs,
    }));
    this.#download = null;
    this.#context.activity(result.completed
      ? "sent save " + record.filename + " to " + this.#clientName
      : "save transfer stopped: " + result.reason);
    this.#context.changed();
  }
  async #beginUpload(message) {
    if (this.#upload !== null) {
      await this.#fail("E_BUSY", "a save upload is already in progress", message.id);
      return;
    }
    if (message.sizeBytes > MAX_SAVE_UPLOAD_BYTES) {
      await this.#fail("E_TOO_LARGE", "a save larger than " + String(MAX_SAVE_UPLOAD_BYTES) + " bytes is refused", message.id);
      return;
    }
    const encoding = message.encoding ?? "binary";
    const chunkBytes = clampChunkBytes(message.chunkBytes, encoding);
    const uploadId = this.#takeTransferId();
    this.#upload = new SaveUpload({
      uploadId,
      romId: message.romId ?? null,
      filename: message.filename ?? "lens-" + String(uploadId) + ".sav",
      note: message.note ?? "",
      encoding,
      chunkBytes,
      sizeBytes: message.sizeBytes,
      sha1: message.sha1,
    });
    this.#context.activity("lens is pushing a save: " + this.#upload.filename + ", " + String(message.sizeBytes) + " bytes");
    this.#context.changed();
    await this.#send({ type: "save.ready", id: message.id, uploadId, chunkBytes, encoding });
  }
  #acceptChunk(uploadId, byteOffset, payload) {
    const upload = this.#upload;
    if (upload === null || upload.uploadId !== uploadId)
      return;
    if (upload.accept(byteOffset, payload))
      this.#context.changed();
  }
  async #commitUpload(uploadId, id) {
    const upload = this.#upload;
    if (upload === null || upload.uploadId !== uploadId) {
      await this.#fail("E_UNKNOWN_TRANSFER", "no save upload with id " + String(uploadId), id);
      return;
    }
    const result = upload.commit();
    if (!result.ok) {
      this.#upload = null;
      this.#context.activity("save upload refused: " + result.message);
      this.#context.changed();
      await this.#fail(result.code, result.message, id);
      return;
    }
    try {
      const record = this.#context.saves.add({
        bytes: result.bytes,
        romId: upload.romId,
        filename: upload.filename,
        source: "lens",
        note: upload.note,
      });
      this.#upload = null;
      this.#context.activity("stored save " + record.filename + " (" + String(record.sizeBytes) + " bytes)");
      this.#context.changed();
      await this.#send({
        type: "save.ok",
        id,
        saveId: record.id,
        sha1: record.sha1,
        sizeBytes: record.sizeBytes,
        storedAt: record.createdAt,
      });
    }
    catch (error) {
      this.#upload = null;
      this.#context.changed();
      await this.#fail("E_INTERNAL", "could not store the save: " + String(error), id);
    }
  }
  #onBinary(data) {
    if (!this.#paired)
      return;
    const parsed = decodeChunkFrame(data);
    if (parsed === null) {
      void this.#fail("E_BAD_MESSAGE", "binary frames must start with a 20 byte PAR1 chunk header");
      return;
    }
    if (parsed.header.kind !== CHUNK_KIND_SAVE) {
      void this.#fail("E_UNSUPPORTED", "the bridge only accepts save chunks from a lens");
      return;
    }
    this.#acceptChunk(parsed.header.transferId, parsed.header.byteOffset, parsed.payload);
  }
}
