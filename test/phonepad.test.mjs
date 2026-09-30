// The pad drawn on the phone: the zone rule, and the picture of it.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/phonepad.test.mjs [--selftest]
//
// The buttons cannot be drawn on the Spectacles App's own screen -- the API
// gives touches, a size, a pose and haptics, and no canvas -- so they are drawn
// in the glasses at the phone's position. Which makes the PICTURE and the RULE
// two things that have to agree: a lit zone that is not the zone the source
// reads is worse than no picture at all.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const layout = await import("../Assets/Scripts/play/screen/PhonePadLayout.ts");
const { zoneAt, paintPhonePad, zoneRect, cornerRect, inCorner, DEAD_ZONE,
        ZONE_CENTRE, ZONE_NONE, ZONE_START, ZONE_SELECT,
        CORNER_WIDTH, CORNER_HEIGHT } = layout;
const { GbCanvas, SCREEN_WIDTH, SCREEN_HEIGHT } = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { MotionControllerSource } = await import("../Assets/Scripts/play/MotionControllerSource.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

console.log("=== the rule ===");
check("the middle is the button", zoneAt(0.5, 0.5) === ZONE_CENTRE);
check("just inside the dead zone is still the button",
      zoneAt(0.5 + DEAD_ZONE * 0.9, 0.5) === ZONE_CENTRE);
check("just outside it is a direction",
      zoneAt(0.5 + DEAD_ZONE * 1.1, 0.5) === "right");
check("up is negative y, because y grows downward", zoneAt(0.5, 0.1) === "up");
check("down", zoneAt(0.5, 0.9) === "down");
check("left", zoneAt(0.1, 0.5) === "left");
check("right", zoneAt(0.9, 0.5) === "right");
// The dominant axis, so a thumb along an edge does not flicker between two.
check("a corner belongs to the axis it is furthest along", zoneAt(0.95, 0.6) === "right");
check("and the other way round", zoneAt(0.6, 0.95) === "down");
check("off the pad is nothing", zoneAt(1.4, 0.5) === ZONE_NONE);
check("and so is a negative", zoneAt(0.5, -0.2) === ZONE_NONE);

console.log("=== the corners are buttons, not directions ===");
check("the bottom-left corner is START", zoneAt(0.02, 0.98) === ZONE_START);
check("the bottom-right corner is SELECT", zoneAt(0.98, 0.98) === ZONE_SELECT);
check("just inside the corner is still the button",
      zoneAt(CORNER_WIDTH * 0.9, 1 - CORNER_HEIGHT * 0.9) === ZONE_START);
check("just above it is the direction again",
      zoneAt(0.02, 1 - CORNER_HEIGHT * 1.1) === "left");
check("just inboard of it is too",
      zoneAt(CORNER_WIDTH * 1.1, 0.98) === "down");
// The TOP corners were never claimed: the pad's four wedges still own them, and
// taking them would cost UP two bites for no button anybody asked for.
check("the top-left corner is still a direction", zoneAt(0.02, 0.02) === "left");
check("and the top-right one", zoneAt(0.98, 0.02) === "right");
check("the centre is untouched by all this", zoneAt(0.5, 0.5) === ZONE_CENTRE);

console.log("=== the rule the SOURCE reads is the same one ===");
{
  // Drive the source's own touch handler and compare its D-pad with the zone
  // the picture would light. These two drifting apart is the whole risk.
  const source = new MotionControllerSource();
  const held = (x, y) => {
    source.onTouch({ x: x, y: y }, 1, 0, 0);       // Began
    // The source's OWN answer, not one inferred from the D-pad: a corner holds
    // no direction, so inferring would read every button as the centre.
    const zone = source.activeZone();
    source.onTouch({ x: x, y: y }, 1, 10, 2);      // Ended, so the next one is fresh
    return zone;
  };
  for (const [x, y] of [[0.5, 0.1], [0.5, 0.9], [0.1, 0.5], [0.9, 0.5], [0.5, 0.5],
                        [0.95, 0.6], [0.6, 0.95], [0.2, 0.7],
                        [0.02, 0.98], [0.98, 0.98], [0.5, 0.98]]) {
    check("source and picture agree at " + x + "," + y, held(x, y) === zoneAt(x, y),
          held(x, y) + " vs " + zoneAt(x, y));
  }
  // A corner holds no direction at all, which is the whole point of it: a thumb
  // resting on START must not walk the character into a wall.
  for (const [x, y] of [[0.02, 0.98], [0.98, 0.98], [0.2, 0.9]]) {
    const pad = (() => {
      const s2 = new MotionControllerSource();
      s2.onTouch({ x: x, y: y }, 1, 0, 0);
      return s2.dpad();
    })();
    check("no direction is held on the corner at " + x + "," + y,
          !pad.up && !pad.down && !pad.left && !pad.right);
  }
}

console.log("=== the corner buttons are drawn where they are read ===");
{
  const canvas = new GbCanvas();
  const drawn = [];
  const font = { text: (c, t, x, y) => drawn.push([t, x, y]), box: () => {}, code: () => {} };
  paintPhonePad(canvas, font, ZONE_NONE);

  for (const zone of [ZONE_START, ZONE_SELECT]) {
    const [rx, ry, rw, rh] = cornerRect(zone, SCREEN_WIDTH, SCREEN_HEIGHT);
    // Every pixel of the drawn rectangle has to be read as that button, and the
    // rectangle has to be where the rule says. Sampling the four corners of it
    // catches an off-by-one in either direction.
    for (const [px, py] of [[rx + 1, ry + 1], [rx + rw - 2, ry + 1],
                            [rx + 1, ry + rh - 2], [rx + rw - 2, ry + rh - 2]]) {
      check(zone + " is read at drawn pixel " + px + "," + py,
            zoneAt((px + 0.5) / SCREEN_WIDTH, (py + 0.5) / SCREEN_HEIGHT) === zone);
    }
    check(zone + " sits on the bottom edge", ry + rh === SCREEN_HEIGHT);
  }

  const labels = drawn.map((d) => d[0]);
  check("START is labelled", labels.indexOf("START") >= 0, labels.join(","));
  check("SELECT is labelled", labels.indexOf("SELECT") >= 0, labels.join(","));
  check("the unguessable two-finger hint is gone",
        labels.every((t) => t.indexOf("FINGERS") < 0), labels.join(","));
  for (const [text, x, y] of drawn) {
    if (text !== "START" && text !== "SELECT") continue;
    const zone = text === "START" ? ZONE_START : ZONE_SELECT;
    const [rx, ry, rw, rh] = cornerRect(zone, SCREEN_WIDTH, SCREEN_HEIGHT);
    check(text + "'s label fits its button",
          x >= rx && x + text.length * 8 <= rx + rw && y >= ry && y + 8 <= ry + rh,
          [x, y, rx, ry, rw, rh].join(" "));
  }

  // A pressed corner has to LOOK pressed, or the buzz is the only feedback.
  const idle = canvas.pixels.slice();
  for (const zone of [ZONE_START, ZONE_SELECT]) {
    paintPhonePad(canvas, font, zone);
    let changed = 0;
    let outside = 0;
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const i = y * SCREEN_WIDTH + x;
        if (canvas.pixels[i] === idle[i]) continue;
        changed++;
        if (zoneAt((x + 0.5) / SCREEN_WIDTH, (y + 0.5) / SCREEN_HEIGHT) !== zone) outside++;
      }
    }
    check(zone + " lights up when pressed", changed > 100, changed);
    check(zone + " lights nothing outside itself", outside === 0, outside);
  }
}

