// The Generation 1 damage formula, its type chart, its critical hits and its miss.
//
// Four things here are not what a modern player expects, and all four are correct:
//
//   1. Every move can miss. 100% accuracy is stored as the byte 255, the roll is
//      rand(0..255), and it misses when the roll is not below the byte -- so 1 in
//      256 hits of a perfectly accurate move fails. Nothing special-cases it.
//   2. Crit rate comes from the attacking SPECIES' base Speed, not from the move.
//      Electrode crits three times as often as Snorlax with the same move.
//   3. A critical hit reads the unmodified stats: no stat stages, no badge boosts,
//      no Reflect. Doubling the level is worth 42/22 at level 50 and a +2 stage is
//      worth 2, so a boosted attacker crits for LESS than it hits for.
//   4. Focus Energy quarters the crit rate instead of quadrupling it.
//
// Type effectiveness is read out of the bundle's own extracted chart, in the ROM's
// table order, and never hardcoded -- the only hardcoded type knowledge here is
// which types are Special, because that is a property of the generation rather
// than a row in a table.

import type { BattleMon, MoveDef, TypeMatchup } from "./types";
import { stageRatio } from "./Stats";

/**
 * Gen 1 splits physical and special by the move's type, not per move. The ROM's
 * type constants are ordered so that everything from FIRE up is special.
 */
export const SPECIAL_TYPES: string[] = [
  "FIRE",
  "WATER",
  "GRASS",
  "ELECTRIC",
  "PSYCHIC_TYPE",
  "ICE",
  "DRAGON",
];

/** The ROM's HighCriticalMoves table. Four moves, and they crit almost always. */
export const HIGH_CRIT_MOVES: string[] = ["KARATE_CHOP", "RAZOR_LEAF", "CRABHAMMER", "SLASH"];

/** The damage roll is uniform over these 39 values; 255 leaves the damage alone. */
export const MIN_DAMAGE_ROLL: number = 217;
export const MAX_DAMAGE_ROLL: number = 255;

/** CalculateDamage caps the quotient here, then adds 2, so base damage tops at 999. */
export const MAX_BASE_DAMAGE: number = 997;

// ---------------------------------------------------------------------------
// Random bytes, the way the ROM draws them
// ---------------------------------------------------------------------------

/** One byte, 0..255, from an injected [0,1) source. */
export function randomByte(random: () => number): number {
  return Math.floor(random() * 256) & 0xff;
}

/** rlc a, three times: an eight-bit rotate left by three. */
export function rotateLeft3(byte: number): number {
  return ((byte << 3) | (byte >> 5)) & 0xff;
}

// ---------------------------------------------------------------------------
// The type chart, read from the bundle
// ---------------------------------------------------------------------------

/**
 * The extracted chart, indexed for lookup but walked in the ROM's own table order
 * so that a dual-type defender takes its two multipliers in the same sequence the
 * cartridge would apply them. Multipliers are tenths: 0, 5 or 20.
 */
export class TypeChart {
  private byAttacker: { [attacker: string]: TypeMatchup[] };
  private pairs: { [key: string]: number };
  count: number;

  constructor(bundle: any) {
    this.byAttacker = {};
    this.pairs = {};
    const matchups: TypeMatchup[] =
      bundle && bundle.typeChart && bundle.typeChart.matchups
        ? (bundle.typeChart.matchups as TypeMatchup[])
        : [];
    for (let i = 0; i < matchups.length; i++) {
      const entry = matchups[i];
      let list = this.byAttacker[entry.attacker];
      if (!list) {
        list = [];
        this.byAttacker[entry.attacker] = list;
      }
      list.push(entry);
      this.pairs[entry.attacker + ">" + entry.defender] = entry.multiplier;
    }
    this.count = matchups.length;
  }

  /** Every chart row for this attacking type, in table order. */
  entriesFor(attackType: string): TypeMatchup[] {
    const list = this.byAttacker[attackType];
    return list ? list : [];
  }

