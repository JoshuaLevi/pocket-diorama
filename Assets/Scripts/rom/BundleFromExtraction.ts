// Extraction output in, the world bundle the renderer already eats out.
//
// tools/build_bundle.py does exactly this on a desktop. This is the same steps in
// the same order so the two paths agree, and everything downstream cannot tell
// whether its world came off a laptop or out of the cartridge in the room.
//
// The heavy lifting is turning decoded RGBA back into the 2-bit shade indices the
// bundle stores. That looks wasteful and is not: the bundle has to carry palettes
// separately anyway, because a tile is coloured by what it IS rather than by which
// map it sits on, and shade indices are a quarter the size of the pixels.

import { packAlpha, packShades } from "./WorldFromRom";
import { fillBodyRgba } from "./BodyMatte";
import type { ExtractionResult } from "./WorldFromRom";
import { emptyCryBank } from "../audio/CryBank";
import type { CryBankData } from "../audio/CryBank";
import { emptyAudioBank } from "../audio/AudioBank";
import type { AudioBankData } from "../audio/AudioBank";

/**
 * The world's colours, sampled from the reference footage rather than chosen.
 * Frames where the world fills the screen, quantised and taken by area:
 * #78b400 and #649600 the grass, #dcc896 the sand.
 * Four Game Boy shades each, lightest first.
 *
 * PATH was #6e46b4, a violet, and it was sampled the same way -- it really is
 * the colour the reference paints its paths. It does not survive the move to
 * our diorama, and the 11 September captures say why: the reference lays long
 * connected stretches of it, while tile 57 in Kanto is the open ground INSIDE
 * a town, interleaved cell by cell with the grass tile. A long violet road
 * reads as a road; the same violet dithered through a lawn reads as damage.
 * Joshua chose trodden earth on 11 September after seeing both.
 *
 * It is deliberately not SAND's ramp, though it is close to it: a beach and a
 * town square should not be the same colour, so this one is cooler and a step
 * darker. SAND stays in the table and is still emitted by no tileset in the
 * cartridge -- a slot kept for the day one needs it, not a colour in use.
 */
import { TILE_PALETTES } from "../world/TilePalettes";
export { TILE_PALETTES };

/**
 * Which ground a tileset stands on.
 *
 * The ledge table and the cut-tree swaps are OVERWORLD tile ids, so they are
 * only meaningful there: applied by raw index to an interior sheet they painted
 * Red's window frames forest green. A tile id means nothing outside its own
 * tileset -- the same rule the Cut gate learned.
 */
const OUTDOOR_TILESETS: string[] = ["OVERWORLD", "FOREST", "PLATEAU"];
const CAVE_TILESETS: string[] = ["CAVERN", "UNDERGROUND"];

/**
 * What a BLOCKED tile is made of, when no table of the ROM's own answers.
 *
 * The ledge and cut-tree tables are OVERWORLD tile ids, so outside that one
 * sheet there is nothing to read and everything fell through to STRUCTURE --
 * the building cream. Measured over the bundle that painted 84 of FOREST's 96
 * tiles and 76 of PLATEAU's 80 as buildings: 54% of Viridian Forest was drawn
 * in the colour of a Pokemon Center, and the 11 September capture of it reads
 * as warehouse shelving rather than as woodland.
 *
 * A tileset is not a guess, though. The cartridge ships FOREST for Viridian
 * Forest and the four Safari Zone maps -- woodland, all five -- and PLATEAU
 * for Indigo Plateau and Route 23, which are cut rock. So the default is the
 * sheet's own name, and it is one line per sheet rather than a hand-pinned
 * tile table we would have to maintain for 2,160 tiles.
 *
 * It moves SHAPE as well as colour, and that is the point: TREE is not in
 * Structures' UPRIGHT_CATEGORIES, so a forest tile stops being folded into a
 * measured volume and gets the canopy hull TileShapes already has for it.
 * ROCK stays upright, because a cliff is a mass.
 */
const BLOCKED_BY_TILESET: any = { FOREST: "TREE", PLATEAU: "ROCK" };

