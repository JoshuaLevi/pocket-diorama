// What the world costs to draw, for every map in the cartridge, at every rung
// of the ZOOM ladder.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/geometrybudget.test.mjs Assets/Generated/kanto.json [--selftest]
//
// This suite exists because of a measurement, not a theory. From the
// 10 September device logs, framerate read off the AudioDriver heartbeat
// (which prints every 180 frames, so each gap between two heartbeats IS a
// frame time):
//
//   title screen, no world           58 fps
//   world up, Route 22               40-45 fps
//   world up, Viridian City          24 fps
//   a fight, 20:45                   14 fps
//
// Nothing decays across a session -- it is a STEP, and the step lands the
// moment the world is built. So the glasses overheating is downstream of a
// scene that is too expensive, not the cause of it, and the thing to hold a
// line on is what the builder emits.
//
// The numbers below are CEILINGS, not targets. They are what the shipping
// builder emits today, pinned so that nothing gets quietly worse, and the
// optimisation work is what lowers them. A real target needs one reading of
// Lens Power off the glasses at two different rungs to calibrate quads
// against power; until that exists, this is a ratchet and says so.
//
// Worst case across all 222 maps, not the map anyone happened to be standing
// on: the ZOOM 20 worst is an interior (the Fighting Dojo), not a route, and
// an interior is exactly where a wearer walks in without expecting anything
// to change.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: geometrybudget.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { tileStatsFor } = await import("../Assets/Scripts/world/VoxelPalette.ts");
const { buildColumnField, buildChunkGeometry, windowForRect, windowFor, VOXELS_PER_TILE }
  = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const { chunkViewRect, clipQuads, rimQuads }
  = await import("../Assets/Scripts/world/ViewClip.ts");
const { detectStructures } = await import("../Assets/Scripts/world/Structures.ts");
const { shapeProfileFor } = await import("../Assets/Scripts/world/TileShapes.ts");
const { ZOOM_TILES_ACROSS, ZOOM_LABELS, ZOOM_DEFAULT }
  = await import("../Assets/Scripts/world/PlayArea.ts");
const { coverAround, coverChunks, chunkTilesFor, earthSpanTilesFor, HALO_TILES }
  = await import("../Assets/Scripts/world/ChunkPlan.ts");

/**
 * The ceiling per rung: quads DRAWN and meshes it takes to draw them.
 *
 * Since 11 September the drawn world is the VIEW -- a square of the rung's
 * width centred on the player -- cut from a cover of chunks built a little
 * wider (world/ViewClip.ts). So what the GPU sees is the view's tiles plus
 * the skirt of earth along its edge, and that is what is counted here; the
 * chunks built beyond the view are cut away and cost the GPU nothing. The
 * ceilings were re-read off the new builder when it landed and are, as
 * before, what it emits today rounded up: a ratchet, not a target.
 *
 * A "mesh" here is one RenderMeshVisual and therefore one draw call: a chunk
 * is one, and a chunk with grass in it adds a second for the sway mesh, which
 * is why the mesh count is not simply the chunk count.
 *
 * Keyed by the LABEL rather than the index so that adding or removing a rung
 * from the ladder is a compile-visible change here rather than a silent
 * reshuffle of which budget belongs to which rung.
 */
//
// Re-read on 11 September when the view-cut landed. Quads fell at every rung
// (the cover used to overshoot the rung by up to a chunk and all of it was
// drawn; now exactly the view is): 12066 -> 8868, 21303 -> 14510,
// 39942 -> 25233, 65171 -> 48454. Draw calls rose, because a view that is
// not aligned to the chunk grid touches one more row and column of chunks
// than a cover centred on a chunk did: 18 -> 28 and 50 -> 62. A few dozen
// draw calls of one material is cheap on this GPU; a third fewer quads is not
// nothing. Both ceilings are the new numbers, rounded up.
const BUDGET = {
  "14": { quads: 9000, meshes: 30 },
  "20": { quads: 15000, meshes: 30 },
  "28": { quads: 26000, meshes: 64 },
  "40": { quads: 49000, meshes: 64 },
};

