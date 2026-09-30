/**
 * Specs Inc. 2026
 * Game controller integration for Spectacles. Provides Bluetooth HID connectivity for game
 * controllers with support for button input, analog sticks, triggers, and haptic feedback.
 *
 * LOCALLY PATCHED. See PATCHES.md next to this file for the list and the reason
 * for each one. The short version: as shipped, every path through this file
 * that does not end in a working pad ends in silence.
 */
import { ButtonKey, ButtonState } from "./Scripts/ButtonState";

import { BaseController } from "./Scripts/BaseController";
import Event from "./Scripts/Event";
import { GetRegisteredControllers } from "./SupportedControllers/RegisteredControllers";
import { Singleton } from "./Decorators/Singleton";

const HID_SERVICE_UUID = "0x1812";
/** Generic Access, and the Device Name inside it. Read AFTER connecting. */
const GENERIC_ACCESS_UUID = "0x1800";
/**
 * The rest of the HID service, which this file had never touched.
 *
 * HID-over-GATT gives a host four jobs besides subscribing to reports, and
 * a peripheral is entitled to stay silent until they are done:
 *
 *   0x2A4A HID Information -- read it.
 *   0x2A4B Report Map      -- read it. This is the descriptor that says what
 *                             the reports MEAN, and reading it is how a host
 *                             announces itself as a real HID host.
 *   0x2A4E Protocol Mode   -- write 0x01, Report Protocol. A device left in
 *                             Boot Protocol sends boot keyboard/mouse reports
 *                             or nothing at all.
 *   0x2A4C Control Point   -- write 0x01, Exit Suspend. NOT DONE, and see
 *                             subscribeToReports for the measurement that
 *                             says why: this pad never answers that write,
 *                             and the link dies of it thirty seconds later.
 *
 * We did exactly one of the five things a HID host does -- subscribe -- and
 * then wondered why nothing arrived.
 */
const HID_INFORMATION_UUID = "0x2A4A";
const REPORT_MAP_UUID = "0x2A4B";
const PROTOCOL_MODE_UUID = "0x2A4E";
/** Protocol Mode: 0 is Boot Protocol, 1 is Report Protocol. */
const REPORT_PROTOCOL: number = 0x01;
const DEVICE_NAME_UUID = "0x2A00";
/**
 * Microsoft's Bluetooth SIG company identifier.
 *
 * An Xbox pad puts it in its manufacturer data, and that survives an
 * advertisement carrying no name at all -- which is the case this whole
 * patch is about.
 */
const MICROSOFT_COMPANY_ID: number = 0x0006;

/**
 * PATCH: how many times a link may be re-established in silence before the
 * drop is reported as a loss and the scan takes over.
 *
 * Per link rather than per session, and reset by a link that delivered input
 * -- see relink(). Six because a relink costs a fraction of a second and a
 * scan costs sixty, so the cheap thing should be tried until it is clearly
 * not working; six consecutive failures with not one HID report between them
 * is a pad that has stopped answering, not a pad that keeps dropping.
 */
const RELINK_BUDGET: number = 6;

/**
 * PATCH: the exact names Xbox and SteelSeries pads advertise under.
 *
 * `ScanFilter.deviceName` is an EXACT match done by the platform -- Snap's own
 * Bluetooth doc marks it "Case-sensitive" -- which is a different question
 * from the substring test we run on a result that has already arrived. It is
 * worth asking separately, because a name filter is the platform being told
 * WHAT TO LOOK FOR rather than us sifting whatever turned up, and on most
 * stacks that means an ACTIVE scan: the scanner sends a scan request and reads
 * the scan RESPONSE, which is exactly where a BLE local name usually lives and
 * exactly what a passive scan never sees.
 *
 * Substrings stay where they are (controllerFor) for matching a result. These
 * are only for the filter, so they have to be whole names.
 */
const ADVERTISED_NAMES: string[] = [
  "Xbox Wireless Controller",
  "Xbox Elite Wireless Controller",
  "Xbox Adaptive Controller",
  "Stratus+",
  "SteelSeries Stratus+",
];

/**
 * PATCH: Bluetooth.BluetoothStatus, by value.
 *
 * The enum is read through the namespace where it exists, and these are the
 * fallback for a runtime that does not expose it -- 5.15 and 5.23 both print
 * the number either way, and a number with no name is what sent the third
 * playtest looking for a broken radio.
 */
const BLUETOOTH_UNKNOWN: number = 0;
const BLUETOOTH_PERMISSION_DENIED: number = 1;
const BLUETOOTH_UNAVAILABLE: number = 2;
const BLUETOOTH_AVAILABLE: number = 3;
const REPORT_INPUT_UUID = "0x2A4D";

/**
 * PATCH: the Bluetooth module is fetched on first use, not on import.
 *
 * Requiring it is not free: the Bluetooth GATT API "will disable access to
 * privacy-sensitive user information in that Lens, such as the camera frame,
 * location, and audio" unless Extended Permissions is on, and that is a setting
 * in the wearer's Spectacles app rather than anything this project can declare.
 * The camera frame is what WorldQuery hit-tests and world tracking live on, so
 * paying that cost merely by importing a file is a way to lose the whole lens
 * to a feature that is off. Snap's own current sample loads it lazily behind a
 * getter for exactly this reason.
 */
/** PATCH: the status as a word, because the number alone taught nobody anything. */
function statusName(status: number): string {
  if (status === BLUETOOTH_AVAILABLE) return "available";
  if (status === BLUETOOTH_UNAVAILABLE) return "unavailable";
  if (status === BLUETOOTH_PERMISSION_DENIED) return "permission denied";
  if (status === BLUETOOTH_UNKNOWN) return "unknown -- no permission yet";
  return "unreadable";
}

/**
 * PATCH: "0A:1B:2C:3D:4E:5F" and friends, as bytes. Null when it is not one.
 *
 * Separators are ignored, so a colon, a dash or nothing at all all work: a
 * wearer copying an address off a phone scanner should not have to think about
 * which of the three that app chose.
 */
function parseAddress(text: string): Uint8Array {
  if (!text) {
    return null;
  }
  let hex = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if ((c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F")) {
      hex = hex + c;
    }
  }
  if (hex.length !== 12) {
    return null;
  }
  const out = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** PATCH: the same six bytes the other way round. See connectToAddress. */
function reversed(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[bytes.length - 1 - i];
  }
  return out;
}

/** PATCH: an address as text, for a sighting the wearer has to recognise. */
export function addressText(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) {
    return "";
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const part = bytes[i].toString(16).toUpperCase();
    out = out + (part.length < 2 ? "0" + part : part) + (i + 1 < bytes.length ? ":" : "");
  }
  return out;
}

let bluetoothModuleCached: Bluetooth.BluetoothCentralModule = null;
function bluetooth(): Bluetooth.BluetoothCentralModule {
  if (bluetoothModuleCached === null) {
    bluetoothModuleCached =
      require("LensStudio:BluetoothCentralModule") as Bluetooth.BluetoothCentralModule;
  }
  return bluetoothModuleCached;
}

/**
 * Interface representing input data from a game controller
 */
export interface ControllerInput {
  /** The name of the connected controller device */
  deviceName: string;
  /** Raw input data buffer from the controller */
  buffer: Uint8Array;
}

/**
 * Singleton class for managing Bluetooth HID game controller connections and input handling.
 * Supports scanning, connecting, and receiving input from various game controllers.
 *
 * @example
 * ```typescript
 * const controller = GameController.getInstance();
 * await controller.scanForControllers();
 *
 * // Listen for button presses
 * controller.onButtonStateChanged('A', (pressed) => {
 *   console.log('A button pressed:', pressed);
 * });
 * ```
 */
@Singleton
export class GameController {
  /** Singleton instance getter function */
  public static getInstance: () => GameController;

  /** Map of button listeners for handling input events */
  private buttonListeners: Map<
    ButtonKey,
    Array<(val: boolean | number) => void>
  > = new Map();

