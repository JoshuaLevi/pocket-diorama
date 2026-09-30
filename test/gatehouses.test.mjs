// The gate houses that are supposed to stop you, and did not.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/gatehouses.test.mjs Assets/Generated/kanto.json
//
// Four kinds of guard, all of them coordinate scripts rather than bodies in
// the way, and every one of them was walked straight past before this suite:
//
//   ROUTE_5/6/7/8_GATE   a drink for the thirsty guard (Route5Gate.asm:19-52)
//   ROUTE_16/18_GATE_1F  no pedestrians on CYCLING ROAD (Route16Gate1F.asm:16-52)
//   ROUTE_22_GATE        the BOULDERBADGE (Route22Gate.asm:21-34, 61-77)
//   ROUTE_23             seven rows, seven badges (Route23.asm:28-72)
//
// What is checked is the whole shape: the line, the walk the cartridge
// simulates with joypad states, the sound, and the flag that retires it.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { badgeIndexOf } = await import(P + "FieldMoves.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: gatehouses.test.mjs <bundle.json>");
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

function lensAt(mapId, x, y, facing, opts) {
  const o = opts || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 30, () => 0.5));
  for (const id of o.bag || []) { state.bag.push({ id: id, count: 1 }); }
  for (const f of o.flags || []) { state.flags[f] = true; }
  for (const b of o.badges || []) { state.badges[badgeIndexOf(b)] = true; }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

