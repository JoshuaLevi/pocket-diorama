// The message box as a panel in the room, in the cartridge's own frame.
//
// DIORAMA mode used to draw dialogue as loose glyph quads riding the pad
// plate: no frame, no paper, each word its own white strip, and the font
// atlas sampled bilinearly so the pixels were soft. The reference mod solved
// the same problem by keeping the original box -- border and all -- and
// pinning it in space rather than floating it over whoever is speaking.
//
// So this is the GAME BOY screen's mechanism cropped to the box: the exact
// six tile rows the cartridge draws its message box on (CanvasTextBox's
// BOX_TY..BOX_TY+BOX_TH), on one quad, one texture, nearest sampled. The
// typing pace, the blinking arrow and the page clears all come from
// CanvasTextBox unchanged, which is the same code GAME BOY mode and the
// intro already prove against PyBoy frames.

import type { GbCanvas } from "./GbCanvas";
import { SCREEN_WIDTH, SCREEN_HEIGHT, TILE } from "./GbCanvas";
import { BOX_TY, BOX_TH } from "./CanvasTextBox";
import { PanelAnchor } from "./PanelAnchor";

/**
 * The panel's width in the world.
 *
 * At the distance below this spans about 25 degrees, so it sits inside the
 * glasses' field of view with room either side, and one 8x8 glyph subtends
 * about 1.3 degrees -- twice the angle a headset's own guidance calls
 * comfortable for text.
 */
const PANEL_WIDTH_CM: number = 26;
/** The cropped rows, in pixels. */
export const CROP_TOP: number = BOX_TY * TILE;
export const CROP_HEIGHT: number = BOX_TH * TILE;
const PANEL_HEIGHT_CM: number = PANEL_WIDTH_CM * CROP_HEIGHT / SCREEN_WIDTH;
/**
 * The same panel showing the WHOLE screen.
 *
 * The cartridge draws plenty outside its message box -- a YES/NO, a menu, the
 * battle's own boxes -- and those used to be hung as loose quads wherever they
 * fell, which is what a playtest saw as menus scattered across the room. There
 * is one surface, and it grows when the ROM needs more than six rows.
 *
 * Growing DOWNWARD would put the extra rows past the bottom of the display, so
 * the panel rises instead: at full height it hangs FULL_BELOW_VIEW_DEGREES
 * below the line of sight rather than PANEL_BELOW_VIEW_DEGREES, which keeps its
 * bottom rows -- the message box itself -- at very nearly the height they were
 * already being read at.
 */
const FULL_HEIGHT_CM: number = PANEL_WIDTH_CM * SCREEN_HEIGHT / SCREEN_WIDTH;


/**
 * Where the panel sits: ahead of the wearer and low in their view, like the
 * box along the bottom of a Game Boy screen.
 *
 * Not on the diorama. The world can be dragged, scaled and walked across, so
 * anything anchored to it drifts out of the frame the moment the wearer zooms
 * -- and hanging it over the speaker is exactly what the reference stopped
 * doing in 2.0.8. This is the one thing that must always be readable, so it is
 * the one thing that follows the head.
 */
const PANEL_AHEAD_CM: number = 58;
/**
 * How far below the LINE OF SIGHT the panel hangs -- not below the eye.
 *
 * Below the eye was wrong the moment the wearer looked down at the table:
 * a point at eye height 58 cm away is then high above the middle of the
 * view, so the box and the menu floated over the horizon with the world at
 * their feet. Measured from where the wearer is actually looking, the panel
 * lands in the lower part of the view wherever they turn, which is where a
 * Game Boy keeps its box.
 */
const PANEL_BELOW_VIEW_DEGREES: number = 9;

/**
 * Half the display's vertical field of view, in degrees.
 *
 * SPECS is 51 degrees on the diagonal, which is about 31 vertical on its
 * aspect, so roughly 15 degrees above the line of sight and 15 below. That
 * number is what the angle above has to answer to, and 20 did not: the box
 * subtends 7.7 degrees at PANEL_AHEAD_CM, so its top edge sat 16 degrees down
 * -- past the bottom of the display, with the whole box outside it. It was
 * reported as "the offset is too low, I can almost never read the text", which
 * is exactly what a box you can only see by tipping your head looks like.
 *
 * At 9 the box spans 5.2 to 12.9 degrees below the sight line: entirely inside
 * the display with a couple of degrees to spare, and still low enough to leave
 * the middle of the view to the world. test/messagepanel.test.mjs holds this.
 */
