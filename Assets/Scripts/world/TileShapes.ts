// What a tile is SHAPED like, as opposed to what colour it is.
//
// Until now every pixel of the map became its own column and the only thing
// that varied was how tall it stood: ground 0, ledge 1, obstacle 2, tree 3,
// enclosed 5. That is why a fence came out as a low wall, a tree as a green
// pancake and a field of tall grass as a lawn with studs in it. The drawing
// was being read as a height map when most of it is not one.
//
// The reference (docs/RESEARCH-voxel-mods-and-vr.md 2.3) does not read it that
// way. It flood-fills the connected solid things, gives the mostly-background
// ones a THIN STANDING CUTOUT of their own artwork, and hand-pins a class per
// tile with a real drawn height -- fence 10 world pixels, sign 12, wall 16,
// tree 16, roof 28. Its own clips are described in exactly those terms:
// "hekken zijn losse palen met lucht ertussen", "heggen als ronde voxelhulls",
// "rijen hoog gras (staande plukjes)".
//
// We cannot hand-pin: their table covers one tileset and ours has 24 of them,
// 2,105 tiles, all built from the player's own cartridge at run time. So the
// class is MEASURED off the same three things their table encodes:
//
//   1. Is the cell walkable? Then its art is ground texture seen from above,
//      and its ink is grass blades or flowers standing on it.
//   2. Is it part of a structure two rows or taller? Then it is a building and
//      Structures.ts already folds its elevation upright.
//   3. Otherwise it is one cell tall. If most of it is BACKGROUND -- the shade
//      the walkable tiles of this tileset are mostly made of -- it is a thing
//      drawn in front of the ground rather than a piece of ground, so it
//      stands up. If it is solid ink it is a mass and keeps what it had.
//
// Measured against Kanto this calls 8 cells in Pallet Town fences and 4 signs,
// 42 fences in Viridian City, and nothing at all in Red's bedroom or on the
// second floor -- which is the behaviour the rule is meant to have.
//
// Pure: it reads a MapRuntime and a TileStats and returns numbers. Every claim
// in the comments above is a line in test/tileshapes.test.mjs.

import type { MapRuntime } from "./MapRuntime";
import type { TileStats } from "./VoxelPalette";
import { tileShade } from "./VoxelPalette";

/** Ground, water, a path: flat, and the old per-pixel relief still applies. */
export const SHAPE_FLAT: number = 0;
/** Walkable art whose ink stands up in tufts: tall grass, flowers. */
export const SHAPE_TUFT: number = 1;
/** A tree: a round stepped hull over the whole cell. */
export const SHAPE_CANOPY: number = 2;
/** A prop: the cell's drawing stood upright, thin, on synthesised ground. */
export const SHAPE_STANDING: number = 3;
/** A solid obstacle, as before: one flat mass. */
export const SHAPE_MASS: number = 4;
/** A ledge: a low lip you hop down, the whole cell, its drawing on its face. */
export const SHAPE_LIP: number = 5;
/**
 * A hedge: a one-cell-tall mass of foliage outdoors, given the same round
 * hull a tree gets.
 *
 * Route 1 is lined with 52 cells of tiles 64/65/80/81 -- a dark dither with
 * no straight edge in it, which is a bush. The structure detector measured
 * them at two rows and folded their drawing up as if they were a wall, so the
 * route was walled in by eight-voxel cards with foliage printed on them. The
 * reference's own words for what they should be: "heggen als ronde
 * voxelhulls".
 */
export const SHAPE_HEDGE: number = 6;

/**
 * Voxels along one tile edge, and along one cell edge.
 *
 * Duplicated from VoxelTerrain rather than imported because that module
 * imports this one; two constants that must agree is a smaller price than a
 * cycle, and the test asserts they are equal.
 */
export const VOXELS_PER_TILE: number = 4;
const CELL_VOXELS: number = VOXELS_PER_TILE * 2;

