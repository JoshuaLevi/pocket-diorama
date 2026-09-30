/**
 * Tests for the tilesets and constants dataset builders.
 *
 *   npx tsx --test test/tilesets.test.ts
 *
 * Two layers:
 *
 *   1. A synthetic cart built in memory. It always runs, needs no ROM, and
 *      pins the decode rules that are easy to get subtly wrong: walkable is
 *      sorted but NOT de-duplicated, warpTiles IS de-duplicated, counterTiles
 *      drop $FF and keep header order, grassTile is an explicit null rather
 *      than an omitted key, and a tile sheet shared by two tilesets is written
 *      once, by the FIRST tileset in tilesetOrder that names it.
 *
 *   2. The golden compare against the user's own ROM. It is skipped unless
 *      both the cart and the golden JSON are present, because neither may be
 *      committed: set PX_ROM and PX_GOLDEN (or drop the golden files in
 *      tools/golden/json) to run it.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { decode2bpp } from "../src/core/decode";
import { Rom } from "../src/core/Rom";
import { Symbols } from "../src/core/Symbols";
import { canonicalJson, createContext, outputsFor } from "../src/registry";
import type { RomManifest } from "../src/types";
import { builder as constantsBuilder } from "../src/datasets/constants";
import { builder as tilesetsBuilder } from "../src/datasets/tilesets";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(EXTRACTOR_ROOT, "..", "..");

/* ------------------------------------------------------------------------ */
/* Synthetic cart                                                            */
/* ------------------------------------------------------------------------ */

interface EmittedAsset {
  path: string;
  bytes: Uint8Array;
}

/** In bank 1 a CPU address is also its file offset, which keeps this readable. */
const FIXTURE_SIZE = 0x10000;

function poke(image: Uint8Array, offset: number, values: number[]): void {
  for (let i = 0; i < values.length; i += 1) {
    image[offset + i] = values[i];
  }
}

function ramp(length: number, start: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    out.push((start + i) & 0xff);
  }
  return out;
}

function repeat(length: number, value: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    out.push(value);
  }
  return out;
}

/**
 * Three tilesets: ALPHA and GAMMA share a sheet, BETA has its own and stores
 * fewer tiles than it declares so the zero-padding path runs.
 */
function buildFixture(): { rom: Rom; symbols: Symbols; manifest: RomManifest } {
  const image = new Uint8Array(FIXTURE_SIZE);

  // Tilesets header rows: bank, block ptr, gfx ptr, collision ptr,
  // three counters, grass, animation.
  poke(image, 0x4000, [
    1, 0x00, 0x44, 0xe0, 0x43, 0x00, 0x08, 7, 0xff, 12, 0x20, 1,
  ]);
  poke(image, 0x400c, [
    1, 0x40, 0x44, 0x30, 0x44, 0x10, 0x08, 0xff, 0xff, 0xff, 0xff, 0,
  ]);
  poke(image, 0x4018, [
    1, 0x60, 0x44, 0x50, 0x44, 0x20, 0x08, 0xff, 5, 0xff, 0xff, 0,
  ]);

  // WarpTileIDPointers: one 16-bit pointer per tileset.
  poke(image, 0x4100, [0x00, 0x45, 0x20, 0x45, 0x40, 0x45]);
  poke(image, 0x4500, [3, 1, 3, 0xff]);
  poke(image, 0x4520, [0xff]);
  poke(image, 0x4540, [9, 9, 0xff]);

  // DoorTileIDPointers: (tileset index, pointer), $FF terminated.
  poke(image, 0x4200, [0, 0x00, 0x46, 1, 0x10, 0x46, 0xff]);
  poke(image, 0x4600, [8, 2, 0x00]);
  poke(image, 0x4610, [4, 0x00]);

  // Collision lists live in ROM0.
  poke(image, 0x0800, [5, 1, 5, 9, 0xff]);
  poke(image, 0x0810, [2, 0xff]);
  poke(image, 0x0820, [0, 3, 1, 0xff]);

  // Tile sheets, then the blocksets that follow them.
  poke(image, 0x43e0, ramp(32, 0)); // ALPHA -> shared.png, exactly full
  poke(image, 0x4400, ramp(32, 0)); // ALPHA blockset: two blocks
  poke(image, 0x4430, repeat(16, 0xaa)); // BETA -> solo.png, half stored
  poke(image, 0x4440, ramp(16, 100)); // BETA blockset
  poke(image, 0x4450, repeat(16, 0x55)); // GAMMA sheet, never written
  poke(image, 0x4460, ramp(16, 200)); // GAMMA blockset

  poke(image, 0x1000, repeat(16, 0x11));
  poke(image, 0x1010, repeat(16, 0x22));
  poke(image, 0x1020, repeat(16, 0x33));
  poke(image, 0x4300, ramp(64, 7));

  const symbols = new Symbols({
    Tilesets: [1, 0x4000],
    WarpTileIDPointers: [1, 0x4100],
    DoorTileIDPointers: [1, 0x4200],
    FlowerTile1: [0, 0x1000],
    FlowerTile2: [0, 0x1010],
    FlowerTile3: [0, 0x1020],
    SpinnerArrowAnimTiles: [1, 0x4300],
  });

  const manifest = {
    constants: { tilesetOrder: ["ALPHA", "BETA", "GAMMA"] },
    tileAnimations: ["TILEANIM_NONE", "TILEANIM_WATER"],
    tilesets: [
      {
        blockCount: 2,
        id: "ALPHA",
        imageBase: "shared",
        imageHeight: 8,
        imageWidth: 16,
        name: "Alpha",
      },
      {
        blockCount: 1,
        id: "BETA",
        imageBase: "solo",
        imageHeight: 8,
        imageWidth: 16,
        name: "Beta",
      },
      {
        blockCount: 1,
        id: "GAMMA",
        imageBase: "shared",
        imageHeight: 8,
        imageWidth: 16,
        name: "Gamma",
      },
    ],
  } as unknown as RomManifest;

  return { rom: new Rom(image), symbols: symbols, manifest: manifest };
}

