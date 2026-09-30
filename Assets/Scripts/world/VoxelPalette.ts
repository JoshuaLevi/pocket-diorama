// Every colour a voxel can be, in one small texture.
//
// A voxel column is one solid colour: the palette of its tile's category at
// its pixel's shade, lit as a top, a floor or a side, and stepped up or down
// again by what the world around it does to that face (see VoxelDepth). The
// material path this project can rely on across 5.15 and 5.23 samples a
// texture and ignores vertex colour, so every one of those colours lives in
// one small texture and a quad points at its texel. That is the whole lighting
// model, it is four multiplies, and none of them happen per frame.

import { unpackShades } from "./WorldData";
import { TILE_PALETTES } from "./TilePalettes";
import { DEPTH_LEVELS, DEPTH_NEUTRAL, DEPTH_VALUE } from "./VoxelDepth";

/** Category slots in the texture. The last is the map's own palette, for tiles without one. */
export const PALETTE_CATEGORIES: string[] = [
  "GRASS", "TALL_GRASS", "PATH", "SAND", "WATER", "TREE", "STRUCTURE", "LEDGE",
  "DIRT", "FLOOR", "WALL", "DOOR", "ROCK", "FURNITURE", "MACHINE", "LINEN", "PLANT", "TILE", "CABINET", "MAP",
];
export const CATEGORY_MAP: number = PALETTE_CATEGORIES.length - 1;
/** The one category that moves on its own. See animatedShade. */
export const WATER_CATEGORY: number = 4;

/**
 * Brightness bands: a raised top, the ground, and one for each compass side.
 *
 * Three of these until 8 September -- top, floor, and ONE shade for every wall
 * -- which is why a voxel building read as a printed card standing on edge: its
 * four walls were the same colour, so its corners were invisible. Turning a
 * model until two of its faces catch different light is most of what makes
 * anything look solid.
 *
 * The numbers are the reference's own, measured out of its face-shading table:
 * a sun hanging south-east about 45 degrees up, giving top 1.00, south 0.90,
 * east 0.84, west 0.72, north 0.68, underside 0.55. Our floor keeps its 0.84,
 * which is the ground plane rather than a face and was already right.
 *
 * The one change worth naming: the south face used to draw at 1.00 because it
 * IS the tile's drawing and had to stay readable. It is 0.90 now, the
 * reference's value. Ten per cent does not cost the drawing anything and it
 * buys the roof-to-wall step, which is the corner a building is read by.
 *
 * All of it is baked into the palette texture, so it costs nothing per frame:
 * the mesh already carries one UV per face and this only changes which texel
 * that UV lands on.
 */
export const BAND_TOP: number = 0;
export const BAND_FLOOR: number = 1;
export const BAND_NORTH: number = 2;
export const BAND_SOUTH: number = 3;
export const BAND_WEST: number = 4;
export const BAND_EAST: number = 5;
/** Undersides and overhangs: the one face the sun never reaches. */
export const BAND_UNDER: number = 6;
/**
 * A top that something else is standing between and the sun.
 *
 * The reference casts real shadows with a second geometry pass from the sun,
 * and docs/RESEARCH-look-and-light.md ruled that out here: it is the most
 * expensive pass it has after the geometry itself. But the reference also
 * BAKES its face shading into the mesh, and a shadow is the same kind of fact
 * about a face -- it does not change from frame to frame, because neither the
 * sun nor the world moves. So it can be baked the same way, into the one UV
 * the quad already carries, and it costs nothing per frame at all.
 *
 * 0.62: below the darkest lit side (north, 0.68) so a shadow reads as a shadow
 * rather than as a face turned away, and well above the underside (0.55) so a
 * lawn in shade is still a lawn.
 */
export const BAND_SHADOW: number = 7;
export const BAND_COUNT: number = 8;
const BAND_SHADE: number[] = [1.0, 0.84, 0.68, 0.90, 0.72, 0.84, 0.55, 0.62];

/**
 * The band a wall on `side` is lit with. 0 north, 1 south, 2 west, 3 east --
 * VoxelTerrain's own encoding, and the reason this lives here is that the
 * shades do.
 */
