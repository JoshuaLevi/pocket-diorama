/**
 * field.json -- everything the overworld needs that is not a map or a battle.
 *
 * Port of `extract_field` in gen1recomp/tools/build_rom_data.py, the largest
 * single function in the reference. Almost all of its length is graphics: the
 * title screen, the intro cutscene, the slot machines, the fishing rod, the
 * emotion bubbles, the town map, THE END. The JSON it writes is small by
 * comparison, because the gates, ledges, spinners and trades it describes are
 * port metadata that assembly erased -- the manifest carries them, and this
 * builder passes them through with a `source` line attached.
 *
 * So the file splits cleanly in two: `emitFieldAssets` decodes the artwork
 * into the (optional) asset sink, and `build` produces the JSON contract. The
 * asset half still runs when no sink is attached, because every symbol lookup
 * in it is a check that the manifest and the cart agree -- the reference fails
 * in exactly these places on a wrong ROM, and so should we.
 *
 * Yellow-only branches are ported as guarded blocks that Red never enters:
 * the fixed-Pikachu title screen, the surfing minigame, and the "9" of
 * (c)1995-1999. They are marked where they appear.
 */

import { decode2bpp } from "../core/decode";
import type { DecodedImage } from "../core/decode";
import type { DatasetBuilder, ExtractContext } from "../registry";
import type { FieldDef, ManifestBlob } from "../types";
import {
  WHITE_CLEAR,
  WHITE_OPAQUE,
  cropImage,
  deepCloneJson,
  emitImage,
  flipHorizontal,
  getPixel,
  matteColor0,
  newImage,
  pasteImage,
  pixelEquals,
  read1bpp,
  read2bpp,
  setPixel,
} from "./graphics";
import { writeCompressedPic } from "./pokemon";

/** Straight 2bpp sheets: label, width, height, path, and decode flags. */
const FX_SHEETS: string[][] = [
  ["RedFishingRodTiles", "8", "24", "fx/fishing_rod.png"],
  ["RedFishingTilesSide", "16", "8", "fx/red_fish_side.png"],
  ["RedFishingTilesFront", "16", "8", "fx/red_fish_front.png"],
  ["RedFishingTilesBack", "16", "8", "fx/red_fish_back.png"],
  ["PokeCenterFlashingMonitorAndHealBall", "8", "16", "fx/heal_machine.png"],
  ["SSAnneSmokePuffTile", "8", "8", "fx/smoke.png"],
];

/** Which tile of the presents strip each cell of "GAME FREAK" reuses. */
const GAMEFREAK_TEXT_TILES: number[] = [0, 1, 2, 3, -1, 4, 5, 3, 1, 6];

/** The two MoveAnimationTiles1 tiles the intro's big star is built from. */
const BIG_STAR_TILES: number[] = [3, 19];

/** Emotion bubbles, in the order they sit on the 48x16 strip. */
const EMOTE_LABELS: string[] = ["ShockEmote", "QuestionEmote", "HappyEmote"];

/** Decode a sheet and hand it straight to the sink. */
function emit2bpp(
  ctx: ExtractContext,
  label: string,
  width: number,
  height: number,
  relative: string,
  options?: { transparent?: boolean; matte?: boolean; columns?: boolean; storedLength?: number },
): DecodedImage {
  const image = read2bpp(ctx, label, width, height, options);
  emitImage(ctx, relative, image);
  return image;
}

function emit1bpp(
  ctx: ExtractContext,
  label: string,
  width: number,
  height: number,
  relative: string,
  transparent: boolean = false,
): DecodedImage {
  const image = read1bpp(ctx, label, width, height, transparent);
  emitImage(ctx, relative, image);
  return image;
}

