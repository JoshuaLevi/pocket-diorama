// Where the graphics page hangs: beside the world, never over its middle.
//
// Every screen this lens draws is painted on the Game Boy surface, and that
// surface hangs on the LINE OF SIGHT -- 58 cm out, 22.6 degrees wide, opaque
// white paper. For a dialogue box or a dex entry that is right: you are
// reading, and there is nothing behind it you need. For the OPTION page's
// graphics rows it is exactly wrong, because the thing those rows change is
// the thing the page is standing in front of. "Het menu zit heel erg in je
// face als je met de graphics settings bezig bent."
//
// So the graphics rows get a surface of their own, beside the diorama, and
// this file decides where that is. Pure -- points and angles in, a point and
// a facing out -- because the cases that matter cannot be seen in the one
// screenshot anybody takes: the world behind the wearer, no world placed yet,
// a world he is standing inside.
//
// The rule, in four parts:
//
//   - it sits at the world's OWN pitch, not at eye height. This game is played
//     looking down at a table, and a point at eye level is high in that view;
//   - it goes to the side of the world the wearer's gaze is ALREADY on, so it
//     appears in the half of the view the world is not filling;
//   - it stands far enough out to clear the plate, AND NO FURTHER OUT than one
//     display half-field. Clearing a 70 cm plate at arm's length outright
//     costs 33 degrees, which puts the page outside the display: it would be
//     out of the way and out of sight, and reading it would mean losing the
//     world. Capped, the page clears the world's MIDDLE -- where the player
//     stands -- and overlaps its rim, which is what the glass backing is for;
//   - and it obeys PanelAnchor for everything after that: placed once, held,
//     square to the eye. A panel that rides every small head movement cannot
//     be read, and that is as true beside the world as in front of it.

import { flatHeading, faceEyeAngles } from "./PanelAnchor";

/** Which side of the world the page took. */
export const SIDE_NONE: number = 0;
export const SIDE_LEFT: number = -1;
export const SIDE_RIGHT: number = 1;

/**
 * How far out the page hangs and how wide it is.
 *
 * Narrower and nearer than the Game Boy screen's 26 cm at 58 cm, because it
 * is off to one side and every degree it spends on width is a degree the
 * world does not get. 22 cm at 55 cm still leaves one glyph 1.15 degrees
 * across -- test/messagepanel.test.mjs holds the floor for that at 1.0, and
 * this page has to answer to the same number.
 */
export const SIDE_REACH_CM: number = 55;
export const SIDE_WIDTH_CM: number = 22;
/** The Game Boy screen's tile columns; the page is painted on one of those. */
export const SIDE_COLUMNS: number = 20;

/** Clear air between the plate's edge and the page's, in degrees. */
export const SIDE_GAP_DEGREES: number = 3;

/**
 * The furthest the page is allowed from the world's own bearing.
 *
 * This is the display's own comfortable half-field, which MessagePanelView
 * states as DISPLAY_HALF_FOV_DEGREES = 15 and whose loss is what made the
 * message box unreadable for a whole playtest. It is repeated rather than
 * imported so a placement rule does not have to pull in a scene view;
 * test/sidepanel.test.mjs holds the two together.
 *
 * For every plate the lens actually draws this cap is what decides the
 * placement -- a 70 cm plate at 105 cm would want 33 degrees. The clearance
 * term below is still the rule and not decoration: it is what makes a small
 * world (an interior, at the same centimetres per tile as outdoors) tuck the
 * page in closer instead of throwing it out to a constant.
 */
export const SIDE_MAX_OFFSET_DEGREES: number = 15;

/**
 * Past this angle from the wearer's heading, the world is not in front of him
 * and there is no "beside" worth having. He turned his chair, or walked off.
 * The page then comes back to the line of sight, where every other screen is.
 */
export const SIDE_BEHIND_DEGREES: number = 75;

/**
 * Nearer than this, horizontally, the wearer is standing IN the world rather
 * than at it -- SELECT's life-size staging -- and every direction is world.
 * The line of sight again.
 */
export const SIDE_NEAR_CM: number = 25;

