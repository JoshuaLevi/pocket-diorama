// The two hidden events nothing read: the man on the bench, and what is
// buried under a tile.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/hiddenthings.test.mjs Assets/Generated/kanto.json
//
// Both tables ship in the bundle -- field.hiddenExtras.benchGuys (15 maps) and
// field.hiddenItems (39) -- and both are matched the way the cartridge matches
// them (engine/overworld/hidden_events.asm): against the cell IN FRONT of the
// player, not the one under their feet, which is the guess the itemfinder
// invites. A bench guy also needs the player's facing to be his.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { benchGuyScript, hiddenCoinScript, hiddenItemFlag } =
  await import(P + "script/HiddenThings.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: hiddenthings.test.mjs <bundle.json>");
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

function lensAt(mapId, x, y, facing, flags) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 12, () => 0.5));
  if (flags) { for (const f of flags) { state.flags[f] = true; } }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

function pressA(lens) {
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 3000) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.slice(mark).join(" ");
}

console.log("== The man on the bench ==");
{
  // MT_MOON_POKECENTER: (0,4), answers when you face LEFT at him.
  const facing = lensAt("MT_MOON_POKECENTER", 1, 4, "left");
  check("facing him, he speaks", pressA(facing).indexOf("store them") >= 0,
        JSON.stringify(facing.pages.slice(-2)));
  const wrong = lensAt("MT_MOON_POKECENTER", 0, 5, "up");
  check("from below, with the wrong facing, he does not", pressA(wrong) === "",
        JSON.stringify(wrong.pages.slice(-2)));
}
{
  const table = bundle.field.hiddenExtras.benchGuys;
  const maps = Object.keys(table);
  check("fifteen maps have a bench", maps.length === 15, "" + maps.length);
  // Eleven of them speak. Saffron's pointer is a script that branches on Silph
  // Co and the three Safari rest houses are not in the cartridge's own table.
  const speaks = maps.filter((m) => table[m].some(
    (g) => benchGuyScript(bundle, m, g.x, g.y, g.textFacing) !== null));
  check("eleven of them have words that resolve", speaks.length === 11,
        JSON.stringify(maps.filter((m) => speaks.indexOf(m) < 0)));
  check("and every one of those words is really in the bundle",
        speaks.every((m) => table[m].every((g) => {
          const script = benchGuyScript(bundle, m, g.x, g.y, g.textFacing);
          return script === null || typeof bundle.text[script[0].textId] === "string";
        })), JSON.stringify(speaks));
}

console.log("== What is buried under the tile ==");
{
  // ROUTE_4 (40,3): a GREAT BALL, hidden_item_coords.asm:61.
  const lens = lensAt("ROUTE_4", 40, 4, "up");
  const said = pressA(lens);
  check("facing the cell finds it", said.indexOf("found") >= 0, said.slice(0, 120));
  check("and it names what it was", said.indexOf("BALL") >= 0, said.slice(0, 120));
  check("the GREAT BALL is in the bag",
        lens.play.bag.some((b) => b.id === "GREAT_BALL"), JSON.stringify(lens.play.bag));
  check("the cell is marked dug up",
        lens.play.flags[hiddenItemFlag("ROUTE_4", 40, 3)] === true);
  const again = pressA(lens);
  check("and it cannot be found twice", again === "", again.slice(0, 120));
}
{
  const lens = lensAt("ROUTE_4", 40, 4, "up", [hiddenItemFlag("ROUTE_4", 40, 3)]);
  check("a cell already dug up says nothing at all", pressA(lens) === "");
  check("and nothing lands in the bag", lens.play.bag.length === 0,
        JSON.stringify(lens.play.bag));
}
{
  // Standing ON it is not how the cartridge finds one.
  const on = lensAt("ROUTE_4", 40, 3, "up");
  check("standing on the cell finds nothing", pressA(on) === "");
}
{
  const table = bundle.field.hiddenItems;
  const maps = Object.keys(table);
  check("thirty-nine maps have something buried", maps.length === 39, "" + maps.length);
  const items = maps.reduce((n, m) => n + table[m].length, 0);
  check("and every one of them names a real item",
        maps.every((m) => table[m].every((h) => bundle.items[h.item] !== undefined)),
        items + " in all");
}

