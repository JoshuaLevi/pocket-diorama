// The first run: what the lens says when there is no world.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/setupwizard.test.mjs [--selftest]
//
// The fault this exists for, in the owner's words: "nu is het gewoon zwart
// zonder iets als de rom niet goed geladen is." A wearer who sees nothing
// cannot tell a missing laptop from a broken bundle from a lens that never
// started, so every one of those has to be a page with a reason on it and an
// instruction under the reason.
//
// Since 28 September the first run is four steps -- WELCOME, GET A CODE,
// ENTER CODE, PUT IT DOWN -- and the code is typed on the system keyboard
// when there is one and on the D-pad grid when there is not. Both keyboards
// are walked here; the strongest assertion is unchanged: every string every
// page can produce is drawable by TinyFont and fits between the margins.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const W = await import("../Assets/Scripts/play/screen/SetupWizard.ts");
const {
  SetupWizard,
  WIZ_LOOKING, WIZ_BRIDGE, WIZ_FAILED, WIZ_PLACE, WIZ_READY,
  WIZ_INTRO, WIZ_CODE, WIZ_FETCH, INTRO_STEPS, STEP_TOTAL,
  WIZ_STAY, WIZ_RETRY, WIZ_REPLACE, WIZ_DONE, WIZ_RESCAN, WIZ_FETCH_CODE,
  WIZ_KEYBOARD, WIZ_KEYBOARD_CLOSE,
  FAIL_NO_SOURCE, FAIL_BRIDGE, FAIL_BUNDLE, FAIL_WORLD, FAIL_CODE, FAIL_NET, FAIL_REASONS,
  remedyFor, retrySeconds, autoRetries,
  MIN_DWELL, HOLD_SECONDS, RETRY_CAP, TITLE_MAX,
  MAX_LINES, MAX_LINES_WITH_BAR,
  TITLE_Y, RULE_Y, BODY_Y, LINE_PITCH, FOOTER_Y,
  BAR_X, BAR_Y, BAR_W, BAR_H, BAR_INSET, BAR_INNER,
  ICON_X, ICON_Y, STEPS_X, STEPS_Y,
} = W;
const E = await import("../Assets/Scripts/play/screen/CodeEntry.ts");
const { CODE_ALPHABET, GRID_COLUMNS } = E;
const F = await import("../Assets/Scripts/play/screen/TinyFont.ts");
const { hasGlyph, inkWidth, COLUMNS, MARGIN_X, GLYPH_H } = F;
const C = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { GbCanvas, SCREEN_WIDTH, SCREEN_HEIGHT } = C;
const P = await import("../Assets/Scripts/play/DioramaPlacer.ts");
const { PLACE_SEARCHING, PLACE_IN_FRONT, PLACE_ON_SURFACE } = P;
const I = await import("../Assets/Scripts/play/InputSource.ts");
const { PAD_UNAVAILABLE, PAD_SCANNING, PAD_CONNECTED, PAD_FAILED } = I;
const { hasIcon } = await import("../Assets/Scripts/play/screen/PixelIcons.ts");

let pass = 0;
let fail = 0;
function check(label, ok, saw) {
  if (ok) { pass++; } else { fail++; console.log("  FAIL " + label + (saw === undefined ? "" : "  saw " + saw)); }
}

