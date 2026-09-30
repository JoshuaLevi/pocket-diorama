// The caps on the Game Boy's buttons: their shading, drawn rather than lit.
//
// Joshua on the glasses, 30 September: the buttons "zien er cheap uit". They
// did. The model's A and B are flat-topped cylinders and its SELECT and START
// flat slabs, all four wearing the body's own pale texture, so what reached
// the eye was two salmon discs and two grey lozenges with nothing to say they
// stand proud of the shell. No lamp fixes that on this display: the glasses
// ADD light, they do not reflect it, and a flat top facing the wearer is one
// flat colour under any light at all.
//
// So the depth is painted. One small sheet, drawn once, carries a maroon
// dome with a glint for A and B and a slate rubber capsule for the two pills,
// each in an UP and a PRESSED state; four quads lay those over the model's
// own parts, a hair above each top, and swap to the pressed picture (and go
// down with the part) while the button is held.
//
// The cross gets no cap. The model's D-pad has real relief -- ridges, a hub,
// arms that rock when pressed -- it is already near-black on the pale shell,
// and a flat picture laid over it would hide exactly the thing the round
// buttons lack.
//
// Everything that can be decided without a scene is a plain function here,
// so test/buttoncaps.test.mjs holds the sheet's pixels, the quads and the
// model's own numbers without Lens Studio. The measurements are the
// model's: a different model means different numbers here and nowhere else.

import type { PanelSource } from "../PadPanel";
import { BUTTON_A, BUTTON_B, BUTTON_SELECT, BUTTON_START } from "../PadPanel";
import {
  MODEL_BUTTON_A, MODEL_BUTTON_B, MODEL_SELECT, MODEL_START, MODEL_LCD_CENTRE, MODEL_SCALE,
  MOVING_PARTS, modelToCm,
} from "./GameBoyShell";

// ---------------------------------------------------------- measurements
//
// Read off Assets/Models/gameboy.glb in the shell's measured frame (x right,
// y up, z out of the face, model units): every vertex of a part taken through
// the node chain, then the largest z for its top. The test does the same
// reading on every run and holds these against it.

/** A and B: the flat top, and the widest the button gets (its bevel's foot). */
export const MODEL_AB_TOP_Z: number = 44.6;
export const MODEL_AB_RADIUS: number = 16.9;
/**
 * SELECT and START: the top face is a capsule that rises to the right. Its
 * skirt, 3.9 units lower, is wider and lies level with the shell; the cap
 * covers the face and leaves the skirt as the pale mound it is.
 */
export const MODEL_PILL_TOP_Z: number = 46.94;
export const MODEL_PILL_HALF_LENGTH: number = 16.3;
export const MODEL_PILL_HALF_WIDTH: number = 5.4;
export const MODEL_PILL_SLANT_DEGREES: number = 27.2;
/** The cross, on record for whoever caps it one day. */
export const MODEL_DPAD_TOP_Z: number = 48.23;

/** A cap is this much larger than its button all round, so no flat top shows at its edge. */
export const CAP_GROW_UNITS: number = 0.7;
/** Clear sheet round the shape, so its soft edge is never cut by the quad. */
export const CAP_PAD_UNITS: number = 0.15;
/** How far above the part's top the cap lies, so the two never fight for depth. */
export const CAP_LIFT_UNITS: number = 0.6;
/** Pressed, the shape is drawn this much smaller: a button going away from the eye. */
export const PRESSED_SHRINK: number = 0.95;

// ---------------------------------------------------------------- sheet

export const CAP_ROUND: string = "round";
export const CAP_PILL: string = "pill";

