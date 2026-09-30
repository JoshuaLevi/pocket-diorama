// The Bluetooth pad's own state, said out loud.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/padscan.test.mjs [--selftest]
//
// The pad had exactly one observable state: "starting scan...", and then
// nothing, for ever. The scan window was 10000 seconds -- two hours and
// forty-seven minutes -- so the promise never resolved; both failure paths
// wrote their reason into a private field and printed nothing; and the one
// function that spoke that field ran inside onUpdate behind six early
// returns, none of which are passed until the player is walking in the
// overworld. The wearer was standing on the title screen holding a pairing
// button. "The scan is still running" and "the scan was refused in the first
// millisecond" produced the same log and the same screen: silence.
//
// So the pad's state is a state machine now, and this is the suite that says
// it is never silent. Every state is reached through real transitions, and
// every state has to have something to SAY: a title, advice, and a log line,
// all non-empty, and a title no other state shares -- because a state that
// borrows another's words is a state you cannot tell apart, which is the bug
// this whole file exists about.
//
// Pure: no Lens Studio, no Bluetooth, no hardware. This says nothing about
// whether HID-over-GATT can reach Spectacles at all. It says that whatever
// happens, the lens says which thing happened.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const mod = await import("../Assets/Scripts/play/PadScan.ts");
const {
  PadScan,
  SCAN_IDLE, SCAN_NO_MODULE, SCAN_SCANNING, SCAN_SEEN, SCAN_CONNECTING,
  SCAN_LINKED, SCAN_LIVE, SCAN_RELINKING, SCAN_FAILED, SCAN_TIMED_OUT,
  SCAN_GAVE_UP,
  SCAN_STATES, SCAN_WINDOW_SECONDS, CONNECT_WINDOW_SECONDS,
  RELINK_WINDOW_SECONDS, LINK_WINDOW_SECONDS, RETRY_GAP_SECONDS, MAX_ATTEMPTS,
  SEEN_KEPT,
} = mod;

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/** Run the clock forward in small steps, the way a frame loop would. */
function run(scan, seconds) {
  const step = 0.1;
  for (let t = 0; t < seconds; t += step) {
    scan.tick(step);
  }
}

// ------------------------------------------------------------- reaching each state
//
// One builder per state, through the real transitions only. If a state can no
// longer be reached this way the suite fails to build it, which is the point:
// an unreachable state is a state that cannot be reported either.
const REACH = [
  [SCAN_IDLE, () => new PadScan()],
  [SCAN_NO_MODULE, () => { const s = new PadScan(); s.noModule("no bluetooth here"); return s; }],
  [SCAN_SCANNING, () => { const s = new PadScan(); s.scanStarted(); return s; }],
  [SCAN_SEEN, () => {
    const s = new PadScan(); s.scanStarted(); s.deviceSeen("Xbox Wireless Controller", -61); return s;
  }],
  [SCAN_CONNECTING, () => {
    const s = new PadScan(); s.scanStarted(); s.deviceSeen("Xbox Wireless Controller", -61);
    s.connecting("Xbox Wireless Controller"); return s;
  }],
  [SCAN_LINKED, () => {
    const s = new PadScan(); s.scanStarted(); s.deviceSeen("Xbox Wireless Controller", -61);
    s.connecting("Xbox Wireless Controller"); s.linked("Xbox Wireless Controller"); return s;
  }],
  [SCAN_LIVE, () => {
    const s = new PadScan(); s.scanStarted(); s.deviceSeen("Xbox Wireless Controller", -61);
    s.connecting("Xbox Wireless Controller"); s.linked("Xbox Wireless Controller");
    s.padReported(); return s;
  }],
  [SCAN_RELINKING, () => {
    const s = new PadScan(); s.scanStarted(); s.deviceSeen("Xbox Wireless Controller", -61);
    s.connecting("Xbox Wireless Controller"); s.linked("Xbox Wireless Controller");
    s.padReported(); s.relinking("Xbox Wireless Controller"); return s;
  }],
  [SCAN_FAILED, () => { const s = new PadScan(); s.scanStarted(); s.failed("scan refused"); return s; }],
  [SCAN_TIMED_OUT, () => {
    const s = new PadScan(); s.scanStarted(); run(s, SCAN_WINDOW_SECONDS + 1); return s;
  }],
  [SCAN_GAVE_UP, () => {
    const s = new PadScan();
    // Every attempt this session, each one timing out, each retry taken.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      s.scanStarted();
      run(s, SCAN_WINDOW_SECONDS + 1);
      run(s, RETRY_GAP_SECONDS + 1);
      s.takeScanRequest();
    }
    return s;
  }],
];

