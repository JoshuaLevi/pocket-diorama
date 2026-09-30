/**
 * Shared helpers for the six graphics-and-text datasets.
 *
 * These port the small utilities that build_rom_data.py keeps next to
 * extract_sprites / extract_font / extract_palettes / extract_icons /
 * extract_text / extract_field, plus the handful of PIL operations those
 * functions lean on (new / paste / crop / flip / flood-fill matte).
 *
 * Ownership note. The core registry discovers a dataset at
 * `src/datasets/<name>.ts`, so the six builders live in sibling files named
 * after their golden output (sprites.ts, font.ts, palettes.ts, icons.ts,
 * text.ts, field.ts) and this module holds only what they share. Nothing here
 * is imported by another agent's dataset.
 *
 * Runtime rules. No node:fs, no Buffer, no Record/Map/Set: this file has to
 * run unchanged inside the Lens Studio sandbox. Inputs are never mutated --
 * every helper that changes pixels returns a new image.
 *
 * ---------------------------------------------------------------------------
 * The asset dump format
 * ---------------------------------------------------------------------------
 * Decoded pixels are NOT part of the JSON contract (the golden JSON carries
 * only asset path strings). When the CLI is given --assets, the images below
 * are handed to ctx.emitAsset under the golden PNG's relative path with the
 * extension swapped to `.rgba`, e.g. `sprites/red.png` -> `sprites/red.rgba`.
 *
 * A `.rgba` file is self-describing so a compare script never has to guess:
 *
 *   offset 0   8 bytes   ASCII "PXRGBA01"
 *   offset 8   2 bytes   width, little-endian uint16
 *   offset 10  2 bytes   height, little-endian uint16
 *   offset 12  w*h*4     RGBA8 rows, top to bottom, no stride padding
 *
 * The payload is byte-for-byte what the reference PNG holds once decoded, so
 * `PIL.Image.open(golden).convert("RGBA").tobytes()` compares directly.
 */

import { columnsToRows, decode1bpp, decode2bpp } from "../core/decode";
import type { DecodedImage } from "../core/decode";
import type { ExtractContext } from "../registry";

/** Opaque white: shade 0 of the DMG ramp. */
export const WHITE_OPAQUE: number[] = [255, 255, 255, 255];

/** Fully transparent white, the colour PIL's `Image.new` blank uses here. */
export const WHITE_CLEAR: number[] = [255, 255, 255, 0];

/** Fully transparent black, PIL's default `(0, 0, 0, 0)` fill. */
export const BLACK_CLEAR: number[] = [0, 0, 0, 0];

/** Opaque black: shade 3 of the DMG ramp. */
export const BLACK_OPAQUE: number[] = [0, 0, 0, 255];

/* ------------------------------------------------------------------------ */
/* Plain-data helpers                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Own-property test that survives a key called `constructor` or `toString`.
 *
 * Symbol and text labels come straight out of the manifest, so a plain
 * `obj[key]` lookup could otherwise return something off Object.prototype.
 */
export function hasOwn(source: unknown, key: string): boolean {
  if (source === null || typeof source !== "object") {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * Structural copy of anything JSON-shaped.
 *
 * The reference uses `copy.deepcopy(manifest[...])` before adding keys; we do
 * the same so a builder can never hand the caller a live reference into the
 * manifest, or edit it by accident.
 */
export function deepCloneJson<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const list: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      list.push(deepCloneJson(value[i]));
    }
    return list as unknown as T;
  }
  const source = value as { [key: string]: unknown };
  const copy: { [key: string]: unknown } = {};
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i += 1) {
    copy[keys[i]] = deepCloneJson(source[keys[i]]);
  }
  return copy as unknown as T;
}

/**
 * Widen a 5-bit GBC colour channel to 8 bits.
 *
 * Port of `_scale5`. `round(value * 255 / 31)` never lands on a .5 for
 * 0 <= value <= 31, so Python's round-half-to-even and Math.round agree on
 * every one of the 32 inputs.
 */
export function scale5(value: number): number {
  return Math.round((value * 255) / 31);
}

/**
 * Split packed bytes into high/low nibbles and keep the first `count`.
 * Port of `_nybbles`.
 */
export function nybbles(raw: ArrayLike<number>, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < raw.length && out.length < count; i += 1) {
    const value = raw[i];
    out.push(value >> 4);
    if (out.length < count) {
      out.push(value & 0x0f);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Image operations (the PIL calls the reference makes)                      */
/* ------------------------------------------------------------------------ */

/** `Image.new("RGBA", (width, height), fill)`. */
export function newImage(
  width: number,
  height: number,
  fill: number[],
): DecodedImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = fill[0];
    pixels[i + 1] = fill[1];
    pixels[i + 2] = fill[2];
    pixels[i + 3] = fill[3];
  }
  return { width: width, height: height, pixels: pixels };
}

