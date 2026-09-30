// Generation 1 catching: the ball table, the catch check and the shake loop.
//
// The whole of it is one pass through pokered's ItemUseBall, and four things in
// there are not what a modern player expects:
//
//   1. The first random byte is REJECTION SAMPLED, not scaled. A Great Ball draws
//      bytes until one is <= 200, an Ultra or Safari Ball until one is <= 150, and
//      a Poke Ball takes the first byte it gets. The distribution is the same as a
//      scaled draw; the number of bytes consumed is not, and a seeded battle
//      diverges the moment you get that wrong.
//   2. A Master Ball still draws that byte. The `cp MASTER_BALL / jp z, .captured`
//      sits INSIDE the loop, after `call Random`, so the check runs, one byte is
//      spent, and the result is thrown away. See attemptCatch().
//   3. Status is subtracted from the roll, and a roll that goes NEGATIVE is an
//      instant catch. Sleep and freeze subtract 25, the other three subtract 12.
//   4. The Great Ball is better twice over: a smaller ceiling on the roll AND a
//      smaller divisor in the HP factor (8 rather than 12), which makes the factor
//      bigger and the second roll easier.
//
// Catching awards no experience in Gen 1 -- the battle simply ends -- so nothing
// here talks to Party.ts's award path.
//
// Every division truncates because every division in the ROM does.

import type { BattleMon } from "./types";
import { STATUS_FREEZE, STATUS_NONE, STATUS_SLEEP } from "./types";
import { randomByte } from "./Damage";

/**
 * One ball. There are no optional fields, so MASTER_BALL carries an hpFactor and a
 * wobbleFactor it never reads; they are the Poke Ball's, and autoCatch is what
 * actually decides its behaviour.
 */
export interface BallDef {
  id: string;
  /** The ceiling the first random byte is rejection-sampled down to. */
  randMax: number;
  /** The divisor M in the HP factor. 12 everywhere but the Great Ball's 8. */
  hpFactor: number;
  /** ballFactor2: the divisor in the shake calculation. */
  wobbleFactor: number;
  /** MASTER_BALL only. Catches unconditionally, after one wasted random byte. */
  autoCatch: boolean;
}

export const BALL_MASTER: string = "MASTER_BALL";
export const BALL_POKE: string = "POKE_BALL";
export const BALL_GREAT: string = "GREAT_BALL";
export const BALL_ULTRA: string = "ULTRA_BALL";
export const BALL_SAFARI: string = "SAFARI_BALL";

/** The five balls Generation 1 has, in item order. */
export const BALL_IDS: string[] = [BALL_MASTER, BALL_ULTRA, BALL_GREAT, BALL_POKE, BALL_SAFARI];

/**
 * An id that is not one of the five. The Poke Ball's roll and HP factor with the
 * Ultra Ball's wobble divisor: not a ball the cartridge has, but the same fallback
 * the reference implementation resolves to, kept identical so the two agree on a
 * modded or corrupted item id rather than diverging silently.
 */
export const DEFAULT_BALL: BallDef = {
  id: "",
  randMax: 255,
  hpFactor: 12,
  wobbleFactor: 150,
  autoCatch: false,
};

const BALL_TABLE: { [id: string]: BallDef } = {
  // The Master Ball's ceiling is 255 because no ceiling is ever tested for it: the
  // `cp MASTER_BALL` branch fires before the 200 and 150 comparisons, so the byte
  // it draws is unconstrained. The reference implementation writes 0 here and never
  // reads it, which is the same statement made a different way.
  MASTER_BALL: { id: BALL_MASTER, randMax: 255, hpFactor: 12, wobbleFactor: 255, autoCatch: true },
  POKE_BALL: { id: BALL_POKE, randMax: 255, hpFactor: 12, wobbleFactor: 255, autoCatch: false },
  GREAT_BALL: { id: BALL_GREAT, randMax: 200, hpFactor: 8, wobbleFactor: 200, autoCatch: false },
  ULTRA_BALL: { id: BALL_ULTRA, randMax: 150, hpFactor: 12, wobbleFactor: 150, autoCatch: false },
  SAFARI_BALL: { id: BALL_SAFARI, randMax: 150, hpFactor: 12, wobbleFactor: 150, autoCatch: false },
};

