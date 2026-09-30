// Coordinate triggers: scripts that run when the player lands on a cell.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/steptrigger.test.mjs Assets/Generated/kanto.json [--selftest]
//
// MapScriptSet.onStep was declared and read by nothing. PlayLoop.afterStep now
// reads it on every landing, before the warp and the encounter: the Route 22
// rival, the Pokemon Tower rival, the Karate Master's gate, Silph's Giovanni
// beside his desk and Mt Moon's Super Nerd all fire from a cell.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { makeServices } from "./fakeservices.mjs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: steptrigger.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const { Overworld } = await import(P + "Overworld.ts");
const { PlayLoop } = await import(P + "PlayLoop.ts");
const PlayState = await import(P + "PlayState.ts");
const { scriptsFor } = await import(P + "script/MapScripts.ts");
const { rivalRosterFor } = await import(P + "script/Host.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "STEPTRIGGER", "Red's step triggers");

let pass = 0;
let fail = 0;
let quiet = false;
let quietFails = 0;
function check(name, ok, detail) {
  if (quiet) { if (!ok) { quietFails++; } return; }
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

function held(direction) {
  const pad = { up: false, down: false, left: false, right: false };
  if (direction) { pad[direction] = true; }
  return { dpad: () => pad, pressedA: () => false, pressedB: () => false, pressedStart: () => false, activeName: () => "test" };
}

function game(mapId, x, y, opts) {
  const state = PlayState.newPlayState("t");
  state.flags.EVENT_INTRO_DONE = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 30, () => 0.5));
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  const services = makeServices(bundle, mapId, opts);
  const loop = new PlayLoop(bundle, state, services);
  const world = new Overworld(bundle, mapId, x, y, () => 0.99);
  world.setReveals(loop.reveals());
  return { state, services, loop, world };
}

/** Hold a direction until a trigger starts a script, then run it out. */
function walkInto(g, direction, frames) {
  let fired = false;
  let cell = null;
  for (let i = 0; i < frames && !fired; i++) {
    const r = g.world.update(0.05, held(direction));
    const o = g.loop.afterStep(g.world, r, false);
    if (g.loop.isBusy()) { fired = true; cell = [g.world.cellX, g.world.cellY]; }
    if (o.warped) { break; }
  }
  for (let i = 0; i < 200 && g.loop.isBusy(); i++) { g.loop.update(); }
  return { fired, cell };
}

console.log("\n== The Route 22 rival ==");
function testRoute22(make) {
  const g = make();
  check("the approach is from the east, over walkable cells", g.world.map.canEnter(30, 4) && g.world.map.canEnter(29, 4));
  const r = walkInto(g, "left", 40);
  check("landing on (29,4) starts the ambush", r.fired && r.cell && r.cell[0] === 29 && r.cell[1] === 4, JSON.stringify(r));
  check("the player is turned to face down at him", g.services.log.indexOf("facePlayerDir:down") >= 0, JSON.stringify(g.services.log.slice(0, 6)));
  const roster = 3 + rivalRosterFor(g.state);
  check("he fights the roster the starter decides", g.services.battlesFought[0] === "OPP_RIVAL1#" + roster, JSON.stringify(g.services.battlesFought));
  check("the win sets the flag, and he appeared and left", g.state.flags.EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE === true &&
        g.services.log.indexOf("reveal:ROUTE22_RIVAL1:true") >= 0 && g.services.log.lastIndexOf("reveal:ROUTE22_RIVAL1:false") > g.services.log.indexOf("battle:"),
        JSON.stringify(g.services.log));
  check("saving is allowed again once he is gone", g.loop.canSave());
  // Walk off and back on: disarmed.
  for (let i = 0; i < 30; i++) { g.loop.afterStep(g.world, g.world.update(0.05, held("right")), false); }
  const again = walkInto(g, "left", 40);
  check("the cell is disarmed by the flag", !again.fired && g.services.battlesFought.length === 1);
}
testRoute22(() => { const g = game("ROUTE_22", 30, 4); g.state.flags.EVENT_GOT_POKEDEX = true; return g; });

