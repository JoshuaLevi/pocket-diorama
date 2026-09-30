// The GAME CORNER's thirty-six slot machines.
//
// Everything here was read out of bank $0D of the cartridge, because the
// extraction stops at the pictures: it carries the three reel strips
// (`field.slotWheels`), the six symbols (`field.slotSymbols`) and where the
// machines stand (`field.slotMachines`), but not one line of what the machine
// DOES. The payouts, the two thresholds and the nudging below are the bank's
// own, at $7300..$78B0.
//
// The shape of a round, in the cartridge's order:
//
//   $730E  a machine is a hidden object read from the cell below it, facing
//          up. No COIN CASE and it says so; no coins and it says so.
//   $7395  "Bet how many coins?" -- three rows, x3 / x2 / x1, and the bet is
//          3 minus the row. Not enough coins asks again.
//   $7480  the machine picks its MOOD for this round, once, before a reel
//          turns. That is the whole of the rigging, and it is the reason a
//          reel can visibly slip off a line of sevens.
//   $74AD  the reels turn; A stops the next one, but not while the one
//          before it is still slipping.
//   $7588  the lines are read, and a win the mood does not allow is nudged
//          away; a mood that DOES allow one nudges the third reel up to
//          three times looking for it.
//   $743B  "One more go?", until the coins run out.
//
// The strips are 15 symbols long. `field.slotWheels` lists 18 because the
// cartridge repeats the first three at the end so the three-symbol window can
// read past the join ($7878 wraps the index at 30 = 15 x 2).

import type { WorldBundle } from "./../../world/WorldData";

/** The six symbols, in the order the cartridge's own tables use. */
export const SLOT_SEVEN: string = "7";
export const SLOT_BAR: string = "BAR";
export const SLOT_CHERRY: string = "CHERRY";

/** A strip is 15 symbols; the extraction lists 18 with the first three repeated. */
export const SLOT_REEL_LENGTH: number = 15;

/** Rows visible in one reel's window. */
export const SLOT_WINDOW: number = 3;

export const TEXT_PLAY: string = "_PlaySlotMachineText";
export const TEXT_BET: string = "_BetHowManySlotMachineText";
export const TEXT_START: string = "_StartSlotMachineText";
export const TEXT_NOT_ENOUGH: string = "_NotEnoughCoinsSlotMachineText";
export const TEXT_OUT_OF_COINS: string = "_OutOfCoinsSlotMachineText";
export const TEXT_ONE_MORE: string = "_OneMoreGoSlotMachineText";
export const TEXT_LINED_UP: string = "_LinedUpText";
export const TEXT_NOT_THIS_TIME: string = "_NotThisTimeText";
export const TEXT_NO_COINS: string = "_GameCornerNoCoinsText";
export const TEXT_NO_CASE: string = "_GameCornerOopsForgotCoinCaseText";
export const TEXT_OUT_OF_ORDER: string = "_GameCornerOutOfOrderText";
export const TEXT_OUT_TO_LUNCH: string = "_GameCornerOutToLunchText";
export const TEXT_SOMEONES_KEYS: string = "_GameCornerSomeonesKeysText";

/** SFX_SLOTS_STOP as a reel lands; the jingles a win plays. */
export const SOUND_REEL_STOP: string = "Slots_Stop_Wheel";
export const SOUND_NEW_GAME: string = "Slots_New_Spin";
export const SOUND_BAR_WIN: string = "Get_Item2";
export const SOUND_SEVEN_WIN: string = "Get_Item1";

/**
 * What three of a kind pays, in coins ($7678 SlotRewardPointers and the four
 * routines it names: $7702, $76F3, $76D7, $76E5).
 */
export function slotPayout(symbol: string): number {
  if (symbol === SLOT_SEVEN) {
    return 300;
  }
  if (symbol === SLOT_BAR) {
    return 100;
  }
  if (symbol === SLOT_CHERRY) {
    return 8;
  }
  if (symbol === "") {
    return 0;
  }
  // FISH, BIRD and MOUSE share one routine and one price.
  return 15;
}

/** How many times the screen flashes for a win: $7702/$76F3/$76D7/$76E5's b. */
export function slotFlashes(symbol: string): number {
  if (symbol === SLOT_SEVEN) {
    return 20;
  }
  if (symbol === SLOT_BAR) {
    return 8;
  }
  if (symbol === SLOT_CHERRY) {
    return 2;
  }
  return 4;
}

