// Generation 1 move effects: everything that happens once a move has been chosen.
//
// Stats.ts says what a Pokemon's numbers are and Damage.ts turns a hit into a
// number. This file is the rest of the move: whether it lands, how many times,
// what it inflicts, what it costs the user, and the two dozen moves that are
// each their own special case.
//
// Four rules the whole file obeys:
//
//   1. It mutates the BattleMon objects it is given, in place. Stats.ts returns
//      fresh copies (cloneMon), but `side.active` and `side.party[i]` are the same
//      object, and VolatileState is shared by reference across a clone -- so
//      replacing a mon mid-move would leave the caller holding a stale handle.
//      recalc() is recalculateBattleStats() copied back onto the original, so the
//      badge-boost bug still compounds exactly as Stats.ts defines it.
//   2. Every message is the cartridge's own line, looked up in bundle.text by the
//      ROM's own label. Nothing here writes English that a player will read; the
//      fallbacks exist only so a stripped-down bundle does not crash the engine,
//      and a test asserts every id used here is really in the cartridge.
//   3. PP is the turn loop's business, not this file's. useMove() takes a move id,
//      because a move called by Metronome or Mirror Move costs no PP and a locked
//      Thrash turn costs none either.
//   4. Generation 1's faults are reproduced on purpose. Each one is marked GEN1
//      BUG with what it does and why it is not fixed:
//
//        - Jump Kick's crash costs exactly 1 HP, never half the damage
//        - Focus Energy is handled in Damage.ts and quarters the crit rate
//        - Recover / Softboiled / Rest fail when max HP minus current HP ends
//          in $FF (a difference of exactly 255 or 511)
//        - a drain move overwrites the shared damage word, so Counter can
//          return twice the HP that was drained
//        - Substitute made at exactly a quarter of max HP leaves the user at 0
//        - Hyper Beam skips its recharge when the target faints
//        - Super Fang halves a Ghost's HP and Night Shade hits a Normal type,
//          because fixed damage never reaches the type chart
//        - a hit floored to zero by 0.25x effectiveness registers as a miss
//
// One reading of the contract is worth stating: MoveResult.hit here means the
// ROM's wMoveMissed is clear -- the move connected -- and not merely that the
// accuracy roll passed. A type immunity, a Counter with nothing to counter and a
// hit floored to zero all set wMoveMissed after the roll succeeded, and all three
// read as hit === false. `effectiveness` and `messages` still separate them.
//
// No Record/Map/Set and no enum: Lens Studio's TypeScript has none of them.

import type { BattleContext, BattleMon, BattleSide, MoveDef, MoveResult,
  StageChange, StatStages } from "./types";
import { STATUS_BURN, STATUS_FREEZE, STATUS_NONE, STATUS_PARALYSIS, STATUS_POISON,
  STATUS_SLEEP, STAT_ACCURACY, STAT_ATTACK, STAT_DEFENSE, STAT_EVASION,
  STAT_SPECIAL, STAT_SPEED } from "./types";
import { clampStage, cloneMon, recalculateBattleStats, zeroStages } from "./Stats";
// Sleep and confusion durations, and the burn/paralysis restat, live in Status.ts.
// They were duplicated here with different RNG streams and a badge-boost pass the
// ROM does not spend, which meant a seeded battle could not follow the cartridge.
import { restat, rollConfusionTurns, rollSleepTurns } from "./Status";
import { computeDamage, damageRoll, hasType, isSpecialType, rollCritical,
  rollMoveHits, typeChartFor } from "./Damage";

// ---------------------------------------------------------------------------
// The cartridge's own words
// ---------------------------------------------------------------------------

/**
 * Every ROM text label this file prints. Listed so a test can assert that the
 * real bundle carries all of them -- a typo here would otherwise show up as an
 * English fallback in the message box and nowhere else.
 */
export const TEXT_IDS: string[] = [
  "_AttackMissedText", "_ButItFailedText", "_NothingHappenedText",
  "_DoesntAffectMonText", "_CriticalHitText", "_OHKOText",
  "_SuperEffectiveText", "_NotVeryEffectiveText",
  "_MultiHitText", "_HitXTimesText",
  "_MonsStatsRoseText", "_MonsStatsFellText", "_RoseText", "_FellText",
  "_GreatlyRoseText", "_GreatlyFellText",
  "_FellAsleepText", "_AlreadyAsleepText", "_PoisonedText", "_BadlyPoisonedText",
  "_BurnedText", "_FrozenText", "_ParalyzedMayNotAttackText",
  "_BecameConfusedText", "_FireDefrostedText",
  "_HitWithRecoilText", "_SuckedHealthText", "_DreamWasEatenText",
  "_KeptGoingAndCrashedText", "_CoinsScatteredText",
  "_SubstituteText", "_HasSubstituteText", "_TooWeakSubstituteText",
  "_SubstituteBrokeText", "_SubstituteTookDamageText",
  "_AttackContinuesText", "_ThrashingAboutText", "_BuildingRageText",
  "_SavingEnergyText", "_UnleashedEnergyText",
  "_MirrorMoveFailedText", "_TransformedText", "_MimicLearnedMoveText",
  "_MoveWasDisabledText", "_WasSeededText", "_StatusChangesEliminatedText",
  "_ConvertedTypeText", "_NoEffectText", "_RegainedHealthText",
  "_StartedSleepingEffect", "_FellAsleepBecameHealthyText",
  "_LightScreenProtectedText", "_ReflectGainedArmorText", "_ShroudedInMistText",
  "_GettingPumpedText", "_ChargeMoveEffectText",
  "_FlewUpHighText", "_DugAHoleText", "_MadeWhirlwindText",
  "_TookInSunlightText", "_LoweredItsHeadText", "_SkyAttackGlowingText",
  "_RanFromBattleText", "_RanAwayScaredText", "_WasBlownAwayText",
  "_DidntAffectText", "_IsUnaffectedText",
];

/** The English the engine falls back to when a bundle has no text table. */
const TEXT_FALLBACK: { [id: string]: string } = {
  _AttackMissedText: "{USER}'s\nattack missed!",
  _ButItFailedText: "But, it failed! ",
  _NothingHappenedText: "Nothing happened!",
  _DoesntAffectMonText: "It doesn't affect\n{TARGET}!",
};

/**
 * The stat names as the message box prints them, from the ROM's
 * StatModTextStrings. The extractor does not carry that table into the bundle --
 * it is six words, not a dataset -- so unlike every other string here they are
 * written out rather than read out.
 */
const STAT_LABEL: { [stat: string]: string } = {
  attack: "ATTACK",
  defense: "DEFENSE",
  speed: "SPEED",
  special: "SPECIAL",
  accuracy: "ACCURACY",
  evasion: "EVADE",
};

/** The cartridge's line for a label, or the fallback when the bundle has none. */
export function romText(bundle: any, id: string): string {
  const table = bundle && bundle.text ? bundle.text : null;
  const line = table ? table[id] : null;
  if (typeof line === "string") {
    return line;
  }
  const spare = TEXT_FALLBACK[id];
  return spare ? spare : id;
}

/** The name a battle text prints: the enemy's is prefixed, as in the original. */
export function displayName(mon: BattleMon, isPlayer: boolean): string {
  return isPlayer ? mon.name : "Enemy " + mon.name;
}

/** Replaces one {NUM:...} placeholder; the ROM's own arguments are ignored. */
function fillNum(text: string, value: number): string {
  const start = text.indexOf("{NUM:");
  if (start < 0) {
    return text;
  }
  const end = text.indexOf("}", start);
  if (end < 0) {
    return text;
  }
  return text.substring(0, start) + value + text.substring(end + 1);
}

/**
 * Substitutes the placeholders the extractor leaves in a battle line. {SCROLL}
 * becomes \v, the scroll control character Dialogue.ts already understands.
 */
