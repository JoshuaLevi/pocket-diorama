// A playthrough, driven headlessly: intro, starter, rival, badge, save, resume.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/playloop.test.mjs Assets/Generated/kanto.json [--selftest]
//
// Every other suite in this project tests one layer against one transcription.
// This one tests that the layers are JOINED, because for a long time they were
// not: the battle engine was complete and nothing outside play/battle imported
// it, the script VM was complete and no host implemented it, and talking to an
// NPC did nothing at all. Each layer's own tests were green throughout.
//
// The services are faked, which is the point -- PlayHost is pure logic over a
// narrow port precisely so a conversation, a badge handover and the intro can be
// driven without wearing a headset. What is NOT faked is the bundle: the text,
// the maps, the species and the trainer rosters all come from the real cartridge
// extraction, so a line that does not exist or a roster that is missing fails
// here rather than on a face.
//
// `--selftest` breaks things on purpose and checks this file notices.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: playloop.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const { ScriptVM, DONE } = await import(P + "script/ScriptVM.ts");
const { PlayHost, ANSWER_PENDING, ANSWER_YES, ANSWER_NO, rivalRosterFor } =
  await import(P + "script/Host.ts");
const { talkScript, OAK_SPEECH, requiredRoutines } = await import(P + "script/MapScripts.ts");
const PlayState = await import(P + "PlayState.ts");
const { PlayLoop } = await import(P + "PlayLoop.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "PLAYLOOP", "Red's starter and story scenes through the loop");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

// ---------------------------------------------------------------------------
// A fake of everything outside the host. It answers instantly and records.
// ---------------------------------------------------------------------------

function makeServices(mapId, opts) {
  const o = opts || {};
  const log = [];
  let answerValue = o.answer === undefined ? ANSWER_YES : o.answer;
  let battleRunning = false;
  let battlesFought = [];
  let frame = 0;
  const revealed = {};
  const services = {
    log,
    revealed,
    battlesFought,
    setAnswer: (v) => { answerValue = v; },

    showLines: (lines) => log.push("text:" + lines.join(" ")),
    // One frame per page: acknowledged as soon as it is shown.
    pageAcknowledged: () => true,
    closeBox: () => log.push("close"),
    answer: () => answerValue,
    requestAnswer: () => log.push("ask"),

    currentMap: () => bundle.maps[mapId],
    facePlayer: () => log.push("face"),
    faceNpc: (n, d) => log.push("faceNpc:" + n + ":" + d),
    setNpcRevealed: (m, n, v) => { revealed[(m || mapId) + ":" + n] = v; log.push("reveal:" + n + ":" + v); },
    // Recorded, like fakeservices.mjs: a cutscene that puts an NPC somewhere
    // before showing it (Bill out of the teleporter, the Cerulean rival in the
    // player's column) is only checkable by the order of these two.
    placeNpc: (n, x, y, f) => log.push("place:" + n + ":" + x + "," + y + ":" + f),
    moveNpc: (n, path) => { log.push("move:" + n + ":" + (path || []).join(",")); return DONE; },
    movePlayer: () => DONE,
    npcPose: () => null,
    emote: () => DONE,
    facePlayerDir: (d) => log.push("facePlayerDir:" + d),
    walkNpc: () => DONE,
    moveNpcTo: () => DONE,
    playMusic: (t) => log.push("music:" + t),
    stopMusic: () => log.push("music:stop"),
    playDefaultMusic: () => log.push("music:default"),
    textSound: (n) => log.push("sound:" + n),
    warp: (m, w) => log.push("warp:" + m + ":" + w),
    warpTo: (m, x, y) => log.push("warpTo:" + m + ":" + x + "," + y),

    openShop: (stock) => log.push("shop:" + stock.join(",")),
    shopOpen: () => false,
    openPc: (kind) => log.push("pc:" + kind), pcOpen: () => false,

    beginTrainerBattle: (t, p) => {
      battlesFought.push(t + "#" + p);
      log.push("battle:" + t + "#" + p);
      battleRunning = true;
      // The fake battle lasts exactly one frame unless a test says otherwise.
      if (!o.battleHangs) { battleRunning = false; }
    },
    battleOver: () => !battleRunning,
    battleWon: () => true,

    playCry: (s) => log.push("cry:" + s),
    fade: (d) => { log.push("fade:" + d); return DONE; },
    playOnce: (t) => { log.push("jingle:" + t); return DONE; },
    frames: () => frame++,

    introStage: (w) => log.push("stage:" + w),
    nameEntry: (w) => { log.push("name:" + w); return DONE; },
    dexEntry: (s) => { log.push("dex:" + s); return DONE; },
    // The lab's balls answer only when faced from below, as measured; a test
    // that needs another facing passes it in.
    playerFacing: () => (o.facing ? o.facing : "up"),
    playerCell: () => [0, 0],
    blocksChanged: (m) => log.push("blocks:" + m),
    random: () => 0.5,
  };
  return services;
}

/** Runs a script to completion (or until it stops making progress). */
function run(program, state, mapId, opts) {
  const services = makeServices(mapId, opts);
  const host = new PlayHost(bundle, state, services);
  const vm = new ScriptVM(host, state.flags);
  vm.start(program);
  let frames = 0;
  while (vm.isRunning() && frames < 500) {
    vm.update();
    frames++;
  }
  return { services, vm, frames, running: vm.isRunning() };
}

// ---------------------------------------------------------------------------
// 1. The intro
// ---------------------------------------------------------------------------

console.log("\n== A new game ==");
{
  const state = PlayState.newPlayState(bundle.romSha1);
  const r = run(OAK_SPEECH, state, "PALLET_TOWN");
  check("the intro runs to its end", !r.running, r.frames + " frames");
  check("it shows Oak's opening line",
        r.services.log.some((l) => l.indexOf("Hello there!") >= 0),
        JSON.stringify(r.services.log.slice(0, 4)));
  check("the first sound is the Nidorino cry",
        r.services.log.indexOf("cry:NIDORINO") >= 0);
  check("both names are asked for",
        r.services.log.filter((l) => l.indexOf("name:") === 0).length === 2,
        JSON.stringify(r.services.log.filter((l) => l.indexOf("name:") === 0)));
  // Where the cartridge puts a new game, measured in PyBoy: (3,6), facing up.
  check("and it leaves the player in the bedroom where the cartridge does",
        r.services.log.indexOf("warpTo:REDS_HOUSE_2F:3,6") >= 0 &&
        state.flags.EVENT_INTRO_DONE === true,
        JSON.stringify(r.services.log.filter((l) => l.indexOf("warp") === 0)));
}

// ---------------------------------------------------------------------------
// 2. The starter
// ---------------------------------------------------------------------------

console.log("\n== Oak's lab ==");
function tookStarter(species, textKey, answer) {
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_FOLLOWED_OAK_INTO_LAB = true;
  const r = run(talkScript("OAKS_LAB", textKey), state, "OAKS_LAB", { answer: answer });
  return { state, r };
}

{
  const taken = tookStarter("CHARMANDER", "TEXT_OAKSLAB_CHARMANDER_POKE_BALL", ANSWER_YES);
  check("saying yes puts a Pokemon in the party",
        taken.state.party.length === 1, JSON.stringify(taken.r.services.log));
  check("it is the one that was asked about",
        taken.state.party.length === 1 && taken.state.party[0].species === "CHARMANDER",
        taken.state.party.length ? taken.state.party[0].species : "none");
  check("at level 5 with real stats",
        taken.state.party.length === 1 && taken.state.party[0].level === 5 &&
        taken.state.party[0].maxHp > 0,
        taken.state.party.length ? JSON.stringify({
          lv: taken.state.party[0].level, hp: taken.state.party[0].maxHp,
        }) : "none");
  check("it has a battle portrait in the bundle",
        bundle.species.CHARMANDER.front !== undefined,
        "the starter would be invisible in battle");
  check("the dex records it as owned",
        taken.state.dexOwned[bundle.species.CHARMANDER.dex - 1] === true);
  check("and the starter flag is set",
        taken.state.flags.EVENT_GOT_STARTER === true);

  const refused = tookStarter("SQUIRTLE", "TEXT_OAKSLAB_SQUIRTLE_POKE_BALL", ANSWER_NO);
  check("saying no hands over nothing",
        refused.state.party.length === 0 &&
        refused.state.flags.EVENT_GOT_STARTER !== true);
}

// ---------------------------------------------------------------------------
// 3. The rival
// ---------------------------------------------------------------------------

{
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_GOT_STARTER = true;
  state.flags.EVENT_CHOSE_CHARMANDER = true;
  state.party.push(makeMon("CHARMANDER", 5));
  const r = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_RIVAL"), state, "OAKS_LAB");
  check("the rival fights you once you have a Pokemon",
        r.services.battlesFought.length === 1, JSON.stringify(r.services.battlesFought));
  check("against the roster his own starter picked",
        r.services.battlesFought[0] === "OPP_RIVAL1#" + rivalRosterFor(state),
        r.services.battlesFought[0]);
  check("and the battle is recorded as fought",
        state.flags.EVENT_BATTLED_RIVAL_IN_OAKS_LAB === true);
  check("OPP_RIVAL1 has that roster in the bundle",
        bundle.trainers && bundle.trainers.OPP_RIVAL1 &&
        bundle.trainers.OPP_RIVAL1.parties.length >= rivalRosterFor(state),
        bundle.trainers ? JSON.stringify(Object.keys(bundle.trainers).length) + " trainers"
                        : "no trainers in the bundle");
}

// ---------------------------------------------------------------------------
// 3b. What a script hides stays hidden across a save
// ---------------------------------------------------------------------------

console.log("\n== Hidden NPCs survive a reload ==");
{
  const state = PlayState.newPlayState(bundle.romSha1);
  const loop = new PlayLoop(bundle, state, makeServices("PEWTER_CITY"));
  loop.setRevealed("PEWTER_CITY", "PEWTERCITY_YOUNGSTER", false);
  loop.setRevealed("OAKS_LAB", "OAKSLAB_RIVAL", true);
  // The write, the read-back and the migration are the whole round trip a real
  // session makes; the reveal store used to live in the loop and came back
  // empty every time.
  const reloaded = PlayState.migratePlayState(JSON.parse(JSON.stringify(state)), bundle.romSha1);
  const next = new PlayLoop(bundle, reloaded, makeServices("PEWTER_CITY"));
  check("a hidden NPC is still hidden after a save and reload",
        next.revealOf("PEWTER_CITY", "PEWTERCITY_YOUNGSTER") === false,
        JSON.stringify(reloaded.objectToggles));
  check("and a revealed one still revealed", next.revealOf("OAKS_LAB", "OAKSLAB_RIVAL") === true);
  check("an untouched NPC is as shipped", next.revealOf("PEWTER_CITY", "PEWTERCITY_GYM_GUIDE") === undefined);
  const old = JSON.parse(JSON.stringify(state));
  delete old.objectToggles;
  const fromOld = PlayState.migratePlayState(old, bundle.romSha1);
  const loopOld = new PlayLoop(bundle, fromOld, makeServices("PEWTER_CITY"));
  check("a save from before the field loads with nothing toggled",
        fromOld.objectToggles && Object.keys(fromOld.objectToggles).length === 0 &&
        loopOld.revealOf("PEWTER_CITY", "PEWTERCITY_YOUNGSTER") === undefined);
}

// ---------------------------------------------------------------------------
// 4. The first badge
// ---------------------------------------------------------------------------

console.log("\n== Plain NPCs and signs have words ==");
{
  // The loop used to start nothing for a target without a script; the comment
  // said the caller showed the words, and the lens never did. A Pallet Town
  // girl and a signpost are the plainest things in the game.
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_INTRO_DONE = true;
  const services = makeServices("PALLET_TOWN");
  const loop = new PlayLoop(bundle, state, services);
  const map = bundle.maps.PALLET_TOWN;
  const girl = map.objects.find((o) => o.text === "TEXT_PALLETTOWN_GIRL");
  const target = loop.interact(map, girl.x, girl.y + 1, "up");
  for (let i = 0; i < 40 && loop.isBusy(); i++) { loop.update(); }
  const spoken = services.log.filter((l) => l.indexOf("text:") === 0);
  check("a script-less NPC says her line", target !== null && spoken.length > 0 &&
        services.log.indexOf("face") >= 0, JSON.stringify(services.log));
  const sign = map.signs[0];
  const s2 = makeServices("PALLET_TOWN");
  const loop2 = new PlayLoop(bundle, state, s2);
  loop2.interact(map, sign.x, sign.y + 1, "up");
  for (let i = 0; i < 40 && loop2.isBusy(); i++) { loop2.update(); }
  check("and a signpost is readable", s2.log.some((l) => l.indexOf("text:") === 0) && s2.log.indexOf("face") < 0,
        JSON.stringify(s2.log));
}

console.log("\n== The intro is reachable ==");
{
  const state = PlayState.newPlayState(bundle.romSha1);
  const services = makeServices("PALLET_TOWN");
  const loop = new PlayLoop(bundle, state, services);
  check("a fresh save needs the intro", loop.needsIntro() === true);
  check("and the loop starts it", loop.startIntroIfNeeded() === true && loop.isBusy());
  for (let i = 0; i < 400 && loop.isBusy(); i++) { loop.update(); }
  check("Oak's speech runs to its end through the loop", !loop.isBusy() && state.flags.EVENT_INTRO_DONE === true,
        JSON.stringify(services.log.slice(-4)));
  check("and is not started twice", loop.needsIntro() === false && loop.startIntroIfNeeded() === false);
}

console.log("\n== Item balls ==");
{
  const cave = bundle.maps.CERULEAN_CAVE_1F;
  const ball = cave.objects.find((o) => o.name === "CERULEANCAVE1F_NUGGET");
  check("the Nugget ball is an object with an item", !!ball && ball.item === "NUGGET" && ball.sprite === "SPRITE_POKE_BALL");
  const pickUp = (state, services) => {
    const loop = new PlayLoop(bundle, state, services);
    const target = loop.interact(cave, ball.x, ball.y + 1, "up");
    for (let i = 0; i < 60 && loop.isBusy(); i++) { loop.update(); }
    return { loop, target };
  };
  const has = (state, id) => state.bag.filter((s) => s.id === id).reduce((n, s) => n + s.count, 0);

  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_INTRO_DONE = true;
  const services = makeServices("CERULEAN_CAVE_1F");
  const first = pickUp(state, services);
  check("talking to the ball puts the Nugget in the bag", has(state, "NUGGET") === 1, JSON.stringify(state.bag));
  check("the ball is gone, in the save", state.objectToggles["CERULEAN_CAVE_1F:CERULEANCAVE1F_NUGGET"] === false,
        JSON.stringify(state.objectToggles));
  check("with the found line naming the item and the jingle",
        services.log.some((l) => l.indexOf("text:") === 0 && l.indexOf("found") >= 0 && l.indexOf("NUGGET") >= 0) &&
        services.log.indexOf("sound:Get_Item1") >= 0, JSON.stringify(services.log));
  const second = first.loop.interact(cave, ball.x, ball.y + 1, "up");
  check("a taken ball cannot be talked to again", second === null && has(state, "NUGGET") === 1);

  const reloaded = PlayState.migratePlayState(JSON.parse(JSON.stringify(state)), bundle.romSha1);
  const again = new PlayLoop(bundle, reloaded, makeServices("CERULEAN_CAVE_1F"));
  check("and stays gone after a save and reload", again.interact(cave, ball.x, ball.y + 1, "up") === null);

  const full = PlayState.newPlayState(bundle.romSha1);
  full.flags.EVENT_INTRO_DONE = true;
  const filler = Object.keys(bundle.items).filter((id) => id !== "NUGGET" && id.indexOf("BADGE") < 0).slice(0, 20);
  for (const id of filler) { PlayState.giveItem(full, id, 1); }
  check("the filler bag is really full", full.bag.length === 20);
  const sf = makeServices("CERULEAN_CAVE_1F");
  pickUp(full, sf);
  check("a full bag is refused and the ball stays",
        has(full, "NUGGET") === 0 && full.objectToggles["CERULEAN_CAVE_1F:CERULEANCAVE1F_NUGGET"] === undefined &&
        sf.log.some((l) => l.indexOf("text:") === 0) && !sf.log.some((l) => l.indexOf("found") >= 0),
        JSON.stringify(sf.log));
  PlayState.takeItem(full, filler[0], 1);
  pickUp(full, makeServices("CERULEAN_CAVE_1F"));
  check("and once there is room the ball can be taken", has(full, "NUGGET") === 1);

  const stacked = PlayState.newPlayState(bundle.romSha1);
  stacked.flags.EVENT_INTRO_DONE = true;
  PlayState.giveItem(stacked, "NUGGET", 1);
  pickUp(stacked, makeServices("CERULEAN_CAVE_1F"));
  check("a held stack takes the second one", has(stacked, "NUGGET") === 2 &&
        stacked.objectToggles["CERULEAN_CAVE_1F:CERULEANCAVE1F_NUGGET"] === false);

  // A hidden ball: the LIFT KEY, which a script reveals.
  const hideout = bundle.maps.ROCKET_HIDEOUT_B4F;
  const key = hideout.objects.find((o) => o.name === "ROCKETHIDEOUTB4F_LIFT_KEY");
  const hs = PlayState.newPlayState(bundle.romSha1);
  hs.flags.EVENT_INTRO_DONE = true;
  const hl = new PlayLoop(bundle, hs, makeServices("ROCKET_HIDEOUT_B4F"));
  check("the LIFT KEY ball ships hidden and cannot be taken", key.hidden === true &&
        hl.interact(hideout, key.x, key.y + 1, "up") === null);
  hl.setRevealed("ROCKET_HIDEOUT_B4F", key.name, true);
  hl.interact(hideout, key.x, key.y + 1, "up");
  for (let i = 0; i < 60 && hl.isBusy(); i++) { hl.update(); }
  check("revealed, it is picked up like any other", has(hs, "LIFT_KEY") === 1 &&
        hs.objectToggles["ROCKET_HIDEOUT_B4F:ROCKETHIDEOUTB4F_LIFT_KEY"] === false);

  // The "0" sentinel: a plain object that carries item "0" is not a ball.
  const blues = bundle.maps.BLUES_HOUSE;
  const townMap = blues.objects.find((o) => o.name === "BLUESHOUSE_TOWN_MAP");
  const zs = PlayState.newPlayState(bundle.romSha1);
  zs.flags.EVENT_INTRO_DONE = true;
  const zl = new PlayLoop(bundle, zs, makeServices("BLUES_HOUSE"));
  const zt = zl.interact(blues, townMap.x, townMap.y + 1, "up");
  for (let i = 0; i < 60 && zl.isBusy(); i++) { zl.update(); }
  check("an object with item \"0\" gives nothing", zt !== null && zt.item === "" && zs.bag.length === 0);

  // Order of effects: parked on the found line, the item and the hide have landed.
  const os = PlayState.newPlayState(bundle.romSha1);
  os.flags.EVENT_INTRO_DONE = true;
  const osv = makeServices("CERULEAN_CAVE_1F");
  osv.pageAcknowledged = () => false;
  const ol = new PlayLoop(bundle, os, osv);
  ol.interact(cave, ball.x, ball.y + 1, "up");
  for (let i = 0; i < 3; i++) { ol.update(); }
  check("while the found line is up, the item and the hide have already landed and saving is refused",
        ol.isBusy() && has(os, "NUGGET") === 1 &&
        os.objectToggles["CERULEAN_CAVE_1F:CERULEANCAVE1F_NUGGET"] === false && ol.canSave() === false,
        JSON.stringify({ busy: ol.isBusy(), bag: os.bag, toggles: os.objectToggles }));
}

console.log("\n== A trainer with no script fights ==");
{
  check("the bundle carries the trainer headers (re-bake with tools/bake.mjs if not)",
        !!bundle.trainerHeaders && Object.keys(bundle.trainerHeaders).length > 60,
        bundle.trainerHeaders ? Object.keys(bundle.trainerHeaders).length + " maps" : "missing");
  const gym = bundle.maps.CELADON_GYM;
  const lass = gym.objects.find((o) => o.name === "CELADONGYM_COOLTRAINER_F1");
  check("Celadon's first Lass is OPP_LASS roster 17", !!lass && lass.trainerClass === "OPP_LASS" && lass.trainerParty === 17);
  const talk = (state, won) => {
    const services = makeServices("CELADON_GYM");
    if (won === false) { services.battleWon = () => false; }
    const loop = new PlayLoop(bundle, state, services);
    loop.interact(gym, lass.x, lass.y + 1, "up");
    for (let i = 0; i < 80 && loop.isBusy(); i++) { loop.update(); }
    return { services, loop };
  };
  const first = (id) => bundle.text[id].split(/[\n\f\x0b\x0c]/)[0];
  // A page is logged as its lines joined by a space, so match on the first line.
  const texts = (services) => services.log.filter((l) => l.indexOf("text:") === 0).map((l) => l.substring(5));
  const opens = (page, id) => typeof page === "string" && page.indexOf(first(id)) === 0;
  const anyOpens = (pages, id) => pages.some((p) => opens(p, id));

  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_INTRO_DONE = true;
  state.party.push(makeMon("CHARMANDER", 30));
  const win = talk(state);
  check("talking to her starts her own roster", win.services.battlesFought[0] === "OPP_LASS#17",
        JSON.stringify(win.services.battlesFought));
  const shown = texts(win.services);
  check("the challenge line comes before the battle, the end line after, nothing from the after line",
        opens(shown[0], "_CeladonGymBattleText2") && anyOpens(shown.slice(1), "_CeladonGymEndBattleText2") &&
        !anyOpens(shown, "_CeladonGymAfterBattleText2") &&
        win.services.log.indexOf("text:" + shown[0]) < win.services.log.indexOf("battle:OPP_LASS#17"),
        JSON.stringify(win.services.log));
  check("the defeat is recorded twice: her event bit and the object",
        state.flags.EVENT_BEAT_CELADON_GYM_TRAINER_0 === true &&
        state.defeatedTrainers["CELADON_GYM:CELADONGYM_COOLTRAINER_F1"] === true, JSON.stringify(state.defeatedTrainers));
  const again = talk(state);
  check("a beaten trainer does not fight and says the after line",
        again.services.battlesFought.length === 0 && opens(texts(again.services)[0], "_CeladonGymAfterBattleText2"),
        JSON.stringify(again.services.log));

  const lost = PlayState.newPlayState(bundle.romSha1);
  lost.flags.EVENT_INTRO_DONE = true;
  lost.party.push(makeMon("CHARMANDER", 30));
  const l = talk(lost, false);
  check("a loss records nothing", l.services.battlesFought.length === 1 &&
        lost.flags.EVENT_BEAT_CELADON_GYM_TRAINER_0 !== true && !lost.defeatedTrainers["CELADON_GYM:CELADONGYM_COOLTRAINER_F1"] &&
        !anyOpens(texts(l.services), "_CeladonGymEndBattleText2"), JSON.stringify(l.services.log));
  check("and she fights again", talk(lost, false).services.battlesFought.length === 1);

  const empty = PlayState.newPlayState(bundle.romSha1);
  empty.flags.EVENT_INTRO_DONE = true;
  const e = talk(empty);
  check("with nothing to send out the challenge shows and no battle or record follows",
        opens(texts(e.services)[0], "_CeladonGymBattleText2") && e.services.battlesFought.length === 0 &&
        empty.flags.EVENT_BEAT_CELADON_GYM_TRAINER_0 !== true, JSON.stringify(e.services.log));

  const reloaded = PlayState.migratePlayState(JSON.parse(JSON.stringify(state)), bundle.romSha1);
  check("the record survives a reload", reloaded.defeatedTrainers["CELADON_GYM:CELADONGYM_COOLTRAINER_F1"] === true);
  const old = JSON.parse(JSON.stringify(state));
  delete old.defeatedTrainers;
  const fromOld = PlayState.migratePlayState(old, bundle.romSha1);
  check("a save from before the field loads with an empty record", fromOld.defeatedTrainers && Object.keys(fromOld.defeatedTrainers).length === 0);

  // The count the header table cannot serve: trainer objects without a row.
  const bare = [];
  for (const mapId of Object.keys(bundle.maps)) {
    const m = bundle.maps[mapId];
    for (const o of m.objects) {
      if (!o.trainerClass) { continue; }
      const table = bundle.trainerHeaders[m.label];
      if (!table || !table["" + o.index]) { bare.push(o.name); }
    }
  }
  check("exactly the twenty-three header-less trainers are known by name (they get hand entries, not silent fights)",
        bare.length === 23 && bare.indexOf("FIGHTINGDOJO_KARATE_MASTER") >= 0 && bare.indexOf("CINNABARGYM_SUPER_NERD1") >= 0,
        bare.length + ": " + bare.join(","));
}

console.log("\n== Pewter Gym ==");
function fightBrock(state) {
  return run(talkScript("PEWTER_GYM", "TEXT_PEWTERGYM_BROCK"), state, "PEWTER_GYM");
}

{
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party.push(makeMon("CHARMANDER", 14));
  // The two flags Oak's lab sets and Brock's victory takes back down, so the
  // ResetEvents below is asserted against a real "before".
  state.flags.EVENT_1ST_ROUTE22_RIVAL_BATTLE = true;
  state.flags.EVENT_ROUTE22_RIVAL_WANTS_BATTLE = true;
  const first = fightBrock(state);
  check("Brock fights", first.services.battlesFought[0] === "OPP_BROCK#1",
        JSON.stringify(first.services.battlesFought));
  check("his roster is in the bundle",
        bundle.trainers.OPP_BROCK.parties[0].length === 2,
        JSON.stringify(bundle.trainers.OPP_BROCK.parties[0]));
  check("winning sets the badge, not a bag item",
        state.badges[0] === true &&
        !state.bag.some((s) => s.id === "BOULDERBADGE"),
        JSON.stringify({ badges: state.badges, bag: state.bag }));
  check("the badge count the battle engine sees is 1",
        PlayState.badgeCount(state) === 1);
  // The ITEM is TM_BIDE; only the FLAG is called EVENT_GOT_TM34. Asserting on
  // the flag name as an item id is the exact mistake Victories.ts exists to stop,
  // and this test made it until the reference said otherwise.
  check("and Brock's TM lands in the bag under its item id",
        state.bag.some((s) => s.id === "TM_BIDE"), JSON.stringify(state.bag));
  // PewterGymScriptReceiveTM34's `ResetEvents EVENT_1ST_ROUTE22_RIVAL_BATTLE,
  // EVENT_ROUTE22_RIVAL_WANTS_BATTLE`. The victory table could only ever write
  // true until this existed, so the first Route 22 rival window never closed.
  check("and the first Route 22 rival window is closed behind him",
        state.flags.EVENT_1ST_ROUTE22_RIVAL_BATTLE === false &&
        state.flags.EVENT_ROUTE22_RIVAL_WANTS_BATTLE === false,
        JSON.stringify({ first: state.flags.EVENT_1ST_ROUTE22_RIVAL_BATTLE,
                         wants: state.flags.EVENT_ROUTE22_RIVAL_WANTS_BATTLE }));

  const again = fightBrock(state);
  check("a beaten Brock does not fight again",
        again.services.battlesFought.length === 0,
        JSON.stringify(again.services.battlesFought));
  check("and does not hand out a second badge or TM",
        PlayState.badgeCount(state) === 1 &&
        state.bag.filter((s) => s.id === "TM_BIDE").length === 1);
}

// The retry the give_tm routine exists for: beaten, bag full at the time.
{
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party.push(makeMon("CHARMANDER", 14));
  for (let i = 0; i < 20; i++) { PlayState.giveItem(state, "FILLER" + i, 1); }
  const r = fightBrock(state);
  check("a TM refused for want of room is not silently lost",
        state.flags.EVENT_GOT_TM34 !== true && !state.bag.some((s) => s.id === "TM_BIDE"),
        JSON.stringify(state.bag.length));
  PlayState.takeItem(state, "FILLER0", 1);
  fightBrock(state);
  check("and is handed over on the next conversation",
        state.bag.some((s) => s.id === "TM_BIDE"),
        JSON.stringify(state.bag.map((b) => b.id)));
}

// ---------------------------------------------------------------------------
// 5. Closing the lens and coming back
// ---------------------------------------------------------------------------

console.log("\n== The other seven gyms ==");
{
  const LEADERS = [
    ["CERULEAN_GYM", "CERULEANGYM_MISTY", "OPP_MISTY#1", 1, "TM_BUBBLEBEAM", "EVENT_BEAT_MISTY"],
    ["VERMILION_GYM", "VERMILIONGYM_LT_SURGE", "OPP_LT_SURGE#1", 2, "TM_THUNDERBOLT", "EVENT_BEAT_LT_SURGE"],
    ["CELADON_GYM", "CELADONGYM_ERIKA", "OPP_ERIKA#1", 3, "TM_MEGA_DRAIN", "EVENT_BEAT_ERIKA"],
    ["FUCHSIA_GYM", "FUCHSIAGYM_KOGA", "OPP_KOGA#1", 4, "TM_TOXIC", "EVENT_BEAT_KOGA"],
    ["SAFFRON_GYM", "SAFFRONGYM_SABRINA", "OPP_SABRINA#1", 5, "TM_PSYWAVE", "EVENT_BEAT_SABRINA"],
    ["CINNABAR_GYM", "CINNABARGYM_BLAINE", "OPP_BLAINE#1", 6, "TM_FIRE_BLAST", "EVENT_BEAT_BLAINE"],
    ["VIRIDIAN_GYM", "VIRIDIANGYM_GIOVANNI", "OPP_GIOVANNI#3", 7, "TM_FISSURE", "EVENT_BEAT_GIOVANNI"],
  ];
  const talkTo = (mapId, name, state) => {
    const services = makeServices(mapId);
    const loop = new PlayLoop(bundle, state, services);
    const o = bundle.maps[mapId].objects.find((x) => x.name === name);
    loop.interact(bundle.maps[mapId], o.x, o.y + 1, "up");
    for (let i = 0; i < 120 && loop.isBusy(); i++) { loop.update(); }
    return { services, loop };
  };
  for (const [mapId, name, key, badge, tm, flag] of LEADERS) {
    const state = PlayState.newPlayState(bundle.romSha1);
    state.flags.EVENT_INTRO_DONE = true;
    state.party.push(makeMon("CHARMANDER", 50));
    const win = talkTo(mapId, name, state);
    check(name + " fights " + key + " and pays a badge and a TM",
          win.services.battlesFought[0] === key && state.badges[badge] === true &&
          state.flags[flag] === true && state.bag.some((b) => b.id === tm),
          JSON.stringify({ fought: win.services.battlesFought, badges: state.badges, bag: state.bag }));
    if (mapId === "VIRIDIAN_GYM") {
      check("Giovanni is still in the gym after the winning talk",
            win.loop.revealOf("VIRIDIAN_GYM", "VIRIDIANGYM_GIOVANNI") === undefined);
    }
    const again = talkTo(mapId, name, state);
    check(name + " fights nothing twice and gives nothing twice",
          again.services.battlesFought.length === 0 && state.bag.filter((b) => b.id === tm).length === 1 &&
          state.bag.find((b) => b.id === tm).count === 1, JSON.stringify(state.bag));
    if (mapId === "VIRIDIAN_GYM") {
      check("and leaves the gym after his advice on the second talk",
            again.loop.revealOf("VIRIDIAN_GYM", "VIRIDIANGYM_GIOVANNI") === false, JSON.stringify(state.objectToggles));
    }
  }
}

console.log("\n== The bosses without a header ==");
{
  const talkTo = (mapId, name, state) => {
    const services = makeServices(mapId);
    const loop = new PlayLoop(bundle, state, services);
    const o = bundle.maps[mapId].objects.find((x) => x.name === name);
    loop.interact(bundle.maps[mapId], o.x, o.y + 1, "up");
    for (let i = 0; i < 120 && loop.isBusy(); i++) { loop.update(); }
    return { services, loop };
  };
  const first = (id) => bundle.text[id].split(/[\n\f\x0b\x0c]/)[0];
  const spoke = (services, id) => services.log.some((l) => l.indexOf("text:" + first(id)) === 0);

  const dojo = PlayState.newPlayState(bundle.romSha1);
  dojo.flags.EVENT_INTRO_DONE = true;
  dojo.party.push(makeMon("CHARMANDER", 50));
  const km = talkTo("FIGHTING_DOJO", "FIGHTINGDOJO_KARATE_MASTER", dojo);
  check("the Karate Master fights as OPP_BLACKBELT#1 and offers a Pokemon",
        km.services.battlesFought[0] === "OPP_BLACKBELT#1" && dojo.flags.EVENT_BEAT_KARATE_MASTER === true &&
        spoke(km.services, "_FightingDojoKarateMasterIWillGiveYouAPokemonText"), JSON.stringify(km.services.log));
  const belt = talkTo("FIGHTING_DOJO", "FIGHTINGDOJO_BLACKBELT1", dojo);
  check("his win retires the Blackbelts through the victory table",
        dojo.flags.EVENT_BEAT_FIGHTING_DOJO_TRAINER_0 === true && belt.services.battlesFought.length === 0 &&
        belt.services.log.some((l) => l.indexOf("text:") === 0), JSON.stringify(belt.services.log));
  const km2 = talkTo("FIGHTING_DOJO", "FIGHTINGDOJO_KARATE_MASTER", dojo);
  check("and afterwards he asks you to stay and train",
        km2.services.battlesFought.length === 0 && spoke(km2.services, "_FightingDojoKarateMasterStayAndTrainWithUsText"));

  const cin = PlayState.newPlayState(bundle.romSha1);
  cin.flags.EVENT_INTRO_DONE = true;
  cin.party.push(makeMon("CHARMANDER", 50));
  const nerd = talkTo("CINNABAR_GYM", "CINNABARGYM_SUPER_NERD1", cin);
  check("Cinnabar's quiz trainers fight by their hand-written header",
        nerd.services.battlesFought[0] === "OPP_SUPER_NERD#9" && cin.flags.EVENT_BEAT_CINNABAR_GYM_TRAINER_0 === true &&
        spoke(nerd.services, "_CinnabarGymSuperNerd1BattleText"), JSON.stringify(nerd.services.log));
  talkTo("CINNABAR_GYM", "CINNABARGYM_BLAINE", cin);
  const nerd2 = talkTo("CINNABAR_GYM", "CINNABARGYM_SUPER_NERD2", cin);
  check("and beating Blaine retires the ones you skipped", nerd2.services.battlesFought.length === 0 &&
        cin.flags.EVENT_BEAT_CINNABAR_GYM_TRAINER_1 === true, JSON.stringify(nerd2.services.log));

  const hide = PlayState.newPlayState(bundle.romSha1);
  hide.flags.EVENT_INTRO_DONE = true;
  hide.party.push(makeMon("CHARMANDER", 50));
  const gio = talkTo("ROCKET_HIDEOUT_B4F", "ROCKETHIDEOUTB4F_GIOVANNI", hide);
  check("the hideout's Giovanni fights OPP_GIOVANNI#1, leaves, and the SILPH SCOPE appears",
        gio.services.battlesFought[0] === "OPP_GIOVANNI#1" && hide.flags.EVENT_BEAT_ROCKET_HIDEOUT_GIOVANNI === true &&
        gio.loop.revealOf("ROCKET_HIDEOUT_B4F", "ROCKETHIDEOUTB4F_GIOVANNI") === false &&
        gio.loop.revealOf("ROCKET_HIDEOUT_B4F", "ROCKETHIDEOUTB4F_SILPH_SCOPE") === true,
        JSON.stringify(hide.objectToggles));
  const scope = bundle.maps.ROCKET_HIDEOUT_B4F.objects.find((o) => o.name === "ROCKETHIDEOUTB4F_SILPH_SCOPE");
  gio.loop.interact(bundle.maps.ROCKET_HIDEOUT_B4F, scope.x, scope.y + 1, "up");
  for (let i = 0; i < 60 && gio.loop.isBusy(); i++) { gio.loop.update(); }
  check("and the SILPH SCOPE can then be picked up", hide.bag.some((b) => b.id === "SILPH_SCOPE"), JSON.stringify(hide.bag));

  const grunt = talkTo("ROCKET_HIDEOUT_B4F", "ROCKETHIDEOUTB4F_ROCKET3", hide);
  check("the grunt by the lift fights OPP_ROCKET#18 and keeps the key in his pocket for now",
        grunt.services.battlesFought[0] === "OPP_ROCKET#18" && hide.flags.EVENT_BEAT_ROCKET_HIDEOUT_4_TRAINER_2 === true &&
        grunt.loop.revealOf("ROCKET_HIDEOUT_B4F", "ROCKETHIDEOUTB4F_LIFT_KEY") === undefined, JSON.stringify(grunt.services.log));
  const grunt2 = talkTo("ROCKET_HIDEOUT_B4F", "ROCKETHIDEOUTB4F_ROCKET3", hide);
  check("the first talk after his defeat drops the LIFT KEY",
        grunt2.services.battlesFought.length === 0 && hide.flags.EVENT_ROCKET_DROPPED_LIFT_KEY === true &&
        grunt2.loop.revealOf("ROCKET_HIDEOUT_B4F", "ROCKETHIDEOUTB4F_LIFT_KEY") === true, JSON.stringify(hide.objectToggles));
  const keyBall = bundle.maps.ROCKET_HIDEOUT_B4F.objects.find((o) => o.name === "ROCKETHIDEOUTB4F_LIFT_KEY");
  grunt2.loop.interact(bundle.maps.ROCKET_HIDEOUT_B4F, keyBall.x, keyBall.y + 1, "up");
  for (let i = 0; i < 60 && grunt2.loop.isBusy(); i++) { grunt2.loop.update(); }
  check("and it can be picked up", hide.bag.some((b) => b.id === "LIFT_KEY"), JSON.stringify(hide.bag));

  const silph = PlayState.newPlayState(bundle.romSha1);
  silph.flags.EVENT_INTRO_DONE = true;
  silph.party.push(makeMon("CHARMANDER", 50));
  const sg = talkTo("SILPH_CO_11F", "SILPHCO11F_GIOVANNI", silph);
  check("Silph's Giovanni fights OPP_GIOVANNI#2 and every Rocket in the building leaves",
        sg.services.battlesFought[0] === "OPP_GIOVANNI#2" && silph.flags.EVENT_BEAT_SILPH_CO_GIOVANNI === true &&
        sg.loop.revealOf("SILPH_CO_11F", "SILPHCO11F_ROCKET1") === false &&
        sg.loop.revealOf("SILPH_CO_2F", "SILPHCO2F_ROCKET1") === false &&
        spoke(sg.services, "_SilphCo11FGiovanniYouRuinedOurPlansText"), JSON.stringify(sg.services.log));

  const e4 = PlayState.newPlayState(bundle.romSha1);
  e4.flags.EVENT_INTRO_DONE = true;
  e4.party.push(makeMon("CHARMANDER", 60));
  const lor = talkTo("LORELEIS_ROOM", "LORELEISROOM_LORELEI", e4);
  check("Lorelei fights by her header and her room's flag is set",
        lor.services.battlesFought[0] === "OPP_LORELEI#1" && e4.flags.EVENT_BEAT_LORELEIS_ROOM_TRAINER_0 === true,
        JSON.stringify(e4.flags));
  const lance = talkTo("LANCES_ROOM", "LANCESROOM_LANCE", e4);
  check("Lance sets both his names", lance.services.battlesFought[0] === "OPP_LANCE#1" &&
        e4.flags.EVENT_BEAT_LANCE === true && e4.flags.EVENT_BEAT_LANCES_ROOM_TRAINER_0 === true,
        JSON.stringify(e4.flags));
}

console.log("\n== The captain's HM01 survives a full bag ==");
{
  const room = bundle.maps.SS_ANNE_CAPTAINS_ROOM;
  const captain = room.objects.find((o) => o.text === "TEXT_SSANNECAPTAINSROOM_CAPTAIN");
  const talk = (state) => {
    const services = makeServices("SS_ANNE_CAPTAINS_ROOM");
    const loop = new PlayLoop(bundle, state, services);
    loop.interact(room, captain.x, captain.y + 1, "up");
    for (let i = 0; i < 120 && loop.isBusy(); i++) { loop.update(); }
    return services;
  };
  const has = (state, id) => state.bag.some((b) => b.id === id);
  const full = PlayState.newPlayState(bundle.romSha1);
  full.flags.EVENT_INTRO_DONE = true;
  const filler = Object.keys(bundle.items).filter((id) => id !== "HM_CUT" && id.indexOf("BADGE") < 0).slice(0, 20);
  for (const id of filler) { PlayState.giveItem(full, id, 1); }
  const flagsBefore = JSON.stringify(full.flags);
  const rf = talk(full);
  // SSAnneCaptainsRoom.asm: GiveItem's `jr nc, .bag_full` prints his own
  // no-room line and stops before SetEvent EVENT_GOT_HM01 -- but the rub's
  // own text asm has already set EVENT_RUBBED_CAPTAINS_BACK a line earlier,
  // so that one flag IS written on a full bag. A previous version of this
  // check asserted that no flag at all changed, which the cartridge does not
  // do; it passed only while the captain's port had no rub flag.
  check("with a full bag the captain keeps HM01 and does not mark it given",
        !has(full, "HM_CUT") && full.flags.EVENT_GOT_HM01 !== true &&
        rf.log.some((l) => l.indexOf("text:Oh no!") === 0),
        JSON.stringify(rf.log));
  check("but the back rub itself is remembered",
        full.flags.EVENT_RUBBED_CAPTAINS_BACK === true && flagsBefore.indexOf("RUBBED") < 0);
  check("and the jingle played to its end before he spoke again",
        rf.log.indexOf("jingle:Music_PkmnHealed") >= 0 &&
        rf.log.indexOf("jingle:Music_PkmnHealed") < rf.log.findIndex((l) => l.indexOf("text:Oh no!") === 0),
        JSON.stringify(rf.log));
  PlayState.takeItem(full, filler[0], 1);
  talk(full);
  check("with room he hands it over", has(full, "HM_CUT"), JSON.stringify(full.bag));
  const before = full.bag.filter((b) => b.id === "HM_CUT").length;
  talk(full);
  check("and not twice", full.bag.filter((b) => b.id === "HM_CUT").length === before && full.bag.find((b) => b.id === "HM_CUT").count === 1);
}

console.log("\n== Bill's house, monster to ticket ==");
{
  const house = bundle.maps.BILLS_HOUSE;
  const monster = house.objects.find((o) => o.name === "BILLSHOUSE_BILL_POKEMON");
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_INTRO_DONE = true;
  const services = makeServices("BILLS_HOUSE");
  services.answer = () => ANSWER_NO;
  const loop = new PlayLoop(bundle, state, services);
  loop.interact(house, monster.x, monster.y + 1, "up");
  for (let i = 0; i < 200 && loop.isBusy(); i++) { loop.update(); }
  check("Bill the Pokemon takes no for an answer and walks into the machine anyway",
        state.flags.EVENT_BILL_SAID_USE_CELL_SEPARATOR === true && loop.revealOf("BILLS_HOUSE", "BILLSHOUSE_BILL_POKEMON") === false &&
        services.log.some((l) => l.indexOf("text:" + bundle.text._BillsHouseBillNoYouGottaHelpText.split("\n")[0]) === 0),
        JSON.stringify(services.log));
  const pc = loop.interact(house, 1, 5, "up");
  for (let i = 0; i < 400 && loop.isBusy(); i++) { loop.update(); }
  check("the PC at (1,4) is a face trigger: the separator runs and Bill comes out",
        pc !== null && state.flags.EVENT_USED_CELL_SEPARATOR_ON_BILL === true && state.flags.EVENT_MET_BILL === true &&
        loop.revealOf("BILLS_HOUSE", "BILLSHOUSE_BILL1") === true, JSON.stringify({ pc, flags: state.flags }));
  const mark = services.log.length;
  const again = loop.interact(house, 1, 5, "up");
  for (let i = 0; i < 100 && loop.isBusy(); i++) { loop.update(); }
  check("used once, the PC only shows its monitor",
        again !== null && services.log.slice(mark).some((l) => l.indexOf("text:" + bundle.text._BillsHouseMonitorText.split("\n")[0]) === 0) &&
        !services.log.slice(mark).some((l) => l.indexOf("reveal:") === 0),
        JSON.stringify(services.log.slice(mark)));
  const bill = house.objects.find((o) => o.name === "BILLSHOUSE_BILL1");
  loop.interact(house, bill.x, bill.y + 1, "up");
  for (let i = 0; i < 200 && loop.isBusy(); i++) { loop.update(); }
  check("human Bill hands over the S.S. TICKET and the Cerulean guards swap",
        state.bag.some((b) => b.id === "S_S_TICKET") && state.flags.EVENT_GOT_SS_TICKET === true &&
        loop.revealOf("CERULEAN_CITY", "CERULEANCITY_GUARD1") === true && loop.revealOf("CERULEAN_CITY", "CERULEANCITY_GUARD2") === false,
        JSON.stringify({ bag: state.bag, toggles: state.objectToggles }));
  check("and the received line names the ticket through the string buffer",
        services.log.some((l) => l.indexOf("text:") === 0 && l.indexOf("received") >= 0 && l.indexOf("S.S.TICKET") >= 0),
        JSON.stringify(services.log.filter((l) => l.indexOf("received") >= 0)));
}

console.log("\n== The nurse heals, and the Center becomes home ==");
{
  const center = bundle.maps.PEWTER_POKECENTER;
  const nurse = center.objects.find((o) => o.name === "PEWTERPOKECENTER_NURSE");
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_INTRO_DONE = true;
  const hurt = makeMon("CHARMANDER", 14);
  hurt.hp = 1;
  hurt.status = "PSN";
  state.party.push(hurt);
  const visit = (answer) => {
    const services = makeServices("PEWTER_POKECENTER");
    services.answer = () => answer;
    services.playerCell = () => [nurse.x, nurse.y + 2];
    const loop = new PlayLoop(bundle, state, services);
    // From (3,3), across the counter at (3,2): the cell in front is a counter
    // tile, so the talk reaches the nurse at (3,1).
    loop.interact(center, nurse.x, nurse.y + 2, "up", true);
    for (let i = 0; i < 120 && loop.isBusy(); i++) { loop.update(); }
    return services;
  };
  const no = visit(ANSWER_NO);
  check("declining leaves the party as it was and says goodbye", state.party[0].hp === 1 && state.respawnMapId === "REDS_HOUSE_1F" &&
        no.log.some((l) => l.indexOf("text:") === 0), JSON.stringify(no.log));
  hurt.volatile.badlyPoisoned = 3;
  const yes = visit(ANSWER_YES);
  check("the nurse heals the party", state.party[0].hp === state.party[0].maxHp && !state.party[0].status, JSON.stringify(state.party[0]));
  check("and clears the volatile counters Toxic left", state.party[0].volatile.badlyPoisoned === 0);
  const bare = JSON.parse(JSON.stringify(state));
  delete bare.party[0].volatile;
  const migrated = PlayState.migratePlayState(bare, bundle.romSha1);
  check("a saved Pokemon without a volatile block gets one on load", !!migrated.party[0].volatile);
  check("and this Center is where a whiteout now returns", state.respawnMapId === "PEWTER_POKECENTER" &&
        state.respawnCellX === nurse.x && state.respawnCellY === nurse.y + 2, JSON.stringify([state.respawnMapId, state.respawnCellX, state.respawnCellY]));
  const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
  const room = new MapRuntime(center, bundle.tilesets[center.tileset]);
  check("the cell between them is a counter, and the player cannot stand on it",
        room.isCounter(nurse.x, nurse.y + 1) && !room.canEnter(nurse.x, nurse.y + 1) && room.canEnter(nurse.x, nurse.y + 2));
  const blind = new PlayLoop(bundle, state, makeServices("PEWTER_POKECENTER"));
  check("without the counter hop nothing is found", blind.interact(center, nurse.x, nurse.y + 2, "up", false) === null);
  const mart = bundle.maps.VIRIDIAN_MART;
  const clerk = mart.objects.find((o) => o.name === "VIRIDIANMART_CLERK");
  const shopRoom = new MapRuntime(mart, bundle.tilesets[mart.tileset]);
  const ms = makeServices("VIRIDIAN_MART");
  const ml = new PlayLoop(bundle, PlayState.newPlayState(bundle.romSha1), ms);
  const found = ml.interact(mart, clerk.x + 2, clerk.y, "left", shopRoom.isCounter(clerk.x + 1, clerk.y));
  check("the mart clerk is reached across his counter the same way", found !== null && found.name === "VIRIDIANMART_CLERK",
        JSON.stringify(found));
  check("the first visit asked the question; the flag remembers", state.flags.EVENT_USED_POKECENTER === true &&
        yes.log.filter((l) => l === "ask").length === 1);
  state.party[0].hp = 3;
  const again = visit(ANSWER_YES);
  check("a later visit heals again without the first-time line", state.party[0].hp === state.party[0].maxHp &&
        !again.log.some((l) => l.indexOf("text:" + bundle.text._ShallWeHealYourPokemonText.split("\n")[0]) === 0), JSON.stringify(again.log));
}

console.log("\n== Saving and resuming ==");
{
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party.push(makeMon("CHARMANDER", 14));
  state.party[0].hp = 3;
  fightBrock(state);
  state.mapId = "PEWTER_CITY";
  state.cellX = 12;
  state.cellY = 9;
  state.steps = 431;

  const text = JSON.stringify(state);
  const back = PlayState.migratePlayState(JSON.parse(text), bundle.romSha1);
  check("a save round-trips through storage", back !== null);
  check("the party comes back whole",
        back.party.length === 1 && back.party[0].species === "CHARMANDER" &&
        back.party[0].hp === 3,
        JSON.stringify(back.party.map((m) => ({ species: m.species, hp: m.hp }))));
  check("so does the badge", back.badges[0] === true);
  check("so does the bag", back.bag.some((s) => s.id === "TM_BIDE"),
        JSON.stringify(back.bag.map((b) => b.id)));
  check("and so does where the player stood",
        back.mapId === "PEWTER_CITY" && back.cellX === 12 && back.steps === 431);
  check("the flags survive", back.flags.EVENT_BEAT_BROCK === true);
}

// ---------------------------------------------------------------------------
// 6. The saves that are already in the field, and the ones that are damaged
// ---------------------------------------------------------------------------

{
  const v0 = { mapId: "VIRIDIAN_CITY", cellX: 4, cellY: 7, facing: "left", steps: 88 };
  const up = PlayState.migratePlayState(v0, bundle.romSha1);
  check("a position-only save migrates", up !== null && up.version === PlayState.PLAY_STATE_VERSION);
  check("it keeps where the player was",
        up.mapId === "VIRIDIAN_CITY" && up.cellX === 4 && up.steps === 88);
  check("it does not replay the intro at them",
        up.flags.EVENT_INTRO_DONE === true);
  check("and it arrives with nothing that can fight",
        up.party.length === 0 && PlayState.canFight(up) === false,
        "grass must not roll an encounter for this save");

  check("garbage is refused rather than misread",
        PlayState.migratePlayState(null, "") === null &&
        PlayState.migratePlayState({ nonsense: 1 }, "") === null);
  check("a save from a newer build is refused, not truncated",
        PlayState.migratePlayState({ version: 99, mapId: "PALLET_TOWN" }, "") === null);

  const other = PlayState.newPlayState("d7037c83e1ae5b39bde3c30787637ba1d4c48ce2");
  check("a save from another cartridge is not loaded against this world",
        PlayState.matchesWorld(other, bundle.romSha1) === false,
        "Blue save vs Red bundle");
  check("but a migrated save with no hash still loads",
        PlayState.matchesWorld(up, bundle.romSha1) === true);
}

// ---------------------------------------------------------------------------
// 7. The contract
// ---------------------------------------------------------------------------

console.log("\n== The host contract ==");
{
  const state = PlayState.newPlayState(bundle.romSha1);
  const services = makeServices("PALLET_TOWN");
  const host = new PlayHost(bundle, state, services);
  // Every declared routine must survive being called with a junk argument. A
  // routine that throws takes the lens down over a typo in a data file, and the
  // routines are the one place a ported script hands control to real code.
  const threw = [];
  for (const r of requiredRoutines()) {
    try { host.call(r, ""); } catch (e) { threw.push(r + ": " + e.message); }
  }
  check("no declared routine throws on a junk argument",
        threw.length === 0, threw.join("; "));
  check("and an undeclared one is reported rather than silently skipped",
        host.call("no_such_routine", "") === DONE);

  // Out-of-order badges: the engine takes the SET now, not a count, so a save
  // holding only Thunder packs to bit 2 and boosts Defense. What the count used
  // to do to it -- boost Attack, the badge they had not earned -- is pinned in
  // battle.test.mjs, where the mutation goes red.
  const skipped = PlayState.newPlayState(bundle.romSha1);
  skipped.badges[2] = true;
  check("out-of-order badges are detectable",
        PlayState.playStateBadgeGap(skipped) === true &&
        PlayState.playStateBadgeGap(state) === false);
  const boulder = PlayState.newPlayState(bundle.romSha1);
  boulder.badges[0] = true;
  check("and pack to the bit the cartridge tests, not to a count",
        PlayState.badgeMask(skipped) === 4 && PlayState.badgeCount(skipped) === 1 &&
        PlayState.badgeMask(boulder) === 1 && PlayState.badgeMask(state) === 0,
        PlayState.badgeMask(skipped) + " / " + PlayState.badgeMask(boulder));
}

// ---------------------------------------------------------------------------
// 7b. Text: what is a label, and what is a slot to fill
// ---------------------------------------------------------------------------

console.log("\n== Labels and slots ==");
{
  const state = PlayState.newPlayState(bundle.romSha1);
  const svc = makeServices("PALLET_TOWN");
  const host = new PlayHost(bundle, state, svc);

  // ELEVEN of the cartridge's text labels have no leading underscore. Deciding
  // label-vs-literal on that character printed the label's own NAME in the box.
  const bare = Object.keys(bundle.text).filter((k) => !k.startsWith("_"));
  check("the cartridge has labels without a leading underscore",
        bare.length > 0, bare.length + " of them, e.g. " + bare[0]);
  svc.log.length = 0;
  for (let i = 0; i < 20; i++) { host.showText(bare[0], ""); }
  const shown = svc.log.filter((l) => l.indexOf("text:") === 0).join(" ");
  check("and one of them shows its WORDS, not its name",
        shown.length > 0 && shown.indexOf(bare[0]) < 0,
        JSON.stringify(shown.slice(0, 90)));

  // Seventeen different {RAM:...} slots exist. Filling only wNameBuffer left
  // every other line showing its raw token.
  const withStringBuffer = Object.keys(bundle.text)
    .filter((k) => String(bundle.text[k]).indexOf("{RAM:wStringBuffer}") >= 0)[0];
  check("the cartridge uses more than one RAM slot", !!withStringBuffer,
        withStringBuffer || "none found");
  if (withStringBuffer) {
    svc.log.length = 0;
    for (let i = 0; i < 20; i++) { host.showText(withStringBuffer, "POTION"); }
    const filled = svc.log.filter((l) => l.indexOf("text:") === 0).join(" ");
    check("and a slot that is not wNameBuffer gets filled too",
          filled.indexOf("{RAM:") < 0,
          JSON.stringify(filled.slice(0, 90)));
  }
}

// ---------------------------------------------------------------------------
// 8. The two gates that stop a save eating a badge
// ---------------------------------------------------------------------------

console.log("\n== The save gate ==");
{
  // Brock's script: set_flag EVENT_BEAT_BROCK at 5, a blocking message at 6,
  // give BOULDERBADGE at 7. A write anywhere in that window stores the flag
  // without the badge, and the script's own check_flag then skips the handover
  // on every future conversation. The badge is gone and the save looks fine.
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party.push(makeMon("CHARMANDER", 14));
  const services = makeServices("PEWTER_GYM", { battleHangs: false });
  // Read every page UNTIL the win is recorded, then stop reading. That parks the
  // script on the message between set_flag and give -- holding the box shut from
  // the start instead parks it on the pre-battle line, which is before the flag
  // and proves nothing.
  let acked = true;
  services.pageAcknowledged = () => acked && state.flags.EVENT_GOT_TM34 !== true;
  const loop = new PlayLoop(bundle, state, services);
  loop.interact(bundle.maps.PEWTER_GYM, 4, 2, "up");

  let sawFlagWithoutBadge = false;
  for (let i = 0; i < 40 && loop.isBusy(); i++) {
    loop.update();
    // The victory sets EVENT_BEAT_BROCK and the badge together now, so the
    // window that matters moved: it is between the win and the TM going in the
    // bag. A save there stores a beaten Brock who still owes a TM -- which the
    // script does handle, but only because give_tm is retryable. The rule is the
    // same: no write while a script is mid-flight.
    if (state.flags.EVENT_BEAT_BROCK === true && state.flags.EVENT_GOT_TM34 !== true) {
      sawFlagWithoutBadge = true;
      check("the loop refuses to save between the win and the reward",
            loop.canSave() === false, "it would have stored a half-finished victory");
      break;
    }
  }
  check("that window is actually reachable", sawFlagWithoutBadge,
        "the test never parked between the flag and the badge, so it proved nothing");

  services.pageAcknowledged = () => true;
  for (let i = 0; i < 60 && loop.isBusy(); i++) { loop.update(); }
  check("and once the script finishes, the badge and TM are there and saving is allowed",
        state.badges[0] === true && state.flags.EVENT_GOT_TM34 === true &&
        loop.canSave() === true,
        JSON.stringify({ badges: state.badges[0], busy: loop.isBusy() }));
  // The fake here records hides in its own dict and knows nothing of the save.
  // The toggle must land anyway: the loop owns that write, not the lens.
  check("a Victory's hidden NPC reaches the save through the loop, not the lens",
        state.objectToggles["PEWTER_CITY:PEWTERCITY_YOUNGSTER"] === false,
        JSON.stringify(state.objectToggles));
}

console.log("\n== The gym trainer's flag follows the result ==");
{
  const talk = (state, opts) => {
    const services = makeServices("PEWTER_GYM");
    if (opts && opts.won === false) { services.battleWon = () => false; }
    const loop = new PlayLoop(bundle, state, services);
    const t = bundle.maps.PEWTER_GYM.objects.find((o) => o.text === "TEXT_PEWTERGYM_COOLTRAINER_M");
    loop.interact(bundle.maps.PEWTER_GYM, t.x, t.y + 1, "up");
    for (let i = 0; i < 60 && loop.isBusy(); i++) { loop.update(); }
    return services;
  };
  const lost = PlayState.newPlayState(bundle.romSha1);
  lost.party.push(makeMon("CHARMANDER", 14));
  const l = talk(lost, { won: false });
  check("a lost battle does not retire the trainer", l.battlesFought.length === 1 &&
        lost.flags.EVENT_BEAT_PEWTER_GYM_TRAINER_0 !== true, JSON.stringify(lost.flags));
  const again = talk(lost, { won: false });
  check("and he fights again", again.battlesFought.length === 1);
  const empty = PlayState.newPlayState(bundle.romSha1);
  talk(empty);
  check("a refused battle does not retire him either", empty.flags.EVENT_BEAT_PEWTER_GYM_TRAINER_0 !== true);
  const won = PlayState.newPlayState(bundle.romSha1);
  won.party.push(makeMon("CHARMANDER", 14));
  talk(won);
  check("a win does", won.flags.EVENT_BEAT_PEWTER_GYM_TRAINER_0 === true);
  const after = talk(won);
  const afterLine = bundle.text._PewterGymCooltrainerMAfterBattleText.split(/[\n\f\x0b\x0c]/)[0];
  check("and the next talk is the after-battle line, no battle", after.battlesFought.length === 0 &&
        after.log.some((x) => x.indexOf("text:" + afterLine) === 0), JSON.stringify(after.log));
}


console.log("\n== The encounter gate ==");
{
  const empty = PlayState.newPlayState(bundle.romSha1);
  const loopA = new PlayLoop(bundle, empty, makeServices("ROUTE_1"));
  check("grass does not bite with an empty party",
        loopA.encountersAllowed() === false);

  const fainted = PlayState.newPlayState(bundle.romSha1);
  fainted.party.push(makeMon("CHARMANDER", 5));
  fainted.party[0].hp = 0;
  const loopB = new PlayLoop(bundle, fainted, makeServices("ROUTE_1"));
  check("nor with a wiped one", loopB.encountersAllowed() === false);

  const ready = PlayState.newPlayState(bundle.romSha1);
  ready.party.push(makeMon("CHARMANDER", 5));
  const loopC = new PlayLoop(bundle, ready, makeServices("ROUTE_1"));
  check("but it does with something that can fight",
        loopC.encountersAllowed() === true);

  // And never mid-conversation.
  const talking = PlayState.newPlayState(bundle.romSha1);
  talking.party.push(makeMon("CHARMANDER", 5));
  const svc = makeServices("PALLET_TOWN");
  svc.pageAcknowledged = () => false;
  const loopD = new PlayLoop(bundle, talking, svc);
  const reveal = {};
  reveal.PALLETTOWN_OAK = true;
  loopD.setRevealed("PALLET_TOWN", "PALLETTOWN_OAK", true);
  const oak = bundle.maps.PALLET_TOWN.objects.filter((o) => o.name === "PALLETTOWN_OAK")[0];
  loopD.interact(bundle.maps.PALLET_TOWN, oak.x, oak.y + 1, "up");
  loopD.update();
  check("and not while a conversation is open",
        loopD.isBusy() === true && loopD.encountersAllowed() === false,
        "busy=" + loopD.isBusy());
}

// ---------------------------------------------------------------------------
// selftest
// ---------------------------------------------------------------------------

if (selftest) {
  console.log("\n-- selftest --");
  {
    // A ball that lost its item field must yield no pickup: proves the suite
    // reads the bag and not the returned target.
    const cave = bundle.maps.CERULEAN_CAVE_1F;
    const ball = cave.objects.find((o) => o.name === "CERULEANCAVE1F_NUGGET");
    const saved = ball.item;
    delete ball.item;
    const st = PlayState.newPlayState(bundle.romSha1);
    st.flags.EVENT_INTRO_DONE = true;
    const lp = new PlayLoop(bundle, st, makeServices("CERULEAN_CAVE_1F"));
    lp.interact(cave, ball.x, ball.y + 1, "up");
    for (let i = 0; i < 60 && lp.isBusy(); i++) { lp.update(); }
    ball.item = saved;
    check("[selftest] a ball without an item gives nothing", st.bag.length === 0, JSON.stringify(st.bag));

    // A pickup that hides the ball BEFORE the give: on a full bag the give
    // halts the script with the ball already gone and the item never landed.
    // (The bag probe after the give is belt and braces now that a refused
    // give stops the VM.)
    const { itemBallScript } = await import(P + "script/ItemBall.ts");
    const hideFirst = itemBallScript("CERULEAN_CAVE_1F", ball.name, "NUGGET");
    const hideAt = hideFirst.findIndex((c) => c.op === "hide_object");
    const [hideCmd] = hideFirst.splice(hideAt, 1);
    hideFirst.unshift(hideCmd);
    const full = PlayState.newPlayState(bundle.romSha1);
    const filler = Object.keys(bundle.items).filter((id) => id !== "NUGGET" && id.indexOf("BADGE") < 0).slice(0, 20);
    for (const id of filler) { PlayState.giveItem(full, id, 1); }
    const r = run(hideFirst, full, "CERULEAN_CAVE_1F");
    const hid = r.services.revealed["CERULEAN_CAVE_1F:" + ball.name] === false;
    check("[selftest] a pickup that hides the ball before the give is caught losing it on a full bag",
          hid && !full.bag.some((s) => s.id === "NUGGET"), JSON.stringify(r.services.log));
  }
  const state = PlayState.newPlayState(bundle.romSha1);
  state.flags.EVENT_FOLLOWED_OAK_INTO_LAB = true;
  const savedText = bundle.text._OaksLabYouWantCharmanderText;
  delete bundle.text._OaksLabYouWantCharmanderText;
  const r = run(talkScript("OAKS_LAB", "TEXT_OAKSLAB_CHARMANDER_POKE_BALL"),
                state, "OAKS_LAB", { answer: ANSWER_YES });
  bundle.text._OaksLabYouWantCharmanderText = savedText;
  check("[selftest] a missing line is noticed, not shown as blank",
        !r.services.log.some((l) => l === "text:"),
        JSON.stringify(r.services.log));

  const s2 = PlayState.newPlayState(bundle.romSha1);
  s2.party.push(makeMon("CHARMANDER", 14));
  const savedRoster = bundle.trainers.OPP_BROCK;
  delete bundle.trainers.OPP_BROCK;
  const brockGone = fightBrock(s2);
  bundle.trainers.OPP_BROCK = savedRoster;
  check("[selftest] a missing roster fails the roster check",
        bundle.trainers.OPP_BROCK !== undefined &&
        brockGone.services.battlesFought.length === 1,
        "the battle is still requested; the bundle check above is what catches it");
}

// ---------------------------------------------------------------------------

function makeMon(species, level) {
  return makeWildMon(bundle, species, level, () => 0.5);
}

console.log(`\n${fail === 0 ? "PLAYLOOP OK" : "PLAYLOOP FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
