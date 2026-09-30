// "What? CHARMANDER is evolving!" -- the sequence after a battle.
//
// Pure, like ShopController, TeachController and MoveLearnController, so the
// whole exchange -- read the page, let it happen or press B to stop it, read
// what it became -- is playable in a headless test. It never touches the
// Pokemon: `decision()` says what the player chose and Evolution.evolve() is
// what the owner applies.
//
// The flow is core/evolve_mon.asm and engine/evolution.asm:
//   _IsEvolvingText, and the animation
//     B during it -> _StoppedEvolvingText, nothing happens, and the cartridge
//                    will ask again after the NEXT battle
//     otherwise   -> the species changes, then
//                    _EvolvedText + _IntoText, one message
//                    then the new species' moves for this level, which is
//                    someone else's prompt (see Evolution.movesOnEvolution)
//
// There is no animation here, so the cancel window is the "is evolving!" page
// itself: B on it stops the evolution, A lets it through. That is the only
// honest place to put it -- a window measured in frames nobody can see would be
// a cancel the player cannot reach.

import type { DPadState } from "./InputSource";
import type { WorldBundle } from "../world/WorldData";
import { fillSlots } from "./script/Dialogue";

/** Nothing to report this frame. */
export const EVOLVE_NONE: number = 0;
/** Finished; read `evolved()` for which way it went. */
export const EVOLVE_CLOSED: number = 1;

export const TEXT_IS_EVOLVING: string = "_IsEvolvingText";
export const TEXT_EVOLVED: string = "_EvolvedText";
export const TEXT_INTO: string = "_IntoText";
export const TEXT_STOPPED: string = "_StoppedEvolvingText";

const PHASE_ASK: string = "ask";
const PHASE_SAY: string = "say";
const PHASE_CLOSED: string = "closed";

export class EvolutionController {
  private readonly bundle: WorldBundle;
  /** The name as it was BEFORE evolving: what every line here talks about. */
  private readonly wasCalled: string;
  private readonly to: string;

  private phase: string = PHASE_ASK;
  private pages: string[][] = [];
  private page: number = 0;
  private didEvolve: boolean = false;

  constructor(bundle: WorldBundle, name: string, to: string) {
    this.bundle = bundle;
    this.wasCalled = name;
    this.to = to;
    this.show([TEXT_IS_EVOLVING], [["wStringBuffer", name]]);
  }

  isOpen(): boolean {
    return this.phase !== PHASE_CLOSED;
  }

  /** True once the evolution has actually been allowed to happen. */
  evolved(): boolean {
    return this.didEvolve;
  }

  /** The species being evolved into. */
  into(): string {
    return this.to;
  }

  /** The page on screen. Never null: this controller has no list. */
  lines(): string[] {
    return this.page < this.pages.length ? this.pages[this.page] : [""];
  }

  /** No rows: nothing here is a menu. Present so the caller can paint uniformly. */
  rows(): string[] {
    return [];
  }

  cursorRow(): number {
    return -1;
  }

  step(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): number {
    if (this.phase === PHASE_CLOSED) {
      return EVOLVE_CLOSED;
    }
    if (!pressedA && !pressedB) {
      return EVOLVE_NONE;
    }
    if (this.page < this.pages.length - 1) {
      this.page++;
      return EVOLVE_NONE;
    }
    if (this.phase === PHASE_ASK) {
      if (pressedB) {
        // Stopped. The cartridge asks again after the next battle, so nothing
        // here remembers the refusal.
        this.didEvolve = false;
        this.show([TEXT_STOPPED], [["wStringBuffer", this.wasCalled]]);
        this.phase = PHASE_SAY;
        return EVOLVE_NONE;
      }
      this.didEvolve = true;
      // One message, as the cartridge builds it: "X evolved" then "into Y!".
      this.show([TEXT_EVOLVED, TEXT_INTO],
                [["wStringBuffer", this.wasCalled], ["wNameBuffer", this.to]]);
      this.phase = PHASE_SAY;
      return EVOLVE_NONE;
    }
    this.phase = PHASE_CLOSED;
    return EVOLVE_CLOSED;
  }

  private bodyOf(textId: string): string {
    const table = this.bundle.text ? this.bundle.text : null;
    return table && typeof table[textId] === "string" ? table[textId] : textId;
  }

  private show(textIds: string[], slots: string[][]): void {
    let body = "";
    for (let i = 0; i < textIds.length; i++) {
      body = body + this.bodyOf(textIds[i]);
    }
    this.pages = this.paginate(fillSlots(body, slots));
    this.page = 0;
  }

  /**
   * Pages of at most two lines, on the cartridge's control characters: \f
   * starts a page, \v scrolls, \n breaks a line. The same rule the other
   * controllers apply, and duplicated for the same reason they duplicate it.
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
}
