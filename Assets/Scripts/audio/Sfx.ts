/**
 * The sound effects the lens asks for, by their name in the cartridge.
 *
 * One place, for one reason: these are ROM keys, and a wrong one fails the way
 * audio bugs always fail -- silently. `Pokecenter_Heal` is the cautionary case;
 * a script has asked for it since long before anything could play a sound, and
 * the cartridge has no effect by that name at all (it is a short piece of MUSIC,
 * Music_PkmnHealed). Nothing said so until something tried to play it.
 *
 * test/music.test.mjs walks this list against the bundle's own table, so a name
 * that is not in the cartridge is a failing gate rather than a quiet nothing.
 */

/* The overworld ------------------------------------------------------------ */

/** Walking into a wall. */
export const SFX_COLLISION: string = "Collision";
/** Hopping down a ledge. */
export const SFX_LEDGE: string = "Ledge";
/** A page of text acknowledged. */
export const SFX_PRESS_AB: string = "Press_AB";
/** The START menu opening. */
export const SFX_START_MENU: string = "Start_Menu";
/** The game saved. */
export const SFX_SAVE: string = "Save";
/** Something bought at the Mart. */
export const SFX_PURCHASE: string = "Purchase";
/* Battles ------------------------------------------------------------------ */

/** A move connected. */
export const SFX_DAMAGE: string = "Damage";
export const SFX_SUPER_EFFECTIVE: string = "Super_Effective";
export const SFX_NOT_VERY_EFFECTIVE: string = "Not_Very_Effective";
/** Somebody fainted. */
export const SFX_FAINT: string = "Faint_Fall";
/** A ball thrown, and the two ways it ends. */
export const SFX_BALL_TOSS: string = "Ball_Toss";
export const SFX_CAUGHT: string = "Caught_Mon";
export const SFX_BALL_POOF: string = "Ball_Poof";
/** Running away, successfully. */
export const SFX_RUN: string = "Run";

/**
 * FLY: SFX_HEAL_AILMENT when the town is picked on the map
 * (engine/items/town_map.asm:208-217) and SFX_FLY as the bird carries the
 * player off (engine/overworld/player_animations.asm:140-149).
 */
export const SFX_HEAL_AILMENT: string = "Heal_Ailment";
export const SFX_FLY: string = "Fly";

/** Every name above, for the gate that checks them against the cartridge. */
export const ALL_SFX: string[] = [
  SFX_COLLISION, SFX_LEDGE, SFX_PRESS_AB, SFX_START_MENU, SFX_SAVE,
  SFX_PURCHASE,
  SFX_DAMAGE, SFX_SUPER_EFFECTIVE, SFX_NOT_VERY_EFFECTIVE, SFX_FAINT,
  SFX_BALL_TOSS, SFX_CAUGHT, SFX_BALL_POOF, SFX_RUN,
  SFX_HEAL_AILMENT, SFX_FLY,
];
