// Manifest selection is the cartridge gate: an unknown ROM must never inherit
// Red's addresses merely because Red happens to be the first candidate.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/manifest.test.mjs --selftest

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { selectManifest } from "../Assets/Scripts/rom/ManifestSelect.ts";

const RED_ROM = (process.env.HOME || "") + "/Downloads/Pokemon - Red Version (USA, Europe).gb";
const EXPECTED_RED_SHA1 = "ea9bcae617fdf159b045185467ae58b2e4a48b9a";
const UNKNOWN_SHA1 = "0000000000000000000000000000000000000000";
const SELFTEST = process.argv.includes("--selftest");

const manifestFiles = ["red", "blue", "yellow"].map((version) => ({
  version,
  path: fileURLToPath(
    new URL(`../Assets/Manifests/rom_manifest_${version}.json`, import.meta.url),
  ),
}));

const shipped = manifestFiles.map(({ version, path }) => ({
  version,
  manifest: JSON.parse(readFileSync(path, "utf8")),
}));
const candidates = shipped.map(({ manifest }) => manifest);
const byVersion = Object.fromEntries(
  shipped.map(({ version, manifest }) => [version, manifest]),
);

const redRomSha1 = createHash("sha1")
  .update(readFileSync(RED_ROM))
  .digest("hex");

function exercise(selector) {
  const assertions = [];
  function expect(name, condition, detail = "") {
    assertions.push({ name, condition: Boolean(condition), detail });
  }

  expect(
    "the supplied Red cartridge has the canonical Red SHA-1",
    redRomSha1 === EXPECTED_RED_SHA1,
    redRomSha1,
  );
  expect(
    "Red's cartridge hash selects Red's manifest",
    selector(redRomSha1, candidates) === byVersion.red,
  );

  for (const { version, manifest } of shipped) {
    expect(
      `${version}'s declared hash selects rom_manifest_${version}.json`,
      selector(manifest.romSha1, candidates) === manifest,
      manifest.romSha1,
    );
  }

  expect(
    "the three shipped manifests declare distinct ROM SHA-1 values",
    new Set(shipped.map(({ manifest }) => manifest.romSha1)).size === shipped.length,
  );
  expect(
    "an unknown cartridge is refused",
    selector(UNKNOWN_SHA1, candidates) === null,
  );

  return assertions;
}

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  console.log(
    (condition ? "  PASS  " : "  FAIL  ") +
      name +
      (detail ? "  -- " + detail : ""),
  );
  if (condition) passed += 1;
  else failed += 1;
}

console.log("\n== cartridge manifest selection ==");
for (const assertion of exercise(selectManifest)) {
  check(assertion.name, assertion.condition, assertion.detail);
}

if (SELFTEST) {
  console.log("\n== discrimination selftest ==");
  const fallbackToRed = (romSha1, manifests) =>
    selectManifest(romSha1, manifests) || byVersion.red;
  const mutationFailures = exercise(fallbackToRed).filter(
    ({ condition }) => !condition,
  );
  check(
    "falling back to Red for an unknown hash makes the suite go red",
    mutationFailures.length > 0,
    mutationFailures.length + " failed assertion(s)",
  );
}

console.log(
  "\n" +
    (failed === 0 ? "CARTRIDGE MANIFEST TEST: PASS" : "CARTRIDGE MANIFEST TEST: FAIL") +
    ` (${passed} passed, ${failed} failed)`,
);
process.exit(failed === 0 ? 0 : 1);
