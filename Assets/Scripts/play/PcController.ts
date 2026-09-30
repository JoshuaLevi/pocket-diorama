// The PC: the bedroom terminal's item store, and a Pokemon Center's boxes.
//
// Pure, like ShopController and MenuController and for the same reason: a whole
// visit -- turn it on, deposit a Pokemon, withdraw a POTION, change boxes,
// log off -- has to be playable in a test. The lens draws `rows()` in the menu
// panel and `lines()` in the message box, and feeds `step()` the buttons.
//
// Before this file the box existed in the save (PLAY_STATE_VERSION 2 put a
// caught Pokemon there when the party was full) and there was no way to get one
// back out: the PC tile did nothing at all.
//
// Measured on the cartridge, 7 September, at the two terminals that differ:
//
//   Red's bedroom (REDS_HOUSE_2F, the tile at 0,1 faced from 0,2)
//     "RED turned on the PC." -> WITHDRAW ITEM / DEPOSIT ITEM / TOSS ITEM /
//     LOG OFF under "What do you want to do?". No top menu: the bedroom
//     terminal IS the item PC. TOSS ITEM lists what the PC holds, not the bag.
//
//   Viridian's Pokemon Center (the tile at 13,3 faced from 13,4 -- every
//   Center's is the same cell)
//     "RED turned on the PC." -> SOMEONE's PC / RED's PC / LOG OFF, with the
//     message box EMPTY under it. SOMEONE's PC -> "Accessed someone's PC." ,
//     "Accessed POKeMON Storage System." -> WITHDRAW / DEPOSIT / RELEASE /
//     CHANGE BOX / SEE YA!, under "What?" beside a "BOX No. 1" window.
//     Refusals seen: "What? There are no POKeMON here!" on an empty box and
//     "You can't deposit the last POKeMON!" on a party of one.
//
// PROF.OAK's PC is the one entry not measured -- it needs the Pokedex, which
// the after-rival start is before -- so its label is the cartridge's own
// spelling from _ClosedOaksPCText and its flow prints the cartridge's lines.
// The SEEN/OWN counter window the rating draws beside them is NOT drawn here.
// HALL OF FAME cannot appear yet: nothing sets a Hall of Fame count (SPEC row
// 11, the ending).

import type { DPadState } from "./InputSource";
import { DPadEdge } from "./InputSource";
import type { WorldBundle } from "../world/WorldData";
import type { PlayState } from "./PlayState";
import { BOX_COUNT } from "./PlayState";
import { pagesOf } from "./script/Host";
import {
  boxNumber, currentBox, depositFromParty, releaseFromBox, withdrawFromBox,
} from "./Storage";
import {
  depositItem, isKeyItem, pcItems, tossPcItem, withdrawItem,
  TEXT_HOW_MANY, TEXT_IS_IT_OK_TO_TOSS, TEXT_ITEM_STORED,
  TEXT_NOTHING_STORED, TEXT_NOTHING_TO_DEPOSIT, TEXT_THREW_AWAY, TEXT_TOO_IMPORTANT,
  TEXT_WHAT_DO_YOU_WANT, TEXT_WHAT_TO_DEPOSIT, TEXT_WHAT_TO_TOSS, TEXT_WHAT_TO_WITHDRAW,
  TEXT_WITHDREW,
} from "./PcItems";
import {
  fit, itemRow, monRow, ownedCount, pad2, ratingLabel,
  PC_COLUMNS, PC_ROWS,
  TEXT_ACCESSED_BILLS, TEXT_ACCESSED_MY_PC, TEXT_ACCESSED_OAKS, TEXT_ACCESSED_SOMEONES,
  TEXT_CHOOSE_A_BOX, TEXT_CHANGE_BOX_SAVES, TEXT_CLOSED_OAKS, TEXT_DEPOSIT_WHICH_MON,
  TEXT_DEX_RATING, TEXT_GET_DEX_RATED, TEXT_MON_RELEASED, TEXT_MON_STORED,
  TEXT_MON_TAKEN_OUT, TEXT_NO_MON, TEXT_ONCE_RELEASED, TEXT_RELEASE_WHICH,
  TEXT_TURNED_ON, TEXT_WHAT,
} from "./PcScreens";
export {
  PC_COLUMNS, PC_ROWS, ratingLabel,
} from "./PcScreens";

