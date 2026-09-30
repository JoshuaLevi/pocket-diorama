// What a step of walking costs the terrain.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/terrainstream.test.mjs Assets/Generated/kanto.json --selftest
//
// The third playtest: "walking along a route, at the end of a block it takes a
// moment before the next block is loaded." The cause is measurable and this
// file measures it. The old rule rebuilt EVERY chunk of the window each time
// the player left the chunk at its centre, because a chunk was clipped to the
// window and walled off with earth wherever the window ended -- so a chunk that
// was still in view after the move was still a different chunk.
//
// Two claims are checked here, and they are the whole of the fix:
//
//   1. A chunk built under one cover is byte-identical to the same chunk built
//      under another. If that is not true, nothing can be kept.
//   2. Walking a map tile by tile builds an area proportional to the ground
//      newly exposed, not to steps times the size of the view.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: terrainstream.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const pal = await import("../Assets/Scripts/world/VoxelPalette.ts");
const { tileStatsFor } = pal;
const { detectStructures } = await import("../Assets/Scripts/world/Structures.ts");
const { shapeProfileFor } = await import("../Assets/Scripts/world/TileShapes.ts");
const terrain = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const { windowFor, windowForRect, chunksForWindow, buildColumnField, buildChunkGeometry,
        CHUNK_TILES } = terrain;
const plan = await import("../Assets/Scripts/world/ChunkPlan.ts");
// The ladder is spans now, not radii, and it moved to PlayArea with the play
// area itself. Every "rung times two plus one" below became "rung".
const { ZOOM_TILES_ACROSS, ZOOM_DEFAULT }
  = await import("../Assets/Scripts/world/PlayArea.ts");
// Measured at the rung the game actually ships on. These blocks used the
// TIGHTEST rung while the ladder was radii, where it covered 17 tiles; as spans
// the tightest is 14 and covers 15, which is smaller than Red's bedroom and too
// small for two covers to share the chunks these checks compare. The rung
// changed, not the claim.
const SPAN = ZOOM_TILES_ACROSS[ZOOM_DEFAULT];
const { coverAround, coverChunks, coverDelta, coverContains, chunkKeyOf, chunkTilesFor,
        coverChunksFor, earthSpanTilesFor, streamsIncrementally,
        MAX_CHUNK_TILES, MIN_COVER_CHUNKS, HALO_TILES, LOOKAHEAD_TILES } = plan;

/**
 * The view and the cover the lens builds for a focus tile, since 11
 * September: the view is a square of `span` tiles slid onto the map around
 * the player, the cover every chunk that touches the view grown by the
 * lookahead. What is DRAWN is the view, cut from the cover (world/ViewClip.ts,
 * test/viewclip.test.mjs); what this file measures is what is BUILT.
 */
function viewAt(map, span, fx, fz) {
  return windowFor(map, span, fx, fz, 0, false);
}
function coverAt(map, span, fx, fz) {
  const v = viewAt(map, span, fx, fz);
  return coverAround(map.widthTiles, map.heightTiles, chunkTilesFor(span),
                     v.minTileX, v.minTileZ, v.maxTileX, v.maxTileZ);
}

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}
function setup(id) {
  const def = bundle.maps[id];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const stats = tileStatsFor(bundle.tilesets[def.tileset]);
  const profile = shapeProfileFor(map, stats);
  const structures = detectStructures(map, stats, 0, 0,
                                      map.widthTiles - 1, map.heightTiles - 1, profile);
  return { map, stats, profile, structures };
}
/** The column field a cover is built from: the cover plus its halo. */
function fieldForCover(world, cover, earthSpan) {
  const { map, stats, profile, structures } = world;
  const w = windowForRect(
    map,
    Math.max(0, cover.minTileX - HALO_TILES),
    Math.max(0, cover.minTileZ - HALO_TILES),
    Math.min(map.widthTiles - 1, cover.maxTileX + HALO_TILES),
    Math.min(map.heightTiles - 1, cover.maxTileZ + HALO_TILES),
    earthSpan, 0, false);
  return buildColumnField(map, stats, w, structures, profile, true);
}
function chunkFingerprint(world, cover, earthSpan, cx, cz) {
  const field = fieldForCover(world, cover, earthSpan);
  const g = buildChunkGeometry(field, world.map, cx, cz, world.stats, cover.chunkTiles);
  return JSON.stringify([g.verts, g.indices, g.swayVerts, g.swayIndices]);
}

