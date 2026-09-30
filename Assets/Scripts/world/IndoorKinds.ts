// What a thing indoors IS, tile by tile: the room's wall, a shelf, a table, a
// machine, a bed, a plant, a mat, a stone floor.
//
// Gen 1 draws every interior in four greys and its tables say only which
// tiles you can stand on, so the bundle's categories can tell a wall from a
// floor and nothing finer: before this table a PC, a bed, a bookcase and a
// television were all WALL, and all wore the same wood once furniture got
// its colour. The reference's rooms (Gen1Recomp with the Dramatic Shape
// mod, 29 September) read because each thing has its own colour and its
// own height: gold shelves as tall as the wall, a low table, a grey machine,
// a bed you look down on.
//
// So this names the tiles, tileset by tileset, read off the tile sheets
// (tools: the scratch tilesheet/mapsheet dumps) against the maps that use
// them. A tile the table does not name is what it was: wall in the band,
// furniture below it. The table lives in the lens, like TilePalettes, so a
// world baked on the site before it existed takes it too.
//
// Two things are decided here and nowhere else:
//   - the COLOUR: the kind's palette category (VoxelTerrain recolours the
//     tile's voxels; the bundle's categories, which drive the shapes, are
//     left alone);
//   - the HEIGHT of a built cell indoors (Structures): the tallest kind among
//     the cell's four tiles, so a bookcase whose top edge shares a tile with
//     a table's top still stands as one block.

/** A kind: the palette category it paints in, and how many tile rows it stands. */
export interface IndoorKind {
  category: string;
  rows: number;
  /** True when the thing lies BELOW the floor: a pool. */
  sunk?: boolean;
}

export const INDOOR_KIND_TABLE: any = {
  /** The room's own wall: the band, a window, a picture on it. */
  WALL: { category: "WALL", rows: 2 },
  /** A table, a counter, a bench, a stair, a pot: wood at half the wall. */
  FURNITURE: { category: "FURNITURE", rows: 1 },
  /** A bookcase, a cabinet, a cupboard: wood as tall as the wall, in the cabinet's own ramp. */
  SHELF: { category: "CABINET", rows: 2 },
  /** A PC, a television set, the lab's machine: grey, as tall as the wall. */
  MACHINE: { category: "MACHINE", rows: 2 },
  /** A small set or a console on the floor: grey, low. */
  APPLIANCE: { category: "MACHINE", rows: 1 },
  /** A bed: linen, low. */
  LINEN: { category: "LINEN", rows: 1 },
  /** A potted plant's leaves: green, low. */
  PLANT: { category: "PLANT", rows: 1 },
  /** A mat's top row: floor that happens not to be the walkable tile. */
  FLOOR: { category: "FLOOR", rows: 0 },
  /** A hard floor -- the lab's, a gym's: stone rather than boards. */
  TILE: { category: "TILE", rows: 0 },
  /** A boulder on a gym floor: rock, low. */
  STONE: { category: "ROCK", rows: 1 },
  /** A statue flanking a gym's door: rock, as tall as the wall. */
  STATUE: { category: "ROCK", rows: 2 },
  /** Nothing: the dark between a ship's cabins. Flat, in the wall's colour. */
  VOID: { category: "WALL", rows: 0 },
  /** A pool: water, level, a voxel below the floor you walk round it on. */
  POOL: { category: "WATER", rows: 0, sunk: true },
};

/**
 * Per tileset, per kind, the tiles. Read off the sheets on 29 September;
 * the maps named are where each was checked.
 */
/**
 * Several tilesets share one sheet on the cartridge (the two floors of Red's
 * house; GYM and DOJO; POKECENTER and MART; MUSEUM and both GATE sheets), so
 * the reading is written once per sheet and named for every id that uses it.
 */
const REDS_HOUSE_SHEET: any = {
  // Both floors: a PC in the corner, a small TV with the SNES under it,
  // cabinets and bookcases, the dining table with its mat (the same table
  // stands upstairs against the wall), the bed, a plant, the stairs.
  WALL: [0],
  FURNITURE: [38, 39, 40, 41, 42, 43, 44, 58, 59, 60],
  SHELF: [34, 35, 36, 37, 48, 49, 50, 51, 52, 53],
  MACHINE: [64, 65, 32, 33, 66, 67],
  APPLIANCE: [6, 7, 22, 23, 14, 15, 30, 31],
  LINEN: [45, 46, 47, 61, 62, 63],
  PLANT: [68, 69, 70, 71, 8, 9],
  FLOOR: [4],
};