function runFixture(): {
  table: { [id: string]: any };
  assets: EmittedAsset[];
} {
  const fixture = buildFixture();
  const assets: EmittedAsset[] = [];
  const ctx = createContext(
    fixture.rom,
    fixture.symbols,
    fixture.manifest,
    function collect(path: string, bytes: Uint8Array): void {
      assets.push({ path: path, bytes: bytes });
    },
  );
  return {
    table: tilesetsBuilder.build(ctx) as { [id: string]: any },
    assets: assets,
  };
}

/* ------------------------------------------------------------------------ */
/* Minimal PNG reader, so the encoder is checked and not just trusted        */
/* ------------------------------------------------------------------------ */

interface PngImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) |
      (bytes[at + 1] << 16) |
      (bytes[at + 2] << 8) |
      bytes[at + 3]) >>>
    0
  );
}

function decodePng(bytes: Uint8Array): PngImage {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    assert.equal(bytes[i], signature[i], `PNG signature byte ${i}`);
  }
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  let sawEnd = false;
  while (at < bytes.length) {
    const length = readUint32(bytes, at);
    const type = String.fromCharCode(
      bytes[at + 4],
      bytes[at + 5],
      bytes[at + 6],
      bytes[at + 7],
    );
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = readUint32(body, 0);
      height = readUint32(body, 4);
      assert.equal(body[8], 8, "bit depth");
      assert.equal(body[9], 6, "colour type must be RGBA");
      assert.equal(body[12], 0, "interlace");
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      sawEnd = true;
    }
    at += 12 + length;
  }
  assert.ok(sawEnd, "PNG has no IEND chunk");

  const raw = new Uint8Array(inflateSync(Buffer.concat(idat.map(Buffer.from))));
  const stride = width * 4;
  assert.equal(raw.length, (stride + 1) * height, "inflated scanline size");
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[y * (stride + 1)], 0, `row ${y} must use filter None`);
    pixels.set(
      raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride),
      y * stride,
    );
  }
  return { width: width, height: height, pixels: pixels };
}

function assetNamed(assets: EmittedAsset[], path: string): EmittedAsset {
  const matches = assets.filter(function byPath(asset: EmittedAsset): boolean {
    return asset.path === path;
  });
  assert.equal(matches.length, 1, `${path} should be emitted exactly once`);
  return matches[0];
}