console.log("=== the cover: whole chunks, holding the view and its lookahead ===");
{
  for (let i = 0; i < ZOOM_TILES_ACROSS.length; i++) {
    const span = ZOOM_TILES_ACROSS[i];
    const ct = chunkTilesFor(span);
    const across = coverChunksFor(span);
    check("rung " + span + ": the chunk edge stays inside the measured one",
          ct >= 1 && ct <= MAX_CHUNK_TILES, "chunkTiles " + ct);
    check("rung " + span + ": chunks of that edge tile the rung in a few",
          across >= MIN_COVER_CHUNKS && across * ct >= span, across + "x" + ct + " for " + span);
  }
  const world = setup("ROUTE_1");
  const span = SPAN;
  let holdsView = true;
  let holdsLookahead = true;
  let viewSized = true;
  for (let z = 0; z < world.map.heightTiles; z++) {
    const view = viewAt(world.map, span, 20, z);
    const cover = coverAt(world.map, span, 20, z);
    // The view slides onto the map at an edge rather than shrinking (see
    // PlayArea.slideSpan), and the cover always holds it.
    if (view.maxTileZ - view.minTileZ + 1 !== span) viewSized = false;
    if (view.minTileZ < cover.minTileZ || view.maxTileZ > cover.maxTileZ ||
        view.minTileX < cover.minTileX || view.maxTileX > cover.maxTileX) holdsView = false;
    // ...and its lookahead too, as far as the map goes.
    if (Math.max(0, view.minTileZ - LOOKAHEAD_TILES) < cover.minTileZ ||
        Math.min(world.map.heightTiles - 1, view.maxTileZ + LOOKAHEAD_TILES) > cover.maxTileZ) holdsLookahead = false;
  }
  check("the view keeps its size at a map edge", viewSized);
  check("the view is always inside the cover", holdsView);
  check("and so is its lookahead", holdsLookahead);
  check("a map smaller than the view is the cover", (() => {
    const small = setup("REDS_HOUSE_2F");
    const c = coverAt(small.map, span, 8, 8);
    return c.minTileX === 0 && c.minTileZ === 0 &&
           c.maxTileX === small.map.widthTiles - 1 && c.maxTileZ === small.map.heightTiles - 1;
  })());
  check("the earth's depth is a property of the map and the rung, not of where you stand",
        earthSpanTilesFor(world.map.widthTiles, world.map.heightTiles, span) ===
        earthSpanTilesFor(world.map.widthTiles, world.map.heightTiles, span));
}

console.log("=== a chunk is the same chunk wherever the cover is ===");
{
  // The claim the whole fix rests on. A chunk is built over its own tiles and
  // closed with its own earth wall, so moving the cover cannot change it --
  // not its walls, not its shading, not the tile it stands next to.
  const world = setup("ROUTE_1");
  const span = SPAN;
  const earth = earthSpanTilesFor(world.map.widthTiles, world.map.heightTiles, span);
  const W = world.map.widthTiles;
  const H = world.map.heightTiles;
  const cases = [
    // The same chunk seen from the middle of two covers, from the north edge
    // of one and the south edge of another, and against a map edge.
    [[20, 20], [20, 26]],
    [[20, 20], [20, 14]],
    [[20, 2], [20, 20]],
    [[20, 20], [26, 20]],
    [[8, 40], [30, 40]],
  ];
  let compared = 0;
  let differ = 0;
  let first = null;
  for (let i = 0; i < cases.length; i++) {
    const a = coverAt(world.map, span, cases[i][0][0], cases[i][0][1]);
    const b = coverAt(world.map, span, cases[i][1][0], cases[i][1][1]);
    const shared = coverChunks(a).filter((c) => coverContains(b, c[0], c[1]));
    for (let j = 0; j < shared.length; j++) {
      const fa = chunkFingerprint(world, a, earth, shared[j][0], shared[j][1]);
      const fb = chunkFingerprint(world, b, earth, shared[j][0], shared[j][1]);
      compared++;
      if (fa !== fb) {
        differ++;
        if (!first) first = "chunk " + shared[j].join(",") + " between focus " +
                            cases[i][0].join(",") + " and " + cases[i][1].join(",");
      }
    }
  }
  check("there are shared chunks to compare at all", compared >= 20, String(compared));
  check("every chunk both covers hold is byte-identical", differ === 0,
        differ + " of " + compared + " differ, first: " + first);

  // A cover the size of the map is one cover, so nothing can move under it.
  const room = setup("REDS_HOUSE_2F");
  const rc = coverAt(room.map, span, 4, 4);
  const rEarth = earthSpanTilesFor(room.map.widthTiles, room.map.heightTiles, span);
  const rd2 = coverAt(room.map, span, 12, 12);
  check("an interior is one cover from any corner of it",
        JSON.stringify(coverChunks(rc)) === JSON.stringify(coverChunks(rd2)));
  check("and its chunks are built the same from either",
        chunkFingerprint(room, rc, rEarth, 0, 0) ===
        chunkFingerprint(room, rd2, rEarth, 0, 0));
}

