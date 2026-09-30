// The boot: the Game Boy canvas and font, the title, the main menu, OPTION,
// and the naming screen -- headless.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/bootscreens.test.mjs Assets/Generated/kanto.json --selftest
//
// Every screen here is a picture the cartridge composes from tiles, so every
// claim is a claim about pixels in a buffer: the box has its corner glyph,
// the logo lands where title.asm puts it, START opens the menu only once the
// bounce is over, CONTINUE is offered only with a save, NEW NAME opens the
// grid, seven letters jump the cursor to ED.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: bootscreens.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};

const canvasMod = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { GbCanvas, GbFont, imageFromPacked, SCREEN_WIDTH, SCREEN_HEIGHT,
        CODE_BOX_TL, CODE_CURSOR } = canvasMod;
const titleMod = await import("../Assets/Scripts/play/screen/TitleScreen.ts");
const { TitleController, BootMenuController, TITLE_NONE, TITLE_TO_MENU,
        BOOT_NONE, BOOT_CONTINUE, BOOT_NEW_GAME, BOOT_TO_TITLE, BOOT_NEW_WORLD, TITLE_MONS_RED,
        defaultBootOptions, ribbonFragments, titleMonsFor, BLUE_ROM_SHA1 } = titleMod;
const namingMod = await import("../Assets/Scripts/play/screen/NamingScreen.ts");
const { NamingController, NAMING_NONE, NAMING_DONE, NAME_MAX_LENGTH } = namingMod;
const stateMod = await import("../Assets/Scripts/play/PlayState.ts");
const { sanitizeOptions, newPlayState, migratePlayState,
        TEXT_SPEED_FAST, TEXT_SPEED_SLOW, BATTLE_STYLE_SET, BATTLE_STYLE_SHIFT,
        PLAY_MODE_GAMEBOY, PLAY_MODE_DIORAMA } = stateMod;

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

const NO_PAD = { up: false, down: false, left: false, right: false };
const pad = (dir) => ({ up: dir === "up", down: dir === "down", left: dir === "left", right: dir === "right" });
const FRAME = 1 / 60;

/** Presses a direction for one frame on a controller with step(pad, a, b, ...). */
function tapDir(ctrl, dir, extra) {
  const args = extra ? extra(pad(dir)) : [pad(dir), false, false, FRAME];
  ctrl.step(...args);
  const rel = extra ? extra(NO_PAD) : [NO_PAD, false, false, FRAME];
  ctrl.step(...rel);
}

/** Count the ink pixels in a rectangle of the canvas. */
function ink(canvas, x, y, w, h) {
  let n = 0;
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    if (canvas.shadeAt(px, py) === 3) n++;
  }
  return n;
}

// ------------------------------------------------------------- the bundle
console.log("=== title art in the bundle ===");
{
  check("logo 128x56", bundle.title && bundle.title.logo.width === 128 && bundle.title.logo.height === 56);
  const logo = imageFromPacked(bundle.title.logo);
  let dark = 0;
  for (let i = 0; i < logo.shades.length; i++) if (logo.shades[i] > 0) dark++;
  check("the logo is not blank", dark > 1000 && dark < logo.shades.length, "dark " + dark);
  const player = imageFromPacked(bundle.title.player);
  check("Red's title picture carries a mask", player.alpha !== null);
  check("the font's second sheet is there", bundle.font.extraShades.length > 0);
}

