// The view settings page, headless: the ladders, the preset, and what an
// older save opens on.
//
// There used to be a "row that comes and goes" here -- EDGE, offered only while
// CURVE was above zero. Both went on 9 September. CURVE because the world is
// always flat; EDGE because SOFT rounds a square play area off into a circle,
// and the plate's own square sides are what a hand takes hold of, so a rounded
// rim made the model disagree with the grab rule about where the world stops.
// Every row on this page decides something at every moment now, and that is
// asserted below.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/viewoptions.test.mjs --selftest

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const V = await import("../Assets/Scripts/play/screen/ViewOptions.ts");
const {
  ViewOptionsController, defaultViewSettings, sanitiseViewSettings,
  offeredRows, applyPreset, rowValues, rowChosen, rowLabel,
  graphicsRows, centreRows, isGraphicsRow, GRAPHICS_ROWS, ROW_ORDER,
  ROW_TILT, ROW_ZOOM, ROW_SPEED, ROW_BUTTONS,
  ROW_PRESET, ROW_PLACE, ROW_CANCEL, ROW_BATTLE, ROW_TIME, ROW_COLOUR, ROW_SHAPES,
  SHAPE_LABELS, SHAPES_AUTHORED, VIEW_ROWS,
  BATTLE_LABELS, BATTLE_TABLE, BATTLE_LIFE, BATTLE_DISCS, visibleRows, MAX_VISIBLE_ROWS,
  TILT_DEGREES, PRESET_WIDE, PRESET_DIORAMA,
  SPEED_LABELS, SPEED_FACTORS, BUTTONS_LABELS, speedFactor, looseButtonsShown,
} = V;
const { ZOOM_TILES_ACROSS, ZOOM_LABELS, ZOOM_DEFAULT, zoomTilesAcross }
  = await import("../Assets/Scripts/world/PlayArea.ts");

// How many downs it takes to reach a row. Counted in ROW_ORDER, which is the
// order the cursor walks and NOT the order the rows are numbered: the graphics
// rows come first as one unbroken run, so that the cursor crosses between the
// two surfaces exactly once on the way down the page.
const stepsTo = (row) => ROW_ORDER.indexOf(row);

let pass = 0;
let fail = 0;
function check(label, ok) {
  if (ok) { pass++; } else { fail++; console.log("  FAIL " + label); }
}

console.log("=== defaults ===");
{
  const d = defaultViewSettings();
  check("the world is always flat: there is no curve to store", d.curve === undefined);
  check("the tilt starts flat", d.tilt === 0);
  // A play area, not a whole map. ALL was the default until 9 September and
  // it is the most expensive setting in the project: Route 1 is 77,208 quads
  // there and 6,746 in a play area. The glasses overheated on it.
  check("the world is a play area, not the whole map", zoomTilesAcross(d.zoom) === 20, d.zoom);
  check("...which is the Game Boy's own viewport width", d.zoom === ZOOM_DEFAULT);
  // Both of these are answers to a playtest on the glasses, so they are worth
  // stating as defaults rather than leaving to whatever index 0 happens to be.
  check("the game starts at normal speed", speedFactor(d) === 1);
  // The loose buttons are what a wearer with nothing but hands has for B,
  // START and SELECT, so they are there unless something else can press them.
  check("the loose buttons start on AUTO: there with hands alone", looseButtonsShown(d, false));
  check("...and gone the moment a phone or a pad is connected", !looseButtonsShown(d, true));
}

console.log("=== a stored value that makes no sense ===");
{
  check("nothing at all", sanitiseViewSettings(null).zoom === ZOOM_DEFAULT);
  check("a zoom past the ladder", sanitiseViewSettings({ zoom: 99 }).zoom === ZOOM_DEFAULT);
  check("a negative tilt", sanitiseViewSettings({ tilt: -1 }).tilt === 0);
  check("a string", sanitiseViewSettings({ zoom: "wide" }).zoom === defaultViewSettings().zoom);
  // WITH the revision stamp on it. Without one the block is from before
  // revision 2 and ZOOM is one of the rows that revision reclaims, so a bare
  // {zoom: 2} comes back as the default and is right to.
  check("a good value survives",
        sanitiseViewSettings({ zoom: 2, rev: V.VIEW_REVISION }).zoom === 2);
  // A save written before these rows existed has neither field.
  const old = sanitiseViewSettings({ tilt: 0, curve: 0, edge: 0, world: 4 });
  check("a save carrying the dead curve, edge and world keys keeps none of them",
        old.curve === undefined && old.edge === undefined && old.world === undefined);
  check("an older save gets normal speed", speedFactor(old) === 1);
  check("and the buttons on AUTO", old.buttons === 0 && looseButtonsShown(old, false) && !looseButtonsShown(old, true));
  check("a speed past the ladder falls back", speedFactor(sanitiseViewSettings({ speed: 9 })) === 1);
  check("a stored 4X survives", speedFactor(sanitiseViewSettings({ speed: 2 })) === 4);
  // PAD was OFF / ON / MINI until 30 September. Its stored number means
  // nothing on the BUTTONS ladder (MINI would read as OFF), so it is not read.
  check("an old PAD value is not read as a BUTTONS value", sanitiseViewSettings({ pad: 2 }).buttons === 0);
  check("a stored BUTTONS value survives", sanitiseViewSettings({ buttons: 2 }).buttons === 2);
  check("a BUTTONS value past the ladder falls back to AUTO", sanitiseViewSettings({ buttons: 7 }).buttons === 0);
}

