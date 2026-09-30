// The SAFARI ZONE: the gate, the clock, and the two things you throw.
//
// Read out of the cartridge: the gate's script is bank $1D at $524E..$5358,
// and the battle half is bank $03 at $5F52 (BAIT) and $5F67 (ROCK), bank $01
// at $4277 (what the POKeMON does on its turn) and bank $0F at $417A (whether
// it runs). The extraction carries none of it.
//
// What the gate does, in its own order ($52CE):
//
//   "Would you like to join the hunt?"   no  -> "Please come again!"
//   ¥500, and it says so if you have not got it
//   thirty SAFARI BALLs        ($5322, wNumSafariBalls = $1E)
//   five hundred and two steps ($5327, wSafariSteps = $01F6)
//
// and when the steps run out the PA calls you back to the gate, takes the
// balls off you and puts you outside ($525C..$527D).

import type { ScriptCommand } from "./ScriptVM";

/** What a day's hunting costs. */
export const SAFARI_FEE: number = 500;

/** Balls handed over at the desk ($5322). */
export const SAFARI_BALLS: number = 30;

/**
 * Steps bought ($5327: $01F6). Five hundred and two, not five hundred: the
 * two extra are the steps out of the gate and back into it.
 */
export const SAFARI_STEPS: number = 0x01f6;

/** The flag that says a hunt is running, rather than a bit of $D790. */
export const EVENT_IN_SAFARI: string = "EVENT_IN_SAFARI_ZONE";
/** Set when the clock runs out, read by the gate on the next entry. */
export const EVENT_SAFARI_OVER: string = "EVENT_SAFARI_GAME_OVER";

export const MAP_SAFARI_GATE: string = "SAFARI_ZONE_GATE";

export const TEXT_JOIN: string = "_SafariZoneGateSafariZoneWorker1WouldYouLikeToJoinText";
export const TEXT_FEE: string = "_SafariZoneGateSafariZoneWorker1ThatllBe500PleaseText";
export const TEXT_POOR: string = "_SafariZoneGateSafariZoneWorker1NotEnoughMoneyText";
export const TEXT_COME_AGAIN: string = "_SafariZoneGateSafariZoneWorker1PleaseComeAgainText";
export const TEXT_GOOD_LUCK: string = "_SafariZoneGateSafariZoneWorker1GoodLuckText";
export const TEXT_LEAVING_EARLY: string = "_SafariZoneGateSafariZoneWorker1LeavingEarlyText";
export const TEXT_RETURN_BALLS: string = "_SafariZoneGateSafariZoneWorker1ReturnSafariBallsText";
export const TEXT_GOOD_HAUL: string = "_SafariZoneGateSafariZoneWorker1GoodHaulComeAgainText";
export const TEXT_PA: string = "_SafariZoneGateSafariZoneWorker1CallYouOnThePAText";
export const TEXT_EATING: string = "_SafariZoneEatingText";
export const TEXT_ANGRY: string = "_SafariZoneAngryText";
export const TEXT_THREW_BAIT: string = "_ThrewBaitText";
export const TEXT_THREW_ROCK: string = "_ThrewRockText";
export const TEXT_OUT_OF_BALLS: string = "_OutOfSafariBallsText";

/** Whether the clock runs on this map: every Zone map, never the gate. */
export function inSafariZone(mapId: string): boolean {
  return mapId.indexOf("SAFARI_ZONE_") === 0 && mapId !== MAP_SAFARI_GATE;
}

/**
 * The desk, as the VM runs it.
 *
 * A step onto the counter row rather than a word with the attendant: on the
 * cartridge the gate's own script stops you ($52CE is reached by walking in,
 * not by pressing A), and the two attendants stand behind counters where a
 * press cannot reach them anyway.
 */
