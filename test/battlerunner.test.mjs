// A whole battle, played through the runner a frame at a time.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battlerunner.test.mjs Assets/Generated/kanto.json [--selftest]
//
// battle.integration.test.mjs already plays battles, but it drives BattleState
// directly. This drives the layer a PLAYER touches: lines arrive one at a time
// and have to be acknowledged, the menu only opens when the engine is waiting,
// a faint sends out the next Pokemon, and when it is over the party, the dex and
// the money in the PlayState are what the battle left behind.
//
// That layer did not exist until now: an encounter in the lens was a picture on
// a six-second timer. The engine was complete and unreachable, which is the same
// fault this project has hit three times -- a finished layer nothing calls.

import { readFileSync } from "node:fs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: battlerunner.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const R = await import(P + "BattleRunner.ts");
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");
const Party = await import(P + "battle/Party.ts");
const { LEARN_ABANDONED } = await import(P + "MoveLearnController.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
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

/**
 * A player who reads every line immediately and always picks the first move.
 * `runAt` makes them try to flee once that many lines have gone by.
 */
function makeView(opts) {
  const o = opts || {};
  const seen = [];
  let menuOpen = false;
  let menus = 0;
  const sounds = [];
  const asked = [];
  const view = {
    seen,
    sounds,
    asked,
    menus: () => menus,
    menuOpen: () => menuOpen,
    showLines: (lines) => seen.push(lines.join(" ")),
    acknowledged: () => true,
    hideBox: () => {},
    showMoves: (names) => { menuOpen = true; menus++; view.lastMoves = names; },
    // A real menu cannot select a row it is not showing, so neither can this.
    // Before the runner mapped rows to move SLOTS, an out-of-range row still
    // acted -- the engine fell back to the first usable slot -- which is
    // exactly the silence that let a compacted row pick the wrong move.
    chosenMove: () => {
      if (!menuOpen) { return -1; }
      const rows = view.lastMoves ? view.lastMoves.length : 0;
      if (rows === 0) { return -1; }
      const want = o.move === undefined ? 0 : o.move;
      return want % rows;
    },
    hideMoves: () => { menuOpen = false; },
    wantsToRun: () => !!o.run,
    chosenSwitch: () => (o.switchTo === undefined ? -1 : o.switchTo),
    chosenBagItem: () => (o.bagItem === undefined ? "" : o.bagItem),
    chosenBagTarget: () => (o.bagTarget === undefined ? -1 : o.bagTarget),
    sound: (key) => { sounds.push(key); },
    // A level-up wanting a move forgotten. `o.learn` is the answer: a slot
    // number, LEARN_ABANDONED to keep what it has, or undefined to abandon.
    askLearn: (mon, moveId) => { asked.push({ mon: mon.species, move: moveId }); },
    learnDecision: () => (o.learn === undefined ? -1 : o.learn),
  };
  return view;
}

function party(species, level, seed) {
  return [makeWildMon(bundle, species, level, seeded(seed))];
}

function drive(runner, view, maxFrames) {
  let frames = 0;
  while (runner.isRunning() && frames < (maxFrames || 4000)) {
    runner.update();
    frames++;
  }
  return frames;
}

// ---------------------------------------------------------------------------
// 1. A wild battle, fought to the end
// ---------------------------------------------------------------------------

console.log("\n== A wild battle ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = party("CHARMANDER", 20, 7);
  const view = makeView({});
  const runner = new R.BattleRunner(bundle, play, view);
  const started = runner.startWild("PIDGEY", 4, seeded(99));

  check("a wild battle starts", started === true);
  // The runner is frame-driven: the opening lines are queued by startWild and
  // reach the box on the first update, not before it.
  runner.update();
  check("the opening lines reach the box on the first frame",
        view.seen.length > 0 && view.seen[0].length > 0, JSON.stringify(view.seen.slice(0, 2)));
  check("seeing it records the dex entry",
        play.dexSeen[bundle.species.PIDGEY.dex - 1] === true);

  const frames = drive(runner, view);
  check("the battle ends", runner.state() === R.RUNNER_DONE, frames + " frames");
  check("the player is offered a menu at least once", view.menus() > 0,
        view.menus() + " menus");

  // Sound. The runner asks for ONE effect a turn -- the cartridge plays several
  // against move animations this project does not have -- so what is worth
  // asserting is that hits are heard, that a knockout is heard as a knockout,
  // and that nothing asks for two at once.
  check("a fought battle makes sounds", view.sounds.length > 0);
  check("and only known ones", view.sounds.every((k) =>
        ["Damage", "Super_Effective", "Not_Very_Effective", "Faint_Fall",
         "Caught_Mon", "Ball_Poof", "Run"].indexOf(k) >= 0),
        view.sounds.join(","));
  check("a battle that ended in a knockout ends on the faint",
        view.sounds[view.sounds.length - 1] === "Faint_Fall",
        view.sounds.join(","));
  check("never more sounds than turns", view.sounds.length <= view.menus() + 2,
        view.sounds.length + " sounds, " + view.menus() + " menus");
  check("the move names carry their PP",
        !!(view.lastMoves && view.lastMoves.length > 0 && view.lastMoves[0].indexOf("/") > 0),
        JSON.stringify(view.lastMoves));
  // The panel is 18 columns and column 0 is the cursor. Seventeen of the
  // cartridge's moves are twelve characters long, so "name + two spaces + pp"
  // ran to nineteen and the last two characters were silently not drawn.
  check("and fit the seventeen columns a row has",
        view.lastMoves.every((l) => l.length <= 17),
        JSON.stringify(view.lastMoves.map((l) => l.length)));
  check("a level-20 starter beats a level-4 Pidgey", runner.won() === true);
  check("and the party it fought with is the one in the save",
        play.party.length === 1 && play.party[0].species === "CHARMANDER");
  check("which has taken damage or gained experience",
        play.party[0].hp < play.party[0].maxHp || play.party[0].exp > 0,
        JSON.stringify({ hp: play.party[0].hp, max: play.party[0].maxHp, exp: play.party[0].exp }));
}

// ---------------------------------------------------------------------------
// 2. A trainer battle, from a roster in the bundle
// ---------------------------------------------------------------------------

console.log("\n== A trainer battle ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = party("CHARMANDER", 30, 11);
  const view = makeView({});
  const runner = new R.BattleRunner(bundle, play, view);
  const started = runner.startTrainer("OPP_BROCK", 1, seeded(1234));

  check("a trainer battle starts from the bundle's roster", started === true,
        "the bundle must carry trainers for this to work at all");
  drive(runner, view);
  check("it ends", runner.state() === R.RUNNER_DONE);
  check("Brock's two Pokemon both had to be beaten",
        view.seen.filter((l) => l.indexOf("fainted") >= 0).length >= 2,
        JSON.stringify(view.seen.filter((l) => l.indexOf("fainted") >= 0)));
  check("and the player won", runner.won() === true);
  // GetTrainerInformation: the prize is the class's base money times the level
  // of the LAST Pokemon in the roster (Brock: 99 * 14 = 1386), announced with
  // _MoneyForWinningText before the battle ends.
  const brock = bundle.trainers.OPP_BROCK;
  const roster = brock.parties[0];
  const expected = brock.baseMoney * roster[roster.length - 1].level;
  check("the prize money is paid, base money times the last Pokemon's level",
        play.money === 3000 + expected, "money=" + play.money + " expected +" + expected);
  check("and announced with the cartridge's own line",
        view.seen.some((l) => l.indexOf("got \u00a5" + expected) >= 0 && l.indexOf("for winning") >= 0),
        JSON.stringify(view.seen.slice(-6)));
}

// ---------------------------------------------------------------------------
// 2b. A menu row is not a move slot
//
// The engine reads moveIndex as a RAW SLOT into mon.moves -- "Move slot 0..3",
// and it checks mon.moves[slot].id === "" at that index. A menu can only list
// the moves that EXIST. With a hole in the slots the two numbers diverge, and
// picking the second row used to use the first move.
// ---------------------------------------------------------------------------

console.log("\n== Rows against slots ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = party("CHARMANDER", 30, 41);
  const mon = play.party[0];
  const real = mon.moves.filter((m) => m.id && m.id.length > 0);
  check("the probe Pokemon has at least three moves to work with",
        real.length >= 3, JSON.stringify(mon.moves.map((m) => m.id)));

  // Blank slot 0. The real moves are now at slots 1, 2, 3 and the menu shows
  // three rows. ROW 1 is the discriminating one: it means SLOT 2, and reading
  // it as slot 1 picks a different move that is perfectly valid -- so the
  // engine's empty-slot fallback cannot cover for the mistake.
  //
  // Row 0 would NOT discriminate. It means slot 1, and reading it as slot 0
  // hits an empty slot, whereupon firstUsableSlot sends slot 1 anyway and the
  // outcome is identical. The first version of this test used row 0 and passed
  // with the bug deliberately put back.
  mon.moves[0] = { id: "", pp: 0, maxPp: 0 };
  const slotOne = mon.moves[1].id;
  const slotTwo = mon.moves[2].id;
  check("and the two candidate slots hold different moves",
        slotOne !== slotTwo, `${slotOne} vs ${slotTwo}`);

  const view = makeView({ move: 1 });
  const runner = new R.BattleRunner(bundle, play, view);
  runner.startWild("PIDGEY", 3, seeded(4242));
  for (let i = 0; i < 200 && !view.lastMoves; i++) { runner.update(); }
  check("the menu lists only the moves that exist",
        !!view.lastMoves && view.lastMoves.length === 3, JSON.stringify(view.lastMoves));
  check("its second row names the move in slot 2",
        !!view.lastMoves && view.lastMoves[1].indexOf(slotTwo) === 0,
        JSON.stringify(view.lastMoves && view.lastMoves[1]));

  drive(runner, view);
  const used = view.seen.filter((l) => l.indexOf("used") >= 0);
  check("and choosing it uses slot 2's move",
        used.some((l) => l.indexOf(slotTwo) >= 0), JSON.stringify(used.slice(0, 4)));
  check("never slot 1's",
        !used.some((l) => l.indexOf(slotOne) >= 0), JSON.stringify(used.slice(0, 4)));
}

// ---------------------------------------------------------------------------
// 2c. Who is actually out
//
// The runner used to find "the active Pokemon" by scanning the party for the
// first member with HP. That is the same Pokemon only while nobody has ever
// switched -- true today only because nothing can switch voluntarily yet, which
// made it a dormant bug that would wake the moment a party menu did. The move
// list is built from whoever this returns, so getting it wrong offers the
// player the bench's moves.
// ---------------------------------------------------------------------------

console.log("\n== Who is out ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = [makeWildMon(bundle, "CHARMANDER", 20, seeded(61)),
                makeWildMon(bundle, "SQUIRTLE", 20, seeded(62))];
  const view = makeView({});
  const runner = new R.BattleRunner(bundle, play, view);
  runner.startWild("PIDGEY", 3, seeded(63));
  for (let i = 0; i < 200 && !view.lastMoves; i++) { runner.update(); }
  // Switch to the SECOND party member, which is HEALTHY -- so a scan for the
  // first healthy member still answers CHARMANDER while SQUIRTLE is out. That
  // divergence is the whole bug, and it needs a voluntary switch to exist.
  const T = await import("../Assets/Scripts/play/battle/types.ts");
  const St = await import("../Assets/Scripts/play/battle/BattleState.ts");
  const battle = St.startWildBattle(bundle, play.party, 0,
                                    makeWildMon(bundle, "PIDGEY", 3, seeded(64)), seeded(65));
  battle.takeTurn({ kind: T.ACTION_SWITCH, moveIndex: -1, partyIndex: 1, item: "" });
  check("a switch puts the second member out",
        battle.ctx.player.active.species === "SQUIRTLE",
        battle.ctx.player.active.species);
  check("while the first is still healthy on the bench",
        battle.party()[0].hp > 0, "so a first-healthy scan would answer CHARMANDER");
  check("so the two answers genuinely differ once a switch has happened",
        battle.party()[0].species !== battle.ctx.player.active.species,
        "party[0]=" + battle.party()[0].species +
        " active=" + battle.ctx.player.active.species);

  // HONEST GAP: the runner reads ctx.player.active, which is right, and this
  // file cannot yet prove it end to end -- nothing can ask the RUNNER to switch
  // until the party menu exists, and until then its active is always the first
  // healthy one and both readings agree. What is pinned above is the divergence
  // the fix exists for. When the party menu lands, the test to add here is:
  // switch through the menu, then assert the move list names the Pokemon that
  // is out. Do not delete this note without adding that test.
  check("the shape the fix depends on exists",
        !!(battle.ctx && battle.ctx.player && battle.ctx.player.active &&
           battle.ctx.player.active.moves),
        "if ctx.player.active ever stops existing, activeMon breaks silently");
}

