// "YOUR NAME?" -- the preset menu and the letter grid, as the cartridge has them.
//
// Pure, like every controller here: the lens feeds it the pad and paints what
// it asks for. Measured on the cartridge (tools/oracle/INTRO.md, "The naming
// screen" and its "Two corrections"): a first box offering NEW NAME and the
// three presets, then the grid -- three letter rows, two symbol rows and a
// case switch, six rows in one cursor cycle -- with B doing nothing, START
// confirming whatever has been typed (nothing typed is a silent re-prompt,
// not a fallback), and no ED cell anywhere to jump the cursor to.

import type { DPadState } from "../InputSource";
import { DPadEdge } from "../InputSource";
import type { GbCanvas, GbFont } from "./GbCanvas";
import {
  CODE_CURSOR, CODE_BOX_TL, CODE_BOX_TR, CODE_BOX_BL, CODE_BOX_BR,
  CODE_BOX_H, CODE_BOX_V, TILE,
} from "./GbCanvas";

export const NAMING_NONE: number = 0;
export const NAMING_DONE: number = 1;

/** Gen 1 player and rival names are at most seven characters. */
export const NAME_MAX_LENGTH: number = 7;

/** The menu's first row; the presets follow it. */
export const NEW_NAME_LABEL: string = "NEW NAME";

/**
 * Measured (INTRO.md "The naming screen"): row 11's nine symbols end in the
 * stacked PK/MN ligature tiles (this controller's own CODE_PK/CODE_MN,
 * unaffected below); row 13's nine end in ¥, not the "ED" this file used to
 * assume -- there is no ED cell on the grid at all, confirmed by pressing
 * every direction from every edge in the corrected probe. START is the only
 * way to confirm; see confirm() below.
 */
const GRID_UPPER: string[][] = [
  ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
  ["J", "K", "L", "M", "N", "O", "P", "Q", "R"],
  ["S", "T", "U", "V", "W", "X", "Y", "Z", " "],
  ["×", "(", ")", ":", ";", "[", "]", "<PK>", "<MN>"],
  ["-", "?", "!", "♂", "♀", "/", "．", ",", "¥"],
  ["lower case"],
];
const GRID_LOWER: string[][] = [
  ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
  ["j", "k", "l", "m", "n", "o", "p", "q", "r"],
  ["s", "t", "u", "v", "w", "x", "y", "z", " "],
  ["×", "(", ")", ":", ";", "[", "]", "<PK>", "<MN>"],
  ["-", "?", "!", "♂", "♀", "/", "．", ",", "¥"],
  ["UPPER CASE"],
];
const CASE_ROW: number = 5;

/** The PK and MN glyphs have no single character; these are their codes. */
const CODE_PK: number = 0xe1;
const CODE_MN: number = 0xe2;

/**
 * The preset box's own top border (INTRO.md "The naming screen"): NAME sits
 * IN the border's top edge at these four columns (row 0), not on a text row
 * of its own below it -- confirmed pixel-for-pixel against the recorded
 * frame (frames/90-player_name_presets.png): the border's double line runs
 * under columns 1-2 and 7-9 but is absent under 3-6, replaced outright by
 * the N/A/M/E glyphs. NEW NAME and the presets are one row higher than this
 * file used to draw them: row 2, not 3 (rows 2/4/6/8, cursor at col 1).
 */
const PRESET_NAME_COL: number = 3;
const PRESET_NAME_WIDTH: number = 4;
const PRESET_FIRST_ROW: number = 2;
const PRESET_ROW_STEP: number = 2;
const PRESET_TEXT_COL: number = 2;
const PRESET_CURSOR_COL: number = 1;

/**
 * The name preview's own two tile rows (INTRO.md "The naming screen", row 3
 * columns 10-16): measured pixel-for-pixel against frames/25-your_name_
 * list.png -- the raised slot (next to be typed) is a 2px line at the TOP
 * of its tile (y+0..1), every other slot's line sits 3px lower (y+3..4),
 * both 7px wide. This file used to draw a single 1px line near the tile's
 * bottom for both, which is not what is on the cartridge.
 */
const PREVIEW_ROW: number = 3;
const PREVIEW_COL: number = 10;
const PREVIEW_RAISED_Y: number = 0;
const PREVIEW_FLAT_Y: number = 3;
const PREVIEW_TICK_WIDTH: number = 7;
const PREVIEW_TICK_HEIGHT: number = 2;

const PHASE_PRESETS: string = "presets";
const PHASE_GRID: string = "grid";
const PHASE_DONE: string = "done";

export class NamingController {
  private title: string;
  private presets: string[];
  private maxLength: number;
  private phase: string = PHASE_PRESETS;
  private presetCursor: number = 0;
  private row: number = 0;
  private col: number = 0;
  private lower: boolean = false;
  private glyphs: string[] = [];
  private chosen: string = "";
  private pad: DPadEdge = new DPadEdge();
  /** Bumped by every visible change, so a view repaints only then. */
  private version: number = 0;

