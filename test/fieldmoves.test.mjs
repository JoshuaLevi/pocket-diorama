// The five HM field moves, played through the real PlayLoop and a real
// Overworld against the real cartridge extraction.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/fieldmoves.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The first test is the JOIN: Cut, from the party menu's outcome all the way
// to a tree cell that can be walked through. Its selftest takes the cut out of
// the services and requires the suite to notice, because "a finished layer
// reachable from nothing" is the fault this project keeps hitting.
//
// Every rule here was read out of gen1recomp and pokered rather than
// remembered. The two that bite hardest:
//   - a BLOCK id means nothing outside its tileset, so Cut gates on the
//     TILESET and its one cuttable tile FIRST (Route 23's PLATEAU blocks match
//     the swap table and cutting one writes a block id PLATEAU does not have)
//   - tall grass is cuttable and WALKABLE, so the "must be solid" gate applies
//     to trees and plants only

import { readFileSync } from "node:fs";
import { makeServices, shownText } from "./fakeservices.mjs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: fieldmoves.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const { Overworld } = await import(P + "Overworld.ts");
const { PlayLoop } = await import(P + "PlayLoop.ts");
const PlayState = await import(P + "PlayState.ts");
const F = await import(P + "FieldMoves.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { replaceMove } = await import(P + "battle/Party.ts");

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

const NONE = { dpad: () => ({ up: false, down: false, left: false, right: false }) };
const held = (d) => ({ dpad: () => ({ up: d === "up", down: d === "down", left: d === "left", right: d === "right" }) });

/** A Pokemon that knows one HM move in slot 0. */
function monWith(move, species, level) {
  const mon = makeWildMon(bundle, species ? species : "CHARMANDER", level ? level : 12, () => 0.5);
  return replaceMove(bundle, mon, 0, move).mon;
}

/**
 * A loop, a world and the fake wired to each other.
 *
 * `tweak` runs on the services BEFORE the PlayLoop is built: PlayLoop.wrapServices
 * copies the key set at construction, so a service swapped in afterwards is
 * never seen and a selftest that swaps one would silently prove nothing.
 */
function stage(mapId, x, y, facing, opts) {
  const o = opts || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party = o.party ? o.party : [monWith("CUT")];
  for (let i = 0; o.badges && i < o.badges.length; i++) {
    state.badges[F.badgeIndexOf(o.badges[i])] = true;
  }
  if (o.flags) {
    for (const key in o.flags) { state.flags[key] = o.flags[key]; }
  }
  const services = makeServices(bundle, mapId, {});
  if (o.tweak) { o.tweak(services); }
  const loop = new PlayLoop(bundle, state, services);
  const world = new Overworld(bundle, mapId, x, y, o.random ? o.random : () => 0.99);
  world.facing = facing;
  services.setWorld(world);
  loop.attach(world);
  loop.bindWorld(world);
  return { state, services, loop, world };
}

/** Run the VM to a standstill. */
function pump(loop, limit) {
  let n = 0;
  while (loop.isBusy() && n < (limit === undefined ? 400 : limit)) {
    loop.update();
    n++;
  }
  return n;
}

/** Walk `frames` of world time with a direction held. */
function walk(world, direction, frames) {
  const out = [];
  for (let i = 0; i < (frames === undefined ? 40 : frames); i++) {
    out.push(world.update(0.05, direction ? held(direction) : NONE));
  }
  return out;
}

const said = (s) => shownText(s).join(" | ");

// ---------------------------------------------------------------------------
// THE JOIN: Cut, from the party menu to a tree that is no longer there.
// ---------------------------------------------------------------------------
function testCut(opts) {
  const t = stage("ROUTE_2", 5, 11, "up", { badges: ["CASCADEBADGE"], ...(opts || {}) });
  check("the tree on ROUTE_2 is solid to start with",
        t.world.map.canEnter(5, 10) === false && t.world.cutTargetAhead() !== null,
        JSON.stringify(t.world.cutTargetAhead()));
  const out = t.loop.useFieldMove(t.world, 0, "CUT");
  check("using CUT starts a script", out.started === true && out.pickFly === false);
  pump(t.loop);
  check("the cartridge's own line is shown, with the Pokemon's name",
        said(t.services).indexOf("hacked") >= 0 && said(t.services).indexOf("CHARMANDER") >= 0,
        said(t.services));
  check("the lens was asked to cut", t.services.log.indexOf("cut") >= 0,
        JSON.stringify(t.services.log));
  check("and the tree cell can now be walked through",
        t.world.map.canEnter(5, 10) === true);
  // MapDef is the shared bundle: a cut written through it would fell the tree
  // for every future visit and for every other test in this file.
  const target = t.world.cutTargetAhead();
  const shipped = bundle.maps.ROUTE_2.blocks[5 * bundle.maps.ROUTE_2.width + 2];
  check("the shipped map is untouched", shipped === 50 && target === null,
        JSON.stringify({ shipped: shipped, stillCuttable: target }));
  return t;
}

console.log("\n== THE JOIN: Cut ==");
testCut();

// ---------------------------------------------------------------------------
console.log("\n== Cut's rules ==");
{
  const noBadge = stage("ROUTE_2", 5, 11, "up", { badges: [] });
  noBadge.loop.useFieldMove(noBadge.world, 0, "CUT");
  pump(noBadge.loop);
  check("without CASCADEBADGE the tree stays and a badge is asked for",
        said(noBadge.services).indexOf("BADGE") >= 0 && noBadge.world.map.canEnter(5, 10) === false,
        said(noBadge.services));

  const nothing = stage("ROUTE_2", 5, 11, "down", { badges: ["CASCADEBADGE"] });
  nothing.loop.useFieldMove(nothing.world, 0, "CUT");
  pump(nothing.loop);
  check("facing open ground says there is nothing to CUT",
        said(nothing.services).indexOf("anything to CUT") >= 0, said(nothing.services));

  // Tall grass IS cuttable, and it is walkable: the solidity gate must not
  // apply to it (engine/overworld/cut.asm treats $52 as its own case).
  const grass = stage("ROUTE_2", 0, 3, "up", { badges: ["CASCADEBADGE"] });
  check("tall grass is a cut target although it is walkable",
        grass.world.cutTargetAhead() !== null && grass.world.map.canEnter(0, 2) === true,
        JSON.stringify(grass.world.cutTargetAhead()));

  // The whole point of the tileset gate.
  const plateau = stage("ROUTE_23", 5, 5, "up", { badges: ["CASCADEBADGE"] });
  let cuttable = 0;
  for (let cy = 0; cy < plateau.world.map.heightCells; cy++) {
    for (let cx = 0; cx < plateau.world.map.widthCells; cx++) {
      plateau.world.cellX = cx;
      plateau.world.cellY = cy;
      for (const f of ["up", "down", "left", "right"]) {
        plateau.world.facing = f;
        if (plateau.world.cutTargetAhead() !== null) { cuttable++; }
      }
    }
  }
  check("nothing on ROUTE_23 is cuttable, although PLATEAU blocks match the swap table",
        cuttable === 0, cuttable + " cells");

  const gym = stage("CELADON_GYM", 2, 5, "up", { badges: ["CASCADEBADGE"] });
  check("CELADON GYM's plant is cuttable and solid",
        gym.world.cutTargetAhead() !== null && gym.world.map.canEnter(2, 4) === false,
        JSON.stringify(gym.world.cutTargetAhead()));

  // The cartridge regrows every tree the moment the map is reloaded.
  const back = testCutQuiet();
  back.world.enterMapAt("VIRIDIAN_CITY", 5, 5, "down");
  back.world.enterMapAt("ROUTE_2", 5, 11, "up");
  check("leaving and coming back grows the tree again",
        back.world.map.canEnter(5, 10) === false);
}

function testCutQuiet() {
  const t = stage("ROUTE_2", 5, 11, "up", { badges: ["CASCADEBADGE"] });
  t.loop.useFieldMove(t.world, 0, "CUT");
  pump(t.loop);
  return t;
}

// ---------------------------------------------------------------------------
console.log("\n== Surf ==");
{
  // The first land cell on ROUTE_19 with water in front of it, found from the
  // bundle rather than remembered.
  const probe = new Overworld(bundle, "ROUTE_19", 0, 0, () => 0.99);
  let seam = null;
  for (let cy = 0; cy < probe.map.heightCells && seam === null; cy++) {
    for (let cx = 0; cx < probe.map.widthCells && seam === null; cx++) {
      if (!probe.map.canEnter(cx, cy)) { continue; }
      if (probe.canSurfEnter(cx, cy + 1)) { seam = [cx, cy, "down"]; }
    }
  }
  check("ROUTE_19 has a shore to surf from", seam !== null, JSON.stringify(seam));

  const noBadge = stage("ROUTE_19", seam[0], seam[1], seam[2], { party: [monWith("SURF")] });
  noBadge.loop.useFieldMove(noBadge.world, 0, "SURF");
  pump(noBadge.loop);
  check("without SOULBADGE the water is refused",
        said(noBadge.services).indexOf("BADGE") >= 0 && noBadge.world.surfing === false,
        said(noBadge.services));

  const land = stage("ROUTE_19", seam[0], seam[1], "up", {
    party: [monWith("SURF")], badges: ["SOULBADGE"],
  });
  land.loop.useFieldMove(land.world, 0, "SURF");
  pump(land.loop);
  check("facing land says there is no SURFing here, and names the Pokemon",
        said(land.services).indexOf("No SURFing") >= 0 &&
        said(land.services).indexOf("CHARMANDER") >= 0 && land.world.surfing === false,
        said(land.services));

  const t = stage("ROUTE_19", seam[0], seam[1], seam[2], {
    party: [monWith("SURF")], badges: ["SOULBADGE"],
  });
  const out = t.loop.useFieldMove(t.world, 0, "SURF");
  check("facing water starts the surf script", out.started === true);
  pump(t.loop);
  check("the got-on line names the player and the Pokemon",
        said(t.services).indexOf("got on") >= 0 && said(t.services).indexOf("CHARMANDER") >= 0,
        said(t.services));
  check("the lens was asked to surf", t.services.log.indexOf("surf") >= 0);
  check("and the surf flag is up", t.world.surfing === true);
  walk(t.world, "", 40);
  check("the forced step lands on the water",
        t.world.cellX === seam[0] && t.world.cellY === seam[1] + 1 && t.world.surfing === true,
        JSON.stringify([t.world.cellX, t.world.cellY]));
  const before = t.world.cellY;
  walk(t.world, seam[2], 80);
  check("a held direction keeps going over open water",
        t.world.cellY > before + 2 && t.world.surfing === true,
        JSON.stringify([t.world.cellX, t.world.cellY]));

  // Getting off: SURF again with land ahead walks forward and dismounts.
  const off = stage("ROUTE_19", seam[0], seam[1] + 1, "up", {
    party: [monWith("SURF")], badges: ["SOULBADGE"],
  });
  off.world.surfing = true;
  const offOut = off.loop.useFieldMove(off.world, 0, "SURF");
  check("SURF with land ahead starts the step off", offOut.started === true);
  for (let i = 0; i < 60 && off.loop.isBusy(); i++) {
    off.loop.update();
    off.world.update(0.05, NONE);
  }
  check("and the player is back on land, no longer surfing",
        off.world.cellY === seam[1] && off.world.surfing === false,
        JSON.stringify([off.world.cellX, off.world.cellY, off.world.surfing]));

  const stuck = stage("ROUTE_19", seam[0], seam[1] + 1, "down", {
    party: [monWith("SURF")], badges: ["SOULBADGE"],
  });
  stuck.world.surfing = true;
  stuck.loop.useFieldMove(stuck.world, 0, "SURF");
  pump(stuck.loop);
  check("with only water ahead there is no place to get off",
        said(stuck.services).indexOf("no place") >= 0 && stuck.world.surfing === true,
        said(stuck.services));

  // The water table, not the grass one.
  const rolling = new Overworld(bundle, "ROUTE_19", seam[0], seam[1] + 1, () => 0);
  rolling.surfing = true;
  rolling.encountersEnabled = true;
  let encounter = null;
  const steps = walk(rolling, "down", 60);
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].encounter) { encounter = steps[i].encounter; break; }
  }
  check("surfing rolls the map's WATER table",
        encounter !== null && encounter.species === bundle.encounters.ROUTE_19.water.slots[0].species,
        JSON.stringify(encounter));
  const quietWater = new Overworld(bundle, "ROUTE_19", seam[0], seam[1] + 1, () => 0.99);
  quietWater.surfing = true;
  quietWater.encountersEnabled = true;
  let any = false;
  const dry = walk(quietWater, "down", 60);
  for (let i = 0; i < dry.length; i++) { if (dry[i].encounter) { any = true; } }
  check("and a high roll finds nothing", any === false);

  // The ROUTE_19 -> ROUTE_20 seam is water on both sides.
  const west = new Overworld(bundle, "ROUTE_19", 0, 20, () => 0.99);
  west.surfing = true;
  let crossed = false;
  for (let i = 0; i < 200 && !crossed; i++) {
    if (west.update(0.05, held("left")).mapChanged) { crossed = true; }
  }
  check("surfing crosses the ROUTE_19 seam westward", crossed === true, west.mapId);
  const dryWest = new Overworld(bundle, "ROUTE_19", 0, 20, () => 0.99);
  let dryCrossed = false;
  for (let i = 0; i < 200 && !dryCrossed; i++) {
    if (dryWest.update(0.05, held("left")).mapChanged) { dryCrossed = true; }
  }
  check("and on foot it refuses", dryCrossed === false, dryWest.mapId);
}

