// What a thing indoors IS, per tile -- and that the world draws it so.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/indoorkinds.test.mjs Assets/Generated/kanto.json
//
// Gen 1 draws every interior in four greys, so nothing in the cartridge says
// that a PC is a machine and a bed is linen; world/IndoorKinds.ts says it,
// tileset by tileset, read off the tile sheets. This holds the table to the
// sheets (every tile exists, none is two things), reads Red's room back
// through it, and then builds the column field to see that the PC comes out
// in the machine's greys, the bed in linen, the plant in green and the lab's
// floor in stone -- the colours the reference's rooms have.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("usage: indoorkinds.test.mjs <world-bundle.json>");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const K = await import("../Assets/Scripts/world/IndoorKinds.ts");
const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const P = await import("../Assets/Scripts/world/VoxelPalette.ts");
const { TILE_PALETTES } = await import("../Assets/Scripts/world/TilePalettes.ts");
const L = await import("../Assets/Scripts/world/Legibility.ts");
const { detectStructures, INDOOR_SHELL_ROWS, INDOOR_FURNITURE_ROWS } =
  await import("../Assets/Scripts/world/Structures.ts");
const { shapeProfileFor } = await import("../Assets/Scripts/world/TileShapes.ts");
const { buildColumnField, windowFor, VOXELS_PER_TILE } =
  await import("../Assets/Scripts/world/VoxelTerrain.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

function world(id) {
  const def = bundle.maps[id];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const stats = P.tileStatsFor(bundle.tilesets[def.tileset]);
  const profile = shapeProfileFor(map, stats);
  const structures = detectStructures(map, stats, 0, 0, map.widthTiles - 1, map.heightTiles - 1, profile);
  const window = windowFor(map, 0, 0, Math.max(map.widthTiles, map.heightTiles) + 8);
  const field = buildColumnField(map, stats, window, structures, profile, true);
  return { def, map, stats, profile, structures, window, field };
}

/** The category names the voxels of one CELL wear, counted. */
function cellCategories(w, cx, cy) {
  const cols = (w.window.maxTileX - w.window.minTileX + 1) * VOXELS_PER_TILE;
  const counts = {};
  for (let tz = cy * 2; tz < cy * 2 + 2; tz++) {
    for (let tx = cx * 2; tx < cx * 2 + 2; tx++) {
      for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
        for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
          const i = ((tz - w.window.minTileZ) * VOXELS_PER_TILE + vz) * cols
            + (tx - w.window.minTileX) * VOXELS_PER_TILE + vx;
          const name = P.PALETTE_CATEGORIES[w.field.keys[i] >> 2];
          counts[name] = (counts[name] || 0) + 1;
        }
      }
    }
  }
  return counts;
}
function mostly(counts, name) {
  let total = 0;
  for (const k in counts) total += counts[k];
  return (counts[name] || 0) > total / 2;
}
function rowsOfCell(w, cx, cy) {
  let rows = 0;
  for (let ty = cy * 2; ty < cy * 2 + 2; ty++) {
    for (let tx = cx * 2; tx < cx * 2 + 2; tx++) {
      rows = Math.max(rows, w.structures.rows[ty * w.structures.width + tx]);
    }
  }
  return rows;
}