  /**
   * `presets` are the cartridge's three (RED, ASH, JACK); an empty list
   * skips the menu and opens the grid at once, which is how a Pokemon is
   * nicknamed.
   */
  constructor(title: string, presets: string[], maxLength: number) {
    this.title = title;
    this.presets = presets ? presets : [];
    this.maxLength = maxLength > 0 ? maxLength : NAME_MAX_LENGTH;
    if (this.presets.length === 0) {
      this.phase = PHASE_GRID;
    }
  }

  isOpen(): boolean {
    return this.phase !== PHASE_DONE;
  }

  /** The name, once NAMING_DONE; "" before. */
  result(): string {
    return this.chosen;
  }

  /** What has been typed so far, for a view and for tests. */
  typed(): string {
    return this.glyphs.join("");
  }

  inGrid(): boolean {
    return this.phase === PHASE_GRID;
  }

  cursor(): number[] {
    return [this.row, this.col];
  }

  isLowerCase(): boolean {
    return this.lower;
  }

  stateVersion(): number {
    return this.version;
  }

  step(pad: DPadState, pressedA: boolean, pressedB: boolean, pressedStart: boolean,
       pressedSelect: boolean, dt: number): number {
    if (this.phase === PHASE_DONE) {
      return NAMING_DONE;
    }
    const moved = this.pad.step(pad, dt);
    if (moved !== "" || pressedA || pressedB || pressedStart || pressedSelect) {
      this.version++;
    }
    if (this.phase === PHASE_PRESETS) {
      this.stepPresets(moved, pressedA);
    } else {
      this.stepGrid(moved, pressedA, pressedB, pressedStart, pressedSelect);
    }
    return this.phase === PHASE_DONE ? NAMING_DONE : NAMING_NONE;
  }

  /** Spatial entry has explicit erase/done keys; the cartridge pad path stays intact. */
  spatialTitle(): string { return this.title; }
  spatialPresets(): string[] { return [NEW_NAME_LABEL].concat(this.presets); }
  spatialLimit(): number { return this.maxLength; }
  spatialPick(key: string): void {
    if (!this.isOpen()) return;
    this.version++;
    if (key.indexOf("preset:") === 0) {
      const i = Number(key.substring(7));
      if (this.phase !== PHASE_PRESETS || i < 0 || i > this.presets.length) return;
      this.presetCursor = i; this.stepPresets("", true); return;
    }
    if (this.phase !== PHASE_GRID) return;
    if (key === "delete") this.glyphs.pop();
    else if (key === "done") this.confirm();
    else if (key === "case") this.lower = !this.lower;
    else if (key.indexOf("char:") === 0 && this.glyphs.length < this.maxLength) {
      const text = key.substring(5);
      if (text.length === 1) this.glyphs.push(text);
    }
  }

  private stepPresets(moved: string, pressedA: boolean): void {
    const count = this.presets.length + 1;
    if (moved === "up") {
      this.presetCursor = this.presetCursor > 0 ? this.presetCursor - 1 : count - 1;
    } else if (moved === "down") {
      this.presetCursor = this.presetCursor + 1 < count ? this.presetCursor + 1 : 0;
    }
    if (!pressedA) {
      return;
    }
    if (this.presetCursor === 0) {
      this.phase = PHASE_GRID;
      this.pad.reset();
      return;
    }
    this.finish(this.presets[this.presetCursor - 1]);
  }

  private grid(): string[][] {
    return this.lower ? GRID_LOWER : GRID_UPPER;
  }

  private stepGrid(moved: string, pressedA: boolean, pressedB: boolean,
                   pressedStart: boolean, pressedSelect: boolean): void {
    if (pressedStart) {
      this.confirm();
      return;
    }
    if (pressedSelect) {
      this.lower = !this.lower;
      return;
    }
    const grid = this.grid();
    if (moved === "up") {
      this.row = this.row > 0 ? this.row - 1 : CASE_ROW;
      this.col = Math.min(this.col, grid[this.row].length - 1);
    } else if (moved === "down") {
      this.row = this.row < grid.length - 1 ? this.row + 1 : 0;
      this.col = Math.min(this.col, grid[this.row].length - 1);
    } else if (moved === "left" && this.row !== CASE_ROW) {
      this.col = this.col > 0 ? this.col - 1 : grid[this.row].length - 1;
    } else if (moved === "right" && this.row !== CASE_ROW) {
      this.col = this.col < grid[this.row].length - 1 ? this.col + 1 : 0;
    }
    // Measured (INTRO.md "The naming screen ... The separate demo"): B has
    // no effect on the grid at all -- it does not erase and does not back
    // out. This file used to pop the last glyph here.
    if (!pressedA) {
      return;
    }
    if (this.row === CASE_ROW) {
      this.lower = !this.lower;
      return;
    }
    if (this.glyphs.length < this.maxLength) {
      this.glyphs.push(grid[this.row][this.col]);
    }
  }

