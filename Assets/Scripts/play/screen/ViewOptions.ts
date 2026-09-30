// The view settings, as a page of the cartridge's own OPTION screen.
//
// Ladders, never sliders, and for the reference's own reason: what a player
// sees change between two rungs of a view box is an AREA, and area goes as the
// square, so even steps bunch the whole ladder at the near end. The engine this is modelled on has no slider primitive either -- a
// row is a label, a value and a step -- and that turned out to be the right
// shape rather than a limitation.
//
// Pure: rows in, rows out, no scene and no canvas, so a test can state "an
// older save opens on the default zoom" without a lens. The painter at the
// bottom takes a GbCanvas and is the only part that touches one.

import type { GbCanvas, GbFont } from "./GbCanvas";
import { TIME_LABELS, SATURATION_LABELS, SATURATION_LEVELS,
         SATURATION_HIGH } from "../../world/DayTint";
import { ZOOM_LABELS, ZOOM_TILES_ACROSS, ZOOM_DEFAULT } from "../../world/PlayArea";
import { TILE } from "./GbCanvas";

/** Diorama tilt, in degrees. The reference steps 15, 35, 50, 75. */
export const TILT_DEGREES: number[] = [0, 15, 35, 50, 75];
export const TILT_LABELS: string[] = ["FLAT", "15", "35", "50", "75"];

/**
 * The rim: a square slab with sides, or a disc that rolls off into its base.
 *
 * This row used to appear only while the world was curved, on the reasoning
 * that "a flat world's hard edge IS the sides of the slab, so softening it
 * there would do nothing visible". That reasoning was simply wrong about the
 * code: edgeCut and edgeDrop never read the curve level. SOFT cuts the square
 * window down to its inscribed circle and sinks the outer band into the earth,
 * on a flat slab exactly as on a bent one -- a round model that rolls off,
 * against a square one that shows its sides. So the row stays, and is offered
 * always, now that the curve it used to hang off is gone.
 */

/**
 * How fast the game runs. A ladder, like everything else here, and the same
 * three rungs an emulator's fast-forward offers.
 *
 * The MUSIC does not follow it: the jukebox is driven by the wall clock, not by
 * the game's, so a sped-up world plays over a tune at its own tempo and pitch.
 * That was Joshua's choice of the three on 7 September.
 */
export const SPEED_LABELS: string[] = ["1X", "2X", "4X"];
export const SPEED_FACTORS: number[] = [1, 2, 4];

/**
 * Where a fight is staged.
 *
 * The reference stages battles ON THE MAP and that is what its footage shows:
 * two Pokemon on a patch of open ground, the town still around them, the HUD
 * floating as panels. Our lens shipped doing the opposite -- every encounter
 * grew the whole diorama until the wearer was standing inside it -- and the
 * 7 September recording is what that looks like from the room: the table is
 * gone, the buildings are overhead, and a Bulbasaur the size of a door stands
 * half inside a house.
 *
 * So TABLE is the default and LIFE is the thing you ask for. LIFE is genuinely
 * worth having -- it is the one shot in this lens nothing else can do -- but as
 * a place you go, not as what happens every time a patch of grass rustles.
 *
 * DISCS is the reference's second staging, and it exists for the case the
 * 8 September preview ran into: a fight in Oak's lab is a fight with lab
 * benches between the wearer and the Pokemon. The reference lifts those off the
 * map entirely -- "caves and shop floors that have nowhere to put a fight" --
 * and stands the pair on two discs against the sky. In a headset the sky is the
 * room, which is exactly what you want: two clean platforms and no furniture.
 */
export const BATTLE_LABELS: string[] = ["TABLE", "DISCS", "LIFE"];
/** Staged on the tabletop diorama, the reference's own default. */
export const BATTLE_TABLE: number = 0;
/** Lifted off the map onto two floating platforms; the terrain is switched off. */
export const BATTLE_DISCS: number = 1;
/** The world grows until the wearer is standing in it. */
export const BATTLE_LIFE: number = 2;

/**
 * The loose buttons: the Game Boy's own A, B, D-pad, SELECT and START, with
 * no plate under them, hanging below the wearer's line of sight.
 *
 * This row was PAD (OFF, ON, MINI) until 30 September, and it opened on OFF
 * since the 7 September playtest, when a phone or a pad was always in the
 * wearer's hand and the plate was a slab in front of the world. Then walking
 * moved to the hands, and a wearer with nothing else could reach neither
 * START nor B nor a menu's next row without first finding this row. Joshua's
 * decision: no plate at all, the model's own buttons loose, there by
 * default, and gone when something else can press them.
 *
 * AUTO shows them unless a phone (through the Spectacles App) or a Bluetooth
 * pad is connected. ON keeps them regardless; OFF hides them regardless,
 * which is what a recording of the world alone wants.
 */
export const BUTTONS_LABELS: string[] = ["AUTO", "ON", "OFF"];
export const BUTTONS_AUTO: number = 0;
export const BUTTONS_ON: number = 1;
export const BUTTONS_OFF: number = 2;

