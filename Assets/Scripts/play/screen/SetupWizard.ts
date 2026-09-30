// The first run: what the lens says while it has no world yet.
//
// The fault this page was born from, in the owner's words after the third
// glasses playtest: "nu is het gewoon zwart zonder iets als de rom niet goed
// geladen is." Nothing in this lens created a drawing surface until
// beginBoot() had a bundle in hand, so a world that did not arrive cost the
// whole screen. So this runs BEFORE the world does, is drawn with a font
// built into the lens (TinyFont) rather than the cartridge's, and is pure:
// no Lens Studio types, no scene, no globals. The lens feeds it events beside
// the setStatus() calls that already exist, and paints what it asks for.
//
// Since 28 September it is four steps a new wearer walks through on the LCD
// of a Game Boy that rises into view (GameBoyShell), with the step dots to
// say where they are:
//
//   1 WELCOME       what this is, in three lines
//   2 GET A CODE    the site, and what it does with the cartridge
//   3 ENTER CODE    the six letters, on the Spectacles keyboard
//   4 PUT IT DOWN   where the plate landed, and what the hands do; A plays
//
// The code is typed on the system keyboard (TextInputSystem) when the lens
// has one: the page asks for it with WIZ_KEYBOARD and receives the text
// through keyboardText(). Without one -- the Lens Studio preview, an older
// device -- the D-pad grid of CodeEntry is the keyboard, as it was before.
//
// It is deliberately NOT the "onboarding page" -- OnboardingScreen.ts and
// bootPhase "onboarding" are the HOW DO YOU WANT TO PLAY? question that comes
// after the ROM intro, which needs a bundle and a cartridge font. This one
// runs when there is neither. The published lens has no world of its own, so
// a reviewer with no cartridge sees exactly these pages, above an empty plate
// on the table, and they have to say what the lens is for on their own.

import type { GbCanvas } from "./GbCanvas";
import { SCREEN_WIDTH } from "./GbCanvas";
import {
  COLUMNS, MARGIN_X, GLYPH_H, drawText, drawCentred, textWidth, wrap,
} from "./TinyFont";
import { drawIcon, drawSteps } from "./PixelIcons";
import { PLACE_SEARCHING, PLACE_IN_FRONT, PLACE_ON_SURFACE } from "../DioramaPlacer";
import { PAD_UNAVAILABLE, PAD_SCANNING, PAD_CONNECTED, PAD_FAILED } from "../InputSource";
import { CodeEntry, CODE_DONE, CODE_BACK, CODE_LENGTH, normaliseCode, isValidCode } from "./CodeEntry";
import { lensBanner } from "../../Version";

/** The pages. Strings, not an enum: Lens Studio's subset has no `export enum`. */
export const WIZ_LOOKING: string = "looking";
export const WIZ_BRIDGE: string = "bridge";
/** Steps 1 and 2: what this is, and where the code comes from. */
export const WIZ_INTRO: string = "intro";
/** Step 3: typing the six characters the world site showed. */
export const WIZ_CODE: string = "code";
/** The bundle coming down over https under that code. */
export const WIZ_FETCH: string = "fetch";
export const WIZ_FAILED: string = "failed";
/** Step 4: where the plate is and what the hands do. A plays. */
export const WIZ_PLACE: string = "place";
export const WIZ_READY: string = "ready";
export const INTRO_STEPS: number = 2;
/** The dots at the top right: four steps. */
export const STEP_TOTAL: number = 4;

/** What step() asks the lens to do. */
export const WIZ_STAY: string = "";
export const WIZ_RETRY: string = "retry";
export const WIZ_REPLACE: string = "replace";
/**
 * Look for a Bluetooth pad again.
 *
 * The pad gets three scans in the first seventy seconds of the lens and then
 * nothing, ever. That window closes while the glasses are still going on the
 * wearer's head, and the pad's pairing button has usually not been held yet.
 * The last page is the one place the wearer is looking at the pad's state, so
 * it is the one place where asking again belongs.
 */
export const WIZ_RESCAN: string = "rescan";
/** Fetch the world under enteredCode() over https. */
export const WIZ_FETCH_CODE: string = "fetchcode";
/** Open the system keyboard for the code. */
export const WIZ_KEYBOARD: string = "keyboard";
/** Close it again: the page is leaving. */
export const WIZ_KEYBOARD_CLOSE: string = "keyboardclose";
export const WIZ_DONE: string = "done";

/** Why there is no world. Each one has its own page of advice; see remedyFor. */
export const FAIL_NO_SOURCE: string = "nosource";
export const FAIL_BRIDGE: string = "bridge";
export const FAIL_BUNDLE: string = "bundle";
export const FAIL_WORLD: string = "world";
/** The site answered: nothing under that code. Mistyped, or older than a day. */
export const FAIL_CODE: string = "code";
/** The site did not answer at all: no Wi-Fi, or the site is down. */
export const FAIL_NET: string = "net";
/** Every declared reason, so a test can prove none of them lacks advice. */
export const FAIL_REASONS: string[] = [
  FAIL_NO_SOURCE, FAIL_BRIDGE, FAIL_BUNDLE, FAIL_WORLD, FAIL_CODE, FAIL_NET,
];

/**
 * How long a page must be up before an EVENT may replace it.
 *
 * A cached world is found in the same frame the wizard is built, so without
 * this the LOOKING page would exist for one sixtieth of a second and the wearer
 * would learn nothing from a page written to teach them where the world comes
 * from. Button presses are not held back by it -- a press answered a third of a
 * second late is a lens that feels broken.
 */
export const MIN_DWELL: number = 0.35;
/** How long the READY page holds before letting a returning wearer through. */
export const HOLD_SECONDS: number = 0.8;
/** The longest gap between automatic retries. */
export const RETRY_CAP: number = 30;
/** The title is drawn at scale 2, so it gets half the columns. */
export const TITLE_MAX: number = 13;

