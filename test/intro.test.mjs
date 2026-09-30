// The intro's own timelines -- headless, no ROM frames needed.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/intro.test.mjs [--selftest]
//
// Every number here is tools/oracle/INTRO.md, re-verified against the
// recorded tilemaps where this file's own pixel test needed exactness (see
// play/screen/IntroScreen.ts and play/screen/CanvasTextBox.ts's own header
// comments for the three corrections beyond INTRO.md's own text). This file
// checks the TIMING -- ramp lengths, the slide table, the shrink's stage
// boundaries, the text box's pace and hard-clear delay, the arrow cycle --
// so a change to one of those tables is caught the same run, without
// needing the gitignored ROM-derived frames test/intro.pixel.test.mjs reads.

globalThis.print = () => {};

const introMod = await import("../Assets/Scripts/play/screen/IntroScreen.ts");
const {
  IntroStage, OAK_FADE_RAMP, RIVAL_FADE_RAMP, PLAYER_AGAIN_RAMP,
  SLIDE_WX_TABLE, LIST_SLIDE_COLUMNS, LIST_SLIDE_FRAMES_PER_COLUMN, LIST_SLIDE_FRAMES,
  SHRINK_STAGE_FULL_END, SHRINK_STAGE_1_END, SHRINK_STAGE_2_END,
  SHRINK_STAGE_GAP_END, SHRINK_STAGE_SPRITE_END, RED_SPRITE_BLOCK_X, RED_SPRITE_BLOCK_Y,
  RED_SPRITE_OBP0,
  WHITE_HOLD_FRAMES, BGP_NORMAL, BGP_BLANK,
  ACK_TEXT_ID_PLAYER, ACK_TEXT_ID_RIVAL,
} = introMod;
const textBoxMod = await import("../Assets/Scripts/play/screen/CanvasTextBox.ts");
const { CanvasTextBox, HARD_CLEAR_FRAMES, ARROW_ON_FRAMES, ARROW_OFF_FRAMES } = textBoxMod;

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) {
    pass++;
    return;
  }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

function rampTotal(ramp) {
  let total = 0;
  for (const step of ramp) {
    total += step.frames;
  }
  return total;
}

// ------------------------------------------------------------- the ramps

console.log("=== fade ramps ===");
{
  check("Oak's ramp is the seven measured values",
    JSON.stringify(OAK_FADE_RAMP.map((s) => s.bgp)) ===
    JSON.stringify([0x00, 0x54, 0xa8, 0xfc, 0xf8, 0xf4, 0xe4]));
  check("Oak's ramp settles at $E4", OAK_FADE_RAMP[OAK_FADE_RAMP.length - 1].bgp === BGP_NORMAL);
  check("Oak's ramp starts blank", OAK_FADE_RAMP[0].bgp === BGP_BLANK);

  check("the rival's ramp is the same seven values as Oak's (the correction)",
    JSON.stringify(RIVAL_FADE_RAMP.map((s) => s.bgp)) ===
    JSON.stringify(OAK_FADE_RAMP.map((s) => s.bgp)));
  check("the rival's own opening hold is longer than Oak's (measured: 50 frames, not 10)",
    RIVAL_FADE_RAMP[0].frames === 50 && OAK_FADE_RAMP[0].frames === 10);

  check("the player's second ramp is $00/$40/$90/$E4",
    JSON.stringify(PLAYER_AGAIN_RAMP.map((s) => s.bgp)) === JSON.stringify([0x00, 0x40, 0x90, 0xe4]));

  const stage = new IntroStage({ oak: null, rival: null, player: null, shrink1: null, shrink2: null }, null, null);
  stage.show("oak");
  check("bgp() reads the ramp's first value at frame 0", stage.bgp() === 0x00);
  stage.step(OAK_FADE_RAMP[0].frames - 1);
  check("still the first value one frame before its own hold ends", stage.bgp() === 0x00);
  stage.step(1);
  check("the second value the frame the hold ends", stage.bgp() === 0x54);
  check("isSettled() is false mid-ramp", !stage.isSettled());
  stage.step(rampTotal(OAK_FADE_RAMP));
  check("isSettled() once the whole ramp's own total has elapsed", stage.isSettled());
  check("bgp() holds at $E4 once settled", stage.bgp() === BGP_NORMAL);
}

// ------------------------------------------------------------- the slide

