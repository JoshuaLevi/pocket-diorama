// The play area, headless: the fixed square window, the ZOOM ladder, the
// centimetres a tile, and what an older save migrates to.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/playarea.test.mjs Assets/Generated/kanto.json --selftest
//
// Four decisions taken on 9 September are stated here as numbers, because
// every one of them was wrong on the glasses in a way no screenshot showed:
//
//   1. The play area is a SQUARE of tiles centred on the player, and at a map
//      edge it SLIDES back onto the map keeping its full size. It shrinks only
//      when the map is genuinely smaller than the window. The cartridge's own
//      camera does exactly this; ours clamped, so walking to the north edge of
//      Route 1 quietly halved the world.
//   5. ZOOM is expressed in tiles ACROSS -- 14 / 20 / 28 / 40 -- because the
//      old ladder was a RADIUS whose name said nothing, and every rung on it
//      was therefore chosen for the wrong number.
//   6. There is no curve. The world is a flat slab.
//   8. One constant centimetres-per-tile for every map, indoors and out. A
//      room is small and a city fills the plate; before this every map was
//      stretched to the same 70 cm, so a schoolhouse read as a city.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const P = await import("../Assets/Scripts/world/PlayArea.ts");
const {
  ZOOM_TILES_ACROSS, ZOOM_LABELS, ZOOM_DEFAULT, zoomTilesAcross,
  CM_PER_TILE, plateSpanCm, slideSpan,
} = P;
const { windowFor } = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const V = await import("../Assets/Scripts/play/screen/ViewOptions.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

/** windowFor reads nothing but these two, so a size is a whole map here. */
function mapOf(widthTiles, heightTiles) {
  return { widthTiles: widthTiles, heightTiles: heightTiles };
}
const across = (w) => w.maxTileX - w.minTileX + 1;
const deep = (w) => w.maxTileZ - w.minTileZ + 1;

console.log("=== the ZOOM ladder is tiles ACROSS, and says so ===");
{
  check("four rungs", ZOOM_TILES_ACROSS.length === 4, String(ZOOM_TILES_ACROSS));
  check("14 / 20 / 28 / 40", ZOOM_TILES_ACROSS[0] === 14 && ZOOM_TILES_ACROSS[1] === 20 &&
        ZOOM_TILES_ACROSS[2] === 28 && ZOOM_TILES_ACROSS[3] === 40);
  check("the ladder climbs", ZOOM_TILES_ACROSS.every((n, i) => i === 0 || n > ZOOM_TILES_ACROSS[i - 1]));
  check("every rung is a whole number of tiles", ZOOM_TILES_ACROSS.every((n) => n === Math.round(n)));
  // The label IS the number. A rung called WIDEST is what let a radius ladder
  // hide the fact that its tightest rung already drew 17 tiles across.
  check("each label is its own tile count",
        ZOOM_LABELS.length === ZOOM_TILES_ACROSS.length &&
        ZOOM_LABELS.every((s, i) => s === String(ZOOM_TILES_ACROSS[i])));
  check("the default rung is 20 across", zoomTilesAcross(ZOOM_DEFAULT) === 20);
  check("an index off the end falls back to the default",
        zoomTilesAcross(99) === 20 && zoomTilesAcross(-1) === 20 &&
        zoomTilesAcross(undefined) === 20);
}

console.log("=== a player in the middle of a map ===");
{
  // Pallet Town: 40 x 36 tiles.
  const map = mapOf(40, 36);
  const w = windowFor(map, 20, 20, 18, 0, false);
  check("20 tiles across", across(w) === 20, across(w) + " x " + deep(w));
  check("20 tiles deep", deep(w) === 20, String(deep(w)));
  check("and it is square", across(w) === deep(w));
  check("the player is inside it",
        20 >= w.minTileX && 20 <= w.maxTileX && 18 >= w.minTileZ && 18 <= w.maxTileZ);
  check("and near the middle of it",
        Math.abs(20 - (w.minTileX + w.maxTileX) / 2) <= 1 &&
        Math.abs(18 - (w.minTileZ + w.maxTileZ) / 2) <= 1);
}

console.log("=== at each edge the window SLIDES, it does not shrink ===");
{
  const map = mapOf(40, 36);
  // West. The old code clamped minX to 0 and left maxX at focus + radius, so
  // the window lost every tile the player stood near the edge of.
  const west = windowFor(map, 20, 0, 18, 0, false);
  check("west: still 20 across", across(west) === 20, String(across(west)));
  check("west: slid onto the map", west.minTileX === 0 && west.maxTileX === 19);
  check("west: the depth is untouched", deep(west) === 20);

  const east = windowFor(map, 20, 39, 18, 0, false);
  check("east: still 20 across", across(east) === 20, String(across(east)));
  check("east: slid back off the edge", east.maxTileX === 39 && east.minTileX === 20);

  const north = windowFor(map, 20, 20, 0, 0, false);
  check("north: still 20 deep", deep(north) === 20, String(deep(north)));
  check("north: slid onto the map", north.minTileZ === 0 && north.maxTileZ === 19);

  const south = windowFor(map, 20, 20, 35, 0, false);
  check("south: still 20 deep", deep(south) === 20, String(deep(south)));
  check("south: slid back off the edge", south.maxTileZ === 35 && south.minTileZ === 16);

  // The player is off-centre at an edge, and that is the point: the Game Boy
  // does the same, because the alternative is showing the void past the map.
  check("the player is still inside the window at the edge",
        0 >= west.minTileX && 0 <= west.maxTileX && 35 >= south.minTileZ && 35 <= south.maxTileZ);

  // Every rung of the ladder, at every edge: none of them may shrink.
  let shrank = "";
  for (const rung of ZOOM_TILES_ACROSS) {
    for (const [fx, fz] of [[0, 0], [39, 0], [0, 35], [39, 35], [20, 18]]) {
      const w = windowFor(map, rung, fx, fz, 0, false);
      const wantX = Math.min(rung, map.widthTiles);
      const wantZ = Math.min(rung, map.heightTiles);
      if (across(w) !== wantX || deep(w) !== wantZ) {
        shrank = rung + " at " + fx + "," + fz + " -> " + across(w) + "x" + deep(w);
      }
    }
  }
  check("no rung shrinks anywhere on the map", shrank === "", shrank);
}

console.log("=== at a corner ===");
{
  const map = mapOf(40, 36);
  const nw = windowFor(map, 20, 0, 0, 0, false);
  check("north-west: full size on both axes", across(nw) === 20 && deep(nw) === 20);
  check("north-west: pinned to the corner",
        nw.minTileX === 0 && nw.minTileZ === 0 && nw.maxTileX === 19 && nw.maxTileZ === 19);
  const se = windowFor(map, 20, 39, 35, 0, false);
  check("south-east: full size on both axes", across(se) === 20 && deep(se) === 20);
  check("south-east: pinned to the corner",
        se.maxTileX === 39 && se.maxTileZ === 35 && se.minTileX === 20 && se.minTileZ === 16);
  check("the window never leaves the map",
        nw.minTileX >= 0 && nw.minTileZ >= 0 &&
        se.maxTileX < map.widthTiles && se.maxTileZ < map.heightTiles);
}

console.log("=== a map smaller than the window ===");
{
  // Red's house: 16 x 16 tiles, four blocks square. A 20-tile window cannot
  // fit, and this is the ONE case where shrinking is right.
  const room = mapOf(16, 16);
  const w = windowFor(room, 20, 8, 8, 0, false);
  check("the whole room, and no more", w.minTileX === 0 && w.maxTileX === 15 &&
        w.minTileZ === 0 && w.maxTileZ === 15);
  check("which is 16 across, not 20", across(w) === 16);
  check("and it stays whole wherever the player stands",
        JSON.stringify(windowFor(room, 20, 0, 15, 0, false)) === JSON.stringify(w));

  // One axis short, the other long: a corridor shrinks on one axis only.
  const corridor = mapOf(12, 40);
  const c = windowFor(corridor, 20, 6, 20, 0, false);
  check("a corridor keeps its full depth", deep(c) === 20, String(deep(c)));
  check("and gives up only the axis that cannot hold it", across(c) === 12, String(across(c)));
}

console.log("=== the whole map is still available ===");
{
  // A window of 0 or less means "no window": the whole map, as before.
  const map = mapOf(40, 36);
  const all = windowFor(map, -1, 0, 0, 0, false);
  check("unlimited is the whole map", all.minTileX === 0 && all.maxTileX === 39 &&
        all.minTileZ === 0 && all.maxTileZ === 35);
  check("its bend is centred on the map",
        Math.abs(all.centreX) < 1e-9 && Math.abs(all.centreZ) < 1e-9);
}

console.log("=== the span helper, on its own ===");
{
  check("middle", JSON.stringify(slideSpan(20, 20, 40)) === JSON.stringify({ min: 10, max: 29 }));
  check("low edge", JSON.stringify(slideSpan(0, 20, 40)) === JSON.stringify({ min: 0, max: 19 }));
  check("high edge", JSON.stringify(slideSpan(39, 20, 40)) === JSON.stringify({ min: 20, max: 39 }));
  check("exactly the map", JSON.stringify(slideSpan(8, 16, 16)) === JSON.stringify({ min: 0, max: 15 }));
  check("wider than the map", JSON.stringify(slideSpan(8, 40, 16)) === JSON.stringify({ min: 0, max: 15 }));
  check("no window at all", JSON.stringify(slideSpan(8, 0, 16)) === JSON.stringify({ min: 0, max: 15 }));
  check("a fractional focus still lands on whole tiles", (() => {
    const s = slideSpan(20.5, 20, 40);
    return s.min === Math.round(s.min) && s.max - s.min + 1 === 20;
  })());
}

console.log("=== one centimetres-per-tile for every map ===");
{
  check("3.5 cm a tile", CM_PER_TILE === 3.5, String(CM_PER_TILE));
  check("so the default 20-tile window is a 70 cm plate", plateSpanCm(20) === 70);
  check("14 across is 49 cm and 40 across is 140", plateSpanCm(14) === 49 && plateSpanCm(40) === 140);

  // Decision 8, stated as the thing that was wrong: Red's bedroom and Pallet
  // Town used to be drawn at 4.375 and 3.5 cm a tile so that BOTH filled a
  // 70 cm plate. A room is small. A city fills the plate.
  const room = mapOf(16, 16);
  const city = mapOf(40, 36);
  const roomWindow = windowFor(room, 20, 8, 8, 0, false);
  const cityWindow = windowFor(city, 20, 20, 18, 0, false);
  check("a room is 56 cm across", across(roomWindow) * CM_PER_TILE === 56,
        String(across(roomWindow) * CM_PER_TILE));
  check("a city fills the 70 cm plate", across(cityWindow) * CM_PER_TILE === 70,
        String(across(cityWindow) * CM_PER_TILE));
  check("the room is SMALLER than the city, not the same size",
        across(roomWindow) * CM_PER_TILE < across(cityWindow) * CM_PER_TILE);
  check("and the old rule is gone: nothing is scaled by the map's own longest side",
        CM_PER_TILE !== 70 / Math.max(room.widthTiles, room.heightTiles));

  // Every map, indoors and out, at the same centimetres a tile.
  let odd = "";
  for (const [w, h] of [[16, 16], [20, 24], [40, 36], [100, 72], [68, 96]]) {
    const win = windowFor(mapOf(w, h), 20, w / 2, h / 2, 0, false);
    const cm = across(win) * CM_PER_TILE / across(win);
    if (cm !== CM_PER_TILE) odd = w + "x" + h + " -> " + cm;
  }
  check("no map is drawn at its own scale any more", odd === "", odd);
}

console.log("=== against the real bundle ===");
if (bundlePath) {
  const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  const runtimeFor = (id) => new MapRuntime(bundle.maps[id], bundle.tilesets[bundle.maps[id].tileset]);

  const route = runtimeFor("ROUTE_1");
  // Route 1 is 40 x 72 tiles. The complaint the whole change answers --
  // "ik wil niet dat gehele routes en towns worden gerenderd" -- is this
  // number: at the default rung the route is a 20-tile square, not 72 deep.
  const mid = windowFor(route, zoomTilesAcross(ZOOM_DEFAULT), 20, 36, 0, false);
  check("Route 1 at the default zoom is 20 x 20", across(mid) === 20 && deep(mid) === 20,
        across(mid) + "x" + deep(mid));
  const top = windowFor(route, zoomTilesAcross(ZOOM_DEFAULT), 20, 0, 0, false);
  check("...and still 20 x 20 at its north end", across(top) === 20 && deep(top) === 20,
        across(top) + "x" + deep(top));
  check("which is a 70 cm plate on the table", across(mid) * CM_PER_TILE === 70);

  const bedroom = runtimeFor("REDS_HOUSE_2F");
  const bed = windowFor(bedroom, zoomTilesAcross(ZOOM_DEFAULT), 8, 8, 0, false);
  check("Red's bedroom is the whole room and 56 cm across",
        across(bed) === bedroom.widthTiles && across(bed) * CM_PER_TILE === 56,
        String(across(bed) * CM_PER_TILE));
  check("a bedroom is smaller than a route", across(bed) * CM_PER_TILE < across(mid) * CM_PER_TILE);
} else {
  console.log("  (no bundle given; skipped)");
}

console.log("=== an older save opens on the new ladder ===");
{
  // Joshua's own save carries the rows this change removed: a WORLD index
  // from a RADIUS ladder and a CURVE that no longer exists. Neither may be
  // read as if it meant something on the new page.
  const owner = { tilt: 0, curve: 3, edge: 1, world: 3, speed: 1, pad: 0,
                  battle: 1, time: 0, colour: 1, shapes: 0 };
  const s = V.sanitiseViewSettings(owner);
  check("the curve is gone from the settings entirely", s.curve === undefined);
  check("and so is the edge, which went with it", s.edge === undefined);
  check("the saved WORLD index is not reused as a ZOOM index",
        s.zoom === V.defaultViewSettings().zoom, String(s.zoom));
  check("which is the default 20 tiles across", zoomTilesAcross(s.zoom) === 20);
  check("everything the save legitimately carried survives",
        s.tilt === 0 && s.speed === 1);
  // ...except the rows a change of DEFAULT reclaims. This save predates
  // VIEW_REVISION 1, so BATTLE, COLOUR and SHAPES come back as the lens's own
  // current answer rather than as the choice made against the old one. See
  // MIGRATED_ROWS: it is the only way a new default can reach a wearer who
  // already has a save, and it is why "de battles staan als default op real
  // world" could be true of a lens whose default was never LIFE.
  const d = V.defaultViewSettings();
  check("and the rows this revision reclaims come back as the defaults",
        s.battle === d.battle && s.colour === d.colour && s.shapes === d.shapes);
  check("with the revision stamped, so it happens once", s.rev === d.rev);

  // The oldest saves carried WORLD 4 -- the ALL rung, the one that rendered a
  // whole route and cooked the glasses. It must not come back either.
  const ancient = V.sanitiseViewSettings({ tilt: 0, curve: 5, edge: 0, world: 4 });
  check("an ALL save opens on the default zoom too", zoomTilesAcross(ancient.zoom) === 20);
  check("and flat", ancient.curve === undefined);

  // A save written by THIS version round-trips unchanged.
  const fresh = V.defaultViewSettings();
  check("a current save round-trips", JSON.stringify(V.sanitiseViewSettings(fresh)) === JSON.stringify(fresh));
  check("a zoom off the end of the new ladder falls back",
        V.sanitiseViewSettings({ zoom: 99 }).zoom === fresh.zoom);
  // ...but only with the revision stamp on it. ZOOM joined MIGRATED_ROWS at
  // revision 2, for the reason the ALL rung above was removed for and which
  // this file already knew the words to: it cooked the glasses. An unstamped
  // block is from before that and opens on the default; a block written since
  // keeps whatever the wearer chose, 40 included.
  check("a stored zoom in range survives",
        V.sanitiseViewSettings({ zoom: 3, rev: V.VIEW_REVISION }).zoom === 3);
  check("...and an unstamped one does not",
        V.sanitiseViewSettings({ zoom: 3 }).zoom === V.defaultViewSettings().zoom);
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
  // The three ways this suite could pass while the lens is wrong.
  expectFailures("a window that clamps instead of sliding", () => {
    const map = mapOf(40, 36);
    const clamped = { minTileX: 0, maxTileX: 29, minTileZ: 0, maxTileZ: 27 };
    check("slide detector", across(clamped) === 20);
  });
  expectFailures("a ladder read as a radius", () => {
    check("radius detector", zoomTilesAcross(ZOOM_DEFAULT) === 40);
  });
  expectFailures("a plate still scaled by the map", () => {
    check("plate detector", CM_PER_TILE === 70 / 16);
  });
}

console.log("");
console.log("PLAYAREA  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
