// A trainer who sees you coming.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/trainersight.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Two hundred and ninety-five of Kanto's trainers attack on sight, and until
// TrainerSight.ts not one of them did. The twelve bytes that say so were
// already in the bundle -- `trainerHeaders`, whose twelfth field is how far
// each of them can see -- and nothing read the field.
//
// The rule is engine/overworld/trainer_sight.asm's TrainerEngage, and this
// suite is mostly about the three things it does NOT do, because each of them
// is a reasonable guess that would have been wrong:
//
//   * no wall test. Two trainers in Kanto can see a cell across solid ground,
//     and both of them are in here by name.
//   * no turning of the player. You keep facing the way you walked.
//   * no walking onto your cell. He stops on the one beside you.
//
// The sweep is the point of the suite: every one of the 295 is checked at the
// far end of its own range and one cell past it, so a rule that was off by one
// for a single facing cannot hide behind the handful of named cases.
//
// --selftest bends each half of the rule -- the range, the side, the axis --
// and checks the sweep is what catches it.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const SELFTEST = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: trainersight.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
globalThis.print = () => {};

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { sightingAt, sightingScript, meetingMusicFor } =
  await import(P + "script/TrainerSight.ts");
const { trainerHeaderFor } = await import(P + "script/TrainerTalk.ts");
const { shippedFacing } = await import("../Assets/Scripts/world/WorldData.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** A save with a party, so a battle that starts can actually start. */
function save(flags) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 14, () => 0.5));
  if (flags) { for (const f of flags) { state.flags[f] = true; } }
  return state;
}

/** sightingAt with nothing hidden and nobody moved. */
function seen(mapId, x, y, state) {
  return sightingAt(bundle, bundle.maps[mapId], x, y, state || save(), {}, null);
}

/** Every trainer in Kanto who attacks on sight, with their facing and reach. */
function sightTrainers() {
  const out = [];
  for (const mapId in bundle.maps) {
    const map = bundle.maps[mapId];
    for (const object of map.objects || []) {
      if (!object.trainerClass) { continue; }
      const header = trainerHeaderFor(bundle, map, object.index);
      if (header === null || header.range <= 0) { continue; }
      out.push({ mapId: mapId, object: object, header: header, facing: shippedFacing(object) });
    }
  }
  return out;
}

const TRAINERS = sightTrainers();

console.log("== One trainer, cell by cell ==");
{
  // ROUTE3_YOUNGSTER1 stands on (10,6) looking right and reaches two cells.
  const state = save();
  check("the cell in front of him", seen("ROUTE_3", 11, 6, state) !== null);
  check("and the far end of his range", seen("ROUTE_3", 12, 6, state) !== null);
  check("one cell past it, nothing", seen("ROUTE_3", 13, 6, state) === null);
  check("behind him, nothing", seen("ROUTE_3", 9, 6, state) === null);
  check("off his row, nothing", seen("ROUTE_3", 11, 5, state) === null);
  check("on his own cell, nothing", seen("ROUTE_3", 10, 6, state) === null);
  const sighting = seen("ROUTE_3", 12, 6, state);
  check("he knows how far away you are", sighting.distance === 2, "" + sighting.distance);
  check("and which of them it is", sighting.object.name === "ROUTE3_YOUNGSTER1", sighting.object.name);
}

console.log("\n== All two hundred and ninety-five ==");
{
  let reach = 0;
  let overreach = 0;
  let behind = 0;
  let beside = 0;
  for (const t of TRAINERS) {
    const d = DELTA[t.facing];
    const far = [t.object.x + d[0] * t.header.range, t.object.y + d[1] * t.header.range];
    const past = [t.object.x + d[0] * (t.header.range + 1), t.object.y + d[1] * (t.header.range + 1)];
    const back = [t.object.x - d[0], t.object.y - d[1]];
    // Directly beside him, across his facing: one cell away, lined up on the
    // OTHER axis. A rule that read the alignment without letting the facing
    // pick the axis would answer here, and it is the tightest cell that can
    // tell the two apart.
    const side = [t.object.x + d[1], t.object.y + d[0]];
    const state = save();
    // Always asked about THIS trainer: a cell out of his reach can still be
    // inside somebody else's, and five of Kanto's cells are.
    const sees = (cell) => {
      const hit = sightingAt(bundle, bundle.maps[t.mapId], cell[0], cell[1], state, {}, null);
      return hit !== null && hit.object.name === t.object.name;
    };
    if (sees(far)) { reach++; }
    if (sees(past)) { overreach++; }
    if (sees(back)) { behind++; }
    if (sees(side)) { beside++; }
  }
  check("every one of them sees the far end of his own range", reach === TRAINERS.length,
        reach + " of " + TRAINERS.length);
  check("and none of them sees one cell further", overreach === 0, overreach + " did");
  check("none of them has eyes in the back of his head", behind === 0, behind + " did");
  check("and none of them sees off his own line", beside === 0, beside + " did");
}