console.log("=== the mesh limit still holds at the new chunk sizes ===");
{
  const MAX_QUADS = 16383;
  for (const id of ["VIRIDIAN_CITY", "VIRIDIAN_FOREST", "PALLET_TOWN"]) {
    const world = setup(id);
    for (let i = 0; i < ZOOM_TILES_ACROSS.length; i++) {
      const span = ZOOM_TILES_ACROSS[i];
      const earth = earthSpanTilesFor(world.map.widthTiles, world.map.heightTiles, span);
      const cover = coverAt(world.map, span,
                            Math.floor(world.map.widthTiles / 2),
                            Math.floor(world.map.heightTiles / 2));
      const field = fieldForCover(world, cover, earth);
      let worst = 0;
      const chunks = coverChunks(cover);
      for (let j = 0; j < chunks.length; j++) {
        const g = buildChunkGeometry(field, world.map, chunks[j][0], chunks[j][1],
                                     world.stats, cover.chunkTiles);
        if (g.quads > worst) worst = g.quads;
        if (g.verts.length !== g.quads * 4 * 5 || g.indices.length !== g.quads * 6) {
          check(id + " rung " + span + ": vertex and index counts match the quads", false);
        }
      }
      check(id + " rung " + span + ": every chunk fits a 16-bit mesh",
            worst > 0 && worst <= MAX_QUADS, "worst " + worst);
    }
  }
}

console.log("=== walking costs the strip, not the view ===");
{
  /**
   * What the old rule spent walking north: it re-anchored when the player left
   * the chunk at the centre of the window, and then queued every chunk the
   * window touched -- including the ones already standing there unchanged.
   */
  function walkOld(world, span, steps, fromZ, stride) {
    const map = world.map;
    const fx = Math.floor(map.widthTiles / 2);
    let anchorX = -1;
    let anchorZ = -1;
    let held = {};
    let builds = 0;
    let area = 0;
    let wasted = 0;
    let worstBurst = 0;
    for (let s = 0; s < steps; s++) {
      const fz = fromZ + s * stride;
      const ax = Math.floor(fx / CHUNK_TILES);
      const az = Math.floor(fz / CHUNK_TILES);
      if (ax === anchorX && az === anchorZ) continue;
      const first = anchorX < 0;
      anchorX = ax;
      anchorZ = az;
      const w = windowFor(map, span, (ax + 0.5) * CHUNK_TILES, (az + 0.5) * CHUNK_TILES, 0, false);
      const chunks = chunksForWindow(w);
      builds += chunks.length;
      // The first fill is not a stutter: it happens behind a loading screen,
      // where flush() builds the lot. What is measured is the steady state.
      if (!first && chunks.length > worstBurst) worstBurst = chunks.length;
      const now = {};
      for (let i = 0; i < chunks.length; i++) {
        const key = chunkKeyOf(chunks[i][0], chunks[i][1]);
        now[key] = true;
        if (held[key]) wasted++;
        // The old build was clipped to the window, so its area is the overlap.
        const x0 = Math.max(chunks[i][0] * CHUNK_TILES, w.minTileX);
        const x1 = Math.min((chunks[i][0] + 1) * CHUNK_TILES - 1, w.maxTileX);
        const z0 = Math.max(chunks[i][1] * CHUNK_TILES, w.minTileZ);
        const z1 = Math.min((chunks[i][1] + 1) * CHUNK_TILES - 1, w.maxTileZ);
        area += (x1 - x0 + 1) * (z1 - z0 + 1);
      }
      held = now;
    }
    return { builds, area, wasted, worstBurst };
  }
  /** And what the cover spends over the same walk. */
  function walkNew(world, span, steps, fromZ, stride) {
    const map = world.map;
    const fx = Math.floor(map.widthTiles / 2);
    let held = [];
    let builds = 0;
    let area = 0;
    let wasted = 0;
    let worstBurst = 0;
    let unionMinX = Infinity, unionMaxX = -Infinity;
    let unionMinZ = Infinity, unionMaxZ = -Infinity;
    for (let s = 0; s < steps; s++) {
      const cover = coverAt(map, span, fx, fromZ + s * stride);
      unionMinX = Math.min(unionMinX, cover.minTileX);
      unionMaxX = Math.max(unionMaxX, cover.maxTileX);
      unionMinZ = Math.min(unionMinZ, cover.minTileZ);
      unionMaxZ = Math.max(unionMaxZ, cover.maxTileZ);
      const delta = coverDelta(cover, held);
      builds += delta.build.length;
      if (s > 0 && delta.build.length > worstBurst) worstBurst = delta.build.length;
      for (let i = 0; i < delta.build.length; i++) {
        const x0 = delta.build[i][0] * cover.chunkTiles;
        const x1 = Math.min((delta.build[i][0] + 1) * cover.chunkTiles - 1, map.widthTiles - 1);
        const z0 = delta.build[i][1] * cover.chunkTiles;
        const z1 = Math.min((delta.build[i][1] + 1) * cover.chunkTiles - 1, map.heightTiles - 1);
        area += (x1 - x0 + 1) * (z1 - z0 + 1);
      }
      const wanted = {};
      const chunks = coverChunks(cover);
      for (let i = 0; i < chunks.length; i++) wanted[chunkKeyOf(chunks[i][0], chunks[i][1])] = true;
      held = held.filter((c) => wanted[chunkKeyOf(c[0], c[1])]).concat(delta.build);
    }
    const swept = (unionMaxX - unionMinX + 1) * (unionMaxZ - unionMinZ + 1);
    return { builds, area, wasted, worstBurst, swept };
  }

  for (const id of ["ROUTE_1", "VIRIDIAN_CITY", "VIRIDIAN_FOREST"]) {
    const world = setup(id);
    const span = SPAN;
    const steps = world.map.heightTiles - 4;
    const before = walkOld(world, span, steps, 2, 1);
    const after = walkNew(world, span, steps, 2, 1);
    console.log("  TERRAINSTREAM " + id + ", " + steps + " steps at rung " + span + ":" +
                "  before " + before.builds + " builds / " + before.area + " tiles" +
                ", " + before.wasted + " of them already correct" +
                ", worst burst " + before.worstBurst +
                "  ->  after " + after.builds + " builds / " + after.area + " tiles" +
                ", " + after.wasted + " already correct" +
                ", worst burst " + after.worstBurst +
                "  (ground walked past: " + after.swept + " tiles)");
    // The point of the stage: the ground is built about once, rather than once
    // per chunk boundary crossed.
    check(id + ": the area built is the ground walked past, near enough",
          after.area <= after.swept * 1.35,
          after.area + " tiles built for " + after.swept + " exposed");
    check(id + ": the old rule built the same ground over and over",
          before.area > after.swept * 1.75,
          before.area + " tiles built for " + after.swept + " exposed");
    check(id + ": most of the old rule's builds were of chunks already standing",
          before.wasted * 2 > before.builds, before.wasted + " of " + before.builds);
    check(id + ": nothing is now built twice",
          after.wasted === 0, String(after.wasted));
    check(id + ": and a smaller burst when it does build",
          after.worstBurst * 2 <= before.worstBurst,
          after.worstBurst + " vs " + before.worstBurst);
    // Standing still must cost nothing at all.
    const still = walkNew(world, span, 30, 20, 0);
    check(id + ": standing still builds the view once and then nothing",
          still.builds === coverChunks(
            coverAt(world.map, span, Math.floor(world.map.widthTiles / 2), 20)).length,
          String(still.builds));
  }
}