// ------------------------------------------------------------------- layout
//
// 160x144, cleared to PAPER with INK on it and nothing else. The display is
// ADDITIVE: shade 3 renders as nothing and shade 0 renders bright, so a big
// dark header band would be an invisible hole rather than a bar. Paper with ink
// on it is the only thing that reads through a lens you can see the room
// through, which is what every other screen in this folder already does.
const PAPER: number = 0;
const INK: number = 3;
const BAR_FILL: number = 2;

export const TITLE_Y: number = 8;
const TITLE_SCALE: number = 2;
/** The step icon's corner and the dots' corner, either side of the title. */
export const ICON_X: number = 4;
export const ICON_Y: number = 6;
export const STEPS_X: number = 130;
export const STEPS_Y: number = 6;
export const RULE_Y: number = 26;
export const BODY_Y: number = 34;
export const LINE_PITCH: number = 12;
/** 34 + 7*12 + 7 = 125, which clears the footer at 134. */
export const MAX_LINES: number = 8;
/** With the bar at 122 there is less room: 34 + 4*12 + 7 = 89. */
export const MAX_LINES_WITH_BAR: number = 5;
export const BAR_X: number = 2;
export const BAR_Y: number = 122;
export const BAR_W: number = 156;
export const BAR_H: number = 10;
export const BAR_INSET: number = 2;
export const BAR_INNER: number = BAR_W - 2 * BAR_INSET;
export const FOOTER_Y: number = 134;
/** The six boxes of the keyboard page. */
export const KEY_FIELD_Y: number = 40;
export const KEY_FIELD_W: number = 20;
export const KEY_FIELD_H: number = 22;
export const KEY_FIELD_GAP: number = 4;
export const KEY_STATUS_Y: number = 74;
/** Where a title starts when an icon sits to its left. */
export const TITLE_X_WITH_ICON: number = 20;

// --------------------------------------------------------------- pure rules

/** Clips a line to what the screen can show, so no page can silently overrun. */
function fit(text: string): string {
  const t = text ? text : "";
  return t.length > COLUMNS ? t.substring(0, COLUMNS) : t;
}

/**
 * How long to wait before trying again: 3, 6, 12, 24, then 30 for ever.
 *
 * Doubling, because the common case is a laptop that is about to be switched
 * on and the uncommon case is a laptop that is in another building. Capped,
 * because a wearer who walks back into the room should not have to wait four
 * minutes for the lens to notice.
 */
export function retrySeconds(attempt: number): number {
  const n = attempt > 0 ? Math.floor(attempt) : 0;
  let seconds = 3;
  for (let i = 0; i < n; i++) {
    seconds = seconds * 2;
    if (seconds >= RETRY_CAP) {
      return RETRY_CAP;
    }
  }
  return seconds;
}

/**
 * Whether waiting can fix this on its own.
 *
 * Only the bridge and the site. The Mac's server can come up at any moment,
 * and that is the exact case where the wearer is walking to the laptop with
 * the glasses on; the site is the same over a Wi-Fi that is coming back.
 * Everything else is a wheel spinning: re-reading the same bad bytes gives the
 * same bad bytes, and an InternetModule that is not in the scene will not be in
 * the scene three seconds later. Those pages wait for a press instead, so the
 * screen keeps saying what to do rather than counting down at the wearer.
 */
export function autoRetries(reason: string): boolean {
  return reason === FAIL_BRIDGE || reason === FAIL_NET;
}

/**
 * What to do about a failure -- the whole point of the page.
 *
 * Every line here is checked against README-515.md, which is the record of what
 * actually goes wrong on the 2024 glasses: 5.15 has no JsonAsset, so the device
 * cannot read the baked world at all and the bridge is the only way in; the
 * bridge is `tools/serve-world.sh` on the Mac; both ends must be on the same
 * Wi-Fi; and `bridgeHost` on the PokemonAR component must be the Mac's LAN
 * address, which the server prints when it starts. A message that sends the
 * wearer to the wrong place is worse than no message.
 */
export function remedyFor(reason: string, url: string, bundleId: string): string[] {
  const address = fit(url ? url.toUpperCase() : "NO ADDRESS");
  const id = fit("ID: " + (bundleId ? bundleId.toUpperCase() : "NONE"));
  if (reason === FAIL_NO_SOURCE) {
    return [
      "NOTHING TO LOAD FROM.",
      "",
      "NO BUILT IN WORLD, AND",
      "NO INTERNETMODULE EITHER.",
      "",
      "SET INTERNETMODULE ON THE",
      "POKEMONAR OBJECT, THEN RUN",
      "THE SERVER ON THE MAC.",
    ];
  }
  if (reason === FAIL_BRIDGE) {
    return [
      "COULD NOT REACH THE MAC.",
      address,
      "",
      "1 ON THE MAC, RUN",
      "  TOOLS/SERVE-WORLD.SH",
      "2 SAME WI-FI ON BOTH",
      "3 BRIDGEHOST = MAC LAN IP",
      "  (THE SERVER PRINTS IT)",
    ];
  }
  if (reason === FAIL_BUNDLE) {
    return [
      "THE WORLD DATA IS BAD.",
      id,
      "",
      "THE COPY ON THE GLASSES",
      "CANNOT BE READ. RE-BAKE IT",
      "ON THE MAC, THEN LOAD IT",
      "AGAIN WITH PREFERCACHE",
      "TURNED OFF.",
    ];
  }
  if (reason === FAIL_WORLD) {
    return [
      "THE WORLD ARRIVED BUT",
      "WOULD NOT START.",
      "",
      "B SHOWS THE ERROR ITSELF.",
      "",
      "IF IT KEEPS FAILING, THE",
      "COPY HERE IS OLD: RE-BAKE",
      "IT AND LOAD IT AGAIN.",
    ];
  }
  if (reason === FAIL_CODE) {
    // The first real miss (29 September) was FPBB23 typed for FPBB32: the
    // code was fine, two symbols had changed places. Say so before "expired".
    return [
      "NO WORLD UNDER THE CODE",
      fit("YOU TYPED: " + (url ? url.toUpperCase() : "NONE")),
      "",
      "CHECK IT AGAINST THE PAGE:",
      "TWO SYMBOLS SWAPPED IS THE",
      "USUAL SLIP. A CODE ALSO",
      "LASTS ONE DAY; THEN DROP",
      "THE FILE AGAIN.",
    ];
  }
  if (reason === FAIL_NET) {
    return [
      "COULD NOT REACH THE SITE.",
      fit(url ? url.toUpperCase() : "NO ADDRESS"),
      "",
      "1 ARE THE GLASSES ON",
      "  WI-FI?",
      "2 WAIT A MOMENT. IT TRIES",
      "  AGAIN BY ITSELF.",
    ];
  }
  return [
    "THE WORLD DID NOT LOAD,",
    "AND THE LENS CANNOT SAY",
    "WHY.",
    "",
    "B SHOWS WHAT IT DOES KNOW.",
    "A TRIES THE WHOLE THING",
    "AGAIN FROM THE TOP.",
  ];
}

