const KNOWN_TYPES = [
  "pair",
  "ping",
  "rom.list",
  "rom.get",
  "rom.ack",
  "rom.cancel",
  "save.list",
  "save.put",
  "save.chunk",
  "save.commit",
  "save.abort",
  "save.get",
];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value, max) {
  if (typeof value !== "string")
    return undefined;
  return value.slice(0, max);
}

function requiredString(value, max) {
  if (typeof value !== "string" || value.length === 0)
    return null;
  return value.slice(0, max);
}

function optionalInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return undefined;
  return Math.trunc(value);
}

function requiredInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return null;
  return Math.trunc(value);
}

function optionalEncoding(value) {
  if (value === "binary" || value === "base64")
    return value;
  return undefined;
}

/**
 * Parses and validates one inbound text frame.
 *
 * Nothing downstream trusts the wire: every field a session handler reads has been
 * range checked here, so the state machine can be written as if the client were honest.
 *
 * @param {string} raw
 * @returns {import("../types.js").ParseResult}
 */
export function parseClientMessage(raw) {
  if (raw.length > 512 * 1024) {
    return { ok: false, code: "E_TOO_LARGE", reason: "text frame is too large" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  }
  catch {
    return { ok: false, code: "E_BAD_MESSAGE", reason: "not valid JSON" };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, code: "E_BAD_MESSAGE", reason: "message must be a JSON object" };
  }
  const type = parsed.type;
  if (typeof type !== "string" || KNOWN_TYPES.indexOf(type) < 0) {
    return { ok: false, code: "E_UNSUPPORTED", reason: "unknown message type" };
  }
  const id = optionalString(parsed.id, 64);
  if (type === "pair") {
    const client = isPlainObject(parsed.client) ? parsed.client : {};
    return {
      ok: true,
      message: {
        type: "pair",
        id,
        code: optionalString(parsed.code, 32),
        client: {
          name: optionalString(client.name, 64),
          version: optionalString(client.version, 32),
          platform: optionalString(client.platform, 64),
        },
      },
    };
  }
  if (type === "ping")
    return { ok: true, message: { type: "ping", id } };
  if (type === "rom.list")
    return { ok: true, message: { type: "rom.list", id } };
  if (type === "rom.get") {
    const romId = requiredString(parsed.romId, 64);
    if (romId === null) {
      return { ok: false, code: "E_BAD_MESSAGE", reason: "rom.get needs a romId", id };
    }
    return {
      ok: true,
      message: {
        type: "rom.get",
        id,
        romId,
        chunkBytes: optionalInt(parsed.chunkBytes),
        encoding: optionalEncoding(parsed.encoding),
        ackEvery: optionalInt(parsed.ackEvery),
      },
    };
  }
  if (type === "rom.ack") {
    const transferId = requiredInt(parsed.transferId);
    const chunkIndex = requiredInt(parsed.chunkIndex);
    if (transferId === null || chunkIndex === null) {
      return { ok: false, code: "E_BAD_MESSAGE", reason: "rom.ack needs transferId and chunkIndex", id };
    }
    return { ok: true, message: { type: "rom.ack", transferId, chunkIndex } };
  }
  if (type === "rom.cancel") {
    const transferId = requiredInt(parsed.transferId);
    if (transferId === null) {
      return { ok: false, code: "E_BAD_MESSAGE", reason: "rom.cancel needs a transferId", id };
    }
    return { ok: true, message: { type: "rom.cancel", transferId } };
  }
  if (type === "save.list") {
    return {
      ok: true,
      message: { type: "save.list", id, romId: optionalString(parsed.romId, 64) },
    };
  }
  if (type === "save.put") {
    const sizeBytes = requiredInt(parsed.sizeBytes);
    const sha1 = requiredString(parsed.sha1, 40);
    if (sizeBytes === null || sizeBytes <= 0 || sha1 === null) {
      return { ok: false, code: "E_BAD_MESSAGE", reason: "save.put needs sizeBytes and sha1", id };
    }
    return {
      ok: true,
      message: {
        type: "save.put",
        id,
        romId: optionalString(parsed.romId, 64),
        sizeBytes,
        sha1: sha1.toLowerCase(),
        chunkBytes: optionalInt(parsed.chunkBytes),
        encoding: optionalEncoding(parsed.encoding),
        filename: optionalString(parsed.filename, 120),
        note: optionalString(parsed.note, 200),
      },
    };
  }
  if (type === "save.chunk") {
    const uploadId = requiredInt(parsed.uploadId);
    const chunkIndex = requiredInt(parsed.chunkIndex);
    const byteOffset = requiredInt(parsed.byteOffset);
    const data = requiredString(parsed.data, 200000);
    if (uploadId === null || chunkIndex === null || byteOffset === null || data === null) {
      return { ok: false, code: "E_BAD_MESSAGE", reason: "save.chunk is missing fields", id };
    }
    return { ok: true, message: { type: "save.chunk", uploadId, chunkIndex, byteOffset, data } };
  }
  if (type === "save.commit") {
    const uploadId = requiredInt(parsed.uploadId);
    if (uploadId === null) {
      return { ok: false, code: "E_BAD_MESSAGE", reason: "save.commit needs an uploadId", id };
    }
    return { ok: true, message: { type: "save.commit", id, uploadId } };
  }
  if (type === "save.abort") {
    const uploadId = requiredInt(parsed.uploadId);
    if (uploadId === null) {
      return { ok: false, code: "E_BAD_MESSAGE", reason: "save.abort needs an uploadId", id };
    }
    return { ok: true, message: { type: "save.abort", uploadId } };
  }
  const saveId = requiredString(parsed.saveId, 64);
  if (saveId === null) {
    return { ok: false, code: "E_BAD_MESSAGE", reason: "save.get needs a saveId", id };
  }
  return {
    ok: true,
    message: {
      type: "save.get",
      id,
      saveId,
      chunkBytes: optionalInt(parsed.chunkBytes),
      encoding: optionalEncoding(parsed.encoding),
      ackEvery: optionalInt(parsed.ackEvery),
    },
  };
}
