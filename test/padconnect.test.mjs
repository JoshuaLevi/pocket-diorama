// The order in which a Bluetooth pad is connected, against Snap's own sample.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/padconnect.test.mjs [--selftest]
//
// This suite reads the vendored GameController as TEXT rather than importing
// it. The file carries a decorator and a Map<>, neither of which Node's type
// stripping accepts, so there is no way to run it here -- and the thing worth
// pinning is not a return value anyway. It is an ORDER, and getting it wrong
// is silent.
//
// The order, from Snap's GameController sample
// (specs-devs/context/packages/GameController):
//
//   predicate sees a device -> connectGatt -> onConnectionStateChangedEvent
//   -> state == Connected -> stopScan() -> getService(HID) -> characteristics
//   -> registerNotifications
//
// Every one of the last four happens INSIDE the Connected branch. Lens Studio
// 5.15.4 -- the version that builds the lens that goes on the glasses -- says
// why in its own StudioLib.d.ts: connectGatt is an "asynchronous call: to
// detect when the device is connected listen on the
// onConnectionStateChangedEvent". Awaiting connectGatt there does not mean
// connected. A copy that enumerates the service straight after the await asks
// a device that is not connected yet for its characteristics, gets nothing,
// and reports a pad that would not talk -- which is a true sentence about a
// bug in the caller.
//
// 5.23 is the other case: it has no Bluetooth.ConnectionState at all and
// connectGatt resolves only on success, so there the code after the await IS
// the connected path. Both have to be in the file, and the 5.15 one has to be
// preferred when both are possible.

const SELFTEST = process.argv.includes("--selftest");
const { readFileSync } = await import("node:fs");

const SRC = "Assets/Scripts/vendor/GameController/GameController.ts";
const src = readFileSync(SRC, "utf8");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/**
 * The same text with its comments removed.
 *
 * Every check below asks whether a CALL is present. The comments in that file
 * name the same calls while explaining why they are where they are, so a
 * reader that does not strip them fails on the prose -- which it did, on the
 * first run, on a comment saying "calls stopScan() there and nowhere else".
 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/** The body of one method, from its signature to the line that closes it. */
function methodBody(name) {
  const at = src.indexOf(name);
  if (at < 0) return "";
  const open = src.indexOf("{", at);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src.charAt(i);
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.substring(open, i + 1);
    }
  }
  return "";
}

// connectGATT is now a thin wrapper: it obtains a GATT object from a scan
// result and hands it to adoptConnection, which is where both routes into a
// connection meet -- a scanned pad and one connected to by address.
const connect = codeOnly(methodBody("private async adoptConnection("));
// openLink, not takeConnection: takeConnection is now the try/catch wrapper
// that makes sure nothing escapes into a swallowed rejection (see "nothing may
// escape taking a connection"), and openLink is the procedure these ORDER
// checks are about.
const take = codeOnly(methodBody("private async openLink("));
// The subscribe moved out of openLink on 10 September: registerNotifications
// blocks the main thread and twice never stopped, so it now runs only from a
// read that came back. See "the subscribe waits for the link to prove itself".
const subscribe = codeOnly(methodBody("private async subscribeToReports("));
const connected = take + "\n" + subscribe;

console.log("=== the three methods exist ===");
check("connectGATT is there",
      codeOnly(methodBody("private async connectGATT(")).length > 0);
check("adoptConnection is there", connect.length > 0);
check("takeConnection wraps the procedure",
      codeOnly(methodBody("private async takeConnection(")).length > 0);
check("and openLink is the procedure", take.length > 0);

console.log("=== discovery happens only where the sample puts it ===");
{
  // getService, getCharacteristics and registerNotifications are the sample's
  // Connected branch. None of them may sit in connectGATT, where they would
  // run against a link that 5.15 has not finished making.
  const forbidden = ["getService(", "getCharacteristics(", "registerNotifications("];
  for (const call of forbidden) {
    check("adoptConnection does not " + call, connect.indexOf(call) < 0);
    check("the connected path does " + call, connected.indexOf(call) >= 0);
  }
}

console.log("=== the scan stops on the connection, not on the sighting ===");
{
  // The sample keeps the radio looking while it connects and calls stopScan()
  // from the Connected branch. Stopping earlier throws away the one thing that
  // can still find the pad if the connection does not take.
  check("adoptConnection does not stop the scan", connect.indexOf("stopScan(") < 0);
  check("takeConnection does", take.indexOf("stopScan(") >= 0);
}

console.log("=== 5.15 is preferred, and 5.23 still works ===");
{
  check("the connection-state event is bound",
        connect.indexOf("onConnectionStateChangedEvent") >= 0);
  check("and its Connected value is what triggers discovery",
        connect.indexOf(".Connected") >= 0);
  check("the 5.23 disconnect event is bound too",
        connect.indexOf("onDisconnectedEvent") >= 0);

  // Preference: the 5.15 branch has to be tested FIRST, or a runtime carrying
  // both signals would take the path that assumes the await meant connected.
  const stateAt = connect.indexOf("onConnectionStateChangedEvent");
  const disconnectAt = connect.indexOf("onDisconnectedEvent");
  check("5.15's branch is tried before 5.23's", stateAt < disconnectAt,
        stateAt + " vs " + disconnectAt);

  // And the event can fire before anything is bound to it, which on 5.15 would
  // mean nothing ever arrives.
  check("an already-connected link is taken anyway",
        connect.indexOf("anyGatt.connectionState") >= 0);
}

