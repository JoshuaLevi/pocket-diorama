// Where a battle is staged: the shape, and what ground it will accept.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battlearena.test.mjs [bundle.json] [--selftest]
//
// Two halves. The first uses hand-built maps so each check controls exactly the
// ground it is testing; the second runs the real cartridge's maps through it,
// because "it fits on Route 1 and not in Oak's lab" is the sort of claim that
// is only worth anything against the real thing.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";
const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const arena = await import("../Assets/Scripts/world/BattleArena.ts");
const { findArena, openCell, cellsAhead, footprint, facingStep,
        BATTLE_GAP_CELLS, PLAYER_MON_AHEAD } = arena;

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/**
 * A map made of characters, one per cell:
 *   "."  plain floor      "#"  wall        "g"  tall grass       "w"  a warp
 */
function mapOf(rows) {
  const at = (cx, cy) => (cy >= 0 && cy < rows.length && cx >= 0 && cx < rows[cy].length
    ? rows[cy][cx] : "#");
  return {
    // The search reads the map's size in TILES, two to a cell, as MapRuntime does.
    widthTiles: rows[0].length * 2,
    heightTiles: rows.length * 2,
    inBounds: (cx, cy) => cy >= 0 && cy < rows.length && cx >= 0 && cx < rows[0].length,
    isWalkable: (cx, cy) => at(cx, cy) !== "#",
    isGrass: (cx, cy) => at(cx, cy) === "g",
    isWarpTile: (cx, cy) => at(cx, cy) === "w",
    warpAt: () => null,
  };
}

console.log("=== the shape ===");
{
  const pair = cellsAhead(5, 5, "up");
  check("your own Pokemon stands a cell ahead of you",
        pair[0][0] === 5 && pair[0][1] === 5 - PLAYER_MON_AHEAD, JSON.stringify(pair[0]));
  check("and theirs three cells beyond that -- the reference's own gap",
        pair[1][1] === pair[0][1] - BATTLE_GAP_CELLS && BATTLE_GAP_CELLS === 3,
        JSON.stringify(pair[1]));
  for (const facing of ["up", "down", "left", "right"]) {
    const step = facingStep(facing);
    const p = cellsAhead(5, 5, facing);
    check("the pair lies along " + facing,
          p[1][0] - p[0][0] === step[0] * BATTLE_GAP_CELLS &&
          p[1][1] - p[0][1] === step[1] * BATTLE_GAP_CELLS);
  }
  const wide = footprint(5, 5, "up", true);
  const narrow = footprint(5, 5, "up", false);
  check("the wide shape is three across", wide.length === narrow.length * 3, wide.length);
  check("and as long as the pair plus the step to it",
        narrow.length === PLAYER_MON_AHEAD + BATTLE_GAP_CELLS + 1, narrow.length);
}

console.log("=== what ground it takes ===");
{
  const map = mapOf([
    ".....",
    ".#.g.",
    ".w...",
  ]);
  check("plain floor is open", openCell(map, 0, 0));
  check("a wall is not", !openCell(map, 1, 1));
  check("tall grass is not -- it stands between the eye and the sprite",
        !openCell(map, 3, 1));
  check("a warp is not -- a fight in a doorway is half inside the building",
        !openCell(map, 1, 2));
  check("off the map is not", !openCell(map, -1, 0));
}

console.log("=== which shape a room gets ===");
{
  // Open ground: the wide shape, apron and all.
  const open = mapOf([".....", ".....", ".....", ".....", ".....", ".....", "....."]);
  check("open ground gets the wide shape", findArena(open, 2, 6, "up").shape === "wide");
  // A one-cell corridor: the apron cannot fit, the pair still can.
  const corridor = mapOf(["#.#", "#.#", "#.#", "#.#", "#.#", "#.#"]);
  check("a corridor gets the narrow one", findArena(corridor, 1, 5, "up").shape === "narrow");
  // A cupboard: nothing fits anywhere, and the fight still has to happen.
  const cupboard = mapOf(["###", "#.#", "###"]);
  const forced = findArena(cupboard, 1, 1, "up");
  check("a room with no room forces it", forced.shape === "forced");
  check("and still says where the two stand", forced.playerCell.length === 2 &&
        forced.enemyCell.length === 2);
  // Grass in the apron drops it to narrow; grass under a Pokemon is worse than
  // grass beside it, and both are excluded.
  const grassy = mapOf(["ggggg", "g.g.g", "g.g.g", "g.g.g", "g.g.g", "g.g.g"]);
  check("grass in the apron costs the wide shape",
        findArena(grassy, 1, 5, "up").shape === "narrow");

  // Standing IN the grass -- which is where wild battles come from -- the fight
  // is staged on the nearest ground that will hold it rather than refused.
  const meadow = mapOf([
    ".....",
    ".....",
    ".....",
    ".....",
    ".....",
    "ggggg",
    "ggggg",
  ]);
  const fromGrass = findArena(meadow, 2, 6, "up");
  check("a fight started in grass is staged off it", fromGrass.shape !== "forced",
        fromGrass.shape);
  check("and on ground that is actually open",
        openCell(meadow, fromGrass.playerCell[0], fromGrass.playerCell[1]) &&
        openCell(meadow, fromGrass.enemyCell[0], fromGrass.enemyCell[1]));
  // Nearest, not merely somewhere: a patch beside you beats one across the map.
  const near = Math.abs(fromGrass.playerCell[1] - 6) + Math.abs(fromGrass.playerCell[0] - 2);
  check("the patch it picks is a near one", near <= 6, near);
}

