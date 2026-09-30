// The PC box: where a Pokemon goes when the party is full, and Bill's
// WITHDRAW / DEPOSIT / RELEASE over it.
//
// Pure functions over the PlayState, like PlayState's own bag helpers, so the
// battle engine, the script host and the PC screen all put a Pokemon away the
// same way. Before this file a catch with six in the party was refused at the
// throw ("It dodged the thrown BALL!") and a scripted gift printed "party full"
// and set its flag anyway -- the cartridge sends both to the box.
//
// What the cartridge does (engine/menus/pc.asm, home/pokemon.asm AddPartyMon):
// a deposit stores the Pokemon exactly as it is -- HP, status, PP, stat
// experience -- and a withdrawal recomputes its stats from its DVs and stat
// experience at its level. That recomputation is the "box trick": stat
// experience earned since the last level-up becomes stats without a level.
//
// Nothing here uses Record/Map/Set: `boxes` is an array of arrays.

import type { BattleMon } from "./battle/types";
import type { PlayState } from "./PlayState";
import { BOX_SIZE, MAX_PARTY, markOwned } from "./PlayState";
import { benched, prepareCaught } from "./battle/Party";
import { computeStats } from "./battle/Stats";
import type { StatSet } from "./battle/types";

/** Where receiveMon put the Pokemon. */
export const RECEIVE_PARTY: string = "party";
export const RECEIVE_BOX: string = "box";
export const RECEIVE_REFUSED: string = "refused";

export interface ReceiveResult {
  /** One of the RECEIVE_* constants. */
  where: string;
  /** Party or box slot; -1 when refused. */
  index: number;
  /** The 1-based box number for the text; 0 when it went to the party or nowhere. */
  box: number;
}

/** A withdrawal, deposit or release: ok, or the label of the line that refused it. */
export interface StorageResult {
  ok: boolean;
  /** "" or a text label: _NoMonText, _CantTakeMonText, _CantDepositLastMonText, _BoxFullText. */
  refusal: string;
  /** The Pokemon moved, or null. */
  mon: BattleMon;
}

/** The lines the cartridge refuses with. */
export const TEXT_NO_MON: string = "_NoMonText";
export const TEXT_CANT_TAKE: string = "_CantTakeMonText";
export const TEXT_CANT_DEPOSIT_LAST: string = "_CantDepositLastMonText";
export const TEXT_BOX_FULL: string = "_BoxFullText";

/** The box catches and deposits go to. Always an array: migration guarantees it. */
export function currentBox(state: PlayState): BattleMon[] {
  if (!state.boxes || state.boxes.length === 0) {
    state.boxes = [[]];
    state.currentBox = 0;
  }
  if (state.currentBox < 0 || state.currentBox >= state.boxes.length) {
    state.currentBox = 0;
  }
  return state.boxes[state.currentBox];
}

/** Free slots in the current box, 0..BOX_SIZE. */
export function boxFree(state: PlayState): number {
  const free = BOX_SIZE - currentBox(state).length;
  return free < 0 ? 0 : free;
}

/** The current box's number as the texts print it, 1-based. */
export function boxNumber(state: PlayState): number {
  currentBox(state);
  return state.currentBox + 1;
}

/**
 * A Pokemon arriving from outside -- a catch, a gift -- into the party if there
 * is room, else the current box, else nowhere. Marks the dex on success, as
 * AddPartyMon does for both destinations.
 */
/**
 * Stamps this trainer onto every Pokemon in the party and the boxes that has
 * no trainer yet, and answers how many it claimed.
 *
 * The rule in one line: a Pokemon with nobody's name on it becomes yours the
 * moment it is in your keeping; one that already names a trainer keeps them.
 * That second half is the whole point -- a Pokemon from an in-game trade must
 * go on naming the trainer who caught it, because that is what makes it
 * disobey above your badge level.
 *
 * It sweeps rather than stamping at each entry, deliberately. A Pokemon can
 * arrive by catch-to-party, catch-to-box, gift, starter, trade or a script's
 * give_pokemon, and several of those paths never see a PlayState at all
 * (prepareCaught and benched take only the mon). A field whose absence cannot
 * be repaired later is not one to guard with six call sites that each have to
 * remember; the sweep is idempotent, costs at most 6 + 12 * 20 comparisons,
 * and cannot be bypassed by a path nobody has written yet.
 */
export function claimUnowned(state: PlayState): number {
  let claimed = 0;
  const name = typeof state.playerName === "string" ? state.playerName : "";
  const id = typeof state.playerId === "number" ? state.playerId : 0;
  const stamp = (mon: BattleMon): void => {
    if (!mon) {
      return;
    }
    if (typeof mon.otName === "string" && mon.otName.length > 0) {
      return;
    }
    mon.otId = id;
    mon.otName = name;
    claimed = claimed + 1;
  };
  for (let i = 0; i < state.party.length; i++) {
    stamp(state.party[i]);
  }
  if (Array.isArray(state.boxes)) {
    for (let b = 0; b < state.boxes.length; b++) {
      const box = state.boxes[b];
      for (let i = 0; box && i < box.length; i++) {
        stamp(box[i]);
      }
    }
  }
  return claimed;
}