export function safariJoinScript(): ScriptCommand[] {
  return [
    { op: "ask", textId: TEXT_JOIN },
    { op: "jump_if_false", to: "declined" },
    { op: "check_money", amount: SAFARI_FEE },
    { op: "jump_if_false", to: "poor" },
    { op: "take_money", amount: SAFARI_FEE },
    { op: "show_text", textId: TEXT_FEE },
    { op: "call", routine: "safari_start" },
    { op: "show_text", textId: TEXT_GOOD_LUCK },
    { op: "jump", to: "end" },
    { op: "label", name: "poor" },
    { op: "show_text", textId: TEXT_POOR },
    { op: "move_player", direction: "down", steps: 1 },
    { op: "jump", to: "end" },
    { op: "label", name: "declined" },
    { op: "show_text", textId: TEXT_COME_AGAIN },
    { op: "move_player", direction: "down", steps: 1 },
  ] as ScriptCommand[];
}

/**
 * Walking back into the gate with time still on the clock ($5240's branch).
 *
 * No is no: the hunt goes on and the player is put back through the door.
 */
export function safariLeaveScript(): ScriptCommand[] {
  return [
    { op: "ask", textId: TEXT_LEAVING_EARLY },
    { op: "jump_if_false", to: "staying" },
    { op: "show_text", textId: TEXT_RETURN_BALLS },
    { op: "call", routine: "safari_end" },
    { op: "show_text", textId: TEXT_GOOD_HAUL },
    { op: "jump", to: "end" },
    { op: "label", name: "staying" },
    { op: "move_player", direction: "up", steps: 1 },
  ] as ScriptCommand[];
}

/**
 * The clock running out ($525C): the PA, the balls back, and out of the door.
 *
 * Run on ENTERING the gate, because that is where the cartridge puts the
 * player before it says any of it.
 */
export function safariOverScript(): ScriptCommand[] {
  return [
    { op: "show_text", textId: TEXT_PA },
    { op: "call", routine: "safari_end" },
    { op: "move_player", direction: "down", steps: 3 },
  ] as ScriptCommand[];
}

// -- the battle half --------------------------------------------------------

/** BAIT halves the catch rate ($5F5B, `srl [hl]`). */
export function baitCatchRate(rate: number): number {
  return Math.floor((rate < 0 ? 0 : rate) / 2);
}

/** A ROCK doubles it, and 255 is as far as a byte goes ($5F70). */
export function rockCatchRate(rate: number): number {
  const doubled = (rate < 0 ? 0 : rate) * 2;
  return doubled > 255 ? 255 : doubled;
}

/** How many turns of eating or sulking one throw buys: 1 to 5 ($5F89). */
export function safariTurns(roll: number): number {
  const byte = (roll < 0 ? 0 : roll > 255 ? 255 : Math.floor(roll)) & 0x07;
  // The cartridge re-rolls 5, 6 and 7 rather than folding them in.
  return byte >= 5 ? -1 : byte + 1;
}

/** Adding turns to a counter, capped at a byte ($5F94). */
export function addTurns(counter: number, turns: number): number {
  const sum = counter + turns;
  return sum > 255 ? 255 : sum;
}

/**
 * Whether the POKeMON bolts this turn ($4182).
 *
 * Twice its base SPEED is the chance in 256; eating quarters it, sulking
 * doubles it, and anything at or above 128 speed is gone whatever you threw.
 */
export function safariEscapes(speed: number, eating: number, angry: number,
                              roll: number): boolean {
  let b = speed * 2;
  if (b > 255) {
    return true;
  }
  if (eating > 0) {
    b = b >> 2;
  }
  if (angry > 0) {
    b = b * 2;
    if (b > 255) {
      b = 255;
    }
  }
  const r = roll < 0 ? 0 : roll > 255 ? 255 : Math.floor(roll);
  return r < b;
}

/**
 * What the POKeMON is doing this turn, and what is left of it ($4277).
 *
 * Returns [textId, eating, angry, restoreRate]: eating is spent first and
 * sulking only when there is none, and the last sulking turn hands the catch
 * rate back to the species' own.
 */
export function safariTurnText(eating: number, angry: number): any {
  if (eating > 0) {
    return { textId: TEXT_EATING, eating: eating - 1, angry: angry, restore: false };
  }
  if (angry > 0) {
    return { textId: TEXT_ANGRY, eating: eating, angry: angry - 1, restore: angry - 1 === 0 };
  }
  return { textId: "", eating: eating, angry: angry, restore: false };
}
