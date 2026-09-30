// One input contract, four ways to satisfy it.
//
// A Game Boy game needs a D-pad, A and B, and nothing else, so that is the whole
// interface. Keeping it this narrow is what lets the same game logic run from a
// pinch in the Lens Studio preview, a phone, an Xbox pad paired to the glasses, and
// a LEAF test scenario -- none of which the game logic can tell apart.
//
// This is not a nicety. The BLE game controller does not exist in preview at all, so
// without this seam any controller-driven behaviour would be untestable.
//
// Three implementations live here; the fourth, the phone, is big enough to want its
// own file and is in MotionControllerSource.ts.

import { PadScan, KEEP_LOOKING,
         SCAN_IDLE, SCAN_LIVE, SCAN_FAILED, SCAN_GAVE_UP, SCAN_NO_MODULE,
         SCAN_WINDOW_SECONDS } from "./PadScan";

export interface DPadState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface InputSource {
  readonly name: string;
  /** Called once per frame before the game reads state. */
  update(): void;
  dpad(): DPadState;
  /** Edge-triggered: true only on the frame the button went down. */
  pressedA(): boolean;
  pressedB(): boolean;
  pressedStart(): boolean;
  /**
   * SELECT. The cartridge uses it in exactly one place we reach -- the naming
   * screen's case switch -- and that is reason enough for it to be a real
   * button rather than a `false` passed at the call site.
   */
  pressedSelect(): boolean;
  /** False while the source has no hardware attached, so the UI can say so. */
  isConnected(): boolean;
}

/**
 * One cursor move per press, with the Game Boy's own repeat.
 *
 * `dpad()` is LEVEL-triggered -- it reports true on every frame a direction is
 * held -- which is right for walking and wrong for a menu, where holding down
 * would run the cursor off the bottom of the list in a fifth of a second.
 * `pressedA()` and friends are already edge-triggered (see the interface above);
 * this is the same idea for directions, plus the delay-then-repeat the original
 * uses so a long list is still navigable by holding.
 */
export const DPAD_REPEAT_DELAY: number = 0.4;
export const DPAD_REPEAT_RATE: number = 0.12;

export class DPadEdge {
  private held: string = "";
  private heldFor: number = 0;
  private firedAt: number = 0;

  /**
   * The direction to move the cursor this frame, or "".
   *
   * Call once per frame with the real frame time. A direction fires immediately
   * on the frame it goes down, then again once it has been held past the delay,
   * then at the repeat rate.
   */
  step(pad: DPadState, dt: number): string {
    const now = pad.up ? "up" : pad.down ? "down" : pad.left ? "left" : pad.right ? "right" : "";
    if (now === "") {
      this.held = "";
      this.heldFor = 0;
      this.firedAt = 0;
      return "";
    }
    if (now !== this.held) {
      this.held = now;
      this.heldFor = 0;
      this.firedAt = 0;
      return now;
    }
    this.heldFor = this.heldFor + dt;
    if (this.heldFor < DPAD_REPEAT_DELAY) {
      return "";
    }
    if (this.heldFor - this.firedAt >= DPAD_REPEAT_RATE) {
      this.firedAt = this.heldFor;
      return now;
    }
    return "";
  }

  /** Forget what is held, so a menu that just opened does not inherit a press. */
  reset(): void {
    this.held = "";
    this.heldFor = 0;
    this.firedAt = 0;
  }
}

export function emptyDPad(): DPadState {
  return { up: false, down: false, left: false, right: false };
}

/**
 * Programmatic source. Drives the game from LEAF scenarios and from the debug
 * harness, and is the fallback whenever no real hardware answers.
 */
export class ScriptedInputSource implements InputSource {
  readonly name: string = "scripted";

