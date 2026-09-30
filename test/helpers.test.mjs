// The helper expansions, driven through the VM against the real bundle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/helpers.test.mjs Assets/Generated/kanto.json [--selftest]
//
// tools/transcribe.py expands the reference's helper-built scripts -- gift(),
// badgeGuard(), badgeBranch(), ballMon(), rodGiver() -- into command lists.
// script.test.mjs proves those lists are well-formed. This proves they DO the
// right thing when a player talks to the NPC: the item lands, the flag lands
// after it and not before, a full bag is refused without losing the gift, the
// badge gate reads the badge set, the rod house takes no for an answer.
//
// The order-of-effects checks are the point. Twice already in this project a
// flag was set before the thing it recorded had happened, and both times every
// layer's own tests were green.
//
// `--selftest` reintroduces those bugs into copies of the scripts and requires
// the assertions to notice.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { makeServices, shownText } from "./fakeservices.mjs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: helpers.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const { ScriptVM } = await import(P + "script/ScriptVM.ts");
const { PlayHost, ANSWER_YES, ANSWER_NO } = await import(P + "script/Host.ts");
const { transcribedAll, transcribedScript } = await import(P + "script/PortedMaps.ts");
const { talkScript } = await import(P + "script/MapScripts.ts");
const { paginate } = await import(P + "script/Dialogue.ts");
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "HELPERS", "Red's transcribed helpers by name");

let pass = 0;
let fail = 0;
let quiet = false;
let quietFails = 0;
function check(name, ok, detail) {
  if (quiet) {
    if (!ok) { quietFails++; }
    return;
  }
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

function fresh() {
  const s = PlayState.newPlayState("test");
  s.flags.EVENT_INTRO_DONE = true;
  return s;
}

function withParty(s) {
  s.party.push(makeWildMon(bundle, "PIKACHU", 12, () => 0.5));
  return s;
}

/** Twenty in the current PC box: the cartridge's full box. */
function fillBox(s) {
  for (let i = 0; i < PlayState.BOX_SIZE; i++) {
    s.boxes[0].push(makeWildMon(bundle, "RATTATA", 3, () => 0.5));
  }
  return s;
}

/** Twenty distinct items, none of them `except`: the cartridge's full bag. */
function fillBag(s, except) {
  const ids = Object.keys(bundle.items).filter((id) => id !== except && id.indexOf("BADGE") < 0);
  s.bag = ids.slice(0, 20).map((id) => ({ id: id, count: 1 }));
  return s;
}

function run(program, state, mapId, opts) {
  const services = makeServices(bundle, mapId, opts);
  const host = new PlayHost(bundle, state, services);
  const vm = new ScriptVM(host, state.flags);
  vm.start(program);
  let frames = 0;
  while (vm.isRunning() && frames < 500) {
    vm.update();
    frames++;
  }
  return { services, text: shownText(services), running: vm.isRunning() };
}

/**
 * The rendered windows of the LAST page of a bundle text, as paginate()
 * (Dialogue.ts) actually renders and logs them -- one regex per window.
 *
 * The last page, not the first: the two Route 23 guard lines share their whole
 * first page and differ only at the end, and a check on the first line passed
 * with the two swapped.
 *
 * Used to be one regex built by flattening the last \f-page's own \n/\v into
 * spaces and matching it against r.text.join(" "). e4331be ("a scrolled box
 * keeps its last line", measured against the cartridge) taught paginate() that
 * a \v `cont` scroll -- once a page is already full -- opens a NEW page that
 * repeats the carried line, so a three-line last page ("You have to have /
 * it to get to / POKéMON LEAGUE!") is shown, and logged, as TWO overlapping
 * windows: "...it to get to" then "it to get to POKéMON LEAGUE!". Joining
 * those with a space duplicates "it to get to", and no single regex built from
 * the un-scrolled page matches the duplicated text. Running the real
 * paginate() here instead of re-deriving the scroll rule keeps this from
 * drifting out of sync with production again. Slots become wildcards;
 * {PLAYER} is the default name.
 */
function lastPageWindows(textId) {
  const body = bundle.text[textId];
  if (!body) { throw new Error("no such text " + textId); }
  const chunks = body.split(/[\f\x0c]/);
  const windows = paginate(chunks[chunks.length - 1]);
  return windows.map((w) => {
    const line = w.lines.join(" ").replace(/\{PLAYER\}/g, "RED").trim();
    const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\{RAM:[^}]*\}/g, ".*").replace(/\\\{NUM:[^}]*\}/g, ".*");
    return new RegExp(escaped);
  });
}

/** True once every window of textId's last page has shown, in that order. */
function showed(r, textId) {
  const windows = lastPageWindows(textId);
  let next = 0;
  for (const line of r.text) {
    if (next < windows.length && windows[next].test(line)) { next++; }
  }
  return next === windows.length;
}

/** Index in the fake's log of the first line starting the text's last page, or -1. */
function logIndexOf(r, textId) {
  const re = lastPageWindows(textId)[0];
  return r.services.log.findIndex((l) => l.indexOf("text:") === 0 && re.test(l.substring(5)));
}

function noRawSlots(r) {
  return !r.text.some((l) => l.indexOf("{RAM") >= 0 || l.indexOf("{NUM") >= 0);
}