console.log("=== no row on the page does nothing ===");
{
  // The rule the CURVE removal had to answer: a row that can be cycled onto
  // and then changes nothing is indistinguishable from a broken lens.
  const flat = defaultViewSettings();
  check("every row is offered, always", offeredRows(flat).length === VIEW_ROWS);
  check("and the page is fourteen rows", VIEW_ROWS === 14, String(VIEW_ROWS));
  const c = new ViewOptionsController(flat);
  c.step("down", false, false);
  check("ZOOM is the second row now that CURVE and EDGE are gone",
        c.cursorRow() === ROW_ZOOM);
  c.step("right", false, false);
  check("and it cycles", c.values().zoom !== flat.zoom);
  check("there is no CURVE row left", V.ROW_CURVE === undefined);
  check("nor a WORLD row", V.ROW_WORLD === undefined);
  check("nor an EDGE row", V.ROW_EDGE === undefined);
  check("and no ladder for one", V.EDGE_LABELS === undefined);
}

console.log("=== the ladders ===");
{
  const c = new ViewOptionsController(defaultViewSettings());
  check("the cursor starts on TILT", c.cursorRow() === ROW_TILT);
  c.step("right", false, false);
  check("right steps the tilt on", c.values().tilt === 1);
  for (let i = 0; i < TILT_DEGREES.length; i++) c.step("right", false, false);
  check("the ladder wraps", c.values().tilt === 1);
  c.step("left", false, false);
  check("left steps it back", c.values().tilt === 0);

  // A is the same as right, except on CANCEL.
  const a = new ViewOptionsController(defaultViewSettings());
  a.step("", true, false);
  check("A steps a row too", a.values().tilt === 1);
}

console.log("=== walking down the page ===");
{
  const c = new ViewOptionsController(defaultViewSettings());
  c.step("down", false, false);
  check("TILT to ZOOM", c.cursorRow() === ROW_ZOOM);
  c.step("down", false, false);
  check("ZOOM to TIME", c.cursorRow() === ROW_TIME);
  c.step("down", false, false);
  check("TIME to COLOUR", c.cursorRow() === ROW_COLOUR);
  c.step("down", false, false);
  check("COLOUR to SHAPES", c.cursorRow() === ROW_SHAPES);
  // The graphics rows end here and the rest of the page begins. It is one
  // crossing, and it is the one the two surfaces are split on.
  c.step("down", false, false);
  check("SHAPES to SPEED", c.cursorRow() === ROW_SPEED);
  c.step("down", false, false);
  check("SPEED to BUTTONS", c.cursorRow() === ROW_BUTTONS);
  c.step("down", false, false);
  // CONTROLS sits next to PAD: the two rows about the CONTROLLER rather than
  // about the world, so a wearer looking for one finds the other.
  check("BUTTONS to CONTROLS", c.cursorRow() === V.ROW_CONTROLS);
  c.step("down", false, false);
  check("CONTROLS to BATTLE", c.cursorRow() === ROW_BATTLE);
  c.step("down", false, false);
  check("BATTLE to MODE", c.cursorRow() === V.ROW_MODE);
  c.step("down", false, false);
  check("MODE to PRESET", c.cursorRow() === ROW_PRESET);
  c.step("down", false, false);
  check("PRESET to PLACE", c.cursorRow() === ROW_PLACE);
  c.step("down", false, false);
  check("PLACE to FIND PAD", c.cursorRow() === V.ROW_FINDPAD);
  c.step("down", false, false);
  check("FIND PAD to CANCEL", c.cursorRow() === ROW_CANCEL);
  c.step("down", false, false);
  check("and round to the top", c.cursorRow() === ROW_TILT);
  c.step("up", false, false);
  check("up wraps the other way", c.cursorRow() === ROW_CANCEL);
}

