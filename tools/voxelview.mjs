// The diorama, rendered to a PNG from a laptop.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        tools/voxelview.mjs Assets/Generated/kanto.json PALLET_TOWN out.png [--flat]
//
// Why this exists: every look question -- is a tree a ball or a pancake, does
// a fence read as posts, is tall grass standing up -- used to cost a Lens
// Studio preview restart, and on the glasses it cost a whole build. Both
// answer in about a minute. This answers in about a second, from exactly the
// same column field the lens builds, so what it draws is what the lens will
// draw and not a second implementation that can drift.
//
// It is a LOOK CHECK, not a gate. It has no curvature, no edge fade, no
// passthrough and no shadows; the diorama is only really real in the lens.
// What it does have is the geometry and the palette, which is what a shape
// library is a change to.
//
// --flat renders the pixel extrusion this project shipped before the shape
// library, so the two can be put side by side.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const [, , bundlePath, mapId, outPath, ...flags] = process.argv;
if (!bundlePath || !mapId || !outPath) {
  console.error("usage: voxelview.mjs <bundle.json> <MAP_ID> <out.png> " +
                "[--flat] [--tiles N] [--pitch D] [--yaw D] [--focus x,y] [--look x,y] [--play N] [--size W,H] [--alpha]");
  process.exit(2);
}
const FLAT = flags.includes("--flat");
const playFlag = flags.indexOf("--play");
/**
 * How wide the PLAY AREA is, in tiles: the plate the wearer actually sees,
 * cut from a cover of whole chunks the way the lens cuts it (ViewClip), skirt
 * and all. Zero draws the window whole, which is what a shape check wants and
 * what this tool did before. Anything about the EDGE of the world needs this.
 */
const PLAY_TILES = playFlag >= 0 ? Number(flags[playFlag + 1]) : 0;
const tilesFlag = flags.indexOf("--tiles");
/** How many tiles across the frame shows. Smaller is closer in. */
const VIEW_TILES = tilesFlag >= 0 ? Number(flags[tilesFlag + 1]) : 28;
const pitchFlag = flags.indexOf("--pitch");
/** Degrees above the horizon. The reference's diorama preset is 55. */
const PITCH_DEGREES = pitchFlag >= 0 ? Number(flags[pitchFlag + 1]) : 55;
const focusFlag = flags.indexOf("--focus");
const FOCUS = focusFlag >= 0 ? flags[focusFlag + 1].split(",").map(Number) : null;
const yawFlag = flags.indexOf("--yaw");
/** Degrees round the model, from square on to the south side. */
const YAW_DEGREES = yawFlag >= 0 ? Number(flags[yawFlag + 1]) : 0;
const lookFlag = flags.indexOf("--look");
/** Where the CAMERA points, when that is not where the play area is centred. */
const LOOK = lookFlag >= 0 ? flags[lookFlag + 1].split(",").map(Number) : null;
const sizeFlag = flags.indexOf("--size");
/** The frame in pixels. The default is the look-check's own 900 by 700. */
const SIZE = sizeFlag >= 0 ? flags[sizeFlag + 1].split(",").map(Number) : [900, 700];
/**
 * --alpha writes RGBA and leaves every pixel nothing was drawn on transparent,
 * so a render can be composited onto something other than the pale room.
 */
const ALPHA = flags.includes("--alpha");

const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { tileStatsFor, paletteTexels, texelIndex, earthTexelIndex, PALETTE_TEXELS_ACROSS }
  = await import("../Assets/Scripts/world/VoxelPalette.ts");
const { detectStructures } = await import("../Assets/Scripts/world/Structures.ts");
const { shapeProfileFor } = await import("../Assets/Scripts/world/TileShapes.ts");
const { windowFor, windowForRect, buildColumnField, buildChunkGeometry, chunksForWindow,
        VOXELS_PER_TILE, VOXEL }
  = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const { chunkViewRect, clipQuads, rimQuads }
  = await import("../Assets/Scripts/world/ViewClip.ts");