  /** Bluetooth scan filter for HID devices */
  private scanFilter: Bluetooth.ScanFilter;

  /** Bluetooth scan settings configuration */
  private scanSetting: Bluetooth.ScanSettings;

  /** Currently connected controller instance */
  private currController: BaseController;

  /** GATT characteristic for sending rumble/haptic feedback */
  private rumbleCharacteristic: Bluetooth.BluetoothGattCharacteristic;

  /**
   * PATCH: how long one scan may run, in seconds.
   *
   * Upstream asked for 10000 -- two hours and forty-seven minutes -- against 10
   * in Snap's own current BLE-HID sample. A scan with no reachable end is a
   * scan whose promise never resolves, so "scan complete" never printed and
   * there was no observable difference between looking and having given up.
   * The owning source overrides this with the same number its countdown shows.
   */
  private scanWindowSeconds: number = 20;

  /**
   * PATCH: how many HID reports have arrived this session.
   *
   * A controller OBJECT is not a pad. Upstream built one from the device NAME
   * inside the scan predicate, before any connection existed, and
   * BaseController's constructor fills a complete all-false ButtonState -- so
   * every layer above believed a pad was attached the moment one was merely
   * visible in the room. This counter is the only honest evidence, and the
   * source above asks for it rather than for getButtonState().
   *
   * Monotonic on purpose: a caller tracking the delta must never see it fall.
   */
  private reports: number = 0;

  /**
   * PATCH: somewhere to report progress to.
   *
   * Every failure path in this file used to end in a private field or in
   * nothing at all. The lens can now say which one happened.
   */
  private watcher: (kind: string, detail: string, rssi: number) => void = null;

  /** PATCH: the characteristics currently subscribed. See releaseNotifications. */
  private subscribed: Bluetooth.BluetoothGattCharacteristic[] = [];

  /** PATCH: true while the next scan should look past the HID filter. See setSweep. */
  private sweeping: boolean = false;

  /**
   * PATCH: true once a connection has been taken, so the connection-state
   * event firing more than once cannot register for notifications twice.
   */
  private linked: boolean = false;

  /**
   * PATCH: the live GATT object, kept after a drop so the link can be taken
   * back without a scan. See relink().
   */
  private gatt: Bluetooth.BluetoothGatt = null;

  /** PATCH: how many silent relinks this link has already been given. */
  private relinks: number = 0;

  /** PATCH: reports delivered by the time the current link was taken. */
  private reportsAtLink: number = 0;

  /** PATCH: whether this runtime can tell us a reconnection happened. */
  private relinkable: boolean = false;
  /**
   * PATCH: whether ANY GATT operation on the current link has ever answered.
   *
   * A read that came back, or a report that arrived. Set false the moment a
   * link is taken and never guessed at: it is the difference between a link
   * this stack can talk over and one it cannot, and on 10 September it became
   * the difference between closing a link and freezing the lens. See
   * releaseLink.
   */
  private answered: boolean = false;

  /**
   * PATCH: the subscribe that is waiting for this link to answer a read.
   *
   * Null once it has run, or once the link is gone. See subscribeToReports.
   */
  private pendingSubscribe: { service: Bluetooth.BluetoothGattService,
                              name: string } = null;

  /**
   * Initializes the GameController with default Bluetooth scan settings.
   * Sets up the HID service filter and scan configuration.
   */
  public constructor() {
    // PATCH: real ScanFilter/ScanSettings objects rather than object literals
    // cast with `as`. A cast satisfies the compiler and hands the runtime a
    // plain object where it expects a ScriptObject.
    this.scanFilter = new Bluetooth.ScanFilter();
    this.scanFilter.serviceUUID = HID_SERVICE_UUID;
    this.scanSetting = new Bluetooth.ScanSettings();
    this.scanSetting.uniqueDevices = true;
    // uniqueDevices is lowered to false on a FILTERED pass, in
    // scanForControllers. See the note there.
    this.scanSetting.timeoutSeconds = this.scanWindowSeconds;
    // PATCH: LowLatency, not Balanced.
    //
    // Upstream left this at Unset and Snap's own BLE sample sets Balanced, so
    // Balanced is where this started. Balanced DUTY-CYCLES the receiver: it
    // listens for a window, sleeps, listens again. A peripheral that
    // advertises rarely, or only for the few seconds a pairing button holds it
    // open, can fall entirely into the gaps -- and a scanner that misses it
    // reports exactly what a scanner in an empty room reports.
    //
    // Sixty seconds of Balanced over a room with twenty-two devices in it
    // found twenty-two of them and never this pad, while the same pad reached
    // a laptop from the same spot. LowLatency listens continuously. It is the
    // one dial in this file that had never been turned.
    this.scanSetting.scanMode = Bluetooth.ScanMode.LowLatency
      ? Bluetooth.ScanMode.LowLatency : Bluetooth.ScanMode.Balanced;
  }

  /** PATCH: watch the connection attempt. One watcher; the lens is the caller. */
  public watch(fn: (kind: string, detail: string, rssi: number) => void): void {
    this.watcher = fn;
  }

  /** PATCH: how many HID reports have actually been delivered. */
  public reportCount(): number {
    return this.reports;
  }

  /**
   * PATCH: what the adapter itself says, before a scan is blamed on the pad.
   *
   * `BluetoothStatus` is `Unknown` (0), `PermissionDenied` (1), `Unavailable`
   * (2), `Available` (3). Only 3 can find anything. Everything below it was
   * being reported as "the radio produced no advertisements at all", which
   * reads as a fault in the pad or the room and is neither.
   *
   * Returns -1 when the runtime has no status to give, so "we could not ask"
   * stays distinguishable from "we asked and it said no".
   */
  public adapterStatus(): number {
    try {
      const s = bluetooth().status;
      return typeof s === "number" ? s : -1;
    } catch (e) {
      return -1;
    }
  }

  /**
   * PATCH: whether this is Lens Studio's preview rather than the glasses.
   *
   * Snap's BLE Playground sample branches on exactly this before it goes near
   * the radio (BleServiceHandler.ts:92, and eight more places), and the
   * Bluetooth doc says why: "Bluetooth does not work in Lens Studio Preview.
   * To properly test you will need to push to Spectacles." A scan started here
   * cannot succeed, and every second it spends failing is a second of a budget
   * the wearer needed on the glasses.
   */
  public inEditor(): boolean {
    try {
      const info: any = (global as any).deviceInfoSystem;
      return !!(info && info.isEditor && info.isEditor());
    } catch (e) {
      return false;
    }
  }

  /** PATCH: whether the adapter is definitely, currently usable. */
  public adapterReady(): boolean {
    if (this.inEditor()) {
      return false;
    }
    const available = Bluetooth.BluetoothStatus
      ? Bluetooth.BluetoothStatus.Available : BLUETOOTH_AVAILABLE;
    return this.adapterStatus() === available;
  }

  /**
   * PATCH: whether the adapter has said NO, as opposed to not having said
   * anything yet.
   *
   * This distinction is the whole point, and getting it wrong deadlocks the
   * lens. `BluetoothStatus.Unknown` is documented as "the Bluetooth
   * permissions or status have not been established" -- it is not a refusal.
   * ASKING is what establishes them, so a lens that waits for `Available`
   * before it asks waits for ever. That is what put "PAD: NO BLUETOOTH HERE"
   * under the Game Boy screen on the glasses with the pad in pairing mode:
   * the code refused to scan because the permission had not been granted, and
   * the permission was never going to be granted because nothing scanned.
   *
   * A definitive no is `PermissionDenied`, `Unavailable`, or the editor, where
   * there is no radio at all. Everything else gets tried.
   */
  public adapterBlocked(): boolean {
    if (this.inEditor()) {
      return true;
    }
    const status = this.adapterStatus();
    return status === BLUETOOTH_PERMISSION_DENIED ||
           status === BLUETOOTH_UNAVAILABLE;
  }

