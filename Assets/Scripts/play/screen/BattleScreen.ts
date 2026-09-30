// A battle the way the Game Boy shows one: theirs top right, yours bottom
// left from behind, the two blocks, and the message box under it all.
//
// GAME BOY mode drew its overworld on the flat screen and then, the moment a
// fight began, grew the 3D diorama on the table beside it -- SPEC.md's own
// note said the classic layout was "its own step", and until 26 September that
// step had not been taken. This is it, and it is small, because everything on
// the screen already existed for other reasons: the front and back pictures
// (BattleActors), the two HUD blocks (BattleHudScreen, which paints them onto
// the pad's panel in DIORAMA mode), the message box (CanvasTextBox) and the
// move list (CanvasMenu). This file only puts them where the cartridge does.
//
// Where is measured off the cartridge's screen: the foe's picture in the seven
// tiles from column 12 down from row 0, your own in the seven from column 1
// standing on the message box's top edge at row 12, each picture centred in
// its seven columns and standing on the floor of its box -- the same rule
// PictureScreen uses for the museum's fossils. The blocks are at
// BattleHudScreen's own measured coordinates, which were the classic layout
// all along.
//
// Pure over a GbCanvas: test/battlescreen.test.mjs paints one and reads the
// pixels.

import type { WorldBundle } from "../../world/WorldData";
import type { GbCanvas, GbFont, ShadeImage } from "./GbCanvas";
import { imageFromPacked, TILE } from "./GbCanvas";
import type { BattleHudTiles, HudSide } from "./BattleHudScreen";
import { paintEnemyHud, paintPlayerHud } from "./BattleHudScreen";
import { GHOST_PICTURE } from "../battle/Ghost";

/** The seven columns the foe stands in, and the row its box starts on. */
export const ENEMY_PIC_TX: number = 12;
export const ENEMY_PIC_TY: number = 0;
/** The seven columns you stand in, and the row your feet are on: the message box's top. */
export const PLAYER_PIC_TX: number = 1;
export const PLAYER_PIC_FLOOR_TY: number = 12;
/** A picture's box is seven tiles square: the largest front picture, plus nothing. */
export const PIC_BOX_TILES: number = 7;

/**
 * The picture to draw for one side, or null when the bundle has none.
 *
 * `picture` is what BattleRunner.picturesOnField names: a species, or the
 * GhostPic for a foe nobody has identified. Back pictures are the species'
 * own; the ghost has no back and is never yours.
 */
export function battlePicture(bundle: WorldBundle, picture: string, back: boolean): ShadeImage {
  if (!bundle || !picture) {
    return null;
  }
  const pictures: any = (bundle as any).pictures;
  if (!back && picture === GHOST_PICTURE && pictures && pictures.ghost) {
    return imageFromPacked(pictures.ghost);
  }
  const spec: any = bundle.species ? (bundle.species as any)[picture] : null;
  if (!spec) {
    return null;
  }
  return imageFromPacked(back ? spec.back : spec.front);
}

/** A picture centred in its seven columns, standing on `floorTy`. */
function standPicture(canvas: GbCanvas, image: ShadeImage, tx: number, floorTy: number): void {
  if (!image) {
    return;
  }
  const inside = PIC_BOX_TILES * TILE;
  const x = tx * TILE + Math.floor((inside - image.width) / 2);
  const y = floorTy * TILE - image.height;
  canvas.blit(image, x, y, true);
}

/**
 * The whole battle screen but the message box, which CanvasTextBox paints
 * over rows 12 to 17 exactly as it does over the overworld.
 *
 * `mine` and `theirs` are the HUD's own sides -- name, level, the TRAVELLING
 * hp -- and `minePic`/`theirsPic` what to draw for each. The pictures go
 * down first so the blocks stand over them, as the cartridge's tilemap has
 * the blocks over the sprites' corners.
 */
export function paintBattleScreen(canvas: GbCanvas, font: GbFont, bundle: WorldBundle,
                                  tiles: BattleHudTiles, mine: HudSide, theirs: HudSide,
                                  minePic: string, theirsPic: string): void {
  canvas.clear(0);
  standPicture(canvas, battlePicture(bundle, theirsPic, false),
               ENEMY_PIC_TX, ENEMY_PIC_TY + PIC_BOX_TILES);
  standPicture(canvas, battlePicture(bundle, minePic, true),
               PLAYER_PIC_TX, PLAYER_PIC_FLOOR_TY);
  paintEnemyHud(canvas, font, theirs, tiles);
  paintPlayerHud(canvas, font, mine, tiles);
}