export function fill(text: string, user: string, target: string, ram: string,
                     num: number): string {
  let out = text.split("{USER}").join(user);
  out = out.split("{TARGET}").join(target);
  out = out.split("{RAM:wStringBuffer}").join(ram);
  out = out.split("{RAM:wNameBuffer}").join(ram);
  out = out.split("{PLAYER}").join(user);
  out = out.split("{SCROLL}").join("\v");
  return fillNum(out, num);
}

/**
 * Fill {RAM:name...} slots BY NAME.
 *
 * `slots` is [["wBoxMonNicks", "PIDGEY"], ["wStringBuffer", "1"]]. pagesOf and
 * Moves.fill put one value in every slot, which is right for the hundreds of
 * lines with one slot and wrong for the handful with two: "_SentToBoxText"
 * carries the nickname and the box number, and read "PIDGEY was sent to
 * POKeMON BOX PIDGEY on PC!". A slot with no value is LEFT IN PLACE, so a
 * missing one is visible on screen rather than silently blank.
 */
export function fillSlots(text: string, slots: string[][]): string {
  let out = "";
  let rest = text;
  for (let guard = 0; guard < 32; guard++) {
    const start = rest.indexOf("{RAM:");
    if (start < 0) {
      break;
    }
    const end = rest.indexOf("}", start);
    if (end < 0) {
      break;
    }
    const inside = rest.substring(start + 5, end);
    const comma = inside.indexOf(",");
    const name = comma >= 0 ? inside.substring(0, comma) : inside;
    let value: string = null;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i][0] === name) {
        value = slots[i][1];
        break;
      }
    }
    out = out + rest.substring(0, start) + (value === null ? rest.substring(start, end + 1) : value);
    rest = rest.substring(end + 1);
  }
  return out + rest;
}

// ---------------------------------------------------------------------------
// Effect tables
// ---------------------------------------------------------------------------

/** Primary stat moves: which stat, how many stages, and whose. */
const STAGE_MOVES: { [effect: string]: string } = {
  ATTACK_UP1_EFFECT: "attack,1,user",
  ATTACK_UP2_EFFECT: "attack,2,user",
  DEFENSE_UP1_EFFECT: "defense,1,user",
  DEFENSE_UP2_EFFECT: "defense,2,user",
  SPEED_UP2_EFFECT: "speed,2,user",
  SPECIAL_UP1_EFFECT: "special,1,user",
  SPECIAL_UP2_EFFECT: "special,2,user",
  EVASION_UP1_EFFECT: "evasion,1,user",
  ATTACK_DOWN1_EFFECT: "attack,-1,foe",
  DEFENSE_DOWN1_EFFECT: "defense,-1,foe",
  DEFENSE_DOWN2_EFFECT: "defense,-2,foe",
  SPEED_DOWN1_EFFECT: "speed,-1,foe",
  ACCURACY_DOWN1_EFFECT: "accuracy,-1,foe",
};

/** Primary status moves. Toxic is POISON_EFFECT with the badly-poisoned counter. */
const STATUS_MOVES: { [effect: string]: string } = {
  SLEEP_EFFECT: STATUS_SLEEP,
  POISON_EFFECT: STATUS_POISON,
  PARALYZE_EFFECT: STATUS_PARALYSIS,
};

/**
 * Side-effect status, with the ROM's own threshold out of 256. 26 is "10 percent
 * + 1" and 77 is "30 percent + 1": the rgbds macro rounds down, so the ROM adds
 * one to get back over the intended rate.
 */
const SIDE_STATUS: { [effect: string]: string } = {
  BURN_SIDE_EFFECT1: STATUS_BURN + ",26",
  BURN_SIDE_EFFECT2: STATUS_BURN + ",77",
  FREEZE_SIDE_EFFECT1: STATUS_FREEZE + ",26",
  PARALYZE_SIDE_EFFECT1: STATUS_PARALYSIS + ",26",
  PARALYZE_SIDE_EFFECT2: STATUS_PARALYSIS + ",77",
  POISON_SIDE_EFFECT1: STATUS_POISON + ",52",
  POISON_SIDE_EFFECT2: STATUS_POISON + ",103",
};

/** Flinch side effects: 26/256 and 77/256. */
const FLINCH_CHANCE: { [effect: string]: number } = {
  FLINCH_SIDE_EFFECT1: 26,
  FLINCH_SIDE_EFFECT2: 77,
};

/** Side-effect stat drops, all one stage at 85/256. */
const SIDE_STAT_DOWN: { [effect: string]: string } = {
  ATTACK_DOWN_SIDE_EFFECT: STAT_ATTACK,
  DEFENSE_DOWN_SIDE_EFFECT: STAT_DEFENSE,
  SPEED_DOWN_SIDE_EFFECT: STAT_SPEED,
  SPECIAL_DOWN_SIDE_EFFECT: STAT_SPECIAL,
};

/** How many times a move connects. TWO_TO_FIVE is the ROM's own weighted table. */
const MULTI_HIT: { [effect: string]: number } = {
  ATTACK_TWICE_EFFECT: 2,
  TWINEEDLE_EFFECT: 2,
};
const TWO_TO_FIVE: number[] = [2, 2, 2, 3, 3, 3, 4, 5];

/** Continuations of a trapping move: 1-4 more hits after the first, weighted. */
const TRAP_CONTINUATIONS: number[] = [1, 1, 1, 2, 2, 2, 3, 4];

/** Fixed damage, by move id. "level" and "psywave" are computed. */
const FIXED_DAMAGE: { [move: string]: number } = {
  SONICBOOM: 20,
  DRAGON_RAGE: 40,
};

/** The charge-turn line for each two-turn move. */
const CHARGE_TEXT: { [move: string]: string } = {
  FLY: "_FlewUpHighText",
  DIG: "_DugAHoleText",
  RAZOR_WIND: "_MadeWhirlwindText",
  SOLARBEAM: "_TookInSunlightText",
  SKULL_BASH: "_LoweredItsHeadText",
  SKY_ATTACK: "_SkyAttackGlowingText",
};

/**
 * The status and stat-lowering primaries run MoveHitTest; every other primary is
 * self-targeting and never rolls accuracy. Even Thunder Wave at 100% misses on
 * the 255 roll, because the ROM has no early-out for a perfect accuracy byte.
 */
const ACCURACY_CHECKED: { [effect: string]: boolean } = {
  SLEEP_EFFECT: true, POISON_EFFECT: true, PARALYZE_EFFECT: true,
  CONFUSION_EFFECT: true, LEECH_SEED_EFFECT: true, DISABLE_EFFECT: true,
  ATTACK_DOWN1_EFFECT: true, DEFENSE_DOWN1_EFFECT: true,
  DEFENSE_DOWN2_EFFECT: true, SPEED_DOWN1_EFFECT: true,
  ACCURACY_DOWN1_EFFECT: true,
};

/** Every effect resolved by runPrimary(): a move with no damage of its own. */
const PRIMARY_EFFECTS: { [effect: string]: boolean } = {
  ATTACK_UP1_EFFECT: true, ATTACK_UP2_EFFECT: true, DEFENSE_UP1_EFFECT: true,
  DEFENSE_UP2_EFFECT: true, SPEED_UP2_EFFECT: true, SPECIAL_UP1_EFFECT: true,
  SPECIAL_UP2_EFFECT: true, EVASION_UP1_EFFECT: true, ATTACK_DOWN1_EFFECT: true,
  DEFENSE_DOWN1_EFFECT: true, DEFENSE_DOWN2_EFFECT: true, SPEED_DOWN1_EFFECT: true,
  ACCURACY_DOWN1_EFFECT: true, SLEEP_EFFECT: true, POISON_EFFECT: true,
  PARALYZE_EFFECT: true, CONFUSION_EFFECT: true, LEECH_SEED_EFFECT: true,
  HEAL_EFFECT: true, LIGHT_SCREEN_EFFECT: true, REFLECT_EFFECT: true,
  MIST_EFFECT: true, FOCUS_ENERGY_EFFECT: true, HAZE_EFFECT: true,
  SUBSTITUTE_EFFECT: true, CONVERSION_EFFECT: true, TRANSFORM_EFFECT: true,
  DISABLE_EFFECT: true, SPLASH_EFFECT: true, MIMIC_EFFECT: true,
  BIDE_EFFECT: true, SWITCH_AND_TELEPORT_EFFECT: true,
};

