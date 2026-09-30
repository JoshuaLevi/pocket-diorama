// The Poke Mart: BUY / SELL / QUIT, the price question, the bag and the money.
//
// Pure, like MenuController and for the same reason: a whole visit -- buy three
// Potions, be refused a fourth for want of money, sell a Nugget, leave -- has to
// be playable in a test. The lens draws `rows()` in the menu panel and
// `lines()` in the message box, and feeds `step()` the buttons.
//
// Before this file `open_mart` printed the clerk's stock to the log and the
// script carried on: the mart "worked" in the sense that every gate was green,
// and the player could not buy a single Poke Ball.
//
// What it follows is the cartridge's own mart routine (engine/events/pokemart.asm):
// the greeting, BUY/SELL/QUIT, "Take your time.", the list with prices, the
// quantity, "X? That will be ¥N. OK?", then the bag or the money refusing, then
// "Here you are! Thank you!"; SELL pays half price and cannot price a key item;
// leaving the list asks "Is there anything else I can do?"; QUIT says thank you.
// The texts are the cartridge's, by label; the prices are its item table's.

import type { DPadState } from "./InputSource";
import { DPadEdge } from "./InputSource";
import type { WorldBundle } from "../world/WorldData";
import type { PlayState } from "./PlayState";
import { giveItem, hasItem, takeItem } from "./PlayState";
import { pagesOf } from "./script/Host";

/** Columns the panel can draw, cursor column included. */
export const SHOP_COLUMNS: number = 18;
/** Rows visible at once. A longer list scrolls. */
export const SHOP_ROWS: number = 6;

/** Nothing to report this frame. */
export const SHOP_NONE: number = 0;
/** The shop closed; the script that opened it may continue. */
export const SHOP_CLOSED: number = 1;

/** The cartridge's stack cap and money cap. */
export const MAX_STACK: number = 99;
export const MAX_MONEY: number = 999999;

const SCREEN_ROOT: string = "root";
const SCREEN_BUY: string = "buy";
const SCREEN_SELL: string = "sell";
const SCREEN_QUANTITY: string = "quantity";

const PHASE_LIST: string = "list";
const PHASE_SAY: string = "say";
const PHASE_ASK: string = "ask";

/** The mart's own lines, as the cartridge labels them. */
export const TEXT_GREETING: string = "_PokemartGreetingText";
export const TEXT_TAKE_YOUR_TIME: string = "_PokemartBuyingGreetingText";
export const TEXT_BUY_PRICE: string = "_PokemartTellBuyPriceText";
export const TEXT_SELL_PRICE: string = "_PokemartTellSellPriceText";
export const TEXT_BOUGHT: string = "_PokemartBoughtItemText";
export const TEXT_NO_MONEY: string = "_PokemartNotEnoughMoneyText";
export const TEXT_BAG_FULL: string = "_PokemartItemBagFullText";
export const TEXT_BAG_EMPTY: string = "_PokemartItemBagEmptyText";
export const TEXT_UNSELLABLE: string = "_PokemartUnsellableItemText";
export const TEXT_ANYTHING_ELSE: string = "_PokemartAnythingElseText";
export const TEXT_THANK_YOU: string = "_PokemartThankYouText";

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

export class ShopController {
  private bundle: WorldBundle;
  private state: PlayState;
  private stock: string[];

  private open: boolean = true;
  private phase: string = PHASE_SAY;
  private screen: string = SCREEN_ROOT;
  private cursor: number = 0;
  private window: number = 0;
  private pad: DPadEdge = new DPadEdge();

  /** The item and count a quantity screen is about, and whether it is a sale. */
  private item: string = "";
  private quantity: number = 1;
  private selling: boolean = false;

  /** The message being paged, and what to do once it has been read. */
  private pages: string[][] = [];
  private page: number = 0;
  private askCursor: number = 0;
  private after: (yes: boolean) => void = null;

  constructor(bundle: WorldBundle, state: PlayState, stock: string[]) {
    this.bundle = bundle;
    this.state = state;
    this.stock = stock;
    this.say(TEXT_GREETING, "", -1, () => { this.toRoot(); });
  }