const URL = "ws://192.168.1.142:8781";
const ID = "kanto";
const SITE = "https://pocket-diorama.vercel.app";
function fresh(firstRun, keyboard) {
  return new SetupWizard(firstRun === undefined ? true : firstRun, URL, ID, true, true, SITE, keyboard === true);
}
/** Types a code on the grid: walks the cursor to each symbol and presses A. */
function typeCode(w, code) {
  let out = WIZ_STAY;
  for (const ch of code) {
    const index = CODE_ALPHABET.indexOf(ch);
    const row = Math.floor(index / GRID_COLUMNS);
    const col = index % GRID_COLUMNS;
    for (let i = 0; i < 8; i++) { w.step(1 / 60, false, false, false, "up"); }
    let guard = 0;
    while (w.cursorForTest()[0] !== 0 && guard++ < 12) { w.step(1 / 60, false, false, false, "down"); }
    while (w.cursorForTest()[1] !== 0 && guard++ < 24) { w.step(1 / 60, false, false, false, "left"); }
    for (let r = 0; r < row; r++) { w.step(1 / 60, false, false, false, "down"); }
    for (let c = 0; c < col; c++) { w.step(1 / 60, false, false, false, "right"); }
    const r = w.step(1 / 60, true, false, false, "");
    if (r !== WIZ_STAY) { out = r; }
  }
  return out;
}
/** Runs `seconds` of frames at 60fps, with no button held. */
function idle(w, seconds) {
  let out = WIZ_STAY;
  const frames = Math.ceil(seconds / (1 / 60));
  for (let i = 0; i < frames; i++) {
    const r = w.step(1 / 60, false, false, false);
    if (r !== WIZ_STAY) { out = r; }
  }
  return out;
}
/** One frame with A, B or START. */
function press(w, button) {
  return w.step(1 / 60, button === "A", button === "B", button === "START");
}
/** Through the intro to the code page, on a fresh first run. */
function toCode(keyboard) {
  const w = fresh(true, keyboard);
  w.needCode();
  idle(w, MIN_DWELL + 0.1);
  let last = WIZ_STAY;
  for (let i = 0; i < INTRO_STEPS; i++) { last = press(w, "A"); }
  return { w, last };
}

