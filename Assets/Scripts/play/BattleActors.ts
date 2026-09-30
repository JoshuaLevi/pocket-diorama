// The two Pokemon standing on the ground during a battle.
//
// Until now a battle drew none. A wild encounter put ONE portrait in front of
// the player -- a 40-pixel front pic blown up to two and a half times a
// character, which is the "it towers over the houses" the reference warns
// about -- and a trainer battle drew nothing at all, so fighting the rival was
// a zoom in, a menu, and an empty room. That is what was reported.
//
// What the cartridge shows is a pair: theirs from the front, yours from the
// back. Both pics are in the bundle now, so both are drawn, on the two cells
// BattleArena picked, at the size the reference solved for: a Pokemon stands in
// ONE overworld square. Bigger and the world behind it reads as a backdrop
// rather than as the place the fight is happening in.
//
// They are billboards like every character in this diorama: 2D art standing in
// a 3D world is what makes it read as Gen 1 rather than as a voxel game.

import { GHOST_PALETTE, GHOST_PICTURE } from "./battle/Ghost";
import { UNVEIL_STEPS, washedPalette } from "./battle/Unveil";
import type { WorldBundle } from "../world/WorldData";
import type { Arena } from "../world/BattleArena";
import { Billboard, buildSpriteSheet } from "../world/SpriteBillboard";

/**
 * How tall a battling Pokemon stands, in mesh units, where a tile is 1 and a
 * character is 2.2.
 *
 * The reference solves this from its own screen: a front pic is 56 pixels and
 * has to stand on a 16-pixel tile, so the square it stands on projects to about
 * the width of the pic. One square is two units here, and a shade over that
 * puts a Pokemon a little taller than the trainer facing it -- which is what
 * the cartridge's own sprites look like side by side.
 */
export const BATTLE_MON_UNITS: number = 2.4;

/**
 * When the pair is drawn: after the world, before anything the wearer reads.
 *
 * The message panel and the HUD blocks are at 101 and the Game Boy screen at
 * 100, so this stays under all of them and over the terrain.
 */
export const BATTLE_MON_RENDER_ORDER: number = 98;

/**
 * How far a battling Pokemon floats over the ground it stands on.
 *
 * Its quad's bottom edge sits exactly ON the ground plane, which is coplanar
 * with the terrain's own top face -- and two coplanar surfaces flicker against
 * each other wherever the depth buffer cannot separate them. A twentieth of a
 * unit is a millimetre at tabletop scale and settles it.
 */
const GROUND_CLEARANCE_UNITS: number = 0.05;

/**
 * The pic size that height is quoted for. Gen 1 draws its species at 5x5, 6x6
 * or 7x7 tiles and that IS how big they look, so a pic bigger than this one
 * stands proportionally taller: a Snorlax should not be a Pidgey's height.
 */
const REFERENCE_PIC_PIXELS: number = 40;

export class BattleActors {
  private root: SceneObject;
  private makeMaterial: () => Material;

  private mineObject: SceneObject = null;
  private theirsObject: SceneObject = null;
  private mineBillboard: Billboard = null;
  private theirsBillboard: Billboard = null;
  private mineMaterial: Material = null;
  private theirsMaterial: Material = null;
  /** What is drawn now, so an unchanged pair costs nothing per frame. */
  private drawn: string = "";
  /** How far each has lunged toward the other, 0..1 of the gap between them. */
  private mineReach: number = 0;
  private theirsReach: number = 0;
  /** Whether each is drawn: a struck Pokemon blinks, as it does on the cartridge. */
  private mineVisible: boolean = true;
  private theirsVisible: boolean = true;
  /** How far the foe's picture is washed toward white: the SILPH SCOPE's fade. */
  private theirsWash: number = 0;

  constructor(root: SceneObject, makeMaterial: () => Material) {
    this.root = root;
    this.makeMaterial = makeMaterial;
  }

