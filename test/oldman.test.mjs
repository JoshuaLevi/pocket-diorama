// The Viridian old man, once he is up: coffee, a question, and the lesson.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/oldman.test.mjs Assets/Generated/kanto.json
//
// ViridianCity.asm: ViridianCityOldManText asks "Are you in a hurry?" and
// sends YES -- wCurrentMenuItem 0 -- to "Time is money"; NO gets "I see you're
// using a POKeDEX", the catching demonstration on the battle stage
// (BattleRunner.startDemo, checked in battlerunner.test.mjs), and then "First,
// you need to weaken the target POKeMON." The headless lens has no stage, so
// the host's old_man_demo answers at once and the two lines meet.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { requiredRoutines } = await import(P + "script/MapScripts.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: oldman.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "OLDMAN", "Red's old man; Yellow's is in yellow.test.mjs");
globalThis.print = () => {};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

/** In Viridian with the POKeDEX, which is what stands the old man up at (17,5). */
function lensBelowHim() {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = "VIRIDIAN_CITY";
  state.cellX = 17;
  state.cellY = 6;
  state.facing = "up";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_GOT_POKEDEX = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 8, () => 0.5));
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

function talk(lens, answer) {
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 6000) {
    if (lens.answerWanted && lens.loop.textReady()) { lens.press(answer ? "a" : "b"); n += 6; continue; }
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.slice(mark).join(" | ");
}

console.log("== The old man is up once the POKeDEX is yours ==");
{
  const lens = lensBelowHim();
  const said = talk(lens, true);
  check("he has had his coffee", said.indexOf("coffee") >= 0, said.slice(0, 160));
  check("YES, in a hurry: time is money", said.indexOf("Time is money") >= 0, said);
  check("and no lesson", said.indexOf("weaken") < 0 && said.indexOf("POKéDEX") < 0, said);
}
{
  const lens = lensBelowHim();
  const said = talk(lens, false);
  check("NO: he notices the POKeDEX", said.indexOf("POKéDEX") >= 0, said.slice(0, 200));
  check("and after the demonstration tells you to weaken the target",
        said.indexOf("weaken") >= 0, said);
  check("in that order", said.indexOf("POKéDEX") < said.indexOf("weaken"), said);
  check("with nothing added to the party", lens.play.party.length === 1);
}
{
  check("old_man_demo is on the host contract", requiredRoutines().indexOf("old_man_demo") >= 0);
}

console.log("\nOLDMAN " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
