// Generation 1 stats: what a Pokemon's numbers are, and what battle does to them.
//
// Three separate mechanisms, applied in this order and never merged:
//
//   1. the stat formula        base + DV + stat experience + level  -> mon.stats
//   2. stat stages             -6..+6, the ROM's own numerators     -> mon.battleStats
//   3. badge boosts            +12.5% per applicable badge          -> mon.battleStats
//
// Step 3 is where the famous bug lives. Gen 1 re-applies the badge boost every time
// a stat is recalculated -- every Growl, every Swords Dance, every switch-in -- and
// it applies it to the value that already carries every earlier boost. So the
// boosts compound. mon.badgeBoostPasses counts them, and recalculateBattleStats()
// increments it, which is what reproduces the bug. Pass 1 to applyBadgeBoosts() for
// the behaviour Nintendo meant.
//
// Every division here truncates, because every division in the ROM does. Writing
// them as Math.floor rather than / is deliberate: a stat that is one off is
// invisible in play and obvious in a test.

import type { BattleMon, BattleStats, StatSet, StatStages } from "./types";
import { newVolatileState, STATUS_BURN, STATUS_NONE, STATUS_PARALYSIS } from "./types";

/** The ROM's MAX_STAT_VALUE. Stages and badge boosts both stop here. */
export const MAX_STAT: number = 999;

/** Stat stages run -6..+6; the ratio table has one row per stage. */
export const MIN_STAGE: number = -6;
export const MAX_STAGE: number = 6;

/**
 * StatModifierRatios, verbatim from the ROM: numerator and denominator per stage,
 * from -6 to +6. 0.25 0.28 0.33 0.40 0.50 0.66 1 1.5 2 2.5 3 3.5 4. The odd values
 * at the bottom are the ROM's, not a rounding of 1/4 and 2/7.
 */
export const STAGE_NUMERATORS: number[] = [25, 28, 33, 40, 50, 66, 1, 15, 2, 25, 3, 35, 4];
export const STAGE_DENOMINATORS: number[] = [100, 100, 100, 100, 100, 100, 1, 10, 1, 10, 1, 10, 1];

/**
 * Which stat each badge boosts, indexed by badge in gym order.
 * Boulder boosts Attack, Thunder boosts Defense, Soul boosts Speed, Volcano boosts
 * Special; the other four badges boost nothing. "" means no boost.
 *
 * The index is the BADGE, not a count of them: badgeBoostsStat tests the bit,
 * because the cartridge tests individual badge bits too. It used to walk this
 * table as a PREFIX against a count, which gave a player who took Vermilion
 * before Cerulean an Attack boost they had not earned.
 */
export const BADGE_BOOST_STAT: string[] = [
  "attack",  // Boulder
  "",        // Cascade
  "defense", // Thunder
  "",        // Rainbow
  "speed",   // Soul
  "",        // Marsh
  "special", // Volcano
  "",        // Earth
];

// ---------------------------------------------------------------------------
// The stat formula
// ---------------------------------------------------------------------------

/**
 * The ROM's square root: the smallest n with n*n >= value, capped at 255. It is a
 * ceiling, not a rounding, and the cap is why 65535 stat experience is worth no
 * more than 65025.
 */
export function ceilSqrt255(value: number): number {
  if (value <= 0) {
    return 0;
  }
  let n = 0;
  while (n < 255 && n * n < value) {
    n++;
  }
  return n;
}

/** The stat experience term: floor(min(255, ceil(sqrt(statExp))) / 4), so 0..63. */
export function statExpBonus(statExp: number): number {
  return Math.floor(ceilSqrt255(statExp) / 4);
}

/** floor(((base + dv) * 2 + statExpBonus) * level / 100) -- the shared core. */
function statCore(base: number, dv: number, statExp: number, level: number): number {
  return Math.floor((((base + dv) * 2 + statExpBonus(statExp)) * level) / 100);
}

/** Attack, Defense, Speed or Special. */
export function calcStat(base: number, dv: number, statExp: number, level: number): number {
  const value = statCore(base, dv, statExp, level) + 5;
  return value > MAX_STAT ? MAX_STAT : value;
}

/** HP takes the level twice: once in the core and once as a flat bonus, plus 10. */
export function calcHp(base: number, dv: number, statExp: number, level: number): number {
  const value = statCore(base, dv, statExp, level) + level + 10;
  return value > MAX_STAT ? MAX_STAT : value;
}

/**
 * The HP DV is not stored: it is the four other DVs' low bits, most significant
 * first. A Pokemon with all-odd DVs therefore has an HP DV of 15.
 */