  /**
   * Draws the pair, or redraws it when either side changed.
   *
   * `groundAt` is the terrain's own surface height at a point, so a Pokemon
   * stands ON the world rather than at a guessed height.
   */
  show(bundle: WorldBundle, arena: Arena, mine: string, theirs: string,
       widthTiles: number, heightTiles: number,
       groundAt: (x: number, z: number) => number): void {
    const key = mine + ">" + theirs + "@" + this.theirsWash;
    if (key !== this.drawn) {
      this.drawn = key;
      this.mineBillboard = this.build(bundle, mine, true);
      this.theirsBillboard = this.build(bundle, theirs, false);
      if (this.mineBillboard) {
        this.mineBillboard.setRenderOrder(BATTLE_MON_RENDER_ORDER);
      }
      if (this.theirsBillboard) {
        this.theirsBillboard.setRenderOrder(BATTLE_MON_RENDER_ORDER);
      }
    }
    this.place(this.mineObject, arena.playerCell, arena.enemyCell, this.mineReach,
               widthTiles, heightTiles, groundAt);
    this.place(this.theirsObject, arena.enemyCell, arena.playerCell, this.theirsReach,
               widthTiles, heightTiles, groundAt);
    if (this.mineObject) {
      this.mineObject.enabled = this.mineBillboard !== null && this.mineVisible;
    }
    if (this.theirsObject) {
      this.theirsObject.enabled = this.theirsBillboard !== null && this.theirsVisible;
    }
  }

  /**
   * How far each side has lunged and whether each is drawn this frame.
   *
   * Set before show(), which is what actually moves them: keeping the numbers
   * here rather than passing them through show() means a caller that has no
   * animator at all still gets a pair standing still, which is what every test
   * and the headless lens want.
   */
  setMotion(mineReach: number, mineVisible: boolean,
            theirsReach: number, theirsVisible: boolean): void {
    this.mineReach = mineReach;
    this.mineVisible = mineVisible;
    this.theirsReach = theirsReach;
    this.theirsVisible = theirsVisible;
  }

  /**
   * How far the foe is washed toward white, 0..1 (play/battle/Unveil.ts).
   *
   * Set before show(), like setMotion, and for the same reason. The value is
   * quantised by the caller to UNVEIL_STEPS: it is part of the key the pair is
   * rebuilt on, and a wash that moved every frame would build a texture a
   * frame.
   */
  setWash(theirsWash: number): void {
    const w = theirsWash > 0 ? (theirsWash > 1 ? 1 : theirsWash) : 0;
    this.theirsWash = Math.round(w * UNVEIL_STEPS) / UNVEIL_STEPS;
  }

  /** Takes them off the field. Safe to call when nothing is up. */
  hide(): void {
    this.drawn = "";
    if (this.mineObject) {
      this.mineObject.enabled = false;
    }
    if (this.theirsObject) {
      this.theirsObject.enabled = false;
    }
  }

  /** Square to the wearer, upright, like every other billboard here. */
  faceCamera(eye: vec3): void {
    if (!eye) {
      return;
    }
    if (this.mineBillboard && this.mineObject && this.mineObject.enabled) {
      this.mineBillboard.faceCamera(eye);
    }
    if (this.theirsBillboard && this.theirsObject && this.theirsObject.enabled) {
      this.theirsBillboard.faceCamera(eye);
    }
  }

  /** Whether anything is currently on the field. */
  isShowing(): boolean {
    return this.drawn !== "";
  }

