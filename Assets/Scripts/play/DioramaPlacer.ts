// Puts the diorama somewhere you can actually play on.
//
// The default is a comfortable spot in front of the wearer, because a lens that
// shows nothing until you have found a surface feels broken. A hit test against a
// real surface then improves on that whenever one is available, which is the moment
// the world stops floating and starts sitting on your table.
//
// Preview has no surfaces at all, so the fallback is not a degraded path -- it is
// the path every editor run takes, and it has to look right.

/** Comfortable default: a bit over an arm's length out, below eye level. */
const DEFAULT_FORWARD_CM: number = 105;
const DEFAULT_DROP_CM: number = 38;
/**
 * The editor's default camera looks dead ahead and frames about twenty degrees
 * below the eye line, where the glasses' wearer simply looks down at the
 * table. At the device drop the whole world sat under the preview's bottom
 * edge and every screenshot showed grey. Shallower here, and only here.
 */
const EDITOR_DROP_CM: number = 20;

function isEditor(): boolean {
  try {
    const system: any = (global as any).deviceInfoSystem;
    return !!(system && system.isEditor && system.isEditor());
  } catch (e) {
    return false;
  }
}

/** How far ahead to probe for a surface, and how far below the eye to aim. */
const PROBE_FORWARD_CM: number = 220;
const PROBE_DOWN_CM: number = 160;

/** Give up on an outstanding probe after this long and allow another. */
const PROBE_TIMEOUT_SECONDS: number = 2;

/** How often to probe while still unplaced. */
const PROBE_INTERVAL_SECONDS: number = 0.5;

/** What the placer is doing, for the lens to say out loud. */
export const PLACE_SEARCHING: string = "searching";
export const PLACE_IN_FRONT: string = "front";
export const PLACE_ON_SURFACE: string = "surface";

export class DioramaPlacer {
  private object: SceneObject;
  private camera: Camera;
  private session: any = null;
  private placed: boolean = false;
  private probing: boolean = false;
  /**
   * Which way the model is turned, in radians about the world's up axis.
   *
   * Taken from where the wearer is looking when the world is put down, so the
   * map's north points away from them. This is not decoration: UP on the d-pad
   * is north on the map, so a town that is turned wrong is a d-pad that is
   * turned wrong -- press up and the character walks off sideways. The lens
   * had no yaw at all until 9 September; the model always faced world -Z,
   * which is the direction a Lens Studio camera happens to start out facing,
   * so it looked right in the preview and wrong in every chair.
   */
  private yaw: number = 0;
  /** Whether a real surface was found, as opposed to the fallback. */
  private onSurface: boolean = false;
  /**
   * A placement the lens has not read yet, or null.
   *
   * The hit test answers on a CALLBACK, whenever it likes, and what it hands
   * back is where the world should be anchored -- so the lens has to be told,
   * rather than noticing. It cannot simply read the object's position either:
   * the world scrolls under the player every frame, so by the time anyone
   * looked the root would have moved off the point that was found.
   */
  private fresh: vec3 = null;
  /** Seconds the current probe has been outstanding, so a silent one cannot wedge it. */
  private probeAge: number = 0;
  /** Seconds until the next probe is allowed, so this is not attempted every frame. */
  private cooldown: number = 0;

  constructor(object: SceneObject, camera: Camera) {
    this.object = object;
    this.camera = camera;
  }

  /**
   * Opens a hit-test session if the module is available. Missing module, missing
   * permission and preview all take the same branch: no session, fallback only.
   */
  tryStartSurfaceTracking(worldQueryModule: any): boolean {
    if (!worldQueryModule) {
      return false;
    }
    try {
      const options = HitTestSessionOptions.create();
      // Smooth the result: an unfiltered hit jitters, and a diorama that shivers
      // on the table reads as a bug rather than as tracking.
      options.filter = true;
      this.session = worldQueryModule.createHitTestSessionWithOptions(options);
      this.session.start();
      return true;
    } catch (e) {
      print("[DioramaPlacer] no surface tracking: " + e);
      this.session = null;
      return false;
    }
  }

  /** Parks the diorama in front of the wearer, facing them. Always safe to call. */
  placeInFront(): void {
    if (!this.object) {
      // "Always safe to call" has to be true: OPTION -> PLACE reaches this
      // from a button, and a throw on a frame is a dead lens.
      return;
    }
    if (!this.camera) {
      this.object.getTransform().setWorldPosition(
        new vec3(0, -DEFAULT_DROP_CM, -DEFAULT_FORWARD_CM)
      );
      this.yaw = 0;
      return;
    }
    const transform = this.camera.getTransform();
    const eye = transform.getWorldPosition();
    const forward = transform.forward;
    const drop = isEditor() ? EDITOR_DROP_CM : DEFAULT_DROP_CM;
    // Lens Studio's forward is +Z while a camera looks down -Z, so take the negative.
    const target = new vec3(
      eye.x - forward.x * DEFAULT_FORWARD_CM,
      // Looking down must lower the fallback too; otherwise an immediate
      // encounter frames the world above the wearer's line of sight.
      eye.y - Math.max(drop, forward.y * DEFAULT_FORWARD_CM),
      eye.z - forward.z * DEFAULT_FORWARD_CM
    );
    this.object.getTransform().setWorldPosition(target);
    this.fresh = target;
    this.yaw = DioramaPlacer.yawFacing(-forward.x, -forward.z);
  }

