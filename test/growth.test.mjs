// Party growth: the PC box, catches and gifts that overflow into it, the
// four-slot move-learn prompt, and evolution -- headless, against the real bundle.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/growth.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The first test is the JOIN: a catch with six in the party, played through the
// BattleRunner, lands in the box. Its selftest runs the same catch without the
// runner's box wiring and requires the refusal, and stops the runner before it
// finishes and requires an empty box -- so the suite can only pass when the
// runner is what puts the Pokemon there.

import { readFileSync } from "node:fs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: growth.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const PlayState = await import(P + "PlayState.ts");
const Storage = await import(P + "Storage.ts");
const Party = await import(P + "battle/Party.ts");
const Stats = await import(P + "battle/Stats.ts");
const Dialogue = await import(P + "script/Dialogue.ts");
const R = await import(P + "BattleRunner.ts");
const BS = await import(P + "battle/BattleState.ts");
const ViewOptions = await import(P + "screen/ViewOptions.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
let quiet = false;
let quietFails = 0;
function check(name, ok, detail) {
  if (quiet) { if (!ok) { quietFails++; } return; }
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const mon = (species, level, seed) => Stats.makeWildMon(bundle, species, level, seeded(seed));
const dexOf = (species) => bundle.species[species].dex;

/**
 * A player who reads every line and reaches for one bag item, once.
 *
 * Once, because a refused throw re-offers the menu: a view that keeps handing
 * over the same ball turns a refusal into a thousand-turn stall rather than a
 * battle, and the test would be measuring the frame cap.
 */
function makeView(opts) {
  const o = opts || {};
  const seen = [];
  let menuOpen = false;
  let bagLeft = o.bagItem ? 1 : 0;
  const sounds = [];
  const asked = [];
  const view = {
    seen,
    menuOpen: () => menuOpen,
    showLines: (lines) => seen.push(lines.join(" ")),
    acknowledged: () => true,
    hideBox: () => {},
    showMoves: (names) => { menuOpen = true; view.lastMoves = names; },
    chosenMove: () => {
      if (!menuOpen || bagLeft > 0) { return -1; }
      const rows = view.lastMoves ? view.lastMoves.length : 0;
      return rows === 0 ? -1 : 0;
    },
    hideMoves: () => { menuOpen = false; },
    wantsToRun: () => false,
    chosenSwitch: () => -1,
    chosenBagItem: () => {
      if (!menuOpen || bagLeft <= 0) { return ""; }
      bagLeft--;
      return o.bagItem;
    },
    chosenBagTarget: () => -1,
    sound: (key) => { sounds.push(key); },
    // A level-up wanting a move forgotten. `o.learn` is the answer: a slot
    // number, LEARN_ABANDONED to keep what it has, or undefined to abandon.
    askLearn: (mon, moveId) => { asked.push({ mon: mon.species, move: moveId }); },
    learnDecision: () => (o.learn === undefined ? -1 : o.learn),
  };
  return view;
}

function drive(runner, maxFrames) {
  let frames = 0;
  while (runner.isRunning() && frames < (maxFrames === undefined ? 6000 : maxFrames)) {
    runner.update();
    frames++;
  }
  return frames;
}

/** Six level-20 Rattatas, one Master Ball, and a wild Pidgey to throw it at. */
function fullPartyCatch(opts) {
  const o = opts || {};
  const play = PlayState.newPlayState(bundle.romSha1);
  for (let i = 0; i < 6; i++) { play.party.push(mon("RATTATA", 20, i + 1)); }
  if (o.fillBox) {
    for (let i = 0; i < PlayState.BOX_SIZE; i++) { Storage.depositToBox(play, mon("RATTATA", 3, i + 40)); }
  }
  play.bag.push({ id: "MASTER_BALL", count: 1 });
  const view = makeView({ bagItem: "MASTER_BALL" });
  const runner = new R.BattleRunner(bundle, play, view);
  const started = runner.startWild("PIDGEY", 3, seeded(5));
  const frames = drive(runner, o.frames);
  return { play, view, runner, started, frames };
}

// ---------------------------------------------------------------------------
// THE JOIN: a catch with six in the party has to reach the box in the save.
// ---------------------------------------------------------------------------
console.log("\n== THE JOIN: a catch with six in the party ==");
{
  const r = fullPartyCatch({});
  check("a wild battle starts with a full party", r.started === true);
  check("and it finishes", r.runner.state() === R.RUNNER_DONE, r.frames + " frames");
  check("the party is untouched at six", r.play.party.length === 6 &&
        r.play.party.every((m) => m.species === "RATTATA"));
  check("the PIDGEY is in box 1",
        r.play.boxes[0].length === 1 && r.play.boxes[0][0].species === "PIDGEY" &&
        r.play.boxes[0][0].level === 3,
        JSON.stringify(r.play.boxes[0].map((m) => [m.species, m.level])));
  check("with the experience its level is worth",
        r.play.boxes[0][0].exp === Party.expForLevel(bundle.species.PIDGEY.growthRate, 3));
  check("and stored benched", r.play.boxes[0][0].badgeBoostPasses === 0 &&
        r.play.boxes[0][0].stages.attack === 0);
  check("the dex records it as owned", r.play.dexOwned[dexOf("PIDGEY") - 1] === true);
  const said = r.view.seen.join(" | ");
  check("the box line names the Pokemon and the box it went to",
        said.indexOf("PIDGEY was") >= 0 && said.indexOf("BOX 1 on PC!") >= 0 &&
        said.indexOf("{RAM:") < 0, said);
  check("and the ball left the bag", r.play.bag.length === 0);
}

if (selftest) {
  console.log("\n-- selftest: the join, from both directions --");
  // (a) The engine, never told there is a box, must still refuse at six.
  const play = PlayState.newPlayState(bundle.romSha1);
  for (let i = 0; i < 6; i++) { play.party.push(mon("RATTATA", 20, i + 1)); }
  const wild = mon("PIDGEY", 3, 5);
  const battle = BS.startWildBattle(bundle, play.party, 0, wild, seeded(5));
  const report = battle.takeTurn({ kind: "item", moveIndex: -1, partyIndex: -1, item: "MASTER_BALL" });
  const log = battle.outcome().log.join(" | ");
  check("[selftest] an engine never told about the box refuses the throw",
        battle.outcome().result !== "caught" && report.itemConsumed === "" &&
        log.indexOf("BOX") >= 0 && play.boxes[0].length === 0, log);

  // (b) The deposit is the RUNNER's, at the end: one frame short, the box is empty.
  const whole = fullPartyCatch({});
  const short = fullPartyCatch({ frames: whole.frames - 1 });
  check("[selftest] one frame before the runner finishes, the box is still empty",
        short.runner.state() !== R.RUNNER_DONE && short.play.boxes[0].length === 0 &&
        whole.play.boxes[0].length === 1,
        JSON.stringify({ frames: whole.frames, state: short.runner.state() }));

  // (c) A full box on top of a full party: refused, and the ball is not spent.
  const nowhere = fullPartyCatch({ fillBox: true });
  check("[selftest] with the box full too the throw is refused and the ball stays",
        nowhere.play.boxes[0].length === PlayState.BOX_SIZE &&
        nowhere.play.bag.length === 1 && nowhere.play.bag[0].count === 1 &&
        nowhere.play.boxes[0].every((m) => m.species === "RATTATA") &&
        nowhere.view.seen.join(" ").indexOf("BOX") >= 0,
        JSON.stringify({ bag: nowhere.play.bag, box: nowhere.play.boxes[0].length }));
}

// ---------------------------------------------------------------------------
console.log("\n== The save: boxes ==");
{
  const fresh = PlayState.newPlayState("t");
  check("a new game has twelve empty boxes and stands on the first",
        Array.isArray(fresh.boxes) && fresh.boxes.length === PlayState.BOX_COUNT &&
        fresh.boxes[0].length === 0 && fresh.currentBox === 0 && fresh.respawnLastMapId === "");
  // Pinned to a literal on purpose: the version is a ratchet, so raising it
  // has to be a deliberate edit here too. v7 added playerId and the OT pair --
  // see PLAY_STATE_VERSION and test/trainerid.test.mjs.
  check("the save format is v13", fresh.version === 13 && PlayState.PLAY_STATE_VERSION === 13);
  check("a new game defaults to the diorama play mode",
        fresh.playMode === PlayState.PLAY_MODE_DIORAMA, fresh.playMode);

  // A version-3 save predates playMode entirely; it migrates to the diorama
  // default, same as newPlayState() -- SPEC.md "Play modes and the onboarding".
  const v3 = JSON.parse(JSON.stringify(fresh));
  v3.version = 3;
  delete v3.playMode;
  const migratedV3 = PlayState.migratePlayState(v3, "t");
  check("a version-3 save with no playMode migrates to diorama",
        migratedV3 !== null && migratedV3.version === PlayState.PLAY_STATE_VERSION &&
        migratedV3.playMode === PlayState.PLAY_MODE_DIORAMA,
        migratedV3 && migratedV3.playMode);

  // A version-4 save's own choice is not second-guessed.
  const v4Gameboy = JSON.parse(JSON.stringify(fresh));
  v4Gameboy.playMode = PlayState.PLAY_MODE_GAMEBOY;
  const migratedGameboy = PlayState.migratePlayState(v4Gameboy, "t");
  check("a version-4 save that chose GAME BOY keeps it",
        migratedGameboy !== null && migratedGameboy.playMode === PlayState.PLAY_MODE_GAMEBOY);

  // A v1 save: everything but the box.
  const v1 = JSON.parse(JSON.stringify(fresh));
  v1.version = 1;
  delete v1.boxes; delete v1.currentBox; delete v1.respawnLastMapId;
  v1.objectToggles = { "PEWTER_CITY:X": false };
  v1.defeatedTrainers = { "A:B": true };
  const up = PlayState.migratePlayState(v1, "t");
  check("a v1 save migrates to an empty box", up !== null && up.version === PlayState.PLAY_STATE_VERSION &&
        up.boxes.length === PlayState.BOX_COUNT && up.boxes[0].length === 0 && up.currentBox === 0 &&
        up.respawnLastMapId === "" && up.playMode === PlayState.PLAY_MODE_DIORAMA);
  // v4 predates the view rows entirely; they arrive as the defaults rather
  // than as a hole the renderer would have to guard against. CURVE and WORLD
  // were removed on 9 September, so the fields that must be there are the
  // ones the page still has -- and the curve must NOT come back.
  check("a save without view rows gets the defaults",
        up.options.view !== undefined && up.options.view.tilt === 0 &&
        up.options.view.zoom === ViewOptions.defaultViewSettings().zoom);
  check("and no removed row survives the migration",
        up.options.view.curve === undefined && up.options.view.world === undefined &&
        up.options.view.edge === undefined);
  check("and keeps its toggles and beaten trainers",
        up.objectToggles["PEWTER_CITY:X"] === false && up.defeatedTrainers["A:B"] === true);

  // A v2 round trip keeps a boxed Pokemon whole.
  const state = PlayState.newPlayState("t");
  const boxed = mon("PIDGEY", 7, 3);
  boxed.evs.attack = 1234;
  boxed.moves[0].pp = 1;
  Storage.depositToBox(state, boxed);
  state.respawnLastMapId = "VIRIDIAN_CITY";
  const back = PlayState.migratePlayState(JSON.parse(JSON.stringify(state)), "t");
  check("a v2 round trip keeps the boxed Pokemon's species, moves and stat experience",
        back.boxes[0].length === 1 && back.boxes[0][0].species === "PIDGEY" &&
        back.boxes[0][0].evs.attack === 1234 && back.boxes[0][0].moves[0].pp === 1 &&
        back.boxes[0][0].volatile !== undefined && back.respawnLastMapId === "VIRIDIAN_CITY");

  // The cartridge's own twelve, since v6: a save that stood on box 3 keeps it.
  const many = JSON.parse(JSON.stringify(state));
  many.boxes = [many.boxes[0]];
  for (let i = 1; i < PlayState.BOX_COUNT; i++) { many.boxes.push([mon("RATTATA", 3, i)]); }
  many.currentBox = 2;
  const kept = PlayState.migratePlayState(JSON.parse(JSON.stringify(many)), "t");
  check("all twelve boxes and the box the player stood on survive a round trip",
        kept.boxes.length === 12 && kept.boxes[11].length === 1 && kept.currentBox === 2,
        kept.boxes.length + " boxes, on " + kept.currentBox);

  // A save from a build with MORE boxes than this one: the extra is dropped loudly.
  const wide = JSON.parse(JSON.stringify(many));
  wide.boxes.push([mon("RATTATA", 3, 99)]);
  wide.currentBox = PlayState.BOX_COUNT;
  let printed = "";
  const oldPrint = globalThis.print;
  globalThis.print = (m) => { printed += m; };
  const narrow = PlayState.migratePlayState(wide, "t");
  globalThis.print = oldPrint;
  check("a save with more boxes than this build keeps the ones it can and says what it dropped",
        narrow.boxes.length === PlayState.BOX_COUNT && narrow.boxes[0][0].species === "PIDGEY" &&
        narrow.currentBox === 0 && printed.indexOf("dropped") >= 0, printed);
  const over = JSON.parse(JSON.stringify(state));
  for (let i = 0; i < 25; i++) over.boxes[0].push(mon("RATTATA", 3, i + 1));
  const cut = PlayState.migratePlayState(over, "t");
  check("a box longer than BOX_SIZE is cut to it", cut.boxes[0].length === PlayState.BOX_SIZE);
  // Relative, not a literal: "newer" is whatever this build is not, so this
  // one never has to move again when the version does. It read `version: 7`
  // until v7 arrived and quietly became a test that the CURRENT version is
  // refused, which would have passed for the wrong reason.
  check("a newer version is still refused",
        PlayState.migratePlayState(
          { version: PlayState.PLAY_STATE_VERSION + 1, mapId: "PALLET_TOWN" }, "t") === null);
}

// ---------------------------------------------------------------------------
console.log("\n== Storage ==");
{
  const state = PlayState.newPlayState("t");
  check("an empty box has BOX_SIZE free and is box 1",
        Storage.boxFree(state) === PlayState.BOX_SIZE && Storage.boxNumber(state) === 1);

  // receiveMon: party first.
  const r1 = Storage.receiveMon(bundle, state, mon("PIDGEY", 5, 1));
  check("a Pokemon received with room joins the party",
        r1.where === Storage.RECEIVE_PARTY && r1.index === 0 && r1.box === 0 &&
        state.party.length === 1 && state.dexOwned[dexOf("PIDGEY") - 1] === true);
  check("with its experience set to what its level is worth",
        state.party[0].exp === Party.expForLevel(bundle.species.PIDGEY.growthRate, 5));
  for (let i = 0; i < 5; i++) Storage.receiveMon(bundle, state, mon("RATTATA", 5, i + 10));
  check("six fill the party", state.party.length === 6);
  const hurt = mon("SPEAROW", 9, 4);
  hurt.hp = 3;
  hurt.status = "PSN";
  const r2 = Storage.receiveMon(bundle, state, hurt);
  check("the seventh goes to box 1",
        r2.where === Storage.RECEIVE_BOX && r2.box === 1 && r2.index === 0 &&
        state.party.length === 6 && state.boxes[0].length === 1 &&
        state.boxes[0][0].species === "SPEAROW" && state.dexOwned[dexOf("SPEAROW") - 1] === true);
  check("stored as it was: 3 HP and poisoned -- Gen 1 heals nothing on deposit",
        state.boxes[0][0].hp === 3 && state.boxes[0][0].status === "PSN" &&
        state.boxes[0][0].exp === Party.expForLevel(bundle.species.SPEAROW.growthRate, 9));
  while (state.boxes[0].length < PlayState.BOX_SIZE) Storage.depositToBox(state, mon("RATTATA", 2, 77));
  const r3 = Storage.receiveMon(bundle, state, mon("PIKACHU", 5, 5));
  check("with the party and the box full, it is refused and nothing changes",
        r3.where === Storage.RECEIVE_REFUSED && r3.index === -1 && state.boxes[0].length === PlayState.BOX_SIZE &&
        state.party.length === 6 && state.dexOwned[dexOf("PIKACHU") - 1] !== true);
  check("depositToBox reports 0 on a full box", Storage.depositToBox(state, mon("PIKACHU", 5, 5)) === 0);

  // Bill's PC over a fresh state.
  const s = PlayState.newPlayState("t");
  check("withdraw from an empty box: no POKeMON here",
        Storage.withdrawFromBox(bundle, s, 0).refusal === Storage.TEXT_NO_MON);
  s.party.push(mon("CHARMANDER", 10, 1));
  check("the last party member cannot be deposited",
        Storage.depositFromParty(s, 0).refusal === Storage.TEXT_CANT_DEPOSIT_LAST && s.party.length === 1);
  s.party.push(mon("PIDGEY", 6, 2));
  const dep = Storage.depositFromParty(s, 1);
  check("a deposit moves the Pokemon into the box",
        dep.ok && dep.mon.species === "PIDGEY" && s.party.length === 1 && s.boxes[0].length === 1);
  for (let i = 0; i < 5; i++) s.party.push(mon("RATTATA", 3, i + 20));
  check("withdraw with six in the party: can't take any more",
        Storage.withdrawFromBox(bundle, s, 0).refusal === Storage.TEXT_CANT_TAKE && s.boxes[0].length === 1);
  s.party.pop();
  while (s.boxes[0].length < PlayState.BOX_SIZE) Storage.depositToBox(s, mon("RATTATA", 2, 88));
  check("deposit into a full box: this Box is full",
        Storage.depositFromParty(s, 1).refusal === Storage.TEXT_BOX_FULL && s.party.length === 5);
  const rel = Storage.releaseFromBox(s, s.boxes[0].length - 1);
  check("a release shrinks the box", rel.ok && s.boxes[0].length === PlayState.BOX_SIZE - 1);
  check("releasing out of range is refused", Storage.releaseFromBox(s, 99).refusal === Storage.TEXT_NO_MON);

  // The box trick: stat experience becomes stats on the way out.
  const trick = PlayState.newPlayState("t");
  trick.party.push(mon("PIDGEY", 5, 9));
  const grinder = mon("MACHOP", 30, 11);
  grinder.hp = 10;
  const before = { ...grinder.stats };
  grinder.evs = { hp: 65535, attack: 65535, defense: 65535, speed: 65535, special: 65535 };
  Storage.depositToBox(trick, grinder);
  check("a deposit does not touch the stats", trick.boxes[0][0].stats.attack === before.attack);
  const out = Storage.withdrawFromBox(bundle, trick, 0);
  const want = Stats.computeStats(bundle.species.MACHOP.baseStats, grinder.ivs, grinder.evs, 30);
  check("a withdrawal recomputes them from the stat experience (the box trick)",
        out.ok && out.mon.stats.attack === want.attack && out.mon.stats.attack > before.attack &&
        out.mon.maxHp === want.hp && out.mon.hp === 10 && out.mon.battleStats.attack === want.attack,
        JSON.stringify({ before: before.attack, after: out.mon.stats.attack, want: want.attack }));
  check("and it lands at the end of the party", trick.party.length === 2 && trick.party[1].species === "MACHOP" &&
        trick.boxes[0].length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n== Filling two slots in one line ==");
{
  const sent = Dialogue.fillSlots(bundle.text._SentToBoxText, [["wBoxMonNicks", "PIDGEY"], ["wStringBuffer", "1"]]);
  check("_SentToBoxText names the Pokemon and the box",
        sent.indexOf("PIDGEY was") >= 0 && sent.indexOf("BOX 1 on PC!") >= 0 && sent.indexOf("{RAM:") < 0, sent);
  const stored = Dialogue.fillSlots(bundle.text._MonWasStoredText, [["wStringBuffer", "KARP"], ["wBoxNumString", "1"]]);
  check("_MonWasStoredText names both", stored.indexOf("KARP was") >= 0 && stored.indexOf("Box 1.") >= 0, stored);
  const missing = Dialogue.fillSlots(bundle.text._SentToBoxText, [["wBoxMonNicks", "PIDGEY"]]);
  check("a slot with no value is left in place, visibly",
        missing.indexOf("PIDGEY") >= 0 && missing.indexOf("{RAM:wStringBuffer}") >= 0, missing);
  const trying = Dialogue.fillSlots(bundle.text._TryingToLearnText, [["wLearnMoveMonName", "CHARMANDER"], ["wStringBuffer", "RAGE"]]);
  check("_TryingToLearnText fills every repeat of both slots",
        trying.indexOf("{RAM:") < 0 && trying.split("CHARMANDER").length === 3 && trying.split("RAGE").length >= 3, trying);
}

// ---------------------------------------------------------------------------
console.log("\n== Summary ==");
console.log(`GROWTH: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
