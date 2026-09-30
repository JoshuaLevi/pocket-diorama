import type { SightPoint, FaceBound } from "./VisibilityCutaway";
import { faceBounds, occludingFaces, splitFaces } from "./VisibilityCutaway";
// The world as pixel voxels: every pixel of every tile is a coloured column.
//
// The reference footage reads as a diorama because it is built this way. A
// tile is not a box with a picture on it; its pixels stand up, each its own
// colour, lighter ones a cube higher, so a path is a bed of purple studs, a
// roof is rows of tiles and a tree is a lumpy green blob. Nothing here is a
// texture except a 16x16 palette, and nothing is hand-authored per tile: the
// height comes from the tileset's own walkable list, the category the bundle
// already carries, and the pixel's shade.
//
// Geometry is chunked. One mesh holds at most 16 383 quads (MeshBuilder is
// 16-bit indexed), a town is ten times that, so the window around the player
// is cut into 8x8-tile chunks, each its own mesh, built as they come into the
// window and dropped as they leave. The pure half -- heights, colours, quads
// -- is here and testable in Node; the scene half at the bottom only turns
// chunk geometry into RenderMeshVisuals.

import type { MapRuntime } from "./MapRuntime";
import { slideSpan } from "./PlayArea";
import type { TileStats } from "./VoxelPalette";
import type { StructureField } from "./Structures";
import { detectStructures, facadeTileY, roofTileY, roofDropRows, structureBuiltAt, INDOOR_FURNITURE_ROWS } from "./Structures";
import { indoorRecolour, indoorSunk, INDOOR_BAND_TILES } from "./IndoorKinds";
import {
  tileShade, categoryIndexOf, texelIndex, texelUv, earthTexelIndex,
  BAND_TOP, BAND_FLOOR, BAND_UNDER, BAND_SHADOW, CATEGORY_MAP, bandForSide,
} from "./VoxelPalette";
import { tileLift, depthIndex, topOcclusion, sideOcclusion, DEPTH_NEUTRAL } from "./VoxelDepth";
import type { ChunkCover } from "./ChunkPlan";
import {
  coverChunks, coverDelta, coverContains, earthSpanTilesFor, chunkTilesFor,
  streamsIncrementally, HALO_TILES, coverHasTile, coverAround, sameCover } from "./ChunkPlan";
import type { TileRect } from "./ViewClip";
import { chunkViewRect, sameRect, rectIsWholeChunk, clipQuads, rimQuads } from "./ViewClip";
import type { ShapeProfile } from "./TileShapes";
import {
  shapeProfileFor, shapeForCell, propAxis, canopyHeight, standingProfile,
  standingHeightAt, standingBand, propGroundTile, tuftHeight, blockInk,
  SHAPE_CANOPY, SHAPE_HEDGE, SHAPE_STANDING, SHAPE_TUFT, SHAPE_LIP, SHAPE_FLAT,
  TUFT_VOXELS, LEDGE_VOXELS, AXIS_EW, isOutdoors,
} from "./TileShapes";

/** Voxels along one tile edge: a 2x2 pixel block per column. */
export const VOXELS_PER_TILE: number = 4;
/** One voxel's edge in tile units. A voxel is a cube: heights are in these too. */
export const VOXEL: number = 1 / VOXELS_PER_TILE;
/** Chunk edge, in tiles. 32x32 columns: at most 1024 tops and their sides. */
export const CHUNK_TILES: number = 8;

/** Column bases, in voxels, before the pixel's relief. */
export const BASE_GROUND: number = 0;
export const BASE_LEDGE: number = 1;
export const BASE_LOW: number = 2;
export const BASE_TREE: number = 3;
export const BASE_TALL: number = 5;
export const BASE_WATER: number = -1;

/**
 * How far the earth extends below the world, in tiles, as a fraction of the
 * window's short side. A fixed depth was a plinth under a route and a pillar
 * under a bedroom.
 */
const EARTH_FRACTION: number = 0.15;
const EARTH_MIN_TILES: number = 0.5;
const EARTH_MAX_TILES: number = 2;

/**
 * World curvature, the reference's V-CURVE: off through five. Each level is
 * how far, as a fraction of the window's half-extent, the furthest edge is
 * pulled down. Baked into the vertices, because a graph shader does not
 * survive the 5.15 downgrade and the mesh is CPU geometry already.
 */
const CURVE_LEVELS: number[] = [0, 0.12, 0.28, 0.5, 0.85, 1.4];

/**
 * How wide the soft rim is, as a fraction of the window's half-extent. The
 * reference uses the same sixteen per cent, and for the same reason: a hard
 * edge across a bent world is a lie about what is being looked at.
 */
const EDGE_FADE_FRACTION: number = 0.16;

/**
 * How far the rim sinks below the ground at the very edge, in tiles, on top
 * of the earth already under the window. Enough that the slab rolls off into
 * its own base instead of ending in a wall.
 */
const EDGE_SINK_TILES: number = 1.5;

/**
 * The rim: how far a column sinks, in voxels, because it is near the edge of
 * the built world.
 *
 * Measured RADIALLY, so the rectangle the window is cut from comes out
 * round. On a flat screen a hard rectangular edge earns its keep -- that
 * edge IS the sides of the slab. A tabletop model is walked around, and its
 * corner seams show the moment the wearer moves, so the rim is a curve.
 *
 * We cannot fade a fragment to nothing without a shader the 5.15 runtime
 * would not take, so the dissolve is geometry: the outer band steps down
 * into the earth and the world rolls off rather than stopping.
 */
export function edgeDrop(
  x: number, z: number, radius: number, earthVoxels: number, soft: boolean
): number {
  if (!soft || radius <= 0) {
    return 0;
  }
  const d = Math.sqrt(x * x + z * z) / radius;
  const start = 1 - EDGE_FADE_FRACTION;
  if (d <= start) {
    return 0;
  }
  let t = (d - start) / EDGE_FADE_FRACTION;
  if (t > 1) {
    t = 1;
  }
  return t * t * (earthVoxels + EDGE_SINK_TILES * VOXELS_PER_TILE);
}

/**
 * Whether a column is outside the round world entirely and should not be
 * built at all.
 *
 * Sinking the rim was not enough: a square slab with its corners drooping is
 * still a square, and the reference's boundary is a circle the moment the
 * world is curved. So past the radius nothing is drawn, and the last band
 * before it sinks -- together those read as a model that stops rather than a
 * map that was cut out with scissors.
 */
export function edgeCut(x: number, z: number, radius: number, soft: boolean): boolean {
  if (!soft || radius <= 0) {
    return false;
  }
  return Math.sqrt(x * x + z * z) >= radius;
}

/**
 * How deep a window pane or a doorway sits behind the wall around it, in
 * voxels. Less than a whole one: the wall is a single course thick, and a
 * full voxel would put the pane out through the back of it.
 */
const RECESS_VOXELS: number = 0.6;

/**
 * How far a shadow reaches, in voxels.
 *
 * The sun hangs south-east, which is the direction the whole palette's face
 * shading was measured for, so a shadow runs north-west: from a column toward
 * (c + k, r + k) at one voxel of height per step. Six voxels is a tile and a
 * half, which is as far as a full-height tree's shadow can be seen before the
 * next thing is casting one anyway -- and it caps the work at six lookups a
 * column, done once when a chunk is built and never again.
 */
const SHADOW_REACH: number = 6;

/** Curvature drop at a point, in tile units, from the window's centre. */
export function curveDrop(x: number, z: number, halfExtent: number, level: number): number {
  const index = level < 0 ? 0 : level >= CURVE_LEVELS.length ? CURVE_LEVELS.length - 1 : level;
  const strength = CURVE_LEVELS[index];
  if (strength === 0 || halfExtent <= 0) {
    return 0;
  }
  const d2 = (x * x + z * z) / (halfExtent * halfExtent);
  return -strength * halfExtent * d2;
}

/**
 * The play area's size lives in PlayArea.ts, in tiles ACROSS, under a name
 * that says so. What stood here was `RENDER_DISTANCES = [8, 12, 16, 24]`, a
 * RADIUS ladder whose name said neither -- so its tightest rung, the default
 * every playtest ran on, drew 17 tiles across a plate meant to hold 20.
 */

/** The rectangle of tiles being built, and what bends and lies under it. */
export interface TerrainWindow {
  minTileX: number;
  minTileZ: number;
  maxTileX: number;
  maxTileZ: number;
  /** The bend's centre, in mesh-local tile units. */
  centreX: number;
  centreZ: number;
  halfExtent: number;
  curveLevel: number;
  /** True when the world's rim rolls off into its base instead of ending flat. */
  softEdge: boolean;
  /**
   * The round world's radius, in tiles: the window's INSCRIBED circle, so a
   * disc cut from it loses the corners and keeps the whole of the shorter
   * side. Only read while softEdge is on.
   */
  cutRadius: number;
  /** Earth below the window, in voxels. */
  earthVoxels: number;
}

/**
 * The window for a focus tile: a SQUARE of `windowTilesAcross` around the
 * focus, slid back onto the map at an edge rather than clipped against it,
 * and the whole map when the window is bigger than the map or switched off
 * with a count of zero or less. See PlayArea.slideSpan for why it slides.
 *
 * The bend is measured from the window's own centre so a Flash window bends
 * like a window and a bedroom bends like a bedroom.
 */
export function windowFor(
  map: MapRuntime, windowTilesAcross: number, focusTileX: number, focusTileZ: number,
  curveLevel: number, softEdge: boolean
): TerrainWindow {
  const width = map.widthTiles;
  const depth = map.heightTiles;
  // The play area slides back onto the map at an edge instead of shrinking, and
  // the earth's depth is measured from the span it ASKED for rather than from
  // the rectangle it got -- see earthSpanTilesFor. A depth that changed as the
  // window slid would invalidate every chunk already built, which is the whole
  // thing the streaming rebuild is here to avoid.
  const spanTilesX = slideSpan(focusTileX, windowTilesAcross, width);
  const spanTilesZ = slideSpan(focusTileZ, windowTilesAcross, depth);
  return windowForRect(map, spanTilesX.min, spanTilesZ.min, spanTilesX.max, spanTilesZ.max,
                       earthSpanTilesFor(width, depth, windowTilesAcross),
                       curveLevel, softEdge);
}

/**
 * The window over an explicit rectangle of tiles.
 *
 * `earthSpanTiles` is the span the plinth's depth is measured from, and is
 * passed in rather than taken from the rectangle because the streaming window
 * needs it to HOLD STILL. The earth depth is baked into every chunk -- the
 * floor quad sits on it and every wall runs down to it -- so a depth that
 * shrinks as the window is clamped against a map edge silently invalidates
 * every chunk that was already built. `windowFor` passes the rectangle's own
 * short side, which is what it always measured.
 */
export function windowForRect(
  map: MapRuntime, minTileX: number, minTileZ: number, maxTileX: number, maxTileZ: number,
  earthSpanTiles: number, curveLevel: number, softEdge: boolean
): TerrainWindow {
  const width = map.widthTiles;
  const depth = map.heightTiles;
  const spanX = maxTileX - minTileX + 1;
  const spanZ = maxTileZ - minTileZ + 1;
  let earthTiles = earthSpanTiles * EARTH_FRACTION;
  earthTiles = earthTiles < EARTH_MIN_TILES ? EARTH_MIN_TILES
    : earthTiles > EARTH_MAX_TILES ? EARTH_MAX_TILES : earthTiles;
  return {
    minTileX: minTileX, minTileZ: minTileZ, maxTileX: maxTileX, maxTileZ: maxTileZ,
    centreX: -width / 2 + (minTileX + maxTileX + 1) / 2,
    centreZ: -depth / 2 + (minTileZ + maxTileZ + 1) / 2,
    halfExtent: Math.max(spanX, spanZ) / 2,
    curveLevel: curveLevel,
    softEdge: softEdge === true,
    cutRadius: Math.min(spanX, spanZ) / 2,
    earthVoxels: Math.round(earthTiles * VOXELS_PER_TILE),
  };
}

