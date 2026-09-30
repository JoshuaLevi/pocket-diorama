// The baked artifact is current with the extractor that produced it.
//
// This file used to be a genuine cross-check: Assets/Generated/kanto.json was
// baked by tools/build_bundle.py from gen1recomp's golden files, so comparing it
// against our TypeScript extractor compared two independent implementations.
//
// It is not that any more. tools/bake.mjs bakes the artifact with the lens's OWN
// extractor -- which fixed a real bug (build_bundle.py wrote romSha1 as a string
// literal, so every bundle it made claimed to be Red) but makes this comparison
// tautological if it is read as a correctness check. It is not one. What it still
// catches, and the only thing it claims, is a STALE artifact: someone changed the
// extractor and did not re-bake, so the world the lens builds from cache no
// longer matches the world it would build from the ROM.
//
// The correctness cross-check moved to test/worldfromrom.test.mjs, which runs our
// extractor against gen1recomp's own output byte for byte. Regenerate its input
// with ./tools/golden.sh. If that one is skipping, this file is not covering for
// it.

import { readFileSync } from "node:fs";

globalThis.print = (...a) => console.log("  [lens]", ...a);
let clock = 0;
globalThis.getTime = () => (clock += 0.001);

const [romPath, manifestPath, bakedPath] = process.argv.slice(2);
if (!romPath || !manifestPath || !bakedPath) {
  console.error("usage: bundle.test.mjs <rom.gb> <manifest.json> <baked-bundle.json>");
  process.exit(2);
}

const { extractFromRom } = await import("../Assets/Scripts/rom/WorldFromRom.ts");
const { bundleFromExtraction } = await import("../Assets/Scripts/rom/BundleFromExtraction.ts");
// Compare by content, not by insertion order. JSON.stringify preserves whichever
// order each side happened to build its objects in, and reported two identical
// structures as different -- the same trap as in worldfromrom.test.mjs.
const { canonicalJson } = await import("../Assets/Scripts/rom/registry.ts");
const { bakeCryBank } = await import("../Assets/Scripts/audio/CryBank.ts");
const { Rom } = await import("../Assets/Scripts/rom/core/Rom.ts");
// The same unpacker GbCanvas.ts's imageFromPacked uses to turn a bundle
// graphic into pixels, so "does this decode to a real picture" is asked with
// the lens's own code, not a second decoder that could disagree with it.
const { unpackShades } = await import("../Assets/Scripts/world/WorldData.ts");

const rom = new Uint8Array(readFileSync(romPath));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const baked = JSON.parse(readFileSync(bakedPath, "utf8"));

const t0 = Date.now();
const extraction = extractFromRom(rom, manifest, () => {});
// The cries are baked here too. Building the bundle WITHOUT them and then
// asserting the cry key is populated would be a test of its own omission --
// which is what the first version of this did, reporting "0 cries".
const cries = bakeCryBank(new Rom(rom), manifest.audio, manifest.constants.speciesOrder);
const ours = bundleFromExtraction(extraction, manifest.romSha1, null, cries);
console.log(`  built in ${Date.now() - t0} ms\n`);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "  -- " + detail : ""));
  ok ? pass++ : fail++;
}

/** How many of the four DMG shades actually appear in a packed image. */
function shadeVariety(image) {
  if (!image || typeof image.shades !== "string") {
    return 0;
  }
  const pixels = unpackShades(image.shades, image.width * image.height);
  const seen = [false, false, false, false];
  for (let i = 0; i < pixels.length; i++) {
    seen[pixels[i]] = true;
  }
  return seen.filter(Boolean).length;
}

