// The battle engine's foundations, run against the real bundle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battle.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Two things this file is careful about, because this project has been bitten by
// both:
//
//   1. It does not check the shipping code against itself. Every formula is
//      transcribed a second time, from the published Generation 1 text, in the
//      REFERENCE section below -- different expressions, different order of
//      operations where the maths allows it. Agreement then means something.
//   2. It proves it can fail. `--selftest` perturbs the reference, one fault at a
//      time, and reports whether the comparison noticed. A mutation that is not
//      caught is a failure of this file, not of the engine.
//
// The statistical checks print the observed rate and the expected one; a rate that
// merely "looks fine" is not a check.

import { readFileSync } from "node:fs";

globalThis.print = (...args) => console.log("[lens]", ...args);

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: battle.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const Stats = await import("../Assets/Scripts/play/battle/Stats.ts");
const Damage = await import("../Assets/Scripts/play/battle/Damage.ts");
const Types = await import("../Assets/Scripts/play/battle/types.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const lines = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    lines.push("  PASS  " + name);
  } else {
    failed++;
    lines.push("  FAIL  " + name + (detail ? "  -- " + detail : ""));
  }
}
function note(text) {
  lines.push(text);
}
function flush() {
  for (const line of lines) console.log(line);
  lines.length = 0;
}

/** The one mutation active in a --selftest pass; "" in a normal run. */
let MUT = "";
const mut = (name) => MUT === name;

/** xorshift32: deterministic, uniform enough for a hundred thousand bytes. */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const pct = (x) => (x * 100).toFixed(4) + "%";

// ---------------------------------------------------------------------------
// REFERENCE -- the published Generation 1 formulas, transcribed independently
// ---------------------------------------------------------------------------

function refCeilSqrt(n) {
  if (n <= 0) return 0;
  let r = 0;
  while (r < 255 && r * r < n) r++;
  return r;
}

function refStatCore(base, dv, statExp, level) {
  const bonus = Math.floor(refCeilSqrt(statExp) / 4);
  return Math.floor(((2 * (base + dv) + bonus) * level) / 100);
}

function refStat(base, dv, statExp, level) {
  return refStatCore(base, dv, statExp, level) + (mut("stat-plus5") ? 6 : 5);
}

function refHp(base, dv, statExp, level) {
  return refStatCore(base, dv, statExp, level) + level + 10;
}

/** Every chart row that applies, in the bundle's own table order. */
function refMultipliers(attackType, defenderTypes) {
  const out = [];
  for (const row of bundle.typeChart.matchups) {
    if (row.attacker !== attackType) continue;
    if (defenderTypes.indexOf(row.defender) < 0) continue;
    out.push(row.multiplier);
  }
  return out;
}

/**
 * damage = ((2L/5 + 2) * Power * Attack / Defense) / 50 + 2, then STAB, then the
 * type chart, then the 217..255 roll. Written with 15/10 where the engine writes
 * `d + d/2`, and with the divisions as separate statements.
 */
function refDamage(o) {
  const level = o.crit ? o.level * 2 : o.level;
  let attack = o.attack;
  let defense = o.defense;
  if (attack > 255 || defense > 255) {
    attack = Math.floor(attack / 4);
    defense = Math.floor(defense / 4);
  }
  if (defense < 1) defense = 1;

  let d = Math.floor((2 * level) / 5) + 2;
  d = d * o.power;
  d = d * attack;
  d = Math.floor(d / defense);
  d = Math.floor(d / 50);
  if (d > (mut("no-cap") ? 1e9 : 997)) d = 997;
  d = d + 2;

  const applyStab = () => {
    if (o.stab) d = Math.floor((d * (mut("stab") ? 14 : 15)) / 10);
  };
  const applyTypes = () => {
    for (const m of o.multipliers) d = Math.floor((d * m) / 10);
  };
  if (mut("type-before-stab")) {
    applyTypes();
    applyStab();
  } else {
    applyStab();
    applyTypes();
  }

  if (o.roll > 0 && d >= 2) d = Math.floor((d * o.roll) / 255);
  return d;
}

/** floor(pct * 255 / 100) -- the rgbds `percent` macro, reversed. */
function refAccuracyByte(percent) {
  return Math.floor((percent * (mut("acc-byte") ? 256 : 255)) / 100);
}

/** floor(baseSpeed / 2) out of 256 for an ordinary move and no Focus Energy. */
function refCritThreshold(baseSpeed) {
  return Math.floor(baseSpeed / (mut("crit-speed") ? 4 : 2));
}

// ---------------------------------------------------------------------------
// Building Pokemon for the table
// ---------------------------------------------------------------------------

const flatIvs = (v) => {
  const ivs = { hp: 0, attack: v, defense: v, speed: v, special: v };
  ivs.hp = Stats.hpDv(ivs);
  return ivs;
};

