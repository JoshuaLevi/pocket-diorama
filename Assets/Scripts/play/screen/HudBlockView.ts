import { fitInView } from "./ViewPlacement";
// One battle HUD block, standing in the world beside the Pokemon it belongs to.
//
// The blocks were drawn on the message panel first -- both of them plus the
// text box, on the one surface hanging in front of the wearer. That works and
// it reads as a Game Boy screen held up in front of the table, which is
// exactly what the reference mod says it stopped doing: its battle UI is
// "pinned in the space" beside each Pokemon, not held up in front of the
// world. Joshua asked for the reference's arrangement on 8 September.
//
// Nothing here paints. The canvas already carries both blocks -- see
// BattleHudScreen, whose coordinates came off the cartridge -- and the message
// panel already uploads the WHOLE canvas to its texture every time it changes.
// So a block is a quad showing a rectangle of that same texture, and it costs
// no second upload and no second canvas: the panel's own texture is passed in.
//
// Parented to the diorama root, so it lives at the world's scale: it shrinks
// onto the table with everything else and grows with it when SELECT does. A
// HUD pinned at room scale over a tabletop fight would be a billboard the size
// of the town.

import { SCREEN_WIDTH, SCREEN_HEIGHT, TILE } from "./GbCanvas";

/**
 * The texture rectangle a tile rectangle occupies: [uLeft, vBottom, uRight, vTop].
 *
 * Pulled out and exported because of the flip. The canvas stores row 0 at the
 * TOP and the texture wants it at the bottom, so v is 1 minus the row -- and
 * getting that backwards does not fail, it quietly shows the wrong band of the
 * screen, which on a HUD block means showing the message box or nothing at all.
 * A test can state which band comes back; a comment cannot.
 */
export function uvRect(rect: number[]): number[] {
  const x0 = rect[0] * TILE;
  const y0 = rect[1] * TILE;
  const w = rect[2] * TILE;
  const h = rect[3] * TILE;
  return [
    x0 / SCREEN_WIDTH,
    1 - (y0 + h) / SCREEN_HEIGHT,
    (x0 + w) / SCREEN_WIDTH,
    1 - y0 / SCREEN_HEIGHT,
  ];
}

export class HudBlockView {
  private object: SceneObject;
  private builder: MeshBuilder;
  /** The quad's own size, before any local scale. */
  private widthUnits: number = 1;
  private heightUnits: number = 1;
  private localScale: number = 1;

  /**
   * @param parent   the diorama root, so the block shares the world's scale
   * @param texture  the message panel's own texture; nothing is uploaded here
   * @param make     builds the material for that texture
   * @param rect     the block's tile rectangle on the canvas: [tx, ty, tw, th]
   * @param widthUnits how wide the block stands, in the diorama's own units
   */
  constructor(parent: SceneObject, texture: Texture, make: (t: Texture) => Material,
              rect: number[], widthUnits: number) {
    this.object = global.scene.createSceneObject("BattleHudBlock");
    this.object.setParent(parent);

    // V runs up while the canvas runs down -- see uvRect, and the panel's own
    // crop in MessagePanelView's constructor.
    const uv = uvRect(rect);
    const uLeft = uv[0];
    const vBottom = uv[1];
    const uRight = uv[2];
    const vTop = uv[3];

    const hw = widthUnits / 2;
    const hh = hw * rect[3] / rect[2];
    this.widthUnits = widthUnits;
    this.heightUnits = hh * 2;

    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;
    this.builder.appendVerticesInterleaved([
      -hw, -hh, 0, uLeft, vBottom,
      hw, -hh, 0, uRight, vBottom,
      hw, hh, 0, uRight, vTop,
      -hw, hh, 0, uLeft, vTop,
    ]);
    this.builder.appendIndices([0, 1, 2, 0, 2, 3]);
    const mesh = this.builder.getMesh();
    // NOT optional, and it fails silently: without updateMesh the mesh has no
    // geometry, the visual draws nothing, and the only sign is that the object
    // reports a default 10x10x10 bounding box instead of the quad's own. That
    // is exactly how this shipped invisible the first time -- created, enabled,
    // parented, positioned, and empty.
    this.builder.updateMesh();

    const visual = this.object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    // Drawn after the world, like the message panel: depth-tested against a
    // table the diorama stands on, a block this near the eye gets cut in half
    // by the floor and the furniture.
    visual.renderOrder = 101;
    visual.mesh = mesh;
    visual.mainMaterial = make(texture);
    this.object.enabled = false;
  }

  setEnabled(on: boolean): void {
    this.object.enabled = on;
  }

  isEnabled(): boolean {
    return this.object.enabled;
  }

  /**
   * Holds the block at a fixed size in the ROOM, whatever the world is doing.
   *
   * Without this the block is a fixed size in the WORLD, and the world changes
   * scale: framing a fight magnified it four-fold, the blocks went with it, and
   * two panels each wider than the gap between the Pokemon slid over each other
   * into unreadable soup. That is what the 8 September preview showed.
   *
   * Text has one right size and it is an angular one -- eighteen columns have
   * to be legible at arm's length -- so the block is sized in centimetres and
   * the world's scale is divided back out.
   */
  setWidthCm(targetCm: number, parentScale: number): void {
    const denominator = this.widthUnits * (parentScale > 1e-6 ? parentScale : 1);
    this.localScale = denominator > 1e-6 ? targetCm / denominator : 1;
    this.object.getTransform().setLocalScale(
      new vec3(this.localScale, this.localScale, this.localScale));
  }

  /** Half the block's width, in the PARENT's local units, at its current size. */
  halfWidthLocal(): number {
    return this.widthUnits * this.localScale / 2;
  }

  /** Half the block's height, in the parent's local units. */
  halfHeightLocal(): number {
    return this.heightUnits * this.localScale / 2;
  }

  /** Keep the complete HP label readable when the pair is near a display edge. */
  keepInView(camera: Camera): void {
    const scale=this.object.getTransform().getWorldScale();
    fitInView(camera,this.object,this.widthUnits*scale.x,this.heightUnits*scale.y);
  }

  /** Stands the block at a point in the diorama's own local space. */
  placeLocal(at: vec3): void {
    this.object.getTransform().setLocalPosition(at);
  }

  /**
   * Square to the wearer, upright.
   *
   * Yaw only, exactly as every other billboard in this diorama turns: pitching
   * one to face a wearer leaning over the table lays it back like a card on a
   * desk, and a block of text laid back is a block of text you cannot read.
   */
  faceCamera(eye: vec3): void {
    if (!eye) {
      return;
    }
    const transform = this.object.getTransform();
    const here = transform.getWorldPosition();
    const dx = eye.x - here.x;
    const dz = eye.z - here.z;
    if (dx === 0 && dz === 0) {
      return;
    }
    transform.setWorldRotation(quat.fromEulerAngles(0, Math.atan2(dx, dz), 0));
  }
}
