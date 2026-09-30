// In-game trades, driven through ScriptVM and the real PlayHost.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/trade.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The baked bundle predates the trade key and may not be regenerated here. The
// first check therefore builds a tiny extraction through bundleFromExtraction,
// proving that field.trades crosses that boundary; its result is then joined to
// the baked cartridge's real species and move data for the VM tests below.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((a) => !a.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
const mutantArg = args.find((a) => a.startsWith("--mutant="));
const mutant = mutantArg ? mutantArg.substring("--mutant=".length) : "";
if (!bundlePath) {
  console.error("usage: trade.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const { bundleFromExtraction } =
  await import("../Assets/Scripts/rom/BundleFromExtraction.ts");
const { ScriptVM, DONE, KNOWN_OPS } =
  await import("../Assets/Scripts/play/script/ScriptVM.ts");
const { PlayHost } = await import("../Assets/Scripts/play/script/Host.ts");
const { newPlayState } = await import("../Assets/Scripts/play/PlayState.ts");
const { makeWildMon } = await import("../Assets/Scripts/play/battle/Stats.ts");

const baked = JSON.parse(readFileSync(bundlePath, "utf8"));
const manifest = JSON.parse(readFileSync(
  new URL("../Assets/Manifests/rom_manifest_red.json", import.meta.url), "utf8"));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (detail ? "\n          " + detail : ""));
  }
}

// Only the fields bundleFromExtraction reads when there are no maps or species.
// This keeps the test about the field -> bundle join rather than duplicating a
// 1.3 MB baked fixture in memory.
const tradeRows = manifest.field.trades;
const extracted = bundleFromExtraction({
  datasets: {
    field: { trades: tradeRows },
    maps: {},
    tilesets: {},
    sprites: {},
    pokemon: {},
    encounters: {},
    trainers: {},
    items: {},
    font: null,
    palettes: { palettes: {} },
    constants: { mapOrder: [] },
    text: {},
    text_pointers: {},
    moves: {},
    type_chart: {},
  },
  assets: {},
}, manifest.romSha1, null);

console.log("\n== Trade data ==");
const tradesMatch = Array.isArray(extracted.trades) &&
  extracted.trades.length === tradeRows.length &&
  extracted.trades.every((trade, i) =>
    trade.give === tradeRows[i].give && trade.get === tradeRows[i].get &&
    trade.nickname === tradeRows[i].nickname && trade.dialogset === tradeRows[i].dialogset);
check("field.trades is carried into the world bundle",
      tradesMatch && extracted.trades.length === 10 && extracted.trades !== tradeRows,
      JSON.stringify(extracted.trades));
check("trade is a declared VM operation", KNOWN_OPS.indexOf("trade") >= 0);

// The checked-in artifact is intentionally not rewritten by this task. Use the
// output of the bundle boundary above with its real cartridge species and moves.
const bundle = Object.assign({}, baked, { trades: extracted.trades });

function makeMon(species, level) {
  return makeWildMon(bundle, species, level, () => 0.5);
}

function makeServices(answerValue) {
  const log = [];
  return {
    log,
    answerValue: answerValue === undefined ? 1 : answerValue,
    showLines: (lines) => log.push("text:" + lines.join(" ")),
    pageAcknowledged: () => true,
    closeBox: () => log.push("close"),
    answer: function () { return this.answerValue; },
    requestAnswer: () => log.push("ask"),
    currentMap: () => bundle.maps.PALLET_TOWN,
    facePlayer: () => {},
    faceNpc: () => {},
    setNpcRevealed: () => {},
    movePlayer: () => DONE,
    npcPose: () => null,
    emote: () => DONE,
    facePlayerDir: () => {},
    walkNpc: () => DONE,
    moveNpcTo: () => DONE,
    playMusic: () => {},
    stopMusic: () => {},
    playDefaultMusic: () => {},
    textSound: () => {},
    moveNpc: () => DONE,
    warp: () => {},
    warpTo: () => {},
    beginTrainerBattle: () => {},
    battleOver: () => true,
    battleWon: () => true,
    playCry: () => {},
    fade: () => DONE,
    playOnce: () => DONE,
    frames: () => 0,
    introStage: () => {},
    nameEntry: () => DONE,
    dexEntry: () => DONE,
    playerFacing: () => "down", playerCell: () => [0, 0], blocksChanged: () => {},
    openShop: () => {}, shopOpen: () => false,
    openPc: () => {}, pcOpen: () => false,
    random: () => 0.5,
  };
}

