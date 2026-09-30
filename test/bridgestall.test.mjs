// A bundle transfer that stops halfway has to say so.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/bridgestall.test.mjs [--selftest]
//
// Joshua, 10 September: "de wereld kon niet opgehaald worden... uiteindelijk
// leek het alsof de gehele lens vast aan het lopen was."
//
// It was not the lens. It was the bridge, and the failure has no signal of its
// own. Two frames arrived truncated:
//
//   17:44:25.188  bad frame from bridge: 10964 chars starting stWarp":1},{"x":11,"
//   17:44:25.422  bad frame from bridge: 9016 chars starting ,"CeruleanGym":{"2":
//
// Both start MID-JSON, which is a receiver whose framing has come apart. And a
// WebSocket whose framing has come apart does not recover: every byte after it
// is read at the wrong offset, so the rest of the bundle AND the bundleEnd
// that would have completed it were gone. The socket stayed open. Nothing
// errored. The wearer sat on "Receiving world 92%" for ever, with the diorama
// placer still logging twice a second underneath -- a lens that looks frozen
// and is only waiting.
//
// The cause is fixed in tools/devserver/serve.mjs, which now respects
// backpressure instead of writing 1.7 MB in 471 ms. This suite is the backstop
// on the other side, because the next thing to mangle a frame will not be a
// thing we wrote.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};
globalThis.global = globalThis;
globalThis.global.deviceInfoSystem = { isEditor: () => true };
globalThis.global.persistentStorageSystem = { store: null };

const { BridgeWorldSource } = await import("../Assets/Scripts/world/WorldSource.ts");
const { readFileSync } = await import("node:fs");

/** errors[i], or "" -- never a throw, so a failed check cannot kill the run. */
function said(list, i) {
  return typeof list[i] === "string" ? list[i] : "";
}

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/** A source with a fake socket, and a record of everything it reported. */
function bridge() {
  const seen = { progress: [], errors: [], ready: [], closed: 0 };
  const source = new BridgeWorldSource({}, "ws://test", "kanto");
  // connect() would need an InternetModule; the transfer state is what is
  // under test, so the socket is stubbed and the callbacks are wired by hand
  // exactly as connect() wires them.
  source.socket = { send: () => {}, close: () => { seen.closed++; } };
  const callbacks = {
    onProgress: (f, m) => seen.progress.push([f, m]),
    onError: (m) => seen.errors.push(m),
    onReady: (t) => seen.ready.push(t),
  };
  source.watching = callbacks;
  source.settled = false;
  source.quietFor = 0;
  source.silentFor = 0;
  return { source, seen, callbacks };
}

/** Feeds one bridge message in, the way onmessage does. */
function feed(b, object) {
  b.source.handleMessage(JSON.stringify(object), b.callbacks);
}

/** Runs the watchdog for `seconds`, a frame at a time. */
function run(b, seconds) {
  for (let t = 0; t < seconds; t += 0.05) {
    b.source.tick(0.05);
  }
}

console.log("=== a bridge that never answers at all ===");
{
  // The hole the stall watchdog could not see. It armed only once a catalog
  // had set expectedChunks, so a bridge that was not RUNNING left nothing
  // counting down: on 10 September the devserver died between two playtests
  // and the two runs after it sat in the setup wizard for forty-five and
  // eighty-three seconds, placer ticking twice a second, no world, no title
  // screen, no audio, and not a word about why. "De game liep weer vast."
  // It had not. It was waiting for a machine that was not there.
  const b = bridge();
  run(b, BridgeWorldSource.SILENT_SECONDS - 1);
  check("a bridge that is merely slow is left alone", b.seen.errors.length === 0,
        said(b.seen.errors, 0));
  run(b, 2);
  check("but silence has a deadline", b.seen.errors.length === 1,
        String(b.seen.errors.length));
  check("...and the message names the address and asks the useful question",
        said(b.seen.errors, 0).indexOf("ws://test") >= 0 &&
        said(b.seen.errors, 0).indexOf("is it running?") >= 0,
        said(b.seen.errors, 0));
  check("the socket is closed on the way out", b.seen.closed === 1);
  // Once. A deadline that reported every frame after it would bury the panel.
  run(b, 30);
  check("and it is said once", b.seen.errors.length === 1,
        String(b.seen.errors.length));
}

console.log("=== connect() starts both clocks from zero ===");
{
  // A retry reuses the source, so a clock left running from the attempt before
  // would fail the new one on its first frame. The harness elsewhere in this
  // file sets these fields by hand and therefore cannot see that -- a mutation
  // removing the reset passed every other check in this suite.
  //
  // connect() assigns the four fields BEFORE it touches the internet module,
  // so a module whose createWebSocket throws still runs the part under test.
  const source = new BridgeWorldSource(
    { createWebSocket: () => { throw new Error("no module"); } }, "ws://test", "kanto");
  source.silentFor = 999;
  source.quietFor = 999;
  const errors = [];
  source.connect({ onProgress: () => {}, onError: (m) => errors.push(m), onReady: () => {} });
  check("the silence clock is back to zero", source.silentFor === 0, String(source.silentFor));
  check("and so is the stall clock", source.quietFor === 0, String(source.quietFor));
  check("a module that cannot open a socket is reported, not thrown",
        errors.length === 1 && said(errors, 0).indexOf("cannot open") >= 0,
        said(errors, 0));
}