/** One picture on the sheet: which shape, in which state, and its pixel box (row 0 is the top). */
export interface CapSlot {
  kind: string;
  pressed: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

const ROUND_SLOT: number = 96;
const PILL_SLOT_WIDTH: number = 144;

/** Half the round cap's quad, in model units. */
function roundHalf(): number {
  return MODEL_AB_RADIUS + CAP_GROW_UNITS + CAP_PAD_UNITS;
}

/** The pill's drawn capsule: half its length along the slant, and its radius. */
function pillShape(): number[] {
  return [MODEL_PILL_HALF_LENGTH + CAP_GROW_UNITS, MODEL_PILL_HALF_WIDTH + CAP_GROW_UNITS];
}

/** Half the pill's quad: the slanted capsule's own bounding box, and the pad. */
function pillHalf(): number[] {
  const shape = pillShape();
  const a = MODEL_PILL_SLANT_DEGREES * Math.PI / 180;
  const run = shape[0] - shape[1];
  return [
    run * Math.cos(a) + shape[1] + CAP_PAD_UNITS,
    run * Math.sin(a) + shape[1] + CAP_PAD_UNITS,
  ];
}

const PILL_SLOT_HEIGHT: number = Math.round(PILL_SLOT_WIDTH * pillHalf()[1] / pillHalf()[0]);

export const ATLAS_WIDTH: number = 2 * ROUND_SLOT;
export const ATLAS_HEIGHT: number = ROUND_SLOT + 2 * PILL_SLOT_HEIGHT;

/** The four pictures. Their borders are clear sheet, so neighbours cannot bleed. */
export function capSlots(): CapSlot[] {
  return [
    { kind: CAP_ROUND, pressed: false, x: 0, y: 0, width: ROUND_SLOT, height: ROUND_SLOT },
    { kind: CAP_ROUND, pressed: true, x: ROUND_SLOT, y: 0, width: ROUND_SLOT, height: ROUND_SLOT },
    { kind: CAP_PILL, pressed: false, x: 0, y: ROUND_SLOT, width: PILL_SLOT_WIDTH, height: PILL_SLOT_HEIGHT },
    { kind: CAP_PILL, pressed: true, x: 0, y: ROUND_SLOT + PILL_SLOT_HEIGHT, width: PILL_SLOT_WIDTH, height: PILL_SLOT_HEIGHT },
  ];
}

/** The DMG's maroon, and its slate rubber: the base, lit, in shade, and the line round it. */
const ROUND_INKS: number[][] = [[166, 36, 100], [228, 98, 160], [90, 12, 50], [54, 6, 30]];
const PILL_INKS: number[][] = [[88, 92, 110], [152, 158, 180], [42, 44, 56], [24, 25, 34]];
/** The glint on each: the maroon's is warm, the rubber's is the room's own white. */
const ROUND_GLINT: number[] = [255, 236, 246];
const PILL_GLINT: number[] = [236, 240, 252];
/** The light: from the upper left, and mostly from the wearer's side. */
const LIGHT: number[] = [-0.451, 0.551, 0.702];
/** How much of the shape's narrow half is bevel, the rest being flat top. */
const ROUND_BEVEL: number = 0.34;
const PILL_BEVEL: number = 0.8;
/** The dark line just inside the edge, in model units. */
const OUTLINE_UNITS: number = 0.55;
const PRESSED_DIM: number = 0.78;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * One point of a cap: `dx`, `dy` in model units from its centre (y up), and
 * how many units a texel is, for the soft edge. Returns r, g, b, a in 0..255.
 *
 * The shape is a signed distance (negative inside). Its edge is a bevel: the
 * surface leans outward over the last part of the way in, and the lean
 * against the light is the whole of the shading. A flat top is one colour,
 * which is the fault being fixed, so the top also brightens a little toward
 * the light, the way a slightly domed button does.
 */
export function capTexel(kind: string, pressed: boolean, dx: number, dy: number,
                         unitsPerTexel: number): number[] {
  const shrink = pressed ? PRESSED_SHRINK : 1;
  let distance = 0;
  let outX = 0;
  let outY = 0;
  let minor = 1;
  let glintX = 0;
  let glintY = 0;
  let glintAlong = 1;
  let glintAcross = 1;
  let axisX = 1;
  let axisY = 0;
  let strength = 0;
  let inks = ROUND_INKS;
  let bevel = ROUND_BEVEL;
  let glintInk = ROUND_GLINT;
  if (kind === CAP_ROUND) {
    minor = (MODEL_AB_RADIUS + CAP_GROW_UNITS) * shrink;
    const length = Math.sqrt(dx * dx + dy * dy);
    distance = length - minor;
    if (length > 1e-6) {
      outX = dx / length;
      outY = dy / length;
    }
    // Pressed, the glint slides toward the middle and fades: the top has tipped away.
    const reach = (pressed ? 0.2 : 0.36) * minor;
    glintX = -reach;
    glintY = reach;
    glintAlong = 0.15 * minor;
    glintAcross = 0.15 * minor;
    strength = pressed ? 0.24 : 0.72;
  } else {
    inks = PILL_INKS;
    bevel = PILL_BEVEL;
    glintInk = PILL_GLINT;
    const shape = pillShape();
    const a = MODEL_PILL_SLANT_DEGREES * Math.PI / 180;
    axisX = Math.cos(a);
    axisY = Math.sin(a);
    const halfLength = shape[0] * shrink;
    minor = shape[1] * shrink;
    const run = halfLength - minor;
    const along = dx * axisX + dy * axisY;
    const across = -dx * axisY + dy * axisX;
    const past = Math.max(Math.abs(along) - run, 0) * (along < 0 ? -1 : 1);
    const length = Math.sqrt(past * past + across * across);
    distance = length - minor;
    if (length > 1e-6) {
      outX = (past * axisX - across * axisY) / length;
      outY = (past * axisY + across * axisX) / length;
    }
    // A streak along the upper edge, toward the end nearer the light.
    const gAlong = -0.3 * run;
    const gAcross = (pressed ? 0.25 : 0.4) * minor;
    glintX = gAlong * axisX - gAcross * axisY;
    glintY = gAlong * axisY + gAcross * axisX;
    glintAlong = 0.6 * run;
    glintAcross = 0.2 * minor;
    strength = pressed ? 0.14 : 0.42;
  }

  const alpha = clamp01(0.5 - distance / unitsPerTexel);
  if (alpha <= 0) {
    return [0, 0, 0, 0];
  }
  const inside = clamp01(-distance / (bevel * minor));
  const lean = 0.95 * (1 - inside) * (1 - inside);
  const nx = outX * lean;
  const ny = outY * lean;
  const norm = Math.sqrt(nx * nx + ny * ny + 1);
  const diffuse = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / norm);
  let dome = 0.1 * (-dx + dy) / (minor * 1.414);
  dome = dome < -0.12 ? -0.12 : dome > 0.12 ? 0.12 : dome;
  // 1 on a flat top facing the wearer, more toward the light, less away.
  const lit = diffuse / LIGHT[2] + dome;
  let colour = lit < 1
    ? mix(inks[2], inks[0], clamp01((lit - 0.15) / 0.85))
    : mix(inks[0], inks[1], clamp01((lit - 1) / 0.45));

