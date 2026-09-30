// The item PC: the store behind the bedroom terminal, and the bag's twin.
//
// Pure functions over the PlayState, like Storage.ts for the Pokemon box and
// PlayState's own bag helpers, so the PC screen and any test move an item the
// same way.
//
// Measured on the cartridge, 7 September, at the PC in Red's bedroom:
//
//   RED turned on the PC.        -> WITHDRAW ITEM / DEPOSIT ITEM / TOSS ITEM
//                                   / LOG OFF, under "What do you want to do?"
//   WITHDRAW ITEM                -> the PC's list ("POTION x 1", CANCEL) under
//                                   "What do you want to withdraw?", then
//                                   "How many?", then "Withdrew POTION."
//   TOSS ITEM                    -> the SAME list, not the bag's: a new game's
//                                   bag is empty and the screen offered the
//                                   POTION, which is in the PC. Then "How
//                                   many?", "Is it OK to toss POTION?" YES/NO.
//
// So WITHDRAW and TOSS read the PC's store and DEPOSIT reads the bag, which is
// the one thing about this screen that cannot be guessed from the labels.
//
// The refusals are the cartridge's lines, by label: an empty store, a full bag,
// a full store, and a key item that may be deposited but never thrown away.

import type { BagSlot, PlayState } from "./PlayState";
import { PC_ITEM_CAP } from "./PlayState";

/** The bag's own distinct-item limit, as giveItem enforces it. */
export const BAG_ITEM_CAP: number = 20;
/** What one slot may hold, on both sides. */
export const MAX_STACK: number = 99;

/** The prompts the three screens stand under. */
export const TEXT_WHAT_DO_YOU_WANT: string = "_WhatDoYouWantText";
export const TEXT_WHAT_TO_WITHDRAW: string = "_WhatToWithdrawText";
export const TEXT_WHAT_TO_DEPOSIT: string = "_WhatToDepositText";
export const TEXT_WHAT_TO_TOSS: string = "_WhatToTossText";
export const TEXT_HOW_MANY: string = "_DepositHowManyText";

/** What each move says when it works. */
export const TEXT_WITHDREW: string = "_WithdrewItemText";
export const TEXT_ITEM_STORED: string = "_ItemWasStoredText";
export const TEXT_IS_IT_OK_TO_TOSS: string = "_IsItOKToTossItemText";
export const TEXT_THREW_AWAY: string = "_ThrewAwayItemText";

/** And when it does not. */
export const TEXT_NOTHING_STORED: string = "_NothingStoredText";
export const TEXT_NOTHING_TO_DEPOSIT: string = "_NothingToDepositText";
export const TEXT_NO_ROOM_TO_STORE: string = "_NoRoomToStoreText";
export const TEXT_CANT_CARRY_MORE: string = "_CantCarryMoreText";
export const TEXT_TOO_IMPORTANT: string = "_TooImportantToTossText";

/** A move: it happened, or the label of the line that refused it. */
export interface ItemMoveResult {
  ok: boolean;
  /** "" when ok; otherwise one of the TEXT_* labels above. */
  refusal: string;
}

/** The item PC's store, always an array: migration guarantees it. */
export function pcItems(state: PlayState): BagSlot[] {
  if (!state.pcItems) {
    state.pcItems = [];
  }
  return state.pcItems;
}

/** How many of `id` the PC holds. */
export function pcItemCount(state: PlayState, id: string): number {
  const store = pcItems(state);
  for (let i = 0; i < store.length; i++) {
    if (store[i].id === id) {
      return store[i].count;
    }
  }
  return 0;
}

/** How many of `id` the bag holds. */
export function bagItemCount(state: PlayState, id: string): number {
  for (let i = 0; i < state.bag.length; i++) {
    if (state.bag[i].id === id) {
      return state.bag[i].count;
    }
  }
  return 0;
}

/** True when the item table marks this one a key item. */
export function isKeyItem(bundle: any, id: string): boolean {
  const def = bundle && bundle.items ? bundle.items[id] : null;
  return def ? def.keyItem === true : false;
}

/** WITHDRAW ITEM: `n` of `id` from the PC into the bag. */
export function withdrawItem(state: PlayState, id: string, n: number): ItemMoveResult {
  const count = n > 0 ? n : 1;
  if (pcItems(state).length === 0) {
    return { ok: false, refusal: TEXT_NOTHING_STORED };
  }
  if (pcItemCount(state, id) < count) {
    return { ok: false, refusal: TEXT_NOTHING_STORED };
  }
  // The bag refuses a twenty-FIRST kind, not a bigger stack of a kind it has.
  if (bagItemCount(state, id) === 0 && state.bag.length >= BAG_ITEM_CAP) {
    return { ok: false, refusal: TEXT_CANT_CARRY_MORE };
  }
  if (bagItemCount(state, id) + count > MAX_STACK) {
    return { ok: false, refusal: TEXT_CANT_CARRY_MORE };
  }
  take(pcItems(state), id, count);
  add(state.bag, id, count);
  return { ok: true, refusal: "" };
}

/** DEPOSIT ITEM: `n` of `id` from the bag into the PC. */
export function depositItem(state: PlayState, id: string, n: number): ItemMoveResult {
  const count = n > 0 ? n : 1;
  if (state.bag.length === 0) {
    return { ok: false, refusal: TEXT_NOTHING_TO_DEPOSIT };
  }
  if (bagItemCount(state, id) < count) {
    return { ok: false, refusal: TEXT_NOTHING_TO_DEPOSIT };
  }
  const store = pcItems(state);
  if (pcItemCount(state, id) === 0 && store.length >= PC_ITEM_CAP) {
    return { ok: false, refusal: TEXT_NO_ROOM_TO_STORE };
  }
  if (pcItemCount(state, id) + count > MAX_STACK) {
    return { ok: false, refusal: TEXT_NO_ROOM_TO_STORE };
  }
  take(state.bag, id, count);
  add(store, id, count);
  return { ok: true, refusal: "" };
}

/**
 * TOSS ITEM: `n` of `id` out of the PC for good.
 *
 * A key item is refused with the cartridge's line. Deposit is NOT: a BICYCLE
 * may be put away, it may just never be thrown out.
 */
export function tossPcItem(bundle: any, state: PlayState, id: string, n: number): ItemMoveResult {
  const count = n > 0 ? n : 1;
  if (pcItems(state).length === 0 || pcItemCount(state, id) < count) {
    return { ok: false, refusal: TEXT_NOTHING_STORED };
  }
  if (isKeyItem(bundle, id)) {
    return { ok: false, refusal: TEXT_TOO_IMPORTANT };
  }
  take(pcItems(state), id, count);
  return { ok: true, refusal: "" };
}

function add(list: BagSlot[], id: string, n: number): void {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      list[i].count = list[i].count + n;
      return;
    }
  }
  list.push({ id: id, count: n });
}

function take(list: BagSlot[], id: string, n: number): void {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id !== id) {
      continue;
    }
    list[i].count = list[i].count - n;
    if (list[i].count <= 0) {
      list.splice(i, 1);
    }
    return;
  }
}