/** Which chunks (in chunk coordinates) a window touches. */
export function chunksForWindow(window: TerrainWindow): number[][] {
  const out: number[][] = [];
  const c0x = Math.floor(window.minTileX / CHUNK_TILES);
  const c1x = Math.floor(window.maxTileX / CHUNK_TILES);
  const c0z = Math.floor(window.minTileZ / CHUNK_TILES);
  const c1z = Math.floor(window.maxTileZ / CHUNK_TILES);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      out.push([cx, cz]);
    }
  }
  return out;
}

/**
 * Every column of a window: its height in voxels and its colour key.
 *
 * Height, per tile first: a cell the player cannot stand on is an obstacle.
 * Water sinks; a tree is a lump; an obstacle whose four neighbours are also
 * obstacles is interior mass and rises to a storey; anything else stands a
 * step. Then per pixel: a pixel lighter than its tile's usual shade stands a
 * cube higher, and on an obstacle a darker one sits a cube lower, which is
 * what turns a window outline into a groove and a roof stripe into a tile.
 * The ground never dips below its base: nothing walks on a pit.
 */
export interface ColumnField {
  cols: number;
  rows: number;
  /** Column heights in voxels; index row * cols + col. */
  heights: Int8Array;
  /** Palette texel key: categoryIndex * 4 + shade. */
  keys: Uint8Array;
  /** 1 where the column falls outside the round world and is not built. */
  cut: Uint8Array;
  /**
   * Height in tile rows of the structure this column belongs to, 0 when it
   * belongs to none. Non-zero means the column is part of a measured volume
   * and its south face folds the drawing up instead of showing one colour.
   */
  structRows: Int8Array;
  /**
   * 1 where the column is DECORATION standing on the ground rather than the
   * ground itself: a blade of tall grass, a fence post, a flower.
   *
   * Two bits. DECOR_STANDS says a character walks UNDER this rather than on
   * top of it, which is what keeps someone in tall grass at the height of the
   * field instead of on the tips of it. DECOR_SWAYS says the wind moves it:
   * blades of grass do, fence posts do not.
   */
  decor: Uint8Array;
  /**
   * For a prop's plate, the tile row whose drawing its south face folds up
   * from -- its own cell's southmost row. -1 everywhere else.
   *
   * Without this a fence post is one flat colour, and the colour it picks is
   * the majority of its ink, which for tile 14 is the black OUTLINE: a row of
   * black slabs. Folding the drawing up instead gives every voxel the colour
   * the artist put there, which is the reference's own rule -- the sprite is
   * ground truth -- and it is what turns the plate back into posts.
   */
  decorFront: Int16Array;
  window: TerrainWindow;
  /** The structures the field was built against; null when none were detected. */
  structures: StructureField;
}

/**
 * The palette key of one 2x2-pixel block of a tile: its most common shade,
 * ties to the darker, in its tile's category.
 */
export function blockKey(stats: TileStats, tile: number, vx: number, vz: number): number {
  const pixelsPerVoxel = 8 / VOXELS_PER_TILE;
  const counts = [0, 0, 0, 0];
  for (let py = 0; py < pixelsPerVoxel; py++) {
    for (let px = 0; px < pixelsPerVoxel; px++) {
      counts[tileShade(stats, tile, vx * pixelsPerVoxel + px, vz * pixelsPerVoxel + py)]++;
    }
  }
  let shade = 0;
  for (let sh = 1; sh < 4; sh++) {
    if (counts[sh] >= counts[shade]) {
      shade = sh;
    }
  }
  const categoryName = tile < stats.categories.length ? stats.categories[tile] : "";
  const category = stats.categories.length > 0 ? categoryIndexOf(categoryName) : CATEGORY_MAP;
  return category * 4 + shade;
}

function tileBase(map: MapRuntime, stats: TileStats, tx: number, tz: number): number {
  const cx = tx >> 1;
  const cy = tz >> 1;
  const tile = map.tileAt(tx, tz);
  const category = tile < stats.categories.length ? stats.categories[tile] : "";
  if (map.isWalkable(cx, cy)) {
    return BASE_GROUND;
  }
  if (category === "WATER") {
    return BASE_WATER;
  }
  if (category === "TREE") {
    return BASE_TREE;
  }
  if (category === "LEDGE") {
    return BASE_LEDGE;
  }
  const blocked = (ox: number, oy: number): boolean => {
    const ncx = cx + ox;
    const ncy = cy + oy;
    if (ncx < 0 || ncy < 0 || ncx >= map.widthCells || ncy >= map.heightCells) {
      return true;
    }
    return !map.isWalkable(ncx, ncy);
  };
  const enclosed = blocked(0, -1) && blocked(0, 1) && blocked(-1, 0) && blocked(1, 0);
  return enclosed ? BASE_TALL : BASE_LOW;
}

export function buildColumnField(
  map: MapRuntime, stats: TileStats, window: TerrainWindow, structures: StructureField,
  profile: ShapeProfile = null, shapes: boolean = false
): ColumnField {
  const tilesX = window.maxTileX - window.minTileX + 1;
  const tilesZ = window.maxTileZ - window.minTileZ + 1;
  const cols = tilesX * VOXELS_PER_TILE;
  const rows = tilesZ * VOXELS_PER_TILE;
  const heights = new Int8Array(cols * rows);
  const keys = new Uint8Array(cols * rows);
  const structRows = new Int8Array(cols * rows);
  const decor = new Uint8Array(cols * rows);
  const decorFront = new Int16Array(cols * rows);
  decorFront.fill(-1);
  const cut = new Uint8Array(cols * rows);
  const pixelsPerVoxel = 8 / VOXELS_PER_TILE;
  const authored = shapes && profile !== null;
  // The shape of a CELL is asked four times, once per tile of it, and the
  // answer costs a flood of category lookups. Two tiles of memo -- the last
  // cell asked about and what it said -- turn that back into one, because the
  // loop below walks tiles in order and a cell's four tiles are adjacent.
  let memoCell = -1;
  let memoShape = 0;
  let memoAxis = AXIS_EW;
  let memoProfile: Int8Array = null;
  let memoGround = 0;

  // Indoors the built volumes are shell or furniture (Structures.ts), and
  // only furniture changes colour; read the map's own answer once.
  const outdoors = isOutdoors(map);
  // ...and what IndoorKinds names -- a PC, a bed, a plant, a stone floor --
  // wears its kind's colour wherever its tile is drawn, volume or ground.
  // A tile may have a second word below the room's band (a mart's counter
  // top is the band's own tile), so there are two tables and the tile's row
  // picks one.
  const tilesetId: string = map.tileset && map.tileset.id ? map.tileset.id : "";
  const recolour = outdoors ? null : indoorRecolour(tilesetId, stats.tileCount, categoryIndexOf);
  const recolourBelow = outdoors ? null : indoorRecolour(tilesetId, stats.tileCount, categoryIndexOf, true);
  // ...and what it names SUNK -- a gym's pool -- lies level, below the floor.
  const sunk = outdoors ? null : indoorSunk(tilesetId, stats.tileCount);
  const paint = (key: number, tileId: number, tileRow: number): number => {
    const table = tileRow >= INDOOR_BAND_TILES ? recolourBelow : recolour;
    return table && tileId < table.length && table[tileId] >= 0 ? table[tileId] * 4 + (key & 3) : key;
  };
  for (let tz = 0; tz < tilesZ; tz++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const mapTx = window.minTileX + tx;
      const mapTz = window.minTileZ + tz;
      const tile = map.tileAt(mapTx, mapTz);
      const standing = tileBase(map, stats, mapTx, mapTz);
      // A pool is water wherever it is drawn: level, and one voxel below the
      // floor, exactly as a pond lies below its bank outdoors.
      const pool = sunk !== null && tile < sunk.length && sunk[tile] === 1 && standing > BASE_GROUND;
      const base = pool ? BASE_WATER : standing;
      const usual = tile < stats.tileCount ? stats.majority[tile] : 0;
      const categoryName = tile < stats.categories.length ? stats.categories[tile] : "";
      const category = stats.categories.length > 0 ? categoryIndexOf(categoryName) : CATEGORY_MAP;
      const flat = categoryName === "WATER" || pool;
      const obstacle = base > BASE_GROUND;

      // A measured volume: the whole tile stands at one height, its top wears
      // the roof rows cycled over the footprint, and its south face folds the
      // drawing up (see buildChunkGeometry). Nothing per-pixel survives here
      // -- that is the point, and it is what turns a mound into a house.
      const volumeRows = structures ? structureRowsOf(structures, mapTx, mapTz) : 0;

      // ------------------------------------------------ the shape library
      //
      // Every tile the map has, read as what it is DRAWN as rather than as a
      // height map: a tree, a hedge, a prop, a blade of grass, a ledge, the
      // ground. Only SHAPE_MASS falls through to what came before -- a
      // measured building, or the per-pixel extrusion under it.
      //
      // This runs BEFORE the volume branch, because a hedge is a measured
      // two-row structure and has to be able to take it away. See
      // world/TileShapes.ts.
      if (authored) {
        const cellX = mapTx >> 1;
        const cellZ = mapTz >> 1;
        const cellKey = cellZ * map.widthCells + cellX;
        if (cellKey !== memoCell) {
          memoCell = cellKey;
          memoShape = shapeForCell(map, stats, profile, cellX, cellZ, volumeRows);
          memoAxis = AXIS_EW;
          memoProfile = null;
          memoGround = 0;
          if (memoShape === SHAPE_STANDING) {
            memoAxis = propAxis(map, stats, profile, cellX, cellZ);
            memoProfile = standingProfile(map, stats, profile, cellX, cellZ);
            memoGround = propGroundTile(map, cellX, cellZ);
          }
        }
        // Where in the CELL this tile sits: a cell is two tiles square and
        // every shape below is drawn across the whole of one.
        const hx = (mapTx & 1) * VOXELS_PER_TILE;
        const hz = (mapTz & 1) * VOXELS_PER_TILE;

        if (memoShape === SHAPE_CANOPY || memoShape === SHAPE_HEDGE) {
          // A tree or a hedge: a round stepped hull over the cell, never below
          // the rim, so a border treeline stays a wall and a lone bush is a
          // ball.
          //
          // A hedge is repainted as foliage. Its tiles are STRUCTURE because
          // the baker's rule is "not walkable, outdoors, not on the cut-tree
          // list", so Route 1's 52 bushes wore building cream. Our colours do
          // not come from the sprite -- Gen 1 is four greys -- they come from a
          // category, so which category a thing belongs to IS the colour
          // decision, and foliage belongs with the trees.
          const foliage = memoShape === SHAPE_HEDGE ? categoryIndexOf("TREE") : -1;
          for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
            for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
              const i = (tz * VOXELS_PER_TILE + vz) * cols + tx * VOXELS_PER_TILE + vx;
              heights[i] = canopyHeight(hx + vx, hz + vz);
              const block = blockKey(stats, tile, vx, vz);
              keys[i] = foliage >= 0 ? foliage * 4 + (block & 3) : block;
            }
          }
          continue;
        }

        if (memoShape === SHAPE_STANDING) {
          // A prop: the drawing stands up in a thin plate through the middle
          // of the cell, and the rest of the cell is the ground it stands on.
          for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
            for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
              const u = hx + vx;
              const v = hz + vz;
              const along = memoAxis === AXIS_EW ? u : v;
              const across = memoAxis === AXIS_EW ? v : u;
              const i = (tz * VOXELS_PER_TILE + vz) * cols + tx * VOXELS_PER_TILE + vx;
              const stand = standingBand(across) ?
                            standingHeightAt(memoProfile, memoAxis, along) : 0;
              if (stand > 0) {
                heights[i] = stand;
                keys[i] = category * 4 + profile.inkShade[tile];
                decor[i] = DECOR_STANDS;
                decorFront[i] = cellZ * 2 + 1;
              } else {
                heights[i] = BASE_GROUND;
                keys[i] = blockKey(stats, memoGround, vx, vz);
              }
            }
          }
          continue;
        }

        if (memoShape === SHAPE_TUFT) {
          // Tall grass: the blades the artist drew stand up, at two heights so
          // the top of a patch is not a flat lid, and the gaps between them
          // stay ground. You walk between them, not on top of them.
          for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
            for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
              const i = (tz * VOXELS_PER_TILE + vz) * cols + tx * VOXELS_PER_TILE + vx;
              keys[i] = paint(blockKey(stats, tile, vx, vz), tile, mapTz);
              const blade = tuftHeight(blockInk(stats, tile, vx, vz));
              heights[i] = blade;
              // A blade of ANY height is something standing on the ground, not
              // the ground: a character wades through tall grass rather than
              // climbing onto it. Leaving the low half as a walking surface
              // meant stepping from lawn into grass moved the sprite up a
              // voxel, and 7.4% of the steps on Route 1 still popped like that
              // after the ground was flattened. Only a FULL blade sways; a low
              // one is texture with no wind in it.
              decor[i] = blade === 0 ? 0
                       : blade >= TUFT_VOXELS ? DECOR_STANDS | DECOR_SWAYS
                       : DECOR_STANDS;
            }
          }
          continue;
        }

        if (memoShape === SHAPE_FLAT) {
          // Ground is FLAT. The relief rule -- a pixel lighter than its tile's
          // usual shade stands a cube proud -- was written for obstacles, where
          // it turns a window outline into a groove and a roof stripe into a
          // tile. On ground it turns every speck of the dither into a stud:
          // Route 1's verge is tile 44, whose majority shade is 1, so all 5,232
          // of its white specks stood up and the whole route read as a shag
          // carpet rather than as a field.
          //
          // The reference pins ground at 0 world pixels. So do we now, and it
          // takes geometry away rather than adding it: a level cell emits four
          // side faces at its border and none inside.
          for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
            for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
              const i = (tz * VOXELS_PER_TILE + vz) * cols + tx * VOXELS_PER_TILE + vx;
              heights[i] = BASE_GROUND;
              keys[i] = paint(blockKey(stats, tile, vx, vz), tile, mapTz);
            }
          }
          continue;
        }

        if (memoShape === SHAPE_LIP) {
          // A ledge: the whole cell at a lip's height, its drawing folded up
          // the face you hop off. Brown lips, in the reference's own words.
          for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
            for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
              const i = (tz * VOXELS_PER_TILE + vz) * cols + tx * VOXELS_PER_TILE + vx;
              heights[i] = LEDGE_VOXELS;
              keys[i] = paint(blockKey(stats, tile, vx, vz), tile, mapTz);
              decorFront[i] = cellZ * 2 + 1;
            }
          }
          continue;
        }
      }

      if (volumeRows > 0) {
        // The roof wears ONE row of the drawing over the whole footprint.
        // Stretching the northern half across it drew the ridge, the roof and
        // the eaves one after another down the depth of a house, which read
        // as a layer cake rather than as a roof; a real roof is one texture
        // repeated, and the gable below supplies the shape.
        const north = roofTileY(structures, mapTx, mapTz);
        const roofY = volumeRows >= 4 ? north + 1 : north;
        // Indoors the drawing is a PLAN (see Structures.roofed): the top of a
        // table is the table's own art, mat and all, and a bed's top is its
        // pillow and blanket. Repeating the north row over the footprint,
        // right for a roof, made every table a plain slab.
        const roofTile = outdoors ? map.tileAt(mapTx, roofY) : tile;
        const volumeHeight = volumeRows * VOXELS_PER_TILE;
        // Indoors, a volume that is not the room's shell is furniture -- a
        // bed, a bookcase, a counter -- and wears the reference's wood and
        // gold rather than the shell's wall colour. Our colours come from a
        // category, so this is where a thing decides what it is; IndoorKinds
        // has the finer word (paint) where it has one.
        const furniture = !outdoors && volumeRows === INDOOR_FURNITURE_ROWS && categoryName === "WALL"
          ? categoryIndexOf("FURNITURE") : -1;
        for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
          // The gable, one voxel step at a time. A column is one flat height,
          // so the slope comes out stepped -- which is the right answer here:
          // a smooth ramp among pixel voxels would be the odd one out.
          const depth = (mapTz - north) + (vz + 0.5) / VOXELS_PER_TILE;
          const drop = Math.round(roofDropRows(structures, mapTx, mapTz, depth) * VOXELS_PER_TILE);
          let height = volumeHeight - drop;
          if (height < VOXELS_PER_TILE) {
            height = VOXELS_PER_TILE;
          }
          for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
            const i = (tz * VOXELS_PER_TILE + vz) * cols + tx * VOXELS_PER_TILE + vx;
            heights[i] = height;
            const block = blockKey(stats, roofTile, vx, vz);
            keys[i] = paint(furniture >= 0 ? furniture * 4 + (block & 3) : block, tile, mapTz);
            structRows[i] = volumeRows;
          }
        }
        continue;
      }


      for (let vz = 0; vz < VOXELS_PER_TILE; vz++) {
        for (let vx = 0; vx < VOXELS_PER_TILE; vx++) {
          // The block's shade: most common of its pixels, ties to the darker.
          const counts = [0, 0, 0, 0];
          for (let py = 0; py < pixelsPerVoxel; py++) {
            for (let px = 0; px < pixelsPerVoxel; px++) {
              counts[tileShade(stats, tile, vx * pixelsPerVoxel + px, vz * pixelsPerVoxel + py)]++;
            }
          }
          let shade = 0;
          for (let s = 1; s < 4; s++) {
            if (counts[s] >= counts[shade]) {
              shade = s;
            }
          }
          let relief = 0;
          if (!flat) {
            if (shade < usual) {
              relief = 1;
            } else if (shade > usual && obstacle) {
              relief = -1;
            }
          }
          const i = (tz * VOXELS_PER_TILE + vz) * cols + tx * VOXELS_PER_TILE + vx;
          heights[i] = base + relief;
          keys[i] = paint(category * 4 + shade, tile, mapTz);
        }
      }
    }
  }
  // The rim, last and in one place, so it applies to ground, to water and to
  // a building that happens to stand near the edge alike.
  if (window.softEdge) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -map.widthTiles / 2 + (window.minTileX * VOXELS_PER_TILE + c + 0.5) * VOXEL;
        const z = -map.heightTiles / 2 + (window.minTileZ * VOXELS_PER_TILE + r + 0.5) * VOXEL;
        const i = r * cols + c;
        if (edgeCut(x - window.centreX, z - window.centreZ, window.cutRadius, true)) {
          cut[i] = 1;
          structRows[i] = 0;
          decor[i] = 0;
          decorFront[i] = -1;
          continue;
        }
        const drop = edgeDrop(x - window.centreX, z - window.centreZ,
                              window.cutRadius, window.earthVoxels, true);
        if (drop <= 0) {
          continue;
        }
        let sunk = heights[i] - Math.round(drop);
        const floor = -window.earthVoxels;
        if (sunk < floor) {
          sunk = floor;
        }
        heights[i] = sunk;
        structRows[i] = 0;
        decor[i] = 0;
        decorFront[i] = -1;
      }
    }
  }

  return {
    cols: cols, rows: rows, heights: heights, keys: keys, cut: cut,
    structRows: structRows, decor: decor, decorFront: decorFront,
    window: window, structures: structures,
  };
}

