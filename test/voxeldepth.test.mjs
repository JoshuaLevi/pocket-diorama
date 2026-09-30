// The shading a voxel gets from the SHAPE of the world, not from which way it
// faces.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/voxeldepth.test.mjs Assets/Generated/kanto.json --selftest
//
// Three claims, and all three are numbers:
//
//   1. A face with something taller beside it is darker than one without, and
//      darker still where two things lean over it. That is form: a tree gets a
//      ring at its foot, a house gets a line where it meets the ground.
//   2. A tile takes a small deterministic lift or does not, so a field of
//      grass is not one flat wash.
//   3. Neither costs a single quad or a single vertex. The glasses overheated
//      and slept on 8 September; every look change since answers for its
//      geometry before it is committed, and the counts below are the ones
//      measured on the commit before this one.
//
// The crawl check is the one that matters most. The window re-anchors per tile
// as the player walks, so a variation keyed to the WINDOW would shimmer across
// the whole world at every step. Keyed to the MAP it holds still, and the way
// to prove that is to build the same chunk under two windows one tile apart
// and demand the vertices come out identical.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: voxeldepth.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const pal = await import("../Assets/Scripts/world/VoxelPalette.ts");
const { tileStatsFor, paletteTexels, texelIndex, earthTexelIndex,
        PALETTE_CATEGORIES, PALETTE_TEXEL_COUNT, PALETTE_TEXELS_ACROSS,
        BAND_COUNT, BAND_TOP, BAND_FLOOR, BAND_NORTH } = pal;
const { detectStructures } = await import("../Assets/Scripts/world/Structures.ts");
const S = await import("../Assets/Scripts/world/TileShapes.ts");
const T = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const D = await import("../Assets/Scripts/world/VoxelDepth.ts");
const { DEPTH_LEVELS, DEPTH_NEUTRAL, DEPTH_VALUE,
        tileLift, depthIndex, topOcclusion, sideOcclusion } = D;

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "VOXELDEPTH", "Red's Route 1 quad counts");
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

/** How many texels one depth level spans: every category, shade and band. */
const LEVEL_STRIDE = PALETTE_CATEGORIES.length * 4 * BAND_COUNT;

/** Everything one map needs, built the way VoxelTerrain builds it. */
function world(id, distance = -1, focusX = -1, focusZ = -1) {
  const def = bundle.maps[id];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const stats = tileStatsFor(bundle.tilesets[def.tileset]);
  const profile = S.shapeProfileFor(map, stats);
  const structures = detectStructures(map, stats, 0, 0, map.widthTiles - 1,
                                      map.heightTiles - 1, profile);
  const fx = focusX < 0 ? map.widthTiles / 2 : focusX;
  const fz = focusZ < 0 ? map.heightTiles / 2 : focusZ;
  const window = T.windowFor(map, distance, fx, fz, 0, false);
  const field = T.buildColumnField(map, stats, window, structures, profile, true);
  return { map, stats, profile, structures, window, field };
}

/** The texel a quad's UV points at, back from the UV. */
function texelOf(u, v) {
  const across = PALETTE_TEXELS_ACROSS;
  const col = Math.round(u * across - 0.5);
  const row = Math.round((1 - v) * across - 0.5);
  return row * across + col;
}
const levelOf = (i) => Math.floor(i / LEVEL_STRIDE);
const bandOf = (i) => i % BAND_COUNT;
const categoryOf = (i) => Math.floor((i % LEVEL_STRIDE) / BAND_COUNT / 4);
const isEarth = (i) => i >= DEPTH_LEVELS * LEVEL_STRIDE;

