// The two HUD blocks a battle draws: name, level, HP bar, and your own numbers.
//
// The lens drew NONE of this. The 7 September glasses recording is a fight with
// two sprites, a text box and nothing else -- no names, no levels, no HP -- so
// nothing on screen said a Pokemon battle was happening at all. The reference
// mod floats the cartridge's own HUD blocks as panels beside the arena, and
// SPEC.md has asked for "GB-panelen in de ruimte rond de arena" since the video
// review.
//
// EVERY NUMBER HERE WAS MEASURED, not remembered. tools/oracle/battlehud.py
// walks into a real wild battle on Route 1 and reads wTileMap, both decoded
// through the font charmap and raw, because the bar is drawn from tiles that
// are not in the font and decode as nothing. What it found, on 7 September:
//
//   the enemy's block          your own block
//   ty=0  name at tx=1         ty=7   name at tx=10
//   ty=1  level at tx=4        ty=8   level at tx=14
//   ty=2  bar row at tx=1      ty=9   bar row at tx=10
//   ty=3  frame row at tx=1    ty=10  HP numbers at tx=11
//                              ty=11  frame row at tx=9
//
// and the bar itself, watched over three turns of a real fight:
//
//   73 71 62 6B 6B 6B 6B 6B 6B 6C   full
//   73 71 62 6B 6B 6B 67 63 63 6C   after one hit
//   73 71 62 63 63 63 63 63 63 6C   empty
//
// so $63 is an empty cell, $6B a full one, and the seven codes between them are
// the partial fills -- eight pixels per cell, six cells, the cartridge's own 48.
//
// Pure: state in, tile codes out. The painter at the bottom is the only part
// that touches a canvas, exactly as ViewOptions is arranged.

import type { GbCanvas, GbFont, ShadeImage } from "./GbCanvas";
import { TILE, SHADE_GLASS, imageFromPacked,
         SHADE_HP_GREEN, SHADE_HP_YELLOW, SHADE_HP_RED } from "./GbCanvas";
import type { WorldBundle } from "../../world/WorldData";

/**
 * The battle HUD's own tiles: the HP bar, and the frame around each block.
 *
 * These are NOT the font, and assuming they were is what the 8 September
 * preview showed on screen: "CLLLLLL:" where an HP bar belongs and a row of
 * kana where the frame belongs. The codes wTileMap holds -- $62 through $7F --
 * are the same ones the text box's border uses, and during a battle the
 * cartridge loads DIFFERENT pixels into that range: fontBattleExtra across the
 * whole of it, then hud1, hud2 and hud3 on top of three short stretches.
 *
 * So the lookup has to be in that order too: the three overlays first, then the
 * sheet underneath them. Reading the base sheet first would draw the tile the
 * cartridge has just covered up.
 *
 * Tolerant of a bundle baked before these were carried: draws() answers false
 * and the caller falls back to the font, which is wrong but is what the lens
 * did all evening and is better than drawing nothing at all.
 */
export class BattleHudTiles {
  private images: ShadeImage[] = [];
  private bases: number[] = [];
  private counts: number[] = [];

  constructor(bundle: WorldBundle) {
    const hud: any = bundle && (bundle as any).field
      ? (bundle as any).field.battleHud : null;
    if (!hud) {
      return;
    }
    // Overlays first, base last: that is the order the cartridge loads them.
    const order = ["hud1", "hud2", "hud3", "fontBattleExtra"];
    for (let i = 0; i < order.length; i++) {
      const sheet = hud[order[i]];
      if (!sheet || typeof sheet.shades !== "string" || sheet.shades.length === 0) {
        continue;
      }
      const image = imageFromPacked({
        width: sheet.width, height: sheet.height, shades: sheet.shades, alpha: "",
      });
      if (!image) {
        continue;
      }
      this.images.push(image);
      this.bases.push(sheet.tileBase);
      this.counts.push((sheet.width / TILE) * (sheet.height / TILE));
    }
  }

  /** Whether this bundle carries the tiles at all. */
  available(): boolean {
    return this.images.length > 0;
  }