/** Which terminal this is. */
export const PC_KIND_HOME: string = "home";
export const PC_KIND_FULL: string = "full";

/** Nothing to report this frame. */
export const PC_NONE: number = 0;
/** Logged off; whatever opened the PC may continue. */
export const PC_CLOSED: number = 1;

const SCREEN_ROOT: string = "root";
const SCREEN_ITEM: string = "item";
const SCREEN_BOX: string = "box";
const SCREEN_LIST: string = "list";
const SCREEN_QUANTITY: string = "quantity";
const SCREEN_CHOOSE_BOX: string = "chooseBox";

const PHASE_LIST: string = "list";
const PHASE_SAY: string = "say";
const PHASE_ASK: string = "ask";

/** What the open list is for. */
const JOB_WITHDRAW_ITEM: string = "withdrawItem";
const JOB_DEPOSIT_ITEM: string = "depositItem";
const JOB_TOSS_ITEM: string = "tossItem";
const JOB_WITHDRAW_MON: string = "withdrawMon";
const JOB_DEPOSIT_MON: string = "depositMon";
const JOB_RELEASE_MON: string = "releaseMon";

const CANCEL: string = "CANCEL";

export class PcController {
  private bundle: WorldBundle;
  private state: PlayState;
  private kind: string;

  private open: boolean = true;
  private phase: string = PHASE_SAY;
  private screen: string = SCREEN_ROOT;
  private cursor: number = 0;
  private window: number = 0;
  private pad: DPadEdge = new DPadEdge();

  /** The list the current SCREEN_LIST is showing, and what A does with it. */
  private job: string = "";
  /** The chosen row's item id or party/box index, carried into the quantity. */
  private chosenItem: string = "";
  private chosenIndex: number = -1;
  private quantity: number = 1;
  private quantityMax: number = 1;

  /** The message being paged, and what to do once it has been read. */
  private pages: string[][] = [];
  private page: number = 0;
  private askCursor: number = 0;
  private after: (yes: boolean) => void = null;