export interface SidePanelSpot {
  /** False means "there is nothing to sit beside"; hang it on the line of sight. */
  beside: boolean;
  /** Where it goes, [x, y, z] in world units. Empty when not beside. */
  at: number[];
  /** [yaw, pitch] in radians that squares it to the eye. Empty when not beside. */
  face: number[];
  /** SIDE_LEFT, SIDE_RIGHT, or SIDE_NONE. */
  side: number;
  /** How far off the world's own bearing it took, in degrees. */
  offsetDegrees: number;
}

const TO_DEGREES: number = 180 / Math.PI;

/** Half the page's own width, in degrees, at a given reach. */
export function sidePanelHalfDegrees(panelHalfCm: number, reachCm: number): number {
  return Math.atan2(panelHalfCm, reachCm) * TO_DEGREES;
}

/** How big one 8x8 glyph is on that page, in degrees. Under a degree cannot be read. */
export function sideGlyphDegrees(widthCm: number, reachCm: number): number {
  return Math.atan2(widthCm / SIDE_COLUMNS, reachCm) * TO_DEGREES;
}

function nowhere(): SidePanelSpot {
  return { beside: false, at: [], face: [], side: SIDE_NONE, offsetDegrees: 0 };
}

/**
 * Where the graphics page goes, given the wearer and the world.
 *
 * `anchor` is the diorama's own anchor -- the point the player stands on --
 * and is null before the world has been put down. `plateHalfCm` is half the
 * drawn world's width; it is what the page tries to clear.
 */
export function sidePanelSpot(
  eye: number[], look: number[], up: number[], anchor: number[],
  plateHalfCm: number, panelHalfCm: number, reachCm: number
): SidePanelSpot {
  if (!anchor || anchor.length < 3) {
    return nowhere();
  }
  const dx = anchor[0] - eye[0];
  const dy = anchor[1] - eye[1];
  const dz = anchor[2] - eye[2];
  const horizontal = Math.sqrt(dx * dx + dz * dz);
  if (!(horizontal >= SIDE_NEAR_CM)) {
    return nowhere();
  }
  // The world's own flat direction from the eye, and its right hand.
  const ux = dx / horizontal;
  const uz = dz / horizontal;
  const rx = -uz;
  const rz = ux;

  // Where the world sits in the wearer's view: positive is to his right.
  const heading = flatHeading(look, up);
  const forward = ux * heading[0] + uz * heading[1];
  const rightward = ux * -heading[1] + uz * heading[0];
  const turn = Math.atan2(rightward, forward) * TO_DEGREES;
  if (Math.abs(turn) > SIDE_BEHIND_DEGREES) {
    return nowhere();
  }
  // The page takes the OTHER side from the world: if the world sits to his
  // right, the left of his view is the empty half, and that is where a page
  // can be read without the world being pushed out of the display. Dead
  // centre is a tie, and the right hand wins it.
  const side = turn > 0 ? SIDE_LEFT : SIDE_RIGHT;

  const panelHalf = sidePanelHalfDegrees(panelHalfCm, reachCm);
  const plateHalf = Math.atan2(plateHalfCm > 0 ? plateHalfCm : 0, horizontal) * TO_DEGREES;
  let offset = plateHalf + panelHalf + SIDE_GAP_DEGREES;
  if (offset > SIDE_MAX_OFFSET_DEGREES) {
    offset = SIDE_MAX_OFFSET_DEGREES;
  }
  // Never nearer than its own half-width and the gap, whatever the cap says:
  // inside that the page is back over the middle of the view.
  const nearest = panelHalf + SIDE_GAP_DEGREES;
  if (offset < nearest) {
    offset = nearest;
  }

  // Turn the world's own direction by that much, towards the chosen side.
  const swing = side * offset / TO_DEGREES;
  const dirX = ux * Math.cos(swing) + rx * Math.sin(swing);
  const dirZ = uz * Math.cos(swing) + rz * Math.sin(swing);
  // At the world's own pitch: beside it in the VIEW, which is what "beside"
  // means to someone looking down at a table.
  const pitch = Math.atan2(dy, horizontal);
  const flatReach = Math.cos(pitch) * reachCm;
  const at = [
    eye[0] + dirX * flatReach,
    eye[1] + Math.sin(pitch) * reachCm,
    eye[2] + dirZ * flatReach,
  ];
  return {
    beside: true,
    at: at,
    face: faceEyeAngles(at, eye),
    side: side,
    offsetDegrees: offset,
  };
}
