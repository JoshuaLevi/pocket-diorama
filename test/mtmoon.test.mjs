// Mt Moon's fossil chamber: the Super Nerd's three answers, and the quiet room.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/mtmoon.test.mjs Assets/Generated/kanto.json
//
// Read against scripts/MtMoonB2F.asm. Two things there that nothing generic can
// produce:
//
//   * MtMoonB2FSuperNerdText branches three ways, and his trainer header knows
//     only two of them. Beaten, with both fossils still lying there, he says
//     "We'll each take one!" -- a line that belongs to no battle and so exists
//     in no header. The generic trainer script skips straight to the Cinnabar
//     line, which is the one thing he is standing there not to say yet.
//   * MtMoonB2F_Script sets BIT_NO_BATTLES over the sixteen cells of
//     MtMoonB2FFossilAreaCoords once he is beaten, and clears it on the step
//     out. It is a PLACE, not a moment: no other mechanism in the lens can
//     express "no wild Pokemon here".
//
// He is also the rare trainer with no `range` in his header, so he must NOT
// engage on sight; the fight comes from the cell beside him (13,8), which is
// the coordinate test in MtMoonB2FDefaultScript.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { inQuietZone, sightScanOff } = await import(P + "script/MapScripts.ts");
const { trainerHeaderFor } = await import(P + "script/TrainerTalk.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: mtmoon.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "MTMOON", "Red's Mt Moon cast, Yellow has Jessie and James there");
globalThis.print = () => {};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

/** A lens standing in the fossil chamber, built from a save (see gates.test.mjs). */
function lensAt(x, y, flags) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = "MT_MOON_B2F";
  state.cellX = x;
  state.cellY = y;
  state.facing = "down";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 16, () => 0.5));
  if (flags) { for (const f of flags) { state.flags[f] = true; } }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

/** Run whatever is going until it stops, answering pages. */
function drive(lens, limit) {
  let waited = 0;
  const max = limit || 6000;
  while ((lens.loop.isBusy() || lens.pageWaiting) && waited < max) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); waited += 12; continue; }
    lens.frame();
    waited++;
  }
  lens.settle();
}

/** Everything said since a mark, as one string. */
function saidSince(lens, mark) {
  return lens.pages.slice(mark).join(" ");
}

/** Press A at whoever is in front, then let the script finish. */
function talk(lens, facing) {
  const mark = lens.pages.length;
  lens.run([{ face: facing }, { press: "a" }]);
  let waited = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && waited < 4000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); waited += 12; continue; }
    lens.frame();
    waited++;
  }
  lens.settle();
  return saidSince(lens, mark);
}

console.log("== The Super Nerd has no reach ==");
{
  const map = bundle.maps.MT_MOON_B2F;
  const header = trainerHeaderFor(bundle, map, 1);
  check("he has a header", header !== null, JSON.stringify(header));
  check("and no range in it, so he never engages on sight",
        header !== null && !(header.range > 0), header ? "range=" + header.range : "");
  const rockets = [2, 3, 4, 5].map((i) => trainerHeaderFor(bundle, map, i));
  check("while the four Rockets all reach four cells",
        rockets.every((h) => h !== null && h.range === 4),
        JSON.stringify(rockets.map((h) => (h ? h.range : null))));
}

console.log("== Walking up to him starts the fight ==");
{
  const lens = lensAt(15, 8);
  const mark = lens.pages.length;
  lens.run([{ walk: "left", n: 2 }]);
  let waited = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && waited < 6000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); waited += 12; continue; }
    lens.frame();
    waited++;
  }
  lens.settle();
  const said = saidSince(lens, mark);
  const s = lens.state();
  check("the step onto (13,8) is what triggers it", s.x === 13 && s.y === 8,
        s.map + " " + s.x + "," + s.y);
  check("he claims both fossils", said.indexOf("both mine") >= 0, said.slice(0, 160));
  check("and once beaten he shares", said.indexOf("share") >= 0, said.slice(0, 200));
  check("the defeat is recorded", lens.play.flags.EVENT_BEAT_MT_MOON_3_SUPER_NERD === true);
}

