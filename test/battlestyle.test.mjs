// The question asked at the first fight.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battlestyle.test.mjs [--selftest]
//
// Small, but it holds two things that are easy to get wrong and impossible to
// see in a screenshot: that the ladder WRAPS (a three-value ladder that stops
// at the ends leaves LIFE unreachable from TABLE without going through DISCS,
// which is fine, but a wrap that is off by one leaves one value unreachable
// altogether), and that the box is drawn INSIDE the message box rather than
// over the whole screen -- because the whole design is that the fight staged
// behind it is the preview.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { BattleStyleController, paintBattleStyle, STYLE_OPEN, STYLE_DONE } =
  await import("../Assets/Scripts/play/screen/BattleStyleScreen.ts");
const { BATTLE_LABELS, BATTLE_TABLE, BATTLE_DISCS, BATTLE_LIFE } =
  await import("../Assets/Scripts/play/screen/ViewOptions.ts");
const { defaultOptions, sanitizeOptions } =
  await import("../Assets/Scripts/play/PlayState.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

/** A canvas that records what was drawn where, and nothing else. */
function recorder() {
  const marks = [];
  return {
    marks,
    canvas: {},
    font: {
      box: (c, x, y, w, h) => marks.push({ kind: "box", x, y, w, h }),
      text: (c, s, px, py) => marks.push({ kind: "text", s, px, py }),
      code: (c, n, px, py) => marks.push({ kind: "code", n, px, py }),
    },
  };
}

console.log("=== the ladder ===");
{
  const c = new BattleStyleController(BATTLE_TABLE);
  check("it opens on what the fight is already staged as", c.chosen() === BATTLE_TABLE);
  check("...and stays open until answered", c.step("right", false, false) === STYLE_OPEN);
  check("right steps along it", c.chosen() === BATTLE_DISCS);
  c.step("right", false, false);
  check("and again", c.chosen() === BATTLE_LIFE);
  c.step("right", false, false);
  check("three values wrap", c.chosen() === BATTLE_TABLE);
  c.step("left", false, false);
  check("and wrap the other way", c.chosen() === BATTLE_LIFE);

  // A d-pad has four directions and the wearer has been walking a map with it
  // for an hour. A question that answers only to two reads as half broken.
  const d = new BattleStyleController(BATTLE_TABLE);
  d.step("down", false, false);
  check("down moves too", d.chosen() === BATTLE_DISCS);
  d.step("up", false, false);
  check("and up", d.chosen() === BATTLE_TABLE);

  // Every value is reachable. This is the one the off-by-one breaks.
  const seen = {};
  const walk = new BattleStyleController(BATTLE_TABLE);
  for (let i = 0; i < BATTLE_LABELS.length; i++) {
    seen[walk.chosen()] = true;
    walk.step("right", false, false);
  }
  check("every staging can be reached", Object.keys(seen).length === BATTLE_LABELS.length,
        Object.keys(seen).join(","));
}

console.log("=== answering ===");
{
  const c = new BattleStyleController(BATTLE_DISCS);
  check("A answers it", c.step("", true, false) === STYLE_DONE);
  check("...with whatever the cursor was on", c.chosen() === BATTLE_DISCS);
  const s = new BattleStyleController(BATTLE_TABLE);
  check("START answers it too", s.step("", false, true) === STYLE_DONE);
  // No cancel: the fight is waiting and all three answers are valid, including
  // the one it opened on. B is deliberately not a way out.
  const b = new BattleStyleController(BATTLE_TABLE);
  check("B is not a way out", b.step("", false, false) === STYLE_OPEN);
}

console.log("=== it is drawn in the message box, not over the world ===");
{
  const r = recorder();
  paintBattleStyle(r.canvas, r.font, BATTLE_DISCS);
  const box = r.marks.filter((m) => m.kind === "box");
  check("one box", box.length === 1);
  // Rows 12 to 17 of an 18-row screen: the bottom third. The fight staged
  // above it is the preview, so a full-screen page would defeat the point.
  check("...and it is the message box", box[0].y === 12 && box[0].h === 6,
        JSON.stringify(box[0]));
  const texts = r.marks.filter((m) => m.kind === "text").map((m) => m.s);
  check("it asks the question", texts.join(" ").indexOf("LOOK?") >= 0, texts.join("|"));
  check("and shows the answer", texts.indexOf(BATTLE_LABELS[BATTLE_DISCS]) >= 0,
        texts.join("|"));
  const arrows = r.marks.filter((m) => m.kind === "code");
  check("between two arrows", arrows.length === 2);
  check("...one either side of the label",
        arrows[0].px < arrows[1].px && arrows[1].px - arrows[0].px ===
        (BATTLE_LABELS[BATTLE_DISCS].length + 1) * 8,
        JSON.stringify(arrows));
  // Everything inside the box's own rows.
  const inside = r.marks.every((m) => m.kind === "box" ||
    ((m.py === undefined ? 0 : m.py) >= 12 * 8 && (m.py === undefined ? 0 : m.py) < 18 * 8));
  check("nothing is drawn outside it", inside);

  // Every label fits: the box is 20 tiles wide and the value starts at 8.
  for (let i = 0; i < BATTLE_LABELS.length; i++) {
    const one = recorder();
    paintBattleStyle(one.canvas, one.font, i);
    const marks = one.marks.filter((m) => m.kind === "code");
    check(BATTLE_LABELS[i] + " fits on the line", marks[1].px < 20 * 8,
          marks[1].px / 8 + " of 20");
  }
}

console.log("=== the answer is remembered ===");
{
  const fresh = defaultOptions();
  check("a new game has not been asked", fresh.battleAsked === false);
  // A save written before the question existed has not been asked it either,
  // so anyone mid-playthrough gets it at their next fight.
  const old = { textSpeed: fresh.textSpeed, battleAnimations: true, battleStyle: "SHIFT" };
  check("nor has an older save", sanitizeOptions(old).battleAsked === false);
  check("and a save that says so is believed",
        sanitizeOptions({ ...old, battleAsked: true }).battleAsked === true);
  // Only a real true counts: a hand-edited save carrying a string must not
  // silently swallow the question.
  check("a junk value is not an answer",
        sanitizeOptions({ ...old, battleAsked: "yes" }).battleAsked === false);
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // The paint recorder has to actually see something, or every assertion above
  // passes on an empty list.
  const r = recorder();
  paintBattleStyle(r.canvas, r.font, BATTLE_LIFE);
  check("the recorder records", r.marks.length >= 5, r.marks.length + " marks");
  check("and a different cursor draws a different label",
        r.marks.filter((m) => m.kind === "text").map((m) => m.s)
          .indexOf(BATTLE_LABELS[BATTLE_LIFE]) >= 0);
}

console.log("\nBATTLESTYLE  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
