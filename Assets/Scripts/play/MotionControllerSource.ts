// The phone as a Game Boy pad.
//
// The Spectacles App turns the wearer's phone into a Motion Controller: a tracked
// transform, a touch surface and a haptic motor. This reads the touch surface as
// a four-way D-pad with a button in the middle, and takes the transform too --
// not to move anything with, but because the pad's own picture is drawn where
// the phone is (PhonePadLayout): a lens cannot draw on the phone's screen, so
// the buttons hang in front of it instead.
//
//     +-----------------------------+
//     |              UP             |     tap the centre          -> A
//     |                             |     hold the centre  350ms  -> B
//     |    LEFT    ( A / B )  RIGHT |     tap a bottom corner     -> START / SELECT
//     |                             |     anywhere else, held     -> a direction
//     | [START]     DOWN   [SELECT] |
//     +-----------------------------+
//
// START was a SECOND FINGER anywhere on the pad until a playtest on the glasses
// (7 September) walked into the nickname screen and could not get out: an
// invisible gesture on a surface you cannot draw on is not a button. Both it and
// SELECT are corners now, drawn by PhonePadLayout in the same place zoneAt reads.
//
// Normalized touch coordinates put (0,0) at the TOP-left and (1,1) at the
// bottom-right, so screen y grows downward and UP is negative dy.
//
// WHAT THIS FILE IS REALLY ABOUT: isConnected(). The Bluetooth pad in
// InputSource.ts got this wrong -- it reported connected whenever it held a
// controller OBJECT, won the input router, and then silently swallowed every
// input while the character stood still. getController() hands back an object
// with no phone paired at all, so the object proves nothing. Connected here means
// the platform says the phone is transmitting, or a touch has just arrived from
// it. Nothing else counts.

import type { DPadState, InputSource } from "./InputSource";
import { emptyDPad } from "./InputSource";
import { zoneAt, ZONE_CENTRE, ZONE_NONE, ZONE_SELECT, ZONE_START }
  from "./screen/PhonePadLayout";

/** A centre press held at least this long is B rather than A. */
const LONG_PRESS_MS: number = 350;

/**
 * How long a touch keeps proving the phone is alive, in frames: ~1.5s at 60fps,
 * ~3s at 30fps. A motionless finger sends no further events, so on a build with
 * no isControllerAvailable() a long still hold would age out -- both versions
 * this project targets (5.15.4 and 5.23) declare that query, so this is the belt
 * to its braces rather than the other way round.
 */
const TOUCH_LIVE_FRAMES: number = 90;

/** No touch is active. Touch ids are non-negative. */
const NO_TOUCH: number = -1;

export class MotionControllerSource implements InputSource {
  readonly name: string = "phone";

  private controller: any = null;

  // The platform's own answer to "is a phone transmitting", polled every frame.
  // Documented as: connected, properly set up, and transmitting data.
  private available: boolean = false;
  private availabilityQueried: boolean = false;

  // Fallback liveness for a build without that query: an arriving touch is
  // undeniable proof, and it decays so a phone that goes away releases the router.
  private framesSinceTouch: number = TOUCH_LIVE_FRAMES;

  private state: DPadState = emptyDPad();
  /** The zone under the thumb right now, for the pad the glasses draw. */
  private zone: string = ZONE_NONE;
  private activeTouchId: number = NO_TOUCH;
  private touchBeganMs: number = 0;
  /** The zone the finger came down in, and whether it has stayed there. */
  private beganZone: string = ZONE_NONE;
  private stayedInZone: boolean = false;

  private queuedA: boolean = false;
  private queuedB: boolean = false;
  private queuedStart: boolean = false;
  private queuedSelect: boolean = false;
  private frameA: boolean = false;
  private frameB: boolean = false;
  private frameStart: boolean = false;
  private frameSelect: boolean = false;

  private lastConnected: boolean = false;

  // TouchPhase values, taken from the platform when it is there and otherwise from
  // the declared order in StudioLib.d.ts. Resolving them beats hard-coding them,
  // and hard-coding them beats crashing where the enum does not exist (Node tests,
  // and any preview without the module).
  private phaseBegan: number = 0;
  private phaseMoved: number = 1;
  private phaseEnded: number = 2;
  private phaseCanceled: number = 3;

  /**
   * Hands back null when no phone controller stack is available. The factory does
   * the require() so the caller owns the module path and this stays testable.
   */
  static tryCreate(factory: () => any): MotionControllerSource {
    try {
      const module: any = factory();
      if (!module || typeof module.getController !== "function") {
        return null;
      }
      const controller: any = module.getController(MotionControllerSource.optionsOrNull());
      if (!controller) {
        return null;
      }
      const source = new MotionControllerSource();
      source.controller = controller;
      source.resolvePhases();
      source.bind();
      return source;
    } catch (e) {
      print("[phone] MotionControllerSource unavailable: " + e);
      return null;
    }
  }

