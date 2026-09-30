// One sitting at a slot machine: the bet, the reels, the payout, and
// "One more go?" until the coins run out.
//
// Pure like ShopController and ChoiceController and for the same reason: a
// whole sitting has to be playable in a test. The lens paints `paint()` and
// feeds `step()` the buttons; the tables and the rigging live next door in
// script/Slots.ts, read out of bank $0D of the cartridge.
//
// The reels are modelled the way the cartridge does. A reel's position is a
// HALF-step index into a 15-symbol strip: even is a whole symbol framed in the
// window, odd is halfway between two. A reel can only settle on an even one,
// and the slip rules ($752C, $7552) push it on one more symbol when the
// machine does not like where it landed -- which is what it looks like when a
// line of sevens slides away under your thumb.

import type { WorldBundle } from "./../world/WorldData";
import type { PlayState } from "./PlayState";
import type { DPadState } from "./InputSource";
import { DPadEdge } from "./InputSource";
import type { GbCanvas, GbFont, ShadeImage } from "./screen/GbCanvas";
import { imageFromPacked, TILE } from "./screen/GbCanvas";
import {
  MOOD_HIGH, MOOD_LOW, SLOT_NUDGES, SLOT_REEL_LENGTH, SLOT_SLIP, SOUND_REEL_STOP,
  TEXT_BET, TEXT_LINED_UP, TEXT_NOT_ENOUGH, TEXT_NOT_THIS_TIME, TEXT_ONE_MORE,
  TEXT_OUT_OF_COINS, TEXT_START,
  slotAfterWin, slotAllows, slotFaces, slotMatch, slotMood, slotPayout,
  slotSlipReel1, slotSlipReel2, slotWheels,
} from "./script/Slots";

/** Nothing to report this frame. */
export const SLOTS_NONE: number = 0;
/** The player is done with the machine. */
export const SLOTS_CLOSED: number = 1;

/** One half-step of a reel, in seconds: the cartridge moves one per frame. */
export const SLOT_STEP_SECONDS: number = 1 / 60;

/** How long a win or a loss is left on screen before the next question. */
export const SLOT_HOLD_SECONDS: number = 0.8;

const PHASE_BET: number = 0;
const PHASE_SPIN: number = 1;
const PHASE_RESOLVE: number = 2;
const PHASE_RESULT: number = 3;
const PHASE_AGAIN: number = 4;
const PHASE_DONE: number = 5;

/** Where the three reels sit on the Game Boy screen, from the cartridge's OAM. */
const REEL_X: number[] = [40, 72, 104];
const WINDOW_TOP: number = 32;
const WINDOW_BOTTOM: number = 80;
/** The screen row the bottom symbol's top edge sits on when a reel is framed. */
const BOTTOM_SYMBOL_Y: number = 64;
const SYMBOL: number = 16;

/** charmap.asm's filled cursor arrow, the same one every menu uses. */
const CODE_CURSOR_ARROW: number = 0xed;

/** The message box: the world's own, at the bottom of the screen. */
const BOX_TX: number = 0;
const BOX_TY: number = 12;
const BOX_TW: number = 20;
const BOX_TH: number = 6;

/**
 * The bet menu, where the cartridge draws it ($73B4 sets wTopMenuItemY 12 and
 * wTopMenuItemX 15, and $73C8 borders five rows by four columns from row 11).
 */
const MENU_TX: number = 14;
const MENU_TY: number = 11;
const MENU_TW: number = 6;
const MENU_TH: number = 7;
const MENU_ROW_STEP: number = 2;

const MAX_COINS: number = 9999;
/** A reject loop cannot outlast one revolution of the third reel. */
const REJECT_CAP: number = SLOT_REEL_LENGTH;

/** Four digits with the leading zeros the cartridge's BCD printer keeps. */
function pad4(value: number): string {
  const n = value < 0 ? 0 : value > 9999 ? 9999 : Math.floor(value);
  let out = "" + n;
  while (out.length < 4) {
    out = "0" + out;
  }
  return out;
}