export function receiveMon(bundle: any, state: PlayState, mon: BattleMon): ReceiveResult {
  const kept = prepareCaught(bundle, mon);
  if (state.party.length < MAX_PARTY) {
    state.party.push(kept);
    claimUnowned(state);
    markOwned(state, dexOf(bundle, kept.species));
    return { where: RECEIVE_PARTY, index: state.party.length - 1, box: 0 };
  }
  const box = depositToBox(state, kept);
  if (box === 0) {
    return { where: RECEIVE_REFUSED, index: -1, box: 0 };
  }
  markOwned(state, dexOf(bundle, kept.species));
  return { where: RECEIVE_BOX, index: currentBox(state).length - 1, box: box };
}

/**
 * Into the current box as-is. Returns the 1-based box number, or 0 when the
 * box is full. The Pokemon is stored benched -- no stages, no volatiles -- and
 * NOT healed.
 */
export function depositToBox(state: PlayState, mon: BattleMon): number {
  const box = currentBox(state);
  if (box.length >= BOX_SIZE) {
    return 0;
  }
  box.push(benched(mon));
  claimUnowned(state);
  return boxNumber(state);
}

/**
 * Bill's WITHDRAW: box slot `boxIndex` to the end of the party.
 *
 * The stats are recomputed from base, DVs, stat experience and level on the
 * way out (the box trick); maxHp follows and hp is clamped to it. Refuses an
 * empty box and a full party with the cartridge's own lines.
 */
export function withdrawFromBox(bundle: any, state: PlayState, boxIndex: number): StorageResult {
  const box = currentBox(state);
  if (box.length === 0) {
    return { ok: false, refusal: TEXT_NO_MON, mon: null };
  }
  if (state.party.length >= MAX_PARTY) {
    return { ok: false, refusal: TEXT_CANT_TAKE, mon: null };
  }
  if (boxIndex < 0 || boxIndex >= box.length) {
    return { ok: false, refusal: TEXT_NO_MON, mon: null };
  }
  const taken = box.splice(boxIndex, 1)[0];
  const fresh = recomputed(bundle, taken);
  state.party.push(fresh);
  return { ok: true, refusal: "", mon: fresh };
}

/** Bill's DEPOSIT: party slot `partyIndex` into the current box. */
export function depositFromParty(state: PlayState, partyIndex: number): StorageResult {
  if (state.party.length <= 1) {
    return { ok: false, refusal: TEXT_CANT_DEPOSIT_LAST, mon: null };
  }
  if (partyIndex < 0 || partyIndex >= state.party.length) {
    return { ok: false, refusal: TEXT_NO_MON, mon: null };
  }
  if (currentBox(state).length >= BOX_SIZE) {
    return { ok: false, refusal: TEXT_BOX_FULL, mon: null };
  }
  const mon = state.party.splice(partyIndex, 1)[0];
  depositToBox(state, mon);
  return { ok: true, refusal: "", mon: mon };
}

/** Bill's RELEASE: box slot `boxIndex` is gone for good. */
export function releaseFromBox(state: PlayState, boxIndex: number): StorageResult {
  const box = currentBox(state);
  if (box.length === 0 || boxIndex < 0 || boxIndex >= box.length) {
    return { ok: false, refusal: TEXT_NO_MON, mon: null };
  }
  const gone = box.splice(boxIndex, 1)[0];
  return { ok: true, refusal: "", mon: gone };
}

/**
 * The box trick: stats from base, DVs, stat experience and level, as the
 * cartridge's withdrawal (and every level-up) computes them. maxHp follows;
 * current HP keeps its value, clamped, so a fainted Pokemon stays fainted.
 */
function recomputed(bundle: any, mon: BattleMon): BattleMon {
  const species = bundle.species ? bundle.species[mon.species] : null;
  const fresh = benched(mon);
  if (!species) {
    return fresh;
  }
  const stats = computeStats(species.baseStats as StatSet, fresh.ivs, fresh.evs, fresh.level);
  fresh.stats = stats;
  fresh.maxHp = stats.hp;
  fresh.hp = fresh.hp > stats.hp ? stats.hp : fresh.hp;
  fresh.battleStats = {
    attack: stats.attack,
    defense: stats.defense,
    speed: stats.speed,
    special: stats.special,
  };
  return fresh;
}

function dexOf(bundle: any, species: string): number {
  const spec = bundle.species ? bundle.species[species] : null;
  return spec ? spec.dex : 0;
}