export function hpDv(ivs: StatSet): number {
  return (
    ((ivs.attack & 1) << 3) |
    ((ivs.defense & 1) << 2) |
    ((ivs.speed & 1) << 1) |
    (ivs.special & 1)
  );
}

/** All five stats for a species at a level. baseStats is bundle.species[id].baseStats. */
export function computeStats(
  baseStats: StatSet,
  ivs: StatSet,
  evs: StatSet,
  level: number
): StatSet {
  return {
    hp: calcHp(baseStats.hp, hpDv(ivs), evs.hp, level),
    attack: calcStat(baseStats.attack, ivs.attack, evs.attack, level),
    defense: calcStat(baseStats.defense, ivs.defense, evs.defense, level),
    speed: calcStat(baseStats.speed, ivs.speed, evs.speed, level),
    special: calcStat(baseStats.special, ivs.special, evs.special, level),
  };
}

/** DVs the way a wild Pokemon gets them: four independent nibbles. */
export function randomIvs(random: () => number): StatSet {
  const attack = Math.floor(random() * 16) & 15;
  const defense = Math.floor(random() * 16) & 15;
  const speed = Math.floor(random() * 16) & 15;
  const special = Math.floor(random() * 16) & 15;
  const ivs: StatSet = { hp: 0, attack: attack, defense: defense, speed: speed, special: special };
  ivs.hp = hpDv(ivs);
  return ivs;
}

/** Every stat at zero, for stat experience a wild Pokemon has never earned. */
export function zeroStats(): StatSet {
  return { hp: 0, attack: 0, defense: 0, speed: 0, special: 0 };
}

/** Stat stages all neutral. */
export function zeroStages(): StatStages {
  return { attack: 0, defense: 0, speed: 0, special: 0, accuracy: 0, evasion: 0 };
}

// ---------------------------------------------------------------------------
// Stat stages
// ---------------------------------------------------------------------------

/** [numerator, denominator] for a stage, clamped to -6..+6. */
export function stageRatio(stage: number): number[] {
  let index = stage + 6;
  if (index < 0) {
    index = 0;
  }
  if (index > 12) {
    index = 12;
  }
  return [STAGE_NUMERATORS[index], STAGE_DENOMINATORS[index]];
}

/**
 * A stat with its stage applied. The ROM caps the result at 999 and floors it at 1,
 * the floor being what stops a -6 Defense from dividing by zero in the damage
 * formula.
 */
export function applyStatStage(value: number, stage: number): number {
  const ratio = stageRatio(stage);
  let result = Math.floor((value * ratio[0]) / ratio[1]);
  if (result > MAX_STAT) {
    result = MAX_STAT;
  }
  if (result < 1) {
    result = 1;
  }
  return result;
}

/** Clamps a stage to -6..+6. Returns the clamped value, not the delta. */
export function clampStage(stage: number): number {
  if (stage < MIN_STAGE) {
    return MIN_STAGE;
  }
  if (stage > MAX_STAGE) {
    return MAX_STAGE;
  }
  return stage;
}

// ---------------------------------------------------------------------------
// Badge boosts, and the bug
// ---------------------------------------------------------------------------

/**
 * True when the badges in `badgeBits` include the one that boosts `stat`.
 *
 * `badgeBits` is a MASK, one bit per badge in gym order -- PlayState's
 * badgeMask() -- not a count. Bit 0 is Boulder, bit 2 Thunder, and so on, which
 * is how the cartridge asks the question: it tests wObtainedBadges bit by bit.
 */
export function badgeBoostsStat(stat: string, badgeBits: number): boolean {
  for (let i = 0; i < BADGE_BOOST_STAT.length; i++) {
    if (BADGE_BOOST_STAT[i] === stat && (badgeBits & (1 << i)) !== 0) {
      return true;
    }
  }
  return false;
}

/**
 * One badge boost: value + floor(value / 8), which is exactly floor(value * 1.125)
 * for every integer. The ROM shifts right three times and adds, so 7 stays 7 and
 * 8 becomes 9. Capped at 999.
 */
export function boostOnce(value: number): number {
  const boosted = value + Math.floor(value / 8);
  return boosted > MAX_STAT ? MAX_STAT : boosted;
}

/** `passes` badge boosts in a row on one value. passes <= 0 leaves it alone. */
export function boostTimes(value: number, passes: number): number {
  let result = value;
  for (let i = 0; i < passes; i++) {
    result = boostOnce(result);
  }
  return result;
}

