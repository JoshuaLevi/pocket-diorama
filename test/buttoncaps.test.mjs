// The caps on the Game Boy's buttons: baked shading, because the display
// cannot light them.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/buttoncaps.test.mjs [--selftest]
//
// Joshua on the glasses, 30 September: the buttons "zien er cheap uit". The
// model's A and B are flat-topped cylinders and its SELECT and START flat
// slabs, all wearing the body's own pale texture, and the glasses add light
// rather than reflect it, so no lamp in the scene will ever give them a
// dome. The caps are the shading drawn once into a small sheet: a maroon
// dome with a glint for A and B, a slate rubber capsule for the two pills,
// each in an UP and a PRESSED state, laid a hair above the model's own part.
//
// Claims:
//   1. the numbers the caps stand on are the model's: each part's top, the
//      round buttons' radius, the pills' slant and size, read from the glb;
//   2. the sheet: four slots apart and inside it, clear outside each shape
//      and solid inside, lit from the upper left, darker when pressed;
//   3. the quads: one per button, over the whole button, inside the chip the
//      loose buttons give it, clear of its print, above the part's top, and
//      down with the part when pressed;
//   4. the cross has no cap, on purpose.

import fs from "node:fs";

globalThis.print = () => {};
const SELFTEST = process.argv.includes("--selftest");

const C = await import("../Assets/Scripts/play/screen/ButtonCaps.ts");
const G = await import("../Assets/Scripts/play/screen/GameBoyShell.ts");
const L = await import("../Assets/Scripts/play/screen/LooseButtons.ts");
const GL = await import("../Assets/Scripts/play/screen/GameBoyLabels.ts");

let pass = 0;
let fail = 0;
let expecting = false;
let caught = 0;
function check(label, ok, detail) {
  if (expecting) {
    if (!ok) caught++;
    return;
  }
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}
function expectFailures(name, body) {
  expecting = true;
  caught = 0;
  body();
  expecting = false;
  if (caught > 0) {
    pass++;
  } else {
    fail++;
    console.log("  FAIL selftest: nothing noticed " + name);
  }
}

// ------------------------------------------------------------ the model
function readGlb(path) {
  const d = fs.readFileSync(path);
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
  return { json, bin };
}
function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
const glb = readGlb(new URL("../Assets/Models/gameboy.glb", import.meta.url));
const byName = {};
for (const n of glb.json.nodes) byName[n.name] = n;
const chain = ["Sketchfab_model", "Collada visual scene group", "Plane"].map((n) => byName[n].matrix);
/** Every vertex of a part, in the measured frame: x right, y up, z out of the face. */
function partPoints(name) {
  const node = byName[name];
  const t = node.translation || [0, 0, 0];
  const out = [];
  for (const prim of glb.json.meshes[node.mesh].primitives) {
    const acc = glb.json.accessors[prim.attributes.POSITION];
    const view = glb.json.bufferViews[acc.bufferView];
    const stride = view.byteStride || 12;
    const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      let p = [glb.bin.readFloatLE(o) + t[0], glb.bin.readFloatLE(o + 4) + t[1], glb.bin.readFloatLE(o + 8) + t[2]];
      for (let k = chain.length - 1; k >= 0; k--) p = apply(chain[k], p);
      out.push(p);
    }
  }
  return out;
}
const topOf = (pts) => Math.max(...pts.map((p) => p[2]));

