// The SILPH SCOPE's own fade: the ghost plate running over into the species.
//
// The cartridge does not swap the picture. `ghost_marowak_anim.asm` washes the
// ghost out through the four values a DMG palette register can hold, puts
// MAROWAK's picture up behind the white, and washes it back in -- which is why
// the reveal reads as the scope seeing THROUGH something rather than as a
// slide changing. The lens swapped the texture in one frame and the moment
// went past unnoticed; that is the last of the four gaps the 20 September
// audit left (`docs/PLAN-FULL-GAME.md`).
//
// Pure, and quantised to four steps on purpose: a battle picture is a
// procedural texture, so a wash that moved every frame would build sixty
// textures a second. Four is what the hardware had.

/** GhostPic, as BattleRunner.picturesOnField names it. Kept here to avoid a cycle. */
import { GHOST_PICTURE } from "./Ghost";

/** How long the ghost takes to wash out, and the species to wash back in. */
export const UNVEIL_OUT_SECONDS: number = 0.45;
export const UNVEIL_IN_SECONDS: number = 0.45;

/** The steps the wash is quantised to: the four values of a DMG palette. */
export const UNVEIL_STEPS: number = 4;

/** Nothing is happening; the picture asked for is the picture drawn. */
export const UNVEIL_IDLE: number = 0;
/** The ghost is on screen and going white. */
export const UNVEIL_OUT: number = 1;
/** The species is on screen and coming back out of the white. */
export const UNVEIL_IN: number = 2;

/**
 * Which picture to draw and how far it is washed toward white.
 *
 * Fed the picture the runner wants every frame; answers the one to draw. Only
 * the ghost-to-species change fades -- a switch, a faint or a new foe is a
 * cut, exactly as it is on the cartridge.
 */
export class Unveil {
  private shown: string = "";
  private phase: number = UNVEIL_IDLE;
  private elapsed: number = 0;

  /** `wanted` is BattleRunner.picturesOnField()[1]; dt is real seconds. */
  step(dt: number, wanted: string): void {
    const want = wanted ? wanted : "";
    if (this.phase === UNVEIL_IDLE) {
      if (this.shown === GHOST_PICTURE && want !== GHOST_PICTURE && want !== "") {
        this.phase = UNVEIL_OUT;
        this.elapsed = 0;
        return;
      }
      this.shown = want;
      return;
    }
    this.elapsed += dt > 0 ? dt : 0;
    if (this.phase === UNVEIL_OUT) {
      if (this.elapsed < UNVEIL_OUT_SECONDS) {
        return;
      }
      // The swap happens behind the white, which is the whole trick.
      this.shown = want;
      this.phase = UNVEIL_IN;
      this.elapsed = 0;
      return;
    }
    if (this.elapsed >= UNVEIL_IN_SECONDS) {
      this.phase = UNVEIL_IDLE;
      this.elapsed = 0;
      this.shown = want;
    }
  }

  /** What the actors should draw this frame. */
  picture(): string {
    return this.shown;
  }

  /** How far that picture is washed toward white, 0..1 in UNVEIL_STEPS steps. */
  wash(): number {
    if (this.phase === UNVEIL_IDLE) {
      return 0;
    }
    const span = this.phase === UNVEIL_OUT ? UNVEIL_OUT_SECONDS : UNVEIL_IN_SECONDS;
    let t = span > 0 ? this.elapsed / span : 1;
    if (t < 0) {
      t = 0;
    }
    if (t > 1) {
      t = 1;
    }
    const away = this.phase === UNVEIL_OUT ? t : 1 - t;
    return Math.round(away * UNVEIL_STEPS) / UNVEIL_STEPS;
  }

  /** True while the fade owns the picture; the runner's text waits for it. */
  running(): boolean {
    return this.phase !== UNVEIL_IDLE;
  }
}

/**
 * A palette washed toward white.
 *
 * `colours` is a palette as `bundle.palettes` holds them: four RGB triples,
 * lightest first. At wash 1 every one of them is white, which is the blank
 * frame the swap hides in.
 */
export function washedPalette(colours: number[][], wash: number): number[][] {
  const w = wash < 0 ? 0 : wash > 1 ? 1 : wash;
  const out: number[][] = [];
  for (let i = 0; i < colours.length; i++) {
    const c = colours[i];
    out.push([
      Math.round(c[0] + (255 - c[0]) * w),
      Math.round(c[1] + (255 - c[1]) * w),
      Math.round(c[2] + (255 - c[2]) * w),
    ]);
  }
  return out;
}
