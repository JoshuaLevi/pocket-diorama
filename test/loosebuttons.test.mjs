// The loose buttons: the Game Boy's own A, B, D-pad, SELECT and START with
// no Game Boy round them, hanging below the wearer's line of sight.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/loosebuttons.test.mjs [--selftest]
//
// Joshua's decision of 30 September: no plate. A wearer with nothing but
// hands walks by pinching and presses A by pinching off the world, and could
// reach neither START nor B nor a menu's next row without first finding a
// row on a settings page. The buttons are there by default, they are the
// model's own parts, and they go away when a phone or a pad can press them.
//
// What is claimed here is what can be claimed without a scene: where the
// group's middle is, how big it is in the hand, where it rides, and when it
// is shown. The scene half is LooseButtons' class and is seen on the glasses.

globalThis.print = () => {};
const SELFTEST = process.argv.includes("--selftest");

const L = await import("../Assets/Scripts/play/screen/LooseButtons.ts");
const G = await import("../Assets/Scripts/play/screen/GameBoyShell.ts");
const V = await import("../Assets/Scripts/play/screen/ViewOptions.ts");

let pass = 0;
let fail = 0;
let expecting = false;
let caught = 0;
function check(name, ok, detail) {
  if (expecting) {
    if (!ok) caught++;
    return;
  }
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log("  FAIL  " + name + (detail !== undefined ? "  (" + detail + ")" : ""));
  }
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
    console.log("  FAIL  selftest: nothing noticed " + name);
  }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log("=== the group ===");
{
  const boxes = G.buttonBoxes();
  const b = L.looseButtonsBounds();
  check("all eight buttons are in it", boxes.length === 8);
  let inside = true;
  for (const box of boxes) {
    if (box.x - box.width / 2 < b.minX - 1e-9 || box.x + box.width / 2 > b.maxX + 1e-9 ||
        box.y - box.height / 2 < b.minY - 1e-9 || box.y + box.height / 2 > b.maxY + 1e-9) inside = false;
  }
  check("the bounds hold every button", inside);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  check("the group is a hand's width across, not a slab", w > 15 && w < 23, w.toFixed(1));
  check("and lower than it is wide", h > 6 && h < 12, h.toFixed(1));
  const c = L.looseButtonsCentreCm();
  check("the middle is the middle of the bounds",
        near(c[0], (b.minX + b.maxX) / 2) && near(c[1], (b.minY + b.maxY) / 2));
  check("the D-pad is left of it and A is right of it",
        boxes.find((x) => x.name === "left").x < c[0] && boxes.find((x) => x.name === "a").x > c[0]);
  check("the middle is below the Game Boy's view centre, where the buttons are", c[1] < 0, c[1].toFixed(2));
}

console.log("=== the chip under each button ===");
{
  // The glasses draw with light: black is see-through. A near-black D-pad
  // and maroon letters hanging in the air would be a ghost of a control, so
  // each button sits on its own chip of the Game Boy's pale shell, and the
  // print is on the chip.
  const chips = L.looseChips();
  const boxes = G.buttonBoxes();
  const names = chips.map((c) => c.name).join(",");
  check("five chips: the cross, A, B, SELECT, START", names === "dpad,a,b,select,start", names);
  const holds = (c, x, y, w, h) =>
    x - w / 2 >= c.x - c.width / 2 - 1e-9 && x + w / 2 <= c.x + c.width / 2 + 1e-9 &&
    y - h / 2 >= c.y - c.height / 2 - 1e-9 && y + h / 2 <= c.y + c.height / 2 + 1e-9;
  const chipOf = (n) => chips.find((c) => c.name === n);
  let under = true;
  for (const b of boxes) {
    const c = chipOf(["up", "down", "left", "right"].includes(b.name) ? "dpad" : b.name);
    if (!holds(c, b.x, b.y, b.width, b.height)) under = false;
  }
  check("every button stands wholly on its chip", under);
  const GL = await import("../Assets/Scripts/play/screen/GameBoyLabels.ts");
  let printed = true;
  for (const slot of GL.sheetSlots()) {
    const at = G.modelToCm(slot.label.x, slot.label.y);
    const size = GL.labelSizeCm(slot);
    if (!holds(chipOf(slot.label.text.toLowerCase()), at[0], at[1], size[0], size[1])) printed = false;
  }
  check("and its letters are on the chip too", printed);
  // ...and not under a rounded corner: a label's own corners are inside the
  // chip's outline, not just inside its rectangle.
  let legible = true;
  for (const slot of GL.sheetSlots()) {
    const c = chipOf(slot.label.text.toLowerCase());
    const at = G.modelToCm(slot.label.x, slot.label.y);
    const size = GL.labelSizeCm(slot);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const px = Math.abs(at[0] + sx * size[0] / 2 - c.x);
      const py = Math.abs(at[1] + sy * size[1] / 2 - c.y);
      const ix = c.width / 2 - c.radius;
      const iy = c.height / 2 - c.radius;
      if (px > ix && py > iy && Math.hypot(px - ix, py - iy) > c.radius + 1e-9) legible = false;
    }
  }
  check("no letter is cut by a rounded corner", legible);
  let apart = true;
  for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
    const a = chips[i];
    const b = chips[j];
    if (Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2) apart = false;
  }
  check("no two chips touch: the buttons are loose, not a plate", apart);
  check("a chip's corner is never rounder than the chip", chips.every((c) => c.radius > 0 && c.radius <= Math.min(c.width, c.height) / 2 + 1e-9));
  const lum = 0.2126 * L.CHIP_RGB[0] + 0.7152 * L.CHIP_RGB[1] + 0.0722 * L.CHIP_RGB[2];
  check("the chip is light enough to be seen on a display that adds light", lum > 170, lum.toFixed(0));

  const mesh = L.roundedRectMesh(chipOf("a"), -0.1, 6);
  check("a chip is one fan: a centre and four rounded corners", mesh.positions.length === (1 + 4 * 7) * 3 && mesh.indices.length === 28 * 3);
  let inBox = true;
  const c = chipOf("a");
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (Math.abs(mesh.positions[i] - c.x) > c.width / 2 + 1e-6 || Math.abs(mesh.positions[i + 1] - c.y) > c.height / 2 + 1e-6 ||
        mesh.positions[i + 2] !== -0.1) inBox = false;
  }
  check("every vertex lies in the chip's rectangle, at its depth", inBox);
  check("every index names a vertex", mesh.indices.every((n) => n >= 0 && n < mesh.positions.length / 3));
}

