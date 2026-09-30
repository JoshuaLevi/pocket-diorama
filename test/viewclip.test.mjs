// The drawn world is the view, cut from the chunks, and it moves a tile a step.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/viewclip.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Fourth playtest, 11 September: "de game glitched heel de tijd als er een
// nieuwe chunk moet worden geladen". The drawn world was the cover -- whole
// chunks centred on the player's CHUNK -- so its edge jumped six tiles every
// third step. Now the cover is built past the view and each chunk is emitted
// cut to the view (world/ViewClip.ts). Three claims:
//
//   1. The cut is exact: nothing outside the box survives, straddling quads
//      are clamped to it, walls lying in the edge's plane are dropped, and the
//      skirt closes the cut along the view's edge and nowhere else.
//   2. On a real map, what is drawn at a step is the view and only the view,
//      and the view moves one tile when the player moves one tile.
//   3. The cover the lens builds always holds the view plus its lookahead, so
//      no step ever shows ground that is not built yet.

import { readFileSync } from "node:fs";
const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: viewclip.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const { chunkViewRect, sameRect, rectIsWholeChunk, clipQuads, rimQuads, RIM_SLOPE_VOXELS }
  = await import("../Assets/Scripts/world/ViewClip.ts");
const { coverAround, coverChunks, LOOKAHEAD_TILES, chunkTilesFor, earthSpanTilesFor, HALO_TILES }
  = await import("../Assets/Scripts/world/ChunkPlan.ts");
const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { tileStatsFor } = await import("../Assets/Scripts/world/VoxelPalette.ts");
const { buildColumnField, buildChunkGeometry, windowFor, windowForRect, VOXELS_PER_TILE, VOXEL }
  = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const { detectStructures } = await import("../Assets/Scripts/world/Structures.ts");
const { shapeProfileFor } = await import("../Assets/Scripts/world/TileShapes.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/** A flat-coloured quad as pushQuad emits it: four corners, one texel. */
function quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, cap) {
  const verts = [ax, ay, az, 0.5, 0.5, bx, by, bz, 0.5, 0.5, cx, cy, cz, 0.5, 0.5, dx, dy, dz, 0.5, 0.5];
  const indices = cap ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  return { verts, indices };
}
function geometryOf(list) {
  const verts = [], indices = [];
  for (let q = 0; q < list.length; q++) {
    for (const v of list[q].verts) verts.push(v);
    for (const i of list[q].indices) indices.push(i + q * 4);
  }
  return { verts, indices, quads: list.length };
}
function extentOf(cut) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < cut.verts.length; i += 5) {
    minX = Math.min(minX, cut.verts[i]); maxX = Math.max(maxX, cut.verts[i]);
    minZ = Math.min(minZ, cut.verts[i + 2]); maxZ = Math.max(maxZ, cut.verts[i + 2]);
  }
  return { minX, maxX, minZ, maxZ };
}