// ------------------------------------------------------------ the canvas
console.log("=== canvas and font ===");
const font = new GbFont(bundle);
{
  const c = new GbCanvas();
  check("a fresh canvas is paper", c.shadeAt(0, 0) === 0 && c.shadeAt(159, 143) === 0);
  check("out of range reads -1", c.shadeAt(-1, 0) === -1 && c.shadeAt(160, 0) === -1);
  c.fillRect(10, 10, 4, 4, 3);
  check("fillRect inks its rectangle and nothing else",
        c.shadeAt(10, 10) === 3 && c.shadeAt(13, 13) === 3 && c.shadeAt(14, 10) === 0);
  check("the font has a border", font.hasBorder());
  check("A has a code at or above the main base", font.codeOf("A") >= 0x80);
  check("é is a glyph", font.codeOf("é") >= 0x80);
  check("an emoji is not", font.codeOf("🙂") === -1);

  const v0 = c.stateVersion();
  font.text(c, "A", 0, 0);
  check("text draws ink", ink(c, 0, 0, 8, 8) > 4, String(ink(c, 0, 0, 8, 8)));
  check("drawing bumps the version", c.stateVersion() > v0);

  c.clear(0);
  font.box(c, 0, 4, 20, 11);
  const corner = ink(c, 0, 32, 8, 8);
  const interior = ink(c, 40, 60, 16, 16);
  check("the box has an inked top-left corner", corner > 0, String(corner));
  check("and a white interior", interior === 0, String(interior));
  const right = ink(c, 152, 60, 8, 8);
  check("and an inked right edge", right > 0);
  c.clear(0);
  font.code(c, CODE_CURSOR, 8, 8);
  check("the cursor arrow is a glyph", ink(c, 8, 8, 8, 8) > 0);

  const rgba = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  c.clear(0);
  c.fillRect(0, 0, 160, 8, 3);
  c.toRgba(rgba, () => [[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]]);
  // Row 0 of the screen is the LAST row of the buffer (setPixels fills bottom-up).
  const lastRow = (SCREEN_HEIGHT - 1) * SCREEN_WIDTH * 4;
  check("toRgba writes bottom-up", rgba[lastRow] === 0 && rgba[0] === 255);
  check("alpha is opaque", rgba[3] === 255);
}