/* ------------------------------------------------------------------------ */
/* Registry contract                                                         */
/* ------------------------------------------------------------------------ */

test("builders declare the names and outputs the CLI discovers", function () {
  assert.equal(tilesetsBuilder.name, "tilesets");
  assert.deepEqual(outputsFor(tilesetsBuilder), ["tilesets"]);
  assert.equal(constantsBuilder.name, "constants");
  assert.deepEqual(outputsFor(constantsBuilder), ["constants"]);
});

test("constants rejects a manifest that is missing a table", function () {
  const ctx = createContext(
    new Rom(new Uint8Array(16)),
    new Symbols({}),
    { constants: { mapOrder: [] } } as unknown as RomManifest,
  );
  assert.throws(
    function () {
      constantsBuilder.build(ctx);
    },
    /missing 'maps'/,
  );
});

/* ------------------------------------------------------------------------ */
/* Synthetic cart                                                            */
/* ------------------------------------------------------------------------ */

test("tilesets decodes a synthetic cart field by field", function () {
  const result = runFixture();
  assert.deepEqual(Object.keys(result.table).sort(), [
    "ALPHA",
    "BETA",
    "GAMMA",
  ]);

  assert.deepEqual(result.table.ALPHA, {
    animation: "TILEANIM_WATER",
    blocks: [ramp(16, 0), ramp(16, 16)],
    counterTiles: [7, 12],
    doorTiles: [2, 8],
    grassTile: 32,
    id: "ALPHA",
    image: "assets/generated/tilesets/shared.png",
    imageHeight: 8,
    imageWidth: 16,
    source: "ROM:Tilesets[0]",
    tilesPerRow: 2,
    // Sorted, duplicates kept: the cart really does repeat collision ids.
    walkable: [1, 5, 5, 9],
    // Sorted AND de-duplicated, unlike walkable.
    warpTiles: [1, 3],
  });

  assert.deepEqual(result.table.BETA.counterTiles, []);
  assert.deepEqual(result.table.BETA.doorTiles, [4]);
  assert.deepEqual(result.table.BETA.walkable, [2]);
  assert.deepEqual(result.table.BETA.warpTiles, []);
  assert.equal(result.table.BETA.grassTile, null);
  assert.equal(result.table.BETA.animation, "TILEANIM_NONE");
  assert.equal(result.table.BETA.source, "ROM:Tilesets[1]");

  assert.deepEqual(result.table.GAMMA.counterTiles, [5]);
  assert.deepEqual(result.table.GAMMA.doorTiles, []);
  assert.deepEqual(result.table.GAMMA.walkable, [0, 1, 3]);
  assert.deepEqual(result.table.GAMMA.warpTiles, [9]);
  assert.equal(result.table.GAMMA.grassTile, null);
});

test("a missing grassTile serialises as null, not as an absent key", function () {
  const result = runFixture();
  const text = canonicalJson(result.table.BETA);
  assert.ok(
    text.indexOf('"grassTile":null') >= 0,
    "grassTile must survive serialisation as an explicit null",
  );
});

test("blocks are 16 tile indices each, one per declared block", function () {
  const result = runFixture();
  const ids = Object.keys(result.table);
  for (let i = 0; i < ids.length; i += 1) {
    const blocks = result.table[ids[i]].blocks as number[][];
    for (let b = 0; b < blocks.length; b += 1) {
      assert.equal(blocks[b].length, 16, `${ids[i]} block ${b}`);
    }
  }
  assert.equal(result.table.ALPHA.blocks.length, 2);
  assert.equal(result.table.BETA.blocks.length, 1);
  assert.equal(result.table.GAMMA.blocks.length, 1);
});

test("a shared tile sheet is written once, by the first tileset that names it", function () {
  const result = runFixture();
  assert.deepEqual(
    result.assets.map(function path(asset: EmittedAsset): string {
      return asset.path;
    }),
    [
      "tilesets/shared.png",
      "tilesets/solo.png",
      "tilesets/flower1.png",
      "tilesets/flower2.png",
      "tilesets/flower3.png",
      "tilesets/spinners.png",
    ],
  );

  // shared.png must hold ALPHA's tiles ($00..$1F), never GAMMA's ($55 fill).
  const shared = decodePng(assetNamed(result.assets, "tilesets/shared.png").bytes);
  const expected = decode2bpp(Uint8Array.from(ramp(32, 0)), 16, 8);
  assert.equal(shared.width, 16);
  assert.equal(shared.height, 8);
  assert.deepEqual(Array.from(shared.pixels), Array.from(expected.pixels));
});