// ---------------------------------------------------------------------------
console.log("\n== Strength ==");
{
  const t = stage("VICTORY_ROAD_1F", 5, 16, "up", {
    party: [monWith("STRENGTH")], badges: ["RAINBOWBADGE"],
  });
  const blocked = t.world.update(0.05, held("up"));
  check("without Strength the boulder is a wall",
        blocked.pushed === null && t.world.map.objectAt(5, 15) !== null);

  const out = t.loop.useFieldMove(t.world, 0, "STRENGTH");
  check("STRENGTH starts its script", out.started === true);
  pump(t.loop);
  check("both of the cartridge's lines are shown",
        said(t.services).indexOf("used") >= 0 && said(t.services).indexOf("move boulders") >= 0,
        said(t.services));
  check("and the lens was told", t.services.log.indexOf("strength") >= 0 &&
        t.world.strengthActive === true);

  t.world.facing = "up";
  const first = t.world.update(0.05, held("up"));
  check("the first attempt only arms the push", first.pushed === null && first.blocked === true);
  const second = t.world.update(0.05, held("up"));
  check("the second moves the boulder one cell",
        second.pushed !== null && second.pushed.toX === 5 && second.pushed.toY === 14,
        JSON.stringify(second.pushed));
  check("the boulder is where it was pushed to, and the old cell is free",
        t.world.map.objectAt(5, 14) !== null && t.world.map.objectAt(5, 15) === null);
  check("the shipped objects are untouched",
        bundle.maps.VICTORY_ROAD_1F.objects.filter((o) => o.name === "VICTORYROAD1F_BOULDER1")[0].y === 15);
  check("Strength does not survive a map change",
        (() => { t.world.enterMapAt("VICTORY_ROAD_2F", 5, 5, "down"); return t.world.strengthActive === false; })());

  // The switch: pushing a boulder onto (17,13) opens the barrier at block (4,6).
  const sw = stage("VICTORY_ROAD_1F", 16, 13, "right", {
    party: [monWith("STRENGTH")], badges: ["RAINBOWBADGE"],
  });
  sw.world.strengthActive = true;
  sw.world.map.moveObject("VICTORYROAD1F_BOULDER1", 17, 13);
  const push = { name: "VICTORYROAD1F_BOULDER1", fromX: 16, fromY: 13, toX: 17, toY: 13, direction: "right" };
  const closedBefore = sw.world.map.blockAt(4, 6);
  sw.loop.afterPush(sw.world, push);
  check("the switch sets its event and opens the barrier block",
        sw.state.flags.EVENT_VICTORY_ROAD_1_BOULDER_ON_SWITCH === true &&
        sw.world.map.blockAt(4, 6) === 0x1d && closedBefore !== 0x1d,
        JSON.stringify({ before: closedBefore, after: sw.world.map.blockAt(4, 6) }));
  check("and the lens was asked to redraw", sw.services.log.indexOf("redraw") >= 0);
  sw.world.enterMapAt("VICTORY_ROAD_1F", 5, 16, "up");
  check("coming back stamps the open block from the flag",
        sw.world.map.blockAt(4, 6) === 0x1d);
  sw.world.enterMapAt("VICTORY_ROAD_2F", 5, 5, "down");
  check("entering 2F clears the 1F switch, as the cartridge's own script does",
        sw.state.flags.EVENT_VICTORY_ROAD_1_BOULDER_ON_SWITCH === false);
  sw.world.enterMapAt("VICTORY_ROAD_1F", 5, 16, "up");
  check("so the barrier is shut again next time down",
        sw.world.map.blockAt(4, 6) !== 0x1d);

  // The hole: the boulder falls through and appears on the floor below.
  const hole = stage("SEAFOAM_ISLANDS_1F", 16, 6, "right", {
    party: [monWith("STRENGTH")], badges: ["RAINBOWBADGE"],
  });
  hole.loop.afterPush(hole.world, {
    name: "SEAFOAMISLANDS1F_BOULDER1", fromX: 16, fromY: 6, toX: 17, toY: 6, direction: "right",
  });
  check("a boulder down a hole sets its event",
        hole.state.flags.EVENT_SEAFOAM1_BOULDER1_DOWN_HOLE === true);
  check("hides itself here",
        hole.state.objectToggles["SEAFOAM_ISLANDS_1F:SEAFOAMISLANDS1F_BOULDER1"] === false,
        JSON.stringify(hole.state.objectToggles));
  check("and shows the one that ships on the floor below",
        hole.state.objectToggles["SEAFOAM_ISLANDS_B1F:SEAFOAMISLANDSB1F_BOULDER1"] === true,
        JSON.stringify(hole.state.objectToggles));
}