  private state: DPadState = emptyDPad();
  private queuedA: boolean = false;
  private queuedB: boolean = false;
  private queuedStart: boolean = false;
  private queuedSelect: boolean = false;
  private frameA: boolean = false;
  private frameB: boolean = false;
  private frameStart: boolean = false;
  private frameSelect: boolean = false;

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
    return true;
  }

  /** Holds a direction until cleared. Pass "" to release. */
  hold(direction: string): void {
    this.state = emptyDPad();
    if (direction === "up") this.state.up = true;
    else if (direction === "down") this.state.down = true;
    else if (direction === "left") this.state.left = true;
    else if (direction === "right") this.state.right = true;
  }

  press(button: string): void {
    if (button === "a") this.queuedA = true;
    else if (button === "b") this.queuedB = true;
    else if (button === "start") this.queuedStart = true;
  }
}

/**
 * Bluetooth game controller (Xbox, SteelSeries) via the GameController package.
 *
 * Loaded defensively: the package requires Experimental APIs plus Extended
 * Permissions and does not exist in Lens Studio preview at all, so a missing
 * package must degrade to "not connected" rather than throw on startup.
 *
 * Those Experimental APIs are also why a lens using this pad cannot be published,
 * so PokemonAR only constructs it when its enableBleController input is on.
 */
/** What the pad is doing, for the lens to say out loud. See beginScan. */
/**
 * How often the adapter is asked whether the Bluetooth permission has arrived.
 *
 * The prompt is answered after the lens has started, so the answer has to be
 * noticed rather than assumed at onAwake. A second is far below what a wearer
 * perceives as a wait and far above what costs anything.
 */
export const PERMISSION_POLL_SECONDS: number = 1;

export const PAD_UNAVAILABLE: string = "unavailable";
export const PAD_SCANNING: string = "scanning";
export const PAD_CONNECTED: string = "connected";
export const PAD_FAILED: string = "failed";

export class GameControllerSource implements InputSource {
  readonly name: string = "gamepad";

  private controller: any = null;
  /**
   * Everything the pad is doing, with a name, a deadline and something to say.
   *
   * This used to be two private booleans and a string, none of which anything
   * printed: `scanning`, `failure`, `everReported`. Three fields cannot tell a
   * scan that is still running from a scan refused in its first millisecond,
   * and that is precisely the pair the wearer needed told apart. See PadScan.
   */
  private scan: PadScan = new PadScan();
  /** True once the vendor stack has been given somewhere to report to. */
  private watching: boolean = false;
  /** Seconds since the adapter was last asked whether it had woken up. */
  private permissionClock: number = 0;
  /** The address to go back to on a retry, or "" when discovery is the route. */
  private directAddress: string = "";
  /**
   * The vendor's own count of delivered HID reports as of the last frame, or
   * -1 when this stack cannot count them. See update().
   */
  private lastReports: number = -1;
  private state: DPadState = emptyDPad();
  private lastA: boolean = false;
  private lastB: boolean = false;
  private lastStart: boolean = false;
  private lastSelect: boolean = false;
  private edgeA: boolean = false;
  private edgeB: boolean = false;
  private edgeStart: boolean = false;
  private edgeSelect: boolean = false;

  /** Hands back null when no controller stack is available on this device. */
  static tryCreate(factory: () => any): GameControllerSource {
    try {
      const controller = factory();
      if (!controller) {
        return null;
      }
      const source = new GameControllerSource();
      source.controller = controller;
      return source;
    } catch (e) {
      print("GameControllerSource unavailable: " + e);
      return null;
    }
  }

  /** The machine, for whatever draws it. Read-only in practice. */
  report(): PadScan {
    return this.scan;
  }

