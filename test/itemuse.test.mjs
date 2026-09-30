// Using an item outside a battle, against engine/items/item_effects.asm.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/itemuse.test.mjs Assets/Generated/kanto.json
//
// Until ItemUse.ts, the bag could be opened on the overworld and every item
// picked, and then the menu closed. Each section below names the routine it
// was read against; the numbers -- 20 HP for a POTION, 2560 stat experience
// for a vitamin, 100 steps for a REPEL -- are the cartridge's.

import { readFileSync } from "node:fs";
import { makeServices, shownText } from "./fakeservices.mjs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: itemuse.test.mjs <bundle.json>");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const { Overworld } = await import(P + "Overworld.ts");
const { PlayLoop } = await import(P + "PlayLoop.ts");
const PlayState = await import(P + "PlayState.ts");
const ItemUse = await import(P + "ItemUse.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const { STATUS_POISON, STATUS_BURN, STATUS_NONE } = await import(P + "battle/types.ts");
const { expForLevel } = await import(P + "battle/Party.ts");
const { MenuController, MENU_ITEM, MENU_NONE } = await import(P + "MenuController.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

/** A loop and a world on a map, with a party and a bag. */
function stage(mapId, x, y, opts) {
  const o = opts || {};
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.party = o.party ? o.party : [makeWildMon(bundle, "CHARMANDER", 12, () => 0.5)];
  state.bag = [];
  for (const id of (o.bag || [])) { PlayState.giveItem(state, id, 1); }
  if (o.respawnTown !== undefined) { state.respawnLastMapId = o.respawnTown; }
  const services = makeServices(bundle, mapId, {});
  const loop = new PlayLoop(bundle, state, services);
  const world = new Overworld(bundle, mapId, x, y, () => 0.99);
  services.setWorld(world);
  loop.attach(world);
  loop.bindWorld(world);
  return { state, services, loop, world };
}

function pump(loop) {
  for (let i = 0; i < 300 && loop.isBusy(); i++) { loop.update(); }
}

function has(state, id) {
  return state.bag.some((b) => b.id === id);
}

function said(services) {
  return shownText(services).join(" | ");
}

// ---------------------------------------------------------------------------
console.log("== Medicine: .healHP ==");
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["POTION"] });
  const mon = t.state.party[0];
  mon.hp = 1;
  const out = t.loop.useItem(t.world, "POTION", 0);
  pump(t.loop);
  check("a POTION heals 20", out !== null && mon.hp === 21, "hp " + mon.hp);
  check("and is spent", !has(t.state, "POTION"));
  check("with the cartridge's line and its HP number",
        said(t.services).indexOf("recovered by 20") >= 0, said(t.services));
  check("after the healing sound", t.services.log.indexOf("sound:Heal_HP") >= 0);
}
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["POTION"] });
  const out = t.loop.useItem(t.world, "POTION", 0);
  pump(t.loop);
  check("at full HP it won't have any effect", said(t.services).indexOf("won't have any") >= 0,
        said(t.services));
  check("and the POTION stays", has(t.state, "POTION") && out.consumed === false);
}
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["REVIVE", "POTION"] });
  const mon = t.state.party[0];
  mon.hp = 0;
  t.loop.useItem(t.world, "POTION", 0);
  pump(t.loop);
  check("a fainted Pokemon takes no POTION", mon.hp === 0 && has(t.state, "POTION"));
  const t2 = stage("MT_MOON_1F", 5, 5, { bag: ["REVIVE"] });
  const m2 = t2.state.party[0];
  m2.hp = 0;
  t2.loop.useItem(t2.world, "REVIVE", 0);
  pump(t2.loop);
  check("a REVIVE brings it to half", m2.hp === Math.floor(m2.maxHp / 2), m2.hp + "/" + m2.maxHp);
  check("with its own line", said(t2.services).indexOf("revitalized") >= 0, said(t2.services));
  const t3 = stage("MT_MOON_1F", 5, 5, { bag: ["REVIVE"] });
  t3.loop.useItem(t3.world, "REVIVE", 0);
  pump(t3.loop);
  check("and a standing Pokemon takes no REVIVE", has(t3.state, "REVIVE") &&
        said(t3.services).indexOf("won't have any") >= 0);
}
{
  // .compareCurrentHPToMaxHP: full HP + a status + FULL RESTORE -> a FULL HEAL.
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["FULL_RESTORE"] });
  const mon = t.state.party[0];
  mon.status = STATUS_BURN;
  t.loop.useItem(t.world, "FULL_RESTORE", 0);
  pump(t.loop);
  check("a FULL RESTORE at full HP cures the status instead",
        mon.status === STATUS_NONE && !has(t.state, "FULL_RESTORE") &&
        said(t.services).indexOf("health returned") >= 0, said(t.services));
}

