// The SAFARI ZONE: the desk, the clock, and the two things you throw.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/safari.test.mjs Assets/Generated/kanto.json
//
// The numbers come out of the cartridge, not out of a guide: the gate's script
// is bank $1D at $524E..$5358, BAIT and ROCK are bank $03 at $5F52 and $5F67,
// what the POKeMON does on its turn is bank $01 at $4277, and whether it bolts
// is bank $0F at $4182.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const S = await import(P + "script/Safari.ts");
const { BattleRunner } = await import(P + "BattleRunner.ts");
const { ACTION_BAIT, ACTION_ROCK, ACTION_ITEM, ACTION_RUN } = await import(P + "battle/types.ts");
const { startSafariBattle, PHASE_OVER, RESULT_FLED, RESULT_FOE_FLED, RESULT_CAUGHT } =
  await import(P + "battle/BattleState.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: safari.test.mjs <bundle.json>");
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

/** A generator that hands out exactly these bytes, then zeros. */
function bytes(list) {
  let i = 0;
  return () => {
    const b = i < list.length ? list[i] : 0;
    i++;
    return b / 256;
  };
}
const always = (byte) => () => byte / 256;

console.log("== What the desk sells ==");
{
  check("five hundred yen", S.SAFARI_FEE === 500);
  check("thirty balls ($5322 writes $1E)", S.SAFARI_BALLS === 30);
  check("and five hundred and two steps ($5327 writes $01F6)",
        S.SAFARI_STEPS === 502, "" + S.SAFARI_STEPS);
  check("the clock runs in the Zone and not in the gate",
        S.inSafariZone("SAFARI_ZONE_WEST") && S.inSafariZone("SAFARI_ZONE_SECRET_HOUSE") &&
        !S.inSafariZone("SAFARI_ZONE_GATE") && !S.inSafariZone("FUCHSIA_CITY"));
}

console.log("\n== BAIT and a ROCK ==");
{
  // $5F5B `srl [hl]` and $5F70 `add a,a` with a ceiling.
  check("BAIT halves the catch rate", S.baitCatchRate(120) === 60 && S.baitCatchRate(45) === 22,
        S.baitCatchRate(45) + "");
  check("a ROCK doubles it", S.rockCatchRate(60) === 120);
  check("and a byte is as far as it goes", S.rockCatchRate(200) === 255);

  // $5F89: a three-bit roll, re-rolled while it is five or more, then plus one.
  check("one throw buys one to five turns",
        S.safariTurns(0) === 1 && S.safariTurns(4) === 5 && S.safariTurns(5) === -1 &&
        S.safariTurns(7) === -1, [0, 4, 5, 7].map(S.safariTurns).join(","));
  check("and they stack up to a byte", S.addTurns(3, 5) === 8 && S.addTurns(254, 5) === 255);
}

console.log("\n== What the POKeMON is doing ==");
{
  // $4277: eating is spent first, sulking only when there is none of it.
  const eating = S.safariTurnText(3, 2);
  check("eating comes first", eating.textId === S.TEXT_EATING && eating.eating === 2 &&
        eating.angry === 2 && !eating.restore, JSON.stringify(eating));
  const angry = S.safariTurnText(0, 2);
  check("then sulking", angry.textId === S.TEXT_ANGRY && angry.angry === 1 && !angry.restore,
        JSON.stringify(angry));
  const last = S.safariTurnText(0, 1);
  check("and the last sulking turn hands the catch rate back",
        last.angry === 0 && last.restore === true, JSON.stringify(last));
  const quiet = S.safariTurnText(0, 0);
  check("a POKeMON left alone says nothing", quiet.textId === "");
}

console.log("\n== Whether it bolts ==");
{
  // $4182: twice the base SPEED is the chance in 256.
  check("a slow one usually stays",
        !S.safariEscapes(30, 0, 0, 100) && S.safariEscapes(30, 0, 0, 10),
        "" + S.safariEscapes(30, 0, 0, 59));
  check("anything at 128 speed or over is gone whatever you threw",
        S.safariEscapes(128, 5, 0, 255) && S.safariEscapes(200, 5, 0, 0));
  check("eating quarters the chance",
        S.safariEscapes(60, 0, 0, 100) && !S.safariEscapes(60, 3, 0, 100),
        S.safariEscapes(60, 3, 0, 100) + "");
  check("and sulking doubles it",
        !S.safariEscapes(30, 0, 0, 70) && S.safariEscapes(30, 0, 3, 70));
  check("eating wins over sulking, because it is checked first",
        !S.safariEscapes(60, 3, 3, 100), "" + S.safariEscapes(60, 3, 3, 100));
}

