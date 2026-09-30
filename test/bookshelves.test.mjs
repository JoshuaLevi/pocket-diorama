// What is written on the walls: bookshelves, posters, notebooks and statues.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/bookshelves.test.mjs Assets/Generated/kanto.json
//
// The tile table is bank 3 $7B8B and the wall objects are bank $11's hidden
// object lists, both read out of the cartridge on 12 September 2026. What is
// asserted: every tile the table names really occurs in a map of that tileset,
// every wall object sits inside its map and names a text the bundle has, and
// the lens says the right thing when stood in front of each kind.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const B = await import(P + "script/Bookshelves.ts");
const { BOOKSHELF_TILES, WALL_OBJECTS, bookshelfKind, bookshelfScript, wallScript, notebookScript,
        SHELF_STATUES, SHELF_TOWN_MAP, SHELF_BOOKS, SHELF_ELEVATOR, SHELF_STUFF,
        WALL_TEXT,
        BLACKBOARD_TOPICS, BLACKBOARD_TEXTS, LINK_TOPICS, LINK_TEXTS, NOTEBOOK_TEXTS,
        TEXT_TURN_PAGE, TEXT_TOWN_MAP, TEXT_BOOKS, TEXT_SCULPTURE, TEXT_ELEVATOR, TEXT_STUFF,
        TEXT_STATUES_1, TEXT_STATUES_2, TEXT_STATUES_3, TEXT_OAK_POSTER_EARLY, TEXT_OAK_POSTER_LATE,
        SCULPTURE_TILE, SCULPTURE_TILESET } = B;
const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: bookshelves.test.mjs <bundle.json>");
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
const text = (id) => (bundle.text[id] || "").replace(/\s+/g, " ");

function lensAt(map, x, y, facing, opts) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.mapId = map;
  state.cellX = x;
  state.cellY = y;
  state.facing = facing;
  state.flags.EVENT_INTRO_DONE = true;
  state.flags.EVENT_GOT_STARTER = true;
  state.party.push(makeWildMon(bundle, "CHARMANDER", 12, () => 0.5));
  const lens = new HeadlessLens(bundle, Object.assign({ state: state, wanderers: false, noWild: true }, opts || {}));
  lens.clearText();
  lens.settle();
  return lens;
}
/** Presses A once, then pages through, answering every question with `answer`. */
function ask(lens, answer, cap) {
  const mark = lens.pages.length;
  lens.run([{ press: "a" }]);
  let n = 0;
  while ((lens.loop.isBusy() || lens.pageWaiting) && n < (cap || 3000)) {
    if (lens.pageWaiting && lens.loop.textReady()) {
      lens.press(lens.answerWanted && answer === false ? "b" : "a");
      n += 12;
      continue;
    }
    lens.frame();
    n++;
  }
  lens.settle();
  return lens.pages.slice(mark).join(" ").replace(/\s+/g, " ");
}
/** A cell whose bottom-left tile is `tile`, standing room below it, on a map of `tileset`. */
function cellUnder(tileset, tile, wantAbove) {
  for (const id of Object.keys(bundle.maps)) {
    const def = bundle.maps[id];
    if (def.tileset !== tileset) { continue; }
    const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
    for (let cy = 0; cy < def.height * 2; cy++) {
      for (let cx = 0; cx < def.width * 2; cx++) {
        if (map.tileAt(cx * 2, cy * 2 + 1) !== tile) { continue; }
        if (wantAbove !== undefined && map.tileAt(cx * 2, cy * 2) !== wantAbove) { continue; }
        if (cy + 1 < def.height * 2 && map.isWalkable(cx, cy + 1)) {
          return { map: id, x: cx, y: cy + 1 };
        }
      }
    }
  }
  return null;
}
const head = (id) => text(id).slice(0, 12);