  /** The multiplier in TENTHS for one pair. 10 when the chart has no row. */
  multiplier(attackType: string, defenderType: string): number {
    const found = this.pairs[attackType + ">" + defenderType];
    return found === undefined ? 10 : found;
  }

  /** The product over a defender's types, as a plain multiplier: 0, .25, .5, 1, 2, 4. */
  effectiveness(attackType: string, defenderTypes: string[]): number {
    const entries = this.entriesFor(attackType);
    let result = 1;
    for (let i = 0; i < entries.length; i++) {
      if (hasType(defenderTypes, entries[i].defender)) {
        result = (result * entries[i].multiplier) / 10;
      }
    }
    return result;
  }
}

// One bundle per session, so one slot is enough; rebuilding the index on every
// damage calculation would be the most expensive thing in the battle loop.
let cachedBundle: any = null;
let cachedChart: TypeChart = null;

/** The chart for this bundle, built once. */
export function typeChartFor(bundle: any): TypeChart {
  if (cachedBundle !== bundle || cachedChart === null) {
    cachedBundle = bundle;
    cachedChart = new TypeChart(bundle);
  }
  return cachedChart;
}

/** True when `type` appears in the list. Defender type lists are one or two long. */
export function hasType(types: string[], type: string): boolean {
  for (let i = 0; i < types.length; i++) {
    if (types[i] === type) {
      return true;
    }
  }
  return false;
}

/** True when the move's type uses the Special stat on both sides. */
export function isSpecialType(type: string): boolean {
  return hasType(SPECIAL_TYPES, type);
}

// ---------------------------------------------------------------------------
// Accuracy, and the 1/256 miss
// ---------------------------------------------------------------------------

/**
 * The ROM's accuracy byte. The cartridge stores accuracy as `pct * 255 / 100`
 * truncated, and the extractor rounds that back to a percent for the bundle; this
 * reverses it exactly for all eleven percentages Gen 1 uses. 100% is 255, which is
 * why a 100% move still misses once every 256 tries.
 */
export function accuracyByte(move: MoveDef): number {
  return Math.floor((move.accuracy * 255) / 100);
}

/** Swift is the one move that skips the accuracy check outright. */
export function alwaysHits(move: MoveDef): boolean {
  return move.effect === "SWIFT_EFFECT";
}

/**
 * Accuracy after the attacker's accuracy stage and the defender's evasion stage.
 * Evasion is read from the other end of the same ratio table -- the ROM indexes it
 * with 14 minus the stage -- so +6 evasion is the 0.25 row. Each step caps at 255.
 */
export function effectiveAccuracy(
  move: MoveDef,
  accuracyStage: number,
  evasionStage: number
): number {
  let acc = accuracyByte(move);
  const accRatio = stageRatio(accuracyStage);
  acc = Math.floor((acc * accRatio[0]) / accRatio[1]);
  if (acc > 255) {
    acc = 255;
  }
  const evaRatio = stageRatio(-evasionStage);
  acc = Math.floor((acc * evaRatio[0]) / evaRatio[1]);
  if (acc > 255) {
    acc = 255;
  }
  return acc;
}

/** rand(0..255) < accuracy. The 1/256 miss falls straight out of the comparison. */
export function rollHit(
  move: MoveDef,
  accuracyStage: number,
  evasionStage: number,
  random: () => number
): boolean {
  if (alwaysHits(move)) {
    return true;
  }
  return randomByte(random) < effectiveAccuracy(move, accuracyStage, evasionStage);
}

/** rollHit for two Pokemon on the field. */
export function rollMoveHits(
  attacker: BattleMon,
  defender: BattleMon,
  move: MoveDef,
  random: () => number
): boolean {
  return rollHit(move, attacker.stages.accuracy, defender.stages.evasion, random);
}

// ---------------------------------------------------------------------------
// Critical hits
// ---------------------------------------------------------------------------