// ---------------------------------------------------------------------------
// 2d. Switching and items, from the menu
// ---------------------------------------------------------------------------

console.log("\n== Switching and items ==");
{
  // A one-shot choice: the menu answers once and then stops, the way a player
  // pressing A once does. A stub that kept answering would switch every turn.
  function oneShot(field, value) {
    const view = makeView({});
    let given = false;
    const key = { switchTo: "chosenSwitch", bagItem: "chosenBagItem" }[field];
    const idle = field === "bagItem" ? "" : -1;
    view[key] = () => {
      if (given) { return idle; }
      given = true;
      return value;
    };
    return view;
  }

  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = [makeWildMon(bundle, "CHARMANDER", 20, seeded(71)),
                makeWildMon(bundle, "SQUIRTLE", 20, seeded(72))];
  const view = oneShot("switchTo", 1);
  const runner = new R.BattleRunner(bundle, play, view);
  runner.startWild("PIDGEY", 3, seeded(73));
  drive(runner, view);
  check("a switch from the menu is accepted",
        view.seen.some((l) => l.indexOf("SQUIRTLE") >= 0),
        JSON.stringify(view.seen.slice(0, 8)));

  // The bag comes down only when the engine says the item did something.
  const heal = PlayState.newPlayState(bundle.romSha1);
  heal.party = [makeWildMon(bundle, "CHARMANDER", 20, seeded(74))];
  heal.party[0].hp = 5;
  PlayState.giveItem(heal, "POTION", 2);
  const healView = oneShot("bagItem", "POTION");
  const healRunner = new R.BattleRunner(bundle, heal, healView);
  healRunner.startWild("PIDGEY", 3, seeded(75));
  drive(healRunner, healView);
  check("using a Potion takes exactly one out of the bag",
        PlayState.hasItem(heal, "POTION", 1) && !PlayState.hasItem(heal, "POTION", 2),
        JSON.stringify(heal.bag));

  // A Potion on a Pokemon at full HP still heals nothing, but the engine
  // reports the turn as legal. Decrementing on `ok` would eat it.
  const wasted = PlayState.newPlayState(bundle.romSha1);
  wasted.party = [makeWildMon(bundle, "CHARMANDER", 20, seeded(76))];
  PlayState.giveItem(wasted, "BICYCLE", 1);
  const wastedView = oneShot("bagItem", "BICYCLE");
  const wastedRunner = new R.BattleRunner(bundle, wasted, wastedView);
  wastedRunner.startWild("PIDGEY", 3, seeded(77));
  drive(wastedRunner, wastedView);
  check("an item with no battle effect is NOT taken out of the bag",
        PlayState.hasItem(wasted, "BICYCLE", 1),
        JSON.stringify(wasted.bag) + " -- report.ok is not 'the item was used'");
}

