// A press while the line is still arriving fills it in.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/texthurry.test.mjs [--selftest]
//
// Asked for on 7 September, to raise the pace. It is a DELIBERATE divergence
// from the cartridge, which ignores A and B until a page has finished printing
// (measured, tools/oracle, 6 September, and enforced by textpace.test.mjs).
// That is why it lives on the diorama's own box and not in GAME BOY mode.
//
// The thing this has to get right is that one press does ONE thing. hurry()
// reports whether it actually skipped anything, so the caller can tell "that
// press filled the line in" from "the line was already up, so that press
// acknowledges it". Get that wrong and a single press fills the page AND turns
// it, so every page is skipped the instant it appears.

globalThis.print = () => {};

const { CanvasTextBox } = await import("../Assets/Scripts/play/screen/CanvasTextBox.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}

/** MEDIUM, the cartridge's default: one new letter every three frames. */
const MEDIUM = 3;
const shown = (box) => box.visibleLines().join("").replace(/\s+$/, "");

console.log("\n== one press fills the line in ==");
{
  const box = new CanvasTextBox(MEDIUM);
  box.show([[["Wild PIDGEY", "appeared!"]][0]]);
  box.step(1);
  check("it starts part-typed", shown(box).length < "Wild PIDGEYappeared!".length,
        JSON.stringify(box.visibleLines()));
  check("and is not ready", !box.ready());

  check("hurry says it skipped something", box.hurry() === true);
  check("the whole page is now up",
        box.visibleLines()[0] === "Wild PIDGEY" && box.visibleLines()[1] === "appeared!",
        JSON.stringify(box.visibleLines()));
  check("and the box is ready for the press that turns the page", box.ready());
}

console.log("\n== the same press must not also turn the page ==");
{
  const box = new CanvasTextBox(MEDIUM);
  box.show([[["one", "two"]][0], [["three", "four"]][0]]);
  box.step(1);
  check("hurry fills page one", box.hurry() === true);
  check("still on page one", box.visibleLines()[0] === "one", JSON.stringify(box.visibleLines()));

  // A second hurry has nothing to do, which is what tells the caller that this
  // press is an acknowledgement rather than a skip.
  check("a second hurry reports nothing skipped", box.hurry() === false);
  box.ack();
  box.hurry();
  check("and only then does the next page come up",
        box.visibleLines()[0] === "three", JSON.stringify(box.visibleLines()));
}

console.log("\n== the awkward moments ==");
{
  // Between two pages the box blanks for a few frames. A press there should
  // land on the next page, not be swallowed.
  const box = new CanvasTextBox(MEDIUM);
  box.show([[["one", "two"]][0], [["three", "four"]][0]]);
  box.hurry();
  box.ack();
  check("the box is clearing between pages", box.isClearing());
  check("a press during the clear still does something", box.hurry() === true);
  check("and lands on the next page whole",
        box.visibleLines()[0] === "three" && box.visibleLines()[1] === "four",
        JSON.stringify(box.visibleLines()));

  // A finished book has nothing left to hurry.
  const last = new CanvasTextBox(MEDIUM);
  last.show([[["only", "page"]][0]]);
  last.hurry();
  last.ack();
  check("a closed box reports nothing skipped", last.hurry() === false);

  // An empty box must not throw.
  const empty = new CanvasTextBox(MEDIUM);
  check("an empty box reports nothing skipped", empty.hurry() === false);
}

console.log("\n== every speed ends up in the same place ==");
{
  for (const speed of [1, 3, 5]) {
    const box = new CanvasTextBox(speed);
    box.show([[["CHARMANDER", "used SCRATCH!"]][0]]);
    box.step(1);
    box.hurry();
    const ok = box.visibleLines()[0] === "CHARMANDER" &&
               box.visibleLines()[1] === "used SCRATCH!" && box.ready();
    check("speed " + speed + " fills in whole", ok, JSON.stringify(box.visibleLines()));
  }
}

if (process.argv.indexOf("--selftest") >= 0) {
  console.log("\n== Selftest: the checks must reject a box that skips pages ==");
  // The failure this is written against: hurry() always answering true, so the
  // caller treats every press as a skip and never turns a page -- or always
  // answering false, so the press turns a page it has not shown yet.
  const box = new CanvasTextBox(MEDIUM);
  box.show([[["one", "two"]][0]]);
  box.hurry();
  check("a ready box answering true would be caught", box.hurry() === false);
}

console.log("\nTEXTHURRY  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
