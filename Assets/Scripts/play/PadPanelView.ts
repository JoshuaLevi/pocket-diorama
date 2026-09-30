// The Game Boy face plate in the scene: the mesh, the colliders, SIK, and the
// lazy follow that keeps it within reach.
//
// Everything that can be decided without a scene lives in PadPanel.ts. This
// file only turns that layout into quads and hit volumes and forwards presses
// to the PanelSource, so a fault here is a fault of drawing or wiring, never of
// what a button means.
//
// The hit volumes themselves -- the collider, the SIK Interactable, and how a
// hand, the mouse and a leaving cursor each press and release -- are
// Pressable.ts, shared with the Game Boy the setup pages live in.

import type { FontAtlas } from "./script/DialogueBox";
import { glyphUv } from "./script/DialogueBox";
import type { PadButton } from "./PadPanel";
import {
  PanelSource, padLayout, dpadHub,
  BUTTON_RISE_CM, BUTTON_SUNK_CM, PLATE_WIDTH_CM, PLATE_HEIGHT_CM,
  MINI_PLATE_WIDTH_CM, MINI_PLATE_HEIGHT_CM, miniLayout,
  TEXEL_PLATE, TEXEL_COUNT,
} from "./PadPanel";
import { loadPressableKit, makePressable } from "./Pressable";

const STRIDE: number = 5; // position(3) + texture0(2)

/** The palette, one texel each, in TEXEL_* order. A Game Boy lying on its back. */
const PALETTE: number[][] = [
  [200, 196, 188], // plate
  [160, 156, 150], // plate shade
  [48, 44, 50],    // d-pad
  [24, 22, 26],    // d-pad pressed
  [168, 42, 108],  // A / B
  [110, 26, 72],   // A / B pressed
  [92, 88, 96],    // SELECT / START
  [50, 48, 54],    // SELECT / START pressed
];

/**
 * Where the plate rides: ahead of the eye, and in the view JUST UNDER THE
 * WORLD, tilted up to face you.
 *
 * The angle is taken from the diorama, not fixed: a fixed drop was in the lap
 * on the glasses (out of a display that shows thirteen degrees below the eye
 * line) and across the world in the editor. Hanging it a few degrees below the
 * direction of the world's centre puts it under the near edge wherever the
 * world is, and clamped so a dive to life-size cannot swing it out of reach.
 * The editor's cap is lower because its default camera frames only about
 * twenty degrees down; there the plate may overlap the near rim a little.
 */
const FOLLOW_AHEAD_CM: number = 55;
const PAD_BELOW_WORLD_DEGREES: number = 9;
const PAD_MIN_DEGREES: number = 12;
const PAD_MAX_DEGREES: number = 40;
const PAD_MAX_EDITOR_DEGREES: number = 15;
const PLATE_TILT_DEGREES: number = 40;

function isEditor(): boolean {
  try {
    const system: any = (global as any).deviceInfoSystem;
    return !!(system && system.isEditor && system.isEditor());
  } catch (e) {
    return false;
  }
}
/** The plate re-centres only once the head has moved this far from its spot. */
const FOLLOW_DEADBAND_CM: number = 14;
/** Fraction of the remaining distance closed per second, as a time constant. */
const FOLLOW_SETTLE_SECONDS: number = 0.35;

/** Glyph size for the labels, in centimetres. */
const LABEL_CM: number = 0.7;

/** Collider depth: a finger has to be able to push in without leaving it. */
const HIT_DEPTH_CM: number = 2.5;
const HIT_MARGIN_CM: number = 0.5;

interface ButtonMesh {
  button: PadButton;
  /** First vertex of this button's quads in the builder. */
  firstVertex: number;
  pressed: boolean;
}

export class PadPanelView {
  private root: SceneObject;

  /**
   * Parent `object` to the plate, `aboveCm` beyond its far edge in the
   * plate's own plane, so it tilts and follows with the pad and is never
   * behind it. The message box and the menu live here: a box left at the
   * diorama's origin lay inside the ground, exactly behind the pad, and a
   * whole intro went by unseen.
   */
  attachAbove(object: SceneObject, aboveCm: number, scale: number, widthCm: number): void {
    object.setParent(this.root);
    const t = object.getTransform();
    t.setLocalRotation(quat.quatIdentity());
    t.setLocalScale(new vec3(scale, scale, scale));
    // Glyph surfaces draw rightward and downward from their origin: centre them.
    t.setLocalPosition(new vec3(-widthCm / 2, this.plateHeight / 2 + aboveCm, 0.4));
  }
  private source: PanelSource;
  private builder: MeshBuilder;
  private mesh: RenderMesh;
  private buttons: ButtonMesh[] = [];
  private paintedVersion: number = -1;
  private following: boolean = false;
  private buttonsWired: number = 0;
  private reportedScreen: boolean = false;
  private frames: number = 0;

