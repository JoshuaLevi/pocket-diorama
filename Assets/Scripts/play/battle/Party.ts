// The party of six: switching, fainting, experience, levels and learned moves.
//
// Generation 1 keeps a Pokemon TWICE while it is on the field -- once in the party
// and once in the battle struct -- and the two are not the same object. HP, status
// and PP are written back to the party as they change; stat stages, volatiles and
// the accumulated badge boosts exist only in the battle copy and die when the
// Pokemon leaves the field. BattleSide models that with `party[activeIndex]` and
// `active`, and the functions here are careful about which one they are holding.
// That is also why badly-poisoned decays to ordinary poison on a switch: the Toxic
// counter is volatile and the PSN is not.
//
// The experience path is engine/battle/experience.asm, and it has three properties
// worth stating before someone "fixes" one of them:
//
//   1. Base experience is divided by the number of participants BEFORE it is
//      multiplied by the defeated Pokemon's level, so two participants is not half
//      of one participant -- it is half rounded down, then scaled, then rounded
//      down again.
//   2. The divisor is how many participant FLAGS are set; the payout goes to the
//      flagged Pokemon that are still standing. They are two different counts of
//      two different things, and only RemoveFaintedPlayerMon clearing the flag on
//      a faint keeps them in step -- which is what makes sacrificing a Pokemon to
//      buy a switch pay the survivor MORE, not less.
//   3. Stat experience is divided by the same count and capped at 65535 per stat,
//      but it does not turn into a stat until the Pokemon next levels up. That is
//      the whole basis of the box trick.
//
// Every division truncates because every division in the ROM does.

import type { BattleMon, BattleSide, StatSet } from "./types";
import { newVolatileState } from "./types";
import { battleStatsFor, cloneMon, computeStats, sendOut, zeroStages } from "./Stats";

/** Six. A catch with six in the party goes to the PC box (play/Storage.ts). */
export const MAX_PARTY: number = 6;

/** The ROM's level ceiling. */
export const LEVEL_CAP: number = 100;

/** Stat experience is one unsigned word per stat. */
export const MAX_STAT_EXP: number = 65535;

// ---------------------------------------------------------------------------
// Growth curves
// ---------------------------------------------------------------------------

export const GROWTH_MEDIUM_FAST: string = "MEDIUM_FAST";
export const GROWTH_SLIGHTLY_FAST: string = "SLIGHTLY_FAST";
export const GROWTH_SLIGHTLY_SLOW: string = "SLIGHTLY_SLOW";
export const GROWTH_MEDIUM_SLOW: string = "MEDIUM_SLOW";
export const GROWTH_FAST: string = "FAST";
export const GROWTH_SLOW: string = "SLOW";

/**
 * Total experience needed to BE at `level`, from GrowthRateTable. Level 1 is 0 on
 * every curve; MEDIUM_SLOW's polynomial goes negative below level 3 and the ROM
 * clamps it, which is why a level 2 Bulbasaur needs 9 points and not -54.
 *
 * Generation 1 defines six curves and uses four: no Kanto species is SLIGHTLY_FAST
 * or SLIGHTLY_SLOW. Both are here because the table has them.
 *
 * An unrecognised curve falls back to MEDIUM_FAST, which is what the reference
 * implementation does. The bundle only ever carries the four, so this is defensive.
 */
export function expForLevel(growthRate: string, level: number): number {
  const n = level;
  const cube = n * n * n;
  const square = n * n;
  let value: number;
  if (growthRate === GROWTH_MEDIUM_SLOW) {
    value = Math.floor((6 * cube) / 5) - 15 * square + 100 * n - 140;
  } else if (growthRate === GROWTH_FAST) {
    value = Math.floor((4 * cube) / 5);
  } else if (growthRate === GROWTH_SLOW) {
    value = Math.floor((5 * cube) / 4);
  } else if (growthRate === GROWTH_SLIGHTLY_FAST) {
    value = Math.floor((3 * cube) / 4) + 10 * square - 30;
  } else if (growthRate === GROWTH_SLIGHTLY_SLOW) {
    value = Math.floor((3 * cube) / 4) + 20 * square - 70;
  } else {
    value = cube;
  }
  return value < 0 ? 0 : value;
}