// ---------------------------------------------------------------------------
// 3. The refusals
// ---------------------------------------------------------------------------

console.log("\n== What it refuses ==");
{
  const empty = PlayState.newPlayState(bundle.romSha1);
  const runner = new R.BattleRunner(bundle, empty, makeView({}));
  check("no battle with an empty party", runner.startWild("PIDGEY", 4, seeded(2)) === false,
        "startWildBattle throws on this; refusing is the only safe answer");

  const wiped = PlayState.newPlayState(bundle.romSha1);
  wiped.party = party("CHARMANDER", 5, 3);
  wiped.party[0].hp = 0;
  const r2 = new R.BattleRunner(bundle, wiped, makeView({}));
  check("nor with a wiped one", r2.startWild("PIDGEY", 4, seeded(2)) === false);

  const ok = PlayState.newPlayState(bundle.romSha1);
  ok.party = party("CHARMANDER", 5, 4);
  const r3 = new R.BattleRunner(bundle, ok, makeView({}));
  check("no battle against a species this bundle lacks",
        r3.startWild("MISSINGNO", 4, seeded(2)) === false);
  const r4 = new R.BattleRunner(bundle, ok, makeView({}));
  check("nor against a trainer it lacks",
        r4.startTrainer("OPP_NOBODY", 1, seeded(2)) === false);
  const r5 = new R.BattleRunner(bundle, ok, makeView({}));
  check("nor against a roster the trainer does not have",
        r5.startTrainer("OPP_BROCK", 9, seeded(2)) === false);
}

