// Where the world may be picked up, and what a two-handed twist asks for:
// the geometry of the handle and of the turn, on their own.
//
// Split from DioramaRim, which drew the handle, because that file imported the
// UI Kit and this has to be testable without a Lens Studio package on the
// path. It is also the honest split: the rule about what counts as taking hold
// is a decision, and the rectangle that showed it was decoration -- decoration
// that arrived on the glasses as a black lid over the world and was deleted on
// 9 September. The rules outlived it.

/**
 * How wide the one-hand grab band is, as a fraction of the plate's half-width.
 *
 * WIDE, deliberately. This was 0.18 -- about six centimetres on a 70 cm plate
 * -- and nothing is drawn for the hand to aim at, so the handle was a band you
 * could neither see nor find by feel: "ik kan de wereld helemaal niet
 * verplaatsen". Nothing MAY be drawn either (see above), so the only honest
 * way to make it findable is to make it big: 0.35 is a band a hand's width
 * deep, from about two thirds of the way out to a third past the edge.
 *
 * What it still refuses is the fault the 8 September playtest reported --
 * "soms beweeg ik mijn handen en dan beweegt het spel per ongeluk mee" -- by
 * leaving the middle two thirds of the world alone. A pinch there is the A
 * button, which is most of what a hand does over this game.
 */
export const RIM_BAND: number = 0.35;

/**
 * Hands closer together than this have no bearing worth reading, in cm.
 *
 * Two points at the same place name no direction; two points a millimetre
 * apart name one made entirely of tracking noise. Either would spin the world.
 */
export const MIN_TWIST_SPAN_CM: number = 3;

/**
 * Whether a point in the plate's own axes is close enough to the rim to count
 * as ONE hand taking hold.
 *
 * A SQUARE band, not a circle. The rim is a square, and a circular test would
 * refuse its corners while accepting the middle of each edge a long way out.
 */
export function onRim(localX: number, localZ: number, halfCm: number): boolean {
  if (!(halfCm > 0)) {
    return false;
  }
  const band = halfCm * RIM_BAND;
  const reach = Math.max(Math.abs(localX), Math.abs(localZ));
  return reach >= halfCm - band && reach <= halfCm + band;
}

/**
 * Whether a point in the plate's own axes is over the world AT ALL, which is
 * what TWO hands need.
 *
 * The looser of the two rules, and deliberately so. One hand near the world is
 * what a wearer's hands do all day, so one hand has to find the handle; two
 * hands pinching at once is not something anybody does by accident, so two
 * hands work over the whole plate. Requiring the rim for a two-handed span
 * meant holding a distance AND a band at the same time, which made resizing a
 * stunt rather than a gesture.
 *
 * The plate ends where the rim band ends, so everything onRim accepts this
 * accepts too.
 */
export function overPlate(localX: number, localZ: number, halfCm: number): boolean {
  if (!(halfCm > 0)) {
    return false;
  }
  const band = halfCm * RIM_BAND;
  return Math.max(Math.abs(localX), Math.abs(localZ)) <= halfCm + band;
}

/**
 * An angle folded into (-PI, PI].
 *
 * Not decoration: bearings live on a circle and the line between two hands
 * crosses the back of it constantly -- 180 degrees is exactly where that line
 * points when the wearer's arms are level in front of them. Subtracting raw
 * bearings there turns a twenty-degree wrist movement into a demand for a
 * three-hundred-and-forty-degree spin.
 *
 * NaN survives unchanged, so a bearing that could not be taken stays visibly
 * absent rather than becoming a plausible zero.
 */
export function wrapRadians(radians: number): number {
  const turn = Math.PI * 2;
  let out = radians % turn;
  if (out > Math.PI) {
    out -= turn;
  }
  if (out <= -Math.PI) {
    out += turn;
  }
  return out;
}

/**
 * The bearing of the line from one hand to the other, in radians about the
 * world up axis; NaN when the hands are too close together to have one.
 *
 * Measured the way the diorama's own yaw is measured -- zero along +Z, growing
 * towards +X -- because that is what a rotation about +Y does to a vector, and
 * the whole point is that the number this returns can be ADDED to the diorama's
 * heading. Get the convention wrong here and the world turns the wrong way.
 *
 * NaN rather than zero for the degenerate case: zero is a real bearing, and
 * returning it would snap the world round the instant two hands touched.
 */
export function twistBearing(fromX: number, fromZ: number,
                             toX: number, toZ: number): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  if (Math.sqrt(dx * dx + dz * dz) < MIN_TWIST_SPAN_CM) {
    return NaN;
  }
  return Math.atan2(dx, dz);
}

/**
 * How far a two-handed twist turns the world: the change in the bearing of the
 * line between the hands, in radians about the world up axis.
 *
 * Turn the pair, and the world turns with them by the same angle. That is the
 * whole gesture, and it is why it needs no teaching: the hands ARE the
 * heading, the same way the distance between them is already the size.
 *
 * Zero when either pair has no bearing to speak of.
 */
export function twistYaw(fromAx: number, fromAz: number,
                         fromBx: number, fromBz: number,
                         toAx: number, toAz: number,
                         toBx: number, toBz: number): number {
  const before = twistBearing(fromAx, fromAz, fromBx, fromBz);
  const after = twistBearing(toAx, toAz, toBx, toBz);
  // NaN is the only value that is not equal to itself; there is no isNaN in
  // reach here that survives the 5.15 gate's lib settings.
  if (before !== before || after !== after) {
    return 0;
  }
  return wrapRadians(after - before);
}