console.log("=== every page reads, and every page fits ===");
{
  const pages = [];
  function collect(label, w) {
    pages.push({ label: label, title: w.title(), lines: w.lines(), footer: w.footer(), state: w.state(), step: w.stepNumber(), icon: w.iconName() });
  }
  for (const found of ["", "CACHE", "BAKED"]) {
    for (const baked of [true, false]) {
      for (const net of [true, false]) {
        const w = new SetupWizard(true, URL, ID, baked, net);
        if (found) { w.sourceFound(found); }
        collect("looking " + found + baked + net, w);
      }
    }
  }
  for (const f of [0, 0.42, 1]) {
    const w = fresh();
    w.beginBridge(URL);
    idle(w, MIN_DWELL + 0.1);
    w.progress(f, "receiving world");
    collect("bridge " + f, w);
  }
  // INTRO, both pages, with and without a site to name, on both keyboards.
  for (const keyboard of [false, true]) {
    for (const site of [SITE, ""]) {
      const w = new SetupWizard(true, URL, ID, false, true, site, keyboard);
      w.needCode();
      idle(w, MIN_DWELL + 0.1);
      for (let i = 0; i < INTRO_STEPS; i++) {
        collect("intro " + i + (site ? "" : " nosite"), w);
        press(w, "A");
      }
      collect("code empty " + (keyboard ? "keyboard" : "grid"), w);
      if (keyboard) {
        idle(w, 0.05);
        w.keyboardState(true);
        collect("code keyboard open", w);
        w.keyboardText("ab");
        collect("code partial keyboard", w);
        w.keyboardText("abc def");
        collect("code full keyboard", w);
        w.keyboardState(false);
        collect("code full keyboard closed", w);
      } else {
        typeCode(w, "ABC");
        collect("code partial grid", w);
      }
    }
  }
  // CODE for a returning wearer, who cannot go back, on both keyboards.
  for (const keyboard of [false, true]) {
    const w = new SetupWizard(false, URL, ID, false, true, SITE, keyboard);
    w.needCode();
    idle(w, MIN_DWELL + 0.1);
    collect("code returning " + keyboard, w);
  }
  for (const f of [0, 0.5, 1]) {
    const { w } = toCode(false);
    typeCode(w, "ABCDEF");
    press(w, "A");
    w.progress(f, "receiving world");
    collect("fetch " + f, w);
  }
  for (const reason of FAIL_REASONS) {
    const w = fresh();
    w.failed(reason, "websocket closed before the bundle arrived: code 1006");
    idle(w, MIN_DWELL + 0.1);
    collect("failed " + reason, w);
    press(w, "B");
    collect("failed detail " + reason, w);
  }
  {
    const w = fresh();
    w.failed(FAIL_WORLD, "");
    idle(w, MIN_DWELL + 0.1);
    press(w, "B");
    collect("failed detail empty", w);
  }
  // PLACE, every placer state, every pad state and both input names.
  for (const ps of ["", PLACE_SEARCHING, PLACE_IN_FRONT, PLACE_ON_SURFACE]) {
    for (const pad of ["", PAD_UNAVAILABLE, PAD_SCANNING, PAD_CONNECTED, PAD_FAILED]) {
      for (const input of ["none", "pinch", "gamepad", "phone"]) {
        const w = fresh();
        w.worldReady(1523456, "a1b2c3d4e5f6");
        idle(w, MIN_DWELL + 0.1);
        w.observe(ps, pad, input);
        collect("place " + ps + " " + pad + " " + input, w);
      }
    }
  }
  {
    const r = new SetupWizard(false, URL, ID, true, true);
    r.worldReady(7, "");
    idle(r, MIN_DWELL + 0.05);
    r.observe(PLACE_ON_SURFACE, PAD_CONNECTED, "gamepad");
    collect("ready returning", r);
  }

  check("every state was reached", pages.length > 100, pages.length);
  const states = {};
  for (const p of pages) { states[p.state] = true; }
  check("all eight pages appear",
        [WIZ_LOOKING, WIZ_BRIDGE, WIZ_INTRO, WIZ_CODE, WIZ_FETCH, WIZ_FAILED, WIZ_PLACE, WIZ_READY]
          .every((s) => states[s]), Object.keys(states).join(","));

  let undrawable = "";
  let tooWide = "";
  let tooManyLines = "";
  let emptyPage = "";
  let badStep = "";
  let badIcon = "";
  for (const p of pages) {
    const all = [p.title, p.footer].concat(p.lines);
    for (const line of all) {
      for (const ch of line) {
        if (!hasGlyph(ch)) { undrawable += " " + p.label + ":" + JSON.stringify(ch); }
      }
    }
    if (p.title.length > TITLE_MAX) { tooWide += " title:" + p.label; }
    if ((p.icon !== "" || p.step > 0) && p.title.length > 8) { tooWide += " title-beside-icon:" + p.label + ":" + p.title; }
    for (const line of p.lines.concat([p.footer])) {
      if (inkWidth(line, 1) > SCREEN_WIDTH - 2 * MARGIN_X) { tooWide += " " + p.label + ":" + line; }
    }
    const cap = (p.state === WIZ_BRIDGE || p.state === WIZ_FETCH) ? MAX_LINES_WITH_BAR : MAX_LINES;
    if (p.lines.length > cap) { tooManyLines += " " + p.label + ":" + p.lines.length; }
    if (p.lines.join("").trim() === "") { emptyPage += " " + p.label; }
    if (p.step < 0 || p.step > STEP_TOTAL) { badStep += " " + p.label; }
    if (p.icon !== "" && !hasIcon(p.icon)) { badIcon += " " + p.label + ":" + p.icon; }
  }
  check("every character of every page is in the font", undrawable === "", undrawable);
  check("every line fits between the margins", tooWide === "", tooWide);
  check("no page has more lines than it has room for", tooManyLines === "", tooManyLines);
  check("no page is blank", emptyPage === "", emptyPage);
  check("every step number is one of the four", badStep === "", badStep);
  check("every icon a page names exists", badIcon === "", badIcon);
  const intro = pages.filter((p) => p.state === WIZ_INTRO);
  check("the intro pages are steps 1 and 2", intro.every((p) => p.step === 1 || p.step === 2));
  check("the code page is step 3", pages.filter((p) => p.state === WIZ_CODE).every((p) => p.step === 3));
  check("the last page is step 4", pages.filter((p) => p.state === WIZ_PLACE).every((p) => p.step === 4));
  check("the second page names the site", pages.some((p) => p.label === "intro 1" && p.lines.join(" ").indexOf("POCKET-DIORAMA.VERCEL.APP") >= 0));
  check("the second page says the cartridge stays", pages.some((p) => p.label === "intro 1" && p.lines.join(" ").indexOf("NEVER LEAVES") >= 0));
  check("the last page teaches the hands", pages.filter((p) => p.state === WIZ_PLACE).every((p) => p.lines.join(" ").indexOf("PINCH") >= 0 && p.lines.join(" ").indexOf("TWO HANDS") >= 0));
  check("the footers say which button", pages.filter((p) => p.state === WIZ_INTRO || p.state === WIZ_PLACE).every((p) => p.footer.indexOf("[A]") === 0));
}