test("a short stored sheet is zero-padded to its declared size", function () {
  const result = runFixture();
  const solo = decodePng(assetNamed(result.assets, "tilesets/solo.png").bytes);
  const padded = repeat(16, 0xaa).concat(repeat(16, 0));
  const expected = decode2bpp(Uint8Array.from(padded), 16, 8);
  assert.equal(solo.width, 16);
  assert.equal(solo.height, 8);
  assert.deepEqual(Array.from(solo.pixels), Array.from(expected.pixels));
});

test("the animated flower and spinner tiles come out at the right size", function () {
  const result = runFixture();
  for (let frame = 1; frame <= 3; frame += 1) {
    const png = decodePng(
      assetNamed(result.assets, `tilesets/flower${frame}.png`).bytes,
    );
    assert.equal(png.width, 8);
    assert.equal(png.height, 8);
  }
  const spinners = decodePng(
    assetNamed(result.assets, "tilesets/spinners.png").bytes,
  );
  assert.equal(spinners.width, 32);
  assert.equal(spinners.height, 8);
});

test("a tileset header naming an unknown animation is rejected", function () {
  const fixture = buildFixture();
  const broken = fixture.manifest as unknown as { tileAnimations: string[] };
  const shortened = {
    constants: fixture.manifest.constants,
    tileAnimations: [broken.tileAnimations[0]],
    tilesets: fixture.manifest.tilesets,
  } as unknown as RomManifest;
  const ctx = createContext(fixture.rom, fixture.symbols, shortened);
  assert.throws(
    function () {
      tilesetsBuilder.build(ctx);
    },
    /unknown tile animation 1/,
  );
});

/* ------------------------------------------------------------------------ */
/* Golden compare (needs the user's own cart; skipped when absent)           */
/* ------------------------------------------------------------------------ */

function firstExisting(candidates: string[]): string | null {
  for (let i = 0; i < candidates.length; i += 1) {
    if (candidates[i] !== "" && existsSync(candidates[i])) {
      return candidates[i];
    }
  }
  return null;
}

const romPath = firstExisting([
  process.env.PX_ROM === undefined ? "" : process.env.PX_ROM,
  join(REPO_ROOT, "tools", "golden", "rom.gb"),
]);
const manifestPath = firstExisting([
  process.env.PX_MANIFEST === undefined ? "" : process.env.PX_MANIFEST,
  join(REPO_ROOT, "tools", "golden", "rom_manifest.json"),
]);
const goldenDir = firstExisting([
  process.env.PX_GOLDEN === undefined ? "" : process.env.PX_GOLDEN,
  join(REPO_ROOT, "tools", "golden", "json"),
]);
const canRunGolden =
  romPath !== null && manifestPath !== null && goldenDir !== null;

test(
  "constants.json and tilesets.json match the golden output byte for byte",
  { skip: canRunGolden ? false : "set PX_ROM, PX_MANIFEST and PX_GOLDEN" },
  function () {
    const manifest = JSON.parse(
      readFileSync(manifestPath as string, "utf8"),
    ) as RomManifest;
    const rom = new Rom(new Uint8Array(readFileSync(romPath as string)));
    assert.equal(rom.sha1(), manifest.romSha1, "unexpected ROM revision");

    const ctx = createContext(rom, new Symbols(manifest.symbols), manifest);
    const produced = [
      { name: "constants", value: constantsBuilder.build(ctx) },
      { name: "tilesets", value: tilesetsBuilder.build(ctx) },
    ];
    for (let i = 0; i < produced.length; i += 1) {
      const golden = readFileSync(
        join(goldenDir as string, `${produced[i].name}.json`),
        "utf8",
      );
      assert.equal(
        canonicalJson(produced[i].value),
        golden,
        `${produced[i].name}.json does not match the golden file`,
      );
    }
  },
);