const GYM_SHEET: any = {
  // Oak's lab, the dojo, the gyms, the Elite Four's rooms: shelves of books,
  // the lab's machine, tables, boulders (Pewter, Bruno), the statues at a
  // gym's door, trees in Celadon's, the generator in Vermilion's, and the
  // water of Cerulean's pool and round Lorelei's floor (20), with the
  // platform's edge that is drawn over it (4).
  WALL: [5, 16, 52, 67, 82, 83, 15, 31, 36, 37, 38, 39, 53, 62, 66, 32, 33, 48, 49],
  FURNITURE: [41, 42],
  POOL: [20, 4],
  SHELF: [13, 14, 29, 30],
  MACHINE: [91, 92, 93, 94, 95, 54, 55, 85, 11, 12, 27, 28],
  APPLIANCE: [84, 86, 87, 68, 69, 70, 71],
  STONE: [7, 8, 23, 24],
  STATUE: [2, 18, 19, 34, 35, 50, 51, 56],
  PLANT: [44, 45, 46, 47, 64, 65, 80, 81],
  FLOOR: [6],
  TILE: [17],
};

const POKECENTER_SHEET: any = {
  // The centres, the marts, the hotel, the Plateau's lobby: a dark wall
  // with a PC terminal and the emblem, the healing machine, the counter, a
  // PC by the wall, a poster, plants, the door mat.
  WALL: [0, 40, 2, 3, 18, 19, 36, 37, 52, 53, 38, 39, 42, 43, 92, 93, 95, 78, 79],
  MACHINE: [58, 59, 74, 75, 66, 70, 82, 86, 9, 88],
  FURNITURE: [4, 5, 20, 21, 8, 24, 25, 56, 10, 34, 35, 50, 51, 89, 14, 15, 30, 31],
  PLANT: [32, 33, 48, 49],
  FLOOR: [12],
};

const MUSEUM_SHEET: any = {
  // The museum and every gate: the plain band, pictures, the guards' desks,
  // plants in pots, the fossil cases, the shelves of the museum's east hall,
  // the stools, the meteorite, binoculars on a gate's first floor.
  WALL: [0, 72, 74, 78, 79, 41, 42, 43, 32, 33, 58, 45, 61, 62, 16],
  FURNITURE: [7, 8, 9, 23, 24, 50, 51, 2, 3, 18, 19, 37, 38, 53, 54],
  SHELF: [34, 35],
  MACHINE: [76, 77, 92, 93, 36, 52, 46, 47, 64, 65, 66, 67, 68, 69, 80, 81, 84, 85, 86, 87, 88, 89, 90, 91],
  APPLIANCE: [39, 40, 25, 48, 70, 71, 44, 49, 83, 63],
  PLANT: [5, 6, 21, 22, 14, 15, 30, 31],
  FLOOR: [4],
};

/** One table with a kind list replaced or added: a sheet read for another use. */
function withKinds(base: any, changes: any): any {
  const out: any = {};
  for (const kind in base) {
    out[kind] = base[kind];
  }
  for (const kind in changes) {
    out[kind] = changes[kind];
  }
  return out;
}

