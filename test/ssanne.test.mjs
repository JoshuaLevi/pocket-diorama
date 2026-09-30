// The S.S. Anne: the rival on the second deck.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/ssanne.test.mjs Assets/Generated/kanto.json
//
// Milestone 3 of docs/PLAN-FULL-GAME.md. Read against scripts/SSAnne2F.asm;
// the captain's room is checked in playloop.test.mjs.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: ssanne.test.mjs <bundle.json>");
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

/** A random() that hands out these bytes in order, then repeats the last. */
function bytes(list) {
  let i = 0;
  return () => { const b = list[Math.min(i, list.length - 1)]; i++; return b / 256; };
}

function lensAt(mapId, x, y, flags) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = "up";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 22, () => 0.5));
  if (flags) { for (const f of flags) { state.flags[f] = true; } }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

/** Run whatever is going to its end, remembering every cell the rival stood on. */
function driveWatching(lens, npc) {
  const seen = [];
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 30000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
    const pose = lens.npcMotion.pose(npc);
    if (pose) {
      const at = pose.x + "," + pose.y;
      if (seen.length === 0 || seen[seen.length - 1] !== at) { seen.push(at); }
    }
  }
  lens.settle();
  return seen;
}

console.log("== The rival on the second deck, from the left-hand cell ==");
{
  const lens = lensAt("SS_ANNE_2F", 36, 10);
  const mark = lens.pages.length;
  lens.run([{ walk: "up", n: 2 }]);
  const trail = driveWatching(lens, "SSANNE2F_RIVAL");
  const said = lens.pages.slice(mark).join(" ");
  const s = lens.state();
  check("landing on (36,8) starts it", s.x === 36 && s.y === 8, s.x + "," + s.y);
  check("the music stops and MEET RIVAL plays before he is shown",
        lens.music.indexOf("stop") >= 0 && lens.music.indexOf("Music_MeetRival") === lens.music.indexOf("stop") + 1,
        JSON.stringify(lens.music));
  check("he walks down three to the cell above you", trail.indexOf("36,7") >= 0 && trail.indexOf("36,8") < trail.indexOf("36,7") + 1,
        JSON.stringify(trail));
  check("Bonjour", said.indexOf("Bonjour") >= 0, said.slice(0, 120));
  check("the battle is OPP_RIVAL2 with the roster his starter decides",
        lens.battles.length === 1 && lens.battles[0] === "OPP_RIVAL2#1", JSON.stringify(lens.battles));
  check("beaten, the flag is set", lens.play.flags.EVENT_BEAT_SS_ANNE_RIVAL === true);
  check("he says so, and that the cut master was seasick",
        said.indexOf("Humph") >= 0 && said.indexOf("CUT") >= 0 && said.indexOf("Humph") < said.indexOf("CUT"),
        said.slice(0, 400));
  check("he walks around you and down the corridor",
        trail.indexOf("37,7") >= 0 && trail[trail.length - 1] === "37,12", JSON.stringify(trail));
  check("and is gone, with the ship's music back",
        lens.play.objectToggles["SS_ANNE_2F:SSANNE2F_RIVAL"] === false && lens.music[lens.music.length - 1] === "default",
        JSON.stringify(lens.music));
  check("you kept facing the way you walked", s.facing === "up", s.facing);
}

console.log("== From the right-hand cell ==");
{
  const lens = lensAt("SS_ANNE_2F", 37, 10);
  lens.run([{ walk: "up", n: 2 }]);
  const trail = driveWatching(lens, "SSANNE2F_RIVAL");
  const s = lens.state();
  check("landing on (37,8) starts it", s.x === 37 && s.y === 8 && lens.battles.length === 1, s.x + "," + s.y);
  check("he walks down four to the cell beside you", trail.indexOf("36,8") >= 0, JSON.stringify(trail));
  check("you are turned to face him", s.facing === "left", s.facing);
  check("and he leaves straight down the corridor", trail[trail.length - 1] === "36,12", JSON.stringify(trail));
}

console.log("== Once beaten, the deck is quiet ==");
{
  const lens = lensAt("SS_ANNE_2F", 36, 10, ["EVENT_BEAT_SS_ANNE_RIVAL"]);
  const mark = lens.pages.length;
  lens.run([{ walk: "up", n: 2 }]);
  driveWatching(lens, "SSANNE2F_RIVAL");
  check("neither cell says anything", lens.pages.slice(mark).length === 0 && lens.battles.length === 0,
        JSON.stringify(lens.pages.slice(mark)));
}

console.log("\n== Le CHEF and the main course ==");
{
  // SSAnneKitchen.asm:39-73. ONE byte of hRandomAdd decides: bit 7 set is
  // salmon (half the time), else bit 4 set is eels, else steak. The same byte
  // is read twice, so a lens that drew twice would agree on the odds and
  // disagree on the answer.
  function askTheChef(byte) {
    const state = PlayState.newPlayState(bundle.romSha1);
    state.playerName = "RED";
    state.mapId = "SS_ANNE_KITCHEN";
    state.cellX = 11;
    state.cellY = 12;
    state.facing = "down";
    state.flags.EVENT_INTRO_DONE = true;
    state.flags.EVENT_GOT_STARTER = true;
    state.party.push(makeWildMon(bundle, "CHARMANDER", 22, () => 0.5));
    const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true, random: bytes([byte]) });
    lens.clearText();
    lens.settle();
    const mark = lens.pages.length;
    lens.run([{ press: "a" }]);
    let n = 0;
    while ((lens.loop.isBusy() || lens.pageWaiting) && n < 3000) {
      if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
      lens.frame();
      n++;
    }
    lens.settle();
    return lens.pages.slice(mark).join(" ");
  }
  const salmon = askTheChef(0x80);
  check("he announces the main course", salmon.indexOf("le CHEF") >= 0 && salmon.indexOf("main course") >= 0,
        salmon.slice(0, 120));
  check("bit 7 set: Salmon du Salad", salmon.indexOf("Salmon") >= 0, salmon);
  const eels = askTheChef(0x10);
  check("bit 7 clear and bit 4 set: Eels au Barbecue", eels.indexOf("Eels") >= 0, eels);
  const steak = askTheChef(0x00);
  check("neither: Prime Beef Steak", steak.indexOf("Beef Steak") >= 0, steak);
  check("and one draw decides, not two", askTheChef(0x90).indexOf("Salmon") >= 0, askTheChef(0x90));
}

console.log("\nSSANNE " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