console.log("=== the table holds to the sheets ===");
{
  let entries = 0;
  let bad = [];
  for (const tilesetId of Object.keys(K.INDOOR_KINDS)) {
    const tileset = bundle.tilesets[tilesetId];
    if (!tileset) { bad.push(tilesetId + ": no such tileset"); continue; }
    const count = (tileset.tileWidth / 8) * (tileset.tileHeight / 8);
    const seen = {};
    for (const kind of Object.keys(K.INDOOR_KINDS[tilesetId])) {
      if (!K.INDOOR_KIND_TABLE[kind]) bad.push(tilesetId + ": unknown kind " + kind);
      for (const tile of K.INDOOR_KINDS[tilesetId][kind]) {
        entries++;
        if (tile < 0 || tile >= count) bad.push(tilesetId + ": tile " + tile + " off the sheet");
        if (seen[tile]) bad.push(tilesetId + ": tile " + tile + " is both " + seen[tile] + " and " + kind);
        seen[tile] = kind;
      }
    }
  }
  // The second words, for below the band: the same rules, and only for a
  // tileset the first table already reads.
  for (const tilesetId of Object.keys(K.INDOOR_KINDS_BELOW)) {
    const tileset = bundle.tilesets[tilesetId];
    if (!tileset || !K.INDOOR_KINDS[tilesetId]) { bad.push(tilesetId + ": a second word for a tileset with no first"); continue; }
    const count = (tileset.tileWidth / 8) * (tileset.tileHeight / 8);
    const seen = {};
    for (const kind of Object.keys(K.INDOOR_KINDS_BELOW[tilesetId])) {
      if (!K.INDOOR_KIND_TABLE[kind]) bad.push(tilesetId + " below: unknown kind " + kind);
      for (const tile of K.INDOOR_KINDS_BELOW[tilesetId][kind]) {
        entries++;
        if (tile < 0 || tile >= count) bad.push(tilesetId + " below: tile " + tile + " off the sheet");
        if (seen[tile]) bad.push(tilesetId + " below: tile " + tile + " is both " + seen[tile] + " and " + kind);
        seen[tile] = kind;
      }
    }
  }
  check("every listed tileset exists, every tile is on its sheet, none is two things", bad.length === 0, bad.join("; "));
  check("the table says something", entries > 40, entries + " entries");
  console.log("  " + Object.keys(K.INDOOR_KINDS).length + " tilesets, " + entries + " tiles named");
  for (const kind of Object.keys(K.INDOOR_KIND_TABLE)) {
    const entry = K.INDOOR_KIND_TABLE[kind];
    check("kind " + kind + " names a palette category", P.PALETTE_CATEGORIES.indexOf(entry.category) >= 0, entry.category);
    check("kind " + kind + " stands no taller than the wall", entry.rows >= 0 && entry.rows <= INDOOR_SHELL_ROWS, String(entry.rows));
  }
}

console.log("=== the palette knows the new things ===");
{
  for (const name of ["MACHINE", "LINEN", "PLANT", "TILE", "CABINET"]) {
    check(name + " is a palette category", P.PALETTE_CATEGORIES.indexOf(name) >= 0);
    check(name + " has colours", Array.isArray(TILE_PALETTES[name]) && TILE_PALETTES[name].length === 4);
    check(name + " has a value band", L.VALUE_BAND_CATEGORIES.indexOf(name) >= 0 &&
          L.VALUE_BANDS[L.VALUE_BAND_CATEGORIES.indexOf(name)].length === 2);
  }
  check("MAP is still the last category", P.PALETTE_CATEGORIES[P.PALETTE_CATEGORIES.length - 1] === "MAP");
  check("the value bands stay parallel to the categories",
        L.VALUE_BAND_CATEGORIES.join(",") === P.PALETTE_CATEGORIES.join(","));
  const needed = 4 * P.PALETTE_CATEGORIES.length * 4 * P.BAND_COUNT + 2 * P.BAND_COUNT;
  check("the palette texture is big enough and not bigger than it has to be",
        P.PALETTE_TEXEL_COUNT >= needed && (P.PALETTE_TEXELS_ACROSS - 1) * (P.PALETTE_TEXELS_ACROSS - 1) < needed,
        P.PALETTE_TEXELS_ACROSS + "^2 for " + needed);
}

