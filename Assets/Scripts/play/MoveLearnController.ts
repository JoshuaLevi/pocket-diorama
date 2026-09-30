// "Delete an older move to make room?" -- the four-slot replace prompt.
//
// One controller for every caller that can hit a full moveset: a machine being
// taught, a level-up in battle, an evolution, a Rare Candy. Pure, like
// ShopController and MenuController, so the whole exchange -- read the pages,
// say no, be asked to abandon, say no again, pick an HM slot and be refused,
// pick a real one -- is playable in a headless test.
//
// It never touches the Pokemon. The owner reads decision() and applies it:
// BattleState folds the new move into both the party slot and the battle copy,
// TeachController writes the party slot. Splitting it that way is what lets the
// same prompt run inside a battle, where the party the player sees is the
// battle's deep copy and not the save's.
//
// The flow is engine/pokemon/learn_move.asm LearnMove:
//   _TryingToLearnText, YES/NO on its last page
//     NO  -> _AbandonLearningText, YES/NO
//              YES -> _DidNotLearnText, closed, nothing learned
//              NO  -> back to _TryingToLearnText (DontAbandonLearning)
//     YES -> the four move names, _WhichMoveToForgetText in the box
//              B on the list -> the abandon question
//              an HM slot -> _HMCantDeleteText, back to the list
//              any other  -> "1, 2 and... Poof!", _ForgotAndText, _LearnedMove1Text

import type { DPadState } from "./InputSource";
import { DPadEdge } from "./InputSource";
import type { WorldBundle } from "../world/WorldData";
import type { BattleMon } from "./battle/types";
import { fillSlots } from "./script/Dialogue";
import { isHmMove } from "./FieldMoves";

/** Nothing to report this frame. */
export const LEARN_NONE: number = 0;
/** The prompt is finished; read decision(). */
export const LEARN_CLOSED: number = 1;

/** decision() while the prompt is still open. */
export const LEARN_UNDECIDED: number = -2;
/** The player declined; nothing was learned. */
export const LEARN_ABANDONED: number = -1;

export const TEXT_TRYING: string = "_TryingToLearnText";
export const TEXT_ABANDON: string = "_AbandonLearningText";
export const TEXT_DID_NOT_LEARN: string = "_DidNotLearnText";
export const TEXT_WHICH_FORGET: string = "_WhichMoveToForgetText";
export const TEXT_HM_CANT_DELETE: string = "_HMCantDeleteText";
export const TEXT_ONE_TWO_AND: string = "_OneTwoAndText";
export const TEXT_POOF: string = "_PoofText";
export const TEXT_FORGOT_AND: string = "_ForgotAndText";
export const TEXT_LEARNED: string = "_LearnedMove1Text";

const PHASE_ASK_DELETE: string = "ask-delete";
const PHASE_PICK: string = "pick";
const PHASE_ASK_ABANDON: string = "ask-abandon";
const PHASE_SAY: string = "say";
const PHASE_CLOSED: string = "closed";

export class MoveLearnController {
  private bundle: WorldBundle;
  private mon: BattleMon;
  private move: string;

  private phase: string = PHASE_ASK_DELETE;
  private cursor: number = 0;
  private pad: DPadEdge = new DPadEdge();

  private pages: string[][] = [];
  private page: number = 0;
  private askCursor: number = 0;
  private asks: boolean = false;
  private after: (yes: boolean) => void = null;

  private slot: number = LEARN_UNDECIDED;
  private forgotten: string = "";

  /** The move's name as the cartridge prints it; the id only when the bundle lacks it. */
  private moveName(): string {
    return this.nameOf(this.move);
  }

  private nameOf(moveId: string): string {
    const moves: any = (this.bundle as any).moves;
    const def = moves ? moves[moveId] : null;
    return def && def.name ? def.name : moveId;
  }

  constructor(bundle: WorldBundle, mon: BattleMon, moveId: string) {
    this.bundle = bundle;
    this.mon = mon;
    this.move = moveId;
    this.ask(TEXT_TRYING, [["wLearnMoveMonName", mon.name], ["wStringBuffer", this.moveName()]],
             (yes) => { this.answeredDelete(yes); });
  }

  isOpen(): boolean {
    return this.phase !== PHASE_CLOSED;
  }

  /** The slot chosen, LEARN_ABANDONED, or LEARN_UNDECIDED while open. */
  decision(): number {
    return this.slot;
  }

  /** The move id that was replaced, or "". */
  forgottenMove(): string {
    return this.forgotten;
  }

  rows(): string[] {
    if (this.asking() ) {
      return ["YES", "NO"];
    }
    if (this.phase !== PHASE_PICK) {
      return [];
    }
    const out: string[] = [];
    for (let i = 0; i < this.mon.moves.length; i++) {
      out.push(this.mon.moves[i].id === "" ? "-" : this.mon.moves[i].id);
    }
    return out;
  }

  /** Select a visible row; normal step() still owns the action and validation. */
  pointRow(row: number): boolean {
    if (!this.isOpen() || row < 0 || row >= this.rows().length) return false;
    if (this.asking()) this.askCursor = row;
    else this.cursor = row;
    this.pad = new DPadEdge();
    return true;
  }

  cursorRow(): number {
    if (this.asking()) {
      return this.askCursor;
    }
    return this.phase === PHASE_PICK ? this.cursor : -1;
  }

  /** The page on screen, or null when a list is up instead. */
  lines(): string[] {
    if (this.phase === PHASE_PICK || this.phase === PHASE_CLOSED) {
      return this.phase === PHASE_PICK ? this.boxLine() : null;
    }
    return this.page < this.pages.length ? this.pages[this.page] : null;
  }

