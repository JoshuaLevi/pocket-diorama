// The title screen and the main menu, as engine/movie/title.asm and
// engine/menus/main_menu.asm have them, on a GbCanvas.
//
// Pure. The lens feeds the pad, paints what these ask for and reads the
// outcome: CONTINUE or NEW GAME, or back to the title. Timing is in frames at
// sixty a second, because every number in the cartridge is, and a dt-driven
// clock ticks them off so a slow preview frame does not skip the bounce.
//
// The hand-written tables here -- the title Pokemon, the drop steps, the
// scroll frames -- are pokered's own constants (data/pokemon/title_mons.asm,
// title.asm, title2.asm), kept as TypeScript like the field tables are: they
// are code in the reference too, and the manifest carries no symbol for them.

import { BLUE_ROM_SHA1 as BLUE_SHA1, cartridgeVersion } from "../../world/Cartridge";
import type { DPadState } from "../InputSource";
import { DPadEdge } from "../InputSource";
import type { GameOptions } from "../PlayState";
import {
  TEXT_SPEED_FAST, TEXT_SPEED_MEDIUM, TEXT_SPEED_SLOW,
  BATTLE_STYLE_SHIFT, BATTLE_STYLE_SET,
  PLAY_MODE_GAMEBOY, PLAY_MODE_DIORAMA, defaultOptions,
} from "../PlayState";
import type { GbCanvas, GbFont, ShadeImage } from "./GbCanvas";
import { CODE_CURSOR, CODE_CURSOR_HOLLOW, TILE, DMG_GREYS } from "./GbCanvas";
import { ViewOptionsController, paintViewOptions } from "./ViewOptions";

/** The art the title draws, unpacked. Any of them may be null on an old bundle. */
export interface TitleArt {
  logo: ShadeImage;
  version: ShadeImage;
  player: ShadeImage;
  copyright: ShadeImage;
  gamefreakInc: ShadeImage;
  /**
   * Yellow's whole title as one picture, composed from its tilemaps by the
   * extractor (rom/datasets/field.ts emitYellowTitle). When it is here the
   * title paints it and nothing else: Yellow has no cycling Pokemon, no
   * ribbon and no trainer, only the logo, Pikachu and the copyright row.
   */
  screen?: ShadeImage;
}

export const TITLE_NONE: number = 0;
/** The player pressed START or A and the exit beat is over: open the menu. */
export const TITLE_TO_MENU: number = 1;

/** data/pokemon/title_mons.asm, Red. TitleScreenPickNewMon draws from these. */
export const TITLE_MONS_RED: string[] = [
  "CHARMANDER", "SQUIRTLE", "BULBASAUR", "WEEDLE", "NIDORAN_M", "SCYTHER",
  "PIKACHU", "CLEFAIRY", "RHYDON", "ABRA", "GASTLY", "DITTO",
  "PIDGEOTTO", "ONIX", "PONYTA", "MAGIKARP",
];
/** data/pokemon/title_mons.asm, Blue: the same routine draws from these instead. */
export const TITLE_MONS_BLUE: string[] = [
  "SQUIRTLE", "CHARMANDER", "BULBASAUR", "MANKEY", "HITMONLEE", "VULPIX",
  "CHANSEY", "AERODACTYL", "JOLTEON", "SNORLAX", "GLOOM", "POLIWAG",
  "DODUO", "PORYGON", "GENGAR", "RAICHU",
];
const STARTERS: string[] = ["CHARMANDER", "SQUIRTLE", "BULBASAUR"];

/** Kept for callers that learnt the constant here; it lives in world/Cartridge now. */
export const BLUE_ROM_SHA1: string = BLUE_SHA1;

/**
 * Which title_mons table a cartridge's title cycles through. Yellow's title
 * screen has no cycling Pokemon at all (Pikachu stands beside the trainer),
 * so it takes Red's list until its own title is drawn.
 */
export function titleMonsFor(romSha1: string): string[] {
  return cartridgeVersion(romSha1) === "blue" ? TITLE_MONS_BLUE : TITLE_MONS_RED;
}

