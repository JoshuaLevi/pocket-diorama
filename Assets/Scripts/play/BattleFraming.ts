// Where the diorama has to stand for a fight to be worth watching.
//
// The problem is the wearer: they are the camera and we cannot move them. The
// reference mod solves its framing by moving ITS camera -- an over-the-shoulder
// rig dropped near the ground, with "the lens opening exactly as much as the
// two Pokemon are apart". We have to do the inverse and move the WORLD, so the
// arena arrives in front of the eye at the size and angle that rig would have
// produced.
//
// Measured against what was wrong. In the 8 September preview the two Pokemon
// stood 112 cm from the eye at 6.7 cm tall: three and a half degrees, which is
// a 2 cm object held at arm's length. That is why they read as specks on a
// table rather than as a fight.
//
// Three constants decide the shot, and they are named after what a viewer
// sees rather than after the transform they end up in:
//
//   VIEW_DISTANCE_CM   how far away the middle of the pair sits
//   VIEW_DROP_DEGREES  how far below the line of sight, so you look down at it
//                      rather than at it -- the cartridge's own slight overhead
//   AXIS_DEGREES       how far the line between the two is turned away from
//                      straight-ahead. This is the whole shot: at 0 the two
//                      are one behind the other (over-the-shoulder, and the
//                      far one is tiny); at 90 they are flat side-on like a
//                      fighting game. Between them is the cartridge's own
//                      three-quarter view -- yours near and to the left, theirs
//                      beyond and to the right -- which is what Joshua chose on
//                      8 September.
//
// Pure: numbers in, a transform out. No scene, no lens types, so a test can
// state "the pair ends up this far apart in the view" without a headset.

/** How far from the eye the middle of the pair sits. */
export const VIEW_DISTANCE_CM: number = 65;
/** How far below the line of sight, in degrees. */
export const VIEW_DROP_DEGREES: number = 28;
/** How far the pair's own axis is turned from straight ahead, in degrees. */
export const AXIS_DEGREES: number = 40;
/**
 * How far apart the two look, in centimetres across the view.
 *
 * This is the reference's "the lens opens exactly as much as the two Pokemon
 * are apart", written the only way we can write it: the wearer's lens does not
 * open, so the world is scaled until the gap comes out at this width.
 *
 * Sixteen, not twenty-two. Twenty-two was the first try and it put a Pokemon at
 * eleven degrees -- which is a good size for a Pokemon and a terrible one for
 * everything else, because the town is on the same scale. Joshua's word for the
 * result on 8 September was that the world "wordt te groot": houses half a
 * metre across, standing where the room is. Sixteen halves the world again and
 * still leaves a Pokemon at twice the angle it had on the table.
 *
 * The honest fix for a fight crowded by scenery is not this number at all -- it
 * is the reference's third staging, two discs hung against the sky, which is
 * what it uses for exactly the caves and shop floors that have nowhere to put a
 * fight. That is still to build.
 */
export const VIEW_GAP_CM: number = 16;

/**
 * How close the fight may be brought, in centimetres, when the wearer has put
 * the world somewhere unusable.
 *
 * Only a guard. A fight is staged where the diorama already stands, so the
 * distance is the wearer's own choice and this never bites in practice -- it
 * exists so a world dropped at the wearer's nose, or behind them, cannot put a
 * fight inside their head.
 */
export const MIN_REACH_CM: number = 25;

/** The diorama's transform for a fight: where it stands, its yaw, its scale. */
export interface Framing {
  /** World position of the diorama root, [x, y, z]. */
  position: number[];
  /** World yaw of the diorama root, in radians. */
  yaw: number;
  /** Uniform scale of the diorama root. */
  scale: number;
}

/** A cell's position in the diorama's own local space, on the XZ plane. */
export function cellLocal(cell: number[], widthTiles: number, heightTiles: number): number[] {
  return [-widthTiles / 2 + cell[0] * 2 + 1, -heightTiles / 2 + cell[1] * 2 + 1];
}

/** Flattens a direction onto the ground plane and normalises it. */
function flatten(direction: number[]): number[] {
  const length = Math.sqrt(direction[0] * direction[0] + direction[2] * direction[2]);
  if (length < 1e-6) {
    // Looking straight up or down: any horizontal heading is as good as
    // another, and -Z is the one a Lens Studio camera starts out facing.
    return [0, 0, -1];
  }
  return [direction[0] / length, 0, direction[2] / length];
}

/** Turns a flat direction about the world's up axis. */
function turn(flat: number[], radians: number): number[] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [flat[0] * c + flat[2] * s, 0, -flat[0] * s + flat[2] * c];
}

