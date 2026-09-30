/**
 * The 20-byte header on every binary chunk frame.
 *
 * Every binary frame is self describing: a client that drops a frame, reorders two, or
 * reconnects mid transfer can still place each payload correctly, and it never has to
 * correlate a binary frame with a preceding JSON message. That matters on the lens side,
 * where a Blob arrives through an async `bytes()` call and ordering guarantees inside
 * the script are thinner than they look.
 *
 *   offset  size  field
 *   0       4     magic, ASCII "PAR1"
 *   4       1     version, currently 1
 *   5       1     kind, 1 = ROM chunk, 2 = save chunk
 *   6       2     transferId, uint16
 *   8       4     chunkIndex, uint32, zero based
 *   12      4     chunkCount, uint32
 *   16      4     byteOffset, uint32, offset of this payload inside the whole file
 *   20      ..    payload
 *
 * All multi-byte fields are LITTLE endian, matching the Game Boy and the rest of this
 * project. A DataView reader must pass `true` as the littleEndian argument.
 */
export const CHUNK_HEADER_BYTES = 20;

export const CHUNK_MAGIC = 0x50415231; // "PAR1" read big endian, i.e. bytes 50 41 52 31

export const CHUNK_VERSION = 1;

export const CHUNK_KIND_ROM = 1;

export const CHUNK_KIND_SAVE = 2;

/** Builds a frame: header followed by the payload, in one allocation. */

export function encodeChunkFrame(header, payload) {
  const frame = new Uint8Array(CHUNK_HEADER_BYTES + payload.length);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  frame[0] = 0x50;
  frame[1] = 0x41;
  frame[2] = 0x52;
  frame[3] = 0x31;
  frame[4] = header.version & 0xff;
  frame[5] = header.kind & 0xff;
  view.setUint16(6, header.transferId, true);
  view.setUint32(8, header.chunkIndex, true);
  view.setUint32(12, header.chunkCount, true);
  view.setUint32(16, header.byteOffset, true);
  frame.set(payload, CHUNK_HEADER_BYTES);
  return frame;
}

/** Returns null when the frame is not a well formed chunk frame. */

export function decodeChunkFrame(frame) {
  if (frame.length < CHUNK_HEADER_BYTES)
    return null;
  if (frame[0] !== 0x50 || frame[1] !== 0x41 || frame[2] !== 0x52 || frame[3] !== 0x31)
    return null;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const header = {
    version: frame[4],
    kind: frame[5],
    transferId: view.getUint16(6, true),
    chunkIndex: view.getUint32(8, true),
    chunkCount: view.getUint32(12, true),
    byteOffset: view.getUint32(16, true),
  };
  if (header.version !== CHUNK_VERSION)
    return null;
  return {
    header,
    payload: frame.subarray(CHUNK_HEADER_BYTES),
  };
}