export function bandForSide(side: number): number {
  if (side === 0) return BAND_NORTH;
  if (side === 1) return BAND_SOUTH;
  if (side === 2) return BAND_WEST;
  return BAND_EAST;
}

/** The earth under the world: two browns, checkered, as the reference dithers it. */
const EARTH: number[][] = [[122, 82, 40], [96, 62, 30]];

/**
 * 43, not 24, and 24 not 16. Fourteen categories at four shades in eight bands
 * is 448 texels; VoxelDepth's four value rungs multiply that to 1,792, and the
 * earth's sixteen sit past them, so the smallest square that holds the lot is
 * 43. A palette that does not fit wraps silently onto the wrong colours.
 *
 * The cost of the growth is 7,396 bytes of texture where there were 2,304, and
 * about four times the arithmetic in paletteTexels -- which runs when the hour
 * changes and about three times a second for the water, not per frame. No
 * geometry at all: the mesh still carries one UV per face and this only changes
 * which texel that UV lands on.
 */
/** Texels one value rung spans: every category, at every shade, in every band. */
const DEPTH_STRIDE: number = PALETTE_CATEGORIES.length * 4 * BAND_COUNT;
const EARTH_TEXEL: number = DEPTH_LEVELS * DEPTH_STRIDE;
/**
 * The smallest square that holds every rung of every category plus the two
 * earth parities -- computed, so a new category grows it by exactly what it
 * needs and no more (44 for fifteen categories; 50 for nineteen).
 */
export const PALETTE_TEXELS_ACROSS: number = Math.ceil(Math.sqrt(EARTH_TEXEL + 2 * BAND_COUNT));
export const PALETTE_TEXEL_COUNT: number = PALETTE_TEXELS_ACROSS * PALETTE_TEXELS_ACROSS;

import { gradeColour } from "./DayTint";
import { readableValue, VALUE_BANDS } from "./Legibility";

const FALLBACK_GREYS: number[][] = [[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]];

export function categoryIndexOf(name: string): number {
  const at = PALETTE_CATEGORIES.indexOf(name);
  return at < 0 ? CATEGORY_MAP : at;
}

/**
 * Texel index of a category's shade in a band, on a value rung.
 *
 * The rung is the OUTERMOST axis, so a texel's band is still `index %
 * BAND_COUNT` and its category still falls out of the remainder: every reader
 * written before there were rungs -- the suites decode a quad's band this way
 * -- keeps working, and asking for no rung asks for the neutral one, which is
 * the colour exactly as it was.
 */
export function texelIndex(categoryIndex: number, shade: number, band: number,
                           depth?: number): number {
  const rung = depth === undefined || depth === null ? DEPTH_NEUTRAL
    : depth < 0 ? 0 : depth > DEPTH_LEVELS - 1 ? DEPTH_LEVELS - 1 : Math.floor(depth);
  return rung * DEPTH_STRIDE + (categoryIndex * 4 + (shade & 3)) * BAND_COUNT + band;
}

/**
 * The earth, checkered and LIT LIKE ANY OTHER FACE.
 *
 * It was one flat brown on all four sides of the slab until 20 September, and
 * that is most of what made the rim of the diorama read as cardboard: the
 * reference's own lesson about a building whose four walls share one shade --
 * "its corners were invisible" -- is exactly as true of the plinth the whole
 * world stands on. Sixteen texels now: two browns in each of the eight bands,
 * so a slab has a sunny south side, a shaded north one, a bright bevel on top
 * and a dark underside.
 *
 * The band defaults to BAND_TOP, whose shade is 1.00, so a caller that asks
 * for earth without saying which way the face points gets exactly the colour
 * this function always returned.
 */
export function earthTexelIndex(parity: number, band: number = BAND_TOP): number {
  const b = band < 0 || band >= BAND_COUNT ? BAND_TOP : Math.floor(band);
  return EARTH_TEXEL + (parity & 1) * BAND_COUNT + b;
}

/** UV of a texel's centre: a quad with all four corners here is one flat colour. */
export function texelUv(index: number): number[] {
  const column = index % PALETTE_TEXELS_ACROSS;
  const row = Math.floor(index / PALETTE_TEXELS_ACROSS);
  // V runs bottom-up; row 0 is written at the top of the texture.
  return [
    (column + 0.5) / PALETTE_TEXELS_ACROSS,
    1 - (row + 0.5) / PALETTE_TEXELS_ACROSS,
  ];
}