// ---------------------------------------------------------------------------
console.log("\n== Fly ==");
{
  const t = stage("PALLET_TOWN", 5, 6, "down", {
    party: [monWith("FLY")], badges: ["THUNDERBADGE"],
  });
  check("standing in a town marks it visited",
        t.state.visitedTowns.PALLET_TOWN === true, JSON.stringify(t.state.visitedTowns));
  t.world.enterMapAt("ROUTE_1", 5, 5, "down");
  check("a route is not a fly destination", t.state.visitedTowns.ROUTE_1 !== true);
  t.world.enterMapAt("PEWTER_CITY", 13, 26, "down");
  check("another town is", t.state.visitedTowns.PEWTER_CITY === true);
  check("visitedTowns follows the cartridge's own order",
        t.loop.visitedTowns().join(",") === "PALLET_TOWN,PEWTER_CITY", t.loop.visitedTowns().join(","));

  const inside = stage("REDS_HOUSE_2F", 3, 6, "down", {
    party: [monWith("FLY")], badges: ["THUNDERBADGE"],
  });
  inside.loop.useFieldMove(inside.world, 0, "FLY");
  pump(inside.loop);
  check("FLY indoors is refused, and names the Pokemon",
        said(inside.services).indexOf("can't") >= 0 && said(inside.services).indexOf("CHARMANDER") >= 0,
        said(inside.services));

  const noBadge = stage("ROUTE_1", 5, 5, "down", { party: [monWith("FLY")] });
  const outNoBadge = noBadge.loop.useFieldMove(noBadge.world, 0, "FLY");
  pump(noBadge.loop);
  check("FLY without THUNDERBADGE asks for the badge",
        outNoBadge.pickFly === false && said(noBadge.services).indexOf("BADGE") >= 0,
        said(noBadge.services));

  const out = t.loop.useFieldMove(t.world, 0, "FLY");
  check("outdoors with the badge, the caller is asked for a destination",
        out.started === false && out.pickFly === true);
  check("an unvisited town is refused", t.loop.fly(t.world, "CELADON_CITY") === false);
  check("a visited one is flown to", t.loop.fly(t.world, "PALLET_TOWN") === true);
  pump(t.loop);
  const spot = bundle.field.flyWarps.PALLET_TOWN;
  check("and the player lands on the town's own spot, facing down",
        t.world.mapId === "PALLET_TOWN" && t.world.cellX === spot.x &&
        t.world.cellY === spot.y && t.world.facing === "down" && t.world.surfing === false,
        JSON.stringify([t.world.mapId, t.world.cellX, t.world.cellY]));
  check("the lens was asked to fly", t.services.log.indexOf("fly:PALLET_TOWN") >= 0);
}

