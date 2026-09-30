// Ledges: pokered's LedgeTiles table, OVERWORLD tileset only.
//
// Standing on the paired tile, facing the ledge, a step hops two cells over it
// in one landing rather than being blocked like any other unwalkable tile.
// Measured on the cartridge (tools/oracle/FINDINGS.md, "Ledges cannot be
// hopped"): ROUTE_1 (10,4) -> hop over the ledge at (10,5) -> lands (10,6),
// one step counted, about twice an ordinary step's duration, the pad ignored
// throughout, and never enterable from any other side.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/ledges.test.mjs <bundle.json>

import { readFileSync } from "node:fs";

// The lens runtime provides print(); Node does not.
globalThis.print = (...args) => console.log("[lens]", ...args);

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("usage: ledges.test.mjs <bundle.json>");
  process.exit(2);
}

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { Overworld } = await import("../Assets/Scripts/play/Overworld.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const DT = 1 / 60;

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

/** Frames until a step lands (result.landed), or -1 if it never does. */
function framesToLand(world, direction, limit = 200) {
  const input = held(direction);
  for (let i = 1; i <= limit; i++) {
    const r = world.update(DT, input);
    if (r.landed) {
      return i;
    }
  }
  return -1;
}

/**
 * The first cell, anywhere in Kanto's OVERWORLD maps, standing on a ledge's
 * paired tile facing `direction` with the ledge tile ahead and a clear
 * landing two cells on. Searches the bundle rather than hard-coding a second
 * spot, so the test still means something if the maps are ever re-extracted.
 */
function findLedgeSample(direction) {
  const ledges = (bundle.field.ledges || []).filter((l) => l.facing === direction);
  if (ledges.length === 0) {
    return null;
  }
  const d = Overworld.facingDelta(direction);
  for (const mapId in bundle.maps) {
    const def = bundle.maps[mapId];
    if (def.tileset !== "OVERWORLD") {
      continue;
    }
    const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
    for (let cy = 0; cy < map.heightCells; cy++) {
      for (let cx = 0; cx < map.widthCells; cx++) {
        if (map.objectAt(cx, cy) !== null) {
          continue;
        }
        const standing = map.cellTile(cx, cy);
        for (const ledge of ledges) {
          if (ledge.standingTile !== standing) {
            continue;
          }
          const ax = cx + d[0], ay = cy + d[1];
          if (!map.inBounds(ax, ay) || map.cellTile(ax, ay) !== ledge.ledgeTile) {
            continue;
          }
          const lx = cx + d[0] * 2, ly = cy + d[1] * 2;
          if (!map.canEnter(lx, ly)) {
            continue;
          }
          return { mapId: mapId, cx: cx, cy: cy, lx: lx, ly: ly };
        }
      }
    }
  }
  return null;
}

console.log("\n== ROUTE_1 (10,4): the measured hop ==");
{
  const map = new MapRuntime(bundle.maps.ROUTE_1, bundle.tilesets.OVERWORLD);
  check("the standing cell (10,4) is ordinary ground", map.canEnter(10, 4));
  check("the ledge cell (10,5) is not enterable on its own",
        !map.canEnter(10, 5), "tile " + map.cellTile(10, 5));

  const world = new Overworld(bundle, "ROUTE_1", 10, 4, () => 0.99);
  world.facing = "down";
  const startSteps = world.steps;
  const frames = framesToLand(world, "down");
  check("a held down hops the ledge and lands on (10,6)",
        world.cellX === 10 && world.cellY === 6,
        "frames=" + frames + " ended " + world.cellX + "," + world.cellY);
  check("the hop counts exactly one step",
        world.steps === startSteps + 1, "steps went to " + world.steps);

  // The step SAYS it was a hop. Nothing outside Overworld could tell before --
  // a hop and a walk both came back as an ordinary step -- so the lens had no
  // way to sound one differently, which the cartridge does.
  const fresh = new Overworld(bundle, "ROUTE_1", 10, 4, () => 0.99);
  fresh.facing = "down";
  const first = fresh.update(1 / 60, held("down"));
  check("and reports itself as a hop", first.hopped === true);
  check("while an ordinary step does not", (() => {
    const flat = new Overworld(bundle, "ROUTE_1", 10, 2, () => 0.99);
    flat.facing = "down";
    return flat.update(1 / 60, held("down")).hopped === false;
  })());
}

console.log("\n== Timing: about twice an ordinary step ==");
{
  // An ordinary step nearby, at the same dt, is the baseline -- comparing
  // against it rather than a hard-coded duration survives STEP_SECONDS
  // being retuned later.
  const plain = new Overworld(bundle, "ROUTE_1", 10, 6, () => 0.99);
  plain.facing = "down";
  const normalFrames = framesToLand(plain, "down");

  const hop = new Overworld(bundle, "ROUTE_1", 10, 4, () => 0.99);
  hop.facing = "down";
  const hopFrames = framesToLand(hop, "down");

  check("the hop takes about twice an ordinary step's frames",
        normalFrames > 0 && hopFrames > 0 && Math.abs(hopFrames - 2 * normalFrames) <= 1,
        "normal=" + normalFrames + " hop=" + hopFrames);
  check("in wall-clock time that is roughly half a second",
        hopFrames * DT > 0.4 && hopFrames * DT < 0.65,
        (hopFrames * DT).toFixed(3) + "s");
}

console.log("\n== The pad is ignored for the whole hop ==");
{
  const world = new Overworld(bundle, "ROUTE_1", 10, 4, () => 0.99);
  world.facing = "down";
  world.update(DT, held("down")); // starts the hop
  check("the hop is in progress", world.isMoving());

  // Hold a different direction through the rest of the hop: it must not
  // turn the player or steer the landing.
  const sideways = held("left");
  let landed = false;
  for (let i = 0; i < 60 && !landed; i++) {
    const r = world.update(DT, sideways);
    if (r.landed) {
      landed = true;
    }
  }
  check("a direction held during the hop is ignored",
        landed && world.facing === "down" && world.cellX === 10 && world.cellY === 6,
        "facing " + world.facing + " at " + world.cellX + "," + world.cellY);

  // The pad comes back the instant the hop lands: the same held LEFT now turns.
  world.update(DT, sideways);
  check("control returns as soon as the hop lands",
        world.facing === "left", "facing " + world.facing);
}

console.log("\n== Never enterable from any other side ==");
{
  const up = new Overworld(bundle, "ROUTE_1", 10, 6, () => 0.99);
  up.facing = "down";
  const input = held("up");
  let blocked = false;
  for (let i = 0; i < 40; i++) {
    const r = up.update(DT, input);
    if (r.blocked) {
      blocked = true;
    }
  }
  check("walking up from the landing cell into the ledge is blocked",
        blocked && up.cellX === 10 && up.cellY === 6,
        "ended " + up.cellX + "," + up.cellY);

  const turn = new Overworld(bundle, "ROUTE_1", 10, 4, () => 0.99);
  turn.facing = "down";
  for (let i = 0; i < 10; i++) {
    turn.update(DT, held("left"));
  }
  check("a sideways press on a down-ledge only turns",
        turn.facing === "left" && turn.cellX === 10 && turn.cellY === 4,
        "facing " + turn.facing + " at " + turn.cellX + "," + turn.cellY);
}

console.log("\n== A body on the landing cell prevents the hop ==");
{
  const world = new Overworld(bundle, "ROUTE_1", 10, 4, () => 0.99);
  world.facing = "down";
  const bystander = bundle.maps.ROUTE_1.objects[0].name;
  world.map.moveObject(bystander, 10, 6);
  const input = held("down");
  let blocked = false;
  for (let i = 0; i < 60; i++) {
    const r = world.update(DT, input);
    if (r.blocked) {
      blocked = true;
    }
  }
  check("the hop is refused and the player stays put",
        blocked && world.cellX === 10 && world.cellY === 4,
        "ended " + world.cellX + "," + world.cellY);
}

console.log("\n== Left- and right-facing entries hop the right way ==");
{
  for (const direction of ["left", "right"]) {
    const sample = findLedgeSample(direction);
    check("a " + direction + "-facing ledge exists somewhere in Kanto's bundle",
          sample !== null, JSON.stringify(sample));
    if (!sample) {
      continue;
    }
    const world = new Overworld(bundle, sample.mapId, sample.cx, sample.cy, () => 0.99);
    world.facing = direction;
    const frames = framesToLand(world, direction);
    check("on " + sample.mapId + " it hops from (" + sample.cx + "," + sample.cy +
          ") to (" + sample.lx + "," + sample.ly + ")",
          world.cellX === sample.lx && world.cellY === sample.ly,
          "frames=" + frames + " ended " + world.cellX + "," + world.cellY);
  }
}

console.log("\n== A scripted walk hops too, like the cartridge's own simulated joypad ==");
{
  const idle = held("");
  const world = new Overworld(bundle, "ROUTE_1", 10, 4, () => 0.99);
  world.facing = "down";
  world.walkScripted("down", 1);
  let frames = 0;
  while (world.isWalkingScripted() && frames < 100) {
    world.update(DT, idle);
    frames++;
  }
  check("a scripted single step hops the ledge the same as a held button",
        !world.isWalkingScripted() && world.cellX === 10 && world.cellY === 6,
        "ended " + world.cellX + "," + world.cellY + " in " + frames + " frames");
}

console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILURES") + ": " + passed + " passed, " + failed + " failed\n");
process.exit(failed === 0 ? 0 : 1);