  /**
   * START, the grid's only confirm (there is no ED cell -- see the file
   * header). Measured (INTRO.md "The separate demo"): with nothing typed
   * this is rejected, the screen redrawing from scratch with the cursor
   * back on the grid's first cell; this file used to fall back to the
   * first preset instead, which is not what the cartridge does.
   */
  private confirm(): void {
    if (this.glyphs.length === 0) {
      this.row = 0;
      this.col = 0;
      return;
    }
    this.finish(this.glyphs.join(""));
  }

  private finish(name: string): void {
    this.chosen = name;
    this.phase = PHASE_DONE;
  }

  // ------------------------------------------------------------------ paint

  /**
   * The screen as the cartridge lays it out: the preset menu in a box at the
   * top-left, or the grid under the title with the name over its underscores.
   * `blink` toggles the cursor, which the hardware does at a slower rate than
   * the frame; a view passes what it likes.
   */
  paint(canvas: GbCanvas, font: GbFont): void {
    canvas.clear(0);
    if (this.phase === PHASE_PRESETS) {
      this.paintPresets(canvas, font);
      return;
    }
    this.paintGrid(canvas, font);
  }

  paintPresets(canvas: GbCanvas, font: GbFont): void {
    const rows = this.presets.length + 1;
    const tw = 11;
    const th = rows * 2 + 4;
    this.paintPresetBox(canvas, font, tw, th);
    font.text(canvas, NEW_NAME_LABEL, PRESET_TEXT_COL * TILE, PRESET_FIRST_ROW * TILE);
    for (let i = 0; i < this.presets.length; i++) {
      font.text(canvas, this.presets[i], PRESET_TEXT_COL * TILE,
                (PRESET_FIRST_ROW + (i + 1) * PRESET_ROW_STEP) * TILE);
    }
    font.code(canvas, CODE_CURSOR, PRESET_CURSOR_COL * TILE,
              (PRESET_FIRST_ROW + this.presetCursor * PRESET_ROW_STEP) * TILE);
  }

  /**
   * `font.box()`'s own shape, except the top edge has a gap at
   * PRESET_NAME_COL..+PRESET_NAME_WIDTH where NAME is set directly into the
   * border instead of drawn as a separate row -- see the constants' own
   * doc comment above.
   */
  private paintPresetBox(canvas: GbCanvas, font: GbFont, tw: number, th: number): void {
    canvas.fillRect(0, 0, tw * TILE, th * TILE, 0);
    const x1 = (tw - 1) * TILE;
    const y1 = (th - 1) * TILE;
    font.code(canvas, CODE_BOX_TL, 0, 0);
    font.code(canvas, CODE_BOX_TR, x1, 0);
    font.code(canvas, CODE_BOX_BL, 0, y1);
    font.code(canvas, CODE_BOX_BR, x1, y1);
    for (let i = 1; i < tw - 1; i++) {
      if (i < PRESET_NAME_COL || i >= PRESET_NAME_COL + PRESET_NAME_WIDTH) {
        font.code(canvas, CODE_BOX_H, i * TILE, 0);
      }
      font.code(canvas, CODE_BOX_H, i * TILE, y1);
    }
    for (let j = 1; j < th - 1; j++) {
      font.code(canvas, CODE_BOX_V, 0, j * TILE);
      font.code(canvas, CODE_BOX_V, x1, j * TILE);
    }
    font.text(canvas, "NAME", PRESET_NAME_COL * TILE, 0);
  }

  paintGrid(canvas: GbCanvas, font: GbFont): void {
    font.text(canvas, this.title, 0, 8);
    font.text(canvas, this.typed(), 80, 16);
    // One preview tick per letter slot, the next-to-type one raised -- see
    // PREVIEW_* above for where these two pixel rows came from.
    const raised = Math.min(this.glyphs.length, this.maxLength - 1);
    const previewY = PREVIEW_ROW * TILE;
    for (let i = 0; i < this.maxLength; i++) {
      const tickY = previewY + (i === raised ? PREVIEW_RAISED_Y : PREVIEW_FLAT_Y);
      canvas.fillRect((PREVIEW_COL + i) * TILE, tickY, PREVIEW_TICK_WIDTH, PREVIEW_TICK_HEIGHT, 3);
    }
    font.box(canvas, 0, 4, 20, 11);
    const grid = this.grid();
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const cell = grid[r][c];
        const x = (c + 1) * 16;
        const y = 24 + (r + 1) * 16;
        if (cell === "<PK>") {
          font.code(canvas, CODE_PK, x, y);
        } else if (cell === "<MN>") {
          font.code(canvas, CODE_MN, x, y);
        } else {
          font.text(canvas, cell, x, y);
        }
      }
    }
    font.code(canvas, CODE_CURSOR, (this.col + 1) * 16 - 8, 24 + (this.row + 1) * 16);
  }
}
