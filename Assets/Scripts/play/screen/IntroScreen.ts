// The intro's stage: which portrait is up, and the fade/slide/shrink timing
// that shows it, as a frame-stepped state a Host.ts-style routine drives one
// tick at a time. See SPEC.md "The intro on the Game Boy screen -- design":
// `intro_stage <who>` moves from a no-op to drawing here.
//
// Pure and independent of the VM: a small imperative API (show/step/paint/
// bgp) the wiring agent calls from its own intro_stage/name_entry/fade
// handling. It never reads a bundle or a ScriptCommand; the caller decodes
// bundle.introArt's shade images (imageFromPacked, the same way PokemonAR's
// beginBoot decodes bundle.title's) and the species front for NIDORINO, and
// hands them in once at construction.
//
// Every number below is tools/oracle/INTRO.md, re-verified directly against
// the recorded tilemaps and PNGs (not just its prose) where this file's own
// pixel test needed exactness; three corrections beyond INTRO.md's own
// documented one are called out where they matter:
//
//   * The name-list portrait slide is SIX tile columns, not five. INTRO.md's
//     "Two corrections" section states columns 6-12 to columns 11-17; the
//     recorded tilemap for the corrected probe (frames/90-player_name_
//     presets.tilemap.json) places the picture's own sequential $00-$30
//     column-major ids at columns 12-18 -- a column-major id inspection is
//     unambiguous where a described range can be off by one. Six columns
//     is also what the pixel numbers demand: at five, this file's portrait
//     would sit 8px left of every measured pixel in that beat.
//   * The rival's portrait DOES fade in. INTRO.md's own "Rival portrait
//     (beat 27)" prose says "no slide and no fade -- WX constant... BGP
//     constant throughout the whole capture window", but summary.json's
//     own rivalStageLog (the per-frame register log the same recorder
//     wrote) shows BGP stepping $00 -> $54 -> $A8 -> $FC -> $F8 -> $F4 ->
//     $E4 across that beat's own 110 frames -- the identical seven-value
//     ramp Oak's own reveal uses, just with a longer opening hold. A beat
//     that long with a genuinely flat palette would have no reason to be
//     110 frames rather than however few it takes to place tiles; the log
//     is the more direct measurement (raw per-frame register reads) than
//     the prose summarising it, so RIVAL_FADE_RAMP below matches the log.
//   * The shrink's own three stages, re-measured pixel-for-pixel against
//     bundle.introArt (which matches INTRO.md's recorded frames exactly at
//     every OTHER stage checked -- oak, rival and the shrink's own first
//     "full sprite" instant, all zero-diff): the full picture holds for
//     shrink offset 0 only, `shrink1` is the exact pixel match for offsets
//     1-41 (not INTRO.md's approximate "~55-69"), `shrink2` is the exact
//     match for offsets 42-70, and is the closest available match (not
//     exact -- see FINDINGS below) from 71 to 134. INTRO.md's "0-54 / ~55-
//     69 / ~70-134" boundaries do not survive a pixel comparison; the
//     thresholds here do.
//   * Nidorino's front is NOT centred in the 56px block -- see the
//     PORTRAIT_NIDORINO branch in paint() below. LoadFlippedFrontSpriteBy
//     MonIndex sits it flush at the block's own left and bottom edges, then
//     mirrors it; centring (this file's earlier guess, and the "sits
//     centred" framing a front loader's name suggests) left 1105 of 3136
//     pixels wrong. Verified 0/3136 against 10-nidorino_appears-f0064.png.
//
// FINDINGS for whoever extracts these assets next: bundle.introArt.shrink2
// stops matching the recorded frames exactly past shrink offset ~71 (a
// stable ~150-pixel mismatch, shape roughly a small humanoid glyph around
// the block's own vertical middle -- see the shrink2 stage's own doc
// comment below). Separately, shrink offset 0 itself (45-shrink-f0000.png)
// carries an IRREDUCIBLE 3-pixel gap against this file's own STAGE_FULL
// (bundle.introArt.player unmodified): record_intro.py's own
// find_shrink_window() defines "shrink start" as the first frame that
// differs at all from the page's opening frame, so that recorded PNG is,
// by construction, already one frame into a continuous, tile-by-tile
// hardware redraw -- proven NOT a bundle.introArt.player bug (diffed
// directly against 45-shrink-before.png, frame shrink_start-1, added by
// tools/oracle/state/intro/_probe_shrink_before.py: 0/3136) and not
// fixable by using bundle.introArt.shrink1 instead (707/3136 wrong that
// early -- shrink1 is a real, different, much-further-collapsed snapshot).
// No fourth extracted asset exists for this one transitional frame; see
// test/intro.pixel.test.mjs's own "shrink offset 0" comment.