export const DISPLAY_HALF_FOV_DEGREES: number = 15;
/**
 * What holds still while the panel grows: its BOTTOM edge.
 *
 * The message box is the thing being read, and it lives at the bottom of the
 * Game Boy's screen. Fix the bottom edge and the box stays exactly where the
 * wearer's eye already is whether the panel is six rows or eighteen; everything
 * the panel gains, it gains upward, into a part of the view that was empty.
 */
const PANEL_BOTTOM_DEGREES: number = PANEL_BELOW_VIEW_DEGREES +
  Math.atan2(PANEL_HEIGHT_CM / 2, PANEL_AHEAD_CM) * 180 / Math.PI;

/**
 * How far off the line of sight the panel may drift before it is re-placed,
 * and how long it takes to get there.
 *
 * The reference went the other way and back again: its dialogue boxes were
 * head-tracked, then in 2.1.2 "pinned and no longer head tracked", because a
 * panel that rides every small head movement cannot be read. Pinning alone has
 * the opposite fault -- turn around and the text is behind you. So the panel is
 * placed once, when the box opens, and then stays where it was put until the
 * wearer has looked well away from it.
 */
const RECENTRE_DEGREES: number = 14;
const FOLLOW_SETTLE_SECONDS: number = 0.35;

/**
 * Where the panel sits and how big it looks, in degrees: how far below the line
 * of sight its centre hangs, then its half-height and half-width at the
 * distance it is placed. Pure, and the only reason it is exported is that the
 * geometry above is a claim about what the wearer can see, which is worth a
 * test rather than a comment.
 */
export function panelAnglesDegrees(): number[] {
  return cropAnglesDegrees(CROP_TOP, CROP_HEIGHT);
}

/**
 * The same three angles for any crop of the screen, in pixels: how far below
 * the line of sight its centre hangs, its half-height and its half-width.
 * Pure, and the reason it is exported is that "the panel grows upward, never
 * out of the display" is a claim worth a test rather than a comment.
 */
export function cropAnglesDegrees(top: number, height: number): number[] {
  const toDegrees = 180 / Math.PI;
  const heightCm = PANEL_WIDTH_CM * height / SCREEN_WIDTH;
  const belowCm = PANEL_WIDTH_CM * (SCREEN_HEIGHT - (top + height)) / SCREEN_WIDTH;
  const halfHeight = Math.atan2(heightCm / 2, PANEL_AHEAD_CM) * toDegrees;
  const gap = Math.atan2(belowCm, PANEL_AHEAD_CM) * toDegrees;
  return [
    PANEL_BOTTOM_DEGREES - gap - halfHeight,
    halfHeight,
    Math.atan2(PANEL_WIDTH_CM / 2, PANEL_AHEAD_CM) * toDegrees,
  ];
}

export class MessagePanelView {
  private object: SceneObject;
  private texture: Texture;
  private rgba: Uint8Array = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  /** The window of the screen the quad shows, in pixels. Starts as the box. */
  private cropTop: number = CROP_TOP;
  private cropHeight: number = CROP_HEIGHT;
  private builder: MeshBuilder;
  private uploadedVersion: number = -1;
  /** Where it hangs and how it follows; shared with the Game Boy screen. */
  private anchor: PanelAnchor = new PanelAnchor(
    PANEL_AHEAD_CM, PANEL_BELOW_VIEW_DEGREES, RECENTRE_DEGREES, FOLLOW_SETTLE_SECONDS);

