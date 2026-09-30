// A 160x144 Game Boy screen, in shades, and the cartridge's font drawn onto it.
//
// The boot screens -- the title, the main menu, the option rows, the naming
// grid -- are pictures the cartridge composes from 8x8 tiles, and the honest
// way to show them is to compose them the same way: a shade buffer the size
// of the LCD, one quad, one texture. Pure, so a test can read the pixels back:
// "the box has a top-left corner glyph at (0,32)" is a statement about this
// buffer, not about a scene.
//
// Shades are the DMG's four: 0 is the paper, 3 the ink. Colour arrives only
// when the buffer is turned into RGBA, palette per tile row, which is exactly
// how the Super Game Boy coloured the title screen in bands.

import type { WorldBundle } from "../../world/WorldData";
import { unpackShades, unpackMask } from "../../world/WorldData";

export const SCREEN_WIDTH: number = 160;
export const SCREEN_HEIGHT: number = 144;
export const TILE: number = 8;
/** Tile rows on the screen; a palette band is a range of these. */
export const SCREEN_ROWS: number = SCREEN_HEIGHT / TILE;

/** The DMG's paper and ink, for anything drawn without a palette. */
export const DMG_GREYS: number[][] = [[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]];
/**
 * The DMG's own LCD: pea green paper, dark olive ink. What the setup pages
 * are drawn in once the screen lives in a Game Boy shell, so the LCD reads
 * as a Game Boy's and not as a sheet of paper in a Game Boy.
 */
export const DMG_GREEN: number[][] = [[155, 188, 15], [139, 172, 15], [48, 98, 48], [15, 56, 15]];

/**
 * The shade that means "nothing was drawn here".
 *
 * A Game Boy has four shades and no fifth, so this is not one of the
 * cartridge's -- it is a marker for a canvas shown as a PANEL in a room
 * rather than as a screen. Cleared to it, a panel draws only the tiles
 * something actually put there, and the wearer sees the world between them.
 *
 * The reference mod's own note on its battle HUD is why this exists: an
 * opaque panel would be "the white field back under another name". Giving the
 * battle HUD the whole screen to live on hung one 160x144 white rectangle in
 * front of the diorama, which is that field exactly.
 *
 * Anything mapping shades to colours must test for this BEFORE masking to
 * 0..3, or it reads as white -- the very field it exists to avoid.
 */
export const SHADE_NONE: number = 4;

/**
 * The shade a panel's own backing draws in: the reference's frosted glass.
 *
 * Its battle HUD keeps the Game Boy's glyphs black and puts a translucent
 * plate behind each block -- 55 per cent, measured off the mod -- rather than
 * an opaque one, whose own note says opaque "would be the white field back
 * under another name". Black ink alone is the other failure: legible over a
 * sunlit tabletop and gone over a dark one.
 *
 * We cannot blur what is behind a quad cheaply, so this is the opacity without
 * the blur, which is the half of the effect that does the work.
 */
export const SHADE_GLASS: number = 5;
/** How opaque that plate is, 0..255. 55 per cent, as measured. */
export const GLASS_ALPHA: number = 140;

/**
 * The three shades an HP bar's ink is recoloured to.
 *
 * A Game Boy has no colour and the cartridge's own bar is black on white; the
 * Color and Super Game Boy releases put green, yellow and red on it, and that
 * is what everyone remembers a Pokemon HP bar looking like. Joshua asked for it
 * on 8 September.
 *
 * Sentinels rather than a palette swap, for the same reason SHADE_NONE is one:
 * the canvas is four shades deep and everything downstream masks to 0..3, so a
 * fifth, sixth and seventh value have to be TESTED FOR before that mask.
 */
export const SHADE_HP_GREEN: number = 6;
export const SHADE_HP_YELLOW: number = 7;
export const SHADE_HP_RED: number = 8;

/** What each of those draws as. Dark enough to read on the frosted plate. */
export const HP_COLOURS: number[][] = [
  [48, 176, 64],
  [224, 168, 32],
  [216, 56, 48],
];

