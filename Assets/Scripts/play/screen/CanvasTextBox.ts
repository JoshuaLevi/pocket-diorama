// The intro's own dialogue box, drawn straight onto the Game Boy canvas.
//
// SPEC.md "The intro on the Game Boy screen -- design": `show_text` moves
// from the HUD box over the pad to "a text box on the canvas at the
// cartridge's rectangle, printed letter by letter at the OPTION pace, with
// the same pagination as Dialogue.paginate and the blink arrow". This is
// that box. Pure: paint(canvas, font) and step(frames) only, no lens types,
// no VM. The wiring agent feeds it `pages` -- Dialogue.paginate()'s own
// DialoguePage[].map(p => p.lines), or an equivalent string[][] -- and calls
// ack() whenever a press (real, during the naming exchanges, or the intro's
// own auto-advance) should move to the next page.
//
// Measured (tools/oracle/INTRO.md "OakSpeechText1 ... the letter/blink
// measurements", cross-checked against Host.ts's own textReady(), which
// this mirrors exactly so the two never drift apart):
//
//   * Dialogue box: top-left tile (row 12, col 0), 6 rows x 20 cols (full
//     width). Text on rows 14 and 16, columns 1-18 (18 characters); rows 13
//     and 15 are blank interior padding, matching every text box in the
//     whole intro (Oak/Nidorino/player/rival, both name confirmations,
//     IntroducePlayerText, IntroduceRivalText, OakSpeechText3).
//   * MEDIUM speed prints one new character every 3 frames, including
//     spaces, with no extra frame across a `cont` scroll's own line break.
//   * A page ready to acknowledge is N*speed+1 frames after it went up,
//     where N is that page's own NEW letters (a `cont` scroll's carried top
//     line, already on screen, costs nothing) -- Host.ts's textReady(),
//     reproduced here so the canvas box and the HUD box agree to the frame.
//   * A hard page break (paginate()'s own chunk boundary -- NOT a `cont`
//     scroll, so the incoming page's first line does not equal the outgoing
//     page's last) clears the box -- interior blank, border unchanged -- for
//     exactly 17 frames (measured identically on every one of the six hard
//     clears in this intro: OakSpeechText1 p2->p3, 2A->2B, 2B's own two
//     internal clears, IntroduceRivalText, OakSpeechText3) before the next
//     page's first letter appears.
//   * The page-advance arrow (tile $EE, screen row 16 col 18 -- the LAST of
//     the box's own 18 text columns, not the column after them: measured
//     directly off the tilemap, frames/05-oak_speech_text1_p1.tilemap.json's
//     map9C00 row 16 reads `EE` at index 18 and the plain border glyph `7C`
//     at index 19, correcting the task's own "col 19") blinks only once
//     ready(): on 33-36 frames, off 36,
//     a free-running ~69-frame cycle measured with zero button presses so
//     nothing was interrupting it. The "on" span's own imprecision is the
//     cycle already running from when the page went up, not from when it
//     first becomes visible, so this reproduces it as one continuous
//     34-on/36-off cycle timed from the page's own first frame; the first
//     visible "on" span after ready() lands wherever that cycle already is,
//     the same source of the measured 33-36 spread.

import type { GbCanvas, GbFont } from "./GbCanvas";
import { TILE } from "./GbCanvas";

/** Measured once, constant for every text box in the intro. */
export const BOX_TX: number = 0;
export const BOX_TY: number = 12;
export const BOX_TW: number = 20;
export const BOX_TH: number = 6;
const LINE1_ROW: number = 14;
const LINE2_ROW: number = 16;
const TEXT_COL: number = 1;
const LINE_WIDTH: number = 18;

const ARROW_COL: number = 18;
const ARROW_ROW: number = 16;
const CODE_ARROW: number = 0xee;

/** Every hard clear measured in INTRO.md is exactly this many frames. */
export const HARD_CLEAR_FRAMES: number = 17;
/** INTRO.md: "on for 33-36 frames, off for 36 frames" -- see the note above. */
export const ARROW_ON_FRAMES: number = 34;
export const ARROW_OFF_FRAMES: number = 36;
const ARROW_CYCLE_FRAMES: number = ARROW_ON_FRAMES + ARROW_OFF_FRAMES;

const STATE_TYPING: string = "typing";
const STATE_CLEARING: string = "clearing";

export class CanvasTextBox {
  private textSpeed: number;
  private pages: string[][] = [];
  private page: number = 0;
  private state: string = STATE_TYPING;
  /** Frames since the current page's typing began, or since a clear began. */
  private frame: number = 0;
  /** The line a `cont` scroll carried up; already fully on screen, not retyped. */
  private carriedLine: string = null;
  private done: boolean = false;

  /** `textSpeed`: frames per printed character (PlayState's TEXT_SPEED_*). */
  constructor(textSpeed: number) {
    this.textSpeed = textSpeed > 0 ? textSpeed : 3;
  }

  /** A fresh text: `pages` exactly as Dialogue.paginate() returns its lines. */
  show(pages: string[][]): void {
    this.pages = pages && pages.length > 0 ? pages : [[]];
    this.page = 0;
    this.carriedLine = null;
    this.frame = 0;
    this.state = STATE_TYPING;
    this.done = false;
  }

  isOpen(): boolean {
    return !this.done;
  }

  /** 0-based index of the page currently showing, for a test or a caller. */
  pageIndex(): number {
    return this.page;
  }

