// The plate the diorama stands on, before there is a diorama.
//
// A published lens has no world of its own: the world comes from the wearer's
// cartridge, through the site and a code, and until that has happened there is
// nothing to draw. Nothing is a bad first impression -- it is the black screen
// of the third playtest all over again, only in three dimensions -- and it is
// also what Snap's reviewer would see, with no cartridge to type a code from.
// So the wizard's pages hang above THIS: an empty slab on the table, the size
// the world will be, that the hands can already move, turn and grow.
//
// Own material, not the cartridge's. No tileset, no palette, no atlas: three
// flat colours in a two-by-two texture, which is also why it can exist before
// a bundle does. It is destroyed the moment a world starts.

const TOP_RGB: number[] = [156, 124, 88];
const SIDE_RGB: number[] = [104, 78, 52];
/** The band a hand grabs -- DioramaGrab's rim -- drawn a shade lighter. */
const RIM_RGB: number[] = [184, 154, 116];

/** How much of the half-span the lighter rim takes. */
const RIM_FRACTION: number = 0.1;

/** Texels of a 2x2 texture, as the UV of each one's centre. */
const UV_TOP: number[] = [0.25, 0.25];
const UV_SIDE: number[] = [0.75, 0.25];
const UV_RIM: number[] = [0.25, 0.75];

export class EmptyPlate {
  private object: SceneObject = null;
  private texture: Texture = null;
  private builder: MeshBuilder = null;

  /**
   * `spanCm` is the plate's width and depth; `thicknessCm` how far it goes
   * down. The top face sits at y = 0 of the parent, which is where the world's
   * ground will be, so the wizard's plate and the game's slab land in the
   * same place on the table.
   */
  constructor(parent: SceneObject, spanCm: number, thicknessCm: number,
              makeMaterial: (texture: Texture) => Material) {
    this.object = global.scene.createSceneObject("EmptyPlate");
    this.object.setParent(parent);

    this.texture = ProceduralTextureProvider.createWithFormat(2, 2, TextureFormat.RGBA8Unorm);
    const rgba = new Uint8Array(2 * 2 * 4);
    EmptyPlate.putTexel(rgba, 0, TOP_RGB);
    EmptyPlate.putTexel(rgba, 1, SIDE_RGB);
    EmptyPlate.putTexel(rgba, 2, RIM_RGB);
    EmptyPlate.putTexel(rgba, 3, SIDE_RGB);
    (this.texture.control as ProceduralTextureProvider).setPixels(0, 0, 2, 2, rgba);

    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;
    EmptyPlate.buildBox(this.builder, spanCm / 2, thicknessCm);
    const mesh = this.builder.getMesh();
    this.builder.updateMesh();

    const visual = this.object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = mesh;
    visual.mainMaterial = makeMaterial(this.texture);
  }

  private static putTexel(rgba: Uint8Array, index: number, rgb: number[]): void {
    rgba[index * 4] = rgb[0];
    rgba[index * 4 + 1] = rgb[1];
    rgba[index * 4 + 2] = rgb[2];
    rgba[index * 4 + 3] = 255;
  }

  /**
   * The geometry: a top of five quads (a centre and four rim strips), four
   * sides and a bottom. Pure over the builder, so a test can count it.
   */
  static buildBox(builder: MeshBuilder, half: number, thickness: number): number {
    const inner = half * (1 - RIM_FRACTION);
    const bottom = -thickness;
    let quads = 0;
    const quad = (p: number[][], uv: number[]) => {
      const base = quads * 4;
      builder.appendVerticesInterleaved([
        p[0][0], p[0][1], p[0][2], uv[0], uv[1],
        p[1][0], p[1][1], p[1][2], uv[0], uv[1],
        p[2][0], p[2][1], p[2][2], uv[0], uv[1],
        p[3][0], p[3][1], p[3][2], uv[0], uv[1],
      ]);
      builder.appendIndices([base, base + 1, base + 2, base, base + 2, base + 3]);
      quads++;
    };
    // Top, counter-clockwise seen from above (+Y): the centre...
    quad([[-inner, 0, inner], [inner, 0, inner], [inner, 0, -inner], [-inner, 0, -inner]], UV_TOP);
    // ...and the rim, four strips that meet at the corners.
    quad([[-half, 0, half], [half, 0, half], [inner, 0, inner], [-inner, 0, inner]], UV_RIM);
    quad([[inner, 0, inner], [half, 0, half], [half, 0, -half], [inner, 0, -inner]], UV_RIM);
    quad([[-inner, 0, -inner], [inner, 0, -inner], [half, 0, -half], [-half, 0, -half]], UV_RIM);
    quad([[-half, 0, half], [-inner, 0, inner], [-inner, 0, -inner], [-half, 0, -half]], UV_RIM);
    // The four sides, facing out.
    quad([[-half, bottom, half], [half, bottom, half], [half, 0, half], [-half, 0, half]], UV_SIDE);
    quad([[half, bottom, half], [half, bottom, -half], [half, 0, -half], [half, 0, half]], UV_SIDE);
    quad([[half, bottom, -half], [-half, bottom, -half], [-half, 0, -half], [half, 0, -half]], UV_SIDE);
    quad([[-half, bottom, -half], [-half, bottom, half], [-half, 0, half], [-half, 0, -half]], UV_SIDE);
    // The bottom, facing down.
    quad([[-half, bottom, -half], [half, bottom, -half], [half, bottom, half], [-half, bottom, half]], UV_SIDE);
    return quads;
  }

  setEnabled(on: boolean): void {
    if (this.object) {
      this.object.enabled = on;
    }
  }

  /** Gone for good: the world's own slab takes its place. */
  destroy(): void {
    if (this.object) {
      this.object.destroy();
      this.object = null;
    }
    this.texture = null;
    this.builder = null;
  }
}
