// The Bluetooth pad: whether the lens ever asks for one.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/gamepad.test.mjs [--selftest]
//
// This suite exists because of one missing line. `enableBleController` built the
// GameController singleton and stopped there -- and the package only scans by
// itself on DISCONNECT, which cannot happen before a first connection. So the
// flag turned on a source that could never report, however the pad was paired,
// while docs/CONTROLLERS.md said "it scans and connects" (true of Snap's sample,
// not of us). No amount of holding a pairing button finds that; the call simply
// was not there.
//
// What can be checked offline is exactly that: that asking for a pad ASKS.
// Whether HID-over-GATT reaches Spectacles at all is a hardware fact and this
// says nothing about it.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { GameControllerSource, InputRouter, ScriptedInputSource,
        PAD_UNAVAILABLE, PAD_SCANNING, PAD_CONNECTED, PAD_FAILED } =
  await import("../Assets/Scripts/play/InputSource.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/**
 * A controller that counts what it was asked to do.
 *
 * `buttons` is what getButtonState() answers: null models a pad that has not
 * connected, an object models one that has.
 */
function fakeController(options) {
  const o = options === undefined ? {} : options;
  const fake = {
    scans: 0,
    buttons: o.buttons === undefined ? null : o.buttons,
    scanForControllers() {
      this.scans++;
      if (o.throws) { throw new Error("no bluetooth"); }
      if (o.rejects) { return Promise.reject("scan refused"); }
      return Promise.resolve();
    },
    getButtonState() { return this.buttons; },
  };
  // The adapter the fake reports. Defaults to ready, because every test above
  // is about the pad rather than the permission; `adapter: false` models a
  // radio with no permission, which is what preview always is and what the
  // glasses are until the prompt has been answered.
  if (o.adapter !== undefined) {
    fake.ready = o.adapter;
    // `blocked` is a DEFINITIVE no -- permission refused, radio off, preview.
    // "Not established yet" is not one of those, and must not be treated as
    // one: see the Unknown test below.
    fake.blocked = o.blocked === true;
    fake.adapterReady = function () { return this.ready; };
    fake.adapterBlocked = function () { return this.blocked; };
    // Empty ONLY when the adapter is actually available, which is what the
    // real one does: "not granted yet" is a problem worth showing even though
    // it is not a refusal.
    fake.adapterProblem = function () {
      if (this.ready) { return ""; }
      return this.blocked
        ? "Bluetooth permission refused for this lens (status 1)"
        : "Bluetooth permission not granted yet (status 0)";
    };
    fake.sweeps = [];
    fake.setSweep = function (on) { this.sweeps.push(on); };
  }
  // Only a stack that can count HID reports gets asked for the count. Older
  // vendor drops cannot, and must keep working off "getButtonState answered".
  // A stack that can be told to connect to an address rather than search.
  if (o.address !== undefined) {
    fake.addresses = [];
    fake.addressWorks = o.address;
    fake.connectToAddress = function (a) {
      this.addresses.push(a);
      return Promise.resolve(this.addressWorks === true);
    };
  }
  if (o.reports !== undefined) {
    fake.reports = o.reports;
    fake.reportCount = function () { return this.reports; };
  }
  return fake;
}
const sourceOver = (controller) => GameControllerSource.tryCreate(() => controller);

console.log("=== a pad nobody asked for finds nothing ===");
{
  // The bug, as a test. Building the source is not asking for a pad.
  const hardware = fakeController();
  const pad = sourceOver(hardware);
  check("the source is built", pad !== null);
  check("...but nothing has been scanned for", hardware.scans === 0);
  check("and it says it is not available", pad.padState() === PAD_UNAVAILABLE,
        pad.padState());
  check("so it never wins the router", pad.isConnected() === false);
}

console.log("=== asking for one asks ===");
{
  const hardware = fakeController();
  const pad = sourceOver(hardware);
  check("beginScan reports it got that far", pad.beginScan() === true);
  check("...and the scan actually happened", hardware.scans === 1);
  check("it says it is looking", pad.padState() === PAD_SCANNING, pad.padState());
  // Looking is not having: a scanning source must still lose to the panel, or
  // it swallows every input while the character stands still.
  check("but looking is not connected", pad.isConnected() === false);
}

console.log("=== and a pad that answers is a pad ===");
{
  const hardware = fakeController();
  const pad = sourceOver(hardware);
  pad.beginScan();
  hardware.buttons = { a: false, b: false, start: false, view: false,
                       dUp: false, dDown: false, dLeft: false, dRight: false,
                       lx: 0, ly: 0 };
  pad.update();
  check("once the controller answers, it is connected", pad.isConnected());
  check("...and says so", pad.padState() === PAD_CONNECTED, pad.padState());

  // The buttons the game actually reads.
  hardware.buttons.dLeft = true;
  pad.update();
  check("left is left", pad.dpad().left && !pad.dpad().right);
  hardware.buttons.dLeft = false;
  hardware.buttons.lx = -0.9;
  pad.update();
  check("and the stick is too", pad.dpad().left);
  hardware.buttons.lx = -0.2;
  pad.update();
  check("a nudged stick is not", pad.dpad().left === false);

  hardware.buttons.a = true;
  pad.update();
  check("A fires once", pad.pressedA());
  pad.update();
  check("...and not again while held", pad.pressedA() === false);
  hardware.buttons.start = true;
  hardware.buttons.view = true;
  pad.update();
  check("START is the Menu button", pad.pressedStart());
  check("SELECT is View/Back", pad.pressedSelect());
}

console.log("=== a pad that has only been SEEN is not a pad ===");
{
  // The bug this section is written against lives in the vendor code. Its
  // predicate builds `new controller()` for any advertisement whose NAME
  // matches -- before connectGatt is even called -- and BaseController's own
  // constructor fills a complete, all-false ButtonState. So getButtonState()
  // answers an object the instant a pad is merely visible in the room, and
  // "answered" was the whole test for connected. The source then won the
  // router, and the D-pad, B and START went dead while the character stood
  // still: exactly the failure the comment on `everReported` warns about.
  //
  // A stack that can count its HID reports is asked for that count instead.
  const hardware = fakeController({
    buttons: { a: false, b: false, start: false, view: false,
               dUp: false, dDown: false, dLeft: false, dRight: false,
               lx: 0, ly: 0 },
    reports: 0,
  });
  const pad = sourceOver(hardware);
  pad.beginScan();
  for (let i = 0; i < 100; i++) { pad.update(); }
  check("a seen-but-silent pad is not connected", pad.isConnected() === false);
  check("...and still says it is scanning", pad.padState() === PAD_SCANNING,
        pad.padState());

  // And it must not win the router, which is where the damage actually happened.
  const fallback = new ScriptedInputSource();
  const router = new InputRouter([pad, fallback]);
  router.update();
  check("so the router does not hand it the game", router.activeName() === "scripted",
        router.activeName());

  // One real report is the difference.
  hardware.reports = 1;
  pad.update();
  check("one delivered report makes it a pad", pad.isConnected() === true);
  check("...and it says so", pad.padState() === PAD_CONNECTED, pad.padState());
  router.update();
  check("and only then does it take the game", router.activeName() === "gamepad",
        router.activeName());
}

console.log("=== the two ways it can fail ===");
{
  // Bluetooth missing outright: the call throws.
  const dead = fakeController({ throws: true });
  const pad = sourceOver(dead);
  check("a throwing scan is caught", pad.beginScan() === false);
  check("...and named", pad.padState() === PAD_FAILED, pad.padState());
  check("with a reason for the log", pad.problem().indexOf("bluetooth") >= 0,
        pad.problem());

  // Refused later: the promise rejects. This one is asynchronous, which is the
  // reason it needs catching in a second place at all.
  const refused = fakeController({ rejects: true });
  const two = sourceOver(refused);
  check("a refused scan still reports it got that far", two.beginScan() === true);
  check("...and is still scanning until the answer arrives",
        two.padState() === PAD_SCANNING, two.padState());
  await Promise.resolve();
  await Promise.resolve();
  check("and once refused, says so", two.padState() === PAD_FAILED, two.padState());
  check("with its reason", two.problem().indexOf("refused") >= 0, two.problem());
}

console.log("=== a radio that says no is not scanned; one that says nothing IS ===");
{
  // A definitive no: permission refused, the radio switched off, or Lens
  // Studio preview, which has no radio at all. Spending three attempts on any
  // of those is spending a budget the wearer needed on the glasses.
  const refused = fakeController({ adapter: false, blocked: true });
  const pad = sourceOver(refused);
  const asked = pad.beginScan();
  check("it does not scan a radio that said no", asked === false);
  check("and spends no attempt on it", refused.scans === 0, "" + refused.scans);
  check("it says so as a pad problem", pad.padState() === PAD_FAILED, pad.padState());
  check("with the permission named", pad.problem().indexOf("permission") >= 0,
        pad.problem());

  // The prompt is answered a few seconds into the lens. Nothing else happens;
  // the source has to notice by itself.
  refused.blocked = false;
  refused.ready = true;
  pad.tick(0.5);
  check("half a second later it has not looked yet", refused.scans === 0);
  pad.tick(0.6);
  check("a second later it scans", refused.scans === 1, "" + refused.scans);
  check("and says it is scanning", pad.padState() === PAD_SCANNING, pad.padState());
}

console.log("=== Unknown means not established yet, so it must be tried ===");
{
  // BluetoothStatus.Unknown is documented as "the Bluetooth permissions or
  // status have NOT been established". It is not a refusal, and refusing to
  // scan on it is a deadlock: asking is what establishes them, so a lens that
  // waits for Available before it asks waits for ever. That deadlock is
  // exactly what put "PAD: NO BLUETOOTH HERE" under the Game Boy screen on
  // the glasses, with the pad sitting there in pairing mode.
  const unknown = fakeController({ adapter: false, blocked: false });
  const pad = sourceOver(unknown);
  const asked = pad.beginScan();
  check("an unestablished permission is still tried", asked === true);
  check("and the scan is actually started", unknown.scans === 1, "" + unknown.scans);
  check("and it says it is scanning", pad.padState() === PAD_SCANNING, pad.padState());

  // ...and the wearer can still read what the adapter said, because on the
  // glasses the panel is the only place that number exists. A scan clears
  // `why`; this has to survive it.
  const shown = pad.report().lines().join(" | ");
  check("the adapter's answer is on the panel during the scan",
        shown.indexOf("permission") >= 0, shown);
}

console.log("=== a scan keeps looking, and alternates its filters ===");
{
  const hardware = fakeController({ adapter: true, blocked: false, rejects: true });
  const pad = sourceOver(hardware);
  pad.beginScan();
  // Well past what used to be the whole budget.
  for (let t = 0; t < 400; t += 0.1) { pad.tick(0.1); }
  const many = hardware.scans;
  check("it is still looking", many > 3, "" + many);
  check("and says so", pad.padState() === PAD_SCANNING, pad.padState());
  for (let t = 0; t < 200; t += 0.1) { pad.tick(0.1); }
  check("and keeps looking", hardware.scans > many, hardware.scans + " vs " + many);

  // Which is the tutorial's own instruction, in a caption on screen: "There is
  // no system-level pairing yet. This means you must wait till the lens loads
  // before you can pair the BLE controller to your specs!" A lens that has
  // stopped looking by the time the wearer is ready has answered a question
  // nobody asked.

  // And the sweep: the first attempt filters on HID, the ones after it do not,
  // so "nothing at all" and "nothing advertising 0x1812" stop being one word.
  check("the first attempt filtered on HID", hardware.sweeps[0] === false,
        JSON.stringify(hardware.sweeps));
  check("a later one sweeps everything", hardware.sweeps.indexOf(true) > 0,
        JSON.stringify(hardware.sweeps));
}

console.log("=== an address is used instead of a scan, and kept on retry ===");
{
  // The pad is reachable -- a laptop got a connection request from it -- but
  // no scan on the glasses ever sees it. connectGatt takes an address, so with
  // one given the lens should never scan; and when the attempt fails, it must
  // go back to the ADDRESS, not fall through to scanning for a pad we have
  // just been told cannot be found that way.
  const hardware = fakeController({ adapter: true, blocked: false, address: false });
  const pad = sourceOver(hardware);
  pad.connectDirectly("A0:B1:C2:D3:E4:F5");
  check("it connects by address", hardware.addresses.length === 1,
        JSON.stringify(hardware.addresses));
  check("and does not scan", hardware.scans === 0, "" + hardware.scans);

  // Let the failure land and the retry gap pass.
  for (let t = 0; t < 40; t += 0.1) { pad.tick(0.1); }
  check("a retry goes back to the address", hardware.addresses.length > 1,
        JSON.stringify(hardware.addresses));
  check("and still never scans", hardware.scans === 0, "" + hardware.scans);
  check("the address is the same one", hardware.addresses[1] === "A0:B1:C2:D3:E4:F5",
        hardware.addresses[1]);

  // ...and it is BOUNDED. The direct path never called scanStarted, so tries
  // stayed at zero, MAX_ATTEMPTS never tripped, and it retried every five
  // seconds for as long as the lens ran -- which is what the 5.15 log showed
  // for a day.
  for (let t = 0; t < 600; t += 0.1) { pad.tick(0.1); }
  const spent = hardware.addresses.length;
  for (let t = 0; t < 300; t += 0.1) { pad.tick(0.1); }
  check("the attempts run out", hardware.addresses.length === spent,
        hardware.addresses.length + " vs " + spent);
  // ...and then it hands over to the scan. The address is the shortcut for
  // when discovery cannot find the pad; it must not become the reason
  // discovery is never tried.
  check("a spent address falls back to looking", hardware.scans > 0,
        "" + hardware.scans);

  // One that answers is a pad like any other.
  const good = fakeController({ adapter: true, blocked: false, address: true,
                                reports: 0 });
  const live = sourceOver(good);
  live.connectDirectly("A0:B1:C2:D3:E4:F5");
  check("a working address scans nothing either", good.scans === 0);
}

console.log("=== the stick points the way the wearer pushed it ===");
{
  // Found the only way it could be: a pad live on the glasses and someone
  // walking the wrong way. "Ik merkte wel dat de linker joystick de up en
  // down movement andersom hebben" -- Joshua, 10 September.
  const hardware = fakeController({
    adapter: true, blocked: false, reports: 5,
    buttons: { lx: 0, ly: -1, dUp: false, dDown: false, dLeft: false, dRight: false },
  });
  const pad = sourceOver(hardware);
  pad.update();
  check("stick pushed to negative Y is UP", pad.dpad().up === true,
        JSON.stringify(pad.dpad()));
  check("...and not down", pad.dpad().down === false);

  hardware.buttons = { lx: 0, ly: 1, dUp: false, dDown: false, dLeft: false, dRight: false };
  pad.update();
  check("stick pushed to positive Y is DOWN", pad.dpad().down === true,
        JSON.stringify(pad.dpad()));
  check("...and not up", pad.dpad().up === false);

  // The D-pad was always right, so it must stay right.
  hardware.buttons = { lx: 0, ly: 0, dUp: true, dDown: false, dLeft: false, dRight: false };
  pad.update();
  check("the D-pad still reads straight", pad.dpad().up === true && pad.dpad().down === false,
        JSON.stringify(pad.dpad()));

  // And X is untouched: only the Y axis was reversed.
  hardware.buttons = { lx: 1, ly: 0, dUp: false, dDown: false, dLeft: false, dRight: false };
  pad.update();
  check("positive X is RIGHT", pad.dpad().right === true && pad.dpad().left === false,
        JSON.stringify(pad.dpad()));
}

console.log("=== no stack at all ===");
{
  // Preview, and any device without Experimental APIs. tryCreate hands back
  // null and the lens must simply not have a pad, rather than throwing.
  check("no controller means no source", sourceOver(null) === null);
  const thrown = GameControllerSource.tryCreate(() => { throw new Error("nope"); });
  check("and a throwing factory means the same", thrown === null);
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // The shape of the bug: a source that holds hardware and never reports must
  // never count as connected, or it wins the router and swallows the game.
  const quiet = sourceOver(fakeController());
  quiet.beginScan();
  for (let i = 0; i < 100; i++) { quiet.update(); }
  check("SELFTEST a silent pad is still not connected after 100 frames",
        quiet.isConnected() === false);
  check("SELFTEST and reports nothing pressed",
        !quiet.pressedA() && !quiet.pressedB() && !quiet.pressedStart());
}

console.log("\nGAMEPAD  " + pass + " PASS  " + fail + " FAIL  " +
            (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