  /**
   * PATCH: what the adapter is doing, in words a wearer can act on.
   *
   * Never empty on the glasses, because the number is the one thing that says
   * where to look next and it can only be read off the panel.
   */
  public adapterProblem(): string {
    if (this.inEditor()) {
      return "Lens Studio preview has no Bluetooth; send to Spectacles";
    }
    const status = this.adapterStatus();
    if (status === BLUETOOTH_PERMISSION_DENIED) {
      return "Bluetooth permission refused for this lens (status 1)";
    }
    if (status === BLUETOOTH_UNAVAILABLE) {
      return "Bluetooth is off or missing on this device (status 2)";
    }
    if (status === BLUETOOTH_AVAILABLE) {
      return "";
    }
    if (status === BLUETOOTH_UNKNOWN) {
      // Not a refusal. Scanning is what turns this into an answer.
      return "Bluetooth permission not granted yet (status 0)";
    }
    return "no Bluetooth status on this runtime (status " + status + ")";
  }

  /**
   * PATCH: whether the next scan looks at everything, not only HID.
   *
   * The scan filters on the HID service UUID, so `advertisements` counts only
   * devices that put 0x1812 in their ADVERTISEMENT -- and plenty of HID
   * peripherals put it only in the GATT table they expose after connecting.
   * That makes "no advertisements at all" say two completely different things
   * at once: nothing is in the air, or nothing in the air is advertising the
   * one service we filtered for. One unfiltered sweep tells them apart, and
   * without that the report is unfalsifiable.
   */
  public setSweep(on: boolean): void {
    this.sweeping = on === true;
  }

  /** PATCH: sets the scan deadline, so one number drives it and the countdown. */
  public setScanWindow(seconds: number): void {
    if (typeof seconds === "number" && seconds > 0) {
      this.scanWindowSeconds = seconds;
    }
  }

  /**
   * Scans for available Bluetooth HID game controllers.
   * Automatically connects to the first compatible controller found.
   *
   * PATCH: the predicate no longer connects. It logs every raw advertisement
   * the radio produced -- name, or "NO NAME", with its signal strength -- and
   * returns true only for a device whose name a registered controller claims.
   * Connecting happens after the scan promise settles, in a try/catch, so a
   * connection that throws is a reported failure rather than an unhandled
   * rejection inside a fire-and-forget call. Upstream connected from inside the
   * predicate and returned true for the FIRST device of any kind, which meant
   * one nameless BLE device in the room ended the whole attempt permanently
   * and silently: `deviceName.includes(...)` on a null name throws, and
   * deviceName is `string | null` by declaration.
   *
   * @returns Promise that resolves when the scan and any connection are done
   */
  async scanForControllers() {
    this.scanSetting.timeoutSeconds = this.scanWindowSeconds;
    // Every advertisement on a FILTERED pass, not one per device.
    //
    // `uniqueDevices` makes the predicate fire once per device for the whole
    // window, so a device seen in the first second is never heard from again
    // -- and one whose FIRST advertisement was missed is never heard from at
    // all. On a filtered pass almost nothing matches (twenty-two devices in
    // the room, zero through the filters), so there is no flood to fear and
    // every repeat is another chance to catch a pad that advertises rarely.
    //
    // Left true on a sweep, where twenty-two devices advertising several times
    // a second for a minute is thousands of lines and no more information.
    this.scanSetting.uniqueDevices = this.sweeping;
    // A fresh attempt has taken no connection yet. Without this, a second try
    // after a connection that linked but never reported would refuse to do any
    // of the work again.
    this.linked = false;
    // PATCH: say what the adapter itself thinks before blaming the pad, and
    // say it by NAME. "adapter status 0" is Unknown, which is what preview
    // reports every time and what the glasses report until the Bluetooth
    // permission has been answered. It is not a fault in the pad.
    const status = this.adapterStatus();
    this.say("scan", "starting, " + this.scanWindowSeconds +
             "s window, adapter " + statusName(status) + " (" + status + ")" +
             (this.sweeping ? ", sweeping every device"
                            : ", asking for HID + Microsoft + " +
                              ADVERTISED_NAMES.length + " names"), 0);

    // PATCH: an unfiltered sweep sees what the filters hide. See setSweep.
    const filters = this.sweeping ? [] : this.buildFilters();

    let candidate: Bluetooth.ScanResult = null;
    let advertisements = 0;
    let connectable = 0;
    try {
      await bluetooth().startScan(
        filters,
        this.scanSetting,
        (result) => {
          advertisements = advertisements + 1;
          const name = result.deviceName ? result.deviceName : "";
          const strength = typeof (result as any).rssi === "number"
            ? (result as any).rssi : null;
          // The company id goes on the panel with the name. On an
          // advertisement with no name it is the only thing that says what the
          // device is, and reading it off the glasses is the only way anyone
          // finds out what is actually in the room.
          const maker = this.makerLabel(result);
          // The address goes on the panel with the name. A pad that advertises
          // nothing else is still a row the wearer can match against what a
          // phone scanner shows them -- and it is what connectToAddress wants.
          const where = addressText(result.deviceAddress);
          // Whether it could be connected to at all. A device advertising
          // non-connectably can never become a pad however well it matches,
          // and on a sweep that is most of what a room contains.
          const reachable = result.isConnectable === false ? " [not connectable]" : "";
          if (result.isConnectable !== false) {
            connectable = connectable + 1;
          }
          this.say("seen", name + maker + (where ? " " + where : "") + reachable,
                   strength);
          if (candidate) {
            // Already connecting to one. Returning false is what keeps the
            // radio looking, and the sample does the same: a pad whose
            // CONNECTION fails is only reachable again while the scan that
            // found it is still running.
            return false;
          }
          const match = this.controllerFor(name);
          // A device with no name that the HID FILTER let through is still a
          // HID device -- the filter is the platform's own answer to "does
          // this advertise service 0x1812". Requiring a name on top of that is
          // a second gate, and plenty of pads pass the first and fail it:
          // the local name lives in the scan response, or nowhere at all.
          //
          // Only ever on a FILTERED pass. On a sweep there is no filter, so a
          // nameless device is any device in the room, and Snap's own guidance
          // is explicit that discovery "must not connect to the first
          // arbitrary BLE device".
          // On a filtered pass the PLATFORM has already decided this device is
          // worth waking us for -- it advertises HID, or carries Microsoft's
          // company id, or calls itself by one of the names we asked for. A
          // missing local name is not a reason to throw that away.
          const wanted = !this.sweeping && !name && result.isConnectable !== false;
          const microsoft = this.looksMicrosoft(result);
          if (!match && !wanted && !microsoft) {
            return false;
          }
          if (!match) {
            this.say("seen", (name ? name : "NO NAME") +
                     (microsoft ? " -- Microsoft manufacturer data" :
                                  " -- matched a filter, no name"), 0);
          }
          candidate = result;
          // The sample connects from inside the predicate and returns nothing,
          // so the scan carries on until the connection stops it. Upstream had
          // no catch here, and a predicate is not awaited: a connection that
          // threw became an unhandled rejection and the wearer was told
          // nothing at all.
          this.connectGATT(result, match ? match : null).then(
            () => {},
            (e: any) => {
              this.say("error", "connecting failed: " + e, 0);
            }
          );
          return false;
        }
      );
    } catch (e) {
      // The BLE Playground sample is explicit about this path: it "Fires on
      // calling bluetoothModule.stopScan() AND on scan timing out". Taking a
      // connection calls stopScan, so a scan ending just after a pad linked is
      // the SUCCESS path arriving here, not a failure.
      if (this.linked || candidate) {
        return;
      }
      // ...and so is a window simply running out, which is how EVERY pass ends
      // on 5.15. `startScan` rejects with "Scan failed: TIMEOUT" when the
      // deadline passes, so the code below the try -- every count, every
      // carefully worded reason -- was unreachable on the device, and the only
      // thing a wearer ever saw was the word FAILED over a scan that had done
      // exactly what it was asked to do.
      const text = "" + e;
      if (text.indexOf("TIMEOUT") >= 0 || text.indexOf("timed out") >= 0) {
        this.endOfPass(advertisements, connectable);
      } else {
        this.log("pass over: " + this.passName() + ", " + advertisements +
                 " seen, " + connectable + " connectable, then an error");
        this.say("error", "the scan itself failed: " + text, 0);
      }
      return;
    }

    if (candidate) {
      // The predicate found one and is connecting to it; that path reports.
      return;
    }
    this.endOfPass(advertisements, connectable);
  }