function count(s, id) {
  for (let i = 0; i < s.bag.length; i++) {
    if (s.bag[i].id === id) { return s.bag[i].count; }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// gift(): Route 1's youngster and his Potion sample
// ---------------------------------------------------------------------------
function testGift(program) {
  const item = "POTION", flag = "EVENT_GOT_POTION_SAMPLE", map = "ROUTE_1";

  const s = fresh();
  const r = run(program, s, map);
  check("gift: the Potion lands in the bag", count(s, item) === 1, JSON.stringify(s.bag));
  check("gift: the flag is set once it has", s.flags[flag] === true);
  check("gift: the received line is shown with the item's name in it",
        showed(r, "_Route1Youngster1GotPotionText") && r.text.some((l) => l.indexOf("POTION") >= 0),
        JSON.stringify(r.text));
  check("gift: no raw {RAM:} slot reaches the box", noRawSlots(r), JSON.stringify(r.text));
  const sound = r.services.log.indexOf("sound:Get_Item1");
  const received = logIndexOf(r, "_Route1Youngster1GotPotionText");
  // Route1.asm:34-36: the received line IS the text block, and the jingle is
  // the row after the text_far inside it -- so it rings once that page has
  // been read, not before it and not before the pre line either.
  check("gift: the jingle rings after the received line, not before it",
        sound >= 0 && received >= 0 && sound > received, JSON.stringify(r.services.log));

  const again = run(program, s, map);
  check("gift: a second visit gives nothing more", count(s, item) === 1);
  check("gift: and says the already line", showed(again, "_Route1Youngster1AlsoGotPokeballsText"),
        JSON.stringify(again.text));

  const full = fillBag(fresh(), item);
  const rf = run(program, full, map);
  check("gift: a full bag is refused", count(full, item) === 0);
  check("gift: with the no-room line", showed(rf, "_Route1Youngster1NoRoomText"), JSON.stringify(rf.text));
  check("gift: and the flag is NOT set, so the gift is still owed", full.flags[flag] !== true);
  full.bag.pop();
  run(program, full, map);
  check("gift: once there is room the gift is handed over after all",
        count(full, item) === 1 && full.flags[flag] === true, JSON.stringify(full.bag));
}

// ---------------------------------------------------------------------------
// badgeGuard(): the Victory Road gate reads the badge SET
// ---------------------------------------------------------------------------
function testBadgeGuard(program) {
  const map = "ROUTE_23", flag = "EVENT_PASSED_EARTHBADGE_CHECK";
  const s = fresh();
  const r = run(program, s, map);
  check("badgeGuard: without the badge you are turned away",
        showed(r, "_Route23YouDontHaveTheBadgeYetText") && s.flags[flag] !== true, JSON.stringify(r.text));
  check("badgeGuard: the badge's name is in the line", r.text.some((l) => l.indexOf("EARTHBADGE") >= 0),
        JSON.stringify(r.text));
  check("badgeGuard: no raw slot", noRawSlots(r), JSON.stringify(r.text));
  // Route23.asm:221-227 -- the refusal's own text_asm plays SFX_DENIED and
  // waits for it, and Route23CheckForBadgeScript walks the player one step
  // back down (:206-208). Both belong to the script, so the row trigger and
  // talking to the guard do the same thing.
  check("badgeGuard: the refusal is denied out loud and steps you back",
        r.services.log.indexOf("sound:Denied") > logIndexOf(r, "_Route23YouDontHaveTheBadgeYetText") &&
        r.services.log.indexOf("walk:down:1") >= 0,
        JSON.stringify(r.services.log));
  s.badges[7] = true;
  const r2 = run(program, s, map);
  check("badgeGuard: with the Earth Badge in the badge set you pass",
        showed(r2, "_Route23OhThatIsTheBadgeText") && showed(r2, "_Route23GoRightAheadText") &&
        s.flags[flag] === true, JSON.stringify(r2.text));
  check("badgeGuard: with the item jingle between the two pages, and no shove",
        r2.services.log.indexOf("sound:Get_Item1") > logIndexOf(r2, "_Route23OhThatIsTheBadgeText") &&
        r2.services.log.indexOf("walk:down:1") < 0, JSON.stringify(r2.services.log));
  check("badgeGuard: the badge was never a bag item", s.bag.length === 0);
}

// ---------------------------------------------------------------------------
// badgeBranch(): the gym guide before and after
// ---------------------------------------------------------------------------
function testBadgeBranch(program) {
  const map = "CERULEAN_GYM";
  const s = fresh();
  const r = run(program, s, map);
  check("badgeBranch: before Misty, the champ-in-making line",
        showed(r, "_CeruleanGymGymGuideChampInMakingText") && !showed(r, "_CeruleanGymGymGuideBeatMistyText"),
        JSON.stringify(r.text));
  s.flags.EVENT_BEAT_MISTY = true;
  const r2 = run(program, s, map);
  check("badgeBranch: after Misty, the other one",
        showed(r2, "_CeruleanGymGymGuideBeatMistyText") && !showed(r2, "_CeruleanGymGymGuideChampInMakingText"),
        JSON.stringify(r2.text));
}

// ---------------------------------------------------------------------------
// ballMon(): a Voltorb posing as an item
// ---------------------------------------------------------------------------
function testBallMon(program) {
  const map = "POWER_PLANT", flag = "EVENT_BEAT_POWER_PLANT_VOLTORB_0";
  const s = withParty(fresh());
  const r = run(program, s, map, { won: true });
  check("ballMon: it says Bzzzt and attacks", showed(r, "_PowerPlantVoltorbBattleText") &&
        r.services.staticBattles[0] === "VOLTORB@40", JSON.stringify(r.services.log));
  check("ballMon: beating it sets its flag", s.flags[flag] === true);
  const r2 = run(program, s, map, { won: true });
  check("ballMon: a beaten one is text only", r2.services.staticBattles.length === 0 &&
        showed(r2, "_PowerPlantVoltorbBattleText"), JSON.stringify(r2.services.log));
  const lost = withParty(fresh());
  run(program, lost, map, { won: false });
  check("ballMon: losing leaves it standing", lost.flags[flag] !== true);
}

// ---------------------------------------------------------------------------
// rodGiver(): the Old Rod house takes no for an answer
// ---------------------------------------------------------------------------
function testRodGiver(program) {
  const map = "VERMILION_OLD_ROD_HOUSE", item = "OLD_ROD", flag = "EVENT_GOT_OLD_ROD";
  const no = fresh();
  const rn = run(program, no, map, { answer: ANSWER_NO });
  check("rodGiver: no means no rod", count(no, item) === 0 && no.flags[flag] !== true);
  check("rodGiver: and the disappointed line", showed(rn, "_VermilionOldRodHouseFishingGuruThatsSoDisappointingText"),
        JSON.stringify(rn.text));

  const yes = fresh();
  const ry = run(program, yes, map, { answer: ANSWER_YES });
  check("rodGiver: yes hands the rod over", count(yes, item) === 1 && yes.flags[flag] === true,
        JSON.stringify(yes.bag));
  check("rodGiver: the received line names it",
        showed(ry, "_VermilionOldRodHouseFishingGuruTakeThisText") && ry.text.some((l) => l.indexOf("OLD ROD") >= 0),
        JSON.stringify(ry.text));
  check("rodGiver: the follow-up line comes too", showed(ry, "_VermilionOldRodHouseFishingGuruFishingIsAWayOfLifeText"),
        JSON.stringify(ry.text));
  // VermilionOldRodHouse.asm:42-46 -- the TakeThis page, THEN sound_get_item_1,
  // THEN "Fishing is a way of life!". The ordinary item jingle: the rod is a
  // key item, and the cartridge hardcodes SFX_GET_ITEM_1 in the text anyway.
  const jingle = ry.services.log.indexOf("sound:Get_Item1");
  check("rodGiver: the ordinary item jingle, not the key one",
        jingle >= 0 && ry.services.log.indexOf("sound:Get_Key_Item") < 0, JSON.stringify(ry.services.log));
  const takeThis = logIndexOf(ry, "_VermilionOldRodHouseFishingGuruTakeThisText");
  check("rodGiver: and it rings between the two pages",
        takeThis >= 0 && jingle > takeThis &&
        jingle < logIndexOf(ry, "_VermilionOldRodHouseFishingGuruFishingIsAWayOfLifeText"),
        JSON.stringify(ry.services.log));
  check("rodGiver: no raw slot", noRawSlots(ry), JSON.stringify(ry.text));
  const r3 = run(program, yes, map, { answer: ANSWER_YES });
  check("rodGiver: a second visit is the after line and no second rod",
        count(yes, item) === 1 && showed(r3, "_VermilionOldRodHouseFishingGuruHowAreTheFishBitingText"),
        JSON.stringify(r3.text));

  const full = fillBag(fresh(), item);
  const rf = run(program, full, map, { answer: ANSWER_YES });
  check("rodGiver: a full bag is refused and the flag stays clear",
        count(full, item) === 0 && full.flags[flag] !== true, JSON.stringify(full.flags));
  check("rodGiver: with the house's own no-room line", showed(rf, "_VermilionOldRodHouseFishingGuruNoRoomText"),
        JSON.stringify(rf.text));
}

// ---------------------------------------------------------------------------
// binoculars(): only when you look up through them
// ---------------------------------------------------------------------------
function testBinoculars(program) {
  const map = "ROUTE_12_GATE_2F";
  const up = run(program, fresh(), map, { facing: "up" });
  check("binoculars: facing up shows the view", showed(up, "_Route12Gate2FLeftBinocularsText"), JSON.stringify(up.text));
  const down = run(program, fresh(), map, { facing: "down" });
  check("binoculars: facing any other way says nothing", down.text.length === 0, JSON.stringify(down.text));
}

// ---------------------------------------------------------------------------
// coinGiver(): ten coins once, if you can carry them
// ---------------------------------------------------------------------------
function testCoinGiver(program) {
  const map = "GAME_CORNER", flag = "EVENT_GOT_10_COINS";
  const noCase = fresh();
  const r0 = run(program, noCase, map);
  check("coinGiver: without a COIN CASE nothing is given",
        noCase.coins === 0 && noCase.flags[flag] !== true && showed(r0, "_GameCornerOopsForgotCoinCaseText"),
        JSON.stringify(r0.text));

  const s = fresh();
  PlayState.giveItem(s, "COIN_CASE", 1);
  const r = run(program, s, map);
  check("coinGiver: with the case the coins land", s.coins === 10, "coins=" + s.coins);
  check("coinGiver: and the flag", s.flags[flag] === true);
  check("coinGiver: with the received line and the jingle",
        showed(r, "_GameCornerFishingGuruReceived10CoinsText") && r.services.log.indexOf("sound:Get_Item1") >= 0,
        JSON.stringify(r.services.log));
  const again = run(program, s, map);
  check("coinGiver: once only", s.coins === 10 && showed(again, "_GameCornerFishingGuruWinsComeAndGoText"),
        JSON.stringify(again.text));

  const rich = fresh();
  PlayState.giveItem(rich, "COIN_CASE", 1);
  rich.coins = 9995;
  const rr = run(program, rich, map);
  check("coinGiver: a nearly full case is refused and stays owed",
        rich.coins === 9995 && rich.flags[flag] !== true && showed(rr, "_GameCornerFishingGuruDontNeedMyCoinsText"),
        JSON.stringify(rr.text));
}

// ---------------------------------------------------------------------------
// oaksAide(): the Route 2 gate, HM05 for ten kinds
// ---------------------------------------------------------------------------
function ownSpecies(s, n) {
  for (let dex = 1; dex <= n; dex++) { PlayState.markOwned(s, dex); }
  return s;
}

function testOaksAide(program) {
  const map = "ROUTE_2_GATE", item = "HM_FLASH", flag = "EVENT_GOT_HM05";
  const few = ownSpecies(fresh(), 3);
  const rf = run(program, few, map, { answer: ANSWER_YES });
  check("oaksAide: three kinds is not enough", count(few, item) === 0 && few.flags[flag] !== true &&
        showed(rf, "_OaksAideUhOhText"), JSON.stringify(rf.text));
  check("oaksAide: the uh-oh line prints the live count and the requirement",
        rf.text.some((l) => l.indexOf("caught only 3") >= 0) && rf.text.join(" ").indexOf("10") >= 0 && noRawSlots(rf),
        JSON.stringify(rf.text));

  const no = ownSpecies(fresh(), 12);
  const rn = run(program, no, map, { answer: ANSWER_NO });
  check("oaksAide: no is come back later, with the requirement in it",
        count(no, item) === 0 && showed(rn, "_OaksAideComeBackText") && rn.text.join(" ").indexOf("10") >= 0 && noRawSlots(rn),
        JSON.stringify(rn.text));

  const yes = ownSpecies(fresh(), 12);
  const ry = run(program, yes, map, { answer: ANSWER_YES });
  check("oaksAide: twelve kinds earns the HM", count(yes, item) === 1 && yes.flags[flag] === true,
        JSON.stringify(yes.bag));
  check("oaksAide: the got line names it and no slot leaks",
        showed(ry, "_OaksAideGotItemText") && ry.text.some((l) => l.indexOf("HM05") >= 0) && noRawSlots(ry),
        JSON.stringify(ry.text));
  check("oaksAide: followed by the explanation", showed(ry, "_Route2GateOaksAideFlashExplanationText"),
        JSON.stringify(ry.text));
  // OaksAideGotItemText is text_far + sound_get_item_1 (oaks_aide.asm:64-67) --
  // one routine for all three aides, so HM05 rings the ordinary jingle.
  const aideJingle = ry.services.log.indexOf("sound:Get_Item1");
  const gotLine = logIndexOf(ry, "_OaksAideGotItemText");
  check("oaksAide: the ordinary item jingle, after the got line",
        gotLine >= 0 && aideJingle > gotLine &&
        ry.services.log.indexOf("sound:Get_Key_Item") < 0, JSON.stringify(ry.services.log));
  check("oaksAide: and he turns to face you before any of it",
        ry.services.log.indexOf("face") === 0, JSON.stringify(ry.services.log.slice(0, 3)));
  const r2 = run(program, yes, map, { answer: ANSWER_YES });
  check("oaksAide: a second visit is the explanation only, and no second HM",
        count(yes, item) === 1 && showed(r2, "_Route2GateOaksAideFlashExplanationText") && !showed(r2, "_OaksAideHiText"),
        JSON.stringify(r2.text));

  const full = fillBag(ownSpecies(fresh(), 12), item);
  const rfull = run(program, full, map, { answer: ANSWER_YES });
  check("oaksAide: a full bag is refused and the HM is still owed",
        count(full, item) === 0 && full.flags[flag] !== true && showed(rfull, "_OaksAideNoRoomText"),
        JSON.stringify(rfull.text));
}

// ---------------------------------------------------------------------------
// dojoBall(): one prize, once, only after the master
// ---------------------------------------------------------------------------
function testDojoBall(program) {
  const map = "FIGHTING_DOJO";
  const early = fresh();
  const re = run(program, early, map, { answer: ANSWER_YES });
  check("dojoBall: before the master is beaten the ball refuses", early.party.length === 0 && re.text.length > 0 &&
        early.flags.EVENT_GOT_HITMONLEE !== true, JSON.stringify(re.text));

  const s = fresh();
  s.flags.EVENT_BEAT_KARATE_MASTER = true;
  const r = run(program, s, map, { answer: ANSWER_YES });
  check("dojoBall: after him, yes puts a level-30 HITMONLEE in the party",
        s.party.length === 1 && s.party[0].species === "HITMONLEE" && s.party[0].level === 30, JSON.stringify(s.party.map((m) => [m.species, m.level])));
  check("dojoBall: the ball goes and both flags land",
        r.services.revealed["FIGHTING_DOJO:FIGHTINGDOJO_HITMONLEE_POKE_BALL"] === false &&
        s.flags.EVENT_GOT_HITMONLEE === true && s.flags.EVENT_DEFEATED_FIGHTING_DOJO === true, JSON.stringify(s.flags));
  check("dojoBall: the dex saw it first", s.dexSeen[bundle.species.HITMONLEE.dex - 1] === true);
  const other = transcribedScript("FIGHTING_DOJO", "TEXT_FIGHTINGDOJO_HITMONCHAN_POKE_BALL");
  const rg = run(other, s, map, { answer: ANSWER_YES });
  check("dojoBall: the other ball says not to get greedy", s.party.length === 1 && showed(rg, "_FightingDojoBetterNotGetGreedyText"), JSON.stringify(rg.text));

  const no = fresh();
  no.flags.EVENT_BEAT_KARATE_MASTER = true;
  run(program, no, map, { answer: ANSWER_NO });
  check("dojoBall: no leaves it on the mat", no.party.length === 0 && no.flags.EVENT_GOT_HITMONLEE !== true);

  const crowded = fresh();
  crowded.flags.EVENT_BEAT_KARATE_MASTER = true;
  for (let i = 0; i < 6; i++) { withParty(crowded); }
  const rbox = run(program, crowded, map, { answer: ANSWER_YES });
  check("dojoBall: a full party sends HITMONLEE to the box, and the ball is still taken",
        crowded.party.length === 6 && crowded.boxes[0].length === 1 &&
        crowded.boxes[0][0].species === "HITMONLEE" && crowded.boxes[0][0].level === 30 &&
        crowded.flags.EVENT_GOT_HITMONLEE === true &&
        rbox.text.join(" ").indexOf("BOX 1 on PC!") >= 0 &&
        rbox.services.revealed["FIGHTING_DOJO:FIGHTINGDOJO_HITMONLEE_POKE_BALL"] === false,
        JSON.stringify(rbox.text));

  const nowhere = fresh();
  nowhere.flags.EVENT_BEAT_KARATE_MASTER = true;
  for (let i = 0; i < 6; i++) { withParty(nowhere); }
  fillBox(nowhere);
  const rc = run(program, nowhere, map, { answer: ANSWER_YES });
  check("dojoBall: a full party AND a full box is the box-full line and nothing is taken",
        nowhere.party.length === 6 && nowhere.flags.EVENT_GOT_HITMONLEE !== true && showed(rc, "_BoxIsFullText") &&
        rc.services.revealed["FIGHTING_DOJO:FIGHTINGDOJO_HITMONLEE_POKE_BALL"] === undefined, JSON.stringify(rc.text));
}

// ---------------------------------------------------------------------------
// mtMoonFossil(): the nerd first, then one of two
// ---------------------------------------------------------------------------
function testMtMoonFossil(program) {
  const map = "MT_MOON_B2F";
  const s = withParty(fresh());
  const r1 = run(program, s, map, { answer: ANSWER_YES });
  check("mtMoonFossil: with the nerd unbeaten, talking to a fossil is his fight",
        r1.services.battlesFought[0] === "OPP_SUPER_NERD#2" && s.flags.EVENT_BEAT_MT_MOON_3_SUPER_NERD === true &&
        showed(r1, "_MtMoonB2FSuperNerdOkIllShareText") && count(s, "DOME_FOSSIL") === 0, JSON.stringify(r1.services.log));
  const r2 = run(program, s, map, { answer: ANSWER_YES });
  check("mtMoonFossil: then yes takes the DOME FOSSIL", count(s, "DOME_FOSSIL") === 1 && s.flags.EVENT_GOT_DOME_FOSSIL === true,
        JSON.stringify(s.bag));
  check("mtMoonFossil: both balls are gone and the nerd claimed the other",
        r2.services.revealed["MT_MOON_B2F:MTMOONB2F_DOME_FOSSIL"] === false &&
        r2.services.revealed["MT_MOON_B2F:MTMOONB2F_HELIX_FOSSIL"] === false &&
        showed(r2, "_MtMoonB2FSuperNerdThenThisIsMineText") && r2.text.some((l) => l.indexOf("DOME FOSSIL") >= 0),
        JSON.stringify(r2.services.log));
  const helix = transcribedScript("MT_MOON_B2F", "TEXT_MTMOONB2F_HELIX_FOSSIL");
  const r3 = run(helix, s, map, { answer: ANSWER_YES });
  check("mtMoonFossil: the other fossil's script does nothing once one is taken", r3.text.length === 0 && count(s, "HELIX_FOSSIL") === 0);

  const full = fillBag(withParty(fresh()), "DOME_FOSSIL");
  full.flags.EVENT_BEAT_MT_MOON_3_SUPER_NERD = true;
  const rf = run(program, full, map, { answer: ANSWER_YES });
  check("mtMoonFossil: a full bag is refused, the flag stays clear and the ball stays",
        count(full, "DOME_FOSSIL") === 0 && full.flags.EVENT_GOT_DOME_FOSSIL !== true && showed(rf, "_MtMoonB2FYouHaveNoRoomText") &&
        rf.services.revealed["MT_MOON_B2F:MTMOONB2F_DOME_FOSSIL"] === undefined, JSON.stringify(rf.text));
}

// ---------------------------------------------------------------------------
// A transcribed question: ask followed straight by a jump, the reference's shape
// ---------------------------------------------------------------------------
//
// Ten transcribed scripts ask a yes/no and branch on the next command. The VM
// used to park the answer in a flag and leave the condition alone, so all ten
// branched on whatever the previous check had left there -- false, at the top
// of a script. The Magikarp salesman took your no and your yes the same way.
function testTranscribedAsk(salesman, guide) {
  const map = "MT_MOON_POKECENTER";
  const yes = withParty(fresh());
  run(salesman, yes, map, { answer: ANSWER_YES });
  check("ask: yes to the salesman buys a Magikarp for 500",
        yes.party.some((m) => m.species === "MAGIKARP") && yes.money === 2500,
        JSON.stringify({ money: yes.money, party: yes.party.map((m) => m.species) }));

  const no = withParty(fresh());
  const rn = run(salesman, no, map, { answer: ANSWER_NO });
  check("ask: no to the salesman buys nothing",
        !no.party.some((m) => m.species === "MAGIKARP") && no.money === 3000 &&
        showed(rn, "_MtMoonPokecenterMagikarpSalesmanNoText"), JSON.stringify(rn.text));

  const broke = withParty(fresh());
  broke.money = 100;
  const rb = run(salesman, broke, map, { answer: ANSWER_YES });
  check("ask: yes without the money is refused and keeps the money",
        !broke.party.some((m) => m.species === "MAGIKARP") && broke.money === 100 &&
        showed(rb, "_MtMoonPokecenterMagikarpSalesmanNoMoneyText"), JSON.stringify(rb.text));

  const crowded = fresh();
  for (let i = 0; i < 6; i++) { withParty(crowded); }
  const rbox = run(salesman, crowded, map, { answer: ANSWER_YES });
  check("ask: a full party sends the MAGIKARP to the box, and the money goes",
        crowded.party.length === 6 && crowded.boxes[0].length === 1 &&
        crowded.boxes[0][0].species === "MAGIKARP" && crowded.money < 3000 &&
        rbox.text.join(" ").indexOf("BOX 1 on PC!") >= 0,
        JSON.stringify({ money: crowded.money, box: crowded.boxes[0].map((m) => m.species), text: rbox.text }));

  const nowhere = fresh();
  for (let i = 0; i < 6; i++) { withParty(nowhere); }
  fillBox(nowhere);
  const rc = run(salesman, nowhere, map, { answer: ANSWER_YES });
  check("ask: with the box full too it is the box-full line, and the money stays",
        nowhere.party.length === 6 && nowhere.money === 3000 && showed(rc, "_BoxIsFullText"),
        JSON.stringify({ money: nowhere.money, text: rc.text }));

  const gy = fresh();
  const rgy = run(guide, gy, "PEWTER_GYM", { answer: ANSWER_YES });
  check("ask: the Pewter guide hears yes", showed(rgy, "_PewterGymGuideBeginAdviceText") &&
        !showed(rgy, "_PewterGymGuideFreeServiceText"), JSON.stringify(rgy.text));
  const gn = fresh();
  const rgn = run(guide, gn, "PEWTER_GYM", { answer: ANSWER_NO });
  check("ask: and hears no", showed(rgn, "_PewterGymGuideFreeServiceText") &&
        !showed(rgn, "_PewterGymGuideBeginAdviceText"), JSON.stringify(rgn.text));
}

// ---------------------------------------------------------------------------
// the cry comes AFTER the line it belongs to, everywhere
// ---------------------------------------------------------------------------
{
  // Every cry in Red is a text_asm inside a text: the words are a text_far and
  // the `ld a, SPECIES / call PlayCry` after it runs once that page has been
  // read (VermilionCity.asm:224-231, MrFujisHouse.asm:56-68,
  // CeladonMansion1F.asm:16-30, PowerPlant.asm:110-116). The reference puts its
  // play_cry row first, so the port barked before anyone spoke.
  const all = transcribedAll();
  const early = [];
  let cries = 0;
  for (const mapId of Object.keys(all)) {
    const talk = all[mapId].talk || {};
    for (const key of Object.keys(talk)) {
      const rows = talk[key];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].op !== "play_cry") { continue; }
        cries++;
        // A cry must have a line before it, and the row after it must not be
        // the line it belongs to.
        if (!rows.slice(0, i).some((c) => c.op === "show_text")) {
          early.push(mapId + "." + key);
        }
      }
    }
  }
  check("every transcribed cry has been introduced first", early.length === 0 && cries >= 20,
        cries + " cries, early: " + JSON.stringify(early));

  // The same rule for the jingles: a sound_ inside a text block always follows
  // a text_far, so a text_sound with no line before it is a port that rings
  // before it speaks.
  const mute = [];
  let jingles = 0;
  for (const mapId of Object.keys(all)) {
    const talk = all[mapId].talk || {};
    for (const key of Object.keys(talk)) {
      const rows = talk[key];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].op !== "text_sound") { continue; }
        jingles++;
        if (!rows.slice(0, i).some((c) => c.op === "show_text")) { mute.push(mapId + "." + key); }
      }
    }
  }
  check("and every jingle rings after the line it belongs to", mute.length === 0 && jingles >= 20,
        jingles + " jingles, early: " + JSON.stringify(mute));

  const machop = transcribedScript("VERMILION_CITY", "TEXT_VERMILIONCITY_MACHOP");
  check("MACHOP speaks, cries, and THEN the second page is about him",
        machop.map((c) => c.op).join(">") === "show_text>play_cry>show_text",
        JSON.stringify(machop.map((c) => c.op)));
}

