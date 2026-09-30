// Where a panel hangs in front of the wearer, for the two surfaces that follow
// the head.
//
// This was the message box's own placement, and the Game Boy screen had a
// different one: pinned 22 cm over the DIORAMA's anchor, facing the eye. That
// works while the world is still where it was put, and stops working the moment
// the wearer zooms, drags or walks -- which is how a dex entry ended up
// "positioned randomly" and the naming grid ended up beside the room rather
// than in front of it. Both surfaces now hang by the same rule.
//
// The rule, in three parts:
//
//   - it hangs on the LINE OF SIGHT, pitched down by its own angle, not at eye
//     height. A point at eye height is high in the view of anyone looking down
//     at a table, which is most of this game;
//   - it is PLACED ONCE and then held, and only fetched back when the wearer
//     has looked well away from it. The reference went head-tracked, then
//     pinned in 2.1.2, because a panel that rides every small movement cannot
//     be read; pinning alone leaves the text behind you when you turn;
//   - it is square to the eye throughout: yaw about the world's up, then pitch
//     about the panel's own right.

/**
 * Which way the wearer is facing, flattened onto the ground, as [x, z].
 *
 * Its own function because a second surface -- the graphics page, which hangs
 * beside the diorama rather than in front of the eye -- has to agree with this
 * one about which way "in front" is. Two files answering that separately is
 * how the diorama's heading and the diorama's tilt came to disagree.
 *
 * Looking straight up or down leaves nothing to flatten, and the answer is
 * then the wearer's own up vector, which has fallen over in the direction he
 * is pitched. Pitched DOWN at a table it has fallen FORWARD, pitched up it has
 * fallen backward -- so the sign follows the pitch. Taking the negative in
 * both cases, as this did until 9 September, points a panel at the back of the
 * room for anyone looking at their own feet, which is most of this game.
 */
export function flatHeading(look: number[], up: number[]): number[] {
  const flat = Math.sqrt(look[0] * look[0] + look[2] * look[2]);
  if (flat > 0.0001) {
    return [look[0] / flat, look[2] / flat];
  }
  const levelFlat = Math.sqrt(up[0] * up[0] + up[2] * up[2]);
  if (levelFlat <= 0.0001) {
    return [0, -1];
  }
  const sign = look[1] < 0 ? 1 : -1;
  return [sign * up[0] / levelFlat, sign * up[2] / levelFlat];
}

/**
 * The yaw and pitch, in radians, that square a surface at `from` to an eye.
 *
 * A pair rather than a rotation so it can be stated without a scene: the
 * caller builds `angleAxis(yaw, up) * angleAxis(-pitch, right)` from it, which
 * sends the surface's own +Z to the unit vector pointing at the eye. Empty
 * when the two points coincide and there is no direction to face.
 */
export function faceEyeAngles(from: number[], eye: number[]): number[] {
  const dx = eye[0] - from[0];
  const dy = eye[1] - from[1];
  const dz = eye[2] - from[2];
  const horizontal = Math.sqrt(dx * dx + dz * dz);
  if (horizontal < 0.0001 && Math.abs(dy) < 0.0001) {
    return [];
  }
  return [Math.atan2(dx, dz), Math.atan2(dy, horizontal)];
}

/** Where the panel should sit: [x, y, z] in world units. */
export function anchorTarget(
  eye: number[], look: number[], up: number[], aheadCm: number, belowDegrees: number
): number[] {
  const flat = Math.sqrt(look[0] * look[0] + look[2] * look[2]);
  const viewPitch = Math.atan2(look[1], flat);
  const aimed = viewPitch - belowDegrees * Math.PI / 180;
  const heading = flatHeading(look, up);
  const horizontalReach = Math.cos(aimed) * aheadCm;
  return [
    eye[0] + heading[0] * horizontalReach,
    eye[1] + Math.sin(aimed) * aheadCm,
    eye[2] + heading[1] * horizontalReach,
  ];
}

