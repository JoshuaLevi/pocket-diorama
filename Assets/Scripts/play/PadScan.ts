// What the Bluetooth pad is doing, as a state machine that is never silent.
//
// The pad had one observable state and it was "starting scan...". After that
// the lens said nothing, ever, for any outcome:
//
//   - the scan window was 10000 seconds -- two hours and forty-seven minutes,
//     against 10 in Snap's own current BLE-HID sample -- so the promise that
//     resolves when a scan ENDS never resolved, and "scan complete" never
//     printed;
//   - both failure paths wrote their reason into a private field and printed
//     nothing, so a scan refused in the first millisecond and a scan still
//     running produced exactly the same log;
//   - and the one function that spoke that field ran inside onUpdate behind
//     six early returns, none of which are passed until the player is walking
//     in the overworld. The wearer holding the pairing button is standing on
//     the title screen, where it never ran at all.
//
// So the first fix is not a guess at the radio. It is a state with a name, a
// deadline, and something to say -- for every outcome, including the ones we
// cannot fix. This file holds all of it and nothing else: no Lens Studio, no
// Bluetooth, no scene. GameControllerSource feeds it what the vendor stack
// reports; the lens draws lines() on a panel and prints logLine().
//
// The one rule worth stating on its own: A CONTROLLER OBJECT IS NOT A PAD.
// The vendor code builds its controller the moment a matching device NAME is
// seen in an advertisement, before any GATT link exists, and that object
// answers getButtonState() with an all-false default. Every layer above then
// believed a pad was attached. Only a delivered HID report proves one is, so
// LINKED and LIVE are two different states here and only LIVE drives the game.

/** No one has asked for a pad yet. */
export const SCAN_IDLE: string = "idle";
/** There is no Bluetooth stack here at all: preview, or permissions off. */
export const SCAN_NO_MODULE: string = "no-module";
/** A scan is running, and has a deadline. */
export const SCAN_SCANNING: string = "scanning";
/** The radio has produced at least one advertisement. */
export const SCAN_SEEN: string = "seen";
/** A GATT connection has been asked for. */
export const SCAN_CONNECTING: string = "connecting";
/** The GATT link is up. Not the same as a pad that is reporting. */
export const SCAN_LINKED: string = "linked";
/** HID reports are arriving. This, and only this, is a pad. */
export const SCAN_LIVE: string = "live";
/**
 * The link dropped and the SAME connection is being taken back, without a scan.
 *
 * Between LIVE and FAILED, and it exists because the pad drops its link every
 * sixteen to thirty seconds for reasons nothing in this project has been able
 * to establish. Treating that as a loss meant a sixty-second scan twice a
 * minute -- "ik moet constant de controller opnieuw verbinden". The vendor
 * file now calls BluetoothGatt.connect() instead, which needs no radio and no
 * pairing button, and this is the state the machine waits in while it lands.
 *
 * It has a deadline like every other state here. A relink that does not come
 * back inside RELINK_WINDOW_SECONDS falls through to FAILED and the scan
 * behind it, so a pad that has genuinely gone is still found out.
 */
export const SCAN_RELINKING: string = "relinking";
/** Something said no, and said why. Retried. */
export const SCAN_FAILED: string = "failed";
/** The scan window ran out with nothing to connect to. Retried. */
export const SCAN_TIMED_OUT: string = "timed-out";
/** The attempts are spent. Terminal, and says what to use instead. */
export const SCAN_GAVE_UP: string = "gave-up";

/**
 * Every state, so a test can prove each one is reachable and each one speaks.
 * A state that cannot be reached is a state that cannot be reported either.
 */
export const SCAN_STATES: string[] = [
  SCAN_IDLE, SCAN_NO_MODULE, SCAN_SCANNING, SCAN_SEEN, SCAN_CONNECTING,
  SCAN_LINKED, SCAN_LIVE, SCAN_RELINKING, SCAN_FAILED, SCAN_TIMED_OUT,
  SCAN_GAVE_UP,
];