// ---------------------------------------------------------------------------
// the hand-written overrides this milestone added
// ---------------------------------------------------------------------------
{
  // PokemonFanClub.asm:113-145: his own full-bag line, and the key-item
  // fanfare between the received page and the explanation.
  const chairman = talkScript("POKEMON_FAN_CLUB", "TEXT_POKEMONFANCLUB_CHAIRMAN");
  const yes = fresh();
  const r = run(chairman, yes, "POKEMON_FAN_CLUB", { answer: ANSWER_YES });
  check("chairman: the BIKE VOUCHER is handed over once",
        count(yes, "BIKE_VOUCHER") === 1 && yes.flags.EVENT_RECEIVED_BIKE_VOUCHER === true,
        JSON.stringify(yes.bag));
  const voucherJingle = r.services.log.indexOf("sound:Get_Key_Item");
  const received = logIndexOf(r, "_PokemonFanClubReceivedBikeVoucherText");
  const explain = logIndexOf(r, "_PokemonFanClubExplainBikeVoucherText");
  check("chairman: with the key-item fanfare between the two pages",
        received >= 0 && explain >= 0 && voucherJingle > received && voucherJingle < explain,
        JSON.stringify(r.services.log));
  const full = fillBag(fresh(), "BIKE_VOUCHER");
  const rf = run(chairman, full, "POKEMON_FAN_CLUB", { answer: ANSWER_YES });
  check("chairman: a full bag gets HIS line, and the voucher is still owed",
        count(full, "BIKE_VOUCHER") === 0 && full.flags.EVENT_RECEIVED_BIKE_VOUCHER !== true &&
        showed(rf, "_PokemonFanClubBagFullText"), JSON.stringify(rf.text));
  const no = fresh();
  const rn = run(chairman, no, "POKEMON_FAN_CLUB", { answer: ANSWER_NO });
  check("chairman: no story, no voucher", count(no, "BIKE_VOUCHER") === 0 &&
        showed(rn, "_PokemonFanClubNoStoryText"), JSON.stringify(rn.text));

  // The four the reference wrote as Lua functions, so nothing was porting them.
  const girl = talkScript("VIRIDIAN_CITY", "TEXT_VIRIDIANCITY_GIRL");
  const early = fresh();
  check("the girl in Viridian apologises for her grandfather",
        showed(run(girl, early, "VIRIDIAN_CITY"), "_ViridianCityGirlHasntHadHisCoffeeYetText"));
  const dexed = fresh();
  dexed.flags.EVENT_GOT_POKEDEX = true;
  check("and talks about the forest road once the POKeDEX is yours",
        showed(run(girl, dexed, "VIRIDIAN_CITY"), "_ViridianCityGirlWhenIGoShopText"));

  const gambler = talkScript("VIRIDIAN_CITY", "TEXT_VIRIDIANCITY_GAMBLER1");
  check("the gym is always closed",
        showed(run(gambler, fresh(), "VIRIDIAN_CITY"), "_ViridianCityGambler1GymAlwaysClosedText"));
  const seven = fresh();
  for (const i of [0, 1, 2, 3, 4, 5, 6]) { seven.badges[i] = true; }
  check("until seven badges say the LEADER is back",
        showed(run(gambler, seven, "VIRIDIAN_CITY"), "_ViridianCityGambler1GymLeaderReturnedText"));
  const six = fresh();
  for (const i of [0, 1, 2, 3, 4, 5]) { six.badges[i] = true; }
  check("six is not enough",
        showed(run(gambler, six, "VIRIDIAN_CITY"), "_ViridianCityGambler1GymAlwaysClosedText"));
  const beaten = fresh();
  beaten.flags.EVENT_BEAT_VIRIDIAN_GYM_GIOVANNI = true;
  check("and beating GIOVANNI says it too",
        showed(run(gambler, beaten, "VIRIDIAN_CITY"), "_ViridianCityGambler1GymLeaderReturnedText"));

  const caterpillars = talkScript("VIRIDIAN_CITY", "TEXT_VIRIDIANCITY_YOUNGSTER2");
  check("the caterpillar lesson is offered and taken",
        showed(run(caterpillars, fresh(), "VIRIDIAN_CITY", { answer: ANSWER_YES }),
               "ViridianCityYoungster2CaterpieAndWeedleDescriptionText"));
  check("and can be turned down",
        showed(run(caterpillars, fresh(), "VIRIDIAN_CITY", { answer: ANSWER_NO }),
               "ViridianCityYoungster2OkThenText"));

  // CeruleanCity.asm:283-307: ONE byte, compared twice.
  const slowbro = talkScript("CERULEAN_CITY", "TEXT_CERULEANCITY_COOLTRAINER_F1");
  function slowbroWith(byte) {
    const state = fresh();
    return run(slowbro, state, "CERULEAN_CITY", { random: () => byte / 256 });
  }
  check("180 and up is SONICBOOM", showed(slowbroWith(200), "_CeruleanCityCooltrainerF1SlowbroUseSonicboomText"));
  check("a hundred and up is the punch", showed(slowbroWith(150), "_CeruleanCityCooltrainerF1SlowbroPunchText"));
  check("and under a hundred is the withdraw", showed(slowbroWith(50), "_CeruleanCityCooltrainerF1SlowbroWithdrawText"));
  check("the line on the boundary belongs to the higher branch",
        showed(slowbroWith(180), "_CeruleanCityCooltrainerF1SlowbroUseSonicboomText") &&
        showed(slowbroWith(179), "_CeruleanCityCooltrainerF1SlowbroPunchText"));

  // MrFujisHouse.asm:70-105: the fanfare is inside the received text, and a
  // full bag has its own line and leaves the flute with him.
  const fuji = talkScript("MR_FUJIS_HOUSE", "TEXT_MRFUJISHOUSE_MR_FUJI");
  const taker = fresh();
  const gave = run(fuji, taker, "MR_FUJIS_HOUSE");
  check("MR FUJI: the POKe FLUTE, once", count(taker, "POKE_FLUTE") === 1 &&
        taker.flags.EVENT_GOT_POKE_FLUTE === true, JSON.stringify(taker.bag));
  const fluteJingle = gave.services.log.indexOf("sound:Get_Key_Item");
  const receivedAt = logIndexOf(gave, "_MrFujisHouseMrFujiReceivedPokeFluteText");
  const explainAt = logIndexOf(gave, "_MrFujisHouseMrFujiPokeFluteExplanationText");
  check("MR FUJI: with the fanfare between the received page and the explanation",
        receivedAt >= 0 && explainAt >= 0 && fluteJingle > receivedAt && fluteJingle < explainAt,
        JSON.stringify(gave.services.log));
  const noRoom = fillBag(fresh(), "POKE_FLUTE");
  const refusedFlute = run(fuji, noRoom, "MR_FUJIS_HOUSE");
  check("MR FUJI: a full bag gets his own line and keeps the flute for you",
        count(noRoom, "POKE_FLUTE") === 0 && noRoom.flags.EVENT_GOT_POKE_FLUTE !== true &&
        showed(refusedFlute, "_MrFujisHouseMrFujiPokeFluteNoRoomText"),
        JSON.stringify(refusedFlute.text));
  const again = run(fuji, taker, "MR_FUJIS_HOUSE");
  check("MR FUJI: afterwards he asks whether it helped",
        count(taker, "POKE_FLUTE") === 1 && showed(again, "_MrFujisHouseMrFujiHasMyFluteHelpedYouText"),
        JSON.stringify(again.text));

  // Route11Gate2F.asm:49-68: the left pair reports the road blocked until the
  // SNORLAX is beaten, and neither pair answers unless you look UP through it.
  const left = talkScript("ROUTE_11_GATE_2F", "TEXT_ROUTE11GATE2F_LEFT_BINOCULARS");
  const asleep = run(left, fresh(), "ROUTE_11_GATE_2F", { facing: "up" });
  check("binoculars: a big POKeMON is asleep on a road",
        showed(asleep, "_Route11Gate2FLeftBinocularsSnorlaxText"), JSON.stringify(asleep.text));
  const moved = fresh();
  moved.flags.EVENT_BEAT_ROUTE12_SNORLAX = true;
  const view = run(left, moved, "ROUTE_11_GATE_2F", { facing: "up" });
  check("binoculars: once he is gone it is a beautiful view",
        showed(view, "_Route11Gate2FLeftBinocularsNoSnorlaxText"), JSON.stringify(view.text));
  const sideways = run(left, fresh(), "ROUTE_11_GATE_2F", { facing: "down" });
  check("binoculars: and nothing at all looking any other way", sideways.text.length === 0,
        JSON.stringify(sideways.text));
  const right = talkScript("ROUTE_11_GATE_2F", "TEXT_ROUTE11GATE2F_RIGHT_BINOCULARS");
  const rock = run(right, fresh(), "ROUTE_11_GATE_2F", { facing: "up" });
  check("binoculars: the right pair points at ROCK TUNNEL",
        showed(rock, "_Route11Gate2FRightBinocularsText"), JSON.stringify(rock.text));
}

