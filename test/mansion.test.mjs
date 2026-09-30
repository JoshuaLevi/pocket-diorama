// The POKeMON MANSION's switches.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/mansion.test.mjs Assets/Generated/kanto.json
//
// None of this is in the extraction -- the mansion's floors ship with no bg
// events -- so the cells and the doors were read out of the cartridge: the
// switch handlers at bank $11 $4316 and bank $14 $6037/$627A/$6420, the
// hidden-object entries that name them, and the redraw routines at bank $11
// $42C5 and bank $14 $5FEE/$6204/$63CF.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const M = await import(P + "script/Mansion.ts");
const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { BlockOverrideIndex } = await import("../Assets/Scripts/world/BlockOverrides.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: mansion.test.mjs <bundle.json>");
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

const OVERRIDES = M.mansionOverrides();

console.log("== The tables ==");
{
  check("all four floors have doors", M.mansionFloors().length === 4,
        M.mansionFloors().join(","));
  check("and each floor has its switch",
        M.mansionSwitches("POKEMON_MANSION_1F").length === 1 &&
        M.mansionSwitches("POKEMON_MANSION_2F").length === 1 &&
        M.mansionSwitches("POKEMON_MANSION_3F").length === 1 &&
        M.mansionSwitches("POKEMON_MANSION_B1F").length === 2,
        M.mansionFloors().map((f) => f + ":" + M.mansionSwitches(f).length).join(" "));
  check("the first floor's is at (2,5)",
        M.mansionSwitchAt("POKEMON_MANSION_1F", 2, 5) !== null &&
        M.mansionSwitchAt("POKEMON_MANSION_1F", 2, 6) === null);
  check("and a floor with none says so",
        M.mansionSwitchAt("CINNABAR_GYM", 2, 5) === null);

  // A door's shipped byte is always one of the two blocks it swaps between,
  // which is the cheapest check there is that the coordinates are read the
  // right way round -- b is Y and c is X in the cartridge's `ld bc`.
  let doors = 0;
  const wrong = [];
  for (const id of M.mansionFloors()) {
    const def = bundle.maps[id];
    const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
    for (const row of OVERRIDES[id]) {
      doors++;
      const shipped = map.blockAt(row.bx, row.by);
      if (shipped !== row.closedBlock && shipped !== row.openBlock) {
        wrong.push(id + " " + row.bx + "," + row.by + " ships " + shipped);
      }
    }
  }
  check("thirteen doors in all", doors === 13, "" + doors);
  check("and every one of them ships as one of its own two blocks",
        wrong.length === 0, JSON.stringify(wrong));
}

console.log("\n== Pressing one ==");
function inMansion(map, x, y, facing, mut) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = map;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 40, () => 0.5));
  if (mut) { mut(state); }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

function press(lens, answer) {
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 2500) {
    if (lens.pageWaiting && lens.loop.textReady()) {
      lens.press(answer === false ? "b" : "a");
      n += 12;
      continue;
    }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.slice(mark).join(" ");
}

{
  const lens = inMansion("POKEMON_MANSION_1F", 2, 6, "up");
  const before = [lens.overworld.map.blockAt(12, 6), lens.overworld.map.blockAt(8, 3)];
  const said = press(lens, true);
  check("it offers the switch", said.indexOf("switch") >= 0, said);
  check("and pressing it flips the building's one bit",
        lens.play.flags.EVENT_MANSION_SWITCH_ON === true);
  const after = [lens.overworld.map.blockAt(12, 6), lens.overworld.map.blockAt(8, 3)];
  check("one door shuts as the other opens",
        before[0] !== after[0] && before[1] !== after[1] &&
        before[0] === after[1] && before[1] === after[0],
        JSON.stringify(before) + " -> " + JSON.stringify(after));
  check("and it clicks", lens.sounds.indexOf("Switch") >= 0, JSON.stringify(lens.sounds));

  const again = press(lens, true);
  check("pressing it a second time puts it back",
        lens.play.flags.EVENT_MANSION_SWITCH_ON !== true &&
        lens.overworld.map.blockAt(12, 6) === before[0], again.slice(0, 60));

  const declined = inMansion("POKEMON_MANSION_1F", 2, 6, "up");
  const left = press(declined, false);
  check("saying no leaves it alone",
        declined.play.flags.EVENT_MANSION_SWITCH_ON !== true &&
        left.indexOf("Not quite yet") >= 0, left);

  const sideways = inMansion("POKEMON_MANSION_1F", 3, 5, "left");
  press(sideways, true);
  check("and a switch cannot be pressed from beside it",
        sideways.play.flags.EVENT_MANSION_SWITCH_ON !== true);
}

