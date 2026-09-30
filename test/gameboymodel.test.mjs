// The Game Boy model in the repository is the split one, and it agrees with
// the shell's numbers.
//
//   node --experimental-strip-types --import ./test/register.mjs test/gameboymodel.test.mjs
//
// Three claims:
//   1. Assets/Models/gameboy.glb carries a Body and the five moving parts
//      tools/gameboy-split.py cuts, under the Sketchfab node chain, with
//      uint16 indices and the attribution intact.
//   2. Each part's pivot is where GameBoyShell.ts says its button is, in the
//      measured frame (raw +X right, raw +Z up, raw -Y out of the face),
//      within two model units.
//   3. The moving parts answer to every pad button exactly once.

import fs from "node:fs";

globalThis.print = () => {};

const {
  MOVING_PARTS, MODEL_BUTTON_A, MODEL_BUTTON_B, MODEL_DPAD_CENTRE, MODEL_SELECT, MODEL_START,
  RAW_UNITS_PER_MODEL_UNIT, pressAmount, dpadTilt, DPAD_TILT_DEGREES, PRESS_SECONDS,
} = await import("../Assets/Scripts/play/screen/GameBoyShell.ts");
const { ALL_BUTTONS } = await import("../Assets/Scripts/play/PadPanel.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

function readGlb(path) {
  const d = fs.readFileSync(path);
  const magic = d.readUInt32LE(0);
  const version = d.readUInt32LE(4);
  let off = 12;
  let json = null;
  let bin = null;
  while (off < d.length) {
    const len = d.readUInt32LE(off);
    const type = d.readUInt32LE(off + 4);
    const body = d.subarray(off + 8, off + 8 + len);
    if (type === 0x4E4F534A) json = JSON.parse(body.toString("utf8"));
    else if (type === 0x004E4942) bin = body;
    off += 8 + len;
  }
  return { magic, version, json, bin };
}

/** Column-major glTF matrix applied to a point. */
function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

console.log("=== the file ===");
const glb = readGlb(new URL("../Assets/Models/gameboy.glb", import.meta.url));
check("a glb 2", glb.magic === 0x46546C67 && glb.version === 2);
const nodes = glb.json.nodes;
const byName = {};
for (const n of nodes) byName[n.name] = n;
check("the Sketchfab chain is kept", !!byName["Sketchfab_model"] && !!byName["Collada visual scene group"] && !!byName["Plane"]);
check("the Body and the five parts are under Plane",
      (byName["Plane"].children || []).map((i) => nodes[i].name).sort().join(",") === "Body,ButtonA,ButtonB,Dpad,Select,Start");
let triangles = 0;
let allUint16 = true;
for (const mesh of glb.json.meshes) {
  for (const prim of mesh.primitives) {
    const acc = glb.json.accessors[prim.indices];
    triangles += acc.count / 3;
    if (acc.componentType !== 5123) allUint16 = false;
  }
}
check("every index buffer is uint16", allUint16);
check("all 15,144 triangles are still there", triangles === 15144, triangles);
check("the attribution travels with the file", (glb.json.asset.extras || {}).license !== undefined && /hirairmak/.test((glb.json.asset.extras || {}).author || ""));
check("three textures", glb.json.images.length === 3 && glb.json.textures.length === 3);

console.log("=== the pivots ===");
{
  // Plane's matrix, then the two above it, take raw to measured.
  const chain = ["Sketchfab_model", "Collada visual scene group", "Plane"].map((n) => byName[n].matrix);
  const measured = (raw) => {
    let p = raw;
    for (let i = chain.length - 1; i >= 0; i--) p = apply(chain[i], p);
    return p;
  };
  const expect = { ButtonA: MODEL_BUTTON_A, ButtonB: MODEL_BUTTON_B, Dpad: MODEL_DPAD_CENTRE, Select: MODEL_SELECT, Start: MODEL_START };
  for (const name of Object.keys(expect)) {
    const t = byName[name].translation;
    const m = measured(t);
    const dx = m[0] - expect[name][0];
    const dy = m[1] - expect[name][1];
    check(name + " pivots where the shell says", Math.hypot(dx, dy) < 2, m.map((v) => v.toFixed(1)).join(","));
  }
  check("the Body is not moved", byName["Body"].translation === undefined);
  // Raw +Y is into the face: a point pushed along it ends up at a smaller measured z.
  const a = measured([0, 0, 0]);
  const b = measured([0, 1, 0]);
  check("raw +Y goes into the face", b[2] < a[2] && Math.abs(b[0] - a[0]) < 1e-3 && Math.abs(b[1] - a[1]) < 1e-3, b.map((v) => v.toFixed(4)).join(","));
  check("and a raw unit is a hundred model units", Math.abs((a[2] - b[2]) * RAW_UNITS_PER_MODEL_UNIT - 1) < 1e-6);
}

console.log("=== the press ===");
{
  const seen = {};
  for (const part of MOVING_PARTS) for (const b of part.buttons) seen[b] = (seen[b] || 0) + 1;
  check("every pad button moves exactly one part", ALL_BUTTONS.every((b) => seen[b] === 1), JSON.stringify(seen));
  check("the D-pad is the four-button part", MOVING_PARTS.find((p) => p.node === "Dpad").buttons.length === 4);
  let amount = 0;
  let frames = 0;
  while (amount < 0.95 && frames < 60) { amount = pressAmount(amount, 1, 1 / 60); frames++; }
  check("a press is down within a few frames", frames <= 6, frames);
  check("it lands exactly", pressAmount(0.999, 1, 1 / 60) === 1);
  check("and rests exactly", pressAmount(0.001, 0, 1 / 60) === 0);
  check("a dead frame does nothing", pressAmount(0.5, 1, 0) === 0.5);
  check("the time constant is quick", PRESS_SECONDS < 0.1);
  check("up tips the top in (negative about RIGHT)", dpadTilt(true, false, false, false)[0] === -DPAD_TILT_DEGREES);
  check("down tips the bottom in", dpadTilt(false, true, false, false)[0] === DPAD_TILT_DEGREES);
  check("left tips the left in (negative about UP)", dpadTilt(false, false, true, false)[1] === -DPAD_TILT_DEGREES);
  check("right tips the right in", dpadTilt(false, false, false, true)[1] === DPAD_TILT_DEGREES);
  check("opposite arms cancel", dpadTilt(true, true, false, false)[0] === 0 && dpadTilt(false, false, true, true)[1] === 0);
  check("nothing held, no tilt", dpadTilt(false, false, false, false).every((v) => v === 0));
}

console.log("\nGAMEBOYMODEL  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
if (fail > 0) {
  process.exit(1);
}