/** Walk, then run whatever it started to its end. Returns what was said. */
function walk(lens, direction, steps) {
  const mark = lens.pages.length;
  lens.run([{ walk: direction, n: steps === undefined ? 1 : steps }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 8000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.slice(mark).join(" ");
}

function pressA(lens) {
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 8000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.slice(mark).join(" ");
}

function has(lens, id) {
  return lens.play.bag.some((s) => s.id === id);
}

const DRINK_FLAG = "EVENT_GAVE_SAFFRON_GUARDS_DRINK";

console.log("== The thirsty guard on the road to SAFFRON ==");
{
  const dry = lensAt("ROUTE_5_GATE", 3, 4, "up");
  const said = walk(dry, "up");
  const at = dry.state();
  check("with nothing to drink he says so", said.indexOf("thirsty") >= 0, said);
  check("and the road is closed: one step back north", at.x === 3 && at.y === 2,
        at.x + "," + at.y);
  check("the flag stays clear, so he asks again", dry.play.flags[DRINK_FLAG] !== true);

  const wet = lensAt("ROUTE_5_GATE", 3, 4, "up", { bag: ["FRESH_WATER"] });
  const said2 = walk(wet, "up");
  const at2 = wet.state();
  check("with a FRESH WATER he is parched, and grateful",
        said2.indexOf("parched") >= 0 && said2.indexOf("You can go on") >= 0 &&
        said2.indexOf("share this with") >= 0, said2);
  check("the drink is gone from the bag", !has(wet, "FRESH_WATER"), JSON.stringify(wet.play.bag));
  check("the fanfare rings", wet.sounds.indexOf("Get_Key_Item") >= 0, JSON.stringify(wet.sounds));
  check("nobody is pushed back", at2.x === 3 && at2.y === 3, at2.x + "," + at2.y);
  check("and all four guards are satisfied at once", wet.play.flags[DRINK_FLAG] === true);
}
{
  // RemoveGuardDrink walks FRESH_WATER, SODA_POP, LEMONADE in that order and
  // takes the first it finds (engine/events/saffron_guards.asm:1-13).
  const both = lensAt("ROUTE_6_GATE", 3, 3, "up", { bag: ["LEMONADE", "SODA_POP"] });
  walk(both, "up");
  check("he takes the SODA POP before the LEMONADE",
        !has(both, "SODA_POP") && has(both, "LEMONADE"), JSON.stringify(both.play.bag));
  const at = both.state();
  check("Route 6's gate pushes the other way", at.y === 2, at.x + "," + at.y);
}
{
  const done = lensAt("ROUTE_7_GATE", 3, 5, "up", { flags: [DRINK_FLAG] });
  const said = walk(done, "up");
  check("once they have had their drink the cell is quiet", said.length === 0, said);
  const guard = lensAt("ROUTE_7_GATE", 3, 3, "up", { flags: [DRINK_FLAG] });
  check("and the guard thanks you for it", pressA(guard).indexOf("thanks") >= 0);
  const eight = lensAt("ROUTE_8_GATE", 3, 3, "left");
  const said8 = walk(eight, "left");
  check("Route 8's gate shoves you back east",
        said8.indexOf("thirsty") >= 0 && eight.state().x === 3, JSON.stringify(eight.state()));
}

console.log("\n== No pedestrians on CYCLING ROAD ==");
{
  const afoot = lensAt("ROUTE_16_GATE_1F", 4, 11, "up");
  const said = walk(afoot, "up");
  const at = afoot.state();
  check("the guard calls you back", said.indexOf("Wait\nup") >= 0 || said.indexOf("Wait up") >= 0, said);
  check("and says why", said.indexOf("No pedestrians") >= 0, said);
  check("you are walked to his counter and shoved aside", at.x === 5 && at.y === 7,
        at.x + "," + at.y);

  const fromTheTop = lensAt("ROUTE_16_GATE_1F", 4, 6, "down");
  walk(fromTheTop, "down");
  const at2 = fromTheTop.state();
  check("from the cell beside him there is no walk, only the shove",
        at2.x === 5 && at2.y === 7, at2.x + "," + at2.y);

  const riding = lensAt("ROUTE_16_GATE_1F", 4, 11, "up", { bag: ["BICYCLE"] });
  const said3 = walk(riding, "up");
  check("with a BICYCLE nothing is said at all", said3.length === 0 && riding.state().y === 10,
        said3 + " " + JSON.stringify(riding.state()));

  const eighteen = lensAt("ROUTE_18_GATE_1F", 4, 7, "up");
  const said4 = walk(eighteen, "up");
  check("Route 18's guard wants to see a BICYCLE too",
        said4.indexOf("Excuse me") >= 0 && said4.indexOf("BICYCLE") >= 0, said4);
  check("with the same walk and shove", eighteen.state().x === 5 && eighteen.state().y === 3,
        JSON.stringify(eighteen.state()));
}

console.log("\n== The BOULDERBADGE gate onto Route 22 ==");
{
  const none = lensAt("ROUTE_22_GATE", 4, 3, "up");
  const said = walk(none, "up");
  const at = none.state();
  check("only truly skilled trainers", said.indexOf("truly skilled") >= 0, said);
  check("and he cannot let you pass", said.indexOf("can't let you") >= 0 || said.indexOf("let you pass") >= 0, said);
  check("the denial sounds", none.sounds.indexOf("Denied") >= 0, JSON.stringify(none.sounds));
  check("and you are put back where you came from", at.x === 4 && at.y === 3, at.x + "," + at.y);

  const badge = lensAt("ROUTE_22_GATE", 4, 3, "up", { badges: ["BOULDERBADGE"] });
  const said2 = walk(badge, "up");
  check("with the badge, go right ahead", said2.indexOf("Go right ahead") >= 0, said2);
  check("with the item jingle", badge.sounds.indexOf("Get_Item1") >= 0, JSON.stringify(badge.sounds));
  check("and the road is open", badge.state().y === 2, JSON.stringify(badge.state()));
}

console.log("\n== Route 23's seven rows ==");
{
  const none = lensAt("ROUTE_23", 9, 120, "up");
  const said = walk(none, "up");
  const at = none.state();
  check("the THUNDERBADGE row names the badge it wants",
        said.indexOf("THUNDERBADGE") >= 0 && said.indexOf("don't have") >= 0, said);
  check("SFX_DENIED, and one step back down", none.sounds.indexOf("Denied") >= 0 && at.y === 120,
        JSON.stringify(none.sounds) + " " + at.y);
  check("and nothing is remembered, so he asks again",
        none.play.flags.EVENT_PASSED_THUNDERBADGE_CHECK !== true);

  const badge = lensAt("ROUTE_23", 9, 120, "up", { badges: ["THUNDERBADGE"] });
  const said2 = walk(badge, "up");
  check("with the badge he waves you through", said2.indexOf("That is the") >= 0 &&
        said2.indexOf("go right ahead") >= 0, said2);
  check("and remembers it", badge.play.flags.EVENT_PASSED_THUNDERBADGE_CHECK === true &&
        badge.state().y === 119, JSON.stringify(badge.state()));
  const again = walk(badge, "up");
  check("so the row is quiet on the way back", again.length === 0, again);

  // Route23.asm:42-47: his row is also the road OUT of Victory Road, and east
  // of x 14 the player has already come through it.
  const west = lensAt("ROUTE_23", 2, 36, "up");
  check("the top guard's row stops you on his side", walk(west, "up").indexOf("EARTHBADGE") >= 0);
  const east = lensAt("ROUTE_23", 16, 36, "up");
  check("and says nothing east of Victory Road's door", walk(east, "up").length === 0,
        JSON.stringify(east.state()));
}

console.log("\nGATEHOUSES " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
