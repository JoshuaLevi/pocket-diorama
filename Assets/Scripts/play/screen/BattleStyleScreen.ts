// The one question the lens asks about fights, asked once, at the first one.
//
// SELECT has cycled TABLE / DISCS / LIFE since 7 September and the OPTION page
// has carried the row since 8 September, and neither is any use to someone who
// has not yet discovered that a fight can be staged three ways. Three playtests
// running, the complaint was the staging -- lab benches between the wearer and
// the Pokemon, a rug swallowing a Bulbasaur, "de objecten staan in de weg" --
// and every one of those had a one-press answer nobody knew was there.
//
// So it asks. Once, at the first battle, and then never again.
//
// It is drawn in the MESSAGE BOX rather than over the whole screen, and that is
// the whole design: the box is six rows at the bottom, the fight is already
// staged above it, and moving the cursor restages it for real. There is no
// artwork of the three options because there does not need to be -- the option
// IS the picture. Press left and the scenery goes; press right and you are
// standing in it.
//
// Pure: step() and paint(). The lens feeds it the pad, applies whatever
// `chosen()` says, and paints what this asks for.

import type { GbCanvas, GbFont } from "./GbCanvas";
import { BATTLE_LABELS } from "./ViewOptions";

const TILE: number = 8;

/**
 * The message box's own rect, from CanvasTextBox. Not imported: this file is
 * loaded by the OPTION page's own module graph and CanvasTextBox pulls in the
 * whole text machinery to say four numbers.
 */
const BOX_TX: number = 0;
const BOX_TY: number = 12;
const BOX_TW: number = 20;
const BOX_TH: number = 6;

/** Rows inside the box, in screen tiles. The cartridge's own two-line spacing. */
const ROW_QUESTION: number = BOX_TY + 2;
const ROW_VALUE: number = BOX_TY + 4;
const COL_TEXT: number = 1;
/**
 * Where the value sits, between its arrows.
 *
 * Centred on the box rather than following the question, because the three
 * labels are four, five and four letters and a value that jumps left and right
 * as you cycle reads as the box twitching.
 */
const COL_VALUE: number = 8;

/** charmap.asm: the filled cursor arrow, and its hollow twin. */
const CODE_ARROW: number = 0xED;

export const STYLE_OPEN: string = "";
export const STYLE_DONE: string = "done";

/**
 * The cursor over the three stagings.
 *
 * Left and right WRAP, unlike the two-row toggles of the boot menu: this is a
 * three-value ladder and Gen 1's own three-and-more menus wrap. A does not
 * merely close it -- there is no cancel, because the fight is waiting and
 * every one of the three is a valid answer, including the one it opened on.
 */
export class BattleStyleController {
  private cursor: number;

  constructor(start: number) {
    const count = BATTLE_LABELS.length;
    this.cursor = start >= 0 && start < count ? Math.floor(start) : 0;
  }

  chosen(): number {
    return this.cursor;
  }

  /**
   * `dpad` is one of "", "up", "down", "left", "right", already edge
   * triggered. Returns STYLE_OPEN while the question stands and STYLE_DONE
   * once it is answered.
   *
   * Up and down move too. The pad is a d-pad, the wearer has been walking a
   * map with it for an hour, and a question that answers only to two of its
   * four directions reads as half broken.
   */
  step(dpad: string, pressedA: boolean, pressedStart: boolean): string {
    const count = BATTLE_LABELS.length;
    if (dpad === "left" || dpad === "up") {
      this.cursor = (this.cursor + count - 1) % count;
    } else if (dpad === "right" || dpad === "down") {
      this.cursor = (this.cursor + 1) % count;
    }
    return pressedA || pressedStart ? STYLE_DONE : STYLE_OPEN;
  }
}

/**
 * The question, in the cartridge's own box.
 *
 * Two lines, because eighteen columns will not hold "HOW SHOULD A BATTLE BE
 * SHOWN?" on one and the cartridge itself breaks its questions at the same
 * width.
 */
export function paintBattleStyle(canvas: GbCanvas, font: GbFont, cursor: number): void {
  font.box(canvas, BOX_TX, BOX_TY, BOX_TW, BOX_TH);
  font.text(canvas, "HOW SHOULD A FIGHT", COL_TEXT * TILE, ROW_QUESTION * TILE);
  const count = BATTLE_LABELS.length;
  const at = cursor >= 0 && cursor < count ? Math.floor(cursor) : 0;
  const label = BATTLE_LABELS[at];
  font.text(canvas, "LOOK?", COL_TEXT * TILE, ROW_VALUE * TILE);
  font.code(canvas, CODE_ARROW, COL_VALUE * TILE, ROW_VALUE * TILE);
  font.text(canvas, label, (COL_VALUE + 1) * TILE, ROW_VALUE * TILE);
  font.code(canvas, CODE_ARROW, (COL_VALUE + 1 + label.length) * TILE, ROW_VALUE * TILE);
}
