// The road to Cerulean: Nugget Bridge, the city, Route 25 and Bill.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/cerulean.test.mjs Assets/Generated/kanto.json
//
// Milestone 2 of docs/PLAN-FULL-GAME.md. Everything here is read against
// pret/pokered's own scripts -- Route24.asm, Route25.asm, CeruleanCity.asm,
// BillsHouse.asm -- and each section says which lines it stands on.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: cerulean.test.mjs <bundle.json>");
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

/** A lens standing on a cell, built from a save (see gates.test.mjs). */
function lensAt(mapId, x, y, flags) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = "down";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 20, () => 0.5));
  if (flags) { for (const f of flags) { state.flags[f] = true; } }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

/** Run whatever is going until it stops, answering pages. */
function drive(lens, limit) {
  let waited = 0;
  const max = limit || 6000;
  while ((lens.loop.isBusy() || lens.pageWaiting) && waited < max) {
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); waited += 12; continue; }
    lens.frame();
    waited++;
  }
  lens.settle();
}

/** Run what is going, answering every yes/no with `answer`. */
function driveAnswering(lens, answer) {
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 8000) {
    if (lens.answerWanted && lens.loop.textReady()) { lens.press(answer ? "a" : "b"); n += 6; continue; }
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
}

function saidSince(lens, mark) {
  return lens.pages.slice(mark).join(" ");
}

console.log("== Nugget Bridge: the prize, the pitch, the fight ==");
{
  const lens = lensAt("ROUTE_24", 10, 17);
  const mark = lens.pages.length;
  lens.run([{ walk: "up", n: 2 }]);
  drive(lens);
  const said = saidSince(lens, mark);
  const s = lens.state();
  check("the cell in front of him is what starts it", s.x === 10 && s.y === 15,
        s.map + " " + s.x + "," + s.y);
  check("he hands over the prize", said.indexOf("PRIZE") >= 0 || said.indexOf("prize") >= 0,
        said.slice(0, 200));
  check("the NUGGET is in the bag", lens.play.flags.EVENT_GOT_NUGGET === true);
  check("he then pitches TEAM ROCKET", said.indexOf("ROCKET") >= 0, said.slice(0, 400));
  check("and fights", lens.battles.some((b) => b.indexOf("OPP_ROCKET") === 0),
        JSON.stringify(lens.battles));
  check("beaten, he calls you a future leader", said.indexOf("LEADER") >= 0 || said.indexOf("leader") >= 0,
        said.slice(-200));
  // Route24.asm:148-152 and :154-158 -- sound_get_item_1 lives inside BOTH the
  // two-page prize block and the received-nugget block.
  const jingles = lens.sounds.filter((s2) => s2 === "Get_Item1").length;
  check("the jingle rings twice, as the two text blocks do", jingles === 2,
        JSON.stringify(lens.sounds));
}

console.log("== With the nugget already taken, he only talks ==");
{
  // Route24.asm:110-111 `CheckEvent EVENT_GOT_NUGGET / jr nz, .got_item` jumps
  // past the prize, the pitch AND the battle. Losing to him leaves the nugget
  // given and EVENT_BEAT_ROUTE_24_ROCKET unset, so this is the state a loss
  // lands in -- and the cartridge does not offer a rematch.
  const lens = lensAt("ROUTE_24", 10, 15, ["EVENT_GOT_NUGGET"]);
  const mark = lens.pages.length;
  lens.run([{ face: "right" }, { press: "a" }]);
  drive(lens);
  const said = saidSince(lens, mark);
  check("he says the one line", said.indexOf("LEADER") >= 0 || said.indexOf("leader") >= 0,
        said.slice(0, 200));
  // His last line NAMES Team Rocket ("a top leader in TEAM ROCKET!"), so the
  // pitch has to be recognised by its own words rather than by the gang's.
  check("no second pitch", said.indexOf("like to join") < 0 && said.indexOf("convincing") < 0,
        said.slice(0, 300));
  check("and no rematch", lens.battles.length === 0, JSON.stringify(lens.battles));
}