/** structureRowsAt, re-exported under a local name so the loop above reads. */
function structureRowsOf(field: StructureField, tx: number, ty: number): number {
  const cx = tx - field.minTileX;
  const cy = ty - field.minTileY;
  if (cx < 0 || cy < 0 || cx >= field.width || cy >= field.height) {
    return 0;
  }
  return field.rows[cy * field.width + cx];
}

/**
 * The height, in voxels, of the tallest column under the CELL a mesh-local
 * point falls in, or `null` when the point is outside the built window.
 *
 * Per cell rather than per column because a walkable tile's pixels are not
 * level: a shade lighter than the tile's usual one stands a cube proud, so a
 * path is a bed of studs. A character placed on the low columns has its feet
 * inside the studs it is standing between; one placed on the tallest column of
 * its own cell stands ON the path, which is what the cartridge draws. A cell is
 * two tiles square and every tile of a walkable cell shares a base, so the
 * maximum can only differ by the one voxel of relief -- it can never lift the
 * character onto a neighbouring wall.
 */
/**
 * Rows of structure that still count as something to stand ON.
 *
 * Two rows is a counter, a table, a bookcase's own top: furniture. Anything
 * taller is a wall or a house, and a Pokeball does not sit on a house.
 */
export const FURNITURE_ROWS: number = 2;

/** decor bit: something standing on the ground, not the ground itself. */
export const DECOR_STANDS: number = 1;
/**
 * decor bit: and the wind moves it.
 *
 * Separate from DECOR_STANDS because a fence post is decoration that must not
 * move, and because it is what decides whether a column's quads go into the
 * chunk's own mesh or into the small second one that gets animated. Keeping
 * the two apart is what stops the sway mesh from carrying every fence in
 * Viridian City for no reason.
 */
export const DECOR_SWAYS: number = 2;

/**
 * Whether a map CELL is inside the built window.
 *
 * A cell is two tiles square, and an actor standing in one is drawn from the
 * cell rather than the tile -- so the question is whether the window covers
 * the cell, not a corner of it.
 *
 * This exists because it was not asked. NPCs, wandering Pokemon and objects
 * were placed from their map coordinates whatever the window held, so on the
 * glasses a route showed characters standing in mid-air out where no terrain
 * had been built: "ik zie dan in de verte in niks ineens personages en pokemon
 * en objecten" (Joshua, 10 September). The play area is a WINDOW on a bigger
 * map; anything drawn outside it is drawn on nothing.
 */
export function windowHasCell(window: TerrainWindow, cellX: number, cellZ: number): boolean {
  if (!window) {
    return false;
  }
  // Cells are two tiles square: cell n covers tiles 2n and 2n+1.
  const tileX = cellX * 2;
  const tileZ = cellZ * 2;
  return tileX + 1 >= window.minTileX && tileX <= window.maxTileX &&
         tileZ + 1 >= window.minTileZ && tileZ <= window.maxTileZ;
}

export function cellTopVoxels(
  field: ColumnField, map: MapRuntime, meshX: number, meshZ: number
): number {
  if (!field) {
    return null;
  }
  const w = field.window;
  const tileX = Math.floor(meshX + map.widthTiles / 2);
  const tileZ = Math.floor(meshZ + map.heightTiles / 2);
  // The cell the tile belongs to: cells are two tiles square.
  const cellTileX = (tileX >> 1) << 1;
  const cellTileZ = (tileZ >> 1) << 1;
  let top: number = null;
  /** The lowest FURNITURE surface in the cell: see FURNITURE_ROWS. */
  let structTop: number = null;
  let sawColumn = false;
  for (let tz = cellTileZ; tz <= cellTileZ + 1; tz++) {
    if (tz < w.minTileZ || tz > w.maxTileZ) {
      continue;
    }
    for (let tx = cellTileX; tx <= cellTileX + 1; tx++) {
      if (tx < w.minTileX || tx > w.maxTileX) {
        continue;
      }
      const c0 = (tx - w.minTileX) * VOXELS_PER_TILE;
      const r0 = (tz - w.minTileZ) * VOXELS_PER_TILE;
      for (let r = r0; r < r0 + VOXELS_PER_TILE; r++) {
        for (let c = c0; c < c0 + VOXELS_PER_TILE; c++) {
          const at = r * field.cols + c;
          sawColumn = true;
          // Decoration is something standing ON the ground, not the ground.
          // Reading it as a surface put a character on the tips of the tall
          // grass instead of in it, and on top of a fence post instead of
          // beside it.
          if (field.decor && (field.decor[at] & DECOR_STANDS) !== 0) {
            continue;
          }
          const h = field.heights[at];
          // A folded door is drawn as part of the wall above it and stands a
          // whole storey high, but it is still the doorstep you walk onto.
          // Reading the GROUND columns of the cell is what keeps a character at
          // the door on the doorstep instead of on the roof.
          if (field.structRows && field.structRows[at] > 0) {
            // ...while FURNITURE is a surface rather than a wall, and what is
            // on that cell is standing on top of it. Oak's counter is two rows
            // of detected structure and it is what the three starter balls sit
            // on; skipping it put them on the floor inside the counter, which
            // is how "I still cannot see the Pokeballs" was reported twice.
            //
            // Height is what tells the two apart, and it is not arbitrary: you
            // can stand a ball on something waist-high and you cannot stand one
            // on a house. Anything taller is a building, and what stands at a
            // building stands on the ground in front of it.
            //
            // The LOWEST such surface in the cell, not the tallest: a shelf and
            // the table in front of it can share a cell, and what is there is
            // on the table.
            if (field.structRows[at] <= FURNITURE_ROWS &&
                (structTop === null || h < structTop)) {
              structTop = h;
            }
            continue;
          }
          if (top === null || h > top) {
            top = h;
          }
        }
      }
    }
  }
  // Ground first: a cell with any ground in it is a cell you stand on, which is
  // what keeps a character at a door on the doorstep rather than on the roof.
  if (top !== null) {
    return top;
  }
  if (structTop !== null) {
    return structTop;
  }
  return sawColumn ? 0 : null;
}