  /**
   * Starts looking for a pad. Nothing arrives until this is called.
   *
   * This was the whole of it: the lens built the singleton and stopped there,
   * so `enableBleController` turned on a source that could never report. The
   * package only scans by itself on DISCONNECT, which cannot happen before a
   * first connection -- so the pad was unreachable however it was paired, and
   * docs/CONTROLLERS.md said "it scans and connects" describing the sample
   * rather than us. Nine minutes of holding a pairing button would never have
   * found this; the call simply is not there.
   *
   * Asynchronous and allowed to fail in two different places -- the call, and
   * the promise -- because Bluetooth is missing in preview, needs Experimental
   * APIs plus Extended Permissions on the glasses, and can be refused at any
   * point in between. Both now land in the machine, which SAYS so.
   */
  beginScan(): boolean {
    if (!this.controller) {
      this.scan.noModule("no Bluetooth controller stack on this device");
      return false;
    }
    this.hookWatcher();
    // A scan keeps looking. There is nothing to find until the wearer holds
    // the pairing button, and the tutorial's own caption says that cannot
    // happen until the lens is up: "There is no system-level pairing yet ...
    // you must wait till the lens loads before you can pair the BLE controller
    // to your specs". Snap's sample asks for a ten-thousand-second window for
    // the same reason.
    this.scan.setUnbounded(KEEP_LOOKING);
    // Ask the adapter before spending one of three attempts on it -- but only
    // refuse on a definitive NO. `Unknown` is "permissions or status have not
    // been established", and ASKING is what establishes them: treating it as a
    // refusal deadlocks the lens, because the permission is then never granted
    // and so the scan never runs. See GameController.adapterBlocked.
    //
    // NO MODULE is re-armable (PadScan.rearm) and tick() watches for the
    // adapter unblocking, so even a real refusal is a pause, not a verdict.
    // The adapter's own answer goes on the panel whatever it is, because on
    // the glasses the panel is the only place it can be read, and a scan that
    // finds nothing means something different depending on it.
    if (typeof this.controller.adapterProblem === "function") {
      try {
        const said = this.controller.adapterProblem();
        this.scan.noteAdapter(said ? said : "adapter available");
      } catch (e) {
        // An older vendor drop cannot say. The scan still runs.
      }
    }
    if (typeof this.controller.adapterBlocked === "function" &&
        this.controller.adapterBlocked()) {
      const why = typeof this.controller.adapterProblem === "function"
        ? this.controller.adapterProblem() : "Bluetooth is not available here";
      this.scan.noModule(why);
      return false;
    }
    // Every attempt after the first looks past the HID service filter. The
    // filter is why a zero can mean either "nothing is in the air" or "nothing
    // in the air advertises 0x1812", and those need telling apart on hardware.
    if (typeof this.controller.setSweep === "function") {
      try {
        // Only the MIDDLE attempt sweeps. A filtered pass is the one that can
        // adopt a nameless pad -- the filter is the platform's own answer to
        // "does this advertise HID" -- so two of the three keep the filter up,
        // and the sweep stays as the diagnostic that says whether anything is
        // in the air at all.
        this.controller.setSweep(this.scan.attempt() === 1);
      } catch (e) {
        // An older vendor drop has no sweep. The filtered scan still runs.
      }
    }
    // One number for the deadline, on both sides of the seam: the vendor's own
    // scan timeout and the countdown the wearer reads. They disagreed by a
    // factor of five hundred -- the vendor asked for 10000 seconds -- which is
    // why the scan had no observable end.
    if (typeof this.controller.setScanWindow === "function") {
      try {
        this.controller.setScanWindow(SCAN_WINDOW_SECONDS);
      } catch (e) {
        // An older vendor drop keeps its own window. The countdown is then
        // only approximately the truth, which still beats no countdown.
      }
    }
    try {
      const asked = this.controller.scanForControllers();
      this.scan.scanStarted();
      if (asked && typeof asked.then === "function") {
        asked.then(
          () => {},
          (e: any) => {
            this.scan.failed("" + e);
          }
        );
      }
      return true;
    } catch (e) {
      this.scan.failed("" + e);
      return false;
    }
  }

  /**
   * Runs the machine's clocks and takes the retries it asks for.
   *
   * Called from the top of the lens's frame, BEFORE any early return: the
   * wearer holding a pairing button is on the title screen, and the old
   * reporter sat behind six early returns that are not passed until the
   * player is walking in the overworld.
   */
  tick(dt: number): void {
    this.scan.tick(dt);
    this.watchForPermission(dt);
    // Before the scan, always: a link we are holding keeps the pad off the
    // air, so scanning while still attached is scanning for something we are
    // ourselves silencing. See PadScan.takeReleaseRequest.
    if (this.scan.takeReleaseRequest() && this.controller &&
        typeof this.controller.releaseLink === "function") {
      this.controller.releaseLink(this.scan.reason());
    }
    if (this.scan.takeScanRequest()) {
      if (this.directAddress) {
        this.connectDirectly(this.directAddress);
      } else {
        this.beginScan();
      }
    }
    // An address that has spent its attempts hands over to the scan. The
    // address is the shortcut for when discovery cannot find the pad; it must
    // not become the reason discovery is never tried.
    if (this.directAddress && this.scan.state() === SCAN_GAVE_UP) {
      print("[pad] the address gave no answer; looking for it instead");
      this.directAddress = "";
      this.scan.rearm();
    }
  }

