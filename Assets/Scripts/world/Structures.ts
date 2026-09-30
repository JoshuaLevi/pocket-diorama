// Buildings, measured off the drawing instead of guessed.
//
// The old rule made a house a mound: every 2x2-pixel block got its own
// height from four lines of guesswork -- walkable 0, water -1, tree 3, an
// obstacle whose four neighbours are also obstacles 5, else 2 -- so a house
// came out as a lumpy field between one and six voxels with no flat roof,
// no wall and no eave.
//
// The reference does not guess. It reads the height out of the artwork: a
// Gen 1 house is SIX ROWS of drawing, so it is six rows tall. Written down,
// its rule is:
//
//   1. Flood-fill the connected upright tiles into a region.
//   2. Per column, walk the contiguous vertical run of that region upward
//      from its southmost tile. The run's length is the drawn extent.
//   3. If the run REPEATS -- a tile above the front tile equals it -- the
//      repeat period is the drawn unit, not the extent. This is what stops a
//      forty-row border forest becoming one monolith while a six-row house
//      stays six rows.
//   4. The region votes: the modal height wins, so a house is one clean mass
//      rather than a staircase. A column that read a repeat adopts the vote
//      when the vote is taller (the column above a doorway repeats
//      internally but belongs to a house); a column that read its full
//      extent keeps its own (an attached low wing stays low).
//
// Pure and window-free: it reads MapRuntime and returns numbers, so a test
// can state "Pallet Town's houses are six rows" without a scene.

import type { MapRuntime } from "./MapRuntime";
import type { TileStats } from "./VoxelPalette";
import type { ShapeProfile } from "./TileShapes";
import { isPropCell, isOutdoors } from "./TileShapes";
import { indoorCellRows, indoorCellSunk } from "./IndoorKinds";

/** Tallest thing the detector will build, in tile rows. Six rows is a house. */
export const MAX_STRUCTURE_ROWS: number = 6;
/** Shortest run worth standing up; below this the old per-pixel look is better. */
export const MIN_STRUCTURE_ROWS: number = 2;
/**
 * How tall a thing indoors is allowed to stand, in tile rows.
 *
 * Indoors the run length is not a height at all -- see StructureField.roofed --
 * so it cannot be used as one, and something else has to say how tall a
 * cupboard is. These two numbers are that something, and they are picked off
 * the room rather than out of the air: a Gen 1 interior draws its plain wall as
 * exactly two tile rows, so the wall is the ceiling of the scale and nothing
 * standing in the room may out-top it.
 *
 * SHELL is the room itself, the flood-filled region that reaches the map's
 * outer ring. FURNITURE is anything that does not: a table, a bench, a counter,
 * a bed, an island of shelving. It is one row -- half the wall, and about half
 * the player -- because a thing you walk around should read as lower than the
 * room that contains it.
 *
 * Measured before this rule: 4,283 interior cells stood at six rows and 2,331
 * at four, in rooms whose own walls are two. Red's dining table was 15 voxels
 * against a player of 8.8.
 */
export const INDOOR_SHELL_ROWS: number = 2;
export const INDOOR_FURNITURE_ROWS: number = 1;

/** Rows of a tall enough drawing that slope as a roof. */
export const ROOF_ROWS: number = 2;
/** Shortest run that gets a roof at all. A fence is not a house. */
const MIN_ROOF_ROWS: number = 4;

/**
 * Categories that stand up as a volume. Trees, ledges and water keep the
 * per-pixel treatment: a tree reads as a lumpy green blob because its pixels
 * stand, and folding one into a box would lose that.
 */
const UPRIGHT_CATEGORIES: string[] = ["STRUCTURE", "WALL", "DOOR", "ROCK"];

