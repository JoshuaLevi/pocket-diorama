// The roll of credits after the HALL OF FAME.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/credits.test.mjs Assets/Generated/kanto.json
//
// The bundle carries the cartridge's thirty-five screens and fifteen POKeMON;
// what is asserted is that every one of them is shown, in order, that the
// text lands where the cartridge's columns put it, that a fade lifts the
// palette and only a fade, and that the whole thing ends on its own.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: credits.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "CREDITS", "Red's credits roll, Yellow's is longer");
globalThis.print = () => {};

const S = await import("../Assets/Scripts/play/screen/CreditsScreen.ts");
const { CreditsController, CREDITS_RUNNING, CREDITS_DONE,
        MON_SLIDE_FRAMES, MON_HOLD_FRAMES, TEXT_FRAMES, FADE_FRAMES, END_FRAMES, TEXT_ROW, TEXT_ROW_STEP } = S;
const C = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { GbCanvas, GbFont, imageFromPacked, DMG_GREYS, TILE, SCREEN_WIDTH } = C;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

const screens = bundle.field.credits.screens;
const font = new GbFont(bundle);
const front = (species) => {
  const def = bundle.species[species];
  return def && def.front ? imageFromPacked(def.front) : null;
};
const copyright = imageFromPacked(bundle.title.copyright);
function fresh() {
  return new CreditsController(screens, front, copyright);
}
function inkIn(canvas, top, height) {
  let n = 0;
  for (let y = top; y < top + height; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) { if (canvas.shadeAt(x, y) !== 0) { n++; } }
  }
  return n;
}

console.log("== The data ==");
{
  check("thirty-five screens", screens.length === 35, screens.length);
  check("fifteen POKeMON", bundle.field.credits.mons.length === 15);
  const withMon = screens.filter((s) => s.mon).map((s) => s.mon);
  check("every POKeMON is on a screen, in the list's order",
        JSON.stringify(withMon) === JSON.stringify(bundle.field.credits.mons), JSON.stringify(withMon));
  check("the last screen is the copyright", screens[screens.length - 1].copyright === true);
  check("every POKeMON has a front picture", withMon.every((m) => front(m) !== null));
}

console.log("\n== The roll ==");
{
  const c = fresh();
  check("it starts on the first screen's POKeMON", c.screenIndex() === 0 && c.phaseName() === "mon", c.phaseName());
  const canvas = new GbCanvas();
  c.paint(canvas, font);
  check("the picture starts off the right edge", inkIn(canvas, 0, 144) === 0);
  c.step(MON_SLIDE_FRAMES, false);
  c.paint(canvas, font);
  check("and has slid into place", inkIn(canvas, 4 * TILE, 7 * TILE) > 200, inkIn(canvas, 4 * TILE, 7 * TILE));
  check("nothing above or below it", inkIn(canvas, 0, 4 * TILE) === 0 && inkIn(canvas, 11 * TILE, 144 - 11 * TILE) === 0);
  c.step(MON_HOLD_FRAMES, false);
  check("then the text", c.phaseName() === "text", c.phaseName());
  c.paint(canvas, font);
  check("POKeMON and RED VERSION STAFF are on the page", inkIn(canvas, TEXT_ROW * TILE, TILE) > 0 &&
        inkIn(canvas, (TEXT_ROW + TEXT_ROW_STEP) * TILE, TILE) > 0);
  check("the first line starts at the cartridge's column",
        canvas.shadeAt(screens[0].lines[0].column * TILE - 1, TEXT_ROW * TILE + 3) === 0 &&
        inkIn(canvas, TEXT_ROW * TILE, TILE) > 0);
  check("a plain frame does not repaint", (() => { const v = c.stateVersion(); c.step(1, false); return c.stateVersion() === v; })());
  c.step(TEXT_FRAMES, false);
  check("a fading screen fades", c.phaseName() === "fade", c.phaseName());
  c.step(FADE_FRAMES / 2, false);
  const p = c.palette();
  check("halfway through the fade the greys are lighter", p[3][0] > DMG_GREYS[3][0] && p[3][0] < 255, JSON.stringify(p[3]));
  c.step(FADE_FRAMES, false);
  check("and the next screen follows", c.screenIndex() === 1, c.screenIndex());
  check("with the palette back", c.palette() === DMG_GREYS);
}

console.log("\n== Every screen, to the end ==");
{
  const c = fresh();
  const seen = [];
  let out = CREDITS_RUNNING;
  let frames = 0;
  const canvas = new GbCanvas();
  let blank = 0;
  while (out === CREDITS_RUNNING && frames < 20000) {
    if (seen.indexOf(c.screenIndex()) < 0) { seen.push(c.screenIndex()); }
    if (c.phaseName() === "text") {
      c.paint(canvas, font);
      if (inkIn(canvas, 0, 144) === 0 && !screens[c.screenIndex()].copyright) { blank++; }
    }
    out = c.step(1, false);
    frames++;
  }
  check("it ends on its own", out === CREDITS_DONE && c.isDone());
  check("every screen was shown", seen.length === screens.length, seen.length);
  check("no text screen was blank", blank === 0, blank);
  const total = CreditsController.totalFrames(screens);
  check("it takes the frames it says it takes", frames === total, frames + " vs " + total);
  check("which is about a minute and a half, the length of the song", total / 59.7275 > 70 && total / 59.7275 < 120,
        (total / 59.7275).toFixed(0) + " s");
  c.paint(canvas, font);
  check("and paints nothing once done", inkIn(canvas, 0, 144) === 0);
}

console.log("\n== The end card ==");
{
  const c = fresh();
  while (c.phaseName() !== "end") { c.step(4, false); }
  const canvas = new GbCanvas();
  c.paint(canvas, font);
  check("THE END is on the card", inkIn(canvas, 7 * TILE, TILE) > 0);
  check("with the copyright under it", inkIn(canvas, 11 * TILE, TILE) > 0);
  c.step(END_FRAMES, false);
  check("and the card holds a few seconds before it goes", c.isDone() && END_FRAMES / 59.7275 >= 3);
}

console.log("\n== START ends it early ==");
{
  const c = fresh();
  c.step(10, false);
  check("START finishes the roll", c.step(1, true) === CREDITS_DONE && c.isDone());
  check("and it latches", c.step(1, false) === CREDITS_DONE);
}

console.log("\nCREDITS " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