console.log("=== the numbers are the model's ===");
{
  for (const [name, centre] of [["ButtonA", G.MODEL_BUTTON_A], ["ButtonB", G.MODEL_BUTTON_B]]) {
    const pts = partPoints(name);
    check(name + "'s top is where the cap thinks", Math.abs(topOf(pts) - C.MODEL_AB_TOP_Z) < 0.05, topOf(pts).toFixed(2));
    const widest = Math.max(...pts.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1])));
    check(name + " is as wide as the cap thinks", Math.abs(widest - C.MODEL_AB_RADIUS) < 0.2, widest.toFixed(2));
  }
  for (const [name, centre] of [["Select", G.MODEL_SELECT], ["Start", G.MODEL_START]]) {
    const pts = partPoints(name);
    const top = topOf(pts);
    check(name + "'s top is where the cap thinks", Math.abs(top - C.MODEL_PILL_TOP_Z) < 0.05, top.toFixed(2));
    // The top face alone: the pill's skirt is wider and lies level with the body.
    const face = pts.filter((p) => p[2] > top - 0.5);
    const a = C.MODEL_PILL_SLANT_DEGREES * Math.PI / 180;
    let along = 0;
    let across = 0;
    for (const p of face) {
      const dx = p[0] - centre[0];
      const dy = p[1] - centre[1];
      along = Math.max(along, Math.abs(dx * Math.cos(a) + dy * Math.sin(a)));
      across = Math.max(across, Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)));
    }
    check(name + " is as long as the cap thinks, along its slant", Math.abs(along - C.MODEL_PILL_HALF_LENGTH) < 0.4, along.toFixed(2));
    check(name + " is as wide as the cap thinks, across it", Math.abs(across - C.MODEL_PILL_HALF_WIDTH) < 0.4, across.toFixed(2));
    // The slant itself: across is smallest at the true angle.
    let best = 0;
    let bestAcross = Infinity;
    for (let deg = 10; deg <= 45; deg += 0.2) {
      const r = deg * Math.PI / 180;
      let w = 0;
      for (const p of face) w = Math.max(w, Math.abs(-(p[0] - centre[0]) * Math.sin(r) + (p[1] - centre[1]) * Math.cos(r)));
      if (w < bestAcross) { bestAcross = w; best = deg; }
    }
    check(name + " slants the way the cap thinks", Math.abs(best - C.MODEL_PILL_SLANT_DEGREES) < 1.5, best.toFixed(1));
  }
  check("the cross's top is on record too", Math.abs(topOf(partPoints("Dpad")) - C.MODEL_DPAD_TOP_Z) < 0.05, topOf(partPoints("Dpad")).toFixed(2));
}

