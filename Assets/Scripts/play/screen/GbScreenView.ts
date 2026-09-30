// The Game Boy screen in the scene: one quad, one 160x144 texture.
//
// Everything the boot screens, the naming grid and the dex entry draw lands in
// a GbCanvas; this uploads it when it changed and keeps the quad where the
// wearer can read it. It is as portable as the tile atlas because it is the
// same mechanism: ProceduralTextureProvider.setPixels on an ImageMaterialPreset
// clone, and nothing else.
//
// It used to float 22 cm over the DIORAMA's anchor. That holds only while the
// world is where it was put: zoom, drag or walk and the screen goes with the
// table rather than staying with the reader, which is how a dex entry was
// reported as "positioned randomly" and the naming grid ended up beside the
// room. It now hangs off the head by the same rule as the message box, at the
// same distance and with glyphs the same size, so the two surfaces read as one
// screen that sometimes shows more than its bottom six rows.

import type { GbCanvas } from "./GbCanvas";
import { SCREEN_WIDTH, SCREEN_HEIGHT, DMG_GREYS } from "./GbCanvas";
import { PanelAnchor } from "./PanelAnchor";

/**
 * The screen's size and place in the room.
 *
 * The width is the message panel's, so one 8x8 glyph subtends the same angle on
 * both surfaces -- about 1.3 degrees, twice what headset guidance calls
 * comfortable. The whole screen is then 22.8 degrees tall, so it hangs only 2
 * degrees below the line of sight: any lower and its bottom rows fall out of a
 * 51-degree display, which is the fault the message box had at 20.
 */
const SCREEN_WIDTH_CM: number = 26;
const SCREEN_HEIGHT_CM: number = SCREEN_WIDTH_CM * SCREEN_HEIGHT / SCREEN_WIDTH;
const SCREEN_AHEAD_CM: number = 58;
const SCREEN_BELOW_VIEW_DEGREES: number = 2;
const RECENTRE_DEGREES: number = 14;
const FOLLOW_SETTLE_SECONDS: number = 0.35;

/** The screen's angular size and placement, in degrees. Pure; the test reads it. */
export function screenAnglesDegrees(): number[] {
  const toDegrees = 180 / Math.PI;
  return [
    SCREEN_BELOW_VIEW_DEGREES,
    Math.atan2(SCREEN_HEIGHT_CM / 2, SCREEN_AHEAD_CM) * toDegrees,
    Math.atan2(SCREEN_WIDTH_CM / 2, SCREEN_AHEAD_CM) * toDegrees,
  ];
}

export class GbScreenView {
  private object: SceneObject;
  private texture: Texture;
  private rgba: Uint8Array = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  private builder: MeshBuilder;
  private uploadedVersion: number = -1;
  private anchor: PanelAnchor;
  /**
   * Whether the shades past the Game Boy's four are honoured: "nothing here"
   * and the frosted plate. A screen is paper and wants none of it; a panel
   * standing beside the world wants all of it, because the world is behind it
   * and that is the point of standing it there.
   */
  private panel: boolean;
  /** A screen that has just come back is placed outright rather than drifting in. */
  private needsSnap: boolean = true;
  /**
   * The object the anchor places: the quad itself, or the housing the quad
   * was mounted in (GameBoyShell), so the whole Game Boy hangs where the bare
   * screen used to and the quad rides in its window.
   */
  private placed: SceneObject;
  private widthCm: number;

  /**
   * `widthCm` and `aheadCm` are the surface's size and its distance from the
   * eye, and they default to the Game Boy screen's own. The graphics page
   * passes its own: it hangs off to one side, where every degree it spends on
   * width is a degree of world the wearer does not get.
   */
  constructor(parent: SceneObject, prepareMaterial: (texture: Texture) => Material,
              widthCm: number = SCREEN_WIDTH_CM, aheadCm: number = SCREEN_AHEAD_CM,
              panel: boolean = false, name: string = "GbScreen") {
    this.panel = panel;
    this.anchor = new PanelAnchor(
      aheadCm, SCREEN_BELOW_VIEW_DEGREES, RECENTRE_DEGREES, FOLLOW_SETTLE_SECONDS);
    this.object = global.scene.createSceneObject(name);
    this.object.setParent(parent);
    this.placed = this.object;
    this.widthCm = widthCm;
    this.texture = ProceduralTextureProvider.createWithFormat(
      SCREEN_WIDTH, SCREEN_HEIGHT, TextureFormat.RGBA8Unorm
    );
    // The first frame must not show whatever the provider allocated.
    (this.texture.control as ProceduralTextureProvider).setPixels(
      0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, this.rgba);

    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;
    const hw = widthCm / 2;
    const hh = widthCm * SCREEN_HEIGHT / SCREEN_WIDTH / 2;
    this.builder.appendVerticesInterleaved([
      -hw, -hh, 0, 0, 0,
      hw, -hh, 0, 1, 0,
      hw, hh, 0, 1, 1,
      -hw, hh, 0, 0, 1,
    ]);
    this.builder.appendIndices([0, 1, 2, 0, 2, 3]);
    const mesh = this.builder.getMesh();
    this.builder.updateMesh();

    const visual = this.object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    // Drawn after the world, and with depth off in the material: this is a
    // surface the wearer reads, and it hangs nearer the eye than the table the
    // diorama sits on. Depth-tested, the floor and the furniture cut it in
    // half -- which is exactly what a playtest saw.
    visual.renderOrder = 100;
    visual.mesh = mesh;
    visual.mainMaterial = prepareMaterial(this.texture);
    this.object.enabled = false;
  }

