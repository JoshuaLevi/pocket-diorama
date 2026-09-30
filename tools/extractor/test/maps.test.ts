/**
 * Acceptance test for the `maps` dataset.
 *
 * The pass condition is not "it looks right": it is byte-identical canonical
 * JSON against the golden maps.json that gen1recomp's build_rom_data.py
 * produced from the canonical Pokemon Red cart. Everything else in this file
 * is there to make a failure legible, and to prove the compare discriminates.
 *
 * Run it:
 *   cd tools/extractor
 *   npx tsx test/maps.test.ts
 *
 * Three inputs, none of which can live in this repository (the ROM is the
 * user's, and the golden JSON is derived from it). Each has an environment
 * override and a documented default:
 *
 *   PX_ROM       the cart image        default: the path in the project brief
 *   PX_MANIFEST  rom_manifest.json     default: the gen1recomp checkout
 *   PX_GOLDEN    golden maps.json      default: tools/golden/json/maps.json,
 *                                      then the gen1recomp golden directory
 *
 * A missing input FAILS the test rather than skipping it. A gate that quietly
 * passes when it cannot run is worse than no gate.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { Rom, openRom } from "../src/core/Rom";
import { Symbols } from "../src/core/Symbols";
import { canonicalJson, createContext, outputsFor, runDataset } from "../src/registry";
import type { MapDef, MapTable, RomManifest } from "../src/types";
import { builder } from "../src/datasets/maps";

const HERE = dirname(fileURLToPath(import.meta.url));
/** tools/extractor/test -> the repository root. */
const REPO_ROOT = resolve(HERE, "..", "..", "..");
/** Where the reference implementation was read from while porting. */
const GEN1RECOMP = resolve(
  "/private/tmp/claude-502",
  "-Users-joshua-Downloads-Spectacles-SPECS-Pokemon-AR",
  "f8d3bac3-e9d7-40f9-9fe8-a68dab85602a",
  "scratchpad",
);

/** First existing candidate, or a thrown explanation naming the override. */
function locate(envName: string, candidates: string[]): string {
  const override = process.env[envName];
  if (override !== undefined && override !== "") {
    if (!existsSync(override)) {
      throw new Error(`${envName}=${override} does not exist`);
    }
    return override;
  }
  for (let i = 0; i < candidates.length; i += 1) {
    if (existsSync(candidates[i])) {
      return candidates[i];
    }
  }
  throw new Error(
    `cannot find the input for ${envName}; set ${envName} explicitly. ` +
      `Tried: ${candidates.join(", ")}`,
  );
}

const ROM_PATH = locate("PX_ROM", [
  join(process.env.HOME ?? "", "Downloads", "Pokemon - Red Version (USA, Europe).gb"),
]);
const MANIFEST_PATH = locate("PX_MANIFEST", [
  join(GEN1RECOMP, "gen1recomp", "tools", "rom_manifest.json"),
]);
const GOLDEN_PATH = locate("PX_GOLDEN", [
  join(REPO_ROOT, "tools", "golden", "json", "maps.json"),
  join(GEN1RECOMP, "golden", "json", "maps.json"),
]);

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as RomManifest;
const romBytes = new Uint8Array(readFileSync(ROM_PATH));
const rom = openRom(romBytes, manifest.romSha1);
const symbols = new Symbols(manifest.symbols);
const ctx = createContext(rom, symbols, manifest);

const files = runDataset(builder, ctx);
const maps = files[0].value as MapTable;
const actualJson = canonicalJson(maps);
const goldenJson = readFileSync(GOLDEN_PATH, "utf8");

/** Where two strings first diverge, with a window of context on both sides. */
function firstDifference(expected: string, actual: string): string {
  const limit = Math.min(expected.length, actual.length);
  let at = limit;
  for (let i = 0; i < limit; i += 1) {
    if (expected[i] !== actual[i]) {
      at = i;
      break;
    }
  }
  const from = Math.max(0, at - 80);
  const to = at + 80;
  return (
    `first difference at byte ${at} of ` +
    `${expected.length} (golden) / ${actual.length} (actual)\n` +
    `  golden: ...${expected.slice(from, to)}...\n` +
    `  actual: ...${actual.slice(from, to)}...`
  );
}

test("builder is registered under the contract's name and single output", () => {
  assert.equal(builder.name, "maps");
  assert.deepEqual(outputsFor(builder), ["maps"]);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "maps");
});

test("maps.json is byte-identical to the golden file", () => {
  if (actualJson !== goldenJson) {
    assert.fail(firstDifference(goldenJson, actualJson));
  }
  assert.equal(actualJson.length, goldenJson.length);
});