console.log("=== every state is reachable, and none of them is silent ===");
{
  check("the module names as many states as this suite reaches",
        SCAN_STATES.length === REACH.length,
        SCAN_STATES.length + " named, " + REACH.length + " reached");

  const titles = [];
  for (let i = 0; i < REACH.length; i++) {
    const want = REACH[i][0];
    const scan = REACH[i][1]();
    check("reaches " + want, scan.state() === want, scan.state());
    check(want + " is a state the module names", SCAN_STATES.indexOf(want) >= 0);

    const title = scan.title();
    const advice = scan.advice();
    const log = scan.logLine();
    check(want + " has a title", typeof title === "string" && title.length > 0, title);
    check(want + " has advice", typeof advice === "string" && advice.length > 0, advice);
    check(want + " has a log line", typeof log === "string" && log.length > 0, log);
    check(want + "'s log line names the state", log.indexOf(want) >= 0, log);

    const lines = scan.lines();
    check(want + " draws at least two lines", lines.length >= 2, "" + lines.length);
    let empty = 0;
    for (let j = 0; j < lines.length; j++) {
      if (typeof lines[j] !== "string" || lines[j].length === 0) empty++;
    }
    check(want + " draws no blank line", empty === 0, empty + " blank");

    // The state must be legible from the panel alone, not merely present in
    // the enum: two states that print the same first line are two states the
    // wearer cannot tell apart.
    check(want + "'s title is its own", titles.indexOf(title) < 0, title);
    titles.push(title);
  }
}

console.log("=== the fallback that already works is always on the panel ===");
{
  // A pinch is A, and the phone is the publishable controller. Whatever the
  // pad is doing -- especially when it is doing nothing -- the wearer must be
  // able to play. Saying so only in the failure states is saying it too late.
  for (let i = 0; i < REACH.length; i++) {
    const want = REACH[i][0];
    const scan = REACH[i][1]();
    const all = scan.lines().join(" | ").toUpperCase();
    check(want + " still offers the pinch", all.indexOf("PINCH") >= 0, all);
  }
}

// ------------------------------------------------------------------ transitions
console.log("=== the scan runs down, and stopping is visible ===");
{
  const scan = new PadScan();
  check("nothing has been asked for yet", scan.state() === SCAN_IDLE);
  check("...and no scan is wanted until someone asks", scan.takeScanRequest() === false);
  check("no attempt has been made", scan.attempt() === 0);

  scan.scanStarted();
  check("asking puts it in the scan", scan.state() === SCAN_SCANNING);
  check("that is attempt one", scan.attempt() === 1);
  check("the whole window is left", Math.abs(scan.secondsLeft() - SCAN_WINDOW_SECONDS) < 0.001,
        "" + scan.secondsLeft());

  run(scan, 5);
  const left = scan.secondsLeft();
  check("five seconds in, it says so", left > SCAN_WINDOW_SECONDS - 5.5 && left < SCAN_WINDOW_SECONDS - 4.5,
        "" + left);
  check("and the title counts it down", scan.title().indexOf("" + Math.ceil(left)) >= 0, scan.title());

  run(scan, SCAN_WINDOW_SECONDS);
  check("past the window it has stopped", scan.state() === SCAN_TIMED_OUT, scan.state());
  check("and the countdown is spent", scan.secondsLeft() === 0, "" + scan.secondsLeft());
}