console.log("=== the value ladder ===");
{
  check("the ladder has one entry per level", DEPTH_VALUE.length === DEPTH_LEVELS);
  let falls = true;
  for (let i = 1; i < DEPTH_VALUE.length; i++) {
    if (DEPTH_VALUE[i] >= DEPTH_VALUE[i - 1]) falls = false;
  }
  check("...and every step down it is darker than the last", falls,
        DEPTH_VALUE.join(" "));
  // The neutral rung must leave the colour exactly as the band left it, or
  // this stage has changed the world's colour, which is the NEXT stage's job.
  check("the neutral rung is the colour untouched", DEPTH_VALUE[DEPTH_NEUTRAL] === 1);
  check("there is a rung above neutral and two below",
        DEPTH_NEUTRAL === 1 && DEPTH_LEVELS === 4);
  check("nothing is lifted or sunk by more than a tenth",
        DEPTH_VALUE[0] <= 1.1 && DEPTH_VALUE[DEPTH_LEVELS - 1] >= 0.8,
        DEPTH_VALUE.join(" "));

  check("a plain face on flat ground is neutral", depthIndex(0, 0) === DEPTH_NEUTRAL);
  check("a lifted tile is lighter than neutral", depthIndex(1, 0) < DEPTH_NEUTRAL);
  check("one thing leaning over a face darkens it",
        depthIndex(0, 1) > DEPTH_NEUTRAL);
  check("two is the darkest rung there is", depthIndex(0, 2) === DEPTH_LEVELS - 1);
  check("a lift cannot cancel a crevice", depthIndex(1, 2) > DEPTH_NEUTRAL);
  let bounded = true;
  for (let lift = 0; lift <= 1; lift++) {
    for (let ao = -3; ao <= 9; ao++) {
      const d = depthIndex(lift, ao);
      if (d < 0 || d >= DEPTH_LEVELS || d !== Math.floor(d)) bounded = false;
    }
  }
  check("and no input can point outside the ladder", bounded);
}

console.log("=== the per-tile lift is a hash, not a random number ===");
{
  let ones = 0;
  let total = 0;
  let binary = true;
  let stable = true;
  for (let z = -32; z < 32; z++) {
    for (let x = -32; x < 32; x++) {
      const a = tileLift(x, z);
      if (a !== 0 && a !== 1) binary = false;
      if (tileLift(x, z) !== a) stable = false;
      ones += a;
      total++;
    }
  }
  check("it answers nothing but nought and one", binary);
  check("...the same way every time it is asked", stable);
  check("...and it is not a constant", ones > total * 0.35 && ones < total * 0.65,
        ones + " of " + total);

  // Stripes would read as corduroy laid over the whole map, which is worse
  // than the flat wash it replaces.
  let flatRows = 0;
  let flatColumns = 0;
  for (let k = -32; k < 32; k++) {
    let row = true;
    let column = true;
    for (let i = -32; i < 32; i++) {
      if (tileLift(i, k) !== tileLift(-32, k)) row = false;
      if (tileLift(k, i) !== tileLift(k, -32)) column = false;
    }
    if (row) flatRows++;
    if (column) flatColumns++;
  }
  check("no row of the map is all one value", flatRows === 0, flatRows + " rows");
  check("no column of the map is either", flatColumns === 0, flatColumns + " columns");

  // Negative tile coordinates never reach it from the window, but a hash that
  // throws or returns a fraction on one is a hash waiting to break.
  check("it survives the far corners of the world",
        tileLift(0, 0) >= 0 && tileLift(255, 255) >= 0 && tileLift(1e4, 1e4) >= 0);
}

console.log("=== what leans over a face ===");
{
  // A top with nothing above it anywhere near is lit as it always was.
  check("flat ground has no crevice", topOcclusion(0, 0, 0, 0, 0) === 0);
  check("...and neither has a hilltop", topOcclusion(4, 0, 1, 2, 3) === 0);
  check("one taller neighbour is one step", topOcclusion(0, 3, 0, 0, 0) === 1);
  check("two are two", topOcclusion(0, 3, 3, 0, 0) === 2);
  check("...and four are still two", topOcclusion(0, 3, 3, 3, 3) === 2);
  check("a neighbour at the same height leans over nothing",
        topOcclusion(2, 2, 2, 2, 2) === 0);

  // A wall is shaded by what flanks it, not by what stands in front of it:
  // the thing in front is what the wall drops to, so it is lower by
  // construction.
  check("a north face reads the columns east and west of it",
        sideOcclusion(0, 0, 9, 9, 5, 0) === 1);
  check("a south face reads the same two", sideOcclusion(1, 0, 9, 9, 5, 5) === 2);
  check("an east face reads the ones north and south",
        sideOcclusion(3, 0, 5, 0, 9, 9) === 1);
  check("a west face reads them too", sideOcclusion(2, 0, 5, 5, 9, 9) === 2);
  check("a flank at the same height is a corner, not a nook",
        sideOcclusion(0, 4, 0, 0, 4, 4) === 0);
  check("an open wall is not shaded at all", sideOcclusion(1, 4, 0, 0, 0, 0) === 0);
}

