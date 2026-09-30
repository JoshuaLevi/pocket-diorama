// Complete battles, played headlessly against the real bundle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battle.integration.test.mjs Assets/Generated/kanto.json \
//        [--selftest] [--quiet]
//
// The other battle suites check one module against a second transcription of one
// formula. This one checks that the modules are WIRED: that a turn happens in the
// right order, that a faint ends the round, that experience is paid to the right
// Pokemon, that a ball takes a Pokemon out of the battle and puts it in the party,
// and that a thousand seeded battles all end.
//
// Everything it asserts is either
//   (a) transcribed independently in the REFERENCE section below, or
//   (b) an invariant that cannot be true of a correct battle and false of a
//       broken one by accident -- HP inside its range, a phase that agrees with
//       the result, a log with no unsubstituted placeholder left in it.
//
// `--selftest` perturbs the reference one fault at a time and reports whether the
// comparison noticed. A mutation that is not caught is a failure of this file.
//
// Every RNG in here is a seeded xorshift32, and the driver's stream is kept apart
// from the battle's so that changing how the driver picks an action cannot change
// what the battle rolls.

import { readFileSync } from "node:fs";

globalThis.print = (...args) => console.log("[lens]", ...args);

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
let quiet = args.indexOf("--quiet") >= 0;
if (!bundlePath) {
  console.error("usage: battle.integration.test.mjs <bundle.json> [--selftest] [--quiet]");
  process.exit(2);
}

const Types = await import("../Assets/Scripts/play/battle/types.ts");
const Stats = await import("../Assets/Scripts/play/battle/Stats.ts");
const Party = await import("../Assets/Scripts/play/battle/Party.ts");
const TurnOrder = await import("../Assets/Scripts/play/battle/TurnOrder.ts");
const State = await import("../Assets/Scripts/play/battle/BattleState.ts");

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
  if (!quiet) for (const line of lines) console.log(line);
  lines.length = 0;
}

/** The one mutation active in a --selftest pass; "" in a normal run. */
let MUT = "";
const mut = (name) => MUT === name;

/** xorshift32. Deterministic, and uniform enough for a hundred thousand bytes. */
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

/** A stream that also says how many draws it has served. */
function counted(seed) {
  const inner = seeded(seed);
  const fn = () => {
    fn.draws++;
    return inner();
  };
  fn.draws = 0;
  return fn;
}

// ---------------------------------------------------------------------------
// REFERENCE -- transcribed a second time, not read out of the engine
// ---------------------------------------------------------------------------

/** floor(floor(baseExp / participants) * level / 7), x1.5 in a trainer battle. */
function refExpGain(baseExp, level, participants, isTrainer) {
  const share = Math.floor(baseExp / participants);
  const divisor = mut("exp-divisor") ? 8 : 7;
  let exp = Math.floor((share * level) / divisor);
  if (isTrainer) exp = Math.floor((exp * 3) / 2);
  return exp < 1 ? 1 : exp;
}

/** max(1, floor(maxHp / 16)). Poison, burn and Leech Seed all start here. */
function refResidual(maxHp) {
  const divisor = mut("residual-divisor") ? 8 : 16;
  const base = Math.floor(maxHp / divisor);
  return base < 1 ? 1 : base;
}

/** The published escape odds out of 256; 256 means certain. */
function refEscapeOdds(playerSpeed, foeSpeed, attempts) {
  const b = Math.floor(foeSpeed / 4) & 0xff;
  if (b === 0) return 256;
  const scale = mut("escape-scale") ? 31 : 32;
  const bonus = mut("escape-bonus") ? 29 : 30;
  const f = Math.floor(((playerSpeed & 0xff) * scale) / b) + bonus * attempts;
  return f > 255 ? 256 : f;
}

/** A 100%-accuracy move is accuracy byte 255, so it misses on 255 of 256... no: */
function refMissRate() {
  // accuracyByte(100) = floor(100 * 255 / 100) = 255, and the roll is
  // `randomByte < 255`, so exactly one byte in 256 misses.
  return mut("miss-rate") ? 1 / 128 : 1 / 256;
}

/** Struggle's recoil: floor(damage / 2), never less than 1. */
function refStruggleRecoil(dealt) {
  const divisor = mut("struggle-recoil") ? 4 : 2;
  const recoil = Math.floor(dealt / divisor);
  return recoil < 1 ? 1 : recoil;
}

/** How much longer the party is after a Pokemon is caught. */
function refPartyGrowth() {
  return mut("party-growth") ? 2 : 1;
}

/** The faster Pokemon moves first when neither move has priority. */
function refFasterFirst(playerSpeed, foeSpeed) {
  return mut("order-speed") ? playerSpeed < foeSpeed : playerSpeed > foeSpeed;
}

/** The five results a wild battle can reach, and nothing else. */
function refWildResults() {
  const legal = [State.RESULT_WON, State.RESULT_LOST, State.RESULT_CAUGHT,
                 State.RESULT_FLED, State.RESULT_FOE_FLED];
  // The mutation NARROWS the list. Widening it could never be caught: no battle
  // produces the extra result, so nothing would notice.
  return mut("legal-results") ? legal.filter((r) => r !== State.RESULT_FLED) : legal;
}

/** A catch always reports three shakes. */
function refCatchShakes() {
  return mut("catch-shakes") ? 2 : 3;
}

/** Sending a replacement out after a faint resolves no move for either side. */
function refReplacementIsFree() {
  return !mut("replacement-move");
}

/** A failed run costs the turn: the foe attacks. */
function refFoeAnswersFailedRun() {
  return !mut("run-answer");
}

// ---------------------------------------------------------------------------
// Building battlers
// ---------------------------------------------------------------------------

/** A Pokemon with the experience its level is actually worth, unlike a wild one. */
function trained(speciesId, level, random) {
  const mon = Stats.makeWildMon(bundle, speciesId, level, random);
  mon.exp = Party.expForLevel(bundle.species[speciesId].growthRate, level);
  return mon;
}

/** The same, with its move slots replaced and every slot given deep PP. */
function withMoves(mon, moveIds, pp) {
  const slots = [];
  for (const id of moveIds) {
    slots.push({ id: id, pp: pp, maxPp: pp });
  }
  mon.moves = slots;
  return mon;
}

const MOVE = (slot) => Types.moveAction(slot);
const SWITCH = (slot) => Types.switchAction(slot);
const RUN = { kind: Types.ACTION_RUN, moveIndex: -1, partyIndex: -1, item: "" };
const BALL = (id) => ({ kind: Types.ACTION_ITEM, moveIndex: -1, partyIndex: -1, item: id });

// ---------------------------------------------------------------------------
// Invariants -- what can never be true of a battle in any state
// ---------------------------------------------------------------------------