console.log("=== the predicate connects and lets the radio look on ===");
{
  const scan = codeOnly(methodBody("async scanForControllers("));
  // Snap's GameController sample connects from inside the predicate and
  // returns nothing, so the scan carries on until the connection stops it.
  // Returning true on the sighting instead gives up the only thing that can
  // still find the pad when the connection does not take.
  check("the predicate connects", scan.indexOf("this.connectGATT(") >= 0);
  check("and never stops the scan by returning true",
        scan.indexOf("return true") < 0, scan.indexOf("return true"));
  // A predicate is not awaited, so a connection that throws is an unhandled
  // rejection unless it is caught right here.
  check("the connection is caught where it is started",
        scan.indexOf(".then(") >= 0 && scan.indexOf("this.connectGATT(") >= 0);

  // The BLE Playground sample: startScan's catch "Fires on calling
  // bluetoothModule.stopScan() AND on scan timing out". Taking a connection
  // calls stopScan, so success arrives in the catch as well.
  check("a scan ending after a link is not called a failure",
        scan.indexOf("this.linked || candidate") >= 0, scan);
}

console.log("=== a pad with no name in its advertisement is still a pad ===");
{
  // The fourth glasses test: "ik zie wel apparaten binnenkomen bij de scan
  // maar hij pakt de xbox controller niet". The scan filters on service
  // 0x1812, and then ALSO required the advertised name to contain "Xbox" --
  // two gates where the platform had already answered the only question that
  // matters. A BLE local name is optional and frequently lives in the scan
  // response, which a passive scan never asks for, so a pad that passed the
  // HID filter was thrown away for having no name.
  const scan = codeOnly(methodBody("async scanForControllers("));
  check("a nameless device on a FILTERED pass is taken",
        scan.indexOf("wanted") >= 0);
  check("...and only when the filters were actually up",
        scan.indexOf("!this.sweeping && !name") >= 0, scan);
  check("...and only if it can be connected to",
        scan.indexOf("isConnectable") >= 0);
  check("Microsoft's company id counts too", scan.indexOf("looksMicrosoft") >= 0);

  // A sweep has no filter, so a nameless device there is any device in the
  // room. Snap's guidance is explicit that discovery "must not connect to the
  // first arbitrary BLE device".
  const maker = codeOnly(methodBody("private looksMicrosoft("));
  check("the company id is Microsoft's", maker.indexOf("MICROSOFT_COMPANY_ID") >= 0);

  // And the layout is settled by asking the DEVICE, not the advertisement.
  const take = codeOnly(methodBody("private async openLink("));
  check("a device with no layout is asked its name over GATT",
        take.indexOf("this.nameOverGatt(") >= 0);
  const overGatt = codeOnly(methodBody("private async nameOverGatt("));
  check("which reads Generic Access", overGatt.indexOf("GENERIC_ACCESS_UUID") >= 0);
  check("and the Device Name characteristic", overGatt.indexOf("DEVICE_NAME_UUID") >= 0);
  check("a HID device we have no layout for is said out loud",
        take.indexOf("no layout for") >= 0);
}

console.log("=== the platform is asked for an Xbox pad by identity ===");
{
  // "Kunnen we met de controller niet actief zoeken naar een xbox controller
  // inplaats van algemeen bluetooth controllers" -- Joshua, 10 September.
  //
  // We can. startScan takes a LIST of filters and 5.15's own documentation
  // says "If a device passes ANY filter then the predicate will be invoked",
  // so they are alternatives and adding one only widens the net. A deviceName
  // filter is also the platform being told what to look FOR rather than us
  // sifting what turned up, which on most stacks means an active scan -- and
  // an active scan reads the scan RESPONSE, which is where a BLE local name
  // usually lives and what a passive scan never sees.
  const build = codeOnly(methodBody("private buildFilters("));
  check("there is a filter set", build.length > 0);
  check("the HID service is still asked for", build.indexOf("this.scanFilter") >= 0);
  check("Microsoft's company id is asked for",
        build.indexOf("manufacturerId = MICROSOFT_COMPANY_ID") >= 0, build);
  check("and each pad is asked for by name",
        build.indexOf("deviceName = ADVERTISED_NAMES[") >= 0, build);

  // One rejected property must cost one filter, not the scan: the service
  // filter alone is where this started and still has to work.
  const tries = build.split("try {").length - 1;
  check("every filter is built defensively", tries >= 2, "" + tries);

  // The names are whole names, because deviceName is an exact, case-sensitive
  // match -- unlike the substrings controllerFor uses on a result.
  const names = codeOnly(src.slice(src.indexOf("ADVERTISED_NAMES: string[]"),
                                   src.indexOf("ADVERTISED_NAMES: string[]") + 400));
  check("the Xbox pad is named in full",
        names.indexOf('"Xbox Wireless Controller"') >= 0, names);
  check("substring matching is still separate",
        codeOnly(methodBody("private controllerFor(")).indexOf("includes(") >= 0);

  // A sweep still asks for nothing, so it stays the honest "what is in the
  // room at all" measurement.
  const scanBody = codeOnly(methodBody("async scanForControllers("));
  check("a sweep uses no filters",
        scanBody.indexOf("this.sweeping ? [] : this.buildFilters()") >= 0, scanBody);
}