console.log("\n== A wall is not in his way ==");
{
  // CERULEANGYM_SWIMMER stands in the water on (8,7) looking left with three
  // cells of reach. (7,7) and (6,7) are solid; (5,7) is the walkway, and he
  // challenges you across the pool, exactly as the cartridge does -- nothing
  // in TrainerEngage looks at the map.
  const gym = seen("CERULEAN_GYM", 5, 7);
  check("the Cerulean swimmer sees you across the pool",
        gym !== null && gym.object.name === "CERULEANGYM_SWIMMER", JSON.stringify(gym && gym.object.name));
  // ROUTE9_YOUNGSTER1 on (22,2) looking down over four cells, with (22,5) solid.
  const route = seen("ROUTE_9", 22, 6);
  check("and Route 9's youngster sees you over the rock",
        route !== null && route.object.name === "ROUTE9_YOUNGSTER1", JSON.stringify(route && route.object.name));
}

console.log("\n== Who does not see you ==");
{
  const beaten = save(["EVENT_BEAT_ROUTE_3_TRAINER_0"]);
  check("a trainer you have beaten looks straight through you",
        seen("ROUTE_3", 12, 6, beaten) === null);
  const hidden = sightingAt(bundle, bundle.maps.ROUTE_3, 12, 6, save(),
                            { "ROUTE_3:ROUTE3_YOUNGSTER1": false }, null);
  check("and one a script has taken off the map is not there to look",
        hidden === null, JSON.stringify(hidden && hidden.object.name));
  // Brock has no header row -- he is hand written in MapScripts -- so the
  // sweep must not invent a sightline for him out of the object's own fields.
  // He stands on (4,1) looking down the room; (4,3) is straight in front of
  // him and nobody else's business.
  check("a boss with no header has no line of sight", seen("PEWTER_GYM", 4, 3) === null,
        JSON.stringify(seen("PEWTER_GYM", 4, 3)));
  // And the man who DOES have one, on the same floor, still works -- so the
  // check above is about the missing header and not about the map.
  const gymGuide = seen("PEWTER_GYM", 4, 6);
  check("while the trainer beside him challenges across the room",
        gymGuide !== null && gymGuide.object.name === "PEWTERGYM_COOLTRAINER_M",
        JSON.stringify(gymGuide && gymGuide.object.name));
}

console.log("\n== The Power Plant exception has nothing to apply to ==");
{
  // CheckPlayerIsInFrontOfSprite returns early on POWER_PLANT so the cartridge's
  // OPP_VOLTORB "items" go off whichever side you walk up to them from. That
  // branch is carried in TrainerSight because it is part of the routine, but
  // our extraction does not model those Voltorbs as trainers at all: they come
  // out as static battles (`pokemon`, not `trainerClass`), and every header row
  // the map does have carries range 0.
  //
  // So this asserts the SHAPE OF THE DATA rather than the behaviour. The day a
  // re-bake starts emitting them as trainers, this flips and somebody looks at
  // the branch instead of discovering it by being ambushed by a Poke Ball.
  let asTrainers = 0;
  let asStatic = 0;
  for (const object of bundle.maps.POWER_PLANT.objects) {
    if (object.trainerClass) { asTrainers++; }
    if (object.pokemon) { asStatic++; }
  }
  check("the Voltorbs are static battles, not trainers", asTrainers === 0 && asStatic > 0,
        asTrainers + " trainers, " + asStatic + " static");
  let withSight = 0;
  for (const t of TRAINERS) { if (t.mapId === "POWER_PLANT") { withSight++; } }
  check("so no sightline on that map reaches the exception", withSight === 0, withSight + " did");
}

console.log("\n== What he does when he sees you ==");
{
  const sighting = seen("ROUTE_3", 12, 6);
  const script = sightingScript(bundle.maps.ROUTE_3, sighting);
  const ops = script.map((c) => c.op);
  // CheckFightingMapTrainers' own order: EngageMapTrainer plays the music,
  // then EXCLAMATION_BUBBLE goes up, then the d-pad is locked and only then
  // TrainerWalkUpToPlayer runs.
  check("the music changes first", ops[0] === "play_music", ops.join(","));
  check("then the mark goes up over his head",
        ops[1] === "emote" && script[1].npc === sighting.object.name,
        JSON.stringify(script[1]));
  check("and only then does he walk up, stopping a cell short",
        ops[2] === "walk_npc" && script[2].steps === sighting.distance - 1 &&
        script[2].direction === "right", JSON.stringify(script[2]));
  check("and then it is the same script as talking to him",
        ops.indexOf("start_battle") > 0 && ops.indexOf("beat_trainer") > ops.indexOf("start_battle"),
        ops.join(","));
  // PlayTrainerMusic and data/trainers/encounter_types.asm.
  check("a LASS is met with the female theme", meetingMusicFor("OPP_LASS") === "Music_MeetFemaleTrainer");
  check("a ROCKET with the evil one", meetingMusicFor("OPP_ROCKET") === "Music_MeetEvilTrainer");
  check("a BUG_CATCHER with the plain one", meetingMusicFor("OPP_BUG_CATCHER") === "Music_MeetMaleTrainer");
  check("and the rival changes nothing", meetingMusicFor("OPP_RIVAL1") === "");
}

