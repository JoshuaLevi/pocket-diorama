/**
 * Evolution: who is due, and what evolving does to a Pokemon.
 *
 * Pure, like the rest of this directory. It decides nothing about WHEN the
 * question is asked -- that is the overworld's, because the cartridge asks it
 * after the battle box has closed and lets B stop it -- and it draws nothing.
 *
 * The bundle carries each species' evolutions as `{method, level, species}`,
 * three methods deep: LEVEL, ITEM (a stone) and TRADE. Only LEVEL can happen on
 * its own, which is why it is the only one this module offers a "who is due"
 * for; the other two are events somebody else initiates, and `evolve()` serves
 * all three once the decision is made.
 *
 * Two details that are the cartridge's and not obvious:
 *
 *   Current HP goes UP by the gain in maximum HP. EvolveMon recomputes the
 *   stats and adds the difference to the current value, so a Pokemon that
 *   evolved at 1 HP is still at 1 HP plus whatever the evolution bought it --
 *   not healed, and not left at a maximum it no longer has.
 *
 *   The name follows the species only if it was never nicknamed. `name` equal
 *   to the OLD species' name is exactly that test, and it is the same one the
 *   cartridge makes by comparing against the species string.
 *
 * Immediately after evolving, the cartridge checks the NEW species' learnset at
 * the CURRENT level (EvolveMon falls into LearnMoveFromLevelUp), so a Charmander
 * that evolves at 16 can learn what a Charmeleon learns at 16 on the same
 * breath. `movesOnEvolution` is that list; whoever applies it owns the "forget
 * which move?" question, exactly as a level-up does.
 */

import type { BattleMon, StatSet } from "./types";
import { computeStats } from "./Stats";
import { movesLearnedAt } from "./Party";

/** The three ways a species evolves, as the extractor writes them. */
export const EVO_LEVEL: string = "LEVEL";
export const EVO_ITEM: string = "ITEM";
export const EVO_TRADE: string = "TRADE";

/** One party member that is ready to evolve. */
export interface EvolutionDue {
  /** Party slot. */
  index: number;
  from: string;
  to: string;
}

function speciesOf(bundle: any, id: string): any {
  return bundle && bundle.species ? bundle.species[id] : null;
}

/**
 * The species a LEVEL evolution would take this Pokemon to now, or "".
 *
 * The lowest qualifying level wins, which matters only for a hypothetical
 * species with two level evolutions -- gen 1 has none, and picking the lowest
 * is still the behaviour that cannot skip a stage.
 */
export function evolvesInto(bundle: any, mon: BattleMon): string {
  const def = mon ? speciesOf(bundle, mon.species) : null;
  if (!def || !def.evolutions) {
    return "";
  }
  let best = "";
  let bestLevel = 0;
  for (let i = 0; i < def.evolutions.length; i++) {
    const evo = def.evolutions[i];
    if (!evo || evo.method !== EVO_LEVEL) {
      continue;
    }
    const level = typeof evo.level === "number" ? evo.level : 0;
    if (mon.level < level) {
      continue;
    }
    // An evolution to a species this cartridge does not have is a manifest
    // fault, not a reason to hand back a Pokemon that cannot be built.
    if (!speciesOf(bundle, evo.species)) {
      continue;
    }
    if (best === "" || level < bestLevel) {
      best = evo.species;
      bestLevel = level;
    }
  }
  return best;
}

/** Every party member due to evolve by level, in party order. */
export function evolutionsDue(bundle: any, party: BattleMon[]): EvolutionDue[] {
  const out: EvolutionDue[] = [];
  if (!party) {
    return out;
  }
  for (let i = 0; i < party.length; i++) {
    const mon = party[i];
    if (!mon || mon.hp <= 0) {
      // A fainted Pokemon does not evolve: the cartridge walks the party after
      // the battle and skips anything at zero.
      continue;
    }
    const to = evolvesInto(bundle, mon);
    if (to !== "") {
      out.push({ index: i, from: mon.species, to: to });
    }
  }
  return out;
}

/** A deep enough copy that the caller's Pokemon is never written through. */
function cloneStats(stats: StatSet): StatSet {
  return {
    hp: stats.hp,
    attack: stats.attack,
    defense: stats.defense,
    speed: stats.speed,
    special: stats.special,
  };
}

/**
 * The Pokemon after evolving into `to`. Returns a NEW object; nothing is
 * mutated, and an unknown species hands the original straight back.
 */
export function evolve(bundle: any, mon: BattleMon, to: string): BattleMon {
  const from = speciesOf(bundle, mon ? mon.species : "");
  const def = speciesOf(bundle, to);
  if (!mon || !def) {
    return mon;
  }
  const stats = computeStats(def.baseStats, mon.ivs, mon.evs, mon.level);
  const gained = stats.hp - mon.stats.hp;
  const types: string[] = [];
  for (let i = 0; i < def.types.length; i++) {
    types.push(def.types[i]);
  }
  const nicknamed = from ? mon.name !== from.name : false;
  const fresh: BattleMon = {
    species: to,
    name: nicknamed ? mon.name : def.name,
    // Evolving never changes who caught it, which is why a traded Eevee still
    // disobeys after it becomes a Vaporeon.
    otId: typeof mon.otId === "number" ? mon.otId : 0,
    otName: typeof mon.otName === "string" ? mon.otName : "",
    level: mon.level,
    // Not healed and not capped: the gain in maximum HP, added on.
    hp: mon.hp + (gained > 0 ? gained : 0),
    maxHp: stats.hp,
    stats: cloneStats(stats),
    battleStats: mon.battleStats,
    stages: mon.stages,
    types: types,
    moves: mon.moves,
    status: mon.status,
    sleepTurns: mon.sleepTurns,
    ivs: mon.ivs,
    evs: mon.evs,
    exp: mon.exp,
    volatile: mon.volatile,
    badgeBoostPasses: mon.badgeBoostPasses,
  };
  if (fresh.hp > fresh.maxHp) {
    fresh.hp = fresh.maxHp;
  }
  return fresh;
}

/**
 * The moves the NEW species learns at the level it evolved at.
 *
 * The cartridge runs this immediately, on the same breath as the evolution, so
 * a stage that learns something at exactly its evolution level does not have to
 * wait for the next one.
 */
export function movesOnEvolution(bundle: any, to: string, level: number): string[] {
  const def = speciesOf(bundle, to);
  return def ? movesLearnedAt(def, level) : [];
}
