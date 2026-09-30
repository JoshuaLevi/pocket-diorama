// Bake a world bundle from a cartridge, using the LENS's own extractor.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        tools/bake.mjs <rom.gb> <manifest.json> <out.json> [mapIds,comma,separated]
//
// tools/build_bundle.py bakes the same artifact from gen1recomp's golden JSON
// directory. That was the right tool while the extractor was being written
// against the golden files, and the wrong one afterwards, for two reasons:
//
//   * it needs a golden directory nobody has checked out, so re-baking after an
//     extractor change was effectively impossible; and
//   * it wrote `romSha1` as a string literal, so every bundle it ever produced
//     claimed to be Red -- including, once Blue landed, the Blue ones.
//
// This runs the code the headset runs, over the ROM the player owns, and takes
// the hash from the bytes. The bundle it writes is by construction the bundle
// the lens would have built for itself.
//
// It writes NOTHING derived from the ROM into the repository: the output path is
// yours to choose and Assets/Generated is gitignored.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";

globalThis.print = () => {};
// The extractor times itself with the Lens API's getTime(). Off the headset there
// is no lens clock, and the only thing it is used for is elapsedMs.
globalThis.getTime = () => Date.now() / 1000;

// The manifest argument is OPTIONAL now: without it, the cartridge's own SHA-1
// picks one from Assets/Manifests. Given one, it is used and still checked --
// an explicit wrong manifest is a likelier mistake than a missing one.
const [romPath, argA, argB, argC] = process.argv.slice(2);
const explicitManifest = argA && argA.endsWith(".json") && argB ? argA : "";
const outPath = explicitManifest ? argB : argA;
const mapArg = explicitManifest ? argC : argB;
if (!romPath || !outPath) {
  console.error("usage: bake.mjs <rom.gb> [manifest.json] <out.json> [mapIds]");
  process.exit(2);
}

const { extractFromRom } = await import("../Assets/Scripts/rom/WorldFromRom.ts");
const { bundleFromExtraction } = await import("../Assets/Scripts/rom/BundleFromExtraction.ts");
const { bakeCryBank } = await import("../Assets/Scripts/audio/CryBank.ts");
const { bakeAudioBank } = await import("../Assets/Scripts/audio/AudioBank.ts");
const { Rom } = await import("../Assets/Scripts/rom/core/Rom.ts");
const { sha1: sha1Hex } = await import("../Assets/Scripts/rom/core/sha1.ts");
const { selectManifest } = await import("../Assets/Scripts/rom/ManifestSelect.ts");

const rom = new Uint8Array(readFileSync(romPath));
const sha1 = sha1Hex(rom);

let manifest;
if (explicitManifest) {
  manifest = JSON.parse(readFileSync(explicitManifest, "utf8"));
} else {
  // Every manifest this project ships, and let the cartridge choose.
  const dir = new URL("../Assets/Manifests/", import.meta.url);
  const candidates = readdirSync(dir)
    .filter((f) => f.startsWith("rom_manifest_") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
  manifest = selectManifest(sha1, candidates);
  if (!manifest) {
    console.error(`refusing to bake: no manifest describes ${sha1}`);
    console.error(`  ${candidates.length} shipped: ` +
      candidates.map((m) => m.romSha1).join(", "));
    console.error("Decoding an unknown revision with Gen 1 addresses produces");
    console.error("garbage that looks exactly like data, which is why this");
    console.error("refuses rather than guessing.");
    process.exit(1);
  }
}
if (manifest.romSha1 && manifest.romSha1 !== sha1) {
  console.error(`refusing to bake: this ROM is ${sha1}`);
  console.error(`               the manifest expects ${manifest.romSha1}`);
  process.exit(1);
}

const stages = [];
const extraction = extractFromRom(rom, manifest, (name) => stages.push(name));

const mapIds = mapArg ? mapArg.split(",").map((s) => s.trim()).filter(Boolean)
                      : Object.keys(extraction.datasets.maps);
// The cries are decoded HERE, while there is still a Rom to decode them from.
// The lens only ever has the JSON bundle, so anything the synth needs has to be
// carried in it -- the same reason trainers, items and the font are in there.
let cries = null;
try {
  cries = bakeCryBank(new Rom(rom), manifest.audio, manifest.constants.speciesOrder);
} catch (e) {
  console.error("cry bank failed, baking without one: " + e.message);
}

// The sound banks come along whole: music loops, so it cannot be baked into
// events the way the cries are, and the bytes have to travel instead.
let audio = null;
try {
  audio = bakeAudioBank(new Rom(rom), manifest.audio);
} catch (e) {
  console.error("audio bank failed, baking without one: " + e.message);
}

const bundle = bundleFromExtraction(extraction, sha1, mapIds, cries, audio);

const text = JSON.stringify(bundle);
writeFileSync(outPath, text);

const fronts = Object.values(bundle.species).filter((s) => s.front).length;
const backs = Object.values(bundle.species).filter((s) => s.back).length;
console.log(`BAKE OK  ${outPath}`);
console.log(`  rom      ${romPath.split("/").pop()}  sha1 ${sha1}`);
console.log(`  datasets ${stages.length}`);
console.log(`  maps     ${Object.keys(bundle.maps).length}`);
console.log(`  species  ${Object.keys(bundle.species).length} ` +
            `(${fronts} front pictures, ${backs} back)`);
console.log(`  trainers ${Object.keys(bundle.trainers || {}).length}`);
const cryCount = bundle.cries && bundle.cries.ids ? bundle.cries.ids.length : 0;
console.log(`  cries    ${cryCount}  (${(JSON.stringify(bundle.cries).length / 1024).toFixed(0)} KB)`);
const songCount = bundle.audio && bundle.audio.music ? Object.keys(bundle.audio.music).length : 0;
const sfxCount = bundle.audio && bundle.audio.sfx ? Object.keys(bundle.audio.sfx).length : 0;
console.log(`  audio    ${songCount} songs, ${sfxCount} effects, ` +
            `${(bundle.audio.banks || []).length} banks ` +
            `(${(JSON.stringify(bundle.audio).length / 1024).toFixed(0)} KB)`);
console.log(`  size     ${(text.length / 1048576).toFixed(2)} MB`);