{
  const lost = game("ROUTE_22", 30, 4, { won: false });
  lost.state.flags.EVENT_GOT_POKEDEX = true;
  walkInto(lost, "left", 40);
  check("a loss leaves the ambush armed", lost.state.flags.EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE !== true && lost.services.battlesFought.length === 1);
  for (let i = 0; i < 30; i++) { lost.loop.afterStep(lost.world, lost.world.update(0.05, held("right")), false); }
  walkInto(lost, "left", 40);
  check("and it fires again", lost.services.battlesFought.length === 2);

  const early = game("ROUTE_22", 30, 4);
  walkInto(early, "left", 40);
  check("without the Pokedex nothing happens", early.services.battlesFought.length === 0 && !early.loop.isBusy());

  const late = game("ROUTE_22", 30, 4);
  late.state.flags.EVENT_GOT_POKEDEX = true;
  late.state.flags.EVENT_BEAT_BROCK = true;
  walkInto(late, "left", 40);
  check("after Brock the first visit is over", late.services.battlesFought.length === 0);

  const second = game("ROUTE_22", 30, 5);
  second.state.flags.EVENT_BEAT_GIOVANNI = true;
  const r2 = walkInto(second, "left", 40);
  check("after Giovanni the second visit fires on (29,5), facing left, roster 10 and up",
        r2.fired && second.services.log.indexOf("facePlayerDir:left") >= 0 &&
        second.services.battlesFought[0] === "OPP_RIVAL2#" + (9 + rivalRosterFor(second.state)) &&
        second.state.flags.EVENT_BEAT_ROUTE22_RIVAL_2ND_BATTLE === true, JSON.stringify(second.services.battlesFought));
}

console.log("\n== Pokemon Tower 2F ==");
{
  const g = game("POKEMON_TOWER_2F", 16, 5);
  check("the rival stands at (14,5) and (16,5) is walkable", bundle.maps.POKEMON_TOWER_2F.objects[0].x === 14 && g.world.map.canEnter(16, 5) && g.world.map.canEnter(15, 5));
  const r = walkInto(g, "left", 30);
  check("landing on (15,5) turns the player left and fights", r.fired && g.services.log.indexOf("facePlayerDir:left") >= 0 &&
        g.services.battlesFought[0] === "OPP_RIVAL2#" + (3 + rivalRosterFor(g.state)), JSON.stringify(g.services.log.slice(0, 8)));
  check("the win sets the flag and he leaves", g.state.flags.EVENT_BEAT_POKEMON_TOWER_RIVAL === true &&
        g.loop.revealOf("POKEMON_TOWER_2F", "POKEMONTOWER2F_RIVAL") === false);
  const below = game("POKEMON_TOWER_2F", 14, 7);
  const r2 = walkInto(below, "up", 30);
  check("landing on (14,6) turns the player up and fights too", r2.fired && below.services.log.indexOf("facePlayerDir:up") >= 0 &&
        below.services.battlesFought.length === 1);
  const talk = game("POKEMON_TOWER_2F", 13, 5);
  talk.loop.interact(bundle.maps.POKEMON_TOWER_2F, 13, 5, "right");
  for (let i = 0; i < 200 && talk.loop.isBusy(); i++) { talk.loop.update(); }
  check("and talking to him from the other side is the same fight", talk.services.battlesFought.length === 1 &&
        talk.state.flags.EVENT_BEAT_POKEMON_TOWER_RIVAL === true);
}

console.log("\n== Gates that start a boss ==");
{
  const dojo = game("FIGHTING_DOJO", 4, 4);
  const r = walkInto(dojo, "up", 30);
  check("the cell left of the Karate Master starts his battle", r.fired && dojo.services.battlesFought[0] === "OPP_BLACKBELT#1" &&
        dojo.services.log.indexOf("facePlayerDir:right") >= 0 && dojo.state.flags.EVENT_BEAT_KARATE_MASTER === true,
        JSON.stringify({ cell: r.cell, log: dojo.services.log.slice(0, 6) }));
  const silph = game("SILPH_CO_11F", 6, 14);
  const r2 = walkInto(silph, "up", 30);
  check("the cell beside Giovanni's desk starts his battle", r2.fired && silph.services.battlesFought[0] === "OPP_GIOVANNI#2",
        JSON.stringify({ cell: r2.cell, fought: silph.services.battlesFought }));
  const moon = game("MT_MOON_B2F", 13, 9);
  const r3 = walkInto(moon, "up", 30);
  check("the cell beside Mt Moon's Super Nerd starts his battle, by his header",
        r3.fired && moon.services.battlesFought[0] === "OPP_SUPER_NERD#2" && moon.state.flags.EVENT_BEAT_MT_MOON_3_SUPER_NERD === true,
        JSON.stringify({ cell: r3.cell, fought: moon.services.battlesFought }));
}