/**
 * How the version ribbon is laid on the tilemap: [sourceX, width, screenX] runs.
 *
 * PrintGameVersionOnTitleScreen places a tile string at (7,8). Red's
 * Version_GFX is ten tiles, and its string is tiles 0-1 ("Red"), a space, then
 * tiles 5-9 ("Version"): two runs, at x 56 and 80. Blue's graphic is eight
 * tiles and its string is all eight in a row, so the ribbon is one run at 56.
 * The extractor reads eighty pixels for either, so the shape is told apart by
 * the last two tiles: blank for an eight-tile graphic, inked for Red's ten.
 */
export function ribbonFragments(img: ShadeImage): number[][] {
  const tiles = Math.floor(img.width / 8);
  const inked: boolean[] = [];
  for (let t = 0; t < tiles; t++) {
    let ink = false;
    for (let y = 0; y < img.height && !ink; y++) {
      for (let x = t * 8; x < t * 8 + 8; x++) {
        // Ink is a dark shade; the mask says opaque for the white gaps too.
        if (img.shades[y * img.width + x] !== 0) {
          ink = true;
          break;
        }
      }
    }
    inked.push(ink);
  }
  if (tiles >= 10 && !inked[8] && !inked[9]) {
    return [[0, 64, 56]];
  }
  return [[0, 16, 56], [40, 40, 80]];
}

/** .TitleScreenPokemonLogoYScrolls: [dy per frame, frames]. */
const DROP_STEPS: number[][] = [[-4, 16], [3, 4], [-3, 4], [2, 2], [-2, 2], [1, 2], [-1, 2]];
const SETTLE_FRAMES: number = 36;
/** The version ribbon slides in from 112 to 4, four pixels a frame. */
const RIBBON_FROM: number = 112;
const RIBBON_TO: number = 4;
const RIBBON_STEP: number = 4;
/** Frames a title Pokemon holds before scrolling out (title.asm ln 227). */
const HOLD_FRAMES: number = 200;
/** After START, the cry plays before the white-out; this stands in for it. */
const EXIT_FRAMES: number = 30;
const FRAME_SECONDS: number = 1 / 60;
/** A stalled preview frame ticks at most this many game frames. */
const MAX_FRAMES_PER_UPDATE: number = 4;

