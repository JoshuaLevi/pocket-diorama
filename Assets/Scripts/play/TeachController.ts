// Teaching a TM or an HM, from the overworld bag.
//
// Without this nothing in the game can ever know CUT, and the whole field-move
// system is a road with no on-ramp: HM01 is handed over on the S.S. Anne and
// there was no way to put it into a Pokemon.
//
// Pure, and drawn exactly like the shop: rows() in the menu panel, lines() in
// the message box, step() fed the buttons. The full-moveset case is handed to
// MoveLearnController, which is the same prompt a level-up and a Rare Candy
// will use.
//
// engine/items/item_effects.asm ItemUseTMHM:
//   _BootedUpTMText or _BootedUpHMText
//   _TeachMachineMoveText, YES/NO -- NO closes and the machine is untouched
//   the party list with _PartyMenuUseTMText in the box -- B closes, untouched
//   the species' TM/HM bitfield says no      -> _MonCannotLearnMachineMoveText
//   it already has the move                  -> _AlreadyKnowsText
//   a free slot                              -> _LearnedMove1Text
//   four moves                               -> the replace prompt
// A TM is consumed only when the move is actually learned; an HM never is.

import type { DPadState } from "./InputSource";
import { DPadEdge } from "./InputSource";
import type { WorldBundle } from "../world/WorldData";
import { machineOf } from "../world/WorldData";
import type { PlayState } from "./PlayState";
import { takeItem } from "./PlayState";
import type { BattleMon } from "./battle/types";
import { knowsMove, learnMove, replaceMove, LEARN_LEARNED } from "./battle/Party";
import { fillSlots } from "./script/Dialogue";
import { MoveLearnController, LEARN_ABANDONED, LEARN_CLOSED } from "./MoveLearnController";

/** Nothing to report this frame. */
export const TEACH_NONE: number = 0;
/** Finished; the caller takes the frame back. */
export const TEACH_CLOSED: number = 1;

/** Columns the panel draws, cursor column included. */
export const TEACH_COLUMNS: number = 18;

export const TEXT_BOOTED_TM: string = "_BootedUpTMText";
export const TEXT_BOOTED_HM: string = "_BootedUpHMText";
export const TEXT_TEACH: string = "_TeachMachineMoveText";
export const TEXT_WHICH_MON: string = "_PartyMenuUseTMText";
export const TEXT_CANNOT_LEARN: string = "_MonCannotLearnMachineMoveText";
export const TEXT_ALREADY_KNOWS: string = "_AlreadyKnowsText";
export const TEXT_LEARNED: string = "_LearnedMove1Text";

const PHASE_SAY: string = "say";
const PHASE_ASK: string = "ask";
const PHASE_PARTY: string = "party";
const PHASE_LEARN: string = "learn";
const PHASE_CLOSED: string = "closed";

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

export class TeachController {
  private bundle: WorldBundle;
  private state: PlayState;
  private itemId: string;
  private move: string = "";
  private kind: string = "TM";

  private phase: string = PHASE_SAY;
  private cursor: number = 0;
  private window: number = 0;
  private pad: DPadEdge = new DPadEdge();

  private pages: string[][] = [];
  private page: number = 0;
  private askCursor: number = 0;
  private after: (yes: boolean) => void = null;

  private learn: MoveLearnController = null;
  private target: number = -1;
  private taken: boolean = false;

  constructor(bundle: WorldBundle, state: PlayState, itemId: string) {
    this.bundle = bundle;
    this.state = state;
    this.itemId = itemId;
    const machine = machineOf(bundle, itemId);
    if (machine === null) {
      print("[TeachController] " + itemId + " is not a machine");
      this.phase = PHASE_CLOSED;
      return;
    }
    this.move = machine.move;
    this.kind = machine.kind;
    this.say(this.kind === "HM" ? TEXT_BOOTED_HM : TEXT_BOOTED_TM, [], () => {
      this.ask(TEXT_TEACH, [["wStringBuffer", this.move]], (yes) => {
        if (!yes) {
          this.phase = PHASE_CLOSED;
          return;
        }
        this.toParty();
      });
    });
  }

  isOpen(): boolean {
    return this.phase !== PHASE_CLOSED;
  }

  /** True when the machine left the bag. A TM does; an HM never. */
  consumed(): boolean {
    return this.taken;
  }

  /** The move this machine carries, for the caller's status line. */
  moveId(): string {
    return this.move;
  }

  rows(): string[] {
    if (this.phase === PHASE_LEARN) {
      return this.learn.rows();
    }
    if (this.asking()) {
      return ["YES", "NO"];
    }
    if (this.phase !== PHASE_PARTY) {
      return [];
    }
    const out: string[] = [];
    const party = this.state.party;
    for (let i = this.window; i < party.length && i < this.window + 6; i++) {
      out.push(this.partyRow(party[i]));
    }
    return out;
  }

  /** Select a visible row; normal step() still owns the action and validation. */
  pointRow(row: number): boolean {
    if (this.phase === PHASE_LEARN) return this.learn.pointRow(row);
    if (!this.isOpen() || row < 0 || row >= this.rows().length) return false;
    if (this.asking()) this.askCursor = row;
    else this.cursor = this.window + row;
    this.pad = new DPadEdge();
    return true;
  }

  cursorRow(): number {
    if (this.phase === PHASE_LEARN) {
      return this.learn.cursorRow();
    }
    if (this.asking()) {
      return this.askCursor;
    }
    return this.phase === PHASE_PARTY ? this.cursor - this.window : -1;
  }

