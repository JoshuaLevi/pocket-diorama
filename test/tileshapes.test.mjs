// The shape library, against the real cartridge.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/tileshapes.test.mjs Assets/Generated/kanto.json --selftest
//
// Every claim world/TileShapes.ts makes in its header is a line here, because
// the rule it implements is a MEASUREMENT and a measurement that nobody checks
// is a guess with a comment on it. The numbers below -- eight fence cells in
// Pallet Town, forty-two in Viridian City, none at all in Red's bedroom -- are
// what the rule produced when it was chosen, so a threshold moved by hand has
// to move them too and cannot be moved by accident.
//
// --selftest breaks the rule on purpose and checks the suite notices.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: tileshapes.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { tileStatsFor, tileShade, categoryIndexOf, PALETTE_CATEGORIES } =
  await import("../Assets/Scripts/world/VoxelPalette.ts");
const { detectStructures } = await import("../Assets/Scripts/world/Structures.ts");
const S = await import("../Assets/Scripts/world/TileShapes.ts");
const T = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const pal = await import("../Assets/Scripts/world/VoxelPalette.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "TILESHAPES", "Red's Route 1 geometry");
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

/** Everything one map needs, built the way VoxelTerrain builds it. */
function world(id, { shapes = true } = {}) {
  const def = bundle.maps[id];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const stats = tileStatsFor(bundle.tilesets[def.tileset]);
  const profile = S.shapeProfileFor(map, stats);
  const structures = detectStructures(map, stats, 0, 0, map.widthTiles - 1, map.heightTiles - 1,
                                      shapes ? profile : null);
  const window = T.windowFor(map, -1, map.widthTiles / 2, map.heightTiles / 2, 0, false);
  const field = T.buildColumnField(map, stats, window, structures, profile, shapes);
  return { map, stats, profile, structures, window, field };
}

/** The shape class of every cell of a map, counted. */
function shapeCounts(w) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let cy = 0; cy < w.map.heightCells; cy++) {
    for (let cx = 0; cx < w.map.widthCells; cx++) {
      const rows = w.structures.rows[(cy * 2 + 1) * w.structures.width + cx * 2] || 0;
      counts[S.shapeForCell(w.map, w.stats, w.profile, cx, cy, rows)]++;
    }
  }
  return counts;
}

console.log("=== what a tileset calls air ===");
{
  // Not always white. Reading the Ship's sheet as if white were air would
  // stand a whole deck on end, which is the mistake this measurement avoids.
  const seen = {};
  for (const id of Object.keys(bundle.maps)) {
    const def = bundle.maps[id];
    if (seen[def.tileset] !== undefined) continue;
    const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
    const stats = tileStatsFor(bundle.tilesets[def.tileset]);
    seen[def.tileset] = S.shapeProfileFor(map, stats).background;
  }
  check("the overworld's air is white", seen.OVERWORLD === 0, "got " + seen.OVERWORLD);
  check("a Mart is drawn on shade 1", seen.MART === 1, "got " + seen.MART);
  check("the Ship is drawn on shade 2", seen.SHIP === 2, "got " + seen.SHIP);
  // Nine of the twenty-four are not white, which is the number that makes the
  // measurement worth doing: assuming white would have been wrong on more than
  // a third of Kanto, including every Mart, every Pokemon Center and the Ship.
  let odd = 0;
  for (const key in seen) {
    if (seen[key] !== 0) odd++;
  }
  check("nine tilesets are drawn on something other than white", odd === 9,
        odd + " of " + Object.keys(seen).length);
}

console.log("=== the rule picks out props, and only props ===");
{
  const pallet = world("PALLET_TOWN");
  const counts = shapeCounts(pallet);
  // Eight fence cells and four sign cells: the two rows of posts in front of
  // Red's house and the rival's, and the four town signs.
  check("Pallet Town stands twelve things up", counts[S.SHAPE_STANDING] === 12,
        "got " + counts[S.SHAPE_STANDING]);
  check("...and none of its buildings", counts[S.SHAPE_MASS] > 0);
  check("its treeline is hulls", counts[S.SHAPE_CANOPY] > 60,
        "got " + counts[S.SHAPE_CANOPY]);

  const viridian = world("VIRIDIAN_CITY");
  check("Viridian City's fences are all found",
        shapeCounts(viridian)[S.SHAPE_STANDING] >= 40,
        "got " + shapeCounts(viridian)[S.SHAPE_STANDING]);

  // The case the threshold was chosen to fail. A bedroom wall stood up as a
  // thin plate is a hole you can see the room's own outside through.
  for (const id of ["REDS_HOUSE_2F", "REDS_HOUSE_1F", "OAKS_LAB", "VIRIDIAN_MART"]) {
    if (!bundle.maps[id]) continue;
    const indoors = world(id);
    check(id + " stands nothing up that holds a room in",
          shapeCounts(indoors)[S.SHAPE_STANDING] <= 4,
          "got " + shapeCounts(indoors)[S.SHAPE_STANDING]);
  }
}