console.log("\n== Walked into, in the running engine ==");
{
  const state = save();
  state.mapId = "ROUTE_3";
  state.cellX = 13;
  state.cellY = 6;
  state.facing = "left";
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  const before = lens.state();
  check("standing one cell clear of his line", before.x === 13 && before.y === 6 && lens.battles.length === 0,
        JSON.stringify({ x: before.x, y: before.y }));
  lens.run([{ walk: "left", n: 1 }]);
  lens.run([{ text: "", max: 40 }]);
  for (let i = 0; i < 900 && lens.loop.isBusy() && lens.battles.length === 0; i++) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); } else { lens.frame(); }
  }
  const after = lens.state();
  const said = lens.pages.join(" ");
  check("the step into his line starts the fight",
        lens.battles.length === 1 && lens.battles[0].indexOf("OPP_BUG_CATCHER") === 0,
        JSON.stringify(lens.battles));
  check("his challenge was said first", said.length > 0, said.slice(0, 120));
  check("you were not turned round to look at him", after.facing === "left", after.facing);
  const pose = lens.npcMotion.pose("ROUTE3_YOUNGSTER1");
  check("and he walked up and stopped on the cell beside you",
        pose !== null && pose.x === 11 && pose.y === 6, JSON.stringify(pose));
  const mark = lens.events.indexOf("emote:ROUTE3_YOUNGSTER1:shock");
  let fight = -1;
  for (let i = 0; i < lens.events.length; i++) {
    if (lens.events[i].indexOf("battle:") === 0) { fight = i; break; }
  }
  check("the mark went up over him", mark >= 0, lens.events.join(" "));
  check("and it went up before the fight did", mark >= 0 && mark < fight,
        mark + " / " + fight);
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // The risk a sweep of 295 trainers carries is not that the rule is wrong --
  // it is that the sweep is looking at cells no rule could ever answer, in
  // which case it passes forever. So: three BENT rules, each with one half of
  // TrainerEngage taken out, run over the very same cells, and each of them
  // has to light up the counter that the real rule keeps at zero.
  function bent(t, cell, mode) {
    const d = DELTA[t.facing];
    const dx = cell[0] - t.object.x;
    const dy = cell[1] - t.object.y;
    const along = d[0] !== 0 ? dx : dy;
    const across = d[0] !== 0 ? dy : dx;
    const reach = d[0] !== 0 ? (d[0] > 0 ? along : -along) : (d[1] > 0 ? along : -along);
    if (mode === "no-side") {
      // Forgot CheckPlayerIsInFrontOfSprite: distance without a sign.
      const far = reach < 0 ? -reach : reach;
      return across === 0 && far >= 1 && far <= t.header.range;
    }
    if (mode === "no-axis") {
      // Forgot that the FACING picks the axis, and took lined-up-on-either.
      const ax = dx < 0 ? -dx : dx;
      const ay = dy < 0 ? -dy : dy;
      const lined = dx === 0 || dy === 0;
      return lined && (ax + ay) >= 1 && (ax + ay) <= t.header.range;
    }
    // Off by one on the range.
    return across === 0 && reach >= 1 && reach <= t.header.range + 1;
  }
  let behind = 0;
  let offLine = 0;
  let past = 0;
  for (const t of TRAINERS) {
    const d = DELTA[t.facing];
    const back = [t.object.x - d[0], t.object.y - d[1]];
    const side = [t.object.x + d[1], t.object.y + d[0]];
    const beyond = [t.object.x + d[0] * (t.header.range + 1), t.object.y + d[1] * (t.header.range + 1)];
    if (bent(t, back, "no-side")) { behind++; }
    if (bent(t, side, "no-axis")) { offLine++; }
    if (bent(t, beyond, "off-by-one")) { past++; }
  }
  check("a rule that forgot the side would answer behind all of them",
        behind === TRAINERS.length, behind + " of " + TRAINERS.length);
  check("a rule that forgot the axis would answer beside all of them",
        offLine === TRAINERS.length, offLine + " of " + TRAINERS.length);
  check("a rule off by one on the range would answer past all of them",
        past === TRAINERS.length, past + " of " + TRAINERS.length);
  // And the real rule keeps all three at zero -- which is what the sweep above
  // asserts, on exactly these cells.
  let real = 0;
  for (const t of TRAINERS) {
    const d = DELTA[t.facing];
    const state = save();
    const cells = [
      [t.object.x - d[0], t.object.y - d[1]],
      [t.object.x + d[1], t.object.y + d[0]],
      [t.object.x + d[0] * (t.header.range + 1), t.object.y + d[1] * (t.header.range + 1)],
    ];
    for (const cell of cells) {
      const hit = sightingAt(bundle, bundle.maps[t.mapId], cell[0], cell[1], state, {}, null);
      if (hit !== null && hit.object.name === t.object.name) { real++; }
    }
  }
  check("and the rule as written answers none of them", real === 0, real + " did");
}

console.log("\nTRAINERSIGHT " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