console.log("== Medicine: .cureStatusAilment ==");
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["ANTIDOTE", "BURN_HEAL"] });
  const mon = t.state.party[0];
  mon.status = STATUS_POISON;
  t.loop.useItem(t.world, "BURN_HEAL", 0);
  pump(t.loop);
  check("a BURN HEAL does nothing for poison", mon.status === STATUS_POISON && has(t.state, "BURN_HEAL"));
  const t2 = stage("MT_MOON_1F", 5, 5, { bag: ["ANTIDOTE"] });
  const m2 = t2.state.party[0];
  m2.status = STATUS_POISON;
  t2.loop.useItem(t2.world, "ANTIDOTE", 0);
  pump(t2.loop);
  check("an ANTIDOTE cures it", m2.status === STATUS_NONE && !has(t2.state, "ANTIDOTE"));
  check("with the poison line and the ailment sound",
        said(t2.services).indexOf("cured of poison") >= 0 && t2.services.log.indexOf("sound:Heal_Ailment") >= 0,
        said(t2.services));
}

console.log("== Vitamins: .useVitamin ==");
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["PROTEIN"] });
  const mon = t.state.party[0];
  const before = mon.stats.attack;
  t.loop.useItem(t.world, "PROTEIN", 0);
  pump(t.loop);
  check("PROTEIN adds 2560 ATTACK stat experience", mon.evs.attack === 2560, "" + mon.evs.attack);
  check("and the stat is recomputed upward", mon.stats.attack > before, before + " -> " + mon.stats.attack);
  check("naming the stat the way the cartridge does",
        said(t.services).indexOf("ATTACK rose") >= 0, said(t.services));
  const t2 = stage("MT_MOON_1F", 5, 5, { bag: ["PROTEIN"] });
  t2.state.party[0].evs.attack = 25600;
  t2.loop.useItem(t2.world, "PROTEIN", 0);
  pump(t2.loop);
  check("at 25600 it is refused", t2.state.party[0].evs.attack === 25600 && has(t2.state, "PROTEIN"));
}

console.log("== RARE CANDY: .useRareCandy ==");
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["RARE_CANDY"] });
  const mon = t.state.party[0];
  mon.hp = 3;
  const oldMax = mon.maxHp;
  const out = t.loop.useItem(t.world, "RARE_CANDY", 0);
  pump(t.loop);
  check("one level", mon.level === 13, "" + mon.level);
  check("the experience that level starts at",
        mon.exp === expForLevel(bundle.species.CHARMANDER.growthRate, 13), "" + mon.exp);
  check("the gain in max HP is added to current HP, no more",
        mon.hp === 3 + (mon.maxHp - oldMax) && mon.maxHp > oldMax, mon.hp + "/" + mon.maxHp);
  check("the candy is spent", !has(t.state, "RARE_CANDY"));
  check("and it says grew to level 13",
        said(t.services).indexOf("grew to level 13") >= 0 && t.services.log.indexOf("sound:Level_Up") >= 0,
        said(t.services));
  check("and reports what the new level teaches, for the learn screen",
        out.learnIndex === 0 && Array.isArray(out.learn), JSON.stringify(out.learn));
}
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["RARE_CANDY"] });
  t.state.party[0].level = 100;
  t.loop.useItem(t.world, "RARE_CANDY", 0);
  pump(t.loop);
  check("level 100 is refused", t.state.party[0].level === 100 && has(t.state, "RARE_CANDY"));
}
{
  // TryEvolvingMon without the force flag: a level evolution due now is owed.
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["RARE_CANDY"], party: [makeWildMon(bundle, "CHARMANDER", 15, () => 0.5)] });
  const out = t.loop.useItem(t.world, "RARE_CANDY", 0);
  pump(t.loop);
  check("a candy that reaches the evolution level owes the evolution",
        out.evolveIndex === 0 && out.evolveTo === "CHARMELEON", JSON.stringify(out));
}

