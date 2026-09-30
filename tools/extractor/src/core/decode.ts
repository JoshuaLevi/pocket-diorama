/**
 * Game Boy graphics decoding: 2bpp and 1bpp tiles to RGBA8, plus the two
 * small numeric helpers the reference keeps next to them.
 *
 * Ports `_decode_2bpp`, `_decode_1bpp`, `_columns_to_rows` from
 * gen1recomp/tools/build_rom_data.py and `bcd` from rom_data.py. The reference
 * builds a PIL image; we return raw RGBA bytes, because the Lens turns those
 * straight into a texture and Node can hand them to a PNG encoder later.
 *
 * 2bpp layout: 16 bytes per 8x8 tile, two bytes per row, low bitplane byte
 * first then high. Bit 7 is the leftmost pixel. shade = high * 2 + low, so
 * shade 0 is lightest and 3 is darkest. Tiles run left to right, top to
 * bottom, `width / 8` tiles per row.
 */

/** Decoded image: RGBA8, row-major, 4 bytes per pixel, no stride padding. */
export interface DecodedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * The four DMG shades as RGBA, matching GB_SHADES in build_rom_data.py.
 * Kept as a flat array of [r, g, b, a] rows so it stays plain data.
 */
export const GB_SHADES: number[][] = [
  [255, 255, 255, 255],
  [170, 170, 170, 255],
  [85, 85, 85, 255],
  [0, 0, 0, 255],
];

/** Fully transparent white, used for shade 0 when transparency is requested. */
const TRANSPARENT: number[] = [255, 255, 255, 0];

function writePixel(
  pixels: Uint8Array,
  index: number,
  color: number[],
): void {
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
  pixels[index + 3] = color[3];
}

/**
 * Decode a run of 2bpp tiles into an RGBA image.
 *
 * `transparentColor0` maps shade 0 to transparent instead of white, which is
 * how sprites and UI overlays are stored.
 */
export function decode2bpp(
  raw: Uint8Array,
  width: number,
  height: number,
  transparentColor0: boolean = false,
): DecodedImage {
  if (width % 8 !== 0 || height % 8 !== 0) {
    throw new Error(
      `2bpp dimensions must be tile-aligned: ${width}x${height}`,
    );
  }
  const tilesPerRow = width / 8;
  const tileCount = tilesPerRow * (height / 8);
  if (raw.length !== tileCount * 16) {
    throw new Error(
      `2bpp payload is ${raw.length} bytes, expected ${tileCount * 16}`,
    );
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let tile = 0; tile < tileCount; tile += 1) {
    const tileX = (tile % tilesPerRow) * 8;
    const tileY = Math.floor(tile / tilesPerRow) * 8;
    for (let y = 0; y < 8; y += 1) {
      const low = raw[tile * 16 + y * 2];
      const high = raw[tile * 16 + y * 2 + 1];
      const rowBase = ((tileY + y) * width + tileX) * 4;
      for (let x = 0; x < 8; x += 1) {
        const bit = 7 - x;
        const shade = ((high >> bit) & 1) * 2 + ((low >> bit) & 1);
        const color =
          transparentColor0 && shade === 0 ? TRANSPARENT : GB_SHADES[shade];
        writePixel(pixels, rowBase + x * 4, color);
      }
    }
  }
  return { width: width, height: height, pixels: pixels };
}

/**
 * Decode a run of 1bpp tiles (8 bytes per tile) into an RGBA image.
 *
 * 1bpp is only ever used for two-tone art: a set bit is black, a clear bit is
 * white, or transparent when `transparentColor0` is set.
 */
export function decode1bpp(
  raw: Uint8Array,
  width: number,
  height: number,
  transparentColor0: boolean = false,
): DecodedImage {
  if (width % 8 !== 0 || height % 8 !== 0) {
    throw new Error(
      `1bpp dimensions must be tile-aligned: ${width}x${height}`,
    );
  }
  const tilesPerRow = width / 8;
  const tileCount = tilesPerRow * (height / 8);
  if (raw.length !== tileCount * 8) {
    throw new Error(
      `1bpp payload is ${raw.length} bytes, expected ${tileCount * 8}`,
    );
  }

  const black = GB_SHADES[3];
  const white = GB_SHADES[0];
  const pixels = new Uint8Array(width * height * 4);
  for (let tile = 0; tile < tileCount; tile += 1) {
    const tileX = (tile % tilesPerRow) * 8;
    const tileY = Math.floor(tile / tilesPerRow) * 8;
    for (let y = 0; y < 8; y += 1) {
      const row = raw[tile * 8 + y];
      const rowBase = ((tileY + y) * width + tileX) * 4;
      for (let x = 0; x < 8; x += 1) {
        const filled = (row & (1 << (7 - x))) !== 0;
        const color = filled
          ? black
          : transparentColor0
            ? TRANSPARENT
            : white;
        writePixel(pixels, rowBase + x * 4, color);
      }
    }
  }
  return { width: width, height: height, pixels: pixels };
}

/**
 * Re-order column-major tile data into row-major.
 *
 * Several ROM tables store a sheet as consecutive columns; the decoders above
 * all assume rows. Returns a new buffer and never touches the input.
 */
export function columnsToRows(
  raw: Uint8Array,
  tilesWide: number,
  tilesHigh: number,
  bytesPerTile: number = 16,
): Uint8Array {
  const out = new Uint8Array(raw.length);
  for (let y = 0; y < tilesHigh; y += 1) {
    for (let x = 0; x < tilesWide; x += 1) {
      const source = (x * tilesHigh + y) * bytesPerTile;
      const target = (y * tilesWide + x) * bytesPerTile;
      out.set(raw.subarray(source, source + bytesPerTile), target);
    }
  }
  return out;
}

/**
 * Read a packed binary-coded-decimal run as a number.
 *
 * Prices and money are stored as BCD: each byte holds two decimal digits, most
 * significant first. Port of `bcd` in rom_data.py.
 */
export function bcd(raw: ArrayLike<number>): number {
  let value = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const byte = raw[i];
    value = value * 100 + (byte >> 4) * 10 + (byte & 0x0f);
  }
  return value;
}
