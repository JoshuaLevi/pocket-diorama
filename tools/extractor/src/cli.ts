/**
 * Node entry point for the extractor.
 *
 * THIS IS THE ONLY FILE IN THE PROJECT THAT TOUCHES THE FILESYSTEM. Everything
 * under src/core, src/types.ts and src/registry.ts takes a Uint8Array in and
 * returns plain objects out, because the same code runs inside the Lens Studio
 * sandbox where node:fs does not exist.
 *
 * Usage:
 *   npx tsx src/cli.ts --rom <rom.gb> --manifest <rom_manifest.json>
 *                      --out <dir> [--only <dataset>]... [--assets <dir>]
 *                      [--list]
 *
 * The leading verb `extract` is accepted and ignored, so both of these work:
 *   npx tsx src/cli.ts extract --rom ... --out ...
 *   npx tsx src/cli.ts --rom ... --out ...
 *
 * Dataset discovery: for each name in DATASET_NAMES the CLI looks for
 * `src/datasets/<name>.ts` (or `<name>/index.ts`) and registers the
 * DatasetBuilder it exports as `builder` or as its default export. A dataset
 * that has not been written yet is skipped silently; a dataset that exists but
 * fails to import is a hard error. Nobody has to edit a shared barrel file.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { openRom } from "./core/Rom";
import { Symbols } from "./core/Symbols";
import { loadDatasets, moduleFor } from "./nodeLoader";
import type { RomManifest } from "./types";
import {
  DATASET_NAMES,
  canonicalJson,
  createContext,
  getDataset,
  listDatasets,
  runDataset,
  type AssetSink,
} from "./registry";


interface CliOptions {
  romPath: string;
  manifestPath: string;
  outDir: string;
  assetsDir: string | null;
  only: string[];
  list: boolean;
}

const USAGE =
  "usage: extract --rom <rom.gb> --manifest <rom_manifest.json> --out <dir>\n" +
  "               [--only <dataset>]... [--assets <dir>] [--list]";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    romPath: "",
    manifestPath: "",
    outDir: "",
    assetsDir: null,
    only: [],
    list: false,
  };

  let index = 0;
  if (argv[index] === "extract") {
    index += 1;
  }

  for (; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--list") {
      options.list = true;
      continue;
    }
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
    } else if (flag === "--out") {
      options.outDir = value;
    } else if (flag === "--assets") {
      options.assetsDir = value;
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

  if (options.romPath === "" || options.manifestPath === "" || options.outDir === "") {
    throw new Error(`--rom, --manifest and --out are all required\n${USAGE}`);
  }
  return options;
}

function readManifest(path: string): RomManifest {
  const text = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: manifest must be a JSON object`);
  }
  const manifest = parsed as RomManifest;
  if (manifest.symbols === undefined || manifest.symbols === null) {
    throw new Error(`${path}: manifest has no 'symbols' table`);
  }
  return manifest;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

/** Asset sink that writes decoded bytes under `root`, refusing to escape it. */
function fileAssetSink(root: string): AssetSink {
  const base = resolve(root);
  return function write(path: string, bytes: Uint8Array): void {
    if (isAbsolute(path)) {
      throw new Error(`asset path must be relative: ${path}`);
    }
    const target = resolve(base, path);
    if (target !== base && target.indexOf(base + "/") !== 0) {
      throw new Error(`asset path escapes the assets directory: ${path}`);
    }
    ensureDir(dirname(target));
    writeFileSync(target, bytes);
  };
}

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);

  const romBytes = new Uint8Array(readFileSync(options.romPath));
  const manifest = readManifest(options.manifestPath);
  const expectedSha1 =
    typeof manifest.romSha1 === "string" ? manifest.romSha1 : null;

  // Throws when the cart is not the exact revision the manifest addresses.
  const rom = openRom(romBytes, expectedSha1);
  const symbols = new Symbols(manifest.symbols);

  process.stdout.write(`rom      ${options.romPath}\n`);
  process.stdout.write(`size     ${rom.length} bytes\n`);
  process.stdout.write(
    `sha1     ${rom.sha1()}` +
      (expectedSha1 === null ? " (manifest has no romSha1)" : " (matches manifest)") +
      "\n",
  );
  process.stdout.write(
    `manifest ${options.manifestPath} (${symbols.size} symbols)\n`,
  );
  process.stdout.write(`out      ${resolve(options.outDir)}\n`);

  const wanted = options.only.length > 0 ? options.only : DATASET_NAMES;
  const discovery = await loadDatasets(wanted);
  // What is actually unwritten is an OUTPUT FILE nobody produces, not a
  // dataset name with no module: `moves` and `type_chart` have no module of
  // their own because the `pokemon` builder emits all three files.
  const pending = discovery.uncoveredOutputs;

  if (options.list) {
    process.stdout.write("\ndatasets\n");
    for (let i = 0; i < DATASET_NAMES.length; i += 1) {
      const name = DATASET_NAMES[i];
      // Three distinct states, because "not registered" is not the same as
      // "not written": --only leaves finished datasets unloaded, and `moves`
      // and `type_chart` have no module at all because the `pokemon` builder
      // writes them. Reporting either as "not written yet" would be a lie.
      let state = "no module of its own";
      if (getDataset(name) !== null) {
        state = "ready";
      } else if (moduleFor(name) !== null) {
        state = "ready, not selected by --only";
      }
      process.stdout.write(`  ${name.padEnd(14)} ${state}\n`);
    }
  }

  const builders = listDatasets();
  if (builders.length === 0) {
    process.stdout.write(
      `\ndatasets 0 of ${wanted.length} implemented` +
        (discovery.missingModules.length > 0
          ? ` (waiting on src/datasets/{${discovery.missingModules.join(",")}}.ts)`
          : "") +
        "\n",
    );
    return 0;
  }

  ensureDir(options.outDir);
  let emitAsset: AssetSink | undefined = undefined;
  if (options.assetsDir !== null) {
    ensureDir(options.assetsDir);
    emitAsset = fileAssetSink(options.assetsDir);
  }
  const ctx = createContext(rom, symbols, manifest, emitAsset);

  process.stdout.write("\n");
  let written = 0;
  for (let i = 0; i < builders.length; i += 1) {
    const builder = builders[i];
    const files = runDataset(builder, ctx);
    for (let j = 0; j < files.length; j += 1) {
      const text = canonicalJson(files[j].value);
      const target = join(options.outDir, files[j].name + ".json");
      // No trailing newline: the golden files were written without one.
      writeFileSync(target, text, "utf8");
      written += 1;
      const size = Buffer.byteLength(text, "utf8");
      process.stdout.write(
        `  ${files[j].name.padEnd(16)} ${String(size).padStart(9)} bytes\n`,
      );
    }
  }

  process.stdout.write(
    `\ndone: ${builders.length} dataset(s), ${written} file(s)` +
      (pending.length > 0 ? `, ${pending.length} file(s) not written yet` : "") +
      "\n",
  );
  if (pending.length > 0) {
    process.stdout.write(`pending: ${pending.join(", ")}\n`);
  }
  return 0;
}

main(process.argv.slice(2))
  .then(function done(code: number): void {
    process.exitCode = code;
  })
  .catch(function failed(error: unknown): void {
    const message =
      error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  });