export class SlotController {
  private bundle: WorldBundle;
  private play: PlayState;
  private wheels: string[][];
  private random: () => number;
  private chance: number;

  private phase: number = PHASE_BET;
  private cursor: number = 0;
  private edge: DPadEdge = new DPadEdge();
  private message: string[] = null;
  private bet: number = 0;
  private mood: number = 0;
  private streak: number = 0;
  private won: string = "";
  private paid: number = 0;
  private hold: number = 0;
  private clock: number = 0;
  private version: number = 0;

  /** Half-step index per reel, 0..29; even means framed. */
  private at: number[] = [0, 0, 0];
  /** Reels the player has stopped, 0..3. */
  private stopped: number = 0;
  private slip: number[] = [0, 0, 0];
  private nudges: number = 0;
  /** Wins the mood refused in a row; one revolution of the third reel is the cap. */
  private rejects: number = 0;
  private sound: string = "";

  private symbols: ShadeImage = null;
  private frame: ShadeImage = null;
  private tilemap: any = null;
  private order: string[] = null;

  /**
   * `chance` is the machine's own seven-and-bar threshold: CHANCE_ORDINARY
   * for thirty-five of the thirty-six, CHANCE_LUCKY for whichever one the
   * room picked when the player walked in.
   */
  constructor(bundle: WorldBundle, play: PlayState, chance: number,
              random: () => number) {
    this.bundle = bundle;
    this.play = play;
    this.random = random;
    this.chance = chance;
    this.wheels = slotWheels(bundle);
    const field: any = bundle ? (bundle as any).field : null;
    const art = field ? field.slotArt : null;
    this.symbols = art && art.symbols ? imageFromPacked(art.symbols) : null;
    this.frame = art && art.frame ? imageFromPacked(art.frame) : null;
    const sheet = field ? field.slotSymbols : null;
    this.tilemap = sheet ? sheet.tilemap : null;
    this.order = sheet ? sheet.order : null;
    // Each reel starts wherever it stopped last; a fresh machine starts framed.
    this.message = this.linesFor(TEXT_BET);
  }

  isOpen(): boolean {
    return this.phase !== PHASE_DONE;
  }

  stateVersion(): number {
    return this.version;
  }

  /** The question, for the message box. */
  lines(): string[] {
    return this.message;
  }

  /** The menu under the question: the three bets, or YES/NO. */
  rows(): string[] {
    if (this.phase === PHASE_BET) {
      return ["×3", "×2", "×1"];
    }
    if (this.phase === PHASE_AGAIN) {
      return ["YES", "NO"];
    }
    return [];
  }

  cursorRow(): number {
    return this.cursor;
  }

  /** What the machine owes, once a line has paid. */
  payout(): number {
    return this.paid;
  }

  /** The symbol that lined up, or "". */
  lined(): string {
    return this.won;
  }

  coins(): number {
    return this.play.coins;
  }

  /** The mood this round was dealt, for a test to read: 0, MOOD_LOW or MOOD_HIGH. */
  moodNow(): number {
    return this.mood;
  }

  /** Rounds left in a generous streak, for a test to read. */
  streakNow(): number {
    return this.streak;
  }

  /** A sound to play once, taken by the reader. */
  takeSound(): string {
    const s = this.sound;
    this.sound = "";
    return s;
  }

  /** The three symbols one reel shows, bottom first; "" while it is between two. */
  faces(reel: number): string[] {
    if (!this.wheels || (this.at[reel] & 1) !== 0) {
      return ["", "", ""];
    }
    return slotFaces(this.wheels[reel], this.at[reel] >> 1);
  }

  private linesFor(textId: string): string[] {
    const text = this.bundle && (this.bundle as any).text
      ? (this.bundle as any).text[textId] : null;
    return text ? ("" + text).split("\n") : [textId];
  }

