// The encounter moment: the diorama grows until you are standing in it.
//
// This is the beat the reference footage is built around. A wild Pokemon appears
// and the tabletop world swells until the player's tile is under your feet and the
// Pokemon is life-size in the room, then shrinks back when the battle ends.
//
// Two things have to happen at once. The scale has to grow about the player's own
// tile -- scaling about the transform's origin instead slides the world sideways,
// which reads as the room lurching. And that tile has to TRAVEL, from where it sits
// on the tabletop to where the viewer is standing.
//
// Holding the tile at its tabletop position while the world grows around it was the
// first attempt, and it puts the world above and behind you: the tile stays on the
// table while seven times as much world unfolds around it, most of it overhead. The
// tile has to arrive at your feet for the growth to read as happening around you.

// Life-size is not a multiplier, it is a measurement, and treating it as a
// multiplier is how the first two attempts went wrong. At 4x a voxel stood 2.3 cm
// tall -- a hedge the size of a sugar cube -- and at 7x it was still only 4 cm.
// Both looked like "a bigger tabletop map", not like standing in a world.
//
// The scale that matters is the one that makes the CHARACTER human-sized. A Gen 1
// character billboard is CHARACTER_TILES units tall, so the battle scale is
// whatever makes that come out at eye height. Everything else follows: a tile
// becomes about half a metre, a hedge reaches your knee, a house has storeys.
const BATTLE_CHARACTER_HEIGHT_CM: number = 165;

/** Seconds for the grow and the shrink. Slow enough to read, short enough to want. */
const TRANSITION_SECONDS: number = 1.1;

export interface BattleStageCallbacks {
  onEnterComplete: () => void;
  onExitComplete: () => void;
}

/** Where the transition currently is. */
const STATE_IDLE: number = 0;
const STATE_GROWING: number = 1;
const STATE_HELD: number = 2;
const STATE_SHRINKING: number = 3;
/**
 * Moving the world into, or out of, a battle's own framing.
 *
 * Separate from GROWING/SHRINKING, and it ends in IDLE rather than HELD. That
 * is deliberate: Joshua asked on 8 September to keep hold of the diorama during
 * a fight, and everything that lets him -- scaleAbout, moveBy, the two-handed
 * turn -- refuses unless the stage is idle. A framing is a place the world is
 * PUT, not a state it is held in.
 */
const STATE_FRAMING: number = 4;
const STATE_UNFRAMING: number = 5;

export class BattleStage {
  private root: SceneObject;
  private baseScale: number = 1;
  /** Units the character billboard is tall, needed to solve for life-size. */
  private characterUnits: number = 3;
  /** The point that must not move: the player's position in mesh-local units. */
  private pivotLocal: vec3 = null;

  /** Where the pivot starts (on the table) and where it must end up (at the viewer). */
  private anchorFrom: vec3 = null;
  private anchorTo: vec3 = null;

  /** The presentation tilt the world carries outside a fight. See setTilt. */
  private tiltRadians: number = 0;

  private state: number = STATE_IDLE;
  private progress: number = 0;
  private callbacks: BattleStageCallbacks = null;

  /** Where a framing starts from and lands, and what to go back to after. */
  private fromPosition: vec3 = null;
  private fromYaw: number = 0;
  private fromScale: number = 1;
  private toPosition: vec3 = null;
  private toYaw: number = 0;
  private toScale: number = 1;
  /** The placement the wearer had before the fight, restored when it ends. */
  private restPosition: vec3 = null;
  private restYaw: number = 0;
  private restScale: number = 1;
  private framed: boolean = false;

  constructor(root: SceneObject) {
    this.root = root;
  }

  isIdle(): boolean {
    return this.state === STATE_IDLE;
  }

  isBusy(): boolean {
    return this.state === STATE_GROWING || this.state === STATE_SHRINKING;
  }

  /**
   * True when the world has stopped moving: standing on the table, standing in
   * a fight's framing, or held at life-size.
   *
   * isFramed() is NOT this, and the difference cost a playtest. `framed` is
   * set the moment frameTo() is called -- it has to be, because it is what
   * unframe() later undoes -- so it is true throughout the half-second flight,
   * while the diorama is still somewhere between where it was and where it is
   * going. Anything that measures the world (pinning a panel to it, above all)
   * has to wait for this instead.
   */
  /** Standing life-size and holding: the one state exit() has anything to do. */
  isHeld(): boolean {
    return this.state === STATE_HELD;
  }

