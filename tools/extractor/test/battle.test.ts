/**
 * Tests for the battle-side datasets (encounters, items, trainers).
 *
 * Two layers:
 *
 *   1. Synthetic ROMs built in memory. These always run and pin the two pieces
 *      of control flow that a golden diff would only report as "everything is
 *      shifted": a wild section with rate 0 occupies one byte, not 21, and a
 *      trainer's party list is bounded by the NEXT trainer's pointer.
 *
 *   2. A byte-for-byte compare against the golden JSON, which is the real
 *      acceptance test. It needs the user's own cart and the golden directory,
 *      neither of which is in the repo, so it skips loudly when they are
 *      missing instead of silently passing.
 *
 * Run:
 *   npx tsx test/battle.test.ts
 *   PX_ROM=... PX_MANIFEST=... PX_GOLDEN=... npx tsx test/battle.test.ts
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Rom } from "../src/core/Rom";
import { Symbols } from "../src/core/Symbols";
import { canonicalJson, createContext } from "../src/registry";
import type { RomManifest } from "../src/types";
import {
  buildEncounters,
  buildItems,
  buildTrainers,
} from "../src/datasets/battle";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_ROOT = join(HERE, "..");
const REPO_ROOT = join(EXTRACTOR_ROOT, "..", "..");

const ROM_PATH =
  process.env.PX_ROM ??
  join(homedir(), "Downloads", "Pokemon - Red Version (USA, Europe).gb");
const MANIFEST_PATH =
  process.env.PX_MANIFEST ?? join(REPO_ROOT, "tools", "rom_manifest.json");
const GOLDEN_DIR =
  process.env.PX_GOLDEN ?? join(REPO_ROOT, "tools", "golden", "json");

/* ------------------------------------------------------------------------ */
/* Synthetic ROM helpers                                                      */
/* ------------------------------------------------------------------------ */

const BANK = 1;
const BANK_BASE = 0x4000;

/** A two-bank blank cart, so bank 1 addresses $4000-$7FFF are all writable. */
function blankRom(): Uint8Array {
  return new Uint8Array(0x8000);
}

/** Write bytes at a bank-1 CPU address. */
function poke(image: Uint8Array, address: number, values: number[]): void {
  const offset = BANK * BANK_BASE + (address - BANK_BASE);
  for (let i = 0; i < values.length; i += 1) {
    image[offset + i] = values[i];
  }
}

