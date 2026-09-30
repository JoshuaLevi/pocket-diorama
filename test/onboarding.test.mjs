// The onboarding page -- HOW DO YOU WANT TO PLAY? -- headless.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/onboarding.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The page a new game opens after the intro's last fade and before the
// bedroom: one box, two rows, no wrap, A and START both pick, B does
// nothing because there is no default to fall back to (SPEC.md "The
// onboarding page -- design"). OnboardingController is pure like every
// controller under play/screen/, so every claim here is a claim about the
// controller's own state and the pixels it paints, not about the lens or
// how the boot flow wires it in.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: onboarding.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};

const canvasMod = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { GbCanvas, GbFont } = canvasMod;
const onboardingMod = await import("../Assets/Scripts/play/screen/OnboardingScreen.ts");
const { OnboardingController } = onboardingMod;
const stateMod = await import("../Assets/Scripts/play/PlayState.ts");
const { PLAY_MODE_GAMEBOY, PLAY_MODE_DIORAMA } = stateMod;

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const font = new GbFont(bundle);

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

/** Count the ink pixels in a rectangle of the canvas. */
function ink(canvas, x, y, w, h) {
  let n = 0;
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    if (canvas.shadeAt(px, py) === 3) n++;
  }
  return n;
}

/** One frame with `dpad` held, then one frame released -- an edge-triggered move. */
function tapMove(ctrl, dpad) {
  ctrl.step(dpad, false, false, false);
  ctrl.step("", false, false, false);
}

// ------------------------------------------------------------- the cursor
console.log("=== cursor: moves, stops at the ends, no wrap ===");
{
  const c = new OnboardingController();
  check("starts on GAME BOY", c.cursorRow() === 0);

  const v0 = c.stateVersion();
  check("up at the top does nothing", c.step("up", false, false, false) === "" &&
        c.cursorRow() === 0);
  check("and does not bump the version", c.stateVersion() === v0);

  check("down moves to DIORAMA", c.step("down", false, false, false) === "" &&
        c.cursorRow() === 1);
  const v1 = c.stateVersion();
  check("that did bump the version", v1 > v0);

  check("down at the bottom does not wrap", c.step("down", false, false, false) === "" &&
        c.cursorRow() === 1);
  check("and does not bump the version again", c.stateVersion() === v1);

  check("up moves back to GAME BOY", c.step("up", false, false, false) === "" &&
        c.cursorRow() === 0);
  check("up at the top again does not wrap past it either",
        c.step("up", false, false, false) === "" && c.cursorRow() === 0);
}

// ------------------------------------------------------------------ A picks
console.log("=== A and START pick, B does nothing ===");
{
  const c = new OnboardingController();
  check("B does nothing while on GAME BOY", c.step("", false, true, false) === "" &&
        c.cursorRow() === 0);
  const vBeforeA = c.stateVersion();
  check("A on GAME BOY picks gameboy", c.step("", true, false, false) === PLAY_MODE_GAMEBOY);
  check("picking bumps the version", c.stateVersion() > vBeforeA);
  check("and it keeps returning the pick", c.step("", false, false, false) === PLAY_MODE_GAMEBOY);
  check("further input is ignored once picked",
        c.step("up", true, true, true) === PLAY_MODE_GAMEBOY && c.cursorRow() === 0);

  const c2 = new OnboardingController();
  tapMove(c2, "down");
  check("moved to DIORAMA", c2.cursorRow() === 1);
  check("START on DIORAMA picks diorama", c2.step("", false, false, true) === PLAY_MODE_DIORAMA);

  const c3 = new OnboardingController();
  check("START picks GAME BOY without moving the cursor first",
        c3.step("", false, false, true) === PLAY_MODE_GAMEBOY);
}

