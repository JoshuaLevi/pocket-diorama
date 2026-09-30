// The two lifts, and the list that drives them.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/elevator.test.mjs Assets/Generated/kanto.json
//
// CeladonMartElevator.asm and RocketHideoutElevator.asm. A lift car has no
// destination of its own: it rewrites both of its own warps, to the floor you
// boarded from and then to the floor you pick, which is the whole of how a
// lift travels in Red.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { ChoiceController, CHOICE_CLOSED, CHOICE_NONE } = await import(P + "ChoiceController.ts");
const { elevatorFor, elevatorMaps } = await import(P + "script/Elevators.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: elevator.test.mjs <bundle.json>");
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

const NO_PAD = { up: false, down: false, left: false, right: false };
const pad = (dir) => Object.assign({}, NO_PAD, dir ? { [dir]: true } : {});

console.log("== The list itself ==");
{
  const list = new ChoiceController(["Which floor do you want?"], ["1F", "2F", "3F"], []);
  check("it opens on the first row", list.isOpen() && list.cursorRow() === 0 &&
        list.rows().join("|") === "1F|2F|3F", JSON.stringify(list.rows()));
  check("the question goes in the box", list.lines()[0].indexOf("Which floor") >= 0);
  check("a press moves nothing on its own", list.step(NO_PAD, false, false, 0.1) === CHOICE_NONE);
  list.step(pad("down"), false, false, 0.1);
  check("down moves the cursor", list.cursorRow() === 1, "" + list.cursorRow());
  check("A closes it on that row",
        list.step(NO_PAD, true, false, 0.1) === CHOICE_CLOSED && list.picked() === 1 &&
        !list.isOpen(), "" + list.picked());

  const cancelled = new ChoiceController(["?"], ["1F", "2F"], []);
  check("B is a cancel, and is never a row",
        cancelled.step(NO_PAD, false, true, 0.1) === CHOICE_CLOSED && cancelled.picked() === -1);

  const noted = new ChoiceController(["?"], ["FRESH WATER"], ["¥200"]);
  check("a note rides on the right of its row", noted.rows()[0].indexOf("¥200") > 0, noted.rows()[0]);

  const long = new ChoiceController(["?"], ["1", "2", "3", "4", "5", "6", "7", "8"], []);
  for (let i = 0; i < 7; i++) { long.step(pad("down"), false, false, 0.5); }
  check("a list longer than the window scrolls",
        long.rows().length === 6 && long.rows()[long.cursorRow()] === "8",
        JSON.stringify(long.rows()) + " cursor " + long.cursorRow());
}

console.log("\n== The tables ==");
{
  check("all three lifts are described", elevatorMaps().length === 3 &&
        elevatorFor("CELADON_MART_ELEVATOR") !== null &&
        elevatorFor("ROCKET_HIDEOUT_ELEVATOR") !== null &&
        elevatorFor("SILPH_CO_ELEVATOR") !== null, elevatorMaps().join(","));
  const mart = elevatorFor("CELADON_MART_ELEVATOR");
  check("the Mart's five floors, and 1F's own door is warp 5",
        mart.floors.length === 5 && mart.floors[0].warp === 5 && mart.floors[1].warp === 2,
        JSON.stringify(mart.floors));
  const hideout = elevatorFor("ROCKET_HIDEOUT_ELEVATOR");
  check("the hideout offers three floors and not B3F",
        hideout.floors.length === 3 &&
        hideout.floors.map((f) => f.label).join(",") === "B1F,B2F,B4F",
        JSON.stringify(hideout.floors));
  check("and asks for the LIFT KEY", hideout.keyItem === "LIFT_KEY" && mart.keyItem === "");
  const silph = elevatorFor("SILPH_CO_ELEVATOR");
  check("SILPH CO's runs the whole building, lobby to the office",
        silph.floors.length === 11 && silph.floors[0].label === "1F" &&
        silph.floors[10].label === "11F" && silph.keyItem === "",
        silph.floors.map((f) => f.label).join(","));
  // Every floor's warp index must actually be that floor's lift door.
  const wrong = [];
  for (const id of elevatorMaps()) {
    for (const floor of elevatorFor(id).floors) {
      const warp = bundle.maps[floor.map].warps[floor.warp];
      if (!warp || warp.destMap !== id) { wrong.push(floor.map + "#" + floor.warp); }
    }
  }
  check("and every one of them names a door back into the car", wrong.length === 0,
        JSON.stringify(wrong));
}

console.log("\n== Riding one ==");
function lensInLift(mapId, x, y, opts) {
  const o = opts || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = "up";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
  for (const id of o.bag || []) { state.bag.push({ id: id, count: 1 }); }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true, choice: o.choice });
  lens.clearText();
  lens.settle();
  return lens;
}