// ---------------------------------------------------------------------------
// Random draws, the way the ROM makes them
// ---------------------------------------------------------------------------

/** One byte, 0..255. */
function byte(random: () => number): number {
  return Math.floor(random() * 256) & 0xff;
}

/** rng(lo, hi), inclusive at both ends. */
function range(random: () => number, lo: number, hi: number): number {
  const span = hi - lo + 1;
  const roll = lo + Math.floor(random() * span);
  return roll > hi ? hi : roll;
}

// ---------------------------------------------------------------------------
// The environment one move runs in
// ---------------------------------------------------------------------------

/**
 * Battle-scope state a move reads or writes that BattleMon does not model. The
 * caller owns this object and keeps it across the whole battle: `lastDamage` is
 * the ROM's shared damage word (wDamage) that Counter doubles, and `payDay`
 * accumulates the coins Pay Day scatters.
 */
export interface MoveEnv {
  bundle: any;
  random: () => number;
  user: BattleMon;
  target: BattleMon;
  userSide: BattleSide;
  targetSide: BattleSide;
  /** A wild battle: Teleport, Roar and Whirlwind can end it. */
  isWild: boolean;
  /** wDamage. Written by every hit, and by a drain move -- see GEN1 BUG below. */
  lastDamage: number;
  payDay: number;
  /** Set when the move ended the battle outright (Teleport, Roar, Whirlwind). */
  battleEnded: boolean;
  /** Metronome and Mirror Move recursion depth. 0 for a move the player chose. */
  callDepth: number;
}

/** An env for one side attacking the other, built from the battle context. */
export function moveEnv(battle: BattleContext, userIsPlayer: boolean): MoveEnv {
  const us = userIsPlayer ? battle.player : battle.foe;
  const them = userIsPlayer ? battle.foe : battle.player;
  return {
    bundle: battle.bundle,
    random: battle.random,
    user: us.active,
    target: them.active,
    userSide: us,
    targetSide: them,
    isWild: battle.isWild,
    lastDamage: 0,
    payDay: 0,
    battleEnded: false,
    callDepth: 0,
  };
}

/** A blank result for `moveId`, with every field at its documented "none". */
export function emptyResult(moveId: string): MoveResult {
  return {
    move: moveId,
    used: false,
    hit: false,
    failed: false,
    damage: 0,
    critical: false,
    effectiveness: 1,
    stab: false,
    hits: 0,
    recoil: 0,
    drained: 0,
    statusInflicted: STATUS_NONE,
    stageChanges: [],
    targetFainted: false,
    userFainted: false,
    messages: [],
  };
}

/** bundle.moves[id], or null. */
export function moveDef(bundle: any, moveId: string): MoveDef {
  if (!bundle || !bundle.moves || !moveId) {
    return null;
  }
  const def = bundle.moves[moveId];
  return def ? (def as MoveDef) : null;
}

// ---------------------------------------------------------------------------
// Small shared operations
// ---------------------------------------------------------------------------

function userName(env: MoveEnv): string {
  return displayName(env.user, env.userSide.isPlayer);
}
function targetName(env: MoveEnv): string {
  return displayName(env.target, env.targetSide.isPlayer);
}

/** A finished line: the cartridge's text with its placeholders filled in. */
function say(env: MoveEnv, result: MoveResult, id: string): void {
  result.messages.push(fill(romText(env.bundle, id), userName(env), targetName(env), "", 0));
}

/** The same, for a line whose {USER}/{TARGET} is neither side's active mon. */
function sayAbout(env: MoveEnv, result: MoveResult, id: string, who: string,
                  ram: string, num: number): void {
  result.messages.push(fill(romText(env.bundle, id), who, who, ram, num));
}

function failed(env: MoveEnv, result: MoveResult): MoveResult {
  result.failed = true;
  say(env, result, "_ButItFailedText");
  return result;
}

function getStage(stages: StatStages, stat: string): number {
  if (stat === STAT_ATTACK) return stages.attack;
  if (stat === STAT_DEFENSE) return stages.defense;
  if (stat === STAT_SPEED) return stages.speed;
  if (stat === STAT_SPECIAL) return stages.special;
  if (stat === STAT_ACCURACY) return stages.accuracy;
  return stages.evasion;
}

function setStage(stages: StatStages, stat: string, value: number): void {
  if (stat === STAT_ATTACK) stages.attack = value;
  else if (stat === STAT_DEFENSE) stages.defense = value;
  else if (stat === STAT_SPEED) stages.speed = value;
  else if (stat === STAT_SPECIAL) stages.special = value;
  else if (stat === STAT_ACCURACY) stages.accuracy = value;
  else stages.evasion = value;
}

/**
 * Stats.recalculateBattleStats() applied to the mon the caller already holds.
 * Every stat change in Gen 1 goes through this, and it is what makes the badge
 * boost compound -- Stats.ts owns that rule, this only routes through it.
 */
export function recalc(mon: BattleMon, badgeBits: number): void {
  const fresh = recalculateBattleStats(mon, badgeBits);
  mon.battleStats = fresh.battleStats;
  mon.badgeBoostPasses = fresh.badgeBoostPasses;
}

/**
 * One stat stage move. `fromEnemy` marks a change the opponent forced, which is
 * the only kind a Substitute or Mist can refuse.
 *
 * The ROM has no line for a Mist refusal -- there is no such label anywhere in
 * the extracted text table -- because Gen 1 sends it down the ordinary
 * PrintButItFailedText path. So Mist reads as "But, it failed!", which is right.
 */
export function changeStage(env: MoveEnv, onUser: boolean, stat: string,
                            delta: number, fromEnemy: boolean, isPrimary: boolean,
                            result: MoveResult): boolean {
  const who = onUser ? env.user : env.target;
  const side = onUser ? env.userSide : env.targetSide;
  const name = displayName(who, side.isPlayer);
  if (fromEnemy && (who.volatile.substituteHp > 0 || who.volatile.mist)) {
    // isPrimary keeps result.failed honest: a Bubblebeam that connected for real
    // damage has not "failed" just because the target's Speed was already at -6.
    result.failed = isPrimary;
    say(env, result, "_ButItFailedText");
    return false;
  }
  const before = getStage(who.stages, stat);
  const after = clampStage(before + delta);
  if (after === before) {
    if (isPrimary) {
      result.failed = true;
      say(env, result, "_NothingHappenedText");
    }
    return false;
  }
  setStage(who.stages, stat, after);
  recalc(who, side.badgeBits);
  const change: StageChange = { stat: stat, delta: after - before, onUser: onUser };
  result.stageChanges.push(change);

  const rising = delta > 0;
  const label = STAT_LABEL[stat] ? STAT_LABEL[stat] : stat;
  let line = fill(romText(env.bundle, rising ? "_MonsStatsRoseText" : "_MonsStatsFellText"),
                  name, name, label, 0);
  if (delta >= 2 || delta <= -2) {
    line = line + fill(romText(env.bundle, rising ? "_GreatlyRoseText" : "_GreatlyFellText"),
                       name, name, label, 0);
  }
  line = line + romText(env.bundle, rising ? "_RoseText" : "_FellText");
  result.messages.push(line);
  return true;
}

/**
 * Major status onto the target. Returns true when it landed.
 *
 * `secondary` marks the side effect of a damaging move, which a Substitute
 * blocks and which never lands when the move's own type is one of the target's
 * -- Body Slam cannot paralyse a Normal type, and Blizzard cannot freeze an Ice
 * one. Primary Sleep and Thunder Wave check neither: their handlers do not look
 * at the Substitute at all in Gen 1.
 */
