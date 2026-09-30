// The built-in font: glyphs that owe nothing to the cartridge.
//
// Every other screen in this lens draws with GbFont, which reads its tiles OUT
// OF THE BUNDLE. So the one moment the wearer most needs words -- there is no
// bundle, and the lens is a black rectangle -- is the one moment the cartridge
// font cannot be asked. This table is the answer, and this suite is what says
// the table is actually filled in rather than merely present.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/tinyfont.test.mjs --selftest

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const F = await import("../Assets/Scripts/play/screen/TinyFont.ts");
const {
  TINY_CHARSET, TINY_GLYPHS, GLYPH_W, GLYPH_H, CELL_W, COLUMNS, MARGIN_X,
  hasGlyph, glyphRows, textWidth, inkWidth, drawText, drawCentred, wrap,
} = F;
const C = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { GbCanvas, SCREEN_WIDTH, SCREEN_HEIGHT } = C;

let pass = 0;
let fail = 0;
function check(label, ok, saw) {
  if (ok) { pass++; } else { fail++; console.log("  FAIL " + label + (saw === undefined ? "" : "  saw " + saw)); }
}

/** Every pixel of `shade` on a canvas, as "x,y" strings, sorted. */
function inked(canvas, shade) {
  const out = [];
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      if (canvas.shadeAt(x, y) === shade) { out.push(x + "," + y); }
    }
  }
  return out;
}

console.log("=== the table is filled in, not merely present ===");
{
  check("the charset is not empty", TINY_CHARSET.length > 0, TINY_CHARSET.length);
  check("there is one glyph per character",
        TINY_GLYPHS.length === TINY_CHARSET.length,
        TINY_GLYPHS.length + " glyphs for " + TINY_CHARSET.length + " characters");
  let wrongRows = "";
  let overWide = "";
  for (let i = 0; i < TINY_GLYPHS.length; i++) {
    const rows = TINY_GLYPHS[i];
    const ch = TINY_CHARSET.charAt(i);
    if (!rows || rows.length !== GLYPH_H) { wrongRows += ch; continue; }
    for (let r = 0; r < rows.length; r++) {
      // A row over GLYPH_W bits bleeds sideways into the next cell, which reads
      // as two letters touching and is invisible in a screenshot of one word.
      if (!(rows[r] >= 0 && rows[r] < (1 << GLYPH_W))) { overWide += ch; break; }
    }
  }
  check("every glyph has exactly " + GLYPH_H + " rows", wrongRows === "", wrongRows);
  check("and no row is wider than " + GLYPH_W + " bits", overWide === "", overWide);

  // The assertion that catches a half-typed table: a glyph of all zeros draws
  // nothing, and a page of nothing looks exactly like the black screen the
  // whole wizard exists to replace.
  let blank = "";
  for (let i = 0; i < TINY_GLYPHS.length; i++) {
    const ch = TINY_CHARSET.charAt(i);
    if (ch === " ") { continue; }
    let lit = 0;
    const rows = TINY_GLYPHS[i] || [];
    for (let r = 0; r < rows.length; r++) { lit += rows[r] ? 1 : 0; }
    if (lit === 0) { blank += ch; }
  }
  check("every non-space glyph has ink in it", blank === "", "blank: " + blank);
  check("space has none", (TINY_GLYPHS[TINY_CHARSET.indexOf(" ")] || []).join("") === "0000000");
}

console.log("=== no two characters draw the same thing ===");
{
  const seen = [];
  let clash = "";
  for (let i = 0; i < TINY_GLYPHS.length; i++) {
    const ch = TINY_CHARSET.charAt(i);
    if (ch === " ") { continue; }
    const key = (TINY_GLYPHS[i] || []).join(",");
    if (seen.indexOf(key) >= 0) { clash += ch; }
    seen.push(key);
  }
  check("every glyph is its own shape", clash === "", "duplicates: " + clash);
  // The one that matters on a headset: an IP address read off the glasses.
  // 192.168.1.142 with an O-shaped zero is a number you cannot dictate.
  check("zero is not the letter O",
        glyphRows("0").join(",") !== glyphRows("O").join(","));
}

