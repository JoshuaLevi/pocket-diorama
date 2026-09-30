// The frame around the cell the player is walking to.
//
// Joshua's ask of 29 September: pinch a cell and see which one was taken.
// A thin square frame lies on the ground around the destination -- the
// reference's bright green, no fill so the tile stays readable -- and goes
// when the player arrives or the walk is dropped. The stick borrows it: the
// frame stands one cell ahead in the direction held, so the hand can see
// what it is asking for before the step is taken.
//
// It lives under the diorama root in the root's own units (a cell is two),
// so it scrolls, scales and turns with the world for nothing.

/** The frame's colour: the reference's marker green. */
export const MARKER_RGB: number[] = [128, 255, 96];
/** How thick the frame's four sides are, in root units (a cell is 2). */
export const MARKER_BAND: number = 0.22;
/** How far above the ground it floats, so it never z-fights the tile. */
export const MARKER_LIFT: number = 0.12;
/** How fast it fades in and out, as a time constant in seconds. */
export const MARKER_FADE_SECONDS: number = 0.08;

/** The eight triangles of a square frame about the origin, `half` to a side. */
export function frameVertices(half: number, band: number): number[] {
  const o = half;
  const i = half - band;
  // Four strips: north, south, west, east; position(3) + texture0(2).
  const v: number[] = [];
  const quad = (x0: number, z0: number, x1: number, z1: number) => {
    v.push(x0, 0, z0, 0, 0, x1, 0, z0, 1, 0, x1, 0, z1, 1, 1, x0, 0, z1, 0, 1);
  };
  quad(-o, -o, o, -i);
  quad(-o, i, o, o);
  quad(-o, -i, -i, i);
  quad(i, -i, o, i);
  return v;
}

export class CellMarker {
  private object: SceneObject;
  private builder: MeshBuilder;
  private visual: RenderMeshVisual;
  private shown: boolean = false;
  private cellX: number = -1;
  private cellY: number = -1;
  private amount: number = 0;

  constructor(parent: SceneObject, material: Material) {
    this.object = global.scene.createSceneObject("CellMarker");
    this.object.setParent(parent);
    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;
    this.builder.appendVerticesInterleaved(frameVertices(1, MARKER_BAND));
    const indices: number[] = [];
    for (let q = 0; q < 4; q++) {
      const b = q * 4;
      // Both windings, so the frame reads from below the plate's rim too.
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2);
    }
    this.builder.appendIndices(indices);
    const mesh = this.builder.getMesh();
    this.builder.updateMesh();
    this.visual = this.object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.visual.mesh = mesh;
    this.visual.mainMaterial = material;
    this.visual.renderOrder = 40;
    this.object.enabled = false;
  }

  /** Puts the frame around a cell; `groundY` is that cell's floor in root units. */
  showAt(cellX: number, cellY: number, x: number, groundY: number, z: number): void {
    this.cellX = cellX;
    this.cellY = cellY;
    this.object.getTransform().setLocalPosition(new vec3(x, groundY + MARKER_LIFT, z));
    this.shown = true;
    this.object.enabled = true;
  }

  hide(): void {
    this.shown = false;
  }

  /** Which cell it frames, or null. */
  cell(): number[] {
    return this.shown ? [this.cellX, this.cellY] : null;
  }

  /** One frame: the fade, and the object off once it is gone. */
  step(dt: number): void {
    const target = this.shown ? 1 : 0;
    const k = dt <= 0 ? 0 : Math.min(1, dt / MARKER_FADE_SECONDS);
    this.amount += (target - this.amount) * k;
    if (Math.abs(this.amount - target) < 0.01) {
      this.amount = target;
    }
    if (this.amount <= 0) {
      this.object.enabled = false;
      return;
    }
    // Grows in from the centre: a marker that pops reads as a fault.
    const s = 0.7 + 0.3 * this.amount;
    this.object.getTransform().setLocalScale(new vec3(s, 1, s));
  }
}