export interface StructureField {
  minTileX: number;
  minTileY: number;
  width: number;
  height: number;
  /** Height in tile rows, 0 where the tile is not part of a structure. */
  rows: Int8Array;
  /** Tile Y of the northmost row of this column's run; -1 when there is none. */
  north: Int16Array;
  /** Tile Y of the southmost row of this column's run; -1 when there is none. */
  front: Int16Array;
  /**
   * Rows of the drawing that are roof rather than wall, so the top slopes
   * instead of lying flat. 0 for a flat rooftop, which is what a repeated
   * roof texture -- the lab, a Mart -- actually is.
   */
  roofRows: Int8Array;
  /**
   * Whether the volumes on this map are ROOFED: gabled on top, with an eave
   * hanging off every outward face.
   *
   * True outdoors and false indoors, and the reason is what the cartridge's
   * drawing MEANS. Outdoors a building is drawn in ELEVATION -- a Gen 1 house
   * is six rows of front wall and roof seen from the side, which is why
   * folding those rows upright recovers the building. Indoors the same
   * tileset draws furniture in PLAN: the four rows of Red's dining table are
   * its footprint on the floor, not its height. Folding a floor plan upright
   * gave that table a 15-voxel gabled volume -- 13.1 cm against a player of
   * 7.7 cm, two thirds of a real house and wearing a house's silhouette.
   *
   * That is the whole of "in een huis ziet het eruit alsof de kasten mini
   * huisjes zijn" (11 September): a gable and an overhanging eave ARE what
   * reads as a house, so indoors there is neither. Height is left alone here
   * -- it is a separate question with its own answer.
   */
  roofed: boolean;
  /**
   * Per tile: 1 where this volume is BUILT, 0 where it is landscape.
   *
   * A building's elevation is a drawing and its faces have to carry it row by
   * row -- that is what pushFacade is for, and it is why a window is a window.
   * A cliff has no elevation: its art is a texture, and folding it voxel by
   * voxel spends a quad per voxel of height to say nothing the merged wall
   * would not have said. Route 23 is 6,944 tiles of six-row rock, so it is
   * most of that map.
   */
  built: Uint8Array;
}

/**
 * Whether this run's top rows read as a PITCHED roof.
 *
 * Gen 1 draws two kinds and they must not be confused. A pitched roof has
 * distinct ridge and eaves rows, which is what the houses' stripes are; a
 * flat rooftop repeats one texture over the whole roof area, which is what
 * the lab and the Marts have. Tilting a rooftop into a ramp reads wrong at
 * once, so a repeat means flat.
 */
function roofRowsOf(map: MapRuntime, north: number, rows: number, tx: number): number {
  if (rows < MIN_ROOF_ROWS) {
    return 0;
  }
  if (map.tileAt(tx, north) === map.tileAt(tx, north + 1)) {
    return 0;
  }
  const half = rows - 1;
  return half < ROOF_ROWS ? half : ROOF_ROWS;
}

/**
 * The category of one tile, or "" where the tileset never classified it.
 *
 * Structures flood-fills four categories together -- a wall, a building, a
 * door and rock all stand up -- but they are not all the same KIND of thing,
 * and the roof has to know which it is looking at. See regionIsBuilt.
 */
function categoryAt(map: MapRuntime, stats: TileStats, tx: number, ty: number): string {
  const tile = map.tileAt(tx, ty);
  return tile < stats.categories.length ? stats.categories[tile] : "";
}

function isUpright(map: MapRuntime, stats: TileStats, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.widthTiles || ty >= map.heightTiles) {
    return false;
  }
  // Cell granularity, as the cartridge's own collision has: a cell is judged
  // by its bottom-left tile alone, so every tile of a walkable cell is ground
  // whatever its own art looks like. Reading this per tile is what turns
  // flowers into pillars and the gaps in a fence row into wall.
  if (map.isWalkable(tx >> 1, ty >> 1)) {
    // A door is the exception. It has to be walkable -- you step into it --
    // but it is drawn IN the front wall, so leaving it out punches a notch
    // through the middle of every house. A walkable door cell with a wall
    // above it belongs to that wall.
    return isFoldedDoor(map, stats, tx, ty);
  }
  const tile = map.tileAt(tx, ty);
  const category = tile < stats.categories.length ? stats.categories[tile] : "";
  for (let i = 0; i < UPRIGHT_CATEGORIES.length; i++) {
    if (category === UPRIGHT_CATEGORIES[i]) {
      return true;
    }
  }
  return false;
}