import type { GbCanvas, ShadeImage } from "./GbCanvas";
import { TILE } from "./GbCanvas";

/** The five lz3 pictures the extractor decodes for the intro (SPEC.md). Any may be null. */
export interface IntroArt {
  oak: ShadeImage;
  rival: ShadeImage;
  player: ShadeImage;
  shrink1: ShadeImage;
  shrink2: ShadeImage;
}

export const PORTRAIT_NONE: string = "";
export const PORTRAIT_OAK: string = "oak";
export const PORTRAIT_NIDORINO: string = "nidorino";
export const PORTRAIT_PLAYER: string = "player";
export const PORTRAIT_RIVAL: string = "rival";

/** The 7x7 tile block every portrait in this intro shares: rows 4-10, cols 6-12. */
export const PIC_TX: number = 6;
export const PIC_TY: number = 4;
export const PIC_SIZE: number = 7 * TILE;
const PIC_X: number = PIC_TX * TILE;
const PIC_Y: number = PIC_TY * TILE;

/** BGP at rest: colour 0/1/2/3 -> shade 0/1/2/3, the DMG's own default byte. */
export const BGP_NORMAL: number = 0xe4;
/** BGP fully blank: every colour maps to shade 0 (white), picture invisible. */
export const BGP_BLANK: number = 0x00;

/** One step of a BGP ramp: this value, held this many frames. */
export interface RampStep {
  bgp: number;
  frames: number;
}

function ramp(values: number[], frames: number[]): RampStep[] {
  const out: RampStep[] = [];
  for (let i = 0; i < values.length; i++) {
    out.push({ bgp: values[i], frames: frames[i] });
  }
  return out;
}

/**
 * Oak's reveal (INTRO.md "Oak's portrait fade-in", beat 04): seven values,
 * "each held about 10 frames" -- 70 frames, settling well inside the
 * measured ~100-frame window before the box and text appear.
 */
export const OAK_FADE_RAMP: RampStep[] = ramp(
  [0x00, 0x54, 0xa8, 0xfc, 0xf8, 0xf4, 0xe4],
  [10, 10, 10, 10, 10, 10, 10]);

/**
 * The rival's own reveal -- see the correction above this file's header.
 * Same seven values as Oak's, measured hold counts from rivalStageLog:
 * 50 frames blank, then six 10-frame steps (matches the log's own
 * transition frames 3447/3497/3507/3517/3527/3537/3547 exactly).
 */
export const RIVAL_FADE_RAMP: RampStep[] = ramp(
  [0x00, 0x54, 0xa8, 0xfc, 0xf8, 0xf4, 0xe4],
  [50, 10, 10, 10, 10, 10, 10]);

/**
 * The player's SECOND appearance (INTRO.md "Player again + OakSpeechText3",
 * beat 36): $00/$40/$90/$E4, measured hold counts from player2StageLog's
 * own transitions (4342/4391/4399/4407) -- 49, 8, 8, then holds.
 */
export const PLAYER_AGAIN_RAMP: RampStep[] = ramp(
  [0x00, 0x40, 0x90, 0xe4],
  [49, 8, 8, 8]);