  /**
   * `prepareMaterial` clones the lens's base material around a texture the
   * way the atlas materials are made: nearest filtering, no depth write. The
   * label material is the dialogue font's, already prepared.
   */
  /** The buttons this plate carries: the Game Boy face, or the MINI strip. */
  private layout: PadButton[];
  private plateWidth: number;
  private plateHeight: number;
  private mini: boolean;

  constructor(
    parent: SceneObject,
    source: PanelSource,
    prepareMaterial: (texture: Texture) => Material,
    labels: FontAtlas,
    labelMaterial: Material,
    mini: boolean = false
  ) {
    this.source = source;
    this.mini = mini;
    this.layout = mini ? miniLayout() : padLayout();
    this.plateWidth = mini ? MINI_PLATE_WIDTH_CM : PLATE_WIDTH_CM;
    this.plateHeight = mini ? MINI_PLATE_HEIGHT_CM : PLATE_HEIGHT_CM;
    this.root = global.scene.createSceneObject(mini ? "PadMini" : "Pad");
    this.root.setParent(parent);

    const plateObject = global.scene.createSceneObject("PadPlate");
    plateObject.setParent(this.root);
    this.buildPlate(plateObject, prepareMaterial(PadPanelView.buildPalette()));

    if (labels && labelMaterial) {
      const labelObject = global.scene.createSceneObject("PadLabels");
      labelObject.setParent(this.root);
      this.buildLabels(labelObject, labels, labelMaterial);
    }
    this.buildHitVolumes();
  }

  /** How many buttons got a working SIK interactable. Zero means keyboard only. */
  wiredButtons(): number {
    return this.buttonsWired;
  }

  setEnabled(enabled: boolean): void {
    this.root.enabled = enabled;
  }

  /** The palette as an 8x1 texture, sampled at texel centres for flat colour. */
  static buildPalette(): Texture {
    const rgba = new Uint8Array(TEXEL_COUNT * 4);
    for (let i = 0; i < TEXEL_COUNT; i++) {
      rgba[i * 4] = PALETTE[i][0];
      rgba[i * 4 + 1] = PALETTE[i][1];
      rgba[i * 4 + 2] = PALETTE[i][2];
      rgba[i * 4 + 3] = 255;
    }
    const texture = ProceduralTextureProvider.createWithFormat(
      TEXEL_COUNT, 1, TextureFormat.RGBA8Unorm
    );
    (texture.control as ProceduralTextureProvider).setPixels(0, 0, TEXEL_COUNT, 1, rgba);
    return texture;
  }

  private static texelU(texel: number): number {
    return (texel + 0.5) / TEXEL_COUNT;
  }

  /**
   * Per frame: repaint pressed buttons when the state changed, and keep the
   * plate ahead of the wearer. Snaps on the first frame, then eases only once
   * the head has really moved, so it does not swim while you are playing.
   */
  follow(camera: Camera, dt: number, worldCentre: vec3): void {
    this.frames++;
    if (this.source.stateVersion() !== this.paintedVersion) {
      this.repaint();
    }
    if (!camera) {
      return;
    }
    const ct = camera.getTransform();
    const eye = ct.getWorldPosition();
    const fwd = ct.forward;
    // The camera looks down -forward. Flatten so a glance at the floor does not
    // drag the pad under it.
    let hx = -fwd.x;
    let hz = -fwd.z;
    const hl = Math.sqrt(hx * hx + hz * hz);
    if (hl < 1e-4) {
      return;
    }
    hx /= hl;
    hz /= hl;
    const angle = PadPanelView.padAngle(eye, worldCentre);
    const target = new vec3(
      eye.x + hx * FOLLOW_AHEAD_CM * Math.cos(angle),
      eye.y - FOLLOW_AHEAD_CM * Math.sin(angle),
      eye.z + hz * FOLLOW_AHEAD_CM * Math.cos(angle)
    );

    const transform = this.root.getTransform();
    const here = transform.getWorldPosition();
    const away = here.distance(target);
    let next = here;
    if (!this.following) {
      next = target;
      this.following = true;
    } else if (away > FOLLOW_DEADBAND_CM) {
      const k = 1 - Math.exp(-dt / FOLLOW_SETTLE_SECONDS);
      next = new vec3(here.x + (target.x - here.x) * k,
                      here.y + (target.y - here.y) * k,
                      here.z + (target.z - here.z) * k);
    } else {
      return;
    }
    transform.setWorldPosition(next);
    this.orientToward(eye, next);
  }

