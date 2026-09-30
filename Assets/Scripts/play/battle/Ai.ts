// The original trainer AI: which move it picks, when it switches, when it reaches
// for an item.
//
// Ported from engine/battle/trainer_ai.asm (AIEnemyTrainerChooseMoves and the
// nineteen per-class routines) and engine/battle/core.asm (SelectEnemyMove). The
// per-class item and switch table is a hand-port; gen1recomp's
// data/scripts/ai_classes.lua, MIT, is the reference for it.
//
// THIS AI IS BAD ON PURPOSE. Every one of the following is the cartridge's own
// behaviour and none of them is a defect in this file:
//
//   * Scores run DOWNWARD from a base of 10 and the MINIMUM wins, so a move that
//     any layer discourages is not merely unlikely, it is unreachable. One +5 from
//     layer 1 takes a move off the table completely.
//   * Layer 2 only ever fires on the SECOND move selection of each enemy Pokemon,
//     and never again.
//   * Layer 2's "stat move" list is an address range, not a category, so it also
//     encourages Pay Day, Swift, Conversion, Haze, Recover, Transform, Light
//     Screen and Reflect purely because they sit between the stat-up and stat-down
//     blocks in the effect constant list.
//   * Layer 3 reads only the FIRST matching row of the type chart. Against a dual
//     type it never multiplies, so Thunderbolt looks super effective against a
//     WATER/GROUND Quagsire-shaped defender it cannot touch.
//   * Layer 3's "is there a better move" scan includes the move being judged, so a
//     resisted Super Fang, Night Shade or Fly discourages itself.
//   * PP is never consulted. SelectEnemyMove reads wEnemyMonMoves and
//     wEnemyDisabledMove and nothing else; the enemy will happily pick a move with
//     no PP left. Struggle is reached only when the Pokemon has exactly one move
//     and that move is disabled.
//   * The move slot roll is not uniform: 63/256, 64/256, 63/256, 66/256. The
//     fourth slot is the likeliest.
//   * A switch always goes to the FIRST living reserve, whatever the matchup, and
//     costs the trainer its whole turn.
//   * Blaine will spend a Super Potion at full HP -- BlaineAI has no HP check at
//     all. Cool Trainer F's percentage roll is dead code: the `ret nc` after it is
//     commented out in the cartridge's own source.
//
// Fixing any of them would make the game play like something else. If a future
// reader is about to "correct" one, this comment is the reason not to.

import type { BattleContext, BattleMon, BattleSide, MoveDef, TurnAction } from "./types";
import { ACTION_ITEM, ACTION_SWITCH, noAction, STATUS_NONE } from "./types";
import { hasType, randomByte, typeChartFor } from "./Damage";

// ---------------------------------------------------------------------------
// The ROM's `percent` macro
// ---------------------------------------------------------------------------

/**
 * macros/data.asm: `percent EQUS "* $ff / 100"`. Every threshold in this file is
 * written as the assembly writes it, so `cp 25 percent + 1` is percentOf(25) + 1
 * and the reader can check it against the cartridge without doing arithmetic.
 */
export function percentOf(percent: number): number {
  return Math.floor((percent * 255) / 100);
}

// ---------------------------------------------------------------------------
// Per-class item use and switching
// ---------------------------------------------------------------------------

/**
 * One trainer class's AI routine, as data. Zero and "" mean "this class does not
 * do that".
 *
 * The routines are all the same shape: roll one byte, compare it, optionally check
 * HP against a fraction of the maximum, then use an item or switch.
 */
export interface AiClass {
  id: string;
  /** wAICount: how many times this trainer may act, per Pokemon sent out. */
  uses: number;
  /** `cp N` gate on the roll. The class acts only when roll < chance. 0 = no gate. */
  chance: number;
  /** Agatha's separate, earlier switch roll. 0 = none. */
  switchChance: number;
  /** Act only when currentHp < floor(maxHp / hpBelow). 0 = no HP check. */
  hpBelow: number;
  /** Cool Trainer F: switch when hp is under maxHp/switchBelow but over the heal line. */
  switchBelow: number;
  /** The item this class uses, "" when it switches instead. */
  item: string;
  /** Juggler: the whole routine is a switch. */
  alwaysSwitch: boolean;
  /** Brock: no roll at all, act whenever the active Pokemon has a status. */
  onStatus: boolean;
}