function scrollFrames(steps: number[][], start: number): number[] {
  const out: number[] = [];
  let offset = start;
  for (let i = 0; i < steps.length; i++) {
    for (let f = 0; f < steps[i][1]; f++) {
      out.push(offset);
      offset -= steps[i][0];
    }
  }
  return out;
}
/** title2.asm ln 13: the Pokemon slides out to the left, then the next slides in. */
const OUT_FRAMES: number[] = scrollFrames(
  [[1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [8, 3], [9, 3]], 0);
const IN_FRAMES: number[] = scrollFrames(
  [[10, 2], [9, 4], [8, 4], [6, 3], [5, 2], [3, 1], [1, 1]], 120);
/** title2.asm ln 85: Red's ball bounces when the outgoing Pokemon is a starter. */
const BALL_FRAMES: number[] = [97, 95, 94, 93, 92, 93, 94, 95, 97, 100];
const BALL_REST: number = 100;

const PHASE_DROP: string = "drop";
const PHASE_SETTLE: string = "settle";
const PHASE_RIBBON: string = "ribbon";
const PHASE_LOOP: string = "loop";
const PHASE_EXIT: string = "exit";

const CYCLE_HOLD: string = "hold";
const CYCLE_OUT: string = "out";
const CYCLE_BALL: string = "ball";
const CYCLE_IN: string = "in";

/** Copyright line: which 8x8 columns of copyright.png, in order (NineTile prefix). */
const COPYRIGHT_TILES: number[] = [0, 1, 2, 1, 3, 1, 4];

export class TitleController {
  private art: TitleArt;
  private frontFor: (species: string) => ShadeImage;
  private random: () => number;

  private phase: string = PHASE_DROP;
  private scy: number = 0x40;
  private dropStep: number = 0;
  private dropLeft: number = -1;
  private timer: number = 0;
  private ribbonOffset: number = -1;
  private cycle: string = CYCLE_HOLD;
  private cycleFrame: number = 0;
  private cycleIndex: number = 0;
  private monOffset: number = 0;
  private ballY: number = BALL_REST;
  private clock: number = 0;
  private frames: number = 0;

  constructor(art: TitleArt, frontFor: (species: string) => ShadeImage, random: () => number,
              mons?: string[]) {
    this.art = art;
    this.frontFor = frontFor;
    this.random = random;
    this.mons = mons && mons.length > 0 ? mons : TITLE_MONS_RED;
    this.ribbon = art.version ? ribbonFragments(art.version) : [];
  }

  /** The cartridge's title_mons table; Red's unless told otherwise. */
  private mons: string[];
  /** The ribbon's runs, [sourceX, width, screenX] each; see ribbonFragments. */
  private ribbon: number[][];

  /** The Pokemon on screen now: what the exit cry belongs to. */
  currentSpecies(): string {
    return this.mons[this.cycleIndex];
  }

  phaseName(): string {
    return this.phase;
  }

  /** Game frames ticked so far; a test reads the timeline in these. */
  frameCount(): number {
    return this.frames;
  }

  /**
   * Changes only when the picture would: during the 200-frame hold nothing
   * moves, and a view that repainted and re-uploaded every frame was spending
   * a texture upload a frame on a still image.
   */
  visualVersion(): number {
    return ((this.scy + 128) * 7 + this.ribbonOffset + 200) * 1000003 +
      (this.monOffset + 200) * 1009 + this.ballY * 31 + this.cycleIndex * 7 +
      (this.cycle === CYCLE_BALL ? 3 : 0) +
      (this.phase === PHASE_DROP || this.phase === PHASE_SETTLE ? 1 : 0) +
      (this.phase === PHASE_RIBBON ? 2 : 0);
  }

  /** Back to the drop, as leaving the menu with B does. */
  restart(): void {
    this.phase = PHASE_DROP;
    this.scy = 0x40;
    this.dropStep = 0;
    this.dropLeft = -1;
    this.timer = 0;
    this.ribbonOffset = -1;
    this.cycle = CYCLE_HOLD;
    this.cycleFrame = 0;
    this.cycleIndex = 0;
    this.monOffset = 0;
    this.ballY = BALL_REST;
  }

  step(pressedA: boolean, pressedStart: boolean, dt: number): number {
    this.clock += dt;
    let ticks = 0;
    while (this.clock >= FRAME_SECONDS && ticks < MAX_FRAMES_PER_UPDATE) {
      this.clock -= FRAME_SECONDS;
      ticks++;
      this.frames++;
      const out = this.tick(pressedA || pressedStart);
      // A press is one event, not one per tick.
      pressedA = false;
      pressedStart = false;
      if (out !== TITLE_NONE) {
        return out;
      }
    }
    if (this.clock > FRAME_SECONDS) {
      this.clock = FRAME_SECONDS;
    }
    return TITLE_NONE;
  }

  private tick(pressed: boolean): number {
    if (this.phase === PHASE_DROP) {
      if (this.dropStep >= DROP_STEPS.length) {
        this.phase = PHASE_SETTLE;
        this.timer = 0;
        return TITLE_NONE;
      }
      if (this.dropLeft < 0) {
        this.dropLeft = DROP_STEPS[this.dropStep][1];
      }
      this.scy += DROP_STEPS[this.dropStep][0];
      this.dropLeft--;
      if (this.dropLeft <= 0) {
        this.dropStep++;
        this.dropLeft = -1;
      }
      return TITLE_NONE;
    }
    if (this.phase === PHASE_SETTLE) {
      this.timer++;
      if (this.timer >= SETTLE_FRAMES) {
        this.phase = PHASE_RIBBON;
        this.ribbonOffset = RIBBON_FROM;
      }
      return TITLE_NONE;
    }
    if (this.phase === PHASE_RIBBON) {
      this.ribbonOffset -= RIBBON_STEP;
      if (this.ribbonOffset < RIBBON_TO) {
        this.ribbonOffset = 0;
        this.phase = PHASE_LOOP;
        this.timer = 0;
      }
      return TITLE_NONE;
    }
    if (this.phase === PHASE_EXIT) {
      this.timer++;
      return this.timer >= EXIT_FRAMES ? TITLE_TO_MENU : TITLE_NONE;
    }
    // The loop.
    this.timer++;
    this.updateCycle();
    if (pressed) {
      this.phase = PHASE_EXIT;
      this.timer = 0;
    }
    return TITLE_NONE;
  }

  private setCycle(next: string): void {
    this.cycle = next;
    this.cycleFrame = 0;
    this.timer = 0;
    if (next === CYCLE_IN) {
      this.pickNewMon();
      this.monOffset = IN_FRAMES[0];
    } else if (next === CYCLE_OUT) {
      this.monOffset = OUT_FRAMES[0];
    } else if (next === CYCLE_BALL) {
      this.ballY = BALL_FRAMES[0];
    } else {
      this.monOffset = 0;
    }
  }

  /** TitleScreenPickNewMon: random, never the one already showing. */
  private pickNewMon(): void {
    let pick = this.cycleIndex;
    let guard = 0;
    while (pick === this.cycleIndex && guard < 32) {
      pick = Math.floor(this.random() * this.mons.length) % this.mons.length;
      guard++;
    }
    if (pick === this.cycleIndex) {
      pick = (this.cycleIndex + 1) % this.mons.length;
    }
    this.cycleIndex = pick;
  }

  private updateCycle(): void {
    if (this.cycle === CYCLE_HOLD) {
      if (this.timer >= HOLD_FRAMES) {
        this.setCycle(CYCLE_OUT);
      }
      return;
    }
    const frames = this.cycle === CYCLE_OUT ? OUT_FRAMES
      : this.cycle === CYCLE_BALL ? BALL_FRAMES : IN_FRAMES;
    this.cycleFrame++;
    if (this.cycleFrame < frames.length) {
      if (this.cycle === CYCLE_BALL) {
        this.ballY = frames[this.cycleFrame];
      } else {
        this.monOffset = frames[this.cycleFrame];
      }
      return;
    }
    if (this.cycle === CYCLE_OUT) {
      this.setCycle(STARTERS.indexOf(this.currentSpecies()) >= 0 ? CYCLE_BALL : CYCLE_IN);
    } else if (this.cycle === CYCLE_BALL) {
      this.setCycle(CYCLE_IN);
    } else {
      this.setCycle(CYCLE_HOLD);
    }
  }

  // ------------------------------------------------------------------ paint

  /** TitleState:draw, minus the menu: the menu paints over this when open. */
  paint(canvas: GbCanvas): void {
    canvas.clear(0);
    const scrollY = -this.scy;
    const preRibbon = this.phase === PHASE_DROP || this.phase === PHASE_SETTLE;
    const art = this.art;
    if (art.screen) {
      // Yellow: the logo rows bounce in (hSCY scrolls the background while
      // only the logo and the copyright are in it), Pikachu and his bubble
      // are loaded once it has landed, and the copyright row sits in the
      // window and never moves.
      if (preRibbon) {
        canvas.blitPart(art.screen, 0, 0, art.screen.width, 64, 0, scrollY, false);
      } else {
        canvas.blit(art.screen, 0, 0, false);
      }
      canvas.blitPart(art.screen, 0, 136, art.screen.width, 8, 0, 136, false);
      return;
    }
    if (art.logo) {
      canvas.blit(art.logo, 16, 8 + scrollY, false);
    }
    if (art.version && !preRibbon) {
      // The tile string PrintGameVersionOnTitleScreen writes at (7,8): two runs
      // for Red, one for Blue -- see ribbonFragments.
      const rx = this.phase === PHASE_RIBBON ? this.ribbonOffset : 0;
      for (let i = 0; i < this.ribbon.length; i++) {
        const r = this.ribbon[i];
        canvas.blitPart(art.version, r[0], 0, r[1], 8, r[2] + rx, 64, true);
      }
    }
    if (this.cycle !== CYCLE_BALL) {
      const sprite = this.frontFor(this.currentSpecies());
      if (sprite) {
        const x = 40 + Math.floor((56 - sprite.width) / 2) + this.monOffset;
        const y = 136 - sprite.height;
        canvas.blit(sprite, x, y, true);
      }
    }
    if (art.player) {
      // The three parts around the ball's cell, then the ball where it is.
      const pw = art.player.width;
      const ph = art.player.height;
      canvas.blitPart(art.player, 0, 0, pw, 16, 82, 80, true);
      canvas.blitPart(art.player, 8, 16, pw - 8, 8, 90, 96, true);
      canvas.blitPart(art.player, 0, 24, pw, ph - 24, 82, 104, true);
      canvas.blitPart(art.player, 0, 16, 8, 8, 82, this.ballY, true);
    }
    const copyrightY = 136 + (preRibbon ? 0 : scrollY);
    if (art.copyright) {
      let x = 16;
      for (let i = 0; i < COPYRIGHT_TILES.length; i++) {
        canvas.blitPart(art.copyright, COPYRIGHT_TILES[i] * TILE, 0, TILE, TILE, x, copyrightY, false);
        x += TILE;
      }
      if (art.gamefreakInc) {
        canvas.blit(art.gamefreakInc, x, copyrightY, false);
      }
    }
  }

  /**
   * PalPacket_Titlescreen: the logo rows take LOGO2, the ribbon band LOGO1 with
   * LOGO2's white, the rest MEWMON. `palettes` is the bundle's SGB table.
   */
  static paletteForRow(palettes: any): (row: number) => number[][] {
    const pick = (name: string): number[][] => {
      const entry = palettes ? palettes[name] : null;
      return entry && entry.length === 4 ? entry : DMG_GREYS;
    };
    const logo2 = pick("LOGO2");
    const logo1raw = pick("LOGO1");
    const logo1 = [logo2[0], logo1raw[1], logo1raw[2], logo1raw[3]];
    const mewmon = pick("MEWMON");
    return (row: number): number[][] => {
      if (row <= 7) return logo2;
      if (row <= 9) return logo1;
      return mewmon;
    };
  }
}

// ------------------------------------------------------------------- the menu

export const BOOT_NONE: number = 0;
export const BOOT_CONTINUE: number = 1;
export const BOOT_NEW_GAME: number = 2;
/** B on the main menu: the title plays again. */
export const BOOT_TO_TITLE: number = 3;
/**
 * NEW WORLD was confirmed: the lens forgets the stored world. Nothing else in
 * the lens could reach the code page once a world was cached, so a second
 * cartridge, or a world re-baked after the site was fixed, had no way in.
 */
export const BOOT_NEW_WORLD: number = 4;

/** What the CONTINUE box shows about the save. */
export interface SaveSummary {
  playerName: string;
  badges: number;
  dexOwned: number;
  playTimeSeconds: number;
}

/**
 * The cartridge's three OPTION rows plus the lens's own fourth: PlayState's
 * `playMode`, which mode a new game starts in or an existing one switches
 * to. See SPEC.md "The onboarding page -- design".
 */
export interface BootOptions extends GameOptions {
  playMode: string;
}

/** InitOptions, with the fourth row defaulted to diorama until the onboarding page says otherwise. */
export function defaultBootOptions(): BootOptions {
  const base = defaultOptions();
  return {
    textSpeed: base.textSpeed,
    battleAnimations: base.battleAnimations,
    battleStyle: base.battleStyle,
    view: base.view,
    battleAsked: base.battleAsked,
    playMode: PLAY_MODE_DIORAMA,
  };
}

const SCREEN_MAIN: string = "main";
const SCREEN_CONTINUE: string = "continue";
const SCREEN_OPTIONS: string = "options";
/** NEW WORLD's question, and the page that follows a YES. */
const SCREEN_FORGET: string = "forget";
const SCREEN_FORGOTTEN: string = "forgotten";

const ITEM_CONTINUE: string = "CONTINUE";
const ITEM_NEW_GAME: string = "NEW GAME";
const ITEM_OPTION: string = "OPTION";
const ITEM_NEW_WORLD: string = "NEW WORLD";

/** TEXT SPEED, BATTLE ANIMATION, BATTLE STYLE, PLAY MODE, VIEW, then CANCEL. */
const OPTION_ROWS: number = 6;
const OPTION_VIEW: number = 4;
const OPTION_CANCEL: number = 5;
const SCREEN_VIEW: string = "view";

export class BootMenuController {
  private items: string[] = [];
  private cursor: number = 0;
  private screen: string = SCREEN_MAIN;
  private summary: SaveSummary;
  private opts: BootOptions;
  private optionRow: number = 0;
  /** The view page while it is open, null otherwise. */
  private view: ViewOptionsController = null;
  private pad: DPadEdge = new DPadEdge();
  private version: number = 0;
  /** NEW WORLD's question: 0 is NO, 1 is YES. It opens on NO every time. */
  private forgetRow: number = 0;

  /**
   * `canSwapWorld` is whether a world is stored on the glasses. Only then is
   * there something for NEW WORLD to forget, so only then is the item offered.
   */
  constructor(hasSave: boolean, summary: SaveSummary, options: BootOptions,
              canSwapWorld: boolean = false) {
    if (hasSave) {
      this.items.push(ITEM_CONTINUE);
    }
    this.items.push(ITEM_NEW_GAME);
    this.items.push(ITEM_OPTION);
    if (canSwapWorld) {
      this.items.push(ITEM_NEW_WORLD);
    }
    this.summary = summary;
    this.opts = {
      textSpeed: options.textSpeed,
      battleAnimations: options.battleAnimations,
      battleStyle: options.battleStyle,
      view: options.view,
      battleAsked: options.battleAsked,
      playMode: options.playMode,
    };
  }

  /** The options as edited here; CONTINUE's save overrides them, NEW GAME keeps them. */
  options(): BootOptions {
    return this.opts;
  }

  screenName(): string {
    return this.screen;
  }

  cursorRow(): number {
    if (this.screen === SCREEN_FORGET) {
      return this.forgetRow;
    }
    return this.screen === SCREEN_OPTIONS ? this.optionRow : this.cursor;
  }

  /**
   * The store would not let the world go. The closing page would be a lie
   * then, so the menu goes back to being a menu.
   */
  worldKept(): void {
    this.screen = SCREEN_MAIN;
    this.pad.reset();
    this.version++;
  }

  /** Bumped on every press that could change the picture. */
  stateVersion(): number {
    return this.version;
  }

  step(pad: DPadState, pressedA: boolean, pressedB: boolean, dt: number): number {
    const moved = this.pad.step(pad, dt);
    if (moved !== "" || pressedA || pressedB) {
      this.version++;
    }
    if (this.screen === SCREEN_MAIN) {
      return this.stepMain(moved, pressedA, pressedB);
    }
    if (this.screen === SCREEN_CONTINUE) {
      if (pressedA) return BOOT_CONTINUE;
      if (pressedB) this.screen = SCREEN_MAIN;
      return BOOT_NONE;
    }
    if (this.screen === SCREEN_VIEW) {
      this.stepView(moved, pressedA, pressedB);
      return BOOT_NONE;
    }
    if (this.screen === SCREEN_FORGET) {
      return this.stepForget(moved, pressedA, pressedB);
    }
    if (this.screen === SCREEN_FORGOTTEN) {
      // Nothing is left to choose: the world is gone and the next start asks
      // for a code. A press that started a game here would start it in a
      // world that will not be there tomorrow.
      return BOOT_NONE;
    }
    this.stepOptions(moved, pressedA, pressedB);
    return BOOT_NONE;
  }

  /** NO and YES under the question. B is NO. */
  private stepForget(moved: string, pressedA: boolean, pressedB: boolean): number {
    if (moved === "up" || moved === "down") {
      this.forgetRow = this.forgetRow === 0 ? 1 : 0;
    }
    if (pressedB || (pressedA && this.forgetRow === 0)) {
      this.screen = SCREEN_MAIN;
      this.pad.reset();
      return BOOT_NONE;
    }
    if (pressedA) {
      this.screen = SCREEN_FORGOTTEN;
      return BOOT_NEW_WORLD;
    }
    return BOOT_NONE;
  }

  private stepMain(moved: string, pressedA: boolean, pressedB: boolean): number {
    const count = this.items.length;
    if (moved === "up") {
      this.cursor = this.cursor > 0 ? this.cursor - 1 : count - 1;
    } else if (moved === "down") {
      this.cursor = this.cursor + 1 < count ? this.cursor + 1 : 0;
    }
    if (pressedB) {
      return BOOT_TO_TITLE;
    }
    if (!pressedA) {
      return BOOT_NONE;
    }
    const item = this.items[this.cursor];
    if (item === ITEM_CONTINUE) {
      this.screen = SCREEN_CONTINUE;
      return BOOT_NONE;
    }
    if (item === ITEM_NEW_GAME) {
      return BOOT_NEW_GAME;
    }
    if (item === ITEM_NEW_WORLD) {
      this.screen = SCREEN_FORGET;
      this.forgetRow = 0;
      this.pad.reset();
      return BOOT_NONE;
    }
    this.screen = SCREEN_OPTIONS;
    this.optionRow = 0;
    this.pad.reset();
    return BOOT_NONE;
  }

  private stepOptions(moved: string, pressedA: boolean, pressedB: boolean): void {
    if (moved === "up") {
      this.optionRow = this.optionRow > 0 ? this.optionRow - 1 : OPTION_ROWS - 1;
    } else if (moved === "down") {
      this.optionRow = this.optionRow + 1 < OPTION_ROWS ? this.optionRow + 1 : 0;
    } else if (moved === "left" || moved === "right") {
      this.turnOption(moved === "right" ? 1 : -1);
    }
    if (pressedA && this.optionRow === OPTION_VIEW) {
      this.view = new ViewOptionsController(this.opts.view);
      this.screen = SCREEN_VIEW;
      this.pad.reset();
      return;
    }
    if (pressedB || (pressedA && this.optionRow === OPTION_CANCEL)) {
      this.screen = SCREEN_MAIN;
      this.pad.reset();
    }
  }

  /** The view page, one level in from OPTION. */
  private stepView(moved: string, pressedA: boolean, pressedB: boolean): void {
    if (!this.view) {
      this.screen = SCREEN_OPTIONS;
      return;
    }
    const answer = this.view.step(moved, pressedA, pressedB);
    this.opts.view = this.view.values();
    if (answer === "close") {
      this.view = null;
      this.screen = SCREEN_OPTIONS;
      this.pad.reset();
    }
  }

  /** Left and right walk a row's values; text speed does not wrap past FAST. */
  private turnOption(direction: number): void {
    const o = this.opts;
    if (this.optionRow === 0) {
      const speeds = [TEXT_SPEED_FAST, TEXT_SPEED_MEDIUM, TEXT_SPEED_SLOW];
      let at = speeds.indexOf(o.textSpeed);
      at = at < 0 ? 1 : at + direction;
      at = at < 0 ? 0 : at >= speeds.length ? speeds.length - 1 : at;
      o.textSpeed = speeds[at];
    } else if (this.optionRow === 1) {
      o.battleAnimations = !o.battleAnimations;
    } else if (this.optionRow === 2) {
      o.battleStyle = o.battleStyle === BATTLE_STYLE_SET ? BATTLE_STYLE_SHIFT : BATTLE_STYLE_SET;
    } else if (this.optionRow === 3) {
      // PLAY MODE: the lens's own row, no cartridge equivalent. Two values,
      // so left and right both just flip it, like BATTLE STYLE above.
      o.playMode = o.playMode === PLAY_MODE_GAMEBOY ? PLAY_MODE_DIORAMA : PLAY_MODE_GAMEBOY;
    }
  }

  // ------------------------------------------------------------------ paint

  /** Over a white screen: the menu box, and the CONTINUE box or the options on top. */
  paint(canvas: GbCanvas, font: GbFont): void {
    canvas.clear(0);
    if (this.screen === SCREEN_VIEW && this.view) {
      paintViewOptions(canvas, font, this.view.values(), this.view.cursorRow(),
                       CODE_CURSOR, CODE_CURSOR_HOLLOW);
      return;
    }
    if (this.screen === SCREEN_OPTIONS) {
      this.paintOptions(canvas, font);
      return;
    }
    if (this.screen === SCREEN_FORGET) {
      font.box(canvas, 0, 0, 20, 6);
      font.text(canvas, "FORGET THIS WORLD?", 1 * TILE, 2 * TILE);
      font.text(canvas, "YOUR SAVE STAYS.", 1 * TILE, 4 * TILE);
      font.box(canvas, 0, 8, 7, 6);
      font.text(canvas, "NO", 2 * TILE, 10 * TILE);
      font.text(canvas, "YES", 2 * TILE, 12 * TILE);
      font.code(canvas, CODE_CURSOR, 1 * TILE, (10 + this.forgetRow * 2) * TILE);
      return;
    }
    if (this.screen === SCREEN_FORGOTTEN) {
      font.box(canvas, 0, 0, 20, 10);
      font.text(canvas, "WORLD FORGOTTEN.", 1 * TILE, 2 * TILE);
      font.text(canvas, "CLOSE THE LENS AND", 1 * TILE, 4 * TILE);
      font.text(canvas, "OPEN IT AGAIN FOR", 1 * TILE, 6 * TILE);
      font.text(canvas, "A NEW CODE.", 1 * TILE, 8 * TILE);
      return;
    }
    const height = this.items.length * 2 + 2;
    font.box(canvas, 0, 0, 13, height);
    for (let i = 0; i < this.items.length; i++) {
      font.text(canvas, this.items[i], 2 * TILE, (2 + i * 2) * TILE);
    }
    font.code(canvas, this.screen === SCREEN_CONTINUE ? CODE_CURSOR_HOLLOW : CODE_CURSOR,
              1 * TILE, (2 + this.cursor * 2) * TILE);
    if (this.screen === SCREEN_CONTINUE) {
      this.paintContinue(canvas, font);
    }
  }

  /** DisplayContinueGameInfo: PLAYER, BADGES, POKéDEX, TIME in a 16x10 box at (4,7). */
  private paintContinue(canvas: GbCanvas, font: GbFont): void {
    font.box(canvas, 4, 7, 16, 10);
    const s = this.summary;
    font.text(canvas, "PLAYER", 40, 72);
    font.text(canvas, s.playerName, 96, 72);
    font.text(canvas, "BADGES", 40, 88);
    font.text(canvas, BootMenuController.padLeft(s.badges, 2), 128, 88);
    font.text(canvas, "POKéDEX", 40, 104);
    font.text(canvas, BootMenuController.padLeft(s.dexOwned, 3), 120, 104);
    font.text(canvas, "TIME", 40, 120);
    const t = Math.floor(s.playTimeSeconds);
    const minutes = Math.floor(t / 60) % 60;
    font.text(canvas, BootMenuController.padLeft(Math.floor(t / 3600), 3) + ":" +
              (minutes < 10 ? "0" : "") + minutes, 104, 120);
  }

  /** The OPTION screen: four rows of values and CANCEL, the chosen value marked. */
  private paintOptions(canvas: GbCanvas, font: GbFont): void {
    font.box(canvas, 0, 0, 20, 18);
    const o = this.opts;
    const rows = [
      ["TEXT SPEED", ["FAST", "MEDIUM", "SLOW"],
       [TEXT_SPEED_FAST, TEXT_SPEED_MEDIUM, TEXT_SPEED_SLOW].indexOf(o.textSpeed)],
      ["BATTLE ANIMATION", ["ON", "OFF"], o.battleAnimations ? 0 : 1],
      ["BATTLE STYLE", ["SHIFT", "SET"], o.battleStyle === BATTLE_STYLE_SET ? 1 : 0],
      // The lens's one deliberate departure from the cartridge's OPTION
      // screen -- Gen 1 has no such row -- kept in its font and frame, drawn
      // and cycled exactly like the three rows above it. See SPEC.md "The
      // onboarding page -- design".
      ["PLAY MODE", ["GAME BOY", "DIORAMA"], o.playMode === PLAY_MODE_GAMEBOY ? 0 : 1],
    ];
    for (let r = 0; r < rows.length; r++) {
      const labelY = (1 + r * 3) * TILE;
      font.text(canvas, rows[r][0] as string, 1 * TILE, labelY);
      const values = rows[r][1] as string[];
      const chosen = rows[r][2] as number;
      let x = 1 * TILE;
      for (let v = 0; v < values.length; v++) {
        if (v === chosen) {
          font.code(canvas, this.optionRow === r ? CODE_CURSOR : CODE_CURSOR_HOLLOW, x, labelY + TILE);
        }
        font.text(canvas, values[v], x + TILE, labelY + TILE);
        x += (values[v].length + 2) * TILE;
      }
    }
    // The lens's second departure: a row that opens a page rather than
    // cycling a value, drawn as a label with the cursor beside it.
    font.text(canvas, "VIEW", 2 * TILE, 13 * TILE);
    if (this.optionRow === OPTION_VIEW) {
      font.code(canvas, CODE_CURSOR, 1 * TILE, 13 * TILE);
    }
    font.text(canvas, "CANCEL", 2 * TILE, 16 * TILE);
    if (this.optionRow === OPTION_CANCEL) {
      font.code(canvas, CODE_CURSOR, 1 * TILE, 16 * TILE);
    }
  }

  private static padLeft(value: number, width: number): string {
    let s = String(value);
    while (s.length < width) {
      s = " " + s;
    }
    return s;
  }
}
