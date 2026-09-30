// Oak's desk once the parcel is in the bag: the request scene, the five Poke
// Balls after it, and the Pokedex rating after that.
//
// Read from pokered's scripts/OaksLab.asm on 11 September: talking to Oak
// with OAK'S PARCEL runs OaksLabRivalArrivesAtOaksRequestScript through
// OaksLabRivalLeavesWithPokedexScript -- Oak's thanks, the rival placed at the
// door and walked in, the request, both Pokedexes off the desk, the rival out
// again -- and sets the events Route 22 and Viridian City read. The first port
// took the parcel in a silent host routine and said nothing, which is what the
// 11 September playtest reported: "hij begon alleen over de pokedex en niet
// over de parcel".
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/oakslab-parcel.test.mjs Assets/Generated/kanto.json

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const bundlePath = process.argv[2];
if (!bundlePath) { console.error("usage: oakslab-parcel.test.mjs <bundle.json>"); process.exit(2); }
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "OAKSLAB-PARCEL", "Red's lab and parcel scene");
globalThis.print = () => {};
globalThis.getTime = () => 0;

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

/**
 * In front of Oak's desk, OAKS_LAB (5,3) facing up at him, with a starter and
 * the lab battle behind us: the state a player has when they walk back in from
 * Viridian with the parcel. Oak is revealed (the escort did that), the rival
 * and the two taken balls are hidden (the starter scene did that).
 */
function atOaksDesk(options) {
  const o = options || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = "OAKS_LAB";
  state.cellX = o.cellX === undefined ? 5 : o.cellX;
  state.cellY = o.cellY === undefined ? 3 : o.cellY;
  state.facing = o.facing ? o.facing : "up";
  for (const f of ["EVENT_INTRO_DONE", "EVENT_GOT_STARTER", "EVENT_CHOSE_SQUIRTLE",
                   "EVENT_FOLLOWED_OAK_INTO_LAB", "EVENT_BATTLED_RIVAL_IN_OAKS_LAB",
                   "EVENT_GOT_OAKS_PARCEL"].concat(o.flags || [])) {
    state.flags[f] = true;
  }
  state.party.push(makeWildMon(bundle, "SQUIRTLE", 6, () => 0.5));
  state.dexOwned[bundle.species.SQUIRTLE.dex - 1] = true;
  state.dexSeen[bundle.species.SQUIRTLE.dex - 1] = true;
  for (let i = 0; i < (o.owned || 0); i++) { state.dexOwned[i] = true; }
  state.objectToggles = {
    "OAKS_LAB:OAKSLAB_OAK1": true,
    "OAKS_LAB:OAKSLAB_RIVAL": false,
    "OAKS_LAB:OAKSLAB_SQUIRTLE_POKE_BALL": false,
    "OAKS_LAB:OAKSLAB_BULBASAUR_POKE_BALL": false,
  };
  for (const item of (o.bag || [])) { state.bag.push(item); }
  return new HeadlessLens(bundle, { state, wanderers: false });
}

// Lines joined by a space, so a phrase the cartridge breaks across two lines
// ("RED got / POKéDEX from OAK!") can still be asked for whole.
const said = (lens) => lens.lines.join(" ").replace(/\s+/g, " ");
const toggles = (lens) => lens.play.objectToggles;
const bagOf = (lens) => lens.play.bag.map((s) => s.id + "x" + s.count).join(",");