console.log("=== the ZOOM row ===");
{
  const c = new ViewOptionsController(defaultViewSettings());
  c.step("down", false, false);
  check("ZOOM is the second row", c.cursorRow() === ROW_ZOOM);
  check("it opens on 20 tiles across", zoomTilesAcross(c.values().zoom) === 20);
  check("and the page prints the tile count itself",
        rowValues(ROW_ZOOM)[rowChosen(ROW_ZOOM, c.values())] === "20");
  check("the row is called ZOOM", rowLabel(ROW_ZOOM) === "ZOOM");

  c.step("right", false, false);
  check("right widens it to 28", zoomTilesAcross(c.values().zoom) === 28);
  c.step("right", false, false);
  check("and again to 40", zoomTilesAcross(c.values().zoom) === 40);
  c.step("right", false, false);
  check("the ladder wraps round to the tightest", zoomTilesAcross(c.values().zoom) === 14);
  c.step("left", false, false);
  check("left goes the other way", zoomTilesAcross(c.values().zoom) === 40);

  // Every rung must be a real tile count the terrain can build, in the same
  // order the page walks: a rung whose label and window disagreed is exactly
  // what the WORLD row was.
  let walked = [];
  const d = new ViewOptionsController(defaultViewSettings());
  for (let i = 0; i < ROW_ZOOM; i++) d.step("down", false, false);
  for (let i = 0; i < ZOOM_TILES_ACROSS.length; i++) {
    walked.push(zoomTilesAcross(d.values().zoom));
    d.step("right", false, false);
  }
  walked.sort((a, b) => a - b);
  check("the row walks the whole ladder and nothing else",
        JSON.stringify(walked) === JSON.stringify(ZOOM_TILES_ACROSS.slice().sort((a, b) => a - b)),
        JSON.stringify(walked));
  check("and every label is its own number",
        rowValues(ROW_ZOOM).every((s, i) => s === String(ZOOM_TILES_ACROSS[i])));
}

console.log("=== the preset ===");
{
  const c = new ViewOptionsController(defaultViewSettings());
  // Down to PRESET. Counted by the row constant, not by a literal: the literals
  // that stood here said 5, 6, 8 and 11, and removing one row made all four wrong
  // in the same minute.
  for (let i = 0; i < ROW_PRESET; i++) c.step("down", false, false);
  check("on PRESET", c.cursorRow() === ROW_PRESET);
  c.step("right", false, false);
  const v = c.values();
  check("DIORAMA narrows what is built", zoomTilesAcross(v.zoom) === ZOOM_TILES_ACROSS[0]);
  c.step("left", false, false);
  const wide = c.values();
  // FLAT was the other preset's name while there was a CURVE row to flatten.
  // Nothing bends any more, so the name says what it does: as much world as
  // the ladder offers. Neither preset carries a rim setting; the slab's own
  // square sides are the rim.
  check("no preset leaves an edge behind",
        wide.edge === undefined && v.edge === undefined);
  check("and opens the ladder right up",
        zoomTilesAcross(wide.zoom) === ZOOM_TILES_ACROSS[ZOOM_TILES_ACROSS.length - 1]);
  check("neither preset leaves a curve behind", wide.curve === undefined && v.curve === undefined);
  check("nothing was mutated in place",
        defaultViewSettings().zoom === ZOOM_DEFAULT);
  check("the page names them WIDE and DIORAMA",
        PRESET_WIDE === "WIDE" && PRESET_DIORAMA === "DIORAMA" &&
        rowValues(ROW_PRESET).indexOf("WIDE") > 0 && rowValues(ROW_PRESET).indexOf("DIORAMA") > 0);

  // A preset is about what the world LOOKS like. Speed and the plate are not,
  // and a preset that reset them would undo a setting nobody asked it to touch.
  const kept = applyPreset(PRESET_DIORAMA, { tilt: 0, edge: 0, zoom: 3, speed: 2, buttons: 2 });
  check("a preset keeps the game speed", speedFactor(kept) === 4);
  check("and keeps the buttons where the wearer put them", kept.buttons === 2 && !looseButtonsShown(kept, false));
  const back = applyPreset(PRESET_WIDE, kept);
  check("and so does the other one", speedFactor(back) === 4 && back.buttons === 2);
}

console.log("=== the two rows the glasses playtest asked for ===");
{
  const c = new ViewOptionsController(defaultViewSettings());
  for (let i = 0; i < stepsTo(ROW_SPEED); i++) c.step("down", false, false);
  check("SPEED is reachable", c.cursorRow() === ROW_SPEED);
  c.step("right", false, false);
  check("right doubles it", speedFactor(c.values()) === 2);
  c.step("right", false, false);
  check("and again", speedFactor(c.values()) === 4);
  c.step("right", false, false);
  check("the ladder wraps back to normal", speedFactor(c.values()) === 1);
  c.step("left", false, false);
  check("left goes the other way", speedFactor(c.values()) === 4);

  c.step("down", false, false);
  check("BUTTONS is the next row", c.cursorRow() === ROW_BUTTONS && rowLabel(ROW_BUTTONS) === "BUTTONS");
  check("it starts on AUTO", c.values().buttons === 0);
  c.step("right", false, false);
  check("ON shows them even with a controller connected", looseButtonsShown(c.values(), true));
  c.step("right", false, false);
  check("OFF hides them even with hands alone", !looseButtonsShown(c.values(), false));
  c.step("right", false, false);
  check("and round again is AUTO", c.values().buttons === 0);

  check("the speed ladder and its factors are the same length",
        SPEED_LABELS.length === SPEED_FACTORS.length);
  check("the buttons ladder is AUTO, ON, OFF", BUTTONS_LABELS.join(",") === "AUTO,ON,OFF");
}

