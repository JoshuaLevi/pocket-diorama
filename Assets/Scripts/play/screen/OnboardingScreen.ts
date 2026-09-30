// The onboarding page: the lens's own question before the bedroom fades in,
// as designed in SPEC.md "The onboarding page -- design".
//
// After the intro's last fade to white and before a new game's bedroom,
// bootPhase becomes "onboarding" and this draws one Game Boy box on the same
// canvas the intro and the boot menu already share:
//
//   HOW DO YOU WANT
//   TO PLAY?
//   ▶GAME BOY
//    DIORAMA
//
// Pure, like every controller in this folder: the lens feeds it the pad and
// paints what it asks for. Two rows, no wrap -- Gen 1's own two-row toggles
// stop at the ends rather than cycling, unlike the three-and-more-row menus
// that do wrap -- A and START both pick, B does nothing because there is no
// default to fall back to. CONTINUE never opens this page; wiring that, and
// writing the result into PlayState.playMode, is done where the rest of the
// boot flow lives, not here.
//
// PLAY_MODE_GAMEBOY / PLAY_MODE_DIORAMA live in PlayState.ts rather than
// here: PlayState needs them itself (the field's default and its save
// migration), TitleScreen's OPTION screen needs them too, and PlayState
// depends on neither screen file, so importing them from there is the
// direction with no cycle.

import type { GbCanvas, GbFont } from "./GbCanvas";
import { CODE_CURSOR, TILE } from "./GbCanvas";
import { PLAY_MODE_GAMEBOY, PLAY_MODE_DIORAMA } from "../PlayState";

const CURSOR_GAMEBOY: number = 0;
const CURSOR_DIORAMA: number = 1;

/**
 * Tile layout on the 20x18 (160x144) screen, TILE = 8px -- the whole screen
 * is one bordered box, drawn the same way BootMenuController's OPTION
 * screen covers the whole screen (`font.box(canvas, 0, 0, 20, 18)`):
 *
 *   row  2  "HOW DO YOU WANT"   at column 2
 *   row  4  "TO PLAY?"          at column 2
 *   row  6  "GAME BOY"          at column 2, cursor glyph at column 1
 *   row  8  "DIORAMA"           at column 2, cursor glyph at column 1
 *
 * Column 2 keeps both header lines flush with the item text below them;
 * column 1 is where the cursor arrow sits, exactly where the main menu
 * puts it (see TitleScreen.ts BootMenuController.paint()). The two-tile
 * gap between GAME BOY and DIORAMA matches the main menu's own row spacing.
 * Rows 9-16 stay blank paper: the box is sized to fill the screen, the way
 * the OPTION screen's box does, not sized to the four lines it holds.
 */
const BOX_COLS: number = 20;
const BOX_ROWS: number = 18;
const COL_TEXT: number = 2;
const COL_CURSOR: number = 1;
const ROW_LINE1: number = 2;
const ROW_LINE2: number = 4;
const ROW_GAMEBOY: number = 6;
const ROW_DIORAMA: number = 8;

export class OnboardingController {
  private cursor: number = CURSOR_GAMEBOY;
  private chosen: string = "";
  /** Bumped only by a press that actually moved the cursor or made the pick. */
  private version: number = 0;

  /** 0 (GAME BOY) or 1 (DIORAMA): which row the cursor sits on right now. */
  cursorRow(): number {
    return this.cursor;
  }

  /** "" until a choice is made, then PLAY_MODE_GAMEBOY or PLAY_MODE_DIORAMA for good. */
  result(): string {
    return this.chosen;
  }

  stateVersion(): number {
    return this.version;
  }

  /**
   * `dpad` is the already edge-triggered move for this frame -- "up", "down"
   * or "" -- the same shape BootMenuController.step() derives from its own
   * DPadEdge before calling stepMain()/stepOptions(). Left and right do
   * nothing here: there is nothing to cycle, only a row to pick.
   *
   * Returns "" while the page is still open, PLAY_MODE_GAMEBOY or
   * PLAY_MODE_DIORAMA once A or START picks a row, and keeps returning that
   * same pick on every later call, ignoring all further input -- there is
   * no way back once the choice is made here.
   */
  step(dpad: string, pressedA: boolean, pressedB: boolean, pressedStart: boolean): string {
    if (this.chosen !== "") {
      return this.chosen;
    }
    const before = this.cursor;
    if (dpad === "up" && this.cursor > CURSOR_GAMEBOY) {
      this.cursor--;
    } else if (dpad === "down" && this.cursor < CURSOR_DIORAMA) {
      this.cursor++;
    }
    if (this.cursor !== before) {
      this.version++;
    }
    if (pressedA || pressedStart) {
      this.chosen = this.cursor === CURSOR_GAMEBOY ? PLAY_MODE_GAMEBOY : PLAY_MODE_DIORAMA;
      this.version++;
    }
    // pressedB: does nothing. There is no default to back out to.
    return this.chosen;
  }

  // ------------------------------------------------------------------ paint

  /** One bordered box, the main menu's own style, covering the whole screen. */
  paint(canvas: GbCanvas, font: GbFont): void {
    canvas.clear(0);
    font.box(canvas, 0, 0, BOX_COLS, BOX_ROWS);
    font.text(canvas, "HOW DO YOU WANT", COL_TEXT * TILE, ROW_LINE1 * TILE);
    font.text(canvas, "TO PLAY?", COL_TEXT * TILE, ROW_LINE2 * TILE);
    font.text(canvas, "GAME BOY", COL_TEXT * TILE, ROW_GAMEBOY * TILE);
    font.text(canvas, "DIORAMA", COL_TEXT * TILE, ROW_DIORAMA * TILE);
    const cursorRowTile = this.cursor === CURSOR_GAMEBOY ? ROW_GAMEBOY : ROW_DIORAMA;
    font.code(canvas, CODE_CURSOR, COL_CURSOR * TILE, cursorRowTile * TILE);
  }
}