console.log("=== what the radio saw, kept and shown ===");
{
  const scan = new PadScan();
  scan.scanStarted();
  check("nothing seen yet", scan.seen().length === 0);
  scan.deviceSeen("Xbox Wireless Controller", -61);
  check("one advertisement moves it on", scan.state() === SCAN_SEEN, scan.state());
  check("and is remembered", scan.seen().length === 1);
  check("with the name", scan.seen()[0].indexOf("Xbox") >= 0, scan.seen()[0]);
  check("and the signal", scan.seen()[0].indexOf("-61") >= 0, scan.seen()[0]);
  check("the panel shows it", scan.lines().join("|").indexOf("Xbox") >= 0, scan.lines().join("|"));

  // A BLE device need not advertise a name, and the first nameless one used to
  // end the whole attempt silently: deviceName.includes() on null throws inside
  // a promise nobody caught.
  scan.deviceSeen("", -70);
  check("a nameless device is still a device",
        scan.seen()[1].toUpperCase().indexOf("NO NAME") >= 0, scan.seen()[1]);
  check("an unknown signal does not print as a number",
        new PadScan().sighting("", null).indexOf("-") < 0, new PadScan().sighting("", null));

  for (let i = 0; i < 10; i++) {
    scan.deviceSeen("Device " + i, -50 - i);
  }
  check("only the last few are kept", scan.seen().length === SEEN_KEPT, "" + scan.seen().length);
  check("and they are the last ones",
        scan.seen()[SEEN_KEPT - 1].indexOf("Device 9") >= 0, scan.seen()[SEEN_KEPT - 1]);

  // Seeing something does not stop the clock: an advertisement from a phone is
  // not a pad, and the scan has to run out anyway.
  run(scan, SCAN_WINDOW_SECONDS + 1);
  check("a scan that saw things still times out", scan.state() === SCAN_TIMED_OUT, scan.state());
  check("and still lists what it saw", scan.seen().length === SEEN_KEPT);
}

console.log("=== connecting is not connected, and connected is not reporting ===");
{
  const scan = new PadScan();
  scan.scanStarted();
  scan.deviceSeen("Xbox Wireless Controller", -55);
  scan.connecting("Xbox Wireless Controller");
  check("connecting says so", scan.state() === SCAN_CONNECTING);
  check("...and is not live", scan.isLive() === false);
  check("the title names the device", scan.title().indexOf("Xbox") >= 0, scan.title());

  scan.linked("Xbox Wireless Controller");
  check("a GATT link is LINKED, not LIVE", scan.state() === SCAN_LINKED, scan.state());
  check("and still not live", scan.isLive() === false);
  // This is the distinction the old code could not draw: it called a
  // controller OBJECT connected, and the object exists the moment a matching
  // name is merely SEEN.
  check("the panel says what it is waiting for",
        scan.advice().toUpperCase().indexOf("PRESS") >= 0, scan.advice());

  // Patience, but EARNED. This used to be unconditional -- "a linked pad
  // nobody touches stays linked" -- and on 10 September that is what turned
  // one swallowed exception into a dead session: gatt.getService() threw
  // inside a fire-and-forget async call, so there was no log line and no
  // error, the vendor file's own `linked` flag stuck true, and this machine
  // sat on "linked reports=0" for as long as the wearer would look at it.
  //
  // The handshake is what buys the patience now. Until it lands there is a
  // clock; once something is actually subscribed the pad may lie still on a
  // table all evening, because that is a working pad with nobody's thumb on it.
  scan.subscribedTo("Xbox Wireless Controller");
  run(scan, 60);
  check("a SUBSCRIBED pad nobody touches stays linked",
        scan.state() === SCAN_LINKED, scan.state());

  scan.padReported();
  check("a report is what makes it live", scan.state() === SCAN_LIVE);
  check("and it says it is live", scan.isLive() === true);
  check("the title counts the reports", scan.title().indexOf("1") >= 0, scan.title());
  scan.padReported();
  scan.padReported();
  check("...and keeps counting", scan.title().indexOf("3") >= 0, scan.title());
}