const { chunkTilesFor, coverAround, coverChunks, earthSpanTilesFor, HALO_TILES }
  = await import("../Assets/Scripts/world/ChunkPlan.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const def = bundle.maps[mapId];
if (!def) {
  console.error("no such map: " + mapId);
  process.exit(2);
}
const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
const stats = tileStatsFor(bundle.tilesets[def.tileset]);
const profile = shapeProfileFor(map, stats);
const structures = detectStructures(map, stats, 0, 0, map.widthTiles - 1, map.heightTiles - 1,
                                    FLAT ? null : profile);
const centreX = FOCUS ? FOCUS[0] : map.widthTiles / 2;
const centreZ = FOCUS ? FOCUS[1] : map.heightTiles / 2;
// The second argument is tiles ACROSS, not a radius (see PlayArea): the
// preview wants a window a little wider than the frame it draws into.
//
// Under --play the field is built over the COVER instead, exactly as
// VoxelTerrain.followCover does: whole chunks a little wider than the view,
// with a halo so a chunk at the cover's edge still sees its neighbours.
const view = PLAY_TILES > 0 ? windowFor(map, PLAY_TILES, centreX, centreZ, 0, false) : null;
const cover = view
  ? coverAround(map.widthTiles, map.heightTiles, chunkTilesFor(PLAY_TILES),
                view.minTileX, view.minTileZ, view.maxTileX, view.maxTileZ)
  : null;
const window = cover
  ? windowForRect(map,
                  Math.max(0, cover.minTileX - HALO_TILES),
                  Math.max(0, cover.minTileZ - HALO_TILES),
                  Math.min(map.widthTiles - 1, cover.maxTileX + HALO_TILES),
                  Math.min(map.heightTiles - 1, cover.maxTileZ + HALO_TILES),
                  earthSpanTilesFor(map.widthTiles, map.heightTiles, PLAY_TILES), 0, false)
  : windowFor(map, Math.round(VIEW_TILES * 1.4), centreX, centreZ, 0, false);
const field = buildColumnField(map, stats, window, structures, profile, !FLAT);

// ---------------------------------------------------------------- palette

const texels = paletteTexels(bundle.tilePalettes, bundle.palettes[def.palette] ||
                             bundle.palettes[bundle.defaultPalette]);
/**
 * The colour at a UV, sampled the way the material samples it.
 *
 * Going through the UV rather than the palette index is what lets this draw
 * the mesh the lens actually builds -- folded facades, eaves, recessed
 * windows and all -- instead of a second, simpler picture of the same field.
 */
function sampleUv(u, v) {
  const col = Math.min(PALETTE_TEXELS_ACROSS - 1, Math.max(0, Math.floor(u * PALETTE_TEXELS_ACROSS)));
  // texelUv writes v = 1 - (row + 0.5)/N and the texture is stored with its
  // first row last, so the two flips cancel and the array row is v * N.
  const row = Math.min(PALETTE_TEXELS_ACROSS - 1, Math.max(0, Math.floor(v * PALETTE_TEXELS_ACROSS)));
  const at = (row * PALETTE_TEXELS_ACROSS + col) * 4;
  return [texels[at], texels[at + 1], texels[at + 2]];
}

// ------------------------------------------------------------------ camera
//
// The reference's own diorama rig (RESEARCH-voxel-mods-and-vr 2.2): tilted 35
// degrees from straight down, so 55 degrees above the horizon, looking north
// from the south. Orthographic, because a diorama on a table is small enough
// that perspective adds nothing to a still but arithmetic.

const PITCH = (PITCH_DEGREES * Math.PI) / 180;
/** How far a step north carries up the screen, and how far a step upward does. */
const DEPTH_RISE = Math.sin(PITCH);
const HEIGHT_RISE = Math.cos(PITCH);
const WIDTH = SIZE[0];
const HEIGHT = SIZE[1];
const SCALE = WIDTH / VIEW_TILES;
/** The focus, in the mesh's own coordinates: the map's centre is the origin. */
const focusX = (LOOK ? LOOK[0] : centreX) - map.widthTiles / 2;
const focusZ = (LOOK ? LOOK[1] : centreZ) - map.heightTiles / 2;

/**
 * Where the eye stands, in degrees round the model. Zero looks at the south
 * side square on, which is the reference's own still; a diorama on a table is
 * walked around, and its corners -- where two sides of the slab meet -- only
 * exist in a three-quarter view.
 */
const YAW = (YAW_DEGREES * Math.PI) / 180;
const YAW_COS = Math.cos(YAW);
const YAW_SIN = Math.sin(YAW);

/** The point turned into the eye's own axes: right, and away. */
function turn(x, z) {
  const dx = x - focusX;
  const dz = z - focusZ;
  return [dx * YAW_COS - dz * YAW_SIN, dx * YAW_SIN + dz * YAW_COS];
}

/** World (tile units, +Y up, +Z south) to screen pixels. */
function project(x, y, z) {
  const t = turn(x, z);
  const up = y * HEIGHT_RISE - t[1] * DEPTH_RISE;
  return [t[0] * SCALE + WIDTH / 2, HEIGHT * 0.58 - up * SCALE];
}

/**
 * Distance along the view ray: smaller is nearer the eye, so smaller wins the
 * depth test. High and to the south is near.
 */
function eyeDepth(x, y, z) {
  return -(y * DEPTH_RISE + turn(x, z)[1] * HEIGHT_RISE);
}

const pixels = new Uint8Array(WIDTH * HEIGHT * 3);
const depth = new Float64Array(WIDTH * HEIGHT).fill(Infinity);
// A pale room, so black geometry is visible and the eye reads it as a model
// standing on a table rather than as a hole.
for (let i = 0; i < WIDTH * HEIGHT; i++) {
  pixels[i * 3] = 232;
  pixels[i * 3 + 1] = 232;
  pixels[i * 3 + 2] = 236;
}

/**
 * One quad, flat-shaded, z-buffered PER PIXEL. Screen-space scanline over its
 * bounds.
 *
 * The depth was one number for the whole quad until 20 September, and a big
 * quad and a small one in front of it then sorted by their CENTRES: the slab's
 * underside, one quad over a whole chunk, painted black triangles through the
 * rim standing in front of it. Half an hour was spent looking for that hole in
 * the rim's geometry, which is exactly the kind of lie a look-check must not
 * tell.
 *
 * The projection is orthographic and every quad is planar, so the eye depth is
 * an affine function of the screen position and three corners fix it. The lens
 * has a real depth buffer; this now has one too.
 */
function fillQuad(points, rgb, depths) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const plane = depthPlane(points, depths);
  const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(WIDTH - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(HEIGHT - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(points, x + 0.5, y + 0.5)) continue;
      const at = y * WIDTH + x;
      const order = plane[0] * (x + 0.5) + plane[1] * (y + 0.5) + plane[2];
      if (order >= depth[at]) continue;
      depth[at] = order;
      pixels[at * 3] = rgb[0];
      pixels[at * 3 + 1] = rgb[1];
      pixels[at * 3 + 2] = rgb[2];
    }
  }
}