console.log("=== Red's room, read through the table ===");
{
  check("the PC is a machine", K.indoorKindOf("REDS_HOUSE_2", 64) === "MACHINE");
  check("the bed is linen", K.indoorKindOf("REDS_HOUSE_2", 45) === "LINEN");
  check("the plant is a plant", K.indoorKindOf("REDS_HOUSE_2", 68) === "PLANT");
  check("the mat's top row is floor", K.indoorKindOf("REDS_HOUSE_2", 4) === "FLOOR");
  check("the bookcase is a shelf", K.indoorKindOf("REDS_HOUSE_2", 36) === "SHELF");
  check("the plain wall is wall", K.indoorKindOf("REDS_HOUSE_2", 0) === "WALL");
  check("a tile the table does not name is nothing in particular", K.indoorKindOf("REDS_HOUSE_2", 1) === null);
  check("a tileset the table does not know is nothing in particular", K.indoorKindOf("NO_SUCH", 0) === null);
  check("a machine paints in MACHINE",
        K.indoorCategoryOf("REDS_HOUSE_2", 64) === "MACHINE" && K.indoorCategoryOf("REDS_HOUSE_2", 1) === null);

  const up = world("REDS_HOUSE_2F");
  check("the PC cell stands at wall height (it is in the band)", rowsOfCell(up, 0, 0) === 2, String(rowsOfCell(up, 0, 0)));
  check("the PC's desk below the band stands tall too: a machine", rowsOfCell(up, 0, 1) === 2, String(rowsOfCell(up, 0, 1)));
  check("the table against the wall is low", rowsOfCell(up, 1, 1) === INDOOR_FURNITURE_ROWS, String(rowsOfCell(up, 1, 1)));
  check("the bed is low", rowsOfCell(up, 0, 6) === INDOOR_FURNITURE_ROWS, String(rowsOfCell(up, 0, 6)));
  check("the plant is low", rowsOfCell(up, 6, 6) === INDOOR_FURNITURE_ROWS, String(rowsOfCell(up, 6, 6)));
  check("the console on the floor is low", rowsOfCell(up, 3, 4) === INDOOR_FURNITURE_ROWS, String(rowsOfCell(up, 3, 4)));
  check("the floor is nothing", rowsOfCell(up, 4, 4) === 0, String(rowsOfCell(up, 4, 4)));

  check("the PC is drawn in the machine's greys", mostly(cellCategories(up, 0, 0), "MACHINE"), JSON.stringify(cellCategories(up, 0, 0)));
  check("the bed is drawn in linen", mostly(cellCategories(up, 0, 6), "LINEN"), JSON.stringify(cellCategories(up, 0, 6)));
  check("the plant's leaves are green", (cellCategories(up, 6, 6).PLANT || 0) > 8, JSON.stringify(cellCategories(up, 6, 6)));
  check("the bookcase is a cabinet", mostly(cellCategories(up, 5, 0), "CABINET"), JSON.stringify(cellCategories(up, 5, 0)));
  check("the wall is wall", mostly(cellCategories(up, 3, 0), "WALL"), JSON.stringify(cellCategories(up, 3, 0)));
  check("the floor is floor", mostly(cellCategories(up, 4, 4), "FLOOR"), JSON.stringify(cellCategories(up, 4, 4)));

  const lab = world("OAKS_LAB");
  check("Oak's lower shelves stand tall", rowsOfCell(lab, 0, 6) === 2, String(rowsOfCell(lab, 0, 6)));
  check("Oak's table is low", rowsOfCell(lab, 6, 3) === INDOOR_FURNITURE_ROWS, String(rowsOfCell(lab, 6, 3)));
  check("Oak's machine is a machine", mostly(cellCategories(lab, 0, 1), "MACHINE"), JSON.stringify(cellCategories(lab, 0, 1)));
  check("Oak's floor is stone", mostly(cellCategories(lab, 4, 5), "TILE"), JSON.stringify(cellCategories(lab, 4, 5)));
  const bandShelf = cellCategories(lab, 7, 0);
  check("Oak's shelves in the band are a cabinet with a wooden top edge, never wall",
        (bandShelf.WALL || 0) === 0 && bandShelf.CABINET > 0 && bandShelf.FURNITURE > 0, JSON.stringify(bandShelf));

  const down = world("REDS_HOUSE_1F");
  check("the kitchen cabinets stand tall", rowsOfCell(down, 0, 1) === 2, String(rowsOfCell(down, 0, 1)));
  check("the dining table is low", rowsOfCell(down, 3, 4) === INDOOR_FURNITURE_ROWS, String(rowsOfCell(down, 3, 4)));
  check("the small TV is a low machine", rowsOfCell(down, 3, 1) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(down, 3, 1), "MACHINE"),
        rowsOfCell(down, 3, 1) + " " + JSON.stringify(cellCategories(down, 3, 1)));
}

console.log("=== a thing named flat stands no volume ===");
{
  // The S.S. Anne's sheet paints the dark between cabins with tile 1, which
  // is not walkable and so was WALL: 8,037 tiles of it stood as a wall
  // across the ship. Named VOID it lies flat; a cabin's bed still stands.
  const ship = world("SS_ANNE_1F_ROOMS");
  check("the dark between cabins is flat", rowsOfCell(ship, 5, 2) === 0, String(rowsOfCell(ship, 5, 2)));
  check("and a cabin's bed still stands", rowsOfCell(ship, 3, 4) === INDOOR_FURNITURE_ROWS &&
        mostly(cellCategories(ship, 3, 4), "LINEN"), rowsOfCell(ship, 3, 4) + " " + JSON.stringify(cellCategories(ship, 3, 4)));
  check("a cell the table is silent on stands at the height it is given", K.indoorCellRows(ship.map, 1, 2, 1) === 1);
}