/** One chunk's quads: interleaved position(3) + texture0(2), and 16-bit indices. */
export interface ChunkGeometry {
  verts: number[];
  indices: number[];
  quads: number;
  /**
   * The same, for the columns the wind moves -- see DECOR_SWAYS.
   *
   * A second, much smaller mesh rather than a flag on the first, because
   * nothing in the material path this project can rely on across 5.15 and
   * 5.23 can offset a vertex: no graph shader, no vertex colour, one texture
   * lookup. What CAN move is a SceneObject, so the blades that move live in
   * their own object and the ground they stand on does not.
   *
   * Empty on most chunks. Tall grass is the only thing that sways, and a map
   * is mostly not tall grass.
   */
  swayVerts: number[];
  swayIndices: number[];
  swayQuads: number;
}

/**
 * The geometry of one chunk. `chunkX`/`chunkZ` are chunk coordinates on the
 * MAP's chunk grid, so a chunk keeps its identity as the window moves.
 *
 * A column's top is one quad in its colour, lit as a top or, at ground level,
 * as the floor. Each side facing a lower neighbour is ONE quad down to that
 * neighbour: a solid-colour prism needs no slicing. At the window's edge the
 * neighbour is the outside world, earth-deep below, and the wall is drawn in
 * the column's colour down to the ground and in earth below it, checkered by
 * parity the way the reference dithers its soil. A single floor quad closes
 * the chunk from underneath.
 *
 * `chunkTiles` is the chunk's edge. It is a parameter rather than the constant
 * because the streaming cover picks an edge that suits the render distance --
 * see ChunkPlan -- and the default is the constant, so every existing caller
 * gets what it always got.
 */