// ---------------------------------------------------------------------------
// CELADON: the machines and counters milestone 5 turns on
// ---------------------------------------------------------------------------
{
  // vending_machine.asm:1-81. The drinks these sell are the only drinks in the
  // game and the four SAFFRON guards each want one, so a dead machine is a
  // dead road. The cartridge draws a four-row list, not a chain of yes/no
  // boxes, and `choice` below is the row the player lands on.
  const machine = talkScript("CELADON_MART_ROOF", "TEXT_CELADONMARTROOF_VENDING_MACHINE1");
  const rich = fresh();
  rich.money = 3000;
  const bought = run(machine, rich, "CELADON_MART_ROOF", { choice: 0 });
  check("vending: the list is the cartridge's four rows",
        bought.services.log.some((l) => l === "choice:FRESH WATER,SODA POP,LEMONADE,CANCEL"),
        JSON.stringify(bought.services.log.filter((l) => l.indexOf("choice:") === 0)));
  check("vending: the first row buys the FRESH WATER",
        count(rich, "FRESH_WATER") === 1 && rich.money === 2800,
        JSON.stringify({ bag: rich.bag, money: rich.money }));
  check("vending: it clunks out of the machine and says so",
        bought.services.log.indexOf("sound:Push_Boulder") >= 0 &&
        showed(bought, "_VendingMachineText5") && bought.text.some((l) => l.indexOf("FRESH WATER") >= 0),
        JSON.stringify(bought.services.log));
  const thirdRow = fresh();
  thirdRow.money = 3000;
  run(machine, thirdRow, "CELADON_MART_ROOF", { choice: 2 });
  check("vending: the third row is the LEMONADE, at 350",
        count(thirdRow, "LEMONADE") === 1 && thirdRow.money === 2650,
        JSON.stringify({ bag: thirdRow.bag, money: thirdRow.money }));
  const broke = fresh();
  broke.money = 100;
  const refused = run(machine, broke, "CELADON_MART_ROOF", { choice: 0 });
  check("vending: without the money, oops",
        broke.bag.length === 0 && broke.money === 100 && showed(refused, "_VendingMachineText4"),
        JSON.stringify(refused.text));
  const notThirsty = fresh();
  const declined = run(machine, notThirsty, "CELADON_MART_ROOF", { choice: 3 });
  check("vending: CANCEL is the fourth row and you are not thirsty",
        notThirsty.bag.length === 0 && showed(declined, "_VendingMachineText7"),
        JSON.stringify(declined.text));
  check("vending: and it asks only once, however the visit ends",
        declined.services.log.filter((l) => l.indexOf("choice:") === 0).length === 1,
        JSON.stringify(declined.services.log.filter((l) => l.indexOf("choice:") === 0)));
  const full = fillBag(fresh(), "FRESH_WATER");
  full.money = 3000;
  const noRoom = run(machine, full, "CELADON_MART_ROOF", { choice: 0 });
  check("vending: a full bag keeps the money",
        full.money === 3000 && showed(noRoom, "_VendingMachineText6"), JSON.stringify(noRoom.text));

  // CeladonMartRoof.asm:222-250: each drink buys a TM, once.
  const girl = talkScript("CELADON_MART_ROOF", "TEXT_CELADONMARTROOF_LITTLE_GIRL");
  const dry = fresh();
  check("the girl is thirsty and says so with nothing to give her",
        showed(run(girl, dry, "CELADON_MART_ROOF", { answer: ANSWER_YES }),
               "_CeladonMartRoofLittleGirlImThirstyText"));
  const carrying = fresh();
  carrying.bag.push({ id: "FRESH_WATER", count: 1 });
  const traded = run(girl, carrying, "CELADON_MART_ROOF", { answer: ANSWER_YES });
  check("a FRESH WATER buys TM13",
        count(carrying, "FRESH_WATER") === 0 && count(carrying, "TM_ICE_BEAM") === 1 &&
        carrying.flags.EVENT_GOT_TM13 === true, JSON.stringify(carrying.bag));
  check("with her own line and the item jingle after it",
        showed(traded, "_CeladonMartRoofLittleGirlYayFreshWaterText") &&
        traded.services.log.indexOf("sound:Get_Item1") >
          logIndexOf(traded, "_CeladonMartRoofLittleGirlReceivedTM13Text"),
        JSON.stringify(traded.services.log));
  const twice = fresh();
  twice.bag.push({ id: "FRESH_WATER", count: 1 });
  twice.flags.EVENT_GOT_TM13 = true;
  const again2 = run(girl, twice, "CELADON_MART_ROOF", { answer: ANSWER_YES });
  check("and a second FRESH WATER buys nothing",
        count(twice, "FRESH_WATER") === 1 && count(twice, "TM_ICE_BEAM") === 0 &&
        showed(again2, "_CeladonMartRoofLittleGirlImThirstyText"), JSON.stringify(again2.text));
  const soda = fresh();
  soda.bag.push({ id: "SODA_POP", count: 1 });
  run(girl, soda, "CELADON_MART_ROOF", { answer: ANSWER_YES });
  check("a SODA POP buys TM48", count(soda, "TM_ROCK_SLIDE") === 1 && soda.flags.EVENT_GOT_TM48 === true);
  const lemon = fresh();
  lemon.bag.push({ id: "LEMONADE", count: 1 });
  run(girl, lemon, "CELADON_MART_ROOF", { answer: ANSWER_YES });
  check("and a LEMONADE buys TM49", count(lemon, "TM_TRI_ATTACK") === 1 && lemon.flags.EVENT_GOT_TM49 === true);
  const keeping = fresh();
  keeping.bag.push({ id: "LEMONADE", count: 1 });
  run(girl, keeping, "CELADON_MART_ROOF", { answer: ANSWER_NO });
  check("saying no keeps the drink", count(keeping, "LEMONADE") === 1 &&
        count(keeping, "TM_TRI_ATTACK") === 0);

  // GameCorner.asm:140-227.
  const clerk = talkScript("GAME_CORNER", "TEXT_GAMECORNER_CLERK1");
  const buyer = fresh();
  buyer.money = 3000;
  buyer.bag.push({ id: "COIN_CASE", count: 1 });
  const coins = run(clerk, buyer, "GAME_CORNER", { answer: ANSWER_YES });
  check("clerk: 1000 yen for 50 coins",
        buyer.coins === 50 && buyer.money === 2000 && showed(coins, "_GameCornerClerk1ThanksHereAre50CoinsText"),
        JSON.stringify({ coins: buyer.coins, money: buyer.money }));
  const noCase = fresh();
  noCase.money = 3000;
  const caseless = run(clerk, noCase, "GAME_CORNER", { answer: ANSWER_YES });
  check("clerk: no COIN CASE, no coins",
        noCase.coins === 0 && noCase.money === 3000 &&
        showed(caseless, "_GameCornerClerk1DontHaveCoinCaseText"), JSON.stringify(caseless.text));
  const stuffed = fresh();
  stuffed.money = 3000;
  stuffed.coins = 9990;
  stuffed.bag.push({ id: "COIN_CASE", count: 1 });
  const tooMany = run(clerk, stuffed, "GAME_CORNER", { answer: ANSWER_YES });
  check("clerk: a full case is refused",
        stuffed.coins === 9990 && stuffed.money === 3000 &&
        showed(tooMany, "_GameCornerClerk1CoinCaseIsFullText"), JSON.stringify(tooMany.text));
  const poor = fresh();
  poor.money = 500;
  poor.bag.push({ id: "COIN_CASE", count: 1 });
  const cantAfford = run(clerk, poor, "GAME_CORNER", { answer: ANSWER_YES });
  check("clerk: and so is an empty wallet",
        poor.coins === 0 && showed(cantAfford, "_GameCornerClerk1CantAffordTheCoinsText"),
        JSON.stringify(cantAfford.text));
  const said = run(clerk, fresh(), "GAME_CORNER", { answer: ANSWER_NO });
  check("clerk: no means come back sometime",
        showed(said, "_GameCornerClerk1PleaseComePlaySometimeText"), JSON.stringify(said.text));

  // GameCorner.asm:455-478: the same lines and both sounds, every time, with
  // no branch on the flag.
  const poster = talkScript("GAME_CORNER", "TEXT_GAMECORNER_POSTER");
  const pushed = fresh();
  const push = run(poster, pushed, "GAME_CORNER");
  check("poster: the switch clicks and the staircase opens",
        pushed.flags.EVENT_FOUND_ROCKET_HIDEOUT === true &&
        push.services.log.indexOf("sound:Switch") >= 0 &&
        push.services.log.indexOf("sound:Go_Inside") > push.services.log.indexOf("sound:Switch"),
        JSON.stringify(push.services.log));
  const again = run(poster, pushed, "GAME_CORNER");
  check("poster: and reads the same way afterwards",
        again.services.log.indexOf("sound:Switch") >= 0, JSON.stringify(again.services.log));

  // CeladonMansionRoofHouse.asm:13-22: no question, no jingle, just EEVEE.
  const ball = talkScript("CELADON_MANSION_ROOF_HOUSE", "TEXT_CELADONMANSION_ROOF_HOUSE_EEVEE_POKEBALL");
  const taker = withParty(fresh());
  const gotIt = run(ball, taker, "CELADON_MANSION_ROOF_HOUSE");
  check("EEVEE: it is given at 25 and the ball is taken away",
        taker.party.some((m) => m.species === "EEVEE" && m.level === 25) &&
        gotIt.services.revealed["CELADON_MANSION_ROOF_HOUSE:CELADONMANSION_ROOF_HOUSE_EEVEE_POKEBALL"] === false,
        JSON.stringify({ party: taker.party.map((m) => m.species), revealed: gotIt.services.revealed }));

  // CeladonMansion3F.asm:27-54: 150 species, Mew discounted.
  const designer = talkScript("CELADON_MANSION_3F", "TEXT_CELADONMANSION3F_GAME_DESIGNER");
  const early = run(designer, ownSpecies(fresh(), 40), "CELADON_MANSION_3F");
  check("the game designer says keep at it", showed(early, "_CeladonMansion3FGameDesignerText"),
        JSON.stringify(early.text));
  const done = run(designer, ownSpecies(fresh(), 150), "CELADON_MANSION_3F");
  check("and congratulates a finished POKeDEX",
        showed(done, "_CeladonMansion3FGameDesignerCompletedDexText"), JSON.stringify(done.text));
}

