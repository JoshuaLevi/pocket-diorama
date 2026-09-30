// What the PC's screens say, and how their rows read.
//
// The labels are the cartridge's own, so a line is looked up rather than
// written: every string a PcController shows comes from the bundle's text
// table by one of these ids. Split out of PcController.ts to keep that file
// about the state machine and this one about the words.

import type { PlayState } from "./PlayState";

/** Columns a row may fill, cursor column included. */
export const PC_COLUMNS: number = 18;
/** Rows visible at once. A longer list scrolls. */
export const PC_ROWS: number = 6;

/** The lines this screen speaks, as the cartridge labels them. */
export const TEXT_TURNED_ON: string = "_TurnedOnPC1Text";
export const TEXT_ACCESSED_SOMEONES: string = "_AccessedSomeonesPCText";
export const TEXT_ACCESSED_BILLS: string = "_AccessedBillsPCText";
export const TEXT_ACCESSED_MY_PC: string = "_AccessedMyPCText";
export const TEXT_ACCESSED_OAKS: string = "_AccessedOaksPCText";
export const TEXT_CLOSED_OAKS: string = "_ClosedOaksPCText";
export const TEXT_GET_DEX_RATED: string = "_GetDexRatedText";
export const TEXT_DEX_RATING: string = "_DexRatingText";
export const TEXT_WHAT: string = "_WhatText";
export const TEXT_MON_TAKEN_OUT: string = "_MonIsTakenOutText";
export const TEXT_MON_STORED: string = "_MonWasStoredText";
export const TEXT_RELEASE_WHICH: string = "_ReleaseWhichMonText";
export const TEXT_ONCE_RELEASED: string = "_OnceReleasedText";
export const TEXT_MON_RELEASED: string = "_MonWasReleasedText";
export const TEXT_DEPOSIT_WHICH_MON: string = "_DepositWhichMonText";
export const TEXT_CHANGE_BOX_SAVES: string = "_WhenYouChangeBoxText";
export const TEXT_CHOOSE_A_BOX: string = "_ChooseABoxText";

export function fit(text: string, n: number): string {
  if (text.length >= n) {
    return text.substring(0, n);
  }
  let out = text;
  while (out.length < n) {
    out = out + " ";
  }
  return out;
}

/** A count as the quantity window prints it: two digits, zero-padded. */
export function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

/** "POTION            × 1" */
export function itemRow(name: string, count: number): string {
  const tail = "× " + count;
  return fit(name, PC_COLUMNS - 1 - tail.length) + tail;
}

/** "CHARMANDER      L 6" */
export function monRow(mon: any): string {
  const tail = "L" + (mon && mon.level !== undefined ? mon.level : "?");
  const name = mon && mon.name ? mon.name : "?";
  return fit(name, PC_COLUMNS - 1 - tail.length) + tail;
}

export function ownedCount(state: PlayState): number {
  let n = 0;
  for (let i = 0; state.dexOwned && i < state.dexOwned.length; i++) {
    if (state.dexOwned[i]) {
      n++;
    }
  }
  return n;
}

/**
 * Oak's verdict, by band of ten owned, as the cartridge's rating table names
 * them: _DexRatingText_Own0To9 up to _DexRatingText_Own150To151.
 */
export function ratingLabel(owned: number): string {
  if (owned >= 150) {
    return "_DexRatingText_Own150To151";
  }
  const low = Math.floor(owned / 10) * 10;
  return "_DexRatingText_Own" + low + "To" + (low + 9);
}

/** The refusal Storage.ts hands back for an empty box; the box menu says it too. */
export const TEXT_NO_MON: string = "_NoMonText";