/** Read one pixel as [r, g, b, a]. */
export function getPixel(image: DecodedImage, x: number, y: number): number[] {
  const base = (y * image.width + x) * 4;
  return [
    image.pixels[base],
    image.pixels[base + 1],
    image.pixels[base + 2],
    image.pixels[base + 3],
  ];
}

/** Write one pixel in place. Only ever called on an image we just created. */
export function setPixel(
  image: DecodedImage,
  x: number,
  y: number,
  color: number[],
): void {
  const base = (y * image.width + x) * 4;
  image.pixels[base] = color[0];
  image.pixels[base + 1] = color[1];
  image.pixels[base + 2] = color[2];
  image.pixels[base + 3] = color[3];
}

/** True when a pixel is exactly this colour. */
export function pixelEquals(
  image: DecodedImage,
  x: number,
  y: number,
  color: number[],
): boolean {
  const base = (y * image.width + x) * 4;
  return (
    image.pixels[base] === color[0] &&
    image.pixels[base + 1] === color[1] &&
    image.pixels[base + 2] === color[2] &&
    image.pixels[base + 3] === color[3]
  );
}

/**
 * `dst.paste(src, (x, y))` -- a straight copy, alpha included.
 *
 * Every paste on the Red code path is unmasked, so this deliberately does not
 * implement PIL's mask form. Returns a new image; `dst` is untouched.
 */
export function pasteImage(
  dst: DecodedImage,
  src: DecodedImage,
  x: number,
  y: number,
): DecodedImage {
  const out: DecodedImage = {
    width: dst.width,
    height: dst.height,
    pixels: dst.pixels.slice(),
  };
  for (let row = 0; row < src.height; row += 1) {
    const targetY = y + row;
    if (targetY < 0 || targetY >= dst.height) {
      continue;
    }
    for (let column = 0; column < src.width; column += 1) {
      const targetX = x + column;
      if (targetX < 0 || targetX >= dst.width) {
        continue;
      }
      const from = (row * src.width + column) * 4;
      const to = (targetY * dst.width + targetX) * 4;
      out.pixels[to] = src.pixels[from];
      out.pixels[to + 1] = src.pixels[from + 1];
      out.pixels[to + 2] = src.pixels[from + 2];
      out.pixels[to + 3] = src.pixels[from + 3];
    }
  }
  return out;
}

/** `src.crop((x, y, x + width, y + height))`. */
export function cropImage(
  src: DecodedImage,
  x: number,
  y: number,
  width: number,
  height: number,
): DecodedImage {
  const out = newImage(width, height, BLACK_CLEAR);
  for (let row = 0; row < height; row += 1) {
    const sourceY = y + row;
    if (sourceY < 0 || sourceY >= src.height) {
      continue;
    }
    for (let column = 0; column < width; column += 1) {
      const sourceX = x + column;
      if (sourceX < 0 || sourceX >= src.width) {
        continue;
      }
      const from = (sourceY * src.width + sourceX) * 4;
      const to = (row * width + column) * 4;
      out.pixels[to] = src.pixels[from];
      out.pixels[to + 1] = src.pixels[from + 1];
      out.pixels[to + 2] = src.pixels[from + 2];
      out.pixels[to + 3] = src.pixels[from + 3];
    }
  }
  return out;
}

/** `src.transpose(Image.Transpose.FLIP_LEFT_RIGHT)`. */
export function flipHorizontal(src: DecodedImage): DecodedImage {
  const out = newImage(src.width, src.height, BLACK_CLEAR);
  for (let row = 0; row < src.height; row += 1) {
    for (let column = 0; column < src.width; column += 1) {
      const from = (row * src.width + column) * 4;
      const to = (row * src.width + (src.width - 1 - column)) * 4;
      out.pixels[to] = src.pixels[from];
      out.pixels[to + 1] = src.pixels[from + 1];
      out.pixels[to + 2] = src.pixels[from + 2];
      out.pixels[to + 3] = src.pixels[from + 3];
    }
  }
  return out;
}

/**
 * Flood-fill the opaque-white background in from every edge and clear it.
 *
 * Port of `_matte_color0`. Only pixels that are exactly opaque white and
 * reachable from the border become transparent, so white *inside* a sprite --
 * an eye, a speech bubble -- survives. Returns a new image.
 */
