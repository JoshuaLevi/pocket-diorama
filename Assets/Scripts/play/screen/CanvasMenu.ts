// The START menu, the party, the bag and the move list, on the flat screen.
//
// MenuController already says everything a list is -- the rows to draw,
// windowed to six, and which one the cursor is on -- and DIORAMA mode draws
// that on a GlyphPanel standing over the plate. GAME BOY mode had nothing:
// START opened the same list on the pad's panel, out in the room, beside a
// world that was being drawn on a Game Boy screen. This is the list on that
// screen.
//
// Drawn the way the cartridge draws its full-screen lists (the party, the
// bag): a white plate across the whole width, the cursor in the first column
// and the rows from the second, two tile rows apart. No frame, because an
// eighteen-column row plus a cursor column is nineteen of the screen's twenty
// and a frame would need two more. The message box, when one is up at the
// same time -- a battle asks for a move while a line is still read -- is
// painted after this and wins the two rows they share.

import type { GbCanvas, GbFont } from "./GbCanvas";
import { TILE } from "./GbCanvas";

/** The cursor's column and the rows' first column, in tiles. */
export const CANVAS_MENU_CURSOR_TX: number = 0;
export const CANVAS_MENU_TEXT_TX: number = 1;
/** The first row's tile row; every row after it is CANVAS_MENU_ROW_STEP lower. */
export const CANVAS_MENU_FIRST_TY: number = 1;
export const CANVAS_MENU_ROW_STEP: number = 2;
/** The screen's width in tiles: the plate spans it. */
const SCREEN_TILES_X: number = 20;
/** The cartridge's own cursor glyph, as CanvasChoiceBox and SlotController use it. */
const CODE_CURSOR_ARROW: number = 0xED;

/** How many tile rows the plate under `rows` rows takes. */
export function canvasMenuHeight(rows: number): number {
  return rows > 0 ? CANVAS_MENU_FIRST_TY + rows * CANVAS_MENU_ROW_STEP : 0;
}

/**
 * The list. `rows` is MenuController.rows() -- already windowed and padded --
 * and `cursorRow` MenuController.cursorRow(), an index into `rows`, or -1 for
 * none. Nothing is painted for an empty list.
 */
export function paintCanvasMenu(canvas: GbCanvas, font: GbFont, rows: string[],
                                cursorRow: number): void {
  if (!rows || rows.length === 0) {
    return;
  }
  canvas.fillRect(0, 0, SCREEN_TILES_X * TILE, canvasMenuHeight(rows.length) * TILE, 0);
  for (let i = 0; i < rows.length; i++) {
    const y = (CANVAS_MENU_FIRST_TY + i * CANVAS_MENU_ROW_STEP) * TILE;
    font.text(canvas, rows[i], CANVAS_MENU_TEXT_TX * TILE, y);
    if (i === cursorRow) {
      font.code(canvas, CODE_CURSOR_ARROW, CANVAS_MENU_CURSOR_TX * TILE, y);
    }
  }
}

/**
 * The same list during a FIGHT: over the message box's own rows, at the
 * cartridge's single-row pitch.
 *
 * The full-screen plate above is right for the party and the bag, which the
 * cartridge also draws over everything. A fight is different: its list sits
 * in the six rows the message box owns (12 to 17), one row a move, with the
 * two pictures and the two blocks left standing above it -- which is exactly
 * what the first live fight on 26 September did not do, when the plate came
 * down over the whole screen. Six rows at one-row pitch are the six rows the
 * box has, so every MenuController battle list fits without scrolling.
 */
export const BATTLE_MENU_TX: number = 4;
export const BATTLE_MENU_TY: number = 12;
export const BATTLE_MENU_ROWS: number = 6;
export const BATTLE_MENU_CURSOR_TX: number = 4;
export const BATTLE_MENU_TEXT_TX: number = 5;
/** Columns a row may use: from the text column to the screen's edge. */
export const BATTLE_MENU_COLUMNS: number = SCREEN_TILES_X - BATTLE_MENU_TEXT_TX;

export function paintCanvasBattleMenu(canvas: GbCanvas, font: GbFont, rows: string[],
                                      cursorRow: number): void {
  if (!rows || rows.length === 0) {
    return;
  }
  canvas.fillRect(BATTLE_MENU_TX * TILE, BATTLE_MENU_TY * TILE,
                  (SCREEN_TILES_X - BATTLE_MENU_TX) * TILE, BATTLE_MENU_ROWS * TILE, 0);
  for (let i = 0; i < rows.length && i < BATTLE_MENU_ROWS; i++) {
    const y = (BATTLE_MENU_TY + i) * TILE;
    // An eighteen-column row carries the PP at its right end; the fifteen
    // columns left of the edge keep the name and the last of the PP.
    const row = rows[i].length > BATTLE_MENU_COLUMNS
      ? rows[i].substring(0, BATTLE_MENU_COLUMNS) : rows[i];
    font.text(canvas, row, BATTLE_MENU_TEXT_TX * TILE, y);
    if (i === cursorRow) {
      font.code(canvas, CODE_CURSOR_ARROW, BATTLE_MENU_CURSOR_TX * TILE, y);
    }
  }
}