function aiClass(
  id: string,
  uses: number,
  chance: number,
  item: string,
  hpBelow: number
): AiClass {
  return {
    id: id,
    uses: uses,
    chance: chance,
    switchChance: 0,
    hpBelow: hpBelow,
    switchBelow: 0,
    item: item,
    alwaysSwitch: false,
    onStatus: false,
  };
}

/** A class with no AI routine at all: GenericAI is `and a / ret`. */
export const AI_CLASS_GENERIC: AiClass = aiClass("", 0, 0, "", 0);

/**
 * The eighteen trainer classes with a routine of their own. Every other class --
 * Youngster, Bug Catcher, Lass, Rival 1, the lot -- uses GenericAI and never
 * switches or uses an item.
 *
 * Thresholds transcribed from the routines: `25 percent + 1` is 64,
 * `13 percent - 1` is 32, `50 percent + 1` is 128 and `8 percent` is 20.
 */
export const AI_CLASSES: { [id: string]: AiClass } = {
  // JugglerAI: cp 25 percent + 1 / ret nc / jp AISwitchIfEnoughMons
  OPP_JUGGLER: {
    id: "OPP_JUGGLER", uses: 3, chance: percentOf(25) + 1, switchChance: 0,
    hpBelow: 0, switchBelow: 0, item: "", alwaysSwitch: true, onStatus: false,
  },
  // BlackbeltAI: cp 13 percent - 1 / ret nc / jp AIUseXAttack
  OPP_BLACKBELT: aiClass("OPP_BLACKBELT", 2, percentOf(13) - 1, "X_ATTACK", 0),
  OPP_GIOVANNI: aiClass("OPP_GIOVANNI", 1, percentOf(25) + 1, "GUARD_SPEC", 0),
  OPP_COOLTRAINER_M: aiClass("OPP_COOLTRAINER_M", 2, percentOf(25) + 1, "X_ATTACK", 0),
  // CooltrainerFAI: the `ret nc` after `cp 25 percent + 1` is COMMENTED OUT in
  // pokered, so her roll is computed and thrown away -- she acts on every turn she
  // has a use left. Below maxHp/10 she drinks; between maxHp/10 and maxHp/5 she
  // switches. chance stays 0 here to reproduce the missing gate.
  OPP_COOLTRAINER_F: {
    id: "OPP_COOLTRAINER_F", uses: 1, chance: 0, switchChance: 0,
    hpBelow: 10, switchBelow: 5, item: "HYPER_POTION",
    alwaysSwitch: false, onStatus: false,
  },
  OPP_BRUNO: aiClass("OPP_BRUNO", 2, percentOf(25) + 1, "X_DEFEND", 0),
  // BrockAI: no roll, no HP check -- a status on his Pokemon is the whole trigger.
  OPP_BROCK: {
    id: "OPP_BROCK", uses: 5, chance: 0, switchChance: 0, hpBelow: 0,
    switchBelow: 0, item: "FULL_HEAL", alwaysSwitch: false, onStatus: true,
  },
  OPP_MISTY: aiClass("OPP_MISTY", 1, percentOf(25) + 1, "X_DEFEND", 0),
  OPP_LT_SURGE: aiClass("OPP_LT_SURGE", 1, percentOf(25) + 1, "X_SPEED", 0),
  OPP_ERIKA: aiClass("OPP_ERIKA", 1, percentOf(50) + 1, "SUPER_POTION", 10),
  OPP_KOGA: aiClass("OPP_KOGA", 2, percentOf(25) + 1, "X_ATTACK", 0),
  // BlaineAI has no AICheckIfHPBelowFraction call: he heals at full HP.
  OPP_BLAINE: aiClass("OPP_BLAINE", 2, percentOf(25) + 1, "SUPER_POTION", 0),
  OPP_SABRINA: aiClass("OPP_SABRINA", 1, percentOf(25) + 1, "HYPER_POTION", 10),
  OPP_RIVAL2: aiClass("OPP_RIVAL2", 1, percentOf(13) - 1, "POTION", 5),
  OPP_RIVAL3: aiClass("OPP_RIVAL3", 1, percentOf(13) - 1, "FULL_RESTORE", 5),
  OPP_LORELEI: aiClass("OPP_LORELEI", 2, percentOf(50) + 1, "SUPER_POTION", 5),
  // AgathaAI rolls ONE byte and reads it twice: under 8 percent she switches, and
  // the same byte then feeds the 50 percent + 1 item gate. The two outcomes
  // partition the byte range rather than being two independent rolls.
  OPP_AGATHA: {
    id: "OPP_AGATHA", uses: 2, chance: percentOf(50) + 1,
    switchChance: percentOf(8), hpBelow: 4, switchBelow: 0,
    item: "SUPER_POTION", alwaysSwitch: false, onStatus: false,
  },
  OPP_LANCE: aiClass("OPP_LANCE", 1, percentOf(50) + 1, "HYPER_POTION", 5),
};