console.log("=== where a fight is staged ===");
{
  const d = defaultViewSettings();
  // The whole point of the row: an encounter must NOT swallow the room by
  // default. The 7 September recording is what the other default looks like,
  // and the 10 September one is what it looks like when a wearer chose LIFE
  // once, weeks earlier, and every fight since has been staged in his lounge.
  //
  // TABLE, not DISCS. DISCS was the default for two days on the argument that
  // scenery gets between the wearer and the fight, which is true and is why
  // DISCS is still one press away. It was never an argument for OPENING there:
  // TABLE is the reference's own primary staging, it keeps the town behind the
  // pair, and it is what Joshua asked for on 10 September.
  check("a fresh lens stages battles on the table", d.battle === BATTLE_TABLE);
  check("and TABLE is the first rung", BATTLE_LABELS[BATTLE_TABLE] === "TABLE");
  check("with LIFE as the one you ask for", BATTLE_LABELS[BATTLE_LIFE] === "LIFE");
  check("and DISCS between them", BATTLE_LABELS[BATTLE_DISCS] === "DISCS");

  // A row that can be cycled onto and does nothing is a broken lens; every
  // rung offered here has to be one the lens can actually stage.
  check("no rung is offered that cannot be drawn", BATTLE_LABELS.length === 3);
  check("and the three are distinct",
        BATTLE_TABLE !== BATTLE_DISCS && BATTLE_DISCS !== BATTLE_LIFE);

  const c = new ViewOptionsController(defaultViewSettings());
  for (let i = 0; i < stepsTo(ROW_BATTLE); i++) c.step("down", false, false);
  check("BATTLE is reachable from the top", c.cursorRow() === ROW_BATTLE);
  check("it starts on the default", c.values().battle === BATTLE_TABLE);
  c.step("right", false, false);
  check("and steps to DISCS", c.values().battle === BATTLE_DISCS);
  c.step("right", false, false);
  check("and on to LIFE", c.values().battle === BATTLE_LIFE);
  c.step("right", false, false);
  check("and wraps back round", c.values().battle === BATTLE_TABLE);

  // A preset changes what the world LOOKS like, never where a fight happens.
  const asked = { tilt: 0, curve: 0, edge: 0, world: 4, speed: 0, pad: 0, battle: BATTLE_LIFE,
                  time: 0, colour: 1 };
  check("DIORAMA leaves the battle staging alone",
        applyPreset("DIORAMA", asked).battle === BATTLE_LIFE);
  check("and so does FLAT", applyPreset("FLAT", asked).battle === BATTLE_LIFE);

  // A save written before this row existed must not come back as LIFE.
  check("a save from before the row takes the current default",
        sanitiseViewSettings({ tilt: 0, curve: 0, edge: 0, world: 4 }).battle === BATTLE_TABLE);

  // ...and neither must one written AFTER it. This is the case the row was
  // stuck on: "de battles staan als default op real world" was a save from
  // 20 August carrying battle: 2, faithfully restored every session since,
  // and no edit to defaultViewSettings() could ever have reached it.
  check("and a stored LIFE from before this revision is handed back",
        sanitiseViewSettings({ tilt: 0, zoom: 2, speed: 1, pad: 0, battle: BATTLE_LIFE,
                               time: 0, colour: 1, shapes: 1, mode: 1 })
          .battle === BATTLE_TABLE);
  // ...but only ONCE. A wearer who grows the world on purpose meant it, which
  // is the whole difference between this row and PLAY MODE.
  const migrated = sanitiseViewSettings({ tilt: 0, zoom: 2, speed: 1, pad: 0,
                                          battle: BATTLE_LIFE, time: 0, colour: 1,
                                          shapes: 1, mode: 1 });
  migrated.battle = BATTLE_LIFE;
  migrated.zoom = 3;
  check("a LIFE chosen since the revision is kept",
        sanitiseViewSettings(migrated).battle === BATTLE_LIFE);
  check("and so is the rest of the block",
        sanitiseViewSettings(migrated).zoom === 3);
}

console.log("=== revision 2 reclaims the zoom, once ===");
{
  // Measured over all 222 maps: the worst emits 21,303 quads at ZOOM 20 and
  // 65,171 at ZOOM 40. Joshua set 40 by hand at 15:22 on 10 September, and
  // from 16:41 every session restored it -- the heaviest scene this lens can
  // build, every run, on glasses that then overheated. See test/geometrybudget.
  const stored = { tilt: 0, zoom: 3, speed: 0, pad: 0, battle: BATTLE_TABLE,
                   time: 0, colour: 4, shapes: 0, mode: 1, rev: 1 };
  check("a ZOOM 40 stored against revision 1 opens on the default",
        sanitiseViewSettings(stored).zoom === ZOOM_DEFAULT);
  check("...and the default is not the heaviest rung",
        ZOOM_DEFAULT < ZOOM_TILES_ACROSS.length - 1);
  // Once. The ladder still has 40 on it and it is still one press away; what
  // the revision reclaims is where he STARTS.
  const after = sanitiseViewSettings(stored);
  after.zoom = ZOOM_TILES_ACROSS.length - 1;
  check("a ZOOM chosen since the revision is kept",
        sanitiseViewSettings(after).zoom === ZOOM_TILES_ACROSS.length - 1);
  check("the heaviest rung is still on the ladder",
        ZOOM_TILES_ACROSS[ZOOM_TILES_ACROSS.length - 1] === 40);
  // A block with no stamp at all is older than revision 1 and gets the same
  // treatment: this is what every save on disk before tonight looks like.
  check("an unstamped save opens on the default too",
        sanitiseViewSettings({ tilt: 0, zoom: 3 }).zoom === ZOOM_DEFAULT);
  check("and zoom is named in the migrated rows",
        V.MIGRATED_ROWS.indexOf("zoom") >= 0);
}

