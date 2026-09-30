// The hand gestures that move and resize the diorama, without a hand.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/dioramahands.test.mjs [--selftest]
//
// The two-handed scale replaced a pinch-and-hold that grew the world at a fixed
// rate and flipped direction on release. A playtest on the glasses (7 September)
// could not work it: holding still inside four centimetres is a skill and which
// way the next hold would go was invisible. So the claims worth testing are the
// ones that gesture failed -- that the world tracks the hands, that letting go
// leaves it where it is, and that putting the hands back puts the world back.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};
globalThis.vec3 = class {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  distance(o) {
    const dx = this.x - o.x, dy = this.y - o.y, dz = this.z - o.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
};

const { DioramaHands } = await import("../Assets/Scripts/play/DioramaHands.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}
function near(a, b, tolerance) {
  return Math.abs(a - b) <= (tolerance === undefined ? 1e-6 : tolerance);
}

/** A hand that pinches where it is told, or is not there at all. */
function fakeHand() {
  return {
    tracked: true,
    pinching: false,
    indexTip: { position: new vec3(0, 0, 0) },
    isTracked() { return this.tracked; },
    isPinching() { return this.pinching; },
    at(x, y, z) { this.indexTip = { position: new vec3(x, y, z) }; return this; },
  };
}

function rig() {
  const left = fakeHand();
  const right = fakeHand();
  const hands = new DioramaHands();
  const bound = hands.bind(() => ({
    getHand: (which) => (which === "left" ? left : right),
  }));
  const seen = { scale: 1, moves: [], pivots: [], turn: 0, turns: [], hovers: [] };
  const callbacks = {
    onDiveScale: (pivot, factor) => { seen.scale *= factor; seen.pivots.push(pivot); },
    onMove: (delta) => { seen.moves.push(delta); },
    onTwist: (radians) => { seen.turn += radians; seen.turns.push(radians); },
    onHoverRim: (over) => { seen.hovers.push(over); },
  };
  const step = (dt) => hands.update(dt === undefined ? 1 / 60 : dt, callbacks);
  return { hands, left, right, seen, step, bound, callbacks };
}

const { onRim, overPlate, RIM_BAND, twistYaw, twistBearing, wrapRadians } =
  await import("../Assets/Scripts/play/DioramaGrab.ts");

const DEG = Math.PI / 180;

/**
 * Two hands `span` apart, centred on the origin, on a line at `bearingDeg`.
 *
 * Bearing is measured the way the diorama's own yaw is: zero along +Z, growing
 * towards +X, which is what a rotation about +Y does to a vector.
 */
function pair(bearingDeg, span) {
  const b = bearingDeg * DEG;
  const hx = Math.sin(b) * span / 2;
  const hz = Math.cos(b) * span / 2;
  return [-hx, -hz, hx, hz];
}

/** The yaw a twist from one hand pair to another asks for, in degrees. */
function twistDeg(before, after) {
  return twistYaw(before[0], before[1], before[2], before[3],
                  after[0], after[1], after[2], after[3]) / DEG;
}

console.log("=== only the rim is a handle ===");
{
  // "Soms beweeg ik mijn handen en dan beweegt het spel per ongeluk mee."
  // A grab that works anywhere fires by accident, because the world sits in
  // reach and the wearer's hands are in front of it constantly.
  const r = rig();
  // A rim 30 cm out from the origin, in the plate's own axes.
  const HALF = 30;
  r.callbacks.canGrab = (at) => onRim(at.x, at.z, HALF);

  // A pinch over the MIDDLE of the world does nothing at all.
  r.left.pinching = true;
  r.left.at(0, 0, 0);
  r.step();
  for (let i = 1; i <= 20; i++) { r.left.at(i, 0, 0); r.step(); }
  check("a pinch over the world moves nothing", r.seen.moves.length === 0,
        r.seen.moves.length + " moves");

  // The same drag, begun on the rim, moves it.
  const g = rig();
  g.callbacks.canGrab = (at) => onRim(at.x, at.z, HALF);
  g.left.pinching = true;
  g.left.at(HALF, 0, 0);
  g.step();
  for (let i = 1; i <= 20; i++) { g.left.at(HALF + i, 0, 0); g.step(); }
  check("a pinch on the rim moves it", g.seen.moves.length > 0);
  const travelled = g.seen.moves.reduce((n, m) => n + m.x, 0);
  check("...by as far as the hand went", travelled > 10, travelled.toFixed(1));

  // And a hand that slides off the rim mid-drag keeps the world, exactly as a
  // hand sliding along a real handle does. The test is asked once, at the
  // start; asking every frame would drop the world halfway across the table.
  const off = g.seen.moves.length;
  for (let i = 21; i <= 40; i++) { g.left.at(HALF + i, 0, 0); g.step(); }
  check("sliding off the rim mid-drag does not drop the world",
        g.seen.moves.length > off);

  // Two hands do NOT need the rim. The one-hand rule is the rim because one
  // hand near the world is what a wearer's hands do all day; two hands
  // pinching at once is not, so the two-handed gesture works over the whole
  // plate. Asking both -- or either -- to find a six-centimetre band while
  // also holding a span made resizing a stunt.
  const two = rig();
  two.callbacks.canGrab = (at) => onRim(at.x, at.z, HALF);
  two.callbacks.canSpan = (at) => overPlate(at.x, at.z, HALF);
  two.left.pinching = true;
  two.right.pinching = true;
  two.left.at(0, 0, 0);
  two.right.at(4, 0, 0);
  two.step();
  two.right.at(8, 0, 0);
  two.step();
  check("two hands over the middle of the world DO scale", two.seen.scale > 1,
        two.seen.scale);

  // Somewhere else entirely is still somewhere else: a wearer resizing
  // something across the room does not resize the town.
  const away = rig();
  away.callbacks.canGrab = (at) => onRim(at.x, at.z, HALF);
  away.callbacks.canSpan = (at) => overPlate(at.x, at.z, HALF);
  away.left.pinching = true;
  away.right.pinching = true;
  away.left.at(HALF * 4, 0, 0);
  away.right.at(HALF * 4 + 4, 0, 0);
  away.step();
  away.right.at(HALF * 4 + 8, 0, 0);
  away.step();
  check("two hands off the world entirely do not scale", near(away.seen.scale, 1),
        away.seen.scale);

  const edge = rig();
  edge.callbacks.canGrab = (at) => onRim(at.x, at.z, HALF);
  edge.callbacks.canSpan = (at) => overPlate(at.x, at.z, HALF);
  edge.left.pinching = true;
  edge.right.pinching = true;
  edge.left.at(HALF, 0, 0);
  edge.right.at(HALF + 6, 0, 0);
  edge.step();
  edge.right.at(HALF + 12, 0, 0);
  edge.step();
  check("one hand on the rim is enough to pull", edge.seen.scale > 1,
        edge.seen.scale.toFixed(2));

  // No handle drawn means no handle to miss: without the gate, everything
  // still works. A wearer whose UI Kit failed to load must not be locked out.
  const open = rig();
  open.left.pinching = true;
  open.left.at(0, 0, 0);
  open.step();
  for (let i = 1; i <= 20; i++) { open.left.at(i, 0, 0); open.step(); }
  check("with no gate at all, any pinch still moves it", open.seen.moves.length > 0);
}

console.log("=== a pinch off the handle is the A button ===");
{
  // Reading a page of text is most of playing this game, and every one of
  // those presses used to need hardware: a pad, a phone, or a hand reaching
  // for the button plate. A pinch is the one gesture the glasses give you for
  // free, so a pinch that is not a grab is A.
  const HALF = 30;
  const gate = (at) => onRim(at.x, at.z, HALF);

  const r = rig();
  let taps = 0;
  r.callbacks.canGrab = gate;
  r.callbacks.onTap = () => { taps++; };

  // Pinch over the middle of the world, hold briefly, let go.
  r.left.pinching = true;
  r.left.at(0, 0, 0);
  r.step();
  r.step();
  check("holding a pinch has not pressed anything yet", taps === 0);
  r.left.pinching = false;
  r.step();
  check("letting it go presses A", taps === 1, taps);
  check("...and moves nothing", r.seen.moves.length === 0);

  // A pinch that WANDERS is someone gesturing, not pressing.
  const wander = rig();
  let wandered = 0;
  wander.callbacks.canGrab = gate;
  wander.callbacks.onTap = () => { wandered++; };
  wander.left.pinching = true;
  wander.left.at(0, 0, 0);
  wander.step();
  for (let i = 1; i <= 10; i++) { wander.left.at(i, 0, 0); wander.step(); }
  wander.left.pinching = false;
  wander.step();
  check("a pinch that wanders is not a press", wandered === 0, wandered);

  // A pinch HELD is someone about to do something else, not a press.
  const held = rig();
  let heldTaps = 0;
  held.callbacks.canGrab = gate;
  held.callbacks.onTap = () => { heldTaps++; };
  held.left.pinching = true;
  held.left.at(0, 0, 0);
  held.step();
  for (let i = 0; i < 120; i++) { held.step(); }
  held.left.pinching = false;
  held.step();
  check("a pinch held for two seconds is not a press", heldTaps === 0, heldTaps);

  // A pinch ON the handle that goes nowhere is a press too (19 September: a
  // tap over the world walks there, and the band is a third of the plate, so
  // the outer cells of every town would otherwise be unreachable by pinch).
  // Picking the world UP is a drag, and a drag is still never a press.
  const grab = rig();
  let grabTaps = 0;
  grab.callbacks.canGrab = gate;
  grab.callbacks.onTap = () => { grabTaps++; };
  grab.left.pinching = true;
  grab.left.at(HALF, 0, 0);
  grab.step();
  grab.step();
  grab.left.pinching = false;
  grab.step();
  check("a still pinch on the handle is a press", grabTaps === 1, grabTaps);
  check("...that moved nothing", grab.seen.moves.length === 0);

  const lift = rig();
  let liftTaps = 0;
  lift.callbacks.canGrab = gate;
  lift.callbacks.onTap = () => { liftTaps++; };
  lift.left.pinching = true;
  lift.left.at(HALF, 0, 0);
  lift.step();
  for (let i = 1; i <= 10; i++) { lift.left.at(HALF, 0, i); lift.step(); }
  lift.left.pinching = false;
  lift.step();
  check("picking the world up is not a press", liftTaps === 0 && lift.seen.moves.length > 0, liftTaps);

  const heldGrab = rig();
  let heldGrabTaps = 0;
  heldGrab.callbacks.canGrab = gate;
  heldGrab.callbacks.onTap = () => { heldGrabTaps++; };
  heldGrab.left.pinching = true;
  heldGrab.left.at(HALF, 0, 0);
  for (let i = 0; i < 120; i++) { heldGrab.step(); }
  heldGrab.left.pinching = false;
  heldGrab.step();
  check("holding the handle for two seconds is not a press either", heldGrabTaps === 0, heldGrabTaps);
}

console.log("=== where the rim is ===");
{
  const HALF = 30;
  const band = HALF * RIM_BAND;
  check("dead centre is not the rim", onRim(0, 0, HALF) === false);
  check("the edge is", onRim(HALF, 0, HALF));
  check("...and so is just inside it", onRim(HALF - band * 0.5, 0, HALF));
  check("...and just outside", onRim(HALF + band * 0.5, 0, HALF));
  check("well outside is not", onRim(HALF * 2, 0, HALF) === false);
  check("halfway in is not", onRim(HALF * 0.5, 0, HALF) === false);
  // A square, not a circle: the corner is on the rim and a circular test would
  // put it a factor of root two too far out.
  check("the corner counts", onRim(HALF, HALF, HALF));
  check("and the middle of an edge counts", onRim(0, HALF, HALF));
  // Degenerate sizes cannot make everything grabbable.
  check("a zero-sized rim grabs nothing", onRim(0, 0, 0) === false);

  // The band is WIDE. It was 0.18 of the half-width -- about six centimetres
  // on a 70 cm plate -- and there is nothing drawn to aim at, which is what
  // "ik kan de wereld helemaal niet verplaatsen" is: a handle you cannot see
  // and cannot find by feel. Nothing may be drawn (a rounded rectangle was
  // tried on 9 September and arrived as a black lid over the world), so the
  // handle has to be big enough to hit blind instead.
  check("the band is a hand's width, not a finger's", RIM_BAND >= 0.3, RIM_BAND);
  // And still leaves the middle of the world alone, which is what the whole
  // rule is for: a pinch over the town is the A button, not a grab.
  check("the middle of the world is still not a handle",
        onRim(HALF * 0.5, 0, HALF) === false);
}

console.log("=== two hands work anywhere ON the world ===");
{
  const HALF = 30;
  const band = HALF * RIM_BAND;
  // The one-hand rule is the rim; the two-hand rule is the whole plate. Two
  // hands pinching at once over the town is not something a wearer does by
  // accident, so it does not need the handle -- and asking for it made the
  // scale a stunt.
  check("dead centre is over the world", overPlate(0, 0, HALF));
  check("so is the rim", overPlate(HALF, 0, HALF));
  check("and the far edge of the band", overPlate(HALF + band * 0.9, 0, HALF));
  check("a hand out past the plate is not", overPlate(HALF * 2, 0, HALF) === false);
  check("the corner is", overPlate(HALF, HALF, HALF));
  check("a zero-sized plate holds nothing", overPlate(0, 0, 0) === false);
  // The invariant that keeps the two rules from contradicting each other:
  // everything the one-hand rule accepts, the two-hand rule accepts too.
  let broken = 0;
  for (let x = -HALF * 2; x <= HALF * 2; x += HALF / 8) {
    for (let z = -HALF * 2; z <= HALF * 2; z += HALF / 8) {
      if (onRim(x, z, HALF) && !overPlate(x, z, HALF)) broken++;
    }
  }
  check("the rim is always over the plate", broken === 0, broken + " points");
}

console.log("=== the twist: what two hands turning ask for ===");
{
  // Rotation did not exist. The world took the heading it was placed at and
  // nothing else could turn it, so a wearer who moved their chair could put
  // the world back in front of them but never back round to face them.
  //
  // The gesture is the bearing of the line between the two hands. Turn the
  // pair, and the world turns with it by the same angle -- that is the whole
  // claim, and it is the one that makes the gesture invisible to learn.
  const flat = pair(0, 20);
  check("a quarter turn asks for a quarter turn",
        near(twistDeg(flat, pair(90, 20)), 90, 1e-9), twistDeg(flat, pair(90, 20)));
  check("...and the other way for the other way",
        near(twistDeg(flat, pair(-90, 20)), -90, 1e-9), twistDeg(flat, pair(-90, 20)));
  check("hands that do not turn ask for nothing",
        near(twistDeg(flat, pair(0, 40)), 0, 1e-9), twistDeg(flat, pair(0, 40)));
  check("pulling apart is not a turn",
        near(twistDeg(pair(30, 10), pair(30, 60)), 0, 1e-9));

  // The wrap. Bearings live on a circle, and the line between two hands passes
  // through 180 degrees constantly -- it is where the hands are when the
  // wearer's arms are level and facing them. Subtracting raw bearings there
  // asks for a 340-degree spin from a 20-degree wrist movement.
  check("crossing 180 degrees is a small turn, not a huge one",
        near(twistDeg(pair(170, 20), pair(-170, 20)), 20, 1e-9),
        twistDeg(pair(170, 20), pair(-170, 20)));
  check("...and back again",
        near(twistDeg(pair(-170, 20), pair(170, 20)), -20, 1e-9),
        twistDeg(pair(-170, 20), pair(170, 20)));
  check("a turn is never more than half a circle",
        Math.abs(twistDeg(pair(0, 20), pair(179.9, 20))) <= 180 + 1e-9);
  check("...in either direction",
        Math.abs(twistDeg(pair(0, 20), pair(-179.9, 20))) <= 180 + 1e-9);

  // Which hand is which does not matter: the line is the same line. Swapping
  // them is a half turn of the BEARING and no turn of the world, and the wrap
  // is what keeps that from reading as 180 degrees of spin in one frame.
  const swapped = [flat[2], flat[3], flat[0], flat[1]];
  check("swapping the hands is half a circle of bearing",
        near(Math.abs(twistDeg(flat, swapped)), 180, 1e-9), twistDeg(flat, swapped));

  // Two hands at the same point name no direction at all. Left to atan2 this
  // is a bearing of zero, which would snap the world round to whatever the
  // last real bearing happened to be the instant the hands touched.
  check("two hands at the same point ask for nothing",
        twistDeg(flat, [5, 5, 5, 5]) === 0);
  check("...and so does coming FROM that point",
        twistDeg([5, 5, 5, 5], flat) === 0);
  check("hands a millimetre apart still ask for nothing",
        twistDeg(flat, pair(90, 0.1)) === 0);
  check("a bearing that cannot be had is not a number",
        twistBearing(3, 4, 3, 4) !== twistBearing(3, 4, 3, 4));
  check("and one that can, is", twistBearing(0, 0, 0, 10) === 0);
  check("...growing towards +X", near(twistBearing(0, 0, 10, 0), Math.PI / 2));

  // Turning all the way round and back is a no-op however it is chopped up:
  // the gesture has to be reversible or the world drifts.
  let total = 0;
  for (let i = 1; i <= 36; i++) total += twistDeg(pair((i - 1) * 10, 20), pair(i * 10, 20));
  check("a full turn in ten-degree steps is a full turn", near(total, 360, 1e-9), total);

  check("wrapping keeps a half turn positive", near(wrapRadians(Math.PI), Math.PI));
  check("...and folds the negative half turn onto it",
        near(wrapRadians(-Math.PI), Math.PI));
  check("wrapping leaves a small angle alone", wrapRadians(0.5) === 0.5);
  check("and unwinds a wound-up one", near(wrapRadians(0.5 + 6 * Math.PI), 0.5, 1e-9));
}

console.log("=== binding ===");
{
  const r = rig();
  check("a hand provider binds", r.bound === true);
  const none = new DioramaHands();
  check("no provider at all is a false, not a throw", none.bind(() => null) === false);
  const thrower = new DioramaHands();
  check("a provider that throws is caught",
        thrower.bind(() => { throw new Error("no SIK"); }) === false);
  check("and an unbound one does nothing on update",
        (() => { thrower.update(1 / 60, { onDiveScale: () => { throw new Error("called"); },
                                          onMove: () => { throw new Error("called"); } });
                 return thrower.modeName() === ""; })());
}

console.log("=== two hands scale the world ===");
{
  const r = rig();
  r.left.pinching = true; r.right.pinching = true;
  r.left.at(-10, 0, 0); r.right.at(10, 0, 0);      // 20 cm apart
  r.step();
  check("the first frame only measures", r.seen.scale === 1);
  check("and says it is scaling", r.hands.modeName() === "scale");

  r.left.at(-20, 0, 0); r.right.at(20, 0, 0);      // 40 cm apart
  r.step();
  // Twice the span is twice the size -- but one frame may only do so much, so
  // the gesture arrives over a few frames rather than in one jump.
  check("pulling apart grows the world", r.seen.scale > 1, r.seen.scale);
  for (let i = 0; i < 10; i++) r.step();
  check("and settles at the ratio of the spans", near(r.seen.scale, 2, 1e-6), r.seen.scale);

  r.left.at(-10, 0, 0); r.right.at(10, 0, 0);      // back to 20 cm
  for (let i = 0; i < 12; i++) r.step();
  check("putting the hands back puts the world back", near(r.seen.scale, 1, 1e-6), r.seen.scale);
}

console.log("=== it scales about the point between the hands ===");
{
  const r = rig();
  r.left.pinching = true; r.right.pinching = true;
  r.left.at(0, 0, 0); r.right.at(20, 40, 60);
  r.step();
  r.left.at(-2, 0, 0); r.right.at(22, 40, 60);
  r.step();
  const pivot = r.seen.pivots[r.seen.pivots.length - 1];
  check("the pivot is the midpoint",
        near(pivot.x, 10) && near(pivot.y, 20) && near(pivot.z, 30),
        JSON.stringify(pivot));
}

console.log("=== letting go leaves the world where it is ===");
{
  const r = rig();
  r.left.pinching = true; r.right.pinching = true;
  r.left.at(-10, 0, 0); r.right.at(10, 0, 0);
  r.step();
  r.left.at(-15, 0, 0); r.right.at(15, 0, 0);
  for (let i = 0; i < 12; i++) r.step();
  const held = r.seen.scale;
  check("the world grew while held", held > 1.4, held);

  r.left.pinching = false;
  r.step();
  check("and the release scales nothing further", near(r.seen.scale, held), r.seen.scale);
  check("and the gesture is over", r.hands.modeName() === "");

  // The hand still pinching is somewhere it was never dragging from, so it must
  // not become a drag that yanks the world across the room.
  check("the leftover hand does not drag", r.seen.moves.length === 0, r.seen.moves.length);
  r.step();
  check("nor on the frame after", r.seen.moves.length === 0);
}

console.log("=== one hand moves the world ===");
{
  const r = rig();
  r.right.pinching = true;
  r.right.at(0, 0, 0);
  r.step();
  check("a pinch that has not moved is undecided", r.hands.modeName() === "pinch");
  r.step();
  check("and holding still no longer starts a zoom", r.seen.scale === 1);
  check("however long it is held", r.hands.modeName() === "pinch");
  for (let i = 0; i < 60; i++) r.step();
  check("really: a whole second of holding still is not a zoom", r.seen.scale === 1);

  r.right.at(0, 10, 0);
  r.step();
  check("moving past the threshold is a drag", r.hands.modeName() === "drag");
  r.right.at(0, 15, 0);
  r.step();
  const last = r.seen.moves[r.seen.moves.length - 1];
  check("and the world follows the hand", near(last.y, 5), JSON.stringify(last));
  r.right.pinching = false;
  r.step();
  check("releasing ends the drag", r.hands.modeName() === "");
}

console.log("=== hand tracking that glitches ===");
{
  const r = rig();
  r.left.pinching = true; r.right.pinching = true;
  r.left.at(-10, 0, 0); r.right.at(10, 0, 0);
  r.step();
  // One frame in which a hand is reported across the room.
  r.right.at(10000, 0, 0);
  r.step();
  check("one frame cannot scale without limit", r.seen.scale <= 1.5 + 1e-9, r.seen.scale);

  const s = rig();
  s.left.pinching = true; s.right.pinching = true;
  s.left.at(0, 0, 0); s.right.at(0.5, 0, 0);   // hands touching
  s.step();
  s.left.at(0, 0, 0); s.right.at(0.6, 0, 0);
  s.step();
  check("hands too close together do not scale at all", s.seen.scale === 1, s.seen.scale);

  const t = rig();
  t.left.pinching = true; t.right.pinching = true;
  t.left.at(-10, 0, 0); t.right.at(10, 0, 0);
  t.step();
  t.right.tracked = false;
  t.step();
  check("a hand that stops being tracked ends the scale", t.hands.modeName() === "");
}

console.log("=== two hands turn the world as well as resize it ===");
{
  // The same gesture does both, because the hands are already saying both: the
  // distance between them is the size and the line between them is the
  // heading. Splitting them into two gestures would mean a wearer who wants to
  // turn the world first has to remember which one turns it.
  const r = rig();
  r.left.pinching = true; r.right.pinching = true;
  const level = pair(0, 20);
  r.left.at(level[0], 0, level[1]); r.right.at(level[2], 0, level[3]);
  r.step();
  check("the first frame only measures", near(r.seen.turn, 0), r.seen.turn);

  // Turn the pair a quarter circle, a few degrees per frame the way a wrist
  // does, and the world has turned a quarter circle.
  for (let deg = 3; deg <= 90; deg += 3) {
    const p = pair(deg, 20);
    r.left.at(p[0], 0, p[1]);
    r.right.at(p[2], 0, p[3]);
    r.step();
  }
  check("turning the hands turns the world", near(r.seen.turn / DEG, 90, 1e-6),
        r.seen.turn / DEG);

  // ...and turning them back turns it back. The gesture tracks the hands, so
  // the world cannot drift away from them however long it is held.
  for (let deg = 87; deg >= 0; deg -= 3) {
    const p = pair(deg, 20);
    r.left.at(p[0], 0, p[1]);
    r.right.at(p[2], 0, p[3]);
    r.step();
  }
  check("and turning them back turns it back", near(r.seen.turn, 0, 1e-9),
        r.seen.turn / DEG);

  // Scale and turn at once, which is what a real two-handed gesture is.
  const both = rig();
  both.left.pinching = true; both.right.pinching = true;
  const start = pair(0, 20);
  both.left.at(start[0], 0, start[1]); both.right.at(start[2], 0, start[3]);
  both.step();
  for (let i = 1; i <= 30; i++) {
    const p = pair(i, 20 + i);
    both.left.at(p[0], 0, p[1]);
    both.right.at(p[2], 0, p[3]);
    both.step();
  }
  for (let i = 0; i < 20; i++) both.step();
  check("one gesture does both: it turned", near(both.seen.turn / DEG, 30, 1e-6),
        both.seen.turn / DEG);
  check("...and it scaled", near(both.seen.scale, 50 / 20, 1e-6), both.seen.scale);

  // One hand cannot turn anything. A single point has no line to take a
  // bearing from, and a drag that quietly spun the world would be unusable.
  const one = rig();
  one.right.pinching = true;
  one.right.at(0, 0, 0);
  one.step();
  for (let i = 1; i <= 30; i++) { one.right.at(i, 0, i); one.step(); }
  check("one hand moves and never turns", one.seen.turns.length === 0,
        one.seen.turns.length);
  check("...and it did move", one.seen.moves.length > 0);

  // Hands on top of each other have no bearing, so holding them together and
  // waving must not spin the world.
  const close = rig();
  close.left.pinching = true; close.right.pinching = true;
  close.left.at(0, 0, 0); close.right.at(0.5, 0, 0);
  close.step();
  for (let i = 1; i <= 20; i++) {
    close.left.at(0, 0, 0);
    close.right.at(Math.cos(i) * 0.5, 0, Math.sin(i) * 0.5);
    close.step();
  }
  check("hands touching do not turn the world", near(close.seen.turn, 0),
        close.seen.turn);

  // A tracking glitch is one frame in which a hand is somewhere impossible.
  // Uncapped, that frame is read as a colossal twist; capped, it is a small
  // step the next frame takes back.
  const glitch = rig();
  glitch.left.pinching = true; glitch.right.pinching = true;
  const flat = pair(0, 20);
  glitch.left.at(flat[0], 0, flat[1]); glitch.right.at(flat[2], 0, flat[3]);
  glitch.step();
  const flipped = pair(150, 20);
  glitch.left.at(flipped[0], 0, flipped[1]);
  glitch.right.at(flipped[2], 0, flipped[3]);
  glitch.step();
  // Fifteen degrees a frame is 900 a second: faster than a wrist, slow enough
  // that a lost frame is not a spin.
  check("one frame cannot spin the world", Math.abs(glitch.seen.turn / DEG) <= 15 + 1e-9,
        glitch.seen.turn / DEG);
  glitch.left.at(flat[0], 0, flat[1]); glitch.right.at(flat[2], 0, flat[3]);
  for (let i = 0; i < 30; i++) glitch.step();
  check("...and the frame after puts it back", near(glitch.seen.turn, 0, 1e-9),
        glitch.seen.turn / DEG);

  // Letting go ends the turn where it is, exactly as it ends the scale.
  const drop = rig();
  drop.left.pinching = true; drop.right.pinching = true;
  const a = pair(0, 20);
  drop.left.at(a[0], 0, a[1]); drop.right.at(a[2], 0, a[3]);
  drop.step();
  const b = pair(10, 20);
  drop.left.at(b[0], 0, b[1]); drop.right.at(b[2], 0, b[3]);
  drop.step();
  const held = drop.seen.turn;
  check("the world turned while held", held > 0, held / DEG);
  drop.left.pinching = false;
  drop.step();
  drop.step();
  check("and the release turns nothing further", near(drop.seen.turn, held));
}

console.log("=== the handle says where it is ===");
{
  // The rim is wide now, but it is still not DRAWN -- a drawn one arrived on
  // the glasses as a black lid over the world. So the lens says it instead:
  // put a hand where the world can be picked up and the status line tells you
  // so. It is the cheapest thing that turns an invisible handle into a
  // findable one, and it costs no geometry at all.
  const HALF = 30;
  const r = rig();
  r.callbacks.canGrab = (at) => onRim(at.x, at.z, HALF);
  r.left.tracked = false;
  r.right.at(0, 0, 0);
  r.step();
  check("a hand over the middle says nothing",
        r.seen.hovers.length === 0, JSON.stringify(r.seen.hovers));

  r.right.at(HALF, 0, 0);
  r.step();
  check("a hand over the rim says so", r.seen.hovers.length === 1 && r.seen.hovers[0] === true,
        JSON.stringify(r.seen.hovers));
  r.step();
  r.step();
  check("...once, not every frame", r.seen.hovers.length === 1,
        JSON.stringify(r.seen.hovers));

  r.right.at(0, 0, 0);
  r.step();
  check("moving off says so too",
        r.seen.hovers.length === 2 && r.seen.hovers[1] === false,
        JSON.stringify(r.seen.hovers));
  r.step();
  check("...also once", r.seen.hovers.length === 2);

  // A hand that is not there cannot hover.
  r.right.at(HALF, 0, 0);
  r.step();
  check("a hand back on the rim says so again", r.seen.hovers.length === 3);
  r.right.tracked = false;
  r.step();
  check("a hand that stops being tracked stops hovering",
        r.seen.hovers.length === 4 && r.seen.hovers[3] === false,
        JSON.stringify(r.seen.hovers));

  // And while a gesture is running the hint is out of the way: the wearer has
  // already found the handle, and the line has better things to say.
  const grab = rig();
  grab.callbacks.canGrab = (at) => onRim(at.x, at.z, HALF);
  grab.left.tracked = false;
  grab.right.at(HALF, 0, 0);
  grab.step();
  check("hovering before the grab", grab.seen.hovers.length === 1);
  grab.right.pinching = true;
  grab.step();
  for (let i = 1; i <= 10; i++) { grab.right.at(HALF + i, 0, 0); grab.step(); }
  check("taking hold clears the hint",
        grab.seen.hovers.length === 2 && grab.seen.hovers[1] === false,
        JSON.stringify(grab.seen.hovers));
  check("...and it stays cleared for the whole drag", grab.seen.hovers.length === 2);
}

if (SELFTEST) {
  console.log("=== selftest ===");
  // Prove the tracking claim can fail: a gesture that scaled by a FIXED rate
  // per frame -- the old dive -- would not come back to 1 when the hands do.
  const r = rig();
  r.left.pinching = true; r.right.pinching = true;
  r.left.at(-10, 0, 0); r.right.at(10, 0, 0);
  r.step();
  r.left.at(-20, 0, 0); r.right.at(20, 0, 0);
  for (let i = 0; i < 10; i++) r.step();
  const outward = r.seen.scale;
  r.left.at(-10, 0, 0); r.right.at(10, 0, 0);
  for (let i = 0; i < 12; i++) r.step();
  check("SELFTEST a rate-based zoom would not return to 1",
        !near(outward, 1) && near(r.seen.scale, 1, 1e-6),
        outward + " out, " + r.seen.scale + " back");

  // The wrap is load-bearing, not tidiness. Show what the naive subtraction
  // asks for at the same two hand positions the test above uses.
  const naive = (Math.atan2(Math.sin(-170 * DEG), Math.cos(-170 * DEG)) -
                 Math.atan2(Math.sin(170 * DEG), Math.cos(170 * DEG))) / DEG;
  check("SELFTEST raw bearings would spin the world the long way round",
        Math.abs(naive) > 300 && near(twistDeg(pair(170, 20), pair(-170, 20)), 20, 1e-9),
        naive.toFixed(1) + " degrees the naive way");

  // And so is refusing a bearing from two coincident points: atan2 answers
  // zero there, which is a perfectly plausible heading and completely wrong.
  check("SELFTEST atan2 would call touching hands a heading of zero",
        Math.atan2(0, 0) === 0 &&
        twistBearing(5, 5, 5, 5) !== twistBearing(5, 5, 5, 5));
}

console.log("");
console.log("=== the stick ===");
{
  // A pinch inside the plate (canGrab false) held past a tap is the hand as
  // a joystick: onStick every frame, onStickEnd on release, never a tap. On
  // the rim it is a grab as before, and a quick pinch is still a tap.
  const seen = { stick: [], ends: 0, taps: 0, moves: 0 };
  const r = rig();
  const callbacks = {
    canGrab: (p) => p.x > 20,
    onMove: () => { seen.moves++; },
    onTap: () => { seen.taps++; },
    onStick: (p) => { seen.stick.push(p); },
    onStickEnd: () => { seen.ends++; },
  };
  const step = (dt) => r.hands.update(dt === undefined ? 1 / 60 : dt, callbacks);
  r.right.pinching = true;
  r.right.at(5, 0, 5);
  for (let i = 0; i < 30; i++) step();
  check("a short hold is not yet a stick", seen.stick.length === 0);
  for (let i = 0; i < 20; i++) step();
  check("held past a tap it becomes one", seen.stick.length > 0 && r.hands.modeName() === "stick");
  const before = seen.stick.length;
  r.right.at(9, 0, 5);
  step();
  check("and reports where the hand is each frame", seen.stick.length === before + 1 && seen.stick[seen.stick.length - 1].x === 9);
  r.right.pinching = false;
  step();
  check("letting go ends it, and is not a tap", seen.ends === 1 && seen.taps === 0);
  r.right.pinching = true;
  r.right.at(5, 0, 5);
  for (let i = 0; i < 5; i++) step();
  r.right.pinching = false;
  step();
  check("a quick pinch is still a tap", seen.taps === 1 && seen.ends === 1);
  r.right.pinching = true;
  r.right.at(30, 0, 0);
  for (let i = 0; i < 50; i++) step();
  r.right.at(36, 0, 0);
  step();
  check("on the rim a long hold is a grab, never a stick", seen.moves > 0 && seen.stick.length === before + 1);
  r.right.pinching = false;
  step();
  check("and letting go of the rim ends no stick", seen.ends === 1);
}

console.log("DIORAMAHANDS  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
