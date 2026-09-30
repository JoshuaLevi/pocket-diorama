/**
 * ============================================================================
 * THE DATASET CONTRACT
 * ============================================================================
 *
 * Read this before writing a dataset. Five datasets are being ported in
 * parallel against this file; nothing here will change under you.
 *
 * ---------------------------------------------------------------------------
 * 1. Where your code goes
 * ---------------------------------------------------------------------------
 *
 * One file per dataset, at `src/datasets/<name>.ts`, where <name> is one of
 * DATASET_NAMES below and matches the golden filename. The file exports a
 * DatasetBuilder as `builder` (a default export also works):
 *
 *     import type { DatasetBuilder, ExtractContext } from "../registry";
 *     import type { MoveTable } from "../types";
 *
 *     export const builder: DatasetBuilder = {
 *       name: "moves",
 *       build(ctx: ExtractContext): MoveTable {
 *         // ...
 *       },
 *     };
 *
 * The CLI discovers those files by name. Nobody edits a shared barrel, so no
 * two agents ever touch the same file.
 *
 * ---------------------------------------------------------------------------
 * 2. What build() gets
 * ---------------------------------------------------------------------------
 *
 * ExtractContext, and nothing else. No filesystem, no network, no globals:
 * this code has to run inside the Lens Studio sandbox unchanged.
 *
 *   ctx.rom       Rom      banked reads: byte / word / bytes / readTerminated
 *   ctx.symbols   Symbols  name -> { bank, address, name }; get() throws when missing
 *   ctx.manifest  RomManifest  the bundled metadata (charmap, orders, labels)
 *   ctx.emitAsset (path, bytes) => void
 *                          optional sink for decoded pixel data. NOT part of
 *                          the JSON contract -- the golden files only contain
 *                          asset PATH STRINGS, which you build from the
 *                          manifest. Ignore it unless you want a debug dump.
 *
 * ---------------------------------------------------------------------------
 * 3. What build() returns
 * ---------------------------------------------------------------------------
 *
 * Plain JSON-shaped data: objects, arrays, strings, finite numbers, booleans
 * and null. No class instances, no Map/Set, no functions, no Uint8Array.
 *
 * Single-output dataset (the usual case): return the value for
 * `<name>.json` and leave `outputs` unset.
 *
 * Multi-output dataset: set `outputs` to the file basenames you produce and
 * return an object keyed by exactly those names. Only `text` needs this:
 *
 *     export const builder: DatasetBuilder = {
 *       name: "text",
 *       outputs: ["text", "text_pointers", "trainer_headers"],
 *       build(ctx) {
 *         return { text: {...}, text_pointers: {...}, trainer_headers: {...} };
 *       },
 *     };
 *
 * ---------------------------------------------------------------------------
 * 4. Matching the golden output exactly
 * ---------------------------------------------------------------------------
 *
 * The acceptance test is byte-identical canonical JSON against
 * tools/golden/json/<file>.json. canonicalJson() below is that serialisation.
 * Three rules follow from it, and each one has bitten the reference:
 *
 *   a. An OMITTED key and a NULL key are different. The golden files were
 *      produced through a Lua table, so a key the reference dropped is simply
 *      absent, while `pic = nil` came out as JSON null. Return `undefined`
 *      (or do not set the key) to omit; return `null` to emit null. Getting
 *      this backwards is the single most common way to fail the compare.
 *
 *   b. An empty object serialises as `[]`, not `{}`. Lua cannot tell an empty
 *      map from an empty list, so the golden files have `[]` everywhere. This
 *      is handled for you -- just do not work around it.
 *
 *   c. Key order does not matter. Keys are sorted at serialisation time.
 *      Array order matters completely.
 *
 * Compare your work with:
 *   npx tsx src/cli.ts --rom <rom> --manifest <manifest> --out /tmp/px \
 *     --only <name>
 *   diff /tmp/px/<name>.json tools/golden/json/<name>.json
 */

import type { Rom } from "./core/Rom";
import type { Symbols } from "./core/Symbols";
import type { RomManifest } from "./types";