/** Title screen: the logo, the version wordmark, the player, the credits. */
function emitTitle(ctx: ExtractContext): void {
  emit2bpp(ctx, "PokemonLogoGraphics", 128, 56, "title/pokemon_logo.png");
  emit1bpp(ctx, "Version_GFX", 80, 8, "title/red_version.png");
  emit2bpp(ctx, "PlayerCharacterTitleGraphics", 40, 56, "title/player.png", {
    matte: true,
  });
  emit2bpp(ctx, "NintendoCopyrightLogoGraphics", 152, 8, "title/copyright.png");
  emit2bpp(ctx, "GameFreakLogoGraphics", 72, 8, "title/gamefreak_inc.png");

  // Yellow only: the final "9" of (c)1995-1999 is parked in the sixteen bytes
  // between the Game Freak logo and the text box sheet. Red's two symbols are
  // not adjacent like that, so this never fires.
  const logo = ctx.symbols.tryGet("GameFreakLogoGraphics");
  const textBox = ctx.symbols.tryGet("TextBoxGraphics");
  if (
    logo !== null &&
    textBox !== null &&
    textBox.address === logo.address + 9 * 16 + 16
  ) {
    const nineRaw = ctx.rom.bytes(logo.bank, logo.address + 9 * 16, 16);
    emitImage(ctx, "title/nine.png", decode2bpp(nineRaw, 8, 8, false));
  }
}

/** The falling star, the Game Freak sting, the big star, the fight intro. */
function emitIntro(ctx: ExtractContext): void {
  const fallingStar = emit2bpp(ctx, "FallingStar", 8, 8, "intro/falling_star.png", {
    transparent: true,
  });
  // The blink frame keeps only the mid-grey pixels of the star.
  const blink = newImage(fallingStar.width, fallingStar.height, WHITE_CLEAR);
  for (let y = 0; y < fallingStar.height; y += 1) {
    for (let x = 0; x < fallingStar.width; x += 1) {
      const pixel = getPixel(fallingStar, x, y);
      if (pixel[3] !== 0 && pixel[0] === 170) {
        setPixel(blink, x, y, pixel);
      }
    }
  }
  emitImage(ctx, "intro/falling_star_blink.png", blink);

  const gamefreak = ctx.symbols.get("GameFreakIntro");
  const presentsLength = (104 * 8) / 4;
  const presents = decode2bpp(
    ctx.rom.bytes(gamefreak.bank, gamefreak.address, presentsLength),
    104,
    8,
    true,
  );
  emitImage(ctx, "intro/gamefreak_presents.png", presents);
  const logoRaw = ctx.rom.bytes(
    gamefreak.bank,
    gamefreak.address + presentsLength,
    (16 * 24) / 4,
  );
  emitImage(ctx, "intro/gamefreak_logo.png", decode2bpp(logoRaw, 16, 24, true));

  // "GAME FREAK" re-spells itself out of seven distinct glyphs.
  let textImage = newImage(80, 8, WHITE_CLEAR);
  for (let index = 0; index < GAMEFREAK_TEXT_TILES.length; index += 1) {
    const tile = GAMEFREAK_TEXT_TILES[index];
    if (tile < 0) {
      continue;
    }
    textImage = pasteImage(
      textImage,
      cropImage(presents, tile * 8, 0, 8, 8),
      index * 8,
      0,
    );
  }
  emitImage(ctx, "intro/gamefreak_text.png", textImage);

  const moveTiles = ctx.symbols.get("MoveAnimationTiles1");
  let star = newImage(16, 16, WHITE_CLEAR);
  for (let row = 0; row < BIG_STAR_TILES.length; row += 1) {
    const tileRaw = ctx.rom.bytes(
      moveTiles.bank,
      moveTiles.address + BIG_STAR_TILES[row] * 16,
      16,
    );
    const tile = decode2bpp(tileRaw, 8, 8, true);
    star = pasteImage(star, tile, 0, row * 8);
    star = pasteImage(star, flipHorizontal(tile), 8, row * 8);
  }
  emitImage(ctx, "intro/big_star.png", star);

  emitGengar(ctx);
  emitNidorino(ctx);

  // The five portraits the intro cutscene shows in the fight-intro sequence:
  // Oak, the rival, Red's own front sprite (carried in the bundle as
  // "player", matching outTitle's key for the same character), and the two
  // frames of the shrinking-Pokeball effect. All five are lz3 pictures like a
  // species' battle sprite, so this reuses pokemon.ts's writeCompressedPic
  // rather than re-implementing decompress + matte + emit a third time here.
  writeCompressedPic(ctx, "ProfOakPic", "intro/oak.png");
  writeCompressedPic(ctx, "Rival1Pic", "intro/rival1.png");
  writeCompressedPic(ctx, "RedPicFront", "intro/red.png");
  writeCompressedPic(ctx, "ShrinkPic1", "intro/shrink1.png");
  writeCompressedPic(ctx, "ShrinkPic2", "intro/shrink2.png");
}

