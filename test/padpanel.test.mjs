// The Game Boy panel and the keyboard, headless.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/padpanel.test.mjs --selftest
//
// What a press means -- level for the cross, an edge for A, B and START, a
// pulse that expires for the mouse and the keys, a hold for a hand -- is all
// decidable without a scene, so all of it is decided here. The scene half
// (PadPanelView) is checked live in the preview.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const pad = await import("../Assets/Scripts/play/PadPanel.ts");
const { PanelSource, padLayout, dpadHub, keyToButton, ALL_BUTTONS, BUTTON_A, BUTTON_B,
        HOLD_UNTIL_RELEASED, MOUSE_PULSE_SECONDS, KEY_PULSE_SECONDS, MIN_PRESS_SECONDS,
        PLATE_WIDTH_CM, PLATE_HEIGHT_CM } = pad;
const { KeyboardKeys } = await import("../Assets/Scripts/play/KeyboardKeys.ts");
const { InputRouter, ScriptedInputSource } = await import("../Assets/Scripts/play/InputSource.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

function overlaps(a, b) {
  return Math.abs(a.x - b.x) * 2 < a.width + b.width - 1e-9 &&
         Math.abs(a.y - b.y) * 2 < a.height + b.height - 1e-9;
}

console.log("=== layout ===");
{
  const layout = padLayout();
  check("eight buttons", layout.length === 8);
  check("every button is known to the source",
        layout.every((b) => ALL_BUTTONS.indexOf(b.name) >= 0));
  let inside = true;
  let clash = null;
  for (const b of layout) {
    if (Math.abs(b.x) + b.width / 2 > PLATE_WIDTH_CM / 2 ||
        Math.abs(b.y) + b.height / 2 > PLATE_HEIGHT_CM / 2) { inside = false; }
    for (const o of layout) {
      if (o !== b && overlaps(b, o)) { clash = b.name + "/" + o.name; }
    }
  }
  check("every button is on the plate", inside);
  check("no two buttons overlap", clash === null, clash);

  const by = {};
  layout.forEach((b) => { by[b.name] = b; });
  check("the cross is a cross",
        by.up.x === by.down.x && by.left.y === by.right.y &&
        by.up.y > by.down.y && by.right.x > by.left.x);
  const hub = dpadHub();
  check("the hub sits at the cross centre", hub.x === by.up.x && hub.y === by.left.y);
  check("A is right of and above B", by.a.x > by.b.x && by.a.y > by.b.y);
  check("A and B are round-ish and equal", by.a.width === by.a.height && by.a.width === by.b.width);
  check("START is right of SELECT", by.start.x > by.select.x);
  check("the cross is on the left half, A/B on the right",
        by.up.x < 0 && by.a.x > 0 && by.b.x > 0);
}

console.log("=== keys ===");
{
  check("arrows walk", keyToButton("Left") === "left" && keyToButton("Right") === "right" &&
        keyToButton("Up") === "up" && keyToButton("Down") === "down");
  check("IJKL walk too, because the preview camera owns the arrows",
        keyToButton("I") === "up" && keyToButton("J") === "left" &&
        keyToButton("K") === "down" && keyToButton("L") === "right");
  check("Z is A, X is B", keyToButton("Z") === "a" && keyToButton("X") === "b");
  check("space is START, shift is SELECT",
        keyToButton("Space") === "start" && keyToButton("Shift") === "select");
  check("WASD is NOT bound: the preview camera uses it",
        keyToButton("W") === "" && keyToButton("A") === "" &&
        keyToButton("S") === "" && keyToButton("D") === "");
  check("an unknown key is nothing", keyToButton("F1") === "" && keyToButton("") === "");
}

console.log("=== the source ===");
{
  const s = new PanelSource();
  check("silent until used", !s.isConnected());
  s.update();
  check("nothing held at rest", !s.dpad().up && !s.pressedA());

  // A hand: held until released.
  s.press("up", HOLD_UNTIL_RELEASED);
  check("a press connects it", s.isConnected());
  s.tick(5);
  check("a hand's hold survives any amount of time", s.dpad().up);
  s.release("up");
  check("a release keeps it down for the minimum press", s.dpad().up);
  s.tick(MIN_PRESS_SECONDS + 0.01);
  check("and it ends once the minimum has passed", !s.dpad().up);
  s.press("up", HOLD_UNTIL_RELEASED);
  s.tick(0.5);
  s.release("up");
  s.tick(MIN_PRESS_SECONDS + 0.01);
  check("a long hold ends promptly after release", !s.dpad().up);

  // The mouse: one pulse.
  s.press("right", MOUSE_PULSE_SECONDS);
  s.tick(MOUSE_PULSE_SECONDS * 0.5);
  check("a mouse pulse is still down halfway", s.dpad().right);
  s.tick(MOUSE_PULSE_SECONDS * 0.6);
  check("and up once it has expired", !s.dpad().right);
  check("a pulse lasts longer than one step, so a click walks",
        MOUSE_PULSE_SECONDS > 0.26);

  // The keyboard: repeats extend.
  s.press("left", KEY_PULSE_SECONDS);
  s.tick(KEY_PULSE_SECONDS * 0.8);
  s.press("left", KEY_PULSE_SECONDS);
  s.tick(KEY_PULSE_SECONDS * 0.8);
  check("a repeated key press extends the hold", s.dpad().left);
  s.tick(KEY_PULSE_SECONDS);
  check("and it drops once the repeats stop", !s.dpad().left);

  // Edges.
  s.press("a", HOLD_UNTIL_RELEASED);
  check("A is not visible before update()", !s.pressedA());
  s.update();
  check("A is an edge on the next frame", s.pressedA());
  s.update();
  check("and gone the frame after, though still held", !s.pressedA() && s.isHeld("a"));
  s.press("a", HOLD_UNTIL_RELEASED);
  s.update();
  check("re-pressing a held A does not fire again", !s.pressedA());
  s.release("a");
  s.press("a", MOUSE_PULSE_SECONDS);
  s.update();
  check("a fresh press after release fires again", s.pressedA());

  s.press("b", HOLD_UNTIL_RELEASED);
  s.press("start", HOLD_UNTIL_RELEASED);
  s.update();
  check("B and START edge too", s.pressedB() && s.pressedStart());

  const before = s.stateVersion();
  s.press("bogus", HOLD_UNTIL_RELEASED);
  check("an unknown button is ignored", s.stateVersion() === before && !s.isHeld("bogus"));

  s.releaseAll();
  check("releaseAll clears everything", ALL_BUTTONS.every((b) => !s.isHeld(b)));
  check("the version moves on every change", s.stateVersion() > before);
}

console.log("=== keyboard binding ===");
{
  // A fake component: createEvent hands back objects whose bind() we capture.
  const bound = {};
  const createEvent = (name) => ({ bind: (fn) => { bound[name] = fn; } });
  globalThis.global = { Keys: { Left: 2, Up: 3, Right: 4, Down: 5, Shift: 6, Space: 10,
                                I: 29, J: 30, K: 31, L: 32, X: 44, Z: 46 } };
  const s = new PanelSource();
  const kb = new KeyboardKeys();
  check("binds where the events exist", kb.bind(createEvent, s) === true);
  check("reads the runtime's own key codes", kb.usesRuntimeCodes());
  bound.KeyPressEvent({ key: 4 });
  check("Right arrow holds right", s.dpad().right);
  bound.KeyPressEvent({ key: 46 });
  s.update();
  check("Z presses A", s.pressedA());
  bound.KeyReleaseEvent({ key: 4 });
  s.tick(MIN_PRESS_SECONDS + 0.01);
  check("release lets go", !s.dpad().right);
  // The case that lost taps live: press and release inside one frame.
  bound.KeyPressEvent({ key: 5 });
  bound.KeyReleaseEvent({ key: 5 });
  check("a same-frame tap is still down for the game to see", s.dpad().down);
  s.tick(MIN_PRESS_SECONDS + 0.01);
  check("and gone after the minimum", !s.dpad().down);
  bound.KeyPressEvent({ key: 999 });
  check("an unmapped code does nothing", !s.dpad().up && !s.dpad().down);

  // Without the enum object the baked table stands in.
  globalThis.global = {};
  const s2 = new PanelSource();
  const kb2 = new KeyboardKeys();
  kb2.bind(createEvent, s2);
  check("falls back to the declared ordinals", !kb2.usesRuntimeCodes());
  bound.KeyPressEvent({ key: 2 });
  check("and Left still walks left", s2.dpad().left);

  // 5.15: no KeyPressEvent at all.
  const throwing = () => { throw new Error("no such event"); };
  check("reports unavailable where the runtime has no keyboard",
        new KeyboardKeys().bind(throwing, new PanelSource()) === false);
  const nulling = () => null;
  check("and where createEvent hands back nothing",
        new KeyboardKeys().bind(nulling, new PanelSource()) === false);
}

console.log("=== in the router ===");
{
  const panel = new PanelSource();
  const scripted = new ScriptedInputSource();
  const router = new InputRouter([panel, scripted]);
  router.update();
  check("the scripted fallback drives until the panel is used",
        router.activeName() === "scripted");
  panel.press("a", HOLD_UNTIL_RELEASED);
  router.update();
  check("the first press hands the router to the panel", router.activeName() === "panel");
  check("and its edge reaches the game", router.pressedA());
}

if (SELFTEST) {
  console.log("=== selftest ===");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before;
    fail = before;
    if (noticed) { pass++; } else {
      fail++;
      console.log("  FAIL selftest: " + label + " passes even when broken");
    }
  }
  expectFailures("a pulse that never expires", () => {
    const s = new PanelSource();
    s.press("right", MOUSE_PULSE_SECONDS);
    // Pretend tick() lost its clock.
    s.tick = () => {};
    s.tick(10);
    check("expiry detector", !s.dpad().right);
  });
  expectFailures("an edge that repeats every frame", () => {
    const s = new PanelSource();
    s.press("a", HOLD_UNTIL_RELEASED);
    s.update();
    s.update = function () { this.frameA = true; };
    s.update();
    check("edge detector", !s.pressedA());
  });
  expectFailures("overlapping buttons", () => {
    const layout = padLayout();
    layout[0].x = layout[1].x;
    layout[0].y = layout[1].y;
    let clash = false;
    for (const b of layout) for (const o of layout) if (o !== b && overlaps(b, o)) clash = true;
    check("overlap detector", !clash);
  });
  expectFailures("a source that connects at rest", () => {
    const s = new PanelSource();
    s.isConnected = () => true;
    check("rest detector", !s.isConnected());
  });
}

