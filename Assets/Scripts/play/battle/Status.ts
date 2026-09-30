// Generation 1 status conditions: what lands, what coexists, and what each one
// costs its owner at the start and the end of a turn.
//
// Five major statuses, at most one at a time, and confusion -- not a status at
// all but a volatile, so it rides alongside any of them. Whether a status lands
// is not one rule but four: SleepEffect, PoisonEffect, ParalyzeEffect_ and the
// shared FreezeBurnParalyzeEffect each check a different subset in a different
// order. statusImmunity() keeps them apart rather than averaging them into one.
//
// Deliberately reproduced faults, each marked GEN1 BUG below:
//
//   * Freeze never wears off. There is no thaw timer in Generation 1; a frozen
//     Pokemon is out of the battle unless a Fire move with a burn side effect
//     hits it, Haze fires, or the player spends an Ice Heal.
//   * Sleep costs the turn it wakes up on. The counter is decremented before it
//     is tested, so a Pokemon put to sleep for 1 turn still loses a turn.
//   * Sleep used on a Pokemon that must recharge skips every check, including
//     the one that says it already has a status. Hyper Beam into Hypnosis
//     overwrites a burn.
//   * Toxic is not a status. It is ordinary poison plus a counter held in a
//     different byte, so switching out downgrades it to ordinary poison and it
//     is gone for the rest of the battle.
//   * The toxic counter is shared with Leech Seed, so a seeded and badly
//     poisoned Pokemon drains at the toxic rate and advances the counter twice
//     in a turn. toxicTick() is exported so Moves.ts can reproduce that.
//
// NOT reproduced, written down so the next reader does not think it was missed:
// the burn Attack cut and the paralysis Speed cut are applied when the stat is
// READ, in Stats.battleStatsFor, which is what gen1recomp does too (Damage.lua's
// statPenalty, TurnOrder.lua's effectiveSpeed). The cartridge halves the live
// stat once, in place, in HalveAttackDueToBurn, and a later stat stage change
// recomputes from wPlayerMonUnmodifiedAttack without re-halving -- so on hardware
// a Swords Dance is believed to LIFT a burn's Attack cut until the burn is
// re-applied. Unverified here, and fixing it would mean changing Stats.ts.
//
// Every function that changes a Pokemon returns a new BattleMon, the way Stats.ts
// does; the caller stores it back into the side. Nothing here mutates its input.

import type { BattleMon, MoveDef, VolatileState } from "./types";
import {
  newVolatileState,
  STATUS_BURN,
  STATUS_FREEZE,
  STATUS_NONE,
  STATUS_PARALYSIS,
  STATUS_POISON,
  STATUS_SLEEP,
} from "./types";
import { battleStatsFor, cloneMon } from "./Stats";
import { baseDamage, damageRoll, hasType, randomByte } from "./Damage";

// ---------------------------------------------------------------------------
// The numbers, all of them the ROM's own bytes
// ---------------------------------------------------------------------------

/** SleepEffect draws `rand & 7` and redraws on zero, so 1..7 and never 0. */
export const SLEEP_MIN_TURNS: number = 1;
export const SLEEP_MAX_TURNS: number = 7;

/** Rest writes the status byte as a literal 2: two lost turns, then it acts. */
export const REST_SLEEP_TURNS: number = 2;

/** ConfusionSideEffectSuccess draws `rand & 3` and adds 2, so 2..5. */
export const CONFUSION_MIN_TURNS: number = 2;
export const CONFUSION_MAX_TURNS: number = 5;

/** `cp $3F / jr nc`: fully paralyzed when the byte is below 63, so 63/256. */
export const FULL_PARALYSIS_BYTE: number = 63;

/** `cp $80 / jr c`: the self-hit is the branch NOT taken, so byte >= 128. */
export const CONFUSION_SELF_HIT_BYTE: number = 128;

/** HandleSelfConfusionDamage builds a 40-power typeless attack. */
export const CONFUSION_SELF_HIT_POWER: number = 40;

/** Poison, burn and Leech Seed all take max(1, maxHP/16). */
export const RESIDUAL_DIVISOR: number = 16;