export interface ShadeImage {
  width: number;
  height: number;
  shades: Uint8Array;
  /** 1 = opaque. null when the whole image is opaque. */
  alpha: Uint8Array;
}

/** A bundle graphic -- { width, height, shades, alpha } -- unpacked for drawing. */
export function imageFromPacked(packed: any): ShadeImage {
  if (!packed || typeof packed.width !== "number" || typeof packed.shades !== "string") {
    return null;
  }
  const count = packed.width * packed.height;
  return {
    width: packed.width,
    height: packed.height,
    shades: unpackShades(packed.shades, count),
    alpha: typeof packed.alpha === "string" && packed.alpha.length > 0
      ? unpackMask(packed.alpha, count) : null,
  };
}

export class GbCanvas {
  readonly pixels: Uint8Array = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  private version: number = 0;
  /** The background-only layer `blitPartMasked`'s behindInk test reads --
   * see `snapshotBackground`. null until the first snapshot, in which case
   * behindInk falls back to the live `pixels` (this class's own behaviour
   * before a caller adopted snapshots). */
  private background: Uint8Array = null;

  /** Bumped by every draw, so a view uploads only when something changed. */
  stateVersion(): number {
    return this.version;
  }

  /**
   * Freezes the CURRENT pixels as "the background", for `blitPartMasked`'s
   * behindInk test to read from now on instead of the live, still-changing
   * canvas -- call this once, after the background is painted and before the
   * first sprite is. Sprites draw over each other in the usual way; only the
   * behindInk (grass-over-feet) test is affected.
   *
   * Why this exists: behindInk answers "does the GROUND already have ink
   * here" (a grass blade), one pixel at a time. Reading the live composite
   * canvas answered a different question once more than one sprite was ever
   * drawn -- "does ANYTHING already have ink here" -- so an NPC painted
   * before a later sprite, standing where that sprite's own masked half
   * lands, made its ink count as ground and suppressed the later sprite's
   * own pixel there. A snapshot taken before any sprite exists cannot
   * contain a sprite's ink, by construction.
   */
  snapshotBackground(): void {
    const copy = new Uint8Array(this.pixels.length);
    for (let i = 0; i < this.pixels.length; i++) {
      copy[i] = this.pixels[i];
    }
    this.background = copy;
  }

/**
 * The shade that means "nothing was drawn here".
 *
 * A Game Boy has four shades and no fifth, so this is not one of the
 * cartridge's -- it is a marker for a canvas that is shown as a PANEL in a
 * room rather than as a screen. Cleared to it, a panel draws only the tiles
 * something actually put there and the wearer sees the world between them.
 *
 * The reference mod's own note on its battle HUD is the reason this exists:
 * an opaque panel would be "the white field back under another name". The
 * lens had one 160x144 white rectangle hanging in front of the diorama the
 * moment the battle HUD was given the whole screen to live on.
 *
 * Consumers that map shades to colours must test for it BEFORE masking to
 * 0..3, or it reads as white -- which is exactly the field it exists to
 * avoid.
 */
  /**
   * Put every pixel through a four-entry palette, as LoadGBPal does with BGP
   * and OBP0 (home/fade.asm:3-19). The picture is already drawn; this is the
   * palette the LCD shows it through.
   */
  remapShades(palette: number[]): void {
    if (!palette || palette.length < 4) {
      return;
    }
    for (let i = 0; i < this.pixels.length; i++) {
      const shade = this.pixels[i];
      this.pixels[i] = shade >= 0 && shade < 4 ? palette[shade] : shade;
    }
    this.version = this.version + 1;
  }

  clear(shade: number): void {
    for (let i = 0; i < this.pixels.length; i++) {
      this.pixels[i] = shade;
    }
    this.version++;
  }

