// The editor's keyboard as a Game Boy pad.
//
// Preview only, and deliberately loose about the API: the 5.15 device SDK has
// no KeyPressEvent and no Keys enum, so everything here is resolved by name at
// runtime and fails to "unavailable" instead of failing to compile. On the
// glasses there is no keyboard and this binds nothing.
//
// A held key arrives as a stream of repeated presses; whether the release ever
// arrives is not something to depend on. So a press is a short pulse that each
// repeat extends (PanelSource does the timing), and a release, when it does
// come, ends it early.

import { KEY_PULSE_SECONDS, PanelSource, keyToButton } from "./PadPanel";

/**
 * The Keys enum as declared for Lens Studio 5.23, by ordinal, for the members
 * this pad reads. Used only when the runtime does not expose the enum object
 * itself; the runtime's own values win whenever they can be read.
 */
const FALLBACK_CODES: any = {
  "2": "Left", "3": "Up", "4": "Right", "5": "Down", "6": "Shift", "10": "Space",
  "29": "I", "30": "J", "31": "K", "32": "L", "35": "O", "36": "P",
  "44": "X", "46": "Z",
};

const WANTED: string[] = ["Left", "Up", "Right", "Down", "Shift", "Space",
                          "I", "J", "K", "L", "O", "P", "X", "Z"];

/**
 * Keys that are not pad buttons: the view controls the glasses do with a
 * pinch. O zooms out, P zooms in -- both sit under the same hand as IJKL, and
 * the preview has no gesture to pinch with.
 */
export const VIEW_KEY_ZOOM_OUT: string = "O";
export const VIEW_KEY_ZOOM_IN: string = "P";

function viewKeyOf(keyName: string): string {
  return keyName === VIEW_KEY_ZOOM_OUT || keyName === VIEW_KEY_ZOOM_IN ? keyName : "";
}

export class KeyboardKeys {
  /** numeric key code -> Keys member name, for the members that mean something. */
  private names: any = {};
  private fromRuntime: boolean = false;

  /**
   * Binds the two key events through `createEvent`, which is the component's
   * own createEvent so the events belong to it. Returns false where the
   * runtime has no keyboard events at all.
   */
  bind(createEvent: (name: string) => any, source: PanelSource,
       onViewKey: (key: string) => void): boolean {
    let press: any = null;
    let release: any = null;
    try {
      press = createEvent("KeyPressEvent");
      release = createEvent("KeyReleaseEvent");
    } catch (e) {
      return false;
    }
    if (!press) {
      return false;
    }
    this.resolveNames();
    press.bind((event: any) => {
      const name = this.nameOf(event);
      const view = viewKeyOf(name);
      if (view !== "") {
        // A held key repeats; a zoom step per repeat is what makes holding the
        // key zoom smoothly, so this deliberately does not edge-trigger.
        if (onViewKey) {
          onViewKey(view);
        }
        return;
      }
      const button = keyToButton(name);
      if (button !== "") {
        source.press(button, KEY_PULSE_SECONDS);
      }
    });
    if (release) {
      release.bind((event: any) => {
        const name = this.nameOf(event);
        if (viewKeyOf(name) !== "") {
          return;
        }
        const button = keyToButton(name);
        if (button !== "") {
          source.release(button);
        }
      });
    }
    return true;
  }

  /** Whether the key codes came from the runtime's enum or the baked table. */
  usesRuntimeCodes(): boolean {
    return this.fromRuntime;
  }

  private nameOf(event: any): string {
    const code = event && typeof event.key === "number" ? event.key : -1;
    const name = this.names[String(code)];
    return typeof name === "string" ? name : "";
  }

  private resolveNames(): void {
    const enumObject: any = (global as any).Keys;
    this.names = {};
    if (enumObject) {
      for (let i = 0; i < WANTED.length; i++) {
        const value = enumObject[WANTED[i]];
        if (typeof value === "number") {
          this.names[String(value)] = WANTED[i];
          this.fromRuntime = true;
        }
      }
    }
    if (!this.fromRuntime) {
      for (const code in FALLBACK_CODES) {
        this.names[code] = FALLBACK_CODES[code];
      }
    }
  }
}