/**
 * The Gengar silhouette, drawn three times from one 96-tile sheet.
 *
 * Yellow replaces this cutscene outright and defines none of the symbols; the
 * reference still writes blank 56x56 frames there so the intro loader has
 * something to load, and so do we.
 */
function emitGengar(ctx: ExtractContext): void {
  if (!ctx.symbols.has("FightIntroBackMon")) {
    for (let number = 1; number <= 3; number += 1) {
      emitImage(
        ctx,
        "intro/gengar_" + number + ".png",
        newImage(56, 56, [0, 0, 0, 0]),
      );
    }
    return;
  }
  const sheet = ctx.symbols.get("FightIntroBackMon");
  const raw = ctx.rom.bytes(sheet.bank, sheet.address, 96 * 16);
  const tiles: DecodedImage[] = [];
  for (let index = 0; index * 16 < raw.length; index += 1) {
    tiles.push(decode2bpp(raw.subarray(index * 16, index * 16 + 16), 8, 8));
  }
  for (let number = 1; number <= 3; number += 1) {
    const tilemap = ctx.symbols.get("GengarIntroTiles" + number);
    const tileIds = ctx.rom.bytes(tilemap.bank, tilemap.address, 49);
    let pose = newImage(56, 56, [0, 0, 0, 0]);
    for (let index = 0; index < tileIds.length; index += 1) {
      pose = pasteImage(
        pose,
        tiles[tileIds[index]],
        (index % 7) * 8,
        Math.floor(index / 7) * 8,
      );
    }
    emitImage(ctx, "intro/gengar_" + number + ".png", matteColor0(pose));
  }
}

/** The Nidorino poses, stored column-major. Blank on Yellow, as above. */
function emitNidorino(ctx: ExtractContext): void {
  const labels = [
    "FightIntroFrontMon",
    "FightIntroFrontMon2",
    "FightIntroFrontMon3",
  ];
  if (!ctx.symbols.has(labels[0])) {
    for (let number = 1; number <= 3; number += 1) {
      emitImage(
        ctx,
        "intro/red_nidorino_" + number + ".png",
        newImage(48, 48, WHITE_CLEAR),
      );
    }
    return;
  }
  for (let index = 0; index < labels.length; index += 1) {
    emit2bpp(
      ctx,
      labels[index],
      48,
      48,
      "intro/red_nidorino_" + (index + 1) + ".png",
      { transparent: true, columns: true },
    );
  }
}

/** Slot machine reels, plus the symbol strip cut out of the second sheet. */
function emitSlots(ctx: ExtractContext): void {
  emit2bpp(ctx, "SlotMachineTiles1", 128, 24, "slots/red_slots_1.png", {
    storedLength: 0x250,
  });
  const sheet = emit2bpp(ctx, "SlotMachineTiles2", 32, 48, "slots/red_slots_2.png");

  // The sheet is stored opaque; the strip wants white knocked out.
  const clear: DecodedImage = {
    width: sheet.width,
    height: sheet.height,
    pixels: sheet.pixels.slice(),
  };
  for (let y = 0; y < clear.height; y += 1) {
    for (let x = 0; x < clear.width; x += 1) {
      if (pixelEquals(clear, x, y, WHITE_OPAQUE)) {
        setPixel(clear, x, y, WHITE_CLEAR);
      }
    }
  }

  const slotSymbols: ManifestBlob = ctx.manifest.field.slotSymbols;
  const order: string[] = slotSymbols.order;
  let strip = newImage(16 * order.length, 16, WHITE_CLEAR);
  for (let index = 0; index < order.length; index += 1) {
    // Each symbol packs its top tile in the high byte, bottom in the low.
    const value: number = slotSymbols.symbols[order[index]].tiles;
    const rows = [value >> 8, value & 0xff];
    for (let row = 0; row < rows.length; row += 1) {
      const tile = rows[row];
      const x = (tile % 4) * 8;
      const y = Math.floor(tile / 4) * 8;
      strip = pasteImage(
        strip,
        cropImage(clear, x, y, 16, 8),
        index * 16,
        row * 8,
      );
    }
  }
  emitImage(ctx, "slots/symbols.png", strip);
}

