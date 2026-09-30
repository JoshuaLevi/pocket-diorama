// Generation 1 status conditions, run against the real bundle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battle-status.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Same two disciplines as test/battle.test.mjs:
//
//   1. Nothing here checks the shipping code against itself. Every rule is
//      transcribed a second time in the REFERENCE section, from the published
//      Generation 1 behaviour and the cartridge's own routine names, and the
//      checks compare the two. Where a rule is a threshold the reference holds
//      the number, so moving the number breaks the check.
//   2. It proves it can fail. `--selftest` perturbs the reference one fault at a
//      time and reports whether the comparison noticed. A mutation that is not
//      caught is this file's bug, not the engine's.
//
// Rates are printed as observed vs expected. A rate that merely "looks fine" is
// not a check, so each one names the tolerance it is inside.

import { readFileSync } from "node:fs";

globalThis.print = (...args) => console.log("[lens]", ...args);

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: battle-status.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const Status = await import("../Assets/Scripts/play/battle/Status.ts");
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

/** xorshift32: deterministic, and uniform enough for a few hundred thousand bytes. */
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

/** A source that hands out exactly these bytes, cycling. randomByte() sees them. */
function bytes(list) {
  let i = 0;
  return () => {
    const b = list[i % list.length];
    i++;
    return b / 256;
  };
}

/**
 * The byte that makes Damage.damageRoll return `roll`. The ROM rotates its random
 * byte LEFT once before testing it against 217, so the fixture has to rotate
 * right to ask for a particular roll. Feeding `roll` itself yields roll/2 rotated,
 * which is how the first draft of this file was one damage point out.
 */
function byteForRoll(roll) {
  return ((roll >> 1) | ((roll & 1) << 7)) & 0xff;
}

const pct = (x) => (x * 100).toFixed(4) + "%";

// ---------------------------------------------------------------------------
// REFERENCE -- the Generation 1 rules, transcribed independently
// ---------------------------------------------------------------------------

/** SleepEffect: rand & 7, redrawn while zero. */
const refSleepMin = () => (mut("sleep-range") ? 0 : 1);
const refSleepMax = () => 7;

/** ConfusionSideEffectSuccess: (rand & 3) + 2. */
const refConfusionMin = () => (mut("confusion-turns") ? 1 : 2);
const refConfusionMax = () => (mut("confusion-turns") ? 4 : 5);

/** cp $3F / jr nc -- fully paralyzed below the byte. */
const refParalysisByte = () => (mut("para-rate") ? 32 : 63);

/** cp $80 / jr c -- the self-hit is the branch not taken, so at or above. */
const refSelfHitByte = () => (mut("confusion-rate") ? 64 : 128);

/** HandlePoisonBurnLeechSeed: max(1, maxHP/16), scaled by the toxic counter. */
function refResidual(maxHp, toxicCounter) {
  const divisor = mut("chip-divisor") ? 8 : 16;
  let base = Math.floor(maxHp / divisor);
  if (base < 1) base = 1;
  if (toxicCounter > 0 && !mut("toxic-flat")) return base * toxicCounter;
  return base;
}

/** How many turns a sleep of N costs: the counter is decremented then tested. */
function refSleepTurnsLost(n) {
  return mut("sleep-turns") ? n - 1 : n;
}

/** Generation 1 has no thaw timer. 0 means "never"; the mutation invents one. */
const refThawTurn = () => (mut("freeze-thaws") ? 5 : 0);

/** HalveAttackDueToBurn / QuarterSpeedDueToParalysis, both floored at 1. */
function refBurnAttack(attack) {
  const d = mut("burn-divisor") ? 3 : 2;
  const v = Math.floor(attack / d);
  return v < 1 ? 1 : v;
}
function refParalysisSpeed(speed) {
  const d = mut("para-speed-divisor") ? 2 : 4;
  const v = Math.floor(speed / d);
  return v < 1 ? 1 : v;
}

/** CheckDefrost is only reachable from FreezeBurnParalyzeEffect. */
const REF_DEFROST_EFFECTS = [
  "BURN_SIDE_EFFECT1",
  "BURN_SIDE_EFFECT2",
  "FREEZE_SIDE_EFFECT1",
  "PARALYZE_SIDE_EFFECT1",
  "PARALYZE_SIDE_EFFECT2",
];
function refCanDefrost(move) {
  if (move.type !== "FIRE") return false;
  if (mut("defrost-any-fire")) return true;
  return REF_DEFROST_EFFECTS.indexOf(move.effect) >= 0;
}

/** One status byte at a time: a second never lands. */
function refSecondStatusLands() {
  return mut("coexist");
}

/** SleepEffect's recharge branch skips every check, including "already statused". */
function refSleepOnRechargingLands() {
  return !mut("recharge-bypass");
}

/**
 * .cureStatusAilment and trainer_ai.asm's AICureStatus both run
 * `res BADLY_POISONED`, so an Antidote or a Full Heal ends the escalation even
 * though the raw counter byte survives unread.
 */
const refCureClearsToxic = () => !mut("cure-keeps-toxic");

/** HandleSelfConfusionDamage: 40 power, typeless, the user on both ends. */
const refSelfHitPower = () => (mut("selfhit-power") ? 60 : 40);

/**
 * The base damage the ROM computes, written out separately from Damage.baseDamage:
 * ((2L/5 + 2) * P * A / D) / 50 + 2, every division truncating.
 */