/** Run exactly the command shape emitted by tools/transcribe.py. */
function runTrade(state, index, flag, answerValue) {
  const services = makeServices(answerValue);
  const host = new PlayHost(bundle, state, services);
  const realTrade = host.trade.bind(host);

  // Mutation hooks are used only by --selftest child processes. Both replace a
  // single production guard, then leave ScriptVM and the rest of PlayHost real.
  if (mutant === "missing-species") {
    host.trade = (tradeIndex, tradeFlag) => {
      const row = bundle.trades[tradeIndex - 1];
      const hasGive = state.party.some((mon) => mon.species === row.give);
      if (!hasGive) {
        const received = makeMon(row.get, 20);
        received.name = row.nickname;
        state.party.push(received);
        state.flags[tradeFlag] = true;
        return DONE;
      }
      return realTrade(tradeIndex, tradeFlag);
    };
  } else if (mutant === "repeat-completed") {
    host.trade = (tradeIndex, tradeFlag) => {
      // This is the production fault under test: ignore a completed flag. Two
      // eligible party members make the second unwanted exchange observable.
      if (state.flags[tradeFlag] === true) {
        state.flags[tradeFlag] = false;
      }
      return realTrade(tradeIndex, tradeFlag);
    };
  }

  const vm = new ScriptVM(host, state.flags);
  vm.start([{ op: "trade", index, flag }, { op: "end" }]);
  let frames = 0;
  // The conversation is five lines long now, and every page of every line
  // takes its own frames.
  while (vm.isRunning() && frames < 400) {
    vm.update();
    frames++;
  }
  return { services, frames, running: vm.isRunning() };
}

const FLAG = "EVENT_TRADED_NIDORINO_FOR_NIDORINA";

console.log("\n== Trade through ScriptVM ==");
{
  const state = newPlayState(bundle.romSha1);
  state.party.push(makeMon("PIDGEY", 7));
  const before = JSON.stringify(state.party);
  const result = runTrade(state, 1, FLAG);
  const said = result.services.log.filter((line) => line.startsWith("text:")).join(" ");
  check("trade refuses when the required species is absent",
        JSON.stringify(state.party) === before && state.flags[FLAG] !== true,
        JSON.stringify({ party: state.party.map((m) => m.species), flag: state.flags[FLAG] }));
  // The cartridge asks first and only then opens the party menu; with nothing
  // of the wanted species to pick, the answer is WRONG_MON.
  check("he asks for it by name first",
        said.indexOf("I'm looking for") >= 0 && said.indexOf("NIDORINO") >= 0, said);
  check("the refusal is the cartridge's own WRONG MON line",
        said.indexOf("That's not") >= 0 && said.indexOf("come back here") >= 0, said);
  check("and it was a question, not a statement", result.services.log.indexOf("ask") >= 0,
        JSON.stringify(result.services.log));
}

console.log("\n== No means no ==");
{
  const state = newPlayState(bundle.romSha1);
  state.party.push(makeMon("NIDORINO", 27));
  const before = JSON.stringify(state.party);
  const result = runTrade(state, 1, FLAG, 0);
  const said = result.services.log.filter((line) => line.startsWith("text:")).join(" ");
  check("a NIDORINO in the party is not taken without an answer",
        JSON.stringify(state.party) === before && state.flags[FLAG] !== true,
        JSON.stringify(state.party.map((m) => m.species)));
  check("and he takes it well", said.indexOf("Oh well") >= 0, said);
}