console.log("=== a link that never becomes a pad is given back ===");
{
  // The 10 September wedge, in one suite.
  //
  //   16:42:00.717  linked: Xbox Wireless Controller
  //   16:42:04.642  [pad] linked try=1/3 seen=1 reports=0
  //   16:42:14.651  [pad] linked try=1/3 seen=1 reports=0
  //
  // Nothing after "linked". No handshake, no error, no loss. gatt.getService()
  // threw -- the same HostFunction family that patch 38 caught for
  // getCharacteristic -- inside a method called from an event listener with no
  // await and no catch, so the rejection went nowhere at all. The wearer's
  // report was "op de controller zie ik het xbox logo branden dus die moet
  // verbonden zijn, maar er gebeurt niks als ik op A klik".
  //
  // The vendor file is hardened separately (padconnect covers it). This is the
  // backstop: whatever goes wrong up there, a link that has not become a pad
  // ends by itself, like every other state in this machine.
  const linked = () => {
    const s = new PadScan();
    s.scanStarted();
    s.deviceSeen("Xbox Wireless Controller", -55);
    s.connecting("Xbox Wireless Controller");
    s.linked("Xbox Wireless Controller");
    return s;
  };

  const stuck = linked();
  run(stuck, LINK_WINDOW_SECONDS - 1);
  check("a fresh link is given time to shake hands",
        stuck.state() === SCAN_LINKED, stuck.state());
  check("and asks for nothing while it does", stuck.takeReleaseRequest() === false);
  run(stuck, 2);
  check("but a link that never does is given up",
        stuck.state() === SCAN_FAILED, stuck.state());
  check("and says why", stuck.reason().length > 0, stuck.reason());
  check("the reason reaches the panel",
        stuck.lines().join(" | ").indexOf(stuck.reason()) >= 0);

  // The order matters more than the giving up does. A connected BLE peripheral
  // does not advertise, so a scan that runs while we are still holding the pad
  // is a scan for something we are ourselves keeping silent -- which is
  // exactly why "logo brandt, niets gebeurt" could not recover on its own.
  const order = linked();
  run(order, LINK_WINDOW_SECONDS + 1);
  check("the link is handed back", order.takeReleaseRequest() === true);
  check("...once only", order.takeReleaseRequest() === false);
  check("and no scan is asked for in the same breath",
        order.takeScanRequest() === false);
  run(order, RETRY_GAP_SECONDS + 1);
  check("the scan comes after it", order.takeScanRequest() === true);

  // A handshake that lands stops the clock for good.
  const good = linked();
  run(good, LINK_WINDOW_SECONDS - 2);
  good.subscribedTo("Xbox Wireless Controller");
  run(good, 300);
  check("a subscribed link is never given up", good.state() === SCAN_LINKED, good.state());
  check("and never handed back", good.takeReleaseRequest() === false);
  good.padReported();
  check("and a report still makes it live", good.state() === SCAN_LIVE, good.state());

  // subscribedTo is about a LINK. It cannot resurrect a machine that has
  // already given up, or the late arrival of a handshake for a link that is
  // gone would put the panel back into a state the pad is not in.
  const late = linked();
  run(late, LINK_WINDOW_SECONDS + 1);
  late.subscribedTo("Xbox Wireless Controller");
  check("a handshake for a dead link changes nothing",
        late.state() === SCAN_FAILED, late.state());

  // The third way in, and the one that was missed the first time: the vendor
  // file reporting an error on a link it has already given up on. That is the
  // 16:42 failure exactly -- gatt.getService() threw, takeConnection now
  // catches it and says so -- and without this the machine would have gone
  // straight to a scan while still holding the pad.
  const errored = linked();
  errored.failed("the link could not be opened: Error: Exception in HostFunction");
  check("an error on a live link hands it back", errored.takeReleaseRequest() === true);
  check("...and lands in FAILED", errored.state() === SCAN_FAILED, errored.state());

  // ...but a failure with no link behind it has nothing to hand back.
  const scanning = new PadScan();
  scanning.scanStarted();
  scanning.failed("scan refused");
  check("a failed scan has no link to give up", scanning.takeReleaseRequest() === false);

  // And a relink that never lands hands the link back for the same reason.
  const gone = linked();
  gone.subscribedTo("Xbox Wireless Controller");
  gone.padReported();
  gone.relinking("Xbox Wireless Controller");
  run(gone, RELINK_WINDOW_SECONDS + 1);
  check("a relink that times out also hands the link back",
        gone.takeReleaseRequest() === true);
}

