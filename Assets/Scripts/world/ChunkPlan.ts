// Which chunks a moving view needs, and which of the ones it already has can
// stay up.
//
// The old rule re-anchored the view only when the player left the CHUNK at its
// centre, and then queued `chunksForWindow` -- every chunk the window touched,
// not the new ones. Eight tiles of walking rebuilt the whole view, which is the
// pause at a block edge the third playtest reported.
//
// Measured on ROUTE_1 at the default rung before any of this: nine chunks and
// 6,602 quads rebuilt every eight steps, and of the six chunks that were still
// inside the window afterwards, ZERO came out byte-identical. Keeping them was
// never possible, because the window's own rectangle was baked into each one:
// a chunk was CLIPPED to the window, and wherever the window ended its columns
// were walled off with earth. Move the window one tile and every chunk in it is
// a different chunk.
//
// So the view is built out of WHOLE chunks instead. The cover is a square of
// chunks centred on the player's own chunk; a chunk is built over its own tiles
// and closed with its own earth wall on every side (the seam wall in
// VoxelTerrain), so what a chunk looks like depends on the MAP and on nothing
// else. A step that leaves the cover alone builds nothing; a step that moves it
// builds one row of chunks and drops one.
//
// The chunk edge is chosen per render distance rather than nailed to eight
// tiles, so the cover still comes out about the size the WORLD row asked for:
// three chunks of six tiles is eighteen tiles for a rung that wants seventeen,
// where three chunks of eight would have been twenty-four -- half the route,
// which is the opposite of what a play area is for.

/**
 * The largest chunk edge, in tiles.
 *
 * Eight is what the 16-bit index limit was measured against
 * (docs/RESEARCH-voxel-cost.md: worst chunk 2,087 quads of 16,383), so no
 * chunk this module asks for is larger than one that has already been proven
 * to fit in a mesh.
 */
export const MAX_CHUNK_TILES: number = 8;

/**
 * The fewest chunks across a cover. Odd, so the cover has a middle chunk to
 * centre on the player; three is the least that leaves a whole chunk of world
 * on either side of them.
 */
export const MIN_COVER_CHUNKS: number = 3;

/**
 * How far past the built cover the column field has to reach, in tiles.
 *
 * A chunk reads its neighbours: one column out for its walls and the faces of
 * a building, and SHADOW_REACH (six columns, a tile and a half) to the
 * south-east to know whether it stands in something's shadow. Two tiles is
 * eight columns, which covers both -- and it has to come from the field rather
 * than from a guess, or a chunk's shading would change the moment the cover
 * moved and the chunk would have to be rebuilt after all.
 */
export const HALO_TILES: number = 2;

/**
 * How many tiles past the view's edge the cover is built, all round.
 *
 * The view moves a tile a step and a chunk column takes a frame or three to
 * build (three chunks a frame, seven in a column at the widest rung). Two tiles
 * is two steps -- half a second at a walk -- so the column the player is about
 * to see is standing before its first tile comes into view. Any more is
 * geometry built for nothing; the field already reaches HALO_TILES beyond the
 * cover for the shading.
 */
export const LOOKAHEAD_TILES: number = 2;

/**
 * The cover for a VIEW: every chunk that touches the view grown by
 * LOOKAHEAD_TILES, clamped to the map. This is what the flat world builds
 * since 11 September; what it DRAWS is the view, cut from these chunks (see
 * world/ViewClip.ts). `across` is the wider of the two chunk counts, which is
 * what a per-step build burst is measured against.
 */
export function coverAround(
  widthTiles: number, heightTiles: number, chunkTiles: number,
  minTileX: number, minTileZ: number, maxTileX: number, maxTileZ: number
): ChunkCover {
  const clampX = (t: number) => t < 0 ? 0 : t > widthTiles - 1 ? widthTiles - 1 : t;
  const clampZ = (t: number) => t < 0 ? 0 : t > heightTiles - 1 ? heightTiles - 1 : t;
  const minChunkX = Math.floor(clampX(minTileX - LOOKAHEAD_TILES) / chunkTiles);
  const maxChunkX = Math.floor(clampX(maxTileX + LOOKAHEAD_TILES) / chunkTiles);
  const minChunkZ = Math.floor(clampZ(minTileZ - LOOKAHEAD_TILES) / chunkTiles);
  const maxChunkZ = Math.floor(clampZ(maxTileZ + LOOKAHEAD_TILES) / chunkTiles);
  return {
    chunkTiles: chunkTiles,
    across: Math.max(maxChunkX - minChunkX + 1, maxChunkZ - minChunkZ + 1),
    minChunkX: minChunkX, maxChunkX: maxChunkX,
    minChunkZ: minChunkZ, maxChunkZ: maxChunkZ,
    minTileX: minChunkX * chunkTiles,
    maxTileX: Math.min(widthTiles - 1, (maxChunkX + 1) * chunkTiles - 1),
    minTileZ: minChunkZ * chunkTiles,
    maxTileZ: Math.min(heightTiles - 1, (maxChunkZ + 1) * chunkTiles - 1),
  };
}