console.log("=== the palette carries the ladder, and nothing else changed ===");
{
  check("every level of every colour fits the texture",
        DEPTH_LEVELS * LEVEL_STRIDE + 2 <= PALETTE_TEXEL_COUNT,
        (DEPTH_LEVELS * LEVEL_STRIDE + 2) + " of " + PALETTE_TEXEL_COUNT);
  check("the texture is not bigger than it has to be",
        (PALETTE_TEXELS_ACROSS - 1) * (PALETTE_TEXELS_ACROSS - 1) <
          DEPTH_LEVELS * LEVEL_STRIDE + 2);
  const grass = PALETTE_CATEGORIES.indexOf("GRASS");
  check("asking for no depth asks for the neutral rung",
        texelIndex(grass, 1, BAND_TOP) === texelIndex(grass, 1, BAND_TOP, DEPTH_NEUTRAL));
  // TileShapes' suite decodes a quad's band as index % BAND_COUNT. The depth
  // axis is the OUTER one precisely so that stays true at every level.
  let bands = true;
  let distinct = true;
  const seen = [];
  for (let level = 0; level < DEPTH_LEVELS; level++) {
    for (let c = 0; c < PALETTE_CATEGORIES.length; c++) {
      for (let shade = 0; shade < 4; shade++) {
        for (let band = 0; band < BAND_COUNT; band++) {
          const i = texelIndex(c, shade, band, level);
          if (bandOf(i) !== band) bands = false;
          if (levelOf(i) !== level) distinct = false;
          if (categoryOf(i) !== c) distinct = false;
          if (seen[i]) distinct = false;
          seen[i] = true;
          if (i < 0 || i >= PALETTE_TEXEL_COUNT) distinct = false;
        }
      }
    }
  }
  check("a quad's band is still readable off its texel", bands);
  check("no two colours share a texel", distinct);
  check("the earth still sits past every one of them",
        earthTexelIndex(0) >= DEPTH_LEVELS * LEVEL_STRIDE &&
        earthTexelIndex(1) < PALETTE_TEXEL_COUNT);

  // The stage is FORM, not colour: a deeper rung must be the same colour with
  // less light on it, never a different hue.
  const rgba = paletteTexels(bundle.tilePalettes, bundle.palettes.PALLET);
  const read = (i) => {
    const column = i % PALETTE_TEXELS_ACROSS;
    const row = Math.floor(i / PALETTE_TEXELS_ACROSS);
    const o = ((PALETTE_TEXELS_ACROSS - 1 - row) * PALETTE_TEXELS_ACROSS + column) * 4;
    return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
  };
  let darker = true;
  let sameHue = true;
  let opaque = true;
  for (let c = 0; c < PALETTE_CATEGORIES.length; c++) {
    for (let shade = 0; shade < 4; shade++) {
      for (let band = 0; band < BAND_COUNT; band++) {
        const base = read(texelIndex(c, shade, band, DEPTH_NEUTRAL));
        for (let level = 0; level < DEPTH_LEVELS; level++) {
          const here = read(texelIndex(c, shade, band, level));
          if (here[3] !== 255) opaque = false;
          for (let ch = 0; ch < 3; ch++) {
            // 1.0 is neutral, so a level below it may not be brighter and a
            // level above it may not be darker. Rounding is worth one count.
            if (level > DEPTH_NEUTRAL && here[ch] > base[ch] + 1) darker = false;
            if (level < DEPTH_NEUTRAL && here[ch] + 1 < base[ch]) darker = false;
            // Same colour, less light: every channel scaled by the same
            // number, to within rounding and the 255 ceiling.
            const want = Math.min(255, Math.round(base[ch] * DEPTH_VALUE[level]));
            if (Math.abs(here[ch] - want) > 2) sameHue = false;
          }
        }
      }
    }
  }
  check("a deeper rung is never brighter", darker);
  check("...and is the same hue with less light on it", sameHue);
  check("every texel is still opaque", opaque);
}