console.log("=== a catalog hands the watch from one clock to the other ===");
{
  // Before the catalog the SILENCE deadline is counting; after it, the STALL
  // deadline is. The handover matters: a bundle that has begun arriving must
  // not be failed by a clock that was measuring whether the bridge exists.
  //
  // The first rewrite of this block asserted `errors.length >= 0` and
  // `<= 1`, which are true of every possible outcome. A check that cannot
  // fail is worse than no check, because it reads like cover.
  const b = bridge();
  run(b, BridgeWorldSource.SILENT_SECONDS - 1);
  feed(b, { type: "bundleStart", chunks: 4 });
  check("a transfer that has just started is not stalled",
        b.seen.errors.length === 0, said(b.seen.errors, 0));
  // Past the SILENCE deadline, and nothing happens: that clock is off now.
  run(b, 2);
  check("and the silence deadline no longer applies to it",
        b.seen.errors.length === 0, said(b.seen.errors, 0));
  // But the STALL deadline does, and it is the one that speaks.
  run(b, BridgeWorldSource.STALL_SECONDS + 1);
  check("the stall deadline takes over", b.seen.errors.length === 1,
        String(b.seen.errors.length));
  check("...and it is the stall message, not the silence one",
        said(b.seen.errors, 0).indexOf("0/4") >= 0 &&
        said(b.seen.errors, 0).indexOf("is it running?") < 0,
        said(b.seen.errors, 0));
}

console.log("=== a transfer that stops halfway is a failure ===");
{
  const b = bridge();
  feed(b, { type: "bundleStart", chunks: 4 });
  feed(b, { type: "chunk", index: 0, data: "a" });
  feed(b, { type: "chunk", index: 1, data: "b" });

  run(b, BridgeWorldSource.STALL_SECONDS - 1);
  check("silence inside the window is patience", b.seen.errors.length === 0);
  run(b, 2);
  check("silence past it is a failure", b.seen.errors.length === 1, b.seen.errors.join(" | "));
  // Read through a helper, not by index. The first version of this line was
  // `b.seen.errors[0].indexOf(...)`, which throws when the check above has
  // just failed -- so a mutation that stopped the watchdog firing took the
  // whole suite down with a TypeError instead of printing which checks failed
  // and a summary line. A test that crashes reports nothing.
  check("and it says how far it got",
        said(b.seen.errors, 0).indexOf("2/4") >= 0, said(b.seen.errors, 0));
  check("the socket is closed, so the retry starts clean", b.seen.closed === 1);
  // Once. A watchdog that keeps firing would restart the wizard's retry clock
  // every six seconds for the rest of the session.
  run(b, 60);
  check("...and it fires once", b.seen.errors.length === 1, b.seen.errors.length);
}

console.log("=== any frame at all resets the clock ===");
{
  const b = bridge();
  feed(b, { type: "bundleStart", chunks: 100 });
  for (let i = 0; i < 20; i++) {
    run(b, BridgeWorldSource.STALL_SECONDS - 1);
    feed(b, { type: "chunk", index: i, data: "x" });
  }
  check("a slow transfer is never given up on", b.seen.errors.length === 0);

  // Including a frame that does not parse. A truncated frame means the
  // transfer is in trouble; it does not mean the bridge has gone away, and
  // the watchdog is about SILENCE.
  const c = bridge();
  feed(c, { type: "bundleStart", chunks: 4 });
  run(c, BridgeWorldSource.STALL_SECONDS - 1);
  c.source.handleMessage('stWarp":1},{"x":11,"', c.callbacks);
  check("a bad frame is reported", c.seen.errors.length === 1, c.seen.errors.join(" | "));
  check("...and is still proof of life",
        said(c.seen.errors, 0).indexOf("bad frame") >= 0, said(c.seen.errors, 0));
  run(c, 2);
  check("so the watchdog holds off", c.seen.errors.length === 1);
  run(c, BridgeWorldSource.STALL_SECONDS);
  check("but only until the next silence", c.seen.errors.length === 2,
        c.seen.errors.join(" | "));
}

console.log("=== a finished transfer is not watched ===");
{
  const b = bridge();
  feed(b, { type: "bundleStart", chunks: 2 });
  feed(b, { type: "chunk", index: 0, data: "he" });
  feed(b, { type: "chunk", index: 1, data: "llo" });
  feed(b, { type: "bundleEnd" });
  check("it arrives", b.seen.ready.length === 1 && b.seen.ready[0] === "hello",
        JSON.stringify(b.seen.ready));
  run(b, 120);
  check("and is never reported stalled afterwards", b.seen.errors.length === 0,
        b.seen.errors.join(" | "));
}

console.log("=== the bridge does not write faster than the socket drains ===");
{
  // The cause, on the other side. 103 chunks -- 1.7 MB -- went out in 471 ms
  // with socket.write's return value ignored 103 times in a row. The two
  // previous answers to this were "make the chunks smaller": 48 KiB failed on
  // 7 September and 16 KiB failed on 10 September. The size was never it.
  const serve = readFileSync("tools/devserver/serve.mjs", "utf8");
  check("there is a drain-aware send", serve.indexOf("sendSlowly") > 0);
  check("it waits on drain", serve.indexOf('socket.once("drain"') > 0);
  check("and it checks what write said",
        serve.indexOf("if (socket.write(") > 0, "");
  const loop = serve.slice(serve.indexOf('parsed.type === "getBundle"'));
  const body = loop.slice(0, loop.indexOf("} else {"));
  check("every chunk goes out through it",
        body.indexOf("await sendSlowly({ type: \"chunk\"") > 0, body);
  check("...and so does the end, or the last frame races the ones before it",
        body.indexOf("await sendSlowly({ type: \"bundleEnd\"") > 0, body);
  check("nothing in the bundle loop uses the unguarded send",
        body.indexOf("send({ type: \"chunk\"") < 0, body);
}

const label = "BRIDGESTALL  " + pass + " PASS  " + fail + " FAIL";
console.log(label + (fail === 0 ? "  OK" : "  BROKEN"));
if (SELFTEST && fail > 0) process.exit(1);
