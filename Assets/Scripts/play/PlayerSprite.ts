// Which sheet the player is drawn from: on foot, on the BICYCLE, or on the water.
//
// LoadPlayerSpriteGraphics (home/overworld.asm:811-838) reads
// wWalkBikeSurfState: 0 loads RedSprite, 1 RedBikeSprite, 2 SeelSprite. That
// last one is not a mount under RED -- on the cartridge the player IS the
// SEEL-shaped blob while surfing, and RED is not drawn at all. The three
// sheets share one layout (six 16x16 frames: down, up, left, and the three
// walking frames), so swapping one for another is swapping a texture.
//
// The bike and the SEEL only reach the bundle since 12 September 2026; a world
// baked before that has neither, and the player stays RED rather than vanish.

export const SPRITE_PLAYER: string = "SPRITE_RED";
export const SPRITE_PLAYER_BIKE: string = "SPRITE_RED_BIKE";
export const SPRITE_PLAYER_SURF: string = "SPRITE_SEEL";

/** The sheet for the player's state, falling back to RED where the bundle lacks one. */
export function playerSpriteId(riding: boolean, surfing: boolean, bundle: any): string {
  const sprites = bundle && bundle.sprites ? bundle.sprites : null;
  // Surfing wins over riding, as the state byte does: you cannot cycle on the sea.
  if (surfing && sprites && sprites[SPRITE_PLAYER_SURF]) {
    return SPRITE_PLAYER_SURF;
  }
  if (riding && sprites && sprites[SPRITE_PLAYER_BIKE]) {
    return SPRITE_PLAYER_BIKE;
  }
  return SPRITE_PLAYER;
}

/** Whose colours a player sheet wears: the bike is RED in RED's clothes. */
export function playerPaletteId(spriteId: string): string {
  return spriteId === SPRITE_PLAYER_BIKE ? SPRITE_PLAYER : spriteId;
}