console.log("\n== What the switches are for ==");
/** Flood the floor over BOTH states, flipping wherever a switch can be read. */
function reachable(id, from) {
  const def = bundle.maps[id];
  const grids = [false, true].map((on) => {
    const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
    map.setOverrides(new BlockOverrideIndex(OVERRIDES[id], def.width),
                     on ? { EVENT_MANSION_SWITCH_ON: true } : {});
    return map;
  });
  const presses = M.mansionSwitches(id).map((s) => [s.x, s.y + 1]);
  const width = def.width * 2;
  const height = def.height * 2;
  const seen = {};
  const queue = [[from[0], from[1], 0]];
  while (queue.length > 0) {
    const at = queue.pop();
    const key = at[0] + "," + at[1] + "," + at[2];
    if (at[0] < 0 || at[1] < 0 || at[0] >= width || at[1] >= height) { continue; }
    if (seen[key] || !grids[at[2]].isWalkable(at[0], at[1])) { continue; }
    seen[key] = true;
    if (presses.some((p) => p[0] === at[0] && p[1] === at[1])) {
      queue.push([at[0], at[1], 1 - at[2]]);
    }
    queue.push([at[0] + 1, at[1], at[2]], [at[0] - 1, at[1], at[2]],
               [at[0], at[1] + 1, at[2]], [at[0], at[1] - 1, at[2]]);
  }
  return seen;
}

/** The same flood with the bit nailed down, which is what a dead switch means. */
function reachableFixed(id, from, on) {
  const def = bundle.maps[id];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  map.setOverrides(new BlockOverrideIndex(OVERRIDES[id], def.width),
                   on ? { EVENT_MANSION_SWITCH_ON: true } : {});
  const width = def.width * 2;
  const height = def.height * 2;
  const seen = {};
  const queue = [[from[0], from[1]]];
  while (queue.length > 0) {
    const at = queue.pop();
    const key = at[0] + "," + at[1];
    if (at[0] < 0 || at[1] < 0 || at[0] >= width || at[1] >= height) { continue; }
    if (seen[key] || !map.isWalkable(at[0], at[1])) { continue; }
    seen[key] = true;
    queue.push([at[0] + 1, at[1]], [at[0] - 1, at[1]],
               [at[0], at[1] + 1], [at[0], at[1] - 1]);
  }
  return seen;
}

{
  // The SECRET KEY is the whole reason the building is here: without it
  // CINNABAR's gym never opens.
  const key = bundle.maps.POKEMON_MANSION_B1F.objects
    .filter((o) => o.name === "POKEMONMANSIONB1F_SECRET_KEY")[0];
  check("the SECRET KEY is on B1F at (5,13)", key && key.x === 5 && key.y === 13,
        JSON.stringify(key));
  const stairs = bundle.maps.POKEMON_MANSION_B1F.warps[0];
  const both = reachable("POKEMON_MANSION_B1F", [stairs.x, stairs.y]);
  check("with the switches it can be walked to",
        both["5,13,0"] === true || both["5,13,1"] === true,
        Object.keys(both).length + " states");
  const off = reachableFixed("POKEMON_MANSION_B1F", [stairs.x, stairs.y], false);
  const on = reachableFixed("POKEMON_MANSION_B1F", [stairs.x, stairs.y], true);
  check("and without them it cannot, in either state",
        off["5,13"] !== true && on["5,13"] !== true,
        Object.keys(off).length + "/" + Object.keys(on).length + " cells");
  check("which is what the switches are for: the layout really changes",
        Object.keys(off).length !== Object.keys(on).length,
        Object.keys(off).length + " vs " + Object.keys(on).length);
}

console.log("\nMANSION " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