if (bundlePath) {
  console.log("=== on the cartridge's own maps ===");
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
  const runtime = (id) => new MapRuntime(bundle.maps[id], bundle.tilesets[bundle.maps[id].tileset]);
  // Route 1 north of Pallet: open road, and the shape it was drawn for.
  const route1 = runtime("ROUTE_1");
  let wide = 0, narrow = 0, forced = 0;
  for (let cy = 2; cy < route1.heightTiles / 2 - 2; cy++) {
    for (let cx = 1; cx < route1.widthTiles / 2 - 1; cx++) {
      if (!route1.isWalkable(cx, cy)) continue;
      const found = findArena(route1, cx, cy, "up");
      if (found.shape === "wide") wide++;
      else if (found.shape === "narrow") narrow++;
      else forced++;
    }
  }
  console.log("  ROUTE_1 facing up: " + wide + " wide, " + narrow + " narrow, " + forced + " forced");
  check("Route 1 can stage a proper fight somewhere", wide > 0);
  check("and from every cell of it, since any of them can start one",
        forced === 0, forced + " cells with nowhere to stage a fight");
  const lab = runtime("OAKS_LAB");
  const inLab = findArena(lab, 4, 8, "up");
  console.log("  OAKS_LAB from the doorway: " + inLab.shape +
              " at " + inLab.playerCell.join(",") + " / " + inLab.enemyCell.join(","));
  check("the lab still gets a stage of some kind", inLab.shape !== "");
  // Every walkable cell of a route has to produce a stage, because every one of
  // them can start a fight.
  let stagedEverywhere = true;
  for (let cy = 0; cy < route1.heightTiles / 2 && stagedEverywhere; cy++) {
    for (let cx = 0; cx < route1.widthTiles / 2; cx++) {
      if (!route1.isWalkable(cx, cy)) continue;
      const found = findArena(route1, cx, cy, "up");
      if (found.shape === "forced") { stagedEverywhere = false; break; }
    }
  }
  check("every cell of Route 1 can stage a fight", stagedEverywhere);
}

if (SELFTEST) {
  console.log("=== selftest ===");
  // Grass is the rule most likely to be quietly dropped, so prove the test
  // would notice: the same ground with the grass taken out is wide.
  const grassy = mapOf(["ggggg", "g.g.g", "g.g.g", "g.g.g", "g.g.g", "g.g.g"]);
  const bare = mapOf([".....", ".....", ".....", ".....", ".....", "....."]);
  check("SELFTEST grass is what costs that shape",
        findArena(grassy, 1, 5, "up").shape === "narrow" &&
        findArena(bare, 1, 5, "up").shape === "wide");
  // And that a wall in the axis is not merely narrowed but forced.
  const blocked = mapOf(["#.#", "###", "#.#", "#.#", "#.#", "#.#"]);
  check("SELFTEST a wall between them forces it",
        findArena(blocked, 1, 5, "up").shape === "forced");
  // And that "nearest" is doing something: a stage twenty cells away must lose
  // to one right beside the player.
  const twoPatches = mapOf([
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "gggggggggg",
  ]);
  const near = findArena(twoPatches, 1, 5, "up");
  check("SELFTEST it picks a near patch, not the far corner",
        Math.abs(near.playerCell[0] - 1) <= 2, JSON.stringify(near.playerCell));
}

console.log("\nBATTLEARENA  " + pass + " pass, " + fail + " fail\n");
process.exit(fail === 0 ? 0 : 1);