  isOpen(): boolean {
    return this.open;
  }

  /** The message page to show, or null when no message is up. */
  lines(): string[] {
    if (this.phase === PHASE_LIST || this.page >= this.pages.length) {
      return null;
    }
    return this.pages[this.page];
  }

  /** True on the last page of a question, when `rows()` is YES / NO. */
  asking(): boolean {
    return this.phase === PHASE_ASK && this.page === this.pages.length - 1;
  }

  /** What the clerk would charge for one of these. */
  priceOf(item: string): number {
    const def = this.bundle.items ? this.bundle.items[item] : null;
    return def && typeof def.price === "number" ? def.price : 0;
  }

  /** What the clerk pays for one: half, rounded down, as the cartridge does. */
  sellPriceOf(item: string): number {
    return Math.floor(this.priceOf(item) / 2);
  }

  private nameOf(item: string): string {
    const def = this.bundle.items ? this.bundle.items[item] : null;
    return def && def.name ? def.name : item;
  }

  private say(textId: string, ramItem: string, num: number, then: (yes: boolean) => void): void {
    this.showMessage(textId, ramItem, num, then, PHASE_SAY);
  }

  private ask(textId: string, ramItem: string, num: number, then: (yes: boolean) => void): void {
    this.showMessage(textId, ramItem, num, then, PHASE_ASK);
  }

  private showMessage(textId: string, ramItem: string, num: number,
                      then: (yes: boolean) => void, phase: string): void {
    const body = this.bundle.text && this.bundle.text[textId] !== undefined
      ? this.bundle.text[textId] : textId;
    this.pages = pagesOf(body, this.state, ramItem ? this.nameOf(ramItem) : "", num);
    this.page = 0;
    this.askCursor = 0;
    this.after = then;
    this.phase = phase;
  }

  private toRoot(): void {
    this.screen = SCREEN_ROOT;
    this.cursor = 0;
    this.window = 0;
    this.phase = PHASE_LIST;
    this.pad.reset();
  }

  private toList(screen: string): void {
    this.screen = screen;
    this.phase = PHASE_LIST;
    this.pad.reset();
    const count = this.allRows().length;
    if (this.cursor >= count) {
      this.cursor = count - 1;
    }
    if (this.cursor < 0) {
      this.cursor = 0;
    }
  }

  private close(): void {
    this.open = false;
    this.phase = PHASE_LIST;
  }

  /** Every row of the current screen, unwindowed. */
  private allRows(): string[] {
    if (this.screen === SCREEN_ROOT) {
      return ["BUY", "SELL", "QUIT"];
    }
    if (this.screen === SCREEN_BUY) {
      const out: string[] = [];
      for (let i = 0; i < this.stock.length; i++) {
        const price = "¥" + this.priceOf(this.stock[i]);
        out.push(fit(this.nameOf(this.stock[i]), SHOP_COLUMNS - 1 - price.length) + price);
      }
      out.push("CANCEL");
      return out;
    }
    if (this.screen === SCREEN_SELL) {
      const out: string[] = [];
      for (let i = 0; i < this.state.bag.length; i++) {
        const count = "x" + this.state.bag[i].count;
        out.push(fit(this.nameOf(this.state.bag[i].id), SHOP_COLUMNS - 1 - count.length - 1) + " " + count);
      }
      out.push("CANCEL");
      return out;
    }
    // quantity: one row, "x03   ¥900"
    const each = this.selling ? this.sellPriceOf(this.item) : this.priceOf(this.item);
    const total = "¥" + (each * this.quantity);
    return [fit("x" + right("" + this.quantity, 2), SHOP_COLUMNS - 1 - total.length) + total];
  }

  /** The rows to draw: the list, windowed, or YES / NO under a question. */
  rows(): string[] {
    if (this.asking()) {
      return ["YES", "NO"];
    }
    if (this.phase !== PHASE_LIST) {
      return [];
    }
    const all = this.allRows();
    const out: string[] = [];
    for (let i = this.window; i < all.length && i < this.window + SHOP_ROWS; i++) {
      out.push(all[i]);
    }
    return out;
  }

