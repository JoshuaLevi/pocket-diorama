// One scenario, two machines, one diff.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        tools/oracle/compare.mjs <rom.gb> <bundle.json> <scenario.json> [--json]
//
// Runs the scenario's actions on the headless lens and on the cartridge in
// PyBoy, then compares the state after every action: map, cell, facing,
// party, money, badges, bag. Where they disagree the cartridge is right by
// definition, and the difference is a finding. RNG is not compared -- the
// cartridge's cannot be replayed -- so a scenario that walks into grass is
// compared only up to the grass.
//
// A scenario is { "player": "RED", "rival": "BLUE", "actions": [...] } with
// actions {walk, n} {face} {press} {wait} {text}.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.print = () => {};
globalThis.getTime = () => 0;

const [romPath, bundlePath, scenarioPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const asJson = process.argv.includes("--json");
// --screens: after every settled, box-closed action, dump both machines'
// 160x144 shade screens and diff them pixel for pixel (GAME BOY mode's proof
// against the cartridge -- SPEC.md "The cartridge as oracle"). Off by
// default so the path above -- proven against the whole scenario suite --
// never changes shape.
const asScreens = process.argv.includes("--screens");
if (!romPath || !bundlePath || !scenarioPath) {
  console.error("usage: compare.mjs <rom.gb> <bundle.json> <scenario.json> [--json]");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const { HeadlessLens } = await import("../../test/headless.mjs");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));

// ---- the lens: a new game, through the intro with the same preset names.
// A scenario may start from a prepared state (tools/oracle/state/<name>.lens.json,
// made by lensstate.mjs to match the oracle's `prepare <name>`), and may keep
// wild Pokemon away on both machines with `noWild`.
let lens;
if (scenario.start) {
  const saved = JSON.parse(readFileSync(join(here, "state", scenario.start + ".lens.json"), "utf8"));
  lens = new HeadlessLens(bundle, { state: saved, noWild: scenario.noWild === true, wanderers: scenario.stillNpcs !== true });
} else {
  lens = new HeadlessLens(bundle, { noWild: scenario.noWild === true, wanderers: scenario.stillNpcs !== true });
  lens.play.playerName = scenario.player || "RED";
  lens.play.rivalName = scenario.rival || "BLUE";
  lens.clearText();
}
const lensBoot = lens.state();

// ---- the cartridge.
const python = join(here, ".venv", "bin", "python");
const oracleArgs = [join(here, "oracle.py"), romPath, bundlePath, "run", scenarioPath];
if (asScreens) oracleArgs.push("--screens");

// --screens drives the lens one action at a time so a screen can be sampled
// right after each one, while a box is still known to be open or closed --
// and, since GAME BOY mode paints exactly what the ROM's own frame shows,
// the lens needs the ROM's OWN per-step reads (the water/flower animation
// counter, and where its wanderers actually stand) to reproduce the same
// frame. That means the cartridge has to run FIRST here, its whole scenario
// at once, so those reads exist before the lens's matching step needs them.
// The default path is untouched: the single lens.run(scenario.actions) call
// the whole rest of this file (and every scenario without --screens) was
// proven against runs before the cartridge, exactly as it always has.
let lensStates;
let romStates;
const lensScreens = [];
const lensBoxOpen = [];
if (asScreens) {
  const run = spawnSync(python, oracleArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) {
    console.error("oracle failed:\n" + run.stderr);
    process.exit(3);
  }
  romStates = run.stdout.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l));
  // Scenario start: NPCs the ROM's own boot-time RNG already walked to,
  // before this scenario's own first action -- the lens boots with
  // wanderers off (stillNpcs) and would otherwise leave every WALK npc on
  // its shipped cell (PLAYTEST.md's GAME BOY mode section).
  if (romStates[0] && romStates[0].bootNpcs) {
    lens.placeNpcs(romStates[0].bootNpcs);
  }
  lensStates = [];
  for (let i = 0; i < scenario.actions.length; i++) {
    const [st] = lens.run([scenario.actions[i]]);
    lensStates.push(st);
    lensBoxOpen.push(lens.pageWaiting === true);
    const romState = romStates[i];
    // After every action, not only a map change: a STAY npc the ROM never
    // moves can still spontaneously turn to face a new direction on its
    // own (measured: Pallet Town's girl, pinned in place by `stillNpcs`,
    // still turned left->right mid-scenario with no map change and no
    // scripted trigger) -- so "after every map change" alone left a
    // stale facing behind until the next one. Placing every action's own
    // read is the superset that also covers a map change and the very
    // first action, cheaply: sprite_positions() is read regardless, for
    // the `npcs` field every --screens dump already carries.
    if (romState && romState.npcs) {
      lens.placeNpcs(romState.npcs);
    }
    lensScreens.push(lens.pageWaiting ? null : lens.screen(romState ? romState.animPhase : -1));
  }
} else {
  lensStates = lens.run(scenario.actions);
  const run = spawnSync(python, oracleArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) {
    console.error("oracle failed:\n" + run.stderr);
    process.exit(3);
  }
  romStates = run.stdout.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l));
}
const romBoot = romStates.length > 0 ? romStates[0].boot || null : null;