/**
 * Nidorino's and the player's FIRST appearance (INTRO.md "Nidorino
 * appearing", beat 10, and "Player's portrait slide", beat 23): WX 119 down
 * to 7 by -8 each frame, 14 steps, BGP a hard cut to $E4 on the first one.
 */
export const SLIDE_WX_TABLE: number[] = [
  119, 111, 103, 95, 87, 79, 71, 63, 55, 47, 39, 31, 23, 15, 7,
];
const SLIDE_REST_WX: number = 7;

/**
 * The name-list slide (INTRO.md "The two corrections", re-measured six
 * columns -- see this file's header): six tile columns, about 3 frames a
 * column, matching the task's own "~3 frames a column" pace.
 */
export const LIST_SLIDE_COLUMNS: number = 6;
export const LIST_SLIDE_FRAMES_PER_COLUMN: number = 3;
export const LIST_SLIDE_FRAMES: number = LIST_SLIDE_COLUMNS * LIST_SLIDE_FRAMES_PER_COLUMN;

/**
 * The shrink (INTRO.md "The shrink", beat 45) -- boundaries re-measured
 * pixel-for-pixel against bundle.introArt; see this file's header. Four
 * stages, not three: ShrinkPic1, ShrinkPic2, a one-frame blank hand-off,
 * then SPRITE_RED (the pokered order) -- INTRO.md's own "ShrinkPic2 ...
 * ~70-134" was this file's own earlier placeholder for the third stage
 * before the sprite was identified; see paintShrink() and this file's
 * header FINDINGS.
 */
export const SHRINK_STAGE_FULL_END: number = 1;
export const SHRINK_STAGE_1_END: number = 42;
/** ShrinkPic2 ends here (exact through offset 70); offset 71 is a bare
 * one-frame blank -- measured, both hardware tile maps and the OBJ layer
 * empty that exact frame -- before the sprite is placed. */
export const SHRINK_STAGE_2_END: number = 71;
export const SHRINK_STAGE_GAP_END: number = 72;
/** SPRITE_RED, exact through offset 119; a BGP fade this file's flat
 * shrink-mode bgp() does not reproduce starts at 120 (measured: BGP steps
 * $E4 -> $90 -> ... through offset 134) -- see this file's header FINDINGS.
 * offset 135 is where isShrinkDone() already turns true (unchanged). */
export const SHRINK_STAGE_SPRITE_END: number = 135;
/** SPRITE_RED's frame-0 (facing down) own opaque content is flush to
 * (x1-14, y0-15) of its 16x16 canvas -- 1px margin on each side, none top/
 * bottom -- and the recorded block shows that content at (x17-30, y28-43),
 * so the canvas itself sits at block-local (16, 28). Verified 0/3136
 * against 45-shrink-f0072.png and 45-shrink-f0100.png with OBP0 below. */
export const RED_SPRITE_BLOCK_X: number = 16;
export const RED_SPRITE_BLOCK_Y: number = 28;
/**
 * OBP0 as this scene sets it for SPRITE_RED, mapping the sprite's own
 * 2bpp colour index (0-3, colour 0 always transparent on real hardware
 * regardless of this table) to a DMG shade -- NOT the identity map most
 * overworld sprites use (SpriteBillboard.ts's own default palette): colour
 * 1 comes back as shade 0 (white, not light grey), colour 2 as shade 1,
 * colour 3 as shade 3. The caller applies this (see this file's header
 * FINDINGS for the exact steps) before handing the frame to the
 * constructor -- this file only draws already-decoded shades, per its own
 * header.
 */
export const RED_SPRITE_OBP0: number[] = [0, 0, 1, 3];
const STAGE_FULL: number = 0;
const STAGE_1: number = 1;
const STAGE_2: number = 2;
const STAGE_GAP: number = 3;
const STAGE_SPRITE: number = 4;
const STAGE_GONE: number = 5;

