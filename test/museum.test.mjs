// The Pewter museum: the only door in Kanto that charges money.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/museum.test.mjs Assets/Generated/kanto.json
//
// Read against scripts/Museum1F.asm and PewterCity.asm. Three things here that
// exist nowhere else in the game:
//
//   * a price on a door -- Y50, refused politely, and a step back out of the
//     way when you say no or cannot pay (Museum1F.asm:70-120);
//   * a man who answers differently depending on which side of his counter you
//     are standing on (:43-57);
//   * a ticket that lasts ONE visit, because Pewter City's own default script
//     resets the flag the moment you are back outside (PewterCity.asm:17-22).
//
// The reference port has none of it: it sets and reads EVENT_BOUGHT_MUSEUM_TICKET
// and resets it nowhere, so this had to be read off the cartridge.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: museum.test.mjs <bundle.json>");
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

function lensAt(mapId, x, y, opts) {
  const o = opts || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.rivalName = "BLUE";
  state.mapId = mapId;
  state.cellX = x;
  state.cellY = y;
  state.facing = o.facing ? o.facing : "up";
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.money = o.money === undefined ? 500 : o.money;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 12, () => 0.5));
  if (o.flags) { for (const f of o.flags) { state.flags[f] = true; } }
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.clearText();
  lens.settle();
  return lens;
}

/** Run what is going, answering every yes/no with `answer`. */
function drive(lens, answer) {
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < 4000) {
    if (lens.answerWanted && lens.loop.textReady()) { lens.press(answer ? "a" : "b"); n += 6; continue; }
    if (lens.pageWaiting && lens.loop.textReady()) { lens.press("a"); n += 12; continue; }
    lens.frame();
    n++;
  }
  lens.settle();
}

function said(lens, mark) {
  return lens.pages.slice(mark).join(" | ");
}

console.log("== Y50 at the door ==");
{
  const rich = lensAt("MUSEUM_1F", 9, 6);
  const mark = rich.pages.length;
  rich.run([{ walk: "up", n: 2 }]);
  drive(rich, true);
  const s = rich.state();
  check("walking up to the counter is what asks", said(rich, mark).indexOf("ticket") >= 0,
        said(rich, mark));
  check("saying yes pays exactly fifty", rich.play.money === 450, "" + rich.play.money);
  check("the ticket is remembered", rich.play.flags.EVENT_BOUGHT_MUSEUM_TICKET === true);
  check("and the player is left standing where they were", s.x === 9 && s.y === 4,
        s.x + "," + s.y);
}
{
  const broke = lensAt("MUSEUM_1F", 9, 6, { money: 20 });
  const mark = broke.pages.length;
  broke.run([{ walk: "up", n: 2 }]);
  drive(broke, true);
  const s = broke.state();
  check("without the money he says so", said(broke, mark).indexOf("enough money") >= 0,
        said(broke, mark));
  check("nothing is taken", broke.play.money === 20, "" + broke.play.money);
  check("no ticket", broke.play.flags.EVENT_BOUGHT_MUSEUM_TICKET !== true);
  check("and the player is stepped back off the cell", s.x === 9 && s.y === 5, s.x + "," + s.y);
}
{
  const no = lensAt("MUSEUM_1F", 9, 6);
  const mark = no.pages.length;
  no.run([{ walk: "up", n: 2 }]);
  drive(no, false);
  const s = no.state();
  check("saying no costs nothing", no.play.money === 500 && said(no, mark).indexOf("Come again") >= 0,
        said(no, mark));
  check("and steps back too", s.x === 9 && s.y === 5, s.x + "," + s.y);
}
{
  const paid = lensAt("MUSEUM_1F", 9, 6, { flags: ["EVENT_BOUGHT_MUSEUM_TICKET"] });
  const mark = paid.pages.length;
  paid.run([{ walk: "up", n: 2 }]);
  drive(paid, true);
  check("with the ticket the door says nothing at all", said(paid, mark) === "", said(paid, mark));
  check("and the walk is not interrupted", paid.state().y === 4, JSON.stringify(paid.state()));
}

console.log("== Which side of the counter you are on ==");
{
  const front = lensAt("MUSEUM_1F", 11, 4, { facing: "right" });
  const mark = front.pages.length;
  front.run([{ press: "a" }]);
  drive(front, false);
  check("from the front he sells a ticket", said(front, mark).indexOf("ticket") >= 0,
        said(front, mark));
}
{
  const behind = lensAt("MUSEUM_1F", 13, 4, { facing: "left" });
  const mark = behind.pages.length;
  behind.run([{ press: "a" }]);
  drive(behind, true);
  check("from behind the counter he gives up on the ticket",
        said(behind, mark).indexOf("sneak in the back way") >= 0, said(behind, mark));
  check("and yes sends you to the lab that resurrects them",
        said(behind, mark).indexOf("resurrect") >= 0, said(behind, mark));
}
{
  const behind = lensAt("MUSEUM_1F", 13, 4, { facing: "left" });
  const mark = behind.pages.length;
  behind.run([{ press: "a" }]);
  drive(behind, false);
  check("and no gets the explanation", said(behind, mark).indexOf("tree sap") >= 0,
        said(behind, mark));
}
{
  const below = lensAt("MUSEUM_1F", 12, 5, { facing: "up" });
  const mark = below.pages.length;
  below.run([{ press: "a" }]);
  drive(below, true);
  check("from anywhere else, round to the front please",
        said(below, mark).indexOf("other side") >= 0, said(below, mark));
}

console.log("== The OLD AMBER ==");
{
  const lens = lensAt("MUSEUM_1F", 15, 3, { facing: "up" });
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  drive(lens, true);
  check("he hands it over", lens.play.flags.EVENT_GOT_OLD_AMBER === true, said(lens, mark));
  check("and it is in the bag",
        lens.play.bag.some((b) => (b.item || b.id) === "OLD_AMBER"), JSON.stringify(lens.play.bag));
  check("the exhibit comes off the shelf with it",
        lens.play.objectToggles["MUSEUM_1F:MUSEUM1F_OLD_AMBER"] === false,
        JSON.stringify(lens.play.objectToggles));
  const again = lens.pages.length;
  lens.run([{ press: "a" }]);
  drive(lens, true);
  check("and afterwards he only tells you to get it checked",
        said(lens, again).indexOf("checked") >= 0, said(lens, again));
}

console.log("== The ticket is good for one visit ==");
{
  const outside = lensAt("PEWTER_CITY", 16, 17, { flags: ["EVENT_BOUGHT_MUSEUM_TICKET", "EVENT_BEAT_BROCK"] });
  check("stepping out into Pewter voids it",
        outside.play.flags.EVENT_BOUGHT_MUSEUM_TICKET !== true);
  const elsewhere = lensAt("MUSEUM_1F", 9, 6, { flags: ["EVENT_BOUGHT_MUSEUM_TICKET"] });
  check("while inside, it holds", elsewhere.play.flags.EVENT_BOUGHT_MUSEUM_TICKET === true);
}

console.log("\nMUSEUM " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
