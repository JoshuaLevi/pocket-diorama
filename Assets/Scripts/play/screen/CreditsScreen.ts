// The roll of credits after the HALL OF FAME.
//
// The bundle has carried the cartridge's credits since the extraction was
// written -- fifteen POKeMON and thirty-five screens of names, each with the
// column its lines are printed at and whether it fades (field.credits) -- and
// nothing read them, so the game ended on OAK's last line and a black screen.
// This is the screen that reads them.
//
// What is taken from the cartridge: the order, the text and its columns, which
// screens fade, and which POKeMON comes before which screen. What is NOT: the
// timing. The credits routine's symbols are not in the manifest, so the frame
// counts below are chosen to match the length of Music_Credits rather than
// read out of bank $1C, and say so here rather than pretending.
//
// Pure, like every other controller in this folder: frames in, a canvas out.

import type { GbCanvas, GbFont, ShadeImage } from "./GbCanvas";
import { TILE, SCREEN_WIDTH, DMG_GREYS } from "./GbCanvas";

/** What step() reports. */
export const CREDITS_RUNNING: string = "";
export const CREDITS_DONE: string = "done";

/** A screen's phases. */
const PHASE_MON: number = 0;
const PHASE_TEXT: number = 1;
const PHASE_FADE: number = 2;
const PHASE_END: number = 3;

/** Frames, at the cartridge's 59.7 Hz. */
export const MON_SLIDE_FRAMES: number = 32;
export const MON_HOLD_FRAMES: number = 64;
export const TEXT_FRAMES: number = 96;
export const FADE_FRAMES: number = 12;
export const END_FRAMES: number = 240;

/** Where the POKeMON stands: seven tiles square, centred. */
export const MON_TX: number = 6;
export const MON_TY: number = 4;
/** The first text row, and the gap between rows: the cartridge prints at every second row. */
export const TEXT_ROW: number = 6;
export const TEXT_ROW_STEP: number = 2;

export interface CreditScreen {
  fade: boolean;
  lines: any[];
  mon?: string;
  copyright?: boolean;
}

export class CreditsController {
  private screens: CreditScreen[];
  private frontImage: (species: string) => ShadeImage;
  private copyrightArt: ShadeImage;

  private index: number = 0;
  private phase: number = PHASE_MON;
  private frame: number = 0;
  private version: number = 0;
  private finished: boolean = false;

  constructor(screens: CreditScreen[], frontImage: (species: string) => ShadeImage,
              copyrightArt: ShadeImage) {
    this.screens = screens ? screens : [];
    this.frontImage = frontImage;
    this.copyrightArt = copyrightArt;
    if (this.screens.length === 0) {
      this.finished = true;
    } else {
      this.phase = this.screens[0].mon ? PHASE_MON : PHASE_TEXT;
    }
  }

  // ------------------------------------------------------------- readers

  stateVersion(): number {
    return this.version;
  }

  screenIndex(): number {
    return this.index;
  }

  /** "mon", "text", "fade" or "end", for a test to follow along. */
  phaseName(): string {
    return this.phase === PHASE_MON ? "mon" : this.phase === PHASE_TEXT ? "text"
      : this.phase === PHASE_FADE ? "fade" : "end";
  }

  isDone(): boolean {
    return this.finished;
  }

  /**
   * The palette to upload with: the four greys, lifted towards white through
   * a fade. A fade on the cartridge is the BGP register stepping through
   * $E4, $90, $40, $00; this is the same idea on the upload side.
   */
  palette(): number[][] {
    if (this.phase !== PHASE_FADE) {
      return DMG_GREYS;
    }
    const t = FADE_FRAMES > 0 ? this.frame / FADE_FRAMES : 1;
    const out: number[][] = [];
    for (let i = 0; i < DMG_GREYS.length; i++) {
      const g = DMG_GREYS[i];
      out.push([
        Math.round(g[0] + (255 - g[0]) * t),
        Math.round(g[1] + (255 - g[1]) * t),
        Math.round(g[2] + (255 - g[2]) * t),
      ]);
    }
    return out;
  }

  // ---------------------------------------------------------------- step

