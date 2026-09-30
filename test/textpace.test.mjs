// Text prints instantly in the lens; the cartridge prints letter by letter.
//
// FINDINGS.md, 6 sep: a button pressed while the cartridge is still printing
// a page is ignored -- about a second a page at the default MEDIUM speed --
// so three quick presses advance three pages on the lens and one on the ROM.
// Measured on the cartridge (tools/oracle): a page prints one new letter
// every textSpeed frames -- FAST 1, MEDIUM 3, SLOW 5 -- including spaces,
// with no extra pause across a `cont` scroll's line break, and a button
// counts starting N*textSpeed+1 frames after the page went up, where N is
// the letters THIS page actually prints -- a `cont` scroll's carried top
// line is already on screen and is not retyped. See Host.ts's textReady().
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/textpace.test.mjs Assets/Generated/kanto.json

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const bundlePath = process.argv[2];
if (!bundlePath) { console.error("usage: textpace.test.mjs <bundle.json>"); process.exit(2); }
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
globalThis.print = () => {};

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { paginate } = await import(P + "script/Dialogue.ts");
const { TEXT_SPEED_FAST, TEXT_SPEED_MEDIUM, TEXT_SPEED_SLOW } = PlayState;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

/**
 * REDS_HOUSE_2F facing the SNES, boot already done: the shortest way to a
 * script-shown, precisely-known piece of text (FINDINGS.md, "The SNES in
 * Red's bedroom says nothing" -- a face trigger on (3,5), no flag guard, so
 * it can be read again for a fresh page every time this is called).
 */
function inBedroom(speed) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = "REDS_HOUSE_2F";
  state.cellX = 3;
  state.cellY = 6;
  state.facing = "up";
  state.flags.EVENT_INTRO_DONE = true;
  if (speed !== undefined) {
    state.options.textSpeed = speed;
  }
  return new HeadlessLens(bundle, { state });
}

/** A single frame with A held down for exactly that frame -- finer-grained than press(), which always spends 12. */
function tap(lens) {
  lens.input.press("a");
  lens.frame();
}

/** Letters this page actually prints: a `cont` scroll's carried top line (identical to the previous page's bottom line) is not retyped. Mirrors Host.ts's own newLettersOnPage(). */
function newLetters(pages, index) {
  const cur = pages[index];
  const prior = index > 0 ? pages[index - 1] : null;
  let n = 0;
  for (let i = 0; i < cur.length; i++) {
    if (i === 0 && prior && cur.length > 1 && prior[prior.length - 1] === cur[0]) continue;
    n += cur[i].length;
  }
  return n;
}

// The SNES text's own pages, derived the same way pagesOf() builds them
// (substitute, then paginate) -- not hand-counted, so this does not drift
// if the transcribed line ever changes.
const snesBody = bundle.text["_RedBedroomSNESText"].replace("{PLAYER}", "RED");
const snesPages = paginate(snesBody).map((p) => p.lines);
check("the SNES text is the three views the box scroll leaves it as (sanity)", snesPages.length === 3, JSON.stringify(snesPages));
const page0Letters = newLetters(snesPages, 0);
const page1Letters = newLetters(snesPages, 1);
check("page 1 (\"RED is\"+\"playing the SNES!\", nothing carried) is 23 new letters", page0Letters === 23, page0Letters);
check("page 2's carried top line is not retyped -- only \"...Okay!\" (8) is new", page1Letters === 8, page1Letters);

console.log("\n== A page cannot be acknowledged before N*speed+1 frames, and can right on schedule ==");
{
  const speed = TEXT_SPEED_MEDIUM;
  const lens = inBedroom(speed);
  tap(lens);
  for (let i = 0; i < 20 && !lens.pageWaiting; i++) lens.frame();
  check("the page is up", lens.pageWaiting === true, JSON.stringify(lens.state()));

  const required = page0Letters * speed + 1; // 70: bisected on the ROM (tools/oracle)
  const pagesBefore = lens.pages.length;
  let earlyAckSeen = false;
  for (let f = 0; f < required - 1; f++) {
    tap(lens);
    if (lens.pages.length !== pagesBefore) { earlyAckSeen = true; break; }
  }
  check("all of the " + (required - 1) + " frames before the " + required + "th is not enough: no early press turned the page",
        !earlyAckSeen, "turned after " + (earlyAckSeen ? "an early press" : "none"));
  check("and textReady() itself still says no, one frame short", !lens.loop.textReady());

  lens.frame(); // the required-th frame since the page appeared
  check("textReady() flips to yes exactly on schedule", lens.loop.textReady());
  tap(lens); // acknowledges page 1; the VM advances its page index this frame...
  lens.frame(); // ...and shows page 2 the frame after, same as any other page turn
  check("and the very next press turns the page", lens.pages.length === pagesBefore + 1);
}