  /**
   * Connects to a pad at a known address, without scanning.
   *
   * The machine is driven exactly as a scan drives it -- the vendor stack
   * reports through the same watcher -- so the panel and the log say the same
   * things about a direct connection as about a found one. The only difference
   * is that nothing was searched for.
   */
  connectDirectly(address: string): void {
    if (!this.controller) {
      this.scan.noModule("no Bluetooth controller stack on this device");
      return;
    }
    // Remembered, so every RETRY goes back to the address as well. Without
    // this the first attempt used it and the machine's own retry fell through
    // to beginScan() -- scanning for a pad we had just been told cannot be
    // found by scanning, which is the whole reason an address was given.
    this.directAddress = address;
    this.hookWatcher();
    // A direct connection either answers or it does not, so this one IS
    // bounded -- and when the budget runs out it falls back to scanning rather
    // than dead-ending on an address that is not answering.
    this.scan.setUnbounded(false);
    if (typeof this.controller.connectToAddress !== "function") {
      this.scan.failed("this build cannot connect by address");
      return;
    }
    // Counted against the same budget as a scan. Without this `tries` stayed
    // at zero, MAX_ATTEMPTS never tripped, and the direct path retried every
    // five seconds for as long as the lens ran -- which is exactly what the
    // 5.15 log showed for a day.
    this.scan.scanStarted();
    this.scan.connecting(address);
    try {
      const asked = this.controller.connectToAddress(address);
      if (asked && typeof asked.then === "function") {
        asked.then(
          (ok: boolean) => {
            if (!ok) {
              this.scan.failed("nothing answered at " + address);
            }
          },
          (e: any) => {
            this.scan.failed("" + e);
          }
        );
      }
    } catch (e) {
      this.scan.failed("" + e);
    }
  }

  /**
   * The wearer asks for another go: the OPTION menu's PAD row, and anything
   * else that wants to put the pad back in play.
   *
   * Three attempts inside the first seventy seconds of the lens is the whole
   * budget, and it is spent while the glasses are still going on. Without this
   * the pad is unreachable for the rest of the session however it behaves.
   */
  retry(): void {
    this.scan.rearm();
  }

  /**
   * Bluetooth permission is answered AFTER the lens has started.
   *
   * So "no Bluetooth here" is a snapshot of a permission, not a property of
   * the device, and a lens that treats it as final refuses a pad that became
   * reachable two seconds later. Polled once a second rather than per frame:
   * reading the adapter is a call across the runtime boundary and nothing here
   * changes at frame rate.
   */
  private watchForPermission(dt: number): void {
    if (this.scan.state() !== SCAN_NO_MODULE || !this.controller) {
      return;
    }
    if (typeof this.controller.adapterBlocked !== "function") {
      return;
    }
    this.permissionClock = this.permissionClock + dt;
    if (this.permissionClock < PERMISSION_POLL_SECONDS) {
      return;
    }
    this.permissionClock = 0;
    let blocked = true;
    try {
      blocked = this.controller.adapterBlocked() === true;
    } catch (e) {
      return;
    }
    if (!blocked) {
      this.scan.rearm();
    }
  }

  /**
   * What it is doing, coarsely, for callers that only want the old four names.
   *
   * CONNECTED means REPORTING, not "a controller object exists" -- see the
   * note at the top of PadScan for why those are different things and why the
   * difference cost the wearer his D-pad.
   */
  padState(): string {
    const now = this.scan.state();
    if (now === SCAN_LIVE) {
      return PAD_CONNECTED;
    }
    if (now === SCAN_FAILED || now === SCAN_GAVE_UP || now === SCAN_NO_MODULE) {
      return PAD_FAILED;
    }
    if (now === SCAN_IDLE) {
      return PAD_UNAVAILABLE;
    }
    return PAD_SCANNING;
  }

