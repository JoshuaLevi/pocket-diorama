// CRC-32 and SHA-1 over raw bytes, dependency-free.
//
// Both are needed before a ROM is decoded, and for different reasons. CRC-32 is
// cheap and catches a truncated or misassembled transfer. SHA-1 is what selects
// the symbol table: decoding an unknown revision with Gen 1 addresses produces
// garbage that looks like data, which is worse than a refusal.

let crcTable: number[] = null;

function crcTableOnce(): number[] {
  if (crcTable === null) {
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table.push(c >>> 0);
    }
    crcTable = table;
  }
  return crcTable;
}

/** Lowercase hex, eight characters, as the bridge reports it. */
export function crc32(bytes: Uint8Array): string {
  const table = crcTableOnce();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  c = (c ^ 0xffffffff) >>> 0;
  let hex = c.toString(16);
  while (hex.length < 8) {
    hex = "0" + hex;
  }
  return hex;
}

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/**
 * SHA-1 of a byte array, as forty lowercase hex characters.
 *
 * A megabyte takes a noticeable fraction of a second in the lens runtime, which is
 * why the caller runs the cheap CRC first and only reaches here on a transfer that
 * already looks intact.
 */
export function sha1Hex(bytes: Uint8Array): string {
  const length = bytes.length;
  // Message, 0x80, zero padding to 56 mod 64, then a 64-bit big-endian bit count.
  const paddedLength = (((length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[length] = 0x80;

  const bitLengthHigh = Math.floor((length * 8) / 0x100000000);
  const bitLengthLow = (length * 8) >>> 0;
  const tail = paddedLength - 8;
  padded[tail] = (bitLengthHigh >>> 24) & 0xff;
  padded[tail + 1] = (bitLengthHigh >>> 16) & 0xff;
  padded[tail + 2] = (bitLengthHigh >>> 8) & 0xff;
  padded[tail + 3] = bitLengthHigh & 0xff;
  padded[tail + 4] = (bitLengthLow >>> 24) & 0xff;
  padded[tail + 5] = (bitLengthLow >>> 16) & 0xff;
  padded[tail + 6] = (bitLengthLow >>> 8) & 0xff;
  padded[tail + 7] = bitLengthLow & 0xff;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w: number[] = [];
  for (let i = 0; i < 80; i++) {
    w.push(0);
  }

  for (let block = 0; block < paddedLength; block += 64) {
    for (let i = 0; i < 16; i++) {
      const o = block + i * 4;
      w[i] = ((padded[o] << 24) | (padded[o + 1] << 16) |
              (padded[o + 2] << 8) | padded[o + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f = 0;
      let k = 0;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  function hex8(value: number): string {
    let out = (value >>> 0).toString(16);
    while (out.length < 8) {
      out = "0" + out;
    }
    return out;
  }
  return hex8(h0) + hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4);
}