// ---- the diff.
const FIELDS = ["map", "x", "y", "facing", "money", "badges"];
function partyOf(s) { return s.party.map((m) => m.species + " L" + m.level).join(","); }
function bagOf(s) { return s.bag.map((b) => b[0] + "x" + b[1]).join(","); }
const findings = [];
const rows = [];
for (let i = 0; i < scenario.actions.length; i++) {
  const a = lensStates[i];
  const b = romStates[i];
  const diffs = [];
  if (!b) { diffs.push("cartridge produced no state"); }
  else {
    for (const f of FIELDS) {
      if (String(a[f]) !== String(b[f])) diffs.push(f + ": lens " + a[f] + " / rom " + b[f]);
    }
    if (partyOf(a) !== partyOf(b)) diffs.push("party: lens [" + partyOf(a) + "] / rom [" + partyOf(b) + "]");
    if (bagOf(a) !== bagOf(b)) diffs.push("bag: lens [" + bagOf(a) + "] / rom [" + bagOf(b) + "]");
    if ("talk" in scenario.actions[i]) {
      // The words themselves, page by page. Whitespace and page breaks differ
      // in shape between a 3D box and an LCD; the text must not.
      const norm = (t) => t.replace(/\s+/g, " ").trim();
      const lensText = norm((a.talkPages || []).join(" "));
      const romText = norm((b.pages || []).join(" "));
      if (lensText !== romText) {
        diffs.push("text: lens \"" + lensText + "\" / rom \"" + romText + "\"");
      }
    }
  }
  rows.push({ action: scenario.actions[i], lens: a, rom: b, diffs });
  if (diffs.length) findings.push({ step: i, action: scenario.actions[i], diffs });
}

// ---- the screens: pixel for pixel, after every settled action with no box
// open on either machine (a box's own text and menu are not drawn yet --
// OverworldCanvas.ts's own header). A PNG-none-dependency writer: three
// chunks, zlib-deflated scanlines, CRC32 by hand -- the same shape as
// oracle.py's own save_screen_png, so a screenshot from either machine opens
// the same way.
function crc32(buf) {
  if (!crc32.table) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crc32.table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
// Oracle.py's own measured DMG greys (tools/oracle.py, GAME BOY mode pass) --
// used here only to colour a PNG for a human; the comparison itself is on
// shade INDICES, never these RGB values.
const DMG_RGB = [[255, 255, 255], [153, 153, 153], [85, 85, 85], [0, 0, 0]];
function writePng(path, width, height, pixelAt) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB truecolor
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(path, Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]));
}

let screensSame = 0;
let screensDiffer = 0;
if (asScreens) {
  const scenarioName = basename(scenarioPath).replace(/\.json$/, "");
  const screensDir = join(here, "state", "screens", scenarioName);
  for (let i = 0; i < scenario.actions.length; i++) {
    const romState = romStates[i];
    if (!romState || romState.textBox || lensBoxOpen[i]) continue;
    const romScreen = romState.screen;
    const lensScreen = lensScreens[i];
    if (!romScreen || !lensScreen) continue;
    let diffCount = 0;
    let minX = 160, minY = 144, maxX = -1, maxY = -1;
    for (let y = 0; y < 144; y++) {
      for (let x = 0; x < 160; x++) {
        if (romScreen[y][x] !== lensScreen[y][x]) {
          diffCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (diffCount === 0) {
      screensSame++;
      continue;
    }
    screensDiffer++;
    if (!asJson) {
      console.log(`  SCREEN DIFFER  step ${i} ${JSON.stringify(scenario.actions[i])}: ${diffCount} px, bbox (${minX},${minY})-(${maxX},${maxY})`);
    }
    mkdirSync(screensDir, { recursive: true });
    writePng(join(screensDir, `${i}-rom.png`), 160, 144, (x, y) => DMG_RGB[romScreen[y][x]]);
    writePng(join(screensDir, `${i}-lens.png`), 160, 144, (x, y) => DMG_RGB[lensScreen[y][x]]);
    writePng(join(screensDir, `${i}-diff.png`), 160, 144,
             (x, y) => romScreen[y][x] === lensScreen[y][x] ? DMG_RGB[romScreen[y][x]] : [255, 0, 0]);
  }
}

if (asJson) {
  const out = { scenario: scenarioPath, findings, rows };
  if (asScreens) out.screens = { same: screensSame, differ: screensDiffer };
  console.log(JSON.stringify(out, null, 1));
} else {
  for (const r of rows) {
    const tag = r.diffs.length ? "DIFF" : "same";
    console.log(`  ${tag}  ${JSON.stringify(r.action).padEnd(28)} lens ${r.lens.map} (${r.lens.x},${r.lens.y}) ${r.lens.facing}` +
                (r.rom ? `   rom ${r.rom.map} (${r.rom.x},${r.rom.y}) ${r.rom.facing}` : ""));
    for (const d of r.diffs) console.log("          " + d);
  }
  console.log("");
  console.log(`COMPARE  ${rows.length - findings.length} same, ${findings.length} differ`);
  if (asScreens) console.log(`SCREENS  ${screensSame} same, ${screensDiffer} differ`);
}
process.exit(findings.length === 0 && screensDiffer === 0 ? 0 : 1);
