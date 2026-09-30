// A Poke Ball lying on the ground, and what happens when you talk to it.
//
// One hundred and four map objects carry an `item` -- a NUGGET in Cerulean
// Cave, the LIFT KEY and the SILPH SCOPE in the Rocket Hideout -- and every one
// of them is SPRITE_POKE_BALL whose TEXT_* pointer is the cartridge's
// PickUpItemText routine, so it has no words of its own. Until this file,
// facing one and pressing A did nothing.
//
// The pickup is a command list built at runtime from ids, run on the same VM
// every talk script runs on, in the cartridge's order (engine/overworld/
// pick_up_item.asm): AddItemToInventory, then HideObject, then the found line.
// Every op it needs exists and is exercised by the gift() expansions:
//
//   * A refused give_item shows the no-room line and stops the script, so
//     nothing after it runs for an item that never landed.
//   * hide_object is the one channel every scripted hide uses, so the ball is
//     gone from talk, from the room, from collision and from the save together
//     -- the toggle IS the record; there is no flag.
//   * A full bag says the cartridge's no-room line and leaves the ball there.
//
// The jingle is Get_Item1 for every ball, key items included: PickUpItem does
// not branch on key items (the reference plays Get_Key_Item there; the
// cartridge wins). It plays before the line here where the cartridge plays it
// after the line has typed; there is no sound-inside-text op and this is not
// the place to invent one.

import type { ScriptCommand } from "./ScriptVM";

export const ITEM_BALL_SOUND: string = "Get_Item1";
export const FOUND_ITEM_TEXT: string = "_FoundItemText";
export const NO_ROOM_FOR_ITEM_TEXT: string = "_NoMoreRoomForItemText";

/** The pickup script for the ball named `npc` on `mapId`, holding `item`. */
export function itemBallScript(mapId: string, npc: string, item: string): ScriptCommand[] {
  // A refused give shows the no-room line and stops the script -- the VM's
  // rule -- so the hide after it cannot run for an item that never landed.
  return [
    { op: "give_item", item: item, count: 1, noRoom: NO_ROOM_FOR_ITEM_TEXT },
    { op: "hide_object", map: mapId, npc: npc },
    { op: "text_sound", name: ITEM_BALL_SOUND },
    { op: "show_text", textId: FOUND_ITEM_TEXT, ramItem: item },
  ];
}