  /** True on the last page of a question, when rows() is YES / NO. */
  asking(): boolean {
    return this.asks && this.page === this.pages.length - 1 &&
      (this.phase === PHASE_ASK_DELETE || this.phase === PHASE_ASK_ABANDON);
  }

  step(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): number {
    if (this.phase === PHASE_CLOSED) {
      return LEARN_CLOSED;
    }
    if (this.phase === PHASE_PICK) {
      this.stepList(pad, pressedA, pressedB, dt);
    } else {
      this.stepMessage(pad, pressedA, pressedB, dt);
    }
    return this.phase === PHASE_CLOSED ? LEARN_CLOSED : LEARN_NONE;
  }

  /** _WhichMoveToForgetText, shown beside the list of four. */
  private boxLine(): string[] {
    const body = this.bodyOf(TEXT_WHICH_FORGET);
    return body.split("\n");
  }

  private bodyOf(textId: string): string {
    const table = this.bundle.text ? this.bundle.text : null;
    const body = table && typeof table[textId] === "string" ? table[textId] : textId;
    return body;
  }

  private say(textId: string, slots: string[][], then: (yes: boolean) => void): void {
    this.show(textId, slots, then, false);
  }

  private ask(textId: string, slots: string[][], then: (yes: boolean) => void): void {
    this.show(textId, slots, then, true);
  }

  /** Several labels as one message, which is how "1, 2 and... Poof!" reads. */
  private sayAll(textIds: string[], slots: string[][], then: (yes: boolean) => void): void {
    let body = "";
    for (let i = 0; i < textIds.length; i++) {
      body = body + this.bodyOf(textIds[i]);
    }
    this.pages = this.paginate(fillSlots(body, slots));
    this.page = 0;
    this.askCursor = 0;
    this.asks = false;
    this.after = then;
    this.phase = PHASE_SAY;
  }

  private show(textId: string, slots: string[][], then: (yes: boolean) => void,
               asks: boolean): void {
    this.pages = this.paginate(fillSlots(this.bodyOf(textId), slots));
    this.page = 0;
    this.askCursor = 0;
    this.asks = asks;
    this.after = then;
    this.phase = asks ? PHASE_ASK_DELETE : PHASE_SAY;
  }

  /**
   * Pages of at most two lines, on the cartridge's own control characters:
   * \f starts a page, \v scrolls, \n breaks a line. The same rule Dialogue
   * paginate() applies; duplicated rather than imported so this file does not
   * pull the whole dialogue module into a controller that shows four words.
   */
  private paginate(body: string): string[][] {
    const out: string[][] = [];
    let lines: string[] = [];
    const chunks = body.split("\f");
    for (let c = 0; c < chunks.length; c++) {
      if (c === 0 && chunks[c] === "" && chunks.length > 1) {
        continue;
      }
      const parts = chunks[c].split("\v").join("\n").split("\n");
      for (let i = 0; i < parts.length; i++) {
        lines.push(parts[i]);
        if (lines.length === 2) {
          out.push(lines);
          lines = [];
        }
      }
      if (lines.length > 0) {
        out.push(lines);
        lines = [];
      }
    }
    return out.length > 0 ? out : [[""]];
  }

  private stepMessage(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): void {
    const last = this.page === this.pages.length - 1;
    if (this.asks && last) {
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
    this.asks = false;
    if (then !== null) {
      then(yes);
    }
  }

  private stepList(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): void {
    const count = this.mon.moves.length;
    const moved = this.pad.step(pad, dt);
    if (moved === "up") {
      this.cursor = this.cursor > 0 ? this.cursor - 1 : count - 1;
    } else if (moved === "down") {
      this.cursor = this.cursor + 1 < count ? this.cursor + 1 : 0;
    }
    if (pressedB) {
      // Backing out of the list is the same question as saying no to it.
      this.askAbandon();
      return;
    }
    if (!pressedA) {
      return;
    }
    const chosen = this.mon.moves[this.cursor];
    if (chosen && isHmMove(chosen.id)) {
      // An HM move is permanent in Gen 1: there is no Move Deleter.
      this.say(TEXT_HM_CANT_DELETE, [], () => { this.phase = PHASE_PICK; });
      return;
    }
    this.forgotten = chosen ? chosen.id : "";
    const picked = this.cursor;
    this.sayAll([TEXT_ONE_TWO_AND, TEXT_POOF], [], () => {
      this.sayAll([TEXT_FORGOT_AND, TEXT_LEARNED],
                  [["wLearnMoveMonName", this.mon.name],
                   ["wNameBuffer", this.nameOf(this.forgotten)],
                   ["wStringBuffer", this.moveName()]],
                  () => { this.slot = picked; this.phase = PHASE_CLOSED; });
    });
  }

  private answeredDelete(yes: boolean): void {
    if (yes) {
      this.cursor = 0;
      this.pad.reset();
      this.phase = PHASE_PICK;
      return;
    }
    this.askAbandon();
  }

  private askAbandon(): void {
    this.ask(TEXT_ABANDON, [["wStringBuffer", this.moveName()]], (yes) => {
      if (!yes) {
        // DontAbandonLearning: back to the same question, not out.
        this.ask(TEXT_TRYING,
                 [["wLearnMoveMonName", this.mon.name], ["wStringBuffer", this.moveName()]],
                 (again) => { this.answeredDelete(again); });
        return;
      }
      this.say(TEXT_DID_NOT_LEARN,
               [["wLearnMoveMonName", this.mon.name], ["wStringBuffer", this.moveName()]],
               () => { this.slot = LEARN_ABANDONED; this.phase = PHASE_CLOSED; });
    });
    this.phase = PHASE_ASK_ABANDON;
  }
}