console.log("=== a pad can be connected to by address, with no scan at all ===");
{
  // The one open-source client that demonstrably drives an Xbox pad from a BLE
  // central (asukiaaa/esp32-client-for-xbox-controller-with-nim-ble) matches a
  // HARDCODED MAC address, and its service-UUID check is in the source,
  // commented out. That is the author having found that discovery is the
  // unreliable half -- and it is the only route left if the pad advertises in
  // a form the scanner cannot see at all. BLE 5 extended advertisements are
  // invisible to a legacy scanner: ADV_EXT_IND is not a PDU type the 4.x
  // specification defines.
  const direct = codeOnly(methodBody("public async connectToAddress("));
  check("there is a direct connect", direct.length > 0);
  check("it connects without scanning", direct.indexOf("connectGatt(") >= 0);
  check("...and never starts a scan", direct.indexOf("startScan(") < 0, direct);
  check("both byte orders are tried", direct.indexOf("reversed(") >= 0);
  check("and it lands in the same adopt path as a found pad",
        direct.indexOf("this.adoptConnection(") >= 0, direct);

  // One adopt path, so a direct connection is reported exactly like a found
  // one: same states, same panel, same log.
  const found = codeOnly(methodBody("private async connectGATT("));
  check("a scanned pad uses it too", found.indexOf("this.adoptConnection(") >= 0, found);

  // An address is only useful if the wearer can read one off the panel.
  const scanBody2 = codeOnly(methodBody("async scanForControllers("));
  check("every sighting carries its address",
        scanBody2.indexOf("addressText(result.deviceAddress)") >= 0, scanBody2);
}

console.log("=== the scan is asked for at START, as the sample asks ===");
{
  // Snap's SceneController calls scanForControllers() from onStart, not
  // onAwake. On the glasses this lens read an adapter status of 5 at onAwake,
  // and BluetoothStatus has four members numbered 0 to 3 in both 5.15 and
  // 5.23. A number outside its own enum is a module that has not finished
  // coming up.
  const { readFileSync } = await import("node:fs");
  const lensSrc = readFileSync("Assets/Scripts/PokemonAR.ts", "utf8");
  /** The same body reader as above, over the lens rather than the vendor. */
  function lensBody(name) {
    const at = lensSrc.indexOf(name);
    if (at < 0) return "";
    const open = lensSrc.indexOf("{", at);
    if (open < 0) return "";
    let depth = 0;
    for (let i = open; i < lensSrc.length; i++) {
      const c = lensSrc.charAt(i);
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return lensSrc.substring(open, i + 1); }
    }
    return "";
  }
  const awake = codeOnly(lensBody("onAwake(): void {"));
  const start = codeOnly(lensBody("private onStart(): void {"));
  check("onAwake is found", awake.length > 100, "" + awake.length);
  check("onStart is found", start.length > 20, "" + start.length);
  check("onAwake does not scan", awake.indexOf("beginScan()") < 0, awake.slice(0, 200));
  check("onStart asks for it", start.indexOf("this.startPadScan()") >= 0, start.slice(0, 200));
  check("and that is where beginScan is called",
        codeOnly(lensBody("private startPadScan(): void {")).indexOf("beginScan()") >= 0);
}

console.log("=== connectGatt can resolve NULL, and both paths check it ===");
{
  // The 5.15 log, verbatim, every five seconds for a day:
  //   BLE TEST: direct connect failed on order 0:
  //   TypeError: cannot read property 'onConnectionStateChangedEvent' of null
  //
  // connectGatt does not reject when it cannot connect. It RESOLVES WITH
  // NULL. 5.15's own declaration says the promise "is rejected if the
  // connection cannot be made" and on the device it is not -- and believing
  // the signature over the observation cost a day. This would have broken a
  // SCANNED connection in exactly the same way, so both paths check.
  const direct = codeOnly(methodBody("public async connectToAddress("));
  check("the direct path checks for null", direct.indexOf("if (!gatt)") >= 0, direct);
  const found = codeOnly(methodBody("private async connectGATT("));
  check("so does the scanned path", found.indexOf("if (!gatt)") >= 0, found);
  check("and the scanned path says so rather than throwing",
        found.indexOf("no GATT") >= 0, found);

  // The address path walked past the editor guard beginScan has had all along.
  check("the direct path is blocked in the editor too",
        direct.indexOf("this.adapterBlocked()") >= 0, direct);
}