/**
 * The affine depth over a quad's screen footprint, as [a, b, c] in
 * `a*x + b*y + c`, from whichever three of its corners are not in a line.
 * A quad seen exactly edge-on has no footprint to fill, so its mean will do.
 */
function depthPlane(points, depths) {
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(det) < 1e-9) continue;
    const db = depths[(i + 1) % 4] - depths[i];
    const dc = depths[(i + 2) % 4] - depths[i];
    const ax = (db * (c[1] - a[1]) - dc * (b[1] - a[1])) / det;
    const ay = (dc * (b[0] - a[0]) - db * (c[0] - a[0])) / det;
    return [ax, ay, depths[i] - ax * a[0] - ay * a[1]];
  }
  return [0, 0, (depths[0] + depths[1] + depths[2] + depths[3]) / 4];
}

function inside(poly, x, y) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// ------------------------------------------------------------------- draw
//
// From buildChunkGeometry, not from the column field: the mesh the lens
// uploads, quad for quad. Anything this picture gets wrong is something the
// glasses would get wrong too, which is the whole point of having it.

let quads = 0;
/** Both buffers: the ground, and the blades of grass the wind moves. */
function drawBuffer(verts, count) {
  for (let q = 0; q < count; q++) {
    const corners = [];
    const depths = [];
    for (let k = 0; k < 4; k++) {
      const at = (q * 4 + k) * 5;
      corners.push(project(verts[at], verts[at + 1], verts[at + 2]));
      depths.push(eyeDepth(verts[at], verts[at + 1], verts[at + 2]));
    }
    const uvAt = q * 4 * 5;
    fillQuad(corners, sampleUv(verts[uvAt + 3], verts[uvAt + 4]), depths);
    quads++;
  }
}
if (view) {
  // What the lens EMITS: every chunk of the cover, cut to the view, with the
  // skirt of earth along the view's own edge. VoxelTerrain.emitChunk, without
  // the mesh upload.
  const chunkTiles = chunkTilesFor(PLAY_TILES);
  const originX = -map.widthTiles / 2;
  const originZ = -map.heightTiles / 2;
  for (const [cx, cz] of coverChunks(cover)) {
    const rect = chunkViewRect(view, cx, cz, chunkTiles, map.widthTiles, map.heightTiles);
    if (!rect) {
      continue;
    }
    const g = buildChunkGeometry(field, map, cx, cz, stats, chunkTiles);
    const cut = clipQuads(g.verts, g.indices, g.quads,
                          originX + rect.minTileX, originX + rect.maxTileX + 1,
                          originZ + rect.minTileZ, originZ + rect.maxTileZ + 1);
    rimQuads(field, rect, view, map.widthTiles, map.heightTiles, VOXELS_PER_TILE, cut);
    drawBuffer(cut.verts, cut.quads);
    const sway = clipQuads(g.swayVerts, g.swayIndices, g.swayQuads,
                           originX + rect.minTileX, originX + rect.maxTileX + 1,
                           originZ + rect.minTileZ, originZ + rect.maxTileZ + 1);
    drawBuffer(sway.verts, sway.quads);
  }
} else {
  for (const [cx, cz] of chunksForWindow(field.window)) {
    const geometry = buildChunkGeometry(field, map, cx, cz, stats);
    drawBuffer(geometry.verts, geometry.quads);
    // At rest: the wind is a transform on a SceneObject and this has none.
    drawBuffer(geometry.swayVerts, geometry.swayQuads);
  }
}

// -------------------------------------------------------------------- png

function png(width, height, rgb, drawn) {
  const channels = drawn ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * channels + 1)] = 0;
    if (!drawn) {
      Buffer.from(rgb.buffer, y * width * 3, width * 3)
        .copy(raw, y * (width * 3 + 1) + 1);
      continue;
    }
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw[o] = rgb[i * 3];
      raw[o + 1] = rgb[i * 3 + 1];
      raw[o + 2] = rgb[i * 3 + 2];
      raw[o + 3] = drawn[i] ? 255 : 0;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = drawn ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const drawnMask = ALPHA ? depth.map((d) => (d === Infinity ? 0 : 1)) : null;
writeFileSync(outPath, png(WIDTH, HEIGHT, pixels, drawnMask));
console.log(`${mapId} ${FLAT ? "FLAT" : "AUTHORED"}: ${quads} quads drawn -> ${outPath}`);