/**
 * A walkable door cell whose neighbour to the north stands up: the door is
 * part of that wall, not a hole in it.
 *
 * Deliberately shallow -- it asks only about the cell directly north, never
 * recursing -- so it can be called from isUpright without the two chasing
 * each other.
 */
function isFoldedDoor(map: MapRuntime, stats: TileStats, tx: number, ty: number): boolean {
  const cx = tx >> 1;
  const cy = ty >> 1;
  if (!map.isDoorTile(cx, cy)) {
    return false;
  }
  const aboveY = (cy - 1) * 2 + 1;
  if (aboveY < 0) {
    return false;
  }
  if (map.isWalkable(cx, cy - 1)) {
    return false;
  }
  const tile = map.tileAt(tx, aboveY);
  const category = tile < stats.categories.length ? stats.categories[tile] : "";
  for (let i = 0; i < UPRIGHT_CATEGORIES.length; i++) {
    if (category === UPRIGHT_CATEGORIES[i]) {
      return true;
    }
  }
  return false;
}

/**
 * The drawn height of one column's run, in tile rows, and where the run
 * starts and ends. `front` is its southmost tile.
 */
function runOf(
  map: MapRuntime, stats: TileStats, tx: number, front: number
): number[] {
  let north = front;
  while (north > 0 && isUpright(map, stats, tx, north - 1)) {
    north--;
  }
  const extent = front - north + 1;
  // A repeat means the drawing tiles vertically: the period is the unit, not
  // the whole stack.
  const frontTile = map.tileAt(tx, front);
  let unit = extent;
  for (let k = 1; k < extent; k++) {
    if (map.tileAt(tx, front - k) === frontTile) {
      unit = k < 2 ? 2 : k;
      break;
    }
  }
  if (unit > MAX_STRUCTURE_ROWS) {
    unit = MAX_STRUCTURE_ROWS;
  }
  return [unit, north, front, unit < extent ? 1 : 0];
}

/**
 * Every structure in the map, as a height in tile rows per tile.
 *
 * The window is the rectangle to answer for; the flood and the vote read the
 * whole map, so a house half outside the window still gets one height.
 */
