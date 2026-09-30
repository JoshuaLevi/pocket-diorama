// Two discs hung in the air, for a fight with nowhere to happen.
//
// This is the reference's own second staging, and it exists for a reason our
// 8 September preview ran straight into: a fight in Oak's lab is a fight with
// lab benches between the wearer and the Pokemon. The reference's note is that
// caves and shop floors "nergens een gevecht kwijt kunnen" -- there is nowhere
// in them to put one -- so it lifts the pair off the map entirely and stands
// them on two discs against the sky.
//
// In a headset the sky is the room, which is better than it sounds: the pair
// arrives on two clean platforms floating in front of the wearer with the
// furniture of a Pokemon lab no longer between them.
//
// Deliberately NOT its own little scene. The discs are parented to the same
// diorama root everything else uses and stand on the same arena cells, so the
// framing, the HUD blocks, the lunges and the blinks all carry on working
// without knowing this staging exists. What makes it a clean stage is that the
// terrain is switched off, not that the fight moved somewhere else.
//
// Each side is two discs, not one: a wider dark one and a lighter one just
// above it. That is the cartridge's own platform -- a filled ellipse with a
// rim -- and two flat meshes are cheaper than one mesh that has to carry a
// colour per vertex.

/** How wide a platform is, in world units, where an overworld tile is 2. */
export const DISC_RADIUS_UNITS: number = 1.7;
/** How much wider the dark disc under it is. */
const RIM_UNITS: number = 0.22;
/** How far the light disc floats over the dark one, so the rim reads. */
const RIM_LIFT_UNITS: number = 0.04;
/** Segments around the rim. Twenty is round at this size and costs nothing. */
const SEGMENTS: number = 20;

/** The cartridge's own two greys for a battle platform. */
export const DISC_LIGHT: number[] = [0.78, 0.78, 0.70, 1];
export const DISC_DARK: number[] = [0.35, 0.35, 0.32, 1];

export class BattleDiscs {
  private root: SceneObject;
  private makeMaterial: (colour: number[]) => Material;
  private mine: SceneObject = null;
  private theirs: SceneObject = null;
  private built: boolean = false;

  constructor(root: SceneObject, makeMaterial: (colour: number[]) => Material) {
    this.root = root;
    this.makeMaterial = makeMaterial;
  }

  /**
   * Stands a platform under each Pokemon.
   *
   * `groundAt` is still asked, even though the terrain is hidden while these
   * are up: the fight is framed on the arena's own ground height, so a disc
   * that ignored it would float at a different height than the shot is aimed
   * at, and on an upper floor that is metres out.
   */
  show(playerCell: number[], enemyCell: number[], widthTiles: number, heightTiles: number,
       groundAt: (x: number, z: number) => number): void {
    if (!this.built) {
      this.mine = this.build("BattleDiscMine");
      this.theirs = this.build("BattleDiscTheirs");
      this.built = true;
    }
    this.place(this.mine, playerCell, widthTiles, heightTiles, groundAt);
    this.place(this.theirs, enemyCell, widthTiles, heightTiles, groundAt);
    this.setEnabled(true);
  }

  hide(): void {
    this.setEnabled(false);
  }

  private setEnabled(on: boolean): void {
    if (this.mine) {
      this.mine.enabled = on;
    }
    if (this.theirs) {
      this.theirs.enabled = on;
    }
  }

  private place(object: SceneObject, cell: number[], widthTiles: number, heightTiles: number,
                groundAt: (x: number, z: number) => number): void {
    if (!object || !cell) {
      return;
    }
    const x = -widthTiles / 2 + cell[0] * 2 + 1;
    const z = -heightTiles / 2 + cell[1] * 2 + 1;
    object.getTransform().setLocalPosition(new vec3(x, groundAt(x, z), z));
  }

  /** One platform: a dark disc with a lighter one just above it. */
  private build(name: string): SceneObject {
    const holder = global.scene.createSceneObject(name);
    holder.setParent(this.root);
    this.addDisc(holder, DISC_RADIUS_UNITS + RIM_UNITS, 0, DISC_DARK);
    this.addDisc(holder, DISC_RADIUS_UNITS, RIM_LIFT_UNITS, DISC_LIGHT);
    holder.enabled = false;
    return holder;
  }

  private addDisc(parent: SceneObject, radius: number, lift: number, colour: number[]): void {
    const object = global.scene.createSceneObject("Disc");
    object.setParent(parent);
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;

    // A fan: the centre, then a ring. Flat on the ground plane, so it reads as
    // something stood ON rather than a card standing up.
    const vertices: number[] = [0, lift, 0, 0.5, 0.5];
    for (let i = 0; i < SEGMENTS; i++) {
      const angle = i / SEGMENTS * Math.PI * 2;
      const cx = Math.cos(angle);
      const cz = Math.sin(angle);
      vertices.push(cx * radius, lift, cz * radius, 0.5 + cx * 0.5, 0.5 + cz * 0.5);
    }
    builder.appendVerticesInterleaved(vertices);
    const indices: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      indices.push(0, 1 + i, 1 + ((i + 1) % SEGMENTS));
    }
    builder.appendIndices(indices);

    const mesh = builder.getMesh();
    // Without this the mesh has no geometry and the visual draws nothing, with
    // no error and no warning -- the fault that shipped the HUD blocks
    // invisible on 8 September.
    builder.updateMesh();

    const visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = mesh;
    visual.mainMaterial = this.makeMaterial(colour);
  }
}
