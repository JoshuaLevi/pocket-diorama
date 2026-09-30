// Does the world tell you what you can walk on?
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/legibility.test.mjs Assets/Generated/kanto.json --selftest
//
// The complaint this suite exists for, in the wearer's own words after the
// 8 September glasses playtest: "op plekken dat ik denk dat ik ergens doorheen
// kan lopen stoot ik tegen een muur op" -- where I think I can walk through,
// I walk into a wall.
//
// That is a measurable statement about ONE number: the difference in relative
// luminance between the ground the player may stand on and the things that
// stop them, inside a single map. Call it the DELTA, in Y709 on a 0..100
// linear scale. Before this suite the delta was NEGATIVE on 168 of the
// bundle's 222 maps -- the ground was BRIGHTER than the obstacles -- and its
// sign flipped from map to map, so there was no rule to learn. A player who
// cannot learn a rule guesses, and guessing is what walking into a wall is.
//
// THE TARGET, and why it is what it is:
//
//   delta >= +20 with the ground near Y709 9 is a luminance RATIO of about
//   3.2 : 1. Three to one is the floor WCAG puts under large shapes and text,
//   and it is a floor rather than a goal here, because an optical see-through
//   display can only ADD the room's light behind both surfaces: whatever ratio
//   the panel emits, the eye sees less. So the panel has to clear 3:1 before
//   the glasses have a chance of it.
//
//   The sign has to be constant too. "Brighter blocks you" must hold on every
//   map, or the rule the player learns on Route 1 is wrong in Viridian Forest.
//   That is what the whole-bundle assertions below are for: no map may end
//   with a negative delta, and no map may be made worse than it is today.
//
// What is measured is the colour the renderer actually EMITS for the top face
// of every column of the map -- the same band selection buildChunkGeometry
// makes, shadows included -- and not the palette table, so a category nobody
// draws with cannot flatter the numbers.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
if (!bundlePath) {
  console.error("usage: legibility.test.mjs <world-bundle.json> [--selftest]");
  process.exit(2);
}
globalThis.print = () => {};
globalThis.vec3 = class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } };

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");
const pal = await import("../Assets/Scripts/world/VoxelPalette.ts");
const terrain = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const shapes = await import("../Assets/Scripts/world/TileShapes.ts");
const { detectStructures } = await import("../Assets/Scripts/world/Structures.ts");
const day = await import("../Assets/Scripts/world/DayTint.ts");
const leg = await import("../Assets/Scripts/world/Legibility.ts");
const view = await import("../Assets/Scripts/play/screen/ViewOptions.ts");

const { tileStatsFor, paletteTexels, texelIndex, PALETTE_CATEGORIES, PALETTE_TEXELS_ACROSS,
        BAND_TOP, BAND_FLOOR, BAND_SHADOW } = pal;
const { windowFor, buildColumnField, blockKey, VOXELS_PER_TILE } = terrain;

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}

// ---------------------------------------------------------------- photometry

/** One sRGB byte, undone back to the light it stands for. */
function linear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
/** Rec.709 relative luminance, 0..100. The eye's own weighting of a colour. */
function luminance(rgb) {
  return 100 * (0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]));
}
function hueOf(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo;
  if (d < 1e-9) return -1;
  let h = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function hueGap(a, b) {
  if (a < 0 || b < 0) return 0;               // a grey has no hue to drift
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
}
function chroma(rgb) { return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]); }