console.log("=== a fence is not a building ===");
{
  const w = world("PALLET_TOWN");
  // Find the Pallet Town fence: a run of cells whose art is tile 14 over 85.
  let fence = null;
  for (let cy = 0; cy < w.map.heightCells && !fence; cy++) {
    for (let cx = 0; cx < w.map.widthCells; cx++) {
      if (w.map.tileAt(cx * 2, cy * 2) === 14 && w.map.tileAt(cx * 2, cy * 2 + 1) === 85) {
        fence = [cx, cy];
        break;
      }
    }
  }
  check("Pallet Town has its fence", fence !== null);
  if (fence) {
    const [cx, cy] = fence;
    const rows = w.structures.rows[(cy * 2 + 1) * w.structures.width + cx * 2] || 0;
    check("the detector leaves it alone", rows === 0, "rows " + rows);

    // ...and without the profile it does NOT: the fence is exactly two tile
    // rows, so it passes the run test and folds into a wall. That is the
    // failure this whole hand-off exists to prevent.
    const plain = world("PALLET_TOWN", { shapes: false });
    const plainRows = plain.structures.rows[(cy * 2 + 1) * plain.structures.width + cx * 2];
    check("...where the old detector made it a two-row volume", plainRows === 2,
          "rows " + plainRows);

    check("it is a prop", S.shapeForCell(w.map, w.stats, w.profile, cx, cy, 0) === S.SHAPE_STANDING);
    // A 14-pixel post in a 16-pixel cell, at two pixels to a voxel.
    const profile = S.standingProfile(w.map, w.stats, w.profile, cx, cy);
    let tallest = 0;
    for (let i = 0; i < profile.length; i++) tallest = Math.max(tallest, profile[i]);
    check("the post stands seven voxels", tallest === 7, "got " + tallest);
    check("the plate lies along the fence", S.propAxis(w.map, w.stats, w.profile, cx, cy) === S.AXIS_EW);
    // It stands on grass, not on building cream: the ground comes from a
    // walkable neighbour rather than from the fence's own tile.
    const ground = S.propGroundTile(w.map, cx, cy);
    check("and on ground borrowed from a walkable neighbour",
          w.map.tileset.walkable.indexOf(ground) >= 0, "tile " + ground);
  }
}

console.log("=== a cave has no air to stand things up in ===");
{
  // "Mostly background" reads as "drawn in front of the ground" because
  // outdoor air is the grass showing through. A cave has none: its floor is a
  // busy dither whose majority shade is 2 and its walls are full of shade 2
  // too, so its rock passed the test and Seafoam Islands B4F stood its walls
  // up as thin plates -- 39% more geometry and pillars Gen 1 never drew.
  for (const id of ["SEAFOAM_ISLANDS_B4F", "CERULEAN_CAVE_1F", "MT_MOON_1F",
                    "VERMILION_DOCK", "SS_ANNE_1F"]) {
    if (!bundle.maps[id]) continue;
    const w = world(id);
    check(id + " stands nothing up", shapeCounts(w)[S.SHAPE_STANDING] === 0,
          "got " + shapeCounts(w)[S.SHAPE_STANDING]);
  }
  // Separating them by how strongly the background dominates does NOT work,
  // and this is the measurement that says so: over all 24 tilesets the
  // overworld is 37% background and a cavern is 40%.
  const cave = world("MT_MOON_1F");
  check("a cave's air is not even white", cave.profile.background !== 0,
        "shade " + cave.profile.background);
  const out = world("ROUTE_1");
  check("...where the overworld's is", out.profile.background === 0);
}

console.log("=== the plate is thin, and centred ===");
{
  let inBand = 0;
  for (let across = 0; across < 8; across++) {
    if (S.standingBand(across)) inBand++;
  }
  check("the plate is STANDING_THICK voxels deep", inBand === S.STANDING_THICK);
  check("...and centred", S.standingBand(3) && S.standingBand(4) &&
        !S.standingBand(0) && !S.standingBand(7));
  // North-south the drawing has no second elevation to read, so the plate is
  // swept at its own tallest and a fence up the map stays continuous.
  const bumpy = Int8Array.from([0, 7, 0, 7, 0, 7, 0, 7]);
  check("east-west reads the drawing column by column",
        S.standingHeightAt(bumpy, S.AXIS_EW, 0) === 0 && S.standingHeightAt(bumpy, S.AXIS_EW, 1) === 7);
  let flat = true;
  for (let i = 0; i < 8; i++) {
    if (S.standingHeightAt(bumpy, S.AXIS_NS, i) !== 7) flat = false;
  }
  check("north-south sweeps it at its tallest", flat);
}

