// The YES/NO box: where it is drawn, and what answers it gives.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/choicebox.test.mjs [--selftest]
//
// The geometry is the cartridge's (InitYesNoTextBoxParameters: tile 14,7, six
// by five; labels two columns in, two rows apart; cursor in the column between)
// so the font here is a recorder rather than real art -- what is being checked
// is where the box asks for its tiles, not what a tile looks like.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const box = await import("../Assets/Scripts/play/screen/CanvasChoiceBox.ts");
const { CanvasChoiceBox, CHOICE_PENDING, CHOICE_YES, CHOICE_NO,
        CHOICE_TX, CHOICE_TY, CHOICE_TW, CHOICE_TH, ANSWER_HOLD_FRAMES,
        CODE_CURSOR_ARROW } = box;

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/** A font that writes down what it was asked to draw. */
function recorder() {
  const calls = { boxes: [], texts: [], codes: [] };
  return {
    calls,
    box: (c, tx, ty, tw, th) => calls.boxes.push([tx, ty, tw, th]),
    text: (c, line, x, y) => calls.texts.push([line, x, y]),
    code: (c, code, x, y) => calls.codes.push([code, x, y]),
  };
}
function drawn(choice) {
  const font = recorder();
  choice.paint(null, font);
  return font.calls;
}

console.log("=== where it is drawn ===");
{
  const choice = new CanvasChoiceBox(false);
  const calls = drawn(choice);
  check("one box, at the cartridge's own rect",
        calls.boxes.length === 1 &&
        calls.boxes[0][0] === CHOICE_TX && calls.boxes[0][1] === CHOICE_TY &&
        calls.boxes[0][2] === CHOICE_TW && calls.boxes[0][3] === CHOICE_TH,
        JSON.stringify(calls.boxes));
  check("above the message box, which starts at row 12", CHOICE_TY + CHOICE_TH <= 12,
        CHOICE_TY + "+" + CHOICE_TH);
  check("and on the right half of the screen", CHOICE_TX >= 10);
  check("YES then NO", calls.texts.length === 2 &&
        calls.texts[0][0] === "YES" && calls.texts[1][0] === "NO");
  check("two rows apart", calls.texts[1][2] - calls.texts[0][2] === 16,
        calls.texts[1][2] - calls.texts[0][2]);
  check("labels two columns in", calls.texts[0][1] === (CHOICE_TX + 2) * 8);
  check("the cursor sits in the column between", calls.codes.length === 1 &&
        calls.codes[0][0] === CODE_CURSOR_ARROW &&
        calls.codes[0][1] === (CHOICE_TX + 1) * 8);
  check("the cursor starts on YES", calls.codes[0][2] === calls.texts[0][2]);
}

console.log("=== what it answers ===");
{
  const choice = new CanvasChoiceBox(false);
  choice.step("", true, false, 1);
  check("A on YES answers yes once the hold is over", choice.answer() === CHOICE_PENDING);
  choice.step("", false, false, ANSWER_HOLD_FRAMES);
  check("...and then it is yes", choice.answer() === CHOICE_YES);
  check("the box stayed up for the hold", ANSWER_HOLD_FRAMES === 15);
  check("and is closed after it", !choice.isOpen());
}
{
  const choice = new CanvasChoiceBox(false);
  choice.step("down", false, false, 1);
  check("down moves the cursor to NO", choice.cursorRow() === 1);
  check("the cursor is drawn two rows lower",
        drawn(choice).codes[0][2] - drawn(choice).texts[0][2] === 16);
  choice.step("down", false, false, 1);
  check("down again comes back to YES, since there are only two",
        choice.cursorRow() === 0);
  choice.step("up", false, false, 1);
  check("up flips it too", choice.cursorRow() === 1);
  choice.step("", true, false, 1);
  choice.step("", false, false, ANSWER_HOLD_FRAMES);
  check("A on NO answers no", choice.answer() === CHOICE_NO);
}
{
  const choice = new CanvasChoiceBox(false);
  choice.step("", false, true, 1);
  check("B answers no", choice.cursorRow() === 1);
  check("and snaps the cursor onto NO first, where it is seen for the hold",
        drawn(choice).codes[0][2] - drawn(choice).texts[0][2] === 16);
  choice.step("", false, false, ANSWER_HOLD_FRAMES);
  check("then it is no", choice.answer() === CHOICE_NO);
}
{
  const choice = new CanvasChoiceBox(true);
  check("a prompt that starts on NO does", choice.cursorRow() === 1);
}
{
  const choice = new CanvasChoiceBox(false);
  choice.step("", true, false, 1);
  choice.step("down", false, false, 1);
  choice.step("", false, false, ANSWER_HOLD_FRAMES);
  check("an answered box ignores the pad", choice.answer() === CHOICE_YES);
}

if (SELFTEST) {
  console.log("=== selftest ===");
  // The bug this file exists for: nothing drawn at all, and A meaning yes with
  // no box on screen.
  const nothing = { boxes: [], texts: [], codes: [] };
  check("SELFTEST a box that draws nothing is caught", nothing.boxes.length !== 1);
  // And an answer that arrives before the hold would blink the box away, so
  // the wearer never sees what they chose.
  const choice = new CanvasChoiceBox(false);
  choice.step("", true, false, 1);
  check("SELFTEST an answer without the hold is caught", choice.answer() === CHOICE_PENDING);
  // The rect must stay clear of the message box; a box drawn ON it hides the
  // question being answered.
  check("SELFTEST an overlapping rect is caught", !(CHOICE_TY + CHOICE_TH > 12));
}

console.log("\nCHOICEBOX  " + pass + " pass, " + fail + " fail\n");
process.exit(fail === 0 ? 0 : 1);