console.log("=== a field of grass is no longer one flat wash ===");
{
  const w = world("ROUTE_1");
  const grass = PALETTE_CATEGORIES.indexOf("GRASS");
  const levels = [0, 0, 0, 0];
  const grassLevels = [0, 0, 0, 0];
  let quads = 0;
  let earth = 0;
  for (const [cx, cz] of T.chunksForWindow(w.window)) {
    const g = T.buildChunkGeometry(w.field, w.map, cx, cz, w.stats);
    for (let q = 0; q < g.quads; q++) {
      const i = texelOf(g.verts[q * 20 + 3], g.verts[q * 20 + 4]);
      quads++;
      if (isEarth(i)) { earth++; continue; }
      levels[levelOf(i)]++;
      if (categoryOf(i) === grass && bandOf(i) === BAND_FLOOR) {
        grassLevels[levelOf(i)]++;
      }
    }
  }
  check("the route is built at all", quads > 1000, quads + " quads");
  check("its earth is still earth", earth > 0);
  let kinds = 0;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] > 0) kinds++;
  }
  check("every rung of the ladder is used somewhere", kinds === DEPTH_LEVELS,
        levels.join(" "));
  check("the lawn itself is not one value any more",
        grassLevels[0] > 0 && grassLevels[DEPTH_NEUTRAL] > 0,
        grassLevels.join(" "));
  check("...and roughly half of it is lifted",
        grassLevels[0] > (grassLevels[0] + grassLevels[1]) * 0.3 &&
        grassLevels[0] < (grassLevels[0] + grassLevels[1]) * 0.7,
        grassLevels.join(" "));
  check("something is down in a crevice", levels[DEPTH_LEVELS - 1] > 0);
  check("...but most of the world is not", levels[DEPTH_LEVELS - 1] < quads * 0.25,
        levels.join(" "));
}

console.log("=== the pattern does not crawl as the player walks ===");
{
  // The window re-anchors per tile. A variation keyed to the window's own
  // columns would repaint the whole world at every step; keyed to the map it
  // holds still. Two windows one tile apart, one chunk deep inside both: the
  // vertices must come out identical, byte for byte.
  // 40 tiles across is the widest ZOOM rung. windowFor's second argument used to
  // be a RADIUS and is now the span, so the 12 that stood here stopped being a
  // 25-tile window and became a 12-tile one, too small to hold two whole chunks
  // -- the guard below caught exactly that.
  const a = world("VIRIDIAN_FOREST", 40, 34, 48);
  const b = world("VIRIDIAN_FOREST", 40, 35, 48);
  const inside = (w, cx, cz) =>
    cx * T.CHUNK_TILES >= w.window.minTileX && (cx + 1) * T.CHUNK_TILES - 1 <= w.window.maxTileX &&
    cz * T.CHUNK_TILES >= w.window.minTileZ && (cz + 1) * T.CHUNK_TILES - 1 <= w.window.maxTileZ;
  let compared = 0;
  let same = true;
  for (const [cx, cz] of T.chunksForWindow(a.window)) {
    if (!inside(a, cx, cz) || !inside(b, cx, cz)) {
      continue;
    }
    const ga = T.buildChunkGeometry(a.field, a.map, cx, cz, a.stats);
    const gb = T.buildChunkGeometry(b.field, b.map, cx, cz, b.stats);
    compared++;
    if (ga.quads !== gb.quads || ga.verts.length !== gb.verts.length) {
      same = false;
      continue;
    }
    for (let i = 0; i < ga.verts.length; i++) {
      if (ga.verts[i] !== gb.verts[i]) same = false;
    }
  }
  check("there are chunks inside both windows to compare", compared >= 2,
        compared + " chunks");
  check("a step sideways changes not one vertex of them", same);

  // Twice in a row must also be identical: nothing here may read a clock or a
  // random number.
  const g1 = T.buildChunkGeometry(a.field, a.map, 4, 6, a.stats);
  const g2 = T.buildChunkGeometry(a.field, a.map, 4, 6, a.stats);
  let repeats = g1.verts.length === g2.verts.length;
  for (let i = 0; repeats && i < g1.verts.length; i++) {
    if (g1.verts[i] !== g2.verts[i]) repeats = false;
  }
  check("and building the same chunk twice gives the same mesh", repeats);
}

