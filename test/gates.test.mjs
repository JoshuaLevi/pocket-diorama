// The two coordinate gates that make the first badge mean something.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/gates.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Measured on 11 September, before either gate existed: from PEWTER_CITY
// (30,18) twelve steps right reached ROUTE_3 (2,10) with no badge and no
// dialogue, and from VIRIDIAN_CITY the road north was open without the
// POKEDEX. Kanto was one open field -- the BOULDERBADGE opened nothing,
// because nothing was shut.
//
// Both gates are coordinate triggers in the cartridge, and both are keyed on
// a flag rather than on a body being in the way:
//
//   VIRIDIAN_CITY (19,9)     unless EVENT_GOT_POKEDEX   -- a line and a shove
//   PEWTER_CITY   4 cells    unless EVENT_BEAT_BROCK    -- the gym escort
//
// The escort is the reason Pewter is the expensive one. It is not a line: the
// text arms PewterGymGuyMovementScriptPointerTable, which walks the player to
// the gym on simulated joypad states while the youngster leads one cell ahead.
// This suite drives the whole thing through the real engine and checks where
// everyone is standing when it lets go.
//
// --selftest opens each gate the way a regression would -- by handing the save
// the flag -- and checks the suite notices the road is open.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const SELFTEST = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: gates.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
globalThis.print = () => {};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

/**
 * A lens standing where the walk starts, with a party and no wild Pokemon.
 *
 * Built from a save rather than by new-gaming and walking here: a lens made
 * without EVENT_INTRO_DONE runs the intro, which ends by putting the player
 * in the bedroom -- so every assertion below would be about REDS_HOUSE_2F.
 * Flags are set one by one for the same reason: replacing the store wholesale
 * drops the one the intro reads.
 */
function lensAt(mapId, x, y, flags) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = "down";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 14, () => 0.5));
  if (flags) { for (const f of flags) { state.flags[f] = true; } }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

/** Everything said since a mark, as one string. */
function saidSince(lens, mark) {
  return lens.pages.slice(mark).join(" ");
}

/**
 * Drive a running script to its end, remembering every cell an NPC stood on.
 *
 * The escort's own claim is that the youngster LEADS -- so "he is back on his
 * shipped cell when it is over" is not enough on its own: a script that never
 * moved him would pass it too. This records where he actually went, so the
 * trip is what is asserted and the homecoming is only the last of it.
 */
function driveWatching(lens, npc, maxFrames) {
  const seen = [];
  const limit = maxFrames || 20000;
  let waited = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && waited < limit) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); waited += 12; continue; }
    lens.frame();
    waited++;
    const pose = lens.npcMotion.pose(npc);
    if (pose) {
      const at = pose.x + "," + pose.y;
      if (seen.length === 0 || seen[seen.length - 1] !== at) { seen.push(at); }
    }
  }
  lens.settle();
  return seen;
}

console.log("== Viridian: the sleeper shuts the road north ==");
{
  const lens = lensAt("VIRIDIAN_CITY", 19, 12);
  const mark = lens.pages.length;
  lens.run([{ walk: "up", n: 3 }]);
  lens.clearText();
  lens.settle();
  const s = lens.state();
  const said = saidSince(lens, mark);
  check("he says it is private property", said.indexOf("private") >= 0, said.slice(0, 120));
  check("and the step onto (19,9) is given back", s.map === "VIRIDIAN_CITY" && s.x === 19 && s.y === 10,
        JSON.stringify({ x: s.x, y: s.y }));
  check("the script has let go", !lens.loop.isBusy());

  // The gate does not wear out: it is polled, not armed once.
  const again = lens.pages.length;
  lens.run([{ walk: "up", n: 1 }]);
  lens.clearText();
  lens.settle();
  check("walking into him again says it again", saidSince(lens, again).indexOf("private") >= 0);
  check("and gives that step back too", lens.state().y === 10, JSON.stringify(lens.state()));
}

console.log("\n== Viridian: the POKEDEX opens it ==");
const yellow = bundle.romSha1 === "cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1";
if (yellow) {
  // Yellow: the Pokedex stands the tutorial man on the sleeper's cell, and
  // the gap beside him starts his lesson once (ViridianCityCheckWaitingOldMan).
  // With the lesson done the road is Red's: walked straight through.
  const first = lensAt("VIRIDIAN_CITY", 19, 12, ["EVENT_GOT_POKEDEX"]);
  const mark = first.pages.length;
  first.run([{ walk: "up", n: 4 }]);
  first.settle();
  check("the tutorial man stops you at the gap", /coffee/i.test(saidSince(first, mark)),
        saidSince(first, mark).slice(0, 120));
  check("the sleeper is gone", first.loop.revealOf("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN_SLEEPY") === false);
  const lens = lensAt("VIRIDIAN_CITY", 19, 12, ["EVENT_GOT_POKEDEX", "EVENT_COMPLETED_CATCH_TRAINING"]);
  const mark2 = lens.pages.length;
  lens.run([{ walk: "up", n: 4 }]);
  lens.settle();
  const s = lens.state();
  check("with the lesson done nothing is said", saidSince(lens, mark2) === "", saidSince(lens, mark2).slice(0, 120));
  check("and the road north is walked straight through", s.x === 19 && s.y === 8,
        JSON.stringify({ x: s.x, y: s.y }));
  check("and neither old man stands until the mart brings the walker out",
        lens.loop.revealOf("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN2") === false &&
        lens.loop.revealOf("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN") === false);
} else {
  const lens = lensAt("VIRIDIAN_CITY", 19, 12, ["EVENT_GOT_POKEDEX"]);
  const mark = lens.pages.length;
  lens.run([{ walk: "up", n: 4 }]);
  lens.settle();
  const s = lens.state();
  check("nothing is said", saidSince(lens, mark) === "", saidSince(lens, mark).slice(0, 120));
  check("and the road north is walked straight through", s.x === 19 && s.y === 8,
        JSON.stringify({ x: s.x, y: s.y }));
  // The same flag settles the two bodies, whether or not the lab script that
  // set it ever wrote the toggles into this save.
  check("the sleeper is gone", lens.loop.revealOf("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN_SLEEPY") === false);
  check("and the walking old man is standing", lens.loop.revealOf("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN") === true);
}

