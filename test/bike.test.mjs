// The BICYCLE: getting on it, where it is allowed, and what it changes.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/bike.test.mjs Assets/Generated/kanto.json
//
// ItemUseBicycle (engine/items/item_effects.asm:638-666) and
// IsBikeRidingAllowed (home/overworld.asm:842-869). The bicycle has been in
// the bag since the Cerulean swap and the bag simply closed on it.
//
// The downhill roll on ROUTE_17 is NOT here and not built: it belongs with
// Cycling Road in milestone 6. The forced mount outside both gates is.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const Bike = await import(P + "Bike.ts");
const ItemUse = await import(P + "ItemUse.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: bike.test.mjs <bundle.json>");
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

console.log("== Where a bicycle may be ridden ==");
{
  check("the two maps the cartridge names",
        Bike.bikeAllowed(bundle, "ROUTE_23", "PLATEAU") && Bike.bikeAllowed(bundle, "INDIGO_PLATEAU", "PLATEAU"),
        JSON.stringify(bundle.field.bikeRiding));
  check("and the five tilesets",
        ["OVERWORLD", "FOREST", "UNDERGROUND", "SHIP_PORT", "CAVERN"].every((t) => Bike.bikeAllowed(bundle, "ROUTE_1", t)));
  check("a shop, a gym and a gate are none of them",
        !Bike.bikeAllowed(bundle, "BIKE_SHOP", "CLUB") && !Bike.bikeAllowed(bundle, "VERMILION_GYM", "GYM") &&
        !Bike.bikeAllowed(bundle, "ROUTE_16_GATE_1F", "GATE"));
  check("the cells outside both CYCLING ROAD gates force it",
        Bike.forcesBike(bundle, "ROUTE_16", 17, 10) && Bike.forcesBike(bundle, "ROUTE_16", 17, 11) &&
        Bike.forcesBike(bundle, "ROUTE_18", 33, 8) && Bike.forcesBike(bundle, "ROUTE_18", 33, 9));
  check("Seafoam's dives are in the same table and are not a bicycle",
        !Bike.forcesBike(bundle, "SEAFOAM_ISLANDS_B3F", 18, 7));
  check("and ROUTE_17 is the hill", Bike.isSlopeMap(bundle, "ROUTE_17") && !Bike.isSlopeMap(bundle, "ROUTE_16"));
}

console.log("\n== On and off ==");
{
  const outside = { mapId: "ROUTE_1", tileset: "OVERWORLD" };
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  const on = ItemUse.useItemOutside(bundle, state, "BICYCLE", -1, outside);
  check("got on the BICYCLE", state.riding === true &&
        on.script.map((c) => c.textId).join(",") === Bike.TEXT_GOT_ON_1 + "," + Bike.TEXT_GOT_ON_2,
        JSON.stringify(on.script));
  check("and it is not used up", on.consumed !== true && state.bag.length === 0);
  const off = ItemUse.useItemOutside(bundle, state, "BICYCLE", -1, outside);
  check("got off the BICYCLE", state.riding === false &&
        off.script[0].textId === Bike.TEXT_GOT_OFF_1, JSON.stringify(off.script));

  const inside = ItemUse.useItemOutside(bundle, state, "BICYCLE", -1, { mapId: "BIKE_SHOP", tileset: "CLUB" });
  check("indoors: no cycling allowed here",
        state.riding === false && inside.script[0].textId === Bike.TEXT_NO_CYCLING, JSON.stringify(inside.script));

  const swimming = ItemUse.useItemOutside(bundle, state, "BICYCLE", -1,
                                          { mapId: "ROUTE_1", tileset: "OVERWORLD", surfing: true });
  check("on the water OAK says this is not the time",
        swimming.script[0].textId === ItemUse.TEXT_NOT_TIME, JSON.stringify(swimming.script));

  state.riding = true;
  state.forcedBike = true;
  const stuck = ItemUse.useItemOutside(bundle, state, "BICYCLE", -1, outside);
  check("and on CYCLING ROAD you can't get off here",
        state.riding === true && stuck.script[0].textId === Bike.TEXT_CANNOT_GET_OFF, JSON.stringify(stuck.script));
}