/**
 * How long one scan may run.
 *
 * Snap's GameController sample asks for ten thousand seconds -- two hours and
 * forty-seven minutes -- and that is not the oversight it looks like. In the
 * sample the scan is never meant to end on its own: the predicate connects and
 * returns nothing, so the radio keeps looking, and stopScan() is called when
 * the connection arrives. "Until it is found" is the design.
 *
 * A lens cannot copy the number, because a promise that never settles is a
 * wearer who is never told anything -- that was the pad's entire observable
 * history before 9 September. But twenty seconds was the opposite mistake. A
 * wearer has to notice the panel, understand it, find the pad, and hold its
 * pairing button until the light flashes fast; twenty seconds is gone before
 * the third of those. Sixty is long enough to actually do it and still short
 * enough to end where the wearer can see it end.
 */
export const SCAN_WINDOW_SECONDS: number = 60;
/**
 * How long a connection may take before it counts as no answer.
 *
 * Thirty, not fifteen. On 5.15 -- the version that builds the lens that goes
 * on the glasses -- connectGatt returns before the device is connected, and
 * the connection is announced later on onConnectionStateChangedEvent. What
 * happens in between includes bonding. A deadline shorter than that does not
 * detect a dead connection, it CAUSES one, by giving up on a link that was
 * still being made.
 */
export const CONNECT_WINDOW_SECONDS: number = 30;
/**
 * How long a silent relink may take before the drop is treated as a loss.
 *
 * Much shorter than CONNECT_WINDOW_SECONDS, and for a reason that is not
 * impatience: a relink is not a connection being MADE. The device is already
 * known, already bonded, already has its services enumerated -- the stack is
 * being asked to re-establish a link it had a moment ago. That either happens
 * within a few advertising intervals or the pad is not there to answer, and
 * the difference between those two is worth finding out quickly, because
 * behind this state sits the sixty-second scan that actually looks.
 */
export const RELINK_WINDOW_SECONDS: number = 10;
/**
 * How long a link may exist without a subscription behind it.
 *
 * LINKED was the one state in this machine with no deadline, and on
 * 10 September that is what turned a single swallowed exception into a dead
 * session. gatt.getService() threw inside a fire-and-forget async call, so
 * there was no log line and no error event; the link stayed up, the vendor
 * file's own `linked` flag stayed true, and this machine sat here:
 *
 *   16:42:00.717  linked: Xbox Wireless Controller
 *   16:42:04.642  [pad] linked try=1/3 seen=1 reports=0
 *   16:42:14.651  [pad] linked try=1/3 seen=1 reports=0
 *
 * ...for as long as the wearer was willing to look at it. Every other state
 * here ends by itself. This one now does too.
 *
 * Twelve seconds. The handshake took 1.8s on the connection that worked and
 * 0.8s on the one after it, so twelve is nearly seven times the worst measured
 * case -- long enough that a slow link is never mistaken for a dead one, short
 * enough to be over before a wearer has finished wondering.
 *
 * It stops at the SUBSCRIPTION, not at the first report. A pad that has been
 * subscribed to and is merely being held still is a working pad, and putting a
 * clock on the wearer's thumb would be the wrong reading entirely. See
 * subscribedTo().
 */
export const LINK_WINDOW_SECONDS: number = 12;
/** The pause between one attempt and the next. */
export const RETRY_GAP_SECONDS: number = 5;
/** How many scans one session gets before it says so and stops. */
export const MAX_ATTEMPTS: number = 3;

/**
 * Whether a scan that has found nothing keeps looking anyway.
 *
 * Snap's own sample asks for a scan window of TEN THOUSAND SECONDS and stops
 * it from the connection: "scan until found" is the design, and the tutorial
 * video says why in a caption on screen --
 *
 *   "NOTE: There is no system-level pairing yet. This means you must wait till
 *    the lens loads before you can pair the BLE controller to your specs!"
 *
 * There is nothing to find until the wearer holds the pairing button, and that
 * happens AFTER the lens is up. A budget of three attempts assumed the pad was
 * already there to be found; it is not, and a lens that has stopped looking by
 * the time the wearer is ready has answered a question nobody asked.
 *
 * Bounded again the moment a pad has ever reported: a pad that dropped out is
 * a different thing from one that was never there (see `lost`).
 */