  /** Draws one HUD tile code. Returns false when no sheet holds it. */
  draw(canvas: GbCanvas, code: number, x: number, y: number): boolean {
    for (let i = 0; i < this.images.length; i++) {
      const index = code - this.bases[i];
      if (index >= 0 && index < this.counts[i]) {
        canvas.tile(this.images[i], index, x, y, false);
        return true;
      }
    }
    return false;
  }
}

/** An empty bar cell. Codes $63..$6B are the nine fills, 0 to 8 pixels. */
export const BAR_EMPTY: number = 0x63;
/** A full bar cell. */
export const BAR_FULL: number = 0x6B;

/**
 * The cartridge's own thresholds for what colour a bar is, in pixels of 48.
 *
 * pokered's GetHealthBarColor, exactly: above 24 pixels it is green, above 9 it
 * is yellow, and at or below that it is red. Those are the numbers, not
 * "a half" and "a fifth" -- 9 of 48 is not a fifth, and rounding it to one
 * would move the moment the bar turns red.
 */
export const BAR_GREEN_ABOVE: number = 24;
export const BAR_YELLOW_ABOVE: number = 9;

/** Which colour a bar of `pixels` filled is drawn in. */
export function barShade(pixels: number): number {
  if (pixels > BAR_GREEN_ABOVE) {
    return SHADE_HP_GREEN;
  }
  if (pixels > BAR_YELLOW_ABOVE) {
    return SHADE_HP_YELLOW;
  }
  return SHADE_HP_RED;
}

/** How many of the bar's 48 pixels are filled, by the cartridge's own rule. */
export function barPixels(hp: number, maxHp: number): number {
  if (maxHp <= 0 || hp <= 0) {
    return 0;
  }
  let pixels = Math.floor(hp * BAR_PIXELS / maxHp);
  if (pixels < 1) {
    pixels = 1;
  }
  return pixels > BAR_PIXELS ? BAR_PIXELS : pixels;
}
/** Cells in a bar, and pixels in a cell: the cartridge's 48-pixel bar. */
export const BAR_CELLS: number = 6;
export const BAR_PIXELS_PER_CELL: number = 8;
export const BAR_PIXELS: number = BAR_CELLS * BAR_PIXELS_PER_CELL;

/** The ":L" glyph that stands before a level. */
export const CODE_LEVEL: number = 0x6E;

/** The frame tiles either block is drawn in, as measured. */
const ENEMY_BAR_PREFIX: number[] = [0x73, 0x71, 0x62];
const ENEMY_BAR_SUFFIX: number[] = [0x6C];
const ENEMY_FRAME: number[] = [0x74, 0x76, 0x76, 0x76, 0x76, 0x76, 0x76, 0x76, 0x76, 0x78];
const PLAYER_BAR_PREFIX: number[] = [0x71, 0x62];
const PLAYER_BAR_SUFFIX: number[] = [0x6D];
const PLAYER_FRAME: number[] = [0x6F, 0x76, 0x76, 0x76, 0x76, 0x76, 0x76, 0x76, 0x76, 0x77];
/** The right edge beside your own HP numbers. */
const PLAYER_NUMBERS_EDGE: number = 0x73;

/** Where each block sits, in tiles. Measured; see the header. */
export const ENEMY_TX: number = 1;
export const ENEMY_NAME_TY: number = 0;
export const ENEMY_LEVEL_TX: number = 4;
export const ENEMY_LEVEL_TY: number = 1;
export const ENEMY_BAR_TY: number = 2;
export const ENEMY_FRAME_TY: number = 3;

export const PLAYER_NAME_TX: number = 10;
export const PLAYER_NAME_TY: number = 7;
export const PLAYER_LEVEL_TX: number = 14;
export const PLAYER_LEVEL_TY: number = 8;
export const PLAYER_BAR_TX: number = 10;
export const PLAYER_BAR_TY: number = 9;
export const PLAYER_NUMBERS_TY: number = 10;
export const PLAYER_FRAME_TX: number = 9;
export const PLAYER_FRAME_TY: number = 11;
/** Your current and maximum HP, each right-aligned in three columns. */
export const PLAYER_HP_NOW_RIGHT: number = 13;
export const PLAYER_HP_SLASH_TX: number = 14;
export const PLAYER_HP_MAX_RIGHT: number = 17;
export const PLAYER_NUMBERS_EDGE_TX: number = 18;
export const HP_DIGITS: number = 3;