  /**
   * Whether this is Lens Studio's preview rather than the glasses.
   *
   * Said out loud at startup, because half the pad logs read this week were
   * from preview and looked exactly like device logs -- and preview has no
   * radio, so a pad line from it is not evidence of anything.
   */
  inEditorNow(): boolean {
    if (!this.controller || typeof this.controller.inEditor !== "function") {
      return false;
    }
    try {
      return this.controller.inEditor() === true;
    } catch (e) {
      return false;
    }
  }

  /** Why it failed, or "". For the log, and now for the panel too. */
  problem(): string {
    return this.scan.reason();
  }

  update(): void {
    this.edgeA = false;
    this.edgeB = false;
    this.edgeStart = false;
    this.edgeSelect = false;
    if (!this.controller) {
      return;
    }
    let buttons: any = null;
    try {
      buttons = this.controller.getButtonState();
    } catch (e) {
      return;
    }
    if (!buttons) {
      return;
    }
    this.noteReports();

    // Accept either the D-pad or the left stick, so a pad held loosely still works.
    const stickX = typeof buttons.lx === "number" ? buttons.lx : 0;
    const stickY = typeof buttons.ly === "number" ? buttons.ly : 0;
    const deadZone = 0.5;
    // The stick's Y is inverted against the map. Joshua, 10 September, with a
    // pad finally live on the glasses: "ik merkte wel dat de linker joystick de
    // up en down movement andersom hebben."
    //
    // Which way round a stick reports is a property of the hardware and its
    // report layout, not something that can be reasoned out from here -- it
    // took a working controller in someone's hands to find, and that is the
    // only way it could have been found. The D-pad was always right, so this
    // is the analogue axis alone.
    this.state = {
      up: buttons.dUp === true || stickY < -deadZone,
      down: buttons.dDown === true || stickY > deadZone,
      left: buttons.dLeft === true || stickX < -deadZone,
      right: buttons.dRight === true || stickX > deadZone,
    };

    const a = buttons.a === true;
    const b = buttons.b === true;
    const start = buttons.start === true;
    // The pad's View/Back button, which is where SELECT lives on every layout
    // this package knows about (ButtonState: "View/Back/Select button").
    const select = buttons.view === true;
    this.edgeA = a && !this.lastA;
    this.edgeB = b && !this.lastB;
    this.edgeStart = start && !this.lastStart;
    this.edgeSelect = select && !this.lastSelect;
    this.lastA = a;
    this.lastB = b;
    this.lastStart = start;
    this.lastSelect = select;
  }

  dpad(): DPadState {
    return this.state;
  }

  pressedA(): boolean {
    return this.edgeA;
  }

  pressedB(): boolean {
    return this.edgeB;
  }

  pressedStart(): boolean {
    return this.edgeStart;
  }

  pressedSelect(): boolean {
    return this.edgeSelect;
  }

  isConnected(): boolean {
    return this.controller !== null && this.scan.isLive();
  }

  /** Short buzz on an event worth feeling, ignored when unsupported. */
  rumble(power: number, durationMs: number): void {
    if (!this.controller) {
      return;
    }
    try {
      this.controller.sendRumble(power, durationMs);
    } catch (e) {
      // Not every pad has a motor; silence is the correct outcome.
    }
  }

  // ------------------------------------------------------------------ private