console.log("== The tile table ==");
{
  check("seventeen rows", BOOKSHELF_TILES.length === 17, BOOKSHELF_TILES.length);
  const kinds = [SHELF_STATUES, SHELF_TOWN_MAP, SHELF_BOOKS, SHELF_ELEVATOR, SHELF_STUFF];
  check("five kinds, all used", kinds.every((k) => BOOKSHELF_TILES.some((r) => r.kind === k)));
  const unknownTileset = BOOKSHELF_TILES.filter((r) => !bundle.tilesets[r.tileset]);
  check("every tileset is one the bundle has", unknownTileset.length === 0, JSON.stringify(unknownTileset));
  const unseen = [];
  for (const row of BOOKSHELF_TILES) {
    let found = false;
    for (const id of Object.keys(bundle.maps)) {
      const def = bundle.maps[id];
      if (def.tileset !== row.tileset) { continue; }
      const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
      for (let cy = 0; cy < def.height * 2 && !found; cy++) {
        for (let cx = 0; cx < def.width * 2; cx++) {
          if (map.tileAt(cx * 2, cy * 2 + 1) === row.tile) { found = true; break; }
        }
      }
      if (found) { break; }
    }
    if (!found) { unseen.push(row.tileset + ":" + row.tile.toString(16)); }
  }
  // Two rows are dead on the cartridge as well: no POKECENTER map places
  // tile $54 or $55, so those shelves can never be read there. The rows stay
  // because they are the cartridge's; the test says which ones are dead.
  check("every live row's tile stands somewhere in a map of that tileset, and only the two POKECENTER rows are dead",
        unseen.length === 2 && unseen.every((u) => u.indexOf("POKECENTER:") === 0), JSON.stringify(unseen));
  check("the eight texts exist", [TEXT_TOWN_MAP, TEXT_BOOKS, TEXT_SCULPTURE, TEXT_ELEVATOR, TEXT_STUFF,
        TEXT_STATUES_1, TEXT_STATUES_2, TEXT_STATUES_3].every((t) => bundle.text[t]));
  check("only facing up reads a shelf", bookshelfScript("HOUSE", 0x3d, 0, "down", 0) === null &&
        bookshelfScript("HOUSE", 0x3d, 0, "up", 0) !== null);
  check("a tile the table does not name says nothing", bookshelfScript("HOUSE", 0x01, 0, "up", 0) === null &&
        bookshelfKind("OVERWORLD", 0x3d) === "");
  const odd = bookshelfScript("PLATEAU", 0x30, 0, "up", 9);
  const even = bookshelfScript("PLATEAU", 0x30, 0, "up", 10);
  check("the statues say their first line and then one of two",
        odd[0].textId === TEXT_STATUES_1 && odd[1].textId === TEXT_STATUES_2 && even[1].textId === TEXT_STATUES_3,
        JSON.stringify([odd, even]));
  check("a MANSION shelf with the sculpture tile over it is the DIGLETT",
        bookshelfScript(SCULPTURE_TILESET, 0x32, SCULPTURE_TILE, "up", 0)[0].textId === TEXT_SCULPTURE &&
        bookshelfScript(SCULPTURE_TILESET, 0x32, 0x00, "up", 0)[0].textId === TEXT_BOOKS);
}

console.log("\n== The wall objects ==");
{
  check("twenty-five of them", WALL_OBJECTS.length === 25, WALL_OBJECTS.length);
  const bad = [];
  for (const w of WALL_OBJECTS) {
    const def = bundle.maps[w.map];
    if (!def) { bad.push(w.map + " missing"); continue; }
    if (w.x < 0 || w.y < 0 || w.x >= def.width * 2 || w.y >= def.height * 2) { bad.push(w.map + " " + w.x + "," + w.y + " off the map"); }
    if (w.kind === WALL_TEXT && !bundle.text[w.text]) { bad.push(w.map + " " + w.text + " no such text"); }
  }
  check("every one sits on its map and names a text the bundle has", bad.length === 0, JSON.stringify(bad));
  check("the boards' texts exist", BLACKBOARD_TEXTS.concat(LINK_TEXTS).concat(NOTEBOOK_TEXTS).concat([TEXT_TURN_PAGE,
        TEXT_OAK_POSTER_EARLY, TEXT_OAK_POSTER_LATE]).every((t) => bundle.text[t]));
  check("the blackboard has six topics for five texts and a way out",
        BLACKBOARD_TOPICS.length === 6 && BLACKBOARD_TEXTS.length === 5 && BLACKBOARD_TOPICS[5] === "QUIT");
  check("the link board has three topics and STOP", LINK_TOPICS.length === 4 && LINK_TEXTS.length === 3 && LINK_TOPICS[3] === "STOP");
  check("an object that needs facing up ignores a sideways press",
        wallScript("OAKS_LAB", 0, 1, "left", 0) === null && wallScript("OAKS_LAB", 0, 1, "up", 0) !== null);
  check("and one that does not answers from any side",
        wallScript("REDS_HOUSE_2F", 3, 5, "left", 0) !== null && wallScript("REDS_HOUSE_2F", 3, 5, "down", 0) !== null);
  check("OAK's second poster changes its mind at two species",
        wallScript("OAKS_LAB", 5, 0, "up", 1)[0].textId === TEXT_OAK_POSTER_EARLY &&
        wallScript("OAKS_LAB", 5, 0, "up", 2)[0].textId === TEXT_OAK_POSTER_LATE);
  const nb = notebookScript();
  check("the notebook asks three times and turns the last page unasked",
        nb.filter((c) => c.op === "ask").length === 3 && nb.filter((c) => c.op === "show_text").length === 5);
}