console.log("== The link receptionist at the other desk ==");
{
  // engine/link/cable_club_npc.asm. Twelve of them, marked `cableClub` in the
  // bundle the same way a nurse is marked `nurse`, and read by nothing.
  const noDex = lensAt("MT_MOON_POKECENTER", 11, 3, "up");
  const said = pressA(noDex);
  check("she welcomes you to the Cable Club", said.indexOf("Cable Club") >= 0, said.slice(0, 120));
  check("and without the POKEDEX, preparations are being made",
        said.indexOf("preparations") >= 0, said.slice(0, 160));

  const withDex = lensAt("MT_MOON_POKECENTER", 11, 3, "up", ["EVENT_GOT_POKEDEX"]);
  const said2 = pressA(withDex);
  check("with it, she tries the link and nobody answers",
        said2.indexOf("2 friends") >= 0 && said2.indexOf("linked by cable") >= 0,
        said2.slice(0, 200));
  check("which is not the preparations line", said2.indexOf("preparations") < 0,
        said2.slice(0, 200));
}
{
  let marked = 0;
  for (const label of Object.keys(bundle.textPointers)) {
    for (const id of Object.keys(bundle.textPointers[label])) {
      if (bundle.textPointers[label][id].cableClub) { marked++; }
    }
  }
  check("twelve Centers have one", marked === 12, "" + marked);
}

console.log("\n== The cans that hold nothing ==");
{
  // hidden_events.asm:370-372 (the kitchen) and :216 (beside LT.SURGE), all
  // three PrintTrashText. The table carries a facing byte and
  // engine/events/hidden_events/vermilion_gym_trash.asm:1-3 never reads it --
  // the gym's own can is proof: its byte says DOWN and the cell above it is a
  // wall, so a facing test would make it unreachable.
  const above = lensAt("SS_ANNE_KITCHEN", 13, 4, "down");
  check("the kitchen's first can: only trash", pressA(above).indexOf("only trash") >= 0);
  const beside = lensAt("SS_ANNE_KITCHEN", 12, 5, "right");
  check("and from the side, the same answer", pressA(beside).indexOf("only trash") >= 0);
  const second = lensAt("SS_ANNE_KITCHEN", 13, 6, "down");
  check("the kitchen's second can", pressA(second).indexOf("only trash") >= 0);
  const gym = lensAt("VERMILION_GYM", 6, 2, "up");
  check("and the one beside LT.SURGE, whose facing byte points into a wall",
        pressA(gym).indexOf("only trash") >= 0);
  const notACan = lensAt("SS_ANNE_KITCHEN", 11, 5, "right");
  check("a cupboard next to it is still mute", pressA(notACan).length === 0);
}

console.log("\n== The gym statues ==");
{
  // engine/events/hidden_events/gym_statues.asm: facing UP only, the city and
  // the leader from the gym's own .LoadNames, and the player's name added to
  // the winners once the badge is his (wBeatGymFlags, data/maps/badge_maps.asm).
  const before = lensAt("VERMILION_GYM", 3, 15, "up");
  const said = pressA(before);
  check("it names the city and the leader",
        said.indexOf("VERMILION CITY") >= 0 && said.indexOf("LT.SURGE") >= 0, said);
  check("and the winners are the rival alone",
        said.indexOf("BLUE") >= 0 && said.indexOf("RED") < 0, said);

  const won = lensAt("VERMILION_GYM", 6, 15, "up");
  won.play.badges[2] = true;
  const said2 = pressA(won);
  check("with the THUNDERBADGE, your name is under his",
        said2.indexOf("BLUE") >= 0 && said2.indexOf("RED") >= 0 &&
        said2.indexOf("BLUE") < said2.indexOf("RED"), said2);

  const sideways = lensAt("VERMILION_GYM", 2, 14, "right");
  check("looking at one from the side says nothing", pressA(sideways).length === 0);

  const pewter = lensAt("PEWTER_GYM", 3, 11, "up");
  const said3 = pressA(pewter);
  check("every gym has its own two names", said3.indexOf("PEWTER CITY") >= 0 && said3.indexOf("BROCK") >= 0,
        said3);
}

console.log("\n== The coins on the GAME CORNER floor ==");
{
  // hidden_items.asm:52-119. Twelve piles, and three rules the ordinary
  // hidden items do not have.
  function atCoins(x, y, opts) {
    const o = opts || {};
    const lens = lensAt("GAME_CORNER", x, y + 1, "up", o.flags);
    if (o.coinCase !== false) { lens.play.bag.push({ id: "COIN_CASE", count: 1 }); }
    return lens;
  }
  const found = atCoins(0, 8);
  const said = pressA(found);
  check("a pile is found and counted", found.play.coins === 10 &&
        said.indexOf("found") >= 0 && said.indexOf("10") >= 0, said + " coins:" + found.play.coins);
  check("with the second pickup jingle", found.sounds.indexOf("Get_Item2") >= 0,
        JSON.stringify(found.sounds));
  check("and it is gone for good", pressA(found).length === 0 && found.play.coins === 10);

  const noCase = atCoins(0, 8, { coinCase: false });
  check("without a COIN CASE the floor says nothing at all",
        pressA(noCase).length === 0 && noCase.play.coins === 0);

  // The pile declared as 40 pays 20: `cp 40 / jr z, .bcd20`.
  const typo = atCoins(11, 7);
  pressA(typo);
  check("the pile the table calls forty pays twenty", typo.play.coins === 20, "" + typo.play.coins);
  const hundred = atCoins(15, 8);
  pressA(hundred);
  check("and the hundred pays a hundred", hundred.play.coins === 100, "" + hundred.play.coins);
}

