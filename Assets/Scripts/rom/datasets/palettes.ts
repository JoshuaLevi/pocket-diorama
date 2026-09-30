/**
 * palettes.json -- the 37 super palettes and the species-to-palette map.
 *
 * Port of `extract_palettes` in gen1recomp/tools/build_rom_data.py.
 *
 * SuperPalettes is a flat run of four BGR555 words per palette: eight bytes
 * each, the same order as `paletteOrder` in the manifest. Each 15-bit word
 * packs blue, green and red into five bits apiece, low bits first, which is
 * why the channels come out reversed from what an RGB reader expects.
 *
 * MonsterPalettes is indexed by species number, so it starts at entry 1 --
 * entry 0 is the missing-number slot and is skipped, exactly as the reference
 * does by enumerating `dexOrder` from 1.
 *
 * The CGB base palettes only exist in Yellow. The symbol is looked up, not
 * assumed: on Red the key is simply absent from the output rather than null,
 * which is the difference between matching the golden file and not.
 */

import type { DatasetBuilder, ExtractContext } from "../registry";
import type { PaletteDef, PaletteSet } from "../types";
import { scale5 } from "./graphics";

/** Colours per palette. */
const COLORS = 4;

/** Bytes per palette: four little-endian BGR555 words. */
const PALETTE_BYTES = COLORS * 2;

/** Read one palette's four colours as [r, g, b] triples in 0-255. */
function readPalette(
  ctx: ExtractContext,
  bank: number,
  address: number,
): PaletteDef {
  const colors: number[][] = [];
  for (let color = 0; color < COLORS; color += 1) {
    const value = ctx.rom.word(bank, address + color * 2);
    colors.push([
      scale5(value & 0x1f),
      scale5((value >> 5) & 0x1f),
      scale5((value >> 10) & 0x1f),
    ]);
  }
  return colors;
}

/** Read a whole table of palettes, one per name in `order`. */
function readPaletteTable(
  ctx: ExtractContext,
  label: string,
  order: string[],
): { [paletteId: string]: PaletteDef } {
  const symbol = ctx.symbols.get(label);
  const out: { [paletteId: string]: PaletteDef } = {};
  for (let index = 0; index < order.length; index += 1) {
    out[order[index]] = readPalette(
      ctx,
      symbol.bank,
      symbol.address + index * PALETTE_BYTES,
    );
  }
  return out;
}

function build(ctx: ExtractContext): PaletteSet {
  const order: string[] = ctx.manifest.paletteOrder;
  const palettes = readPaletteTable(ctx, "SuperPalettes", order);

  const monTable = ctx.symbols.get("MonsterPalettes");
  const dexOrder: string[] = ctx.manifest.dexOrder;
  const pokemon: { [species: string]: string } = {};
  for (let index = 0; index < dexOrder.length; index += 1) {
    // Species numbers are 1-based; entry 0 of the table is not a species.
    const paletteId = ctx.rom.byte(
      monTable.bank,
      monTable.address + index + 1,
    );
    if (paletteId >= order.length) {
      throw new Error(
        `${dexOrder[index]}: palette id ${paletteId} is outside paletteOrder`,
      );
    }
    pokemon[dexOrder[index]] = order[paletteId];
  }

  const data: PaletteSet = {
    source: "ROM:SuperPalettes + MonsterPalettes",
    palettes: palettes,
    order: order.slice(),
    pokemon: pokemon,
  };

  // Yellow only. Absent on Red, and an absent key is not a null key.
  if (ctx.symbols.has("CGBBasePalettes")) {
    const withCgb = data as PaletteSet & {
      cgbBase: { [paletteId: string]: PaletteDef };
    };
    withCgb.cgbBase = readPaletteTable(ctx, "CGBBasePalettes", order);
    withCgb.source = data.source + " + CGBBasePalettes";
    return withCgb;
  }
  return data;
}

export const builder: DatasetBuilder = {
  name: "palettes",
  build: build,
};

export default builder;