  /**
   * The yaw that lays the map out away from a wearer looking along (lx, lz).
   *
   * The map's own +Z is SOUTH -- a cell's z grows as its row number does, and
   * row numbers grow downwards on a Gen 1 map -- so north is the model's -Z,
   * and north is what has to point away. Turning the model by `yaw` sends its
   * -Z to (-sin yaw, 0, -cos yaw), and setting that equal to the look
   * direction gives the atan2 below.
   *
   * Static and free of the scene so a test can state what it should be.
   */
  static yawFacing(lookX: number, lookZ: number): number {
    const length = Math.sqrt(lookX * lookX + lookZ * lookZ);
    if (length < 1e-6) {
      // Straight up or straight down: any heading is as good as another, and
      // zero is the one the model already had.
      return 0;
    }
    return Math.atan2(-lookX / length, -lookZ / length);
  }

  /** Which way the model is turned, in radians about the world's up axis. */
  facing(): number {
    return this.yaw;
  }

  /**
   * Puts the world down again in front of where the wearer is NOW, and starts
   * looking for a surface under it afresh.
   *
   * OPTION -> PLACE. The whole reason it exists is that placement happens once,
   * at boot, and standing up, sitting down or turning the chair invalidates
   * both halves of it: the height is wrong and, worse, the heading is, which
   * turns the d-pad.
   */
  replace(): void {
    this.placed = false;
    this.fresh = null;
    this.onSurface = false;
    this.probing = false;
    this.probeAge = 0;
    this.cooldown = 0;
    this.placeInFront();
  }

  /**
   * A point the world has just been placed at, once, or null.
   *
   * Read every frame by the lens, which turns it into the anchor the player
   * stands on. Handing it over CLEARS it: a placement is an event, and one
   * that kept answering would fight the wearer's own dragging.
   */
  takePlacement(): vec3 {
    const out = this.fresh;
    this.fresh = null;
    return out;
  }

  /** What it is doing, for the status line. */
  state(): string {
    if (this.onSurface) {
      return PLACE_ON_SURFACE;
    }
    return this.session && !this.placed ? PLACE_SEARCHING : PLACE_IN_FRONT;
  }

  /**
   * Probes for a real surface ahead and drops the diorama on it. Does nothing when
   * no session is running, and never blocks: the hit arrives on a callback.
   *
   * `dt` exists so an outstanding probe can time out. A hit test that never calls
   * back -- pointed at empty space, or a session that quietly stopped -- would
   * otherwise leave `probing` true forever and kill placement for the session
   * after a single miss. Nothing in preview ever calls it back.
   */
  requestSurfacePlacement(dt: number): void {
    if (this.probing) {
      this.probeAge += dt;
      if (this.probeAge < PROBE_TIMEOUT_SECONDS) {
        return;
      }
      this.probing = false;
    }
    this.cooldown -= dt;
    if (this.cooldown > 0) {
      return;
    }
    this.cooldown = PROBE_INTERVAL_SECONDS;
    if (!this.session || !this.camera) {
      return;
    }
    const transform = this.camera.getTransform();
    const eye = transform.getWorldPosition();
    const forward = transform.forward;

    const start = new vec3(eye.x, eye.y, eye.z);
    const end = new vec3(
      eye.x - forward.x * PROBE_FORWARD_CM,
      eye.y - PROBE_DOWN_CM,
      eye.z - forward.z * PROBE_FORWARD_CM
    );

    this.probing = true;
    this.probeAge = 0;
    try {
      this.session.hitTest(start, end, (hit: any) => {
        this.probing = false;
        if (!hit) {
          return;
        }
        this.object.getTransform().setWorldPosition(hit.position);
        this.fresh = hit.position;
        // AND RE-AIM. The heading taken in placeInFront is taken during
        // onAwake, before the world has loaded and while the wearer may still
        // be settling -- looking at a laptop, putting the glasses on straight.
        // A surface landing is the first moment they are demonstrably looking
        // at the table they mean to play on, so it is the honest moment to
        // decide which way the map's north points. Without this the heading
        // was whatever the first frame of the session happened to see, which
        // is why "de wereld staat niet naar mij toe gedraaid" survived the
        // fix that added a heading at all.
        if (this.camera) {
          const now = this.camera.getTransform().forward;
          this.yaw = DioramaPlacer.yawFacing(-now.x, -now.z);
        }
        this.placed = true;
        this.onSurface = true;
        print("[DioramaPlacer] placed on a surface at " +
              hit.position.x.toFixed(1) + "," + hit.position.y.toFixed(1) + "," +
              hit.position.z.toFixed(1));
      });
    } catch (e) {
      this.probing = false;
      print("[DioramaPlacer] hit test failed: " + e);
    }
  }

  isPlaced(): boolean {
    return this.placed;
  }

  /** Stop probing. Once the user has moved the world by hand, it is where they want it. */
  markPlaced(): void {
    this.placed = true;
  }
}