// ------------------------------------------------------------- the machine

export class SetupWizard {
  private firstRun: boolean;
  private url: string;
  private bundleId: string;
  private hasBaked: boolean;
  private hasInternet: boolean;
  /** The world site's host, e.g. "pocket-diorama.vercel.app"; "" when unknown. */
  private site: string;
  /** Whether the lens has a system keyboard to type the code on. */
  private keyboard: boolean;

  private introStep: number = 0;
  private entry: CodeEntry;
  private entryPainted: number = -1;
  private directCodeCell: number[] = null;
  /** The code as typed on the system keyboard, normalised, at most six. */
  private typed: string = "";
  private keyboardOpen: boolean = false;
  /** The page has just been entered and wants the keyboard up. */
  private wantKeyboard: boolean = false;
  /** The keyboard's return key was pressed since the last frame. */
  private returnPressed: boolean = false;
  /** The code being fetched, or the last one tried. */
  private code: string = "";

  private page: string = WIZ_LOOKING;
  /** A page an EVENT asked for, waiting out MIN_DWELL. "" when there is none. */
  private pending: string = "";
  private sincePage: number = 0;
  private version: number = 0;
  private finished: boolean = false;

  private found: string = "";
  private fraction: number = 0;
  private percent: number = 0;
  private message: string = "";

  private reason: string = "";
  private detail: string = "";
  private showDetail: boolean = false;
  private attemptCount: number = 0;
  private retryLeft: number = 0;

  private holdLeft: number = 0;

  private placeState: string = "";
  private padState: string = "";
  private activeInput: string = "";

  private worldChars: number = 0;
  private worldSha1: string = "";

  constructor(firstRun: boolean, bridgeUrl: string, bundleId: string,
              hasBaked: boolean, hasInternet: boolean, site: string = "",
              hasKeyboard: boolean = false) {
    this.firstRun = firstRun;
    this.url = bridgeUrl ? bridgeUrl : "";
    this.bundleId = bundleId ? bundleId : "";
    this.hasBaked = hasBaked;
    this.hasInternet = hasInternet;
    this.site = SetupWizard.hostOf(site);
    this.keyboard = hasKeyboard;
    // B on an empty code goes back to the intro only when there is an intro
    // to go back to; a returning wearer typing a code has nothing behind it.
    this.entry = new CodeEntry(firstRun);
  }

  /** "https://a.b/c" is shown as "A.B": the page has 26 columns. */
  static hostOf(site: string): string {
    let text = site ? site : "";
    const scheme = text.indexOf("://");
    if (scheme >= 0) {
      text = text.substring(scheme + 3);
    }
    const slash = text.indexOf("/");
    return slash >= 0 ? text.substring(0, slash) : text;
  }

  // ------------------------------------------------------------- readers

  state(): string {
    return this.page;
  }

  /** Bumped only when the drawn page would differ. The view uploads on a change. */
  stateVersion(): number {
    return this.version;
  }

  progressFraction(): number {
    return this.fraction;
  }

  /** Whole seconds until the automatic retry, or 0 when there is not one. */
  retryIn(): number {
    return this.retryLeft > 0 ? Math.ceil(this.retryLeft) : 0;
  }

  attempts(): number {
    return this.attemptCount;
  }

  /** Which of the INTRO_STEPS pages is up, 0-based. */
  introPage(): number {
    return this.introStep;
  }

  /** The code the wearer confirmed, for the lens to fetch. */
  enteredCode(): string {
    return this.code;
  }

  /** The code as typed so far, on either keyboard. */
  typedCode(): string {
    return this.keyboard ? this.typed : this.entry.code();
  }

  /** Whether the code is typed on the system keyboard rather than the grid. */
  usesSystemKeyboard(): boolean {
    return this.keyboard;
  }

  /** Whether the code page is the D-pad grid, where A types the marked symbol. */
  onGridPage(): boolean {
    return this.page === WIZ_CODE && !this.keyboard;
  }

  /** One targeted key per frame. Never carry an old keyboard press onto another page. */
  queueCodeCell(row: number, column: number): void {
    if (this.onGridPage() && this.directCodeCell === null) {
      this.directCodeCell = [row, column];
    }
  }

  codeCursor(): number[] {
    return this.entry.cursor();
  }

