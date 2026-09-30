// Cutting built chunks to the square the wearer sees.
//
// The terrain is built in CHUNKS on the map's own grid and streamed as the
// player walks; the square the wearer sees -- the play area, the plate -- is
// centred on the player and moves one tile per step. Before 11 September the
// two were the same rectangle: the drawn world WAS the cover, a square of whole
// chunks centred on the player's chunk, and it moved one chunk at a time. Every
// third step the whole edge of the world jumped six tiles, and the fourth
// playtest's recordings show it at every chunk boundary: "de game glitched heel
// de tijd als er een nieuwe chunk moet worden geladen".
//
// Now the cover is built a little wider than the view (ChunkPlan.LOOKAHEAD_
// TILES) and each chunk is EMITTED cut to the view. A chunk keeps the geometry
// it was built with, and when the view slides a tile the chunks along its
// edge are re-cut from that cache -- a filter over a few thousand quads, not a
// rebuild from the column field. The view's own edge gets a skirt of earth, so
// the cut reads as the side of a diorama and not as a hollow shell.
//
// Everything here is arithmetic over plain arrays, so it runs headless in
// test/viewclip.test.mjs against the same numbers the lens draws.

// Type-only from VoxelTerrain, on purpose: VoxelTerrain imports this module,
// and a value import back would make a cycle whose constants are undefined
// at load time under a CommonJS-style module loader.
import type { ColumnField } from "./VoxelTerrain";
import { texelUv, texelIndex, earthTexelIndex, bandForSide, BAND_TOP, BAND_UNDER }
  from "./VoxelPalette";
import { DEPTH_NEUTRAL } from "./VoxelDepth";

/** A rectangle of map tiles, inclusive on both ends. */
export interface TileRect {
  minTileX: number;
  minTileZ: number;
  maxTileX: number;
  maxTileZ: number;
}

/** The part of a chunk that lies inside the view, in tiles; null when none does. */
export function chunkViewRect(
  view: TileRect, chunkX: number, chunkZ: number, chunkTiles: number,
  widthTiles: number, heightTiles: number
): TileRect {
  const minX = Math.max(view.minTileX, chunkX * chunkTiles);
  const maxX = Math.min(view.maxTileX, (chunkX + 1) * chunkTiles - 1, widthTiles - 1);
  const minZ = Math.max(view.minTileZ, chunkZ * chunkTiles);
  const maxZ = Math.min(view.maxTileZ, (chunkZ + 1) * chunkTiles - 1, heightTiles - 1);
  if (minX > maxX || minZ > maxZ) {
    return null;
  }
  return { minTileX: minX, minTileZ: minZ, maxTileX: maxX, maxTileZ: maxZ };
}

export function sameRect(a: TileRect, b: TileRect): boolean {
  if (!a || !b) {
    return a === b;
  }
  return a.minTileX === b.minTileX && a.maxTileX === b.maxTileX &&
         a.minTileZ === b.minTileZ && a.maxTileZ === b.maxTileZ;
}

/** Whether a rect is the whole of a chunk, as far as the map goes. */
export function rectIsWholeChunk(
  rect: TileRect, chunkX: number, chunkZ: number, chunkTiles: number,
  widthTiles: number, heightTiles: number
): boolean {
  return rect.minTileX === chunkX * chunkTiles &&
         rect.minTileZ === chunkZ * chunkTiles &&
         rect.maxTileX === Math.min((chunkX + 1) * chunkTiles - 1, widthTiles - 1) &&
         rect.maxTileZ === Math.min((chunkZ + 1) * chunkTiles - 1, heightTiles - 1);
}

/** Interleaved vertices and triangle indices, the shape MeshBuilder takes. */
export interface CutGeometry {
  verts: number[];
  indices: number[];
  quads: number;
}

/**
 * The quads of a chunk that lie inside a box, in mesh units, the ones that
 * straddle its edge clamped to it.
 *
 * Vertices are interleaved x, y, z, u, v, four to a quad, six indices to a
 * quad in one of two windings (see pushQuad). Every quad this terrain emits is
 * axis-aligned and flat-coloured -- all four corners share one texel -- so a
 * straddling quad is clipped by moving its outside corners onto the edge and
 * nothing about its colour changes. A quad with NO extent inside the box is
 * dropped, which also drops a wall standing exactly ON the edge: the skirt
 * draws that plane instead, and two faces in one plane would fight.
 */