  fillRect(x: number, y: number, width: number, height: number, shade: number): void {
    const x0 = x < 0 ? 0 : x;
    const y0 = y < 0 ? 0 : y;
    const x1 = x + width > SCREEN_WIDTH ? SCREEN_WIDTH : x + width;
    const y1 = y + height > SCREEN_HEIGHT ? SCREEN_HEIGHT : y + height;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.pixels[py * SCREEN_WIDTH + px] = shade;
      }
    }
    this.version++;
  }

  /**
   * Repaints this rectangle's INK -- and only its ink -- as another shade.
   *
   * Used to colour an HP bar after the cartridge's own tiles have drawn it: the
   * bar's filled pixels are shade 3 and its empty ones are not, so recolouring
   * the ink colours exactly the part that means "health left" without anyone
   * having to know how the tile is drawn.
   */
  recolourInk(x: number, y: number, width: number, height: number, shade: number): void {
    const x0 = x < 0 ? 0 : x;
    const y0 = y < 0 ? 0 : y;
    const x1 = x + width > SCREEN_WIDTH ? SCREEN_WIDTH : x + width;
    const y1 = y + height > SCREEN_HEIGHT ? SCREEN_HEIGHT : y + height;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const at = py * SCREEN_WIDTH + px;
        if (this.pixels[at] === 3) {
          this.pixels[at] = shade;
        }
      }
    }
    this.version++;
  }

  shadeAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= SCREEN_WIDTH || y >= SCREEN_HEIGHT) {
      return -1;
    }
    return this.pixels[y * SCREEN_WIDTH + x];
  }

  /**
   * Draws an image, or a part of one. With `transparent`, pixels the alpha
   * mask clears (or, without a mask, shade-0 pixels) leave the canvas alone --
   * that is how a sprite sits on a background and how glyph ink sits on paper.
   */
  blitPart(img: ShadeImage, sx: number, sy: number, width: number, height: number,
           x: number, y: number, transparent: boolean): void {
    if (!img) {
      return;
    }
    for (let row = 0; row < height; row++) {
      const py = y + row;
      const iy = sy + row;
      if (py < 0 || py >= SCREEN_HEIGHT || iy < 0 || iy >= img.height) {
        continue;
      }
      for (let col = 0; col < width; col++) {
        const px = x + col;
        const ix = sx + col;
        if (px < 0 || px >= SCREEN_WIDTH || ix < 0 || ix >= img.width) {
          continue;
        }
        const i = iy * img.width + ix;
        if (transparent) {
          if (img.alpha ? img.alpha[i] === 0 : img.shades[i] === 0) {
            continue;
          }
        }
        this.pixels[py * SCREEN_WIDTH + px] = img.shades[i];
      }
    }
    this.version++;
  }

  blit(img: ShadeImage, x: number, y: number, transparent: boolean): void {
    if (img) {
      this.blitPart(img, 0, 0, img.width, img.height, x, y, transparent);
    }
  }

  /**
   * `blitPart` with the two quirks Gen 1's overworld sprites need that a tile
   * or a menu glyph never does:
   *
   * `hFlip` mirrors the source horizontally -- a right-facing walker is the
   * left frame mirrored, there is no seventh frame (SpriteBillboard.frameFor
   * makes the same choice for the diorama's billboards).
   *
   * `behindInk` leaves the BACKGROUND'S ink (shade 1-3) alone and draws only
   * onto its paper (shade 0): measured on the cartridge, standing in tall
   * grass sets the OBJ-to-BG priority bit on the sprite's bottom OAM tiles,
   * so the grass tile's own ink shows through the lower half of the sprite
   * instead of the sprite covering it (tools/oracle, GAME BOY mode pass: OAM
   * attr bit 7 on the bottom two tiles only, and only while standing on the
   * grass tile). Tests the frozen layer `snapshotBackground` took, not the
   * live canvas -- a sprite drawn since is never mistaken for ground ink.
   */
  blitPartMasked(img: ShadeImage, sx: number, sy: number, width: number, height: number,
                 x: number, y: number, transparent: boolean, hFlip: boolean, behindInk: boolean): void {
    if (!img) {
      return;
    }
    const groundLayer = this.background ? this.background : this.pixels;
    for (let row = 0; row < height; row++) {
      const py = y + row;
      const iy = sy + row;
      if (py < 0 || py >= SCREEN_HEIGHT || iy < 0 || iy >= img.height) {
        continue;
      }
      for (let col = 0; col < width; col++) {
        const px = x + col;
        const ix = hFlip ? sx + (width - 1 - col) : sx + col;
        if (px < 0 || px >= SCREEN_WIDTH || ix < 0 || ix >= img.width) {
          continue;
        }
        const destIndex = py * SCREEN_WIDTH + px;
        if (behindInk && groundLayer[destIndex] !== 0) {
          continue;
        }
        const i = iy * img.width + ix;
        if (transparent && (img.alpha ? img.alpha[i] === 0 : img.shades[i] === 0)) {
          continue;
        }
        this.pixels[destIndex] = img.shades[i];
      }
    }
    this.version++;
  }

  /** One 8x8 tile out of a sheet laid out `tilesPerRow` across. */
  tile(sheet: ShadeImage, index: number, x: number, y: number, transparent: boolean): void {
    if (!sheet) {
      return;
    }
    const perRow = Math.floor(sheet.width / TILE);
    const sx = (index % perRow) * TILE;
    const sy = Math.floor(index / perRow) * TILE;
    this.blitPart(sheet, sx, sy, TILE, TILE, x, y, transparent);
  }

  /**
   * RGBA, bottom row first, which is the order setPixels fills a texture.
   * `paletteForRow` picks the four colours for each tile row, so the SGB's
   * banded title colouring is one function rather than a second buffer.
   */
  toRgba(out: Uint8Array, paletteForRow: (tileRow: number) => number[][]): void {
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      const palette = paletteForRow(Math.floor(y / TILE));
      const outRow = SCREEN_HEIGHT - 1 - y;
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const colour = palette[this.pixels[y * SCREEN_WIDTH + x] & 3];
        const o = (outRow * SCREEN_WIDTH + x) * 4;
        out[o] = colour[0];
        out[o + 1] = colour[1];
        out[o + 2] = colour[2];
        out[o + 3] = 255;
      }
    }
  }

  /**
   * The same, for a canvas shown as a PANEL in a room rather than as a screen:
   * the shades past the Game Boy's four are honoured instead of masked away.
   *
   * Every one of them has to be tested BEFORE the mask, because 4 & 3 is 0 and
   * 5 & 3 is 1: masking first turns "nothing here" into paper and the frosted
   * plate into a grey one. This was the dialogue panel's own loop; the graphics
   * page beside the diorama needs the identical treatment, and two copies of a
   * rule this easy to get subtly wrong is one copy too many.
   */
  toPanelRgba(out: Uint8Array, greys: number[][]): void {
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      const outRow = SCREEN_HEIGHT - 1 - y;
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const shade = this.pixels[y * SCREEN_WIDTH + x];
        const o = (outRow * SCREEN_WIDTH + x) * 4;
        if (shade === SHADE_NONE) {
          out[o] = 0;
          out[o + 1] = 0;
          out[o + 2] = 0;
          out[o + 3] = 0;
          continue;
        }
        if (shade >= SHADE_HP_GREEN) {
          // The three HP shades run consecutively from SHADE_HP_GREEN, so the
          // colour is an index rather than three branches.
          const hp = HP_COLOURS[shade - SHADE_HP_GREEN];
          if (hp) {
            out[o] = hp[0];
            out[o + 1] = hp[1];
            out[o + 2] = hp[2];
            out[o + 3] = 255;
            continue;
          }
        }
        if (shade === SHADE_GLASS) {
          out[o] = 255;
          out[o + 1] = 255;
          out[o + 2] = 255;
          out[o + 3] = GLASS_ALPHA;
          continue;
        }
        const colour = greys[shade & 3];
        out[o] = colour[0];
        out[o + 1] = colour[1];
        out[o + 2] = colour[2];
        out[o + 3] = 255;
      }
    }
  }
}