/**
 * One press writes the lot. The reference keeps its preset OUT of the
 * single-key cycle for a reason worth repeating: a key that changes the
 * camera should change the camera and nothing else, and landing on a preset
 * mid-walk would rewrite four rows with no sign that a keypress did it.
 */
/**
 * Whether tiles stand in their AUTHORED shape or as the pixel extrusion the
 * lens shipped with until 8 September.
 *
 * VOXEL is not a fallback for a bug -- both paths are tested and both are
 * kept -- it is the comparison. Every claim the shape library makes ("a fence
 * is posts now", "a tree is a ball") is one SELECT press from being checked
 * against what it replaced, on the glasses, by the person who asked for it.
 */
export const SHAPE_LABELS: string[] = ["AUTHORED", "VOXEL"];

/**
 * How the world is drawn at all: as a flat Game Boy screen, or as a diorama.
 *
 * The boot menu has had this row since the onboarding page was written, and the
 * OPTION page has not, which made the choice a ONE-WAY DOOR: play.playMode is
 * written from the boot options only when a game is NEW, so a save that ended up
 * on GAME BOY could not be brought back without starting over. A LEAF harness
 * found that by tripping it -- one stray press on the boot page and every later
 * run drew a flat screen -- and a wearer would trip it the same way, with their
 * whole playthrough behind it.
 *
 * Index 0 is GAME BOY and index 1 is DIORAMA, matching the boot page's own row
 * so the two pages cannot disagree about which is which.
 */
/**
 * Whether the d-pad means the MAP's north or the WEARER's "away from me".
 *
 * NORTH is the cartridge, exactly: UP is north, as it has been since 1996.
 * That is right on a screen for ever, and right on a table from exactly one
 * side of the table. Joshua, 10 September, on the glasses: "loop ik om het
 * spel heen dan draait mijn karakter mee maar de controls blijven hetzelfde,
 * waardoor ik vanuit een andere hoek dezelfde controls behoud."
 *
 * VIEW snaps the d-pad to whichever map axis points away from where he is
 * standing, latching only while nothing is pressed and nothing is walking --
 * see play/ViewRelativeInput, which has the hysteresis and the reason for it.
 *
 * Two rungs, not three. A manual "north is now away from me" was the obvious
 * third, and PLACE already is one: it puts the world down facing the wearer,
 * which re-aligns the map's north with them by moving the world rather than
 * the mapping. A row that duplicates a row is a row nobody learns.
 *
 * NOT a graphics row. It changes nothing about how the world looks, and it has
 * to be reachable from the page in front of the wearer rather than from the
 * panel beside the diorama.
 */
export const CONTROLS_LABELS: string[] = ["NORTH", "VIEW"];
/** UP is north on the map, wherever the wearer is standing. */
export const CONTROLS_NORTH: number = 0;
/** UP is away from the wearer, snapped to the nearest map axis. */
export const CONTROLS_VIEW: number = 1;

export const MODE_LABELS: string[] = ["GAME BOY", "DIORAMA"];
export const MODE_GAMEBOY: number = 0;
export const MODE_DIORAMA: number = 1;
/** Trees are hulls, fences are posts, grass stands up. */
export const SHAPES_AUTHORED: number = 0;
/** Every pixel is a column, as before. */
export const SHAPES_VOXEL: number = 1;

/**
 * The two camera reads, one press each.
 *
 * The first was called FLAT while there was a CURVE row for it to flatten.
 * The world is always flat now, so FLAT named nothing and WIDE names what the
 * preset actually does: the most world this lens will put on a table, square
 * and hard-edged. DIORAMA is the other end -- a small round model with its rim
 * rolled off, which is the reference's own diorama read.
 */
export const PRESET_LABELS: string[] = ["--", "WIDE", "DIORAMA"];
export const PRESET_WIDE: string = "WIDE";
export const PRESET_DIORAMA: string = "DIORAMA";

/**
 * The hour the diorama is lit at, and how much colour it carries.
 *
 * Both are multiplies inside the palette texture, which is built once per map,
 * so neither costs a frame -- see docs/RESEARCH-look-and-light.md for why these
 * two of the reference's effects transfer to an optical see-through display and
 * its sky, its shadow map and its tilt-shift do not.
 */
export const ROW_TILT: number = 0;
/**
 * How many tiles are on the plate. The labels ARE the tile counts, and the
 * ladder lives in PlayArea because the mesh reads the same numbers.
 *
 * This replaces WORLD, which was ["FIT", "WIDE", "WIDER", "WIDEST"] over a
 * ladder of RADII: FIT meant 17 tiles across, not 8, and no name on the page
 * said which of the two a rung measured. The plate keeps its centimetres a
 * tile at every rung -- only the tile count changes -- so zooming out puts
 * more world on a bigger plate rather than the same world drawn smaller.
 */
export const ROW_ZOOM: number = 1;
export const ROW_SPEED: number = 2;
export const ROW_BUTTONS: number = 3;
/**
 * What the d-pad means. See CONTROLS_LABELS.
 *
 * Next to PAD because the two are the only rows about the CONTROLLER rather
 * than about the world, and a wearer looking for one will find the other.
 */