  /** PATCH: which question this pass asked. */
  private passName(): string {
    return this.sweeping ? "swept" : "filtered";
  }

  /**
   * PATCH: what a pass that found no pad PROVED, on the log and on the panel.
   *
   * Reached from two places, because a scan window ends in two: the promise
   * resolving, and -- on 5.15, always -- the promise rejecting with TIMEOUT.
   * It lived on only the first for a day, which is why a device log full of
   * measurements said nothing but "Scan failed: TIMEOUT".
   */
  private endOfPass(advertisements: number, connectable: number): void {
    // One line for the whole pass, so a log read afterwards does not have to be
    // counted by hand. This is the line that finally said what six days of
    // this could not: twenty-two devices in the room, twenty of them not
    // connectable at all, and none of them a pad.
    this.log("pass over: " + this.passName() + ", " + advertisements +
             " seen, " + connectable + " connectable");
    let why: string;
    if (this.sweeping) {
      why = advertisements > 0
        ? advertisements + " seen, " + connectable + " connectable, none a pad"
        : "nothing at all is advertising within range";
    } else if (advertisements > 0) {
      why = advertisements + " matched the filters, none connectable";
    } else {
      why = "nothing here calls itself a pad -- not in pairing mode?";
    }
    this.say("error", why, 0);
  }

  /**
   * Establishes GATT connection with a discovered Bluetooth controller.
   * Identifies controller type, sets up characteristics, and registers for notifications.
   *
   * @param scanResult - The scan result containing device information
   * @param controllerType - The registered controller class this device matched
   * @private
   */
  private async connectGATT(scanResult: Bluetooth.ScanResult, controllerType: any) {
    const name = scanResult.deviceName ? scanResult.deviceName : "NO NAME";
    this.say("connecting", name, 0);
    const gatt = await bluetooth().connectGatt(scanResult.deviceAddress);
    // Same null as connectToAddress, and this is the path a FOUND pad takes:
    // the bug would have broken a scan that finally worked, in the same way.
    if (!gatt) {
      this.say("error", "the pad refused the connection (no GATT)", 0);
      return;
    }
    await this.adoptConnection(gatt, name, controllerType);
  }

  /**
   * PATCH: everything that happens once a GATT object exists, however it was
   * obtained -- from a scan, or from an address typed in by hand.
   */
  private async adoptConnection(gatt: Bluetooth.BluetoothGatt, name: string,
                                controllerType: any): Promise<void> {
    const anyGatt: any = gatt;
    // PATCH: kept for relink(). The GATT object outlives the LINK -- that is
    // the whole point of BluetoothGatt.connect() -- so holding it is what
    // makes a drop recoverable without going back to the radio.
    this.gatt = gatt;

    const onDisconnected = () => {
      this.linked = false;
      this.currController = null;
      this.rumbleCharacteristic = null;
      // Hand the subscription back, or the NEXT connection cannot have it.
      //
      // The 15:08 reconnect failed on "Operation failed, already registered":
      // the vendor stack still held the registration from a link that no
      // longer existed, so the fresh one was refused and the pad's input went
      // to a callback belonging to a dead connection. This is what "ik
      // probeerde opnieuw te connecten maar dit werkte niet" was.
      this.pendingSubscribe = null;
      this.releaseNotifications();
      // PATCH: take the same link back, silently, before telling anyone it
      // was lost. See relink() for why this is not a scan.
      if (this.relink(name)) {
        return;
      }
      this.say("lost", "device disconnected: " + name, 0);
      // PATCH: only rescan from here when nobody above is driving the retries.
      // The owning source runs a bounded retry loop of its own, and two
      // concurrent startScan calls are worse than none.
      if (!this.watcher) {
        this.scanForControllers();
      }
    };

    // 5.15 and 5.23 announce a connection in two different ways, and getting
    // this wrong is silent: you enumerate an empty service and report a pad
    // that would not talk.
    //
    // 5.15.4 -- the version that builds the lens that goes on the glasses --
    // has onConnectionStateChangedEvent and a Bluetooth.ConnectionState enum,
    // and its own docs are explicit: connectGatt is an "asynchronous call: to
    // detect when the device is connected listen on the
    // onConnectionStateChangedEvent". AWAITING connectGatt therefore does not
    // mean connected there, and Snap's GameController sample accordingly does
    // every piece of service discovery inside the Connected branch of that
    // event, and calls stopScan() there and nowhere else. This follows the
    // sample.
    //
    // 5.23 removed both the event and the enum -- `Bluetooth.ConnectionState`
    // does not exist in its StudioLib.d.ts -- and connectGatt resolves only on
    // success, so there the code after the await IS the connected path.
    const connectionState: any = (Bluetooth as any).ConnectionState;
    if (anyGatt.onConnectionStateChangedEvent && connectionState) {
      // PATCH: a silent relink is only honest where a RECONNECTION can be
      // observed. This branch binds a listener that fires on every future
      // Connected as well as this one, so gatt.connect() has somewhere to
      // land. The other branch below has a disconnect signal and no connect
      // signal at all, so a relink there would be a call into the dark.
      this.relinkable = typeof anyGatt.connect === "function";
      anyGatt.onConnectionStateChangedEvent.add((change: any) => {
        const state = change ? change.state : null;
        if (state === connectionState.Connected) {
          // Not awaited -- an event listener cannot be -- so the rejection is
          // caught HERE as well as inside. takeConnection is already
          // throw-proof; this is the second belt, because a promise rejected
          // with nobody listening is exactly how the 16:42 failure managed to
          // produce no log line at all.
          this.takeConnection(gatt, name, controllerType).then(
            () => {},
            (e: any) => this.log("taking the connection threw: " + e));
        } else if (state === connectionState.Disconnected) {
          onDisconnected();
        }
      });
      // The event can have fired before there was anything bound to it, in
      // which case nothing would ever arrive. The state is readable, so ask.
      if (anyGatt.connectionState === connectionState.Connected) {
        await this.takeConnection(gatt, name, controllerType);
      }
      return;
    }

    if (anyGatt.onDisconnectedEvent) {
      anyGatt.onDisconnectedEvent.add(onDisconnected);
    } else {
      this.log("no disconnect signal on this runtime; will not auto-rescan");
    }
    await this.takeConnection(gatt, name, controllerType);
  }

  /**
   * PATCH: everything the sample does inside its Connected branch.
   *
   * Lifted out of connectGATT so the two runtimes can reach it from the two
   * different places they learn a connection exists, and guarded so an event
   * that fires twice does not register for notifications twice.
   */
  private async takeConnection(gatt: Bluetooth.BluetoothGatt, name: string,
                               controllerType: any): Promise<void> {
    try {
      await this.openLink(gatt, name, controllerType);
    } catch (e) {
      // NOTHING may escape this function, and the 16:42 log is why.
      //
      // gatt.getService() threw -- the same HostFunction family as the
      // getCharacteristic that patch 38 guarded -- and this method is called
      // from a connection-state listener WITHOUT await, so the rejection had
      // nowhere to go. It was swallowed whole: no log line, no error event,
      // nothing. The last thing the wearer's log said was "linked", eleven
      // minutes before he gave up.
      //
      // And `linked` had already been set true at the top, so every later
      // Connected event returned at the guard. One throw wedged the pad for
      // the entire run:
      //
      //   16:42:00.717  linked: Xbox Wireless Controller
      //   16:42:04.642  [pad] linked try=1/3 seen=1 reports=0
      //   16:42:14.651  [pad] linked try=1/3 seen=1 reports=0
      //
      // So: say what happened, and hand the link back so the next attempt is
      // allowed to have it.
      this.linked = false;
      this.currController = null;
      this.pendingSubscribe = null;
      this.releaseNotifications();
      this.say("error", "the link could not be opened: " + e, 0);
    }
  }

