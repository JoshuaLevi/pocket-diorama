// The dark patch under a sprite, so it stands on the world instead of over it.
//
// The reference renders the whole scene a second time from the sun to get its
// shadows, and says itself that turning that off "= ook geen dropshadows onder
// karakters". On an optical see-through display half of that pass is
// impossible -- black is transparent, so the real table cannot be darkened --
// but the half that lands on OUR OWN geometry works, and the dropshadow is the
// part of it your eye actually uses. See docs/RESEARCH-look-and-light.md.
//
// So: one flat disc per character, no second pass, no render target. It is the
// cheapest thing in this renderer that changes whether a billboard reads as
// standing somewhere or hovering above it, and on the battle platforms -- where
// the ground is unmistakably ours -- it is the difference between a sticker and
// a Pokemon.
//
// Soft-edged by geometry rather than by a texture: a bright centre ring and a
// transparent outer ring, so the disc fades out instead of ending in a hard
// circle. That costs one extra ring of triangles and no texture at all.

/** Rings across the disc. The outer one fades to nothing. */
const SEGMENTS: number = 16;
/** How far in the solid centre reaches, as a fraction of the radius. */
const CORE_FRACTION: number = 0.45;
/** How dark the centre is. The rest of the falloff is the outer ring's alpha. */
export const SHADOW_ALPHA: number = 0.42;
/**
 * Under the feet, not level with them.
 *
 * The sprite's own quad is already lifted a twentieth of a unit off the
 * terrain; the shadow goes between the two, or the two flicker against each
 * other exactly as the sprite used to flicker against the ground.
 */
export const SHADOW_LIFT_UNITS: number = 0.02;

export class GroundShadow {
  private object: SceneObject;

  /**
   * @param parent the diorama root, so the shadow shares the world's scale
   * @param make   builds the material; it is handed the centre's opacity
   * @param radius the disc's radius in world units
   */
  constructor(parent: SceneObject, make: (alpha: number) => Material, radius: number) {
    this.object = global.scene.createSceneObject("GroundShadow");
    this.object.setParent(parent);

    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;

    // Centre, then the solid ring, then the fading ring. The fade is carried in
    // the V coordinate so a material can use it; with a flat material the two
    // rings still read as a soft edge because the outer one is thin.
    const core = radius * CORE_FRACTION;
    const verts: number[] = [0, 0, 0, 0.5, 1];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i / SEGMENTS * Math.PI * 2;
      verts.push(Math.cos(a) * core, 0, Math.sin(a) * core, 0.5, 1);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i / SEGMENTS * Math.PI * 2;
      verts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, 0.5, 0);
    }
    builder.appendVerticesInterleaved(verts);

    const indices: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const next = (i + 1) % SEGMENTS;
      indices.push(0, 1 + i, 1 + next);
      const inner = 1 + i;
      const innerNext = 1 + next;
      const outer = 1 + SEGMENTS + i;
      const outerNext = 1 + SEGMENTS + next;
      indices.push(inner, outer, outerNext);
      indices.push(inner, outerNext, innerNext);
    }
    builder.appendIndices(indices);

    const mesh = builder.getMesh();
    // Without this the mesh has no geometry and draws nothing, silently.
    builder.updateMesh();

    const visual = this.object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    // Under the sprites (98) and under everything the wearer reads, but over
    // the terrain it is cast on.
    visual.renderOrder = 97;
    visual.mesh = mesh;
    visual.mainMaterial = make(SHADOW_ALPHA);
    this.object.enabled = false;
  }

  setEnabled(on: boolean): void {
    this.object.enabled = on;
  }

  /** Puts the shadow at a point in the diorama's own local space. */
  placeLocal(x: number, groundY: number, z: number): void {
    this.object.getTransform().setLocalPosition(new vec3(x, groundY + SHADOW_LIFT_UNITS, z));
  }
}