export function matteColor0(src: DecodedImage): DecodedImage {
  const out: DecodedImage = {
    width: src.width,
    height: src.height,
    pixels: src.pixels.slice(),
  };
  const seen = new Uint8Array(src.width * src.height);
  const queueX: number[] = [];
  const queueY: number[] = [];

  function add(x: number, y: number): void {
    if (x < 0 || x >= out.width || y < 0 || y >= out.height) {
      return;
    }
    const index = y * out.width + x;
    if (seen[index] === 1) {
      return;
    }
    if (!pixelEquals(out, x, y, WHITE_OPAQUE)) {
      return;
    }
    seen[index] = 1;
    queueX.push(x);
    queueY.push(y);
  }

  for (let x = 0; x < out.width; x += 1) {
    add(x, 0);
    add(x, out.height - 1);
  }
  for (let y = 0; y < out.height; y += 1) {
    add(0, y);
    add(out.width - 1, y);
  }

  let head = 0;
  while (head < queueX.length) {
    const x = queueX[head];
    const y = queueY[head];
    head += 1;
    setPixel(out, x, y, WHITE_CLEAR);
    add(x - 1, y);
    add(x + 1, y);
    add(x, y - 1);
    add(x, y + 1);
  }
  return out;
}

/** Zero-pad a short ROM read up to the length a decoder demands. */
export function padTo(raw: Uint8Array, length: number): Uint8Array {
  if (raw.length >= length) {
    return raw;
  }
  const out = new Uint8Array(length);
  out.set(raw, 0);
  return out;
}

/* ------------------------------------------------------------------------ */
/* ROM -> image                                                              */
/* ------------------------------------------------------------------------ */

/** Options mirroring the keyword arguments of extract_field's `raw_2bpp`. */
export interface Raw2bppOptions {
  transparent?: boolean;
  matte?: boolean;
  columns?: boolean;
  /** Bytes actually stored in ROM, when that is less than width*height/4. */
  storedLength?: number;
}

/** Port of extract_field's inner `raw_2bpp`, minus the PNG write. */
export function read2bpp(
  ctx: ExtractContext,
  label: string,
  width: number,
  height: number,
  options?: Raw2bppOptions,
): DecodedImage {
  const settings: Raw2bppOptions = options === undefined ? {} : options;
  const expected = (width * height) / 4;
  const length =
    settings.storedLength === undefined ? expected : settings.storedLength;
  const symbol = ctx.symbols.get(label);
  let raw = padTo(ctx.rom.bytes(symbol.bank, symbol.address, length), expected);
  if (settings.columns === true) {
    raw = columnsToRows(raw, width / 8, height / 8);
  }
  const image = decode2bpp(raw, width, height, settings.transparent === true);
  return settings.matte === true ? matteColor0(image) : image;
}

/** Port of extract_field's inner `raw_1bpp`, minus the PNG write. */
export function read1bpp(
  ctx: ExtractContext,
  label: string,
  width: number,
  height: number,
  transparent: boolean = false,
): DecodedImage {
  const symbol = ctx.symbols.get(label);
  const raw = ctx.rom.bytes(
    symbol.bank,
    symbol.address,
    (width * height) / 8,
  );
  return decode1bpp(raw, width, height, transparent);
}

/** Split a 2bpp sheet at `label` into `count` individual 8x8 tiles. */
export function readTiles(
  ctx: ExtractContext,
  label: string,
  count: number,
  transparent: boolean = false,
): DecodedImage[] {
  const symbol = ctx.symbols.get(label);
  const raw = ctx.rom.bytes(symbol.bank, symbol.address, count * 16);
  const tiles: DecodedImage[] = [];
  for (let index = 0; index < count; index += 1) {
    tiles.push(
      decode2bpp(raw.subarray(index * 16, index * 16 + 16), 8, 8, transparent),
    );
  }
  return tiles;
}

/* ------------------------------------------------------------------------ */
/* Asset emission                                                            */
/* ------------------------------------------------------------------------ */

const RGBA_MAGIC: number[] = [0x50, 0x58, 0x52, 0x47, 0x42, 0x41, 0x30, 0x31];

/** Wrap decoded pixels in the self-describing `.rgba` container. */
export function encodeRgba(image: DecodedImage): Uint8Array {
  const out = new Uint8Array(12 + image.pixels.length);
  for (let i = 0; i < RGBA_MAGIC.length; i += 1) {
    out[i] = RGBA_MAGIC[i];
  }
  out[8] = image.width & 0xff;
  out[9] = (image.width >> 8) & 0xff;
  out[10] = image.height & 0xff;
  out[11] = (image.height >> 8) & 0xff;
  out.set(image.pixels, 12);
  return out;
}

/**
 * Hand one decoded image to the asset sink.
 *
 * `relative` is the golden PNG path, e.g. `sprites/red.png`; the emitted file
 * swaps the extension for `.rgba`. Callers pass the same string that goes into
 * the JSON so the two can never drift apart.
 */
export function emitImage(
  ctx: ExtractContext,
  relative: string,
  image: DecodedImage,
): void {
  const dot = relative.lastIndexOf(".");
  const stem = dot < 0 ? relative : relative.substring(0, dot);
  ctx.emitAsset(stem + ".rgba", encodeRgba(image));
}