console.log("=== the remedies ===");
{
  check("there are six declared reasons", FAIL_REASONS.length === 6, FAIL_REASONS.length);
  let thin = "";
  for (const reason of FAIL_REASONS) {
    const lines = remedyFor(reason, URL, ID);
    if (lines.length < 4 || lines.join(" ").length < 60) { thin += " " + reason; }
  }
  check("every reason has advice, not just a diagnosis", thin === "", thin);
  const bridge = remedyFor(FAIL_BRIDGE, URL, ID).join(" ");
  check("the bridge page names the server script", bridge.indexOf("SERVE-WORLD.SH") >= 0, bridge);
  check("...and the same wi-fi", bridge.indexOf("WI-FI") >= 0);
  check("...and BRIDGEHOST", bridge.indexOf("BRIDGEHOST") >= 0);
  check("...and the address it actually tried", bridge.indexOf("192.168.1.142:8781") >= 0, bridge);
  const bundle = remedyFor(FAIL_BUNDLE, URL, ID).join(" ");
  check("the bad-data page names the bundle it choked on", bundle.indexOf("KANTO") >= 0, bundle);
  const nosource = remedyFor(FAIL_NO_SOURCE, URL, ID).join(" ");
  check("the no-source page says what is missing", nosource.indexOf("INTERNETMODULE") >= 0, nosource);
  check("an unknown reason still says something", remedyFor("nonsense", URL, ID).length > 0);
  const code = remedyFor(FAIL_CODE, "ABC234", ID).join(" ");
  check("the bad-code page repeats the code", code.indexOf("ABC234") >= 0, code);
  check("...and says a code lasts a day", code.indexOf("ONE DAY") >= 0, code);
  const net = remedyFor(FAIL_NET, "POCKET-DIORAMA.VERCEL.APP", ID).join(" ");
  check("the no-site page names the site", net.indexOf("POCKET-DIORAMA.VERCEL.APP") >= 0, net);
  check("...and asks about wi-fi", net.indexOf("WI-FI") >= 0, net);
  let overrun = "";
  for (const reason of FAIL_REASONS) {
    for (const line of remedyFor(reason, "ws://255.255.255.255:65535/some/long/path", "a-very-long-bundle-identifier")) {
      if (inkWidth(line, 1) > SCREEN_WIDTH - 2 * MARGIN_X) { overrun += " " + reason + ":" + line; }
    }
  }
  check("every remedy fits the page it is drawn on", overrun === "", overrun);
}

console.log("=== retry timing ===");
{
  check("first retry after 3s", retrySeconds(0) === 3, retrySeconds(0));
  check("then 6", retrySeconds(1) === 6);
  check("then 12", retrySeconds(2) === 12);
  check("then 24", retrySeconds(3) === 24);
  check("then it caps", retrySeconds(4) === RETRY_CAP && retrySeconds(40) === RETRY_CAP, retrySeconds(4));
  check("and never goes below the cap once capped", RETRY_CAP === 30, RETRY_CAP);
  check("a missing Mac retries itself", autoRetries(FAIL_BRIDGE));
  check("and so does a site that did not answer", autoRetries(FAIL_NET));
  check("a code the site does not know does not", !autoRetries(FAIL_CODE));
  check("bad data does not", !autoRetries(FAIL_BUNDLE));
  check("nor does a missing source", !autoRetries(FAIL_NO_SOURCE));
  check("nor a world that would not start", !autoRetries(FAIL_WORLD));
}

