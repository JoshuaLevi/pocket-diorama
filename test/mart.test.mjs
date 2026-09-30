// Mart, money-comparison and Dex-entry ops, driven through ScriptVM + PlayHost.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/mart.test.mjs Assets/Generated/kanto.json [--selftest]
//
// `--selftest` removes one production effect at a time and requires this suite
// to fail at the assertion that owns it.

import { readFileSync } from "node:fs";
import { redScenarioOrSkip } from "./family.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const lensLog = [];
globalThis.print = (...parts) => lensLog.push(parts.join(" "));
globalThis.getTime = () => 0;

const args = process.argv.slice(2);
const bundlePath = args.filter((arg) => !arg.startsWith("--"))[0];
const selftest = args.indexOf("--selftest") >= 0;
const mutantArg = args.find((arg) => arg.startsWith("--mutant="));
const mutant = mutantArg ? mutantArg.substring("--mutant=".length) : "";
if (!bundlePath) {
  console.error("usage: mart.test.mjs <bundle.json> [--selftest]");
  process.exit(2);
}

const { ScriptVM, DONE, KNOWN_OPS } =
  await import("../Assets/Scripts/play/script/ScriptVM.ts");
const { PlayHost } = await import("../Assets/Scripts/play/script/Host.ts");
const { newPlayState } = await import("../Assets/Scripts/play/PlayState.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
redScenarioOrSkip(bundle, "MART", "Red's Viridian stock");

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

function servicesFor(mapId) {
  return {
    showLines: () => {}, pageAcknowledged: () => true, closeBox: () => {},
    answer: () => 1, requestAnswer: () => {},
    currentMap: () => bundle.maps[mapId],
    facePlayer: () => {}, faceNpc: () => {}, setNpcRevealed: () => {},
    movePlayer: () => DONE, facePlayerDir: () => {}, walkNpc: () => DONE,
    npcPose: () => null,
    emote: () => DONE,
    moveNpcTo: () => DONE, moveNpc: () => DONE,
    playMusic: () => {}, stopMusic: () => {}, playDefaultMusic: () => {},
    textSound: () => {}, warp: () => {}, warpTo: () => {},
    beginTrainerBattle: () => {}, battleOver: () => true, battleWon: () => true,
    playCry: () => {}, fade: () => DONE, playOnce: () => DONE, frames: () => 0,
    introStage: () => {}, nameEntry: () => DONE, dexEntry: () => DONE, random: () => 0.5,
    playerFacing: () => "down", playerCell: () => [0, 0], blocksChanged: () => {},
    openShop: (stock) => lensLog.push("shop:" + stock.join(",")), shopOpen: () => false,
    openPc: (kind) => lensLog.push("pc:" + kind), pcOpen: () => false,
  };
}

/** Run commands only through the public VM entry point. */
function run(program, state, mapId) {
  lensLog.length = 0;
  const host = new PlayHost(bundle, state, servicesFor(mapId));
  if (mutant === "money-always-true") {
    host.hasMoney = () => true;
  } else if (mutant === "dex-no-sighting") {
    host.pushScreen = (screen, species) => {
      print("[mutant] " + screen + ": " + species);
    };
  }
  const vm = new ScriptVM(host, state.flags);
  vm.start(program);
  for (let frame = 0; vm.isRunning() && frame < 50; frame++) {
    vm.update();
  }
  return { running: vm.isRunning(), log: lensLog.slice() };
}

console.log("\n== Extracted mart stock ==");
const viridianPointer = bundle.textPointers.ViridianMart.TEXT_VIRIDIANMART_CLERK;
const viridianStock = viridianPointer && viridianPointer.mart;
check("the clerk pointer carries Viridian's cartridge stock",
      JSON.stringify(viridianStock) ===
        JSON.stringify(["POKE_BALL", "ANTIDOTE", "PARLYZ_HEAL", "BURN_HEAL"]),
      JSON.stringify(viridianPointer));
const unresolved = (viridianStock || []).filter((id) =>
  !bundle.items[id] || typeof bundle.items[id].price !== "number");
check("every stocked item resolves to an extracted name and price",
      unresolved.length === 0, unresolved.join(", "));

console.log("\n== Script operations ==");
check("all three commands are declared VM operations",
      ["open_mart", "check_money", "push_screen"].every((op) =>
        KNOWN_OPS.indexOf(op) >= 0));

{
  const state = newPlayState(bundle.romSha1);
  const result = run([
    { op: "open_mart", textId: "TEXT_VIRIDIANMART_CLERK" },
    { op: "end" },
  ], state, "VIRIDIAN_MART");
  const report = result.log.join("\n");
  check("open_mart runs through the VM and reports its clerk",
        !result.running && report.indexOf("TEXT_VIRIDIANMART_CLERK") >= 0,
        report);
  check("the mart report joins stock to real names and prices",
        report.indexOf("POK\u00e9 BALL \u00a5200") >= 0 &&
        report.indexOf("ANTIDOTE \u00a5100") >= 0 &&
        report.indexOf("PARLYZ HEAL \u00a5200") >= 0 &&
        report.indexOf("BURN HEAL \u00a5250") >= 0,
        report);
}

function moneyBranch(money) {
  const state = newPlayState(bundle.romSha1);
  state.money = money;
  run([
    { op: "check_money", amount: 500 },
    { op: "jump_if_false", to: "poor" },
    { op: "give_item", item: "NUGGET", count: 1 },
    { op: "jump", to: "end" },
    { op: "label", name: "poor" },
    { op: "give_item", item: "ANTIDOTE", count: 1 },
    { op: "end" },
  ], state, "MT_MOON_POKECENTER");
  return state;
}

{
  const enough = moneyBranch(500);
  check("check_money is true at the exact price",
        enough.bag.length === 1 && enough.bag[0].id === "NUGGET",
        JSON.stringify(enough.bag));
  const short = moneyBranch(499);
  check("check_money sets false when funds are short",
        short.bag.length === 1 && short.bag[0].id === "ANTIDOTE",
        JSON.stringify(short.bag));
}

{
  const state = newPlayState(bundle.romSha1);
  const dex = bundle.species.CHANSEY.dex;
  const result = run([
    { op: "push_screen", screen: "DexEntryMenu", species: "CHANSEY" },
    { op: "end" },
  ], state, "FUCHSIA_CITY");
  const report = result.log.join("\n");
  check("DexEntryMenu records the displayed species as seen",
        state.dexSeen[dex - 1] === true, JSON.stringify(state.dexSeen[dex - 1]));
  check("viewing a Dex entry does not claim ownership",
        state.dexOwned[dex - 1] === false, JSON.stringify(state.dexOwned[dex - 1]));
  check("the missing screen reports the entry it would show",
        !result.running && report.indexOf("DexEntryMenu") >= 0 &&
        report.indexOf("#" + dex) >= 0 && report.indexOf("CHANSEY") >= 0,
        report);
}

if (selftest) {
  console.log("\n== Mutation selftest ==");
  const cases = [
    ["money-always-true", "FAIL  check_money sets false when funds are short"],
    ["dex-no-sighting", "FAIL  DexEntryMenu records the displayed species as seen"],
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

console.log(`\n${fail === 0 ? "MART OK" : "MART FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
