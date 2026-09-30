// Resolving and paging the cartridge's own dialogue.
//
// Three tables have to be walked to get from an NPC to their words, and none of
// the three is optional:
//
//   object.text            "TEXT_PALLETTOWN_GIRL"
//   textPointers[label]    -> { label, text: "_PalletTownGirlText" }   (label = map.label)
//   text[...]              -> "I'm raising\nPOKeMON too!\f..."
//
// An entry marked `asm` has no plain body: its words live inside a script, which
// is machine code in the cartridge and cannot be extracted. Those resolve to null
// and are the script VM's job, not this file's.
//
// The bodies carry the Game Boy's own control characters, and they mean what they
// meant on hardware:
//   \n  a new line inside the box
//   \v  scroll the box up by one line and continue
//   \f  clear the box and start a new page, which is a keypress for the player

import { textLabelFor } from "./TextAliases";
import type { WorldBundle, MapDef, MapObject } from "../../world/WorldData";
import { isObjectHidden as objectHidden, itemIdOf } from "../../world/WorldData";

/** Lines shown at once. The original shows two and scrolls. */
const LINES_PER_PAGE: number = 2;

export interface DialoguePage {
  lines: string[];
}

export interface Dialogue {
  pages: DialoguePage[];
  /** True when the words live in a script rather than in the text table. */
  fromScript: boolean;
}

/**
 * Shared labels whose "script" is a plain text block and nothing else.
 *
 * An `asm` pointer normally means the words are inside machine code. Four
 * labels are marked that way only because they live OUTSIDE the map's own text
 * block -- home/overworld_text.asm holds three of them and Route5Gate.asm the
 * fourth -- while each is literally `text_far X / text_end`, the same shape as
 * any ordinary line. Read against pokered: 47 pointers across Kanto, and every
 * one of them said nothing at all.
 *
 *   PokeCenterSignText  11 signs   "Heal Your POKeMON! POKeMON CENTER"
 *   MartSignText         8 signs
 *   BoulderText         25 rocks   what a boulder says before STRENGTH
 *   SaffronGateGuard...  3 guards  the thirsty guard's opening line
 *
 * PickUpItemText is shared too and is NOT here: it is `text_asm predef
 * PickUpItem`, a routine, and it is ItemBall.ts's job. PokemonMansion2FSwitch
 * likewise runs a YesNoChoice. A list, not a blanket fallback on "the label
 * happens to exist in the text table", because those two would then print
 * their first page and silently drop the branch that follows it.
 */
const SHARED_PLAIN_TEXT: string[] = [
  "PokeCenterSignText", "MartSignText", "BoulderText",
  "SaffronGateGuardGeeImThirstyText",
];

function sharedPlainText(bundle: WorldBundle, label: string): string {
  if (!label) {
    return null;
  }
  for (let i = 0; i < SHARED_PLAIN_TEXT.length; i++) {
    if (SHARED_PLAIN_TEXT[i] === label) {
      const body = bundle.text["_" + label];
      return body ? body : null;
    }
  }
  return null;
}

/** The raw body for a TEXT_* id on a map, or null when it lives in a script. */
export function resolveText(bundle: WorldBundle, map: MapDef, textId: string): string {
  if (!textId || !bundle.textPointers) {
    return null;
  }
  const forMap = bundle.textPointers[map.label];
  if (!forMap) {
    return null;
  }
  const entry = forMap[textId];
  if (!entry) {
    return null;
  }
  if (!entry.text) {
    // asm: true -- the words are inside a script, unless the "script" is one of
    // the four shared labels that are a plain text block (SHARED_PLAIN_TEXT).
    return sharedPlainText(bundle, entry.label);
  }
  const body = bundle.text[entry.text];
  return body ? body : null;
}

/**
 * The body a SCRIPT is asking for, or null.
 *
 * A script does not carry a TEXT_* id. It carries the cartridge's own label for
 * the words -- "_PalletTownOakHeyWaitDontGoOutText" -- because that is what the
 * assembly it was ported from carries, and it is the only name under which the
 * line can be found once an object's single TEXT_* entry has fanned out into the
 * dozen lines a conversation actually uses.
 *
 * resolveText cannot answer that. It walks bundle.textPointers[map.label][id],
 * and that table is keyed EXCLUSIVELY by TEXT_* ids: across all 217 map labels in
 * a full Kanto bundle, not one key begins with an underscore. Routing a script's
 * label through it returns null for every line of every ported map -- silently,
 * because a null body is also how "this text lives in a script" is reported.
 *
 * The labels are what bundle.text is keyed by in the first place, so the pointer
 * indirection is simply not needed here.
 */
export function scriptText(bundle: WorldBundle, map: MapDef, textId: string): string {
  if (!textId) {
    return null;
  }
  // A key in the text table IS the words, whatever it starts with. Eleven of the
  // cartridge's labels have no leading underscore, and routing those through the
  // TEXT_* pointer table -- where they do not appear -- returned null for every
  // one of them.
  const direct = bundle.text ? bundle.text[textId] : null;
  if (direct) {
    return direct;
  }
  // A label another version spells differently: Yellow's name for a Red line.
  const alias = textLabelFor(bundle, textId);
  if (alias !== textId && bundle.text[alias]) {
    return bundle.text[alias];
  }
  return resolveText(bundle, map, textId);
}

