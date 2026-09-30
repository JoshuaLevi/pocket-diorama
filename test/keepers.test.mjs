// The four people who open a list: the Badge House man, Bill's PC, the NAME
// RATER and the DAYCARE gentleman (play/script/Keepers.ts, play/DayCare.ts).
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/keepers.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Three layers: the day-care's arithmetic on its own, each conversation
// against a scripted port (every branch the asm has), and the DAYCARE map
// through the headless lens -- hand a Pokemon over, walk, take it back.
//
// --selftest skips the step counter and expects the returned Pokemon to have
// grown nothing.

import { readFileSync } from "node:fs";
import { HeadlessLens } from "./headless.mjs";

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const SELFTEST = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: keepers.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.getTime = () => 0;

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const { Keepers, BADGE_TEXTS, BILLS_LIST } = await import("../Assets/Scripts/play/script/Keepers.ts");
const DayCare = await import("../Assets/Scripts/play/DayCare.ts");
const { makeWildMon } = await import("../Assets/Scripts/play/battle/Stats.ts");
const { expForLevel } = await import("../Assets/Scripts/play/battle/Party.ts");
const PlayState = await import("../Assets/Scripts/play/PlayState.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL  " + label + (detail !== undefined ? "\n          " + detail : ""));
}

let seed = 7;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const mon = (species, level) => makeWildMon(bundle, species, level, random);

// ---------------------------------------------------------------------------
// 1. The arithmetic
// ---------------------------------------------------------------------------
console.log("== the day-care's arithmetic ==");
{
  const rattata = mon("RATTATA", 5);
  const slot = DayCare.depositInDayCare(rattata);
  check("it goes in at its own level", slot.startLevel === 5 && slot.mon !== rattata);
  let walked = slot;
  for (let i = 0; i < 40; i++) walked = DayCare.dayCareStep(bundle, walked);
  check("a step is a point", walked.mon.exp === slot.mon.exp + 40, walked.mon.exp - slot.mon.exp);
  check("the slot handed in is not written to", slot.mon.exp === rattata.exp);
  check("the bill is a hundred plus a hundred a level",
        DayCare.dayCareCost(0) === 100 && DayCare.dayCareCost(3) === 400);

  // Enough steps for several levels. RATTATA learns HYPER FANG at 14.
  const growth = bundle.species.RATTATA.growthRate;
  const far = { mon: { ...slot.mon, exp: expForLevel(growth, 15) }, startLevel: 5 };
  check("the level is what the experience is worth", DayCare.dayCareLevel(bundle, far) === 15);
  check("and it has grown ten", DayCare.dayCareLevelsGrown(bundle, far) === 10);
  const back = DayCare.withdrawFromDayCare(bundle, far);
  check("it comes back at the new level, at full HP", back.level === 15 && back.hp === back.maxHp && back.maxHp > rattata.maxHp,
        JSON.stringify({ level: back.level, hp: back.hp, max: back.maxHp }));
  const learned = bundle.species.RATTATA.learnset.filter((e) => e.level > 5 && e.level <= 15).map((e) => e.move);
  check("with every move its learnset gives on the way", learned.every((m) => back.moves.some((s) => s.id === m)),
        JSON.stringify({ learned, moves: back.moves.map((m) => m.id) }));

  // Four moves already: the FIRST is the one forgotten, never asked.
  const full = mon("PIDGEY", 4);
  full.moves = [
    { id: "GUST", pp: 35, maxPp: 35 }, { id: "TACKLE", pp: 3, maxPp: 35 },
    { id: "GROWL", pp: 40, maxPp: 40 }, { id: "SCRATCH", pp: 35, maxPp: 35 },
  ];
  const firstNew = bundle.species.PIDGEY.learnset.filter((e) => e.level > 4)[0];
  const grown = DayCare.withdrawFromDayCare(bundle,
    { mon: { ...full, exp: expForLevel(bundle.species.PIDGEY.growthRate, firstNew.level) }, startLevel: 4 });
  check("a full list shifts up and loses its first move",
        grown.moves.length === 4 && grown.moves[0].id === "TACKLE" && grown.moves[3].id === firstNew.move,
        JSON.stringify(grown.moves.map((m) => m.id)));
  check("the moves that shifted keep their PP", grown.moves[0].pp === 3);

  const capped = { mon: { ...slot.mon, exp: expForLevel(growth, 100) }, startLevel: 5 };
  check("at level 100 the steps stop counting", DayCare.dayCareStep(bundle, capped) === capped);

  const surfer = mon("SQUIRTLE", 20);
  surfer.moves[0] = { id: "SURF", pp: 15, maxPp: 15 };
  check("a Pokemon that knows an HM move is the one he refuses", DayCare.knowsHmMove(surfer) && !DayCare.knowsHmMove(rattata));
}

