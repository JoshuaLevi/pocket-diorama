/**
 * Dependency-free SHA-1 (FIPS 180-4) over a Uint8Array.
 *
 * The Lens has no crypto module and no Buffer, so this is hand-rolled and runs
 * unchanged in Node and in the Lens Studio sandbox. It streams the input in
 * 64-byte blocks and only allocates the 64/128-byte tail, so hashing the 1 MiB
 * ROM costs one small allocation.
 *
 * Verified against the canonical Pokemon Red ROM:
 *   sha1(rom) === "ea9bcae617fdf159b045185467ae58b2e4a48b9a"
 */

const HEX = "0123456789abcdef";

function rotl(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

function toHex32(value: number): string {
  let out = "";
  for (let shift = 28; shift >= 0; shift -= 4) {
    out += HEX.charAt((value >>> shift) & 0x0f);
  }
  return out;
}

/**
 * Absorb one 64-byte block starting at `offset` into the running state.
 * `state` is [h0..h4] and is mutated in place; `w` is a reusable 80-word
 * schedule so the hot loop allocates nothing.
 */
function processBlock(
  data: Uint8Array,
  offset: number,
  state: Int32Array,
  w: Int32Array,
): void {
  for (let i = 0; i < 16; i += 1) {
    const p = offset + i * 4;
    w[i] =
      ((data[p] << 24) |
        (data[p + 1] << 16) |
        (data[p + 2] << 8) |
        data[p + 3]) |
      0;
  }
  for (let i = 16; i < 80; i += 1) {
    w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
  }

  let a = state[0];
  let b = state[1];
  let c = state[2];
  let d = state[3];
  let e = state[4];

  for (let i = 0; i < 80; i += 1) {
    let f: number;
    let k: number;
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
    const temp = (rotl(a, 5) + f + e + k + w[i]) | 0;
    e = d;
    d = c;
    c = rotl(b, 30);
    b = a;
    a = temp;
  }

  state[0] = (state[0] + a) | 0;
  state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0;
  state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0;
}

/** SHA-1 digest of `data` as 40 lowercase hex characters. */
export function sha1(data: Uint8Array): string {
  const state = new Int32Array([
    0x67452301 | 0,
    0xefcdab89 | 0,
    0x98badcfe | 0,
    0x10325476 | 0,
    0xc3d2e1f0 | 0,
  ]);
  const w = new Int32Array(80);

  const total = data.length;
  const fullBlocks = Math.floor(total / 64);
  for (let block = 0; block < fullBlocks; block += 1) {
    processBlock(data, block * 64, state, w);
  }

  // Tail: remaining bytes + 0x80 + zero padding + 64-bit big-endian bit length.
  const rest = total - fullBlocks * 64;
  const tail = new Uint8Array(rest <= 55 ? 64 : 128);
  tail.set(data.subarray(fullBlocks * 64), 0);
  tail[rest] = 0x80;

  // total * 8 overflows 32 bits past 512 MiB, so split it without shifting.
  const bitLengthHigh = Math.floor(total / 0x20000000);
  const bitLengthLow = (total * 8) % 0x100000000;
  const lengthAt = tail.length - 8;
  tail[lengthAt] = (bitLengthHigh >>> 24) & 0xff;
  tail[lengthAt + 1] = (bitLengthHigh >>> 16) & 0xff;
  tail[lengthAt + 2] = (bitLengthHigh >>> 8) & 0xff;
  tail[lengthAt + 3] = bitLengthHigh & 0xff;
  tail[lengthAt + 4] = Math.floor(bitLengthLow / 0x1000000) & 0xff;
  tail[lengthAt + 5] = Math.floor(bitLengthLow / 0x10000) & 0xff;
  tail[lengthAt + 6] = Math.floor(bitLengthLow / 0x100) & 0xff;
  tail[lengthAt + 7] = bitLengthLow & 0xff;

  for (let offset = 0; offset < tail.length; offset += 64) {
    processBlock(tail, offset, state, w);
  }

  return (
    toHex32(state[0]) +
    toHex32(state[1]) +
    toHex32(state[2]) +
    toHex32(state[3]) +
    toHex32(state[4])
  );
}
