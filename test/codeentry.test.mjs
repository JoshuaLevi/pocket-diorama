// Typing a world code on a D-pad.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/codeentry.test.mjs --selftest
//
// The page runs before there is a world, so like the wizard it is drawn with
// the built-in font, and the strongest assertion is the same one: everything
// it can put on the screen is drawable and fits.

globalThis.print = () => {};

const E = await import("../Assets/Scripts/play/screen/CodeEntry.ts");
const {
  CodeEntry, CODE_ALPHABET, CODE_LENGTH, GRID_COLUMNS, GRID_ROWS,
  CODE_STAY, CODE_DONE, CODE_BACK, normaliseCode, isValidCode, symbolAt,
  GRID_Y, GRID_PITCH_Y, GRID_CELL_W, GRID_CELL_H, GRID_X, CONTROL_Y, CONTROL_W,
  FIELD_Y, FIELD_BOX_H, FOOTER_Y, TITLE_Y,
} = E;
const F = await import("../Assets/Scripts/play/screen/TinyFont.ts");
const { hasGlyph, inkWidth, MARGIN_X, GLYPH_H } = F;
const C = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { GbCanvas, SCREEN_WIDTH, SCREEN_HEIGHT } = C;

let pass = 0;
let fail = 0;
function check(label, ok, saw) {
  if (ok) { pass++; } else { fail++; console.log("  FAIL " + label + (saw === undefined ? "" : "  saw " + saw)); }
}
function press(e, button) {
  return e.step("", button === "A", button === "B", button === "START");
}
function move(e, direction) {
  return e.step(direction, false, false, false);
}

console.log("=== the alphabet ===");
{
  check("thirty-two symbols", CODE_ALPHABET.length === 32, CODE_ALPHABET.length);
  check("...one grid's worth", GRID_COLUMNS * GRID_ROWS === CODE_ALPHABET.length);
  let dup = "";
  for (let i = 0; i < CODE_ALPHABET.length; i++) {
    if (CODE_ALPHABET.indexOf(CODE_ALPHABET.charAt(i)) !== i) { dup += CODE_ALPHABET.charAt(i); }
  }
  check("no symbol twice", dup === "", dup);
  check("no I, O, 0 or 1", "IO01".split("").every((ch) => CODE_ALPHABET.indexOf(ch) < 0));
  check("every symbol is in the font", CODE_ALPHABET.split("").every(hasGlyph));
  let walked = "";
  for (let r = 0; r < GRID_ROWS; r++) { for (let c = 0; c < GRID_COLUMNS; c++) { walked += symbolAt(r, c); } }
  check("the grid walks the alphabet in order", walked === CODE_ALPHABET, walked);
  check("off the grid is nothing", symbolAt(-1, 0) === "" && symbolAt(GRID_ROWS, 0) === "" && symbolAt(0, GRID_COLUMNS) === "");
  check("six symbols long", CODE_LENGTH === 6);
}

console.log("=== normalising and validating ===");
{
  check("upper case, no separators", normaliseCode(" ab-c 234\n") === "ABC234", normaliseCode(" ab-c 234\n"));
  check("valid", isValidCode("ABC234"));
  check("too short", !isValidCode("ABC23"));
  check("too long", !isValidCode("ABC2345"));
  check("an O is not in the alphabet", !isValidCode("ABCO34"));
  check("nor a lower-case letter", !isValidCode("abc234"));
  check("nor nothing", !isValidCode("") && !isValidCode(null));
}

console.log("=== the cursor ===");
{
  const e = new CodeEntry(true);
  check("starts top left", e.cursor()[0] === 0 && e.cursor()[1] === 0);
  move(e, "left");
  check("left from the first column wraps to the last", e.cursor()[1] === GRID_COLUMNS - 1, e.cursor().join(","));
  move(e, "right");
  check("and right wraps back", e.cursor()[1] === 0);
  move(e, "up");
  check("up from the top row lands on the control row", e.cursor()[0] === GRID_ROWS, e.cursor().join(","));
  check("...on DELETE, from the left half", e.cursor()[1] === 0);
  move(e, "right");
  check("right on the control row is OK", e.cursor()[1] === 1);
  move(e, "right");
  check("and wraps back to DELETE", e.cursor()[1] === 0);
  move(e, "down");
  check("down from the control row wraps to the top", e.cursor()[0] === 0, e.cursor().join(","));
  for (let i = 0; i < GRID_ROWS; i++) { move(e, "down"); }
  check("down through the grid reaches the control row", e.cursor()[0] === GRID_ROWS);
  move(e, "up");
  check("and up leaves it onto the bottom letter row", e.cursor()[0] === GRID_ROWS - 1);
  const v = e.stateVersion();
  e.step("", false, false, false);
  check("an idle frame repaints nothing", e.stateVersion() === v);
  move(e, "left");
  check("a move repaints", e.stateVersion() > v);
}