  /**
   * Whether the empty plate belongs in view: only on the pages about placing
   * it. Behind the intro and the code it was a slab hanging in the room, and
   * read as one ("een soort tafelblad erachter", 29 September).
   */
  showsPlate(): boolean {
    return this.page === WIZ_PLACE || this.page === WIZ_READY;
  }

  /** The keyboard's cursor, [row, column]; for the suite that types on it. */
  cursorForTest(): number[] {
    return this.entry.cursor();
  }

  /**
   * Which of the four steps this page is, 1..4, or 0 for the pages that are
   * not steps (looking, the bridge, a returning wearer's READY). The failure
   * page counts as step 3 when it is about a code, since that is where the
   * wearer goes back to.
   */
  stepNumber(): number {
    if (this.page === WIZ_INTRO) {
      return this.introStep + 1;
    }
    if (this.page === WIZ_CODE || this.page === WIZ_FETCH) {
      return 3;
    }
    if (this.page === WIZ_FAILED) {
      return this.reason === FAIL_CODE || this.reason === FAIL_NET ? 3 : 0;
    }
    if (this.page === WIZ_PLACE) {
      return 4;
    }
    return 0;
  }

  /** The icon beside the title, or "" for a page without one. */
  iconName(): string {
    if (this.page === WIZ_INTRO) {
      return this.introStep === 0 ? "cartridge" : "site";
    }
    if (this.page === WIZ_CODE) {
      return "keyboard";
    }
    if (this.page === WIZ_PLACE) {
      return "plate";
    }
    if (this.page === WIZ_READY) {
      return "check";
    }
    if (this.page === WIZ_FETCH) {
      return "glasses";
    }
    return "";
  }

  // --------------------------------------------------------------- events
  //
  // One call beside each setStatus() the lens already makes, in the same order.
  // Nothing here parses a status string: the strings are for the log, these are
  // for the wearer, and coupling the two would break the page the day someone
  // rewords a log line.

  /** "CACHE" or "BAKED": the world was found without the network. */
  sourceFound(where: string): void {
    if (this.page !== WIZ_LOOKING || this.found === where) {
      return;
    }
    this.found = where;
    this.version++;
  }

  beginBridge(url: string): void {
    this.url = url ? url : this.url;
    this.fraction = 0;
    this.percent = 0;
    this.message = "";
    this.request(WIZ_BRIDGE);
  }

  /**
   * There is no world anywhere on the glasses and no bridge to pull one from:
   * the published lens's normal first launch. A first-time wearer reads the
   * two intro pages; one who has been through it before goes straight to the
   * code.
   */
  needCode(): void {
    this.reason = "";
    this.retryLeft = 0;
    this.introStep = 0;
    this.resetCode();
    if (this.firstRun) {
      this.request(WIZ_INTRO);
    } else {
      this.wantKeyboard = this.keyboard;
      this.request(WIZ_CODE);
    }
  }

  /** A chunk arrived. Clamped, and never allowed to go backwards. */
  progress(fraction: number, message: string): void {
    const onBar = this.page === WIZ_BRIDGE || this.pending === WIZ_BRIDGE ||
                  this.page === WIZ_FETCH || this.pending === WIZ_FETCH;
    if (!onBar) {
      return;
    }
    let f = fraction >= 0 ? fraction : 0;
    if (!(f <= 1)) {
      // Covers both "over one" and NaN, which is not >= 0 either but would
      // survive a plain upper-bound test.
      f = f > 1 ? 1 : 0;
    }
    if (f < this.fraction) {
      // A re-sent chunk must not shrink the bar: a bar that goes backwards
      // reads as "it is failing" when nothing has failed.
      f = this.fraction;
    }
    this.fraction = f;
    const percent = Math.round(f * 100);
    const text = message ? message : "";
    if (percent !== this.percent || text !== this.message) {
      this.percent = percent;
      this.message = text;
      this.version++;
    }
  }

  failed(reason: string, detail: string): void {
    const text = detail ? detail : "";
    if (this.reason !== reason || this.detail !== text) {
      this.reason = reason;
      this.detail = text;
      this.version++;
    }
    this.showDetail = false;
    this.retryLeft = autoRetries(reason) ? retrySeconds(this.attemptCount) : 0;
    this.request(WIZ_FAILED);
  }

  worldReady(chars: number, sha1: string): void {
    this.worldChars = chars > 0 ? chars : 0;
    this.worldSha1 = sha1 ? sha1 : "";
    this.reason = "";
    this.retryLeft = 0;
    if (this.firstRun) {
      this.request(WIZ_PLACE);
      return;
    }
    // A wearer who has done this before gets one flash of "READY" and is in
    // the title in about a second, with no press.
    this.holdLeft = HOLD_SECONDS;
    this.request(WIZ_READY);
  }

  /**
   * What the rest of the lens is doing, every frame: where the diorama is, what
   * the Bluetooth pad is up to, and which source is actually driving the
   * buttons. None of this was ever visible to the wearer, which is why "I don't
   * know if the controller works" was a playtest finding rather than a glance.
   */
  observe(placeState: string, padState: string, activeInput: string): void {
    const place = placeState ? placeState : "";
    const pad = padState ? padState : "";
    const input = activeInput ? activeInput : "";
    if (place === this.placeState && pad === this.padState && input === this.activeInput) {
      return;
    }
    this.placeState = place;
    this.padState = pad;
    this.activeInput = input;
    // Only the pages that SHOW these repaint for them. LOOKING and BRIDGE do
    // not, and a surface probe that flips state twice a second while a world
    // downloads must not re-upload the texture behind the progress bar.
    if (this.page === WIZ_PLACE || this.page === WIZ_READY) {
      this.version++;
    }
  }

  // ------------------------------------------------------ the keyboard
  //
  // The system keyboard talks through three callbacks (TextInputSystem's
  // onTextChanged, onKeyboardStateChanged, onReturnKeyPressed); the lens
  // forwards each to one of these. They only take effect on the code page.

