// Which way every triangle of the terrain faces.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/terrainwinding.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The terrain's material is drawn TWO-SIDED, which means the graphics card is
// forbidden from throwing away the back of anything. That is a real cost --
// every wall in the world is rasterised from both sides -- and it was there to
// hide something: the mesh's own winding disagreed with itself.
//
// Measured, before the fix, on three maps:
//
//   caps  (the flat tops and undersides)   all outward
//   walls (everything vertical)            NOT ONE outward
//                                          70-72% provably INWARD
//                                          the rest between two solid columns,
//                                          where a heightfield cannot tell
//
// So the tops faced out of the ground and the sides faced into it, in the same
// mesh. With culling off that is invisible; turn culling on and half the world
// disappears, which is presumably what happened to whoever set twoSided.
//
// This suite is what makes `pass.twoSided = false` a change that can be TRIED
// rather than guessed at. It walks the INDICES -- what the rasteriser actually
// winds by -- because reading the vertex array in order measures the order the
// corners were pushed in, which does not change when the winding does. The
// first version of this measurement did exactly that and reported no change
// from a fix that had already landed.
//
// Outward is decided against the column field, not against a convention: step
// half a voxel along the triangle's normal and half a voxel against it, and
// ask the heightfield which of the two is inside the ground.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: terrainwinding.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { tileStatsFor } = await import("../Assets/Scripts/world/VoxelPalette.ts");
const { buildColumnField, buildChunkGeometry, windowForRect, VOXELS_PER_TILE, VOXEL }
  = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const { detectStructures } = await import("../Assets/Scripts/world/Structures.ts");
