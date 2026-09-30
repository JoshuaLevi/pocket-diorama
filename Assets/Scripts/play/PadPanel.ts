// A Game Boy face plate as an input source.
//
// Pure: the layout in centimetres, what is held, what went down this frame, and
// what a key or a button means. The scene objects, the colliders and the SIK
// wiring are in PadPanelView.ts and never here, which is what makes the whole
// exchange testable in Node -- and what the lens's own input contract already
// asked for (see InputSource.ts).
//
// Why a panel at all: the pad and the phone do not exist in the Lens Studio
// preview, and hands only moved the diorama. There was no way to press A. This
// is the one device that works everywhere -- a finger on the glasses, the mouse
// in the editor, an injected gesture from a test -- so it is also what makes the
// lens playable with no hardware and therefore publishable.
//
// One thing decides most of the design: not every way of pressing a button can
// let go of it. A hand fires a release when the pinch opens. The editor's mouse
// interactor has been measured to deliver the press and never the release. A
// keyboard repeats the press while held and may or may not send the release.
// So a press carries how long it is good for: until released, or for a pulse
// that expires on its own and is extended by every repeat.

import type { DPadState, InputSource } from "./InputSource";
import { emptyDPad } from "./InputSource";

export const BUTTON_UP: string = "up";
export const BUTTON_DOWN: string = "down";
export const BUTTON_LEFT: string = "left";
export const BUTTON_RIGHT: string = "right";
export const BUTTON_A: string = "a";
export const BUTTON_B: string = "b";
export const BUTTON_START: string = "start";
export const BUTTON_SELECT: string = "select";

export const ALL_BUTTONS: string[] = [
  BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT,
  BUTTON_A, BUTTON_B, BUTTON_START, BUTTON_SELECT,
];

/** A press that stays down until release() is called for it. */
export const HOLD_UNTIL_RELEASED: number = -1;

/**
 * A mouse press in the preview: one pulse, long enough for a turn and a step
 * (a step is 0.26 s), short enough that one click is one step.
 */
export const MOUSE_PULSE_SECONDS: number = 0.32;

/**
 * A key press: the same pulse as a click, for the same reason -- a turn is
 * 0.11 s and a step 0.26 s, and one press should be one step when facing
 * that way and a turn-and-step when not, while staying under the menu's
 * 0.4 s repeat delay so one press is one cursor move. Auto-repeat, where the
 * editor forwards it, extends the pulse; a release event, where it arrives,
 * ends it early.
 */
export const KEY_PULSE_SECONDS: number = 0.32;

/**
 * The plate, in centimetres. A Game Boy is nine by fifteen; this is wider and
 * shorter because only the face matters. At the distance it rides (55 cm) the
 * width is twenty degrees of view -- a real handheld held out -- where the
 * first cut, 24 cm at 40 cm, filled the whole display.
 */
/**
 * The least a press stays down once released. A tap whose press and release
 * land in the same frame -- an injected key, a quick poke on a slow frame --
 * would otherwise be down for zero frames and move nothing. Two frames at
 * twenty a second.
 */
export const MIN_PRESS_SECONDS: number = 0.1;

export const PLATE_WIDTH_CM: number = 19;
export const PLATE_HEIGHT_CM: number = 8.8;
/** How far a button top stands off the plate, and how far it sinks when pressed. */
export const BUTTON_RISE_CM: number = 0.6;
export const BUTTON_SUNK_CM: number = 0.15;

/** Palette texels, in the order PadPanelView paints them. */
export const TEXEL_PLATE: number = 0;
export const TEXEL_PLATE_SHADE: number = 1;
export const TEXEL_DPAD: number = 2;
export const TEXEL_DPAD_PRESSED: number = 3;
export const TEXEL_AB: number = 4;
export const TEXEL_AB_PRESSED: number = 5;
export const TEXEL_PILL: number = 6;
export const TEXEL_PILL_PRESSED: number = 7;
export const TEXEL_COUNT: number = 8;

export interface PadButton {
  name: string;
  /** Centre, in plate-local centimetres; +x right, +y up, origin at the middle. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Printed beside or under the button, in the cartridge's own font. */
  label: string;
  /** Where the label goes, relative to the button centre. */
  labelX: number;
  labelY: number;
  texel: number;
  pressedTexel: number;
}

function button(name: string, x: number, y: number, width: number, height: number,
                label: string, labelX: number, labelY: number,
                texel: number, pressedTexel: number): PadButton {
  return { name: name, x: x, y: y, width: width, height: height, label: label,
           labelX: labelX, labelY: labelY, texel: texel, pressedTexel: pressedTexel };
}