console.log("== Stones: ItemUseEvoStone ==");
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["MOON_STONE"], party: [makeWildMon(bundle, "CLEFAIRY", 10, () => 0.5)] });
  const out = t.loop.useItem(t.world, "MOON_STONE", 0);
  pump(t.loop);
  check("a MOON STONE on CLEFAIRY owes CLEFABLE", out.evolveIndex === 0 && out.evolveTo === "CLEFABLE",
        JSON.stringify(out));
  check("and is spent before the scene, as the cartridge does", !has(t.state, "MOON_STONE"));
  check("the ailment sound is the only thing said", t.services.log.indexOf("sound:Heal_Ailment") >= 0 &&
        said(t.services) === "", said(t.services));
}
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["MOON_STONE"] });
  const out = t.loop.useItem(t.world, "MOON_STONE", 0);
  pump(t.loop);
  check("on CHARMANDER it has no effect and stays", out.evolveTo === "" && has(t.state, "MOON_STONE") &&
        said(t.services).indexOf("won't have any") >= 0);
}
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["FIRE_STONE"], party: [makeWildMon(bundle, "EEVEE", 10, () => 0.5)] });
  const out = t.loop.useItem(t.world, "FIRE_STONE", 0);
  check("the stone picks which of EEVEE's three", out.evolveTo === "FLAREON", JSON.stringify(out));
}

console.log("== REPEL: ItemUseRepelCommon and TryDoWildEncounter ==");
{
  const t = stage("ROUTE_3", 10, 5, { bag: ["REPEL"] });
  const out = t.loop.useItem(t.world, "REPEL", -1);
  pump(t.loop);
  check("a REPEL is 100 steps", t.state.repelSteps === 100 && out.consumed === true, "" + t.state.repelSteps);
  check("and it says who used what", said(t.services).indexOf("RED used") >= 0 &&
        said(t.services).indexOf("REPEL!") >= 0, said(t.services));
  const t2 = stage("ROUTE_3", 10, 5, { bag: ["MAX_REPEL"] });
  t2.loop.useItem(t2.world, "MAX_REPEL", -1);
  check("a MAX REPEL is 250", t2.state.repelSteps === 250);
}
{
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party = [makeWildMon(bundle, "CHARMANDER", 12, () => 0.5)];
  state.repelSteps = 2;
  check("a wild Pokemon below the lead's level is kept away", ItemUse.repelBlocks(state, 5) === true);
  check("one at or above it is not", ItemUse.repelBlocks(state, 12) === false && ItemUse.repelBlocks(state, 20) === false);
  check("a step counts down", ItemUse.repelStep(state) === "" && state.repelSteps === 1);
  check("the last step says so", ItemUse.repelStep(state) === ItemUse.TEXT_REPEL_WORE_OFF && state.repelSteps === 0);
  check("and nothing after", ItemUse.repelStep(state) === "" && state.repelSteps === 0);
  state.party = [];
  state.repelSteps = 5;
  check("with no party nothing is blocked", ItemUse.repelBlocks(state, 1) === false);
}
{
  // The live tick: a walk on Route 3 counts steps off the REPEL.
  const t = stage("ROUTE_3", 10, 5, { bag: ["REPEL"] });
  t.loop.useItem(t.world, "REPEL", -1);
  pump(t.loop);
  const held = (d) => ({ dpad: () => ({ up: d === "up", down: d === "down", left: d === "left", right: d === "right" }),
                        pressedA: () => false, pressedB: () => false, pressedStart: () => false, activeName: () => "t" });
  const before = t.state.repelSteps;
  let landed = 0;
  for (let i = 0; i < 40 && landed < 3; i++) {
    const r = t.world.update(0.05, held("right"));
    t.loop.afterStep(t.world, r, false);
    if (r.landed) { landed++; }
  }
  check("three landings are three steps off the counter", landed === 3 && t.state.repelSteps === before - 3,
        before + " -> " + t.state.repelSteps + " after " + landed);
}