  const gx = dx - glintX;
  const gy = dy - glintY;
  const gAlong = (gx * axisX + gy * axisY) / glintAlong;
  const gAcross = (-gx * axisY + gy * axisX) / glintAcross;
  const glint = strength * Math.exp(-0.5 * (gAlong * gAlong + gAcross * gAcross));
  colour = mix(colour, glintInk, glint);

  const line = clamp01(1 + distance / OUTLINE_UNITS);
  colour = mix(colour, inks[3], 0.8 * line);
  const dim = pressed ? PRESSED_DIM : 1;
  return [
    Math.round(colour[0] * dim), Math.round(colour[1] * dim), Math.round(colour[2] * dim),
    Math.round(alpha * 255),
  ];
}

/** The sheet, RGBA, row 0 at the TOP: the way a picture is looked at, and a test reads it. */
export function drawCapAtlas(): Uint8Array {
  const out = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  const slots = capSlots();
  for (let s = 0; s < slots.length; s++) {
    const slot = slots[s];
    const round = slot.kind === CAP_ROUND;
    const halfX = round ? roundHalf() : pillHalf()[0];
    const halfY = round ? roundHalf() : pillHalf()[1];
    const unitsPerTexel = 2 * halfX / slot.width;
    for (let j = 0; j < slot.height; j++) {
      const dy = halfY - (j + 0.5) / slot.height * 2 * halfY;
      for (let i = 0; i < slot.width; i++) {
        const dx = (i + 0.5) / slot.width * 2 * halfX - halfX;
        const c = capTexel(slot.kind, slot.pressed, dx, dy, unitsPerTexel);
        const o = ((slot.y + j) * ATLAS_WIDTH + slot.x + i) * 4;
        out[o] = c[0];
        out[o + 1] = c[1];
        out[o + 2] = c[2];
        out[o + 3] = c[3];
      }
    }
  }
  return out;
}

