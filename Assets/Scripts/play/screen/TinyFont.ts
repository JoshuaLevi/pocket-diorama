// A 5x7 bitmap font built into the lens, owing nothing to the cartridge.
//
// Every other surface in this project draws with GbFont, whose tiles are
// unpacked OUT OF THE BUNDLE. That is right for the game -- the words the game
// says should be in the cartridge's own hand -- but it makes the one moment
// the wearer most needs words the one moment there is no font: no bundle means
// no glyphs means nothing drawn, which is exactly the black rectangle the
// first-run wizard exists to replace.
//
// So: a table of numbers in this file, and nothing else. Pure, node-importable,
// and dependent only on GbCanvas's public surface (fillRect clips and bumps the
// canvas version for us, so this module never touches GbCanvas's internals the
// way GbFont does).
//
// The shapes are deliberately not the cartridge's. Its font is 8x8 with wide
// bearings and no lowercase; this is 5x7 on a 6px cell, so 26 characters fit
// across a 160px screen instead of 18 -- and a line like
// "WS://192.168.1.142:8781" has to fit on one line or it is not an address the
// wearer can act on. The zero is slashed for the same reason: an address read
// off a headset and dictated to a laptop cannot afford an O-shaped nought.

import type { GbCanvas } from "./GbCanvas";
import { SCREEN_WIDTH } from "./GbCanvas";

/** Glyph box, in pixels. */
export const GLYPH_W: number = 5;
export const GLYPH_H: number = 7;
/** One column of tracking, so letters do not touch. */
export const CELL_W: number = GLYPH_W + 1;
/** The left margin every wizard page uses. */
export const MARGIN_X: number = 2;
/** How many characters fit on a line: 26 * 6 = 156 of the screen's 160. */
export const COLUMNS: number = Math.floor((SCREEN_WIDTH - 2 * MARGIN_X) / CELL_W);

/**
 * The characters this font can draw, in table order.
 *
 * A plain string rather than an object or a Map: Lens Studio's TypeScript
 * subset has no Record<>, no Map<> and no Set<>, and `indexOf` on a string is
 * the lookup that needs none of them.
 */
export const TINY_CHARSET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?-_/\\%'\"()[]<>+=*#@¥♂♀";

/**
 * One entry per character of TINY_CHARSET, in the same order: exactly GLYPH_H
 * numbers, each a GLYPH_W-bit row written MSB-leftmost, row 0 at the top.
 */
export const TINY_GLYPHS: number[][] = [
  [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001], // A
  [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110], // B
  [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110], // C
  [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100], // D
  [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111], // E
  [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000], // F
  [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111], // G
  [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001], // H
  [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110], // I
  [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100], // J
  [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001], // K
  [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111], // L
  [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001], // M
  [0b10001, 0b11001, 0b11001, 0b10101, 0b10011, 0b10011, 0b10001], // N
  [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110], // O
  [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000], // P
  [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101], // Q
  [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001], // R
  [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110], // S
  [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100], // T
  [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110], // U
  [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100], // V
  [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001], // W
  [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001], // X
  [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100], // Y
  [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111], // Z
  [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110], // 0
  [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110], // 1
  [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111], // 2
  [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110], // 3
  [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010], // 4
  [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110], // 5
  [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110], // 6
  [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000], // 7
  [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110], // 8
  [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100], // 9
  [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000], // space
  [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100], // full stop
  [0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100, 0b11000], // comma
  [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000], // colon
  [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b11000], // semicolon
  [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100], // bang
  [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100], // query
  [0b00000, 0b00000, 0b00000, 0b01110, 0b00000, 0b00000, 0b00000], // hyphen
  [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111], // underscore
  [0b00001, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b10000], // slash
  [0b10000, 0b10000, 0b01000, 0b00100, 0b00010, 0b00001, 0b00001], // backslash
  [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011], // per cent
  [0b00100, 0b00100, 0b00100, 0b00000, 0b00000, 0b00000, 0b00000], // apostrophe
  [0b01010, 0b01010, 0b01010, 0b00000, 0b00000, 0b00000, 0b00000], // quote
  [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010], // open paren
  [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000], // close paren
  [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110], // open bracket
  [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110], // close bracket
  [0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010], // less
  [0b01000, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0b01000], // greater
  [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000], // plus
  [0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000], // equals
  [0b00000, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0b00000], // star
  [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010], // hash
  [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110], // at
  [17,10,4,31,4,31,4], // yen
  [7,3,5,8,20,20,8], // male
  [14,17,17,14,4,14,4], // female
];

/** The index of a character in the table, or -1. Lowercase folds to uppercase. */
function indexOf(character: string): number {
  if (!character || character.length === 0) {
    return -1;
  }
  return TINY_CHARSET.indexOf(character.charAt(0).toUpperCase());
}