console.log("\n== A battle in the Zone ==");
function safariBattle(species, level, random) {
  const party = [makeWildMon(bundle, "CHARMANDER", 20, () => 0.5)];
  const wild = makeWildMon(bundle, species, level, () => 0.5);
  return startSafariBattle(bundle, party, 0, wild, random);
}
const act = (kind) => ({ kind: kind, moveIndex: -1, partyIndex: -1, item: "" });
{
  // A byte whose low three bits are 4 buys the longest sulk or meal there is,
  // five turns, so one of them is left after the turn spends its own.
  const LONG = 204;
  const b = safariBattle("NIDORAN_M", 22, always(LONG));
  const rate = b.ctx.safariRate;
  check("it starts on the species' own catch rate",
        rate === bundle.species.NIDORAN_M.catchRate, rate + " vs " + bundle.species.NIDORAN_M.catchRate);
  const rock = b.takeTurn(act(ACTION_ROCK));
  check("a ROCK is thrown and doubles it",
        rock.ok && b.ctx.safariRate === Math.min(255, rate * 2) &&
        rock.messages.join(" ").indexOf("ROCK") >= 0,
        b.ctx.safariRate + " " + JSON.stringify(rock.messages));
  check("and it sulks for the rest of the five turns it bought",
        b.ctx.safariAngry === 4, "" + b.ctx.safariAngry);

  // $4161..$4182: the throw and the POKeMON's own turn are ONE pass of the
  // battle loop, so a throw that rolls a single turn has spent it by the time
  // the escape check reads the counter. That is the cartridge, not a bug.
  const brief = safariBattle("NIDORAN_M", 22, always(200));
  const was = brief.ctx.safariRate;
  brief.takeTurn(act(ACTION_ROCK));
  check("a one-turn throw is spent on the turn it is thrown",
        brief.ctx.safariAngry === 0 && brief.ctx.safariRate === was,
        brief.ctx.safariAngry + " rate " + brief.ctx.safariRate);

  const b2 = safariBattle("NIDORAN_M", 22, always(LONG));
  const start = b2.ctx.safariRate;
  const bait = b2.takeTurn(act(ACTION_BAIT));
  check("BAIT halves it and sets it eating",
        bait.ok && b2.ctx.safariRate === Math.floor(start / 2) && b2.ctx.safariEating === 4,
        b2.ctx.safariRate + " eating " + b2.ctx.safariEating);
  check("and the line says so", bait.messages.join(" ").indexOf("BAIT") >= 0,
        JSON.stringify(bait.messages));

  const b3 = safariBattle("NIDORAN_M", 22, always(LONG));
  b3.takeTurn(act(ACTION_BAIT));
  b3.takeTurn(act(ACTION_ROCK));
  check("one throw cancels the other",
        b3.ctx.safariEating === 0 && b3.ctx.safariAngry >= 1,
        b3.ctx.safariEating + "/" + b3.ctx.safariAngry);

  const runner = safariBattle("NIDORAN_M", 22, always(200));
  const ran = runner.takeTurn(act(ACTION_RUN));
  check("RUN always works in the Zone",
        ran.ended && runner.outcome().result === RESULT_FLED,
        runner.outcome().result + " " + JSON.stringify(ran.messages));

  // A MAGIKARP is catch rate 255 and slow: a ball ought to hold.
  const caught = safariBattle("MAGIKARP", 10, always(0));
  const ball = caught.takeTurn({ kind: ACTION_ITEM, moveIndex: -1, partyIndex: -1,
                                 item: "SAFARI_BALL" });
  check("a SAFARI BALL can catch one",
        caught.outcome().result === RESULT_CAUGHT,
        caught.outcome().result + " " + JSON.stringify(ball.messages));

  // A fast one with the roll against it leaves.
  const bolted = safariBattle("TAUROS", 28, bytes([0, 0, 0]));
  bolted.takeTurn(act(ACTION_BAIT));
  let turns = 0;
  while (bolted.outcome().result === "" && turns < 30) {
    bolted.takeTurn(act(ACTION_ROCK));
    turns++;
  }
  check("and a fast one eventually bolts",
        bolted.outcome().result === RESULT_FOE_FLED, bolted.outcome().result + " after " + turns);
}

console.log("\n== Nobody fights ==");
{
  const b = safariBattle("NIDORAN_M", 22, always(200));
  const mine = b.ctx.player.active;
  const before = mine.hp;
  for (let i = 0; i < 6 && b.outcome().result === ""; i++) {
    b.takeTurn(act(ACTION_BAIT));
  }
  check("the player's POKeMON is never touched", mine.hp === before, mine.hp + "/" + before);
  const theirs = b.ctx.foe.active;
  check("and neither is theirs", theirs.hp === theirs.maxHp);
}