console.log("=== typing ===");
{
  const e = new CodeEntry(true);
  check("A on a letter types it", press(e, "A") === CODE_STAY && e.code() === "A", e.code());
  move(e, "right");
  press(e, "A");
  check("and the next", e.code() === "AB", e.code());
  check("B deletes the last", press(e, "B") === CODE_STAY && e.code() === "A", e.code());
  press(e, "B");
  check("B on an empty code goes back, when there is a back", press(e, "B") === CODE_BACK && e.code() === "");
  const r = new CodeEntry(false);
  check("...and stays when there is not", press(r, "B") === CODE_STAY);
  check("START with nothing typed does not finish", press(e, "START") === CODE_STAY);
  check("but jumps the cursor to OK", e.cursor()[0] === GRID_ROWS && e.cursor()[1] === 1, e.cursor().join(","));
  check("A on OK with nothing typed does nothing", press(e, "A") === CODE_STAY && e.code() === "");
  // Six presses on the first symbol, from a known corner.
  e.reset();
  check("(back at the top left)", e.cursor()[0] === 0 && e.cursor()[1] === 0, e.cursor().join(","));
  for (let i = 0; i < 6; i++) { press(e, "A"); }
  check("six symbols fill the code", e.code() === "AAAAAA", e.code());
  check("and park the cursor on OK", e.cursor()[0] === GRID_ROWS && e.cursor()[1] === 1, e.cursor().join(","));
  check("a seventh is refused", (move(e, "up"), press(e, "A"), e.code()) === "AAAAAA", e.code());
  check("START finishes a full code", press(e, "START") === CODE_DONE);
  move(e, "down");
  check("(on OK)", e.cursor()[0] === GRID_ROWS && e.cursor()[1] === 1, e.cursor().join(","));
  check("and so does A on OK", press(e, "A") === CODE_DONE);
  move(e, "left");
  check("A on DELETE deletes one", press(e, "A") === CODE_STAY && e.code() === "AAAAA", e.code());
  check("the footer changes with the state", e.footer().indexOf("DELETE") >= 0);
  e.reset();
  check("reset clears everything", e.code() === "" && e.cursor()[0] === 0 && e.cursor()[1] === 0);
}

console.log("=== the copy fits and is drawable ===");
{
  const LIMIT = SCREEN_WIDTH - 2 * MARGIN_X;
  const pages = [];
  const a = new CodeEntry(true);
  pages.push(a);
  const b = new CodeEntry(false);
  pages.push(b);
  const c = new CodeEntry(true);
  for (let i = 0; i < 6; i++) { press(c, "A"); }
  pages.push(c);
  let bad = "";
  for (const e of pages) {
    const strings = [e.title(), e.footer()].concat(e.lines());
    for (const s of strings) {
      for (let i = 0; i < s.length; i++) { if (!hasGlyph(s.charAt(i))) { bad += s.charAt(i); } }
      if (inkWidth(s, 1) > LIMIT) { bad += " wide:" + s; }
    }
    if (inkWidth(e.title(), 2) > LIMIT) { bad += " title:" + e.title(); }
  }
  check("every string is in the font and fits", bad === "", bad);
  check("the grid clears the control row", GRID_Y + (GRID_ROWS - 1) * GRID_PITCH_Y + GRID_CELL_H <= CONTROL_Y);
  check("the control row clears the footer", CONTROL_Y + GRID_CELL_H <= FOOTER_Y);
  check("the footer clears the bottom", FOOTER_Y + GLYPH_H <= SCREEN_HEIGHT);
  check("the field clears the grid", FIELD_Y + FIELD_BOX_H <= GRID_Y);
  check("the grid is inside the screen", GRID_X >= 0 && GRID_X + GRID_COLUMNS * GRID_CELL_W <= SCREEN_WIDTH);
  check("two controls span the grid", 2 * CONTROL_W === GRID_COLUMNS * GRID_CELL_W);
}

console.log("=== what lands on the screen ===");
{
  const e = new CodeEntry(true);
  press(e, "A");
  move(e, "right");
  move(e, "down");
  const canvas = new GbCanvas();
  e.paint(canvas);
  function inkInBand(top, height) {
    let n = 0;
    for (let y = top; y < top + height; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) { if (canvas.shadeAt(x, y) === 3) { n++; } }
    }
    return n;
  }
  check("paper, not a slab", canvas.shadeAt(0, 0) === 0);
  check("a title", inkInBand(TITLE_Y, GLYPH_H * 2) > 0);
  check("the typed symbol is in the field", inkInBand(FIELD_Y, FIELD_BOX_H) > 20);
  check("the keyboard is drawn", inkInBand(GRID_Y, GRID_ROWS * GRID_PITCH_Y) > 200);
  // The cursor cell is inverted: its corner is ink, its glyph paper.
  const cx = GRID_X + 1 * GRID_CELL_W;
  const cy = GRID_Y + 1 * GRID_PITCH_Y;
  check("the cursor cell is filled", canvas.shadeAt(cx, cy) === 3 && canvas.shadeAt(cx + GRID_CELL_W - 1, cy + GRID_CELL_H - 1) === 3);
  let paperInCell = 0;
  for (let y = cy; y < cy + GRID_CELL_H; y++) { for (let x = cx; x < cx + GRID_CELL_W; x++) { if (canvas.shadeAt(x, y) === 0) { paperInCell++; } } }
  check("with its glyph in paper", paperInCell > 5 && paperInCell < GRID_CELL_W * GRID_CELL_H / 2, paperInCell);
  const nx = GRID_X;
  check("a cell without the cursor is not filled", canvas.shadeAt(nx, cy) === 0);
  check("the controls are drawn", inkInBand(CONTROL_Y, GRID_CELL_H) > 20);
  check("the footer is drawn", inkInBand(FOOTER_Y, GLYPH_H) > 0);
  let dark = 0;
  for (let i = 0; i < canvas.pixels.length; i++) { if (canvas.pixels[i] === 3) { dark++; } }
  check("mostly paper, for an additive display", dark < canvas.pixels.length / 4, dark);
}

console.log("CODEENTRY  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
