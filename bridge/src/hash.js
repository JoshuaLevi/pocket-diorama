import { createHash } from "node:crypto";
/** Lowercase hex SHA-1 of a byte range. */

export function sha1Hex(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

/**
 * CRC-32 (IEEE, the zlib/PNG polynomial) as an unsigned 32-bit integer.
 *
 * The lens verifies SHA-1 anyway, because the SHA-1 is what selects the symbol table.
 * CRC-32 is offered next to it as a cheap early-out: a client can reject a mangled
 * transfer in a millisecond instead of hashing a megabyte first.
 */
export function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** CRC-32 as 8 lowercase hex characters, zero padded. */

export function crc32Hex(bytes) {
  return crc32(bytes).toString(16).padStart(8, "0");
}

/** Constant-time-ish string compare, used for the pairing code. */

export function safeEqual(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