console.log("== ESCAPE ROPE: ItemUseEscapeRope ==");
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["ESCAPE_ROPE"], respawnTown: "ROUTE_4" });
  const out = t.loop.useItem(t.world, "ESCAPE_ROPE", -1);
  pump(t.loop);
  const spot = bundle.field.flyWarps.ROUTE_4;
  check("in a CAVERN it holds", out !== null && out.escape !== null && out.consumed === true);
  check("and lands on the fly spot of the last blackout map",
        out.escape.mapId === "ROUTE_4" && out.escape.x === spot.x && out.escape.y === spot.y, JSON.stringify(out.escape));
  check("through a fade and the warp", t.services.log.indexOf("fade:out") >= 0 &&
        t.services.log.some((l) => l.indexOf("warpTo:ROUTE_4:") === 0), JSON.stringify(t.services.log));
  check("the rope is spent", !has(t.state, "ESCAPE_ROPE"));
}
{
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["ESCAPE_ROPE"] });
  const out = t.loop.useItem(t.world, "ESCAPE_ROPE", -1);
  check("before any Center was used it is Pallet Town, in front of your house",
        out.escape.mapId === "PALLET_TOWN" && out.escape.x === 5 && out.escape.y === 6, JSON.stringify(out.escape));
}
{
  const t = stage("PEWTER_CITY", 20, 20, { bag: ["ESCAPE_ROPE"] });
  const out = t.loop.useItem(t.world, "ESCAPE_ROPE", -1);
  pump(t.loop);
  check("outdoors it is refused with OAK's line", out.escape === null && has(t.state, "ESCAPE_ROPE") &&
        said(t.services).indexOf("isn't the") >= 0, said(t.services));
  const a = stage("AGATHAS_ROOM", 5, 8, { bag: ["ESCAPE_ROPE"] });
  const oa = a.loop.useItem(a.world, "ESCAPE_ROPE", -1);
  check("and never in Agatha's room, whatever its tileset", oa.escape === null && has(a.state, "ESCAPE_ROPE"));
  check("the tileset list is the cartridge's five",
        ItemUse.ESCAPE_ROPE_TILESETS.join(",") === "FOREST,CEMETERY,CAVERN,FACILITY,INTERIOR");
}

console.log("== Battle items outside a battle: ItemUseNotTime ==");
{
  const t = stage("ROUTE_3", 10, 5, { bag: ["X_ATTACK", "POKE_BALL"] });
  const out = t.loop.useItem(t.world, "X_ATTACK", -1);
  pump(t.loop);
  check("an X ATTACK is OAK's line and stays", out.consumed === false && has(t.state, "X_ATTACK") &&
        said(t.services).indexOf("isn't the") >= 0, said(t.services));
}

console.log("== The bag knows which items ask for a target ==");
{
  check("medicine, vitamins, a candy and a stone do",
        ["POTION", "ANTIDOTE", "HP_UP", "RARE_CANDY", "MOON_STONE", "REVIVE"].every((i) => ItemUse.itemNeedsTarget(i)));
  check("a REPEL, a rope and an X item do not",
        ["REPEL", "ESCAPE_ROPE", "X_ATTACK"].every((i) => !ItemUse.itemNeedsTarget(i) && ItemUse.itemUsableOutside(i)));
  check("a rod is used at once too, and never on a party member",
        ["OLD_ROD", "GOOD_ROD", "SUPER_ROD"].every((i) => !ItemUse.itemNeedsTarget(i) && ItemUse.itemUsableOutside(i)));
  check("so is the BICYCLE, which has no target either",
        !ItemUse.itemNeedsTarget("BICYCLE") && ItemUse.itemUsableOutside("BICYCLE"));
  check("so is the POKe FLUTE, which is played where you stand",
        !ItemUse.itemNeedsTarget("POKE_FLUTE") && ItemUse.itemUsableOutside("POKE_FLUTE"));
  check("and the rest of the key items are left alone",
        ["TOWN_MAP", "OAKS_PARCEL", "COIN_CASE"].every((i) => !ItemUse.itemUsableOutside(i)));
  check("the five PP items ask for a Pokemon like any medicine",
        ["ETHER", "MAX_ETHER", "ELIXER", "MAX_ELIXER", "PP_UP"].every((i) => ItemUse.itemNeedsTarget(i) && ItemUse.itemUsableOutside(i)));
}