/**
 * Heights, in voxels. One voxel is two Game Boy pixels, so these are the
 * reference's own world-pixel classes halved: fence 10 px, sign 12, tree 16.
 *
 * The tree is the one that changes the most. It stood 3 voxels -- six pixels,
 * a pancake -- next to houses of 24. The reference stands it at a full cell,
 * so a tree is a third of a house rather than an eighth of one, and that
 * ratio is most of why their Route 1 reads as a landscape and ours as a rug.
 */
export const CANOPY_PEAK: number = 8;
/** What a canopy never falls below, so a border treeline stays a wall. */
export const CANOPY_RIM: number = 3;
/** Tall grass. Half a cell: high enough to stand in, low enough to see over. */
export const TUFT_VOXELS: number = 3;
/**
 * ...and what the thinner half of the dither stands at.
 *
 * Standing every dark block at the full height drew a solid green carpet with
 * a flat top: at a 25 degree camera the blades occlude each other completely
 * and only the far edge of a patch shows any of them. Measured on tile 82,
 * eight of its sixteen blocks are half ink or more and only three are nearly
 * solid. Standing those three tall and the rest low is what turns the carpet
 * back into the reference's "staande plukjes" -- clumps with air between.
 */
export const TUFT_LOW: number = 1;
/** Ink pixels in a 2x2 block, out of four, before a blade stands full height. */
const TUFT_TALL_INK: number = 3;
/** ...and before it stands at all. */
const TUFT_ANY_INK: number = 2;
/**
 * A ledge: a lip, not a wall.
 *
 * The reference pins six world pixels, which is three of our voxels, and three
 * is wrong here for a reason our coarser voxel causes. A band is four Game Boy
 * pixels tall, so the third band of a folded ledge reads the tile's LIGHT rows
 * and every ledge on Route 1 came out a cream-and-black stripe -- a route full
 * of railway sleepers. Two bands stop below that and the ledges read as the
 * dark lips they are drawn as.
 */
export const LEDGE_VOXELS: number = 2;
/** Flowers and the dabs of texture on a lawn: one voxel, as the relief was. */
export const DETAIL_VOXELS: number = 1;
/** The tallest a prop's cutout may stand: one cell, the reference's wall. */
export const STANDING_MAX: number = 8;
/** How deep a prop's plate is, in voxels. Four pixels, the reference's six. */
export const STANDING_THICK: number = 2;

/** A prop plate lying east-west (thin in Z), the default and the sign's. */
export const AXIS_EW: number = 0;
/** A prop plate lying north-south (thin in X): a fence running up the map. */
export const AXIS_NS: number = 1;

/**
 * A structure this tall or shorter is still something you look OVER, so it is
 * a candidate for standing up as a prop. Two tile rows is one cell: the
 * Pallet Town fence is exactly this, drawn as tile 14 over tile 85.
 */
export const PROP_MAX_ROWS: number = 2;
/**
 * How much of a cell's 256 pixels must be background before it is a prop.
 *
 * 30% chosen against the map, not the tile sheet: at this threshold Pallet
 * Town's fences and signs pass and all 103 of its building cells fail, and
 * Red's bedroom -- where standing a wall up as a plate would open a hole --
 * produces none at all.
 */
const PROP_BACKGROUND: number = 77;
/**
 * ...and how much ink it must have to be worth drawing. Route 1 has blocked
 * cells whose art is plain grass -- Gen 1's invisible walls. Standing those
 * up draws nothing at all, so they stay a mass and keep their mound.
 */
const PROP_MIN_INK: number = 24;

/**
 * What a tileset uses for air, and how much of each tile is it.
 *
 * Built once per map. `blank` and `ink` are per TILE, not per cell, so the
 * cell test is four lookups rather than 256.
 */
