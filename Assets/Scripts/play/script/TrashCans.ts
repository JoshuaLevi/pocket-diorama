// Vermilion Gym's fifteen trash cans, and the two switches under them.
//
// engine/events/hidden_events/vermilion_gym_trash.asm GymTrashScript. The
// door to LT. SURGE is shut until two electric locks are opened, and the
// switches are under the trash: the first in a can chosen at random when you
// enter VERMILION CITY (VermilionCity.asm:16-21, `Random & $0e` -- always an
// even can, the left or right column of each row), the second in a can NEXT
// TO the first, chosen when the first is found. Search a wrong can after the
// first and both locks reset, with a new first can.
//
// GymTrashCans is transcribed byte for byte because the SECOND can is picked
// off it with a bug the cartridge has: the mask is ANDed with a nibble-swapped
// random byte and ONE is subtracted, so a zero product reads past the row
// and lands on padding -- can 0. Every player who ever found the second
// switch in can 0 straight away met that bug, and it is kept.
//
// Neither can index is a flag. They are WRAM on the cartridge and transient
// here (PlayLoop keeps them); the two EVENT_*_LOCK_OPENED flags are what the
// save carries, and the door itself is a block override on the second.

import type { WorldBundle } from "../../world/WorldData";
import type { ScriptCommand } from "./ScriptVM";
import { randomByte } from "../battle/Damage";

export const MAP_VERMILION_GYM: string = "VERMILION_GYM";
export const MAP_VERMILION_CITY: string = "VERMILION_CITY";
export const FIRST_LOCK: string = "EVENT_1ST_LOCK_OPENED";
export const SECOND_LOCK: string = "EVENT_2ND_LOCK_OPENED";

export const TEXT_ONLY_TRASH: string = "_VermilionGymTrashText";
export const TEXT_FIRST_SWITCH: string = "_VermilionGymTrashSuccessText1";
export const TEXT_SECOND_SWITCH: string = "_VermilionGymTrashSuccessText3";
export const TEXT_LOCKS_RESET: string = "_VermilionGymTrashFailText";

export const SOUND_SWITCH: string = "Switch";
export const SOUND_DOOR: string = "Go_Inside";
export const SOUND_DENIED: string = "Denied";

/**
 * GymTrashCans: per first can, the mask and up to four cans that may hold the
 * second switch. The mask is the count of valid entries; the padding is
 * zero, which is what the bug reads.
 */
const GYM_TRASH_CANS: number[][] = [
  [2, 1, 3, 0, 0],
  [3, 0, 2, 4, 0],
  [2, 1, 5, 0, 0],
  [3, 0, 4, 6, 0],
  [4, 1, 3, 5, 7],
  [3, 2, 4, 8, 0],
  [3, 3, 7, 9, 0],
  [4, 4, 6, 8, 10],
  [3, 5, 7, 11, 0],
  [3, 6, 10, 12, 0],
  [4, 7, 9, 11, 13],
  [3, 8, 10, 14, 0],
  [2, 9, 13, 0, 0],
  [3, 10, 12, 14, 0],
  [2, 11, 13, 0, 0],
];

function swap(a: number): number {
  return ((a & 0x0f) << 4) | ((a >> 4) & 0x0f);
}

/** VermilionCity.asm .setFirstLockTrashCanIndex: `Random & $0e`. */
export function rollFirstCan(random: () => number): number {
  return randomByte(random) & 0x0e;
}

/**
 * .openFirstLock's choice of the second can, bug included: mask & swap(byte),
 * minus one, indexes the row's four cans; a zero product lands on padding
 * (the ROM bank's trailing zeros), which is can 0.
 */
export function rollSecondCan(first: number, random: () => number): number {
  const row = GYM_TRASH_CANS[first];
  if (!row) {
    return 0;
  }
  const picked = row[0] & swap(randomByte(random));
  if (picked === 0) {
    return 0;
  }
  return row[picked] & 0x0f;
}

/** The can index at a cell of the gym, or -1. */
export function canAt(bundle: WorldBundle, mapId: string, x: number, y: number): number {
  if (mapId !== MAP_VERMILION_GYM) {
    return -1;
  }
  const extras = bundle.field ? bundle.field.hiddenExtras : null;
  const table = extras ? extras.trashCans : null;
  if (!table || !table.cans) {
    return -1;
  }
  for (let i = 0; i < table.cans.length; i++) {
    if (table.cans[i].x === x && table.cans[i].y === y) {
      return table.cans[i].can;
    }
  }
  return -1;
}

/** What the puzzle remembers between presses; PlayLoop owns one. */
export interface TrashCanState {
  /** -1 until rolled; rolled on entering Vermilion City, or on first use. */
  first: number;
  second: number;
}

export function newTrashCanState(): TrashCanState {
  return { first: -1, second: -1 };
}

/**
 * Pressing A at can `can`: what is said, what changes. Writes the flags and
 * the transient state; the sound comes AFTER the line, as each text's own
 * asm plays it once the pages are read.
 */
export function searchCan(state: TrashCanState, flags: any, can: number,
                          random: () => number): ScriptCommand[] {
  if (flags[SECOND_LOCK] === true) {
    return [{ op: "show_text", textId: TEXT_ONLY_TRASH }];
  }
  if (state.first < 0) {
    state.first = rollFirstCan(random);
  }
  if (flags[FIRST_LOCK] !== true) {
    if (can !== state.first) {
      return [{ op: "show_text", textId: TEXT_ONLY_TRASH }];
    }
    flags[FIRST_LOCK] = true;
    state.second = rollSecondCan(can, random);
    return [
      { op: "show_text", textId: TEXT_FIRST_SWITCH },
      { op: "text_sound", name: SOUND_SWITCH },
    ];
  }
  if (can !== state.second) {
    flags[FIRST_LOCK] = false;
    state.first = rollFirstCan(random);
    state.second = -1;
    return [
      { op: "show_text", textId: TEXT_LOCKS_RESET },
      { op: "text_sound", name: SOUND_DENIED },
    ];
  }
  flags[SECOND_LOCK] = true;
  return [
    { op: "show_text", textId: TEXT_SECOND_SWITCH },
    { op: "text_sound", name: SOUND_DOOR },
  ];
}