/**
 * Badge boosts over the four battle stats. `passes` is how many times to apply
 * each boost: 1 is the behaviour Nintendo intended, and anything above 1 is the
 * Gen 1 bug -- see recalculateBattleStats.
 */
export function applyBadgeBoosts(
  stats: BattleStats,
  badgeBits: number,
  passes: number
): BattleStats {
  return {
    attack: badgeBoostsStat("attack", badgeBits) ? boostTimes(stats.attack, passes) : stats.attack,
    defense: badgeBoostsStat("defense", badgeBits)
      ? boostTimes(stats.defense, passes)
      : stats.defense,
    speed: badgeBoostsStat("speed", badgeBits) ? boostTimes(stats.speed, passes) : stats.speed,
    special: badgeBoostsStat("special", badgeBits)
      ? boostTimes(stats.special, passes)
      : stats.special,
  };
}

/**
 * The working stats for a Pokemon: its unmodified stats with the current stages
 * applied, then `passes` badge boosts, then burn and paralysis.
 *
 * The stage always comes off mon.stats, never off the previous battleStats, so
 * Growl twice is 0.50 and not 0.66 squared. Only the badge boost accumulates.
 */
export function battleStatsFor(mon: BattleMon, badgeBits: number, passes: number): BattleStats {
  const staged: BattleStats = {
    attack: applyStatStage(mon.stats.attack, mon.stages.attack),
    defense: applyStatStage(mon.stats.defense, mon.stages.defense),
    speed: applyStatStage(mon.stats.speed, mon.stages.speed),
    special: applyStatStage(mon.stats.special, mon.stages.special),
  };
  const boosted = applyBadgeBoosts(staged, badgeBits, passes);
  return applyStatusDrops(boosted, mon.status);
}

/**
 * Burn halves Attack and paralysis quarters Speed, both to a minimum of 1. Gen 1
 * applies these to the working stat, so they ride on top of stages and badges and
 * are re-applied on every recalculation like everything else here.
 */
export function applyStatusDrops(stats: BattleStats, status: string): BattleStats {
  if (status === STATUS_BURN) {
    const attack = Math.floor(stats.attack / 2);
    return {
      attack: attack < 1 ? 1 : attack,
      defense: stats.defense,
      speed: stats.speed,
      special: stats.special,
    };
  }
  if (status === STATUS_PARALYSIS) {
    const speed = Math.floor(stats.speed / 4);
    return {
      attack: stats.attack,
      defense: stats.defense,
      speed: speed < 1 ? 1 : speed,
      special: stats.special,
    };
  }
  return stats;
}

/**
 * Send-out: one badge boost, stages already zero. Returns a new BattleMon; the
 * caller stores it in the side. Volatile state and stages are cleared here because
 * Gen 1 clears them when a Pokemon leaves the field, and major status is not.
 */
export function sendOut(mon: BattleMon, badgeBits: number): BattleMon {
  const fresh: BattleMon = cloneMon(mon);
  fresh.stages = zeroStages();
  fresh.volatile = newVolatileState();
  fresh.badgeBoostPasses = 1;
  fresh.battleStats = battleStatsFor(fresh, badgeBits, 1);
  return fresh;
}

/**
 * The recalculation Gen 1 runs after every stat change -- a stage move, an X item,
 * burn or paralysis landing. It re-applies the badge boost, and because it applies
 * it to a stat that already carries one for every previous recalculation, the
 * boosts compound. That is the badge boost bug, and it is preserved on purpose:
 * a player who knows the original will notice its absence.
 *
 * Returns a new BattleMon with battleStats and badgeBoostPasses updated.
 */
export function recalculateBattleStats(mon: BattleMon, badgeBits: number): BattleMon {
  const passes = mon.badgeBoostPasses + 1;
  const fresh: BattleMon = cloneMon(mon);
  fresh.badgeBoostPasses = passes;
  fresh.battleStats = battleStatsFor(fresh, badgeBits, passes);
  return fresh;
}

/**
 * The same recalculation with the bug switched off: exactly one badge boost, no
 * matter how many stat changes have happened. Nothing in the shipping engine calls
 * this; it exists so a test can show the difference the bug makes.
 */
export function recalculateWithoutBug(mon: BattleMon, badgeBits: number): BattleMon {
  const fresh: BattleMon = cloneMon(mon);
  fresh.badgeBoostPasses = 1;
  fresh.battleStats = battleStatsFor(fresh, badgeBits, 1);
  return fresh;
}

