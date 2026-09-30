// What the Bluetooth pad is doing, where the wearer is actually looking.
//
// The pad already had a place to say things: setStatus(), which writes one line
// to a Text component hanging at a fixed local (0, 30, 0) off the component
// root. That line is shared with the map name, the active input source and the
// surface search, all of which overwrite it; it is written only on a CHANGE, so
// the one sentence it did produce was gone by the time anyone looked; and it
// does not follow the head, so wherever the wearer turned to hold a pairing
// button, it was not there. The result was reported as "no UI and no
// information about the pad" -- which was exactly true.
//
// So this is its own surface, on the same rule as the message box and the Game
// Boy screen: hung on the line of sight, pitched down, placed once and then
// held until the wearer looks well away (see PanelAnchor). It carries several
// lines rather than one, it is rebuilt only when PadScan says something
// changed, and it goes away once the pad is live -- a panel that stays after
// its job is done is the next thing to complain about.
//
// It draws with Component.Text and the runtime's own font, NOT with GbCanvas
// and the cartridge's. The wearer needs this most when there is no world:
// every other screen in the lens takes its glyphs from the ROM, which is why a
// missing world is a black screen with nothing to read.

import { PanelAnchor } from "./PanelAnchor";

/**
 * Where it hangs.
 *
 * The same 58 cm as the Game Boy screen and the message box, so all three read
 * as one surface at one distance, and further below the axis than either: this
 * is a notice, not the game, and it must not sit on top of the world the
 * wearer is trying to place on a table.
 */
const PANEL_AHEAD_CM: number = 58;
const PANEL_BELOW_VIEW_DEGREES: number = 14;
const RECENTRE_DEGREES: number = 22;
const FOLLOW_SETTLE_SECONDS: number = 0.35;

/**
 * Glyph size, in the same units the lens's existing status line already uses.
 *
 * That line is 32 and is legible on the glasses; this panel carries up to six
 * rows instead of one, so it is smaller by about a fifth to keep the block
 * inside a 51-degree display.
 */
const TEXT_SIZE: number = 26;

/** How long the panel stays up after the pad finally works, to say so. */
export const LINGER_AFTER_LIVE_SECONDS: number = 6;

export class PadStatusPanel {
  private object: SceneObject = null;
  private text: Text = null;
  private anchor: PanelAnchor = new PanelAnchor(
    PANEL_AHEAD_CM, PANEL_BELOW_VIEW_DEGREES, RECENTRE_DEGREES, FOLLOW_SETTLE_SECONDS);
  /** The PadScan version last drawn, so the text is rebuilt only on a change. */
  private drawnVersion: number = -1;

  /**
   * Built defensively: a lens that cannot make a Text component must still
   * boot. The panel is a diagnostic, and a diagnostic that can take the lens
   * down with it is worse than no diagnostic.
   */
  constructor(parent: SceneObject) {
    try {
      this.object = global.scene.createSceneObject("PadStatus");
      this.object.setParent(parent);
      this.text = this.object.createComponent("Component.Text") as Text;
      this.text.text = "";
      this.text.size = TEXT_SIZE;
      // Read, not rendered into the world: it hangs nearer the eye than the
      // table the diorama stands on, and depth-tested it would be cut in half
      // by the furniture. The Game Boy screen carries the same note.
      this.text.depthTest = false;
      this.text.twoSided = true;
      // A plate behind the glyphs. Text alone is legible over a dark tabletop
      // and gone over a sunlit one, and this panel exists precisely for the
      // moments when the wearer cannot find anything else to read.
      this.text.backgroundSettings.enabled = true;
      this.object.enabled = false;
    } catch (e) {
      print("[PadStatusPanel] unavailable: " + e);
      this.object = null;
      this.text = null;
    }
  }

  isEnabled(): boolean {
    return this.object !== null && this.object.enabled;
  }

  setEnabled(on: boolean): void {
    if (!this.object) {
      return;
    }
    if (this.object.enabled === on) {
      return;
    }
    this.object.enabled = on;
    if (on) {
      // Whatever it was showing belongs to whoever read it last.
      this.drawnVersion = -1;
    }
  }

  /**
   * Puts `lines` on the panel, but only when `version` has moved.
   *
   * PadScan bumps that version on a transition, on a new sighting, on a report
   * and once per second of the countdown -- not once per frame -- so the string
   * is rebuilt about as often as it actually reads differently.
   */
  show(lines: string[], version: number): void {
    if (!this.text) {
      return;
    }
    if (version === this.drawnVersion) {
      return;
    }
    this.drawnVersion = version;
    let block = "";
    for (let i = 0; i < lines.length; i++) {
      block = block + (i > 0 ? "\n" : "") + lines[i];
    }
    this.text.text = block;
  }

  /** Keeps it in front of the reader. Call every frame it is enabled. */
  follow(camera: Camera, dt: number): void {
    if (!this.object || !this.object.enabled || !camera) {
      return;
    }
    this.anchor.place(this.object, camera, dt);
  }
}
