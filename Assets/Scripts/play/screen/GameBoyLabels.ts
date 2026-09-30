// The print on the Game Boy's face: A, B, SELECT, START.
//
// The Sketchfab model has no lettering, and a tester in the preview could
// not tell which red disc was A ("het is ook niet duidelijk welke buttons A
// of B of Select of start zijn", 29 September). The DMG prints its labels on
// the shell -- the letter below and beside each round button, the words
// under the two pills -- so that is where these go: four quads on the body,
// each a window onto one sheet of TinyFont lettering, the same 5x7 font the
// setup pages use, which needs no world bundle to exist.
//
// Everything that can be decided without a scene is in `faceLabels()` and
// `sheetSlots()`, so a test can hold the labels against the buttons.

import { GbCanvas, SHADE_NONE, SCREEN_WIDTH, SCREEN_HEIGHT } from "./GbCanvas";
import { drawText, inkWidth, GLYPH_H } from "./TinyFont";
import {
  MODEL_BUTTON_A, MODEL_BUTTON_B, MODEL_SELECT, MODEL_START, MODEL_LCD_CENTRE, MODEL_SCALE,
  modelToCm,
} from "./GameBoyShell";

/** One label: its text, where its centre is on the face (model units), and its pixel size. */
export interface FaceLabel {
  text: string;
  x: number;
  y: number;
  z: number;
  unitsPerPixel: number;
  /** The shade it is drawn in: SHADE_LETTER for A and B, SHADE_WORD for the pills. */
  shade: number;
}

/** The shell's face is flat at this height under every label (measured off the mesh). */
export const FACE_Z: number = 39.5;
/** How far the print stands off the face, so it never z-fights it. */
export const PRINT_LIFT: number = 0.4;
/** The letters sit this far below their button's centre; the words this far below their pill's. */
export const LETTER_DROP: number = 30;
export const WORD_DROP: number = 16;
export const LETTER_UNITS_PER_PIXEL: number = 1.7;
export const WORD_UNITS_PER_PIXEL: number = 1.1;

/** The two inks, as shades on the sheet, and their colours: the DMG's maroon letters and slate words. */
export const SHADE_WORD: number = 1;
export const SHADE_LETTER: number = 2;
export const INK: number[][] = [
  [0, 0, 0],        // shade 0: never drawn (the sheet is SHADE_NONE where there is no ink)
  [58, 62, 96],     // SHADE_WORD: slate
  [120, 32, 66],    // SHADE_LETTER: maroon
  [30, 30, 34],     // shade 3: unused
];

export function faceLabels(): FaceLabel[] {
  const z = FACE_Z + PRINT_LIFT;
  return [
    { text: "A", x: MODEL_BUTTON_A[0], y: MODEL_BUTTON_A[1] - LETTER_DROP, z: z, unitsPerPixel: LETTER_UNITS_PER_PIXEL, shade: SHADE_LETTER },
    { text: "B", x: MODEL_BUTTON_B[0], y: MODEL_BUTTON_B[1] - LETTER_DROP, z: z, unitsPerPixel: LETTER_UNITS_PER_PIXEL, shade: SHADE_LETTER },
    { text: "SELECT", x: MODEL_SELECT[0], y: MODEL_SELECT[1] - WORD_DROP, z: z, unitsPerPixel: WORD_UNITS_PER_PIXEL, shade: SHADE_WORD },
    { text: "START", x: MODEL_START[0], y: MODEL_START[1] - WORD_DROP, z: z, unitsPerPixel: WORD_UNITS_PER_PIXEL, shade: SHADE_WORD },
  ];
}

/** Where each label is drawn on the 160x144 sheet: its pixel box. */
export interface SheetSlot {
  label: FaceLabel;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function sheetSlots(): SheetSlot[] {
  const labels = faceLabels();
  const slots: SheetSlot[] = [];
  let y = 2;
  for (let i = 0; i < labels.length; i++) {
    const width = inkWidth(labels[i].text, 1);
    slots.push({ label: labels[i], x: 2, y: y, width: width, height: GLYPH_H });
    y += GLYPH_H + 3;
  }
  return slots;
}

/** A label's size on the face, in centimetres. */
export function labelSizeCm(slot: SheetSlot): number[] {
  return [slot.width * slot.label.unitsPerPixel * MODEL_SCALE, slot.height * slot.label.unitsPerPixel * MODEL_SCALE];
}

/** The quads on the shell. `parent` is the shell's body holder, in centimetres about the view centre. */
export class GameBoyLabels {
  readonly root: SceneObject;
  private builder: MeshBuilder;

  constructor(parent: SceneObject, makeMaterial: (texture: Texture) => Material) {
    this.root = global.scene.createSceneObject("GameBoyLabels");
    this.root.setParent(parent);
    const texture = GameBoyLabels.drawSheet();
    const material = makeMaterial(texture);
    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;
    const slots = sheetSlots();
    const verts: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const centre = modelToCm(slot.label.x, slot.label.y);
      const z = (slot.label.z - MODEL_LCD_CENTRE[2]) * MODEL_SCALE;
      const size = labelSizeCm(slot);
      const hw = size[0] / 2;
      const hh = size[1] / 2;
      // The sheet is uploaded bottom row first, so v runs up the canvas.
      const u0 = slot.x / SCREEN_WIDTH;
      const u1 = (slot.x + slot.width) / SCREEN_WIDTH;
      const vTop = 1 - slot.y / SCREEN_HEIGHT;
      const vBottom = 1 - (slot.y + slot.height) / SCREEN_HEIGHT;
      const base = i * 4;
      verts.push(centre[0] - hw, centre[1] - hh, z, u0, vBottom);
      verts.push(centre[0] + hw, centre[1] - hh, z, u1, vBottom);
      verts.push(centre[0] + hw, centre[1] + hh, z, u1, vTop);
      verts.push(centre[0] - hw, centre[1] + hh, z, u0, vTop);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.builder.appendVerticesInterleaved(verts);
    this.builder.appendIndices(indices);
    const mesh = this.builder.getMesh();
    this.builder.updateMesh();
    const visual = this.root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = mesh;
    visual.mainMaterial = material;
    visual.renderOrder = 1;
  }

  /** The sheet: every label drawn once in TinyFont, transparent where there is no ink. */
  private static drawSheet(): Texture {
    const canvas = new GbCanvas();
    canvas.clear(SHADE_NONE);
    const slots = sheetSlots();
    for (let i = 0; i < slots.length; i++) {
      drawText(canvas, slots[i].label.text, slots[i].x, slots[i].y, slots[i].label.shade, 1);
    }
    const rgba = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
    canvas.toPanelRgba(rgba, INK);
    const texture = ProceduralTextureProvider.createWithFormat(SCREEN_WIDTH, SCREEN_HEIGHT, TextureFormat.RGBA8Unorm);
    (texture.control as ProceduralTextureProvider).setPixels(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, rgba);
    return texture;
  }
}
