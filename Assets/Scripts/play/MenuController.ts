// The menu: the screen stack, the rows, the cursor and what a press means.
//
// Pure. No SceneObject, no Material, no MeshBuilder anywhere in this file, for
// the same reason PlayHost and BattleRunner are pure: a whole menu session --
// open the bag, pick a Potion, pick who to use it on, back out twice -- has to
// be playable in a test, and a menu that can only be checked by wearing it is a
// menu nobody checks.
//
// The caller renders `rows()` with the cursor at `cursorRow()` and acts on the
// outcome `step()` returns.
//
// Three things an adversarial read of the design got right, written down here
// because each is a bug waiting to be reintroduced:
//
//   * During a battle, PlayState.party is NOT the live party. The active
//     Pokemon is a deep copy the battle made, and nothing folds HP back until
//     the battle ends. A party screen that reads PlayState mid-battle shows
//     pre-battle HP. So the caller supplies the party to display; this file
//     never reaches for it.
//   * `report.ok` from the engine means the ACTION WAS LEGAL for the phase, not
//     that the item was consumed. Every refusal inside the item path prints a
//     line and still reports ok. So the bag is never decremented here or on ok;
//     the caller decrements only when the engine says the item did something.
//   * The panel is 18 columns wide and a move label can be 19 characters --
//     "THUNDERPUNCH  15/15". Rows are built to fit, and a test asserts it,
//     because the overflow is invisible until a Pokemon happens to learn a long
//     move.

import { itemNeedsTarget, itemUsableOutside } from "./ItemUse";
import { ppItemNeedsMove } from "./battle/PpItems";
import type { DPadState } from "./InputSource";
import { DPadEdge } from "./InputSource";
import type { BattleMon } from "./battle/types";
import type { WorldBundle } from "../world/WorldData";
import type { BagSlot, PlayState } from "./PlayState";
import { fieldMovesOf } from "./FieldMoves";
import { machineOf } from "../world/WorldData";

/** Columns the panel can draw, cursor column included. */
export const MENU_COLUMNS: number = 18;
/** Rows visible at once. A longer list scrolls. */
export const MENU_ROWS: number = 6;

/** Nothing happened this frame. */
export const MENU_NONE: number = 0;
/** The menu closed; the caller takes the frame back. */
export const MENU_CLOSED: number = 1;
/** A move was chosen. `chosenIndex()` is the SLOT, not the row. */
export const MENU_MOVE: number = 2;
/** Switch to `chosenIndex()`. */
export const MENU_SWITCH: number = 3;
/** Use `chosenItem()` on party member `chosenIndex()`. */
export const MENU_ITEM: number = 4;
/** Run from a wild battle. */
export const MENU_RUN: number = 5;
/** Save the game. */
export const MENU_SAVE: number = 6;
/** Use `chosenMove()` as a field move, with party member `chosenIndex()`. */
export const MENU_FIELD_MOVE: number = 7;
/** OPTION on the root menu: the lens's view rows, on the Game Boy screen. */
export const MENU_OPTION: number = 8;
/** Fly to `chosenMap()`. */
export const MENU_FLY: number = 8;
/** Teach the machine `chosenItem()` to somebody. */
export const MENU_TEACH: number = 9;

const SCREEN_ROOT: string = "root";
const SCREEN_MOVES: string = "moves";
const SCREEN_BAG: string = "bag";
const SCREEN_PARTY: string = "party";
/** One Pokemon's field moves, reached with A on the party list. */
const SCREEN_MON: string = "mon";
/** The towns FLY may name. */
const SCREEN_FLY: string = "fly";
/** "Restore PP of which technique?": one Pokemon's moves, for an ETHER or a PP UP. */
const SCREEN_PP: string = "pp";

/**
 * One entry on the stack.
 *
 * Every field required with a sentinel: Lens Studio TypeScript forbids optional
 * properties, and the project's own engine types say so at battle/types.ts.
 */