console.log("\n== Handing Oak the parcel runs his request scene ==");
{
  const lens = atOaksDesk({ bag: [{ id: "OAKS_PARCEL", count: 1 }] });
  // Up to the rival's line at the door, before anything has walked.
  lens.run([{ text: "custom POKé BALL", max: 40 }, { text: "Gramps!", max: 40 }]);
  const atDoor = lens.npcMotion.pose("OAKSLAB_RIVAL");
  check("Oak thanks you for the custom Poke Ball first",
        said(lens).indexOf("custom POKé BALL") >= 0, said(lens).slice(0, 200));
  check("the parcel leaves the bag as he says so",
        lens.play.bag.every((s) => s.id !== "OAKS_PARCEL"), bagOf(lens));
  check("the rival is revealed at the lab DOOR (4,11), not on the cell he ships at",
        toggles(lens)["OAKS_LAB:OAKSLAB_RIVAL"] === true && atDoor !== null &&
        atDoor.x === 4 && atDoor.y === 11,
        JSON.stringify(atDoor));
  // The walk in, the request, the Pokedex, the walk out.
  lens.run([{ text: "call me for", max: 400 }, { text: "POKéDEX from OAK", max: 60 },
            { text: "Leave it", max: 60 }, { text: "Hahaha", max: 60 }, { press: "a" }, { wait: 900 }]);
  lens.settle();
  const s = said(lens);
  for (const line of ["What did you call me for", "I have a request", "my invention", "got POKéDEX from OAK",
                      "That was my dream", "Leave it all to me"]) {
    check("Oak's scene says: " + line, s.indexOf(line) >= 0);
  }
  check("the POKeDEX is the flag and never a bag item, and the parcel is gone",
        lens.play.flags.EVENT_GOT_POKEDEX === true &&
        !lens.play.bag.some((b) => b.id === "POKEDEX") &&
        !lens.play.bag.some((b) => b.id === "OAKS_PARCEL"), bagOf(lens));
  check("both Pokedexes have left the desk",
        toggles(lens)["OAKS_LAB:OAKSLAB_POKEDEX1"] === false && toggles(lens)["OAKS_LAB:OAKSLAB_POKEDEX2"] === false);
  const beside = lens.npcMotion.pose("OAKSLAB_RIVAL");
  check("the rival walked back out to the door and is hidden again",
        toggles(lens)["OAKS_LAB:OAKSLAB_RIVAL"] === false && beside !== null && beside.x === 4 && beside.y === 11,
        JSON.stringify(beside));
  for (const f of ["EVENT_GOT_POKEDEX", "EVENT_OAK_GOT_PARCEL", "EVENT_1ST_ROUTE22_RIVAL_BATTLE",
                   "EVENT_ROUTE22_RIVAL_WANTS_BATTLE"]) {
    check("the scene sets " + f, lens.play.flags[f] === true);
  }
  check("the scene has let go of the frame", !lens.loop.isBusy());

  console.log("\n== The next visit hands over five Poke Balls, once ==");
  lens.run([{ text: "5 POKé BALLs", max: 40 }, { press: "a" }, { wait: 60 }]);
  lens.clearText();
  check("Oak says so", said(lens).indexOf("got 5 POKé BALLs") >= 0);
  check("five POKE_BALL in the bag",
        lens.play.bag.some((b) => b.id === "POKE_BALL" && b.count === 5), bagOf(lens));
  check("EVENT_GOT_POKEBALLS_FROM_OAK is set", lens.play.flags.EVENT_GOT_POKEBALLS_FROM_OAK === true);
  check("and the explanation follows", said(lens).indexOf("fair game") >= 0);

  console.log("\n== Every visit after that reads the rating ==");
  const before = lens.lines.length;
  lens.run([{ text: "POKéDEX coming", max: 40 }]);
  lens.clearText();
  const after = lens.lines.slice(before).join(" | ");
  check("Oak asks how the Pokedex is coming", after.indexOf("POKéDEX coming") >= 0, after);
  check("one species owned reads the 0-9 rating", after.indexOf("lots to do") >= 0, after);
  check("no second set of Poke Balls",
        lens.play.bag.filter((b) => b.id === "POKE_BALL").length === 1 &&
        lens.play.bag.find((b) => b.id === "POKE_BALL").count === 5, bagOf(lens));
}

console.log("\n== The rating ladder picks the cartridge's line for the count ==");
{
  const lens = atOaksDesk({ flags: ["EVENT_GOT_POKEDEX", "EVENT_GOT_POKEBALLS_FROM_OAK"], owned: 25 });
  lens.run([{ text: "POKéDEX coming", max: 40 }]);
  lens.clearText();
  check("twenty-five owned reads the 20-29 line", said(lens).indexOf("other species") >= 0, said(lens));
}

console.log("\n== Talking to Oak from beside the desk seats the rival below-left ==");
{
  // From (4,2), facing right at Oak on (5,2): the cell to the left of the
  // player is (3,2), and the rule sends him to (3,3) instead -- open floor.
  const lens = atOaksDesk({ cellX: 4, cellY: 2, facing: "right", bag: [{ id: "OAKS_PARCEL", count: 1 }] });
  lens.run([{ text: "Gramps!", max: 40 }, { text: "call me for", max: 400 }]);
  const pose = lens.npcMotion.pose("OAKSLAB_RIVAL");
  check("the rival stands on (3,3)", pose !== null && pose.x === 3 && pose.y === 3, JSON.stringify(pose));
  lens.run([{ text: "Leave it", max: 200 }, { text: "Hahaha", max: 60 }, { press: "a" }, { wait: 900 }]);
  lens.settle();
  check("and the scene still completes", lens.play.flags.EVENT_GOT_POKEDEX === true && !lens.loop.isBusy(),
        "busy=" + lens.loop.isBusy() + " dex=" + lens.play.flags.EVENT_GOT_POKEDEX);
}

console.log("\n== Without the parcel and without the Pokedex, Oak only encourages ==");
{
  const lens = atOaksDesk({});
  const pages = lens.talk(10);
  check("raise your young Pokemon", pages.join(" ").indexOf("raise your young") >= 0, pages.join(" | "));
  check("nothing was taken or given", lens.play.bag.length === 0 && lens.play.flags.EVENT_GOT_POKEDEX !== true);
}

console.log("\nOAKSLAB-PARCEL  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "FAILED"));
process.exit(fail === 0 ? 0 : 1);
