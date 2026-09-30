// SILPH CO and the city it stands in.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/silph.test.mjs Assets/Generated/kanto.json
//
// The rival's cutscene is bank $14 at $5C23..$5D24: which cell arms it, how
// far he walks, and which way he leaves. The card-key doors and the eleven
// floors are the extraction's own tables, checked here against the maps.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { elevatorFor } = await import(P + "script/Elevators.ts");
const { stepTriggersFor, talkScript } = await import(P + "script/MapScripts.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: silph.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "SILPH", "Red's Silph Co cast and rival rule");
globalThis.print = () => {};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

function lensAt(map, x, y, facing, mut) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = map;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 40, () => 0.5));
  if (mut) { mut(state); }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

function run(lens, steps) {
  lens.run(steps);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 4000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.join(" ");
}

console.log("== The lift ==");
{
  const lift = elevatorFor("SILPH_CO_ELEVATOR");
  check("eleven floors, lobby to the office",
        lift !== null && lift.floors.length === 11 &&
        lift.floors[0].label === "1F" && lift.floors[10].label === "11F",
        lift ? lift.floors.map((f) => f.label).join(",") : "none");
  check("and it asks for no key", lift.keyItem === "");
  const wrong = [];
  for (const floor of lift.floors) {
    const warp = bundle.maps[floor.map].warps[floor.warp];
    if (!warp || warp.destMap !== "SILPH_CO_ELEVATOR") { wrong.push(floor.label); }
  }
  check("every floor's warp is that floor's own lift door", wrong.length === 0,
        JSON.stringify(wrong));
  // The shipped warps point at a map that does not exist, which is the
  // cartridge saying a car's warps are written at runtime.
  const car = bundle.maps.SILPH_CO_ELEVATOR;
  check("the car ships pointing nowhere",
        car.warps.every((w) => w.destMap === "UNUSED_MAP_ED"),
        JSON.stringify(car.warps.map((w) => w.destMap)));
}

console.log("\n== The card-key doors ==");
{
  const doors = bundle.blockOverrides;
  const floors = Object.keys(doors).filter((k) => k.indexOf("SILPH_CO_") === 0);
  check("ten floors have one", floors.length === 10, floors.join(","));
  check("and every one of them asks for the CARD KEY",
        floors.every((f) => doors[f].every((row) => row.keyItem === "CARD_KEY")),
        JSON.stringify(floors.map((f) => doors[f].map((r) => r.keyItem))));

  const locked = lensAt("SILPH_CO_2F", 4, 5, "up");
  const refused = run(locked, [{ press: "a" }]);
  check("without it the door will not open",
        refused.indexOf("locked") >= 0 || refused.indexOf("CARD KEY") >= 0, refused);
  check("and nothing was unlocked",
        locked.play.flags.EVENT_SILPH_CO_2_UNLOCKED_DOOR1 !== true);

  const keyed = lensAt("SILPH_CO_2F", 4, 5, "up", (s) => {
    s.bag.push({ id: "CARD_KEY", count: 1 });
  });
  run(keyed, [{ press: "a" }]);
  check("with it the door opens and stays open",
        keyed.play.flags.EVENT_SILPH_CO_2_UNLOCKED_DOOR1 === true);
}