console.log("=== the hour and the colour ===");
{
  const D = await import("../Assets/Scripts/world/DayTint.ts");
  const d = defaultViewSettings();
  // DAY and a gentle lift: the world we have been looking at all along, with
  // its colours a little further from grey.
  check("a fresh lens is lit at noon", d.time === D.TIME_DAY);
  check("with a colour lift", D.SATURATION_LEVELS[d.colour] > 1);
  // HIGH, measured on the glasses. See DayTint's SATURATION_HIGH for the
  // numbers off the 10 September recording; the short version is that it is
  // the top of this ladder on colour, on light and on value spread at once.
  check("all the colour the ladder has", d.colour === D.SATURATION_HIGH);
  check("which is not the legibility regrade", D.LEGIBILITY_LEVELS[d.colour] === 0);

  const c = new ViewOptionsController(defaultViewSettings());
  for (let i = 0; i < stepsTo(ROW_TIME); i++) c.step("down", false, false);
  check("TIME is reachable", c.cursorRow() === ROW_TIME);
  c.step("right", false, false);
  check("and steps on", c.values().time === 1);
  for (let i = 0; i < D.TIME_LABELS.length - 1; i++) c.step("right", false, false);
  check("and wraps", c.values().time === 0);

  c.step("down", false, false);
  check("COLOUR is the next row", c.cursorRow() === ROW_COLOUR);
  c.step("right", false, false);
  check("and wraps off the top rung", c.values().colour === 0);

  // Neither is what the world is SHAPED like, so a preset must not touch them.
  const asked = { tilt: 0, curve: 0, edge: 0, world: 4, speed: 0, pad: 0,
                  battle: 0, time: D.TIME_NIGHT, colour: 3 };
  check("DIORAMA leaves the hour alone", applyPreset("DIORAMA", asked).time === D.TIME_NIGHT);
  check("and the colour", applyPreset("DIORAMA", asked).colour === 3);
  check("so does FLAT", applyPreset("FLAT", asked).time === D.TIME_NIGHT);

  // A save from before these rows takes the defaults rather than index 0 twice.
  const old = sanitiseViewSettings({ tilt: 0, curve: 0, edge: 0, world: 4 });
  check("an older save is lit at noon", old.time === d.time);
  check("and keeps the default lift", old.colour === d.colour);
}

console.log("=== the page has a bottom ===");
{
  // Nine rows on a page that fits eight: the ninth used to land on the frame.
  const nine = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  check("a ladder that fits is shown whole",
        visibleRows([0, 1, 2], 0).length === 3);
  check("a longer one is cut to what fits",
        visibleRows(nine, 0).length === MAX_VISIBLE_ROWS);
  check("the top of the ladder starts at the top",
        visibleRows(nine, 0)[0] === 0);
  check("the bottom of the ladder ends at the bottom",
        visibleRows(nine, 8)[MAX_VISIBLE_ROWS - 1] === 8);
  check("it never scrolls past the end",
        visibleRows(nine, 8)[0] === nine.length - MAX_VISIBLE_ROWS);
  for (let row = 0; row < nine.length; row++) {
    const shown = visibleRows(nine, row);
    if (shown.indexOf(row) < 0) {
      check("every row can be seen when the cursor is on it (row " + row + ")", false);
      break;
    }
    if (row === nine.length - 1) {
      check("every row can be seen when the cursor is on it", true);
    }
  }
}

console.log("=== the shape library has its own row ===");
{
  const base = defaultViewSettings();
  check("the lens opens with the shape library", base.shapes === V.SHAPES_AUTHORED);
  check("...and VOXEL is the other end of that ladder", SHAPE_LABELS.length === 2);
  // Both presets are about the CAMERA. Neither may quietly take the shape
  // library away, which would read as the preset breaking the world.
  const voxel = { ...base, shapes: 1 };
  check("FLAT carries SHAPES through", applyPreset("FLAT", voxel).shapes === 1);
  check("DIORAMA carries SHAPES through", applyPreset("DIORAMA", voxel).shapes === 1);
  // A save written before the row existed opens on the CURRENT default rather
  // than on undefined, which is what clampIndex is there for.
  const old = { tilt: 0, curve: 0, edge: 0, world: 4, speed: 0, pad: 0, battle: 0,
                time: 0, colour: 1 };
  check("a save from before the row still opens",
        sanitiseViewSettings(old).shapes === base.shapes);
}

