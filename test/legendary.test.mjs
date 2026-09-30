// A Pokemon standing in the world, and money leaving the wallet.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/legendary.test.mjs Assets/Generated/kanto.json [--selftest]
//
// static_battle is what Mewtwo, the three birds and Snorlax are: not a trainer
// battle and not a grass roll, but a species and a level written into the
// script. The flag it sets is the player's WIN, and that distinction is the
// whole behaviour -- a legendary you fled from or fainted against is still
// standing there, which is why you can go back.

import { readFileSync } from "node:fs";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
if (!bundlePath) {
  console.error("usage: legendary.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const P = "../Assets/Scripts/play/";
const { ScriptVM, DONE, SUSPENDED } = await import(P + "script/ScriptVM.ts");
const { PlayHost } = await import(P + "script/Host.ts");
const PlayState = await import(P + "PlayState.ts");
const { makeWildMon } = await import(P + "battle/Stats.ts");

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
const mon = (sp, lv, sd) => makeWildMon(bundle, sp, lv, seeded(sd));

/** A host whose battles finish immediately, won or lost as told. */
function services(won) {
  const log = [];
  let over = true;
  return {
    log,
    showLines: (l) => log.push("text:" + l.join(" ")),
    pageAcknowledged: () => true,
    closeBox: () => {},
    answer: () => 1,
    requestAnswer: () => {},
    currentMap: () => bundle.maps.PALLET_TOWN,
    facePlayer: () => {}, faceNpc: () => {},
    setNpcRevealed: () => {}, moveNpc: () => DONE, movePlayer: () => DONE,
    npcPose: () => null,
    emote: () => DONE,
    facePlayerDir: () => {}, walkNpc: () => DONE, moveNpcTo: () => DONE,
    playMusic: () => {}, stopMusic: () => {}, playDefaultMusic: () => {},
    textSound: () => {}, givePokemon: () => 0, giveLanded: () => true,
    warp: () => {}, warpTo: () => {},
    beginTrainerBattle: (t) => { log.push("trainer:" + t); over = false; over = true; },
    beginStaticBattle: (s, l) => { log.push("static:" + s + "@" + l); over = true; },
    battleOver: () => over,
    battleWon: () => won,
    playCry: (s) => log.push("cry:" + s),
    fade: () => DONE, playOnce: () => DONE, frames: () => 0,
    introStage: () => {}, nameEntry: () => DONE, dexEntry: () => DONE, random: () => 0.5,
    playerFacing: () => "down", playerCell: () => [0, 0], blocksChanged: () => {}, openShop: () => {}, shopOpen: () => false, openPc: () => {}, pcOpen: () => false,
  };
}

function runScript(program, state, won) {
  const svc = services(won);
  const host = new PlayHost(bundle, state, svc);
  const vm = new ScriptVM(host, state.flags);
  vm.start(program);
  for (let i = 0; i < 400 && vm.isRunning(); i++) { vm.update(); }
  return { svc, running: vm.isRunning() };
}

const MEWTWO = [
  { op: "static_battle", species: "MEWTWO", level: 70, flag: "EVENT_BEAT_MEWTWO" },
];

console.log("\n== A Pokemon standing in the world ==");
{
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party = [mon("CHARMANDER", 60, 3)];
  const r = runScript(MEWTWO, state, true);
  check("the battle is started with the species and level from the script",
        r.svc.log.indexOf("static:MEWTWO@70") >= 0, JSON.stringify(r.svc.log));
  check("the script finishes", !r.running);
  check("and winning sets the flag", state.flags.EVENT_BEAT_MEWTWO === true);
}

{
  // The distinction that IS the behaviour: a legendary you did not beat is
  // still standing there. Setting the flag on the encounter rather than the win
  // would delete Mewtwo from the game the first time you fainted.
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party = [mon("CHARMANDER", 5, 4)];
  const r = runScript(MEWTWO, state, false);
  check("losing does not set the flag",
        state.flags.EVENT_BEAT_MEWTWO !== true,
        "a legendary you lost to must still be there");
  check("but the battle did happen",
        r.svc.log.indexOf("static:MEWTWO@70") >= 0);
}

{
  const state = PlayState.newPlayState(bundle.romSha1);
  const r = runScript(MEWTWO, state, true);
  check("an empty party refuses the battle rather than throwing",
        r.svc.log.indexOf("static:MEWTWO@70") < 0 && !r.running,
        JSON.stringify(r.svc.log));
  check("and no flag is set for a battle that never happened",
        state.flags.EVENT_BEAT_MEWTWO !== true);
}

{
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party = [mon("CHARMANDER", 60, 5)];
  const r = runScript([{ op: "static_battle", species: "MISSINGNO", level: 70,
                         flag: "EVENT_X" }], state, true);
  check("a species the bundle lacks is refused, not thrown",
        !r.running && state.flags.EVENT_X !== true);
}

console.log("\n== A battle that did not happen has no result ==");
{
  // check_battle_result runs one command after start_battle, and Brock's own
  // script reads it. A refused battle used to leave the PREVIOUS result
  // standing, so a script would take the victory branch of a fight that never
  // happened -- and hand over a badge for it.
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party = [mon("CHARMANDER", 60, 21)];
  runScript(MEWTWO, state, true);
  check("a won battle reports a win", state.flags.EVENT_BEAT_MEWTWO === true);

  // Now with nothing that can fight: the battle is refused, and the result
  // must NOT still say "won".
  const empty = PlayState.newPlayState(bundle.romSha1);
  const r = runScript([
    { op: "static_battle", species: "MEWTWO", level: 70, flag: "EVENT_BEAT_MEWTWO" },
    { op: "check_battle_result" },
    { op: "jump_if_true", to: "won" },
    { op: "show_text", textId: "It did not happen." },
    { op: "jump", to: "end" },
    { op: "label", name: "won" },
    { op: "show_text", textId: "It said we won." },
  ], empty, true);
  check("a refused battle does not report the previous result",
        r.svc.log.some((l) => l.indexOf("It did not happen") >= 0),
        JSON.stringify(r.svc.log));
}

console.log("\n== Money ==");
{
  const state = PlayState.newPlayState(bundle.romSha1);
  const start = state.money;
  runScript([{ op: "take_money", amount: 500 }], state, true);
  check("take_money takes it", state.money === start - 500,
        `${start} -> ${state.money}`);

  const broke = PlayState.newPlayState(bundle.romSha1);
  broke.money = 100;
  runScript([{ op: "take_money", amount: 5000 }], broke, true);
  check("and clamps at zero rather than lending", broke.money === 0,
        "money=" + broke.money);
}

if (selftest) {
  console.log("\n-- selftest --");
  const state = PlayState.newPlayState(bundle.romSha1);
  state.party = [mon("CHARMANDER", 60, 6)];
  // If the flag were set on the ENCOUNTER instead of the win, a loss would
  // still set it -- and the check above would pass for the wrong reason if the
  // battle never ran at all. Prove the battle ran AND the flag stayed clear.
  const r = runScript(MEWTWO, state, false);
  check("[selftest] the losing case really did fight",
        r.svc.log.filter((l) => l.indexOf("static:") === 0).length === 1,
        JSON.stringify(r.svc.log));
  check("[selftest] and really did not set the flag",
        state.flags.EVENT_BEAT_MEWTWO === undefined ||
        state.flags.EVENT_BEAT_MEWTWO === false);
}

console.log(`\n${fail === 0 ? "LEGENDARY OK" : "LEGENDARY FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