// ------------------------------------------------------------- the title
console.log("=== the title ===");
const art = {
  logo: imageFromPacked(bundle.title.logo),
  version: imageFromPacked(bundle.title.version),
  player: imageFromPacked(bundle.title.player),
  copyright: imageFromPacked(bundle.title.copyright),
  gamefreakInc: imageFromPacked(bundle.title.gamefreakInc),
};
const frontFor = (species) => imageFromPacked(bundle.species[species].front);
{
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const t = new TitleController(art, frontFor, random);
  const c = new GbCanvas();
  t.paint(c);
  // Logo starts 64 px above its rest (scy 0x40): the row at y=8 is still paper.
  check("the logo starts scrolled off the top", ink(c, 16, 8, 128, 8) === 0);
  check("a press during the drop is ignored", t.step(true, false, FRAME) === TITLE_NONE && t.phaseName() === "drop");

  // Drop: 16+4+4+2+2+2+2 = 32 frames, then 36 settle, then 28 ribbon.
  let out = TITLE_NONE;
  for (let f = 0; f < 31; f++) out = t.step(false, false, FRAME);
  check("still dropping after 31 frames", t.phaseName() === "drop");
  for (let f = 0; f < 2; f++) t.step(false, false, FRAME);
  check("settling after the bounce", t.phaseName() === "settle", t.phaseName());
  t.paint(c);
  check("the logo has landed at y=8", ink(c, 16, 8, 128, 56) > 500, String(ink(c, 16, 8, 128, 56)));
  check("no ribbon yet", ink(c, 56, 64, 80, 8) === 0);
  for (let f = 0; f < 36; f++) t.step(false, false, FRAME);
  check("ribbon after the settle", t.phaseName() === "ribbon", t.phaseName());
  for (let f = 0; f < 28; f++) t.step(false, false, FRAME);
  check("looping once the ribbon is in", t.phaseName() === "loop", t.phaseName());
  t.paint(c);
  check("the ribbon reads at (56,64)", ink(c, 56, 64, 80, 8) > 20);
  check("Red stands at (82,80)", ink(c, 82, 80, 40, 56) > 100);
  check("the first title Pokemon is Charmander", t.currentSpecies() === "CHARMANDER");
  check("a Pokemon stands left of Red", ink(c, 40, 80, 56, 56) > 100);

  // The ribbon follows PrintGameVersionOnTitleScreen's tile string: Red's
  // ten-tile graphic is drawn as tiles 0-1 at 56 and tiles 5-9 at 80; Blue's
  // eight-tile graphic (read as eighty pixels with two blank tiles after it)
  // is drawn whole at 56. The old cut was Red's, hard-coded, and drew
  // "Blu  sion" for Blue.
  const frag = ribbonFragments(art.version);
  const blank89 = (() => { let n = 0; for (let y = 0; y < 8; y++) for (let x = 64; x < 80; x++) if (art.version.shades[y * 80 + x]) n++; return n === 0; })();
  check("this cartridge's ribbon is laid out for its own graphic",
        blank89 ? (frag.length === 1 && frag[0][1] === 64 && frag[0][2] === 56)
                : (frag.length === 2 && frag[0][1] === 16 && frag[1][0] === 40 && frag[1][2] === 80),
        JSON.stringify(frag));
  const w = 80;
  const shades = new Uint8Array(w * 8);
  for (let y = 2; y < 6; y++) { for (let x = 0; x < 62; x++) { shades[y * w + x] = 3; } }
  const blueish = ribbonFragments({ width: w, height: 8, shades, alpha: null });
  check("an eight-tile graphic is one run of 64 at 56",
        blueish.length === 1 && blueish[0][0] === 0 && blueish[0][1] === 64 && blueish[0][2] === 56,
        JSON.stringify(blueish));
  for (let y = 2; y < 6; y++) { for (let x = 0; x < 80; x++) { shades[y * w + x] = 3; } }
  const reddish = ribbonFragments({ width: w, height: 8, shades, alpha: null });
  check("a ten-tile graphic is Red's two runs",
        reddish.length === 2 && reddish[1][0] === 40 && reddish[1][2] === 80, JSON.stringify(reddish));
  check("Blue's cartridge cycles Blue's title list, Red's anything else",
        titleMonsFor(BLUE_ROM_SHA1)[0] === "SQUIRTLE" &&
        titleMonsFor("ea9bcae617fdf159b045185467ae58b2e4a48b9a")[0] === "CHARMANDER" &&
        titleMonsFor("")[0] === "CHARMANDER");
  const blueTitle = new TitleController(art, frontFor, () => 0.5, titleMonsFor(BLUE_ROM_SHA1));
  check("a Blue title starts on Blue's first Pokemon", blueTitle.currentSpecies() === "SQUIRTLE",
        blueTitle.currentSpecies());
  check("the copyright line is on the bottom row", ink(c, 16, 136, 128, 8) > 20);

  // The cycle: 200 frames hold, then out, ball (starter), in.
  for (let f = 0; f < 200; f++) t.step(false, false, FRAME);
  for (let f = 0; f < 18 + 10 + 17 + 1; f++) t.step(false, false, FRAME);
  check("a new Pokemon after the first cycle", t.currentSpecies() !== "CHARMANDER", t.currentSpecies());
  check("and it is a title Pokemon", TITLE_MONS_RED.indexOf(t.currentSpecies()) >= 0);

  // START during the loop: an exit beat, then the menu.
  out = t.step(false, true, FRAME);
  check("START starts the exit beat", out === TITLE_NONE && t.phaseName() === "exit");
  let frames = 0;
  while (out === TITLE_NONE && frames < 120) { out = t.step(false, false, FRAME); frames++; }
  check("and hands over to the menu within a second", out === TITLE_TO_MENU, "after " + frames);

  // dt-driven: a stalled frame does not skip the whole drop.
  const t2 = new TitleController(art, frontFor, random);
  t2.step(false, false, 2.0);
  check("a two-second frame ticks at most a handful of game frames", t2.frameCount() <= 4, String(t2.frameCount()));
  t2.restart();
  check("restart goes back to the drop", t2.phaseName() === "drop");

  const palette = TitleController.paletteForRow(bundle.palettes);
  check("logo rows take LOGO2", palette(0) === bundle.palettes.LOGO2 || palette(0)[3][0] === bundle.palettes.LOGO2[3][0]);
  check("the ribbon band keeps LOGO2's white", palette(8)[0][0] === bundle.palettes.LOGO2[0][0]);
  check("the lower rows take MEWMON", palette(12)[3][0] === bundle.palettes.MEWMON[3][0]);
}