/** The class record for a trainer id. Unknown ids get GenericAI, which does nothing. */
export function aiClassFor(trainerId: string): AiClass {
  const found = AI_CLASSES[trainerId];
  return found ? found : AI_CLASS_GENERIC;
}

// ---------------------------------------------------------------------------
// What an item does
// ---------------------------------------------------------------------------

/** heal === HEAL_FULL means "to the maximum". */
export const HEAL_FULL: number = -1;

export interface AiItemEffect {
  item: string;
  /** HP to restore, 0 for none, HEAL_FULL for all of it. */
  heal: number;
  clearStatus: boolean;
  /** A STAT_* key to raise by one stage, "" for none. */
  raiseStat: string;
  /** Guard Spec sets Mist. */
  mist: boolean;
}

/**
 * The item's effect as data, so the caller applies it and this module stays pure.
 * The amounts are the ROM's: AIUsePotion loads 20, AIUseSuperPotion 50,
 * AIUseHyperPotion 200.
 */
export function itemEffect(item: string): AiItemEffect {
  const effect: AiItemEffect = {
    item: item, heal: 0, clearStatus: false, raiseStat: "", mist: false,
  };
  if (item === "POTION") {
    effect.heal = 20;
  } else if (item === "SUPER_POTION") {
    effect.heal = 50;
  } else if (item === "HYPER_POTION") {
    effect.heal = 200;
  } else if (item === "FULL_RESTORE") {
    effect.heal = HEAL_FULL;
    effect.clearStatus = true;
  } else if (item === "FULL_HEAL") {
    effect.clearStatus = true;
  } else if (item === "X_ATTACK") {
    effect.raiseStat = "attack";
  } else if (item === "X_DEFEND") {
    effect.raiseStat = "defense";
  } else if (item === "X_SPEED") {
    effect.raiseStat = "speed";
  } else if (item === "X_SPECIAL") {
    effect.raiseStat = "special";
  } else if (item === "GUARD_SPEC") {
    effect.mist = true;
  }
  return effect;
}

// ---------------------------------------------------------------------------
// Switching
// ---------------------------------------------------------------------------

/**
 * AISwitchIfEnoughMons: count every unfainted Pokemon in the party INCLUDING the
 * one that is out, and switch when that total is 2 or more -- that is, whenever
 * one reserve can still fight. The replacement is the first living reserve by
 * party order and nothing else is considered.
 *
 * Returns the party index to send out, or -1 when there is nobody.
 */
export function switchTarget(side: BattleSide): number {
  let unfainted = 0;
  let firstReserve = -1;
  for (let i = 0; i < side.party.length; i++) {
    if (side.party[i].hp > 0) {
      unfainted++;
      if (i !== side.activeIndex && firstReserve < 0) {
        firstReserve = i;
      }
    }
  }
  if (unfainted < 2) {
    return -1;
  }
  return firstReserve;
}

// ---------------------------------------------------------------------------
// The per-turn class action
// ---------------------------------------------------------------------------

/** wAICount before its first seeding: TrainerAI reads $ff as "load the class count". */
export const AI_USES_UNSEEDED: number = -1;

/**
 * The trainer's action for this turn: ACTION_ITEM, ACTION_SWITCH, or noAction()
 * for "just attack". `roll` is the byte TrainerAI takes from Random before it
 * jumps into the class routine.
 *
 * `usesLeft` is wAICount. The ROM decrements it inside the item routines
 * (DecrementAICount) and reseeds it to the class count on every enemy send-out, so
 * a trainer that switches gets a full allowance again -- caller-owned state,
 * because this module holds none.
 *
 * Called at the moment the foe's slot in the turn order comes up, not when the
 * move was selected: an item or a switch REPLACES the attack the foe had already
 * been ordered for.
 */