  private newLetters(): number {
    if (this.pages.length === 0) {
      return 0;
    }
    const page = this.pages[this.page];
    const prior = this.page > 0 ? this.pages[this.page - 1] : null;
    let letters = 0;
    for (let i = 0; i < page.length; i++) {
      const carried = i === 0 && prior !== null && page.length > 1 &&
        prior.length > 0 && prior[prior.length - 1] === page[0];
      if (!carried) {
        letters += page[i].length;
      }
    }
    return letters;
  }

  /** paginate()'s own cont rule: the next page's first line IS this page's last. */
  private isContScroll(fromIndex: number, toIndex: number): boolean {
    if (fromIndex < 0 || toIndex >= this.pages.length) {
      return false;
    }
    const prior = this.pages[fromIndex];
    const next = this.pages[toIndex];
    return prior.length > 0 && next.length > 0 &&
      prior[prior.length - 1] === next[0];
  }

  /** Host.ts's textReady(), reproduced exactly: N*speed+1 frames after the page went up. */
  ready(): boolean {
    if (this.state === STATE_CLEARING) {
      return false;
    }
    const letters = Math.max(this.newLetters(), 1);
    return this.frame >= letters * this.textSpeed + 1;
  }

  /** True while the box is between pages -- interior blank, border still up. */
  isClearing(): boolean {
    return this.state === STATE_CLEARING;
  }

  /** The blink arrow's own visibility this frame; only ever true once ready(). */
  arrowVisible(): boolean {
    if (!this.ready()) {
      return false;
    }
    return this.frame % ARROW_CYCLE_FRAMES < ARROW_ON_FRAMES;
  }

  /** Moves to the next page (a hard clear first if this was not a cont scroll), or closes. */
  ack(): void {
    if (!this.ready()) {
      return;
    }
    const next = this.page + 1;
    if (next >= this.pages.length) {
      this.done = true;
      return;
    }
    const cont = this.isContScroll(this.page, next);
    this.carriedLine = cont ? this.pages[this.page][this.pages[this.page].length - 1] : null;
    this.page = next;
    this.frame = 0;
    this.state = cont ? STATE_TYPING : STATE_CLEARING;
  }

  /**
   * Finishes typing this page at once. Returns whether anything was skipped.
   *
   * Joshua asked for this on 7 September, to raise the pace: a player who has
   * already read the line should not have to watch it arrive. It is a
   * DELIBERATE divergence from the cartridge, which ignores A and B until a
   * page has finished printing (measured, tools/oracle, 6 September) -- so it
   * belongs to the diorama's own box and not to GAME BOY mode, whose whole
   * claim is that it matches PyBoy frame for frame.
   *
   * It moves the frame counter to where ready() lands rather than setting a
   * flag of its own. The arrow, the paging and visibleLines() are all written
   * against that counter already, so they carry on from a state they know how
   * to be in instead of a new one none of them has been taught.
   *
   * The return value matters at the call site: it separates "that press
   * hurried the text" from "the text was already up, so that press is the
   * acknowledgement". Without it one press would do both and every page would
   * be skipped the instant it appeared.
   */
  hurry(): boolean {
    if (this.done || this.pages.length === 0) {
      return false;
    }
    if (this.state === STATE_CLEARING) {
      // Mid-clear the box is blank between two pages. Finishing the clear here
      // and filling the page in one press is what a hurried reader means by it.
      this.state = STATE_TYPING;
      this.frame = 0;
    } else if (this.ready()) {
      return false;
    }
    this.frame = Math.max(this.newLetters(), 1) * this.textSpeed + 1;
    return true;
  }

  step(frames: number): void {
    if (this.done || this.pages.length === 0) {
      return;
    }
    this.frame += frames;
    if (this.state === STATE_CLEARING && this.frame >= HARD_CLEAR_FRAMES) {
      this.frame -= HARD_CLEAR_FRAMES;
      this.state = STATE_TYPING;
    }
  }

  /** [line1, line2] exactly as typed so far, for a test to inspect without reading pixels. */
  visibleLines(): string[] {
    if (this.pages.length === 0 || this.state === STATE_CLEARING) {
      return ["", ""];
    }
    const page = this.pages[this.page];
    const typed = Math.min(Math.floor(this.frame / this.textSpeed), this.newLetters());
    if (this.carriedLine !== null) {
      const line2Full = page.length > 1 ? page[1] : "";
      return [this.carriedLine, line2Full.substring(0, typed)];
    }
    const line1Full = page.length > 0 ? page[0] : "";
    const line2Full = page.length > 1 ? page[1] : "";
    if (typed <= line1Full.length) {
      return [line1Full.substring(0, typed), ""];
    }
    return [line1Full, line2Full.substring(0, typed - line1Full.length)];
  }

  paint(canvas: GbCanvas, font: GbFont): void {
    if (this.pages.length === 0) {
      return;
    }
    font.box(canvas, BOX_TX, BOX_TY, BOX_TW, BOX_TH);
    if (this.state === STATE_CLEARING) {
      return;
    }
    const lines = this.visibleLines();
    font.text(canvas, lines[0].substring(0, LINE_WIDTH), TEXT_COL * TILE, LINE1_ROW * TILE);
    font.text(canvas, lines[1].substring(0, LINE_WIDTH), TEXT_COL * TILE, LINE2_ROW * TILE);
    if (this.arrowVisible()) {
      font.code(canvas, CODE_ARROW, ARROW_COL * TILE, ARROW_ROW * TILE);
    }
  }
}
