// A minimal PNG reader for the intro oracle's recorded frames.
//
// tools/oracle/state/intro/pngwrite.py (the recorder's own encoder) writes
// 8-bit grayscale, non-interlaced PNGs where the gray level IS the DMG
// shade: 255/153/85/0 = shade 0/1/2/3 (INTRO.md "Pixel format"). This is
// the read side of exactly that format -- node:zlib's inflateSync plus the
// five PNG filter types (None/Sub/Up/Average/Paeth), nothing else. It does
// not handle interlacing, palettes, alpha, or any bit depth but 8: those
// are not what the recorder ever writes, and a reader that silently
// tolerated them would risk silently misreading one that does not match.

import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GRAY_TO_SHADE = { 255: 0, 153: 1, 85: 2, 0: 3 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Reads an 8-bit grayscale, non-interlaced PNG and returns
 * `{ width, height, shades }`, `shades` a Uint8Array of 0-3 (one per pixel,
 * row-major, top row first -- the same orientation the PNG itself stores,
 * NOT GbCanvas.toRgba's bottom-up upload order).
 */
export function readShadePng(path) {
  const data = readFileSync(path);
  if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(path + ": not a PNG");
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (pos + 8 <= data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString("ascii", pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + length);
    pos += 8 + length + 4; // length + type + body + crc
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body.readUInt8(8);
      colorType = body.readUInt8(9);
      const interlace = body.readUInt8(12);
      if (interlace !== 0) {
        throw new Error(path + ": interlaced PNGs are not supported");
      }
    } else if (type === "IDAT") {
      idatChunks.push(body);
    } else if (type === "IEND") {
      break;
    }
  }
  if (width === 0 || height === 0) {
    throw new Error(path + ": no IHDR");
  }
  if (bitDepth !== 8 || colorType !== 0) {
    throw new Error(path + ": expected 8-bit grayscale, got bitDepth=" +
      bitDepth + " colorType=" + colorType);
  }
  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width; // 1 byte per pixel at 8-bit grayscale
  const gray = new Uint8Array(width * height);
  let prevRow = new Uint8Array(stride);
  let rawPos = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawPos];
    rawPos++;
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rawPos + x];
      const a = x >= 1 ? row[x - 1] : 0;
      const b = prevRow[x];
      const c = x >= 1 ? prevRow[x - 1] : 0;
      let value = rawByte;
      if (filterType === 1) value = (rawByte + a) & 0xff;
      else if (filterType === 2) value = (rawByte + b) & 0xff;
      else if (filterType === 3) value = (rawByte + ((a + b) >> 1)) & 0xff;
      else if (filterType === 4) value = (rawByte + paeth(a, b, c)) & 0xff;
      else if (filterType !== 0) throw new Error(path + ": unknown filter type " + filterType);
      row[x] = value;
    }
    gray.set(row, y * stride);
    prevRow = row;
    rawPos += stride;
  }
  const shades = new Uint8Array(width * height);
  for (let i = 0; i < shades.length; i++) {
    const shade = GRAY_TO_SHADE[gray[i]];
    if (shade === undefined) {
      throw new Error(path + ": pixel " + i + " has gray level " + gray[i] +
        ", not one of the four DMG shades");
    }
    shades[i] = shade;
  }
  return { width, height, shades };
}