/** The angle between where the wearer is looking and where the panel is. */
export function offViewDegrees(eye: number[], look: number[], at: number[]): number {
  const dx = at[0] - eye[0];
  const dy = at[1] - eye[1];
  const dz = at[2] - eye[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const lookLength = Math.sqrt(look[0] * look[0] + look[1] * look[1] + look[2] * look[2]);
  if (length < 0.0001 || lookLength < 0.0001) {
    return 0;
  }
  let cosine = (dx * look[0] + dy * look[1] + dz * look[2]) / (length * lookLength);
  if (cosine > 1) cosine = 1;
  if (cosine < -1) cosine = -1;
  return Math.acos(cosine) * 180 / Math.PI;
}

export class PanelAnchor {
  private aheadCm: number;
  private belowDegrees: number;
  private recentreDegrees: number;
  private settleSeconds: number;
  /** True while the panel is catching up with a head turn. */
  private following: boolean = false;
  /**
   * An offset from some object, in CENTIMETRES along that object's own axes,
   * to hang at instead of on the line of sight -- and the object it is from.
   * Both null when unpinned.
   *
   * This is the reference's own 2.1.2 change -- "NPC dialogue boxes are pinned
   * and no longer head tracked" -- and the reason it is relative rather than a
   * world point: pinned to the DIORAMA, the box comes along when the wearer
   * drags the model mid-fight, which they can, instead of being left behind in
   * the room.
   *
   * CENTIMETRES, and not the diorama's own units, is the whole correction of
   * 9 September. A point in local space rides the model's SCALE, and the
   * diorama's scale is not a constant: framing a fight changes it, and SELECT
   * changes it by eighteen times on the way to life-size. The box was pinned
   * fifteen local units from the root -- half a metre at the table's scale --
   * and any rescale multiplied that offset, throwing the box, and the move menu
   * riding above it, metres away. That is the fight whose menu was "verderop"
   * and the encounter whose menu was "nergens te bekennen".
   *
   * So the pin follows the model's POSITION and its ROTATION, and ignores its
   * scale. Drag the diorama and the box comes; turn it and the box turns with
   * it; grow it and the box stays the same distance from where it was hung.
   *
   * It still turns to face the eye. A pinned panel is a thing standing in the
   * world, not a poster on a wall: you can walk round the table and read it
   * from the far side.
   */
  private pinLocal: vec3 = null;
  private pinSpace: SceneObject = null;

  constructor(aheadCm: number, belowDegrees: number, recentreDegrees: number,
              settleSeconds: number) {
    this.aheadCm = aheadCm;
    this.belowDegrees = belowDegrees;
    this.recentreDegrees = recentreDegrees;
    this.settleSeconds = settleSeconds;
  }

  /** How far below the line of sight this anchor hangs its panel. */
  drop(): number {
    return this.belowDegrees;
  }

  /**
   * Changes that angle. A panel that grows has to rise as it does, or the rows
   * it gained fall out of the bottom of the display.
   */
  setDrop(belowDegrees: number): void {
    this.belowDegrees = belowDegrees;
  }

  /** How far ahead of the eye this anchor hangs its panel. */
  ahead(): number {
    return this.aheadCm;
  }

  /** Changes that distance: a housing that is smaller than the bare quad hangs closer. */
  setAhead(aheadCm: number): void {
    if (aheadCm > 0) {
      this.aheadCm = aheadCm;
    }
  }

  /**
   * Where the line of sight would hang a panel right now, in world units.
   *
   * Public because pinning is done by taking this point once and holding it:
   * the box lands exactly where it always lands -- readable, below the axis --
   * and then stops moving, rather than being placed by a second set of
   * numbers that would have to agree with these.
   */
  lineOfSight(camera: Camera): vec3 {
    const eyeTransform = camera.getSceneObject().getTransform();
    const eyeVec = eyeTransform.getWorldPosition();
    const rotation = eyeTransform.getWorldRotation();
    const lookVec = rotation.multiplyVec3(new vec3(0, 0, -1));
    const upVec = rotation.multiplyVec3(new vec3(0, 1, 0));
    const target = anchorTarget([eyeVec.x, eyeVec.y, eyeVec.z],
                                [lookVec.x, lookVec.y, lookVec.z],
                                [upVec.x, upVec.y, upVec.z],
                                this.aheadCm, this.belowDegrees);
    return new vec3(target[0], target[1], target[2]);
  }

  /**
   * Hangs `offset` centimetres from `space`, along `space`'s own axes.
   *
   * Use offsetFrom() to work the offset out from a world point; the two belong
   * together and separating them is how a scale creeps back in.
   */
  pinTo(space: SceneObject, offset: vec3): void {
    this.pinSpace = space;
    this.pinLocal = offset;
  }

  /**
   * The offset pinTo() wants, for a world point to be held relative to `space`.
   *
   * Rotation only: the world point's distance from the object is kept in
   * centimetres rather than in the object's units, so a later rescale moves
   * nothing. See pinLocal.
   */
  static offsetFrom(space: SceneObject, world: vec3): vec3 {
    const transform = space.getTransform();
    const origin = transform.getWorldPosition();
    const away = new vec3(world.x - origin.x, world.y - origin.y, world.z - origin.z);
    return transform.getWorldRotation().invert().multiplyVec3(away);
  }

  /** Back to the line of sight. The panel eases there rather than jumping. */
  unpin(): void {
    if (this.pinLocal !== null) {
      this.following = true;
    }
    this.pinSpace = null;
    this.pinLocal = null;
  }

  pinned(): boolean {
    return this.pinLocal !== null;
  }

  place(object: SceneObject, camera: Camera, dt: number): void {
    if (!camera || !object) {
      return;
    }
    const eyeTransform = camera.getSceneObject().getTransform();
    const eyeVec = eyeTransform.getWorldPosition();
    const rotation = eyeTransform.getWorldRotation();
    // The camera looks along its own local -Z.
    const lookVec = rotation.multiplyVec3(new vec3(0, 0, -1));
    const upVec = rotation.multiplyVec3(new vec3(0, 1, 0));
    const eye = [eyeVec.x, eyeVec.y, eyeVec.z];
    const look = [lookVec.x, lookVec.y, lookVec.z];
    let target: number[];
    if (this.pinLocal !== null && this.pinSpace) {
      // Position and rotation, never getWorldTransform(): that matrix carries
      // the scale, and the scale is what threw the box across the room.
      const pinTransform = this.pinSpace.getTransform();
      const origin = pinTransform.getWorldPosition();
      const away = pinTransform.getWorldRotation().multiplyVec3(this.pinLocal);
      target = [origin.x + away.x, origin.y + away.y, origin.z + away.z];
    } else {
      target = anchorTarget(eye, look, [upVec.x, upVec.y, upVec.z],
                            this.aheadCm, this.belowDegrees);
    }

    const transform = object.getTransform();
    const at = transform.getWorldPosition();
    if (this.pinLocal !== null) {
      // Pinned: ease to the point and stay there. Never chase the head, and
      // never let the off-view test below fetch it back -- that test is the
      // whole thing pinning exists to switch off.
      const step = dt > 0 ? Math.min(1, dt / this.settleSeconds) : 1;
      transform.setWorldPosition(new vec3(
        at.x + (target[0] - at.x) * step,
        at.y + (target[1] - at.y) * step,
        at.z + (target[2] - at.z) * step
      ));
    } else if (this.following) {
      const step = dt > 0 ? Math.min(1, dt / this.settleSeconds) : 1;
      const moved = new vec3(
        at.x + (target[0] - at.x) * step,
        at.y + (target[1] - at.y) * step,
        at.z + (target[2] - at.z) * step
      );
      transform.setWorldPosition(moved);
      if (moved.distance(new vec3(target[0], target[1], target[2])) < 0.5) {
        this.following = false;
      }
    } else if (offViewDegrees(eye, look, [at.x, at.y, at.z]) > this.recentreDegrees) {
      this.following = true;
    }

    // Square to the eye: a product rather than Euler angles, whose order would
    // decide whether the pitch lands before or after the yaw.
    const here = transform.getWorldPosition();
    const angles = faceEyeAngles([here.x, here.y, here.z],
                                 [eyeVec.x, eyeVec.y, eyeVec.z]);
    if (angles.length !== 2) {
      return;
    }
    const yawTurn = quat.angleAxis(angles[0], new vec3(0, 1, 0));
    const pitchTurn = quat.angleAxis(-angles[1], new vec3(1, 0, 0));
    transform.setWorldRotation(yawTurn.multiply(pitchTurn));
  }

  /**
   * Puts the panel where it belongs at once, with no settle. Called when a
   * screen opens, which is the moment the wearer is looking at the world
   * rather than at the panel.
   */
  snapTo(object: SceneObject, camera: Camera): void {
    if (!camera || !object) {
      return;
    }
    this.following = true;
    this.place(object, camera, 1);
    this.following = false;
  }
}
