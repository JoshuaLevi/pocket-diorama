/**
 * Gate for the six graphics-and-text datasets: sprites, font, palettes,
 * icons, text (three files) and field.
 *
 * Run it directly -- no test runner, no dependencies:
 *
 *   npx tsx test/graphics.test.ts
 *
 * Two halves.
 *
 * 1. Pure checks that need nothing but the source: the helpers in
 *    src/datasets/graphics.ts, run against values taken from the reference.
 *
 * 2. The golden compare, which is the real acceptance test. It runs every
 *    builder against a real cart and demands byte-identical canonical JSON
 *    against tools/golden/json/<file>.json. With --assets style pixel output
 *    it also checks the decoded images, but only for size and framing: the
 *    authoritative pixel compare needs a PNG decoder and lives outside this
 *    file (tools/golden/assets/**.png versus the emitted .rgba payloads).
 *
 * The cart is not in the repo and never will be, so half 2 needs three paths.
 * They default to nothing and can be given as environment variables:
 *
 *   POKEMON_ROM       path to the Pokemon Red image (SHA-1 ea9bcae6...)
 *   POKEMON_MANIFEST  path to gen1recomp's tools/rom_manifest.json
 *   POKEMON_GOLDEN    directory holding the golden *.json
 *
 * When they are missing the golden half reports SKIP -- loudly, and it still
 * fails the run, because a gate that silently passes when it cannot see the
 * thing it is gating is worse than no gate at all. Pass --allow-skip to turn
 * that into a warning for a machine that genuinely has no cart.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { openRom } from "../src/core/Rom";
import { Symbols } from "../src/core/Symbols";
import { canonicalJson, createContext, runDataset } from "../src/registry";
import type { AssetSink, DatasetBuilder } from "../src/registry";
import type { RomManifest } from "../src/types";

import {
  cropImage,
  deepCloneJson,
  emitImage,
  encodeRgba,
  flipHorizontal,
  matteColor0,
  newImage,
  nybbles,
  padTo,
  pasteImage,
  pixelEquals,
  scale5,
  setPixel,
  hasOwn,
  BLACK_OPAQUE,
  WHITE_CLEAR,
  WHITE_OPAQUE,
} from "../src/datasets/graphics";
import { builder as fieldBuilder } from "../src/datasets/field";
import { builder as fontBuilder } from "../src/datasets/font";
import { builder as iconsBuilder } from "../src/datasets/icons";
import { builder as palettesBuilder } from "../src/datasets/palettes";
import { builder as spritesBuilder } from "../src/datasets/sprites";
import { builder as textBuilder } from "../src/datasets/text";

const BUILDERS: DatasetBuilder[] = [
  spritesBuilder,
  fontBuilder,
  palettesBuilder,
  iconsBuilder,
  textBuilder,
  fieldBuilder,
];

/** Reference values for scale5, computed by Python's round(v * 255 / 31). */
const SCALE5_TABLE: number[] = [
  0, 8, 16, 25, 33, 41, 49, 58, 66, 74, 82, 90, 99, 107, 115, 123, 132, 140,
  148, 156, 165, 173, 181, 189, 197, 206, 214, 222, 230, 239, 247, 255,
];

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(name + (detail === undefined ? "" : ": " + detail));
  process.stdout.write("  FAIL  " + name + "\n");
  if (detail !== undefined) {
    process.stdout.write("        " + detail + "\n");
  }
}

function checkEqual(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, a === b ? undefined : "got " + a + ", want " + b);
}

/* ------------------------------------------------------------------------ */
/* 1. Helpers                                                                */
/* ------------------------------------------------------------------------ */

