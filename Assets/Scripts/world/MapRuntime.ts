// Tile, collision and grass queries for one loaded map.
//
// Every rule here is taken from the reference implementation rather than inferred,
// because getting them subtly wrong means walking through walls or getting stuck:
//   - a block is 4x4 tiles; out-of-bounds blocks border-extend to `borderBlock`
//   - a walkable step cell is 2x2 tiles, and the tile that decides collision is the
//     BOTTOM-LEFT one, i.e. tileAt(cx * 2, cy * 2 + 1)
//   - grass must be bounds-checked first: some border blocks (Route 1's block 11)
//     carry the grass tile as scenery, and treating that as real grass fires
//     encounters in the void at the seam between two maps

import type { MapDef, TilesetDef } from "./WorldData";
import { isObjectHidden } from "./WorldData";
import { BlockOverrideIndex } from "./BlockOverrides";
import type { BlockOverrideRow } from "./BlockOverrides";
import { TILES_PER_BLOCK_SIDE, STEPS_PER_BLOCK_SIDE } from "./WorldData";

export class MapRuntime {
  readonly def: MapDef;
  readonly tileset: TilesetDef;
  /** Walkable grid size, in steps. */
  readonly widthCells: number;
  readonly heightCells: number;
  /** Tile grid size, in 8px tiles. */
  readonly widthTiles: number;
  readonly heightTiles: number;

  // Membership tests run per step and per voxel column, so pay for the lookup once.
  private walkableSet: boolean[] = [];
  private warpSet: boolean[] = [];
  private doorSet: boolean[] = [];

  constructor(def: MapDef, tileset: TilesetDef) {
    this.def = def;
    this.tileset = tileset;
    this.widthCells = def.width * STEPS_PER_BLOCK_SIDE;
    this.heightCells = def.height * STEPS_PER_BLOCK_SIDE;
    this.widthTiles = def.width * TILES_PER_BLOCK_SIDE;
    this.heightTiles = def.height * TILES_PER_BLOCK_SIDE;

    this.walkableSet = MapRuntime.toFlags(tileset.walkable);
    this.warpSet = MapRuntime.toFlags(tileset.warpTiles);
    this.doorSet = MapRuntime.toFlags(tileset.doorTiles);
  }

  private static toFlags(values: number[]): boolean[] {
    const flags: boolean[] = [];
    if (!values) {
      return flags;
    }
    for (let i = 0; i < values.length; i++) {
      flags[values[i]] = true;
    }
    return flags;
  }

  /** Block index at block coordinates, border-extended outside the map. */
  /**
   * The block override rows for this map and the live flag store they read.
   * Null means "as shipped", which is what the tests and the probe use.
   */
  private overrides: BlockOverrideIndex = null;
  private flags: any = null;

  setOverrides(index: BlockOverrideIndex, flags: any): void {
    this.overrides = index;
    this.flags = flags;
  }

  /** The override rows on a block, for the doors that ask for a key. */
  overridesAt(bx: number, by: number): BlockOverrideRow[] {
    return this.overrides ? this.overrides.rowsAt(bx, by) : [];
  }

  /** The resolved override ids; changes exactly when the world must be redrawn. */
  blockSignature(): string {
    return this.overrides && this.flags ? this.overrides.signature(this.flags) : "";
  }

  /**
   * Blocks this INSTANCE has replaced: a cut tree, a barrier a boulder opened.
   *
   * Separate from `overrides`, which is the bundle's flag-driven table. These
   * are written at runtime and die with the MapRuntime, which is exactly the
   * cartridge's reset: ReplaceTileBlock edits the loaded block map, and the
   * next map load throws it away. Never write through to def.blocks -- MapDef
   * is the shared bundle, and a solved barrier would stay open all session.
   */
  private localBlocks: any = {};

  setBlockOverride(bx: number, by: number, block: number): void {
    if (bx < 0 || by < 0 || bx >= this.def.width || by >= this.def.height) {
      return;
    }
    this.localBlocks[by * this.def.width + bx] = block;
  }

  blockAt(bx: number, by: number): number {
    if (bx < 0 || by < 0 || bx >= this.def.width || by >= this.def.height) {
      return this.def.borderBlock;
    }
    const local = this.localBlocks[by * this.def.width + bx];
    if (typeof local === "number") {
      return local;
    }
    const shipped = this.def.blocks[by * this.def.width + bx];
    if (this.overrides === null || this.flags === null) {
      return shipped;
    }
    // Read live: a flag that flipped a moment ago already opens the way.
    return this.overrides.blockFor(bx, by, shipped, this.flags);
  }