  isSettled(): boolean {
    return this.state === STATE_IDLE || this.state === STATE_HELD;
  }

  /** How tall the character billboard is, in mesh units. */
  setCharacterUnits(units: number): void {
    this.characterUnits = units > 0 ? units : 1;
  }

  /**
   * The presentation tilt, in radians, so a fight can put it back.
   *
   * Framing wrote `quat.fromEulerAngles(0, yaw, 0)` over the root, which threw
   * the OPTION page's TILT away for the length of a fight and did not restore
   * it on the way out -- the tilt only reappeared at the next map load.
   * Nobody reported it because the tilt was the only thing in that rotation;
   * once placement puts a heading in there too, dropping it turns the world.
   */
  setTilt(radians: number): void {
    this.tiltRadians = radians;
  }

  /**
   * The root's rotation for a yaw: turned about the world's up axis, then
   * tilted about its own right.
   *
   * A product, not Euler angles, whose order would decide which lands first --
   * and the order matters here, because tilting first and then yawing about
   * the world's up gives a model that leans sideways.
   */
  private rotationFor(yaw: number): quat {
    return quat.angleAxis(yaw, new vec3(0, 1, 0))
      .multiply(quat.angleAxis(this.tiltRadians, new vec3(1, 0, 0)));
  }

  /** The scale at which the character stands at human height. */
  private battleScale(): number {
    return BATTLE_CHARACTER_HEIGHT_CM / this.characterUnits;
  }

  /** The scale the diorama sits at when nothing is happening. */
  setBaseScale(scale: number): void {
    this.baseScale = scale;
    if (this.state === STATE_IDLE) {
      this.root.getTransform().setLocalScale(new vec3(scale, scale, scale));
    }
  }

  /**
   * Starts growing the world around `pivotLocal`, a point in the mesh's local
   * space -- normally where the player is standing.
   */
  /**
   * Grows the world about `pivotLocal` -- a point in the mesh's local space,
   * normally the player's tile -- while moving that point to `standingPosition`,
   * which should be at the viewer's feet.
   */
  enter(pivotLocal: vec3, standingPosition: vec3, callbacks: BattleStageCallbacks): void {
    if (this.state !== STATE_IDLE) {
      print("[BattleStage] enter ignored, state=" + this.state);
      return;
    }
    print("[BattleStage] growing from " + this.baseScale.toFixed(3));
    this.callbacks = callbacks;
    this.pivotLocal = pivotLocal;
    const transform = this.root.getTransform();
    this.anchorFrom = this.worldOfPivot(transform.getWorldPosition(), this.baseScale);
    this.anchorTo = standingPosition;
    this.state = STATE_GROWING;
    this.progress = 0;
  }

  /** Whether the world is currently standing in a battle's framing. */
  isFramed(): boolean {
    return this.framed;
  }

  // There was a restingAt() here, returning the root's resting world position,
  // and it was the only thing that ever asked BattleStage where the world is.
  // It could not answer honestly: a stage owns a root, and on a scrolling map
  // the root is not where the world is -- see DioramaAnchor. The one caller
  // wanted the middle of the play area and got the mesh's origin, so on a
  // route it framed the fight metres from the town. The question now goes to
  // PokemonAR.dioramaCentre(), which knows the anchor. restPosition stays,
  // because unframe() writes it straight back onto the root, which is exactly
  // what a root position is good for.

  /**
   * Moves the world into a fight's own framing: position, yaw and scale at once.
   *
   * The placement the wearer had is remembered here and not before, so a fight
   * that starts while they are mid-drag goes back to where they let go rather
   * than to where they picked it up.
   */
  frameTo(position: vec3, yaw: number, scale: number, callbacks: BattleStageCallbacks): void {
    if (this.state !== STATE_IDLE) {
      print("[BattleStage] frameTo ignored, state=" + this.state);
      return;
    }
    const transform = this.root.getTransform();
    if (!this.framed) {
      this.restPosition = transform.getWorldPosition();
      this.restYaw = BattleStage.yawOf(transform);
      this.restScale = transform.getLocalScale().x;
    }
    this.callbacks = callbacks;
    this.fromPosition = transform.getWorldPosition();
    this.fromYaw = BattleStage.yawOf(transform);
    this.fromScale = transform.getLocalScale().x;
    this.toPosition = position;
    // Turn the short way round. Without this a fight that wants 170 degrees
    // one way spins the town 190 the other, which reads as the world lurching.
    this.toYaw = this.fromYaw + BattleStage.shortestTurn(this.fromYaw, yaw);
    this.toScale = scale;
    this.framed = true;
    this.state = STATE_FRAMING;
    this.progress = 0;
    print("[BattleStage] framing: scale " + this.fromScale.toFixed(2) +
          " -> " + scale.toFixed(2));
  }