console.log("=== a drop is taken back, not started over ===");
{
  // 10 September, after the fourth playtest: "ik moet constant de controller
  // opnieuw verbinden omdat de verbinding niet connected blijft". The pad
  // drops its link every sixteen to thirty seconds and nothing in this project
  // has established why. What WAS in this project's gift was the recovery:
  // a drop used to mean a sixty-second LowLatency scan, twice a minute, with
  // the wearer holding a pairing button. GameController.relink() now calls
  // BluetoothGatt.connect() on the same object instead, and this is the state
  // the machine waits in while that lands.
  const live = () => {
    const s = new PadScan();
    s.scanStarted();
    s.deviceSeen("Xbox Wireless Controller", -55);
    s.connecting("Xbox Wireless Controller");
    s.linked("Xbox Wireless Controller");
    s.padReported();
    return s;
  };

  const back = live();
  back.relinking("Xbox Wireless Controller");
  check("a drop mid-play goes to RELINKING", back.state() === SCAN_RELINKING, back.state());
  check("and asks for no scan at all", back.takeScanRequest() === false);
  // Silent means silent. isSearching is what the pad's panel is gated on, and
  // a notice that appears twice a minute for one second is worse than the drop
  // it is reporting.
  check("and puts no panel up", back.isSearching() === false);
  check("it still says which pad, for the log", back.title().indexOf("Xbox") >= 0, back.title());

  // The link comes back: the vendor file's connection-state listener is still
  // bound to the same GATT object, so Connected arrives exactly as it did the
  // first time and the machine walks LINKED, then LIVE, on real events.
  const landed = live();
  landed.relinking("Xbox Wireless Controller");
  run(landed, 2);
  landed.linked("Xbox Wireless Controller");
  check("a relink that lands is linked again", landed.state() === SCAN_LINKED, landed.state());
  landed.padReported();
  check("and live on the first report", landed.state() === SCAN_LIVE, landed.state());
  check("with no scan ever asked for", landed.takeScanRequest() === false);

  // And it must not be able to hide a pad that has genuinely gone.
  const gone = live();
  gone.relinking("Xbox Wireless Controller");
  run(gone, RELINK_WINDOW_SECONDS - 1);
  check("a relink in flight is still waiting", gone.state() === SCAN_RELINKING, gone.state());
  run(gone, 2);
  check("but it has a deadline", gone.state() === SCAN_FAILED, gone.state());
  check("and says what ran out", gone.reason().length > 0, gone.reason());
  check("the reason reaches the panel",
        gone.lines().join(" | ").indexOf(gone.reason()) >= 0, gone.lines().join(" | "));
  // Through lost(), so the pad that HAS spoken gets its attempts back. A pad
  // that demonstrably exists is worth more chasing than one that never was.
  run(gone, RETRY_GAP_SECONDS + 1);
  check("and the scan behind it is offered", gone.takeScanRequest() === true);

  // The wearer pressing FIND PAD during a relink means "get on with it", not
  // "throw the link away and scan for a minute".
  const busy = live();
  busy.relinking("Xbox Wireless Controller");
  busy.rearm();
  check("FIND PAD does not disturb a relink", busy.state() === SCAN_RELINKING, busy.state());
  check("and asks for no scan", busy.takeScanRequest() === false);

  // A relink reported by a machine that never had a link is the vendor file
  // and this machine disagreeing about history. The machine's own is the one
  // the panel shows.
  const never = new PadScan();
  never.scanStarted();
  never.relinking("Xbox Wireless Controller");
  check("a relink with no link behind it is ignored",
        never.state() === SCAN_SCANNING, never.state());
}

console.log("=== a connect that never answers is a failure, not a silence ===");
{
  const scan = new PadScan();
  scan.scanStarted();
  scan.deviceSeen("Xbox Wireless Controller", -55);
  scan.connecting("Xbox Wireless Controller");
  run(scan, CONNECT_WINDOW_SECONDS + 1);
  check("connecting has a deadline too", scan.state() === SCAN_FAILED, scan.state());
  check("and a reason", scan.reason().length > 0, scan.reason());
  check("the reason reaches the panel",
        scan.lines().join(" | ").indexOf(scan.reason()) >= 0, scan.lines().join(" | "));
}

console.log("=== a report from nowhere is still a pad ===");
{
  // The vendor stack can deliver a HID report without us ever having observed
  // the seen/connecting/linked steps -- a reconnect to an already-bonded pad
  // does exactly that. A report is ground truth and outranks the story.
  const scan = new PadScan();
  scan.scanStarted();
  scan.padReported();
  check("a report straight out of a scan is live", scan.state() === SCAN_LIVE, scan.state());
}