console.log("=== leaving ===");
{
  const c = new ViewOptionsController(defaultViewSettings());
  check("B closes the page", c.step("", false, true) === "close");
  const d = new ViewOptionsController(defaultViewSettings());
  for (let i = 0; i < ROW_CANCEL; i++) d.step("down", false, false);
  check("the walk down ends on CANCEL", d.cursorRow() === ROW_CANCEL);
  check("A on CANCEL closes it", d.step("", true, false) === "close");
  const e = new ViewOptionsController(defaultViewSettings());
  check("A anywhere else does not", e.step("", true, false) === "");
}

console.log("=== PLACE puts the world down again ===");
{
  // The one row that answers something other than open or closed, because the
  // wearer standing up or turning their chair leaves the world facing the way
  // they used to be -- and with it the d-pad, since UP on the pad is north on
  // the map.
  const c = new ViewOptionsController(defaultViewSettings());
  for (let i = 0; i < stepsTo(ROW_PLACE); i++) c.step("down", false, false);
  check("PLACE is two above CANCEL", c.cursorRow() === ROW_PLACE);
  check("A on it asks for a re-place", c.step("", true, false) === "place");
  // ...and does not also cycle a ladder that is not there, nor close the page
  // by the back door.
  // stepsTo, not a hand-counted ten: the page grew a row on 10 September and a
  // literal walked the cursor onto PRESET, which DOES change four settings on
  // A -- so the check passed its own assertion for the wrong reason and then
  // failed it for the right one.
  const d = new ViewOptionsController(defaultViewSettings());
  for (let i = 0; i < stepsTo(ROW_PLACE); i++) d.step("down", false, false);
  check("...from PLACE itself", d.cursorRow() === ROW_PLACE);
  const before = JSON.stringify(d.values());
  d.step("", true, false);
  check("and changes no setting doing it", JSON.stringify(d.values()) === before);
  // B on PLACE still just closes, like B anywhere.
  const e = new ViewOptionsController(defaultViewSettings());
  for (let i = 0; i < 10; i++) e.step("down", false, false);
  check("B on PLACE closes rather than places", e.step("", false, true) === "close");
}