console.log("=== the cut ===");
{
  const g = geometryOf([
    quad(0, 1, 0, 2, 1, 0, 2, 1, 2, 0, 1, 2, true),        // a cap wholly inside [0,4]x[0,4]
    quad(3, 1, 0, 6, 1, 0, 6, 1, 2, 3, 1, 2, true),        // a cap straddling x = 4
    quad(5, 1, 0, 7, 1, 0, 7, 1, 2, 5, 1, 2, true),        // a cap wholly outside
    quad(4, 0, 0, 4, 0, 2, 4, 1, 2, 4, 1, 0, false),       // a wall IN the plane x = 4
    quad(2, 0, 0, 2, 0, 2, 2, 1, 2, 2, 1, 0, false),       // a wall inside, parallel to it
    quad(0, 0, 4, 2, 0, 4, 2, 1, 4, 0, 1, 4, false),       // a wall in the plane z = 4
    quad(1, 0, 3, 3, 0, 3, 3, 1, 5, 1, 1, 5, false),       // a wall straddling z = 4
  ]);
  const cut = clipQuads(g.verts, g.indices, g.quads, 0, 4, 0, 4);
  check("four of seven quads survive", cut.quads === 4, "" + cut.quads);
  const e = extentOf(cut);
  check("nothing survives outside the box", e.minX >= 0 && e.maxX <= 4 && e.minZ >= 0 && e.maxZ <= 4, JSON.stringify(e));
  check("the straddling cap was clamped, not dropped", e.maxX === 4);
  check("indices were rebased to the kept quads",
        cut.indices.length === 24 && Math.max.apply(null, cut.indices) === 15 && Math.min.apply(null, cut.indices) === 0);
  // The winding survives the rebase: the second kept quad is the straddling
  // cap (cap pattern), the third the inside wall (wall pattern).
  check("a cap keeps its winding", cut.indices.slice(6, 12).join() === [4, 5, 6, 4, 6, 7].join(), cut.indices.slice(6, 12).join());
  check("a wall keeps its winding", cut.indices.slice(12, 18).join() === [8, 10, 9, 8, 11, 10].join(), cut.indices.slice(12, 18).join());
  // The whole box: everything with extent inside stays, in place.
  const all = clipQuads(g.verts, g.indices, g.quads, -10, 10, -10, 10);
  check("a box round everything keeps everything", all.quads === 7);
  check("and moves nothing", all.verts.join() === g.verts.join());
  const none = clipQuads(g.verts, g.indices, g.quads, 20, 30, 20, 30);
  check("a box round nothing keeps nothing", none.quads === 0 && none.verts.length === 0);
}

console.log("=== chunks against the view ===");
{
  const view = { minTileX: 10, minTileZ: 10, maxTileX: 37, maxTileZ: 37 };  // 28 across
  check("a chunk inside the view is whole", (() => {
    const r = chunkViewRect(view, 3, 3, 6, 80, 80);   // tiles 18..23
    return r && rectIsWholeChunk(r, 3, 3, 6, 80, 80);
  })());
  check("a chunk on the edge is cut", (() => {
    const r = chunkViewRect(view, 1, 3, 6, 80, 80);   // tiles 6..11 -> 10..11
    return r && r.minTileX === 10 && r.maxTileX === 11 && !rectIsWholeChunk(r, 1, 3, 6, 80, 80);
  })());
  check("a chunk outside the view is nothing", chunkViewRect(view, 0, 3, 6, 80, 80) === null);
  check("a chunk at the map's edge is whole as far as the map goes", (() => {
    const r = chunkViewRect({ minTileX: 60, minTileZ: 0, maxTileX: 79, maxTileZ: 27 }, 13, 0, 6, 80, 80); // tiles 78..83 -> 78..79
    return r && r.maxTileX === 79 && rectIsWholeChunk(r, 13, 0, 6, 80, 80);
  })());
  check("sameRect", sameRect(view, { ...view }) && !sameRect(view, { ...view, maxTileX: 36 }) && sameRect(null, null) && !sameRect(view, null));
}

/** A map, its field over a cover, and the chunks of that cover built. */
function build(id, across, focusX, focusZ) {
  const def = bundle.maps[id];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const stats = tileStatsFor(bundle.tilesets[def.tileset]);
  const profile = shapeProfileFor(map, stats);
  const structures = detectStructures(map, stats, 0, 0, map.widthTiles - 1, map.heightTiles - 1, profile);
  const view = windowFor(map, across, focusX, focusZ, 0, false);
  const chunkTiles = chunkTilesFor(across);
  const cover = coverAround(map.widthTiles, map.heightTiles, chunkTiles,
                            view.minTileX, view.minTileZ, view.maxTileX, view.maxTileZ);
  const earthSpan = earthSpanTilesFor(map.widthTiles, map.heightTiles, across);
  const field = buildColumnField(map, stats,
    windowForRect(map, Math.max(0, cover.minTileX - HALO_TILES), Math.max(0, cover.minTileZ - HALO_TILES),
                  Math.min(map.widthTiles - 1, cover.maxTileX + HALO_TILES),
                  Math.min(map.heightTiles - 1, cover.maxTileZ + HALO_TILES), earthSpan, 0, false),
    structures, profile, true);
  return { map, stats, view, cover, chunkTiles, field };
}

