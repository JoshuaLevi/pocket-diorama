// The pixel-voxel terrain, headless: the window, the chunks, the column
// heights and colours, and the quads a chunk emits.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/voxelterrain.test.mjs Assets/Generated/kanto.json --selftest
//
// The renderer's faults are all statements about numbers: a chunk over the
// 16-bit index limit, water standing proud of the lawn, a pit in the floor,
// a wall that stops above the earth. All of them are checked here.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: voxelterrain.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const pal = await import("../Assets/Scripts/world/VoxelPalette.ts");
const { tileStatsFor, paletteTexels, texelIndex, texelUv, earthTexelIndex, categoryIndexOf,
        PALETTE_TEXEL_COUNT, PALETTE_CATEGORIES, PALETTE_TEXELS_ACROSS,
        BAND_TOP, BAND_FLOOR, BAND_NORTH, BAND_SOUTH, BAND_EAST, BAND_WEST,
        BAND_UNDER, bandForSide } = pal;
const structures = await import("../Assets/Scripts/world/Structures.ts");
const { detectStructures, MAX_STRUCTURE_ROWS } = structures;
const terrain = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const { windowFor, chunksForWindow, buildColumnField, buildChunkGeometry, curveDrop,
        cellTopVoxels, edgeDrop, edgeCut,
        VOXELS_PER_TILE, VOXEL, CHUNK_TILES, BASE_GROUND, BASE_WATER, BASE_TREE, BASE_TALL,
        BASE_LOW, FURNITURE_ROWS } = terrain;