// ---------------------------------------------------------------------------
// 4. Losing, and what a whiteout restores
// ---------------------------------------------------------------------------

console.log("\n== Losing ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = party("MAGIKARP", 5, 21);
  play.mapId = "ROUTE_1";
  play.cellX = 9;
  play.cellY = 9;
  play.respawnMapId = "REDS_HOUSE_1F";
  play.respawnCellX = 3;
  play.respawnCellY = 6;
  const started = play.money;
  const view = makeView({});
  const runner = new R.BattleRunner(bundle, play, view);
  // RATTATA, not PIDGEY. A level-40 Pidgey knows WHIRLWIND, and in Generation 1
  // that BLOWS THE PLAYER OUT OF THE BATTLE -- the result is "fled", not "lost",
  // so no whiteout happens and this test was asserting against a knockout that
  // never came. The runner was right; the test's premise was wrong.
  runner.startWild("RATTATA", 40, seeded(5));
  drive(runner, view);

  check("a level-5 Magikarp loses to a level-40 Rattata",
        runner.state() === R.RUNNER_DONE && runner.won() === false);
  // HandleBlackOut -> PrepareForSpecialWarp reads wLastBlackoutMap and lands
  // on its FLY spot, outdoors (special_warps.asm's BIT_ESCAPE_WARP branch):
  // with no Center used yet that is Pallet Town, in front of your own house,
  // (5,6) -- not the counter, which is where Gen 2 puts you, and not the
  // bedroom this check used to expect.
  check("a whiteout returns the player to the fly spot of the last blackout map",
        play.mapId === "PALLET_TOWN" && play.cellX === 5 && play.cellY === 6,
        JSON.stringify({ map: play.mapId, x: play.cellX, y: play.cellY }));
  // And SAYS it did. The lens has to move the world to match, and it used to
  // work that out by comparing play.mapId with the overworld's -- which is a
  // stale save rather than a signal, because play.mapId is written by the
  // twenty second autosave and by nothing else. After one loss the heal point
  // sat there and every later battle warped the player home, won or not.
  check("...and reports the warp rather than leaving it to be inferred",
        runner.whiteout() === true);
  check("and heals the party rather than leaving it at zero",
        play.party[0].hp === play.party[0].maxHp,
        JSON.stringify({ hp: play.party[0].hp, max: play.party[0].maxHp }));

  // Half the money, and no line about it: this cartridge's text table has
  // nothing at all about losing money -- "you panicked and dropped..." is a
  // Generation 2 line -- so the silence is the cartridge's, not a shortcut.
  const spoke = view.seen.join(" ");
  // Stated so the check cannot pass on an empty purse: 0 halved is 0.
  check("the player started with money at all", started > 0, started);
  check("a whiteout costs half the money", play.money === Math.floor(started / 2),
        started + " -> " + play.money);
  check("and says nothing about it",
        spoke.indexOf("money") < 0 && spoke.indexOf("dropped") < 0);
  // What it DOES say: _PlayerBlackedOutText, with the player's name, before
  // the battle screen goes. The night of 17 September found the lens going
  // straight from "fainted!" to the town without a word.
  check("but it does say the player blacked out, in the cartridge's words",
        view.seen.some((l) => l.indexOf("RED is out of") >= 0) &&
        view.seen.some((l) => l.indexOf("RED blacked") >= 0),
        JSON.stringify(view.seen.slice(-4)));

  // An odd purse rounds down, as integer halving does.
  const odd = PlayState.newPlayState(bundle.romSha1);
  odd.party = party("MAGIKARP", 5, 21);
  odd.money = 3001;
  odd.respawnMapId = "REDS_HOUSE_1F";
  const oddView = makeView({});
  const oddRunner = new R.BattleRunner(bundle, odd, oddView);
  oddRunner.startWild("RATTATA", 40, seeded(5));
  drive(oddRunner, oddView);
  check("an odd purse rounds down", odd.money === 1500, odd.money);

  // Winning does not.
  const won = PlayState.newPlayState(bundle.romSha1);
  won.party = party("CHARMANDER", 30, 7);
  const wonBefore = won.money;
  const wonView = makeView({});
  const wonRunner = new R.BattleRunner(bundle, won, wonView);
  wonRunner.startWild("PIDGEY", 3, seeded(99));
  check("a battle that has not ended has warped nobody", wonRunner.whiteout() === false);
  drive(wonRunner, wonView);
  check("winning costs nothing", won.money === wonBefore, wonBefore + " -> " + won.money);
  // The one that shipped broken: a WON battle must not report a warp, or the
  // lens rebuilds the world at the healing point and the player finds
  // themselves in Red's house after every encounter they win.
  check("and warps nobody home", wonRunner.whiteout() === false);
  check("...even when the save still names the last heal point",
        won.respawnMapId.length > 0 && wonRunner.whiteout() === false,
        won.respawnMapId);
}