// -------------------------------------------------------------- the menu
console.log("=== the main menu ===");
{
  const summary = { playerName: "ASH", badges: 3, dexOwned: 42, playTimeSeconds: 3725 };
  const withSave = new BootMenuController(true, summary, defaultBootOptions());
  const without = new BootMenuController(false, summary, defaultBootOptions());
  const c = new GbCanvas();
  withSave.paint(c, font);
  check("with a save the box is four rows deep (three items)", ink(c, 0, 8 * 7, 8, 8) > 0 && ink(c, 0, 8 * 9, 8, 8) === 0);
  without.paint(c, font);
  check("without a save the box is shorter (two items)", ink(c, 0, 8 * 5, 8, 8) > 0 && ink(c, 0, 8 * 7, 8, 8) === 0);

  check("A on NEW GAME without a save starts a new game",
        without.step(NO_PAD, true, false, FRAME) === BOOT_NEW_GAME);

  check("B on the main menu returns to the title",
        withSave.step(NO_PAD, false, true, FRAME) === BOOT_TO_TITLE);
  check("A on CONTINUE opens the info box, not the game",
        withSave.step(NO_PAD, true, false, FRAME) === BOOT_NONE && withSave.screenName() === "continue");
  withSave.paint(c, font);
  check("the info box shows the name", ink(c, 96, 72, 24, 8) > 0);
  check("and the badge count", ink(c, 128, 88, 16, 8) > 0);
  check("B closes the info box", withSave.step(NO_PAD, false, true, FRAME) === BOOT_NONE && withSave.screenName() === "main");
  withSave.step(NO_PAD, true, false, FRAME);
  check("A confirms CONTINUE", withSave.step(NO_PAD, true, false, FRAME) === BOOT_CONTINUE);

  // OPTION: down twice to OPTION with a save, then A.
  const m = new BootMenuController(true, summary, defaultBootOptions());
  tapDir(m, "down"); tapDir(m, "down");
  check("the cursor reached OPTION", m.cursorRow() === 2);
  m.step(NO_PAD, true, false, FRAME);
  check("OPTION opens the options", m.screenName() === "options");
  tapDir(m, "left");
  check("left on TEXT SPEED goes to FAST", m.options().textSpeed === TEXT_SPEED_FAST);
  tapDir(m, "left");
  check("and does not wrap past FAST", m.options().textSpeed === TEXT_SPEED_FAST);
  tapDir(m, "right"); tapDir(m, "right");
  check("two rights reach SLOW", m.options().textSpeed === TEXT_SPEED_SLOW);
  tapDir(m, "down"); tapDir(m, "right");
  check("BATTLE ANIMATION toggles", m.options().battleAnimations === false);
  tapDir(m, "down"); tapDir(m, "left");
  check("BATTLE STYLE toggles to SET", m.options().battleStyle === BATTLE_STYLE_SET);
  m.paint(c, font);
  check("the options screen draws its labels", ink(c, 8, 8, 80, 8) > 0);

  // PLAY MODE: the lens's own fourth row, above CANCEL now instead of it.
  check("a new boot menu starts on DIORAMA", m.options().playMode === PLAY_MODE_DIORAMA);
  tapDir(m, "down");
  check("down from BATTLE STYLE reaches PLAY MODE, not CANCEL", m.cursorRow() === 3);
  tapDir(m, "left");
  check("left on PLAY MODE switches to GAME BOY", m.options().playMode === PLAY_MODE_GAMEBOY);
  tapDir(m, "right");
  check("right switches it back to DIORAMA", m.options().playMode === PLAY_MODE_DIORAMA);
  tapDir(m, "left");
  m.paint(c, font);
  check("PLAY MODE draws its GAME BOY / DIORAMA values", ink(c, 8, 8 * 11, 120, 8) > 0);

  tapDir(m, "down");
  check("VIEW is the row right after PLAY MODE", m.cursorRow() === 4);
  // A on VIEW opens the lens's own page, and B walks back out of it.
  m.step(NO_PAD, true, false, FRAME);
  check("A on VIEW opens the view page", m.screenName() === "view");
  m.paint(c, font);
  check("the view page draws its rows", ink(c, 8, 8, 140, 40) > 0);
  m.step(NO_PAD, false, true, FRAME);
  check("B walks back to OPTION", m.screenName() === "options");
  check("the cursor is still on VIEW", m.cursorRow() === 4);
  tapDir(m, "down");
  check("CANCEL is the row after VIEW", m.cursorRow() === 5);
  m.step(NO_PAD, true, false, FRAME);
  check("A on CANCEL returns to the main menu", m.screenName() === "main");
  check("the edits survive", m.options().battleStyle === BATTLE_STYLE_SET &&
        m.options().textSpeed === TEXT_SPEED_SLOW && m.options().playMode === PLAY_MODE_GAMEBOY);
}