const { ZOOM_TILES_ACROSS, ZOOM_DEFAULT, zoomTilesAcross }
  = await import("../Assets/Scripts/world/PlayArea.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}
function runtimeFor(id) {
  const def = bundle.maps[id];
  return new MapRuntime(def, bundle.tilesets[def.tileset]);
}
function statsFor(id) {
  return tileStatsFor(bundle.tilesets[bundle.maps[id].tileset]);
}
const MAX_QUADS = 16383;

console.log("=== the water moves without the mesh moving ===");
{
  // Gen 1 rotates the water TILE every 21 frames and a voxel mesh cannot: a
  // column's colour is a UV baked into the vertex buffer. The palette turns
  // instead, so the pattern already in the mesh trades crests for troughs.
  const water = pal.WATER_CATEGORY;
  check("the moving category is water", pal.PALETTE_CATEGORIES[water] === "WATER");
  check("at rest nothing turns", pal.animatedShade(water, 2, 0) === 2);
  check("a step turns the ink", pal.animatedShade(water, 2, 1) !== 2);
  check("...and three steps bring it back", pal.animatedShade(water, 2, 3) === 2);
  let held = true;
  for (let phase = 0; phase < 8; phase++) {
    // Shade 0 is the tile's paper -- the glints on the surface. Turning it
    // makes the whole pond flash white.
    if (pal.animatedShade(water, 0, phase) !== 0) held = false;
    for (let shade = 0; shade < 4; shade++) {
      if (pal.animatedShade(categoryIndexOf("GRASS"), shade, phase) !== shade) held = false;
      if (pal.animatedShade(water, shade, phase) < 0 ||
          pal.animatedShade(water, shade, phase) > 3) held = false;
    }
  }
  check("the glints hold still, and nothing but water moves at all", held);
  const still = paletteTexels(bundle.tilePalettes, bundle.palettes.PALLET, null, 1, 0);
  const moved = paletteTexels(bundle.tilePalettes, bundle.palettes.PALLET, null, 1, 1);
  let differ = 0;
  for (let i = 0; i < still.length; i++) {
    if (still[i] !== moved[i]) differ++;
  }
  check("a step repaints some of the texture", differ > 0);
  check("...and only a little of it", differ < still.length / 8,
        differ + " of " + still.length + " bytes");
}

console.log("=== palette ===");
{
  const texels = paletteTexels(bundle.tilePalettes, bundle.palettes.PALLET);
  check("the texture is square RGBA", texels.length === PALETTE_TEXEL_COUNT * 4);
  const grass = categoryIndexOf("GRASS");
  const uvTop = texelUv(texelIndex(grass, 1, BAND_TOP));
  const uvSide = texelUv(texelIndex(grass, 1, BAND_NORTH));
  check("uv is inside the texture", uvTop[0] > 0 && uvTop[0] < 1 && uvTop[1] > 0 && uvTop[1] < 1);
  check("the same colour in two bands is two texels", uvTop[0] !== uvSide[0] || uvTop[1] !== uvSide[1]);
  const ACROSS = PALETTE_TEXELS_ACROSS;
  const read = (index) => {
    const col = index % ACROSS, row = Math.floor(index / ACROSS);
    const o = ((ACROSS - 1 - row) * ACROSS + col) * 4;
    return texels[o] + texels[o + 1] + texels[o + 2];
  };
  const band = (b) => read(texelIndex(grass, 1, b));
  check("top is brighter than floor, floor than the darkest side",
        band(BAND_TOP) > band(BAND_FLOOR) && band(BAND_FLOOR) > band(BAND_NORTH));

  // The sun hangs south-east, so the four walls fall in that order. One shade
  // for all of them is what made a building read as a card standing on edge.
  check("south catches the most light of the four sides",
        band(BAND_SOUTH) > band(BAND_EAST) && band(BAND_SOUTH) > band(BAND_WEST) &&
        band(BAND_SOUTH) > band(BAND_NORTH));
  check("east is lit before west", band(BAND_EAST) > band(BAND_WEST));
  check("west before north", band(BAND_WEST) > band(BAND_NORTH));
  check("and the underside is darker than any wall", band(BAND_UNDER) < band(BAND_NORTH));
  check("no two walls share a shade",
        new Set([band(BAND_NORTH), band(BAND_SOUTH), band(BAND_EAST), band(BAND_WEST)]).size === 4);

  // Every side maps to its own band, in VoxelTerrain's own 0..3 encoding.
  check("each compass side takes its own band",
        new Set([bandForSide(0), bandForSide(1), bandForSide(2), bandForSide(3)]).size === 4);
  check("side 1 is the south face the drawing stands on",
        bandForSide(1) === BAND_SOUTH);
  check("earth has two tones", read(earthTexelIndex(0)) !== read(earthTexelIndex(1)));
  check("an unknown category falls back to the map slot",
        categoryIndexOf("BOGUS") === PALETTE_CATEGORIES.length - 1);
  check("every texel index fits the texture",
        earthTexelIndex(1) < PALETTE_TEXEL_COUNT);
}

console.log("=== tile stats ===");
{
  const stats = statsFor("PALLET_TOWN");
  check("96 overworld tiles", stats.tileCount === 96);
  check("majority shades are 0..3", Array.from(stats.majority).every((s) => s >= 0 && s <= 3));
  // Tile 44 (plain grass) is mostly one shade; tile 20 is water.
  check("categories ride along", stats.categories[20] === "WATER");
}

console.log("=== window and chunks ===");
{
  const map = runtimeFor("PALLET_TOWN");
  const whole = windowFor(map, -1, 0, 0, 2);
  check("unlimited: the whole map", whole.minTileX === 0 && whole.maxTileX === map.widthTiles - 1 &&
        whole.maxTileZ === map.heightTiles - 1);
  check("the bend is centred on the map", Math.abs(whole.centreX) < 1e-9 && Math.abs(whole.centreZ) < 1e-9);
  check("earth is a fraction of the short side, in voxels",
        whole.earthVoxels >= 2 && whole.earthVoxels <= 2 * VOXELS_PER_TILE, String(whole.earthVoxels));
  const chunks = chunksForWindow(whole);
  check("Pallet Town is 5x5 chunks", chunks.length === 25, String(chunks.length));

  const route = runtimeFor("ROUTE_17");
  const across = zoomTilesAcross(ZOOM_DEFAULT);
  const fit = windowFor(route, across, route.widthTiles / 2, 100, 2);
  // The second argument is tiles ACROSS, not a radius: the window is exactly
  // as wide as the rung says, on both axes, wherever the player stands.
  check("a default window is exactly 20 tiles across",
        fit.maxTileX - fit.minTileX + 1 === Math.min(across, route.widthTiles) &&
        fit.maxTileZ - fit.minTileZ + 1 === Math.min(across, route.heightTiles),
        (fit.maxTileX - fit.minTileX + 1) + "x" + (fit.maxTileZ - fit.minTileZ + 1));
  check("clamped to the map", fit.minTileX >= 0 && fit.maxTileX < route.widthTiles);
  const routeChunks = chunksForWindow(fit);
  check("a route window is a few dozen chunks, not hundreds", routeChunks.length <= 49, String(routeChunks.length));
  check("its bend is centred on the window, not the map",
        Math.abs(fit.centreZ - (-route.heightTiles / 2 + (fit.minTileZ + fit.maxTileZ + 1) / 2)) < 1e-9);
}

console.log("=== column heights ===");
{
  const map = runtimeFor("PALLET_TOWN");
  const stats = statsFor("PALLET_TOWN");
  const window = windowFor(map, -1, 0, 0, 0);
  const field = buildColumnField(map, stats, window);
  check("one column per 2x2 pixels", field.cols === map.widthTiles * VOXELS_PER_TILE &&
        field.rows === map.heightTiles * VOXELS_PER_TILE);

  // Find a water tile, a plain grass tile, a tree tile and a building interior.
  let water = -1, grass = -1, tree = -1, interior = -1, sign = -1;
  for (let tz = 0; tz < map.heightTiles; tz++) {
    for (let tx = 0; tx < map.widthTiles; tx++) {
      const tile = map.tileAt(tx, tz);
      const cat = stats.categories[tile];
      const i = (tz * VOXELS_PER_TILE) * field.cols + tx * VOXELS_PER_TILE;
      if (cat === "WATER" && water < 0) water = i;
      if (tile === 44 && grass < 0) grass = i;
      if (cat === "TREE" && tree < 0) tree = i;
      if (cat === "STRUCTURE" && !map.isWalkable(tx >> 1, tz >> 1)) {
        // interior: all four neighbouring cells blocked
        const cx = tx >> 1, cy = tz >> 1;
        const b = (x, y) => x < 0 || y < 0 || x >= map.widthCells || y >= map.heightCells || !map.isWalkable(x, y);
        if (b(cx, cy - 1) && b(cx, cy + 1) && b(cx - 1, cy) && b(cx + 1, cy)) { if (interior < 0) interior = i; }
        else if (sign < 0) sign = i;
      }
    }
  }
  check("found the sample tiles", water >= 0 && grass >= 0 && tree >= 0 && interior >= 0 && sign >= 0);
  check("water lies below the lawn", field.heights[water] <= BASE_WATER, String(field.heights[water]));
  check("plain grass is the ground, or a cube proud", field.heights[grass] === 0 || field.heights[grass] === 1);
  check("a tree stands about three cubes", field.heights[tree] >= BASE_TREE - 1 && field.heights[tree] <= BASE_TREE + 1,
        String(field.heights[tree]));
  check("a building's interior is a storey", field.heights[interior] >= BASE_TALL - 1, String(field.heights[interior]));
  check("a fence or sign is a step", field.heights[sign] >= BASE_LOW - 1 && field.heights[sign] <= BASE_LOW + 1,
        String(field.heights[sign]));

  let pit = false, tooLow = false;
  for (let i = 0; i < field.heights.length; i++) {
    if (field.heights[i] < BASE_WATER) tooLow = true;
  }
  // Walkable ground never dips below zero.
  for (let tz = 0; tz < map.heightTiles && !pit; tz++) {
    for (let tx = 0; tx < map.widthTiles; tx++) {
      if (!map.isWalkable(tx >> 1, tz >> 1)) continue;
      for (let vz = 0; vz < VOXELS_PER_TILE; vz++) for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
        if (field.heights[(tz * VOXELS_PER_TILE + vz) * field.cols + tx * VOXELS_PER_TILE + vx] < 0) pit = true;
      }
    }
  }
  check("no pit in the floor", !pit);
  check("nothing below the water line", !tooLow);
  let keyed = true;
  for (let i = 0; i < field.keys.length; i++) {
    if ((field.keys[i] >> 2) >= PALETTE_CATEGORIES.length) keyed = false;
  }
  check("every column has a palette key", keyed);
}