console.log("=== indoors, the top of a thing is its own drawing ===");
{
  // The dining table's four cells each wear their OWN tile on top -- the
  // pokeball mat in the middle, the edge round it -- rather than the north
  // row repeated over the footprint, which made every table a plain slab.
  const down = world("REDS_HOUSE_1F");
  const cols = (down.window.maxTileX - down.window.minTileX + 1) * VOXELS_PER_TILE;
  const keyAt = (tx, tz, vx, vz) => down.field.keys[((tz - down.window.minTileZ) * VOXELS_PER_TILE + vz) * cols
    + (tx - down.window.minTileX) * VOXELS_PER_TILE + vx];
  // Tile (7,9) is 55, the pokeball's top-left; tile (7,8) is 39, plain table top.
  let differ = 0;
  for (let vz = 0; vz < VOXELS_PER_TILE; vz++) for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
    if (keyAt(7, 9, vx, vz) !== keyAt(7, 8, vx, vz)) differ++;
  }
  check("the table's mat row differs from its top row", differ > 0, differ + " voxels");
}

/** The lowest and the highest column of one CELL, in voxels. */
function cellHeights(w, cx, cy) {
  const cols = (w.window.maxTileX - w.window.minTileX + 1) * VOXELS_PER_TILE;
  let min = 127;
  let max = -127;
  for (let tz = cy * 2; tz < cy * 2 + 2; tz++) {
    for (let tx = cx * 2; tx < cx * 2 + 2; tx++) {
      for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
        for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
          const h = w.field.heights[((tz - w.window.minTileZ) * VOXELS_PER_TILE + vz) * cols
            + (tx - w.window.minTileX) * VOXELS_PER_TILE + vx];
          if (h < min) min = h;
          if (h > max) max = h;
        }
      }
    }
  }
  return { min, max };
}
/** How many voxels of a whole map wear one category. */
function mapCategory(w, name) {
  const index = P.PALETTE_CATEGORIES.indexOf(name);
  let n = 0;
  for (let i = 0; i < w.field.keys.length; i++) {
    if ((w.field.keys[i] >> 2) === index) n++;
  }
  return n;
}

console.log("=== a pool is water, and lies below the walkway ===");
{
  // Cerulean Gym's pool and the water round Lorelei's floor are tile 20 of
  // the gym's sheet, which is not walkable and so was WALL: it stood as low
  // wooden blocks. Named POOL it is water, level, one voxel below the floor.
  const pool = K.INDOOR_KIND_TABLE.POOL;
  check("a pool is a kind: water, no volume, sunk",
        !!pool && pool.category === "WATER" && pool.rows === 0 && pool.sunk === true, JSON.stringify(pool));
  check("the gym sheet's water is a pool", K.indoorKindOf("GYM", 20) === "POOL", String(K.indoorKindOf("GYM", 20)));
  check("the platform's edge over the water is pool too", K.indoorKindOf("GYM", 4) === "POOL", String(K.indoorKindOf("GYM", 4)));
  const gym = world("CERULEAN_GYM");
  check("open water stands no volume", rowsOfCell(gym, 4, 7) === 0, String(rowsOfCell(gym, 4, 7)));
  check("open water is drawn in water", mostly(cellCategories(gym, 4, 7), "WATER"), JSON.stringify(cellCategories(gym, 4, 7)));
  const water = cellHeights(gym, 4, 7);
  const walkway = cellHeights(gym, 4, 3);
  check("the pool is level", water.min === water.max, JSON.stringify(water));
  check("the pool lies below the walkway", water.max < walkway.min, JSON.stringify(water) + " vs " + JSON.stringify(walkway));
  const edge = cellCategories(gym, 2, 4);
  check("the cell under a platform's edge is all pool: no block, no wood",
        rowsOfCell(gym, 2, 4) === 0 && !(edge.FURNITURE > 0) && mostly(edge, "WATER") &&
        cellHeights(gym, 2, 4).max < walkway.min, rowsOfCell(gym, 2, 4) + " " + JSON.stringify(edge));
  check("the statues at the gym's door still stand tall", rowsOfCell(gym, 3, 10) === 2, String(rowsOfCell(gym, 3, 10)));
  const lorelei = world("LORELEIS_ROOM");
  check("the water round Lorelei's floor lies flat, in water",
        rowsOfCell(lorelei, 0, 3) === 0 && mostly(cellCategories(lorelei, 0, 3), "WATER") &&
        cellHeights(lorelei, 0, 3).max < cellHeights(lorelei, 4, 3).min,
        rowsOfCell(lorelei, 0, 3) + " " + JSON.stringify(cellCategories(lorelei, 0, 3)));
  check("a room with no pool has no water: the dojo", mapCategory(world("FIGHTING_DOJO"), "WATER") === 0);
  check("a room with no pool has no water: Pewter Gym", mapCategory(world("PEWTER_GYM"), "WATER") === 0);
  check("a tileset with no sunk kind has nothing sunk", K.indoorSunk("REDS_HOUSE_2", 96).every((v) => v === 0));
}

