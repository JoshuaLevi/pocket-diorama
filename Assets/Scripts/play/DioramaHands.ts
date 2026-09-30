// Hand control of the diorama: move it, resize it, and turn it.
//
// The reference does this with a Quest grip. On Spectacles the equivalent is a
// pinch, and the two gestures that matter are:
//
//   one hand, pinch and drag   -- the world follows your hand, so you can put it
//                                 where you actually want it. Only on the rim
//                                 band, because one hand near the world is what
//                                 a wearer's hands do all day.
//   two hands, pinch and twist -- the world scales with the distance between
//                                 your hands, the way a photograph zooms on a
//                                 phone, AND turns with the line between them.
//                                 Anywhere over the world: two hands pinching
//                                 at once is not something anybody does by
//                                 accident, so it needs no handle.
//
// One gesture doing both is not a shortcut. Two hands are already saying both
// things -- the distance is the size and the line is the heading -- and
// splitting them would mean a wearer who wants to turn the world first has to
// remember which of two gestures turns it.
//
// The two-handed one REPLACED a pinch-and-hold-still that grew the world at a
// fixed rate for as long as you held, and flipped direction each time so the
// next hold shrank it. A playtest on the glasses (7 September) found it exactly
// as hard to use as that description suggests: holding a hand still inside four
// centimetres is a skill, the rate is a guess, and which way the next hold will
// go is invisible. Distance between two hands is none of those things -- it is
// the size, you can see it, and pushing them back together undoes it.
//
// Everything here reads SIK's stable core -- HandInputData, isPinching, index tip
// -- which is on the known-good list for the 5.15 downgrade. Nothing binds until
// OnStartEvent, because SIK is not ready before that.

// The geometry lives next door, where a node test can reach it without a Lens
// Studio package on the path.
import { twistBearing, wrapRadians } from "./DioramaGrab";
import type { HandSample } from "./SpatialInput";

/** Hand travel, in cm, that separates a drag from a hold. */
const DRAG_THRESHOLD_CM: number = 4;

/**
 * Hands closer together than this do not scale.
 *
 * The factor is a RATIO of distances, so a span heading for zero sends it
 * heading for infinity. Below this the gesture simply holds what it has.
 */
const MIN_SPAN_CM: number = 3;

/**
 * The most one frame may scale by, either way.
 *
 * Hand tracking drops and reacquires; a frame where one hand jumps across the
 * room would otherwise be read as a colossal pull. Clamped, such a frame is a
 * small step in a direction the next frame corrects.
 */
const MAX_FRAME_FACTOR: number = 1.5;

/**
 * The most one frame may TURN by, in radians.
 *
 * Fifteen degrees a frame is nine hundred a second: faster than a wrist, and
 * slow enough that a frame in which a hand is reported across the room is a
 * small step the next frame takes back rather than a spin.
 */
const MAX_FRAME_TWIST: number = 15 * Math.PI / 180;