// ---------------------------------------------------------------------------
console.log("\n== Flash and the dark ==");
{
  // The cartridge's darkness is wMapPalOffset, written on the warp IN from an
  // outside map (home/overworld.asm:495-501) and cleared on the warp back out
  // (:530-536) -- so it is not "this map is dark" and the ladders inside the
  // tunnel leave it alone. Start on Route 10 and walk in, the way a player has
  // to.
  const t = stage("ROUTE_10", 11, 20, "down", {
    party: [monWith("FLASH")], badges: ["BOULDERBADGE"],
  });
  check("a route is never dark", t.world.isDark() === false);
  t.world.enterMapAt("ROCK_TUNNEL_1F", 5, 5, "down");
  check("Rock Tunnel is dark", t.world.isDark() === true && t.state.darkened === true);

  t.world.enterMapAt("ROCK_TUNNEL_B1F", 5, 5, "down");
  check("and so is the floor below it", t.world.isDark() === true);
  t.world.enterMapAt("ROCK_TUNNEL_1F", 5, 5, "down");
  check("a ladder does not turn the lights back on", t.world.isDark() === true);

  t.loop.useFieldMove(t.world, 0, "FLASH");
  pump(t.loop);
  check("FLASH shows its line and lights the area",
        said(t.services).indexOf("FLASH") >= 0 && t.services.log.indexOf("flash") >= 0 &&
        t.world.isDark() === false, said(t.services));
  check("and the save remembers it, so a reload comes back lit",
        t.state.darkened === false);
  t.world.enterMapAt("ROCK_TUNNEL_B1F", 5, 5, "down");
  check("one FLASH lights the whole tunnel, not one floor of it",
        t.world.isDark() === false);

  t.world.enterMapAt("ROUTE_10", 11, 20, "down");
  check("walking out clears it", t.world.isDark() === false && t.state.darkened === false);
  t.world.enterMapAt("ROCK_TUNNEL_1F", 5, 5, "down");
  check("and going back in is dark again", t.world.isDark() === true);
}