console.log("=== the first run, with a world in hand ===");
{
  const w = fresh();
  check("it starts looking", w.state() === WIZ_LOOKING);
  w.sourceFound("CACHE");
  w.worldReady(1000, "abc");
  check("a world found instantly does not skip the page", w.state() === WIZ_LOOKING);
  idle(w, MIN_DWELL / 2);
  check("...and still does not, halfway through the dwell", w.state() === WIZ_LOOKING);
  idle(w, MIN_DWELL);
  check("...and then it moves on, to the last step", w.state() === WIZ_PLACE, w.state());
  check("which is step four", w.stepNumber() === 4);
  check("B on the last step asks for a re-place", press(w, "B") === WIZ_REPLACE);
  check("...and stays on the page while it happens", w.state() === WIZ_PLACE);
  check("START asks for another pad scan", press(w, "START") === WIZ_RESCAN);
  check("...and stays too", w.state() === WIZ_PLACE);
  check("A plays", press(w, "A") === WIZ_DONE);
  check("...and it latches", press(w, "B") === WIZ_DONE && idle(w, 10) === WIZ_DONE);
}

console.log("=== a wearer who has seen it before ===");
{
  const w = fresh(false);
  w.worldReady(5, "");
  idle(w, MIN_DWELL + 0.05);
  check("a returning wearer skips the steps", w.state() === WIZ_READY, w.state());
  check("READY is not a step", w.stepNumber() === 0);
  check("and is not done yet", w.step(0.01, false, false, false) === WIZ_STAY);
  check("but gets there without pressing anything", idle(w, HOLD_SECONDS + 0.1) === WIZ_DONE);
  check("the whole thing is short", MIN_DWELL + HOLD_SECONDS <= 1.5, MIN_DWELL + HOLD_SECONDS);
  const s = fresh(false);
  s.worldReady(5, "");
  idle(s, MIN_DWELL + 0.05);
  check("START finishes too", press(s, "START") === WIZ_DONE);
}

console.log("=== the bar ===");
{
  const w = fresh();
  w.beginBridge(URL);
  idle(w, MIN_DWELL + 0.1);
  w.progress(0.42, "receiving world");
  check("the percentage is on the page", (w.title() + w.lines().join(" ") + w.footer()).indexOf("42%") >= 0,
        w.footer());
  check("the fraction is what was given", Math.abs(w.progressFraction() - 0.42) < 1e-9);
  w.progress(0.30, "receiving world");
  check("progress never goes backwards", Math.abs(w.progressFraction() - 0.42) < 1e-9, w.progressFraction());
  w.progress(7, "");
  check("and clamps at the top", w.progressFraction() === 1);
  const z = fresh();
  z.beginBridge(URL);
  idle(z, MIN_DWELL + 0.1);
  z.progress(-3, "");
  check("and at the bottom", z.progressFraction() === 0);
  z.progress(NaN, "");
  check("nonsense is not progress", z.progressFraction() === 0);
  check("A does nothing while it downloads", press(w, "A") === WIZ_STAY && w.state() === WIZ_BRIDGE);
  check("nor does B", press(w, "B") === WIZ_STAY && w.state() === WIZ_BRIDGE);
}

console.log("=== retrying, by hand and by itself ===");
{
  const w = fresh();
  w.failed(FAIL_BRIDGE, "closed");
  idle(w, MIN_DWELL + 0.05);
  check("a bridge failure counts down", w.retryIn() === 3, w.retryIn());
  const r = idle(w, 3.1);
  check("and retries by itself", r === WIZ_RETRY, r);
  check("back to looking", w.state() === WIZ_LOOKING);
  check("counting the attempt", w.attempts() === 1);
  w.failed(FAIL_BRIDGE, "closed");
  idle(w, MIN_DWELL + 0.05);
  check("the second wait is longer", w.retryIn() === 6, w.retryIn());
  check("A retries now", press(w, "A") === WIZ_RETRY);
  const b = fresh();
  b.failed(FAIL_BUNDLE, "bad json");
  idle(b, MIN_DWELL + 0.05);
  check("bad data does not count down", b.retryIn() === 0);
  check("and waits for ever", idle(b, 60) === WIZ_STAY && b.state() === WIZ_FAILED);
  check("B shows the detail", (press(b, "B"), b.lines().join(" ").indexOf("BAD JSON") >= 0), b.lines().join("|"));
  check("B again hides it", (press(b, "B"), b.lines().join(" ").indexOf("BAD JSON") < 0));
}

