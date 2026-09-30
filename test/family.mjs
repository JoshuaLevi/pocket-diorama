// Which suites read which cartridge.
//
// Most suites drive Red's scripts and assert Red's fixtures -- the three
// balls, Viridian's stock, Route 1's quad count -- against whatever bundle
// they are handed. Blue shares all of it; Yellow does not, and running them
// under Yellow reports Red's fixtures as Yellow's failures. A suite that is
// Red's says so here and steps aside under Yellow, with a line that names it,
// so the count of suites that ran is never mistaken for the count that passed.
// Yellow's own scenes are test/yellow.test.mjs.

const YELLOW_ROM_SHA1 = "cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1";

/** Exits 0 with a SKIPPED line when the bundle is Yellow's; returns otherwise. */
export function redScenarioOrSkip(bundle, suite, what) {
  const sha = bundle && typeof bundle.romSha1 === "string" ? bundle.romSha1.toLowerCase() : "";
  if (sha === YELLOW_ROM_SHA1) {
    console.log(`${suite} SKIPPED: ${what || "a Red scenario"}; the bundle is Yellow`);
    process.exit(0);
  }
}
