// The GAME CORNER's slot machines, and the rigging inside them.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/slots.test.mjs Assets/Generated/kanto.json
//
// Everything asserted here was read out of bank $0D of the cartridge; the
// addresses in the comments are that bank's. The one thing a test can prove
// that reading cannot is that the whole machine still PLAYS: a sitting below
// runs several hundred rounds and counts what came out of it.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const S = await import(P + "script/Slots.ts");
const { SlotController, SLOTS_CLOSED } = await import(P + "SlotController.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: slots.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
globalThis.print = () => {};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

const NO_PAD = { up: false, down: false, left: false, right: false };
const pad = (dir) => Object.assign({}, NO_PAD, dir ? { [dir]: true } : {});

/** A generator good enough to sample 256 values evenly; the LCG-in-a-tweet is not. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every roll the same byte, so a whole sitting keeps one mood. */
function always(byte) {
  return () => byte / 256;
}

/** Feed the controller exactly these bytes, then zeros. */
function bytes(list) {
  let i = 0;
  return () => {
    const b = i < list.length ? list[i] : 0;
    i++;
    return b / 256;
  };
}

console.log("== The tables ==");
{
  check("what three of a kind pays",
        S.slotPayout("7") === 300 && S.slotPayout("BAR") === 100 &&
        S.slotPayout("CHERRY") === 8 && S.slotPayout("FISH") === 15 &&
        S.slotPayout("BIRD") === 15 && S.slotPayout("MOUSE") === 15,
        ["7", "BAR", "CHERRY", "FISH", "BIRD", "MOUSE"].map((s) => s + "=" + S.slotPayout(s)).join(" "));
  check("and nothing pays nothing", S.slotPayout("") === 0);

  const wheels = S.slotWheels(bundle);
  check("three strips come out of the bundle", wheels !== null && wheels.length === 3);
  check("each lists eighteen: fifteen and the first three again",
        wheels.every((w) => w.length === 18 &&
                     w[15] === w[0] && w[16] === w[1] && w[17] === w[2]),
        JSON.stringify(wheels.map((w) => w.length)));
  // $79E5, $7A09, $7A2D: the strips themselves, so a re-extraction that
  // scrambled them would be caught here rather than in a playtest.
  check("the first strip is the cartridge's",
        wheels[0].slice(0, 15).join(",") ===
        "7,MOUSE,FISH,BAR,CHERRY,7,FISH,BIRD,BAR,CHERRY,7,MOUSE,BIRD,BAR,CHERRY",
        wheels[0].join(","));
  check("and the third has exactly one SEVEN and one BAR",
        wheels[2].slice(0, 15).filter((s) => s === "7").length === 1 &&
        wheels[2].slice(0, 15).filter((s) => s === "BAR").length === 1,
        wheels[2].join(","));

  check("a reel's window reads from the bottom up",
        S.slotFaces(wheels[0], 0).join(",") === "7,MOUSE,FISH",
        JSON.stringify(S.slotFaces(wheels[0], 0)));
  check("and wraps over the join",
        S.slotFaces(wheels[0], 14).join(",") === "CHERRY,7,MOUSE",
        JSON.stringify(S.slotFaces(wheels[0], 14)));

  check("one coin buys the middle row only", S.slotLines(1).length === 1);
  check("two buy three rows", S.slotLines(2).length === 3);
  check("three buy five lines, the diagonals first",
        S.slotLines(3).length === 5 &&
        JSON.stringify(S.slotLines(3)[0]) === JSON.stringify([[0, 0], [1, 1], [2, 2]]),
        JSON.stringify(S.slotLines(3)));
}

console.log("\n== Reading the lines ==");
{
  // faces[reel] is bottom, middle, top.
  const diagonal = [["7", "BAR", "CHERRY"], ["FISH", "7", "BIRD"], ["MOUSE", "BAR", "7"]];
  check("a diagonal pays only at three coins",
        S.slotMatch(diagonal, 3) === "7" && S.slotMatch(diagonal, 2) === "" &&
        S.slotMatch(diagonal, 1) === "",
        S.slotMatch(diagonal, 3) + "/" + S.slotMatch(diagonal, 2));
  const middle = [["7", "BAR", "CHERRY"], ["FISH", "BAR", "BIRD"], ["MOUSE", "BAR", "7"]];
  check("the middle row pays at any bet",
        S.slotMatch(middle, 1) === "BAR" && S.slotMatch(middle, 3) === "BAR");
  const topRow = [["7", "BAR", "CHERRY"], ["FISH", "MOUSE", "CHERRY"], ["MOUSE", "BAR", "CHERRY"]];
  check("the top row needs two",
        S.slotMatch(topRow, 1) === "" && S.slotMatch(topRow, 2) === "CHERRY");
  check("and nothing lined up is nothing",
        S.slotMatch([["7", "BAR", "CHERRY"], ["FISH", "MOUSE", "BIRD"], ["MOUSE", "BAR", "7"]], 3) === "");
}

console.log("\n== The mood the machine picks ==");
{
  // $7480. `slotMood(mood, streak, chance, roll)` -> [mood, streak].
  const ord = S.CHANCE_ORDINARY;
  const lucky = S.CHANCE_LUCKY;
  check("most rolls buy nothing", S.slotMood(0, 0, ord, 100)[0] === S.MOOD_NONE &&
        S.slotMood(0, 0, ord, 210)[0] === S.MOOD_NONE);
  check("above 210 the four cheap symbols may stand",
        S.slotMood(0, 0, ord, 211)[0] === S.MOOD_LOW &&
        S.slotMood(0, 0, ord, 253)[0] === S.MOOD_LOW);
  check("and only 254 and 255 buy a SEVEN on an ordinary machine",
        S.slotMood(0, 0, ord, 254)[0] === S.MOOD_HIGH &&
        S.slotMood(0, 0, ord, 255)[0] === S.MOOD_HIGH);
  check("the lucky one buys it from 251",
        S.slotMood(0, 0, lucky, 251)[0] === S.MOOD_HIGH &&
        S.slotMood(0, 0, ord, 251)[0] === S.MOOD_LOW,
        S.slotMood(0, 0, lucky, 251)[0] + "/" + S.slotMood(0, 0, ord, 251)[0]);
  check("a roll of exactly zero starts a sixty-round streak instead",
        S.slotMood(0, 0, ord, 0)[0] === S.MOOD_NONE &&
        S.slotMood(0, 0, ord, 0)[1] === 60,
        JSON.stringify(S.slotMood(0, 0, ord, 0)));
  check("and while it runs every round is generous, whatever the roll",
        S.slotMood(0, 5, ord, 1)[0] === S.MOOD_LOW &&
        S.slotMood(0, 5, ord, 200)[0] === S.MOOD_LOW);
  check("a SEVEN-and-BAR mood survives the next round's roll",
        S.slotMood(S.MOOD_HIGH, 0, ord, 1)[0] === S.MOOD_HIGH);

  check("no mood lets anything stand", !S.slotAllows(S.MOOD_NONE, "CHERRY") &&
        !S.slotAllows(S.MOOD_NONE, "7"));
  check("the cheap mood pays four symbols and nudges a SEVEN away",
        S.slotAllows(S.MOOD_LOW, "CHERRY") && S.slotAllows(S.MOOD_LOW, "MOUSE") &&
        !S.slotAllows(S.MOOD_LOW, "7") && !S.slotAllows(S.MOOD_LOW, "BAR"));
  check("the other pays anything", S.slotAllows(S.MOOD_HIGH, "7") &&
        S.slotAllows(S.MOOD_HIGH, "CHERRY"));

  // $7702 and $76F3: a jackpot ends the mood, a cheap win only spends a streak.
  check("a BAR ends the mood outright",
        S.slotAfterWin("BAR", S.MOOD_HIGH, 4, 0)[0] === S.MOOD_NONE);
  check("a SEVEN ends it half the time",
        S.slotAfterWin("7", S.MOOD_HIGH, 4, 0x80)[0] === S.MOOD_NONE &&
        S.slotAfterWin("7", S.MOOD_HIGH, 4, 0x7f)[0] === S.MOOD_HIGH,
        JSON.stringify([S.slotAfterWin("7", S.MOOD_HIGH, 4, 0x80),
                        S.slotAfterWin("7", S.MOOD_HIGH, 4, 0x7f)]));
  check("and always clears the streak", S.slotAfterWin("7", 0, 40, 0)[1] === 0);
  check("a cheap win spends one round of the streak",
        S.slotAfterWin("MOUSE", S.MOOD_LOW, 40, 0)[1] === 39 &&
        S.slotAfterWin("MOUSE", S.MOOD_LOW, 0, 0)[1] === 0);

  // Bank $12, $4BD7: a byte, floored at 8, shifted down three.
  check("the lucky machine is a roll shifted down three",
        S.luckyMachine(0) === 1 && S.luckyMachine(7) === 0 &&
        S.luckyMachine(255) === 31, [0, 7, 255].map(S.luckyMachine).join(","));
}

console.log("\n== The reels' own slipping ==");
{
  // $752C: the first reel will not leave a CHERRY on the middle line...
  check("the first reel slips off a CHERRY in the middle",
        S.slotSlipReel1(["7", "CHERRY", "BAR"], S.MOOD_LOW) === true &&
        S.slotSlipReel1(["7", "MOUSE", "BAR"], S.MOOD_LOW) === false);
  // ...and in a SEVEN round it pushes a SEVEN off the top and onto the line.
  check("and in a SEVEN round it pushes one down off the top",
        S.slotSlipReel1(["BAR", "MOUSE", "7"], S.MOOD_HIGH) === true &&
        S.slotSlipReel1(["BAR", "7", "MOUSE"], S.MOOD_HIGH) === false);

  // $756E: the five places the first two reels can already agree.
  check("two reels agree on the bottom row",
        S.slotPair(["7", "BAR", "CHERRY"], ["7", "MOUSE", "BIRD"]) === "7");
  check("and on the upward diagonal",
        S.slotPair(["7", "BAR", "CHERRY"], ["MOUSE", "7", "BIRD"]) === "7");
  check("and on the top row",
        S.slotPair(["7", "BAR", "CHERRY"], ["MOUSE", "BIRD", "CHERRY"]) === "CHERRY");
  check("and agree on nothing when they do not",
        S.slotPair(["7", "BAR", "CHERRY"], ["MOUSE", "MOUSE", "FISH"]) === "");

  // $7552: the second reel keeps turning until it agrees with the first.
  check("the second reel slips until it shares something",
        S.slotSlipReel2(["7", "BAR", "CHERRY"], ["MOUSE", "MOUSE", "FISH"], S.MOOD_LOW) === true &&
        S.slotSlipReel2(["7", "BAR", "CHERRY"], ["7", "MOUSE", "FISH"], S.MOOD_LOW) === false);
  check("and in a SEVEN round only a SEVEN or a BAR will do",
        S.slotSlipReel2(["CHERRY", "BAR", "7"], ["CHERRY", "MOUSE", "FISH"], S.MOOD_HIGH) === true &&
        S.slotSlipReel2(["7", "BAR", "CHERRY"], ["7", "MOUSE", "FISH"], S.MOOD_HIGH) === false);
}

console.log("\n== A sitting at one ==");

/** Run a machine until it closes or the frames run out, pressing A every `every`. */
function sit(machine, play, frames, every) {
  let seen = "";
  const log = [];
  for (let i = 0; i < frames; i++) {
    const out = machine.step(NO_PAD, i % every === 1, false, 1 / 60);
    const lines = (machine.lines() || []).join(" ");
    if (lines !== seen) {
      seen = lines;
      log.push(lines);
    }
    if (out === SLOTS_CLOSED) {
      break;
    }
  }
  return log;
}

/** Play `rounds` rounds, answering YES each time, and count what paid. */
function countRounds(machine, play, rounds, every) {
  let seen = "";
  let started = 0;
  let wins = 0;
  for (let i = 0; i < rounds * 4000 && machine.isOpen(); i++) {
    machine.step(NO_PAD, i % every === 1, false, 1 / 60);
    const lines = (machine.lines() || []).join(" ");
    if (lines !== seen) {
      seen = lines;
      if (lines.indexOf("Start") >= 0) {
        started++;
        if (started > rounds) { break; }
      }
      if (lines.indexOf("lined up") >= 0) { wins++; }
    }
  }
  return { rounds: started, wins: wins };
}

/** One round only: everything up to the question that follows it. */
function oneRound(machine, play, frames, every) {
  let seen = "";
  const log = [];
  for (let i = 0; i < frames; i++) {
    const out = machine.step(NO_PAD, i % every === 1, false, 1 / 60);
    const lines = (machine.lines() || []).join(" ");
    if (lines !== seen) {
      seen = lines;
      log.push(lines);
      if (lines.indexOf("One more") >= 0 || lines.indexOf("Ran out") >= 0) {
        break;
      }
    }
    if (out === SLOTS_CLOSED) {
      break;
    }
  }
  return log;
}

{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.coins = 50;
  const m = new SlotController(bundle, play, S.CHANCE_ORDINARY, mulberry32(4));
  check("it opens asking for the bet",
        (m.lines() || []).join(" ").indexOf("Bet how many") >= 0 &&
        m.rows().join(",") === "×3,×2,×1", JSON.stringify(m.lines()));
  m.step(NO_PAD, true, false, 1 / 60);
  check("and the top row is three coins, taken at once",
        play.coins === 47, "" + play.coins);
  check("then it says Start", (m.lines() || []).join(" ").indexOf("Start") >= 0,
        JSON.stringify(m.lines()));

  const cheap = PlayState.newPlayState(bundle.romSha1);
  cheap.coins = 50;
  const one = new SlotController(bundle, cheap, S.CHANCE_ORDINARY, mulberry32(4));
  one.step(pad("down"), false, false, 0.2);
  one.step(NO_PAD, false, false, 0.2);
  one.step(pad("down"), false, false, 0.2);
  check("the cursor walks down to the bottom row", one.cursorRow() === 2, "" + one.cursorRow());
  one.step(NO_PAD, true, false, 1 / 60);
  check("which is one coin", cheap.coins === 49, "" + cheap.coins);

  const broke = PlayState.newPlayState(bundle.romSha1);
  broke.coins = 2;
  const poor = new SlotController(bundle, broke, S.CHANCE_ORDINARY, mulberry32(4));
  poor.step(NO_PAD, true, false, 1 / 60);
  check("three coins you do not have is refused, and asks again",
        (poor.lines() || []).join(" ").indexOf("Not enough") >= 0 && broke.coins === 2,
        JSON.stringify(poor.lines()));

  const quit = PlayState.newPlayState(bundle.romSha1);
  quit.coins = 50;
  const leaving = new SlotController(bundle, quit, S.CHANCE_ORDINARY, mulberry32(4));
  check("B walks away from the machine",
        leaving.step(NO_PAD, false, true, 1 / 60) === SLOTS_CLOSED && !leaving.isOpen());
}

{
  // Rounds the machine has decided to give away: 255 every time buys the mood
  // that lets anything stand, over and over, so the reels can be watched doing
  // the steering rather than one lucky spin being asserted.
  const play = PlayState.newPlayState(bundle.romSha1);
  play.coins = 200;
  const m = new SlotController(bundle, play, S.CHANCE_ORDINARY, always(255));
  m.step(NO_PAD, true, false, 1 / 60);
  check("a roll of 255 deals the SEVEN-and-BAR mood",
        m.moodNow() === S.MOOD_HIGH, "" + m.moodNow());
  const paid = countRounds(m, play, 20, 17);
  check("and most of those rounds pay", paid.wins * 2 >= paid.rounds,
        JSON.stringify(paid));
  check("so the coins went up", play.coins > 200 - paid.rounds * 3,
        play.coins + " after " + paid.rounds + " rounds");
}

{
  // A machine in no mood at all: whatever lands, the third reel is nudged off
  // it, and it says so. $7604's `jr z` is the whole of that.
  const play = PlayState.newPlayState(bundle.romSha1);
  play.coins = 200;
  const m = new SlotController(bundle, play, S.CHANCE_ORDINARY, always(50));
  m.step(NO_PAD, true, false, 1 / 60);
  check("a roll of 50 deals no mood at all", m.moodNow() === S.MOOD_NONE, "" + m.moodNow());
  const mean = countRounds(m, play, 20, 17);
  check("and not one of twenty rounds pays, however the reels land",
        mean.wins === 0 && mean.rounds >= 20, JSON.stringify(mean));
  check("a mean machine only ever takes", play.coins < 200);
  check("each costing exactly the bet", play.coins === 200 - mean.rounds * 3,
        play.coins + " after " + mean.rounds + " rounds");
}

{
  // Out of coins ends the sitting, rather than asking for one more go.
  const play = PlayState.newPlayState(bundle.romSha1);
  play.coins = 3;
  const m = new SlotController(bundle, play, S.CHANCE_ORDINARY, bytes([50]));
  const log = sit(m, play, 4000, 17);
  check("the last three coins end it",
        log.some((l) => l.indexOf("Ran out of coins") >= 0) && !m.isOpen(),
        JSON.stringify(log));
}

{
  // The press that stops a reel cannot come while the one before it is still
  // slipping ($78A3), so three presses in three frames stop one reel.
  const play = PlayState.newPlayState(bundle.romSha1);
  play.coins = 100;
  const m = new SlotController(bundle, play, S.CHANCE_ORDINARY, mulberry32(9));
  m.step(NO_PAD, true, false, 1 / 60);
  for (let i = 0; i < 3; i++) {
    m.step(NO_PAD, true, false, 1 / 60);
  }
  const spinning = [0, 1, 2].filter((r) => m.faces(r).join("") === "").length;
  check("hammering A does not stop all three reels at once",
        (m.lines() || []).join(" ").indexOf("Start") >= 0, JSON.stringify(m.lines()) +
        " spinning " + spinning);
}

console.log("\n== Many rounds ==");
{
  // Nothing here is asserted about a single spin: the point is that the
  // machine keeps playing, pays the symbols it should and pays the two
  // expensive ones only rarely.
  const play = PlayState.newPlayState(bundle.romSha1);
  play.coins = 5000;
  const m = new SlotController(bundle, play, S.CHANCE_LUCKY, mulberry32(11));
  const wins = {};
  let spins = 0;
  let seen = "";
  for (let i = 0; i < 900000 && spins < 600; i++) {
    m.step(NO_PAD, i % 19 === 3, false, 1 / 60);
    const lines = (m.lines() || []).join(" ");
    if (lines !== seen) {
      seen = lines;
      if (lines.indexOf("Start") >= 0) { spins++; }
      if (lines.indexOf("lined up") >= 0) { wins[m.lined()] = (wins[m.lined()] || 0) + 1; }
    }
    if (play.coins > 4000) { play.coins = 4000; }
  }
  const total = Object.keys(wins).reduce((a, k) => a + wins[k], 0);
  check("six hundred rounds play through", spins >= 600, "" + spins);
  check("and some of them pay", total > 20, JSON.stringify(wins));
  check("every symbol it paid is one of the six",
        Object.keys(wins).every((k) => ["7", "BAR", "CHERRY", "FISH", "BIRD", "MOUSE"].indexOf(k) >= 0),
        JSON.stringify(wins));
  check("the two expensive ones stay rare",
        ((wins["7"] || 0) + (wins["BAR"] || 0)) * 10 < total,
        JSON.stringify(wins));
}

console.log("\n== The machines in the room ==");
{
  const machines = bundle.field.slotMachines.GAME_CORNER;
  check("thirty-six of them", machines.length === 36, "" + machines.length);
  const odd = machines.filter((m) => m.state !== "ok");
  check("three of which are never playable",
        odd.length === 3 &&
        odd.map((m) => m.state).sort().join(",") === "keys,out_of_order,out_to_lunch",
        JSON.stringify(odd));
  check("and the table can be asked about a cell",
        S.slotMachineAt(bundle, "GAME_CORNER", 18, 15) !== null &&
        S.slotMachineAt(bundle, "GAME_CORNER", 0, 0) === null);
  check("only the GAME CORNER has any",
        S.hasSlotMachines(bundle, "GAME_CORNER") &&
        !S.hasSlotMachines(bundle, "CELADON_MART_1F"));
}

function lensAt(x, y, opts) {
  const o = opts || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = "GAME_CORNER";
  state.cellX = x;
  state.cellY = y;
  state.facing = o.facing === undefined ? "right" : o.facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
  state.coins = o.coins === undefined ? 100 : o.coins;
  if (o.coinCase !== false) { state.bag.push({ id: "COIN_CASE", count: 1 }); }
  // The coins on the floor sit on some of these same cells; take them first
  // so the machine is what a press reaches.
  for (const flag of (o.flags || [])) { state.flags[flag] = true; }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true,
                                          answer: o.answer });
  lens.clearText();
  lens.settle();
  return lens;
}