console.log("\n== The rival on the seventh floor ==");
{
  const triggers = stepTriggersFor("SILPH_CO_7F");
  check("two cells arm his scene, (3,2) and (3,3)",
        triggers.length === 2 && triggers[0].x === 3 && triggers[0].y === 2 &&
        triggers[1].x === 3 && triggers[1].y === 3,
        JSON.stringify(triggers.map((t) => [t.x, t.y])));

  const met = lensAt("SILPH_CO_7F", 3, 1, "down");
  const said = run(met, [{ walk: "down", n: 1 }]);
  check("walking onto the first cell brings him up the corridor",
        said.indexOf("waited here") >= 0, said.slice(0, 120));
  check("and he fights with the roster his own starter decides",
        met.battles.length === 1 && met.battles[0] === "OPP_RIVAL2#7",
        JSON.stringify(met.battles));
  check("the win is remembered", met.play.flags.EVENT_BEAT_SILPH_CO_RIVAL === true);
  check("and he is gone from the floor",
        met.loop.revealOf("SILPH_CO_7F", "SILPHCO7F_RIVAL") === false,
        "" + met.loop.revealOf("SILPH_CO_7F", "SILPHCO7F_RIVAL"));

  const again = lensAt("SILPH_CO_7F", 3, 1, "down", (s) => {
    s.flags.EVENT_BEAT_SILPH_CO_RIVAL = true;
  });
  run(again, [{ walk: "down", n: 1 }]);
  check("a second visit is quiet", again.battles.length === 0, JSON.stringify(again.pages));

  // Spoken to rather than walked into -- only reachable after a lost battle.
  const spoken = talkScript("SILPH_CO_7F", "TEXT_SILPHCO7F_RIVAL");
  check("he can still be spoken to", spoken !== null &&
        spoken.some((c) => c.op === "call" && c.argument === "OPP_RIVAL2#7"),
        JSON.stringify(spoken ? spoken.map((c) => c.op) : null));
  // The floor's other people still come from the transcription.
  check("and the rest of the floor still speaks",
        talkScript("SILPH_CO_7F", "TEXT_SILPHCO7F_SILPH_WORKER_M1") !== null);
}

console.log("\n== The eleventh floor ==");
{
  const boss = lensAt("SILPH_CO_11F", 6, 13, "up");
  run(boss, [{ press: "a" }]);
  check("Giovanni fights", boss.battles.length === 1 && boss.battles[0].indexOf("GIOVANNI") >= 0,
        JSON.stringify(boss.battles));
  check("and every ROCKET in the building leaves with him",
        boss.loop.revealOf("SILPH_CO_2F", "SILPHCO2F_ROCKET1") === false &&
        boss.loop.revealOf("SILPH_CO_9F", "SILPHCO9F_ROCKET2") === false);

  const pres = lensAt("SILPH_CO_11F", 7, 6, "up", (s) => {
    s.flags.EVENT_BEAT_SILPH_CO_GIOVANNI = true;
  });
  run(pres, [{ press: "a" }]);
  check("and the president hands over the MASTER BALL",
        pres.play.bag.some((b) => b.id === "MASTER_BALL"), JSON.stringify(pres.play.bag));
}

console.log("\n== The city outside ==");
{
  const occupied = lensAt("SAFFRON_CITY", 20, 20, "down");
  for (let i = 0; i < 60; i++) { occupied.frame(); }
  occupied.settle();
  check("while ROCKET holds it nothing is swapped",
        Object.keys(occupied.loop.reveals()).length === 0,
        JSON.stringify(occupied.loop.reveals()));

  const freed = lensAt("SAFFRON_CITY", 20, 20, "down", (s) => {
    s.flags.EVENT_BEAT_SILPH_CO_GIOVANNI = true;
  });
  for (let i = 0; i < 60; i++) { freed.frame(); }
  freed.settle();
  check("afterwards the eight on the street are gone",
        freed.loop.revealOf("SAFFRON_CITY", "SAFFRONCITY_ROCKET1") === false &&
        freed.loop.revealOf("SAFFRON_CITY", "SAFFRONCITY_ROCKET8") === false);
  check("and the people who had stayed in come back",
        freed.loop.revealOf("SAFFRON_CITY", "SAFFRONCITY_SCIENTIST") === true &&
        freed.loop.revealOf("SAFFRON_CITY", "SAFFRONCITY_GENTLEMAN") === true &&
        freed.loop.revealOf("SAFFRON_CITY", "SAFFRONCITY_PIDGEOT") === true);
}

console.log("\n== Sabrina and the DOJO ==");
{
  const sabrina = lensAt("SAFFRON_GYM", 9, 9, "up");
  run(sabrina, [{ press: "a" }]);
  check("Sabrina fights", sabrina.battles.length === 1 &&
        sabrina.battles[0].indexOf("SABRINA") >= 0, JSON.stringify(sabrina.battles));

  const master = lensAt("FIGHTING_DOJO", 5, 4, "up");
  run(master, [{ press: "a" }]);
  check("and so does the KARATE MASTER", master.battles.length === 1,
        JSON.stringify(master.battles));
}

console.log("\nSILPH " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