function makeMon(speciesId, level, dv, stages) {
  const species = bundle.species[speciesId];
  if (!species) throw new Error("no species " + speciesId);
  const ivs = flatIvs(dv);
  const evs = Stats.zeroStats();
  const stats = Stats.computeStats(species.baseStats, ivs, evs, level);
  const mon = {
    species: speciesId,
    name: species.name,
    level,
    hp: stats.hp,
    maxHp: stats.hp,
    stats,
    battleStats: {
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
      special: stats.special,
    },
    stages: Object.assign(Stats.zeroStages(), stages || {}),
    types: species.types.slice(),
    moves: [],
    status: Types.STATUS_NONE,
    sleepTurns: 0,
    ivs,
    evs,
    exp: 0,
    volatile: Types.newVolatileState(),
    badgeBoostPasses: 0,
  };
  // Send-out clears stages, so a boosted attacker is built the way a battle would
  // build one: sent out first, then the stage raised and the stats recalculated.
  let out = Stats.sendOut(mon, 0);
  if (stages) {
    out.stages = Object.assign(out.stages, stages);
    out = Stats.recalculateBattleStats(out, 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. The stat formula
// ---------------------------------------------------------------------------

function suiteStats() {
  note("\n== The Gen 1 stat formula ==");

  // Externally checkable anchors: the published maximums for Generation 1.
  check(
    "base 100, L100, DV 15, max stat exp -> 298",
    Stats.calcStat(100, 15, 65535, 100) === 298,
    String(Stats.calcStat(100, 15, 65535, 100))
  );
  check(
    "base 100 HP, L100, DV 15, max stat exp -> 403",
    Stats.calcHp(100, 15, 65535, 100) === 403,
    String(Stats.calcHp(100, 15, 65535, 100))
  );
  check(
    "Chansey's 250 base HP maxes at 703",
    Stats.calcHp(bundle.species.CHANSEY.baseStats.hp, 15, 65535, 100) === 703,
    String(Stats.calcHp(250, 15, 65535, 100))
  );
  check(
    "Mewtwo's 130 base Speed maxes at 358",
    Stats.calcStat(bundle.species.MEWTWO.baseStats.speed, 15, 65535, 100) === 358,
    String(Stats.calcStat(130, 15, 65535, 100))
  );
  check(
    "the stat experience term tops out at 63",
    Stats.statExpBonus(65535) === 63 && Stats.statExpBonus(0) === 0,
    Stats.statExpBonus(65535) + "/" + Stats.statExpBonus(0)
  );
  check(
    "the HP DV is the four low bits, most significant first",
    Stats.hpDv({ hp: 0, attack: 1, defense: 0, speed: 1, special: 1 }) === 11,
    String(Stats.hpDv({ hp: 0, attack: 1, defense: 0, speed: 1, special: 1 }))
  );

  // Against the independent transcription, over the whole bundle.
  let mismatches = 0;
  let samples = 0;
  const levels = [5, 12, 25, 50, 100];
  const exps = [0, 1, 255, 5000, 25600, 65535];
  for (const id of Object.keys(bundle.species)) {
    const base = bundle.species[id].baseStats;
    for (const level of levels) {
      for (const dv of [0, 7, 15]) {
        const statExp = exps[samples % exps.length];
        samples++;
        if (Stats.calcStat(base.attack, dv, statExp, level) !== refStat(base.attack, dv, statExp, level)) mismatches++;
        if (Stats.calcStat(base.special, dv, statExp, level) !== refStat(base.special, dv, statExp, level)) mismatches++;
        if (Stats.calcHp(base.hp, dv, statExp, level) !== refHp(base.hp, dv, statExp, level)) mismatches++;
      }
    }
  }
  note("  " + samples * 3 + " stat values against the published formula, over all 151 species");
  check("every one agrees", mismatches === 0, mismatches + " mismatches");

  const geodude = makeMon("GEODUDE", 11, 9);
  note(
    "  GEODUDE L11 DV9: HP " + geodude.maxHp +
      "  atk " + geodude.stats.attack +
      "  def " + geodude.stats.defense +
      "  spd " + geodude.stats.speed +
      "  spc " + geodude.stats.special
  );
}

// ---------------------------------------------------------------------------
// 2. Stat stages and badge boosts
// ---------------------------------------------------------------------------

function suiteStages() {
  note("\n== Stat stages and badge boosts ==");

  const table = [];
  for (let stage = -6; stage <= 6; stage++) {
    table.push(stage + ":" + Stats.applyStatStage(200, stage));
  }
  note("  200 at every stage -6..+6 -> " + table.join(" "));
  check(
    "the ROM's own ratios, not 2/(2+n)",
    Stats.applyStatStage(200, 1) === 300 &&
      Stats.applyStatStage(200, 2) === 400 &&
      Stats.applyStatStage(200, -1) === 132 &&
      Stats.applyStatStage(200, -6) === 50,
    [1, 2, -1, -6].map((s) => Stats.applyStatStage(200, s)).join("/")
  );
  check("stages clamp at 999", Stats.applyStatStage(400, 6) === 999, String(Stats.applyStatStage(400, 6)));
  check("and floor at 1", Stats.applyStatStage(3, -6) === 1, String(Stats.applyStatStage(3, -6)));

  // One badge boost is 12.5%: value + value/8, so 7 stays 7 and 8 becomes 9.
  check(
    "one badge boost is value + value/8",
    Stats.boostOnce(100) === 112 && Stats.boostOnce(7) === 7 && Stats.boostOnce(8) === 9,
    [100, 7, 8].map(Stats.boostOnce).join("/")
  );

  // The bug: every recalculation applies it again.
  let mon = makeMon("TAUROS", 50, 9);
  const withoutBadges = mon.battleStats.attack;
  mon = Stats.sendOut(mon, 1);
  const trail = [mon.battleStats.attack];
  for (let i = 0; i < 4; i++) {
    mon = Stats.recalculateBattleStats(mon, 1);
    trail.push(mon.battleStats.attack);
  }
  note(
    "  TAUROS L50 Attack, no badge " + withoutBadges +
      "; with Boulder Badge across five recalculations: " + trail.join(" -> ")
  );
  check(
    "the badge boost compounds on every recalculation",
    trail[0] > withoutBadges && trail[4] > trail[0],
    trail.join("/")
  );
  check(
    "each pass is exactly one more 12.5% step",
    trail[1] === Stats.boostOnce(trail[0]) && trail[4] === Stats.boostOnce(trail[3]),
    trail.join("/")
  );
  const clean = Stats.recalculateWithoutBug(mon, 1);
  check(
    "and the un-bugged path stays at one boost",
    clean.battleStats.attack === trail[0],
    clean.battleStats.attack + " vs " + trail[0]
  );
  check(
    "a side with no badges is never boosted",
    Stats.sendOut(makeMon("TAUROS", 50, 9), 0).battleStats.attack === withoutBadges
  );
  check(
    "the Boulder Badge boosts Attack and nothing else",
    Stats.badgeBoostsStat("attack", 1) &&
      !Stats.badgeBoostsStat("defense", 1) &&
      !Stats.badgeBoostsStat("speed", 1) &&
      !Stats.badgeBoostsStat("special", 1)
  );
  // The badges are a SET, not a count. A player who takes Vermilion before
  // Cerulean holds Thunder (bit 2) and not Boulder (bit 0): Defense is boosted
  // and Attack is not. The old code walked the table as a prefix against a
  // count of one and boosted Attack instead -- the badge they had not earned.
  const thunderOnly = 1 << 2;
  check(
    "the Thunder Badge alone boosts Defense, not Attack",
    Stats.badgeBoostsStat("defense", thunderOnly) &&
      !Stats.badgeBoostsStat("attack", thunderOnly) &&
      !Stats.badgeBoostsStat("speed", thunderOnly) &&
      !Stats.badgeBoostsStat("special", thunderOnly)
  );
  check(
    "and holding both boosts both",
    Stats.badgeBoostsStat("attack", 1 | thunderOnly) &&
      Stats.badgeBoostsStat("defense", 1 | thunderOnly)
  );
  // A badge that boosts nothing must not shift the others along.
  check(
    "Cascade alone boosts nothing",
    ["attack", "defense", "speed", "special"].every((stat) =>
      !Stats.badgeBoostsStat(stat, 1 << 1))
  );
  check(
    "all eight boost exactly the four the table names",
    Stats.badgeBoostsStat("attack", 0xFF) && Stats.badgeBoostsStat("defense", 0xFF) &&
      Stats.badgeBoostsStat("speed", 0xFF) && Stats.badgeBoostsStat("special", 0xFF)
  );

  // Burn and paralysis ride on top.
  const burned = makeMon("TAUROS", 50, 9);
  burned.status = Types.STATUS_BURN;
  const burnedOut = Stats.sendOut(burned, 0);
  check(
    "burn halves Attack",
    burnedOut.battleStats.attack === Math.floor(withoutBadges / 2),
    burnedOut.battleStats.attack + " vs " + Math.floor(withoutBadges / 2)
  );
  const para = makeMon("TAUROS", 50, 9);
  const fullSpeed = para.battleStats.speed;
  para.status = Types.STATUS_PARALYSIS;
  check(
    "paralysis quarters Speed",
    Stats.sendOut(para, 0).battleStats.speed === Math.floor(fullSpeed / 4),
    Stats.sendOut(para, 0).battleStats.speed + " vs " + Math.floor(fullSpeed / 4)
  );
}

// ---------------------------------------------------------------------------
// 3. The type chart, read from the bundle
// ---------------------------------------------------------------------------

function suiteTypeChart() {
  note("\n== The type chart, round-tripped against the bundle ==");
  const chart = Damage.typeChartFor(bundle);
  let wrong = 0;
  for (const row of bundle.typeChart.matchups) {
    if (chart.multiplier(row.attacker, row.defender) !== row.multiplier) wrong++;
  }
  check(
    "all " + bundle.typeChart.matchups.length + " extracted rows round-trip",
    wrong === 0 && chart.count === bundle.typeChart.matchups.length,
    wrong + " wrong"
  );
  check(
    "a pair with no row is neutral",
    chart.multiplier("NORMAL", "NORMAL") === 10 && chart.multiplier("FIRE", "NORMAL") === 10
  );
  check(
    "GHOST is powerless against PSYCHIC_TYPE, which is the Gen 1 bug",
    chart.multiplier("GHOST", "PSYCHIC_TYPE") === 0
  );
  check(
    "dual types multiply: ELECTRIC on WATER/PSYCHIC_TYPE is 2x",
    chart.effectiveness("ELECTRIC", ["WATER", "PSYCHIC_TYPE"]) === 2,
    String(chart.effectiveness("ELECTRIC", ["WATER", "PSYCHIC_TYPE"]))
  );
  check(
    "and stack: ROCK on BUG/FLYING is 4x",
    chart.effectiveness("ROCK", ["BUG", "FLYING"]) === 4,
    String(chart.effectiveness("ROCK", ["BUG", "FLYING"]))
  );
  check(
    "and resist twice: GRASS on GRASS/POISON is 0.25x",
    chart.effectiveness("GRASS", ["GRASS", "POISON"]) === 0.25,
    String(chart.effectiveness("GRASS", ["GRASS", "POISON"]))
  );
  check(
    "Special is the type's property: PSYCHIC_TYPE yes, GHOST no",
    Damage.isSpecialType("PSYCHIC_TYPE") &&
      Damage.isSpecialType("FIRE") &&
      !Damage.isSpecialType("GHOST") &&
      !Damage.isSpecialType("FLYING")
  );

  // The accuracy byte round-trip, over every accuracy the ROM actually uses.
  const percents = [];
  for (const id of Object.keys(bundle.moves)) {
    const a = bundle.moves[id].accuracy;
    if (percents.indexOf(a) < 0) percents.push(a);
  }
  percents.sort((a, b) => a - b);
  let bad = 0;
  const shown = [];
  for (const p of percents) {
    const byte = Damage.accuracyByte({ accuracy: p });
    shown.push(p + "%=" + byte);
    if (byte !== refAccuracyByte(p)) bad++;
    if (Math.round((byte * 100) / 255) !== p) bad++;
  }
  note("  " + shown.join("  "));
  check("every accuracy round-trips through the ROM byte", bad === 0, bad + " wrong");
}

// ---------------------------------------------------------------------------
// 4. Damage, against the published formula
// ---------------------------------------------------------------------------

const MATCHUPS = [
  ["CHARMANDER", 10, "EMBER", "BULBASAUR", 10],
  ["SQUIRTLE", 10, "WATER_GUN", "CHARMANDER", 10],
  ["BULBASAUR", 12, "VINE_WHIP", "SQUIRTLE", 12],
  ["PIKACHU", 15, "THUNDERSHOCK", "PIDGEY", 12],
  ["GEODUDE", 11, "TACKLE", "PIKACHU", 15],
  ["ONIX", 14, "ROCK_SLIDE", "CHARMANDER", 14],
  ["MACHOP", 20, "KARATE_CHOP", "ONIX", 20],
  ["GENGAR", 50, "LICK", "ALAKAZAM", 50],
  ["ALAKAZAM", 50, "PSYCHIC_M", "GENGAR", 50],
  ["TAUROS", 50, "BODY_SLAM", "SNORLAX", 50],
  ["SNORLAX", 50, "BODY_SLAM", "TAUROS", 50],
  ["ELECTRODE", 50, "THUNDERBOLT", "STARMIE", 50],
  ["STARMIE", 100, "SURF", "GEODUDE", 100],
  ["CHANSEY", 100, "SEISMIC_TOSS", "SNORLAX", 100],
  ["JOLTEON", 100, "THUNDERBOLT", "CHANSEY", 100],
];

function suiteDamage() {
  note("\n== Damage: a table of matchups against the published formula ==");
  note(
    "  attacker            move          defender     eff  crit    engine    reference"
  );

  let disagreements = 0;
  for (const [atkId, atkLvl, moveId, defId, defLvl] of MATCHUPS) {
    const move = bundle.moves[moveId];
    const attacker = makeMon(atkId, atkLvl, 9);
    const defender = makeMon(defId, defLvl, 9);
    for (const crit of [false, true]) {
      const opts = Object.assign(Damage.defaultDamageOptions(), { critical: crit });
      const engine = Damage.damageRange(bundle, attacker, defender, move, opts);

      const special = Damage.isSpecialType(move.type);
      const attack = crit
        ? special ? attacker.stats.special : attacker.stats.attack
        : special ? attacker.battleStats.special : attacker.battleStats.attack;
      const defense = crit
        ? special ? defender.stats.special : defender.stats.defense
        : special ? defender.battleStats.special : defender.battleStats.defense;
      const shape = {
        level: attacker.level,
        power: move.power,
        attack,
        defense,
        crit,
        stab: attacker.types.indexOf(move.type) >= 0,
        multipliers: refMultipliers(move.type, defender.types),
      };
      const reference = [
        refDamage(Object.assign({}, shape, { roll: 217 })),
        refDamage(Object.assign({}, shape, { roll: 255 })),
      ];

      // Every one of the 39 rolls, not just the ends.
      let rollWrong = 0;
      for (let roll = 217; roll <= 255; roll++) {
        const got = Damage.computeDamage(bundle, attacker, defender, move, {
          critical: crit,
          screened: false,
          roll,
          power: 0,
          type: "",
        }).damage;
        if (got !== refDamage(Object.assign({}, shape, { roll }))) rollWrong++;
      }

      const eff = Damage.computeDamage(bundle, attacker, defender, move, opts).effectiveness;
      const agree = engine[0] === reference[0] && engine[1] === reference[1] && rollWrong === 0;
      if (!agree) disagreements++;
      if (!crit) {
        note(
          "  " + (atkId + " L" + atkLvl).padEnd(20) +
            moveId.padEnd(14) +
            (defId + " L" + defLvl).padEnd(14) +
            String(eff).padEnd(5) +
            "no    " +
            (engine[0] + "-" + engine[1]).padEnd(10) +
            (reference[0] + "-" + reference[1]) +
            (agree ? "" : "   <<< DISAGREE")
        );
      } else {
        note(
          "  " + "".padEnd(20 + 14 + 14 + 5) +
            "yes   " +
            (engine[0] + "-" + engine[1]).padEnd(10) +
            (reference[0] + "-" + reference[1]) +
            (agree ? "" : "   <<< DISAGREE")
        );
      }
    }
  }
  check(
    MATCHUPS.length * 2 * 39 + " damage values across " + MATCHUPS.length + " matchups agree",
    disagreements === 0,
    disagreements + " disagreements"
  );

  // Anchors that do not depend on either transcription.
  const gengar = makeMon("GENGAR", 50, 9);
  const alakazam = makeMon("ALAKAZAM", 50, 9);
  const lick = Damage.computeDamage(
    bundle, gengar, alakazam, bundle.moves.LICK, Damage.defaultDamageOptions()
  );
  check("GHOST does nothing to PSYCHIC_TYPE", lick.damage === 0 && lick.effectiveness === 0);

  const starmie = makeMon("STARMIE", 100, 9);
  const geodude = makeMon("GEODUDE", 100, 9);
  const surf = Damage.computeDamage(
    bundle, starmie, geodude, bundle.moves.SURF, Damage.defaultDamageOptions()
  );
  check(
    "WATER on ROCK/GROUND is 4x and gets STAB",
    surf.effectiveness === 4 && surf.stab,
    surf.effectiveness + "/" + surf.stab
  );

  // Reflect doubles Defense on a non-critical physical hit, and a crit ignores it.
  const tauros = makeMon("TAUROS", 50, 9);
  const snorlax = makeMon("SNORLAX", 50, 9);
  const plain = Damage.computeDamage(bundle, tauros, snorlax, bundle.moves.BODY_SLAM, {
    critical: false, screened: false, roll: 255, power: 0, type: "",
  });
  const screened = Damage.computeDamage(bundle, tauros, snorlax, bundle.moves.BODY_SLAM, {
    critical: false, screened: true, roll: 255, power: 0, type: "",
  });
  const critScreened = Damage.computeDamage(bundle, tauros, snorlax, bundle.moves.BODY_SLAM, {
    critical: true, screened: true, roll: 255, power: 0, type: "",
  });
  const critPlain = Damage.computeDamage(bundle, tauros, snorlax, bundle.moves.BODY_SLAM, {
    critical: true, screened: false, roll: 255, power: 0, type: "",
  });
  note(
    "  TAUROS Body Slam on SNORLAX: plain " + plain.damage +
      ", behind Reflect " + screened.damage +
      ", crit " + critPlain.damage +
      ", crit behind Reflect " + critScreened.damage
  );
  check("Reflect roughly halves a physical hit", screened.damage < plain.damage);
  check("a critical hit ignores Reflect", critScreened.damage === critPlain.damage);

  // A status move does nothing here, rather than the +2 the formula would give.
  const growl = Damage.computeDamage(
    bundle, tauros, snorlax, bundle.moves.GROWL, Damage.defaultDamageOptions()
  );
  check("a zero-power move deals no damage", growl.damage === 0, String(growl.damage));
}

// ---------------------------------------------------------------------------
// 5. The 1/256 miss
// ---------------------------------------------------------------------------

const MISS_TRIALS = 100000;

function suiteMiss() {
  note("\n== The 1/256 miss, over " + MISS_TRIALS.toLocaleString("en-US") + " rolls ==");
  const random = seeded(0x5eed1234);

  const bodySlam = bundle.moves.BODY_SLAM; // 100% accuracy, byte 255
  let misses = 0;
  for (let i = 0; i < MISS_TRIALS; i++) {
    if (!Damage.rollHit(bodySlam, 0, 0, random)) misses++;
  }
  const observed = misses / MISS_TRIALS;
  const expected = (mut("miss-rate") ? 2 : 1) / 256;
  note(
    "  BODY_SLAM, accuracy " + bodySlam.accuracy + "% (byte " +
      Damage.accuracyByte(bodySlam) + "): " + misses + " misses, " +
      pct(observed) + " observed, " + pct(expected) + " expected (1/256)"
  );
  check(
    "the miss rate is within a tenth of a percent of 1/256",
    Math.abs(observed - expected) < 0.001,
    "delta " + pct(Math.abs(observed - expected))
  );

  // A move with real inaccuracy misses at (256 - byte)/256, not at 100 - accuracy.
  const tackle = bundle.moves.TACKLE; // 95% -> byte 242
  let tackleMisses = 0;
  const random2 = seeded(0x1234abcd);
  for (let i = 0; i < MISS_TRIALS; i++) {
    if (!Damage.rollHit(tackle, 0, 0, random2)) tackleMisses++;
  }
  const tackleObserved = tackleMisses / MISS_TRIALS;
  const tackleExpected = (256 - Damage.accuracyByte(tackle)) / 256;
  note(
    "  TACKLE, accuracy " + tackle.accuracy + "% (byte " + Damage.accuracyByte(tackle) +
      "): " + pct(tackleObserved) + " observed, " + pct(tackleExpected) +
      " expected -- not the 5.0000% the percentage suggests"
  );
  check(
    "a 95% move misses 14/256 of the time",
    Math.abs(tackleObserved - tackleExpected) < 0.002,
    "delta " + pct(Math.abs(tackleObserved - tackleExpected))
  );

  check("Swift skips the check entirely", Damage.rollHit(bundle.moves.SWIFT, 0, 0, () => 0.9999));
  check(
    "the miss is the roll, not a special case: byte 255 vs roll 255",
    Damage.effectiveAccuracy(bodySlam, 0, 0) === 255 &&
      !Damage.rollHit(bodySlam, 0, 0, () => 255 / 256) &&
      Damage.rollHit(bodySlam, 0, 0, () => 254 / 256)
  );
  note(
    "  accuracy stages: -6 " + Damage.effectiveAccuracy(bodySlam, -6, 0) +
      "  0 " + Damage.effectiveAccuracy(bodySlam, 0, 0) +
      "  +6 " + Damage.effectiveAccuracy(bodySlam, 6, 0) +
      "   evasion +6 -> " + Damage.effectiveAccuracy(bodySlam, 0, 6)
  );
  check(
    "+6 evasion quarters the accuracy",
    Damage.effectiveAccuracy(bodySlam, 0, 6) === 63,
    String(Damage.effectiveAccuracy(bodySlam, 0, 6))
  );
}

// ---------------------------------------------------------------------------
// 6. Critical hits track base Speed
// ---------------------------------------------------------------------------

const CRIT_TRIALS = 200000;
const CRIT_SPECIES = ["SLOWPOKE", "SNORLAX", "SHELLDER", "PIKACHU", "TAUROS", "PERSIAN", "ELECTRODE"];

function suiteCrits() {
  note("\n== Critical hits come from base Speed, over " +
       CRIT_TRIALS.toLocaleString("en-US") + " rolls each ==");
  note("  species      baseSpeed  threshold  expected   observed");

  const move = bundle.moves.BODY_SLAM;
  let wrong = 0;
  let previous = -1;
  let monotone = true;
  for (const id of CRIT_SPECIES) {
    const baseSpeed = bundle.species[id].baseStats.speed;
    const mon = makeMon(id, 50, 9);
    const threshold = Damage.critChanceFor(bundle, mon, move);
    const expected = refCritThreshold(baseSpeed) / 256;
    const random = seeded(0xc0ffee + baseSpeed);
    let crits = 0;
    for (let i = 0; i < CRIT_TRIALS; i++) {
      if (Damage.rollCritical(bundle, mon, move, random)) crits++;
    }
    const observed = crits / CRIT_TRIALS;
    note(
      "  " + id.padEnd(13) + String(baseSpeed).padEnd(11) +
        String(threshold).padEnd(11) + pct(expected).padEnd(11) + pct(observed)
    );
    if (Math.abs(observed - expected) > 0.005) wrong++;
    if (threshold !== refCritThreshold(baseSpeed)) wrong++;
    if (threshold < previous) monotone = false;
    previous = threshold;
  }
  check("every observed rate matches floor(baseSpeed/2)/256", wrong === 0, wrong + " wrong");
  check("and the rate rises with base Speed", monotone);

  // Focus Energy, the move that does the opposite of what it says.
  const tauros = makeMon("TAUROS", 50, 9);
  const normal = Damage.critChanceFor(bundle, tauros, move);
  tauros.volatile.focusEnergy = true;
  const pumped = Damage.critChanceFor(bundle, tauros, move);
  note(
    "  TAUROS crit threshold " + normal + "/256 (" + pct(normal / 256) +
      "), with Focus Energy " + pumped + "/256 (" + pct(pumped / 256) + ")"
  );
  check("Focus Energy quarters the crit rate instead of quadrupling it", pumped * 4 <= normal + 3);

  // High-critical moves.
  const machop = makeMon("MACHOP", 20, 9);
  const chop = Damage.critChanceFor(bundle, machop, bundle.moves.KARATE_CHOP);
  const punch = Damage.critChanceFor(bundle, machop, bundle.moves.MEGA_PUNCH);
  note("  MACHOP: Karate Chop " + chop + "/256, Mega Punch " + punch + "/256");
  // Gen 1 multiplies by 8, not by 2: a high-critical move doubles twice where an
  // ordinary one halves. Slash on anything fast is a guaranteed critical hit.
  check("a high-critical move is eight times as likely", chop === Math.min(255, punch * 8));
  const persian = makeMon("PERSIAN", 50, 9);
  check(
    "which is why Slash always crits",
    Damage.critChanceFor(bundle, persian, bundle.moves.SLASH) === 255,
    String(Damage.critChanceFor(bundle, persian, bundle.moves.SLASH))
  );

  check("a zero-power move never crits", !Damage.rollCritical(bundle, tauros, bundle.moves.GROWL, () => 0));
  check(
    "the rotate is a bijection over the byte",
    (() => {
      const seen = [];
      for (let i = 0; i < 256; i++) seen.push(Damage.rotateLeft3(i));
      seen.sort((a, b) => a - b);
      for (let i = 0; i < 256; i++) if (seen[i] !== i) return false;
      return true;
    })()
  );
}

// ---------------------------------------------------------------------------
// 7. The bug: a boosted attacker crits for less
// ---------------------------------------------------------------------------

function suiteCritLessThanNormal() {
  note("\n== A +2 attacker's critical hit does LESS than its ordinary one ==");

  const attacker = makeMon("TAUROS", 50, 9, { attack: 2 });
  const defender = makeMon("SNORLAX", 50, 9);
  const move = bundle.moves.BODY_SLAM;

  const plainRange = Damage.damageRange(bundle, attacker, defender, move,
    Damage.defaultDamageOptions());
  const critRange = Damage.damageRange(bundle, attacker, defender, move,
    Object.assign(Damage.defaultDamageOptions(), { critical: true }));

  const plain = Damage.computeDamage(bundle, attacker, defender, move, {
    critical: false, screened: false, roll: 255, power: 0, type: "",
  });
  const crit = Damage.computeDamage(bundle, attacker, defender, move, {
    critical: true, screened: false, roll: 255, power: 0, type: "",
  });

  note("  TAUROS L50 at +2 Attack, Body Slam, into SNORLAX L50");
  note("    unmodified Attack " + attacker.stats.attack +
       "   in-battle Attack at +2 " + attacker.battleStats.attack);
  note("    ordinary hit uses attack " + plain.attackUsed + " at level 50  -> " +
       plainRange[0] + "-" + plainRange[1]);
  note("    critical hit uses attack " + crit.attackUsed + " at level 100 -> " +
       critRange[0] + "-" + critRange[1]);
  note("    the crit doubles (2L/5+2) from 22 to 42, worth 42/44 of the +2 stage");

  check(
    "the critical hit is the weaker one",
    critRange[1] < plainRange[1] && critRange[0] < plainRange[0],
    critRange.join("-") + " vs " + plainRange.join("-")
  );
  check(
    "because the crit read the unmodified Attack",
    crit.attackUsed === attacker.stats.attack &&
      plain.attackUsed === attacker.battleStats.attack,
    crit.attackUsed + "/" + plain.attackUsed
  );

  // Without the boost, the crit is the stronger one, as a player would expect.
  const flat = makeMon("TAUROS", 50, 9);
  const flatPlain = Damage.damageRange(bundle, flat, defender, move, Damage.defaultDamageOptions());
  const flatCrit = Damage.damageRange(bundle, flat, defender, move,
    Object.assign(Damage.defaultDamageOptions(), { critical: true }));
  note("  the same TAUROS with no boost: ordinary " + flatPlain[0] + "-" + flatPlain[1] +
       ", critical " + flatCrit[0] + "-" + flatCrit[1]);
  check("an unboosted attacker still crits for more", flatCrit[1] > flatPlain[1]);
}

// ---------------------------------------------------------------------------
// 8. The contract itself: everything four other modules will call
// ---------------------------------------------------------------------------

function suiteContract() {
  note("\n== The contract the rest of the engine codes against ==");

  const pidgey = Stats.makeWildMon(bundle, "PIDGEY", 3, seeded(99));
  note(
    "  makeWildMon PIDGEY L3: HP " + pidgey.hp + "/" + pidgey.maxHp +
      "  DVs " + [pidgey.ivs.hp, pidgey.ivs.attack, pidgey.ivs.defense,
                  pidgey.ivs.speed, pidgey.ivs.special].join("/") +
      "  moves " + pidgey.moves.map((m) => m.id + "(" + m.pp + ")").join(" ")
  );
  check("a wild Pokemon arrives at full HP", pidgey.hp === pidgey.maxHp && pidgey.hp > 0);
  check("with no stat experience", pidgey.evs.attack === 0 && pidgey.evs.hp === 0);
  check("no status and clear volatiles", pidgey.status === "" && pidgey.volatile.substituteHp === 0);
  check("and no badge boost until it is sent out", pidgey.badgeBoostPasses === 0);
  check(
    "the level 3 moveset is Gust only, at 35 PP",
    pidgey.moves.length === 1 && pidgey.moves[0].id === "GUST" && pidgey.moves[0].maxPp === 35,
    pidgey.moves.map((m) => m.id).join(",")
  );
  const pidgeot = Stats.makeWildMon(bundle, "PIDGEY", 50, seeded(7));
  check(
    "a level 50 one keeps the last four it learned",
    pidgeot.moves.length === 4 &&
      pidgeot.moves.map((m) => m.id).join(",") === "WHIRLWIND,WING_ATTACK,AGILITY,MIRROR_MOVE",
    pidgeot.moves.map((m) => m.id).join(",")
  );
  check("every DV lands in 0..15", (() => {
    for (let i = 0; i < 400; i++) {
      const m = Stats.makeWildMon(bundle, "RATTATA", 5, seeded(i + 1));
      for (const k of ["hp", "attack", "defense", "speed", "special"]) {
        if (m.ivs[k] < 0 || m.ivs[k] > 15) return false;
      }
      if (m.ivs.hp !== Stats.hpDv(m.ivs)) return false;
    }
    return true;
  })());

  // The damage roll, which BattleState draws once per hit.
  const random = seeded(0xd1ce);
  const seen = {};
  let outside = 0;
  for (let i = 0; i < 200000; i++) {
    const r = Damage.damageRoll(random);
    if (r < 217 || r > 255) outside++;
    seen[r] = (seen[r] || 0) + 1;
  }
  const distinct = Object.keys(seen).length;
  let worst = 0;
  for (const k of Object.keys(seen)) {
    worst = Math.max(worst, Math.abs(seen[k] / 200000 - 1 / 39));
  }
  note(
    "  damageRoll over 200,000 draws: " + distinct + " distinct values, all in 217..255, " +
      "worst deviation from uniform " + pct(worst)
  );
  check("the roll covers all 39 values and nothing else", distinct === 39 && outside === 0,
        distinct + " distinct, " + outside + " outside");
  check("and is close to uniform", worst < 0.002, pct(worst));

  // Turn actions.
  const a = Types.moveAction(2);
  const s = Types.switchAction(3);
  const n = Types.noAction();
  check(
    "TurnAction helpers fill every field",
    a.kind === "move" && a.moveIndex === 2 && a.partyIndex === -1 && a.item === "" &&
      s.kind === "switch" && s.partyIndex === 3 && s.moveIndex === -1 &&
      n.kind === "" && n.moveIndex === -1
  );
  check(
    "the ACTION_* constants are the strings the helpers use",
    Types.ACTION_MOVE === "move" && Types.ACTION_SWITCH === "switch" &&
      Types.ACTION_ITEM === "item" && Types.ACTION_RUN === "run"
  );
  check(
    "STATUS_* are distinct and STATUS_NONE is falsy",
    Types.STATUS_NONE === "" &&
      new Set([Types.STATUS_SLEEP, Types.STATUS_POISON, Types.STATUS_BURN,
               Types.STATUS_FREEZE, Types.STATUS_PARALYSIS]).size === 5
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function runAll() {
  passed = 0;
  failed = 0;
  lines.length = 0;
  suiteStats();
  suiteStages();
  suiteTypeChart();
  suiteDamage();
  suiteMiss();
  suiteCrits();
  suiteCritLessThanNormal();
  suiteContract();
}

if (!selftest) {
  runAll();
  flush();
  console.log("\nBATTLE  " + passed + " PASS  " + failed + " FAIL  " +
              (failed === 0 ? "OK" : "FAILED"));
  process.exit(failed === 0 ? 0 : 1);
} else {
  // Prove the checks discriminate: perturb the reference, one fault at a time.
  const MUTATIONS = [
    ["stat-plus5", "the stat formula adds 6 instead of 5"],
    ["stab", "STAB is 1.4x instead of 1.5x"],
    ["type-before-stab", "type effectiveness applied before STAB"],
    ["acc-byte", "the accuracy byte scales by 256 instead of 255"],
    ["miss-rate", "the miss rate is expected to be 2/256"],
    ["crit-speed", "the crit threshold is expected to be baseSpeed/4"],
  ];
  let notCaught = 0;
  console.log("\n== Self test: every mutation must be caught ==");
  for (const [name, description] of MUTATIONS) {
    MUT = name;
    runAll();
    lines.length = 0;
    const caught = failed > 0;
    if (!caught) notCaught++;
    console.log(
      "  " + (caught ? "CAUGHT    " : "NOT CAUGHT") + "  " + name.padEnd(18) +
        failed + " failures  -- " + description
    );
  }
  MUT = "";
  runAll();
  lines.length = 0;
  console.log("  " + (failed === 0 ? "CLEAN     " : "DIRTY     ") +
              "  unmutated          " + failed + " failures");
  const ok = notCaught === 0 && failed === 0;
  console.log("\nBATTLE SELFTEST  " + (ok ? "OK -- the gate discriminates" : "FAILED"));
  process.exit(ok ? 0 : 1);
}