export function buildChunkGeometry(
  field: ColumnField, map: MapRuntime, chunkX: number, chunkZ: number, stats: TileStats,
  chunkTiles: number = CHUNK_TILES
): ChunkGeometry {
  const w = field.window;
  const chunkColumns = chunkTiles * VOXELS_PER_TILE;
  // A folded face indoors is painted the way its column's top is (see
  // buildColumnField): what IndoorKinds names, in its kind's colour; a
  // furniture volume's WALL tiles in wood. Before this the top of a table was
  // gold and its front was the wall's blue.
  const indoors = !isOutdoors(map);
  const faceTilesetId: string = map.tileset && map.tileset.id ? map.tileset.id : "";
  const faceRecolour = indoors ? indoorRecolour(faceTilesetId, stats.tileCount, categoryIndexOf) : null;
  // Below the band a tile may have a second word (see INDOOR_KINDS_BELOW).
  const faceRecolourBelow = indoors
    ? indoorRecolour(faceTilesetId, stats.tileCount, categoryIndexOf, true) : null;
  const furnitureIndex = categoryIndexOf("FURNITURE");
  const wallIndex = categoryIndexOf("WALL");
  const paintFace = (key: number, tileId: number, column: number, tileRow: number): number => {
    const table = tileRow >= INDOOR_BAND_TILES ? faceRecolourBelow : faceRecolour;
    if (table && tileId < table.length && table[tileId] >= 0) {
      return table[tileId] * 4 + (key & 3);
    }
    if (indoors && (key >> 2) === wallIndex && field.structRows[column] === INDOOR_FURNITURE_ROWS) {
      return furnitureIndex * 4 + (key & 3);
    }
    return key;
  };
  const verts: number[] = [];
  const indices: number[] = [];
  let quads = 0;
  const swayVerts: number[] = [];
  const swayIndices: number[] = [];
  let swayQuads = 0;
  /** Which buffer the next quad goes in. Set once per column, below. */
  let swaying = false;
  const originX = -map.widthTiles / 2;
  const originZ = -map.heightTiles / 2;

  const c0 = Math.max(chunkX * chunkColumns - w.minTileX * VOXELS_PER_TILE, 0);
  const r0 = Math.max(chunkZ * chunkColumns - w.minTileZ * VOXELS_PER_TILE, 0);
  const c1 = Math.min((chunkX + 1) * chunkColumns - w.minTileX * VOXELS_PER_TILE, field.cols);
  const r1 = Math.min((chunkZ + 1) * chunkColumns - w.minTileZ * VOXELS_PER_TILE, field.rows);
  if (c0 >= c1 || r0 >= r1) {
    return { verts: verts, indices: indices, quads: 0,
             swayVerts: swayVerts, swayIndices: swayIndices, swayQuads: 0 };
  }

  const drop = (x: number, z: number): number =>
    curveDrop(x - w.centreX, z - w.centreZ, w.halfExtent, w.curveLevel);

  function pushQuad(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    uv: number[]
  ): void {
    const into = swaying ? swayVerts : verts;
    const onto = swaying ? swayIndices : indices;
    const base = (swaying ? swayQuads : quads) * 4;
    into.push(ax, ay + drop(ax, az), az, uv[0], uv[1]);
    into.push(bx, by + drop(bx, bz), bz, uv[0], uv[1]);
    into.push(cx, cy + drop(cx, cz), cz, uv[0], uv[1]);
    into.push(dx, dy + drop(dx, dz), dz, uv[0], uv[1]);
    // WOUND SO THAT EVERY FACE POINTS AWAY FROM THE SOLID.
    //
    // It did not, and that is why the terrain material is two-sided. Measured
    // headlessly over three maps (test/terrainwinding): every cap came out
    // facing +Y or -Y, correctly outward, and of the wall quads not one faced
    // outward -- 70 per cent provably faced INTO the ground they stand on and
    // the rest were between two solid columns where a heightfield probe cannot
    // tell. Caps one way, walls the other, in the same mesh.
    //
    // With backface culling off that is invisible, which is how it survived.
    // Turn culling on and half the world would vanish; that is presumably what
    // happened to whoever set twoSided, and setting it made the mesh's own
    // inconsistency stop mattering.
    //
    // Decided HERE rather than at the ten call sites, because one rule that
    // reads the corners cannot miss a wall the way ten edits can. A quad whose
    // four corners share a y is a cap and was already right; anything else is
    // a wall and its two triangles are reversed.
    //
    // The y compared is the one passed IN, before drop(): the curve moves a
    // cap's corners apart in y without making it a wall.
    //
    // This changes nothing on screen today -- a two-sided pass ignores winding
    // entirely, and this material carries no normals for a shader to light
    // with. What it changes is that `pass.twoSided = false` on the terrain is
    // now a one-line change that can be tried instead of a guess.
    const cap = ay === by && ay === cy && ay === dy;
    if (cap) {
      onto.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      onto.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    if (swaying) {
      swayQuads++;
    } else {
      quads++;
    }
  }

  const earthFloor = -w.earthVoxels;
  const heightAt = (c: number, r: number): number => {
    if (c < 0 || r < 0 || c >= field.cols || r >= field.rows) {
      return earthFloor;
    }
    const at = r * field.cols + c;
    // A column outside the round world is the outside world: its neighbour
    // draws a wall down to the earth, which is what closes the disc.
    if (field.cut && field.cut[at]) {
      return earthFloor;
    }
    return field.heights[at];
  };

  /**
   * A wall of column (c, r) on one side, from the neighbour's height up to
   * its own. Below ground level the wall is earth.
   */
  function pushWall(c: number, r: number, side: number, neighbour: number, h: number,
                    x0: number, x1: number, z0: number, z1: number, key: number,
                    depth: number): void {
    if (neighbour >= h) {
      return;
    }
    // Each compass side takes its own light. One shade for all four is what
    // made a building read as a card standing on edge. The rung on top of that
    // is what the shape around the face does to it: see VoxelDepth.
    const sideUv = texelUv(texelIndex(key >> 2, key & 3, bandForSide(side), depth));
    const earthUv = texelUv(earthTexelIndex((c + r) & 1, bandForSide(side)));
    // Two spans at most: earth from the neighbour up to 0, colour from there up.
    const spans: number[][] = [];
    if (neighbour < 0) {
      spans.push([neighbour, Math.min(0, h), 1]);
    }
    if (h > 0) {
      spans.push([Math.max(neighbour, 0), h, 0]);
    }
    for (let s = 0; s < spans.length; s++) {
      const lo = spans[s][0] * VOXEL;
      const hi = spans[s][1] * VOXEL;
      if (hi <= lo) {
        continue;
      }
      const uv = spans[s][2] === 1 ? earthUv : sideUv;
      if (side === 0) {          // north: z0 face, seen from -z
        pushQuad(x0, lo, z0, x1, lo, z0, x1, hi, z0, x0, hi, z0, uv);
      } else if (side === 1) {   // south
        pushQuad(x1, lo, z1, x0, lo, z1, x0, hi, z1, x1, hi, z1, uv);
      } else if (side === 2) {   // west
        pushQuad(x0, lo, z1, x0, lo, z0, x0, hi, z0, x0, hi, z1, uv);
      } else {                   // east
        pushQuad(x1, lo, z0, x1, lo, z1, x1, hi, z1, x1, hi, z0, uv);
      }
    }
  }

  /**
   * The folded south face of a measured volume, one quad per voxel of
   * height. Voxel v of the wall reads tile row `front - floor(v / 4)` and,
   * within that tile, the pixel row that lands at this height, so the whole
   * drawing stands up in place rather than being flattened to one colour.
   */
  /**
   * Whether the column at (c, r) is outside the building -- open ground, the
   * edge of the window, or a different structure. A face onto one of these
   * is a face the world can see.
   */
  function outward(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= field.cols || r >= field.rows) {
      return true;
    }
    const at = r * field.cols + c;
    if (field.cut && field.cut[at]) {
      return true;
    }
    return field.structRows[at] === 0;
  }

  /** Whether a 2x2-pixel block of a tile is paper rather than ink. */
  function isLightBlock(tile: number, vx: number, vz: number): boolean {
    return (blockKey(stats, tile, vx, vz) & 3) <= 1;
  }

  function pushFacade(c: number, r: number, side: number, neighbour: number, h: number,
                      x0: number, x1: number, z0: number, z1: number,
                      propFront: number, depth: number): void {
    if (neighbour >= h) {
      return;
    }
    const tileX = w.minTileX + Math.floor(c / VOXELS_PER_TILE);
    const tileZ = w.minTileZ + Math.floor(r / VOXELS_PER_TILE);
    // Which pixel column of the source tile this face shows. North and south
    // read across the tile; east and west read along it, so a wall carries
    // the same course of brickwork round the corner.
    const vx = side === 0 || side === 1 ? c % VOXELS_PER_TILE : r % VOXELS_PER_TILE;
    // The south face IS the drawing and draws at full brightness; the other
    // three are the same course dimmed, which is what stops a building
    // reading as one printed card standing on edge.
    const faceBand = bandForSide(side);
    const earthUv = texelUv(earthTexelIndex((c + r) & 1, bandForSide(side)));
    for (let v = neighbour; v < h; v++) {
      const lo = v * VOXEL;
      const hi = lo + VOXEL;
      let uv: number[];
      if (v < 0) {
        uv = earthUv;
      } else {
        const band = Math.floor(v / VOXELS_PER_TILE);
        // Inside the band, the ground end of the quad is the tile's BOTTOM
        // pixel row, so the drawing stands the right way up.
        const vz = VOXELS_PER_TILE - 1 - (v % VOXELS_PER_TILE);
        const sourceY = propFront >= 0 ? propFront - band
                                       : facadeTileY(field.structures, tileX, tileZ, band);
        const faceTile = map.tileAt(tileX, sourceY);
        const faceKey = paintFace(blockKey(stats, faceTile, vx, vz), faceTile, r * field.cols + c, sourceY);
        uv = texelUv(texelIndex(faceKey >> 2, faceKey & 3, faceBand, depth));
      }
      if (side === 0) {
        pushQuad(x0, lo, z0, x1, lo, z0, x1, hi, z0, x0, hi, z0, uv);
      } else if (side === 1) {
        // The front, and the only face worth carving: a window pane or a
        // doorway is a light block inside the drawing's own dark frame, so
        // setting it back a fraction of a voxel and closing the gap with
        // jambs turns a printed card into something with openings in it.
        // A prop is two voxels thick. Setting a window back six tenths of one
        // and hanging jambs off it is four quads spent on a fence post.
        let back = 0;
        if (v >= 0 && propFront < 0) {
          const band = Math.floor(v / VOXELS_PER_TILE);
          const vz = VOXELS_PER_TILE - 1 - (v % VOXELS_PER_TILE);
          const tile = map.tileAt(tileX, facadeTileY(field.structures, tileX, tileZ, band));
          if (isLightBlock(tile, vx, vz)) {
            back = RECESS_VOXELS * VOXEL;
            const zi = z1 - back;
            // A jamb wherever the neighbour INSIDE this tile is not set back.
            // Neighbours past the tile's edge are left alone: a window that
            // runs across two tiles should not grow a mullion at the seam.
            if (vx > 0 && !isLightBlock(tile, vx - 1, vz)) {
              pushQuad(x0, lo, zi, x0, lo, z1, x0, hi, z1, x0, hi, zi, uv);
            }
            if (vx < VOXELS_PER_TILE - 1 && !isLightBlock(tile, vx + 1, vz)) {
              pushQuad(x1, lo, z1, x1, lo, zi, x1, hi, zi, x1, hi, z1, uv);
            }
            if (vz > 0 && !isLightBlock(tile, vx, vz - 1)) {
              pushQuad(x0, hi, zi, x1, hi, zi, x1, hi, z1, x0, hi, z1, uv);
            }
            if (vz < VOXELS_PER_TILE - 1 && !isLightBlock(tile, vx, vz + 1)) {
              pushQuad(x0, lo, z1, x1, lo, z1, x1, lo, zi, x0, lo, zi, uv);
            }
          }
        }
        const zf = z1 - back;
        pushQuad(x1, lo, zf, x0, lo, zf, x0, hi, zf, x1, hi, zf, uv);
      } else if (side === 2) {
        pushQuad(x0, lo, z1, x0, lo, z0, x0, hi, z0, x0, hi, z1, uv);
      } else {
        pushQuad(x1, lo, z0, x1, lo, z1, x1, hi, z1, x1, hi, z0, uv);
      }
    }
  }

  /**
   * The eave: one voxel of roof hanging past the wall below it.
   *
   * Two quads, the lip and its underside, with the underside a fraction
   * lower so the pair never fight for the same depth.
   */
  function pushEave(side: number, h: number, key: number,
                    x0: number, x1: number, z0: number, z1: number): void {
    const y = h * VOXEL;
    const under = y - VOXEL * 0.35;
    const topUv = texelUv(texelIndex(key >> 2, key & 3, BAND_TOP));
    const underUv = texelUv(texelIndex(key >> 2, key & 3, BAND_UNDER));
    let ax0 = x0;
    let ax1 = x1;
    let az0 = z0;
    let az1 = z1;
    if (side === 0) {
      az0 = z0 - VOXEL;
      az1 = z0;
    } else if (side === 1) {
      az0 = z1;
      az1 = z1 + VOXEL;
    } else if (side === 2) {
      ax0 = x0 - VOXEL;
      ax1 = x0;
    } else {
      ax0 = x1;
      ax1 = x1 + VOXEL;
    }
    pushQuad(ax0, y, az1, ax1, y, az1, ax1, y, az0, ax0, y, az0, topUv);
    pushQuad(ax0, under, az0, ax1, under, az0, ax1, under, az1, ax0, under, az1, underUv);
  }

  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      if (field.cut && field.cut[r * field.cols + c]) {
        continue;
      }
      const h = field.heights[r * field.cols + c];
      const key = field.keys[r * field.cols + c];
      // Everything this column emits -- its cap and its four sides -- goes to
      // the same buffer, so a blade of grass moves in one piece.
      swaying = field.decor ? (field.decor[r * field.cols + c] & DECOR_SWAYS) !== 0 : false;
      const x0 = originX + (w.minTileX * VOXELS_PER_TILE + c) * VOXEL;
      const x1 = x0 + VOXEL;
      const z0 = originZ + (w.minTileZ * VOXELS_PER_TILE + r) * VOXEL;
      const z1 = z0 + VOXEL;
      const y = h * VOXEL;
      const volumeRows = field.structRows[r * field.cols + c];
      const nH = heightAt(c, r - 1);
      const sH = heightAt(c, r + 1);
      const wH = heightAt(c - 1, r);
      const eH = heightAt(c + 1, r);
      // The value rung this column's faces stand on: its tile's own lift, less
      // whatever leans over the face. See VoxelDepth -- a top with a taller
      // neighbour gets the one-voxel contact line that says two things are
      // touching, and half the tiles of a lawn take a small lift so the lawn is
      // not one flat wash.
      //
      // A structure is held out of the lift. Its faces already carry the
      // cartridge's own drawing, and a patchwork across a roof reads as
      // staining rather than as grass.
      const lift = volumeRows > 0 ? 0
        : tileLift(w.minTileX + Math.floor(c / VOXELS_PER_TILE),
                   w.minTileZ + Math.floor(r / VOXELS_PER_TILE));
      // North and south faces are flanked by the same two columns, and so are
      // east and west, so four faces need two numbers.
      const depthNS = depthIndex(lift, sideOcclusion(0, h, nH, sH, wH, eH));
      const depthWE = depthIndex(lift, sideOcclusion(2, h, nH, sH, wH, eH));
      const depthTop = depthIndex(lift, topOcclusion(h, nH, sH, wH, eH));
      // Is anything standing between this top and the sun? Walk toward it --
      // one column south-east and one voxel up per step -- and stop at the
      // first thing tall enough to be in the way.
      let shaded = false;
      for (let k = 1; k <= SHADOW_REACH && !shaded; k++) {
        if (heightAt(c + k, r + k) > h + k) {
          shaded = true;
        }
      }
      const band = shaded ? BAND_SHADOW : (h > 0 ? BAND_TOP : BAND_FLOOR);
      let topKey = key;
      if (field.decorFront && field.decorFront[r * field.cols + c] >= 0 && stats) {
        // A post's cap is the topmost row the artist drew, not the average of
        // the whole post.
        const front = field.decorFront[r * field.cols + c];
        const tileX = w.minTileX + Math.floor(c / VOXELS_PER_TILE);
        const capBand = Math.floor((h - 1) / VOXELS_PER_TILE);
        const capVz = VOXELS_PER_TILE - 1 - ((h - 1) % VOXELS_PER_TILE);
        topKey = blockKey(stats, map.tileAt(tileX, front - capBand),
                          c % VOXELS_PER_TILE, capVz);
      }
      const topUv = texelUv(texelIndex(topKey >> 2, topKey & 3, band, depthTop));
      pushQuad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, topUv);

      if (volumeRows > 0 && field.structures && stats) {
        // A measured volume folds the drawing upright on the faces that
        // FACE OUT: the flat map's northward rows ARE the elevation, so the
        // band k voxels up wears the row k tiles north of the run's front.
        //
        // Only where the neighbour is not part of the same building, though.
        // The gable steps down inside the roof, and folding the drawing onto
        // every one of those little steps -- and hanging an eave off each --
        // drew the ridge, the roof and the wall again and again down the
        // depth of a house. That is the layer cake. Inside the volume a step
        // is just a step: a short wall in the roof's own colour.
        // Indoors nothing overhangs: see StructureField.roofed. An eave is
        // half of what makes a silhouette read as a house, and a cupboard
        // wearing one was the 11 September complaint.
        const eaved = field.structures.roofed;
        // Landscape takes the merged wall, not the folded facade. A cliff's
        // art is a texture rather than an elevation, so a quad per voxel of
        // height buys nothing -- and an eave on a cliff is a barn.
        const drawn = structureBuiltAt(
          field.structures,
          w.minTileX + Math.floor(c / VOXELS_PER_TILE),
          w.minTileZ + Math.floor(r / VOXELS_PER_TILE));
        if (outward(c, r + 1)) {
          if (drawn) {
            pushFacade(c, r, 1, sH, h, x0, x1, z0, z1, -1, depthNS);
            if (eaved && sH < h - 1) pushEave(1, h, key, x0, x1, z0, z1);
          } else {
            pushWall(c, r, 1, sH, h, x0, x1, z0, z1, key, depthNS);
          }
        } else {
          pushWall(c, r, 1, sH, h, x0, x1, z0, z1, key, depthNS);
        }
        if (outward(c, r - 1)) {
          if (drawn) {
            pushFacade(c, r, 0, nH, h, x0, x1, z0, z1, -1, depthNS);
            if (eaved && nH < h - 1) pushEave(0, h, key, x0, x1, z0, z1);
          } else {
            pushWall(c, r, 0, nH, h, x0, x1, z0, z1, key, depthNS);
          }
        } else {
          pushWall(c, r, 0, nH, h, x0, x1, z0, z1, key, depthNS);
        }
        if (outward(c - 1, r)) {
          if (drawn) {
            pushFacade(c, r, 2, wH, h, x0, x1, z0, z1, -1, depthWE);
            if (eaved && wH < h - 1) pushEave(2, h, key, x0, x1, z0, z1);
          } else {
            pushWall(c, r, 2, wH, h, x0, x1, z0, z1, key, depthWE);
          }
        } else {
          pushWall(c, r, 2, wH, h, x0, x1, z0, z1, key, depthWE);
        }
        if (outward(c + 1, r)) {
          if (drawn) {
            pushFacade(c, r, 3, eH, h, x0, x1, z0, z1, -1, depthWE);
            if (eaved && eH < h - 1) pushEave(3, h, key, x0, x1, z0, z1);
          } else {
            pushWall(c, r, 3, eH, h, x0, x1, z0, z1, key, depthWE);
          }
        } else {
          pushWall(c, r, 3, eH, h, x0, x1, z0, z1, key, depthWE);
        }
      } else if (field.decorFront && field.decorFront[r * field.cols + c] >= 0) {
        // A prop's plate: the same folded drawing a building gets, read out of
        // the prop's own cell instead of out of a measured run. That is what
        // makes a fence a row of posts rather than a row of black slabs, and
        // it costs nothing extra -- the quads were going to be drawn anyway,
        // this only decides which texel each one points at.
        const front = field.decorFront[r * field.cols + c];
        pushFacade(c, r, 1, sH, h, x0, x1, z0, z1, front, depthNS);
        pushFacade(c, r, 0, nH, h, x0, x1, z0, z1, front, depthNS);
        pushFacade(c, r, 2, wH, h, x0, x1, z0, z1, front, depthWE);
        pushFacade(c, r, 3, eH, h, x0, x1, z0, z1, front, depthWE);
      } else {
        pushWall(c, r, 1, sH, h, x0, x1, z0, z1, key, depthNS);
        pushWall(c, r, 0, nH, h, x0, x1, z0, z1, key, depthNS);
        pushWall(c, r, 2, wH, h, x0, x1, z0, z1, key, depthWE);
        pushWall(c, r, 3, eH, h, x0, x1, z0, z1, key, depthWE);
      }
    }
  }

  swaying = false;
  // ------------------------------------------------------------ the seam wall
  //
  // Every chunk closes its OWN sides down to the earth, whether or not there is
  // a chunk standing next to it.
  //
  // This is what lets a chunk outlive a move of the view, and it is the whole
  // reason the pause at a block edge existed. Before, a chunk asked the column
  // field what stood beyond its edge, and past the field's own rectangle the
  // answer was "earth, all the way down" -- so the window's outline was drawn
  // into the chunk, and moving the window by a tile made every chunk in it a
  // different chunk. Measured on ROUTE_1: of the six chunks still in view after
  // a re-anchor, none came out byte-identical, so all nine were rebuilt.
  //
  // Now the wall is drawn from the earth up to whichever is LOWER, this column
  // or its neighbour -- exactly the part the ordinary walls above did not draw.
  // At the rim of the built world that is the slab's own side, and where a
  // chunk does have a neighbour it is a wall inside a closed shell: sealed
  // above by the ground and around by the rim, so it is never seen. It costs
  // about a sixth more quads on a chunk, and it buys a chunk that is a function
  // of the map alone.
  for (let r = r0; r < r1; r++) {
    const edgeRow = r === r0 || r === r1 - 1;
    for (let c = c0; c < c1; c++) {
      if (!edgeRow && c !== c0 && c !== c1 - 1) {
        continue;
      }
      const at = r * field.cols + c;
      if (field.cut && field.cut[at]) {
        continue;
      }
      const h = field.heights[at];
      const key = field.keys[at];
      const x0 = originX + (w.minTileX * VOXELS_PER_TILE + c) * VOXEL;
      const x1 = x0 + VOXEL;
      const z0 = originZ + (w.minTileZ * VOXELS_PER_TILE + r) * VOXEL;
      const z1 = z0 + VOXEL;
      const skirt = (side: number, neighbour: number): void => {
        const top = neighbour < h ? neighbour : h;
        // DEPTH_NEUTRAL, and deliberately not a measured one. The seam wall
        // closes a chunk along its OWN boundary and faces out of it, so a
        // shading rung taken from what lies beyond would make the chunk depend
        // on its neighbours -- and a chunk that depends on anything but the map
        // cannot outlive a move of the cover, which is the one property the
        // whole streaming rebuild rests on. See ChunkPlan.
        pushWall(c, r, side, earthFloor, top, x0, x1, z0, z1, key, DEPTH_NEUTRAL);
      };
      if (r === r0) skirt(0, heightAt(c, r - 1));
      if (r === r1 - 1) skirt(1, heightAt(c, r + 1));
      if (c === c0) skirt(2, heightAt(c - 1, r));
      if (c === c1 - 1) skirt(3, heightAt(c + 1, r));
    }
  }

  // The underside. One quad for a chunk that is entirely inside the world;
  // per column where the round cut passes through it, so the disc's own
  // underside is round too and no square corner hangs out below it.
  const floorY = earthFloor * VOXEL;
  const earthFloorUv = texelUv(earthTexelIndex(1, BAND_UNDER));
  let anyCut = false;
  if (field.cut) {
    for (let r = r0; r < r1 && !anyCut; r++) {
      for (let c = c0; c < c1; c++) {
        if (field.cut[r * field.cols + c]) {
          anyCut = true;
          break;
        }
      }
    }
  }
  if (anyCut) {
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        if (field.cut[r * field.cols + c]) {
          continue;
        }
        const x0 = originX + (w.minTileX * VOXELS_PER_TILE + c) * VOXEL;
        const z0 = originZ + (w.minTileZ * VOXELS_PER_TILE + r) * VOXEL;
        pushQuad(x0, floorY, z0, x0 + VOXEL, floorY, z0,
                 x0 + VOXEL, floorY, z0 + VOXEL, x0, floorY, z0 + VOXEL, earthFloorUv);
      }
    }
  } else {
    const fx0 = originX + (w.minTileX * VOXELS_PER_TILE + c0) * VOXEL;
    const fx1 = originX + (w.minTileX * VOXELS_PER_TILE + c1) * VOXEL;
    const fz0 = originZ + (w.minTileZ * VOXELS_PER_TILE + r0) * VOXEL;
    const fz1 = originZ + (w.minTileZ * VOXELS_PER_TILE + r1) * VOXEL;
    pushQuad(fx0, floorY, fz0, fx1, floorY, fz0, fx1, floorY, fz1, fx0, floorY, fz1,
             earthFloorUv);
  }

  return { verts: verts, indices: indices, quads: quads,
           swayVerts: swayVerts, swayIndices: swayIndices, swayQuads: swayQuads };
}