export interface DioramaHandsCallbacks {
  /** Grow or shrink about a world point, returning the scale actually applied. */
  onDiveScale: (worldPivot: vec3, scale: number) => void;
  onMove: (delta: vec3) => void;
  /**
   * Turn the world by this many radians about the world's up axis.
   *
   * No pivot, unlike onDiveScale, and that is deliberate rather than an
   * omission: the lens rebuilds the diorama's position from the player's
   * anchor every frame, so the world turns about the PLAYER whatever point is
   * named here. Passing the hands' midpoint would be a parameter the caller
   * has to ignore, and a lie about where the gesture pivots.
   */
  onTwist?: (radians: number) => void;
  /**
   * Whether ONE hand pinching at this world point is TAKING HOLD of the world.
   *
   * The rim band, in practice -- see DioramaGrab. Optional: without it every
   * pinch counts, which is what this did until 9 September and why the playtest
   * reported the world moving by accident. It is asked once, when a gesture
   * BEGINS, and never again: letting go of the rim halfway through a drag must
   * not drop the world, exactly as a hand that slides off a real handle does
   * not.
   */
  canGrab?: (worldPoint: vec3) => boolean;
  /**
   * Whether TWO hands pinching at this world point are over the world at all.
   *
   * The looser gate, asked of a two-handed span instead of canGrab. Two hands
   * do not need the handle: pinching with both at once is deliberate, and
   * asking either of them to also find a band made resizing a stunt. Optional,
   * and without it two hands work anywhere -- a wearer whose plate size is
   * unknown must not be locked out of resizing.
   */
  canSpan?: (worldPoint: vec3) => boolean;
  /**
   * A tracked hand has moved over the handle, or off it. Fired on CHANGE only.
   *
   * The handle is not drawn and cannot be -- a rounded rectangle was tried on
   * 9 September and came back from the glasses as a black lid lying over the
   * world. So the lens SAYS it instead. This is the cheapest thing that turns
   * an invisible handle into a findable one, and it costs no geometry.
   *
   * Never true while a gesture is running: by then the wearer has found it.
   */
  onHoverRim?: (over: boolean) => void;
  /**
   * A pinch that was not a grab and did not become a drag: a tap, with the
   * world point it began at.
   *
   * Fired on RELEASE, and only when the hand stayed put -- a pinch that
   * travelled is someone moving the world, and a pinch still held is someone
   * about to. Reading a page of text is most of playing this game and it used
   * to need hardware for every press; a pinch is the one gesture the glasses
   * give you for free. Away from the world it is A; over the world the lens
   * reads it as "walk there" (RouteSource), which is why the point comes too.
   */
  onTap?: (at: vec3) => void;
  /**
   * A pinch INSIDE the plate that is held rather than tapped: a joystick
   * anchored on the player. Called every frame the hold lasts, with where
   * the hand is now; the caller reads the direction from the player to it.
   * Never for a pinch on the handle band, which is a grab, and never for a
   * pinch that is over within TAP_SECONDS, which is a tap. Without this
   * callback a long hold is simply ignored, as before.
   */
  onStick?: (at: vec3) => void;
  /** The held pinch let go. */
  onStickEnd?: () => void;
}

const MODE_IDLE: number = 0;
const MODE_UNDECIDED: number = 1;
const MODE_DRAGGING: number = 2;
/** The two-handed gesture: it scales AND turns, in one span. */
const MODE_SCALING: number = 3;
/** A pinch away from the handle, which is the A button rather than a grip. */
const MODE_TAPPING: number = 4;
/**
 * A pinch that has disqualified itself and must be let go of before anything
 * else can happen.
 *
 * Without this a wandering pinch fell back to IDLE, and IDLE re-reads the same
 * still-closed hand on the very next frame -- so a hand sweeping across the
 * room restarted the tap every frame and pressed A on release anyway. A
 * gesture ends when the hand opens, not when it stops qualifying.
 */
const MODE_DEAD: number = 5;
/** A pinch inside the plate held past TAP_SECONDS: the hand is a joystick until it opens. */
const MODE_STICK: number = 6;

/**
 * How long a pinch may last and still be a press, in seconds.
 *
 * Long enough not to punish a deliberate one, short enough that resting your
 * fingers together while you think does not walk the wearer through a page of
 * text they have not read.
 */
const TAP_SECONDS: number = 0.6;

/** How far a pinch may wander and still be a press, in centimetres. */
const TAP_DRIFT_CM: number = 3;

export class DioramaHands {
  /** Stable hand IDs survive one hand disappearing; tracking loss is not a release. */
  samples(): HandSample[] {
    return [this.leftHand, this.rightHand].map((hand: any, index: number) => {
      const sample: HandSample = {id: index+1, tracked: false, pinching: false, x: 0, y: 0, z: 0};
      try {
        if (hand && hand.isTracked() && hand.indexTip && hand.indexTip.position) {
          const p = hand.indexTip.position;
          sample.tracked = true; sample.pinching = hand.isPinching();
          sample.x = p.x; sample.y = p.y; sample.z = p.z;
        }
      } catch (e) { /* Cancel through an untracked sample. */ }
      return sample;
    });
  }
  private handProvider: any = null;
  private leftHand: any = null;
  private rightHand: any = null;

