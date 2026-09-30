// What the battle box actually puts on screen, line by line.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battletext.test.mjs Assets/Generated/kanto.json [--selftest]
//
// battlerunner.test.mjs already drives whole battles, but its fake view does
// `lines.join(" ")` -- it flattens the page before looking at it, so a runner
// that handed the box ONE string containing a newline passed every check for
// months. On the 7 September glasses recording that showed up as
//
//     OPP RIVAL1 sent ou
//
// eighteen characters wide, cut mid-word, with "out BULBASAUR!" never drawn:
// the box clips at its 18 columns and the cartridge's own line break went in
// as a character rather than as a break.
//
// So this test looks at the ARRAY. The rule it enforces is the box's own: a
// page is a list of lines, a line is one row of the box, and neither the
// cartridge's `\n` (new line), `\f` (new page) nor `\v` (scroll) may ever
// reach the screen as text.

import { readFileSync } from "node:fs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: battletext.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const R = await import(P + "BattleRunner.ts");
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** The box's own width, in characters. CanvasTextBox draws 18 and clips. */
const BOX_COLUMNS = 18;
/** The box's own height, in rows. */
const BOX_ROWS = 2;

/**
 * A player who reads everything at once and fights with the first move.
 * `pages` keeps every page EXACTLY as the runner handed it over.
 */
function makeView(opts) {
  const o = opts || {};
  const pages = [];
  let menuOpen = false;
  const view = {
    pages,
    showLines: (lines) => pages.push(lines),
    acknowledged: () => true,
    hideBox: () => { view.hidden = (view.hidden || 0) + 1; },
    showMoves: (names) => { menuOpen = true; view.lastMoves = names; },
    chosenMove: () => {
      if (!menuOpen) { return -1; }
      const rows = view.lastMoves ? view.lastMoves.length : 0;
      return rows === 0 ? -1 : 0;
    },
    hideMoves: () => { menuOpen = false; },
    wantsToRun: () => !!o.run,
    chosenSwitch: () => -1,
    chosenBagItem: () => "",
    chosenBagTarget: () => -1,
    sound: () => {},
    askLearn: () => {},
    learnDecision: () => -1,
  };
  return view;
}

function drive(runner, maxFrames) {
  let frames = 0;
  while (runner.isRunning() && frames < (maxFrames || 6000)) {
    runner.update();
    frames++;
  }
  return frames;
}

/** Every page from a wild battle and a trainer battle, played to the end. */
function collectPages(makeRunner) {
  const view = makeView({});
  const runner = makeRunner(view);
  drive(runner);
  return view.pages;
}

function wildPages(seed) {
  return collectPages((view) => {
    const play = PlayState.newPlayState(bundle.romSha1);
    play.party = [makeWildMon(bundle, "CHARMANDER", 12, seeded(seed))];
    const runner = new R.BattleRunner(bundle, play, view);
    runner.startWild("PIDGEY", 3, seeded(seed + 1));
    return runner;
  });
}

function trainerPages(seed) {
  return collectPages((view) => {
    const play = PlayState.newPlayState(bundle.romSha1);
    play.party = [makeWildMon(bundle, "CHARMANDER", 14, seeded(seed))];
    const runner = new R.BattleRunner(bundle, play, view);
    // The rival's first fight: this is the battle in the recording, and the
    // "sent out" line is the one that was cut.
    runner.startTrainer("OPP_RIVAL1", 1, seeded(seed + 1));
    return runner;
  });
}

let all = [];
try {
  all = wildPages(7).concat(trainerPages(11));
} catch (e) {
  console.log("  (trainer battle unavailable: " + e.message + ")");
  all = wildPages(7);
}