/** Where a step cell sits in mesh-local coordinates. */
export function cellToLocal(map: MapRuntime, cx: number, cy: number): vec3 {
  const x = -map.widthTiles / 2 + cx * 2 + 1;
  const z = -map.heightTiles / 2 + cy * 2 + 1;
  return new vec3(x, 0, z);
}

// ------------------------------------------------------------------- scene

/** A built chunk: its object, and the builder that must outlive its mesh. */
interface ChunkEntry {
  key: string;
  /** Its chunk coordinates, so the cover can be asked whether it still wants it. */
  at: number[];
  object: SceneObject;
  builder: MeshBuilder;
  quads: number;
  /** The blades of grass, if this chunk has any: a child of `object`. */
  sway: SceneObject;
  swayBuilder: MeshBuilder;
  /**
   * Everything the chunk emits, kept so the view can be re-cut from it
   * without going back to the column field. See world/ViewClip.ts.
   */
  geometry: ChunkGeometry;
  drawnVerts?: number[];
  drawnIndices?: number[];
  bounds?: FaceBound[];
  fade?: SceneObject;
  fadeBuilder?: MeshBuilder;
  faded?: string;
  sightStamp?: string;
  /** The tiles of it last drawn; null while none of it is in view. */
  clip: TileRect;
  /**
   * Where in the wind's cycle this chunk starts, in radians.
   *
   * Per CHUNK rather than per blade, because a blade cannot have a transform
   * of its own without a SceneObject of its own. Taken from the chunk's own
   * coordinates so it is stable across rebuilds -- a phase that changed when
   * a chunk was rebuilt would make the grass jump as you walked -- and mixed
   * so that neighbouring chunks are far apart in the cycle, which is what
   * makes the motion read as a gust crossing the field rather than as one
   * lawn sliding.
   */
  phase: number;
}

/**
 * How far the wind carries a blade, in tile units, and how fast.
 *
 * A third of a voxel. The blades are two voxels wide, so a third of one is
 * plainly motion and plainly not the grass sliding off its own roots; and the
 * gap it opens at the base against the ground the blade stands on is a third
 * of a voxel of a surface nobody can see from above.
 *
 * The reference has no wind at all -- its world moves because the cartridge's
 * own tile animations do, and because its water is a mirror. This is ours.
 */
const SWAY_TILES: number = 1 / (VOXELS_PER_TILE * 3);
/** Radians a second. A slow breath, not a shiver. */
const SWAY_RATE: number = 1.1;

/**
 * The chunk set for one map under a moving window. Call `setMap` on a map
 * change (drops everything) and `update` every frame with the focus tile;
 * it builds at most a few chunks a frame so a window shift is spread out
 * rather than a hitch.
 */
export class VoxelTerrain {
  private parent: SceneObject;
  private material: Material = null;
  private fadeMaterial: Material = null;
  private sightEye: number[] = null;
  private sightTargets: SightPoint[] = [];
  private sightCursor = 0;
  private map: MapRuntime = null;
  private stats: TileStats = null;
  private curveLevel: number = 0;
  /** Whether the world's rim rolls off; see edgeDrop. */
  private softEdge: boolean = false;
  /** The play area's width in tiles ACROSS; zero or less is the whole map. */
  private windowAcross: number = -1;
  private field: ColumnField = null;
  /** The map's measured buildings, detected once per map. */
  private structures: StructureField = null;
  /** What this tileset uses for air, measured once per map. */
  private profile: ShapeProfile = null;
  /** Whether tiles get their authored shape, or the old pixel extrusion. */
  private shapes: boolean = true;
  /** The tiles being drawn: the cover, or the bent path's own window. */
  private window: TerrainWindow = null;
  /** The square of chunks the flat world is built out of. Null while it is bent. */
  private cover: ChunkCover = null;
  /** The chunk edge the built chunks were made at, in tiles. */
  private chunkTiles: number = CHUNK_TILES;
  /** Set when what is standing can no longer be trusted: a cut tree, a Flash. */
  private stale: boolean = true;
  /** The bent path's anchor tile, snapped to chunks. See followBentWindow. */
  private anchorX: number = -1;
  private anchorZ: number = -1;
  private chunks: ChunkEntry[] = [];
  private pending: number[][] = [];
  private generation: number = 0;
  private buildsPerFrame: number = 3;
  /**
   * The square the wearer sees, in the flat world: centred on the player and
   * moved a tile a step, as the cartridge scrolls. Null while the world is
   * bent, where the whole window is rebuilt instead (followBentWindow).
   */
  private view: TerrainWindow = null;
  /** Chunks whose cut has to be redone because the view moved; keys. */
  private reclip: string[] = [];
  /**
   * How many chunks are re-cut a frame. A step moves the view a tile and
   * touches the chunks along two of its edges -- ten or so at the widest
   * rung -- and each is a filter over a few thousand quads plus a mesh
   * upload. Four a frame finishes a step's worth within the step.
   */
  private reclipsPerFrame: number = 4;
  /** Chunks built since the lens started; monotonic, see buildCount. */
  private builds: number = 0;
  private totalQuads: number = 0;

  constructor(parent: SceneObject) {
    this.parent = parent;
  }

  setMaterial(material: Material): void {
    this.material = material;
    this.fadeMaterial = null;
  }

  /** A new map, or a new look for the same one: everything is rebuilt. */
  setMap(map: MapRuntime, stats: TileStats, curveLevel: number, windowTilesAcross: number,
         softEdge: boolean): void {
    this.map = map;
    this.stats = stats;
    this.structures = null;
    this.profile = null;
    this.curveLevel = curveLevel;
    this.softEdge = softEdge === true;
    this.windowAcross = windowTilesAcross;
    this.clear();
    this.anchorX = -1;
    this.anchorZ = -1;
  }

  /**
   * Whether tiles stand in their authored shape. Off is the pixel extrusion
   * this project shipped until 8 September, kept so the two can be compared
   * on the glasses rather than only in a diff.
   */
  setShapes(shapes: boolean): void {
    if (this.shapes === shapes) {
      return;
    }
    this.shapes = shapes;
    // Both the detector and the column field read it, so both go.
    this.structures = null;
    this.invalidate();
  }

  shapesOn(): boolean {
    return this.shapes;
  }

  /** Drops the view so the next update builds it afresh (a cut tree, a Flash). */
  invalidate(): void {
    this.anchorX = -1;
    this.anchorZ = -1;
    // What is standing was built from the old world, so none of it can be kept.
    this.stale = true;
    // A cut tree or a pushed boulder changes what stands up.
    this.structures = null;
  }

  currentWindow(): TerrainWindow {
    return this.window;
  }

  /**
   * The top of the world at a mesh-local point, in mesh units, curve included
   * -- what a character standing there should have its feet on. Null when
   * nothing is built there yet, so the caller can keep its previous answer
   * instead of dropping the cast through the floor for a frame.
   */
  surfaceY(meshX: number, meshZ: number): number {
    if (!this.field || !this.window || !this.map) {
      return null;
    }
    const top = cellTopVoxels(this.field, this.map, meshX, meshZ);
    if (top === null) {
      return null;
    }
    return top * VOXEL +
      curveDrop(meshX - this.window.centreX, meshZ - this.window.centreZ,
                this.window.halfExtent, this.window.curveLevel);
  }

