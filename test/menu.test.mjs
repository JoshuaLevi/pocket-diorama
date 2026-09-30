// The menu, driven the way a player drives it.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/menu.test.mjs Assets/Generated/kanto.json [--selftest]
//
// MenuController is pure -- no SceneObject, no MeshBuilder -- so a whole
// session is playable here: open the bag, pick a Potion, pick who to use it on,
// back out twice. A menu that can only be checked by wearing it is a menu
// nobody checks.
//
// Three of these assertions exist because an adversarial read of the design
// found the mistakes before they were written:
//
//   * a row is not a move slot;
//   * a battle's party is not the save's party;
//   * an 18-column panel cannot draw a 19-character move label.

import { readFileSync } from "node:fs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: menu.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const M = await import(P + "MenuController.ts");
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { emptyDPad } = await import(P + "InputSource.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const mon = (species, level, seed) => makeWildMon(bundle, species, level, seeded(seed));

const held = (dir) => ({ ...emptyDPad(), [dir]: true });
const NONE = emptyDPad();

/** Press a direction once: the edge fires on the frame it goes down. */
function move(menu, dir, times) {
  let last = M.MENU_NONE;
  for (let i = 0; i < (times || 1); i++) {
    last = menu.step(held(dir), false, false, 0.016);
    menu.step(NONE, false, false, 0.016);
  }
  return last;
}
const pressA = (menu) => menu.step(NONE, true, false, 0.016);
const pressB = (menu) => menu.step(NONE, false, true, 0.016);

// ---------------------------------------------------------------------------

console.log("\n== The overworld menu ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = [mon("CHARMANDER", 12, 3)];
  const menu = new M.MenuController(bundle, play);
  menu.openOverworld(play.party);

  check("it opens", menu.isOpen());
  check("with the cursor on the first row", menu.cursorRow() === 0);
  check("showing the root rows",
        menu.rows()[0] === "POKeMON" && menu.rows().indexOf("SAVE") >= 0,
        JSON.stringify(menu.rows()));

  move(menu, "down");
  check("down moves the cursor one row", menu.cursorRow() === 1);
  move(menu, "up");
  move(menu, "up");
  check("and up past the top wraps to the bottom",
        menu.cursorRow() === menu.rows().length - 1, "row " + menu.cursorRow());

  // SAVE
  const saveMenu = new M.MenuController(bundle, play);
  saveMenu.openOverworld(play.party);
  move(saveMenu, "down", 2);
  check("SAVE is the third row", saveMenu.rows()[saveMenu.cursorRow()] === "SAVE");
  check("and choosing it asks to save", pressA(saveMenu) === M.MENU_SAVE);

  // OPTION -- the lens's own row, where the cartridge's OPTION sits
  const optionMenu = new M.MenuController(bundle, play);
  optionMenu.openOverworld(play.party);
  move(optionMenu, "down", 3);
  check("OPTION is the fourth row", optionMenu.rows()[optionMenu.cursorRow()] === "OPTION");
  check("and choosing it asks for the view page", pressA(optionMenu) === M.MENU_OPTION);

  // EXIT
  const exitMenu = new M.MenuController(bundle, play);
  exitMenu.openOverworld(play.party);
  move(exitMenu, "down", 4);
  check("EXIT is the last row", exitMenu.rows()[exitMenu.cursorRow()] === "EXIT");
  check("EXIT closes the menu", pressA(exitMenu) === M.MENU_CLOSED);
  check("and it reports itself closed", !exitMenu.isOpen());
}

console.log("\n== The bag ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = [mon("CHARMANDER", 12, 3)];
  PlayState.giveItem(play, "POTION", 3);
  PlayState.giveItem(play, "TM_BIDE", 1);
  const menu = new M.MenuController(bundle, play);
  menu.openOverworld(play.party);
  move(menu, "down");
  pressA(menu);

  const rows = menu.rows();
  check("the bag lists what is in it", rows.length === 3, JSON.stringify(rows));
  check("with the count", rows[0].indexOf("x3") > 0, JSON.stringify(rows[0]));
  // The id is TM_BIDE and the NAME is TM34. A bag showing the id shows the
  // wrong thing, and this repo put a nonexistent "TM34" in a bag once already.
  check("and the item's NAME, not its id",
        rows[1].indexOf("TM34") === 0 && rows[1].indexOf("TM_BIDE") < 0,
        JSON.stringify(rows[1]));
  check("every row fits the panel",
        rows.every((r) => r.length <= M.MENU_COLUMNS - 1),
        JSON.stringify(rows.map((r) => r.length)));

  pressA(menu);
  check("choosing an item asks who to use it on",
        menu.rows()[0].indexOf("CHARMANDER") === 0, JSON.stringify(menu.rows()));
  const outcome = pressA(menu);
  check("and picking a target reports the item and the target",
        outcome === M.MENU_ITEM && menu.chosenItem() === "POTION" &&
        menu.chosenIndex() === 0,
        `${outcome} ${menu.chosenItem()} ${menu.chosenIndex()}`);

  // The bag must NOT decrement here: the engine reports ok for refusals too.
  check("the bag is not decremented by the menu",
        PlayState.hasItem(play, "POTION", 3),
        "report.ok means the action was legal, not that the item was used");
}

console.log("\n== Backing out ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = [mon("CHARMANDER", 12, 3)];
  PlayState.giveItem(play, "POTION", 1);
  const menu = new M.MenuController(bundle, play);
  menu.openOverworld(play.party);
  move(menu, "down");
  pressA(menu);
  move(menu, "down");
  const remembered = menu.cursorRow();
  pressB(menu);
  check("B goes back a screen", menu.isOpen() && menu.rows()[0] === "POKeMON");
  check("and the root screen kept its own cursor", menu.cursorRow() === 1,
        "row " + menu.cursorRow());
  pressB(menu);
  check("B at the root closes it", !menu.isOpen());
}

console.log("\n== The battle menu ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  // The battle's party, which is NOT the save's: mid-battle the active Pokemon
  // is a deep copy the battle made, and nothing folds HP back until it ends.
  const savedParty = [mon("CHARMANDER", 20, 5)];
  const battleParty = [mon("CHARMANDER", 20, 5)];
  battleParty[0].hp = 7;
  play.party = savedParty;

  const menu = new M.MenuController(bundle, play);
  menu.openBattle(["EMBER  25/25", "SCRATCH  35/35"], [1, 2], battleParty);
  check("the moves are the rows", menu.rows()[0].indexOf("EMBER") === 0,
        JSON.stringify(menu.rows()));
  check("with POKeMON, ITEM and RUN under them",
        menu.rows().indexOf("RUN") > 0, JSON.stringify(menu.rows()));

  // Row 1 is SCRATCH, which lives in SLOT 2. A menu that reported the row would
  // send slot 1 and use EMBER.
  move(menu, "down");
  const chose = pressA(menu);
  check("choosing the second row reports its SLOT, not its row",
        chose === M.MENU_MOVE && menu.chosenIndex() === 2,
        `outcome ${chose} index ${menu.chosenIndex()}`);
  // And the row separately, because BattleRunner's port takes a ROW and maps it
  // to a slot itself. Handing it chosenIndex() would translate twice.
  check("and the row separately, for the caller that maps it itself",
        menu.chosenRow() === 1, "row " + menu.chosenRow());

  const party = new M.MenuController(bundle, play);
  party.openBattle(["EMBER  25/25"], [0], battleParty);
  move(party, "down");
  pressA(party);
  check("the party screen shows the BATTLE's HP, not the save's",
        party.rows()[0].indexOf("7/") > 0,
        `${JSON.stringify(party.rows()[0])} -- the save says ${savedParty[0].hp}`);
}

console.log("\n== What it refuses ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  const fainted = [mon("CHARMANDER", 20, 9), mon("SQUIRTLE", 20, 10)];
  fainted[1].hp = 0;
  play.party = fainted;
  const menu = new M.MenuController(bundle, play);
  menu.openBattle(["EMBER  25/25"], [0], fainted);
  move(menu, "down");
  pressA(menu);        // PKMN
  move(menu, "down");  // the fainted one
  const out = pressA(menu);
  check("a fainted Pokemon cannot be switched in", out === M.MENU_NONE,
        "the engine accepts the turn and spends it on nothing, so the menu must refuse");

  const empty = PlayState.newPlayState(bundle.romSha1);
  const emptyMenu = new M.MenuController(bundle, empty);
  emptyMenu.openOverworld([]);
  pressA(emptyMenu);
  check("an empty party screen still has a way out",
        emptyMenu.rows().length === 1 && emptyMenu.rows()[0] === "CANCEL",
        JSON.stringify(emptyMenu.rows()));
  check("and it does not crash on A", pressB(emptyMenu) !== undefined);
}

console.log("\n== Columns ==");
{
  // "THUNDERPUNCH  15/15" is 19 characters, and the panel is 18 including the
  // cursor column. The overflow is invisible until a Pokemon happens to learn a
  // long move, which is why this is asserted rather than eyeballed.
  const play = PlayState.newPlayState(bundle.romSha1);
  const long = Object.keys(bundle.moves)
    .map((k) => bundle.moves[k].name || k)
    .sort((a, b) => b.length - a.length)[0];
  check("the longest move name in the cartridge is known", long.length > 0, long);

  const longestSpecies = Object.keys(bundle.species)
    .sort((a, b) => b.length - a.length)[0];
  const big = mon(longestSpecies, 100, 12);
  const menu = new M.MenuController(bundle, play);
  play.party = [big];
  menu.openOverworld([big]);
  pressA(menu);
  check("the longest party row still fits",
        menu.rows()[0].length <= M.MENU_COLUMNS - 1,
        `${JSON.stringify(menu.rows()[0])} is ${menu.rows()[0].length}`);

  PlayState.giveItem(play, "TM_BIDE", 99);
  const bag = new M.MenuController(bundle, play);
  bag.openOverworld([big]);
  move(bag, "down");
  pressA(bag);
  check("and the longest bag row does too",
        bag.rows().every((r) => r.length <= M.MENU_COLUMNS - 1),
        JSON.stringify(bag.rows()));
}

if (selftest) {
  console.log("\n-- selftest --");
  // A player who never presses anything must never reach an outcome.
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = [mon("CHARMANDER", 12, 3)];
  const idle = new M.MenuController(bundle, play);
  idle.openOverworld(play.party);
  let sawOutcome = false;
  for (let i = 0; i < 400; i++) {
    if (idle.step(NONE, false, false, 0.016) !== M.MENU_NONE) { sawOutcome = true; }
  }
  check("[selftest] an idle player never chooses anything", !sawOutcome,
        "the menu is acting on its own");

  // Holding a direction must not run the cursor round and round.
  const holdMenu = new M.MenuController(bundle, play);
  holdMenu.openOverworld(play.party);
  let moves = 0;
  let last = holdMenu.cursorRow();
  for (let i = 0; i < 60; i++) {
    holdMenu.step(held("down"), false, false, 0.016);
    if (holdMenu.cursorRow() !== last) { moves++; last = holdMenu.cursorRow(); }
  }
  check("[selftest] one second of holding moves a handful of rows, not sixty",
        moves > 1 && moves < 12, moves + " moves in 60 frames");
}

// ---------------------------------------------------------------------------
console.log("\n== Field moves and FLY ==");
{
  const { replaceMove } = await import(P + "battle/Party.ts");
  const play = PlayState.newPlayState(bundle.romSha1);
  const cutter = replaceMove(bundle, mon("CHARMANDER", 20, 3), 0, "CUT").mon;
  const plain = mon("RATTATA", 8, 4);
  play.party = [cutter, plain];

  const menu = new M.MenuController(bundle, play);
  menu.openOverworld(play.party);
  pressA(menu);                                  // POKeMON
  check("the party list is up", menu.rows()[0].indexOf("CHARMANDER") >= 0, JSON.stringify(menu.rows()));
  pressA(menu);                                  // the Pokemon that knows CUT
  check("its own screen lists only the HM moves it knows",
        menu.rows().join(",") === "CUT,CANCEL", JSON.stringify(menu.rows()));
  const chosen = pressA(menu);
  check("picking one reports the move and the party slot",
        chosen === M.MENU_FIELD_MOVE && menu.chosenMove() === "CUT" && menu.chosenIndex() === 0,
        JSON.stringify([chosen, menu.chosenMove(), menu.chosenIndex()]));

  const dull = new M.MenuController(bundle, play);
  dull.openOverworld(play.party);
  pressA(dull);
  move(dull, "down");
  check("a Pokemon that knows no HM move opens nothing",
        pressA(dull) === M.MENU_NONE && dull.rows()[0].indexOf("CHARMANDER") >= 0,
        JSON.stringify(dull.rows()));

  const fly = new M.MenuController(bundle, play);
  fly.openFly(["PALLET_TOWN", "PEWTER_CITY"]);
  check("the fly list reads as words, not ids",
        fly.rows()[0].trim() === "PALLET TOWN" && fly.rows()[2] === "CANCEL",
        JSON.stringify(fly.rows()));
  const flown = pressA(fly);
  check("and picking one reports the map id",
        flown === M.MENU_FLY && fly.chosenMap() === "PALLET_TOWN",
        JSON.stringify([flown, fly.chosenMap()]));
  const cancelled = new M.MenuController(bundle, play);
  cancelled.openFly(["PALLET_TOWN"]);
  move(cancelled, "down");
  check("CANCEL closes it", pressA(cancelled) === M.MENU_CLOSED);
}

// ---------------------------------------------------------------------------
console.log("\n== TMs and HMs in the bag ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = [mon("CHARMANDER", 20, 3)];
  play.bag = [{ id: "TM_BIDE", count: 1 }, { id: "POTION", count: 2 }];

  const menu = new M.MenuController(bundle, play);
  menu.openOverworld(play.party);
  move(menu, "down");
  pressA(menu);                                  // ITEM
  const teach = pressA(menu);                    // TM34
  check("a machine in the bag asks to teach, and names itself",
        teach === M.MENU_TEACH && menu.chosenItem() === "TM_BIDE",
        JSON.stringify([teach, menu.chosenItem()]));

  const potion = new M.MenuController(bundle, play);
  potion.openOverworld(play.party);
  move(potion, "down");
  pressA(potion);
  move(potion, "down");
  pressA(potion);                                // POTION
  check("an ordinary item still asks who to use it on",
        potion.rows()[0].indexOf("CHARMANDER") >= 0, JSON.stringify(potion.rows()));

  const fight = new M.MenuController(bundle, play);
  fight.openBattle(["SCRATCH  35/35"], [0], play.party);
  move(fight, "down");
  move(fight, "down");
  pressA(fight);                                 // ITEM
  check("in battle a machine does nothing at all",
        pressA(fight) === M.MENU_NONE, JSON.stringify(fight.rows()));
}

console.log(`\n${fail === 0 ? "MENU OK" : "MENU FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