function testHelpers(): void {
  process.stdout.write("helpers\n");

  const scaled: number[] = [];
  for (let value = 0; value < 32; value += 1) {
    scaled.push(scale5(value));
  }
  checkEqual("scale5 matches the reference table for all 32 inputs", scaled, SCALE5_TABLE);

  checkEqual("nybbles splits high before low", nybbles([0x12, 0x34], 4), [1, 2, 3, 4]);
  checkEqual("nybbles truncates to count", nybbles([0x12, 0x34], 3), [1, 2, 3]);
  checkEqual("nybbles of an odd count drops the pad", nybbles([0xab], 1), [10]);

  const source = { keep: [1, { deep: "value" }], nil: null };
  const clone = deepCloneJson(source);
  clone.keep[1] = "changed";
  checkEqual("deepCloneJson does not alias its input", source.keep[1], { deep: "value" });
  check("deepCloneJson preserves null", clone.nil === null);

  check("hasOwn ignores the prototype", !hasOwn({}, "constructor"));
  check("hasOwn finds a real key", hasOwn({ constructor: 1 }, "constructor"));

  checkEqual("padTo extends a short read with zeroes", Array.from(padTo(new Uint8Array([1, 2]), 4)), [1, 2, 0, 0]);
  checkEqual("padTo leaves a long enough read alone", Array.from(padTo(new Uint8Array([1, 2, 3]), 2)), [1, 2, 3]);

  // A 2x1 image, black then white, flipped and cropped.
  const strip = newImage(2, 1, WHITE_OPAQUE);
  setPixel(strip, 0, 0, BLACK_OPAQUE);
  const flipped = flipHorizontal(strip);
  check("flipHorizontal moves the ink to the right", pixelEquals(flipped, 1, 0, BLACK_OPAQUE));
  check("flipHorizontal does not mutate its input", pixelEquals(strip, 0, 0, BLACK_OPAQUE));
  check("cropImage takes the requested cell", pixelEquals(cropImage(strip, 1, 0, 1, 1), 0, 0, WHITE_OPAQUE));

  const canvas = newImage(2, 2, WHITE_CLEAR);
  const pasted = pasteImage(canvas, strip, 0, 1);
  check("pasteImage writes at the offset", pixelEquals(pasted, 0, 1, BLACK_OPAQUE));
  check("pasteImage leaves the rest alone", pixelEquals(pasted, 0, 0, WHITE_CLEAR));
  check("pasteImage does not mutate the destination", pixelEquals(canvas, 0, 1, WHITE_CLEAR));

  // matteColor0 clears white reachable from the edge and keeps white inside a
  // closed black ring -- the property the sprite mattes depend on.
  const ring = newImage(5, 5, WHITE_OPAQUE);
  for (let i = 1; i <= 3; i += 1) {
    setPixel(ring, i, 1, BLACK_OPAQUE);
    setPixel(ring, i, 3, BLACK_OPAQUE);
    setPixel(ring, 1, i, BLACK_OPAQUE);
    setPixel(ring, 3, i, BLACK_OPAQUE);
  }
  const matted = matteColor0(ring);
  check("matteColor0 clears the outside", pixelEquals(matted, 0, 0, WHITE_CLEAR));
  check("matteColor0 keeps white inside the ring", pixelEquals(matted, 2, 2, WHITE_OPAQUE));
  check("matteColor0 does not mutate its input", pixelEquals(ring, 0, 0, WHITE_OPAQUE));

  const encoded = encodeRgba(newImage(3, 2, BLACK_OPAQUE));
  checkEqual("encodeRgba writes the magic", Array.from(encoded.subarray(0, 8)), [0x50, 0x58, 0x52, 0x47, 0x42, 0x41, 0x30, 0x31]);
  checkEqual("encodeRgba writes width and height little-endian", Array.from(encoded.subarray(8, 12)), [3, 0, 2, 0]);
  check("encodeRgba payload is w*h*4", encoded.length === 12 + 3 * 2 * 4);

  // emitImage swaps the golden PNG extension for .rgba, and nothing else.
  const seen: string[] = [];
  const sink: AssetSink = function record(path: string): void {
    seen.push(path);
  };
  emitImage(
    createContext(
      null as never,
      null as never,
      null as never,
      sink,
    ),
    "sprites/red.png",
    newImage(1, 1, BLACK_OPAQUE),
  );
  checkEqual("emitImage rewrites the extension", seen, ["sprites/red.rgba"]);
}

/* ------------------------------------------------------------------------ */
/* 2. The golden compare                                                     */
/* ------------------------------------------------------------------------ */

interface GoldenPaths {
  rom: string;
  manifest: string;
  golden: string;
}

function goldenPaths(): GoldenPaths | null {
  const rom = process.env.POKEMON_ROM;
  const manifest = process.env.POKEMON_MANIFEST;
  const golden = process.env.POKEMON_GOLDEN;
  if (
    rom === undefined || manifest === undefined || golden === undefined ||
    !existsSync(rom) || !existsSync(manifest) || !existsSync(golden)
  ) {
    return null;
  }
  return { rom: rom, manifest: manifest, golden: golden };
}