export const ROW_CONTROLS: number = 4;
export const ROW_BATTLE: number = 5;
export const ROW_TIME: number = 6;
export const ROW_COLOUR: number = 7;
export const ROW_SHAPES: number = 8;
/**
 * PLAY MODE. Deliberately NOT a graphics row, though it decides more about how
 * the world looks than any of them: the graphics rows are drawn on a panel
 * BESIDE the diorama, and in GAME BOY mode there is no diorama to put a panel
 * beside. A row that moves itself out of reach is a row you cannot come back
 * through.
 */
export const ROW_MODE: number = 9;
export const ROW_PRESET: number = 10;
/**
 * Put the world down again, in front of where the wearer is NOW.
 *
 * An action rather than a ladder, which is why it sits next to CANCEL rather
 * than among the rows with values. It exists because the diorama is placed
 * once, at boot, and a wearer who then stands up, sits down or turns their
 * chair is left with a town facing the wrong way -- and a town facing the
 * wrong way is a d-pad facing the wrong way, since UP on the pad is north on
 * the map and north is wherever the model was pointed.
 */
export const ROW_PLACE: number = 11;
/**
 * Look for a Bluetooth pad again.
 *
 * An action, like PLACE, and here for the same kind of reason. The pad gets
 * three twenty-second scans with five-second gaps and then stops for good, so
 * the entire budget is spent seventy seconds after the lens starts -- while
 * the glasses are going on, while the diorama is being placed, and before the
 * pad's pairing button has been held. The first-run wizard offers START on its
 * PAD page, but the wizard is first-run only; from the second run onwards this
 * row is the only way back to a scan.
 *
 * ROW_BUTTONS, four rows up, is a different thing with a confusable name: that one
 * is the on-screen button PLATE.
 */
export const ROW_FINDPAD: number = 12;
export const ROW_CANCEL: number = 13;
export const VIEW_ROWS: number = 14;

/**
 * The rows that change how the WORLD LOOKS, as opposed to how it plays.
 *
 * These are the rows that move to a panel beside the diorama (9 September,
 * Joshua: "het menu zit heel erg in je face als je met de graphics settings
 * bezig bent"). Every other row stays on the centred page, because every
 * other row decides something you cannot watch happen anyway: what a fight
 * does, whether there is a button plate, how fast the clock runs.
 *
 * TIME is here although it was not in the original list: TIME and COLOUR are
 * one mechanism -- two multiplies inside the same palette texture -- and
 * splitting that pair across two surfaces would put a row beside the world and
 * its own switch in front of the wearer's face.
 *
 * This list was seven rows when it was written, and CURVE and EDGE have gone
 * since. Five is the better number: the page beside the world was measured at
 * 22.6 degrees against a 37-degree plate in a 30-degree window, which is what
 * forced the choice between overlapping the world and making the wearer turn
 * their head.
 *
 * PRESET is deliberately NOT here. It is a button that rewrites four of these
 * rows at once, and it sits with PLACE and CANCEL where the actions are.
 */
export const GRAPHICS_ROWS: number[] = [
  ROW_TILT, ROW_ZOOM, ROW_TIME, ROW_COLOUR, ROW_SHAPES,
];

/**
 * The order the page walks its rows in, which is NOT the order they are
 * numbered.
 *
 * The graphics rows come first, as one unbroken run. The split above puts
 * them on a different SURFACE from the rest, and a cursor that crossed
 * between those surfaces three times on the way down the page would read as
 * the page jumping about rather than as two places to look. One crossing.
 */
export const ROW_ORDER: number[] = [
  ROW_TILT, ROW_ZOOM, ROW_TIME, ROW_COLOUR, ROW_SHAPES,
  ROW_SPEED, ROW_BUTTONS, ROW_CONTROLS, ROW_BATTLE, ROW_MODE, ROW_PRESET,
  ROW_PLACE, ROW_FINDPAD, ROW_CANCEL,
];

/** Whether a row belongs beside the world rather than in front of the wearer. */
export function isGraphicsRow(row: number): boolean {
  for (let i = 0; i < GRAPHICS_ROWS.length; i++) {
    if (GRAPHICS_ROWS[i] === row) {
      return true;
    }
  }
  return false;
}

/** What step() answers: nothing, the page closed, or the world re-placed. */
export const VIEW_OPEN: string = "";
export const VIEW_CLOSE: string = "close";
export const VIEW_PLACE: string = "place";
/** Look for a Bluetooth pad again. See ROW_FINDPAD. */
export const VIEW_FINDPAD: string = "findpad";

