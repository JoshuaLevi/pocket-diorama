// World codes: minted here, typed into the lens, looked up here again.
//
// The alphabet is the lens's (Assets/Scripts/play/screen/CodeEntry.ts): the
// thirty-two symbols that are not I, O, 0 or 1, because a code is read off a
// screen and typed on a D-pad and those four are the ones people confuse.
// Six of them is about a thousand million codes, against a store that holds
// a few dozen for a day each, so a guess does not find anything -- and the
// code is never the pathname: the blob is filed under a hash of it.

import { createHash, randomInt } from "node:crypto";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
/** How long a baked world is kept, in milliseconds: one day. */
export const BUNDLE_TTL_MS = 24 * 60 * 60 * 1000;
/** Under which prefix the blobs live. */
export const BUNDLE_PREFIX = "bundles/";

/** A fresh code, from the OS's randomness. */
export function mintCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET.charAt(randomInt(0, CODE_ALPHABET.length));
  }
  return out;
}

/** Upper case, without the spaces and dashes people add when reading one out. */
export function normaliseCode(raw) {
  const text = typeof raw === "string" ? raw.toUpperCase() : "";
  let out = "";
  for (const ch of text) {
    if (ch === " " || ch === "-" || ch === "_" || ch === "." || ch === "\n" || ch === "\t") {
      continue;
    }
    out += ch;
  }
  return out;
}

/** Exactly CODE_LENGTH symbols, every one in the alphabet. */
export function isValidCode(code) {
  if (typeof code !== "string" || code.length !== CODE_LENGTH) {
    return false;
  }
  for (const ch of code) {
    if (CODE_ALPHABET.indexOf(ch) < 0) {
      return false;
    }
  }
  return true;
}

/** Under which prefix the "the glasses fetched it" markers live. */
export const FETCHED_PREFIX = "fetched/";

function digestOf(code) {
  return createHash("sha256").update("pocket-diorama:" + code).digest("hex").slice(0, 40);
}

/** Where a code's bundle is filed. The code itself never appears in a pathname. */
export function pathnameFor(code) {
  return BUNDLE_PREFIX + digestOf(code) + ".json";
}

/**
 * Where the lens's fetch of a code is recorded, so the page that showed the
 * code can say "your glasses have it". A separate tiny blob rather than a
 * field on the bundle: blobs are immutable, and rewriting 1.7 MB to flip a
 * bit would be the wrong tool. Same digest, different prefix, same day.
 */
export function fetchedPathnameFor(code) {
  return FETCHED_PREFIX + digestOf(code) + ".json";
}

/**
 * The cheapest check that an upload is a world bundle and not a file someone
 * pointed the form at: it parses, it is the bundle format the lens reads, and
 * it names the cartridge it came from. The lens's own parseBundle does the
 * same three checks (Assets/Scripts/world/WorldData.ts).
 */
export function inspectBundle(text) {
  let bundle = null;
  try {
    bundle = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: "not JSON" };
  }
  if (!bundle || typeof bundle !== "object") {
    return { ok: false, reason: "not an object" };
  }
  if (!(bundle.format >= 1 && bundle.format <= 2)) {
    return { ok: false, reason: "unsupported format " + bundle.format };
  }
  if (!bundle.maps || !bundle.tilesets) {
    return { ok: false, reason: "missing maps or tilesets" };
  }
  if (typeof bundle.romSha1 !== "string" || !/^[0-9a-f]{40}$/.test(bundle.romSha1)) {
    return { ok: false, reason: "missing romSha1" };
  }
  return { ok: true, romSha1: bundle.romSha1, maps: Object.keys(bundle.maps).length };
}

/** Whether a blob uploaded at `uploadedAt` has outlived its day, at `now`. */
export function isExpired(uploadedAt, now) {
  const at = uploadedAt instanceof Date ? uploadedAt.getTime() : new Date(uploadedAt).getTime();
  if (!(at > 0)) {
    return true;
  }
  return now - at > BUNDLE_TTL_MS;
}