  /** The keyboard's whole text, as it stands. Normalised and cut to six. */
  keyboardText(text: string): void {
    if (!this.keyboard) {
      return;
    }
    let clean = normaliseCode(text);
    if (clean.length > CODE_LENGTH) {
      clean = clean.substring(0, CODE_LENGTH);
    }
    if (clean !== this.typed) {
      this.typed = clean;
      this.version++;
    }
  }

  keyboardState(open: boolean): void {
    if (open !== this.keyboardOpen) {
      this.keyboardOpen = open;
      this.version++;
    }
  }

  /** Return on the keyboard: confirms a complete code on the next frame. */
  keyboardReturn(): void {
    this.returnPressed = true;
  }

  private resetCode(): void {
    this.directCodeCell = null;
    this.entry.reset();
    this.typed = "";
    this.returnPressed = false;
  }

  // ----------------------------------------------------------------- step

  /**
   * One frame. Returns WIZ_STAY, or what the lens must do: WIZ_RETRY (run
   * loadWorld again), WIZ_REPLACE (put the diorama down again), WIZ_KEYBOARD
   * (open the system keyboard), WIZ_FETCH_CODE (fetch enteredCode()) or
   * WIZ_DONE (hand over to the title screen).
   */
  step(dt: number, pressedA: boolean, pressedB: boolean, pressedStart: boolean,
       dpad: string = ""): string {
    if (this.finished) {
      // Latched, the OnboardingController precedent: once the wizard is done it
      // reads no more input, so a held button cannot re-enter it.
      return WIZ_DONE;
    }
    this.sincePage += dt;
    if (this.pending !== "" && this.sincePage >= MIN_DWELL) {
      const next = this.pending;
      this.pending = "";
      this.enter(next);
    }

    if (this.page === WIZ_BRIDGE || this.page === WIZ_FETCH) {
      // A and B do nothing here on purpose: an impatient press must not cancel
      // a transfer that is working.
      return WIZ_STAY;
    }
    if (this.page === WIZ_INTRO) {
      if (pressedA) {
        if (this.introStep + 1 >= INTRO_STEPS) {
          this.resetCode();
          this.wantKeyboard = this.keyboard;
          this.enter(WIZ_CODE);
        } else {
          this.introStep++;
          this.version++;
        }
      } else if (pressedB && this.introStep > 0) {
        this.introStep--;
        this.version++;
      }
      return WIZ_STAY;
    }
    if (this.page === WIZ_CODE) {
      return this.keyboard
        ? this.stepSystemKeyboard(pressedA, pressedB, pressedStart)
        : this.stepGrid(dpad, pressedA, pressedB, pressedStart);
    }
    if (this.page === WIZ_FAILED) {
      if (this.retryLeft > 0) {
        const before = Math.ceil(this.retryLeft);
        this.retryLeft = this.retryLeft - dt;
        if (this.retryLeft <= 0) {
          return this.retryAfterFailure();
        }
        if (Math.ceil(this.retryLeft) !== before) {
          this.version++;
        }
      }
      if (pressedA) {
        return this.retryAfterFailure();
      }
      if (pressedB) {
        this.showDetail = !this.showDetail;
        this.version++;
      }
      return WIZ_STAY;
    }
    if (this.page === WIZ_PLACE) {
      if (pressedA) {
        // The last step. The world is loaded, the plate is down: play.
        this.finished = true;
        this.version++;
        return WIZ_DONE;
      }
      if (pressedB) {
        // Stays on the page: the wearer is aiming, and the page is how they
        // see whether the aim took.
        return WIZ_REPLACE;
      }
      if (pressedStart) {
        // Stays on the page: the wearer is holding a pairing button and this
        // page is how they see whether it took.
        return WIZ_RESCAN;
      }
      return WIZ_STAY;
    }
    if (this.page === WIZ_READY) {
      if (pressedA || pressedStart) {
        this.finished = true;
        this.version++;
        return WIZ_DONE;
      }
      if (this.holdLeft > 0) {
        this.holdLeft = this.holdLeft - dt;
        if (this.holdLeft <= 0) {
          this.finished = true;
          this.version++;
          return WIZ_DONE;
        }
      }
      return WIZ_STAY;
    }
    return WIZ_STAY;
  }

  /** The code page on the D-pad grid: the preview, and a device with no keyboard. */
  private stepGrid(dpad: string, pressedA: boolean, pressedB: boolean, pressedStart: boolean): string {
    const direct = this.directCodeCell;
    this.directCodeCell = null;
    // A targeted key owns this frame, even if another input also reports A.
    const typed = direct ? this.entry.selectCell(direct[0], direct[1])
                        : this.entry.step(dpad, pressedA, pressedB, pressedStart);
    if (this.entry.stateVersion() !== this.entryPainted) {
      this.entryPainted = this.entry.stateVersion();
      this.version++;
    }
    if (typed === CODE_DONE) {
      return this.beginFetch(this.entry.code());
    }
    if (typed === CODE_BACK) {
      this.introStep = INTRO_STEPS - 1;
      this.enter(WIZ_INTRO);
    }
    return WIZ_STAY;
  }

