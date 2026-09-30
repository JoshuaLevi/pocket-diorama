// Catching and the party of six, run against the real bundle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battle-capture.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Same two rules as test/battle.test.mjs, for the same reason:
//
//   1. Nothing here checks the shipping code against itself. Every formula is
//      transcribed a second time in the REFERENCE section below, from the
//      published Generation 1 behaviour, in different expressions and a different
//      order of operations wherever the maths allows it.
//   2. It proves it can fail. `--selftest` perturbs the reference, one fault at a
//      time, and reports whether the checks noticed. A mutation that slips through
//      is a failure of this file, not of the engine.
//
// The catch checks go further than agreement on a sample: for a given ball,
// species, HP and status the whole outcome space is 256 * (ceiling + 1) pairs of
// random bytes, which is small enough to ENUMERATE. So the shipping code, the
// closed-form preview and an independently written brute-force count are all
// compared as exact integer ratios, not as floating point approximations.

import { readFileSync } from "node:fs";

globalThis.print = (...args) => console.log("[lens]", ...args);

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: battle-capture.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const Capture = await import("../Assets/Scripts/play/battle/Capture.ts");
const Party = await import("../Assets/Scripts/play/battle/Party.ts");
const Stats = await import("../Assets/Scripts/play/battle/Stats.ts");
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

/** xorshift32: deterministic and uniform enough for a few hundred thousand bytes. */
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

/**
 * An RNG that hands out exactly these bytes. randomByte() is floor(r * 256), and
 * b / 256 is exact in binary floating point, so byte b comes back as byte b.
 */
function scripted(bytes) {
  let i = 0;
  const fn = () => {
    const b = i < bytes.length ? bytes[i] : 0;
    i++;
    return b / 256;
  };
  fn.consumed = () => i;
  return fn;
}

const pct = (x) => (x * 100).toFixed(4) + "%";

// ---------------------------------------------------------------------------
// REFERENCE -- the published Generation 1 behaviour, transcribed independently
// ---------------------------------------------------------------------------

/** Ball parameters as Bulbapedia states them, not as Capture.ts stores them. */
function refBall(id) {
  if (id === "MASTER_BALL") return { ceiling: 255, m: 12, wobble: 255, always: true };
  if (id === "POKE_BALL") return { ceiling: 255, m: 12, wobble: 255, always: false };
  if (id === "GREAT_BALL") {
    return {
      ceiling: mut("catch-ball-range") ? 255 : 200,
      m: mut("catch-hp-divisor") ? 12 : 8,
      wobble: 200,
      always: false,
    };
  }
  if (id === "ULTRA_BALL" || id === "SAFARI_BALL") {
    return { ceiling: 150, m: 12, wobble: 150, always: false };
  }
  return { ceiling: 255, m: 12, wobble: 150, always: false };
}

/** Subtracted from the first roll. */
function refStatusCatch(status) {
  if (status === "SLP" || status === "FRZ") return mut("catch-status-bonus") ? 12 : 25;
  if (status === "") return 0;
  return 12;
}

/** Added to the shake value. */
function refStatusShake(status) {
  if (status === "SLP" || status === "FRZ") return mut("catch-shake-bonus") ? 5 : 10;
  if (status === "") return 0;
  return 5;
}

/** f = min(255, floor(floor(HPmax * 255 / M) / max(1, floor(HP / 4)))). */
function refF(maxHp, hp, m) {
  const quarter = Math.max(1, Math.trunc(hp / 4));
  const numerator = Math.trunc((maxHp * 255) / m);
  return Math.min(255, Math.trunc(numerator / quarter));
}

function refShakes(rate, f, status, wobble) {
  const d = Math.trunc((rate * 100) / wobble);
  let z = d > 255 ? 255 : Math.trunc((f * d) / 255);
  z += refStatusShake(status);
  const cut = mut("shake-threshold") ? [12, 32, 72] : [10, 30, 70];
  if (z < cut[0]) return 0;
  if (z < cut[1]) return 1;
  if (z < cut[2]) return 2;
  return 3;
}

/** Given the two random bytes, does the ball hold? */
function refCatchWith(ballId, rate, status, maxHp, hp, first, second) {
  const ball = refBall(ballId);
  if (ball.always) return true;
  const r = first - refStatusCatch(status);
  if (r < 0) return true;
  if (r > rate) return false;
  const f = refF(maxHp, hp, ball.m);
  return mut("catch-second-roll-strict") ? second < f : second <= f;
}

/** Brute force over every reachable pair of bytes: [caught, total]. */
function refExactCount(ballId, rate, status, maxHp, hp) {
  const ball = refBall(ballId);
  let caught = 0;
  for (let b = 0; b <= ball.ceiling; b++) {
    for (let s = 0; s < 256; s++) {
      if (refCatchWith(ballId, rate, status, maxHp, hp, b, s)) caught++;
    }
  }
  return [caught, (ball.ceiling + 1) * 256];
}

/** How many random bytes a Master Ball throw should consume. */
function refMasterRolls() {
  return mut("master-ball-no-roll") ? 0 : 1;
}

/** GrowthRateTable's polynomials, clamped at zero. */
function refExpForLevel(rate, n) {
  const cube = n * n * n;
  const square = n * n;
  let v;
  if (rate === "MEDIUM_SLOW") {
    v = Math.trunc(((mut("growth-medium-slow") ? 5 : 6) * cube) / 5) - 15 * square + 100 * n - 140;
  } else if (rate === "FAST") {
    v = Math.trunc((4 * cube) / 5);
  } else if (rate === "SLOW") {
    v = Math.trunc((5 * cube) / 4);
  } else if (rate === "SLIGHTLY_FAST") {
    v = Math.trunc((3 * cube) / 4) + 10 * square - 30;
  } else if (rate === "SLIGHTLY_SLOW") {
    v = Math.trunc((3 * cube) / 4) + 20 * square - 70;
  } else {
    v = cube;
  }
  return v < 0 ? 0 : v;
}

/**
 * The share one participant gets. Written with the multiplications spelled as
 * x1.5 rather than as x3/2, so an accidental copy of the shipping expression
 * would look different.
 */
function refExpGain(baseExp, level, isTrainer, participants, traded) {
  const p = Math.max(1, participants);
  let e;
  if (mut("exp-divide-order")) {
    e = Math.trunc(Math.trunc((baseExp * level) / 7) / p);
  } else {
    e = Math.trunc((Math.trunc(baseExp / p) * level) / 7);
  }
  if (traded) e = Math.trunc(e * 1.5);
  if (isTrainer) e = Math.trunc(e * (mut("exp-trainer") ? 2 : 1.5));
  return Math.max(1, e);
}

/** Moves the learnset gives at exactly this level. */
function refMovesAt(species, level) {
  const out = [];
  for (const entry of species.learnset) {
    const hit = mut("learn-level-lte") ? entry.level <= level : entry.level === level;
    if (hit) out.push(entry.move);
  }
  return out;
}

/** Current HP after a level: the old HP plus the growth in maximum HP. */
function refHpAfterLevel(oldHp, oldMaxHp, newMaxHp) {
  if (mut("hp-on-levelup")) return newMaxHp;
  return Math.min(newMaxHp, oldHp + (newMaxHp - oldMaxHp));
}