/**
 * How far a category's colour is pulled toward the map's own four colours.
 *
 * The reference has no category table at all: it textures the world from the
 * cartridge's tile art and lets the MAP decide which palette recolours it, so
 * the same path tile is one colour on a route and another in a town. We have
 * a hand-authored table instead, because Red's own palettes are four colours
 * a map and the reference's colour comes from a separate colourisation mod we
 * do not have. Tinting is the middle: the table keeps the world colourful,
 * and each map's own ramp pulls it far enough that a town and a route no
 * longer wear the same paint.
 *
 * A quarter, measured by eye against the alternative of washing the greens
 * out entirely.
 */
const MAP_TINT: number = 0.25;

/**
 * How far the water's own colours turn, per step of the cartridge's animation
 * clock.
 *
 * Gen 1 animates water by ROTATING the water tile's bits every 21 frames, so
 * the wave pattern shifts across the surface. A voxel mesh cannot do that: a
 * column's colour is a UV baked into the vertex buffer and the whole point of
 * this palette is that nothing is per frame. What CAN move is which colour
 * each shade stands for, and the pattern is already in the mesh -- so turning
 * the water's three ink shades around a ring makes the crests and troughs
 * trade places, which from the chair is the same shifting water.
 *
 * Shade 0 is held out of the ring. It is the tile's paper, the light glints
 * on the surface, and rotating it makes the whole pond flash white.
 *
 * Eight steps of clock over three shades, so the pond repeats every three
 * steps rather than every eight; that is a shorter cycle than the cartridge's
 * and it reads better, because a pond that holds still for two thirds of
 * three seconds reads as a bug.
 */
const WATER_SHADES: number = 3;

/**
 * The texture's pixels, RGBA, bottom row first as setPixels wants them.
 * `tilePalettes` is the bundle's category table; `mapPalette` is the map's own
 * four colours, which fill the MAP slot and tint every other one.
 */
/**
 * Which of a category's four colours a shade wears at animation step `phase`.
 *
 * Only water moves. Everything else answers with the shade it was given, so
 * this is a no-op for thirteen of the fourteen categories and costs one
 * comparison in the one loop that builds the texture.
 */
export function animatedShade(category: number, shade: number, phase: number): number {
  if (phase <= 0 || category !== WATER_CATEGORY || shade === 0) {
    return shade;
  }
  return 1 + ((shade - 1 + phase) % WATER_SHADES);
}

/** A channel, rounded and held inside the byte the texture is written as. */
function toByte(value: number): number {
  const rounded = Math.round(value);
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
}