// ------------------------------------------------------------- the sheet
const slots = C.capSlots();
const sheet = C.drawCapAtlas();
const slotOf = (kind, pressed) => slots.find((s) => s.kind === kind && s.pressed === pressed);
/** One texel of a slot, by fraction across and down it: [r, g, b, a]. */
function texel(data, slot, fx, fy) {
  const x = slot.x + Math.min(slot.width - 1, Math.max(0, Math.floor(fx * slot.width)));
  const y = slot.y + Math.min(slot.height - 1, Math.max(0, Math.floor(fy * slot.height)));
  const o = (y * C.ATLAS_WIDTH + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function meanLum(data, slot) {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < slot.height; y++) for (let x = 0; x < slot.width; x++) {
    const o = ((slot.y + y) * C.ATLAS_WIDTH + slot.x + x) * 4;
    if (data[o + 3] === 255) { sum += lum([data[o], data[o + 1], data[o + 2]]); n++; }
  }
  return { mean: sum / Math.max(1, n), solid: n };
}
function sheetClaims(data) {
  check("four slots: a round cap and a pill, each up and pressed",
        slots.length === 4 && !!slotOf(C.CAP_ROUND, false) && !!slotOf(C.CAP_ROUND, true)
        && !!slotOf(C.CAP_PILL, false) && !!slotOf(C.CAP_PILL, true));
  check("the sheet is as big as it says", data.length === C.ATLAS_WIDTH * C.ATLAS_HEIGHT * 4);
  check("every slot is inside the sheet",
        slots.every((s) => s.x >= 0 && s.y >= 0 && s.x + s.width <= C.ATLAS_WIDTH && s.y + s.height <= C.ATLAS_HEIGHT));
  let apart = true;
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i];
    const b = slots[j];
    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) apart = false;
  }
  check("no two slots share a texel", apart);

  for (const pressed of [false, true]) {
    const state = pressed ? "pressed" : "up";
    const r = slotOf(C.CAP_ROUND, pressed);
    check("the round cap (" + state + ") is clear at its four corners",
          [[0, 0], [0.999, 0], [0, 0.999], [0.999, 0.999]].every((p) => texel(data, r, p[0], p[1])[3] === 0));
    check("and solid in the middle", texel(data, r, 0.5, 0.5)[3] === 255);
    const mid = texel(data, r, 0.5, 0.5);
    check("it is the DMG's maroon: red over blue over green", mid[0] > mid[2] && mid[2] > mid[1], mid.join(","));
    const p = slotOf(C.CAP_PILL, pressed);
    check("the pill (" + state + ") is clear where its slant leaves the corners empty",
          texel(data, p, 0.02, 0.04)[3] === 0 && texel(data, p, 0.98, 0.96)[3] === 0);
    check("and solid in the middle", texel(data, p, 0.5, 0.5)[3] === 255);
    // It rises to the right: solid near the top right and the bottom left, along its axis.
    check("it rises to the right", texel(data, p, 0.80, 0.30)[3] === 255 && texel(data, p, 0.20, 0.70)[3] === 255
          && texel(data, p, 0.20, 0.12)[3] === 0 && texel(data, p, 0.80, 0.88)[3] === 0);
    const slate = texel(data, p, 0.5, 0.5);
    check("it is slate rubber: dark, and no redder than it is blue", lum(slate) < 125 && slate[2] >= slate[0], slate.join(","));
  }

  const up = slotOf(C.CAP_ROUND, false);
  const down = slotOf(C.CAP_ROUND, true);
  const centre = lum(texel(data, up, 0.5, 0.5));
  // The light is upper left: the glint sits there, the far rim is in shade.
  let brightest = 0;
  for (let fy = 0.15; fy <= 0.5; fy += 0.02) for (let fx = 0.15; fx <= 0.5; fx += 0.02) {
    brightest = Math.max(brightest, lum(texel(data, up, fx, fy)));
  }
  check("a glint in the upper left outshines the middle", brightest > centre + 40, brightest.toFixed(0) + " vs " + centre.toFixed(0));
  const rimFar = lum(texel(data, up, 0.5 + 0.30, 0.5 + 0.30));
  const rimNear = lum(texel(data, up, 0.5 - 0.30, 0.5 - 0.30));
  check("the rim away from the light is darker than the middle", rimFar < centre - 15, rimFar.toFixed(0) + " vs " + centre.toFixed(0));
  check("and darker than the rim toward it", rimFar < rimNear - 20, rimFar.toFixed(0) + " vs " + rimNear.toFixed(0));
  let soft = 0;
  for (let y = 0; y < up.height; y++) for (let x = 0; x < up.width; x++) {
    const a = data[((up.y + y) * C.ATLAS_WIDTH + up.x + x) * 4 + 3];
    if (a > 0 && a < 255) soft++;
  }
  check("the edge is soft, and only the edge", soft > 40 && soft < up.width * up.height * 0.08, soft);
  const u = meanLum(data, up);
  const d = meanLum(data, down);
  check("pressed, the round cap is darker", d.mean < u.mean - 10, d.mean.toFixed(0) + " vs " + u.mean.toFixed(0));
  check("and a touch smaller", d.solid < u.solid && d.solid > u.solid * 0.8, d.solid + " vs " + u.solid);
  const pu = meanLum(data, slotOf(C.CAP_PILL, false));
  const pd = meanLum(data, slotOf(C.CAP_PILL, true));
  check("pressed, the pill is darker too", pd.mean < pu.mean - 5, pd.mean.toFixed(0) + " vs " + pu.mean.toFixed(0));
  let pillBright = 0;
  const ps = slotOf(C.CAP_PILL, false);
  for (let fy = 0.1; fy <= 0.9; fy += 0.02) for (let fx = 0.1; fx <= 0.9; fx += 0.02) {
    pillBright = Math.max(pillBright, lum(texel(data, ps, fx, fy)));
  }
  check("the pill has a highlight of its own", pillBright > lum(texel(data, ps, 0.5, 0.5)) + 25, pillBright.toFixed(0));
}
console.log("=== the sheet ===");
sheetClaims(sheet);
{
  const flipped = C.rowsBottomFirst(sheet, C.ATLAS_WIDTH, C.ATLAS_HEIGHT);
  let same = flipped.length === sheet.length;
  const last = (C.ATLAS_HEIGHT - 1) * C.ATLAS_WIDTH * 4;
  for (let i = 0; i < C.ATLAS_WIDTH * 4 && same; i++) if (flipped[i] !== sheet[last + i]) same = false;
  check("the sheet is uploaded bottom row first, as a texture wants it", same);
  const back = C.rowsBottomFirst(flipped, C.ATLAS_WIDTH, C.ATLAS_HEIGHT);
  let round = true;
  for (let i = 0; i < sheet.length && round; i += 97) if (back[i] !== sheet[i]) round = false;
  check("and turning it twice changes nothing", round);
}