export function inflictStatus(env: MoveEnv, status: string, move: MoveDef,
                              secondary: boolean, result: MoveResult): boolean {
  const target = env.target;
  if (target.status !== STATUS_NONE) {
    return false;
  }
  if (target.volatile.substituteHp > 0 && (secondary || status === STATUS_POISON)) {
    return false;
  }
  if (secondary && status !== STATUS_POISON && move && hasType(target.types, move.type)) {
    return false;
  }
  if (status === STATUS_FREEZE && hasType(target.types, "ICE")) {
    return false;
  }
  if (status === STATUS_BURN && hasType(target.types, "FIRE")) {
    return false;
  }
  if (status === STATUS_POISON && hasType(target.types, "POISON")) {
    return false;
  }
  // ParalyzeEffect_: an Electric move cannot paralyse a Ground type. The check is
  // on the MOVE's type, so Body Slam still paralyses Diglett.
  if (status === STATUS_PARALYSIS && move && move.type === "ELECTRIC" &&
      hasType(target.types, "GROUND")) {
    return false;
  }

  target.status = status;
  result.statusInflicted = status;
  if (status === STATUS_SLEEP) {
    // The ROM masks a random byte and redraws on zero, which is a variable number
    // of draws rather than one. Same distribution, different stream.
    target.sleepTurns = rollSleepTurns(env.random);
    say(env, result, "_FellAsleepText");
  } else if (status === STATUS_POISON) {
    if (move && move.id === "TOXIC") {
      target.volatile.badlyPoisoned = 1;
      say(env, result, "_BadlyPoisonedText");
    } else {
      say(env, result, "_PoisonedText");
    }
  } else if (status === STATUS_BURN) {
    say(env, result, "_BurnedText");
  } else if (status === STATUS_FREEZE) {
    say(env, result, "_FrozenText");
  } else {
    say(env, result, "_ParalyzedMayNotAttackText");
  }
  // Burn halves Attack and paralysis quarters Speed, and Gen 1 bakes both into
  // the working stats the moment the status lands. It does NOT spend a badge boost
  // pass doing it: HalveAttackDueToBurn never calls ApplyBadgeStatBoosts, so the
  // badge bug does not tick here the way it does on a stat stage change.
  if (status === STATUS_BURN || status === STATUS_PARALYSIS) {
    restat(target, env.targetSide.badgeBits);
  }
  return true;
}

/** Confusion, 2..5 turns. `pierceSub` is the secondary path, which ignores a Substitute. */
function confuse(env: MoveEnv, pierceSub: boolean, result: MoveResult): boolean {
  const target = env.target;
  if (target.volatile.confusionTurns > 0 ||
      (target.volatile.substituteHp > 0 && !pierceSub)) {
    return false;
  }
  target.volatile.confusionTurns = rollConfusionTurns(env.random);
  say(env, result, "_BecameConfusedText");
  return true;
}

/**
 * Damage onto a Pokemon, honouring its Substitute, its Bide store and its Rage.
 * Returns what counts as dealt: a Substitute absorbs the full amount, which is
 * why recoil and drain off a Substitute use the raw number.
 */
export function applyDamageTo(env: MoveEnv, onUser: boolean, amount: number,
                              result: MoveResult): number {
  const who = onUser ? env.user : env.target;
  const side = onUser ? env.userSide : env.targetSide;
  const name = displayName(who, side.isPlayer);
  if (who.volatile.substituteHp > 0) {
    who.volatile.substituteHp = who.volatile.substituteHp - amount;
    if (who.volatile.substituteHp <= 0) {
      who.volatile.substituteHp = 0;
      sayAbout(env, result, "_SubstituteBrokeText", name, "", 0);
    } else {
      sayAbout(env, result, "_SubstituteTookDamageText", name, "", 0);
    }
    return amount;
  }
  const dealt = amount > who.hp ? who.hp : amount;
  who.hp = who.hp - dealt;
  if (who.volatile.bideTurns > 0) {
    who.volatile.bideDamage = who.volatile.bideDamage + dealt;
  }
  if (who.volatile.rageActive && dealt > 0 && who.stages.attack < 6) {
    who.stages.attack = who.stages.attack + 1;
    recalc(who, side.badgeBits);
    sayAbout(env, result, "_BuildingRageText", name, "", 0);
  }
  return dealt;
}

// ---------------------------------------------------------------------------
// Primary effects: a move that does no damage of its own
// ---------------------------------------------------------------------------

function runHeal(env: MoveEnv, move: MoveDef, result: MoveResult): MoveResult {
  const user = env.user;
  // GEN1 BUG: HealEffect_ compares only the LOW BYTE of (max HP - current HP)
  // against $FF, so a Pokemon missing exactly 255 or 511 HP cannot be healed at
  // all. Recover, Softboiled and Rest all share the routine. Left in on purpose:
  // it is the reason a Chansey at 448/703 refuses to Softboiled.
  const missing = user.maxHp - user.hp;
  if ((missing & 0xff) === 255) {
    return failed(env, result);
  }
  if (move.id === "REST") {
    if (missing === 0) {
      return failed(env, result);
    }
    const hadStatus = user.status !== STATUS_NONE;
    user.hp = user.maxHp;
    user.status = STATUS_SLEEP;
    user.sleepTurns = 2;
    user.volatile.badlyPoisoned = 0;
    recalc(user, env.userSide.badgeBits);
    say(env, result, hadStatus ? "_FellAsleepBecameHealthyText" : "_StartedSleepingEffect");
    return result;
  }
  if (missing === 0) {
    return failed(env, result);
  }
  const heal = Math.floor(user.maxHp / 2);
  user.hp = user.hp + heal > user.maxHp ? user.maxHp : user.hp + heal;
  say(env, result, "_RegainedHealthText");
  return result;
}

function runSubstitute(env: MoveEnv, result: MoveResult): MoveResult {
  const user = env.user;
  if (user.volatile.substituteHp > 0) {
    result.failed = true;
    say(env, result, "_HasSubstituteText");
    return result;
  }
  const cost = Math.floor(user.maxHp / 4);
  // GEN1 BUG: the ROM subtracts the cost and fails only when the subtraction
  // borrows, so a user at EXACTLY a quarter of its max HP builds the doll and is
  // left on zero -- Substitute can knock its own user out. The reference
  // implementation deliberately fails at the boundary instead, to protect its own
  // turn loop; the contract here carries userFainted, so the original stands.
  if (user.hp < cost) {
    result.failed = true;
    say(env, result, "_TooWeakSubstituteText");
    return result;
  }
  user.hp = user.hp - cost;
  // The doll takes a quarter of max HP plus one.
  user.volatile.substituteHp = cost + 1;
  say(env, result, "_SubstituteText");
  if (user.hp <= 0) {
    result.userFainted = true;
  }
  return result;
}

function runHaze(env: MoveEnv, result: MoveResult): MoveResult {
  const both: BattleMon[] = [env.user, env.target];
  const sides: BattleSide[] = [env.userSide, env.targetSide];
  for (let i = 0; i < both.length; i++) {
    const mon = both[i];
    mon.stages = zeroStages();
    mon.volatile.confusionTurns = 0;
    mon.volatile.seeded = false;
    mon.volatile.badlyPoisoned = 0;
    mon.volatile.reflect = false;
    mon.volatile.lightScreen = false;
    mon.volatile.mist = false;
    mon.volatile.focusEnergy = false;
    mon.volatile.disabledSlot = -1;
    mon.volatile.disabledTurns = 0;
    recalc(mon, sides[i].badgeBits);
  }
  // Haze also clears the OPPONENT's major status, and only the opponent's.
  env.target.status = STATUS_NONE;
  env.target.sleepTurns = 0;
  recalc(env.target, env.targetSide.badgeBits);
  say(env, result, "_StatusChangesEliminatedText");
  // NOT reproduced: haze.asm's ResetStats copies each side's unmodified stats
  // over its battle stats, which lifts the burn and paralysis penalties on BOTH
  // battlers until the next stat recompute. battleStatsFor() always re-applies
  // them and BattleMon has no field to record the suspension, so the penalty
  // here survives Haze where the cartridge's does not.
  return result;
}