/**
 * Everything the lens would draw for a built world: the cut of every chunk,
 * the rim included.
 *
 * Two extents come back, because since 20 September they are two different
 * things: the WORLD ends exactly at the view, and the earth RIM -- the slope
 * and the brown side under it -- stands half a tile further out, which is what
 * turns the cut into a slab with a bevelled edge instead of a wall.
 */
function drawn(world) {
  const { map, view, cover, chunkTiles, field, stats } = world;
  const originX = -map.widthTiles / 2;
  const originZ = -map.heightTiles / 2;
  const out = { quads: 0, skirt: 0, shown: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
                rimMinX: Infinity, rimMaxX: -Infinity, rimMinZ: Infinity, rimMaxZ: -Infinity };
  for (const at of coverChunks(cover)) {
    const rect = chunkViewRect(view, at[0], at[1], chunkTiles, map.widthTiles, map.heightTiles);
    if (!rect) continue;
    const g = buildChunkGeometry(field, map, at[0], at[1], stats, chunkTiles);
    const x0 = originX + rect.minTileX, x1 = originX + rect.maxTileX + 1;
    const z0 = originZ + rect.minTileZ, z1 = originZ + rect.maxTileZ + 1;
    const cut = clipQuads(g.verts, g.indices, g.quads, x0, x1, z0, z1);
    const world = extentOf(cut);
    const before = cut.quads;
    rimQuads(field, rect, view, map.widthTiles, map.heightTiles, VOXELS_PER_TILE, cut);
    out.skirt += cut.quads - before;
    const sway = clipQuads(g.swayVerts, g.swayIndices, g.swayQuads, x0, x1, z0, z1);
    out.quads += cut.quads + sway.quads;
    if (cut.quads + sway.quads > 0) out.shown++;
    out.minX = Math.min(out.minX, world.minX); out.maxX = Math.max(out.maxX, world.maxX);
    out.minZ = Math.min(out.minZ, world.minZ); out.maxZ = Math.max(out.maxZ, world.maxZ);
    const rim = extentOf(cut);
    out.rimMinX = Math.min(out.rimMinX, rim.minX); out.rimMaxX = Math.max(out.rimMaxX, rim.maxX);
    out.rimMinZ = Math.min(out.rimMinZ, rim.minZ); out.rimMaxZ = Math.max(out.rimMaxZ, rim.maxZ);
  }
  return out;
}

