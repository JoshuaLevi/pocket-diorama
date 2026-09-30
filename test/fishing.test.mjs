// The three rods.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/fishing.test.mjs Assets/Generated/kanto.json
//
// engine/items/item_effects.asm: FishingInit decides whether a line may be
// cast at all, and each rod picks what takes it. The rolls are the point --
// ONE random byte, bit 0 for bite-or-nibble and bits 1-2 for which row of the
// group, re-rolled while they name a row that is not there -- so the byte is
// scripted here and every branch is walked.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const F = await import(P + "Fishing.ts");
const ItemUse = await import(P + "ItemUse.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: fishing.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "FISHING", "Red's fishing groups");
globalThis.print = () => {};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

/** A random() handing out these bytes in order, then repeating the last. */
function bytes(list) {
  let i = 0;
  return () => { const b = list[Math.min(i, list.length - 1)]; i++; return b / 256; };
}

console.log("== The OLD ROD never fails and never varies ==");
{
  const first = F.castRod(bundle, "PALLET_TOWN", "OLD_ROD", bytes([0xff]));
  const second = F.castRod(bundle, "CERULEAN_CAVE_B1F", "OLD_ROD", bytes([0x00]));
  check("MAGIKARP at 5, wherever you are and whatever the byte says",
        first.kind === "bite" && first.species === "MAGIKARP" && first.level === 5 &&
        JSON.stringify(first) === JSON.stringify(second), JSON.stringify([first, second]));
}

console.log("\n== The GOOD ROD's half-and-half ==");
{
  // ItemUseGoodRod:1836-1857. `srl a` shifts bit 0 into carry: set means no
  // bite. Bits 1-2 then index GoodRodMons, re-rolling on 2 or 3.
  check("an odd byte is a nibble", F.castRod(bundle, "PALLET_TOWN", "GOOD_ROD", bytes([0x01])).kind === "nibble");
  const goldeen = F.castRod(bundle, "PALLET_TOWN", "GOOD_ROD", bytes([0x00]));
  check("row 0 is GOLDEEN at 10", goldeen.species === "GOLDEEN" && goldeen.level === 10,
        JSON.stringify(goldeen));
  const poliwag = F.castRod(bundle, "PALLET_TOWN", "GOOD_ROD", bytes([0x02]));
  check("row 1 is POLIWAG at 10", poliwag.species === "POLIWAG" && poliwag.level === 10,
        JSON.stringify(poliwag));
  // 0x04 -> bit 0 clear, bits 1-2 = 2, which is past the two mons: draw again.
  const rerolled = F.castRod(bundle, "PALLET_TOWN", "GOOD_ROD", bytes([0x04, 0x06, 0x02]));
  check("a row the table does not have is drawn again, not clamped",
        rerolled.species === "POLIWAG", JSON.stringify(rerolled));
  check("and the map has nothing to do with it",
        F.castRod(bundle, "CERULEAN_CAVE_B1F", "GOOD_ROD", bytes([0x00])).species === "GOLDEEN");
}

console.log("\n== The SUPER ROD reads the map ==");
{
  // ReadSuperRodData:2855-2898. ROUTE_12's group is four deep, so every one of
  // the two index bits lands somewhere.
  const rows = bundle.field.superRod.ROUTE_12;
  check("Route 12 has a group of four", rows.length === 4, JSON.stringify(rows));
  for (let i = 0; i < 4; i++) {
    const taken = F.castRod(bundle, "ROUTE_12", "SUPER_ROD", bytes([i << 1]));
    check("bits 1-2 = " + i + " is " + rows[i].species,
          taken.kind === "bite" && taken.species === rows[i].species && taken.level === rows[i].level,
          JSON.stringify(taken));
  }
  check("an odd byte is still a nibble",
        F.castRod(bundle, "ROUTE_12", "SUPER_ROD", bytes([0x01])).kind === "nibble");
  // PEWTER_CITY is not in SuperRodData: e = 2, "Looks like there's nothing here."
  check("a map with no fishing group has nothing at all",
        F.castRod(bundle, "PEWTER_CITY", "SUPER_ROD", bytes([0x00])).kind === "nothing" &&
        F.superRodGroup(bundle, "PEWTER_CITY") === null);
  const two = bundle.field.superRod.PALLET_TOWN;
  check("Pallet Town's group is two, so rows 2 and 3 are drawn again",
        two.length === 2 &&
        F.castRod(bundle, "PALLET_TOWN", "SUPER_ROD", bytes([0x06, 0x02])).species === two[1].species,
        JSON.stringify(two));
}

console.log("\n== Where a line may be cast ==");
{
  const place = { mapId: "PALLET_TOWN", tileset: "OVERWORLD" };
  const state = PlayState.newPlayState(bundle.romSha1);
  const dry = ItemUse.useItemOutside(bundle, state, "OLD_ROD", -1,
                                     { mapId: "PALLET_TOWN", tileset: "OVERWORLD", waterAhead: false },
                                     bytes([0]));
  check("facing dry land, OAK says this is not the time",
        dry.script.length === 1 && dry.script[0].textId === ItemUse.TEXT_NOT_TIME, JSON.stringify(dry.script));
  const surfing = ItemUse.useItemOutside(bundle, state, "OLD_ROD", -1,
                                         { mapId: "PALLET_TOWN", tileset: "OVERWORLD", waterAhead: true, surfing: true },
                                         bytes([0]));
  check("and you cannot fish off your own POKeMON",
        surfing.script.length === 1 && surfing.script[0].textId === ItemUse.TEXT_NOT_TIME);
  const cast = ItemUse.useItemOutside(bundle, state, "OLD_ROD", -1,
                                      { mapId: "PALLET_TOWN", tileset: "OVERWORLD", waterAhead: true },
                                      bytes([0]));
  const ops = cast.script.map((c) => c.op).join(">");
  check("water in front of you is a cast", ops === "show_text>text_sound>wait>wait>show_text>static_battle", ops);
  check("the rod is never used up", cast.consumed !== true);
  check("and the battle it starts remembers nothing",
        cast.script[cast.script.length - 1].flag === "", JSON.stringify(cast.script[cast.script.length - 1]));
  void place;
}

console.log("\n== A cast, through the whole lens ==");
function lensFishing(mapId, x, y, facing, rod, rolls) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
  state.bag.push({ id: rod, count: 1 });
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true,
                                          random: bytes(rolls || [0]) });
  lens.clearText();
  lens.settle();
  const mark = lens.pages.length;
  lens.loop.useItem(lens.overworld, rod, -1);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 20000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return { said: lens.pages.slice(mark).join(" "), lens: lens, frames: n };
}
{
  // PALLET_TOWN (5,13) has the sea directly below it.
  const old = lensFishing("PALLET_TOWN", 5, 13, "down", "OLD_ROD");
  check("the line goes in with the item line and the cast sound",
        old.said.indexOf("used") >= 0 && old.said.indexOf("OLD ROD") >= 0 &&
        old.lens.sounds.indexOf("Heal_Ailment") >= 0, old.said + " " + JSON.stringify(old.lens.sounds));
  check("it's a bite", old.said.indexOf("It's a bite") >= 0, old.said);
  check("and a MAGIKARP is on the other end",
        old.lens.battles.length === 1 && old.lens.battles[0] === "MAGIKARP@5",
        JSON.stringify(old.lens.battles));
  check("the cast took the cartridge's own hundred and ninety frames",
        old.frames >= F.CAST_FRAMES + F.ANIM_FRAMES, "" + old.frames);

  const nibbled = lensFishing("PALLET_TOWN", 5, 13, "down", "GOOD_ROD", [0x01]);
  check("a nibble ends there, with no battle",
        nibbled.said.indexOf("not even a nibble") >= 0 ||
        nibbled.said.indexOf("Not even a nibble") >= 0, nibbled.said);
  check("and nothing is fought", nibbled.lens.battles.length === 0, JSON.stringify(nibbled.lens.battles));

  const inland = lensFishing("PEWTER_CITY", 16, 18, "down", "SUPER_ROD");
  check("on dry land the bag just says this is not the time",
        inland.said.indexOf("isn't the time") >= 0 && inland.lens.battles.length === 0, inland.said);
}