function runTransform(env: MoveEnv, result: MoveResult): MoveResult {
  const user = env.user;
  const target = env.target;
  // transform.asm copies the target's unmodified stats except HP, its types, its
  // stat mods (it copies them, it does not clear them) and its moves at 5 PP.
  user.stats = {
    hp: user.stats.hp,
    attack: target.stats.attack,
    defense: target.stats.defense,
    speed: target.stats.speed,
    special: target.stats.special,
  };
  const types: string[] = [];
  for (let i = 0; i < target.types.length; i++) {
    types.push(target.types[i]);
  }
  user.types = types;
  user.stages = {
    attack: target.stages.attack,
    defense: target.stages.defense,
    speed: target.stages.speed,
    special: target.stages.special,
    accuracy: target.stages.accuracy,
    evasion: target.stages.evasion,
  };
  const moves: any[] = [];
  for (let i = 0; i < target.moves.length; i++) {
    moves.push({ id: target.moves[i].id, pp: 5, maxPp: 5 });
  }
  user.moves = moves;
  user.volatile.transformed = true;
  recalc(user, env.userSide.badgeBits);
  result.messages.push(fill(romText(env.bundle, "_TransformedText"),
                            userName(env), targetName(env), target.name, 0));
  return result;
}

function runDisable(env: MoveEnv, result: MoveResult): MoveResult {
  const target = env.target;
  if (target.volatile.disabledSlot >= 0) {
    return failed(env, result);
  }
  const usable: number[] = [];
  for (let i = 0; i < target.moves.length; i++) {
    if (target.moves[i].id !== "" && target.moves[i].pp > 0) {
      usable.push(i);
    }
  }
  if (usable.length === 0) {
    return failed(env, result);
  }
  const slot = usable[range(env.random, 0, usable.length - 1)];
  target.volatile.disabledSlot = slot;
  target.volatile.disabledTurns = range(env.random, 1, 8);
  const def = moveDef(env.bundle, target.moves[slot].id);
  result.messages.push(fill(romText(env.bundle, "_MoveWasDisabledText"),
                            userName(env), targetName(env), def ? def.name : "", 0));
  return result;
}

function runMimic(env: MoveEnv, result: MoveResult): MoveResult {
  // effects.asm gives the player a copy menu and the enemy a random pick. The
  // menu is the turn loop's flow, not this file's, so both sides pick at random
  // here; a UI that offers the choice can overwrite the slot afterwards.
  const target = env.target;
  const options: number[] = [];
  for (let i = 0; i < target.moves.length; i++) {
    if (target.moves[i].id !== "") {
      options.push(i);
    }
  }
  if (options.length === 0) {
    return failed(env, result);
  }
  const picked = target.moves[options[range(env.random, 0, options.length - 1)]];
  let slot = -1;
  for (let i = 0; i < env.user.moves.length; i++) {
    if (env.user.moves[i].id === "MIMIC") {
      slot = i;
    }
  }
  if (slot < 0) {
    return failed(env, result);
  }
  env.user.moves[slot] = { id: picked.id, pp: 5, maxPp: 5 };
  const def = moveDef(env.bundle, picked.id);
  result.messages.push(fill(romText(env.bundle, "_MimicLearnedMoveText"),
                            userName(env), targetName(env), def ? def.name : picked.id, 0));
  return result;
}

/**
 * Teleport, Roar and Whirlwind. In a wild battle the user leaves outright when
 * its level is at least the opponent's; otherwise it rolls, and FAILS when the
 * roll lands below a quarter of the opponent's level. In a trainer battle
 * Teleport fails and Roar and Whirlwind are simply unaffected.
 */
function runSwitchAndTeleport(env: MoveEnv, move: MoveDef, result: MoveResult): MoveResult {
  if (!env.isWild) {
    result.failed = true;
    say(env, result, move.id === "TELEPORT" ? "_ButItFailedText" : "_IsUnaffectedText");
    return result;
  }
  const userLevel = env.user.level;
  const foeLevel = env.target.level;
  let ok = userLevel >= foeLevel;
  if (!ok) {
    ok = range(env.random, 0, userLevel + foeLevel) >= Math.floor(foeLevel / 4);
  }
  if (!ok) {
    result.failed = true;
    say(env, result, move.id === "TELEPORT" ? "_ButItFailedText" : "_DidntAffectText");
    return result;
  }
  env.battleEnded = true;
  if (move.id === "ROAR") {
    say(env, result, "_RanAwayScaredText");
  } else if (move.id === "WHIRLWIND") {
    say(env, result, "_WasBlownAwayText");
  } else {
    say(env, result, "_RanFromBattleText");
  }
  return result;
}

function runPrimary(env: MoveEnv, move: MoveDef, result: MoveResult): MoveResult {
  const effect = move.effect;
  const user = env.user;
  const target = env.target;

  // Gen 1's enemy AI whiffs a stat-lowering move 64 times in 256 for no reason
  // anyone has ever explained (effects.asm:552). Player-side moves never do.
  if (ACCURACY_CHECKED[effect] && STAGE_MOVES[effect] && !env.userSide.isPlayer &&
      byte(env.random) < 64) {
    say(env, result, "_AttackMissedText");
    return result;
  }
  if (ACCURACY_CHECKED[effect]) {
    if (target.volatile.invulnerable ||
        !rollMoveHits(user, target, move, env.random)) {
      say(env, result, "_AttackMissedText");
      return result;
    }
  }
  result.hit = true;

  const stageSpec = STAGE_MOVES[effect];
  if (stageSpec) {
    const parts = stageSpec.split(",");
    const onUser = parts[2] === "user";
    changeStage(env, onUser, parts[0], parseInt(parts[1], 10), !onUser, true, result);
    return result;
  }

  const status = STATUS_MOVES[effect];
  if (status) {
    if (target.status !== STATUS_NONE) {
      // The ROM names the condition when the target is already asleep and a sleep
      // move is used; every other clash prints the generic failure.
      if (status === STATUS_SLEEP && target.status === STATUS_SLEEP) {
        result.failed = true;
        say(env, result, "_AlreadyAsleepText");
        return result;
      }
      return failed(env, result);
    }
    if (!inflictStatus(env, status, move, false, result)) {
      return failed(env, result);
    }
    return result;
  }

  if (effect === "CONFUSION_EFFECT") {
    if (!confuse(env, false, result)) {
      return failed(env, result);
    }
    return result;
  }
  if (effect === "LEECH_SEED_EFFECT") {
    // leech_seed.asm has no Substitute check: a seed lands through the doll.
    if (target.volatile.seeded || hasType(target.types, "GRASS")) {
      return failed(env, result);
    }
    target.volatile.seeded = true;
    say(env, result, "_WasSeededText");
    return result;
  }
  if (effect === "HEAL_EFFECT") {
    return runHeal(env, move, result);
  }
  if (effect === "LIGHT_SCREEN_EFFECT") {
    if (user.volatile.lightScreen) {
      return failed(env, result);
    }
    user.volatile.lightScreen = true;
    say(env, result, "_LightScreenProtectedText");
    return result;
  }
  if (effect === "REFLECT_EFFECT") {
    if (user.volatile.reflect) {
      return failed(env, result);
    }
    user.volatile.reflect = true;
    say(env, result, "_ReflectGainedArmorText");
    return result;
  }
  if (effect === "MIST_EFFECT") {
    if (user.volatile.mist) {
      return failed(env, result);
    }
    user.volatile.mist = true;
    say(env, result, "_ShroudedInMistText");
    return result;
  }
  if (effect === "FOCUS_ENERGY_EFFECT") {
    if (user.volatile.focusEnergy) {
      return failed(env, result);
    }
    // GEN1 BUG: this makes the user crit a QUARTER as often. Damage.critChance()
    // owns the arithmetic; all this does is set the flag.
    user.volatile.focusEnergy = true;
    say(env, result, "_GettingPumpedText");
    return result;
  }
  if (effect === "HAZE_EFFECT") {
    return runHaze(env, result);
  }
  if (effect === "SUBSTITUTE_EFFECT") {
    return runSubstitute(env, result);
  }
  if (effect === "CONVERSION_EFFECT") {
    if (target.volatile.invulnerable) {
      return failed(env, result);
    }
    const copied: string[] = [];
    for (let i = 0; i < target.types.length; i++) {
      copied.push(target.types[i]);
    }
    user.types = copied;
    say(env, result, "_ConvertedTypeText");
    return result;
  }
  if (effect === "TRANSFORM_EFFECT") {
    return runTransform(env, result);
  }
  if (effect === "DISABLE_EFFECT") {
    return runDisable(env, result);
  }
  if (effect === "MIMIC_EFFECT") {
    return runMimic(env, result);
  }
  if (effect === "SPLASH_EFFECT") {
    say(env, result, "_NoEffectText");
    return result;
  }
  if (effect === "BIDE_EFFECT") {
    user.volatile.bideTurns = range(env.random, 2, 3);
    user.volatile.bideDamage = 0;
    say(env, result, "_SavingEnergyText");
    return result;
  }
  if (effect === "SWITCH_AND_TELEPORT_EFFECT") {
    return runSwitchAndTeleport(env, move, result);
  }
  return failed(env, result);
}