// Every key the lens reads. The font was missing from a re-baked bundle for a
// whole session and nothing here noticed, because this file only ever compared
// counts between two bakers -- so when one baker became the only baker, a key it
// forgot to emit was invisible until a headset said "dialogue will be invisible".
const REQUIRED_KEYS = [
  "format", "source", "romSha1", "maps", "mapOrder", "tilesets", "tilePalettes",
  "palettes", "defaultPalette", "species", "sprites", "moves", "typeChart",
  "encounters", "text", "textPointers", "trainerHeaders", "trainers", "font", "items", "cries", "trades", "field",
  "title", "introArt",
];
const missingKeys = REQUIRED_KEYS.filter((k) => ours[k] === undefined || ours[k] === null);
check("the bundle carries every key the lens reads", missingKeys.length === 0,
      "missing: " + missingKeys.join(", "));
check("species carry their TM/HM list and Pikachu can learn Thunderbolt",
      !!(ours.species && ours.species.PIKACHU && ours.species.PIKACHU.tmhm && ours.species.PIKACHU.tmhm.indexOf("THUNDERBOLT") >= 0) &&
      Object.keys(ours.species).every((k) => Array.isArray(ours.species[k].tmhm)),
      JSON.stringify(ours.species && ours.species.PIKACHU ? ours.species.PIKACHU.tmhm : null));
check("HM01 is a machine that teaches CUT and TMs and HMs number fifty-five",
      !!(ours.items && ours.items.HM_CUT && ours.items.HM_CUT.machine && ours.items.HM_CUT.machine.move === "CUT" &&
         ours.items.HM_CUT.machine.kind === "HM") &&
      Object.keys(ours.items).filter((k) => ours.items[k].machine).length === 55,
      JSON.stringify(ours.items ? ours.items.HM_CUT : null));
check("key items are marked and a Potion is not",
      !!(ours.items && ours.items.TOWN_MAP && ours.items.TOWN_MAP.keyItem === true && ours.items.POTION.keyItem === undefined));
check("the field metadata carries the poster, the card-key doors, the fly points and the PC tiles",
      !!(ours.field && ours.field.gameCornerPoster && ours.field.cardKeyDoors && ours.field.flyWarps &&
         ours.field.hiddenExtras && ours.field.hiddenExtras.pcTiles),
      JSON.stringify(ours.field ? Object.keys(ours.field) : null));
check("the title art is there at the cartridge's sizes",
      ours.title && ours.title.logo && ours.title.logo.width === 128 && ours.title.logo.height === 56 &&
      ours.title.player && ours.title.player.width === 40 && ours.title.player.height === 56 &&
      ours.title.version && ours.title.version.width === 80 &&
      ours.title.copyright && ours.title.copyright.width === 152 &&
      ours.title.gamefreakInc && ours.title.gamefreakInc.width === 72,
      JSON.stringify(Object.keys(ours.title || {})));
check("the intro art is there at the cartridge's sizes",
      !!(ours.introArt &&
         ours.introArt.oak && ours.introArt.oak.width === 56 && ours.introArt.oak.height === 56 &&
         ours.introArt.rival && ours.introArt.rival.width === 56 && ours.introArt.rival.height === 56 &&
         ours.introArt.player && ours.introArt.player.width === 56 && ours.introArt.player.height === 56 &&
         // ShrinkPic1/ShrinkPic2 are not trainer pics, so there is no base-stats
         // byte to cross-check their side against (writeCompressedPic does that
         // check only for species pics). Read straight off the cartridge with
         // decompressPic in a throwaway script rather than assumed, both come
         // out a 7-tile (56x56) square too, the same side as every other
         // trainer-style portrait here.
         ours.introArt.shrink1 && ours.introArt.shrink1.width === 56 && ours.introArt.shrink1.height === 56 &&
         ours.introArt.shrink2 && ours.introArt.shrink2.width === 56 && ours.introArt.shrink2.height === 56),
      JSON.stringify(Object.keys(ours.introArt || {})));
check("the intro art decodes to real pictures, not a flat colour",
      ["oak", "rival", "player", "shrink1", "shrink2"].every(
        (name) => shadeVariety(ours.introArt && ours.introArt[name]) > 1),
      JSON.stringify(["oak", "rival", "player", "shrink1", "shrink2"].map(
        (name) => name + ":" + shadeVariety(ours.introArt && ours.introArt[name]) + "shades")));