console.log("=== a window running out is how a pass ENDS, not how it fails ===");
{
  // On 5.15 startScan rejects with "Scan failed: TIMEOUT" every time the
  // deadline passes -- which is how every pass ends. The counts and the
  // reasons lived below the try, so on the device they were unreachable and
  // the only thing a wearer ever saw was FAILED over a scan that had done
  // exactly what it was asked.
  const scanBody = codeOnly(methodBody("async scanForControllers("));
  check("a timeout is recognised", scanBody.indexOf("TIMEOUT") >= 0, scanBody);
  check("and ends the pass properly", scanBody.indexOf("this.endOfPass(") >= 0);

  const ending = codeOnly(methodBody("private endOfPass("));
  check("the pass says what it proved", ending.length > 0);
  check("with the count", ending.indexOf("advertisements") >= 0);
  check("and how many could be connected to at all",
        ending.indexOf("connectable") >= 0, ending);
  check("on the log AND the panel",
        ending.indexOf("this.log(") >= 0 && ending.indexOf("this.say(") >= 0);

  // Reached from both ends of a scan, not one.
  const calls = scanBody.split("this.endOfPass(").length - 1;
  check("both endings report", calls === 2, "" + calls);
}

console.log("=== the receiver listens continuously, and hears repeats ===");
{
  // A 1708 is the model Snap's own README names as supported, so "the glasses
  // cannot see this pad" needed a better answer than the radio. Balanced
  // DUTY-CYCLES the receiver -- listen, sleep, listen -- and a peripheral that
  // advertises rarely can fall into the gaps. Sixty seconds of Balanced over a
  // room with twenty-two devices found all twenty-two and never this pad.
  const ctor = codeOnly(methodBody("public constructor("));
  check("the scan mode is LowLatency", ctor.indexOf("ScanMode.LowLatency") >= 0, ctor);
  check("with a fallback for a runtime that lacks it",
        ctor.indexOf("ScanMode.Balanced") >= 0, ctor);

  // And uniqueDevices: on a filtered pass a device seen once is never heard
  // from again, so a first advertisement that was missed is missed for good.
  const scanBody = codeOnly(methodBody("async scanForControllers("));
  check("repeats are heard on a filtered pass",
        scanBody.indexOf("uniqueDevices = this.sweeping") >= 0, scanBody);
}

console.log("=== a HID host does four things, not one, and not five ===");
{
  // The pad connects, the HID service is found, characteristic 0x2A4D comes
  // back with properties [Read, Notify], registerNotifications SUCCEEDS -- and
  // no report ever arrives. HID-over-GATT gives a host more jobs than
  // subscribing, and a peripheral may stay silent until they are done:
  // read HID Information, read the Report Map, write Protocol Mode = Report,
  // subscribe. We did one of the four.
  //
  // The fifth, Control Point = Exit Suspend, was tried and is now forbidden.
  // See below.
  const host = codeOnly(methodBody("private becomeHidHost("));
  check("there is a host handshake", host.length > 0);
  check("the report map is read", host.indexOf("REPORT_MAP_UUID") >= 0, host);
  check("HID information is read", host.indexOf("HID_INFORMATION_UUID") >= 0);
  check("protocol mode is set to report",
        host.indexOf("PROTOCOL_MODE_UUID") >= 0 && host.indexOf("REPORT_PROTOCOL") >= 0,
        host);

  // Ordering is checked with `before`, which refuses to answer at all when
  // either side is missing. The first version of these two checks compared
  // raw indexOf results, and indexOf returns -1 for absent -- so "the
  // handshake runs before subscribing" was TRUE with no handshake at all, and
  // the mutation check caught the test rather than the code.
  const take = codeOnly(methodBody("private async openLink("));
  const subscribeBody = codeOnly(methodBody("private async subscribeToReports("));
  const before = (body, first, second) => {
    const a = body.indexOf(first);
    const b = body.indexOf(second);
    return a >= 0 && b >= 0 && a < b;
  };
  // The subscribe is no longer INSIDE openLink -- it is armed there and run
  // from the first read that comes back, because registerNotifications blocks
  // the main thread and twice never stopped. openLink still has to issue the
  // handshake before arming it, or the order on the wire is not HOGP's.
  check("the handshake is issued, and before the subscribe is armed",
        before(take, "this.becomeHidHost(", "this.pendingSubscribe ="), take);
  // ISSUED, never awaited. On this pad the reads hang and resolve only when
  // the link dies -- six cycles on 10 September, every one of them resolving
  // 12.1 seconds after `linked`, which is our own deadline closing the GATT.
  // Awaiting them meant the subscribe was never reached at all.
  check("...but not waited for",
        take.indexOf("await this.becomeHidHost(") < 0, take);
  check("the three requests still go out, in order",
        before(host, "HID_INFORMATION_UUID", "REPORT_MAP_UUID") &&
        before(host, "REPORT_MAP_UUID", "PROTOCOL_MODE_UUID"), host);
  check("and none of them is awaited", host.indexOf("await") < 0, host);
  check("...with their rejections handled", host.indexOf(".then(") >= 0, host);
  // NOTHING writes the HID Control Point, anywhere in the file.
  //
  // This is the only assertion in this suite that pins an ABSENCE, and it is
  // the one with the most evidence behind it. Every working link on
  // 10 September died exactly thirty seconds after it went ready, and the
  // rejection of this write landed in the same millisecond as the death:
  //
  //   15:07:45.912 ready ... 15:08:16.072 lost     30.16s
  //   17:43:52.453 ready ... 17:44:22.503 relink   30.05s
  //   18:20:06.606 ready ... 18:20:36.677 relink   30.07s
  //
  // Three links, three deaths, all at 30.0s. No link before the write was
  // added (8b06e18) ever got far enough to compare, and none after it lasted
  // longer. Thirty seconds is the GATT operation timeout below us: an
  // operation that never completes takes the connection with it when it
  // expires. The Control Point is Write Without Response in the spec, and
  // writeValue() is a write WITH response, so the pad is being waited on for
  // an ATT Write Response it is not required to send.
  //
  // Checked against the WHOLE file rather than one method body, because
  // moving the call somewhere else would be the obvious way to lose this.
  const code = codeOnly(src);
  check("nothing writes the HID control point",
        code.indexOf("0x2A4C") < 0 && code.indexOf("EXIT_SUSPEND") < 0 &&
        code.indexOf("HID_CONTROL_POINT") < 0, "0x2A4C is written somewhere");

  // Every step is best effort: a device that refuses one is telling us
  // something, and none of them is a reason to drop a link that might report.
  const writeOne = codeOnly(methodBody("private async writeHidByte("));
  check("a refused write is logged, not thrown",
        writeOne.indexOf("catch") >= 0 && writeOne.indexOf("refused") >= 0, writeOne);
}

