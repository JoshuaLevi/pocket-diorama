/**
 * icons.json -- the ten party-menu icons and which one each species uses.
 *
 * Port of `extract_icons` in gen1recomp/tools/build_rom_data.py.
 *
 * MonPartyData packs one icon id per species into a nibble, two species to a
 * byte, high nibble first. 151 species therefore occupy 76 bytes and the last
 * low nibble is padding.
 *
 * Six of the ten icons reuse a Pokemon's own front sprite (the monster, the
 * ball, the fossil...) and are decoded by the pokemon dataset. The remaining
 * four are stored here as two 8x16 frames each, and are mirrored to build the
 * 16x16 the party menu actually draws: the ROM only keeps the left half.
 */

import { decode2bpp } from "../core/decode";
import type { DatasetBuilder, ExtractContext } from "../registry";
import type { IconsDef } from "../types";
import {
  WHITE_CLEAR,
  cropImage,
  emitImage,
  flipHorizontal,
  newImage,
  nybbles,
  pasteImage,
} from "./graphics";

/** Where each icon id's artwork ends up on disk. */
const ICON_IMAGES: { [iconId: string]: string } = {
  MON: "assets/generated/sprites/monster.png",
  BALL: "assets/generated/sprites/poke_ball.png",
  HELIX: "assets/generated/sprites/fossil.png",
  FAIRY: "assets/generated/sprites/fairy.png",
  BIRD: "assets/generated/sprites/bird.png",
  WATER: "assets/generated/sprites/seel.png",
  BUG: "assets/generated/icons/bug.png",
  GRASS: "assets/generated/icons/plant.png",
  SNAKE: "assets/generated/icons/snake.png",
  QUADRUPED: "assets/generated/icons/quadruped.png",
};

/** The four icons that have their own sheet, and the two frames of each. */
const ICON_FRAMES: string[][] = [
  ["bug", "BugIconFrame1", "BugIconFrame2"],
  ["plant", "PlantIconFrame1", "PlantIconFrame2"],
  ["snake", "SnakeIconFrame1", "SnakeIconFrame2"],
  ["quadruped", "QuadrupedIconFrame1", "QuadrupedIconFrame2"],
];

/** Bytes per icon frame: two 8x8 tiles. */
const FRAME_BYTES = 32;

/** Decode both frames of one icon and mirror each into a 16x16 cell. */
function buildIconSheet(ctx: ExtractContext, labels: string[]) {
  const raw = new Uint8Array(FRAME_BYTES * labels.length);
  for (let i = 0; i < labels.length; i += 1) {
    const symbol = ctx.symbols.get(labels[i]);
    raw.set(
      ctx.rom.bytes(symbol.bank, symbol.address, FRAME_BYTES),
      i * FRAME_BYTES,
    );
  }
  const half = decode2bpp(raw, 8, 16 * labels.length, true);
  let image = newImage(16, 16 * labels.length, WHITE_CLEAR);
  for (let frame = 0; frame < labels.length; frame += 1) {
    const crop = cropImage(half, 0, frame * 16, 8, 16);
    image = pasteImage(image, crop, 0, frame * 16);
    image = pasteImage(image, flipHorizontal(crop), 8, frame * 16);
  }
  return image;
}

function build(ctx: ExtractContext): IconsDef {
  const table = ctx.symbols.get("MonPartyData");
  const dexOrder: string[] = ctx.manifest.dexOrder;
  const iconOrder: string[] = ctx.manifest.iconOrder;
  const count = dexOrder.length;

  const packed = ctx.rom.bytes(
    table.bank,
    table.address,
    Math.floor((count + 1) / 2),
  );
  const values = nybbles(packed, count);
  const byDex: string[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    byDex.push(
      value < iconOrder.length
        ? iconOrder[value]
        : "ICON_" + value.toString(16).toUpperCase(),
    );
  }

  for (let i = 0; i < ICON_FRAMES.length; i += 1) {
    const entry = ICON_FRAMES[i];
    emitImage(
      ctx,
      "icons/" + entry[0] + ".png",
      buildIconSheet(ctx, entry.slice(1)),
    );
  }

  const icons: { [iconId: string]: string } = {};
  const iconIds = Object.keys(ICON_IMAGES);
  for (let i = 0; i < iconIds.length; i += 1) {
    icons[iconIds[i]] = ICON_IMAGES[iconIds[i]];
  }

  return {
    source: "ROM:MonPartyData",
    byDex: byDex,
    icons: icons,
  };
}

export const builder: DatasetBuilder = {
  name: "icons",
  build: build,
};

export default builder;