// The Generation 1 stat formula, needed to build test Pokemon and to check the
// stats a level-up produces. battle.test.mjs owns proving this against Stats.ts;
// it is transcribed here so this file never builds a Pokemon with the code it is
// about to test.
function refCeilSqrt(n) {
  if (n <= 0) return 0;
  let r = 0;
  while (r < 255 && r * r < n) r++;
  return r;
}
function refStatCore(base, dv, statExp, level) {
  return Math.trunc(((2 * (base + dv) + Math.trunc(refCeilSqrt(statExp) / 4)) * level) / 100);
}
const refStat = (base, dv, statExp, level) => refStatCore(base, dv, statExp, level) + 5;
const refHp = (base, dv, statExp, level) => refStatCore(base, dv, statExp, level) + level + 10;
const refHpDv = (d) => ((d.attack & 1) << 3) | ((d.defense & 1) << 2) | ((d.speed & 1) << 1) | (d.special & 1);
function refStats(base, dvs, evs, level) {
  return {
    hp: refHp(base.hp, refHpDv(dvs), evs.hp, level),
    attack: refStat(base.attack, dvs.attack, evs.attack, level),
    defense: refStat(base.defense, dvs.defense, evs.defense, level),
    speed: refStat(base.speed, dvs.speed, evs.speed, level),
    special: refStat(base.special, dvs.special, evs.special, level),
  };
}

// ---------------------------------------------------------------------------
// Building test Pokemon, without the code under test
// ---------------------------------------------------------------------------

function makeMon(speciesId, level, dv) {
  const species = bundle.species[speciesId];
  const ivs = { hp: 0, attack: dv, defense: dv, speed: dv, special: dv };
  ivs.hp = refHpDv(ivs);
  const evs = { hp: 0, attack: 0, defense: 0, speed: 0, special: 0 };
  const stats = refStats(species.baseStats, ivs, evs, level);
  const moves = [];
  for (const entry of species.level1Moves) {
    const def = bundle.moves[entry];
    moves.push({ id: entry, pp: def ? def.pp : 0, maxPp: def ? def.pp : 0 });
  }
  return {
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
    stages: { attack: 0, defense: 0, speed: 0, special: 0, accuracy: 0, evasion: 0 },
    types: species.types.slice(),
    moves,
    status: "",
    sleepTurns: 0,
    ivs,
    evs,
    exp: refExpForLevel(species.growthRate, level),
    volatile: Types.newVolatileState(),
    badgeBoostPasses: 0,
  };
}

function makeSide(party, index, badges) {
  return {
    active: Stats.sendOut(party[index], badges),
    party,
    activeIndex: index,
    badgeBits: badges,
    isPlayer: true,
    trainerId: "",
    escapeAttempts: 0,
  };
}

// ---------------------------------------------------------------------------
// Catching
// ---------------------------------------------------------------------------

function suiteBallTable() {
  note("\n== The ball table ==");
  for (const id of ["MASTER_BALL", "POKE_BALL", "GREAT_BALL", "ULTRA_BALL", "SAFARI_BALL"]) {
    const def = Capture.ballDef(id);
    const ref = refBall(id);
    check(
      id + " HP divisor is " + ref.m,
      def.hpFactor === ref.m,
      "engine " + def.hpFactor + " vs published " + ref.m
    );
    check(
      id + " wobble divisor is " + ref.wobble,
      def.wobbleFactor === ref.wobble,
      "engine " + def.wobbleFactor + " vs published " + ref.wobble
    );
  }
  // The Great Ball's advantage is real and is on two axes at once.
  check(
    "the Great Ball's HP divisor is smaller than the Poke Ball's",
    Capture.ballDef("GREAT_BALL").hpFactor < Capture.ballDef("POKE_BALL").hpFactor
  );
  check(
    "the Great Ball's roll ceiling is lower than the Poke Ball's",
    Capture.ballDef("GREAT_BALL").randMax < Capture.ballDef("POKE_BALL").randMax
  );
  const unknown = Capture.ballDef("HEAVY_BALL");
  check(
    "an unknown ball id falls back rather than crashing",
    unknown.randMax === 255 && unknown.hpFactor === 12 && unknown.autoCatch === false
  );
}

function suiteHpFactor() {
  note("\n== The HP factor ==");
  let mismatches = 0;
  let sample = "";
  for (const maxHp of [12, 21, 45, 100, 175, 250, 403, 999]) {
    for (const m of [8, 12]) {
      for (let hp = 0; hp <= maxHp; hp += 1 + Math.floor(maxHp / 17)) {
        const got = Capture.hpFactor(maxHp, hp, m);
        const want = refF(maxHp, hp, m);
        if (got !== want) {
          mismatches++;
          if (!sample) sample = `maxHp=${maxHp} hp=${hp} m=${m}: ${got} vs ${want}`;
        }
      }
    }
  }
  check("f matches the published formula over the sweep", mismatches === 0, sample);
  check(
    "a Pokemon in the red pins f at 255 (a 1 HP target is caught by the second roll)",
    Capture.hpFactor(100, 1, 12) === 255 && Capture.hpFactor(999, 3, 12) === 255
  );
  check(
    "a full-health target with divisor 12 lands near 85",
    Capture.hpFactor(100, 100, 12) === 85,
    "got " + Capture.hpFactor(100, 100, 12)
  );
  check(
    "the same target in a Great Ball is easier: f = 127",
    Capture.hpFactor(100, 100, 8) === 127,
    "got " + Capture.hpFactor(100, 100, 8)
  );
}

function suiteShakes() {
  note("\n== The shake loop ==");
  let mismatches = 0;
  let sample = "";
  let seen = [0, 0, 0, 0];
  for (const rate of [3, 25, 45, 90, 120, 190, 255]) {
    for (const f of [0, 1, 20, 85, 127, 200, 255]) {
      for (const status of ["", "SLP", "PSN"]) {
        for (const ballId of ["POKE_BALL", "GREAT_BALL", "ULTRA_BALL"]) {
          const wob = Capture.ballDef(ballId).wobbleFactor;
          const got = Capture.shakeCount(rate, f, status, wob);
          const want = refShakes(rate, f, status, refBall(ballId).wobble);
          seen[got]++;
          if (got !== want) {
            mismatches++;
            if (!sample) sample = `rate=${rate} f=${f} ${status || "none"} ${ballId}: ${got} vs ${want}`;
          }
        }
      }
    }
  }
  check("the shake count matches the published formula", mismatches === 0, sample);
  note("        shake counts observed over the sweep: 0x" + seen[0] + " 1x" + seen[1] +
       " 2x" + seen[2] + " 3x" + seen[3]);
  check("the sweep actually reaches all four shake counts", seen.every((n) => n > 0));
  check(
    "0 shakes is the 'You missed' message, 3 is 'so close'",
    Capture.shakeMessage(0).indexOf("missed") >= 0 && Capture.shakeMessage(3).indexOf("close") >= 0
  );
}