export function classActionForRoll(
  ctx: BattleContext,
  cls: AiClass,
  usesLeft: number,
  roll: number
): TurnAction {
  if (cls.id === "" || usesLeft <= 0) {
    return noAction();
  }
  const active: BattleMon = ctx.foe.active;

  // Agatha's switch roll is read from the same byte, before the item gate.
  if (cls.switchChance > 0 && roll < cls.switchChance) {
    return switchOrNothing(ctx.foe);
  }

  if (cls.onStatus) {
    if (active.status !== STATUS_NONE) {
      return { kind: ACTION_ITEM, moveIndex: -1, partyIndex: -1, item: cls.item };
    }
    return noAction();
  }

  if (cls.chance > 0 && roll >= cls.chance) {
    return noAction();
  }

  if (cls.alwaysSwitch) {
    return switchOrNothing(ctx.foe);
  }

  if (cls.hpBelow > 0 && active.hp >= Math.floor(active.maxHp / cls.hpBelow)) {
    // Above the healing line. Cool Trainer F has a second, looser line she
    // switches on instead; every other class simply does nothing.
    if (cls.switchBelow > 0 && active.hp < Math.floor(active.maxHp / cls.switchBelow)) {
      return switchOrNothing(ctx.foe);
    }
    return noAction();
  }

  return { kind: ACTION_ITEM, moveIndex: -1, partyIndex: -1, item: cls.item };
}

function switchOrNothing(side: BattleSide): TurnAction {
  const target = switchTarget(side);
  if (target < 0) {
    return noAction();
  }
  return { kind: ACTION_SWITCH, moveIndex: -1, partyIndex: target, item: "" };
}

/** classActionForRoll with the byte taken from the battle's own RNG. */
export function classAction(ctx: BattleContext, cls: AiClass, usesLeft: number): TurnAction {
  return classActionForRoll(ctx, cls, usesLeft, randomByte(ctx.random));
}

// ---------------------------------------------------------------------------
// Move scoring
// ---------------------------------------------------------------------------

/** Every move starts here. Lower is better; the minimum is chosen. */
export const AI_BASE_SCORE: number = 10;

/** `ld [hl], $50` on a disabled slot. Nothing can push a live move near it. */
export const AI_DISABLED_SCORE: number = 0x50;

/** Slots at or past the first empty one are never scored. */
export const AI_SCORE_ABSENT: number = -1;

/** chooseMove returns this when the Pokemon has nothing to use. */
export const AI_STRUGGLE: number = -1;

/**
 * StatusAilmentMoveEffects. EFFECT_01 is the unused second sleep effect; it is in
 * the ROM's table and no move in Red carries it, so it is here for completeness.
 */
export const STATUS_AILMENT_EFFECTS: string[] = [
  "EFFECT_01", "SLEEP_EFFECT", "POISON_EFFECT", "PARALYZE_EFFECT",
];

/**
 * Layer 2's two effect ranges, ATTACK_UP1_EFFECT..BIDE_EFFECT and
 * ATTACK_UP2_EFFECT..POISON_EFFECT, both exclusive of the upper bound -- $0A..$19
 * and $32..$41 in the effect constant list. Written out because this engine keys
 * effects by name and has no constant numbering to compare against.
 */
export const LAYER2_ENCOURAGED_EFFECTS: string[] = [
  "ATTACK_UP1_EFFECT", "DEFENSE_UP1_EFFECT", "SPEED_UP1_EFFECT", "SPECIAL_UP1_EFFECT",
  "ACCURACY_UP1_EFFECT", "EVASION_UP1_EFFECT", "PAY_DAY_EFFECT", "SWIFT_EFFECT",
  "ATTACK_DOWN1_EFFECT", "DEFENSE_DOWN1_EFFECT", "SPEED_DOWN1_EFFECT",
  "SPECIAL_DOWN1_EFFECT", "ACCURACY_DOWN1_EFFECT", "EVASION_DOWN1_EFFECT",
  "CONVERSION_EFFECT", "HAZE_EFFECT",
  "ATTACK_UP2_EFFECT", "DEFENSE_UP2_EFFECT", "SPEED_UP2_EFFECT", "SPECIAL_UP2_EFFECT",
  "ACCURACY_UP2_EFFECT", "EVASION_UP2_EFFECT", "HEAL_EFFECT", "TRANSFORM_EFFECT",
  "ATTACK_DOWN2_EFFECT", "DEFENSE_DOWN2_EFFECT", "SPEED_DOWN2_EFFECT",
  "SPECIAL_DOWN2_EFFECT", "ACCURACY_DOWN2_EFFECT", "EVASION_DOWN2_EFFECT",
  "LIGHT_SCREEN_EFFECT", "REFLECT_EFFECT",
];