function pressA(lens) {
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 3000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.slice(mark).join(" ");
}

/** The same, but B once the question is up: the answer is no. */
function pressB(lens) {
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 3000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("b"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.slice(mark).join(" ");
}

{
  // The broken three say so and do nothing else. (6,12) is out of order,
  // (13,12) is someone's lunch, (18,10) has the keys on it.
  const broken = lensAt(5, 12, { facing: "right" });
  check("the broken machine says OUT OF ORDER",
        pressA(broken).indexOf("OUT OF ORDER") >= 0 &&
        broken.events.every((e) => e.indexOf("slots:") !== 0));
  const lunch = lensAt(14, 12, { facing: "left" });
  check("the reserved one says OUT TO LUNCH", pressA(lunch).indexOf("OUT TO LUNCH") >= 0);
  const keys = lensAt(17, 10, { facing: "right" });
  check("and the one with the keys on it is spoken for",
        pressA(keys).indexOf("keys") >= 0);
}

{
  const noCase = lensAt(17, 15, { facing: "right", coinCase: false });
  check("no COIN CASE, no game", pressA(noCase).indexOf("COIN CASE") >= 0 &&
        noCase.events.every((e) => e.indexOf("slots:") !== 0),
        JSON.stringify(noCase.events));
  const noCoins = lensAt(17, 15, { facing: "right", coins: 0 });
  check("no coins either", pressA(noCoins).indexOf("any coins") >= 0 &&
        noCoins.events.every((e) => e.indexOf("slots:") !== 0));

  const asked = lensAt(17, 15, { facing: "right" });
  const said = pressB(asked);
  check("a machine offers a game", said.indexOf("slot machine") >= 0, said);
  check("and no is no", asked.events.every((e) => e.indexOf("slots:") !== 0),
        JSON.stringify(asked.events));

  const playing = lensAt(17, 15, { facing: "right" });
  pressA(playing);
  check("yes opens one, with that machine's own threshold",
        playing.events.some((e) => e.indexOf("slots:") === 0),
        JSON.stringify(playing.events.filter((e) => e.indexOf("slots:") === 0)));
  const opened = playing.events.filter((e) => e.indexOf("slots:") === 0)[0];
  const chance = opened ? parseInt(opened.split(":")[1], 10) : -1;
  check("which is 253 unless the room picked this one, and then 250",
        chance === S.CHANCE_ORDINARY || chance === S.CHANCE_LUCKY, "" + chance);

  // Below one is the wrong side: `and $08` rejects UP as it rejects DOWN.
  const below = lensAt(18, 16, { facing: "up" });
  const nothing = pressA(below);
  check("and a machine cannot be played from below it",
        below.events.every((e) => e.indexOf("slots:") !== 0), nothing);

  // Every machine but the three that are out has to be reachable from an
  // aisle, which is the whole reason the facing test reads the way it does.
  const machines = bundle.field.slotMachines.GAME_CORNER;
  const unreachable = machines.filter((m) => {
    const left = lensAt(m.x + 1, m.y, { facing: "left" });
    const right = lensAt(m.x - 1, m.y, { facing: "right" });
    pressA(left);
    pressA(right);
    const spoke = (l) => l.pages.length > 0 || l.events.some((e) => e.indexOf("slots:") === 0);
    return !spoke(left) && !spoke(right);
  });
  check("all thirty-six can be reached from an aisle", unreachable.length === 0,
        JSON.stringify(unreachable));
}

console.log("\nSLOTS " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