console.log("=== a mart's counter is one piece of wood ===");
{
  // Tile 40 of the centres' sheet is the wall's band along the top of every
  // mart and centre, and the SAME tile is the top of the clerk's counter.
  // One word per tile cannot say both, so a tile may have a second word for
  // below the band (INDOOR_KINDS_BELOW): there, in a mart, 40 is furniture.
  check("the band is the shell's two tile rows", K.INDOOR_BAND_TILES === INDOOR_SHELL_ROWS, String(K.INDOOR_BAND_TILES));
  check("in the band a mart's tile 40 is wall", K.indoorKindAt("MART", 40, 0) === "WALL" && K.indoorKindAt("MART", 40, 1) === "WALL");
  check("below the band it is furniture", K.indoorKindAt("MART", 40, 8) === "FURNITURE", String(K.indoorKindAt("MART", 40, 8)));
  check("a centre's tile 40 is wall wherever it is", K.indoorKindAt("POKECENTER", 40, 8) === "WALL");
  check("a tile with one word keeps it below the band", K.indoorKindAt("MART", 16, 8) === "FURNITURE" && K.indoorKindAt("REDS_HOUSE_2", 64, 8) === "MACHINE");
  check("a centre's pillars are still wall", K.indoorKindAt("POKECENTER", 16, 3) === "WALL" && K.indoorKindAt("POKECENTER", 41, 3) === "WALL");
  const mart = world("CERULEAN_MART");
  const west = cellCategories(mart, 0, 4);
  check("the counter's west end is low", rowsOfCell(mart, 0, 4) === INDOOR_FURNITURE_ROWS, String(rowsOfCell(mart, 0, 4)));
  check("and wood, with no wall in it", mostly(west, "FURNITURE") && !(west.WALL > 0), JSON.stringify(west));
  const corner = cellCategories(mart, 1, 4);
  check("the counter's corner is low wood too",
        rowsOfCell(mart, 1, 4) === INDOOR_FURNITURE_ROWS && mostly(corner, "FURNITURE") && !(corner.WALL > 0),
        rowsOfCell(mart, 1, 4) + " " + JSON.stringify(corner));
  check("the same tile in the band is still the wall",
        rowsOfCell(mart, 0, 0) === INDOOR_SHELL_ROWS && mostly(cellCategories(mart, 0, 0), "WALL"), JSON.stringify(cellCategories(mart, 0, 0)));
  const centre = world("VIRIDIAN_POKECENTER");
  check("a centre's pillar below the band stands as wall",
        rowsOfCell(centre, 0, 1) === INDOOR_SHELL_ROWS && mostly(cellCategories(centre, 0, 1), "WALL"),
        rowsOfCell(centre, 0, 1) + " " + JSON.stringify(cellCategories(centre, 0, 1)));
  // The Plateau's lobby is drawn with the mart's sheet and has a centre's
  // healing machine in it.
  check("the lobby's healing machine is a machine", K.indoorKindOf("MART", 72) === "MACHINE" && K.indoorKindOf("MART", 6) === "MACHINE");
}