export interface ViewSettings {
  /** Index into TILT_DEGREES. */
  tilt: number;
  /** Index into ZOOM_TILES_ACROSS: how many tiles are on the plate. */
  zoom: number;
  /** Index into SPEED_FACTORS. */
  speed: number;
  /** Index into BUTTONS_LABELS: the loose buttons on AUTO, ON or OFF. */
  buttons: number;
  /** Index into CONTROLS_LABELS: 0 up-is-north, 1 up-is-away-from-the-wearer. */
  controls: number;
  /** Index into BATTLE_LABELS: where a fight is staged. */
  battle: number;
  /** Index into TIME_LABELS: the hour the world is lit at. */
  time: number;
  /** Index into SATURATION_LEVELS: how much colour it carries. */
  colour: number;
  /** Index into MODE_LABELS: 0 a flat Game Boy screen, 1 a diorama. */
  mode: number;
  /** Index into SHAPE_LABELS: 0 authored shapes, 1 the old pixel extrusion. */
  shapes: number;
  /**
   * VIEW_REVISION at the time this block was written. See MIGRATED_ROWS.
   *
   * Not a row. It is never drawn, never stepped, and the page cannot reach it;
   * it exists so that a change of DEFAULT can reach a wearer who already has a
   * save, which no amount of editing defaultViewSettings() can do on its own.
   */
  rev: number;
}

export function defaultViewSettings(): ViewSettings {
  // Flat, hard-edged, and a play area rather than a whole map.
  //
  // ZOOM opens on 20 tiles across: the Game Boy's own viewport, a 70 cm plate
  // at 3.5 cm a tile, and the map scrolling under it. What this replaces was a
  // WORLD row whose rungs were radii -- its tightest, the default every
  // playtest ran on, was 17 across -- and before that an ALL rung that built
  // whole routes. RESEARCH-voxel-cost.md has the numbers: Route 1 is 77,208
  // quads at ALL and 6,746 in a play area, and the 8 September glasses test
  // ended with the Spectacles going to sleep to cool down.
  //
  // DISCS, not TABLE. TABLE is the reference's own primary staging and it is
  // right on a screen, where the camera can be dropped to ground level beside
  // the pair. On a table it is not: three playtests running, the complaint has
  // been the scenery -- lab benches between the wearer and the Pokemon, a rug
  // swallowing a Bulbasaur, "de objecten staan in de weg". DISCS is one SELECT
  // press away from TABLE for anyone who wants the town behind their fight.
  return { tilt: 0, zoom: ZOOM_DEFAULT, speed: 0, buttons: BUTTONS_AUTO,
           // VIEW, by Joshua on 10 September. This is the row that decides
           // whether walking round your own table breaks the controls, and a
           // wearer who has to find a menu to fix that has already had the
           // bad experience. NORTH is one press away for the A/B, and is what
           // GAME BOY mode uses regardless -- there is no table to walk round
           // when the screen follows your head.
           controls: CONTROLS_VIEW,
           // TABLE, by Joshua on 10 September, after a playtest whose every
           // encounter grew the world until the town stood in the room: "de
           // battles staan als default op real world maar dit moet table mode
           // zijn". The setting he was on was LIFE, and he had chosen it once,
           // weeks earlier -- see MIGRATED_ROWS for why that is the whole
           // reason this literal was not enough on its own.
           //
           // This also settles a disagreement this file had with itself. The
           // paragraph over BATTLE_LABELS has argued for TABLE since it was
           // written; this literal said DISCS. The argument for DISCS -- lab
           // benches and rugs between the wearer and the Pokemon -- was about
           // scenery in the way, and it stands, which is why DISCS is still
           // one SELECT press from here. It was not an argument for opening
           // there.
           battle: BATTLE_TABLE,
           // DAY, and all the colour this ladder has.
           //
           // colour was 1 -- READ -- for two days, and READ is the one rung on
           // that ladder that is not a colour at all: it is the legibility
           // regrade, which sinks the ground toward transparent and lifts the
           // walls toward emissive. On the glasses that reads as chalk-white
           // buildings standing in a lawn you can see the carpet through, and
           // "de standaard kleuren en graphics vind ik niet nice" is what it
           // came back as. SATURATION_HIGH has the measurements.
           time: 0, colour: SATURATION_HIGH,
           // AUTHORED, by Joshua on 10 September, off the same recordings:
           // trees as round crowns, fences as posts, buildings with a roof.
           // That is the reference's own path and it is visibly the better
           // one. VOXEL was the default for a day, to have the comparison in
           // the wearer's hands rather than in a document; the comparison is
           // made, and VOXEL is a SELECT press away.
           shapes: SHAPES_AUTHORED,
           // A diorama. GAME BOY is a thing you choose, never a thing you land
           // on -- it was a one-way door until this row existed.
           mode: MODE_DIORAMA,
           // Last, because it is not a row. See MIGRATED_ROWS.
           rev: VIEW_REVISION };
}

/**
 * Which revision of the defaults a stored block was written against.
 *
 * Bumped whenever a DEFAULT changes and the change has to reach saves that
 * already exist. See MIGRATED_ROWS for the rows each bump resets.
 */
export const VIEW_REVISION: number = 2;

