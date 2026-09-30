// Whether the room's message panel is on screen this frame.
//
// One line of judgement, pulled out of PokemonAR.updateMessagePanel because
// getting it wrong is invisible from the code and very visible on the glasses.
//
// THE BUG THIS EXISTS FOR, in the words of the fourth glasses playtest
// (Joshua, 10 September): "als ik een gevecht eenmaal in table mode heb, dan
// kan ik nergens het menu zien voor de attack etc. Ik zie alleen een heel nice
// frame met daarin de dialoog."
//
// Two changes made the same week compose into it, and neither is wrong alone:
//
//   1. hideBox() learned to switch the whole panel off. Before that a battle
//      ended on its last page with nothing left owning it, so nothing could
//      acknowledge it and the wearer could not press their way out.
//   2. The fight's MENU moved onto that same panel, out of the frameless
//      GlyphPanel that had been writing TACKLE across a field of green grass
//      in the 8 September recordings.
//
// And BattleRunner.afterReading() calls hideBox() first and showMoves() four
// lines later. So from that day the menu was painted, cropped and uploaded,
// every frame, onto a surface that was switched off. The message box worked
// (it turns the panel back on when it opens); the HUD blocks worked (they are
// their own quads reading the same texture); the frame worked (it is its own
// object). Only the thing the wearer had to press was gone.
//
// The rule is therefore: the panel is shown for WHAT IS ON IT, not for the
// message box alone. Pure -- five booleans in, one out -- so the truth table
// can be stated in a test rather than discovered on a headset.

/** What the panel may be carrying, and what may be taking the frame from it. */
export interface PanelContents {
  /**
   * GAME BOY mode. Everything the panel could carry -- the box, the fight's
   * menu, the style question -- is drawn on the flat screen there, and a
   * panel out in the room showing the same rows a second time is what the
   * first fight in that mode looked like on 26 September. Optional: a caller
   * that does not say is in DIORAMA mode.
   */
  gameBoy?: boolean;
  /** The message box is open: a line of dialogue, a battle line, a sign. */
  boxOpen: boolean;
  /** A battle is running. On its own this shows NOTHING; see the note below. */
  fightOn: boolean;
  /** The fight's FIGHT / PKMN / ITEM / RUN menu is open. */
  menuOpen: boolean;
  /** The first fight's "how should a battle look" question is up. */
  styleAsked: boolean;
  /**
   * Another full-screen surface has the frame, and this one may not be behind
   * it: the OPTION page, the naming screen, a Pokedex entry.
   *
   * This is a field rather than a hard-coded look at the view page because of
   * how the bug above was survivable for two days. Nothing ever turned this
   * panel back ON except the code that put something on it, so a surface that
   * switched it off could be sure it stayed off. The rule turns it on now, so
   * every surface that takes the frame has to be named here or it gets a white
   * slab behind it.
   */
  frameTaken: boolean;
}

/**
 * Whether the panel should be visible.
 *
 * `fightOn` is deliberately NOT a reason to show it. A fight keeps the canvas
 * being painted and uploaded every frame -- both HUD blocks live on it and are
 * shown by their own quads out beside the Pokemon -- but between one page and
 * the next there is genuinely nothing on the panel itself, and a blank white
 * slab hanging over the table is worse than no slab. It is here as a field
 * because the menu only counts while a fight is running: `menu.isOpen()` is
 * also true for the START menu in the overworld, which has its own surface.
 */
export function panelShouldShow(what: PanelContents): boolean {
  if (what.gameBoy === true) {
    return false;
  }
  if (what.frameTaken) {
    return false;
  }
  if (what.styleAsked) {
    return true;
  }
  if (what.fightOn && what.menuOpen) {
    return true;
  }
  return what.boxOpen === true;
}