  /**
   * Touch AND pose.
   *
   * This asked for NoMotion while nothing read the phone's position. The pad is
   * now drawn where the phone actually is -- the buttons cannot go on its
   * screen, so they hang in front of it -- and that needs the six degrees of
   * freedom. Null is still a valid argument: the module then uses its defaults.
   */
  private static optionsOrNull(): any {
    try {
      if (typeof MotionController === "undefined") {
        return null;
      }
      const api: any = MotionController;
      if (!api.MotionControllerOptions || typeof api.MotionControllerOptions.create !== "function") {
        return null;
      }
      const options: any = api.MotionControllerOptions.create();
      if (api.MotionType && typeof api.MotionType.SixDoF === "number") {
        options.motionType = api.MotionType.SixDoF;
      }
      return options;
    } catch (e) {
      return null;
    }
  }

  private resolvePhases(): void {
    try {
      if (typeof MotionController === "undefined") {
        return;
      }
      const api: any = MotionController;
      const phases: any = api.TouchPhase;
      if (!phases) {
        return;
      }
      if (typeof phases.Began === "number") this.phaseBegan = phases.Began;
      if (typeof phases.Moved === "number") this.phaseMoved = phases.Moved;
      if (typeof phases.Ended === "number") this.phaseEnded = phases.Ended;
      if (typeof phases.Canceled === "number") this.phaseCanceled = phases.Canceled;
    } catch (e) {
      // Keep the declared order.
    }
  }

  private bind(): void {
    const controller: any = this.controller;
    try {
      if (controller.onTouchEvent && typeof controller.onTouchEvent.add === "function") {
        controller.onTouchEvent.add(
          (position: any, touchId: number, timestampMs: number, phase: any) => {
            this.onTouch(position, touchId, timestampMs, phase);
          }
        );
      }
    } catch (e) {
      print("[phone] no touch events: " + e);
    }
    try {
      if (
        controller.onControllerStateChange &&
        typeof controller.onControllerStateChange.add === "function"
      ) {
        // Only load-bearing where isControllerAvailable() is missing; where both
        // exist the poll below re-states the same truth a frame later.
        controller.onControllerStateChange.add((available: boolean) => {
          this.available = available === true;
        });
      }
    } catch (e) {
      // The poll is the primary signal; this one is a convenience.
    }
  }

  /** Public so a test can drive the touch surface without a phone. */
  onTouch(position: any, touchId: number, timestampMs: number, phase: any): void {
    // Any event from any finger proves the phone is talking, even one this
    // gesture model then ignores.
    this.framesSinceTouch = 0;

    const x: number = position && typeof position.x === "number" ? position.x : 0.5;
    const y: number = position && typeof position.y === "number" ? position.y : 0.5;
    const id: number = typeof touchId === "number" ? touchId : 0;
    const now: number = typeof timestampMs === "number" ? timestampMs : 0;

    if (phase === this.phaseBegan) {
      if (this.activeTouchId === NO_TOUCH) {
        this.activeTouchId = id;
        this.touchBeganMs = now;
        this.beganZone = zoneAt(x, y);
        this.stayedInZone = true;
        this.setZone(x, y);
        // A tick the moment a zone is entered. The pad is drawn on the phone but
        // your thumb is ON the phone, covering it, so the buzz is what tells you
        // which button you are on without lifting it to look.
        this.invokeHaptic("Tick", 0.03);
      }
      // A second finger used to be START. It is a corner now, so a stray palm
      // or a two-thumbed grip no longer opens the menu.
      return;
    }

    if (id !== this.activeTouchId) {
      return;
    }

    if (phase === this.phaseMoved) {
      const before = this.zone;
      this.setZone(x, y);
      // A finger that slides out of the zone it started in is steering, not
      // pressing: the button it leaves does not fire when it comes up.
      if (this.zone !== this.beganZone) {
        this.stayedInZone = false;
      }
      if (this.zone !== before) {
        this.invokeHaptic("Tick", 0.03);
      }
      return;
    }

    if (phase === this.phaseEnded || phase === this.phaseCanceled) {
      const zone = this.beganZone;
      const stayed = this.stayedInZone;
      let heldMs: number = now - this.touchBeganMs;
      if (!(heldMs >= 0)) {
        heldMs = 0;
      }
      this.state = emptyDPad();
      this.zone = ZONE_NONE;
      this.activeTouchId = NO_TOUCH;
      this.beganZone = ZONE_NONE;
      this.stayedInZone = false;
      if (phase !== this.phaseEnded || !stayed) {
        return;
      }
      if (zone === ZONE_CENTRE) {
        if (heldMs >= LONG_PRESS_MS) {
          this.queuedB = true;
        } else {
          this.queuedA = true;
        }
        // A and B are the two presses worth confirming: the rest of the pad is a
        // direction you can see happening in the world.
        this.invokeHaptic("Select", 0.05);
      } else if (zone === ZONE_START) {
        this.queuedStart = true;
        this.invokeHaptic("Success", 0.1);
      } else if (zone === ZONE_SELECT) {
        this.queuedSelect = true;
        this.invokeHaptic("Success", 0.1);
      }
    }
  }

  /** The zone under a touch, kept for the pad the glasses draw. */
  private setZone(x: number, y: number): void {
    this.zone = zoneAt(x, y);
    this.state = this.directionAt(x, y);
  }