/**
 * The rows a revision bump puts back to their default, by name.
 *
 * The problem this solves, in the words of the person who hit it: "de battles
 * staan als default op real world". They did not. The DEFAULT was DISCS and
 * had been for days -- but he had answered the first-fight question with LIFE
 * once, weeks earlier, and a chosen value outranks a default for ever. Editing
 * defaultViewSettings() would have changed nothing at all for him, and the row
 * he could not find his way out of would have stayed exactly where it was.
 *
 * This is the same shape as the PLAY MODE one-way door and it wants a
 * different answer. PLAY MODE is never restored, full stop, because landing on
 * a flat screen reads as a broken lens. A wearer who deliberately grows the
 * world for a fight, though, means it, and asked for it to be remembered --
 * so the choice is kept, and only a CHANGE OF DEFAULT overrules it, once, at
 * the moment the default changes.
 *
 * Rows NOT listed here survive a bump.
 *
 * Revision 2 adds ZOOM, and revision 1's note here said the opposite -- "the
 * wearer's own choice and none of this file's business". That was right about
 * whose choice it is and wrong about what it costs. Measured over all 222
 * maps, the worst map emits 21,303 quads at ZOOM 20 and 65,171 at ZOOM 40:
 * three times the geometry, from one row, with nothing on the page saying so.
 * Joshua set it to 40 at 15:22 on 10 September and every session after that
 * ran the heaviest scene this lens can build, on a pair of glasses that then
 * overheated.
 *
 * So the DEFAULT is reclaimed, once -- and only the default. ZOOM 40 stays on
 * the ladder and stays one press away, because seeing more of the map at once
 * is a real thing to want and this is not the file that decides he may not
 * have it. What it decides is what he starts on.
 */
export const MIGRATED_ROWS: string[] = ["battle", "colour", "shapes", "zoom"];

/**
 * A stored value that is missing or out of range falls back to the default.
 *
 * This is also the whole migration path, and it works by NAMING. A save from
 * before 9 September carries `curve` and `world`; neither is read here, so the
 * curve is dropped (the world is always flat now) and the zoom opens on its
 * own default. That is deliberate rather than lazy: WORLD's indices counted
 * rungs of a RADIUS ladder, so index 3 meant "24 tiles either side", and
 * reading it as a ZOOM index would silently mean "40 tiles across". An index
 * whose unit has changed is not a value to carry over.
 */
export function sanitiseViewSettings(raw: any): ViewSettings {
  const base = defaultViewSettings();
  if (!raw) {
    return base;
  }
  // A block written before this revision hands its MIGRATED_ROWS back and
  // keeps everything else. Read from `raw` rather than tracked as a flag: the
  // stamp travels WITH the settings, so the standalone store and the block
  // inside a save are migrated by the same line of code, once each, whichever
  // of the two the wearer's lens happens to read first.
  const stale = raw.rev !== VIEW_REVISION;
  return {
    tilt: clampIndex(raw.tilt, TILT_DEGREES.length, base.tilt),
    zoom: stale ? base.zoom
      : clampIndex(raw.zoom, ZOOM_TILES_ACROSS.length, base.zoom),
    // Saves written before these rows existed carry neither; the defaults are
    // the answer, which is why every row goes through clampIndex.
    speed: clampIndex(raw.speed, SPEED_LABELS.length, base.speed),
    // `pad`, the row this one replaced, is deliberately NOT read: its ladder
    // was OFF / ON / MINI, and MINI's index would arrive here as OFF.
    buttons: clampIndex(raw.buttons, BUTTONS_LABELS.length, base.buttons),
    // Not in MIGRATED_ROWS: a save from before this row existed has never
    // expressed an opinion about it, and clampIndex answers that with the
    // default already. Only a row whose default CHANGES needs reclaiming.
    controls: clampIndex(raw.controls, CONTROLS_LABELS.length, base.controls),
    battle: stale ? base.battle
      : clampIndex(raw.battle, BATTLE_LABELS.length, base.battle),
    time: clampIndex(raw.time, TIME_LABELS.length, base.time),
    colour: stale ? base.colour
      : clampIndex(raw.colour, SATURATION_LEVELS.length, base.colour),
    shapes: stale ? base.shapes
      : clampIndex(raw.shapes, SHAPE_LABELS.length, base.shapes),
    mode: clampIndex(raw.mode, MODE_LABELS.length, base.mode),
    // Stamped on the way out, so the reset happens once and the wearer's next
    // choice on any of these rows is kept like every other.
    rev: VIEW_REVISION,
  };
}

function clampIndex(value: any, count: number, fallback: number): number {
  if (typeof value !== "number" || !(value >= 0) || value >= count) {
    return fallback;
  }
  return Math.floor(value);
}

/**
 * The rows on offer, as indices, in order: all of them.
 *
 * There used to be a `rowOffered` beside this, and one row that came and went:
 * EDGE appeared only while CURVE was above zero, on the reasoning that a flat
 * world's hard edge IS the sides of the slab. With CURVE gone that hook had
 * nothing to hang from, and the reasoning was wrong anyway -- edgeCut and
 * edgeDrop never read the curve level, so SOFT rounds and rolls off a flat
 * slab exactly as it does a bent one. Every row on this page now does
 * something at every moment, which is what the page always claimed.
 */