console.log("=== the slide ===");
{
  check("the slide table starts at WX 119", SLIDE_WX_TABLE[0] === 119);
  check("the slide table ends at WX 7 (rest)", SLIDE_WX_TABLE[SLIDE_WX_TABLE.length - 1] === 7);
  check("14 steps of -8px each (INTRO.md \"Nidorino appearing\")", SLIDE_WX_TABLE.length === 15);
  let stepOk = true;
  for (let i = 1; i < SLIDE_WX_TABLE.length; i++) {
    if (SLIDE_WX_TABLE[i] !== SLIDE_WX_TABLE[i - 1] - 8) {
      stepOk = false;
    }
  }
  check("every step is exactly -8px", stepOk);

  const stage = new IntroStage({ oak: null, rival: null, player: null, shrink1: null, shrink2: null },
    { width: 8, height: 8, shades: new Uint8Array(64), alpha: null }, null);
  stage.show("nidorino");
  check("bgp() is $E4 on the slide's own first frame (palette restored immediately)",
    stage.bgp() === BGP_NORMAL);
  check("not settled before the table's own last index", !stage.isSettled());
  stage.step(SLIDE_WX_TABLE.length - 1);
  check("settled once the table's own last index is reached", stage.isSettled());
}

// --------------------------------------------------------- the name list

console.log("=== the name-list slide ===");
{
  check("six columns, not INTRO.md's own uncorrected five (see IntroScreen.ts header)",
    LIST_SLIDE_COLUMNS === 6);
  check("~3 frames a column", LIST_SLIDE_FRAMES_PER_COLUMN === 3);
  check("18 frames total", LIST_SLIDE_FRAMES === 18);

  const art = { oak: null, rival: null, player: { width: 8, height: 8, shades: new Uint8Array(64), alpha: null }, shrink1: null, shrink2: null };
  const stage = new IntroStage(art, null, null);
  stage.show("player");
  stage.step(SLIDE_WX_TABLE.length - 1);
  check("not slid before slideListOpen()", !stage.isListSlideSettled());
  stage.slideListOpen();
  check("freshly opened: not yet settled", !stage.isListSlideSettled());
  stage.step(LIST_SLIDE_FRAMES - 1);
  check("one frame short of the full slide: still not settled", !stage.isListSlideSettled());
  stage.step(1);
  check("settled once all 18 frames have elapsed", stage.isListSlideSettled());
  stage.slideListClosed();
  check("closing resets its own settle flag", !stage.isListSlideSettled());
  stage.step(LIST_SLIDE_FRAMES);
  check("closing settles after the same 18 frames", stage.isListSlideSettled());
}

// -------------------------------------------------------------- the shrink