  /** PATCH: the body of takeConnection. See the wrapper above for why. */
  private async openLink(gatt: Bluetooth.BluetoothGatt, name: string,
                         controllerType: any): Promise<void> {
    // controllerType is null for a device found by its HID service rather than
    // by its name; the real name is read off the device below.
    if (this.linked) {
      return;
    }
    this.linked = true;
    // A fresh link has proven nothing yet, whatever the last one proved.
    this.answered = false;
    // The sample stops the scan HERE -- on the connection, not on the sighting
    // -- and keeps the radio looking in between.
    try {
      bluetooth().stopScan();
    } catch (e) {
      // A scan that has already stopped is not an error worth losing a pad to.
    }
    // PATCH: the controller object is built once a link exists, not in the
    // scan predicate from a name alone. See the note on `reports`.
    //
    // A device found by its HID service rather than its name arrives here with
    // no layout. Ask the DEVICE what it is: Generic Access carries the real
    // name, and the advertisement's is optional and often missing.
    let type = controllerType;
    let known = name;
    if (!type) {
      const overGatt = await this.nameOverGatt(gatt);
      if (overGatt) {
        known = overGatt;
        type = this.controllerFor(overGatt);
        this.log("device name over GATT: " + overGatt);
      }
    }
    if (!type) {
      this.say("error", "connected to a HID device this lens has no layout for: " +
               (known ? known : "NO NAME"), 0);
      this.linked = false;
      return;
    }
    this.currController = new type();
    // PATCH: where the report counter stood when this link began. relink()
    // reads it to tell a link that WORKED from one that never spoke.
    this.reportsAtLink = this.reports;
    this.say("linked", known, 0);

    // PATCH: getService THROWS, it does not return null.
    //
    // Patch 38 learned this about getCharacteristic -- "Get GATT
    // characteristic failed, no characteristic found" is an exception, not an
    // absence -- and this call was left with the null check that had already
    // been shown to be the wrong shape. On 10 September at 16:42 it threw, and
    // because the whole method was fire-and-forget the throw was invisible.
    //
    // A service can be missing for a reason that has nothing to do with the
    // pad: on this stack a link can be reported Connected before its GATT
    // database is readable, and asking too early gets this. So it is a
    // FAILURE OF THIS ATTEMPT, not a verdict on the device -- say so, hand the
    // link back, and let the machine above try again.
    let desiredService: Bluetooth.BluetoothGattService = null;
    try {
      desiredService = gatt.getService(HID_SERVICE_UUID);
    } catch (e) {
      this.log("HID service (" + HID_SERVICE_UUID + ") not readable yet: " + e);
      desiredService = null;
    }
    if (!desiredService) {
      this.linked = false;
      this.currController = null;
      this.say("error", "connected, but the HID service could not be read", 0);
      return;
    }

    // PATCH: the rest of what a HID host is supposed to do. See the UUID
    // constants at the top of this file: subscribing is one job of five, and a
    // peripheral is within its rights to stay silent until the others are done.
    this.becomeHidHost(desiredService);

    // PATCH: the subscribe waits for the link to PROVE itself.
    //
    // registerNotifications can hang the whole runtime. Measured over one
    // afternoon: sixteen calls, three returns -- and the two most recent
    // failures killed the lens outright. The device log stops mid-sentence at
    // the same line both times, the AudioDriver heartbeat that had ticked
    // every four seconds stops with it, and the wearer's report is "de muziek
    // stopte ineens en het startscherm ging niet meer meebewegen":
    //
    //   17:44:46.333  characteristic 0x2A4D properties [1,4]   <- end of log
    //   18:05:07.791  characteristic 0x2A4D properties [1,4]   <- end of log
    //
    // The next statement in both cases is the subscribe, and it is not async
    // in any useful sense: on the one link where it returned it took 534 ms
    // with nothing else logged in between. It blocks the main thread, and
    // sometimes it never stops blocking it.
    //
    // This is also why patch 44 made things worse before it made them better.
    // Awaiting the handshake used to hang FIRST, so a sick link was released
    // at the deadline and the subscribe was never reached: the bug was
    // shielding us from a worse one. Removing the await removed the shield.
    //
    // The shield is deliberate now, and it is the right shield. A read that
    // comes BACK is proof this link carries GATT traffic, and only such a link
    // is allowed near registerNotifications. On the connection that worked the
    // reads returned four bytes and 283 bytes; on every link that froze, no
    // read ever returned at all. One that proves nothing is released by
    // SCAN_LINKED's deadline with this never having been called.
    this.pendingSubscribe = { service: desiredService, name: name };
  }

  /**
   * PATCH: subscribe, once, on a link that has answered a read.
   *
   * Called from readHidValue's continuation rather than inline, so the order
   * on the wire is the one HOGP asks for -- read HID Information, read the
   * Report Map, set Protocol Mode, THEN subscribe -- while nothing ever waits
   * on a reply that does not come. See the note in openLink for what this is
   * protecting against and what it cost to find out.
   */
  private async subscribeToReports(): Promise<void> {
    const pending = this.pendingSubscribe;
    if (!pending) {
      return;
    }
    // Once per link. Two reads can come back and only one subscribe may run.
    this.pendingSubscribe = null;
    const desiredService = pending.service;
    const name = pending.name;

    // PATCH: registration is attempted per characteristic, in its own
    // try/catch, and the properties are logged either way.
    //
    // Upstream tested `properties.includes(CharacteristicProperty.Notify)` and,
    // when that was false, fell through to the descriptor branch and registered
    // nothing -- no log, no state change. A HID Report characteristic on an
    // encrypted link reports NotifyEncryptionRequired, which is a different
    // enum value, so the one code path that makes a pad work could be skipped
    // in silence. There are multiple 2A4D characteristics on a pad: one
    // notifies, another carries the rumble descriptor, so both branches stay.
    let characteristics: Bluetooth.BluetoothGattCharacteristic[] = [];
    try {
      characteristics = desiredService.getCharacteristics();
    } catch (e) {
      this.say("error", "the HID characteristics could not be read: " + e, 0);
      return;
    }
    let registered = 0;
    for (let i = 0; i < characteristics.length; i++) {
      const c = characteristics[i];
      if (!c.uuid.includes(REPORT_INPUT_UUID)) {
        continue;
      }
      const props = c.properties ? c.properties : [];
      this.log("characteristic " + c.uuid + " properties [" + props + "]");
      const canNotify =
        props.length === 0 ||
        props.includes(Bluetooth.CharacteristicProperty.Notify) ||
        props.includes(Bluetooth.CharacteristicProperty.NotifyEncryptionRequired) ||
        props.includes(Bluetooth.CharacteristicProperty.Indicate) ||
        props.includes(Bluetooth.CharacteristicProperty.IndicateEncryptionRequired);
      if (canNotify) {
        try {
          await c.registerNotifications((buf) => this.onReport(buf, name));
          registered = registered + 1;
          this.subscribed.push(c);
          this.log("registered for notifications on " + c.uuid);
          continue;
        } catch (e) {
          this.log("cannot notify on " + c.uuid + ": " + e);
        }
      }
      try {
        const descriptors = c.getDescriptors();
        for (let d = 0; d < descriptors.length; d++) {
          const readVal = (await descriptors[d].readValue()) as Uint8Array;
          const reportId = readVal[0]; // e.g. 1 or 3
          const reportType = readVal[1]; // 1=Input, 2=Output, 3=Feature
          if (reportId == 3 && reportType == 2) {
            this.rumbleCharacteristic = c;
            this.log("rumble characteristic: " + c.uuid);
          }
        }
      } catch (e) {
        this.log("descriptors unreadable on " + c.uuid + ": " + e);
      }
    }

    // NOTHING is written to the HID Control Point (0x2A4C), and that absence
    // is the fix for "mijn controller disconnect constant".
    //
    // A write used to go out here. It never settled, and the note that stood
    // in its place read the evidence backwards: "reports flowed the whole time
    // it was pending, so it is not needed". Reports did flow -- for thirty
    // seconds. Every working link in the 10 September log died at the same
    // moment, and the write's own rejection arrived in the same millisecond as
    // the death:
    //
    //   15:07:45.912 ready ... 15:08:16.072 lost     30.16s
    //   17:43:52.453 ready ... 17:44:22.503 relink   30.05s
    //   18:20:06.606 ready ... 18:20:36.677 relink   30.07s
    //
    //   18:20:36.677  relink: Xbox Wireless Controller
    //   18:20:36.677  control point: exit suspend (0x2A4C) refused: Operation failed
    //
    // Three links, three deaths, all at 30.0s, none before the write was added
    // (8b06e18, 15:04) and none after it lasting longer. Thirty seconds is the
    // GATT operation timeout underneath us; an operation that never completes
    // takes the connection down with it when it expires.
    //
    // The Control Point is Write Without Response in the HID Service spec.
    // writeValue() is a write WITH response, so the host waits for an ATT
    // Write Response the pad is not required to send and does not send. The
    // API does have the other kind -- writeValueWithoutResponse(), which
    // sendRumble below already uses -- and an earlier version of this note
    // wrongly claimed it did not. If a write-without-response characteristic
    // ever has to be written from here, that is the method, never writeValue().
    //
    // Nor is the write worth having: Exit Suspend only means anything to a host
    // that put the device into Suspend, and this one never does. So the whole
    // request goes, rather than being made safer.

    if (registered > 0) {
      // PATCH: the handshake is done and something is listening. The machine
      // above stops counting down on the link at this point -- an idle pad
      // that has been subscribed to is allowed to stay quiet, but one that
      // never got this far is not. See SCAN_LINKED's deadline.
      this.say("ready", name, 0);
    } else {
      // Connected and mute is a real, distinct outcome -- and on this platform
      // a likely one: the Bluetooth docs say HID (Input) devices are not
      // supported, and HID-over-GATT only notifies over a bonded, encrypted
      // link that a Lens has no API to establish. Saying so is the whole point.
      this.say("error", "linked, but nothing on the pad would notify", 0);
    }
  }

