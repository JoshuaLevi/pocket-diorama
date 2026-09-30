// Runs the LENS extraction path over the real ROM and diffs it against the golden
// reference. tools/extractor/src/verify.ts already proves the Node build matches;
// this proves the copy the lens compiles, and my wiring of it, match too.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

globalThis.print = (...a) => console.log("  [lens]", ...a);
let clock = 0;
globalThis.getTime = () => (clock += 0.001);

const romPath = process.argv[2];
const manifestPath = process.argv[3];
const goldenDir = process.argv[4];
if (!romPath || !manifestPath || !goldenDir) {
  console.error("usage: worldfromrom.test.mjs <rom.gb> <manifest.json> <golden-json-dir>");
  process.exit(2);
}

const { extractFromRom, packShades, packAlpha } =
  await import("../Assets/Scripts/rom/WorldFromRom.ts");
// The extractor ships the canonicaliser the golden files were written with. Using
// my own was a mistake: copying integer-like keys onto a fresh object puts them
// back in numeric order, which silently undoes the sort and reported four
// perfectly good datasets as different.
const { canonicalJson } = await import("../Assets/Scripts/rom/registry.ts");

const rom = new Uint8Array(readFileSync(romPath));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const stages = [];
const result = extractFromRom(rom, manifest, (name) => stages.push(name));
console.log(`  ran ${stages.length} datasets, ${Object.keys(result.assets).length} assets\n`);

const canonical = canonicalJson;

let pass = 0, fail = 0, missing = 0;
for (const file of readdirSync(goldenDir).filter((f) => f.endsWith(".json")).sort()) {
  const name = file.replace(/\.json$/, "");
  const golden = readFileSync(join(goldenDir, file), "utf8");
  if (result.datasets[name] === undefined) {
    console.log(`  MISS  ${name}`); missing++; continue;
  }
  let dataset = result.datasets[name];
  if (name === "field") {
    // The field dataset is the manifest's field metadata, cloned. This
    // repository's manifest carries ONE table the reference's does not --
    // blockOverrides, the flag-opened blocks the reference keeps in its Lua
    // scripts -- so that key is set aside here and everything else in field
    // must still match the reference byte for byte. Any second addition fails.
    const extra = Object.keys(dataset).filter((k) => !(k in JSON.parse(golden)));
    if (extra.join(",") !== "blockOverrides") {
      console.log(`  FAIL  field carries keys the reference's manifest does not: ${extra.join(",")}`);
      fail++;
      continue;
    }
    dataset = Object.assign({}, dataset);
    delete dataset.blockOverrides;
  }
  const ours = canonical(dataset);
  if (ours === golden) { console.log(`  PASS  ${name}  ${golden.length} bytes`); pass++; }
  else {
    let at = 0; while (at < ours.length && at < golden.length && ours[at] === golden[at]) at++;
    console.log(`  FAIL  ${name}  first differs at ${at}`);
    console.log(`          golden ...${golden.slice(Math.max(0, at - 30), at + 40)}`);
    console.log(`          ours   ...${ours.slice(Math.max(0, at - 30), at + 40)}`);
    fail++;
  }
}

// The packers the bundle depends on, checked on a known image.
const px = new Uint8Array([255,255,255,255, 170,170,170,255, 85,85,85,255, 0,0,0,255]);
const shades = packShades(px, 4);
console.log(`\n  packShades on the four greys -> ${shades} (${shades === "5A==" ? "OK" : "check"})`);
console.log(`  packAlpha all opaque        -> ${packAlpha(px, 4)}`);

console.log(`\n${fail === 0 && missing === 0 ? "LENS EXTRACTION OK" : "LENS EXTRACTION INCOMPLETE"}: ${pass} pass, ${fail} fail, ${missing} missing`);
process.exit(fail === 0 && missing === 0 ? 0 : 1);