  /** Puts the world back where the wearer had it before the fight. */
  unframe(): void {
    if (!this.framed) {
      return;
    }
    if (this.state !== STATE_IDLE) {
      print("[BattleStage] unframe ignored, state=" + this.state);
      return;
    }
    const transform = this.root.getTransform();
    this.fromPosition = transform.getWorldPosition();
    this.fromYaw = BattleStage.yawOf(transform);
    this.fromScale = transform.getLocalScale().x;
    this.toPosition = this.restPosition;
    this.toYaw = this.fromYaw + BattleStage.shortestTurn(this.fromYaw, this.restYaw);
    this.toScale = this.restScale;
    this.state = STATE_UNFRAMING;
    this.progress = 0;
  }

  /** The root's yaw about the world's up axis, in radians. */
  private static yawOf(transform: Transform): number {
    const ahead = transform.forward;
    return Math.atan2(ahead.x, ahead.z);
  }

  /** The signed turn from `have` to `want`, never more than half a circle. */
  private static shortestTurn(have: number, want: number): number {
    let delta = (want - have) % (Math.PI * 2);
    if (delta > Math.PI) {
      delta -= Math.PI * 2;
    }
    if (delta < -Math.PI) {
      delta += Math.PI * 2;
    }
    return delta;
  }

  /** Begins the return to tabletop scale. */
  exit(): void {
    if (this.state !== STATE_HELD) {
      print("[BattleStage] exit ignored, state=" + this.state);
      return;
    }
    print("[BattleStage] shrinking");
    this.state = STATE_SHRINKING;
    this.progress = 0;
  }

  private worldOfPivot(origin: vec3, scale: number): vec3 {
    return new vec3(
      origin.x + this.pivotLocal.x * scale,
      origin.y + this.pivotLocal.y * scale,
      origin.z + this.pivotLocal.z * scale
    );
  }

  /** Smoothstep, so the growth eases in and out instead of starting hard. */
  private static ease(t: number): number {
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    return clamped * clamped * (3 - 2 * clamped);
  }

  update(dt: number): void {
    if (this.state === STATE_IDLE || this.state === STATE_HELD) {
      return;
    }

    if (this.state === STATE_FRAMING || this.state === STATE_UNFRAMING) {
      this.updateFraming(dt);
      return;
    }

    this.progress += dt / TRANSITION_SECONDS;
    const done = this.progress >= 1;
    const t = BattleStage.ease(done ? 1 : this.progress);

    const growing = this.state === STATE_GROWING;
    const scaleFrom = growing ? this.baseScale : this.battleScale();
    const scaleTo = growing ? this.battleScale() : this.baseScale;
    const scale = scaleFrom + (scaleTo - scaleFrom) * t;

    // The pivot travels between the tabletop and the viewer's feet as it scales.
    const anchorStart = growing ? this.anchorFrom : this.anchorTo;
    const anchorEnd = growing ? this.anchorTo : this.anchorFrom;
    const anchorX = anchorStart.x + (anchorEnd.x - anchorStart.x) * t;
    const anchorY = anchorStart.y + (anchorEnd.y - anchorStart.y) * t;
    const anchorZ = anchorStart.z + (anchorEnd.z - anchorStart.z) * t;

    // Hold the pivot at that point: origin = anchor - pivotLocal * scale.
    const origin = new vec3(
      anchorX - this.pivotLocal.x * scale,
      anchorY - this.pivotLocal.y * scale,
      anchorZ - this.pivotLocal.z * scale
    );

    const transform = this.root.getTransform();
    transform.setLocalScale(new vec3(scale, scale, scale));
    transform.setWorldPosition(origin);

    if (!done) {
      return;
    }

    if (this.state === STATE_GROWING) {
      this.state = STATE_HELD;
      print("[BattleStage] grown to " + scale.toFixed(2) + ", holding");
      if (this.callbacks) {
        this.callbacks.onEnterComplete();
      }
    } else {
      print("[BattleStage] back to " + scale.toFixed(2));
      this.state = STATE_IDLE;
      // Taken and cleared BEFORE the call. A callback is allowed to start the
      // next move -- shrinking out of life-size hands straight over to
      // unframing -- and clearing the field afterwards would null the callbacks
      // that move had only just installed.
      const finished = this.callbacks;
      this.callbacks = null;
      if (finished) {
        finished.onExitComplete();
      }
    }
  }

