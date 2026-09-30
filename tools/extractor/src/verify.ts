/**
 * The acceptance gate.
 *
 * Runs the full extraction against a real cart, serialises every dataset with
 * the same canonical JSON the golden files were written with, and compares the
 * result byte for byte against a golden directory. Prints a per-file PASS/FAIL
 * table and exits non-zero if anything fails.
 *
 * "It looks right" is not the test. The golden directory was produced by
 * gen1recomp's build_rom_data.py against the user's own Pokemon Red
 * (SHA-1 ea9bcae617fdf159b045185467ae58b2e4a48b9a) and converted with
 * tools/lua_to_json.py, which serialises as:
 *
 *     json.dumps(data, ensure_ascii=False, sort_keys=True,
 *                separators=(",", ":"))
 *
 * with no trailing newline. canonicalJson() in src/registry.ts reproduces that
 * exactly, so a passing row means the ported TypeScript and the reference
 * Python agree on every byte -- key order, number formatting, empty tables,
 * and the difference between an omitted key and a null one.
 *
 * Usage:
 *   npx tsx src/verify.ts --rom <rom.gb> --manifest <rom_manifest.json>
 *                         --golden <dir> [--only <dataset>]... [--write <dir>]
 *
 * Like src/cli.ts this file touches the filesystem; nothing under src/core,
 * src/types.ts or src/registry.ts does, because that code also runs inside the
 * Lens Studio sandbox.
 *
 * Exit codes: 0 every compared file matched, 1 something failed or the run
 * could not be set up. A partial run (--only) is labelled PARTIAL in the
 * summary so a green line can never be mistaken for a full gate.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { openRom } from "./core/Rom";
import { Symbols } from "./core/Symbols";
import { loadDatasets } from "./nodeLoader";
import {
  DATASET_NAMES,
  OUTPUT_FILES,
  canonicalJson,
  createContext,
  listDatasets,
  outputsFor,
  runDataset,
} from "./registry";
import type { RomManifest } from "./types";
import { describeDifference, type Difference } from "./verifyDiff";

/* ------------------------------------------------------------------------ */
/* Options                                                                   */
/* ------------------------------------------------------------------------ */

interface VerifyOptions {
  romPath: string;
  manifestPath: string;
  goldenDir: string;
  writeDir: string | null;
  only: string[];
}

const USAGE =
  "usage: verify --rom <rom.gb> --manifest <rom_manifest.json> --golden <dir>\n" +
  "              [--only <dataset>]... [--write <dir>]";

function parseArgs(argv: string[]): VerifyOptions {
  const options: VerifyOptions = {
    romPath: "",
    manifestPath: "",
    goldenDir: "",
    writeDir: null,
    only: [],
  };

  let index = 0;
  if (argv[index] === "verify") {
    index += 1;
  }

  for (; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      throw new Error(USAGE);
    }
    const value = argv[index + 1];
    if (value === undefined || value.indexOf("--") === 0) {
      throw new Error(`${flag} needs a value\n${USAGE}`);
    }
    index += 1;
    if (flag === "--rom") {
      options.romPath = value;
    } else if (flag === "--manifest") {
      options.manifestPath = value;
    } else if (flag === "--golden") {
      options.goldenDir = value;
    } else if (flag === "--write") {
      options.writeDir = value;
    } else if (flag === "--only") {
      if (DATASET_NAMES.indexOf(value) < 0) {
        throw new Error(
          `unknown dataset '${value}'; expected one of ${DATASET_NAMES.join(", ")}`,
        );
      }
      options.only.push(value);
    } else {
      throw new Error(`unknown argument ${flag}\n${USAGE}`);
    }
  }

  if (
    options.romPath === "" ||
    options.manifestPath === "" ||
    options.goldenDir === ""
  ) {
    throw new Error(`--rom, --manifest and --golden are all required\n${USAGE}`);
  }
  return options;
}