export interface ShapeProfile {
  /** The shade the walkable tiles of this tileset are mostly made of. */
  background: number;
  /** Per tile: how many of its 64 pixels are the background shade. */
  blank: Uint8Array;
  /** Per tile: how many are ink, meaning shade 2 or darker. */
  ink: Uint8Array;
  /** Per tile: the majority shade of its ink, for a prop's own colour. */
  inkShade: Uint8Array;
  /**
   * Whether this MAP may have props at all.
   *
   * A prop is a thin plate standing on ground you can see round it -- a sign,
   * a fence, a rock -- and the rest of the cell is drawn as floor. That is
   * right for a fence beside a path and catastrophic for a forest: measured
   * over the whole cartridge, VIRIDIAN_FOREST reads as 913 blocked cells and
   * 913 props, so every tree in it was a cardboard cut-out standing on
   * walkable-looking ground. The wearer's report is exactly that -- "op
   * plekken dat ik denk dat ik ergens doorheen kan lopen stoot ik tegen een
   * muur op" -- and the count says it is not an impression: every wall in the
   * forest was drawn as floor.
   *
   * The cause is the data. The prop test asks "is this mostly background with
   * some ink on it", which is what a sign looks like, and a forest tileset
   * whose categories are all STRUCTURE gives its trees exactly that shape.
   * Rather than guess a better per-tile test, this asks a question the map can
   * answer: if the reading claims MOST of a map's blocked cells, the reading
   * is wrong for that map. See PROP_MAP_SHARE.
   */
  propsAllowed: boolean;
}

/**
 * The most of a map's blocked cells that may be props before none of them are.
 *
 * Measured over all 188 maps with twenty or more blocked cells, and there is a
 * clean gap to put the line in. Above it: VIRIDIAN_FOREST at 100%, the four
 * SAFARI_ZONE maps at 67 to 77, ROUTE_23 at 70, SAFFRON_CITY at 54. Below it:
 * CELADON_CITY at 36, INDIGO_PLATEAU at 35, ROUTE_13 at 29, and everything
 * else under a quarter. Seven maps change and 181 do not.
 *
 * Half is also the honest meaning of the rule rather than a fitted number: a
 * prop stands in a world, so if the props ARE the world, they are not props.
 */
export const PROP_MAP_SHARE: number = 0.5;

/**
 * The profile of one tileset.
 *
 * The background shade is measured off the WALKABLE tiles rather than assumed
 * to be white, because it is not always white: the Ship is drawn on shade 2
 * and the Mart on shade 1, and reading those sheets as if white were air
 * would stand a whole shop floor on end.
 */
export function shapeProfileFor(map: MapRuntime, stats: TileStats): ShapeProfile {
  const counts = [0, 0, 0, 0];
  const walkable = map.tileset.walkable ? map.tileset.walkable : [];
  for (let i = 0; i < walkable.length; i++) {
    const tile = walkable[i];
    if (tile < 0 || tile >= stats.tileCount) {
      continue;
    }
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        counts[tileShade(stats, tile, x, y)]++;
      }
    }
  }
  let background = 0;
  for (let s = 1; s < 4; s++) {
    if (counts[s] > counts[background]) {
      background = s;
    }
  }
  const blank = new Uint8Array(stats.tileCount);
  const ink = new Uint8Array(stats.tileCount);
  const inkShade = new Uint8Array(stats.tileCount);
  for (let t = 0; t < stats.tileCount; t++) {
    let blankCount = 0;
    let inkCount = 0;
    const shades = [0, 0, 0, 0];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const shade = tileShade(stats, t, x, y);
        if (shade === background) {
          blankCount++;
        }
        if (shade >= 2) {
          inkCount++;
          shades[shade]++;
        }
      }
    }
    blank[t] = blankCount;
    ink[t] = inkCount;
    inkShade[t] = shades[3] > shades[2] ? 3 : 2;
  }
  const profile: ShapeProfile = {
    background: background, blank: blank, ink: ink, inkShade: inkShade,
    // Assumed while it is being measured; propLooks() does not read it.
    propsAllowed: true,
  };
  profile.propsAllowed = propsFitThisMap(map, stats, profile);
  return profile;
}

/**
 * Whether reading this map's blocked cells as props makes sense for it.
 *
 * One pass over the cells, once per map load, next to the pass this function
 * already does over the tiles. See PROP_MAP_SHARE for the number and for what
 * it costs.
 */