// ---------------------------------------------------------------------------
// 2. The conversations, against a scripted port
// ---------------------------------------------------------------------------
function rig(state, script) {
  const said = [];
  const events = [];
  let answer = false;
  let picked = -1;
  let dexOpen = false;
  let naming = false;
  const port = {
    state: () => state,
    bundle: () => bundle,
    say: (text, ram, num) => { said.push({ text, ram, num }); return 0; },
    askYesNo: (text, flag, ram, num) => { said.push({ text, ram, num, ask: true }); answer = script.answers.shift() === true; return 0; },
    answered: () => answer,
    list: (title, labels, notes) => { events.push("list:" + labels.join(",")); picked = script.picks.length ? script.picks.shift() : -1; return 0; },
    pickedRow: () => picked,
    dexPage: (species) => { if (!dexOpen) { dexOpen = true; events.push("dex:" + species); return 2; } dexOpen = false; return 0; },
    nickname: (index) => {
      if (!naming) { naming = true; events.push("naming:" + index); return 2; }
      naming = false;
      if (script.typed) state.party[index].name = script.typed;
      return 0;
    },
    cry: (species) => events.push("cry:" + species),
    sound: (name) => events.push("sound:" + name),
  };
  const keepers = new Keepers(port);
  const run = (routine) => {
    let frames = 0;
    while (keepers.call(routine) !== 0 && frames < 200) frames++;
    return frames;
  };
  return { keepers, run, said, events, texts: () => said.map((s) => s.text) };
}

const freshState = (party) => {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.playerName = "RED";
  state.playerId = 12345;
  state.party = party.map((m) => ({ ...m, otName: "RED", otId: 12345 }));
  state.money = 3000;
  return state;
};

console.log("== the Badge House ==");
{
  const r = rig(freshState([mon("PIDGEY", 5)]), { answers: [], picks: [0, 7, -1] });
  const frames = r.run("badge_house");
  const texts = r.texts();
  check("his line, then two badges told, then the farewell",
        texts[0] === "_CeruleanBadgeHouseMiddleAgedManText" && texts[1] === BADGE_TEXTS[0] &&
        texts[2] === BADGE_TEXTS[7] && texts[3] === "_CeruleanBadgeHouseMiddleAgedManVisitAnyTimeText" && texts.length === 4,
        JSON.stringify(texts));
  check("the list is the eight badges by their item names, and the way out",
        r.events[0] === "list:BOULDERBADGE,CASCADEBADGE,THUNDERBADGE,RAINBOWBADGE,SOULBADGE,MARSHBADGE,VOLCANOBADGE,EARTHBADGE,CANCEL",
        r.events[0]);
  check("it opened three times: he loops until CANCEL", r.events.length === 3 && frames < 50, r.events.length);
  r.said.length = 0;
  r.run("badge_house");
  check("and the next talk starts from his line again", r.texts()[0] === "_CeruleanBadgeHouseMiddleAgedManText");
}

console.log("== Bill's PC ==");
{
  const r = rig(freshState([mon("PIDGEY", 5)]), { answers: [], picks: [1, 3, 4] });
  r.run("bills_list");
  check("FLAREON's page, VAPOREON's page, then CANCEL",
        JSON.stringify(r.events.filter((e) => e.startsWith("dex:"))) === JSON.stringify(["dex:FLAREON", "dex:VAPOREON"]),
        JSON.stringify(r.events));
  check("the rows are EEVEE and its three evolutions", r.events[0] === "list:" + BILLS_LIST.join(",") + ",CANCEL", r.events[0]);
}