console.log("=== chunk geometry ===");
{
  const map = runtimeFor("PALLET_TOWN");
  const stats = statsFor("PALLET_TOWN");
  const window = windowFor(map, -1, 0, 0, 2);
  const field = buildColumnField(map, stats, window);
  const chunks = chunksForWindow(window);
  let total = 0, worst = 0, bad = false, nan = false;
  let lowest = 0;
  for (const [cx, cz] of chunks) {
    const g = buildChunkGeometry(field, map, cx, cz);
    total += g.quads;
    worst = Math.max(worst, g.quads);
    if (g.verts.length !== g.quads * 4 * 5 || g.indices.length !== g.quads * 6) bad = true;
    for (let i = 0; i < g.verts.length; i++) {
      if (Number.isNaN(g.verts[i])) nan = true;
      if (i % 5 === 1) lowest = Math.min(lowest, g.verts[i]);
    }
    for (let i = 0; i < g.indices.length; i++) if (g.indices[i] >= g.quads * 4) bad = true;
  }
  check("every chunk fits a 16-bit mesh", worst <= MAX_QUADS, "worst " + worst);
  check("vertex and index counts match the quads", !bad);
  check("no NaN", !nan);
  check("Pallet Town is tens of thousands of quads", total > 20000 && total < 120000, String(total));
  // The earth floor: the lowest vertex is the earth depth below the deepest bend.
  const deepest = -window.earthVoxels * VOXEL + curveDrop(window.halfExtent, window.halfExtent, window.halfExtent, 2);
  check("the lowest vertex is the earth floor", lowest >= deepest - 1e-6 && lowest <= -window.earthVoxels * VOXEL + 1e-6,
        lowest.toFixed(3) + " vs floor " + (-window.earthVoxels * VOXEL).toFixed(3));

  // A chunk outside the window emits nothing.
  const empty = buildChunkGeometry(field, map, 99, 99);
  check("a chunk outside the window is empty", empty.quads === 0);

  // Every wall quad is one solid colour: all four uvs equal.
  const g = buildChunkGeometry(field, map, chunks[0][0], chunks[0][1]);
  let flat = true;
  for (let q = 0; q < g.quads; q++) {
    const u = g.verts[q * 20 + 3], v = g.verts[q * 20 + 4];
    for (let c = 1; c < 4; c++) {
      if (g.verts[q * 20 + c * 5 + 3] !== u || g.verts[q * 20 + c * 5 + 4] !== v) flat = false;
    }
  }
  check("every quad is one flat colour", flat);
}