  /** Select a visible row; normal step() still owns the action and validation. */
  pointRow(row: number): boolean {
    if (!this.isOpen() || row < 0 || row >= this.rows().length) return false;
    if (this.asking()) this.askCursor = row;
    else this.cursor = this.window + row;
    this.pad = new DPadEdge();
    return true;
  }

  cursorRow(): number {
    if (this.asking()) {
      return this.askCursor;
    }
    if (this.phase !== PHASE_LIST) {
      return -1;
    }
    return this.cursor - this.window;
  }

  /**
   * One frame. `pressedA` and `pressedB` are edge-triggered by the caller; the
   * d-pad is not, which is what DPadEdge is for.
   */
  step(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): number {
    if (!this.open) {
      return SHOP_CLOSED;
    }
    if (this.phase === PHASE_SAY || this.phase === PHASE_ASK) {
      this.stepMessage(pad, pressedA, pressedB, dt);
      return this.open ? SHOP_NONE : SHOP_CLOSED;
    }
    if (this.screen === SCREEN_QUANTITY) {
      this.stepQuantity(pad, pressedA, pressedB, dt);
      return SHOP_NONE;
    }
    this.stepList(pad, pressedA, pressedB, dt);
    return this.open ? SHOP_NONE : SHOP_CLOSED;
  }

  private stepMessage(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): void {
    const last = this.page === this.pages.length - 1;
    if (this.phase === PHASE_ASK && last) {
      const moved = this.pad.step(pad, dt);
      if (moved === "up" || moved === "down") {
        this.askCursor = this.askCursor === 0 ? 1 : 0;
      }
      if (pressedB) {
        this.finishMessage(false);
        return;
      }
      if (pressedA) {
        this.finishMessage(this.askCursor === 0);
      }
      return;
    }
    if (!pressedA && !pressedB) {
      return;
    }
    if (!last) {
      this.page++;
      return;
    }
    this.finishMessage(true);
  }

  private finishMessage(yes: boolean): void {
    const then = this.after;
    this.after = null;
    this.pages = [];
    this.phase = PHASE_LIST;
    if (then !== null) {
      then(yes);
    }
  }

  private stepList(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): void {
    const all = this.allRows();
    const count = all.length;
    const moved = this.pad.step(pad, dt);
    if (moved === "up") {
      this.cursor = this.cursor > 0 ? this.cursor - 1 : count - 1;
    } else if (moved === "down") {
      this.cursor = this.cursor + 1 < count ? this.cursor + 1 : 0;
    }
    if (this.cursor < this.window) {
      this.window = this.cursor;
    } else if (this.cursor >= this.window + SHOP_ROWS) {
      this.window = this.cursor - SHOP_ROWS + 1;
    }
    if (pressedB) {
      this.back();
      return;
    }
    if (!pressedA) {
      return;
    }
    this.confirm(all[this.cursor]);
  }

  /** B on a list: out of the shop from the root, back to the root from a list. */
  private back(): void {
    if (this.screen === SCREEN_ROOT) {
      this.say(TEXT_THANK_YOU, "", -1, () => { this.close(); });
      return;
    }
    this.say(TEXT_ANYTHING_ELSE, "", -1, () => { this.toRoot(); });
  }