/**
 * The framing for one fight.
 *
 * `groundLocalY` is the terrain's own height at the middle of the pair, in the
 * diorama's local units, so the shot is aimed at the ground they stand on
 * rather than at the mesh's origin -- a fight on a first floor is metres above
 * it.
 *
 * `rest` is where the diorama is ALREADY standing, as [x, y, z] in world
 * space. Pass it and THE FIGHT HAPPENS THERE: the wearer put the world on
 * their table, or held it at their nose, and that placement is an instruction.
 * The world is only turned, so the pair stands broadside, and scaled, so the
 * pair subtends what the shot was designed to subtend from wherever they chose
 * to watch it.
 *
 * Pass null and the fight is flown to a fixed spot in front of the wearer,
 * which is what this did until 9 September. Two playtests reported the same
 * thing from opposite directions: the fight hung above the table (the drop is
 * 30 cm below the eye and a table is 45 to 90 below it), and then, once that
 * was fixed by dropping it to the table, it arrived uncomfortably close --
 * because a shot that insists on 65 cm has to come to 65 cm however far away
 * the wearer put the world. Both are the same mistake: overriding a placement
 * the wearer made on purpose.
 */
export function frameBattle(
  playerCell: number[], enemyCell: number[],
  widthTiles: number, heightTiles: number, groundLocalY: number,
  eye: number[], forward: number[], rest: number[] = null
): Framing {
  const mine = cellLocal(playerCell, widthTiles, heightTiles);
  const theirs = cellLocal(enemyCell, widthTiles, heightTiles);
  const middleLocal = [(mine[0] + theirs[0]) / 2, groundLocalY, (mine[1] + theirs[1]) / 2];

  // The axis between the pair, in the diorama's own space.
  const axisX = theirs[0] - mine[0];
  const axisZ = theirs[1] - mine[1];
  const axisLength = Math.sqrt(axisX * axisX + axisZ * axisZ);

  // Scale: the gap has to COME OUT at VIEW_GAP_CM across the view. Turned away
  // by AXIS_DEGREES it is foreshortened, so the scale has to make up for that
  // -- otherwise a three-quarter shot puts the two closer together than a
  // side-on one at the same scale, which is the wrong way round.
  const across = Math.sin(AXIS_DEGREES * Math.PI / 180);
  const scale = axisLength > 1e-6 && across > 1e-6
    ? VIEW_GAP_CM / (axisLength * across)
    : 1;

  // Yaw: turn the diorama until the pair's own axis points where the shot wants
  // it -- away from the wearer and to the right.
  const ahead = flatten(forward);
  const wantAxis = turn(ahead, -AXIS_DEGREES * Math.PI / 180);
  const wantYaw = Math.atan2(wantAxis[0], wantAxis[2]);
  const haveYaw = Math.atan2(axisX, axisZ);
  const yaw = wantYaw - haveYaw;

  // Where the middle of the pair has to land.
  const drop = VIEW_DROP_DEGREES * Math.PI / 180;
  let middleWorld: number[];
  if (rest === null) {
    // No placement known: the old shot, straight ahead and pitched down.
    const reach = VIEW_DISTANCE_CM * Math.cos(drop);
    middleWorld = [
      eye[0] + ahead[0] * reach,
      eye[1] - VIEW_DISTANCE_CM * Math.sin(drop),
      eye[2] + ahead[2] * reach,
    ];
  } else {
    middleWorld = [rest[0], rest[1], rest[2]];
  }

  // How far the wearer will be watching from, which is the only thing the
  // scale has to answer to: a fight twice as far away has to be twice as big
  // to look the same. VIEW_GAP_CM is a width across the view at
  // VIEW_DISTANCE_CM, so the ratio is the whole correction.
  let away = Math.sqrt(
    (middleWorld[0] - eye[0]) * (middleWorld[0] - eye[0]) +
    (middleWorld[1] - eye[1]) * (middleWorld[1] - eye[1]) +
    (middleWorld[2] - eye[2]) * (middleWorld[2] - eye[2]));
  if (!(away > MIN_REACH_CM)) {
    // A world dropped at the wearer's nose. Push the shot out to arm's length
    // along their own line of sight rather than staging a fight inside their
    // head; the guard is the only place a placement is overruled.
    const reach = MIN_REACH_CM * Math.cos(drop);
    middleWorld = [
      eye[0] + ahead[0] * reach,
      eye[1] - MIN_REACH_CM * Math.sin(drop),
      eye[2] + ahead[2] * reach,
    ];
    away = MIN_REACH_CM;
  }
  const finalScale = scale * (away / VIEW_DISTANCE_CM);

  // And the root position that puts it there: root = target - R(yaw) * (local * scale).
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const lx = middleLocal[0] * finalScale;
  const ly = middleLocal[1] * finalScale;
  const lz = middleLocal[2] * finalScale;
  const rotatedX = lx * c + lz * s;
  const rotatedZ = -lx * s + lz * c;

  return {
    position: [middleWorld[0] - rotatedX, middleWorld[1] - ly, middleWorld[2] - rotatedZ],
    yaw: yaw,
    scale: finalScale,
  };
}
