// Oak stops you at the top of Pallet Town and walks you to his lab: the
// cartridge's PalletTownScript0-3 and OaksLabScript6-7, measured on the
// ROM (tools/oracle/scenarios/oak-escort*.json) and replayed headlessly here.
import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const bundlePath = process.argv[2];
if (!bundlePath) { console.error("usage: escort.test.mjs <bundle.json>"); process.exit(2); }
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "ESCORT", "Red's Pallet Town escort geometry");
globalThis.print = () => {};

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

function newGame(flags) {
  const lens = new HeadlessLens(bundle, {});
  lens.play.playerName = "RED";
  lens.play.rivalName = "BLUE";
  lens.clearText();
  if (flags) for (const f of flags) lens.play.flags[f] = true;
  return lens;
}

// Bedroom to the top of town, the route every oracle scenario takes.
function toTheTop(lens, column) {
  lens.run([
    { walk: "left", n: 1 }, { walk: "up", n: 4 }, { walk: "right", n: 5 }, { walk: "up", n: 1 }, { wait: 90 },
    { walk: "down", n: 1 }, { walk: "left", n: 5 }, { walk: "down", n: 5 }, { wait: 90 },
    { walk: "right", n: 4 }, { walk: "up", n: 4 }, { walk: "right", n: column === 11 ? 2 : 1 },
  ]);
}

for (const column of [10, 11]) {
  console.log("\n== The escort from column " + column + " ==");
  const lens = newGame();
  toTheTop(lens, column);
  const before = lens.state();
  check("standing below the exit", before.map === "PALLET_TOWN" && before.x === column && before.y === 2, JSON.stringify(before));
  lens.run([{ walk: "up", n: 1 }]);
  const stopped = lens.state();
  check("Oak stops you on the top row, turned to face him", stopped.map === "PALLET_TOWN" && stopped.y === 1 && stopped.facing === "down" && lens.loop.isBusy(),
        JSON.stringify(stopped) + " busy=" + lens.loop.isBusy());
  const linesBefore = lens.lines.length;
  lens.run([{ text: "have one too!", max: 400 }, { press: "a" }, { wait: 90 }]);
  const after = lens.state();
  const said = lens.lines.slice(linesBefore).join(" ");
  check("you end up in the lab at (5,3) beside BLUE, facing Oak", after.map === "OAKS_LAB" && after.x === 5 && after.y === 3 && after.facing === "up",
        JSON.stringify(after));
  check("and the script has let go", !lens.loop.isBusy() && !lens.pageWaiting);
  check("Oak's warning was said", said.indexOf("It's unsafe!") >= 0 && said.indexOf("come with") >= 0, said.slice(0, 120));
  check("BLUE complained and Oak told him to be patient", said.indexOf("fed up with") >= 0 && said.indexOf("Be patient!") >= 0);
  check("the escort flag is set", lens.play.flags.EVENT_FOLLOWED_OAK_INTO_LAB === true);
  const reveals = lens.loop.reveals();
  check("Oak has left Pallet Town and stands at his desk", reveals["PALLET_TOWN:PALLETTOWN_OAK"] !== true && reveals["OAKS_LAB:OAKSLAB_OAK1"] === true && reveals["OAKS_LAB:OAKSLAB_OAK2"] !== true,
        JSON.stringify(reveals));
  check("the desk Oak has a body at (5,2)", lens.overworld.map.objectAt(5, 2) !== null);
}

console.log("\n== Once escorted, the top of town is just the way to Route 1 ==");
{
  const lens = newGame(["EVENT_FOLLOWED_OAK_INTO_LAB"]);
  toTheTop(lens, 10);
  lens.run([{ walk: "up", n: 1 }]);
  const s = lens.state();
  check("no Oak, no script", s.map === "PALLET_TOWN" && s.y === 1 && s.facing === "up" && !lens.loop.isBusy(), JSON.stringify(s));
  lens.run([{ walk: "up", n: 2 }]);
  check("and the next step is Route 1", lens.state().map === "ROUTE_1", lens.state().map);
}

// ---------------------------------------------------------------------------
// The Pewter museum guide (PewterCity.asm:209-237, auto_movement.asm:160-204).
// Say you have not been to the museum and he walks you there. Four sides to
// talk to him from, one route, and his RLE list is walked BACKWARDS -- UP 6,
// LEFT 13, UP 3 -- because wSimulatedJoypadStatesIndex counts down from the
// end of the decoded buffer (home/overworld.asm:1844-1856). Read forwards the
// route runs along row 14, which is the front wall of three buildings.
const PlayState = await import("../Assets/Scripts/play/PlayState.ts");
const { makeWildMon } = await import("../Assets/Scripts/play/battle/Stats.ts");

function inPewter(x, y, facing) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = "PEWTER_CITY";
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_BEAT_BROCK = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 14, () => 0.5));
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

function talkAndRun(lens, answer) {
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 30000) {
    if (lens.answerWanted && lens.loop.textReady()) { lens.press(answer ? "a" : "b"); n += 6; continue; }
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
}

console.log("\n== The museum guide ==");
{
  const yes = inPewter(27, 18, "up");
  const mark = yes.pages.length;
  talkAndRun(yes, true);
  const said = yes.pages.slice(mark).join(" ");
  check("saying you have been leaves you where you stand",
        said.indexOf("fossils") >= 0 && yes.state().x === 27 && yes.state().y === 18, said.slice(0, 120));
}
for (const [x, y, facing, side] of [[27, 18, "up", "below him"], [27, 16, "down", "above him"],
                                    [26, 17, "right", "west of him"], [28, 17, "left", "east of him"]]) {
  const lens = inPewter(x, y, facing);
  talkAndRun(lens, false);
  const s = lens.state();
  check("from " + side + ", he walks you to the museum door at (14,8)",
        s.map === "PEWTER_CITY" && s.x === 14 && s.y === 8, s.map + " " + s.x + "," + s.y);
  const pose = lens.npcMotion.pose("PEWTERCITY_SUPER_NERD1");
  check("and goes back to his own post afterwards",
        pose !== null && pose.x === 27 && pose.y === 17, JSON.stringify(pose));
}
{
  // The door itself is at (14,7): one cell further and the escort would walk
  // the player inside in the middle of his sentence.
  const lens = inPewter(27, 18, "up");
  talkAndRun(lens, false);
  check("never through the door", lens.state().map === "PEWTER_CITY", lens.state().map);
  check("and he has said his piece", lens.pages.join(" ").indexOf("right here") >= 0,
        lens.pages.slice(-3).join(" | "));
}

console.log("\nESCORT " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