function propsFitThisMap(map: MapRuntime, stats: TileStats, profile: ShapeProfile): boolean {
  if (!isOutdoors(map)) {
    return true;
  }
  let blocked = 0;
  let props = 0;
  for (let cellY = 0; cellY < map.heightCells; cellY++) {
    for (let cellX = 0; cellX < map.widthCells; cellX++) {
      if (map.isWalkable(cellX, cellY)) {
        continue;
      }
      blocked++;
      if (propLooks(map, stats, profile, cellX, cellY, 0)) {
        props++;
      }
    }
  }
  // A map with almost nothing blocked has nothing to be wrong about.
  return blocked < 20 || props <= blocked * PROP_MAP_SHARE;
}

/** The four tiles of a cell, north-west first, reading across then down. */
function cellTiles(map: MapRuntime, cellX: number, cellY: number): number[] {
  const tx = cellX * 2;
  const ty = cellY * 2;
  return [map.tileAt(tx, ty), map.tileAt(tx + 1, ty),
          map.tileAt(tx, ty + 1), map.tileAt(tx + 1, ty + 1)];
}

/** Background pixels in a whole cell, out of 256. */
function cellBlank(profile: ShapeProfile, tiles: number[]): number {
  let total = 0;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    total += tile >= 0 && tile < profile.blank.length ? profile.blank[tile] : 0;
  }
  return total;
}

/** Ink pixels in a whole cell, out of 256. */
function cellInk(profile: ShapeProfile, tiles: number[]): number {
  let total = 0;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    total += tile >= 0 && tile < profile.ink.length ? profile.ink[tile] : 0;
  }
  return total;
}

/**
 * Whether this tileset is OUTDOORS, from the cartridge's own data.
 *
 * The tilesets with a wild-encounter grass tile are exactly OVERWORLD, FOREST
 * and PLATEAU -- the three the baker also calls outdoor -- and every interior
 * and cave has none. So the question needs no list of our own: it is one field
 * the ROM already answers.
 *
 * It matters because a two-row mass outdoors is a hedge and a two-row mass
 * indoors is Oak's counter, and rounding a counter into a dome would put the
 * three starter Pokeballs on a hill.
 */
export function isOutdoors(map: MapRuntime): boolean {
  // typeof first. An interior's grassTile arrives from the bundle as null, and
  // `null >= 0` is TRUE in JavaScript -- which made every room in Kanto read
  // as outdoors and turned Oak's counter into a bush.
  const grass = map.tileset.grassTile;
  return typeof grass === "number" && grass >= 0;
}

/**
 * Whether a blocked cell is a PROP: something drawn standing in front of the
 * ground, rather than a piece of the ground or a building.
 *
 * `structureRows` is what Structures.ts measured for the cell, so a house
 * never reaches the pixel test at all. This is called from BOTH sides -- the
 * detector uses it to leave props out of its volumes, and the column builder
 * uses it to stand them up -- and the two must agree, which is why the answer
 * lives in one function.
 */
export function isPropCell(
  map: MapRuntime, stats: TileStats, profile: ShapeProfile,
  cellX: number, cellY: number, structureRows: number
): boolean {
  // The map's own veto, measured once when the profile was built. A forest is
  // not a field of signs. See ShapeProfile.propsAllowed.
  if (!profile.propsAllowed) {
    return false;
  }
  return propLooks(map, stats, profile, cellX, cellY, structureRows);
}

/**
 * Whether a cell LOOKS like a prop, ignoring whether the map allows any.
 *
 * Split out so the map-level count can be taken without asking a question that
 * depends on its own answer.
 */