console.log("\n== Order: trigger, then warp, then encounter ==");
{
  const g = game("ROUTE_1", 13, 7);
  g.world.encountersEnabled = true;
  const rolls = new Overworld(bundle, "ROUTE_1", 13, 7, () => 0);
  rolls.setReveals(g.loop.reveals());
  rolls.encountersEnabled = true;
  g.loop.stepped = () => true;
  let seenEncounter = false;
  let landed = 0;
  for (let i = 0; i < 40 && landed < 2; i++) {
    const r = rolls.update(0.05, held("down"));
    if (r.landed) { landed++; }
    const o = g.loop.afterStep(rolls, r, false);
    if (o.encounter) { seenEncounter = true; }
  }
  check("a trigger drops the encounter the step rolled", landed >= 1 && !seenEncounter);
  // On the landing frame the trigger wins. A bump into the wall a frame
  // later is the cartridge's collision warp and rightly takes you in, so
  // only the landing is asserted.
  const t = game("PALLET_TOWN", 5, 6);
  let fired = 0;
  t.loop.stepped = () => { fired++; return true; };
  let onLanding = null;
  for (let i = 0; i < 30 && onLanding === null; i++) {
    const r = t.world.update(0.05, held("up"));
    const o = t.loop.afterStep(t.world, r, false);
    if (r.landed) { onLanding = o; }
  }
  check("a trigger on a door cell wins over the door", onLanding !== null && !onLanding.warped && fired >= 1 && t.world.mapId === "PALLET_TOWN",
        JSON.stringify(onLanding) + " fired=" + fired + " " + t.world.mapId);
  const s = game("PALLET_TOWN", 5, 7);
  let triggered = 0;
  s.loop.stepped = () => { triggered++; return true; };
  s.world.walkScripted("up", 3);
  for (let i = 0; i < 60; i++) { s.loop.afterStep(s.world, s.world.update(0.05, held("")), true); }
  check("a scripted walk never fires a trigger", triggered === 0);
}

console.log("\n== A trigger on the far side of a door fires on arrival ==");
{
  // A wildcard trigger (any cell) on Red's house: the shape an on-enter
  // script takes. It fires the moment the door delivers the player.
  const set = scriptsFor("REDS_HOUSE_1F");
  const saved = set.onStep.splice(0, set.onStep.length);
  set.onStep.push({ x: -1, y: -1, ifAll: [], unless: ["EVENT_ARRIVED_HOME"], turnPlayer: "", talk: "",
                    script: [{ op: "set_flag", flag: "EVENT_ARRIVED_HOME" }, { op: "show_text", textId: "HOME" }] });
  const g = game("PALLET_TOWN", 5, 6);
  let warped = false;
  for (let i = 0; i < 40 && !warped; i++) {
    const r = g.world.update(0.05, held("up"));
    warped = g.loop.afterStep(g.world, r, false).warped;
  }
  for (let i = 0; i < 20 && g.loop.isBusy(); i++) { g.loop.update(); }
  check("stepping through the door runs the arrival trigger", warped && g.world.mapId === "REDS_HOUSE_1F" &&
        g.state.flags.EVENT_ARRIVED_HOME === true && g.services.log.indexOf("text:HOME") >= 0, JSON.stringify(g.services.log));
  set.onStep.splice(0, set.onStep.length);
  set.onStep.push(...saved);
}

