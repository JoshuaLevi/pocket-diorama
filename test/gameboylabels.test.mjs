// The print on the Game Boy's face: where A, B, SELECT and START are written.
//
//   node --experimental-strip-types --import ./test/register.mjs test/gameboylabels.test.mjs
//
// Claims: four labels, each under its own button and nearer to it than to any
// other, clear of every button volume, inside the body, on the face; the
// sheet's slots inside the canvas and apart; the inks the DMG's two.

globalThis.print = () => {};

const {
  faceLabels, sheetSlots, labelSizeCm, FACE_Z, PRINT_LIFT, SHADE_LETTER, SHADE_WORD, INK,
} = await import("../Assets/Scripts/play/screen/GameBoyLabels.ts");
const {
  buttonBoxes, modelToCm, MODEL_SCALE, MODEL_LCD_CENTRE, MODEL_BODY_WIDTH, MODEL_BODY_HEIGHT,
  MODEL_BUTTON_A, MODEL_BUTTON_B, MODEL_SELECT, MODEL_START, MODEL_FACE_Z,
} = await import("../Assets/Scripts/play/screen/GameBoyShell.ts");
const { SCREEN_WIDTH, SCREEN_HEIGHT } = await import("../Assets/Scripts/play/screen/GbCanvas.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

console.log("=== the labels ===");
const labels = faceLabels();
const slots = sheetSlots();
const byText = {};
for (const l of labels) byText[l.text] = l;
check("four labels", labels.length === 4 && ["A", "B", "SELECT", "START"].every((t) => byText[t]));
const own = { A: MODEL_BUTTON_A, B: MODEL_BUTTON_B, SELECT: MODEL_SELECT, START: MODEL_START };
for (const text of Object.keys(own)) {
  const l = byText[text];
  const d = (c) => Math.hypot(l.x - c[0], l.y - c[1]);
  check(text + " is below its button", l.y < own[text][1] && Math.abs(l.x - own[text][0]) < 1);
  check(text + " is nearer its own button than any other",
        Object.keys(own).every((o) => o === text || d(own[o]) > d(own[text]) + 5));
}
check("letters are maroon, words slate", byText.A.shade === SHADE_LETTER && byText.SELECT.shade === SHADE_WORD && INK[SHADE_LETTER][0] > INK[SHADE_WORD][0]);
check("the print floats just off the face", labels.every((l) => l.z > FACE_Z && l.z - FACE_Z <= 1) && PRINT_LIFT < 1);
check("and the face is where the shell measured it", Math.abs(FACE_Z - MODEL_FACE_Z) < 6, FACE_Z + " vs " + MODEL_FACE_Z);
const halfBody = MODEL_BODY_WIDTH / 2;
check("every label is inside the body", labels.every((l) => Math.abs(l.x) < halfBody - 10 && l.y > -MODEL_BODY_HEIGHT / 2 + 10));

console.log("=== against the buttons ===");
{
  const boxes = buttonBoxes();
  let touching = "";
  for (const slot of slots) {
    const c = modelToCm(slot.label.x, slot.label.y);
    const size = labelSizeCm(slot);
    for (const b of boxes) {
      const apart = Math.abs(c[0] - b.x) >= (size[0] + b.width) / 2 || Math.abs(c[1] - b.y) >= (size[1] + b.height) / 2;
      if (!apart) touching += slot.label.text + "/" + b.name + " ";
    }
  }
  check("no label lies over a button volume", touching === "", touching);
  const sel = slots.find((s) => s.label.text === "SELECT");
  const sta = slots.find((s) => s.label.text === "START");
  const gap = (modelToCm(sta.label.x, 0)[0] - modelToCm(sel.label.x, 0)[0]) - (labelSizeCm(sel)[0] + labelSizeCm(sta)[0]) / 2;
  check("SELECT and START do not run into each other", gap > 0.2, gap.toFixed(2));
  // A letter should be readable at arm's length: at least a centimetre tall.
  const a = slots.find((s) => s.label.text === "A");
  check("the letters are a centimetre tall", labelSizeCm(a)[1] >= 1.0, labelSizeCm(a)[1].toFixed(2));
  check("the words are smaller than the letters", labelSizeCm(sel)[1] < labelSizeCm(a)[1]);
}

console.log("=== the sheet ===");
{
  check("every slot is inside the canvas", slots.every((s) => s.x >= 0 && s.y >= 0 && s.x + s.width <= SCREEN_WIDTH && s.y + s.height <= SCREEN_HEIGHT));
  let overlap = false;
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i], b = slots[j];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) overlap = true;
    }
  }
  check("no two slots overlap", !overlap);
  check("a slot is as wide as its ink", slots.every((s) => s.width === (s.label.text.length * 6 - 1)));
}

console.log("\nGAMEBOYLABELS  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
if (fail > 0) {
  process.exit(1);
}