console.log("=== a subscription is handed back when the link drops ===");
{
  // The 15:08 reconnect failed on "Operation failed, already registered": the
  // vendor stack still held the registration from a link that no longer
  // existed, so the fresh one was refused and the pad's input went to a
  // callback belonging to a dead connection. Without this a pad can be
  // connected to exactly once per lens run -- which is what "ik probeerde
  // opnieuw te connecten maar dit werkte niet" was.
  const release = codeOnly(methodBody("private releaseNotifications("));
  check("there is a release", release.length > 0);
  check("it unregisters", release.indexOf("unregisterNotifications()") >= 0, release);
  check("and forgets what it held", release.indexOf("this.subscribed = []") >= 0);
  check("one that refuses does not stop the rest",
        release.indexOf("catch") >= 0, release);

  const adopt = codeOnly(methodBody("private async adoptConnection("));
  check("a dropped link releases them", adopt.indexOf("this.releaseNotifications()") >= 0,
        adopt);

  const take = codeOnly(methodBody("private async openLink("));
  check("and a successful subscribe is remembered",
        codeOnly(methodBody("private async subscribeToReports(")).indexOf(
          "this.subscribed.push(") >= 0);
}

console.log("=== nothing may escape taking a connection ===");
{
  // 10 September, 16:42. The whole failure, and it produced ONE log line:
  //
  //   16:42:00.717  linked: Xbox Wireless Controller
  //
  // and then nothing, ever. gatt.getService() threw -- the same HostFunction
  // family as the getCharacteristic that patch 38 caught -- and the method it
  // threw out of is called from a connection-state listener with no await and
  // no catch. The rejection had nowhere to go, so it was swallowed whole: no
  // log, no error event, no state change. Meanwhile `linked` had already been
  // set true at the top, so every later Connected returned at the guard and
  // the pad was wedged for the rest of the run. The wearer saw a solid Xbox
  // logo and a game that ignored him.
  const take = codeOnly(methodBody("private async takeConnection("));
  check("takeConnection catches everything", take.indexOf("catch") >= 0, take);
  check("it delegates the body", take.indexOf("this.openLink(") >= 0, take);
  check("a throw hands the link back", take.indexOf("this.linked = false") >= 0, take);
  check("...and releases the subscription",
        take.indexOf("this.releaseNotifications()") >= 0, take);
  check("...and says so out loud", take.indexOf('this.say("error"') >= 0, take);

  // getService throws; it does not return null. The null check that was here
  // had already been shown to be the wrong shape for this API family.
  const open = codeOnly(methodBody("private async openLink("));
  const at = open.indexOf("getService(HID_SERVICE_UUID)");
  check("the HID service is still asked for", at >= 0, open);
  const around = open.slice(Math.max(0, at - 300), at + 300);
  check("but inside a try", around.indexOf("try") >= 0, around);
  check("and a failure to read it is not a verdict on the device",
        open.indexOf("this.linked = false") >= 0, open);

  // The listener cannot await, so it has to catch.
  const adopt = codeOnly(methodBody("private async adoptConnection("));
  const call = adopt.indexOf("this.takeConnection(gatt, name, controllerType)");
  check("the listener calls takeConnection", call >= 0, adopt);
  const after = adopt.slice(call, call + 260);
  check("...and handles its rejection", after.indexOf(".then(") >= 0, after);

  // And a link we have given up on is handed back, or the pad stays silent on
  // the air and the scan that follows can never find it.
  const release = codeOnly(methodBody("public releaseLink("));
  check("there is a way to give a link back", release.length > 0);
  check("it closes the connection", release.indexOf(".close()") >= 0, release);
  check("close, not disconnect -- unpairing is not what is meant",
        release.indexOf(".disconnect()") < 0, release);
  check("it forgets the GATT first, so the drop reports an honest loss",
        release.indexOf("this.gatt = null") >= 0, release);
  check("and hands the subscription back",
        release.indexOf("this.releaseNotifications()") >= 0, release);

  // A real subscription is announced, so the machine above knows the handshake
  // finished and can stop putting a clock on the link.
  check("a registration says so",
        codeOnly(methodBody("private async subscribeToReports(")).indexOf(
          'this.say("ready"') >= 0);
  const source = readFileSync("Assets/Scripts/play/InputSource.ts", "utf8");
  const routed = source.slice(source.indexOf("private onPadEvent("));
  check("the lens routes it", routed.indexOf('kind === "ready"') >= 0);
  check("...into the machine", routed.indexOf("this.scan.subscribedTo(") >= 0);
  // And the release is drained BEFORE the scan is asked for.
  const tick = source.slice(source.indexOf("  tick(dt: number): void {"));
  const rel = tick.indexOf("takeReleaseRequest()");
  const scan = tick.indexOf("takeScanRequest()");
  check("the link is handed back before a scan is started",
        rel >= 0 && scan >= 0 && rel < scan,
        "release at " + rel + ", scan at " + scan);
  check("through the vendor stack's own method",
        tick.indexOf("releaseLink(") >= 0, tick.slice(0, 900));
}

