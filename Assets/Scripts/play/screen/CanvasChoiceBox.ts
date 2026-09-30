// The cartridge's YES/NO box, on a GbCanvas.
//
// DIORAMA mode had no yes/no at all: A meant yes and B meant no, with nothing
// drawn. Asked to name a Pokemon, the wearer saw the question, pressed A on
// faith and found out afterwards what they had agreed to -- reported as "the
// yes/no screen was nowhere to be seen", which it was not.
//
// The geometry is the original's, by way of gen1recomp's ChoiceBox, which
// carries the disassembly's own citations:
//
//   * InitYesNoTextBoxParameters puts the box above the text box on the right,
//     at tile 14,7, six wide and five tall;
//   * the two labels sit two columns in, two rows apart, with the cursor in
//     the column between (home/text.asm's <NEXT> advances two rows);
//   * up or down flips between them -- there are only ever two;
//   * B does not merely answer no: .choseSecondMenuItem writes the cursor onto
//     NO first, so it visibly snaps down before the box closes;
//   * and both branches of DisplayTwoOptionMenu hold 15 frames with the menu
//     still on screen before handing control back. Answering does not blink
//     the box away; you see what you chose.
//
// Some prompts start on NO (releasing a Pokemon, and the like), which is what
// `defaultNo` is for. Pure -- step() and paint() only -- so the whole thing is
// testable without a lens.

import type { GbCanvas } from "./GbCanvas";
import type { GbFont } from "./GbCanvas";

/** Tile rect of the standard right-hand box, and where its rows sit inside it. */
export const CHOICE_TX: number = 14;
export const CHOICE_TY: number = 7;
export const CHOICE_TW: number = 6;
export const CHOICE_TH: number = 5;
export const CHOICE_FIRST_ROW: number = 1;
/** The gap between the two rows: <NEXT> is two screen rows. */
export const CHOICE_ROW_STEP: number = 2;
/** Frames the answered box stays up before control comes back. */
export const ANSWER_HOLD_FRAMES: number = 15;

/** charmap.asm: the filled cursor arrow. */
export const CODE_CURSOR_ARROW: number = 0xED;

const TILE: number = 8;

export const CHOICE_PENDING: number = 0;
export const CHOICE_YES: number = 1;
export const CHOICE_NO: number = 2;

export class CanvasChoiceBox {
  private index: number = 0;
  private chosen: number = CHOICE_PENDING;
  private holdFrames: number = 0;
  private version: number = 0;
  private labels: string[] = ["YES", "NO"];

  constructor(defaultNo: boolean) {
    this.index = defaultNo ? 1 : 0;
  }

  /** Bumped whenever anything visible changed, so the canvas repaints only then. */
  stateVersion(): number {
    return this.version;
  }

  /** CHOICE_PENDING until the hold is over, then CHOICE_YES or CHOICE_NO. */
  answer(): number {
    return this.holdFrames > 0 ? CHOICE_PENDING : this.chosen;
  }

  /** True while the box is still on screen, answered or not. */
  isOpen(): boolean {
    return this.chosen === CHOICE_PENDING || this.holdFrames > 0;
  }

  /** Which row the cursor is on: 0 for YES, 1 for NO. Exposed for the tests. */
  cursorRow(): number {
    return this.index;
  }

  /**
   * One frame. `move` is an edge-triggered "up"/"down"/"" -- the same shape
   * DPadEdge hands out, so holding a direction cannot run the cursor away.
   */
  step(move: string, pressedA: boolean, pressedB: boolean, frames: number): void {
    if (this.chosen !== CHOICE_PENDING) {
      if (this.holdFrames > 0) {
        this.holdFrames -= frames > 0 ? frames : 0;
        if (this.holdFrames < 0) {
          this.holdFrames = 0;
        }
      }
      return;
    }
    if (move === "up" || move === "down") {
      this.index = this.index === 0 ? 1 : 0;
      this.version++;
      return;
    }
    if (pressedA) {
      this.chosen = this.index === 0 ? CHOICE_YES : CHOICE_NO;
      this.holdFrames = ANSWER_HOLD_FRAMES;
      this.version++;
      return;
    }
    if (pressedB) {
      // The cursor snaps to NO first, and is seen there for the hold.
      this.index = 1;
      this.chosen = CHOICE_NO;
      this.holdFrames = ANSWER_HOLD_FRAMES;
      this.version++;
    }
  }

  choose(index: number): void {
    if (this.chosen !== CHOICE_PENDING || (index !== 0 && index !== 1)) return;
    this.index = index;
    this.step("", true, false, 0);
  }

  paint(canvas: GbCanvas, font: GbFont): void {
    font.box(canvas, CHOICE_TX, CHOICE_TY, CHOICE_TW, CHOICE_TH);
    const labelX = (CHOICE_TX + 2) * TILE;
    const firstY = (CHOICE_TY + CHOICE_FIRST_ROW) * TILE;
    font.text(canvas, this.labels[0], labelX, firstY);
    font.text(canvas, this.labels[1], labelX, firstY + CHOICE_ROW_STEP * TILE);
    font.code(canvas, CODE_CURSOR_ARROW, (CHOICE_TX + 1) * TILE,
              firstY + this.index * CHOICE_ROW_STEP * TILE);
  }
}
