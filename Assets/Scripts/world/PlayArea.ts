// The play area: how much world is on the plate, and how big it is on a table.
//
// Pure arithmetic, no Lens Studio and no scene, so the OPTION page, the voxel
// terrain and the lens itself can all read the SAME numbers and a node suite
// can state what they are. It exists because those numbers used to live in
// three places under three names -- a "render distance" in VoxelTerrain, a
// "WORLD" ladder on the OPTION page and a "zoom reference" in PokemonAR -- and
// the three disagreed about what a rung even measured.

/**
 * The ZOOM ladder, in tiles ACROSS the window. Not a radius.
 *
 * The name matters more than the numbers. The ladder this replaces was called
 * RENDER_DISTANCES and held [8, 12, 16, 24], which read as "eight tiles" and
 * meant seventeen: a radius of 8 draws 8 either side of the focus plus the
 * focus itself. Every rung on it was therefore picked for a number nobody was
 * looking at, and the tightest one -- the DEFAULT, the one every playtest ran
 * on -- put 17 tiles on a plate meant to hold the reference's 20. So the unit
 * is in the name now, the labels ARE the numbers, and there is no arithmetic
 * between what the page says and what the mesh builds.
 *
 * 20 is the Game Boy's own viewport width and the default here. 14 is a room's
 * worth, 28 is a good look down a route, 40 is most of a town and is the last
 * rung anyone should reach for on a headset that has to stay cool.
 */
export const ZOOM_TILES_ACROSS: number[] = [14, 20, 28, 40];

/** The ladder as the OPTION page prints it: the tile count, and nothing else. */
export const ZOOM_LABELS: string[] = ["14", "20", "28", "40"];

/** 20 tiles across: the reference viewport, and a 70 cm plate. */
export const ZOOM_DEFAULT: number = 1;

/**
 * How many tiles a rung shows. An index off the ladder answers the default
 * rather than an end of it, which is what a save from an older ladder gets:
 * the WORLD row's indices measured a radius, so carrying one over would be
 * reading a number in the wrong unit.
 */
export function zoomTilesAcross(index: number): number {
  if (typeof index !== "number" || !(index >= 0) || index >= ZOOM_TILES_ACROSS.length) {
    return ZOOM_TILES_ACROSS[ZOOM_DEFAULT];
  }
  return ZOOM_TILES_ACROSS[Math.floor(index)];
}

/**
 * Centimetres per map tile, for EVERY map, indoors and out.
 *
 * One constant, and that is the whole point. What stood here was
 * `DIORAMA_SPAN_CM / min(longest map side, 20)`: a rule that stretched every
 * map to the same 70 cm plate, so Red's 16-tile bedroom was drawn at 4.375 cm
 * a tile and Pallet Town at 3.5, and a schoolhouse came out the size of a
 * city. A room IS small. Holding the centimetres fixed and letting the plate
 * change size is what makes the difference visible.
 *
 * 3.5 is chosen so the default 20-tile window is 70 cm across: the width of a
 * desk, reachable from a chair, and exactly the plate every map bigger than
 * 20 tiles was already drawn at -- so nothing outdoors changes size, only the
 * interiors that were being blown up. A walkable cell is 2 tiles, so a step is
 * 7 cm and the player is about a thumb tall. The ladder's other rungs give
 * 49 cm, 98 cm and 140 cm.
 */
export const CM_PER_TILE: number = 3.5;

/** How wide a window of `tilesAcross` is on the table, in centimetres. */
export function plateSpanCm(tilesAcross: number): number {
  return tilesAcross * CM_PER_TILE;
}

/** One axis of the play area: the first and last tile it covers, inclusive. */
export interface TileSpan {
  min: number;
  max: number;
}

/**
 * One axis of the window: `tilesAcross` tiles around `focusTile`, SLID back
 * onto the map at an edge rather than clipped against it.
 *
 * This is the fix decision 1 asks for. The old rule was
 * `max(0, focus - d)` .. `min(size - 1, focus + d)`, which is a clamp: stand
 * at the north edge of a route and the window lost every row that fell off
 * the map, so the play area silently halved exactly where the player was most
 * likely to be walking. The cartridge slides its camera instead -- the view
 * stops at the map's border and the player walks off-centre inside it -- and
 * that is what this does. The size is given up ONLY when the map itself is
 * narrower than the window, which is the one case where there is nothing to
 * slide onto.
 *
 * A zero or negative `tilesAcross` means "no window": the whole map.
 *
 * An even window has no exact centre for a single tile, so the focus sits half
 * a tile past the middle. That is a quarter of a walkable cell and invisible;
 * biasing it either way costs a tile of view on one side.
 */
export function slideSpan(focusTile: number, tilesAcross: number, mapTiles: number): TileSpan {
  if (!(mapTiles > 0)) {
    return { min: 0, max: -1 };
  }
  const across = Math.round(tilesAcross);
  if (!(across > 0) || across >= mapTiles) {
    return { min: 0, max: mapTiles - 1 };
  }
  let min = Math.round(focusTile - across / 2);
  if (min + across > mapTiles) {
    min = mapTiles - across;
  }
  if (min < 0) {
    min = 0;
  }
  return { min: min, max: min + across - 1 };
}