/**
 * types.ts documents badlyPoisoned as 1..15, so the counter stops there. The ROM
 * keeps an uncapped byte, but the clamp is unobservable: a tick at counter n
 * costs n/16 of max HP, so six ticks come to 21/16 of it and nothing reaches a
 * seventh. The test proves that over all 151 species.
 */
export const MAX_TOXIC_COUNTER: number = 15;

/**
 * The move effects that route through FreezeBurnParalyzeEffect, which is the only
 * path that reaches CheckDefrost. A Fire move outside this list -- Fire Spin --
 * does not thaw its target, which is why a frozen Pokemon can be trapped forever.
 */
export const DEFROST_EFFECTS: string[] = [
  "BURN_SIDE_EFFECT1",
  "BURN_SIDE_EFFECT2",
  "FREEZE_SIDE_EFFECT1",
  "PARALYZE_SIDE_EFFECT1",
  "PARALYZE_SIDE_EFFECT2",
];

/** The five major statuses. */
export const MAJOR_STATUSES: string[] =
  [STATUS_SLEEP, STATUS_POISON, STATUS_BURN, STATUS_FREEZE, STATUS_PARALYSIS];

// ---------------------------------------------------------------------------
// Why a status did not land
// ---------------------------------------------------------------------------

/** statusImmunity returns one of these; "" means the status lands. */
export const IMMUNE_NONE: string = "";
export const IMMUNE_ALREADY_STATUSED: string = "already-statused";
export const IMMUNE_ALREADY_ASLEEP: string = "already-asleep";
export const IMMUNE_ALREADY_CONFUSED: string = "already-confused";
export const IMMUNE_SUBSTITUTE: string = "substitute";
export const IMMUNE_MOVE_TYPE_MATCHES: string = "move-type-matches";
export const IMMUNE_TYPE: string = "type-immune";