// ---------------------------------------------------------------------------
// Secondary effects: what a damaging move does after it connects
// ---------------------------------------------------------------------------

function runSecondary(env: MoveEnv, move: MoveDef, result: MoveResult): void {
  const effect = move.effect;
  const target = env.target;

  const sideStatus = SIDE_STATUS[effect];
  if (sideStatus) {
    const parts = sideStatus.split(",");
    // CheckDefrost: a Fire move with a burn chance thaws a frozen target when it
    // lands, whatever the burn roll then does.
    if (move.type === "FIRE" && target.status === STATUS_FREEZE) {
      target.status = STATUS_NONE;
      say(env, result, "_FireDefrostedText");
      return;
    }
    if (byte(env.random) >= parseInt(parts[1], 10)) {
      return;
    }
    inflictStatus(env, parts[0], move, true, result);
    return;
  }
  if (effect === "TWINEEDLE_EFFECT") {
    // The second needle reroutes into PoisonEffect at POISON_SIDE_EFFECT1's rate.
    if (byte(env.random) >= 52) {
      return;
    }
    inflictStatus(env, STATUS_POISON, move, true, result);
    return;
  }
  const flinch = FLINCH_CHANCE[effect];
  if (flinch) {
    if (target.volatile.substituteHp > 0) {
      return;
    }
    if (byte(env.random) < flinch) {
      target.volatile.flinched = true;
    }
    return;
  }
  const statDown = SIDE_STAT_DOWN[effect];
  if (statDown) {
    // The same unexplained 64/256 enemy whiff as the primary stat moves.
    if (!env.userSide.isPlayer && byte(env.random) < 64) {
      return;
    }
    if (target.volatile.substituteHp > 0) {
      return;
    }
    if (byte(env.random) >= 85) {
      return;
    }
    // StatModifierDownEffect's side-effect branch never runs MoveHitTest, so this
    // drop pierces Mist -- only a primary stat-lowering move is refused by it.
    changeStage(env, false, statDown, -1, false, false, result);
    return;
  }
  if (effect === "CONFUSION_SIDE_EFFECT") {
    // 25/256, and ConfusionSideEffect never checks the Substitute, so secondary
    // confusion lands through a doll where primary confusion does not.
    if (byte(env.random) >= 25) {
      return;
    }
    confuse(env, true, result);
  }
}

// ---------------------------------------------------------------------------
// The damaging pipeline
// ---------------------------------------------------------------------------

/** How many times this move connects, drawn before anything else. */
function hitCount(env: MoveEnv, move: MoveDef): number {
  const fixed = MULTI_HIT[move.effect];
  if (fixed) {
    return fixed;
  }
  if (move.effect === "TWO_TO_FIVE_ATTACKS_EFFECT") {
    return TWO_TO_FIVE[range(env.random, 0, TWO_TO_FIVE.length - 1)];
  }
  return 1;
}

/**
 * Explosion and Selfdestruct halve the target's Defense, and the ROM does it
 * AFTER the "either stat over a byte quarters both" scaling. Damage.computeDamage
 * owns that scaling, so the halving has to be folded into the stats it is handed:
 * quarter both here first, which makes its own scaling a no-op, then halve. The
 * screens are folded in for the same reason.
 */
function explodePair(env: MoveEnv, special: boolean, critical: boolean,
                     screened: boolean): BattleMon[] {
  const attacker = cloneMon(env.user);
  const defender = cloneMon(env.target);
  let a: number;
  let d: number;
  if (critical) {
    a = special ? attacker.stats.special : attacker.stats.attack;
    d = special ? defender.stats.special : defender.stats.defense;
  } else {
    a = special ? attacker.battleStats.special : attacker.battleStats.attack;
    d = special ? defender.battleStats.special : defender.battleStats.defense;
    if (screened) {
      d = d * 2;
    }
  }
  if (a > 255 || d > 255) {
    a = Math.floor(a / 4);
    d = Math.floor(d / 4);
    if (a < 1) a = 1;
    if (d < 1) d = 1;
  }
  d = Math.floor(d / 2);
  if (d < 1) d = 1;
  if (critical) {
    if (special) {
      attacker.stats.special = a;
      defender.stats.special = d;
    } else {
      attacker.stats.attack = a;
      defender.stats.defense = d;
    }
  } else if (special) {
    attacker.battleStats.special = a;
    defender.battleStats.special = d;
  } else {
    attacker.battleStats.attack = a;
    defender.battleStats.defense = d;
  }
  return [attacker, defender];
}

/** Seismic Toss, Night Shade, Sonicboom, Dragon Rage, Psywave. */
function fixedDamage(env: MoveEnv, move: MoveDef): number {
  const known = FIXED_DAMAGE[move.id];
  if (known) {
    return known;
  }
  if (move.id === "PSYWAVE") {
    const top = Math.floor((env.user.level * 3) / 2) - 1;
    return range(env.random, 1, top < 1 ? 1 : top);
  }
  // Seismic Toss and Night Shade: the user's level, flat.
  return env.user.level;
}

function missMessage(env: MoveEnv, move: MoveDef, result: MoveResult): MoveResult {
  // Everything that routes through here sets the ROM's wMoveMissed, whether it
  // was the accuracy roll, a mid-Fly target, a Counter with nothing to counter or
  // damage floored to zero -- so the result has to read as a miss even when the
  // accuracy roll had already passed.
  result.hit = false;
  say(env, result, "_AttackMissedText");
  // A trapping move that misses releases its victim at once.
  if (move.effect === "TRAPPING_EFFECT") {
    env.user.volatile.trapping = false;
    env.user.volatile.trapTurns = 0;
    env.target.volatile.trapTurns = 0;
  }
  if (move.effect === "JUMP_KICK_EFFECT") {
    // GEN1 BUG: the crash costs exactly one HP. The ROM means to take half the
    // damage the kick would have done, but it reads the damage word before it is
    // written, and the routine leaves 1 there. Kept: a Hitmonlee that misses Hi
    // Jump Kick from full health is not supposed to be in trouble.
    result.recoil = result.recoil + applyDamageTo(env, true, 1, result);
    say(env, result, "_KeptGoingAndCrashedText");
    if (env.user.hp <= 0) {
      result.userFainted = true;
    }
  }
  if (move.effect === "EXPLODE_EFFECT") {
    // core.asm:3223 -- "even if Explosion or Selfdestruct missed, its effect
    // still needs to be activated".
    env.user.hp = 0;
    result.userFainted = true;
  }
  return result;
}

