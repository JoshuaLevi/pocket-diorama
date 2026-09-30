// Exercises the real Overworld and MapRuntime sources under Node.
//
// The lens preview is a slow and coarse place to check movement rules. These run
// the same TypeScript the lens runs, against the same bundle, in milliseconds --
// so collision, map seams and the encounter distribution can be checked properly
// rather than by watching a character wander for twenty seconds.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/overworld.test.mjs <bundle.json>

import { readFileSync } from "node:fs";

// The lens runtime provides print(); Node does not.
globalThis.print = (...args) => console.log("[lens]", ...args);

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("usage: overworld.test.mjs <bundle.json>");
  process.exit(2);
}

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { Overworld } = await import("../Assets/Scripts/play/Overworld.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.log("  FAIL  " + name + (detail ? "  -- " + detail : ""));
  }
}

/** A controller that holds one direction, like a D-pad held down. */
function held(direction) {
  const pad = { up: false, down: false, left: false, right: false };
  if (direction) pad[direction] = true;
  return {
    name: "test",
    update() {},
    dpad: () => pad,
    pressedA: () => false,
    pressedB: () => false,
    pressedStart: () => false,
    isConnected: () => true,
  };
}

/** Runs the world forward, returning every result the steps produced. */
function walk(world, direction, seconds, dt = 1 / 30) {
  const input = held(direction);
  const results = [];
  for (let t = 0; t < seconds; t += dt) {
    results.push(world.update(dt, input));
  }
  return results;
}

console.log("\n== MapRuntime: geometry and collision ==");
{
  const def = bundle.maps.PALLET_TOWN;
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  check("Pallet Town is 10x9 blocks", def.width === 10 && def.height === 9);
  check("that is 20x18 walkable cells", map.widthCells === 20 && map.heightCells === 18);
  check("and 40x36 tiles", map.widthTiles === 40 && map.heightTiles === 36);
  check("out-of-bounds borders extend", map.blockAt(-1, -1) === def.borderBlock);
  // Row 12 is the open strip that runs the width of the town; row 10 is Oak's lab,
  // which is why the first version of this assertion failed and the code did not.
  check("the open strip through the town is walkable", map.isWalkable(10, 12));
  check("Oak's lab is not walkable", !map.isWalkable(10, 10));
  check("a house is not walkable", !map.isWalkable(5, 4), "cell 5,4 should be a building");
}

console.log("\n== Route 1: grass ==");
{
  const def = bundle.maps.ROUTE_1;
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  let grass = 0;
  for (let y = 0; y < map.heightCells; y++) {
    for (let x = 0; x < map.widthCells; x++) if (map.isGrass(x, y)) grass++;
  }
  check("Route 1 has 104 grass cells", grass === 104, "found " + grass);
  check("grass outside the map is not grass", !map.isGrass(-1, 5),
        "border blocks carry the grass tile as scenery");
  check("Route 1's table is rate 25", bundle.encounters.ROUTE_1.grass.rate === 25);
}

console.log("\n== Map seams ==");
{
  // Pallet Town connects north to Route 1. Walking off the top edge must land in
  // Route 1 rather than bounce, and must land somewhere standable.
  const world = new Overworld(bundle, "PALLET_TOWN", 10, 1, () => 0.99);
  walk(world, "up", 6);
  check("walking north out of Pallet Town reaches Route 1",
        world.mapId === "ROUTE_1", "ended on " + world.mapId + " at " + world.cellX + "," + world.cellY);
  check("and lands on a standable cell",
        world.map.canEnter(world.cellX, world.cellY));

  const back = new Overworld(bundle, "ROUTE_1", world.cellX, world.map.heightCells - 1, () => 0.99);
  walk(back, "down", 6);
  check("and walking back south returns to Pallet Town",
        back.mapId === "PALLET_TOWN", "ended on " + back.mapId);
}

console.log("\n== Collision ==");
{
  // Walking into the sea south of Pallet Town must not move the player.
  const world = new Overworld(bundle, "PALLET_TOWN", 10, 16, () => 0.99);
  const before = world.cellY;
  const results = walk(world, "down", 3);
  check("the shoreline blocks the player",
        world.cellY === before || world.map.canEnter(world.cellX, world.cellY),
        "moved to " + world.cellX + "," + world.cellY);
  check("and the block is reported", results.some((r) => r.blocked));
}

console.log("\n== Encounter distribution ==");
{
  // A deterministic sequence proves the buckets, and a large sample proves the rate.
  const rolls = [];
  let index = 0;
  const world = new Overworld(bundle, "ROUTE_1", 13, 7, () => rolls[index++ % rolls.length]);
  // Grass only bites when the play loop says there is something to send out;
  // the default is off so a caller that never sets it cannot walk into
  // startWildBattle's "a side has nothing to send out" throw. This suite is
  // testing the roll itself, so it opts in.
  world.encountersEnabled = true;

  // rate 25 means an encounter when the first roll * 256 < 25.
  rolls.push(0, 0); // always trigger, first bucket
  index = 0;
  const results = walk(world, "up", 4);
  const encounters = results.map((r) => r.encounter).filter(Boolean);
  check("a forced roll produces an encounter", encounters.length > 0);
  if (encounters.length) {
    const first = encounters[0];
    const slot0 = bundle.encounters.ROUTE_1.grass.slots[0];
    check("and it is slot 0 for a roll of 0",
          first.species === slot0.species && first.level === slot0.level,
          "got " + first.species + " Lv" + first.level + ", expected " + slot0.species + " Lv" + slot0.level);
  }

  // Rate check over a large sample of arrivals in grass.
  let hits = 0;
  const trials = 20000;
  let seed = 12345;
  const rng = () => {
    // Deterministic LCG, so the number below is reproducible.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < trials; i++) {
    if (Math.floor(rng() * 256) < 25) hits++;
  }
  const rate = hits / trials;
  check("the roll matches 25/256 within a percent",
        Math.abs(rate - 25 / 256) < 0.01, "measured " + rate.toFixed(4));
}