/**
 * The Game Boy layout: a cross on the left, B and A rising to the right, and
 * SELECT and START as two pills low in the middle. Sizes are what a fingertip
 * can hit from arm's length without the neighbours overlapping.
 */
const CROSS_ARM_CM: number = 1.9;   // one arm of the cross
const CROSS_X_CM: number = -6.0;    // cross centre
const CROSS_Y_CM: number = 0.5;

export function padLayout(): PadButton[] {
  const arm = CROSS_ARM_CM;
  const cx = CROSS_X_CM;
  const cy = CROSS_Y_CM;
  const round = 2.7;    // A and B
  const pillW = 3.0;
  const pillH = 1.0;
  return [
    button(BUTTON_UP, cx, cy + arm, arm, arm, "", 0, 0, TEXEL_DPAD, TEXEL_DPAD_PRESSED),
    button(BUTTON_DOWN, cx, cy - arm, arm, arm, "", 0, 0, TEXEL_DPAD, TEXEL_DPAD_PRESSED),
    button(BUTTON_LEFT, cx - arm, cy, arm, arm, "", 0, 0, TEXEL_DPAD, TEXEL_DPAD_PRESSED),
    button(BUTTON_RIGHT, cx + arm, cy, arm, arm, "", 0, 0, TEXEL_DPAD, TEXEL_DPAD_PRESSED),
    button(BUTTON_B, 4.0, -0.2, round, round, "B", 0, -2.0, TEXEL_AB, TEXEL_AB_PRESSED),
    button(BUTTON_A, 7.4, 1.1, round, round, "A", 0, -2.0, TEXEL_AB, TEXEL_AB_PRESSED),
    button(BUTTON_SELECT, -2.1, -3.1, pillW, pillH, "SELECT", 0, -1.1, TEXEL_PILL, TEXEL_PILL_PRESSED),
    button(BUTTON_START, 1.6, -3.1, pillW, pillH, "START", 0, -1.1, TEXEL_PILL, TEXEL_PILL_PRESSED),
  ];
}

/**
 * The MINI plate: B, SELECT and START, and nothing else.
 *
 * With pinch-to-walk (RouteSource) the cross is the ground itself and A is a
 * pinch off the world, so the only buttons a hand still needs are the three
 * the pinch cannot say. A strip a third the size, for the OPTION page's
 * PAD = MINI, so the plate stops standing between the wearer and the diorama.
 */
export const MINI_PLATE_WIDTH_CM: number = 11;
export const MINI_PLATE_HEIGHT_CM: number = 6.4;

export function miniLayout(): PadButton[] {
  const round = 2.7;
  const pillW = 3.0;
  const pillH = 1.0;
  return [
    button(BUTTON_B, -3.0, 0.6, round, round, "B", 0, -2.0, TEXEL_AB, TEXEL_AB_PRESSED),
    button(BUTTON_SELECT, 2.4, 1.5, pillW, pillH, "SELECT", 0, -1.1, TEXEL_PILL, TEXEL_PILL_PRESSED),
    button(BUTTON_START, 2.4, -1.1, pillW, pillH, "START", 0, -1.1, TEXEL_PILL, TEXEL_PILL_PRESSED),
  ];
}

/** The centre piece of the cross, drawn but not pressable. */
export function dpadHub(): PadButton {
  return button("hub", CROSS_X_CM, CROSS_Y_CM, CROSS_ARM_CM, CROSS_ARM_CM, "", 0, 0,
                TEXEL_DPAD, TEXEL_DPAD);
}

/**
 * Keyboard, for the editor. Arrows walk, and so do I J K L because the
 * Interactive Preview also steers its camera with the arrows. Z is A and X is
 * B, the way every emulator has it. Space is START, Shift is SELECT.
 *
 * The names are the members of the runtime's Keys enum, which is what
 * KeyboardKeys.ts resolves them against; an unknown key is "".
 */
export function keyToButton(keyName: string): string {
  if (keyName === "Left" || keyName === "J") return BUTTON_LEFT;
  if (keyName === "Right" || keyName === "L") return BUTTON_RIGHT;
  if (keyName === "Up" || keyName === "I") return BUTTON_UP;
  if (keyName === "Down" || keyName === "K") return BUTTON_DOWN;
  if (keyName === "Z") return BUTTON_A;
  if (keyName === "X") return BUTTON_B;
  if (keyName === "Space") return BUTTON_START;
  if (keyName === "Shift") return BUTTON_SELECT;
  return "";
}

export class PanelSource implements InputSource {
  readonly name: string = "panel";