function runDamaging(env: MoveEnv, move: MoveDef, result: MoveResult): MoveResult {
  const user = env.user;
  const target = env.target;
  const effect = move.effect;
  const neverMiss = effect === "SWIFT_EFFECT";

  // Thrash and Petal Dance lock the user in, and the counter runs before the
  // move resolves. The setup turn does not tick.
  if (effect === "THRASH_PETAL_DANCE_EFFECT") {
    if (user.volatile.thrashTurns > 0) {
      say(env, result, "_ThrashingAboutText");
      user.volatile.thrashTurns = user.volatile.thrashTurns - 1;
      if (user.volatile.thrashTurns === 0 && user.volatile.confusionTurns === 0) {
        user.volatile.confusionTurns = range(env.random, 2, 5);
      }
    } else {
      // 2 or 3 continuations, so 3 or 4 attacks in all, then confusion.
      user.volatile.thrashTurns = range(env.random, 2, 3);
    }
  }
  // TrappingEffect runs before the hit test and clears the target's Hyper Beam
  // recharge even when the trapping move then misses.
  if (effect === "TRAPPING_EFFECT" && !user.volatile.trapping) {
    target.volatile.recharging = false;
  }

  // Swift ignores a mid-Fly or mid-Dig target; nothing else does.
  if (target.volatile.invulnerable && !neverMiss) {
    return missMessage(env, move, result);
  }

  if (effect === "OHKO_EFFECT") {
    const chart = typeChartFor(env.bundle);
    if (chart.effectiveness(move.type, target.types) === 0) {
      result.effectiveness = 0;
      say(env, result, "_DoesntAffectMonText");
      return result;
    }
    // A one-hit KO never lands on something faster. battleStats.speed already
    // carries stages, badges and paralysis, which is what the ROM compares.
    if (user.battleStats.speed < target.battleStats.speed) {
      return failed(env, result);
    }
  }
  if (effect === "DREAM_EATER_EFFECT" && target.status !== STATUS_SLEEP) {
    return failed(env, result);
  }

  const hits = hitCount(env, move);

  if (!neverMiss && !rollMoveHits(user, target, move, env.random)) {
    return missMessage(env, move, result);
  }
  result.hit = true;

  // ---- how much this hit is worth -------------------------------------------
  let damage = 0;
  let critical = false;
  let ohko = false;
  let typeless = false;

  if (move.id === "COUNTER") {
    // HandleCounterMove: twice the last damage anyone dealt, but only when the
    // opponent's last move was a Normal or Fighting move with real power, and
    // never Counter itself. wDamage is shared between the sides, which is why a
    // drain move's own write can be countered -- see the drain branch below.
    const lastId = target.volatile.lastMoveUsed;
    const lastMove = lastId !== "" && lastId !== "COUNTER" ? moveDef(env.bundle, lastId) : null;
    const counterable = lastMove !== null && lastMove.power > 0 &&
      (lastMove.type === "NORMAL" || lastMove.type === "FIGHTING");
    if (!counterable || env.lastDamage <= 0) {
      return missMessage(env, move, result);
    }
    damage = env.lastDamage * 2;
    if (damage > 65535) {
      damage = 65535;
    }
    typeless = true;
  } else if (effect === "SPECIAL_DAMAGE_EFFECT") {
    // SetDamageEffects jumps straight past AdjustDamageForMoveType, so fixed
    // damage never meets the type chart at all. GEN1 BUG, and a famous one:
    // Night Shade hits a Normal type and Dragon Rage hits anything.
    damage = fixedDamage(env, move);
    typeless = true;
  } else if (effect === "SUPER_FANG_EFFECT") {
    // The same table, so Super Fang halves a Ghost's HP.
    damage = Math.floor(target.hp / 2);
    if (damage < 1) {
      damage = 1;
    }
    typeless = true;
  } else if (effect === "OHKO_EFFECT") {
    damage = 65535;
    ohko = true;
    typeless = true;
  } else {
    critical = rollCritical(env.bundle, user, move, env.random);
    const special = isSpecialType(move.type);
    const screened = !critical &&
      (special ? target.volatile.lightScreen : target.volatile.reflect);
    const roll = damageRoll(env.random);
    let attacker = user;
    let defender = target;
    let screenOption = screened;
    if (effect === "EXPLODE_EFFECT") {
      const pair = explodePair(env, special, critical, screened);
      attacker = pair[0];
      defender = pair[1];
      screenOption = false;
    }
    const computed = computeDamage(env.bundle, attacker, defender, move, {
      critical: critical,
      screened: screenOption,
      roll: roll,
      power: 0,
      type: "",
    });
    damage = computed.damage;
    result.effectiveness = computed.effectiveness;
    result.stab = computed.stab;

    if (computed.effectiveness === 0) {
      // A type immunity zeroes the damage and sets wMoveMissed, so the move did
      // not connect -- see the note on MoveResult.hit at the top of this file.
      result.hit = false;
      say(env, result, "_DoesntAffectMonText");
      if (effect === "EXPLODE_EFFECT") {
        user.hp = 0;
        result.userFainted = true;
      }
      return result;
    }
    if (damage === 0) {
      // GEN1 BUG: a two or three point hit taken to 0.25x floors to zero, and the
      // ROM records that as a miss rather than dealing a minimum of one.
      return missMessage(env, move, result);
    }
  }

  result.critical = critical;
  if (typeless) {
    result.effectiveness = 1;
  }
  env.lastDamage = damage;

  // ---- landing it -----------------------------------------------------------
  let dealt = 0;
  let landed = 0;
  let brokeSub = false;
  for (let h = 0; h < hits; h++) {
    if (target.hp <= 0) {
      break;
    }
    const hadSub = target.volatile.substituteHp > 0;
    dealt = dealt + applyDamageTo(env, false, damage, result);
    landed = h + 1;
    if (critical && h === 0) {
      say(env, result, "_CriticalHitText");
    }
    if (ohko && h === 0) {
      say(env, result, "_OHKOText");
    }
    // Gen 1 prints the effectiveness line once per landed hit, not once per move.
    if (result.effectiveness > 1) {
      say(env, result, "_SuperEffectiveText");
    } else if (result.effectiveness < 1 && result.effectiveness > 0) {
      say(env, result, "_NotVeryEffectiveText");
    }
    if (hadSub && target.volatile.substituteHp === 0) {
      // Breaking the doll ends a multi-hit move where it stands.
      brokeSub = true;
      break;
    }
  }
  result.damage = dealt;
  result.hits = landed;
  if (landed > 1) {
    result.messages.push(fill(romText(env.bundle,
      env.userSide.isPlayer ? "_MultiHitText" : "_HitXTimesText"),
      userName(env), targetName(env), "", landed));
  }

  // ---- what it costs, and what it leaves behind -----------------------------
  if (effect === "RECOIL_EFFECT") {
    const divisor = move.id === "STRUGGLE" ? 2 : 4;
    let recoil = Math.floor(dealt / divisor);
    if (recoil < 1) {
      recoil = 1;
    }
    say(env, result, "_HitWithRecoilText");
    result.recoil = applyDamageTo(env, true, recoil, result);
  } else if (effect === "DRAIN_HP_EFFECT" || effect === "DREAM_EATER_EFFECT") {
    let heal = Math.floor(dealt / 2);
    if (heal < 1) {
      heal = 1;
    }
    // GEN1 BUG: the drain writes the healed amount into the shared damage word,
    // so a Counter that follows an Absorb returns twice what was HEALED rather
    // than twice what was dealt.
    env.lastDamage = heal;
    user.hp = user.hp + heal > user.maxHp ? user.maxHp : user.hp + heal;
    result.drained = heal;
    say(env, result, effect === "DRAIN_HP_EFFECT" ? "_SuckedHealthText" : "_DreamWasEatenText");
  } else if (effect === "TRAPPING_EFFECT") {
    if (!user.volatile.trapping) {
      user.volatile.trapping = true;
      user.volatile.trapTurns = TRAP_CONTINUATIONS[range(env.random, 0, 7)];
      // effectCounter is the slot the contract reserves for "a counter the effect
      // owns": here it is the damage every locked turn repeats, unchanged.
      user.volatile.effectCounter = damage;
      target.volatile.trapTurns = user.volatile.trapTurns;
    }
  } else if (effect === "HYPER_BEAM_EFFECT") {
    // GEN1 BUG: no recharge when the target faints or its Substitute breaks, so
    // a Hyper Beam that finishes something is free.
    if (target.hp > 0 && !brokeSub) {
      user.volatile.recharging = true;
    }
  } else if (effect === "PAY_DAY_EFFECT") {
    env.payDay = env.payDay + 2 * user.level;
    say(env, result, "_CoinsScatteredText");
  } else if (effect === "RAGE_EFFECT") {
    user.volatile.rageActive = true;
  } else if (effect === "EXPLODE_EFFECT") {
    user.hp = 0;
    result.userFainted = true;
  }

  // Side effects are blocked by a target that is already down, and by a move
  // that connected for nothing.
  if (target.hp > 0 && dealt > 0) {
    runSecondary(env, move, result);
  }
  if (target.hp <= 0) {
    result.targetFainted = true;
  }
  if (user.hp <= 0) {
    result.userFainted = true;
  }
  return result;
}