console.log("== the NAME RATER ==");
{
  const no = rig(freshState([mon("PIDGEY", 5)]), { answers: [false], picks: [] });
  no.run("name_rater");
  check("no thanks: come any time", JSON.stringify(no.texts()) === JSON.stringify([
    "_NameRatersHouseNameRaterWantMeToRateText", "_NameRatersHouseNameRaterComeAnyTimeYouLikeText"]), JSON.stringify(no.texts()));

  const cancel = rig(freshState([mon("PIDGEY", 5)]), { answers: [true], picks: [-1] });
  cancel.run("name_rater");
  check("backing out of the party is the same farewell", cancel.texts().slice(-1)[0] === "_NameRatersHouseNameRaterComeAnyTimeYouLikeText");

  const state = freshState([mon("PIDGEY", 5), mon("RATTATA", 3)]);
  const rename = rig(state, { answers: [true, true], picks: [1], typed: "FANG" });
  rename.run("name_rater");
  check("the second Pokemon is the one renamed", state.party[1].name === "FANG" && state.party[0].name === "PIDGEY",
        state.party.map((m) => m.name).join(","));
  check("the screen opened for slot 1", rename.events.indexOf("naming:1") >= 0, JSON.stringify(rename.events));
  const last = rename.said[rename.said.length - 1];
  check("and he says its new name", last.text === "_NameRatersHouseNameRaterPokemonHasBeenRenamedText" && last.ram === "FANG", JSON.stringify(last));
  const nice = rename.said.filter((s) => s.text === "_NameRatersHouseNameRaterGiveItANiceNameText")[0];
  check("the offer names the Pokemon as it was", nice && nice.ram === "RATTATA", JSON.stringify(nice));

  const same = rig(freshState([mon("PIDGEY", 5)]), { answers: [true, true], picks: [0], typed: "" });
  same.run("name_rater");
  check("a name left as it was is no rename", same.texts().slice(-1)[0] === "_NameRatersHouseNameRaterComeAnyTimeYouLikeText");

  const tradedState = freshState([mon("PIDGEY", 5)]);
  tradedState.party[0].otName = "TRAINER";
  tradedState.party[0].otId = 999;
  tradedState.party[0].name = "MARCEL";
  const traded = rig(tradedState, { answers: [true], picks: [0], typed: "MINE" });
  traded.run("name_rater");
  const verdict = traded.said[traded.said.length - 1];
  check("somebody else's Pokemon has a truly impeccable name",
        verdict.text === "_NameRatersHouseNameRaterATrulyImpeccableNameText" && verdict.ram === "MARCEL" &&
        tradedState.party[0].name === "MARCEL" && traded.events.every((e) => !e.startsWith("naming")),
        JSON.stringify(verdict));
}

console.log("== the DAYCARE ==");
{
  const lonely = rig(freshState([mon("PIDGEY", 5)]), { answers: [true], picks: [] });
  lonely.run("day_care");
  check("one Pokemon is not enough to leave one", lonely.texts().slice(-1)[0] === "_DaycareGentlemanOnlyHaveOneMonText");

  const no = rig(freshState([mon("PIDGEY", 5), mon("RATTATA", 3)]), { answers: [false], picks: [] });
  no.run("day_care");
  check("no: come again", no.texts().slice(-1)[0] === "_DaycareGentlemanComeAgainText");

  const backedOut = rig(freshState([mon("PIDGEY", 5), mon("RATTATA", 3)]), { answers: [true], picks: [-1] });
  backedOut.run("day_care");
  check("backing out of the party: all right then, come again",
        backedOut.texts().slice(-1)[0] === bundle.text._DaycareGentlemanAllRightThenText + bundle.text._DaycareGentlemanComeAgainText,
        backedOut.texts().slice(-1)[0]);

  const hmState = freshState([mon("PIDGEY", 5), mon("SQUIRTLE", 20)]);
  hmState.party[1].moves[0] = { id: "SURF", pp: 15, maxPp: 15 };
  const hm = rig(hmState, { answers: [true], picks: [1] });
  hm.run("day_care");
  check("an HM move is refused, and nothing changes hands",
        hm.texts().slice(-1)[0] === "_DaycareGentlemanCantAcceptMonWithHMText" && hmState.party.length === 2 && hmState.dayCare === null);

  const state = freshState([mon("PIDGEY", 5), mon("RATTATA", 5)]);
  const leave = rig(state, { answers: [true], picks: [1] });
  leave.run("day_care");
  check("RATTATA is left: out of the party, into the slot",
        state.party.length === 1 && state.party[0].species === "PIDGEY" &&
        state.dayCare !== null && state.dayCare.mon.species === "RATTATA" && state.dayCare.startLevel === 5,
        JSON.stringify({ party: state.party.map((m) => m.species), slot: state.dayCare && state.dayCare.mon.species }));
  check("he names it, it cries, and he says come see me",
        leave.said.some((s) => s.text === "_DaycareGentlemanWillLookAfterMonText" && s.ram === "RATTATA") &&
        leave.events.indexOf("cry:RATTATA") >= 0 && leave.texts().slice(-1)[0] === "_DaycareGentlemanComeSeeMeInAWhileText",
        JSON.stringify(leave.texts()));

  // Back at once: nothing grown, a hundred yen.
  const early = rig(state, { answers: [false], picks: [] });
  early.run("day_care");
  check("back already: it needs more time, and the bill is ¥100",
        early.said[0].text === "_DaycareGentlemanMonNeedsMoreTimeText" && early.said[0].ram === "RATTATA" &&
        early.said[1].text === "_DaycareGentlemanOweMoneyText" && early.said[1].num === 100,
        JSON.stringify(early.said));
  check("declining leaves it there", state.dayCare !== null && state.party.length === 1 && state.money === 3000);

  // Grown ten levels.
  state.dayCare = { mon: { ...state.dayCare.mon, exp: expForLevel(bundle.species.RATTATA.growthRate, 15) }, startLevel: 5 };
  state.money = 500;
  const poor = rig(state, { answers: [true], picks: [] });
  poor.run("day_care");
  check("grown ten: the bill is ¥1100, and ¥500 is not enough",
        poor.said[0].text === "_DaycareGentlemanMonHasGrownText" && poor.said[0].num === 10 &&
        poor.said[1].num === 1100 && poor.texts().slice(-1)[0] === "_DaycareGentlemanNotEnoughMoneyText" && state.dayCare !== null,
        JSON.stringify(poor.said));

  state.money = 2000;
  const full = rig({ ...state, party: [1, 2, 3, 4, 5, 6].map(() => mon("PIDGEY", 3)) }, { answers: [true], picks: [] });
  full.run("day_care");
  check("a full party has no room for it", full.texts().slice(-1)[0] === "_DaycareGentlemanNoRoomForMonText");

  const take = rig(state, { answers: [true], picks: [] });
  take.run("day_care");
  check("paid: RATTATA is back at level 15, the slot is empty, ¥1100 poorer",
        state.dayCare === null && state.party.length === 2 && state.party[1].species === "RATTATA" &&
        state.party[1].level === 15 && state.money === 900,
        JSON.stringify({ party: state.party.map((m) => m.species + m.level), money: state.money }));
  check("with the purchase jingle, its cry and the line that names it",
        take.events.indexOf("sound:Purchase") >= 0 && take.events.indexOf("cry:RATTATA") >= 0 &&
        take.said.slice(-1)[0].text === "_DaycareGentlemanGotMonBackText" && take.said.slice(-1)[0].ram === "RATTATA",
        JSON.stringify(take.events));
}