/** Text box border, in the cartridge's own character codes (charmap.asm). */
export const CODE_BOX_TL: number = 0x79;
export const CODE_BOX_H: number = 0x7a;
export const CODE_BOX_TR: number = 0x7b;
export const CODE_BOX_V: number = 0x7c;
export const CODE_BOX_BL: number = 0x7d;
export const CODE_BOX_BR: number = 0x7e;
export const CODE_BLANK: number = 0x7f;
/** The naming screen's underscore, and the raised one under the next letter. */
export const CODE_UNDERSCORE: number = 0x76;
export const CODE_UNDERSCORE_RAISED: number = 0x77;
/** The filled menu arrow, and the hollow one left on a chosen row. */
export const CODE_CURSOR: number = 0xed;
export const CODE_CURSOR_HOLLOW: number = 0xec;
/** Ink threshold: the sheets carry four shades, and anything at 2 or over is ink. */
const INK_SHADE: number = 2;

/**
 * The cartridge's font on a GbCanvas: the main sheet at $80-$FF and the
 * second sheet (border, underscores) at $60-$7F. Glyphs are drawn as ink
 * over whatever is there, the way the hardware's tiles draw over the paper.
 */
export class GbFont {
  private main: ShadeImage;
  private extra: ShadeImage;
  private mainBase: number;
  private extraBase: number;
  /** One character -> its code, from the charmap's single-character entries. */
  private lookup: any = {};
  /**
   * "'s"/"'t"/"'d"/"'l"/"'m"/"'r"/"'v" -> one code, from the charmap's own
   * two-character contraction entries. The cartridge's font draws a whole
   * contraction as a single tile (charmap.asm's `db "'s",$bd` and its six
   * siblings) rather than an apostrophe tile plus a letter tile; text() has
   * to try one of these before falling back to a single character, or a
   * line with a contraction in it prints one tile column too wide from
   * that point on (found rendering _OakSpeechText3's own closing line,
   * cross-checked pixel-for-pixel against tools/oracle's recorded frame).
   */
  private pairs: any = {};