console.log("\n== The three text speeds print at three different, measured paces ==");
for (const [name, speed] of [["FAST", TEXT_SPEED_FAST], ["MEDIUM", TEXT_SPEED_MEDIUM], ["SLOW", TEXT_SPEED_SLOW]]) {
  const lens = inBedroom(speed);
  tap(lens);
  for (let i = 0; i < 20 && !lens.pageWaiting; i++) lens.frame();
  const required = page0Letters * speed + 1;
  let readyAt = -1;
  for (let f = 0; f <= required + 5; f++) {
    if (lens.loop.textReady()) { readyAt = f; break; }
    lens.frame();
  }
  check(name + ": ready at frame " + required + " (" + speed + " frames a letter), not before or after", readyAt === required,
        "readyAt=" + readyAt);
}

console.log("\n== A press ignored mid-print is truly discarded, not queued for later ==");
{
  // The historical bug: three quick presses advanced three pages on the
  // lens and one on the ROM. Reproduce the three-quick-presses shape and
  // confirm only the first one (the one that opens the box) does anything
  // until the page has actually finished printing.
  const speed = TEXT_SPEED_MEDIUM;
  const lens = inBedroom(speed);
  const linesBefore = lens.lines.length;
  lens.press("a"); // opens the box (12 frames -- well short of the ~70 needed)
  lens.press("a"); // would have turned page 1 on the old, instant-ack lens
  lens.press("a"); // would have turned page 2 on the old, instant-ack lens
  check("three quick presses show only the first page, not three",
        lens.pages.length === 1 && lens.lines.slice(linesBefore).join(" ").indexOf("SNES") >= 0 &&
        lens.lines.slice(linesBefore).join(" ").indexOf("Okay") < 0,
        JSON.stringify(lens.pages) + " / " + JSON.stringify(lens.lines.slice(linesBefore)));
}

console.log("\n== A carried `cont` line does not inflate the next page's wait ==");
{
  // Page 2 must not need anywhere near (25)*speed+1 frames, which is what
  // charging for its CARRIED top line too (17+8=25 letters) would demand;
  // it needs no more than its own 8 new letters call for. (The cartridge's
  // scroll transition itself costs a further, roughly speed-independent
  // handful of frames this lens does not model -- a render-only animation,
  // not a rule of when input counts, so it is left for a hand-eye pass, the
  // way the ledge hop's arc was.)
  const speed = TEXT_SPEED_MEDIUM;
  const lens = inBedroom(speed);
  tap(lens);
  for (let i = 0; i < 20 && !lens.pageWaiting; i++) lens.frame();
  const page0Required = page0Letters * speed + 1;
  for (let f = 0; f < page0Required; f++) lens.frame();
  const pagesBefore = lens.pages.length;
  tap(lens); // acks page 1
  for (let i = 0; i < 10 && lens.pages.length === pagesBefore; i++) lens.frame();
  check("page 2 is up", lens.pageWaiting === true && lens.pages.length === pagesBefore + 1, JSON.stringify(lens.pages));

  const wrongIfCarryCounted = (17 + page1Letters) * speed + 1; // 76
  const required = page1Letters * speed + 1; // 25
  check("its own required(" + required + ") is far short of what double-counting the carry would demand(" + wrongIfCarryCounted + ")",
        required < wrongIfCarryCounted - 20);
  for (let f = 0; f < required - 1; f++) tap(lens);
  check("not ready with fewer frames than its 8 new letters need", !lens.loop.textReady());
}

console.log("\nTEXTPACE " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