console.log("=== a bent world keeps the old behaviour ===");
{
  check("flat and hard-edged streams incrementally", streamsIncrementally(0, false));
  check("a curve does not", !streamsIncrementally(1, false));
  check("nor does a rim that rolls off", !streamsIncrementally(0, true));
}

if (SELFTEST) {
  console.log("=== selftest: the measurements can fail ===");
  // A test that cannot fail proves nothing. Feed the two claims something that
  // is wrong on purpose and check they say so.
  const world = setup("ROUTE_1");
  const span = SPAN;
  const earth = earthSpanTilesFor(world.map.widthTiles, world.map.heightTiles, span);
  const a = coverAt(world.map, span, 20, 20);
  const b = coverAt(world.map, span, 20, 26);
  const shared = coverChunks(a).filter((c) => coverContains(b, c[0], c[1]));
  // The same chunk index against a DIFFERENT map must not fingerprint the same,
  // or the fingerprint is not looking at the geometry.
  const other = setup("VIRIDIAN_CITY");
  const oc = coverAt(other.map, span, 20, 20);
  const oEarth = earthSpanTilesFor(other.map.widthTiles, other.map.heightTiles, span);
  check("the fingerprint notices a different map",
        chunkFingerprint(world, a, earth, shared[0][0], shared[0][1]) !==
        chunkFingerprint(other, oc, oEarth, shared[0][0], shared[0][1]));
  // And a cover that does not move must hold every chunk it had.
  const same = coverDelta(a, coverChunks(a));
  check("a cover that has not moved builds nothing",
        same.build.length === 0 && same.drop.length === 0);
  const moved = coverDelta(b, coverChunks(a));
  check("a cover that has moved builds a row and drops one",
        moved.build.length > 0 && moved.drop.length === moved.build.length,
        moved.build.length + " built, " + moved.drop.length + " dropped");
}

console.log((fail === 0 ? "TERRAINSTREAM PASS " : "TERRAINSTREAM FAIL ") + pass + " checks, " +
            fail + " failures");
process.exit(fail === 0 ? 0 : 1);
