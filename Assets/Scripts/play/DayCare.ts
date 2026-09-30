// The DAYCARE on Route 5: one Pokemon, one experience point a step.
//
// scripts/Daycare.asm and engine/overworld/player_state (IncrementDayCareMonExp).
// The gentleman takes ONE Pokemon (never the last one in the party, never one
// that knows an HM move), it gains a point of experience for every step the
// player takes anywhere, and it comes back for 100 yen plus 100 a level. On the
// way out it is re-levelled from its experience and takes the moves its
// learnset gives between the level it went in at and the level it comes out
// at -- WriteMonMoves with wLearningMovesFromDayCare set, which never asks: a
// full move list is shifted up and the FIRST move is the one forgotten. That
// is how a day-care Pokemon loses the move you wanted.
//
// Pure: the script host talks, this decides. A node test walks it.

import type { BattleMon } from "./battle/types";
import { LEVEL_CAP, expForLevel, knowsMove, levelForExp } from "./battle/Party";
import { cloneMon, computeStats } from "./battle/Stats";
import { isHmMove } from "./FieldMoves";

/** wDayCarePerLevelCost, BCD 01 00: a hundred yen, charged levels-plus-one times. */
export const DAYCARE_YEN_PER_LEVEL: number = 100;

/** What the save carries while the gentleman has a Pokemon. */
export interface DayCareSlot {
  mon: BattleMon;
  /** wDayCareStartLevel: the level it went in at, for the bill and the moves. */
  startLevel: number;
}

/** KnowsHMMove: the one thing he refuses. */
export function knowsHmMove(mon: BattleMon): boolean {
  if (!mon || !mon.moves) {
    return false;
  }
  for (let i = 0; i < mon.moves.length; i++) {
    if (isHmMove(mon.moves[i].id)) {
      return true;
    }
  }
  return false;
}

/** Hand a Pokemon over. The caller has already taken it out of the party. */
export function depositInDayCare(mon: BattleMon): DayCareSlot {
  return { mon: cloneMon(mon), startLevel: mon.level };
}

/**
 * One step of the player's: one point, until the experience of level 100.
 * A new slot, never the old one written to.
 */
export function dayCareStep(bundle: any, slot: DayCareSlot): DayCareSlot {
  const species = bundle.species ? bundle.species[slot.mon.species] : null;
  if (!species) {
    return slot;
  }
  const cap = expForLevel(species.growthRate, LEVEL_CAP);
  if (slot.mon.exp >= cap) {
    return slot;
  }
  const mon = cloneMon(slot.mon);
  mon.exp = mon.exp + 1;
  return { mon: mon, startLevel: slot.startLevel };
}

/** The level its experience is worth now, which is what he reports. */
export function dayCareLevel(bundle: any, slot: DayCareSlot): number {
  const species = bundle.species ? bundle.species[slot.mon.species] : null;
  if (!species) {
    return slot.mon.level;
  }
  const level = levelForExp(species.growthRate, slot.mon.exp);
  return level > LEVEL_CAP ? LEVEL_CAP : level;
}

/** Levels grown since it went in. */
export function dayCareLevelsGrown(bundle: any, slot: DayCareSlot): number {
  const grown = dayCareLevel(bundle, slot) - slot.startLevel;
  return grown > 0 ? grown : 0;
}

/** The bill: a hundred, plus a hundred a level. */
export function dayCareCost(levelsGrown: number): number {
  return DAYCARE_YEN_PER_LEVEL * (levelsGrown + 1);
}

/**
 * The Pokemon as it comes back: at its new level, stats recomputed from its
 * own DVs and stat experience, at full HP (the script writes max HP into
 * current HP), with the day-care's moves.
 */
export function withdrawFromDayCare(bundle: any, slot: DayCareSlot): BattleMon {
  const species = bundle.species ? bundle.species[slot.mon.species] : null;
  const mon = cloneMon(slot.mon);
  if (!species) {
    return mon;
  }
  const level = dayCareLevel(bundle, slot);
  if (level >= LEVEL_CAP) {
    mon.exp = expForLevel(species.growthRate, LEVEL_CAP);
  }
  mon.level = level;
  const stats = computeStats(species.baseStats, mon.ivs, mon.evs, level);
  mon.stats = stats;
  mon.maxHp = stats.hp;
  mon.hp = stats.hp;
  mon.battleStats = {
    attack: stats.attack, defense: stats.defense, speed: stats.speed, special: stats.special,
  };
  return dayCareMoves(bundle, mon, species, slot.startLevel);
}

/**
 * WriteMonMoves with wLearningMovesFromDayCare: every learnset move ABOVE the
 * start level and up to the new one, in the learnset's order; one already
 * known is skipped; a free slot takes it; with none free the four shift up
 * and the first is gone. The shifted moves keep their PP, the new one has its
 * own full.
 */
function dayCareMoves(bundle: any, mon: BattleMon, species: any, startLevel: number): BattleMon {
  const learnset: any[] = species.learnset ? species.learnset : [];
  for (let i = 0; i < learnset.length; i++) {
    const entry = learnset[i];
    if (entry.level <= startLevel || entry.level > mon.level || !entry.move) {
      continue;
    }
    const def = bundle.moves ? bundle.moves[entry.move] : null;
    if (!def || knowsMove(mon, entry.move)) {
      continue;
    }
    const taught = { id: entry.move, pp: def.pp, maxPp: def.pp };
    let placed = false;
    for (let s = 0; s < mon.moves.length; s++) {
      if (mon.moves[s].id === "") {
        mon.moves[s] = taught;
        placed = true;
        break;
      }
    }
    if (!placed && mon.moves.length < 4) {
      mon.moves.push(taught);
      placed = true;
    }
    if (!placed) {
      mon.moves = [mon.moves[1], mon.moves[2], mon.moves[3], taught];
    }
  }
  return mon;
}