// ---------------------------------------------------------------------------
// 3. The save, and the DAYCARE map through the lens
// ---------------------------------------------------------------------------
console.log("== the save ==");
{
  const state = freshState([mon("PIDGEY", 5)]);
  state.dayCare = DayCare.depositInDayCare(mon("RATTATA", 7));
  const round = PlayState.migratePlayState(JSON.parse(JSON.stringify(state)), bundle.romSha1);
  check("the slot survives a save and a load", round.dayCare && round.dayCare.mon.species === "RATTATA" && round.dayCare.startLevel === 7);
  const old = JSON.parse(JSON.stringify(state));
  delete old.dayCare;
  old.version = 12;
  const migrated = PlayState.migratePlayState(old, bundle.romSha1);
  check("a v12 save has nobody in the DAYCARE", migrated !== null && migrated.dayCare === null && migrated.version === PlayState.PLAY_STATE_VERSION);
}

{
  console.log("== on Route 5 ==");
  const state = freshState([mon("PIDGEY", 5), mon("RATTATA", 5)]);
  state.flags.EVENT_INTRO_DONE = true;
  state.mapId = "DAYCARE"; state.cellX = 2; state.cellY = 4; state.facing = "up";
  const lens = new HeadlessLens(bundle, { state: state, wanderers: false, noWild: true });
  lens.choiceAnswers = [1];
  const pages = lens.talk(30);
  const play = lens.play;
  check("talking to the gentleman leaves RATTATA with him",
        play.dayCare !== null && play.dayCare.mon.species === "RATTATA" && play.party.length === 1,
        JSON.stringify({ pages: pages.slice(0, 3), slot: play.dayCare && play.dayCare.mon.species }));
  const before = play.dayCare ? play.dayCare.mon.exp : 0;
  if (!SELFTEST) {
    lens.walk("down", 2);
    lens.walk("up", 2);
  }
  check("four steps are four points", play.dayCare !== null && play.dayCare.mon.exp - before === 4,
        play.dayCare ? play.dayCare.mon.exp - before : "no slot");
}

const verdict = fail === 0 ? "OK" : "FAILED";
console.log(`KEEPERS ${pass} PASS  ${fail} FAIL  ${verdict}`);
if (SELFTEST) {
  if (fail === 0) { console.log("SELFTEST FAILED: unwalked steps went unnoticed"); process.exit(1); }
  console.log("SELFTEST OK: the planted fault was caught");
  process.exit(0);
}
process.exit(fail === 0 ? 0 : 1);