// HALO_TILES is IMPORTED, not repeated. The first draft of this file wrote
// its own 8 next to a comment claiming VoxelTerrain used the same number;
// VoxelTerrain imports ChunkPlan's, which is 2. A gate that builds a different
// world from the lens measures a world nobody is looking at.

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

/** What one map costs at one rung: the view, cut from the cover exactly as the lens does. */
function costOf(map, stats, profile, structures, acrossTiles) {
  const cx = Math.floor(map.widthTiles / 2);
  const cz = Math.floor(map.heightTiles / 2);
  const view = windowFor(map, acrossTiles, cx, cz, 0, false);
  const cover = coverAround(map.widthTiles, map.heightTiles, chunkTilesFor(acrossTiles),
                            view.minTileX, view.minTileZ, view.maxTileX, view.maxTileZ);
  const earthSpan = earthSpanTilesFor(map.widthTiles, map.heightTiles, acrossTiles);
  const field = buildColumnField(
    map, stats,
    windowForRect(map,
                  Math.max(0, cover.minTileX - HALO_TILES),
                  Math.max(0, cover.minTileZ - HALO_TILES),
                  Math.min(map.widthTiles - 1, cover.maxTileX + HALO_TILES),
                  Math.min(map.heightTiles - 1, cover.maxTileZ + HALO_TILES),
                  earthSpan, 0, false),
    structures, profile, true);
  const chunks = coverChunks(cover);
  const originX = -map.widthTiles / 2;
  const originZ = -map.heightTiles / 2;
  let quads = 0;
  let meshes = 0;
  for (let i = 0; i < chunks.length; i++) {
    const rect = chunkViewRect(view, chunks[i][0], chunks[i][1], cover.chunkTiles,
                               map.widthTiles, map.heightTiles);
    if (!rect) {
      continue;   // built for the lookahead, not drawn
    }
    const g = buildChunkGeometry(field, map, chunks[i][0], chunks[i][1], stats,
                                 cover.chunkTiles);
    const x0 = originX + rect.minTileX, x1 = originX + rect.maxTileX + 1;
    const z0 = originZ + rect.minTileZ, z1 = originZ + rect.maxTileZ + 1;
    const cut = clipQuads(g.verts, g.indices, g.quads, x0, x1, z0, z1);
    rimQuads(field, rect, view, map.widthTiles, map.heightTiles, VOXELS_PER_TILE, cut);
    const sway = clipQuads(g.swayVerts, g.swayIndices, g.swayQuads, x0, x1, z0, z1);
    quads += cut.quads + sway.quads;
    if (cut.quads > 0 || sway.quads > 0) {
      meshes = meshes + 1;
    }
    if (sway.quads > 0) {
      meshes = meshes + 1;
    }
  }
  return { quads: quads, meshes: meshes };
}

/** Every map, every rung, keeping only the worst of each. */
function sweep() {
  const worst = {};
  for (let r = 0; r < ZOOM_LABELS.length; r++) {
    worst[ZOOM_LABELS[r]] = { quads: 0, quadsMap: "", meshes: 0, meshesMap: "" };
  }
  const ids = Object.keys(bundle.maps);
  for (let i = 0; i < ids.length; i++) {
    const def = bundle.maps[ids[i]];
    const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
    const stats = tileStatsFor(bundle.tilesets[def.tileset]);
    const profile = shapeProfileFor(map, stats);
    const structures = detectStructures(map, stats, 0, 0,
                                        map.widthTiles - 1, map.heightTiles - 1, profile);
    for (let r = 0; r < ZOOM_TILES_ACROSS.length; r++) {
      const cost = costOf(map, stats, profile, structures, ZOOM_TILES_ACROSS[r]);
      const w = worst[ZOOM_LABELS[r]];
      if (cost.quads > w.quads) { w.quads = cost.quads; w.quadsMap = ids[i]; }
      if (cost.meshes > w.meshes) { w.meshes = cost.meshes; w.meshesMap = ids[i]; }
    }
  }
  return worst;
}

