// The S.S. Anne leaving Vermilion: what the dock looks like once she has.
//
// scripts/VermilionDock.asm VermilionDockSSAnneLeavesScript slides the ship
// out to sea column by column with smoke behind her, then
// VermilionDock_EraseSSAnne writes water over the hull (`hlowcoord 5, 2`,
// block $d four times) and `dec [wNumberOfWarps]` drops the gangway warp so
// nothing can walk -- or surf -- onto a ship that is not there. The lens's
// diorama is a baked mesh and cannot slide a part of itself yet, so the
// departure is the end state: the eight blocks she stood on become the water
// around them, stamped by the `sail_ship` routine between the two horns and
// again on every later entry (PlayLoop.enteredMap).
//
// Since 26 September she SLIDES first: the `sail_ship` routine stamps the same
// eight blocks one column further out every SHIP_SLIDE_FRAMES until the last
// of her is past the quay wall, and the water closes behind her as it does on
// the cartridge. Whole blocks rather than the cartridge's pixels, because a
// block is what the diorama can redraw; no smoke, because the dock's tileset
// has no smoke block and inventing one is not reading the cartridge.
//
// The cutscene's own trigger and the walk out are the VERMILION_DOCK script
// set in MapScripts.ts.

export const EVENT_SS_ANNE_LEFT: string = "EVENT_SS_ANNE_LEFT";
export const MAP_VERMILION_DOCK: string = "VERMILION_DOCK";

/** The gangway, VermilionDock's warp 1: where SS_ANNE_1F's two exits land. */
export const GANGWAY_CELLS: number[][] = [[14, 2]];

/**
 * Where the deck and hull stood, and the water that replaces them: bx, by,
 * block. Read off maps/VermilionDock.blk -- row 1 is deck over open water
 * (block 1), row 2 hull over the quay-side water (block 13).
 */
export const SHIP_GONE_BLOCKS: number[][] = [
  [5, 1, 1], [6, 1, 1], [7, 1, 1], [8, 1, 1],
  [5, 2, 13], [6, 2, 13], [7, 2, 13], [8, 2, 13],
];

export function shipHasSailed(flags: any): boolean {
  return flags && flags[EVENT_SS_ANNE_LEFT] === true;
}

/**
 * The ship at rest: bx, by, block. Row 1 is the deck, bow to stern (blocks 4
 * to 7); row 2 the hull (8 to 11). Read off maps/VermilionDock.blk, the same
 * rows SHIP_GONE_BLOCKS replaces.
 */
export const SHIP_AT_REST: number[][] = [
  [5, 1, 4], [6, 1, 5], [7, 1, 6], [8, 1, 7],
  [5, 2, 8], [6, 2, 9], [7, 2, 10], [8, 2, 11],
];

/** The last block column that is sea; column 13 is the map's own wall. */
export const SHIP_LAST_COLUMN: number = 12;

/** Columns the ship slides before none of her is left: from bx 5 past bx 12. */
export const SHIP_SLIDE_STEPS: number = SHIP_LAST_COLUMN + 1 - 5;

/** Game Boy frames between one column and the next: eight columns in about a second and a half. */
export const SHIP_SLIDE_FRAMES: number = 10;

/**
 * What the berth looks like with the ship `shift` columns out to sea: the
 * water she has left plus whatever of her is still inside the sea. Shift 0
 * is the ship at rest; SHIP_SLIDE_STEPS is SHIP_GONE_BLOCKS exactly.
 */
export function shipBlocksAfter(shift: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < SHIP_GONE_BLOCKS.length; i++) {
    out.push([SHIP_GONE_BLOCKS[i][0], SHIP_GONE_BLOCKS[i][1], SHIP_GONE_BLOCKS[i][2]]);
  }
  for (let i = 0; i < SHIP_AT_REST.length; i++) {
    const bx = SHIP_AT_REST[i][0] + shift;
    if (bx > SHIP_LAST_COLUMN) {
      continue;
    }
    out.push([bx, SHIP_AT_REST[i][1], SHIP_AT_REST[i][2]]);
  }
  return out;
}