// ---------------------------------------------------------------------------
// 5. Running away
// ---------------------------------------------------------------------------

console.log("\n== Running ==");
{
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = party("RAPIDASH", 50, 31);
  const view = makeView({ run: true });
  const runner = new R.BattleRunner(bundle, play, view);
  runner.startWild("PIDGEY", 3, seeded(77));
  drive(runner, view);
  check("a fast Pokemon can flee a wild battle",
        runner.state() === R.RUNNER_DONE &&
        view.seen.some((l) => l.indexOf("GOT AWAY") >= 0 || l.indexOf("got away") >= 0 ||
                              l.indexOf("Got away") >= 0),
        JSON.stringify(view.seen.slice(-3)));

  const trainerPlay = PlayState.newPlayState(bundle.romSha1);
  trainerPlay.party = party("RAPIDASH", 50, 32);
  const tview = makeView({ run: true });
  const trunner = new R.BattleRunner(bundle, trainerPlay, tview);
  trunner.startTrainer("OPP_BROCK", 1, seeded(78));
  drive(trunner, tview);
  check("but not a trainer battle",
        trunner.state() === R.RUNNER_DONE && trunner.won() === true,
        "fleeing a gym leader would skip the badge");
}

// ---------------------------------------------------------------------------
// 6. Many battles, all of which must end
// ---------------------------------------------------------------------------