console.log("== Beaten, with the fossils still there ==");
{
  const lens = lensAt(13, 8, ["EVENT_BEAT_MT_MOON_3_SUPER_NERD"]);
  const said = talk(lens, "left");
  check("he offers to take one each", said.indexOf("each take") >= 0, said.slice(0, 160));
  check("and does not send you to CINNABAR yet", said.indexOf("CINNABAR") < 0, said.slice(0, 160));
  check("nor does he fight again", said.indexOf("both mine") < 0, said.slice(0, 160));
}

console.log("== Beaten, with a fossil in the bag ==");
{
  const lens = lensAt(13, 8, ["EVENT_BEAT_MT_MOON_3_SUPER_NERD", "EVENT_GOT_DOME_FOSSIL"]);
  const said = talk(lens, "left");
  check("now he points at the lab", said.indexOf("CINNABAR") >= 0, said.slice(0, 200));
  check("and the sharing line is done with", said.indexOf("each take") < 0, said.slice(0, 160));
}
{
  const lens = lensAt(13, 8, ["EVENT_BEAT_MT_MOON_3_SUPER_NERD", "EVENT_GOT_HELIX_FOSSIL"]);
  const said = talk(lens, "left");
  check("either fossil does it", said.indexOf("CINNABAR") >= 0, said.slice(0, 200));
}

console.log("== The fossil chamber goes quiet ==");
{
  const inside = [[11, 5], [14, 5], [11, 8], [14, 8], [12, 6], [13, 6], [12, 8]];
  const outside = [[10, 6], [15, 6], [12, 4], [12, 9]];
  const flags = { EVENT_BEAT_MT_MOON_3_SUPER_NERD: true };
  check("every cell of MtMoonB2FFossilAreaCoords is quiet",
        inside.every(([x, y]) => inQuietZone("MT_MOON_B2F", x, y, flags)),
        JSON.stringify(inside.filter(([x, y]) => !inQuietZone("MT_MOON_B2F", x, y, flags))));
  check("and the cells around it are not",
        outside.every(([x, y]) => !inQuietZone("MT_MOON_B2F", x, y, flags)),
        JSON.stringify(outside.filter(([x, y]) => inQuietZone("MT_MOON_B2F", x, y, flags))));
  check("before he is beaten the room is as wild as the rest of the cave",
        !inQuietZone("MT_MOON_B2F", 12, 6, {}));
  check("and no other map is quiet anywhere",
        !inQuietZone("MT_MOON_B1F", 12, 6, flags) && !inQuietZone("ROUTE_4", 12, 6, flags));
}
{
  const lens = lensAt(12, 6, ["EVENT_BEAT_MT_MOON_3_SUPER_NERD"]);
  check("the live gate agrees standing in it", lens.loop.encountersAllowed() === false);
  const out = lensAt(10, 6, ["EVENT_BEAT_MT_MOON_3_SUPER_NERD"]);
  check("and one cell outside it does not", out.loop.encountersAllowed() === true);
}
{
  // WALKED into, not started in. The gate is read every frame off the live
  // cell; the save's cell is written by a throttled persist(), so a version
  // that read the save went quiet seconds late and stayed quiet seconds long.
  const lens = lensAt(9, 6, ["EVENT_BEAT_MT_MOON_3_SUPER_NERD"]);
  check("wild Pokemon are allowed on the way in", lens.loop.encountersAllowed() === true);
  lens.run([{ walk: "right", n: 2 }]);
  lens.settle();
  const s = lens.state();
  check("two steps right lands inside the chamber", s.x === 11 && s.y === 6, s.x + "," + s.y);
  check("and the room has gone quiet on arrival", lens.loop.encountersAllowed() === false);
  // (overworld.encountersEnabled is not asserted: this lens is built noWild,
  // which pins that switch to false whatever the gate says.)
  lens.run([{ walk: "left", n: 2 }]);
  lens.settle();
  check("stepping back out wakes it up again", lens.loop.encountersAllowed() === true,
        lens.state().x + "," + lens.state().y);
}

