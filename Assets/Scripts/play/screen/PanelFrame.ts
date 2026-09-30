// A SPECS frame behind the battle box, from the UI Kit.
//
// Everything this lens draws it draws itself, out of the cartridge's own four
// greys, and that is the right answer for the game: a Game Boy box with a Game
// Boy font in it. It is the wrong answer for the EDGE of that box. On an
// optical see-through display a quad simply stops, and a panel that stops has
// no shadow, no bevel and no border -- it reads as a decal on the room rather
// than as a surface hanging in it.
//
// UIKit's RoundedRectangle is the piece of the kit worth having here: a rounded
// plate with a border, and no interaction machinery attached. BackPlate, the
// component actually meant for this, drags in SIK's Interactable and
// InteractionPlane to draw a rectangle, and it fills that rectangle with an
// opaque dark gradient -- which is the reference's own rejected answer, "opaak
// zou het witte veld terug zijn onder een andere naam". So this uses the
// visual and not the component.
//
// It is DECORATION, in the strict sense: if the package is missing, if the
// component cannot be made, if any of it throws, the lens draws exactly what it
// drew before. Nothing downstream reads this.
//
// The 5.23 project carries UIKit 2.x; the generated 5.15 project carries no
// UI Kit at all (make515.sh copies SIK and nothing else), so on the glasses
// this loads nothing and the box stands without a frame. Where a 5.15 build
// does have the kit (0.1.4), the two RoundedRectangle files differ by 250
// lines and their public accessors are identical, checked on 8 September.

/**
 * The kit's RoundedRectangle, or null where the package is not installed.
 *
 * A require inside a try rather than an import at the top, for the reason the
 * Bluetooth pad and the phone controller are loaded the same way: an import
 * is resolved when the lens is COMPILED, so a project without the package
 * would not lose the frame, it would lose the lens. The device project
 * carries SIK and not UI Kit, and its compile gate (make515.sh gate) is what
 * found this.
 */
function loadRoundedRectangle(): any {
  try {
    const module: any = require("SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle");
    return module && module.RoundedRectangle ? module.RoundedRectangle : null;
  } catch (e) {
    return null;
  }
}

/**
 * How far the frame stands out past the panel it backs, in centimetres.
 *
 * The box is eighteen columns of text with a one-tile border of its own, so the
 * frame is not there to hold the text -- it is there to end. A centimetre and a
 * half is enough to read as a mount and not so much that it becomes a slab.
 */
export const FRAME_MARGIN_CM: number = 1.5;
/** Corner radius, in centimetres. */
export const FRAME_CORNER_CM: number = 1.2;
/** How thick the lit edge is. */
export const FRAME_BORDER: number = 0.06;

/**
 * Dark, and barely there.
 *
 * The reference gives each battle panel a frosted-glass plate -- the world
 * behind it blurred, 55% coverage, 26% tint -- and we cannot blur passthrough,
 * so the honest half of that is the coverage. 0.42 is dark enough to lift the
 * white box off whatever is behind it and light enough that the table still
 * shows through, which is the whole reason the box is not opaque already.
 */
const FRAME_RGBA: number[] = [0.04, 0.05, 0.07, 0.42];
/** The edge. Brighter than the plate, and still not white. */
const BORDER_RGBA: number[] = [0.72, 0.76, 0.84, 0.55];

/**
 * Drawn behind the panel and in front of the world.
 *
 * The message panel is 101 and the Game Boy screen is 100, and those two are
 * never up at once -- one is the diorama's box and the other is the flat
 * screen. 100 is therefore free whenever this exists at all.
 */
const FRAME_RENDER_ORDER: number = 100;

export class PanelFrame {
  private object: SceneObject = null;
  private plate: any = null;
  private failed: boolean = false;

  /**
   * Makes the frame under `parent`, or quietly does nothing.
   *
   * The object is created DISABLED and enabled at the end. A component's
   * lifecycle runs inline at createComponent, and a component whose inputs are
   * checked before this code can set them throws from inside the call -- see
   * AGENTS.md. RoundedRectangle's inputs all carry defaults, so this is belt as
   * well as braces, and the belt costs one line.
   */
  constructor(parent: SceneObject) {
    if (!parent) {
      this.failed = true;
      return;
    }
    const RoundedRectangle = loadRoundedRectangle();
    if (!RoundedRectangle) {
      print("[PanelFrame] no UI Kit in this project; the box has no frame");
      this.failed = true;
      return;
    }
    try {
      this.object = global.scene.createSceneObject("PanelFrame");
      this.object.setParent(parent);
      this.object.enabled = false;
      this.plate = this.object.createComponent(RoundedRectangle.getTypeName());
      this.plate.cornerRadius = FRAME_CORNER_CM;
      this.plate.backgroundColor =
        new vec4(FRAME_RGBA[0], FRAME_RGBA[1], FRAME_RGBA[2], FRAME_RGBA[3]);
      this.plate.border = true;
      this.plate.borderSize = FRAME_BORDER;
      this.plate.borderColor =
        new vec4(BORDER_RGBA[0], BORDER_RGBA[1], BORDER_RGBA[2], BORDER_RGBA[3]);
      this.plate.renderOrder = FRAME_RENDER_ORDER;
    } catch (e) {
      // A project without the package, or a version whose component cannot be
      // made this way. Say so once and draw nothing; the box is still a box.
      print("[PanelFrame] no UI Kit frame: " + e);
      this.failed = true;
      if (this.object) {
        this.object.destroy();
        this.object = null;
      }
      this.plate = null;
    }
  }

  get available(): boolean {
    return !this.failed && this.plate !== null;
  }

  /**
   * Puts the frame behind a panel: same place, same facing, a hair further
   * from the eye, and margin bigger all round.
   *
   * `behind` is in centimetres along the panel's own forward, which is what
   * keeps the two from fighting for the same depth. The panel draws with depth
   * testing off, so this is about draw order and not about z -- but a frame
   * exactly coincident with the panel still shimmers when the head moves,
   * because the two quads round to different pixels.
   */
  follow(panel: SceneObject, widthCm: number, heightCm: number, behindCm: number): void {
    if (!this.available || !panel) {
      return;
    }
    const at = panel.getTransform();
    const frame = this.object.getTransform();
    const rotation = at.getWorldRotation();
    const back = rotation.multiplyVec3(new vec3(0, 0, -behindCm));
    const where = at.getWorldPosition();
    frame.setWorldRotation(rotation);
    frame.setWorldPosition(new vec3(where.x + back.x, where.y + back.y, where.z + back.z));
    this.plate.size = new vec2(widthCm + FRAME_MARGIN_CM * 2,
                               heightCm + FRAME_MARGIN_CM * 2);
  }

  setEnabled(on: boolean): void {
    if (this.object) {
      this.object.enabled = on && this.available;
    }
  }
}