console.log("=== a tree is a hull ===");
{
  check("the crown is a full cell tall", S.canopyHeight(3, 3) === S.CANOPY_PEAK);
  check("the corners are the rim", S.canopyHeight(0, 0) === S.CANOPY_RIM);
  check("...which is what a treeline needs to stay a wall", S.CANOPY_RIM > 0);
  // Never rising outward: a hull with a dent in it is not a hull.
  let monotone = true;
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 7; u++) {
      const inner = Math.abs(u - 3.5) < Math.abs(u + 1 - 3.5) ? u : u + 1;
      const outer = inner === u ? u + 1 : u;
      if (S.canopyHeight(outer, v) > S.canopyHeight(inner, v)) monotone = false;
    }
  }
  check("and it never rises outward", monotone);
  // Rings, not a dome: within a ring the columns are level and emit no side
  // face at all, which is what keeps the hull from costing four walls a column.
  const levels = {};
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) levels[S.canopyHeight(u, v)] = true;
  }
  check("it is four rings, not sixty-four heights", Object.keys(levels).length <= 4,
        Object.keys(levels).join(","));

  const w = world("PALLET_TOWN");
  let tree = null;
  for (let cy = 1; cy < w.map.heightCells - 1 && !tree; cy++) {
    for (let cx = 1; cx < w.map.widthCells - 1; cx++) {
      if (S.shapeForCell(w.map, w.stats, w.profile, cx, cy, 0) === S.SHAPE_CANOPY) {
        tree = [cx, cy];
        break;
      }
    }
  }
  check("the map has trees", tree !== null);
  if (tree) {
    const at = (u, v) => w.field.heights[(tree[1] * 8 + v) * w.field.cols + tree[0] * 8 + u];
    check("the built crown peaks in the middle", at(3, 3) === S.CANOPY_PEAK,
          "got " + at(3, 3));
    check("...and is short at the corner", at(0, 0) === S.CANOPY_RIM, "got " + at(0, 0));
    // The whole point of the change: a tree used to be a third of the height
    // of one storey and is now a third of a house.
    const plain = world("PALLET_TOWN", { shapes: false });
    const was = plain.field.heights[(tree[1] * 8 + 3) * plain.field.cols + tree[0] * 8 + 3];
    check("a tree got taller, not shorter", at(3, 3) > was, was + " -> " + at(3, 3));
  }
}

console.log("=== water stays in its pond ===");
{
  // A pond's edge cell is part water and part tree. Asking whether ANY tile
  // of a cell is a tree domed those cells, so 192 columns of water stood three
  // voxels proud and Pallet Town's pond grew a crenellated blue wall.
  for (const id of ["PALLET_TOWN", "VIRIDIAN_CITY"]) {
    const w = world(id);
    let proud = 0;
    let surface = 0;
    for (let ty = 0; ty < w.map.heightTiles; ty++) {
      for (let tx = 0; tx < w.map.widthTiles; tx++) {
        const tile = w.map.tileAt(tx, ty);
        if (w.stats.categories[tile] !== "WATER") continue;
        for (let v = 0; v < 4; v++) {
          for (let u = 0; u < 4; u++) {
            const h = w.field.heights[(ty * 4 + v) * w.field.cols + tx * 4 + u];
            if (h >= 0) proud++; else surface++;
          }
        }
      }
    }
    check(id + " has water", surface > 0);
    check("...and none of it stands out of its own pond", proud === 0, proud + " columns");
  }
}

console.log("=== tall grass stands in clumps, not as a lid ===");
{
  check("a solid block is a full blade", S.tuftHeight(4) === S.TUFT_VOXELS);
  check("a half block is a low one", S.tuftHeight(2) === S.TUFT_LOW);
  check("an empty block is ground", S.tuftHeight(0) === 0);
  check("...and low is lower than full", S.TUFT_LOW < S.TUFT_VOXELS);

  const w = world("ROUTE_1");
  let grass = null;
  for (let cy = 0; cy < w.map.heightCells && !grass; cy++) {
    for (let cx = 0; cx < w.map.widthCells; cx++) {
      if (S.shapeForCell(w.map, w.stats, w.profile, cx, cy, 0) === S.SHAPE_TUFT) {
        grass = [cx, cy];
        break;
      }
    }
  }
  check("Route 1 has tall grass", grass !== null);
  if (grass) {
    const [cx, cy] = grass;
    let tall = 0;
    let gaps = 0;
    for (let v = 0; v < 8; v++) {
      for (let u = 0; u < 8; u++) {
        const h = w.field.heights[(cy * 8 + v) * w.field.cols + cx * 8 + u];
        if (h >= S.TUFT_VOXELS) tall++;
        if (h === 0) gaps++;
      }
    }
    check("some of it stands up", tall > 0, "tall " + tall);
    check("...and you can see the ground between the blades", gaps > 0, "gaps " + gaps);
    check("...but it is not a solid lid", tall < 40, "tall " + tall + " of 64");

    // A character wades THROUGH tall grass. Reading the blades as a floor put
    // Red on the tips of them.
    const meshX = -w.map.widthTiles / 2 + cx * 2 + 1;
    const meshZ = -w.map.heightTiles / 2 + cy * 2 + 1;
    // Not zero: a walkable cell has always stood its lighter pixels a voxel
    // proud and a character stands on those, which is what puts Red ON a path
    // rather than between its studs. What must never happen is being lifted
    // onto the tall blades, and that is what the decor flag prevents.
    const top = T.cellTopVoxels(w.field, w.map, meshX, meshZ);
    check("and someone standing in it wades rather than walks over it",
          top < S.TUFT_VOXELS, "top " + top);
  }
}