  /**
   * Mounts the quad in a housing: reparented under `mount`, scaled so its
   * width is `lcdWidthCm`, and from now on the anchor places `housing`
   * rather than the quad, `aheadCm` from the eye when that is given. The
   * screen's own on/off follows the housing's.
   */
  mountIn(housing: SceneObject, mount: SceneObject, lcdWidthCm: number, aheadCm: number = 0): void {
    this.anchor.setAhead(aheadCm);
    this.object.setParent(mount);
    const t = this.object.getTransform();
    const s = lcdWidthCm / this.widthCm;
    t.setLocalPosition(vec3.zero());
    t.setLocalRotation(quat.quatIdentity());
    t.setLocalScale(new vec3(s, s, s));
    this.placed = housing;
    housing.enabled = this.object.enabled;
    this.needsSnap = true;
  }

  /** Whether the quad rides in a housing rather than hanging on its own. */
  mounted(): boolean {
    return this.placed !== this.object;
  }

  setEnabled(enabled: boolean): void {
    if (enabled && !this.object.enabled) {
      // Wherever it was left is where the last reader stood. Place it at the
      // reader who is here now, without a visible drift across the room.
      this.needsSnap = true;
    }
    this.object.enabled = enabled;
    if (this.placed !== this.object) {
      this.placed.enabled = enabled;
    }
    if (!enabled) {
      // Force a fresh upload when it comes back; the canvas may have been
      // redrawn from scratch for a different screen in between.
      this.uploadedVersion = -1;
    }
  }

  isEnabled(): boolean {
    return this.object.enabled;
  }

  /** Local space for controls drawn on this surface. */
  surfaceObject(): SceneObject {
    return this.object;
  }

  /** Hides the quad alone, leaving a housing where it is: the LCD "off". */
  setQuadVisible(visible: boolean): void {
    this.object.enabled = visible;
    if (!visible) {
      this.uploadedVersion = -1;
    }
  }

  /** Uploads the canvas if it changed since the last upload. */
  upload(canvas: GbCanvas, paletteForRow: (row: number) => number[][]): void {
    if (canvas.stateVersion() === this.uploadedVersion) {
      return;
    }
    this.uploadedVersion = canvas.stateVersion();
    if (this.panel) {
      canvas.toPanelRgba(this.rgba, DMG_GREYS);
    } else {
      canvas.toRgba(this.rgba, paletteForRow);
    }
    (this.texture.control as ProceduralTextureProvider).setPixels(
      0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, this.rgba);
  }

  /**
   * Stands the surface at a fixed point of the room instead of on the line of
   * sight, held relative to `space` so that dragging or turning the world
   * brings it along -- and, because PanelAnchor keeps the offset in
   * centimetres, so that rescaling the world does not throw it across the room.
   *
   * Called ONCE, when the surface is put up. Calling it every frame would be
   * the head-tracked panel PanelAnchor exists to switch off.
   */
  pinAt(space: SceneObject, world: vec3): void {
    this.anchor.pinTo(space, PanelAnchor.offsetFrom(space, world));
    this.needsSnap = true;
  }

  /** Back to the line of sight, which is where every other screen hangs. */
  unpin(): void {
    this.anchor.unpin();
    this.needsSnap = true;
  }

  /**
   * Hangs the screen in front of the wearer and holds it there, fetching it
   * back only once they have looked well away. See PanelAnchor for the rule.
   */
  place(camera: Camera, dt: number): void {
    if (this.needsSnap) {
      this.needsSnap = false;
      this.anchor.snapTo(this.placed, camera);
      return;
    }
    this.anchor.place(this.placed, camera, dt);
  }
}