console.log("\n== Pewter: the road east is shut, and you are walked to the gym ==");
// The four cells of PewterCityPlayerLeavingEastCoords, each reached by a step
// so the landing is a real one, and each converging on the same two cells.
const APPROACHES = [
  { from: [34, 17], walk: "right", cell: [35, 17] },
  { from: [36, 18], walk: "up", cell: [36, 17] },
  { from: [30, 18], walk: "right", cell: [37, 18] },
  { from: [36, 19], walk: "right", cell: [37, 19] },
];
for (const approach of APPROACHES) {
  const at = "(" + approach.cell[0] + "," + approach.cell[1] + ")";
  const lens = lensAt("PEWTER_CITY", approach.from[0], approach.from[1]);
  const mark = lens.pages.length;
  lens.run([{ walk: approach.walk, n: 12 }]);
  // The escort is a forty-one step walk at a frame a time, with a page at
  // each end of it. Watch the youngster across the whole of it.
  const walked = driveWatching(lens, "PEWTERCITY_YOUNGSTER");
  const s = lens.state();
  const said = saidSince(lens, mark);
  check(at + " stops you and he asks you to follow", said.indexOf("Follow me!") >= 0, said.slice(0, 160));
  check(at + " leaves you by the gym on (11,18)", s.map === "PEWTER_CITY" && s.x === 11 && s.y === 18,
        JSON.stringify({ map: s.map, x: s.x, y: s.y }));
  check(at + " and he tells you to take on BROCK", said.indexOf("take on BROCK") >= 0, said.slice(-120));
  check(at + " the script has let go", !lens.loop.isBusy());
  // RLEList_PewterGymGuy ends on (12,18), beside where the player is left;
  // MovementData_PewterGymGuyExit then takes him five right into the dead
  // end on (17,18), and only then is he put back on his shipped cell.
  check(at + " he led the way to (12,18)", walked.indexOf("12,18") >= 0, walked.slice(0, 6).join(" ") + " ... " + walked.slice(-6).join(" "));
  check(at + " and walked off east into (17,18)", walked.indexOf("17,18") > walked.indexOf("12,18"),
        walked.slice(-8).join(" "));
  check(at + " ending back on his own cell, still in the way",
        walked[walked.length - 1] === "35,16" &&
        lens.loop.revealOf("PEWTER_CITY", "PEWTERCITY_YOUNGSTER") === true &&
        lens.overworld.map.objectAt(35, 16) !== null,
        walked.slice(-4).join(" "));
}

console.log("\n== Pewter: the BOULDERBADGE opens Route 3 ==");
{
  const lens = lensAt("PEWTER_CITY", 30, 18, ["EVENT_BEAT_BROCK"]);
  const mark = lens.pages.length;
  lens.run([{ walk: "right", n: 12 }]);
  lens.settle();
  const s = lens.state();
  check("nothing is said", saidSince(lens, mark) === "", saidSince(lens, mark).slice(0, 120));
  check("and twelve steps east is Route 3", s.map === "ROUTE_3", JSON.stringify({ map: s.map, x: s.x, y: s.y }));
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // Open each gate the way a regression would -- by handing the save the flag
  // the gate reads -- and prove the checks above are what catches it.
  const viridian = lensAt("VIRIDIAN_CITY", 19, 12, ["EVENT_GOT_POKEDEX"]);
  viridian.run([{ walk: "up", n: 3 }]);
  viridian.settle();
  check("an open Viridian would have walked past (19,9)", viridian.state().y === 9,
        JSON.stringify(viridian.state()));

  const pewter = lensAt("PEWTER_CITY", 30, 18, ["EVENT_BEAT_BROCK"]);
  pewter.run([{ walk: "right", n: 8 }]);
  pewter.settle();
  check("an open Pewter would have walked past (37,18)", pewter.state().x > 37,
        JSON.stringify(pewter.state()));

  // And the escort's own two halves: the walk must END somewhere, and the
  // youngster must come back. A script that stopped halfway would still print
  // both pages, so the cell is the only honest assertion.
  const halfway = lensAt("PEWTER_CITY", 30, 18);
  halfway.run([{ walk: "right", n: 12 }]);
  driveWatching(halfway, "PEWTERCITY_YOUNGSTER");
  check("the escort ends standing still, not mid-walk",
        !halfway.overworld.isWalkingScripted(), JSON.stringify(halfway.state()));
}

console.log("\nGATES " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