function propLooks(
  map: MapRuntime, stats: TileStats, profile: ShapeProfile,
  cellX: number, cellY: number, structureRows: number
): boolean {
  // OUTDOORS only, and this is not a shortcut -- it is the one place the
  // background measurement stops meaning anything. "Mostly background" reads
  // as "drawn in front of the ground" because outdoor air is drawn as the
  // grass showing through. A cave has no air: its floor is a busy dither whose
  // majority shade is 2, and its walls are full of shade 2 as well, so the
  // rock passed the test and Seafoam Islands B4F stood its walls up as thin
  // plates -- 39% more geometry and a cave with pillars in it that Gen 1 never
  // drew. The Ship is worse: its dock's walkable tiles are mostly BLACK, so
  // black became air.
  //
  // Trying to separate the two by how strongly the background dominates does
  // not work: measured over all 24 tilesets, OVERWORLD is 37% and CAVERN is
  // 40%. The reference's own prop table is for its outdoor tileset, and this
  // is the same boundary. What it costs indoors is almost nothing -- the rule
  // found 0 props in Red's bedroom and 2 in Oak's lab.
  if (!isOutdoors(map)) {
    return false;
  }
  if (map.isWalkable(cellX, cellY)) {
    return false;
  }
  if (structureRows > PROP_MAX_ROWS) {
    return false;
  }
  const tiles = cellTiles(map, cellX, cellY);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const category = tile < stats.categories.length ? stats.categories[tile] : "";
    // A tree has its own hull and water has its own level; neither is a prop
    // however much sky is drawn around it.
    if (category === "TREE" || category === "WATER") {
      return false;
    }
  }
  return cellBlank(profile, tiles) >= PROP_BACKGROUND &&
         cellInk(profile, tiles) >= PROP_MIN_INK;
}

/**
 * Whether a blocked cell is a HEDGE: foliage one cell tall, outdoors.
 *
 * Unlike a prop, the DETECTOR still claims a hedge: it has to, because the row
 * count it measures is the very thing that says "one cell tall". The column
 * builder takes it back, which is why the shape library runs before the volume
 * branch rather than after it -- and why turning SHAPES off leaves hedges as
 * the walls they were, with nothing to undo.
 */
export function isHedgeCell(
  map: MapRuntime, stats: TileStats, profile: ShapeProfile,
  cellX: number, cellY: number, structureRows: number
): boolean {
  if (structureRows !== PROP_MAX_ROWS || !isOutdoors(map)) {
    return false;
  }
  if (map.isWalkable(cellX, cellY)) {
    return false;
  }
  // A prop is the other thing a one-cell mass can be, and it has already been
  // asked; a hedge is what is left when there is too much ink to stand up.
  return !isPropCell(map, stats, profile, cellX, cellY, structureRows);
}

/** Whether every tile of a cell is the given category. */
function cellIs(map: MapRuntime, stats: TileStats, cellX: number, cellY: number,
                category: string): boolean {
  const tiles = cellTiles(map, cellX, cellY);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const name = tile < stats.categories.length ? stats.categories[tile] : "";
    if (name !== category) {
      return false;
    }
  }
  return true;
}

/** How many of a cell's four tiles are trees. */
function treeTiles(map: MapRuntime, stats: TileStats, cellX: number, cellY: number): number {
  const tiles = cellTiles(map, cellX, cellY);
  let count = 0;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const name = tile < stats.categories.length ? stats.categories[tile] : "";
    if (name === "TREE") {
      count++;
    }
  }
  return count;
}

/** Whether ANY tile of a cell is the given category. */
function cellHas(map: MapRuntime, stats: TileStats, cellX: number, cellY: number,
                 category: string): boolean {
  const tiles = cellTiles(map, cellX, cellY);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const name = tile < stats.categories.length ? stats.categories[tile] : "";
    if (name === category) {
      return true;
    }
  }
  return false;
}

/**
 * The shape class of one cell.
 *
 * Order matters and is the rule read top to bottom: a tree is a tree wherever
 * it stands, a measured building is a building, a mostly-air obstacle is a
 * prop, walkable art with ink in it is tufts, and everything else keeps what
 * it had.
 */