/** The ball's row, or DEFAULT_BALL for an id the table does not have. */
export function ballDef(ball: string): BallDef {
  const found = BALL_TABLE[ball];
  return found ? found : DEFAULT_BALL;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Subtracted from the first roll. Sleep and freeze are worth twice what the other
 * three are, and a roll driven below zero is an instant catch.
 */
export function statusCatchBonus(status: string): number {
  if (status === STATUS_SLEEP || status === STATUS_FREEZE) {
    return 25;
  }
  if (status === STATUS_NONE) {
    return 0;
  }
  return 12;
}

/** Added to the shake value when the target has a status. Sleep and freeze, 10. */
export function statusShakeBonus(status: string): number {
  if (status === STATUS_SLEEP || status === STATUS_FREEZE) {
    return 10;
  }
  if (status === STATUS_NONE) {
    return 0;
  }
  return 5;
}

// ---------------------------------------------------------------------------
// The HP factor
// ---------------------------------------------------------------------------

/**
 * f, the ceiling on the second roll:
 *
 *   f = min(255, floor( floor(maxHp * 255 / M) / max(1, floor(hp / 4)) ))
 *
 * A target at full health divides by maxHp/4 and lands somewhere near 4 * 255 / M;
 * a target on 1 HP divides by 1 and pins f at 255, which is why a Pokemon in the
 * red is caught by the second roll every time it reaches it.
 *
 * The floor of 1 on the divisor is the ROM's, and it is what stops a target on
 * 0..3 HP from dividing by zero.
 */
export function hpFactor(maxHp: number, hp: number, divisor: number): number {
  let quarter = Math.floor(hp / 4);
  if (quarter < 1) {
    quarter = 1;
  }
  const f = Math.floor(Math.floor((maxHp * 255) / divisor) / quarter);
  return f > 255 ? 255 : f;
}

// ---------------------------------------------------------------------------
// The shake loop
// ---------------------------------------------------------------------------

/**
 * How many times the ball wobbles before it breaks open, 0..3:
 *
 *   d = floor(catchRate * 100 / ballFactor2)
 *   z = d > 255 ? 255 : floor(f * d / 255)
 *   z = z + the status shake bonus
 *   z < 10 -> 0 shakes, < 30 -> 1, < 70 -> 2, otherwise 3
 *
 * Zero shakes is the "You missed the POKeMON!" message, which is a lie: the ball
 * connected and the maths lost.
 *
 * NOT reproduced, and deliberately: on the path where the FIRST roll fails, the
 * cartridge has not computed f yet and the shake calculation reads whatever was
 * last left in that temporary. The reference implementation this project is
 * fingerprinted against uses f on both paths and says so, so this does too. I
 * could not confirm what the stale value actually is without the disassembly, and
 * guessing at it would be worse than matching the reference.
 */
export function shakeCount(
  catchRate: number,
  f: number,
  status: string,
  wobbleFactor: number
): number {
  const d = Math.floor((catchRate * 100) / wobbleFactor);
  let z = d > 255 ? 255 : Math.floor((f * d) / 255);
  z = z + statusShakeBonus(status);
  if (z < 10) {
    return 0;
  }
  if (z < 30) {
    return 1;
  }
  if (z < 70) {
    return 2;
  }
  return 3;
}

// ---------------------------------------------------------------------------
// The attempt
// ---------------------------------------------------------------------------

export interface CatchResult {
  caught: boolean;
  /** 0..3. Always 3 on a catch. */
  shakes: number;
  /** The catch rate actually used, after any override. */
  catchRate: number;
  /** The first roll after the status subtraction. Negative means an instant catch. */
  roll: number;
  /** The HP factor. -1 when the attempt ended before f was needed. */
  f: number;
  /** Random bytes consumed, including the one a Master Ball wastes. */
  rolls: number;
}

/** The first roll: bytes until one lands inside the ball's ceiling. */
export function rollBallByte(def: BallDef, random: () => number): number[] {
  // A Poke Ball's ceiling is 255, so its first byte always passes -- which is
  // exactly the `cp POKE_BALL / jr z, .checkForAilments` shortcut, expressed as
  // data rather than as a branch. The cap is for a degenerate injected RNG only;
  // a uniform one clears 150 in under two draws on average.
  for (let attempt = 1; attempt <= 1000; attempt++) {
    const byte = randomByte(random);
    if (byte <= def.randMax) {
      return [byte, attempt];
    }
  }
  return [def.randMax, 1000];
}

/**
 * One thrown ball. `rateOverride` replaces the species catch rate (the Safari
 * Zone's bait and rocks move it); pass -1 for none.
 *
 * The order is the cartridge's, and the order is the whole point:
 *
 *   1. draw a byte inside the ball's ceiling
 *   2. if the ball is a Master Ball, caught -- the byte above is already spent
 *   3. subtract the status bonus; below zero is caught
 *   4. above the catch rate is a failure, and the ball wobbles
 *   5. compute f; a second byte <= f is caught, anything else wobbles
 */
export function attemptCatch(
  bundle: any,
  ball: string,
  target: BattleMon,
  rateOverride: number,
  random: () => number
): CatchResult {
  const def = ballDef(ball);
  const species = bundle.species[target.species];
  const rate = rateOverride >= 0 ? rateOverride : species ? species.catchRate : 0;

  if (def.autoCatch) {
    // The Master Ball bug, preserved. pokered draws the random byte at the top of
    // the loop and only then asks whether the ball is a Master Ball, so the check
    // runs against a byte it will never use -- one draw, no ceiling test, no status
    // subtraction. Nothing about the outcome changes, it always catches, but the
    // RNG stream advances by one and every roll after this one in the battle is a
    // different roll because of it. Deleting the draw would look like a tidy-up and
    // would silently desynchronise a seeded battle from the cartridge.
    const wasted = randomByte(random);
    return { caught: true, shakes: 3, catchRate: rate, roll: wasted, f: -1, rolls: 1 };
  }

  const rolled = rollBallByte(def, random);
  let rolls = rolled[1];

  const roll = rolled[0] - statusCatchBonus(target.status);
  if (roll < 0) {
    return { caught: true, shakes: 3, catchRate: rate, roll: roll, f: -1, rolls: rolls };
  }

  const f = hpFactor(target.maxHp, target.hp, def.hpFactor);
  if (roll > rate) {
    return {
      caught: false,
      shakes: shakeCount(rate, f, target.status, def.wobbleFactor),
      catchRate: rate,
      roll: roll,
      f: f,
      rolls: rolls,
    };
  }

  const second = randomByte(random);
  rolls = rolls + 1;
  if (second <= f) {
    return { caught: true, shakes: 3, catchRate: rate, roll: roll, f: f, rolls: rolls };
  }
  return {
    caught: false,
    shakes: shakeCount(rate, f, target.status, def.wobbleFactor),
    catchRate: rate,
    roll: roll,
    f: f,
    rolls: rolls,
  };
}

/**
 * The exact probability of a catch, as a percentage 0..100, for the preview the
 * battle menu shows. Closed form rather than a simulation, so it is a fact and not
 * an estimate:
 *
 *   the first byte is uniform over 0..randMax, so randMax + 1 outcomes
 *   `automatic` of them fall below the status bonus and catch outright
 *   `passed` of them are at or below rate + bonus and reach the second roll
 *   the second roll catches with probability (f + 1) / 256
 */
export function catchChance(
  bundle: any,
  ball: string,
  target: BattleMon,
  rateOverride: number
): number {
  const def = ballDef(ball);
  if (def.autoCatch) {
    return 100;
  }
  const species = bundle.species[target.species];
  const rate = rateOverride >= 0 ? rateOverride : species ? species.catchRate : 0;
  const bonus = statusCatchBonus(target.status);
  const f = hpFactor(target.maxHp, target.hp, def.hpFactor);

  const outcomes = def.randMax + 1;
  let automatic = bonus < 0 ? 0 : bonus;
  if (automatic > outcomes) {
    automatic = outcomes;
  }
  let passed = rate + bonus + 1;
  if (passed < 0) {
    passed = 0;
  }
  if (passed > outcomes) {
    passed = outcomes;
  }
  return ((automatic + ((passed - automatic) * (f + 1)) / 256) * 100) / outcomes;
}

// ---------------------------------------------------------------------------
// When a ball cannot be thrown at all
// ---------------------------------------------------------------------------

export const CATCH_ALLOWED: string = "";
export const CATCH_BLOCKED_TRAINER: string = "TRAINER";
/** A ghost nobody has identified, or the restless soul: thrown, dodged, gone. */
export const CATCH_DODGED: string = "DODGED";
/** Six in the party AND a full box: there is nowhere left to put a Pokemon. */
export const CATCH_BLOCKED_BOX_FULL: string = "BOX_FULL";

/**
 * Why a ball cannot be thrown, or CATCH_ALLOWED.
 *
 * The trainer case is the cartridge's: the ball is consumed, the turn is spent
 * and the Pokemon "dodges" it. A full PARTY is not a refusal -- the catch goes
 * to the PC box (pokered ItemUseBall .checkForBoxFull), and only a full box on
 * top of it stops the throw, before the ball is used up.
 *
 * `boxFree` is the room in the current box. Zero is also what an engine that
 * was never told about a box reports, so the old behaviour -- a full party
 * refuses -- is what a caller gets by saying nothing.
 */
export function catchBlockedReason(isWild: boolean, partyFull: boolean, boxFree: number): string {
  if (!isWild) {
    return CATCH_BLOCKED_TRAINER;
  }
  if (partyFull && boxFree <= 0) {
    return CATCH_BLOCKED_BOX_FULL;
  }
  return CATCH_ALLOWED;
}

/** The message box lines for a failed throw, worded as the cartridge words them. */
export function shakeMessage(shakes: number): string {
  if (shakes === 0) {
    return "You missed the\nPOKeMON!";
  }
  if (shakes === 1) {
    return "Darn! The POKeMON\nbroke free!";
  }
  if (shakes === 2) {
    return "Aww! It appeared\nto be caught!";
  }
  return "Shoot! It was so\nclose too!";
}