  /**
   * The code page on the system keyboard. The page asks for the keyboard
   * once on entry and again on A while it is closed; return or A with six
   * letters fetches; B leaves (a first-run wearer back to the site page, a
   * returning one nowhere), closing the keyboard on the way.
   */
  private stepSystemKeyboard(pressedA: boolean, pressedB: boolean, pressedStart: boolean): string {
    if (this.wantKeyboard) {
      this.wantKeyboard = false;
      return WIZ_KEYBOARD;
    }
    const complete = isValidCode(this.typed);
    if (this.returnPressed) {
      this.returnPressed = false;
      if (complete) {
        return this.beginFetch(this.typed);
      }
      // Return with a short code: the keyboard closed itself, and the page
      // says so; A brings it back.
      return WIZ_STAY;
    }
    if (pressedA || pressedStart) {
      if (complete) {
        return this.beginFetch(this.typed);
      }
      return this.keyboardOpen ? WIZ_STAY : WIZ_KEYBOARD;
    }
    if (pressedB && this.firstRun) {
      this.introStep = INTRO_STEPS - 1;
      this.enter(WIZ_INTRO);
      return WIZ_KEYBOARD_CLOSE;
    }
    return WIZ_STAY;
  }

  /** Asks for a page, once MIN_DWELL has passed. Events only; presses use enter. */
  private request(page: string): void {
    if (page === this.page) {
      this.pending = "";
      return;
    }
    this.pending = page;
    if (this.sincePage >= MIN_DWELL) {
      this.pending = "";
      this.enter(page);
    }
  }

  private enter(page: string): void {
    if (page === this.page) {
      return;
    }
    this.page = page;
    this.directCodeCell = null;
    this.pending = "";
    this.sincePage = 0;
    this.version++;
  }

  private beginRetry(): string {
    this.attemptCount++;
    this.reason = "";
    this.detail = "";
    this.showDetail = false;
    this.retryLeft = 0;
    this.found = "";
    this.fraction = 0;
    this.percent = 0;
    this.message = "";
    this.enter(WIZ_LOOKING);
    return WIZ_RETRY;
  }

  /**
   * What A (or the countdown) does on the failure page, by reason.
   *
   * A code the site does not know is not fixed by asking again: the wearer
   * goes back to the keyboard, with the field cleared. A site that did not
   * answer is asked the same code again -- the code was fine, the network was
   * not. Anything else re-runs the whole search from the top, as before.
   */
  private retryAfterFailure(): string {
    if (this.reason === FAIL_CODE) {
      this.attemptCount++;
      this.reason = "";
      this.detail = "";
      this.showDetail = false;
      this.retryLeft = 0;
      this.resetCode();
      this.wantKeyboard = this.keyboard;
      this.enter(WIZ_CODE);
      return WIZ_STAY;
    }
    if (this.reason === FAIL_NET && this.code.length > 0) {
      this.attemptCount++;
      this.reason = "";
      this.detail = "";
      this.showDetail = false;
      this.retryLeft = 0;
      return this.beginFetch(this.code);
    }
    return this.beginRetry();
  }

  /** Onto the bar, and out to the lens: fetch this code. */
  private beginFetch(code: string): string {
    this.code = code ? code : "";
    this.fraction = 0;
    this.percent = 0;
    this.message = "";
    this.enter(WIZ_FETCH);
    return WIZ_FETCH_CODE;
  }

  // ----------------------------------------------------------------- copy

  title(): string {
    if (this.page === WIZ_FETCH) {
      return "FETCHING";
    }
    if (this.page === WIZ_BRIDGE) {
      return "GETTING WORLD";
    }
    if (this.page === WIZ_INTRO) {
      // "POCKET DIORAMA" is fourteen glyphs and the title row holds thirteen
      // at scale 2; the name is the first body line instead.
      return this.introStep === 0 ? "WELCOME" : "GET CODE";
    }
    if (this.page === WIZ_CODE) {
      return "THE CODE";
    }
    if (this.page === WIZ_FAILED) {
      return "NO WORLD";
    }
    if (this.page === WIZ_PLACE) {
      return "PLACE IT";
    }
    if (this.page === WIZ_READY) {
      return "READY";
    }
    return "SETTING UP";
  }

  lines(): string[] {
    if (this.page === WIZ_BRIDGE) {
      return this.bridgeLines();
    }
    if (this.page === WIZ_FETCH) {
      return this.fetchLines();
    }
    if (this.page === WIZ_INTRO) {
      return this.introLines();
    }
    if (this.page === WIZ_CODE) {
      return this.keyboard ? this.keyboardLines() : this.entry.lines();
    }
    if (this.page === WIZ_FAILED) {
      if (this.showDetail) {
        return this.detailLines();
      }
      const about = this.reason === FAIL_CODE ? this.code
        : this.reason === FAIL_NET ? this.siteLabel() : this.url;
      return remedyFor(this.reason, about, this.bundleId);
    }
    if (this.page === WIZ_PLACE) {
      return this.placeLines();
    }
    if (this.page === WIZ_READY) {
      return this.readyLines();
    }
    return this.lookingLines();
  }

  footer(): string {
    if (this.page === WIZ_BRIDGE || this.page === WIZ_FETCH) {
      return this.percent + "% - PLEASE WAIT";
    }
    if (this.page === WIZ_INTRO) {
      return this.introStep === 0 ? "[A] NEXT" : "[A] ENTER CODE  [B] BACK";
    }
    if (this.page === WIZ_CODE) {
      if (!this.keyboard) {
        return this.entry.footer();
      }
      const back = this.firstRun ? "  [B] BACK" : "";
      if (isValidCode(this.typed)) {
        return "[A] OK" + back;
      }
      return (this.keyboardOpen ? "TYPE IT" : "[A] KEYBOARD") + back;
    }
    if (this.page === WIZ_FAILED) {
      if (this.showDetail) {
        return "[B] BACK";
      }
      if (this.reason === FAIL_CODE) {
        return "[A] ENTER CODE  [B] WHY";
      }
      return this.retryLeft > 0
        ? "[A] NOW  [B] WHY  " + this.retryIn() + "S"
        : "[A] TRY AGAIN  [B] WHY";
    }
    if (this.page === WIZ_PLACE) {
      return "[A] PLAY  [B] PUT DOWN";
    }
    if (this.page === WIZ_READY) {
      return "[A] PLAY";
    }
    return "PLEASE WAIT";
  }

