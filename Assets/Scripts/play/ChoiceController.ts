// A list to pick one thing from: the lift's floors, the prize counter's three
// prizes, the vending machine's drinks.
//
// The cartridge draws half a dozen of these with the same routine
// (HandleMenuInput over a box a script fills: engine/events/elevator.asm:1-44,
// engine/events/prize_menu.asm:1-43, engine/events/vending_machine.asm:1-40).
// The lens had none, which is why every one of those machines was a dead
// press -- and why the workarounds so far have been chains of yes/no boxes.
//
// Pure, like ShopController and MenuController and for the same reason: a
// whole visit has to be playable in a test. The lens draws `rows()` in the
// menu panel and `lines()` in the message box and feeds `step()` the buttons;
// nothing here knows what the choice MEANS.
//
// Two things the cartridge's own list does that this keeps: B cancels (and is
// not a row), and the cursor starts at the top every time the list is opened
// rather than remembering where it was.

import type { DPadState } from "./InputSource";
import { DPadEdge } from "./InputSource";

/** Nothing to report this frame. */
export const CHOICE_NONE: number = 0;
/** The list closed: read picked(). */
export const CHOICE_CLOSED: number = 1;

/** Rows visible at once; a longer list scrolls, as the shop's does. */
export const CHOICE_ROWS: number = 6;

export class ChoiceController {
  private title: string[];
  private labels: string[];
  private notes: string[];
  private cursor: number = 0;
  private top: number = 0;
  private open: boolean = true;
  private chosen: number = -1;
  private edge: DPadEdge = new DPadEdge();

  /**
   * `notes` is the right-hand column -- a price, a floor's name -- and may be
   * shorter than `labels`, in which case the rest have none.
   */
  constructor(title: string[], labels: string[], notes: string[]) {
    this.title = title ? title : [];
    this.labels = labels ? labels : [];
    this.notes = notes ? notes : [];
  }

  isOpen(): boolean {
    return this.open;
  }

  /** The row picked, or -1 when the player backed out. */
  picked(): number {
    return this.chosen;
  }

  /** The question, for the message box. */
  lines(): string[] {
    return this.title.length > 0 ? this.title : null;
  }

  /** The visible window of the list, each row already padded with its note. */
  rows(): string[] {
    const out: string[] = [];
    for (let i = this.top; i < this.labels.length && i < this.top + CHOICE_ROWS; i++) {
      const note = i < this.notes.length && this.notes[i] ? this.notes[i] : "";
      out.push(note === "" ? this.labels[i] : this.labels[i] + "  " + note);
    }
    return out;
  }

  /** Where the cursor sits inside the visible window. */
  /** Select a visible row; normal step() still owns the action and validation. */
  pointRow(row: number): boolean {
    if (!this.isOpen() || row < 0 || row >= this.rows().length) return false;
    this.cursor = this.top + row;
    this.edge = new DPadEdge();
    return true;
  }

  cursorRow(): number {
    return this.cursor - this.top;
  }

  step(dpad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): number {
    if (!this.open) {
      return CHOICE_CLOSED;
    }
    const moved = this.edge.step(dpad, dt);
    if (moved === "up" && this.cursor > 0) {
      this.cursor = this.cursor - 1;
    }
    if (moved === "down" && this.cursor < this.labels.length - 1) {
      this.cursor = this.cursor + 1;
    }
    if (this.cursor < this.top) {
      this.top = this.cursor;
    }
    if (this.cursor >= this.top + CHOICE_ROWS) {
      this.top = this.cursor - CHOICE_ROWS + 1;
    }
    if (pressedB) {
      this.chosen = -1;
      this.open = false;
      return CHOICE_CLOSED;
    }
    if (pressedA) {
      this.chosen = this.labels.length > 0 ? this.cursor : -1;
      this.open = false;
      return CHOICE_CLOSED;
    }
    return CHOICE_NONE;
  }
}