/** Little-endian word, the way every Gen 1 pointer table stores one. */
function word(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

/**
 * A manifest with only the fields these three datasets read. Cast at the end
 * because RomManifest describes all sixteen datasets and filling it in would
 * bury what the test is actually saying.
 */
function fakeManifest(overrides: { [key: string]: unknown }): RomManifest {
  const base: { [key: string]: unknown } = {
    charmap: { "128": "A", "129": "B", "130": "C", "131": "D" },
    constants: {
      mapOrder: [],
      speciesOrder: ["BULBASAUR", "IVYSAUR", "VENUSAUR", "CHARMANDER"],
    },
    hms: [],
    items: [],
    numItems: 0,
    tms: [],
    trainerPics: [],
    trainers: [],
  };
  const keys = Object.keys(overrides);
  for (let i = 0; i < keys.length; i += 1) {
    base[keys[i]] = overrides[keys[i]];
  }
  return base as unknown as RomManifest;
}

function contextFor(
  image: Uint8Array,
  symbols: { [name: string]: number[] },
  manifest: RomManifest,
) {
  return createContext(new Rom(image), new Symbols(symbols), manifest);
}

/* ------------------------------------------------------------------------ */
/* encounters                                                                 */
/* ------------------------------------------------------------------------ */

test("a rate of 0 makes a wild section one byte, not twenty-one", () => {
  const image = blankRom();

  // Pointer table: a real table, the shared stub, and a both-rates-zero table.
  poke(image, 0x4000, [...word(0x4200), ...word(0x4100), ...word(0x4300)]);

  // Grass rate 25 with ten slots, then water rate 0 immediately after.
  const grass: number[] = [25];
  for (let i = 0; i < 10; i += 1) {
    grass.push(3 + i, 1 + (i % 2));
  }
  poke(image, 0x4200, [...grass, 0]);

  // Both sections empty: two rate bytes back to back.
  poke(image, 0x4300, [0, 0]);

  const manifest = fakeManifest({
    constants: {
      mapOrder: ["MAP_REAL", "MAP_NONE", "MAP_EMPTY"],
      speciesOrder: ["BULBASAUR", "IVYSAUR", "VENUSAUR", "CHARMANDER"],
    },
  });
  const ctx = contextFor(
    image,
    { WildDataPointers: [BANK, 0x4000], NothingWildMons: [BANK, 0x4100] },
    manifest,
  );

  const out = buildEncounters(ctx);

  // The stub map is absent entirely; the zero-rate map keeps only `source`.
  assert.deepEqual(Object.keys(out).sort(), ["MAP_EMPTY", "MAP_REAL"]);
  assert.equal(canonicalJson(out.MAP_EMPTY), '{"source":"ROM:01:4300"}');

  const real = out.MAP_REAL;
  assert.equal(real.source, "ROM:01:4200");
  assert.equal(real.water, undefined, "water rate 0 must omit the key");
  assert.equal(real.grass?.rate, 25);
  assert.equal(real.grass?.slots.length, 10);
  // Water's rate byte sat at $420F, right after the grass slots; had the
  // decoder assumed a fixed-size record it would have read a species byte.
  assert.deepEqual(real.grass?.slots[0], { level: 3, species: "BULBASAUR" });
  assert.deepEqual(real.grass?.slots[9], { level: 12, species: "IVYSAUR" });
});

/* ------------------------------------------------------------------------ */
/* trainers                                                                   */
/* ------------------------------------------------------------------------ */

/** Two trainers, one party each, one per party encoding. */
function trainerFixture(trainerAiAddress: number) {
  const image = blankRom();

  poke(image, 0x4000, [0x80, 0x81, 0x50, 0x82, 0x83, 0x50]); // "AB", "CD"
  poke(image, 0x4010, [1, 0, 1, 2, 0]); // AI mods: [1] and [1, 2]
  poke(image, 0x4020, [
    0, 0, 0x00, 0x15, 0x00, // pic pointer + BCD 001500 -> 15
    0, 0, 0x00, 0x30, 0x00, // pic pointer + BCD 003000 -> 30
  ]);
  poke(image, 0x4040, [...word(0x4100), ...word(0x4104)]);

  // Shared level: one level byte, then species until a zero species.
  poke(image, 0x4100, [0x0b, 0x01, 0x02, 0x00]);
  // Per-member levels: $FF, then (level, species) until a zero level.
  poke(image, 0x4104, [0xff, 0x14, 0x03, 0x00]);

  const manifest = fakeManifest({
    trainers: ["ALPHA", "BETA"],
    trainerPics: [
      { imageBase: "alpha", label: "AlphaPic", path: "assets/alpha.png" },
      null,
    ],
  });
  const ctx = contextFor(
    image,
    {
      TrainerNames: [BANK, 0x4000],
      TrainerClassMoveChoiceModifications: [BANK, 0x4010],
      TrainerPicAndMoneyPointers: [BANK, 0x4020],
      TrainerDataPointers: [BANK, 0x4040],
      TrainerAI: [BANK, trainerAiAddress],
    },
    manifest,
  );
  return ctx;
}

test("both trainer party encodings decode, and a missing pic is null", () => {
  const out = buildTrainers(trainerFixture(0x4108));

  assert.deepEqual(Object.keys(out).sort(), ["OPP_ALPHA", "OPP_BETA"]);
  assert.equal(
    canonicalJson(out.OPP_ALPHA),
    '{"aiMods":[1],"baseMoney":15,"id":"OPP_ALPHA","index":1,"name":"AB",' +
      '"parties":[[{"level":11,"species":"BULBASAUR"},' +
      '{"level":11,"species":"IVYSAUR"}]],"pic":"assets/alpha.png",' +
      '"source":"ROM:TrainerDataPointers"}',
  );
  assert.equal(
    canonicalJson(out.OPP_BETA),
    '{"aiMods":[1,2],"baseMoney":30,"id":"OPP_BETA","index":2,"name":"CD",' +
      '"parties":[[{"level":20,"species":"VENUSAUR"}]],"pic":null,' +
      '"source":"ROM:TrainerDataPointers"}',
  );
});

test("party data that overruns its end address throws", () => {
  // TrainerAI one byte past the real end: the last party no longer lands on
  // the boundary, which is how a misread pointer shows up.
  assert.throws(
    () => buildTrainers(trainerFixture(0x4109)),
    /trainer party data overran 01:4109/,
  );
});

/* ------------------------------------------------------------------------ */
/* Golden compare                                                             */
/* ------------------------------------------------------------------------ */

function missingInputs(): string[] {
  const missing: string[] = [];
  if (!existsSync(ROM_PATH)) {
    missing.push(`ROM (PX_ROM=${ROM_PATH})`);
  }
  if (!existsSync(MANIFEST_PATH)) {
    missing.push(`manifest (PX_MANIFEST=${MANIFEST_PATH})`);
  }
  if (!existsSync(GOLDEN_DIR)) {
    missing.push(`golden JSON (PX_GOLDEN=${GOLDEN_DIR})`);
  }
  return missing;
}

const missing = missingInputs();
const skip = missing.length > 0 ? `missing ${missing.join(", ")}` : false;

test("output is byte-identical to the golden JSON", { skip: skip }, () => {
  const manifest = JSON.parse(
    readFileSync(MANIFEST_PATH, "utf8"),
  ) as RomManifest;
  const rom = new Rom(new Uint8Array(readFileSync(ROM_PATH)));
  assert.equal(
    rom.sha1(),
    manifest.romSha1,
    "the cart is not the revision the manifest addresses",
  );
  const ctx = createContext(rom, new Symbols(manifest.symbols), manifest);

  const produced: { [name: string]: string } = {
    encounters: canonicalJson(buildEncounters(ctx)),
    items: canonicalJson(buildItems(ctx)),
    trainers: canonicalJson(buildTrainers(ctx)),
  };

  const names = Object.keys(produced).sort();
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const golden = readFileSync(join(GOLDEN_DIR, name + ".json"), "utf8");
    assert.equal(
      produced[name].length,
      golden.length,
      `${name}.json: ${produced[name].length} bytes, golden has ${golden.length}`,
    );
    assert.equal(produced[name], golden, `${name}.json differs from golden`);
  }
});

