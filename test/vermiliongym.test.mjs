// Vermilion Gym: the two switches under the trash, and the door they open.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/vermiliongym.test.mjs Assets/Generated/kanto.json
//
// engine/events/hidden_events/vermilion_gym_trash.asm GymTrashScript, and
// VermilionCity.asm:16-21 for where the first can is rolled. The random
// source is scripted here so each branch -- and the cartridge's own bug in
// choosing the second can -- lands where the asm puts it.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const T = await import(P + "script/TrashCans.ts");
const { rowIsOpen } = await import("../Assets/Scripts/world/BlockOverrides.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: vermiliongym.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "VERMILIONGYM", "Red's Vermilion Gym cast");
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

console.log("== The pure rolls ==");
{
  check("the first can is Random & $0e: always even", T.rollFirstCan(bytes([0x0f])) === 14 &&
        T.rollFirstCan(bytes([0x11])) === 0 && T.rollFirstCan(bytes([0xa7])) === 6);
  // The mask is ANDed, not taken modulo -- the routine's own comment says it
  // "should calculate a value in the range [0, 3]" and does not. Row 1 is
  // [3, 0, 2, 4, 0]: mask 3 & swap(byte) can be 1, 2 or 3 -> cans 0, 2, 4.
  check("the second can comes off the cartridge's table for the first",
        T.rollSecondCan(1, bytes([0x10])) === 0 && T.rollSecondCan(1, bytes([0x20])) === 2 &&
        T.rollSecondCan(1, bytes([0x30])) === 4,
        [0x10, 0x20, 0x30].map((b) => T.rollSecondCan(1, bytes([b]))).join(","));
  // Row 4 is [4, 1, 3, 5, 7] with mask 4: 4 & swap(byte) is 4 or nothing, so
  // from can 4 the second is can 7 -- or the bug.
  check("a mask of 4 reaches only its last entry", T.rollSecondCan(4, bytes([0x40])) === 7);
  // mask & swap(byte) = 0 -> minus one -> past the row onto padding: can 0.
  check("and a zero product is the cartridge's bug: can 0",
        T.rollSecondCan(4, bytes([0x30])) === 0 && T.rollSecondCan(6, bytes([0x40])) === 0 &&
        T.rollSecondCan(4, bytes([0x10])) === 0);
  check("a first can of 0 can put the second in 3, never in 1 (mask 2 & swap is 2 or 0)",
        T.rollSecondCan(0, bytes([0x20])) === 3 && T.rollSecondCan(0, bytes([0x10])) === 0);
}

console.log("== searchCan, branch by branch ==");
{
  const flags = {};
  const state = T.newTrashCanState();
  // First rolled on first use when the city never rolled it: byte 0x62 & 0x0e = 2.
  let script = T.searchCan(state, flags, 5, bytes([0x62]));
  check("a wrong can before the first switch: only trash", script[0].textId === T.TEXT_ONLY_TRASH &&
        flags[T.FIRST_LOCK] !== true && state.first === 2, JSON.stringify(state));
  // The right can: row 2 is [2, 1, 5, 0, 0]; mask 2 & swap(0x20)=2 -> can 5.
  script = T.searchCan(state, flags, 2, bytes([0x20]));
  check("the first can: the first lock opens, the switch sound after the line",
        flags[T.FIRST_LOCK] === true && script[0].textId === T.TEXT_FIRST_SWITCH && script[1].name === T.SOUND_SWITCH,
        JSON.stringify(script));
  check("and the second can is chosen next to it", state.second === 5, "" + state.second);
  // A wrong second: reset, new first from byte 0x0c & 0x0e = 12.
  script = T.searchCan(state, flags, 1, bytes([0x0c]));
  check("a wrong second can resets the locks, with the denied sound",
        flags[T.FIRST_LOCK] !== true && script[0].textId === T.TEXT_LOCKS_RESET && script[1].name === T.SOUND_DENIED &&
        state.first === 12 && state.second === -1, JSON.stringify(state));
  // Find 12, then its second: row 12 is [2, 9, 13, 0, 0]; mask 2 & swap(0x10)=... swap(0x10)=1, 2&1=0 -> bug, can 0.
  T.searchCan(state, flags, 12, bytes([0x10]));
  check("the bug can send the second switch to can 0 from anywhere", state.second === 0, "" + state.second);
  script = T.searchCan(state, flags, 0, bytes([0]));
  check("the second can: the second lock opens and the door sound plays",
        flags[T.SECOND_LOCK] === true && script[0].textId === T.TEXT_SECOND_SWITCH && script[1].name === T.SOUND_DOOR,
        JSON.stringify(script));
  script = T.searchCan(state, flags, 7, bytes([0]));
  check("afterwards every can is only trash", script[0].textId === T.TEXT_ONLY_TRASH && flags[T.SECOND_LOCK] === true);
}

console.log("== The door ==");
{
  const rows = bundle.blockOverrides.VERMILION_GYM;
  check("the gym's door row is in the bundle and live",
        Array.isArray(rows) && rows.length === 1 && rows[0].disabled !== true && rows[0].bx === 2 && rows[0].by === 2,
        JSON.stringify(rows));
  check("shut until the second lock", rowIsOpen(rows[0], {}) === false && rowIsOpen(rows[0], { EVENT_2ND_LOCK_OPENED: true }) === true);
  check("double doors closed, floor open, as VermilionGymSetDoorTile writes them",
        rows[0].closedBlock === 0x24 && rows[0].openBlock === 0x05);
}

console.log("== In the gym, through the loop ==");
{
  // Standing below can 0 at (1,7), facing up, with the first can rolled to 0.
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = "VERMILION_GYM";
  state.cellX = 1;
  state.cellY = 8;
  state.facing = "up";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  // The gym's three trainers watch the aisles and the first cut of this check
  // walked straight into the Super Nerd's line of sight between can 0 and
  // can 3 -- which is the gym working, not the puzzle. They are beaten here.
  state.flags.EVENT_BEAT_VERMILION_GYM_TRAINER_0 = true;
  state.flags.EVENT_BEAT_VERMILION_GYM_TRAINER_1 = true;
  state.flags.EVENT_BEAT_VERMILION_GYM_TRAINER_2 = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
  // The loop rolls the first can on entering the CITY; entering the gym
  // directly leaves it unrolled, so the first press rolls it: 0x00 -> can 0.
  // Then the second: row 0 is [2, 1, 3]; mask 2 & swap(0x20) = 2 & 2 = 2 ->
  // row[2] = can 3.
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true, random: bytes([0x00, 0x20, 0x00]) });
  lens.clearText();
  lens.settle();
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 3000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame(); n++;
  }
  lens.settle();
  const said = lens.pages.slice(mark).join(" ");
  check("pressing A at a can searches it", said.indexOf("switch under the") >= 0 || said.indexOf("only trash") >= 0, said);
  check("and here it was the first switch", lens.play.flags.EVENT_1ST_LOCK_OPENED === true &&
        lens.sounds.indexOf("Switch") >= 0, said + " " + JSON.stringify(lens.sounds));
  const blockBefore = lens.overworld.map.blockAt(2, 2);
  // Can 3 is at (3,7) and (3,8) beneath it is a wall (the cans stand in the
  // aisle's own pillars), so it is searched from its left, (2,7) facing right.
  lens.run([{ walk: "right", n: 1 }, { walk: "up", n: 1 }, { face: "right" }, { press: "a" }]);
  n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 3000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame(); n++;
  }
  lens.settle();
  check("the second can opens the second lock", lens.play.flags.EVENT_2ND_LOCK_OPENED === true,
        JSON.stringify({ at: lens.state(), pages: lens.pages.slice(mark), sounds: lens.sounds }));
  check("and the door block changes under the flag",
        blockBefore === 0x24 && lens.overworld.map.blockAt(2, 2) === 0x05,
        blockBefore + " -> " + lens.overworld.map.blockAt(2, 2));
}

console.log("\nVERMILIONGYM " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
