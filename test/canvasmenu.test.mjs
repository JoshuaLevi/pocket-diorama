// START's list on the Game Boy screen.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/canvasmenu.test.mjs Assets/Generated/kanto.json
//
// GAME BOY mode used to open the START menu on the pad's panel out in the
// room. CanvasMenu paints MenuController's rows on the screen itself, the way
// the cartridge paints its party and bag: a plate across the width, the
// cursor in column 0, the rows from column 1, two tile rows apart.

import { readFileSync } from "node:fs";
const bundlePath = process.argv[2];
if (!bundlePath) { console.error("usage: canvasmenu.test.mjs <bundle.json>"); process.exit(2); }
globalThis.print = () => {};
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

const { GbCanvas, GbFont, TILE } = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { paintCanvasMenu, canvasMenuHeight, CANVAS_MENU_FIRST_TY, CANVAS_MENU_ROW_STEP,
        CANVAS_MENU_TEXT_TX, CANVAS_MENU_CURSOR_TX, paintCanvasBattleMenu,
        BATTLE_MENU_TY, BATTLE_MENU_TX, BATTLE_MENU_CURSOR_TX, BATTLE_MENU_TEXT_TX }
  = await import("../Assets/Scripts/play/screen/CanvasMenu.ts");
const { MENU_ROWS } = await import("../Assets/Scripts/play/MenuController.ts");

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++; console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}
function ink(c, x, y, w, h) {
  let n = 0;
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) if (c.shadeAt(px, py) === 3) n++;
  return n;
}
const font = new GbFont(bundle);
const rowY = (i) => (CANVAS_MENU_FIRST_TY + i * CANVAS_MENU_ROW_STEP) * TILE;

console.log("=== the list ===");
{
  const c = new GbCanvas();
  c.clear(3);   // dark, so the plate is provably painted
  const rows = ["POKéDEX", "POKéMON", "ITEM", "RED", "SAVE", "OPTION"];
  paintCanvasMenu(c, font, rows, 1);
  check("six rows fit the window", rows.length === MENU_ROWS);
  check("the plate is white under the rows",
        ink(c, 0, 0, 160, canvasMenuHeight(rows.length) * TILE) < 160 * canvasMenuHeight(rows.length) * TILE / 4);
  check("below the plate the screen is untouched", c.shadeAt(80, canvasMenuHeight(rows.length) * TILE + 2) === 3);
  for (let i = 0; i < rows.length; i++) {
    check("row " + i + " has its text from column 1", ink(c, CANVAS_MENU_TEXT_TX * TILE, rowY(i), 24, 8) > 0);
  }
  check("the cursor is on row 1", ink(c, CANVAS_MENU_CURSOR_TX * TILE, rowY(1), 8, 8) > 0);
  check("and on no other row", ink(c, CANVAS_MENU_CURSOR_TX * TILE, rowY(0), 8, 8) === 0 &&
        ink(c, CANVAS_MENU_CURSOR_TX * TILE, rowY(2), 8, 8) === 0);
  check("the rows are two tile rows apart", rowY(1) - rowY(0) === 2 * TILE);
}

console.log("=== an eighteen-column row fits ===");
{
  const c = new GbCanvas();
  const row = "CHARMANDER   20/ 20";   // MenuController's own width
  paintCanvasMenu(c, font, [row.substring(0, 18)], 0);
  check("the last column of an 18-wide row is inside the screen",
        CANVAS_MENU_TEXT_TX + 18 <= 20);
  check("its right end carries ink", ink(c, (CANVAS_MENU_TEXT_TX + 15) * TILE, rowY(0), 24, 8) > 0);
}

console.log("=== nothing to list ===");
{
  const c = new GbCanvas();
  c.clear(3);
  paintCanvasMenu(c, font, [], -1);
  check("an empty list paints nothing", c.shadeAt(0, 0) === 3 && c.shadeAt(80, 40) === 3);
  check("and has no height", canvasMenuHeight(0) === 0);
  const d = new GbCanvas();
  paintCanvasMenu(d, font, ["CANCEL"], -1);
  check("a cursor of -1 draws no arrow", ink(d, 0, rowY(0), 8, 8) === 0);
}

console.log("=== a fight's list stays inside the message box's rows ===");
{
  const c = new GbCanvas();
  c.clear(3);
  const rows = ["SCRATCH        35/35", "GROWL          40/40", "EMBER          25/25", "POKéMON", "ITEM", "RUN"];
  paintCanvasBattleMenu(c, font, rows.map((r) => r.substring(0, 18)), 2);
  check("nothing above row 12 is touched", ink(c, 0, 0, 160, BATTLE_MENU_TY * TILE) === 160 * BATTLE_MENU_TY * TILE,
        "" + ink(c, 0, 0, 160, BATTLE_MENU_TY * TILE));
  check("the left of the box's rows is untouched too", c.shadeAt(8, (BATTLE_MENU_TY + 2) * TILE + 3) === 3);
  for (let i = 0; i < rows.length; i++) {
    check("battle row " + i + " is on its own tile row",
          ink(c, BATTLE_MENU_TEXT_TX * TILE, (BATTLE_MENU_TY + i) * TILE, 24, 8) > 0);
  }
  check("the cursor is on row 2, in column 4",
        ink(c, BATTLE_MENU_CURSOR_TX * TILE, (BATTLE_MENU_TY + 2) * TILE, 8, 8) > 0 &&
        ink(c, BATTLE_MENU_CURSOR_TX * TILE, (BATTLE_MENU_TY + 1) * TILE, 8, 8) === 0);
  check("the last row is the screen's last", BATTLE_MENU_TY + rows.length - 1 === 17);
}

console.log("\nCANVASMENU  " + pass + " pass, " + fail + " fail" + (fail === 0 ? "" : "  BROKEN"));
if (fail > 0) process.exit(1);
