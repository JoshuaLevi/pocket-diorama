// Applying an item's effect to a Pokemon, once.
//
// The five branches -- heal, clear status, raise a stat, set Mist, and the
// HEAL_FULL and maxHp clamps around them -- were transcribed TWICE inside
// BattleState: once where the trainer AI reaches for something, once where the
// player does. They were identical and there was no reason for them to stay
// that way; an overworld bag would have made a third copy, and a third copy is
// how two of them quietly stop agreeing.
//
// What does NOT move here is the WORDING. The AI says "Enemy CHARMANDER
// recovered health!" and the player says "CHARMANDER recovered health!", and
// both gate that line specifically on HP HAVING RISEN rather than on the effect
// having done something -- a FULL_RESTORE on a full-HP but statused Pokemon
// changes something and must not claim to have healed. So this returns what it
// changed and the caller writes its own line, which is also why the outcome is
// not a single boolean.

import type { AiItemEffect } from "./Ai";
import { HEAL_FULL } from "./Ai";
import type { BattleMon } from "./types";
import { STATUS_NONE } from "./types";
import { clampStage } from "./Stats";

/** What an item actually changed. Every field required; zero means nothing. */
export interface ItemOutcome {
  /** HP gained. Zero when the item did not heal or the Pokemon was already full. */
  healed: number;
  statusCleared: boolean;
  /** The stat whose stage went up, or "". */
  statRaised: string;
  mistSet: boolean;
}

function nothing(): ItemOutcome {
  return { healed: 0, statusCleared: false, statRaised: "", mistSet: false };
}

/** True when this item does nothing at all in a battle. */
export function itemDoesNothing(effect: AiItemEffect): boolean {
  return effect.heal === 0 && !effect.clearStatus && effect.raiseStat === "" &&
    !effect.mist;
}

/**
 * True when the item may be used on this Pokemon.
 *
 * A fainted Pokemon cannot be healed by a Potion in Generation 1; that is what a
 * Revive is for, and Revive is not in itemEffect's table.
 */
export function canUseItemOn(mon: BattleMon, effect: AiItemEffect): boolean {
  if (!mon || itemDoesNothing(effect)) {
    return false;
  }
  if (mon.hp <= 0 && effect.heal !== 0) {
    return false;
  }
  return true;
}

/** Applies the effect in place and reports what changed. */
export function applyItemEffect(mon: BattleMon, effect: AiItemEffect): ItemOutcome {
  const out = nothing();
  if (!mon) {
    return out;
  }

  if (effect.heal !== 0) {
    const before = mon.hp;
    const restored = effect.heal === HEAL_FULL ? mon.maxHp : mon.hp + effect.heal;
    mon.hp = restored > mon.maxHp ? mon.maxHp : restored;
    out.healed = mon.hp - before;
  }
  if (effect.clearStatus) {
    mon.status = STATUS_NONE;
    mon.sleepTurns = 0;
    mon.volatile.badlyPoisoned = 0;
    out.statusCleared = true;
  }
  if (effect.raiseStat !== "") {
    const stages = mon.stages as any;
    const current = stages[effect.raiseStat];
    if (typeof current === "number") {
      stages[effect.raiseStat] = clampStage(current + 1);
      out.statRaised = effect.raiseStat;
    }
  }
  if (effect.mist) {
    mon.volatile.mist = true;
    out.mistSet = true;
  }
  return out;
}