  private confirm(label: string): void {
    if (this.screen === SCREEN_ROOT) {
      if (label === "BUY") {
        this.cursor = 0;
        this.window = 0;
        this.say(TEXT_TAKE_YOUR_TIME, "", -1, () => { this.toList(SCREEN_BUY); });
      } else if (label === "SELL") {
        if (this.state.bag.length === 0) {
          this.say(TEXT_BAG_EMPTY, "", -1, () => { this.toRoot(); });
          return;
        }
        this.cursor = 0;
        this.window = 0;
        this.toList(SCREEN_SELL);
      } else {
        this.say(TEXT_THANK_YOU, "", -1, () => { this.close(); });
      }
      return;
    }
    if (this.screen === SCREEN_BUY) {
      if (this.cursor >= this.stock.length) {
        this.back();
        return;
      }
      this.item = this.stock[this.cursor];
      this.quantity = 1;
      this.selling = false;
      this.screen = SCREEN_QUANTITY;
      this.pad.reset();
      return;
    }
    // sell
    if (this.cursor >= this.state.bag.length) {
      this.back();
      return;
    }
    const slot = this.state.bag[this.cursor];
    if (this.priceOf(slot.id) === 0) {
      // A key item, a badge-shaped thing, a TM the cartridge marks priceless:
      // "I can't put a price on that."
      this.say(TEXT_UNSELLABLE, "", -1, () => { this.toList(SCREEN_SELL); });
      return;
    }
    this.item = slot.id;
    this.quantity = 1;
    this.selling = true;
    this.screen = SCREEN_QUANTITY;
    this.pad.reset();
  }

  /** How many of the current item may be picked: 99 to buy, what you hold to sell. */
  private maxQuantity(): number {
    if (!this.selling) {
      return MAX_STACK;
    }
    for (let i = 0; i < this.state.bag.length; i++) {
      if (this.state.bag[i].id === this.item) {
        return this.state.bag[i].count;
      }
    }
    return 1;
  }

  private stepQuantity(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): void {
    const max = this.maxQuantity();
    const moved = this.pad.step(pad, dt);
    if (moved === "up") {
      this.quantity = this.quantity < max ? this.quantity + 1 : 1;
    } else if (moved === "down") {
      this.quantity = this.quantity > 1 ? this.quantity - 1 : max;
    }
    if (pressedB) {
      this.toList(this.selling ? SCREEN_SELL : SCREEN_BUY);
      return;
    }
    if (!pressedA) {
      return;
    }
    if (this.selling) {
      const paid = this.sellPriceOf(this.item) * this.quantity;
      this.ask(TEXT_SELL_PRICE, this.item, paid, (yes) => { this.sell(yes, paid); });
      return;
    }
    const cost = this.priceOf(this.item) * this.quantity;
    this.ask(TEXT_BUY_PRICE, this.item, cost, (yes) => { this.buy(yes, cost); });
  }

  /**
   * The purchase, in the cartridge's order: the money is checked first, then the
   * bag, and nothing moves until both have said yes -- so a refusal leaves the
   * player exactly as they were.
   */
  private buy(yes: boolean, cost: number): void {
    if (!yes) {
      this.toList(SCREEN_BUY);
      return;
    }
    if (this.state.money < cost) {
      this.say(TEXT_NO_MONEY, "", -1, () => { this.toList(SCREEN_BUY); });
      return;
    }
    if (!this.bagHasRoomFor(this.item, this.quantity)) {
      this.say(TEXT_BAG_FULL, "", -1, () => { this.toList(SCREEN_BUY); });
      return;
    }
    giveItem(this.state, this.item, this.quantity);
    this.state.money = this.state.money - cost;
    this.say(TEXT_BOUGHT, "", -1, () => { this.toList(SCREEN_BUY); });
  }

  /**
   * Whether `count` more of `item` fit: a held stack may not pass 99, and a new
   * kind needs a free slot. PlayState.giveItem checks the slot but not the
   * stack, and the cartridge refuses both with the same line.
   */
  private bagHasRoomFor(item: string, count: number): boolean {
    for (let i = 0; i < this.state.bag.length; i++) {
      if (this.state.bag[i].id === item) {
        return this.state.bag[i].count + count <= MAX_STACK;
      }
    }
    return this.state.bag.length < 20;
  }

  private sell(yes: boolean, paid: number): void {
    if (!yes) {
      this.toList(SCREEN_SELL);
      return;
    }
    if (!hasItem(this.state, this.item, this.quantity)) {
      this.toList(SCREEN_SELL);
      return;
    }
    takeItem(this.state, this.item, this.quantity);
    this.state.money = Math.min(MAX_MONEY, this.state.money + paid);
    // The cartridge says nothing after a sale; the list simply comes back with
    // the stack smaller or gone.
    this.toList(SCREEN_SELL);
  }
}
