// The message box, drawn in the cartridge's own typeface.
//
// A Gen 1 text box is a white panel with a border, two lines of 8x8 glyphs, and a
// blinking arrow when it is waiting for you. Reproducing it in 3D is not
// decoration: reading these words in any other font is the difference between
// "a Pokemon world" and "a voxel game with subtitles".
//
// The glyph sheet comes out of the ROM like every other graphic, and the box is
// one batched MeshBuilder mesh -- a quad per character -- rather than a Text
// component, so it is coloured, positioned and scaled exactly like the world is
// and survives the 5.15 downgrade with it.

import type { WorldBundle } from "../../world/WorldData";
import { unpackShades } from "../../world/WorldData";

/** Glyphs are 8x8, like tiles. */
const GLYPH: number = 8;

/** Characters across the box, and lines down it, as the original lays them out. */
export const COLUMNS: number = 18;
export const LINES: number = 2;

/** Panel padding in glyph widths. */
const PADDING: number = 1;

const STRIDE: number = 5; // position(3) + texture0(2)

export interface FontAtlas {
  texture: Texture;
  glyphsPerRow: number;
  rows: number;
  widthPixels: number;
  heightPixels: number;
  /** character -> glyph index. Built from the ROM's own charmap. */
  lookup: any;
}

/**
 * Builds the glyph sheet and the character lookup.
 *
 * The charmap maps a byte to a sequence, which is usually one character but is
 * sometimes a name like "<BOLD_A>" or a control marker. Only the single-character
 * entries can be typed directly; the rest are addressed by index when a script
 * needs them.
 */
export function buildFontAtlas(bundle: WorldBundle, colour: number[]): FontAtlas {
  const font = (bundle as any).font;
  if (!font) {
    return null;
  }
  const width = font.width;
  const height = font.height;
  const pixelCount = width * height;
  const shades = unpackShades(font.shades, pixelCount);

  // Two tones only: the glyph and the paper it sits on. A Game Boy box is not
  // anti-aliased and pretending otherwise makes it look soft and wrong.
  const rgba = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const o = ((height - 1 - Math.floor(i / width)) * width + (i % width)) * 4;
    const ink = shades[i] >= 2;
    rgba[o] = ink ? colour[0] : 255;
    rgba[o + 1] = ink ? colour[1] : 255;
    rgba[o + 2] = ink ? colour[2] : 255;
    rgba[o + 3] = 255;
  }

  const texture = ProceduralTextureProvider.createWithFormat(
    width, height, TextureFormat.RGBA8Unorm
  );
  (texture.control as ProceduralTextureProvider).setPixels(0, 0, width, height, rgba);

  const lookup: any = {};
  const charmap = font.charmap;
  for (let i = 0; i < charmap.length; i++) {
    const entry = charmap[i];
    const seq = entry.seq;
    if (typeof seq === "string" && seq.length === 1) {
      // The sheet starts at mainBase, so a code maps to a glyph by subtracting it.
      lookup[seq] = entry.code - font.mainBase;
    }
  }

  return {
    texture: texture,
    glyphsPerRow: font.glyphsPerRow,
    rows: Math.floor(height / GLYPH),
    widthPixels: width,
    heightPixels: height,
    lookup: lookup,
  };
}

/** UV rect for a glyph, inset half a texel so neighbours cannot bleed in. */
export function glyphUv(atlas: FontAtlas, glyph: number): number[] {
  const columns = atlas.glyphsPerRow;
  const index = glyph < 0 ? 0 : glyph;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const hu = 0.5 / atlas.widthPixels;
  const hv = 0.5 / atlas.heightPixels;
  const u0 = column / columns + hu;
  const u1 = (column + 1) / columns - hu;
  const vTop = 1 - row / atlas.rows - hv;
  const vBottom = 1 - (row + 1) / atlas.rows + hv;
  return [u0, vBottom, u1, vTop];
}

/**
 * A fixed-capacity mesh of character quads.
 *
 * Allocated once for the whole box and rewritten per page, so showing text costs
 * no allocation and one draw call. Unused slots collapse to zero area, which the
 * rasteriser drops.
 */
export class DialogueBox {
  private builder: MeshBuilder;
  private mesh: RenderMesh;
  private atlas: FontAtlas;
  private object: SceneObject;
  private visual: RenderMeshVisual;
  private capacity: number;
  private scratch: number[] = [0, 0, 0, 0, 0];

  constructor(object: SceneObject, atlas: FontAtlas, material: Material, glyphSize: number) {
    this.object = object;
    this.atlas = atlas;
    this.capacity = COLUMNS * LINES;

    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;

    const verts: number[] = [];
    const indices: number[] = [];
    for (let slot = 0; slot < this.capacity; slot++) {
      for (let v = 0; v < 4; v++) {
        verts.push(0, 0, 0, 0, 0);
      }
      const b = slot * 4;
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    this.builder.appendVerticesInterleaved(verts);
    this.builder.appendIndices(indices);
    this.mesh = this.builder.getMesh();
    this.builder.updateMesh();

    this.visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.visual.mesh = this.mesh;
    this.visual.mainMaterial = material;
    this.glyphSize = glyphSize;
  }

  private glyphSize: number = 1;

  /** Draws up to two lines, left-aligned, top-down. Clears the rest. */
  setLines(lines: string[]): void {
    let slot = 0;
    const size = this.glyphSize;
    const originX = -(COLUMNS * size) / 2 + PADDING * size;
    const originY = (LINES * size) / 2 - PADDING * size;

    for (let line = 0; line < LINES; line++) {
      const text = line < lines.length ? lines[line] : "";
      for (let column = 0; column < COLUMNS; column++) {
        if (slot >= this.capacity) {
          break;
        }
        const character = column < text.length ? text.charAt(column) : "";
        if (character === "" || character === " ") {
          this.clearSlot(slot);
          slot++;
          continue;
        }
        const glyph = this.atlas.lookup[character];
        if (glyph === undefined) {
          this.clearSlot(slot);
          slot++;
          continue;
        }
        const x0 = originX + column * size;
        const y1 = originY - line * size;
        this.writeSlot(slot, x0, y1 - size, x0 + size, y1, glyphUv(this.atlas, glyph));
        slot++;
      }
    }
    while (slot < this.capacity) {
      this.clearSlot(slot);
      slot++;
    }
    this.builder.updateMesh();
  }

  private writeSlot(slot: number, x0: number, y0: number, x1: number, y1: number, uv: number[]): void {
    const base = slot * 4;
    this.put(base, x0, y0, uv[0], uv[1]);
    this.put(base + 1, x1, y0, uv[2], uv[1]);
    this.put(base + 2, x1, y1, uv[2], uv[3]);
    this.put(base + 3, x0, y1, uv[0], uv[3]);
  }

  private clearSlot(slot: number): void {
    const base = slot * 4;
    for (let v = 0; v < 4; v++) {
      this.put(base + v, 0, 0, 0, 0);
    }
  }

  private put(index: number, x: number, y: number, u: number, v: number): void {
    // One scratch array, reused: this runs per character per page.
    this.scratch[0] = x;
    this.scratch[1] = y;
    this.scratch[2] = 0;
    this.scratch[3] = u;
    this.scratch[4] = v;
    this.builder.setVertexInterleaved(index, this.scratch);
  }

  /** The scene object the quads hang on, for whoever decides where it lives. */
  sceneObject(): SceneObject {
    return this.object;
  }

  setEnabled(enabled: boolean): void {
    this.object.enabled = enabled;
  }
}
