// Move effects, run against the real bundle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battle-moves.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The engine's entropy is a single injected random() over [0,1), so every draw
// this file cares about can be dictated exactly: a 0 makes the accuracy byte 0
// (a hit), a 0.999 makes it 255 (no critical, and the maximum damage roll). The
// scripted() generator feeds a fixed sequence and then falls back to a seeded
// stream, so a test can pin the first three draws and let the rest be noise.
//
// Two things this file is careful about:
//
//   1. Where a rule is arithmetic it is transcribed a second time, from the
//      published Generation 1 behaviour, rather than read back out of the module.
//   2. It proves it can fail. --selftest perturbs one expectation at a time and
//      reports whether the suite noticed. An uncaught mutation is a failure of
//      this file.

import { readFileSync } from "node:fs";

globalThis.print = (...args) => console.log("[lens]", ...args);

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: battle-moves.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const Moves = await import("../Assets/Scripts/play/battle/Moves.ts");
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
    lines.push("  FAIL  " + name + (detail !== undefined ? "  -- " + detail : ""));
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

/** xorshift32: deterministic and uniform enough for a hundred thousand draws. */
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

/** A fixed opening sequence, then noise. */
function scripted(values, seed) {
  const tail = seeded(seed === undefined ? 12345 : seed);
  let i = 0;
  return () => (i < values.length ? values[i++] : tail());
}

/**
 * The three draws a plain damaging move makes, in order.
 *   HIT      byte 0   -> below every accuracy byte
 *   NO_CRIT  byte 255 -> rotated left three is still 255, never below the
 *                        threshold, so the hit is never critical
 *   MAX_ROLL byte 255 -> rotated left one is 255, the top of 217..255
 */
const HIT = 0;
const NO_CRIT = 0.999;
const MAX_ROLL = 0.999;
const LANDS = 0; // a side-effect roll of byte 0 is below every threshold
const NEVER = 0.999;

const pct = (x) => (x * 100).toFixed(3) + "%";

// ---------------------------------------------------------------------------
// Building a battle
// ---------------------------------------------------------------------------

const flatIvs = (v) => {
  const ivs = { hp: 0, attack: v, defense: v, speed: v, special: v };
  ivs.hp = Stats.hpDv(ivs);
  return ivs;
};

function makeMon(speciesId, level, moveIds) {
  const species = bundle.species[speciesId];
  if (!species) throw new Error("no species " + speciesId);
  const ivs = flatIvs(9);
  const evs = Stats.zeroStats();
  const stats = Stats.computeStats(species.baseStats, ivs, evs, level);
  const moves = (moveIds || []).map((id) => {
    const def = bundle.moves[id];
    if (!def) throw new Error("no move " + id);
    return { id, pp: def.pp, maxPp: def.pp };
  });
  while (moves.length < 4) moves.push({ id: "", pp: 0, maxPp: 0 });
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
    stages: Stats.zeroStages(),
    types: species.types.slice(),
    moves,
    status: Types.STATUS_NONE,
    sleepTurns: 0,
    ivs,
    evs,
    exp: 0,
    volatile: Types.newVolatileState(),
    badgeBoostPasses: 0,
  };
  return Stats.sendOut(mon, 0);
}

function side(mon, isPlayer, badgeBits) {
  return {
    active: mon,
    party: [mon],
    activeIndex: 0,
    badgeBits: badgeBits || 0,
    isPlayer: !!isPlayer,
    trainerId: "",
    escapeAttempts: 0,
  };
}

/** An env for `user` attacking `target`, with a dictated random stream. */
function envFor(user, target, random, isWild) {
  return {
    bundle,
    random,
    user,
    target,
    userSide: side(user, true, 0),
    targetSide: side(target, false, 0),
    isWild: isWild === undefined ? true : isWild,
    lastDamage: 0,
    payDay: 0,
    battleEnded: false,
    callDepth: 0,
  };
}

/** A fight between two fresh Pokemon, with the three draws of a clean hit. */
function fight(userSpec, targetSpec, values, seed) {
  const user = makeMon(userSpec[0], userSpec[1], userSpec[2]);
  const target = makeMon(targetSpec[0], targetSpec[1], targetSpec[2]);
  return envFor(user, target, scripted(values || [], seed));
}

// ---------------------------------------------------------------------------
// REFERENCE -- the published Generation 1 rules, transcribed independently
// ---------------------------------------------------------------------------

/** Recoil is a quarter of the damage dealt, or half for Struggle; never zero. */
function refRecoil(dealt, isStruggle) {
  const divisor = mut("recoil-third") ? 3 : isStruggle ? 2 : 4;
  return Math.max(1, Math.trunc(dealt / divisor));
}

/** A drain move returns half of what it dealt, never zero. */
function refDrain(dealt) {
  return Math.max(1, Math.trunc(dealt / (mut("drain-third") ? 3 : 2)));
}

/** The doll costs a quarter of max HP and has one more than that. */
function refSubCost(maxHp) {
  return Math.trunc(maxHp / (mut("sub-cost-third") ? 3 : 4));
}

/** Fixed damage: Sonicboom 20, Dragon Rage 40, Seismic Toss / Night Shade level. */
function refFixed(moveId, level) {
  if (moveId === "SONICBOOM") return 20;
  if (moveId === "DRAGON_RAGE") return 40;
  return mut("fixed-half-level") ? Math.trunc(level / 2) : level;
}

/** Counter returns twice the last damage anyone dealt. */
function refCounter(last) {
  return Math.min(65535, last * (mut("counter-triple") ? 3 : 2));
}

/** The 2-to-5 hit distribution: 3/8, 3/8, 1/8, 1/8. */
function refMultiHitShare(hits) {
  if (mut("multihit-even")) return 0.25;
  return hits === 2 || hits === 3 ? 0.375 : 0.125;
}

/** Wrap and its family lock in 1-4 further hits, weighted 3/8 3/8 1/8 1/8. */
function refTrapShare(turns) {
  if (mut("trap-1to3")) return turns === 4 ? 0 : 1 / 3;
  return turns === 1 || turns === 2 ? 0.375 : 0.125;
}

const SLEEP_MAX = () => (mut("sleep-1to6") ? 6 : 7);

// ---------------------------------------------------------------------------
// 1. The contract: text, coverage, and every move surviving one use
// ---------------------------------------------------------------------------

function suiteContract() {
  note("\n== The cartridge's own words, and every move ==");

  const missing = Moves.TEXT_IDS.filter((id) => typeof bundle.text[id] !== "string");
  note("  " + Moves.TEXT_IDS.length + " ROM text labels asked for by Moves.ts");
  check("every one is really in the cartridge", missing.length === 0, missing.join(","));

  const order = Moves.moveOrder(bundle);
  check(
    "moveOrder is the ROM's 165 moves in move-number order",
    order.length === 165 && order[0] === "POUND" && order[164] === "STRUGGLE" &&
      bundle.moves[order[41]].index === 42,
    order.length + " entries, first " + order[0] + ", last " + order[164]
  );

  // Every move, once, with a seeded stream. Nothing may throw, every move must be
  // "used", and every move must leave a trace: damage, a message, a stage change
  // or a status. A move that silently does nothing is a hole in the dispatch.
  const effectsSeen = {};
  let thrown = 0;
  let silent = 0;
  const silentNames = [];
  const ids = Object.keys(bundle.moves);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    effectsSeen[bundle.moves[id].effect] = true;
    const env = fight(["NIDOKING", 30, [id]], ["CHANSEY", 30, ["TACKLE"]], [], 7000 + i);
    // Give the effects that need a partner something to work with.
    env.target.volatile.lastMoveUsed = "TACKLE";
    env.lastDamage = 20;
    if (bundle.moves[id].effect === "DREAM_EATER_EFFECT") env.target.status = Types.STATUS_SLEEP;
    let result = null;
    try {
      result = Moves.useMove(env, id);
    } catch (err) {
      thrown++;
      silentNames.push(id + ":" + err.message);
      continue;
    }
    const trace = result.damage > 0 || result.messages.length > 0 ||
      result.stageChanges.length > 0 || result.statusInflicted !== "" ||
      env.battleEnded || env.user.volatile.chargingMove !== "";
    if (!result.used || !trace) {
      silent++;
      silentNames.push(id);
    }
  }
  note("  all " + ids.length + " moves used once against a CHANSEY");
  check("none of them threw", thrown === 0, silentNames.slice(0, 6).join(" "));
  check("and every one left a trace", silent === 0, silentNames.slice(0, 8).join(" "));
  check("all 68 effect constants were exercised", Object.keys(effectsSeen).length === 68,
        String(Object.keys(effectsSeen).length));
}