/** Whether two covers name the same chunks. */
export function sameCover(a: ChunkCover, b: ChunkCover): boolean {
  if (!a || !b) {
    return a === b;
  }
  return a.chunkTiles === b.chunkTiles &&
         a.minChunkX === b.minChunkX && a.maxChunkX === b.maxChunkX &&
         a.minChunkZ === b.minChunkZ && a.maxChunkZ === b.maxChunkZ;
}

/** Chunks across a cover for a render distance: odd, and at least MIN_COVER_CHUNKS. */
export function coverChunksFor(windowTilesAcross: number): number {
  const span = windowTilesAcross;
  let across = MIN_COVER_CHUNKS;
  while (Math.ceil(span / across) > MAX_CHUNK_TILES) {
    across += 2;
  }
  return across;
}

/**
 * The chunk edge, in tiles, for a window span.
 *
 * The argument is the window's SPAN, not a half-extent. It was a radius while
 * this module was written, because RENDER_DISTANCES was a ladder of radii; the
 * play area replaced that with a ladder of spans on the same morning, and a
 * second parameter that does not say which of the two it measures is the exact
 * confusion that ladder was removed for.
 */
export function chunkTilesFor(windowTilesAcross: number): number {
  if (windowTilesAcross <= 0) {
    return MAX_CHUNK_TILES;
  }
  return Math.ceil(windowTilesAcross / coverChunksFor(windowTilesAcross));
}

/**
 * Whether chunks can outlive a move of the view.
 *
 * They cannot while the world is bent or its rim rolls off: both are measured
 * from the WINDOW's centre, so both write the window's position into the
 * vertices. Those two settings keep the old whole-window rebuild, and say so
 * here rather than in the middle of the terrain.
 */
export function streamsIncrementally(curveLevel: number, softEdge: boolean): boolean {
  return !(curveLevel > 0) && softEdge !== true;
}

/** The square of chunks the view is built out of. */
export interface ChunkCover {
  /** The chunk edge, in tiles. */
  chunkTiles: number;
  /** Chunks across, before the map clamps it. */
  across: number;
  minChunkX: number;
  minChunkZ: number;
  maxChunkX: number;
  maxChunkZ: number;
  /** The tiles the cover spans, clamped to the map. */
  minTileX: number;
  minTileZ: number;
  maxTileX: number;
  maxTileZ: number;
}

/**
 * One axis of the cover: `across` chunks around the focus, slid back onto the
 * map at an edge rather than shrunk.
 *
 * Sliding keeps the cover -- and so the chunk count, the plate's size and the
 * earth's depth -- the same everywhere on the map, which is what lets a chunk
 * built at the middle of a route still be the right chunk at the end of it.
 */
function axisRange(tiles: number, chunkTiles: number, across: number, focus: number): number[] {
  const last = Math.ceil(tiles / chunkTiles) - 1;
  if (across > last) {
    return [0, last];
  }
  const half = (across - 1) / 2;
  let centre = Math.floor(focus / chunkTiles);
  if (centre < 0) {
    centre = 0;
  }
  if (centre > last) {
    centre = last;
  }
  let lo = centre - half;
  let hi = centre + half;
  if (lo < 0) {
    hi -= lo;
    lo = 0;
  }
  if (hi > last) {
    lo -= hi - last;
    hi = last;
  }
  if (lo < 0) {
    lo = 0;
  }
  return [lo, hi];
}

/**
 * The cover around a focus tile. The whole map when the map fits inside it,
 * which is every interior and most towns.
 */
export function coverFor(
  widthTiles: number, heightTiles: number, windowTilesAcross: number,
  focusTileX: number, focusTileZ: number
): ChunkCover {
  const chunkTiles = chunkTilesFor(windowTilesAcross);
  const across = windowTilesAcross > 0 ? coverChunksFor(windowTilesAcross)
                                         : Math.ceil(Math.max(widthTiles, heightTiles) / chunkTiles);
  const x = axisRange(widthTiles, chunkTiles, across, focusTileX);
  const z = axisRange(heightTiles, chunkTiles, across, focusTileZ);
  return {
    chunkTiles: chunkTiles,
    across: across,
    minChunkX: x[0], maxChunkX: x[1],
    minChunkZ: z[0], maxChunkZ: z[1],
    minTileX: x[0] * chunkTiles,
    maxTileX: Math.min(widthTiles - 1, (x[1] + 1) * chunkTiles - 1),
    minTileZ: z[0] * chunkTiles,
    maxTileZ: Math.min(heightTiles - 1, (z[1] + 1) * chunkTiles - 1),
  };
}