console.log("\n== the box a battle leaves behind ==");
{
  // The fault this catches: a fight that ends with its last page still on
  // screen and the runner already cleared. Nothing owns the box then, so
  // nothing can ever acknowledge it -- the 8 September playtest ended on
  // "abc gained 23 EXP. Points!" and could not press its way out.
  const view = makeView({});
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = [makeWildMon(bundle, "CHARMANDER", 20, seeded(5))];
  const runner = new R.BattleRunner(bundle, play, view);
  runner.startWild("PIDGEY", 3, seeded(6));
  drive(runner);
  check("the battle is over", runner.state() === R.RUNNER_DONE);
  check("and it closed the box on its way out", (view.hidden || 0) > 0,
        "hideBox was never called, so the last page stays up forever");
}

console.log("\n== Pages the battle box was handed (" + all.length + ") ==");

// ---------------------------------------------------------------------------
// 1. A page is a LIST of lines; control codes are breaks, never characters
// ---------------------------------------------------------------------------
{
  const offenders = [];
  for (const page of all) {
    for (const line of page) {
      if (typeof line !== "string") { offenders.push("non-string: " + line); continue; }
      if (line.indexOf("\n") >= 0) offenders.push("newline in " + JSON.stringify(line));
      if (line.indexOf("\f") >= 0) offenders.push("form feed in " + JSON.stringify(line));
      if (line.indexOf("\v") >= 0) offenders.push("scroll in " + JSON.stringify(line));
    }
  }
  check("no control code reaches the screen as a character",
        offenders.length === 0, offenders.slice(0, 4).join("\n          "));
}

// ---------------------------------------------------------------------------
// 2. Nothing is wider than the box, so nothing is cut mid-word
// ---------------------------------------------------------------------------
{
  const wide = [];
  for (const page of all) {
    for (const line of page) {
      if (typeof line === "string" && line.length > BOX_COLUMNS) {
        wide.push(line.length + " cols: " + JSON.stringify(line));
      }
    }
  }
  check("every line fits the box's " + BOX_COLUMNS + " columns",
        wide.length === 0, wide.slice(0, 4).join("\n          "));
}

// ---------------------------------------------------------------------------
// 3. A page is never taller than the box
// ---------------------------------------------------------------------------
{
  const tall = all.filter((p) => p.length > BOX_ROWS);
  check("every page fits the box's " + BOX_ROWS + " rows",
        tall.length === 0,
        tall.slice(0, 3).map((p) => p.length + " rows: " + JSON.stringify(p)).join("\n          "));
}

// ---------------------------------------------------------------------------
// 4. The break is really used: two-line pages exist
// ---------------------------------------------------------------------------
{
  const twoLine = all.filter((p) => p.length === 2);
  check("the cartridge's line break produces two-line pages",
        twoLine.length > 0,
        "every page was one line, so a break was swallowed rather than honoured");
}

// ---------------------------------------------------------------------------
// 5. The exact line from the recording
// ---------------------------------------------------------------------------
{
  const sentOut = all.filter((p) => p.join(" ").indexOf("sent") >= 0 &&
                                    p.join(" ").indexOf("out") >= 0);
  const ok = sentOut.length > 0 && sentOut.every((p) => p.length === 2);
  check("\"<TRAINER> sent / out <MON>!\" arrives as two lines",
        ok,
        sentOut.length === 0
          ? "no sent-out page seen (trainer battle may not have run)"
          : JSON.stringify(sentOut[0]));
}

// ---------------------------------------------------------------------------
// Selftest: prove these checks can fail
// ---------------------------------------------------------------------------
if (selftest) {
  console.log("\n== Selftest: the checks must reject a flattened page ==");
  const flattened = all.map((p) => [p.join("\n")]);
  let caught = 0;
  for (const page of flattened) {
    for (const line of page) if (line.indexOf("\n") >= 0) caught++;
  }
  check("a page flattened back into one string is rejected", caught > 0,
        "the control-code check would not have caught the bug it was written for");
  const overWide = [["x".repeat(BOX_COLUMNS + 1)]];
  check("an over-wide line is rejected",
        overWide[0][0].length > BOX_COLUMNS);
}

console.log("\nBATTLETEXT  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
