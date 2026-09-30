// Where the dialogue panel hangs, in degrees.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/messagepanel.test.mjs [--selftest]
//
// The panel's placement is a claim about what the wearer can see through a
// 51-degree display, and it was wrong for a whole playtest: the box hung 20
// degrees below the line of sight, which put all of it past the bottom edge.
// "I can almost never read the text" is what that looks like from inside.
// A comment cannot hold that; this can.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

// Enough of the Lens runtime for PanelAnchor to run. Only what it calls: it
// reads a camera's pose, writes a transform, and multiplies a point by a
// matrix. Nothing here models Lens Studio; it models the four calls.
class V3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  distance(o) {
    const dx = this.x - o.x, dy = this.y - o.y, dz = this.z - o.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
globalThis.vec3 = V3;
globalThis.quat = {
  angleAxis: (a, axis) => ({ angle: a, axis: axis, multiply: (o) => o }),
};
/** A rotation that leaves every vector alone. What a plain object carries. */
const IDENTITY = {
  multiplyVec3: (v) => v,
  invert: () => IDENTITY,
};
/**
 * A transform: a world position and a rotation, and nothing else.
 *
 * getWorldTransform() THROWS on purpose. That matrix carries the object's
 * scale, and reaching for it is what pinned a fight's message box fifteen
 * diorama-units from the root and then multiplied that offset by every rescale
 * the fight did -- the menu "verderop" in one fight and gone in the next. The
 * pin is allowed position and rotation; if it ever wants the matrix again,
 * this test fails rather than the glasses.
 */
function fakeObject(x = 0, y = 0, z = 0) {
  const at = { pos: new V3(x, y, z), rot: null, look: null };
  return {
    at,
    getTransform: () => ({
      getWorldPosition: () => at.pos,
      setWorldPosition: (p) => { at.pos = p; },
      getWorldRotation: () => (at.look === null
        ? IDENTITY
        : { multiplyVec3: (v) => v.z !== 0 ? at.look : new V3(0, 1, 0), invert: () => IDENTITY }),
      setWorldRotation: (r) => { at.rot = r; },
      getWorldTransform: () => {
        throw new Error("the pin must not go through the world matrix: it carries the scale");
      },
      getInvertedWorldTransform: () => {
        throw new Error("the pin must not go through the world matrix: it carries the scale");
      },
    }),
  };
}
function fakeCamera(look) {
  const eye = fakeObject(0, 0, 0);
  eye.at.look = look;
  return { getSceneObject: () => eye, eye };
}

const { panelAnglesDegrees, cropAnglesDegrees, DISPLAY_HALF_FOV_DEGREES } =
  await import("../Assets/Scripts/play/screen/MessagePanelView.ts");
const { PanelAnchor } = await import("../Assets/Scripts/play/screen/PanelAnchor.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

/** The three angles a placement is: centre below the axis, half-height, half-width. */
function edges(angles) {
  const [centre, halfH, halfW] = angles;
  return { centre, halfH, halfW, top: centre - halfH, bottom: centre + halfH };
}

/**
 * The one test that matters, written so it can be run against a hypothetical
 * angle as well as the shipped one -- which is what makes the selftest below
 * able to prove it discriminates.
 */
function readable(angles) {
  const e = edges(angles);
  return {
    insideDisplay: e.bottom <= DISPLAY_HALF_FOV_DEGREES - 1,
    belowTheMiddle: e.top > 2,
    widthFits: e.halfW <= 20,
  };
}

console.log("=== the shipped placement ===");
const angles = panelAnglesDegrees();
const e = edges(angles);
const verdict = readable(angles);
console.log("  centre " + e.centre.toFixed(1) + " deg below the sight line, box " +
            (e.halfH * 2).toFixed(1) + " deg tall, " + (e.halfW * 2).toFixed(1) + " deg wide" +
            "  -> spans " + e.top.toFixed(1) + " to " + e.bottom.toFixed(1) + " deg down");

check("the whole box is inside the display, with a degree to spare",
      verdict.insideDisplay,
      "bottom edge " + e.bottom.toFixed(1) + " deg vs half-FOV " + DISPLAY_HALF_FOV_DEGREES);
check("it hangs below the middle of the view rather than over it",
      verdict.belowTheMiddle, "top edge " + e.top.toFixed(1) + " deg");
check("it is not wider than the display", verdict.widthFits,
      "half-width " + e.halfW.toFixed(1) + " deg");
check("one glyph is big enough to read", angles[2] / 10 > 1.0,
      "a glyph is a tenth of the panel's half-width");

console.log("=== and when it grows ===");
// The panel shows a window of tile rows. Two that matter: the YES/NO box's own
// top row down to the bottom of the screen, and the whole 160x144.
const BOX = edges(panelAnglesDegrees());
const grown = [
  ["the yes/no crop, rows 7 to 18", cropAnglesDegrees(7 * 8, 11 * 8)],
  ["the whole screen", cropAnglesDegrees(0, 144)],
];
for (const [what, angles] of grown) {
  const g = edges(angles);
  console.log("  " + what + ": " + g.top.toFixed(1) + " to " + g.bottom.toFixed(1) + " deg down");
  // The invariant the growth is built on: the message box does not move.
  check(what + " keeps the box's bottom edge", Math.abs(g.bottom - BOX.bottom) < 0.01,
        g.bottom.toFixed(2) + " vs " + BOX.bottom.toFixed(2));
  check(what + " grows upward, not down", g.top < BOX.top + 0.01);
  check(what + " still fits the display",
        g.top > -DISPLAY_HALF_FOV_DEGREES + 1 && g.bottom <= DISPLAY_HALF_FOV_DEGREES - 1,
        g.top.toFixed(1) + " .. " + g.bottom.toFixed(1));
}

if (SELFTEST) {
  console.log("=== selftest ===");
  // The angle that shipped through the playtest, and the fault it caused.
  const broken = readable([20, angles[1], angles[2]]);
  check("SELFTEST the old 20-degree drop is caught", !broken.insideDisplay);
  // And an angle that hides the world behind the box is caught the other way.
  const overTheView = readable([0, angles[1], angles[2]]);
  check("SELFTEST a panel over the middle of the view is caught", !overTheView.belowTheMiddle);
  // Growing a panel while leaving its centre where it was is the fault this
  // geometry exists to avoid: the full screen hung at the box's own drop puts
  // half of itself below the display.
  const naive = readable([panelAnglesDegrees()[0], cropAnglesDegrees(0, 144)[1], 12]);
  check("SELFTEST growing about the centre is caught", !naive.insideDisplay);
}

console.log("=== a fight's box is pinned, and everything else follows ===");
{
  // The reference made this change in its own 2.1.2: "NPC dialogue boxes are
  // pinned and no longer head tracked". A box that rides every movement cannot
  // be read while you lean into a fight, and cannot be filmed at all.
  const space = fakeObject(0, 0, 0);
  const camera = fakeCamera(new V3(0, 0, -1));
  const panel = fakeObject(0, 0, 0);
  const anchor = new PanelAnchor(40, 12, 25, 0.2);

  // snapTo, not place: a fresh anchor has not decided where it is yet, and
  // place() would only NOTICE that the panel is off view, not move it.
  anchor.snapTo(panel, camera);
  const settled = new V3(panel.at.pos.x, panel.at.pos.y, panel.at.pos.z);
  check("unpinned, it hangs on the line of sight", anchor.pinned() === false);

  // Pin it where it stands, then turn the head hard right.
  const world = anchor.lineOfSight(camera);
  anchor.pinTo(space, PanelAnchor.offsetFrom(space, world));
  check("...and now it is pinned", anchor.pinned());
  camera.eye.at.look = new V3(1, 0, 0);
  for (let i = 0; i < 30; i++) anchor.place(panel, camera, 1 / 60);
  check("a pinned box does not chase the head",
        panel.at.pos.distance(settled) < 0.5,
        "moved " + panel.at.pos.distance(settled).toFixed(2));

  // ...but it DOES come along when the diorama is dragged, because the offset
  // is from the diorama and not from the room.
  space.at.pos = new V3(100, 0, 0);
  for (let i = 0; i < 60; i++) anchor.place(panel, camera, 1 / 60);
  check("a dragged diorama brings its box with it",
        panel.at.pos.distance(settled) > 50,
        "moved " + panel.at.pos.distance(settled).toFixed(2));
  const dragged = new V3(panel.at.pos.x, panel.at.pos.y, panel.at.pos.z);
  check("...by exactly what the diorama moved",
        Math.abs(dragged.x - (settled.x + 100)) < 1 &&
        Math.abs(dragged.y - settled.y) < 1 &&
        Math.abs(dragged.z - settled.z) < 1,
        "box at " + dragged.x.toFixed(1) + "," + dragged.y.toFixed(1) + "," +
        dragged.z.toFixed(1));

  // And unpinning gives the head back its box.
  space.at.pos = new V3(0, 0, 0);
  anchor.unpin();
  check("unpinned again", anchor.pinned() === false);
  for (let i = 0; i < 120; i++) anchor.place(panel, camera, 1 / 60);
  const ahead = anchor.lineOfSight(camera);
  check("and it comes back to the line of sight",
        panel.at.pos.distance(ahead) < 1,
        "off by " + panel.at.pos.distance(ahead).toFixed(2));
}

console.log("=== pinning is taken once, not every frame ===");
{
  // The whole failure mode of this feature in one line. pinToDiorama is called
  // every frame a fight is framed; if it re-took the point each time, the box
  // would be head-tracked again and every assertion above would still pass.
  const space = fakeObject(0, 0, 0);
  const camera = fakeCamera(new V3(0, 0, -1));
  const anchor = new PanelAnchor(40, 12, 25, 0.2);
  const first = anchor.lineOfSight(camera);
  anchor.pinTo(space, PanelAnchor.offsetFrom(space, first));
  const pinnedAt = anchor.pinned();
  camera.eye.at.look = new V3(1, 0, 0);
  // What MessagePanelView.pinToDiorama does: nothing at all when already pinned.
  if (!anchor.pinned()) {
    anchor.pinTo(space, anchor.lineOfSight(camera));
  }
  const panel = fakeObject(0, 0, 0);
  for (let i = 0; i < 60; i++) anchor.place(panel, camera, 1 / 60);
  check("the guard holds", pinnedAt);
  check("and a turned head has not moved the pin",
        panel.at.pos.distance(first) < 0.5,
        "off by " + panel.at.pos.distance(first).toFixed(2));
}

console.log("\nMESSAGEPANEL  " + pass + " pass, " + fail + " fail\n");
process.exit(fail === 0 ? 0 : 1);
