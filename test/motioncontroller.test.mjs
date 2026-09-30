// Exercises the real MotionControllerSource under Node, with a fake phone.
//
// The Motion Controller does not exist in Lens Studio preview and cannot be
// driven from a keyboard on device, so without this the gesture model and -- far
// more importantly -- isConnected() would only ever be checked by walking around
// wearing the glasses. This project has already shipped one input source that
// reported "connected" with no hardware anywhere, won the router and swallowed
// every input; the checks below are what stop that happening twice.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/motioncontroller.test.mjs

// The lens runtime provides print(); Node does not.
globalThis.print = (...args) => {
  if (process.env.MC_TEST_VERBOSE) console.log("[lens]", ...args);
};

const { MotionControllerSource } = await import(
  "../Assets/Scripts/play/MotionControllerSource.ts"
);
const { InputRouter, ScriptedInputSource } = await import(
  "../Assets/Scripts/play/InputSource.ts"
);

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.log("  FAIL  " + name + (detail ? "  -- " + detail : ""));
  }
}

/** Nothing but an object: exactly what getController() hands back with no phone. */
function silentPhone() {
  return {
    touchHandler: null,
    stateHandler: null,
    haptics: [],
    onTouchEvent: { add(fn) { this.owner.touchHandler = fn; } },
    onControllerStateChange: { add(fn) { this.owner.stateHandler = fn; } },
    invokeHaptic(request) { this.haptics.push(request); },
  };
}

/** Builds a fake phone; `available` null means the query is missing entirely. */
function fakePhone(available) {
  const phone = silentPhone();
  phone.onTouchEvent.owner = phone;
  phone.onControllerStateChange.owner = phone;
  phone.available = available;
  if (available !== null) {
    phone.isControllerAvailable = () => phone.available;
  }
  return phone;
}

function makeSource(phone, options) {
  const opts = options || {};
  return MotionControllerSource.tryCreate(() => ({
    getController(o) {
      phone.optionsSeen = o;
      return opts.nullController ? null : phone;
    },
  }));
}

/** Sends a touch through the controller's own event, as the platform would. */
function touch(phone, x, y, id, ms, phase) {
  phone.touchHandler({ x, y }, id, ms, phase);
}
const BEGAN = 0, MOVED = 1, ENDED = 2, CANCELED = 3;

console.log("\n== tryCreate: every way there is no phone ==");
{
  check("a factory that throws yields null",
        MotionControllerSource.tryCreate(() => { throw new Error("no module"); }) === null);
  check("a factory that returns null yields null",
        MotionControllerSource.tryCreate(() => null) === null);
  check("a module with no getController yields null",
        MotionControllerSource.tryCreate(() => ({})) === null);
  const phone = fakePhone(true);
  check("a module whose getController returns null yields null",
        makeSource(phone, { nullController: true }) === null);
  check("a real module yields a source",
        makeSource(fakePhone(true)) !== null);
}

console.log("\n== isConnected: connected means REPORTING, not 'I hold an object' ==");
{
  // This is the Bluetooth pad's bug, asserted against directly.
  const phone = fakePhone(null); // no isControllerAvailable, no touches, ever
  const source = makeSource(phone);
  check("a controller object alone is not connected", source.isConnected() === false);
  for (let i = 0; i < 10; i++) source.update();
  check("and it is still not connected ten frames later", source.isConnected() === false);
  check("a silent source holds no direction",
        JSON.stringify(source.dpad()) ===
        JSON.stringify({ up: false, down: false, left: false, right: false }));
}
{
  const phone = fakePhone(false);
  const source = makeSource(phone);
  source.update();
  check("isControllerAvailable() false is not connected", source.isConnected() === false);
}
{
  const phone = fakePhone(true);
  const source = makeSource(phone);
  source.update();
  check("isControllerAvailable() true is connected", source.isConnected() === true);

  phone.available = false;
  source.update();
  check("a phone that goes away releases the router on the next frame",
        source.isConnected() === false);
}
{
  // A build with no availability query: only live touches count, and they decay.
  const phone = fakePhone(null);
  const source = makeSource(phone);
  source.update();
  check("no availability query and no touch: not connected", source.isConnected() === false);
  touch(phone, 0.5, 0.5, 0, 0, BEGAN);
  check("an arriving touch proves the phone is reporting", source.isConnected() === true);
  touch(phone, 0.5, 0.5, 0, 50, ENDED);
  for (let i = 0; i < 89; i++) source.update();
  check("a touch keeps it alive for the liveness window", source.isConnected() === true);
  source.update();
  check("and it goes silent again after the window", source.isConnected() === false);
}