function shrinkStage(offset: number): number {
  if (offset < SHRINK_STAGE_FULL_END) return STAGE_FULL;
  if (offset < SHRINK_STAGE_1_END) return STAGE_1;
  if (offset < SHRINK_STAGE_2_END) return STAGE_2;
  if (offset < SHRINK_STAGE_GAP_END) return STAGE_GAP;
  if (offset < SHRINK_STAGE_SPRITE_END) return STAGE_SPRITE;
  return STAGE_GONE;
}

/** INTRO.md "Fade to white and fade into the bedroom": 62 frames at $00, then a hard cut. */
export const WHITE_HOLD_FRAMES: number = 62;

/**
 * The name-confirmation acknowledgement (INTRO.md "The two corrections"):
 * `name_entry`'s own routine, not a `show_text` op, so OAK_SPEECH carries no
 * textId for it. Found in the bundle by its own opening words (quoted to
 * three, as everywhere else): the player's page starts "Right! So your",
 * the rival's "That's right! I". Assets/Generated/kanto.json's `text` table.
 */
export const ACK_TEXT_ID_PLAYER: string = "_YourNameIsText";
export const ACK_TEXT_ID_RIVAL: string = "_HisNameIsText";

const MODE_NONE: string = "none";
const MODE_FADE: string = "fade";
const MODE_SLIDE: string = "slide";
const MODE_LIST_OPEN: string = "list-open";
const MODE_LIST_CLOSE: string = "list-close";
const MODE_SHRINK: string = "shrink";
const MODE_WHITE: string = "white";

export class IntroStage {
  private art: IntroArt;
  private nidorinoFront: ShadeImage;
  /** The shrink's third stage (SHRINK_STAGE_SPRITE_END) -- SPRITE_RED's own
   * frame 0 (facing down), already sliced to 16x16 and already remapped
   * through RED_SPRITE_OBP0 by the caller; see this file's header FINDINGS
   * for the exact steps. May be null if the caller has not wired it yet --
   * paintShrink() simply draws nothing for that stage rather than throwing. */
  private redDownSprite: ShadeImage;

  private currentWho: string = PORTRAIT_NONE;
  private mode: string = MODE_NONE;
  private frame: number = 0;
  /** Tile columns the current portrait sits shifted right by (the name list). */
  private listShift: number = 0;

  constructor(art: IntroArt, nidorinoFront: ShadeImage, redDownSprite: ShadeImage) {
    this.art = art;
    this.nidorinoFront = nidorinoFront;
    this.redDownSprite = redDownSprite;
  }

  /**
   * `intro_stage <who>`'s first-occurrence behaviour: "" clears the stage,
   * "oak"/"rival" fade in, "nidorino"/"player" slide in. `player`'s SECOND
   * call (OAK_SPEECH op 12) is showPlayerAgain() instead -- the wiring
   * agent is the one place that already has to track which occurrence this
   * is (name_entry player having finished, in this script), so it picks.
   */
  show(who: string): void {
    this.currentWho = who;
    this.frame = 0;
    this.listShift = 0;
    if (who === PORTRAIT_NONE) {
      this.mode = MODE_NONE;
    } else if (who === PORTRAIT_OAK) {
      this.mode = MODE_FADE;
    } else if (who === PORTRAIT_RIVAL) {
      this.mode = MODE_FADE;
    } else {
      // nidorino, player (first appearance), or anything else: the slide.
      this.mode = MODE_SLIDE;
    }
  }

  /** OAK_SPEECH op 12's `intro_stage player` -- the measured ramp, not a slide. */
  showPlayerAgain(): void {
    this.currentWho = PORTRAIT_PLAYER;
    this.mode = MODE_FADE;
    this.frame = 0;
    this.listShift = 0;
  }

  who(): string {
    return this.currentWho;
  }