console.log("=== the ground is flat ===");
{
  // The relief rule -- a pixel lighter than its tile's usual shade stands a
  // cube proud -- reads a window outline as a groove and a roof stripe as a
  // tile, which is right on an obstacle. On ground it read every speck of the
  // dither as a stud: Route 1's verge is tile 44, whose majority shade is 1,
  // and 5,232 of its white specks stood up. The route was a shag carpet.
  const w = world("ROUTE_1");
  const plain = world("ROUTE_1", { shapes: false });
  const studs = (field) => {
    let raised = 0;
    for (let cy = 0; cy < w.map.heightCells; cy++) {
      for (let cx = 0; cx < w.map.widthCells; cx++) {
        if (!w.map.isWalkable(cx, cy)) continue;
        if (S.shapeForCell(w.map, w.stats, w.profile, cx, cy, 0) !== S.SHAPE_FLAT) continue;
        for (let v = 0; v < 8; v++) {
          for (let u = 0; u < 8; u++) {
            if (field.heights[(cy * 8 + v) * field.cols + cx * 8 + u] !== 0) raised++;
          }
        }
      }
    }
    return raised;
  };
  check("the old ground was a bed of studs", studs(plain.field) > 4000, studs(plain.field));
  check("the new one is flat", studs(w.field) === 0, studs(w.field) + " raised");

  // And it is cheaper, because a level cell emits four side faces at its
  // border and none inside it.
  const count = (x) => {
    let quads = 0;
    for (const [cx, cz] of T.chunksForWindow(x.field.window)) {
      const g = T.buildChunkGeometry(x.field, x.map, cx, cz, x.stats);
      quads += g.quads + g.swayQuads;
    }
    return quads;
  };
  const before = count(plain);
  const after = count(w);
  check("Route 1 costs less than it did", after < before, before + " -> " + after);
}

console.log("=== a ledge is a lip ===");
{
  const w = world("ROUTE_1");
  let ledge = null;
  for (let cy = 0; cy < w.map.heightCells && !ledge; cy++) {
    for (let cx = 0; cx < w.map.widthCells; cx++) {
      if (S.shapeForCell(w.map, w.stats, w.profile, cx, cy, 0) === S.SHAPE_LIP) {
        ledge = [cx, cy];
        break;
      }
    }
  }
  check("Route 1 has ledges", ledge !== null);
  if (ledge) {
    const h = w.field.heights[(ledge[1] * 8 + 4) * w.field.cols + ledge[0] * 8 + 4];
    check("a ledge stands at the reference's six pixels", h === S.LEDGE_VOXELS, "got " + h);
    check("...which you can see over", S.LEDGE_VOXELS < S.CANOPY_PEAK);
  }
}

console.log("=== decoration is not a floor, and not a wall ===");
{
  const w = world("PALLET_TOWN");
  let decorated = 0;
  let front = 0;
  for (let i = 0; i < w.field.decor.length; i++) {
    if (w.field.decor[i]) decorated++;
    if (w.field.decorFront[i] >= 0) front++;
  }
  check("something is marked decoration", decorated > 0);
  check("and something folds its own drawing up", front > 0);
  check("every decorated column is inside the field",
        decorated < w.field.decor.length / 4, decorated + " of " + w.field.decor.length);
}

console.log("=== a hedge is a bush, not a wall ===");
{
  // Route 1 is lined with 52 cells of tiles 64/65/80/81 -- a dark dither with
  // no straight edge in it. The detector measured them at two rows and folded
  // their drawing up as if they were a wall, so the route was walled in by
  // eight-voxel cards with foliage printed on them.
  const w = world("ROUTE_1");
  const counts = shapeCounts(w);
  // Since 29 September those four tiles are TREE in the bundle (they fill
  // Route 2's wood, where the run is taller than a hedge and they were
  // folded up as buildings), so a lone bush is a one-cell canopy: the same
  // round hull, the same foliage, reached by the tree rule instead.
  const bushes = counts[S.SHAPE_HEDGE] + counts[S.SHAPE_CANOPY];
  check("Route 1's bushes are hedges or canopies now", bushes >= 40,
        "got " + counts[S.SHAPE_HEDGE] + " hedges + " + counts[S.SHAPE_CANOPY] + " canopies");
  check("outdoors is read off the cartridge, not a list of ours", S.isOutdoors(w.map));

  // Indoors the same two-row mass is Oak's counter, and rounding a counter
  // into a dome would put the three starter Pokeballs on a hill.
  for (const id of ["OAKS_LAB", "REDS_HOUSE_2F", "VIRIDIAN_MART"]) {
    if (!bundle.maps[id]) continue;
    const inside = world(id);
    check(id + " has no hedges", shapeCounts(inside)[S.SHAPE_HEDGE] === 0);
    check("...because it is not outdoors", !S.isOutdoors(inside.map));
  }

  // The hull is what a tree gets, so a bush beside a tree is the same shape.
  let hedge = null;
  for (let cy = 1; cy < w.map.heightCells - 1 && !hedge; cy++) {
    for (let cx = 1; cx < w.map.widthCells - 1; cx++) {
      const rows = w.structures.rows[(cy * 2 + 1) * w.structures.width + cx * 2] || 0;
      const shape = S.shapeForCell(w.map, w.stats, w.profile, cx, cy, rows);
      if (shape === S.SHAPE_HEDGE || shape === S.SHAPE_CANOPY) {
        hedge = [cx, cy];
        break;
      }
    }
  }
  check("there is one to look at", hedge !== null);
  if (hedge) {
    const at = (u, v) => w.field.heights[(hedge[1] * 8 + v) * w.field.cols + hedge[0] * 8 + u];
    check("it is a hull, not a card", at(3, 3) === S.CANOPY_PEAK && at(0, 0) === S.CANOPY_RIM,
          at(3, 3) + " / " + at(0, 0));
    // ...and it is painted as foliage rather than as masonry. Gen 1 is four
    // greys, so the category IS the colour decision.
    const key = w.field.keys[(hedge[1] * 8 + 3) * w.field.cols + hedge[0] * 8 + 3];
    check("and it is green", (key >> 2) === categoryIndexOf("TREE"),
          "category " + PALETTE_CATEGORIES[key >> 2]);
    // Turning SHAPES off must leave it as the flat pixel extrusion the
    // shape library replaced -- a low mound for a tree tile, never the hull.
    const plain = world("ROUTE_1", { shapes: false });
    const wall = plain.field.heights[(hedge[1] * 8 + 3) * plain.field.cols + hedge[0] * 8 + 3];
    check("...and VOXEL still draws the flat thing it replaced", wall > 0 && wall < S.CANOPY_PEAK, "got " + wall);
  }
}

