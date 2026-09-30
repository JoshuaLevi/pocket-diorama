// Typing a world code on a Game Boy pad.
//
// The published lens gets its world from a page the player opened on their
// own computer: the page reads their cartridge, bakes the world and shows a
// six-character code, and this screen is where that code is typed. It runs
// BEFORE there is a world, so like the setup wizard it is drawn with the font
// built into the lens rather than the cartridge's, and it is pure: no scene,
// no globals, no Lens Studio types. PokemonAR feeds it presses and paints what
// it asks for.
//
// The alphabet leaves out I, O, 0 and 1. A code is read off a screen and typed
// on a D-pad, and those four are the ones people mistake for each other. The
// server that mints codes uses the same thirty-two symbols.

import type { GbCanvas } from "./GbCanvas";
import { SCREEN_WIDTH } from "./GbCanvas";
import { COLUMNS, MARGIN_X, drawText, drawCentred, textWidth } from "./TinyFont";

/** The thirty-two symbols a code is made of; eight columns of four rows. */
export const CODE_ALPHABET: string = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH: number = 6;
export const GRID_COLUMNS: number = 8;
export const GRID_ROWS: number = 4;

/** What step() asks the wizard to do. */
export const CODE_STAY: string = "";
export const CODE_DONE: string = "done";
export const CODE_BACK: string = "back";

/** The row below the letters: DELETE on the left, OK on the right. */
const CONTROL_ROW: number = GRID_ROWS;
const CONTROL_DELETE: number = 0;
const CONTROL_OK: number = 1;

// ------------------------------------------------------------------- layout
//
// 160x144, paper with ink on it, like every other page drawn before the world
// exists (see SetupWizard for why a dark field is a hole on this display).
const PAPER: number = 0;
const INK: number = 3;

export const TITLE_Y: number = 8;
const TITLE_SCALE: number = 2;
export const RULE_Y: number = 26;
/** The six boxes the code fills in. */
export const FIELD_Y: number = 30;
export const FIELD_BOX_W: number = 16;
export const FIELD_BOX_H: number = 18;
export const FIELD_GAP: number = 4;
export const FIELD_X: number = Math.round(
  (SCREEN_WIDTH - (CODE_LENGTH * FIELD_BOX_W + (CODE_LENGTH - 1) * FIELD_GAP)) / 2);
/** The letter grid. */
export const GRID_Y: number = 54;
export const GRID_CELL_W: number = 18;
export const GRID_CELL_H: number = 14;
export const GRID_PITCH_Y: number = 15;
export const GRID_X: number = Math.round((SCREEN_WIDTH - GRID_COLUMNS * GRID_CELL_W) / 2);
/** The DELETE / OK row. */
export const CONTROL_Y: number = GRID_Y + GRID_ROWS * GRID_PITCH_Y;
export const CONTROL_W: number = (GRID_COLUMNS * GRID_CELL_W) / 2;
export const FOOTER_Y: number = 134;

export const LABEL_DELETE: string = "DELETE";
export const LABEL_OK: string = "OK";

// --------------------------------------------------------------- pure rules

/**
 * Upper case, and nothing but the alphabet's own symbols.
 *
 * Spaces and dashes are what a person adds when reading a code aloud or
 * writing it down; they are not part of it. Anything else stays and fails
 * isValidCode, which is the right answer for a code with an O in it: the
 * alphabet has none, so the page never showed one.
 */
export function normaliseCode(raw: string): string {
  const text = raw ? raw.toUpperCase() : "";
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === " " || ch === "-" || ch === "_" || ch === "." || ch === "\n" || ch === "\t") {
      continue;
    }
    out += ch;
  }
  return out;
}

/** Exactly CODE_LENGTH symbols, every one of them in the alphabet. */
export function isValidCode(code: string): boolean {
  if (!code || code.length !== CODE_LENGTH) {
    return false;
  }
  for (let i = 0; i < code.length; i++) {
    if (CODE_ALPHABET.indexOf(code.charAt(i)) < 0) {
      return false;
    }
  }
  return true;
}

/** The symbol at a grid cell, or "" off the grid. Exported so a test can walk it. */
export function symbolAt(row: number, column: number): string {
  if (row < 0 || row >= GRID_ROWS || column < 0 || column >= GRID_COLUMNS) {
    return "";
  }
  return CODE_ALPHABET.charAt(row * GRID_COLUMNS + column);
}