export function clipQuads(
  verts: number[], indices: number[], quads: number,
  x0: number, x1: number, z0: number, z1: number
): CutGeometry {
  const outVerts: number[] = [];
  const outIndices: number[] = [];
  let kept = 0;
  for (let q = 0; q < quads; q++) {
    const v = q * 20;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < 4; k++) {
      const x = verts[v + k * 5];
      const z = verts[v + k * 5 + 2];
      if (x < minX) { minX = x; }
      if (x > maxX) { maxX = x; }
      if (z < minZ) { minZ = z; }
      if (z > maxZ) { maxZ = z; }
    }
    // No extent strictly inside: gone. A cap ending ON the edge from inside
    // has minX < x1 and stays; a wall lying in the edge's plane has
    // minX === maxX === x1 and goes.
    if (maxX <= x0 || minX >= x1 || maxZ <= z0 || minZ >= z1) {
      continue;
    }
    const base = kept * 4;
    for (let k = 0; k < 4; k++) {
      const i = v + k * 5;
      let x = verts[i];
      let z = verts[i + 2];
      x = x < x0 ? x0 : x > x1 ? x1 : x;
      z = z < z0 ? z0 : z > z1 ? z1 : z;
      outVerts.push(x, verts[i + 1], z, verts[i + 3], verts[i + 4]);
    }
    const oldBase = q * 4;
    const t = q * 6;
    for (let k = 0; k < 6; k++) {
      outIndices.push(indices[t + k] - oldBase + base);
    }
    kept++;
  }
  return { verts: outVerts, indices: outIndices, quads: kept };
}

