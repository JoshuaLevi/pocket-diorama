// Map blocks that a flag opens or closes: the Game Corner staircase behind
// the poster, the Elite Four's exit seals, Lance's doorway, Cinnabar Gym's
// quiz gates, the card-key doors of Silph Co. and the Rocket Hideout.
//
// Nothing here is applied. A block is a pure function of the shipped .blk
// byte, the override rows for that map and the live flag store, and
// MapRuntime.blockAt asks this index every time -- so collision, the warp
// gate and the voxel mesh all see the same block, nothing is copied and
// nothing new lands in the save. When a flag flips mid-map the model is
// already right on the next read; PlayLoop compares a signature and asks the
// lens to redraw.
//
// The rows come from the bundle (BundleFromExtraction composes them from the
// manifest's card-key doors, the poster, and field.blockOverrides): block ids
// and flag names, the same MIT table that already carried the doors.

import type { FlagStore } from "../play/script/ScriptVM";

export interface BlockOverrideRow {
  bx: number;
  by: number;
  closedBlock: number;
  openBlock: number;
  /** The flags that open it. */
  flags: string[];
  /** true: every flag must be set; false: any one of them. */
  all: boolean;
  /** true: the flags CLOSE it instead -- Lance's doorway locks behind you. */
  inverted: boolean;
  /** The key item a locked door asks for ("CARD_KEY"), or "". */
  keyItem: string;
  /** Held back until its opener exists; read as shipped. */
  disabled: boolean;
}

/** A row from a loose bundle object, every field filled. */
export function blockOverrideRow(raw: any): BlockOverrideRow {
  return {
    bx: typeof raw.bx === "number" ? raw.bx : -1,
    by: typeof raw.by === "number" ? raw.by : -1,
    closedBlock: typeof raw.closedBlock === "number" ? raw.closedBlock : -1,
    openBlock: typeof raw.openBlock === "number" ? raw.openBlock : -1,
    flags: raw.flags ? raw.flags : [],
    all: raw.all !== false,
    inverted: raw.inverted === true,
    keyItem: typeof raw.keyItem === "string" ? raw.keyItem : "",
    disabled: raw.disabled === true,
  };
}

/** Whether a row's flags say "open". */
export function rowIsOpen(row: BlockOverrideRow, flags: FlagStore): boolean {
  let set = row.all;
  for (let i = 0; i < row.flags.length; i++) {
    const on = flags[row.flags[i]] === true;
    if (row.all) {
      set = set && on;
    } else if (on) {
      set = true;
    }
  }
  if (row.flags.length === 0) {
    set = false;
  }
  return row.inverted ? !set : set;
}

export class BlockOverrideIndex {
  /** by * width + bx -> rows on that block, in table order. */
  private byBlock: any = {};
  private rows: BlockOverrideRow[] = [];
  private width: number;

  constructor(raws: any[], width: number) {
    this.width = width;
    for (let i = 0; raws && i < raws.length; i++) {
      const row = blockOverrideRow(raws[i]);
      if (row.disabled || row.bx < 0 || row.by < 0) {
        continue;
      }
      this.rows.push(row);
      const key = "" + (row.by * width + row.bx);
      if (!this.byBlock[key]) {
        this.byBlock[key] = [];
      }
      this.byBlock[key].push(row);
    }
  }

  /** The block to use at (bx, by): the last live row's choice, else the shipped byte. */
  blockFor(bx: number, by: number, shipped: number, flags: FlagStore): number {
    const rows: BlockOverrideRow[] = this.byBlock["" + (by * this.width + bx)];
    if (!rows) {
      return shipped;
    }
    let block = shipped;
    for (let i = 0; i < rows.length; i++) {
      block = rowIsOpen(rows[i], flags) ? rows[i].openBlock : rows[i].closedBlock;
    }
    return block;
  }

  /** Every live row on a block, for the doors that ask for a key. */
  rowsAt(bx: number, by: number): BlockOverrideRow[] {
    const rows: BlockOverrideRow[] = this.byBlock["" + (by * this.width + bx)];
    return rows ? rows : [];
  }

  /** The resolved ids in row order: changes exactly when a redraw is due. */
  signature(flags: FlagStore): string {
    let out = "";
    for (let i = 0; i < this.rows.length; i++) {
      out += (rowIsOpen(this.rows[i], flags) ? this.rows[i].openBlock : this.rows[i].closedBlock) + "|";
    }
    return out;
  }

  count(): number {
    return this.rows.length;
  }
}
