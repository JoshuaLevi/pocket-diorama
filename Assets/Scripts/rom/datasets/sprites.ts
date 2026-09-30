/**
 * sprites.json -- the overworld sprite sheets.
 *
 * Port of `extract_sprites` in gen1recomp/tools/build_rom_data.py. These are
 * the walking frames the diorama billboards: the player, every NPC, and the
 * static props (boulders, poke balls, the fossil) that share the same table.
 *
 * SpriteSheetPointerTable is four bytes per entry:
 *   +0  pointer, little-endian, into the sheet's own bank
 *   +2  length of the first half of the sheet, in bytes
 *   +3  bank
 *
 * A sheet with six or more 16x16 frames is a walker and stores both halves,
 * so its real length is twice the recorded one; anything smaller is a single
 * static block. The manifest's declared width/height is only a hint -- when
 * the ROM disagrees the ROM wins, because pret's PNG atlases are occasionally
 * padded beyond what the cart actually stores.
 */

import { decode2bpp } from "../core/decode";
import type { DatasetBuilder, ExtractContext } from "../registry";
import type { ManifestSpriteMeta, SpriteDef, SpriteTable } from "../types";
import { emitImage } from "./graphics";

/** Bytes per 8x8 2bpp tile, so `width * height / PIXELS_PER_BYTE`. */
const PIXELS_PER_BYTE = 4;

/** A sheet needs this many 16x16 frames before it counts as a walk cycle. */
const WALKER_FRAMES = 6;

/** Height of one overworld frame in pixels. */
const FRAME_HEIGHT = 16;

interface SheetGeometry {
  width: number;
  height: number;
  frames: number;
  byteLength: number;
}

/**
 * Reconcile the manifest's atlas geometry with the length the ROM records.
 *
 * Throws with the sprite's name when the two cannot be squared, rather than
 * decoding a sheet at the wrong stride and producing plausible garbage.
 */
function resolveGeometry(
  constName: string,
  spec: ManifestSpriteMeta,
  firstHalfLength: number,
): SheetGeometry {
  const width = spec.imageWidth;
  let height = spec.imageHeight;
  let byteLength = (width * height) / PIXELS_PER_BYTE;
  let frames = Math.floor(height / FRAME_HEIGHT);
  let expected = firstHalfLength * (frames >= WALKER_FRAMES ? 2 : 1);

  if (byteLength !== expected) {
    // The commercial sheet length wins over the pret PNG atlas.
    byteLength = expected;
    if ((byteLength * PIXELS_PER_BYTE) % width !== 0) {
      throw new Error(
        `${constName}: ROM sprite length ${byteLength} is not tile-aligned ` +
          `for width ${width}`,
      );
    }
    height = (byteLength * PIXELS_PER_BYTE) / width;
    frames = Math.floor(height / FRAME_HEIGHT);
    expected = firstHalfLength * (frames >= WALKER_FRAMES ? 2 : 1);
    if (byteLength !== expected) {
      throw new Error(
        `${constName}: ROM sprite length ${expected} does not match atlas ` +
          `length ${(width * spec.imageHeight) / PIXELS_PER_BYTE}`,
      );
    }
  }
  return { width: width, height: height, frames: frames, byteLength: byteLength };
}

function spriteDef(
  id: string,
  source: string,
  imageBase: string,
  frames: number,
): SpriteDef {
  return {
    id: id,
    source: source,
    image: "assets/generated/sprites/" + imageBase + ".png",
    frames: frames,
    walker: frames >= WALKER_FRAMES,
  };
}

/** Decode one sheet and hand it to the asset sink, once per image base. */
function emitSheet(
  ctx: ExtractContext,
  written: string[],
  imageBase: string,
  raw: Uint8Array,
  width: number,
  height: number,
): void {
  if (written.indexOf(imageBase) >= 0) {
    return;
  }
  written.push(imageBase);
  emitImage(
    ctx,
    "sprites/" + imageBase + ".png",
    decode2bpp(raw, width, height, true),
  );
}

function build(ctx: ExtractContext): SpriteTable {
  const order: string[] = ctx.manifest.constants.spriteOrder;
  const metadata: ManifestSpriteMeta[] = ctx.manifest.sprites.order;
  const table = ctx.symbols.get("SpriteSheetPointerTable");
  if (metadata.length !== order.length) {
    throw new Error("sprite metadata count does not match constants");
  }

  const out: SpriteTable = {};
  const written: string[] = [];

  for (let index = 0; index < order.length; index += 1) {
    const constName = order[index];
    const spec = metadata[index];
    if (spec.id !== constName) {
      throw new Error(
        `sprite metadata ${spec.id} is out of order at ${constName}`,
      );
    }
    const address = table.address + index * 4;
    const pointer = ctx.rom.word(table.bank, address);
    const firstHalfLength = ctx.rom.byte(table.bank, address + 2);
    const bank = ctx.rom.byte(table.bank, address + 3);
    const geometry = resolveGeometry(constName, spec, firstHalfLength);

    emitSheet(
      ctx,
      written,
      spec.imageBase,
      ctx.rom.bytes(bank, pointer, geometry.byteLength),
      geometry.width,
      geometry.height,
    );

    out[constName] = spriteDef(
      constName,
      "ROM:SpriteSheetPointerTable[" + index + "]",
      spec.imageBase,
      geometry.frames,
    );
  }

  // The bike is loaded outside the pointer table, straight from its label.
  const bike: ManifestSpriteMeta = ctx.manifest.sprites.bike;
  const bikeSymbol = ctx.symbols.get(bike.label);
  const bikeLength = (bike.imageWidth * bike.imageHeight) / PIXELS_PER_BYTE;
  emitSheet(
    ctx,
    written,
    bike.imageBase,
    ctx.rom.bytes(bikeSymbol.bank, bikeSymbol.address, bikeLength),
    bike.imageWidth,
    bike.imageHeight,
  );
  out.SPRITE_RED_BIKE = spriteDef(
    "SPRITE_RED_BIKE",
    "ROM:RedBikeSprite",
    "red_bike",
    Math.floor(bike.imageHeight / FRAME_HEIGHT),
  );

  // Yellow-only: the surfing-Pikachu ride sheet, loaded by
  // LoadSurfingPlayerSpriteGraphics2 rather than the pointer table. Red has
  // neither the manifest entry nor the symbol, so this stays inert there.
  const surf: ManifestSpriteMeta | undefined = ctx.manifest.sprites.surfPikachu;
  if (surf !== undefined && surf !== null && ctx.symbols.has(surf.label)) {
    const surfSymbol = ctx.symbols.get(surf.label);
    const surfLength = (surf.imageWidth * surf.imageHeight) / PIXELS_PER_BYTE;
    emitSheet(
      ctx,
      written,
      surf.imageBase,
      ctx.rom.bytes(surfSymbol.bank, surfSymbol.address, surfLength),
      surf.imageWidth,
      surf.imageHeight,
    );
    out.SPRITE_SURFING_PIKACHU = spriteDef(
      "SPRITE_SURFING_PIKACHU",
      "ROM:" + surf.label,
      surf.imageBase,
      Math.floor(surf.imageHeight / FRAME_HEIGHT),
    );
  }

  return out;
}

export const builder: DatasetBuilder = {
  name: "sprites",
  build: build,
};

export default builder;