console.log("=== the version only moves when the screen would ===");
{
  const w = fresh();
  const v0 = w.stateVersion();
  w.observe(PLACE_SEARCHING, PAD_SCANNING, "pinch");
  check("a probe on the looking page does not repaint", w.stateVersion() === v0);
  w.sourceFound("CACHE");
  check("a finding does", w.stateVersion() > v0);
  w.worldReady(1, "");
  idle(w, MIN_DWELL + 0.05);
  const v1 = w.stateVersion();
  w.observe(PLACE_SEARCHING, PAD_SCANNING, "pinch");
  check("the same observation again does not", w.stateVersion() === v1);
  w.observe(PLACE_ON_SURFACE, PAD_SCANNING, "pinch");
  check("a changed one on the last page does", w.stateVersion() > v1);
}

console.log("=== the front door on the grid: intro, code, fetch ===");
{
  const w = fresh(true, false);
  w.needCode();
  check("the intro is asked for", w.state() === WIZ_LOOKING);
  idle(w, MIN_DWELL + 0.05);
  check("...and arrives after the dwell", w.state() === WIZ_INTRO, w.state());
  check("on its first page", w.introPage() === 0);
  check("the first page names the lens", w.lines().join(" ").indexOf("POCKET DIORAMA") >= 0, w.lines().join("|"));
  check("B on the first page stays", press(w, "B") === WIZ_STAY && w.introPage() === 0);
  press(w, "A");
  check("A turns the page", w.introPage() === 1);
  check("the second page is about the site", w.title() === "GET CODE", w.title());
  press(w, "A");
  check("the next A is the code page", w.state() === WIZ_CODE, w.state());
  check("with the grid", !w.usesSystemKeyboard());
  check("no keyboard is asked for on the grid", idle(w, 0.1) === WIZ_STAY);
  check("the title says so", w.title() === "THE CODE", w.title());
  check("B on an empty code goes back to the last intro page",
        (press(w, "B"), w.state() === WIZ_INTRO && w.introPage() === INTRO_STEPS - 1), w.state() + " " + w.introPage());
  press(w, "A");
  const partial = typeCode(w, "ABCDE");
  check("five symbols are not a code", partial === WIZ_STAY && w.state() === WIZ_CODE);
  const sixth = typeCode(w, "F");
  check("the sixth symbol parks the cursor on OK", sixth === WIZ_STAY && w.cursorForTest()[0] === 4 && w.cursorForTest()[1] === 1,
        w.cursorForTest().join(","));
  const go = press(w, "A");
  check("and A on OK asks the lens to fetch", go === WIZ_FETCH_CODE, go);
  check("...the code the wearer typed", w.enteredCode() === "ABCDEF", w.enteredCode());
  check("...on the fetch page", w.state() === WIZ_FETCH, w.state());
  check("which names the code", w.lines().join(" ").indexOf("ABCDEF") >= 0, w.lines().join("|"));
  check("and shows the bar", w.footer().indexOf("%") >= 0, w.footer());
  check("a press does not cancel it", press(w, "A") === WIZ_STAY && w.state() === WIZ_FETCH);
  w.failed(FAIL_CODE, "404");
  idle(w, MIN_DWELL + 0.05);
  check("no such code is a failure page", w.state() === WIZ_FAILED);
  check("that repeats the code", w.lines().join(" ").indexOf("ABCDEF") >= 0);
  check("does not count down", w.retryIn() === 0);
  check("and A goes back to the keyboard", (press(w, "A"), w.state() === WIZ_CODE), w.state());
  check("with the field cleared", w.typedCode() === "", w.typedCode());
}