console.log("=== the shape of A, spelled out here rather than read from there ===");
{
  // Written into the TEST so the table cannot define its own correctness.
  const A = [
    "01110",
    "10001",
    "10001",
    "11111",
    "10001",
    "10001",
    "10001",
  ];
  const rows = glyphRows("A");
  let drawn = "";
  for (let r = 0; r < GLYPH_H; r++) {
    let line = "";
    for (let c = 0; c < GLYPH_W; c++) {
      line += (rows[r] & (1 << (GLYPH_W - 1 - c))) ? "1" : "0";
    }
    drawn += (r > 0 ? "/" : "") + line;
  }
  check("A is the A this test drew", drawn === A.join("/"), drawn);
}

console.log("=== lookup ===");
{
  check("a letter is known", hasGlyph("A"));
  check("lowercase folds to uppercase", hasGlyph("a") && glyphRows("a").join() === glyphRows("A").join());
  check("a digit is known", hasGlyph("7"));
  check("space is known", hasGlyph(" "));
  // Everything a URL, a path or a percentage is made of, because that is what
  // the wizard has to print: ws://192.168.1.142:8781, TOOLS/SERVE-WORLD.SH, 42%.
  const needed = "WS://192.168.1.142:8781 TOOLS/SERVE-WORLD.SH 42% (A) [B] <C> +=*#@ \"'-_,.;!?\\";
  let missing = "";
  for (let i = 0; i < needed.length; i++) {
    if (!hasGlyph(needed.charAt(i))) { missing += needed.charAt(i); }
  }
  check("every character a URL or a path needs is in the font", missing === "", "missing: " + missing);
  check("an unknown character is not claimed", !hasGlyph("^"));
  check("and has no rows", glyphRows("^").length === 0);
  check("nor does the empty string", glyphRows("").length === 0);
}

console.log("=== widths ===");
{
  check("width is one cell per character", textWidth("HELLO", 1) === 5 * CELL_W, textWidth("HELLO", 1));
  check("scale doubles it", textWidth("HELLO", 2) === 2 * textWidth("HELLO", 1));
  check("an unknown character still takes its cell", textWidth("A^B", 1) === 3 * CELL_W);
  check("nothing is nothing", textWidth("", 1) === 0);
  // The layout claim the wizard's copy is checked against: a full line of the
  // widest possible text still fits between the margins.
  check("a full line fits the screen",
        MARGIN_X + inkWidth("X".repeat(COLUMNS), 1) <= SCREEN_WIDTH - MARGIN_X,
        MARGIN_X + inkWidth("X".repeat(COLUMNS), 1));
  check("one more column does not",
        MARGIN_X + inkWidth("X".repeat(COLUMNS + 1), 1) > SCREEN_WIDTH - MARGIN_X);
}

console.log("=== what lands on the canvas ===");
{
  const lower = new GbCanvas();
  const upper = new GbCanvas();
  drawText(lower, "ok", 4, 4, 3, 1);
  drawText(upper, "OK", 4, 4, 3, 1);
  check("lowercase inks exactly what uppercase inks",
        inked(lower, 3).join(" ") === inked(upper, 3).join(" "));
  check("and it inked something", inked(upper, 3).length > 0);

  // An unknown character must ADVANCE, not collapse: a URL with one character
  // the font is missing has to come out too short to read, never silently
  // shorter and plausible.
  const gap = new GbCanvas();
  drawText(gap, "A^B", 0, 0, 3, 1);
  const solo = new GbCanvas();
  drawText(solo, "B", 2 * CELL_W, 0, 3, 1);
  let bOk = true;
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 2 * CELL_W; x < 3 * CELL_W; x++) {
      if (gap.shadeAt(x, y) !== solo.shadeAt(x, y)) { bOk = false; }
    }
  }
  check("an unknown character advances one cell", bOk);
  let middleBlank = true;
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = CELL_W; x < 2 * CELL_W; x++) {
      if (gap.shadeAt(x, y) === 3) { middleBlank = false; }
    }
  }
  check("and draws nothing in the cell it takes", middleBlank);

  const one = new GbCanvas();
  const two = new GbCanvas();
  drawText(one, "READY", 2, 2, 3, 1);
  drawText(two, "READY", 2, 2, 3, 2);
  check("scale 2 lights four times the pixels",
        inked(two, 3).length === 4 * inked(one, 3).length,
        inked(two, 3).length + " vs " + inked(one, 3).length);

  const centred = new GbCanvas();
  drawCentred(centred, "READY", 40, 3, 2);
  const ink = inked(centred, 3);
  let minX = SCREEN_WIDTH;
  let maxX = -1;
  for (let i = 0; i < ink.length; i++) {
    const x = parseInt(ink[i].split(",")[0], 10);
    if (x < minX) { minX = x; }
    if (x > maxX) { maxX = x; }
  }
  check("centred text is centred", Math.abs(minX - (SCREEN_WIDTH - 1 - maxX)) <= 2,
        minX + ".." + maxX);
}