console.log("=== the wind moves grass and nothing else ===");
{
  const w = world("PALLET_TOWN");
  let sways = 0;
  let postsThatSway = 0;
  for (let i = 0; i < w.field.decor.length; i++) {
    const bits = w.field.decor[i];
    if ((bits & T.DECOR_SWAYS) !== 0) sways++;
    // A fence post is decoration that must not move. Its plate is the one
    // thing that carries DECOR_STANDS without DECOR_SWAYS.
    if ((bits & T.DECOR_SWAYS) !== 0 && w.field.decorFront[i] >= 0) postsThatSway++;
  }
  check("Pallet Town has something for the wind", sways > 0);
  check("...and it is not the fences", postsThatSway === 0, postsThatSway + " posts sway");

  // The split has to be lossless: every quad in exactly one of the two
  // buffers. A blade drawn into both would z-fight itself the moment the
  // wind moved one copy.
  let ground = 0;
  let blades = 0;
  for (const [cx, cz] of T.chunksForWindow(w.field.window)) {
    const g = T.buildChunkGeometry(w.field, w.map, cx, cz, w.stats);
    ground += g.quads;
    blades += g.swayQuads;
    check("a chunk's sway buffer is whole",
          g.swayVerts.length === g.swayQuads * 20 && g.swayIndices.length === g.swayQuads * 6);
  }
  check("some of Pallet Town blows", blades > 0, "blades " + blades);
  check("...but almost none of it", blades < ground / 20, blades + " of " + (ground + blades));

  // Chunks with no grass build no second object at all.
  const indoors = world("REDS_HOUSE_2F");
  let indoorBlades = 0;
  for (const [cx, cz] of T.chunksForWindow(indoors.field.window)) {
    indoorBlades += T.buildChunkGeometry(indoors.field, indoors.map, cx, cz, indoors.stats).swayQuads;
  }
  check("and a bedroom has no weather", indoorBlades === 0);
}

console.log("=== the library is not a cost ===");
{
  // The claim from docs/RESEARCH-voxel-cost.md: between 88 and 95 per cent of
  // the vertical geometry of an outdoor map is STRUCTURE and TREE, so replacing
  // those two with authored shapes should not cost geometry. Measured, not
  // assumed -- and stated as a bound rather than an equality, because a hull
  // has rings and rings have edges.
  for (const id of ["PALLET_TOWN", "VIRIDIAN_CITY", "REDS_HOUSE_2F"]) {
    if (!bundle.maps[id]) continue;
    const shaped = world(id);
    const plain = world(id, { shapes: false });
    const count = (w) => {
      let quads = 0;
      for (const [cx, cz] of T.chunksForWindow(w.field.window)) {
        quads += T.buildChunkGeometry(w.field, w.map, cx, cz, w.stats).quads;
      }
      return quads;
    };
    const a = count(plain);
    const b = count(shaped);
    check(id + " costs no more than half again what it did", b <= a * 1.5,
          a + " -> " + b);
  }
}