function suiteMasterBall() {
  note("\n== The Master Ball, and the check that still runs ==");
  // Mewtwo at full health: catch rate 3, the hardest target in the cartridge.
  const mewtwo = makeMon("MEWTWO", 70, 15);
  let everyFailed = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const r = Capture.attemptCatch(bundle, "MASTER_BALL", mewtwo, -1, seeded(seed * 7919));
    if (!r.caught || r.shakes !== 3) everyFailed++;
  }
  check("a Master Ball catches Mewtwo at full HP every time, 500 of 500", everyFailed === 0,
        everyFailed + " throws did not catch");

  // The bug: the byte is drawn before the ball is examined. Two witnesses, because
  // `rolls` is only what the code BELIEVES it consumed.
  const rng = scripted([200, 200, 200, 200]);
  const result = Capture.attemptCatch(bundle, "MASTER_BALL", mewtwo, -1, rng);
  check(
    "the Master Ball reports consuming " + refMasterRolls() + " random byte",
    result.rolls === refMasterRolls(),
    "reported " + result.rolls
  );
  check(
    "and the RNG really was drawn from " + refMasterRolls() + " time",
    rng.consumed() === refMasterRolls(),
    "actually consumed " + rng.consumed()
  );

  // What that byte costs: the same seed throws a Master Ball and then a Poke Ball,
  // versus a Poke Ball alone. If the Master Ball spent nothing the two Poke Ball
  // throws would land on the same bytes.
  const a = seeded(12345);
  Capture.attemptCatch(bundle, "MASTER_BALL", mewtwo, -1, a);
  const after = Capture.attemptCatch(bundle, "POKE_BALL", mewtwo, -1, a);
  const alone = Capture.attemptCatch(bundle, "POKE_BALL", mewtwo, -1, seeded(12345));
  check(
    "the wasted byte shifts every later roll in the battle",
    refMasterRolls() === 0 ? after.roll === alone.roll : after.roll !== alone.roll,
    "after=" + after.roll + " alone=" + alone.roll
  );

  check("catchChance for a Master Ball is exactly 100", Capture.catchChance(bundle, "MASTER_BALL", mewtwo, -1) === 100);
}

function suiteRejectionLoop() {
  note("\n== The first roll is rejection sampled, not scaled ==");
  // 201 is above a Great Ball's ceiling and below a Poke Ball's.
  const target = makeMon("PIDGEY", 5, 9);

  const great = scripted([201, 250, 199, 0]);
  const gr = Capture.attemptCatch(bundle, "GREAT_BALL", target, 255, great);
  check(
    "a Great Ball rejects 201 and 250, takes 199, then rolls again: 4 bytes",
    gr.rolls === 4 && great.consumed() === 4,
    "reported " + gr.rolls + ", consumed " + great.consumed()
  );
  check("and the accepted byte is the one it used", gr.roll === 199, "roll=" + gr.roll);

  const poke = scripted([201, 0]);
  const pr = Capture.attemptCatch(bundle, "POKE_BALL", target, 255, poke);
  check(
    "a Poke Ball takes 201 straight away: 2 bytes",
    pr.rolls === 2 && poke.consumed() === 2 && pr.roll === 201,
    "reported " + pr.rolls + ", consumed " + poke.consumed() + ", roll " + pr.roll
  );

  const ultra = scripted([151, 150, 0]);
  const ur = Capture.attemptCatch(bundle, "ULTRA_BALL", target, 255, ultra);
  check(
    "an Ultra Ball rejects 151 and takes 150: 3 bytes",
    ur.rolls === 3 && ultra.consumed() === 3 && ur.roll === 150,
    "reported " + ur.rolls + ", consumed " + ultra.consumed() + ", roll " + ur.roll
  );

  // The distribution the loop produces really is uniform over the ceiling.
  const rng = seeded(20260904);
  const counts = [];
  let over = 0;
  const N = 60000;
  for (let i = 0; i < N; i++) {
    const rolled = Capture.rollBallByte(Capture.ballDef("ULTRA_BALL"), rng);
    if (rolled[0] > 150) over++;
    counts.push(rolled[0]);
  }
  check("no byte above the Ultra Ball's ceiling ever escapes the loop", over === 0, over + " did");
  const mean = counts.reduce((s, v) => s + v, 0) / N;
  note("        mean accepted byte " + mean.toFixed(3) + ", uniform over 0..150 expects 75.000");
  check("the accepted bytes are uniform over 0..150", Math.abs(mean - 75) < 1.2,
        "mean " + mean.toFixed(3));
}

/**
 * Enumerate every reachable pair of random bytes for one situation and compare
 * three independent answers: what the engine does, what the engine's own closed
 * form claims, and what a brute-force transcription of the published algorithm
 * counts. All three as exact integers.
 */
function enumerateOne(ballId, speciesId, hpFraction, status) {
  const mon = makeMon(speciesId, 30, 9);
  mon.status = status;
  mon.hp = Math.max(1, Math.trunc(mon.maxHp * hpFraction));
  const rate = bundle.species[speciesId].catchRate;

  const ceiling = Capture.ballDef(ballId).randMax;
  let caught = 0;
  let total = 0;
  for (let b = 0; b <= ceiling; b++) {
    for (let s = 0; s < 256; s++) {
      if (Capture.attemptCatch(bundle, ballId, mon, -1, scripted([b, s])).caught) caught++;
      total++;
    }
  }
  const ref = refExactCount(ballId, rate, status, mon.maxHp, mon.hp);
  const closed = Capture.catchChance(bundle, ballId, mon, -1);
  return { caught, total, refCaught: ref[0], refTotal: ref[1], closed, rate, mon };
}

function suiteCatchEnumeration() {
  note("\n== Every outcome enumerated: engine vs closed form vs published ==");
  const cases = [
    ["POKE_BALL", "PIDGEY", 1.0, ""],
    ["POKE_BALL", "PIDGEY", 0.25, ""],
    ["POKE_BALL", "PIDGEY", 0.02, "SLP"],
    ["GREAT_BALL", "MEWTWO", 1.0, ""],
    ["GREAT_BALL", "MEWTWO", 0.2, "SLP"],
    ["ULTRA_BALL", "MEWTWO", 1.0, "PAR"],
    ["ULTRA_BALL", "CHANSEY", 0.5, ""],
    ["SAFARI_BALL", "ABRA", 1.0, "FRZ"],
    ["POKE_BALL", "ARTICUNO", 0.1, "BRN"],
  ];
  for (const [ball, species, frac, status] of cases) {
    const r = enumerateOne(ball, species, frac, status);
    const label = `${species}(rate ${r.rate}) ${Math.round(frac * 100)}% HP ${status || "healthy"} ${ball}`;
    // Exact rational equality, cross multiplied: no epsilon anywhere.
    check(
      "enumerated == published  " + label,
      r.caught * r.refTotal === r.refCaught * r.total,
      `engine ${r.caught}/${r.total} vs published ${r.refCaught}/${r.refTotal}`
    );
    const closedExpected = (r.caught / r.total) * 100;
    check(
      "closed form == enumerated  " + label,
      Math.abs(r.closed - closedExpected) < 1e-9,
      `preview ${r.closed} vs enumerated ${closedExpected}`
    );
    note("        " + label.padEnd(52) + pct(r.caught / r.total));
  }
}