  /** Four-way, never diagonal: a Gen 1 character cannot walk diagonally. */
  private directionAt(x: number, y: number): DPadState {
    const state = emptyDPad();
    const zone = zoneAt(x, y);
    if (zone === "up") state.up = true;
    else if (zone === "down") state.down = true;
    else if (zone === "left") state.left = true;
    else if (zone === "right") state.right = true;
    return state;
  }

  update(): void {
    // Consume the queued presses so each one is seen for exactly one frame.
    this.frameA = this.queuedA;
    this.frameB = this.queuedB;
    this.frameStart = this.queuedStart;
    this.frameSelect = this.queuedSelect;
    this.queuedA = false;
    this.queuedB = false;
    this.queuedStart = false;
    this.queuedSelect = false;

    if (this.framesSinceTouch < TOUCH_LIVE_FRAMES) {
      this.framesSinceTouch++;
    }

    if (this.controller && typeof this.controller.isControllerAvailable === "function") {
      try {
        this.available = this.controller.isControllerAvailable() === true;
        this.availabilityQueried = true;
      } catch (e) {
        this.available = false;
      }
    }

    const connected = this.isConnected();
    if (!connected) {
      // Do not leave a direction held by a phone that has stopped answering.
      this.state = emptyDPad();
      this.zone = ZONE_NONE;
      this.activeTouchId = NO_TOUCH;
    }
    if (connected !== this.lastConnected) {
      this.lastConnected = connected;
      print(
        "[phone] " + (connected ? "reporting" : "silent") +
        " available=" + this.available +
        " queried=" + this.availabilityQueried +
        " framesSinceTouch=" + this.framesSinceTouch
      );
    }
  }

  dpad(): DPadState {
    return this.state;
  }

  pressedA(): boolean {
    return this.frameA;
  }

  pressedB(): boolean {
    return this.frameB;
  }

  pressedStart(): boolean {
    return this.frameStart;
  }

  pressedSelect(): boolean {
    return this.frameSelect;
  }

  isConnected(): boolean {
    if (this.controller === null) {
      return false;
    }
    // Holding a controller object is not evidence. These two are, and either one
    // alone is enough:
    //   - the platform says the phone is transmitting, polled fresh this frame
    //   - a touch arrived from it within the last TOUCH_LIVE_FRAMES
    // Their union rather than their intersection, because both are positive
    // evidence and disagreeing with a touch that is physically arriving would
    // swallow input just as surely as the bug this file exists to avoid. The
    // touch half decays, so a phone that goes away hands the router back instead
    // of holding it dead -- at worst one liveness window late, and only on a
    // build with no isControllerAvailable() at all.
    return this.available || this.framesSinceTouch < TOUCH_LIVE_FRAMES;
  }

  /** Where the thumb is, as a zone name, or "" when nothing is down. */
  activeZone(): string {
    return this.zone;
  }

  /**
   * Where the phone is in the room, or null.
   *
   * Null whenever the pose is not being sent -- a build set to NoMotion, a phone
   * that has not been calibrated, tracking that has dropped -- so the caller can
   * simply not draw rather than draw at the origin.
   */
  phonePosition(): vec3 {
    if (!this.controller || typeof this.controller.getWorldPosition !== "function") {
      return null;
    }
    try {
      return this.controller.getWorldPosition();
    } catch (e) {
      return null;
    }
  }

  /** The phone's rotation in the room, or null. */
  phoneRotation(): quat {
    if (!this.controller || typeof this.controller.getWorldRotation !== "function") {
      return null;
    }
    try {
      return this.controller.getWorldRotation();
    } catch (e) {
      return null;
    }
  }

  /**
   * The touch surface's real size in centimetres, or null.
   *
   * The pad is drawn at this size, so it lands on the phone at 1:1 rather than
   * at a guess that is right for one handset.
   */
  touchpadSizeCm(): vec2 {
    if (!this.controller || typeof this.controller.getTouchpadPhysicalSize !== "function") {
      return null;
    }
    try {
      return this.controller.getTouchpadPhysicalSize();
    } catch (e) {
      return null;
    }
  }

  /** A tick under the thumb as each step lands. */
  hapticStep(): void {
    this.invokeHaptic("Tick", 0.05);
  }

  /** Something came out of the grass. */
  hapticEncounter(): void {
    this.invokeHaptic("VibrationMedium", 0.25);
  }

  private invokeHaptic(feedbackName: string, durationSeconds: number): void {
    if (!this.controller || !this.isConnected()) {
      return;
    }
    try {
      if (typeof MotionController === "undefined") {
        return;
      }
      const api: any = MotionController;
      if (!api.HapticRequest || typeof api.HapticRequest.create !== "function") {
        return;
      }
      const request: any = api.HapticRequest.create();
      const feedback: any = api.HapticFeedback;
      if (feedback && typeof feedback[feedbackName] === "number") {
        request.hapticFeedback = feedback[feedbackName];
      }
      request.duration = durationSeconds;
      this.controller.invokeHaptic(request);
    } catch (e) {
      // A phone with vibration switched off is not worth a log line per step.
    }
  }
}