console.log("=== the front door on the system keyboard ===");
{
  const { w, last } = toCode(true);
  check("the code page is reached", w.state() === WIZ_CODE, w.state());
  check("with the system keyboard", w.usesSystemKeyboard());
  check("and the lens is asked to open it, once", idle(w, 1 / 60) === WIZ_KEYBOARD && idle(w, 0.2) === WIZ_STAY);
  w.keyboardState(true);
  check("the page says to type while it is open", w.lines().join(" ").indexOf("TYPE") >= 0, w.lines().join("|"));
  w.keyboardText("k7m");
  check("text arrives upper-cased", w.typedCode() === "K7M", w.typedCode());
  w.keyboardText("k7m-2qx9z");
  check("dashes go, and it is cut at six", w.typedCode() === "K7M2QX", w.typedCode());
  check("six letters says so", w.lines().join(" ").indexOf("SIX") >= 0);
  check("the footer offers OK", w.footer().indexOf("[A] OK") === 0, w.footer());
  w.keyboardText("k7m2q");
  check("a deletion on the keyboard shortens it", w.typedCode() === "K7M2Q");
  w.keyboardText("K7M2QX");
  w.keyboardReturn();
  const go = idle(w, 1 / 60);
  check("return with six letters fetches", go === WIZ_FETCH_CODE, go);
  check("...that code", w.enteredCode() === "K7M2QX", w.enteredCode());
  check("...on the fetch page", w.state() === WIZ_FETCH);

  // A short code and return: the keyboard closed itself; A brings it back.
  const s = toCode(true).w;
  idle(s, 0.1);
  s.keyboardState(true);
  s.keyboardText("AB");
  s.keyboardReturn();
  s.keyboardState(false);
  check("return with two letters stays", idle(s, 1 / 60) === WIZ_STAY && s.state() === WIZ_CODE);
  check("the page now offers the keyboard", s.footer().indexOf("[A] KEYBOARD") === 0, s.footer());
  check("and A asks for it again", press(s, "A") === WIZ_KEYBOARD);
  s.keyboardState(true);
  check("A while it is open does nothing", press(s, "A") === WIZ_STAY);
  check("B goes back to the site page and closes the keyboard",
        press(s, "B") === WIZ_KEYBOARD_CLOSE && s.state() === WIZ_INTRO && s.introPage() === 1, s.state());
  press(s, "A");
  check("coming back asks for the keyboard again", idle(s, 1 / 60) === WIZ_KEYBOARD);
  check("with the field cleared", s.typedCode() === "");

  // A returning wearer: no intro, straight to the keyboard, no way back.
  const r = new SetupWizard(false, URL, ID, false, true, SITE, true);
  r.needCode();
  const arrived = idle(r, MIN_DWELL + 0.05);
  check("a returning wearer lands on the code page", r.state() === WIZ_CODE, r.state());
  check("and is asked the keyboard on arrival", arrived === WIZ_KEYBOARD, arrived);
  r.keyboardState(true);
  check("B does nothing for them", press(r, "B") === WIZ_STAY && r.state() === WIZ_CODE);
  check("their footer has no BACK", r.footer().indexOf("BACK") < 0, r.footer());

  // A failed code on the keyboard path clears the field and reopens.
  const f = toCode(true).w;
  idle(f, 0.1);
  f.keyboardText("ABCDEF");
  press(f, "A");
  f.failed(FAIL_CODE, "404");
  idle(f, MIN_DWELL + 0.05);
  press(f, "A");
  check("after a bad code the keyboard comes back", f.state() === WIZ_CODE && idle(f, 1 / 60) === WIZ_KEYBOARD);
  check("with nothing typed", f.typedCode() === "");
}