// ------------------------------------------------------------- the quads
const quads = C.capQuads();
const toUnitsX = (cm) => cm / G.MODEL_SCALE + G.MODEL_LCD_CENTRE[0];
const toUnitsY = (cm) => cm / G.MODEL_SCALE + G.MODEL_VIEW_CENTRE_Y;
function quadClaims(list) {
  check("a cap each for A, B, SELECT and START", list.map((q) => q.button).join(",") === "a,b,select,start", list.map((q) => q.button).join(","));
  check("and none for the cross: the model's own has relief a flat cap would hide",
        !list.some((q) => ["up", "down", "left", "right"].includes(q.button)));
  const chips = L.looseChips();
  const centres = { a: G.MODEL_BUTTON_A, b: G.MODEL_BUTTON_B, select: G.MODEL_SELECT, start: G.MODEL_START };
  const parts = { a: "ButtonA", b: "ButtonB", select: "Select", start: "Start" };
  for (const q of list) {
    const up = C.capRectCm(q, false);
    const chip = chips.find((c) => c.name === q.button);
    check(q.button + ": the cap stays on its chip",
          up.x0 >= chip.x - chip.width / 2 - 1e-9 && up.x1 <= chip.x + chip.width / 2 + 1e-9
          && up.y0 >= chip.y - chip.height / 2 - 1e-9 && up.y1 <= chip.y + chip.height / 2 + 1e-9,
          [toUnitsX(up.x0), toUnitsX(up.x1), toUnitsY(up.y0), toUnitsY(up.y1)].map((v) => v.toFixed(1)).join(" "));
    // Over the whole button: every vertex of the part's TOP is under the cap's quad.
    const pts = partPoints(parts[q.button]);
    const top = topOf(pts);
    const face = q.kind === C.CAP_ROUND ? pts : pts.filter((p) => p[2] > top - 0.5);
    check(q.button + ": the cap covers the button",
          face.every((p) => p[0] >= toUnitsX(up.x0) && p[0] <= toUnitsX(up.x1) && p[1] >= toUnitsY(up.y0) && p[1] <= toUnitsY(up.y1)));
    check(q.button + ": it is centred on the button",
          Math.abs(toUnitsX((up.x0 + up.x1) / 2) - centres[q.button][0]) < 0.3 && Math.abs(toUnitsY((up.y0 + up.y1) / 2) - centres[q.button][1]) < 0.3);
    const label = GL.sheetSlots().find((s) => s.label.text.toLowerCase() === q.button);
    const at = G.modelToCm(label.label.x, label.label.y);
    const size = GL.labelSizeCm(label);
    check(q.button + ": it does not lie over its own print",
          up.y0 >= at[1] + size[1] / 2 || up.x1 <= at[0] - size[0] / 2 || up.x0 >= at[0] + size[0] / 2);
    const topCm = (top - G.MODEL_LCD_CENTRE[2]) * G.MODEL_SCALE;
    check(q.button + ": it lies a hair above the part's top", up.z > topCm && up.z - topCm < 0.12, (up.z - topCm).toFixed(3));
    const down = C.capRectCm(q, true);
    const sink = G.MOVING_PARTS.find((m) => m.node === parts[q.button]).sinkUnits * G.MODEL_SCALE;
    check(q.button + ": pressed, it goes down exactly as far as the part", Math.abs((up.z - down.z) - sink) < 1e-9, (up.z - down.z).toFixed(4));
    check(q.button + ": and no further sideways", down.x0 === up.x0 && down.x1 === up.x1 && down.y0 === up.y0 && down.y1 === up.y1);
  }
  // The shape drawn in the slot is the size of the quad it is stretched over.
  const a = list.find((q) => q.button === "a");
  const s = list.find((q) => q.button === "select");
  const ra = C.capRectCm(a, false);
  const rs = C.capRectCm(s, false);
  const round = slotOf(C.CAP_ROUND, false);
  const pill = slotOf(C.CAP_PILL, false);
  check("the round slot is square, as its quad is",
        round.width === round.height && Math.abs((ra.x1 - ra.x0) - (ra.y1 - ra.y0)) < 1e-9);
  check("the pill's slot has its quad's proportions, so nothing is stretched",
        Math.abs(pill.width / pill.height - (rs.x1 - rs.x0) / (rs.y1 - rs.y0)) < 0.03,
        (pill.width / pill.height).toFixed(3) + " vs " + ((rs.x1 - rs.x0) / (rs.y1 - rs.y0)).toFixed(3));
}
console.log("=== the quads ===");
quadClaims(quads);