export function hasGlyph(character: string): boolean {
  return indexOf(character) >= 0;
}

// Optional case-sensitive glyphs for names; setup pages retain their uppercase style.
const LOWER_GLYPHS: number[][] = [
 [0,0,14,1,15,17,15], [16,16,30,17,17,17,30], [0,0,14,16,16,17,14],
 [1,1,15,17,17,17,15], [0,0,14,17,31,16,14], [6,9,8,28,8,8,8],
 [0,0,15,17,15,1,14], [16,16,30,17,17,17,17], [4,0,12,4,4,4,14],
 [2,0,6,2,2,18,12], [16,16,18,20,24,20,18], [12,4,4,4,4,4,14],
 [0,0,26,21,21,21,21], [0,0,30,17,17,17,17], [0,0,14,17,17,17,14],
 [0,0,30,17,30,16,16], [0,0,15,17,15,1,1], [0,0,22,25,16,16,16],
 [0,0,15,16,14,1,30], [8,8,28,8,8,9,6], [0,0,17,17,17,19,13],
 [0,0,17,17,17,10,4], [0,0,17,17,21,21,10], [0,0,17,10,4,10,17],
 [0,0,17,17,15,1,14], [0,0,31,2,4,8,31],
];

/** The rows of a glyph, or an EMPTY array for anything the font has no shape for. */
export function glyphRows(character: string, preserveCase: boolean = false): number[] {
  if (preserveCase && character >= "a" && character <= "z") return LOWER_GLYPHS[character.charCodeAt(0)-97];
  const at = indexOf(character);
  if (at < 0 || at >= TINY_GLYPHS.length) {
    return [];
  }
  return TINY_GLYPHS[at];
}

/** How far a string advances the pen, tracking column included. */
export function textWidth(text: string, scale: number): number {
  const step = scale < 1 ? 1 : Math.floor(scale);
  return (text ? text.length : 0) * CELL_W * step;
}

/**
 * How wide the INK of a string is: the advance minus the trailing tracking
 * column, which is what a centring or fitting calculation actually wants.
 */
export function inkWidth(text: string, scale: number): number {
  const step = scale < 1 ? 1 : Math.floor(scale);
  const advance = textWidth(text, scale);
  return advance > 0 ? advance - step : 0;
}

/**
 * Draws a string as ink of `shade`, one fillRect per lit pixel.
 *
 * fillRect is public API: it clips to the canvas and bumps the canvas version
 * itself, so drawing off the edge is safe and a repaint uploads exactly once.
 * A character the font does not have draws NOTHING but still advances its
 * cell -- deliberate, so a missing glyph makes a URL visibly wrong rather than
 * silently shorter and still plausible.
 */
export function drawText(canvas: GbCanvas, text: string, x: number, y: number,
                         shade: number, scale: number, preserveCase: boolean = false): void {
  if (!canvas || !text) {
    return;
  }
  const step = scale < 1 ? 1 : Math.floor(scale);
  for (let i = 0; i < text.length; i++) {
    const rows = glyphRows(text.charAt(i), preserveCase);
    const cellX = x + i * CELL_W * step;
    for (let row = 0; row < rows.length; row++) {
      const bits = rows[row];
      if (bits === 0) {
        continue;
      }
      for (let column = 0; column < GLYPH_W; column++) {
        if ((bits & (1 << (GLYPH_W - 1 - column))) === 0) {
          continue;
        }
        canvas.fillRect(cellX + column * step, y + row * step, step, step, shade);
      }
    }
  }
}

/** The same, centred on the screen's width. */
export function drawCentred(canvas: GbCanvas, text: string, y: number,
                            shade: number, scale: number, preserveCase: boolean = false): void {
  const width = inkWidth(text, scale);
  const x = Math.round((SCREEN_WIDTH - width) / 2);
  drawText(canvas, text, x < 0 ? 0 : x, y, shade, scale, preserveCase);
}

/**
 * Breaks text onto lines of at most `columns` characters.
 *
 * A word that fits is never split. A word LONGER than a line is hard-split
 * rather than dropped: the things this wraps are URLs and error text, and half
 * an address is a wrong answer while a broken one is still an answer.
 */
export function wrap(text: string, columns: number): string[] {
  const out: string[] = [];
  if (!text || columns < 1) {
    return out;
  }
  const words = text.split(" ");
  let line = "";
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    if (word.length === 0) {
      continue;
    }
    while (word.length > columns) {
      if (line.length > 0) {
        out.push(line);
        line = "";
      }
      out.push(word.substring(0, columns));
      word = word.substring(columns);
    }
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= columns) {
      line = line + " " + word;
    } else {
      out.push(line);
      line = word;
    }
  }
  if (line.length > 0) {
    out.push(line);
  }
  return out;
}