console.log("== A fossil in the bag, and the floor stops watching ==");
{
  // MtMoonB2FCheckGotAFossil: `CheckEitherEventSet DOME, HELIX / jp z,
  // CheckFightingMapTrainers / ret` -- Z means NEITHER is held, so the sight
  // scan runs only while both fossils are still on the floor. ROCKET1 stands
  // at (11,16) looking DOWN with a reach of four, so (11,20) is his last cell.
  const watched = lensAt(11, 21);
  watched.run([{ walk: "up", n: 1 }]);
  drive(watched);
  check("on the way in, the Rocket sees you", watched.battles.length > 0,
        JSON.stringify(watched.battles) + " at " + JSON.stringify(watched.state()));

  const carrying = lensAt(11, 21, ["EVENT_GOT_DOME_FOSSIL"]);
  carrying.run([{ walk: "up", n: 1 }]);
  drive(carrying);
  const s2 = carrying.state();
  check("with a fossil in the bag he does not", carrying.battles.length === 0,
        JSON.stringify(carrying.battles));
  check("and the walk is not interrupted", s2.x === 11 && s2.y === 20, s2.x + "," + s2.y);

  const helix = lensAt(11, 21, ["EVENT_GOT_HELIX_FOSSIL"]);
  helix.run([{ walk: "up", n: 1 }]);
  drive(helix);
  check("either fossil silences the floor", helix.battles.length === 0, JSON.stringify(helix.battles));

  // The gate is this map's alone.
  const elsewhere = lensAt(11, 21, ["EVENT_GOT_DOME_FOSSIL"]);
  elsewhere.play.mapId = "MT_MOON_B2F";
  check("and it is keyed on the map, not on the flag alone",
        sightScanOff("MT_MOON_B1F", { EVENT_GOT_DOME_FOSSIL: true }) === false &&
        sightScanOff("MT_MOON_B2F", { EVENT_GOT_DOME_FOSSIL: true }) === true);
}

console.log("== One fossil, and the Super Nerd takes the other ==");
for (const [fossil, cell, x, y, endX, endY] of [
  ["DOME", "MTMOONB2F_DOME_FOSSIL", 12, 7, 13, 8],
  ["HELIX", "MTMOONB2F_HELIX_FOSSIL", 13, 7, 12, 7],
]) {
  // The fossils are at (12,6) and (13,6); the player takes one from the cell
  // below it. MtMoonB2FMoveSuperNerd then moves him ONE step -- right when the
  // player is on a dome cell, up when on a helix one (MtMoonB2F.asm:90-129) --
  // so from his own (12,8) he ends on (13,8) or (12,7).
  const lens = lensAt(x, y, ["EVENT_BEAT_MT_MOON_3_SUPER_NERD"]);
  const mark = lens.pages.length;
  lens.run([{ face: "up" }, { press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 8000) {
    if (lens.answerWanted && lens.loop.textReady()) { lens.press("a"); n += 6; continue; }
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  const said = saidSince(lens, mark);
  check("taking the " + fossil + " fossil puts it in the bag",
        lens.play.bag.some((b) => b.id === fossil + "_FOSSIL"), JSON.stringify(lens.play.bag));
  check("he claims the other one", said.indexOf("this is mine") >= 0, said.slice(0, 200));
  check("which is gone from the floor",
        Object.keys(lens.play.objectToggles).some((k) => k.indexOf("FOSSIL") > 0 &&
          lens.play.objectToggles[k] === false),
        JSON.stringify(lens.play.objectToggles));
  const pose = lens.npcMotion.pose("MTMOONB2F_SUPER_NERD");
  check("and he ends on (" + endX + "," + endY + "), one step from his own cell",
        pose !== null && pose.x === endX && pose.y === endY, JSON.stringify(pose));
}

console.log("\nMTMOON " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