// ------------------------------------------------------------- the machine

export class CodeEntry {
  private canGoBack: boolean;
  private typed: string = "";
  private row: number = 0;
  private column: number = 0;
  private version: number = 0;

  constructor(canGoBack: boolean) {
    this.canGoBack = canGoBack;
  }

  // ------------------------------------------------------------- readers

  code(): string {
    return this.typed;
  }

  /** Bumped whenever the drawn page would differ. */
  stateVersion(): number {
    return this.version;
  }

  /** [row, column]; row GRID_ROWS is the DELETE / OK row. */
  cursor(): number[] {
    return [this.row, this.column];
  }

  reset(): void {
    this.typed = "";
    this.row = 0;
    this.column = 0;
    this.version++;
  }

  // ---------------------------------------------------------------- step

  /** Direct selection from the spatial keyboard; gaps and invalid cells do nothing. */
  selectCell(row: number, column: number): string {
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 ||
        row > GRID_ROWS || column < 0 || column >= (row === GRID_ROWS ? 2 : GRID_COLUMNS)) {
      return CODE_STAY;
    }
    this.row = row;
    this.column = column;
    this.version++;
    return this.pick();
  }

  /**
   * One frame. `dpad` is an EDGE ("up", "down", "left", "right" or ""), not
   * a held state: the caller runs the D-pad through DPadEdge so a held
   * direction repeats at the pad's own rate rather than sixty times a second.
   */
  step(dpad: string, pressedA: boolean, pressedB: boolean, pressedStart: boolean): string {
    if (dpad !== "") {
      this.move(dpad);
    }
    if (pressedStart) {
      if (this.typed.length === CODE_LENGTH) {
        return CODE_DONE;
      }
      // START with a half-typed code jumps the cursor to OK, which is where a
      // wearer who pressed it expects to be looking.
      this.row = CONTROL_ROW;
      this.column = CONTROL_OK;
      this.version++;
      return CODE_STAY;
    }
    if (pressedA) {
      return this.pick();
    }
    if (pressedB) {
      if (this.typed.length > 0) {
        this.typed = this.typed.substring(0, this.typed.length - 1);
        this.version++;
        return CODE_STAY;
      }
      return this.canGoBack ? CODE_BACK : CODE_STAY;
    }
    return CODE_STAY;
  }

  private move(direction: string): void {
    const before = this.row * 100 + this.column;
    if (direction === "left") {
      if (this.row === CONTROL_ROW) {
        this.column = this.column === CONTROL_DELETE ? CONTROL_OK : CONTROL_DELETE;
      } else {
        this.column = this.column === 0 ? GRID_COLUMNS - 1 : this.column - 1;
      }
    } else if (direction === "right") {
      if (this.row === CONTROL_ROW) {
        this.column = this.column === CONTROL_OK ? CONTROL_DELETE : CONTROL_OK;
      } else {
        this.column = this.column === GRID_COLUMNS - 1 ? 0 : this.column + 1;
      }
    } else if (direction === "down") {
      if (this.row === GRID_ROWS - 1) {
        // Onto the control row: the left half of the grid lands on DELETE,
        // the right half on OK.
        this.row = CONTROL_ROW;
        this.column = this.column < GRID_COLUMNS / 2 ? CONTROL_DELETE : CONTROL_OK;
      } else if (this.row < GRID_ROWS - 1) {
        this.row = this.row + 1;
      } else {
        // From the control row, wrap to the top.
        this.row = 0;
        this.column = this.column === CONTROL_DELETE ? 1 : GRID_COLUMNS - 2;
      }
    } else if (direction === "up") {
      if (this.row === CONTROL_ROW) {
        this.row = GRID_ROWS - 1;
        this.column = this.column === CONTROL_DELETE ? 1 : GRID_COLUMNS - 2;
      } else if (this.row > 0) {
        this.row = this.row - 1;
      } else {
        this.row = CONTROL_ROW;
        this.column = this.column < GRID_COLUMNS / 2 ? CONTROL_DELETE : CONTROL_OK;
      }
    }
    if (this.row * 100 + this.column !== before) {
      this.version++;
    }
  }

  private pick(): string {
    if (this.row === CONTROL_ROW) {
      if (this.column === CONTROL_DELETE) {
        if (this.typed.length > 0) {
          this.typed = this.typed.substring(0, this.typed.length - 1);
          this.version++;
        }
        return CODE_STAY;
      }
      return this.typed.length === CODE_LENGTH ? CODE_DONE : CODE_STAY;
    }
    if (this.typed.length >= CODE_LENGTH) {
      return CODE_STAY;
    }
    this.typed += symbolAt(this.row, this.column);
    this.version++;
    if (this.typed.length === CODE_LENGTH) {
      // The sixth symbol parks the cursor on OK, so the next A confirms.
      this.row = CONTROL_ROW;
      this.column = CONTROL_OK;
    }
    return CODE_STAY;
  }

  // ----------------------------------------------------------------- copy

  /** Eight glyphs: the title sits beside the step icon, left of the dots. */
  title(): string {
    return "THE CODE";
  }

  /** The grid as text, so the wizard's copy test can check every glyph. */
  lines(): string[] {
    const out: string[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      let line = "";
      for (let c = 0; c < GRID_COLUMNS; c++) {
        line += (c > 0 ? " " : "") + symbolAt(r, c);
      }
      out.push(line);
    }
    out.push(LABEL_DELETE + "  " + LABEL_OK);
    return out;
  }

  footer(): string {
    if (this.typed.length === CODE_LENGTH) {
      return "A = OK  B = DELETE";
    }
    if (this.typed.length === 0 && this.canGoBack) {
      return "A = PICK  B = BACK";
    }
    return "A = PICK  B = DELETE";
  }

  // ---------------------------------------------------------------- paint

  paint(canvas: GbCanvas): void {
    if (!canvas) {
      return;
    }
    canvas.clear(PAPER);
    // Beside the wizard's icon, like every other step's title (SetupWizard.paint).
    drawText(canvas, this.title(), 20, TITLE_Y, INK, TITLE_SCALE);
    canvas.fillRect(MARGIN_X, RULE_Y, SCREEN_WIDTH - 2 * MARGIN_X, 1, INK);

    // The field: a box per symbol, the typed ones filled in, the next one
    // marked with a heavier line so the eye knows where the cursor writes.
    for (let i = 0; i < CODE_LENGTH; i++) {
      const x = FIELD_X + i * (FIELD_BOX_W + FIELD_GAP);
      const thickness = i === this.typed.length ? 2 : 1;
      canvas.fillRect(x, FIELD_Y + FIELD_BOX_H - thickness, FIELD_BOX_W, thickness, INK);
      if (i < this.typed.length) {
        const glyph = this.typed.charAt(i);
        drawText(canvas, glyph, x + Math.round((FIELD_BOX_W - textWidth(glyph, 2)) / 2) + 1,
                 FIELD_Y + 1, INK, 2);
      }
    }

    // The grid, with the cursor as an inverted cell.
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLUMNS; c++) {
        const x = GRID_X + c * GRID_CELL_W;
        const y = GRID_Y + r * GRID_PITCH_Y;
        const under = this.row === r && this.column === c;
        if (under) {
          canvas.fillRect(x, y, GRID_CELL_W, GRID_CELL_H, INK);
        }
        drawText(canvas, symbolAt(r, c), x + 7, y + 4, under ? PAPER : INK, 1);
      }
    }

    // DELETE and OK, each half the grid wide.
    const labels = [LABEL_DELETE, LABEL_OK];
    for (let i = 0; i < 2; i++) {
      const x = GRID_X + i * CONTROL_W;
      const under = this.row === CONTROL_ROW && this.column === i;
      if (under) {
        canvas.fillRect(x, CONTROL_Y, CONTROL_W, GRID_CELL_H, INK);
      }
      drawText(canvas, labels[i],
               x + Math.round((CONTROL_W - textWidth(labels[i], 1)) / 2) + 1,
               CONTROL_Y + 4, under ? PAPER : INK, 1);
    }

    const footer = this.footer();
    drawText(canvas, footer.length > COLUMNS ? footer.substring(0, COLUMNS) : footer,
             MARGIN_X, FOOTER_Y, INK, 1);
  }
}