console.log("=== the shrink ===");
{
  check("stage boundaries: full only at offset 0", SHRINK_STAGE_FULL_END === 1);
  check("shrink1's own exact-match window starts right after (re-measured, not INTRO.md's ~55)",
    SHRINK_STAGE_1_END === 42);
  check("shrink2's own exact-match window ends at 71 (the pokered order is ShrinkPic1, " +
    "ShrinkPic2, then SPRITE_RED -- see IntroScreen.ts header)", SHRINK_STAGE_2_END === 71);
  check("a one-frame blank hand-off at 71 before the sprite (measured)", SHRINK_STAGE_GAP_END === 72);
  check("SPRITE_RED's own window ends at 135 (\"gone\", unchanged)", SHRINK_STAGE_SPRITE_END === 135);
  check("OBP0 for SPRITE_RED is [0,0,1,3], not the identity map SpriteBillboard.ts's own default uses",
    JSON.stringify(RED_SPRITE_OBP0) === JSON.stringify([0, 0, 1, 3]));

  const player = { width: 4, height: 4, shades: new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), alpha: null };
  const shrink1 = { width: 4, height: 4, shades: new Uint8Array([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]), alpha: null };
  const shrink2 = { width: 4, height: 4, shades: new Uint8Array([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), alpha: null };
  // Already-decoded and already-OBP0-remapped, as the constructor expects
  // (this file's own header: IntroStage never touches raw bundle data).
  const redDownSprite = { width: 2, height: 2, shades: new Uint8Array([1, 1, 1, 1]), alpha: null };
  const art = { oak: null, rival: null, player, shrink1, shrink2 };
  const stage = new IntroStage(art, null, redDownSprite);
  stage.showPlayerAgain();
  stage.step(200);
  stage.startShrink();

  const canvasMod = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
  const { GbCanvas } = canvasMod;
  function pixelAt(offsetFromZero) {
    const fresh = new IntroStage(art, null, redDownSprite);
    fresh.showPlayerAgain();
    fresh.step(200);
    fresh.startShrink();
    fresh.step(offsetFromZero);
    const canvas = new GbCanvas();
    fresh.paint(canvas);
    return canvas.shadeAt(48, 32); // the block's own top-left pixel
  }
  function spritePixelAt(offsetFromZero) {
    const fresh = new IntroStage(art, null, redDownSprite);
    fresh.showPlayerAgain();
    fresh.step(200);
    fresh.startShrink();
    fresh.step(offsetFromZero);
    const canvas = new GbCanvas();
    fresh.paint(canvas);
    return canvas.shadeAt(48 + RED_SPRITE_BLOCK_X, 32 + RED_SPRITE_BLOCK_Y);
  }
  check("offset 0 shows the full picture (shade 1)", pixelAt(0) === 1);
  check("offset 1 already shows shrink1 (shade 2) -- the corrected boundary",
    pixelAt(SHRINK_STAGE_FULL_END) === 2);
  check("offset 41 (one before shrink2's own window) still shrink1's image (shade 2)",
    pixelAt(SHRINK_STAGE_1_END - 1) === 2);
  check("offset 42 shows shrink2 (shade 3)", pixelAt(SHRINK_STAGE_1_END) === 3);
  check("offset 70 (one before the blank gap) still shrink2's own image (shade 3)",
    pixelAt(SHRINK_STAGE_2_END - 1) === 3);
  check("offset 71 is the measured one-frame blank hand-off -- nothing drawn at the block's own top-left",
    pixelAt(SHRINK_STAGE_2_END) === 0);
  check("offset 71 draws nothing at the sprite's own position either",
    spritePixelAt(SHRINK_STAGE_2_END) === 0);
  check("offset 72 shows SPRITE_RED at its own measured position, not the block's top-left",
    spritePixelAt(SHRINK_STAGE_GAP_END) === 1 && pixelAt(SHRINK_STAGE_GAP_END) === 0);
  check("offset 134 (one before \"gone\") still shows SPRITE_RED",
    spritePixelAt(SHRINK_STAGE_SPRITE_END - 1) === 1);
  check("offset 135 is gone -- nothing drawn anywhere in the block",
    pixelAt(SHRINK_STAGE_SPRITE_END) === 0 && spritePixelAt(SHRINK_STAGE_SPRITE_END) === 0);
  check("isShrinkDone() only once gone", !stage.isShrinkDone());
  stage.step(SHRINK_STAGE_SPRITE_END);
  check("isShrinkDone() true past offset 135", stage.isShrinkDone());
}

// ---------------------------------------------------------- the white hold

console.log("=== the white hold ===");
{
  check("62 frames, measured exactly (INTRO.md \"Fade to white\")", WHITE_HOLD_FRAMES === 62);
  const stage = new IntroStage({ oak: null, rival: null, player: null, shrink1: null, shrink2: null }, null, null);
  stage.startWhiteHold();
  check("bgp() is blank the instant the hold starts", stage.bgp() === BGP_BLANK);
  stage.step(WHITE_HOLD_FRAMES - 1);
  check("still blank one frame short of the hold's own length", stage.bgp() === BGP_BLANK && !stage.isWhiteHoldDone());
  stage.step(1);
  check("a hard cut to $E4 the instant the hold's length is reached, not a ramp",
    stage.bgp() === BGP_NORMAL && stage.isWhiteHoldDone());
}

// -------------------------------------------------------- the acknowledgement

console.log("=== the acknowledgement text ids ===");
{
  check("the player's ack id", ACK_TEXT_ID_PLAYER === "_YourNameIsText");
  check("the rival's ack id", ACK_TEXT_ID_RIVAL === "_HisNameIsText");
}

// ---------------------------------------------------------------- the box