console.log("=== what actually lands on the screen ===");
{
  const canvas = new GbCanvas();
  const w = fresh();
  w.needCode();
  idle(w, MIN_DWELL + 0.1);
  w.paint(canvas);
  function inkIn(x, y, wdt, h) {
    let n = 0;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + wdt; xx++) {
        if (canvas.shadeAt(xx, yy) === 3) n++;
      }
    }
    return n;
  }
  check("the title row has ink", inkIn(0, TITLE_Y, SCREEN_WIDTH, 14) > 30);
  check("the rule is drawn", inkIn(MARGIN_X, RULE_Y, SCREEN_WIDTH - 2 * MARGIN_X, 1) > 100);
  check("the first body line has ink", inkIn(0, BODY_Y, SCREEN_WIDTH, GLYPH_H) > 20);
  check("the footer has ink", inkIn(0, FOOTER_Y, SCREEN_WIDTH, GLYPH_H) > 10);
  check("the step icon is drawn", inkIn(ICON_X, ICON_Y, 12, 12) > 12);
  check("the step dots are drawn", inkIn(STEPS_X, STEPS_Y, 28, 4) > 12);
  check("nothing is drawn below the footer", inkIn(0, FOOTER_Y + GLYPH_H + 1, SCREEN_WIDTH, SCREEN_HEIGHT - FOOTER_Y - GLYPH_H - 1) === 0);
  check("the body's tallest line clears the footer", SetupWizard.bodyBottom(MAX_LINES) < FOOTER_Y, SetupWizard.bodyBottom(MAX_LINES));

  // The bar page: outline and fill.
  const b = fresh();
  b.beginBridge(URL);
  idle(b, MIN_DWELL + 0.1);
  b.progress(0.5, "receiving");
  b.paint(canvas);
  check("the bar's outline is ink", inkIn(BAR_X, BAR_Y, BAR_W, 1) === BAR_W);
  const filled = (() => { let n = 0; for (let x = BAR_X + BAR_INSET; x < BAR_X + BAR_W - BAR_INSET; x++) { if (canvas.shadeAt(x, BAR_Y + BAR_H / 2) === 2) n++; } return n; })();
  check("half the bar is filled", Math.abs(filled - BAR_INNER / 2) <= 1, filled);

  // The keyboard page: six boxes, letters in the typed ones.
  const k = toCode(true).w;
  idle(k, 0.1);
  k.keyboardText("K7M");
  k.paint(canvas);
  check("the keyboard page has its boxes", inkIn(0, W.KEY_FIELD_Y, SCREEN_WIDTH, W.KEY_FIELD_H) > 60);
  check("and its words", inkIn(0, W.KEY_STATUS_Y, SCREEN_WIDTH, GLYPH_H) > 10);
}

if (SELFTEST) {
  // "every character is in the font" only guards if a stray glyph fails it.
  check("SELFTEST a tilde is not in the font", !hasGlyph("~"));
  // "the sixth symbol parks the cursor on OK" only guards if five did not.
  const w = toCode(false).w;
  typeCode(w, "ABCDE");
  check("SELFTEST five symbols leave the cursor on the grid", w.cursorForTest()[0] < 4);
  // The keyboard path's cut at six is a real cut, not a coincidence of input.
  const k = toCode(true).w;
  idle(k, 0.1);
  k.keyboardText("ABCDEFGHJ");
  check("SELFTEST nine letters are six", k.typedCode().length === 6);
}

console.log("=== the plate and the grid ===");
{
  // The empty plate belongs to the placing pages only; behind the intro it
  // read as a table top hanging in the room.
  const w = fresh(true, false);
  check("no plate while looking", !w.showsPlate());
  w.needCode();
  idle(w, MIN_DWELL + 0.1);
  check("no plate on the intro", !w.showsPlate() && w.state() === WIZ_INTRO, w.state());
  check("the intro is not the grid", !w.onGridPage());
  const grid = toCode(false).w;
  idle(grid, MIN_DWELL + 0.1);
  check("the code page is the grid without a keyboard", grid.state() === WIZ_CODE && grid.onGridPage(), grid.state());
  check("no plate on the code page", !grid.showsPlate());
  grid.worldReady(1000, "abc");
  idle(grid, MIN_DWELL + 0.1);
  check("the plate comes with PLACE IT", grid.state() === WIZ_PLACE && grid.showsPlate(), grid.state());
  const keys = toCode(true).w;
  idle(keys, MIN_DWELL + 0.1);
  check("with the system keyboard the code page is not the grid", keys.state() === WIZ_CODE && !keys.onGridPage(), keys.state());
  const back = fresh(false, false);
  back.worldReady(1000, "abc");
  idle(back, MIN_DWELL + 0.1);
  check("READY shows the plate too", back.state() === WIZ_READY && back.showsPlate(), back.state());
}

console.log("\nSETUPWIZARD  " + pass + " pass, " + fail + " fail");
if (fail > 0) {
  process.exit(1);
}