/**
 * The span the earth's depth is measured from: the cover the render distance
 * ASKED for, not the one the map allowed.
 *
 * Clamped at a map edge the cover is the same size -- it slides -- but on a map
 * smaller than the cover it is the map, and that is a property of the map, not
 * of where the player is standing. Either way it holds still while they walk,
 * which is what stops the plinth's depth from invalidating every built chunk.
 */
export function earthSpanTilesFor(
  widthTiles: number, heightTiles: number, windowTilesAcross: number
): number {
  const shortSide = Math.min(widthTiles, heightTiles);
  if (windowTilesAcross <= 0) {
    return shortSide;
  }
  const cover = chunkTilesFor(windowTilesAcross) * coverChunksFor(windowTilesAcross);
  return Math.min(cover, shortSide);
}

/** Every chunk of a cover, in chunk coordinates. */
export function coverChunks(cover: ChunkCover): number[][] {
  const out: number[][] = [];
  for (let cz = cover.minChunkZ; cz <= cover.maxChunkZ; cz++) {
    for (let cx = cover.minChunkX; cx <= cover.maxChunkX; cx++) {
      out.push([cx, cz]);
    }
  }
  return out;
}

/** How a chunk is named, both in the scene and in the plans below. */
export function chunkKeyOf(chunkX: number, chunkZ: number): string {
  return chunkX + "," + chunkZ;
}

/** Whether a cover wants a given chunk. */
/**
 * Whether a TILE lies inside the cover: built or still queued, either way it
 * is ground the terrain has promised.
 *
 * This is the test for whether a body should be drawn. surfaceY() answers
 * null for a chunk that is queued but not yet built, and for the frame or two
 * a row of chunks takes to arrive that read as "nothing here" -- so every NPC
 * standing on the incoming row blinked out and back at every chunk boundary
 * (the 11 September recordings, "personages glitchen"). A queued chunk is a
 * chunk; someone standing on it stays.
 */
export function coverHasTile(cover: ChunkCover, tileX: number, tileZ: number): boolean {
  if (!cover) {
    return false;
  }
  return tileX >= cover.minTileX && tileX <= cover.maxTileX &&
         tileZ >= cover.minTileZ && tileZ <= cover.maxTileZ;
}

export function coverContains(cover: ChunkCover, chunkX: number, chunkZ: number): boolean {
  return chunkX >= cover.minChunkX && chunkX <= cover.maxChunkX &&
         chunkZ >= cover.minChunkZ && chunkZ <= cover.maxChunkZ;
}

/** What a move costs: the chunks to build, and the ones that can go. */
export interface ChunkDelta {
  /** Newly exposed: in the cover, not held. Nearest the focus first. */
  build: number[][];
  /** Left the cover: held, not wanted. */
  drop: number[][];
}

/**
 * The difference between what the cover wants and what is already held.
 *
 * `held` is every chunk that is up OR already queued, so a second step while
 * the first is still building does not queue the same chunk twice.
 *
 * Builds come out nearest-first, measured from the cover's middle chunk. What
 * the player is about to walk into is what they notice missing, and the queue
 * is drained a few chunks a frame.
 */
export function coverDelta(cover: ChunkCover, held: number[][]): ChunkDelta {
  const wanted: any = {};
  const build: number[][] = [];
  const drop: number[][] = [];
  const list = coverChunks(cover);
  for (let i = 0; i < list.length; i++) {
    wanted[chunkKeyOf(list[i][0], list[i][1])] = true;
  }
  const have: any = {};
  for (let i = 0; i < held.length; i++) {
    have[chunkKeyOf(held[i][0], held[i][1])] = true;
    if (!wanted[chunkKeyOf(held[i][0], held[i][1])]) {
      drop.push([held[i][0], held[i][1]]);
    }
  }
  const midX = (cover.minChunkX + cover.maxChunkX) / 2;
  const midZ = (cover.minChunkZ + cover.maxChunkZ) / 2;
  for (let i = 0; i < list.length; i++) {
    if (!have[chunkKeyOf(list[i][0], list[i][1])]) {
      build.push(list[i]);
    }
  }
  build.sort((a: number[], b: number[]): number => {
    const da = (a[0] - midX) * (a[0] - midX) + (a[1] - midZ) * (a[1] - midZ);
    const db = (b[0] - midX) * (b[0] - midX) + (b[1] - midZ) * (b[1] - midZ);
    return da - db;
  });
  return { build: build, drop: drop };
}