export function shapeForCell(
  map: MapRuntime, stats: TileStats, profile: ShapeProfile,
  cellX: number, cellY: number, structureRows: number
): number {
  // A tree needs HALF the cell, and no water in it. Asking whether ANY tile is
  // a tree domed the shoreline: a pond's edge cell is part water and part
  // tree, so the hull lifted the water three voxels out of its own pond and
  // Pallet Town's pond grew a crenellated blue wall. 192 columns of water were
  // standing proud when this was measured.
  if (treeTiles(map, stats, cellX, cellY) >= 2 &&
      !cellHas(map, stats, cellX, cellY, "WATER")) {
    return SHAPE_CANOPY;
  }
  if (isHedgeCell(map, stats, profile, cellX, cellY, structureRows)) {
    return SHAPE_HEDGE;
  }
  // The measured building comes BEFORE walkability, and the reason is the
  // folded door. A door has to be walkable -- you step into it -- but it is
  // drawn IN the front wall, so Structures.ts folds it into the wall above it.
  // Asking "is it walkable" first handed those cells to flat ground and
  // punched a notch through every doorway in Kanto: 192 columns of Cinnabar
  // Lab dropped from 24 voxels to 0, which is exactly its three doors.
  if (structureRows > 0) {
    return SHAPE_MASS;
  }
  if (map.isWalkable(cellX, cellY)) {
    if (cellHas(map, stats, cellX, cellY, "TALL_GRASS")) {
      return SHAPE_TUFT;
    }
    return SHAPE_FLAT;
  }
  if (cellHas(map, stats, cellX, cellY, "LEDGE")) {
    // A ledge is drawn as a lip and read as a hop. Standing its whole drawing
    // up made a wall across the route you could not see over, which is the
    // opposite of what a ledge is for.
    return SHAPE_LIP;
  }
  if (isPropCell(map, stats, profile, cellX, cellY, structureRows)) {
    return SHAPE_STANDING;
  }
  return SHAPE_MASS;
}

/**
 * Which way a prop's plate lies: along its run.
 *
 * A fence is a line of cells, and standing each cell's drawing up facing south
 * turns a north-south fence into a ladder of loose boards with gaps between
 * them. Following the run instead keeps the fence a fence whichever way it
 * goes. A prop with no neighbours -- a sign, a lone rock -- lies east-west,
 * which is the way its drawing is meant to be read.
 */
export function propAxis(
  map: MapRuntime, stats: TileStats, profile: ShapeProfile, cellX: number, cellY: number
): number {
  const prop = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= map.widthCells || cy >= map.heightCells) {
      return false;
    }
    if (map.isWalkable(cx, cy)) {
      return false;
    }
    return isPropCell(map, stats, profile, cx, cy, 0);
  };
  const alongX = prop(cellX - 1, cellY) || prop(cellX + 1, cellY);
  const alongZ = prop(cellX, cellY - 1) || prop(cellX, cellY + 1);
  if (alongZ && !alongX) {
    return AXIS_NS;
  }
  return AXIS_EW;
}

/**
 * The height of one column of a tree's hull, in voxels.
 *
 * A dome would give every one of the 64 columns a different height and so a
 * side face on all four of its edges. Rings do not: within a ring the columns
 * are level and emit nothing, so the cost is the ring boundaries alone -- and
 * a stepped hull is the right answer among voxels anyway, which is what the
 * reference's "ronde voxelhull" is a picture of.
 *
 * `u` and `v` are the column's place in the CELL, 0..7 either way.
 */
export function canopyHeight(u: number, v: number): number {
  const du = u - (CELL_VOXELS - 1) / 2;
  const dv = v - (CELL_VOXELS - 1) / 2;
  const r = Math.sqrt(du * du + dv * dv);
  if (r < 1.5) {
    return CANOPY_PEAK;
  }
  if (r < 2.6) {
    return CANOPY_PEAK - 2;
  }
  if (r < 3.7) {
    return CANOPY_PEAK - 4;
  }
  return CANOPY_RIM;
}