console.log("== The trigger is disarmed once the nugget is taken ==");
{
  const lens = lensAt("ROUTE_24", 10, 17, ["EVENT_GOT_NUGGET"]);
  const mark = lens.pages.length;
  lens.run([{ walk: "up", n: 2 }]);
  drive(lens);
  check("walking onto (10,15) says nothing at all", saidSince(lens, mark) === "",
        saidSince(lens, mark).slice(0, 160));
}

console.log("== Route 25 puts Bill's house back the way the quest needs it ==");
{
  // Route25ToggleBillsScript, run on every load of the map (its own guard is
  // BIT_CUR_MAP_LOADED_2, which is exactly "the first frame after entering").
  const midQuest = lensAt("ROUTE_25", 20, 9, ["EVENT_BILL_SAID_USE_CELL_SEPARATOR"]);
  check("walking out halfway puts the monster back on the floor",
        midQuest.play.objectToggles["BILLS_HOUSE:BILLSHOUSE_BILL_POKEMON"] === true,
        JSON.stringify(midQuest.play.objectToggles));
  check("and disarms the cell separator",
        midQuest.play.flags.EVENT_BILL_SAID_USE_CELL_SEPARATOR !== true);
  check("without claiming the quest is over",
        midQuest.play.flags.EVENT_LEFT_BILLS_HOUSE_AFTER_HELPING !== true);

  const helped = lensAt("ROUTE_25", 20, 9, ["EVENT_MET_BILL_2", "EVENT_GOT_SS_TICKET"]);
  check("with the ticket in hand it is marked done",
        helped.play.flags.EVENT_LEFT_BILLS_HOUSE_AFTER_HELPING === true);
  check("Bill becomes his standing self",
        helped.play.objectToggles["BILLS_HOUSE:BILLSHOUSE_BILL1"] === false &&
        helped.play.objectToggles["BILLS_HOUSE:BILLSHOUSE_BILL2"] === true,
        JSON.stringify(helped.play.objectToggles));
  check("and the Nugget Bridge Rocket is taken off Route 24 -- another map",
        helped.play.objectToggles["ROUTE_24:ROUTE24_COOLTRAINER_M1"] === false,
        JSON.stringify(helped.play.objectToggles));

  const done = lensAt("ROUTE_25", 20, 9, ["EVENT_LEFT_BILLS_HOUSE_AFTER_HELPING"]);
  check("once it is done the road does nothing at all",
        Object.keys(done.play.objectToggles).length === 0,
        JSON.stringify(done.play.objectToggles));

  const virgin = lensAt("ROUTE_24", 10, 17);
  check("and no other map runs it", virgin.play.flags.EVENT_LEFT_BILLS_HOUSE_AFTER_HELPING !== true);

  // The arrival script is not a cutscene: it must not hold the VM for even a
  // frame, or the first step, save or field move on the new map is refused.
  check("the road is walkable the moment you are on it", midQuest.loop.isBusy() === false);
  check("and the save is not locked", midQuest.loop.canSave() === true);
}

