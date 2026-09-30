// The codes, the pathnames and the bundle check.
//
//   node --test web/test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_ALPHABET, CODE_LENGTH, mintCode, normaliseCode, isValidCode, pathnameFor,
  inspectBundle, isExpired, BUNDLE_TTL_MS, BUNDLE_PREFIX,
} from "../lib/codes.js";

test("the alphabet is the lens's: thirty-two symbols, no I O 0 1", () => {
  assert.equal(CODE_ALPHABET.length, 32);
  assert.equal(new Set(CODE_ALPHABET).size, 32);
  for (const ch of "IO01") assert.equal(CODE_ALPHABET.includes(ch), false);
  assert.equal(CODE_LENGTH, 6);
});

test("a minted code is valid, and two mints differ", () => {
  const a = mintCode();
  const b = mintCode();
  assert.equal(isValidCode(a), true);
  assert.equal(isValidCode(b), true);
  // 1 in a thousand million; a failure here is a broken RNG, not bad luck.
  assert.notEqual(a, b);
});

test("normalising strips what people add and keeps what they typed", () => {
  assert.equal(normaliseCode(" ab-c 234\n"), "ABC234");
  assert.equal(normaliseCode(null), "");
  assert.equal(isValidCode("ABC234"), true);
  assert.equal(isValidCode("ABCO34"), false);
  assert.equal(isValidCode("ABC23"), false);
  assert.equal(isValidCode(""), false);
});

test("the pathname is a hash of the code, under the prefix, and stable", () => {
  const p = pathnameFor("ABC234");
  assert.equal(p.startsWith(BUNDLE_PREFIX), true);
  assert.equal(p.endsWith(".json"), true);
  assert.equal(p.includes("ABC234"), false);
  assert.equal(pathnameFor("ABC234"), p);
  assert.notEqual(pathnameFor("ABC235"), p);
});

test("a bundle is recognised by the three things the lens checks", () => {
  const good = JSON.stringify({ format: 2, maps: { PALLET_TOWN: {} }, tilesets: { OVERWORLD: {} },
                                romSha1: "ea9bcae617fdf159b045185467ae58b2e4a48b9a" });
  assert.deepEqual(inspectBundle(good), { ok: true, romSha1: "ea9bcae617fdf159b045185467ae58b2e4a48b9a", maps: 1 });
  assert.equal(inspectBundle("not json").ok, false);
  assert.equal(inspectBundle(JSON.stringify({ format: 9, maps: {}, tilesets: {} })).ok, false);
  assert.equal(inspectBundle(JSON.stringify({ format: 2, maps: {} })).ok, false);
  assert.equal(inspectBundle(JSON.stringify({ format: 2, maps: {}, tilesets: {}, romSha1: "nope" })).ok, false);
});

test("a day is a day", () => {
  const now = Date.UTC(2026, 8, 12, 12, 0, 0);
  assert.equal(isExpired(new Date(now - BUNDLE_TTL_MS + 1000), now), false);
  assert.equal(isExpired(new Date(now - BUNDLE_TTL_MS - 1000), now), true);
  assert.equal(isExpired("garbage", now), true);
  assert.equal(BUNDLE_TTL_MS, 86400000);
});

test("the fetched marker lives beside the bundle, under its own prefix, never under the code", async () => {
  const { pathnameFor, fetchedPathnameFor, FETCHED_PREFIX, BUNDLE_PREFIX } = await import("../lib/codes.js");
  const code = "K7M2QX";
  const bundle = pathnameFor(code);
  const marker = fetchedPathnameFor(code);
  assert.ok(marker.startsWith(FETCHED_PREFIX));
  assert.ok(bundle.startsWith(BUNDLE_PREFIX));
  assert.equal(marker.slice(FETCHED_PREFIX.length), bundle.slice(BUNDLE_PREFIX.length), "same digest, different shelf");
  assert.ok(!marker.includes(code) && !bundle.includes(code));
});