console.log("=== where they ride ===");
{
  const eye = [0, 150, 0];
  // The world on a table, 60 cm ahead and 45 cm below the eye.
  const table = L.rideAngleDegrees(eye, [0, 105, -60], false);
  const toWorld = Math.atan2(45, 60) * 180 / Math.PI;
  check("they hang a few degrees under the world's centre", near(table, Math.min(L.RIDE_MAX_DEGREES, toWorld + L.RIDE_BELOW_WORLD_DEGREES), 1e-6), table.toFixed(1));
  check("a world at eye level does not lift them into the view", L.rideAngleDegrees(eye, [0, 150, -60], false) === L.RIDE_MIN_DEGREES);
  check("a world at the wearer's feet cannot swing them out of reach", L.rideAngleDegrees(eye, [0, 0, -5], false) === L.RIDE_MAX_DEGREES);
  check("the editor's camera sees less far down", L.rideAngleDegrees(eye, [0, 0, -5], true) === L.RIDE_MAX_EDITOR_DEGREES);
  check("no world yet: as low as they go", L.rideAngleDegrees(eye, null, false) === L.RIDE_MAX_DEGREES);

  const t = L.rideTarget(eye, [0, -1], 30);
  const d = Math.sqrt((t[0] - eye[0]) ** 2 + (t[1] - eye[1]) ** 2 + (t[2] - eye[2]) ** 2);
  check("they are an arm's length away", near(d, L.LOOSE_AHEAD_CM, 1e-6) && L.LOOSE_AHEAD_CM <= 55 && L.LOOSE_AHEAD_CM >= 40, d.toFixed(2));
  check("below the eye line", t[1] < eye[1]);
  check("and ahead along the heading", t[2] < eye[2] && near(t[0], eye[0]));
}

console.log("=== when they are shown ===");
{
  const auto = V.defaultViewSettings();
  const on = { ...auto, buttons: V.BUTTONS_ON };
  const off = { ...auto, buttons: V.BUTTONS_OFF };
  check("hands alone, in the world: shown", L.looseButtonsWanted(auto, false, false));
  check("a phone or a pad connected: gone", !L.looseButtonsWanted(auto, true, false));
  check("the Game Boy itself on screen: gone, it has its own", !L.looseButtonsWanted(auto, false, true));
  check("ON keeps them with a controller", L.looseButtonsWanted(on, true, false));
  check("but not beside the Game Boy's own buttons", !L.looseButtonsWanted(on, true, true));
  check("OFF hides them whatever is connected", !L.looseButtonsWanted(off, false, false));
  check("no settings at all is AUTO", L.looseButtonsWanted(null, false, false) && !L.looseButtonsWanted(null, true, false));
}

if (SELFTEST) {
  console.log("=== selftest ===");
  expectFailures("buttons that stay when a controller is connected", () => {
    check("auto detector", !L.looseButtonsWanted(V.defaultViewSettings(), false, false));
  });
  expectFailures("a group ridden at the eye line", () => {
    check("angle detector", L.rideAngleDegrees([0, 150, 0], [0, 150, -60], false) === 0);
  });
}

console.log("");
console.log("LOOSEBUTTONS  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