/** The wall index pattern pushQuad uses: two triangles facing away from the solid. */
function pushWallIndices(into: number[], base: number): void {
  into.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/** The cap pattern: a face whose four corners share a height. */
function pushCapIndices(into: number[], base: number): void {
  into.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * How far the slab's rim slopes out and down before it drops, in voxels.
 *
 * The reference's diorama is "een schuin afgesneden aardplak met bruine
 * zijkanten" -- a slanted-cut slab of earth with brown sides (clip 1, 25-56 s,
 * docs/RESEARCH-voxel-mods-and-vr.md) -- and this is that slant. Two voxels is
 * half a tile out and half a tile down: 45 degrees, the angle a model base is
 * chamfered at, and 1.75 cm on a 70 cm plate.
 *
 * It stands OUTSIDE the world rather than eating into it. Cutting the slope
 * from the last tile of ground would sink whatever is standing on it, and at a
 * map's edge that tile is walkable -- the player would stand in a ditch at the
 * rim of their own bedroom. Outside costs nothing but half a tile of table,
 * well inside DioramaGrab's rim band, which reaches 35 per cent of the
 * half-span past the plate on purpose.
 */
export const RIM_SLOPE_VOXELS: number = 2;

/** North, south, west, east: VoxelTerrain's own encoding, so the bands match. */
const SIDE_NORTH: number = 0;
const SIDE_SOUTH: number = 1;
const SIDE_WEST: number = 2;
const SIDE_EAST: number = 3;

/**
 * The rim of the diorama, for the part of one chunk that is in view: the face
 * the world was cut on, the slope under it, and the brown side below that.
 *
 * Two different edges end up here.
 *
 * **Where the VIEW cuts through the map** the columns just inside the cut are
 * open to the air on that side and nothing was ever built there: a chunk only
 * has walls where a column is taller than its neighbour, and the neighbour
 * across the view's edge is still standing, just not shown. So the cut face is
 * drawn here -- and it is drawn as a CROSS-SECTION, in the colour of whatever
 * was cut, rather than as the brown wall it was until 20 September. A sliced
 * desk that wears earth to the height of a desk is the "leeg object aan de
 * rand" the fifth playtest's screenshot shows; the same desk cut and capped in
 * its own colour reads as a model sawn through.
 *
 * **Where the MAP itself ends** the chunk already carries its wall, built
 * against the outside world, so only the slope and the side below it are added.
 *
 * Both get the same silhouette, because to a wearer walking round the table
 * they ARE the same thing: the edge of the model.
 */
export function rimQuads(
  field: ColumnField, rect: TileRect, view: TileRect,
  widthTiles: number, heightTiles: number, voxelsPerTile: number, into: CutGeometry
): void {
  const VOXELS_PER_TILE = voxelsPerTile;
  const VOXEL = 1 / voxelsPerTile;
  const w = field.window;
  const originX = -widthTiles / 2;
  const originZ = -heightTiles / 2;
  const floor = -w.earthVoxels;
  const at = (c: number, r: number): number => r * field.cols + c;
  const outside = (c: number, r: number): boolean =>
    c < 0 || r < 0 || c >= field.cols || r >= field.rows ||
    (field.cut && field.cut[at(c, r)] ? true : false);
  const heightAt = (c: number, r: number): number =>
    outside(c, r) ? floor : field.heights[at(c, r)];
  const floorY = floor * VOXEL;

  /** One face, from four corners given in order. Walls and slopes wind alike. */
  const face = (p: number[][], uv: number[]): void => {
    const base = into.quads * 4;
    for (let k = 0; k < 4; k++) {
      into.verts.push(p[k][0], p[k][1], p[k][2], uv[0], uv[1]);
    }
    const cap = p[0][1] === p[1][1] && p[0][1] === p[2][1] && p[0][1] === p[3][1];
    if (cap) {
      pushCapIndices(into.indices, base);
    } else {
      pushWallIndices(into.indices, base);
    }
    into.quads++;
  };

  /**
   * The cut face of one voxel column: the thing the view sawed through, in its
   * own colour, from the ground up.
   *
   * Only where the VIEW cuts the map. Where the map itself ends, the chunk has
   * already drawn this face against the outside world.
   */
  const crossSection = (c: number, r: number, side: number,
                        ix: number, iz: number, ax: number, az: number): void => {
    const h = heightAt(c, r);
    if (h <= 0) {
      return;
    }
    const key = field.keys[at(c, r)];
    const uv = texelUv(texelIndex(key >> 2, key & 3, bandForSide(side), DEPTH_NEUTRAL));
    face([[ix, 0, iz], [ix + ax, 0, iz + az],
          [ix + ax, h * VOXEL, iz + az], [ix, h * VOXEL, iz]], uv);
  };

  /** Ground level of a column: zero under anything standing, the surface itself
   *  for water and dug ground, and null where the column is not in the world. */
  const groundOf = (c: number, r: number): number => {
    const h = heightAt(c, r);
    if (h <= floor) {
      return floor - 1;
    }
    return h < 0 ? h : 0;
  };

  /**
   * The slope and the brown side under a RUN of columns that agree.
   *
   * Run, not column, because a rim is mostly flat: one quad over a whole tile
   * of level ground instead of four. Measured over the 222 maps at the widest
   * rung this is the difference between a rim that costs a thousand quads and
   * one that costs two hundred, on a budget with two per cent of headroom.
   *
   * `a` and `b` are the ends along the plane, already carrying the corner's
   * reach; `outX`/`outZ` point away from the world.
   */
  const slopeRun = (side: number, ground: number, parity: number,
                    ax: number, az: number, bx: number, bz: number,
                    outX: number, outZ: number): void => {
    const drop = Math.min(RIM_SLOPE_VOXELS, ground - floor);
    const dx = outX * drop * VOXEL;
    const dz = outZ * drop * VOXEL;
    const lipY = (ground - drop) * VOXEL;
    if (drop > 0) {
      face([[ax, ground * VOXEL, az], [bx, ground * VOXEL, bz],
            [bx + dx, lipY, bz + dz], [ax + dx, lipY, az + dz]],
           texelUv(earthTexelIndex(parity, BAND_TOP)));
    }
    if (lipY > floorY) {
      face([[ax + dx, floorY, az + dz], [bx + dx, floorY, bz + dz],
            [bx + dx, lipY, bz + dz], [ax + dx, lipY, az + dz]],
           texelUv(earthTexelIndex(parity, bandForSide(side))));
    }
  };

  /** The underside of the slope, so the slab is closed when seen from below. */
  const lip = (x0: number, z0: number, x1: number, z1: number): void => {
    face([[x0, floorY, z0], [x1, floorY, z0], [x1, floorY, z1], [x0, floorY, z1]],
         texelUv(earthTexelIndex(1, BAND_UNDER)));
  };

  /**
   * One side of the rim, walked column by column.
   *
   * `alongX` is true for the north and south sides, whose plane runs along X.
   * `plane` is the other coordinate, `out` which way is away from the world,
   * and `back`/`front` how far the slope reaches past either end into a
   * corner. Columns are walked in the field's own order; which end is "back"
   * is the low end of that order.
   */
  const rimSide = (side: number, cut: boolean, alongX: boolean, plane: number,
                   out: number, first: number, last: number, fixed: number,
                   alongOrigin: number, back: number, front: number): void => {
    const outX = alongX ? 0 : out;
    const outZ = alongX ? out : 0;
    const colOf = (k: number): number => (alongX ? k : fixed);
    const rowOf = (k: number): number => (alongX ? fixed : k);
    const px = (along: number): number => (alongX ? along : plane);
    const pz = (along: number): number => (alongX ? plane : along);
    let runFrom = -1;
    let runGround = 0;
    let runParity = 0;
    const flush = (until: number): void => {
      if (runFrom < 0) {
        return;
      }
      const a = alongOrigin + runFrom * VOXEL - (runFrom === first ? back : 0);
      const b = alongOrigin + until * VOXEL + (until === last + 1 ? front : 0);
      slopeRun(side, runGround, runParity, px(a), pz(a), px(b), pz(b), outX, outZ);
      runFrom = -1;
    };
    for (let k = first; k <= last; k++) {
      const c = colOf(k);
      const r = rowOf(k);
      const along = alongOrigin + k * VOXEL;
      if (cut) {
        crossSection(c, r, side, px(along), pz(along),
                     alongX ? VOXEL : 0, alongX ? 0 : VOXEL);
      }
      const ground = groundOf(c, r);
      const parity = ((c >> 2) + (r >> 2)) & 1;
      if (ground < floor) {
        flush(k);
        continue;
      }
      if (runFrom >= 0 && (ground !== runGround || parity !== runParity)) {
        flush(k);
      }
      if (runFrom < 0) {
        runFrom = k;
        runGround = ground;
        runParity = parity;
      }
    }
    flush(last + 1);
  };

  const cFirst = (rect.minTileX - w.minTileX) * VOXELS_PER_TILE;
  const cLast = (rect.maxTileX - w.minTileX + 1) * VOXELS_PER_TILE - 1;
  const rFirst = (rect.minTileZ - w.minTileZ) * VOXELS_PER_TILE;
  const rLast = (rect.maxTileZ - w.minTileZ + 1) * VOXELS_PER_TILE - 1;
  const slope = RIM_SLOPE_VOXELS * VOXEL;
  const alongX0 = originX + w.minTileX;
  const alongZ0 = originZ + w.minTileZ;

  // Which of this chunk's own sides are the rim. A corner chunk owns two of
  // them, and its last run has to carry the slope round the corner or the
  // bevel ends in a notch where the two meet. The two slopes cross over the
  // corner square, which is what a mitre looks like: a diagonal ridge.
  const east = rect.maxTileX === view.maxTileX;
  const west = rect.minTileX === view.minTileX;
  const south = rect.maxTileZ === view.maxTileZ;
  const north = rect.minTileZ === view.minTileZ;
  const backZ = north ? slope : 0;
  const frontZ = south ? slope : 0;
  const backX = west ? slope : 0;
  const frontX = east ? slope : 0;

  if (east) {
    const x1 = originX + rect.maxTileX + 1;
    rimSide(SIDE_EAST, view.maxTileX < widthTiles - 1, false, x1, 1,
            rFirst, rLast, cLast, alongZ0, backZ, frontZ);
    // The underside of the slope. Only the east and west lips reach into the
    // corners: two lips over one square would be coplanar and fight.
    lip(x1, originZ + rect.minTileZ - backZ, x1 + slope, originZ + rect.maxTileZ + 1 + frontZ);
  }
  if (west) {
    const x0 = originX + rect.minTileX;
    rimSide(SIDE_WEST, view.minTileX > 0, false, x0, -1,
            rFirst, rLast, cFirst, alongZ0, backZ, frontZ);
    lip(x0 - slope, originZ + rect.minTileZ - backZ, x0, originZ + rect.maxTileZ + 1 + frontZ);
  }
  if (south) {
    const z1 = originZ + rect.maxTileZ + 1;
    rimSide(SIDE_SOUTH, view.maxTileZ < heightTiles - 1, true, z1, 1,
            cFirst, cLast, rLast, alongX0, backX, frontX);
    lip(originX + rect.minTileX, z1, originX + rect.maxTileX + 1, z1 + slope);
  }
  if (north) {
    const z0 = originZ + rect.minTileZ;
    rimSide(SIDE_NORTH, view.minTileZ > 0, true, z0, -1,
            cFirst, cLast, rFirst, alongX0, backX, frontX);
    lip(originX + rect.minTileX, z0 - slope, originX + rect.maxTileX + 1, z0);
  }
}