  /**
   * `frames` is how many cartridge frames have passed. START ends the roll
   * early -- the cartridge does not allow that, and a tester who has seen it
   * five times does not need to see it a sixth.
   */
  step(frames: number, pressedStart: boolean): string {
    if (this.finished) {
      return CREDITS_DONE;
    }
    if (pressedStart) {
      this.finished = true;
      this.version++;
      return CREDITS_DONE;
    }
    const before = this.frame;
    this.frame = this.frame + (frames > 0 ? frames : 0);
    if (this.phase === PHASE_MON) {
      if (this.frame >= MON_SLIDE_FRAMES + MON_HOLD_FRAMES) {
        this.enter(PHASE_TEXT);
      } else if (Math.floor(this.frame) !== Math.floor(before) && this.frame < MON_SLIDE_FRAMES) {
        // Only the slide repaints per frame; the hold is still.
        this.version++;
      }
      return CREDITS_RUNNING;
    }
    if (this.phase === PHASE_TEXT) {
      if (this.frame >= TEXT_FRAMES) {
        if (this.screens[this.index].fade) {
          this.enter(PHASE_FADE);
        } else {
          this.advance();
        }
      }
      return CREDITS_RUNNING;
    }
    if (this.phase === PHASE_FADE) {
      if (this.frame >= FADE_FRAMES) {
        this.advance();
      } else if (Math.floor(this.frame) !== Math.floor(before)) {
        this.version++;
      }
      return CREDITS_RUNNING;
    }
    if (this.frame >= END_FRAMES) {
      this.finished = true;
      this.version++;
      return CREDITS_DONE;
    }
    return CREDITS_RUNNING;
  }

  private enter(phase: number): void {
    this.phase = phase;
    this.frame = 0;
    this.version++;
  }

  private advance(): void {
    if (this.screens[this.index].copyright) {
      this.enter(PHASE_END);
      return;
    }
    this.index++;
    if (this.index >= this.screens.length) {
      this.enter(PHASE_END);
      return;
    }
    this.enter(this.screens[this.index].mon ? PHASE_MON : PHASE_TEXT);
  }

  // ---------------------------------------------------------------- paint

  paint(canvas: GbCanvas, font: GbFont): void {
    if (!canvas) {
      return;
    }
    canvas.clear(0);
    if (this.finished) {
      return;
    }
    const screen = this.screens[this.index];
    if (this.phase === PHASE_MON) {
      const img = this.frontImage ? this.frontImage(screen.mon) : null;
      if (img) {
        // In from the right edge to its place, then held.
        const t = this.frame >= MON_SLIDE_FRAMES ? 1 : this.frame / MON_SLIDE_FRAMES;
        const from = SCREEN_WIDTH;
        const to = MON_TX * TILE;
        const x = Math.round(from + (to - from) * t);
        canvas.blit(img, x, MON_TY * TILE, true);
      }
      return;
    }
    if (this.phase === PHASE_END) {
      if (font) {
        font.text(canvas, "THE END", 6 * TILE + 4, 7 * TILE);
      }
      if (this.copyrightArt) {
        canvas.blit(this.copyrightArt, Math.round((SCREEN_WIDTH - this.copyrightArt.width) / 2),
                    11 * TILE, true);
      }
      return;
    }
    if (screen.copyright) {
      if (this.copyrightArt) {
        canvas.blit(this.copyrightArt, Math.round((SCREEN_WIDTH - this.copyrightArt.width) / 2),
                    8 * TILE, true);
      }
      return;
    }
    if (!font) {
      return;
    }
    for (let i = 0; i < screen.lines.length; i++) {
      const line = screen.lines[i];
      const column = typeof line.column === "number" ? line.column : 0;
      font.text(canvas, line.text ? line.text : "", column * TILE, (TEXT_ROW + i * TEXT_ROW_STEP) * TILE);
    }
  }

  /** How long the whole roll takes, in frames, for the test and the tuning. */
  static totalFrames(screens: CreditScreen[]): number {
    let frames = END_FRAMES;
    for (let i = 0; screens && i < screens.length; i++) {
      if (screens[i].mon) {
        frames += MON_SLIDE_FRAMES + MON_HOLD_FRAMES;
      }
      frames += TEXT_FRAMES + (screens[i].fade ? FADE_FRAMES : 0);
      if (screens[i].copyright) {
        break;
      }
    }
    return frames;
  }
}