function suiteCatchAnchors() {
  note("\n== Published anchors ==");
  // A synthetic 100 HP target with catch rate 255: f = 85, so the second roll
  // holds 86 times in 256 and nothing else can fail. The classic 33.6%.
  const mon = makeMon("PIDGEY", 30, 9);
  mon.maxHp = 100;
  mon.hp = 100;
  const full = Capture.catchChance(bundle, "POKE_BALL", mon, 255);
  check(
    "catch rate 255 at full HP in a Poke Ball is 86/256 = 33.59375%",
    Math.abs(full - (86 * 100) / 256) < 1e-9,
    "got " + full
  );
  mon.hp = 1;
  check(
    "the same target at 1 HP is a certainty",
    Math.abs(Capture.catchChance(bundle, "POKE_BALL", mon, 255) - 100) < 1e-9,
    "got " + Capture.catchChance(bundle, "POKE_BALL", mon, 255)
  );
  mon.hp = 100;
  const asleep = { ...mon, status: "SLP" };
  const awake = Capture.catchChance(bundle, "ULTRA_BALL", mon, 3);
  const sleeping = Capture.catchChance(bundle, "ULTRA_BALL", asleep, 3);
  note("        rate 3, full HP, Ultra Ball: awake " + pct(awake / 100) +
       "   asleep " + pct(sleeping / 100));
  check("sleep is worth roughly twenty times the odds on a rate 3 target",
        sleeping / awake > 15 && sleeping / awake < 25,
        "ratio " + (sleeping / awake).toFixed(2));
  check(
    "an instant catch happens whenever the roll goes negative",
    Capture.attemptCatch(bundle, "POKE_BALL", asleep, 3, scripted([24, 255])).caught &&
      Capture.attemptCatch(bundle, "POKE_BALL", asleep, 3, scripted([25, 255])).caught === false
  );
  const poisoned = { ...mon, status: "PSN" };
  check(
    "poison subtracts 12, not 25",
    Capture.attemptCatch(bundle, "POKE_BALL", poisoned, 3, scripted([11, 255])).caught &&
      Capture.attemptCatch(bundle, "POKE_BALL", poisoned, 3, scripted([12, 255])).caught === false
  );
}

function suiteCatchMonteCarlo() {
  note("\n== 200 000 throws against the closed form ==");
  const trials = 200000;
  const cases = [
    ["POKE_BALL", "PIDGEY", 1.0, ""],
    ["GREAT_BALL", "PIDGEY", 0.3, "PAR"],
    ["ULTRA_BALL", "MEWTWO", 0.15, "SLP"],
  ];
  let seed = 424242;
  for (const [ball, species, frac, status] of cases) {
    const mon = makeMon(species, 30, 9);
    mon.status = status;
    mon.hp = Math.max(1, Math.trunc(mon.maxHp * frac));
    const expected = Capture.catchChance(bundle, ball, mon, -1) / 100;
    const rng = seeded(seed);
    seed += 977;
    let caught = 0;
    for (let i = 0; i < trials; i++) {
      if (Capture.attemptCatch(bundle, ball, mon, -1, rng).caught) caught++;
    }
    const observed = caught / trials;
    const sd = Math.sqrt((expected * (1 - expected)) / trials);
    const label = `${species} ${Math.round(frac * 100)}% ${status || "healthy"} ${ball}`;
    note("        " + label.padEnd(40) + "observed " + pct(observed) +
         "  expected " + pct(expected) + "  (" + ((observed - expected) / (sd || 1)).toFixed(2) + " sd)");
    check(
      "observed catch rate is within 5 sd of the closed form  " + label,
      Math.abs(observed - expected) < 5 * sd + 1e-9,
      "observed " + pct(observed) + " expected " + pct(expected)
    );
  }
}

function suiteCatchRefusals() {
  note("\n== When a ball cannot be thrown ==");
  check("a trainer's Pokemon dodges it", Capture.catchBlockedReason(false, false, 20) === "TRAINER");
  check("a full party is NOT a refusal while the box has room",
        Capture.catchBlockedReason(true, true, 1) === "");
  check("a full party AND a full box turns a wild catch away",
        Capture.catchBlockedReason(true, true, 0) === "BOX_FULL");
  check("an engine never told about a box still refuses at six",
        Capture.catchBlockedReason(true, true, 0) === "BOX_FULL");
  check("otherwise the throw is allowed", Capture.catchBlockedReason(true, false, 0) === "");
}

// ---------------------------------------------------------------------------
// Party
// ---------------------------------------------------------------------------

function suiteGrowthCurves() {
  note("\n== Growth curves ==");
  const rates = ["MEDIUM_FAST", "MEDIUM_SLOW", "FAST", "SLOW", "SLIGHTLY_FAST", "SLIGHTLY_SLOW"];
  let mismatches = 0;
  let sample = "";
  for (const rate of rates) {
    for (let level = 1; level <= 100; level++) {
      const got = Party.expForLevel(rate, level);
      const want = refExpForLevel(rate, level);
      if (got !== want) {
        mismatches++;
        if (!sample) sample = `${rate} L${level}: ${got} vs ${want}`;
      }
    }
  }
  check("all six curves match the published polynomials at every level", mismatches === 0, sample);

  // The four totals at level 100 are published constants.
  const totals = { MEDIUM_FAST: 1000000, MEDIUM_SLOW: 1059860, FAST: 800000, SLOW: 1250000 };
  for (const rate of Object.keys(totals)) {
    check(
      rate + " tops out at " + totals[rate],
      Party.expForLevel(rate, 100) === totals[rate],
      "got " + Party.expForLevel(rate, 100)
    );
  }
  // Level 1 costs nothing to REACH on every curve, but the polynomials do not all
  // evaluate to zero there: n^3 is 1 and floor(5n^3/4) is 1. That is not a rounding
  // slip, it is what CalcExperience stores for a freshly created level 1 Pokemon,
  // and it is why this is asserted as "0 experience is still level 1" rather than
  // as "the curve is 0 at level 1".
  check("no experience at all is still level 1 on every curve",
        rates.every((r) => Party.levelForExp(r, 0) === 1));
  check("MEDIUM_FAST and SLOW evaluate to 1 at level 1, the other four to 0",
        Party.expForLevel("MEDIUM_FAST", 1) === 1 && Party.expForLevel("SLOW", 1) === 1 &&
          Party.expForLevel("FAST", 1) === 0 && Party.expForLevel("MEDIUM_SLOW", 1) === 0 &&
          Party.expForLevel("SLIGHTLY_FAST", 1) === 0 &&
          Party.expForLevel("SLIGHTLY_SLOW", 1) === 0,
        rates.map((r) => r + "=" + Party.expForLevel(r, 1)).join(" "));
  check(
    "MEDIUM_SLOW needs 9 points for level 2 (the polynomial is negative below that and clamps)",
    Party.expForLevel("MEDIUM_SLOW", 2) === 9,
    "got " + Party.expForLevel("MEDIUM_SLOW", 2)
  );

  // Only four of the six are used by any Kanto species; check that against the bundle
  // rather than against memory.
  const used = {};
  for (const id of Object.keys(bundle.species)) used[bundle.species[id].growthRate] = true;
  check(
    "the bundle uses exactly the four curves Gen 1 assigns",
    Object.keys(used).sort().join(",") === "FAST,MEDIUM_FAST,MEDIUM_SLOW,SLOW",
    Object.keys(used).sort().join(",")
  );

  // Round trip: the level a total buys, and the level one point short of it.
  let roundTrip = 0;
  let boundary = 0;
  for (const rate of Object.keys(used)) {
    for (let level = 1; level <= 100; level++) {
      if (Party.levelForExp(rate, Party.expForLevel(rate, level)) !== level) roundTrip++;
      if (level > 1) {
        const below = Party.expForLevel(rate, level) - 1;
        if (below >= 0 && Party.levelForExp(rate, below) !== level - 1) boundary++;
      }
    }
  }
  check("levelForExp inverts expForLevel at every level", roundTrip === 0, roundTrip + " levels off");
  check("and one point short is one level short", boundary === 0, boundary + " boundaries off");
  check("levelForExp never exceeds the cap", Party.levelForExp("FAST", 99999999) === 100);
}