console.log("=== the sun casts a shadow that costs nothing ===");
{
  // The reference casts real shadows with a second geometry pass from the sun,
  // which RESEARCH-look-and-light.md ruled out as its most expensive pass. But
  // it also BAKES its face shading into the mesh, and a shadow is the same kind
  // of fact about a face: neither the sun nor the world moves. So it is baked
  // the same way, into the UV the quad already carries.
  const w = world("PALLET_TOWN");
  // Decode each quad's UV back to the band it points at, so the count covers
  // every category rather than one hand-picked colour.
  const bandOf = (u, v) => {
    const across = pal.PALETTE_TEXELS_ACROSS;
    const col = Math.round(u * across - 0.5);
    const row = Math.round((1 - v) * across - 0.5);
    return (row * across + col) % pal.BAND_COUNT;
  };
  const bands = [];
  for (let i = 0; i < pal.BAND_COUNT; i++) bands.push(0);
  let quads = 0;
  for (const [cx, cz] of T.chunksForWindow(w.field.window)) {
    const g = T.buildChunkGeometry(w.field, w.map, cx, cz, w.stats);
    quads += g.quads;
    for (let q = 0; q < g.quads; q++) {
      bands[bandOf(g.verts[q * 20 + 3], g.verts[q * 20 + 4])]++;
    }
  }
  const shaded = bands[pal.BAND_SHADOW];
  const flat = bands[pal.BAND_TOP] + bands[pal.BAND_FLOOR];
  check("something is in shadow", shaded > 0, "shaded " + shaded);
  check("...and most of what faces the sun is not", shaded < flat,
        shaded + " shaded, " + flat + " lit");
  check("a shadow is darker than the darkest lit side",
        pal.BAND_SHADOW !== pal.BAND_NORTH);

  // It must cost NO geometry: the whole point is that it is a different texel,
  // not a different quad.
  const before = (() => {
    let n = 0;
    for (const [cx, cz] of T.chunksForWindow(w.field.window)) {
      n += T.buildChunkGeometry(w.field, w.map, cx, cz, w.stats).quads;
    }
    return n;
  })();
  check("and the same quads carry it", before === quads);
  // The palette still fits. Fourteen categories at four shades in eight bands
  // is 448 texels plus the earth's two; a palette that does not fit wraps
  // silently onto the wrong colours.
  check("the palette still fits its texture",
        PALETTE_CATEGORIES.length * 4 * pal.BAND_COUNT + 2 <= pal.PALETTE_TEXEL_COUNT);
}

console.log("=== a walk does not pop ===");
{
  // Joshua, 7 September: "de user glitched nogsteeds af en toe". One cause of
  // that is measurable and is now gone. A character stands at cellTopVoxels,
  // and the old ground was a bed of studs, so crossing one moved the sprite a
  // voxel. This counts how many steps between adjacent walkable cells change
  // the height a character stands at.
  //
  // It is one cause, not proof of the whole symptom.
  for (const [id, bound] of [["ROUTE_1", 0.02], ["PALLET_TOWN", 0.01],
                             ["VIRIDIAN_CITY", 0.01], ["REDS_HOUSE_1F", 0.01]]) {
    if (!bundle.maps[id]) continue;
    const pops = (w) => {
      let steps = 0;
      let jumps = 0;
      for (let cy = 0; cy < w.map.heightCells; cy++) {
        for (let cx = 0; cx < w.map.widthCells; cx++) {
          if (!w.map.isWalkable(cx, cy)) continue;
          const at = (x, y) => T.cellTopVoxels(w.field, w.map,
            -w.map.widthTiles / 2 + x * 2 + 1, -w.map.heightTiles / 2 + y * 2 + 1);
          const here = at(cx, cy);
          const steps2 = [[1, 0], [0, 1]];
          for (let i = 0; i < steps2.length; i++) {
            const nx = cx + steps2[i][0];
            const ny = cy + steps2[i][1];
            if (nx >= w.map.widthCells || ny >= w.map.heightCells) continue;
            if (!w.map.isWalkable(nx, ny)) continue;
            steps++;
            if (at(nx, ny) !== here) jumps++;
          }
        }
      }
      return { steps, jumps };
    };
    const before = pops(world(id, { shapes: false }));
    const after = pops(world(id));
    check(id + " walked bumpily before", before.jumps / before.steps > 0.05,
          (100 * before.jumps / before.steps).toFixed(1) + "%");
    check("...and is level now",
          after.jumps / after.steps <= bound,
          (100 * before.jumps / before.steps).toFixed(1) + "% -> " +
          (100 * after.jumps / after.steps).toFixed(1) + "%");
  }
}

console.log("=== a door is part of the wall it is cut into ===");
{
  // A door has to be walkable -- you step into it -- but it is DRAWN in the
  // front wall, so Structures.ts folds it into the wall above. Asking "is it
  // walkable" before "is it a measured building" handed those cells to flat
  // ground and punched a notch through every doorway in Kanto.
  for (const id of ["CINNABAR_LAB", "OAKS_LAB", "REDS_HOUSE_1F", "VIRIDIAN_MART"]) {
    if (!bundle.maps[id]) continue;
    const shaped = world(id);
    const plain = world(id, { shapes: false });
    let notched = 0;
    for (let cy = 0; cy < shaped.map.heightCells; cy++) {
      for (let cx = 0; cx < shaped.map.widthCells; cx++) {
        if (!shaped.map.isDoorTile(cx, cy)) continue;
        for (let v = 0; v < 8; v++) {
          for (let u = 0; u < 8; u++) {
            const at = (cy * 8 + v) * shaped.field.cols + cx * 8 + u;
            if (plain.field.heights[at] > 0 && shaped.field.heights[at] === 0) notched++;
          }
        }
      }
    }
    check(id + "'s doors stay in their walls", notched === 0, notched + " columns dropped");
  }
}