console.log("\n== A level-up that wants a move forgotten ==");
{
  // The gap this closes: a Pokemon with four moves that levelled into a fifth
  // simply did not learn it, and nothing said so. BattleState's own comment
  // admitted as much -- "1.0 has no 'forget which move?' prompt" -- and a
  // silently skipped level-up move is indistinguishable from a working game.
  function aboutToLearnEmber(learnAnswer) {
    const play = PlayState.newPlayState(bundle.romSha1);
    const mon = makeWildMon(bundle, "CHARMANDER", 8, seeded(7));
    // Four moves, so the level-up has nowhere to put EMBER.
    mon.moves = [
      { id: "SCRATCH", pp: 35, maxPp: 35 },
      { id: "GROWL", pp: 40, maxPp: 40 },
      { id: "TACKLE", pp: 35, maxPp: 35 },
      { id: "TAIL_WHIP", pp: 30, maxPp: 30 },
    ];
    // One point below level 9, which is where CHARMANDER learns EMBER.
    const rate = bundle.species.CHARMANDER.growthRate;
    mon.exp = Party.expForLevel(rate, 9) - 1;
    play.party = [mon];
    const view = makeView(learnAnswer === undefined ? {} : { learn: learnAnswer });
    const runner = new R.BattleRunner(bundle, play, view);
    runner.startWild("PIDGEY", 3, seeded(99));
    const frames = drive(runner, view, 4000);
    return { play, view, runner, frames };
  }

  check("CHARMANDER really does learn EMBER at 9",
        Party.movesLearnedAt(bundle.species.CHARMANDER, 9).indexOf("EMBER") >= 0);

  {
    const r = aboutToLearnEmber(2);           // forget the third slot
    check("the battle ends", r.runner.state() === R.RUNNER_DONE, r.frames + " frames");
    check("the level-up asked", r.view.asked.length === 1, JSON.stringify(r.view.asked));
    check("about the right move",
          r.view.asked.length > 0 && r.view.asked[0].move === "EMBER");
    check("and about the Pokemon that levelled",
          r.view.asked.length > 0 && r.view.asked[0].mon === "CHARMANDER");

    const moves = r.play.party[0].moves.map((m) => m.id);
    check("the chosen slot now holds the new move", moves[2] === "EMBER", moves.join(","));
    check("the move it replaced is gone", moves.indexOf("TACKLE") < 0, moves.join(","));
    check("the other three are untouched",
          moves[0] === "SCRATCH" && moves[1] === "GROWL" && moves[3] === "TAIL_WHIP",
          moves.join(","));
    check("and it comes back at full PP",
          r.play.party[0].moves[2].pp === bundle.moves.EMBER.pp,
          r.play.party[0].moves[2].pp + " of " + bundle.moves.EMBER.pp);
    check("the level actually went up", r.play.party[0].level >= 9, r.play.party[0].level);
  }

  {
    // Keeping what you have is a real answer on the cartridge, not a failure.
    const r = aboutToLearnEmber(LEARN_ABANDONED);
    check("saying no still ends the battle", r.runner.state() === R.RUNNER_DONE);
    check("it still asked", r.view.asked.length === 1);
    const moves = r.play.party[0].moves.map((m) => m.id);
    check("and nothing was forgotten",
          moves.join(",") === "SCRATCH,GROWL,TACKLE,TAIL_WHIP", moves.join(","));
    check("nor learned", moves.indexOf("EMBER") < 0);
    check("but the level still went up", r.play.party[0].level >= 9, r.play.party[0].level);
  }

  {
    // A Pokemon with room does not ask at all: the engine fills the slot.
    const play = PlayState.newPlayState(bundle.romSha1);
    const mon = makeWildMon(bundle, "CHARMANDER", 8, seeded(7));
    mon.moves = [{ id: "SCRATCH", pp: 35, maxPp: 35 }];
    mon.exp = Party.expForLevel(bundle.species.CHARMANDER.growthRate, 9) - 1;
    play.party = [mon];
    const view = makeView({});
    const runner = new R.BattleRunner(bundle, play, view);
    runner.startWild("PIDGEY", 3, seeded(99));
    drive(runner, view, 4000);
    check("a free slot asks nothing", view.asked.length === 0, JSON.stringify(view.asked));
    const moves = play.party[0].moves.map((m) => m.id);
    check("and the move is simply learned", moves.indexOf("EMBER") >= 0, moves.join(","));
    // The line names the move as the cartridge prints it. A two-word move
    // would show its id's underscore otherwise ("learned TAIL_WHIP!").
    const learnedLine = view.seen.filter((l) => l.indexOf("learned") >= 0)[0] || "";
    check("and the line names it as the cartridge does",
          learnedLine.indexOf("learned " + bundle.moves.EMBER.name + "!") >= 0 && learnedLine.indexOf("_") < 0,
          learnedLine);
  }
  {
    // A two-word move, so the id and the name differ: LEECH SEED, not
    // LEECH_SEED. Bulbasaur learns it at 7 on every cartridge; the first
    // draft used Pikachu's TAIL WHIP at 6, which only Yellow's learnset has.
    const play = PlayState.newPlayState(bundle.romSha1);
    const mon = makeWildMon(bundle, "BULBASAUR", 6, seeded(7));
    mon.moves = [{ id: "TACKLE", pp: 35, maxPp: 35 }];
    mon.exp = Party.expForLevel(bundle.species.BULBASAUR.growthRate, 7) - 1;
    play.party = [mon];
    const view = makeView({});
    const runner = new R.BattleRunner(bundle, play, view);
    runner.startWild("PIDGEY", 2, seeded(99));
    drive(runner, view, 4000);
    const learnedLine = view.seen.filter((l) => l.indexOf("learned") >= 0)[0] || "";
    check("a two-word move is named with its space",
          Party.movesLearnedAt(bundle.species.BULBASAUR, 7).indexOf("LEECH_SEED") >= 0 &&
          learnedLine.indexOf("LEECH SEED") >= 0 && learnedLine.indexOf("LEECH_SEED") < 0,
          learnedLine || JSON.stringify(Party.movesLearnedAt(bundle.species.BULBASAUR, 7)));
  }
}

console.log("\n== It always ends ==");
{
  let ended = 0;
  let longest = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const play = PlayState.newPlayState(bundle.romSha1);
    play.party = party("CHARMANDER", 10 + (seed % 20), seed * 3);
    const view = makeView({ move: seed % 4 });
    const runner = new R.BattleRunner(bundle, play, view);
    if (!runner.startWild("PIDGEY", 3 + (seed % 12), seeded(seed * 17))) {
      continue;
    }
    const frames = drive(runner, view);
    if (runner.state() === R.RUNNER_DONE) { ended++; }
    if (frames > longest) { longest = frames; }
  }
  check("120 battles all reach an end", ended === 120, ended + "/120");
  check("and none of them takes an absurd number of frames", longest < 4000,
        "longest was " + longest);
}