// ------------------------------------------------------------- options in the save
console.log("=== options in the save ===");
{
  const fresh = newPlayState("abc");
  check("a new game starts with medium text, animations on, SHIFT",
        fresh.options.textSpeed === 3 && fresh.options.battleAnimations === true &&
        fresh.options.battleStyle === BATTLE_STYLE_SHIFT);
  check("and defaults to the diorama play mode", fresh.playMode === PLAY_MODE_DIORAMA);
  const migrated = migratePlayState(JSON.parse(JSON.stringify(Object.assign({}, fresh, { version: 2, options: undefined }))), "abc");
  check("a v2 save gains default options", migrated && migrated.options.textSpeed === 3);
  check("and playMode is diorama on this v2 save too", migrated && migrated.playMode === PLAY_MODE_DIORAMA);
  const poisoned = sanitizeOptions({ textSpeed: 99, battleAnimations: "yes", battleStyle: "SETT" });
  check("junk options are sanitised", poisoned.textSpeed === 3 && poisoned.battleAnimations === true &&
        poisoned.battleStyle === BATTLE_STYLE_SHIFT);
  const keepsChoice = migratePlayState(
    Object.assign({}, JSON.parse(JSON.stringify(fresh)), { playMode: PLAY_MODE_GAMEBOY }), "abc");
  check("a save that chose GAME BOY keeps it through migration",
        keepsChoice && keepsChoice.playMode === PLAY_MODE_GAMEBOY);
}

// ------------------------------------------------------------- the naming screen
console.log("=== naming ===");
{
  const nm = (title, presets) => new NamingController(title, presets, NAME_MAX_LENGTH);
  const args = (p, a, b, start, sel) => [p, !!a, !!b, !!start, !!sel, FRAME];
  const c = new GbCanvas();

  // Presets: down once, A -> RED.
  const n1 = nm("YOUR NAME?", ["RED", "ASH", "JACK"]);
  n1.paint(c, font);
  // Row 2, not 3 (INTRO.md "The naming screen": NEW NAME/RED/ASH/JACK sit at
  // rows 2/4/6/8, one row higher than this file used to check).
  check("the preset menu draws NEW NAME in a box", ink(c, 16, 16, 64, 8) > 0 && ink(c, 0, 0, 8, 8) > 0);
  n1.step(...args(pad("down")));
  n1.step(...args(NO_PAD));
  check("A on the first preset picks it", n1.step(...args(NO_PAD, true)) === NAMING_DONE && n1.result() === "RED");

  // NEW NAME, type A S H, then START.
  const n2 = nm("YOUR NAME?", ["RED", "ASH", "JACK"]);
  check("A on NEW NAME opens the grid", n2.step(...args(NO_PAD, true)) === NAMING_NONE && n2.inGrid());
  n2.step(...args(NO_PAD, true));                 // A at (0,0) = "A"
  check("typed A", n2.typed() === "A");
  // S is row 2 col 0; H is row 0 col 7.
  n2.step(...args(pad("down"))); n2.step(...args(NO_PAD));
  n2.step(...args(pad("down"))); n2.step(...args(NO_PAD));
  n2.step(...args(NO_PAD, true));
  check("typed AS", n2.typed() === "AS", n2.typed());
  n2.step(...args(pad("up"))); n2.step(...args(NO_PAD));
  n2.step(...args(pad("up"))); n2.step(...args(NO_PAD));
  for (let i = 0; i < 7; i++) { n2.step(...args(pad("right"))); n2.step(...args(NO_PAD)); }
  n2.step(...args(NO_PAD, true));
  check("typed ASH", n2.typed() === "ASH", n2.typed());
  // Measured (INTRO.md "The naming screen ... The separate demo"): B has no
  // effect on the grid at all -- it neither erases nor backs out. This file
  // used to expect B to pop the last glyph.
  n2.step(...args(NO_PAD, false, true));
  check("B does nothing on the grid", n2.typed() === "ASH");
  n2.paint(c, font);
  check("the grid draws the title", ink(c, 0, 8, 80, 8) > 0);
  check("and the typed name at (80,16)", ink(c, 80, 16, 24, 8) > 0);
  check("START confirms", n2.step(...args(NO_PAD, false, false, true)) === NAMING_DONE && n2.result() === "ASH");

  // Seven A presses on the same cell fill the name with "A"s; an eighth is
  // silently refused -- there is no ED cell for the cursor to land on
  // (INTRO.md "The naming screen": confirmed by pressing every direction
  // from every edge of the grid, nothing above row 0's letters or below the
  // case row). This file used to expect the cursor to auto-jump to ED.
  const n3 = nm("RIVAL's NAME?", ["BLUE", "GARY", "JOHN"]);
  n3.step(...args(NO_PAD, true));
  for (let i = 0; i < 7; i++) n3.step(...args(NO_PAD, true));
  check("seven letters fill the name", n3.typed() === "AAAAAAA", n3.typed());
  check("the cursor has not moved off the first cell", n3.cursor()[0] === 0 && n3.cursor()[1] === 0);
  check("an eighth press is silently refused, not a confirm",
        n3.step(...args(NO_PAD, true)) === NAMING_NONE && n3.typed().length === 7);
  check("START confirms the seven letters",
        n3.step(...args(NO_PAD, false, false, true)) === NAMING_DONE && n3.result() === "AAAAAAA");

  // SELECT flips case.
  const n4 = nm("YOUR NAME?", ["RED", "ASH", "JACK"]);
  n4.step(...args(NO_PAD, true));
  n4.step(...args(NO_PAD, false, false, false, true));
  check("SELECT flips to lower case", n4.isLowerCase());
  n4.step(...args(NO_PAD, true));
  check("a lower-case letter types", n4.typed() === "a");

  // Measured (INTRO.md "The naming screen ... The separate demo"): START
  // with nothing typed is rejected -- the screen redraws the same grid from
  // scratch rather than falling back to a preset. A fresh grid, since n4
  // already has "a" typed.
  const n4b = nm("YOUR NAME?", ["RED", "ASH", "JACK"]);
  n4b.step(...args(NO_PAD, true));
  check("START with an empty name redraws rather than finishing",
        n4b.step(...args(NO_PAD, false, false, true)) === NAMING_NONE && n4b.isOpen());
  check("the cursor is back on the grid's first cell", n4b.cursor()[0] === 0 && n4b.cursor()[1] === 0);

  // No presets: straight to the grid, as a nickname is.
  const n5 = new NamingController("NICKNAME?", [], 10);
  check("no presets opens the grid at once", n5.inGrid());
}