// ---------------------------------------------------------------------------
// 2. Stat stages
// ---------------------------------------------------------------------------

function suiteStages() {
  note("\n== Stat changes ==");

  // Growl: one stage off the target's Attack, and the working stat follows.
  let env = fight(["PIDGEY", 10, ["GROWL"]], ["CHANSEY", 10, []], [HIT]);
  const before = env.target.battleStats.attack;
  let r = Moves.useMove(env, "GROWL");
  check(
    "GROWL drops the target one Attack stage",
    env.target.stages.attack === -1 && r.stageChanges.length === 1 &&
      r.stageChanges[0].delta === -1 && r.stageChanges[0].onUser === false,
    env.target.stages.attack + " / " + JSON.stringify(r.stageChanges)
  );
  check(
    "and the working stat is the -1 row of the ROM's ratio table",
    env.target.battleStats.attack === Stats.applyStatStage(env.target.stats.attack, -1),
    before + " -> " + env.target.battleStats.attack
  );

  // Swords Dance: two stages on the user, and it says so.
  env = fight(["NIDOKING", 30, ["SWORDS_DANCE"]], ["CHANSEY", 30, []], []);
  r = Moves.useMove(env, "SWORDS_DANCE");
  check(
    "SWORDS_DANCE raises the user two stages",
    env.user.stages.attack === 2 && r.stageChanges[0].onUser === true &&
      r.stageChanges[0].delta === 2,
    JSON.stringify(r.stageChanges)
  );
  check(
    "and prints the cartridge's 'greatly rose' line",
    r.messages.length === 1 && r.messages[0].indexOf("greatly") >= 0 &&
      r.messages[0].indexOf("ATTACK") >= 0,
    JSON.stringify(r.messages)
  );

  // Saturation.
  env.user.stages.attack = 6;
  r = Moves.useMove(env, "SWORDS_DANCE");
  check(
    "at +6 another raise is 'Nothing happened!' and no stage change",
    r.stageChanges.length === 0 && r.failed === true &&
      r.messages[0].indexOf("Nothing happened") >= 0,
    JSON.stringify(r.messages)
  );

  // Mist refuses a change the opponent forced, and not one the user made.
  env = fight(["PIDGEY", 10, ["GROWL"]], ["CHANSEY", 10, []], [HIT]);
  env.target.volatile.mist = true;
  r = Moves.useMove(env, "GROWL");
  check(
    "MIST refuses an enemy-forced drop",
    r.failed === true && env.target.stages.attack === 0,
    env.target.stages.attack + " " + JSON.stringify(r.messages)
  );
  env = fight(["NIDOKING", 30, ["SWORDS_DANCE"]], ["CHANSEY", 30, []], []);
  env.user.volatile.mist = true;
  r = Moves.useMove(env, "SWORDS_DANCE");
  check("and never a raise the user made on itself", env.user.stages.attack === 2);

  // A Substitute refuses it too.
  env = fight(["PIDGEY", 10, ["GROWL"]], ["CHANSEY", 10, []], [HIT]);
  env.target.volatile.substituteHp = 20;
  r = Moves.useMove(env, "GROWL");
  check("a SUBSTITUTE refuses an enemy-forced drop", r.failed === true &&
        env.target.stages.attack === 0);

  // The side-effect drop pierces Mist -- only primary stat moves check it.
  env = fight(["DEWGONG", 30, ["AURORA_BEAM"]], ["CHANSEY", 30, []],
              [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  env.target.volatile.mist = true;
  r = Moves.useMove(env, "AURORA_BEAM");
  check(
    "AURORA_BEAM's side-effect drop goes straight through MIST",
    env.target.stages.attack === -1,
    env.target.stages.attack + " dmg " + r.damage
  );

  // ...but not through a Substitute.
  env = fight(["DEWGONG", 30, ["AURORA_BEAM"]], ["CHANSEY", 30, []],
              [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  env.target.volatile.substituteHp = 500;
  r = Moves.useMove(env, "AURORA_BEAM");
  check("and never through a SUBSTITUTE", env.target.stages.attack === 0,
        String(env.target.stages.attack));
}

// ---------------------------------------------------------------------------
// 3. Status
// ---------------------------------------------------------------------------

function suiteStatus() {
  note("\n== Status infliction ==");

  // Thunder Wave is Electric, and Electric cannot paralyse Ground.
  let env = fight(["PIKACHU", 20, ["THUNDER_WAVE"]], ["DIGLETT", 20, []], [HIT]);
  let r = Moves.useMove(env, "THUNDER_WAVE");
  check(
    "THUNDER_WAVE cannot paralyse a GROUND type",
    env.target.status === Types.STATUS_NONE && r.failed === true,
    env.target.status
  );
  // ...but Body Slam is Normal, so it can. The DIGLETT is level 80 because a
  // side effect never lands on a target the hit already knocked out, and a level
  // 30 one does not survive a SNORLAX.
  env = fight(["SNORLAX", 30, ["BODY_SLAM"]], ["DIGLETT", 80, []],
              [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  r = Moves.useMove(env, "BODY_SLAM");
  check(
    "BODY_SLAM still paralyses one, because the check is on the MOVE's type",
    env.target.status === Types.STATUS_PARALYSIS,
    env.target.status
  );
  // ...and the same move against the same species does NOT, once the hit has
  // knocked it out: Gen 1 blocks every side effect on a fainted target. This is
  // the control for the check above, which is otherwise a level-80 DIGLETT for
  // no visible reason.
  const doomed = fight(["SNORLAX", 30, ["BODY_SLAM"]], ["DIGLETT", 5, []],
                       [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  const doomedResult = Moves.useMove(doomed, "BODY_SLAM");
  check(
    "and a target the hit knocked out takes no side effect at all",
    doomedResult.targetFainted === true && doomed.target.hp === 0 &&
      doomed.target.status === Types.STATUS_NONE,
    "hp " + doomed.target.hp + " status '" + doomed.target.status + "'"
  );
  check(
    "and paralysis quarters the working Speed at once",
    env.target.battleStats.speed ===
      Math.max(1, Math.trunc(env.target.stats.speed / 4)),
    env.target.battleStats.speed + " of " + env.target.stats.speed
  );

  // A secondary status never lands when the move's type is one of the target's.
  //
  // Every one of these asserts the target SURVIVED first. A level 30 CHANSEY does
  // not survive a level 30 SNORLAX's BODY_SLAM, and a fainted target gets no side
  // effect for a quite different reason -- which made an earlier version of this
  // check pass with the type-match rule deleted from the engine.
  env = fight(["SNORLAX", 30, ["BODY_SLAM"]], ["CHANSEY", 80, []],
              [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  r = Moves.useMove(env, "BODY_SLAM");
  check(
    "BODY_SLAM cannot paralyse a NORMAL type at all",
    env.target.hp > 0 && r.damage > 0 && env.target.status === Types.STATUS_NONE,
    "hp " + env.target.hp + " dmg " + r.damage + " status '" + env.target.status + "'"
  );
  env = fight(["ZAPDOS", 40, ["THUNDERBOLT"]], ["JOLTEON", 80, []],
              [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  r = Moves.useMove(env, "THUNDERBOLT");
  check(
    "nor THUNDERBOLT an ELECTRIC one -- and GROUND immunity is not what stops it",
    env.target.hp > 0 && r.damage > 0 && env.target.status === Types.STATUS_NONE,
    "hp " + env.target.hp + " dmg " + r.damage + " status '" + env.target.status + "'"
  );
  env = fight(["ARTICUNO", 40, ["BLIZZARD"]], ["DEWGONG", 40, []],
              [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  r = Moves.useMove(env, "BLIZZARD");
  check("and BLIZZARD cannot freeze an ICE type",
        env.target.hp > 0 && r.damage > 0 && env.target.status === Types.STATUS_NONE,
        "hp " + env.target.hp + " dmg " + r.damage + " status '" + env.target.status + "'");

  // Type immunities on the primary path.
  env = fight(["NIDOKING", 30, ["TOXIC"]], ["WEEZING", 30, []], [HIT]);
  r = Moves.useMove(env, "TOXIC");
  check("a POISON type cannot be poisoned", env.target.status === Types.STATUS_NONE &&
        r.failed === true, env.target.status);

  // Toxic starts the badly-poisoned counter; ordinary poison does not.
  env = fight(["NIDOKING", 30, ["TOXIC"]], ["CHANSEY", 30, []], [HIT]);
  r = Moves.useMove(env, "TOXIC");
  check(
    "TOXIC sets PSN plus the badly-poisoned counter at 1",
    env.target.status === Types.STATUS_POISON && env.target.volatile.badlyPoisoned === 1,
    env.target.status + "/" + env.target.volatile.badlyPoisoned
  );
  env = fight(["NIDOKING", 30, ["POISONPOWDER"]], ["CHANSEY", 30, []], [HIT]);
  r = Moves.useMove(env, "POISONPOWDER");
  check(
    "POISONPOWDER sets PSN with no counter",
    env.target.status === Types.STATUS_POISON && env.target.volatile.badlyPoisoned === 0,
    env.target.status + "/" + env.target.volatile.badlyPoisoned
  );

  // A Substitute blocks poison and every secondary status, and never primary sleep.
  env = fight(["NIDOKING", 30, ["POISONPOWDER"]], ["CHANSEY", 30, []], [HIT]);
  env.target.volatile.substituteHp = 50;
  Moves.useMove(env, "POISONPOWDER");
  check("a SUBSTITUTE blocks primary poison", env.target.status === Types.STATUS_NONE);
  env = fight(["PARAS", 30, ["SPORE"]], ["CHANSEY", 30, []], [HIT]);
  env.target.volatile.substituteHp = 50;
  Moves.useMove(env, "SPORE");
  check("and never blocks primary sleep", env.target.status === Types.STATUS_SLEEP,
        env.target.status);

  // A Fire move thaws a frozen target whatever its own burn roll does.
  env = fight(["CHARMANDER", 30, ["EMBER"]], ["CHANSEY", 30, []],
              [HIT, NO_CRIT, MAX_ROLL, NEVER]);
  env.target.status = Types.STATUS_FREEZE;
  r = Moves.useMove(env, "EMBER");
  check(
    "a FIRE move defrosts a frozen target",
    env.target.status === Types.STATUS_NONE &&
      r.messages.join(" ").indexOf("defrosted") >= 0,
    env.target.status
  );

  // Sleep runs 1..7 turns, uniformly.
  const random = seeded(4242);
  const env2 = fight(["PARAS", 30, ["SPORE"]], ["CHANSEY", 30, []], []);
  env2.random = random;
  const turnCounts = {};
  let landedSleep = 0;
  for (let i = 0; i < 20000; i++) {
    env2.target.status = Types.STATUS_NONE;
    env2.target.sleepTurns = 0;
    const res = Moves.useMove(env2, "SPORE");
    if (env2.target.status === Types.STATUS_SLEEP) {
      landedSleep++;
      turnCounts[env2.target.sleepTurns] = (turnCounts[env2.target.sleepTurns] || 0) + 1;
    }
    void res;
  }
  const seenTurns = Object.keys(turnCounts).map(Number).sort((a, b) => a - b);
  note("  SPORE over " + landedSleep + " landings: sleep turns " + seenTurns.join(","));
  check(
    "sleep lasts 1 to " + SLEEP_MAX() + " turns and nothing else",
    seenTurns.length === SLEEP_MAX() && seenTurns[0] === 1 &&
      seenTurns[seenTurns.length - 1] === SLEEP_MAX(),
    seenTurns.join(",")
  );

  // A side-effect status rate: Ember burns 26 times in 256.
  const env3 = fight(["CHARMANDER", 30, ["EMBER"]], ["CHANSEY", 60, []], []);
  env3.random = seeded(99);
  let burns = 0;
  const tries = 20000;
  for (let i = 0; i < tries; i++) {
    env3.target.status = Types.STATUS_NONE;
    env3.target.hp = env3.target.maxHp;
    const res = Moves.useMove(env3, "EMBER");
    if (res.hit && env3.target.status === Types.STATUS_BURN) burns++;
  }
  const burnRate = burns / tries;
  note("  EMBER burned " + burns + "/" + tries + " = " + pct(burnRate) +
       ", the ROM's threshold is 26/256 = " + pct(26 / 256));
  check("the burn side effect fires at 26/256", Math.abs(burnRate - 26 / 256) < 0.01,
        pct(burnRate));
}

// ---------------------------------------------------------------------------
// 3b. Every side-effect threshold, measured
// ---------------------------------------------------------------------------

/**
 * The ROM's own thresholds out of 256, and what each one is observed on. The
 * "+1" ones are the rgbds `percent` macro rounded down and then nudged back up.
 */
const SIDE_RATES = [
  ["BITE", "flinch", 26, "FLINCH_SIDE_EFFECT1, 10 percent + 1"],
  ["HEADBUTT", "flinch", 77, "FLINCH_SIDE_EFFECT2, 30 percent + 1"],
  ["POISON_STING", "status", 52, "POISON_SIDE_EFFECT1, 20 percent + 1"],
  ["SLUDGE", "status", 103, "POISON_SIDE_EFFECT2, 40 percent + 1"],
  ["PSYBEAM", "confusion", 25, "CONFUSION_SIDE_EFFECT, 10 percent flat"],
  ["BUBBLEBEAM", "stage", 85, "SPEED_DOWN_SIDE_EFFECT, 33 percent + 1"],
];

function measureSideRate(moveId, observe, isPlayer, samples, random) {
  const user = makeMon("MEW", 60, [moveId]);
  const target = makeMon("CHANSEY", 100, []);
  const env = envFor(user, target, random);
  env.userSide.isPlayer = isPlayer;
  let landed = 0;
  let hits = 0;
  for (let i = 0; i < samples; i++) {
    target.hp = target.maxHp;
    target.status = Types.STATUS_NONE;
    target.stages = Stats.zeroStages();
    target.volatile.confusionTurns = 0;
    target.volatile.flinched = false;
    const res = Moves.useMove(env, moveId);
    if (!res.hit || res.damage <= 0) continue;
    hits++;
    if (observe === "flinch" && target.volatile.flinched) landed++;
    if (observe === "status" && target.status !== Types.STATUS_NONE) landed++;
    if (observe === "confusion" && target.volatile.confusionTurns > 0) landed++;
    if (observe === "stage" && target.stages.speed < 0) landed++;
  }
  return { rate: landed / hits, hits };
}

function suiteSideRates() {
  note("\n== Side-effect thresholds ==");
  note("  one part in 256 is 0.39%, and the tolerance below is 0.8%, so this");
  note("  separates 26 from 77 but could not separate 25 from 26");

  const random = seeded(5150);
  let worst = 0;
  for (let i = 0; i < SIDE_RATES.length; i++) {
    const [moveId, observe, threshold, label] = SIDE_RATES[i];
    const seen = measureSideRate(moveId, observe, true, 30000, random);
    const expected = threshold / 256;
    worst = Math.max(worst, Math.abs(seen.rate - expected));
    note("  " + moveId.padEnd(13) + pct(seen.rate) + " over " + seen.hits +
         " hits, the ROM's " + threshold + "/256 is " + pct(expected) + "  (" + label + ")");
  }
  check("every side effect fires at the ROM's own threshold", worst < 0.008,
        "worst deviation " + pct(worst));

  // GEN1 BUG: an enemy-side stat-lowering side effect throws away 64 draws in 256
  // for no stated reason (effects.asm:552), so the enemy's Bubblebeam drops Speed
  // three quarters as often as the player's.
  const enemy = measureSideRate("BUBBLEBEAM", "stage", false, 30000, random);
  const expectedEnemy = (1 - 64 / 256) * (85 / 256);
  note("  BUBBLEBEAM from the ENEMY side: " + pct(enemy.rate) +
       ", expected (1 - 64/256) x 85/256 = " + pct(expectedEnemy));
  check(
    "GEN1 BUG: an enemy stat-lowering side effect whiffs 64 times in 256 first",
    Math.abs(enemy.rate - expectedEnemy) < 0.008,
    pct(enemy.rate) + " vs " + pct(expectedEnemy)
  );

  // A type immunity reads as a move that did not connect, and says the ROM's own
  // line rather than "attack missed".
  let env = fight(["TAUROS", 40, ["TACKLE"]], ["GENGAR", 40, []],
                  [HIT, NO_CRIT, MAX_ROLL]);
  let r = Moves.useMove(env, "TACKLE");
  check(
    "NORMAL on GHOST does not connect at all",
    r.hit === false && r.damage === 0 && r.effectiveness === 0 &&
      r.messages.join(" ").indexOf("doesn't affect") >= 0,
    "hit " + r.hit + " eff " + r.effectiveness + " " + JSON.stringify(r.messages)
  );

  // A damaging move whose side effect had nowhere to go has not "failed".
  env = fight(["BLASTOISE", 40, ["BUBBLEBEAM"]], ["CHANSEY", 100, []],
              [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  env.target.stages.speed = -6;
  r = Moves.useMove(env, "BUBBLEBEAM");
  check(
    "a hit whose side-effect drop had nowhere to go is still not a failure",
    r.failed === false && r.damage > 0 && env.target.stages.speed === -6,
    "failed " + r.failed + " dmg " + r.damage
  );

  // A Substitute stops a flinch, and does not stop secondary confusion.
  env = fight(["RATICATE", 40, ["HYPER_FANG"]], ["CHANSEY", 100, []],
                  [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  env.target.volatile.substituteHp = 5000;
  Moves.useMove(env, "HYPER_FANG");
  check("a SUBSTITUTE stops a flinch", env.target.volatile.flinched === false);
  env = fight(["KADABRA", 40, ["PSYBEAM"]], ["CHANSEY", 100, []],
              [HIT, NO_CRIT, MAX_ROLL, LANDS]);
  env.target.volatile.substituteHp = 5000;
  Moves.useMove(env, "PSYBEAM");
  check(
    "and never stops secondary confusion, which does not check for one",
    env.target.volatile.confusionTurns >= 2 && env.target.volatile.confusionTurns <= 5,
    String(env.target.volatile.confusionTurns)
  );
}

// ---------------------------------------------------------------------------
// 4. Multi-hit
// ---------------------------------------------------------------------------

function suiteMultiHit() {
  note("\n== Multi-hit ==");

  let env = fight(["HITMONLEE", 40, ["DOUBLE_KICK"]], ["CHANSEY", 60, []],
                  [HIT, NO_CRIT, MAX_ROLL]);
  let r = Moves.useMove(env, "DOUBLE_KICK");
  check("DOUBLE_KICK always connects twice", r.hits === 2, String(r.hits));
  check(
    "and both hits do the same damage, as Gen 1 rolls once",
    r.damage % 2 === 0 && r.damage > 0,
    String(r.damage)
  );

  // The 2-to-5 distribution.
  const random = seeded(31337);
  const counts = {};
  let total = 0;
  for (let i = 0; i < 40000; i++) {
    const e = fight(["BEEDRILL", 40, ["PIN_MISSILE"]], ["CHANSEY", 80, []], []);
    e.random = random;
    const res = Moves.useMove(e, "PIN_MISSILE");
    if (!res.hit) continue;
    counts[res.hits] = (counts[res.hits] || 0) + 1;
    total++;
  }
  const shares = [2, 3, 4, 5].map((h) => (counts[h] || 0) / total);
  note(
    "  PIN_MISSILE over " + total + " hits: " +
      [2, 3, 4, 5].map((h, i) => h + "x " + pct(shares[i])).join("  ")
  );
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    worst = Math.max(worst, Math.abs(shares[i] - refMultiHitShare(i + 2)));
  }
  check(
    "the hit count is 3/8 3/8 1/8 1/8 over 2,3,4,5",
    worst < 0.01 && (counts[6] || 0) === 0 && (counts[1] || 0) === 0,
    "worst deviation " + pct(worst)
  );

  // Breaking a Substitute stops a multi-hit move where it stands.
  env = fight(["BEEDRILL", 40, ["PIN_MISSILE"]], ["CHANSEY", 80, []],
              [0.99, HIT, NO_CRIT, MAX_ROLL]); // 0.99 -> the 5-hit row
  env.target.volatile.substituteHp = 1;
  r = Moves.useMove(env, "PIN_MISSILE");
  check(
    "breaking a SUBSTITUTE ends a multi-hit move after that hit",
    r.hits === 1 && env.target.volatile.substituteHp === 0 &&
      env.target.hp === env.target.maxHp,
    r.hits + " hits, sub " + env.target.volatile.substituteHp
  );

  // The effectiveness line is printed once per landed hit, as the cartridge does.
  env = fight(["HITMONLEE", 40, ["DOUBLE_KICK"]], ["CHANSEY", 60, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  r = Moves.useMove(env, "DOUBLE_KICK");
  const superLines = r.messages.filter((m) => m.indexOf("super") >= 0).length;
  check(
    "FIGHTING on NORMAL says 'super effective' once per hit",
    r.effectiveness === 2 && superLines === 2,
    r.effectiveness + "x, " + superLines + " lines"
  );
}

// ---------------------------------------------------------------------------
// 5. Recoil, drain, crash
// ---------------------------------------------------------------------------

function suiteRecoilDrain() {
  note("\n== Recoil and drain ==");

  let env = fight(["TAUROS", 40, ["TAKE_DOWN"]], ["CHANSEY", 80, []],
                  [HIT, NO_CRIT, MAX_ROLL]);
  let hpBefore = env.user.hp;
  let r = Moves.useMove(env, "TAKE_DOWN");
  check(
    "TAKE_DOWN costs a quarter of the damage it dealt",
    r.recoil === refRecoil(r.damage, false) && env.user.hp === hpBefore - r.recoil,
    "dealt " + r.damage + ", recoil " + r.recoil + ", expected " + refRecoil(r.damage, false)
  );

  env = fight(["TAUROS", 40, ["STRUGGLE"]], ["CHANSEY", 80, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  r = Moves.useMove(env, "STRUGGLE");
  check(
    "STRUGGLE costs half",
    r.recoil === refRecoil(r.damage, true),
    "dealt " + r.damage + ", recoil " + r.recoil + ", expected " + refRecoil(r.damage, true)
  );

  env = fight(["ODDISH", 30, ["ABSORB"]], ["CHANSEY", 60, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  env.user.hp = env.user.maxHp - 100;
  hpBefore = env.user.hp;
  r = Moves.useMove(env, "ABSORB");
  check(
    "ABSORB returns half of what it dealt",
    r.drained === refDrain(r.damage) && env.user.hp === hpBefore + r.drained,
    "dealt " + r.damage + ", drained " + r.drained + ", expected " + refDrain(r.damage)
  );
  check(
    "GEN1 BUG: the drain overwrites the shared damage word with the HEAL",
    env.lastDamage === r.drained,
    env.lastDamage + " vs drained " + r.drained
  );

  env = fight(["ODDISH", 30, ["ABSORB"]], ["CHANSEY", 60, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  hpBefore = env.user.hp;
  r = Moves.useMove(env, "ABSORB");
  check("and never heals past full", env.user.hp === env.user.maxHp,
        env.user.hp + "/" + env.user.maxHp);

  // Dream Eater only works on a sleeping target.
  env = fight(["GENGAR", 40, ["DREAM_EATER"]], ["CHANSEY", 60, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  r = Moves.useMove(env, "DREAM_EATER");
  check("DREAM_EATER fails against a target that is awake", r.failed === true &&
        r.damage === 0, JSON.stringify(r.messages));
  env = fight(["GENGAR", 40, ["DREAM_EATER"]], ["CHANSEY", 60, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  env.target.status = Types.STATUS_SLEEP;
  env.user.hp = env.user.maxHp - 100;
  r = Moves.useMove(env, "DREAM_EATER");
  check("and drains half against a sleeping one", r.damage > 0 &&
        r.drained === refDrain(r.damage), r.damage + "/" + r.drained);

  // GEN1 BUG: Jump Kick's crash is exactly one HP, not half the damage.
  env = fight(["HITMONLEE", 40, ["HI_JUMP_KICK"]], ["CHANSEY", 60, []], [NEVER]);
  hpBefore = env.user.hp;
  r = Moves.useMove(env, "HI_JUMP_KICK");
  check(
    "a missed HI_JUMP_KICK crashes for exactly 1 HP",
    r.hit === false && env.user.hp === hpBefore - 1 && r.recoil === 1,
    "hp " + hpBefore + " -> " + env.user.hp + ", recoil " + r.recoil
  );
}

// ---------------------------------------------------------------------------
// 6. Charge and semi-invulnerability
// ---------------------------------------------------------------------------

function suiteCharge() {
  note("\n== Charge turns ==");

  let env = fight(["VENUSAUR", 40, ["SOLARBEAM"]], ["CHANSEY", 60, []],
                  [HIT, NO_CRIT, MAX_ROLL]);
  let r = Moves.useMove(env, "SOLARBEAM");
  check(
    "SOLARBEAM's first turn does nothing but charge",
    r.damage === 0 && env.user.volatile.chargingMove === "SOLARBEAM" &&
      env.user.volatile.invulnerable === false &&
      r.messages.join(" ").indexOf("sunlight") >= 0,
    JSON.stringify(r.messages)
  );
  r = Moves.useMove(env, "SOLARBEAM");
  check(
    "and the second turn releases it",
    r.damage > 0 && env.user.volatile.chargingMove === "",
    "dmg " + r.damage
  );

  env = fight(["PIDGEOT", 40, ["FLY"]], ["CHANSEY", 60, []], [HIT, NO_CRIT, MAX_ROLL]);
  Moves.useMove(env, "FLY");
  check("FLY goes semi-invulnerable", env.user.volatile.invulnerable === true);
  env = fight(["DUGTRIO", 40, ["DIG"]], ["CHANSEY", 60, []], [HIT, NO_CRIT, MAX_ROLL]);
  Moves.useMove(env, "DIG");
  check("and so does DIG, which is an ordinary CHARGE_EFFECT",
        env.user.volatile.invulnerable === true);
  env = fight(["VENUSAUR", 40, ["SOLARBEAM"]], ["CHANSEY", 60, []], []);
  Moves.useMove(env, "SOLARBEAM");
  check("SOLARBEAM does not", env.user.volatile.invulnerable === false);

  // Nothing reaches a semi-invulnerable target except Swift.
  env = fight(["TAUROS", 40, ["BODY_SLAM"]], ["PIDGEOT", 40, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  env.target.volatile.invulnerable = true;
  r = Moves.useMove(env, "BODY_SLAM");
  check("a move misses a mid-FLY target", r.hit === false && r.damage === 0);
  env = fight(["TAUROS", 40, ["SWIFT"]], ["PIDGEOT", 40, []], [NO_CRIT, MAX_ROLL]);
  env.target.volatile.invulnerable = true;
  r = Moves.useMove(env, "SWIFT");
  check("SWIFT reaches it anyway", r.hit === true && r.damage > 0, "dmg " + r.damage);
}

// ---------------------------------------------------------------------------
// 7. Fixed damage, Super Fang and the one-hit KOs
// ---------------------------------------------------------------------------

function suiteFixed() {
  note("\n== Fixed damage and OHKO ==");

  let env = fight(["MACHOP", 25, ["SEISMIC_TOSS"]], ["CHANSEY", 60, []], [HIT]);
  let r = Moves.useMove(env, "SEISMIC_TOSS");
  check("SEISMIC_TOSS deals the user's level", r.damage === refFixed("SEISMIC_TOSS", 25),
        r.damage + " at level 25");

  env = fight(["VOLTORB", 25, ["SONICBOOM"]], ["CHANSEY", 60, []], [HIT]);
  r = Moves.useMove(env, "SONICBOOM");
  check("SONICBOOM deals 20", r.damage === refFixed("SONICBOOM", 25), String(r.damage));

  env = fight(["DRATINI", 25, ["DRAGON_RAGE"]], ["CHANSEY", 60, []], [HIT]);
  r = Moves.useMove(env, "DRAGON_RAGE");
  check("DRAGON_RAGE deals 40", r.damage === refFixed("DRAGON_RAGE", 25), String(r.damage));

  // GEN1 BUG: fixed damage never reaches the type chart, so a Ghost move hits a
  // Normal type for full even though the chart says it cannot touch it.
  const chart = Damage.typeChartFor(bundle);
  check(
    "the chart really does say GHOST cannot touch NORMAL",
    chart.effectiveness("GHOST", ["NORMAL"]) === 0
  );
  env = fight(["GASTLY", 25, ["NIGHT_SHADE"]], ["CHANSEY", 60, []], [HIT]);
  r = Moves.useMove(env, "NIGHT_SHADE");
  check(
    "GEN1 BUG: NIGHT_SHADE still deals the user's level to a NORMAL type",
    r.damage === refFixed("NIGHT_SHADE", 25),
    String(r.damage)
  );

  // Psywave: 1 .. floor(level*3/2)-1.
  env = fight(["KADABRA", 30, ["PSYWAVE"]], ["CHANSEY", 90, []], []);
  env.random = seeded(777);
  let lo = 99999;
  let hi = 0;
  for (let i = 0; i < 5000; i++) {
    env.target.hp = env.target.maxHp;
    const res = Moves.useMove(env, "PSYWAVE");
    if (!res.hit) continue;
    lo = Math.min(lo, res.damage);
    hi = Math.max(hi, res.damage);
  }
  const psyMax = Math.trunc((30 * 3) / 2) - 1;
  note("  PSYWAVE at level 30 over 5000 hits: " + lo + ".." + hi +
       ", the formula's range is 1.." + psyMax);
  check("PSYWAVE stays inside 1..floor(1.5L)-1", lo === 1 && hi === psyMax,
        lo + ".." + hi);

  // Super Fang halves current HP, and reaches a Ghost for the same reason.
  env = fight(["RATICATE", 30, ["SUPER_FANG"]], ["GENGAR", 40, []], [HIT]);
  const half = Math.trunc(env.target.hp / 2);
  r = Moves.useMove(env, "SUPER_FANG");
  check(
    "GEN1 BUG: SUPER_FANG halves a GHOST's HP, NORMAL immunity notwithstanding",
    r.damage === half && half > 0,
    r.damage + " of " + (half * 2)
  );

  // OHKO: never against something faster, always for everything against something slower.
  env = fight(["ELECTRODE", 40, ["HORN_DRILL"]], ["SNORLAX", 40, []], [HIT]);
  const foeHp = env.target.hp;
  r = Moves.useMove(env, "HORN_DRILL");
  check(
    "an OHKO from a faster user takes every point of HP",
    r.damage === foeHp && env.target.hp === 0 && r.targetFainted === true &&
      r.messages.join(" ").indexOf("One-hit KO") >= 0,
    r.damage + " of " + foeHp
  );
  env = fight(["SNORLAX", 40, ["HORN_DRILL"]], ["ELECTRODE", 40, []], [HIT]);
  r = Moves.useMove(env, "HORN_DRILL");
  const ohkoSlowerWorked = r.damage > 0;
  check(
    "and never lands on something faster",
    mut("ohko-slower-wins") ? ohkoSlowerWorked : !ohkoSlowerWorked,
    "damage " + r.damage
  );
  env = fight(["DUGTRIO", 40, ["FISSURE"]], ["PIDGEOT", 40, []], [HIT]);
  r = Moves.useMove(env, "FISSURE");
  check(
    "FISSURE cannot touch a FLYING type -- OHKO is the one damage family that " +
      "still meets the chart",
    r.damage === 0 && r.effectiveness === 0 &&
      r.messages.join(" ").indexOf("doesn't affect") >= 0,
    JSON.stringify(r.messages)
  );
}

// ---------------------------------------------------------------------------
// 8. Substitute, Wrap, Hyper Beam, Counter, Mirror Move, Metronome, Transform
// ---------------------------------------------------------------------------

function suiteNamedMoves() {
  note("\n== The moves with their own rules ==");

  // --- Substitute ---
  let env = fight(["CHANSEY", 40, ["SUBSTITUTE"]], ["TAUROS", 40, []], []);
  const maxHp = env.user.maxHp;
  const cost = refSubCost(maxHp);
  let r = Moves.useMove(env, "SUBSTITUTE");
  check(
    "SUBSTITUTE costs a quarter of max HP and the doll gets that plus one",
    env.user.hp === maxHp - cost && env.user.volatile.substituteHp === cost + 1,
    "maxHp " + maxHp + ", hp " + env.user.hp + ", doll " + env.user.volatile.substituteHp +
      ", expected cost " + cost
  );
  r = Moves.useMove(env, "SUBSTITUTE");
  check("a second one fails", r.failed === true &&
        r.messages.join(" ").indexOf("SUBSTITUTE") >= 0);

  env = fight(["CHANSEY", 40, ["SUBSTITUTE"]], ["TAUROS", 40, []], []);
  env.user.hp = Math.trunc(env.user.maxHp / 4) - 1;
  r = Moves.useMove(env, "SUBSTITUTE");
  check("below a quarter of max HP it is 'Too weak'", r.failed === true &&
        env.user.volatile.substituteHp === 0, JSON.stringify(r.messages));

  env = fight(["CHANSEY", 40, ["SUBSTITUTE"]], ["TAUROS", 40, []], []);
  env.user.hp = Math.trunc(env.user.maxHp / 4);
  r = Moves.useMove(env, "SUBSTITUTE");
  check(
    "GEN1 BUG: at exactly a quarter it is built and the user is left on zero",
    env.user.hp === 0 && env.user.volatile.substituteHp > 0 && r.userFainted === true,
    "hp " + env.user.hp + " doll " + env.user.volatile.substituteHp
  );

  // The doll takes the hit, and the Pokemon behind it does not.
  env = fight(["TAUROS", 40, ["TACKLE"]], ["CHANSEY", 40, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  env.target.volatile.substituteHp = 5000;
  const behind = env.target.hp;
  r = Moves.useMove(env, "TACKLE");
  check(
    "a SUBSTITUTE takes the damage in its owner's place",
    env.target.hp === behind && env.target.volatile.substituteHp === 5000 - r.damage &&
      r.messages.join(" ").indexOf("SUBSTITUTE") >= 0,
    "hp " + env.target.hp + " doll " + env.target.volatile.substituteHp
  );

  // --- Wrap and the partial-trapping family ---
  env = fight(["DRATINI", 30, ["WRAP"]], ["CHANSEY", 60, []],
              [HIT, NO_CRIT, MAX_ROLL, 0]);
  r = Moves.useMove(env, "WRAP");
  check(
    "WRAP locks the user in and remembers the damage to repeat",
    env.user.volatile.trapping === true && env.user.volatile.trapTurns >= 1 &&
      env.user.volatile.trapTurns <= 4 &&
      env.user.volatile.effectCounter === r.damage &&
      env.target.volatile.trapTurns === env.user.volatile.trapTurns,
    "turns " + env.user.volatile.trapTurns + " stored " + env.user.volatile.effectCounter
  );
  const wrapDamage = r.damage;
  const turnsBefore = env.user.volatile.trapTurns;
  const hpBeforeContinue = env.target.hp;
  const cont = Moves.continueTrapping(env);
  check(
    "and every locked turn repeats it, with no roll of its own",
    cont.damage === wrapDamage && env.target.hp === hpBeforeContinue - wrapDamage &&
      env.user.volatile.trapTurns === turnsBefore - 1 &&
      cont.messages.join(" ").indexOf("attack continues") >= 0,
    cont.damage + " vs " + wrapDamage
  );

  // The continuation count: 1..4 more hits, weighted 3/8 3/8 1/8 1/8.
  const random = seeded(2024);
  const trapCounts = {};
  let trapTotal = 0;
  for (let i = 0; i < 40000; i++) {
    const e = fight(["DRATINI", 30, ["WRAP"]], ["CHANSEY", 90, []], []);
    e.random = random;
    const res = Moves.useMove(e, "WRAP");
    if (!res.hit) continue;
    const t = e.user.volatile.trapTurns;
    trapCounts[t] = (trapCounts[t] || 0) + 1;
    trapTotal++;
  }
  const trapShares = [1, 2, 3, 4].map((t) => (trapCounts[t] || 0) / trapTotal);
  note(
    "  WRAP over " + trapTotal + " landings: " +
      [1, 2, 3, 4].map((t, i) => t + " more " + pct(trapShares[i])).join("  ")
  );
  let trapWorst = 0;
  for (let i = 0; i < 4; i++) {
    trapWorst = Math.max(trapWorst, Math.abs(trapShares[i] - refTrapShare(i + 1)));
  }
  check("the lock runs 1-4 more hits at 3/8 3/8 1/8 1/8", trapWorst < 0.01,
        "worst deviation " + pct(trapWorst));

  // A miss releases the victim at once.
  env = fight(["DRATINI", 30, ["WRAP"]], ["CHANSEY", 60, []], [NEVER]);
  r = Moves.useMove(env, "WRAP");
  check("a missed WRAP holds nobody", env.user.volatile.trapping === false &&
        env.target.volatile.trapTurns === 0);

  // --- Hyper Beam ---
  env = fight(["TAUROS", 40, ["HYPER_BEAM"]], ["CHANSEY", 80, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  r = Moves.useMove(env, "HYPER_BEAM");
  check(
    "HYPER_BEAM leaves the user recharging when the target survives",
    env.user.volatile.recharging === true && env.target.hp > 0,
    "hp left " + env.target.hp
  );
  env = fight(["TAUROS", 40, ["HYPER_BEAM"]], ["CHANSEY", 80, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  env.target.hp = 1;
  r = Moves.useMove(env, "HYPER_BEAM");
  const recharged = env.user.volatile.recharging;
  check(
    "GEN1 BUG: and not when it faints",
    mut("hyperbeam-always") ? recharged : !recharged,
    "targetFainted " + r.targetFainted + ", recharging " + recharged
  );

  // A trapping move clears the target's recharge, even before the hit test.
  env = fight(["DRATINI", 30, ["WRAP"]], ["CHANSEY", 60, []], [NEVER]);
  env.target.volatile.recharging = true;
  Moves.useMove(env, "WRAP");
  check("a trapping move clears the target's recharge even when it misses",
        env.target.volatile.recharging === false);

  // --- Counter ---
  env = fight(["MACHOP", 30, ["COUNTER"]], ["CHANSEY", 80, []], [HIT]);
  env.target.volatile.lastMoveUsed = "TACKLE";
  env.lastDamage = 40;
  r = Moves.useMove(env, "COUNTER");
  check("COUNTER returns twice the last damage", r.damage === refCounter(40),
        r.damage + ", expected " + refCounter(40));

  env = fight(["MACHOP", 30, ["COUNTER"]], ["CHANSEY", 80, []], [HIT]);
  env.target.volatile.lastMoveUsed = "EMBER"; // FIRE, not counterable
  env.lastDamage = 40;
  r = Moves.useMove(env, "COUNTER");
  check("and fails after anything but a NORMAL or FIGHTING move", r.damage === 0 &&
        r.hit === false, "dmg " + r.damage);

  env = fight(["MACHOP", 30, ["COUNTER"]], ["CHANSEY", 80, []], [HIT]);
  env.target.volatile.lastMoveUsed = "TACKLE";
  env.lastDamage = 0;
  r = Moves.useMove(env, "COUNTER");
  check("and fails when nothing has done damage yet", r.damage === 0);

  env = fight(["MACHOP", 30, ["COUNTER"]], ["CHANSEY", 80, []], [HIT]);
  env.target.volatile.lastMoveUsed = "GROWL"; // NORMAL but powerless
  env.lastDamage = 40;
  r = Moves.useMove(env, "COUNTER");
  check("and fails after a NORMAL move with no power", r.damage === 0);

  // --- Mirror Move ---
  env = fight(["PIDGEOT", 40, ["MIRROR_MOVE"]], ["CHANSEY", 60, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  env.target.volatile.lastMoveUsed = "TACKLE";
  r = Moves.useMove(env, "MIRROR_MOVE");
  check(
    "MIRROR_MOVE uses whatever the target used last",
    r.move === "TACKLE" && r.damage > 0,
    r.move + " for " + r.damage
  );
  env = fight(["PIDGEOT", 40, ["MIRROR_MOVE"]], ["CHANSEY", 60, []], []);
  r = Moves.useMove(env, "MIRROR_MOVE");
  check(
    "and says so when there is nothing to copy",
    r.failed === true && r.messages.join(" ").indexOf("MIRROR MOVE") >= 0,
    JSON.stringify(r.messages)
  );

  // --- Metronome ---
  const picks = {};
  let selfPicks = 0;
  // One stream across all 3000 uses: reseeding per iteration would correlate the
  // first draw and the picks would bunch.
  const metronomeRandom = seeded(6162);
  for (let i = 0; i < 3000; i++) {
    const e = fight(["CLEFAIRY", 30, ["METRONOME"]], ["CHANSEY", 90, []], []);
    e.random = metronomeRandom;
    const res = Moves.useMove(e, "METRONOME");
    picks[res.move] = (picks[res.move] || 0) + 1;
    if (res.move === "METRONOME" || res.move === "STRUGGLE") selfPicks++;
  }
  const distinct = Object.keys(picks).length;
  note("  METRONOME over 3000 uses picked " + distinct + " distinct moves");
  check("METRONOME never picks itself or STRUGGLE", selfPicks === 0, String(selfPicks));
  check(
    "and reaches most of the move list",
    distinct > 140 && Object.keys(picks).every((id) => !!bundle.moves[id]),
    String(distinct)
  );

  // --- Transform ---
  env = fight(["DITTO", 30, ["TRANSFORM"]], ["CHANSEY", 40, ["TACKLE", "SING"]], []);
  const ownHp = env.user.maxHp;
  const ownStatsHp = env.user.stats.hp;
  env.target.stages.attack = 2;
  r = Moves.useMove(env, "TRANSFORM");
  check(
    "TRANSFORM copies the target's stats, types and stat mods but not its HP",
    env.user.stats.attack === env.target.stats.attack &&
      env.user.stats.special === env.target.stats.special &&
      env.user.maxHp === ownHp && env.user.stats.hp === ownStatsHp &&
      env.user.types.join(",") === env.target.types.join(",") &&
      env.user.stages.attack === 2,
    "atk " + env.user.stats.attack + "/" + env.target.stats.attack +
      " hp " + env.user.maxHp + "/" + ownHp
  );
  check(
    "and takes its moves at five PP each",
    env.user.moves.length === env.target.moves.length &&
      env.user.moves[0].id === env.target.moves[0].id &&
      env.user.moves[0].pp === 5 && env.user.moves[0].maxPp === 5 &&
      env.user.volatile.transformed === true,
    JSON.stringify(env.user.moves.slice(0, 2))
  );
}

// ---------------------------------------------------------------------------
// 9. The rest of the special cases
// ---------------------------------------------------------------------------

function suiteOthers() {
  note("\n== The rest ==");

  // GEN1 BUG: a heal fails when the low byte of the HP shortfall is $FF.
  let env = fight(["CHANSEY", 60, ["SOFTBOILED"]], ["TAUROS", 40, []], []);
  env.user.hp = env.user.maxHp - 255;
  let r = Moves.useMove(env, "SOFTBOILED");
  check(
    "GEN1 BUG: SOFTBOILED refuses when exactly 255 HP are missing",
    r.failed === true && env.user.hp === env.user.maxHp - 255,
    "missing 255, hp " + env.user.hp
  );
  env = fight(["CHANSEY", 60, ["SOFTBOILED"]], ["TAUROS", 40, []], []);
  env.user.hp = env.user.maxHp - 254;
  r = Moves.useMove(env, "SOFTBOILED");
  check(
    "and heals half of max HP when 254 are",
    r.failed === false &&
      env.user.hp === Math.min(env.user.maxHp,
                               env.user.maxHp - 254 + Math.trunc(env.user.maxHp / 2)),
    "hp " + env.user.hp + "/" + env.user.maxHp
  );

  // Rest: full HP, asleep for two turns.
  env = fight(["SNORLAX", 40, ["REST"]], ["TAUROS", 40, []], []);
  env.user.hp = 1;
  env.user.status = Types.STATUS_POISON;
  r = Moves.useMove(env, "REST");
  check(
    "REST fills the bar and puts the user to sleep for two turns",
    env.user.hp === env.user.maxHp && env.user.status === Types.STATUS_SLEEP &&
      env.user.sleepTurns === 2,
    env.user.hp + "/" + env.user.maxHp + " " + env.user.status + " " + env.user.sleepTurns
  );

  // Explosion: the user dies, and the target's Defense is halved first.
  env = fight(["ELECTRODE", 40, ["SELFDESTRUCT"]], ["CHANSEY", 80, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  r = Moves.useMove(env, "SELFDESTRUCT");
  const boomDamage = r.damage;
  check("SELFDESTRUCT knocks its own user out", env.user.hp === 0 &&
        r.userFainted === true);
  // The same hit with the Defense halved by hand, straight through Damage.ts.
  const control = fight(["ELECTRODE", 40, ["SELFDESTRUCT"]], ["CHANSEY", 80, []], []);
  const halved = Stats.cloneMon(control.target);
  halved.battleStats.defense = Math.max(1, Math.trunc(halved.battleStats.defense / 2));
  const expected = Damage.computeDamage(bundle, control.user, halved,
    bundle.moves.SELFDESTRUCT,
    { critical: false, screened: false, roll: 255, power: 0, type: "" });
  check(
    "and halves the target's Defense before the formula runs",
    boomDamage === expected.damage && control.target.battleStats.defense <= 255,
    boomDamage + " vs " + expected.damage
  );

  // Reflect and Light Screen double the right defence, and a critical ignores both.
  env = fight(["TAUROS", 40, ["TACKLE"]], ["CHANSEY", 80, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  const plain = Moves.useMove(env, "TACKLE").damage;
  env = fight(["TAUROS", 40, ["TACKLE"]], ["CHANSEY", 80, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  env.target.volatile.reflect = true;
  const behindReflect = Moves.useMove(env, "TACKLE").damage;
  check("REFLECT roughly halves a physical hit", behindReflect < plain &&
        behindReflect > 0, plain + " -> " + behindReflect);
  env = fight(["TAUROS", 40, ["TACKLE"]], ["CHANSEY", 80, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  env.target.volatile.lightScreen = true;
  check("and LIGHT SCREEN does nothing to it",
        Moves.useMove(env, "TACKLE").damage === plain);

  // Leech Seed lands through a Substitute and never on a Grass type.
  env = fight(["BULBASAUR", 30, ["LEECH_SEED"]], ["CHANSEY", 40, []], [HIT]);
  env.target.volatile.substituteHp = 50;
  Moves.useMove(env, "LEECH_SEED");
  check("LEECH_SEED seeds through a SUBSTITUTE", env.target.volatile.seeded === true);
  env = fight(["BULBASAUR", 30, ["LEECH_SEED"]], ["ODDISH", 40, []], [HIT]);
  r = Moves.useMove(env, "LEECH_SEED");
  check("and never a GRASS type", env.target.volatile.seeded === false &&
        r.failed === true);

  // Haze wipes both sides' stages and the opponent's status.
  env = fight(["KOFFING", 40, ["HAZE"]], ["TAUROS", 40, []], []);
  env.user.stages.attack = 3;
  env.target.stages.defense = -2;
  env.target.status = Types.STATUS_BURN;
  env.user.volatile.focusEnergy = true;
  env.target.volatile.seeded = true;
  r = Moves.useMove(env, "HAZE");
  check(
    "HAZE clears both sides' stages and the opponent's status",
    env.user.stages.attack === 0 && env.target.stages.defense === 0 &&
      env.target.status === Types.STATUS_NONE &&
      env.user.volatile.focusEnergy === false && env.target.volatile.seeded === false,
    JSON.stringify(env.user.stages) + " " + env.target.status
  );

  // Disable picks a slot with PP left and runs 1..8 turns.
  env = fight(["DROWZEE", 30, ["DISABLE"]], ["CHANSEY", 40, ["TACKLE", "SING"]], [HIT]);
  r = Moves.useMove(env, "DISABLE");
  check(
    "DISABLE picks a real slot and a 1..8 turn counter",
    env.target.volatile.disabledSlot >= 0 && env.target.volatile.disabledSlot < 2 &&
      env.target.volatile.disabledTurns >= 1 && env.target.volatile.disabledTurns <= 8,
    "slot " + env.target.volatile.disabledSlot + " turns " +
      env.target.volatile.disabledTurns
  );

  // Rage builds Attack on every hit taken.
  env = fight(["CHARMANDER", 30, ["RAGE"]], ["CHANSEY", 60, ["TACKLE"]],
              [HIT, NO_CRIT, MAX_ROLL]);
  Moves.useMove(env, "RAGE");
  check("RAGE arms the user", env.user.volatile.rageActive === true);
  const back = envFor(env.target, env.user, scripted([HIT, NO_CRIT, MAX_ROLL]));
  back.userSide = env.targetSide;
  back.targetSide = env.userSide;
  Moves.useMove(back, "TACKLE");
  check("and a hit taken while it is armed raises Attack a stage",
        env.user.stages.attack === 1, String(env.user.stages.attack));

  // Bide stores what it takes and gives back double.
  env = fight(["POLIWRATH", 40, ["BIDE"]], ["CHANSEY", 80, ["TACKLE"]], [0]);
  Moves.useMove(env, "BIDE");
  check("BIDE starts a 2..3 turn store", env.user.volatile.bideTurns >= 2 &&
        env.user.volatile.bideTurns <= 3, String(env.user.volatile.bideTurns));
  env.user.volatile.bideDamage = 37;
  env.user.volatile.bideTurns = 1;
  const hpBefore = env.target.hp;
  r = Moves.continueBide(env);
  check(
    "and releases twice everything it soaked",
    r.damage === 74 && env.target.hp === hpBefore - 74 &&
      r.messages.join(" ").indexOf("unleashed") >= 0,
    r.damage + ", hp " + hpBefore + " -> " + env.target.hp
  );

  // Teleport ends a wild battle and fails in a trainer one.
  env = fight(["ABRA", 30, ["TELEPORT"]], ["CHANSEY", 20, []], [], 1);
  r = Moves.useMove(env, "TELEPORT");
  check("TELEPORT ends a wild battle when the user is the higher level",
        env.battleEnded === true, JSON.stringify(r.messages));
  env = fight(["ABRA", 30, ["TELEPORT"]], ["CHANSEY", 20, []], []);
  env.isWild = false;
  r = Moves.useMove(env, "TELEPORT");
  check("and simply fails in a trainer battle", env.battleEnded === false &&
        r.failed === true);

  // Pay Day scatters twice the user's level in coins.
  env = fight(["MEOWTH", 25, ["PAY_DAY"]], ["CHANSEY", 60, []],
              [HIT, NO_CRIT, MAX_ROLL]);
  Moves.useMove(env, "PAY_DAY");
  check("PAY_DAY scatters twice the user's level", env.payDay === 50, String(env.payDay));

  // Conversion copies the target's types.
  env = fight(["PORYGON", 30, ["CONVERSION"]], ["GENGAR", 30, []], []);
  Moves.useMove(env, "CONVERSION");
  check("CONVERSION takes the target's types", env.user.types.join(",") === "GHOST,POISON",
        env.user.types.join(","));

  // Thrash locks the user in for three or four attacks, then confuses it.
  env = fight(["TAUROS", 40, ["THRASH"]], ["CHANSEY", 200, []], []);
  env.random = seeded(8080);
  let attacks = 0;
  for (let i = 0; i < 8; i++) {
    Moves.useMove(env, "THRASH");
    attacks++;
    if (env.user.volatile.confusionTurns > 0) break;
  }
  check(
    "THRASH runs three or four attacks and ends in confusion",
    (attacks === 3 || attacks === 4) && env.user.volatile.confusionTurns >= 2 &&
      env.user.volatile.confusionTurns <= 5,
    attacks + " attacks, confusion " + env.user.volatile.confusionTurns
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function runAll() {
  passed = 0;
  failed = 0;
  lines.length = 0;
  suiteContract();
  suiteStages();
  suiteStatus();
  suiteSideRates();
  suiteMultiHit();
  suiteRecoilDrain();
  suiteCharge();
  suiteFixed();
  suiteNamedMoves();
  suiteOthers();
}

if (!selftest) {
  runAll();
  flush();
  console.log("\nBATTLE-MOVES  " + passed + " PASS  " + failed + " FAIL  " +
              (failed === 0 ? "OK" : "FAILED"));
  process.exit(failed === 0 ? 0 : 1);
} else {
  const MUTATIONS = [
    ["recoil-third", "recoil is expected to be a third of the damage"],
    ["drain-third", "drain is expected to return a third"],
    ["sub-cost-third", "a SUBSTITUTE is expected to cost a third of max HP"],
    ["multihit-even", "the 2-5 hit count is expected to be uniform"],
    ["trap-1to3", "WRAP is expected to lock in for 1-3 more hits"],
    ["sleep-1to6", "sleep is expected to last 1-6 turns"],
    ["counter-triple", "COUNTER is expected to return three times the damage"],
    ["fixed-half-level", "SEISMIC_TOSS is expected to deal half the user's level"],
    ["ohko-slower-wins", "an OHKO from a slower user is expected to land"],
    ["hyperbeam-always", "HYPER_BEAM is expected to recharge even on a KO"],
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
  console.log("\nBATTLE-MOVES SELFTEST  " +
              (ok ? "OK -- the gate discriminates" : "FAILED"));
  process.exit(ok ? 0 : 1);
}