test("the golden datasets have the shape the ROM should give", { skip: skip }, () => {
  const manifest = JSON.parse(
    readFileSync(MANIFEST_PATH, "utf8"),
  ) as RomManifest;
  const rom = new Rom(new Uint8Array(readFileSync(ROM_PATH)));
  const ctx = createContext(rom, new Symbols(manifest.symbols), manifest);

  const encounters = buildEncounters(ctx);
  assert.equal(Object.keys(encounters).length, 59, "maps with wild tables");
  const route1 = encounters.ROUTE_1;
  assert.equal(route1.grass?.rate, 25);
  assert.deepEqual(route1.grass?.slots[0], { level: 3, species: "PIDGEY" });
  assert.deepEqual(route1.grass?.slots[1], { level: 3, species: "RATTATA" });
  assert.equal(route1.water, undefined);

  const items = buildItems(ctx);
  assert.equal(Object.keys(items).length, 152);
  assert.equal(items.MASTER_BALL.name, "MASTER BALL");
  assert.equal(items.BICYCLE.keyItem, true);
  assert.equal(items.ANTIDOTE.keyItem, undefined);
  assert.equal(items.ANTIDOTE.price, 100);
  assert.equal(items.TM_MEGA_PUNCH.price, 3000);
  assert.equal(items.TM_MEGA_PUNCH.index, undefined, "TMs carry no item index");
  assert.equal(items.HM_CUT.name, "HM01");

  const trainers = buildTrainers(ctx);
  assert.equal(Object.keys(trainers).length, 47);
  assert.equal(trainers.OPP_BROCK.parties.length, 1);
  assert.equal(trainers.OPP_CHIEF.pic, null);
  assert.deepEqual(trainers.OPP_CHIEF.parties, []);
  assert.equal(trainers.OPP_AGATHA.baseMoney, 99);
});
