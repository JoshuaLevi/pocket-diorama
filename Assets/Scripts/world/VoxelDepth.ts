// The shading a voxel gets from the SHAPE of the world around it, rather than
// from which way its face points.
//
// VoxelPalette already lights a face by its compass direction, and that turned
// a building from a printed card into a box. It cannot do anything for a lawn:
// every top face of every grass column points the same way, so a field is one
// flat wash of one colour, and a tree standing in it meets the ground with no
// seam at all. Form is what is missing, and form is two facts:
//
//   CREVICE. A face with something taller beside it sees less of the sky. At
//   four voxels to a tile a column's top is a quarter of a tile, so darkening
//   the tops that have a taller neighbour draws a one-voxel contact line right
//   where a tree, a wall or a bank meets the ground -- which is the shadow the
//   eye actually uses to decide that two things are touching. A wall face gets
//   the same treatment from the columns FLANKING it: a face in the inside
//   corner of a building is in a nook and is darker than one on the open side.
//
//   LIFT. Half the tiles, chosen by a hash of their MAP coordinates, take a
//   small step up in value. A lawn stops being a wash and becomes a lawn.
//
// Both are one number per quad, and that number picks a different TEXEL in the
// palette the quad was already pointing at. No extra quad, no extra vertex, no
// second UV channel, no vertex colour, no shader: those are the four things
// this project cannot afford or cannot ship (see VoxelPalette's header and
// ChunkGeometry's). The whole cost is a taller palette texture.
//
// Keyed to the MAP, never to the window. The window re-anchors every time the
// player crosses a tile, so a pattern keyed to the window's own columns would
// repaint the entire world at every step -- it would crawl, which is the one
// thing worse than a flat wash. test/voxeldepth.test.mjs builds the same chunk
// under two windows a tile apart and demands the vertices come out identical.

/** How many value steps the palette carries for every colour it holds. */
export const DEPTH_LEVELS: number = 4;

/**
 * The step a plain face on flat ground wears.
 *
 * It is 1 rather than 0 because there is one rung ABOVE it: the lift is a step
 * up, not a step down, so half a lawn keeps exactly the colour it had and the
 * other half brightens. A ladder that only darkened would have quietly dimmed
 * the whole world, and dimming the world is the next stage's decision to make,
 * not this one's.
 */
export const DEPTH_NEUTRAL: number = 1;

/**
 * What each rung multiplies a colour by, after its band has already shaded it.
 *
 * Six per cent up and eight per cent down a rung. Small on purpose: this runs
 * on optical see-through glasses where the world is already competing with a
 * lit room, and a contact shadow only has to be seen, not read. Two rungs of
 * crevice is sixteen per cent, which against the band shading a wall already
 * carries is a clearly visible seam without any face going black.
 */
export const DEPTH_VALUE: number[] = [1.06, 1.0, 0.92, 0.84];

/**
 * The most steps of crevice any one face can take.
 *
 * Two, because the ladder has exactly two rungs below neutral, and because
 * three surfaces leaning over a voxel is a hole nobody can see into anyway.
 */
export const MAX_OCCLUSION: number = 2;

/**
 * Which rung a face stands on: its tile's lift up, what leans over it down.
 *
 * A lift cannot cancel a crevice -- a lifted tile in a corner is still darker
 * than open ground -- because the lift is a property of the tile and the
 * crevice is a property of the shape, and the shape is what the eye is reading.
 */
export function depthIndex(lift: number, occlusion: number): number {
  let step = DEPTH_NEUTRAL - (lift > 0 ? 1 : 0) + (occlusion > 0 ? Math.floor(occlusion) : 0);
  if (step < 0) {
    step = 0;
  }
  if (step > DEPTH_LEVELS - 1) {
    step = DEPTH_LEVELS - 1;
  }
  return step;
}

/**
 * Whether a tile takes the lift: a hash of its position on the MAP, 0 or 1.
 *
 * Two odd multipliers into a xorshift. Every step is an operation JavaScript
 * does exactly on 32 bits, so the Lens runtime and the Node suite answer the
 * same thing for the same tile -- and, more to the point, so does the same
 * tile on the next frame, the next chunk rebuild and the next run. A random
 * number here would shimmer.
 */
export function tileLift(tileX: number, tileZ: number): number {
  let h = ((tileX * 0x1f1f1f1f) ^ (tileZ * 0x2545f49)) | 0;
  // Xorshift is stuck at zero; the golden-ratio constant makes sure it never
  // starts there, which would have handed tile (0, 0) a special case.
  h = (h + 0x9e3779b9) | 0;
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return (h >>> 11) & 1;
}

/**
 * How many of a column's four neighbours stand over its top face.
 *
 * Strictly taller: a neighbour at the same height is the rest of the same
 * surface and leans over nothing.
 */
export function topOcclusion(
  h: number, north: number, south: number, west: number, east: number
): number {
  let n = 0;
  if (north > h) n++;
  if (south > h) n++;
  if (west > h) n++;
  if (east > h) n++;
  return n > MAX_OCCLUSION ? MAX_OCCLUSION : n;
}

/**
 * The same, for a wall face on `side` -- 0 north, 1 south, 2 west, 3 east,
 * VoxelTerrain's own encoding.
 *
 * A wall reads the two columns FLANKING it, not the one in front: the column
 * in front is the one the wall drops to, so it is lower by construction and
 * shades nothing. A flank taller than the column itself sticks out past the
 * face and puts it in a nook, which is what darkens the inside corners of a
 * building and the gaps between trees in a wood.
 */
export function sideOcclusion(
  side: number, h: number, north: number, south: number, west: number, east: number
): number {
  const a = side <= 1 ? west : north;
  const b = side <= 1 ? east : south;
  let n = 0;
  if (a > h) n++;
  if (b > h) n++;
  return n > MAX_OCCLUSION ? MAX_OCCLUSION : n;
}