console.log("=== the labs: Cinnabar's, the Warden's house, the meeting room ===");
{
  // The LAB sheet had no table, so everything that blocks stood at the
  // furniture height in wood: the black of Cinnabar Lab's unbuilt half was a
  // low wooden plateau and the fossil machines were a wooden shelf.
  check("the wall face is wall", K.indoorKindOf("LAB", 34) === "WALL" && K.indoorKindOf("LAB", 54) === "WALL");
  check("the fossil machine is a machine", K.indoorKindOf("LAB", 69) === "MACHINE" && K.indoorKindOf("LAB", 10) === "MACHINE");
  check("the cabinet is a shelf", K.indoorKindOf("LAB", 40) === "SHELF");
  check("the big table is furniture", K.indoorKindOf("LAB", 81) === "FURNITURE");
  const lab = world("CINNABAR_LAB");
  check("the unbuilt half of Cinnabar Lab stands as wall, not as a low wooden plateau",
        rowsOfCell(lab, 8, 2) === 2 && mostly(cellCategories(lab, 8, 2), "WALL"),
        rowsOfCell(lab, 8, 2) + " " + JSON.stringify(cellCategories(lab, 8, 2)));
  check("the corridor's wall face stands as wall", rowsOfCell(lab, 2, 2) === 2 && mostly(cellCategories(lab, 2, 2), "WALL"),
        rowsOfCell(lab, 2, 2) + " " + JSON.stringify(cellCategories(lab, 2, 2)));
  check("the lab's floor is stone", mostly(cellCategories(lab, 2, 5), "TILE"), JSON.stringify(cellCategories(lab, 2, 5)));
  const fossil = world("CINNABAR_LAB_FOSSIL_ROOM");
  check("the machines along the fossil room's wall stand tall, in grey",
        rowsOfCell(fossil, 0, 1) === 2 && mostly(cellCategories(fossil, 0, 1), "MACHINE"),
        rowsOfCell(fossil, 0, 1) + " " + JSON.stringify(cellCategories(fossil, 0, 1)));
  check("the desk's devices are low machines",
        rowsOfCell(fossil, 0, 4) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(fossil, 0, 4), "MACHINE"),
        rowsOfCell(fossil, 0, 4) + " " + JSON.stringify(cellCategories(fossil, 0, 4)));
  check("the table is low wood",
        rowsOfCell(fossil, 6, 4) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(fossil, 6, 4), "FURNITURE"),
        rowsOfCell(fossil, 6, 4) + " " + JSON.stringify(cellCategories(fossil, 6, 4)));
  const metronome = world("CINNABAR_LAB_METRONOME_ROOM");
  // Its top edge is the sheet's one grey top (tile 64/66), which is also a
  // table's: wood over the cabinet's gold, as on Oak's shelves, never wall.
  const cabinet = cellCategories(metronome, 6, 4);
  check("a cabinet in the room stands tall, as a cabinet with a wooden top edge",
        rowsOfCell(metronome, 6, 4) === 2 && cabinet.CABINET >= 32 && !(cabinet.WALL > 0),
        rowsOfCell(metronome, 6, 4) + " " + JSON.stringify(cellCategories(metronome, 6, 4)));
  const trade = world("CINNABAR_LAB_TRADE_ROOM");
  check("the plant in the corner is low and green",
        rowsOfCell(trade, 0, 1) === INDOOR_FURNITURE_ROWS && (cellCategories(trade, 0, 1).PLANT || 0) > 8,
        rowsOfCell(trade, 0, 1) + " " + JSON.stringify(cellCategories(trade, 0, 1)));
  const secret = world("SAFARI_ZONE_SECRET_HOUSE");
  check("the secret house's mainframes stand tall",
        rowsOfCell(secret, 0, 3) === 2 && mostly(cellCategories(secret, 0, 3), "MACHINE"),
        rowsOfCell(secret, 0, 3) + " " + JSON.stringify(cellCategories(secret, 0, 3)));
}