  /**
   * Whether a point is on ground the terrain is drawing OR about to draw.
   *
   * surfaceY() is the truth about what is BUILT; this is the truth about what
   * is promised, which is the question a body's visibility should ask -- see
   * coverHasTile. In the bent world there is no cover and the window is the
   * promise.
   */
  coversPoint(meshX: number, meshZ: number): boolean {
    if (!this.map) {
      return false;
    }
    const tileX = Math.floor(meshX + this.map.widthTiles / 2);
    const tileZ = Math.floor(meshZ + this.map.heightTiles / 2);
    if (this.view) {
      // In view or not: the cover beyond the view is built but cut away, and
      // a body standing there would stand on nothing the wearer can see.
      return tileX >= this.view.minTileX && tileX <= this.view.maxTileX &&
             tileZ >= this.view.minTileZ && tileZ <= this.view.maxTileZ;
    }
    if (this.cover) {
      return coverHasTile(this.cover, tileX, tileZ);
    }
    if (this.window) {
      return tileX >= this.window.minTileX && tileX <= this.window.maxTileX &&
             tileZ >= this.window.minTileZ && tileZ <= this.window.maxTileZ;
    }
    return false;
  }

  /**
   * What the field says under a point: [cellTop, tallest, structRows, cols].
   *
   * Diagnostic. cellTop is what surfaceY answers with; tallest is the same
   * columns WITHOUT skipping structures, and structRows says how many were
   * skipped -- which is the difference between "the ground is here" and "the
   * ground is under a counter". -1 for all of them when nothing is built.
   */
  columnReport(meshX: number, meshZ: number): number[] {
    if (!this.field || !this.window || !this.map) {
      return [-1, -1, -1, -1];
    }
    const w = this.field.window;
    const tileX = Math.floor(meshX + this.map.widthTiles / 2);
    const tileZ = Math.floor(meshZ + this.map.heightTiles / 2);
    const cellTileX = (tileX >> 1) << 1;
    const cellTileZ = (tileZ >> 1) << 1;
    let tallest = -1;
    let structRows = 0;
    for (let tz = cellTileZ; tz <= cellTileZ + 1; tz++) {
      for (let tx = cellTileX; tx <= cellTileX + 1; tx++) {
        if (tx < w.minTileX || tx > w.maxTileX || tz < w.minTileZ || tz > w.maxTileZ) {
          continue;
        }
        const c0 = (tx - w.minTileX) * VOXELS_PER_TILE;
        const r0 = (tz - w.minTileZ) * VOXELS_PER_TILE;
        for (let r = r0; r < r0 + VOXELS_PER_TILE; r++) {
          for (let c = c0; c < c0 + VOXELS_PER_TILE; c++) {
            const at = r * this.field.cols + c;
            if (this.field.heights[at] > tallest) {
              tallest = this.field.heights[at];
            }
            if (this.field.structRows && this.field.structRows[at] > structRows) {
              structRows = this.field.structRows[at];
            }
          }
        }
      }
    }
    const top = cellTopVoxels(this.field, this.map, meshX, meshZ);
    return [top === null ? -1 : top, tallest, structRows, this.field.cols];
  }

  quadCount(): number {
    return this.totalQuads;
  }

  chunkCount(): number {
    return this.chunks.length;
  }

