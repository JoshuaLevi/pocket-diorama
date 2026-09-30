import { CHUNK_BYTES_DEFAULT, CHUNK_BYTES_MAX_BASE64, CHUNK_BYTES_MAX_BINARY, CHUNK_BYTES_MIN } from "../config.js";
/**
 * The lens view of a library row. Deliberately not the storage record: the on-disk path
 * and the verified flag are bridge business, and a summary only ever describes a ROM
 * that already passed verification.
 */
export function romSummary(record) {
  return {
    romId: record.id,
    game: record.game,
    label: record.label,
    filename: record.filename,
    sizeBytes: record.sizeBytes,
    sha1: record.sha1,
    crc32: record.crc32,
    cartridgeTitle: record.cartridgeTitle,
    addedAt: record.addedAt,
  };
}

export function saveSummary(record) {
  return {
    saveId: record.id,
    romId: record.romId,
    filename: record.filename,
    sizeBytes: record.sizeBytes,
    sha1: record.sha1,
    crc32: record.crc32,
    createdAt: record.createdAt,
    source: record.source,
  };
}

/**
 * A client may ask for a chunk size; the bridge decides. The ceiling exists so a frame
 * never exceeds 64 KiB, which lets a lens client size one receive buffer and stop
 * thinking about it. Base64 has a lower ceiling because it inflates by four thirds.
 */
export function clampChunkBytes(requested, encoding) {
  const max = encoding === "binary" ? CHUNK_BYTES_MAX_BINARY : CHUNK_BYTES_MAX_BASE64;
  const value = requested === undefined || requested <= 0 ? CHUNK_BYTES_DEFAULT : requested;
  return Math.min(max, Math.max(CHUNK_BYTES_MIN, Math.trunc(value)));
}