/**
 * The crit threshold, 0..255; the chance is this over 256.
 *
 *   b = baseSpeed / 2
 *   Focus Energy halves it again -- the ROM shifts right where it meant to shift
 *   left, so the move that promises more crits delivers a quarter as many.
 *   Without Focus Energy b doubles instead.
 *   A high-crit move then doubles twice; every other move halves once.
 *
 * With neither, that is baseSpeed/2 out of 256: 21.5% for Tauros, 27.3% for
 * Electrode, 5.9% for Snorlax.
 */
export function critChance(baseSpeed: number, move: MoveDef, focusEnergy: boolean): number {
  let b = Math.floor(baseSpeed / 2);
  if (focusEnergy) {
    b = Math.floor(b / 2);
  } else {
    b = b * 2;
    if (b > 255) {
      b = 255;
    }
  }
  if (hasType(HIGH_CRIT_MOVES, move.id)) {
    b = b * 2;
    if (b > 255) {
      b = 255;
    }
    b = b * 2;
    if (b > 255) {
      b = 255;
    }
  } else {
    b = Math.floor(b / 2);
  }
  return b;
}

/** critChance for a Pokemon on the field, reading its species' base Speed. */
export function critChanceFor(bundle: any, attacker: BattleMon, move: MoveDef): number {
  const species = bundle.species[attacker.species];
  const baseSpeed = species ? species.baseStats.speed : 0;
  return critChance(baseSpeed, move, attacker.volatile.focusEnergy);
}

/**
 * The roll. The ROM rotates the random byte left three times before comparing,
 * which does not change the distribution but does change which byte crits -- kept
 * so a seeded cartridge RNG would reproduce the same battles.
 */
export function rollCritical(bundle: any, attacker: BattleMon, move: MoveDef,
                             random: () => number): boolean {
  if (move.power <= 0) {
    return false;
  }
  return rotateLeft3(randomByte(random)) < critChanceFor(bundle, attacker, move);
}

// ---------------------------------------------------------------------------
// The damage roll
// ---------------------------------------------------------------------------

/**
 * 217..255, uniform. The ROM rotates a random byte left once and rejects anything
 * below 217, so the loop is a rejection sampler. The iteration cap only matters
 * for a degenerate injected RNG; a uniform one clears it in about seven tries.
 */
export function damageRoll(random: () => number): number {
  for (let attempt = 0; attempt < 100; attempt++) {
    const byte = randomByte(random);
    const rolled = ((byte << 1) | (byte >> 7)) & 0xff;
    if (rolled >= MIN_DAMAGE_ROLL) {
      return rolled;
    }
  }
  return MIN_DAMAGE_ROLL;
}

// ---------------------------------------------------------------------------
// The formula
// ---------------------------------------------------------------------------

/**
 * Base damage, before STAB, before type effectiveness and before the roll:
 *
 *   floor( floor( (floor(2L/5) + 2) * Power * Attack / Defense ) / 50 ) + 2
 *
 * A critical hit doubles L first. If either stat exceeds a byte both are quartered,
 * which is why 999 Defense is not four times as good as 250.
 */
export function baseDamage(
  level: number,
  power: number,
  attack: number,
  defense: number,
  critical: boolean
): number {
  if (power <= 0) {
    return 0;
  }
  const effLevel = critical ? level * 2 : level;
  let a = attack;
  let d = defense;
  if (a > 255 || d > 255) {
    a = Math.floor(a / 4) & 0xff;
    d = Math.floor(d / 4) & 0xff;
  }
  if (d < 1) {
    d = 1;
  }
  if (a < 1) {
    a = 1;
  }
  let value = Math.floor((effLevel * 2) / 5) + 2;
  value = value * power * a;
  value = Math.floor(value / d);
  value = Math.floor(value / 50);
  if (value > MAX_BASE_DAMAGE) {
    value = MAX_BASE_DAMAGE;
  }
  return value + 2;
}