console.log("");
console.log("=== the press clock ===");
{
  // The hand tracker reports a pinch on a button as a tap of its own, at
  // release, up to 0.6 s after SIK pressed the button. PokemonAR drops that
  // tap when a press is this recent, so the clock has to be honest.
  const s = new PanelSource();
  check("no press yet reads as long ago", s.secondsSincePress() > 60);
  s.press(BUTTON_B, HOLD_UNTIL_RELEASED);
  check("a press resets the clock", s.secondsSincePress() === 0);
  s.tick(0.25);
  check("it counts the frames", Math.abs(s.secondsSincePress() - 0.25) < 1e-9);
  s.release(BUTTON_B);
  s.tick(0.5);
  check("a release does not reset it", Math.abs(s.secondsSincePress() - 0.75) < 1e-9);
  s.press(BUTTON_A, MOUSE_PULSE_SECONDS);
  check("the next press does", s.secondsSincePress() === 0);
  // A HELD button outlasts that clock: a D-pad arm held for two seconds is
  // still a hand on a button, and the hand tracker's reading of the same
  // pinch (a joystick, a grab of the world's edge) has to be refused for as
  // long as it is down, not for 0.9 s.
  const h = new PanelSource();
  check("nothing is held before a press", h.anyHeld() === false);
  h.press("down", HOLD_UNTIL_RELEASED);
  h.tick(2.0);
  check("a held arm is a hand on a button, however long", h.anyHeld() === true && h.secondsSincePress() >= 2.0);
  h.release("down");
  h.tick(0.5);
  check("and lets go when the hand does", h.anyHeld() === false);
  s.tick(-1);
  check("a negative frame does not turn it back", s.secondsSincePress() === 0);
}

console.log("PADPANEL  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