  /**
   * Counts what the pad has actually SENT, and only then calls it connected.
   *
   * Holding a controller OBJECT is not the same as having a pad attached, and
   * the vendor stack makes that object the moment a matching device NAME turns
   * up in an advertisement -- before connectGatt is even called. Its
   * constructor fills an all-false ButtonState, so getButtonState() answers an
   * object for a pad that has never spoken, this source called that connected,
   * won the router, and swallowed the D-pad, B and START while the character
   * stood still.
   *
   * A stack that can count its delivered HID reports is asked for that count.
   * One that cannot -- a fake in a test, an older vendor drop -- falls back to
   * the old test rather than reporting nothing at all, but is only ever
   * credited with the single report that made it live, so the panel does not
   * claim thousands.
   */
  private noteReports(): void {
    let total = -1;
    if (typeof this.controller.reportCount === "function") {
      try {
        const n = this.controller.reportCount();
        total = typeof n === "number" ? n : -1;
      } catch (e) {
        total = -1;
      }
    }
    if (total < 0) {
      if (!this.scan.isLive()) {
        this.scan.padReported(1);
      }
      return;
    }
    if (this.lastReports < 0) {
      this.lastReports = 0;
    }
    if (total > this.lastReports) {
      this.scan.padReported(total - this.lastReports);
      this.lastReports = total;
    }
  }

  /** Gives the vendor stack somewhere to report to. Once. */
  private hookWatcher(): void {
    if (this.watching || !this.controller) {
      return;
    }
    if (typeof this.controller.watch !== "function") {
      return;
    }
    try {
      this.controller.watch((kind: string, detail: string, rssi: number) => {
        this.onPadEvent(kind, detail, rssi);
      });
      this.watching = true;
    } catch (e) {
      // An older vendor drop cannot report its progress. The machine then runs
      // on its own clocks alone, which still ends, and still says so.
    }
  }

  private onPadEvent(kind: string, detail: string, rssi: number): void {
    if (kind === "seen") {
      this.scan.deviceSeen(detail, rssi);
    } else if (kind === "connecting") {
      this.scan.connecting(detail);
    } else if (kind === "linked") {
      this.scan.linked(detail);
    } else if (kind === "ready") {
      // The handshake finished and a notification registration exists. The
      // link stops being on the clock here; a subscribed pad is allowed to lie
      // still. See PadScan.subscribedTo.
      this.scan.subscribedTo(detail);
    } else if (kind === "relink") {
      // The link dropped and the vendor file is taking the same one back
      // without a scan. The machine waits rather than restarting: see
      // SCAN_RELINKING, and GameController.relink for what is actually
      // happening on the radio (nothing).
      this.scan.relinking(detail);
    } else if (kind === "lost") {
      this.scan.lost(detail);
    } else if (kind === "error") {
      this.scan.failed(detail);
    }
  }
}

/**
 * Picks whichever source is actually answering, preferring real hardware, and
 * re-checks each frame so a pad paired mid-session takes over without a restart.
 */
/**
 * What the router needs of a route: whether it is walking, its d-pad, the one
 * A it presses when it has turned to face what was pinched, and a way to stop
 * it.
 */
export interface RouteLike {
  isActive(): boolean;
  dpad(): DPadState;
  pressedA(): boolean;
  cancel(): void;
}

export class InputRouter implements InputSource {
  readonly name: string = "router";

  private sources: InputSource[] = [];
  private active: InputSource = null;
  /**
   * A source whose BUTTONS are added to whichever source is winning, rather
   * than competing with it.
   *
   * The router picks one source and one only, which is right for the four
   * things that supply a whole controller and wrong for a pinch. A pinch is
   * one button. It has to work while the phone is driving the walk, while a
   * pad is driving the walk, and on its own -- so it is layered rather than
   * ranked, and it reports no d-pad at all so it can never take the walk over.
   */
  private overlay: InputSource = null;
  /**
   * A route that walks the d-pad for the wearer -- pinch-to-walk, see
   * RouteSource. Neither a source nor the overlay: while it has cells left it
   * OWNS the d-pad, and the moment a real thumb holds a direction it is
   * cancelled, so a wearer who changes their mind mid-walk simply walks. It
   * never presses a button.
   */
  private route: RouteLike = null;
  /**
   * The hand as a joystick (StickSource): a held pinch that owns the d-pad
   * for as long as it is held. It outranks a route -- a hand that takes
   * the stick mid-walk has changed its mind -- and, like the route, it
   * never presses a button.
   */
  private stick: RouteLike = null;

  constructor(sources: InputSource[]) {
    this.sources = sources;
    // Nothing is active until a source reports. Starting on sources[0] made
    // the status read "[gamepad]" with no pad anywhere near the glasses.
    this.active = null;
  }

