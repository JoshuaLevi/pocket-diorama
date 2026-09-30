// The value grade that makes a wall look like a wall through the glasses.
//
// Pure: colours in, colours out. No Lens Studio, no scene, no texture -- so
// test/legibility.test.mjs can measure the whole world from Node.
//
// THE PROBLEM, measured over all 222 maps of the bundle before this file
// existed: the luminance of a top face carried almost no information about
// whether you could stand on it. On 168 of them the walkable ground was
// BRIGHTER than the things that stop you, and the sign flipped from map to
// map -- Route 1's tree canopy stood brighter than the lawn it grew out of
// while its buildings were nearly black. There was no rule to learn, which is
// exactly the complaint the 8 September glasses playtest came back with:
// "op plekken dat ik denk dat ik ergens doorheen kan lopen stoot ik tegen een
// muur op".
//
// THE FIX is not more colour, it is an ORDER. Every category is given a value
// BAND -- a target relative luminance -- and the ground families are pushed to
// the bottom of the panel's range while the blocking families are lifted
// toward the top. Hue is left alone: the scale happens in LINEAR light and
// multiplies all three channels by one number, so a green stays exactly as
// green as it was and only its brightness moves. Measured over every palette
// in the cartridge, no coloured texel turns more than 6 degrees of hue.
//
// WHY THIS DIRECTION and not the other. An optical see-through display is
// ADDITIVE: it can add light to the room but never subtract any. So a dark
// voxel is a TRANSPARENT voxel, and the darkest thing on screen is the least
// visible thing on screen. The ground is the largest surface and the one the
// wearer looks THROUGH to see their table, so the ground is what should sink;
// the obstacles are the ones that must be made of light. Doing it the other
// way round -- darkening the walls -- would make the walls disappear.
//
// It also costs less power, which the 8 September test needs: sinking the
// largest surface in the frame drops mean emitted luminance about a third,
// and that session ended with the Spectacles throttling to cool down.
//
// The owner chose legibility over the cartridge's exact colours here. The
// cartridge is still one press away -- see the COLOUR row in DayTint.

/**
 * The categories VALUE_BANDS is parallel to, in order.
 *
 * Spelled out rather than imported from VoxelPalette, which imports THIS file:
 * a cycle would be worse than a duplicated list, and legibility.test.mjs
 * asserts the two are identical, so they cannot drift apart in silence.
 */
export const VALUE_BAND_CATEGORIES: string[] = [
  "GRASS", "TALL_GRASS", "PATH", "SAND", "WATER", "TREE", "STRUCTURE", "LEDGE",
  "DIRT", "FLOOR", "WALL", "DOOR", "ROCK", "FURNITURE", "MACHINE", "LINEN", "PLANT", "TILE", "CABINET", "MAP",
];

/**
 * Target Rec.709 relative luminance, 0..100, at shade 0 and at shade 3.
 *
 * A category's four inks keep their own spread -- the band gives the lightest
 * and the darkest of them a target and the two in between are interpolated --
 * so a lawn is still a lawn with its own texture rather than one flat slab.
 *
 * Read the table as three families:
 *
 *   the GROUND, 10..21, sunk toward transparent. GRASS, SAND, DIRT and FLOOR
 *   are the plain floor; PATH sits a touch above it because a road IS a thing
 *   you see; TALL_GRASS is highest of the three because it is the surface a
 *   wild Pokemon comes out of and the player must be able to aim at it.
 *
 *   the HOP, 38..16: a LEDGE is the one thing that is neither. You may cross
 *   it downward and not upward, so it is placed deliberately between the two
 *   families rather than in either.
 *
 *   the OBSTACLES, 46..82, lifted toward emissive. WATER first (it blocks you
 *   until Surf, and it should not read as hard as a wall), then ROCK, TREE,
 *   STRUCTURE and WALL together near the top, and DOOR above all of them
 *   because a door is not an obstacle at all -- it is the target.
 *
 * MAP is empty on purpose. It is not a category; it is the map's own four
 * colours standing in for a tile the tileset never classified, and regrading
 * it would be regrading the map itself.
 */
export const VALUE_BANDS: number[][] = [
  [12, 4],    // GRASS
  [21, 7],    // TALL_GRASS
  [17, 6],    // PATH
  [12, 4],    // SAND
  [46, 20],   // WATER
  [62, 33],   // TREE
  [66, 30],   // STRUCTURE
  [38, 16],   // LEDGE
  [10, 4],    // DIRT
  [12, 4],    // FLOOR
  [66, 30],   // WALL
  [70, 36],   // DOOR
  [62, 40],   // ROCK: since 29 September the mountain routes' cliffs (not a cave's walls alone), so the dark courses stay above the path
  [66, 30],   // FURNITURE: the wall's band, so a room's contrast is what it was
  // The three below keep their own ramp's TOP and the blocking families'
  // floor of 30: Gen 1 draws a plant, a bed or a machine with a third of
  // its pixels in the darkest grey, and a floor of 4 turned those outlines
  // black and sank the whole object toward the ground's band (the gates and
  // the centres lost their +20 on 29 September).
  [84, 30],   // MACHINE
  [93, 30],   // LINEN
  [62, 30],   // PLANT
  [12, 4],    // TILE: a floor, like the boards
  [66, 30],   // CABINET: stands where furniture stands
  [],         // MAP: the map's own colours, left alone
];

/** One sRGB byte, undone back to the light it stands for. */
function toLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Light, encoded back into an sRGB byte's worth of value. */
function toSrgb(light: number): number {
  const v = light < 0 ? 0 : light > 1 ? 1 : light;
  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
}

/**
 * One colour, moved to the luminance its category's band asks of its shade.
 *
 * `amount` is the LEGIBILITY row: 0 returns the colour untouched, byte for
 * byte, which is what lets the rungs of the COLOUR row be a comparison rather
 * than a replacement. 1 is the full regrade.
 *
 * A colour whose band would take it outside the RGB cube is pushed as far as
 * the cube allows and clipped there -- the only place hue moves at all, and it
 * is measured at 6 degrees in the worst case in the whole cartridge. A colour
 * that is already black has no hue to keep and is lifted as a grey, which is
 * the case that matters most on an additive panel: black is invisible.
 */
export function readableValue(rgb: number[], band: number[], shade: number,
                              amount: number): number[] {
  if (!band || band.length < 2 || amount <= 0) {
    return rgb;
  }
  const step = shade < 0 ? 0 : shade > 3 ? 3 : shade;
  const target = (band[0] + (band[1] - band[0]) * step / 3) / 100;
  const r = toLinear(rgb[0]);
  const g = toLinear(rgb[1]);
  const b = toLinear(rgb[2]);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let graded: number[];
  if (y < 0.0005) {
    graded = [toSrgb(target), toSrgb(target), toSrgb(target)];
  } else {
    const k = target / y;
    graded = [toSrgb(r * k), toSrgb(g * k), toSrgb(b * k)];
  }
  const mix = amount > 1 ? 1 : amount;
  return [
    rgb[0] + (graded[0] - rgb[0]) * mix,
    rgb[1] + (graded[1] - rgb[1]) * mix,
    rgb[2] + (graded[2] - rgb[2]) * mix,
  ];
}