/** Sink for decoded binary assets. May discard; never part of the JSON diff. */
export type AssetSink = (path: string, bytes: Uint8Array) => void;

/** Everything a dataset builder is allowed to read. */
export interface ExtractContext {
  rom: Rom;
  symbols: Symbols;
  manifest: RomManifest;
  emitAsset: AssetSink;
}

/** One dataset: a name, the files it writes, and the code that builds them. */
export interface DatasetBuilder {
  /** One of DATASET_NAMES. */
  name: string;
  /**
   * Output file basenames, without `.json`. Defaults to `[name]`. When this
   * lists more than one file, `build()` must return an object keyed by
   * exactly these names.
   */
  outputs?: string[];
  build(ctx: ExtractContext): unknown;
}

/** One serialisable output file produced by a builder. */
export interface DatasetFile {
  name: string;
  value: unknown;
}

/** The 16 datasets, in the order build_rom_data.py runs them. */
export const DATASET_NAMES: string[] = [
  "constants",
  "tilesets",
  "maps",
  "font",
  "sprites",
  "moves",
  "items",
  "type_chart",
  "palettes",
  "icons",
  "pokemon",
  "trainers",
  "encounters",
  "text",
  "field",
  "battle_anims",
];

/** The 18 golden files. `text` produces three of them. */
export const OUTPUT_FILES: string[] = [
  "battle_anims",
  "constants",
  "encounters",
  "field",
  "font",
  "icons",
  "items",
  "maps",
  "moves",
  "palettes",
  "pokemon",
  "sprites",
  "text",
  "text_pointers",
  "tilesets",
  "trainer_headers",
  "trainers",
  "type_chart",
];

interface BuilderIndex {
  [name: string]: DatasetBuilder;
}

const registered: BuilderIndex = Object.create(null) as BuilderIndex;

/** Build an ExtractContext, defaulting the asset sink to a no-op. */
export function createContext(
  rom: Rom,
  symbols: Symbols,
  manifest: RomManifest,
  emitAsset?: AssetSink,
): ExtractContext {
  return {
    rom: rom,
    symbols: symbols,
    manifest: manifest,
    emitAsset:
      emitAsset === undefined
        ? function discard(): void {
            /* assets are not part of the JSON contract */
          }
        : emitAsset,
  };
}

/** File basenames a builder writes. */
export function outputsFor(builder: DatasetBuilder): string[] {
  if (builder.outputs === undefined || builder.outputs.length === 0) {
    return [builder.name];
  }
  return builder.outputs.slice();
}

/** Add a builder to the registry. Registering a name twice is an error. */
export function registerDataset(builder: DatasetBuilder): void {
  if (builder === null || typeof builder !== "object") {
    throw new Error("registerDataset expects a DatasetBuilder object");
  }
  if (typeof builder.name !== "string" || builder.name === "") {
    throw new Error("dataset builder is missing a name");
  }
  if (typeof builder.build !== "function") {
    throw new Error(`dataset '${builder.name}' is missing build()`);
  }
  if (DATASET_NAMES.indexOf(builder.name) < 0) {
    throw new Error(
      `unknown dataset '${builder.name}'; expected one of ` +
        DATASET_NAMES.join(", "),
    );
  }
  const outputs = outputsFor(builder);
  for (let i = 0; i < outputs.length; i += 1) {
    if (OUTPUT_FILES.indexOf(outputs[i]) < 0) {
      throw new Error(
        `dataset '${builder.name}' declares unknown output '${outputs[i]}'`,
      );
    }
  }
  if (registered[builder.name] !== undefined) {
    throw new Error(`dataset '${builder.name}' is already registered`);
  }
  registered[builder.name] = builder;
}

/** Look up a registered builder, or null. */
export function getDataset(name: string): DatasetBuilder | null {
  const builder = registered[name];
  return builder === undefined ? null : builder;
}

/** Registered builders, in DATASET_NAMES order. */
export function listDatasets(): DatasetBuilder[] {
  const out: DatasetBuilder[] = [];
  for (let i = 0; i < DATASET_NAMES.length; i += 1) {
    const builder = registered[DATASET_NAMES[i]];
    if (builder !== undefined) {
      out.push(builder);
    }
  }
  return out;
}