  /**
   * One frame of a framing move: position, yaw and scale together.
   *
   * All three are eased on the SAME curve. Easing them apart is what makes a
   * transition read as two things happening rather than one thing moving.
   */
  private updateFraming(dt: number): void {
    this.progress += dt / TRANSITION_SECONDS;
    const done = this.progress >= 1;
    const t = BattleStage.ease(done ? 1 : this.progress);

    const scale = this.fromScale + (this.toScale - this.fromScale) * t;
    const yaw = this.fromYaw + (this.toYaw - this.fromYaw) * t;
    const transform = this.root.getTransform();
    transform.setLocalScale(new vec3(scale, scale, scale));
    transform.setWorldRotation(this.rotationFor(yaw));
    transform.setWorldPosition(new vec3(
      this.fromPosition.x + (this.toPosition.x - this.fromPosition.x) * t,
      this.fromPosition.y + (this.toPosition.y - this.fromPosition.y) * t,
      this.fromPosition.z + (this.toPosition.z - this.fromPosition.z) * t
    ));

    if (!done) {
      return;
    }
    const wasUnframing = this.state === STATE_UNFRAMING;
    // Back to IDLE, not HELD: the wearer can pick the fight up and move it.
    // baseScale follows, or the next pinch snaps the world back to the scale
    // the tabletop had before the fight.
    this.state = STATE_IDLE;
    this.baseScale = scale;
    this.progress = 0;
    if (wasUnframing) {
      this.framed = false;
      const finished = this.callbacks;
      this.callbacks = null;
      if (finished) {
        finished.onExitComplete();
      }
    } else if (this.callbacks) {
      this.callbacks.onEnterComplete();
    }
  }

  /** Current scale, so callers can size things that must stay world-constant. */
  currentScale(): number {
    return this.root.getTransform().getLocalScale().x;
  }

  /**
   * Scales the world by `factor` about a fixed world point, for the pinch-and-hold
   * dive. Holding a point still while scaling is the same trick the encounter
   * transition uses; the difference is that the point comes from the user's hand
   * and the scale is whatever they stop at, not a destination.
   *
   * Refuses while a transition is running, so a pinch cannot fight the encounter.
   */
  scaleAbout(worldPivot: vec3, factor: number, minScale: number, maxScale: number): void {
    if (this.state !== STATE_IDLE) {
      return;
    }
    const transform = this.root.getTransform();
    const scale = transform.getLocalScale().x;
    let next = scale * factor;
    if (next < minScale) next = minScale;
    if (next > maxScale) next = maxScale;
    if (next === scale) {
      return;
    }
    const applied = next / scale;
    const origin = transform.getWorldPosition();
    transform.setWorldPosition(new vec3(
      worldPivot.x - (worldPivot.x - origin.x) * applied,
      worldPivot.y - (worldPivot.y - origin.y) * applied,
      worldPivot.z - (worldPivot.z - origin.z) * applied
    ));
    transform.setLocalScale(new vec3(next, next, next));
    // The diorama now sits at this scale, so a later encounter grows from here.
    this.baseScale = next;
  }

  /** Slides the world, for pinch-and-drag. Ignored mid-transition. */
  moveBy(delta: vec3): void {
    if (this.state !== STATE_IDLE) {
      return;
    }
    const transform = this.root.getTransform();
    const at = transform.getWorldPosition();
    transform.setWorldPosition(new vec3(at.x + delta.x, at.y + delta.y, at.z + delta.z));
  }
}