export const KEEP_LOOKING: boolean = true;
/** How many of the last sightings the panel lists. */
export const SEEN_KEPT: number = 6;

/**
 * The line that is on the panel in every state, including the good ones.
 *
 * A pinch is A and the phone is the publishable controller, so there is always
 * a way to play. Printing that only once the pad has failed is printing it too
 * late: the wearer has already spent two minutes on a pairing button.
 */
export const FALLBACK_LINE: string = "Pinch = A. Phone: Spectacles App > Controller.";

/** How a sighting is written on the panel. Exported for the same reason. */
export function sightingLine(name: string, rssi: number): string {
  const named = name && name.length > 0 ? name : "NO NAME";
  const signal = typeof rssi === "number" ? rssi + " dBm" : "signal unknown";
  return named + "  " + signal;
}

export class PadScan {
  private phase: string = SCAN_IDLE;
  /** Counts down while a silent relink is in flight. See SCAN_RELINKING. */
  private relinkClock: number = 0;
  /** Counts down while a link exists with no subscription. See LINK_WINDOW_SECONDS. */
  private linkClock: number = 0;
  /** Set when the link should be handed back to the pad. See takeReleaseRequest. */
  private pendingRelease: boolean = false;
  private why: string = "";
  /** What the adapter said when a scan was last asked for. See noteAdapter. */
  private adapterNote: string = "";
  /** Whether the attempt budget applies at all. See KEEP_LOOKING. */
  private unbounded: boolean = false;
  /** The device currently being connected to, for the title. */
  private device: string = "";
  private tries: number = 0;
  private reports: number = 0;
  private scanClock: number = 0;
  private connectClock: number = 0;
  private gapClock: number = 0;
  private pendingScan: boolean = false;
  private sightings: string[] = [];
  /**
   * How many advertisements have arrived, as opposed to how many are still on
   * the panel.
   *
   * The panel said "N SEEN" and N was the length of the KEPT list, which is
   * capped -- so a scan that saw four devices and a scan that saw forty both
   * read as the cap, for ever. That is the difference between "the room is
   * quiet, your pad is not advertising" and "the room is full and yours is not
   * in the part we can still show you", which is exactly the question a wearer
   * is trying to answer.
   */
  private seenTotal: number = 0;
  private version: number = 0;
  /** The countdown as last shown, so a frame passing is not a change. */
  private shownSecond: number = -1;

  // ------------------------------------------------------------------ reading

  state(): string {
    return this.phase;
  }

  /**
   * What the Bluetooth adapter itself said, kept across attempts.
   *
   * Separate from `why`, which a scan clears when it starts. The adapter's
   * status is the one number that says where to look next when a scan finds
   * nothing -- refused, off, or simply never asked -- and on the glasses the
   * only place it can be read is this panel. It has to survive the scan that
   * follows it.
   */
  noteAdapter(text: string): void {
    const next = text ? text : "";
    if (next === this.adapterNote) {
      return;
    }
    this.adapterNote = next;
    this.version = this.version + 1;
  }

  /** What the adapter said, or "". */
  adapter(): string {
    return this.adapterNote;
  }

  /** Why it failed, verbatim, or "". Goes on the panel as well as the log. */
  reason(): string {
    return this.why;
  }

  /** How many scans have been STARTED this session. */
  attempt(): number {
    return this.tries;
  }

  /** How many HID reports have arrived. Zero is the whole point of LINKED. */
  reportCount(): number {
    return this.reports;
  }

  /** Seconds left in the running scan, or 0 when none is running. */
  secondsLeft(): number {
    if (this.phase !== SCAN_SCANNING && this.phase !== SCAN_SEEN) {
      return 0;
    }
    return this.scanClock > 0 ? this.scanClock : 0;
  }

  /** How many advertisements have arrived this session. */
  seenCount(): number {
    return this.seenTotal;
  }