/** Inputs a caller can override. Build one with defaultDamageOptions(). */
export interface DamageOptions {
  /** Take the critical branch: doubled level, unmodified stats, screens ignored. */
  critical: boolean;
  /** The defender has Reflect (physical) or Light Screen (special) up. */
  screened: boolean;
  /** 217..255. 0 skips the roll entirely, which yields the maximum. */
  roll: number;
  /** Replaces the move's own power. 0 keeps the move's. */
  power: number;
  /** Replaces the move's own type. "" keeps the move's. */
  type: string;
}

export interface DamageResult {
  /** HP the target loses. 0 when the move does not damage or the type is immune. */
  damage: number;
  /** The type chart product: 0, 0.25, 0.5, 1, 2 or 4. */
  effectiveness: number;
  stab: boolean;
  critical: boolean;
  /** True when the move used the Special stat on both sides. */
  special: boolean;
  /** The attacking and defending stat values actually used, after every modifier. */
  attackUsed: number;
  defenseUsed: number;
  /** Damage before STAB, type effectiveness and the roll. */
  base: number;
}

/** Neutral options: no crit, no screen, no roll, the move's own power and type. */
export function defaultDamageOptions(): DamageOptions {
  return { critical: false, screened: false, roll: 0, power: 0, type: "" };
}

/**
 * The whole chain: base damage, then STAB, then the type chart in table order,
 * then the roll. Every step truncates, exactly where the cartridge truncates.
 */
export function computeDamage(
  bundle: any,
  attacker: BattleMon,
  defender: BattleMon,
  move: MoveDef,
  options: DamageOptions
): DamageResult {
  const moveType = options.type !== "" ? options.type : move.type;
  const power = options.power > 0 ? options.power : move.power;
  const special = isSpecialType(moveType);

  let attack: number;
  let defense: number;
  if (options.critical) {
    // The unmodified stats. No stages, no badge boosts, no screens: this is the
    // whole reason BattleMon carries `stats` and `battleStats` separately.
    attack = special ? attacker.stats.special : attacker.stats.attack;
    defense = special ? defender.stats.special : defender.stats.defense;
  } else {
    attack = special ? attacker.battleStats.special : attacker.battleStats.attack;
    defense = special ? defender.battleStats.special : defender.battleStats.defense;
    if (options.screened) {
      defense = defense * 2;
    }
  }

  const base = baseDamage(attacker.level, power, attack, defense, options.critical);
  const stab = hasType(attacker.types, moveType);
  let damage = base;

  if (power > 0 && stab) {
    damage = damage + Math.floor(damage / 2);
  }

  let effectiveness = 1;
  const chart = typeChartFor(bundle);
  const entries = chart.entriesFor(moveType);
  for (let i = 0; i < entries.length; i++) {
    if (hasType(defender.types, entries[i].defender)) {
      damage = Math.floor((damage * entries[i].multiplier) / 10);
      effectiveness = (effectiveness * entries[i].multiplier) / 10;
    }
  }

  // The ROM skips the roll when the damage is below 2, so a 1 stays a 1.
  if (options.roll > 0 && damage >= 2) {
    damage = Math.floor((damage * options.roll) / 255);
  }

  return {
    damage: power > 0 ? damage : 0,
    effectiveness: effectiveness,
    stab: stab,
    critical: options.critical,
    special: special,
    attackUsed: attack,
    defenseUsed: defense,
    base: base,
  };
}

/**
 * [min, max] damage over the 39 possible rolls. Ai.ts scores moves with this and
 * the tests check it against the published formula.
 */
export function damageRange(
  bundle: any,
  attacker: BattleMon,
  defender: BattleMon,
  move: MoveDef,
  options: DamageOptions
): number[] {
  const low = computeDamage(bundle, attacker, defender, move, {
    critical: options.critical,
    screened: options.screened,
    roll: MIN_DAMAGE_ROLL,
    power: options.power,
    type: options.type,
  });
  const high = computeDamage(bundle, attacker, defender, move, {
    critical: options.critical,
    screened: options.screened,
    roll: MAX_DAMAGE_ROLL,
    power: options.power,
    type: options.type,
  });
  return [low.damage, high.damage];
}