/** The same pixels with the rows turned over: a texture's first row is its bottom one. */
export function rowsBottomFirst(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(rgba.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const from = y * stride;
    const to = (height - 1 - y) * stride;
    for (let i = 0; i < stride; i++) {
      out[to + i] = rgba[from + i];
    }
  }
  return out;
}

/** A slot as u0, vBottom, u1, vTop on a sheet uploaded bottom row first. */
export function capUv(slot: CapSlot): number[] {
  return [
    slot.x / ATLAS_WIDTH,
    1 - (slot.y + slot.height) / ATLAS_HEIGHT,
    (slot.x + slot.width) / ATLAS_WIDTH,
    1 - slot.y / ATLAS_HEIGHT,
  ];
}

// ---------------------------------------------------------------- quads

/** One cap on the face: whose it is, its centre and half-size in model units, and how far its part sinks. */
export interface CapQuad {
  button: string;
  kind: string;
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  topZ: number;
  sinkUnits: number;
}

/** How far the part that answers to `button` goes down when pressed. */
function sinkOf(button: string): number {
  for (let i = 0; i < MOVING_PARTS.length; i++) {
    if (MOVING_PARTS[i].buttons.indexOf(button) >= 0) {
      return MOVING_PARTS[i].sinkUnits;
    }
  }
  return 0;
}

/** The four caps, in the order the mesh holds them: A, B, SELECT, START. */
export function capQuads(): CapQuad[] {
  const r = roundHalf();
  const p = pillHalf();
  return [
    { button: BUTTON_A, kind: CAP_ROUND, x: MODEL_BUTTON_A[0], y: MODEL_BUTTON_A[1],
      halfWidth: r, halfHeight: r, topZ: MODEL_AB_TOP_Z, sinkUnits: sinkOf(BUTTON_A) },
    { button: BUTTON_B, kind: CAP_ROUND, x: MODEL_BUTTON_B[0], y: MODEL_BUTTON_B[1],
      halfWidth: r, halfHeight: r, topZ: MODEL_AB_TOP_Z, sinkUnits: sinkOf(BUTTON_B) },
    { button: BUTTON_SELECT, kind: CAP_PILL, x: MODEL_SELECT[0], y: MODEL_SELECT[1],
      halfWidth: p[0], halfHeight: p[1], topZ: MODEL_PILL_TOP_Z, sinkUnits: sinkOf(BUTTON_SELECT) },
    { button: BUTTON_START, kind: CAP_PILL, x: MODEL_START[0], y: MODEL_START[1],
      halfWidth: p[0], halfHeight: p[1], topZ: MODEL_PILL_TOP_Z, sinkUnits: sinkOf(BUTTON_START) },
  ];
}

/** A cap's rectangle in the shell's body holder: centimetres about the view centre. */
export interface CapRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z: number;
}

