/**
 * Acceptance test for the `pokemon` dataset (pokemon.json, moves.json,
 * type_chart.json).
 *
 * Run with:
 *   npx tsx --test test/pokemon.test.ts
 *
 * The golden compare needs the user's own cart, which is deliberately not in
 * this repository and never will be, so those cases SKIP rather than fail when
 * it is absent. Point them at your own copy with:
 *
 *   POKEMON_AR_ROM=/path/to/pokered.gb \
 *   POKEMON_AR_MANIFEST=/path/to/rom_manifest.json \
 *   POKEMON_AR_GOLDEN=/path/to/golden/json \
 *   npx tsx --test test/pokemon.test.ts
 *
 * The structural cases below need none of that and always run.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { openRom } from "../src/core/Rom";
import { Symbols } from "../src/core/Symbols";
import {
  canonicalJson,
  createContext,
  outputsFor,
  runDataset,
  type DatasetFile,
} from "../src/registry";
import type { RomManifest } from "../src/types";
import { builder } from "../src/datasets/pokemon";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_ROOT = join(HERE, "..");

const ROM_PATH =
  process.env.POKEMON_AR_ROM ??
  join(homedir(), "Downloads", "Pokemon - Red Version (USA, Europe).gb");
const MANIFEST_PATH = process.env.POKEMON_AR_MANIFEST ?? "";
const GOLDEN_DIR =
  process.env.POKEMON_AR_GOLDEN ?? join(EXTRACTOR_ROOT, "..", "golden", "json");

/** Every file this builder claims, in the order it declares them. */
const OUTPUTS = outputsFor(builder);

/* ------------------------------------------------------------------------ */
/* Structural cases: no ROM required                                         */
/* ------------------------------------------------------------------------ */

test("the builder declares the three files it owns", function () {
  assert.equal(builder.name, "pokemon");
  assert.deepEqual(OUTPUTS.slice().sort(), [
    "moves",
    "pokemon",
    "type_chart",
  ]);
});

test("runDataset rejects a build that drops one of its outputs", function () {
  const truncated = {
    name: builder.name,
    outputs: OUTPUTS,
    build(): unknown {
      return { moves: {}, pokemon: {} };
    },
  };
  assert.throws(
    function () {
      runDataset(truncated, createContext(FAKE_ROM(), FAKE_SYMBOLS(), {} as RomManifest));
    },
    /did not return output 'type_chart'/,
  );
});

function FAKE_ROM() {
  // One byte is enough: this context never reaches a read.
  return openRom(new Uint8Array([0]));
}

function FAKE_SYMBOLS(): Symbols {
  return new Symbols({});
}

/* ------------------------------------------------------------------------ */
/* Golden compare: needs the cart                                            */
/* ------------------------------------------------------------------------ */

function missingInput(): string | null {
  if (MANIFEST_PATH === "") {
    return "POKEMON_AR_MANIFEST is not set";
  }
  if (!existsSync(ROM_PATH)) {
    return `no ROM at ${ROM_PATH}`;
  }
  if (!existsSync(MANIFEST_PATH)) {
    return `no manifest at ${MANIFEST_PATH}`;
  }
  for (let i = 0; i < OUTPUTS.length; i += 1) {
    const golden = join(GOLDEN_DIR, OUTPUTS[i] + ".json");
    if (!existsSync(golden)) {
      return `no golden file at ${golden}`;
    }
  }
  return null;
}

/**
 * Where two strings first differ, with enough context to name the key.
 * A 140 KB assert.equal diff is unreadable; this is not.
 */
function firstDifference(actual: string, expected: string): string {
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) {
    at += 1;
  }
  const from = Math.max(0, at - 80);
  return (
    `first difference at byte ${at} of ${expected.length} ` +
    `(actual is ${actual.length} bytes)\n` +
    `  expected: ...${expected.slice(from, at + 80)}\n` +
    `  actual:   ...${actual.slice(from, at + 80)}`
  );
}

function buildOutputs(): DatasetFile[] {
  const manifestText = readFileSync(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(manifestText) as RomManifest;
  const rom = openRom(new Uint8Array(readFileSync(ROM_PATH)), manifest.romSha1);
  const symbols = new Symbols(manifest.symbols);
  return runDataset(builder, createContext(rom, symbols, manifest));
}

const skip = missingInput();

test("every output is byte-identical to the golden JSON", { skip: skip ?? false }, function () {
  const files = buildOutputs();
  assert.equal(files.length, OUTPUTS.length);
  for (let i = 0; i < files.length; i += 1) {
    const actual = canonicalJson(files[i].value);
    const expected = readFileSync(
      join(GOLDEN_DIR, files[i].name + ".json"),
      "utf8",
    );
    // assert.ok, not assert.equal: a 140 KB inline diff buries the one byte
    // that actually moved.
    assert.ok(
      actual === expected,
      `${files[i].name}.json: ${firstDifference(actual, expected)}`,
    );
  }
});

test("the port keeps the counts the reference produced", { skip: skip ?? false }, function () {
  const files = buildOutputs();
  const byName: { [name: string]: unknown } = Object.create(null) as {
    [name: string]: unknown;
  };
  for (let i = 0; i < files.length; i += 1) {
    byName[files[i].name] = files[i].value;
  }

  const species = byName["pokemon"] as { [id: string]: { dex: number } };
  assert.equal(Object.keys(species).length, 151, "151 species survive the skip list");
  assert.equal(species["BULBASAUR"].dex, 1);

  const moves = byName["moves"] as { [id: string]: unknown };
  assert.equal(Object.keys(moves).length, 165);

  const chart = byName["type_chart"] as {
    matchups: unknown[];
    names: string[];
  };
  assert.equal(chart.matchups.length, 82);
  assert.equal(chart.names.length, 16);
});