export function paletteTexels(tilePalettes: any, mapPalette: number[][],
                              tint?: number[], saturation?: number,
                              phase?: number, legibility?: number): Uint8Array {
  const rgba = new Uint8Array(PALETTE_TEXEL_COUNT * 4);
  // The grade lands HERE, at the one point every colour in the texture passes
  // through, so the time of day and the saturation cannot miss a category the
  // way they would if each caller applied them.
  const grade = tint || (saturation !== undefined && saturation !== 1);
  const useTint = tint ? tint : [1, 1, 1];
  const useSaturation = saturation === undefined ? 1 : saturation;
  const step = phase === undefined || phase === null ? 0 : Math.floor(phase);
  // The legibility regrade. Zero here writes exactly the bytes this function
  // wrote before it existed, which is what makes the COLOUR row a comparison.
  const readable = legibility === undefined || legibility === null ? 0 : legibility;
  const write = (index: number, raw: number[]): void => {
    const colour = grade ? gradeColour(raw, useTint, useSaturation) : raw;
    const column = index % PALETTE_TEXELS_ACROSS;
    const row = Math.floor(index / PALETTE_TEXELS_ACROSS);
    const o = ((PALETTE_TEXELS_ACROSS - 1 - row) * PALETTE_TEXELS_ACROSS + column) * 4;
    rgba[o] = colour[0];
    rgba[o + 1] = colour[1];
    rgba[o + 2] = colour[2];
    rgba[o + 3] = 255;
  };
  const fallback = mapPalette && mapPalette.length === 4 ? mapPalette : FALLBACK_GREYS;
  for (let c = 0; c < PALETTE_CATEGORIES.length; c++) {
    const name = PALETTE_CATEGORIES[c];
    // The lens's own table first, so a colour fixed here reaches a world
    // baked before it; the bundle's only for a category this build does not
    // know; the map's own colours for MAP and as the last resort.
    const own: number[][] = TILE_PALETTES[name];
    const entry = c === CATEGORY_MAP ? fallback
      : (own && own.length === 4 ? own
        : (tilePalettes && tilePalettes[name] && tilePalettes[name].length === 4
          ? tilePalettes[name] : fallback));
    const tint = c === CATEGORY_MAP ? 0 : MAP_TINT;
    for (let shade = 0; shade < 4; shade++) {
      // The animation reads a DIFFERENT colour into this shade's texels; the
      // mesh keeps pointing at the same ones, which is what makes this free.
      const source = animatedShade(c, shade, step);
      const own = entry[source];
      const toward = fallback[source];
      const tinted = [
        own[0] + (toward[0] - own[0]) * tint,
        own[1] + (toward[1] - own[1]) * tint,
        own[2] + (toward[2] - own[2]) * tint,
      ];
      // AFTER the map's own tint and BEFORE the face shading, because the band
      // is a statement about the colour a category wears, and the eight face
      // multipliers have to follow it down from there. Grading after them
      // instead would flatten every face of a voxel to one value and take the
      // solidity back out of the world.
      const mixed = readableValue(tinted, VALUE_BANDS[c], shade, readable);
      for (let band = 0; band < BAND_COUNT; band++) {
        // The band says which way the face points; the rung says what the
        // shape of the world around it does to that. One multiply apart, and
        // the mesh picks between them with the UV it already carries.
        for (let rung = 0; rung < DEPTH_LEVELS; rung++) {
          const k = BAND_SHADE[band] * DEPTH_VALUE[rung];
          write(texelIndex(c, shade, band, rung), [
            toByte(mixed[0] * k),
            toByte(mixed[1] * k),
            toByte(mixed[2] * k),
          ]);
        }
      }
    }
  }
  for (let parity = 0; parity < 2; parity++) {
    for (let band = 0; band < BAND_COUNT; band++) {
      const k = BAND_SHADE[band];
      write(earthTexelIndex(parity, band), [
        toByte(EARTH[parity][0] * k),
        toByte(EARTH[parity][1] * k),
        toByte(EARTH[parity][2] * k),
      ]);
    }
  }
  return rgba;
}

/** A tileset's pixels unpacked once, plus each tile's most common shade. */
export interface TileStats {
  sheet: Uint8Array;
  sheetWidth: number;
  tilesAcross: number;
  tileCount: number;
  /** Per tile: the shade most of its 64 pixels are; ties go to the darker. */
  majority: Uint8Array;
  categories: string[];
}

export function tileStatsFor(tileset: any): TileStats {
  const width = tileset.tileWidth;
  const height = tileset.tileHeight;
  const sheet = unpackShades(tileset.shades, width * height);
  const across = Math.floor(width / 8);
  const count = across * Math.floor(height / 8);
  const majority = new Uint8Array(count);
  for (let t = 0; t < count; t++) {
    const ox = (t % across) * 8;
    const oy = Math.floor(t / across) * 8;
    const counts = [0, 0, 0, 0];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        counts[sheet[(oy + y) * width + ox + x]]++;
      }
    }
    let best = 0;
    for (let s = 1; s < 4; s++) {
      if (counts[s] >= counts[best]) {
        best = s;
      }
    }
    majority[t] = best;
  }
  return {
    sheet: sheet,
    sheetWidth: width,
    tilesAcross: across,
    tileCount: count,
    majority: majority,
    categories: tileset.categories ? tileset.categories : [],
  };
}

/** The shade at a pixel of a tile; 0 for a tile the sheet does not have. */
export function tileShade(stats: TileStats, tile: number, px: number, py: number): number {
  if (tile < 0 || tile >= stats.tileCount) {
    return 0;
  }
  const ox = (tile % stats.tilesAcross) * 8;
  const oy = Math.floor(tile / stats.tilesAcross) * 8;
  return stats.sheet[(oy + py) * stats.sheetWidth + ox + px];
}