function pressA(lens) {
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 4000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.slice(mark).join(" ");
}
{
  // The panel is the sign at (3,0) in the Mart's car; the player reads it from
  // (3,1) facing up.
  const mart = lensInLift("CELADON_MART_ELEVATOR", 3, 1, { choice: 3 });
  pressA(mart);
  check("the Mart's panel offers its floors",
        mart.events.some((e) => e.indexOf("choice:") === 0 && e.indexOf("1F,2F,3F,4F,5F") > 0),
        JSON.stringify(mart.events.filter((e) => e.indexOf("choice:") === 0)));
  // Four in all: two written on boarding, and two more once a floor is
  // picked. The last two are the ones that decide where the doors lead.
  const written = mart.events.filter((e) => e.indexOf("warpOverride:") === 0);
  check("and picking 4F points both of the car's doors at it",
        written.length === 4 &&
        written.slice(-2).every((e) => e.indexOf("CELADON_MART_4F#2") > 0),
        JSON.stringify(written));
  const door = mart.overworld.warpOverrideAt(1, 3);
  check("the world itself now leads there",
        door !== null && door.map === "CELADON_MART_4F" && door.warp === 2, JSON.stringify(door));
  // ShakeElevator: the car never moves, so the jolt is the only thing that
  // says you travelled. Once, after the warps are written.
  const jolts = mart.events.filter((e) => e.indexOf("shake:") === 0);
  check("and the car jolts once, after the warps are written",
        jolts.length === 1 && Number(jolts[0].slice(6)) > 0 &&
        mart.events.indexOf(jolts[0]) > mart.events.lastIndexOf(written[written.length - 1]),
        JSON.stringify(mart.events.filter((e) => e.indexOf("shake:") === 0 || e.indexOf("warpOverride:") === 0)));
  mart.run([{ walk: "down", n: 2 }, { walk: "left", n: 1 }, { walk: "down", n: 1 }]);
  mart.settle();
  check("so stepping out of the car arrives on the fourth floor",
        mart.state().map === "CELADON_MART_4F", JSON.stringify(mart.state()));

  const cancelled = lensInLift("CELADON_MART_ELEVATOR", 3, 1, {});
  pressA(cancelled);
  check("backing out of the list leaves the car pointing where you boarded",
        cancelled.events.filter((e) => e.indexOf("warpOverride:") === 0)
          .every((e) => e.indexOf("CELADON_MART_1F#5") > 0),
        JSON.stringify(cancelled.events.filter((e) => e.indexOf("warpOverride:") === 0)));
  check("and a car that went nowhere does not jolt",
        cancelled.events.every((e) => e.indexOf("shake:") !== 0), JSON.stringify(cancelled.events));

  const locked = lensInLift("ROCKET_HIDEOUT_ELEVATOR", 1, 2, {});
  const said = pressA(locked);
  check("the hideout's panel needs a key", said.indexOf("needs a key") >= 0 ||
        said.indexOf("need a key") >= 0, said);
  check("and offers nothing without one",
        locked.events.every((e) => e.indexOf("choice:") !== 0), JSON.stringify(locked.events));

  const keyed = lensInLift("ROCKET_HIDEOUT_ELEVATOR", 1, 2, { bag: ["LIFT_KEY"], choice: 2 });
  pressA(keyed);
  check("with the LIFT KEY it offers three floors and takes you to B4F",
        keyed.events.some((e) => e.indexOf("choice:") === 0 && e.indexOf("B1F,B2F,B4F") > 0) &&
        keyed.events.some((e) => e.indexOf("ROCKET_HIDEOUT_B4F#2") > 0),
        JSON.stringify(keyed.events));
}

