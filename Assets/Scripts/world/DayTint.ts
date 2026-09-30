// What time of day the diorama is lit at, and how much colour it carries.
//
// Two effects, one multiply, and both of them free: the palette texture is
// built once per map and this happens in the same loop as the face shading, so
// a golden hour costs no frames at all.
//
// TINT is the reference's day/night clock (`DayNight.lua`, `DayTint.lua`),
// which it uses to swing a generated sky from blue at noon to gold and violet
// at dusk to navy under the moon. We cannot have its sky -- an optical
// see-through display has no way to block the room behind a dome -- but the
// half of that effect that lands on the WORLD is ours for a multiply.
//
// SATURATION is the lift the reference hides inside its tilt-shift. Its blur
// does not transfer (see docs/RESEARCH-look-and-light.md), but the lift does,
// and it is the difference between voxel colours that read as a toy and
// voxel colours that read as flat paint.
//
// Pure: colours in, colours out. No texture, no scene.

/** The rungs of the TIME row. SYNC follows the wearer's own clock. */
export const TIME_LABELS: string[] = ["DAY", "DUSK", "NIGHT", "SYNC"];
export const TIME_DAY: number = 0;
export const TIME_DUSK: number = 1;
export const TIME_NIGHT: number = 2;
export const TIME_SYNC: number = 3;

/**
 * The multiplier each hour of the day puts on the world, as [r, g, b].
 *
 * Not a colour to blend toward -- a multiply. A tint that ADDS light makes a
 * night scene glow; one that multiplies can only ever take light away, which
 * is what evening actually does. Dusk keeps the reds and drops the blues, night
 * does the opposite, and noon is left alone entirely so DAY is exactly the
 * world we have been looking at all along.
 */
const TINTS: number[][] = [
  [1.00, 1.00, 1.00],   // DAY
  [1.00, 0.82, 0.66],   // DUSK: gold, blues pulled down
  [0.62, 0.68, 0.95],   // NIGHT: navy, the moon is cold
];

/**
 * Which tint a rung means, resolving SYNC against the hour.
 *
 * `hour` is 0..23 in the wearer's own time. The bands are the ones a window
 * gives you rather than an almanac: it is "night" when the lights are on.
 */
export function tintFor(rung: number, hour: number): number[] {
  let at = rung;
  if (rung === TIME_SYNC) {
    const h = hour < 0 ? 0 : hour > 23 ? 23 : Math.floor(hour);
    at = h >= 20 || h < 6 ? TIME_NIGHT : (h >= 17 || h < 8 ? TIME_DUSK : TIME_DAY);
  }
  if (at < 0 || at >= TINTS.length) {
    at = TIME_DAY;
  }
  return TINTS[at];
}

/**
 * The COLOUR row: how far each rung pushes a colour from its own grey, and
 * whether it also regrades the world's VALUE for the glasses.
 *
 * READ is the rung the lens opens on, and it is the one that changes what the
 * world MEANS rather than only what it looks like: every category's luminance
 * is re-ranked so that the things that stop you are brighter than the ground
 * you walk on. Before it, the ground was the brighter of the two on 168 of the
 * bundle's 222 maps -- see Legibility.ts and test/legibility.test.mjs.
 *
 * FLAT is deliberately its NEIGHBOUR. FLAT is the cartridge exactly: no lift,
 * no regrade, the four colours Game Freak chose. The owner picked legibility
 * over fidelity, and one press to the left is still the whole answer to "but
 * what did the cartridge look like".
 *
 * READ carries LESS chroma than LOW, which is a measurement rather than a
 * preference: the regrade lifts the obstacle colours toward the top of the
 * cube, saturation pushes them further, and the two together start clipping
 * channels -- worst hue drift is 4.6 degrees at 1.10 and 10.5 at 1.50. The
 * gentlest lift that still separates the greens is the one to spend here.
 */
export const SATURATION_LEVELS: number[] = [1.0, 1.10, 1.15, 1.3, 1.5];
export const SATURATION_LABELS: string[] = ["FLAT", "READ", "LOW", "MID", "HIGH"];
/** The cartridge exactly: no lift, no regrade. */
export const SATURATION_FLAT: number = 0;
/** The legibility regrade. The only rung that is not a colour. */
export const SATURATION_READ: number = 1;
/**
 * The most colour this ladder carries, and the default since 10 September.
 *
 * Measured rather than chosen, off the wearer's own fourth recording of that
 * day -- one diorama, one room, one lighting, the COLOUR row walked from FLAT
 * to HIGH while the glasses filmed it. Mean saturation and mean value of the
 * model's own pixels, and the tenth-to-ninetieth spread of their value:
 *
 *   FLAT  S 0.379  V 0.501  spread 0.396
 *   READ  S 0.390  V 0.456  spread 0.400
 *   LOW   S 0.424  V 0.499  spread 0.388
 *   MID   S 0.426  V 0.504  spread 0.404
 *   HIGH  S 0.477  V 0.523  spread 0.451
 *
 * HIGH wins all three, and the third column is the surprise: a saturation
 * lift buys CONTRAST on this display, where READ buys its contrast by sinking
 * the ground -- and on an additive panel a sunk ground is a transparent one,
 * which is why the lawn in that recording reads as a hole in the model.
 *
 * The reference's own number is lower: its tilt-shift carries "een lichte
 * verzadigingslift" over the sprite's own colours, which is LOW or MID here.
 * That number is right for a screen. A waveguide loses chroma to whatever the
 * room is doing behind it, so reproducing the reference's IMPRESSION costs a
 * rung or two more than reproducing its multiplier. LOW and MID come out 0.002
 * apart through the glasses; they are the same rung out there.
 */
export const SATURATION_HIGH: number = 4;
/**
 * How much of the legibility regrade each rung applies. 0 is the world we
 * already had, to the byte.
 *
 * A save written before this row grew keeps its number, so an old `colour: 1`
 * lands on READ and an old 2 or 3 slides one rung down the colour ladder.
 * Neither can be out of range, which is what sanitiseViewSettings guarantees.
 */
export const LEGIBILITY_LEVELS: number[] = [0, 1, 0, 0, 0];

/**
 * One colour, tinted and saturated.
 *
 * Saturation first, then the tint. The other order saturates the tint's own
 * cast and turns a mild evening into an orange filter -- the world should get
 * more colourful, not more ORANGE.
 *
 * Each channel is clamped rather than normalised: a colour that would leave
 * the cube is a colour at the edge of it, and rescaling the whole triple to
 * bring it back changes the hue of something that was only ever too bright.
 */
export function gradeColour(rgb: number[], tint: number[], saturation: number): number[] {
  // Rec. 601 luma: the grey a colour would be, weighted the way an eye weights it.
  const grey = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    let v = grey + (rgb[i] - grey) * saturation;
    v = v * tint[i];
    out.push(v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  }
  return out;
}