console.log("== Bill, and the machine he asks you to run ==");
{
  // bills_house_pc.asm:3-5 -- the PC answers only when faced from below.
  const side = lensAt("BILLS_HOUSE", 0, 4, ["EVENT_BILL_SAID_USE_CELL_SEPARATOR"]);
  const mark = side.pages.length;
  side.run([{ face: "right" }, { press: "a" }]);
  drive(side, 2000);
  check("from beside it the machine says nothing", saidSince(side, mark) === "",
        saidSince(side, mark).slice(0, 120));
  check("and nobody comes out", side.play.flags.EVENT_USED_CELL_SEPARATOR_ON_BILL !== true);
}
{
  const lens = lensAt("BILLS_HOUSE", 1, 5, ["EVENT_BILL_SAID_USE_CELL_SEPARATOR"]);
  const mark = lens.pages.length;
  lens.run([{ face: "up" }, { press: "a" }]);
  drive(lens, 30000);
  check("from in front of it, the separation runs", saidSince(lens, mark).length > 0,
        saidSince(lens, mark).slice(0, 120));
  check("and it is recorded", lens.play.flags.EVENT_USED_CELL_SEPARATOR_ON_BILL === true);
  check("Bill is out", lens.play.flags.EVENT_MET_BILL === true);
  // BillsHouseInitiatedText kills the music and the routine ends on
  // PlayDefaultMusic: the whole machine runs in silence.
  check("the music stops for it and comes back after",
        lens.music.indexOf("stop") >= 0 &&
        lens.music.lastIndexOf("default") > lens.music.indexOf("stop"),
        JSON.stringify(lens.music));
  check("the four sounds ring in the cartridge's order",
        lens.sounds.join(",").indexOf("Switch,Tink,Shrink,Tink,Get_Item1") >= 0,
        JSON.stringify(lens.sounds));
}
{
  // Bill ships hidden and the separation reveals him; this starts from there.
  const lens = lensAt("BILLS_HOUSE", 4, 5, ["EVENT_MET_BILL", "EVENT_MET_BILL_2",
                                            "EVENT_USED_CELL_SEPARATOR_ON_BILL"]);
  lens.play.objectToggles["BILLS_HOUSE:BILLSHOUSE_BILL1"] = true;
  lens.loop.setRevealed("BILLS_HOUSE", "BILLSHOUSE_BILL1", true);
  const mark = lens.pages.length;
  lens.run([{ face: "up" }, { press: "a" }]);
  drive(lens, 8000);
  const said = saidSince(lens, mark);
  check("he hands over the S.S. TICKET", lens.play.flags.EVENT_GOT_SS_TICKET === true,
        said.slice(0, 160));
  // .SSTicketReceivedText is text, sound_get_key_item, prompt -- the jingle
  // rings inside the box, and the lens cannot read a code embedded in words.
  check("with the key-item jingle, not the item-ball one",
        lens.sounds.indexOf("Get_Key_Item") >= 0 && lens.sounds.indexOf("Get_Item1") < 0,
        JSON.stringify(lens.sounds));
  check("and Cerulean's guards swap over",
        lens.play.objectToggles["CERULEAN_CITY:CERULEANCITY_GUARD1"] === true &&
        lens.play.objectToggles["CERULEAN_CITY:CERULEANCITY_GUARD2"] === false,
        JSON.stringify(lens.play.objectToggles));
}

console.log("== The bike shop ==");
{
  const bare = lensAt("BIKE_SHOP", 6, 3, null);
  const mark = bare.pages.length;
  bare.run([{ face: "up" }, { press: "a" }]);
  driveAnswering(bare, true);
  const said = saidSince(bare, mark);
  check("with nothing to trade, it is a welcome and a price",
        said.indexOf("BIKE SHOP") >= 0 && said.indexOf("afford") >= 0, said.slice(0, 200));
  check("and no bicycle", bare.play.flags.EVENT_GOT_BICYCLE !== true);
}
{
  const withVoucher = lensAt("BIKE_SHOP", 6, 3, null);
  withVoucher.play.bag.push({ id: "BIKE_VOUCHER", count: 1 });
  const mark = withVoucher.pages.length;
  withVoucher.run([{ face: "up" }, { press: "a" }]);
  driveAnswering(withVoucher, true);
  const said = saidSince(withVoucher, mark);
  check("the voucher is recognised", said.indexOf("VOUCHER") >= 0, said.slice(0, 200));
  check("the BICYCLE is in the bag",
        withVoucher.play.bag.some((b) => b.id === "BICYCLE"),
        JSON.stringify(withVoucher.play.bag));
  check("and the voucher is out of it",
        !withVoucher.play.bag.some((b) => b.id === "BIKE_VOUCHER"),
        JSON.stringify(withVoucher.play.bag));
  check("it is remembered", withVoucher.play.flags.EVENT_GOT_BICYCLE === true);
  const again = withVoucher.pages.length;
  withVoucher.run([{ press: "a" }]);
  driveAnswering(withVoucher, true);
  check("and afterwards he asks how you like it",
        saidSince(withVoucher, again).indexOf("How do you like") >= 0,
        saidSince(withVoucher, again).slice(0, 160));
}

console.log("\nCERULEAN " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