export interface MenuScreen {
  kind: string;
  cursor: number;
  window: number;
  /** Why a party screen was pushed: "switch", "item" or "view". */
  purpose: string;
  /** The item waiting for a target, or "". */
  pendingItem: string;
  /** The party slot a SCREEN_MON belongs to, or -1. */
  monIndex: number;
}

function screen(kind: string, purpose: string, pendingItem: string): MenuScreen {
  return { kind: kind, cursor: 0, window: 0, purpose: purpose,
           pendingItem: pendingItem, monIndex: -1 };
}

/** Pads or trims to exactly n characters. */
function fit(text: string, n: number): string {
  if (text.length >= n) {
    return text.substring(0, n);
  }
  let out = text;
  while (out.length < n) {
    out = out + " ";
  }
  return out;
}

/** Right-aligns in n characters. */
function right(text: string, n: number): string {
  if (text.length >= n) {
    return text.substring(text.length - n);
  }
  let out = text;
  while (out.length < n) {
    out = " " + out;
  }
  return out;
}

export class MenuController {
  private bundle: WorldBundle;
  private state: PlayState;
  private stack: MenuScreen[] = [];
  private cursor: DPadEdge = new DPadEdge();

  /** Set while the menu is showing a battle's moves. */
  private inBattle: boolean = false;
  private moveLabels: string[] = [];
  private moveSlots: number[] = [];
  /** The party to DISPLAY. In battle this is the battle's, not the save's. */
  private shownParty: BattleMon[] = [];

  private outIndex: number = -1;
  private outItem: string = "";
  private outRow: number = -1;
  private outMove: string = "";
  private outMap: string = "";
  /** The towns openFly was given, in the order they are drawn. */
  private flyTowns: string[] = [];

  constructor(bundle: WorldBundle, state: PlayState) {
    this.bundle = bundle;
    this.state = state;
  }

  isOpen(): boolean {
    return this.stack.length > 0;
  }

  /** The overworld menu: party, bag, save, exit. */
  openOverworld(party: BattleMon[]): void {
    this.inBattle = false;
    this.shownParty = party;
    this.stack = [screen(SCREEN_ROOT, "", "")];
    this.cursor.reset();
  }

  /**
   * The battle menu.
   *
   * `labels` and `slots` come from the runner, which knows that a row is not a
   * move slot. `party` is the BATTLE's party, because the save's is stale until
   * the battle ends.
   */
  openBattle(labels: string[], slots: number[], party: BattleMon[]): void {
    this.inBattle = true;
    this.moveLabels = labels;
    this.moveSlots = slots;
    this.shownParty = party;
    this.stack = [screen(SCREEN_MOVES, "", "")];
    this.cursor.reset();
  }

  /**
   * The FLY destination list. Opened by the caller after useFieldMove reports
   * pickFly, because which towns have been visited is the play loop's to know.
   */
  openFly(towns: string[]): void {
    this.inBattle = false;
    this.flyTowns = towns;
    this.stack = [screen(SCREEN_FLY, "", "")];
    this.cursor.reset();
  }

  close(): void {
    this.stack = [];
    this.outIndex = -1;
    this.outItem = "";
    this.outRow = -1;
    this.outMove = "";
    this.outMap = "";
  }

  /** The field move chosen on a Pokemon's own screen, or "". */
  chosenMove(): string {
    return this.outMove;
  }

  /** The map FLY was pointed at, or "". */
  chosenMap(): string {
    return this.outMap;
  }

  /** The move slot, party index, or -1. */
  chosenIndex(): number {
    return this.outIndex;
  }

  /** The item id, or "". */
  chosenItem(): string {
    return this.outItem;
  }

  /**
   * The ROW that was chosen, as distinct from what it stands for.
   *
   * Both exist because callers want different ones and mixing them up is this
   * project's most persistent bug: BattleRunner's port takes a row and maps it
   * to a slot itself, so handing it chosenIndex() -- already a slot -- would
   * translate twice and pick a third move.
   */
  chosenRow(): number {
    return this.outRow;
  }