console.log("\n== Standing in front of them ==");
{
  const snes = lensAt("REDS_HOUSE_2F", 3, 6, "up");
  const said = ask(snes, true);
  check("the SNES in RED's room", said.indexOf("SNES") >= 0, said);

  const shelf = lensAt("BLUES_HOUSE", 7, 2, "up");
  check("BLUE's bookcase", ask(shelf, true).indexOf("books") >= 0, shelf.pages.join(" "));

  const dojo = lensAt("FIGHTING_DOJO", 4, 1, "up");
  const scroll = ask(dojo, true);
  check("the DOJO's scroll", scroll.toLowerCase().indexOf("enemies") >= 0, scroll);

  const closed = lensAt("VIRIDIAN_SCHOOL_HOUSE", 3, 5, "up");
  const one = ask(closed, false);
  check("the notebook, shut after one page", one.indexOf(head(NOTEBOOK_TEXTS[0])) >= 0 &&
        one.indexOf(head(NOTEBOOK_TEXTS[1])) < 0, one.slice(0, 160));
  const open = lensAt("VIRIDIAN_SCHOOL_HOUSE", 3, 5, "up");
  const all = ask(open, true);
  check("...and read to the end when the page is turned", NOTEBOOK_TEXTS.every((t) => all.indexOf(head(t)) >= 0),
        all.slice(-160));

  const quit = lensAt("VIRIDIAN_SCHOOL_HOUSE", 3, 1, "up", { choice: 5 });
  const board = ask(quit, true);
  check("the blackboard's first page", board.indexOf(head("_ViridianSchoolBlackboardText1")) >= 0, board.slice(0, 120));
  check("and its menu of six", quit.events.some((e) => e.indexOf("choice:") === 0 && e.indexOf(BLACKBOARD_TOPICS.join(",")) > 0),
        JSON.stringify(quit.events.filter((e) => e.indexOf("choice") === 0)));
  check("QUIT closes it", !quit.loop.isBusy());
  const sleep = lensAt("VIRIDIAN_SCHOOL_HOUSE", 3, 1, "up", { choice: 0 });
  const slp = ask(sleep, true, 800);
  check("SLP reads the sleep heading", slp.indexOf(head(BLACKBOARD_TEXTS[0])) >= 0, slp.slice(0, 200));
  check("and the menu comes back for the next", sleep.events.filter((e) => e.indexOf("choice:") === 0).length >= 2,
        sleep.events.filter((e) => e.indexOf("choice:") === 0).length);

  const link = lensAt("CELADON_MANSION_ROOF_HOUSE", 3, 1, "up", { choice: 1 });
  const cable = ask(link, true, 800);
  check("the link-cable board's COLOSSEUM heading", cable.indexOf(head(LINK_TEXTS[1])) >= 0, cable.slice(0, 200));
  const tm = lensAt("CELADON_MANSION_ROOF_HOUSE", 3, 5, "up");
  check("the TM notebook on the table", ask(tm, true).indexOf(head("TMNotebookText")) >= 0, tm.pages.join(" ").slice(0, 120));

  // The shelves, found by their tiles rather than typed in.
  const townMap = cellUnder("HOUSE", 0x3d);
  check("a HOUSE wall with a town map exists", townMap !== null, JSON.stringify(townMap));
  if (townMap) {
    const l = lensAt(townMap.map, townMap.x, townMap.y, "up");
    check("...and says A TOWN MAP", ask(l, true).indexOf("TOWN MAP") >= 0, l.pages.join(" "));
  }
  const goods = cellUnder("MART", 0x54) || cellUnder("MART", 0x55);
  check("a MART shelf exists", goods !== null, JSON.stringify(goods));
  if (goods) {
    const l = lensAt(goods.map, goods.x, goods.y, "up");
    const g = ask(l, true);
    check("...full of POKeMON goods", g.indexOf(head(TEXT_STUFF)) >= 0, g);
  }
  const sculpture = cellUnder(SCULPTURE_TILESET, 0x32, SCULPTURE_TILE);
  check("the DIGLETT sculpture stands in the mansion", sculpture !== null, JSON.stringify(sculpture));
  if (sculpture) {
    const l = lensAt(sculpture.map, sculpture.x, sculpture.y, "up");
    check("...and is a sculpture, not a shelf", ask(l, true).indexOf("DIGLETT") >= 0, l.pages.join(" "));
  }
  const statue = cellUnder("PLATEAU", 0x30);
  check("the plateau has its statues", statue !== null, JSON.stringify(statue));
  if (statue) {
    const l = lensAt(statue.map, statue.x, statue.y, "up");
    const s = ask(l, true);
    const second = (statue.x & 1) === 1 ? TEXT_STATUES_2 : TEXT_STATUES_3;
    check("...and the column decides the second line", s.indexOf(text(TEXT_STATUES_1).slice(0, 10)) >= 0 &&
          s.indexOf(text(second).slice(0, 10)) >= 0, s);
  }
  const nothing = lensAt("REDS_HOUSE_2F", 3, 6, "down");
  check("facing the floor says nothing", ask(nothing, true) === "", nothing.pages.join(" "));
}

console.log("\nBOOKSHELVES " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