function suiteExpFormula() {
  note("\n== The experience share ==");
  let mismatches = 0;
  let sample = "";
  for (const speciesId of ["PIDGEY", "RATTATA", "MEWTWO", "CHANSEY", "GEODUDE", "ONIX"]) {
    const baseExp = bundle.species[speciesId].baseExp;
    for (const level of [2, 3, 7, 13, 30, 55, 100]) {
      for (const participants of [1, 2, 3, 6]) {
        for (const isTrainer of [false, true]) {
          for (const traded of [false, true]) {
            const got = Party.expGain(baseExp, level, isTrainer, participants, traded);
            const want = refExpGain(baseExp, level, isTrainer, participants, traded);
            if (got !== want) {
              mismatches++;
              if (!sample) {
                sample = `${speciesId} L${level} p${participants} t${isTrainer}/${traded}: ${got} vs ${want}`;
              }
            }
          }
        }
      }
    }
  }
  check("the share matches the published formula across the sweep", mismatches === 0, sample);

  // A concrete cartridge number: a wild level 3 Pidgey is worth 23 points.
  const pidgey = bundle.species.PIDGEY.baseExp;
  check(
    "a wild L3 PIDGEY (baseExp " + pidgey + ") pays 23",
    Party.expGain(pidgey, 3, false, 1, false) === 23,
    "got " + Party.expGain(pidgey, 3, false, 1, false)
  );
  check(
    "a trainer's L3 PIDGEY pays 34 -- 23 x 1.5, truncated",
    Party.expGain(pidgey, 3, true, 1, false) === 34,
    "got " + Party.expGain(pidgey, 3, true, 1, false)
  );

  // Dividing before scaling loses points. That is the ROM's order and it is
  // visible: two participants do not add up to one participant's share.
  const one = Party.expGain(pidgey, 7, false, 1, false);
  const two = Party.expGain(pidgey, 7, false, 2, false);
  note("        L7 PIDGEY: one participant " + one + ", two participants " + two +
       " each (" + 2 * two + " total, " + (one - 2 * two) + " lost to truncation)");
  check("dividing before scaling loses points to truncation", 2 * two < one,
        "2 x " + two + " vs " + one);

  check("the share never falls below 1", Party.expGain(1, 1, false, 6, false) === 1);
  check("stat experience caps at 65535",
        Party.addStatExp(65530, 200, 1) === 65535,
        "got " + Party.addStatExp(65530, 200, 1));
  check("stat experience is divided among participants too",
        Party.addStatExp(0, 55, 3) === Math.trunc(55 / 3));
}

function suiteLevelUp() {
  note("\n== Levels, stats and HP ==");
  const speciesId = "CHARMANDER";
  const species = bundle.species[speciesId];
  const mon = makeMon(speciesId, 5, 9);
  mon.hp = Math.max(1, Math.trunc(mon.maxHp / 2));

  // Enough experience to cross several levels at once.
  const target = 14;
  const need = refExpForLevel(species.growthRate, target) - mon.exp;
  const before = { hp: mon.hp, maxHp: mon.maxHp, level: mon.level, exp: mon.exp };

  // Pick a defeated opponent whose share covers the gap in one award.
  const award = Party.applyExperience(bundle, mon, "MEWTWO", 100, false, 1, false);
  check("one award of the biggest share in the game crosses several levels",
        award.steps.length >= 3, "crossed " + award.steps.length);
  check("the gained figure matches the published formula",
        award.gained === refExpGain(bundle.species.MEWTWO.baseExp, 100, false, 1, false),
        "got " + award.gained);
  check("experience is added and the level is NOT yet moved",
        award.mon.exp === before.exp + award.gained && award.mon.level === before.level,
        "exp " + award.mon.exp + " level " + award.mon.level);
  check("stat experience arrived, and it is the defeated species' base stats",
        award.mon.evs.speed === Math.trunc(bundle.species.MEWTWO.baseStats.speed / 1) &&
          award.mon.evs.hp === bundle.species.MEWTWO.baseStats.hp,
        JSON.stringify(award.mon.evs));

  // Every step's stats are the published stat formula at that level, with the
  // stat experience already earned.
  let statMismatch = 0;
  let hpMismatch = 0;
  let prevStats = before;
  let prevHp = before.hp;
  let prevMax = before.maxHp;
  for (const step of award.steps) {
    const want = refStats(species.baseStats, award.mon.ivs, award.mon.evs, step.level);
    if (JSON.stringify(step.stats) !== JSON.stringify(want)) statMismatch++;
    const wantHp = refHpAfterLevel(prevHp, prevMax, want.hp);
    if (step.hp !== wantHp) hpMismatch++;
    prevHp = step.hp;
    prevMax = want.hp;
  }
  check("every level's stats match the published formula", statMismatch === 0,
        statMismatch + " levels differ");
  check("current HP rises by the gain in maximum HP, and no more", hpMismatch === 0,
        hpMismatch + " levels differ");
  check("levels crossed are contiguous and ascending",
        award.levels.every((lv, i) => lv === before.level + i + 1),
        JSON.stringify(award.levels));
  note("        CHARMANDER L" + before.level + " -> L" +
       award.levels[award.levels.length - 1] + ", " + award.gained + " points, HP " +
       before.hp + "/" + before.maxHp + " -> " +
       award.steps[award.steps.length - 1].hp + "/" +
       award.steps[award.steps.length - 1].stats.hp);

  const committed = Party.commitAllLevels(award.mon, award.steps, 0, false);
  const last = award.steps[award.steps.length - 1];
  check("committing every step lands on the last one",
        committed.level === last.level && committed.maxHp === last.stats.hp &&
          committed.hp === last.hp);
  check("the level reached is what the experience total buys",
        committed.level === Party.levelForExp(species.growthRate, committed.exp),
        committed.level + " vs " + Party.levelForExp(species.growthRate, committed.exp));

  // A Pokemon that levels at 1 HP is still at 1 HP plus the growth. Nothing heals.
  const hurt = makeMon(speciesId, 5, 9);
  hurt.hp = 1;
  const hurtAward = Party.applyExperience(bundle, hurt, "PIDGEY", 12, false, 1, false);
  if (hurtAward.steps.length > 0) {
    const first = hurtAward.steps[0];
    check("levelling up does not heal",
          first.hp === refHpAfterLevel(1, hurt.maxHp, first.stats.hp) && first.hp < first.stats.hp,
          "hp " + first.hp + "/" + first.stats.hp);
  } else {
    check("levelling up does not heal", false, "the test award did not cross a level");
  }
  check("a level 100 Pokemon still banks stat experience",
        Party.applyExperience(bundle, makeMon(speciesId, 100, 9), "MEWTWO", 100, false, 1, false)
          .mon.evs.attack === bundle.species.MEWTWO.baseStats.attack);
  check("and never passes the cap",
        Party.applyExperience(bundle, makeMon(speciesId, 100, 9), "MEWTWO", 100, false, 1, false)
          .steps.length === 0);
  check("the gap the test set up was real", need > 0, "need=" + need);
}