// ---------------------------------------------------------------------------
// every expansion the transcriber claims is present
// ---------------------------------------------------------------------------
const EXPANDED = [
  ["ROUTE_1", "TEXT_ROUTE1_YOUNGSTER1"], ["CELADON_DINER", "TEXT_CELADONDINER_GYM_GUIDE"],
  ["CELADON_MART_3F", "TEXT_CELADONMART3F_CLERK"], ["ROUTE_12_GATE_2F", "TEXT_ROUTE12GATE2F_BRUNETTE_GIRL"],
  ["CELADON_CITY", "TEXT_CELADONCITY_GRAMPS3"], ["CINNABAR_LAB_METRONOME_ROOM", "TEXT_CINNABARLABMETRONOMEROOM_SCIENTIST1"],
  ["VIRIDIAN_CITY", "TEXT_VIRIDIANCITY_FISHER"], ["SILPH_CO_2F", "TEXT_SILPHCO2F_SILPH_WORKER_F"],
  ["POWER_PLANT", "TEXT_POWERPLANT_VOLTORB1"], ["POWER_PLANT", "TEXT_POWERPLANT_ELECTRODE2"],
  ["ROUTE_23", "TEXT_ROUTE23_GUARD1"], ["ROUTE_23", "TEXT_ROUTE23_SWIMMER2"],
  ["CERULEAN_GYM", "TEXT_CERULEANGYM_GYM_GUIDE"], ["VIRIDIAN_GYM", "TEXT_VIRIDIANGYM_GYM_GUIDE"],
  ["VERMILION_OLD_ROD_HOUSE", "TEXT_VERMILIONOLDRODHOUSE_FISHING_GURU"],
  ["FUCHSIA_GOOD_ROD_HOUSE", "TEXT_FUCHSIAGOODRODHOUSE_FISHING_GURU"],
  ["ROUTE_12_SUPER_ROD_HOUSE", "TEXT_ROUTE12SUPERRODHOUSE_FISHING_GURU"],
  ["ROUTE_12_GATE_2F", "TEXT_ROUTE12GATE2F_LEFT_BINOCULARS"], ["ROUTE_18_GATE_2F", "TEXT_ROUTE18GATE2F_RIGHT_BINOCULARS"],
  ["GAME_CORNER", "TEXT_GAMECORNER_FISHING_GURU"], ["GAME_CORNER", "TEXT_GAMECORNER_GENTLEMAN"],
  ["ROUTE_2_GATE", "TEXT_ROUTE2GATE_OAKS_AIDE"], ["ROUTE_15_GATE_2F", "TEXT_ROUTE15GATE2F_OAKS_AIDE"],
  ["FIGHTING_DOJO", "TEXT_FIGHTINGDOJO_HITMONLEE_POKE_BALL"], ["FIGHTING_DOJO", "TEXT_FIGHTINGDOJO_HITMONCHAN_POKE_BALL"],
  ["MT_MOON_B2F", "TEXT_MTMOONB2F_DOME_FOSSIL"], ["MT_MOON_B2F", "TEXT_MTMOONB2F_HELIX_FOSSIL"],
];
const absent = EXPANDED.filter(([m, k]) => !transcribedScript(m, k));
check("every expansion this suite knows of is in PortedMaps", absent.length === 0, JSON.stringify(absent));