console.log("\n== The runner's own menu ==");
function safariView(picks) {
  let i = 0;
  const seen = [];
  const rows = [];
  const view = {
    seen, rows,
    showLines: (lines) => seen.push(lines.join(" ")),
    acknowledged: () => true,
    hideBox: () => {},
    showMoves: () => {},
    chosenMove: () => -1,
    hideMoves: () => {},
    wantsToRun: () => false,
    chosenSwitch: () => -1,
    chosenBagItem: () => "",
    chosenBagTarget: () => -1,
    askLearn: () => {},
    learnDecision: () => -1,
    sound: () => {},
    showSafariMenu: (balls) => { rows.push(balls); view.open = true; },
    chosenSafari: () => {
      if (!view.open) { return ""; }
      view.open = false;
      const pick = i < picks.length ? picks[i] : "run";
      i++;
      return pick;
    },
  };
  return view;
}
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.playerName = "RED";
  play.safariBalls = 3;
  play.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
  const view = safariView(["bait", "rock", "run"]);
  const runner = new BattleRunner(bundle, play, view);
  check("a Safari encounter starts", runner.startSafari("NIDORAN_M", 22, always(200)));
  let n = 0;
  while (runner.isRunning() && n < 4000) { runner.update(); n++; }
  check("the menu counted the balls on its first row", view.rows.length > 0 && view.rows[0] === 3,
        JSON.stringify(view.rows));
  check("it threw both and then left",
        view.seen.join(" ").indexOf("BAIT") >= 0 && view.seen.join(" ").indexOf("ROCK") >= 0,
        JSON.stringify(view.seen));
  check("and no ball was spent", play.safariBalls === 3, "" + play.safariBalls);

  const spent = PlayState.newPlayState(bundle.romSha1);
  spent.playerName = "RED";
  spent.safariBalls = 5;
  spent.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
  const view2 = safariView(["ball", "run"]);
  const runner2 = new BattleRunner(bundle, spent, view2);
  runner2.startSafari("TAUROS", 28, always(200));
  let m = 0;
  while (runner2.isRunning() && m < 4000) { runner2.update(); m++; }
  check("a ball comes off the counter, not the bag",
        spent.safariBalls === 4 && spent.bag.length === 0,
        spent.safariBalls + " " + JSON.stringify(spent.bag));
}

console.log("\n== The gate ==");
function atGate(x, y, opts) {
  const o = opts || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = o.map === undefined ? "SAFARI_ZONE_GATE" : o.map;
  state.cellX = x;
  state.cellY = y;
  state.facing = o.facing === undefined ? "up" : o.facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
  state.money = o.money === undefined ? 2000 : o.money;
  if (o.inSafari) {
    state.flags.EVENT_IN_SAFARI_ZONE = true;
    state.safariBalls = o.balls === undefined ? 30 : o.balls;
    state.safariSteps = o.steps === undefined ? 502 : o.steps;
  }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

function walk(lens, steps) {
  lens.run(steps);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 4000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.join(" ");
}

{
  const joining = atGate(3, 4, {});
  const said = walk(joining, [{ walk: "up", n: 2 }]);
  check("walking up to the counter is asked to join", said.indexOf("join the hunt") >= 0, said);
  check("¥500 changes hands", joining.play.money === 1500, "" + joining.play.money);
  check("thirty balls and five hundred and two steps",
        joining.play.safariBalls === 30 && joining.play.safariSteps === 502,
        joining.play.safariBalls + "/" + joining.play.safariSteps);
  check("and the hunt is on", joining.play.flags.EVENT_IN_SAFARI_ZONE === true);

  const poor = atGate(3, 4, { money: 100 });
  const refused = walk(poor, [{ walk: "up", n: 2 }]);
  check("without the money it says so and nothing is sold",
        refused.toLowerCase().indexOf("not enough money") >= 0,
        refused);
  check("no balls, no clock", poor.play.safariBalls === 0 && poor.play.safariSteps === 0 &&
        poor.play.money === 100);

  const leaving = atGate(3, 1, { inSafari: true, facing: "down" });
  const bye = walk(leaving, [{ walk: "down", n: 1 }]);
  check("walking back in is asked whether it is over early",
        bye.indexOf("Leaving early") >= 0, bye);
  check("the balls go back and the clock stops",
        leaving.play.safariBalls === 0 && leaving.play.safariSteps === 0 &&
        leaving.play.flags.EVENT_IN_SAFARI_ZONE !== true,
        leaving.play.safariBalls + "/" + leaving.play.safariSteps);
}

{
  // The clock: one step spends one, and the last one calls the player back.
  const hunting = atGate(15, 15, { map: "SAFARI_ZONE_CENTER", inSafari: true, steps: 4 });
  walk(hunting, [{ walk: "down", n: 1 }]);
  check("a step in the Zone costs one", hunting.play.safariSteps === 3,
        "" + hunting.play.safariSteps);
  const over = atGate(15, 15, { map: "SAFARI_ZONE_CENTER", inSafari: true, steps: 1 });
  const pa = walk(over, [{ walk: "down", n: 1 }]);
  check("the last one calls you over the PA", pa.indexOf("PA") >= 0 || pa.indexOf("Ding") >= 0,
        pa);
  check("and puts you in the gate with nothing left",
        over.state().map === "SAFARI_ZONE_GATE" && over.play.safariBalls === 0 &&
        over.play.flags.EVENT_IN_SAFARI_ZONE !== true,
        over.state().map + " balls " + over.play.safariBalls);

  const outside = atGate(5, 5, { map: "FUCHSIA_CITY", inSafari: true, steps: 4 });
  walk(outside, [{ walk: "down", n: 1 }]);
  check("and the clock does not run outside the Zone", outside.play.safariSteps === 4,
        "" + outside.play.safariSteps);
}

console.log("\nSAFARI " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