  /** Radians below the eye line at which the plate hangs, given where the world is. */
  static padAngle(eye: vec3, worldCentre: vec3): number {
    const maxDeg = isEditor() ? PAD_MAX_EDITOR_DEGREES : PAD_MAX_DEGREES;
    let deg = PAD_MAX_DEGREES;
    if (worldCentre) {
      const dx = worldCentre.x - eye.x;
      const dz = worldCentre.z - eye.z;
      const flat = Math.sqrt(dx * dx + dz * dz);
      const down = eye.y - worldCentre.y;
      deg = Math.atan2(down, Math.max(flat, 1)) * 180 / Math.PI + PAD_BELOW_WORLD_DEGREES;
    }
    deg = deg < PAD_MIN_DEGREES ? PAD_MIN_DEGREES : deg > maxDeg ? maxDeg : deg;
    return deg * Math.PI / 180;
  }

  /**
   * Tilts the plate up toward the eye. Built from a basis rather than Euler
   * angles: the plate's local +Z is its top-facing normal, and this makes
   * that normal point PLATE_TILT_DEGREES above the horizontal toward the wearer.
   */
  private orientToward(eye: vec3, at: vec3): void {
    let hx = eye.x - at.x;
    let hz = eye.z - at.z;
    const hl = Math.sqrt(hx * hx + hz * hz);
    if (hl < 1e-4) {
      return;
    }
    hx /= hl;
    hz /= hl;
    const tilt = PLATE_TILT_DEGREES * Math.PI / 180;
    // n = up * cos(tilt) + h * sin(tilt); r = up x h; u = n x r.
    const n = new vec3(hx * Math.sin(tilt), Math.cos(tilt), hz * Math.sin(tilt));
    const r = new vec3(hz, 0, -hx);
    const u = n.cross(r);
    const transform = this.root.getTransform();
    let rotation = quat.lookAt(n, u);
    transform.setWorldRotation(rotation);
    // lookAt's convention differs between engines; if it pointed the plate the
    // other way, the buttons would rise into the table. Check and flip.
    const f = transform.forward;
    if (f.x * n.x + f.y * n.y + f.z * n.z < 0) {
      rotation = quat.lookAt(new vec3(-n.x, -n.y, -n.z), u);
      transform.setWorldRotation(rotation);
    }
  }

