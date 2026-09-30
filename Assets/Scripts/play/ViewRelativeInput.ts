// Which way is "up" when you have walked round the table.
//
// Joshua, 10 September, playing on the glasses: "als ik het spel neerzet en
// links en rechts beweeg werkt alles prima, maar loop ik om het spel heen dan
// draait mijn karakter mee maar de controls blijven hetzelfde, waardoor ik
// vanuit een andere hoek dezelfde controls behoud."
//
// Two things are wrong there and they are the same number.
//
//   THE CONTROLS. Overworld.heldDirection turns a d-pad press straight into a
//   MAP direction: UP is north, always, because that is what a Game Boy meant
//   by up. On a screen that is correct for ever. On a table it is correct from
//   exactly one side of the table.
//
//   THE CHARACTER. updatePlayerTransform picks the sprite frame from the map
//   facing and then turns the quad to face the wearer. The card turns; the
//   drawing on it does not. Walk round to the far side and Red walks toward
//   you showing you the back of his head. The reference does the other half
//   too -- RESEARCH-voxel-mods-and-vr.md 2.4, "in 1ST/3RD draait hij naar het
//   oog en toont het frame dat bij die kant hoort (achter iemand lopen laat
//   zijn rug zien)" -- and this file is that missing half.
//
// One quantity fixes both: the angle between the wearer and the map's north,
// snapped to a quarter turn. Everything here is pure -- numbers and strings in,
// numbers and strings out, no scene, no camera -- so the whole mapping is a
// table in a test rather than something you discover by walking round a table.

/**
 * The four directions in clockwise order, seen from above.
 *
 * The order IS the arithmetic: one quarter turn clockwise is +1 here, which is
 * why this list is the only place the four are written down in an order.
 */
export const CLOCKWISE: string[] = ["up", "right", "down", "left"];

/**
 * How far past a quadrant boundary the wearer must be before the mapping moves.
 *
 * The naive version snaps at 45 degrees and is unusable: standing anywhere near
 * a corner of the table, the smallest sway flips "up" between two map axes, and
 * a flip mid-step sends the character somewhere the wearer did not ask for.
 * That is a worse bug than the one being fixed, so the boundary is deliberately
 * not where the geometry puts it.
 *
 * Switching at 60 means coming back at 30, because the new quadrant's centre is
 * 90 away. Thirty degrees of dead zone either side of every boundary.
 */
export const SWITCH_DEGREES: number = 60;

/** Wraps to 0..360. */
function wrap360(degrees: number): number {
  let out = degrees % 360;
  if (out < 0) {
    out = out + 360;
  }
  return out;
}

/** The shortest signed way round from `from` to `to`, in -180..180. */
export function signedDelta(from: number, to: number): number {
  let out = wrap360(to - from);
  if (out > 180) {
    out = out - 360;
  }
  return out;
}

/**
 * The bearing of the wearer's view, in the diorama's OWN space, in degrees.
 *
 * `local` is the direction from the wearer TOWARD the diorama, already turned
 * into the diorama's local frame, as [x, z]. The map's north is local -Z and
 * the map's east is local +X -- see updatePlayerTransform, which places a cell
 * at `z = -height/2 + cellY * 2 + 1`, so a bigger cellY is a bigger local z,
 * and north is the way cellY gets smaller.
 *
 * So 0 is a wearer standing due south looking north up the map, 90 is one
 * standing on the west side looking east, and so on clockwise.
 */
export function bearingOf(local: number[]): number {
  return wrap360(Math.atan2(local[0], -local[1]) * 180 / Math.PI);
}

/** Whether a flattened direction is long enough to have a bearing at all. */
export function usable(local: number[]): boolean {
  const length = Math.sqrt(local[0] * local[0] + local[1] * local[1]);
  return length > 1e-3;
}

/**
 * The quarter turn a bearing asks for, given the one in force.
 *
 * Hysteresis lives here rather than at the call site because it is the whole
 * difference between a mapping and a coin toss. See SWITCH_DEGREES.
 */
export function turnFor(bearingDegrees: number, current: number): number {
  const off = signedDelta(current * 90, bearingDegrees);
  if (Math.abs(off) <= SWITCH_DEGREES) {
    return current;
  }
  return ((Math.round(bearingDegrees / 90) % 4) + 4) % 4;
}

/**
 * A pressed direction, turned into the map direction the wearer means by it.
 *
 * Applied to the WINNER of the press, never to the raw buttons. The cartridge
 * resolves two opposing presses in a fixed order -- down, up, left, right --
 * and that order is about the joypad register, not about the world; rotating
 * first would quietly change which physical press wins depending on where the
 * wearer is standing.
 */
export function turnPress(direction: string, turns: number): string {
  const at = CLOCKWISE.indexOf(direction);
  if (at < 0) {
    return direction;
  }
  return CLOCKWISE[(at + turns) % 4];
}

/**
 * A map facing, turned into the direction the WEARER sees that character move.
 *
 * The inverse of turnPress, and it is what picks the sprite frame: a character
 * whose map facing is the way the wearer is looking is walking away from them
 * and should show its back, wherever north happens to be. With no turn in
 * force this is the identity, so a wearer standing due south sees exactly what
 * the cartridge drew.
 */
export function seenFacing(facing: string, turns: number): string {
  const at = CLOCKWISE.indexOf(facing);
  if (at < 0) {
    return facing;
  }
  return CLOCKWISE[(at - turns + 8) % 4];
}

/**
 * The latched quarter turn, and the rules about when it may move.
 *
 * A latch rather than a live reading, for one reason worth stating plainly: a
 * mapping that changes under a held button is indistinguishable from a bug.
 * So it moves only when nothing is pressed and nothing is walking -- which is
 * every moment a wearer is actually walking round a table, and no moment they
 * are steering.
 */
export class ViewCompass {
  private turns: number = 0;
  private following: boolean = true;

  /** The quarter turn in force. 0 is the cartridge's own north-is-up. */
  quarterTurns(): number {
    return this.turns;
  }

  /**
   * Whether the compass tracks the wearer at all.
   *
   * Off puts the lens back on north-is-up exactly, which is what GAME BOY mode
   * needs -- there is no table to walk round, the screen follows the head --
   * and what the CONTROLS row's other rung offers.
   */
  setFollowing(on: boolean): void {
    this.following = on === true;
    if (!this.following) {
      this.turns = 0;
    }
  }

  isFollowing(): boolean {
    return this.following;
  }

  /**
   * One frame. Returns the quarter turn to use, which may be the old one.
   *
   * `local` is the flattened wearer-to-diorama direction in the diorama's own
   * space; a degenerate one -- the wearer standing directly over the model --
   * simply does not move the latch, which is better than guessing.
   */
  update(local: number[], held: boolean, moving: boolean): number {
    if (!this.following) {
      this.turns = 0;
      return this.turns;
    }
    if (held || moving || !usable(local)) {
      return this.turns;
    }
    this.turns = turnFor(bearingOf(local), this.turns);
    return this.turns;
  }
}