  constructor(bundle: WorldBundle) {
    const font: any = (bundle as any).font;
    this.main = font ? imageFromPacked({
      width: font.width, height: font.height, shades: font.shades, alpha: "",
    }) : null;
    this.extra = font && font.extraShades ? imageFromPacked({
      width: font.extraWidth, height: font.extraHeight, shades: font.extraShades, alpha: "",
    }) : null;
    this.mainBase = font ? font.mainBase : 0x80;
    this.extraBase = font ? font.extraBase : 0x60;
    const charmap = font ? font.charmap : [];
    for (let i = 0; charmap && i < charmap.length; i++) {
      const seq = charmap[i].seq;
      if (typeof seq !== "string") {
        continue;
      }
      if (seq.length === 1 && this.lookup[seq] === undefined) {
        this.lookup[seq] = charmap[i].code;
      } else if (seq.length === 2 && seq.charAt(0) === "'" && this.pairs[seq] === undefined) {
        this.pairs[seq] = charmap[i].code;
      }
    }
  }

  static available(bundle: WorldBundle): boolean {
    const font: any = (bundle as any).font;
    return !!(font && typeof font.shades === "string" && font.shades.length > 0);
  }

  hasBorder(): boolean {
    return this.extra !== null;
  }

  /** The code a character types as, or -1 when the cartridge has no glyph for it. */
  codeOf(character: string): number {
    const code = this.lookup[character];
    return typeof code === "number" ? code : -1;
  }