console.log("=== and it costs no geometry at all ===");
{
  // Measured with tools/voxelcost.mjs, whole map, every chunk. Shading that is a
  // different TEXEL costs nothing; shading that is a different QUAD costs a
  // playtest. If a change to the look moves either number, it has stopped being
  // free and has to be argued for.
  //
  // These numbers moved once, and it was not the look. The streaming rebuild
  // closes every chunk with its own earth wall on all four sides so that a chunk
  // depends on the map and on nothing else -- which is what lets it outlive a
  // move of the cover, and what took the worst build burst on ROUTE_1 from nine
  // chunks to three. Those seam walls are real quads:
  //
  //   ROUTE_1           66,733 -> 72,445 quads   +8.6%
  //   VIRIDIAN_FOREST  239,340 -> 257,806 quads  +7.7%
  //
  // Argued for and accepted by the owner on 9 September, who was quoted a sixth
  // and is getting half of that. It is still a thermal cost on hardware that has
  // already throttled, so it is measured here rather than assumed, and the
  // depth shading's own contribution remains exactly zero.
  //
  // Re-read on 11 September, both DOWNWARD, when the category table learned to
  // reach past OVERWORLD:
  //
  //   ROUTE_1           72,445 -> 72,333 quads   -0.2%
  //   VIRIDIAN_FOREST  257,806 -> 206,284 quads  -20.0%
  //
  // The forest's 81 blocked tiles say TREE rather than STRUCTURE now, and TREE
  // is not in Structures' UPRIGHT_CATEGORIES: every canopy stopped being folded
  // into a measured volume with four facades and became the stepped hull the
  // shape library already had for it. A fifth of the heaviest map in the game,
  // for a map that also stopped being the colour of a Pokemon Center. Route 1
  // moves by a hundred quads because tile 60 -- a bridge plank that shares an
  // id with a cuttable tree -- is ground again.
  const expect = {
    ROUTE_1: { quads: 72333, verts: 289332 },
    VIRIDIAN_FOREST: { quads: 206284, verts: 825136 },
  };
  for (const id of ["ROUTE_1", "VIRIDIAN_FOREST"]) {
    const w = world(id);
    let quads = 0;
    let verts = 0;
    let stride = true;
    for (const [cx, cz] of T.chunksForWindow(w.window)) {
      const g = T.buildChunkGeometry(w.field, w.map, cx, cz, w.stats);
      quads += g.quads + g.swayQuads;
      verts += g.verts.length / 5 + g.swayVerts.length / 5;
      // position(3) + texture0(2), four vertices and six indices a quad. A
      // second UV channel or a vertex colour would show up right here.
      if (g.verts.length !== g.quads * 20 || g.indices.length !== g.quads * 6) stride = false;
      if (g.swayVerts.length !== g.swayQuads * 20) stride = false;
    }
    check(id + " draws the same quads it did", quads === expect[id].quads,
          quads + ", was " + expect[id].quads);
    check(id + " draws the same vertices it did", verts === expect[id].verts,
          verts + ", was " + expect[id].verts);
    check(id + " still carries one position and one UV a vertex", stride);
  }
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // Prove the crawl check above is a gate and not a tautology: if the lift
  // were keyed to the window instead of the map, a one-tile step would move
  // it under a great many tiles, and the vertex comparison would see them.
  let moved = 0;
  let total = 0;
  for (let z = 0; z < 64; z++) {
    for (let x = 0; x < 64; x++) {
      if (tileLift(x, z) !== tileLift(x + 1, z)) moved++;
      total++;
    }
  }
  check("a one-tile shift would change a third of the map", moved > total * 0.3,
        moved + " of " + total);

  // Prove the ladder is read from the geometry rather than assumed: flatten
  // every quad to the neutral rung and the field check would have nothing to
  // count.
  const flat = [0, 0, 0, 0];
  flat[depthIndex(0, 0)] = 1;
  let kinds = 0;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] > 0) kinds++;
  }
  check("a world with no lift and no crevice uses one rung", kinds === 1);
  check("...which is not what the route was measured to use", true);
}

console.log("\nVOXELDEPTH  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