export function detectStructures(
  map: MapRuntime, stats: TileStats,
  minTileX: number, minTileY: number, maxTileX: number, maxTileY: number,
  profile: ShapeProfile = null
): StructureField {
  const width = maxTileX - minTileX + 1;
  const height = maxTileY - minTileY + 1;
  const field: StructureField = {
    minTileX: minTileX,
    minTileY: minTileY,
    width: width,
    height: height,
    rows: new Int8Array(width * height),
    north: new Int16Array(width * height),
    front: new Int16Array(width * height),
    roofRows: new Int8Array(width * height),
    built: new Uint8Array(width * height),
    roofed: isOutdoors(map),
  };
  field.north.fill(-1);
  field.front.fill(-1);

  // Regions are flood-filled over the WHOLE map, once, so the vote is the
  // building's own and not the window's slice of it.
  const seen = new Uint8Array(map.widthTiles * map.heightTiles);
  const stack: number[] = [];

  for (let ty = 0; ty < map.heightTiles; ty++) {
    for (let tx = 0; tx < map.widthTiles; tx++) {
      const start = ty * map.widthTiles + tx;
      if (seen[start] || !isUpright(map, stats, tx, ty)) {
        continue;
      }
      // One region. `shell` is set when it reaches the map's outer ring,
      // which indoors is what separates the room from what stands in it.
      const tiles: number[] = [];
      let shell = false;
      stack.length = 0;
      stack.push(tx, ty);
      seen[start] = 1;
      while (stack.length > 0) {
        const cy = stack.pop();
        const cx = stack.pop();
        tiles.push(cx, cy);
        if (cx === 0 || cy === 0 ||
            cx === map.widthTiles - 1 || cy === map.heightTiles - 1) {
          shell = true;
        }
        const steps = [1, 0, -1, 0, 0, 1, 0, -1];
        for (let s = 0; s < 8; s += 2) {
          const nx = cx + steps[s];
          const ny = cy + steps[s + 1];
          if (nx < 0 || ny < 0 || nx >= map.widthTiles || ny >= map.heightTiles) {
            continue;
          }
          const at = ny * map.widthTiles + nx;
          if (seen[at] || !isUpright(map, stats, nx, ny)) {
            continue;
          }
          seen[at] = 1;
          stack.push(nx, ny);
        }
      }

      // Is this region BUILT, or is it landscape?
      //
      // A gable is a roof and a roof belongs to a building. ROCK is flood-
      // filled with STRUCTURE because a cliff is a mass that stands up, but
      // pitching its top turns Route 23's cut rock into a row of barns --
      // 3,012 tiles of it, and 744 more on Indigo Plateau, which is what the
      // PLATEAU tileset's own colour change exposed rather than caused. The
      // modal category decides, the same way the modal height does.
      let built = 0;
      let landscape = 0;
      for (let i = 0; i < tiles.length; i += 2) {
        const category = categoryAt(map, stats, tiles[i], tiles[i + 1]);
        if (category === "ROCK" || category === "TREE") {
          landscape++;
        } else {
          built++;
        }
      }
      const regionIsBuilt = built >= landscape;

      // The runs of this region: one per column, taken from its southmost tile.
      const columnFront: any = {};
      for (let i = 0; i < tiles.length; i += 2) {
        const cx = tiles[i];
        const cy = tiles[i + 1];
        const key = String(cx);
        if (columnFront[key] === undefined || cy > columnFront[key]) {
          columnFront[key] = cy;
        }
      }
      const votes: number[] = [];
      const runs: any = {};
      for (const key in columnFront) {
        const cx = parseInt(key, 10);
        const run = runOf(map, stats, cx, columnFront[key]);
        runs[key] = run;
        votes.push(run[0]);
      }
      // The modal height, ties to the taller: a house is one mass.
      let modal = 0;
      let best = 0;
      for (let v = MAX_STRUCTURE_ROWS; v >= 1; v--) {
        let count = 0;
        for (let i = 0; i < votes.length; i++) {
          if (votes[i] === v) {
            count++;
          }
        }
        if (count > best) {
          best = count;
          modal = v;
        }
      }

      for (let i = 0; i < tiles.length; i += 2) {
        const cx = tiles[i];
        const cy = tiles[i + 1];
        if (cx < minTileX || cx > maxTileX || cy < minTileY || cy > maxTileY) {
          continue;
        }
        const run = runs[String(cx)];
        if (!run) {
          continue;
        }
        // A repeat-read column adopts a taller vote; a column that read its
        // whole extent keeps what it measured.
        let rows = run[0];
        if (run[3] === 1 && modal > rows) {
          rows = modal;
        }
        if (rows < MIN_STRUCTURE_ROWS) {
          continue;
        }
        // Indoors the run is a floor plan, so it is replaced rather than
        // clamped: the room stands at wall height and everything in it at
        // half of that. Outdoors the measurement IS the elevation and is
        // left exactly as it was.
        if (!field.roofed) {
          // The room's shell is its WALL BAND: Gen 1 draws an interior's wall
          // as the map's top block row, two tile rows. Before 29 September
          // the shell was any region touching the outer ring, so a bed
          // against the back wall, a bookcase beside it and the staircase in
          // the corner all stood at wall height in the wall's own blue, and
          // Red's room read as three blue blocks. Below the band everything
          // built is furniture. Landscape (a cave's rock) keeps the ring rule:
          // its walls are the map's edge, not a band.
          //
          // Below the band a thing stands as tall as IndoorKinds says its
          // cell does -- a bookcase or a PC at the wall's height, a table or
          // a bed at half -- and at the furniture height when the table has
          // no word for it.
          //
          // A cell that is all pool is no part of the shell even in the
          // band: the sea beside Vermilion's gangway is the map's top row.
          if (regionIsBuilt) {
            rows = indoorCellSunk(map, cx >> 1, cy >> 1) ? 0
              : cy < INDOOR_SHELL_ROWS ? INDOOR_SHELL_ROWS
              : indoorCellRows(map, cx >> 1, cy >> 1, INDOOR_FURNITURE_ROWS);
          } else {
            rows = shell ? INDOOR_SHELL_ROWS : INDOOR_FURNITURE_ROWS;
          }
          // Named flat (the dark between a ship's cabins): no volume here.
          if (rows === 0) {
            continue;
          }
        }
        // A prop is not a volume. A Pallet Town fence is exactly two tile
        // rows -- tile 14 over tile 85 -- so without this it passes the run
        // test and folds into a solid wall with a fence painted on its south
        // face. The shape library stands it up as posts instead, and the two
        // must not both claim it.
        if (profile && isPropCell(map, stats, profile, cx >> 1, cy >> 1, rows)) {
          continue;
        }
        const at = (cy - minTileY) * width + (cx - minTileX);
        field.rows[at] = rows;
        field.north[at] = run[1];
        field.front[at] = run[2];
        field.built[at] = regionIsBuilt ? 1 : 0;
        field.roofRows[at] = field.roofed && regionIsBuilt
          ? roofRowsOf(map, run[1], rows, cx)
          : 0;
      }
    }
  }
  return field;
}