console.log("\n== The sailor wants to see a ticket ==");
{
  // movePlayer in the shared fake is DONE at once, so the shove is proven
  // through the host's request rather than the cell.
  const without = game("VERMILION_CITY", 18, 29);
  let stepsBack = 0;
  without.services.movePlayer = (d, n) => { stepsBack += (d === "up" ? n : 0); return 0; };
  const r = walkInto(without, "down", 30);
  check("passing the sailor without a ticket asks, refuses and walks you back",
        r.fired && stepsBack === 1 && without.services.log.some((l) => l.indexOf("text:") === 0) && !without.loop.isBusy(),
        JSON.stringify({ cell: r.cell, log: without.services.log.slice(0, 6) }));
  const withTicket = game("VERMILION_CITY", 18, 29);
  PlayState.giveItem(withTicket.state, "S_S_TICKET", 1);
  let shoved = 0;
  withTicket.services.movePlayer = () => { shoved++; return 0; };
  const r2 = walkInto(withTicket, "down", 30);
  check("with the ticket he lets you through", r2.fired && shoved === 0 &&
        withTicket.services.log.some((l) => l.indexOf("text:") === 0 && l.indexOf("S.S.TICKET") >= 0),
        JSON.stringify(withTicket.services.log.slice(0, 6)));
  let warped = false;
  for (let i = 0; i < 30 && !warped; i++) {
    const res = withTicket.world.update(0.05, held("down"));
    warped = withTicket.loop.afterStep(withTicket.world, res, false).warped;
  }
  check("and the next step is the dock", warped && withTicket.world.mapId === "VERMILION_DOCK", withTicket.world.mapId);
}

console.log("\n== Cerulean City and Nugget Bridge ==");
{
  const rival = game("CERULEAN_CITY", 20, 7);
  const r = walkInto(rival, "up", 30);
  check("the rival ambushes on (20,6), from above", r.fired && rival.services.log.indexOf("facePlayerDir:up") >= 0 &&
        rival.services.battlesFought[0] === "OPP_RIVAL1#" + (6 + rivalRosterFor(rival.state)) &&
        rival.state.flags.EVENT_BEAT_CERULEAN_RIVAL === true && rival.loop.revealOf("CERULEAN_CITY", "CERULEANCITY_RIVAL") === false,
        JSON.stringify({ cell: r.cell, fought: rival.services.battlesFought }));
  const thief = game("CERULEAN_CITY", 30, 6);
  const r2 = walkInto(thief, "down", 30);
  check("the Rocket thief fights from (30,7), gives TM28 back and leaves behind a fade",
        r2.fired && thief.services.battlesFought[0] === "OPP_ROCKET#5" && thief.state.flags.EVENT_BEAT_CERULEAN_ROCKET_THIEF === true &&
        thief.state.flags.EVENT_GOT_TM28 === true && thief.state.bag.some((b) => b.id === "TM_DIG") &&
        thief.loop.revealOf("CERULEAN_CITY", "CERULEANCITY_ROCKET") === false && thief.loop.revealOf("CERULEAN_CITY", "CERULEANCITY_GUARD1") === true,
        JSON.stringify({ cell: r2.cell, bag: thief.state.bag, toggles: thief.state.objectToggles }));
  const bridge = game("ROUTE_24", 10, 16);
  const r3 = walkInto(bridge, "up", 30);
  check("the recruiter's cell hands over the NUGGET, makes the pitch and fights",
        r3.fired && bridge.state.bag.some((b) => b.id === "NUGGET") && bridge.state.flags.EVENT_GOT_NUGGET === true &&
        bridge.services.battlesFought[0] === "OPP_ROCKET#6" && bridge.state.flags.EVENT_BEAT_ROUTE_24_ROCKET === true,
        JSON.stringify({ cell: r3.cell, fought: bridge.services.battlesFought, bag: bridge.state.bag }));
  const m = bridge.services.log.length;
  const o = bundle.maps.ROUTE_24.objects.find((x) => x.name === "ROUTE24_COOLTRAINER_M1");
  bridge.loop.interact(bundle.maps.ROUTE_24, o.x - 1, o.y, "right");
  for (let i = 0; i < 60 && bridge.loop.isBusy(); i++) { bridge.loop.update(); }
  check("beaten, he only talks of leadership", bridge.services.battlesFought.length === 1 &&
        bridge.services.log.slice(m).some((l) => l.indexOf("text:") === 0), JSON.stringify(bridge.services.log.slice(m)));
}