  /** Adds a source's buttons to every other source's. See `overlay`. */
  setOverlay(source: InputSource): void {
    this.overlay = source;
  }

  /** Lets a route walk the d-pad until a real direction or its end. See `route`. */
  setRoute(route: RouteLike): void {
    this.route = route;
  }

  /** Lets a held pinch hold the d-pad. See `stick`. */
  setStick(stick: RouteLike): void {
    this.stick = stick;
  }

  update(): void {
    if (this.overlay) {
      this.overlay.update();
    }
    for (let i = 0; i < this.sources.length; i++) {
      this.sources[i].update();
    }
    for (let i = 0; i < this.sources.length; i++) {
      if (this.sources[i].isConnected()) {
        this.active = this.sources[i];
        break;
      }
    }
    if (this.route && this.route.isActive() && this.active) {
      const real = this.active.dpad();
      if (real.up || real.down || real.left || real.right) {
        this.route.cancel();
      }
    }
    if (this.route && this.route.isActive() && this.stick && this.stick.isActive()) {
      this.route.cancel();
    }
  }

  activeName(): string {
    return this.active ? this.active.name : "none";
  }

  dpad(): DPadState {
    if (this.stick && this.stick.isActive()) {
      return this.stick.dpad();
    }
    if (this.route && this.route.isActive()) {
      return this.route.dpad();
    }
    return this.active ? this.active.dpad() : emptyDPad();
  }

  pressedA(): boolean {
    if (this.overlay && this.overlay.pressedA()) {
      return true;
    }
    // A route's A: the talk at the end of a pinch on a person or a sign.
    if (this.route && this.route.isActive() && this.route.pressedA()) {
      return true;
    }
    return this.active ? this.active.pressedA() : false;
  }

  pressedB(): boolean {
    if (this.overlay && this.overlay.pressedB()) {
      return true;
    }
    return this.active ? this.active.pressedB() : false;
  }

  pressedStart(): boolean {
    if (this.overlay && this.overlay.pressedStart()) {
      return true;
    }
    return this.active ? this.active.pressedStart() : false;
  }

  pressedSelect(): boolean {
    if (this.overlay && this.overlay.pressedSelect()) {
      return true;
    }
    return this.active ? this.active.pressedSelect() : false;
  }

  isConnected(): boolean {
    return this.active !== null;
  }
}

/**
 * A pinch, as the A button.
 *
 * Reading a page of text is most of playing this game, and until now every one
 * of those presses needed hardware: a pad, a phone, or a hand reaching for the
 * button plate. A pinch is the one gesture Spectacles gives you for free, both
 * hands, no setup -- so it is A.
 *
 * It reports NO d-pad, deliberately, and the router adds it to whatever else
 * is driving rather than choosing between them. A source that answered the
 * d-pad would win the router with a controller in the wearer's hands and then
 * refuse to walk.
 *
 * Nothing here touches hand tracking: DioramaHands already has the hands, and
 * a second reader of the same API is a second thing to go wrong. It calls
 * tap() and this remembers it for exactly one frame.
 */
export class PinchSource implements InputSource {
  readonly name: string = "pinch";

  private pending: boolean = false;
  private firing: boolean = false;
  private everTapped: boolean = false;

  /** A pinch happened. Reported on the NEXT update, once. */
  tap(): void {
    this.pending = true;
    this.everTapped = true;
  }

  update(): void {
    this.firing = this.pending;
    this.pending = false;
  }

  dpad(): DPadState {
    return emptyDPad();
  }

  pressedA(): boolean {
    return this.firing;
  }

  pressedB(): boolean {
    return false;
  }

  pressedStart(): boolean {
    return false;
  }

  pressedSelect(): boolean {
    return false;
  }

  /**
   * Whether a pinch has ever arrived.
   *
   * Only for the status line and the boot report. The ROUTER never asks: an
   * overlay is added to the winner rather than competing to be one, which is
   * the whole reason a one-button source can exist at all.
   */
  isConnected(): boolean {
    return this.everTapped;
  }
}