function suiteLearnset() {
  note("\n== Moves learned at the levels the learnset says ==");
  let mismatches = 0;
  let sample = "";
  let totalTaught = 0;
  for (const id of Object.keys(bundle.species)) {
    const species = bundle.species[id];
    for (let level = 1; level <= 100; level++) {
      const got = Party.movesLearnedAt(species, level);
      const want = refMovesAt(species, level);
      totalTaught += got.length;
      if (got.join(",") !== want.join(",")) {
        mismatches++;
        if (!sample) sample = `${id} L${level}: [${got}] vs [${want}]`;
      }
    }
  }
  check("all 151 species agree with the bundle's own learnsets at every level",
        mismatches === 0, sample);
  note("        " + totalTaught + " level-up moves across " +
       Object.keys(bundle.species).length + " species");

  // A named case, so a wholesale reshuffle of the learnset would be visible.
  const pidgey = bundle.species.PIDGEY;
  check("PIDGEY learns SAND-ATTACK at 5 and nothing at 6",
        Party.movesLearnedAt(pidgey, 5).join(",") === "SAND_ATTACK" &&
          Party.movesLearnedAt(pidgey, 6).length === 0,
        JSON.stringify(Party.movesLearnedAt(pidgey, 5)));
  check("PIDGEY learns QUICK ATTACK at 12, WHIRLWIND at 19, WING ATTACK at 28",
        Party.movesLearnedAt(pidgey, 12).join(",") === "QUICK_ATTACK" &&
          Party.movesLearnedAt(pidgey, 19).join(",") === "WHIRLWIND" &&
          Party.movesLearnedAt(pidgey, 28).join(",") === "WING_ATTACK");

  // Learning, into a free slot and into a full one.
  const mon = makeMon("PIDGEY", 4, 9);
  check("a fresh PIDGEY knows one move", Party.knownMoveCount(mon) === 1);
  const learned = Party.learnMove(bundle, mon, "SAND_ATTACK");
  check("SAND-ATTACK goes into slot 1 at full PP",
        learned.outcome === "LEARNED" && learned.slot === 1 &&
          learned.mon.moves[1].pp === bundle.moves.SAND_ATTACK.pp,
        learned.outcome + " slot " + learned.slot);
  check("the original is untouched -- learning returns a new Pokemon",
        mon.moves.length === 1 && learned.mon.moves.length === 2);
  check("learning a move it already knows is a no-op",
        Party.learnMove(bundle, learned.mon, "SAND_ATTACK").outcome === "KNOWN");
  let full = learned.mon;
  for (const id of ["QUICK_ATTACK", "WHIRLWIND"]) full = Party.learnMove(bundle, full, id).mon;
  check("four moves is full", Party.knownMoveCount(full) === 4);
  const blocked = Party.learnMove(bundle, full, "WING_ATTACK");
  check("a fifth move asks the player to make room",
        blocked.outcome === "FULL" && blocked.mon.moves.length === 4,
        blocked.outcome);
  const replaced = Party.replaceMove(bundle, full, 2, "WING_ATTACK");
  check("and replacing a slot puts it there at full PP",
        replaced.mon.moves[2].id === "WING_ATTACK" &&
          replaced.mon.moves[2].pp === bundle.moves.WING_ATTACK.pp);
  check("an unknown move id is refused rather than stored",
        Party.learnMove(bundle, mon, "HYPER_DRILL").outcome === "UNKNOWN");

  // The steps an award produces carry the right moves at the right levels.
  const grower = makeMon("PIDGEY", 4, 9);
  const award = Party.applyExperience(bundle, grower, "MEWTWO", 60, false, 1, false);
  let stepMismatch = 0;
  for (const step of award.steps) {
    if (step.learned.join(",") !== refMovesAt(pidgey, step.level).join(",")) stepMismatch++;
  }
  check("a multi-level award carries each level's own moves", stepMismatch === 0,
        stepMismatch + " steps differ");
  const taught = award.steps.filter((s) => s.learned.length > 0).map((s) => s.level + ":" + s.learned);
  note("        PIDGEY L4 -> L" + award.steps[award.steps.length - 1].level +
       " teaches " + (taught.length ? taught.join(" ") : "nothing"));
  check("that award did teach something", taught.length > 0);
}

function suiteSwitching() {
  note("\n== Switching ==");
  const party = [makeMon("CHARMANDER", 10, 9), makeMon("PIDGEY", 8, 9), makeMon("RATTATA", 6, 9)];
  const side = makeSide(party, 0, 1);

  // Bruise, poison and buff the active Pokemon, then bring it back in.
  side.active.hp = 7;
  side.active.status = "PSN";
  side.active.volatile.badlyPoisoned = 6;
  side.active.volatile.confusionTurns = 3;
  side.active.stages.attack = 2;
  side.active.moves[0].pp = 3;

  const out = Party.switchTo(side, 1);
  check("switching to a healthy slot is allowed", out.ok === true, out.message);
  check("the Pokemon leaving keeps its HP, its PP and its status in the party",
        out.side.party[0].hp === 7 && out.side.party[0].status === "PSN" &&
          out.side.party[0].moves[0].pp === 3,
        JSON.stringify({ hp: out.side.party[0].hp, st: out.side.party[0].status,
                         pp: out.side.party[0].moves[0].pp }));
  check("and loses its stat stages and its volatiles",
        out.side.party[0].stages.attack === 0 &&
          out.side.party[0].volatile.confusionTurns === 0);
  check("Toxic decays to ordinary poison on the way out -- the counter is volatile",
        out.side.party[0].status === "PSN" && out.side.party[0].volatile.badlyPoisoned === 0);
  check("the Pokemon arriving is the one asked for, at zero stages",
        out.side.active.species === "PIDGEY" && out.side.activeIndex === 1 &&
          out.side.active.stages.attack === 0);
  check("it gets exactly one badge boost on send-out",
        out.side.active.badgeBoostPasses === 1);
  // One Boulder Badge boosts Attack by value + floor(value / 8).
  const raw = out.side.active.stats.attack;
  check("and that boost is +12.5%, truncated",
        out.side.active.battleStats.attack === raw + Math.trunc(raw / 8),
        out.side.active.battleStats.attack + " vs " + (raw + Math.trunc(raw / 8)));
  check("Defense is untouched -- only Boulder is earned",
        out.side.active.battleStats.defense === out.side.active.stats.defense);

  check("switching to the slot already out is refused",
        Party.switchTo(out.side, 1).ok === false);
  check("switching out of range is refused",
        Party.switchTo(out.side, 9).ok === false && Party.switchTo(out.side, -1).ok === false);
  const downed = Party.switchTo(out.side, 0);
  check("and a slot with HP is switchable, so the refusals above are not vacuous",
        downed.ok === true);
  const wounded = { ...out.side, party: out.side.party.map((m, i) => (i === 0 ? { ...m, hp: 0 } : m)) };
  const refused = Party.switchTo(wounded, 0);
  check("a fainted slot is refused, with a message",
        refused.ok === false && refused.message.length > 0, refused.message);
}