/** The height in rows at a tile, or 0 when it is not part of a structure. */
export function structureRowsAt(field: StructureField, tx: number, ty: number): number {
  if (!field) {
    return 0;
  }
  const cx = tx - field.minTileX;
  const cy = ty - field.minTileY;
  if (cx < 0 || cy < 0 || cx >= field.width || cy >= field.height) {
    return 0;
  }
  return field.rows[cy * field.width + cx];
}

/** Whether the volume at a tile is a building rather than landscape. */
export function structureBuiltAt(field: StructureField, tx: number, ty: number): boolean {
  if (!field) {
    return true;
  }
  const cx = tx - field.minTileX;
  const cy = ty - field.minTileY;
  if (cx < 0 || cy < 0 || cx >= field.width || cy >= field.height) {
    return true;
  }
  return field.built[cy * field.width + cx] === 1;
}

/**
 * The tile whose art belongs on band `band` of this column's south face --
 * band 0 at the ground, counting up. The flat map's northward rows ARE the
 * elevation: band k shows the row k north of the run's front.
 */
export function facadeTileY(field: StructureField, tx: number, ty: number, band: number): number {
  const cx = tx - field.minTileX;
  const cy = ty - field.minTileY;
  if (cx < 0 || cy < 0 || cx >= field.width || cy >= field.height) {
    return ty;
  }
  const at = cy * field.width + cx;
  const front = field.front[at];
  const north = field.north[at];
  if (front < 0) {
    return ty;
  }
  const want = front - band;
  return want < north ? north : want;
}

/**
 * How far, in tile rows, the roof has come down by a point `depth` tiles
 * south of the run's north row -- a gable whose ridge runs along the middle
 * of the footprint and whose eaves reach both ends.
 *
 * `depth` may be fractional, so a caller working in voxels gets a stepped
 * slope rather than one step a tile. Zero when the run has no pitched roof.
 */
export function roofDropRows(
  field: StructureField, tx: number, ty: number, depth: number
): number {
  const cx = tx - field.minTileX;
  const cy = ty - field.minTileY;
  if (cx < 0 || cy < 0 || cx >= field.width || cy >= field.height) {
    return 0;
  }
  const at = cy * field.width + cx;
  const pitch = field.roofRows[at];
  if (pitch <= 0) {
    return 0;
  }
  const north = field.north[at];
  const front = field.front[at];
  const span = front - north + 1;
  if (span <= 1) {
    return 0;
  }
  // 0 at the ridge, 1 at either eave.
  let away = 2 * depth / span - 1;
  if (away < 0) {
    away = -away;
  }
  if (away > 1) {
    away = 1;
  }
  return pitch * away;
}

/** The tile whose art belongs on this column's roof: the run's north row. */
export function roofTileY(field: StructureField, tx: number, ty: number): number {
  const cx = tx - field.minTileX;
  const cy = ty - field.minTileY;
  if (cx < 0 || cy < 0 || cx >= field.width || cy >= field.height) {
    return ty;
  }
  const north = field.north[cy * field.width + cx];
  return north < 0 ? ty : north;
}