console.log("=== Route 1, as the lens draws it ===");
{
  const a = build("ROUTE_1", 28, 20, 40);
  const da = drawn(a);
  const originX = -a.map.widthTiles / 2, originZ = -a.map.heightTiles / 2;
  check("the drawn extent is exactly the view",
        Math.abs(da.minX - (originX + a.view.minTileX)) < 1e-9 && Math.abs(da.maxX - (originX + a.view.maxTileX + 1)) < 1e-9 &&
        Math.abs(da.minZ - (originZ + a.view.minTileZ)) < 1e-9 && Math.abs(da.maxZ - (originZ + a.view.maxTileZ + 1)) < 1e-9,
        JSON.stringify({ drawn: da, view: a.view }));
  check("the view is 28 tiles wide", a.view.maxTileX - a.view.minTileX + 1 === 28 && a.view.maxTileZ - a.view.minTileZ + 1 === 28);
  check("the cover holds the view and its lookahead",
        a.cover.minTileX <= a.view.minTileX - LOOKAHEAD_TILES && a.cover.maxTileX >= a.view.maxTileX + LOOKAHEAD_TILES &&
        a.cover.minTileZ <= a.view.minTileZ - LOOKAHEAD_TILES && a.cover.maxTileZ >= a.view.maxTileZ + LOOKAHEAD_TILES,
        JSON.stringify(a.cover));
  check("the skirt closes the cut on the sides that cut the map",
        da.skirt >= 28 * VOXELS_PER_TILE * 2, "" + da.skirt);
  // The rim stands outside the world, by the slope and no more. It is what
  // makes the plate a slab with a bevelled edge rather than a wall, and it may
  // not eat into the world: a slope cut from the last tile of ground would
  // sink whatever is standing on it.
  const slope = RIM_SLOPE_VOXELS * VOXEL;
  check("the rim reaches exactly the slope past the world, all round",
        Math.abs(da.rimMinX - (da.minX - slope)) < 1e-9 &&
        Math.abs(da.rimMaxX - (da.maxX + slope)) < 1e-9 &&
        Math.abs(da.rimMinZ - (da.minZ - slope)) < 1e-9 &&
        Math.abs(da.rimMaxZ - (da.maxZ + slope)) < 1e-9,
        JSON.stringify(da));
  // One step north: the view moves one tile, the cover may not move at all.
  const b = build("ROUTE_1", 28, 20, 39);
  const db = drawn(b);
  check("a step moves the view exactly one tile", b.view.minTileZ === a.view.minTileZ - 1 && b.view.maxTileZ === a.view.maxTileZ - 1,
        a.view.minTileZ + " -> " + b.view.minTileZ);
  check("and the drawn edge with it", Math.abs(db.minZ - (da.minZ - 1)) < 1e-9 && Math.abs(db.maxZ - (da.maxZ - 1)) < 1e-9);
  // The cover may or may not have grown by a column on that step -- it does
  // whenever the lookahead first touches a new chunk row -- but it can never
  // have LOST the ground the previous view stood on.
  check("and the cover still holds where the player was",
        b.cover.minTileZ <= a.view.minTileZ && b.cover.maxTileZ >= a.view.maxTileZ, JSON.stringify([a.view, b.cover]));
  console.log("  VIEWCLIP ROUTE_1 rung 28: " + da.quads + " quads drawn (" + da.skirt + " of skirt) in " + da.shown +
              " meshes, cover " + a.cover.across + " chunks across");
}

console.log("=== every step of a walk shows only built ground ===");
{
  const def = bundle.maps.ROUTE_1;
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  let ok = true;
  let moves = 0;
  let last = null;
  for (let z = 2; z < map.heightTiles - 2; z++) {
    const view = windowFor(map, 28, 20, z, 0, false);
    const cover = coverAround(map.widthTiles, map.heightTiles, chunkTilesFor(28),
                              view.minTileX, view.minTileZ, view.maxTileX, view.maxTileZ);
    if (view.minTileZ < cover.minTileZ || view.maxTileZ > cover.maxTileZ ||
        view.minTileX < cover.minTileX || view.maxTileX > cover.maxTileX) ok = false;
    if (last && JSON.stringify(last) !== JSON.stringify(cover)) moves++;
    last = cover;
  }
  check("the view never leaves the cover", ok);
  // The cover changes when the lookahead reaches a new chunk row, so about
  // once per chunk of walking, and once more at each end where the clamp lets
  // go; never once per step, which is what the view does.
  const steps = map.heightTiles - 4;
  const limit = Math.ceil(steps / chunkTilesFor(28)) + 3;
  check("the cover moved about once a chunk over the route, not once a step",
        moves > 0 && moves <= limit, moves + " moves in " + steps + " steps, limit " + limit);
}

if (SELFTEST) {
  // The clip is only worth anything if it says no: a box that keeps every
  // quad must fail the "nothing outside" claim on a quad placed outside.
  const g = geometryOf([quad(5, 1, 0, 7, 1, 0, 7, 1, 2, 5, 1, 2, true)]);
  const all = clipQuads(g.verts, g.indices, g.quads, -10, 10, -10, 10);
  const e = extentOf(all);
  check("SELFTEST an outside quad kept by a wide box is measured outside a narrow one", e.maxX > 4);
  // And a view moved one tile must NOT read as the same view.
  const a = { minTileX: 0, minTileZ: 0, maxTileX: 27, maxTileZ: 27 };
  check("SELFTEST sameRect notices one tile", !sameRect(a, { ...a, minTileZ: 1, maxTileZ: 28 }));
}

console.log("\nVIEWCLIP  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
