// Indoors nothing is a house: no gable, no eave.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/indoorvolumes.test.mjs Assets/Generated/kanto.json --selftest
//
// The 11 September playtest: "in een huis ziet het eruit alsof de kasten mini
// huisjes zijn". It was not an impression. Outdoors the cartridge draws a
// building in ELEVATION -- a Gen 1 house is six rows of wall and roof seen from
// the side -- so folding those rows upright recovers the building, which is
// what Structures.ts was built to do. Indoors the SAME tileset draws furniture
// in PLAN: the four rows of Red's dining table are its footprint, not its
// height. The detector could not tell the difference, so it gave the table a
// four-row volume with a pitched roof and an eave hanging off every side.
//
// A gable and an overhang ARE the silhouette of a house. This suite measures
// that indoors there are now none of either, that outdoors there are exactly as
// many as before, and what the change costs in quads.
//
// HEIGHT is the second half, and it had to follow immediately: the gable was
// SUBTRACTIVE, so taking it away raised every indoor volume to its flat cap.
// Red's bookshelf went from 8..15 voxels to a flat 16, which is worse than
// what was reported. So indoors the run length is not used as a height at all.
// A flood-filled region that reaches the map's outer ring is the room's SHELL
// and stands at INDOOR_SHELL_ROWS; anything that does not is FURNITURE and
// stands at INDOOR_FURNITURE_ROWS. Both are measured off the room: a Gen 1
// interior draws its plain wall as exactly two tile rows, so the wall is the
// ceiling of the scale and nothing in the room may out-top it.
//
// --selftest puts the roofs back and checks the suite notices.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: indoorvolumes.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { tileStatsFor } = await import("../Assets/Scripts/world/VoxelPalette.ts");
const { detectStructures, INDOOR_SHELL_ROWS, INDOOR_FURNITURE_ROWS } =
  await import("../Assets/Scripts/world/Structures.ts");
