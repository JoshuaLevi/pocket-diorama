// CINNABAR GYM's quiz machines (play/script/CinnabarQuiz.ts).
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/cinnabarquiz.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The table against the bundle (every machine a cell you can stand below,
// every line in the text, every trainer an object with a class), then two
// machines through the headless lens: a right answer opens the door without
// a fight, a wrong one wakes the room's trainer and beating him opens it.
//
// --selftest flips machine 1's answer and expects the door to stay shut.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const SELFTEST = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: cinnabarquiz.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.getTime = () => 0;

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const Quiz = await import("../Assets/Scripts/play/script/CinnabarQuiz.ts");
const PlayState = await import("../Assets/Scripts/play/PlayState.ts");
const { makeWildMon } = await import("../Assets/Scripts/play/battle/Stats.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL  " + label + (detail !== undefined ? "\n          " + detail : ""));
}

const gym = bundle.maps.CINNABAR_GYM;

console.log("== the six machines ==");
{
  check("six of them, questions one to six", Quiz.QUIZ_MACHINES.length === 6 &&
        Quiz.QUIZ_MACHINES.map((m) => m.question).join("") === "123456");
  check("the right answers are the cartridge's: YES NO NO NO YES NO",
        Quiz.QUIZ_MACHINES.map((m) => (m.yes ? "Y" : "N")).join("") === "YNNNYN");
  const missing = [];
  for (const m of Quiz.QUIZ_MACHINES) {
    for (const t of [Quiz.quizQuestionText(m.question), Quiz.TEXT_QUIZ_INTRO, Quiz.TEXT_QUIZ_CORRECT, Quiz.TEXT_QUIZ_INCORRECT]) {
      if (typeof bundle.text[t] !== "string") missing.push(t);
    }
  }
  check("every line is in the text", missing.length === 0, missing.join(","));
  const gates = (bundle.blockOverrides.CINNABAR_GYM || []);
  const unpaired = Quiz.QUIZ_MACHINES.filter((m) => !gates.some((g) =>
    g.flags.indexOf(Quiz.quizGateFlag(m.question)) >= 0 && g.flags.indexOf(Quiz.quizTrainerFlag(m.question)) >= 0));
  check("every machine's gate flag and trainer flag open the same door in the bundle", unpaired.length === 0,
        JSON.stringify(unpaired));
  const noTrainer = Quiz.QUIZ_MACHINES.filter((m) => {
    const o = gym.objects.filter((x) => x.index === m.question + 2)[0];
    return !o || !o.trainerClass || typeof bundle.text["_CinnabarGymSuperNerd" + (m.question + 1) + "BattleText"] !== "string";
  });
  check("and the room's trainer is object n+2, with a class and his lines", noTrainer.length === 0, JSON.stringify(noTrainer));
  check("a machine is read from below, facing up, and nowhere else",
        Quiz.quizScript("CINNABAR_GYM", 15, 7, "up", gym.objects) !== null &&
        Quiz.quizScript("CINNABAR_GYM", 15, 7, "left", gym.objects) === null &&
        Quiz.quizScript("CINNABAR_GYM", 14, 7, "up", gym.objects) === null &&
        Quiz.quizScript("CELADON_GYM", 15, 7, "up", gym.objects) === null);
}

function stand(x, y) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.flags.EVENT_INTRO_DONE = true;
  state.party = [makeWildMon(bundle, "BLASTOISE", 50, () => 0.5)];
  state.mapId = "CINNABAR_GYM"; state.cellX = x; state.cellY = y; state.facing = "up";
  return new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
}

/** A press of A at the machine, then its pages; `yes` answers the question. */
function answer(lens, yes) {
  lens.press("a");
  for (let i = 0; i < 60; i++) {
    let waited = 0;
    while (!lens.pageWaiting && lens.loop.isBusy() && waited < 120) { lens.frame(); waited++; }
    if (!lens.pageWaiting) break;
    waited = 0;
    while (!lens.loop.textReady() && waited < 400) { lens.frame(); waited++; }
    lens.press(lens.answerWanted && !yes ? "b" : "a");
  }
  for (let i = 0; i < 60 && lens.loop.isBusy(); i++) lens.frame();
}

console.log("== machine 1, answered right ==");
{
  const lens = stand(15, 8);
  answer(lens, SELFTEST ? false : true);
  const flags = lens.play.flags;
  check("CATERPIE does evolve into BUTTERFREE: the gate is unlocked",
        flags[Quiz.quizGateFlag(1)] === true, JSON.stringify(Object.keys(flags).filter((f) => f.indexOf("CINNABAR") >= 0)));
  check("and nobody had to be fought", lens.battles.length === 0, lens.battles.join(","));
  check("with the door's own sound", lens.sounds.join(",").indexOf("Go_Inside") >= 0 || lens.events.join(",").indexOf("Go_Inside") >= 0,
        JSON.stringify(lens.sounds));
}

console.log("== machine 2, answered wrong ==");
{
  const lens = stand(10, 2);
  answer(lens, true);
  const flags = lens.play.flags;
  check("nine BADGEs is a bad call: the gate stays locked by the quiz", flags[Quiz.quizGateFlag(2)] !== true);
  const nerd = gym.objects.filter((o) => o.index === 4)[0];
  check("and the room's trainer fights", lens.battles.length === 1 &&
        lens.battles[0] === nerd.trainerClass + "#" + nerd.trainerParty, lens.battles.join(","));
  check("beating him is what opens the door", flags[Quiz.quizTrainerFlag(2)] === true);
  const again = stand(10, 2);
  again.play.flags[Quiz.quizTrainerFlag(2)] = true;
  answer(again, true);
  check("a beaten trainer is not woken twice", again.battles.length === 0, again.battles.join(","));
}

const verdict = fail === 0 ? "OK" : "FAILED";
console.log(`CINNABARQUIZ ${pass} PASS  ${fail} FAIL  ${verdict}`);
if (SELFTEST) {
  if (fail === 0) { console.log("SELFTEST FAILED: a wrong answer opened the gate"); process.exit(1); }
  console.log("SELFTEST OK: the planted fault was caught");
  process.exit(0);
}
process.exit(fail === 0 ? 0 : 1);