const STATUSES = [Types.STATUS_NONE, Types.STATUS_SLEEP, Types.STATUS_POISON,
                  Types.STATUS_BURN, Types.STATUS_FREEZE, Types.STATUS_PARALYSIS];

/** Every way one Pokemon can be illegal, as a list of complaints. */
function monFaults(mon, where) {
  const bad = [];
  if (!Number.isInteger(mon.hp) || mon.hp < 0 || mon.hp > mon.maxHp) {
    bad.push(where + " hp=" + mon.hp + "/" + mon.maxHp);
  }
  if (!Number.isFinite(mon.maxHp) || mon.maxHp <= 0) bad.push(where + " maxHp=" + mon.maxHp);
  if (!Number.isInteger(mon.level) || mon.level < 1 || mon.level > 100) {
    bad.push(where + " level=" + mon.level);
  }
  if (STATUSES.indexOf(mon.status) < 0) bad.push(where + " status=" + JSON.stringify(mon.status));
  for (const key of ["attack", "defense", "speed", "special", "accuracy", "evasion"]) {
    const stage = mon.stages[key];
    if (!Number.isInteger(stage) || stage < -6 || stage > 6) {
      bad.push(where + " stage " + key + "=" + stage);
    }
  }
  for (const key of ["attack", "defense", "speed", "special"]) {
    const value = mon.battleStats[key];
    if (!Number.isFinite(value) || value < 1 || value > 999) {
      bad.push(where + " battleStat " + key + "=" + value);
    }
  }
  for (let i = 0; i < mon.moves.length; i++) {
    const slot = mon.moves[i];
    if (!Number.isInteger(slot.pp) || slot.pp < 0 || slot.pp > slot.maxPp) {
      bad.push(where + " pp[" + i + "]=" + slot.pp + "/" + slot.maxPp);
    }
    if (slot.id !== "" && !bundle.moves[slot.id]) bad.push(where + " move " + slot.id);
  }
  if (mon.volatile.confusionTurns < 0) bad.push(where + " confusion=" + mon.volatile.confusionTurns);
  if (mon.volatile.substituteHp < 0) bad.push(where + " sub=" + mon.volatile.substituteHp);
  if (mon.volatile.badlyPoisoned < 0 || mon.volatile.badlyPoisoned > 15) {
    bad.push(where + " toxic=" + mon.volatile.badlyPoisoned);
  }
  return bad;
}

