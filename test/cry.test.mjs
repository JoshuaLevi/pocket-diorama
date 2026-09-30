// End-to-end cry join test: world bundle species id -> audible samples.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/cry.test.mjs Assets/Generated/kanto.json --selftest

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: cry.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}

const { CryVoice } = await import("../Assets/Scripts/audio/CryVoice.ts");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

// Filled from the canonical Red bake. This is the exact serialized growth of
// the containing bundle: comma + property name + compact bank value.
const EXPECTED_CRY_KEY_BYTES = 43126;

function cryKeyBytes(value) {
  const withCry = Buffer.byteLength(JSON.stringify(value));
  const withoutCry = Object.assign({}, value);
  delete withoutCry.cries;
  return withCry - Buffer.byteLength(JSON.stringify(withoutCry));
}

function hasSignal(samples) {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > 1e-7) return true;
  }
  return false;
}

function identical(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function exercise(value, speciesA, speciesB, report) {
  let pass = 0;
  let fail = 0;
  function check(name, condition, detail) {
    if (condition) pass++; else fail++;
    if (report) {
      console.log((condition ? "  PASS  " : "  FAIL  ") + name +
        (detail ? "  -- " + detail : ""));
    }
  }

  check("the bundle carries a cry bank", !!value.cries);
  check("the bank has exactly 151 species",
    !!value.cries && value.cries.ids && value.cries.data &&
    value.cries.ids.length === 151 && value.cries.data.length === 151,
    value.cries && value.cries.ids ? String(value.cries.ids.length) : "missing");

  let first = null;
  let second = null;
  try {
    const voice = new CryVoice(value.cries, null, 44100);
    first = voice.play(speciesA);
    // A missing AudioComponent must never make per-frame updates throw.
    voice.tick();
    second = voice.play(speciesB);
  } catch (error) {
    check("species ids render from outside the audio layer", false, String(error));
    return { pass, fail };
  }
  check("species ids render from outside the audio layer", true);
  check(speciesA + " is not silence", first.length > 0 && hasSignal(first));
  check(speciesB + " is not silence", second.length > 0 && hasSignal(second));
  check("two species do not render identical samples", !identical(first, second),
    first.length + " vs " + second.length + " samples");
  return { pass, fail };
}

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  console.log((condition ? "  PASS  " : "  FAIL  ") + name +
    (detail ? "  -- " + detail : ""));
  if (condition) passed++; else failed++;
}

console.log("\n== bundled Pokemon cries ==");
const baseline = exercise(bundle, "PIKACHU", "BULBASAUR", true);
passed += baseline.pass;
failed += baseline.fail;

const bytes = cryKeyBytes(bundle);
check("the cry key is the claimed byte size", bytes === EXPECTED_CRY_KEY_BYTES,
  bytes + " bytes, expected " + EXPECTED_CRY_KEY_BYTES);
check("the cry key stays below one megabyte", bytes < 1024 * 1024,
  bytes + " bytes");

if (SELFTEST) {
  console.log("\n== discrimination selftest (each mutation must go red) ==");
  const empty = Object.assign({}, bundle, { cries: { v: 1, ids: [], data: [] } });
  const emptyResult = exercise(empty, "PIKACHU", "BULBASAUR", false);
  check("emptying the bundle key makes the outside suite red", emptyResult.fail > 0,
    emptyResult.fail + " failed assertions");

  const missingResult = exercise(bundle, "THIS_SPECIES_DOES_NOT_EXIST", "BULBASAUR", false);
  check("an unknown species makes the outside suite red", missingResult.fail > 0,
    missingResult.fail + " failed assertions");
}

console.log("\n" + (failed === 0 ? "ALL PASS" : "CRY TEST FAILED") +
  ": " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
