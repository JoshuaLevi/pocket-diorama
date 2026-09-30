// Overworld characters as upright billboards, the way the reference footage does it:
// a 3D voxel world with the original 2D sprites standing in it. Keeping the
// characters 2D is not a shortcut -- it is what makes the diorama read as Gen 1
// rather than as a generic voxel game.
//
// Gen 1 stores six 16x16 frames per walker: facing down, up and left, then the
// walking variant of each. There is no right-facing frame; right is left mirrored,
// which is why the quad flips its U coordinates instead of picking a seventh frame.

import type { SpriteDef } from "./WorldData";
import { unpackShades, unpackMask } from "./WorldData";

const FRAME_PIXELS: number = 16;

/** Frame indices as the ROM lays them out. */
const FRAME_DOWN: number = 0;
const FRAME_UP: number = 1;
const FRAME_LEFT: number = 2;
const FRAME_DOWN_WALK: number = 3;
const FRAME_UP_WALK: number = 4;
const FRAME_LEFT_WALK: number = 5;

export interface SpriteSheet {
  texture: Texture;
  frames: number;
  frameWidth: number;
  frameHeight: number;
  sheetHeight: number;
}

/**
 * Expands a sprite into an RGBA texture with real transparency.
 *
 * Like the tile atlas, the buffer is written bottom-up because setPixels fills a
 * texture from the bottom while the sprite data is stored top-down.
 */
export function buildSpriteSheet(
  sprite: SpriteDef,
  palettes: any,
  paletteName: string
): SpriteSheet {
  const width = sprite.width;
  const height = sprite.height;
  const pixelCount = width * height;
  const shades = unpackShades(sprite.shades, pixelCount);
  const alpha = unpackMask(sprite.alpha, pixelCount);

  let colours: number[][] = palettes ? palettes[paletteName] : null;
  if (!colours || colours.length !== 4) {
    colours = [[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]];
  }

  const rgba = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const colour = colours[shades[i]];
    const o = ((height - 1 - y) * width + x) * 4;
    rgba[o] = colour[0];
    rgba[o + 1] = colour[1];
    rgba[o + 2] = colour[2];
    rgba[o + 3] = alpha[i] === 1 ? 255 : 0;
  }

  const texture = ProceduralTextureProvider.createWithFormat(
    width,
    height,
    TextureFormat.RGBA8Unorm
  );
  const control = texture.control as ProceduralTextureProvider;
  control.setPixels(0, 0, width, height, rgba);

  return {
    texture: texture,
    frames: sprite.frames,
    frameWidth: width,
    frameHeight: FRAME_PIXELS,
    sheetHeight: height,
  };
}

/**
 * How many frames a sheet holds: its height over one frame's.
 *
 * A walker is six 16-pixel frames stacked in a 96-pixel sheet. A battle pic is
 * ONE frame as tall as the whole image, and reading it with a walker's frame
 * height says two -- so the quad would show the top 16 rows of a 40-pixel
 * Pokemon and call it drawn. Whoever builds a single-frame sheet has to say so
 * (see BattleActors); this is where the answer is computed, and it never
 * returns zero, which would divide the UVs by nothing.
 */
export function sheetRows(sheet: SpriteSheet): number {
  const rows = Math.floor(sheet.sheetHeight / sheet.frameHeight);
  return rows > 0 ? rows : 1;
}

/** The frame to draw for a facing, and whether it has to be mirrored. */
export function frameFor(facing: string, walking: boolean): number[] {
  if (facing === "up") {
    return [walking ? FRAME_UP_WALK : FRAME_UP, 0];
  }
  if (facing === "left") {
    return [walking ? FRAME_LEFT_WALK : FRAME_LEFT, 0];
  }
  if (facing === "right") {
    // Mirrored left, exactly as the original does it.
    return [walking ? FRAME_LEFT_WALK : FRAME_LEFT, 1];
  }
  return [walking ? FRAME_DOWN_WALK : FRAME_DOWN, 0];
}

/**
 * An upright quad that always faces the viewer, carrying one animation frame.
 *
 * The mesh is rebuilt only when the frame changes; turning to face the camera is a
 * transform write, which costs nothing per frame.
 */
/**
 * How much of the camera's own pitch a sprite leans back by, hinged at its feet.
 *
 * One, which is the reference's own answer: `lib/SpriteBillboards.lua` has each
 * character "leunt alleen achterover, scharnierend bij de voeten, precies de
 * camerapitch". Our first read of that comparison judged the gap "~geen" and we
 * shipped upright billboards; three playtests later the 8 September preview
 * showed why it is not none. A diorama is looked DOWN at -- fifty, sixty degrees
 * from a chair -- and an upright billboard at sixty degrees is squashed to a
 * third of its height. Red and the NPCs read as smeared into the floor, which
 * is exactly what was reported.
 *
 * Zero is the old behaviour, if a lean ever looks worse than the squash.
 */
export const LEAN_WITH_PITCH: number = 1;

