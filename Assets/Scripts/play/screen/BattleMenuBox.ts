// The fight's own menu, in a box, on the same panel as the text.
//
// It used to be a GlyphPanel hanging in the air above the message box, and
// GlyphPanel draws glyphs and NOTHING ELSE -- its own header says so, and says
// why: a frame would have to sit behind 144 glyph quads that all share z with
// depth writing and depth testing off, "worth doing carefully later, not
// casually now". That was fine while the menu sat on the button plate, which
// had a background of its own. The plate became buttons in September and
// nobody moved the menu, so for a month the fight menu has been bare white
// letters over whatever the world happened to be: in the 8 September
// recordings, TACKLE / TAIL WHIP / POKeMON / ITEM / RUN written across a field
// of green grass, unreadable, with the PP counts floating beside it.
//
// The answer is not to give GlyphPanel a frame. It is to stop drawing the menu
// in the air at all: the cartridge draws it in a bordered box at the bottom of
// the screen, and the lens already HAS that screen -- the message panel, which
// is the same canvas, already pinned to the fight, already backed by the UI Kit
// frame, already carrying the text this menu answers. One surface, one upload.
//
// Pure: rows in, drawing calls out, and the top row it used so the caller can
// widen the panel's crop to show it.

import type { GbCanvas, GbFont } from "./GbCanvas";

const TILE: number = 8;

/** The screen, in tiles. */
const SCREEN_COLS: number = 20;
const SCREEN_ROWS: number = 18;

/**
 * The cursor column inside the box, and where the label starts.
 *
 * Column 0 of the box is its own border, 1 is the cursor, 2 is the text --
 * which is exactly how the cartridge lays out every list it draws.
 */
const COL_CURSOR: number = 1;
const COL_LABEL: number = 2;

/** charmap.asm: the filled cursor arrow. */
const CODE_ARROW: number = 0xED;

/**
 * The narrowest the box may be, in tiles.
 *
 * A four-letter move in a box that fits it exactly reads as a mistake; the
 * cartridge's own menus are wider than their contents.
 */
const MIN_COLS: number = 9;

/**
 * Where the menu box sits and how big it is, as [topRow, leftCol, cols, rows].
 *
 * Bottom-right, and sized to what it holds: the box grows UPWARD from the
 * bottom of the screen as the list gets longer, so its bottom edge is where
 * the eye already is -- on the message box it shares the panel with.
 */
export function battleMenuRect(rows: string[]): number[] {
  const count = rows.length;
  let widest = 0;
  for (let i = 0; i < count; i++) {
    const length = rows[i] ? rows[i].length : 0;
    if (length > widest) {
      widest = length;
    }
  }
  // The border either side, the cursor column, and the longest label.
  let cols = COL_LABEL + widest + 1;
  if (cols < MIN_COLS) {
    cols = MIN_COLS;
  }
  if (cols > SCREEN_COLS) {
    cols = SCREEN_COLS;
  }
  const height = count + 2;
  const top = SCREEN_ROWS - height;
  return [top < 0 ? 0 : top, SCREEN_COLS - cols, cols, height];
}

/**
 * Draws the menu, and answers the top row it used.
 *
 * The caller widens the panel's crop to that row: the message box alone is
 * rows 12 to 17, and a five-row menu needs to start at 11.
 */
export function paintBattleMenu(
  canvas: GbCanvas, font: GbFont, rows: string[], cursorRow: number
): number {
  if (!rows || rows.length === 0) {
    return SCREEN_ROWS;
  }
  const rect = battleMenuRect(rows);
  const top = rect[0];
  const left = rect[1];
  font.box(canvas, left, top, rect[2], rect[3]);
  for (let i = 0; i < rows.length; i++) {
    const y = (top + 1 + i) * TILE;
    if (i === cursorRow) {
      font.code(canvas, CODE_ARROW, (left + COL_CURSOR) * TILE, y);
    }
    font.text(canvas, rows[i], (left + COL_LABEL) * TILE, y);
  }
  return top;
}