console.log("\n== What riding changes ==");
function lensOn(mapId, x, y, opts) {
  const o = opts || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = "down";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
  state.bag.push({ id: "BICYCLE", count: 1 });
  state.riding = o.riding === true;
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

/**
 * How long one step takes, in frames, at this lens's own pace.
 *
 * The direction is faced first: turning costs its own beat, and counting it
 * would drown the difference this is measuring.
 */
function stepFrames(lens, direction) {
  lens.face(direction);
  lens.settle();
  lens.input.hold(direction);
  let n = 0;
  while (n < 600 && !lens.overworld.isMoving()) { lens.frame(); n++; }
  let moving = 0;
  while (n < 600 && lens.overworld.isMoving()) { lens.frame(); n++; moving++; }
  lens.input.hold("");
  lens.settle();
  return moving;
}
{
  const walking = lensOn("ROUTE_1", 9, 20);
  const onFoot = stepFrames(walking, "down");
  const riding = lensOn("ROUTE_1", 9, 20, { riding: true });
  const onWheels = stepFrames(riding, "down");
  check("a step on a bicycle takes about half as long",
        onFoot >= 8 && onWheels < onFoot &&
        onWheels >= Math.floor(onFoot / 2) - 2 && onWheels <= Math.ceil(onFoot / 2) + 2,
        onFoot + " frames in flight on foot, " + onWheels + " riding");
}
{
  // The gate house is a GATE tileset, where riding is not allowed: walking in
  // puts the bike away (LoadPlayerSpriteGraphics).
  const lens = lensOn("ROUTE_16_GATE_1F", 4, 6, { riding: true });
  check("riding into a building puts the bicycle away", lens.play.riding !== true,
        JSON.stringify({ riding: lens.play.riding }));
}
{
  // ROUTE_16 (17,11) is one of the two cells that mount you silently.
  const lens = lensOn("ROUTE_16", 17, 12);
  const mark = lens.pages.length;
  lens.run([{ walk: "up", n: 1 }]);
  lens.settle();
  check("the cell outside the gate puts you on the bicycle",
        lens.play.riding === true && lens.play.forcedBike === true,
        JSON.stringify({ riding: lens.play.riding, forced: lens.play.forcedBike, at: lens.state() }));
  check("and says nothing about it", lens.pages.length === mark, JSON.stringify(lens.pages.slice(mark)));
}

console.log("\n== The save carries it ==");
{
  const fresh = PlayState.newPlayState("test");
  check("a new game is on foot", fresh.riding === false && fresh.forcedBike === false &&
        fresh.version === PlayState.PLAY_STATE_VERSION);
  const old = PlayState.migratePlayState({ version: 8, romSha1: "test" }, "test");
  check("and a save from before the bicycle migrates on foot",
        old.riding === false && old.forcedBike === false && old.version === PlayState.PLAY_STATE_VERSION,
        JSON.stringify({ riding: old.riding, version: old.version }));
  const mid = PlayState.migratePlayState({ version: 9, romSha1: "test", riding: true, forcedBike: true }, "test");
  check("one written on CYCLING ROAD comes back on the bicycle",
        mid.riding === true && mid.forcedBike === true);
}

console.log("== CYCLING ROAD pedals itself ==");
{
  // JoypadOverworld: on ROUTE_17, with nothing held, the cartridge writes
  // D_DOWN into the joypad byte. The table said so since the first bake; until
  // 20 September nothing rolled.
  const onRoad = (mapId, x, y) => {
    const state = PlayState.newPlayState(bundle.romSha1);
    state.flags.EVENT_INTRO_DONE = true;
    state.party = [makeWildMon(bundle, "PIDGEY", 20, () => 0.5)];
    state.bag = [{ id: "BICYCLE", count: 1 }];
    state.riding = true;
    state.forcedBike = true;
    state.mapId = mapId; state.cellX = x; state.cellY = y; state.facing = "down";
    return new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  };
  // A clear stretch of the road: find a column with ten walkable cells below it.
  const probe = onRoad("ROUTE_17", 10, 10);
  const map = probe.overworld.map;
  let startX = -1;
  let startY = -1;
  for (let y = 5; y < 60 && startX < 0; y++) {
    for (let x = 0; x < map.widthCells; x++) {
      let clear = true;
      for (let d = 0; d <= 8; d++) if (!map.canEnter(x, y + d)) clear = false;
      if (clear) { startX = x; startY = y; break; }
    }
  }
  check("there is a clear stretch of road to roll down", startX >= 0, startX + "," + startY);
  const rolling = onRoad("ROUTE_17", startX, startY);
  for (let i = 0; i < 90; i++) rolling.frame();
  const rolled = rolling.state();
  check("with nothing held the bicycle rolls DOWN the hill", rolled.x === startX && rolled.y > startY + 2,
        JSON.stringify({ from: startY, to: rolled.y }));
  const pedalling = onRoad("ROUTE_17", startX, startY + 6);
  pedalling.input.hold("up");
  for (let i = 0; i < 60; i++) pedalling.frame();
  pedalling.input.hold("");
  check("a held direction wins: pedalling up goes up", pedalling.state().y < startY + 6, String(pedalling.state().y));
  const flat = onRoad("ROUTE_16", 20, 10);
  const flatBefore = flat.state();
  for (let i = 0; i < 90; i++) flat.frame();
  check("and no other road rolls", flat.state().x === flatBefore.x && flat.state().y === flatBefore.y);
}

console.log("\nBIKE " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