export const INDOOR_KINDS: any = {
  REDS_HOUSE_1: REDS_HOUSE_SHEET,
  REDS_HOUSE_2: REDS_HOUSE_SHEET,
  // The twenty-one HOUSE maps, read off Blue's: cabinets, a window and a
  // picture in the band, the table, two plants, the door mat.
  HOUSE: {
    WALL: [0, 36, 52, 45, 46, 61, 62],
    FURNITURE: [38, 41],
    SHELF: [14, 15, 30, 31, 48, 49],
    PLANT: [10, 11, 8, 9],
    FLOOR: [4],
  },
  DOJO: GYM_SHEET,
  GYM: GYM_SHEET,
  // In a centre 16 and 41 are the wall's pillars and 76/77 the healing
  // machine's top; in a mart the same tiles are the clerk's counter and
  // the display under the SALE sign, and 90/91 top the shop's shelving
  // where a centre uses them for a side table.
  POKECENTER: withKinds(POKECENTER_SHEET, {
    WALL: POKECENTER_SHEET.WALL.concat([16, 41]),
    MACHINE: POKECENTER_SHEET.MACHINE.concat([72, 76, 77, 6, 22, 7, 13, 73]),
    FURNITURE: POKECENTER_SHEET.FURNITURE.concat([90, 91]),
  }),
  MART: withKinds(POKECENTER_SHEET, {
    FURNITURE: POKECENTER_SHEET.FURNITURE.concat([16, 41]),
    // The Plateau's lobby is drawn with this sheet and heals as a centre does.
    MACHINE: POKECENTER_SHEET.MACHINE.concat([72, 6, 22, 7, 13, 73]),
    SHELF: [90, 91, 44, 45, 46, 47, 62, 63, 64, 65, 67, 80, 81, 83, 68, 69, 71, 84, 85, 87, 76, 77, 23, 29],
  }),
  MUSEUM: MUSEUM_SHEET,
  GATE: MUSEUM_SHEET,
  FOREST_GATE: MUSEUM_SHEET,
  // Celadon's department store, its diner, the Game Corner, the lifts and
  // the roof: a dithered band, partition walls down the shop floor, shelving
  // with goods, the checkout, the diner's tables and counter, the lift's
  // doors, vending machines and the roof's plants and railing.
  LOBBY: {
    WALL: [1, 33, 6, 22, 38, 41, 54, 57, 46, 47, 2, 3, 18, 19, 16, 77, 78, 75, 76, 79, 91],
    FURNITURE: [7, 8, 23, 24, 9, 25, 39, 48, 21, 70, 71, 85, 86, 87, 14, 15, 30, 31],
    SHELF: [34, 35, 50, 51, 42, 43, 44, 45, 58, 59, 60, 61, 64, 65, 66, 67, 80, 81, 82, 83, 36, 37, 52, 53],
    MACHINE: [40, 56, 62, 63, 72, 73, 88, 89, 92, 93],
    PLANT: [68, 84],
    FLOOR: [4],
  },
  // The Pokemon Tower and Agatha's room: a stone floor, gravestones in
  // rock, the tower's inner walls and the stair frames in the band.
  CEMETERY: {
    WALL: [32, 48, 17, 9, 10, 25, 26],
    STONE: [5, 6, 21, 22],
    TILE: [1],
  },
  // The bike shop, the Colosseum and the Trade Center: bicycles on the wall
  // and on stands, the counter, the link machines.
  CLUB: {
    WALL: [6, 52, 66, 67, 68, 69, 70],
    MACHINE: [1, 2, 3, 17, 18, 19, 48, 49, 50, 51, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 71, 72, 73, 74],
    APPLIANCE: [11, 12, 14, 27, 28, 9, 29, 13, 21, 22],
    FURNITURE: [7, 8, 23, 24, 54, 16, 5],
    FLOOR: [10],
  },
  // The S.S. Anne and the two houses drawn with its sheet: the cabins' beds,
  // the band, and the dark between the cabins, which is nothing and lies flat.
  SHIP: {
    WALL: [16, 18, 19, 2, 3],
    LINEN: [70, 71, 86, 87],
    VOID: [1],
  },
  // Bill's house, the Fan Club, Silph's top floor: Bill's machine and his PC
  // in grey, the band and its pictures.
  INTERIOR: {
    WALL: [16, 7, 8, 9, 10, 38, 54, 89, 90, 47, 52, 68, 45, 46],
    MACHINE: [32, 23, 24, 25, 26, 37, 48, 39, 40, 41, 42, 53, 56, 57, 11, 12, 13, 14, 27, 28, 29, 30],
  },
  // Cinnabar's lab and its three rooms, the Warden's house, Fuchsia's
  // meeting room, the Safari Zone's secret house (read 30 September): the
  // black of what is not a room and the wall's face with its posters and
  // panels, the fossil machines and mainframes along a wall, the devices
  // on the desk, cabinets, the big tables with their papers, the stools
  // drawn on the floor you stand on, plants in the corners, the Warden's
  // round stones, and a floor of stone rather than boards.
  LAB: {
    WALL: [54, 34, 35, 16, 17, 32, 33, 24, 25, 48, 49],
    FURNITURE: [64, 65, 66, 80, 81, 82, 83, 84, 58, 72, 73, 6, 7, 8, 9, 22, 23, 14, 15, 30, 31],
    SHELF: [40, 41],
    MACHINE: [69, 70, 85, 86, 74, 75, 90, 91, 59, 10, 11, 26, 27, 87, 88, 89, 28, 71, 29, 36, 37, 42, 43],
    APPLIANCE: [2, 3, 18, 19, 4, 5, 20, 21],
    PLANT: [44, 45, 60, 61, 46, 47, 62, 63],
    STONE: [50, 51, 67, 68],
    FLOOR: [39],
    TILE: [1, 38, 12, 13],
  },
  // The Rocket hideout, Silph Co, the Pokemon Mansion, the Power Plant and
  // the gyms of Cinnabar and Saffron (read 30 September): the black and
  // the walls drawn in it, the reel machines of the quiz and the plant, the
  // steel tables and Silph's counter, the boxes that ring Silph's fountain
  // and line the mansion's hall, beds, plants in pots, the mansion's
  // rubble, the statues with a switch in them, the fountain itself, the
  // railing round the hole in the mansion's second floor, and the hole.
  FACILITY: {
    WALL: [51, 42, 43, 44, 45, 46, 58, 59, 60, 87, 89],
    MACHINE: [74, 75, 76, 77],
    APPLIANCE: [13, 14, 29, 30, 2, 53, 68, 69, 18, 9, 10, 25, 26],
    LINEN: [40, 41, 56, 57],
    PLANT: [5, 6, 21, 22, 7, 15, 23, 31],
    STONE: [83, 84, 54, 38],
    STATUE: [39, 47, 55, 63, 61, 62],
    FURNITURE: [64, 80, 65, 81],
    POOL: [20],
    FLOOR: [17],
    TILE: [1],
  },
  // Celadon's mansion, its roof and the chief's house (read 30 September):
  // the black, the striped face and the white walls that divide the floors,
  // the big tables, cabinets with drawers, the figure on its stand, the
  // desk's devices, the bed upstairs, plants in pots and the roof's beds.
  // The hut on the roof is drawn with the table's own grey top, so it
  // stands as low as a table does.
  MANSION: {
    WALL: [16, 80, 74, 75, 76, 30, 90, 91, 93, 77, 22, 23, 72, 73, 88, 89, 78, 79, 92, 48, 6, 7],
    FURNITURE: [38, 39, 54, 55, 41, 57, 58, 59, 60],
    SHELF: [34, 35, 50, 51],
    MACHINE: [40, 21, 56, 87],
    APPLIANCE: [36, 37, 52, 53, 64, 65, 66, 67],
    LINEN: [61, 62, 45, 46, 63, 47],
    PLANT: [68, 69, 8, 9, 70, 71, 24, 25, 15, 31, 42, 43, 33, 49],
  },
  // Vermilion's dock, which the cartridge's tables file as a room: the sea
  // and the quay's edge drawn over it are a pool, the S.S. Anne stands tall
  // in the machine's greys, the crates are wood and the truck a low machine.
  SHIP_PORT: {
    POOL: [20, 49, 58],
    MACHINE: [85, 69, 9, 24, 25, 11, 33, 34, 40, 41, 56, 57, 62, 47, 16, 17, 2, 3, 18, 19, 4, 5, 0, 21,
      6, 7, 22, 23, 12, 13, 28, 29, 14, 15, 30, 31, 32, 48, 35, 51, 36, 37, 52, 53, 38, 39, 54, 55,
      44, 45, 61, 46, 64, 65, 81, 66, 67, 82, 83, 68, 77, 93, 78, 79, 90, 91],
    APPLIANCE: [72, 73, 88, 89, 74, 75, 60, 76],
    FURNITURE: [86, 87, 1, 80],
  },
};