console.log("=== nothing subscribes on a link that has not answered ===");
{
  // registerNotifications blocks the main thread, and on a link that answers
  // nothing it has twice never stopped blocking it. Sixteen calls across one
  // afternoon, three returns, and the last two took the whole lens with them:
  //
  //   17:44:46.333  characteristic 0x2A4D properties [1,4]   <- end of log
  //   18:05:07.791  characteristic 0x2A4D properties [1,4]   <- end of log
  //
  // The AudioDriver heartbeat had been logging every four seconds and stops at
  // the same instant, which is what "de muziek stopte ineens en het startscherm
  // ging niet meer meebewegen" is. On the one link where it returned, it took
  // 534 ms with nothing else logged in between -- so it is not asynchronous in
  // any useful sense either.
  //
  // We cannot make the call safe. We can refuse to make it on a link that has
  // given us no reason to think it works, and a read that comes BACK is that
  // reason: on the connection that worked the reads returned, and on every one
  // that froze no read ever did.
  const host = codeOnly(methodBody("private becomeHidHost("));
  check("a read that comes back arms the subscribe",
        host.indexOf("this.subscribeToReports()") >= 0, host);
  check("...and only a successful one", host.indexOf("if (ok)") >= 0, host);
  check("...with its rejection handled", host.indexOf(".then(proven") >= 0, host);

  const read = codeOnly(methodBody("private async readHidValue("));
  check("a read reports whether it read anything",
        read.indexOf("return bytes ?") >= 0, read);
  check("...and a failure is false, not a throw",
        read.indexOf("return false") >= 0, read);

  const sub = codeOnly(methodBody("private async subscribeToReports("));
  check("the subscribe runs once per link", sub.indexOf("this.pendingSubscribe = null") >= 0, sub);
  check("...and does nothing without one armed", sub.indexOf("if (!pending)") >= 0, sub);
  // getCharacteristics is the same throwing API family as getService.
  check("the characteristics are read inside a try", sub.indexOf("try {") >= 0, sub);

  // A link that has gone takes its pending subscribe with it, or a read that
  // resolves late would subscribe on a connection that no longer exists.
  const src = readFileSync(SRC, "utf8");
  const armed = src.split("this.pendingSubscribe = null").length - 1;
  check("every path that gives up a link disarms it", armed >= 4, "found " + armed);
  const adopt = codeOnly(methodBody("private async adoptConnection("));
  check("...including a drop", adopt.indexOf("this.pendingSubscribe = null") >= 0, adopt);
  const release = codeOnly(methodBody("public releaseLink("));
  check("...and a release", release.indexOf("this.pendingSubscribe = null") >= 0, release);
}