// ---------------------------------------------------------------------------
console.log("\n== The dark tunnel on the flat screen ==");
{
  // And through the whole lens: the tunnel's own screen, before and after.
  const { HeadlessLens } = await import("./headless.mjs");
  const { screenOf } = await import("./headlessscreen.mjs");
  const PlayState = await import("../Assets/Scripts/play/PlayState.ts");
  const { makeWildMon } = await import("../Assets/Scripts/play/battle/Stats.ts");
  function lensIn(mapId, x, y, darkened) {
    const state = PlayState.newPlayState(bundle.romSha1);
    state.playerName = "RED";
    state.mapId = mapId;
    state.cellX = x;
    state.cellY = y;
    state.facing = "down";
    state.flags.EVENT_INTRO_DONE = true;
    state.flags.EVENT_GOT_STARTER = true;
    state.darkened = darkened;
    state.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
    const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
    lens.clearText();
    lens.settle();
    return lens;
  }
  // screenOf hands back rows of shades, not one flat array.
  const shadeCount = (rows, shade) => {
    let n = 0;
    for (const row of rows) { for (const px of row) { if (px === shade) { n++; } } }
    return n;
  };
  const pixelCount = (rows) => rows.length * rows[0].length;
  const dark = screenOf(lensIn("ROCK_TUNNEL_1F", 15, 5, true));
  const lit = screenOf(lensIn("ROCK_TUNNEL_1F", 15, 5, false));
  check("the unlit tunnel is black but for what was black already",
        shadeCount(dark, 0) === 0 && shadeCount(dark, 1) === 0 &&
        shadeCount(dark, 3) > pixelCount(dark) / 2,
        [0, 1, 2, 3].map((sh) => sh + ":" + shadeCount(dark, sh)).join(" "));
  check("and FLASH gives the picture back",
        shadeCount(lit, 0) > 0 && shadeCount(lit, 3) < pixelCount(dark) / 2,
        [0, 1, 2, 3].map((sh) => sh + ":" + shadeCount(lit, sh)).join(" "));
  const outside = screenOf(lensIn("ROUTE_1", 9, 20, true));
  check("and a route is never dark, whatever the save says",
        shadeCount(outside, 0) > 0,
        [0, 1, 2, 3].map((sh) => sh + ":" + shadeCount(outside, sh)).join(" "));
}