function readManifest(path: string): RomManifest {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: manifest must be a JSON object`);
  }
  const manifest = parsed as RomManifest;
  if (manifest.symbols === undefined || manifest.symbols === null) {
    throw new Error(`${path}: manifest has no 'symbols' table`);
  }
  return manifest;
}

/* ------------------------------------------------------------------------ */
/* Results                                                                   */
/* ------------------------------------------------------------------------ */

type Verdict = "PASS" | "FAIL" | "SKIP";

interface FileResult {
  /** Dataset that owns the file, or "-" when nothing produces it. */
  dataset: string;
  file: string;
  verdict: Verdict;
  /** Bytes we produced, or -1 when we produced nothing. */
  ourBytes: number;
  /** Bytes on disk in the golden directory, or -1 when it is absent. */
  goldenBytes: number;
  /** One-line reason, empty for a pass. */
  reason: string;
  /** Structural detail for a byte mismatch. */
  detail: Difference | null;
}

interface ProducedFile {
  dataset: string;
  text: string;
  bytes: Buffer;
  value: unknown;
}

interface ProducedIndex {
  [file: string]: ProducedFile;
}

/** First index at which two buffers differ, or -1 when one is a prefix. */
function firstDifferingByte(a: Buffer, b: Buffer): number {
  const limit = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return -1;
}

/** A window of `text` around `at`, with the surrounding elision marked. */
function windowAround(text: string, at: number, span: number): string {
  const start = at - span < 0 ? 0 : at - span;
  const end = at + span > text.length ? text.length : at + span;
  const head = start > 0 ? "..." : "";
  const tail = end < text.length ? "..." : "";
  return head + text.slice(start, end) + tail;
}

/** First index at which two strings differ, or the shorter length. */
function firstDifferingChar(a: string, b: string): number {
  const limit = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < limit; i += 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      return i;
    }
  }
  return limit;
}

/* ------------------------------------------------------------------------ */
/* The run                                                                   */
/* ------------------------------------------------------------------------ */

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

function goldenFileNames(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`--golden ${dir}: not a directory`);
  }
  const names: string[] = [];
  const entries = readdirSync(dir);
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].slice(-5) === ".json") {
      names.push(entries[i].slice(0, -5));
    }
  }
  names.sort();
  return names;
}

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);

  const romBytes = new Uint8Array(readFileSync(options.romPath));
  const manifest = readManifest(options.manifestPath);
  const expectedSha1 =
    typeof manifest.romSha1 === "string" ? manifest.romSha1 : null;

  // Throws when the cart is not the exact revision the golden files came from.
  const rom = openRom(romBytes, expectedSha1);
  const symbols = new Symbols(manifest.symbols);
  const goldenDir = resolve(options.goldenDir);
  const goldenNames = goldenFileNames(goldenDir);

  const partial = options.only.length > 0;
  const wanted = partial ? options.only : DATASET_NAMES;

  process.stdout.write(`rom       ${options.romPath}\n`);
  process.stdout.write(
    `sha1      ${rom.sha1()}` +
      (expectedSha1 === null
        ? " (manifest has no romSha1 to check against)"
        : " (matches manifest)") +
      "\n",
  );
  process.stdout.write(
    `manifest  ${options.manifestPath} (${symbols.size} symbols)\n`,
  );
  process.stdout.write(
    `golden    ${goldenDir} (${goldenNames.length} json files)\n`,
  );
  if (partial) {
    process.stdout.write(`only      ${options.only.join(", ")}\n`);
  }

  await loadDatasets(wanted);

  // Build everything first, so a builder that throws is attributed to its own
  // dataset instead of aborting the whole table.
  const produced: ProducedIndex = Object.create(null) as ProducedIndex;
  const buildErrors: FileResult[] = [];
  const ctx = createContext(rom, symbols, manifest);
  const builders = listDatasets();

  for (let i = 0; i < builders.length; i += 1) {
    const builder = builders[i];
    const outputs = outputsFor(builder);
    try {
      const files = runDataset(builder, ctx);
      for (let j = 0; j < files.length; j += 1) {
        const text = canonicalJson(files[j].value);
        produced[files[j].name] = {
          dataset: builder.name,
          text: text,
          bytes: Buffer.from(text, "utf8"),
          value: files[j].value,
        };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      for (let j = 0; j < outputs.length; j += 1) {
        buildErrors.push({
          dataset: builder.name,
          file: outputs[j],
          verdict: "FAIL",
          ourBytes: -1,
          goldenBytes: -1,
          reason: `builder threw: ${message}`,
          detail: null,
        });
      }
    }
  }

  if (options.writeDir !== null) {
    mkdirSync(options.writeDir, { recursive: true });
    const names = Object.keys(produced);
    for (let i = 0; i < names.length; i += 1) {
      writeFileSync(
        join(options.writeDir, names[i] + ".json"),
        produced[names[i]].text,
        "utf8",
      );
    }
    process.stdout.write(`wrote     ${resolve(options.writeDir)}\n`);
  }

  // Which files this run is responsible for. A partial run is only responsible
  // for the outputs of the datasets it was asked to build.
  const responsible: string[] = [];
  if (partial) {
    for (let i = 0; i < builders.length; i += 1) {
      const outputs = outputsFor(builders[i]);
      for (let j = 0; j < outputs.length; j += 1) {
        responsible.push(outputs[j]);
      }
    }
  }

  const results: FileResult[] = [];
  for (let i = 0; i < OUTPUT_FILES.length; i += 1) {
    const file = OUTPUT_FILES[i];
    const failed = buildErrors.filter(function match(row: FileResult): boolean {
      return row.file === file;
    });
    if (failed.length > 0) {
      results.push(failed[0]);
      continue;
    }

    const ours = produced[file];
    const goldenPath = join(goldenDir, file + ".json");
    const goldenExists = existsSync(goldenPath);
    const golden = goldenExists ? readFileSync(goldenPath) : null;
    const goldenBytes = golden === null ? -1 : golden.length;

    if (ours === undefined) {
      if (partial && responsible.indexOf(file) < 0) {
        results.push({
          dataset: "-",
          file: file,
          verdict: "SKIP",
          ourBytes: -1,
          goldenBytes: goldenBytes,
          reason: "not selected by --only",
          detail: null,
        });
        continue;
      }
      results.push({
        dataset: "-",
        file: file,
        verdict: "FAIL",
        ourBytes: -1,
        goldenBytes: goldenBytes,
        reason: "no builder produces this file",
        detail: null,
      });
      continue;
    }

    if (golden === null) {
      results.push({
        dataset: ours.dataset,
        file: file,
        verdict: "FAIL",
        ourBytes: ours.bytes.length,
        goldenBytes: -1,
        reason: "golden file is missing",
        detail: null,
      });
      continue;
    }

    if (ours.bytes.equals(golden)) {
      results.push({
        dataset: ours.dataset,
        file: file,
        verdict: "PASS",
        ourBytes: ours.bytes.length,
        goldenBytes: goldenBytes,
        reason: "",
        detail: null,
      });
      continue;
    }

    const goldenText = golden.toString("utf8");
    const at = firstDifferingByte(ours.bytes, golden);
    const charAt = firstDifferingChar(ours.text, goldenText);
    const reason =
      at < 0
        ? `${ours.bytes.length < golden.length ? "truncated" : "longer than golden"} ` +
          `(${ours.bytes.length} vs ${golden.length} bytes)`
        : `first byte differs at offset ${at}`;

    let detail: Difference | null = null;
    try {
      detail = describeDifference(JSON.parse(goldenText), ours.value);
    } catch (error: unknown) {
      detail = {
        path: "$",
        kind: "unparsable",
        golden: error instanceof Error ? error.message : String(error),
        ours: "",
      };
    }
    if (detail !== null) {
      detail.goldenWindow = windowAround(goldenText, charAt, 60);
      detail.ourWindow = windowAround(ours.text, charAt, 60);
    }

    results.push({
      dataset: ours.dataset,
      file: file,
      verdict: "FAIL",
      ourBytes: ours.bytes.length,
      goldenBytes: goldenBytes,
      reason: reason,
      detail: detail,
    });
  }

  /* --------------------------------------------------------------------- */
  /* Report                                                                 */
  /* --------------------------------------------------------------------- */

  process.stdout.write("\n");
  process.stdout.write(
    pad("dataset", 16) +
      pad("file", 22) +
      padLeft("ours", 10) +
      padLeft("golden", 10) +
      "  result\n",
  );
  process.stdout.write("-".repeat(16 + 22 + 10 + 10 + 8) + "\n");

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = 0; i < results.length; i += 1) {
    const row = results[i];
    if (row.verdict === "PASS") {
      passed += 1;
    } else if (row.verdict === "SKIP") {
      skipped += 1;
    } else {
      failed += 1;
    }
    process.stdout.write(
      pad(row.dataset, 16) +
        pad(row.file + ".json", 22) +
        padLeft(row.ourBytes < 0 ? "-" : String(row.ourBytes), 10) +
        padLeft(row.goldenBytes < 0 ? "-" : String(row.goldenBytes), 10) +
        "  " +
        row.verdict +
        (row.reason === "" ? "" : "  " + row.reason) +
        "\n",
    );
  }

  // Anything in the golden directory that the contract does not name at all.
  const stray: string[] = [];
  for (let i = 0; i < goldenNames.length; i += 1) {
    if (OUTPUT_FILES.indexOf(goldenNames[i]) < 0) {
      stray.push(goldenNames[i] + ".json");
    }
  }

  for (let i = 0; i < results.length; i += 1) {
    const row = results[i];
    if (row.verdict !== "FAIL" || row.detail === null) {
      continue;
    }
    const detail = row.detail;
    process.stdout.write(`\n${row.file}.json\n`);
    process.stdout.write(`  ${row.reason}\n`);
    if (detail.goldenWindow !== undefined) {
      process.stdout.write(`    golden : ${detail.goldenWindow}\n`);
      process.stdout.write(`    ours   : ${detail.ourWindow}\n`);
    }
    process.stdout.write(
      `  first structural difference: ${detail.path}  (${detail.kind})\n`,
    );
    process.stdout.write(`    golden : ${detail.golden}\n`);
    process.stdout.write(`    ours   : ${detail.ours}\n`);
  }

  process.stdout.write("\n" + "-".repeat(62) + "\n");
  process.stdout.write(
    `${passed} PASS   ${failed} FAIL   ${skipped} SKIP   of ` +
      `${OUTPUT_FILES.length} contract files\n`,
  );
  if (stray.length > 0) {
    process.stdout.write(
      `note: golden directory has ${stray.length} file(s) the contract does ` +
        `not name: ${stray.join(", ")}\n`,
    );
  }
  if (partial) {
    process.stdout.write(
      "PARTIAL RUN -- --only was given, so this is not the full gate.\n",
    );
  }
  process.stdout.write(failed === 0 ? "VERIFY OK\n" : "VERIFY FAILED\n");
  return failed === 0 ? 0 : 1;
}

main(process.argv.slice(2))
  .then(function done(code: number): void {
    process.exitCode = code;
  })
  .catch(function crashed(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    process.stderr.write("VERIFY FAILED\n");
    process.exitCode = 1;
  });