  private roll(): number {
    const r = this.random();
    const byte = Math.floor((typeof r === "number" && r >= 0 && r < 1 ? r : 0) * 256);
    return byte < 0 ? 0 : byte > 255 ? 255 : byte;
  }

  step(dpad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): number {
    if (this.phase === PHASE_DONE) {
      return SLOTS_CLOSED;
    }
    if (this.phase === PHASE_BET || this.phase === PHASE_AGAIN) {
      this.menu(dpad, pressedA, pressedB, dt);
      return this.phase === PHASE_DONE ? SLOTS_CLOSED : SLOTS_NONE;
    }
    if (this.phase === PHASE_RESULT) {
      this.hold -= dt;
      if (this.hold <= 0 || pressedA || pressedB) {
        this.afterResult();
      }
      return this.phase === PHASE_DONE ? SLOTS_CLOSED : SLOTS_NONE;
    }
    if (this.phase === PHASE_SPIN) {
      if (pressedA && this.stopped < 3 && this.canStop()) {
        this.stopped++;
        this.sound = SOUND_REEL_STOP;
        this.version++;
      }
      this.turn(dt);
      return SLOTS_NONE;
    }
    // PHASE_RESOLVE: the third reel is being nudged, one symbol at a time.
    this.turn(dt);
    return SLOTS_NONE;
  }

  /**
   * A press cannot stop the next reel while the one before it is still
   * slipping ($78A3): the machine finishes lying to you before it lets you
   * touch the next one.
   */
  private canStop(): boolean {
    if (this.stopped === 0) {
      return true;
    }
    return this.slip[this.stopped - 1] === 0;
  }

  private menu(dpad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): void {
    const rows = this.rows();
    const moved = this.edge.step(dpad, dt);
    if (moved === "up" && this.cursor > 0) {
      this.cursor--;
      this.version++;
    }
    if (moved === "down" && this.cursor < rows.length - 1) {
      this.cursor++;
      this.version++;
    }
    if (pressedB) {
      this.phase = PHASE_DONE;
      this.version++;
      return;
    }
    if (!pressedA) {
      return;
    }
    if (this.phase === PHASE_AGAIN) {
      if (this.cursor !== 0) {
        this.phase = PHASE_DONE;
      } else {
        this.askBet();
      }
      this.version++;
      return;
    }
    // The rows read x3 / x2 / x1, so the bet is three minus the row ($73E7).
    const bet = 3 - this.cursor;
    if (this.play.coins < bet) {
      this.message = this.linesFor(TEXT_NOT_ENOUGH);
      this.version++;
      return;
    }
    this.beginSpin(bet);
  }

  private askBet(): void {
    this.phase = PHASE_BET;
    this.cursor = 0;
    this.won = "";
    this.paid = 0;
    this.message = this.linesFor(TEXT_BET);
  }

  /** $7401..$7423: the coins go first, then the mood, then the reels turn. */
  private beginSpin(bet: number): void {
    this.bet = bet;
    this.play.coins = Math.max(0, this.play.coins - bet);
    const next = slotMood(this.mood, this.streak, this.chance, this.roll());
    this.mood = next[0];
    this.streak = next[1];
    this.slip = [SLOT_SLIP, SLOT_SLIP, SLOT_SLIP];
    this.nudges = SLOT_NUDGES + 1;
    this.stopped = 0;
    this.clock = 0;
    this.phase = PHASE_SPIN;
    this.message = this.linesFor(TEXT_START);
    this.version++;
  }

  /** One or more half-steps of the reels, at the cartridge's one-per-frame. */
  private turn(dt: number): void {
    this.clock += dt;
    let guard = 0;
    while (this.clock >= SLOT_STEP_SECONDS && this.phase !== PHASE_RESULT && guard < 240) {
      this.clock -= SLOT_STEP_SECONDS;
      guard++;
      this.tick();
    }
  }