/**
 * How many tile rows at the top of a room are its shell's band. Spelled out
 * rather than imported from Structures, which imports THIS file; the test
 * holds the two equal.
 */
export const INDOOR_BAND_TILES: number = 2;

/**
 * A second word for a tile, used BELOW the band only.
 *
 * One sheet draws two things with one tile more often than it should: tile
 * 40 of the centres' sheet is the wall's band along the top of every mart,
 * and the same tile is the top of the clerk's counter four cells further
 * down. Named WALL the counter's west end stood as a wall-high block in the
 * wall's colour; named FURNITURE the shop's back wall turned to wood. Where
 * the tile is decides which it is, so the table may say so.
 */
export const INDOOR_KINDS_BELOW: any = {
  MART: {
    FURNITURE: [40],
  },
};

function kindIn(kinds: any, tile: number): string {
  if (!kinds) {
    return null;
  }
  for (const kind in kinds) {
    const tiles: number[] = kinds[kind];
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === tile) {
        return kind;
      }
    }
  }
  return null;
}

/** The kind of one tile of one tileset, or null when the table has no word. */
export function indoorKindOf(tilesetId: string, tile: number): string {
  return kindIn(INDOOR_KINDS[tilesetId], tile);
}

/**
 * The kind of a tile WHERE IT STANDS: `tileRow` is its row on the map, in
 * tiles. Below the band a tile's second word wins, when it has one.
 */
