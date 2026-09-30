// Viridian Mart's entry mat: OAK'S PARCEL. ViridianMartScript0's coordinate
// event, measured on the cartridge (tools/oracle, 6 sep; FINDINGS.md "The
// Viridian Mart clerk does not call you over"): landing on the mat (3,7)
// with a starter chosen and the parcel not yet owned shows "Hey! You came
// from PALLET TOWN?" AT ONCE, on the mat; on A the cartridge walks the
// player itself (up two, left one) to (2,5) facing the counter, where the
// quest text and "RED got OAK's PARCEL!" print in one box and the flag is
// set. Landing again does not replay it, and talking to the clerk resolves
// through the ordinary (transcribed) table afterward.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/viridianmart.test.mjs Assets/Generated/kanto.json

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const bundlePath = process.argv[2];
if (!bundlePath) { console.error("usage: viridianmart.test.mjs <bundle.json>"); process.exit(2); }
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
globalThis.print = () => {};
globalThis.getTime = () => 0;

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

/**
 * One cell short of the mat, facing the door: VIRIDIAN_MART (3,6) facing
 * down, a starter already chosen. `walk down 1` lands on (3,7), where the
 * trigger should own the frame. `startFlags`/`startBag` seed a state past
 * the errand, for the "arriving again" and "the clerk afterward" cases.
 */
function beforeMat(startFlags, startBag) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = "VIRIDIAN_MART";
  state.cellX = 3;
  state.cellY = 6;
  state.facing = "down";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 6, () => 0.5));
  if (startFlags) { for (const f of startFlags) { state.flags[f] = true; } }
  if (startBag) { for (const item of startBag) { state.bag.push(item); } }
  return new HeadlessLens(bundle, { state });
}

console.log("\n== Landing on the mat fires the parcel scene ==");
{
  const lens = beforeMat();
  const linesBefore = lens.lines.length;
  lens.run([{ walk: "down", n: 1 }]);
  const onMat = lens.state();
  check("the mat is reached and the cutscene owns the frame at once",
        onMat.map === "VIRIDIAN_MART" && onMat.x === 3 && onMat.y === 7 && lens.loop.isBusy(),
        JSON.stringify(onMat) + " busy=" + lens.loop.isBusy());
  check("the greeting is on screen before any button is pressed",
        lens.pages.length > 0 && lens.pages[0].indexOf("PALLET TOWN") >= 0,
        JSON.stringify(lens.pages));

  lens.run([{ text: "PARCEL!", max: 100 }, { press: "a" }, { wait: 60 }]);
  const said = lens.lines.slice(linesBefore).join(" ");
  check("the lines match the cartridge: the greeting, the errand, the pickup",
        said.indexOf("PALLET TOWN") >= 0 && said.indexOf("PROF") >= 0 &&
        said.indexOf("PARCEL") >= 0,
        said);
  const done = lens.state();
  check("the walk: the cartridge's own move_player lands at the counter",
        done.map === "VIRIDIAN_MART" && done.x === 2 && done.y === 5 && done.facing === "left" && !lens.loop.isBusy(),
        JSON.stringify(done));
  check("the bag: OAKS_PARCEL entered as a key item",
        lens.play.bag.length === 1 && lens.play.bag[0].id === "OAKS_PARCEL" && lens.play.bag[0].count === 1,
        JSON.stringify(lens.play.bag));
  check("the flag the trigger disarms on is set",
        lens.play.flags.EVENT_GOT_OAKS_PARCEL === true);
}

console.log("\n== Landing on the mat again does not replay it ==");
{
  // (3,7) is also the door's own warp tile (VIRIDIAN_MART's warps table
  // sends it to LAST_MAP): with nothing to intercept the landing, the
  // cartridge's own doormat rule takes the step straight back outside --
  // that IS "arriving again does not fire the cutscene", not the trigger
  // holding the player on the mat.
  const lens = beforeMat(["EVENT_GOT_OAKS_PARCEL"], [{ id: "OAKS_PARCEL", count: 1 }]);
  const linesBefore = lens.lines.length;
  lens.run([{ walk: "down", n: 1 }, { wait: 30 }]);
  const s = lens.state();
  check("no cutscene ever owns the frame; the ordinary doormat handles the step",
        s.map !== "VIRIDIAN_MART" && !lens.loop.isBusy() && lens.lines.length === linesBefore,
        JSON.stringify(s) + " busy=" + lens.loop.isBusy());
  check("the parcel is not duplicated",
        lens.play.bag.length === 1 && lens.play.bag[0].count === 1, JSON.stringify(lens.play.bag));
}

console.log("\n== Without a starter, the mat does nothing (the trigger's own guard) ==");
{
  const lens = beforeMat();
  lens.play.flags.EVENT_GOT_STARTER = false;
  const linesBefore = lens.lines.length;
  lens.run([{ walk: "down", n: 1 }, { wait: 30 }]);
  const s = lens.state();
  check("landing on the mat is an ordinary (door) step with no starter chosen",
        s.map !== "VIRIDIAN_MART" && !lens.loop.isBusy() && lens.lines.length === linesBefore,
        JSON.stringify(s) + " busy=" + lens.loop.isBusy());
  check("no item appears from a guard that should not have armed",
        lens.play.bag.length === 0, JSON.stringify(lens.play.bag));
}

console.log("\n== The clerk resolves normally afterward, through the shop's own table ==");
{
  // (2,5) facing left is where the errand's own walk leaves the player,
  // directly at the counter. Measured on the cartridge (tools/oracle, 6
  // sep): with the parcel owned but not yet delivered, talking to the
  // clerk again answers "Okay! Say hi to PROF.OAK for me!" -- the
  // transcribed table's own repeat-visit line -- not a replay of the
  // walk-in cutscene, and not a shop (that needs delivering the parcel to
  // Oak first, a separate, not-yet-built errand: see FINDINGS.md).
  const lens = beforeMat(["EVENT_GOT_OAKS_PARCEL"], [{ id: "OAKS_PARCEL", count: 1 }]);
  lens.run([{ walk: "up", n: 1 }, { walk: "left", n: 1 }]);
  const at = lens.state();
  check("the walk back to the counter is ordinary (the mat is behind, disarmed)",
        at.x === 2 && at.y === 5 && at.facing === "left", JSON.stringify(at));
  const linesBefore = lens.lines.length;
  lens.run([{ talk: true }]);
  const said = lens.lines.slice(linesBefore).join(" ");
  check("the clerk answers from the transcribed table, not the entry cutscene",
        said.indexOf("Say hi") >= 0 && said.indexOf("PALLET TOWN") < 0, said);
  check("the parcel is still exactly one, untouched by talking",
        lens.play.bag.length === 1 && lens.play.bag[0].count === 1, JSON.stringify(lens.play.bag));
}

console.log("\nVIRIDIANMART " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