  private lookingLines(): string[] {
    let outcome = "STILL LOOKING...";
    if (this.found === "CACHE") {
      outcome = "FOUND: SAVED COPY";
    } else if (this.found === "BAKED") {
      outcome = "FOUND: BUILT IN COPY";
    }
    return [
      "LOOKING FOR THE WORLD.",
      "",
      "1 SAVED ON THE GLASSES",
      "2 BUILT IN: " + (this.hasBaked ? "YES" : "NO"),
      "3 OVER WI-FI: " + (this.hasInternet ? "YES" : "NO"),
      "",
      outcome,
      // The version, on the first page every launch shows: Snap's checklist
      // wants it visible on launch, and this page is up for at least MIN_DWELL.
      fit(lensBanner().toUpperCase()),
    ];
  }

  /** The site as the pages name it; a stand-in when the lens was given none. */
  private siteLabel(): string {
    return this.site.length > 0 ? this.site.toUpperCase() : "THE WORLD SITE";
  }

  /**
   * The two pages a reviewer with no cartridge reads. Everything a wearer
   * needs to know to get from here to a world, in eight lines each, and
   * nothing that needs a cartridge to be true.
   */
  private introLines(): string[] {
    if (this.introStep === 0) {
      return [
        fit(lensBanner().toUpperCase()),
        "",
        "YOUR GAME BOY WORLD, AS A",
        "VOXEL MODEL ON YOUR TABLE.",
        "",
        "BUILT FROM A CARTRIDGE YOU",
        "OWN. NONE OF IT SHIPS IN",
        "THIS LENS.",
      ];
    }
    return [
      "ON A COMPUTER, OPEN",
      fit(this.siteLabel()),
      "",
      "DROP YOUR .GB DUMP THERE.",
      "IT BAKES YOUR WORLD IN THE",
      "BROWSER AND SHOWS A SIX",
      "LETTER CODE. THE CARTRIDGE",
      "NEVER LEAVES YOUR MACHINE.",
    ];
  }

  /** The keyboard page's words; the boxes themselves are painted, not lines. */
  private keyboardLines(): string[] {
    const shown = this.typed.length > 0 ? this.typed : "------";
    return [
      fit(shown),
      "",
      isValidCode(this.typed) ? "THAT IS SIX. A FETCHES"
        : this.keyboardOpen ? "TYPE THE SIX LETTERS"
        : "PINCH A TO OPEN THE",
      isValidCode(this.typed) ? "YOUR WORLD."
        : this.keyboardOpen ? "ON THE KEYBOARD."
        : "KEYBOARD.",
      "",
      "NO I, O, 0 OR 1: A CODE",
      "NEVER HAS THEM.",
    ];
  }

  private fetchLines(): string[] {
    return [
      fit(this.siteLabel()),
      fit("CODE: " + this.code.toUpperCase()),
      "",
      fit(this.message.toUpperCase()),
      "KEEP THE GLASSES ON WI-FI.",
    ];
  }

  private bridgeLines(): string[] {
    return [
      "FROM YOUR MAC OVER WI-FI",
      fit(this.url.toUpperCase()),
      "",
      fit(this.message.toUpperCase()),
      "BOTH ON THE SAME WI-FI.",
    ];
  }

  /** The error itself, wrapped, with the two identifiers that place it. */
  private detailLines(): string[] {
    const out: string[] = [];
    const body = wrap(this.detail.toUpperCase(), COLUMNS);
    if (body.length === 0) {
      out.push("NO FURTHER DETAIL.");
    }
    for (let i = 0; i < body.length && i < 5; i++) {
      out.push(body[i]);
    }
    out.push("");
    out.push(fit(this.url.toUpperCase()));
    out.push(fit("ID: " + this.bundleId.toUpperCase()));
    return out;
  }

  /** Step 4: where the plate is, what the hands do, and what else is driving. */
  private placeLines(): string[] {
    let first = "THE PLATE: NOT DOWN YET.";
    if (this.placeState === PLACE_SEARCHING) {
      first = "THE PLATE: LOOKING FOR A";
    } else if (this.placeState === PLACE_IN_FRONT) {
      first = "THE PLATE: IN FRONT OF YOU";
    } else if (this.placeState === PLACE_ON_SURFACE) {
      first = "THE PLATE: ON THE TABLE.";
    }
    const second = this.placeState === PLACE_SEARCHING ? "TABLE. LOOK AT ONE."
      : this.placeState === PLACE_IN_FRONT ? "NO SURFACE YET." : "";
    // Five lines for the hands, the two ways of walking first: the page is
    // read once, on the way into the world, and walking is what comes next.
    return [
      first,
      second,
      "PINCH, THEN MOVE TO WALK.",
      "LET GO TO STOP.",
      "PINCH RIM: MOVE WORLD.",
      "TWO HANDS: SIZE + TURN.",
      "SHORT PINCH: A. FRAME: B.",
      fit(this.padLine()),
    ];
  }

  /**
   * The last page's last line: what presses the buttons the hands do not.
   *
   * With a phone or a pad driving, that is said. With neither -- the published
   * lens on a wearer's first run -- it says where B and START will be, because
   * the loose buttons are not on this page to be seen (the Game Boy in front
   * of the wearer has its own) and the game after it is the first place they
   * appear.
   */
  private padLine(): string {
    const driven = this.activeInput === "phone" || this.activeInput === "gamepad";
    if (!driven && (this.padState === PAD_UNAVAILABLE || this.padState === PAD_FAILED)) {
      return "B AND START FLOAT BELOW.";
    }
    let pad = "";
    if (this.padState === PAD_CONNECTED) {
      pad = "PAD: ON";
    } else if (this.padState === PAD_SCANNING) {
      pad = "PAD: LOOKING";
    } else if (this.padState === PAD_FAILED) {
      pad = "PAD: FAILED. START = AGAIN";
    } else if (this.padState === PAD_UNAVAILABLE) {
      pad = "PAD: OFF";
    }
    const driving = "DRIVING: " + (this.activeInput ? this.activeInput.toUpperCase() : "NOTHING");
    return pad.length > 0 ? pad + "  " + driving : driving;
  }