  lines(): string[] {
    if (this.phase === PHASE_LEARN) {
      return this.learn.lines();
    }
    if (this.phase === PHASE_PARTY) {
      return this.bodyOf(TEXT_WHICH_MON).split("\n");
    }
    if (this.phase === PHASE_CLOSED) {
      return null;
    }
    return this.page < this.pages.length ? this.pages[this.page] : null;
  }

  asking(): boolean {
    // Delegated while the replace prompt is up: rows() already hands over its
    // YES / NO, and a caller that asked this one instead would draw the list
    // without knowing a question was waiting on it.
    if (this.phase === PHASE_LEARN) {
      return this.learn.asking();
    }
    return this.phase === PHASE_ASK && this.page === this.pages.length - 1;
  }

  step(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): number {
    if (this.phase === PHASE_CLOSED) {
      return TEACH_CLOSED;
    }
    if (this.phase === PHASE_LEARN) {
      if (this.learn.step(pad, pressedA, pressedB, dt) === LEARN_CLOSED) {
        this.closeLearn();
      }
      return this.phase === PHASE_CLOSED ? TEACH_CLOSED : TEACH_NONE;
    }
    if (this.phase === PHASE_PARTY) {
      this.stepParty(pad, pressedA, pressedB, dt);
    } else {
      this.stepMessage(pad, pressedA, pressedB, dt);
    }
    return this.phase === PHASE_CLOSED ? TEACH_CLOSED : TEACH_NONE;
  }

  private partyRow(mon: BattleMon): string {
    const hp = right("" + mon.hp, 3) + "/" + right("" + mon.maxHp, 3);
    return fit(mon.name, TEACH_COLUMNS - 1 - hp.length) + hp;
  }

  private bodyOf(textId: string): string {
    const table = this.bundle.text ? this.bundle.text : null;
    return table && typeof table[textId] === "string" ? table[textId] : textId;
  }

  private say(textId: string, slots: string[][], then: (yes: boolean) => void): void {
    this.show(textId, slots, then, PHASE_SAY);
  }

  private ask(textId: string, slots: string[][], then: (yes: boolean) => void): void {
    this.show(textId, slots, then, PHASE_ASK);
  }

  private show(textId: string, slots: string[][], then: (yes: boolean) => void,
               phase: string): void {
    this.pages = this.paginate(fillSlots(this.bodyOf(textId), slots));
    this.page = 0;
    this.askCursor = 0;
    this.after = then;
    this.phase = phase;
  }

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
    if (then !== null) {
      then(yes);
    }
  }

  private toParty(): void {
    this.phase = PHASE_PARTY;
    this.cursor = 0;
    this.window = 0;
    this.pad.reset();
  }

  private stepParty(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): void {
    const count = this.state.party.length;
    if (count === 0) {
      this.phase = PHASE_CLOSED;
      return;
    }
    const moved = this.pad.step(pad, dt);
    if (moved === "up") {
      this.cursor = this.cursor > 0 ? this.cursor - 1 : count - 1;
    } else if (moved === "down") {
      this.cursor = this.cursor + 1 < count ? this.cursor + 1 : 0;
    }
    if (this.cursor < this.window) {
      this.window = this.cursor;
    } else if (this.cursor >= this.window + 6) {
      this.window = this.cursor - 6 + 1;
    }
    if (pressedB) {
      // ItemUseTMHM .chooseMon: backing out leaves the machine untouched.
      this.phase = PHASE_CLOSED;
      return;
    }
    if (!pressedA) {
      return;
    }
    this.chose(this.cursor);
  }

  private chose(index: number): void {
    const mon = this.state.party[index];
    const nameSlots: string[][] = [["wNameBuffer", mon.name], ["wStringBuffer", this.move]];
    if (!this.compatible(mon)) {
      this.say(TEXT_CANNOT_LEARN, nameSlots, () => { this.toParty(); });
      return;
    }
    if (knowsMove(mon, this.move)) {
      this.say(TEXT_ALREADY_KNOWS, nameSlots, () => { this.toParty(); });
      return;
    }
    const learned = learnMove(this.bundle, mon, this.move);
    if (learned.outcome === LEARN_LEARNED) {
      this.state.party[index] = learned.mon;
      this.say(TEXT_LEARNED,
               [["wLearnMoveMonName", mon.name], ["wStringBuffer", this.move]],
               () => { this.finish(); });
      return;
    }
    // Four moves already: the shared replace prompt owns the screen from here.
    this.target = index;
    this.learn = new MoveLearnController(this.bundle, mon, this.move);
    this.phase = PHASE_LEARN;
  }

  /**
   * The species' own TM/HM bitfield, decoded by the extractor into a list of
   * move ids. A bundle baked before it was carried teaches nothing rather than
   * teaching everything, and says why.
   */
  private compatible(mon: BattleMon): boolean {
    const species = this.bundle.species ? this.bundle.species[mon.species] : null;
    const list = species && species.tmhm ? species.tmhm : null;
    if (list === null) {
      print("[TeachController] this bundle has no tmhm lists; re-bake it");
      return false;
    }
    return list.indexOf(this.move) >= 0;
  }

  private closeLearn(): void {
    const slot = this.learn.decision();
    const index = this.target;
    this.learn = null;
    this.target = -1;
    if (slot === LEARN_ABANDONED || slot < 0) {
      // Nothing learned, nothing spent.
      this.phase = PHASE_CLOSED;
      return;
    }
    const result = replaceMove(this.bundle, this.state.party[index], slot, this.move);
    if (result.outcome === LEARN_LEARNED) {
      this.state.party[index] = result.mon;
    }
    // The prompt already showed the forgot-and-learned pages.
    this.finish();
  }

  private finish(): void {
    if (this.kind === "TM") {
      takeItem(this.state, this.itemId, 1);
      this.taken = true;
    }
    this.phase = PHASE_CLOSED;
  }
}