console.log("\n== The POKe FLUTE, and what sleeps on two roads ==");
{
  // ItemUsePokeFlute (item_effects.asm:1671-1705) and the four cells of
  // Route12SnorlaxFluteCoords (:1774-1779).
  const Flute = await import(P + "Flute.ts");
  function play(mapId, x, y, flags) {
    const state = PlayState.newPlayState(bundle.romSha1);
    state.playerName = "RED";
    for (const f of flags || []) { state.flags[f] = true; }
    const out = ItemUse.useItemOutside(bundle, state, "POKE_FLUTE", -1,
                                       { mapId: mapId, tileset: "OVERWORLD", cellX: x, cellY: y });
    return { state: state, script: out.script, ops: out.script.map((c) => c.op).join(">") };
  }
  const anywhere = play("PALLET_TOWN", 5, 6);
  check("played anywhere else it is a catchy tune",
        anywhere.script.length === 1 && anywhere.script[0].textId === Flute.TEXT_NO_EFFECT,
        JSON.stringify(anywhere.script));
  const nearby = play("ROUTE_12", 10, 61);
  check("north of the SNORLAX it has an effect",
        nearby.script[0].textId === Flute.TEXT_HAD_EFFECT &&
        nearby.ops.indexOf("static_battle") >= 0, nearby.ops);
  check("he wakes in a grumpy rage, is taken off the road, and is fought at 30",
        nearby.script[1].textId === "_Route12SnorlaxWokeUpText" &&
        nearby.script[2].op === "hide_object" && nearby.script[2].npc === "ROUTE12_SNORLAX" &&
        nearby.script[3].species === "SNORLAX" && nearby.script[3].level === 30 &&
        nearby.script[3].flag === "EVENT_BEAT_ROUTE12_SNORLAX", JSON.stringify(nearby.script));
  // Route12.asm $564C and Route16.asm $598F both read wBattleResult and skip
  // the line when it is 2: a SNORLAX in a ball did not calm down and wander
  // back to the mountains. The flag is set either way, so the road opens
  // whichever happened.
  check("and he only calms down if he was beaten, not caught, and not lost to",
        nearby.ops.endsWith(
          "check_battle_result>jump_if_false>check_caught>jump_if_true>show_text"),
        nearby.ops);
  check("the other one is written the same way",
        play("ROUTE_16", 25, 10).ops.indexOf("check_caught") > 0);
  check("every one of his four sides hears it",
        [[9, 62], [10, 61], [10, 63], [11, 62]].every((c) =>
          play("ROUTE_12", c[0], c[1]).script[0].textId === Flute.TEXT_HAD_EFFECT));
  check("a cell further away does not",
        play("ROUTE_12", 10, 60).script[0].textId === Flute.TEXT_NO_EFFECT);
  check("and once he has moved, the road is quiet",
        play("ROUTE_12", 10, 61, ["EVENT_BEAT_ROUTE12_SNORLAX"]).script[0].textId === Flute.TEXT_NO_EFFECT);
  const sixteen = play("ROUTE_16", 25, 10);
  check("the other one has two sides and his own line",
        sixteen.script[1].textId === "_Route16SnorlaxWokeUpText" &&
        sixteen.script[3].flag === "EVENT_BEAT_ROUTE16_SNORLAX", JSON.stringify(sixteen.script));
  check("the flute is never used up", play("ROUTE_12", 10, 61).state.bag.length === 0);
}

console.log("\nFISHING " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
