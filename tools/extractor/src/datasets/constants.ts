/**
 * constants.json -- the name tables the assembler erased.
 *
 * Port of `extract_constants` in gen1recomp/tools/build_rom_data.py, which is
 * a pass-through: none of this survives into the cart. Map, species, move,
 * sprite and tileset ORDER is implicit in ROM table layout, and the names for
 * those slots exist only in the pret source. So they ship in the MIT-licensed
 * manifest, contain no ROM bytes, and are copied out untouched.
 *
 * Every other dataset indexes into these lists, which is why this one runs
 * first: `constants.mapOrder[7]` is the map id of map 7, `speciesOrder` is the
 * internal (NOT Pokedex) species order, and `constants.maps[id].index` is the
 * map number to look up in the ROM's map header table.
 *
 * No ROM read happens here, so this builder never touches `ctx.rom`.
 */

import type { DatasetBuilder, ExtractContext } from "../registry";
import type { ConstantsDef } from "../types";

/** The eight tables `extract_constants` guarantees to downstream datasets. */
const REQUIRED_KEYS: string[] = [
  "mapOrder",
  "maps",
  "moveOrder",
  "source",
  "speciesOrder",
  "spriteOrder",
  "tilesetOrder",
  "types",
];

/**
 * Fail loudly on a manifest that is the wrong shape.
 *
 * A missing key here would otherwise surface much later as an undefined index
 * inside maps.json or pokemon.json, where the cause is far less obvious.
 */
function validate(constants: unknown): ConstantsDef {
  if (
    constants === null ||
    typeof constants !== "object" ||
    Array.isArray(constants)
  ) {
    throw new Error("manifest 'constants' must be an object");
  }
  const table = constants as { [key: string]: unknown };
  for (let i = 0; i < REQUIRED_KEYS.length; i += 1) {
    if (table[REQUIRED_KEYS[i]] === undefined) {
      throw new Error(`manifest constants is missing '${REQUIRED_KEYS[i]}'`);
    }
  }
  const orders: string[] = [
    "mapOrder",
    "moveOrder",
    "speciesOrder",
    "spriteOrder",
    "tilesetOrder",
  ];
  for (let i = 0; i < orders.length; i += 1) {
    if (!Array.isArray(table[orders[i]])) {
      throw new Error(`manifest constants.${orders[i]} must be an array`);
    }
  }
  return constants as ConstantsDef;
}

export const builder: DatasetBuilder = {
  name: "constants",
  build(ctx: ExtractContext): ConstantsDef {
    // Returned by reference, exactly as the reference implementation does.
    // Nothing downstream is allowed to mutate the manifest.
    return validate(ctx.manifest.constants);
  },
};

export default builder;