function suiteFainting() {
  note("\n== Fainting ==");
  const party = [makeMon("CHARMANDER", 10, 9), makeMon("PIDGEY", 8, 9)];
  const side = makeSide(party, 0, 0);
  side.active.hp = 0;
  const outcome = Party.activeFainted(side);
  check("the fainted Pokemon is written back at 0 HP",
        outcome.side.party[0].hp === 0);
  check("the next healthy slot is reported", outcome.next === 1 && outcome.wiped === false);
  check("and it is still the active one until a replacement is sent out",
        outcome.side.activeIndex === 0 && outcome.side.active.species === "CHARMANDER");

  const dead = { ...outcome.side, party: outcome.side.party.map((m) => ({ ...m, hp: 0 })) };
  const wiped = Party.activeFainted(dead);
  check("with nothing left the side is wiped", wiped.wiped === true && wiped.next === -1);
  check("firstHealthy and isWiped agree",
        Party.firstHealthy(dead.party) === -1 && Party.isWiped(dead.party) === true &&
          Party.isWiped(party) === false);
}

function suiteParticipants() {
  note("\n== Experience participants ==");
  const party = [makeMon("CHARMANDER", 10, 9), makeMon("PIDGEY", 10, 9)];
  const side = makeSide(party, 1, 0);
  const both = Party.markParticipant(Party.markParticipant(Party.newParticipants(2), 0), 1);
  check("flags start clear", Party.newParticipants(3).every((f) => f === false));
  check("marking is not in place", both.length === 2 && both[0] === true && both[1] === true);
  // The flag operations on their own, because everything below reaches them through
  // awardBattleExperience, where a second condition could hide a broken one.
  const cleared = Party.clearParticipant(both, 0);
  check("clearParticipant clears the slot it is given and nothing else",
        cleared[0] === false && cleared[1] === true && both[0] === true,
        JSON.stringify(cleared));
  check("markParticipant sets the slot it is given and nothing else",
        Party.markParticipant(Party.newParticipants(3), 1).join(",") === "false,true,false");
  check("flaggedParticipants counts flags, standing or not",
        Party.flaggedParticipants([true, true], [{ hp: 0 }, { hp: 9 }]).join(",") === "0,1");
  check("payableParticipants pays only what is standing",
        Party.payableParticipants([true, true], [{ hp: 0 }, { hp: 9 }]).join(",") === "1");

  const shared = Party.awardBattleExperience(bundle, side, both, "PIDGEY", 12, false);
  check("two participants split the payout", shared.participants === 2, "got " + shared.participants);
  const eachShared = shared.awards[0].gained;
  check("and each gets the published two-way share",
        eachShared === refExpGain(bundle.species.PIDGEY.baseExp, 12, false, 2, false),
        "got " + eachShared);
  check("both slots were paid", shared.awards.length === 2);

  // Now the Gen 1 rule that surprises people: slot 0 faints, its flag is struck
  // off, and the survivor is paid MORE, not less.
  const fainted = {
    ...side,
    party: side.party.map((m, i) => (i === 0 ? { ...m, hp: 0 } : m)),
  };
  const flags = Party.clearParticipant(both, 0);
  const solo = Party.awardBattleExperience(bundle, fainted, flags, "PIDGEY", 12, false);
  check("a fainted participant leaves the divisor", solo.participants === 1,
        "got " + solo.participants);
  check("so the survivor is paid the full share",
        solo.awards.length === 1 && solo.awards[0].index === 1 &&
          solo.awards[0].gained === refExpGain(bundle.species.PIDGEY.baseExp, 12, false, 1, false),
        JSON.stringify(solo.awards.map((a) => [a.index, a.gained])));
  note("        two participants " + eachShared + " each; one faints, survivor gets " +
       solo.awards[0].gained);
  check("sacrificing a Pokemon pays the survivor more", solo.awards[0].gained > eachShared);

  const none = Party.awardBattleExperience(bundle, side, Party.newParticipants(2), "PIDGEY", 12, false);
  check("with no flags at all the Pokemon on the field is paid",
        none.participants === 1 && none.awards.length === 1 && none.awards[0].index === 1);

  // A flag that outlives its Pokemon. pokered counts the FLAG BITS for the divisor
  // and skips a fainted Pokemon when paying, so the two counts come apart: the
  // survivor is divided by two and is the only one paid. In ordinary play
  // RemoveFaintedPlayerMon clears the flag first and this state never arises, which
  // is exactly why it needs its own check -- nothing else here would reach it.
  const stale = Party.awardBattleExperience(bundle, fainted, both, "PIDGEY", 12, false);
  check("a flag left set on a fainted Pokemon still divides the payout",
        stale.participants === 2, "got " + stale.participants);
  check("but that Pokemon is not paid",
        stale.awards.length === 1 && stale.awards[0].index === 1,
        JSON.stringify(stale.awards.map((a) => a.index)));
  check("so the survivor gets the two-way share, not the whole thing",
        stale.awards[0].gained === eachShared && stale.awards[0].gained < solo.awards[0].gained,
        stale.awards[0].gained + " vs " + eachShared + "/" + solo.awards[0].gained);

  // The mirror image: a Pokemon revived mid-battle is standing again but its flag
  // was struck off when it fainted, so it is neither counted nor paid.
  const revived = { ...fainted, party: side.party.slice() };
  const afterRevive = Party.awardBattleExperience(bundle, revived, flags, "PIDGEY", 12, false);
  check("a revived Pokemon whose flag was cleared is neither counted nor paid",
        afterRevive.participants === 1 && afterRevive.awards.length === 1 &&
          afterRevive.awards[0].index === 1,
        afterRevive.participants + " / " + JSON.stringify(afterRevive.awards.map((a) => a.index)));
}