  private tick(): void {
    if (this.phase === PHASE_RESOLVE) {
      this.advance(2);
      this.resolve();
      this.version++;
      return;
    }
    for (let reel = 0; reel < 3; reel++) {
      this.turnReel(reel);
    }
    this.version++;
    if (this.settled(0) && this.settled(1) && this.settled(2)) {
      this.phase = PHASE_RESOLVE;
      this.resolve();
    }
  }

  private settled(reel: number): boolean {
    return this.stopped > reel && (this.at[reel] & 1) === 0 && this.slip[reel] === 0;
  }

  /** $74DF, $74FB and $7517, one reel at a time. */
  private turnReel(reel: number): void {
    if (this.stopped <= reel || (this.at[reel] & 1) !== 0) {
      this.at[reel] = (this.at[reel] + 1) % (SLOT_REEL_LENGTH * 2);
      return;
    }
    if (this.slip[reel] === 0) {
      return;
    }
    this.slip[reel]--;
    if (this.wantsSlip(reel)) {
      this.at[reel] = (this.at[reel] + 1) % (SLOT_REEL_LENGTH * 2);
      return;
    }
    this.slip[reel] = 0;
  }

  private wantsSlip(reel: number): boolean {
    if (!this.wheels) {
      return false;
    }
    if (reel === 0) {
      return slotSlipReel1(this.faces(0), this.mood);
    }
    if (reel === 1) {
      return slotSlipReel2(this.faces(0), this.faces(1), this.mood);
    }
    // The third reel has no rule of its own; $7588 does its nudging.
    return false;
  }

  private advance(halfSteps: number): void {
    this.at[2] = (this.at[2] + halfSteps) % (SLOT_REEL_LENGTH * 2);
  }

  /**
   * $7588: read the lines, and decide whether what is there may stand.
   *
   * A win the mood forbids is nudged away, over and over; a mood that allows
   * one but sees nothing nudges three times looking for it. Either way the
   * third reel is the only one that moves, which is why it is the one that
   * always seems to betray you.
   */
  private resolve(): void {
    const grid = [this.faces(0), this.faces(1), this.faces(2)];
    const symbol = slotMatch(grid, this.bet);
    if (symbol !== "") {
      if (slotAllows(this.mood, symbol)) {
        this.win(symbol);
        return;
      }
      this.rejects++;
      if (this.rejects > REJECT_CAP) {
        this.lose();
      }
      return;
    }
    this.rejects = 0;
    if ((this.mood & (MOOD_LOW | MOOD_HIGH)) === 0) {
      this.lose();
      return;
    }
    this.nudges--;
    if (this.nudges <= 0) {
      this.lose();
    }
  }

  private win(symbol: string): void {
    const amount = slotPayout(symbol);
    this.won = symbol;
    this.paid = amount;
    this.play.coins = Math.min(MAX_COINS, this.play.coins + amount);
    const after = slotAfterWin(symbol, this.mood, this.streak, this.roll());
    this.mood = after[0];
    this.streak = after[1];
    const line = this.linesFor(TEXT_LINED_UP);
    const named: string[] = [];
    for (let i = 0; i < line.length; i++) {
      named.push(line[i].split("{RAM:wStringBuffer}").join("" + amount));
    }
    named[0] = symbol + named[0];
    this.message = named;
    this.rejects = 0;
    this.phase = PHASE_RESULT;
    this.hold = SLOT_HOLD_SECONDS;
    this.version++;
  }

  private lose(): void {
    this.won = "";
    this.paid = 0;
    this.message = this.linesFor(TEXT_NOT_THIS_TIME);
    this.rejects = 0;
    this.phase = PHASE_RESULT;
    this.hold = SLOT_HOLD_SECONDS;
    this.version++;
  }

  /** $7429: out of coins ends the sitting, otherwise "One more go?". */
  private afterResult(): void {
    if (this.play.coins <= 0) {
      this.message = this.linesFor(TEXT_OUT_OF_COINS);
      this.phase = PHASE_DONE;
      this.version++;
      return;
    }
    this.phase = PHASE_AGAIN;
    this.cursor = 0;
    this.message = this.linesFor(TEXT_ONE_MORE);
    this.version++;
  }