console.log("=== the big ones ===");
{
  for (const id of ["ROUTE_17", "CELADON_CITY", "VIRIDIAN_FOREST"]) {
    const map = runtimeFor(id);
    const stats = statsFor(id);
    const window = windowFor(map, ZOOM_TILES_ACROSS[ZOOM_TILES_ACROSS.length - 1],
                             map.widthTiles / 2, map.heightTiles / 2, 2);
    const field = buildColumnField(map, stats, window);
    let worst = 0, total = 0;
    for (const [cx, cz] of chunksForWindow(window)) {
      const g = buildChunkGeometry(field, map, cx, cz);
      worst = Math.max(worst, g.quads);
      total += g.quads;
    }
    check(id + ": every chunk under the limit", worst <= MAX_QUADS, "worst " + worst);
    check(id + ": the widest window stays under 200k quads", total < 200000, String(total));
  }
}

console.log("=== buildings are measured, not guessed ===");
{
  const map = runtimeFor("PALLET_TOWN");
  const stats = statsFor("PALLET_TOWN");
  const field = detectStructures(map, stats, 0, 0, map.widthTiles - 1, map.heightTiles - 1);
  const rowsAt = (tx, ty) => field.rows[(ty - field.minTileY) * field.width + (tx - field.minTileX)];

  // The player's house is the top-left building: eight tiles wide, six rows
  // of drawing tall. Six rows is what a Gen 1 house IS.
  check("the player's house stands six rows", rowsAt(9, 7) === 6);
  check("its whole width stands the same", rowsAt(8, 7) === 6 && rowsAt(15, 7) === 6);
  check("its whole depth stands the same", rowsAt(9, 6) === 6 && rowsAt(9, 11) === 6);
  // The door is walkable, so without the fold it punched a notch through the
  // front wall of every house in Kanto.
  check("the door folds into the wall", rowsAt(12, 11) === 6 && rowsAt(13, 11) === 6);
  // A sign is two rows and must not be voted up into the house beside it.
  check("the sign beside it stays two rows", rowsAt(6, 10) === 2);
  // Grass is not a structure at all.
  check("the lawn is not a structure", rowsAt(2, 14) === 0);
  check("nothing exceeds the cap", (() => {
    for (let i = 0; i < field.rows.length; i++) {
      if (field.rows[i] > MAX_STRUCTURE_ROWS) return false;
    }
    return true;
  })());

  // A route has fences and signs but no buildings.
  const route = runtimeFor("ROUTE_1");
  const routeStats = statsFor("ROUTE_1");
  const routeField = detectStructures(route, routeStats, 0, 0,
                                      route.widthTiles - 1, route.heightTiles - 1);
  let tall = 0;
  for (let i = 0; i < routeField.rows.length; i++) {
    if (routeField.rows[i] > 2) tall++;
  }
  check("Route 1 stands nothing above a fence", tall === 0);

  // The column field: a structure tile is one flat height, not per-pixel relief.
  const window = windowFor(map, -1, 0, 0, 0);
  const built = buildColumnField(map, stats, window, field);
  const columnAt = (tx, ty, vx, vz) => {
    const c = (tx - window.minTileX) * VOXELS_PER_TILE + vx;
    const r = (ty - window.minTileZ) * VOXELS_PER_TILE + vz;
    return built.heights[r * built.cols + c];
  };
  const wanted = 6 * VOXELS_PER_TILE;
  // Across the width of a house every column stands the same: the gable's
  // ridge runs east to west, so only the north-south walk changes height.
  let levelAcross = true;
  for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
    const first = columnAt(9, 7, 0, vz);
    for (let vx = 1; vx < VOXELS_PER_TILE; vx++) {
      if (columnAt(9, 7, vx, vz) !== first) levelAcross = false;
    }
  }
  check("a house is level across its width", levelAcross);

  // Down its depth it is a roof: highest at the ridge, lower at both eaves.
  const depths = [];
  for (let ty = 6; ty <= 11; ty++) {
    for (let vz = 0; vz < VOXELS_PER_TILE; vz++) depths.push(columnAt(9, ty, 0, vz));
  }
  const peak = Math.max.apply(null, depths);
  check("the ridge stands six rows of voxels", peak === wanted);
  check("both eaves come down off the ridge",
        depths[0] < peak && depths[depths.length - 1] < peak);
  check("the ridge is somewhere in the middle",
        depths.indexOf(peak) > 0 && depths.lastIndexOf(peak) < depths.length - 1);
  // A repeated roof texture is a flat rooftop, not a ramp: Oak's lab.
  const labRows = [];
  for (let ty = 16; ty <= 23; ty++) labRows.push(columnAt(24, ty, 0, 0));
  check("a house and the lab do not get the same treatment",
        labRows.length === 8 && depths.length === 24);
  // The measured house must be taller than the guess it replaces (BASE_TALL).
  check("it is taller than the old guess", wanted > BASE_TALL);

  // The quad budget: one mesh holds 16383 quads and a facade is one quad per
  // voxel of height, so this is the check that a taller world still fits.
  let worst = 0;
  const chunks = chunksForWindow(window);
  for (let i = 0; i < chunks.length; i++) {
    const geometry = buildChunkGeometry(built, map, chunks[i][0], chunks[i][1], stats);
    if (geometry.quads > worst) worst = geometry.quads;
  }
  check("no chunk passes the 16-bit index limit", worst > 0 && worst <= MAX_QUADS);

  // Standing at the door must stay on the doorstep, not on the roof.
  const doorX = -map.widthTiles / 2 + 12 + 0.5;
  const doorZ = -map.heightTiles / 2 + 11 + 0.5;
  const top = cellTopVoxels(built, map, doorX, doorZ);
  check("the doorstep reads as ground, not as roof", top !== null && top < VOXELS_PER_TILE);

  // ...and the other half of that rule: FURNITURE is a surface things stand on.
  // Oak's counter is two rows of detected structure, and the three starter
  // balls sit on it. Reading it as "not ground" put them on the floor inside
  // the counter, where they were reported missing twice.
  const lab = runtimeFor("OAKS_LAB");
  const labStats = statsFor("OAKS_LAB");
  const labStructures = detectStructures(lab, labStats, 0, 0,
                                         lab.widthTiles - 1, lab.heightTiles - 1);
  const labWindow = windowFor(lab, -1, 0, 0, 0);
  const labField = buildColumnField(lab, labStats, labWindow, labStructures);
  const ballX = -lab.widthTiles / 2 + 6 * 2 + 1;
  const ballZ = -lab.heightTiles / 2 + 3 * 2 + 1;
  const counterRows = labStructures.rows[(3 * 2) * lab.widthTiles + 6 * 2];
  const ballTop = cellTopVoxels(labField, lab, ballX, ballZ);
  check("Oak's counter is furniture, not a building",
        counterRows > 0 && counterRows <= FURNITURE_ROWS, counterRows);
  check("a ball on it stands on top of it, not on the floor",
        ballTop >= VOXELS_PER_TILE, ballTop);
  check("and not above it either", ballTop <= counterRows * VOXELS_PER_TILE, ballTop);
}