console.log("=== the mesh ===");
{
  const none = C.capVertices({});
  check("four quads of four vertices, a position and a uv each", none.length === 4 * 4 * 5);
  let inUnit = true;
  for (let i = 0; i < none.length; i += 5) {
    if (none[i + 3] < 0 || none[i + 3] > 1 || none[i + 4] < 0 || none[i + 4] > 1) inUnit = false;
  }
  check("every uv is on the sheet", inUnit);
  const held = C.capVertices({ a: true });
  let changed = 0;
  let outside = 0;
  for (let i = 0; i < none.length; i++) {
    if (none[i] !== held[i]) {
      changed++;
      if (i >= 20) outside++;
    }
  }
  check("holding A rewrites A's quad", changed > 0);
  check("and nobody else's", outside === 0, outside);
  // The up state reads the UP slot: v runs up the sheet, the slot's top row is its larger v.
  const up = slotOf(C.CAP_ROUND, false);
  const uv = C.capUv(up);
  check("a slot's uv is its place on the sheet, bottom row first",
        Math.abs(uv[0] - up.x / C.ATLAS_WIDTH) < 1e-9 && Math.abs(uv[2] - (up.x + up.width) / C.ATLAS_WIDTH) < 1e-9
        && Math.abs(uv[3] - (1 - up.y / C.ATLAS_HEIGHT)) < 1e-9 && Math.abs(uv[1] - (1 - (up.y + up.height) / C.ATLAS_HEIGHT)) < 1e-9);
  check("the indices name two triangles a quad", C.capIndices().length === 4 * 6 && Math.max(...C.capIndices()) === 15);
}

if (SELFTEST) {
  console.log("=== selftest ===");
  expectFailures("a sheet with no clear corners", () => {
    const solid = new Uint8Array(sheet);
    for (let i = 3; i < solid.length; i += 4) solid[i] = 255;
    sheetClaims(solid);
  });
  expectFailures("a cap that has slid off its button", () => {
    quadClaims(quads.map((q) => (q.button === "a" ? { ...q, x: q.x + 6 } : q)));
  });
}

console.log("");
console.log("BUTTONCAPS  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