/** Layer 3 treats these three effects as "a better move" no matter their type. */
export const LAYER3_BETTER_EFFECTS: string[] = [
  "SUPER_FANG_EFFECT", "SPECIAL_DAMAGE_EFFECT", "FLY_EFFECT",
];

function inList(list: string[], value: string): boolean {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) {
      return true;
    }
  }
  return false;
}

/** How many move slots the ROM's loops walk: it stops at the first empty one. */
export function liveSlotCount(mon: BattleMon): number {
  for (let i = 0; i < mon.moves.length; i++) {
    if (mon.moves[i].id === "") {
      return i;
    }
  }
  return mon.moves.length;
}

/**
 * AIGetTypeEffectiveness: the multiplier in tenths of the FIRST TypeEffects row
 * whose attacking type matches and whose defending type is either of the
 * defender's. -1 when no row matches, which the ROM represents by leaving
 * wTypeEffectiveness at its $10 sentinel.
 *
 * There is no product here. A dual-type defender contributes at most one row, and
 * which one depends on the order of the extracted chart -- which is the ROM's own
 * table order, preserved by the extractor.
 */
export function firstMatchingRow(bundle: any, attackType: string, defenderTypes: string[]): number {
  const entries = typeChartFor(bundle).entriesFor(attackType);
  for (let i = 0; i < entries.length; i++) {
    if (hasType(defenderTypes, entries[i].defender)) {
      return entries[i].multiplier;
    }
  }
  return -1;
}

/**
 * Layer 3's "does this Pokemon know something better" scan. PP and Disable are
 * ignored, and the move being judged is in the list it scans -- so a resisted
 * Super Fang, Night Shade, Psywave, Seismic Toss, Dragon Rage or Fly counts itself
 * as the better move and adds its own point of discouragement.
 */
export function hasBetterMove(bundle: any, user: BattleMon, judgedType: string): boolean {
  const live = liveSlotCount(user);
  for (let i = 0; i < live; i++) {
    const def: MoveDef = bundle.moves[user.moves[i].id];
    if (!def) {
      continue;
    }
    if (inList(LAYER3_BETTER_EFFECTS, def.effect)) {
      return true;
    }
    if (def.type !== judgedType && def.power > 0) {
      return true;
    }
  }
  return false;
}

/**
 * wAILayer2Encouragement is zero on each enemy send-out and gains one per enemy
 * move, and layer 2 tests it against exactly 1. So the encouragement is live for
 * the second selection of each Pokemon and no other.
 *
 * `selectionCount` is how many selections this Pokemon has already made.
 */
export function layer2Active(selectionCount: number): boolean {
  return selectionCount === 1;
}

/**
 * A score per move slot. AI_SCORE_ABSENT for slots the ROM's loops never reach.
 * `mods` is the class's TrainerClassMoveChoiceModifications list, applied in the
 * order the cartridge stores it: layer 1 adds 5, layer 2 subtracts 1, layer 3
 * subtracts 1 or adds 1.
 */
export function scoreMoves(
  bundle: any,
  user: BattleMon,
  target: BattleMon,
  mods: number[],
  layer2Turn: boolean
): number[] {
  const live = liveSlotCount(user);
  const scores: number[] = [];
  for (let i = 0; i < user.moves.length; i++) {
    scores.push(i < live ? AI_BASE_SCORE : AI_SCORE_ABSENT);
  }
  const disabled = user.volatile.disabledSlot;
  if (disabled >= 0 && disabled < live) {
    scores[disabled] = AI_DISABLED_SCORE;
  }

  for (let m = 0; m < mods.length; m++) {
    const layer = mods[m];
    for (let i = 0; i < live; i++) {
      const def: MoveDef = bundle.moves[user.moves[i].id];
      if (!def) {
        continue;
      }
      if (layer === 1) {
        if (target.status !== STATUS_NONE && def.power === 0 &&
            inList(STATUS_AILMENT_EFFECTS, def.effect)) {
          scores[i] = scores[i] + 5;
        }
      } else if (layer === 2) {
        if (layer2Turn && inList(LAYER2_ENCOURAGED_EFFECTS, def.effect)) {
          scores[i] = scores[i] - 1;
        }
      } else if (layer === 3) {
        const row = firstMatchingRow(bundle, def.type, target.types);
        if (row > 10) {
          scores[i] = scores[i] - 1;
        } else if (row >= 0 && row < 10 && hasBetterMove(bundle, user, def.type)) {
          scores[i] = scores[i] + 1;
        }
      }
    }
  }
  return scores;
}

