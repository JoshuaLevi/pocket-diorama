// The pad, hanging where the phone is.
//
// A lens cannot draw on the Spectacles App's controller screen -- it is given
// touches, the touchpad's size, the phone's pose and the phone's haptics, and
// no canvas -- so the buttons are drawn in the GLASSES, on a quad at the
// phone's own position and at the size the phone says its touch surface is.
// Look down and a Game Boy pad is lying on the handset; the zone under your
// thumb lights up, and the thumb that is covering it feels a tick.
//
// It faces the wearer rather than lying in the phone's own plane. The pose is
// there to say WHERE, and a picture you are meant to read should not also be
// asking you to hold the phone at the right angle -- that is the same argument
// the message box settled, on a surface that moves a great deal more.

import { GbCanvas } from "./GbCanvas";
import type { GbFont } from "./GbCanvas";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "./GbCanvas";
import { paintPhonePad } from "./PhonePadLayout";

/** A phone's touch surface, for a build that will not say. Roughly a handset. */
const DEFAULT_WIDTH_CM: number = 7;
const DEFAULT_HEIGHT_CM: number = 14;

/**
 * Lifted off the phone toward the wearer, in centimetres.
 *
 * Drawn exactly at the pose, the pad fights the phone's own screen for the same
 * pixels and the two flicker against each other. A hand's width in front is
 * enough to separate them and near enough to still read as lying on it.
 */
const LIFT_CM: number = 4;

export class PhonePadView {
  private object: SceneObject;
  private texture: Texture;
  private rgba: Uint8Array = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  private builder: MeshBuilder;
  private canvas: GbCanvas = new GbCanvas();
  private paintedZone: string = "?";
  private widthCm: number = DEFAULT_WIDTH_CM;
  private heightCm: number = DEFAULT_HEIGHT_CM;

  constructor(parent: SceneObject, prepareMaterial: (texture: Texture) => Material) {
    this.object = global.scene.createSceneObject("PhonePad");
    this.object.setParent(parent);
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
    this.builder.appendVerticesInterleaved([
      -1, -1, 0, 0, 0,
      1, -1, 0, 1, 0,
      1, 1, 0, 1, 1,
      -1, 1, 0, 0, 1,
    ]);
    this.builder.appendIndices([0, 1, 2, 0, 2, 3]);
    const mesh = this.builder.getMesh();
    this.builder.updateMesh();
    this.resize(DEFAULT_WIDTH_CM, DEFAULT_HEIGHT_CM);

    const visual = this.object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = mesh;
    visual.mainMaterial = prepareMaterial(this.texture);
    // Over the world like the other surfaces the wearer reads, and under them:
    // a dialogue box that lands on top of the pad is the right way round.
    visual.renderOrder = 99;
    this.object.enabled = false;
  }

  setEnabled(enabled: boolean): void {
    this.object.enabled = enabled;
    if (!enabled) {
      this.paintedZone = "?";
    }
  }

  isEnabled(): boolean {
    return this.object.enabled;
  }

  /**
   * One frame: the picture, the size and the place.
   *
   * `position` is the phone's own; null takes the pad off, because a pad drawn
   * at the origin is a pad on the floor. `sizeCm` may be null on a build that
   * does not report it, and the default handset stands in.
   */
  update(font: GbFont, zone: string, position: vec3, sizeCm: vec2, eye: vec3): void {
    if (!position) {
      this.setEnabled(false);
      return;
    }
    this.setEnabled(true);
    if (sizeCm && sizeCm.x > 0 && sizeCm.y > 0) {
      this.resize(sizeCm.x, sizeCm.y);
    }
    if (zone !== this.paintedZone) {
      this.paintedZone = zone;
      paintPhonePad(this.canvas, font, zone);
      this.upload();
    }
    const transform = this.object.getTransform();
    let at = position;
    if (eye) {
      // Lifted along the line from the phone to the eye, so it comes toward the
      // wearer rather than in some fixed direction the phone may be facing.
      const dx = eye.x - position.x;
      const dy = eye.y - position.y;
      const dz = eye.z - position.z;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length > 0.001) {
        at = new vec3(position.x + dx / length * LIFT_CM,
                      position.y + dy / length * LIFT_CM,
                      position.z + dz / length * LIFT_CM);
      }
    }
    transform.setWorldPosition(at);
    if (!eye) {
      return;
    }
    const toEye = new vec3(eye.x - at.x, eye.y - at.y, eye.z - at.z);
    const horizontal = Math.sqrt(toEye.x * toEye.x + toEye.z * toEye.z);
    if (horizontal < 0.0001 && Math.abs(toEye.y) < 0.0001) {
      return;
    }
    const yaw = Math.atan2(toEye.x, toEye.z);
    const pitch = Math.atan2(toEye.y, horizontal);
    transform.setWorldRotation(
      quat.angleAxis(yaw, new vec3(0, 1, 0)).multiply(
        quat.angleAxis(-pitch, new vec3(1, 0, 0))));
  }

  private resize(widthCm: number, heightCm: number): void {
    if (widthCm === this.widthCm && heightCm === this.heightCm) {
      return;
    }
    this.widthCm = widthCm;
    this.heightCm = heightCm;
    const hw = widthCm / 2;
    const hh = heightCm / 2;
    this.builder.setVertexInterleaved(0, [-hw, -hh, 0, 0, 0]);
    this.builder.setVertexInterleaved(1, [hw, -hh, 0, 1, 0]);
    this.builder.setVertexInterleaved(2, [hw, hh, 0, 1, 1]);
    this.builder.setVertexInterleaved(3, [-hw, hh, 0, 0, 1]);
    this.builder.updateMesh();
  }

  private upload(): void {
    // The canvas runs top-down and the texture bottom-up, as everywhere else.
    const greys = [[236, 236, 236], [176, 176, 176], [96, 96, 96], [16, 16, 16]];
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      const outRow = SCREEN_HEIGHT - 1 - y;
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const colour = greys[this.canvas.pixels[y * SCREEN_WIDTH + x] & 3];
        const o = (outRow * SCREEN_WIDTH + x) * 4;
        this.rgba[o] = colour[0];
        this.rgba[o + 1] = colour[1];
        this.rgba[o + 2] = colour[2];
        this.rgba[o + 3] = 255;
      }
    }
    (this.texture.control as ProceduralTextureProvider).setPixels(
      0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, this.rgba);
  }
}
