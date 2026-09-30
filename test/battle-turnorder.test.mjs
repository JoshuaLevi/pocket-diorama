// Turn order and the trainer AI, run against the real bundle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battle-turnorder.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The shipping code is never checked against itself. Every rule is transcribed a
// second time in the REFERENCE section below, from the published Generation 1
// assembly (engine/battle/core.asm SelectEnemyMove and MainInBattleLoop,
// engine/battle/trainer_ai.asm AIEnemyTrainerChooseMoves and the per-class
// routines), written differently on purpose: the reference builds its type lookup
// by scanning bundle.typeChart.matchups directly instead of through Damage's
// index, derives layer 2's encouraged set from the effect NAMES by pattern rather
// than from a list, and spells the priority ladder out as the ROM's nested
// branches instead of as a number.
//
// Nothing here is statistical. Every roll-driven check sweeps all 256 byte values
// -- the RNG is fed byte/256, which floors back to exactly that byte -- so the
// counts printed are the thresholds, not a sample of them.
//
// `--selftest` perturbs the reference, one fault at a time, and reports whether
// the comparison noticed. A mutation that is not caught is a failure of this file.

import { readFileSync } from "node:fs";

globalThis.print = (...args) => console.log("[lens]", ...args);

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: battle-turnorder.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const TurnOrder = await import("../Assets/Scripts/play/battle/TurnOrder.ts");
const Ai = await import("../Assets/Scripts/play/battle/Ai.ts");
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
function eq(name, actual, expected) {
  check(name, actual === expected, "got " + actual + ", expected " + expected);
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

/** A random() that yields exactly `byte` from Damage.randomByte's floor(r*256). */
const byteRng = (byte) => () => byte / 256;

/** xorshift32, for the checks that want many different bytes. */
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

// ---------------------------------------------------------------------------
// REFERENCE -- the published Gen 1 behaviour, transcribed independently
// ---------------------------------------------------------------------------

/** macros/data.asm: `percent EQUS "* $ff / 100"`. */
function refPercent(p) {
  return Math.trunc((p * 0xff) / 100);
}

/**
 * MainInBattleLoop's order ladder, written as the ROM's nested branches rather
 * than as a priority number, so agreement with TurnOrder.priorityOf means the
 * numeric model really does collapse to the same ladder.
 * Returns "player", "foe" or "speed".
 */
function refOrderLadder(playerMove, foeMove) {
  const QA = "QUICK_ATTACK";
  const CT = mut("priority-counter-plus") ? "QUICK_ATTACK" : "COUNTER";
  if (playerMove === QA) {
    return foeMove === QA ? "speed" : "player";
  }
  if (foeMove === QA) {
    return "foe";
  }
  if (playerMove === CT) {
    return foeMove === CT ? "speed" : "foe";
  }
  if (foeMove === CT) {
    return "player";
  }
  return "speed";
}

/** `cp 50 percent + 1`: rolls below this give the player the turn. */
function refTieThreshold() {
  return mut("tie-129") ? 129 : refPercent(50) + 1;
}

/** QuarterSpeedDueToParalysis. */
function refParalysisSpeed(speed) {
  const divisor = mut("para-half") ? 2 : 4;
  return Math.max(1, Math.trunc(speed / divisor));
}

/**
 * AIGetTypeEffectiveness: a linear walk of the TypeEffects table returning the
 * FIRST row whose attacker matches and whose defender is either of the target's
 * types. -1 for "no row", the $10 sentinel. The mutation makes it a product over
 * every matching row, which is what a reader who has not read the routine assumes.
 */
function refTypeRow(attackType, defenderTypes) {
  const rows = bundle.typeChart.matchups;
  if (mut("layer3-product")) {
    let seenAny = false;
    let product = 10;
    for (const row of rows) {
      if (row.attacker === attackType && defenderTypes.indexOf(row.defender) >= 0) {
        seenAny = true;
        product = Math.trunc((product * row.multiplier) / 10);
      }
    }
    return seenAny ? product : -1;
  }
  for (const row of rows) {
    if (row.attacker === attackType && defenderTypes.indexOf(row.defender) >= 0) {
      return row.multiplier;
    }
  }
  return -1;
}

/**
 * AIMoveChoiceModification2's two effect ranges, derived from the effect NAMES
 * instead of from a copy of the shipping list: every _UP1/_DOWN1/_UP2/_DOWN2
 * effect, plus the eight non-stat effects that happen to sit inside the two
 * address ranges. The mutation drops those eight, which is the mistake a reader
 * makes who thinks the range means "stat moves".
 */
const RANGE_EXTRAS = [
  "PAY_DAY_EFFECT", "SWIFT_EFFECT", "CONVERSION_EFFECT", "HAZE_EFFECT",
  "HEAL_EFFECT", "TRANSFORM_EFFECT", "LIGHT_SCREEN_EFFECT", "REFLECT_EFFECT",
];
function refEncouraged(effect) {
  if (/_(UP|DOWN)[12]_EFFECT$/.test(effect)) {
    return true;
  }
  if (mut("encourage-stats-only")) {
    return false;
  }
  return RANGE_EXTRAS.indexOf(effect) >= 0;
}

const REF_STATUS_EFFECTS = [
  "EFFECT_01", "SLEEP_EFFECT", "POISON_EFFECT", "PARALYZE_EFFECT",
];
const REF_BETTER_EFFECTS = ["SUPER_FANG_EFFECT", "SPECIAL_DAMAGE_EFFECT", "FLY_EFFECT"];

/** AIMoveChoiceModification3's better-move scan, including the judged move. */
function refHasBetterMove(moveIds, judgedIndex) {
  const judgedType = bundle.moves[moveIds[judgedIndex]].type;
  for (let i = 0; i < moveIds.length; i++) {
    if (moveIds[i] === "") break;
    if (mut("betterMove-excludes-self") && i === judgedIndex) continue;
    const def = bundle.moves[moveIds[i]];
    if (REF_BETTER_EFFECTS.indexOf(def.effect) >= 0) return true;
    if (def.type !== judgedType && def.power > 0) return true;
  }
  return false;
}

/** AIEnemyTrainerChooseMoves: base 10, layer 1 +5, layer 2 -1, layer 3 -1 or +1. */
function refScores(moveIds, targetStatus, targetTypes, mods, layer2Turn, disabledSlot) {
  const live = moveIds.findIndex((id) => id === "") < 0
    ? moveIds.length
    : moveIds.findIndex((id) => id === "");
  const scores = moveIds.map((id, i) => (i < live ? 10 : -1));
  if (disabledSlot >= 0 && disabledSlot < live) scores[disabledSlot] = 0x50;
  for (const layer of mods) {
    for (let i = 0; i < live; i++) {
      const def = bundle.moves[moveIds[i]];
      if (layer === 1) {
        const applies = targetStatus !== "" && def.power === 0 &&
          REF_STATUS_EFFECTS.indexOf(def.effect) >= 0;
        if (applies) scores[i] += mut("layer1-minus") ? -5 : 5;
      } else if (layer === 2) {
        const live2 = mut("layer2-always") ? true : layer2Turn;
        if (live2 && refEncouraged(def.effect)) scores[i] -= 1;
      } else if (layer === 3) {
        const row = refTypeRow(def.type, targetTypes);
        if (row > 10) scores[i] -= 1;
        else if (row >= 0 && row < 10 && refHasBetterMove(moveIds, i)) scores[i] += 1;
      }
    }
  }
  return scores;
}

/** The slots the filter leaves selectable. */
function refMinimal(scores) {
  const live = scores.filter((s) => s !== -1);
  if (live.length === 0) return scores.map(() => false);
  const target = mut("max-wins") ? Math.max(...live) : Math.min(...live);
  return scores.map((s) => s !== -1 && s === target);
}

/** SelectEnemyMove's ladder: cp 25 percent, cp 50 percent, cp 75 percent - 1. */
function refSlotThresholds() {
  if (mut("slot-uniform")) return [64, 128, 192];
  return [refPercent(25), refPercent(50), refPercent(75) - 1];
}
function refSlotFor(byte) {
  const t = refSlotThresholds();
  if (byte < t[0]) return 0;
  if (byte < t[1]) return 1;
  if (byte < t[2]) return 2;
  return 3;
}

/** The per-class thresholds, spelled as the routines spell them. */
function refClassThreshold(name) {
  if (name === "juggler") return mut("juggler-63") ? refPercent(25) : refPercent(25) + 1;
  if (name === "blackbelt") return refPercent(13) - 1;
  if (name === "agathaSwitch") return refPercent(8);
  if (name === "agathaItem") return refPercent(50) + 1;
  return 0;
}

/**
 * AgathaAI reads ONE byte twice. The mutation rolls twice instead, which is the
 * natural but wrong reading, and inflates her potion count at low HP.
 */
function refAgathaCounts(belowQuarterHp) {
  const sw = refClassThreshold("agathaSwitch");
  const item = refClassThreshold("agathaItem");
  if (mut("agatha-two-rolls")) {
    return { switches: sw, items: belowQuarterHp ? item : 0 };
  }
  return { switches: sw, items: belowQuarterHp ? item - sw : 0 };
}

// ---------------------------------------------------------------------------
// Builders -- real Pokemon from the real bundle
// ---------------------------------------------------------------------------

const ivRng = seeded(0x5eed);

function padMoves(ids) {
  const slots = [];
  for (let i = 0; i < 4; i++) {
    const id = i < ids.length ? ids[i] : "";
    const pp = id ? bundle.moves[id].pp : 0;
    slots.push({ id: id, pp: pp, maxPp: pp });
  }
  return slots;
}

function makeMon(species, level, moveIds, opts) {
  const options = opts || {};
  const mon = Stats.makeWildMon(bundle, species, level, ivRng);
  mon.moves = padMoves(moveIds);
  if (options.status) mon.status = options.status;
  const sent = Stats.sendOut(mon, options.badges || 0);
  if (options.hp !== undefined) sent.hp = options.hp;
  if (options.disabledSlot !== undefined) sent.volatile.disabledSlot = options.disabledSlot;
  return sent;
}

function makeSide(active, isPlayer, party, trainerId) {
  const roster = party || [active];
  return {
    active: active,
    party: roster,
    activeIndex: roster.indexOf(active) >= 0 ? roster.indexOf(active) : 0,
    badgeBits: 0,
    isPlayer: isPlayer,
    trainerId: trainerId || "",
    escapeAttempts: 0,
  };
}

function makeCtx(playerMon, foeMon, random, foeParty, trainerId) {
  return {
    bundle: bundle,
    player: makeSide(playerMon, true, [playerMon], ""),
    foe: makeSide(foeMon, false, foeParty || [foeMon], trainerId || ""),
    isWild: !trainerId,
    turn: 1,
    random: random || (() => 0.5),
  };
}

const MOVE = (slot) => Types.moveAction(slot);

// ---------------------------------------------------------------------------
// Turn order
// ---------------------------------------------------------------------------

const ORDER_MOVES = ["QUICK_ATTACK", "COUNTER", "TACKLE"];

function suitePriorityLadder() {
  note("\n== Turn order: the priority ladder ==");
  // Equal Speed on both sides so only the ladder can decide; the tie roll is
  // pinned to "player" so a leak into the tie branch is visible as a wrong reason.
  const a = makeMon("RATTATA", 10, ["TACKLE"]);
  const b = makeMon("RATTATA", 10, ["TACKLE"]);
  b.battleStats.speed = a.battleStats.speed;
  const ctx = makeCtx(a, b, byteRng(0));
  for (const p of ORDER_MOVES) {
    for (const f of ORDER_MOVES) {
      const want = refOrderLadder(p, f);
      const got = TurnOrder.decideOrder(ctx, MOVE(0), p, f);
      const gotWho = got.reason === TurnOrder.ORDER_PRIORITY
        ? (got.playerFirst ? "player" : "foe")
        : "speed";
      eq("ladder " + p + " vs " + f, gotWho, want);
    }
  }
  // The corner the numeric model has to get right.
  const qaVsCounter = TurnOrder.decideOrder(ctx, MOVE(0), "QUICK_ATTACK", "COUNTER");
  check("Quick Attack beats Counter", qaVsCounter.playerFirst &&
    qaVsCounter.reason === TurnOrder.ORDER_PRIORITY);
  const counterVsQa = TurnOrder.decideOrder(ctx, MOVE(0), "COUNTER", "QUICK_ATTACK");
  check("Counter loses to Quick Attack", !counterVsQa.playerFirst);
}

function suiteSpeedOrder() {
  note("\n== Turn order: Speed ==");
  const fast = makeMon("PIKACHU", 20, ["TACKLE"]);
  const slow = makeMon("GEODUDE", 20, ["TACKLE"]);
  note("    Pikachu speed " + fast.battleStats.speed +
       ", Geodude speed " + slow.battleStats.speed);
  check("the faster side moves first", TurnOrder.decideOrder(
    makeCtx(fast, slow, byteRng(255)), MOVE(0), "TACKLE", "TACKLE").playerFirst);
  check("the slower side moves second", !TurnOrder.decideOrder(
    makeCtx(slow, fast, byteRng(0)), MOVE(0), "TACKLE", "TACKLE").playerFirst);
  eq("the reason is speed, not a tie",
     TurnOrder.decideOrder(makeCtx(fast, slow, byteRng(0)), MOVE(0), "TACKLE", "TACKLE").reason,
     TurnOrder.ORDER_SPEED);

  // A non-move player action resolves before the foe attacks, however slow.
  const switching = TurnOrder.decideOrder(
    makeCtx(slow, fast, byteRng(255)), Types.switchAction(0), "", "QUICK_ATTACK");
  check("a switch goes before the foe's Quick Attack", switching.playerFirst &&
    switching.reason === TurnOrder.ORDER_PLAYER_ACTION);
}

function suiteSpeedTie() {
  note("\n== Turn order: the speed tie, all 256 bytes ==");
  const a = makeMon("RATTATA", 12, ["TACKLE"]);
  const b = makeMon("RATTATA", 12, ["TACKLE"]);
  b.battleStats.speed = a.battleStats.speed;
  let playerFirst = 0;
  let sawTieReason = 0;
  for (let byte = 0; byte < 256; byte++) {
    const r = TurnOrder.decideOrder(makeCtx(a, b, byteRng(byte)), MOVE(0), "TACKLE", "TACKLE");
    if (r.reason === TurnOrder.ORDER_SPEED_TIE) sawTieReason++;
    if (r.playerFirst) playerFirst++;
  }
  note("    player first on " + playerFirst + " of 256 rolls");
  eq("every equal-Speed turn is decided by the tie roll", sawTieReason, 256);
  eq("the tie roll splits at cp 50 percent + 1", playerFirst, refTieThreshold());
}

function suiteParalysis() {
  note("\n== Turn order: the paralysis speed drop ==");
  const healthy = makeMon("PIKACHU", 25, ["TACKLE"]);
  const paralysed = makeMon("PIKACHU", 25, ["TACKLE"], { status: Types.STATUS_PARALYSIS });
  paralysed.stats.speed = healthy.stats.speed;
  const resent = Stats.sendOut(paralysed, 0);
  note("    Pikachu speed " + healthy.battleStats.speed + " -> " +
       resent.battleStats.speed + " while paralysed");
  eq("paralysis quarters the compared Speed",
     TurnOrder.effectiveSpeed(resent), refParalysisSpeed(healthy.battleStats.speed));
  eq("paralysisQuarter agrees with the drop Stats applies",
     TurnOrder.paralysisQuarter(healthy.battleStats.speed), refParalysisSpeed(healthy.battleStats.speed));
  check("the paralysed side now loses the turn to an equal-Speed foe",
    !TurnOrder.decideOrder(makeCtx(resent, healthy, byteRng(0)), MOVE(0), "TACKLE", "TACKLE")
      .playerFirst);
  check("isParalysisSlowed reports the status", TurnOrder.isParalysisSlowed(resent) &&
    !TurnOrder.isParalysisSlowed(healthy));
  eq("the floor is 1, not 0", TurnOrder.paralysisQuarter(3), refParalysisSpeed(3));
}

// ---------------------------------------------------------------------------
// The trainer AI: thresholds and class actions
// ---------------------------------------------------------------------------

function suiteThresholds() {
  note("\n== AI: the percent macro ==");
  eq("25 percent + 1", Ai.percentOf(25) + 1, refPercent(25) + 1);
  eq("13 percent - 1", Ai.percentOf(13) - 1, refPercent(13) - 1);
  eq("50 percent + 1", Ai.percentOf(50) + 1, refPercent(50) + 1);
  eq("8 percent", Ai.percentOf(8), refPercent(8));
  eq("Juggler's switch gate", Ai.AI_CLASSES.OPP_JUGGLER.chance, refClassThreshold("juggler"));
  eq("Blackbelt's X Attack gate", Ai.AI_CLASSES.OPP_BLACKBELT.chance,
     refClassThreshold("blackbelt"));
  eq("Agatha's switch gate", Ai.AI_CLASSES.OPP_AGATHA.switchChance,
     refClassThreshold("agathaSwitch"));
  eq("Agatha's potion gate", Ai.AI_CLASSES.OPP_AGATHA.chance, refClassThreshold("agathaItem"));
  eq("an unknown class gets GenericAI", Ai.aiClassFor("OPP_YOUNGSTER").id, "");
}

/** Sweep every byte through classActionForRoll and count the outcomes. */
function sweepClass(trainerId, hpFraction, status, partySize) {
  const cls = Ai.aiClassFor(trainerId);
  const party = [];
  for (let i = 0; i < (partySize === undefined ? 3 : partySize); i++) {
    party.push(makeMon("RATTATA", 10, ["TACKLE"]));
  }
  const active = party[0];
  active.hp = Math.floor(active.maxHp * hpFraction);
  if (status) active.status = status;
  const foe = makeSide(active, false, party, trainerId);
  const player = makeMon("PIKACHU", 10, ["TACKLE"]);
  const ctx = {
    bundle: bundle, player: makeSide(player, true, [player], ""), foe: foe,
    isWild: false, turn: 1, random: () => 0.5,
  };
  let switches = 0;
  let items = 0;
  let nothing = 0;
  for (let byte = 0; byte < 256; byte++) {
    const action = Ai.classActionForRoll(ctx, cls, cls.uses, byte);
    if (action.kind === Types.ACTION_SWITCH) switches++;
    else if (action.kind === Types.ACTION_ITEM) items++;
    else nothing++;
  }
  return { switches: switches, items: items, nothing: nothing, cls: cls };
}

function suiteClassSweeps() {
  note("\n== AI: per-class action over all 256 rolls ==");

  const juggler = sweepClass("OPP_JUGGLER", 1.0);
  note("    Juggler at full HP: " + juggler.switches + " switch, " + juggler.items +
       " item, " + juggler.nothing + " attack");
  eq("Juggler switches on `cp 25 percent + 1` rolls", juggler.switches,
     refClassThreshold("juggler"));
  eq("Juggler never uses an item", juggler.items, 0);
  eq("the Juggler roll ignores HP", sweepClass("OPP_JUGGLER", 0.05).switches,
     refClassThreshold("juggler"));
  eq("a Juggler with no living reserve attacks instead",
     sweepClass("OPP_JUGGLER", 1.0, "", 1).switches, 0);

  const agathaHigh = sweepClass("OPP_AGATHA", 1.0);
  const agathaLow = sweepClass("OPP_AGATHA", 0.10);
  note("    Agatha full HP: " + agathaHigh.switches + " switch / " + agathaHigh.items +
       " item;  1/10 HP: " + agathaLow.switches + " switch / " + agathaLow.items + " item");
  const wantHigh = refAgathaCounts(false);
  const wantLow = refAgathaCounts(true);
  eq("Agatha's switch roll at full HP", agathaHigh.switches, wantHigh.switches);
  eq("Agatha holds the potion above 1/4 HP", agathaHigh.items, wantHigh.items);
  eq("Agatha's switch roll at 1/10 HP", agathaLow.switches, wantLow.switches);
  eq("the same byte leaves only 20..127 for the potion", agathaLow.items, wantLow.items);

  const brockClear = sweepClass("OPP_BROCK", 1.0, "");
  const brockStatus = sweepClass("OPP_BROCK", 1.0, Types.STATUS_POISON);
  note("    Brock: " + brockClear.items + " item unstatused, " + brockStatus.items +
       " item statused");
  eq("Brock does nothing while his Pokemon is healthy", brockClear.items, 0);
  eq("Brock uses FULL HEAL on every roll once it is statused", brockStatus.items, 256);
  eq("Brock carries five uses", Ai.AI_CLASSES.OPP_BROCK.uses, 5);

  // BlaineAI has no AICheckIfHPBelowFraction: he heals at full HP. This is the
  // check that would fail first if someone "fixed" him.
  const blaine = sweepClass("OPP_BLAINE", 1.0);
  note("    Blaine at FULL HP: " + blaine.items + " Super Potions of 256 rolls");
  eq("Blaine drinks at full HP", blaine.items, refClassThreshold("juggler"));

  // CooltrainerF's `ret nc` is commented out in pokered: her roll is dead.
  const cfLow = sweepClass("OPP_COOLTRAINER_F", 0.05);
  const cfMid = sweepClass("OPP_COOLTRAINER_F", 0.15);
  const cfHigh = sweepClass("OPP_COOLTRAINER_F", 0.5);
  note("    Cool Trainer F: 5% HP -> " + cfLow.items + " item, 15% HP -> " +
       cfMid.switches + " switch, 50% HP -> " + cfHigh.nothing + " attack");
  eq("her dead roll means every byte acts, below maxHp/10", cfLow.items, 256);
  eq("between maxHp/10 and maxHp/5 she switches instead", cfMid.switches, 256);
  eq("above maxHp/5 she does nothing", cfHigh.nothing, 256);

  const rival = sweepClass("OPP_RIVAL2", 0.1);
  eq("Rival 2's Potion gate is `cp 13 percent - 1`", rival.items,
     refClassThreshold("blackbelt"));
  eq("Rival 2 holds it above maxHp/5", sweepClass("OPP_RIVAL2", 0.5).items, 0);

  const generic = sweepClass("OPP_YOUNGSTER", 0.05);
  eq("a class with no routine never acts", generic.nothing, 256);
  eq("a class with uses spent never acts",
     (() => {
       const cls = Ai.aiClassFor("OPP_BROCK");
       const mon = makeMon("RATTATA", 10, ["TACKLE"], { status: Types.STATUS_POISON });
       const ctx = makeCtx(makeMon("PIKACHU", 10, ["TACKLE"]), mon, () => 0.5);
       return Ai.classActionForRoll(ctx, cls, 0, 0).kind;
     })(), "");
}

function suiteSwitchTarget() {
  note("\n== AI: who it switches to ==");
  const mk = (hps, activeIndex) => {
    const party = hps.map((hp) => {
      const mon = makeMon("RATTATA", 10, ["TACKLE"]);
      mon.hp = hp;
      return mon;
    });
    const side = makeSide(party[activeIndex], false, party, "OPP_JUGGLER");
    side.activeIndex = activeIndex;
    return side;
  };
  eq("the first living reserve, skipping the fainted slot",
     Ai.switchTarget(mk([30, 0, 30], 0)), 2);
  eq("a lone Pokemon never switches", Ai.switchTarget(mk([30], 0)), -1);
  eq("no switch when every reserve has fainted",
     Ai.switchTarget(mk([30, 0, 0], 0)), -1);
  eq("the reserve before the active one is still the first choice",
     Ai.switchTarget(mk([30, 30, 30], 1)), 0);
}

function suiteItemEffects() {
  note("\n== AI: what the items do ==");
  eq("POTION restores 20", Ai.itemEffect("POTION").heal, 20);
  eq("SUPER POTION restores 50", Ai.itemEffect("SUPER_POTION").heal, 50);
  eq("HYPER POTION restores 200", Ai.itemEffect("HYPER_POTION").heal, 200);
  eq("FULL RESTORE fills the bar", Ai.itemEffect("FULL_RESTORE").heal, Ai.HEAL_FULL);
  check("FULL RESTORE also clears status", Ai.itemEffect("FULL_RESTORE").clearStatus);
  check("FULL HEAL clears status and heals nothing",
    Ai.itemEffect("FULL_HEAL").clearStatus && Ai.itemEffect("FULL_HEAL").heal === 0);
  eq("X ATTACK raises attack", Ai.itemEffect("X_ATTACK").raiseStat, Types.STAT_ATTACK);
  eq("X DEFEND raises defense", Ai.itemEffect("X_DEFEND").raiseStat, Types.STAT_DEFENSE);
  eq("X SPEED raises speed", Ai.itemEffect("X_SPEED").raiseStat, Types.STAT_SPEED);
  check("GUARD SPEC sets Mist", Ai.itemEffect("GUARD_SPEC").mist);
}

// ---------------------------------------------------------------------------
// The trainer AI: move scoring
// ---------------------------------------------------------------------------

function scoreCase(moveIds, target, mods, layer2Turn, disabledSlot) {
  const user = makeMon("RATTATA", 20, moveIds, { disabledSlot: disabledSlot });
  const got = Ai.scoreMoves(bundle, user, target, mods, layer2Turn);
  const want = refScores(user.moves.map((m) => m.id), target.status, target.types,
                         mods, layer2Turn, disabledSlot === undefined ? -1 : disabledSlot);
  return { got: got, want: want, user: user };
}

function checkScores(name, moveIds, target, mods, layer2Turn, disabledSlot) {
  const c = scoreCase(moveIds, target, mods, layer2Turn, disabledSlot);
  check(name, JSON.stringify(c.got) === JSON.stringify(c.want),
        "got " + JSON.stringify(c.got) + ", reference " + JSON.stringify(c.want));
  return c;
}

function suiteLayer1() {
  note("\n== AI layer 1: status moves against an already-statused target ==");
  const healthy = makeMon("PIKACHU", 20, ["TACKLE"]);
  const statused = makeMon("PIKACHU", 20, ["TACKLE"], { status: Types.STATUS_PARALYSIS });
  const moves = ["TOXIC", "TACKLE"];
  const clear = checkScores("no target status leaves the scores flat", moves, healthy, [1], false);
  eq("  TOXIC scores the base against a healthy target", clear.got[0], 10);
  const hit = checkScores("a statused target adds 5 to TOXIC", moves, statused, [1], false);
  note("    TOXIC " + hit.got[0] + ", TACKLE " + hit.got[1] + " vs a paralysed target");
  eq("  the +5 is a full 5, not a nudge", hit.got[0] - hit.got[1], 5);
  // The point of the minimum rule: +5 does not make TOXIC unlikely, it makes it
  // impossible.
  const minimal = Ai.minimalSlots(hit.got);
  check("a discouraged move is not merely unlikely, it is unselectable", !minimal[0] && minimal[1]);
  checkScores("a damaging status move is exempt (power > 0)",
              ["BODY_SLAM", "TACKLE"], statused, [1], false);
}

function suiteLayer2() {
  note("\n== AI layer 2: the second selection, and its address range ==");
  const target = makeMon("PIKACHU", 20, ["TACKLE"]);
  const moves = ["GROWL", "TACKLE"];
  const first = checkScores("no encouragement on the first selection", moves, target, [2], false);
  const second = checkScores("GROWL is encouraged on the second", moves, target, [2], true);
  note("    GROWL " + first.got[0] + " -> " + second.got[0] + " on selection two");
  eq("  the encouragement is exactly one point", first.got[0] - second.got[0], 1);
  eq("  layer2Active fires on selection index 1 only",
     [0, 1, 2, 3].map((n) => (Ai.layer2Active(n) ? "1" : "0")).join(""), "0100");
  // PAY_DAY and SWIFT are encouraged because of where their effect constants sit,
  // not because they are stat moves. Removing them would be a "fix".
  const oddities = checkScores("PAY DAY and SWIFT are encouraged too",
                               ["PAY_DAY", "SWIFT", "TACKLE"], target, [2], true);
  note("    PAY DAY " + oddities.got[0] + ", SWIFT " + oddities.got[1] +
       ", TACKLE " + oddities.got[2]);
  check("  both sit below an ordinary attack", oddities.got[0] === 9 &&
    oddities.got[1] === 9 && oddities.got[2] === 10);
  // Every effect in the shipping list must be one the reference derives too.
  let mismatched = 0;
  for (const effect of Ai.LAYER2_ENCOURAGED_EFFECTS) {
    if (!refEncouraged(effect)) mismatched++;
  }
  eq("every entry of the shipping range list is in the reference range", mismatched, 0);
  eq("the range holds 32 effects", Ai.LAYER2_ENCOURAGED_EFFECTS.length, 32);
}

function suiteLayer3() {
  note("\n== AI layer 3: the first chart row, and nothing else ==");
  const starmie = makeMon("STARMIE", 20, ["TACKLE"]);
  const twave = checkScores("a super-effective move is encouraged, damaging or not",
                            ["THUNDER_WAVE", "TACKLE"], starmie, [3], false);
  note("    vs Starmie: THUNDER WAVE " + twave.got[0] + ", TACKLE " + twave.got[1]);
  check("  the non-damaging Thunder Wave wins on score", twave.got[0] < twave.got[1]);

  // The first-row rule. Against NORMAL/FLYING the chart's FIGHTING>NORMAL row (20)
  // is reached before FIGHTING>FLYING (5), so the AI reads a neutral matchup as
  // super effective.
  const pidgey = makeMon("PIDGEY", 20, ["TACKLE"]);
  const rowFirst = Ai.firstMatchingRow(bundle, "FIGHTING", pidgey.types);
  eq("FIGHTING vs NORMAL/FLYING reads the first row only", rowFirst,
     refTypeRow("FIGHTING", pidgey.types));
  note("    FIGHTING vs NORMAL/FLYING: first row " + rowFirst +
       ", true product " + (20 * 5) / 10);
  const misjudged = checkScores("a neutral matchup is encouraged as super effective",
                                ["SEISMIC_TOSS", "TACKLE"], pidgey, [3], false);
  check("  the AI prefers the resisted-half move", misjudged.got[0] < misjudged.got[1]);

  // How often that misjudgement is possible at all, over every dual-type species
  // in the cartridge and every attacking type.
  let disagreements = 0;
  let compared = 0;
  for (const speciesId of Object.keys(bundle.species)) {
    const types = bundle.species[speciesId].types;
    if (types.length < 2 || types[0] === types[1]) continue;
    for (const attacker of bundle.typeChart.names) {
      const got = Ai.firstMatchingRow(bundle, attacker, types);
      const want = refTypeRow(attacker, types);
      compared++;
      if (got !== want) disagreements++;
    }
  }
  eq("first-row lookup matches an independent scan on every dual type", disagreements, 0);
  note("    " + compared + " attacker/dual-type pairs compared");

  // The better-move scan includes the move it is judging.
  const gastly = makeMon("GASTLY", 20, ["TACKLE"]);
  const soloFang = scoreCase(["SUPER_FANG"], gastly, [3], false);
  const soloTackle = scoreCase(["TACKLE"], gastly, [3], false);
  note("    vs Gastly, sole move: SUPER FANG " + soloFang.got[0] +
       ", TACKLE " + soloTackle.got[0]);
  eq("Super Fang counts itself as the better move and self-discourages",
     soloFang.got[0], soloFang.want[0]);
  check("  it really does score worse than an ordinary move that cannot",
    soloFang.got[0] === 11 && soloTackle.got[0] === 10);
  check("hasBetterMove sees the judged slot",
    Ai.hasBetterMove(bundle, soloFang.user, "NORMAL") === refHasBetterMove(["SUPER_FANG"], 0));
}

function suiteDisableAndCombined() {
  note("\n== AI: Disable, and the layers together ==");
  const statused = makeMon("PIKACHU", 20, ["TACKLE"], { status: Types.STATUS_SLEEP });
  const c = checkScores("a disabled slot is parked at $50", ["TACKLE", "GROWL", "TOXIC"],
                        statused, [1, 2, 3], true, 0);
  eq("  the disabled slot's score", c.got[0], Ai.AI_DISABLED_SCORE);
  check("  and it can never be the minimum", !Ai.minimalSlots(c.got)[0]);
  checkScores("all three layers stack additively", ["TOXIC", "GROWL", "PAY_DAY", "TACKLE"],
              statused, [1, 2, 3], true);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function suiteSlotDistribution() {
  note("\n== AI: the move slot roll over all 256 bytes ==");
  const counts = [0, 0, 0, 0];
  const refCounts = [0, 0, 0, 0];
  let disagree = 0;
  for (let byte = 0; byte < 256; byte++) {
    const got = Ai.rollSlot(byteRng(byte));
    const want = refSlotFor(byte);
    counts[got]++;
    refCounts[want]++;
    if (got !== want) disagree++;
  }
  note("    slot counts " + counts.join("/") + " of 256");
  eq("every byte lands where SelectEnemyMove's ladder puts it", disagree, 0);
  check("the four slots are NOT equally likely",
    counts.join("/") === refCounts.join("/"), "reference " + refCounts.join("/"));
  eq("the thresholds are 25 percent, 50 percent and 75 percent - 1",
     Ai.SLOT_THRESHOLDS.join(","), refSlotThresholds().join(","));
}

function suiteSelection() {
  note("\n== AI: what it actually picks ==");
  const target = makeMon("PIKACHU", 20, ["TACKLE"], { status: Types.STATUS_PARALYSIS });
  const foe = makeMon("RATTATA", 20, ["TOXIC", "TACKLE", "GROWL", "HYPER_FANG"]);
  const rng = seeded(0xa11);
  const ctx = makeCtx(target, foe, rng, [foe], "OPP_LORELEI");

  // Layer 1 puts TOXIC at 15 while the rest tie at 10: it must never come out.
  const picks = [0, 0, 0, 0];
  for (let i = 0; i < 20000; i++) {
    picks[Ai.chooseMove(ctx, [1], 0)]++;
  }
  note("    20000 selections with mods [1]: " + picks.join("/"));
  const scores = Ai.scoreMoves(bundle, foe, target, [1], false);
  const wantMinimal = refMinimal(refScores(foe.moves.map((m) => m.id), target.status,
                                           target.types, [1], false, -1));
  let wrong = 0;
  for (let slot = 0; slot < 4; slot++) {
    if (!wantMinimal[slot] && picks[slot] > 0) wrong++;
  }
  eq("a non-minimal move is never selected in 20000 tries", wrong, 0);
  check("every minimal move is reachable",
    wantMinimal.every((m, i) => !m || picks[i] > 0));

  // With no mods the ROM skips the filter entirely and rolls over the raw list.
  const wild = makeMon("RATTATA", 20, ["TACKLE", "TAIL_WHIP"]);
  const wildCtx = makeCtx(target, wild, seeded(0xb22));
  const wildPicks = [0, 0, 0, 0];
  for (let i = 0; i < 20000; i++) {
    wildPicks[Ai.chooseMove(wildCtx, [], 0)]++;
  }
  note("    20000 selections with no mods, two moves: " + wildPicks.join("/"));
  check("an unfiltered pick never lands on an empty slot",
    wildPicks[2] === 0 && wildPicks[3] === 0);
  check("both real slots come up", wildPicks[0] > 0 && wildPicks[1] > 0);

  // PP is never read. A move with no PP left is still selectable.
  const dry = makeMon("RATTATA", 20, ["TACKLE", "GROWL"]);
  dry.moves[0].pp = 0;
  const dryCtx = makeCtx(target, dry, seeded(0xc33));
  let pickedDry = 0;
  for (let i = 0; i < 2000; i++) {
    if (Ai.chooseMove(dryCtx, [1], 0) === 0) pickedDry++;
  }
  check("a move with no PP is still picked -- Gen 1 never reads enemy PP",
    pickedDry > 0, "picked the empty move " + pickedDry + " times in 2000");

  // Struggle: only when the one move it has is disabled.
  const oneMove = makeMon("RATTATA", 20, ["TACKLE"], { disabledSlot: 0 });
  eq("one move, disabled, is the only route to Struggle",
     Ai.chooseMove(makeCtx(target, oneMove, seeded(1)), [], 0), Ai.AI_STRUGGLE);
  const oneFree = makeMon("RATTATA", 20, ["TACKLE"]);
  eq("one move, not disabled, is used", Ai.chooseMove(makeCtx(target, oneFree, seeded(1)), [], 0), 0);
  const twoOneDisabled = makeMon("RATTATA", 20, ["TACKLE", "GROWL"], { disabledSlot: 0 });
  const twoCtx = makeCtx(target, twoOneDisabled, seeded(0xd44));
  let pickedDisabled = 0;
  for (let i = 0; i < 2000; i++) {
    if (Ai.chooseMove(twoCtx, [], 0) === 0) pickedDisabled++;
  }
  eq("with a spare move the disabled slot is rerolled away, not Struggled",
     pickedDisabled, 0);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function runAll() {
  passed = 0;
  failed = 0;
  lines.length = 0;
  suitePriorityLadder();
  suiteSpeedOrder();
  suiteSpeedTie();
  suiteParalysis();
  suiteThresholds();
  suiteClassSweeps();
  suiteSwitchTarget();
  suiteItemEffects();
  suiteLayer1();
  suiteLayer2();
  suiteLayer3();
  suiteDisableAndCombined();
  suiteSlotDistribution();
  suiteSelection();
}

if (!selftest) {
  runAll();
  flush();
  console.log("\nTURNORDER  " + passed + " PASS  " + failed + " FAIL  " +
              (failed === 0 ? "OK" : "FAILED"));
  process.exit(failed === 0 ? 0 : 1);
} else {
  const MUTATIONS = [
    ["priority-counter-plus", "the reference gives Counter +1 priority"],
    ["tie-129", "the reference splits the speed tie at 129"],
    ["para-half", "the reference halves Speed for paralysis instead of quartering"],
    ["juggler-63", "the reference reads Juggler's gate as `cp 25 percent`"],
    ["agatha-two-rolls", "the reference rolls Agatha's switch and item separately"],
    ["layer1-minus", "the reference subtracts 5 in layer 1 instead of adding"],
    ["layer2-always", "the reference lets layer 2 fire on every selection"],
    ["encourage-stats-only", "the reference drops the non-stat effects from the range"],
    ["layer3-product", "the reference multiplies every matching chart row"],
    ["betterMove-excludes-self", "the reference skips the judged move in the better-move scan"],
    ["max-wins", "the reference selects the maximum score"],
    ["slot-uniform", "the reference expects a uniform 64/64/64/64 slot roll"],
  ];
  let notCaught = 0;
  console.log("\n== Self test: every mutation must be caught ==");
  for (const [name, description] of MUTATIONS) {
    MUT = name;
    runAll();
    lines.length = 0;
    const caught = failed > 0;
    if (!caught) notCaught++;
    console.log("  " + (caught ? "CAUGHT    " : "NOT CAUGHT") + "  " + name.padEnd(26) +
                String(failed).padStart(3) + " failures  -- " + description);
  }
  MUT = "";
  runAll();
  lines.length = 0;
  console.log("  " + (failed === 0 ? "CLEAN     " : "DIRTY     ") +
              "  unmutated                   " + String(failed).padStart(3) + " failures");
  const ok = notCaught === 0 && failed === 0;
  console.log("\nTURNORDER SELFTEST  " + (ok ? "OK -- the gate discriminates" : "FAILED"));
  process.exit(ok ? 0 : 1);
}