// ---------------------------------------------------------------------------
// One move, start to finish
// ---------------------------------------------------------------------------

/** The ROM's move table in move-number order, 1..165, built once per bundle. */
let orderBundle: any = null;
let orderIds: string[] = null;

export function moveOrder(bundle: any): string[] {
  if (orderBundle === bundle && orderIds !== null) {
    return orderIds;
  }
  const byIndex: string[] = [];
  const ids = Object.keys(bundle.moves);
  for (let i = 0; i < ids.length; i++) {
    byIndex[bundle.moves[ids[i]].index] = ids[i];
  }
  const ordered: string[] = [];
  for (let i = 1; i < byIndex.length; i++) {
    if (byIndex[i]) {
      ordered.push(byIndex[i]);
    }
  }
  orderBundle = bundle;
  orderIds = ordered;
  return ordered;
}

/**
 * One Pokemon uses one move. The mons in `env` are mutated in place and the
 * result carries everything the message box, the HP bars and the AI need.
 *
 * PP is not touched: the caller decides, because a Metronome pick, a Mirror Move
 * copy and a locked Thrash turn all cost nothing.
 */
export function useMove(env: MoveEnv, moveId: string): MoveResult {
  const result = emptyResult(moveId);
  const move = moveDef(env.bundle, moveId);
  if (move === null) {
    result.failed = true;
    return result;
  }
  result.used = true;
  const user = env.user;

  // Metronome and Mirror Move never resolve themselves: they hand off, and the
  // move they pick is the one that records itself as the user's last.
  if (move.effect === "METRONOME_EFFECT") {
    // MetronomePickMove rerolls until the pick is neither Metronome nor Struggle,
    // so Metronome can never call itself. The depth guard is for the other door:
    // Mirror Move copying a Metronome, which would otherwise recurse.
    if (env.callDepth > 0) {
      return failed(env, result);
    }
    const order = moveOrder(env.bundle);
    let pick = "";
    for (let attempt = 0; attempt < 64 && pick === ""; attempt++) {
      const candidate = order[range(env.random, 0, order.length - 1)];
      if (candidate !== "METRONOME" && candidate !== "STRUGGLE") {
        pick = candidate;
      }
    }
    if (pick === "") {
      return failed(env, result);
    }
    return callMove(env, pick, result);
  }
  if (move.effect === "MIRROR_MOVE_EFFECT") {
    const last = env.target.volatile.lastMoveUsed;
    if (last === "" || env.callDepth > 0) {
      result.failed = true;
      say(env, result, "_MirrorMoveFailedText");
      return result;
    }
    return callMove(env, last, result);
  }

  // Two-turn moves. The first use charges and the second releases; the caller
  // reads volatile.chargingMove to know it must offer the same move again.
  const charging = move.effect === "CHARGE_EFFECT" || move.effect === "FLY_EFFECT";
  if (charging) {
    if (user.volatile.chargingMove === moveId) {
      user.volatile.chargingMove = "";
      user.volatile.invulnerable = false;
    } else {
      user.volatile.chargingMove = moveId;
      // ChargeEffect sets INVULNERABLE for Fly and for Dig, and for nothing else.
      user.volatile.invulnerable = move.effect === "FLY_EFFECT" || moveId === "DIG";
      user.volatile.lastMoveUsed = moveId;
      const line = CHARGE_TEXT[moveId];
      result.messages.push(fill(romText(env.bundle, "_ChargeMoveEffectText"),
                                userName(env), targetName(env), "", 0) +
                           (line ? romText(env.bundle, line) : ""));
      return result;
    }
  }

  user.volatile.lastMoveUsed = moveId;

  if (move.power === 0 && PRIMARY_EFFECTS[move.effect]) {
    return runPrimary(env, move, result);
  }
  return runDamaging(env, move, result);
}

/** Metronome's and Mirror Move's hand-off: the called move keeps the caller's messages. */
function callMove(env: MoveEnv, moveId: string, outer: MoveResult): MoveResult {
  env.callDepth = env.callDepth + 1;
  const inner = useMove(env, moveId);
  env.callDepth = env.callDepth - 1;
  const merged: string[] = [];
  for (let i = 0; i < outer.messages.length; i++) {
    merged.push(outer.messages[i]);
  }
  for (let i = 0; i < inner.messages.length; i++) {
    merged.push(inner.messages[i]);
  }
  inner.messages = merged;
  return inner;
}

// ---------------------------------------------------------------------------
// The turns a move owns after the one it was chosen on
// ---------------------------------------------------------------------------

/**
 * A locked turn of Wrap, Bind, Fire Spin or Clamp: the same damage again, no
 * accuracy roll and no new damage roll. The counter can sit at zero until the end
 * of the turn, because Gen 1 only clears the trapping bit after both battlers
 * have acted -- which is why a slower victim is still held through the last hit.
 */
export function continueTrapping(env: MoveEnv): MoveResult {
  const user = env.user;
  const result = emptyResult(user.volatile.lastMoveUsed);
  result.used = true;
  result.hit = true;
  result.hits = 1;
  say(env, result, "_AttackContinuesText");
  user.volatile.trapTurns = user.volatile.trapTurns - 1;
  const damage = user.volatile.effectCounter > 0 ? user.volatile.effectCounter : 1;
  env.lastDamage = damage;
  result.damage = applyDamageTo(env, false, damage, result);
  if (env.target.hp <= 0) {
    result.targetFainted = true;
  }
  if (user.volatile.trapTurns <= 0) {
    user.volatile.trapping = false;
    env.target.volatile.trapTurns = 0;
  }
  return result;
}

/**
 * A stored or released turn of Bide. The release deals twice everything the user
 * soaked, ignores the type chart entirely and cannot be resisted; with nothing
 * stored it simply fails.
 */
export function continueBide(env: MoveEnv): MoveResult {
  const user = env.user;
  const result = emptyResult("BIDE");
  result.used = true;
  user.volatile.bideTurns = user.volatile.bideTurns - 1;
  if (user.volatile.bideTurns > 0) {
    say(env, result, "_SavingEnergyText");
    return result;
  }
  const stored = user.volatile.bideDamage;
  user.volatile.bideDamage = 0;
  say(env, result, "_UnleashedEnergyText");
  if (stored <= 0) {
    return failed(env, result);
  }
  result.hit = true;
  result.hits = 1;
  const damage = stored * 2;
  env.lastDamage = damage;
  result.damage = applyDamageTo(env, false, damage, result);
  if (env.target.hp <= 0) {
    result.targetFainted = true;
  }
  return result;
}