/**
 * The plate behind each block, in tiles: [tx, ty, tw, th].
 *
 * Wide enough for the longest thing drawn on it rather than for the frame
 * alone: the enemy's frame ends at tx=10 but a ten-letter species reaches it
 * too, and your own name runs to tx=19, one past your frame's right edge.
 */
export const ENEMY_PLATE: number[] = [1, 0, 10, 4];
export const PLAYER_PLATE: number[] = [9, 7, 11, 5];

/** One side of the fight, as the HUD needs it. */
export interface HudSide {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
}

/**
 * The six bar cells for a Pokemon's health.
 *
 * The cartridge never shows an empty bar for something still standing: a
 * Pokemon on its last hit point has a sliver, because a bar that reads empty
 * while its owner is still fighting is a lie the player acts on. So a live
 * Pokemon keeps at least one pixel, and only a fainted one draws flat.
 */
export function hpBarCells(hp: number, maxHp: number): number[] {
  const cells: number[] = [];
  const pixels = barPixels(hp, maxHp);
  for (let i = 0; i < BAR_CELLS; i++) {
    let fill = pixels - i * BAR_PIXELS_PER_CELL;
    if (fill < 0) {
      fill = 0;
    }
    if (fill > BAR_PIXELS_PER_CELL) {
      fill = BAR_PIXELS_PER_CELL;
    }
    cells.push(BAR_EMPTY + fill);
  }
  return cells;
}

/** A number right-aligned in `width` columns, blank-padded. */
export function rightAligned(value: number, width: number): string {
  let text = "" + (value < 0 ? 0 : Math.floor(value));
  if (text.length > width) {
    text = text.substring(text.length - width);
  }
  while (text.length < width) {
    text = " " + text;
  }
  return text;
}

/**
 * The enemy's block: name, level, bar. No numbers -- the cartridge does not
 * show you the other side's HP, and neither does this.
 */
export function paintEnemyHud(canvas: GbCanvas, font: GbFont, side: HudSide,
                              tiles: BattleHudTiles): void {
  plate(canvas, ENEMY_PLATE);
  font.text(canvas, side.name, ENEMY_TX * TILE, ENEMY_NAME_TY * TILE);
  paintLevel(canvas, font, tiles, side.level, ENEMY_LEVEL_TX, ENEMY_LEVEL_TY);
  paintBarRow(canvas, font, tiles, side, ENEMY_TX, ENEMY_BAR_TY,
              ENEMY_BAR_PREFIX, ENEMY_BAR_SUFFIX);
  paintRow(canvas, font, tiles, ENEMY_FRAME, ENEMY_TX, ENEMY_FRAME_TY);
}

/** Your own block: the same, plus the two numbers. */
export function paintPlayerHud(canvas: GbCanvas, font: GbFont, side: HudSide,
                               tiles: BattleHudTiles): void {
  plate(canvas, PLAYER_PLATE);
  font.text(canvas, side.name, PLAYER_NAME_TX * TILE, PLAYER_NAME_TY * TILE);
  paintLevel(canvas, font, tiles, side.level, PLAYER_LEVEL_TX, PLAYER_LEVEL_TY);
  paintBarRow(canvas, font, tiles, side, PLAYER_BAR_TX, PLAYER_BAR_TY,
              PLAYER_BAR_PREFIX, PLAYER_BAR_SUFFIX);
  // Whatever the bar is showing, the number shows the same. The cartridge
  // counts its number down WITH the bar, and a bar that drains beside a number
  // that has already jumped reads as a bug in one of the two.
  const now = rightAligned(side.hp, HP_DIGITS);
  const max = rightAligned(side.maxHp, HP_DIGITS);
  font.text(canvas, now, (PLAYER_HP_NOW_RIGHT - HP_DIGITS + 1) * TILE, PLAYER_NUMBERS_TY * TILE);
  font.text(canvas, "/", PLAYER_HP_SLASH_TX * TILE, PLAYER_NUMBERS_TY * TILE);
  font.text(canvas, max, (PLAYER_HP_MAX_RIGHT - HP_DIGITS + 1) * TILE, PLAYER_NUMBERS_TY * TILE);
  hudTile(canvas, font, tiles, PLAYER_NUMBERS_EDGE,
          PLAYER_NUMBERS_EDGE_TX * TILE, PLAYER_NUMBERS_TY * TILE);
  paintRow(canvas, font, tiles, PLAYER_FRAME, PLAYER_FRAME_TX, PLAYER_FRAME_TY);
}