/**
 * Which slots survive AIEnemyTrainerChooseMoves' filter.
 *
 * The cartridge finds the minimum by decrementing every live entry in a cycle
 * until one hits zero, undoing the partial cycle, and then rewriting every entry
 * that now reads 1 as its move id and everything else as zero. Work the arithmetic
 * through and every live slot ends at score - minimum + 1, so "reads 1" is exactly
 * "scored the minimum". This function is that conclusion, not that loop.
 */
export function minimalSlots(scores: number[]): boolean[] {
  let best = -1;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] !== AI_SCORE_ABSENT && (best < 0 || scores[i] < best)) {
      best = scores[i];
    }
  }
  const minimal: boolean[] = [];
  for (let i = 0; i < scores.length; i++) {
    minimal.push(scores[i] !== AI_SCORE_ABSENT && scores[i] === best);
  }
  return minimal;
}

// ---------------------------------------------------------------------------
// The slot roll
// ---------------------------------------------------------------------------

/**
 * SelectEnemyMove's ladder: `cp 25 percent` (63), `cp 50 percent` (127),
 * `cp 75 percent - 1` (190). The gaps are 63, 64, 63 and 66 wide, so the four
 * slots are NOT equally likely and the fourth is the likeliest. Reproduced rather
 * than rounded to a quarter each, because a Pokemon whose fourth move is its worst
 * really does use it more often in the original.
 */
export const SLOT_THRESHOLDS: number[] = [
  percentOf(25),
  percentOf(50),
  percentOf(75) - 1,
];

/** The slot one random byte lands on, 0..3. */
export function rollSlot(random: () => number): number {
  const roll = randomByte(random);
  for (let i = 0; i < SLOT_THRESHOLDS.length; i++) {
    if (roll < SLOT_THRESHOLDS[i]) {
      return i;
    }
  }
  return SLOT_THRESHOLDS.length;
}

/**
 * The ROM rerolls -- it does not pick from a shortlist -- until it lands on a slot
 * that is neither empty, nor filtered out, nor the disabled one. The loop is
 * unbounded in the cartridge; it is bounded here, and falls back to the first
 * candidate, because a Lens that hangs is worse than one that is 1-in-2^128 wrong.
 */
export const MAX_SLOT_ROLLS: number = 64;

export function selectSlot(
  candidates: boolean[],
  disabledSlot: number,
  random: () => number
): number {
  for (let attempt = 0; attempt < MAX_SLOT_ROLLS; attempt++) {
    const slot = rollSlot(random);
    if (slot === disabledSlot) {
      continue;
    }
    if (slot < candidates.length && candidates[slot]) {
      return slot;
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i] && i !== disabledSlot) {
      return i;
    }
  }
  return AI_STRUGGLE;
}

// ---------------------------------------------------------------------------
// The choice
// ---------------------------------------------------------------------------

/**
 * The move slot the foe will use this turn, or AI_STRUGGLE.
 *
 * `mods` is the trainer class's TrainerClassMoveChoiceModifications entry, read
 * out of the cartridge; an empty list is the `.useOriginalMoveSet` path, which is
 * what a wild Pokemon and most trainer classes take -- the roll runs over the raw
 * move list with no scoring at all.
 *
 * `selectionCount` is how many move selections this Pokemon has already made; it
 * exists only to drive layer 2 and is the caller's to keep, reset on send-out.
 */
export function chooseMove(ctx: BattleContext, mods: number[], selectionCount: number): number {
  const user: BattleMon = ctx.foe.active;
  const target: BattleMon = ctx.player.active;
  const live = liveSlotCount(user);
  const disabled = user.volatile.disabledSlot;

  // SelectEnemyMove's only route to Struggle: the second slot is empty and a move
  // is disabled. Running out of PP is not one -- the enemy's PP is never read.
  if (live === 0 || (live <= 1 && disabled >= 0)) {
    return AI_STRUGGLE;
  }

  let candidates: boolean[];
  if (mods.length === 0) {
    candidates = [];
    for (let i = 0; i < user.moves.length; i++) {
      candidates.push(i < live);
    }
  } else {
    const scores = scoreMoves(ctx.bundle, user, target, mods, layer2Active(selectionCount));
    candidates = minimalSlots(scores);
  }
  return selectSlot(candidates, disabled, ctx.random);
}
