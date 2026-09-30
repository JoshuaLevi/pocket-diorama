// The Game Boy that carries the screen: its numbers and its entrance.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/gameboyshell.test.mjs [--selftest]
//
// Three claims:
//   1. The scale puts the model's LCD at LCD_WIDTH_CM, and at SHELL_AHEAD_CM
//      the span that must be seen -- the LCD's top to the D-pad's bottom --
//      fits the glasses' display, with a glyph still legible.
//   2. The entrance starts below, behind and tilted, overshoots a little,
//      and is exactly at rest when it is over -- a shell that settles a
//      millimetre off would drift the LCD out of the anchor's line.
//   3. The LCD does not light before the shell has arrived.
//   4. The eight buttons are laid where the model's are: all under the LCD,
//      A above and right of B, the D-pad a cross on the left, none touching,
//      and each big enough for a fingertip.

globalThis.print = () => {};

const SELFTEST = process.argv.includes("--selftest");

const {
  entrance, poweredOn,
  MODEL_LCD_WIDTH, MODEL_BODY_WIDTH, MODEL_BODY_HEIGHT, MODEL_SCALE, LCD_WIDTH_CM,
  ENTRANCE_SECONDS, ENTRANCE_DROP_CM, ENTRANCE_BACK_CM, ENTRANCE_TILT_DEGREES, POWER_ON_DELAY_SECONDS,
  buttonBoxes, MODEL_DPAD_CENTRE, MODEL_DPAD_SPAN, MODEL_LCD_CENTRE, HIT_DEPTH_CM,
  SHELL_AHEAD_CM, LCD_RISE_CM, MODEL_LCD_HEIGHT, MODEL_VIEW_CENTRE_Y, lcdBox,
} = await import("../Assets/Scripts/play/screen/GameBoyShell.ts");
const { ALL_BUTTONS } = await import("../Assets/Scripts/play/PadPanel.ts");
const { rayHitsBox, fingerHolds, FINGER_PRESS_CM, FINGER_RELEASE_CM, FINGER_SIDE_SLACK_CM } =
  await import("../Assets/Scripts/play/Pressable.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

console.log("=== the size ===");
{
  check("the LCD is LCD_WIDTH_CM across", Math.abs(MODEL_LCD_WIDTH * MODEL_SCALE - LCD_WIDTH_CM) < 1e-9);
  const bodyW = MODEL_BODY_WIDTH * MODEL_SCALE;
  const bodyH = MODEL_BODY_HEIGHT * MODEL_SCALE;
  check("the body is a Game Boy's proportion", Math.abs(bodyH / bodyW - 1.66) < 0.06, (bodyH / bodyW).toFixed(2));
  // The glasses' display: 46 degrees across the diagonal, about 37 wide and
  // 28 tall. The body's width must sit inside it with room either side.
  const HALF_WIDE_DEGREES = 18.4;
  const HALF_TALL_DEGREES = 13.8;
  const halfWide = SHELL_AHEAD_CM * Math.tan(HALF_WIDE_DEGREES * Math.PI / 180);
  const halfTall = SHELL_AHEAD_CM * Math.tan(HALF_TALL_DEGREES * Math.PI / 180);
  check("the body fits the display's width", bodyW / 2 < halfWide * 0.85, (bodyW / 2).toFixed(1) + " of " + halfWide.toFixed(1));
  // A TinyFont glyph on the LCD: 5 of 160 px of LCD_WIDTH_CM at SHELL_AHEAD_CM.
  // The cartridge's own glyph is 8 px of a 47 mm LCD at 35 cm: 0.38 degrees.
  const glyphDegrees = Math.atan2((5 / 160) * LCD_WIDTH_CM, SHELL_AHEAD_CM) * 180 / Math.PI;
  check("a glyph is still legible", glyphDegrees > 0.45, glyphDegrees.toFixed(2));
  // The anchor holds the shell by the middle of the LCD-top-to-D-pad span, so
  // the top of the pages and every button are in the display at once.
  const lcdTop = LCD_RISE_CM + MODEL_LCD_HEIGHT * MODEL_SCALE / 2;
  const dpadBottom = (MODEL_DPAD_CENTRE[1] - MODEL_DPAD_SPAN / 2 - MODEL_VIEW_CENTRE_Y) * MODEL_SCALE;
  check("the LCD is above the line of sight and the D-pad below it", LCD_RISE_CM > 0 && dpadBottom < 0);
  check("the span is hung by its middle", Math.abs(lcdTop + dpadBottom) < 1e-9, lcdTop.toFixed(2) + " " + dpadBottom.toFixed(2));
  check("the LCD's top edge is inside the display", lcdTop < halfTall, lcdTop.toFixed(1) + " of " + halfTall.toFixed(1));
  check("the D-pad's bottom is inside the display", -dpadBottom < halfTall, (-dpadBottom).toFixed(1) + " of " + halfTall.toFixed(1));
}

console.log("=== the entrance ===");
{
  const start = entrance(0);
  check("starts below rest", Math.abs(start.dropCm - ENTRANCE_DROP_CM) < 1e-9, start.dropCm);
  check("starts behind rest", Math.abs(start.backCm - ENTRANCE_BACK_CM) < 1e-9);
  check("starts tilted back", Math.abs(start.tiltDegrees - ENTRANCE_TILT_DEGREES) < 1e-9);
  check("the LED is off at the start", start.led === 0);
  const end = entrance(ENTRANCE_SECONDS);
  check("at rest exactly when it is over", Math.abs(end.dropCm) < 1e-9 && Math.abs(end.backCm) < 1e-9 && Math.abs(end.tiltDegrees) < 1e-9,
        end.dropCm + "," + end.backCm + "," + end.tiltDegrees);
  let overshoot = false;
  let lastDrop = Infinity;
  let monotoneUntilOvershoot = true;
  for (let t = 0; t <= ENTRANCE_SECONDS; t += 1 / 120) {
    const e = entrance(t);
    if (e.dropCm < -1e-6) overshoot = true;
    if (!overshoot && e.dropCm > lastDrop + 1e-9) monotoneUntilOvershoot = false;
    lastDrop = e.dropCm;
  }
  check("it overshoots a little", overshoot);
  check("and never sinks back before the overshoot", monotoneUntilOvershoot);
  const later = entrance(ENTRANCE_SECONDS + 5);
  check("it stays at rest afterwards", later.dropCm === 0 && later.led === 1);
}

console.log("=== the power ===");
{
  check("dark while arriving", !poweredOn(ENTRANCE_SECONDS * 0.5));
  check("dark for the pause after", !poweredOn(ENTRANCE_SECONDS + POWER_ON_DELAY_SECONDS * 0.5));
  check("on after the pause", poweredOn(ENTRANCE_SECONDS + POWER_ON_DELAY_SECONDS));
  check("the whole arrival is under two seconds", ENTRANCE_SECONDS + POWER_ON_DELAY_SECONDS < 2);
}

console.log("=== the buttons ===");
{
  const boxes = buttonBoxes();
  const byName = {};
  for (const b of boxes) byName[b.name] = b;
  check("eight buttons", boxes.length === 8);
  check("one of each pad button", ALL_BUTTONS.every((n) => byName[n] !== undefined && boxes.filter((b) => b.name === n).length === 1));
  const lcdBottom = LCD_RISE_CM - (LCD_WIDTH_CM * 144 / 160) / 2;
  check("every button is under the LCD", boxes.every((b) => b.y + b.height / 2 < lcdBottom), boxes.map((b) => b.name + ":" + b.y.toFixed(1)).join(" "));
  const halfBody = MODEL_BODY_WIDTH * MODEL_SCALE / 2;
  check("every button is within the body", boxes.every((b) => Math.abs(b.x) + b.width / 2 < halfBody + Math.abs(MODEL_LCD_CENTRE[0] * MODEL_SCALE)));
  check("A is above and right of B", byName.a.x > byName.b.x && byName.a.y > byName.b.y);
  check("A and B are on the right, the D-pad on the left", byName.a.x > 0 && byName.b.x > 0 && byName.up.x < 0 && byName.left.x < 0);
  check("the D-pad's arms are a cross about its hub",
        Math.abs(byName.up.x - byName.down.x) < 1e-9 && Math.abs(byName.left.y - byName.right.y) < 1e-9 &&
        Math.abs((byName.up.y + byName.down.y) / 2 - byName.left.y) < 1e-9 &&
        Math.abs((byName.left.x + byName.right.x) / 2 - byName.up.x) < 1e-9);
  const span = (byName.up.y + byName.up.height / 2) - (byName.down.y - byName.down.height / 2);
  check("the cross spans the model's D-pad", Math.abs(span - MODEL_DPAD_SPAN * MODEL_SCALE) < 0.5, span.toFixed(2));
  check("SELECT is left of START, both under the D-pad and A", byName.select.x < byName.start.x && byName.select.y < byName.down.y && byName.start.y < byName.b.y);
  // A fingertip is about 1.5 cm across; the smallest side of any volume must take one.
  check("every button takes a fingertip", boxes.every((b) => Math.min(b.width, b.height) >= 1.5), boxes.map((b) => b.name + ":" + Math.min(b.width, b.height).toFixed(1)).join(" "));
  check("every volume is as deep as a press", boxes.every((b) => b.depth === HIT_DEPTH_CM));
  let overlaps = "";
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const apart = Math.abs(a.x - b.x) >= (a.width + b.width) / 2 - 1e-9 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2 - 1e-9;
      if (!apart) overlaps += a.name + "/" + b.name + " ";
    }
  }
  check("no two volumes overlap", overlaps === "", overlaps);
  check("the volumes stand proud of the face", boxes.every((b) => b.z + b.depth / 2 > 1 && b.z - b.depth / 2 < 0.5));
}

