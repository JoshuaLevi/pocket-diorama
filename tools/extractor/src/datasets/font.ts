/**
 * font.json -- the Game Boy text font and the box/dex glyph sheet.
 *
 * Port of `extract_font` in gen1recomp/tools/build_rom_data.py. The JSON is
 * small and mostly fixed: where the two sheets live, which byte the first
 * glyph of each sheet answers to, and the symbolic charmap the manifest
 * carries. The pixels are the interesting part.
 *
 * FontGraphics is 1bpp -- eight bytes per 8x8 glyph, one bit per pixel -- and
 * is laid out sixteen glyphs to a row. It is decoded by hand rather than with
 * the shared 1bpp decoder because the reference leaves cleared bits as
 * transparent *black* here, not the transparent white the shared decoder uses.
 *
 * TextBoxGraphics is 2bpp and gets thresholded instead of shaded: anything
 * darker than mid grey becomes opaque black, everything else disappears. The
 * first two tiles of PokedexTileGraphics then overwrite the top-left 16x8 of
 * that sheet, which is how the dex screen borrows the box corner slots.
 */

import { decode2bpp } from "../core/decode";
import type { DecodedImage } from "../core/decode";
import type { DatasetBuilder, ExtractContext } from "../registry";
import type { FontDef, FontGlyph } from "../types";
import {
  BLACK_CLEAR,
  BLACK_OPAQUE,
  deepCloneJson,
  emitImage,
  newImage,
  setPixel,
} from "./graphics";

/** Glyphs across one row of either sheet. */
const GLYPHS_PER_ROW = 16;

/** Byte value the first glyph of FontGraphics decodes to. */
const MAIN_BASE = 0x80;

/** Byte value the first glyph of the box/dex sheet decodes to. */
const EXTRA_BASE = 0x60;

/** 1bpp glyphs in FontGraphics: 128 tiles, eight bytes each. */
const MAIN_TILES = 128;

/** 2bpp tiles in TextBoxGraphics: 32 tiles, sixteen bytes each. */
const EXTRA_TILES = 32;

/** Anything below this red value counts as ink when thresholding. */
const INK_THRESHOLD = 128;

/** The naming grid's row-13 yen sign (INTRO.md "Beat 25") -- see stampEdTile. */
const YEN_CODE = 0xf0;
const ED_TILE_SYMBOL = "ED_Tile";

/** Decode FontGraphics: set bits are opaque black, clear bits transparent. */
function decodeMainFont(raw: Uint8Array): DecodedImage {
  const image = newImage(GLYPHS_PER_ROW * 8, (MAIN_TILES / GLYPHS_PER_ROW) * 8, BLACK_CLEAR);
  for (let tile = 0; tile < MAIN_TILES; tile += 1) {
    const tileX = (tile % GLYPHS_PER_ROW) * 8;
    const tileY = Math.floor(tile / GLYPHS_PER_ROW) * 8;
    for (let y = 0; y < 8; y += 1) {
      const row = raw[tile * 8 + y];
      for (let x = 0; x < 8; x += 1) {
        if ((row & (1 << (7 - x))) !== 0) {
          setPixel(image, tileX + x, tileY + y, BLACK_OPAQUE);
        }
      }
    }
  }
  return image;
}

/**
 * Code $F0 (the naming grid's row-13 yen sign, INTRO.md "Beat 25") is NOT
 * FontGraphics's own tile 112 ($F0 - MAIN_BASE): measured by dumping
 * PyBoy's live VRAM for tile id $F0 while the naming grid is open and
 * decoding it bit for bit, FontGraphics's own tile 112 is a different,
 * unrelated glyph -- the manifest already carries the real one under its
 * own name, ED_Tile (bank 1, $6767; the charmap's own second seq for this
 * code is the literal placeholder "<ED>", the same name), a single 8-byte
 * 1bpp tile that matches VRAM byte for byte and that no other dataset
 * reads. Stamped over decodeMainFont's own tile 112, the same way the
 * Pokedex border tiles below overwrite the extra sheet's own top-left
 * 16x8 -- reusing one VRAM tile slot for two different on-screen glyphs
 * depending on context is exactly what that overlay already does.
 */
function stampEdTile(image: DecodedImage, ctx: ExtractContext): void {
  const symbol = ctx.symbols.get(ED_TILE_SYMBOL);
  const raw = ctx.rom.bytes(symbol.bank, symbol.address, 8);
  const tile = YEN_CODE - MAIN_BASE;
  const tileX = (tile % GLYPHS_PER_ROW) * 8;
  const tileY = Math.floor(tile / GLYPHS_PER_ROW) * 8;
  for (let y = 0; y < 8; y += 1) {
    const row = raw[y];
    for (let x = 0; x < 8; x += 1) {
      const color = (row & (1 << (7 - x))) !== 0 ? BLACK_OPAQUE : BLACK_CLEAR;
      setPixel(image, tileX + x, tileY + y, color);
    }
  }
}

/** Keep only the dark half of a shaded sheet, as opaque black on nothing. */
function threshold(shaded: DecodedImage): DecodedImage {
  const image = newImage(shaded.width, shaded.height, BLACK_CLEAR);
  for (let y = 0; y < shaded.height; y += 1) {
    for (let x = 0; x < shaded.width; x += 1) {
      if (shaded.pixels[(y * shaded.width + x) * 4] < INK_THRESHOLD) {
        setPixel(image, x, y, BLACK_OPAQUE);
      }
    }
  }
  return image;
}

function build(ctx: ExtractContext): FontDef {
  const mainSymbol = ctx.symbols.get("FontGraphics");
  const mainRaw = ctx.rom.bytes(
    mainSymbol.bank,
    mainSymbol.address,
    MAIN_TILES * 8,
  );
  const mainImage = decodeMainFont(mainRaw);
  stampEdTile(mainImage, ctx);
  emitImage(ctx, "fonts/font.png", mainImage);

  const extraSymbol = ctx.symbols.get("TextBoxGraphics");
  const extraRaw = ctx.rom.bytes(
    extraSymbol.bank,
    extraSymbol.address,
    EXTRA_TILES * 16,
  );
  const extra = threshold(decode2bpp(extraRaw, 128, 16));

  // The two dex-border tiles land on top of the box sheet's first 16x8.
  const pokedex = ctx.symbols.get("PokedexTileGraphics");
  const dexTiles = decode2bpp(
    ctx.rom.bytes(pokedex.bank, pokedex.address, 32),
    16,
    8,
  );
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const ink = dexTiles.pixels[(y * dexTiles.width + x) * 4] < INK_THRESHOLD;
      setPixel(extra, x, y, ink ? BLACK_OPAQUE : BLACK_CLEAR);
    }
  }
  emitImage(ctx, "fonts/font_extra.png", extra);

  const charmap: FontGlyph[] = deepCloneJson(ctx.manifest.fontCharmap);
  return {
    source: "ROM:FontGraphics, TextBoxGraphics, PokedexTileGraphics",
    image: "assets/generated/fonts/font.png",
    imageExtra: "assets/generated/fonts/font_extra.png",
    mainBase: MAIN_BASE,
    extraBase: EXTRA_BASE,
    glyphsPerRow: GLYPHS_PER_ROW,
    charmap: charmap,
  };
}

export const builder: DatasetBuilder = {
  name: "font",
  build: build,
};

export default builder;
