// The ROCKET HIDEOUT's arrow tiles, and the two doors that sound.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/hideout.test.mjs Assets/Generated/kanto.json
//
// scripts/RocketHideoutB2F.asm:17-81 (the table), home/map_objects.asm:5-27
// (the run-length list it decodes) and RocketHideoutB1F.asm:11-32 /
// RocketHideoutB4F.asm:11-31 (the doors).

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { spinnerAt, spinnerScript } = await import(P + "Spinners.ts");
const { enterScriptFor } = await import(P + "script/MapScripts.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: hideout.test.mjs <bundle.json>");
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

function lensAt(mapId, x, y, facing, flags) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 30, () => 0.5));
  for (const f of flags || []) { state.flags[f] = true; }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

function drive(lens, limit) {
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < (limit || 8000)) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens;
}

console.log("== The table the floor is made of ==");
{
  const rows = bundle.field.spinners.ROCKET_HIDEOUT_B2F;
  check("B2F has all forty-three arrow tiles", rows.length === 43, "" + rows.length);
  check("and B3F sixteen, and Viridian Gym twelve",
        bundle.field.spinners.ROCKET_HIDEOUT_B3F.length === 16 &&
        bundle.field.spinners.VIRIDIAN_GYM.length === 12);
  const one = spinnerAt(bundle, "ROCKET_HIDEOUT_B2F", 4, 9);
  check("a tile answers with its own run", one !== null && one[0].dir === "left" && one[0].count === 2,
        JSON.stringify(one));
  check("an ordinary cell answers with nothing",
        spinnerAt(bundle, "ROCKET_HIDEOUT_B2F", 15, 10) === null &&
        spinnerAt(bundle, "ROCKET_HIDEOUT_B1F", 4, 9) === null);
  const script = spinnerScript(spinnerAt(bundle, "ROCKET_HIDEOUT_B2F", 4, 15));
  check("the floor clicks before it moves you",
        script[0].op === "play_once" && script[0].track === "Arrow_Tiles" &&
        script.slice(1).every((c) => c.op === "move_player"), JSON.stringify(script));
  check("and a two-leg run is two moves",
        script.length === 3 && script[1].direction === "right" && script[2].direction === "up",
        JSON.stringify(script));
}

console.log("\n== Sliding, through the lens ==");
{
  // (4,10) is ordinary; the tile below it at (4,11) slides four right.
  const lens = lensAt("ROCKET_HIDEOUT_B2F", 4, 10, "down");
  lens.run([{ walk: "down", n: 1 }]);
  drive(lens);
  const at = lens.state();
  check("stepping onto an arrow tile takes you with it",
        at.x === 8 && at.y === 11, at.x + "," + at.y);
  check("and the floor was heard", lens.sounds.indexOf("once:Arrow_Tiles") >= 0,
        JSON.stringify(lens.sounds));
}

console.log("\n== The two doors ==");
{
  check("B1F's gate says nothing until its guard is beaten",
        enterScriptFor("ROCKET_HIDEOUT_B1F").length > 0);
  const shut = lensAt("ROCKET_HIDEOUT_B1F", 21, 3, "down");
  check("so nothing sounds on the way in", shut.sounds.indexOf("Go_Inside") < 0,
        JSON.stringify(shut.sounds));
  const open = lensAt("ROCKET_HIDEOUT_B1F", 21, 3, "down", ["EVENT_BEAT_ROCKET_HIDEOUT_1_TRAINER_4"]);
  check("and it sounds once the way is open", open.sounds.indexOf("Go_Inside") >= 0,
        JSON.stringify(open.sounds));
  const half = lensAt("ROCKET_HIDEOUT_B4F", 19, 11, "down", ["EVENT_BEAT_ROCKET_HIDEOUT_4_TRAINER_0"]);
  check("GIOVANNI's door needs BOTH guards", half.sounds.indexOf("Go_Inside") < 0,
        JSON.stringify(half.sounds));
  const both = lensAt("ROCKET_HIDEOUT_B4F", 19, 11, "down",
                      ["EVENT_BEAT_ROCKET_HIDEOUT_4_TRAINER_0", "EVENT_BEAT_ROCKET_HIDEOUT_4_TRAINER_1"]);
  check("and opens with both", both.sounds.indexOf("Go_Inside") >= 0, JSON.stringify(both.sounds));
}

console.log("== the player spins on the slide ==");
{
  // spinners.asm:54-61: a quarter clockwise on every step, while the walk
  // keeps its direction. Drawing reads spriteFacing; rules read facing.
  const { HeadlessLens } = await import("./headless.mjs");
  const PlayState = await import(P + "PlayState.ts");
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_INTRO_DONE = true;
  const tile = bundle.field.spinners.ROCKET_HIDEOUT_B2F.filter((r) => r.moves.length > 0 && r.moves[0].count >= 3)[0];
  const d = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[tile.moves[0].dir];
  // Stand one cell before the tile, on the side its run does NOT leave by, and step onto it.
  const map = bundle.maps.ROCKET_HIDEOUT_B2F;
  let from = null;
  let press = "";
  for (const [dir, dx, dy] of [["right", -1, 0], ["left", 1, 0], ["down", 0, -1], ["up", 0, 1]]) {
    state.mapId = "ROCKET_HIDEOUT_B2F"; state.cellX = tile.x + dx; state.cellY = tile.y + dy; state.facing = dir;
    const probe = new HeadlessLens(bundle, { state: JSON.parse(JSON.stringify(state)), wanderers: false, noWild: true });
    if (probe.overworld.map.canEnter(tile.x + dx, tile.y + dy)) { from = [tile.x + dx, tile.y + dy]; press = dir; break; }
  }
  check("there is a cell to step onto the tile from", from !== null, JSON.stringify(tile));
  state.cellX = from[0]; state.cellY = from[1]; state.facing = press;
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  check("standing still he looks the way he faces", lens.overworld.spriteFacing() === lens.overworld.facing);
  // Frame by frame: lens.walk() would settle the whole slide before returning.
  const seen = [];
  lens.input.hold(press);
  let started = false;
  for (let i = 0; i < 900; i++) {
    lens.frame();
    if (lens.overworld.spinning) {
      started = true;
      lens.input.hold("");
      const f = lens.overworld.spriteFacing();
      if (seen[seen.length - 1] !== f) seen.push(f);
    } else if (started) {
      break;
    }
  }
  lens.input.hold("");
  check("on the slide the sprite goes round, a quarter a step", seen.length >= 3 &&
        seen.every((f, i) => i === 0 || ["down", "left", "up", "right"].indexOf(f) === (["down", "left", "up", "right"].indexOf(seen[i - 1]) + 1) % 4),
        JSON.stringify(seen));
  check("and when the slide ends he faces the way he went", !lens.overworld.spinning &&
        lens.overworld.spriteFacing() === lens.overworld.facing, lens.overworld.facing);
}

console.log("\nHIDEOUT " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