// ---------------------------------------------------------------------------
console.log("\n== The save ==");
{
  const state = PlayState.newPlayState("t");
  check("a new game is not surfing and has been nowhere",
        state.surfing === false && Object.keys(state.visitedTowns).length === 0);
  state.surfing = true;
  state.visitedTowns.PALLET_TOWN = true;
  const back = PlayState.migratePlayState(JSON.parse(JSON.stringify(state)), "t");
  check("a round trip keeps both", back.surfing === true && back.visitedTowns.PALLET_TOWN === true);
  const v1 = JSON.parse(JSON.stringify(state));
  v1.version = 1;
  delete v1.surfing;
  delete v1.visitedTowns;
  const up = PlayState.migratePlayState(v1, "t");
  check("a v1 save comes up dry and untravelled",
        up.surfing === false && Object.keys(up.visitedTowns).length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n== The lens is wired to all of it ==");
{
  const lens = readFileSync(new URL("../Assets/Scripts/PokemonAR.ts", import.meta.url), "utf8");
  const wanted = ["MENU_FIELD_MOVE", "useFieldMove(", "MENU_FLY", "bindWorld(",
                  "afterPush(", "rebuildTerrain(", "cutTreeAhead:", "startSurf:",
                  "activateStrength:", "flyTo:", "lightArea:", "redrawTerrain:",
                  "MENU_TEACH", "new TeachController(", "driveTeach("];
  const missing = wanted.filter((w) => lens.indexOf(w) < 0);
  check("PokemonAR names every part of this system", missing.length === 0,
        "missing: " + missing.join(", "));
}

// ---------------------------------------------------------------------------
if (selftest) {
  console.log("\n-- selftest --");
  function failsWith(run) {
    quiet = true;
    quietFails = 0;
    try { run(); } catch (e) { quietFails++; }
    quiet = false;
    return quietFails;
  }
  // The service is swapped BEFORE the loop is built: PlayLoop.wrapServices
  // copies the key set at construction, so a later swap would be invisible and
  // the selftest would prove nothing.
  check("[selftest] a lens that never cuts is caught",
        failsWith(() => testCut({ tweak: (s) => { s.cutTreeAhead = () => false; } })) > 0);
  check("[selftest] a lens whose cut throws is caught",
        failsWith(() => testCut({ tweak: (s) => { s.cutTreeAhead = () => { throw new Error("no"); }; } })) > 0);
  check("[selftest] the real wiring passes the same quiet run",
        failsWith(() => testCut()) === 0);
}

console.log(`\n${fail === 0 ? "FIELDMOVES OK" : "FIELDMOVES FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