  constructor(bundle: WorldBundle, state: PlayState, kind: string) {
    this.bundle = bundle;
    this.state = state;
    this.kind = kind === PC_KIND_FULL ? PC_KIND_FULL : PC_KIND_HOME;
    // Both terminals open on the same line; only what follows it differs.
    this.say(TEXT_TURNED_ON, "", -1, () => {
      if (this.kind === PC_KIND_FULL) {
        this.toMenu(SCREEN_ROOT);
      } else {
        this.toMenu(SCREEN_ITEM);
      }
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  /** The message page to show, or null when no message is up. */
  lines(): string[] {
    if (this.phase === PHASE_LIST) {
      return this.prompt();
    }
    if (this.page >= this.pages.length) {
      return null;
    }
    return this.pages[this.page];
  }

  /** True on the last page of a question, when `rows()` is YES / NO. */
  asking(): boolean {
    return this.phase === PHASE_ASK && this.page === this.pages.length - 1;
  }

  /**
   * The words under an open list.
   *
   * The cartridge puts "What?" in the box and "BOX No. 1" in a window of its
   * own beside it; this lens has one box of two lines, so the box number goes
   * on the second. Both strings are the cartridge's -- only the place is ours.
   */
  private prompt(): string[] {
    if (this.screen === SCREEN_ROOT) {
      return null;
    }
    if (this.screen === SCREEN_ITEM) {
      return this.resolve(TEXT_WHAT_DO_YOU_WANT)[0];
    }
    if (this.screen === SCREEN_BOX) {
      const what = this.resolve(TEXT_WHAT)[0];
      return [what.length > 0 ? what[0] : "What?", "BOX No. " + boxNumber(this.state)];
    }
    if (this.screen === SCREEN_CHOOSE_BOX) {
      return this.resolve(TEXT_CHOOSE_A_BOX)[0];
    }
    if (this.screen === SCREEN_QUANTITY) {
      return this.resolve(TEXT_HOW_MANY)[0];
    }
    if (this.job === JOB_WITHDRAW_ITEM) {
      return this.resolve(TEXT_WHAT_TO_WITHDRAW)[0];
    }
    if (this.job === JOB_DEPOSIT_ITEM) {
      return this.resolve(TEXT_WHAT_TO_DEPOSIT)[0];
    }
    if (this.job === JOB_TOSS_ITEM) {
      return this.resolve(TEXT_WHAT_TO_TOSS)[0];
    }
    if (this.job === JOB_WITHDRAW_MON) {
      return this.resolve(TEXT_WHAT_TO_WITHDRAW)[0];
    }
    if (this.job === JOB_DEPOSIT_MON) {
      return this.resolve(TEXT_DEPOSIT_WHICH_MON)[0];
    }
    if (this.job === JOB_RELEASE_MON) {
      return this.resolve(TEXT_RELEASE_WHICH)[0];
    }
    return null;
  }

  // -- text ------------------------------------------------------------------

  private bodyOf(textId: string): string {
    return this.bundle.text && this.bundle.text[textId] !== undefined
      ? this.bundle.text[textId] : textId;
  }

  private resolve(textId: string): string[][] {
    return pagesOf(this.bodyOf(textId), this.state, "", -1);
  }

  private say(textId: string, ram: string, num: number, then: (yes: boolean) => void): void {
    this.showMessage(textId, ram, num, then, PHASE_SAY);
  }

  private ask(textId: string, ram: string, then: (yes: boolean) => void): void {
    this.showMessage(textId, ram, -1, then, PHASE_ASK);
  }

  private showMessage(textId: string, ram: string, num: number,
                      then: (yes: boolean) => void, phase: string): void {
    this.pages = pagesOf(this.bodyOf(textId), this.state, ram, num);
    this.page = 0;
    this.askCursor = 0;
    this.after = then;
    this.phase = phase;
  }

  /**
   * "X was stored in Box N." carries the name and the number in two different
   * {RAM:} slots, and pagesOf fills every slot with the same string. The
   * number is substituted here first so the name can have the rest.
   */
  private sayStored(name: string, box: number, then: (yes: boolean) => void): void {
    let body = this.bodyOf(TEXT_MON_STORED);
    while (body.indexOf("{RAM:wBoxNumString}") >= 0) {
      body = body.replace("{RAM:wBoxNumString}", "" + box);
    }
    this.pages = pagesOf(body, this.state, name, -1);
    this.page = 0;
    this.askCursor = 0;
    this.after = then;
    this.phase = PHASE_SAY;
  }

  // -- navigation ------------------------------------------------------------

  private toMenu(screen: string): void {
    this.screen = screen;
    this.job = "";
    this.cursor = 0;
    this.window = 0;
    this.phase = PHASE_LIST;
    this.pad.reset();
  }

  /** Back to the list this job is about, keeping the cursor inside it. */
  private toList(job: string): void {
    this.screen = SCREEN_LIST;
    this.job = job;
    this.phase = PHASE_LIST;
    this.pad.reset();
    const count = this.allRows().length;
    if (this.cursor >= count) {
      this.cursor = count - 1;
    }
    if (this.cursor < 0) {
      this.cursor = 0;
    }
    if (this.window > this.cursor) {
      this.window = this.cursor;
    }
  }

  private close(): void {
    this.open = false;
    this.phase = PHASE_LIST;
  }

  /** LOG OFF from the item screen: out at home, back to the top at a Center. */
  private leaveItem(): void {
    if (this.kind === PC_KIND_FULL) {
      this.toMenu(SCREEN_ROOT);
      return;
    }
    this.close();
  }

  // -- rows ------------------------------------------------------------------

  /** The label the top menu gives the box, which meeting Bill changes. */
  private someonesLabel(): string {
    return this.state.flags && this.state.flags.EVENT_MET_BILL === true
      ? "BILL's PC" : "SOMEONE's PC";
  }

  private hasPokedex(): boolean {
    return this.state.flags ? this.state.flags.EVENT_GOT_POKEDEX === true : false;
  }

  private nameOf(item: string): string {
    const def = this.bundle.items ? this.bundle.items[item] : null;
    return def && def.name ? def.name : item;
  }

  /** Every row of the current screen, unwindowed. */
  private allRows(): string[] {
    if (this.screen === SCREEN_ROOT) {
      const out: string[] = [this.someonesLabel(), this.state.playerName + "'s PC"];
      if (this.hasPokedex()) {
        out.push("PROF.OAK's PC");
      }
      out.push("LOG OFF");
      return out;
    }
    if (this.screen === SCREEN_ITEM) {
      return ["WITHDRAW ITEM", "DEPOSIT ITEM", "TOSS ITEM", "LOG OFF"];
    }
    if (this.screen === SCREEN_BOX) {
      return ["WITHDRAW", "DEPOSIT", "RELEASE", "CHANGE BOX", "SEE YA!"];
    }
    if (this.screen === SCREEN_CHOOSE_BOX) {
      const out: string[] = [];
      for (let i = 0; i < BOX_COUNT; i++) {
        const held = this.state.boxes[i] ? this.state.boxes[i].length : 0;
        out.push(fit("BOX " + (i + 1), PC_COLUMNS - 4) + fit("" + held, 3));
      }
      out.push(CANCEL);
      return out;
    }
    if (this.screen === SCREEN_QUANTITY) {
      return ["×" + pad2(this.quantity)];
    }
    return this.listRows();
  }

  private listRows(): string[] {
    const out: string[] = [];
    if (this.job === JOB_WITHDRAW_ITEM || this.job === JOB_TOSS_ITEM) {
      const store = pcItems(this.state);
      for (let i = 0; i < store.length; i++) {
        out.push(itemRow(this.nameOf(store[i].id), store[i].count));
      }
    } else if (this.job === JOB_DEPOSIT_ITEM) {
      for (let i = 0; i < this.state.bag.length; i++) {
        out.push(itemRow(this.nameOf(this.state.bag[i].id), this.state.bag[i].count));
      }
    } else if (this.job === JOB_DEPOSIT_MON) {
      for (let i = 0; i < this.state.party.length; i++) {
        out.push(monRow(this.state.party[i]));
      }
    } else {
      const box = currentBox(this.state);
      for (let i = 0; i < box.length; i++) {
        out.push(monRow(box[i]));
      }
    }
    out.push(CANCEL);
    return out;
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
    for (let i = this.window; i < all.length && i < this.window + PC_ROWS; i++) {
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

  // -- one frame -------------------------------------------------------------

  step(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): number {
    if (!this.open) {
      return PC_CLOSED;
    }
    if (this.phase === PHASE_SAY || this.phase === PHASE_ASK) {
      this.stepMessage(pad, pressedA, pressedB, dt);
      return this.open ? PC_NONE : PC_CLOSED;
    }
    if (this.screen === SCREEN_QUANTITY) {
      this.stepQuantity(pad, pressedA, pressedB, dt);
      return PC_NONE;
    }
    this.stepList(pad, pressedA, pressedB, dt);
    return this.open ? PC_NONE : PC_CLOSED;
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
    } else if (this.cursor >= this.window + PC_ROWS) {
      this.window = this.cursor - PC_ROWS + 1;
    }
    if (pressedB) {
      this.back();
      return;
    }
    if (!pressedA) {
      return;
    }
    this.choose(this.cursor, all[this.cursor]);
  }

  private stepQuantity(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): void {
    const moved = this.pad.step(pad, dt);
    if (moved === "up") {
      this.quantity = this.quantity < this.quantityMax ? this.quantity + 1 : 1;
    } else if (moved === "down") {
      this.quantity = this.quantity > 1 ? this.quantity - 1 : this.quantityMax;
    }
    if (pressedB) {
      this.toList(this.job);
      return;
    }
    if (pressedA) {
      this.commitQuantity();
    }
  }

  /** B: out of a list to its menu, out of the item or box menu, off the PC. */
  private back(): void {
    if (this.screen === SCREEN_ROOT) {
      this.close();
      return;
    }
    if (this.screen === SCREEN_ITEM) {
      this.leaveItem();
      return;
    }
    if (this.screen === SCREEN_BOX) {
      this.toMenu(SCREEN_ROOT);
      return;
    }
    if (this.screen === SCREEN_CHOOSE_BOX) {
      this.toMenu(SCREEN_BOX);
      return;
    }
    this.toMenu(this.itemJob() ? SCREEN_ITEM : SCREEN_BOX);
  }

  private itemJob(): boolean {
    return this.job === JOB_WITHDRAW_ITEM || this.job === JOB_DEPOSIT_ITEM ||
           this.job === JOB_TOSS_ITEM;
  }

  private choose(index: number, label: string): void {
    if (this.screen === SCREEN_ROOT) {
      this.chooseRoot(label);
      return;
    }
    if (this.screen === SCREEN_ITEM) {
      this.chooseItemAction(label);
      return;
    }
    if (this.screen === SCREEN_BOX) {
      this.chooseBoxAction(label);
      return;
    }
    if (this.screen === SCREEN_CHOOSE_BOX) {
      if (label === CANCEL) {
        this.toMenu(SCREEN_BOX);
        return;
      }
      this.state.currentBox = index;
      this.toMenu(SCREEN_BOX);
      return;
    }
    if (label === CANCEL) {
      this.back();
      return;
    }
    this.chooseFromList(index);
  }

  private chooseRoot(label: string): void {
    if (label === "LOG OFF") {
      this.close();
      return;
    }
    if (label === "PROF.OAK's PC") {
      this.say(TEXT_ACCESSED_OAKS, "", -1, () => { this.askRating(); });
      return;
    }
    if (label === this.state.playerName + "'s PC") {
      this.say(TEXT_ACCESSED_MY_PC, "", -1, () => { this.toMenu(SCREEN_ITEM); });
      return;
    }
    const line = this.state.flags && this.state.flags.EVENT_MET_BILL === true
      ? TEXT_ACCESSED_BILLS : TEXT_ACCESSED_SOMEONES;
    this.say(line, "", -1, () => { this.toMenu(SCREEN_BOX); });
  }

  private askRating(): void {
    this.ask(TEXT_GET_DEX_RATED, "", (yes: boolean) => {
      if (!yes) {
        this.say(TEXT_CLOSED_OAKS, "", -1, () => { this.toMenu(SCREEN_ROOT); });
        return;
      }
      this.say(TEXT_DEX_RATING, "", -1, () => {
        this.say(ratingLabel(ownedCount(this.state)), "", -1, () => {
          this.say(TEXT_CLOSED_OAKS, "", -1, () => { this.toMenu(SCREEN_ROOT); });
        });
      });
    });
  }

  private chooseItemAction(label: string): void {
    if (label === "LOG OFF") {
      this.leaveItem();
      return;
    }
    if (label === "WITHDRAW ITEM") {
      if (pcItems(this.state).length === 0) {
        this.say(TEXT_NOTHING_STORED, "", -1, () => { this.toMenu(SCREEN_ITEM); });
        return;
      }
      this.cursor = 0;
      this.window = 0;
      this.toList(JOB_WITHDRAW_ITEM);
      return;
    }
    if (label === "DEPOSIT ITEM") {
      if (this.state.bag.length === 0) {
        this.say(TEXT_NOTHING_TO_DEPOSIT, "", -1, () => { this.toMenu(SCREEN_ITEM); });
        return;
      }
      this.cursor = 0;
      this.window = 0;
      this.toList(JOB_DEPOSIT_ITEM);
      return;
    }
    if (pcItems(this.state).length === 0) {
      this.say(TEXT_NOTHING_STORED, "", -1, () => { this.toMenu(SCREEN_ITEM); });
      return;
    }
    this.cursor = 0;
    this.window = 0;
    this.toList(JOB_TOSS_ITEM);
  }

  private chooseBoxAction(label: string): void {
    if (label === "SEE YA!") {
      this.toMenu(SCREEN_ROOT);
      return;
    }
    if (label === "CHANGE BOX") {
      this.ask(TEXT_CHANGE_BOX_SAVES, "", (yes: boolean) => {
        if (!yes) {
          this.toMenu(SCREEN_BOX);
          return;
        }
        this.say(TEXT_CHOOSE_A_BOX, "", -1, () => {
          this.toMenu(SCREEN_CHOOSE_BOX);
          this.cursor = this.state.currentBox;
        });
      });
      return;
    }
    if (label === "DEPOSIT") {
      this.cursor = 0;
      this.window = 0;
      this.toList(JOB_DEPOSIT_MON);
      return;
    }
    if (currentBox(this.state).length === 0) {
      this.say(TEXT_NO_MON, "", -1, () => { this.toMenu(SCREEN_BOX); });
      return;
    }
    this.cursor = 0;
    this.window = 0;
    this.toList(label === "WITHDRAW" ? JOB_WITHDRAW_MON : JOB_RELEASE_MON);
  }

  private chooseFromList(index: number): void {
    if (this.itemJob()) {
      this.chooseItem(index);
      return;
    }
    this.chooseMon(index);
  }

  private chooseItem(index: number): void {
    const list = this.job === JOB_DEPOSIT_ITEM ? this.state.bag : pcItems(this.state);
    if (index < 0 || index >= list.length) {
      return;
    }
    this.chosenItem = list[index].id;
    this.chosenIndex = index;
    // The cartridge refuses a key item the moment it is picked for tossing,
    // before it ever asks how many.
    if (this.job === JOB_TOSS_ITEM && isKeyItem(this.bundle, this.chosenItem)) {
      this.say(TEXT_TOO_IMPORTANT, "", -1, () => { this.toList(JOB_TOSS_ITEM); });
      return;
    }
    this.quantity = 1;
    this.quantityMax = list[index].count;
    this.screen = SCREEN_QUANTITY;
    this.phase = PHASE_LIST;
    this.pad.reset();
  }

  private commitQuantity(): void {
    const name = this.nameOf(this.chosenItem);
    const n = this.quantity;
    if (this.job === JOB_WITHDRAW_ITEM) {
      const done = withdrawItem(this.state, this.chosenItem, n);
      this.afterItemMove(done.ok, done.refusal, TEXT_WITHDREW, name, JOB_WITHDRAW_ITEM);
      return;
    }
    if (this.job === JOB_DEPOSIT_ITEM) {
      const done = depositItem(this.state, this.chosenItem, n);
      this.afterItemMove(done.ok, done.refusal, TEXT_ITEM_STORED, name, JOB_DEPOSIT_ITEM);
      return;
    }
    this.ask(TEXT_IS_IT_OK_TO_TOSS, name, (yes: boolean) => {
      if (!yes) {
        this.toList(JOB_TOSS_ITEM);
        return;
      }
      const done = tossPcItem(this.bundle, this.state, this.chosenItem, n);
      this.afterItemMove(done.ok, done.refusal, TEXT_THREW_AWAY, name, JOB_TOSS_ITEM);
    });
  }

  /** The line the move earned, then back to the list -- or its menu if empty. */
  private afterItemMove(ok: boolean, refusal: string, said: string,
                        name: string, job: string): void {
    this.say(ok ? said : refusal, name, -1, () => {
      const source = job === JOB_DEPOSIT_ITEM ? this.state.bag : pcItems(this.state);
      if (source.length === 0) {
        this.toMenu(SCREEN_ITEM);
        return;
      }
      this.toList(job);
    });
  }

  private chooseMon(index: number): void {
    if (this.job === JOB_DEPOSIT_MON) {
      const mon = index >= 0 && index < this.state.party.length ? this.state.party[index] : null;
      const name = mon ? mon.name : "";
      const box = boxNumber(this.state);
      const done = depositFromParty(this.state, index);
      if (!done.ok) {
        this.say(done.refusal, name, -1, () => { this.toList(JOB_DEPOSIT_MON); });
        return;
      }
      this.sayStored(name, box, () => {
        if (this.state.party.length === 0) {
          this.toMenu(SCREEN_BOX);
          return;
        }
        this.toList(JOB_DEPOSIT_MON);
      });
      return;
    }
    const box = currentBox(this.state);
    const mon = index >= 0 && index < box.length ? box[index] : null;
    const name = mon ? mon.name : "";
    if (this.job === JOB_RELEASE_MON) {
      this.chosenIndex = index;
      this.ask(TEXT_ONCE_RELEASED, name, (yes: boolean) => {
        if (!yes) {
          this.toList(JOB_RELEASE_MON);
          return;
        }
        const done = releaseFromBox(this.state, this.chosenIndex);
        this.say(done.ok ? TEXT_MON_RELEASED : done.refusal, name, -1, () => {
          this.backToBoxList(JOB_RELEASE_MON);
        });
      });
      return;
    }
    const done = withdrawFromBox(this.bundle, this.state, index);
    this.say(done.ok ? TEXT_MON_TAKEN_OUT : done.refusal, name, -1, () => {
      this.backToBoxList(JOB_WITHDRAW_MON);
    });
  }

  private backToBoxList(job: string): void {
    if (currentBox(this.state).length === 0) {
      this.toMenu(SCREEN_BOX);
      return;
    }
    this.toList(job);
  }
}