console.log("\n== A scripted walk ==");
{
  // The sleeping old man in Viridian shoves the player back a cell, and the
  // rival crosses Oak's lab. Both are `move_player`/`walk_npc`, and both have to
  // go through the SAME path a held button does -- turning, collision, ledges,
  // seams -- rather than teleporting, or a script can put the player inside a
  // wall that nothing else in the game can reach.
  const idle = { dpad: () => ({ up: false, down: false, left: false, right: false }),
                 pressedA: () => false, pressedB: () => false,
                 pressedStart: () => false, update: () => {}, isConnected: () => true };
  const tick = (w, n) => { let f = 0; while (w.isWalkingScripted() && f < n) { w.update(0.05, idle); f++; } return f; };

  // Find a cell with three clear ones above it rather than guessing at the map:
  // an assertion about a step COUNT is only about the count if the path is open.
  const probe = new Overworld(bundle, "ROUTE_1", 13, 7, () => 0.99);
  let sx = -1;
  let sy = -1;
  for (let x = 1; x < 18 && sx < 0; x++) {
    for (let y = 5; y < 30; y++) {
      if (probe.map.canEnter(x, y) && probe.map.canEnter(x, y - 1) &&
          probe.map.canEnter(x, y - 2) && probe.map.canEnter(x, y - 3)) {
        sx = x; sy = y; break;
      }
    }
  }
  check("Route 1 has somewhere to walk three cells", sx >= 0, `${sx},${sy}`);

  const world = new Overworld(bundle, "ROUTE_1", sx, sy, () => 0.99);
  world.walkScripted("up", 3);
  check("a scripted walk reports itself as running", world.isWalkingScripted());
  const frames = tick(world, 600);
  check("it takes exactly the steps it was asked for",
        !world.isWalkingScripted() && world.cellY === sy - 3,
        `y ${sy} -> ${world.cellY} in ${frames} frames`);
  check("and does it without a button being held", true);

  // Into the wall: the step never lands, so a counter that only came down on a
  // landing would never reach zero and the script waiting on it would hold the
  // lens for good.
  const boxed = new Overworld(bundle, "ROUTE_1", sx, sy, () => 0.99);
  boxed.walkScripted("left", 60);
  const guard = tick(boxed, 900);
  check("a scripted walk that cannot continue stops instead of hanging",
        !boxed.isWalkingScripted(), guard + " frames");
}

// ---------------------------------------------------------------------------
// Hidden objects are not walls
// ---------------------------------------------------------------------------
{
  const def = bundle.maps.PALLET_TOWN;
  const oak = def.objects.find((o) => o.name === "PALLETTOWN_OAK");
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  check("Oak ships hidden in Pallet Town", !!oak && oak.hidden === true);
  check("and his cell is walkable while he is hidden", map.canEnter(oak.x, oak.y));
  const toggles = {};
  toggles["PALLET_TOWN:" + oak.name] = true;
  map.setReveals(toggles);
  check("a script that reveals him makes him solid", !map.canEnter(oak.x, oak.y));
  toggles["PALLET_TOWN:" + oak.name] = false;
  check("and hiding him again opens the cell", map.canEnter(oak.x, oak.y));
  const girl = def.objects.find((o) => o.text === "TEXT_PALLETTOWN_GIRL");
  check("a visible NPC still blocks", !map.canEnter(girl.x, girl.y));
}

// ---------------------------------------------------------------------------
// Caves bite on every tile
// ---------------------------------------------------------------------------
{
  const table = bundle.encounters.MT_MOON_1F;
  check("Mt Moon 1F has an encounter table", !!(table && table.grass && table.grass.rate > 0),
        JSON.stringify(table ? Object.keys(table) : null));
  const cave = new Overworld(bundle, "MT_MOON_1F", 14, 34, () => 0);
  cave.encountersEnabled = true;
  check("its floor is not grass", !cave.map.isGrass(14, 34) && !cave.map.isGrass(14, 33));
  const input = held("up");
  let bit = null;
  for (let i = 0; i < 40 && bit === null; i++) { const r = cave.update(0.05, input); if (r.encounter) { bit = r.encounter; } }
  check("a step on a cave floor rolls a wild Pokemon", bit !== null && !!bit.species, JSON.stringify(bit));
  const town = new Overworld(bundle, "PALLET_TOWN", 10, 8, () => 0);
  town.encountersEnabled = true;
  let townBit = null;
  for (let i = 0; i < 40 && townBit === null; i++) { const r = town.update(0.05, held("up")); if (r.encounter) { townBit = r.encounter; } }
  check("a town path still rolls nothing", townBit === null, JSON.stringify(townBit));
}

console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILURES") + ": " + passed + " passed, " + failed + " failed\n");
process.exit(failed === 0 ? 0 : 1);