console.log("=== the facilities: the hideout, Silph, the mansion, the plant, two gyms ===");
{
  // Twenty-one maps on one sheet, and until now none of it named: 4,624
  // tiles of black and the walls drawn in it stood as a low wooden plateau.
  check("the black and the wall drawn in it are wall", K.indoorKindOf("FACILITY", 51) === "WALL" && K.indoorKindOf("FACILITY", 58) === "WALL");
  check("a quiz machine is a machine", K.indoorKindOf("FACILITY", 74) === "MACHINE");
  check("Silph's fountain is a pool", K.indoorKindOf("FACILITY", 20) === "POOL");
  const hideout = world("ROCKET_HIDEOUT_B1F");
  check("the hideout's black stands as wall",
        rowsOfCell(hideout, 2, 2) === 2 && mostly(cellCategories(hideout, 2, 2), "WALL"),
        rowsOfCell(hideout, 2, 2) + " " + JSON.stringify(cellCategories(hideout, 2, 2)));
  check("a steel table is low and grey",
        rowsOfCell(hideout, 10, 12) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(hideout, 10, 12), "MACHINE"),
        rowsOfCell(hideout, 10, 12) + " " + JSON.stringify(cellCategories(hideout, 10, 12)));
  check("a plant is low and green",
        rowsOfCell(hideout, 16, 8) === INDOOR_FURNITURE_ROWS && (cellCategories(hideout, 16, 8).PLANT || 0) > 8,
        rowsOfCell(hideout, 16, 8) + " " + JSON.stringify(cellCategories(hideout, 16, 8)));
  check("the floor is stone", mostly(cellCategories(hideout, 10, 6), "TILE"), JSON.stringify(cellCategories(hideout, 10, 6)));
  const cinnabar = world("CINNABAR_GYM");
  check("Cinnabar's quiz machines stand tall, in grey",
        rowsOfCell(cinnabar, 2, 1) === 2 && mostly(cellCategories(cinnabar, 2, 1), "MACHINE"),
        rowsOfCell(cinnabar, 2, 1) + " " + JSON.stringify(cellCategories(cinnabar, 2, 1)));
  check("the gym's statue stands tall, in rock",
        rowsOfCell(cinnabar, 17, 13) === 2 && (cellCategories(cinnabar, 17, 13).ROCK || 0) > 16,
        rowsOfCell(cinnabar, 17, 13) + " " + JSON.stringify(cellCategories(cinnabar, 17, 13)));
  const silph = world("SILPH_CO_1F");
  check("Silph's fountain is water below the floor",
        rowsOfCell(silph, 14, 6) === 0 && mostly(cellCategories(silph, 14, 6), "WATER") &&
        cellHeights(silph, 14, 6).max < cellHeights(silph, 14, 8).min,
        rowsOfCell(silph, 14, 6) + " " + JSON.stringify(cellCategories(silph, 14, 6)));
  check("and its rim is low", rowsOfCell(silph, 9, 6) === INDOOR_FURNITURE_ROWS, String(rowsOfCell(silph, 9, 6)));
  const mansion = world("POKEMON_MANSION_1F");
  check("the mansion's rubble is low rock",
        rowsOfCell(mansion, 1, 2) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(mansion, 1, 2), "ROCK"),
        rowsOfCell(mansion, 1, 2) + " " + JSON.stringify(cellCategories(mansion, 1, 2)));
  check("the mansion's bed is linen",
        rowsOfCell(mansion, 4, 6) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(mansion, 4, 6), "LINEN"),
        rowsOfCell(mansion, 4, 6) + " " + JSON.stringify(cellCategories(mansion, 4, 6)));
  const upstairs = world("POKEMON_MANSION_2F");
  check("the hole in the mansion's second floor lies flat", rowsOfCell(upstairs, 16, 17) === 0, String(rowsOfCell(upstairs, 16, 17)));
  check("and its railing is low", rowsOfCell(upstairs, 18, 16) === INDOOR_FURNITURE_ROWS, String(rowsOfCell(upstairs, 18, 16)));
}