console.log("\n== the D-pad: four ways, never diagonal ==");
{
  const phone = fakePhone(true);
  const source = makeSource(phone);
  const dir = (x, y) => {
    touch(phone, x, y, 1, 0, BEGAN);
    const state = source.dpad();
    touch(phone, x, y, 1, 10, ENDED);
    const names = [];
    if (state.up) names.push("up");
    if (state.down) names.push("down");
    if (state.left) names.push("left");
    if (state.right) names.push("right");
    return names.join("+") || "none";
  };
  check("the top of the screen is UP", dir(0.5, 0.05) === "up", dir(0.5, 0.05));
  check("the bottom is DOWN", dir(0.5, 0.95) === "down", dir(0.5, 0.95));
  check("the left is LEFT", dir(0.05, 0.5) === "left", dir(0.05, 0.5));
  check("the right is RIGHT", dir(0.95, 0.5) === "right", dir(0.95, 0.5));
  check("the centre is no direction at all", dir(0.5, 0.5) === "none", dir(0.5, 0.5));
  // An exact corner is a genuine tie between the axes -- and 0.95-0.5 and
  // 0.05-0.5 are not even equal in floating point -- so the contract is not which
  // one wins, it is that only ONE ever does.
  check("a corner picks one axis, never two", dir(0.95, 0.05).indexOf("+") < 0,
        dir(0.95, 0.05));
  check("an off-diagonal follows its dominant axis", dir(0.95, 0.35) === "right",
        dir(0.95, 0.35));
  check("just outside the dead zone still counts", dir(0.5, 0.3) === "up", dir(0.5, 0.3));
  check("just inside the dead zone does not", dir(0.5, 0.4) === "none", dir(0.5, 0.4));
}
{
  const phone = fakePhone(true);
  const source = makeSource(phone);
  touch(phone, 0.5, 0.05, 1, 0, BEGAN);
  check("a held finger keeps holding the direction", source.dpad().up === true);
  source.update();
  source.update();
  check("across frames, with no further events", source.dpad().up === true);
  touch(phone, 0.05, 0.5, 1, 100, MOVED);
  check("sliding to another edge turns the D-pad",
        source.dpad().left === true && source.dpad().up === false);
  touch(phone, 0.05, 0.5, 1, 200, ENDED);
  check("lifting releases it", source.dpad().left === false);
}

console.log("\n== the buttons ==");
{
  const phone = fakePhone(true);
  const source = makeSource(phone);
  touch(phone, 0.5, 0.5, 1, 1000, BEGAN);
  touch(phone, 0.5, 0.5, 1, 1100, ENDED);
  check("a press is not seen before update()", source.pressedA() === false);
  source.update();
  check("a quick tap in the centre is A", source.pressedA() === true);
  check("and not B", source.pressedB() === false);
  source.update();
  check("A lasts exactly one frame", source.pressedA() === false);

  touch(phone, 0.5, 0.5, 2, 2000, BEGAN);
  touch(phone, 0.5, 0.5, 2, 2400, ENDED);
  source.update();
  check("a 400ms hold in the centre is B", source.pressedB() === true);
  check("and not A", source.pressedA() === false);
  source.update();
  check("B lasts exactly one frame", source.pressedB() === false);

  touch(phone, 0.5, 0.05, 3, 3000, BEGAN);
  touch(phone, 0.5, 0.05, 3, 3010, ENDED);
  source.update();
  check("a tap outside the centre is a direction, not a button",
        source.pressedA() === false && source.pressedB() === false);

  touch(phone, 0.5, 0.5, 4, 4000, BEGAN);
  touch(phone, 0.05, 0.5, 4, 4100, MOVED);
  touch(phone, 0.05, 0.5, 4, 4200, ENDED);
  source.update();
  check("a press dragged out of the centre fires no button",
        source.pressedA() === false && source.pressedB() === false);

  touch(phone, 0.5, 0.5, 5, 5000, BEGAN);
  touch(phone, 0.5, 0.5, 5, 5100, CANCELED);
  source.update();
  check("a cancelled touch fires no button",
        source.pressedA() === false && source.pressedB() === false);
  check("and releases the D-pad", source.dpad().up === false);

  // START used to be a second finger anywhere, which a playtest could neither
  // see nor guess -- and with no way out of the nickname screen the run ended
  // there. Both it and SELECT are drawn corners now.
  touch(phone, 0.05, 0.5, 6, 6000, BEGAN);
  touch(phone, 0.95, 0.5, 7, 6050, BEGAN);
  source.update();
  check("a second finger is no longer START", source.pressedStart() === false);
  check("while the first finger keeps its direction", source.dpad().left === true);
  touch(phone, 0.95, 0.5, 7, 6100, ENDED);
  check("and the second finger's release does not steal the D-pad",
        source.dpad().left === true);
  touch(phone, 0.05, 0.5, 6, 6200, ENDED);
  check("the first finger's release does", source.dpad().left === false);

  touch(phone, 0.05, 0.95, 8, 7000, BEGAN);
  check("a corner holds no direction", source.dpad().left === false);
  touch(phone, 0.05, 0.95, 8, 7050, ENDED);
  source.update();
  check("the bottom-left corner is START", source.pressedStart() === true);
  check("and not A", source.pressedA() === false);
  source.update();
  check("START lasts exactly one frame", source.pressedStart() === false);

  touch(phone, 0.95, 0.95, 9, 8000, BEGAN);
  touch(phone, 0.95, 0.95, 9, 8050, ENDED);
  source.update();
  check("the bottom-right corner is SELECT", source.pressedSelect() === true);
  check("and not START", source.pressedStart() === false);

  // A long press on a corner is still that corner: only the centre reads the
  // clock, because only the centre has two buttons on one place.
  touch(phone, 0.05, 0.95, 10, 9000, BEGAN);
  touch(phone, 0.05, 0.95, 10, 9600, ENDED);
  source.update();
  check("a held corner is still START", source.pressedStart() === true);
  check("and never B", source.pressedB() === false);

  touch(phone, 0.05, 0.95, 11, 10000, BEGAN);
  touch(phone, 0.5, 0.5, 11, 10100, MOVED);
  touch(phone, 0.5, 0.5, 11, 10200, ENDED);
  source.update();
  check("a finger that slides off START fires nothing",
        source.pressedStart() === false && source.pressedA() === false);
}

