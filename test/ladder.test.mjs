// The save ladder: ten places to drop into, each of which must actually work.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/ladder.test.mjs Assets/Generated/kanto.json
//
// A rung that names a wrong species, a cell inside a wall or a door that is
// not a door would be discovered on the glasses, by Joshua, with the headset
// on. So every rung is built here, stood on, and walked one step from.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const L = await import(P + "debug/Ladder.ts");
const { RUNGS, ladderRows, ladderState, entranceOf } = L;
const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { badgeCount } = await import(P + "PlayState.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: ladder.test.mjs <bundle.json>");
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
const fixed = () => 0.5;

console.log("== The list ==");
{
  check("ten rungs", RUNGS.length === 10, RUNGS.length);
  const rows = ladderRows();
  check("one row each", rows.length === RUNGS.length);
  // The list is drawn in a 20-tile box with the text from tile 2: seventeen
  // columns for the label, two spaces and the note.
  const long = rows.filter((r) => r[0].length + 2 + r[1].length > 17);
  check("labels and notes fit a Game Boy row", long.length === 0, JSON.stringify(long));
  let badges = -1;
  let ordered = true;
  for (const r of RUNGS) { if (r.badges < badges) { ordered = false; } badges = r.badges; }
  check("badges never go down the ladder", ordered);
  check("the last rung holds all eight", RUNGS[RUNGS.length - 1].badges === 8);
}

console.log("\n== Every rung stands somewhere real ==");
for (let i = 0; i < RUNGS.length; i++) {
  const rung = RUNGS[i];
  const at = entranceOf(bundle, rung.building, rung.approach ? rung.approach : "");
  const def = bundle.maps[at.mapId];
  check(rung.label + ": the map exists", !!def, at.mapId);
  if (!def) { continue; }
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  check(rung.label + ": the cell is walkable", map.isWalkable(at.x, at.y),
        at.mapId + " " + at.x + "," + at.y);
  // Facing the door: the warp is one cell up (outdoors) or one down (inside).
  const warps = def.warps || [];
  const doorY = at.facing === "up" ? at.y - 1 : at.y + 1;
  const door = warps.filter((w) => w.x === at.x && w.y === doorY);
  check(rung.label + ": faces a door into " + rung.building,
        door.length > 0 && (at.mapId === rung.building || door[0].destMap === rung.building),
        JSON.stringify(door));
}

console.log("\n== Every rung builds, and holds what it says ==");
for (let i = 0; i < RUNGS.length; i++) {
  const rung = RUNGS[i];
  let state = null;
  try {
    state = ladderState(bundle, i, fixed);
  } catch (e) {
    check(rung.label + ": builds", false, "" + e);
    continue;
  }
  check(rung.label + ": builds", state !== null);
  check(rung.label + ": party of " + rung.party.length,
        state.party.length === rung.party.length &&
        state.party.every((m) => m.hp > 0 && m.hp === m.maxHp && m.moves.length > 0),
        JSON.stringify(state.party.map((m) => [m.species, m.level, m.hp, m.moves.length])));
  check(rung.label + ": the party is the player's own",
        state.party.every((m) => m.otId === state.playerId && m.otName === state.playerName));
  check(rung.label + ": " + rung.badges + " badges", badgeCount(state) === rung.badges, badgeCount(state));
  const missing = rung.items.filter((it) => !state.bag.some((b) => b.id === it[0] && b.count >= parseInt(it[1], 10)));
  check(rung.label + ": every item is in the bag", missing.length === 0, JSON.stringify(missing));
  const unknown = rung.items.filter((it) => !bundle.items[it[0]]);
  check(rung.label + ": every item exists on the cartridge", unknown.length === 0, JSON.stringify(unknown));
  for (const mv of rung.moves) {
    const mon = state.party[parseInt(mv[0], 10)];
    check(rung.label + ": " + mon.species + " knows " + mv[1],
          mon.moves.some((m) => m.id === mv[1] && m.pp > 0), JSON.stringify(mon.moves));
  }
  check(rung.label + ": the flags are set", rung.flags.every((f) => state.flags[f] === true));
  check(rung.label + ": the dex saw the party",
        state.party.every((m) => state.dexOwned[bundle.species[m.species].dex - 1] === true ||
                                 state.dexOwned[bundle.species[m.species].dex] === true));
  check(rung.label + ": a whiteout has a Center to go to",
        state.respawnMapId.indexOf("POKECENTER") > 0, state.respawnMapId);
}

console.log("\n== And the lens can start from each one ==");
for (let i = 0; i < RUNGS.length; i++) {
  const rung = RUNGS[i];
  const state = ladderState(bundle, i, fixed);
  let lens = null;
  try {
    lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
    lens.clearText();
    lens.settle();
  } catch (e) {
    check(rung.label + ": the world starts", false, "" + e);
    continue;
  }
  const before = lens.state();
  check(rung.label + ": the world starts at the door",
        before.map === state.mapId && before.x === state.cellX && before.y === state.cellY,
        before.map + " " + before.x + "," + before.y);
  // A step somewhere other than through the door: away from it first, then
  // sideways. A doorstep with a ledge behind it is still a doorstep.
  const away = state.facing === "up" ? "down" : "up";
  let moved = false;
  for (const direction of [away, "left", "right"]) {
    lens.run([{ walk: direction, n: 1 }]);
    let n = 0;
    while ((lens.loop.isBusy() || lens.pageWaiting) && n < 600) {
      if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
      lens.frame();
      n++;
    }
    lens.settle();
    const after = lens.state();
    if (after.map === before.map && (after.x !== before.x || after.y !== before.y)) {
      moved = true;
      break;
    }
  }
  check(rung.label + ": a step is possible", moved, JSON.stringify(lens.state()));
}

console.log("\nLADDER " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