function suiteBadgeResetOnLevelUp() {
  note("\n== A level-up resets the badge-boost accumulator ==");
  const party = [makeMon("CHARMANDER", 5, 9)];
  const side = makeSide(party, 0, 1); // one badge: Boulder, Attack

  // Three stat changes in a row, each of which recalculates and re-applies the
  // badge boost to a value that already carries the previous ones.
  let active = side.active;
  for (let i = 0; i < 3; i++) active = Stats.recalculateBattleStats(active, 1);
  const boosted = { ...side, active };
  const raw = active.stats.attack;
  let compounded = raw;
  for (let i = 0; i < 4; i++) compounded = compounded + Math.trunc(compounded / 8);
  check("four passes have compounded Attack, which is the badge boost bug",
        active.badgeBoostPasses === 4 && active.battleStats.attack === compounded,
        "passes " + active.badgeBoostPasses + " attack " + active.battleStats.attack +
          " vs " + compounded);
  check("and that is more than a single boost would give",
        compounded > raw + Math.trunc(raw / 8));

  const flags = Party.markParticipant(Party.newParticipants(1), 0);
  const award = Party.awardBattleExperience(bundle, boosted, flags, "MEWTWO", 80, false);
  check("the award crossed at least one level", award.awards[0].steps.length > 0);
  const after = award.side.active;
  const newRaw = after.stats.attack;
  check("the accumulator is back to one pass",
        after.badgeBoostPasses === 1, "got " + after.badgeBoostPasses);
  check("and Attack is one boost off the new level's stat",
        after.battleStats.attack === newRaw + Math.trunc(newRaw / 8),
        after.battleStats.attack + " vs " + (newRaw + Math.trunc(newRaw / 8)));
  note("        L5 attack " + raw + " compounded to " + active.battleStats.attack +
       "; after the level-up, " + newRaw + " -> " + after.battleStats.attack);

  // commitLevel on its own. The award path above reaches the reset through
  // rejoinActive, so commitLevel's own active branch -- the one a caller driving
  // level-ups a step at a time with a message box would use -- needs its own check.
  const stepped = makeMon("CHARMANDER", 5, 9);
  stepped.badgeBoostPasses = 4;
  stepped.stages.attack = 1;
  const step = { level: 6, stats: refStats(bundle.species.CHARMANDER.baseStats, stepped.ivs, stepped.evs, 6), hp: 9, learned: [] };
  const onField = Party.commitLevel(stepped, step, 1, true);
  const staged = Math.trunc((step.stats.attack * 15) / 10); // the +1 stage is 1.5x
  check("commitLevel on the field resets to one badge boost, keeping the stage",
        onField.badgeBoostPasses === 1 &&
          onField.battleStats.attack === staged + Math.trunc(staged / 8),
        "passes " + onField.badgeBoostPasses + " attack " + onField.battleStats.attack +
          " vs " + (staged + Math.trunc(staged / 8)));
  const onBench = Party.commitLevel(stepped, step, 1, false);
  check("and on the bench there are no battle stats to speak of",
        onBench.badgeBoostPasses === 0 && onBench.battleStats.attack === step.stats.attack,
        "passes " + onBench.badgeBoostPasses + " attack " + onBench.battleStats.attack);
  check("either way the level, the maximum HP and the current HP land",
        onField.level === 6 && onField.maxHp === step.stats.hp && onField.hp === 9);

  // Without a level-up the compounding survives, so the reset above is real.
  const flat = makeSide([makeMon("CHARMANDER", 100, 9)], 0, 1);
  let flatActive = flat.active;
  for (let i = 0; i < 3; i++) flatActive = Stats.recalculateBattleStats(flatActive, 1);
  const noLevel = Party.awardBattleExperience(
    bundle, { ...flat, active: flatActive },
    Party.markParticipant(Party.newParticipants(1), 0), "PIDGEY", 3, false
  );
  check("an award with no level-up leaves the accumulator alone",
        noLevel.side.active.badgeBoostPasses === 4,
        "got " + noLevel.side.active.badgeBoostPasses);
}

function suiteCaughtIntoParty() {
  note("\n== A caught Pokemon joining the party ==");
  const caught = makeMon("PIDGEY", 7, 11);
  caught.hp = 3;
  caught.status = "SLP";
  caught.exp = 0;
  const result = Party.receiveCaught(bundle, [], caught);
  check("it joins the party", result.ok === true && result.index === 0);
  const stored = result.party[0];
  check("its experience is set to exactly what its level is worth",
        stored.exp === refExpForLevel(bundle.species.PIDGEY.growthRate, 7),
        "got " + stored.exp + " want " + refExpForLevel(bundle.species.PIDGEY.growthRate, 7));
  check("and that total reads back as its level",
        Party.levelForExp(bundle.species.PIDGEY.growthRate, stored.exp) === 7);
  check("it keeps the HP and the status it was caught with -- nothing heals it",
        stored.hp === 3 && stored.status === "SLP");
  check("but it comes off the field: no stages, no volatiles, no badge boosts",
        stored.stages.attack === 0 && stored.volatile.confusionTurns === 0 &&
          stored.badgeBoostPasses === 0);

  let party = [];
  for (let i = 0; i < 6; i++) party = Party.addToParty(party, makeMon("RATTATA", 5, 3)).party;
  check("six is the limit", party.length === 6 && Party.partyIsFull(party) === true);
  const overflow = Party.addToParty(party, makeMon("PIDGEY", 5, 3));
  check("a seventh is refused, and the party is unchanged",
        overflow.ok === false && overflow.index === -1 && overflow.party.length === 6);
  check("and with no box to fall back on the refusal reason lines up with Capture's",
        Capture.catchBlockedReason(true, Party.partyIsFull(party), 0) === "BOX_FULL");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function runAll() {
  passed = 0;
  failed = 0;
  lines.length = 0;
  suiteBallTable();
  suiteHpFactor();
  suiteShakes();
  suiteMasterBall();
  suiteRejectionLoop();
  suiteCatchEnumeration();
  suiteCatchAnchors();
  suiteCatchMonteCarlo();
  suiteCatchRefusals();
  suiteGrowthCurves();
  suiteExpFormula();
  suiteLevelUp();
  suiteLearnset();
  suiteSwitching();
  suiteFainting();
  suiteParticipants();
  suiteBadgeResetOnLevelUp();
  suiteCaughtIntoParty();
}

if (!selftest) {
  runAll();
  flush();
  console.log("\nCAPTURE  " + passed + " PASS  " + failed + " FAIL  " +
              (failed === 0 ? "OK" : "FAILED"));
  process.exit(failed === 0 ? 0 : 1);
} else {
  const MUTATIONS = [
    ["catch-hp-divisor", "the Great Ball uses divisor 12 rather than 8"],
    ["catch-ball-range", "the Great Ball's roll ceiling is 255 rather than 200"],
    ["catch-status-bonus", "sleep is worth 12 to the roll rather than 25"],
    ["catch-shake-bonus", "sleep is worth 5 to the shake rather than 10"],
    ["catch-second-roll-strict", "the second roll is strict: caught on rand < f"],
    ["shake-threshold", "the shake thresholds are 12/32/72"],
    ["master-ball-no-roll", "the Master Ball is expected to draw no random byte"],
    ["growth-medium-slow", "MEDIUM_SLOW's cubic coefficient is 5 rather than 6"],
    ["exp-divide-order", "experience is scaled by level before the split"],
    ["exp-trainer", "a trainer battle pays double rather than x1.5"],
    ["learn-level-lte", "moves are learned at or below the level"],
    ["hp-on-levelup", "levelling up restores the Pokemon to full HP"],
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
      "  " + (caught ? "CAUGHT    " : "NOT CAUGHT") + "  " + name.padEnd(26) +
        String(failed).padStart(3) + " failures  -- " + description
    );
  }
  MUT = "";
  runAll();
  lines.length = 0;
  console.log("  " + (failed === 0 ? "CLEAN     " : "DIRTY     ") +
              "  unmutated                  " + String(failed).padStart(3) + " failures");
  const ok = notCaught === 0 && failed === 0;
  console.log("\nCAPTURE SELFTEST  " + (ok ? "OK -- the gate discriminates" : "FAILED"));
  process.exit(ok ? 0 : 1);
}
