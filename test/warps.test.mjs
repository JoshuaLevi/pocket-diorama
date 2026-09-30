// Doors, mats and LAST_MAP, walked headlessly.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/warps.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Until this suite no step ever took a warp: Overworld.pendingWarp had no
// caller, so the player could not enter a single building, and 242 of the
// cartridge's 802 warps -- every building exit -- named LAST_MAP, which nothing
// resolved. PlayLoop.afterStep is the join: a landing takes the warp under the
// player, a press into the wall from the mat inside a door takes that mat, and
// LAST_MAP is the outside map the exit leads to.

import { readFileSync } from "node:fs";
import { makeServices } from "./fakeservices.mjs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: warps.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const { Overworld } = await import(P + "Overworld.ts");
const { PlayLoop } = await import(P + "PlayLoop.ts");
const PlayState = await import(P + "PlayState.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
let quiet = false;
let quietFails = 0;
function check(name, ok, detail) {
  if (quiet) { if (!ok) { quietFails++; } return; }
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

const NONE = { up: false, down: false, left: false, right: false };
function held(direction) {
  const pad = { up: false, down: false, left: false, right: false };
  if (direction) { pad[direction] = true; }
  return { dpad: () => pad, pressedA: () => false, pressedB: () => false, pressedStart: () => false, activeName: () => "test" };
}
const idle = held("");

/** Walk with the d-pad held until the loop reports a warp, or the frames run out. */
function walkUntilWarp(world, loop, direction, frames) {
  for (let i = 0; i < frames; i++) {
    const result = world.update(0.05, held(direction));
    const outcome = loop.afterStep(world, result, false);
    if (outcome.warped) { return { warped: true, frames: i + 1 }; }
  }
  return { warped: false, frames: frames };
}

function fresh(mapId, x, y) {
  const state = PlayState.newPlayState("t");
  state.flags.EVENT_INTRO_DONE = true;
  const loop = new PlayLoop(bundle, state, makeServices(bundle, mapId));
  const world = new Overworld(bundle, mapId, x, y, () => 0.99);
  world.setReveals(loop.reveals());
  return { state, loop, world };
}

console.log("\n== Into a house and out again ==");
function testDoor(make) {
  const { world, loop } = make();
  const door = bundle.maps.PALLET_TOWN.warps[0];
  check("Red's front door is the first warp of Pallet Town", door.destMap === "REDS_HOUSE_1F" && door.x === 5 && door.y === 5);
  check("the player starts one cell below it", world.cellX === 5 && world.cellY === 6);
  const inward = walkUntilWarp(world, loop, "up", 60);
  check("stepping onto the door takes the warp", inward.warped && world.mapId === "REDS_HOUSE_1F", world.mapId + " after " + inward.frames + " frames");
  const mat = bundle.maps.REDS_HOUSE_1F.warps[0];
  check("and lands on the house's first mat", world.cellX === mat.x && world.cellY === mat.y, world.cellX + "," + world.cellY);
  check("the arrival mat is inert as a warp", world.pendingWarp() === null);
  check("the house remembers Pallet Town as its outside", world.lastMapId === "PALLET_TOWN", world.lastMapId);

  // Press down into the wall from the mat: the collision warp, no stepping off.
  const out = walkUntilWarp(world, loop, "down", 30);
  check("pressing down from the mat leaves the house", out.warped && world.mapId === "PALLET_TOWN", world.mapId);
  check("back on the door cell outside, facing down", world.cellX === door.x && world.cellY === door.y && world.facing === "down",
        world.cellX + "," + world.cellY + " " + world.facing);
  check("which is inert until you step off it", world.pendingWarp() === null);

  // Step off and back on: it fires again.
  for (let i = 0; i < 20; i++) { loop.afterStep(world, world.update(0.05, held("down")), false); }
  const again = walkUntilWarp(world, loop, "up", 60);
  check("stepping off and back on enters again", again.warped && world.mapId === "REDS_HOUSE_1F", world.mapId);
}
testDoor(() => fresh("PALLET_TOWN", 5, 6));

console.log("\n== Stairs do not bounce ==");
{
  const { world, loop } = fresh("REDS_HOUSE_1F", 7, 2);
  const stairs = bundle.maps.REDS_HOUSE_1F.warps.find((w) => w.destMap === "REDS_HOUSE_2F");
  check("the staircase is a warp inside the house", !!stairs && stairs.x === 7 && stairs.y === 1);
  const up = walkUntilWarp(world, loop, "up", 40);
  check("stepping onto it goes upstairs", up.warped && world.mapId === "REDS_HOUSE_2F", world.mapId);
  const there = { x: world.cellX, y: world.cellY, map: world.mapId };
  // Press into whatever is beside the arrival cell: no edge, no warp back.
  for (let i = 0; i < 20; i++) { loop.afterStep(world, world.update(0.05, held("up")), false); }
  check("pressing into a wall upstairs does not warp back down", world.mapId === "REDS_HOUSE_2F", world.mapId + " from " + JSON.stringify(there));
  // The 2F staircase sits on the map's east edge. Measured on the cartridge:
  // pressing right there does nothing; the lens used to fire the mat rule.
  for (let i = 0; i < 20; i++) { loop.afterStep(world, world.update(0.05, held("right")), false); }
  check("pressing into the map edge on the stairs does not bounce either", world.mapId === "REDS_HOUSE_2F" && world.cellX === 7 && world.cellY === 1,
        world.mapId + " " + world.cellX + "," + world.cellY);
}

console.log("\n== Door mats fire only toward the edge ==");
{
  // Measured on the cartridge: walking left along the bottom row of Red's
  // ground floor crosses both mats without leaving.
  const { world, loop } = fresh("REDS_HOUSE_1F", 7, 7);
  const across = walkUntilWarp(world, loop, "left", 60);
  check("walking sideways across the mats does not leave the house", !across.warped && world.mapId === "REDS_HOUSE_1F", world.mapId);
  check("and reaches the far wall", world.cellX === 0 && world.cellY === 7, world.cellX + "," + world.cellY);
  const down = fresh("REDS_HOUSE_1F", 3, 5);
  const out = walkUntilWarp(down.world, down.loop, "down", 40);
  check("walking down onto a mat with the pad held leaves at once", out.warped && down.world.mapId === "PALLET_TOWN", down.world.mapId);
  // Leaving through the front door walks you one step out on its own, as
  // the cartridge does, even with the pad pushed the other way.
  const exit = fresh("REDS_HOUSE_1F", 3, 6);
  walkUntilWarp(exit.world, exit.loop, "down", 40);
  check("the doorway is not where you stop", exit.world.isWalkingScripted() || exit.world.cellY === 6, exit.world.cellX + "," + exit.world.cellY);
  for (let i = 0; i < 30 && (exit.world.isWalkingScripted() || exit.world.isMoving()); i++) {
    exit.loop.afterStep(exit.world, exit.world.update(0.05, held("up")), false);
  }
  check("leaving the house steps out of the doorway by itself", exit.world.mapId === "PALLET_TOWN" && exit.world.cellX === 5 && exit.world.cellY === 6,
        exit.world.mapId + " " + exit.world.cellX + "," + exit.world.cellY);
  // Oak's lab has a two-wide doorway; stepping from one mat onto the other stays inside.
  const lab = fresh("OAKS_LAB", 5, 11);
  const side = walkUntilWarp(lab.world, lab.loop, "left", 20);
  check("stepping across the lab's doorway stays in the lab", !side.warped && lab.world.mapId === "OAKS_LAB" && lab.world.cellX < 5, lab.world.mapId + " " + lab.world.cellX);
}

console.log("\n== A gate has two outsides ==");
{
  // Route 22's gate: south mats lead back to Route 22, north mats to Route 23.
  const gate = bundle.maps.ROUTE_22_GATE;
  const { world, loop } = fresh("ROUTE_22", 9, 5);
  world.facing = "left";
  const inward = walkUntilWarp(world, loop, "left", 40);
  check("walking left onto the gate door enters the gate", inward.warped && world.mapId === "ROUTE_22_GATE", world.mapId);
  check("Route 22 is remembered", world.lastMapId === "ROUTE_22");
  const south = gate.warps[0];
  check("the player stands on a south mat", world.cellY === south.y, world.cellX + "," + world.cellY);
  // Walk to a north mat and step onto it.
  const north = gate.warps[2];
  world.enterMapAt("ROUTE_22_GATE", north.x, north.y + 1, "up");
  const outNorth = walkUntilWarp(world, loop, "up", 40);
  check("the north mats lead to Route 23, not back to Route 22", outNorth.warped && world.mapId === "ROUTE_23", world.mapId);
  // And from Route 23 the south mats lead back to Route 22.
  world.enterMapAt("ROUTE_22_GATE", south.x, south.y - 1, "down");
  world.lastMapId = "ROUTE_23";
  const outSouth = walkUntilWarp(world, loop, "down", 40);
  check("the south mats lead to Route 22 even when you came from Route 23", outSouth.warped && world.mapId === "ROUTE_22", world.mapId);
}

console.log("\n== A scripted walk takes a warp too ==");
{
  const { world, loop } = fresh("PALLET_TOWN", 5, 7);
  world.facing = "up";
  world.walkScripted("up", 4);
  let warped = false;
  for (let i = 0; i < 80 && !warped; i++) {
    const r = world.update(0.05, idle);
    warped = loop.afterStep(world, r, true).warped;
  }
  check("two scripted steps up walk the player through the door", warped && world.mapId === "REDS_HOUSE_1F", world.mapId);
  check("and the warp ends the scripted walk", !world.isWalkingScripted());
}

console.log("\n== The save round trip ==");
{
  const { state, world } = fresh("PALLET_TOWN", 5, 6);
  const loop = new PlayLoop(bundle, state, makeServices(bundle, "PALLET_TOWN"));
  walkUntilWarp(world, loop, "up", 60);
  state.mapId = world.mapId; state.cellX = world.cellX; state.cellY = world.cellY; state.lastMapId = world.lastMapId;
  const reloaded = PlayState.migratePlayState(JSON.parse(JSON.stringify(state)), "t");
  const back = new Overworld(bundle, reloaded.mapId, reloaded.cellX, reloaded.cellY, () => 0.99);
  back.lastMapId = reloaded.lastMapId;
  const loop2 = new PlayLoop(bundle, reloaded, makeServices(bundle, reloaded.mapId));
  const out = walkUntilWarp(back, loop2, "down", 30);
  check("a save made indoors still knows the way out", out.warped && back.mapId === "PALLET_TOWN", back.mapId);
}

console.log("\n== Every LAST_MAP exit resolves ==");
{
  let total = 0;
  const unresolved = [];
  for (const mapId of Object.keys(bundle.maps)) {
    const def = bundle.maps[mapId];
    def.warps.forEach((w, i) => {
      if (w.destMap !== "LAST_MAP") { return; }
      total++;
      const world = new Overworld(bundle, mapId, w.x, w.y, () => 0.99);
      // Simulate arriving elsewhere so the mat is live, then take it.
      world.enterMapAt(mapId, w.x, w.y, "down");
      const ok = world.takeWarp(w);
      if (!ok || world.mapId === mapId) { unresolved.push(mapId + "#" + (i + 1)); }
    });
  }
  check("there are a couple of hundred LAST_MAP exits", total > 200, "" + total);
  // One exit has no outside parent: Silph Co. 11F's pad at (5,5) names LAST_MAP
  // in a building whose only door is on 1F. It is the cartridge's own oddity,
  // pinned here so a second one cannot hide behind it.
  check("every one of them leads somewhere, bar Silph Co. 11F's pad", unresolved.join(",") === "SILPH_CO_11F#3",
        unresolved.slice(0, 8).join(", ") + (unresolved.length > 8 ? " ..." : ""));
}

if (selftest) {
  console.log("\n-- selftest --");
  const failsWith = (fn) => { quiet = true; quietFails = 0; fn(); quiet = false; return quietFails; };
  // A world whose warps are never read: the door test must go red.
  check("[selftest] a loop that ignores the warp underfoot is caught",
        failsWith(() => testDoor(() => { const f = fresh("PALLET_TOWN", 5, 6); f.world.pendingWarp = () => null; f.world.warpUnderPlayer = () => null; return f; })) > 0);
  check("[selftest] the real door passes the quiet run", failsWith(() => testDoor(() => fresh("PALLET_TOWN", 5, 6))) === 0);
}

console.log(`\n${fail === 0 ? "WARPS OK" : "WARPS FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