// ------------------------------------------------------------- NEW WORLD
// A world that is stored on the glasses could not be swapped from inside the
// lens: the cache wins at every start, and the code page is only shown when
// there is no cache. NEW WORLD is the way back to that page. It forgets the
// stored world and nothing else, and it asks first, starting on NO.
console.log("=== NEW WORLD ===");
{
  const summary = { playerName: "ASH", badges: 3, dexOwned: 42, playTimeSeconds: 3725 };
  const c = new GbCanvas();
  const plain = new BootMenuController(true, summary, defaultBootOptions());
  plain.paint(c, font);
  check("without a stored world the menu keeps its three items", ink(c, 0, 8 * 7, 8, 8) > 0 && ink(c, 0, 8 * 9, 8, 8) === 0);

  const m = new BootMenuController(true, summary, defaultBootOptions(), true);
  m.paint(c, font);
  check("a stored world adds a fourth item to the box", ink(c, 0, 8 * 9, 8, 8) > 0 && ink(c, 0, 8 * 11, 8, 8) === 0);
  tapDir(m, "down"); tapDir(m, "down"); tapDir(m, "down");
  check("the cursor reaches NEW WORLD", m.cursorRow() === 3);
  check("A on NEW WORLD asks first", m.step(NO_PAD, true, false, FRAME) === BOOT_NONE && m.screenName() === "forget");
  check("the question starts on NO", m.cursorRow() === 0);
  m.paint(c, font);
  check("the question is drawn", ink(c, 8, 16, 144, 8) > 0);
  check("and its NO and YES", ink(c, 16, 80, 16, 8) > 0 && ink(c, 16, 96, 24, 8) > 0);
  check("A on NO forgets nothing", m.step(NO_PAD, true, false, FRAME) === BOOT_NONE && m.screenName() === "main");
  m.step(NO_PAD, true, false, FRAME);
  check("B backs out of the question without leaving the menu",
        m.step(NO_PAD, false, true, FRAME) === BOOT_NONE && m.screenName() === "main");
  m.step(NO_PAD, true, false, FRAME);
  check("the question starts on NO every time", m.cursorRow() === 0);
  tapDir(m, "down");
  check("down moves to YES", m.cursorRow() === 1);
  check("A on YES forgets the world", m.step(NO_PAD, true, false, FRAME) === BOOT_NEW_WORLD);
  check("and the menu says what to do next", m.screenName() === "forgotten");
  m.paint(c, font);
  check("the closing page is drawn", ink(c, 8, 16, 144, 8) > 0 && ink(c, 8, 64, 144, 8) > 0);
  check("a forgotten world takes no more presses",
        m.step(NO_PAD, true, false, FRAME) === BOOT_NONE && m.step(NO_PAD, false, true, FRAME) === BOOT_NONE
        && m.screenName() === "forgotten");

  // The store refused: the menu is told, and goes back to being a menu.
  const k = new BootMenuController(false, summary, defaultBootOptions(), true);
  tapDir(k, "down"); tapDir(k, "down");
  k.step(NO_PAD, true, false, FRAME); tapDir(k, "down");
  check("NEW WORLD is the last item without a save too", k.step(NO_PAD, true, false, FRAME) === BOOT_NEW_WORLD);
  k.worldKept();
  check("a world that could not be forgotten leaves the menu usable", k.screenName() === "main");

  // The store itself: the world goes, the save stays.
  const kept = {};
  globalThis.persistentStorageSystem = { store: {
    getString: (key) => (key in kept ? kept[key] : ""),
    putString: (key, value) => { kept[key] = value; },
  } };
  const ws = await import("../Assets/Scripts/world/WorldSource.ts");
  ws.storeBundle("{\"maps\":{}}", "abc123");
  kept.save = "THE SAVE";
  check("a stored world is read back", ws.loadCachedBundle() === "{\"maps\":{}}" && ws.cachedBundleSha1() === "abc123");
  check("forgetBundle reports that it forgot", ws.forgetBundle() === true);
  check("a forgotten world is gone", ws.loadCachedBundle() === null && ws.cachedBundleSha1() === "");
  check("and the save is not touched", kept.save === "THE SAVE");
  globalThis.persistentStorageSystem = { store: {
    getString: () => { throw new Error("no store"); },
    putString: () => { throw new Error("no store"); },
  } };
  check("a store that throws is reported as not forgotten", ws.forgetBundle() === false);
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
  expectFailures("a title that never leaves the drop", () => {
    const t = new TitleController(art, frontFor, () => 0.5);
    t.tick = () => TITLE_NONE;
    for (let f = 0; f < 200; f++) t.step(false, false, FRAME);
    check("phase detector", t.phaseName() === "loop");
  });
  expectFailures("a box with no border", () => {
    const c = new GbCanvas();
    c.fillRect(0, 32, 160, 88, 0);
    check("corner detector", ink(c, 0, 32, 8, 8) > 0);
  });
  expectFailures("a menu offering CONTINUE without a save", () => {
    const m = new BootMenuController(true, { playerName: "", badges: 0, dexOwned: 0, playTimeSeconds: 0 }, defaultBootOptions());
    const c = new GbCanvas();
    m.paint(c, font);
    check("item count detector", ink(c, 0, 8 * 7, 8, 8) === 0);
  });
  expectFailures("a NEW WORLD that forgets on NO", () => {
    const m = new BootMenuController(false, { playerName: "", badges: 0, dexOwned: 0, playTimeSeconds: 0 }, defaultBootOptions(), true);
    tapDir(m, "down"); tapDir(m, "down");
    m.step(NO_PAD, true, false, FRAME);
    check("forget detector", m.step(NO_PAD, true, false, FRAME) === BOOT_NEW_WORLD);
  });
  expectFailures("a naming screen that accepts an eighth letter", () => {
    const n = new NamingController("X", [], 7);
    for (let i = 0; i < 7; i++) n.step(NO_PAD, true, false, false, false, FRAME);
    n.glyphs.push("Z");
    check("length detector", n.typed().length <= 7);
  });
}

console.log("");
console.log("BOOTSCREENS  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