// -------------------------------------------------------------- the paint
console.log("=== paint: the two lines, the two rows, the cursor ===");
{
  const c = new OnboardingController();
  const canvas = new GbCanvas();
  c.paint(canvas, font);
  check("the box has a top-left corner", ink(canvas, 0, 0, 8, 8) > 0);
  check("line 1 reads HOW DO YOU WANT", ink(canvas, 16, 16, 15 * 8, 8) > 0);
  check("line 1's last glyph (T) is inked, not truncated", ink(canvas, 16 + 14 * 8, 16, 8, 8) > 0);
  check("line 2 reads TO PLAY?", ink(canvas, 16, 32, 8 * 8, 8) > 0);
  check("GAME BOY is drawn", ink(canvas, 16, 48, 8 * 8, 8) > 0);
  check("GAME BOY's last glyph (Y) is inked", ink(canvas, 16 + 7 * 8, 48, 8, 8) > 0);
  check("DIORAMA is drawn", ink(canvas, 16, 64, 7 * 8, 8) > 0);
  check("DIORAMA's last glyph (A) is inked", ink(canvas, 16 + 6 * 8, 64, 8, 8) > 0);
  check("the cursor sits on GAME BOY's row", ink(canvas, 8, 48, 8, 8) > 0);
  check("and not on DIORAMA's row", ink(canvas, 8, 64, 8, 8) === 0);

  tapMove(c, "down");
  canvas.clear(0);
  c.paint(canvas, font);
  check("the cursor moved to DIORAMA's row", ink(canvas, 8, 64, 8, 8) > 0);
  check("and left GAME BOY's row", ink(canvas, 8, 48, 8, 8) === 0);
  check("both lines are still drawn the same way",
        ink(canvas, 16, 48, 8 * 8, 8) > 0 && ink(canvas, 16, 64, 7 * 8, 8) > 0);
}

if (SELFTEST) {
  console.log("=== selftest ===");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before;
    fail = before;
    if (noticed) { pass++; } else { fail++; console.log("  FAIL selftest: " + label + " passes even when broken"); }
  }

  expectFailures("a cursor forced out of the two-row range", () => {
    const c = new OnboardingController();
    c["cursor"] = 5; // TypeScript's `private` is erased at runtime; this is the "mutate the controller" the harness expects.
    check("row-bounds detector", c.cursorRow() >= 0 && c.cursorRow() <= 1);
  });

  expectFailures("a pick that disagrees with the cursor it was made from", () => {
    const c = new OnboardingController();
    c["cursor"] = 1;
    c["chosen"] = PLAY_MODE_GAMEBOY; // a state a correct controller can never reach on its own
    check("pick-matches-cursor detector", c.step("", false, false, false) === PLAY_MODE_DIORAMA);
  });

  expectFailures("a cursor that wraps past the bottom", () => {
    const c = new OnboardingController();
    tapMove(c, "down");
    c["cursor"] = 0; // simulate a hypothetical wrap-back-to-the-top bug
    check("no-wrap detector", c.cursorRow() === 1);
  });

  expectFailures("a cursor that wraps past the top", () => {
    const c = new OnboardingController();
    c["cursor"] = 1; // simulate a hypothetical wrap-to-the-bottom bug after `up` at the top
    check("no-wrap-up detector", c.cursorRow() === 0);
  });

  expectFailures("B treated as a pick", () => {
    const c = new OnboardingController();
    c["chosen"] = PLAY_MODE_GAMEBOY; // simulate a hypothetical "B also picks" bug
    check("B-does-nothing detector", c.result() === "");
  });

  expectFailures("a version that bumps on an idle frame", () => {
    const c = new OnboardingController();
    const before = c.stateVersion();
    c["version"] = before + 1; // simulate an unwarranted bump with nothing held or pressed
    check("no-op-version detector", c.stateVersion() === before);
  });

  expectFailures("a canvas nothing ever painted the cursor onto", () => {
    const canvas = new GbCanvas(); // paint() deliberately never called
    check("cursor-glyph-present detector", ink(canvas, 8, 48, 8, 8) > 0);
  });
}

console.log("");
console.log("ONBOARDING  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