console.log("=== the retry loop is bounded, and every step of it shows ===");
{
  const scan = new PadScan();
  scan.scanStarted();
  run(scan, SCAN_WINDOW_SECONDS + 1);
  check("first attempt timed out", scan.state() === SCAN_TIMED_OUT);
  check("no rescan wanted yet", scan.takeScanRequest() === false);
  check("the panel says which try this was", scan.title().indexOf("1") >= 0, scan.title());

  run(scan, RETRY_GAP_SECONDS + 0.5);
  check("after the gap it wants another scan", scan.takeScanRequest() === true);
  check("...once only", scan.takeScanRequest() === false);

  scan.scanStarted();
  check("which puts it back in the scan", scan.state() === SCAN_SCANNING);
  check("as attempt two", scan.attempt() === 2, "" + scan.attempt());
  check("and the title says so", scan.title().indexOf("2") >= 0, scan.title());

  run(scan, SCAN_WINDOW_SECONDS + 1);
  run(scan, RETRY_GAP_SECONDS + 0.5);
  check("a third is offered", scan.takeScanRequest() === true);
  scan.scanStarted();
  check("attempt three", scan.attempt() === MAX_ATTEMPTS, "" + scan.attempt());

  run(scan, SCAN_WINDOW_SECONDS + 1);
  run(scan, RETRY_GAP_SECONDS + 0.5);
  check("but there is no fourth", scan.takeScanRequest() === false);
  check("it gives up out loud", scan.state() === SCAN_GAVE_UP, scan.state());
  check("and never asks again", (() => {
    run(scan, 600);
    return scan.takeScanRequest() === false && scan.state() === SCAN_GAVE_UP;
  })());
  check("the panel names the working alternative",
        scan.lines().join(" | ").toUpperCase().indexOf("PHONE") >= 0, scan.lines().join(" | "));
}

console.log("=== a refusal is retried; no Bluetooth at all is not ===");
{
  const refused = new PadScan();
  refused.scanStarted();
  refused.failed("scan refused");
  check("a refusal is a failure", refused.state() === SCAN_FAILED);
  check("with its reason kept", refused.reason() === "scan refused", refused.reason());
  check("and the reason on the panel",
        refused.lines().join(" | ").indexOf("scan refused") >= 0, refused.lines().join(" | "));
  run(refused, RETRY_GAP_SECONDS + 0.5);
  check("a refusal is worth trying again", refused.takeScanRequest() === true);

  const dead = new PadScan();
  dead.noModule("no Bluetooth module on this device");
  check("no stack at all is its own state", dead.state() === SCAN_NO_MODULE);
  run(dead, 600);
  check("and is never retried", dead.takeScanRequest() === false);
  check("...and never changes", dead.state() === SCAN_NO_MODULE);
  check("the panel offers the pinch instead",
        dead.lines().join(" | ").toUpperCase().indexOf("PINCH") >= 0, dead.lines().join(" | "));
}

console.log("=== the count on the panel is what was SEEN, not what is kept ===");
{
  // The panel said "N SEEN" where N was the length of a list capped at
  // SEEN_KEPT, so a scan that saw four devices and one that saw forty both
  // read as the cap. That is precisely the difference between "the room is
  // quiet and your pad is not advertising" and "the room is full and yours is
  // not among the few still on screen".
  const scan = new PadScan();
  scan.scanStarted();
  for (let i = 0; i < SEEN_KEPT + 12; i++) {
    scan.deviceSeen("device " + i, -50 - i);
  }
  check("every sighting is counted", scan.seenCount() === SEEN_KEPT + 12,
        "" + scan.seenCount());
  check("only the last few are kept", scan.seen().length === SEEN_KEPT,
        "" + scan.seen().length);
  check("the title says the real number",
        scan.title().indexOf("" + (SEEN_KEPT + 12)) >= 0, scan.title());
  check("and so does the log line",
        scan.logLine().indexOf("seen=" + (SEEN_KEPT + 12)) >= 0, scan.logLine());

  // The kept list is the LAST few, because the newest sighting is the one the
  // wearer just caused by pressing a pairing button.
  const kept = scan.seen().join(" | ");
  check("the newest sighting is on the panel",
        kept.indexOf("device " + (SEEN_KEPT + 11)) >= 0, kept);
  check("the oldest is not", kept.indexOf("device 0 ") < 0, kept);
}

console.log("=== the panel only lives while something is happening ===");
{
  // The panel was gated on "not live", which on a lens with no controller is
  // for ever: "dit menu'tje met deze logs zitten constant in mn game en gaan
  // niet weg" (Joshua, 10 September).
  const idle = new PadScan();
  check("idle is not searching", idle.isSearching() === false);

  const scanning = new PadScan();
  scanning.scanStarted();
  check("a running scan is", scanning.isSearching());
  scanning.deviceSeen("Xbox Wireless Controller", -60);
  check("so is one that has seen something", scanning.isSearching());
  scanning.connecting("Xbox Wireless Controller");
  check("so is connecting", scanning.isSearching());
  scanning.linked("Xbox Wireless Controller");
  check("so is linked but silent", scanning.isSearching());
  scanning.padReported();
  check("a working pad is not something to watch", scanning.isSearching() === false);

  const spent = new PadScan();
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    spent.scanStarted();
    run(spent, SCAN_WINDOW_SECONDS + 1);
    run(spent, RETRY_GAP_SECONDS + 1);
  }
  check("and neither is a budget that ran out", spent.isSearching() === false,
        spent.state());

  const dead = new PadScan();
  dead.noModule("no radio here");
  check("nor a lens with no radio", dead.isSearching() === false);
}

