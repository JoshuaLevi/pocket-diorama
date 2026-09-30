// The fight's menu, in a box on the panel.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battlemenubox.test.mjs [--selftest]
//
// The bug this replaces is visible in the 8 September recordings: TACKLE /
// TAIL WHIP / POKeMON / ITEM / RUN written in bare white letters across a
// field of green grass, no box, no border, barely readable. GlyphPanel draws
// glyphs and nothing else -- deliberately, and its header says why -- which was
// fine while the menu sat on the button plate and stopped being fine when the
// plate became buttons.
//
// So the menu moved onto the panel that already carries the text. What a test
// can hold here: that the box is drawn, that everything lands INSIDE it, that
// it is big enough for what it holds, and that it never runs off the screen --
// which is what decides whether the panel's crop can show it.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { paintBattleMenu, battleMenuRect } =
  await import("../Assets/Scripts/play/screen/BattleMenuBox.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
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

const FIGHT = ["TACKLE", "TAIL WHIP", "POKeMON", "ITEM", "RUN"];

console.log("=== there is a box, and everything is in it ===");
{
  const r = recorder();
  const top = paintBattleMenu(r.canvas, r.font, FIGHT, 0);
  const boxes = r.marks.filter((m) => m.kind === "box");
  check("exactly one box", boxes.length === 1, boxes.length);
  const box = boxes[0];
  check("...and it is what the caller was told about", box.y === top, box.y + " vs " + top);
  check("it reaches the bottom of the screen", box.y + box.h === 18,
        JSON.stringify(box));
  check("and stays on the screen", box.x >= 0 && box.x + box.w <= 20,
        JSON.stringify(box));

  // Every glyph inside the border, which is the whole point of having one.
  const inside = r.marks.filter((m) => m.kind !== "box").every((m) => {
    const col = m.px / 8;
    const row = m.py / 8;
    return col > box.x && col < box.x + box.w &&
           row > box.y && row < box.y + box.h;
  });
  check("every row is drawn inside the border", inside,
        JSON.stringify(r.marks.filter((m) => m.kind !== "box").map((m) => [m.px / 8, m.py / 8])));

  const texts = r.marks.filter((m) => m.kind === "text").map((m) => m.s);
  check("every row is drawn", texts.length === FIGHT.length, texts.join("|"));
  check("...in order", texts.join("|") === FIGHT.join("|"), texts.join("|"));
}

console.log("=== the cursor ===");
{
  for (let at = 0; at < FIGHT.length; at++) {
    const r = recorder();
    paintBattleMenu(r.canvas, r.font, FIGHT, at);
    const arrows = r.marks.filter((m) => m.kind === "code");
    check("one arrow on row " + at, arrows.length === 1, arrows.length);
    const label = r.marks.filter((m) => m.kind === "text")[at];
    check("...beside the row it points at", arrows[0].py === label.py,
          arrows[0].py + " vs " + label.py);
    check("...and to its left", arrows[0].px < label.px);
  }
  // No cursor at all is legal: a list being shown rather than chosen from.
  const none = recorder();
  paintBattleMenu(none.canvas, none.font, FIGHT, -1);
  check("no cursor row draws no arrow",
        none.marks.filter((m) => m.kind === "code").length === 0);
}

console.log("=== it fits what it holds ===");
{
  // The widest thing the fight menu can hold, and the widest a bag can.
  const wide = ["TAIL WHIP", "THUNDERSHOCK", "POKeMON", "ITEM", "RUN"];
  const rect = battleMenuRect(wide);
  const widest = wide.reduce((n, s) => (s.length > n ? s.length : n), 0);
  check("the box is wider than its longest row", rect[2] > widest, rect[2] + " vs " + widest);
  check("...and still on the screen", rect[1] >= 0 && rect[1] + rect[2] <= 20,
        JSON.stringify(rect));

  // Six rows is the menu's own cap (MENU_ROWS), so the box can be eight tall.
  const six = battleMenuRect(["A", "B", "C", "D", "E", "F"]);
  check("six rows fit above the bottom edge", six[0] >= 0 && six[0] + six[3] === 18,
        JSON.stringify(six));
  // The crop has to be able to REACH it: the message box alone starts at row
  // 12, so a taller menu is exactly why the caller widens the crop.
  check("...and a full menu starts above the message box", six[0] < 12, six[0]);

  // A short list makes a short box rather than an empty tall one.
  const two = battleMenuRect(["YES", "NO"]);
  check("two rows make a four-row box", two[3] === 4, JSON.stringify(two));
  check("...still anchored to the bottom", two[0] + two[3] === 18);

  // A label longer than the screen must not push the box off it.
  const silly = battleMenuRect(["X".repeat(40)]);
  check("an absurd label cannot push the box off screen",
        silly[1] >= 0 && silly[1] + silly[2] <= 20, JSON.stringify(silly));
}

console.log("=== nothing to draw ===");
{
  const r = recorder();
  const top = paintBattleMenu(r.canvas, r.font, [], 0);
  check("an empty menu draws nothing", r.marks.length === 0);
  check("...and asks for no crop", top === 18, top);
  const n = recorder();
  paintBattleMenu(n.canvas, n.font, null, 0);
  check("and neither does a null one", n.marks.length === 0);
}

if (SELFTEST) {
  console.log("\n== Selftest ==");
  // The old behaviour: glyphs and no box. If the box ever stops being drawn
  // this is what the suite must catch.
  const r = recorder();
  paintBattleMenu(r.canvas, r.font, FIGHT, 0);
  check("SELFTEST the recorder sees a box at all",
        r.marks.filter((m) => m.kind === "box").length === 1);
  check("SELFTEST and it is not zero-sized",
        r.marks[0].w > 1 && r.marks[0].h > 1, JSON.stringify(r.marks[0]));
}

console.log("\nBATTLEMENUBOX  " + pass + " PASS  " + fail + " FAIL  " +
            (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