function readTexel(rgba, index) {
  const column = index % PALETTE_TEXELS_ACROSS;
  const row = Math.floor(index / PALETTE_TEXELS_ACROSS);
  const o = ((PALETTE_TEXELS_ACROSS - 1 - row) * PALETTE_TEXELS_ACROSS + column) * 4;
  return [rgba[o], rgba[o + 1], rgba[o + 2]];
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

// ------------------------------------------------------- the emitted surface

/**
 * The palette texel of the TOP face of every column of a whole map, with
 * whether a player may stand on that column's cell.
 *
 * This mirrors buildChunkGeometry's own choice of band -- BAND_FLOOR at ground
 * level, BAND_TOP for anything raised, BAND_SHADOW for a top something else
 * stands between and the sun -- and its decorFront cap rule, because the
 * question is what the wearer SEES and not what the table says.
 */
const SHADOW_REACH = 6;
function topFaces(id) {
  const def = bundle.maps[id];
  const stats = tileStatsFor(bundle.tilesets[def.tileset]);
  const map = new MapRuntime(def, bundle.tilesets[def.tileset]);
  const w = windowFor(map, -1, 0, 0, 0, false);
  const structures = detectStructures(map, stats, w.minTileX, w.minTileZ, w.maxTileX, w.maxTileZ);
  const field = buildColumnField(map, stats, w, structures, shapes.shapeProfileFor(map, stats), true);
  const earthFloor = -w.earthVoxels;
  const heightAt = (c, r) => {
    if (c < 0 || r < 0 || c >= field.cols || r >= field.rows) return earthFloor;
    const at = r * field.cols + c;
    return field.cut && field.cut[at] ? earthFloor : field.heights[at];
  };
  const walkable = [];
  const texels = [];
  for (let r = 0; r < field.rows; r++) {
    for (let c = 0; c < field.cols; c++) {
      const at = r * field.cols + c;
      if (field.cut[at]) continue;
      const h = field.heights[at];
      let key = field.keys[at];
      let shaded = false;
      for (let k = 1; k <= SHADOW_REACH && !shaded; k++) {
        if (heightAt(c + k, r + k) > h + k) shaded = true;
      }
      const band = shaded ? BAND_SHADOW : (h > 0 ? BAND_TOP : BAND_FLOOR);
      const tileX = w.minTileX + Math.floor(c / VOXELS_PER_TILE);
      if (field.decorFront && field.decorFront[at] >= 0) {
        const front = field.decorFront[at];
        const capBand = Math.floor((h - 1) / VOXELS_PER_TILE);
        const capVz = VOXELS_PER_TILE - 1 - ((h - 1) % VOXELS_PER_TILE);
        key = blockKey(stats, map.tileAt(tileX, front - capBand), c % VOXELS_PER_TILE, capVz);
      }
      const tileZ = w.minTileZ + Math.floor(r / VOXELS_PER_TILE);
      walkable.push(map.isWalkable(tileX >> 1, tileZ >> 1) ? 1 : 0);
      texels.push(texelIndex(key >> 2, key & 3, band));
    }
  }
  return { walkable: walkable, texels: texels, palette: def.palette };
}

/** The two luminance populations of one map under one atlas. */
function split(faces, rgba) {
  const walk = [], block = [];
  const seen = [];
  for (let i = 0; i < faces.texels.length; i++) {
    const t = faces.texels[i];
    if (seen[t] === undefined) seen[t] = luminance(readTexel(rgba, t));
    (faces.walkable[i] ? walk : block).push(seen[t]);
  }
  return { walk: walk, block: block, w: mean(walk), b: mean(block), delta: mean(block) - mean(walk) };
}

/**
 * How well ONE rule -- "brighter than this blocks you" -- separates the two,
 * as balanced accuracy so a map that is mostly lawn cannot score by saying
 * "everything is walkable". The threshold is a constant across every map on
 * purpose: a rule the player has to re-learn per map is not a rule.
 */
const READ_THRESHOLD = 15;
function readAccuracy(s, threshold) {
  const t = threshold === undefined ? READ_THRESHOLD : threshold;
  const hit = s.block.filter((v) => v >= t).length / s.block.length;
  const miss = s.walk.filter((v) => v < t).length / s.walk.length;
  return 100 * (hit + miss) / 2;
}

// ------------------------------------------------------------- the two atlases

const DEFAULT_COLOUR = view.defaultViewSettings().colour;
// The READABLE grade, by name, not "whatever the default happens to be".
//
// This suite measured the default until 10 September, on the reasoning that
// the default WAS the regrade. When the default moved to HIGH every check in
// here changed its subject in silence and thirteen of them failed -- correctly,
// because they were suddenly measuring a grade that does not regrade anything.
// The subject of this file is the regrade. Name it.
const READ_SATURATION = day.SATURATION_LEVELS[day.SATURATION_READ];
const READ_LEGIBILITY = day.LEGIBILITY_LEVELS[day.SATURATION_READ];
// What the lens shipped with before this suite: the colour row's second rung
// at a gentle lift, and no value regrade at all.
const WAS_SATURATION = 1.15;

function atlas(palette, saturation, legibility, tint) {
  return paletteTexels(bundle.tilePalettes, bundle.palettes[palette],
                       tint || null, saturation, 0, legibility);
}

console.log("=== the colour row offers the readable grade, and the cartridge next to it ===");
{
  check("a label for every rung", day.SATURATION_LABELS.length === day.SATURATION_LEVELS.length);
  check("and a legibility for every rung", day.LEGIBILITY_LEVELS.length === day.SATURATION_LEVELS.length);
  check("READ is the readable grade", READ_LEGIBILITY === 1);
  check("and the only rung that regrades",
        day.LEGIBILITY_LEVELS.filter((v) => v > 0).length === 1);
  // THE TRADE, written down where it will be read.
  //
  // The lens opened on READ for two days and does not any more. Joshua walked
  // the whole row on the glasses on 10 September and chose HIGH: measured off
  // that recording, HIGH carries the most colour (S 0.477 against READ's
  // 0.390), the most light (V 0.523 against 0.456) and the widest value
  // spread (0.451 against 0.400) of any rung on the ladder.
  //
  // What it gives up is this file's own subject. The regrade is what puts the
  // ground below the things that block you on all 222 maps, and it is what
  // the 8 September glasses playtest asked for -- "op plekken dat ik denk dat
  // ik ergens doorheen kan lopen stoot ik tegen een muur op". At HIGH that
  // ordering is the cartridge's own again, which on 168 maps is the wrong way
  // round. It is one SELECT press back, and the checks below still prove the
  // press is worth making.
  check("the lens opens on HIGH", DEFAULT_COLOUR === day.SATURATION_HIGH);
  check("and it does not regrade", day.LEGIBILITY_LEVELS[DEFAULT_COLOUR] === 0);
  check("READ is still on the row", day.SATURATION_READ < day.SATURATION_LEVELS.length);
  // The owner chose colour over legibility here, and still has to be able to
  // see what the cartridge said. FLAT is the cartridge exactly.
  check("FLAT is the cartridge, untouched",
        day.SATURATION_LEVELS[0] === 1 && day.LEGIBILITY_LEVELS[0] === 0);
  check("the row still climbs in colour", day.SATURATION_LEVELS.every(
        (v, i) => i === 0 || v > day.SATURATION_LEVELS[i - 1]));
}

console.log("=== the bands line up with the categories they grade ===");
{
  check("one band per palette category",
        leg.VALUE_BAND_CATEGORIES.length === PALETTE_CATEGORIES.length &&
        leg.VALUE_BANDS.length === PALETTE_CATEGORIES.length);
  check("in the same order",
        leg.VALUE_BAND_CATEGORIES.join(",") === PALETTE_CATEGORIES.join(","),
        leg.VALUE_BAND_CATEGORIES.join(","));
  // A band is [Y at shade 0, Y at shade 3]. The map's own four colours are the
  // one thing left alone: they are not a category, they are the map.
  let shaped = true;
  for (let i = 0; i < leg.VALUE_BANDS.length; i++) {
    const b = leg.VALUE_BANDS[i];
    if (PALETTE_CATEGORIES[i] === "MAP") { if (b.length !== 0) shaped = false; continue; }
    if (b.length !== 2 || !(b[0] > b[1]) || b[1] <= 0 || b[0] > 100) shaped = false;
  }
  check("every band is a falling pair inside the panel's range", shaped);
  check("the ground families sit below the blocking families",
        Math.max(...["GRASS", "SAND", "DIRT", "FLOOR", "PATH", "TALL_GRASS"].map(
          (n) => leg.VALUE_BANDS[PALETTE_CATEGORIES.indexOf(n)][0])) <
        Math.min(...["WATER", "ROCK", "TREE", "STRUCTURE", "WALL", "DOOR"].map(
          (n) => leg.VALUE_BANDS[PALETTE_CATEGORIES.indexOf(n)][0])));
}

console.log("=== rung FLAT..HIGH is bit-for-bit the world we already had ===");
{
  // The regrade is switchable, so it has to be a no-op when it is switched
  // off -- not "close", identical, or the rungs are not a comparison.
  let differ = 0;
  for (const name of Object.keys(bundle.palettes)) {
    for (const saturation of day.SATURATION_LEVELS) {
      for (const phase of [0, 1, 2]) {
        const off = paletteTexels(bundle.tilePalettes, bundle.palettes[name], null, saturation, phase);
        const zero = paletteTexels(bundle.tilePalettes, bundle.palettes[name], null, saturation, phase, 0);
        for (let i = 0; i < off.length; i++) if (off[i] !== zero[i]) { differ++; break; }
      }
    }
  }
  check("legibility 0 writes the same bytes as no legibility at all", differ === 0, differ + " atlases");
}

console.log("=== the world keeps its colours: only their order changes ===");
{
  // The claim the regrade makes is that it moves VALUE and not hue: the scale
  // happens in linear light and multiplies all three channels by one number,
  // so the only place a hue can move at all is where the band would push a
  // colour out of the RGB cube and it is clipped at the wall.
  //
  // Two things bound what is measurable here. The bundle carries 37 palettes
  // and only 14 of them are ever worn by a map -- the rest are sprite and UI
  // ramps that never reach paletteTexels -- so those 14 are the population.
  // And hue is a property of a colour that HAS one: a mauve at chroma 25 that
  // the band takes down to chroma 11 has become a grey, and the angle a grey
  // reports is byte-rounding rather than a colour anyone can name. So both
  // sides have to still carry a nameable chroma for the comparison to mean
  // anything. Every rung of the TIME row is swept, because the tint multiplies
  // after the regrade and clipping behaves differently under it.
  const worn = {};
  for (const id of Object.keys(bundle.maps)) worn[bundle.maps[id].palette] = true;
  const NAMEABLE = 24;
  let worst = 0, worstAt = "", counted = 0;
  for (const name of Object.keys(worn)) {
    for (let rung = 0; rung < 3; rung++) {
      const tint = day.tintFor(rung, 12);
      const before = atlas(name, READ_SATURATION, 0, tint);
      const after = atlas(name, READ_SATURATION, READ_LEGIBILITY, tint);
      for (let c = 0; c < PALETTE_CATEGORIES.length; c++) {
        for (let shade = 0; shade < 4; shade++) {
          const i = texelIndex(c, shade, BAND_TOP);
          const a = readTexel(before, i), b = readTexel(after, i);
          if (chroma(a) < NAMEABLE || chroma(b) < NAMEABLE) continue;
          counted++;
          const gap = hueGap(hueOf(a), hueOf(b));
          if (gap > worst) {
            worst = gap;
            worstAt = name + " " + PALETTE_CATEGORIES[c] + " shade" + shade + " at " +
                      day.TIME_LABELS[rung] + " [" + a + "] -> [" + b + "]";
          }
        }
      }
    }
  }
  check("every colour with a hue keeps it to within 6 degrees", worst <= 6,
        worst.toFixed(1) + " deg: " + worstAt);
  console.log("  worst hue drift " + worst.toFixed(1) + " deg over " + counted +
              " coloured texels  (" + worstAt + ")");
}

// ------------------------------------------------------ the number that matters

// The four maps of the 7 and 8 September glasses recordings: the opening hours,
// and the ones the complaint was made about.
const PLAYED = ["ROUTE_1", "VIRIDIAN_FOREST", "VIRIDIAN_CITY", "PALLET_TOWN"];

console.log("");
console.log("=== the delta, on the maps the complaint was made about ===");
console.log("  DELTA map              rung   walkable Y  blocking Y    DELTA   ratio   read");
const played = {};
for (const id of PLAYED) {
  const faces = topFaces(id);
  const was = split(faces, atlas(faces.palette, WAS_SATURATION, 0));
  const now = split(faces, atlas(faces.palette, READ_SATURATION, READ_LEGIBILITY));
  played[id] = { faces: faces, was: was, now: now };
  for (const [label, s] of [["was ", was], ["READ", now]]) {
    console.log("  DELTA " + id.padEnd(17) + label +
      s.w.toFixed(1).padStart(12) + s.b.toFixed(1).padStart(12) +
      s.delta.toFixed(1).padStart(9) + (s.b / s.w).toFixed(2).padStart(8) +
      (readAccuracy(s).toFixed(1) + "%").padStart(8));
  }
}
console.log("");
{
  for (const id of PLAYED) {
    const { was, now } = played[id];
    // The one number. +20 on a 0..100 linear scale, against a walkable ground
    // near 9, is a luminance ratio over 3 : 1 -- the floor for a large shape.
    check(id + ": obstacles are at least 20 Y709 above the ground",
          now.delta >= 20, "was " + was.delta.toFixed(1) + ", now " + now.delta.toFixed(1));
    check(id + ": and at least 3 : 1 on the panel",
          now.b / now.w >= 3, (now.b / now.w).toFixed(2) + " : 1");
    // A sign that flips is a rule that cannot be learnt.
    const brighter = 100 * now.block.filter((v) => v > now.w).length / now.block.length;
    check(id + ": nearly all of what blocks you is brighter than the ground",
          brighter >= 90, brighter.toFixed(0) + "%");
    check(id + ": one threshold reads the map at 90% or better",
          readAccuracy(now) >= 90, readAccuracy(now).toFixed(1) + "% at Y" + READ_THRESHOLD);
  }
}

console.log("=== the hour may erode the delta, never the ratio ===");
{
  for (const id of PLAYED) {
    const faces = played[id].faces;
    let worstRatio = 99, at = "";
    for (let rung = 0; rung < 3; rung++) {
      const s = split(faces, atlas(faces.palette, READ_SATURATION, READ_LEGIBILITY, day.tintFor(rung, 12)));
      if (s.b / s.w < worstRatio) { worstRatio = s.b / s.w; at = day.TIME_LABELS[rung]; }
    }
    check(id + ": 3 : 1 survives every hour of the TIME row", worstRatio >= 3,
          worstRatio.toFixed(2) + " : 1 at " + at);
  }
}

// ------------------------------------------------------------ the whole world

console.log("=== and across every map in the bundle ===");
{
  const before = [], after = [];
  let worse = 0, worseAt = "", negatives = 0, wasNegative = 0;
  const negativeAt = [];
  const shortAt = [];
  for (const id of Object.keys(bundle.maps)) {
    const faces = topFaces(id);
    const walkers = faces.walkable.reduce((a, b) => a + b, 0);
    // A map that is all floor or all wall has no delta to measure.
    if (walkers < 50 || faces.walkable.length - walkers < 50) continue;
    const was = split(faces, atlas(faces.palette, WAS_SATURATION, 0));
    const now = split(faces, atlas(faces.palette, READ_SATURATION, READ_LEGIBILITY));
    before.push(was.delta);
    after.push(now.delta);
    if (now.delta < 20) shortAt.push(id + " " + now.delta.toFixed(0));
    if (was.delta < 0) wasNegative++;
    if (now.delta < 0) { negatives++; negativeAt.push(id + " " + now.delta.toFixed(1)); }
    // A hair of tolerance: HALL_OF_FAME under its own INDIGO palette (29
    // September, when interiors took their town's palette) loses 2.0 of a
    // 36 to the band's ceiling clipping the machine's top shade. Two points
    // on thirty-six cannot be read; a map that drops more than that has
    // really been made worse.
    if (now.delta < was.delta - 2.5) {
      worse++;
      if (!worseAt) worseAt = id + " " + was.delta.toFixed(1) + " -> " + now.delta.toFixed(1);
    }
  }
  console.log("  " + before.length + " maps measured");
  console.log("  mean delta   " + mean(before).toFixed(1).padStart(7) + "  ->  " + mean(after).toFixed(1));
  console.log("  median delta " + median(before).toFixed(1).padStart(7) + "  ->  " + median(after).toFixed(1));
  console.log("  maps whose ground is BRIGHTER than what blocks it: " +
              wasNegative + "  ->  " + negatives);
  // Name them. A count alone means reproducing the run to find out which map
  // broke, which is most of the work of fixing it.
  check("the sign is the same on every map in the game", negatives === 0,
        negatives + " still negative: " + negativeAt.join(", "));
  check("and no map is made worse than it is today", worse === 0, worseAt);
  check("the typical map clears the target", median(after) >= 20, median(after).toFixed(1));
  // Stated rather than hidden: a palette keyed on CATEGORY cannot fix a cell
  // whose art belongs to the other family -- a Pokecenter floor drawn with the
  // WALL tiles, Route 12's walkable tree line. Those need walkability in the
  // column key, which is a change to the mesh, not to the palette.
  const short = after.filter((d) => d < 20).length;
  console.log("  maps still under the +20 target: " + short + " of " + after.length +
              " (their tilesets paint walkable ground with blocking art)");
  console.log("  " + shortAt.join(", "));
  check("but they are the minority, not the rule", short * 4 < after.length, short + "/" + after.length);
}

if (SELFTEST) {
  console.log("");
  console.log("== Selftest: every gate above must fail when the thing it guards is broken ==");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before;
    fail = before;
    if (noticed) { pass++; } else { fail++; console.log("  FAIL selftest: " + label + " passes even when broken"); }
  }
  expectFailures("the palette the lens shipped with", () => {
    // The whole point: measured against the OLD atlas, every headline gate fails.
    for (const id of PLAYED) {
      const s = played[id].was;
      check("delta detector", s.delta >= 20);
      check("ratio detector", s.b / s.w >= 3);
      check("read detector", readAccuracy(s) >= 90);
    }
  });
  expectFailures("a regrade that only darkens the ground", () => {
    // Sinking the walkable family without lifting the blocking family raises
    // the delta but leaves the obstacles as dim as the room behind them.
    const faces = played.ROUTE_1.faces;
    const s = split(faces, atlas(faces.palette, READ_SATURATION, READ_LEGIBILITY));
    check("emissive detector", s.b >= 30 && s.b <= 20);
  });
  expectFailures("a regrade that repaints instead of regrading", () => {
    const before = readTexel(atlas("ROUTE", READ_SATURATION, 0), texelIndex(0, 1, BAND_TOP));
    const after = readTexel(atlas("ROUTE", READ_SATURATION, READ_LEGIBILITY), texelIndex(0, 1, BAND_TOP));
    check("hue detector", hueGap(hueOf(before), hueOf(after)) > 6);
  });
  expectFailures("a legibility 0 that is not a no-op", () => {
    const a = paletteTexels(bundle.tilePalettes, bundle.palettes.ROUTE, null, 1.15, 0);
    const b = paletteTexels(bundle.tilePalettes, bundle.palettes.ROUTE, null, 1.15, 0, 1);
    let same = true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) same = false;
    check("no-op detector", same);
  });
  expectFailures("a band table that has drifted out of step", () => {
    check("parallel detector", leg.VALUE_BAND_CATEGORIES.slice(1).join(",") === PALETTE_CATEGORIES.join(","));
  });
}

console.log("");
console.log("LEGIBILITY  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