  /**
   * PATCH: read what a HID host reads and write what a HID host writes.
   *
   * Every step is best effort and logged either way. A device that refuses one
   * of them is telling us something; a device that has none of these
   * characteristics is telling us something else; and neither is a reason to
   * abandon a link that might still report.
   */
  private becomeHidHost(service: Bluetooth.BluetoothGattService): void {
    // ISSUED, NOT AWAITED. The distinction is the whole patch.
    //
    // The pad receives these three requests either way -- that is what issuing
    // them means -- and a host that has asked for the report map has announced
    // itself as a real HID host whether or not it waits around for the answer.
    // What awaiting adds is a dependency on a reply, and on this pad the reply
    // never comes. From the 10 September 17:09-17:12 log, six cycles, every
    // one identical:
    //
    //   17:10:16.363  linked: Xbox Wireless Controller
    //   17:10:28.480  report map (0x2A4B) unreadable: Error: Operation failed
    //
    // Twelve point one seconds, six times running, and twelve is our own link
    // deadline. The read was not failing. It was HANGING, and it resolved at
    // the instant releaseLink closed the GATT underneath it and took every
    // queued operation with it. So the handshake blocked for twelve seconds
    // and the link was torn down before registerNotifications was ever
    // reached -- the one step that actually produces input.
    //
    // This also corrects what patch 35 concluded. Reading the report map was
    // read as the thing that "opens the tap", because reports arrived in the
    // same millisecond as the subscribe that followed a successful read. The
    // fuller evidence says otherwise: on a healthy link the reads return in
    // under a second AND the notifications register; on a sick one neither
    // works. The read was a symptom of a usable link, not the cause of one.
    // Patch 37 had already learned this shape about the control point write.
    // It is true of all four.
    //
    // The first read that comes BACK is what lets the subscribe happen. See
    // subscribeToReports: registerNotifications blocks the main thread and on
    // a link that answers nothing it has twice never stopped blocking it, so
    // a link that has not answered a read does not get near it.
    const proven = (ok: boolean) => {
      if (ok) {
        this.subscribeToReports().then(() => {},
          (e: any) => this.log("subscribing threw: " + e));
      }
    };
    this.readHidValue(service, HID_INFORMATION_UUID, "HID information")
      .then(proven, () => {});
    this.readHidValue(service, REPORT_MAP_UUID, "report map")
      .then(proven, () => {});
    this.writeHidByte(service, PROTOCOL_MODE_UUID, REPORT_PROTOCOL,
                      "protocol mode: report")
      .then(() => {}, () => {});
  }

  /** PATCH: read one characteristic of the HID service, for the log. */
  private async readHidValue(service: Bluetooth.BluetoothGattService,
                             uuid: string, what: string): Promise<boolean> {
    try {
      const c = service.getCharacteristic(uuid);
      if (!c) {
        this.log(what + " (" + uuid + "): not on this device");
        return false;
      }
      const bytes = await c.readValue();
      this.log(what + " (" + uuid + "): " +
               (bytes ? bytes.length + " bytes" : "empty"));
      if (bytes && bytes.length > 0) {
        this.answered = true;
      }
      // A read that came BACK is the only proof this link carries GATT
      // traffic at all. See openLink, which will not subscribe without it.
      return bytes ? bytes.length > 0 : false;
    } catch (e) {
      this.log(what + " (" + uuid + ") unreadable: " + e);
    }
    return false;
  }

  /** PATCH: write one byte to a characteristic of the HID service. */
  private async writeHidByte(service: Bluetooth.BluetoothGattService,
                             uuid: string, value: number,
                             what: string): Promise<void> {
    try {
      // getCharacteristic THROWS for a characteristic the device does not
      // have -- "Get GATT characteristic failed, no characteristic found" --
      // rather than returning null, so the guard below is not the one that
      // catches it. An Xbox pad has no Protocol Mode (0x2A4E) at all, which is
      // legal: it is optional for a device that only speaks Report Protocol,
      // and reporting that as "refused" reads like a rejection instead of an
      // absence.
      const c = service.getCharacteristic(uuid);
      if (!c) {
        this.log(what + " (" + uuid + "): not on this device");
        return;
      }
      const one = new Uint8Array(1);
      one[0] = value;
      await c.writeValue(one);
      this.log(what + " (" + uuid + "): written");
    } catch (e) {
      const text = "" + e;
      this.log(what + " (" + uuid + ")" +
               (text.indexOf("no characteristic found") >= 0
                  ? ": not on this device"
                  : " refused: " + text));
    }
  }

