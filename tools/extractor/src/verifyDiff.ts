/**
 * Structural diff for the gate.
 *
 * A byte offset tells you a file is wrong; it does not tell you what is wrong.
 * This walks the two parsed values in the same order canonicalJson() writes
 * them (keys sorted) and reports the first place they disagree as a JSON path,
 * so a failure reads `$.frameBlocks.4[2].tile  golden=31 ours=30` instead of
 * `differs at byte 12345`.
 *
 * It mirrors two canonicalJson() rules, or it would report differences the
 * serialiser does not actually emit:
 *   - a key whose value is `undefined` is not there at all;
 *   - an object with no remaining keys serialises as `[]`, so it compares equal
 *     to an empty array.
 *
 * Pure: no Node built-ins, no I/O.
 */

export type DifferenceKind =
  | "type"
  | "value"
  | "length"
  | "missing-key"
  | "extra-key"
  | "unparsable";

export interface Difference {
  /** JSON path of the first disagreement, e.g. `$.maps.PALLET_TOWN.blocks[3]`. */
  path: string;
  kind: DifferenceKind;
  /** Rendered golden side. */
  golden: string;
  /** Rendered produced side. */
  ours: string;
  /** Raw text window around the first differing byte, filled in by verify.ts. */
  goldenWindow?: string;
  ourWindow?: string;
}

const PREVIEW_LIMIT = 110;

/** Short, single-line rendering of a value for the report. */
function preview(value: unknown): string {
  if (value === undefined) {
    return "<absent>";
  }
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch (error: unknown) {
    return `<unserialisable: ${error instanceof Error ? error.message : "?"}>`;
  }
  if (text === undefined) {
    return "<absent>";
  }
  if (text.length <= PREVIEW_LIMIT) {
    return text;
  }
  return text.slice(0, PREVIEW_LIMIT) + `... (${text.length} chars)`;
}

/** Keys canonicalJson() would actually write, sorted. */
function definedKeys(record: { [key: string]: unknown }): string[] {
  const keys: string[] = [];
  const names = Object.keys(record);
  for (let i = 0; i < names.length; i += 1) {
    if (record[names[i]] !== undefined) {
      keys.push(names[i]);
    }
  }
  keys.sort();
  return keys;
}

/** True when a value serialises as `[]`: an empty array or an empty object. */
function isEmptyTable(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  return definedKeys(value as { [key: string]: unknown }).length === 0;
}

/** Coarse type name used to report a mismatch. */
function typeName(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === undefined) {
    return "absent";
  }
  const kind = typeof value;
  return kind === "object" ? "object" : kind;
}

function keyPath(path: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? path + "." + key
    : path + "[" + JSON.stringify(key) + "]";
}

/**
 * First place `golden` and `ours` disagree, or null when they are equivalent
 * under canonicalJson()'s rules.
 */
export function describeDifference(
  golden: unknown,
  ours: unknown,
  path: string = "$",
): Difference | null {
  // Empty object and empty array both serialise as `[]`, so neither one is a
  // difference against the other.
  if (isEmptyTable(golden) && isEmptyTable(ours)) {
    return null;
  }

  if (typeName(golden) !== typeName(ours)) {
    return {
      path: path,
      kind: "type",
      golden: `${typeName(golden)} ${preview(golden)}`,
      ours: `${typeName(ours)} ${preview(ours)}`,
    };
  }

  if (Array.isArray(golden) && Array.isArray(ours)) {
    const limit = golden.length < ours.length ? golden.length : ours.length;
    for (let i = 0; i < limit; i += 1) {
      const inner = describeDifference(golden[i], ours[i], path + "[" + i + "]");
      if (inner !== null) {
        return inner;
      }
    }
    if (golden.length !== ours.length) {
      return {
        path: path,
        kind: "length",
        golden: `${golden.length} items`,
        ours: `${ours.length} items`,
      };
    }
    return null;
  }

  if (golden !== null && typeof golden === "object") {
    const goldenRecord = golden as { [key: string]: unknown };
    const ourRecord = ours as { [key: string]: unknown };
    const goldenKeys = definedKeys(goldenRecord);
    const ourKeys = definedKeys(ourRecord);

    for (let i = 0; i < goldenKeys.length; i += 1) {
      const key = goldenKeys[i];
      if (ourKeys.indexOf(key) < 0) {
        return {
          path: keyPath(path, key),
          kind: "missing-key",
          golden: preview(goldenRecord[key]),
          ours: "<absent>",
        };
      }
    }
    for (let i = 0; i < ourKeys.length; i += 1) {
      const key = ourKeys[i];
      if (goldenKeys.indexOf(key) < 0) {
        return {
          path: keyPath(path, key),
          kind: "extra-key",
          golden: "<absent>",
          ours: preview(ourRecord[key]),
        };
      }
    }
    // Same key set: walk in the order canonicalJson() writes them, so the
    // reported path is the earliest one in the serialised file.
    for (let i = 0; i < goldenKeys.length; i += 1) {
      const key = goldenKeys[i];
      const inner = describeDifference(
        goldenRecord[key],
        ourRecord[key],
        keyPath(path, key),
      );
      if (inner !== null) {
        return inner;
      }
    }
    return null;
  }

  if (golden === ours) {
    return null;
  }
  return {
    path: path,
    kind: "value",
    golden: preview(golden),
    ours: preview(ours),
  };
}
