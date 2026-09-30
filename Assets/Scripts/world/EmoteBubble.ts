// The mark a trainer throws up when he spots you.
//
// On the cartridge this is EmotionBubble (engine/overworld/emotion_bubbles.asm):
// four tiles copied over the sprite's head, sixty frames of DelayFrames, then
// the sprites are redrawn and the walk begins. It is the only warning you get
// that the next thing is a fight, and without it a trainer simply starts
// walking at you for no reason anyone can see.
//
// Ours is drawn rather than extracted, which is a decision and not a shortcut.
// The alternative was to pull gfx/emotes/shock.2bpp into the bundle, and that
// costs a re-bake of every world -- and with it every measurement taken against
// the old one -- for four tiles. Drawing it here costs nothing and keeps the
// bundle exactly where it is.
//
// It is a BILLBOARD and not voxels on purpose. Every character in this diorama
// is a flat sprite standing in a solid world, because that is what makes it
// read as Gen 1 rather than as a voxel game; a cube of an exclamation mark
// over a flat head would be the one object in the scene disagreeing with that.
//
// And it is white with no outline, because the display is additive: on a
// see-through lens the dark half of a Game Boy outline is not dark, it is
// absent. Brightness is the only contrast there is, so the mark is all
// brightness (Legibility.ts holds the same reasoning for the terrain).

import type { SpriteSheet } from "./SpriteBillboard";

/**
 * How long the mark stays up: sixty frames, or one second.
 *
 * `ld c, 60 / call DelayFrames`. The cartridge can count frames because it
 * always has sixty of them; a lens cannot. The preview runs at roughly 3.5 fps
 * on a big map, where sixty frames is seventeen seconds of an exclamation mark
 * hanging over a man's head -- measured, not guessed, on 11 September.
 *
 * So the two live side by side and mean the same thing. The headless harness
 * steps a fixed 1/60 s frame and counts FRAMES, which keeps it deterministic
 * and keeps it identical to the cartridge; the lens reads the clock and counts
 * SECONDS, which keeps it one second whatever the frame rate does.
 */
export const EMOTE_FRAMES: number = 60;
export const EMOTE_SECONDS: number = 1.0;

const SIZE: number = 16;

/** The only one so far; the routine takes three and the other two have no caller. */
export const EMOTE_SHOCK: string = "shock";

/**
 * The mark as a one-frame sheet, drawn straight into pixels.
 *
 * A wide head narrowing to a bar, a two-row gap, then a square. The taper is
 * three rows of six pixels over five of four, which is as much shape as
 * sixteen pixels allows and is the difference between reading as "!" and
 * reading as ":". Nothing is anti-aliased: the billboards sample with nearest
 * filtering, so a soft edge would only be a blurred one.
 */
export function buildEmoteSheet(kind: string): SpriteSheet {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  const bar = kind === EMOTE_SHOCK;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Rows are written bottom-up, as buildSpriteSheet does: setPixels fills
      // from the bottom and every drawing here is described from the top.
      const o = ((SIZE - 1 - y) * SIZE + x) * 4;
      const inHead = bar && x >= 5 && x <= 10 && y >= 2 && y <= 4;
      const inStem = bar && x >= 6 && x <= 9 && y >= 5 && y <= 9;
      const inDot = bar && x >= 5 && x <= 10 && y >= 12 && y <= 14;
      const on = inHead || inStem || inDot;
      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      rgba[o + 3] = on ? 255 : 0;
    }
  }
  const texture = ProceduralTextureProvider.createWithFormat(
    SIZE, SIZE, TextureFormat.RGBA8Unorm);
  const control = texture.control as ProceduralTextureProvider;
  control.setPixels(0, 0, SIZE, SIZE, rgba);
  return {
    texture: texture,
    frames: 1,
    frameWidth: SIZE,
    frameHeight: SIZE,
    sheetHeight: SIZE,
  };
}