  constructor(parent: SceneObject, prepareMaterial: (texture: Texture) => Material) {
    this.object = global.scene.createSceneObject("MessagePanel");
    this.object.setParent(parent);
    // One texture, the whole screen: the crop is a window onto it, chosen by
    // the quad's UVs, so growing to full size costs no reallocation.
    this.texture = ProceduralTextureProvider.createWithFormat(
      SCREEN_WIDTH, SCREEN_HEIGHT, TextureFormat.RGBA8Unorm
    );
    (this.texture.control as ProceduralTextureProvider).setPixels(
      0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, this.rgba);

    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;
    const hw = PANEL_WIDTH_CM / 2;
    const hh = PANEL_HEIGHT_CM / 2;
    // The box's rows, as a window onto the full-screen texture. V runs up while
    // the canvas runs down, so the box -- rows 12 to 17 -- is at the BOTTOM.
    const vBottom = 1 - (CROP_TOP + CROP_HEIGHT) / SCREEN_HEIGHT;
    const vTop = 1 - CROP_TOP / SCREEN_HEIGHT;
    this.builder.appendVerticesInterleaved([
      -hw, -hh, 0, 0, vBottom,
      hw, -hh, 0, 1, vBottom,
      hw, hh, 0, 1, vTop,
      -hw, hh, 0, 0, vTop,
    ]);
    this.builder.appendIndices([0, 1, 2, 0, 2, 3]);
    const mesh = this.builder.getMesh();
    this.builder.updateMesh();

    const visual = this.object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    // Drawn after the world, and with depth off in the material: this is a
    // surface the wearer reads, and it hangs nearer the eye than the table the
    // diorama sits on. Depth-tested, the floor and the furniture cut it in
    // half -- which is exactly what a playtest saw.
    visual.renderOrder = 101;
    visual.mesh = mesh;
    visual.mainMaterial = prepareMaterial(this.texture);
    this.object.enabled = false;
  }

  /** The panel's own object, for whoever hangs something beside it. */
  /**
   * How wide and tall the panel is DRAWING right now, in centimetres.
   *
   * The crop is a window onto one texture and the quad is rebuilt to match it,
   * so this changes when the box grows to hold a yes/no or the whole screen.
   * Anything hanging behind the panel has to change with it.
   */
  drawnSizeCm(): number[] {
    return [PANEL_WIDTH_CM, PANEL_WIDTH_CM * this.cropHeight / SCREEN_WIDTH];
  }

  sceneObject(): SceneObject {
    return this.object;
  }

  setEnabled(enabled: boolean): void {
    this.object.enabled = enabled;
    if (!enabled) {
      this.uploadedVersion = -1;
    }
  }

  isEnabled(): boolean {
    return this.object.enabled;
  }

  /**
   * Shows a window of tile rows instead of the message box's six.
   *
   * `topRow` and `rows` are in 8-pixel tile rows, as the cartridge counts them,
   * so the YES/NO box at row 7 is `setCropRows(7, 11)` -- from its own top edge
   * down to the bottom of the screen. The panel keeps its bottom edge where it
   * was and grows upward; see PANEL_BOTTOM_DEGREES.
   *
   * Cheap and idempotent: the texture already holds the whole screen, so this
   * rewrites four vertices and the angle it hangs at, and nothing else.
   */
  setCropRows(topRow: number, rows: number): void {
    const top = topRow * TILE;
    const height = rows * TILE;
    if (top === this.cropTop && height === this.cropHeight) {
      return;
    }
    this.cropTop = top;
    this.cropHeight = height;
    const heightCm = PANEL_WIDTH_CM * height / SCREEN_WIDTH;
    const hw = PANEL_WIDTH_CM / 2;
    const hh = heightCm / 2;
    // V runs up while the canvas runs down.
    const vBottom = 1 - (top + height) / SCREEN_HEIGHT;
    const vTop = 1 - top / SCREEN_HEIGHT;
    this.builder.setVertexInterleaved(0, [-hw, -hh, 0, 0, vBottom]);
    this.builder.setVertexInterleaved(1, [hw, -hh, 0, 1, vBottom]);
    this.builder.setVertexInterleaved(2, [hw, hh, 0, 1, vTop]);
    this.builder.setVertexInterleaved(3, [-hw, hh, 0, 0, vTop]);
    this.builder.updateMesh();
    // A crop that does not reach the bottom of the screen hangs that much
    // higher; the box's own crop does, so its drop is unchanged.
    const belowScreen = SCREEN_HEIGHT - (top + height);
    const belowCm = PANEL_WIDTH_CM * belowScreen / SCREEN_WIDTH;
    const halfHeightDegrees = Math.atan2(hh, PANEL_AHEAD_CM) * 180 / Math.PI;
    const gapDegrees = Math.atan2(belowCm, PANEL_AHEAD_CM) * 180 / Math.PI;
    this.anchor.setDrop(PANEL_BOTTOM_DEGREES - gapDegrees - halfHeightDegrees);
  }