console.log("=== a drop takes the same link back, without the radio ===");
{
  // Joshua, 10 September, after the fourth playtest: "ik moet constant de
  // controller opnieuw verbinden omdat de verbinding niet connected blijft."
  //
  // The pad drops its link every sixteen to thirty seconds and nothing in this
  // project has established why -- the likeliest reading is still an unbonded
  // link the peripheral abandons, and a Lens has no API to bond. What WAS in
  // this project's gift is the recovery. It used to be: report the loss, and
  // the machine above spends sixty seconds of LowLatency scanning looking for
  // an advertisement that only appears while a pairing button is held.
  //
  // 5.15's own StudioLib.d.ts has the primitive: BluetoothGatt.connect(),
  // "re-establish connection to the device". Same object, no scan, no
  // advertisement, no button.
  const relink = codeOnly(methodBody("private relink("));
  check("there is a relink", relink.length > 0);
  check("it re-establishes the SAME connection",
        relink.indexOf(".connect()") >= 0, relink);
  check("and never starts a scan",
        relink.indexOf("scanForControllers") < 0 && relink.indexOf("startScan") < 0,
        relink);
  check("a refused relink is not fatal", relink.indexOf("catch") >= 0, relink);
  check("and reports itself as a relink, not a loss",
        relink.indexOf('"relink"') >= 0 && relink.indexOf('"lost"') < 0, relink);

  // Bounded, or a pad that connects and never speaks spins here for ever.
  check("the attempts are bounded", relink.indexOf("RELINK_BUDGET") >= 0, relink);
  check("and the budget is a number the file states",
        /const RELINK_BUDGET: number = \d+;/.test(src));
  // ...but a link that DELIVERED INPUT earns a fresh budget, so a pad that
  // drops every twenty seconds relinks for as long as the wearer plays.
  check("a link that delivered input resets the budget",
        relink.indexOf("this.reports > this.reportsAtLink") >= 0, relink);

  // Only where a reconnection can be OBSERVED. The 5.23 path has a disconnect
  // signal and no connect signal at all, so a relink there is a call into the
  // dark.
  check("and only where the runtime can say it came back",
        relink.indexOf("this.relinkable") >= 0, relink);
  const adopt = codeOnly(methodBody("private async adoptConnection("));
  check("which is set inside the connection-state branch",
        adopt.indexOf("this.relinkable =") >= 0, adopt);
  check("the GATT object is kept for it", adopt.indexOf("this.gatt = gatt") >= 0, adopt);

  // The order matters: relink FIRST, and only report a loss if it could not.
  const drop = adopt.slice(adopt.indexOf("onDisconnected"));
  const release = drop.indexOf("this.releaseNotifications()");
  const tryRelink = drop.indexOf("this.relink(");
  const lost = drop.indexOf('"lost"');
  check("a drop hands the subscription back first",
        release >= 0 && tryRelink >= 0 && release < tryRelink,
        "release at " + release + ", relink at " + tryRelink);
  check("...then tries to take the link back",
        tryRelink >= 0 && lost >= 0 && tryRelink < lost,
        "relink at " + tryRelink + ", lost at " + lost);

  // And the lens has to be listening for the word. A vendor file that says
  // "relink" to a source that only knows "lost" would restart the scan it was
  // written to avoid -- silently, and only on hardware.
  const source = readFileSync("Assets/Scripts/play/InputSource.ts", "utf8");
  const routed = source.slice(source.indexOf("private onPadEvent("));
  check("the lens routes a relink", routed.indexOf('kind === "relink"') >= 0);
  check("...into the machine's own relinking state",
        routed.indexOf("this.scan.relinking(") >= 0);
  check("and still routes a real loss",
        routed.indexOf('kind === "lost"') >= 0 && routed.indexOf("this.scan.lost(") >= 0);
}

console.log("=== a write that never settles is not issued at all ===");
{
  // This block used to check that the control-point write was ISSUED and not
  // AWAITED, on the reasoning that a pending promise nobody waits on is
  // harmless. It is not harmless. The pending GATT operation is what kills the
  // link at thirty seconds -- see the absence check above for the three
  // measurements. Not awaiting it only hid that from this file.
  //
  // What is still worth pinning is the shape the reasoning left behind: every
  // request in the handshake is issued and none is awaited, because on this
  // pad a reply may never come.
  const host = codeOnly(methodBody("private becomeHidHost("));
  check("no request in the handshake is awaited", host.indexOf("await") < 0, host);
  const subscribe = codeOnly(methodBody("private async subscribeToReports("));
  check("and the subscribe writes nothing at all",
        subscribe.indexOf("this.writeHidByte") < 0, subscribe);
}

console.log("=== a link that never answered is never closed ===");
{
  // Both frozen runs of 10 September end on the log line printed immediately
  // above releaseLink's close(), and on nothing else:
  //
  //   23:28:05.746  link released: linked, but the pad never finished ...
  //   23:30:59.003  link released: linked, but the pad never finished ...
  //
  // No rejection of the pending reads, no `[pad] failed` line from the machine
  // above, no AudioDriver heartbeat three seconds later, and the glasses
  // dropped their tether a second later with the lens pegging two cores.
  //
  // A link that HAD answered closed fine on the same build: at 17:12:18 the
  // close returned in twenty milliseconds and rejected every outstanding
  // operation on the way out. So the guard is not "never close", it is "do not
  // call into a stack that has already stopped answering".
  const release = codeOnly(methodBody("public releaseLink("));
  check("there is a release", release.length > 0);
  check("it still closes", release.indexOf("close()") >= 0, release);
  check("...but only behind the answered guard",
        release.indexOf("this.answered") >= 0, release);
  const guard = release.indexOf("!this.answered");
  const close = release.indexOf("close()");
  check("the guard comes first, and returns", guard >= 0 && guard < close, release);

  // The flag has to MEAN something. Set on a read that came back and on a
  // report that arrived, cleared the moment a new link is taken -- a flag that
  // is never cleared would let one good link excuse every later bad one.
  const src = readFileSync(SRC, "utf8");
  const code = codeOnly(src);
  check("a read that came back sets it", code.indexOf("this.answered = true") >= 0);
  check("and a fresh link clears it", code.indexOf("this.answered = false") >= 0);
  const report = codeOnly(methodBody("private onReport("));
  check("a report sets it too", report.indexOf("this.answered = true") >= 0, report);
  const take = codeOnly(methodBody("private async openLink("));
  check("it is cleared where the link is taken, not somewhere else",
        take.indexOf("this.answered = false") >= 0, take);
}

