// The Pokedex data page: what a starter ball (and any push_screen
// DexEntryMenu) shows before the question that follows it.
//
// Measured on the cartridge (tools/oracle, 6 sep): name at the top right,
// the category ("LIZARD POKeMON"), HT and WT, the dex number, the front
// picture, then a two-page description at the bottom. One A press turns the
// description from its first page to its second; one more closes the whole
// page. Built on the same GbCanvas/GbFont this project's other boot screens
// (TitleScreen, NamingScreen) use, not a 3D world panel.
//
// Left out on purpose: the cartridge shows HT/WT as "?'??"/"???.?lb"
// placeholders that fill in only once the species' cry finishes playing.
// That reveal has no operational meaning yet -- F4 (audio) is not built, so
// nothing actually plays the cry a lens frame could time against -- and
// nothing headless could verify a bare frame-count invented to match it. The
// real values are shown immediately instead; see FINDINGS.md.

import type { WorldBundle } from "../../world/WorldData";
import type { GbCanvas, GbFont, ShadeImage } from "./GbCanvas";
import { imageFromPacked, SCREEN_WIDTH, TILE } from "./GbCanvas";

/** Left column: the dex number and the front picture. */
const PIC_X: number = TILE;
const PIC_Y: number = TILE * 2;
/** Right column: HT then WT, level with the picture. */
const INFO_X: number = TILE * 8;
/** The description box: full width, three lines tall inside its border. */
const BOX_TX: number = 0;
const BOX_TY: number = 8;
const BOX_TW: number = 20;
const BOX_TH: number = 5;
const TEXT_INSET_X: number = TILE;

function pad3(dex: number): string {
  const value = dex > 0 ? dex : 0;
  if (value < 10) {
    return "00" + value;
  }
  if (value < 100) {
    return "0" + value;
  }
  return "" + value;
}

/** "2'00\"" as 2feet0inches -- the cartridge's own PRIME/DOUBLE PRIME glyphs. */
export function formatHeight(feet: number, inches: number): string {
  const wholeFeet = feet > 0 ? feet : 0;
  const wholeInches = inches > 0 ? inches : 0;
  const padded = wholeInches < 10 ? "0" + wholeInches : "" + wholeInches;
  return wholeFeet + "′" + padded + "″";
}

/** Tenths of a pound as "19.0lb". */
export function formatWeight(tenths: number): string {
  const value = tenths > 0 ? tenths : 0;
  const whole = Math.floor(value / 10);
  const frac = value % 10;
  return whole + "." + frac + "lb";
}

function splitLines(chunk: string): string[] {
  const out: string[] = [];
  const byNewline = chunk.split("\n");
  for (let i = 0; i < byNewline.length; i++) {
    // A `\v` (cont) scroll never appears inside a dex entry's own body --
    // checked across all 151 species -- but a stray one is a line break
    // here rather than a lost second half of the line.
    const byScroll = byNewline[i].split("");
    for (let j = 0; j < byScroll.length; j++) {
      out.push(byScroll[j]);
    }
  }
  return out;
}

/**
 * The description as the pages the cartridge shows: split on `\f` alone, NOT
 * on a two-line wrap. Measured against the golden extraction (tools/golden.sh)
 * for every one of the 151 species: always exactly two chunks of exactly
 * three lines each, which is why this is a page per chunk rather than
 * Dialogue.ts's paginate() (whose two-lines-then-scroll rule is for the
 * WORLD message box, a shorter box this screen does not use).
 */
export function splitDexPages(body: string): string[][] {
  if (!body) {
    return [];
  }
  const chunks = body.split("\f");
  const pages: string[][] = [];
  for (let i = 0; i < chunks.length; i++) {
    pages.push(splitLines(chunks[i]));
  }
  return pages;
}

export class DexEntryController {
  private dex: number;
  private name: string;
  private category: string;
  private heightFeet: number;
  private heightInches: number;
  private weightTenths: number;
  private front: ShadeImage;
  private pages: string[][];
  private page: number = 0;
  private done: boolean = false;
  /** Bumped by every visible change, so a view repaints only then. */
  private version: number = 0;

  constructor(bundle: WorldBundle, species: string) {
    const spec: any = bundle.species ? bundle.species[species] : null;
    this.dex = spec && typeof spec.dex === "number" ? spec.dex : 0;
    this.name = spec && spec.name ? spec.name : species;
    this.category = spec && typeof spec.category === "string" ? spec.category : "";
    this.heightFeet = spec && typeof spec.heightFeet === "number" ? spec.heightFeet : 0;
    this.heightInches = spec && typeof spec.heightInches === "number" ? spec.heightInches : 0;
    this.weightTenths = spec && typeof spec.weightTenths === "number" ? spec.weightTenths : 0;
    this.front = spec && spec.front ? imageFromPacked(spec.front) : null;
    const body = spec && spec.dexText && bundle.text ? bundle.text[spec.dexText] : null;
    this.pages = splitDexPages(body);
  }

  isOpen(): boolean {
    return !this.done;
  }

  stateVersion(): number {
    return this.version;
  }

  /**
   * A presses through it: one page to page, then closed. With no description
   * at all (an older bundle) a single press closes it, which is the same
   * "readers guard its absence" fallback every other bundle table gets.
   */
  step(pressedA: boolean): void {
    if (this.done || !pressedA) {
      return;
    }
    if (this.page + 1 < this.pages.length) {
      this.page++;
    } else {
      this.done = true;
    }
    this.version++;
  }

  paint(canvas: GbCanvas, font: GbFont): void {
    canvas.clear(0);
    font.text(canvas, "No." + pad3(this.dex), 0, 0);
    font.text(canvas, this.name, SCREEN_WIDTH - this.name.length * TILE, 0);
    if (this.category) {
      font.text(canvas, this.category + " POKéMON", 0, TILE);
    }
    if (this.front) {
      canvas.blit(this.front, PIC_X, PIC_Y, true);
    }
    font.text(canvas, "HT  " + formatHeight(this.heightFeet, this.heightInches), INFO_X, PIC_Y);
    font.text(canvas, "WT  " + formatWeight(this.weightTenths), INFO_X, PIC_Y + TILE * 2);
    font.box(canvas, BOX_TX, BOX_TY, BOX_TW, BOX_TH);
    const page = this.page < this.pages.length ? this.pages[this.page] : [];
    for (let i = 0; i < page.length; i++) {
      font.text(canvas, page[i], TEXT_INSET_X, (BOX_TY + 1 + i) * TILE);
    }
  }
}