  /** button -> seconds of hold left, or HOLD_UNTIL_RELEASED. Absent when up. */
  private held: any = {};
  /** Buttons released but still down for the minimum press: a new press edges again. */
  private lingering: any = {};
  /** Edges queued by press(), delivered for exactly one frame by update(). */
  private queuedA: boolean = false;
  private queuedB: boolean = false;
  private queuedStart: boolean = false;
  private queuedSelect: boolean = false;
  private frameA: boolean = false;
  private frameB: boolean = false;
  private frameStart: boolean = false;
  private frameSelect: boolean = false;
  /** Set for good by the first press. Connected means somebody is using it. */
  private everReported: boolean = false;
  /** Bumped by every state change, so a view can repaint only when needed. */
  private version: number = 0;
  /**
   * Seconds since the last press from anything. A hand's pinch ON a button is
   * also a pinch to the hand tracker, whose own A arrives at release; a press
   * this recent tells PokemonAR to drop that A. Huge before the first press.
   */
  private sincePress: number = 1e9;

  /**
   * A button goes down. `seconds` is how long the press stays good for on its
   * own: HOLD_UNTIL_RELEASED for a hand, a pulse for the mouse or a key. A
   * repeat of a pulsed press extends it rather than firing a second edge, which
   * is what keeps a key's auto-repeat from spamming A.
   */
  press(buttonName: string, seconds: number): void {
    if (ALL_BUTTONS.indexOf(buttonName) < 0) {
      return;
    }
    this.everReported = true;
    this.sincePress = 0;
    const wasDown = this.isHeld(buttonName) && !this.lingering[buttonName];
    this.held[buttonName] = seconds;
    delete this.lingering[buttonName];
    if (!wasDown) {
      this.version++;
      if (buttonName === BUTTON_A) this.queuedA = true;
      else if (buttonName === BUTTON_B) this.queuedB = true;
      else if (buttonName === BUTTON_START) this.queuedStart = true;
      else if (buttonName === BUTTON_SELECT) this.queuedSelect = true;
    }
  }

  /**
   * A button comes up. It stays down for MIN_PRESS_SECONDS if it was pressed
   * more recently than that, so a same-frame press-and-release is still seen.
   */
  release(buttonName: string): void {
    if (!this.isHeld(buttonName)) {
      return;
    }
    const left = this.held[buttonName];
    if (left === HOLD_UNTIL_RELEASED || left > MIN_PRESS_SECONDS) {
      this.held[buttonName] = MIN_PRESS_SECONDS;
    }
    this.lingering[buttonName] = true;
  }

  /** Lets go at once, with no minimum: for a view that is being torn down. */
  releaseNow(buttonName: string): void {
    delete this.lingering[buttonName];
    if (this.isHeld(buttonName)) {
      delete this.held[buttonName];
      this.version++;
    }
  }

  releaseAll(): void {
    for (let i = 0; i < ALL_BUTTONS.length; i++) {
      this.releaseNow(ALL_BUTTONS[i]);
    }
  }

  /** Seconds since any button was last pressed, by hand, mouse or key. */
  secondsSincePress(): number {
    return this.sincePress;
  }

  isHeld(buttonName: string): boolean {
    return typeof this.held[buttonName] === "number";
  }

  /**
   * Whether any button is down right now, by hand, mouse or key.
   *
   * `secondsSincePress` answers for a tap; this answers for a HOLD, which
   * outlasts any clock: a D-pad arm held to scroll a list is a hand on a
   * button for as long as it is down.
   */
  anyHeld(): boolean {
    for (let i = 0; i < ALL_BUTTONS.length; i++) {
      if (this.isHeld(ALL_BUTTONS[i])) {
        return true;
      }
    }
    return false;
  }

  /** Changes on every press or release; a view compares it to its last paint. */
  stateVersion(): number {
    return this.version;
  }

  /** Runs the pulse clocks. Call once per frame with the real frame time. */
  tick(dt: number): void {
    this.sincePress += dt > 0 ? dt : 0;
    for (let i = 0; i < ALL_BUTTONS.length; i++) {
      const name = ALL_BUTTONS[i];
      const left = this.held[name];
      if (typeof left !== "number" || left === HOLD_UNTIL_RELEASED) {
        continue;
      }
      if (left - dt <= 0) {
        this.releaseNow(name);
      } else {
        this.held[name] = left - dt;
      }
    }
  }

  update(): void {
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
    const pad = emptyDPad();
    pad.up = this.isHeld(BUTTON_UP);
    pad.down = this.isHeld(BUTTON_DOWN);
    pad.left = this.isHeld(BUTTON_LEFT);
    pad.right = this.isHeld(BUTTON_RIGHT);
    return pad;
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
    return this.everReported;
  }
}