/** The type each status cannot be inflicted on. "" for sleep, which hits anything. */
export function immuneTypeFor(status: string): string {
  if (status === STATUS_FREEZE) {
    return "ICE";
  }
  if (status === STATUS_BURN) {
    return "FIRE";
  }
  if (status === STATUS_POISON) {
    return "POISON";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Text, read out of the cartridge
// ---------------------------------------------------------------------------

function substituteNames(body: string, user: string, target: string): string {
  let out = body.split("{USER}").join(user);
  out = out.split("{TARGET}").join(target);
  out = out.split("{RAM:wNameBuffer}").join(target);
  return out;
}

/**
 * One battle line, from the bundle's own extracted text, with the ROM's control
 * characters left in place -- the message box knows what \n and \f mean. The
 * fallback is only reached by a bundle built without the text dataset. The
 * original prints "Enemy " before a foe's nickname; that prefix belongs to
 * whoever knows which side a Pokemon is on, so it has to arrive in mon.name.
 */
export function statusLine(
  bundle: any,
  key: string,
  fallback: string,
  user: string,
  target: string
): string {
  const found = bundle && bundle.text ? bundle.text[key] : null;
  const body = typeof found === "string" ? found : fallback;
  return substituteNames(body, user, target);
}

// ---------------------------------------------------------------------------
// Options and results
// ---------------------------------------------------------------------------

/** What the inflicting move was, and what the target had up when it hit. */
export interface InflictOptions {
  /** The move was TOXIC: ordinary poison plus the counter. */
  toxic: boolean;
  /** The inflicting move's type, for the two type gates. "" when there is none. */
  moveType: string;
  /** A side effect of a damaging move rather than the move's whole point. */
  secondary: boolean;
  /** The target has a substitute up. */
  targetHasSubstitute: boolean;
  /** The target owes a Hyper Beam recharge turn. Only sleep cares. */
  targetRecharging: boolean;
  /** The target's badges, for the burn and paralysis stat cut. */
  badgeBits: number;
}

export function defaultInflictOptions(): InflictOptions {
  return {
    toxic: false,
    moveType: "",
    secondary: false,
    targetHasSubstitute: false,
    targetRecharging: false,
    badgeBits: 0,
  };
}

/** What inflicting, curing or confusing produced. `mon` is always usable. */
export interface StatusResult {
  mon: BattleMon;
  applied: boolean;
  /** IMMUNE_* when it did not land, "" when it did. */
  reason: string;
  messages: string[];
}

/** The start-of-turn gauntlet's verdict for one Pokemon. */
export interface BeforeMoveResult {
  mon: BattleMon;
  canMove: boolean;
  /** Confusion turned the move into a hit on its own user. */
  selfHit: boolean;
  messages: string[];
}

/** One poison or burn tick. */
export interface ResidualResult {
  mon: BattleMon;
  damage: number;
  fainted: boolean;
  messages: string[];
}

/** The damage a toxic-scaled tick deals, and the counter it leaves behind. */
export interface ToxicTick {
  damage: number;
  nextCounter: number;
}

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

/**
 * Stats.cloneMon shares the volatile block by reference, which is right for its
 * callers and wrong for every function here, so this file copies it.
 *
 * The field list comes from newVolatileState() rather than being written out
 * again, so a field added to types.ts is copied without anyone remembering to
 * come back here. A hand-written copy would drop it silently, and a dropped
 * volatile is invisible until someone plays a real battle.
 */
function cloneVolatile(v: VolatileState): VolatileState {
  const fresh: any = newVolatileState();
  const source: any = v;
  const keys: string[] = Object.keys(fresh);
  for (let i = 0; i < keys.length; i++) {
    fresh[keys[i]] = source[keys[i]];
  }
  return fresh as VolatileState;
}

/** A copy whose volatile block is its own. Every mutation here starts with this. */
function fork(mon: BattleMon): BattleMon {
  const fresh: BattleMon = cloneMon(mon);
  fresh.volatile = cloneVolatile(mon.volatile);
  return fresh;
}

/** The status landed. */
function landed(mon: BattleMon, messages: string[]): StatusResult {
  return { mon: mon, applied: true, reason: IMMUNE_NONE, messages: messages };
}

/** It did not, for `reason`, and the cartridge said `messages` about it. */
function refused(mon: BattleMon, reason: string, messages: string[]): StatusResult {
  return { mon: mon, applied: false, reason: reason, messages: messages };
}

/** The turn is lost, and this is what the box says. */
function halted(mon: BattleMon, message: string): BeforeMoveResult {
  return { mon: mon, canMove: false, selfHit: false, messages: [message] };
}

/** The Pokemon may still move; `messages` is what happened on the way. */
function proceed(mon: BattleMon, messages: string[]): BeforeMoveResult {
  return { mon: mon, canMove: true, selfHit: false, messages: messages };
}

/**
 * Recompute battleStats after burn or paralysis landed or lifted, WITHOUT
 * spending another badge boost pass: the ROM halves the live Attack in place
 * (HalveAttackDueToBurn) and never calls ApplyBadgeStatBoosts on that path, so
 * the badge bug does not tick here the way it does on a stat stage change.
 */
export function restat(mon: BattleMon, badgeBits: number): BattleMon {
  mon.battleStats = battleStatsFor(mon, badgeBits, mon.badgeBoostPasses);
  return mon;
}

// ---------------------------------------------------------------------------
// Coexistence and immunity
// ---------------------------------------------------------------------------

export function isMajorStatus(status: string): boolean {
  return status !== STATUS_NONE && hasType(MAJOR_STATUSES, status);
}

/**
 * Whether a Pokemon already carrying `current` can also take `incoming`. In
 * Generation 1 the answer is always no: the status byte holds one condition, so a
 * Pokemon that is asleep cannot also be poisoned. Confusion is not on this list,
 * because it lives in a different byte and coexists with all five.
 */
export function canCoexist(current: string, incoming: string): boolean {
  return current === STATUS_NONE || incoming === STATUS_NONE;
}

/**
 * Why `status` will not land on `mon`, or "" when it will. The order of the tests
 * is per-routine, because the cartridge's four status routines check different
 * things in different orders and the first failure is what gets printed:
 *
 *   SleepEffect          recharge bypass, already asleep, already statused
 *   PoisonEffect         substitute, already statused, POISON type
 *   ParalyzeEffect_      already statused, ELECTRIC move vs GROUND type
 *   FreezeBurnParalyze   substitute, already statused, move type == target type
 *
 * The accuracy roll is not here: it belongs to Damage.rollHit and runs after.
 * Neither is the type chart -- a move that does no damage never reaches its side
 * effect at all, and Damage.ts is what knows that.
 */
export function statusImmunity(mon: BattleMon, status: string, options: InflictOptions): string {
  // GEN1 BUG: SleepEffect clears NEEDS_TO_RECHARGE and, if the bit was set, jumps
  // straight to the counter -- past the substitute, past "already asleep", past
  // "already has a status". Hypnosis on a Pokemon recharging from Hyper Beam
  // therefore lands on top of a burn and replaces it.
  if (status === STATUS_SLEEP && options.targetRecharging) {
    return IMMUNE_NONE;
  }

  // Thunder Wave and the other primary paralysis moves never call
  // CheckTargetSubstitute, and neither does SleepEffect. Everything else does.
  const primaryIgnoresSubstitute = status === STATUS_SLEEP || status === STATUS_PARALYSIS;
  if (options.targetHasSubstitute && (options.secondary || !primaryIgnoresSubstitute)) {
    return IMMUNE_SUBSTITUTE;
  }

  if (mon.status !== STATUS_NONE) {
    if (status === STATUS_SLEEP && mon.status === STATUS_SLEEP) {
      return IMMUNE_ALREADY_ASLEEP;
    }
    return IMMUNE_ALREADY_STATUSED;
  }

  // FreezeBurnParalyzeEffect refuses a secondary status when the move's type is
  // one of the target's own: Body Slam cannot paralyze a Normal type, Ember
  // cannot burn a Fire type, Ice Beam cannot freeze an Ice type. Poison side
  // effects go through PoisonEffect instead and skip this test entirely.
  if (options.secondary && status !== STATUS_POISON && options.moveType !== "") {
    if (hasType(mon.types, options.moveType)) {
      return IMMUNE_MOVE_TYPE_MATCHES;
    }
  }

  // ParalyzeEffect_'s own gate: an Electric move cannot paralyze a Ground type.
  // Stun Spore and Glare are not Electric and paralyze Ground types happily.
  if (status === STATUS_PARALYSIS && options.moveType === "ELECTRIC") {
    if (hasType(mon.types, "GROUND")) {
      return IMMUNE_TYPE;
    }
  }

  const immuneType = immuneTypeFor(status);
  if (immuneType !== "" && hasType(mon.types, immuneType)) {
    return IMMUNE_TYPE;
  }

  return IMMUNE_NONE;
}

// ---------------------------------------------------------------------------
// The rolls
// ---------------------------------------------------------------------------

/** 1..7, uniform. Never 0: the ROM redraws on zero rather than adding one. */
export function rollSleepTurns(random: () => number): number {
  for (let attempt = 0; attempt < 100; attempt++) {
    const turns = randomByte(random) & 7;
    if (turns !== 0) {
      return turns;
    }
  }
  return SLEEP_MIN_TURNS;
}

/** 2..5, uniform. */
export function rollConfusionTurns(random: () => number): number {
  return (randomByte(random) & 3) + CONFUSION_MIN_TURNS;
}

/** 63/256. */
export function rollFullyParalyzed(random: () => number): boolean {
  return randomByte(random) < FULL_PARALYSIS_BYTE;
}

/** 128/256 -- the ROM branches AWAY on `jr c`, so the self-hit is the high half. */
export function rollConfusionSelfHit(random: () => number): boolean {
  return randomByte(random) >= CONFUSION_SELF_HIT_BYTE;
}

// ---------------------------------------------------------------------------
// Inflicting, curing and thawing
// ---------------------------------------------------------------------------

function landingLine(bundle: any, mon: BattleMon, status: string, toxic: boolean): string {
  const n = mon.name;
  if (status === STATUS_SLEEP) {
    return statusLine(bundle, "_FellAsleepText", "{TARGET}\nfell asleep!", n, n);
  }
  if (status === STATUS_FREEZE) {
    return statusLine(bundle, "_FrozenText", "{TARGET}\nwas frozen solid!", n, n);
  }
  if (status === STATUS_BURN) {
    return statusLine(bundle, "_BurnedText", "{TARGET}\nwas burned!", n, n);
  }
  if (status === STATUS_PARALYSIS) {
    return statusLine(
      bundle,
      "_ParalyzedMayNotAttackText",
      "{TARGET}'s\nparalyzed! It may not attack!",
      n,
      n
    );
  }
  if (toxic) {
    return statusLine(bundle, "_BadlyPoisonedText", "{TARGET}'s\nbadly poisoned!", n, n);
  }
  return statusLine(bundle, "_PoisonedText", "{TARGET}\nwas poisoned!", n, n);
}

/**
 * Put `status` on `mon` if Generation 1 allows it. The two refusals the cartridge
 * announces from inside the effect -- "already asleep" and "it didn't affect" --
 * come back as messages; every other refusal is silent, and the caller prints
 * "But, it failed!" for a primary move and nothing at all for a side effect.
 */
export function inflictStatus(
  bundle: any,
  mon: BattleMon,
  status: string,
  options: InflictOptions,
  random: () => number
): StatusResult {
  const reason = statusImmunity(mon, status, options);
  if (reason !== IMMUNE_NONE) {
    const said: string[] = [];
    if (reason === IMMUNE_ALREADY_ASLEEP) {
      said.push(
        statusLine(bundle, "_AlreadyAsleepText", "{TARGET}'s\nalready asleep!", mon.name, mon.name)
      );
    } else if (reason === IMMUNE_ALREADY_STATUSED && status === STATUS_SLEEP) {
      said.push(
        statusLine(bundle, "_DidntAffectText", "It didn't affect\n{TARGET}!", mon.name, mon.name)
      );
    }
    return refused(mon, reason, said);
  }

  const fresh = fork(mon);
  fresh.status = status;
  fresh.sleepTurns = 0;
  if (status === STATUS_SLEEP) {
    fresh.sleepTurns = rollSleepTurns(random);
    // SleepEffect clears the recharge bit on its way past, whether or not the bit
    // is what let the sleep through.
    fresh.volatile.recharging = false;
  }
  if (status === STATUS_POISON && options.toxic) {
    fresh.volatile.badlyPoisoned = 1;
  }
  if (status === STATUS_BURN || status === STATUS_PARALYSIS) {
    restat(fresh, options.badgeBits);
  }
  return landed(fresh, [landingLine(bundle, fresh, status, options.toxic)]);
}

/**
 * Confusion. It is a volatile, not a status, so it lands on a Pokemon that is
 * already asleep, burned or paralyzed -- but never on one that is already
 * confused, and re-confusing does not extend the counter.
 *
 * ConfusionEffect (Confuse Ray, Supersonic) checks the substitute;
 * ConfusionSideEffect (Confusion, Psybeam) jumps past that check, so secondary
 * confusion goes through a substitute.
 */
export function applyConfusion(
  bundle: any,
  mon: BattleMon,
  options: InflictOptions,
  random: () => number
): StatusResult {
  if (mon.volatile.confusionTurns > 0) {
    return refused(mon, IMMUNE_ALREADY_CONFUSED, []);
  }
  if (options.targetHasSubstitute && !options.secondary) {
    return refused(mon, IMMUNE_SUBSTITUTE, []);
  }
  const fresh = fork(mon);
  fresh.volatile.confusionTurns = rollConfusionTurns(random);
  return landed(fresh, [
    statusLine(bundle, "_BecameConfusedText", "{TARGET}\nbecame confused!", mon.name, mon.name),
  ]);
}

/**
 * Rest's half of Rest: overwrite whatever the Pokemon had with two turns of
 * sleep. The status byte is written whole, so a burn or a poisoning is gone, and
 * the toxic counter goes with it because Rest is the one cure that runs while the
 * Pokemon is on the field and leaves it there. Moves.ts owns the healing.
 */
export function restSleep(bundle: any, mon: BattleMon, badgeBits: number): StatusResult {
  const fresh = fork(mon);
  fresh.status = STATUS_SLEEP;
  fresh.sleepTurns = REST_SLEEP_TURNS;
  fresh.volatile.badlyPoisoned = 0;
  restat(fresh, badgeBits);
  return landed(fresh, [
    statusLine(bundle, "_StartedSleepingEffect", "{USER}\nstarted sleeping!", mon.name, mon.name),
  ]);
}

/**
 * Clear the status byte -- an Antidote, a Full Heal, Haze, the AI's own item.
 *
 * This clears badly-poisoned too. The ROM keeps two things apart that types.ts
 * folds into one field: the BADLY_POISONED bit in wPlayerBattleStatus3 and the
 * raw wPlayerToxicCounter byte. A cure runs `res BADLY_POISONED`
 * (.cureStatusAilment, and trainer_ai.asm's AICureStatus) and leaves the counter
 * byte alone -- but with the bit clear nothing ever reads that byte again, so
 * zeroing the single combined field is the same behaviour. If a later build ever
 * splits the two, this is the line that has to split with them.
 */
export function cureStatus(mon: BattleMon, badgeBits: number): BattleMon {
  const fresh = fork(mon);
  fresh.status = STATUS_NONE;
  fresh.sleepTurns = 0;
  fresh.volatile.badlyPoisoned = 0;
  return restat(fresh, badgeBits);
}

/** Switching out, and Haze: badly poisoned drops back to ordinary poison. */
export function clearBadlyPoisoned(mon: BattleMon): BattleMon {
  const fresh = fork(mon);
  fresh.volatile.badlyPoisoned = 0;
  return fresh;
}

/** True for the moves that reach CheckDefrost: Fire type AND a status side effect. */
export function canDefrost(move: MoveDef): boolean {
  return move.type === "FIRE" && hasType(DEFROST_EFFECTS, move.effect);
}

/**
 * The only thaw a Generation 1 battle offers by itself. There is no timer: a
 * frozen Pokemon stays frozen for the rest of the battle unless one of the four
 * Fire moves with a burn chance connects, or Haze fires, or the player uses an
 * item. Fire Spin is Fire and does not thaw, because it has no status side effect
 * and so never reaches this branch.
 */
export function fireDefrost(bundle: any, mon: BattleMon, move: MoveDef): StatusResult {
  if (mon.status !== STATUS_FREEZE || !canDefrost(move)) {
    return refused(mon, IMMUNE_NONE, []);
  }
  const fresh = fork(mon);
  fresh.status = STATUS_NONE;
  return landed(fresh, [
    statusLine(bundle, "_FireDefrostedText", "Fire defrosted\n{TARGET}!", mon.name, mon.name),
  ]);
}

// ---------------------------------------------------------------------------
// End of turn
// ---------------------------------------------------------------------------

/** max(1, floor(maxHP / 16)). Poison, burn and Leech Seed all start here. */
export function residualBaseDamage(mon: BattleMon): number {
  const base = Math.floor(mon.maxHp / RESIDUAL_DIVISOR);
  return base < 1 ? 1 : base;
}

/**
 * One tick scaled by the toxic counter, and the counter it leaves behind.
 *
 * GEN1 BUG: Leech Seed reads and advances this same counter. A Pokemon that is
 * seeded and badly poisoned takes poison at the counter, then seed damage at the
 * counter again, and finishes the turn two steps further along. Moves.ts calls
 * this for the seed so the glitch survives.
 */
export function toxicTick(mon: BattleMon): ToxicTick {
  const base = residualBaseDamage(mon);
  const counter = mon.volatile.badlyPoisoned;
  if (counter <= 0) {
    return { damage: base, nextCounter: 0 };
  }
  const next = counter + 1;
  return {
    damage: base * counter,
    nextCounter: next > MAX_TOXIC_COUNTER ? MAX_TOXIC_COUNTER : next,
  };
}

/**
 * The poison and burn tick, run once per Pokemon per turn.
 *
 * The original runs it right after the acting side's move rather than at the end
 * of the round, so a fast Pokemon's poison can kill it before the slow one moves.
 * That sequencing is BattleState.ts's; this function is one tick.
 */
export function residualDamage(bundle: any, mon: BattleMon): ResidualResult {
  if (mon.hp <= 0) {
    return { mon: mon, damage: 0, fainted: true, messages: [] };
  }
  if (mon.status !== STATUS_POISON && mon.status !== STATUS_BURN) {
    return { mon: mon, damage: 0, fainted: false, messages: [] };
  }
  const tick = toxicTick(mon);
  const damage = tick.damage > mon.hp ? mon.hp : tick.damage;
  const fresh = fork(mon);
  fresh.hp = mon.hp - damage;
  fresh.volatile.badlyPoisoned = tick.nextCounter;
  const burning = mon.status === STATUS_BURN;
  const line = statusLine(
    bundle,
    burning ? "_HurtByBurnText" : "_HurtByPoisonText",
    burning ? "{USER}'s\nhurt by the burn!" : "{USER}'s\nhurt by poison!",
    mon.name,
    mon.name
  );
  return { mon: fresh, damage: damage, fainted: fresh.hp <= 0, messages: [line] };
}

// ---------------------------------------------------------------------------
// Start of turn
// ---------------------------------------------------------------------------

/**
 * Sleep and freeze, the first two rungs of CheckPlayerStatusConditions.
 *
 * GEN1 BUG (sleep): the counter is decremented and then tested, and both branches
 * end the turn. A Pokemon that wakes up this turn does not get to move -- waking
 * costs a turn, which is why a one-turn sleep is still worth a turn.
 *
 * GEN1 BUG (freeze): nothing here decrements anything. There is no thaw roll in
 * Generation 1; the branch prints and returns, forever.
 */
export function sleepFreezeCheck(bundle: any, mon: BattleMon): BeforeMoveResult {
  if (mon.status === STATUS_SLEEP) {
    const fresh = fork(mon);
    fresh.sleepTurns = mon.sleepTurns - 1;
    if (fresh.sleepTurns <= 0) {
      fresh.sleepTurns = 0;
      fresh.status = STATUS_NONE;
      return halted(fresh, statusLine(bundle, "_WokeUpText", "{USER}\nwoke up!", mon.name, mon.name));
    }
    return halted(
      fresh,
      statusLine(bundle, "_FastAsleepText", "{USER}\nis fast asleep!", mon.name, mon.name)
    );
  }
  if (mon.status === STATUS_FREEZE) {
    return halted(
      mon,
      statusLine(bundle, "_IsFrozenText", "{USER}\nis frozen solid!", mon.name, mon.name)
    );
  }
  return proceed(mon, []);
}

/**
 * The confusion tick. The counter comes down first and the roll only happens if
 * the Pokemon is still confused afterwards, so the turn confusion ends is a free
 * one. `selfHit` means the caller must deal confusionSelfHitDamage to this
 * Pokemon instead of running its move.
 */
export function confusionCheck(bundle: any, mon: BattleMon, random: () => number): BeforeMoveResult {
  if (mon.volatile.confusionTurns <= 0) {
    return proceed(mon, []);
  }
  const fresh = fork(mon);
  fresh.volatile.confusionTurns = mon.volatile.confusionTurns - 1;
  if (fresh.volatile.confusionTurns <= 0) {
    fresh.volatile.confusionTurns = 0;
    return proceed(fresh, [
      statusLine(bundle, "_ConfusedNoMoreText", "{USER}'s\nconfused no more!", mon.name, mon.name),
    ]);
  }
  const said: string[] = [
    statusLine(bundle, "_IsConfusedText", "{USER}\nis confused!", mon.name, mon.name),
  ];
  if (rollConfusionSelfHit(random)) {
    const hurt = clearInterruptVolatiles(fresh, true);
    said.push(
      statusLine(bundle, "_HurtItselfText", "It hurt itself in\nits confusion!", mon.name, mon.name)
    );
    return { mon: hurt, canMove: false, selfHit: true, messages: said };
  }
  return proceed(fresh, said);
}

/**
 * The full paralysis roll, the last rung before the move runs. Losing the turn to
 * it also cancels Bide, Thrash, a stored charge and a trapping move -- but not
 * invulnerability, which is the Fly/Dig glitch: a paralyzed Pokemon that is
 * underground stays untouchable and never comes back up.
 */
export function paralysisCheck(bundle: any, mon: BattleMon, random: () => number): BeforeMoveResult {
  if (mon.status !== STATUS_PARALYSIS || !rollFullyParalyzed(random)) {
    return proceed(mon, []);
  }
  return halted(
    clearInterruptVolatiles(mon, false),
    statusLine(bundle, "_FullyParalyzedText", "{USER}'s\nfully paralyzed!", mon.name, mon.name)
  );
}

/**
 * Sleep and freeze, then confusion, then paralysis -- the status rungs of
 * CheckPlayerStatusConditions, in the cartridge's order.
 *
 * The rungs this file does not own sit BETWEEN them and the caller has to splice
 * them in, or the message order is wrong: held-in-place and flinch go after
 * sleep and freeze, the recharge consume and the Disable countdown go after
 * those, and the disabled-move test goes between confusion and paralysis. Call
 * the three exported steps directly when that matters; this convenience runs them
 * back to back for a caller with no volatiles in play.
 */
export function statusBeforeMove(
  bundle: any,
  mon: BattleMon,
  random: () => number
): BeforeMoveResult {
  const said: string[] = [];
  const early = sleepFreezeCheck(bundle, mon);
  for (let i = 0; i < early.messages.length; i++) {
    said.push(early.messages[i]);
  }
  if (!early.canMove) {
    return { mon: early.mon, canMove: false, selfHit: false, messages: said };
  }
  const confused = confusionCheck(bundle, early.mon, random);
  for (let i = 0; i < confused.messages.length; i++) {
    said.push(confused.messages[i]);
  }
  if (!confused.canMove) {
    return { mon: confused.mon, canMove: false, selfHit: confused.selfHit, messages: said };
  }
  const paralyzed = paralysisCheck(bundle, confused.mon, random);
  for (let i = 0; i < paralyzed.messages.length; i++) {
    said.push(paralyzed.messages[i]);
  }
  return { mon: paralyzed.mon, canMove: paralyzed.canMove, selfHit: false, messages: said };
}

/**
 * The volatiles a lost turn takes with it. Full paralysis clears the multi-turn
 * moves; a confusion self-hit clears those plus invulnerability and the flinch,
 * because the ROM ANDs the whole word down to the confusion bit on that path and
 * only masks part of it on the other.
 */
export function clearInterruptVolatiles(mon: BattleMon, selfHit: boolean): BattleMon {
  const fresh = fork(mon);
  fresh.volatile.bideTurns = 0;
  fresh.volatile.bideDamage = 0;
  fresh.volatile.thrashTurns = 0;
  fresh.volatile.chargingMove = "";
  fresh.volatile.trapping = false;
  fresh.volatile.trapTurns = 0;
  if (selfHit) {
    fresh.volatile.invulnerable = false;
    fresh.volatile.flinched = false;
  }
  return fresh;
}

/**
 * What a confused Pokemon hits itself for: a 40-power physical attack with the
 * user on both ends. Typeless, so no STAB and no type chart -- a confused Gengar
 * hurts itself despite Normal being unable to touch a Ghost, and a confused Onix
 * takes full damage despite Rock halving Normal.
 *
 * GEN1 BUG: HandleSelfConfusionDamage swaps the user's own Defense into the
 * opponent's slot but leaves the screen check reading the OPPONENT's battle
 * status, so the opponent's Reflect halves the damage a Pokemon does to itself.
 * Pass the opponent's flag here, never the user's.
 *
 * The caller applies the result, and a user with a substitute up hits that
 * instead -- Generation 1 routes this through the ordinary apply-damage path.
 */
export function confusionSelfHitDamage(
  mon: BattleMon,
  opponentReflect: boolean,
  random: () => number
): number {
  const attack = mon.battleStats.attack;
  let defense = mon.battleStats.defense;
  if (opponentReflect) {
    defense = defense * 2;
  }
  const base = baseDamage(mon.level, CONFUSION_SELF_HIT_POWER, attack, defense, false);
  if (base < 2) {
    return base;
  }
  return Math.floor((base * damageRoll(random)) / 255);
}