export function offeredRows(settings: ViewSettings): number[] {
  // Every row, always. There used to be one that came and went -- EDGE, offered
  // only while CURVE was above zero -- and a page whose rows appear and vanish
  // is a page nobody learns the shape of. Both rows have gone; this walks
  // ROW_ORDER rather than counting to VIEW_ROWS, because the order the cursor
  // takes is not the order the rows are numbered in.
  const out: number[] = [];
  for (let i = 0; i < ROW_ORDER.length; i++) {
    out.push(ROW_ORDER[i]);
  }
  return out;
}

/** The offered rows that belong beside the world, in order. */
export function graphicsRows(settings: ViewSettings): number[] {
  const all = offeredRows(settings);
  const out: number[] = [];
  for (let i = 0; i < all.length; i++) {
    if (isGraphicsRow(all[i])) {
      out.push(all[i]);
    }
  }
  return out;
}

/** The offered rows that stay on the centred page, in order. */
export function centreRows(settings: ViewSettings): number[] {
  const all = offeredRows(settings);
  const out: number[] = [];
  for (let i = 0; i < all.length; i++) {
    if (!isGraphicsRow(all[i])) {
      out.push(all[i]);
    }
  }
  return out;
}

/** The label and the value strings of one row, as the painter wants them. */
export function rowLabel(row: number): string {
  if (row === ROW_TILT) return "TILT";
  if (row === ROW_ZOOM) return "ZOOM";
  if (row === ROW_SPEED) return "SPEED";
  if (row === ROW_BUTTONS) return "BUTTONS";
  if (row === ROW_CONTROLS) return "CONTROLS";
  if (row === ROW_BATTLE) return "BATTLE";
  if (row === ROW_TIME) return "TIME";
  if (row === ROW_COLOUR) return "COLOUR";
  if (row === ROW_SHAPES) return "SHAPES";
  if (row === ROW_MODE) return "MODE";
  if (row === ROW_PRESET) return "PRESET";
  if (row === ROW_PLACE) return "PLACE";
  if (row === ROW_FINDPAD) return "FIND PAD";
  return "CANCEL";
}

export function rowValues(row: number): string[] {
  if (row === ROW_TILT) return TILT_LABELS;
  if (row === ROW_ZOOM) return ZOOM_LABELS;
  if (row === ROW_SPEED) return SPEED_LABELS;
  if (row === ROW_BUTTONS) return BUTTONS_LABELS;
  if (row === ROW_CONTROLS) return CONTROLS_LABELS;
  if (row === ROW_BATTLE) return BATTLE_LABELS;
  if (row === ROW_TIME) return TIME_LABELS;
  if (row === ROW_COLOUR) return SATURATION_LABELS;
  if (row === ROW_SHAPES) return SHAPE_LABELS;
  if (row === ROW_MODE) return MODE_LABELS;
  if (row === ROW_PRESET) return PRESET_LABELS;
  return [];
}

export function rowChosen(row: number, settings: ViewSettings): number {
  if (row === ROW_TILT) return settings.tilt;
  if (row === ROW_ZOOM) return settings.zoom;
  if (row === ROW_SPEED) return settings.speed;
  if (row === ROW_BUTTONS) return settings.buttons;
  if (row === ROW_CONTROLS) return settings.controls;
  if (row === ROW_BATTLE) return settings.battle;
  if (row === ROW_TIME) return settings.time;
  if (row === ROW_COLOUR) return settings.colour;
  if (row === ROW_SHAPES) return settings.shapes;
  if (row === ROW_MODE) return settings.mode;
  return 0;
}

/** The game's speed multiplier. Never the music's -- see SPEED_LABELS. */
export function speedFactor(settings: ViewSettings): number {
  const at = clampIndex(settings ? settings.speed : 0, SPEED_FACTORS.length, 0);
  return SPEED_FACTORS[at];
}

/**
 * Whether the loose buttons are asked for: the row's answer, given whether a
 * controller that can press B and START is connected. No settings is AUTO.
 */
export function looseButtonsShown(settings: ViewSettings, controllerConnected: boolean): boolean {
  const at = settings ? settings.buttons : BUTTONS_AUTO;
  if (at === BUTTONS_ON) {
    return true;
  }
  if (at === BUTTONS_OFF) {
    return false;
  }
  return !controllerConnected;
}