function refBaseDamage(level, power, attack, defense) {
  let a = attack;
  let d = defense;
  if (a > 255 || d > 255) {
    a = Math.floor(a / 4) & 0xff;
    d = Math.floor(d / 4) & 0xff;
    if (a < 1) a = 1;
    if (d < 1) d = 1;
  }
  const lead = Math.floor((2 * level) / 5) + 2;
  let v = Math.floor(Math.floor(lead * power * a) / d);
  v = Math.floor(v / 50);
  if (v > 997) v = 997;
  return v + 2;
}

/** The confusion self-hit, with the type chart applied only under the mutation. */
function refSelfHit(bundleRef, mon, opponentReflect, roll) {
  let defense = mon.battleStats.defense;
  if (opponentReflect) defense = defense * 2;
  let dmg = refBaseDamage(mon.level, refSelfHitPower(), mon.battleStats.attack, defense);
  if (mut("selfhit-typed")) {
    const chart = new Damage.TypeChart(bundleRef);
    dmg = Math.floor(dmg * chart.effectiveness("NORMAL", mon.types));
  }
  if (dmg >= 2) dmg = Math.floor((dmg * roll) / 255);
  return dmg;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixedRandom = () => 0.5;

function wild(speciesId, level) {
  return Stats.makeWildMon(bundle, speciesId, level, fixedRandom);
}

function withStatus(mon, status) {
  const opts = Status.defaultInflictOptions();
  return Status.inflictStatus(bundle, mon, status, opts, fixedRandom).mon;
}

function optionsWith(overrides) {
  const o = Status.defaultInflictOptions();
  const keys = Object.keys(overrides);
  for (const k of keys) o[k] = overrides[k];
  return o;
}

const SPECIES_IDS = Object.keys(bundle.species);

// ---------------------------------------------------------------------------
// The rolls
// ---------------------------------------------------------------------------

function suiteRolls() {
  note("\n== The rolls, against the ROM's own bytes ==");

  const rng = seeded(0x5eed1);
  const sleepCounts = new Array(9).fill(0);
  const N = 200000;
  for (let i = 0; i < N; i++) sleepCounts[Status.rollSleepTurns(rng)]++;
  let sMin = 99;
  let sMax = -1;
  for (let v = 0; v <= 8; v++) {
    if (sleepCounts[v] > 0) {
      if (v < sMin) sMin = v;
      if (v > sMax) sMax = v;
    }
  }
  note("     sleep counter observed range " + sMin + ".." + sMax +
       ", expected " + refSleepMin() + ".." + refSleepMax());
  check("sleep counter never leaves its range", sMin === refSleepMin() && sMax === refSleepMax(),
        "saw " + sMin + ".." + sMax);
  let worstSleep = 0;
  for (let v = 1; v <= 7; v++) {
    worstSleep = Math.max(worstSleep, Math.abs(sleepCounts[v] / N - 1 / 7));
  }
  note("     sleep counter worst deviation from 1/7: " + pct(worstSleep) + " (tolerance 0.5%)");
  check("sleep counter is uniform over its range", worstSleep < 0.005, pct(worstSleep));

  const cRng = seeded(0xc0ffee);
  const confCounts = new Array(8).fill(0);
  for (let i = 0; i < N; i++) confCounts[Status.rollConfusionTurns(cRng)]++;
  let cMin = 99;
  let cMax = -1;
  for (let v = 0; v <= 7; v++) {
    if (confCounts[v] > 0) {
      if (v < cMin) cMin = v;
      if (v > cMax) cMax = v;
    }
  }
  note("     confusion counter observed range " + cMin + ".." + cMax +
       ", expected " + refConfusionMin() + ".." + refConfusionMax());
  check("confusion counter is 2..5",
        cMin === refConfusionMin() && cMax === refConfusionMax(), "saw " + cMin + ".." + cMax);

  const pRng = seeded(0xbeef);
  let paralyzed = 0;
  for (let i = 0; i < N; i++) if (Status.rollFullyParalyzed(pRng)) paralyzed++;
  const pObs = paralyzed / N;
  const pExp = refParalysisByte() / 256;
  note("     full paralysis observed " + pct(pObs) + ", expected " + pct(pExp) +
       " (" + refParalysisByte() + "/256)");
  check("full paralysis lands at the ROM's rate", Math.abs(pObs - pExp) < 0.004,
        pct(pObs) + " vs " + pct(pExp));

  const hRng = seeded(0xfeed);
  let selfHits = 0;
  for (let i = 0; i < N; i++) if (Status.rollConfusionSelfHit(hRng)) selfHits++;
  const hObs = selfHits / N;
  const hExp = (256 - refSelfHitByte()) / 256;
  note("     confusion self-hit observed " + pct(hObs) + ", expected " + pct(hExp) +
       " (bytes >= " + refSelfHitByte() + ")");
  check("confusion self-hit lands at the ROM's rate", Math.abs(hObs - hExp) < 0.004,
        pct(hObs) + " vs " + pct(hExp));

  // Which HALF of the byte range triggers each roll, not just how often. A
  // threshold flipped to the other side keeps the rate and fails these.
  const belowPara = Status.rollFullyParalyzed(bytes([refParalysisByte() - 1]));
  const abovePara = Status.rollFullyParalyzed(bytes([refParalysisByte()]));
  check("paralysis triggers below its byte and not at it", belowPara && !abovePara,
        "below=" + belowPara + " at=" + abovePara);
  const belowHit = Status.rollConfusionSelfHit(bytes([refSelfHitByte() - 1]));
  const atHit = Status.rollConfusionSelfHit(bytes([refSelfHitByte()]));
  check("the self-hit is the high half of the byte range", !belowHit && atHit,
        "below=" + belowHit + " at=" + atHit);
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

function suiteSleep() {
  note("\n== Sleep ==");

  for (let n = 1; n <= 7; n++) {
    let mon = wild("PIDGEY", 10);
    mon.status = Types.STATUS_SLEEP;
    mon.sleepTurns = n;
    let lost = 0;
    for (let turn = 0; turn < 12; turn++) {
      const r = Status.sleepFreezeCheck(bundle, mon);
      mon = r.mon;
      if (r.canMove) break;
      lost++;
    }
    check("a sleep of " + n + " costs " + refSleepTurnsLost(n) + " turns",
          lost === refSleepTurnsLost(n), "lost " + lost);
  }

  let waking = wild("PIDGEY", 10);
  waking.status = Types.STATUS_SLEEP;
  waking.sleepTurns = 1;
  const wake = Status.sleepFreezeCheck(bundle, waking);
  check("waking up still costs the turn", wake.canMove === false, "canMove=" + wake.canMove);
  check("waking up clears the status", wake.mon.status === Types.STATUS_NONE, wake.mon.status);
  check("waking up prints the ROM's WokeUp line",
        wake.messages[0] === bundle.text["_WokeUpText"].split("{USER}").join("PIDGEY"),
        JSON.stringify(wake.messages[0]));

  const rested = Status.restSleep(bundle, wild("PIDGEY", 10), 0);
  check("Rest sleeps for exactly " + Status.REST_SLEEP_TURNS,
        rested.mon.sleepTurns === Status.REST_SLEEP_TURNS, "" + rested.mon.sleepTurns);
  const burnedThenRested = Status.restSleep(bundle, withStatus(wild("PIDGEY", 10), Types.STATUS_BURN), 0);
  check("Rest overwrites an existing status", burnedThenRested.mon.status === Types.STATUS_SLEEP,
        burnedThenRested.mon.status);

  // Re-applying: already asleep is announced and the counter is NOT re-rolled.
  const asleep = withStatus(wild("PIDGEY", 10), Types.STATUS_SLEEP);
  const before = asleep.sleepTurns;
  const again = Status.inflictStatus(bundle, asleep, Types.STATUS_SLEEP,
                                     Status.defaultInflictOptions(), seeded(7));
  check("sleep on a sleeping Pokemon is refused",
        again.applied === false && again.reason === Status.IMMUNE_ALREADY_ASLEEP, again.reason);
  check("a refused sleep does not re-roll the counter", again.mon.sleepTurns === before,
        before + " -> " + again.mon.sleepTurns);
  check("a refused sleep prints AlreadyAsleep",
        again.messages[0] === bundle.text["_AlreadyAsleepText"].split("{TARGET}").join("PIDGEY"),
        JSON.stringify(again.messages[0]));

  const burned = withStatus(wild("PIDGEY", 10), Types.STATUS_BURN);
  const onBurned = Status.inflictStatus(bundle, burned, Types.STATUS_SLEEP,
                                        Status.defaultInflictOptions(), fixedRandom);
  check("sleep on an otherwise statused Pokemon is refused",
        onBurned.applied === refSecondStatusLands(), "applied=" + onBurned.applied);
  check("a refused sleep on a statused Pokemon prints DidntAffect",
        refSecondStatusLands() ? true
          : onBurned.messages[0] === bundle.text["_DidntAffectText"].split("{TARGET}").join("PIDGEY"),
        JSON.stringify(onBurned.messages[0]));

  // GEN1 BUG: recharging skips every check, existing status included.
  const recharging = withStatus(wild("PIDGEY", 10), Types.STATUS_BURN);
  recharging.volatile.recharging = true;
  const bypass = Status.inflictStatus(bundle, recharging, Types.STATUS_SLEEP,
                                      optionsWith({ targetRecharging: true }), fixedRandom);
  check("sleep lands on a recharging Pokemon that is already burned",
        bypass.applied === refSleepOnRechargingLands(), "applied=" + bypass.applied);
  check("the recharge bypass replaces the burn with sleep",
        refSleepOnRechargingLands() ? bypass.mon.status === Types.STATUS_SLEEP : true,
        bypass.mon.status);
  check("SleepEffect clears the recharge bit on its way past",
        refSleepOnRechargingLands() ? bypass.mon.volatile.recharging === false : true,
        "recharging=" + bypass.mon.volatile.recharging);
}

// ---------------------------------------------------------------------------
// Freeze
// ---------------------------------------------------------------------------

function suiteFreeze() {
  note("\n== Freeze ==");

  let frozen = withStatus(wild("PIDGEY", 10), Types.STATUS_FREEZE);
  let thawedOn = 0;
  for (let turn = 1; turn <= 500; turn++) {
    const r = Status.sleepFreezeCheck(bundle, frozen);
    frozen = r.mon;
    if (r.canMove) {
      thawedOn = turn;
      break;
    }
  }
  note("     500 frozen turns, thawed on turn " + thawedOn + " (0 = never), expected " +
       refThawTurn());
  check("freeze never wears off on its own", thawedOn === refThawTurn(), "thawed on " + thawedOn);
  check("a frozen Pokemon keeps its status", frozen.status === Types.STATUS_FREEZE, frozen.status);

  // The defrost set, taken from every move in the bundle rather than a list.
  const moveIds = Object.keys(bundle.moves);
  let disagreements = 0;
  const engineDefrost = [];
  for (const id of moveIds) {
    const move = bundle.moves[id];
    const engine = Status.canDefrost(move);
    if (engine) engineDefrost.push(id);
    if (engine !== refCanDefrost(move)) disagreements++;
  }
  note("     moves that thaw, per the engine: " + engineDefrost.sort().join(" "));
  check("the defrost set matches the reference over all " + moveIds.length + " moves",
        disagreements === 0, disagreements + " disagreements");

  const fireSpin = bundle.moves["FIRE_SPIN"];
  check("Fire Spin is Fire and still does not thaw",
        fireSpin.type === "FIRE" && Status.canDefrost(fireSpin) === (mut("defrost-any-fire") ? true : false),
        "canDefrost=" + Status.canDefrost(fireSpin));
  const thawed = Status.fireDefrost(bundle, frozen, bundle.moves["FLAMETHROWER"]);
  check("Flamethrower thaws a frozen Pokemon",
        thawed.applied === true && thawed.mon.status === Types.STATUS_NONE, thawed.mon.status);
  const notThawed = Status.fireDefrost(bundle, frozen, bundle.moves["FIRE_SPIN"]);
  check("Fire Spin leaves it frozen", notThawed.mon.status === Types.STATUS_FREEZE,
        notThawed.mon.status);

  const lapras = wild("LAPRAS", 20);
  const iceOnIce = Status.inflictStatus(bundle, lapras, Types.STATUS_FREEZE,
                                        optionsWith({ secondary: true, moveType: "ICE" }), fixedRandom);
  check("an Ice type cannot be frozen", iceOnIce.applied === false, iceOnIce.reason);
}

// ---------------------------------------------------------------------------
// Poison, and the toxic counter
// ---------------------------------------------------------------------------

function suitePoison() {
  note("\n== Poison and the toxic counter ==");

  const samples = [["PIDGEY", 3], ["SNORLAX", 50], ["MAGIKARP", 2], ["CHANSEY", 100]];
  for (const [id, level] of samples) {
    if (!bundle.species[id]) continue;
    const mon = withStatus(wild(id, level), Types.STATUS_POISON);
    const tick = Status.residualDamage(bundle, mon);
    const expected = refResidual(mon.maxHp, 0);
    check("poison on " + id + " Lv" + level + " (maxHP " + mon.maxHp + ") costs " + expected,
          tick.damage === expected, "got " + tick.damage);
  }

  const tiny = wild("MAGIKARP", 2);
  check("a Pokemon under 16 max HP still takes 1 (maxHP " + tiny.maxHp + ")",
        tiny.maxHp < 16 && Status.residualBaseDamage(tiny) === refResidual(tiny.maxHp, 0),
        "maxHp=" + tiny.maxHp + " base=" + Status.residualBaseDamage(tiny));

  // Toxic: the counter starts at 1, multiplies, and advances every tick.
  let toxic = Status.inflictStatus(bundle, wild("CHANSEY", 100), Types.STATUS_POISON,
                                   optionsWith({ toxic: true }), fixedRandom).mon;
  check("Toxic sets ordinary poison plus a counter",
        toxic.status === Types.STATUS_POISON && toxic.volatile.badlyPoisoned === 1,
        toxic.status + "/" + toxic.volatile.badlyPoisoned);
  const observedSeq = [];
  const expectedSeq = [];
  for (let n = 1; n <= 5; n++) {
    expectedSeq.push(refResidual(toxic.maxHp, n));
    const tick = Status.residualDamage(bundle, toxic);
    observedSeq.push(tick.damage);
    toxic = tick.mon;
  }
  note("     toxic ticks observed " + observedSeq.join(",") + "  expected " + expectedSeq.join(","));
  check("the toxic counter multiplies and advances",
        observedSeq.join(",") === expectedSeq.join(","), observedSeq.join(","));

  const badly = Status.inflictStatus(bundle, wild("PIDGEY", 20), Types.STATUS_POISON,
                                     optionsWith({ toxic: true }), fixedRandom).mon;
  check("switching out downgrades Toxic to ordinary poison",
        Status.clearBadlyPoisoned(badly).volatile.badlyPoisoned === 0 &&
          Status.clearBadlyPoisoned(badly).status === Types.STATUS_POISON,
        "counter=" + Status.clearBadlyPoisoned(badly).volatile.badlyPoisoned);
  check("Stats.sendOut also clears the counter, because it clears the whole volatile block",
        Stats.sendOut(badly, 0).volatile.badlyPoisoned === 0,
        "" + Stats.sendOut(badly, 0).volatile.badlyPoisoned);
  const curedOfToxic = Status.cureStatus(badly, 0);
  check("a status cure ends the escalation (res BADLY_POISONED)",
        (curedOfToxic.volatile.badlyPoisoned === 0) === refCureClearsToxic(),
        "counter=" + curedOfToxic.volatile.badlyPoisoned);
  const rePoisoned = Status.inflictStatus(bundle, curedOfToxic, Types.STATUS_POISON,
                                          Status.defaultInflictOptions(), fixedRandom).mon;
  const flatAgain = Status.residualDamage(bundle, rePoisoned).damage;
  check("cured and poisoned again, the tick is flat rather than scaled",
        (flatAgain === refResidual(rePoisoned.maxHp, 0)) === refCureClearsToxic(),
        "got " + flatAgain + ", flat is " + refResidual(rePoisoned.maxHp, 0));

  // The 1..15 clamp in types.ts is unobservable: nothing survives to counter 7.
  let worstTicks = 0;
  let worstSpecies = "";
  for (const id of SPECIES_IDS) {
    for (const level of [2, 5, 50, 100]) {
      const mon = wild(id, level);
      const base = refResidual(mon.maxHp, 1);
      let hp = mon.maxHp;
      let n = 1;
      while (hp > 0 && n < 40) {
        hp -= base * n;
        n++;
      }
      if (n - 1 > worstTicks) {
        worstTicks = n - 1;
        worstSpecies = id + " Lv" + level;
      }
    }
  }
  note("     worst case over " + SPECIES_IDS.length + " species x 4 levels: " + worstSpecies +
       " survives " + worstTicks + " toxic ticks; the clamp is at " + Status.MAX_TOXIC_COUNTER);
  check("no Pokemon lives long enough to reach the toxic clamp",
        worstTicks < Status.MAX_TOXIC_COUNTER, "worst " + worstTicks);

  const nidoking = wild("NIDOKING", 30);
  const onPoison = Status.inflictStatus(bundle, nidoking, Types.STATUS_POISON,
                                        Status.defaultInflictOptions(), fixedRandom);
  check("a Poison type cannot be poisoned", onPoison.applied === false, onPoison.reason);
  const toxicOnPoison = Status.inflictStatus(bundle, nidoking, Types.STATUS_POISON,
                                             optionsWith({ toxic: true }), fixedRandom);
  check("Toxic cannot badly poison a Poison type either", toxicOnPoison.applied === false,
        toxicOnPoison.reason);

  const subbed = wild("PIDGEY", 20);
  subbed.volatile.substituteHp = 12;
  const throughSub = Status.inflictStatus(bundle, subbed, Types.STATUS_POISON,
                                          optionsWith({ targetHasSubstitute: true }), fixedRandom);
  check("a substitute blocks poison", throughSub.applied === false, throughSub.reason);
  const twaveThroughSub = Status.inflictStatus(bundle, subbed, Types.STATUS_PARALYSIS,
                                               optionsWith({ targetHasSubstitute: true,
                                                             moveType: "ELECTRIC" }), fixedRandom);
  check("a substitute does NOT block Thunder Wave", twaveThroughSub.applied === true,
        twaveThroughSub.reason);
  const sleepThroughSub = Status.inflictStatus(bundle, subbed, Types.STATUS_SLEEP,
                                               optionsWith({ targetHasSubstitute: true }), fixedRandom);
  check("a substitute does NOT block a primary sleep move", sleepThroughSub.applied === true,
        sleepThroughSub.reason);
  const secondaryThroughSub = Status.inflictStatus(bundle, subbed, Types.STATUS_PARALYSIS,
                                                   optionsWith({ targetHasSubstitute: true,
                                                                 secondary: true,
                                                                 moveType: "ELECTRIC" }), fixedRandom);
  check("a substitute blocks every secondary status", secondaryThroughSub.applied === false,
        secondaryThroughSub.reason);
}

// ---------------------------------------------------------------------------
// Burn
// ---------------------------------------------------------------------------

function suiteBurn() {
  note("\n== Burn ==");

  const clean = Stats.sendOut(wild("TAUROS", 50), 0);
  const attackBefore = clean.battleStats.attack;
  const burned = Status.inflictStatus(bundle, clean, Types.STATUS_BURN,
                                      Status.defaultInflictOptions(), fixedRandom).mon;
  note("     TAUROS Lv50 attack " + attackBefore + " -> " + burned.battleStats.attack +
       ", expected " + refBurnAttack(attackBefore));
  check("burn halves Attack", burned.battleStats.attack === refBurnAttack(attackBefore),
        "" + burned.battleStats.attack);
  check("burn does not touch the other three stats",
        burned.battleStats.defense === clean.battleStats.defense &&
          burned.battleStats.speed === clean.battleStats.speed &&
          burned.battleStats.special === clean.battleStats.special);

  // The badge boost bug must not tick on this path: the ROM halves the live stat
  // and never re-runs ApplyBadgeStatBoosts there.
  const oneBadge = Stats.sendOut(wild("TAUROS", 50), 1);
  const burnedWithBadge = Status.inflictStatus(bundle, oneBadge, Types.STATUS_BURN,
                                               optionsWith({ badgeBits: 1 }), fixedRandom).mon;
  check("burning does not spend another badge boost pass",
        burnedWithBadge.badgeBoostPasses === oneBadge.badgeBoostPasses,
        oneBadge.badgeBoostPasses + " -> " + burnedWithBadge.badgeBoostPasses);
  check("burn halves the badge-boosted Attack",
        burnedWithBadge.battleStats.attack === refBurnAttack(oneBadge.battleStats.attack),
        oneBadge.battleStats.attack + " -> " + burnedWithBadge.battleStats.attack);

  const cured = Status.cureStatus(burned, 0);
  check("curing the burn restores Attack", cured.battleStats.attack === attackBefore,
        "" + cured.battleStats.attack);

  const chipMon = withStatus(wild("SNORLAX", 50), Types.STATUS_BURN);
  const chip = Status.residualDamage(bundle, chipMon);
  check("burn chips for the same max(1, maxHP/16) as poison",
        chip.damage === refResidual(chipMon.maxHp, 0), "" + chip.damage);
  check("the burn tick prints the burn line, not the poison one",
        chip.messages[0] === bundle.text["_HurtByBurnText"].split("{USER}").join("SNORLAX"),
        JSON.stringify(chip.messages[0]));

  const charmander = wild("CHARMANDER", 20);
  const emberOnFire = Status.inflictStatus(bundle, charmander, Types.STATUS_BURN,
                                           optionsWith({ secondary: true, moveType: "FIRE" }),
                                           fixedRandom);
  check("Ember cannot burn a Fire type", emberOnFire.applied === false, emberOnFire.reason);
}

// ---------------------------------------------------------------------------
// Paralysis
// ---------------------------------------------------------------------------

function suiteParalysis() {
  note("\n== Paralysis ==");

  const clean = Stats.sendOut(wild("JOLTEON", 50), 0);
  const speedBefore = clean.battleStats.speed;
  const para = Status.inflictStatus(bundle, clean, Types.STATUS_PARALYSIS,
                                    optionsWith({ moveType: "GRASS" }), fixedRandom).mon;
  note("     JOLTEON Lv50 speed " + speedBefore + " -> " + para.battleStats.speed +
       ", expected " + refParalysisSpeed(speedBefore));
  check("paralysis quarters Speed", para.battleStats.speed === refParalysisSpeed(speedBefore),
        "" + para.battleStats.speed);
  check("paralysis does not touch Attack", para.battleStats.attack === clean.battleStats.attack);

  const sandshrew = wild("SANDSHREW", 20);
  const twave = Status.inflictStatus(bundle, sandshrew, Types.STATUS_PARALYSIS,
                                     optionsWith({ moveType: "ELECTRIC" }), fixedRandom);
  check("Thunder Wave cannot paralyze a Ground type", twave.applied === false, twave.reason);
  const stunSpore = Status.inflictStatus(bundle, sandshrew, Types.STATUS_PARALYSIS,
                                         optionsWith({ moveType: "GRASS" }), fixedRandom);
  check("Stun Spore can paralyze a Ground type", stunSpore.applied === true, stunSpore.reason);

  const snorlax = wild("SNORLAX", 30);
  const bodySlam = Status.inflictStatus(bundle, snorlax, Types.STATUS_PARALYSIS,
                                        optionsWith({ secondary: true, moveType: "NORMAL" }),
                                        fixedRandom);
  check("Body Slam cannot paralyze a Normal type", bodySlam.applied === false, bodySlam.reason);
  const geodude = wild("GEODUDE", 30);
  const bodySlamRock = Status.inflictStatus(bundle, geodude, Types.STATUS_PARALYSIS,
                                            optionsWith({ secondary: true, moveType: "NORMAL" }),
                                            fixedRandom);
  check("Body Slam can paralyze a Rock/Ground type", bodySlamRock.applied === true,
        bodySlamRock.reason);

  // Losing the turn to full paralysis cancels the multi-turn moves but leaves
  // invulnerability alone -- the Fly/Dig glitch.
  let dug = withStatus(wild("SANDSHREW", 30), Types.STATUS_PARALYSIS);
  dug.volatile.invulnerable = true;
  dug.volatile.chargingMove = "DIG";
  dug.volatile.thrashTurns = 2;
  dug.volatile.bideTurns = 2;
  dug.volatile.trapping = true;
  dug.volatile.trapTurns = 2;
  const stuck = Status.paralysisCheck(bundle, dug, bytes([Status.FULL_PARALYSIS_BYTE - 1]));
  check("full paralysis loses the turn", stuck.canMove === false, "canMove=" + stuck.canMove);
  check("full paralysis cancels charge, Thrash, Bide and trapping",
        stuck.mon.volatile.chargingMove === "" && stuck.mon.volatile.thrashTurns === 0 &&
          stuck.mon.volatile.bideTurns === 0 && stuck.mon.volatile.trapping === false);
  check("full paralysis does NOT clear invulnerability (the Fly/Dig glitch)",
        stuck.mon.volatile.invulnerable === true, "" + stuck.mon.volatile.invulnerable);
  const notStuck = Status.paralysisCheck(bundle, dug, bytes([Status.FULL_PARALYSIS_BYTE]));
  check("a passed paralysis roll leaves everything alone",
        notStuck.canMove === true && notStuck.mon.volatile.chargingMove === "DIG");
}

// ---------------------------------------------------------------------------
// Confusion
// ---------------------------------------------------------------------------

function suiteConfusion() {
  note("\n== Confusion ==");

  for (const status of [Types.STATUS_SLEEP, Types.STATUS_POISON, Types.STATUS_BURN,
                        Types.STATUS_FREEZE, Types.STATUS_PARALYSIS]) {
    const mon = withStatus(wild("PIDGEY", 20), status);
    const conf = Status.applyConfusion(bundle, mon, Status.defaultInflictOptions(), fixedRandom);
    check("confusion coexists with " + (status === "" ? "nothing" : status),
          conf.applied === true && conf.mon.status === status,
          conf.reason + "/" + conf.mon.status);
  }

  const confused = Status.applyConfusion(bundle, wild("PIDGEY", 20),
                                         Status.defaultInflictOptions(), fixedRandom).mon;
  const again = Status.applyConfusion(bundle, confused, Status.defaultInflictOptions(), fixedRandom);
  check("re-confusing an already confused Pokemon fails",
        again.applied === false && again.reason === Status.IMMUNE_ALREADY_CONFUSED, again.reason);
  check("a refused confusion does not extend the counter",
        again.mon.volatile.confusionTurns === confused.volatile.confusionTurns);

  const subbed = wild("PIDGEY", 20);
  subbed.volatile.substituteHp = 12;
  const primary = Status.applyConfusion(bundle, subbed,
                                        optionsWith({ targetHasSubstitute: true }), fixedRandom);
  check("Confuse Ray is blocked by a substitute", primary.applied === false, primary.reason);
  const secondary = Status.applyConfusion(bundle, subbed,
                                          optionsWith({ targetHasSubstitute: true, secondary: true }),
                                          fixedRandom);
  check("secondary confusion goes through a substitute", secondary.applied === true,
        secondary.reason);

  // The counter, and the free turn it ends on. Bytes below 128 never self-hit.
  let ticking = wild("PIDGEY", 20);
  ticking.volatile.confusionTurns = 3;
  const noHit = bytes([0]);
  let moved = 0;
  let ticks = 0;
  for (let turn = 0; turn < 5; turn++) {
    const r = Status.confusionCheck(bundle, ticking, noHit);
    ticking = r.mon;
    if (r.canMove) moved++;
    if (r.messages.length > 0) ticks++;
    if (ticking.volatile.confusionTurns === 0) break;
  }
  check("a 3-turn confusion announces itself 3 times", ticks === 3, "" + ticks);
  check("the turn confusion ends is a free one", moved === 3, "" + moved);

  // The self-hit clears more than full paralysis does.
  let spinning = wild("PIDGEY", 20);
  spinning.volatile.confusionTurns = 3;
  spinning.volatile.invulnerable = true;
  spinning.volatile.flinched = true;
  spinning.volatile.chargingMove = "FLY";
  const hit = Status.confusionCheck(bundle, spinning, bytes([Status.CONFUSION_SELF_HIT_BYTE]));
  check("the self-hit loses the turn and reports selfHit",
        hit.canMove === false && hit.selfHit === true);
  check("the self-hit clears invulnerability and the flinch too",
        hit.mon.volatile.invulnerable === false && hit.mon.volatile.flinched === false &&
          hit.mon.volatile.chargingMove === "");
  check("the self-hit prints IsConfused then HurtItself",
        hit.messages.length === 2 &&
          hit.messages[0] === bundle.text["_IsConfusedText"].split("{USER}").join("PIDGEY") &&
          hit.messages[1] === bundle.text["_HurtItselfText"],
        JSON.stringify(hit.messages));

  // The damage: typeless, so the chart never runs. Gengar is Ghost (Normal is 0x
  // against it) and Onix is Rock (Normal is 0.5x); both take the untyped number.
  const roll = Damage.MAX_DAMAGE_ROLL;
  for (const id of ["GENGAR", "ONIX", "TAUROS"]) {
    if (!bundle.species[id]) continue;
    const mon = Stats.sendOut(wild(id, 50), 0);
    const observed = Status.confusionSelfHitDamage(mon, false, bytes([byteForRoll(roll)]));
    const expected = refSelfHit(bundle, mon, false, roll);
    note("     " + id + " Lv50 self-hit " + observed + ", expected " + expected +
         " (atk " + mon.battleStats.attack + " def " + mon.battleStats.defense + ")");
    check("the self-hit on " + id + " is typeless", observed === expected, "got " + observed);
  }

  const gengar = Stats.sendOut(wild("GENGAR", 50), 0);
  const plain = Status.confusionSelfHitDamage(gengar, false, bytes([byteForRoll(roll)]));
  const screened = Status.confusionSelfHitDamage(gengar, true, bytes([byteForRoll(roll)]));
  note("     GENGAR self-hit " + plain + " plain, " + screened + " through the opponent's Reflect");
  check("the OPPONENT's Reflect reduces a Pokemon's own confusion damage",
        screened === refSelfHit(bundle, gengar, true, roll) && screened < plain,
        plain + " -> " + screened);
}

// ---------------------------------------------------------------------------
// Coexistence
// ---------------------------------------------------------------------------

function suiteCoexistence() {
  note("\n== Which statuses can coexist ==");

  const all = [Types.STATUS_SLEEP, Types.STATUS_POISON, Types.STATUS_BURN,
               Types.STATUS_FREEZE, Types.STATUS_PARALYSIS];
  let landed = 0;
  let attempts = 0;
  for (const current of all) {
    for (const incoming of all) {
      const mon = withStatus(wild("PIDGEY", 20), current);
      // moveType "" and secondary false, so no type gate can be the reason.
      const r = Status.inflictStatus(bundle, mon, incoming, Status.defaultInflictOptions(),
                                     fixedRandom);
      attempts++;
      if (r.applied) landed++;
      if (Status.canCoexist(current, incoming) !== false) landed += 1000;
    }
  }
  note("     " + attempts + " second-status attempts, " + landed + " landed, expected " +
       (refSecondStatusLands() ? attempts : 0));
  check("a second major status never lands",
        landed === (refSecondStatusLands() ? attempts : 0), "" + landed);

  for (const s of all) {
    check("canCoexist says nothing joins " + s, Status.canCoexist(s, Types.STATUS_POISON) === false);
  }
  check("canCoexist lets a status onto a clear Pokemon",
        Status.canCoexist(Types.STATUS_NONE, Types.STATUS_BURN) === true);
  check("isMajorStatus knows the five and rejects confusion",
        Status.isMajorStatus(Types.STATUS_SLEEP) && !Status.isMajorStatus(Types.STATUS_NONE) &&
          !Status.isMajorStatus("CONFUSED"));

  // The whole gauntlet, in the ROM's order: sleep pre-empts confusion, which
  // pre-empts paralysis.
  let both = withStatus(wild("PIDGEY", 20), Types.STATUS_SLEEP);
  both.sleepTurns = 3;
  both.volatile.confusionTurns = 3;
  const gauntlet = Status.statusBeforeMove(bundle, both, bytes([0]));
  check("sleep pre-empts the confusion tick",
        gauntlet.messages.length === 1 &&
          gauntlet.mon.volatile.confusionTurns === 3, JSON.stringify(gauntlet.messages));

  let paraConf = withStatus(wild("PIDGEY", 20), Types.STATUS_PARALYSIS);
  paraConf.volatile.confusionTurns = 3;
  // First byte: the confusion self-hit roll (0 = no hit). Second: the paralysis
  // roll (0 = fully paralyzed).
  const ordered = Status.statusBeforeMove(bundle, paraConf, bytes([0, 0]));
  check("confusion is announced before paralysis",
        ordered.messages.length === 2 &&
          ordered.messages[0].indexOf("confused") >= 0 &&
          ordered.messages[1].indexOf("paralyzed") >= 0,
        JSON.stringify(ordered.messages));
}

// ---------------------------------------------------------------------------
// Text, straight out of the cartridge
// ---------------------------------------------------------------------------

function suiteText() {
  note("\n== The lines come from the cartridge, not from this file ==");

  const keys = ["_FellAsleepText", "_FastAsleepText", "_WokeUpText", "_AlreadyAsleepText",
                "_DidntAffectText", "_FrozenText", "_IsFrozenText", "_FireDefrostedText",
                "_PoisonedText", "_BadlyPoisonedText", "_HurtByPoisonText", "_BurnedText",
                "_HurtByBurnText", "_ParalyzedMayNotAttackText", "_FullyParalyzedText",
                "_BecameConfusedText", "_IsConfusedText", "_ConfusedNoMoreText",
                "_HurtItselfText", "_StartedSleepingEffect"];
  let missing = 0;
  for (const k of keys) {
    if (typeof bundle.text[k] !== "string") {
      missing++;
      note("     MISSING " + k);
    }
  }
  check("every line this module uses exists in the extracted text", missing === 0,
        missing + " missing");

  const produced = Status.statusLine(bundle, "_FullyParalyzedText", "FALLBACK", "PIKACHU", "PIKACHU");
  const expected = bundle.text["_FullyParalyzedText"].split("{USER}").join("PIKACHU");
  check("statusLine substitutes the ROM's own placeholders", produced === expected,
        JSON.stringify(produced));
  check("statusLine keeps the ROM's control characters", produced.indexOf("\n") >= 0,
        JSON.stringify(produced));
  const fallback = Status.statusLine(null, "_FullyParalyzedText", "{USER} froze", "X", "X");
  check("statusLine falls back when there is no text dataset", fallback === "X froze", fallback);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function runAll() {
  passed = 0;
  failed = 0;
  lines.length = 0;
  suiteRolls();
  suiteSleep();
  suiteFreeze();
  suitePoison();
  suiteBurn();
  suiteParalysis();
  suiteConfusion();
  suiteCoexistence();
  suiteText();
}

if (!selftest) {
  runAll();
  flush();
  console.log("\nSTATUS  " + passed + " PASS  " + failed + " FAIL  " +
              (failed === 0 ? "OK" : "FAILED"));
  process.exit(failed === 0 ? 0 : 1);
} else {
  const MUTATIONS = [
    ["sleep-range", "the sleep counter is expected to reach 0"],
    ["sleep-turns", "a sleep of N is expected to cost N-1 turns"],
    ["confusion-turns", "the confusion counter is expected to be 1..4"],
    ["para-rate", "full paralysis is expected at 32/256"],
    ["confusion-rate", "the self-hit is expected at 192/256"],
    ["chip-divisor", "the residual is expected to be maxHP/8"],
    ["toxic-flat", "toxic damage is expected not to scale"],
    ["freeze-thaws", "freeze is expected to wear off after 5 turns"],
    ["defrost-any-fire", "any Fire move is expected to thaw"],
    ["burn-divisor", "burn is expected to divide Attack by 3"],
    ["para-speed-divisor", "paralysis is expected to halve Speed"],
    ["selfhit-power", "the confusion self-hit is expected to be 60 power"],
    ["selfhit-typed", "the confusion self-hit is expected to run the type chart"],
    ["coexist", "a second major status is expected to land"],
    ["recharge-bypass", "sleep is expected to fail on a recharging statused Pokemon"],
    ["cure-keeps-toxic", "a status cure is expected to leave the toxic counter running"],
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
      "  " + (caught ? "CAUGHT    " : "NOT CAUGHT") + "  " + name.padEnd(20) +
        String(failed).padStart(2) + " failures  -- " + description
    );
  }
  MUT = "";
  runAll();
  lines.length = 0;
  console.log("  " + (failed === 0 ? "CLEAN     " : "DIRTY     ") +
              "  unmutated             " + failed + " failures");
  const ok = notCaught === 0 && failed === 0;
  console.log("\nSTATUS SELFTEST  " + (ok ? "OK -- the gate discriminates" : "FAILED"));
  process.exit(ok ? 0 : 1);
}