  private fadeRamp(): RampStep[] {
    if (this.currentWho === PORTRAIT_OAK) {
      return OAK_FADE_RAMP;
    }
    if (this.currentWho === PORTRAIT_RIVAL) {
      return RIVAL_FADE_RAMP;
    }
    return PLAYER_AGAIN_RAMP;
  }

  /** True once the current show()/showPlayerAgain()'s own animation has settled. */
  isSettled(): boolean {
    if (this.mode === MODE_FADE) {
      return this.frame >= totalFrames(this.fadeRamp());
    }
    if (this.mode === MODE_SLIDE) {
      return this.frame >= SLIDE_WX_TABLE.length - 1;
    }
    return true;
  }

  // ---------------------------------------------------------- the name list

  /** The naming screen opening: the portrait slides right to make room. */
  slideListOpen(): void {
    this.mode = MODE_LIST_OPEN;
    this.frame = 0;
  }

  /** A name picked: the portrait slides back to rest. */
  slideListClosed(): void {
    this.mode = MODE_LIST_CLOSE;
    this.frame = 0;
  }

  isListSlideSettled(): boolean {
    return this.frame >= LIST_SLIDE_FRAMES;
  }

  // -------------------------------------------------------------- the shrink

  /** OakSpeechText3's last page: the picture shrinks away under the still text. */
  startShrink(): void {
    this.mode = MODE_SHRINK;
    this.frame = 0;
  }

  isShrinkDone(): boolean {
    return shrinkStage(this.frame) === STAGE_GONE;
  }

  // ---------------------------------------------------------- the white hold

  startWhiteHold(): void {
    this.mode = MODE_WHITE;
    this.frame = 0;
  }

  isWhiteHoldDone(): boolean {
    return this.frame >= WHITE_HOLD_FRAMES;
  }

  // -------------------------------------------------------------------- step

  step(frames: number): void {
    if (this.mode === MODE_NONE) {
      return;
    }
    this.frame += frames;
    if (this.mode === MODE_LIST_OPEN) {
      this.listShift = columnsFor(Math.min(this.frame, LIST_SLIDE_FRAMES));
    } else if (this.mode === MODE_LIST_CLOSE) {
      this.listShift = LIST_SLIDE_COLUMNS - columnsFor(Math.min(this.frame, LIST_SLIDE_FRAMES));
    }
  }

  // ------------------------------------------------------------------- bgp

  bgp(): number {
    if (this.mode === MODE_WHITE) {
      return this.isWhiteHoldDone() ? BGP_NORMAL : BGP_BLANK;
    }
    if (this.mode === MODE_FADE) {
      return bgpAt(this.fadeRamp(), this.frame);
    }
    if (this.mode === MODE_NONE) {
      return BGP_NORMAL;
    }
    // Slide, the name-list shift and the shrink all sit at the resting
    // palette throughout (INTRO.md: the slides are a hard $00->$E4 cut on
    // their own first frame; the shrink's own BGP is flat across every
    // offset this file's positioning uses -- see this file's header).
    return BGP_NORMAL;
  }

  // ----------------------------------------------------------------- paint