  /**
   * Points one side's billboard at a species' picture.
   *
   * The quad is built ONCE and reused: only the texture changes between
   * species, and building a new Billboard on the same holder each time would
   * hang another RenderMeshVisual on it -- a stack of overlapping Pokemon after
   * a few switches.
   */
  private build(bundle: WorldBundle, species: string, back: boolean): Billboard {
    // A foe nobody has identified is the cartridge's GhostPic (Ghost.ts); a
    // bundle baked before it was carried draws the species, as it always did.
    const pictures: any = bundle.pictures ? bundle.pictures : null;
    const ghostPic = !back && species === GHOST_PICTURE && pictures ? pictures.ghost : null;
    const spec: any = ghostPic ? { palette: GHOST_PALETTE }
      : (bundle.species ? bundle.species[species] : null);
    const pic = ghostPic ? ghostPic : (spec ? (back ? spec.back : spec.front) : null);
    if (!pic) {
      // A species with no picture is a bundle baked before both were carried.
      // Drawing nothing is better than drawing the wrong one.
      print("[BattleActors] no " + (back ? "back" : "front") + " picture for " + species);
      return null;
    }
    // The species' own Super Game Boy colours (Pikachu yellow, Charmander
    // red), the way the cartridge paints a battle on an SGB. Every Pokemon wore
    // the map's ROUTE greens until 19 September because the bundle never
    // carried the palette; a bundle baked before then still has none.
    const own = spec.palette && bundle.palettes && bundle.palettes[spec.palette];
    // The SILPH SCOPE's fade, and the only thing that touches the colours: a
    // palette washed toward white, exactly as the cartridge walks its own
    // palette register. Own side never fades.
    let palettes: any = bundle.palettes;
    let paletteName = own ? spec.palette : bundle.defaultPalette;
    const wash = back ? 0 : this.theirsWash;
    if (wash > 0) {
      const source = palettes && palettes[paletteName] ? palettes[paletteName] : null;
      if (source) {
        palettes = { WASH: washedPalette(source, wash) };
        paletteName = "WASH";
      }
    }
    const sheet = buildSpriteSheet(
      {
        id: species,
        frames: 1,
        walker: false,
        width: pic.width,
        height: pic.height,
        shades: pic.shades,
        alpha: pic.alpha,
      } as any,
      palettes,
      paletteName
    );
    // buildSpriteSheet assumes a WALKER: 16-pixel frames stacked down a sheet.
    // A battle pic is one frame as tall as the whole image, and taking the
    // default here drew the top 16 rows of a 40-pixel Pokemon -- which is what
    // the old wild-encounter portrait was doing, unnoticed, all along.
    sheet.frameHeight = sheet.sheetHeight;

    const object = back ? this.mineHolder() : this.theirsHolder();
    let material = back ? this.mineMaterial : this.theirsMaterial;
    if (!material) {
      material = this.makeMaterial();
      if (back) {
        this.mineMaterial = material;
      } else {
        this.theirsMaterial = material;
      }
    }
    material.mainPass.baseTex = sheet.texture;

    let billboard = back ? this.mineBillboard : this.theirsBillboard;
    if (!billboard) {
      billboard = new Billboard(object, sheet, material, BATTLE_MON_UNITS);
      billboard.setFrame(0, 0);
    }
    // Bigger art, bigger Pokemon: the quad is one size and the holder carries
    // the difference, so nothing has to be rebuilt to change it.
    const scale = pic.height / REFERENCE_PIC_PIXELS;
    object.getTransform().setLocalScale(new vec3(scale, scale, scale));
    return billboard;
  }

  visibleHolders(): SceneObject[] { return [this.mineObject,this.theirsObject]; }

  private mineHolder(): SceneObject {
    if (!this.mineObject) {
      this.mineObject = global.scene.createSceneObject("BattleMonMine");
      this.mineObject.setParent(this.root);
    }
    return this.mineObject;
  }

  private theirsHolder(): SceneObject {
    if (!this.theirsObject) {
      this.theirsObject = global.scene.createSceneObject("BattleMonTheirs");
      this.theirsObject.setParent(this.root);
    }
    return this.theirsObject;
  }

  /**
   * Stands one Pokemon on its cell, `reach` of the way toward the other.
   *
   * The height stays the ground under its OWN cell rather than under wherever
   * the lunge has carried it: a lunge across a ledge would otherwise drop the
   * attacker down the step and back up again mid-swing.
   */
  private place(object: SceneObject, cell: number[], other: number[], reach: number,
                widthTiles: number, heightTiles: number,
                groundAt: (x: number, z: number) => number): void {
    if (!object || !cell) {
      return;
    }
    const x = -widthTiles / 2 + cell[0] * 2 + 1;
    const z = -heightTiles / 2 + cell[1] * 2 + 1;
    const y = groundAt(x, z);
    let atX = x;
    let atZ = z;
    if (reach > 0 && other) {
      const ox = -widthTiles / 2 + other[0] * 2 + 1;
      const oz = -heightTiles / 2 + other[1] * 2 + 1;
      atX = x + (ox - x) * reach;
      atZ = z + (oz - z) * reach;
    }
    object.getTransform().setLocalPosition(new vec3(atX, y + GROUND_CLEARANCE_UNITS, atZ));
  }
}