test("all 222 maps decode, each with width*height blocks", () => {
  const ids = Object.keys(maps);
  assert.equal(ids.length, 222);
  assert.equal(ids.length, Object.keys(manifest.maps).length);
  for (let i = 0; i < ids.length; i += 1) {
    const map: MapDef = maps[ids[i]];
    assert.equal(map.id, ids[i]);
    assert.equal(
      map.blocks.length,
      map.width * map.height,
      `${map.id}: ${map.blocks.length} blocks for ${map.width}x${map.height}`,
    );
    assert.match(map.source, /^ROM:[0-9A-F]{2}:[0-9A-F]{4}$/);
  }
});

test("PALLET_TOWN is 10x9 and connects north to ROUTE_1, south to ROUTE_21", () => {
  const pallet = maps["PALLET_TOWN"];
  assert.equal(pallet.width, 10);
  assert.equal(pallet.height, 9);
  assert.equal(pallet.blocks.length, 90);
  assert.equal(pallet.index, 0);
  assert.equal(pallet.label, "PalletTown");
  assert.equal(pallet.tileset, "OVERWORLD");
  assert.equal(pallet.borderBlock, 11);
  assert.deepEqual(pallet.connections, {
    north: { map: "ROUTE_1", offset: 0 },
    south: { map: "ROUTE_21", offset: 0 },
  });
  assert.equal(pallet.connections.east, undefined);
  assert.equal(pallet.connections.west, undefined);
  // Three warps: the player's house, the rival's house, Oak's lab.
  assert.deepEqual(pallet.warps, [
    { x: 5, y: 5, destMap: "REDS_HOUSE_1F", destWarp: 1 },
    { x: 13, y: 5, destMap: "BLUES_HOUSE", destWarp: 1 },
    { x: 12, y: 11, destMap: "OAKS_LAB", destWarp: 2 },
  ]);
  assert.equal(pallet.signs.length, 4);
  assert.equal(pallet.objects.length, 3);
  assert.deepEqual(pallet.objects[0], {
    index: 1,
    x: 8,
    y: 5,
    sprite: "SPRITE_OAK",
    movement: "STAY",
    range: "NONE",
    text: "TEXT_PALLETTOWN_OAK",
    name: "PALLETTOWN_OAK",
    hidden: true,
  });
});

test("ROUTE_1 is 10x18 with borderBlock 11", () => {
  const route = maps["ROUTE_1"];
  assert.equal(route.width, 10);
  assert.equal(route.height, 18);
  assert.equal(route.blocks.length, 180);
  assert.equal(route.borderBlock, 11);
  assert.equal(route.tileset, "OVERWORLD");
  // Kanto's edges are stitched both ways: Route 1 comes back down to Pallet.
  assert.equal(route.connections.south?.map, "PALLET_TOWN");
});

test("connection offsets are whole blocks, never a half block", () => {
  const ids = Object.keys(maps);
  let seen = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const connections = maps[ids[i]].connections;
    const directions = ["north", "south", "east", "west"];
    for (let j = 0; j < directions.length; j += 1) {
      const connection = (connections as { [key: string]: { offset: number } | undefined })[
        directions[j]
      ];
      if (connection === undefined) {
        continue;
      }
      seen += 1;
      assert.equal(
        Number.isInteger(connection.offset),
        true,
        `${ids[i]}.${directions[j]}: offset ${connection.offset} is not whole`,
      );
      // -0 serialises as 0, so the golden compare cannot see it. It still
      // breaks Object.is and sign-sensitive arithmetic downstream.
      assert.equal(
        Object.is(connection.offset, -0),
        false,
        `${ids[i]}.${directions[j]}: offset is negative zero`,
      );
    }
  }
  // 36 of the 222 maps are outdoors and stitched to a neighbour.
  assert.equal(seen > 0, true);
});

test("the compare discriminates: a corrupted header is rejected", () => {
  // Flip PalletTown_h's width byte. The manifest still says 10, so the port
  // must refuse rather than emit a map whose block count no longer matches.
  const header = symbols.get("PalletTown_h");
  const widthOffset = Rom.offset(header.bank, header.address + 2);
  const corrupted = romBytes.slice();
  assert.equal(corrupted[widthOffset], 10);
  corrupted[widthOffset] = 11;
  const corruptedCtx = createContext(new Rom(corrupted), symbols, manifest);
  assert.throws(
    () => builder.build(corruptedCtx),
    /PALLET_TOWN: ROM dimensions 11x9 do not match manifest 10x9/,
  );
});