const { shapeProfileFor, isOutdoors } = await import("../Assets/Scripts/world/TileShapes.ts");
const { indoorCellRows } = await import("../Assets/Scripts/world/IndoorKinds.ts");
const { buildColumnField, buildChunkGeometry, windowFor, VOXELS_PER_TILE } =
  await import("../Assets/Scripts/world/VoxelTerrain.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

/** Everything one map needs, built the way VoxelTerrain builds it. */
function world(id) {
  const def = bundle.maps[id];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const stats = tileStatsFor(bundle.tilesets[def.tileset]);
  const profile = shapeProfileFor(map, stats);
  const structures = detectStructures(map, stats, 0, 0,
                                      map.widthTiles - 1, map.heightTiles - 1, profile);
  return { def, map, stats, profile, structures };
}

/** Tiles of this map whose volume is gabled. */
function pitchedTiles(w) {
  let n = 0;
  for (let i = 0; i < w.structures.roofRows.length; i++) {
    if (w.structures.roofRows[i] > 0) n++;
  }
  return n;
}

console.log("=== the flag follows the cartridge, not a list of ours ===");
{
  // isOutdoors reads grassTile, which the ROM fills for exactly OVERWORLD,
  // FOREST and PLATEAU. So "is this map roofed" needs no table of our own and
  // cannot drift away from the shape library, which asks the same question.
  let indoor = 0;
  let outdoor = 0;
  let disagree = 0;
  for (const id of Object.keys(bundle.maps)) {
    const w = world(id);
    const out = isOutdoors(w.map);
    if (out) outdoor++; else indoor++;
    if (w.structures.roofed !== out) disagree++;
  }
  check("every map agrees with isOutdoors", disagree === 0, disagree + " disagree");
  check("Kanto is mostly indoors", indoor > outdoor, indoor + " in, " + outdoor + " out");
  console.log("  " + outdoor + " outdoor maps, " + indoor + " indoor");
}

console.log("\n=== no gable stands indoors, and every one outdoors survives ===");
{
  let indoorPitched = 0;
  let outdoorPitched = 0;
  let indoorRoofedMaps = 0;
  let outdoorRoofedMaps = 0;
  for (const id of Object.keys(bundle.maps)) {
    const w = world(id);
    const n = pitchedTiles(w);
    if (isOutdoors(w.map)) {
      outdoorPitched += n;
      if (n > 0) outdoorRoofedMaps++;
    } else {
      indoorPitched += n;
      if (n > 0) indoorRoofedMaps++;
    }
  }
  // Before this change the same walk counted 19,130 pitched tiles across 152 of
  // the 180 interior maps. Both are now zero, and that is the whole claim.
  check("no interior tile is gabled", indoorPitched === 0, indoorPitched + " tiles");
  check("no interior map is gabled", indoorRoofedMaps === 0, indoorRoofedMaps + " maps");
  check("Kanto's buildings still are", outdoorPitched > 1000, outdoorPitched + " tiles");
  // Twenty since 29 September: the mountain routes used to count, because
  // their cliffs (OVERWORLD tile 17) were STRUCTURE and got gables; they are
  // rock now, and the maps left are the ones with houses on them.
  check("on most outdoor maps", outdoorRoofedMaps >= 18, outdoorRoofedMaps + " maps");
  console.log("  indoor " + indoorPitched + " pitched tiles, outdoor " + outdoorPitched);
}

console.log("\n=== the furniture that started this ===");
{
  // Red's dining table: tiles 6-9 x 8-11, a 4x4 block in the middle of the
  // room, which the detector read as a four-row run and gabled.
  const w = world("REDS_HOUSE_1F");
  check("Red's house is indoors", w.structures.roofed === false);
  let tableRows = 0;
  let tablePitch = 0;
  for (let ty = 8; ty <= 11; ty++) {
    for (let tx = 6; tx <= 9; tx++) {
      const at = ty * w.structures.width + tx;
      tableRows = Math.max(tableRows, w.structures.rows[at]);
      tablePitch = Math.max(tablePitch, w.structures.roofRows[at]);
    }
  }
  check("the table is still a volume", tableRows > 0, "rows=" + tableRows);
  check("the table has no roof", tablePitch === 0, "pitch=" + tablePitch);
  console.log("  the table stands " + tableRows + " rows, pitch " + tablePitch);

  // Oak's lab, a Mart and a Pokecenter: the three interior shapes that are not
  // a house, checked so the claim is not one room wide.
  for (const id of ["OAKS_LAB", "VIRIDIAN_MART", "VIRIDIAN_POKECENTER"]) {
    const m = world(id);
    check(id + " has no gable", pitchedTiles(m) === 0, "" + pitchedTiles(m));
  }
}

console.log("\n=== nothing indoors out-tops the room it stands in ===");
{
  // Before this rule the interior histogram was {2: 13678, 3: 35, 4: 2331,
  // 5: 21, 6: 4283} tiles -- 6,635 of them standing at 300 to 450 cm in rooms
  // whose own walls are 150. Two values are all that is left.
  const hist = {};
  for (const id of Object.keys(bundle.maps)) {
    const w = world(id);
    if (isOutdoors(w.map)) continue;
    for (let i = 0; i < w.structures.rows.length; i++) {
      const r = w.structures.rows[i];
      if (r > 0) hist[r] = (hist[r] || 0) + 1;
    }
  }
  const heights = Object.keys(hist).map(Number).sort((a, b) => a - b);
  check("indoors there are exactly two heights", heights.length === 2,
        JSON.stringify(hist));
  check("and they are the shell and the furniture",
        heights[0] === INDOOR_FURNITURE_ROWS && heights[1] === INDOOR_SHELL_ROWS,
        heights.join(","));
  check("nothing indoors stands taller than the wall",
        heights[heights.length - 1] <= INDOOR_SHELL_ROWS, heights.join(","));
  // Since 29 September the shell is the wall band -- the map's top two tile
  // rows -- and everything built below it is furniture, so a room is mostly
  // things standing on a floor with a wall behind them.
  check("both heights are in use",
        hist[INDOOR_FURNITURE_ROWS] > 0 && hist[INDOOR_SHELL_ROWS] > 0,
        hist[INDOOR_FURNITURE_ROWS] + " vs " + hist[INDOOR_SHELL_ROWS]);
  // Below the band a built tile stands at wall height only when IndoorKinds
  // says its cell does (a bookcase, a PC, a machine); the old ring rule,
  // which stood a bed against the back wall at wall height, is gone.
  let builtShellBelowBand = 0;
  let namedTall = 0;
  for (const id of Object.keys(bundle.maps)) {
    const w = world(id);
    if (isOutdoors(w.map)) continue;
    for (let ty = INDOOR_SHELL_ROWS; ty < w.structures.height; ty++) {
      for (let tx = 0; tx < w.structures.width; tx++) {
        const at = ty * w.structures.width + tx;
        if (w.structures.rows[at] === INDOOR_SHELL_ROWS && w.structures.built[at]) {
          if (indoorCellRows(w.map, tx >> 1, ty >> 1, INDOOR_FURNITURE_ROWS) === INDOOR_SHELL_ROWS) namedTall++;
          else builtShellBelowBand++;
        }
      }
    }
  }
  check("no built shell stands below the wall band unless the table names it tall", builtShellBelowBand === 0, builtShellBelowBand + " tiles");
  check("and the table does name some things tall", namedTall > 0, namedTall + " tiles");
  console.log("  indoor heights " + JSON.stringify(hist) + " tiles");

  // The table that started it, against the character who has to see past it.
  const w = world("REDS_HOUSE_1F");
  let table = 0;
  for (let ty = 8; ty <= 11; ty++) {
    for (let tx = 6; tx <= 9; tx++) {
      table = Math.max(table, w.structures.rows[ty * w.structures.width + tx]);
    }
  }
  check("Red's table is furniture, not wall", table === INDOOR_FURNITURE_ROWS,
        table + " rows");
  // Upstairs the PC and the television stand against the back wall (tiles
  // 0-5 x 2-3): machines, as tall as the wall band above them, which is the
  // shell. The bed is in the bottom-left corner (tiles 0-1 x 12-15), low.
  const up = world("REDS_HOUSE_2F");
  let machines = 0;
  let bed = 0;
  let band = 0;
  for (let ty = 2; ty <= 3; ty++) for (let tx = 0; tx <= 5; tx++) machines = Math.max(machines, up.structures.rows[ty * up.structures.width + tx]);
  for (let ty = 12; ty <= 15; ty++) for (let tx = 0; tx <= 1; tx++) bed = Math.max(bed, up.structures.rows[ty * up.structures.width + tx]);
  for (let ty = 0; ty <= 1; ty++) for (let tx = 0; tx <= 15; tx++) band = Math.max(band, up.structures.rows[ty * up.structures.width + tx]);
  check("Red's PC and TV stand at the wall's height", machines === INDOOR_SHELL_ROWS, machines + " rows");
  check("Red's bed is furniture", bed === INDOOR_FURNITURE_ROWS, bed + " rows");
  check("and the wall behind them is the shell", band === INDOOR_SHELL_ROWS, band + " rows");
  // CHARACTER_TILES is 2.2 tiles = 8.8 voxels. A table you can see over is the
  // whole point of the number.
  const voxels = table * 4;
  check("and it is lower than the player", voxels < 8.8, voxels + " voxels");
  console.log("  Red's table " + voxels + " voxels, the player 8.8");
}

console.log("\n=== Pallet Town is untouched ===");
{
  // The outdoor path is the one thing this change must not move. Structures.ts
  // claims Pallet Town's houses are six rows; if that stopped being true the
  // fold would be reading something else.
  const w = world("PALLET_TOWN");
  check("Pallet Town is roofed", w.structures.roofed === true);
  let six = 0;
  for (let i = 0; i < w.structures.rows.length; i++) {
    if (w.structures.rows[i] === 6) six++;
  }
  check("its houses are six rows", six > 0, "" + six);
  check("and they are gabled", pitchedTiles(w) > 0, "" + pitchedTiles(w));
}

console.log("\n=== what the eaves cost ===");
{
  // Measured by building the same map twice: once as it ships, once with the
  // flag forced back on. The difference is exactly the eave quads, because
  // nothing else in the builder reads it.
  function quadsOf(id, roofed) {
    const w = world(id);
    w.structures.roofed = roofed;
    // Re-derive roofRows under the forced flag so the control is the OLD
    // builder and not this one wearing a different hat.
    const def = bundle.maps[id];
    const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
    const stats = tileStatsFor(bundle.tilesets[def.tileset]);
    const profile = shapeProfileFor(map, stats);
    const structures = detectStructures(map, stats, 0, 0,
                                        map.widthTiles - 1, map.heightTiles - 1, profile);
    structures.roofed = roofed;
    const window = windowFor(map, -1, Math.floor(map.widthTiles / 2),
                             Math.floor(map.heightTiles / 2), 0, false);
    const field = buildColumnField(map, stats, window, structures, profile, true);
    const chunkTiles = Math.ceil(map.widthTiles / VOXELS_PER_TILE) + 1;
    let quads = 0;
    const across = Math.ceil(map.widthTiles / chunkTiles);
    const down = Math.ceil(map.heightTiles / chunkTiles);
    for (let cz = 0; cz <= down; cz++) {
      for (let cx = 0; cx <= across; cx++) {
        quads += buildChunkGeometry(field, map, cx, cz, stats, chunkTiles).quads;
      }
    }
    return quads;
  }
  for (const id of ["REDS_HOUSE_1F", "OAKS_LAB", "VIRIDIAN_MART"]) {
    const now = quadsOf(id, false);
    const before = quadsOf(id, true);
    check(id + " got cheaper", now < before, now + " vs " + before);
    const cut = before === 0 ? 0 : Math.round(1000 * (before - now) / before) / 10;
    console.log("  " + id.padEnd(22) + now + " quads, was " + before + "  (-" + cut + "%)");
  }
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // Two things have to be true for the claims above to mean anything: the
  // gable and the tall run must still be REACHABLE, or the suite is passing
  // because nothing ever happens.

  // 1. The outdoor path is alive. If this ever went quiet, "no gable indoors"
  //    would be true of a builder that had stopped gabling at all.
  const pallet = world("PALLET_TOWN");
  let tallOutdoor = 0;
  for (let i = 0; i < pallet.structures.rows.length; i++) {
    if (pallet.structures.rows[i] >= 4) tallOutdoor++;
  }
  check("outdoors still measures runs of four rows and more", tallOutdoor > 0,
        tallOutdoor + " tiles");
  check("and still gables them", pitchedTiles(pallet) > 0, "" + pitchedTiles(pallet));

  // 2. Red's house WOULD have measured tall runs, so the indoor rule is what
  //    takes them away rather than the drawing not having them. This walks the
  //    map's own upright columns the way runOf does, which is the measurement
  //    the rule overrides.
  const w = world("REDS_HOUSE_1F");
  let longRuns = 0;
  let longest = 0;
  for (let tx = 0; tx < w.map.widthTiles; tx++) {
    let run = 0;
    for (let ty = 0; ty < w.map.heightTiles; ty++) {
      const blocked = !w.map.isWalkable(tx >> 1, ty >> 1);
      run = blocked ? run + 1 : 0;
      if (run > longest) longest = run;
      if (run === 4) longRuns++;
    }
  }
  check("Red's house is drawn with runs of four rows", longRuns > 0,
        longRuns + " columns reach four");
  check("and the rule caps them anyway", longest > INDOOR_SHELL_ROWS,
        "longest drawn run " + longest + ", cap " + INDOOR_SHELL_ROWS);
  console.log("  Red's house draws runs up to " + longest +
              " rows; the rule stands them at " + INDOOR_SHELL_ROWS + " and " +
              INDOOR_FURNITURE_ROWS);
}

console.log("\nINDOORVOLUMES  " + pass + " PASS  " + fail + " FAIL  " +
            (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