console.log("=== drawing off the edge ===");
{
  const edge = new GbCanvas();
  let threw = "";
  try {
    drawText(edge, "OVERHANG", 158, 140, 3, 2);
    drawText(edge, "BEFORE", -20, -9, 3, 1);
    drawCentred(edge, "A LINE FAR WIDER THAN THE SCREEN COULD EVER BE", 8, 3, 2);
  } catch (e) { threw = String(e); }
  check("nothing throws", threw === "", threw);
  check("out of bounds reads as nothing", edge.shadeAt(-1, 0) === -1 && edge.shadeAt(0, SCREEN_HEIGHT) === -1);
  // Everything it did draw is inside, because there is nowhere else to draw.
  let outside = 0;
  for (let i = 0; i < edge.pixels.length; i++) {
    if (edge.pixels[i] !== 0 && edge.pixels[i] !== 3) { outside++; }
  }
  check("and nothing landed in a shade nobody asked for", outside === 0, outside);
}

console.log("=== wrapping ===");
{
  const w = wrap("COULD NOT REACH THE MAC", 12);
  check("no line is over the column count", w.every((l) => l.length <= 12), JSON.stringify(w));
  check("and no word that fits was split", w.join(" ") === "COULD NOT REACH THE MAC", JSON.stringify(w));
  const long = wrap("WS://192.168.1.142:8781", 8);
  check("a word longer than the line is split, not dropped",
        long.join("") === "WS://192.168.1.142:8781", JSON.stringify(long));
  check("and each piece still fits", long.every((l) => l.length <= 8), JSON.stringify(long));
  check("nothing wraps to nothing", wrap("", 10).length === 0);
  check("a single short word is one line", wrap("READY", 10).length === 1);
  check("runs of spaces do not become empty lines",
        wrap("A    B", 10).length === 1 && wrap("A    B", 10)[0] === "A B");
}

if (SELFTEST) {
  console.log("=== selftest ===");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before;
    fail = before;
    if (noticed) { pass++; } else { fail++; console.log("  FAIL selftest: " + label + " passes even when broken"); }
  }
  expectFailures("a glyph with no ink in it", () => {
    check("blank detector", [0, 0, 0, 0, 0, 0, 0].some((r) => r !== 0));
  });
  expectFailures("a row wider than the cell", () => {
    check("width detector", 0b111111 < (1 << GLYPH_W));
  });
  expectFailures("a zero shaped like an O", () => {
    check("zero detector", glyphRows("0").join() === glyphRows("O").join());
  });
  expectFailures("an unknown character that collapses instead of advancing", () => {
    check("advance detector", textWidth("A^B", 1) === 2 * CELL_W);
  });
  expectFailures("a wrap that drops the tail of a long word", () => {
    check("wrap detector", wrap("WS://192.168.1.142:8781", 8).join("").length < 10);
  });
}

console.log("");
console.log("TINYFONT  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