  private mode: number = MODE_IDLE;
  private heldSeconds: number = 0;
  private anchor: vec3 = null;
  private lastPoint: vec3 = null;
  /** The distance between the two pinching hands on the previous frame, in cm. */
  private lastSpan: number = 0;
  /**
   * The bearing of the line between them on the previous frame, in radians,
   * or NaN when there was no gesture or no bearing to be had.
   */
  private lastBearing: number = NaN;
  /** Whether a hand was over the handle last frame, so only changes are said. */
  private hoveringRim: boolean = false;

  /** Binds to SIK. Returns false when hand tracking is not available at all. */
  bind(handInputDataFactory: () => any): boolean {
    try {
      this.handProvider = handInputDataFactory();
      if (!this.handProvider) {
        return false;
      }
      this.leftHand = this.handProvider.getHand("left");
      this.rightHand = this.handProvider.getHand("right");
      return this.leftHand !== null || this.rightHand !== null;
    } catch (e) {
      print("[DioramaHands] hand input unavailable: " + e);
      return false;
    }
  }

  /**
   * Every tracked hand's index tip in world space, pinching ones only when
   * asked for.
   *
   * Right first, so a one-handed gesture is the same hand frame to frame while
   * both are tracked but only one is pinching -- and so the two-handed bearing
   * is taken along the same line every frame rather than flipping by half a
   * circle when the order changes.
   */
  /** Every tracked hand's index fingertip in world space: what presses a button. */
  fingertips(): vec3[] {
    return this.handPoints(false);
  }