const { shapeProfileFor } = await import("../Assets/Scripts/world/TileShapes.ts");
const { coverFor, coverChunks, earthSpanTilesFor, HALO_TILES }
  = await import("../Assets/Scripts/world/ChunkPlan.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

const ACROSS = 20;

/** Every triangle of one map's cover, sorted into outward, inward and unclear. */
function windingOf(id, flipCaps, flipWalls) {
  const def = bundle.maps[id];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const stats = tileStatsFor(bundle.tilesets[def.tileset]);
  const profile = shapeProfileFor(map, stats);
  const structures = detectStructures(map, stats, 0, 0,
                                      map.widthTiles - 1, map.heightTiles - 1, profile);
  const cx = Math.floor(map.widthTiles / 2);
  const cz = Math.floor(map.heightTiles / 2);
  const cover = coverFor(map.widthTiles, map.heightTiles, ACROSS, cx, cz);
  const earthSpan = earthSpanTilesFor(map.widthTiles, map.heightTiles, ACROSS);
  const win = windowForRect(map,
                            Math.max(0, cover.minTileX - HALO_TILES),
                            Math.max(0, cover.minTileZ - HALO_TILES),
                            Math.min(map.widthTiles - 1, cover.maxTileX + HALO_TILES),
                            Math.min(map.heightTiles - 1, cover.maxTileZ + HALO_TILES),
                            earthSpan, 0, false);
  const field = buildColumnField(map, stats, win, structures, profile, true);
  const originX = -map.widthTiles / 2;
  const originZ = -map.heightTiles / 2;
  const colOf = (x) => Math.floor((x - originX) / VOXEL) - win.minTileX * VOXELS_PER_TILE;
  const rowOf = (z) => Math.floor((z - originZ) / VOXEL) - win.minTileZ * VOXELS_PER_TILE;
  const heightAt = (c, r) => {
    if (c < 0 || r < 0 || c >= field.cols || r >= field.rows) return -win.earthVoxels;
    if (field.cut && field.cut[r * field.cols + c]) return -win.earthVoxels;
    return field.heights[r * field.cols + c];
  };
  const solid = (x, y, z) => {
    const c = colOf(x);
    const r = rowOf(z);
    if (c < 0 || r < 0 || c >= field.cols || r >= field.rows) return false;
    return y < heightAt(c, r) * VOXEL - 1e-9 && y > -win.earthVoxels * VOXEL - 1e-9;
  };
  const out = { capOut: 0, capIn: 0, capUnclear: 0,
                wallOut: 0, wallIn: 0, wallUnclear: 0 };
  const chunks = coverChunks(cover);
  for (let k = 0; k < chunks.length; k++) {
    const g = buildChunkGeometry(field, map, chunks[k][0], chunks[k][1], stats,
                                 cover.chunkTiles);
    const verts = g.verts;
    const idx = g.indices;
    if (!verts || !idx) continue;
    const V = (i) => [verts[i * 5], verts[i * 5 + 1], verts[i * 5 + 2]];
    for (let t = 0; t + 2 < idx.length; t += 3) {
      let P = [V(idx[t]), V(idx[t + 1]), V(idx[t + 2])];
      const ys = [P[0][1], P[1][1], P[2][1]];
      const flat = Math.max.apply(null, ys) - Math.min.apply(null, ys) < 1e-9;
      // The selftest reverses one class of triangle to prove the detector
      // below is looking at the winding rather than at the geometry.
      if ((flat && flipCaps) || (!flat && flipWalls)) {
        P = [P[0], P[2], P[1]];
      }
      const ab = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
      const ac = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const n = [ab[1] * ac[2] - ab[2] * ac[1],
                 ab[2] * ac[0] - ab[0] * ac[2],
                 ab[0] * ac[1] - ab[1] * ac[0]];
      const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
      if (len < 1e-12) continue;
      const u = [n[0] / len, n[1] / len, n[2] / len];
      const ctr = [(P[0][0] + P[1][0] + P[2][0]) / 3,
                   (P[0][1] + P[1][1] + P[2][1]) / 3,
                   (P[0][2] + P[1][2] + P[2][2]) / 3];
      const e = VOXEL * 0.5;
      const so = solid(ctr[0] + u[0] * e, ctr[1] + u[1] * e, ctr[2] + u[2] * e);
      const si = solid(ctr[0] - u[0] * e, ctr[1] - u[1] * e, ctr[2] - u[2] * e);
      const where = !so && si ? "Out" : so && !si ? "In" : "Unclear";
      out[(flat ? "cap" : "wall") + where] = out[(flat ? "cap" : "wall") + where] + 1;
    }
  }
  return out;
}

const MAPS = ["PALLET_TOWN", "VIRIDIAN_CITY", "ROUTE_22"];

console.log("=== not one triangle faces into the ground it stands on ===");
const measured = {};
console.log("  map              caps out/in/?        walls out/in/?");
for (let i = 0; i < MAPS.length; i++) {
  const id = MAPS[i];
  const w = windingOf(id, false, false);
  measured[id] = w;
  console.log("  " + id.padEnd(16) +
              (w.capOut + "/" + w.capIn + "/" + w.capUnclear).padEnd(20) +
              (w.wallOut + "/" + w.wallIn + "/" + w.wallUnclear));
  check(id + ": no cap faces inward", w.capIn === 0, w.capIn + " do");
  check(id + ": no wall faces inward", w.wallIn === 0, w.wallIn + " do");
  // The measurement has to be capable of finding something. A probe that
  // answered "unclear" everywhere would satisfy the two checks above and
  // prove nothing at all.
  check(id + ": the probe decides most walls", w.wallOut > w.wallUnclear,
        w.wallOut + " decided against " + w.wallUnclear + " unclear");
  check(id + ": and there are caps to decide", w.capOut > 0);
}

if (SELFTEST) {
  console.log("=== selftest: the detector reads the winding, not the shape ===");
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
  // The whole suite rests on the claim that reversing a triangle changes the
  // answer. Reverse the walls and the walls must all come back INWARD; reverse
  // the caps and the caps must. If neither moves, the probe is measuring the
  // geometry and would have reported success for any winding at all -- which
  // is exactly the mistake the first version of this measurement made.
  expectFailures("walls reversed", () => {
    const w = windingOf("PALLET_TOWN", false, true);
    check("wall detector", w.wallIn === 0, w.wallIn + " face inward");
  });
  expectFailures("caps reversed", () => {
    const w = windingOf("PALLET_TOWN", true, false);
    check("cap detector", w.capIn === 0, w.capIn + " face inward");
  });
  // ...and reversing one class must leave the other alone, or the flag is not
  // selecting what it claims to.
  const flipped = windingOf("PALLET_TOWN", false, true);
  check("reversing the walls leaves the caps outward",
        flipped.capIn === 0 && flipped.capOut === measured["PALLET_TOWN"].capOut);
  check("...and turns every decided wall around",
        flipped.wallIn === measured["PALLET_TOWN"].wallOut && flipped.wallOut === 0);
}

console.log("");
console.log("TERRAINWINDING  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
