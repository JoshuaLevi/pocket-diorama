// The menu cursor moves once per press, not once per frame.
//
//   node --experimental-strip-types --import ./test/register.mjs test/dpad.test.mjs
//
// dpad() is LEVEL-triggered: it reports true on every frame a direction is held,
// which is right for walking and catastrophic for a menu -- at 60fps a held
// direction would run the cursor down a four-item list in 67 milliseconds and
// keep going. pressedA() is already edge-triggered; this is the same idea for
// directions, plus the delay-then-repeat the cartridge uses so a long list is
// still navigable by holding.

globalThis.print = () => {};

const { DPadEdge, DPAD_REPEAT_DELAY, DPAD_REPEAT_RATE, emptyDPad,
        PinchSource, InputRouter } =
  await import("../Assets/Scripts/play/InputSource.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

const held = (dir) => ({ ...emptyDPad(), [dir]: true });

/** Frames of a direction held, returning how many times it fired. */
function hold(edge, dir, seconds, dt) {
  let fired = 0;
  for (let t = 0; t < seconds; t += dt) {
    if (edge.step(held(dir), dt) !== "") { fired++; }
  }
  return fired;
}

{
  const edge = new DPadEdge();
  check("a press fires once", edge.step(held("down"), 0.016) === "down");
  check("and not again on the next frame", edge.step(held("down"), 0.016) === "");
  check("nor the frame after", edge.step(held("down"), 0.016) === "");
}

{
  const edge = new DPadEdge();
  edge.step(held("down"), 0.016);
  // A quarter second of holding is still one move: the delay has not passed.
  const fired = hold(edge, "down", DPAD_REPEAT_DELAY * 0.6, 0.016);
  check("holding below the repeat delay does not repeat", fired === 0, fired + " fires");
}

{
  const edge = new DPadEdge();
  edge.step(held("down"), 0.016);
  const fired = hold(edge, "down", 1.0, 0.016);
  const expected = Math.floor((1.0 - DPAD_REPEAT_DELAY) / DPAD_REPEAT_RATE);
  check("holding past it repeats at the repeat rate",
        Math.abs(fired - expected) <= 1, `${fired} fires, expected about ${expected}`);
  check("which is a usable speed, not sixty a second",
        fired > 2 && fired < 12, fired + " in one second");
}

{
  const edge = new DPadEdge();
  edge.step(held("down"), 0.016);
  edge.step(held("down"), 0.016);
  check("changing direction fires immediately",
        edge.step(held("up"), 0.016) === "up");
}

{
  const edge = new DPadEdge();
  edge.step(held("down"), 0.016);
  edge.step(emptyDPad(), 0.016);
  check("releasing and pressing again fires again",
        edge.step(held("down"), 0.016) === "down");
}

{
  // A menu that opens while a direction is already held must not inherit it:
  // the press that opened the menu would immediately move the cursor.
  const edge = new DPadEdge();
  edge.step(held("down"), 0.016);
  edge.reset();
  check("reset makes a held direction fire once more, not stay swallowed",
        edge.step(held("down"), 0.016) === "down");
}

{
  const edge = new DPadEdge();
  check("nothing held fires nothing", edge.step(emptyDPad(), 0.016) === "");
}

console.log("\n== a pinch is the A button, added rather than ranked ==");
{
  const pinch = new PinchSource();
  check("nothing pressed to begin with", pinch.pressedA() === false);
  pinch.tap();
  check("...and a tap is not seen until the frame it belongs to",
        pinch.pressedA() === false);
  pinch.update();
  check("the frame after a tap, A is down", pinch.pressedA());
  pinch.update();
  check("and one frame only", pinch.pressedA() === false);
  // It answers no direction at all, ever. A source that did would win the
  // router with a controller in the wearer's hands and then refuse to walk.
  pinch.tap();
  pinch.update();
  const d = pinch.dpad();
  check("a pinch is never a direction",
        !d.up && !d.down && !d.left && !d.right);
  check("nor B, START or SELECT",
        !pinch.pressedB() && !pinch.pressedStart() && !pinch.pressedSelect());
}

console.log("\n== the overlay adds to the winner, it does not replace it ==");
{
  /** A source that reports, walks left, and never presses anything. */
  const walker = {
    name: "walker",
    update() {},
    dpad: () => ({ ...emptyDPad(), left: true }),
    pressedA: () => false,
    pressedB: () => false,
    pressedStart: () => false,
    pressedSelect: () => false,
    isConnected: () => true,
  };
  const pinch = new PinchSource();
  const router = new InputRouter([walker]);
  router.setOverlay(pinch);
  router.update();
  check("the walking source is the one driving", router.activeName() === "walker");
  check("...and it is walking", router.dpad().left);
  check("with nothing pressed", router.pressedA() === false);

  pinch.tap();
  router.update();
  check("a pinch presses A THROUGH the source that is driving", router.pressedA());
  check("...without taking the walk away", router.dpad().left,
        JSON.stringify(router.dpad()));
  check("...and without becoming the active source",
        router.activeName() === "walker");
  router.update();
  check("and it lasts one frame", router.pressedA() === false);

  // With nothing else connected at all, the router still has no active source
  // -- an overlay is not a controller -- but A still arrives.
  const alone = new InputRouter([]);
  const only = new PinchSource();
  alone.setOverlay(only);
  only.tap();
  alone.update();
  check("a pinch works with no controller at all", alone.pressedA());
  check("...and is still not a controller", alone.isConnected() === false);
}

console.log(`\n${fail === 0 ? "DPAD OK" : "DPAD FAILED"}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
