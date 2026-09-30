// A grid of glyphs with a cursor column: what every menu screen draws into.
//
// DialogueBox does the same job for exactly two lines of eighteen columns, and
// bakes those numbers into its capacity, its draw loop and its origin maths, so
// a menu cannot reuse it. This is the same idioms at a configurable size:
//
//   * one MeshBuilder mesh, allocated once at full capacity and rewritten in
//     place, so drawing a screen costs no allocation and one draw call;
//   * indexType set explicitly, which is not optional -- the default leaves the
//     mesh invalid and updateMesh throws;
//   * one reused scratch array in put(), because this runs per character;
//   * unused slots collapsed to zero area, which the rasteriser drops.
//
// Column 0 of every row is the cursor, as the cartridge lays it out. That costs
// no extra quad and no second code path, and it means a cursor move rewrites
// two slots rather than the whole grid.
//
// There is deliberately NO frame. DialogueBox draws glyphs and nothing else
// today, so a panel that painted a background would be the only thing in the
// project doing it -- and it would have to sit behind 144 glyph quads that are
// all at z = 0 with depth writing and depth testing both off, where nothing
// decides what covers what except the order inside the mesh. That is worth
// doing carefully later, not casually now.

import type { FontAtlas } from "./DialogueBox";
import { glyphUv } from "./DialogueBox";

/** The glyph the cursor is drawn with: the cartridge's own arrow. */
export const CURSOR_GLYPH: string = "▶";

export class GlyphPanel {
  private builder: MeshBuilder;
  private mesh: RenderMesh;
  private atlas: FontAtlas;
  private object: SceneObject;
  private visual: RenderMeshVisual;
  private rows: number;
  private columns: number;
  private glyphSize: number;
  private capacity: number;
  private scratch: number[] = [0, 0, 0, 0, 0];
  private cursorRow: number = -1;

  constructor(object: SceneObject, atlas: FontAtlas, material: Material,
              glyphSize: number, rows: number, columns: number) {
    this.object = object;
    this.atlas = atlas;
    this.rows = rows;
    this.columns = columns;
    this.glyphSize = glyphSize;
    this.capacity = rows * columns;

    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    // Not optional: the default is None, which leaves the mesh invalid and
    // makes updateMesh throw.
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
  }

  private drawnColumns: number = 0;

  /**
   * Draws the rows, from column 1 rightwards. Column 0 is the cursor's.
   *
   * A row longer than the panel is trimmed rather than wrapped: the caller
   * builds rows to fit, and silently wrapping would hide that it did not.
   */
  setRows(lines: string[]): void {
    let widest = 0;
    for (let i = 0; i < lines.length; i++) {
      const length = lines[i] ? lines[i].length : 0;
      if (length > widest) {
        widest = length;
      }
    }
    // The cursor column plus the longest row: how much of the panel is really
    // drawn. The panel is built at a fixed width and centres itself on that,
    // so a caller that hangs it in space needs this to centre what is VISIBLE
    // -- four short menu rows in an eighteen-column panel sat hard left.
    this.drawnColumns = widest + 1;
    const size = this.glyphSize;
    const originX = -(this.columns * size) / 2;
    const originY = (this.rows * size) / 2;

    for (let row = 0; row < this.rows; row++) {
      const text = row < lines.length ? lines[row] : "";
      for (let column = 1; column < this.columns; column++) {
        const slot = row * this.columns + column;
        const character = column - 1 < text.length ? text.charAt(column - 1) : "";
        this.drawGlyph(slot, character, originX + column * size, originY - row * size, size);
      }
    }
    this.drawCursor(originX, originY, size);
    this.builder.updateMesh();
  }

  /** Columns actually drawn by the last setRows: the cursor plus the longest row. */
  contentColumns(): number {
    return this.drawnColumns;
  }

  /** The panel's built width in columns, which setRows centres itself on. */
  panelColumns(): number {
    return this.columns;
  }

  /**
   * Moves the cursor without rewriting the text.
   *
   * Two slot writes rather than a full grid rewrite, because the cursor moves
   * on every press and the rows do not. -1 draws no cursor.
   */
  setCursorRow(row: number): void {
    if (row === this.cursorRow) {
      return;
    }
    const size = this.glyphSize;
    const originX = -(this.columns * size) / 2;
    const originY = (this.rows * size) / 2;
    this.cursorRow = row;
    this.drawCursor(originX, originY, size);
    this.builder.updateMesh();
  }

  private drawCursor(originX: number, originY: number, size: number): void {
    for (let row = 0; row < this.rows; row++) {
      const slot = row * this.columns;
      const character = row === this.cursorRow ? CURSOR_GLYPH : "";
      this.drawGlyph(slot, character, originX, originY - row * size, size);
    }
  }

  private drawGlyph(slot: number, character: string, x: number, yTop: number,
                    size: number): void {
    if (character === "" || character === " ") {
      this.clearSlot(slot);
      return;
    }
    const glyph = this.atlas.lookup[character];
    if (glyph === undefined) {
      this.clearSlot(slot);
      return;
    }
    this.writeSlot(slot, x, yTop - size, x + size, yTop, glyphUv(this.atlas, glyph));
  }

  private writeSlot(slot: number, x0: number, y0: number, x1: number, y1: number,
                    uv: number[]): void {
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