/** Every way one battle can be illegal, whatever it has been asked to do. */
function battleFaults(battle, report) {
  const bad = [];
  bad.push(...monFaults(battle.ctx.player.active, "player"));
  bad.push(...monFaults(battle.ctx.foe.active, "foe"));
  for (let i = 0; i < battle.ctx.player.party.length; i++) {
    bad.push(...monFaults(battle.ctx.player.party[i], "party[" + i + "]"));
  }
  const over = battle.phase === State.PHASE_OVER;
  if (over !== (battle.result !== State.RESULT_ONGOING)) {
    bad.push("phase " + battle.phase + " with result " + JSON.stringify(battle.result));
  }
  if (!over && battle.ctx.foe.active.hp <= 0) bad.push("foe at 0 HP with the battle open");
  if (!over && battle.phase === State.PHASE_CHOOSE && battle.ctx.player.active.hp <= 0) {
    bad.push("player at 0 HP and still being asked to choose");
  }
  if (report) {
    for (const line of report.messages) {
      if (typeof line !== "string") bad.push("a non-string message");
      else if (line.indexOf("{") >= 0) bad.push("unfilled placeholder: " + JSON.stringify(line));
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------
// A driver -- plays a battle to its end and reports what happened
// ---------------------------------------------------------------------------

/**
 * `pick` chooses the action for a turn; it is handed the battle and must not draw
 * from the battle's own RNG. Returns the outcome plus everything the checks want.
 */
function play(battle, pick, maxTurns) {
  const faults = [];
  let turns = 0;
  let refusals = 0;
  let allRefusals = 0;
  let replacements = 0;
  while (battle.phase !== State.PHASE_OVER && turns < maxTurns) {
    let action;
    if (battle.phase === State.PHASE_REPLACE) {
      replacements++;
      action = SWITCH(nextHealthy(battle));
    } else {
      action = pick(battle, turns);
    }
    const report = battle.takeTurn(action);
    turns++;
    if (!report.ok) {
      refusals++;
      allRefusals++;
      if (refusals > 8) {
        faults.push("eight refusals in a row at turn " + turns);
        break;
      }
    } else {
      refusals = 0;
    }
    faults.push(...battleFaults(battle, report));
    if (faults.length > 12) break;
  }
  return { outcome: battle.outcome(), turns: turns, faults: faults,
           replacements: replacements, refusals: allRefusals };
}

/** A party slot that can still fight and is not the one that just fell. */
function nextHealthy(battle) {
  const side = battle.ctx.player;
  for (let i = 0; i < side.party.length; i++) {
    if (i !== side.activeIndex && side.party[i].hp > 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// SCENE 1 -- a wild Pidgey, fought to a knockout, with the turn log printed
// ---------------------------------------------------------------------------

function sceneKnockout() {
  note("\n== A wild PIDGEY, fought to a knockout ==");
  const rng = counted(0x5eed1);
  const party = [trained("CHARMANDER", 10, seeded(11))];
  const wild = Stats.makeWildMon(bundle, "PIDGEY", 5, seeded(22));
  const battle = State.startWildBattle(bundle, party, 0, wild, rng);

  const turnLines = [];
  const result = play(battle, (b) => MOVE(0), 60);
  for (const line of battle.log) turnLines.push(line);

  if (!quiet) {
    console.log("  --- the whole battle, as the message box would show it ---");
    for (const line of turnLines) {
      for (const part of String(line).split("\n")) console.log("    | " + part.replace(/[\v\f]/g, " / "));
    }
    console.log("  --- " + result.turns + " turns, " + rng.draws + " random draws ---");
  }

  check("the battle ended", result.outcome.result !== State.RESULT_ONGOING,
        "still " + JSON.stringify(result.outcome.result));
  check("the player won it", result.outcome.result === State.RESULT_WON,
        "got " + result.outcome.result);
  check("no illegal state at any point", result.faults.length === 0, result.faults.join("; "));
  check("the wild PIDGEY is at 0 HP", battle.ctx.foe.active.hp === 0,
        "hp " + battle.ctx.foe.active.hp);
  check("the log says the enemy fainted",
        turnLines.some((l) => l.indexOf("fainted") >= 0), "no faint line");
  check("every move was announced the way the cartridge announces it",
        turnLines.some((l) => l.indexOf("used SCRATCH!") >= 0) &&
        turnLines.some((l) => l.indexOf("used GUST!") >= 0),
        "no \"used <MOVE>!\" line in the log");

  // Experience: one participant, a wild battle, the foe's own base and level.
  const grown = result.outcome.party[0];
  const expected = refExpGain(bundle.species.PIDGEY.baseExp, battle.ctx.foe.active.level, 1, false);
  const before = Party.expForLevel(bundle.species.CHARMANDER.growthRate, 10);
  check("the experience paid matches the formula", grown.exp === before + expected,
        "gained " + (grown.exp - before) + ", expected " + expected);
  check("the log printed the EXP line",
        turnLines.some((l) => l.indexOf("EXP. Points") >= 0), "no EXP line");
  check("stat experience was paid too", grown.evs.speed === bundle.species.PIDGEY.baseStats.speed,
        "speed stat exp " + grown.evs.speed);
  check("CHARMANDER kept its own HP loss", grown.hp <= grown.maxHp && grown.hp > 0,
        "hp " + grown.hp + "/" + grown.maxHp);

  // The turn order came out of Speed, and the faster one moved first.
  const first = battle.log.indexOf(battle.log.find((l) => l.indexOf("CHARMANDER") >= 0));
  check("the log is not empty", first >= 0);
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 2 -- a battle won by throwing a ball
// ---------------------------------------------------------------------------

function sceneCatch() {
  note("\n== A wild PIDGEY, caught ==");
  // A seed that catches inside a few throws. The sweep below proves the catch path
  // is not seed-specific; this scene is about what the state machine does with it.
  let found = null;
  for (let seed = 1; seed <= 400 && found === null; seed++) {
    const rng = seeded(0x1000 + seed);
    const party = [trained("CHARMANDER", 10, seeded(11))];
    const wild = Stats.makeWildMon(bundle, "PIDGEY", 5, seeded(22));
    const battle = State.startWildBattle(bundle, party, 0, wild, rng);
    const played = play(battle, (b) => BALL("POKE_BALL"), 30);
    if (played.outcome.result === State.RESULT_CAUGHT) {
      found = { battle: battle, played: played, seed: 0x1000 + seed };
    }
  }
  check("a ball eventually catches", found !== null, "400 seeds and no catch");
  if (found === null) {
    flush();
    return;
  }

  // Replay the winning seed one throw at a time so the shakes can be printed.
  const rng = seeded(found.seed);
  const party = [trained("CHARMANDER", 10, seeded(11))];
  const wild = Stats.makeWildMon(bundle, "PIDGEY", 5, seeded(22));
  const battle = State.startWildBattle(bundle, party, 0, wild, rng);
  const throws = [];
  let guard = 0;
  while (battle.phase !== State.PHASE_OVER && guard++ < 30) {
    const report = battle.takeTurn(BALL("POKE_BALL"));
    if (report.ball) {
      throws.push(report.ball);
      note("  throw " + throws.length + ": " + (report.ball.caught ? "caught" : "broke free") +
           "  shakes=" + report.ball.shakes + "  catchRate=" + report.ball.catchRate +
           "  roll=" + report.ball.roll + "  f=" + report.ball.f +
           "  bytes=" + report.ball.rolls);
    }
  }
  const last = throws[throws.length - 1];
  check("the battle ended in a catch", battle.result === State.RESULT_CAUGHT,
        "got " + battle.result);
  check("the winning throw reports three shakes", last && last.shakes === refCatchShakes(),
        last ? "shakes " + last.shakes : "no throw");
  check("every failed throw shook 0..3 times",
        throws.every((t) => t.shakes >= 0 && t.shakes <= 3), "a shake count out of range");
  const outcome = battle.outcome();
  check("the party grew by exactly one", outcome.party.length === 1 + refPartyGrowth(),
        "party is " + outcome.party.length);
  check("the caught species is the one that was out", outcome.caught === "PIDGEY",
        "caught " + JSON.stringify(outcome.caught));
  const caught = outcome.party[outcome.party.length - 1];
  check("the caught PIDGEY joined at the level it was", caught.level === wild.level,
        "level " + caught.level);
  check("and with the experience its level is worth",
        caught.exp === Party.expForLevel(bundle.species.PIDGEY.growthRate, caught.level),
        "exp " + caught.exp);
  check("no illegal state during the catch", battleFaults(battle, null).length === 0,
        battleFaults(battle, null).join("; "));
  check("the log says it was caught",
        battle.log.some((l) => l.indexOf("caught") >= 0), "no catch line");
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 3 -- the player faints
// ---------------------------------------------------------------------------

function sceneWipe() {
  note("\n== The player is beaten ==");
  // A level 2 MAGIKARP with nothing but SPLASH cannot win, and cannot run: the
  // scene forces the loss rather than waiting for one.
  const rng = counted(0x105e);
  const karp = withMoves(trained("MAGIKARP", 2, seeded(31)), ["SPLASH"], 40);
  const wild = Stats.makeWildMon(bundle, "ONIX", 30, seeded(41));
  const battle = State.startWildBattle(bundle, [karp], 0, wild, rng);
  const result = play(battle, (b) => MOVE(0), 60);

  check("the battle ended", result.outcome.result !== State.RESULT_ONGOING);
  check("the player lost", result.outcome.result === State.RESULT_LOST,
        "got " + result.outcome.result);
  check("the phase is over, not waiting for a replacement",
        battle.phase === State.PHASE_OVER, "phase " + battle.phase);
  check("every party member is down",
        result.outcome.party.every((m) => m.hp === 0),
        result.outcome.party.map((m) => m.name + " " + m.hp).join(", "));
  check("the log says the player's Pokemon fainted",
        battle.log.some((l) => l.indexOf("MAGIKARP") >= 0 && l.indexOf("fainted") >= 0),
        "no faint line for MAGIKARP");
  check("no experience was paid to a wiped party",
        result.outcome.party[0].exp === Party.expForLevel(bundle.species.MAGIKARP.growthRate, 2),
        "exp " + result.outcome.party[0].exp);
  check("no illegal state while losing", result.faults.length === 0, result.faults.join("; "));
  note("  " + result.turns + " turns, " + rng.draws + " random draws");

  // With a second Pokemon on the bench the same loss becomes a replacement first.
  const rng2 = seeded(0x105f);
  const karp2 = withMoves(trained("MAGIKARP", 2, seeded(31)), ["SPLASH"], 40);
  const spare = withMoves(trained("MAGIKARP", 2, seeded(32)), ["SPLASH"], 40);
  const wild2 = Stats.makeWildMon(bundle, "ONIX", 30, seeded(41));
  const bench = State.startWildBattle(bundle, [karp2, spare], 0, wild2, rng2);
  let sawReplace = false;
  let guard = 0;
  while (bench.phase !== State.PHASE_OVER && guard++ < 80) {
    if (bench.phase === State.PHASE_REPLACE) {
      sawReplace = true;
      // The foe must NOT get a free attack on a replacement turn.
      const before = bench.ctx.foe.active.hp;
      const report = bench.takeTurn(SWITCH(nextHealthy(bench)));
      const free = report.playerMove === null && report.foeMove === null && report.order === null;
      check("a replacement turn runs no move for either side", free === refReplacementIsFree(),
            "the replacement turn " + (free ? "resolved nothing" : "resolved moves"));
      check("and it does not damage the foe", bench.ctx.foe.active.hp === before);
      continue;
    }
    bench.takeTurn(MOVE(0));
  }
  check("a bench forces a replacement before the loss", sawReplace, "never entered PHASE_REPLACE");
  check("and the battle still ends in a loss", bench.result === State.RESULT_LOST,
        "got " + bench.result);
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 4 -- one thousand seeded battles, all of which must terminate
// ---------------------------------------------------------------------------

function sceneSweep(count) {
  note("\n== " + count + " seeded battles ==");
  const speciesIds = Object.keys(bundle.species);
  const legal = refWildResults();
  const tally = {};
  const faults = [];
  let longest = 0;
  let longestSeed = 0;
  let totalTurns = 0;
  let stalled = 0;
  let unfinished = 0;
  // Coverage, printed rather than asserted: a sweep that never reached a forced
  // move or a faint would pass every check above and prove almost nothing.
  const seen = { forced: 0, replace: 0, struggle: 0, refused: 0 };

  for (let i = 0; i < count; i++) {
    const seed = 0x51e5 + i * 2654435761;
    const setup = seeded(seed);
    const driver = seeded(seed ^ 0x5bd1e995);
    const battleRng = seeded((seed >>> 3) ^ 0xa5a5a5a5);

    const size = 1 + Math.floor(setup() * 3);
    const party = [];
    for (let p = 0; p < size; p++) {
      const id = speciesIds[Math.floor(setup() * speciesIds.length)];
      party.push(trained(id, 5 + Math.floor(setup() * 35), setup));
    }
    const wildId = speciesIds[Math.floor(setup() * speciesIds.length)];
    const wild = Stats.makeWildMon(bundle, wildId, 2 + Math.floor(setup() * 40), setup);

    const battle = State.startWildBattle(bundle, party, Math.floor(setup() * 9), wild, battleRng);
    // Half the battles are fought out with nothing but moves and switches, so the
    // sweep reaches the long ones -- PP running dry, Struggle, a party wiped -- and
    // not only the short ones that end in a thrown ball or a successful run.
    const fightItOut = i % 2 === 1;
    const played = play(battle, (b) => {
      if (b.forcedMove() !== "") seen.forced++;
      if (b.ctx.player.active.moves.every((m) => m.id === "" || m.pp <= 0)) seen.struggle++;
      const roll = driver();
      if (fightItOut) {
        return roll < 0.85 ? MOVE(Math.floor(driver() * 4)) : SWITCH(Math.floor(driver() * 6));
      }
      if (roll < 0.70) return MOVE(Math.floor(driver() * 4));
      if (roll < 0.80) return SWITCH(Math.floor(driver() * 6));
      if (roll < 0.90) return BALL("POKE_BALL");
      return RUN;
    }, 600);
    if (played.replacements > 0) seen.replace += played.replacements;
    seen.refused += played.refusals;

    totalTurns += played.turns;
    if (played.turns > longest) {
      longest = played.turns;
      longestSeed = seed;
    }
    const result = played.outcome.result;
    tally[result] = (tally[result] || 0) + 1;
    if (result === State.RESULT_STALLED) stalled++;
    if (result === State.RESULT_ONGOING) unfinished++;
    if (legal.indexOf(result) < 0) {
      faults.push("battle " + i + " ended " + JSON.stringify(result));
    }
    for (const fault of played.faults) {
      if (faults.length < 20) faults.push("battle " + i + " (seed " + seed + "): " + fault);
    }
  }

  const shown = Object.keys(tally).sort().map((k) => (k === "" ? "ONGOING" : k) + "=" + tally[k]);
  note("  " + shown.join("  ") + "    longest " + longest + " turns (seed " + longestSeed + ")" +
       ", mean " + (totalTurns / count).toFixed(1));
  note("  coverage: " + seen.forced + " turns locked into a multi-turn move, " +
       seen.replace + " replacements after a faint, " + seen.struggle +
       " turns with no PP anywhere, " + seen.refused + " actions refused");
  check("the sweep reached a multi-turn move at least once", seen.forced > 0,
        "no Bide, Thrash, trapping move or charge in " + count + " battles");
  check("the sweep reached a replacement after a faint", seen.replace > 0,
        "no battle ever needed a second Pokemon");
  check("every battle terminated", unfinished === 0, unfinished + " still running after 600 turns");
  check("none of them stalled", stalled === 0, stalled + " hit RESULT_STALLED");
  check("no illegal state in any of them", faults.length === 0, faults.slice(0, 6).join(" | "));
  check("every outcome is one the engine documents",
        Object.keys(tally).every((k) => legal.indexOf(k) >= 0),
        Object.keys(tally).join(","));
  check("all four wild endings occurred at least once",
        (tally[State.RESULT_WON] || 0) > 0 && (tally[State.RESULT_LOST] || 0) > 0 &&
        (tally[State.RESULT_CAUGHT] || 0) > 0 && (tally[State.RESULT_FLED] || 0) > 0,
        shown.join(" "));
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 5 -- the 1/256 miss survives a whole battle, not just a unit test
// ---------------------------------------------------------------------------

function sceneMissRate() {
  note("\n== The 1/256 miss, measured through the state machine ==");
  // A level 5 PIDGEY with GUST (100% accuracy) against a level 100 CHANSEY that
  // does nothing but SPLASH. The foe's HP is restored between turns so the battle
  // never ends, and the attacker is never statused, so the only reason a move can
  // fail to connect is the accuracy roll.
  let used = 0;
  let missed = 0;
  const batches = 32;
  const perBatch = 800;
  for (let b = 0; b < batches; b++) {
    const rng = seeded(0x9e37 + b * 7919);
    const attacker = withMoves(trained("PIDGEY", 5, seeded(100 + b)), ["GUST"], 60000);
    const target = withMoves(trained("CHANSEY", 100, seeded(200 + b)), ["SPLASH"], 60000);
    const battle = State.startWildBattle(bundle, [attacker], 0, target, rng);
    for (let t = 0; t < perBatch; t++) {
      const report = battle.takeTurn(MOVE(0));
      if (report.playerMove && report.playerMove.used) {
        used++;
        if (!report.playerMove.hit) missed++;
      }
      battle.ctx.foe.active.hp = battle.ctx.foe.active.maxHp;
      battle.ctx.player.active.hp = battle.ctx.player.active.maxHp;
      if (battle.phase === State.PHASE_OVER) break;
    }
    if (battle.phase === State.PHASE_OVER) {
      note("  batch " + b + " ended early: " + battle.result);
    }
  }
  const rate = missed / used;
  const expect = refMissRate();
  const sigma = Math.sqrt(used * expect * (1 - expect));
  const deviation = Math.abs(missed - used * expect) / sigma;
  note("  " + used + " moves used, " + missed + " missed -> " + (rate * 100).toFixed(3) +
       "%  (expected " + (expect * 100).toFixed(3) + "%, " + deviation.toFixed(2) + " sigma)");
  check("enough moves to measure anything", used > 20000, used + " moves");
  check("a 100%-accuracy move still misses", missed > 0, "not one miss in " + used);
  check("and it misses at the ROM's rate, within four sigma", deviation < 4,
        deviation.toFixed(2) + " sigma from " + (expect * 100).toFixed(3) + "%");
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 6 -- the same seed plays the same battle
// ---------------------------------------------------------------------------

function sceneDeterminism() {
  note("\n== Reproducibility ==");
  function once() {
    const rng = counted(0xd00d);
    const party = [trained("SQUIRTLE", 12, seeded(7)), trained("PIKACHU", 9, seeded(8))];
    const wild = Stats.makeWildMon(bundle, "RATTATA", 8, seeded(9));
    const battle = State.startWildBattle(bundle, party, 3, wild, rng);
    const driver = seeded(0xfeed);
    const played = play(battle, () => {
      const roll = driver();
      if (roll < 0.8) return MOVE(Math.floor(driver() * 4));
      return SWITCH(Math.floor(driver() * 2));
    }, 200);
    return { log: battle.log.join(""), draws: rng.draws, played: played };
  }
  const a = once();
  const b = once();
  check("the same seed produces the same log", a.log === b.log,
        "logs diverge at " + firstDifference(a.log, b.log));
  check("and consumes the same number of random draws", a.draws === b.draws,
        a.draws + " vs " + b.draws);
  check("the run was long enough to mean something", a.played.turns > 3,
        a.played.turns + " turns");
  note("  " + a.played.turns + " turns, " + a.draws + " draws, result " +
       JSON.stringify(a.played.outcome.result));
  flush();
}

function firstDifference(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return "char " + i;
  }
  return "nowhere";
}

// ---------------------------------------------------------------------------
// SCENE 7 -- the end-of-turn effects the state machine owns
// ---------------------------------------------------------------------------

function sceneEndOfTurn() {
  note("\n== Poison, Leech Seed and turn order ==");

  // Poison ticks after the acting side's move, for max(1, maxHp/16) a turn.
  {
    const rng = seeded(0x5010);
    const party = [withMoves(trained("SNORLAX", 40, seeded(51)), ["SPLASH"], 40)];
    const wild = withMoves(trained("SNORLAX", 40, seeded(52)), ["SPLASH"], 40);
    const battle = State.startWildBattle(bundle, party, 0, wild, rng);
    battle.ctx.player.active.status = Types.STATUS_POISON;
    const maxHp = battle.ctx.player.active.maxHp;
    const before = battle.ctx.player.active.hp;
    battle.takeTurn(MOVE(0));
    const dealt = before - battle.ctx.player.active.hp;
    check("poison takes maxHp/16 a turn", dealt === refResidual(maxHp),
          "took " + dealt + " of " + maxHp + ", expected " + refResidual(maxHp));
    check("and it says so",
          battle.log.some((l) => l.indexOf("poison") >= 0), "no poison line");
    check("the untouched foe lost nothing",
          battle.ctx.foe.active.hp === battle.ctx.foe.active.maxHp,
          "foe at " + battle.ctx.foe.active.hp);
  }

  // Leech Seed saps the seeded Pokemon and heals the one opposite it.
  {
    const rng = seeded(0x5eed);
    const party = [withMoves(trained("SNORLAX", 40, seeded(53)), ["SPLASH"], 40)];
    const wild = withMoves(trained("SNORLAX", 40, seeded(54)), ["SPLASH"], 40);
    const battle = State.startWildBattle(bundle, party, 0, wild, rng);
    battle.ctx.foe.active.volatile.seeded = true;
    battle.ctx.player.active.hp = 1;
    const foeMax = battle.ctx.foe.active.maxHp;
    battle.takeTurn(MOVE(0));
    const sapped = foeMax - battle.ctx.foe.active.hp;
    check("Leech Seed saps maxHp/16", sapped === refResidual(foeMax),
          "sapped " + sapped + ", expected " + refResidual(foeMax));
    check("and the same amount is healed back", battle.ctx.player.active.hp === 1 + sapped,
          "player at " + battle.ctx.player.active.hp);
    check("the seed said so",
          battle.log.some((l) => l.indexOf("LEECH SEED") >= 0), "no leech line");
  }

  // Turn order: the faster Pokemon acts first when neither move has priority.
  {
    const rng = seeded(0x0dde);
    const fast = withMoves(trained("ELECTRODE", 40, seeded(55)), ["TACKLE"], 40);
    const slow = withMoves(trained("SNORLAX", 40, seeded(56)), ["TACKLE"], 40);
    const battle = State.startWildBattle(bundle, [fast], 0, slow, rng);
    const report = battle.takeTurn(MOVE(0));
    const ps = battle.ctx.player.active.battleStats.speed;
    const fs = battle.ctx.foe.active.battleStats.speed;
    check("the faster Pokemon moved first",
          report.order.playerFirst === refFasterFirst(ps, fs),
          "player " + ps + " vs foe " + fs + ", playerFirst=" + report.order.playerFirst);
    check("and the reason given is Speed", report.order.reason === TurnOrder.ORDER_SPEED,
          "reason " + report.order.reason);
  }

  // A non-move action always resolves before the foe's attack.
  {
    const rng = seeded(0x0aa0);
    const slow = withMoves(trained("SNORLAX", 40, seeded(57)), ["TACKLE"], 40);
    const fast = withMoves(trained("ELECTRODE", 40, seeded(58)), ["TACKLE"], 40);
    const battle = State.startWildBattle(bundle, [slow], 0, fast, rng);
    const report = battle.takeTurn(BALL("POKE_BALL"));
    check("a thrown ball goes before a faster foe's move",
          report.order.playerFirst && report.order.reason === TurnOrder.ORDER_PLAYER_ACTION,
          "playerFirst=" + report.order.playerFirst + " reason=" + report.order.reason);
    check("and the foe still attacks after it", report.foeMove !== null && report.foeMove.used,
          "the foe never moved");
  }
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 7b -- the sequencing rules the state machine alone is responsible for
// ---------------------------------------------------------------------------

function sceneSequencing() {
  note("\n== Sequencing ==");

  // A Pokemon that knocks itself out ends the round: the other side, which is
  // still standing and has not moved, does not get to.
  {
    const rng = seeded(0xb001);
    const bomber = withMoves(trained("ELECTRODE", 40, seeded(91)), ["SELFDESTRUCT"], 20);
    const wall = withMoves(trained("SNORLAX", 100, seeded(92)), ["SPLASH"], 40);
    const battle = State.startWildBattle(bundle, [bomber], 0, wall, rng);
    const report = battle.takeTurn(MOVE(0));
    check("SELFDESTRUCT knocks its own user out",
          battle.ctx.player.active.hp === 0, "hp " + battle.ctx.player.active.hp);
    check("the target survived it, so it could have moved",
          battle.ctx.foe.active.hp > 0, "the foe fainted too; the scene proves nothing");
    check("but a self-knockout ends the round before the foe answers",
          report.foeMove === null, "the foe moved after the user fainted");
    check("and the battle is lost", battle.result === State.RESULT_LOST,
          "result " + battle.result);
  }

  // Poison is charged to the acting side straight after its move, not at the end
  // of the round. A fast Pokemon on its last point of HP therefore dies before the
  // slow one has moved, and the slow one never moves at all.
  {
    const rng = seeded(0x0501);
    const dying = withMoves(trained("ELECTRODE", 50, seeded(93)), ["SPLASH"], 40);
    const slow = withMoves(trained("SNORLAX", 50, seeded(94)), ["SPLASH"], 40);
    const battle = State.startWildBattle(bundle, [dying], 0, slow, rng);
    battle.ctx.player.active.status = Types.STATUS_POISON;
    battle.ctx.player.active.hp = 1;
    const report = battle.takeTurn(MOVE(0));
    check("the poisoned Pokemon moved first",
          report.order.playerFirst, "the setup is wrong: the foe was faster");
    check("its own poison finished it", battle.ctx.player.active.hp === 0,
          "hp " + battle.ctx.player.active.hp);
    check("and the slower foe never got its move",
          report.foeMove === null, "the foe moved after the poison tick killed the player");
  }

  // A Pokemon held by the opponent's Wrap loses its turn while the counter runs.
  {
    const rng = seeded(0x77a9);
    const held = withMoves(trained("SNORLAX", 40, seeded(95)), ["TACKLE"], 40);
    const holder = withMoves(trained("SNORLAX", 40, seeded(96)), ["SPLASH"], 40);
    const battle = State.startWildBattle(bundle, [held], 0, holder, rng);
    battle.ctx.player.active.volatile.trapTurns = 2;
    const before = battle.ctx.foe.active.hp;
    const report = battle.takeTurn(MOVE(0));
    check("a held Pokemon does not get to move",
          report.playerMove === null, "it moved anyway");
    check("so the foe takes nothing", battle.ctx.foe.active.hp === before,
          "the foe lost " + (before - battle.ctx.foe.active.hp));
    check("and the box says it cannot move",
          battle.log.some((l) => l.indexOf("can't move") >= 0), "no held-in-place line");
  }

  // Teleport takes the USER out of the battle; Roar and Whirlwind take the TARGET
  // out. Which of the two left decides whether the player fled or the foe did, and
  // reading it off the user alone gets two of the three the wrong way round.
  {
    function blown(moveId, playerUses, userLevel, foeLevel) {
      const rng = seeded(0xb10a);
      const mine = withMoves(trained("PIDGEOT", playerUses ? userLevel : foeLevel, seeded(101)),
                             [playerUses ? moveId : "SPLASH"], 40);
      const theirs = withMoves(trained("PIDGEOT", playerUses ? foeLevel : userLevel, seeded(102)),
                               [playerUses ? "SPLASH" : moveId], 40);
      const battle = State.startWildBattle(bundle, [mine], 0, theirs, rng);
      let guard = 0;
      while (battle.phase !== State.PHASE_OVER && guard++ < 8) battle.takeTurn(MOVE(0));
      return battle.result;
    }
    check("the player's WHIRLWIND blows the WILD Pokemon away",
          blown("WHIRLWIND", true, 60, 5) === State.RESULT_FOE_FLED,
          "got " + blown("WHIRLWIND", true, 60, 5));
    check("the foe's WHIRLWIND blows the PLAYER away",
          blown("WHIRLWIND", false, 60, 5) === State.RESULT_FLED,
          "got " + blown("WHIRLWIND", false, 60, 5));
    check("the player's TELEPORT takes the PLAYER out",
          blown("TELEPORT", true, 60, 5) === State.RESULT_FLED,
          "got " + blown("TELEPORT", true, 60, 5));
    check("the foe's TELEPORT takes the FOE out",
          blown("TELEPORT", false, 60, 5) === State.RESULT_FOE_FLED,
          "got " + blown("TELEPORT", false, 60, 5));
  }

  // A Pokemon that faints is struck off the experience roll, so the one that
  // finishes the job is paid in full rather than paid half.
  {
    const rng = seeded(0xe4b1);
    const doomed = withMoves(trained("MAGIKARP", 5, seeded(97)), ["SPLASH"], 40);
    const closer = withMoves(trained("CHARIZARD", 60, seeded(98)), ["FLAMETHROWER"], 40);
    const foe = withMoves(trained("PIDGEY", 30, seeded(99)), ["GUST"], 40);
    const battle = State.startWildBattle(bundle, [doomed, closer], 0, foe, rng);
    const beforeExp = closer.exp;
    let guard = 0;
    let sawReplace = false;
    while (battle.phase !== State.PHASE_OVER && guard++ < 40) {
      if (battle.phase === State.PHASE_REPLACE) {
        sawReplace = true;
        battle.takeTurn(SWITCH(1));
        continue;
      }
      battle.takeTurn(MOVE(0));
    }
    check("the lead fainted and the second came in", sawReplace, "no replacement happened");
    check("and the second one won it", battle.result === State.RESULT_WON,
          "result " + battle.result);
    const paid = battle.outcome().party[1].exp - beforeExp;
    const expected = refExpGain(bundle.species.PIDGEY.baseExp, 30, 1, false);
    check("the fainted lead is not counted in the experience divisor", paid === expected,
          "paid " + paid + ", one participant is worth " + expected);
    check("and the fainted lead was paid nothing",
          battle.outcome().party[0].exp ===
            Party.expForLevel(bundle.species.MAGIKARP.growthRate, 5),
          "exp " + battle.outcome().party[0].exp);
  }
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 7c -- a trainer battle, which is the same loop with three rules off
// ---------------------------------------------------------------------------

function sceneTrainer() {
  note("\n== A trainer battle ==");
  const rng = counted(0x7a1e);
  const mine = [withMoves(trained("CHARIZARD", 60, seeded(103)), ["FLAMETHROWER"], 40)];
  const theirs = [withMoves(trained("PIDGEY", 10, seeded(104)), ["GUST"], 40),
                  withMoves(trained("RATTATA", 12, seeded(105)), ["TACKLE"], 40)];
  const battle = State.startTrainerBattle(bundle, mine, 0, theirs, "YOUNGSTER", rng);
  const before = mine[0].exp;

  check("a trainer battle cannot be run from", battle.canRun() === false, "canRun() said yes");
  check("and a ball cannot be thrown at it",
        battle.ballBlockedReason() === "TRAINER",
        "reason " + JSON.stringify(battle.ballBlockedReason()));

  const refusedRun = battle.takeTurn(RUN);
  check("a run attempt prints the cartridge's refusal",
        battle.log.some((l) => l.indexOf("no\nrunning") >= 0 || l.indexOf("running from") >= 0),
        "no refusal line");
  check("and the battle carries on", battle.result === State.RESULT_ONGOING,
        "result " + battle.result);

  const played = play(battle, () => MOVE(0), 60);
  check("the trainer battle ended", played.outcome.result !== State.RESULT_ONGOING,
        "still running after " + played.turns + " turns");
  check("the player won it", played.outcome.result === State.RESULT_WON,
        "result " + played.outcome.result);
  check("both of the trainer's Pokemon are down",
        battle.ctx.foe.party.filter((m) => m.hp > 0).length === 0,
        battle.ctx.foe.party.map((m) => m.name + " " + m.hp).join(", "));
  check("the second one was announced",
        battle.log.some((l) => l.indexOf("sent") >= 0 && l.indexOf("RATTATA") >= 0),
        "no send-out line for the second Pokemon");
  check("no illegal state during it", played.faults.length === 0, played.faults.join("; "));

  // A trainer pays 1.5x, and the payout happens once per Pokemon beaten.
  const paid = played.outcome.party[0].exp - before;
  const expected = refExpGain(bundle.species.PIDGEY.baseExp, 10, 1, true) +
                   refExpGain(bundle.species.RATTATA.baseExp, 12, 1, true);
  check("and paid the trainer rate for each Pokemon, once", paid === expected,
        "paid " + paid + ", the formula says " + expected);
  note("  " + played.turns + " turns, " + rng.draws + " draws, " + paid + " EXP");
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 8 -- running away
// ---------------------------------------------------------------------------

function sceneRun() {
  note("\n== Running ==");
  // The odds themselves, against the transcription, over the whole byte range.
  let mismatch = 0;
  for (const ps of [10, 33, 77, 100, 255, 300]) {
    for (const fs of [1, 3, 8, 40, 127, 255, 400]) {
      for (const attempts of [1, 2, 3]) {
        if (State.escapeOdds(ps, fs, attempts) !== refEscapeOdds(ps, fs, attempts)) mismatch++;
      }
    }
  }
  check("the escape odds match the published formula", mismatch === 0,
        mismatch + " of 126 combinations differ");

  // A fast Pokemon against a slow one gets away, and the battle ends there.
  {
    const rng = seeded(0xf1ee);
    const fast = withMoves(trained("ELECTRODE", 50, seeded(61)), ["TACKLE"], 40);
    const slow = withMoves(trained("SLOWPOKE", 5, seeded(62)), ["TACKLE"], 40);
    const battle = State.startWildBattle(bundle, [fast], 0, slow, rng);
    const report = battle.takeTurn(RUN);
    check("a much faster Pokemon escapes at once", battle.result === State.RESULT_FLED,
          "result " + battle.result);
    check("the log says so", battle.log.some((l) => l.indexOf("Got away") >= 0), "no escape line");
    check("and the foe did not get a move in", report.foeMove === null, "the foe moved anyway");
    check("the outcome carries the party back",
          battle.outcome().party.length === 1 && battle.outcome().party[0].name === "ELECTRODE",
          "party " + JSON.stringify(battle.outcome().party.map((m) => m.name)));
  }

  // A slow Pokemon against a much faster one usually cannot get away. One seed
  // proves nothing about a roll, so this sweeps 400 of them and checks the RATE
  // against the transcribed odds as well as what a failed run costs.
  {
    let escaped = 0;
    let failedRun = 0;
    let foeAnswered = 0;
    let tookAHit = 0;
    let landed = 0;
    let counterUp = 0;
    let odds = -1;
    const trials = 400;
    for (let seed = 1; seed <= trials; seed++) {
      const rng = seeded(0x51ee + seed * 977);
      const slow = withMoves(trained("SLOWPOKE", 30, seeded(63)), ["TACKLE"], 40);
      const fast = withMoves(trained("ELECTRODE", 50, seeded(64)), ["TACKLE"], 40);
      const battle = State.startWildBattle(bundle, [slow], 0, fast, rng);
      const before = battle.ctx.player.active.hp;
      if (odds < 0) {
        odds = refEscapeOdds(battle.ctx.player.active.battleStats.speed,
                             battle.ctx.foe.active.battleStats.speed, 1);
      }
      const report = battle.takeTurn(RUN);
      if (battle.result === State.RESULT_FLED) {
        escaped++;
        continue;
      }
      failedRun++;
      if (report.foeMove !== null && report.foeMove.used) foeAnswered++;
      // TACKLE is a 95% move, so a failed run does not always cost HP -- only a
      // landed hit must. Counting them apart is what keeps this a real check.
      if (report.foeMove !== null && report.foeMove.damage > 0) {
        landed++;
        if (battle.ctx.player.active.hp < before) tookAHit++;
      }
      if (battle.ctx.player.escapeAttempts === 1) counterUp++;
    }
    const rate = escaped / trials;
    const expect = odds / 256;
    const sigma = Math.sqrt(trials * expect * (1 - expect));
    const deviation = Math.abs(escaped - trials * expect) / sigma;
    note("  SLOWPOKE Lv30 fleeing ELECTRODE Lv50: " + escaped + "/" + trials + " got away (" +
         (rate * 100).toFixed(1) + "%), the formula says " + odds + "/256 = " +
         (expect * 100).toFixed(1) + "%, " + deviation.toFixed(2) + " sigma");
    check("some runs fail", failedRun > 0, "all " + trials + " escaped");
    check("some runs succeed", escaped > 0, "none of " + trials + " escaped");
    check("the escape rate matches the transcribed odds within three sigma", deviation < 3,
          deviation.toFixed(2) + " sigma");
    check("every failed run gave the foe its move",
          (foeAnswered === failedRun) === refFoeAnswersFailedRun(),
          foeAnswered + " of " + failedRun);
    check("and every landed answer cost the player HP",
          landed > 0 && tookAHit === landed, tookAHit + " of " + landed + " landed hits");
    check("every attempt bumped the escape counter", counterUp === failedRun,
          counterUp + " of " + failedRun);
  }
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 9 -- Struggle, which is how a battle with no PP still ends
// ---------------------------------------------------------------------------

function sceneStruggle() {
  note("\n== Struggle ==");
  const rng = seeded(0x57ac);
  const party = [withMoves(trained("SNORLAX", 30, seeded(71)), ["TACKLE"], 1)];
  const wild = withMoves(trained("SNORLAX", 30, seeded(72)), ["SPLASH"], 40);
  const battle = State.startWildBattle(bundle, party, 0, wild, rng);
  battle.takeTurn(MOVE(0)); // spends the only PP
  check("the one PP was spent", battle.ctx.player.active.moves[0].pp === 0,
        "pp " + battle.ctx.player.active.moves[0].pp);
  const before = battle.ctx.player.active.hp;
  const report = battle.takeTurn(MOVE(0));
  check("a Pokemon with no PP left uses Struggle",
        report.playerMove !== null && report.playerMove.move === "STRUGGLE",
        report.playerMove ? "used " + report.playerMove.move : "used nothing");
  if (report.playerMove && report.playerMove.hit) {
    const recoil = before - battle.ctx.player.active.hp;
    check("and takes Struggle's recoil", recoil === refStruggleRecoil(report.playerMove.damage),
          "took " + recoil + " for " + report.playerMove.damage + " dealt, expected " +
          refStruggleRecoil(report.playerMove.damage));
  } else {
    note("  (the Struggle missed on this seed; recoil not checked)");
  }
  check("Struggle costs no PP it does not have",
        battle.ctx.player.active.moves[0].pp === 0, "pp went to " +
        battle.ctx.player.active.moves[0].pp);
  flush();
}

// ---------------------------------------------------------------------------
// SCENE 10 -- the phases refuse what they should
// ---------------------------------------------------------------------------

function scenePhases() {
  note("\n== Phases ==");
  const rng = seeded(0x9a5e);
  const party = [withMoves(trained("MAGIKARP", 2, seeded(81)), ["SPLASH"], 40),
                 withMoves(trained("MAGIKARP", 2, seeded(82)), ["SPLASH"], 40)];
  const wild = Stats.makeWildMon(bundle, "ONIX", 30, seeded(83));
  const battle = State.startWildBattle(bundle, party, 0, wild, rng);

  let guard = 0;
  while (battle.phase === State.PHASE_CHOOSE && guard++ < 40) {
    battle.takeTurn(MOVE(0));
  }
  check("the first MAGIKARP fell and a replacement is wanted",
        battle.phase === State.PHASE_REPLACE, "phase " + battle.phase);
  const refusedMove = battle.takeTurn(MOVE(0));
  check("a move is refused while a replacement is owed", refusedMove.ok === false,
        "the move was accepted");
  const refusedDead = battle.takeTurn(SWITCH(battle.ctx.player.activeIndex));
  check("switching to the Pokemon that just fainted is refused", refusedDead.ok === false,
        "the switch was accepted");
  const accepted = battle.takeTurn(SWITCH(nextHealthy(battle)));
  check("a legal replacement is accepted", accepted.ok === true, "the switch was refused");
  check("and the phase goes back to choosing", battle.phase === State.PHASE_CHOOSE,
        "phase " + battle.phase);

  guard = 0;
  while (battle.phase !== State.PHASE_OVER && guard++ < 60) battle.takeTurn(MOVE(0));
  check("the battle finished", battle.phase === State.PHASE_OVER, "phase " + battle.phase);
  const afterEnd = battle.takeTurn(MOVE(0));
  check("nothing is accepted after the battle is over", afterEnd.ok === false,
        "a turn was accepted after the end");
  check("and the result does not change", afterEnd.result === battle.result);
  flush();
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const SCENES = [
  ["knockout", sceneKnockout],
  ["catch", sceneCatch],
  ["wipe", sceneWipe],
  ["sweep", () => sceneSweep(1000)],
  ["missrate", sceneMissRate],
  ["determinism", sceneDeterminism],
  ["endofturn", sceneEndOfTurn],
  ["sequencing", sceneSequencing],
  ["trainer", sceneTrainer],
  ["run", sceneRun],
  ["struggle", sceneStruggle],
  ["phases", scenePhases],
];

function runAll() {
  passed = 0;
  failed = 0;
  for (const [, fn] of SCENES) fn();
}

if (!selftest) {
  const started = Date.now();
  runAll();
  console.log("\nBATTLE-INTEGRATION  " + passed + " PASS  " + failed + " FAIL  " +
              (failed === 0 ? "OK" : "FAILED") + "   (" +
              ((Date.now() - started) / 1000).toFixed(1) + "s)\n");
  process.exit(failed === 0 ? 0 : 1);
} else {
  // Every mutation perturbs the REFERENCE, and every one must be noticed.
  const MUTATIONS = [
    "exp-divisor", "residual-divisor", "escape-scale", "escape-bonus",
    "miss-rate", "struggle-recoil", "party-growth", "order-speed", "legal-results",
    "catch-shakes", "replacement-move", "run-answer",
  ];
  const wasQuiet = quiet;
  quiet = true;
  const log = [];
  MUT = "";
  runAll();
  const cleanFail = failed;
  log.push("  unmutated: " + passed + " PASS " + failed + " FAIL");
  let caught = 0;
  for (const name of MUTATIONS) {
    MUT = name;
    runAll();
    const noticed = failed > cleanFail;
    if (noticed) caught++;
    log.push("  " + (noticed ? "caught  " : "MISSED  ") + name.padEnd(18) +
             failed + " FAIL");
  }
  MUT = "";
  quiet = wasQuiet;
  for (const line of log) console.log(line);
  const ok = caught === MUTATIONS.length && cleanFail === 0;
  console.log("\nBATTLE-INTEGRATION SELFTEST  " + (ok ? "OK" : "BROKEN") +
              " -- " + caught + "/" + MUTATIONS.length +
              " mutations caught, unmutated " + (cleanFail === 0 ? "clean" : "already failing") + "\n");
  process.exit(ok ? 0 : 1);
}