/**
 * ":L" and the number after it.
 *
 * Measured at level 3 and level 6 -- both single digits, where anchoring the
 * ":L" and right-aligning the digits put every tile in the same place. Anchored
 * is the choice here; a two-digit level has NOT been read off the cartridge and
 * is the thing to check first if a HUD ever looks a column out.
 */
function paintLevel(canvas: GbCanvas, font: GbFont, tiles: BattleHudTiles,
                    level: number, tx: number, ty: number): void {
  hudTile(canvas, font, tiles, CODE_LEVEL, tx * TILE, ty * TILE);
  font.text(canvas, "" + (level > 0 ? Math.floor(level) : 1), (tx + 1) * TILE, ty * TILE);
}

function paintBarRow(canvas: GbCanvas, font: GbFont, tiles: BattleHudTiles,
                     side: HudSide, tx: number, ty: number,
                     prefix: number[], suffix: number[]): void {
  const row: number[] = [];
  for (let i = 0; i < prefix.length; i++) {
    row.push(prefix[i]);
  }
  const cells = hpBarCells(side.hp, side.maxHp);
  for (let i = 0; i < cells.length; i++) {
    row.push(cells[i]);
  }
  for (let i = 0; i < suffix.length; i++) {
    row.push(suffix[i]);
  }
  paintRow(canvas, font, tiles, row, tx, ty);
  // The bar's ink, and only the bar's ink, takes its colour. Done after the
  // tiles rather than instead of them, so the shape stays the cartridge's and
  // only what it means -- how much health is left -- carries the colour.
  const barTx = tx + prefix.length;
  canvas.recolourInk(barTx * TILE, ty * TILE, BAR_CELLS * TILE, TILE,
                     barShade(barPixels(side.hp, side.maxHp)));
}

function paintRow(canvas: GbCanvas, font: GbFont, tiles: BattleHudTiles,
                  codes: number[], tx: number, ty: number): void {
  for (let i = 0; i < codes.length; i++) {
    hudTile(canvas, font, tiles, codes[i], (tx + i) * TILE, ty * TILE);
  }
}

/**
 * One HUD tile, from the battle sheets, falling back to the font.
 *
 * The fallback draws the WRONG picture -- it is the text box's border where an
 * HP bar belongs -- and it is kept anyway, because a bundle baked before these
 * tiles were carried would otherwise draw a HUD with holes in it. Wrong and
 * legible beats absent; and the moment such a bundle is rebaked it is right.
 */
function hudTile(canvas: GbCanvas, font: GbFont, tiles: BattleHudTiles,
                 code: number, x: number, y: number): void {
  if (tiles && tiles.draw(canvas, code, x, y)) {
    return;
  }
  font.code(canvas, code, x, y);
}

/**
 * The translucent plate a block is drawn on.
 *
 * It has to go down BEFORE the glyphs: the font only ever writes ink and
 * leaves everything else alone, so a plate painted afterwards would erase the
 * very text it exists to make readable.
 */
function plate(canvas: GbCanvas, rect: number[]): void {
  canvas.fillRect(rect[0] * TILE, rect[1] * TILE, rect[2] * TILE, rect[3] * TILE, SHADE_GLASS);
}