/**
 * The elevation of a prop, one height per pixel-pair across its drawing.
 *
 * The cell's drawing is an ELEVATION: its top row is the top of the thing and
 * its bottom row stands on the ground. So a column's height is where its
 * topmost ink is, counted down from the top of the cell. Two Game Boy pixels
 * to a voxel, which is why a 14-pixel fence post comes out 7 voxels tall, and
 * a column with no ink at all comes out 0 -- the air between two posts.
 *
 * Eight entries, left to right across the cell.
 */
export function standingProfile(
  map: MapRuntime, stats: TileStats, profile: ShapeProfile, cellX: number, cellY: number
): Int8Array {
  const out = new Int8Array(CELL_VOXELS);
  for (let u = 0; u < CELL_VOXELS; u++) {
    let top = -1;
    for (let py = 0; py < 16 && top < 0; py++) {
      for (let k = 0; k < 2; k++) {
        const px = u * 2 + k;
        const tile = map.tileAt(cellX * 2 + (px >> 3), cellY * 2 + (py >> 3));
        if (tileShade(stats, tile, px & 7, py & 7) !== profile.background) {
          top = py;
          break;
        }
      }
    }
    if (top < 0) {
      out[u] = 0;
      continue;
    }
    let height = Math.round((16 - top) / 2);
    if (height > STANDING_MAX) {
      height = STANDING_MAX;
    }
    out[u] = height < 1 ? 1 : height;
  }
  return out;
}

/**
 * The height of the plate at one place along it.
 *
 * East-west the drawing is read straight: column u of the plate is column u of
 * the drawing, so a fence keeps its posts and the air between them. North-south
 * there is no second drawing to read -- the artwork only ever shows one
 * elevation -- so the plate is swept at its own tallest, which keeps a fence
 * running up the map a continuous fence instead of a ladder of loose boards.
 */
export function standingHeightAt(profile: Int8Array, axis: number, along: number): number {
  if (axis === AXIS_EW) {
    return along >= 0 && along < profile.length ? profile[along] : 0;
  }
  let tallest = 0;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > tallest) {
      tallest = profile[i];
    }
  }
  return tallest;
}

/**
 * Whether a column of the plate's band carries the plate.
 *
 * `across` is the column's place across the plate, 0..7. The plate is
 * STANDING_THICK voxels of it, centred, so the ground shows on both sides.
 */
export function standingBand(across: number): boolean {
  const first = (CELL_VOXELS - STANDING_THICK) >> 1;
  return across >= first && across < first + STANDING_THICK;
}

/**
 * How tall one blade of tall grass stands, from how much ink its 2x2 block
 * has. Returns 0 for the gaps you can see the ground through.
 */
export function tuftHeight(inkPixels: number): number {
  if (inkPixels >= TUFT_TALL_INK) {
    return TUFT_VOXELS;
  }
  return inkPixels >= TUFT_ANY_INK ? TUFT_LOW : 0;
}

/** Ink pixels, out of four, in one 2x2 block of a tile. */
export function blockInk(stats: TileStats, tile: number, vx: number, vz: number): number {
  let ink = 0;
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      if (tileShade(stats, tile, vx * 2 + px, vz * 2 + py) >= 2) {
        ink++;
      }
    }
  }
  return ink;
}

/**
 * The tile a prop's synthesised ground should be drawn with: the nearest
 * walkable neighbour's own art, so a fence stands on grass rather than on
 * building cream.
 *
 * Looks south first because that is the side facing the camera and the side
 * the drawing already assumes it is standing on.
 */
export function propGroundTile(map: MapRuntime, cellX: number, cellY: number): number {
  const steps = [0, 1, 0, -1, -1, 0, 1, 0];
  for (let s = 0; s < 8; s += 2) {
    const cx = cellX + steps[s];
    const cy = cellY + steps[s + 1];
    if (cx < 0 || cy < 0 || cx >= map.widthCells || cy >= map.heightCells) {
      continue;
    }
    if (map.isWalkable(cx, cy)) {
      return map.tileAt(cx * 2, cy * 2 + 1);
    }
  }
  return map.tileAt(cellX * 2, cellY * 2 + 1);
}