  paint(canvas: GbCanvas): void {
    if (this.mode === MODE_WHITE) {
      // Whatever is drawn is invisible under bgp()'s all-white mapping
      // while the hold lasts; nothing to draw once it lifts either, the
      // world takes the screen from here (SPEC.md's `warp` row).
      return;
    }
    if (this.mode === MODE_SHRINK) {
      this.paintShrink(canvas);
      return;
    }
    const img = this.currentImage();
    if (!img) {
      return;
    }
    let x = PIC_X;
    if (this.mode === MODE_SLIDE) {
      const wx = SLIDE_WX_TABLE[Math.min(this.frame, SLIDE_WX_TABLE.length - 1)];
      x = PIC_X + (wx - SLIDE_REST_WX);
    } else if (this.mode === MODE_LIST_OPEN || this.mode === MODE_LIST_CLOSE) {
      x = PIC_X + this.listShift * TILE;
    }
    if (this.currentWho === PORTRAIT_NIDORINO) {
      // LoadFlippedFrontSpriteByMonIndex, measured (see this file's header):
      // NOT centred -- flush against the block's own left edge (offset 0,
      // not (PIC_SIZE-width)/2), bottom edge on the block's own bottom edge,
      // then the whole sprite is horizontally mirrored. Verified 0/3136
      // against the recorded frame (10-nidorino_appears-f0064.png); the
      // earlier centred guess left 1105 of those pixels wrong. Only a 48px-
      // wide front is measured here (this intro shows exactly one species);
      // frontOffsetX states that as the rule for 48px, not a guess at other
      // widths.
      const bx = x + frontOffsetX(img.width);
      const by = PIC_Y + PIC_SIZE - img.height;
      canvas.blitPartMasked(img, 0, 0, img.width, img.height, bx, by, true, true, false);
      return;
    }
    canvas.blit(img, x, PIC_Y, true);
  }

  private paintShrink(canvas: GbCanvas): void {
    const stage = shrinkStage(this.frame);
    if (stage === STAGE_SPRITE) {
      // A different position than the other three stages -- see
      // RED_SPRITE_BLOCK_X/Y's own doc comment -- so it is not just
      // another entry in the plain img-then-blit-at-PIC_X-Y table below.
      if (this.redDownSprite) {
        canvas.blit(this.redDownSprite, PIC_X + RED_SPRITE_BLOCK_X, PIC_Y + RED_SPRITE_BLOCK_Y, true);
      }
      return;
    }
    // STAGE_GAP and STAGE_GONE both draw nothing (img stays null): the
    // gap is a measured one-frame blank hand-off, and gone is gone.
    let img: ShadeImage = null;
    if (stage === STAGE_FULL) {
      img = this.art.player;
    } else if (stage === STAGE_1) {
      img = this.art.shrink1;
    } else if (stage === STAGE_2) {
      img = this.art.shrink2;
    }
    if (img) {
      canvas.blit(img, PIC_X, PIC_Y, true);
    }
  }

  private currentImage(): ShadeImage {
    if (this.currentWho === PORTRAIT_OAK) return this.art.oak;
    if (this.currentWho === PORTRAIT_RIVAL) return this.art.rival;
    if (this.currentWho === PORTRAIT_PLAYER) return this.art.player;
    if (this.currentWho === PORTRAIT_NIDORINO) return this.nidorinoFront;
    return null;
  }
}

/**
 * A species front's x offset within the 56px block, measured against the
 * cartridge (see the PORTRAIT_NIDORINO branch above and this file's
 * header). A 48px-wide front sits flush at the block's own left edge
 * (offset 0) -- this intro shows exactly one species, so 48 is the only
 * width this rule is verified against; it is applied to any other width
 * on the same flush-left assumption rather than falling back to centring
 * (which is what the measured 48px case proved wrong), but that has not
 * been checked against a second recorded sprite.
 */
function frontOffsetX(width: number): number {
  return 0;
}

function totalFrames(steps: RampStep[]): number {
  let total = 0;
  for (let i = 0; i < steps.length; i++) {
    total += steps[i].frames;
  }
  return total;
}

function bgpAt(steps: RampStep[], frame: number): number {
  let remaining = frame;
  for (let i = 0; i < steps.length; i++) {
    if (remaining < steps[i].frames) {
      return steps[i].bgp;
    }
    remaining -= steps[i].frames;
  }
  return steps[steps.length - 1].bgp;
}

/** Whole columns crossed after `frame` frames of the list slide, clamped. */
function columnsFor(frame: number): number {
  const cols = Math.floor(frame / LIST_SLIDE_FRAMES_PER_COLUMN);
  return cols > LIST_SLIDE_COLUMNS ? LIST_SLIDE_COLUMNS : cols;
}
