/**
 * Node-only dataset discovery, shared by src/cli.ts and src/verify.ts.
 *
 * Both entry points have to agree on exactly which datasets exist, because the
 * gate is worthless if it verifies a different set of builders than the one the
 * extractor runs. Discovery therefore lives here once instead of twice.
 *
 * Like src/cli.ts, this file imports node:fs and node:path. It is NOT part of
 * the portable core: nothing under src/core, src/types.ts or src/registry.ts
 * imports it, so the code that has to run inside the Lens Studio sandbox stays
 * free of Node built-ins.
 *
 * Discovery rule: for each requested name in DATASET_NAMES, look for
 * `src/datasets/<name>.ts`, then `src/datasets/<name>/index.ts`. A dataset with
 * no module on disk is reported as missing; a module that exists but fails to
 * import is a hard error, because a silently skipped broken dataset would show
 * up in the gate as "not written yet" rather than as the failure it is.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DATASET_NAMES,
  OUTPUT_FILES,
  getDataset,
  listDatasets,
  outputsFor,
  registerDataset,
  type DatasetBuilder,
} from "./registry";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the directory dataset modules are discovered in. */
export const DATASETS_DIR = join(HERE, "datasets");

/** What a discovery pass found. */
export interface DiscoveryReport {
  /** Dataset names that registered a builder, in DATASET_NAMES order. */
  registered: string[];
  /** Requested dataset names with no module on disk. */
  missingModules: string[];
  /**
   * Output basenames that no registered builder writes.
   *
   * This is the number that matters, and it is not the same as
   * `missingModules`: `moves` and `type_chart` have no module of their own
   * because the `pokemon` builder emits all three files. Reporting the module
   * list as "pending" would claim two finished datasets are unwritten.
   */
  uncoveredOutputs: string[];
}

/** Pull a DatasetBuilder out of a loaded module, or explain what is missing. */
function builderFromModule(name: string, mod: unknown): DatasetBuilder {
  const exports = mod as { builder?: unknown; default?: unknown };
  const candidate =
    exports.builder !== undefined ? exports.builder : exports.default;
  if (candidate === null || typeof candidate !== "object") {
    throw new Error(
      `src/datasets/${name}: expected 'export const builder: DatasetBuilder' ` +
        "(or a default export)",
    );
  }
  const builder = candidate as DatasetBuilder;
  if (builder.name !== name) {
    throw new Error(
      `src/datasets/${name}: builder.name is '${builder.name}', expected '${name}'`,
    );
  }
  return builder;
}

/** Resolve a dataset name to its module path, or null when it has none. */
export function moduleFor(name: string): string | null {
  const flat = join(DATASETS_DIR, name + ".ts");
  if (existsSync(flat)) {
    return flat;
  }
  const nested = join(DATASETS_DIR, name, "index.ts");
  if (existsSync(nested)) {
    return nested;
  }
  return null;
}

/** Output basenames produced by everything currently registered. */
export function coveredOutputs(): string[] {
  const covered: string[] = [];
  const builders = listDatasets();
  for (let i = 0; i < builders.length; i += 1) {
    const outputs = outputsFor(builders[i]);
    for (let j = 0; j < outputs.length; j += 1) {
      if (covered.indexOf(outputs[j]) < 0) {
        covered.push(outputs[j]);
      }
    }
  }
  return covered;
}

/** Output basenames in OUTPUT_FILES that nothing registered produces. */
export function uncoveredOutputs(): string[] {
  const covered = coveredOutputs();
  const missing: string[] = [];
  for (let i = 0; i < OUTPUT_FILES.length; i += 1) {
    if (covered.indexOf(OUTPUT_FILES[i]) < 0) {
      missing.push(OUTPUT_FILES[i]);
    }
  }
  return missing;
}

/**
 * Import and register every requested dataset module that exists on disk.
 *
 * Safe to call more than once in a process: a name that is already registered
 * is left alone rather than throwing the registry's duplicate-name error.
 */
export async function loadDatasets(
  names: string[],
): Promise<DiscoveryReport> {
  const registered: string[] = [];
  const missingModules: string[] = [];

  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (getDataset(name) !== null) {
      registered.push(name);
      continue;
    }
    const path = moduleFor(name);
    if (path === null) {
      missingModules.push(name);
      continue;
    }
    // A module that exists but fails to import is a real failure: let it throw.
    const mod: unknown = await import(pathToFileURL(path).href);
    registerDataset(builderFromModule(name, mod));
    registered.push(name);
  }

  // Keep the registered list in DATASET_NAMES order regardless of `names`.
  const ordered: string[] = [];
  for (let i = 0; i < DATASET_NAMES.length; i += 1) {
    if (registered.indexOf(DATASET_NAMES[i]) >= 0) {
      ordered.push(DATASET_NAMES[i]);
    }
  }

  return {
    registered: ordered,
    missingModules: missingModules,
    uncoveredOutputs: uncoveredOutputs(),
  };
}