/**
 * How far back a sprite may lean, in degrees, however steeply you look down.
 *
 * The reference leans by EXACTLY the camera pitch, and doing the same buried
 * the player: hinged at the feet, a sprite laid right back puts its head down
 * near ground level and a tile or so BEHIND its feet -- and what is behind its
 * feet is tall grass, which stands 1.25 units up. The 8 September shot is a
 * character with the grass growing through its head.
 *
 * The cap comes from those two numbers. A character is 2.2 units tall, so
 * leaning theta puts its head at 2.2*cos(theta). Keeping that clear of 1.25
 * units of grass wants cos(theta) > 0.57, which is 55 degrees; 45 leaves room
 * for the relief the grass itself sits on.
 *
 * It costs very little of what the lean was for. Looking down at 60 degrees,
 * an upright sprite shows half its height; leaning the full 60 shows all of it,
 * and leaning 45 shows 91 per cent of it.
 */
export const LEAN_MAX_DEGREES: number = 45;

export class Billboard {
  private builder: MeshBuilder;
  private mesh: RenderMesh;
  private sheet: SpriteSheet;
  private object: SceneObject;
  private visual: RenderMeshVisual;
  private currentFrame: number = -1;
  private currentFlip: number = -1;
  // setFrame rewrites the quad's vertices, so it needs the size the constructor
  // chose. Hardcoding it there silently resized every character to one unit.
  private heightUnits: number = 1;

  constructor(object: SceneObject, sheet: SpriteSheet, material: Material, heightUnits: number) {
    this.object = object;
    this.sheet = sheet;
    this.heightUnits = heightUnits;

    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;

    // One quad, standing on the ground plane, as wide as it is tall.
    const half = heightUnits / 2;
    this.builder.appendVerticesInterleaved([
      -half, 0, 0, 0, 0,
      half, 0, 0, 1, 0,
      half, heightUnits, 0, 1, 1,
      -half, heightUnits, 0, 0, 1,
    ]);
    this.builder.appendIndices([0, 1, 2, 0, 2, 3]);
    this.mesh = this.builder.getMesh();
    this.builder.updateMesh();

    this.visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.visual.mesh = this.mesh;
    this.visual.mainMaterial = material;
  }

  /**
   * When this billboard is drawn relative to everything else.
   *
   * Only the battle pair asks for it. In an overworld a character standing
   * behind a house SHOULD be hidden by the house; in a fight the two Pokemon
   * are the subject, and a lab bench cutting a Charmander in half is what the
   * 8 September preview showed -- read, reasonably, as the sprite glitching
   * through the floor.
   */
  setRenderOrder(order: number): void {
    if (this.visual) {
      this.visual.renderOrder = order;
    }
  }

  /** Rewrites the quad's UVs for a frame. Cheap, and skipped when unchanged. */
  setFrame(frame: number, flip: number): void {
    if (frame === this.currentFrame && flip === this.currentFlip) {
      return;
    }
    this.currentFrame = frame;
    this.currentFlip = flip;

    const rows = sheetRows(this.sheet);
    const index = frame < 0 || frame >= rows ? 0 : frame;
    const halfTexel = 0.5 / this.sheet.sheetHeight;

    // Frames run down the sheet while V runs up it, so frame 0 is the topmost band.
    const vTop = 1 - index / rows - halfTexel;
    const vBottom = 1 - (index + 1) / rows + halfTexel;
    const u0 = flip === 1 ? 1 : 0;
    const u1 = flip === 1 ? 0 : 1;

    // A Gen 1 character frame is square, so half-width equals half-height.
    const half = this.heightUnits / 2;
    const top = this.heightUnits;
    this.builder.setVertexInterleaved(0, [-half, 0, 0, u0, vBottom]);
    this.builder.setVertexInterleaved(1, [half, 0, 0, u1, vBottom]);
    this.builder.setVertexInterleaved(2, [half, top, 0, u1, vTop]);
    this.builder.setVertexInterleaved(3, [-half, top, 0, u0, vTop]);
    this.builder.updateMesh();
  }

  /** Turns the billboard to face the camera, upright, about Y only. */
  faceCamera(cameraWorldPosition: vec3): void {
    const transform = this.object.getTransform();
    const here = transform.getWorldPosition();
    const dx = cameraWorldPosition.x - here.x;
    const dy = cameraWorldPosition.y - here.y;
    const dz = cameraWorldPosition.z - here.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);
    if (horizontal < 0.0001 && Math.abs(dy) < 0.0001) {
      return;
    }
    // Yaw about the world's up, then lean back about the sprite's own right --
    // a product, not Euler angles, whose order would decide which lands first.
    // The object's origin is at the sprite's FEET (its quad runs from y=0 up),
    // so this hinges where the reference's does.
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(dy, horizontal);
    const cap = LEAN_MAX_DEGREES * Math.PI / 180;
    let lean = pitch * LEAN_WITH_PITCH;
    if (lean > cap) {
      lean = cap;
    } else if (lean < -cap) {
      lean = -cap;
    }
    const yawTurn = quat.angleAxis(yaw, new vec3(0, 1, 0));
    const leanTurn = quat.angleAxis(-lean, new vec3(1, 0, 0));
    transform.setWorldRotation(yawTurn.multiply(leanTurn));
  }
}