/** Where a cap lies. Pressed, it goes down with its part and nowhere else. */
export function capRectCm(quad: CapQuad, pressed: boolean): CapRect {
  const low = modelToCm(quad.x - quad.halfWidth, quad.y - quad.halfHeight);
  const high = modelToCm(quad.x + quad.halfWidth, quad.y + quad.halfHeight);
  const z = quad.topZ + CAP_LIFT_UNITS - (pressed ? quad.sinkUnits : 0);
  return { x0: low[0], y0: low[1], x1: high[0], y1: high[1], z: (z - MODEL_LCD_CENTRE[2]) * MODEL_SCALE };
}

/** One cap's four vertices, x y z u v each: bottom left, bottom right, top right, top left. */
function quadVertices(quad: CapQuad, pressed: boolean): number[] {
  const slots = capSlots();
  let slot = slots[0];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].kind === quad.kind && slots[i].pressed === pressed) {
      slot = slots[i];
    }
  }
  const uv = capUv(slot);
  const r = capRectCm(quad, pressed);
  return [
    r.x0, r.y0, r.z, uv[0], uv[1],
    r.x1, r.y0, r.z, uv[2], uv[1],
    r.x1, r.y1, r.z, uv[2], uv[3],
    r.x0, r.y1, r.z, uv[0], uv[3],
  ];
}

/** The whole mesh's vertices. `held` names the buttons that are down: { a: true }. */
export function capVertices(held: any): number[] {
  const quads = capQuads();
  let out: number[] = [];
  for (let i = 0; i < quads.length; i++) {
    out = out.concat(quadVertices(quads[i], !!(held && held[quads[i].button])));
  }
  return out;
}

/** Two triangles a quad. */
export function capIndices(): number[] {
  const out: number[] = [];
  const count = capQuads().length;
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    out.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return out;
}

// ---------------------------------------------------------------- scene

/**
 * The caps in the scene: one mesh of four quads under a shell's body holder.
 * `makeMaterial` dresses the sheet: flat, alpha where there is no ink,
 * tested against depth and not written to it, as the face's print is.
 */
export class ButtonCaps {
  readonly root: SceneObject;
  private builder: MeshBuilder;
  private held: boolean[] = [];

  constructor(parent: SceneObject, makeMaterial: (texture: Texture) => Material) {
    this.root = global.scene.createSceneObject("ButtonCaps");
    this.root.setParent(parent);
    const texture = ProceduralTextureProvider.createWithFormat(ATLAS_WIDTH, ATLAS_HEIGHT, TextureFormat.RGBA8Unorm);
    (texture.control as ProceduralTextureProvider).setPixels(
      0, 0, ATLAS_WIDTH, ATLAS_HEIGHT, rowsBottomFirst(drawCapAtlas(), ATLAS_WIDTH, ATLAS_HEIGHT));
    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;
    this.builder.appendVerticesInterleaved(capVertices(null));
    this.builder.appendIndices(capIndices());
    const mesh = this.builder.getMesh();
    this.builder.updateMesh();
    const visual = this.root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = mesh;
    visual.mainMaterial = makeMaterial(texture);
    visual.renderOrder = 1;
    const count = capQuads().length;
    for (let i = 0; i < count; i++) {
      this.held.push(false);
    }
  }

  /**
   * Once a frame: a held button wears its pressed picture and lies lower,
   * a released one comes back. The buffer is rewritten only on a change.
   */
  update(source: PanelSource): void {
    const quads = capQuads();
    let changed = false;
    for (let i = 0; i < quads.length; i++) {
      const pressed = !!source && source.isHeld(quads[i].button);
      if (pressed === this.held[i]) {
        continue;
      }
      this.held[i] = pressed;
      changed = true;
      const vertices = quadVertices(quads[i], pressed);
      for (let c = 0; c < 4; c++) {
        this.builder.setVertexInterleaved(i * 4 + c, vertices.slice(c * 5, c * 5 + 5));
      }
    }
    if (changed) {
      this.builder.updateMesh();
    }
  }
}