console.log("=== the LCD as the editor's A ===");
{
  const lcd = lcdBox();
  check("the LCD box is A, tagged lcd", lcd.name === "a" && lcd.tag === "lcd");
  check("it covers the LCD exactly", Math.abs(lcd.width - LCD_WIDTH_CM) < 1e-9 && Math.abs(lcd.height - LCD_WIDTH_CM * 0.9) < 1e-9);
  check("it sits where the LCD is", Math.abs(lcd.y - LCD_RISE_CM) < 1e-9 && lcd.x === 0);
  check("it stands just in front of the glass", lcd.z > 0 && lcd.z < 1);
  const boxes = buttonBoxes();
  check("it clears every button", boxes.every((b) => lcd.y - lcd.height / 2 > b.y + b.height / 2));
}

console.log("=== a ray and a box ===");
{
  const half = [2, 1.5, 1];
  check("straight in from the front", Math.abs(rayHitsBox([0, 0, 10], [0, 0, -1], half) - 9) < 1e-9);
  check("a miss beside it", rayHitsBox([5, 0, 10], [0, 0, -1], half) === -1);
  check("a miss above it", rayHitsBox([0, 3, 10], [0, 0, -1], half) === -1);
  check("pointing away is a miss", rayHitsBox([0, 0, 10], [0, 0, 1], half) === -1);
  check("at an angle it still meets the face", rayHitsBox([1, 1, 10], [-0.05, -0.05, -1], half) > 0);
  check("from inside it counts as here", rayHitsBox([0, 0, 0], [0, 0, -1], half) === 0);
  const t = rayHitsBox([0, 0, 10], [0, 0, -2], half);
  check("the distance is in the ray's own units", Math.abs(t - 4.5) < 1e-9, t);
}

