// The Pokedex data page a starter ball (push_screen DexEntryMenu) opens.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/dexentry.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Two things have to be proven, and each fails without the fix it covers:
//   1. The page itself -- category, height, weight, dex number, the front
//      picture, the two-page description -- draws from real bundle data
//      (FINDINGS.md, "The starter's Pokedex page is not shown": the bundle
//      carried the picture and the number but not what a Pokemon IS or how
//      big, because BundleFromExtraction.ts dropped spec.dexEntry).
//   2. push_screen actually SUSPENDS the script for the measured presses --
//      one to turn the description, one more to close -- rather than
//      resolving DONE on the same frame it opened, which is what it did
//      before ScriptVM's dispatch and PlayHost.pushScreen forwarded a real
//      status instead of hard-coding one.
//
// `--selftest` breaks #2 on purpose (a services.dexEntry that answers DONE
// regardless of the page) and requires this suite to notice.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bundlePath = process.argv[2];
const args = process.argv.slice(2);
const selftest = args.indexOf("--selftest") >= 0;
const mutantArg = args.find((a) => a.startsWith("--mutant="));
const mutant = mutantArg ? mutantArg.substring("--mutant=".length) : "";
if (!bundlePath) {
  console.error("usage: dexentry.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};

const { GbCanvas, GbFont } = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { DexEntryController, formatHeight, formatWeight, splitDexPages } =
  await import("../Assets/Scripts/play/screen/DexEntryScreen.ts");
const { ScriptVM, DONE, SUSPENDED } = await import("../Assets/Scripts/play/script/ScriptVM.ts");
const { PlayHost } = await import("../Assets/Scripts/play/script/Host.ts");
const { newPlayState } = await import("../Assets/Scripts/play/PlayState.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (detail ? "  -- " + detail : "")); }
}

function ink(canvas, x, y, w, h) {
  let n = 0;
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    if (canvas.shadeAt(px, py) === 3) n++;
  }
  return n;
}

// --------------------------------------------------------- number formatting
console.log("=== formatting, against the cartridge's own measured values ===");
{
  // Measured on the cartridge (tools/oracle, 6 sep): CHARMANDER is 2'00" and
  // 19.0lb. Independently confirmed here against gen1recomp's own golden
  // extraction (bundle.species.CHARMANDER, not a literal copied in by hand).
  const charmander = bundle.species.CHARMANDER;
  check("Charmander's height formats as measured on the cartridge",
        formatHeight(charmander.heightFeet, charmander.heightInches) === "2′00″",
        formatHeight(charmander.heightFeet, charmander.heightInches));
  check("Charmander's weight formats as measured on the cartridge",
        formatWeight(charmander.weightTenths) === "19.0lb",
        formatWeight(charmander.weightTenths));
  // A species whose inches and weight are not both single digits, so a
  // formatter that forgot to zero-pad or forgot the decimal would still
  // pass on Charmander alone.
  const gyarados = bundle.species.GYARADOS;
  check("a double-digit height and four-digit weight format too",
        formatHeight(gyarados.heightFeet, gyarados.heightInches) === "21′04″" &&
        formatWeight(gyarados.weightTenths) === "518.0lb",
        formatHeight(gyarados.heightFeet, gyarados.heightInches) + " " + formatWeight(gyarados.weightTenths));
  check("a ten-or-more inches value is not re-padded",
        formatHeight(1, 11) === "1′11″");
}

// -------------------------------------------------------------- the bundle
console.log("=== the bundle carries what the page needs ===");
{
  const c = bundle.species.CHARMANDER;
  check("category, height, weight and the description label are all there",
        c.category === "LIZARD" && c.heightFeet === 2 && c.heightInches === 0 &&
        c.weightTenths === 190 && typeof c.dexText === "string" && c.dexText.length > 0,
        JSON.stringify({ category: c.category, heightFeet: c.heightFeet,
                         heightInches: c.heightInches, weightTenths: c.weightTenths, dexText: c.dexText }));
  check("every one of the 151 species carries them, not Charmander alone",
        Object.values(bundle.species).every((s) =>
          typeof s.category === "string" && typeof s.heightFeet === "number" &&
          typeof s.heightInches === "number" && typeof s.weightTenths === "number" &&
          typeof s.dexText === "string"));
  check("the description resolves through bundle.text, unchanged by this fix",
        typeof bundle.text[c.dexText] === "string" && bundle.text[c.dexText].length > 0);
}

// ------------------------------------------------------------- pagination
console.log("=== the description is two pages, not a two-line scroll ===");
{
  const body = bundle.text[bundle.species.CHARMANDER.dexText];
  const pages = splitDexPages(body);
  check("split on the cartridge's own page break: exactly two pages",
        pages.length === 2, JSON.stringify(pages));
  check("three lines a page, both pages -- the box this screen draws is",
        pages.every((p) => p.length === 3), JSON.stringify(pages.map((p) => p.length)));
  // Measured across the golden extraction for all 151 species (tools/golden.sh):
  // never once a \v continuation, which is why this does not reuse Dialogue.ts's
  // paginate() (a two-line, scrolling box the dex screen is not).
  const allBodies = Object.values(bundle.species).map((s) => bundle.text[s.dexText]);
  check("no species' description needs a `cont` scroll",
        allBodies.every((b) => splitDexPages(b).every((p) => p.length === 3)));
  check("an empty body degrades to no pages rather than throwing",
        splitDexPages("").length === 0 && splitDexPages(null).length === 0);
}

// ---------------------------------------------------------------- the page
console.log("=== the page itself, in pixels ===");
const font = new GbFont(bundle);
{
  const d = new DexEntryController(bundle, "CHARMANDER");
  check("open on construction, on the description's first page", d.isOpen());
  const c = new GbCanvas();
  d.paint(c, font);

  check("the dex number is at the top left", ink(c, 0, 0, 32, 8) > 0);
  // CHARMANDER is dex #4: "No.004" is six glyphs (48px); the name "CHARMANDER"
  // is right-aligned ten glyphs (80px, from x=80). The 32px between them
  // stays paper -- proof the two labels do not run into each other.
  check("the dex number and the name do not collide",
        ink(c, 48, 0, 32, 8) === 0, "" + ink(c, 48, 0, 32, 8));
  check("the name is at the top RIGHT", ink(c, 160 - 80, 0, 80, 8) > 0);
  check("the category line names it a LIZARD POKeMON", ink(c, 0, 8, 8 * 15, 8) > 0);
  check("the front picture is drawn", ink(c, 8, 16, 40, 40) > 0);
  check("HT is shown beside the picture", ink(c, 64, 16, 8 * 8, 8) > 0);
  check("WT is shown below HT", ink(c, 64, 32, 8 * 8, 8) > 0);
  check("the description box has a border", ink(c, 0, 64, 8, 8) > 0);
  check("and the first description page's words are inside it",
        ink(c, 8, 72, 144, 24) > 0);

  const firstPageInk = ink(c, 8, 72, 144, 24);
  d.step(true);
  check("one A press does not close it -- the second page still to come",
        d.isOpen());
  d.paint(c, font);
  // CHARMANDER's own two pages (golden extraction, tools/golden.sh): "Obviously
  // prefers / hot places. When / it rains, steam" then "is said to spout /
  // from the tip of / its tail" -- different words, so a different ink count.
  check("and the box now shows the second page's different words",
        ink(c, 8, 72, 144, 24) !== firstPageInk,
        firstPageInk + " -> " + ink(c, 8, 72, 144, 24));
  d.step(true);
  check("a second A press closes the whole page", !d.isOpen());
  d.step(true);
  check("a press once closed does nothing further", !d.isOpen());
}

{
  // No species data at all: the picture, HT/WT and category fall back to
  // nothing drawn rather than throwing, and with no description a single
  // press closes it -- the fallback FINDINGS.md and every other bundle
  // table this project carries share ("readers guard its absence").
  const bare = { species: { MISSINGNO: { dex: 0, name: "MISSINGNO" } }, text: {} };
  const d = new DexEntryController(bare, "MISSINGNO");
  check("no dexText at all is still constructible", d.isOpen());
  const c = new GbCanvas();
  d.paint(c, font);
  d.step(true);
  check("with no description, one press is enough to close it", !d.isOpen());

  const ghost = new DexEntryController(bare, "NOT_IN_THE_BUNDLE");
  check("a species missing from the bundle entirely does not throw either",
        ghost.isOpen());
}

// --------------------------------------------------- the join: push_screen
console.log("=== push_screen actually suspends the VM ===");

/**
 * The exact shape PokemonAR.ts and test/headless.mjs both implement:
 * services.dexEntry(species) owns a real DexEntryController and reports
 * SUSPENDED while it is open, DONE once it is not -- the join this whole
 * finding is about. `pressSchedule` says which whole-VM-update() calls
 * (0-based) get an A press before that update runs.
 */
function runPushScreen(species, pressSchedule, maxFrames) {
  const state = newPlayState(bundle.romSha1);
  let controller = null;
  const services = {
    dexEntry: (s) => {
      if (!controller) {
        controller = new DexEntryController(bundle, s);
        return SUSPENDED;
      }
      if (controller.isOpen()) return SUSPENDED;
      controller = null;
      return DONE;
    },
  };
  const host = new PlayHost(bundle, state, services);
  if (mutant === "always-done") {
    // The exact bug this fix removed: push_screen resolving DONE the instant
    // it is called, whatever is actually on screen.
    host.pushScreen = () => DONE;
  }
  const vm = new ScriptVM(host, state.flags);
  vm.start([{ op: "push_screen", screen: "DexEntryMenu", species: species }, { op: "end" }]);
  for (let frame = 0; vm.isRunning() && frame < (maxFrames || 10); frame++) {
    if (pressSchedule.indexOf(frame) >= 0 && controller) controller.step(true);
    vm.update();
  }
  return { running: vm.isRunning(), state: state };
}

{
  // Frame 0 is the update() call that FIRST reaches push_screen and creates
  // the controller -- there is nothing to press yet the instant it opens,
  // exactly as a real press cannot also be the one that opened the talk
  // that led here. A schedule presses from frame 1 on.
  const noPresses = runPushScreen("CHARMANDER", []);
  check("with no press at all the page never closes and the script waits",
        noPresses.running);

  const onePress = runPushScreen("CHARMANDER", [1]);
  check("one press turns the description but does not close the page",
        onePress.running);

  const twoPresses = runPushScreen("CHARMANDER", [1, 2]);
  check("two presses close the page and the script reaches end",
        !twoPresses.running);
  check("and the species is recorded as seen along the way",
        twoPresses.state.dexSeen[bundle.species.CHARMANDER.dex - 1] === true);
}

if (selftest) {
  console.log("=== selftest ===");
  const child = spawnSync(process.execPath, [
    ...process.execArgv, fileURLToPath(import.meta.url), bundlePath, "--mutant=always-done",
  ], { cwd: process.cwd(), encoding: "utf8" });
  check("[selftest] a push_screen that always resolves DONE makes this suite go red",
        child.status === 1 &&
        child.stdout.indexOf("FAIL  with no press at all the page never closes and the script waits") >= 0,
        "exit=" + child.status + "\n" + child.stdout + child.stderr);
}

console.log(`\n${fail === 0 ? "DEXENTRY OK" : "DEXENTRY FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