  private handPoints(pinchingOnly: boolean): vec3[] {
    const out: vec3[] = [];
    const hands = [this.rightHand, this.leftHand];
    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i];
      if (!hand) {
        continue;
      }
      try {
        if (!hand.isTracked() || (pinchingOnly && !hand.isPinching())) {
          continue;
        }
        const tip = hand.indexTip;
        if (tip && tip.position) {
          out.push(tip.position);
        }
      } catch (e) {
        // A hand that drops out mid-frame is normal, not an error.
      }
    }
    return out;
  }

  /** Public so a test can state the gesture without a hand-tracking stack. */
  static midpoint(a: vec3, b: vec3): vec3 {
    return new vec3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  }

  /** Whether ONE hand beginning a gesture at this point may take hold. */
  private allowed(points: vec3[], callbacks: DioramaHandsCallbacks): boolean {
    if (!callbacks.canGrab) {
      return true;
    }
    for (let i = 0; i < points.length; i++) {
      if (callbacks.canGrab(points[i])) {
        return true;
      }
    }
    return false;
  }

  /** Whether TWO hands beginning a span here are over the world at all. */
  private spanAllowed(points: vec3[], callbacks: DioramaHandsCallbacks): boolean {
    if (!callbacks.canSpan) {
      return true;
    }
    // Either hand over the world is enough: the gesture is one thing done with
    // two hands, and a span wide enough to be worth making has one hand out
    // past the edge as often as not.
    for (let i = 0; i < points.length; i++) {
      if (callbacks.canSpan(points[i])) {
        return true;
      }
    }
    return false;
  }

  update(dt: number, callbacks: DioramaHandsCallbacks): void {
    this.step(dt, callbacks);
    // After the gesture, not before: whether the hint is wanted depends on the
    // mode this frame just decided on.
    this.reportHover(callbacks);
  }

  private step(dt: number, callbacks: DioramaHandsCallbacks): void {
    const points = this.handPoints(true);

    if (points.length >= 2) {
      if (this.mode !== MODE_SCALING && !this.spanAllowed(points, callbacks)) {
        // Two hands pinching somewhere else entirely. Not this world's
        // business, and forgetting the span and the bearing keeps the next
        // real gesture from opening with a jump.
        this.lastSpan = 0;
        this.lastBearing = NaN;
        return;
      }
      this.spanStep(points[0], points[1], callbacks);
      return;
    }
    // Letting go of one of two hands ends the gesture rather than continuing it
    // as a drag: the hand that is left is somewhere it was never dragging from.
    this.lastSpan = 0;
    this.lastBearing = NaN;
    if (this.mode === MODE_SCALING) {
      this.mode = MODE_IDLE;
      this.anchor = null;
      this.lastPoint = null;
      return;
    }

    if (points.length === 0) {
      if (this.mode === MODE_STICK) {
        if (callbacks.onStickEnd) {
          callbacks.onStickEnd();
        }
        this.mode = MODE_IDLE;
        this.heldSeconds = 0;
        this.anchor = null;
        this.lastPoint = null;
        return;
      }
      // Let go without going anywhere and without holding: a press. For a
      // pinch away from the handle both disqualifications have already turned
      // the gesture DEAD, so reaching here is the whole test. A pinch ON the
      // handle that never became a drag is the same press: since 19 September
      // a tap over the world is "walk there", and the handle band is a third
      // of the plate, so without this no cell in the outer third of any town
      // could be walked to. The world only moves once the hand does.
      const stillOnHandle = this.mode === MODE_UNDECIDED &&
        this.heldSeconds <= TAP_SECONDS &&
        this.lastPoint.distance(this.anchor) <= TAP_DRIFT_CM;
      if ((this.mode === MODE_TAPPING || stillOnHandle) && callbacks.onTap) {
        // With WHERE the pinch began: over the world it is a place to walk
        // to (PokemonAR decides), anywhere else it is the button.
        callbacks.onTap(this.anchor);
      }
      if (this.mode !== MODE_IDLE) {
        this.mode = MODE_IDLE;
        this.heldSeconds = 0;
        this.anchor = null;
        this.lastPoint = null;
      }
      return;
    }

    const point = points[0];
    if (this.mode === MODE_IDLE) {
      // A pinch away from the handle is not a grab -- it is a button. Pointing
      // at something, holding a phone, resting a hand: all of them used to
      // drag the town across the table, and now the only one that does
      // anything is a deliberate pinch that goes nowhere, which is a press.
      this.mode = this.allowed(points, callbacks) ? MODE_UNDECIDED : MODE_TAPPING;
      this.heldSeconds = 0;
      this.anchor = point;
      this.lastPoint = point;
      return;
    }

    this.heldSeconds += dt;
    if (this.mode === MODE_DEAD) {
      this.lastPoint = point;
      return;
    }
    if (this.mode === MODE_STICK) {
      if (callbacks.onStick) {
        callbacks.onStick(point);
      }
      this.lastPoint = point;
      return;
    }
    if (this.mode === MODE_TAPPING) {
      // A tap that wanders, or one held too long, is not a press. With a
      // caller that wants a stick it becomes one -- the hand is now a
      // joystick anchored on the player, and stays one until it opens.
      // Without, it is someone gesturing, and it stays disqualified.
      if (point.distance(this.anchor) > TAP_DRIFT_CM ||
          this.heldSeconds > TAP_SECONDS) {
        if (callbacks.onStick) {
          this.mode = MODE_STICK;
          callbacks.onStick(point);
        } else {
          this.mode = MODE_DEAD;
        }
      }
      this.lastPoint = point;
      return;
    }
    // One hand only ever moves the world. A hold that goes nowhere used to
    // start growing it, which is what made a drag that paused mid-way zoom.
    if (this.mode === MODE_UNDECIDED && point.distance(this.anchor) > DRAG_THRESHOLD_CM) {
      this.mode = MODE_DRAGGING;
    }

    if (this.mode === MODE_DRAGGING) {
      callbacks.onMove(new vec3(
        point.x - this.lastPoint.x,
        point.y - this.lastPoint.y,
        point.z - this.lastPoint.z
      ));
    }

    this.lastPoint = point;
  }

  /**
   * Says whether a hand is over the handle, once per change.
   *
   * Only while idle: once a gesture is running the wearer has demonstrably
   * found the handle, and the line the hint is written on has better things to
   * say. Costs nothing when the caller does not want a hint, or has no rule
   * about where the handle is.
   */
  private reportHover(callbacks: DioramaHandsCallbacks): void {
    if (!callbacks.onHoverRim) {
      return;
    }
    let over = false;
    if (this.mode === MODE_IDLE && callbacks.canGrab) {
      // Tracked, not pinching: the hint is for the hand that is LOOKING for the
      // handle, which is a hand that has not closed yet.
      const points = this.handPoints(false);
      for (let i = 0; i < points.length; i++) {
        if (callbacks.canGrab(points[i])) {
          over = true;
          break;
        }
      }
    }
    if (over === this.hoveringRim) {
      return;
    }
    this.hoveringRim = over;
    callbacks.onHoverRim(over);
  }

  /**
   * One frame of the two-handed gesture: the size, then the heading.
   *
   * The factor is this frame's span over the last one's, so the world tracks
   * the hands rather than drifting: put them back where they were and the
   * world is back where it was, whatever happened in between. The turn is the
   * same claim about the line between them.
   */
  private spanStep(a: vec3, b: vec3, callbacks: DioramaHandsCallbacks): void {
    const span = a.distance(b);
    const pivot = DioramaHands.midpoint(a, b);
    const first = this.mode !== MODE_SCALING;
    this.mode = MODE_SCALING;
    this.heldSeconds = 0;
    this.anchor = pivot;
    this.lastPoint = pivot;
    this.twistStep(a, b, first, callbacks);
    if (first || this.lastSpan < MIN_SPAN_CM || span < MIN_SPAN_CM) {
      // The first frame of the gesture has nothing to compare against, and a
      // span near zero would make a ratio near infinity.
      this.lastSpan = span;
      return;
    }
    let factor = span / this.lastSpan;
    if (!(factor > 0) || factor !== factor) {
      return;
    }
    if (factor > MAX_FRAME_FACTOR) factor = MAX_FRAME_FACTOR;
    if (factor < 1 / MAX_FRAME_FACTOR) factor = 1 / MAX_FRAME_FACTOR;
    // The clamp DEFERS the rest of the pull rather than dropping it: what is
    // remembered is the span actually reached, so the next frames close the
    // gap. Remembering the real span instead would make a fast pull land short
    // and stay short, and the world would no longer track the hands.
    this.lastSpan = this.lastSpan * factor;
    if (factor === 1) {
      return;
    }
    callbacks.onDiveScale(pivot, factor);
  }

  /**
   * One frame of the turn, inside the same two-handed gesture as the scale.
   *
   * Rotation did not exist at all until now. The world took the heading it was
   * placed at and nothing could change it, so a wearer who moved their chair
   * could put the world back in FRONT of them (OPTION -> PLACE) but never back
   * round to FACE them, and UP on the d-pad is north on the map, so a world
   * turned wrong is a d-pad turned wrong.
   */
  private twistStep(a: vec3, b: vec3, first: boolean,
                    callbacks: DioramaHandsCallbacks): void {
    const bearing = twistBearing(a.x, a.z, b.x, b.z);
    // NaN is the only value not equal to itself: no bearing last frame, or
    // none this frame, and there is nothing to compare.
    if (first || bearing !== bearing || this.lastBearing !== this.lastBearing) {
      this.lastBearing = bearing;
      return;
    }
    let turn = wrapRadians(bearing - this.lastBearing);
    if (turn > MAX_FRAME_TWIST) turn = MAX_FRAME_TWIST;
    if (turn < -MAX_FRAME_TWIST) turn = -MAX_FRAME_TWIST;
    // The clamp DEFERS the rest of the turn rather than dropping it, exactly as
    // the span's does: what is remembered is the bearing actually reached, so a
    // glitch frame is paid back by the frames that follow it and the world ends
    // up where the hands say. Remembering the real bearing would leave a fast
    // twist short and keep it short.
    this.lastBearing = wrapRadians(this.lastBearing + turn);
    if (turn === 0 || !callbacks.onTwist) {
      return;
    }
    callbacks.onTwist(turn);
  }

  /** What the gesture is doing right now, for status text and tests. */
  modeName(): string {
    if (this.mode === MODE_DRAGGING) return "drag";
    if (this.mode === MODE_SCALING) return "scale";
    if (this.mode === MODE_UNDECIDED) return "pinch";
    if (this.mode === MODE_STICK) return "stick";
    return "";
  }

  isActive(): boolean {
    return this.mode !== MODE_IDLE;
  }
}