// ---------------------------------------------------------------------------
// Building one
// ---------------------------------------------------------------------------

/** A shallow-but-safe copy: nested objects the engine mutates are copied too. */
export function cloneMon(mon: BattleMon): BattleMon {
  const moves: any[] = [];
  for (let i = 0; i < mon.moves.length; i++) {
    moves.push({ id: mon.moves[i].id, pp: mon.moves[i].pp, maxPp: mon.moves[i].maxPp });
  }
  const types: string[] = [];
  for (let i = 0; i < mon.types.length; i++) {
    types.push(mon.types[i]);
  }
  return {
    species: mon.species,
    name: mon.name,
    otId: typeof mon.otId === "number" ? mon.otId : 0,
    otName: typeof mon.otName === "string" ? mon.otName : "",
    level: mon.level,
    hp: mon.hp,
    maxHp: mon.maxHp,
    stats: {
      hp: mon.stats.hp,
      attack: mon.stats.attack,
      defense: mon.stats.defense,
      speed: mon.stats.speed,
      special: mon.stats.special,
    },
    battleStats: {
      attack: mon.battleStats.attack,
      defense: mon.battleStats.defense,
      speed: mon.battleStats.speed,
      special: mon.battleStats.special,
    },
    stages: {
      attack: mon.stages.attack,
      defense: mon.stages.defense,
      speed: mon.stages.speed,
      special: mon.stages.special,
      accuracy: mon.stages.accuracy,
      evasion: mon.stages.evasion,
    },
    types: types,
    moves: moves,
    status: mon.status,
    sleepTurns: mon.sleepTurns,
    ivs: {
      hp: mon.ivs.hp,
      attack: mon.ivs.attack,
      defense: mon.ivs.defense,
      speed: mon.ivs.speed,
      special: mon.ivs.special,
    },
    evs: {
      hp: mon.evs.hp,
      attack: mon.evs.attack,
      defense: mon.evs.defense,
      speed: mon.evs.speed,
      special: mon.evs.special,
    },
    exp: mon.exp,
    volatile: mon.volatile,
    badgeBoostPasses: mon.badgeBoostPasses,
  };
}

/**
 * The moveset a wild Pokemon of this level knows: its level-1 moves plus every
 * learnset entry at or below the level, keeping the last four. That is the ROM's
 * rule, and it is why a level 3 Pidgey has Gust and Sand-Attack and nothing else.
 */
export function wildMoveset(species: any, level: number, moves: any): any[] {
  const ids: string[] = [];
  for (let i = 0; i < species.level1Moves.length; i++) {
    ids.push(species.level1Moves[i]);
  }
  for (let i = 0; i < species.learnset.length; i++) {
    if (species.learnset[i].level <= level) {
      ids.push(species.learnset[i].move);
    }
  }
  const slots: any[] = [];
  const start = ids.length > 4 ? ids.length - 4 : 0;
  for (let i = start; i < ids.length; i++) {
    const def = moves[ids[i]];
    const pp = def ? def.pp : 0;
    slots.push({ id: ids[i], pp: pp, maxPp: pp });
  }
  return slots;
}

/**
 * A wild Pokemon, ready to send out: random DVs, no stat experience, the moveset
 * its level gives it, full HP.
 *
 * `bundle` is the world bundle; `speciesId` keys bundle.species.
 */
export function makeWildMon(
  bundle: any,
  speciesId: string,
  level: number,
  random: () => number
): BattleMon {
  const species = bundle.species[speciesId];
  if (!species) {
    throw new Error("battle: unknown species " + speciesId);
  }
  const ivs = randomIvs(random);
  const evs = zeroStats();
  const stats = computeStats(species.baseStats as StatSet, ivs, evs, level);
  const types: string[] = [];
  for (let i = 0; i < species.types.length; i++) {
    types.push(species.types[i]);
  }
  const mon: BattleMon = {
    species: speciesId,
    name: species.name,
    // Nobody's yet. Storage.claimUnowned stamps whoever it ends up with.
    otId: 0,
    otName: "",
    level: level,
    hp: stats.hp,
    maxHp: stats.hp,
    stats: stats,
    battleStats: {
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
      special: stats.special,
    },
    stages: zeroStages(),
    types: types,
    moves: wildMoveset(species, level, bundle.moves),
    status: STATUS_NONE,
    sleepTurns: 0,
    ivs: ivs,
    evs: evs,
    exp: 0,
    volatile: newVolatileState(),
    badgeBoostPasses: 0,
  };
  return mon;
}