console.log("=== CanvasTextBox pace ===");
{
  const MEDIUM = 3;
  check("hard clears are 17 frames, measured on every one of the six in this intro",
    HARD_CLEAR_FRAMES === 17);
  check("the arrow's steady cycle is 34 on, 36 off (INTRO.md's own 33-36/36)",
    ARROW_ON_FRAMES === 34 && ARROW_OFF_FRAMES === 36);

  // Two lines, no scroll and no clear needed for the very first page.
  const box = new CanvasTextBox(MEDIUM);
  box.show([["Hello there!", "General Kenobi"]]);
  const letters = "Hello there!".length + "General Kenobi".length;
  check("not ready before N*speed+1 frames", (() => {
    box.step(letters * MEDIUM); // one frame short
    return !box.ready();
  })());
  box.step(1);
  check("ready exactly at N*speed+1 -- Host.ts's own textReady() formula", box.ready());
  check("both lines fully typed once ready", JSON.stringify(box.visibleLines()) ===
    JSON.stringify(["Hello there!", "General Kenobi"]));
  check("the arrow is not visible before ready()", (() => {
    const b2 = new CanvasTextBox(MEDIUM);
    b2.show([["Hi", "There"]]);
    b2.step(1);
    return !b2.arrowVisible();
  })());
  check("the arrow can be visible once ready()", box.arrowVisible());

  // A cont scroll: the next page's first line equals this page's last.
  const scroll = new CanvasTextBox(MEDIUM);
  scroll.show([["line one", "line two"], ["line two", "line three"]]);
  scroll.step("line one".length * MEDIUM + 100);
  scroll.ack();
  check("a cont scroll does not clear", !scroll.isClearing());
  check("the carried line shows in full immediately, at frame 0 of the new page",
    scroll.visibleLines()[0] === "line two");
  check("the carried line costs no typing frames -- only line 2 is new",
    (() => {
      scroll.step(MEDIUM); // one character's worth of frames at MEDIUM speed
      return scroll.visibleLines()[0] === "line two" && scroll.visibleLines()[1].length === 1;
    })());

  // A hard clear: the next page's first line does NOT equal this page's last.
  const clear = new CanvasTextBox(MEDIUM);
  clear.show([["alpha one", "alpha two"], ["beta one", "beta two"]]);
  clear.step("alpha one".length * MEDIUM + "alpha two".length * MEDIUM + 100);
  clear.ack();
  check("a non-cont transition clears the box", clear.isClearing());
  check("nothing shows while clearing", JSON.stringify(clear.visibleLines()) === JSON.stringify(["", ""]));
  clear.step(HARD_CLEAR_FRAMES - 1);
  check("still clearing one frame short of the clear's own length", clear.isClearing());
  clear.step(1);
  check("typing resumes exactly at the clear's own length", !clear.isClearing());
  check("ack() during a clear is refused (ready() is false while clearing)",
    (() => {
      const c2 = new CanvasTextBox(MEDIUM);
      c2.show([["a", "b"], ["c", "d"]]);
      c2.step(100);
      c2.ack(); // now clearing
      const pageBefore = c2.pageIndex();
      c2.ack(); // must be a no-op
      return c2.pageIndex() === pageBefore;
    })());

  // isOpen()/done, and a single-page text closes on its own ack.
  const single = new CanvasTextBox(MEDIUM);
  single.show([["only line", ""]]);
  single.step("only line".length * MEDIUM + 1);
  check("isOpen() before the last page is acked", single.isOpen());
  single.ack();
  check("isOpen() false once the only page is acked", !single.isOpen());
}

// ----------------------------------------------------------------- selftest

if (process.argv.includes("--selftest")) {
  console.log("=== selftest ===");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try {
      fn();
    } catch (e) {
      fail++;
    } finally {
      console.log = quiet;
    }
    const noticed = fail > before;
    fail = before;
    if (noticed) {
      pass++;
    } else {
      fail++;
      console.log("  FAIL selftest: " + label + " passes even when broken");
    }
  }

  expectFailures("a ramp detector fooled by a flat palette", () => {
    check("ramp shape", JSON.stringify([0xe4, 0xe4, 0xe4]) === JSON.stringify(OAK_FADE_RAMP.map((s) => s.bgp)));
  });
  expectFailures("a slide-length detector fooled by a five-frame table", () => {
    check("slide length", SLIDE_WX_TABLE.length === 5);
  });
  expectFailures("a hard-clear detector that never actually clears", () => {
    const box = new CanvasTextBox(3);
    box.show([["one one one", "two two two"], ["three", "four"]]);
    box.step("one one one".length * 3 + "two two two".length * 3 + 100);
    box.ack();
    box.isClearing = () => false; // simulate a broken implementation
    check("clearing detector", box.isClearing() === true);
  });
  expectFailures("a shrink-stage detector fooled by the wrong boundary", () => {
    check("boundary detector", SHRINK_STAGE_1_END === 55);
  });
}

console.log("");
console.log("INTRO TIMELINE  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
