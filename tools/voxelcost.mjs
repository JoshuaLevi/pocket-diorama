// What the voxel terrain costs, headless, so the number is measured and not
// guessed before anything is built on top of it.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        tools/voxelcost.mjs Assets/Generated/kanto.json
//
// Two tables. The first is the geometry a window emits at each RENDER DIST
// rung, per map: chunks, quads, vertices and the bytes those buffers take.
// The second is where that geometry SITS -- columns and total voxel height by
// tile category -- because a column's height is what its side faces are made
// of, so height times count is a fair proxy for a category's share. See
// docs/RESEARCH-voxel-cost.md for what the numbers said.

// What the voxel terrain costs today: quads, vertices and bytes per window,
// per map and per RENDER DIST rung. Nothing is guessed -- every number is the
// geometry the shipping builder actually emits.
import { readFileSync } from "node:fs";
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const ROOT = new URL("../", import.meta.url).pathname;
const { MapRuntime } = await import(ROOT + "Assets/Scripts/world/MapRuntime.ts");
const pal = await import(ROOT + "Assets/Scripts/world/VoxelPalette.ts");
const { tileStatsFor } = pal;
const T = await import(ROOT + "Assets/Scripts/world/VoxelTerrain.ts");
const PA = await import(ROOT + "Assets/Scripts/world/PlayArea.ts");
const bundle = JSON.parse(readFileSync(process.argv[2] || ROOT + "Assets/Generated/kanto.json", "utf8"));

const maps = ["PALLET_TOWN", "ROUTE_1", "VIRIDIAN_CITY", "REDS_HOUSE_2F", "VIRIDIAN_FOREST"];
console.log("ZOOM_TILES_ACROSS:", JSON.stringify(PA.ZOOM_TILES_ACROSS));
console.log("VOXELS_PER_TILE:", T.VOXELS_PER_TILE, " CHUNK_TILES:", T.CHUNK_TILES);
console.log("");
console.log("map                   ZOOM  chunks   quads     verts     KiB   worst chunk");
for (const id of maps) {
  const def = bundle.maps[id];
  if (!def) { console.log(id + ": missing"); continue; }
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const stats = tileStatsFor(bundle.tilesets[def.tileset]);
  for (let ri = 0; ri < PA.ZOOM_TILES_ACROSS.length; ri++) {
    const acrossTiles = PA.ZOOM_TILES_ACROSS[ri];
    const cx = Math.floor(map.widthTiles / 2), cz = Math.floor(map.heightTiles / 2);
    const window = T.windowFor(map, acrossTiles, cx, cz, 0, false);
    const field = T.buildColumnField(map, stats, window);
    const chunks = T.chunksForWindow(window);
    let quads = 0, worst = 0;
    for (const [ccx, ccz] of chunks) {
      const g = T.buildChunkGeometry(field, map, ccx, ccz);
      quads += g.quads;
      if (g.quads > worst) worst = g.quads;
    }
    // 5 floats a vertex (position + uv), 4 vertices a quad, 6 indices a quad.
    const bytes = quads * (4 * 5 * 4 + 6 * 2);
    console.log(
      id.padEnd(18) + " " + String(PA.ZOOM_LABELS[ri]).padStart(6) + " " +
      String(chunks.length).padStart(7) + " " + String(quads).padStart(8) + " " +
      String(quads * 4).padStart(9) + " " + String(Math.round(bytes / 1024)).padStart(7) +
      "   " + worst);
  }
}

console.log('');

for (const id of ["PALLET_TOWN", "VIRIDIAN_FOREST", "VIRIDIAN_CITY"]) {
  const def = bundle.maps[id];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const stats = pal.tileStatsFor(bundle.tilesets[def.tileset]);
  const window = T.windowFor(map, -1, 0, 0, 0, false);
  const field = T.buildColumnField(map, stats, window);
  const byCat = {};
  for (let tz = 0; tz < map.heightTiles; tz++) {
    for (let tx = 0; tx < map.widthTiles; tx++) {
      const cat = stats.categories[map.tileAt(tx, tz)] || "?";
      for (let vz = 0; vz < T.VOXELS_PER_TILE; vz++) {
        for (let vx = 0; vx < T.VOXELS_PER_TILE; vx++) {
          const h = field.heights[(tz * T.VOXELS_PER_TILE + vz) * field.cols + tx * T.VOXELS_PER_TILE + vx];
          const e = byCat[cat] || (byCat[cat] = { cols: 0, voxels: 0 });
          e.cols++;
          e.voxels += h > 0 ? h : 0;
        }
      }
    }
  }
  const rows = Object.keys(byCat).map((k) => [k, byCat[k].cols, byCat[k].voxels]);
  const totalV = rows.reduce((a, r) => a + r[2], 0);
  rows.sort((a, b) => b[2] - a[2]);
  console.log("\n" + id + "  (" + map.widthTiles + "x" + map.heightTiles + " tiles)");
  for (const [k, cols, vox] of rows) {
    console.log("   " + k.padEnd(12) + String(cols).padStart(7) + " columns  " +
                String(vox).padStart(8) + " voxels of height  " +
                (totalV ? (100 * vox / totalV).toFixed(1) : "0") + "%");
  }
}