/** Bubbles, fishing, the healing machine, the HUD, the town map, THE END. */
function emitOverworldFx(ctx: ExtractContext): void {
  let emotes = newImage(48, 16, WHITE_CLEAR);
  for (let index = 0; index < EMOTE_LABELS.length; index += 1) {
    const symbol = ctx.symbols.get(EMOTE_LABELS[index]);
    const image = decode2bpp(
      ctx.rom.bytes(symbol.bank, symbol.address, 64),
      16,
      16,
      true,
    );
    emotes = pasteImage(emotes, image, index * 16, 0);
  }
  emitImage(ctx, "emotes.png", emotes);

  emit1bpp(ctx, "LedgeHoppingShadow", 8, 8, "fx/shadow.png", true);
  for (let index = 0; index < FX_SHEETS.length; index += 1) {
    const entry = FX_SHEETS[index];
    emit2bpp(ctx, entry[0], Number(entry[1]), Number(entry[2]), entry[3], {
      transparent: true,
    });
  }
  emit2bpp(ctx, "BattleTransitionTile", 8, 8, "fx/battle_transition.png");
  emit2bpp(ctx, "PokedexTileGraphics", 24, 48, "fx/pokedex.png");

  emit2bpp(ctx, "HpBarAndStatusGraphics", 120, 16, "battle/font_battle_extra.png", {
    transparent: true,
  });
  for (let number = 1; number <= 3; number += 1) {
    emit1bpp(
      ctx,
      "BattleHudTiles" + number,
      24,
      8,
      "battle/battle_hud_" + number + ".png",
      true,
    );
  }

  // THE END is stored as five interleaved 32-byte columns: the top half of
  // each column first, then the bottom, so a straight read comes out sheared.
  const theEnd = ctx.symbols.get("TheEndGfx");
  const interleaved = ctx.rom.bytes(theEnd.bank, theEnd.address, 160);
  const reordered = new Uint8Array(160);
  for (let column = 0; column < 5; column += 1) {
    reordered.set(
      interleaved.subarray(column * 32, column * 32 + 16),
      column * 16,
    );
    reordered.set(
      interleaved.subarray(column * 32 + 16, column * 32 + 32),
      (column + 5) * 16,
    );
  }
  emitImage(ctx, "credits/the_end.png", decode2bpp(reordered, 40, 16));

  emit2bpp(ctx, "WorldMapTileGraphics", 32, 32, "townmap/tiles.png");
  emit1bpp(ctx, "TownMapCursor", 16, 16, "townmap/cursor.png", true);
}

/**
 * Decode every image the field metadata refers to.
 *
 * Yellow's fixed-Pikachu title screen and surfing minigame are deliberately
 * not ported: both are guarded in the reference by symbols Red does not
 * define (TitlePikachuBGGraphics, SurfingPikachu1Graphics1), so neither
 * branch is reachable from the ROM this project accepts, and neither could be
 * verified against the golden output.
 */
function emitFieldAssets(ctx: ExtractContext): void {
  emitTitle(ctx);
  emitIntro(ctx);
  emitSlots(ctx);
  emitOverworldFx(ctx);
}

function build(ctx: ExtractContext): FieldDef {
  emitFieldAssets(ctx);

  // The reference deep-copies the manifest section and stamps a source line on
  // it. It also rewrites the trash-can adjacency keys from strings to ints on
  // the way through Lua; a JSON object key is a string either way, and the
  // manifest already stores them normalised, so that conversion is a no-op.
  const data = deepCloneJson(ctx.manifest.field) as FieldDef;
  data.source = "canonical Pokemon Red ROM + bundled port metadata";
  return data;
}

export const builder: DatasetBuilder = {
  name: "field",
  build: build,
};

export default builder;