console.log("=== a connection being made is not a connection that failed ===");
{
  // On 5.15 connectGatt returns before the device is connected -- its own
  // docs say to listen on onConnectionStateChangedEvent for that -- and what
  // happens in between includes bonding. The old fifteen-second deadline did
  // not detect a dead connection, it caused one.
  const s = new PadScan();
  s.scanStarted();
  s.deviceSeen("Xbox Wireless Controller", -58);
  s.connecting("Xbox Wireless Controller");
  run(s, 20);
  check("twenty seconds in, it is still connecting", s.state() === SCAN_CONNECTING,
        s.state());
  s.linked("Xbox Wireless Controller");
  check("and the link is allowed to arrive", s.state() === SCAN_LINKED, s.state());

  // Still bounded: a connection that never answers at all is still a failure.
  const dead = new PadScan();
  dead.scanStarted();
  dead.connecting("Xbox Wireless Controller");
  run(dead, CONNECT_WINDOW_SECONDS + 1);
  check("a connection that never answers still fails", dead.state() === SCAN_FAILED,
        dead.state());
}

console.log("=== a scan keeps looking, because the pad is not there yet ===");
{
  // The tutorial video says it in a caption on screen: "There is no
  // system-level pairing yet. This means you must wait till the lens loads
  // before you can pair the BLE controller to your specs!" So there is nothing
  // to find until the wearer holds the pairing button, and that is after the
  // lens is up. Snap's sample asks for a ten-thousand-second window for the
  // same reason. A budget of three assumed the pad was already there.
  const looking = new PadScan();
  looking.setUnbounded(true);
  for (let i = 0; i < MAX_ATTEMPTS + 5; i++) {
    looking.scanStarted();
    run(looking, SCAN_WINDOW_SECONDS + 1);
    run(looking, RETRY_GAP_SECONDS + 1);
    check("attempt " + (i + 1) + " does not give up", looking.state() !== SCAN_GAVE_UP,
          looking.state());
  }
  check("it is still asking for scans", looking.takeScanRequest() === true);

  // Bounded is still bounded, for anything that either answers or does not.
  const bounded = new PadScan();
  bounded.setUnbounded(false);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    bounded.scanStarted();
    run(bounded, SCAN_WINDOW_SECONDS + 1);
    run(bounded, RETRY_GAP_SECONDS + 1);
  }
  check("a bounded machine still gives up", bounded.state() === SCAN_GAVE_UP,
        bounded.state());

  // And a pad that HAS reported is a different thing from one never seen.
  const live = new PadScan();
  live.setUnbounded(true);
  live.scanStarted();
  live.deviceSeen("Xbox Wireless Controller", -55);
  live.connecting("Xbox Wireless Controller");
  live.linked("Xbox Wireless Controller");
  live.padReported();
  check("a working pad is not looked for", live.isSearching() === false, live.state());
}