  /**
   * PATCH: hand the link back to the pad, so it can be found again.
   *
   * Nothing in this file has ever disconnected anything. That was survivable
   * while a dead link simply stopped being mentioned, and it stopped being
   * survivable on 10 September: a link can be up at the radio while being
   * useless above it -- the Xbox logo solid, the GATT database unreadable, no
   * subscription -- and a connected BLE peripheral DOES NOT ADVERTISE. So the
   * scan that runs next cannot find the pad, because we are still holding it.
   *
   * close() rather than disconnect(): 5.15's docs describe disconnect() as
   * "unpair or disconnect", and dropping the bond is not what is wanted here.
   * close() is "terminate the Bluetooth client connection, disconnection
   * included if applicable", which is exactly the amount of giving up meant.
   *
   * The GATT is forgotten first, so the Disconnected this provokes falls
   * through relink() -- which needs a gatt -- and reports an honest loss.
   */
  public releaseLink(why: string): void {
    const gatt = this.gatt;
    this.gatt = null;
    this.linked = false;
    this.currController = null;
    this.rumbleCharacteristic = null;
    this.relinks = 0;
    this.pendingSubscribe = null;
    this.releaseNotifications();
    this.log("link released: " + why);
    if (!gatt) {
      return;
    }
    // A LINK THAT NEVER ANSWERED IS NOT CLOSED. It is dropped on the floor.
    //
    // close() is a call into the same GATT stack that has just spent twelve
    // seconds not answering two reads, and on 10 September it stopped
    // returning. Both frozen runs that evening end on the log line printed
    // immediately ABOVE this call and on nothing else:
    //
    //   23:28:05.746  link released: linked, but the pad never finished ...
    //   23:30:59.003  link released: linked, but the pad never finished ...
    //
    // -- no rejection of the pending reads, no `[pad] failed` line from the
    // machine above, no AudioDriver heartbeat three seconds later, and the
    // Spectacles Monitor showing the lens pegging two cores with Lens power
    // at zero. (An earlier draft also said the glasses dropped their tether
    // to Lens Studio; that log line turned out to be from another day.)
    //
    // Compare a link on the same build that HAD answered, at 17:12:18: the
    // close came back in twenty milliseconds and rejected every outstanding
    // operation on its way out. The difference is not the closing. It is
    // whether this stack is still talking to us at all.
    //
    // What we give up by not closing: a connected peripheral does not
    // advertise, so the pad may stay unfindable for the rest of the run --
    // the failure patch 41 introduced close() to fix. That is a bad run. A
    // lens that has to be restarted is a worse one, and the wearer cannot
    // tell the second from a crash.
    if (!this.answered) {
      this.log("not closing a link that never answered; the pad may stay " +
               "unfindable until the lens is restarted");
      return;
    }
    try {
      (gatt as any).close();
    } catch (e) {
      this.log("could not close the link: " + e);
    }
  }

  /**
   * PATCH: take the same link back, without going near the radio.
   *
   * The pad drops the link on its own after sixteen to thirty seconds and
   * nothing in this file asks it to. That is still not understood -- the
   * likeliest reading remains an unbonded link the peripheral eventually
   * abandons, and a Lens has no API to bond -- but it does not have to be
   * understood to be survivable. The wearer's report on 10 September was not
   * "it disconnects", it was "ik moet constant de controller opnieuw
   * verbinden": the cost was the RECOVERY, not the drop.
   *
   * What the recovery used to be: report "lost", the scan machine above
   * restarts, sixty seconds of LowLatency scanning, a fresh connectGatt, the
   * whole HID handshake. Twice a minute, by hand, with the world stopped.
   *
   * What it is now: BluetoothGatt.connect(), which 5.15's own docs describe as
   * "re-establish connection to the device". No scan, no advertisement to
   * catch, no pairing button. The connection-state listener bound in
   * adoptConnection is still attached to this same object, so the Connected it
   * produces lands in takeConnection exactly as the first one did -- and the
   * subscription is free, because onDisconnected handed it back before calling
   * this.
   *
   * The budget is per LINK, not per session, and a link that actually
   * delivered input earns a fresh one. So a pad that drops every twenty
   * seconds relinks for as long as the wearer keeps playing, and a pad that
   * connects and never speaks cannot spin here: it gets RELINK_BUDGET goes and
   * then the honest "lost" and the scan behind it.
   *
   * Returns whether the caller should stay quiet and wait.
   */
  private relink(name: string): boolean {
    if (!this.gatt || !this.relinkable) {
      return false;
    }
    if (this.reports > this.reportsAtLink) {
      // This link worked. Whatever ended it, it was not a pad that cannot
      // talk to us, so the budget starts over.
      this.relinks = 0;
    }
    if (this.relinks >= RELINK_BUDGET) {
      this.log("relink budget spent after " + this.relinks +
               " silent attempts; falling back to a scan");
      return false;
    }
    this.relinks = this.relinks + 1;
    try {
      (this.gatt as any).connect();
    } catch (e) {
      this.log("relink refused: " + e);
      return false;
    }
    // Told, not hidden. The wearer sees no interruption, but the panel and the
    // log both need to be able to say why a pad went quiet for a second.
    this.say("relink", name, 0);
    return true;
  }

  /**
   * PATCH: give every subscription back.
   *
   * Called when a link drops. `registerNotifications` refuses a second
   * subscription to a characteristic it still believes is subscribed --
   * "Operation failed, already registered" -- and that survives the
   * disconnection, so without this a pad can be connected to exactly once per
   * lens run.
   */
  private releaseNotifications(): void {
    for (let i = 0; i < this.subscribed.length; i++) {
      try {
        this.subscribed[i].unregisterNotifications();
      } catch (e) {
        this.log("could not unregister " + this.subscribed[i].uuid + ": " + e);
      }
    }
    this.subscribed = [];
  }

  /** PATCH: one place where an incoming HID report is counted and dispatched. */
  private onReport(buf: Uint8Array, deviceName: string): void {
    this.reports = this.reports + 1;
    // A report is the strongest evidence there is that this link works.
    this.answered = true;
    if (this.reports === 1) {
      this.say("report", "first HID report from " + deviceName, 0);
    }
    if (!this.currController) {
      this.log("Controller mapping not found for: " + deviceName);
      return;
    }
    this.currController.onStateUpdate(buf, (btn, value) => {
      // Call all listeners for this button
      const listeners = this.buttonListeners.get(btn);
      if (listeners) {
        for (const fn of listeners) {
          fn(value);
        }
      }
    });
  }

  /** PATCH: which registered controller claims this device name, or null. */
  /**
   * PATCH: whether an advertisement carries Microsoft's company identifier.
   *
   * The one thing about an Xbox pad that survives an advertisement with no
   * local name in it. `manufacturerData` is keyed by company id, and
   * `manufacturerId` names it directly where the runtime fills that in.
   */
  /**
   * PATCH: connect to a known address without scanning at all.
   *
   * The one open-source client that demonstrably drives an Xbox pad from a BLE
   * central (asukiaaa/esp32-client-for-xbox-controller-with-nim-ble) matches on
   * a HARDCODED MAC address; its service-UUID check is in the source,
   * commented out. That is not a shortcut, it is the author having found that
   * discovery is the unreliable half.
   *
   * `connectGatt` takes the address directly, so a wearer who can read their
   * pad's address off a phone BLE scanner can skip discovery entirely. This is
   * the only route left if the pad advertises in a form the glasses' scanner
   * cannot see -- BLE 5 extended advertising is invisible to a legacy scanner,
   * because ADV_EXT_IND is not a PDU type the 4.x specification defines, and
   * the Xbox library above says plainly that "BLE5 may be needed to
   * communicate with xbox controller".
   *
   * Byte order is not documented, so both are tried: a six-byte address is
   * cheap to reverse and a wearer cannot be expected to know which way round
   * the runtime wants it.
   */
  public async connectToAddress(address: string): Promise<boolean> {
    // The editor has no radio, and connecting is no more possible there than
    // scanning. Without this the address path walked straight past the guard
    // that beginScan has had for a day, and preview retried for ever.
    if (this.adapterBlocked()) {
      this.say("error", this.adapterProblem(), 0);
      return false;
    }
    const bytes = parseAddress(address);
    if (!bytes) {
      this.say("error", "that is not a Bluetooth address: " + address, 0);
      return false;
    }
    const orders: Uint8Array[] = [bytes, reversed(bytes)];
    let lastError = "";
    for (let i = 0; i < orders.length; i++) {
      this.say("connecting", address + (i === 0 ? "" : " (reversed)"), 0);
      try {
        this.linked = false;
        const gatt = await bluetooth().connectGatt(orders[i]);
        // connectGatt RESOLVES WITH NULL when it cannot connect -- it does not
        // reject. 5.15's own declaration says the promise "is rejected if the
        // connection cannot be made", and on the device it is not: it hands
        // back null and the next property read throws
        // "cannot read property 'onConnectionStateChangedEvent' of null",
        // which is what every attempt reported for a day. Believing a
        // signature over an observation is the whole of that day.
        if (!gatt) {
          this.log("connectGatt resolved null on order " + i);
          continue;
        }
        await this.adoptConnection(gatt, address, null);
        return true;
      } catch (e) {
        lastError = "" + e;
        this.log("direct connect failed on order " + i + ": " + lastError);
      }
    }
    // The verbatim reason goes on the PANEL, not only into the log. On the
    // glasses the panel is the only thing a wearer can read, and "nothing
    // answered" without the reason is the same unfalsifiable sentence this
    // whole file has spent a week getting rid of. A refused connection, a pad
    // already held by another central and an address that is simply wrong all
    // land here and they are three different problems.
    this.say("error", "no answer at " + address +
             (lastError ? ": " + lastError : ""), 0);
    return false;
  }