/** The three strips, or null when the bundle carries no slot data. */
export function slotWheels(bundle: WorldBundle): string[][] {
  const field: any = bundle ? (bundle as any).field : null;
  const wheels = field ? field.slotWheels : null;
  return wheels && wheels.length === 3 ? wheels : null;
}

/**
 * The three symbols one reel shows, BOTTOM first.
 *
 * The cartridge's window draws the strip from the bottom up, so the byte at
 * the reel's own index is the bottom row and the payline order everywhere
 * below is bottom / middle / top.
 */
export function slotFaces(wheel: string[], position: number): string[] {
  const p = ((position % SLOT_REEL_LENGTH) + SLOT_REEL_LENGTH) % SLOT_REEL_LENGTH;
  return [wheel[p], wheel[p + 1], wheel[p + 2]];
}

/**
 * The lines a bet buys, in the order $7588 reads them.
 *
 * Each line is three [reel, row] pairs with row 0 = bottom, 1 = middle,
 * 2 = top. One coin buys the middle row ($75CF); two add the top and bottom
 * ($75B3); three add both diagonals ($7596).
 */
export function slotLines(bet: number): number[][][] {
  const middle = [[0, 1], [1, 1], [2, 1]];
  const top = [[0, 2], [1, 2], [2, 2]];
  const bottom = [[0, 0], [1, 0], [2, 0]];
  const upward = [[0, 0], [1, 1], [2, 2]];
  const downward = [[0, 2], [1, 1], [2, 0]];
  if (bet >= 3) {
    return [upward, downward, top, bottom, middle];
  }
  if (bet === 2) {
    return [top, bottom, middle];
  }
  return [middle];
}

/**
 * The symbol lined up on the first paying line, or "" when none is.
 *
 * `faces[reel][row]` is the grid as `slotFaces` builds it.
 */
export function slotMatch(faces: string[][], bet: number): string {
  const lines = slotLines(bet);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const first = faces[line[0][0]][line[0][1]];
    if (first === faces[line[1][0]][line[1][1]] &&
        first === faces[line[2][0]][line[2][1]]) {
      return first;
    }
  }
  return "";
}

/**
 * The machine standing on a cell, or null.
 *
 * `state` is the cartridge's own: "ok", or one of the three that are never
 * played -- the broken one, the reserved one and the one with someone's keys
 * on the stool.
 */
export function slotMachineAt(bundle: WorldBundle, mapId: string,
                              x: number, y: number): any {
  const field: any = bundle ? (bundle as any).field : null;
  const table = field ? field.slotMachines : null;
  const rows = table ? table[mapId] : null;
  if (!rows) {
    return null;
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].x === x && rows[i].y === y) {
      return { state: rows[i].state, index: i, x: x, y: y };
    }
  }
  return null;
}

/** Whether a map has any slot machines at all. */
export function hasSlotMachines(bundle: WorldBundle, mapId: string): boolean {
  const field: any = bundle ? (bundle as any).field : null;
  const table = field ? field.slotMachines : null;
  const rows = table ? table[mapId] : null;
  return rows ? rows.length > 0 : false;
}

/** What a machine that cannot be played says. */
export function slotStateText(state: string): string {
  if (state === "out_of_order") {
    return TEXT_OUT_OF_ORDER;
  }
  if (state === "out_to_lunch") {
    return TEXT_OUT_TO_LUNCH;
  }
  if (state === "keys") {
    return TEXT_SOMEONES_KEYS;
  }
  return "";
}

// -- the mood ---------------------------------------------------------------
//
// $7480, once per round. Two bits live in $CD4C: bit 7 lets a line of SEVENs
// or BARs stand, bit 6 lets the other four stand, and neither means the third
// reel is nudged off whatever it lands on.

export const MOOD_NONE: number = 0;
export const MOOD_LOW: number = 0x40;
export const MOOD_HIGH: number = 0x80;

/** Every machine but one answers 253; the lucky one answers 250 ($7E54/$7E58). */
export const CHANCE_ORDINARY: number = 0xfd;
export const CHANCE_LUCKY: number = 0xfa;

/** Above this a round is generous even on an ordinary machine ($7499). */
export const CHANCE_LOW: number = 0xd2;