/** Where two strings first differ, with a window of context around it. */
function describeDifference(actual: string, expected: string): string {
  const limit = Math.min(actual.length, expected.length);
  let index = 0;
  while (index < limit && actual.charAt(index) === expected.charAt(index)) {
    index += 1;
  }
  if (index === limit && actual.length === expected.length) {
    return "identical";
  }
  const from = Math.max(0, index - 60);
  return (
    "first difference at byte " + index +
    " (lengths " + actual.length + " vs " + expected.length + ")\n" +
    "        actual   ..." + actual.substring(from, index + 60) + "\n" +
    "        expected ..." + expected.substring(from, index + 60)
  );
}

function testGolden(paths: GoldenPaths): void {
  process.stdout.write("golden compare\n");

  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8")) as RomManifest;
  const rom = openRom(new Uint8Array(readFileSync(paths.rom)), manifest.romSha1);
  const symbols = new Symbols(manifest.symbols);

  const assetPaths: string[] = [];
  const assetSizes: number[] = [];
  const sink: AssetSink = function record(path: string, bytes: Uint8Array): void {
    assetPaths.push(path);
    assetSizes.push(bytes.length);
  };
  const ctx = createContext(rom, symbols, manifest, sink);

  for (let i = 0; i < BUILDERS.length; i += 1) {
    const files = runDataset(BUILDERS[i], ctx);
    for (let j = 0; j < files.length; j += 1) {
      const name = files[j].name;
      const actual = canonicalJson(files[j].value);
      const goldenFile = join(paths.golden, name + ".json");
      if (!existsSync(goldenFile)) {
        check(name + ".json matches golden", false, "no golden file at " + goldenFile);
        continue;
      }
      const expected = readFileSync(goldenFile, "utf8");
      check(
        name + ".json is byte-identical to golden (" + expected.length + " bytes)",
        actual === expected,
        actual === expected ? undefined : describeDifference(actual, expected),
      );
    }
  }

  // Every emitted asset must be a well-formed .rgba whose header agrees with
  // its payload, and no path may be claimed twice.
  let malformed = 0;
  const duplicates: string[] = [];
  for (let i = 0; i < assetPaths.length; i += 1) {
    if (assetPaths.indexOf(assetPaths[i]) !== i) {
      duplicates.push(assetPaths[i]);
    }
    if (assetPaths[i].lastIndexOf(".rgba") !== assetPaths[i].length - 5) {
      malformed += 1;
    }
    if (assetSizes[i] < 12) {
      malformed += 1;
    }
  }
  check("every emitted asset is a .rgba of at least a header", malformed === 0);
  checkEqual("no asset path is emitted twice", duplicates, []);
  check(
    "the six datasets emit the expected 112 images (got " + assetPaths.length + ")",
    assetPaths.length === 112,
  );

  // Prove the comparison discriminates: a one-character change must be seen.
  const sample = canonicalJson({ a: 1 });
  check(
    "the byte compare rejects a mutated string",
    sample !== canonicalJson({ a: 2 }),
  );
  check(
    "describeDifference locates a mutation",
    describeDifference("abc", "abd").indexOf("byte 2") >= 0,
    describeDifference("abc", "abd"),
  );
}

/* ------------------------------------------------------------------------ */

function main(): void {
  const allowSkip = process.argv.indexOf("--allow-skip") >= 0;
  testHelpers();

  const paths = goldenPaths();
  if (paths === null) {
    process.stdout.write(
      "golden compare\n" +
        "  SKIP  POKEMON_ROM / POKEMON_MANIFEST / POKEMON_GOLDEN are not all set\n" +
        "        this is the real acceptance test; it was not run\n",
    );
    if (!allowSkip) {
      failures.push("golden compare did not run (pass --allow-skip to permit)");
    }
  } else {
    testGolden(paths);
  }

  process.stdout.write(
    "\nMARKER graphics.test: " + passed + " checks passed, " +
      failures.length + " failed\n",
  );
  if (failures.length > 0) {
    for (let i = 0; i < failures.length; i += 1) {
      process.stdout.write("  - " + failures[i] + "\n");
    }
    process.exitCode = 1;
  }
}

main();