{
  const state = newPlayState(bundle.romSha1);
  state.party.push(makeMon("PIDGEY", 7));
  state.party.push(makeMon("NIDORINO", 27));
  state.party.push(makeMon("NIDORINO", 12));
  const result = runTrade(state, 1, FLAG);
  check("a valid trade script runs to completion", !result.running, result.frames + " frames");
  check("exactly one eligible Pokemon is replaced in the same party slot",
        state.party.length === 3 && state.party[0].species === "PIDGEY" &&
        state.party[1].species === "NIDORINA" && state.party[2].species === "NIDORINO",
        JSON.stringify(state.party.map((m) => m.species)));
  check("the received Pokemon keeps the handed-over level and gets its nickname",
        state.party[1].level === 27 && state.party[1].name === "TERRY" &&
        state.party[1].maxHp > 0,
        JSON.stringify({ species: state.party[1].species, level: state.party[1].level,
                         name: state.party[1].name, hp: state.party[1].maxHp }));
  check("the received species is owned and the completion flag is set",
        state.dexOwned[bundle.species.NIDORINA.dex - 1] === true &&
        state.flags[FLAG] === true);
  // InGameTrade_CopyDataToReceivedMon writes the literal "TRAINER" string and
  // a random OT id: a traded Pokemon is a FOREIGN one, and it has to arrive
  // that way because Storage.claimUnowned claims anything with no OT name.
  check("the received Pokemon belongs to somebody else",
        state.party[1].otName === "TRAINER" && state.party[1].otId > 0,
        JSON.stringify({ otName: state.party[1].otName, otId: state.party[1].otId }));
  check("and the one handed over was the player's own",
        state.party[0].otName !== "TRAINER",
        JSON.stringify({ otName: state.party[0].otName }));

  const said = result.services.log.filter((line) => line.startsWith("text:")).join(" ");
  check("the cable, the swap and the thanks, in that order",
        said.indexOf("connect the") >= 0 && said.indexOf("traded") >= 0 &&
        said.indexOf("connect the") < said.indexOf("traded") &&
        said.indexOf("traded") < said.lastIndexOf("Hey thanks"), said);
  check("and the line names both Pokemon, not one of them twice",
        said.indexOf("NIDORINO for") >= 0 && said.indexOf("NIDORINA") >= 0, said);

  const afterFirst = JSON.stringify(state.party);
  const again = runTrade(state, 1, FLAG);
  check("completed trade does not run twice",
        JSON.stringify(state.party) === afterFirst && state.flags[FLAG] === true,
        JSON.stringify(state.party.map((m) => m.species)));
  check("he asks after his old friend instead",
        again.services.log.join(" ").indexOf("great?") >= 0,
        JSON.stringify(again.services.log));
}

// Run the whole suite twice with one production guard removed each time. Merely
// exercising the good implementation is not enough: these child runs must exit
// red at the assertion that owns the fault, or this test has not proved it can
// detect the two regressions it was written for.
if (selftest) {
  console.log("\n== Mutation selftest ==");
  const cases = [
    ["missing-species", "FAIL  trade refuses when the required species is absent"],
    ["repeat-completed", "FAIL  completed trade does not run twice"],
  ];
  for (const [name, expected] of cases) {
    const child = spawnSync(process.execPath, [
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      bundlePath,
      "--mutant=" + name,
    ], { cwd: process.cwd(), encoding: "utf8" });
    check("[selftest] " + name + " mutation makes its suite go red",
          child.status === 1 && child.stdout.indexOf(expected) >= 0,
          "exit=" + child.status + "\n" + child.stdout + child.stderr);
  }
}

console.log(`\n${fail === 0 ? "TRADE OK" : "TRADE FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