console.log("=== Celadon's mansion ===");
{
  check("the mansion's corridor wall is wall", K.indoorKindOf("MANSION", 74) === "WALL" && K.indoorKindOf("MANSION", 16) === "WALL");
  check("its cabinets are shelves", K.indoorKindOf("MANSION", 34) === "SHELF");
  const chief = world("CELADON_CHIEF_HOUSE");
  check("the chief's table is low wood",
        rowsOfCell(chief, 3, 3) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(chief, 3, 3), "FURNITURE"),
        rowsOfCell(chief, 3, 3) + " " + JSON.stringify(cellCategories(chief, 3, 3)));
  const drawers = cellCategories(chief, 2, 1);
  check("a cabinet against the wall stands tall, as a cabinet",
        rowsOfCell(chief, 2, 1) === 2 && drawers.CABINET >= 32 && !(drawers.WALL > 0),
        rowsOfCell(chief, 2, 1) + " " + JSON.stringify(drawers));
  check("a plant is low and green",
        rowsOfCell(chief, 0, 7) === INDOOR_FURNITURE_ROWS && (cellCategories(chief, 0, 7).PLANT || 0) > 8,
        rowsOfCell(chief, 0, 7) + " " + JSON.stringify(cellCategories(chief, 0, 7)));
  const ground = world("CELADON_MANSION_1F");
  check("the wall down the mansion's corridor stands as wall",
        rowsOfCell(ground, 5, 4) === 2 && mostly(cellCategories(ground, 5, 4), "WALL"),
        rowsOfCell(ground, 5, 4) + " " + JSON.stringify(cellCategories(ground, 5, 4)));
  const second = world("CELADON_MANSION_2F");
  check("the bed upstairs is linen",
        rowsOfCell(second, 0, 8) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(second, 0, 8), "LINEN"),
        rowsOfCell(second, 0, 8) + " " + JSON.stringify(cellCategories(second, 0, 8)));
  check("the desk's devices are low machines",
        rowsOfCell(second, 0, 5) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(second, 0, 5), "MACHINE"),
        rowsOfCell(second, 0, 5) + " " + JSON.stringify(cellCategories(second, 0, 5)));
}

console.log("=== Vermilion's dock ===");
{
  // The dock is an interior as far as the cartridge's tables go, so its sea
  // was WALL: 773 tiles of low wooden blocks round the pier, and the ship a
  // wooden shelf among them.
  check("the dock's sea is a pool", K.indoorKindOf("SHIP_PORT", 20) === "POOL");
  check("the truck is a low machine", K.indoorKindOf("SHIP_PORT", 72) === "APPLIANCE");
  const dock = world("VERMILION_DOCK");
  const pier = cellHeights(dock, 5, 1);
  check("the sea is water, level, below the pier",
        rowsOfCell(dock, 5, 5) === 0 && mostly(cellCategories(dock, 5, 5), "WATER") &&
        cellHeights(dock, 5, 5).max < pier.min && cellHeights(dock, 5, 5).min === cellHeights(dock, 5, 5).max,
        rowsOfCell(dock, 5, 5) + " " + JSON.stringify(cellCategories(dock, 5, 5)) + " " + JSON.stringify(cellHeights(dock, 5, 5)));
  check("the quay's edge is sea too",
        rowsOfCell(dock, 3, 2) === 0 && mostly(cellCategories(dock, 3, 2), "WATER") && cellHeights(dock, 3, 2).max < pier.min,
        rowsOfCell(dock, 3, 2) + " " + JSON.stringify(cellCategories(dock, 3, 2)));
  // A pool in the room's top row is still a pool: the band is where a
  // room's wall stands, and water is not a wall.
  check("the sea beside the gangway, in the map's top row, is not a wall of water",
        rowsOfCell(dock, 12, 0) === 0 && cellHeights(dock, 12, 0).max < pier.min,
        rowsOfCell(dock, 12, 0) + " " + JSON.stringify(cellHeights(dock, 12, 0)));
  check("the ship stands tall, in the machine's greys",
        rowsOfCell(dock, 14, 4) === 2 && mostly(cellCategories(dock, 14, 4), "MACHINE"),
        rowsOfCell(dock, 14, 4) + " " + JSON.stringify(cellCategories(dock, 14, 4)));
  check("a crate on the pier is low wood",
        rowsOfCell(dock, 0, 1) === INDOOR_FURNITURE_ROWS && mostly(cellCategories(dock, 0, 1), "FURNITURE"),
        rowsOfCell(dock, 0, 1) + " " + JSON.stringify(cellCategories(dock, 0, 1)));
  check("a cell is sunk only when all of it is", K.indoorCellSunk(dock.map, 5, 5) === true && K.indoorCellSunk(dock.map, 14, 4) === false);
}

console.log("INDOORKINDS " + pass + " pass, " + fail + " fail" + (fail ? "  FAILED" : "  OK"));
process.exit(fail ? 1 : 0);
