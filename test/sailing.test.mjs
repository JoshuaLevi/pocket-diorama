// The S.S. ANNE sails, and what Vermilion looks like afterwards.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/sailing.test.mjs Assets/Generated/kanto.json
//
// scripts/VermilionDock.asm. The cutscene is the one event in Red that takes
// the map apart: the ship slides away, water is written over the berth and the
// gangway warp is deleted. The lens cannot slide her yet, so what is checked
// here is the trigger (which is easy to get wrong -- it is NOT walking down
// the dock), the sounds and music in order, the walk that ends in town, and
// the end state of the dock.
//
// Two corrections to VERMILION_CITY ride along, both from VermilionCity.asm:
// the sailor greets you from above and below without asking for a ticket
// (:162-171, :195-198), and the cell in front of him only stops someone
// walking DOWN toward the ship (:41-47).

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const S = await import(P + "script/Sailing.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: sailing.test.mjs <bundle.json>");
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

function lensAt(mapId, x, y, facing, flags, bag) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 22, () => 0.5));
  if (flags) { for (const f of flags) { state.flags[f] = true; } }
  if (bag) { for (const id of bag) { state.bag.push({ id: id, count: 1 }); } }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

/** Run whatever is going to its end, turning pages as they come. */
function drive(lens, limit) {
  let n = 0;
  const cap = limit || 30000;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < cap) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return n;
}

/** Off the ship: one step up from SS_ANNE_1F's bow warp lands on the gangway. */
function stepOffTheShip(flags) {
  const lens = lensAt("SS_ANNE_1F", 26, 1, "up", flags);
  lens.run([{ walk: "up", n: 1 }]);
  return lens;
}

console.log("== Stepping off the ship with CUT in hand ==");
{
  const lens = stepOffTheShip(["EVENT_GOT_HM01"]);
  const arrived = lens.state();
  check("the ship's exit lands on the dock's gangway",
        arrived.map === "VERMILION_DOCK" && arrived.x === 14 && arrived.y === 2,
        arrived.map + " " + arrived.x + "," + arrived.y);
  const before = [];
  for (const row of S.SHIP_GONE_BLOCKS) { before.push(lens.overworld.map.blockAt(row[0], row[1])); }
  drive(lens);
  const after = lens.state();
  check("she is gone for good", lens.play.flags[S.EVENT_SS_ANNE_LEFT] === true);
  check("the horn sounds twice", lens.sounds.filter((s) => s === "SS_Anne_Horn").length === 2,
        JSON.stringify(lens.sounds));
  // She slides: one redraw per column and one more for the berth.
  const redraws = lens.events.filter((e) => e === "redraw").length;
  check("she leaves a column at a time", redraws >= S.SHIP_SLIDE_STEPS + 1, redraws + " redraws");
  check("the dock's music stops for MUSIC_SURFING and comes back after",
        lens.music.indexOf("stop") >= 0 &&
        lens.music[lens.music.indexOf("stop") + 1] === "Music_Surfing" &&
        lens.music[lens.music.length - 1] === "default", JSON.stringify(lens.music));
  check("the berth was the ship and is now water",
        before.join(",") === "4,5,6,7,8,9,10,11" &&
        S.SHIP_GONE_BLOCKS.map((r) => r[2]).join(",") === "1,1,1,1,13,13,13,13",
        before.join(",") + " -> " + S.SHIP_GONE_BLOCKS.map((r) => r[2]).join(","));
  check("and you are walked off the dock into town",
        after.map === "VERMILION_CITY" && after.x === 18 && after.y === 29,
        after.map + " " + after.x + "," + after.y);
  check("the ticket cell you were walked over said nothing",
        lens.pages.join(" ").indexOf("ticket") < 0, JSON.stringify(lens.pages));
}

console.log("\n== The dock she has left ==");
{
  const lens = lensAt("VERMILION_DOCK", 14, 1, "down", ["EVENT_GOT_HM01", S.EVENT_SS_ANNE_LEFT]);
  check("water where she lay",
        S.SHIP_GONE_BLOCKS.every((row) => lens.overworld.map.blockAt(row[0], row[1]) === row[2]),
        S.SHIP_GONE_BLOCKS.map((r) => lens.overworld.map.blockAt(r[0], r[1])).join(","));
  lens.run([{ walk: "down", n: 1 }]);
  drive(lens, 600);
  const at = lens.state();
  // The berth is water now, so the step onto it is refused before the warp is
  // ever consulted -- which is what the cartridge leaves behind too, and the
  // reason the player is walked off the dock rather than left standing there.
  check("the gangway is no longer a way aboard", at.map === "VERMILION_DOCK" && at.y === 1,
        at.map + " " + at.x + "," + at.y);
  const mark = lens.pages.length;
  lens.run([{ walk: "down", n: 1 }]);
  drive(lens, 600);
  check("and nothing sails a second time",
        lens.sounds.indexOf("SS_Anne_Horn") < 0 && lens.pages.length === mark,
        JSON.stringify(lens.sounds));
}