const programs = {
  gift: transcribedScript("ROUTE_1", "TEXT_ROUTE1_YOUNGSTER1"),
  badgeGuard: transcribedScript("ROUTE_23", "TEXT_ROUTE23_GUARD1"),
  badgeBranch: transcribedScript("CERULEAN_GYM", "TEXT_CERULEANGYM_GYM_GUIDE"),
  ballMon: transcribedScript("POWER_PLANT", "TEXT_POWERPLANT_VOLTORB1"),
  rodGiver: transcribedScript("VERMILION_OLD_ROD_HOUSE", "TEXT_VERMILIONOLDRODHOUSE_FISHING_GURU"),
};
testGift(programs.gift);
testBadgeGuard(programs.badgeGuard);
testBadgeBranch(programs.badgeBranch);
testBallMon(programs.ballMon);
testRodGiver(programs.rodGiver);
// The salesman is hand-written now (MapScripts.ts) -- the reference wraps his
// question in a money-box option the transcriber cannot read -- so the fixture
// is fetched the way the game fetches it: hand port first, transcription after.
const salesman = talkScript("MT_MOON_POKECENTER", "TEXT_MTMOONPOKECENTER_MAGIKARP_SALESMAN");
const guide = transcribedScript("PEWTER_GYM", "TEXT_PEWTERGYM_GYM_GUIDE");
testTranscribedAsk(salesman, guide);
programs.binoculars = transcribedScript("ROUTE_12_GATE_2F", "TEXT_ROUTE12GATE2F_LEFT_BINOCULARS");
programs.coinGiver = transcribedScript("GAME_CORNER", "TEXT_GAMECORNER_FISHING_GURU");
programs.oaksAide = transcribedScript("ROUTE_2_GATE", "TEXT_ROUTE2GATE_OAKS_AIDE");
testBinoculars(programs.binoculars);
testCoinGiver(programs.coinGiver);
testOaksAide(programs.oaksAide);
programs.dojoBall = transcribedScript("FIGHTING_DOJO", "TEXT_FIGHTINGDOJO_HITMONLEE_POKE_BALL");
programs.mtMoonFossil = transcribedScript("MT_MOON_B2F", "TEXT_MTMOONB2F_DOME_FOSSIL");
testDojoBall(programs.dojoBall);
testMtMoonFossil(programs.mtMoonFossil);