console.log("\n== Boarding one ==");
{
  // RocketHideoutElevator.asm:16-32 and CeladonMartElevator.asm:16-32: on EVERY
  // map load the car rewrites both of its own warps to the floor the player
  // boarded from, so stepping straight back out returns them where they were.
  // The shipped bytes are the hideout's B1F, the Mart's 1F and -- for SILPH
  // CO -- a map that does not exist, so without this a lift is a trapdoor.
  function boardAndLeave(fromMap, doorWarp, backOut) {
    const warp = bundle.maps[fromMap].warps[doorWarp];
    const state = PlayState.newPlayState(bundle.romSha1);
    state.playerName = "RED";
    state.mapId = fromMap;
    state.cellX = warp.x;
    state.cellY = warp.y + 1;
    state.facing = "up";
    state.flags.EVENT_INTRO_DONE = true;
    state.flags.EVENT_GOT_STARTER = true;
    state.bag.push({ id: "LIFT_KEY", count: 1 });
    state.party.push(makeWildMon(bundle, "CHARMANDER", 30, () => 0.5));
    const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
    lens.clearText();
    lens.settle();
    lens.run([{ walk: "up", n: 1 }]);
    lens.settle();
    const rode = lens.state().map;
    lens.run([{ walk: backOut, n: 1 }, { walk: backOut === "up" ? "down" : "up", n: 1 }]);
    lens.settle();
    return { lift: rode, back: lens.state().map };
  }

  const rides = [
    ["ROCKET_HIDEOUT_B2F", 4, "down"], ["ROCKET_HIDEOUT_B4F", 2, "down"],
    ["CELADON_MART_3F", 2, "up"], ["CELADON_MART_5F", 2, "up"],
    ["SILPH_CO_5F", 2, "up"], ["SILPH_CO_11F", 1, "up"],
  ];
  const wrong = [];
  for (const ride of rides) {
    const out = boardAndLeave(ride[0], ride[1], ride[2]);
    if (out.lift.indexOf("ELEVATOR") < 0 || out.back !== ride[0]) {
      wrong.push(ride[0] + " -> " + out.lift + " -> " + out.back);
    }
  }
  check("stepping straight back out of a car returns you where you boarded",
        wrong.length === 0, JSON.stringify(wrong));
}

console.log("\n== The prize counters ==");
{
  const { prizesForCounter } = await import(P + "script/Prizes.ts");
  check("Red's own three counters", prizesForCounter(1)[0].id === "ABRA" &&
        prizesForCounter(1)[0].price === 180 && prizesForCounter(2)[2].id === "PORYGON" &&
        prizesForCounter(2)[2].price === 9999 && prizesForCounter(3)[0].id === "TM_DRAGON_RAGE",
        JSON.stringify(prizesForCounter(1)));
  check("with the prize-mon levels from the dictionary, not the price",
        prizesForCounter(1)[1].level === 8 && prizesForCounter(2)[1].level === 25,
        JSON.stringify(prizesForCounter(2)));

  function atCounter(counter, opts) {
    const o = opts || {};
    const state = PlayState.newPlayState(bundle.romSha1);
    state.playerName = "RED";
    state.mapId = "GAME_CORNER_PRIZE_ROOM";
    state.cellX = 2 * counter;
    state.cellY = 3;
    state.facing = "up";
    state.flags.EVENT_INTRO_DONE = true;
    state.flags.EVENT_GOT_STARTER = true;
    state.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
    state.coins = o.coins === undefined ? 0 : o.coins;
    if (o.coinCase !== false) { state.bag.push({ id: "COIN_CASE", count: 1 }); }
    const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true,
                                            choice: o.choice, answer: o.answer });
    lens.clearText();
    lens.settle();
    return lens;
  }

  const noCase = atCounter(1, { coinCase: false });
  check("no COIN CASE, no exchange", pressA(noCase).indexOf("COIN CASE is") >= 0);

  const poor = atCounter(1, { coins: 10, choice: 0 });
  const said = pressA(poor);
  check("the counter greets you and lists its prizes",
        said.indexOf("exchange your") >= 0 &&
        poor.events.some((e) => e.indexOf("choice:") === 0 && e.indexOf("ABRA") > 0),
        said + " " + JSON.stringify(poor.events.filter((e) => e.indexOf("choice:") === 0)));
  check("and says so when the coins are short",
        said.indexOf("need") >= 0 && said.indexOf("more coins") >= 0 && poor.play.coins === 10, said);

  const rich = atCounter(1, { coins: 600, choice: 1 });
  pressA(rich);
  check("with the coins, CLEFAIRY is yours at 8 and costs 500",
        rich.play.party.some((m) => m.species === "CLEFAIRY" && m.level === 8) &&
        rich.play.coins === 100,
        JSON.stringify({ party: rich.play.party.map((m) => m.species), coins: rich.play.coins }));

  const tm = atCounter(3, { coins: 4000, choice: 0 });
  pressA(tm);
  check("and the third counter sells TMs",
        tm.play.bag.some((b) => b.id === "TM_DRAGON_RAGE") && tm.play.coins === 700,
        JSON.stringify({ bag: tm.play.bag, coins: tm.play.coins }));

  const noThanks = atCounter(1, { coins: 600, choice: 3 });
  pressA(noThanks);
  check("NO THANKS is the fourth row and buys nothing",
        noThanks.play.coins === 600 && noThanks.play.party.length === 1);
}

console.log("\nELEVATOR " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