check("the font carries its second sheet, for the box border",
      ours.font && ours.font.extraWidth === 128 && ours.font.extraHeight === 16 &&
      typeof ours.font.extraShades === "string" && ours.font.extraShades.length > 0);
check("the font has a glyph sheet",
      !!(ours.font && ours.font.shades && ours.font.width > 0 && ours.font.charmap),
      JSON.stringify(ours.font ? Object.keys(ours.font) : null));
{
  // Code $F0 (240, the naming grid's row-13 yen sign -- tools/oracle/
  // INTRO.md "Beat 25", play/screen/IntroScreen.ts's pixel test) is NOT
  // FontGraphics's own tile 112: the manifest carries the real one under
  // its own symbol, ED_Tile (the charmap's own "<ED>" placeholder seq for
  // this code names it), bank 1. Derives the 8 expected bytes from the ROM
  // this file already opened -- not a literal -- so a future symbol-table
  // change is caught here too, not just in the extractor's own source.
  const edTile = manifest.symbols["ED_Tile"];
  const yenCode = 0xf0;
  const expectedRaw = new Rom(rom).bytes(edTile[0], edTile[1], 8);
  const font = ours.font;
  const tile = yenCode - font.mainBase;
  const tileX = (tile % font.glyphsPerRow) * 8;
  const tileY = Math.floor(tile / font.glyphsPerRow) * 8;
  const fontShades = font.shades ? unpackShades(font.shades, font.width * font.height) : null;
  let bytesMatch = !!fontShades;
  const actualRows = [];
  for (let y = 0; bytesMatch && y < 8; y++) {
    let row = 0;
    for (let x = 0; x < 8; x++) {
      const opaque = fontShades[(tileY + y) * font.width + (tileX + x)] !== 0;
      if (opaque) row |= 1 << (7 - x);
    }
    actualRows.push(row);
    if (row !== expectedRaw[y]) bytesMatch = false;
  }
  check("the font's code-240 tile (row 13's yen sign) matches ED_Tile in the ROM, bit for bit",
        bytesMatch,
        "expected " + Array.from(expectedRaw).map((b) => b.toString(16).padStart(2, "0")).join(" ") +
        ", got " + actualRows.map((b) => b.toString(16).padStart(2, "0")).join(" "));
}
check("trainer rosters are there",
      !!(ours.trainers && ours.trainers.OPP_BROCK &&
         ours.trainers.OPP_BROCK.parties[0].length === 2),
      "a trainer battle cannot start without them");
check("items carry a display name and a price",
      !!(ours.items && ours.items.POTION && ours.items.POTION.name &&
         typeof ours.items.POTION.price === "number"),
      JSON.stringify(ours.items ? ours.items.POTION : null));
check("and the item id is not the display name",
      !!(ours.items.TM_BIDE && ours.items.TM_BIDE.name === "TM34"),
      "Brock's TM is item TM_BIDE and reads TM34; a bag showing the id shows the wrong thing");

check("the cry bank holds every species",
      !!(ours.cries && ours.cries.ids && ours.cries.ids.length === 151),
      ours.cries ? `${ours.cries.ids.length} cries` : "no cries key");

check("the trade table is there",
      !!(ours.trades && ours.trades.length === 10 && ours.trades[0].give &&
         ours.trades[0].get && ours.trades[0].nickname),
      ours.trades ? `${ours.trades.length} trades` : "no trades key");

check("the starters have battle portraits",
      !!(ours.species.CHARMANDER.front && ours.species.SQUIRTLE.front &&
         ours.species.BULBASAUR.front),
      "the Pokemon the player owns would be invisible");