/** The highest level `exp` pays for, 1..LEVEL_CAP. */
export function levelForExp(growthRate: string, exp: number): number {
  let level = 1;
  while (level < LEVEL_CAP && expForLevel(growthRate, level + 1) <= exp) {
    level++;
  }
  return level;
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

/**
 * One participant's share:
 *
 *   floor( floor(baseExp / participants) * defeatedLevel / 7 )
 *
 * then x1.5 for a traded Pokemon and x1.5 again for a trainer battle, in that
 * order, each truncating. 1.0 has no trading, so `traded` is always false in play;
 * the parameter exists because the multiplier's position in the chain is part of
 * the formula and leaving it out would make the formula wrong rather than smaller.
 *
 * The floor of 1 is the reference implementation's, not the cartridge's: a share
 * that truncates to zero would otherwise pay nothing at all. Stated because it is
 * the one line here that is not straight out of the ROM.
 */
export function expGain(
  baseExp: number,
  defeatedLevel: number,
  isTrainer: boolean,
  participants: number,
  traded: boolean
): number {
  const split = participants < 1 ? 1 : participants;
  const base = Math.floor(baseExp / split);
  let exp = Math.floor((base * defeatedLevel) / 7);
  if (traded) {
    exp = Math.floor((exp * 3) / 2);
  }
  if (isTrainer) {
    exp = Math.floor((exp * 3) / 2);
  }
  return exp < 1 ? 1 : exp;
}

/** One stat's share of stat experience, capped where the word overflows. */
export function addStatExp(current: number, defeatedBase: number, participants: number): number {
  const split = participants < 1 ? 1 : participants;
  const total = current + Math.floor(defeatedBase / split);
  return total > MAX_STAT_EXP ? MAX_STAT_EXP : total;
}

/** All five stats' share. The defeated species' BASE stats are what is added. */
export function gainStatExp(evs: StatSet, defeatedBase: StatSet, participants: number): StatSet {
  return {
    hp: addStatExp(evs.hp, defeatedBase.hp, participants),
    attack: addStatExp(evs.attack, defeatedBase.attack, participants),
    defense: addStatExp(evs.defense, defeatedBase.defense, participants),
    speed: addStatExp(evs.speed, defeatedBase.speed, participants),
    special: addStatExp(evs.special, defeatedBase.special, participants),
  };
}

/** One level crossed: what the Pokemon becomes, and what it can learn there. */
export interface LevelStep {
  level: number;
  stats: StatSet;
  /** Current HP after this level: the old HP plus the gain in maximum HP. */
  hp: number;
  /** Move ids the learnset gives at exactly this level. Empty for most levels. */
  learned: string[];
}

export interface ExpAward {
  /** The Pokemon with exp and stat experience applied. Level and stats UNCHANGED. */
  mon: BattleMon;
  gained: number;
  /** Levels crossed, in order. Empty when the Pokemon did not level. */
  levels: number[];
  steps: LevelStep[];
}

/**
 * Pay one Pokemon its share and work out what levels that crosses.
 *
 * The returned Pokemon carries the new experience and stat experience but is still
 * at its old level: the cartridge prints "gained N EXP. Points!" first and only
 * then walks the levels one at a time, each with its own message, stats window and
 * move-learn check. commitLevel() is the other half, and commitAllLevels() is the
 * whole thing for a caller with no message box to feed.
 *
 * Stat experience is applied before the level walk, so a Pokemon that levels on
 * this very award already gets the benefit of the stats it just earned.
 */
export function applyExperience(
  bundle: any,
  mon: BattleMon,
  defeatedSpeciesId: string,
  defeatedLevel: number,
  isTrainer: boolean,
  participants: number,
  traded: boolean
): ExpAward {
  const defeated = bundle.species[defeatedSpeciesId];
  if (!defeated) {
    throw new Error("battle: unknown defeated species " + defeatedSpeciesId);
  }
  const species = bundle.species[mon.species];
  if (!species) {
    throw new Error("battle: unknown species " + mon.species);
  }

  const fresh = cloneMon(mon);
  fresh.evs = gainStatExp(fresh.evs, defeated.baseStats as StatSet, participants);
  const gained = expGain(defeated.baseExp, defeatedLevel, isTrainer, participants, traded);
  fresh.exp = fresh.exp + gained;

  const target = levelForExp(species.growthRate, fresh.exp);
  const steps: LevelStep[] = [];
  const levels: number[] = [];
  let level = fresh.level;
  let stats = fresh.stats;
  let hp = fresh.hp;
  while (level < target && level < LEVEL_CAP) {
    level++;
    const grown = computeStats(species.baseStats as StatSet, fresh.ivs, fresh.evs, level);
    // The cartridge adds the GAIN in maximum HP to current HP, so a Pokemon that
    // levels at 3 HP is still nearly fainted afterwards. It never heals you.
    const raised = hp + (grown.hp - stats.hp);
    hp = raised > grown.hp ? grown.hp : raised;
    stats = grown;
    levels.push(level);
    steps.push({ level: level, stats: grown, hp: hp, learned: movesLearnedAt(species, level) });
  }

  return { mon: fresh, gained: gained, levels: levels, steps: steps };
}

/**
 * Take one level. `isActive` is true for the Pokemon currently on the field, and
 * it is what makes this more than a stat write: the cartridge recalculates the
 * active Pokemon's battle stats here and, in doing so, RESETS the accumulated
 * badge boosts to a single pass. Every Growl and every Swords Dance before this
 * level-up stops compounding. Stat stages survive; only the badge accumulator is
 * cleared. (That is the behaviour of the reference implementation this project is
 * fingerprinted against; I did not have the disassembly to hand to confirm the
 * exact instruction.)
 *
 * A benched Pokemon has no battle stats worth the name, so they are simply its
 * stats and its badge accumulator goes to zero -- it will be boosted on send-out.
 */
export function commitLevel(
  mon: BattleMon,
  step: LevelStep,
  badgeBits: number,
  isActive: boolean
): BattleMon {
  const fresh = cloneMon(mon);
  fresh.level = step.level;
  fresh.stats = {
    hp: step.stats.hp,
    attack: step.stats.attack,
    defense: step.stats.defense,
    speed: step.stats.speed,
    special: step.stats.special,
  };
  fresh.maxHp = step.stats.hp;
  fresh.hp = step.hp > step.stats.hp ? step.stats.hp : step.hp;
  if (isActive) {
    fresh.badgeBoostPasses = 1;
    fresh.battleStats = battleStatsFor(fresh, badgeBits, 1);
  } else {
    fresh.badgeBoostPasses = 0;
    fresh.battleStats = {
      attack: fresh.stats.attack,
      defense: fresh.stats.defense,
      speed: fresh.stats.speed,
      special: fresh.stats.special,
    };
  }
  return fresh;
}

/** Every step in order, for a caller with nothing to show between them. */
export function commitAllLevels(
  mon: BattleMon,
  steps: LevelStep[],
  badgeBits: number,
  isActive: boolean
): BattleMon {
  let result = mon;
  for (let i = 0; i < steps.length; i++) {
    result = commitLevel(result, steps[i], badgeBits, isActive);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Learning moves
// ---------------------------------------------------------------------------

/** Move ids the learnset gives at EXACTLY this level. Not at or below it. */
export function movesLearnedAt(species: any, level: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < species.learnset.length; i++) {
    if (species.learnset[i].level === level) {
      out.push(species.learnset[i].move);
    }
  }
  return out;
}

export const LEARN_LEARNED: string = "LEARNED";
export const LEARN_ALREADY_KNOWN: string = "KNOWN";
/** Four moves already. The player has to choose one to forget, or decline. */
export const LEARN_NEEDS_ROOM: string = "FULL";
export const LEARN_UNKNOWN_MOVE: string = "UNKNOWN";

export interface LearnResult {
  outcome: string;
  /** The slot it went into, or -1. */
  slot: number;
  mon: BattleMon;
}

/** Slots with a move in them. An empty slot is the sentinel id "". */
export function knownMoveCount(mon: BattleMon): number {
  let count = 0;
  for (let i = 0; i < mon.moves.length; i++) {
    if (mon.moves[i].id !== "") {
      count++;
    }
  }
  return count;
}

/** True when the Pokemon already has this move in a slot. */
export function knowsMove(mon: BattleMon, moveId: string): boolean {
  for (let i = 0; i < mon.moves.length; i++) {
    if (mon.moves[i].id === moveId) {
      return true;
    }
  }
  return false;
}

/**
 * Learn into the first free slot. A Pokemon that already knows the move keeps it
 * (the cartridge skips the whole prompt), and one with four moves comes back as
 * LEARN_NEEDS_ROOM for the caller to put to the player -- replaceMove() is the
 * other half.
 */
export function learnMove(bundle: any, mon: BattleMon, moveId: string): LearnResult {
  const def = bundle.moves[moveId];
  if (!def) {
    return { outcome: LEARN_UNKNOWN_MOVE, slot: -1, mon: mon };
  }
  if (knowsMove(mon, moveId)) {
    return { outcome: LEARN_ALREADY_KNOWN, slot: -1, mon: mon };
  }
  const fresh = cloneMon(mon);
  for (let i = 0; i < fresh.moves.length; i++) {
    if (fresh.moves[i].id === "") {
      fresh.moves[i] = { id: moveId, pp: def.pp, maxPp: def.pp };
      return { outcome: LEARN_LEARNED, slot: i, mon: fresh };
    }
  }
  if (fresh.moves.length < 4) {
    fresh.moves.push({ id: moveId, pp: def.pp, maxPp: def.pp });
    return { outcome: LEARN_LEARNED, slot: fresh.moves.length - 1, mon: fresh };
  }
  return { outcome: LEARN_NEEDS_ROOM, slot: -1, mon: mon };
}

/** Forget the move in `slot` and learn `moveId` there, at full PP. */
export function replaceMove(
  bundle: any,
  mon: BattleMon,
  slot: number,
  moveId: string
): LearnResult {
  const def = bundle.moves[moveId];
  if (!def) {
    return { outcome: LEARN_UNKNOWN_MOVE, slot: -1, mon: mon };
  }
  if (slot < 0 || slot >= mon.moves.length) {
    return { outcome: LEARN_UNKNOWN_MOVE, slot: -1, mon: mon };
  }
  const fresh = cloneMon(mon);
  fresh.moves[slot] = { id: moveId, pp: def.pp, maxPp: def.pp };
  return { outcome: LEARN_LEARNED, slot: slot, mon: fresh };
}

// ---------------------------------------------------------------------------
// The party
// ---------------------------------------------------------------------------

/** Party index of the first Pokemon with HP left, or -1. */
export function firstHealthy(party: BattleMon[]): number {
  for (let i = 0; i < party.length; i++) {
    if (party[i].hp > 0) {
      return i;
    }
  }
  return -1;
}

/** True when nothing in the party can fight. */
export function isWiped(party: BattleMon[]): boolean {
  return firstHealthy(party) < 0;
}

export function partyIsFull(party: BattleMon[]): boolean {
  return party.length >= MAX_PARTY;
}

export interface AddResult {
  ok: boolean;
  party: BattleMon[];
  index: number;
}

/** Append, if there is room. Returns a new array; the input is untouched. */
export function addToParty(party: BattleMon[], mon: BattleMon): AddResult {
  if (partyIsFull(party)) {
    return { ok: false, party: party, index: -1 };
  }
  const next: BattleMon[] = [];
  for (let i = 0; i < party.length; i++) {
    next.push(party[i]);
  }
  next.push(benched(mon));
  return { ok: true, party: next, index: next.length - 1 };
}

/**
 * A caught Pokemon as it will be kept. It keeps the HP and the status it had
 * when the ball closed -- Gen 1 heals nothing -- and its experience is set to
 * exactly what its level is worth, because a wild Pokemon has no experience
 * total until AddPartyMon calls CalcExperience for it. The same shape goes into
 * the party or the box; only the destination differs.
 */
export function prepareCaught(bundle: any, mon: BattleMon): BattleMon {
  const species = bundle.species[mon.species];
  if (!species) {
    throw new Error("battle: unknown species " + mon.species);
  }
  const fresh = benched(mon);
  fresh.exp = expForLevel(species.growthRate, fresh.level);
  return fresh;
}

/** A caught Pokemon joining the party, when there is room. */
export function receiveCaught(bundle: any, party: BattleMon[], mon: BattleMon): AddResult {
  return addToParty(party, prepareCaught(bundle, mon));
}

/**
 * A Pokemon off the field: stat stages neutral, volatiles gone, badge boosts not
 * yet applied, battle stats equal to its real stats. Major status and sleep
 * counters survive, because in Gen 1 they do.
 */
export function benched(mon: BattleMon): BattleMon {
  const fresh = cloneMon(mon);
  fresh.stages = zeroStages();
  fresh.volatile = newVolatileState();
  fresh.badgeBoostPasses = 0;
  fresh.battleStats = {
    attack: fresh.stats.attack,
    defense: fresh.stats.defense,
    speed: fresh.stats.speed,
    special: fresh.stats.special,
  };
  return fresh;
}

/** A new side with `party` and `active` replaced and everything else carried over. */
function withParty(side: BattleSide, party: BattleMon[], active: BattleMon, index: number): BattleSide {
  return {
    active: active,
    party: party,
    activeIndex: index,
    badgeBits: side.badgeBits,
    isPlayer: side.isPlayer,
    trainerId: side.trainerId,
    escapeAttempts: side.escapeAttempts,
  };
}

/**
 * Fold the active Pokemon's battle copy back into its party slot, keeping the
 * field-only state out of it. This is what the cartridge does continuously to HP,
 * status and PP; doing it in one place means nothing can forget.
 */
export function benchActive(side: BattleSide): BattleMon[] {
  const party: BattleMon[] = [];
  for (let i = 0; i < side.party.length; i++) {
    party.push(i === side.activeIndex ? benched(side.active) : side.party[i]);
  }
  return party;
}

export interface SwitchResult {
  ok: boolean;
  side: BattleSide;
  /** Why the switch was refused, or "". */
  message: string;
}

/**
 * Send out party slot `index`. The Pokemon leaving loses its stat stages, its
 * volatiles and its accumulated badge boosts; the one arriving gets exactly one
 * badge boost, which is Stats.sendOut's job.
 */
export function switchTo(side: BattleSide, index: number): SwitchResult {
  if (index < 0 || index >= side.party.length) {
    return { ok: false, side: side, message: "No such POKeMON!" };
  }
  if (index === side.activeIndex) {
    return { ok: false, side: side, message: "It's already out!" };
  }
  if (side.party[index].hp <= 0) {
    return { ok: false, side: side, message: "There's no will to fight!" };
  }
  const party = benchActive(side);
  const active = sendOut(party[index], side.badgeBits);
  return { ok: true, side: withParty(side, party, active, index), message: "" };
}

export interface FaintOutcome {
  side: BattleSide;
  /** Party index of the replacement, or -1 when the side has nothing left. */
  next: number;
  wiped: boolean;
}

/**
 * The active Pokemon has reached 0 HP. Its state goes back into the party, its
 * experience-participant flag is cleared by the caller (see clearParticipant --
 * this is RemoveFaintedPlayerMon, and it changes what everyone else is paid), and
 * the side reports whether it has anything left to send out.
 *
 * `active` still holds the fainted Pokemon afterwards: the cartridge leaves it on
 * the field until a replacement is chosen, and the message box needs its name.
 */
export function activeFainted(side: BattleSide): FaintOutcome {
  const party = benchActive(side);
  const next = firstHealthy(party);
  const updated = withParty(side, party, benched(side.active), side.activeIndex);
  return { side: updated, next: next, wiped: next < 0 };
}

// ---------------------------------------------------------------------------
// Experience participants
// ---------------------------------------------------------------------------

/** wPartyGainExpFlags: one bit per party slot, as a plain array. */
export function newParticipants(size: number): boolean[] {
  const flags: boolean[] = [];
  for (let i = 0; i < size; i++) {
    flags.push(false);
  }
  return flags;
}

/** Mark a slot as having been in against the current opponent. */
export function markParticipant(flags: boolean[], index: number): boolean[] {
  const next: boolean[] = [];
  for (let i = 0; i < flags.length; i++) {
    next.push(i === index ? true : flags[i]);
  }
  return next;
}

/**
 * Strike a slot off. RemoveFaintedPlayerMon clears the flag when a Pokemon faints,
 * which takes it out of the divisor as well as the payout -- a Pokemon sacrificed
 * to buy a switch makes the survivors richer, not poorer.
 */
export function clearParticipant(flags: boolean[], index: number): boolean[] {
  const next: boolean[] = [];
  for (let i = 0; i < flags.length; i++) {
    next.push(i === index ? false : flags[i]);
  }
  return next;
}

/**
 * Every flagged slot. This is the DIVISOR: pokered counts the bits set in
 * wPartyGainExpFlags, without asking whether the Pokemon is still standing.
 */
export function flaggedParticipants(flags: boolean[], party: BattleMon[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < party.length && i < flags.length; i++) {
    if (flags[i]) {
      out.push(i);
    }
  }
  return out;
}

/**
 * Flagged AND still standing. This is who is PAID: GainExperience's party loop
 * skips a Pokemon on 0 HP.
 *
 * The two lists are not the same list, and keeping them apart is the point. In
 * ordinary play they agree, because RemoveFaintedPlayerMon clears the flag the
 * moment a Pokemon faints and it leaves both. If a flag ever outlives its Pokemon
 * -- a faint the caller has not reported yet -- the cartridge still divides by it
 * and still pays it nothing, and so does this.
 */
export function payableParticipants(flags: boolean[], party: BattleMon[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < party.length && i < flags.length; i++) {
    if (flags[i] && party[i].hp > 0) {
      out.push(i);
    }
  }
  return out;
}

export interface SlotAward {
  index: number;
  gained: number;
  levels: number[];
  steps: LevelStep[];
}

export interface BattleAward {
  side: BattleSide;
  awards: SlotAward[];
  /** The divisor actually used. */
  participants: number;
}

/**
 * Pay out for one defeated opponent, and level whoever that levels.
 *
 * The divisor is how many slots are FLAGGED; the payees are the flagged slots that
 * are still standing. When nothing is flagged at all -- every participant fainted
 * and had its flag struck off -- the cartridge falls back to paying the Pokemon
 * currently on the field, so this does too.
 *
 * Levels are committed here rather than deferred, and every step is returned so the
 * message box can replay them in the cartridge's order: gained, then one "grew to
 * level" per level, then that level's move-learn checks.
 */
export function awardBattleExperience(
  bundle: any,
  side: BattleSide,
  flags: boolean[],
  defeatedSpeciesId: string,
  defeatedLevel: number,
  isTrainer: boolean
): BattleAward {
  let party = benchActive(side);
  let paid = payableParticipants(flags, party);
  let divisor = flaggedParticipants(flags, party).length;
  const activeInParty = side.activeIndex >= 0 && side.activeIndex < party.length;
  if (divisor === 0 && activeInParty && side.active.hp > 0) {
    divisor = 1;
    paid = [side.activeIndex];
  }
  if (divisor < 1) {
    divisor = 1;
  }

  const awards: SlotAward[] = [];
  let activeLevelled = false;
  for (let i = 0; i < paid.length; i++) {
    const index = paid[i];
    const award = applyExperience(
      bundle,
      party[index],
      defeatedSpeciesId,
      defeatedLevel,
      isTrainer,
      divisor,
      false
    );
    const isActive = index === side.activeIndex;
    if (isActive && award.steps.length > 0) {
      activeLevelled = true;
    }
    const next: BattleMon[] = [];
    for (let s = 0; s < party.length; s++) {
      next.push(
        s === index ? commitAllLevels(award.mon, award.steps, side.badgeBits, false) : party[s]
      );
    }
    party = next;
    awards.push({
      index: index,
      gained: award.gained,
      levels: award.levels,
      steps: award.steps,
    });
  }

  const active = rejoinActive(side, party[side.activeIndex], activeLevelled);
  return { side: withParty(side, party, active, side.activeIndex), awards: awards, participants: divisor };
}

/**
 * Put the party slot's new level and stats back into the battle copy while keeping
 * the stat stages and volatiles the field copy is carrying. `levelled` is what
 * resets the badge-boost accumulator; without a level-up the battle copy keeps
 * whatever it had compounded so far.
 */
export function rejoinActive(side: BattleSide, slot: BattleMon, levelled: boolean): BattleMon {
  if (!slot) {
    return side.active;
  }
  const fresh = cloneMon(slot);
  fresh.stages = {
    attack: side.active.stages.attack,
    defense: side.active.stages.defense,
    speed: side.active.stages.speed,
    special: side.active.stages.special,
    accuracy: side.active.stages.accuracy,
    evasion: side.active.stages.evasion,
  };
  fresh.volatile = side.active.volatile;
  fresh.badgeBoostPasses = levelled ? 1 : side.active.badgeBoostPasses;
  const passes = fresh.badgeBoostPasses < 1 ? 1 : fresh.badgeBoostPasses;
  fresh.battleStats = battleStatsFor(fresh, side.badgeBits, passes);
  return fresh;
}