  /**
   * Once settled, say where each button is on screen, so an editor gesture
   * (InjectPreviewGesture) can find them without guessing from a screenshot.
   */
  reportScreenPositions(camera: Camera): void {
    if (this.reportedScreen || !camera || this.frames < 45) {
      return;
    }
    this.reportedScreen = true;
    let line = "[pad] on screen:";
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i].button;
      const world = this.root.getTransform().getWorldTransform()
        .multiplyPoint(new vec3(b.x, b.y, BUTTON_RISE_CM));
      const s = camera.worldSpaceToScreenSpace(world);
      line += " " + b.name + "=" + s.x.toFixed(3) + "," + s.y.toFixed(3);
    }
    print(line);
  }

  // ------------------------------------------------------------------ mesh

  private buildPlate(object: SceneObject, material: Material): void {
    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;

    const verts: number[] = [];
    const indices: number[] = [];
    let quads = 0;

    const push = (corners: number[][], texel: number): void => {
      const u = PadPanelView.texelU(texel);
      const base = quads * 4;
      for (let i = 0; i < 4; i++) {
        verts.push(corners[i][0], corners[i][1], corners[i][2], u, 0.5);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      quads++;
    };

    // The plate, with a shaded border a little larger behind it for an edge.
    const hw = this.plateWidth / 2;
    const hh = this.plateHeight / 2;
    const rim = 0.5;
    push([[-hw - rim, -hh - rim, -0.4], [hw + rim, -hh - rim, -0.4],
          [hw + rim, hh + rim, -0.4], [-hw - rim, hh + rim, -0.4]], TEXEL_PLATE + 1);
    push([[-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0]], TEXEL_PLATE);

    // The cross's hub first, so it draws under the four arms' sides.
    if (!this.mini) {
      this.pushButtonQuads(push, dpadHub(), false);
    }
    const layout = this.layout;
    for (let i = 0; i < layout.length; i++) {
      this.buttons.push({ button: layout[i], firstVertex: quads * 4, pressed: false });
      this.pushButtonQuads(push, layout[i], false);
    }

    this.builder.appendVerticesInterleaved(verts);
    this.builder.appendIndices(indices);
    this.mesh = this.builder.getMesh();
    this.builder.updateMesh();

    const visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = this.mesh;
    visual.mainMaterial = material;
  }

  /** Five quads: the top and four sides. Sides take the pressed (darker) texel. */
  private pushButtonQuads(push: (corners: number[][], texel: number) => void,
                          b: PadButton, pressed: boolean): void {
    const quadsFor = PadPanelView.buttonQuads(b, pressed);
    for (let i = 0; i < quadsFor.length; i++) {
      push(quadsFor[i].corners, quadsFor[i].texel);
    }
  }

  /** The geometry of one button in its current state, top first. */
  static buttonQuads(b: PadButton, pressed: boolean): { corners: number[][]; texel: number }[] {
    const x0 = b.x - b.width / 2;
    const x1 = b.x + b.width / 2;
    const y0 = b.y - b.height / 2;
    const y1 = b.y + b.height / 2;
    const z = pressed ? BUTTON_SUNK_CM : BUTTON_RISE_CM;
    const top = pressed ? b.pressedTexel : b.texel;
    const side = b.pressedTexel;
    return [
      { corners: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], texel: top },
      { corners: [[x0, y0, 0], [x1, y0, 0], [x1, y0, z], [x0, y0, z]], texel: side },
      { corners: [[x1, y1, 0], [x0, y1, 0], [x0, y1, z], [x1, y1, z]], texel: side },
      { corners: [[x0, y1, 0], [x0, y0, 0], [x0, y0, z], [x0, y1, z]], texel: side },
      { corners: [[x1, y0, 0], [x1, y1, 0], [x1, y1, z], [x1, y0, z]], texel: side },
    ];
  }

  private repaint(): void {
    this.paintedVersion = this.source.stateVersion();
    let changed = false;
    for (let i = 0; i < this.buttons.length; i++) {
      const entry = this.buttons[i];
      const pressed = this.source.isHeld(entry.button.name);
      if (pressed === entry.pressed) {
        continue;
      }
      entry.pressed = pressed;
      changed = true;
      const quads = PadPanelView.buttonQuads(entry.button, pressed);
      let v = entry.firstVertex;
      for (let q = 0; q < quads.length; q++) {
        const u = PadPanelView.texelU(quads[q].texel);
        for (let c = 0; c < 4; c++) {
          const p = quads[q].corners[c];
          this.builder.setVertexInterleaved(v, [p[0], p[1], p[2], u, 0.5]);
          v++;
        }
      }
    }
    if (changed) {
      this.builder.updateMesh();
    }
  }

  // ---------------------------------------------------------------- labels

  private buildLabels(object: SceneObject, atlas: FontAtlas, material: Material): void {
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    const verts: number[] = [];
    const indices: number[] = [];
    let quads = 0;
    const layout = this.layout;
    for (let i = 0; i < layout.length; i++) {
      const b = layout[i];
      if (b.label === "") {
        continue;
      }
      const startX = b.x + b.labelX - (b.label.length * LABEL_CM) / 2;
      const y0 = b.y + b.labelY - LABEL_CM / 2;
      for (let c = 0; c < b.label.length; c++) {
        const glyph = atlas.lookup[b.label.charAt(c)];
        if (typeof glyph !== "number") {
          continue;
        }
        const uv = glyphUv(atlas, glyph);
        const x0 = startX + c * LABEL_CM;
        const base = quads * 4;
        verts.push(x0, y0, 0.05, uv[0], uv[1]);
        verts.push(x0 + LABEL_CM, y0, 0.05, uv[2], uv[1]);
        verts.push(x0 + LABEL_CM, y0 + LABEL_CM, 0.05, uv[2], uv[3]);
        verts.push(x0, y0 + LABEL_CM, 0.05, uv[0], uv[3]);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        quads++;
      }
    }
    if (quads === 0) {
      return;
    }
    builder.appendVerticesInterleaved(verts);
    builder.appendIndices(indices);
    const mesh = builder.getMesh();
    builder.updateMesh();
    // Retained on the object so the builder outlives this call.
    (object as any).__labelBuilder = builder;
    const visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = mesh;
    visual.mainMaterial = material;
  }

  // ----------------------------------------------------------- hit volumes

  private buildHitVolumes(): void {
    const kit = loadPressableKit("Pad");
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i].button;
      const made = makePressable(kit, this.root, {
        name: b.name, x: b.x, y: b.y, z: BUTTON_RISE_CM / 2,
        width: b.width + HIT_MARGIN_CM, height: b.height + HIT_MARGIN_CM, depth: HIT_DEPTH_CM,
      }, this.source, "Pad");
      if (made.wired) {
        this.buttonsWired++;
      }
    }
  }
}