  /** Draws one character code. Unknown codes draw nothing. */
  code(canvas: GbCanvas, code: number, x: number, y: number): void {
    if (code >= this.mainBase && this.main) {
      GbFont.inkTile(canvas, this.main, code - this.mainBase, x, y);
    } else if (code >= this.extraBase && code < this.mainBase && this.extra) {
      GbFont.inkTile(canvas, this.extra, code - this.extraBase, x, y);
    }
  }

  /**
   * A line of text, eight pixels per tile, unknown characters skipped as
   * spaces. A contraction ("'s" and its six siblings) is TWO source
   * characters that print as ONE tile -- see `pairs` above -- so the tile
   * column and the string index only sometimes move together.
   */
  text(canvas: GbCanvas, line: string, x: number, y: number): void {
    let column = 0;
    for (let i = 0; i < line.length; i++) {
      const pair = i + 1 < line.length ? line.substring(i, i + 2) : "";
      const pairCode = this.pairs[pair];
      if (typeof pairCode === "number") {
        this.code(canvas, pairCode, x + column * TILE, y);
        column++;
        i++; // the pair's second character is already drawn
        continue;
      }
      const code = this.codeOf(line.charAt(i));
      if (code >= 0) {
        this.code(canvas, code, x + column * TILE, y);
      }
      column++;
    }
  }

  /**
   * A text box in tiles: white paper and the border glyphs around it, the
   * way TextBoxBorder draws it. Without the second sheet only the paper is
   * drawn, so a box still reads as a box on an old bundle.
   */
  /**
   * The cartridge's own framed box.
   *
   * `fill` is the shade the inside is painted in, and it is the cartridge's
   * paper unless someone asks otherwise. SHADE_GLASS is the other answer, for
   * a box that hangs BESIDE something the wearer is trying to look at rather
   * than in front of a wall of text: paper there is an opaque rectangle over
   * the world, which is the "white field back under another name" this file's
   * own SHADE_NONE note warns about.
   */
  box(canvas: GbCanvas, tx: number, ty: number, tw: number, th: number,
      fill: number = 0): void {
    canvas.fillRect(tx * TILE, ty * TILE, tw * TILE, th * TILE, fill);
    if (!this.extra) {
      return;
    }
    const x0 = tx * TILE;
    const y0 = ty * TILE;
    const x1 = (tx + tw - 1) * TILE;
    const y1 = (ty + th - 1) * TILE;
    this.code(canvas, CODE_BOX_TL, x0, y0);
    this.code(canvas, CODE_BOX_TR, x1, y0);
    this.code(canvas, CODE_BOX_BL, x0, y1);
    this.code(canvas, CODE_BOX_BR, x1, y1);
    for (let i = 1; i < tw - 1; i++) {
      this.code(canvas, CODE_BOX_H, x0 + i * TILE, y0);
      this.code(canvas, CODE_BOX_H, x0 + i * TILE, y1);
    }
    for (let j = 1; j < th - 1; j++) {
      this.code(canvas, CODE_BOX_V, x0, y0 + j * TILE);
      this.code(canvas, CODE_BOX_V, x1, y0 + j * TILE);
    }
  }

  /** Ink pixels of a sheet tile onto the canvas; paper pixels leave it alone. */
  private static inkTile(canvas: GbCanvas, sheet: ShadeImage, index: number,
                         x: number, y: number): void {
    const perRow = Math.floor(sheet.width / TILE);
    const sx = (index % perRow) * TILE;
    const sy = Math.floor(index / perRow) * TILE;
    if (sy + TILE > sheet.height) {
      return;
    }
    for (let row = 0; row < TILE; row++) {
      const py = y + row;
      if (py < 0 || py >= SCREEN_HEIGHT) {
        continue;
      }
      for (let col = 0; col < TILE; col++) {
        const px = x + col;
        if (px < 0 || px >= SCREEN_WIDTH) {
          continue;
        }
        if (sheet.shades[(sy + row) * sheet.width + sx + col] >= INK_SHADE) {
          canvas.pixels[py * SCREEN_WIDTH + px] = 3;
        }
      }
    }
    (canvas as any).version++;
  }
}
