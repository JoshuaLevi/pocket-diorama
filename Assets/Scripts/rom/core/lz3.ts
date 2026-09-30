/**
 * Gen 1 sprite decompression ("pkmncompress").
 *
 * A line-by-line port of `decompress_pic` and its helpers in
 * gen1recomp/tools/rom_data.py. This is the fiddliest decoder in the project:
 * the bitstream is read most-significant-bit first, the two bitplanes are
 * stored separately, each plane is delta-filtered with a pair of nibble
 * lookup tables, and the tiles come out transposed. Nothing here is improvised
 * and nothing should be "cleaned up" without re-running the golden compare.
 *
 * Stream layout:
 *   4 bits  width in tiles
 *   4 bits  height in tiles (must equal width)
 *   1 bit   which plane is stored first
 *   plane A
 *   1-2 bits encoding mode (0, 1 or 2+)
 *   plane B
 *
 * Output is row-major 2bpp, ready for decode2bpp() at width*8 by width*8.
 */

export interface DecompressedPic {
  /** Row-major 2bpp tile data, width*width*16 bytes. */
  data: Uint8Array;
  /** Side of the square picture, in tiles. */
  width: number;
}

/** Most-significant-bit-first reader over a compressed pic stream. */
class BitReader {
  private readonly data: Uint8Array;
  private byteIndex: number;
  private bitIndex: number;

  constructor(data: Uint8Array) {
    this.data = data;
    this.byteIndex = 0;
    this.bitIndex = 7;
  }

  read(count: number = 1): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      if (this.byteIndex >= this.data.length) {
        throw new Error("compressed picture ended unexpectedly");
      }
      value = (value << 1) | ((this.data[this.byteIndex] >> this.bitIndex) & 1);
      this.bitIndex -= 1;
      if (this.bitIndex < 0) {
        this.byteIndex += 1;
        this.bitIndex = 7;
      }
    }
    return value;
  }
}

/**
 * Read one bitplane: alternating runs of literal 2-bit groups and runs of
 * zeroes, then repack four groups per output byte in the ROM's column order.
 */
function fillPicPlane(reader: BitReader, width: number): Uint8Array {
  let mode = reader.read();
  const groupCount = width * width * 0x20;
  const groups = new Uint8Array(groupCount);
  let filled = 0;

  while (filled < groupCount) {
    if (mode !== 0) {
      // Literal run: 2-bit groups until a zero group ends it.
      while (filled < groupCount) {
        const group = reader.read(2);
        if (group === 0) {
          break;
        }
        groups[filled] = group;
        filled += 1;
      }
    } else {
      // Zero run: a unary prefix picks the width of the following count.
      let prefix = 0;
      while (reader.read() !== 0) {
        prefix += 1;
        if (prefix >= 16) {
          throw new Error("invalid compressed picture zero run");
        }
      }
      let zeroCount = (1 << (prefix + 1)) - 1;
      zeroCount += reader.read(prefix + 1);
      const remaining = groupCount - filled;
      // groups is zero-initialised, so a zero run only advances the cursor.
      filled += zeroCount < remaining ? zeroCount : remaining;
    }
    mode ^= 1;
  }

  const packed = new Uint8Array(width * width * 8);
  const stride = width * 8;
  let index = 0;
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < stride; x += 1) {
      // Four vertically-adjacent groups become one byte, most significant
      // pair first.
      packed[index] =
        (groups[(y * 4) * stride + x] << 6) |
        (groups[(y * 4 + 1) * stride + x] << 4) |
        (groups[(y * 4 + 2) * stride + x] << 2) |
        groups[(y * 4 + 3) * stride + x];
      index += 1;
    }
  }
  return packed;
}

/**
 * Nibble delta tables. Which table applies flips with the low bit of the
 * previous decoded nibble, which is what makes the filter run-length aware.
 */
const UNFILTER_CODES: number[][] = [
  [0x0, 0x1, 0x3, 0x2, 0x7, 0x6, 0x4, 0x5, 0xf, 0xe, 0xc, 0xd, 0x8, 0x9, 0xb, 0xa],
  [0xf, 0xe, 0xc, 0xd, 0x8, 0x9, 0xb, 0xa, 0x0, 0x1, 0x3, 0x2, 0x7, 0x6, 0x4, 0x5],
];

/** Undo the per-column delta filter. Mutates `plane` in place, as the reference does. */
function unfilterPicPlane(plane: Uint8Array, width: number): void {
  const stride = width * 8;
  for (let x = 0; x < stride; x += 1) {
    let bit = 0;
    for (let y = 0; y < width; y += 1) {
      const index = y * stride + x;
      const high = UNFILTER_CODES[bit][plane[index] >> 4];
      bit = high & 1;
      const low = UNFILTER_CODES[bit][plane[index] & 0x0f];
      bit = low & 1;
      plane[index] = (high << 4) | low;
    }
  }
}

/** Swap tiles from the ROM's column-major order into row-major. In place. */
function transposePicTiles(data: Uint8Array, width: number): void {
  const tileCount = width * width;
  const swap = new Uint8Array(16);
  for (let index = 0; index < tileCount; index += 1) {
    const other = (index * width + Math.floor(index / width)) % tileCount;
    if (index < other) {
      const left = index * 16;
      const right = other * 16;
      swap.set(data.subarray(left, left + 16));
      data.copyWithin(left, right, right + 16);
      data.set(swap, right);
    }
  }
}

/**
 * Decode a compressed picture into row-major 2bpp.
 *
 * `data` should start at the pic's first byte and may run to the end of the
 * bank; the decoder stops when it has read enough bits.
 */
export function decompressPic(data: Uint8Array): DecompressedPic {
  const reader = new BitReader(data);
  const width = reader.read(4);
  const height = reader.read(4);
  if (width === 0 || width !== height) {
    throw new Error(
      `compressed picture is not a non-empty square (${width}x${height})`,
    );
  }

  const order = reader.read();
  const planes: Uint8Array[] = [new Uint8Array(0), new Uint8Array(0)];
  planes[order] = fillPicPlane(reader, width);

  let mode = reader.read();
  if (mode !== 0) {
    mode += reader.read();
  }
  planes[order ^ 1] = fillPicPlane(reader, width);

  unfilterPicPlane(planes[order], width);
  if (mode !== 1) {
    unfilterPicPlane(planes[order ^ 1], width);
  }
  if (mode !== 0) {
    const primary = planes[order];
    const secondary = planes[order ^ 1];
    for (let index = 0; index < width * width * 8; index += 1) {
      secondary[index] ^= primary[index];
    }
  }

  const output = new Uint8Array(width * width * 16);
  for (let index = 0; index < width * width * 8; index += 1) {
    output[index * 2] = planes[0][index];
    output[index * 2 + 1] = planes[1][index];
  }
  transposePicTiles(output, width);
  return { data: output, width: width };
}