  /** The last few sightings, oldest first. */
  seen(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.sightings.length; i++) {
      out.push(this.sightings[i]);
    }
    return out;
  }

  /** One sighting, written the way the panel writes it. */
  sighting(name: string, rssi: number): string {
    return sightingLine(name, rssi);
  }

  /**
   * Whether something is actually happening: a scan running, or a connection
   * being made.
   *
   * What the pad's PANEL is gated on. It used to be gated on "not live", which
   * on a lens with no controller is for ever -- the notice sat over the game
   * permanently and became scenery. A notice earns its place while there is
   * something to watch and not a second longer.
   */
  isSearching(): boolean {
    return this.phase === SCAN_SCANNING || this.phase === SCAN_SEEN ||
           this.phase === SCAN_CONNECTING || this.phase === SCAN_LINKED;
  }

  /**
   * Keep looking past the budget, or do not.
   *
   * On for a SCAN, because there is nothing to find until the wearer holds the
   * pairing button and that happens after the lens is up. Off for a direct
   * connection to an address, which either answers or does not: retrying that
   * for ever is hammering, and it is what filled a whole log file.
   */
  setUnbounded(on: boolean): void {
    this.unbounded = on === true;
  }

  /** A pad is live when it has REPORTED, never merely when it has connected. */
  isLive(): boolean {
    return this.phase === SCAN_LIVE;
  }

  /** Bumped when the panel would read differently. See shownSecond. */
  stateVersion(): number {
    return this.version;
  }

  // ------------------------------------------------------------------ events

  /** No Bluetooth stack on this device. Terminal: there is nothing to retry. */
  noModule(why: string): void {
    this.enter(SCAN_NO_MODULE);
    this.why = why;
  }

  /** A scan has just been started. */
  scanStarted(): void {
    if (this.phase === SCAN_NO_MODULE || this.phase === SCAN_GAVE_UP) {
      return;
    }
    this.tries = this.tries + 1;
    this.scanClock = SCAN_WINDOW_SECONDS;
    this.connectClock = 0;
    this.gapClock = 0;
    this.pendingScan = false;
    this.why = "";
    this.shownSecond = Math.ceil(SCAN_WINDOW_SECONDS);
    this.enter(SCAN_SCANNING);
  }

  /**
   * The radio produced an advertisement.
   *
   * Recorded whatever the state, because "the glasses see nothing" and "the
   * glasses see it and cannot talk to it" are the two answers this whole
   * exercise exists to tell apart, and only the list of sightings does that.
   */
  deviceSeen(name: string, rssi: number): void {
    this.seenTotal = this.seenTotal + 1;
    this.sightings.push(sightingLine(name, rssi));
    while (this.sightings.length > SEEN_KEPT) {
      this.sightings.shift();
    }
    this.version = this.version + 1;
    if (this.phase === SCAN_SCANNING) {
      this.enter(SCAN_SEEN);
    }
  }

  connecting(name: string): void {
    if (this.phase === SCAN_NO_MODULE) {
      return;
    }
    this.device = name && name.length > 0 ? name : "NO NAME";
    this.connectClock = CONNECT_WINDOW_SECONDS;
    this.enter(SCAN_CONNECTING);
  }

  /** The GATT link is up. Still not a pad; see the note at the top. */
  linked(name: string): void {
    if (this.phase === SCAN_NO_MODULE) {
      return;
    }
    this.device = name && name.length > 0 ? name : "NO NAME";
    this.connectClock = 0;
    // The handshake starts now, and it has to finish. See LINK_WINDOW_SECONDS.
    this.linkClock = LINK_WINDOW_SECONDS;
    this.enter(SCAN_LINKED);
  }

  /**
   * The handshake finished and something is listening on the pad.
   *
   * Stops the link clock and nothing else: the machine stays LINKED, because
   * LINKED to LIVE is a HID REPORT and only a report. What changes is that
   * waiting is now legitimate -- a subscribed pad lying still on a table is a
   * working pad, and it may lie there all evening.
   */
  subscribedTo(name: string): void {
    if (this.phase !== SCAN_LINKED) {
      return;
    }
    if (name && name.length > 0) {
      this.device = name;
    }
    this.linkClock = 0;
    this.version = this.version + 1;
  }

  /**
   * Whether the link should be handed back to the pad, once.
   *
   * Drained exactly like takeScanRequest, by the source that owns the vendor
   * stack -- this file knows nothing about GATT and must not start knowing.
   * It is set when a link has failed to become a working one, because a link
   * we are holding and not using is worse than no link at all: a connected
   * BLE peripheral does not advertise, so the scan that follows would be
   * looking for a pad that we ourselves are keeping silent.
   */
  takeReleaseRequest(): boolean {
    if (!this.pendingRelease) {
      return false;
    }
    this.pendingRelease = false;
    return true;
  }

  /**
   * A HID report arrived. Ground truth, and it outranks the story: the vendor
   * stack can reconnect to an already-bonded pad without us observing any of
   * the steps in between.
   */
  padReported(howMany: number = 1): void {
    if (this.phase === SCAN_NO_MODULE) {
      return;
    }
    this.reports = this.reports + (howMany > 0 ? howMany : 1);
    this.why = "";
    this.enter(SCAN_LIVE);
    // The count is on the panel, so every report is a change.
    this.version = this.version + 1;
  }

  /**
   * The link dropped and is being taken back, silently. See SCAN_RELINKING.
   *
   * Only from a link that existed. A relink reported from anywhere else would
   * be the vendor file and this machine disagreeing about whether there was
   * ever a pad, and the machine's own history is the one the panel shows.
   */
  relinking(name: string): void {
    if (this.phase !== SCAN_LINKED && this.phase !== SCAN_LIVE &&
        this.phase !== SCAN_RELINKING) {
      return;
    }
    if (name && name.length > 0) {
      this.device = name;
    }
    this.relinkClock = RELINK_WINDOW_SECONDS;
    this.enter(SCAN_RELINKING);
  }

  failed(reason: string): void {
    if (this.phase === SCAN_NO_MODULE || this.phase === SCAN_GAVE_UP) {
      return;
    }
    // If a LINK existed, it has to be handed back before anything scans.
    //
    // One rule, in one place, because there turned out to be three ways to
    // arrive here from a live link and only two of them had remembered: the
    // handshake deadline, the relink deadline, and -- the one that was missed
    // -- the vendor file reporting an error on a link it had already given up
    // on. That third path is exactly the 16:42 failure, so leaving it out
    // would have fixed the wedge and kept the symptom: a scan running while we
    // still held the pad, looking for something we were ourselves keeping off
    // the air.
    if (this.phase === SCAN_LINKED || this.phase === SCAN_LIVE ||
        this.phase === SCAN_RELINKING) {
      this.pendingRelease = true;
    }
    this.why = reason && reason.length > 0 ? reason : "no reason given";
    this.gapClock = 0;
    this.pendingScan = false;
    this.enter(SCAN_FAILED);
  }

  /**
   * A pad that was connected has gone.
   *
   * The attempt budget starts over: a pad that has already spoken demonstrably
   * exists and is worth chasing, unlike one that was never there. The budget
   * still bounds what happens next, so this cannot loop for ever.
   */
  lost(reason: string): void {
    if (this.phase !== SCAN_LINKED && this.phase !== SCAN_LIVE &&
        this.phase !== SCAN_RELINKING) {
      return;
    }
    this.tries = 0;
    this.reports = 0;
    this.failed(reason);
  }

  /**
   * The wearer asks for another go.
   *
   * The whole budget is spent in the first seventy seconds of the lens --
   * three twenty-second windows and two five-second gaps -- and GAVE UP was
   * terminal. A wearer who is still putting the glasses on, who answers the
   * Bluetooth permission prompt after the lens has started, or who simply had
   * not thought to hold the pad's pairing button yet, had missed it: the pad
   * was unreachable for the rest of the session however the pad behaved. Three
   * chances inside the first minute is not a budget, it is a trap door.
   *
   * NO MODULE is re-armable for the same reason and a sharper one. It is what
   * Lens Studio preview always reports, because preview has no radio at all --
   * but it is also what the glasses report until the permission is granted,
   * and that answer arrives after onAwake. A state derived from a permission
   * cannot be terminal when the permission can change.
   *
   * What this does NOT do is disturb a run in progress. A scan that is still
   * counting down, a connection being made, or a pad that is already reporting
   * are all left exactly as they are: the panel is showing the countdown, and
   * a wearer pressing RETRY at second twelve means "get on with it", not
   * "start over". Only the machine's own dead ends are opened.
   */
  rearm(): void {
    // seenTotal deliberately survives: it is a count for the SESSION, and the
    // wearer reading it wants to know whether the room has ever been quiet.
    if (this.phase === SCAN_SCANNING || this.phase === SCAN_SEEN ||
        this.phase === SCAN_CONNECTING || this.phase === SCAN_LINKED ||
        this.phase === SCAN_LIVE || this.phase === SCAN_RELINKING) {
      return;
    }
    this.tries = 0;
    this.why = "";
    this.scanClock = 0;
    this.connectClock = 0;
    this.gapClock = 0;
    this.shownSecond = -1;
    this.enter(SCAN_IDLE);
    // Asked for after the state change, so a caller that reads the state and
    // the request in the same frame sees a machine that agrees with itself.
    this.pendingScan = true;
    this.version = this.version + 1;
  }

  // ------------------------------------------------------------------- clock

  tick(dt: number): void {
    if (dt <= 0) {
      return;
    }
    if (this.phase === SCAN_SCANNING || this.phase === SCAN_SEEN) {
      this.scanClock = this.scanClock - dt;
      if (this.scanClock <= 0) {
        this.scanClock = 0;
        this.enter(SCAN_TIMED_OUT);
        return;
      }
      const second = Math.ceil(this.scanClock);
      if (second !== this.shownSecond) {
        this.shownSecond = second;
        this.version = this.version + 1;
      }
      return;
    }
    if (this.phase === SCAN_CONNECTING) {
      this.connectClock = this.connectClock - dt;
      if (this.connectClock <= 0) {
        this.connectClock = 0;
        this.failed("the pad never answered the connection");
      }
      return;
    }
    if (this.phase === SCAN_LINKED) {
      if (this.linkClock <= 0) {
        return;
      }
      this.linkClock = this.linkClock - dt;
      if (this.linkClock <= 0) {
        this.linkClock = 0;
        // Hand it back BEFORE the scan is asked for: the pad cannot be found
        // again while we are still holding it.
        this.lost("linked, but the pad never finished its handshake");
      }
      return;
    }
    if (this.phase === SCAN_RELINKING) {
      this.relinkClock = this.relinkClock - dt;
      if (this.relinkClock <= 0) {
        this.relinkClock = 0;
        // Through lost(), not failed(): the attempt budget starts over for a
        // pad that has already proved it exists, and lost() is where that
        // rule lives.
        this.lost("the pad did not come back after the link dropped");
      }
      return;
    }
    if (this.phase === SCAN_FAILED || this.phase === SCAN_TIMED_OUT) {
      if (this.pendingScan) {
        return;
      }
      this.gapClock = this.gapClock + dt;
      if (this.gapClock < RETRY_GAP_SECONDS) {
        return;
      }
      this.gapClock = 0;
      if (this.tries >= MAX_ATTEMPTS && !this.unbounded) {
        this.enter(SCAN_GAVE_UP);
      } else {
        this.pendingScan = true;
      }
    }
  }

  /** True once per retry the machine wants. The caller does the scanning. */
  takeScanRequest(): boolean {
    if (!this.pendingScan) {
      return false;
    }
    this.pendingScan = false;
    return true;
  }

  // -------------------------------------------------------------- what to say

  /** The first line on the panel. Different in every state, on purpose. */
  title(): string {
    if (this.phase === SCAN_IDLE) {
      return "PAD: NOT LOOKING";
    }
    if (this.phase === SCAN_NO_MODULE) {
      return "PAD: NO BLUETOOTH HERE";
    }
    if (this.phase === SCAN_SCANNING) {
      return "PAD: SCANNING " + Math.ceil(this.secondsLeft()) + "s  (TRY " +
             this.tries + "/" + MAX_ATTEMPTS + ")";
    }
    if (this.phase === SCAN_SEEN) {
      return "PAD: " + this.seenTotal + " SEEN, " +
             Math.ceil(this.secondsLeft()) + "s LEFT  (TRY " +
             this.tries + "/" + MAX_ATTEMPTS + ")";
    }
    if (this.phase === SCAN_CONNECTING) {
      return "PAD: CONNECTING TO " + this.device;
    }
    if (this.phase === SCAN_LINKED) {
      return "PAD: LINKED, NO INPUT YET";
    }
    if (this.phase === SCAN_LIVE) {
      return "PAD: LIVE, " + this.reports + " REPORTS";
    }
    if (this.phase === SCAN_RELINKING) {
      return "PAD: RECONNECTING TO " + this.device;
    }
    if (this.phase === SCAN_FAILED) {
      return "PAD: FAILED  (TRY " + this.tries + "/" + MAX_ATTEMPTS + ")";
    }
    if (this.phase === SCAN_TIMED_OUT) {
      return "PAD: NOTHING FOUND  (TRY " + this.tries + "/" + MAX_ATTEMPTS + ")";
    }
    return "PAD: NO CONTROLLER FOUND";
  }

  /** What the wearer can do about it. Never empty, in any state. */
  advice(): string {
    if (this.phase === SCAN_IDLE) {
      return "The lens is not looking for a pad.";
    }
    if (this.phase === SCAN_NO_MODULE) {
      return "No Bluetooth in this build.";
    }
    if (this.phase === SCAN_SCANNING) {
      return "Hold the pad's pairing button now.";
    }
    if (this.phase === SCAN_SEEN) {
      return "Something is advertising. Keep the pairing button held.";
    }
    if (this.phase === SCAN_CONNECTING) {
      return "Keep the pad awake and close.";
    }
    if (this.phase === SCAN_LINKED) {
      return "Press a button on the pad.";
    }
    if (this.phase === SCAN_LIVE) {
      return "The pad is driving the game.";
    }
    if (this.phase === SCAN_RELINKING) {
      return "The link dropped. Taking it back; no need to do anything.";
    }
    if (this.phase === SCAN_FAILED) {
      return "Trying again shortly.";
    }
    if (this.phase === SCAN_TIMED_OUT) {
      return "Unpair the pad from any Mac or phone first, then hold pairing.";
    }
    return "No pad reached the glasses.";
  }

  /**
   * The panel, in order: what it is doing, what the radio saw, why it broke,
   * what to do, and the way that already works.
   */
  lines(): string[] {
    const out: string[] = [this.title()];
    for (let i = 0; i < this.sightings.length; i++) {
      out.push("SEEN " + this.sightings[i]);
    }
    if (this.why !== "") {
      out.push("WHY: " + this.why);
    }
    if (this.adapterNote !== "" && this.adapterNote !== this.why) {
      out.push("BT: " + this.adapterNote);
    }
    out.push(this.advice());
    out.push(FALLBACK_LINE);
    return out;
  }

  /** One grep-able line for the log. Names the state, always. */
  logLine(): string {
    let line = "[pad] " + this.phase +
               " try=" + this.tries + "/" + MAX_ATTEMPTS +
               " seen=" + this.seenTotal +
               " reports=" + this.reports +
               " left=" + this.secondsLeft().toFixed(1) + "s";
    if (this.device !== "") {
      line = line + " device=" + this.device;
    }
    if (this.why !== "") {
      line = line + " why=" + this.why;
    }
    if (this.adapterNote !== "") {
      line = line + " bt=" + this.adapterNote;
    }
    return line;
  }

  // ------------------------------------------------------------------ private

  private enter(next: string): void {
    if (this.phase === next) {
      return;
    }
    this.phase = next;
    this.version = this.version + 1;
  }
}