  /** Chunks still to build this window; zero once the view is complete. */
  pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Whether the chunk under a point is queued to be built. This is the promise
   * a body's visibility may lean on: not "inside the cover", which a window too
   * small for its map never fills, but "a chunk with this ground is on its way".
   */
  pendingCovers(meshX: number, meshZ: number): boolean {
    if (!this.map || this.pending.length === 0) {
      return false;
    }
    const tileX = Math.floor(meshX + this.map.widthTiles / 2);
    const tileZ = Math.floor(meshZ + this.map.heightTiles / 2);
    const cx = Math.floor(tileX / this.chunkTiles);
    const cz = Math.floor(tileZ / this.chunkTiles);
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i][0] === cx && this.pending[i][1] === cz) {
        return true;
      }
    }
    return false;
  }

  /**
   * Per frame. The view follows the player a CHUNK at a time -- a step that
   * leaves the cover where it is queues nothing at all -- and only the chunks
   * newly exposed are built. The ones already standing are left alone, and the
   * ones that have left stay up until the queue is empty, so the world never
   * blinks.
   */
  update(focusTileX: number, focusTileZ: number): void {
    if (!this.map || !this.material) {
      return;
    }
    // Structures are a property of the MAP, not of the view: a house half
    // outside it must still get one height, so this is detected once per map
    // and reused as the view slides.
    if (!this.profile && this.shapes) {
      this.profile = shapeProfileFor(this.map, this.stats);
    }
    if (!this.structures) {
      this.structures = detectStructures(
        this.map, this.stats, 0, 0, this.map.widthTiles - 1, this.map.heightTiles - 1,
        this.shapes ? this.profile : null);
    }
    if (streamsIncrementally(this.curveLevel, this.softEdge)) {
      this.followCover(focusTileX, focusTileZ);
    } else {
      this.followBentWindow(focusTileX, focusTileZ);
    }
    let built = 0;
    while (this.pending.length > 0 && built < this.buildsPerFrame) {
      const next = this.pending.shift();
      this.buildChunk(next[0], next[1]);
      built++;
    }
    let recut = 0;
    while (this.reclip.length > 0 && recut < this.reclipsPerFrame) {
      const key = this.reclip.shift();
      const entry = this.chunkByKey(key);
      if (entry) {
        this.emitChunk(entry);
      }
      recut++;
    }
    if (this.pending.length === 0 && !this.cover) {
      this.dropStale();
    }
  }

  /**
   * The flat world: a view that slides a tile a step, cut from a cover of whole
   * chunks that streams a chunk at a time. See world/ChunkPlan.ts and
   * world/ViewClip.ts.
   *
   * Before 11 September the view WAS the cover, so the drawn edge of the world
   * moved a whole chunk every few steps -- the "glitch" at every chunk
   * boundary in the fourth playtest's recordings. Now the cover is built
   * LOOKAHEAD_TILES wider than the view and each chunk is emitted cut to the
   * view; a step re-cuts the chunks along the view's two moving edges from the
   * geometry they keep, and builds a new column of chunks only when the
   * lookahead reaches one.
   */
  private followCover(focusTileX: number, focusTileZ: number): void {
    const view = windowFor(this.map, this.windowAcross, focusTileX, focusTileZ, 0, false);
    const chunkTiles = chunkTilesFor(this.windowAcross);
    const cover = coverAround(this.map.widthTiles, this.map.heightTiles, chunkTiles,
                              view.minTileX, view.minTileZ, view.maxTileX, view.maxTileZ);
    const viewMoved = !this.view || !sameRect(this.view, view);
    const coverMoved = !sameCover(this.cover, cover);
    if (!viewMoved && !coverMoved && !this.stale) {
      return;
    }
    // A different chunk grid, or a world that has changed under the chunks
    // already built (a cut tree, a Flash): nothing standing can be trusted.
    const regrid = this.stale || !this.cover || this.cover.chunkTiles !== cover.chunkTiles;
    this.view = view;
    this.window = view;
    this.stale = false;
    if (coverMoved || regrid) {
      this.cover = cover;
      this.chunkTiles = cover.chunkTiles;
      const earthSpan = earthSpanTilesFor(this.map.widthTiles, this.map.heightTiles,
                                          this.windowAcross);
      // The field reaches a halo past the cover, so a chunk at its edge can
      // still see what it is standing next to and what is casting a shadow on
      // it. A chunk that had to guess would be a different chunk once the
      // cover moved, and then none of this would keep anything.
      this.field = buildColumnField(
        this.map, this.stats,
        windowForRect(this.map,
                      Math.max(0, cover.minTileX - HALO_TILES),
                      Math.max(0, cover.minTileZ - HALO_TILES),
                      Math.min(this.map.widthTiles - 1, cover.maxTileX + HALO_TILES),
                      Math.min(this.map.heightTiles - 1, cover.maxTileZ + HALO_TILES),
                      earthSpan, 0, false),
        this.structures, this.profile, this.shapes);
      this.generation++;
    }
    if (regrid) {
      this.clearChunks();
      this.pending = coverChunks(cover);
      return;
    }
    if (coverMoved) {
      // What has left the cover is outside the view and its lookahead both,
      // so it is not drawn and can go now. Everything up or already queued
      // counts as held, so a second step while the first is still building
      // does not queue the same chunk twice.
      for (let i = this.chunks.length - 1; i >= 0; i--) {
        const entry = this.chunks[i];
        if (!coverContains(cover, entry.at[0], entry.at[1])) {
          this.forgetChunk(i);
        }
      }
      const held: number[][] = [];
      for (let i = 0; i < this.chunks.length; i++) {
        held.push(this.chunks[i].at);
      }
      for (let i = 0; i < this.pending.length; i++) {
        held.push(this.pending[i]);
      }
      const delta = coverDelta(cover, held);
      const keep: number[][] = [];
      for (let i = 0; i < this.pending.length; i++) {
        if (coverContains(cover, this.pending[i][0], this.pending[i][1])) {
          keep.push(this.pending[i]);
        }
      }
      this.pending = keep.concat(delta.build);
    }
    if (viewMoved) {
      // Every built chunk whose share of the view changed is re-cut. Chunks
      // still in the build queue are cut when they are built.
      for (let i = 0; i < this.chunks.length; i++) {
        const entry = this.chunks[i];
        const rect = this.viewRectOf(entry.at[0], entry.at[1]);
        if (!sameRect(rect, entry.clip) && this.reclip.indexOf(entry.key) < 0) {
          this.reclip.push(entry.key);
        }
      }
    }
  }

  /** The tiles of a chunk that are in view, or null. */
  private viewRectOf(cx: number, cz: number): TileRect {
    if (!this.view) {
      return null;
    }
    return chunkViewRect(this.view, cx, cz, this.chunkTiles,
                         this.map.widthTiles, this.map.heightTiles);
  }

  private chunkByKey(key: string): ChunkEntry {
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i].key === key) {
        return this.chunks[i];
      }
    }
    return null;
  }

  /** Destroys the i-th chunk's objects and forgets it. */
  private forgetChunk(i: number): void {
    const entry = this.chunks[i];
    this.totalQuads -= entry.quads;
    if (entry.object) {
      entry.object.destroy();
    }
    this.chunks.splice(i, 1);
  }

  /**
   * Draws a chunk cut to the view: all of it, the part in view with a skirt of
   * earth along the view's edge, or nothing.
   *
   * The geometry the chunk was built with is kept on the entry, so this is a
   * filter and a mesh upload, never a rebuild from the field. See ViewClip.
   */
  private emitChunk(entry: ChunkEntry): void {
    const rect = this.view ? this.viewRectOf(entry.at[0], entry.at[1]) : null;
    if (!this.view) {
      // The bent path: everything, as it always was.
      this.fillChunk(entry, entry.geometry.verts, entry.geometry.indices, entry.geometry.quads,
                     entry.geometry.swayVerts, entry.geometry.swayIndices, entry.geometry.swayQuads);
      entry.clip = null;
      return;
    }
    if (!rect) {
      this.fillChunk(entry, [], [], 0, [], [], 0);
      entry.clip = null;
      return;
    }
    const g = entry.geometry;
    const whole = rectIsWholeChunk(rect, entry.at[0], entry.at[1], this.chunkTiles,
                                   this.map.widthTiles, this.map.heightTiles);
    const onEdge = rect.minTileX === this.view.minTileX || rect.maxTileX === this.view.maxTileX ||
                   rect.minTileZ === this.view.minTileZ || rect.maxTileZ === this.view.maxTileZ;
    if (whole && !onEdge) {
      this.fillChunk(entry, g.verts, g.indices, g.quads, g.swayVerts, g.swayIndices, g.swayQuads);
      entry.clip = rect;
      return;
    }
    const originX = -this.map.widthTiles / 2;
    const originZ = -this.map.heightTiles / 2;
    const x0 = originX + rect.minTileX;
    const x1 = originX + rect.maxTileX + 1;
    const z0 = originZ + rect.minTileZ;
    const z1 = originZ + rect.maxTileZ + 1;
    const cut = clipQuads(g.verts, g.indices, g.quads, x0, x1, z0, z1);
    if (this.field) {
      rimQuads(this.field, rect, this.view, this.map.widthTiles, this.map.heightTiles,
               VOXELS_PER_TILE, cut);
    }
    const sway = clipQuads(g.swayVerts, g.swayIndices, g.swayQuads, x0, x1, z0, z1);
    this.fillChunk(entry, cut.verts, cut.indices, cut.quads, sway.verts, sway.indices, sway.quads);
    entry.clip = rect;
  }

  /** Puts geometry into a chunk's meshes, and shows or hides its objects to match. */
  private fillChunk(entry: ChunkEntry, verts: number[], indices: number[], quads: number,
                    swayVerts: number[], swayIndices: number[], swayQuads: number): void {
    this.totalQuads -= entry.quads;
    entry.quads = quads + swayQuads;
    this.totalQuads += entry.quads;
    if (!entry.object) {
      return;
    }
    entry.drawnVerts = verts; entry.drawnIndices = indices;
    entry.bounds = faceBounds(verts,indices); entry.faded = ""; entry.sightStamp="";
    if(entry.fade) entry.fade.enabled=false;
    VoxelTerrain.refill(entry.builder, verts, indices);
    entry.object.enabled = quads > 0 || swayQuads > 0;
    if (entry.sway && entry.swayBuilder) {
      VoxelTerrain.refill(entry.swayBuilder, swayVerts, swayIndices);
      entry.sway.enabled = swayQuads > 0;
    }
  }

  /** Bounded work: one cached chunk per frame, geometry upload only when its mask changes. */
  cutaway(eye: vec3, targets: SightPoint[], dt: number): void {
    if (!this.parent || !this.material || !this.chunks.length) return;
    const local=this.parent.getTransform().getInvertedWorldTransform().multiplyPoint(eye);
    this.sightEye=[local.x,local.y,local.z];
    this.sightTargets=targets;
    const count=Math.min(2,this.chunks.length);
    for(let n=0;n<count;n++) {
      this.sightCursor=(this.sightCursor+1)%this.chunks.length;
      const e=this.chunks[this.sightCursor];
      if(!e.object||!e.bounds||!e.drawnIndices)continue;
      const sightStamp=this.sightEye.map(v=>Math.round(v*5)).join(",")+"/"+
        targets.map(t=>[t.x,t.y,t.z,t.ground].map(v=>Math.round(v*5)).join(",")).join(";");
      if(e.sightStamp===sightStamp)continue;e.sightStamp=sightStamp;
      const faces=occludingFaces(e.bounds,this.sightEye,targets);
      const stamp=faces.join(",");if(stamp===e.faded)continue;
      e.faded=stamp;
      const split=splitFaces(e.drawnVerts,e.drawnIndices,faces);
      VoxelTerrain.refill(e.builder,e.drawnVerts,split.solid);
      if(!faces.length){if(e.fade)e.fade.enabled=false;continue;}
      if(!e.fade){
        if(!this.fadeMaterial){
          this.fadeMaterial=this.material.clone();
          const pass=this.fadeMaterial.mainPass;pass.blendMode=BlendMode.Normal;
          // 5.15 clones may reset shader values: keep the same live palette texture.
          pass.baseTex=this.material.mainPass.baseTex;pass.twoSided=true;
          pass.baseColor=new vec4(1,1,1,0.22);pass.depthWrite=false;pass.depthTest=true;
        }
        e.fade=global.scene.createSceneObject("Visibility_"+e.key);e.fade.setParent(e.object);
        e.fadeBuilder=new MeshBuilder([{name:"position",components:3},{name:"texture0",components:2}]);
        e.fadeBuilder.topology=MeshTopology.Triangles;e.fadeBuilder.indexType=MeshIndexType.UInt16;
        const visual=e.fade.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
        visual.mesh=e.fadeBuilder.getMesh();visual.mainMaterial=this.fadeMaterial;visual.renderOrder=5;
      }
      VoxelTerrain.refill(e.fadeBuilder,split.verts,split.indices);e.fade.enabled=true;
    }
  }

  /** Props sit on the actual column under their centre, not the walkable floor of the cell. */
  propSurfaceY(meshX: number, meshZ: number): number {
    if(!this.field||!this.map||!this.window)return this.surfaceY(meshX,meshZ);
    const f=this.field,w=f.window;
    const c=Math.floor((meshX+this.map.widthTiles/2-w.minTileX)*VOXELS_PER_TILE);
    const r=Math.floor((meshZ+this.map.heightTiles/2-w.minTileZ)*VOXELS_PER_TILE);
    let top=-Infinity;
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const x=c+dx,z=r+dz;
      if(x>=0&&x<f.cols&&z>=0&&z<f.rows)top=Math.max(top,f.heights[z*f.cols+x]);
    }
    return top===-Infinity?this.surfaceY(meshX,meshZ):top*VOXEL+
      curveDrop(meshX-this.window.centreX,meshZ-this.window.centreZ,this.window.halfExtent,this.window.curveLevel)+0.12;
  }

  /** Replaces a builder's contents. An empty mesh is left empty and not uploaded. */
  private static refill(builder: MeshBuilder, verts: number[], indices: number[]): void {
    const nv = builder.getVerticesCount();
    if (nv > 0) {
      builder.eraseVertices(0, nv);
    }
    const ni = builder.getIndicesCount();
    if (ni > 0) {
      builder.eraseIndices(0, ni);
    }
    if (verts.length === 0) {
      return;
    }
    builder.appendVerticesInterleaved(verts);
    builder.appendIndices(indices);
    builder.updateMesh();
  }

  /**
   * The bent world, or one whose rim rolls off: the old whole-window rebuild.
   *
   * Both the curve and the soft rim are measured from the WINDOW's centre and
   * baked into the vertices, so a chunk built under one window is simply wrong
   * under the next one. There is nothing to keep, and this re-anchors a chunk
   * at a time and queues the lot, exactly as it always did.
   */
  private followBentWindow(focusTileX: number, focusTileZ: number): void {
    const limited = this.windowAcross > 0;
    const ax = limited ? Math.floor(focusTileX / CHUNK_TILES) : 0;
    const az = limited ? Math.floor(focusTileZ / CHUNK_TILES) : 0;
    if (ax === this.anchorX && az === this.anchorZ && !this.stale) {
      return;
    }
    this.anchorX = ax;
    this.anchorZ = az;
    this.stale = false;
    this.cover = null;
    this.chunkTiles = CHUNK_TILES;
    const centreX = limited ? (ax + 0.5) * CHUNK_TILES : this.map.widthTiles / 2;
    const centreZ = limited ? (az + 0.5) * CHUNK_TILES : this.map.heightTiles / 2;
    this.window = windowFor(this.map, this.windowAcross, centreX, centreZ,
                            this.curveLevel, this.softEdge);
    this.field = buildColumnField(this.map, this.stats, this.window, this.structures,
                                  this.profile, this.shapes);
    this.generation++;
    this.pending = chunksForWindow(this.window);
  }

  /** Builds everything still pending now: a map change should not pop in over frames. */
  flush(): void {
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      this.buildChunk(next[0], next[1]);
    }
    while (this.reclip.length > 0) {
      const entry = this.chunkByKey(this.reclip.shift());
      if (entry) {
        this.emitChunk(entry);
      }
    }
    if (this.window && !this.cover) {
      this.dropStale();
    }
  }

  /**
   * How many chunks have been built since the lens started.
   *
   * A test seam, and the only way "walking does not stall" is a number rather
   * than a feeling: the stall was never a frame rate, it was a burst of chunk
   * builds landing in one step. A scenario walks, reads this before and after,
   * and the difference is the burst.
   */
  buildCount(): number {
    return this.builds;
  }

  /**
   * How many chunks across the cover is, or 0 while nothing is built.
   *
   * A test seam, and the number a stall has to be judged against: a step that
   * moves the cover builds one ROW of it, so "one row" is a different number at
   * every ZOOM rung -- three chunks at the default, seven at the widest. A
   * scenario that asserted a constant would be asserting the rung it happened
   * to run at, which is how a real measurement of seven came to look like a
   * regression against a ceiling of five.
   */
  coverChunksAcross(): number {
    return this.cover ? this.cover.across : 0;
  }

  /** The span setMap was last given, in tiles. A seam, for when it disagrees. */
  windowAsked(): number {
    return this.windowAcross;
  }

  private buildChunk(cx: number, cz: number): void {
    this.builds++;
    const geometry = buildChunkGeometry(this.field, this.map, cx, cz, this.stats,
                                        this.chunkTiles);
    // Replace the previous generation's chunk at this spot, if any.
    const key = cx + "," + cz;
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i].key === key) {
        this.forgetChunk(i);
        break;
      }
    }
    // An empty chunk is still HELD, with no objects, so the cover does not
    // ask for it again at every move.
    const entry: ChunkEntry = {
      key: key, at: [cx, cz], object: null, builder: null, quads: 0,
      sway: null, swayBuilder: null, geometry: geometry, clip: null,
      // Two odd multipliers so a run of chunks in either direction walks
      // through the cycle instead of landing on the same phase again.
      phase: (cx * 1.7 + cz * 2.9) % (Math.PI * 2),
    };
    if (geometry.quads > 0 || geometry.swayQuads > 0) {
      const builder = new MeshBuilder([
        { name: "position", components: 3 },
        { name: "texture0", components: 2 },
      ]);
      builder.topology = MeshTopology.Triangles;
      builder.indexType = MeshIndexType.UInt16;
      const object = global.scene.createSceneObject("Chunk_" + cx + "_" + cz);
      object.setParent(this.parent);
      const visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      visual.mesh = builder.getMesh();
      visual.mainMaterial = this.material;
      entry.object = object;
      entry.builder = builder;
      if (geometry.swayQuads > 0) {
        const swayBuilder = new MeshBuilder([
          { name: "position", components: 3 },
          { name: "texture0", components: 2 },
        ]);
        swayBuilder.topology = MeshTopology.Triangles;
        swayBuilder.indexType = MeshIndexType.UInt16;
        const sway = global.scene.createSceneObject("Grass_" + cx + "_" + cz);
        // A CHILD of the chunk, so it inherits the diorama's own placing and
        // scale and the wind is a local offset of a few hundredths of a tile.
        sway.setParent(object);
        const swayVisual = sway.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
        swayVisual.mesh = swayBuilder.getMesh();
        swayVisual.mainMaterial = this.material;
        entry.sway = sway;
        entry.swayBuilder = swayBuilder;
      }
    }
    this.chunks.push(entry);
    this.emitChunk(entry);
  }

  /**
   * The wind, one offset a chunk.
   *
   * Call once a frame with the running time in seconds. Chunks with no grass
   * in them cost one array read; chunks with grass cost one transform write.
   * Nothing is rebuilt and no geometry is touched.
   */
  animate(seconds: number): void {
    for (let i = 0; i < this.chunks.length; i++) {
      const entry = this.chunks[i];
      if (!entry.sway) {
        continue;
      }
      const t = seconds * SWAY_RATE + entry.phase;
      // Along X and, a third as far and at a different rate, along Z: a single
      // axis reads as a slider, two read as a breeze.
      entry.sway.getTransform().setLocalPosition(new vec3(
        Math.sin(t) * SWAY_TILES, 0, Math.sin(t * 0.7) * SWAY_TILES * 0.35));
    }
  }

  /**
   * Chunks the view no longer wants. Run only once the queue is empty, so what
   * is leaving stays up until what is arriving has landed.
   */
  private dropStale(): void {
    if (!this.window) {
      return;
    }
    const keep: any = {};
    if (!this.cover) {
      const wanted = chunksForWindow(this.window);
      for (let i = 0; i < wanted.length; i++) {
        keep[wanted[i][0] + "," + wanted[i][1]] = true;
      }
    }
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const entry = this.chunks[i];
      const wanted = this.cover
        ? coverContains(this.cover, entry.at[0], entry.at[1])
        : keep[entry.key] === true;
      if (!wanted) {
        this.forgetChunk(i);
      }
    }
  }

  /** Everything built, torn down. The view itself is left alone. */
  private clearChunks(): void {
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i].object) {
        this.chunks[i].object.destroy();
      }
    }
    this.chunks = [];
    this.pending = [];
    this.reclip = [];
    this.totalQuads = 0;
  }

  clear(): void {
    this.clearChunks();
    this.window = null;
    this.view = null;
    this.field = null;
    this.cover = null;
    this.stale = true;
  }
}