console.log("=== the editor is never taken near the radio ===");
{
  // BleServiceHandler.ts:92 and eight more places in BLE Playground branch on
  // isEditor() before touching Bluetooth, because preview has no radio.
  const editor = codeOnly(methodBody("public inEditor("));
  check("there is an editor test", editor.indexOf("isEditor") >= 0);
  const ready = codeOnly(methodBody("public adapterReady("));
  check("and being ready requires not being in it",
        ready.indexOf("this.inEditor()") >= 0);
}

console.log("=== Unknown is not a refusal ===");
{
  // BluetoothStatus: Unknown 0, PermissionDenied 1, Unavailable 2, Available
  // 3. Unknown is documented as "the Bluetooth permissions or status have not
  // been established", and asking is what establishes them -- so a lens that
  // refuses to scan on Unknown never scans, and the permission is never
  // granted. That deadlock put "PAD: NO BLUETOOTH HERE" under the Game Boy
  // screen on the glasses with an Xbox pad sitting in pairing mode.
  const blocked = codeOnly(methodBody("public adapterBlocked("));
  check("there is a blocked test", blocked.length > 0);
  check("a refused permission blocks",
        blocked.indexOf("BLUETOOTH_PERMISSION_DENIED") >= 0);
  check("a missing radio blocks", blocked.indexOf("BLUETOOTH_UNAVAILABLE") >= 0);
  check("the editor blocks", blocked.indexOf("this.inEditor()") >= 0);
  check("but UNKNOWN does not", blocked.indexOf("BLUETOOTH_UNKNOWN") < 0,
        blocked);

  // And the status still has to be readable by the wearer: on the glasses the
  // pad panel is the only place that number exists.
  const problem = codeOnly(methodBody("public adapterProblem("));
  check("every answer carries its number", problem.indexOf("status ") >= 0);
}

console.log("=== taking a connection twice is not taking it twice ===");
{
  // onConnectionStateChangedEvent can fire more than once for one connection.
  check("takeConnection guards against a second entry",
        take.indexOf("this.linked") >= 0);
  check("and a fresh scan clears the guard",
        codeOnly(methodBody("async scanForControllers(")).indexOf("this.linked = false") >= 0);
}

console.log("=== an address typed by a human is read the way a human types it ===");
{
  // Phone scanners write addresses with colons, dashes or nothing, and a
  // wearer copying one across should not have to know which we wanted.
  const mod = await import("../Assets/Scripts/vendor/GameController/GameController.ts")
    .catch(() => null);
  if (mod && mod.addressText) {
    const bytes = new Uint8Array([0x0a, 0x1b, 0x2c, 0x3d, 0x4e, 0x5f]);
    check("bytes come back as an address", mod.addressText(bytes) === "0A:1B:2C:3D:4E:5F",
          mod.addressText(bytes));
    check("nothing is an empty string", mod.addressText(null) === "");
  } else {
    // The file carries a decorator and a Map<>, so Node may refuse it. The
    // structural checks above still hold; say so rather than passing silently.
    check("address helpers are in the source",
          src.indexOf("function parseAddress(") >= 0 &&
          src.indexOf("export function addressText(") >= 0);
    check("separators are stripped rather than required",
          codeOnly(methodBody("function parseAddress(")).indexOf('c >= "0"') >= 0);
    check("and a wrong length is refused",
          codeOnly(methodBody("function parseAddress(")).indexOf("hex.length !== 12") >= 0);
  }
}

if (SELFTEST) {
  // The body reader is what every check above stands on. If it silently
  // returned "" the forbidden-call checks would all pass by vacuum.
  check("SELFTEST a missing method reads as empty",
        methodBody("private async thisDoesNotExist(") === "");
  check("SELFTEST a real body is not empty and is balanced",
        take.charAt(0) === "{" && take.charAt(take.length - 1) === "}" &&
        take.length > 100, "" + take.length);
  // And that "absent from connectGATT" is not true of every string.
  check("SELFTEST connectGATT does contain what it should",
        codeOnly(methodBody("private async connectGATT(")).indexOf("connectGatt(") >= 0);
  // And that stripping comments is what makes the stopScan check mean
  // anything: the raw body names it in prose and would pass by accident.
  const raw = methodBody("private async adoptConnection(");
  check("SELFTEST comments would have hidden the stopScan check",
        raw.indexOf("stopScan(") >= 0 && connect.indexOf("stopScan(") < 0);
}

console.log("\nPADCONNECT  " + pass + " PASS  " + fail + " FAIL  " +
            (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