console.log("=== the world's cost, worst map at each rung ===");
const worst = sweep();
console.log("  rung   worst quads                  worst draw calls");
for (let r = 0; r < ZOOM_LABELS.length; r++) {
  const label = ZOOM_LABELS[r];
  const w = worst[label];
  const budget = BUDGET[label];
  console.log("  " + label.padStart(4) + "   " +
              String(w.quads).padStart(6) + " / " + String(budget.quads).padStart(6) +
              "  " + (w.quadsMap + "").padEnd(24).slice(0, 24) +
              String(w.meshes).padStart(3) + " / " + String(budget.meshes).padStart(3) +
              "  " + w.meshesMap);
  check("ZOOM " + label + " stays inside its quad ceiling",
        w.quads <= budget.quads, w.quadsMap + " emits " + w.quads);
  check("ZOOM " + label + " stays inside its draw-call ceiling",
        w.meshes <= budget.meshes, w.meshesMap + " takes " + w.meshes);
}

console.log("=== every rung has a budget, and every budget has a rung ===");
{
  // A rung added to the ladder with no line in BUDGET would be measured by
  // nothing at all, and the loop above would read `undefined <= undefined` as
  // false only by accident. Say it out loud instead.
  const rungs = ZOOM_LABELS.slice().sort();
  const budgeted = Object.keys(BUDGET).sort();
  check("the ladder and the budget table name the same rungs",
        rungs.join(",") === budgeted.join(","),
        "ladder " + rungs.join(",") + " vs budget " + budgeted.join(","));
  // A heavier rung must not be given a lighter ceiling than a lighter rung:
  // that would let a regression hide by being measured against the wrong line.
  let rising = true;
  for (let r = 1; r < ZOOM_LABELS.length; r++) {
    if (BUDGET[ZOOM_LABELS[r]].quads < BUDGET[ZOOM_LABELS[r - 1]].quads) rising = false;
  }
  check("the ceilings rise with the rungs", rising);
}

console.log("=== the rung everyone actually gets ===");
{
  // The default is what a wearer who never opens the OPTION page runs on, so
  // it is the only rung whose ceiling is a promise rather than a ratchet.
  const label = ZOOM_LABELS[ZOOM_DEFAULT];
  const w = worst[label];
  check("the default rung is a real rung", label !== undefined && BUDGET[label] !== undefined);
  check("the default rung is not the heaviest one on the ladder",
        ZOOM_DEFAULT < ZOOM_LABELS.length - 1,
        "default is " + label + ", the ladder ends at " + ZOOM_LABELS[ZOOM_LABELS.length - 1]);
  check("no map costs more than the default's ceiling",
        w.quads <= BUDGET[label].quads, w.quadsMap + " emits " + w.quads);
}

if (SELFTEST) {
  console.log("=== selftest: the budget notices when the world gets heavier ===");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before;
    fail = before;
    if (noticed) { pass++; }
    else { fail++; console.log("  FAIL selftest: " + label + " passes even when broken"); }
  }
  expectFailures("a rung that emits twice what it may", () => {
    const label = ZOOM_LABELS[ZOOM_DEFAULT];
    check("quad detector", worst[label].quads * 2 <= BUDGET[label].quads);
  });
  expectFailures("a rung that takes twice the draw calls", () => {
    const label = ZOOM_LABELS[ZOOM_DEFAULT];
    check("draw-call detector", worst[label].meshes * 2 <= BUDGET[label].meshes);
  });
  expectFailures("a ladder with a rung the budget does not name", () => {
    const rungs = ZOOM_LABELS.concat(["56"]).sort();
    const budgeted = Object.keys(BUDGET).sort();
    check("coverage detector", rungs.join(",") === budgeted.join(","));
  });
  expectFailures("ceilings that fall as the rungs rise", () => {
    const bad = { "14": 13000, "20": 12000 };
    check("monotonic detector", bad["20"] >= bad["14"]);
  });
  expectFailures("the heaviest rung as the default", () => {
    check("default detector", ZOOM_LABELS.length - 1 < ZOOM_LABELS.length - 1);
  });
  // The measurement itself has to be real. A costOf that returned zero would
  // sail under every ceiling above and prove nothing at all.
  expectFailures("a builder that emits nothing", () => {
    check("emptiness detector", worst[ZOOM_LABELS[0]].quads === 0,
          "the lightest rung still emits " + worst[ZOOM_LABELS[0]].quads);
  });
}

console.log("");
console.log("GEOMETRYBUDGET  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