console.log("\n== Two jokes and a song ==");
{
  // RedsHouse1F.asm:35-50 -- the TV only shows the film from below.
  const below = lensAt("REDS_HOUSE_1F", 3, 2, "up");
  check("the film is on from the right side", pressA(below).indexOf("railroad tracks") >= 0);
  const beside = lensAt("REDS_HOUSE_1F", 2, 1, "right");
  check("and from the side, oops, wrong side", pressA(beside).indexOf("wrong side") >= 0);
}
{
  // PewterPokecenter.asm:20-75 -- she stops the map's music, sings her own,
  // and gives it back.
  const lens = lensAt("PEWTER_POKECENTER", 1, 4, "up");
  const said = pressA(lens);
  check("JIGGLYPUFF says puu pupuu", said.indexOf("Puu") >= 0, said);
  check("the Center goes quiet for her song",
        lens.music.indexOf("stop") >= 0 &&
        lens.music.indexOf("Music_JigglypuffSong") > lens.music.indexOf("stop"),
        JSON.stringify(lens.music));
  check("and gets its music back afterwards", lens.music[lens.music.length - 1] === "default",
        JSON.stringify(lens.music));
  check("she turns on the spot while she sings",
        lens.events.filter((e) => e.indexOf("faceNpc:PEWTERPOKECENTER_JIGGLYPUFF") === 0).length >= 8,
        JSON.stringify(lens.events.slice(0, 6)));
}

console.log("\n== The magazines at MR FUJI's ==");
{
  // hidden_events.asm:514-518, three cells, PrintMagazinesText -- which never
  // reads the facing byte its table carries either.
  const rack = lensAt("MR_FUJIS_HOUSE", 0, 2, "up");
  check("POKeMON magazines", pressA(rack).indexOf("magazines") >= 0);
  const second = lensAt("MR_FUJIS_HOUSE", 7, 2, "up");
  check("and the pile by the other wall", pressA(second).indexOf("magazines") >= 0);
  const floor = lensAt("MR_FUJIS_HOUSE", 4, 3, "up");
  check("the wall between them says nothing", pressA(floor).length === 0);
}

console.log("\n== The bikes on display ==");
{
  // hidden_events.asm:542-548, six of them, ANY_FACING -- and two stand where
  // no cell can reach them, which is the cartridge's table as shipped.
  const left = lensAt("BIKE_SHOP", 1, 3, "up");
  check("a shiny new BICYCLE", pressA(left).indexOf("shiny new") >= 0);
  const right = lensAt("BIKE_SHOP", 3, 3, "up");
  check("and the next one along", pressA(right).indexOf("shiny new") >= 0);
  const low = lensAt("BIKE_SHOP", 0, 3, "down");
  check("and the pair by the wall", pressA(low).indexOf("shiny new") >= 0);
  const floor = lensAt("BIKE_SHOP", 4, 4, "down");
  check("the floor beside them says nothing", pressA(floor).length === 0);
}

// ---------------------------------------------------------------------------
// The pile a slot machine sits on top of
// ---------------------------------------------------------------------------
{
  // CheckForHiddenObject takes the FIRST coordinate match in the map's list,
  // and the thirty-six machines are listed before the twelve piles. The pile
  // at (12,15) shares its cell with the bottom machine of the third column,
  // so it can never be picked up -- not from the side, where the machine
  // answers, and not from above or below, where the machine's own facing
  // check fails and nothing falls through to the coins.
  const Slots = await import(P + "script/Slots.ts");
  const under = bundle.field.hiddenCoins.GAME_CORNER
    .filter((c) => Slots.slotMachineAt(bundle, "GAME_CORNER", c.x, c.y) !== null);
  check("exactly one pile lies under a machine, at (12,15)",
        under.length === 1 && under[0].x === 12 && under[0].y === 15,
        JSON.stringify(under));
  check("and it is dead whoever asks for it",
        hiddenCoinScript(bundle, {}, true, "GAME_CORNER", 12, 15) === null,
        JSON.stringify(hiddenCoinScript(bundle, {}, true, "GAME_CORNER", 12, 15)));
  check("while every other pile still answers",
        bundle.field.hiddenCoins.GAME_CORNER
          .filter((c) => !(c.x === 12 && c.y === 15))
          .every((c) => hiddenCoinScript(bundle, {}, true, "GAME_CORNER", c.x, c.y) !== null));
  // engine/events/hidden_items.asm: `cp 40 / jr z, .bcd20`, and the .bcd40
  // branch below it is dead code. The manifest carries the declared 40.
  const forty = hiddenCoinScript(bundle, {}, true, "GAME_CORNER", 11, 7);
  check("and the pile declared as 40 still pays 20",
        forty !== null && forty[0].amount === 20, JSON.stringify(forty));
}

console.log("\nHIDDENTHINGS " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