function listHas(list: string[], value: string): boolean {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

/** Overworld tiles whose category cannot be read off the ROM's own tables. */
const OVERWORLD_EXPLICIT: any = {
  "82": "TALL_GRASS",
  "57": "PATH",
  "44": "GRASS",
  "20": "WATER",
  // The 2x2 blob the border block is made of, which is every town's and every
  // route's edge. It fell through to STRUCTURE, which drew Kanto's treeline in
  // building cream. The cuttable trees already arrive via `trees`.
  "42": "TREE",
  "43": "TREE",
  "58": "TREE",
  "59": "TREE",
  // The other tree: the 2x2 round canopy that fills the woods round Viridian
  // Forest on Route 2 (458 blocks of it) and the groves of Fuchsia. It is on
  // no cut-tree list, so it fell through to STRUCTURE and Route 2's wood was
  // folded up as a row of cream buildings (29 September).
  "64": "TREE",
  "65": "TREE",
  "80": "TREE",
  "81": "TREE",
  // Mountain. 17 is the cliff face of Route 3, Route 4 and every mountain
  // pass -- 12,272 tiles of Kanto -- and 1 and 36 its lighter and darker
  // courses. All of it was STRUCTURE, so Mt Moon's approach was a terrace
  // of gabled houses. (Tile 3 is not rock: it is the bush the hedge rule
  // in TileShapes reads off STRUCTURE, and stays there.)
  "17": "ROCK",
  "1": "ROCK",
  "36": "ROCK",
};

import { paletteFor } from "../world/MapPalette";

function contains(list: number[], value: number): boolean {
  if (!list) return false;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

/** A category per tile index, from the ROM's tables where they exist. */
function tileCategories(tileset: any, ledges: number[], trees: number[]): string[] {
  const across = Math.floor(tileset.imageWidth / 8);
  const down = Math.floor(tileset.imageHeight / 8);
  const isOverworld = tileset.id === "OVERWORLD";
  const outdoor = listHas(OUTDOOR_TILESETS, tileset.id);
  const cave = listHas(CAVE_TILESETS, tileset.id);
  const out: string[] = [];
  for (let tile = 0; tile < across * down; tile++) {
    const explicit = isOverworld ? OVERWORLD_EXPLICIT[String(tile)] : null;
    const isDoor =
      contains(tileset.doorTiles, tile) || contains(tileset.warpTiles, tile);
    // If you can stand on it, it is GROUND, and no table outranks that.
    //
    // The cut-tree table lists tile 60, which is also in `walkable`: it is the
    // plank of a bridge, and it shares an id with a tree the axe can take. So
    // it was painted tree-green on every cell it covers -- 672 of them, 398 on
    // ROUTE_12 alone, where 396 of the route's 662 walkable cells were the
    // colour of a canopy. Vermilion's pier, Nugget Bridge and the sea routes
    // are the rest of the list.
    //
    // It is the exact inversion of the rule Legibility.ts exists to keep -- a
    // wearer must be able to tell ground from what blocks them -- so the
    // walkable set wins over the ledge and tree tables here, not after them.
    // A door is the one thing that stays: it is walkable and it is drawn in a
    // building's wall, so it is coloured as the wall it is cut into.
    const walkable = contains(tileset.walkable, tile);
    if (explicit) {
      out.push(explicit);
    } else if (tile === tileset.grassTile) {
      out.push("TALL_GRASS");
    } else if (isOverworld && !walkable && contains(ledges, tile)) {
      out.push("LEDGE");
    } else if (isOverworld && !walkable && contains(trees, tile)) {
      out.push("TREE");
    } else if (isDoor) {
      out.push(outdoor || cave ? "STRUCTURE" : "DOOR");
    } else if (walkable) {
      out.push(outdoor ? "GRASS" : cave ? "DIRT" : "FLOOR");
    } else if (BLOCKED_BY_TILESET[tileset.id]) {
      out.push(BLOCKED_BY_TILESET[tileset.id]);
    } else {
      out.push(outdoor ? "STRUCTURE" : cave ? "ROCK" : "WALL");
    }
  }
  return out;
}

/**
 * The decoded pixels for an image path a dataset names.
 *
 * Datasets do not agree on the extension they emit under: some keep the golden
 * PNG's path verbatim, others swap it for `.rgba`. Rather than encode which does
 * which -- a table that would rot the first time a dataset changed its mind --
 * both are tried. Guessing one and returning nothing is how every tileset came
 * out missing on the first run.
 */
export interface DecodedAsset {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * Unwraps the extractor's raw-pixel container: "PXRGBA01", then width and height
 * as little-endian uint16, then the RGBA bytes. Reading the header as pixels is
 * what made every tile sheet come out as three rows of garbage followed by the
 * real image, which packs into something that looks like data.
 */
function decodeRgbaContainer(bytes: Uint8Array): DecodedAsset {
  if (!bytes || bytes.length < 12) {
    return null;
  }
  const width = bytes[8] | (bytes[9] << 8);
  const height = bytes[10] | (bytes[11] << 8);
  if (width <= 0 || height <= 0 || 12 + width * height * 4 > bytes.length) {
    return null;
  }
  return { width: width, height: height, pixels: bytes.subarray(12) };
}

function assetFor(assets: any, imagePath: string): Uint8Array {
  if (!imagePath) {
    return null;
  }
  const prefix = "assets/generated/";
  let relative = imagePath;
  if (relative.indexOf(prefix) === 0) {
    relative = relative.substring(prefix.length);
  }
  // Raw pixels FIRST. Some datasets emit both, under the golden PNG's path and
  // under a .rgba twin, and preferring the literal path hands back encoded PNG
  // bytes -- which pack into convincing nonsense rather than failing loudly.
  const dot = relative.lastIndexOf(".");
  const stem = dot < 0 ? relative : relative.substring(0, dot);
  if (assets[stem + ".rgba"]) {
    return assets[stem + ".rgba"];
  }
  return assets[relative] ? assets[relative] : null;
}

/**
 * The two tile ids Gen 1's engine animates in place, whenever the active
 * tileset's own header says to -- not read from any per-tileset ROM table
 * (the Tilesets header has room for a blockset, a tile sheet, a collision
 * list, three counter tiles and a grass tile, and nothing else): the engine
 * hardcodes these two indices and rewrites whichever tileset's OWN sheet is
 * loaded. Measured tools/oracle, GAME BOY mode pass 2: PyBoy's VRAM at Pallet
 * Town's pond never touched any tile id other than these two over a 500-frame
 * watch, on the OVERWORLD tileset; DOJO/GYM (also TILEANIM_WATER_FLOWER) and
 * FOREST/CAVERN/SHIP/SHIP_PORT/FACILITY/PLATEAU (TILEANIM_WATER) were not
 * independently pixel-checked, but run the identical engine routine off the
 * same WRAM counter, so the same ids apply.
 */
const WATER_ANIM_TILE: number = 0x14;
const FLOWER_ANIM_TILE: number = 0x03;

/** An 8x8 RGBA slice out of a larger sheet, `packShades`-able on its own. */
function subTileRgba(rgba: Uint8Array, sheetWidthPx: number, tileIndex: number, tilesPerRow: number): Uint8Array {
  const sx = (tileIndex % tilesPerRow) * 8;
  const sy = Math.floor(tileIndex / tilesPerRow) * 8;
  const out = new Uint8Array(8 * 8 * 4);
  for (let row = 0; row < 8; row++) {
    const srcStart = ((sy + row) * sheetWidthPx + sx) * 4;
    for (let i = 0; i < 8 * 4; i++) {
      out[row * 8 * 4 + i] = rgba[srcStart + i];
    }
  }
  return out;
}

/**
 * tileset.animation -- see the field's own doc comment in WorldData.ts. null
 * for a tileset whose ROM header names TILEANIM_NONE; `sheetRgba` is the SAME
 * decoded pixels the caller already has for the tileset's own sheet, since
 * the water tile's shipped/rest graphic is right there in it (confirmed:
 * OVERWORLD's tile 0x14 in the extracted sheet decodes to exactly the
 * bitmap PyBoy showed at WRAM counter 0 -- tools/oracle, GAME BOY mode
 * pass 2), so no second ROM read is needed for it. The flower frames are a
 * separate ROM table (rom/datasets/tilesets.ts's emitAnimationTiles), fetched
 * by the same asset path the golden PNGs use.
 */
function tilesetAnimationFor(ts: any, sheetRgba: Uint8Array, tilesPerRow: number, assets: any): any {
  const kind = ts.animation;
  if (kind !== "TILEANIM_WATER" && kind !== "TILEANIM_WATER_FLOWER") {
    return null;
  }
  const waterFrame = packShades(subTileRgba(sheetRgba, ts.imageWidth, WATER_ANIM_TILE, tilesPerRow), 64);
  if (kind !== "TILEANIM_WATER_FLOWER") {
    return { waterTile: WATER_ANIM_TILE, waterFrame: waterFrame, flowerTile: -1, flowerFrames: null };
  }
  const flowerFrames: string[] = [];
  for (let frame = 1; frame <= 3; frame++) {
    const decoded = decodeRgbaContainer(assetFor(assets, "tilesets/flower" + frame + ".png"));
    flowerFrames.push(decoded ? packShades(decoded.pixels, 64) : "");
  }
  return { waterTile: WATER_ANIM_TILE, waterFrame: waterFrame, flowerTile: FLOWER_ANIM_TILE, flowerFrames: flowerFrames };
}

/**
 * Builds the bundle the renderer consumes.
 *
 * `mapIds` limits which maps are carried. Passing null carries all 222, which is
 * about 770 KB and comfortably inside the lens's 125 MB of persistent storage.
 */
export function bundleFromExtraction(
  extraction: ExtractionResult,
  romSha1: string,
  mapIds: string[],
  cries?: CryBankData,
  audio?: AudioBankData,
): any {
  const d = extraction.datasets;
  const assets = extraction.assets;

  const ledges: number[] = [];
  const trees: number[] = [];
  if (d.field) {
    const ledgeRows = d.field.ledges;
    for (let i = 0; ledgeRows && i < ledgeRows.length; i++) {
      ledges.push(ledgeRows[i].ledgeTile);
    }
    const treeRows = d.field.cutTreeSwaps;
    for (let i = 0; treeRows && i < treeRows.length; i++) {
      trees.push(treeRows[i].before);
    }
  }

  const wanted = mapIds && mapIds.length > 0 ? mapIds : Object.keys(d.maps);

  const outMaps: any = {};
  const usedTilesets: string[] = [];
  for (let i = 0; i < wanted.length; i++) {
    const id = wanted[i];
    const m = d.maps[id];
    if (!m) {
      continue;
    }
    outMaps[id] = {
      id: id,
      // text_pointers is keyed by this, so dialogue needs it.
      label: m.label,
      palette: paletteFor(id, m.tileset),
      width: m.width,
      height: m.height,
      blocks: m.blocks,
      borderBlock: m.borderBlock,
      tileset: m.tileset,
      connections: m.connections,
      warps: m.warps,
      signs: m.signs,
      objects: m.objects,
    };
    if (usedTilesets.indexOf(m.tileset) < 0) {
      usedTilesets.push(m.tileset);
    }
  }

  const outTilesets: any = {};
  for (let i = 0; i < usedTilesets.length; i++) {
    const id = usedTilesets[i];
    const ts = d.tilesets[id];
    const decoded = decodeRgbaContainer(assetFor(assets, ts.image));
    if (!ts || !decoded) {
      print("[BundleFromExtraction] no pixels for tileset " + id);
      continue;
    }
    const rgba = decoded.pixels;
    const pixels = ts.imageWidth * ts.imageHeight;
    outTilesets[id] = {
      id: id,
      blocks: ts.blocks,
      walkable: ts.walkable,
      grassTile: ts.grassTile === undefined ? -1 : ts.grassTile,
      warpTiles: ts.warpTiles ? ts.warpTiles : [],
      doorTiles: ts.doorTiles ? ts.doorTiles : [],
      counterTiles: ts.counterTiles ? ts.counterTiles : [],
      tilesPerRow: ts.tilesPerRow,
      tileWidth: ts.imageWidth,
      tileHeight: ts.imageHeight,
      shades: packShades(rgba, pixels),
      animation: tilesetAnimationFor(ts, rgba, ts.tilesPerRow, assets),
      categories: tileCategories(ts, ledges, trees),
    };
  }

  // Only the sprites the shipped maps actually place, plus the player's
  // three: on foot, on the BICYCLE (RedBikeSprite, which the extractor
  // decodes outside the pointer table) and on the water, where the player is
  // drawn as the SEEL sheet. See play/PlayerSprite.ts.
  const wantedSprites: string[] = ["SPRITE_RED", "SPRITE_RED_BIKE", "SPRITE_SEEL"];
  for (let i = 0; i < wanted.length; i++) {
    const m = d.maps[wanted[i]];
    for (let k = 0; m && k < m.objects.length; k++) {
      const name = m.objects[k].sprite;
      if (name && wantedSprites.indexOf(name) < 0) {
        wantedSprites.push(name);
      }
    }
  }

  const outSprites: any = {};
  for (let i = 0; i < wantedSprites.length; i++) {
    const id = wantedSprites[i];
    const spec = d.sprites[id];
    if (!spec) {
      continue;
    }
    const decoded = decodeRgbaContainer(assetFor(assets, spec.image));
    if (!decoded) {
      continue;
    }
    // The container carries its own dimensions, so nothing has to be inferred.
    const rgba = decoded.pixels;
    const width = decoded.width;
    const height = decoded.height;
    const pixels = width * height;
    outSprites[id] = {
      id: id,
      frames: spec.frames,
      walker: spec.walker === true,
      width: width,
      height: height,
      shades: packShades(rgba, pixels),
      alpha: packAlpha(rgba, pixels),
    };
  }

  // Every species that HAS a portrait gets one.
  //
  // This used to be filtered to the species in the shipped maps' wild encounter
  // tables, which is wrong in a way that only shows up in a battle: the three
  // starters appear in no encounter table on any map, so the Pokemon the player
  // actually owns was the one with no picture. Trainer-owned species have the
  // same hole -- a rival's Squirtle is not wild anywhere either.
  //
  // Enumerating the exceptions (starters, then trainer rosters, then everything
  // those evolve into) reintroduces the same bug the next time something becomes
  // reachable by a route nobody listed. The filter existed to keep the bundle
  // small; 151 portraits instead of 78 costs a few hundred kilobytes against a
  // 125 MB store, which is not a trade worth a class of silent bugs.

  const outSpecies: any = {};
  const speciesNames = Object.keys(d.pokemon);
  for (let i = 0; i < speciesNames.length; i++) {
    const name = speciesNames[i];
    const spec = d.pokemon[name];
    if (!spec || typeof spec !== "object" || spec.baseStats === undefined) {
      continue;
    }
    const entry: any = {
      id: name,
      name: spec.name ? spec.name : name,
      index: spec.index,
      dex: spec.dex,
      types: spec.types ? spec.types : [],
      baseStats: spec.baseStats,
      catchRate: spec.catchRate,
      baseExp: spec.baseExp,
      growthRate: spec.growthRate,
      level1Moves: spec.level1Moves ? spec.level1Moves : [],
      learnset: spec.learnset ? spec.learnset : [],
      evolutions: spec.evolutions ? spec.evolutions : [],
      // The TM/HM machines this species can learn: the cartridge's 55-bit field
      // in the base stats, decoded by the extractor and dropped here until the
      // day something wanted to teach a move.
      tmhm: spec.tmhm ? spec.tmhm : [],
    };
    // The Pokedex data page's own fields -- category, height, weight -- and
    // the label of its two-page description. pokered's PokedexEntryPointers
    // table, already decoded by dexEntry() in datasets/pokemon.ts and carried
    // as spec.dexEntry; dropped on the way into the bundle until now, which
    // is why a starter ball could show the picture and the number but not
    // what it is or how big (FINDINGS.md, "The starter's Pokedex page is not
    // shown"). Guarded: an older extraction result predates dexEntry.
    if (spec.dexEntry) {
      entry.category = spec.dexEntry.kind;
      entry.heightFeet = spec.dexEntry.heightFt;
      entry.heightInches = spec.dexEntry.heightIn;
      entry.weightTenths = spec.dexEntry.weight;
      // The description's label into bundle.text, e.g. "_CharmanderDexEntry" --
      // already there (scriptText's job resolves it like any other line), but
      // nothing previously pointed a species entry at its own.
      entry.dexText = spec.dexEntry.text;
    }
    // Both battle pictures. The extractor has always decoded and written the
    // pair (datasets/pokemon.ts writes battle/front and battle/back); only the
    // front one was carried into the bundle, so a battle could draw whoever you
    // were facing and nothing of your own Pokemon, which is the view the
    // cartridge actually gives you of it. A back pic is 32x32 against the
    // front's 40x40 and costs about half as much.
    const pics = [
      ["front", spec.spriteFront],
      ["back", spec.spriteBack],
    ];
    for (let p = 0; p < pics.length; p++) {
      const path: string = pics[p][1] as string;
      if (!path) {
        continue;
      }
      const decoded = decodeRgbaContainer(assetFor(assets, path));
      if (decoded) {
        const count = decoded.width * decoded.height;
        // A back picture is a sketch the cartridge only ever showed on white;
        // its open outline lets the extractor's flood matte hollow it out.
        // The body is put back here (BodyMatte.ts), not in the extractor,
        // whose PNGs are compared byte for byte against gen1recomp's.
        const pixels = pics[p][0] === "back"
          ? fillBodyRgba(decoded.pixels, decoded.width, decoded.height)
          : decoded.pixels;
        entry[pics[p][0] as string] = {
          width: decoded.width,
          height: decoded.height,
          shades: packShades(pixels, count),
          alpha: packAlpha(pixels, count),
        };
      }
    }
    // The species' own Super Game Boy palette (MonsterPalettes: Pikachu is
    // YELLOWMON, Charmander REDMON), read by the extractor since the first
    // bake and dropped here, so every Pokemon on the field wore the ROUTE
    // greens of the map. BattleActors paints with it; older bundles have none
    // and fall back as before.
    if (d.palettes && d.palettes.pokemon && d.palettes.pokemon[name]) {
      entry.palette = d.palettes.pokemon[name];
    }
    outSpecies[name] = entry;
  }

  const outEncounters: any = {};
  const encounterKeys = Object.keys(d.encounters);
  for (let i = 0; i < encounterKeys.length; i++) {
    if (outMaps[encounterKeys[i]]) {
      outEncounters[encounterKeys[i]] = d.encounters[encounterKeys[i]];
    }
  }

  // Trainer rosters, without the desktop-only fields.
  //
  // A trainer battle cannot start without these: the map object carries only the
  // class ("OPP_BROCK") and a 1-based party index, and the party itself lives
  // here. They were extracted all along and then dropped on the way into the
  // bundle, which is why `start_battle` in the ported scripts had nothing to
  // resolve against. `pic` and `source` are left out -- the first is a desktop
  // file path, the second is provenance for the golden diff.
  const outTrainers: any = {};
  const trainerIds = d.trainers ? Object.keys(d.trainers) : [];
  for (let i = 0; i < trainerIds.length; i++) {
    const t = d.trainers[trainerIds[i]];
    outTrainers[trainerIds[i]] = {
      id: t.id,
      name: t.name,
      index: t.index,
      baseMoney: t.baseMoney,
      aiMods: t.aiMods,
      parties: t.parties,
    };
  }

  // Item names and prices for bags and marts, without extraction provenance.
  const outItems: any = {};
  const itemIds = d.items ? Object.keys(d.items) : [];
  for (let i = 0; i < itemIds.length; i++) {
    const item = d.items[itemIds[i]];
    const outItem: any = {
      id: item.id,
      name: item.name,
      price: item.price,
    };
    // A TM or HM carries its move; a key item says so. Both absent otherwise,
    // like MapObject.hidden: read them through machineOf() and keyItem === true.
    if (item.machine) {
      outItem.machine = item.machine;
    }
    if (item.keyItem === true) {
      outItem.keyItem = true;
    }
    outItems[itemIds[i]] = outItem;
  }

  // In-game trades are script operands: the script carries only a 1-based row
  // number and the completion flag, while both species and the received
  // nickname live in field.trades. Dropping this table leaves a valid-looking
  // `trade` command with nothing to resolve against at runtime.
  const outTrades: any[] = [];
  const tradeRows = d.field && d.field.trades ? d.field.trades : [];
  for (let i = 0; i < tradeRows.length; i++) {
    const trade = tradeRows[i];
    outTrades.push({
      give: trade.give,
      get: trade.get,
      nickname: trade.nickname,
      dialogset: trade.dialogset,
    });
  }

  // The glyph sheet, packed the way tiles are.
  //
  // Left out of the first version of this function, which only showed up when
  // the message box came to be built on a headset and reported "no font in the
  // bundle; dialogue will be invisible". Nothing in the suite noticed, because
  // nothing asserted the bundle HAS a font -- the python baker emitted one and
  // the tests only ever compared the two bakers' species counts.
  let outFont: any = null;
  if (d.font) {
    const glyphs = decodeRgbaContainer(assetFor(assets, d.font.image));
    if (glyphs) {
      const count = glyphs.width * glyphs.height;
      // The second sheet: the text box border, the naming underscores and
      // the dex tiles, at codes $60-$7F. Without it a box on the boot
      // screens has no frame, which is what the title screen was missing.
      const extra = decodeRgbaContainer(assetFor(assets, d.font.imageExtra));
      outFont = {
        glyphsPerRow: d.font.glyphsPerRow,
        mainBase: d.font.mainBase,
        extraBase: d.font.extraBase,
        charmap: d.font.charmap,
        width: glyphs.width,
        height: glyphs.height,
        shades: packShades(glyphs.pixels, count),
        extraWidth: extra ? extra.width : 0,
        extraHeight: extra ? extra.height : 0,
        extraShades: extra ? packShades(extra.pixels, extra.width * extra.height) : "",
      };
    }
  }

  // The title screen's art, straight out of the cartridge: the logo, the
  // version ribbon, Red with his ball, and the two copyright lines. The field
  // dataset emits them under the golden paths; here they become shade images
  // like every other graphic, so the lens never sees a PNG.
  // The battle HUD's own tiles: the HP bar and the frame around each block.
  //
  // These are NOT the font. wTileMap addresses them at $62..$7F, which is the
  // same range the text box's border lives in, and during a battle the
  // cartridge loads these OVER it -- fontBattleExtra across the whole range,
  // then hud1/2/3 on top of three short stretches of it. Drawing them from the
  // font sheet instead is what put "CLLLLLL:" where an HP bar belongs and a row
  // of kana where the frame belongs, which is what the 8 September preview
  // showed.
  //
  // The field dataset emits them under the golden paths; here they become
  // shade images like every other graphic, so the lens never sees a PNG.
  const battleHudNames = [
    ["fontBattleExtra", "font_battle_extra"],
    ["hud1", "battle_hud_1"], ["hud2", "battle_hud_2"], ["hud3", "battle_hud_3"],
  ];
  const outBattleHud: any = {};
  for (let i = 0; i < battleHudNames.length; i++) {
    const source = d.field && (d.field as any).battleHud
      ? (d.field as any).battleHud[battleHudNames[i][0]] : null;
    const image = decodeRgbaContainer(
      assetFor(assets, "assets/generated/battle/" + battleHudNames[i][1] + ".png"));
    if (!image || !source) {
      continue;
    }
    outBattleHud[battleHudNames[i][0]] = {
      width: image.width,
      height: image.height,
      // The tile this sheet's first tile IS, so a wTileMap code can be turned
      // into an index into it. Without the base a sheet is just pixels.
      tileBase: source.tileBase,
      shades: packShades(image.pixels, image.width * image.height),
    };
  }

  // The field block, with the battle HUD's pixels folded in beside its refs.
  const outField: any = {};
  if (d.field) {
    const source: any = d.field;
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        outField[key] = source[key];
      }
    }
  }

  // Only when something was actually decoded: a bundle baked without the battle
  // PNGs keeps the refs it had, rather than trading them for an empty object.
  for (const key in outBattleHud) {
    if (Object.prototype.hasOwnProperty.call(outBattleHud, key)) {
      outField.battleHud = outBattleHud;
      break;
    }
  }

  // The slot machine's own two sheets, folded in beside the refs the field
  // dataset already carries. `symbols` is the strip emitSlots() cuts from the
  // second sheet -- one 16x16 picture per symbol, white knocked out -- and
  // `frame` is the machine itself, whose tile ids the slotSymbols.tilemap
  // lays out. Without these the reels have nothing to draw.
  const slotArt: any = {};
  const slotNames = [["symbols", "symbols"], ["frame", "red_slots_1"]];
  for (let i = 0; i < slotNames.length; i++) {
    const image = decodeRgbaContainer(
      assetFor(assets, "assets/generated/slots/" + slotNames[i][1] + ".png"));
    if (!image) {
      continue;
    }
    const count = image.width * image.height;
    slotArt[slotNames[i][0]] = {
      width: image.width,
      height: image.height,
      shades: packShades(image.pixels, count),
      alpha: packAlpha(image.pixels, count),
    };
  }
  for (const key in slotArt) {
    if (Object.prototype.hasOwnProperty.call(slotArt, key)) {
      outField.slotArt = slotArt;
      break;
    }
  }

  const outTitle: any = {};
  const titleNames = [
    ["logo", "pokemon_logo"], ["version", "red_version"], ["player", "player"],
    ["copyright", "copyright"], ["gamefreakInc", "gamefreak_inc"],
    // Yellow only: its whole title screen, composed from the tilemaps.
    ["screen", "yellow_title"],
  ];
  for (let i = 0; i < titleNames.length; i++) {
    const image = decodeRgbaContainer(
      assetFor(assets, "assets/generated/title/" + titleNames[i][1] + ".png"));
    if (!image) {
      continue;
    }
    const count = image.width * image.height;
    outTitle[titleNames[i][0]] = {
      width: image.width,
      height: image.height,
      shades: packShades(image.pixels, count),
      alpha: packAlpha(image.pixels, count),
    };
  }

  // The intro cutscene's portraits, straight out of the cartridge: Oak, the
  // rival, Red's own front sprite (kept as bundle key "player" -- the same
  // character outTitle's "player" is, off the title-screen sprite instead),
  // and the two frames of the shrinking-Pokeball effect. The field dataset
  // emits them under the golden paths via pokemon.ts's writeCompressedPic;
  // here they become shade images like every other graphic.
  const outIntroArt: any = {};
  const introNames = [
    ["oak", "oak"], ["rival", "rival1"], ["player", "red"],
    ["shrink1", "shrink1"], ["shrink2", "shrink2"],
  ];
  for (let i = 0; i < introNames.length; i++) {
    const image = decodeRgbaContainer(
      assetFor(assets, "assets/generated/intro/" + introNames[i][1] + ".png"));
    if (!image) {
      continue;
    }
    const count = image.width * image.height;
    outIntroArt[introNames[i][0]] = {
      width: image.width,
      height: image.height,
      shades: packShades(image.pixels, count),
      alpha: packAlpha(image.pixels, count),
    };
  }

  // The GHOST and the museum's two fossils (datasets/field.ts emitPictures):
  // shade images like the intro's portraits, keyed by what they are.
  const outPictures: any = {};
  const pictureNames = [
    ["ghost", "ghost"], ["fossilAerodactyl", "fossil_aerodactyl"], ["fossilKabutops", "fossil_kabutops"],
  ];
  for (let i = 0; i < pictureNames.length; i++) {
    const image = decodeRgbaContainer(
      assetFor(assets, "assets/generated/pictures/" + pictureNames[i][1] + ".png"));
    if (!image) {
      continue;
    }
    const count = image.width * image.height;
    outPictures[pictureNames[i][0]] = {
      width: image.width,
      height: image.height,
      shades: packShades(image.pixels, count),
      alpha: packAlpha(image.pixels, count),
    };
  }

  const blockOverrides = composeBlockOverrides(d, outMaps, outTilesets);

  return {
    format: 2,
    source: "rom",
    romSha1: romSha1,
    blockOverrides: blockOverrides,
    trainers: outTrainers,
    trades: outTrades,
    items: outItems,
    font: outFont,
    title: outTitle,
    introArt: outIntroArt,
    pictures: outPictures,
    // Cries are decoded while the bake still has a Rom, then carried as compact
    // pulse/wave programs. They are not a registry dataset.
    cries: cries ? cries : emptyCryBank(),
    // The sound banks themselves, for the music and the effects: they loop, so
    // unlike the cries they cannot be decoded into events ahead of time.
    audio: audio ? audio : emptyAudioBank(),
    palettes: d.palettes.palettes,
    tilePalettes: TILE_PALETTES,
    defaultPalette: "ROUTE",
    mapOrder: d.constants.mapOrder,
    tilesets: outTilesets,
    maps: outMaps,
    encounters: outEncounters,
    sprites: outSprites,
    species: outSpecies,
    text: d.text,
    textPointers: d.text_pointers,
    // Per map label, per object index: the labels of a trainer's challenge,
    // end-battle and after-battle lines and the event bit that retires them.
    // Symbol names from the manifest, not ROM bytes. Dropped here for months,
    // which is why no ordinary trainer could be fought.
    trainerHeaders: d.trainer_headers,
    moves: d.moves,
    typeChart: d.type_chart,
    // The manifest's field metadata, whole: the Game Corner poster's blocks,
    // the card-key doors, fly points, PC tiles, water tilesets, dark maps,
    // spinners, the Seafoam holes. Labels and coordinates the extractor
    // already carried and this file dropped. Readers guard its absence.
    field: outField,
  };
}

/**
 * The blocks a flag opens or closes, per map: the manifest's card-key doors
 * (Silph Co., the Rocket Hideout lift gates), the Game Corner poster, and
 * field.blockOverrides (the Elite Four seals, Lance's doorway, Cinnabar's
 * quiz gates). Every row is checked against the decoded map: both block ids
 * must exist in the map's tileset and differ in the walkability of at least
 * one cell, else the row is dropped with a print. A shipped byte that is
 * neither id only warns -- Agatha's room ships a third block the cartridge
 * overwrites on every load.
 */
function composeBlockOverrides(d: any, maps: any, tilesets: any): any {
  const out: any = {};
  const field = d.field ? d.field : {};
  const push = (mapId: string, row: any, source: string) => {
    const map = maps[mapId];
    if (!map) {
      print("[bundle] block override for unknown map " + mapId + " (" + source + ")");
      return;
    }
    const ts = tilesets[map.tileset];
    const count = ts && ts.blocks ? ts.blocks.length : 0;
    if (row.closedBlock < 0 || row.openBlock < 0 || row.closedBlock >= count || row.openBlock >= count) {
      print("[bundle] block override " + mapId + " (" + row.bx + "," + row.by + ") names a block " +
            map.tileset + " does not have; dropped");
      return;
    }
    if (!walkabilityDiffers(ts, row.closedBlock, row.openBlock)) {
      print("[bundle] block override " + mapId + " (" + row.bx + "," + row.by + "): open and closed walk the same; dropped");
      return;
    }
    const shipped = map.blocks[row.by * map.width + row.bx];
    if (shipped !== row.closedBlock && shipped !== row.openBlock) {
      print("[bundle] block override " + mapId + " (" + row.bx + "," + row.by + ") ships " + shipped +
            ", neither " + row.closedBlock + " nor " + row.openBlock + " (the cartridge rewrites it on load)");
    }
    if (!out[mapId]) {
      out[mapId] = [];
    }
    out[mapId].push(row);
  };
  const doors = field.cardKeyDoors && field.cardKeyDoors.closedDoors ? field.cardKeyDoors.closedDoors : {};
  for (const mapId in doors) {
    const list = doors[mapId];
    for (let i = 0; i < list.length; i++) {
      const door = list[i];
      push(mapId, {
        bx: door.bx, by: door.by, closedBlock: door.block, openBlock: door.open,
        flags: door.events ? door.events : (door.event ? [door.event] : []),
        all: true, inverted: false,
        keyItem: mapId.indexOf("SILPH_CO_") === 0 ? "CARD_KEY" : "",
        disabled: false,
      }, "cardKeyDoors");
    }
  }
  const poster = field.gameCornerPoster;
  if (poster && poster.map) {
    push(poster.map, {
      bx: poster.x, by: poster.y, closedBlock: poster.closedBlock, openBlock: poster.openBlock,
      flags: [poster.event], all: true, inverted: false, keyItem: "", disabled: false,
    }, "gameCornerPoster");
  }
  const extra = field.blockOverrides ? field.blockOverrides : {};
  for (const mapId in extra) {
    const list = extra[mapId];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      push(mapId, {
        bx: r.bx, by: r.by, closedBlock: r.closedBlock, openBlock: r.openBlock,
        flags: r.flags ? r.flags : [], all: r.all !== false, inverted: r.inverted === true,
        keyItem: typeof r.keyItem === "string" ? r.keyItem : "", disabled: r.disabled === true,
      }, "field.blockOverrides");
    }
  }
  return out;
}

/** Whether two blocks differ in the walkability of at least one of their four cells. */
function walkabilityDiffers(ts: any, a: number, b: number): boolean {
  const walkable: any = {};
  for (let i = 0; i < ts.walkable.length; i++) {
    walkable["" + ts.walkable[i]] = true;
  }
  const blockA = ts.blocks[a];
  const blockB = ts.blocks[b];
  // A block is 4x4 tiles; a cell's walkability is its bottom-left tile.
  const cells = [[0, 1], [2, 1], [0, 3], [2, 3]];
  for (let i = 0; i < cells.length; i++) {
    const tileA = blockA[cells[i][1] * 4 + cells[i][0]];
    const tileB = blockB[cells[i][1] * 4 + cells[i][0]];
    if ((walkable["" + tileA] === true) !== (walkable["" + tileB] === true)) {
      return true;
    }
  }
  return false;
}