console.log("=== a fingertip and a button ===");
{
  // On the glasses of 30 September the buttons could only be PINCHED: SIK's
  // ray pressed them and a finger pushed against one did nothing. A button
  // is a thing you press, so the fingertip presses it: near the face and
  // over the button goes down, and it lets go a little further out than it
  // went down, or a hand that trembles at the threshold would stutter.
  // The box is about its own centre; +z is toward the wearer.
  const half = [1.5, 1.5, 1.25];
  check("a tip well in front of the button is not a press", !fingerHolds([0, 0, 1.2], half, false));
  check("a tip that reaches the face presses it", fingerHolds([0, 0, FINGER_PRESS_CM - 0.01], half, false));
  check("a tip pushed right into the body still presses", fingerHolds([0.3, -0.2, -2.0], half, false));
  check("a tip far behind the Game Boy is somebody's hand, not a press", !fingerHolds([0, 0, -6], half, false));
  check("a tip beside the button does not press it", !fingerHolds([half[0] + 0.1, 0, 0], half, false));
  check("pulling back a little does not let go", fingerHolds([0, 0, (FINGER_PRESS_CM + FINGER_RELEASE_CM) / 2], half, true));
  check("...but that same height does not press a button that is up",
        !fingerHolds([0, 0, (FINGER_PRESS_CM + FINGER_RELEASE_CM) / 2], half, false));
  check("pulling back past the release height lets go", !fingerHolds([0, 0, FINGER_RELEASE_CM + 0.01], half, true));
  check("a held button forgives a little sideways drift", fingerHolds([half[0] + FINGER_SIDE_SLACK_CM - 0.01, 0, 0], half, true));
  check("...and no more than a little", !fingerHolds([half[0] + FINGER_SIDE_SLACK_CM + 0.01, 0, 0], half, true));
  check("the release height is above the press height", FINGER_RELEASE_CM > FINGER_PRESS_CM + 0.3);

  // No fingertip can be in two buttons at once: the volumes do not overlap,
  // so one finger on the cross is one direction.
  const boxes = buttonBoxes();
  let single = true;
  for (const b of boxes) {
    const at = [b.x, b.y, b.z];
    let inside = 0;
    for (const o of boxes) {
      if (fingerHolds([at[0] - o.x, at[1] - o.y, at[2] - o.z - 1], [o.width / 2, o.height / 2, o.depth / 2], false)) inside++;
    }
    if (inside !== 1) single = false;
  }
  check("a fingertip pressed into one button's middle presses that one and no other", single);
}

if (SELFTEST) {
  // The rest claim is only worth something if a curve that ends off by a
  // millimetre would fail it.
  const e = entrance(ENTRANCE_SECONDS - 0.01);
  check("SELFTEST a frame before the end is not yet exactly at rest", Math.abs(e.dropCm) > 1e-6 || Math.abs(e.tiltDegrees) > 1e-6);
  // The overlap claim must be able to fail: two of A's volumes on top of each other.
  const a = buttonBoxes().find((b) => b.name === "a");
  const twin = { ...a, x: a.x + a.width * 0.5 };
  const apart = Math.abs(a.x - twin.x) >= (a.width + twin.width) / 2 - 1e-9 || Math.abs(a.y - twin.y) >= (a.height + twin.height) / 2 - 1e-9;
  check("SELFTEST the overlap test sees a half-overlapping twin", !apart);
}

console.log("\nGAMEBOYSHELL  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
if (fail > 0) {
  process.exit(1);
}