/**
 * Splits a body into pages of at most two lines.
 *
 * \f starts a page and \v scrolls, but a scroll that would overflow the box has
 * to break too, or the third line is drawn over the first.
 */
/**
 * Fill {RAM:name...} slots BY NAME; see battle/Moves.fillSlots.
 *
 * Re-exported here because every caller in the script layer reaches for its
 * text helpers through this file, and the implementation has to sit beside
 * `fill` and `romText` so the battle engine can use it without importing the
 * overworld.
 */
export { fillSlots } from "../battle/Moves";

export function paginate(body: string): DialoguePage[] {
  const pages: DialoguePage[] = [];
  let lines: string[] = [];

  function flush(): void {
    if (lines.length > 0) {
      pages.push({ lines: lines });
      lines = [];
    }
  }

  const chunks = body.split("\f");
  for (let c = 0; c < chunks.length; c++) {
    // A body that OPENS with a form feed (the Safari PA line, eleven others)
    // has nothing before its first page; a blank box that wants a keypress is
    // not a page.
    if (c === 0 && chunks[c] === "" && chunks.length > 1) {
      continue;
    }
    // \v is the cartridge's `cont`: the box scrolls up one line and prints
    // the next on the bottom row, so the reader sees the previous line
    // again above the new one ("give a nickname / to CHARMANDER?"). A page
    // that is not yet full has nothing to scroll and \v is a line break.
    const scrolls = chunks[c].split("\v");
    for (let sIdx = 0; sIdx < scrolls.length; sIdx++) {
      if (sIdx > 0 && lines.length === LINES_PER_PAGE) {
        const carried = lines[lines.length - 1];
        flush();
        lines = [carried];
      }
      const parts = scrolls[sIdx].split("\n");
      for (let i = 0; i < parts.length; i++) {
        lines.push(parts[i]);
        if (lines.length === LINES_PER_PAGE && (i < parts.length - 1 || sIdx === scrolls.length - 1)) {
          flush();
        }
      }
    }
    flush();
  }
  return pages;
}

/** Everything needed to show what an object or sign says. */
export function dialogueFor(bundle: WorldBundle, map: MapDef, textId: string): Dialogue {
  const body = resolveText(bundle, map, textId);
  if (body === null) {
    return { pages: [], fromScript: true };
  }
  return { pages: paginate(body), fromScript: false };
}

/**
 * The thing the player is facing that can be talked to, or null.
 *
 * Objects stand ON their cell and are talked to from the neighbouring one; signs
 * are read by facing into them. Both are checked against the cell in front,
 * because that is what the original does and it is why you cannot talk to someone
 * by standing on top of them.
 */
/** The shared visibility rule; see WorldData.isObjectHidden. */
export function isObjectHidden(mapId: string, object: MapObject, revealed: any): boolean {
  return objectHidden(mapId, object, revealed);
}

export function facingTarget(map: MapDef, cellX: number, cellY: number, facing: string,
                             revealed: any, counterAhead: boolean,
                             cellOf: (object: any) => number[] = null): any {
  let dx = 0;
  let dy = 0;
  if (facing === "up") dy = -1;
  else if (facing === "down") dy = 1;
  else if (facing === "left") dx = -1;
  else dx = 1;

  // Across a counter: the cartridge talks to whoever stands on the far side of
  // a counter tile (home/overworld.asm, the counter check in IsSpriteInFront).
  // Every nurse and every clerk stands behind one; without this hop none of
  // them could be reached from a cell a player can stand on.
  const reach = counterAhead ? 2 : 1;
  const tx = cellX + dx * reach;
  const ty = cellY + dy * reach;

  for (let i = 0; i < map.objects.length; i++) {
    const object = map.objects[i];
    // Where it STANDS, which for a WALK sprite is wherever its wandering has
    // taken it; the caller who moves the bodies says so through cellOf. The
    // shipped cell is the answer for everyone else, and for every caller that
    // has no bodies to move (the tests, the extraction's checks).
    const cell = cellOf ? cellOf(object) : [object.x, object.y];
    if (cell[0] !== tx || cell[1] !== ty) {
      continue;
    }
    if (isObjectHidden(map.id, object, revealed)) {
      continue;
    }
    // x/y and the trainer fields ride along because the caller has no other way
    // back to the object: it is matched by position here and the name alone does
    // not say which roster to fight. x/y are the cell it stands on now.
    return {
      kind: "object",
      textId: object.text,
      name: object.name,
      x: cell[0],
      y: cell[1],
      trainerClass: object.trainerClass ? object.trainerClass : "",
      trainerParty: typeof object.trainerParty === "number" ? object.trainerParty : 0,
      item: itemIdOf(object),
      index: typeof object.index === "number" ? object.index : 0,
    };
  }
  // A SIGN is read off the tile in front of you, counter or not: the three
  // prize vendors in the GAME CORNER are bg_events on the counter tiles
  // themselves (data/maps/objects/GameCornerPrizeRoom.asm:13-15), and hopping
  // over them reads the wall behind. The hop is for PEOPLE standing on the far
  // side.
  const signX = cellX + dx;
  const signY = cellY + dy;
  const signs = map.signs;
  for (let i = 0; signs && i < signs.length; i++) {
    if (signs[i].x === signX && signs[i].y === signY) {
      return { kind: "sign", textId: signs[i].text, name: "sign",
               x: signs[i].x, y: signs[i].y, trainerClass: "", trainerParty: 0 };
    }
  }
  return null;
}