/** How many low wins a streak lasts once one starts ($74A4). */
export const STREAK_LENGTH: number = 0x3c;

/** One machine in the room is the lucky one, re-picked on every entry ($4BD7, bank $12). */
export function luckyMachine(roll: number): number {
  const r = roll < 7 ? 8 : roll;
  return r >> 3;
}

/**
 * The mood for one round, and the streak counter it leaves behind.
 *
 * `streak` is the cartridge's $D096: while it is not zero every round is
 * generous, and only a LOW win spends one of it. It is cleared when the
 * player walks away from the machine, not when the room is left.
 */
export function slotMood(mood: number, streak: number, chance: number,
                         roll: number): number[] {
  if ((mood & MOOD_HIGH) !== 0) {
    return [mood, streak];
  }
  if (streak !== 0) {
    return [MOOD_LOW, streak];
  }
  if (roll === 0) {
    return [MOOD_NONE, STREAK_LENGTH];
  }
  if (chance < roll) {
    return [MOOD_HIGH, streak];
  }
  if (CHANCE_LOW < roll) {
    return [MOOD_LOW, streak];
  }
  return [MOOD_NONE, streak];
}

/** Whether a line of `symbol` is allowed to stand ($7604..$7612). */
export function slotAllows(mood: number, symbol: string): boolean {
  if ((mood & MOOD_HIGH) !== 0) {
    return true;
  }
  if ((mood & MOOD_LOW) === 0) {
    return false;
  }
  // Bit 6 alone pays the four cheap symbols and nudges a SEVEN or a BAR away.
  return symbol !== SLOT_SEVEN && symbol !== SLOT_BAR;
}

/** What a win does to the mood and the streak ($7702, $76F3, $76D7, $76E5). */
export function slotAfterWin(symbol: string, mood: number, streak: number,
                             roll: number): number[] {
  if (symbol === SLOT_SEVEN) {
    // Half the time the machine stays in the mood that paid out.
    return [roll < 0x80 ? mood : MOOD_NONE, 0];
  }
  if (symbol === SLOT_BAR) {
    return [MOOD_NONE, streak];
  }
  return [mood, streak > 0 ? streak - 1 : 0];
}

// -- the reels themselves ---------------------------------------------------

/**
 * Whether the first reel has to slip one more symbol ($752C).
 *
 * In an ordinary round it will not leave a CHERRY in the middle. In a
 * SEVEN-and-BAR round it will not leave a SEVEN on top: one more symbol and
 * that SEVEN is on the middle line.
 */
export function slotSlipReel1(faces: string[], mood: number): boolean {
  if ((mood & MOOD_HIGH) !== 0) {
    return faces[2] === SLOT_SEVEN;
  }
  return faces[1] === SLOT_CHERRY;
}

/**
 * Whether the second reel has to slip one more symbol ($7552).
 *
 * It stops as soon as it shares a symbol with the first reel on one of the
 * five lines' first two places -- and in a SEVEN-and-BAR round only when that
 * shared symbol is a SEVEN or a BAR.
 */
export function slotSlipReel2(first: string[], second: string[], mood: number): boolean {
  const shared = slotPair(first, second);
  if ((mood & MOOD_HIGH) !== 0) {
    const symbol = shared === "" ? second[0] : shared;
    return symbol !== SLOT_SEVEN && symbol !== SLOT_BAR;
  }
  return shared === "";
}

/**
 * The symbol the first two reels already share on a line, or "" ($756E).
 *
 * The five pairs are the five paylines' first two places, in the cartridge's
 * order: bottom/bottom, bottom/middle, middle/middle, top/middle, top/top.
 */
export function slotPair(first: string[], second: string[]): string {
  if (second[0] === first[0]) {
    return first[0];
  }
  if (second[1] === first[0]) {
    return first[0];
  }
  if (second[1] === first[1]) {
    return first[1];
  }
  if (second[1] === first[2]) {
    return first[2];
  }
  if (second[2] === first[2]) {
    return first[2];
  }
  return "";
}

/** How many nudges the third reel gets while hunting for a win ($740D, $75E4). */
export const SLOT_NUDGES: number = 3;

/** How many half-steps of slip the first two reels get ($740D). */
export const SLOT_SLIP: number = 4;
