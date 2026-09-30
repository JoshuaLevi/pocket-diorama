// ETHER, MAX ETHER, ELIXER, MAX ELIXER and PP UP (ItemUsePPRestore / ItemUsePPUp,
// engine/items/item_effects.asm).
//
// Fourteen of them lie about Kanto in balls and under rocks, and until 20
// September every one did nothing: the bag closed without a word, in a battle
// and out of it, because they need a second question -- which technique? --
// and there was no menu to ask it.
//
//   ETHER        ten PP to one move        MAX ETHER    one move to its maximum
//   ELIXER       ten PP to every move      MAX ELIXER   every move to its maximum
//   PP UP        the move's maximum goes up by a fifth of the move's own base
//                PP (seven at most), three times; the current PP rises with it
//
// A restore that would restore nothing, and a PP UP on a move that has had
// three, is refused and the item stays in the bag. Pure: every function hands
// back a new Pokemon and reads the old one.

import type { BattleMon, MoveSlot } from "./types";
import { cloneMon } from "./Stats";

export const ETHER: string = "ETHER";
export const MAX_ETHER: string = "MAX_ETHER";
export const ELIXER: string = "ELIXER";
export const MAX_ELIXER: string = "MAX_ELIXER";
export const PP_UP: string = "PP_UP";

/** What an ETHER and an ELIXER give a move. */
export const PP_RESTORE_AMOUNT: number = 10;
/** A PP UP may be used on one move this many times. */
export const PP_UP_LIMIT: number = 3;
/**
 * AddBonusPP: a fifth of the base PP a time, but never eight -- the PP byte
 * keeps the PP UP count in its top two bits and has six left for the PP, so a
 * move of 40 gets seven a time and tops out at 61, not 64.
 */
export const PP_UP_STEP_MAX: number = 7;

/** What one PP UP adds to a move of this base PP. */
export function ppUpStep(basePp: number): number {
  const fifth = Math.floor(basePp / 5);
  return fifth > PP_UP_STEP_MAX ? PP_UP_STEP_MAX : fifth;
}

export const TEXT_PP_RESTORED: string = "_PPRestoredText";
export const TEXT_PP_INCREASED: string = "_PPIncreasedText";
export const TEXT_PP_MAXED_OUT: string = "_PPMaxedOutText";
export const TEXT_RESTORE_WHICH: string = "_RestorePPWhichTechniqueText";
export const TEXT_RAISE_WHICH: string = "_RaisePPWhichTechniqueText";

/** Any of the five. */
export function isPpItem(item: string): boolean {
  return item === ETHER || item === MAX_ETHER || item === ELIXER || item === MAX_ELIXER || item === PP_UP;
}

/** The three that ask "which technique?"; an ELIXER takes them all. */
export function ppItemNeedsMove(item: string): boolean {
  return item === ETHER || item === MAX_ETHER || item === PP_UP;
}

export interface PpOutcome {
  mon: BattleMon;
  /** The item did something and leaves the bag. */
  used: boolean;
  /** The line to say: restored, increased, maxed out -- or "" for "no effect". */
  textId: string;
  /** The move a PP UP line names, as an id; "" otherwise. */
  move: string;
}

function refusedPp(mon: BattleMon, textId: string, move: string): PpOutcome {
  return { mon: mon, used: false, textId: textId, move: move };
}

function restored(slot: MoveSlot, full: boolean): MoveSlot {
  const raised = full ? slot.maxPp : slot.pp + PP_RESTORE_AMOUNT;
  return { id: slot.id, pp: raised > slot.maxPp ? slot.maxPp : raised, maxPp: slot.maxPp };
}

/** ETHER and MAX ETHER on one move; ELIXER and MAX ELIXER on all of them. */
export function restorePp(mon: BattleMon, item: string, moveSlot: number): PpOutcome {
  const full = item === MAX_ETHER || item === MAX_ELIXER;
  const every = item === ELIXER || item === MAX_ELIXER;
  if (!every && (moveSlot < 0 || moveSlot >= mon.moves.length || mon.moves[moveSlot].id === "")) {
    return refusedPp(mon, "", "");
  }
  const fresh = cloneMon(mon);
  let changed = false;
  for (let i = 0; i < fresh.moves.length; i++) {
    const slot = fresh.moves[i];
    if (slot.id === "" || (!every && i !== moveSlot) || slot.pp >= slot.maxPp) {
      continue;
    }
    fresh.moves[i] = restored(slot, full);
    changed = true;
  }
  return changed
    ? { mon: fresh, used: true, textId: TEXT_PP_RESTORED, move: "" }
    : refusedPp(mon, "", "");
}

/** How many PP UPs a move has had, read back from its maximum. */
export function ppUpsUsed(basePp: number, maxPp: number): number {
  const step = ppUpStep(basePp);
  if (step <= 0 || maxPp <= basePp) {
    return 0;
  }
  const ups = Math.round((maxPp - basePp) / step);
  return ups > PP_UP_LIMIT ? PP_UP_LIMIT : ups;
}

/** PP UP on one move. */
export function raiseMaxPp(bundle: any, mon: BattleMon, moveSlot: number): PpOutcome {
  if (moveSlot < 0 || moveSlot >= mon.moves.length || mon.moves[moveSlot].id === "") {
    return refusedPp(mon, "", "");
  }
  const slot = mon.moves[moveSlot];
  const def = bundle.moves ? bundle.moves[slot.id] : null;
  if (!def) {
    return refusedPp(mon, "", "");
  }
  const gain = ppUpStep(def.pp);
  if (gain <= 0 || ppUpsUsed(def.pp, slot.maxPp) >= PP_UP_LIMIT) {
    return refusedPp(mon, TEXT_PP_MAXED_OUT, slot.id);
  }
  const fresh = cloneMon(mon);
  fresh.moves[moveSlot] = { id: slot.id, pp: slot.pp + gain, maxPp: slot.maxPp + gain };
  return { mon: fresh, used: true, textId: TEXT_PP_INCREASED, move: slot.id };
}

/** Whichever of the five it is. */
export function usePpItem(bundle: any, mon: BattleMon, item: string, moveSlot: number): PpOutcome {
  return item === PP_UP ? raiseMaxPp(bundle, mon, moveSlot) : restorePp(mon, item, moveSlot);
}