  private top(): MenuScreen {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  /** Every row of the current screen, unwindowed. */
  private allRows(): string[] {
    const top = this.top();
    if (top === null) {
      return [];
    }
    if (top.kind === SCREEN_ROOT) {
      // OPTION between SAVE and EXIT, where the cartridge's own OPTION sits
      // on its start menu. Gen 1 has it too; ours opens the lens's view rows
      // rather than the cartridge's three, which live on the boot screen.
      return ["POKeMON", "ITEM", "SAVE", "OPTION", "EXIT"];
    }
    if (top.kind === SCREEN_MOVES) {
      const out: string[] = [];
      for (let i = 0; i < this.moveLabels.length; i++) {
        out.push(this.moveLabels[i]);
      }
      out.push("POKeMON");
      out.push("ITEM");
      if (this.state !== null) {
        out.push("RUN");
      }
      return out;
    }
    if (top.kind === SCREEN_BAG) {
      const out: string[] = [];
      for (let i = 0; i < this.state.bag.length; i++) {
        out.push(this.bagRow(this.state.bag[i]));
      }
      out.push("CANCEL");
      return out;
    }
    if (top.kind === SCREEN_MON) {
      const out: string[] = [];
      const moves = this.fieldMovesAt(top.monIndex);
      for (let i = 0; i < moves.length; i++) {
        out.push(moves[i]);
      }
      out.push("CANCEL");
      return out;
    }
    if (top.kind === SCREEN_PP) {
      const out: string[] = this.ppRows(top.monIndex);
      out.push("CANCEL");
      return out;
    }
    if (top.kind === SCREEN_FLY) {
      const out: string[] = [];
      for (let i = 0; i < this.flyTowns.length; i++) {
        // "PALLET_TOWN" is an id; the cartridge's map is labelled with words.
        out.push(fit(this.flyTowns[i].split("_").join(" "), MENU_COLUMNS - 1));
      }
      out.push("CANCEL");
      return out;
    }
    // party
    const out: string[] = [];
    for (let i = 0; i < this.shownParty.length; i++) {
      out.push(this.partyRow(this.shownParty[i]));
    }
    out.push("CANCEL");
    return out;
  }

  /**
   * "POTION       x 3", inside seventeen columns.
   *
   * The NAME, not the id: the item is `TM_BIDE` and reads "TM34". A bag showing
   * the id shows the wrong thing.
   */
  private bagRow(slot: BagSlot): string {
    const def = this.bundle.items ? this.bundle.items[slot.id] : null;
    const name = def && def.name ? def.name : slot.id;
    const count = "x" + slot.count;
    return fit(name, MENU_COLUMNS - 1 - count.length - 1) + " " + count;
  }

  /** The HM moves a party member knows, in slot order. */
  private fieldMovesAt(index: number): string[] {
    if (index < 0 || index >= this.shownParty.length) {
      return [];
    }
    return fieldMovesOf(this.shownParty[index]);
  }

  /** "EMBER      3/25" for every move the Pokemon has, in slot order. */
  private ppRows(index: number): string[] {
    const out: string[] = [];
    const mon = index >= 0 && index < this.shownParty.length ? this.shownParty[index] : null;
    if (mon === null) {
      return out;
    }
    for (let i = 0; i < mon.moves.length; i++) {
      const slot = mon.moves[i];
      if (slot.id === "") {
        continue;
      }
      const def: any = this.bundle.moves ? (this.bundle.moves as any)[slot.id] : null;
      const pp = right("" + slot.pp, 2) + "/" + right("" + slot.maxPp, 2);
      out.push(fit(def && def.name ? def.name : slot.id, MENU_COLUMNS - 1 - pp.length) + pp);
    }
    return out;
  }

  /** The move SLOT behind a row of the PP screen: empty slots are not drawn. */
  private ppSlotAt(index: number, row: number): number {
    const mon = index >= 0 && index < this.shownParty.length ? this.shownParty[index] : null;
    if (mon === null) {
      return -1;
    }
    let seen = -1;
    for (let i = 0; i < mon.moves.length; i++) {
      if (mon.moves[i].id === "") {
        continue;
      }
      seen++;
      if (seen === row) {
        return i;
      }
    }
    return -1;
  }

  /** "CHARMANDER  21/ 28", inside seventeen columns. */
  private partyRow(mon: BattleMon): string {
    const hp = right("" + mon.hp, 3) + "/" + right("" + mon.maxHp, 3);
    return fit(mon.name, MENU_COLUMNS - 1 - hp.length) + hp;
  }

  /** The rows to draw, windowed to what fits. */
  rows(): string[] {
    const top = this.top();
    if (top === null) {
      return [];
    }
    const all = this.allRows();
    const out: string[] = [];
    for (let i = top.window; i < all.length && i < top.window + MENU_ROWS; i++) {
      out.push(all[i]);
    }
    return out;
  }

  /** Pointing addresses a visible row, including the current scroll window. */
  pointRow(row: number): boolean {
    const top = this.top();
    if (!top || row < 0 || row >= this.rows().length) return false;
    top.cursor = top.window + row;
    this.cursor.reset();
    return true;
  }

  /** Which drawn row the cursor is on. */
  cursorRow(): number {
    const top = this.top();
    return top === null ? -1 : top.cursor - top.window;
  }

  /**
   * One frame.
   *
   * `pressedA` and `pressedB` are already edge-triggered by InputSource; the
   * d-pad is not, which is what DPadEdge is for.
   */
  step(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): number {
    const top = this.top();
    if (top === null) {
      return MENU_NONE;
    }
    const all = this.allRows();
    const count = all.length;

    // An empty list still has CANCEL, so count is never zero on the screens
    // that can be empty. Guard anyway rather than divide by it.
    if (count === 0) {
      this.stack.pop();
      return this.stack.length === 0 ? MENU_CLOSED : MENU_NONE;
    }

    const moved = this.cursor.step(pad, dt);
    if (moved === "up") {
      top.cursor = top.cursor > 0 ? top.cursor - 1 : count - 1;
    } else if (moved === "down") {
      top.cursor = top.cursor + 1 < count ? top.cursor + 1 : 0;
    }
    if (top.cursor >= count) {
      top.cursor = count - 1;
    }
    // Keep the cursor inside the window.
    if (top.cursor < top.window) {
      top.window = top.cursor;
    } else if (top.cursor >= top.window + MENU_ROWS) {
      top.window = top.cursor - MENU_ROWS + 1;
    }

    if (pressedB) {
      return this.back();
    }
    if (!pressedA) {
      return MENU_NONE;
    }
    return this.confirm(top, all);
  }

  private back(): number {
    this.stack.pop();
    this.cursor.reset();
    return this.stack.length === 0 ? MENU_CLOSED : MENU_NONE;
  }

  private push(kind: string, purpose: string, pendingItem: string): number {
    this.stack.push(screen(kind, purpose, pendingItem));
    this.cursor.reset();
    return MENU_NONE;
  }

  private confirm(top: MenuScreen, all: string[]): number {
    const row = top.cursor;
    const label = all[row];

    if (top.kind === SCREEN_ROOT) {
      if (label === "POKeMON") {
        return this.push(SCREEN_PARTY, "view", "");
      }
      if (label === "ITEM") {
        return this.push(SCREEN_BAG, "", "");
      }
      if (label === "SAVE") {
        return MENU_SAVE;
      }
      if (label === "OPTION") {
        return MENU_OPTION;
      }
      this.stack = [];
      return MENU_CLOSED;
    }

    if (top.kind === SCREEN_MOVES) {
      if (row < this.moveSlots.length) {
        // The SLOT, not the row. The engine reads moveIndex as a raw slot into
        // mon.moves and a menu can only list the moves that exist. chosenRow()
        // carries the row for callers that map it themselves.
        this.outIndex = this.moveSlots[row];
        this.outRow = row;
        return MENU_MOVE;
      }
      if (label === "POKeMON") {
        return this.push(SCREEN_PARTY, "switch", "");
      }
      if (label === "ITEM") {
        return this.push(SCREEN_BAG, "", "");
      }
      return MENU_RUN;
    }

    if (top.kind === SCREEN_BAG) {
      if (row >= this.state.bag.length) {
        return this.back();
      }
      const id = this.state.bag[row].id;
      // A TM or an HM teaches rather than being used on a target. In battle it
      // does nothing at all (ItemUseNotTime); the refusal line is not ported,
      // which is a divergence rather than a hidden failure.
      if (machineOf(this.bundle, id) !== null) {
        if (this.inBattle) {
          return MENU_NONE;
        }
        this.outItem = id;
        return MENU_TEACH;
      }
      // Outside a battle only medicine, vitamins, a RARE CANDY and a stone
      // ask "Use item on which POKeMON?"; a REPEL or an ESCAPE ROPE acts at
      // once, and a battle item is refused at once (ItemUse.ts). Anything the
      // bag does nothing with outside a battle stays as it was: no target
      // screen for it, and the caller closes.
      if (!this.inBattle) {
        if (!itemUsableOutside(id)) {
          return MENU_NONE;
        }
        if (!itemNeedsTarget(id)) {
          this.outIndex = -1;
          this.outItem = id;
          this.outRow = -1;
          return MENU_ITEM;
        }
      }
      // Every other item is used ON something, so the bag asks for a target.
      // A ball's target is the foe, which the caller resolves.
      return this.push(SCREEN_PARTY, "item", id);
    }

    if (top.kind === SCREEN_MON) {
      const moves = this.fieldMovesAt(top.monIndex);
      if (row >= moves.length) {
        return this.back();
      }
      this.outIndex = top.monIndex;
      this.outMove = moves[row];
      return MENU_FIELD_MOVE;
    }

    if (top.kind === SCREEN_PP) {
      const slot = this.ppSlotAt(top.monIndex, row);
      if (slot < 0) {
        return this.back();
      }
      this.outIndex = top.monIndex;
      this.outItem = top.pendingItem;
      this.outRow = slot;
      return MENU_ITEM;
    }

    if (top.kind === SCREEN_FLY) {
      if (row >= this.flyTowns.length) {
        return this.back();
      }
      this.outMap = this.flyTowns[row];
      return MENU_FLY;
    }

    // party
    if (row >= this.shownParty.length) {
      return this.back();
    }
    if (top.purpose === "switch") {
      // A switch to the Pokemon already out, or to a fainted one, is refused
      // HERE. The engine accepts the turn either way -- it prints a line and
      // still reports ok -- so a menu that sent it would spend the turn on
      // nothing and the player would never learn why.
      if (this.shownParty[row].hp <= 0) {
        return MENU_NONE;
      }
      this.outIndex = row;
      return MENU_SWITCH;
    }
    if (top.purpose === "item") {
      // An ETHER, a MAX ETHER and a PP UP work on ONE move, and ask which.
      if (ppItemNeedsMove(top.pendingItem)) {
        const pushed = this.push(SCREEN_PP, "", top.pendingItem);
        this.stack[this.stack.length - 1].monIndex = row;
        return pushed;
      }
      this.outIndex = row;
      this.outItem = top.pendingItem;
      this.outRow = -1;
      return MENU_ITEM;
    }
    // "view": the cartridge opens this Pokemon's own menu, whose only entries
    // outside a battle are the field moves it knows. A Pokemon that knows none
    // has nothing to offer, so the press does nothing rather than opening an
    // empty list.
    if (top.purpose === "view" && !this.inBattle && this.fieldMovesAt(row).length > 0) {
      const pushed = this.push(SCREEN_MON, "", "");
      this.stack[this.stack.length - 1].monIndex = row;
      return pushed;
    }
    return MENU_NONE;
  }
}