console.log("=== the two halves of the page ===");
{
  // The graphics rows are painted on a panel BESIDE the diorama and the rest
  // on the centred one, so that changing TILT or COLOUR is done while looking
  // at the world instead of at a white rectangle hanging over it. That split
  // is a claim about which row is which, and it is stated here rather than in
  // the scene, where it could only be checked by putting the glasses on.
  const flat = defaultViewSettings();
  const beside = graphicsRows(flat);
  const centred = centreRows(flat);
  const all = offeredRows(flat);
  check("between them they are the whole page", beside.length + centred.length === all.length);
  let overlap = false;
  for (const row of beside) if (centred.indexOf(row) >= 0) overlap = true;
  check("and no row is on both surfaces", !overlap);
  check("every row the page walks is a row it has",
        ROW_ORDER.length === VIEW_ROWS && all.length === VIEW_ROWS);

  // The four Joshua named on 9 September...
  check("TILT is beside the world", isGraphicsRow(ROW_TILT));
  check("and ZOOM", isGraphicsRow(ROW_ZOOM));
  check("and COLOUR", isGraphicsRow(ROW_COLOUR));
  check("and SHAPES", isGraphicsRow(ROW_SHAPES));
  // ...plus the one that cannot be separated from them: TIME and COLOUR are two
  // multiplies inside the same palette texture. CURVE and EDGE were on this list
  // when it was written and have both gone since, which is why the page beside
  // the world is five rows and not seven.
  check("TIME goes with the COLOUR it shares a palette with", isGraphicsRow(ROW_TIME));
  check("and the page beside the world is five rows", GRAPHICS_ROWS.length === 5,
        String(GRAPHICS_ROWS.length));

  // MODE decides more about how the world looks than any graphics row, and it
  // must NOT be one. The graphics page is drawn beside the diorama, and in GAME
  // BOY mode there is no diorama to draw it beside: a row that moves itself out
  // of reach is a row you cannot come back through, which is exactly the
  // one-way door it was added to close.
  check("MODE stays on the centred page, where it is reachable in either mode",
        !isGraphicsRow(V.ROW_MODE));
  check("and it offers both modes", V.MODE_LABELS.length === 2);
  check("a new lens is a diorama", defaultViewSettings().mode === V.MODE_DIORAMA);
  check("no preset may drop the wearer onto a flat screen",
        applyPreset(PRESET_DIORAMA, { ...flat, mode: V.MODE_DIORAMA }).mode === V.MODE_DIORAMA &&
        applyPreset(PRESET_WIDE, { ...flat, mode: V.MODE_DIORAMA }).mode === V.MODE_DIORAMA);
  check("nor silently switch one back on",
        applyPreset(PRESET_WIDE, { ...flat, mode: V.MODE_GAMEBOY }).mode === V.MODE_GAMEBOY);
  check("a save from before the row opens as a diorama",
        sanitiseViewSettings({ tilt: 0 }).mode === V.MODE_DIORAMA);

  // What the world LOOKS like moves; what it DOES stays where it was.
  check("SPEED stays on the centred page", !isGraphicsRow(ROW_SPEED));
  check("and BUTTONS", !isGraphicsRow(ROW_BUTTONS));
  check("and BATTLE", !isGraphicsRow(ROW_BATTLE));
  check("and PRESET, which is a button and not a look", !isGraphicsRow(ROW_PRESET));
  check("and the two actions", !isGraphicsRow(ROW_PLACE) && !isGraphicsRow(ROW_CANCEL));

  // The cursor walks one ladder across two surfaces, so the rows have to be
  // ordered with every graphics row on one side of a single boundary. Three
  // boundaries would read as the page jumping about.
  let crossings = 0;
  for (let i = 1; i < all.length; i++) {
    if (isGraphicsRow(all[i]) !== isGraphicsRow(all[i - 1])) crossings++;
  }
  check("the walk crosses between the surfaces exactly once", crossings === 1, crossings);
  check("and it starts on the graphics side", isGraphicsRow(all[0]));

  // Neither half may need the scroll arrows: a page that scrolls hides rows,
  // and the whole point of the split is that both halves are now short.
  const bent = applyPreset("DIORAMA", flat);
  check("the graphics panel never scrolls, flat or bent",
        beside.length <= MAX_VISIBLE_ROWS && graphicsRows(bent).length <= MAX_VISIBLE_ROWS,
        graphicsRows(bent).length);
  // The centred half now scrolls, by exactly one row, and that is a cost paid
  // on purpose rather than an oversight.
  //
  // It held eight rows and eight is a HARD limit: rows sit on odd tile-rows
  // with a blank between, so eight fill tile-rows 1 to 15 and the ninth lands
  // on the bottom border -- which is what adding BATTLE once did, and the page
  // looked corrupt rather than full. CONTROLS is the ninth. It could only have
  // been kept off by making it a graphics row, which it is not (it changes
  // nothing about how the world LOOKS), or by demoting one that has a stated
  // reason to be here.
  //
  // What makes it affordable is that scrolling is not hiding: visibleRows
  // keeps the cursor off the very edge so there is always a sign of more, and
  // "every row can be seen when the cursor is on it" above walks all fourteen
  // and proves it. The graphics panel is the half that must never scroll --
  // it hangs beside the diorama at 22.6 degrees against a 37-degree plate --
  // and it still does not.
  check("the centred half is one row past the frame",
        centred.length === MAX_VISIBLE_ROWS + 1, centred.length);
  check("...and every one of them is still reachable",
        centred.every((row) => visibleRows(centred, row).indexOf(row) >= 0));
  // ...and neither half changes size, whatever a preset does. There used to be
  // a row that came and went -- EDGE, offered only while CURVE was above zero --
  // and it lived on this side panel, so the panel grew and shrank under the
  // wearer. Both rows have gone and the two surfaces are now fixed.
  check("no preset changes the size of either surface",
        graphicsRows(bent).length === beside.length &&
        centreRows(bent).length === centred.length);
  check("the list of graphics rows is the same one isGraphicsRow answers from",
        GRAPHICS_ROWS.length === graphicsRows(bent).length);
}

console.log("=== the settings survive being written out and read back ===");
{
  // The complaint: "de graphics blijven niet opgeslagen voor de volgende
  // speelbeurt". Storage is JSON, so the round trip is what has to hold --
  // including through a ladder that has changed shape since the file was
  // written, which has happened three times this week.
  const chosen = defaultViewSettings();
  chosen.tilt = 2; chosen.zoom = 3; chosen.time = 1; chosen.colour = 0;
  chosen.shapes = 0; chosen.mode = 1; chosen.battle = 1; chosen.speed = 2;
  const back = V.sanitiseViewSettings(JSON.parse(JSON.stringify(chosen)));
  check("every field comes back", JSON.stringify(back) === JSON.stringify(chosen),
        JSON.stringify(back) + " vs " + JSON.stringify(chosen));

  // A file naming a rung that no longer exists falls back to the default
  // rather than putting the cursor or the mesh somewhere it cannot leave.
  const stale = V.sanitiseViewSettings({ tilt: 99, zoom: -4, shapes: 7, mode: 12 });
  const base = defaultViewSettings();
  check("a rung that is gone falls back", stale.tilt === base.tilt, "" + stale.tilt);
  check("so does a negative one", stale.zoom === base.zoom, "" + stale.zoom);
  check("and the shape ladder", stale.shapes === base.shapes, "" + stale.shapes);
  check("and the mode", stale.mode === base.mode, "" + stale.mode);

  // Rubbish is not a reason to lose the lot.
  check("nothing at all is the default",
        JSON.stringify(V.sanitiseViewSettings(null)) === JSON.stringify(base));

  // PLAY MODE round-trips through the file like every other row -- the lens
  // simply does not READ it back (PokemonAR.restoreViewSettings), because a
  // session ended in GAME BOY starting in GAME BOY reads as a broken world.
  // The row has to keep working, so the value has to keep surviving.
  const gameboy = defaultViewSettings();
  gameboy.mode = V.MODE_GAMEBOY;
  check("GAME BOY survives the round trip",
        V.sanitiseViewSettings(JSON.parse(JSON.stringify(gameboy))).mode === V.MODE_GAMEBOY);
  check("and DIORAMA is what a fresh lens opens on", base.mode === V.MODE_DIORAMA);
}