/** Drop every registration. For tests. */
export function clearDatasets(): void {
  const names = Object.keys(registered);
  for (let i = 0; i < names.length; i += 1) {
    delete registered[names[i]];
  }
}

/**
 * Run a builder and normalise its return value into output files.
 *
 * A multi-output builder must return an object carrying exactly the keys it
 * declared; a missing or surplus key throws here rather than producing a file
 * set that quietly does not match the golden directory.
 */
export function runDataset(
  builder: DatasetBuilder,
  ctx: ExtractContext,
): DatasetFile[] {
  const outputs = outputsFor(builder);
  const value = builder.build(ctx);

  if (outputs.length === 1) {
    return [{ name: outputs[0], value: value }];
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `dataset '${builder.name}' declares ${outputs.length} outputs, so ` +
        `build() must return an object keyed by ${outputs.join(", ")}`,
    );
  }
  const bag = value as { [key: string]: unknown };
  const files: DatasetFile[] = [];
  for (let i = 0; i < outputs.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(bag, outputs[i])) {
      throw new Error(
        `dataset '${builder.name}' did not return output '${outputs[i]}'`,
      );
    }
    files.push({ name: outputs[i], value: bag[outputs[i]] });
  }
  const extra = Object.keys(bag);
  for (let i = 0; i < extra.length; i += 1) {
    if (outputs.indexOf(extra[i]) < 0) {
      throw new Error(
        `dataset '${builder.name}' returned undeclared output '${extra[i]}'`,
      );
    }
  }
  return files;
}

/* ------------------------------------------------------------------------ */
/* Canonical JSON                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Serialise exactly the way the golden files were serialised.
 *
 * The golden JSON came from Python:
 *   json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
 * written without a trailing newline. So: keys sorted, no whitespace, non-ASCII
 * left as-is.
 *
 * Two deliberate deviations from JSON.stringify, both required for parity:
 *   - An empty object emits `[]`. The reference passed through a Lua table,
 *     where an empty map and an empty list are the same value.
 *   - `undefined` omits its key (as JSON.stringify does) but throws inside an
 *     array, where JSON.stringify would silently substitute null.
 */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  writeValue(value, out, "$");
  return out.join("");
}

function writeValue(value: unknown, out: string[], path: string): void {
  if (value === null) {
    out.push("null");
    return;
  }
  const kind = typeof value;
  if (kind === "boolean") {
    out.push(value === true ? "true" : "false");
    return;
  }
  if (kind === "number") {
    const numeric = value as number;
    if (!Number.isFinite(numeric)) {
      throw new Error(`${path}: ${String(numeric)} is not representable in JSON`);
    }
    out.push(String(numeric));
    return;
  }
  if (kind === "string") {
    out.push(JSON.stringify(value as string));
    return;
  }
  if (kind === "undefined") {
    throw new Error(`${path}: undefined cannot be serialised here`);
  }
  if (kind !== "object") {
    throw new Error(`${path}: cannot serialise a ${kind}`);
  }

  if (Array.isArray(value)) {
    out.push("[");
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) {
        out.push(",");
      }
      writeValue(value[i], out, path + "[" + i + "]");
    }
    out.push("]");
    return;
  }

  if (ArrayBuffer.isView(value)) {
    throw new Error(
      `${path}: typed arrays are not JSON; convert to a plain number array`,
    );
  }

  const record = value as { [key: string]: unknown };
  const keys: string[] = [];
  const names = Object.keys(record);
  for (let i = 0; i < names.length; i += 1) {
    if (record[names[i]] !== undefined) {
      keys.push(names[i]);
    }
  }
  if (keys.length === 0) {
    // A Lua table with no entries is indistinguishable from an empty list.
    out.push("[]");
    return;
  }
  keys.sort();
  out.push("{");
  for (let i = 0; i < keys.length; i += 1) {
    if (i > 0) {
      out.push(",");
    }
    out.push(JSON.stringify(keys[i]));
    out.push(":");
    writeValue(record[keys[i]], out, path + "." + keys[i]);
  }
  out.push("}");
}