console.log("\n== the platform's own enum values win over the declared order ==");
{
  // A build that numbers TouchPhase differently must still work; the source reads
  // the values off the global rather than trusting the order in StudioLib.d.ts.
  globalThis.MotionController = {
    TouchPhase: { Began: 10, Moved: 11, Ended: 12, Canceled: 13 },
    MotionType: { NoMotion: 7, ThreeDoF: 8, SixDoF: 9 },
    MotionControllerOptions: { create: () => ({ motionType: -1 }) },
    HapticFeedback: { Tick: 1, VibrationMedium: 6 },
    HapticRequest: { create: () => ({ hapticFeedback: -1, duration: -1 }) },
  };
  const phone = fakePhone(true);
  const source = makeSource(phone);
  // SixDoF, not NoMotion: the pad's picture is drawn where the phone is, which
  // needs its pose. Taken from the platform's own enum rather than assumed.
  check("options ask for SixDoF, taken from the platform's own enum",
        phone.optionsSeen && phone.optionsSeen.motionType === 9,
        JSON.stringify(phone.optionsSeen));
  touch(phone, 0.5, 0.05, 1, 0, 10);
  check("a Began of 10 is understood", source.dpad().up === true);
  touch(phone, 0.5, 0.05, 1, 10, 12);
  check("an Ended of 12 is understood", source.dpad().up === false);
  source.update();
  check("and the centre tap still maps to A on this build", source.pressedA() === false);

  console.log("\n== haptics ==");
  // The touches above buzzed too -- entering a zone ticks, and a centre tap
  // clicks -- because your thumb covers the pad it is pressing and the buzz is
  // the only thing that says which button it found. Count from where we are.
  const before = phone.haptics.length;
  check("the touch itself was felt", before > 0, before);
  source.update();
  source.hapticStep();
  check("a step ticks the phone", phone.haptics.length === before + 1);
  const step = phone.haptics[phone.haptics.length - 1];
  check("with the platform's Tick and a short duration",
        step.hapticFeedback === 1 && step.duration === 0.05, JSON.stringify(step));
  source.hapticEncounter();
  const bump = phone.haptics[phone.haptics.length - 1];
  check("an encounter buzzes harder",
        phone.haptics.length === before + 2 && bump.hapticFeedback === 6,
        JSON.stringify(bump));

  // Not reporting means BOTH signals gone: the platform says unavailable AND the
  // last touch has aged out. Either one alone still counts as evidence.
  phone.available = false;
  source.update();
  source.hapticStep();
  const live = phone.haptics.length;
  check("a touch seconds ago still counts as reporting", live === before + 3);
  for (let i = 0; i < 91; i++) source.update();
  check("but once both signals are gone the phone is silent",
        source.isConnected() === false);
  source.hapticStep();
  check("and a silent phone is not buzzed", phone.haptics.length === live);

  delete globalThis.MotionController;
  const bare = makeSource(fakePhone(true));
  bare.update();
  let threw = false;
  try {
    bare.hapticStep();
    bare.hapticEncounter();
  } catch (e) {
    threw = true;
  }
  check("and with no MotionController API at all, haptics are a no-op, not a throw",
        threw === false && bare.isConnected() === true);
}

console.log("\n== the router: the phone must not swallow the first tap ==");
{
  const scripted = new ScriptedInputSource();
  const phone = fakePhone(null); // silent: no availability query, no touches yet
  const source = makeSource(phone);
  const router = new InputRouter([source, scripted]);

  router.update();
  check("a silent phone does not win the router", router.activeName() === "scripted");

  // The tap arrives between frames, as a real one does.
  touch(phone, 0.5, 0.5, 1, 1000, BEGAN);
  touch(phone, 0.5, 0.5, 1, 1080, ENDED);
  router.update();
  check("the phone takes over on the frame its first tap is read",
        router.activeName() === "phone");
  check("and that first tap is not swallowed", router.pressedA() === true);

  for (let i = 0; i < 91; i++) router.update();
  check("a phone that stops answering hands the router back",
        router.activeName() === "scripted");
}

console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILURES") + ": " + passed + " passed, " + failed + " failed\n");
process.exit(failed === 0 ? 0 : 1);