export function indoorKindAt(tilesetId: string, tile: number, tileRow: number): string {
  if (tileRow >= INDOOR_BAND_TILES) {
    const below = kindIn(INDOOR_KINDS_BELOW[tilesetId], tile);
    if (below) {
      return below;
    }
  }
  return indoorKindOf(tilesetId, tile);
}

/** The palette category the table paints this tile in, or null. */
export function indoorCategoryOf(tilesetId: string, tile: number): string {
  const kind = indoorKindOf(tilesetId, tile);
  return kind ? INDOOR_KIND_TABLE[kind].category : null;
}

/** How many rows the table stands this tile, or -1 when it has no word. */
export function indoorRowsOf(tilesetId: string, tile: number): number {
  const kind = indoorKindOf(tilesetId, tile);
  return kind ? INDOOR_KIND_TABLE[kind].rows : -1;
}

/**
 * Per tile of a tileset, the palette category index the table paints it, or
 * -1: built once per terrain build so the tile loop does one lookup.
 */
export function indoorRecolour(tilesetId: string, tileCount: number,
                               indexOf: (name: string) => number,
                               belowBand: boolean = false): Int16Array {
  const out = new Int16Array(tileCount);
  // Any row at or past the band's end asks for the second word.
  const row = belowBand ? INDOOR_BAND_TILES : 0;
  for (let t = 0; t < tileCount; t++) {
    const kind = indoorKindAt(tilesetId, t, row);
    out[t] = kind ? indexOf(INDOOR_KIND_TABLE[kind].category) : -1;
  }
  return out;
}

/**
 * Per tile of a tileset, 1 where the table says the thing lies below the
 * floor. Built once per terrain build, like indoorRecolour.
 */
export function indoorSunk(tilesetId: string, tileCount: number): Uint8Array {
  const out = new Uint8Array(tileCount);
  for (let t = 0; t < tileCount; t++) {
    const kind = indoorKindOf(tilesetId, t);
    out[t] = kind && INDOOR_KIND_TABLE[kind].sunk === true ? 1 : 0;
  }
  return out;
}

/**
 * Whether a whole cell lies below the floor: every one of its four tiles is
 * a sunk kind. Structures asks before it stands the room's band, because
 * water in a map's top row (the sea beside Vermilion's gangway) is not the
 * room's wall.
 */
export function indoorCellSunk(map: any, cx: number, cy: number): boolean {
  const tilesetId: string = map.tileset && map.tileset.id ? map.tileset.id : "";
  for (let ty = cy * 2; ty < cy * 2 + 2; ty++) {
    for (let tx = cx * 2; tx < cx * 2 + 2; tx++) {
      const kind = indoorKindOf(tilesetId, map.tileAt(tx, ty));
      if (!kind || INDOOR_KIND_TABLE[kind].sunk !== true) {
        return false;
      }
    }
  }
  return true;
}

/**
 * How tall a built cell stands indoors: the tallest kind among its four
 * tiles, else `fallback` (the furniture height). A map is the argument
 * because only it knows its tileset and its tiles.
 */
export function indoorCellRows(map: any, cx: number, cy: number, fallback: number): number {
  const tilesetId: string = map.tileset && map.tileset.id ? map.tileset.id : "";
  let rows = -1;
  let named = 0;
  for (let ty = cy * 2; ty < cy * 2 + 2; ty++) {
    for (let tx = cx * 2; tx < cx * 2 + 2; tx++) {
      const kind = indoorKindAt(tilesetId, map.tileAt(tx, ty), ty);
      const r = kind ? INDOOR_KIND_TABLE[kind].rows : -1;
      if (r >= 0) {
        named++;
      }
      if (r > rows) {
        rows = r;
      }
    }
  }
  // A cell whose four tiles are all named FLAT -- a ship's void, a mat --
  // stands no volume at all; a cell the table is silent on stands at the
  // furniture height.
  if (named === 4 && rows === 0) {
    return 0;
  }
  return rows > 0 ? rows : fallback;
}