  /**
   * PATCH: everything the platform can be asked to look for, as one array.
   *
   * `startScan` takes a LIST, and 5.15's own documentation is explicit about
   * how it is read: "If a device passes ANY filter then the predicate will be
   * invoked for that device." So these are alternatives, not conditions, and
   * adding one can only widen the net:
   *
   *   - the HID service (0x1812), which is what a game pad is;
   *   - Microsoft's company id, which is on an Xbox pad's manufacturer data
   *     and survives an advertisement carrying no name at all;
   *   - each exact name a supported pad advertises under.
   *
   * The last two are the answer to "kunnen we niet actief zoeken naar een xbox
   * controller in plaats van algemene bluetooth controllers" (Joshua, 10
   * September). They are: this asks for that pad by identity rather than
   * sifting whatever a general scan happens to turn up.
   *
   * Every filter is built defensively. A runtime that rejects one property
   * must cost us that ONE filter, not the scan -- the service filter alone is
   * where this started and it still has to work.
   */
  private buildFilters(): Bluetooth.ScanFilter[] {
    const filters: Bluetooth.ScanFilter[] = [this.scanFilter];
    try {
      const byMaker = new Bluetooth.ScanFilter();
      byMaker.manufacturerId = MICROSOFT_COMPANY_ID;
      filters.push(byMaker);
    } catch (e) {
      this.log("no manufacturer filter on this runtime: " + e);
    }
    for (let i = 0; i < ADVERTISED_NAMES.length; i++) {
      try {
        const byName = new Bluetooth.ScanFilter();
        byName.deviceName = ADVERTISED_NAMES[i];
        filters.push(byName);
      } catch (e) {
        this.log("no name filter for " + ADVERTISED_NAMES[i] + ": " + e);
      }
    }
    return filters;
  }

  /** PATCH: the company id as something readable, or "". See looksMicrosoft. */
  private makerLabel(result: Bluetooth.ScanResult): string {
    if (this.looksMicrosoft(result)) {
      return " [Microsoft]";
    }
    try {
      if (typeof result.manufacturerId === "number") {
        return " [maker " + result.manufacturerId + "]";
      }
    } catch (e) {
      // Nothing to add.
    }
    return "";
  }

  private looksMicrosoft(result: Bluetooth.ScanResult): boolean {
    try {
      if (result.manufacturerId === MICROSOFT_COMPANY_ID) {
        return true;
      }
      const data: any = result.manufacturerData;
      if (data && data[MICROSOFT_COMPANY_ID]) {
        return true;
      }
    } catch (e) {
      // A runtime with no manufacturer data on its ScanResult. Not a reason
      // to lose the pad; the other two tests still run.
    }
    return false;
  }

  /**
   * PATCH: the device's name as the DEVICE gives it, over GATT.
   *
   * The advertisement's name is optional and often absent -- it belongs in the
   * scan response, which a passive scan never asks for. Generic Access
   * (0x1800) carries the real one, and by the time this runs there is a
   * connection to ask down. This is what lets a pad that advertised as NO NAME
   * still be identified as an Xbox and given the right report layout.
   */
  private async nameOverGatt(gatt: Bluetooth.BluetoothGatt): Promise<string> {
    try {
      const access = gatt.getService(GENERIC_ACCESS_UUID);
      if (!access) {
        return "";
      }
      const characteristic = access.getCharacteristic(DEVICE_NAME_UUID);
      if (!characteristic) {
        return "";
      }
      const bytes = await characteristic.readValue();
      if (!bytes || bytes.length === 0) {
        return "";
      }
      let out = "";
      for (let i = 0; i < bytes.length; i++) {
        out = out + String.fromCharCode(bytes[i]);
      }
      return out;
    } catch (e) {
      this.log("device name unreadable over GATT: " + e);
      return "";
    }
  }

  private controllerFor(deviceName: string): any {
    if (!deviceName || deviceName.length === 0) {
      return null;
    }
    const registered = GetRegisteredControllers();
    for (let i = 0; i < registered.length; i++) {
      const type = registered[i];
      if (deviceName.includes(type.prototype.getDeviceNameSubstring())) {
        return type;
      }
    }
    return null;
  }

  /**
   * Sends rumble/haptic feedback to the connected controller.
   *
   * @param power - Rumble intensity (0-255, where 255 is maximum)
   * @param durationMs - Duration of rumble effect in milliseconds (default: 1000ms)
   *
   * @example
   * ```typescript
   * // Light rumble for 500ms
   * controller.sendRumble(100, 500);
   *
   * // Strong rumble for 1 second
   * controller.sendRumble(255);
   * ```
   */
  public sendRumble(power: number, durationMs: number = 1000) {
    if (this.rumbleCharacteristic && this.currController) {
      if (!this.currController.supportsRumble()) {
        print("This controller does not support rumble");
        return;
      }
      this.rumbleCharacteristic.writeValueWithoutResponse(
        this.currController.getRumbleBuffer(power, durationMs)
      );
      this.log("Power: " + power + " Duration: " + durationMs);
    }
  }

  /**
   * Registers a callback function to listen for specific button state changes.
   *
   * @param key - The button key to listen for (e.g., 'A', 'B', 'X', 'Y', etc.)
   * @param handler - Callback function that receives the button's new state
   * @returns Unsubscribe function to remove the listener
   *
   * @example
   * ```typescript
   * // Listen for A button presses
   * const unsubscribe = controller.onButtonStateChanged('A', (pressed) => {
   *   if (pressed) {
   *     console.log('A button pressed!');
   *   }
   * });
   *
   * // Later, remove the listener
   * unsubscribe();
   * ```
   */
  public onButtonStateChanged<K extends ButtonKey>(
    key: K,
    handler: (val: ButtonState[K]) => void
  ): () => void {
    if (!this.buttonListeners.has(key)) {
      this.buttonListeners.set(key, []);
    }

    const listeners = this.buttonListeners.get(key)! as Array<
      (val: ButtonState[K]) => void
    >;
    listeners.push(handler);

    // Unsubscribe function
    return () => {
      const index = listeners.indexOf(handler);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * Gets the current button state from the connected controller.
   *
   * @returns The current ButtonState object, or null if no controller is connected
   *
   * @example
   * ```typescript
   * const state = controller.getButtonState();
   * if (state) {
   *   console.log('A button is pressed:', state.A);
   *   console.log('Left stick X:', state.leftStickX);
   * }
   * ```
   */
  public getButtonState(): ButtonState | null {
    if (this.currController) {
      return this.currController.getButtonState();
    }
    return null;
  }

  /**
   * PATCH: logs, and tells the watcher, in one call.
   *
   * @param kind - one of scan, seen, connecting, linked, report, lost, error
   * @param detail - the human half; a device name for seen/connecting/linked
   * @param rssi - signal strength for a sighting, null when unknown, 0 otherwise
   * @private
   */
  private say(kind: string, detail: string, rssi: number): void {
    this.log(kind + ": " + detail);
    if (this.watcher) {
      try {
        this.watcher(kind, detail, rssi);
      } catch (e) {
        // A broken watcher must not take the connection down with it.
        this.log("watcher threw: " + e);
      }
    }
  }

  /**
   * Logs debug messages with a consistent prefix.
   *
   * @param message - The message to log
   * @private
   */
  private log(message: string) {
    print("BLE TEST: " + message);
  }
}