if (selftest) {
  console.log("\n-- selftest --");
  // A view that never acknowledges must stall, not finish. If the runner
  // "completes" here, it is not waiting for the player at all and every
  // assertion above passed for the wrong reason.
  const play = PlayState.newPlayState(bundle.romSha1);
  play.party = party("CHARMANDER", 20, 7);
  const stubborn = makeView({});
  stubborn.acknowledged = () => false;
  const runner = new R.BattleRunner(bundle, play, stubborn);
  runner.startWild("PIDGEY", 4, seeded(99));
  drive(runner, stubborn, 300);
  check("[selftest] a player who never presses A never finishes the battle",
        runner.state() !== R.RUNNER_DONE,
        "the runner is not actually waiting for the player");

  const noMenu = makeView({});
  noMenu.chosenMove = () => -1;
  const play2 = PlayState.newPlayState(bundle.romSha1);
  play2.party = party("CHARMANDER", 20, 7);
  const r2 = new R.BattleRunner(bundle, play2, noMenu);
  r2.startWild("PIDGEY", 4, seeded(99));
  drive(r2, noMenu, 300);
  check("[selftest] nor one who never picks a move",
        r2.state() !== R.RUNNER_DONE,
        "the runner is choosing moves by itself");
}

console.log("\n== The old man's catching demonstration ==");
{
  // BATTLE_TYPE_OLD_MAN: no Pokemon sent out, the menu driven by the game,
  // a ball that always holds (ItemUseBall .oldManBattle -> .captured), and
  // .oldManCaughtMon: nothing to the dex, the party or the bag.
  const play = PlayState.newPlayState(bundle.romSha1);
  play.playerName = "RED";
  play.party = party("CHARMANDER", 6, 9);
  PlayState.giveItem(play, "POKE_BALL", 3);
  const dexBefore = play.dexOwned[bundle.species.WEEDLE.dex - 1];
  const view = makeView({});
  const runner = new R.BattleRunner(bundle, play, view);
  check("it starts", runner.startDemo(seeded(3)) === true);
  check("only the WEEDLE is on the field", JSON.stringify(runner.onField()) === JSON.stringify(["", "WEEDLE"]),
        JSON.stringify(runner.onField()));
  check("and there is no HUD pair to animate", runner.hudSides().length === 0);
  drive(runner, view);
  const seen = view.seen.join(" | ").replace(/\s+/g, " ");
  check("it ends on its own", runner.state() === R.RUNNER_DONE && !runner.isRunning());
  check("the WEEDLE appears", seen.indexOf("Wild WEEDLE appeared!") >= 0, seen);
  check("OLD MAN throws the ball, in the player's own line with his name",
        seen.indexOf("OLD MAN used POK") >= 0 && seen.indexOf("BALL!") >= 0 && seen.indexOf("RED used") < 0, seen);
  check("and it is caught", seen.indexOf("WEEDLE was caught!") >= 0 && view.sounds.indexOf("Caught_Mon") >= 0,
        seen + " " + JSON.stringify(view.sounds));
  check("nothing is handed over", play.party.length === 1 && play.party[0].species === "CHARMANDER");
  check("the dex is not touched", play.dexOwned[bundle.species.WEEDLE.dex - 1] === dexBefore);
  check("and no ball leaves the bag", play.bag.find((b) => b.id === "POKE_BALL").count === 3);
  check("it is not a win, so no victory music is owed", runner.won() === false && runner.whiteout() === false);
}