console.log("=== AUTHORED is what the world opens on ===");
{
  // Joshua asked for VOXEL on the morning of 10 September -- "kan je standaard
  // maken dat shapes: voxel settings komt" -- and for AUTHORED the same
  // evening, after the recordings that put the two side by side on the
  // glasses. That is the row working: the comparison was made where it had to
  // be made, and it went the way the reference's own choice suggests. Round
  // crowns, fence posts, buildings with a roof.
  //
  // VOXEL is one SELECT press away and the ladder is unchanged; only which end
  // of it a fresh lens opens on has moved.
  check("the default is the authored shapes",
        defaultViewSettings().shapes === V.SHAPES_AUTHORED,
        "" + defaultViewSettings().shapes);
  check("and VOXEL is still reachable", V.SHAPE_LABELS[V.SHAPES_VOXEL] === "VOXEL");
}

console.log("=== FIND PAD goes looking for a Bluetooth pad again ===");
{
  // The pad gets three twenty-second scans in the first seventy seconds of the
  // lens and then stops for good -- and the first-run wizard, which offers
  // START on its PAD page, is first-run only. From the second run on this row
  // is the only way back to a scan.
  const c = new ViewOptionsController(defaultViewSettings());
  for (let i = 0; i < stepsTo(V.ROW_FINDPAD); i++) c.step("down", false, false);
  check("FIND PAD is reachable", c.cursorRow() === V.ROW_FINDPAD, String(c.cursorRow()));
  const before = JSON.stringify(c.values());
  check("A on it asks for a scan", c.step("", true, false) === "findpad");
  check("...and changes no setting", JSON.stringify(c.values()) === before);
  check("...and does not close the page", c.step("", false, false) === "");
  check("...and leaves the cursor where it was", c.cursorRow() === V.ROW_FINDPAD);
}

console.log("=== every row has a label and a ladder ===");
{
  let ok = true;
  for (let row = 0; row <= ROW_CANCEL; row++) {
    if (!rowLabel(row)) ok = false;
    // PLACE and CANCEL are actions, not ladders: they carry a label and no
    // values, which is what stops the painter drawing arrows round them.
    if (row !== ROW_CANCEL && row !== ROW_PLACE && row !== V.ROW_FINDPAD &&
        rowValues(row).length === 0) ok = false;
  }
  check("labels and ladders are all there", ok);
  check("CANCEL has no ladder", rowValues(ROW_CANCEL).length === 0);
  check("nor does PLACE", rowValues(ROW_PLACE).length === 0);
  check("nor does FIND PAD", rowValues(V.ROW_FINDPAD).length === 0);
  check("and PLACE is named on the page", rowLabel(ROW_PLACE) === "PLACE");
  check("and so is FIND PAD", rowLabel(V.ROW_FINDPAD) === "FIND PAD");
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
  // A page that dropped a row would be the fault the CURVE removal could
  // have introduced: twelve rows are declared and twelve must be walkable.
  expectFailures("a page that offers fewer rows than it declares", () => {
    check("row-count detector", offeredRows(defaultViewSettings()).length === VIEW_ROWS - 1);
  });
  expectFailures("a preset that changes nothing", () => {
    const before = defaultViewSettings();
    const after = applyPreset(PRESET_DIORAMA, before);
    check("preset detector", after.zoom === before.zoom);
  });
  // A ZOOM row whose label and window disagree is the exact fault the WORLD
  // row had: a rung called FIT that drew 17 tiles across.
  expectFailures("a ZOOM label that does not match its window", () => {
    check("zoom detector",
          rowValues(ROW_ZOOM).every((s, i) => s === String(ZOOM_TILES_ACROSS[i] + 1)));
  });
  expectFailures("a split that leaves a graphics row on the centred page", () => {
    check("split detector", isGraphicsRow(ROW_SPEED));
  });
  expectFailures("an order that scatters the graphics rows through the page", () => {
    const all = offeredRows(defaultViewSettings());
    let crossings = 0;
    for (let i = 1; i < all.length; i++) {
      if (isGraphicsRow(all[i]) !== isGraphicsRow(all[i - 1])) crossings++;
    }
    check("order detector", crossings > 1);
  });
  expectFailures("a ladder that does not wrap", () => {
    const c = new ViewOptionsController(defaultViewSettings());
    for (let i = 0; i < EDGE_LABELS.length + 3; i++) c.step("right", false, false);
    check("wrap detector", c.values().tilt >= TILT_DEGREES.length);
  });
}

console.log("");
console.log("VIEWOPTIONS  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