console.log("=== a terminal state is terminal until the wearer says otherwise ===");
{
  // The whole budget is spent in the first seventy seconds of the lens: three
  // twenty-second windows and two five-second gaps. A wearer who is still
  // putting the glasses on, or who has not yet held the pad's pairing button,
  // has missed it -- and GAVE UP was terminal, so the pad was unreachable for
  // the rest of the session however the pad behaved. The machine still never
  // retries by ITSELF from a terminal state; it is the wearer who asks.
  const spent = new PadScan();
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    spent.scanStarted();
    run(spent, SCAN_WINDOW_SECONDS + 1);
    run(spent, RETRY_GAP_SECONDS + 1);
  }
  check("the budget runs out", spent.state() === SCAN_GAVE_UP, spent.state());
  run(spent, 600);
  check("and nothing brings it back on its own", spent.takeScanRequest() === false);

  spent.rearm();
  check("asking again leaves the terminal state", spent.state() !== SCAN_GAVE_UP, spent.state());
  check("and asks for a scan", spent.takeScanRequest() === true);
  spent.scanStarted();
  check("with the budget whole again", spent.attempt() === 1, "" + spent.attempt());
  check("and the countdown running", spent.state() === SCAN_SCANNING, spent.state());

  // The same for a lens that found no Bluetooth at all: in preview there is
  // none, on the glasses the permission prompt is answered AFTER the lens has
  // started, and "no Bluetooth here" was terminal for both.
  const dead = new PadScan();
  dead.noModule("no Bluetooth here: Lens Studio preview has no radio");
  check("no radio is still its own state", dead.state() === SCAN_NO_MODULE);
  dead.rearm();
  check("and it too can be asked again", dead.state() !== SCAN_NO_MODULE, dead.state());
  check("which asks for a scan", dead.takeScanRequest() === true);

  // A live pad is not a state to blow away: re-arming mid-session must not
  // drop a pad that is already reporting.
  const live = new PadScan();
  live.scanStarted();
  live.deviceSeen("Xbox Wireless Controller", -55);
  live.connecting("Xbox Wireless Controller");
  live.linked("Xbox Wireless Controller");
  live.padReported();
  live.rearm();
  check("a working pad is left alone", live.state() === SCAN_LIVE, live.state());
  check("and no scan is asked for", live.takeScanRequest() === false);
}

console.log("=== a pad that drops is not a pad that was never there ===");
{
  const scan = new PadScan();
  scan.scanStarted();
  scan.deviceSeen("Xbox Wireless Controller", -55);
  scan.connecting("Xbox Wireless Controller");
  scan.linked("Xbox Wireless Controller");
  scan.padReported();
  check("live", scan.isLive());

  scan.lost("device disconnected");
  check("losing it is a failure", scan.state() === SCAN_FAILED, scan.state());
  check("with the reason", scan.reason().indexOf("disconnected") >= 0, scan.reason());
  check("and it is not live any more", scan.isLive() === false);
  // A pad that has already spoken demonstrably exists, so the budget of
  // attempts starts over rather than being spent on a pad that walked out
  // of range for a moment.
  check("the attempts start over", scan.attempt() === 0, "" + scan.attempt());
  run(scan, RETRY_GAP_SECONDS + 0.5);
  check("and it goes looking again", scan.takeScanRequest() === true);
}

console.log("=== the panel changes only when something changed ===");
{
  const scan = new PadScan();
  const v0 = scan.stateVersion();
  run(scan, 1);
  check("an idle machine does not churn", scan.stateVersion() === v0);

  scan.scanStarted();
  const v1 = scan.stateVersion();
  check("a transition bumps it", v1 > v0);
  // The countdown is on the panel, so a second passing IS a change -- but a
  // frame passing is not, or the text rebuilds sixty times a second.
  run(scan, 0.2);
  check("a fifth of a second is not", scan.stateVersion() === v1, "" + scan.stateVersion());
  run(scan, 1.2);
  check("a whole second is", scan.stateVersion() > v1);
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // The silence detector is the only thing in this file that matters, so it
  // gets checked against a machine that IS silent. If this ever passes, the
  // loop above has stopped being able to fail and the suite proves nothing.
  const mute = { title: () => "", advice: () => "", logLine: () => "", lines: () => ["", "x"] };
  let caught = 0;
  if (!(typeof mute.title() === "string" && mute.title().length > 0)) caught++;
  if (!(typeof mute.advice() === "string" && mute.advice().length > 0)) caught++;
  if (!(typeof mute.logLine() === "string" && mute.logLine().length > 0)) caught++;
  const muteLines = mute.lines();
  let blanks = 0;
  for (let j = 0; j < muteLines.length; j++) { if (muteLines[j].length === 0) blanks++; }
  if (blanks > 0) caught++;
  check("SELFTEST a silent state would be caught four ways", caught === 4, "" + caught);

  // And that the reachability table is not quietly checking one state twice.
  const names = [];
  for (let i = 0; i < REACH.length; i++) { names.push(REACH[i][0]); }
  let dupes = 0;
  for (let i = 0; i < names.length; i++) {
    if (names.indexOf(names[i]) !== i) dupes++;
  }
  check("SELFTEST every state is reached exactly once", dupes === 0, "" + dupes);
}

console.log("\nPADSCAN  " + pass + " PASS  " + fail + " FAIL  " +
            (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
