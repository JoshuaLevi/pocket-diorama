// Blocks a flag opens or closes, derived live: the Game Corner staircase, the
// Elite Four's exit seals, Lance's doorway, Cinnabar's quiz gates.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/blockoverrides.test.mjs Assets/Generated/kanto.json [--selftest]

import { readFileSync } from "node:fs";
import { makeServices } from "./fakeservices.mjs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: blockoverrides.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const { Overworld } = await import(P + "Overworld.ts");
const { PlayLoop } = await import(P + "PlayLoop.ts");
const PlayState = await import(P + "PlayState.ts");
const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const { BlockOverrideIndex } = await import("../Assets/Scripts/world/BlockOverrides.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
if (!bundle.blockOverrides) {
  console.log("BLOCKOVERRIDES FAILED: the bundle has no blockOverrides -- re-bake with tools/bake.mjs");
  process.exit(1);
}

let pass = 0;
let fail = 0;
let quiet = false;
let quietFails = 0;
function check(name, ok, detail) {
  if (quiet) { if (!ok) { quietFails++; } return; }
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

function runtime(mapId, flags) {
  const def = bundle.maps[mapId];
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const rows = bundle.blockOverrides[mapId];
  if (rows) { map.setOverrides(new BlockOverrideIndex(rows, def.width), flags); }
  return map;
}

console.log("\n== The table ==");
{
  const live = Object.keys(bundle.blockOverrides).sort();
  check("the maps with live rows are exactly the ones whose openers exist",
        live.join(",") === ["AGATHAS_ROOM", "BRUNOS_ROOM", "CINNABAR_GYM", "GAME_CORNER", "LANCES_ROOM", "LORELEIS_ROOM",
                            "ROCKET_HIDEOUT_B1F", "ROCKET_HIDEOUT_B4F", "SILPH_CO_10F", "SILPH_CO_11F", "SILPH_CO_2F", "SILPH_CO_3F",
                            "SILPH_CO_4F", "SILPH_CO_5F", "SILPH_CO_6F", "SILPH_CO_7F", "SILPH_CO_8F", "SILPH_CO_9F",
                            "VERMILION_GYM", "VICTORY_ROAD_1F", "VICTORY_ROAD_2F", "VICTORY_ROAD_3F"].join(","),
        live.join(","));
  const disabled = [];
  for (const m of live) { for (const r of bundle.blockOverrides[m]) { if (r.disabled) { disabled.push(m); } } }
  // Vermilion Gym's door went live with the trash-can puzzle (TrashCans.ts).
  check("the rows whose openers do not exist yet are held back", disabled.sort().join(",") === "VICTORY_ROAD_1F,VICTORY_ROAD_2F,VICTORY_ROAD_2F,VICTORY_ROAD_3F", disabled.join(","));
  const silph = bundle.blockOverrides.SILPH_CO_2F.every((r) => r.keyItem === "CARD_KEY");
  check("Silph's doors ask for the CARD KEY, the hideout's gates do not",
        silph && bundle.blockOverrides.ROCKET_HIDEOUT_B4F.every((r) => r.keyItem === ""));
}

console.log("\n== The Game Corner staircase ==");
function testPoster(flags) {
  const map = runtime("GAME_CORNER", flags);
  check("the staircase cell (17,4) is a wall until the switch is found", !map.canEnter(17, 4), "block " + map.blockAt(8, 2));
  flags.EVENT_FOUND_ROCKET_HIDEOUT = true;
  check("and a warp cell the moment it is", map.canEnter(17, 4) && map.warpAt(17, 4) !== null && map.warpAt(17, 4).destMap === "ROCKET_HIDEOUT_B1F",
        "block " + map.blockAt(8, 2));
  check("a fresh runtime with no overrides shows the cartridge's shipped byte", new MapRuntime(bundle.maps.GAME_CORNER, bundle.tilesets.LOBBY).blockAt(8, 2) === 0x43);
}
testPoster({});

console.log("\n== The Elite Four ==");
/** Which of a block's four cells can be entered. */
function cells(map, bx, by) {
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map((d) => map.canEnter(bx * 2 + d[0], by * 2 + d[1]));
}
const count = (list) => list.filter((x) => x).length;
function sealTest(mapId, bx, by, flag, name) {
  const flags = {};
  const map = runtime(mapId, flags);
  const closed = cells(map, bx, by);
  flags[flag] = true;
  const open = cells(map, bx, by);
  check(name + ": sealed before the flag, open after", count(closed) < count(open),
        JSON.stringify({ closed, open, closedBlock: map.blockAt(bx, by) }));
}
sealTest("LORELEIS_ROOM", 2, 0, "EVENT_BEAT_LORELEIS_ROOM_TRAINER_0", "Lorelei's exit");
sealTest("BRUNOS_ROOM", 2, 0, "EVENT_BEAT_BRUNOS_ROOM_TRAINER_0", "Bruno's exit");
sealTest("AGATHAS_ROOM", 2, 0, "EVENT_BEAT_AGATHAS_ROOM_TRAINER_0", "Agatha's exit (a room that ships a third block)");
sealTest("CINNABAR_GYM", 9, 3, "EVENT_BEAT_CINNABAR_GYM_TRAINER_1", "a Cinnabar gate opened by beating its guard (any-of)");
sealTest("CINNABAR_GYM", 9, 3, "EVENT_CINNABAR_GYM_GATE0_UNLOCKED", "the same gate opened by the quiz");
{
  const lf = {};
  const lance = runtime("LANCES_ROOM", lf);
  const before = cells(lance, 2, 6).concat(cells(lance, 3, 6));
  lf.EVENT_LANCES_ROOM_LOCK_DOOR = true;
  const after = cells(lance, 2, 6).concat(cells(lance, 3, 6));
  check("Lance's doorway is open on arrival and locks behind the player (the inverted rows)",
        count(before) > count(after) && count(before) > 0, JSON.stringify({ before, after }));
}

console.log("\n== The join: a flag flipped by a script redraws the world ==");
function testJoin(make) {
  const { state, services, loop, world } = make();
  const sign = bundle.maps.GAME_CORNER.signs.find((s) => s.text === "TEXT_GAMECORNER_POSTER");
  check("the staircase is shut on the way in", !world.map.canEnter(17, 4));
  const target = loop.interact(bundle.maps.GAME_CORNER, sign.x, sign.y + 1, "up", false);
  for (let i = 0; i < 60 && loop.isBusy(); i++) { loop.update(); }
  check("reading the poster finds the switch", target !== null && state.flags.EVENT_FOUND_ROCKET_HIDEOUT === true, JSON.stringify(services.log));
  check("the world already lets the player through", world.map.canEnter(17, 4));
  check("and the lens was told to redraw exactly once", services.log.filter((l) => l === "blocks:GAME_CORNER").length === 1, JSON.stringify(services.log));
  for (let i = 0; i < 5; i++) { loop.update(); }
  check("and not again while nothing changes", services.log.filter((l) => l === "blocks:GAME_CORNER").length === 1);
}
const makeJoin = () => {
  const state = PlayState.newPlayState("t");
  state.flags.EVENT_INTRO_DONE = true;
  const services = makeServices(bundle, "GAME_CORNER");
  const loop = new PlayLoop(bundle, state, services);
  const world = new Overworld(bundle, "GAME_CORNER", 9, 5, () => 0.99);
  loop.attach(world);
  return { state, services, loop, world };
};
testJoin(makeJoin);

console.log("\n== A door that asks for the CARD KEY ==");
{
  const def = bundle.maps.SILPH_CO_2F;
  const row = bundle.blockOverrides.SILPH_CO_2F[0];
  const state = PlayState.newPlayState("t");
  state.flags.EVENT_INTRO_DONE = true;
  const services = makeServices(bundle, "SILPH_CO_2F");
  const loop = new PlayLoop(bundle, state, services);
  // Find a closed cell of the door block with an enterable neighbour to stand on.
  const probe = new Overworld(bundle, "SILPH_CO_2F", 0, 0, () => 0.99);
  loop.attach(probe);
  let stand = null, door = null, facing = "";
  const dirs = [["up", 0, 1], ["down", 0, -1], ["left", 1, 0], ["right", -1, 0]];
  for (let dy = 0; dy < 2 && !stand; dy++) for (let dx = 0; dx < 2 && !stand; dx++) {
    const cx = row.bx * 2 + dx, cy = row.by * 2 + dy;
    if (probe.map.canEnter(cx, cy)) { continue; }
    for (const d of dirs) {
      if (probe.map.canEnter(cx + d[1], cy + d[2])) { stand = [cx + d[1], cy + d[2]]; door = [cx, cy]; facing = d[0]; break; }
    }
  }
  check("the 2F door is shut and has a cell to stand before it", stand !== null, JSON.stringify(row));
  const world = new Overworld(bundle, "SILPH_CO_2F", stand[0], stand[1], () => 0.99);
  loop.attach(world);
  const without = loop.interact(def, stand[0], stand[1], facing, false);
  for (let i = 0; i < 40 && loop.isBusy(); i++) { loop.update(); }
  check("without the key the door says so and stays shut", without !== null && !world.map.canEnter(door[0], door[1]) &&
        services.log.some((l) => l.indexOf("text:") === 0), JSON.stringify(services.log));
  PlayState.giveItem(state, "CARD_KEY", 1);
  const mark = services.log.length;
  const withKey = loop.interact(def, stand[0], stand[1], facing, false);
  for (let i = 0; i < 40 && loop.isBusy(); i++) { loop.update(); }
  check("with the CARD KEY the door opens, its flag lands and the lens redraws", withKey !== null && world.map.canEnter(door[0], door[1]) &&
        state.flags[row.flags[0]] === true && services.log.slice(mark).some((l) => l === "blocks:SILPH_CO_2F"), JSON.stringify(services.log.slice(mark)));
  check("an open door is no longer a door", loop.interact(def, stand[0], stand[1], facing, false) === null);
}

if (selftest) {
  console.log("\n-- selftest --");
  const failsWith = (fn) => { quiet = true; quietFails = 0; fn(); quiet = false; return quietFails; };
  // A world that never got the table: the join must go red.
  check("[selftest] a world without the override table is caught",
        failsWith(() => testJoin(() => { const g = makeJoin(); g.world.setBlockOverrides(null, null); return g; })) > 0);
  check("[selftest] the attached world passes the quiet run", failsWith(() => testJoin(makeJoin)) === 0);
}

console.log(`\n${fail === 0 ? "BLOCKOVERRIDES OK" : "BLOCKOVERRIDES FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