console.log("== ETHER, ELIXER and PP UP: ItemUsePPRestore, ItemUsePPUp ==");
{
  const Pp = await import(P + "battle/PpItems.ts");
  const drained = () => {
    const mon = makeWildMon(bundle, "CHARMANDER", 12, () => 0.5);
    mon.moves = [
      { id: "SCRATCH", pp: 3, maxPp: 35 }, { id: "GROWL", pp: 40, maxPp: 40 },
      { id: "EMBER", pp: 0, maxPp: 25 }, { id: "", pp: 0, maxPp: 0 },
    ];
    return mon;
  };
  const mon = drained();
  const ether = Pp.restorePp(mon, "ETHER", 0);
  check("an ETHER gives one move ten", ether.used && ether.mon.moves[0].pp === 13 && ether.mon.moves[2].pp === 0 &&
        ether.textId === "_PPRestoredText", JSON.stringify(ether.mon.moves));
  check("and the Pokemon handed in is not written to", mon.moves[0].pp === 3);
  check("a MAX ETHER fills that one move", Pp.restorePp(mon, "MAX_ETHER", 2).mon.moves[2].pp === 25);
  const elixer = Pp.restorePp(mon, "ELIXER", -1);
  check("an ELIXER gives every move ten, and no more than its maximum",
        elixer.mon.moves[0].pp === 13 && elixer.mon.moves[1].pp === 40 && elixer.mon.moves[2].pp === 10, JSON.stringify(elixer.mon.moves));
  const maxed = Pp.restorePp(mon, "MAX_ELIXER", -1).mon.moves;
  check("a MAX ELIXER fills them all", maxed[0].pp === 35 && maxed[1].pp === 40 && maxed[2].pp === 25);
  check("a full move is refused, and so is an empty slot",
        !Pp.restorePp(mon, "ETHER", 1).used && !Pp.restorePp(mon, "MAX_ETHER", 3).used && Pp.restorePp(mon, "ETHER", 1).textId === "");
  check("only three of them ask which technique", ["ETHER", "MAX_ETHER", "PP_UP"].every((i) => Pp.ppItemNeedsMove(i)) &&
        !Pp.ppItemNeedsMove("ELIXER") && !Pp.ppItemNeedsMove("MAX_ELIXER"));

  // PP UP: a fifth of the base, three times; a move of 40 gets seven a time.
  let up = Pp.raiseMaxPp(bundle, mon, 0);
  check("a PP UP raises SCRATCH from 35 to 42, and its PP with it", up.used && up.mon.moves[0].maxPp === 42 && up.mon.moves[0].pp === 10 &&
        up.textId === "_PPIncreasedText" && up.move === "SCRATCH", JSON.stringify(up.mon.moves[0]));
  up = Pp.raiseMaxPp(bundle, up.mon, 0);
  up = Pp.raiseMaxPp(bundle, up.mon, 0);
  check("three of them is 56", up.mon.moves[0].maxPp === 56 && Pp.ppUpsUsed(35, 56) === 3);
  const fourth = Pp.raiseMaxPp(bundle, up.mon, 0);
  check("and a fourth is refused: maxed out", !fourth.used && fourth.textId === "_PPMaxedOutText" && fourth.mon.moves[0].maxPp === 56);
  let growl = Pp.raiseMaxPp(bundle, mon, 1);
  growl = Pp.raiseMaxPp(bundle, growl.mon, 1);
  growl = Pp.raiseMaxPp(bundle, growl.mon, 1);
  check("GROWL's forty tops out at 61, not 64", growl.mon.moves[1].maxPp === 61 && Pp.ppUpStep(40) === 7 &&
        !Pp.raiseMaxPp(bundle, growl.mon, 1).used, String(growl.mon.moves[1].maxPp));

  // Through the play loop, with the move the menu was pointed at.
  const t = stage("MT_MOON_1F", 5, 5, { bag: ["ETHER", "MAX_ELIXER", "PP_UP"], party: [drained()] });
  const out = t.loop.useItem(t.world, "ETHER", 0, 2);
  pump(t.loop);
  check("an ETHER on EMBER, from the bag", out.consumed && t.state.party[0].moves[2].pp === 10 && !has(t.state, "ETHER") &&
        said(t.services).indexOf("PP was restored") >= 0, said(t.services));
  const full = t.loop.useItem(t.world, "MAX_ELIXER", 0, -1);
  pump(t.loop);
  check("a MAX ELIXER needs no move", full.consumed && t.state.party[0].moves.slice(0, 3).every((m) => m.pp === m.maxPp));
  const t2 = stage("MT_MOON_1F", 5, 5, { bag: ["ETHER"], party: [drained()] });
  const none = t2.loop.useItem(t2.world, "ETHER", 0, 1);
  pump(t2.loop);
  check("an ETHER on a full move has no effect and stays in the bag", none.consumed === false && has(t2.state, "ETHER") &&
        said(t2.services).indexOf("any effect") >= 0, said(t2.services));
  const raise = t.loop.useItem(t.world, "PP_UP", 0, 0);
  pump(t.loop);
  check("a PP UP names the move it raised", raise.consumed && t.state.party[0].moves[0].maxPp === 42 &&
        said(t.services).indexOf("SCRATCH's PP") >= 0, said(t.services));

  // The menu: bag, then the Pokemon, then "which technique?".
  const NONE = { up: false, down: false, left: false, right: false };
  const DOWN = { up: false, down: true, left: false, right: false };
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = [drained()];
  play.bag = [];
  PlayState.giveItem(play, "ETHER", 1);
  const menu = new MenuController(bundle, play);
  menu.openOverworld(play.party);
  const a = () => menu.step(NONE, true, false, 0.016);
  const down = () => { menu.step(DOWN, false, false, 0.016); menu.step(NONE, false, false, 0.016); };
  down();              // ITEM
  a();                 // the bag
  a();                 // ETHER
  const afterMon = a(); // CHARMANDER
  check("picking the Pokemon opens its moves, not the item", afterMon === MENU_NONE &&
        menu.rows().length === 4 && menu.rows()[0].indexOf("SCRATCH") === 0 && menu.rows()[0].indexOf("3/35") > 0 &&
        menu.rows()[3] === "CANCEL", JSON.stringify(menu.rows()));
  down(); down();      // EMBER
  const chosen = a();
  check("and the move picked is a SLOT, with the item and the Pokemon",
        chosen === MENU_ITEM && menu.chosenItem() === "ETHER" && menu.chosenIndex() === 0 && menu.chosenRow() === 2,
        JSON.stringify({ chosen, item: menu.chosenItem(), mon: menu.chosenIndex(), slot: menu.chosenRow() }));

  // In a battle it costs the turn like any other item.
  const B = await import(P + "battle/BattleState.ts");
  const mine = drained();
  const foe = makeWildMon(bundle, "RATTATA", 3, () => 0.5);
  const battle = B.startWildBattle(bundle, [mine], 0, foe, () => 0.5);
  battle.takeTurn({ kind: "item", moveIndex: 2, partyIndex: -1, item: "ETHER" });
  const log = battle.outcome().log.join(" | ");
  check("an ETHER in a battle restores the move and says so",
        battle.party()[0].moves[2].pp === 10 && log.indexOf("used ETHER") >= 0 && log.indexOf("PP was restored") >= 0, log.slice(-300));
}
{
  // A save from before v8 has no REPEL running.
  const raw = JSON.parse(JSON.stringify(PlayState.newPlayState(bundle.romSha1)));
  raw.version = 7;
  delete raw.repelSteps;
  const migrated = PlayState.migratePlayState(raw, bundle.romSha1);
  check("a v7 save migrates with repelSteps 0", migrated !== null && migrated.repelSteps === 0);
  raw.repelSteps = 37;
  check("and a v8 one keeps its count", PlayState.migratePlayState(raw, bundle.romSha1).repelSteps === 37);
}

console.log("\nITEMUSE " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