/** A preset, applied. Returns a NEW settings object; nothing is mutated. */
export function applyPreset(name: string, settings: ViewSettings): ViewSettings {
  // SPEED and BUTTONS are carried through every preset: they are not what the world
  // LOOKS like, and a preset that silently reset the game's speed would be the
  // "one keypress, four rows" surprise this file's own header warns about.
  const speed = settings ? settings.speed : 0;
  const buttons = settings ? settings.buttons : BUTTONS_AUTO;
  // BATTLE rides along for the same reason: where a fight is staged is not what
  // the world looks like from the chair, and a preset that quietly moved the
  // wearer back inside the world would be exactly that surprise.
  const battle = settings ? settings.battle : BATTLE_TABLE;
  // The hour and the colour ride along too: neither is what the world is
  // SHAPED like, and a preset that reset the time of day would be the same
  // surprise as one that reset the speed.
  const time = settings ? settings.time : 0;
  const colour = settings ? settings.colour : 1;
  // ...and so does SHAPES. WIDE is a CAMERA preset -- it decides how much of
  // the world is on the table -- and taking the shape library away with it
  // would be the same surprise, dressed as a camera change.
  const shapes = settings ? settings.shapes : SHAPES_AUTHORED;
  // A preset never touches the mode. WIDE and DIORAMA are both readings of a
  // diorama; neither is an opinion about whether the world should be one, and a
  // preset that could drop the wearer onto a flat screen would be the same
  // one-way door this row was added to close.
  const mode = settings ? settings.mode : MODE_DIORAMA;
  // Carried, not restamped. A preset is a wearer pressing a button, not a
  // change of default, so it must not silently mark a stale block as migrated.
  const rev = settings ? settings.rev : VIEW_REVISION;
  // A preset is a CAMERA preset. What the d-pad means is not a camera setting,
  // and a preset that silently changed it would be the same surprise as one
  // that changed the time of day.
  const controls = settings ? settings.controls : CONTROLS_VIEW;
  if (name === PRESET_WIDE) {
    // Level, square-edged, and as much world as the ladder offers.
    return { tilt: 0, zoom: ZOOM_TILES_ACROSS.length - 1, speed: speed, buttons: buttons,
             battle: battle, time: time, colour: colour, shapes: shapes,
             mode: mode, controls: controls, rev: rev };
  }
  if (name === PRESET_DIORAMA) {
    // The reference's own diorama read, translated: a small round model with
    // its rim rolling off into its base, and only what fits on the table.
    return { tilt: 0, zoom: 0, speed: speed, buttons: buttons, battle: battle,
             time: time, colour: colour, shapes: shapes, mode: mode,
             controls: controls, rev: rev };
  }
  return settings;
}

/**
 * The page's cursor and what a press does to it.
 *
 * `step` answers VIEW_OPEN while the page is still open and VIEW_CLOSE when
 * the player has left it, exactly as OnboardingController does, so the caller
 * needs no state of its own beyond the settings. VIEW_PLACE is the one other
 * answer: the PLACE row is an action, and the caller has to do it.
 */
export class ViewOptionsController {
  private settings: ViewSettings;
  private cursor: number = ROW_TILT;

  constructor(settings: ViewSettings) {
    this.settings = sanitiseViewSettings(settings);
  }

  values(): ViewSettings {
    return this.settings;
  }

  pointRow(row: number): void {
    if (offeredRows(this.settings).indexOf(row) >= 0) this.cursor = row;
  }

  cursorRow(): number {
    return this.cursor;
  }

  /**
   * `dpad` is one of "", "up", "down", "left", "right", already edge
   * triggered. Returns VIEW_OPEN, VIEW_CLOSE or VIEW_PLACE.
   */
  step(dpad: string, pressedA: boolean, pressedB: boolean): string {
    const rows = offeredRows(this.settings);
    let at = rows.indexOf(this.cursor);
    if (at < 0) {
      at = 0;
      this.cursor = rows[0];
    }
    if (dpad === "up") {
      at = at > 0 ? at - 1 : rows.length - 1;
      this.cursor = rows[at];
    } else if (dpad === "down") {
      at = at + 1 < rows.length ? at + 1 : 0;
      this.cursor = rows[at];
    } else if (pressedA && this.cursor === ROW_PLACE) {
      // The rows that answer something other than open or closed. They are
      // handled before the cycle so A cannot both act and step a ladder that
      // is not there.
      return VIEW_PLACE;
    } else if (pressedA && this.cursor === ROW_FINDPAD) {
      return VIEW_FINDPAD;
    } else if (dpad === "left" || dpad === "right" ||
               (pressedA && this.cursor !== ROW_CANCEL)) {
      this.cycle(this.cursor, dpad === "left" ? -1 : 1);
    }
    if (pressedB || (pressedA && this.cursor === ROW_CANCEL)) {
      return VIEW_CLOSE;
    }
    return VIEW_OPEN;
  }

  private cycle(row: number, direction: number): void {
    if (row === ROW_PRESET) {
      // The preset row has no state of its own: it writes the others and
      // snaps back, so the page never shows a stale "DIORAMA" over rows
      // that have since been changed by hand.
      const name = direction < 0 ? PRESET_WIDE : PRESET_DIORAMA;
      this.settings = applyPreset(name, this.settings);
      return;
    }
    const count = rowValues(row).length;
    if (count <= 0) {
      return;
    }
    const at = rowChosen(row, this.settings);
    const next = (at + direction + count) % count;
    const s = this.settings;
    this.settings = {
      tilt: row === ROW_TILT ? next : s.tilt,
      zoom: row === ROW_ZOOM ? next : s.zoom,
      speed: row === ROW_SPEED ? next : s.speed,
      buttons: row === ROW_BUTTONS ? next : s.buttons,
      controls: row === ROW_CONTROLS ? next : s.controls,
      battle: row === ROW_BATTLE ? next : s.battle,
      time: row === ROW_TIME ? next : s.time,
      colour: row === ROW_COLOUR ? next : s.colour,
      shapes: row === ROW_SHAPES ? next : s.shapes,
      mode: row === ROW_MODE ? next : s.mode,
      rev: s.rev,
    };
  }
}