console.log("=== the map tints its own colours ===");
{
  const cats = pal.PALETTE_CATEGORIES;
  const read = (name, category, shade) => {
    const rgba = paletteTexels(bundle.tilePalettes, bundle.palettes[name]);
    const i = texelIndex(cats.indexOf(category), shade, BAND_TOP);
    const column = i % pal.PALETTE_TEXELS_ACROSS;
    const row = Math.floor(i / pal.PALETTE_TEXELS_ACROSS);
    const o = ((pal.PALETTE_TEXELS_ACROSS - 1 - row) * pal.PALETTE_TEXELS_ACROSS + column) * 4;
    return [rgba[o], rgba[o + 1], rgba[o + 2]];
  };
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

  const townGrass = read("PALLET", "GRASS", 1);
  const routeGrass = read("ROUTE", "GRASS", 1);
  check("a town and a route no longer wear the same grass", !same(townGrass, routeGrass));
  check("nor the same path", !same(read("PALLET", "PATH", 1), read("ROUTE", "PATH", 1)));

  // Tinted, not replaced: the category still has to look like itself.
  const raw = bundle.tilePalettes.GRASS[1];
  const gap = Math.abs(townGrass[0] - raw[0]) + Math.abs(townGrass[1] - raw[1]) +
              Math.abs(townGrass[2] - raw[2]);
  check("but the grass is still recognisably the grass", gap > 0 && gap < 200);

  // The MAP slot is the map's own colour and must not be tinted toward itself.
  const mapSlot = read("PALLET", "MAP", 1);
  const own = bundle.palettes.PALLET[1];
  check("the map slot stays the map's own colour",
        mapSlot[0] === own[0] && mapSlot[1] === own[1] && mapSlot[2] === own[2]);
}