console.log("\n== The GHOST in the tower ==");
{
  // IsGhostBattle (engine/battle/core.asm:3309-3324): a wild battle in the
  // tower with no SILPH SCOPE. No flag anywhere -- the scope works the moment
  // it is picked up.
  const { isGhostBattle } = await import("../Assets/Scripts/play/battle/Ghost.ts");
  check("every floor of the tower, and only without the scope",
        isGhostBattle("POKEMON_TOWER_3F", false) === true &&
        isGhostBattle("POKEMON_TOWER_7F", false) === true &&
        isGhostBattle("POKEMON_TOWER_3F", true) === false &&
        isGhostBattle("ROCK_TUNNEL_1F", false) === false);

  function ghostRunner(withScope, opts) {
    const play = PlayState.newPlayState(bundle.romSha1);
    play.playerName = "RED";
    play.party = party("CHARMANDER", 20, 11);
    if (withScope) { play.bag.push({ id: "SILPH_SCOPE", count: 1 }); }
    const view = makeView(opts);
    const runner = new R.BattleRunner(bundle, play, view);
    runner.startWild("GASTLY", 20, seeded(12), "POKEMON_TOWER_3F");
    return { runner: runner, view: view, play: play };
  }

  // The opening lines are queued by begin() and reach the view as the runner
  // is driven, so it has to run a few frames before anything is on screen.
  const ghost = ghostRunner(false, { run: true });
  drive(ghost.runner, ghost.view, 2000);
  const opening = ghost.view.seen.join(" ");
  check("it appears without a name and cannot be ID'd",
        opening.indexOf("GHOST") >= 0 && opening.indexOf("ID'd") >= 0 &&
        opening.indexOf("Wild GASTLY") < 0, opening);
  check("and nothing is added to the dex for it",
        ghost.play.dexSeen[bundle.species.GASTLY.dex - 1] !== true,
        "GASTLY seen: " + ghost.play.dexSeen[bundle.species.GASTLY.dex - 1]);

  // PrintGhostText: neither side's move runs.
  const fighting = ghostRunner(false, { move: 0 });
  drive(fighting.runner, fighting.view, 2000);
  const said = fighting.view.seen.join(" ");
  check("the player is too scared to move and the ghost says get out",
        said.indexOf("too") >= 0 && said.indexOf("scared") >= 0 &&
        said.indexOf("Get out") >= 0, said.slice(0, 300));
  check("and nothing lost any HP", fighting.play.party[0].hp === fighting.play.party[0].maxHp,
        fighting.play.party[0].hp + "/" + fighting.play.party[0].maxHp);

  // TryRunningFromBattle: a ghost always lets you go.
  const running = ghostRunner(false, { run: true });
  drive(running.runner, running.view, 2000);
  check("running always works", running.view.seen.join(" ").indexOf("Got away") >= 0,
        running.view.seen.join(" ").slice(0, 200));

  // ItemUseBall: the capture calculation is skipped entirely.
  const balling = ghostRunner(false, { bagItem: "POKE_BALL" });
  balling.play.bag.push({ id: "POKE_BALL", count: 5 });
  drive(balling.runner, balling.view, 2000);
  check("a ball cannot catch it", balling.play.party.length === 1 &&
        balling.play.party[0].species === "CHARMANDER",
        JSON.stringify(balling.play.party.map((m) => m.species)));
  // The view throws one every turn for as long as it is driven, so what is
  // pinned is that they LEAVE the bag -- until 20 September none did.
  const ballsLeft = balling.play.bag.filter((b) => b.id === "POKE_BALL").reduce((n, b) => n + b.count, 0);
  check("it dodges the ball, and the ball is spent all the same",
        balling.view.seen.join(" ").indexOf("dodged") >= 0 && ballsLeft < 5,
        JSON.stringify(balling.play.bag));

  // The restless soul: WITH the scope MAROWAK is named and fights, and a ball
  // still cannot hold her (item_effects.asm tests POKEMON_TOWER_6F and
  // RESTLESS_SOUL). Anywhere else a MAROWAK is just a MAROWAK.
  const { isRestlessSoul } = await import("../Assets/Scripts/play/battle/Ghost.ts");
  check("only MAROWAK, and only on the sixth floor",
        isRestlessSoul("POKEMON_TOWER_6F", "MAROWAK") && !isRestlessSoul("POKEMON_TOWER_5F", "MAROWAK") &&
        !isRestlessSoul("POKEMON_TOWER_6F", "GASTLY") && !isRestlessSoul("VICTORY_ROAD_1F", "MAROWAK"));
  const soulPlay = PlayState.newPlayState(bundle.romSha1);
  soulPlay.playerName = "RED";
  soulPlay.party = party("CHARMANDER", 40, 11);
  soulPlay.bag.push({ id: "SILPH_SCOPE", count: 1 });
  soulPlay.bag.push({ id: "MASTER_BALL", count: 1 });
  const soulView = makeView({ bagItem: "MASTER_BALL" });
  const soul = new R.BattleRunner(bundle, soulPlay, soulView);
  soul.startWild("MAROWAK", 30, seeded(3), "POKEMON_TOWER_6F");
  drive(soul, soulView, 400);
  const soulSaid = soulView.seen.join(" ");
  check("she is named once the scope is in the bag", soulSaid.indexOf("Wild MAROWAK") >= 0, soulSaid.slice(0, 200));
  check("and even a MASTER BALL is dodged, and gone",
        soulSaid.indexOf("dodged") >= 0 && soulPlay.party.length === 1 &&
        !soulPlay.bag.some((b) => b.id === "MASTER_BALL" && b.count > 0),
        JSON.stringify({ bag: soulPlay.bag, said: soulSaid.slice(0, 300) }));

  const withScope = ghostRunner(true, { run: true });
  drive(withScope.runner, withScope.view, 2000);
  check("with the SILPH SCOPE it is an ordinary wild GASTLY",
        withScope.view.seen.join(" ").indexOf("Wild GASTLY") >= 0,
        withScope.view.seen.join(" "));
  check("and then it does go into the dex",
        withScope.play.dexSeen[bundle.species.GASTLY.dex - 1] === true);
}

console.log(`\n${fail === 0 ? "RUNNER OK" : "RUNNER FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