  /** The whole 160x144, or back to the message box's six rows. */
  setFull(full: boolean): void {
    if (full) {
      this.setCropRows(0, SCREEN_HEIGHT / TILE);
    } else {
      this.setCropRows(BOX_TY, BOX_TH);
    }
  }

  /**
   * The texture this panel uploads the canvas into.
   *
   * Handed to the battle's HUD blocks so they can show their own rectangles of
   * the same screen without a second texture and a second upload: the whole
   * canvas goes up here every time it changes, and a block is only a quad with
   * different UVs onto it.
   */
  sharedTexture(): Texture {
    return this.texture;
  }

  /** Whether the whole screen is showing rather than the message box alone. */
  isFull(): boolean {
    return this.cropTop === 0 && this.cropHeight === SCREEN_HEIGHT;
  }

  /** The crop currently showing, in pixels: [top, height]. For the tests. */
  crop(): number[] {
    return [this.cropTop, this.cropHeight];
  }

  /**
   * Uploads the canvas if it changed.
   *
   * The whole screen goes up, not just the box: which part of it the wearer
   * sees is the quad's business (setFull), and uploading the lot means growing
   * the panel never shows a stale row. GbCanvas stores row 0 at the top and the
   * texture wants it at the bottom, so this walks it the way toRgba does.
   */
  upload(canvas: GbCanvas, greys: number[][]): void {
    if (canvas.stateVersion() === this.uploadedVersion) {
      return;
    }
    this.uploadedVersion = canvas.stateVersion();
    // The panel shades -- nothing here, frosted glass, the HP bar's three --
    // live in GbCanvas with the shades themselves; the graphics page beside
    // the diorama draws on the same ones.
    canvas.toPanelRgba(this.rgba, greys);
    (this.texture.control as ProceduralTextureProvider).setPixels(
      0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, this.rgba);
  }

  /**
   * Holds the panel where it was put, and fetches it back only once the wearer
   * has looked well away from it. Square to the eye throughout. The rule lives
   * in PanelAnchor, because the Game Boy screen obeys the same one.
   */
  place(camera: Camera, dt: number): void {
    this.anchor.place(this.object, camera, dt);
  }

  /**
   * Hangs the panel at a fixed point of the diorama for the length of a fight,
   * instead of on the wearer's line of sight.
   *
   * The point is taken from where the line of sight would have put it right
   * now, so the box lands exactly where it always lands -- readable, below the
   * axis -- and then stops moving. Held as an offset from the diorama in
   * CENTIMETRES, so dragging or turning the model mid-fight brings the box
   * along and RESCALING it does not fling the box away (see PanelAnchor).
   *
   * Take the pin only when the diorama has stopped moving. A fight flies the
   * world at the wearer over half a second and then holds it; a pin taken on
   * the first frame of that flight is measured against where the world used to
   * be, and lands wherever the flight leaves it.
   */
  pinToDiorama(space: SceneObject, camera: Camera): void {
    if (!space || !camera || this.anchor.pinned()) {
      return;
    }
    const world = this.anchor.lineOfSight(camera);
    this.anchor.pinTo(space, PanelAnchor.offsetFrom(space, world));
  }

  /** Back to following the head. */
  unpin(): void {
    this.anchor.unpin();
  }

  pinned(): boolean {
    return this.anchor.pinned();
  }

  /**
   * Puts the panel where it belongs at once, with no settle. Called when a box
   * opens, which is the moment the wearer is looking at the world rather than
   * at the panel: place it then and it stays put for as long as they read it.
   */
  snapTo(camera: Camera): void {
    this.anchor.snapTo(this.object, camera);
  }
}