  // -- drawing ---------------------------------------------------------------

  /**
   * The machine, from the cartridge's own two sheets: the frame is the
   * tilemap `field.slotSymbols.tilemap` lays out over `slotArt.frame`, and
   * the symbols ride on top as sprites do.
   */
  paint(canvas: GbCanvas, font: GbFont): void {
    canvas.clear(0);
    this.paintFrame(canvas);
    for (let reel = 0; reel < 3; reel++) {
      this.paintReel(canvas, reel);
    }
    // The two counters the cartridge prints straight onto the frame's blank
    // second row: the purse at column 5 ($7754 writes to wTileMap+25) and what
    // this round has paid at column 11 ($775F, wTileMap+31).
    font.text(canvas, pad4(this.play.coins), 5 * TILE, TILE);
    font.text(canvas, pad4(this.paid), 11 * TILE, TILE);
    this.paintBox(canvas, font);
  }

  /** The message, and over its right-hand end the menu when there is one. */
  private paintBox(canvas: GbCanvas, font: GbFont): void {
    font.box(canvas, BOX_TX, BOX_TY, BOX_TW, BOX_TH);
    const lines = this.message ? this.message : [];
    for (let i = 0; i < lines.length && i < 2; i++) {
      font.text(canvas, lines[i], (BOX_TX + 1) * TILE, (BOX_TY + 1 + i * 2) * TILE);
    }
    const rows = this.rows();
    if (rows.length === 0) {
      return;
    }
    font.box(canvas, MENU_TX, MENU_TY, MENU_TW, MENU_TH);
    for (let i = 0; i < rows.length; i++) {
      const y = (MENU_TY + 1 + i * MENU_ROW_STEP) * TILE;
      font.text(canvas, rows[i], (MENU_TX + 2) * TILE, y);
      if (i === this.cursor) {
        font.code(canvas, CODE_CURSOR_ARROW, (MENU_TX + 1) * TILE, y);
      }
    }
  }

  private paintFrame(canvas: GbCanvas): void {
    if (!this.frame || !this.tilemap || !this.tilemap.tiles) {
      return;
    }
    const rows = this.tilemap.tiles;
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        canvas.tile(this.frame, row[x], x * TILE, y * TILE, false);
      }
    }
  }

  /**
   * One reel's window.
   *
   * A symbol's top edge sits at BOTTOM_SYMBOL_Y for the one at the reel's own
   * position and 16 pixels higher for each one above it, shifted by the reel's
   * half-step so a turning reel slides rather than jumps. Whatever falls
   * outside the window is cropped, which is the sprite window the cartridge
   * gets from its own six OAM rows.
   */
  private paintReel(canvas: GbCanvas, reel: number): void {
    if (!this.symbols || !this.wheels || !this.order) {
      return;
    }
    const wheel = this.wheels[reel];
    const at = this.at[reel];
    const base = at >> 1;
    const shift = (at & 1) * (SYMBOL / 2);
    for (let step = -1; step <= 3; step++) {
      const name = wheel[((base + step) % SLOT_REEL_LENGTH + SLOT_REEL_LENGTH) % SLOT_REEL_LENGTH];
      const index = this.order.indexOf(name);
      if (index < 0) {
        continue;
      }
      const top = BOTTOM_SYMBOL_Y - step * SYMBOL - shift;
      const clipTop = Math.max(WINDOW_TOP, top);
      const clipBottom = Math.min(WINDOW_BOTTOM, top + SYMBOL);
      if (clipBottom <= clipTop) {
        continue;
      }
      canvas.blitPart(this.symbols, index * SYMBOL, clipTop - top,
                      SYMBOL, clipBottom - clipTop, REEL_X[reel], clipTop, true);
    }
  }
}