console.log("=== a wall is drawn as a wall ===");
{
  // The playtest, in one sentence: "op plekken dat ik denk dat ik ergens
  // doorheen kan lopen stoot ik tegen een muur op". That was measurable and it
  // was not an impression -- VIRIDIAN_FOREST read as 913 blocked cells and 913
  // props, so every tree in the forest was a thin plate standing on ground
  // drawn as floor, and cellTopVoxels (which skips what stands on the ground,
  // as it must) reported the whole forest walkable-height.
  //
  // The cause is the data: the prop test asks "mostly background with some ink
  // on it", which is what a sign looks like, and a forest tileset whose
  // categories are all STRUCTURE gives its trees the same answer. The map
  // vetoes it now -- see PROP_MAP_SHARE.
  // The DRAWN height of a cell, not the standing height. cellTopVoxels answers
  // "where does a character stand", which for a wall is deliberately the
  // ground beside it -- the doorstep rule -- so it cannot tell a wall from a
  // floor. This reads the columns.
  const flatWalls = (w) => {
    let flat = 0;
    let blocked = 0;
    const win = w.field.window;
    for (let cy = 0; cy < w.map.heightCells; cy++) {
      for (let cx = 0; cx < w.map.widthCells; cx++) {
        if (w.map.isWalkable(cx, cy)) continue;
        blocked++;
        let tallest = -1;
        for (let tz = cy * 2; tz <= cy * 2 + 1; tz++) {
          for (let tx = cx * 2; tx <= cx * 2 + 1; tx++) {
            const c0 = (tx - win.minTileX) * T.VOXELS_PER_TILE;
            const r0 = (tz - win.minTileZ) * T.VOXELS_PER_TILE;
            for (let r = r0; r < r0 + T.VOXELS_PER_TILE; r++) {
              for (let c = c0; c < c0 + T.VOXELS_PER_TILE; c++) {
                const h = w.field.heights[r * w.field.cols + c];
                if (h > tallest) tallest = h;
              }
            }
          }
        }
        if (tallest <= 1) flat++;
      }
    }
    return [blocked, flat];
  };

  const forest = flatWalls(world("VIRIDIAN_FOREST"));
  check("Viridian Forest has walls at all", forest[0] > 500, forest[0]);
  check("...and not one of them is drawn flat", forest[1] === 0,
        forest[1] + " of " + forest[0] + " blocked cells drawn flat");

  // And the shape they get: 913 props became 863 masses and 50 hedges.
  const shapes = {};
  const fw = world("VIRIDIAN_FOREST");
  for (let cy = 0; cy < fw.map.heightCells; cy++) {
    for (let cx = 0; cx < fw.map.widthCells; cx++) {
      if (fw.map.isWalkable(cx, cy)) continue;
      const shape = S.shapeForCell(fw.map, fw.stats, fw.profile, cx, cy, 0);
      shapes[shape] = (shapes[shape] || 0) + 1;
    }
  }
  check("not one forest wall is a prop", (shapes[S.SHAPE_STANDING] || 0) === 0,
        (shapes[S.SHAPE_STANDING] || 0) + " still standing as plates");

  // The maps the veto must NOT touch: a fence beside a path is a prop, and a
  // rule that took props away everywhere would flatten every sign in Kanto
  // into a block. Pallet reads 22% props and keeps them.
  const pallet = world("PALLET_TOWN");
  check("Pallet Town still has props", pallet.profile.propsAllowed);
  check("and Route 1 does", world("ROUTE_1").profile.propsAllowed);

  // The forest used to be vetoed here, and is not any more -- which is the
  // veto working itself out of a job rather than breaking.
  //
  // PROP_MAP_SHARE was a treatment for a symptom: a FOREST tileset whose every
  // blocked tile said STRUCTURE gave its canopies the prop reading, so the
  // forest measured 100% props and had to be excluded wholesale. Since the
  // category table reaches past OVERWORLD (BundleFromExtraction) those tiles
  // say TREE, take the canopy hull, and never reach the prop test at all. The
  // veto now fires on two maps rather than seven, and the forest is not one of
  // them -- yet not one forest wall is a prop, which the check above measures.
  // Treat a widening of this list as the signal it is: something upstream has
  // stopped classifying.
  check("the forest no longer needs the veto",
        world("VIRIDIAN_FOREST").profile.propsAllowed === true);
  let vetoed = 0;
  for (const id of Object.keys(bundle.maps)) {
    const m = world(id);
    if (!S.isOutdoors(m.map)) continue;
    let blocked = 0;
    for (let cy = 0; cy < m.map.heightCells; cy++) {
      for (let cx = 0; cx < m.map.widthCells; cx++) {
        if (!m.map.isWalkable(cx, cy)) blocked++;
      }
    }
    if (blocked >= 20 && !m.profile.propsAllowed) vetoed++;
  }
  check("and only Route 23 and Saffron still do", vetoed === 2, vetoed + " maps vetoed");

  // The threshold is a measurement, so state what it separates.
  check("the share is half", S.PROP_MAP_SHARE === 0.5, S.PROP_MAP_SHARE);
}