  private readyLines(): string[] {
    return [
      "THE WORLD IS LOADED.",
      "",
      fit("SIZE: " + this.worldChars + " CHARS"),
      fit("ROM: " + (this.worldSha1 ? this.worldSha1.substring(0, 8).toUpperCase() : "UNKNOWN")),
      "",
      fit("DRIVING: " + (this.activeInput ? this.activeInput.toUpperCase() : "NOTHING")),
    ];
  }

  // ---------------------------------------------------------------- paint

  /**
   * A thin renderer over title()/lines()/footer(), so the suite can assert the
   * COPY rather than the pixels for everything except "ink landed on the rows
   * it was supposed to". The grid keyboard paints itself; the system keyboard's
   * page paints its six boxes here.
   */
  paint(canvas: GbCanvas): void {
    if (!canvas) {
      return;
    }
    if (this.page === WIZ_CODE && !this.keyboard) {
      this.entry.paint(canvas);
      drawIcon(canvas, "keyboard", ICON_X, ICON_Y, INK);
      this.paintSteps(canvas);
      return;
    }
    canvas.clear(PAPER);
    const icon = this.iconName();
    if (icon !== "") {
      drawIcon(canvas, icon, ICON_X, ICON_Y, INK);
    }
    // With an icon at the left or dots at the right the title starts after
    // the icon; alone it is centred, as the boot screens centre theirs.
    if (icon !== "" || this.stepNumber() > 0) {
      drawText(canvas, this.title(), TITLE_X_WITH_ICON, TITLE_Y, INK, TITLE_SCALE);
    } else {
      drawCentred(canvas, this.title(), TITLE_Y, INK, TITLE_SCALE);
    }
    this.paintSteps(canvas);
    canvas.fillRect(MARGIN_X, RULE_Y, SCREEN_WIDTH - 2 * MARGIN_X, 1, INK);
    if (this.page === WIZ_CODE) {
      this.paintKeyboardPage(canvas);
      drawText(canvas, this.footer(), MARGIN_X, FOOTER_Y, INK, 1);
      return;
    }
    const body = this.lines();
    const withBar = this.page === WIZ_BRIDGE || this.page === WIZ_FETCH;
    const cap = withBar ? MAX_LINES_WITH_BAR : MAX_LINES;
    for (let i = 0; i < body.length && i < cap; i++) {
      drawText(canvas, body[i], MARGIN_X, BODY_Y + i * LINE_PITCH, INK, 1);
    }
    if (withBar) {
      this.paintBar(canvas);
    }
    drawText(canvas, this.footer(), MARGIN_X, FOOTER_Y, INK, 1);
  }

  /** The four dots, top right, on the pages that are steps. */
  private paintSteps(canvas: GbCanvas): void {
    const n = this.stepNumber();
    if (n > 0) {
      drawSteps(canvas, STEPS_X, STEPS_Y, n, STEP_TOTAL, INK);
    }
  }

  /** Six boxes with the typed letters at scale 2, then the words under them. */
  private paintKeyboardPage(canvas: GbCanvas): void {
    const total = CODE_LENGTH * KEY_FIELD_W + (CODE_LENGTH - 1) * KEY_FIELD_GAP;
    const x0 = Math.round((SCREEN_WIDTH - total) / 2);
    for (let i = 0; i < CODE_LENGTH; i++) {
      const x = x0 + i * (KEY_FIELD_W + KEY_FIELD_GAP);
      const next = i === this.typed.length;
      const thickness = next ? 3 : 1;
      canvas.fillRect(x, KEY_FIELD_Y + KEY_FIELD_H - thickness, KEY_FIELD_W, thickness, INK);
      if (i < this.typed.length) {
        const glyph = this.typed.charAt(i);
        drawText(canvas, glyph, x + Math.round((KEY_FIELD_W - textWidth(glyph, 2)) / 2) + 1,
                 KEY_FIELD_Y + 2, INK, 2);
      }
    }
    const words = this.keyboardLines();
    // The first line is the code itself, already drawn in the boxes.
    for (let i = 2; i < words.length; i++) {
      drawText(canvas, words[i], MARGIN_X, KEY_STATUS_Y + (i - 2) * LINE_PITCH, INK, 1);
    }
  }

  /** An outline of ink and a fill of grey: no large dark field on a see-through display. */
  private paintBar(canvas: GbCanvas): void {
    canvas.fillRect(BAR_X, BAR_Y, BAR_W, 1, INK);
    canvas.fillRect(BAR_X, BAR_Y + BAR_H - 1, BAR_W, 1, INK);
    canvas.fillRect(BAR_X, BAR_Y, 1, BAR_H, INK);
    canvas.fillRect(BAR_X + BAR_W - 1, BAR_Y, 1, BAR_H, INK);
    const filled = Math.round(this.fraction * BAR_INNER);
    if (filled > 0) {
      canvas.fillRect(BAR_X + BAR_INSET, BAR_Y + BAR_INSET,
                      filled, BAR_H - 2 * BAR_INSET, BAR_FILL);
    }
  }

  /** The tallest a body line can sit; the layout test reads it. */
  static bodyBottom(lineCount: number): number {
    return BODY_Y + (lineCount - 1) * LINE_PITCH + GLYPH_H;
  }
}