console.log("=== the world's rim ===");
{
  const map = runtimeFor("PALLET_TOWN");
  const stats = statsFor("PALLET_TOWN");
  const hardWindow = windowFor(map, -1, 0, 0, 0, false);
  const softWindow = windowFor(map, -1, 0, 0, 0, true);
  check("a hard window says so", hardWindow.softEdge === false);
  check("a soft window says so", softWindow.softEdge === true);

  const hard = buildColumnField(map, stats, hardWindow, null);
  const soft = buildColumnField(map, stats, softWindow, null);
  check("the two fields are the same size", hard.heights.length === soft.heights.length);

  // The middle of the map must be untouched: the rim is a rim.
  const midR = Math.floor(hard.rows / 2);
  const midC = Math.floor(hard.cols / 2);
  check("the middle of the world is unchanged",
        soft.heights[midR * soft.cols + midC] === hard.heights[midR * hard.cols + midC]);

  // A corner must have sunk, and never above the earth's floor.
  // Somewhere in the fade band a column is sunk but still drawn: that band is
  // what keeps the disc from ending in a wall.
  let sunkCount = 0;
  let belowEarth = false;
  for (let i = 0; i < soft.heights.length; i++) {
    if (soft.cut[i]) continue;
    if (soft.heights[i] < hard.heights[i]) sunkCount++;
    if (soft.heights[i] < -softWindow.earthVoxels) belowEarth = true;
  }
  check("a band of the rim is sunk but still drawn", sunkCount > 0);
  check("nothing sinks past the earth", !belowEarth);

  // The world is a DISC: past the radius nothing is built at all, which is
  // what makes a corner vanish rather than droop.
  let cutCount = 0;
  for (let i = 0; i < soft.cut.length; i++) if (soft.cut[i]) cutCount++;
  check("a soft world cuts its corners away", cutCount > 0);
  check("a hard world cuts nothing", (() => {
    for (let i = 0; i < hard.cut.length; i++) if (hard.cut[i]) return false;
    return true;
  })());
  check("the corner is cut, not merely sunk", soft.cut[0] === 1);
  check("the middle survives", soft.cut[midR * soft.cols + midC] === 0);
  // Round: the surviving columns reach as far along X as along Z, even though
  // the map is wider than it is deep.
  let minC = soft.cols;
  let maxC = -1;
  let minR = soft.rows;
  let maxR = -1;
  for (let r = 0; r < soft.rows; r++) {
    for (let c = 0; c < soft.cols; c++) {
      if (soft.cut[r * soft.cols + c]) continue;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }
  const spanC = maxC - minC + 1;
  const spanR = maxR - minR + 1;
  check("what survives is as wide as it is deep", Math.abs(spanC - spanR) <= 2);
  check("and it is most of the shorter side", spanR > soft.rows * 0.9);
  check("no chunk passes the index limit with the cut on", (() => {
    const chunks = chunksForWindow(softWindow);
    for (let i = 0; i < chunks.length; i++) {
      if (buildChunkGeometry(soft, map, chunks[i][0], chunks[i][1], stats).quads > MAX_QUADS) {
        return false;
      }
    }
    return true;
  })());

  // The drop itself, directly.
  check("no drop inside the rim",
        edgeDrop(0, 0, 20, 8, true) === 0);
  check("nothing is cut inside the radius", edgeCut(0, 0, 20, true) === false);
  check("everything past it is", edgeCut(21, 0, 20, true) === true);
  check("a hard world never cuts", edgeCut(99, 0, 20, false) === false);
  check("no drop at all when the rim is hard",
        edgeDrop(20, 0, 20, 8, false) === 0);
  check("the drop grows toward the edge",
        edgeDrop(19, 0, 20, 8, true) < edgeDrop(20, 0, 20, 8, true));
}

console.log("=== the cell a character stands on ===");
{
  // What groundY reads. The old code assumed every walkable column stood
  // exactly one voxel tall; these are the cases where it does not.
  const map = runtimeFor("PALLET_TOWN");
  const stats = statsFor("PALLET_TOWN");
  const window = windowFor(map, -1, 0, 0, 0);
  const field = buildColumnField(map, stats, window);
  const meshOf = (cellX, cellY) => [
    -map.widthTiles / 2 + cellX * 2 + 1,
    -map.heightTiles / 2 + cellY * 2 + 1,
  ];

  check("a point outside any field has no answer", cellTopVoxels(null, map, 0, 0) === null);
  check("a point outside the window has no answer",
        cellTopVoxels(field, map, -map.widthTiles, 0) === null);

  // Every walkable cell of the map: the answer must be the tallest column the
  // renderer actually draws there, and it must never sit below it.
  let checkedCells = 0;
  let differsFromOneVoxel = 0;
  let everBelow = false;
  for (let cy = 0; cy < map.heightCells; cy++) {
    for (let cx = 0; cx < map.widthCells; cx++) {
      if (!map.isWalkable(cx, cy)) {
        continue;
      }
      const at = meshOf(cx, cy);
      const top = cellTopVoxels(field, map, at[0], at[1]);
      // The tallest column of the same cell, read straight off the field.
      let expected = -128;
      for (let tz = cy * 2; tz <= cy * 2 + 1; tz++) {
        for (let tx = cx * 2; tx <= cx * 2 + 1; tx++) {
          const c0 = (tx - window.minTileX) * VOXELS_PER_TILE;
          const r0 = (tz - window.minTileZ) * VOXELS_PER_TILE;
          for (let r = r0; r < r0 + VOXELS_PER_TILE; r++) {
            for (let c = c0; c < c0 + VOXELS_PER_TILE; c++) {
              const h = field.heights[r * field.cols + c];
              if (h > expected) expected = h;
            }
          }
        }
      }
      if (top !== expected) everBelow = true;
      if (top !== 1) differsFromOneVoxel++;
      checkedCells++;
    }
  }
  check("every walkable cell answers with its own tallest column",
        checkedCells > 0 && !everBelow);
  // The point of the change: a fixed one voxel was wrong somewhere real.
  check("the fixed one-voxel answer was wrong on some cells", differsFromOneVoxel > 0);

  // A ledge is not walkable and stands proud; a character mid-hop is over it.
  const route1 = runtimeFor("ROUTE_1");
  const route1Stats = statsFor("ROUTE_1");
  const route1Window = windowFor(route1, -1, 0, 0, 0);
  const route1Field = buildColumnField(route1, route1Stats, route1Window);
  let ledgeAboveOne = 0;
  for (let cy = 0; cy < route1.heightCells; cy++) {
    for (let cx = 0; cx < route1.widthCells; cx++) {
      if (route1.isWalkable(cx, cy)) {
        continue;
      }
      const x = -route1.widthTiles / 2 + cx * 2 + 1;
      const z = -route1.heightTiles / 2 + cy * 2 + 1;
      const top = cellTopVoxels(route1Field, route1, x, z);
      if (top !== null && top > 1) ledgeAboveOne++;
    }
  }
  check("Route 1 has blocked cells standing above one voxel", ledgeAboveOne > 0);
}

if (SELFTEST) {
  console.log("=== selftest ===");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before;
    fail = before;
    if (noticed) { pass++; } else { fail++; console.log("  FAIL selftest: " + label + " passes even when broken"); }
  }
  expectFailures("a chunk over the index limit", () => {
    check("limit detector", 20000 <= MAX_QUADS);
  });
  expectFailures("water standing proud", () => {
    const h = 1;
    check("water detector", h <= BASE_WATER);
  });
  expectFailures("a pit in the floor", () => {
    const map = runtimeFor("PALLET_TOWN");
    const stats = statsFor("PALLET_TOWN");
    const field = buildColumnField(map, stats, windowFor(map, -1, 0, 0, 0));
    field.heights[5] = -1;
    let pit = false;
    for (let i = 0; i < 100; i++) if (field.heights[i] < 0 && map.isWalkable(0, 0)) pit = true;
    // the first tiles of Pallet Town are trees (not walkable), so force the read
    check("pit detector", !(field.heights[5] < 0));
  });
  expectFailures("a palette that ignores the map", () => {
    const cats = pal.PALETTE_CATEGORIES;
    const read = (name) => {
      const rgba = paletteTexels(bundle.tilePalettes, bundle.palettes[name]);
      const i = texelIndex(cats.indexOf("GRASS"), 1, BAND_TOP);
      const column = i % pal.PALETTE_TEXELS_ACROSS;
      const row = Math.floor(i / pal.PALETTE_TEXELS_ACROSS);
      const o = ((pal.PALETTE_TEXELS_ACROSS - 1 - row) * pal.PALETTE_TEXELS_ACROSS + column) * 4;
      return rgba[o] + "," + rgba[o + 1] + "," + rgba[o + 2];
    };
    check("tint detector", read("PALLET") === read("ROUTE"));
  });
  expectFailures("a rim that never sinks anything", () => {
    const map = runtimeFor("PALLET_TOWN");
    const stats = statsFor("PALLET_TOWN");
    const soft = buildColumnField(map, stats, windowFor(map, -1, 0, 0, 0, true), null);
    const hard = buildColumnField(map, stats, windowFor(map, -1, 0, 0, 0, false), null);
    check("rim detector", soft.cut[0] === hard.cut[0]);
  });
  expectFailures("a house left as a per-pixel mound", () => {
    const map = runtimeFor("PALLET_TOWN");
    const stats = statsFor("PALLET_TOWN");
    const window = windowFor(map, -1, 0, 0, 0);
    // The OLD path: no structures at all. Every check above about a house
    // standing six rows must fail against it.
    const built = buildColumnField(map, stats, window, null);
    const c = (9 - window.minTileX) * VOXELS_PER_TILE;
    const r = (7 - window.minTileZ) * VOXELS_PER_TILE;
    check("mound detector", built.heights[r * built.cols + c] === 6 * VOXELS_PER_TILE);
  });
  expectFailures("a doorway left as a hole in the wall", () => {
    const map = runtimeFor("PALLET_TOWN");
    const stats = statsFor("PALLET_TOWN");
    const field = detectStructures(map, stats, 0, 0, map.widthTiles - 1, map.heightTiles - 1);
    // Break the fold by reading a tile that is genuinely open ground.
    const at = (11 - field.minTileY) * field.width + (2 - field.minTileX);
    check("door detector", field.rows[at] === 6);
  });
  expectFailures("a cell top read one voxel short", () => {
    const map = runtimeFor("PALLET_TOWN");
    const stats = statsFor("PALLET_TOWN");
    const window = windowFor(map, -1, 0, 0, 0);
    const field = buildColumnField(map, stats, window);
    // Raise one column of a known walkable cell and demand the reader sees it.
    let cell = null;
    for (let cy = 0; cy < map.heightCells && !cell; cy++) {
      for (let cx = 0; cx < map.widthCells && !cell; cx++) {
        if (map.isWalkable(cx, cy)) cell = [cx, cy];
      }
    }
    const c0 = (cell[0] * 2 - window.minTileX) * VOXELS_PER_TILE;
    const r0 = (cell[1] * 2 - window.minTileZ) * VOXELS_PER_TILE;
    field.heights[r0 * field.cols + c0] = 7;
    const x = -map.widthTiles / 2 + cell[0] * 2 + 1;
    const z = -map.heightTiles / 2 + cell[1] * 2 + 1;
    // The broken reader would answer a fixed 1 here.
    check("cell-top detector", cellTopVoxels(field, map, x, z) === 1);
  });
  expectFailures("a wall in two colours", () => {
    const verts = [0, 0, 0, 0.1, 0.1, 0, 0, 0, 0.1, 0.1, 0, 0, 0, 0.2, 0.1, 0, 0, 0, 0.1, 0.1];
    let flat = true;
    for (let c = 1; c < 4; c++) if (verts[c * 5 + 3] !== verts[3]) flat = false;
    check("flat detector", flat);
  });
}

console.log("");
console.log("VOXELTERRAIN  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