console.log("\n== The lens is wired to it ==");
{
  const src = readFileSync(new URL("../Assets/Scripts/PokemonAR.ts", import.meta.url), "utf8");
  check("the idle branch asks the loop what the landing amounted to", /afterStep\(this\.overworld,\s*result,\s*false\)/.test(src));
  check("and so does the scripted-walk branch", /afterStep\(this\.overworld,\s*walked,\s*true\)/.test(src));
  check("the encounter the lens starts is the loop's, not the step's", !/startWild\(result\.encounter/.test(src) && /startWild\(outcome\.encounter/.test(src));
  check("the standing cell is read once at boot", /this\.loop\.stepped\(this\.overworld\.map\.def/.test(src));
}

if (selftest) {
  console.log("\n-- selftest --");
  const failsWith = (fn) => { quiet = true; quietFails = 0; fn(); quiet = false; return quietFails; };
  const set = scriptsFor("ROUTE_22");
  const saved = set.onStep.splice(0, set.onStep.length);
  const n = failsWith(() => testRoute22(() => { const g = game("ROUTE_22", 30, 4); g.state.flags.EVENT_GOT_POKEDEX = true; return g; }));
  set.onStep.push(...saved);
  check("[selftest] a Route 22 with its triggers removed is caught", n > 0);
  check("[selftest] the real Route 22 passes the quiet run",
        failsWith(() => testRoute22(() => { const g = game("ROUTE_22", 30, 4); g.state.flags.EVENT_GOT_POKEDEX = true; return g; })) === 0);
}

console.log("\n== The Cerulean rival, on the bridge ==");
function testCerulean(make, column) {
  const g = make();
  const r = walkInto(g, "up", 40);
  check("landing on (" + column + ",6) starts it", r.fired && r.cell && r.cell[0] === column && r.cell[1] === 6,
        JSON.stringify(r));
  // CeruleanCity.asm:76-78 -- MUSIC_MEET_RIVAL before anything is drawn.
  const music = g.services.log.indexOf("music:Music_MeetRival");
  const reveal = g.services.log.indexOf("reveal:CERULEANCITY_RIVAL:true");
  check("the meeting music starts before he is drawn", music >= 0 && reveal >= 0 && music < reveal,
        JSON.stringify(g.services.log.slice(0, 6)));
  // :83-95 -- the still-hidden sprite is moved into the player's column FIRST.
  const place = g.services.log.indexOf("place:CERULEANCITY_RIVAL:" + column + ",2:down");
  check("he is placed in the player's own column while still hidden",
        place >= 0 && place < reveal, JSON.stringify(g.services.log.slice(0, 8)));
  check("and walks the three plain steps of CeruleanCityMovement1",
        g.services.log.indexOf("move:CERULEANCITY_RIVAL:down,down,down") >= 0,
        JSON.stringify(g.services.log.slice(0, 10)));
  check("the fight is the Cerulean roster", g.services.battlesFought[0] === "OPP_RIVAL1#" + (6 + rivalRosterFor(g.state)),
        JSON.stringify(g.services.battlesFought));
  check("the win sets the flag and he leaves", g.state.flags.EVENT_BEAT_CERULEAN_RIVAL === true &&
        g.services.log.lastIndexOf("reveal:CERULEANCITY_RIVAL:false") > g.services.log.indexOf("battle:"),
        JSON.stringify(g.services.log.slice(-6)));
}
testCerulean(() => game("CERULEAN_CITY", 20, 8), 20);
testCerulean(() => game("CERULEAN_CITY", 21, 8), 21);

{
  // CeruleanCityRivalDefeatedScript opens `cp LOST_BATTLE / jp z,
  // CeruleanCityClearScripts`, and that hides TOGGLE_CERULEAN_RIVAL: a lost
  // fight puts the scene back exactly as it shipped.
  const lost = game("CERULEAN_CITY", 20, 8, { won: false });
  walkInto(lost, "up", 40);
  check("losing leaves the flag unset", lost.state.flags.EVENT_BEAT_CERULEAN_RIVAL !== true);
  check("and hides him again rather than leaving him on the bridge",
        lost.services.log.lastIndexOf("reveal:CERULEANCITY_RIVAL:false") >
        lost.services.log.indexOf("reveal:CERULEANCITY_RIVAL:true"),
        JSON.stringify(lost.services.log.slice(-6)));
  check("and gives the town its own music back", lost.services.log.lastIndexOf("music:default") >= 0,
        JSON.stringify(lost.services.log.slice(-6)));
}

console.log(`\n${fail === 0 ? "STEPTRIGGER OK" : "STEPTRIGGER FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