// Both pictures, for every species. The front one is whoever you are facing;
// the back one is your own Pokemon, which is the view the cartridge gives you
// of it, and without it a battle can only draw half of itself. Every species,
// not the encounterable ones: a rival's starter is in no wild table, and every
// gift, trade and evolution is another way to end up holding one.
const missingBack = Object.keys(ours.species).filter((k) => !ours.species[k].back);
check("every species has a back picture too", missingBack.length === 0,
      missingBack.slice(0, 5).join(", "));
check("a back picture is the cartridge's own 32x32",
      ours.species.BULBASAUR.back.width === 32 && ours.species.BULBASAUR.back.height === 32,
      `${ours.species.BULBASAUR.back.width}x${ours.species.BULBASAUR.back.height}`);
check("and is not the front one under another name",
      ours.species.BULBASAUR.back.shades !== ours.species.BULBASAUR.front.shades);

check("same map count", Object.keys(ours.maps).length === Object.keys(baked.maps).length,
      `${Object.keys(ours.maps).length} vs ${Object.keys(baked.maps).length}`);
check("same tileset count", Object.keys(ours.tilesets).length === Object.keys(baked.tilesets).length,
      `${Object.keys(ours.tilesets).length} vs ${Object.keys(baked.tilesets).length}`);
check("same species count", Object.keys(ours.species).length === Object.keys(baked.species).length,
      `${Object.keys(ours.species).length} vs ${Object.keys(baked.species).length}`);

// The three things the renderer actually reads every frame.
const om = ours.maps.ROUTE_1, bm = baked.maps.ROUTE_1;
check("Route 1 geometry matches", canonicalJson(om.blocks) === canonicalJson(bm.blocks));
check("Route 1 palette matches", om.palette === bm.palette, `${om.palette} vs ${bm.palette}`);
const ot = ours.tilesets.OVERWORLD, bt = baked.tilesets.OVERWORLD;
check("overworld tile graphics match", ot.shades === bt.shades,
      ot.shades === bt.shades ? "" : `${ot.shades.length} vs ${bt.shades.length} chars`);
check("overworld categories match", canonicalJson(ot.categories) === canonicalJson(bt.categories));
check("overworld walkable matches", canonicalJson(ot.walkable) === canonicalJson(bt.walkable));
check("overworld carries its water/flower animation (TILEANIM_WATER_FLOWER)",
      !!(ot.animation && ot.animation.waterTile === 0x14 && ot.animation.flowerTile === 0x03 &&
         typeof ot.animation.waterFrame === "string" && ot.animation.waterFrame.length > 0 &&
         Array.isArray(ot.animation.flowerFrames) && ot.animation.flowerFrames.length === 3),
      JSON.stringify(ot.animation));
check("overworld animation matches between the two bakers", canonicalJson(ot.animation) === canonicalJson(bt.animation));
check("a WATER-only tileset (CAVERN) carries no flower frames",
      !ours.tilesets.CAVERN || (ours.tilesets.CAVERN.animation &&
        ours.tilesets.CAVERN.animation.flowerTile === -1 && ours.tilesets.CAVERN.animation.flowerFrames === null),
      JSON.stringify(ours.tilesets.CAVERN ? ours.tilesets.CAVERN.animation : "no CAVERN in this bundle"));
check("a non-animated tileset (LAB) carries no animation at all",
      !ours.tilesets.LAB || ours.tilesets.LAB.animation === null,
      JSON.stringify(ours.tilesets.LAB ? ours.tilesets.LAB.animation : "no LAB in this bundle"));
check("Route 1 encounters match",
      canonicalJson(ours.encounters.ROUTE_1) === canonicalJson(baked.encounters.ROUTE_1));
check("the player sprite matches",
      ours.sprites.SPRITE_RED && baked.sprites.SPRITE_RED &&
      ours.sprites.SPRITE_RED.shades === baked.sprites.SPRITE_RED.shades);
check("tile palettes match", canonicalJson(ours.tilePalettes) === canonicalJson(baked.tilePalettes));

console.log(`\n${fail === 0 ? "BUNDLE PARITY OK" : "BUNDLE PARITY FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