  /** Tile index at tile coordinates on the 8px grid, border-extended. */
  tileAt(tx: number, ty: number): number {
    const bx = Math.floor(tx / TILES_PER_BLOCK_SIDE);
    const by = Math.floor(ty / TILES_PER_BLOCK_SIDE);
    const block = this.tileset.blocks[this.blockAt(bx, by)];
    if (!block) {
      return 0;
    }
    // Modulo must stay non-negative for coordinates left of or above the map.
    const ix = ((tx % TILES_PER_BLOCK_SIDE) + TILES_PER_BLOCK_SIDE) % TILES_PER_BLOCK_SIDE;
    const iy = ((ty % TILES_PER_BLOCK_SIDE) + TILES_PER_BLOCK_SIDE) % TILES_PER_BLOCK_SIDE;
    return block[iy * TILES_PER_BLOCK_SIDE + ix];
  }

  /** The tile that decides a step cell's collision: its bottom-left tile. */
  cellTile(cx: number, cy: number): number {
    return this.tileAt(cx * 2, cy * 2 + 1);
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.widthCells && cy < this.heightCells;
  }

  isWalkable(cx: number, cy: number): boolean {
    return this.walkableSet[this.cellTile(cx, cy)] === true;
  }

  /** Tall grass, and only inside the map — border filler carries the tile too. */
  /** A counter tile: talked across, never stood on. Nurses and clerks live behind one. */
  isCounter(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) {
      return false;
    }
    const tile = this.cellTile(cx, cy);
    const counters = this.tileset.counterTiles ? this.tileset.counterTiles : [];
    for (let i = 0; i < counters.length; i++) {
      if (counters[i] === tile) {
        return true;
      }
    }
    return false;
  }

  isGrass(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) {
      return false;
    }
    return this.tileset.grassTile >= 0 && this.cellTile(cx, cy) === this.tileset.grassTile;
  }

  /** A door tile proper (a house front, a cave mouth): the warp flag survives it. */
  isDoorTile(cx: number, cy: number): boolean {
    return this.doorSet[this.cellTile(cx, cy)] === true;
  }

  isWarpTile(cx: number, cy: number): boolean {
    const tile = this.cellTile(cx, cy);
    return this.warpSet[tile] === true || this.doorSet[tile] === true;
  }

  /** The warp entry standing on this cell, or null. */
  warpAt(cx: number, cy: number): any {
    const warps = this.def.warps;
    for (let i = 0; i < warps.length; i++) {
      if (warps[i].x === cx && warps[i].y === cy) {
        return warps[i];
      }
    }
    return null;
  }

  /**
   * The script's show/hide overrides, held by reference (PlayLoop.reveals()).
   * Null means "as shipped", which is what the tests and the probe use.
   */
  private reveals: any = null;

  setReveals(revealed: any): void {
    this.reveals = revealed;
  }

  /**
   * The VISIBLE object standing on this cell, or null. Objects block movement;
   * hidden ones do not. This used to read every object, so the thirty-two the
   * cartridge ships hidden -- Oak in Pallet Town, the Route 22 rival -- and
   * every NPC a script hid were invisible walls.
   */
  objectAt(cx: number, cy: number): any {
    const objects = this.def.objects;
    for (let i = 0; i < objects.length; i++) {
      const cell = this.objectCell(objects[i]);
      if (cell[0] === cx && cell[1] === cy &&
          !isObjectHidden(this.def.id, objects[i], this.reveals)) {
        return objects[i];
      }
    }
    return null;
  }

  /**
   * Objects this instance has moved: a boulder Strength pushed. Same lifetime
   * as localBlocks and for the same reason -- def.objects is shared data, and
   * writing x/y through it would move the boulder on every future visit.
   */
  private objectMoves: any = {};

  moveObject(name: string, cx: number, cy: number): void {
    this.objectMoves[name] = [cx, cy];
  }

  /** Where an object stands NOW: its moved cell, else the one it ships on. */
  objectCell(object: any): number[] {
    const moved = this.objectMoves[object.name];
    return moved ? moved : [object.x, object.y];
  }

  /**
   * A boulder Strength can push. The cartridge marks them by movement byte
   * rather than by sprite, and so does the extraction.
   */
  isBoulder(object: any): boolean {
    return object !== null && object.range === "BOULDER_MOVEMENT_BYTE_2";
  }

  /** May the player step onto this cell? Bounds, tile and occupancy. */
  canEnter(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) {
      return false;
    }
    if (!this.isWalkable(cx, cy)) {
      return false;
    }
    return this.objectAt(cx, cy) === null;
  }

  /** The connection in `direction` ("north"/"south"/"east"/"west"), or null. */
  connection(direction: string): any {
    const connections = this.def.connections;
    if (!connections) {
      return null;
    }
    const entry = connections[direction];
    return entry ? entry : null;
  }
}