console.log("\n== Without HM01 the ship stays moored ==");
{
  const lens = stepOffTheShip(null);
  drive(lens, 600);
  const at = lens.state();
  check("no cutscene, and you stand where you stepped",
        at.map === "VERMILION_DOCK" && at.y === 2 &&
        lens.play.flags[S.EVENT_SS_ANNE_LEFT] !== true && lens.sounds.indexOf("SS_Anne_Horn") < 0,
        at.map + " " + at.x + "," + at.y + " " + JSON.stringify(lens.sounds));
  lens.run([{ walk: "up", n: 2 }]);
  drive(lens, 900);
  check("and the dock is still a way back aboard and into town",
        lens.state().map === "VERMILION_CITY", JSON.stringify(lens.state()));
}

console.log("\n== The sailor at the gangway ==");
function talkToSailor(x, y, facing) {
  const lens = lensAt("VERMILION_CITY", x, y, facing, ["EVENT_GOT_STARTER"]);
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  drive(lens, 3000);
  return lens.pages.slice(mark).join(" ");
}
{
  const right = talkToSailor(20, 30, "left");
  check("from his right, he asks for the ticket", right.indexOf("ticket") >= 0, right);
  const above = talkToSailor(19, 29, "down");
  check("from above, only the welcome", above.indexOf("Welcome") >= 0 && above.indexOf("ticket") < 0, above);
  const below = talkToSailor(19, 31, "up");
  check("from below, only the welcome", below.indexOf("Welcome") >= 0 && below.indexOf("ticket") < 0, below);
}

console.log("\n== The cell in front of him ==");
{
  const down = lensAt("VERMILION_CITY", 18, 29, "down", ["EVENT_GOT_STARTER"]);
  const mark = down.pages.length;
  down.run([{ walk: "down", n: 1 }]);
  drive(down, 3000);
  check("walking down to the ship is stopped and asked",
        down.pages.slice(mark).join(" ").indexOf("ticket") >= 0, JSON.stringify(down.pages.slice(mark)));
  const up = lensAt("VERMILION_CITY", 18, 31, "up", ["EVENT_GOT_STARTER"]);
  const mark2 = up.pages.length;
  up.run([{ walk: "up", n: 1 }]);
  drive(up, 3000);
  check("coming back up from the dock is not", up.pages.slice(mark2).length === 0,
        JSON.stringify(up.pages.slice(mark2)));
}


console.log("== The slide, column by column ==");
{
  const rest = S.shipBlocksAfter(0);
  const ship = rest.filter((r) => S.SHIP_AT_REST.some((a) => a[0] === r[0] && a[1] === r[1] && a[2] === r[2]));
  check("shift 0 still holds all eight of her blocks", ship.length === 8, JSON.stringify(rest));
  const gone = S.shipBlocksAfter(S.SHIP_SLIDE_STEPS);
  check("the last step is exactly the empty berth",
        JSON.stringify(gone) === JSON.stringify(S.SHIP_GONE_BLOCKS), JSON.stringify(gone));
  let monotone = true;
  let inside = true;
  for (let shift = 1; shift <= S.SHIP_SLIDE_STEPS; shift++) {
    const now = S.shipBlocksAfter(shift);
    const hers = now.length - S.SHIP_GONE_BLOCKS.length;
    const before = S.shipBlocksAfter(shift - 1).length - S.SHIP_GONE_BLOCKS.length;
    if (hers > before) { monotone = false; }
    for (const row of now) { if (row[0] > S.SHIP_LAST_COLUMN) { inside = false; } }
  }
  check("every column takes some of her and never brings her back", monotone);
  check("nothing is ever stamped into the quay wall", inside);
  const mid = S.shipBlocksAfter(2);
  check("two columns out, the bow stands where the third block of deck was",
        mid.some((r) => r[0] === 7 && r[1] === 1 && r[2] === 4) &&
        mid.some((r) => r[0] === 5 && r[1] === 1 && r[2] === 1), JSON.stringify(mid));
}

console.log("\nSAILING " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