// ---------------------------------------------------------------------------
// selftest: put the old bugs back into copies and require the suite to go red
// ---------------------------------------------------------------------------
if (selftest) {
  console.log("\n-- selftest --");
  const clone = (p) => JSON.parse(JSON.stringify(p));
  const failsWith = (fn, program) => {
    quiet = true; quietFails = 0;
    fn(program);
    quiet = false;
    return quietFails;
  };

  // The flag BEFORE the give: a full bag halts the VM at the give, and the
  // flag already set loses the gift for good. (The bag probe after the give
  // is belt and braces now that a refused give stops the script.)
  const flagFirst = (program) => {
    const p = clone(program);
    const setAt = p.findIndex((c) => c.op === "set_flag");
    const giveAt = p.findIndex((c) => c.op === "give_item");
    const [setCmd] = p.splice(setAt, 1);
    p.splice(giveAt, 0, setCmd);
    return p;
  };
  check("[selftest] gift with the flag set before the give is caught", failsWith(testGift, flagFirst(programs.gift)) > 0);

  check("[selftest] rodGiver with the flag before the give is caught", failsWith(testRodGiver, flagFirst(programs.rodGiver)) > 0);

  // The two guard lines swapped.
  const swapped = clone(programs.badgeGuard);
  const texts = swapped.filter((c) => c.op === "show_text");
  const t0 = texts[0].textId; texts[0].textId = texts[1].textId; texts[1].textId = t0;
  check("[selftest] badgeGuard with its lines swapped is caught", failsWith(testBadgeGuard, swapped) > 0);

  // A ballMon that fights every time.
  const eager = clone(programs.ballMon).filter((c) => c.op !== "jump_if_true");
  check("[selftest] ballMon that never checks its flag is caught", failsWith(testBallMon, eager) > 0);

  // A question nobody listens to: ask turned into a plain line.
  const deaf = clone(salesman).map((c) => (c.op === "ask" ? { op: "show_text", textId: c.textId } : c));
  check("[selftest] a salesman who ignores the answer is caught",
        failsWith((p) => testTranscribedAsk(p, guide), deaf) > 0);

  // Coins handed out before the case is checked.
  const careless = clone(programs.coinGiver).filter((c) => !(c.op === "check_item" && c.item === "COIN_CASE"));
  check("[selftest] a coin giver who skips the COIN CASE check is caught", failsWith(testCoinGiver, careless) > 0);

  check("[selftest] an aide who sets the flag before the give is caught", failsWith(testOaksAide, flagFirst(programs.oaksAide)) > 0);

  // Binoculars that talk whichever way you face.
  const chatty = clone(programs.binoculars).filter((c) => c.op !== "check_facing" && c.op !== "jump_if_false");
  check("[selftest] binoculars that ignore the facing are caught", failsWith(testBinoculars, chatty) > 0);

  // A ball that hands the prize over before checking it landed.
  const dojoEarly = clone(programs.dojoBall).filter((c) => !(c.op === "jump_if_false" && c.to === "box_full"));
  check("[selftest] a dojo ball that hides itself for a Pokemon that never landed is caught", failsWith(testDojoBall, dojoEarly) > 0);
  check("[selftest] a fossil flagged before the give is caught", failsWith(testMtMoonFossil, flagFirst(programs.mtMoonFossil)) > 0);

  // The unmutated scripts pass the same quiet run, so the failures above are the mutation's.
  check("[selftest] the shipped scripts pass the quiet run",
        failsWith(testGift, programs.gift) + failsWith(testRodGiver, programs.rodGiver) +
        failsWith(testBadgeGuard, programs.badgeGuard) + failsWith(testBallMon, programs.ballMon) +
        failsWith((p) => testTranscribedAsk(p, guide), salesman) +
        failsWith(testCoinGiver, programs.coinGiver) + failsWith(testOaksAide, programs.oaksAide) +
        failsWith(testBinoculars, programs.binoculars) + failsWith(testDojoBall, programs.dojoBall) +
        failsWith(testMtMoonFossil, programs.mtMoonFossil) === 0);
}

console.log(`\n${fail === 0 ? "HELPERS OK" : "HELPERS FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