console.log("=== the picture ===");
{
  const canvas = new GbCanvas();
  const font = { text: () => {}, box: () => {}, code: () => {} };
  paintPhonePad(canvas, font, ZONE_NONE);
  const idle = canvas.pixels.slice();
  check("the pad has a border", canvas.pixels[0] === 3);
  check("the centre button is drawn",
        canvas.pixels[Math.floor(SCREEN_HEIGHT / 2) * SCREEN_WIDTH + Math.floor(SCREEN_WIDTH / 2)] > 0);

  for (const zone of ["up", "down", "left", "right", ZONE_CENTRE]) {
    paintPhonePad(canvas, font, zone);
    let changed = 0;
    let litInsideZone = 0;
    let litOutside = 0;
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const i = y * SCREEN_WIDTH + x;
        if (canvas.pixels[i] === idle[i]) continue;
        changed++;
        // Which zone does the lit pixel actually belong to, by the rule?
        const at = zoneAt((x + 0.5) / SCREEN_WIDTH, (y + 0.5) / SCREEN_HEIGHT);
        if (at === zone) litInsideZone++;
        else litOutside++;
      }
    }
    check(zone + " lights something up", changed > 200, changed);
    // The picture is allowed to be coarse at the seams -- it is 160x144 pixels
    // stretched over a phone -- but the great majority of what lights up has to
    // be the zone that is actually being pressed.
    check(zone + " lights the zone it names", litInsideZone > litOutside * 8,
          litInsideZone + " in, " + litOutside + " out");
  }
}

console.log("=== the wedges cover the pad ===");
{
  // Every point outside the centre belongs to exactly one direction, so the
  // four rectangles the labels sit in have to overlap the whole surface.
  let uncovered = 0;
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const zone = zoneAt((x + 0.5) / 20, (y + 0.5) / 20);
      if (zone === ZONE_NONE) uncovered++;
    }
  }
  check("no point on the pad is unassigned", uncovered === 0, uncovered);
  const up = zoneRect("up", 100, 100);
  const down = zoneRect("down", 100, 100);
  check("up is the top half and down the bottom",
        up[1] === 0 && down[1] === 50, JSON.stringify([up, down]));
}

if (SELFTEST) {
  console.log("=== selftest ===");
  // A picture that lights the wrong zone is what this file exists to catch, so
  // prove the check can see it: light "up" and score it against "down".
  const canvas = new GbCanvas();
  const font = { text: () => {}, box: () => {}, code: () => {} };
  paintPhonePad(canvas, font, ZONE_NONE);
  const idle = canvas.pixels.slice();
  paintPhonePad(canvas, font, "up");
  let asDown = 0;
  let asUp = 0;
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const i = y * SCREEN_WIDTH + x;
      if (canvas.pixels[i] === idle[i]) continue;
      const at = zoneAt((x + 0.5) / SCREEN_WIDTH, (y + 0.5) / SCREEN_HEIGHT);
      if (at === "down") asDown++;
      if (at === "up") asUp++;
    }
  }
  check("SELFTEST scoring the wrong zone fails the same check",
        !(asDown > asUp * 8), asDown + " vs " + asUp);
  check("SELFTEST and the right one passes it", asUp > asDown * 8);
}

console.log("\nPHONEPAD  " + pass + " pass, " + fail + " fail\n");
process.exit(fail === 0 ? 0 : 1);