/**
 * The page, in the cartridge's frame.
 *
 * One value at a time, between arrows, rather than the whole ladder laid out
 * across the row. The cartridge can print all of TEXT SPEED's three values
 * side by side because they are three short words; TILT's five and TIME's run
 * off the right of a twenty-tile screen. So the row shows where it stands and
 * which way it can go, which is what a ladder needs anyway.
 *
 * Label and value share a LINE. They sat on two until SPEED and PAD joined the
 * page and eight rows at three tile-rows each ran off the bottom of an
 * eighteen-tile screen; on one line, eight rows fit with a blank between each
 * pair. The value column is fixed rather than following the label, so the
 * arrows form a straight edge down the page instead of stepping in and out
 * with the length of each word.
 */
const VALUE_COLUMN: number = 10;

/**
 * How many rows fit between the frame's own top and bottom.
 *
 * Rows sit on odd tile-rows with a blank between them, so eight of them fill
 * tile-rows 1 to 15 and leave 16 and 17 for the frame. A ninth would land ON
 * the bottom border, which is what adding BATTLE would have done: the row was
 * drawn, the frame was drawn over it, and the page looked corrupt rather than
 * full.
 */
export const MAX_VISIBLE_ROWS: number = 8;

/**
 * The slice of the ladder the page can show, with the cursor inside it.
 *
 * Pure, so a test can state "SHAPES is reachable from the top of the page"
 * without a canvas. It keeps the cursor off the very edge where it can --
 * a cursor pinned to the bottom row gives no sign there is more below it --
 * and stops scrolling at either end rather than wrapping, because a ladder
 * that scrolls past its own end reads as a list that lost its place.
 */
export function visibleRows(rows: number[], cursorRow: number): number[] {
  if (rows.length <= MAX_VISIBLE_ROWS) {
    return rows;
  }
  const at = rows.indexOf(cursorRow);
  let first = (at < 0 ? 0 : at) - Math.floor(MAX_VISIBLE_ROWS / 2);
  const last = rows.length - MAX_VISIBLE_ROWS;
  if (first < 0) {
    first = 0;
  }
  if (first > last) {
    first = last;
  }
  return rows.slice(first, first + MAX_VISIBLE_ROWS);
}

export function paintViewOptions(
  canvas: GbCanvas, font: GbFont, settings: ViewSettings, cursorRow: number,
  cursorCode: number, hollowCode: number
): void {
  paintViewOptionRows(canvas, font, settings, offeredRows(settings), cursorRow,
                      cursorCode, hollowCode, 0);
}

/**
 * The same page, over a chosen slice of the rows and in a chosen shade.
 *
 * Two callers with two different needs: the whole page on the cartridge's own
 * paper, which is what the boot screen and the centred panel want, and the
 * graphics rows alone on frosted glass, which is what the panel beside the
 * diorama wants -- there is a world behind that one, and it is the point.
 *
 * The frame is drawn to the rows it actually has rather than to the screen, so
 * the glass plate beside the world is no taller than the settings on it.
 */
export function paintViewOptionRows(
  canvas: GbCanvas, font: GbFont, settings: ViewSettings, all: number[],
  cursorRow: number, cursorCode: number, hollowCode: number, fillShade: number
): void {
  const rows = visibleRows(all, cursorRow);
  const tall = Math.min(18, 2 + rows.length * 2);
  font.box(canvas, 0, 0, 20, tall, fillShade);
  // Say so when the ladder runs on past the frame, on the row nearest the edge
  // it continues over. Without this the page is a list with no bottom.
  const more = all.length > rows.length;
  const above = more && all.indexOf(rows[0]) > 0;
  const below = more && all.indexOf(rows[rows.length - 1]) < all.length - 1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const y = (1 + i * 2) * TILE;
    if (cursorRow === row) {
      font.code(canvas, cursorCode, 1 * TILE, y);
    }
    if (row === ROW_CANCEL || row === ROW_PLACE || row === ROW_FINDPAD) {
      // An action, so no arrows and no value: those say "this row is a ladder"
      // and this row is a button.
      font.text(canvas, rowLabel(row), 2 * TILE, y);
      continue;
    }
    font.text(canvas, rowLabel(row), 2 * TILE, y);
    const values = rowValues(row);
    const chosen = row === ROW_PRESET ? 0 : rowChosen(row, settings);
    const text = values[chosen] ? values[chosen] : "";
    // The arrows say the row is a ladder. Hollow while the cursor is
    // elsewhere, so the page shows at a glance which row is live.
    const mark = cursorRow === row ? cursorCode : hollowCode;
    font.code(canvas, mark, VALUE_COLUMN * TILE, y);
    font.text(canvas, text, (VALUE_COLUMN + 1) * TILE, y);
    font.code(canvas, mark, (VALUE_COLUMN + 1 + text.length) * TILE, y);
  }
  if (above) {
    font.text(canvas, "^", 18 * TILE, 1 * TILE);
  }
  if (below) {
    font.text(canvas, "v", 18 * TILE, (1 + (rows.length - 1) * 2) * TILE);
  }
}