console.log("=== every map in Kanto, both ways ===");
{
  // The sweep that would have caught Seafoam Islands B4F. A rule measured on
  // Route 1 and Pallet Town can be wrong somewhere among the other 220 maps in
  // a way no screenshot will ever show, and the cheapest thing that notices is
  // the quad count: geometry that suddenly grows by a third is geometry that
  // is being built for something the artist did not draw.
  //
  // Seven seconds for all 222 maps, both ways. Worth it.
  let grew = 0;
  let ranAway = "";
  let worstChunk = 0;
  let worstChunkMap = "";
  let plainTotal = 0;
  let shapedTotal = 0;
  for (const id of Object.keys(bundle.maps)) {
    const a = world(id, { shapes: false });
    const c = world(id);
    const tally = (w) => {
      let quads = 0;
      for (const [cx, cz] of T.chunksForWindow(w.field.window)) {
        const g = T.buildChunkGeometry(w.field, w.map, cx, cz, w.stats);
        quads += g.quads + g.swayQuads;
        if (g.quads > worstChunk) { worstChunk = g.quads; worstChunkMap = id; }
      }
      return quads;
    };
    const before = tally(a);
    const after = tally(c);
    plainTotal += before;
    shapedTotal += after;
    if (after > before) grew++;
    if (before > 0 && after > before * 1.25) {
      ranAway = id + " " + before + " -> " + after;
    }
  }
  check("no map's geometry runs away", ranAway === "", ranAway);
  // Six, when this was written: Routes 11, 6 and 12, Viridian Forest,
  // Cinnabar Island and Vermilion City -- every one of them an outdoor map
  // whose tall grass now stands up. Since 29 September the second overworld
  // tree (Route 2's wood, Fuchsia's groves) is a canopy too, and a canopy's
  // hull costs more than the flat block it replaces: eighteen maps now.
  check("and almost all of them get cheaper", grew < 24, grew + " of 222 grew");
  check("Kanto as a whole shrinks", shapedTotal < plainTotal,
        plainTotal.toLocaleString() + " -> " + shapedTotal.toLocaleString());
  // A chunk over the 16-bit index limit does not draw at all.
  check("no chunk is near the 16-bit index limit", worstChunk < 12000,
        worstChunk + " on " + worstChunkMap);
}

console.log("=== the two halves agree on a voxel ===");
{
  check("a tile is the same number of columns either side",
        S.VOXELS_PER_TILE === T.VOXELS_PER_TILE);
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // A rule that answered the same for everything would pass none of the counts
  // above; prove the suite is reading a real classifier and not a constant.
  const w = world("PALLET_TOWN");
  const counts = shapeCounts(w);
  let kinds = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) kinds++;
  }
  check("the classifier answers more than one thing", kinds >= 4, "got " + kinds);
  // ...and that the fence test would notice a detector that swallowed props.
  const swallowed = detectStructures(w.map, w.stats, 0, 0, w.map.widthTiles - 1,
                                     w.map.heightTiles - 1, null);
  let differs = false;
  for (let i = 0; i < swallowed.rows.length; i++) {
    if (swallowed.rows[i] !== w.structures.rows[i]) differs = true;
  }
  check("passing the profile changes what the detector claims", differs);
}

console.log("\n=== the overworld's rock is rock and its woods are trees ===");
{
  // OVERWORLD_EXPLICIT (BundleFromExtraction) names what no ROM table does.
  // Tile 17 is the cliff of Route 3 and Route 4; 64/65/80/81 the round
  // canopy that fills Route 2 beside the forest. Before 29 September both
  // were STRUCTURE, and the way to Mt Moon was a terrace of gabled houses.
  const ow = bundle.tilesets.OVERWORLD.categories;
  check("the mountain's cliff face is rock", ow[17] === "ROCK", ow[17]);
  check("and so are its lighter and darker courses", ow[1] === "ROCK" && ow[36] === "ROCK", ow[1] + " " + ow[36]);
  check("Route 2's wood is trees", ow[64] === "TREE" && ow[65] === "TREE" && ow[80] === "TREE" && ow[81] === "TREE",
        [64, 65, 80, 81].map((t) => ow[t]).join(" "));
  check("a house's wall is still a building, and a bush is still a bush", ow[7] === "STRUCTURE" && ow[3] === "STRUCTURE", ow[7] + " " + ow[3]);
  const r3 = world("ROUTE_3");
  let gabled = 0;
  for (let i = 0; i < r3.structures.roofRows.length; i++) if (r3.structures.roofRows[i] > 0) gabled++;
  check("Route 3 has no gabled roofs on its mountain", gabled < 40, gabled + " roofed tiles");
}

console.log("\nTILESHAPES  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
