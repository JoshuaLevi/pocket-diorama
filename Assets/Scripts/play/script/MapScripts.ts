// The ported map scripts.
//
// The cartridge's event logic is machine code, so this is the one part of the
// project that is written rather than read. Each script here is a TRANSCRIPTION of
// the corresponding hand-port in gen1recomp's data/scripts (MIT), which is itself
// a hand-port of pret/pokered's assembly. Keeping the assembly's shape -- test,
// then branch on the last test -- means each one can be diffed against its source
// line by line rather than argued about.
//
// Jump targets are ZERO-BASED indices into the command array. The reference
// numbers its commands from one in comments, so a target there is one more than
// the index here; each port keeps the original's numbering in a trailing comment
// so the two can be laid side by side.
//
// A map with no entry here still works: its NPCs and signs resolve their text
// straight out of the ROM. Only behaviour needs a script.
//
// Not everything fits a command list, and pretending otherwise would mean growing
// the vocabulary until it was a programming language. The reference writes its gym
// leaders and its intro cutscene as functions for good reason: a TM handoff that
// must survive a full bag and retry, or a cutscene driving two actors and the
// camera together, is control flow rather than a sequence. Those become `call`
// commands pointing at a named routine in the host, so the common case stays
// diffable data and the hard case is openly code.

import { ROUTINE_BADGE_HOUSE, ROUTINE_BILLS_LIST, ROUTINE_DAY_CARE, ROUTINE_NAME_RATER } from "./Keepers";
import type { ScriptCommand } from "./ScriptVM";
import { transcribedMaps, transcribedScript } from "./PortedMaps";
import type { CartridgeVersion } from "../../world/Cartridge";
import { victoryFor } from "../battle/Victories";
import { EVENT_IN_SAFARI, EVENT_SAFARI_OVER, safariJoinScript, safariLeaveScript,
         safariOverScript } from "./Safari";

export interface MapScriptSet {
  /** Keyed by the TEXT_* id the object or sign points at. */
  talk: any;
  /** Runs when the player lands on a cell. First match wins. */
  onStep: StepTrigger[];
  /**
   * Runs when the player presses A facing a cell with nothing on it: the
   * cartridge's hidden events -- Bill's PC, the dojo posters, the quiz
   * machines. Same shape as a step trigger; the cell is the one in front.
   */
  onFace: StepTrigger[];
  /**
   * Runs once when the map is entered: the cartridge's DEFAULT map script.
   *
   * The original runs its default script every frame the player is on the map,
   * and two of them do work that is not a coordinate event -- Route 25 puts
   * Bill's house back the way the quest needs it, Pewter City voids the museum
   * ticket. Both are written so that once per arrival is observably the same
   * thing: Route 25's own copy is guarded by BIT_CUR_MAP_LOADED_2, which IS
   * "the first frame after entering", and the only way to set the museum
   * ticket is inside the museum, whose only door comes out here.
   *
   * Optional, because most maps have nothing to do on arrival; read through
   * enterScriptFor(), which answers [] for a map with no entry.
   */
  onEnter?: ScriptCommand[];
}

/**
 * A script that runs when the player LANDS on a cell: the cartridge's
 * coordinate triggers (ArePlayerCoordsInArray), polled every frame there and
 * read once per landing here, which is observably the same.
 *
 * Disarming is by flags only -- `unless` names the flag the script sets --
 * so nothing new lands in the save. `turnPlayer` is the cartridge's PLAYER_DIR
 * write before the scene. Exactly one of `script` and `talk` is set: an
 * inline list, or the key of an object on this map whose own script (hand,
 * transcribed, or built from its trainer header) is what runs.
 */
export interface StepTrigger {
  /** The cell; -1 for any column or any row. */
  x: number;
  y: number;
  /**
   * With x: -1, the last column the row covers; -1 for the whole row.
   *
   * Route 23's first guard watches a row that the road crosses twice: north of
   * him it is the way to Victory Road, and past x 14 the player has already
   * come out of it, which is why his check stops there (Route23.asm:42-47).
   */
  maxX: number;
  /** Every one of these must be set. */
  ifAll: string[];
  /** Any one of these set disarms it. */
  unless: string[];
  /** Held back while this item is in the bag; "" for never. */
  unlessItem: string;
  /** "" leaves the player facing as they landed. */
  turnPlayer: string;
  script: ScriptCommand[];
  talk: string;
}

/** A trigger from a short spec: absent fields are "" and []. */
/** One flag name, a list of them, or nothing, as a list. */
function flagList(value: any): string[] {
  if (!value) {
    return [];
  }
  return typeof value === "string" ? [value] : value;
}

export function stepTrigger(spec: any): StepTrigger {
  return {
    x: typeof spec.x === "number" ? spec.x : -1,
    y: typeof spec.y === "number" ? spec.y : -1,
    maxX: typeof spec.maxX === "number" ? spec.maxX : -1,
    // Both take a LIST. A bare flag name is a string, whose `length` is its
    // letter count and whose `[k]` is a letter, so a trigger written that way
    // armed itself every time and said nothing about it.
    ifAll: flagList(spec.ifAll),
    unless: flagList(spec.unless),
    unlessItem: typeof spec.unlessItem === "string" ? spec.unlessItem : "",
    turnPlayer: spec.turnPlayer ? spec.turnPlayer : "",
    script: spec.script ? spec.script : [],
    talk: spec.talk ? spec.talk : "",
  };
}

/**
 * PalletTown.asm.
 *
 * Only Oak needs a script. The girl, the fisherman and the four signs resolve
 * through the extracted text pointers with no script at all. The original branches
 * on wOakWalkedToPlayer; the starter flag tracks the same thing.
 *
 * The post-champion Oak battle in the reference is deliberately left out until the
 * battle engine exists -- a start_battle that cannot start a battle is worse than
 * an honest omission.
 */
/**
 * PalletTownScript0-3 and OaksLabScript6-7: Oak stops you at the top of
 * town and walks you to his lab. Choreography measured on the cartridge
 * frame by frame (tools/oracle, 6 sep): Oak appears at his shipped cell
 * (8,5) and zigzags up to the cell below you; after "It's unsafe!" he leads
 * and you follow one cell behind, down the east side of town and into the
 * lab, up its aisle to (5,3) beside BLUE, while he takes his place at the
 * desk. From the other exit column (11,1) he first steps left to (10,2)
 * and you step left behind him; the walk is the same from there.
 */
function oakEscort(fromEast: boolean): ScriptCommand[] {
  const entry: string[] = fromEast
    ? ["right", "up", "right", "up", "right", "up"]
    : ["up", "right", "up", "right", "up"];
  const sideStep: ScriptCommand[] = fromEast
    ? [{ op: "move", npc: "PALLETTOWN_OAK", path: ["left"] },
       { op: "move_player", direction: "left", steps: 1 }]
    : [];
  return ([
    { op: "face_player_dir", direction: "down" },
    { op: "play_music", track: "Music_MeetProfOak" },
    { op: "show_text", textId: "_PalletTownOakHeyWaitDontGoOutText" },
    { op: "set_flag", flag: "EVENT_OAK_APPEARED_IN_PALLET" },
    { op: "show_object", map: "PALLET_TOWN", npc: "PALLETTOWN_OAK" },
    { op: "move", npc: "PALLETTOWN_OAK", path: entry },
    { op: "face", npc: "PALLETTOWN_OAK", direction: "up" },
    { op: "show_text", textId: "_PalletTownOakItsUnsafeText" },
  ] as ScriptCommand[]).concat(sideStep).concat([
    // Oak from (10,2), you from (10,1): the same path, he is a cell ahead.
    { op: "move", npc: "PALLETTOWN_OAK", async: true,
      path: ["down", "down", "down", "down", "down", "left",
             "down", "down", "down", "down", "down", "right", "right", "right", "up"] },
    // Two frames so his body has left the cell you step into.
    { op: "wait", frames: 2 },
    { op: "move_player", direction: "down", steps: 6 },
    { op: "move_player", direction: "left", steps: 1 },
    { op: "move_player", direction: "down", steps: 5 },
    { op: "move_player", direction: "right", steps: 3 },
    { op: "wait_npc", npc: "PALLETTOWN_OAK" },
    { op: "hide_object", map: "PALLET_TOWN", npc: "PALLETTOWN_OAK" },
    // Into the door: the step warps to OAKS_LAB (5,11) and the script goes on.
    { op: "move_player", direction: "up", steps: 1 },
    { op: "show_object", map: "OAKS_LAB", npc: "OAKSLAB_OAK2" },
    { op: "move", npc: "OAKSLAB_OAK2", async: true,
      path: ["up", "up", "up", "up", "up", "up", "up"] },
    { op: "wait", frames: 2 },
    { op: "move_player", direction: "up", steps: 7 },
    { op: "wait_npc", npc: "OAKSLAB_OAK2" },
    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_OAK2" },
    { op: "show_object", map: "OAKS_LAB", npc: "OAKSLAB_OAK1" },
    { op: "move_player", direction: "up", steps: 1 },
    { op: "show_text", textId: "_OaksLabRivalFedUpWithWaitingText" },
    { op: "show_text", textId: "_OaksLabOakChooseMonText" },
    { op: "show_text", textId: "_OaksLabRivalWhatAboutMeText" },
    { op: "show_text", textId: "_OaksLabOakBePatientText" },
    { op: "set_flag", flag: "EVENT_FOLLOWED_OAK_INTO_LAB" },
    { op: "play_default_music" },
  ] as ScriptCommand[]);
}

const PALLET_TOWN: MapScriptSet = {
  talk: {
    TEXT_PALLETTOWN_OAK: [
      { op: "face_player" },                                        // 1
      { op: "check_flag", flag: "EVENT_GOT_STARTER" },              // 2
      { op: "jump_if_true", to: 5 },                                // 3
      { op: "show_text", textId: "_PalletTownOakHeyWaitDontGoOutText" }, // 4
      { op: "jump", to: "end" },                                    // 5
      { op: "show_text", textId: "_PalletTownOakItsUnsafeText" },   // 6
    ] as ScriptCommand[],
  },
  // PalletTownScript0 fires on wYCoord == 1, any column; only (10,1) and
  // (11,1) can be reached. The east column has its own entry path.
  onStep: [
    stepTrigger({ x: 11, y: 1, unless: ["EVENT_FOLLOWED_OAK_INTO_LAB"], script: oakEscort(true) }),
    stepTrigger({ y: 1, unless: ["EVENT_FOLLOWED_OAK_INTO_LAB"], script: oakEscort(false) }),
  ],
  onFace: [],
};

/**
 * RedsHouse1F.asm.
 *
 * Mom shows the wake-up line before you have a starter. Afterwards she fades to
 * white, heals the party, plays the healing jingle, fades back and says you look
 * great -- which is the game's first healing point and worth having early.
 */
const REDS_HOUSE_1F: MapScriptSet = {
  talk: {
    TEXT_REDSHOUSE1F_MOM: [
      { op: "face_player" },                                        // 1
      { op: "check_flag", flag: "EVENT_GOT_STARTER" },              // 2
      { op: "jump_if_true", to: 5 },                                // 3
      { op: "show_text", textId: "_RedsHouse1FMomWakeUpText" },     // 4
      { op: "jump", to: "end" },                                    // 5
      { op: "show_text", textId: "_RedsHouse1FMomYouShouldRestText" }, // 6
      { op: "fade", direction: "out", colour: "white" },            // 7
      { op: "heal_party" },                                         // 8
      { op: "play_once", track: "Music_PkmnHealed" },               // 9
      { op: "fade", direction: "in", colour: "white" },             // 10
      { op: "show_text", textId: "_RedsHouse1FMomLookingGreatText" }, // 11
    ] as ScriptCommand[],
    // The television (:35-50): a joke that only works from the right cell.
    // Watched from below it is the Stand By Me film; from either side, "Oops,
    // wrong side."
    TEXT_REDSHOUSE1F_TV: [
      { op: "check_facing", direction: "up" },
      { op: "jump_if_false", to: "wrong_side" },
      { op: "show_text", textId: "_RedsHouse1FTVStandByMeMovieText" },
      { op: "jump", to: "end" },
      { op: "label", name: "wrong_side" },
      { op: "show_text", textId: "_RedsHouse1FTVWrongSideText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};


/**
 * OaksLab.asm -- the starter, the rival, the Pokedex and the parcel.
 *
 * This is the one map that gates everything else: no starter, no battles, no
 * badge. It is also the first port in this file written WITHOUT a reference lua
 * beside it, so it is a port of behaviour rather than a line-by-line
 * transcription, and the trailing numbers are this file's own indices rather
 * than a reference's line numbers. What IS checked mechanically: every text id
 * below exists in the extracted bundle, and every key is a text id a real object
 * on this map points at -- script.test.mjs fails the build otherwise.
 *
 * The three ball scripts are the same shape with a different species, which is
 * how the original writes them too: one routine, entered with the species in a
 * register.
 *
 * Three things here are control flow rather than a sequence and live in the host
 * as named routines:
 *   give_starter    -- hands over the Pokemon, then runs the rival's answer:
 *                      he takes the type yours is weak to, and challenges.
 *   rival_first_battle -- the cutscene walk plus OPP_RIVAL1, whose party depends
 *                      on which ball the player opened.
 *   rival_beside    -- the rival's walk in from the door for Oak's request; the
 *                      request scene itself is script (see oakAtTheDesk).
 */
function starterBall(species: string, wantText: string, choseFlag: string,
                     ownBall: string, rivalBallX: number,
                     rivalBall: string, rivalSpecies: string): ScriptCommand[] {
  return [
    { op: "check_flag", flag: "EVENT_GOT_STARTER" },
    { op: "jump_if_true", to: "last_mon" },
    // No picking until Oak has walked you in. The flag is his, not the ball's:
    // OaksLabScript gates the whole room on it.
    { op: "check_flag", flag: "EVENT_FOLLOWED_OAK_INTO_LAB" },
    { op: "jump_if_false", to: "not_yet" },
    // Measured: the Pokedex data page (name, category, HT/WT, the dex number,
    // the front picture, the two-page description) opens before the question,
    // whichever way it will be answered -- three A presses in all, one for
    // the ball and two more to close the page. mark_seen before push_screen
    // is this codebase's own idiom everywhere a dex entry is shown (the
    // dojo's prize, the SS Anne's Snorlax sighting).
    { op: "mark_seen", species: species },
    { op: "push_screen", screen: "DexEntryMenu", species: species },
    { op: "ask", textId: wantText, flag: "SCRATCH_TOOK_STARTER" },
    { op: "check_flag", flag: "SCRATCH_TOOK_STARTER" },
    { op: "jump_if_false", to: "end" },
    { op: "show_text", textId: "_OaksLabMonEnergeticText" },
    { op: "text_sound", name: "Get_Key_Item" },
    { op: "show_text", textId: "_OaksLabReceivedMonText", ram: species },
    { op: "give_pokemon", species: species, level: 5 },
    // Measured: the cartridge offers a nickname before BLUE moves; the
    // naming screen opens on YES.
    { op: "ask", textId: "_DoYouWantToNicknameText", ram: species, flag: "SCRATCH_NICKNAME" },
    { op: "check_flag", flag: "SCRATCH_NICKNAME" },
    { op: "clear_flag", flag: "SCRATCH_NICKNAME" },
    { op: "jump_if_false", to: "no_nickname" },
    { op: "call", routine: "name_entry", argument: "party:last" },
    { op: "label", name: "no_nickname" },
    { op: "set_flag", flag: "EVENT_GOT_STARTER" },
    { op: "set_flag", flag: choseFlag },
    { op: "hide_object", map: "OAKS_LAB", npc: ownBall },
    // The rival walks to the ball that counters yours and takes it. This is one
    // script, not two: he does not wait to be talked to.
    { op: "move_npc_to", npc: "OAKSLAB_RIVAL", x: rivalBallX, y: 4 },
    { op: "face_object", npc: "OAKSLAB_RIVAL", direction: "up" },
    { op: "show_text", textId: "_OaksLabRivalIllTakeThisOneText" },
    { op: "hide_object", map: "OAKS_LAB", npc: rivalBall },
    { op: "text_sound", name: "Get_Key_Item" },
    { op: "show_text", textId: "_OaksLabRivalReceivedMonText", ram: rivalSpecies },
    { op: "jump", to: "end" },

    // The two balls left after a starter is taken: Oak reads the last-mon line.
    { op: "label", name: "last_mon" },
    { op: "face_object", npc: "OAKSLAB_OAK1", direction: "down" },
    { op: "show_text", textId: "_OaksLabLastMonText" },
    { op: "jump", to: "end" },

    { op: "label", name: "not_yet" },
    { op: "show_text", textId: "_OaksLabThoseArePokeBallsText" },
  ] as ScriptCommand[];
}

/**
 * The Pokedex rating Oak reads once the parcel is delivered: DisplayDexRating
 * in the cartridge, one line per ten species owned. A ladder of thresholds
 * rather than arithmetic in the VM, because the VM has check_dex_owned and
 * nothing else, and because the sixteen lines are data the cartridge ships.
 */
function dexRating(): ScriptCommand[] {
  const floors = [150, 140, 130, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
  const out: ScriptCommand[] = [];
  for (const floor of floors) {
    out.push({ op: "check_dex_owned", count: floor });
    out.push({ op: "jump_if_true", to: "rating_" + floor });
  }
  out.push({ op: "show_text", textId: "_DexRatingText_Own0To9" });
  out.push({ op: "jump", to: "end" });
  for (const floor of floors) {
    out.push({ op: "label", name: "rating_" + floor });
    out.push({ op: "show_text",
               textId: "_DexRatingText_Own" + floor + "To" + (floor === 150 ? 151 : floor + 9) });
    out.push({ op: "jump", to: "end" });
  }
  return out;
}

/**
 * Oak at his desk: OaksLabOakText in the cartridge, and the two scenes it can
 * start.
 *
 * Before the Pokedex, the parcel decides everything. Talking to Oak with OAK'S
 * PARCEL in the bag runs the request scene end to end -- OaksLabRivalArrives-
 * AtOaksRequestScript, OaksLabOakGivesPokedexScript and OaksLabRivalLeaves-
 * WithPokedexScript, read from pokered's scripts/OaksLab.asm on 11 September:
 * Oak thanks you, the rival is placed at the door and walks in on his own
 * music, Oak asks his favour, both Pokedexes leave the desk, the rival walks
 * out again, and the four events the rest of Kanto reads are set. The first
 * port of this ran a silent host routine that took the parcel and set the flag
 * and showed not one line, so a wearer who delivered the parcel on 11
 * September heard nothing and, pressing A again, got the Pokedex-progress line
 * instead.
 *
 * After the Pokedex, the first visit hands over five Poke Balls
 * (EVENT_GOT_POKEBALLS_FROM_OAK) and every visit after that reads the rating.
 */
function oakAtTheDesk(): ScriptCommand[] {
  return ([
    { op: "face_player" },
    { op: "check_flag", flag: "EVENT_GOT_POKEDEX" },
    { op: "jump_if_true", to: "got_dex" },
    { op: "check_item", item: "OAKS_PARCEL", count: 1 },
    { op: "jump_if_true", to: "parcel" },
    { op: "check_flag", flag: "EVENT_GOT_STARTER" },
    { op: "jump_if_true", to: "raise" },
    // Measured: once he has walked you in, Oak at the desk asks which one
    // you want; the long speech is the escort's, said once.
    { op: "check_flag", flag: "EVENT_FOLLOWED_OAK_INTO_LAB" },
    { op: "jump_if_true", to: "which" },
    { op: "show_text", textId: "_OaksLabOakChooseMonText" },
    { op: "jump", to: "end" },
    { op: "label", name: "which" },
    { op: "show_text", textId: "_OaksLabOak1WhichPokemonDoYouWantText" },
    { op: "jump", to: "end" },
    { op: "label", name: "raise" },
    { op: "show_text", textId: "_OaksLabOak1RaiseYourYoungPokemonText" },
    { op: "jump", to: "end" },

    // -- with the Pokedex: five Poke Balls once, the rating ever after --------
    { op: "label", name: "got_dex" },
    { op: "check_flag", flag: "EVENT_GOT_POKEBALLS_FROM_OAK" },
    { op: "jump_if_true", to: "rating" },
    { op: "text_sound", name: "Get_Key_Item" },
    { op: "show_text", textId: "_OaksLabOak1ReceivedPokeballsText" },
    { op: "give_item", item: "POKE_BALL", count: 5 },
    { op: "set_flag", flag: "EVENT_GOT_POKEBALLS_FROM_OAK" },
    { op: "show_text", textId: "_OaksLabGivePokeballsExplanationText" },
    { op: "jump", to: "end" },
    { op: "label", name: "rating" },
    { op: "show_text", textId: "_OaksLabOak1HowIsYourPokedexComingText" },
  ] as ScriptCommand[]).concat(dexRating()).concat([

    // -- the parcel: Oak's request ------------------------------------------
    { op: "label", name: "parcel" },
    { op: "show_text", textId: "_OaksLabOak1DeliverParcelText" },
    { op: "show_text", textId: "_OaksLabOak1ParcelThanksText" },
    { op: "take_item", item: "OAKS_PARCEL", count: 1 },
    { op: "set_flag", flag: "EVENT_OAK_GOT_PARCEL" },
    // The rival comes in through the door, on his own music. Placed BEFORE he
    // is shown, so the frame that draws him draws him at the door and not on
    // the cell he ships at, beside the desk.
    { op: "place_npc", npc: "OAKSLAB_RIVAL", x: 4, y: 11, facing: "up" },
    { op: "show_object", map: "OAKS_LAB", npc: "OAKSLAB_RIVAL" },
    { op: "play_music", track: "Music_MeetRival" },
    { op: "show_text", textId: "_OaksLabRivalGrampsText" },
    { op: "call", routine: "rival_beside", argument: "OAKSLAB_RIVAL" },
    { op: "face_object", npc: "OAKSLAB_RIVAL", direction: "up" },
    { op: "face_object", npc: "OAKSLAB_OAK1", direction: "down" },
    { op: "show_text", textId: "_OaksLabRivalWhatDidYouCallMeForText" },
    { op: "show_text", textId: "_OaksLabOakIHaveARequestText" },
    { op: "show_text", textId: "_OaksLabOakMyInventionPokedexText" },
    { op: "text_sound", name: "Get_Key_Item" },
    { op: "show_text", textId: "_OaksLabOakGotPokedexText" },
    // Not a bag item. OaksLabOakGivesPokedexScript sets EVENT_GOT_POKEDEX and
    // hides the two on the table; the cartridge's bag stays as it was, and the
    // POKeDEX is the start menu's new entry, read off the flag. Measured on
    // the after-brock road (FINDINGS.md, 12 September): the lens's bag held
    // [POKEDEX x1] where wBagItems was empty.
    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_POKEDEX1" },
    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_POKEDEX2" },
    { op: "show_text", textId: "_OaksLabOakThatWasMyDreamText" },
    { op: "call", routine: "rival_face_player", argument: "OAKSLAB_RIVAL" },
    { op: "show_text", textId: "_OaksLabRivalLeaveItAllToMeText" },
    { op: "set_flag", flag: "EVENT_GOT_POKEDEX" },
    // HideObject TOGGLE_LYING_OLD_MAN / ShowObject TOGGLE_OLD_MAN follow that
    // flag with no branch between them, so the one flag settles both toggles:
    // the sleeper lying across Viridian's north path is gone, and the walking
    // old man who asks for coffee stands on (17,5) -- a different object,
    // shipped hidden, not the same man waking up. VIRIDIAN_CITY's gate reads
    // the same flag, which is why it stops firing on this very step.
    { op: "hide_object", map: "VIRIDIAN_CITY", npc: "VIRIDIANCITY_OLD_MAN_SLEEPY" },
    { op: "show_object", map: "VIRIDIAN_CITY", npc: "VIRIDIANCITY_OLD_MAN" },
    // What the rest of Kanto reads off this scene: Route 22's first ambush is
    // armed (route22Ambush spells the same window in its own flags).
    { op: "set_flag", flag: "EVENT_1ST_ROUTE22_RIVAL_BATTLE" },
    { op: "set_flag", flag: "EVENT_ROUTE22_RIVAL_WANTS_BATTLE" },
    { op: "move_npc_to", npc: "OAKSLAB_RIVAL", x: 4, y: 11 },
    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_RIVAL" },
    { op: "play_default_music" },
  ] as ScriptCommand[]);
}

const OAKS_LAB: MapScriptSet = {
  talk: {
    // The rival always takes the one that beats yours: fire -> water ->
    // grass -> fire. The x is the cell he walks to, around the furniture.
    TEXT_OAKSLAB_CHARMANDER_POKE_BALL:
      starterBall("CHARMANDER", "_OaksLabYouWantCharmanderText",
                  "EVENT_CHOSE_CHARMANDER", "OAKSLAB_CHARMANDER_POKE_BALL",
                  7, "OAKSLAB_SQUIRTLE_POKE_BALL", "SQUIRTLE"),
    TEXT_OAKSLAB_SQUIRTLE_POKE_BALL:
      starterBall("SQUIRTLE", "_OaksLabYouWantSquirtleText",
                  "EVENT_CHOSE_SQUIRTLE", "OAKSLAB_SQUIRTLE_POKE_BALL",
                  8, "OAKSLAB_BULBASAUR_POKE_BALL", "BULBASAUR"),
    TEXT_OAKSLAB_BULBASAUR_POKE_BALL:
      starterBall("BULBASAUR", "_OaksLabYouWantBulbasaurText",
                  "EVENT_CHOSE_BULBASAUR", "OAKSLAB_BULBASAUR_POKE_BALL",
                  6, "OAKSLAB_CHARMANDER_POKE_BALL", "CHARMANDER"),

    // Oak. Hidden until the player has tried to leave Pallet Town, which is why
    // the object carries `hidden: true` in the extraction.
    TEXT_OAKSLAB_OAK1: oakAtTheDesk(),

    // Oak's second copy, at the desk after the Pokedex handoff.
    TEXT_OAKSLAB_OAK2: [
      { op: "face_player" },                                          // 0
      { op: "show_text", textId: "_OaksLabOak1ComeSeeMeSometimesText" }, // 1
    ] as ScriptCommand[],

    TEXT_OAKSLAB_RIVAL: [
      { op: "face_player" },                                          // 0
      { op: "check_flag", flag: "EVENT_BATTLED_RIVAL_IN_OAKS_LAB" },  // 1
      { op: "jump_if_true", to: 8 },                                  // 2
      { op: "check_flag", flag: "EVENT_GOT_STARTER" },                // 3
      { op: "jump_if_true", to: 6 },                                  // 4
      { op: "jump", to: 10 },                                         // 5
      { op: "show_text", textId: "_OaksLabRivalIllTakeYouOnText" },   // 6
      { op: "call", routine: "rival_first_battle", argument: "OPP_RIVAL1" }, // 7
      { op: "show_text", textId: "_OaksLabRivalSmellYouLaterText" },  // 8
      { op: "jump", to: "end" },                                      // 9
      // Measured: while you both wait for your pick he tells you to go ahead;
      // "Gramps isn't around" is for a lab you entered on your own.
      { op: "check_flag", flag: "EVENT_FOLLOWED_OAK_INTO_LAB" },      // 10
      { op: "jump_if_true", to: 14 },                                 // 11
      { op: "show_text", textId: "_OaksLabRivalGrampsIsntAroundText" }, // 12
      { op: "jump", to: "end" },                                      // 13
      { op: "show_text", textId: "_OaksLabRivalGoAheadAndChooseText" }, // 14
    ] as ScriptCommand[],

    TEXT_OAKSLAB_POKEDEX1: [
      { op: "show_text", textId: "_OaksLabPokedexText" },             // 0
    ] as ScriptCommand[],
    TEXT_OAKSLAB_POKEDEX2: [
      { op: "show_text", textId: "_OaksLabPokedexText" },             // 0
    ] as ScriptCommand[],
    TEXT_OAKSLAB_GIRL: [
      { op: "face_player" },                                          // 0
      { op: "show_text", textId: "_OaksLabGirlText" },                // 1
    ] as ScriptCommand[],
    TEXT_OAKSLAB_SCIENTIST1: [
      { op: "face_player" },                                          // 0
      { op: "show_text", textId: "_OaksLabScientistText" },           // 1
    ] as ScriptCommand[],
    TEXT_OAKSLAB_SCIENTIST2: [
      { op: "face_player" },                                          // 0
      { op: "show_text", textId: "_OaksLabScientistText" },           // 1
    ] as ScriptCommand[],
  },
  // OaksLabScript7: reaching row 6 before you have chosen, Oak calls you
  // back and you take one step up again. Measured at (5,6) and, by the
  // cartridge's own rule, any column of that row.
  //
  // The same row, once a starter is chosen: BLUE will not let you leave
  // either. Measured (tools/oracle, 6 sep, CHARMANDER from (5,3)): landing
  // on row 6 turns the player to face up at once, then BLUE -- still
  // standing where he took his own Pokemon -- says the whole of
  // _OaksLabRivalIllTakeYouOnText unmoving; only once that closes does he
  // walk over (left/right first, then down -- npcMotion.pathTo's own order,
  // which is why rival_approach can reuse it) to the cell directly above
  // the player, and the battle begins some frames after he arrives. Beaten,
  // he says his line and leaves for good.
  onStep: [
    stepTrigger({ y: 6, ifAll: ["EVENT_FOLLOWED_OAK_INTO_LAB"], unless: ["EVENT_GOT_STARTER"],
                  script: [
                    { op: "show_text", textId: "_OaksLabOakDontGoAwayYetText" },
                    { op: "move_player", direction: "up", steps: 1 },
                  ] }),
    stepTrigger({ y: 6, ifAll: ["EVENT_GOT_STARTER"], unless: ["EVENT_BATTLED_RIVAL_IN_OAKS_LAB"],
                  turnPlayer: "up",
                  script: [
                    { op: "show_text", textId: "_OaksLabRivalIllTakeYouOnText" },
                    { op: "call", routine: "rival_approach", argument: "OAKSLAB_RIVAL" },
                    { op: "face_object", npc: "OAKSLAB_RIVAL", direction: "down" },
                    { op: "call", routine: "rival_first_battle", argument: "OPP_RIVAL1" },
                    { op: "show_text", textId: "_OaksLabRivalSmellYouLaterText" },
                    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_RIVAL" },
                  ] }),
  ],
  onFace: [],
};

/**
 * Yellow's opening, from pokeyellow's scripts/PalletTown.asm and OaksLab.asm,
 * read against gen1recomp's oaks_lab_yellow.lua and story2.lua on 19 September.
 *
 * Yellow stops the player one row further north than Red (wYCoord == 0, at the
 * edge of the grass) and Oak comes up from the south: his hidden object sits at
 * (10,4) instead of Red's (8,5). Before the walk to the lab a wild PIKACHU
 * jumps him and he catches it -- BATTLE_TYPE_PIKACHU, the old man's
 * demonstration with PROF.OAK throwing -- and that Pikachu is the one the
 * player is handed in the lab. The escort itself is Red's, one cell longer.
 *
 * In the lab there is one ball on the table, an EEVEE. The rival takes it the
 * moment Oak has finished talking, shoving the player off the table to do it,
 * and Oak gives the player the Pikachu he caught. The rival's Eevee evolves
 * later according to how these first battles go; rivalStarter on the save is
 * that decision, see Host.yellowRivalBattle.
 *
 * Not ported: the companion Pikachu that walks behind the player (pokeyellow
 * engine/pikachu/), and with it the happiness it keeps. Pikachu stays in its
 * ball as it does after "Pikachu dislikes Poke Balls" is said, and the two
 * lines are still read so the scene ends where the cartridge's does.
 */
function oakEscortYellow(fromEast: boolean): ScriptCommand[] {
  // FindPathToPlayer from (10,4) to the cell below the player: X steps first
  // when the X distance is the larger, else Y; ties go to X.
  const approach: string[] = fromEast ? ["up", "up", "right", "up"] : ["up", "up", "up"];
  const sideStep: ScriptCommand[] = fromEast
    ? [{ op: "move", npc: "PALLETTOWN_OAK", path: ["left"] },
       { op: "move_player", direction: "left", steps: 1 }]
    : [];
  return ([
    // .HeyWaitDontGoOutText turns the player to face down, toward Oak.
    { op: "face_player_dir", direction: "down" },
    { op: "play_music", track: "Music_MeetProfOak" },
    { op: "show_text", textId: "_PalletTownOakHeyWaitDontGoOutText" },
    { op: "set_flag", flag: "EVENT_OAK_APPEARED_IN_PALLET" },
    { op: "show_object", map: "PALLET_TOWN", npc: "PALLETTOWN_OAK" },
    { op: "move", npc: "PALLETTOWN_OAK", path: approach },
    { op: "face", npc: "PALLETTOWN_OAK", direction: "up" },
    // PalletTownOakGreetsPlayerScript: "That was close!", Oak turns to the
    // grass beside the exit, and PalletTownPikachuBattleScript arms the
    // catch on the next overworld iteration.
    { op: "show_text", textId: "_PalletTownOakThatWasCloseText" },
    { op: "face", npc: "PALLETTOWN_OAK", direction: fromEast ? "left" : "right" },
    { op: "wait", frames: 2 },
    { op: "call", routine: "oak_demo", argument: "" },
    { op: "face", npc: "PALLETTOWN_OAK", direction: "up" },
    { op: "show_text", textId: "_PalletTownOakWhewText" },
    { op: "show_text", textId: "_PalletTownOakComeWithMe" },
    // PalletMovementScript_OakMoveLeft starts MUSIC_MUSEUM_GUY for the walk.
    { op: "play_music", track: "Music_MuseumGuy" },
  ] as ScriptCommand[]).concat(sideStep).concat([
    // RLEList_ProfOakWalkToLab, Yellow's: the first run down is six, since Oak
    // stands a cell further north than in Red. You follow a cell behind.
    { op: "move", npc: "PALLETTOWN_OAK", async: true,
      path: ["down", "down", "down", "down", "down", "down", "left",
             "down", "down", "down", "down", "down", "right", "right", "right", "up"] },
    { op: "wait", frames: 2 },
    { op: "move_player", direction: "down", steps: 7 },
    { op: "move_player", direction: "left", steps: 1 },
    { op: "move_player", direction: "down", steps: 5 },
    { op: "move_player", direction: "right", steps: 3 },
    { op: "wait_npc", npc: "PALLETTOWN_OAK" },
    { op: "hide_object", map: "PALLET_TOWN", npc: "PALLETTOWN_OAK" },
    { op: "move_player", direction: "up", steps: 1 },
    { op: "show_object", map: "OAKS_LAB", npc: "OAKSLAB_OAK2" },
    { op: "move", npc: "OAKSLAB_OAK2", async: true,
      path: ["up", "up", "up", "up", "up", "up", "up"] },
    { op: "wait", frames: 2 },
    { op: "move_player", direction: "up", steps: 7 },
    { op: "wait_npc", npc: "OAKSLAB_OAK2" },
    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_OAK2" },
    { op: "show_object", map: "OAKS_LAB", npc: "OAKSLAB_OAK1" },
    { op: "move_player", direction: "up", steps: 1 },
    // OaksLabOakChooseMonSpeechScript, Yellow's words: the one ball.
    { op: "show_text", textId: "_OaksLabRivalFedUpWithWaitingText" },
    { op: "show_text", textId: "_OaksLabOakChooseMonText" },
    { op: "show_text", textId: "_OaksLabRivalWhatAboutMeText" },
    { op: "show_text", textId: "_OaksLabOakBePatientText" },
    { op: "set_flag", flag: "EVENT_FOLLOWED_OAK_INTO_LAB" },
    { op: "set_flag", flag: "EVENT_OAK_ASKED_TO_CHOOSE_MON" },
    { op: "play_default_music" },
  ] as ScriptCommand[]);
}

const PALLET_TOWN_YELLOW: MapScriptSet = {
  talk: {
    TEXT_PALLETTOWN_OAK: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_GOT_STARTER" },
      { op: "jump_if_true", to: "later" },
      { op: "show_text", textId: "_PalletTownOakHeyWaitDontGoOutText" },
      { op: "jump", to: "end" },
      { op: "label", name: "later" },
      { op: "show_text", textId: "_PalletTownOakComeWithMe" },
    ] as ScriptCommand[],
  },
  // PalletTownScript0 in Yellow fires on wYCoord == 0; the two columns that
  // reach it are 10 and 11, and the east one has its own approach.
  onStep: [
    stepTrigger({ x: 11, y: 0, unless: ["EVENT_FOLLOWED_OAK_INTO_LAB"], script: oakEscortYellow(true) }),
    stepTrigger({ y: 0, unless: ["EVENT_FOLLOWED_OAK_INTO_LAB"], script: oakEscortYellow(false) }),
  ],
  onFace: [],
};

/**
 * OaksLabEeveePokeBallText and the scene it starts once Oak has spoken:
 * OaksLabRivalExclamationScript, the shove, OaksLabRivalTakesPokeballScript,
 * OaksLabRLE_PlayerWalksToOak and OaksLabPlayerReceivesPikachuScript.
 *
 * The ball is faced from below, at (7,4), in every ordinary game; that is the
 * branch with the rival's push. Faced from above -- reachable, the row behind
 * the table is floor -- he simply walks to the ball and you step aside to Oak.
 */
function eeveeBall(): ScriptCommand[] {
  return [
    { op: "check_flag", flag: "EVENT_GOT_STARTER" },
    { op: "jump_if_true", to: "end" },
    { op: "check_flag", flag: "EVENT_OAK_ASKED_TO_CHOOSE_MON" },
    { op: "jump_if_false", to: "just_a_ball" },
    { op: "emote", npc: "OAKSLAB_RIVAL", kind: "shock" },
    { op: "check_facing", direction: "up" },
    { op: "jump_if_false", to: "from_above" },
    // .RivalPushesPlayerAwayFromEeveeBall: DOWN, RIGHT, RIGHT, then the last
    // RIGHT onto your cell while you are shoved two cells right. The shove is
    // simulated only as he begins that last step, which is why the walk is
    // split in two here.
    { op: "move", npc: "OAKSLAB_RIVAL", path: ["down", "right", "right"] },
    { op: "move", npc: "OAKSLAB_RIVAL", path: ["right"], async: true },
    { op: "face_player_dir", direction: "left" },
    { op: "move_player", direction: "right", steps: 2 },
    { op: "wait_npc", npc: "OAKSLAB_RIVAL" },
    { op: "wait", frames: 20 },
    // Remembered in a scratch flag: the walk right has turned the player to
    // face right by now, so facing cannot tell the two arrivals apart later.
    { op: "set_flag", flag: "SCRATCH_SHOVED_OFF_TABLE" },
    { op: "jump", to: "snatch" },
    { op: "label", name: "from_above" },
    { op: "clear_flag", flag: "SCRATCH_SHOVED_OFF_TABLE" },
    { op: "move_npc_to", npc: "OAKSLAB_RIVAL", x: 7, y: 4 },
    { op: "label", name: "snatch" },
    { op: "face_object", npc: "OAKSLAB_RIVAL", direction: "up" },
    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_EEVEE_POKE_BALL" },
    // RIVAL_STARTER_JOLTEON is the baseline at the snatch.
    { op: "call", routine: "rival_starter", argument: "1" },
    { op: "show_text", textId: "_OaksLabRivalTakesText1" },
    { op: "text_sound", name: "Get_Key_Item" },
    { op: "show_text", textId: "_OaksLabRivalTakesText2" },
    { op: "show_text", textId: "_OaksLabRivalTakesText3" },
    { op: "show_text", textId: "_OaksLabRivalTakesText4" },
    { op: "show_text", textId: "_OaksLabRivalTakesText5" },
    // OaksLabRLE_PlayerWalksToOak, played backwards as the simulated joypad
    // does: from the shove's (9,4) round the bottom of the table to (5,3),
    // directly below Oak. From above there is only the step beside him.
    { op: "check_flag", flag: "SCRATCH_SHOVED_OFF_TABLE" },
    { op: "clear_flag", flag: "SCRATCH_SHOVED_OFF_TABLE" },
    { op: "jump_if_false", to: "beside_oak" },
    { op: "move_player", direction: "left", steps: 1 },
    { op: "move_player", direction: "down", steps: 1 },
    { op: "move_player", direction: "left", steps: 3 },
    { op: "move_player", direction: "up", steps: 2 },
    { op: "face_player_dir", direction: "up" },
    { op: "face_object", npc: "OAKSLAB_OAK1", direction: "down" },
    { op: "jump", to: "receive" },
    { op: "label", name: "beside_oak" },
    { op: "move_player", direction: "left", steps: 1 },
    { op: "face_player_dir", direction: "left" },
    { op: "face_object", npc: "OAKSLAB_OAK1", direction: "right" },
    { op: "label", name: "receive" },
    { op: "show_text", textId: "_OaksLabOakGivesText" },
    { op: "text_sound", name: "Get_Key_Item" },
    { op: "show_text", textId: "_OaksLabReceivedText", ram: "PIKACHU" },
    { op: "give_pokemon", species: "PIKACHU", level: 5 },
    // OaksLabPlayerReceivedMonText clears wMonDataLocation, so AskName runs.
    { op: "ask", textId: "_DoYouWantToNicknameText", ram: "PIKACHU", flag: "SCRATCH_NICKNAME" },
    { op: "check_flag", flag: "SCRATCH_NICKNAME" },
    { op: "clear_flag", flag: "SCRATCH_NICKNAME" },
    { op: "jump_if_false", to: "no_nickname" },
    { op: "call", routine: "name_entry", argument: "party:last" },
    { op: "label", name: "no_nickname" },
    { op: "set_flag", flag: "EVENT_GOT_STARTER" },
    { op: "set_flag", flag: "EVENT_CHOSE_PIKACHU" },
    { op: "jump", to: "end" },

    { op: "label", name: "just_a_ball" },
    { op: "show_text", textId: "_OaksLabThatsAPokeball" },
  ] as ScriptCommand[];
}

/**
 * Yellow's OaksLabOak1Text, branch for branch from oaks_lab_yellow.lua: the
 * dex rating leads, then the balls, the parcel, and the lines before the first
 * battle. The parcel scene is Red's with Yellow's opening line -- the rival
 * brags rather than asking what he was called for -- and Yellow's tutorial old
 * man, who stands on the sleeper's cell.
 */
function oakAtTheDeskYellow(): ScriptCommand[] {
  return ([
    { op: "face_player" },
    { op: "check_flag", flag: "EVENT_PALLET_AFTER_GETTING_POKEBALLS" },
    { op: "jump_if_true", to: "rating" },
    { op: "check_dex_owned", count: 2 },
    { op: "jump_if_true", to: "rating" },
    { op: "check_item", item: "POKE_BALL", count: 1 },
    { op: "jump_if_true", to: "come_see" },
    { op: "check_flag", flag: "EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE" },
    { op: "jump_if_true", to: "give_balls" },
    { op: "check_flag", flag: "EVENT_GOT_POKEDEX" },
    { op: "jump_if_true", to: "around_world" },
    { op: "check_flag", flag: "EVENT_BATTLED_RIVAL_IN_OAKS_LAB" },
    { op: "jump_if_false", to: "pre_lab_battle" },
    { op: "check_item", item: "OAKS_PARCEL", count: 1 },
    { op: "jump_if_false", to: "raise_young" },

    // -- the parcel: Oak's request ------------------------------------------
    { op: "text_sound", name: "Get_Key_Item" },
    { op: "show_text", textId: "_OaksLabOak1DeliverParcelText" },
    { op: "show_text", textId: "_OaksLabOak1ParcelThanksText" },
    { op: "take_item", item: "OAKS_PARCEL", count: 1 },
    { op: "set_flag", flag: "EVENT_OAK_GOT_PARCEL" },
    { op: "place_npc", npc: "OAKSLAB_RIVAL", x: 4, y: 11, facing: "up" },
    { op: "show_object", map: "OAKS_LAB", npc: "OAKSLAB_RIVAL" },
    { op: "play_music", track: "Music_MeetRival" },
    { op: "show_text", textId: "_OaksLabRivalGrampsText" },
    { op: "call", routine: "rival_beside", argument: "OAKSLAB_RIVAL" },
    { op: "face_object", npc: "OAKSLAB_RIVAL", direction: "up" },
    { op: "face_object", npc: "OAKSLAB_OAK1", direction: "down" },
    { op: "show_text", textId: "_OaksLabRivalMyPokemonHasGrownStrongerText" },
    { op: "show_text", textId: "_OaksLabOakIHaveARequestText" },
    { op: "show_text", textId: "_OaksLabOakMyInventionPokedexText" },
    { op: "text_sound", name: "Get_Key_Item" },
    { op: "show_text", textId: "_OaksLabOakGotPokedexText" },
    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_POKEDEX1" },
    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_POKEDEX2" },
    { op: "show_text", textId: "_OaksLabOakThatWasMyDreamText" },
    { op: "call", routine: "rival_face_player", argument: "OAKSLAB_RIVAL" },
    { op: "show_text", textId: "_OaksLabRivalLeaveItAllToMeText" },
    { op: "set_flag", flag: "EVENT_GOT_POKEDEX" },
    // Yellow's tutorial old man stands on the sleeper's cell (18,9); Red's
    // walker at (17,5) never appears in Yellow.
    { op: "hide_object", map: "VIRIDIAN_CITY", npc: "VIRIDIANCITY_OLD_MAN_SLEEPY" },
    { op: "show_object", map: "VIRIDIAN_CITY", npc: "VIRIDIANCITY_OLD_MAN2" },
    { op: "set_flag", flag: "EVENT_1ST_ROUTE22_RIVAL_BATTLE" },
    { op: "set_flag", flag: "EVENT_ROUTE22_RIVAL_WANTS_BATTLE" },
    { op: "move_npc_to", npc: "OAKSLAB_RIVAL", x: 4, y: 11 },
    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_RIVAL" },
    { op: "play_default_music" },
    { op: "jump", to: "end" },

    { op: "label", name: "raise_young" },
    { op: "show_text", textId: "_OaksLabOak1YouShouldTalkToIt" },
    { op: "jump", to: "end" },

    { op: "label", name: "pre_lab_battle" },
    { op: "check_flag", flag: "EVENT_GOT_STARTER" },
    { op: "jump_if_true", to: "can_fight" },
    { op: "check_flag", flag: "EVENT_FOLLOWED_OAK_INTO_LAB" },
    { op: "jump_if_true", to: "go_ahead" },
    { op: "show_text", textId: "_OaksLabOakChooseMonText" },
    { op: "jump", to: "end" },
    { op: "label", name: "go_ahead" },
    { op: "show_text", textId: "_OaksLabOak1GoAheadItsYours" },
    { op: "jump", to: "end" },
    { op: "label", name: "can_fight" },
    { op: "show_text", textId: "_OaksLabOak1YourPokemonCanFightText" },
    { op: "jump", to: "end" },

    { op: "label", name: "around_world" },
    { op: "show_text", textId: "_OaksLabOak1PokemonAroundTheWorldText" },
    { op: "jump", to: "end" },

    { op: "label", name: "give_balls" },
    { op: "check_flag", flag: "EVENT_GOT_POKEBALLS_FROM_OAK" },
    { op: "jump_if_true", to: "come_see" },
    { op: "set_flag", flag: "EVENT_GOT_POKEBALLS_FROM_OAK" },
    { op: "text_sound", name: "Get_Key_Item" },
    { op: "show_text", textId: "_OaksLabOak1ReceivedPokeballsText" },
    { op: "give_item", item: "POKE_BALL", count: 5 },
    { op: "show_text", textId: "_OaksLabGivePokeballsExplanationText" },
    { op: "jump", to: "end" },

    { op: "label", name: "come_see" },
    { op: "show_text", textId: "_OaksLabOak1ComeSeeMeSometimesText" },
    { op: "jump", to: "end" },

    { op: "label", name: "rating" },
    { op: "show_text", textId: "_OaksLabOak1HowIsYourPokedexComingText" },
  ] as ScriptCommand[]).concat(dexRating());
}

const OAKS_LAB_YELLOW: MapScriptSet = {
  talk: {
    TEXT_OAKSLAB_EEVEE_POKE_BALL: eeveeBall(),
    TEXT_OAKSLAB_OAK1: oakAtTheDeskYellow(),
    TEXT_OAKSLAB_OAK2: [
      { op: "face_player" },
      { op: "show_text", textId: "_OaksLabOak1ComeSeeMeSometimesText" },
    ] as ScriptCommand[],
    TEXT_OAKSLAB_RIVAL: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_GOT_STARTER" },
      { op: "jump_if_false", to: "pre_starter" },
      { op: "show_text", textId: "_OaksLabRivalMyPokemonLooksStrongerText" },
      { op: "jump", to: "end" },
      { op: "label", name: "pre_starter" },
      { op: "check_flag", flag: "EVENT_FOLLOWED_OAK_INTO_LAB" },
      { op: "jump_if_false", to: "gramps_gone" },
      { op: "show_text", textId: "_OaksLabRivalIllGetABetterPokemonThanYou" },
      { op: "jump", to: "end" },
      { op: "label", name: "gramps_gone" },
      { op: "show_text", textId: "_OaksLabRivalGrampsIsntAroundText" },
    ] as ScriptCommand[],
    TEXT_OAKSLAB_POKEDEX1: [{ op: "show_text", textId: "_OaksLabPokedexText" }] as ScriptCommand[],
    TEXT_OAKSLAB_POKEDEX2: [{ op: "show_text", textId: "_OaksLabPokedexText" }] as ScriptCommand[],
    TEXT_OAKSLAB_GIRL: [
      { op: "face_player" },
      { op: "show_text", textId: "_OaksLabGirlText" },
    ] as ScriptCommand[],
    TEXT_OAKSLAB_SCIENTIST1: [
      { op: "face_player" },
      { op: "show_text", textId: "_OaksLabScientistText" },
    ] as ScriptCommand[],
    TEXT_OAKSLAB_SCIENTIST2: [
      { op: "face_player" },
      { op: "show_text", textId: "_OaksLabScientistText" },
    ] as ScriptCommand[],
  },
  onStep: [
    // OaksLabPlayerDontGoAwayScript: row 6 without the Pikachu walks you back.
    stepTrigger({ y: 6, ifAll: ["EVENT_FOLLOWED_OAK_INTO_LAB"], unless: ["EVENT_GOT_STARTER"],
                  script: [
                    { op: "face_object", npc: "OAKSLAB_OAK1", direction: "down" },
                    { op: "face_object", npc: "OAKSLAB_RIVAL", direction: "down" },
                    { op: "show_text", textId: "_OaksLabOakDontGoAwayYetText" },
                    { op: "move_player", direction: "up", steps: 1 },
                  ] }),
    // OaksLabRivalChallengesPlayerScript .. OaksLabPikachuDislikesPokeballsScript:
    // heading for the door with Pikachu starts the rival battle, the party is
    // healed, his Eevee's future is decided (rival_first_battle), he leaves on
    // his own music, and Pikachu pops out of its ball.
    stepTrigger({ y: 6, ifAll: ["EVENT_GOT_STARTER"], unless: ["EVENT_BATTLED_RIVAL_IN_OAKS_LAB"],
                  turnPlayer: "up",
                  script: [
                    { op: "face_object", npc: "OAKSLAB_RIVAL", direction: "down" },
                    { op: "play_music", track: "Music_MeetRival" },
                    { op: "show_text", textId: "_OaksLabRivalIllTakeYouOnText" },
                    { op: "call", routine: "rival_approach", argument: "OAKSLAB_RIVAL" },
                    { op: "face_object", npc: "OAKSLAB_RIVAL", direction: "down" },
                    { op: "call", routine: "rival_first_battle", argument: "OPP_RIVAL1" },
                    { op: "heal_party" },
                    { op: "wait", frames: 20 },
                    { op: "show_text", textId: "_OaksLabRivalSmellYouLaterText" },
                    { op: "play_music", track: "Music_MeetRival" },
                    { op: "move_npc_to", npc: "OAKSLAB_RIVAL", x: 4, y: 11 },
                    { op: "hide_object", map: "OAKS_LAB", npc: "OAKSLAB_RIVAL" },
                    { op: "play_default_music" },
                    { op: "face_player_dir", direction: "up" },
                    { op: "play_cry", species: "PIKACHU" },
                    { op: "show_text", textId: "_OaksLabPikachuDislikesPokeballsText1" },
                    { op: "show_text", textId: "_OaksLabPikachuDislikesPokeballsText2" },
                  ] }),
  ],
  onFace: [],
};

/**
 * PewterGym.asm -- the first badge, which is where 1.0 ends.
 *
 * The TM handoff is the reason the reference writes its gym leaders as functions
 * rather than data: `give_tm` has to check the bag, print a different line when
 * it is full, and be reachable AGAIN on a later conversation so the TM is not
 * lost. That retry is control flow, so it is a routine; everything around it is
 * a sequence and stays data.
 */
const PEWTER_GYM: MapScriptSet = {
  talk: {
    // Brock, in the reference's own three branches (gyms.lua M.PEWTER_GYM.talk):
    // beaten -> the advice line; beaten but the TM still owed because the bag was
    // full at the victory -> retry the hand-over; not beaten -> the pre-battle
    // line and the battle.
    //
    // The badge, EVENT_BEAT_BROCK, the retired gym trainer and the two NPCs this
    // victory hides on OTHER maps all come from Victories.ts now, applied when
    // the battle is won. Only the TM is here, because only the TM can fail.
    TEXT_PEWTERGYM_BROCK: leaderTalk("OPP_BROCK#1", "_PewterGymBrockPreBattleText",
                                     "_PewterGymBrockPostBattleAdviceText", []),
    // The gym's one trainer has a header row (PewterGym "2") and fights through
    // TrainerTalk like every other; the hand entry that used to be here retired
    // him on a loss and repeated his end line forever.

  },
  onStep: [],
  onFace: [],
};


/**
 * OakSpeech -- the intro, which belongs to no map.
 *
 * The reference writes this one as a function, and the reason is real: it drives
 * two naming screens and a sprite stage that is not the overworld at all. What
 * is NOT control flow is the order of the lines, and that is most of it, so the
 * sequence stays data and the two genuinely-not-a-sequence parts are routines
 * the host provides:
 *
 *   intro_stage <who>  -- put a sprite on the black title stage: "oak",
 *                         "nidorino", "player", "rival", or "" to clear it.
 *   name_entry  <who>  -- the naming screen, including its preset list. DONE
 *                         once a name has been committed.
 *
 * The Nidorino cry is the first sound the cartridge makes and the reason the
 * audio path exists at all, so it is here rather than deferred with the rest of
 * F4: `cry` already resolves a species from the extracted table.
 *
 * The warp at the end is the handover to normal play -- REDS_HOUSE_2F, warp 0,
 * which is the bedroom the game actually starts in.
 */
export const OAK_SPEECH: ScriptCommand[] = [
  { op: "call", routine: "intro_stage", argument: "oak" },            // 0
  { op: "show_text", textId: "_OakSpeechText1" },                     // 1
  { op: "call", routine: "intro_stage", argument: "nidorino" },       // 2
  { op: "cry", species: "NIDORINO" },                                 // 3
  { op: "show_text", textId: "_OakSpeechText2A" },                    // 4
  { op: "show_text", textId: "_OakSpeechText2B" },                    // 5
  { op: "call", routine: "intro_stage", argument: "player" },         // 6
  { op: "show_text", textId: "_IntroducePlayerText" },                // 7
  { op: "call", routine: "name_entry", argument: "player" },          // 8
  { op: "call", routine: "intro_stage", argument: "rival" },          // 9
  { op: "show_text", textId: "_IntroduceRivalText" },                 // 10
  { op: "call", routine: "name_entry", argument: "rival" },           // 11
  { op: "call", routine: "intro_stage", argument: "player" },         // 12
  { op: "show_text", textId: "_OakSpeechText3" },                     // 13
  { op: "fade", direction: "out", colour: "white" },                  // 14
  { op: "call", routine: "intro_stage", argument: "" },               // 15
  // Where a new game starts. MEASURED on the cartridge in PyBoy: (3,6),
  // facing up, in front of the SNES -- not on the stairs, which is where
  // warping by warp index 1 had been putting Red for every new game.
  { op: "warp", map: "REDS_HOUSE_2F", x: 3, y: 6, facing: "up" },     // 16
  { op: "fade", direction: "in", colour: "white" },                   // 17
  { op: "set_flag", flag: "EVENT_INTRO_DONE" },                       // 18
];

/** The species Oak shows in the intro: Red's NIDORINO, Yellow's PIKACHU (field.oakSpeech.demoSpecies). */
export function introSpecies(version: CartridgeVersion = "red"): string {
  return version === "yellow" ? "PIKACHU" : "NIDORINO";
}

/**
 * The intro, for the caller that starts a new game. Yellow's OakSpeech shows
 * a PIKACHU where Red's shows a NIDORINO; the stage draws whatever front it
 * was built with, and the cry names the species here.
 */
export function introScript(version: CartridgeVersion = "red"): ScriptCommand[] {
  if (version !== "yellow") {
    return OAK_SPEECH;
  }
  return OAK_SPEECH.map((c) => (c.op === "cry" ? { op: "cry", species: introSpecies(version) } : c));
}

/**
 * A gym leader, in Brock's shape, built from the victory table.
 *
 * Win: the pre-battle line, the battle, the badge line(s), then straight into
 * the TM offer and the TM's lines. Beaten before: the advice, or the TM offer
 * again if the bag was full last time (give_tm is retryable and gotFlag is the
 * record). `afterAdvice` runs ONLY on the beaten branch: it is Giovanni's
 * leaving the gym, which on the winning talk would hide him before he had
 * finished speaking.
 *
 * The advice is NOT said at the victory. PewterGymScriptReceiveTM34 ends after
 * the TM lines and the badge bits; the advice is `PewterGymBrockText`'s
 * .afterBeat branch, reached only by talking to him again once he is beaten
 * AND the TM has landed. Saying it at the victory made the lens print one page
 * too many at the moment of winning, and then the same page again on the very
 * next talk.
 *
 * The end-battle and badge lines print here in the overworld after the stage
 * exits; the cartridge prints them on the battle screen. One helper, so the
 * day that moves it is one edit.
 */
/**
 * A chain of pages with its jingle BETWEEN them, not in front of them.
 *
 * `PewterGymBrockReceivedBoulderBadgeText` is one text: the badge line, then
 * sound_level_up, then the badge-information line. So is the TM's:
 * `PewterGymReceivedTM34Text`, then sound_get_item_1, then the explanation.
 * Victories.ts has always described the field that way -- "the text sound that
 * plays between the pages" -- and the builder played it in front of the first
 * page instead, so every gym rang before it spoke.
 */
function pushWithSound(out: ScriptCommand[], lines: string[], sound: string): void {
  for (let i = 0; i < lines.length; i++) {
    out.push({ op: "show_text", textId: lines[i] });
    if (i === 0 && sound) {
      out.push({ op: "text_sound", name: sound });
    }
  }
}

function leaderTalk(victoryKey: string, preBattle: string, advice: string,
                    afterAdvice: ScriptCommand[]): ScriptCommand[] {
  const hash = victoryKey.indexOf("#");
  const cls = hash >= 0 ? victoryKey.substring(0, hash) : victoryKey;
  const party = hash >= 0 ? parseInt(victoryKey.substring(hash + 1), 10) : 1;
  const win = victoryFor(cls, party);
  if (win === null) {
    print("[MapScripts] no victory for " + victoryKey + "; the leader only talks");
    return [{ op: "face_player" }, { op: "show_text", textId: preBattle }];
  }
  const out: ScriptCommand[] = [
    { op: "face_player" },
    { op: "check_flag", flag: win.flag },
    { op: "jump_if_true", to: "beaten" },
    { op: "show_text", textId: preBattle },
    { op: "start_battle", trainer: cls, party: party },
    { op: "check_battle_result" },
    { op: "jump_if_false", to: "end" },
  ];
  pushWithSound(out, win.dialogue, win.badgeSound);
  out.push({ op: "jump", to: "offer_tm" });

  out.push({ op: "label", name: "beaten" });
  out.push({ op: "check_flag", flag: win.gotFlag });
  out.push({ op: "jump_if_true", to: "advice" });

  out.push({ op: "label", name: "offer_tm" });
  for (let i = 0; i < win.tmPre.length; i++) {
    out.push({ op: "show_text", textId: win.tmPre[i] });
  }
  out.push({ op: "call", routine: "give_tm", argument: victoryKey });
  out.push({ op: "check_flag", flag: win.gotFlag });
  out.push({ op: "jump_if_false", to: "no_room" });
  pushWithSound(out, win.tmDialogue, win.tmSound);
  out.push({ op: "jump", to: "end" });

  out.push({ op: "label", name: "no_room" });
  out.push({ op: "show_text", textId: win.noRoom });
  out.push({ op: "jump", to: "end" });

  out.push({ op: "label", name: "advice" });
  out.push({ op: "show_text", textId: advice });
  for (let i = 0; i < afterAdvice.length; i++) {
    out.push(afterAdvice[i]);
  }
  return out;
}

/**
 * A boss with no trainer header: the challenge, the battle, the defeat
 * recorded, the lines that follow, and whatever `aftermath` the cartridge's
 * script does next. `beatenText` is what they say on every later talk.
 */
function bossTalk(mapId: string, npc: string, flag: string, trainer: string, party: number,
                  before: string, afterWin: string[], aftermath: ScriptCommand[],
                  beatenText: string): ScriptCommand[] {
  const out: ScriptCommand[] = [
    { op: "face_player" },
    { op: "check_flag", flag: flag },
    { op: "jump_if_true", to: "beaten" },
    { op: "show_text", textId: before },
    { op: "start_battle", trainer: trainer, party: party },
    { op: "check_battle_result" },
    { op: "jump_if_false", to: "end" },
    { op: "beat_trainer", map: mapId, npc: npc, flag: flag },
  ];
  for (let i = 0; i < afterWin.length; i++) {
    out.push({ op: "show_text", textId: afterWin[i] });
  }
  for (let i = 0; i < aftermath.length; i++) {
    out.push(aftermath[i]);
  }
  out.push({ op: "jump", to: "end" });
  out.push({ op: "label", name: "beaten" });
  if (beatenText) {
    out.push({ op: "show_text", textId: beatenText });
  }
  return out;
}

/** Every Rocket and Rocket-aligned scientist Silph Co. loses when Giovanni falls. */
const SILPH_ROCKETS: string[][] = [
  ["SILPH_CO_2F", "SILPHCO2F_SCIENTIST1"], ["SILPH_CO_2F", "SILPHCO2F_SCIENTIST2"],
  ["SILPH_CO_2F", "SILPHCO2F_ROCKET1"], ["SILPH_CO_2F", "SILPHCO2F_ROCKET2"],
  ["SILPH_CO_3F", "SILPHCO3F_ROCKET"], ["SILPH_CO_3F", "SILPHCO3F_SCIENTIST"],
  ["SILPH_CO_4F", "SILPHCO4F_ROCKET1"], ["SILPH_CO_4F", "SILPHCO4F_SCIENTIST"], ["SILPH_CO_4F", "SILPHCO4F_ROCKET2"],
  ["SILPH_CO_5F", "SILPHCO5F_ROCKET1"], ["SILPH_CO_5F", "SILPHCO5F_SCIENTIST"],
  ["SILPH_CO_5F", "SILPHCO5F_ROCKER"], ["SILPH_CO_5F", "SILPHCO5F_ROCKET2"],
  ["SILPH_CO_6F", "SILPHCO6F_ROCKET1"], ["SILPH_CO_6F", "SILPHCO6F_SCIENTIST"], ["SILPH_CO_6F", "SILPHCO6F_ROCKET2"],
  ["SILPH_CO_7F", "SILPHCO7F_ROCKET1"], ["SILPH_CO_7F", "SILPHCO7F_SCIENTIST"],
  ["SILPH_CO_7F", "SILPHCO7F_ROCKET2"], ["SILPH_CO_7F", "SILPHCO7F_ROCKET3"],
  ["SILPH_CO_8F", "SILPHCO8F_ROCKET1"], ["SILPH_CO_8F", "SILPHCO8F_SCIENTIST"], ["SILPH_CO_8F", "SILPHCO8F_ROCKET2"],
  ["SILPH_CO_9F", "SILPHCO9F_ROCKET1"], ["SILPH_CO_9F", "SILPHCO9F_SCIENTIST"], ["SILPH_CO_9F", "SILPHCO9F_ROCKET2"],
  ["SILPH_CO_10F", "SILPHCO10F_ROCKET"], ["SILPH_CO_10F", "SILPHCO10F_SCIENTIST"],
  ["SILPH_CO_11F", "SILPHCO11F_GIOVANNI"], ["SILPH_CO_11F", "SILPHCO11F_ROCKET1"], ["SILPH_CO_11F", "SILPHCO11F_ROCKET2"],
];

/**
 * SAFFRON CITY changes hands when Giovanni loses (SaffronCity.asm's own map
 * script, which swaps the sprite set on entry).
 *
 * Seven ROCKETs on the street and the guard asleep outside SILPH go; the six
 * people who had stayed indoors come back, including the GENTLEMAN and his
 * PIDGEOT. The cartridge does it on every entry rather than once, because the
 * decision belongs to the event bit and not to having been here at the time.
 */
const SAFFRON_ROCKETS: string[] = [
  "SAFFRONCITY_ROCKET1", "SAFFRONCITY_ROCKET2", "SAFFRONCITY_ROCKET3",
  "SAFFRONCITY_ROCKET4", "SAFFRONCITY_ROCKET5", "SAFFRONCITY_ROCKET6",
  "SAFFRONCITY_ROCKET7", "SAFFRONCITY_ROCKET8",
];
const SAFFRON_CITIZENS: string[] = [
  "SAFFRONCITY_SCIENTIST", "SAFFRONCITY_SILPH_WORKER_M", "SAFFRONCITY_SILPH_WORKER_F",
  "SAFFRONCITY_GENTLEMAN", "SAFFRONCITY_PIDGEOT", "SAFFRONCITY_ROCKER",
  "SAFFRONCITY_ROCKET9",
];

function saffronAfterSilph(): ScriptCommand[] {
  const out: ScriptCommand[] = [
    { op: "check_flag", flag: "EVENT_BEAT_SILPH_CO_GIOVANNI" },
    { op: "jump_if_false", to: "end" },
  ];
  for (let i = 0; i < SAFFRON_ROCKETS.length; i++) {
    out.push({ op: "hide_object", map: "SAFFRON_CITY", npc: SAFFRON_ROCKETS[i] });
  }
  for (let i = 0; i < SAFFRON_CITIZENS.length; i++) {
    out.push({ op: "show_object", map: "SAFFRON_CITY", npc: SAFFRON_CITIZENS[i] });
  }
  return out;
}

const SAFFRON_CITY: MapScriptSet = {
  talk: {},
  onStep: [],
  onFace: [],
  onEnter: saffronAfterSilph(),
};

function silphRocketsLeave(): ScriptCommand[] {
  const out: ScriptCommand[] = [{ op: "fade", direction: "out", colour: "black" }];
  for (let i = 0; i < SILPH_ROCKETS.length; i++) {
    out.push({ op: "hide_object", map: SILPH_ROCKETS[i][0], npc: SILPH_ROCKETS[i][1] });
  }
  out.push({ op: "wait", frames: 3 });
  out.push({ op: "fade", direction: "in", colour: "black" });
  return out;
}

// The seven other gyms. The leaders have no trainer header on the cartridge --
// their text_asm owns the whole exchange -- so they are hand entries built
// from the victory table. Labels are the cartridge's; script.test.mjs checks
// every one exists, which is what catches Koga's "Before" and Sabrina's bare
// label against the "Pre" the others use.
const CERULEAN_GYM: MapScriptSet = {
  talk: { TEXT_CERULEANGYM_MISTY: leaderTalk("OPP_MISTY#1", "_CeruleanGymMistyPreBattleText",
                                             "_CeruleanGymMistyTM11ExplanationText", []) },
  onStep: [],
  onFace: [],
};
const VERMILION_GYM: MapScriptSet = {
  talk: { TEXT_VERMILIONGYM_LT_SURGE: leaderTalk("OPP_LT_SURGE#1", "_VermilionGymLTSurgePreBattleText",
                                                 "_VermilionGymLTSurgePostBattleAdviceText", []) },
  onStep: [],
  onFace: [],
};
const CELADON_GYM: MapScriptSet = {
  talk: { TEXT_CELADONGYM_ERIKA: leaderTalk("OPP_ERIKA#1", "_CeladonGymErikaPreBattleText",
                                            "_CeladonGymErikaPostBattleAdviceText", []) },
  onStep: [],
  onFace: [],
};
const FUCHSIA_GYM: MapScriptSet = {
  talk: { TEXT_FUCHSIAGYM_KOGA: leaderTalk("OPP_KOGA#1", "_FuchsiaGymKogaBeforeBattleText",
                                           "_FuchsiaGymKogaPostBattleAdviceText", []) },
  onStep: [],
  onFace: [],
};
const SAFFRON_GYM: MapScriptSet = {
  talk: { TEXT_SAFFRONGYM_SABRINA: leaderTalk("OPP_SABRINA#1", "_SaffronGymSabrinaText",
                                              "_SaffronGymSabrinaPostBattleAdviceText", []) },
  onStep: [],
  onFace: [],
};
const CINNABAR_GYM: MapScriptSet = {
  talk: { TEXT_CINNABARGYM_BLAINE: leaderTalk("OPP_BLAINE#1", "_CinnabarGymBlainePreBattleText",
                                              "_CinnabarGymBlainePostBattleAdviceText", []) },
  onStep: [],
  onFace: [],
};
const VIRIDIAN_GYM: MapScriptSet = {
  // Giovanni leaves the gym after his advice on a LATER talk, never on the win:
  // hidden during the winning conversation, he would vanish mid-sentence.
  talk: { TEXT_VIRIDIANGYM_GIOVANNI: leaderTalk("OPP_GIOVANNI#3", "_ViridianGymGiovanniPreBattleText",
                                                "_ViridianGymGiovanniPostBattleAdviceText", [
    { op: "fade", direction: "out", colour: "black" },
    { op: "hide_object", map: "VIRIDIAN_GYM", npc: "VIRIDIANGYM_GIOVANNI" },
    { op: "fade", direction: "in", colour: "black" },
  ]) },
  onStep: [],
  onFace: [],
};

// Bosses without a header. The Karate Master's win retires the four Blackbelts
// through the victory table and offers a Pokemon; the two Giovannis have no
// header row on the cartridge either -- their text_asm owns the battle.
const FIGHTING_DOJO: MapScriptSet = {
  // FightingDojoDefaultScript checks exactly the cell left of the master.
  onStep: [
    stepTrigger({ x: 4, y: 3, unless: ["EVENT_BEAT_KARATE_MASTER"], turnPlayer: "right", talk: "TEXT_FIGHTINGDOJO_KARATE_MASTER" }),
  ],
  talk: { TEXT_FIGHTINGDOJO_KARATE_MASTER: bossTalk("FIGHTING_DOJO", "FIGHTINGDOJO_KARATE_MASTER",
    "EVENT_BEAT_KARATE_MASTER", "OPP_BLACKBELT", 1, "_FightingDojoKarateMasterText",
    ["_FightingDojoKarateMasterDefeatedText", "_FightingDojoKarateMasterIWillGiveYouAPokemonText"], [],
    "_FightingDojoKarateMasterStayAndTrainWithUsText") },
  onFace: [],
};
/**
 * The grunt by the lift is ROCKET3 in Red and Blue and simply ROCKET in
 * Yellow, whose floor has Jessie and James where Red has two more grunts; his
 * three lines are renamed with him. Same trainer (OPP_ROCKET 18), same flag,
 * same key -- and until 20 September Yellow had no script for him at all, so
 * the LIFT KEY's ball stayed hidden for good.
 */
function rocketHideoutB4F(grunt: string, lines: string): MapScriptSet {
  const textKey = "TEXT_ROCKETHIDEOUTB4F_" + grunt;
  const npc = "ROCKETHIDEOUTB4F_" + grunt;
  const set: MapScriptSet = {
  // BeatGiovanniScript: he hopes to meet again, the screen fades, he is gone and
  // the SILPH SCOPE lies where he stood. The object carries no trainer class in
  // the bundle, so the battle is written here.
  talk: {
    TEXT_ROCKETHIDEOUTB4F_GIOVANNI: bossTalk("ROCKET_HIDEOUT_B4F", "ROCKETHIDEOUTB4F_GIOVANNI",
      "EVENT_BEAT_ROCKET_HIDEOUT_GIOVANNI", "OPP_GIOVANNI", 1, "_RocketHideoutB4FGiovanniImpressedYouGotHereText",
      ["_RocketHideoutB4FGiovanniWhatCannotBeText", "_RocketHideoutB4FGiovanniHopeWeMeetAgainText"], [
        { op: "fade", direction: "out", colour: "black" },
        { op: "hide_object", map: "ROCKET_HIDEOUT_B4F", npc: "ROCKETHIDEOUTB4F_GIOVANNI" },
        { op: "show_object", map: "ROCKET_HIDEOUT_B4F", npc: "ROCKETHIDEOUTB4F_SILPH_SCOPE" },
        { op: "fade", direction: "in", colour: "black" },
      ], "_RocketHideoutB4FGiovanniHopeWeMeetAgainText"),
    // The grunt by the lift fights by his header like any other; the first
    // talk after his defeat is where he drops the LIFT KEY (CheckAndSetEvent
    // EVENT_ROCKET_DROPPED_LIFT_KEY), and the ball appears beside him.
    GRUNT_BY_THE_LIFT: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_BEAT_ROCKET_HIDEOUT_4_TRAINER_2" },
      { op: "jump_if_true", to: "beaten" },
      { op: "show_text", textId: lines + "BattleText" },
      { op: "start_battle", trainer: "OPP_ROCKET", party: 18 },
      { op: "check_battle_result" },
      { op: "jump_if_false", to: "end" },
      { op: "beat_trainer", map: "ROCKET_HIDEOUT_B4F", npc: npc, flag: "EVENT_BEAT_ROCKET_HIDEOUT_4_TRAINER_2" },
      { op: "show_text", textId: lines + "EndBattleText" },
      { op: "jump", to: "end" },
      { op: "label", name: "beaten" },
      { op: "show_text", textId: lines + "AfterBattleText" },
      { op: "check_flag", flag: "EVENT_ROCKET_DROPPED_LIFT_KEY" },
      { op: "jump_if_true", to: "end" },
      { op: "set_flag", flag: "EVENT_ROCKET_DROPPED_LIFT_KEY" },
      { op: "show_object", map: "ROCKET_HIDEOUT_B4F", npc: "ROCKETHIDEOUTB4F_LIFT_KEY" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
  // RocketHideoutB4F.asm:11-31: the door to GIOVANNI opens with SFX_GO_INSIDE
  // once both of his guards are beaten, on every map load after.
  onEnter: [
    { op: "check_flag", flag: "EVENT_BEAT_ROCKET_HIDEOUT_4_TRAINER_0" },
    { op: "jump_if_false", to: "end" },
    { op: "check_flag", flag: "EVENT_BEAT_ROCKET_HIDEOUT_4_TRAINER_1" },
    { op: "jump_if_false", to: "end" },
    { op: "text_sound", name: "Go_Inside" },
  ] as ScriptCommand[],
};
  // Keyed by the grunt's own text id, which is the one thing that differs.
  const talk: any = set.talk;
  talk[textKey] = talk.GRUNT_BY_THE_LIFT;
  delete talk.GRUNT_BY_THE_LIFT;
  return set;
}

const ROCKET_HIDEOUT_B4F: MapScriptSet = rocketHideoutB4F("ROCKET3", "_RocketHideoutB4FRocket3");
const ROCKET_HIDEOUT_B4F_YELLOW: MapScriptSet = rocketHideoutB4F("ROCKET", "_RocketHideoutB4FRocket");
/**
 * SILPH CO 7F: the rival is waiting by the lift (SilphCo7F.asm, bank $14).
 *
 * Read off the cartridge at $5C23..$5D24. Two cells arm it, (3,2) and (3,3),
 * and which one you are standing on decides both walks: from (3,7) he comes
 * four cells up to stand below you, or three, and afterwards he leaves by two
 * steps right or by the long way round. He faces UP at you either way, and
 * the roster is OPP_RIVAL2 from base 7, picked by HIS starter.
 */
function silphRivalScene(playerY: number): ScriptCommand[] {
  const close = playerY === 2;
  const steps = close ? 4 : 3;
  const approach: string[] = [];
  for (let i = 0; i < steps; i++) {
    approach.push("up");
  }
  const exit: string[] = close
    ? ["right", "right"]
    : ["left", "up", "up", "right", "right", "right", "down"];
  return [
    { op: "stop_music" },
    { op: "play_music", track: "Music_MeetRival" },
    { op: "move", npc: "SILPHCO7F_RIVAL", path: approach },
    { op: "face", npc: "SILPHCO7F_RIVAL", direction: "up" },
    { op: "face_player_dir", direction: "down" },
    { op: "show_text", textId: "_SilphCo7FRivalWaitedHereText" },
    { op: "call", routine: "rival_battle", argument: "OPP_RIVAL2#7" },
    { op: "check_battle_result" },
    { op: "jump_if_false", to: "end" },
    { op: "set_flag", flag: "EVENT_BEAT_SILPH_CO_RIVAL" },
    { op: "show_text", textId: "_SilphCo7FRivalDefeatedText" },
    { op: "face", npc: "SILPHCO7F_RIVAL", direction: "up" },
    { op: "show_text", textId: "_SilphCo7FRivalGoodLuckToYouText" },
    { op: "move", npc: "SILPHCO7F_RIVAL", path: exit },
    { op: "hide_object", map: "SILPH_CO_7F", npc: "SILPHCO7F_RIVAL" },
    { op: "play_default_music" },
  ] as ScriptCommand[];
}

const SILPH_CO_7F: MapScriptSet = {
  // Spoken to instead -- only reachable after a lost battle has left him
  // standing there -- he fights from where he is, as SS Anne's rival does.
  talk: {
    TEXT_SILPHCO7F_RIVAL: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_BEAT_SILPH_CO_RIVAL" },
      { op: "jump_if_true", to: "beaten" },
      { op: "show_text", textId: "_SilphCo7FRivalWaitedHereText" },
      { op: "call", routine: "rival_battle", argument: "OPP_RIVAL2#7" },
      { op: "check_battle_result" },
      { op: "jump_if_false", to: "end" },
      { op: "set_flag", flag: "EVENT_BEAT_SILPH_CO_RIVAL" },
      { op: "show_text", textId: "_SilphCo7FRivalDefeatedText" },
      { op: "show_text", textId: "_SilphCo7FRivalGoodLuckToYouText" },
      { op: "hide_object", map: "SILPH_CO_7F", npc: "SILPHCO7F_RIVAL" },
      { op: "jump", to: "end" },
      { op: "label", name: "beaten" },
      { op: "show_text", textId: "_SilphCo7FRivalText" },
    ] as ScriptCommand[],
  },
  onStep: [
    stepTrigger({ x: 3, y: 2, unless: "EVENT_BEAT_SILPH_CO_RIVAL", script: silphRivalScene(2) }),
    stepTrigger({ x: 3, y: 3, unless: "EVENT_BEAT_SILPH_CO_RIVAL", script: silphRivalScene(3) }),
  ],
  onFace: [],
};

const SILPH_CO_11F: MapScriptSet = {
  // SilphCo11FDefaultScript: the two cells beside his desk start the fight.
  onStep: [
    stepTrigger({ x: 6, y: 13, unless: ["EVENT_BEAT_SILPH_CO_GIOVANNI"], talk: "TEXT_SILPHCO11F_GIOVANNI" }),
    stepTrigger({ x: 7, y: 12, unless: ["EVENT_BEAT_SILPH_CO_GIOVANNI"], talk: "TEXT_SILPHCO11F_GIOVANNI" }),
  ],
  // On the cartridge his battle is a coordinate trigger beside the desk; the
  // talk serves until step triggers land. SilphCo11FGiovanniAfterBattleScript:
  // "you ruined our plans", fade, every Rocket in the building leaves, fade.
  talk: { TEXT_SILPHCO11F_GIOVANNI: bossTalk("SILPH_CO_11F", "SILPHCO11F_GIOVANNI",
    "EVENT_BEAT_SILPH_CO_GIOVANNI", "OPP_GIOVANNI", 2, "_SilphCo11FGiovanniText",
    ["_SilphCo10FGiovanniILostAgainText", "_SilphCo11FGiovanniYouRuinedOurPlansText"],
    silphRocketsLeave(), "") },
  onFace: [],
};

/**
 * Route 22's rival ambush (scripts/Route22.asm), one visit.
 *
 * He spawns hidden at (25,5), walks RIGHT along row 5 to the cell below the
 * player on (29,4) -- or to the cell left of him on (29,5) -- faces him, and
 * fights with the roster the starter decides (rival_battle adds it to the
 * base). On the win the flag, his two lines, the sting, his exit walk, and he
 * is gone; on a loss nothing, and the cell fires again.
 */
function route22Ambush(n: number, npc: string, trainer: string, base: number,
                       beatFlag: string, playerY: number): ScriptCommand[] {
  const rivalX = playerY === 4 ? 29 : 28;
  const rivalFacing = playerY === 4 ? "up" : "right";
  let exit: string[];
  if (n === 2) {
    exit = playerY === 4 ? ["left", "left", "left", "left"] : ["left", "left", "left"];
  } else if (playerY === 4) {
    exit = ["right", "right", "down", "down", "down", "down", "down"];
  } else {
    exit = ["up", "right", "right", "right", "down", "down", "down", "down", "down", "down"];
  }
  return [
    { op: "show_object", map: "ROUTE_22", npc: npc },
    { op: "move_npc_to", npc: npc, x: rivalX, y: 5 },
    { op: "face_object", npc: npc, direction: rivalFacing },
    { op: "show_text", textId: "_Route22RivalBeforeBattleText" + n },
    { op: "call", routine: "rival_battle", argument: trainer + "#" + base },
    { op: "check_battle_result" },
    { op: "jump_if_false", to: "end" },
    { op: "set_flag", flag: beatFlag },
    { op: "show_text", textId: "_Route22Rival" + n + "DefeatedText" },
    { op: "show_text", textId: "_Route22RivalAfterBattleText" + n },
    { op: "play_music", track: "Music_MeetRival" },
    { op: "move", npc: npc, path: exit },
    { op: "play_default_music" },
    { op: "hide_object", map: "ROUTE_22", npc: npc },
  ];
}

const ROUTE_22: MapScriptSet = {
  talk: {},
  // The cartridge arms the first visit on EVENT_ROUTE22_RIVAL_WANTS_BATTLE,
  // set with the Pokedex and expired by Brock; the same window is spelled by
  // the flags themselves here. First match wins, so the first visit's rows
  // come before the second's.
  onStep: [
    stepTrigger({ x: 29, y: 4, ifAll: ["EVENT_GOT_POKEDEX"],
                  unless: ["EVENT_BEAT_BROCK", "EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE"], turnPlayer: "down",
                  script: route22Ambush(1, "ROUTE22_RIVAL1", "OPP_RIVAL1", 4, "EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE", 4) }),
    stepTrigger({ x: 29, y: 5, ifAll: ["EVENT_GOT_POKEDEX"],
                  unless: ["EVENT_BEAT_BROCK", "EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE"], turnPlayer: "left",
                  script: route22Ambush(1, "ROUTE22_RIVAL1", "OPP_RIVAL1", 4, "EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE", 5) }),
    stepTrigger({ x: 29, y: 4, ifAll: ["EVENT_BEAT_GIOVANNI"], unless: ["EVENT_BEAT_ROUTE22_RIVAL_2ND_BATTLE"],
                  turnPlayer: "down",
                  script: route22Ambush(2, "ROUTE22_RIVAL2", "OPP_RIVAL2", 10, "EVENT_BEAT_ROUTE22_RIVAL_2ND_BATTLE", 4) }),
    stepTrigger({ x: 29, y: 5, ifAll: ["EVENT_BEAT_GIOVANNI"], unless: ["EVENT_BEAT_ROUTE22_RIVAL_2ND_BATTLE"],
                  turnPlayer: "left",
                  script: route22Ambush(2, "ROUTE22_RIVAL2", "OPP_RIVAL2", 10, "EVENT_BEAT_ROUTE22_RIVAL_2ND_BATTLE", 5) }),
  ],
  onFace: [],
};

/**
 * Pokemon Tower 2F (scripts/PokemonTower2F.asm). The rival fights whether you
 * talk to him or walk past his tile; both run this one script. His exit walk
 * depends on which side you stood: the cartridge's EVENT_POKEMON_TOWER_RIVAL_
 * ON_LEFT is the player's facing here.
 */
const TOWER_RIVAL_SCRIPT: ScriptCommand[] = [
  { op: "face_player" },
  { op: "check_flag", flag: "EVENT_BEAT_POKEMON_TOWER_RIVAL" },
  { op: "jump_if_true", to: "beaten" },
  // PokemonTower2F.asm:30-35: the music changes the moment you land on his
  // cell, before he turns and before a word is said.
  { op: "stop_music" },
  { op: "play_music", track: "Music_MeetRival" },
  { op: "show_text", textId: "_PokemonTower2FRivalWhatBringsYouHereText" },
  { op: "call", routine: "rival_battle", argument: "OPP_RIVAL2#4" },
  { op: "check_battle_result" },
  { op: "jump_if_false", to: "end" },
  { op: "set_flag", flag: "EVENT_BEAT_POKEMON_TOWER_RIVAL" },
  { op: "show_text", textId: "_PokemonTower2FRivalDefeatedText" },
  { op: "show_text", textId: "_PokemonTower2FRivalHowsYourDexText" },
  // :84-87 -- the exit walk has its own cue (Music_RivalAlternateStart, which
  // this bundle does not carry; Route 22 makes the same substitution).
  { op: "stop_music" },
  { op: "play_music", track: "Music_MeetRival" },
  { op: "check_facing", direction: "left" },
  { op: "jump_if_true", to: "from_the_right" },
  { op: "move", npc: "POKEMONTOWER2F_RIVAL", path: ["right", "down", "down", "right", "down", "down", "right", "right"] },
  { op: "jump", to: "gone" },
  { op: "label", name: "from_the_right" },
  { op: "move", npc: "POKEMONTOWER2F_RIVAL", path: ["down", "down", "right", "right", "right", "right", "down", "down"] },
  { op: "label", name: "gone" },
  { op: "hide_object", map: "POKEMON_TOWER_2F", npc: "POKEMONTOWER2F_RIVAL" },
  { op: "play_default_music" },
  { op: "jump", to: "end" },
  { op: "label", name: "beaten" },
  { op: "show_text", textId: "_PokemonTower2FRivalHowsYourDexText" },
];

const POKEMON_TOWER_2F: MapScriptSet = {
  talk: { TEXT_POKEMONTOWER2F_RIVAL: TOWER_RIVAL_SCRIPT },
  onStep: [
    stepTrigger({ x: 15, y: 5, unless: ["EVENT_BEAT_POKEMON_TOWER_RIVAL"], turnPlayer: "left", talk: "TEXT_POKEMONTOWER2F_RIVAL" }),
    stepTrigger({ x: 14, y: 6, unless: ["EVENT_BEAT_POKEMON_TOWER_RIVAL"], turnPlayer: "up", talk: "TEXT_POKEMONTOWER2F_RIVAL" }),
  ],
  onFace: [],
};

/**
 * Mt Moon B2F: the Super Nerd guarding the fossils.
 *
 * He fights when you reach the cell beside him -- MtMoonB2FDefaultScript tests
 * wYCoord == 8 and wXCoord == 13 and displays his text -- and he has no `range`
 * in his header, so he is the rare trainer who does NOT engage on sight.
 *
 * His text script (MtMoonB2FSuperNerdText) branches THREE ways, and the header
 * alone can only say two of them:
 *
 *   not beaten          "They're both mine!"   -> the battle, then "I'll share"
 *   beaten, no fossil   "We'll each take one!"  <- this line is in no header
 *   beaten, got one     "There's a POKeMON LAB" -> the header's after-line
 *
 * The middle branch is why this is hand-written rather than left to
 * trainerTalkScript: without it he says the Cinnabar line while the fossils are
 * still lying there, which is the one thing he is standing there not to say.
 */
const MT_MOON_B2F: MapScriptSet = {
  talk: {
    TEXT_MTMOONB2F_SUPER_NERD: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_BEAT_MT_MOON_3_SUPER_NERD" },
      { op: "jump_if_false", to: "fight" },
      { op: "check_flag", flag: "EVENT_GOT_DOME_FOSSIL" },
      { op: "jump_if_true", to: "lab" },
      { op: "check_flag", flag: "EVENT_GOT_HELIX_FOSSIL" },
      { op: "jump_if_true", to: "lab" },
      { op: "show_text", textId: "_MtMoonB2fSuperNerdEachTakeOneText" },
      { op: "jump", to: "end" },
      { op: "label", name: "fight" },
      { op: "show_text", textId: "_MtMoonB2FSuperNerdTheyreBothMineText" },
      { op: "start_battle", trainer: "OPP_SUPER_NERD", party: 2 },
      { op: "check_battle_result" },
      { op: "jump_if_false", to: "end" },
      { op: "beat_trainer", map: "MT_MOON_B2F", npc: "MTMOONB2F_SUPER_NERD", flag: "EVENT_BEAT_MT_MOON_3_SUPER_NERD" },
      { op: "show_text", textId: "_MtMoonB2FSuperNerdOkIllShareText" },
      { op: "jump", to: "end" },
      { op: "label", name: "lab" },
      { op: "show_text", textId: "_MtMoonB2FSuperNerdTheresAPokemonLabText" },
    ] as ScriptCommand[],
  },
  onStep: [
    stepTrigger({ x: 13, y: 8, unless: ["EVENT_BEAT_MT_MOON_3_SUPER_NERD"], turnPlayer: "left", talk: "TEXT_MTMOONB2F_SUPER_NERD" }),
  ],
  onFace: [],
};

/**
 * Bill's house (scripts/BillsHouse.asm): Bill the Pokemon asks for help, walks
 * into the Teleporter (round the player if they stand in his way), the PC's
 * Cell Separator is armed, and using it brings Bill back out. The ticket
 * itself is his transcribed talk. The PC is one of the cartridge's hidden
 * events -- the bundle has no sign for it -- so it is a face trigger at (1,4).
 */
const BILLS_HOUSE: MapScriptSet = {
  talk: {
    /**
     * The ticket. Hand-written rather than left to the transcription for one
     * command: .SSTicketReceivedText is `text_far _SSTicketReceivedText /
     * sound_get_key_item / text_promptbutton`, so the key-item jingle rings
     * inside the box. The lens's text pipeline does not act on a control code
     * embedded in the words -- nothing under Assets/Scripts/rom reads one --
     * which is why every other gift in this project carries its sound as a
     * command of its own, and why this one has to as well.
     */
    TEXT_BILLSHOUSE_BILL_SS_TICKET: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_GOT_SS_TICKET" },
      { op: "jump_if_true", to: "instead" },
      { op: "show_text", textId: "_BillsHouseBillThankYouText" },
      { op: "give_item", item: "S_S_TICKET", count: 1, noRoom: "_SSTicketNoRoomText" },
      { op: "text_sound", name: "Get_Key_Item" },
      { op: "show_text", textId: "_SSTicketReceivedText" },
      { op: "set_flag", flag: "EVENT_GOT_SS_TICKET" },
      { op: "show_object", map: "CERULEAN_CITY", npc: "CERULEANCITY_GUARD1" },
      { op: "hide_object", map: "CERULEAN_CITY", npc: "CERULEANCITY_GUARD2" },
      { op: "label", name: "instead" },
      { op: "show_text", textId: "_BillsHouseBillWhyDontYouGoInsteadOfMeText" },
    ] as ScriptCommand[],
    TEXT_BILLSHOUSE_BILL_POKEMON: [
      { op: "face_player" },
      { op: "ask", textId: "_BillsHouseBillImNotAPokemonText" },
      { op: "jump_if_true", to: "machine" },
      { op: "show_text", textId: "_BillsHouseBillNoYouGottaHelpText" },
      { op: "label", name: "machine" },
      { op: "show_text", textId: "_BillsHouseBillUseSeparationSystemText" },
      { op: "check_facing", direction: "down" },
      { op: "jump_if_true", to: "around" },
      { op: "move", npc: "BILLSHOUSE_BILL_POKEMON", path: ["up", "up", "up"] },
      { op: "jump", to: "inside" },
      { op: "label", name: "around" },
      { op: "move", npc: "BILLSHOUSE_BILL_POKEMON", path: ["right", "up", "up", "left", "up"] },
      { op: "label", name: "inside" },
      { op: "hide_object", map: "BILLS_HOUSE", npc: "BILLSHOUSE_BILL_POKEMON" },
      { op: "set_flag", flag: "EVENT_BILL_SAID_USE_CELL_SEPARATOR" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [
    stepTrigger({ x: 1, y: 4, script: [
      // bills_house_pc.asm:3-5 returns at once unless the player is facing UP.
      // The hidden event itself matches the cell ahead from any side, so this
      // one test is what keeps the machine a thing you use from in front of it;
      // (0,4) and (1,3) are both standable.
      { op: "check_facing", direction: "up" },
      { op: "jump_if_false", to: "end" },
      { op: "check_flag", flag: "EVENT_LEFT_BILLS_HOUSE_AFTER_HELPING" },
      { op: "jump_if_true", to: "list" },
      { op: "check_flag", flag: "EVENT_USED_CELL_SEPARATOR_ON_BILL" },
      { op: "jump_if_true", to: "monitor" },
      { op: "check_flag", flag: "EVENT_BILL_SAID_USE_CELL_SEPARATOR" },
      { op: "jump_if_false", to: "monitor" },
      { op: "show_text", textId: "_BillsHouseInitiatedText" },
      // The machine runs in SILENCE. BillsHouseInitiatedText's own asm plays
      // SFX_STOP_ALL_MUSIC, waits 16, rings the switch and waits 60 more; the
      // routine then counts 32 / 80 / 48 / 32 between its four sounds and ends
      // with PlayDefaultMusic, and only THEN sets the flag. Frames here are the
      // cartridge's own, which is what the lens's clock now counts.
      { op: "stop_music" },
      { op: "wait", frames: 16 },
      { op: "text_sound", name: "Switch" },
      { op: "wait", frames: 60 },
      { op: "wait", frames: 32 },
      { op: "text_sound", name: "Tink" },
      { op: "wait", frames: 80 },
      { op: "text_sound", name: "Shrink" },
      { op: "wait", frames: 48 },
      { op: "text_sound", name: "Tink" },
      { op: "wait", frames: 32 },
      { op: "text_sound", name: "Get_Item1" },
      { op: "play_default_music" },
      { op: "set_flag", flag: "EVENT_USED_CELL_SEPARATOR_ON_BILL" },
      // He comes OUT of the machine: BillsHouse.asm:67-80 writes his sprite to
      // map (5,6) -- the object list's own +4, so tile (1,2), the left pod --
      // before showing him. Shown on his shipped cell he appeared in the middle
      // of the room and walked away from the teleporter he had just left.
      { op: "place_npc", npc: "BILLSHOUSE_BILL1", x: 1, y: 2, facing: "down" },
      { op: "show_object", map: "BILLS_HOUSE", npc: "BILLSHOUSE_BILL1" },
      { op: "move", npc: "BILLSHOUSE_BILL1", path: ["down", "right", "right", "right", "down"] },
      { op: "set_flag", flag: "EVENT_MET_BILL" },
      { op: "set_flag", flag: "EVENT_MET_BILL_2" },
      { op: "jump", to: "end" },
      { op: "label", name: "monitor" },
      { op: "show_text", textId: "_BillsHouseMonitorText" },
      { op: "jump", to: "end" },
      { op: "label", name: "list" },
      { op: "show_text", textId: "_BillsHousePokemonListText1" },
      // "Which POKeMON do you want to see?" over EEVEE and its three
      // evolutions, each pick a Pokedex page, until CANCEL (Keepers.ts).
      { op: "call", routine: ROUTINE_BILLS_LIST, argument: "" },
    ] }),
  ],
};

/**
 * Vermilion City's dock (scripts/VermilionCity.asm): the sailor beside the
 * gangway asks for the S.S. TICKET as you pass the cell in front of him.
 * Without it you are walked back a step; with it the dock warp below is one
 * step on. Once the ship has sailed, the same cell says so and walks you back.
 */
const VERMILION_CITY: MapScriptSet = {
  talk: {
    TEXT_VERMILIONCITY_SAILOR1: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_SS_ANNE_LEFT" },
      { op: "jump_if_true", to: "sailed" },
      // VermilionCity.asm:162-171 and :195-198. The ticket question belongs to
      // ONE cell: (20,30), from the sailor's right. Facing him from above
      // (19,29) or below (19,31) -- inFrontOfOrBehindGuardCoords -- or walking
      // into him from the left gets the welcome and nothing else. An adjacent
      // talk IS the cell, so the three facings say where the player stands.
      { op: "check_facing", direction: "right" },
      { op: "jump_if_true", to: "welcome" },
      { op: "check_facing", direction: "down" },
      { op: "jump_if_true", to: "welcome" },
      { op: "check_facing", direction: "up" },
      { op: "jump_if_true", to: "welcome" },
      { op: "show_text", textId: "_VermilionCitySailor1DoYouHaveATicketText" },
      { op: "check_item", item: "S_S_TICKET" },
      { op: "jump_if_false", to: "need" },
      { op: "show_text", textId: "_VermilionCitySailor1FlashedTicketText" },
      { op: "jump", to: "end" },
      { op: "label", name: "need" },
      { op: "show_text", textId: "_VermilionCitySailor1YouNeedATicketText" },
      { op: "jump", to: "end" },
      { op: "label", name: "welcome" },
      { op: "show_text", textId: "_VermilionCitySailor1WelcomeToSSAnneText" },
      { op: "jump", to: "end" },
      { op: "label", name: "sailed" },
      { op: "show_text", textId: "_VermilionCitySailor1ShipSetSailText" },
    ] as ScriptCommand[],
  },
  onStep: [
    // VermilionCityDefaultScript returns unless the player faces DOWN
    // (:42-44) BEFORE it tests the cell, so the ticket is asked for on the way
    // TO the ship and never on the way back from it.
    stepTrigger({ x: 18, y: 30, script: [
      { op: "check_facing", direction: "down" },
      { op: "jump_if_false", to: "end" },
      { op: "check_flag", flag: "EVENT_SS_ANNE_LEFT" },
      { op: "jump_if_true", to: "sailed" },
      { op: "show_text", textId: "_VermilionCitySailor1DoYouHaveATicketText" },
      { op: "check_item", item: "S_S_TICKET" },
      { op: "jump_if_false", to: "need" },
      { op: "show_text", textId: "_VermilionCitySailor1FlashedTicketText" },
      { op: "jump", to: "end" },
      { op: "label", name: "need" },
      { op: "show_text", textId: "_VermilionCitySailor1YouNeedATicketText" },
      { op: "move_player", direction: "up", steps: 1 },
      { op: "jump", to: "end" },
      { op: "label", name: "sailed" },
      { op: "show_text", textId: "_VermilionCitySailor1ShipSetSailText" },
      { op: "move_player", direction: "up", steps: 1 },
    ] }),
  ],
  onFace: [],
};

const VIRIDIAN_CITY_TALK: any = {
  // ViridianCity.asm:206-224. She apologises for her grandfather until the
  // POKeDEX is yours, and talks about the forest road afterwards.
  TEXT_VIRIDIANCITY_GIRL: [
    { op: "face_player" },
    { op: "check_flag", flag: "EVENT_GOT_POKEDEX" },
    { op: "jump_if_true", to: "shopping" },
    { op: "show_text", textId: "_ViridianCityGirlHasntHadHisCoffeeYetText" },
    { op: "jump", to: "end" },
    { op: "label", name: "shopping" },
    { op: "show_text", textId: "_ViridianCityGirlWhenIGoShopText" },
  ] as ScriptCommand[],
  // ViridianCity.asm:243-260. "This GYM is always closed" until GIOVANNI is
  // beaten -- or until the seven other badges are in, which the cartridge
  // spells as wObtainedBadges == ~(1 << BIT_EARTHBADGE) and which reaches the
  // same line. An AND chain, because the VM has no AND of its own.
  TEXT_VIRIDIANCITY_GAMBLER1: [
    { op: "face_player" },
    { op: "check_flag", flag: "EVENT_BEAT_VIRIDIAN_GYM_GIOVANNI" },
    { op: "jump_if_true", to: "returned" },
    { op: "check_item", item: "BOULDERBADGE" },
    { op: "jump_if_false", to: "closed" },
    { op: "check_item", item: "CASCADEBADGE" },
    { op: "jump_if_false", to: "closed" },
    { op: "check_item", item: "THUNDERBADGE" },
    { op: "jump_if_false", to: "closed" },
    { op: "check_item", item: "RAINBOWBADGE" },
    { op: "jump_if_false", to: "closed" },
    { op: "check_item", item: "SOULBADGE" },
    { op: "jump_if_false", to: "closed" },
    { op: "check_item", item: "MARSHBADGE" },
    { op: "jump_if_false", to: "closed" },
    { op: "check_item", item: "VOLCANOBADGE" },
    { op: "jump_if_false", to: "closed" },
    { op: "label", name: "returned" },
    { op: "show_text", textId: "_ViridianCityGambler1GymLeaderReturnedText" },
    { op: "jump", to: "end" },
    { op: "label", name: "closed" },
    { op: "show_text", textId: "_ViridianCityGambler1GymAlwaysClosedText" },
  ] as ScriptCommand[],
  // ViridianCity.asm:262-284: a question, and the answer decides.
  TEXT_VIRIDIANCITY_YOUNGSTER2: [
    { op: "face_player" },
    { op: "ask", textId: "_ViridianCityYoungster2YouWantToKnowAboutText" },
    { op: "jump_if_false", to: "no" },
    { op: "show_text", textId: "ViridianCityYoungster2CaterpieAndWeedleDescriptionText" },
    { op: "jump", to: "end" },
    { op: "label", name: "no" },
    { op: "show_text", textId: "ViridianCityYoungster2OkThenText" },
  ] as ScriptCommand[],
};

/**
 * The woman failing to train her SLOWBRO (CeruleanCity.asm:283-307).
 *
 * One draw of hRandomAdd, compared twice: 76 of 256 casts get SONICBOOM,
 * 80 get the punch, the remaining 100 the withdraw. Two draws would give
 * different odds.
 */
const CERULEAN_CITY_TALK: any = {
  TEXT_CERULEANCITY_COOLTRAINER_F1: [
    { op: "face_player" },
    { op: "random_byte" },
    { op: "check_byte", atLeast: 180 },
    { op: "jump_if_true", to: "sonicboom" },
    { op: "check_byte", atLeast: 100 },
    { op: "jump_if_true", to: "punch" },
    { op: "show_text", textId: "_CeruleanCityCooltrainerF1SlowbroWithdrawText" },
    { op: "jump", to: "end" },
    { op: "label", name: "sonicboom" },
    { op: "show_text", textId: "_CeruleanCityCooltrainerF1SlowbroUseSonicboomText" },
    { op: "jump", to: "end" },
    { op: "label", name: "punch" },
    { op: "show_text", textId: "_CeruleanCityCooltrainerF1SlowbroPunchText" },
  ] as ScriptCommand[],
};

/**
 * Cerulean City (scripts/CeruleanCity.asm): the rival on the way to Nugget
 * Bridge, and the Rocket who robbed the house and gives TM28 back when beaten
 * -- then the guards swap and he is gone behind a fade.
 */
function ceruleanRivalScene(playerX: number): ScriptCommand[] {
  const exit = playerX === 20
    ? ["right", "down", "down", "down", "down", "down", "down"]
    : ["left", "down", "down", "down", "down", "down", "down"];
  return [
    // The music first, before anything is drawn: CeruleanCity.asm:76-78 plays
    // MUSIC_MEET_RIVAL at the top of the coordinate event, so he arrives to it
    // rather than leaving to it.
    { op: "play_music", track: "Music_MeetRival" },
    // He ships at (20,2) and the cartridge moves the STILL-HIDDEN sprite into
    // the player's column when the player is not in his (:83-91, writing
    // SPRITESTATEDATA2_MAPX, which is x+4), then shows him, then walks him
    // three plain steps down (CeruleanCityMovement1). Placing him before the
    // show is what keeps him out of column 20 for a frame; move_npc_to walked
    // an L-shape out of his shipped cell, in full view, in four steps.
    { op: "place_npc", npc: "CERULEANCITY_RIVAL", x: playerX, y: 2, facing: "down" },
    { op: "show_object", map: "CERULEAN_CITY", npc: "CERULEANCITY_RIVAL" },
    { op: "move", npc: "CERULEANCITY_RIVAL", path: ["down", "down", "down"] },
    { op: "face_object", npc: "CERULEANCITY_RIVAL", direction: "down" },
    { op: "show_text", textId: "_CeruleanCityRivalPreBattleText" },
    { op: "call", routine: "rival_battle", argument: "OPP_RIVAL1#7" },
    { op: "check_battle_result" },
    // A lost fight puts the scene back as it shipped: CeruleanCityRivalDefeated
    // begins `cp LOST_BATTLE / jp z, CeruleanCityClearScripts`, and that hides
    // TOGGLE_CERULEAN_RIVAL (:7-13). Without it BLUE stayed drawn on the bridge
    // with the flag still unset, and the trigger ran the whole scene again with
    // him already standing there.
    { op: "jump_if_false", to: "lost" },
    { op: "set_flag", flag: "EVENT_BEAT_CERULEAN_RIVAL" },
    { op: "show_text", textId: "_CeruleanCityRivalDefeatedText" },
    { op: "show_text", textId: "_CeruleanCityRivalIWentToBillsText" },
    { op: "play_music", track: "Music_MeetRival" },
    { op: "move", npc: "CERULEANCITY_RIVAL", path: exit },
    { op: "play_default_music" },
    { op: "hide_object", map: "CERULEAN_CITY", npc: "CERULEANCITY_RIVAL" },
    { op: "jump", to: "end" },
    { op: "label", name: "lost" },
    { op: "play_default_music" },
    { op: "hide_object", map: "CERULEAN_CITY", npc: "CERULEANCITY_RIVAL" },
  ];
}

const CERULEAN_ROCKET: ScriptCommand[] = [
  { op: "face_player" },
  { op: "check_flag", flag: "EVENT_GOT_TM28" },
  { op: "jump_if_true", to: "leave" },
  { op: "check_flag", flag: "EVENT_BEAT_CERULEAN_ROCKET_THIEF" },
  { op: "jump_if_true", to: "return_tm" },
  { op: "show_text", textId: "_CeruleanCityRocketText" },
  { op: "start_battle", trainer: "OPP_ROCKET", party: 5 },
  { op: "check_battle_result" },
  { op: "jump_if_false", to: "end" },
  { op: "show_text", textId: "_CeruleanCityRocketIGiveUpText" },
  { op: "label", name: "return_tm" },
  { op: "show_text", textId: "_CeruleanCityRocketIllReturnTheTMText" },
  { op: "set_flag", flag: "EVENT_BEAT_CERULEAN_ROCKET_THIEF" },
  { op: "give_item", item: "TM_DIG", count: 1, noRoom: "_CeruleanCityRocketTM28NoRoomText" },
  { op: "set_flag", flag: "EVENT_GOT_TM28" },
  { op: "show_text", textId: "_CeruleanCityRocketReceivedTM28Text" },
  { op: "show_text", textId: "_CeruleanCityRocketIBetterGetMovingText" },
  { op: "label", name: "leave" },
  { op: "fade", direction: "out", colour: "black" },
  { op: "show_object", map: "CERULEAN_CITY", npc: "CERULEANCITY_GUARD1" },
  { op: "hide_object", map: "CERULEAN_CITY", npc: "CERULEANCITY_GUARD2" },
  { op: "hide_object", map: "CERULEAN_CITY", npc: "CERULEANCITY_ROCKET" },
  { op: "fade", direction: "in", colour: "black" },
];

const CERULEAN_CITY: MapScriptSet = {
  talk: {
    TEXT_CERULEANCITY_ROCKET: CERULEAN_ROCKET,
    TEXT_CERULEANCITY_COOLTRAINER_F1: CERULEAN_CITY_TALK.TEXT_CERULEANCITY_COOLTRAINER_F1,
  },
  onStep: [
    stepTrigger({ x: 30, y: 7, unless: ["EVENT_BEAT_CERULEAN_ROCKET_THIEF"], turnPlayer: "down", talk: "TEXT_CERULEANCITY_ROCKET" }),
    stepTrigger({ x: 30, y: 9, unless: ["EVENT_BEAT_CERULEAN_ROCKET_THIEF"], turnPlayer: "up", talk: "TEXT_CERULEANCITY_ROCKET" }),
    stepTrigger({ x: 20, y: 6, unless: ["EVENT_BEAT_CERULEAN_RIVAL"], turnPlayer: "up", script: ceruleanRivalScene(20) }),
    stepTrigger({ x: 21, y: 6, unless: ["EVENT_BEAT_CERULEAN_RIVAL"], turnPlayer: "up", script: ceruleanRivalScene(21) }),
  ],
  onFace: [],
};

/**
 * The S.S. Anne's captain (scripts/SSAnneCaptainsRoom.asm): seasick, rubbed
 * better, and HM01 CUT in thanks.
 *
 * Hand-written because the reference moved the rub's music into a helper the
 * transcriber cannot read, and a transcription without it silently lost the
 * jingle. Read against the cartridge:
 *
 *   * He never turns to face you during the rub: the map script keeps
 *     BIT_NO_NPC_FACE_PLAYER set until EVENT_RUBBED_CAPTAINS_BACK, so there is
 *     no face_player on that path. Later talks turn him as usual.
 *   * The rub text's own asm stops the music, plays MUSIC_PKMN_HEALED to its
 *     end, brings the default music back and only THEN sets the flag -- so
 *     the flag is set even when the bag turns out to be full a line later.
 *   * A full bag gets his own no-room line and stops; EVENT_GOT_HM01 stays
 *     unset, and the next talk is the whole rub again, jingle and all. That is
 *     the cartridge's retry, not an omission.
 *   * The received line rings sound_get_key_item inside the box.
 */
const SS_ANNE_CAPTAINS_ROOM: MapScriptSet = {
  talk: {
    TEXT_SSANNECAPTAINSROOM_CAPTAIN: [
      { op: "check_flag", flag: "EVENT_GOT_HM01" },
      { op: "jump_if_true", to: "well" },
      { op: "show_text", textId: "_SSAnneCaptainsRoomRubCaptainsBackText" },
      { op: "stop_music" },
      { op: "play_once", track: "Music_PkmnHealed" },
      { op: "play_default_music" },
      { op: "set_flag", flag: "EVENT_RUBBED_CAPTAINS_BACK" },
      { op: "show_text", textId: "_SSAnneCaptainsRoomCaptainIFeelMuchBetterText" },
      { op: "give_item", item: "HM_CUT", count: 1, noRoom: "_SSAnneCaptainsRoomCaptainHM01NoRoomText" },
      { op: "text_sound", name: "Get_Key_Item" },
      { op: "show_text", textId: "_SSAnneCaptainsRoomCaptainReceivedHM01Text", ramItem: "HM_CUT" },
      { op: "set_flag", flag: "EVENT_GOT_HM01" },
      { op: "jump", to: "end" },
      { op: "label", name: "well" },
      { op: "face_player" },
      { op: "show_text", textId: "_SSAnneCaptainsRoomCaptainNotSickAnymoreText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * The Magikarp salesman in the Mt Moon Pokemon Center
 * (scripts/MtMoonPokecenter.asm:24-70).
 *
 * Hand-written for the same reason as the captain: the reference wraps his
 * question in a money-box option the transcriber cannot read, and rather than
 * drop that row and pretend, the whole script is here against the cartridge.
 * Three things the old transcription had wrong, all measured off the asm:
 *
 *   * He faces you. He is a WALK pacer, and MakeNPCFacePlayer runs for every
 *     spoken-to NPC; the old port opened on check_flag and he kept pacing.
 *   * GivePokemon prints BoxIsFullText ITSELF on failure and the script jumps
 *     straight to .done -- the host does the same -- so a second show_text of
 *     that line printed it twice.
 *   * No jingle. The success path subtracts the money and sets the flag; the
 *     only sound is whatever the money box makes, which the lens does not draw.
 *
 * The money box over the question (MONEY_BOX) is not modelled; the price is in
 * his words.
 */
const MT_MOON_POKECENTER: MapScriptSet = {
  talk: {
    TEXT_MTMOONPOKECENTER_MAGIKARP_SALESMAN: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_BOUGHT_MAGIKARP" },
      { op: "jump_if_true", to: "no_refunds" },
      { op: "ask", textId: "_MtMoonPokecenterMagikarpSalesmanIGotADealText" },
      { op: "jump_if_false", to: "declined" },
      { op: "check_money", amount: 500 },
      { op: "jump_if_false", to: "no_money" },
      // GivePokemon: party, else the box, else its own "no room" line and no
      // sale -- the host prints that line, and the script stops here.
      { op: "give_pokemon", species: "MAGIKARP", level: 5 },
      { op: "jump_if_false", to: "end" },
      { op: "take_money", amount: 500 },
      { op: "set_flag", flag: "EVENT_BOUGHT_MAGIKARP" },
      { op: "jump", to: "end" },
      { op: "label", name: "declined" },
      { op: "show_text", textId: "_MtMoonPokecenterMagikarpSalesmanNoText" },
      { op: "jump", to: "end" },
      { op: "label", name: "no_money" },
      { op: "show_text", textId: "_MtMoonPokecenterMagikarpSalesmanNoMoneyText" },
      { op: "jump", to: "end" },
      { op: "label", name: "no_refunds" },
      { op: "show_text", textId: "_MtMoonPokecenterMagikarpSalesmanNoRefundsText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * The rival on the S.S. Anne's second deck (scripts/SSAnne2F.asm).
 *
 * Two trigger cells at the top of the corridor, (36,8) and (37,8), and the
 * scene differs by which one you are on -- PlayerCoordinatesArray's index
 * picks his approach and SSAnne2FSetFacingDirectionScript picks the facings:
 *
 *   on (36,8)  he walks down THREE from his shipped (36,4) and stands above
 *              you at (36,7), facing down; you keep facing as you were
 *   on (37,8)  he walks down FOUR to (36,8), beside you; you are turned to
 *              face LEFT and he faces RIGHT
 *
 * The music stops and MUSIC_MEET_RIVAL plays before he is shown. He fights
 * OPP_RIVAL2 with the roster his starter decides (rival_battle picks it the
 * same way every rival script does). Beaten, he says the cut master was
 * seasick and leaves: down four from beside you, or RIGHT and then down five
 * around you when he was standing above; Music_RivalAlternateStart plays him
 * out -- the bundle has it as no separate track, so it is Music_MeetRival
 * here as it is in Cerulean -- and SSAnne2FRivalExitScript hides him and
 * brings the ship's music back.
 *
 * A LOST battle only resets the map script: he is not hidden again, unlike
 * Cerulean's, and the cell fires the whole scene once more. The reference's
 * port carries the end-battle line with save_end_battle_text, which is why the
 * transcriber skips it; the line is shown after the battle here, as every
 * rival port in this file shows it.
 */
function ssAnneRivalScene(playerX: number): ScriptCommand[] {
  const beside = playerX === 37;
  const approach = beside ? ["down", "down", "down", "down"] : ["down", "down", "down"];
  const facing: ScriptCommand[] = beside
    ? [{ op: "face_player_dir", direction: "left" },
       { op: "face", npc: "SSANNE2F_RIVAL", direction: "right" }]
    : [{ op: "face", npc: "SSANNE2F_RIVAL", direction: "down" }];
  const exit = beside
    ? ["down", "down", "down", "down"]
    : ["right", "down", "down", "down", "down", "down"];
  return ([
    { op: "stop_music" },
    { op: "play_music", track: "Music_MeetRival" },
    { op: "show_object", map: "SS_ANNE_2F", npc: "SSANNE2F_RIVAL" },
    { op: "move", npc: "SSANNE2F_RIVAL", path: approach },
  ] as ScriptCommand[]).concat(facing).concat([
    { op: "show_text", textId: "_SSAnne2FRivalText" },
    { op: "call", routine: "rival_battle", argument: "OPP_RIVAL2#1" },
    { op: "check_battle_result" },
    { op: "jump_if_false", to: "end" },
    { op: "set_flag", flag: "EVENT_BEAT_SS_ANNE_RIVAL" },
    { op: "show_text", textId: "_SSAnne2FRivalDefeatedText" },
  ] as ScriptCommand[]).concat(facing).concat([
    { op: "show_text", textId: "_SSAnne2FRivalCutMasterText" },
    { op: "stop_music" },
    { op: "play_music", track: "Music_MeetRival" },
    { op: "move", npc: "SSANNE2F_RIVAL", path: exit },
    { op: "hide_object", map: "SS_ANNE_2F", npc: "SSANNE2F_RIVAL" },
    { op: "play_default_music" },
  ] as ScriptCommand[]);
}

const SS_ANNE_2F: MapScriptSet = {
  talk: {
    // Spoken to directly -- only possible after a lost battle has left him
    // standing -- he fights from where he is, the reference's own shape.
    TEXT_SSANNE2F_RIVAL: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_BEAT_SS_ANNE_RIVAL" },
      { op: "jump_if_true", to: "end" },
      { op: "show_text", textId: "_SSAnne2FRivalText" },
      { op: "call", routine: "rival_battle", argument: "OPP_RIVAL2#1" },
      { op: "check_battle_result" },
      { op: "jump_if_false", to: "end" },
      { op: "set_flag", flag: "EVENT_BEAT_SS_ANNE_RIVAL" },
      { op: "show_text", textId: "_SSAnne2FRivalDefeatedText" },
      { op: "show_text", textId: "_SSAnne2FRivalCutMasterText" },
      { op: "hide_object", map: "SS_ANNE_2F", npc: "SSANNE2F_RIVAL" },
    ] as ScriptCommand[],
  },
  onStep: [
    stepTrigger({ x: 36, y: 8, unless: ["EVENT_BEAT_SS_ANNE_RIVAL"], script: ssAnneRivalScene(36) }),
    stepTrigger({ x: 37, y: 8, unless: ["EVENT_BEAT_SS_ANNE_RIVAL"], script: ssAnneRivalScene(37) }),
  ],
  onFace: [],
};

/**
 * Cerulean's bike shop (scripts/BikeShop.asm).
 *
 * Three states, and the middle one is the only way a BICYCLE ever exists:
 *
 *   got the bike       "How do you like your new BICYCLE?"
 *   voucher in the bag "Oh, that's... A BIKE VOUCHER!", and the swap
 *   neither           the welcome, the price, and no sale
 *
 * The voucher comes from the Pokemon Fan Club in Vermilion, a milestone later;
 * the shop is here, and without this script the voucher could never become
 * anything. The swap is a real exchange: the bicycle in, the voucher out.
 *
 * The no-voucher branch draws a two-line menu -- BICYCLE / CANCEL with a price
 * of a million -- and every path out of it ends the same way, "Sorry! You can't
 * afford it!" for the bicycle and "Come back again some time!" either way. The
 * lens has no list menu, so the question is asked as the yes/no it effectively
 * is, and both answers land where the cartridge lands.
 */
const BIKE_SHOP: MapScriptSet = {
  talk: {
    TEXT_BIKESHOP_CLERK: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_GOT_BICYCLE" },
      { op: "jump_if_true", to: "has_bike" },
      { op: "check_item", item: "BIKE_VOUCHER" },
      { op: "jump_if_false", to: "no_voucher" },
      { op: "show_text", textId: "_BikeShopClerkOhThatsAVoucherText" },
      { op: "give_item", item: "BICYCLE", count: 1, noRoom: "_BikeShopBagFullText" },
      { op: "take_item", item: "BIKE_VOUCHER", count: 1 },
      { op: "set_flag", flag: "EVENT_GOT_BICYCLE" },
      { op: "show_text", textId: "_BikeShopExchangedVoucherText" },
      { op: "text_sound", name: "Get_Key_Item" },
      { op: "jump", to: "end" },
      { op: "label", name: "has_bike" },
      { op: "show_text", textId: "_BikeShopClerkHowDoYouLikeYourBicycleText" },
      { op: "jump", to: "end" },
      { op: "label", name: "no_voucher" },
      { op: "show_text", textId: "_BikeShopClerkWelcomeText" },
      { op: "ask", textId: "_BikeShopClerkDoYouLikeItText" },
      { op: "jump_if_false", to: "come_again" },
      { op: "show_text", textId: "_BikeShopCantAffordText" },
      { op: "label", name: "come_again" },
      { op: "show_text", textId: "_BikeShopComeAgainText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  // The six bicycles drawn into the tilemap (data/events/hidden_events.asm
  // :542-548, PrintNewBikeText). No facing: the argument byte is there, and
  // engine/events/hidden_events/new_bike.asm never reads it.
  onFace: [
    stepTrigger({ x: 1, y: 0, script: [{ op: "show_text", textId: "_NewBicycleText" }] }),
    stepTrigger({ x: 2, y: 1, script: [{ op: "show_text", textId: "_NewBicycleText" }] }),
    stepTrigger({ x: 1, y: 2, script: [{ op: "show_text", textId: "_NewBicycleText" }] }),
    stepTrigger({ x: 3, y: 2, script: [{ op: "show_text", textId: "_NewBicycleText" }] }),
    stepTrigger({ x: 0, y: 4, script: [{ op: "show_text", textId: "_NewBicycleText" }] }),
    stepTrigger({ x: 1, y: 5, script: [{ op: "show_text", textId: "_NewBicycleText" }] }),
  ],
};

/**
 * The Pewter museum's front desk (scripts/Museum1F.asm).
 *
 * The only door in Kanto that charges money. Museum1FDefaultScript watches the
 * two cells in front of the counter, (9,4) and (10,4), and displays the
 * scientist's text; his text is a four-way branch on where the player is
 * standing, which is why it is one script rather than a coordinate event and a
 * talk:
 *
 *   behind the counter, (13,4) or (12,3)   the AMBER question, yes or no
 *   on row 4, ticket already bought        "Take plenty of time to look!"
 *   on row 4, no ticket                    Y50, and a step back if you refuse
 *   anywhere else                          "Please go to the other side!"
 *
 * The ticket is good for ONE visit: Pewter City's own default script resets
 * EVENT_BOUGHT_MUSEUM_TICKET (see PEWTER_CITY's onEnter), so stepping outside
 * and coming back costs another Y50. The cartridge also parks the map script
 * in a NOOP after a sale so the trigger stops firing while the player walks
 * through; the flag on `unless` does the same job here.
 *
 * The money box that goes up over the question is not modelled: the lens has
 * no such window, and the price is in the words themselves.
 */
/**
 * The desk's own business: Y50, a thank-you, or a step back out of the way.
 *
 * Reached two ways, as on the cartridge: by standing on the two cells in front
 * of the counter (Museum1FDefaultScript's coordinate test), and by talking to
 * him from row 4, which is the .check_ticket branch of his text.
 */
const MUSEUM_SALE: ScriptCommand[] = [
  { op: "check_flag", flag: "EVENT_BOUGHT_MUSEUM_TICKET" },
  { op: "jump_if_true", to: "enjoy" },
  { op: "ask", textId: "_Museum1FScientist1WouldYouLikeToComeInText" },
  { op: "jump_if_false", to: "refused" },
  { op: "check_money", amount: 50 },
  { op: "jump_if_false", to: "poor" },
  { op: "show_text", textId: "_Museum1FScientist1ThankYouText" },
  { op: "set_flag", flag: "EVENT_BOUGHT_MUSEUM_TICKET" },
  { op: "take_money", amount: 50 },
  { op: "text_sound", name: "Purchase" },
  { op: "jump", to: "end" },
  { op: "label", name: "poor" },
  { op: "show_text", textId: "_Museum1FScientist1DontHaveEnoughMoneyText" },
  { op: "label", name: "refused" },
  { op: "show_text", textId: "_Museum1FScientist1ComeAgainText" },
  // The cartridge presses DOWN for the player (a simulated joypad state), so a
  // refusal steps them off the trigger cell rather than leaving them on it to
  // be asked again on the next frame.
  { op: "move_player", direction: "down", steps: 1 },
  { op: "jump", to: "end" },
  { op: "label", name: "enjoy" },
  { op: "show_text", textId: "_Museum1FScientist1TakePlentyOfTimeText" },
];

/**
 * Talking to the man at the desk, from wherever the player is standing.
 *
 * The cartridge branches on the cell (Museum1F.asm:43-57): (13,4) or (12,3) is
 * BEHIND the counter and gets the amber question, row 4 gets the sale, and
 * anything else is sent round to the front. He stands at (12,4) and every one
 * of those cells is reached by facing him from a different side, so the same
 * three answers come out of check_facing -- and the check is the player's
 * facing, which is what tells the two sides of a counter apart.
 */
const MUSEUM_DESK_TALK: ScriptCommand[] = ([
  { op: "face_player" },
  { op: "check_facing", direction: "right" },
  { op: "jump_if_true", to: "sale" },
  { op: "check_facing", direction: "up" },
  { op: "jump_if_true", to: "side" },
  // Left or down: behind the counter, where he gives up on the ticket.
  { op: "ask", textId: "_Museum1FScientist1DoYouKnowWhatAmberIsText" },
  { op: "jump_if_false", to: "explain" },
  { op: "show_text", textId: "_Museum1FScientist1TheresALabSomewhereText" },
  { op: "jump", to: "end" },
  { op: "label", name: "explain" },
  { op: "show_text", textId: "_Museum1FScientist1AmberIsFossilizedTreeSapText" },
  { op: "jump", to: "end" },
  { op: "label", name: "side" },
  { op: "show_text", textId: "_Museum1FScientist1GoToOtherSideText" },
  { op: "jump", to: "end" },
  { op: "label", name: "sale" },
] as ScriptCommand[]).concat(MUSEUM_SALE);

const MUSEUM_1F: MapScriptSet = {
  talk: {
    TEXT_MUSEUM1F_SCIENTIST1: MUSEUM_DESK_TALK,
    // Museum1FScientist2Text: the OLD AMBER, handed over once, and the exhibit
    // taken off the shelf with it. A full bag keeps both, and he asks again.
    TEXT_MUSEUM1F_SCIENTIST2: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_GOT_OLD_AMBER" },
      { op: "jump_if_true", to: "check" },
      { op: "show_text", textId: "_Museum1FScientist2TakeThisToAPokemonLabText" },
      { op: "give_item", item: "OLD_AMBER", count: 1, noRoom: "_Museum1FScientist2YouDontHaveSpaceText" },
      { op: "set_flag", flag: "EVENT_GOT_OLD_AMBER" },
      { op: "hide_object", map: "MUSEUM_1F", npc: "MUSEUM1F_OLD_AMBER" },
      { op: "text_sound", name: "Get_Item1" },
      { op: "show_text", textId: "_Museum1FScientist2ReceivedOldAmberText" },
      { op: "jump", to: "end" },
      { op: "label", name: "check" },
      { op: "show_text", textId: "_Museum1FScientist2GetTheOldAmberCheckText" },
    ] as ScriptCommand[],
  },
  // Museum1FDefaultScript watches (9,4) and (10,4) and shows his text with the
  // player still facing the way they walked in -- so the trigger runs the SALE
  // rather than the facing branch, which would read a northward walk as
  // somebody standing on the wrong side of the room.
  onStep: [
    stepTrigger({ x: 9, y: 4, unless: ["EVENT_BOUGHT_MUSEUM_TICKET"], script: MUSEUM_SALE }),
    stepTrigger({ x: 10, y: 4, unless: ["EVENT_BOUGHT_MUSEUM_TICKET"], script: MUSEUM_SALE }),
  ],
  onFace: [],
};

/**
 * Route 25 (Route25ToggleBillsScript): the road to Bill's house puts the house
 * back the way the quest needs it, every time it is loaded.
 *
 * Three states, in the cartridge's order:
 *
 *   already left after helping  -- nothing, ever again
 *   Bill not yet met            -- the monster is put BACK on the floor and
 *                                  the cell separator is disarmed, so walking
 *                                  out halfway does not strand the player in
 *                                  an empty house with an armed machine
 *   met, and the ticket in hand -- Bill becomes his standing self, the
 *                                  Nugget Bridge Rocket is taken off Route 24,
 *                                  and it is marked done
 *
 * That last one hides an object on ANOTHER map, which is why this is a script
 * rather than a flag table: hide_object carries the map it means.
 */
const ROUTE_25: MapScriptSet = {
  talk: {},
  onStep: [],
  onFace: [],
  onEnter: [
    { op: "check_flag", flag: "EVENT_LEFT_BILLS_HOUSE_AFTER_HELPING" },
    { op: "jump_if_true", to: "end" },
    { op: "check_flag", flag: "EVENT_MET_BILL_2" },
    { op: "jump_if_true", to: "met" },
    { op: "clear_flag", flag: "EVENT_BILL_SAID_USE_CELL_SEPARATOR" },
    { op: "show_object", map: "BILLS_HOUSE", npc: "BILLSHOUSE_BILL_POKEMON" },
    { op: "jump", to: "end" },
    { op: "label", name: "met" },
    { op: "check_flag", flag: "EVENT_GOT_SS_TICKET" },
    { op: "jump_if_false", to: "end" },
    { op: "set_flag", flag: "EVENT_LEFT_BILLS_HOUSE_AFTER_HELPING" },
    { op: "hide_object", map: "ROUTE_24", npc: "ROUTE24_COOLTRAINER_M1" },
    { op: "hide_object", map: "BILLS_HOUSE", npc: "BILLSHOUSE_BILL1" },
    { op: "show_object", map: "BILLS_HOUSE", npc: "BILLSHOUSE_BILL2" },
  ] as ScriptCommand[],
};

/**
 * Nugget Bridge's recruiter (scripts/Route24.asm): the prize, the pitch, the
 * battle. He has no trainer header; the cell in front of him forces the talk.
 */
const ROUTE_24: MapScriptSet = {
  talk: {
    TEXT_ROUTE24_COOLTRAINER_M1: [
      { op: "face_player" },
      // `CheckEvent EVENT_GOT_NUGGET / jr nz, .got_item` jumps past everything
      // -- the prize, the pitch and the battle -- to the last line. It used to
      // jump into the middle instead, which re-offered the fight to anyone who
      // had LOST it: a rematch the cartridge does not have, because losing
      // leaves the nugget given and the flag unset.
      { op: "check_flag", flag: "EVENT_GOT_NUGGET" },
      { op: "jump_if_true", to: "leader" },
      // .YouBeatOurContestText is one block of two pages with the jingle
      // between them, and .ReceivedNuggetText rings a second time.
      { op: "show_text", textId: "_Route24CooltrainerM1YouBeatOurContestText" },
      { op: "text_sound", name: "Get_Item1" },
      { op: "show_text", textId: "_Route24CooltrainerM1YouJustEarnedAPrizeText" },
      { op: "give_item", item: "NUGGET", count: 1, noRoom: "_Route24CooltrainerM1NoRoomText" },
      { op: "set_flag", flag: "EVENT_GOT_NUGGET" },
      { op: "text_sound", name: "Get_Item1" },
      { op: "show_text", textId: "_Route24CooltrainerM1ReceivedNuggetText" },
      { op: "show_text", textId: "_Route24CooltrainerM1JoinTeamRocketText" },
      { op: "start_battle", trainer: "OPP_ROCKET", party: 6 },
      { op: "check_battle_result" },
      { op: "jump_if_false", to: "end" },
      { op: "beat_trainer", map: "ROUTE_24", npc: "ROUTE24_COOLTRAINER_M1", flag: "EVENT_BEAT_ROUTE_24_ROCKET" },
      { op: "show_text", textId: "_Route24CooltrainerM1DefeatedText" },
      { op: "label", name: "leader" },
      { op: "show_text", textId: "_Route24CooltrainerM1YouCouldBecomeATopLeaderText" },
    ] as ScriptCommand[],
  },
  onStep: [
    stepTrigger({ x: 10, y: 15, unless: ["EVENT_GOT_NUGGET"], turnPlayer: "right", talk: "TEXT_ROUTE24_COOLTRAINER_M1" }),
  ],
  onFace: [],
};

/**
 * The Game Corner's poster (scripts/GameCorner.asm): behind it the switch that
 * opens the staircase to the Rocket Hideout. The staircase itself is a block
 * override on EVENT_FOUND_ROCKET_HIDEOUT; this only finds the switch.
 */
const GAME_CORNER: MapScriptSet = {
  talk: {
    // GameCorner.asm:455-478. It runs the same way every time -- there is no
    // check of the flag -- and both sounds belong to it: SFX_SWITCH inside the
    // text as the switch is pushed, then SFX_GO_INSIDE as the staircase opens,
    // and only then the flag the block override reads.
    TEXT_GAMECORNER_POSTER: [
      { op: "show_text", textId: "_GameCornerPosterSwitchBehindPosterText" },
      { op: "text_sound", name: "Switch" },
      { op: "text_sound", name: "Go_Inside" },
      { op: "set_flag", flag: "EVENT_FOUND_ROCKET_HIDEOUT" },
    ] as ScriptCommand[],
    // GameCorner.asm:421-441 and :54-102. He is text_asm rather than a trainer
    // header, which is why nothing fought him: the lens builds a battle from a
    // header and he has none. Beaten, he walks out of the way of the poster --
    // the cell he is standing on is the only one it can be read from.
    TEXT_GAMECORNER_ROCKET: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_BEAT_GAME_CORNER_ROCKET" },
      { op: "jump_if_true", to: "beaten" },
      { op: "show_text", textId: "_GameCornerRocketImGuardingThisPosterText" },
      { op: "start_battle", trainer: "OPP_ROCKET", party: 7 },
      { op: "check_battle_result" },
      { op: "jump_if_false", to: "end" },
      { op: "beat_trainer", map: "GAME_CORNER", npc: "GAMECORNER_ROCKET",
        flag: "EVENT_BEAT_GAME_CORNER_ROCKET" },
      { op: "show_text", textId: "_GameCornerRocketAfterBattleText" },
      { op: "move", npc: "GAMECORNER_ROCKET", path: ["down", "down", "right", "right"] },
      { op: "hide_object", map: "GAME_CORNER", npc: "GAMECORNER_ROCKET" },
      { op: "jump", to: "end" },
      { op: "label", name: "beaten" },
      { op: "show_text", textId: "_GameCornerRocketAfterBattleText" },
    ] as ScriptCommand[],
    // GameCorner.asm:140-227: ¥1000 for 50 coins, and three things that can
    // stop it -- no COIN CASE, a case too full to take nine more, and not
    // enough money. The only coin income in the game besides three one-off
    // gifts worth fifty between them.
    TEXT_GAMECORNER_CLERK1: [
      { op: "face_player" },
      { op: "ask", textId: "_GameCornerClerk1DoYouNeedSomeGameCoinsText" },
      { op: "jump_if_false", to: "declined" },
      { op: "check_item", item: "COIN_CASE" },
      { op: "jump_if_false", to: "no_case" },
      { op: "check_coins", amount: 9990 },
      { op: "jump_if_true", to: "full" },
      { op: "check_money", amount: 1000 },
      { op: "jump_if_false", to: "poor" },
      { op: "take_money", amount: 1000 },
      { op: "give_coins", amount: 50 },
      { op: "show_text", textId: "_GameCornerClerk1ThanksHereAre50CoinsText" },
      { op: "jump", to: "end" },
      { op: "label", name: "declined" },
      { op: "show_text", textId: "_GameCornerClerk1PleaseComePlaySometimeText" },
      { op: "jump", to: "end" },
      { op: "label", name: "no_case" },
      { op: "show_text", textId: "_GameCornerClerk1DontHaveCoinCaseText" },
      { op: "jump", to: "end" },
      { op: "label", name: "full" },
      { op: "show_text", textId: "_GameCornerClerk1CoinCaseIsFullText" },
      { op: "jump", to: "end" },
      { op: "label", name: "poor" },
      { op: "show_text", textId: "_GameCornerClerk1CantAffordTheCoinsText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * The EEVEE on the table upstairs in the Celadon Mansion
 * (CeladonMansionRoofHouse.asm:13-22).
 *
 * A Poke Ball that is an OBJECT with a text pointer rather than an item, so
 * the lens's item-ball path never saw it. The cartridge asks nothing: it gives
 * EEVEE at 25 and hides the ball, and with party and box both full it fails
 * and leaves the ball where it is.
 */
const CELADON_MANSION_ROOF_HOUSE: MapScriptSet = {
  talk: {
    TEXT_CELADONMANSION_ROOF_HOUSE_EEVEE_POKEBALL: [
      { op: "give_pokemon", species: "EEVEE", level: 25 },
      { op: "jump_if_false", to: "end" },
      { op: "hide_object", map: "CELADON_MANSION_ROOF_HOUSE",
        npc: "CELADONMANSION_ROOF_HOUSE_EEVEE_POKEBALL" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * The game designer on the mansion's third floor
 * (CeladonMansion3F.asm:27-54): with 150 species owned -- Mew discounted --
 * he says something else and hands over the diploma. The diploma screen
 * itself is not drawn; the line that introduces it is.
 */
const CELADON_MANSION_3F: MapScriptSet = {
  talk: {
    TEXT_CELADONMANSION3F_GAME_DESIGNER: [
      { op: "face_player" },
      { op: "check_dex_owned", count: 150 },
      { op: "jump_if_true", to: "completed" },
      { op: "show_text", textId: "_CeladonMansion3FGameDesignerText" },
      { op: "jump", to: "end" },
      { op: "label", name: "completed" },
      { op: "show_text", textId: "_CeladonMansion3FGameDesignerCompletedDexText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * ViridianCity.asm -- the sleeper across the north road.
 *
 * ViridianCityCheckGotPokedexScript polls exactly one cell, (19,9): the gap
 * between the girl on (17,9) and the GAMBLER_ASLEEP on (18,9), and the only
 * column the road north leaves town by. Without the POKEDEX it shows his line
 * and walks the player back down a cell. With it the routine returns BEFORE
 * the coordinate test, so the gate is keyed on the flag and not on whether the
 * sleeper is still drawn.
 *
 * He never wakes and he never moves. The old man who asks about coffee and
 * demonstrates a catch is a DIFFERENT object -- the walking GAMBLER on (17,5),
 * shipped hidden -- and Oak's lab swaps the two the moment it hands over the
 * POKEDEX. Talking to the sleeper is the same line and the same shove, which
 * is why it needs no flag of its own: once the flag is set he is not there.
 */
const VIRIDIAN_CITY: MapScriptSet = {
  talk: {
    TEXT_VIRIDIANCITY_GIRL: VIRIDIAN_CITY_TALK.TEXT_VIRIDIANCITY_GIRL,
    TEXT_VIRIDIANCITY_GAMBLER1: VIRIDIAN_CITY_TALK.TEXT_VIRIDIANCITY_GAMBLER1,
    TEXT_VIRIDIANCITY_YOUNGSTER2: VIRIDIAN_CITY_TALK.TEXT_VIRIDIANCITY_YOUNGSTER2,
    /**
     * The old man, once he is up (ViridianCityOldManText). "Are you in a
     * hurry?" -- YES is `wCurrentMenuItem == 0`, which the asm sends to
     * .refused: "Time is money... Go along then." NO gets the lesson: he
     * notices the POKeDEX, and the map script starts the demonstration
     * (SCRIPT_VIRIDIANCITY_OLD_MAN_START_CATCH_TRAINING) -- a WEEDLE caught
     * by OLD MAN with a ball that always holds -- after which
     * ViridianCityOldManEndCatchTrainingScript says how it is done.
     */
    TEXT_VIRIDIANCITY_OLD_MAN: [
      { op: "face_player" },
      { op: "ask", textId: "_ViridianCityOldManHadMyCoffeeNowText" },
      { op: "jump_if_true", to: "hurry" },
      { op: "show_text", textId: "_ViridianCityOldManKnowHowToCatchPokemonText" },
      { op: "call", routine: "old_man_demo", argument: "" },
      { op: "show_text", textId: "_ViridianCityOldManYouNeedToWeakenTheTargetText" },
      { op: "jump", to: "end" },
      { op: "label", name: "hurry" },
      { op: "show_text", textId: "_ViridianCityOldManTimeIsMoneyText" },
    ] as ScriptCommand[],
  },
  onStep: [
    stepTrigger({ x: 19, y: 9, unless: ["EVENT_GOT_POKEDEX"], script: [
      { op: "show_text", textId: "_ViridianCityOldManSleepyPrivatePropertyText" },
      { op: "move_player", direction: "down", steps: 1 },
    ] as ScriptCommand[] }),
  ],
  onFace: [],
};

/** A run of identical steps, the shape the RLE lists are written in. */
function repeated(direction: string, times: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < times; i++) {
    out.push(direction);
  }
  return out;
}

/** One move_player, so a path reads as the runs the cartridge stores. */
function playerRun(direction: string, steps: number): ScriptCommand {
  return { op: "move_player", direction: direction, steps: steps } as ScriptCommand;
}

const PEWTER_GUY: string = "PEWTERCITY_YOUNGSTER";

/** RLEList_PewterGymGuy decoded: 41 steps, (35,16) to (12,18). */
const PEWTER_GUY_PATH: string[] = repeated("down", 2)
  .concat(repeated("left", 15))
  .concat(repeated("up", 5))
  .concat(repeated("left", 11))
  .concat(repeated("down", 5))
  .concat(repeated("right", 3));

/** The half of the walk every starting cell shares, ending on (11,18). */
const PEWTER_ESCORT_TAIL: ScriptCommand[] = [
  playerRun("up", 5), playerRun("left", 11), playerRun("down", 5), playerRun("right", 2),
];

/**
 * The youngster walks you to the gym, and you follow one cell behind.
 *
 * The cartridge keeps ONE player path for every starting cell
 * (RLEList_PewterGymPlayer, played back to front) and lets PewterGuys write a
 * short positioning preamble over its tail; walls absorb the difference, so
 * all of them converge. `lead` is that arithmetic done once per cell: after it
 * every walk is standing on (35,18) or already west of it, and the shared tail
 * finishes the job.
 *
 * He does not walk back. MovementData_PewterGymGuyExit takes him five cells
 * right into (17,18) -- a dead end behind the fence on (18,18), which is
 * exactly why the original teleports him to his shipped cell off screen
 * instead of retracing the escort through the player standing on (11,18).
 */
function pewterGymEscort(headStart: number, lead: ScriptCommand[]): ScriptCommand[] {
  return ([
    { op: "show_text", textId: "_PewterCityYoungsterYoureATrainerFollowMeText" },
    { op: "play_music", track: "Music_MuseumGuy" },
    // His head start, walked before the player is let go. PewterGuys writes
    // eight NO_INPUT frames -- one of his steps -- over the head of the
    // player's list on the two cells the player would otherwise reach (35,18)
    // at the same moment he does. That is not decoration: a scripted walk
    // that finds a body in the way gives up where it stands, so the player
    // would stop two cells from home and every run after it would run from
    // the wrong place.
    { op: "move", npc: PEWTER_GUY, path: PEWTER_GUY_PATH.slice(0, headStart) },
    { op: "move", npc: PEWTER_GUY, async: true, path: PEWTER_GUY_PATH.slice(headStart) },
    // The same two frames Oak's escort takes: his body has to be out of the
    // cell the player steps into before the walk asks whether it is free.
    { op: "wait", frames: 2 },
  ] as ScriptCommand[]).concat(lead).concat(PEWTER_ESCORT_TAIL).concat([
    { op: "wait_npc", npc: PEWTER_GUY },
    { op: "face", npc: PEWTER_GUY, direction: "left" },
    { op: "play_default_music" },
    { op: "show_text", textId: "_PewterCityYoungsterGoTakeOnBrockText" },
    { op: "walk_npc", npc: PEWTER_GUY, direction: "right", steps: 5 },
    { op: "hide_object", map: "PEWTER_CITY", npc: PEWTER_GUY },
    { op: "place_npc", npc: PEWTER_GUY, x: 35, y: 16, facing: "down" },
    { op: "show_object", map: "PEWTER_CITY", npc: PEWTER_GUY },
  ] as ScriptCommand[]);
}

const PEWTER_MUSEUM_GUY: string = "PEWTERCITY_SUPER_NERD1";

/** RLEList_PewterMuseumGuy decoded: 23 steps, (27,17) to (13,8). */
const PEWTER_MUSEUM_GUY_PATH: string[] = repeated("up", 6)
  .concat(repeated("left", 13))
  .concat(repeated("up", 3))
  .concat(repeated("left", 1));

/**
 * The museum guide's escort (PewterCity.asm:209-237 and auto_movement.asm:160).
 *
 * Say you have not been to the museum and he walks you there:
 * RLEList_PewterMuseumPlayer is NO_INPUT 1, UP 3, LEFT 13, UP 6, and his own
 * list leads it. `prefix` is the two presses PewterGuys writes over the head of
 * that list to get the player into line first, one pair per cell you can be
 * standing on when you talk to him (PewterMuseumGuyCoords).
 *
 * The shape is the gym escort's, for the same reason: his head start is one of
 * his steps, and a scripted walk that finds a body in the way abandons every
 * step it has left.
 */
function pewterMuseumEscort(prefix: ScriptCommand[]): ScriptCommand[] {
  return ([
    { op: "show_text", textId: "_PewterCitySuperNerd1YouHaveToGoText" },
    { op: "play_music", track: "Music_MuseumGuy" },
    { op: "move", npc: PEWTER_MUSEUM_GUY, path: PEWTER_MUSEUM_GUY_PATH.slice(0, 1) },
    { op: "move", npc: PEWTER_MUSEUM_GUY, async: true, path: PEWTER_MUSEUM_GUY_PATH.slice(1) },
    { op: "wait", frames: 2 },
  ] as ScriptCommand[]).concat(prefix).concat([
    // The RLE list is written NO_INPUT 1, UP 3, LEFT 13, UP 6 and is walked
    // BACKWARDS: wSimulatedJoypadStatesIndex is decremented and used as an
    // offset from wSimulatedJoypadStatesEnd (home/overworld.asm:1844-1856), so
    // the last byte decoded is the first one pressed. Read forwards, the route
    // runs along row 14, which is the front wall of three buildings.
    playerRun("up", 6),
    playerRun("left", 13),
    playerRun("up", 3),
    { op: "wait_npc", npc: PEWTER_MUSEUM_GUY },
    { op: "face", npc: PEWTER_MUSEUM_GUY, direction: "up" },
    { op: "play_default_music" },
    { op: "show_text", textId: "_PewterCitySuperNerd1ItsRightHereText" },
    // MovementData_PewterMuseumGuyExit, then TOGGLE_MUSEUM_GUY is hidden and
    // shown again at his own post: four steps down, out of sight, home.
    { op: "walk_npc", npc: PEWTER_MUSEUM_GUY, direction: "down", steps: 4 },
    { op: "hide_object", map: "PEWTER_CITY", npc: PEWTER_MUSEUM_GUY },
    { op: "place_npc", npc: PEWTER_MUSEUM_GUY, x: 27, y: 17, facing: "down" },
    { op: "show_object", map: "PEWTER_CITY", npc: PEWTER_MUSEUM_GUY },
  ] as ScriptCommand[]);
}

/**
 * Talking to the museum guide: a question, and an escort if you say no.
 *
 * He stands at (27,17) and the cell the player is on is the side they face him
 * from, so each side gets its own lead-in -- PewterMuseumGuyCoords, which
 * stores y then x, has one pair of presses per side.
 *
 * Every one of those pairs comes to the same thing here: ONE step onto the cell
 * he has just left. The cartridge writes two presses and the first of them is
 * eaten by his body -- the same blocked-press accounting the gym escort's head
 * starts are made of -- and what is left is the player stepping into his place
 * and following him. Walking the pairs literally puts the player a row too far
 * north the whole way, and the last run then ends ON the museum door at (14,7)
 * rather than in front of it, which warps them inside in the middle of his
 * sentence.
 *
 * Not yet checked against the running cartridge: no oracle start reaches Pewter
 * (tools/oracle/README.md, "Shared starts"). What IS asserted is the end cell,
 * (14,8), because it is the only one the rest of the scene makes sense from --
 * he says "It's right here! You have to pay to get in", and then walks home.
 */
function pewterMuseumTalk(): ScriptCommand[] {
  return ([
    { op: "face_player" },
    { op: "ask", textId: "_PewterCitySuperNerd1DidYouCheckOutMuseumText" },
    { op: "jump_if_false", to: "take_him" },
    { op: "show_text", textId: "_PewterCitySuperNerd1WerentThoseFossilsAmazingText" },
    { op: "jump", to: "end" },
    { op: "label", name: "take_him" },
    { op: "check_facing", direction: "up" },
    { op: "jump_if_true", to: "from_below" },
    { op: "check_facing", direction: "down" },
    { op: "jump_if_true", to: "from_above" },
    { op: "check_facing", direction: "right" },
    { op: "jump_if_true", to: "from_left" },
  ] as ScriptCommand[])
    .concat(pewterMuseumEscort([playerRun("left", 1)]))
    .concat([
      { op: "jump", to: "end" },
      { op: "label", name: "from_below" },
    ] as ScriptCommand[])
    .concat(pewterMuseumEscort([playerRun("up", 1)]))
    .concat([
      { op: "jump", to: "end" },
      { op: "label", name: "from_above" },
    ] as ScriptCommand[])
    .concat(pewterMuseumEscort([playerRun("down", 1)]))
    .concat([
      { op: "jump", to: "end" },
      { op: "label", name: "from_left" },
    ] as ScriptCommand[])
    .concat(pewterMuseumEscort([playerRun("right", 1)]));
}

/**
 * PewterCity.asm -- the road east is shut until BROCK is beaten.
 *
 * PewterCityCheckPlayerLeavingEastScript locks the d-pad on four cells --
 * PewterCityPlayerLeavingEastCoords, (35,17) (36,17) (37,18) (37,19) -- and
 * shows TEXT_PEWTERCITY_YOUNGSTER. That text is not a line but a scene: it
 * arms PewterGymGuyMovementScriptPointerTable, and the escort walks the
 * player to the gym while the youngster leads. Beating BROCK hides him for
 * good (Victories' OPP_BROCK#1), which is what finally opens Route 3.
 *
 * Talking to him arms the same walk, but only from the west: PewterGuys has a
 * cell for (34,16) and none for (36,16), so the east side gets the line and
 * nothing else. Facing is what tells the two apart, since you face RIGHT at
 * him from (34,16) and LEFT from (36,16).
 */
const PEWTER_CITY: MapScriptSet = {
  talk: {
    TEXT_PEWTERCITY_SUPER_NERD1: pewterMuseumTalk(),
    TEXT_PEWTERCITY_YOUNGSTER: ([
      { op: "check_facing", direction: "right" },
      { op: "jump_if_false", to: "east_side" },
    ] as ScriptCommand[])
      .concat(pewterGymEscort(0, [playerRun("right", 1), playerRun("down", 2), playerRun("left", 15)]))
      .concat([
        { op: "jump", to: "end" },
        { op: "label", name: "east_side" },
        { op: "show_text", textId: "_PewterCityYoungsterYoureATrainerFollowMeText" },
      ] as ScriptCommand[]),
  },
  onStep: [
    stepTrigger({ x: 35, y: 17, unless: ["EVENT_BEAT_BROCK"],
                  script: pewterGymEscort(0, [playerRun("left", 1), playerRun("right", 1),
                                              playerRun("down", 1), playerRun("left", 15)]) }),
    stepTrigger({ x: 36, y: 17, unless: ["EVENT_BEAT_BROCK"],
                  script: pewterGymEscort(1, [playerRun("left", 1), playerRun("down", 1),
                                              playerRun("left", 15)]) }),
    stepTrigger({ x: 37, y: 18, unless: ["EVENT_BEAT_BROCK"],
                  script: pewterGymEscort(1, [playerRun("left", 17)]) }),
    stepTrigger({ x: 37, y: 19, unless: ["EVENT_BEAT_BROCK"],
                  script: pewterGymEscort(0, [playerRun("left", 1), playerRun("up", 1),
                                              playerRun("left", 16)]) }),
  ],
  onFace: [],
  // PewterCityDefaultScript's first act, before any coordinate test: `xor a /
  // ld [wMuseum1FCurScript], a` and `ResetEvent EVENT_BOUGHT_MUSEUM_TICKET`.
  // The ticket is a ONE-VISIT ticket, and this is what makes it one -- step
  // out of the museum and the Y50 is owed again. The reference port never
  // picked this up (it sets and reads the flag and resets it nowhere), so it
  // is read off the cartridge.
  onEnter: [
    { op: "clear_flag", flag: "EVENT_BOUGHT_MUSEUM_TICKET" },
  ] as ScriptCommand[],
};

/** Every ported map, by map id. Plain object: Lens Studio forbids Map<>. */
/**
 * RedsHouse2F.asm.
 *
 * The bedroom has no people and no signs; its one line comes from the map's
 * own script when A is pressed at the SNES. Measured on the cartridge in
 * PyBoy: from (3,6) facing up, "RED is playing the SNES! ...Okay! It's time
 * to go!" -- the lens said nothing, because no sign pointed at the text.
 */
const REDS_HOUSE_2F: MapScriptSet = {
  talk: {},
  onStep: [],
  onFace: [
    stepTrigger({ x: 3, y: 5, script: [
      { op: "show_text", textId: "_RedBedroomSNESText" },
    ] as ScriptCommand[] }),
  ],
};

/**
 * ViridianMart.asm -- OAK'S PARCEL, ViridianMartScript0.
 *
 * Measured on the cartridge (tools/oracle, 6 sep): with a starter chosen and
 * the parcel not yet owned, landing on the mat (3,7) shows the clerk's
 * greeting AT ONCE, while the player still stands on the mat facing up;
 * on A the cartridge walks the player itself (up two, then left one) to
 * (2,5) facing the counter, where the quest text and "RED got OAK's
 * PARCEL!" print in one box and the flag is set.
 *
 * This is its own short script, not a call into TEXT_VIRIDIANMART_CLERK's
 * talk table below (PortedMaps.ts, unchanged, still resolves that table for
 * an ordinary talk): probed directly on the ROM by talking to the clerk
 * again right after this fires, the table's own closing line for a repeat
 * visit ("Okay! Say hi to PROF.OAK for me!") does NOT also play here -- the
 * triggered scene ends the instant the flag is set. `talk: {}` leaves the
 * shop's own script (buy/sell, and the repeat-visit line) to fall through
 * to that transcribed table exactly as before.
 */
const VIRIDIAN_MART: MapScriptSet = {
  talk: {},
  onStep: [
    stepTrigger({ x: 3, y: 7, ifAll: ["EVENT_GOT_STARTER"], unless: ["EVENT_GOT_OAKS_PARCEL"],
                  script: [
                    { op: "show_text", textId: "_ViridianMartClerkYouCameFromPalletTownText" },
                    { op: "move_player", direction: "up", steps: 2 },
                    { op: "move_player", direction: "left", steps: 1 },
                    // Measured on the cartridge (tools/oracle, 6 sep): the bag
                    // stays empty through the whole of ParcelQuestText's three
                    // views -- OAKS_PARCEL lands only once that box is fully
                    // closed, not when its last page merely reads "RED got
                    // OAK's PARCEL!". give_item and set_flag run after the
                    // show_text, not before it, so the lens commits the same
                    // frame the cartridge does.
                    { op: "show_text", textId: "_ViridianMartClerkParcelQuestText" },
                    { op: "give_item", item: "OAKS_PARCEL", count: 1 },
                    { op: "set_flag", flag: "EVENT_GOT_OAKS_PARCEL" },
                  ] as ScriptCommand[] }),
  ],
  onFace: [],
};

/**
 * The S.S. ANNE sails (scripts/VermilionDock.asm).
 *
 * The condition is exact and easy to get wrong: not walking down the dock and
 * not entering from town, but `wDestinationWarpID == 1` with HM01 already in
 * the bag (:5-9) -- warp 1 is the gangway, which only the ship's own exits
 * lead to. Landing on (14,2) with CUT in hand IS having just stepped off her.
 *
 * What follows is one program rather than the cartridge's three map-script
 * states: the horn, the ship (the `sail_ship` routine -- Sailing.ts leaves
 * water where she lay and shuts the gangway), the second horn, then the walk
 * out. The first walk ends on (14,0), whose warp fires under a scripted step
 * and puts the player on VERMILION_CITY (18,31); the second is
 * VermilionCityPlayerExitShipScript's two steps north (:83-105). The
 * cartridge's three latch flags exist only to spread that across frames.
 *
 * Not reproduced: the ship visibly sliding out to sea with smoke behind her
 * (:78-105). The diorama is one baked mesh per map and nothing can move a
 * part of it yet; the seventeen seconds are the two horns and the wait.
 */
const VERMILION_DOCK: MapScriptSet = {
  talk: {},
  onStep: [
    stepTrigger({ x: 14, y: 2, ifAll: ["EVENT_GOT_HM01"], unless: ["EVENT_SS_ANNE_LEFT"],
                  turnPlayer: "down", script: [
      { op: "set_flag", flag: "EVENT_SS_ANNE_LEFT" },
      { op: "stop_music" },
      { op: "play_music", track: "Music_Surfing" },
      { op: "wait", frames: 120 },
      { op: "text_sound", name: "SS_Anne_Horn" },
      { op: "call", routine: "sail_ship" },
      { op: "text_sound", name: "SS_Anne_Horn" },
      { op: "wait", frames: 120 },
      { op: "play_default_music" },
      { op: "move_player", direction: "up", steps: 2 },
      { op: "move_player", direction: "up", steps: 2 },
    ] }),
  ],
  onFace: [],
};

/**
 * Le CHEF and his main course (scripts/SSAnneKitchen.asm:39-73).
 *
 * The only line in Red whose words are drawn at random: ONE byte of hRandomAdd
 * decides, bit 7 then bit 4 of the same byte, so the dishes are not equally
 * likely -- salmon half the time, eels and steak a quarter each. Two draws
 * would give the same odds and disagree with the cartridge byte for byte,
 * which is why random_byte and check_bit are two ops rather than one.
 *
 * The three dish labels have no leading underscore; eleven of the cartridge's
 * text labels do not, and Host.showText knows them by the text table.
 */
const SS_ANNE_KITCHEN: MapScriptSet = {
  talk: {
    TEXT_SSANNEKITCHEN_COOK7: [
      { op: "face_player" },
      { op: "show_text", textId: "_SSAnneKitchenCook7MainCourseIsText" },
      { op: "random_byte" },
      { op: "check_bit", bit: 7 },
      { op: "jump_if_true", to: "salmon" },
      { op: "check_bit", bit: 4 },
      { op: "jump_if_true", to: "eels" },
      { op: "show_text", textId: "SSAnneKitchenCook7PrimeBeefSteakText" },
      { op: "jump", to: "end" },
      { op: "label", name: "salmon" },
      { op: "show_text", textId: "SSAnneKitchenCook7SalmonDuSaladText" },
      { op: "jump", to: "end" },
      { op: "label", name: "eels" },
      { op: "show_text", textId: "SSAnneKitchenCook7EelsAuBarbecueText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * The Pokemon Fan Club chairman and the BIKE VOUCHER
 * (scripts/PokemonFanClub.asm:100-145).
 *
 * Hand-written because the transcription is missing the two things the
 * cartridge does around the handover: the fanfare between the received line
 * and the explanation (:141-145 sound_get_key_item), and his own full-bag
 * line, "Make room for this!" (:113-122), where the general one is shown
 * today. Everything else is the transcription's own shape.
 */
const POKEMON_FAN_CLUB: MapScriptSet = {
  talk: {
    TEXT_POKEMONFANCLUB_CHAIRMAN: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_RECEIVED_BIKE_VOUCHER" },
      { op: "jump_if_true", to: "nothing_left" },
      { op: "ask", textId: "_PokemonFanClubChairmanIntroText" },
      { op: "jump_if_false", to: "no_story" },
      { op: "show_text", textId: "_PokemonFanClubChairmanStoryText" },
      { op: "give_item", item: "BIKE_VOUCHER", count: 1, noRoom: "_PokemonFanClubBagFullText" },
      { op: "show_text", textId: "_PokemonFanClubReceivedBikeVoucherText" },
      { op: "text_sound", name: "Get_Key_Item" },
      { op: "set_flag", flag: "EVENT_RECEIVED_BIKE_VOUCHER" },
      { op: "show_text", textId: "_PokemonFanClubExplainBikeVoucherText" },
      { op: "jump", to: "end" },
      { op: "label", name: "no_story" },
      { op: "show_text", textId: "_PokemonFanClubNoStoryText" },
      { op: "jump", to: "end" },
      { op: "label", name: "nothing_left" },
      { op: "show_text", textId: "_PokemonFanClubChairFinalText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * The binoculars in the Route 11 gate house (scripts/Route11Gate2F.asm:49-77).
 *
 * The reference wrote both as Lua functions, so the transcriber skipped them
 * and the two signs said nothing. Looking up through the left pair reports the
 * road blocked until the SNORLAX there is beaten -- CheckEvent is zero when
 * the event is CLEAR, so "asleep on a road" is the branch with the flag unset.
 */
const ROUTE_11_GATE_2F: MapScriptSet = {
  talk: {
    TEXT_ROUTE11GATE2F_LEFT_BINOCULARS: [
      { op: "check_facing", direction: "up" },
      { op: "jump_if_false", to: "end" },
      { op: "check_flag", flag: "EVENT_BEAT_ROUTE12_SNORLAX" },
      { op: "jump_if_true", to: "gone" },
      { op: "show_text", textId: "_Route11Gate2FLeftBinocularsSnorlaxText" },
      { op: "jump", to: "end" },
      { op: "label", name: "gone" },
      { op: "show_text", textId: "_Route11Gate2FLeftBinocularsNoSnorlaxText" },
    ] as ScriptCommand[],
    TEXT_ROUTE11GATE2F_RIGHT_BINOCULARS: [
      { op: "check_facing", direction: "up" },
      { op: "jump_if_false", to: "end" },
      { op: "show_text", textId: "_Route11Gate2FRightBinocularsText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * The four guards on the roads into SAFFRON, and the drink they want
 * (scripts/Route5Gate.asm, Route6Gate.asm, Route7Gate.asm, Route8Gate.asm).
 *
 * One routine four times over. Stand on the cell in front of the counter and
 * the guard says he is thirsty and pushes you back the way you came; hand him
 * anything from the vending machine and all four let you through for good.
 * RemoveGuardDrink (engine/events/saffron_guards.asm) takes the FIRST of
 * FRESH WATER, SODA POP, LEMONADE it finds, which is the order the drinks are
 * checked in here.
 *
 * The cartridge keeps this in BIT_GAVE_SAFFRON_GUARDS_DRINK rather than an
 * event flag; the save has no such byte, so it is spelled as a flag.
 */
const SAFFRON_GUARDS_FLAG: string = "EVENT_GAVE_SAFFRON_GUARDS_DRINK";

function saffronGateScript(push: string, talk: boolean): ScriptCommand[] {
  const out: ScriptCommand[] = [];
  if (talk) {
    out.push({ op: "face_player" });
    out.push({ op: "check_flag", flag: SAFFRON_GUARDS_FLAG });
    out.push({ op: "jump_if_true", to: "thanks" });
  }
  out.push({ op: "check_item", item: "FRESH_WATER" });
  out.push({ op: "jump_if_true", to: "water" });
  out.push({ op: "check_item", item: "SODA_POP" });
  out.push({ op: "jump_if_true", to: "soda" });
  out.push({ op: "check_item", item: "LEMONADE" });
  out.push({ op: "jump_if_true", to: "lemonade" });
  out.push({ op: "show_text", textId: "_SaffronGateGuardGeeImThirstyText" });
  out.push({ op: "move_player", direction: push, steps: 1 });
  out.push({ op: "jump", to: "end" });
  out.push({ op: "label", name: "water" });
  out.push({ op: "take_item", item: "FRESH_WATER", count: 1 });
  out.push({ op: "jump", to: "drink" });
  out.push({ op: "label", name: "soda" });
  out.push({ op: "take_item", item: "SODA_POP", count: 1 });
  out.push({ op: "jump", to: "drink" });
  out.push({ op: "label", name: "lemonade" });
  out.push({ op: "take_item", item: "LEMONADE", count: 1 });
  out.push({ op: "label", name: "drink" });
  out.push({ op: "show_text", textId: "_SaffronGateGuardImParchedText" });
  out.push({ op: "text_sound", name: "Get_Key_Item" });
  out.push({ op: "show_text", textId: "_SaffronGateGuardYouCanGoOnThroughText" });
  out.push({ op: "set_flag", flag: SAFFRON_GUARDS_FLAG });
  if (talk) {
    out.push({ op: "jump", to: "end" });
    out.push({ op: "label", name: "thanks" });
    out.push({ op: "show_text", textId: "_SaffronGateGuardThanksForTheDrinkText" });
  }
  return out;
}

/** One gate: the two cells it watches, and the way it shoves you back. */
function saffronGate(textKey: string, cells: number[][], push: string): MapScriptSet {
  const talk: any = {};
  talk[textKey] = saffronGateScript(push, true);
  const steps: StepTrigger[] = [];
  for (let i = 0; i < cells.length; i++) {
    steps.push(stepTrigger({
      x: cells[i][0], y: cells[i][1], unless: [SAFFRON_GUARDS_FLAG],
      turnPlayer: cells[i][2] === 1 ? "left" : cells[i][2] === 2 ? "right" : cells[i][2] === 3 ? "up" : "down",
      script: saffronGateScript(push, false),
    }));
  }
  return { talk: talk, onStep: steps, onFace: [] };
}

// The cells are dbmapcoord x, y; the facing is the cartridge's PLAYER_DIR
// write before the text, which turns the player toward the counter.
const ROUTE_5_GATE: MapScriptSet =
  saffronGate("TEXT_ROUTE5GATE_GUARD", [[3, 3, 1], [4, 3, 1]], "up");
const ROUTE_6_GATE: MapScriptSet =
  saffronGate("TEXT_ROUTE6GATE_GUARD", [[3, 2, 2], [4, 2, 2]], "down");
const ROUTE_7_GATE: MapScriptSet =
  saffronGate("TEXT_ROUTE7GATE_GUARD", [[3, 3, 3], [3, 4, 3]], "left");
const ROUTE_8_GATE: MapScriptSet =
  saffronGate("TEXT_ROUTE8GATE_GUARD", [[2, 3, 1], [2, 4, 1]], "right");

/**
 * CYCLING ROAD is for bicycles (scripts/Route16Gate1F.asm:16-52 and
 * Route18Gate1F.asm:16-52).
 *
 * Four cells in a column lead to the counter. Step on any of them without a
 * BICYCLE and the guard calls you back: the cartridge simulates
 * `wCoordIndex - 1` UP presses, which is however many steps it takes to reach
 * the cell beside him, says his piece, and shoves you one step right. With a
 * bicycle in the bag nothing happens at all.
 */
function cyclingGate(textKey: string, guardText: string, waitText: string,
                     x: number, topY: number): MapScriptSet {
  const talk: any = {};
  const steps: StepTrigger[] = [];
  for (let i = 0; i < 4; i++) {
    steps.push(stepTrigger({
      x: x, y: topY + i, script: [
        { op: "check_item", item: "BICYCLE" },
        { op: "jump_if_true", to: "end" },
        { op: "show_text", textId: waitText },
        { op: "move_player", direction: "up", steps: i },
        { op: "show_text", textId: guardText },
        { op: "move_player", direction: "right", steps: 1 },
      ] as ScriptCommand[],
    }));
  }
  return { talk: talk, onStep: steps, onFace: [] };
}

const ROUTE_16_GATE_1F: MapScriptSet =
  cyclingGate("TEXT_ROUTE16GATE1F_GUARD", "_Route16Gate1FGuardNoPedestriansAllowedText",
              "_Route16Gate1FGuardWaitUpText", 4, 7);
const ROUTE_18_GATE_1F: MapScriptSet =
  cyclingGate("TEXT_ROUTE18GATE1F_GUARD", "_Route18Gate1FGuardYouNeedABicycleText",
              "_Route18Gate1FGuardExcuseMeText", 4, 3);

/**
 * The gate onto Route 22 (scripts/Route22Gate.asm).
 *
 * The first badge gate in the game and the one nobody was standing at: the
 * guard's lines were ported, the two cells that show them were not, so the
 * road to the League was open from the start. His script is hand-written here
 * for the denial sound between his two pages (:79-90), the jingle on the way
 * through (:92-95), and the step back down that PrintText is followed by.
 */
const ROUTE_22_GATE: MapScriptSet = {
  talk: {
    TEXT_ROUTE22GATE_GUARD: [
      { op: "check_item", item: "BOULDERBADGE" },
      { op: "jump_if_true", to: "pass" },
      { op: "show_text", textId: "_Route22GateGuardNoBoulderbadgeText" },
      { op: "text_sound", name: "Denied" },
      { op: "show_text", textId: "_Route22GateGuardICantLetYouPassText" },
      { op: "move_player", direction: "down", steps: 1 },
      { op: "jump", to: "end" },
      { op: "label", name: "pass" },
      { op: "show_text", textId: "_Route22GateGuardGoRightAheadText" },
      { op: "text_sound", name: "Get_Item1" },
    ] as ScriptCommand[],
  },
  onStep: [
    stepTrigger({ x: 4, y: 2, talk: "TEXT_ROUTE22GATE_GUARD" }),
    stepTrigger({ x: 5, y: 2, talk: "TEXT_ROUTE22GATE_GUARD" }),
  ],
  onFace: [],
};

/**
 * Route 23's seven guards (scripts/Route23.asm:28-72).
 *
 * Not sprites in the way: seven ROWS. Standing anywhere on one of them runs
 * that guard's own script until his EVENT_PASSED_*_CHECK is set, and the
 * script is the transcription the guards already carry -- badge, denial,
 * jingle, step back. The rows and their order are Route23GuardsYCoords, and
 * the badges run backwards from the EARTHBADGE at the top.
 */
const ROUTE_23: MapScriptSet = {
  talk: {},
  onStep: [
    stepTrigger({ y: 35, maxX: 13, unless: ["EVENT_PASSED_EARTHBADGE_CHECK"], talk: "TEXT_ROUTE23_GUARD1" }),
    stepTrigger({ y: 56, unless: ["EVENT_PASSED_VOLCANOBADGE_CHECK"], talk: "TEXT_ROUTE23_GUARD2" }),
    stepTrigger({ y: 85, unless: ["EVENT_PASSED_MARSHBADGE_CHECK"], talk: "TEXT_ROUTE23_SWIMMER1" }),
    stepTrigger({ y: 96, unless: ["EVENT_PASSED_SOULBADGE_CHECK"], talk: "TEXT_ROUTE23_SWIMMER2" }),
    stepTrigger({ y: 105, unless: ["EVENT_PASSED_RAINBOWBADGE_CHECK"], talk: "TEXT_ROUTE23_GUARD3" }),
    stepTrigger({ y: 119, unless: ["EVENT_PASSED_THUNDERBADGE_CHECK"], talk: "TEXT_ROUTE23_GUARD4" }),
    stepTrigger({ y: 136, unless: ["EVENT_PASSED_CASCADEBADGE_CHECK"], talk: "TEXT_ROUTE23_GUARD5" }),
  ],
  onFace: [],
};

/**
 * MR FUJI's house in Lavender (scripts/MrFujisHouse.asm:70-105).
 *
 * He is hidden until the tower lets him go, and what he hands over then is
 * the POKe FLUTE. Hand-written for the two things the transcription leaves
 * out: the fanfare between the received page and the explanation (:97-101,
 * one text with sound_get_key_item inside it), and his own full-bag line,
 * "You must make room for this!" -- where the general one is shown today, and
 * where the cartridge sets no flag at all, so the flute is still owed.
 *
 * The magazines are the room's hidden events (data/events/hidden_events.asm
 * :514-518). PrintMagazinesText, like PrintTrashText, never reads the facing
 * byte its table carries.
 */
const MR_FUJIS_HOUSE: MapScriptSet = {
  talk: {
    TEXT_MRFUJISHOUSE_MR_FUJI: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_GOT_POKE_FLUTE" },
      { op: "jump_if_true", to: "has_flute" },
      { op: "show_text", textId: "_MrFujisHouseMrFujiIThinkThisMayHelpYourQuestText" },
      { op: "give_item", item: "POKE_FLUTE", count: 1,
        noRoom: "_MrFujisHouseMrFujiPokeFluteNoRoomText" },
      { op: "show_text", textId: "_MrFujisHouseMrFujiReceivedPokeFluteText" },
      { op: "text_sound", name: "Get_Key_Item" },
      { op: "show_text", textId: "_MrFujisHouseMrFujiPokeFluteExplanationText" },
      { op: "set_flag", flag: "EVENT_GOT_POKE_FLUTE" },
      { op: "jump", to: "end" },
      { op: "label", name: "has_flute" },
      { op: "show_text", textId: "_MrFujisHouseMrFujiHasMyFluteHelpedYouText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [
    stepTrigger({ x: 0, y: 1, script: [{ op: "show_text", textId: "_MagazinesText" }] }),
    stepTrigger({ x: 1, y: 1, script: [{ op: "show_text", textId: "_MagazinesText" }] }),
    stepTrigger({ x: 7, y: 1, script: [{ op: "show_text", textId: "_MagazinesText" }] }),
  ],
};

/**
 * JIGGLYPUFF sings in the Pewter Center (scripts/PewterPokecenter.asm:20-75).
 *
 * The whole map goes quiet, she turns on the spot to her own song, and the
 * Center's music comes back when she is done. The cartridge spins her until
 * the song's channels fall silent; the lens cannot ask how long a song is, so
 * she turns a fixed six times round, which is about the length of it.
 *
 * One difference kept on purpose: the cartridge sets
 * wDoNotWaitForButtonPressAfterDisplayingText, so "Puu pupuu!" stays on screen
 * through the song. Every show_text here waits for the player, so the box
 * closes first and then she sings.
 */
function jigglypuffSong(): ScriptCommand[] {
  const npc = "PEWTERPOKECENTER_JIGGLYPUFF";
  const out: ScriptCommand[] = [
    { op: "face_player" },
    { op: "show_text", textId: "_PewterPokecenterJigglypuffText" },
    { op: "stop_music" },
    { op: "wait", frames: 32 },
    { op: "play_music", track: "Music_JigglypuffSong" },
  ];
  const spin: string[] = ["down", "left", "up", "right"];
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < spin.length; i++) {
      out.push({ op: "face_object", npc: npc, direction: spin[i] });
      out.push({ op: "wait", frames: 24 });
    }
  }
  out.push({ op: "wait", frames: 48 });
  out.push({ op: "face_object", npc: npc, direction: "down" });
  out.push({ op: "play_default_music" });
  return out;
}

const PEWTER_POKECENTER: MapScriptSet = {
  talk: {
    TEXT_PEWTERPOKECENTER_JIGGLYPUFF: jigglypuffSong(),
  },
  onStep: [],
  onFace: [],
};

/**
 * Four people the reference wrote as Lua functions, so the transcriber has
 * always skipped them and they have been saying nothing.
 *
 * They are declared here rather than inside their maps' own sets because two
 * of those maps (VIRIDIAN_CITY, CERULEAN_CITY) already have long ones, and
 * these are unrelated to what is in them.
 */
/**
 * Pokemon Tower 6F and 7F.
 *
 * 6F: the RESTLESS SOUL stands between the player and the stairs, and the one
 * cell in front of them, (10,16), is the trigger (PokemonTower6F.asm:25-47).
 * Beaten, she is calmed and gone; lost, the cartridge shoves the player one
 * step right so the cell does not fire again on the spot (:74-87).
 *
 * She is fought as MAROWAK because that is what she is; what the cartridge
 * shows before the SILPH SCOPE is a GHOST with her stats, which is the ghost
 * system and is not built (see the milestone-5 audit).
 *
 * 7F: hand-written only to add the hide the transcription is missing --
 * PokemonTower7FWarpToMrFujiHouseScript hides him on the tower floor BEFORE
 * the warp (:67-72), and without it he is still standing there on any later
 * visit, ready to give the speech and warp the player to Lavender again.
 */
const POKEMON_TOWER_6F: MapScriptSet = {
  talk: {},
  onStep: [
    stepTrigger({ x: 10, y: 16, unless: ["EVENT_BEAT_GHOST_MAROWAK"], script: [
      { op: "show_text", textId: "_PokemonTower6FBeGoneText" },
      { op: "static_battle", species: "MAROWAK", level: 30, flag: "EVENT_BEAT_GHOST_MAROWAK" },
      { op: "check_battle_result" },
      { op: "jump_if_false", to: "lost" },
      { op: "show_text", textId: "_PokemonTower6FGhostWasCubonesMotherText" },
      { op: "play_cry", species: "MAROWAK" },
      { op: "wait", frames: 30 },
      { op: "show_text", textId: "_PokemonTower6FSoulWasCalmedText" },
      { op: "jump", to: "end" },
      { op: "label", name: "lost" },
      { op: "move_player", direction: "right", steps: 1 },
    ] }),
  ],
  onFace: [],
};

const POKEMON_TOWER_7F: MapScriptSet = {
  talk: {
    TEXT_POKEMONTOWER7F_MR_FUJI: [
      { op: "face_player" },
      { op: "show_text", textId: "_PokemonTower7FMrFujiRescueText" },
      { op: "set_flag", flag: "EVENT_RESCUED_MR_FUJI" },
      { op: "set_flag", flag: "EVENT_RESCUED_MR_FUJI_2" },
      { op: "show_object", map: "MR_FUJIS_HOUSE", npc: "MRFUJISHOUSE_MR_FUJI" },
      { op: "hide_object", map: "POKEMON_TOWER_7F", npc: "POKEMONTOWER7F_MR_FUJI" },
      { op: "hide_object", map: "SAFFRON_CITY", npc: "SAFFRONCITY_ROCKET8" },
      { op: "show_object", map: "SAFFRON_CITY", npc: "SAFFRONCITY_ROCKET9" },
      { op: "warp", map: "MR_FUJIS_HOUSE", x: 3, y: 7, facing: "up" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * The three vending machines on the department store's roof
 * (engine/events/vending_machine.asm:1-81).
 *
 * They matter more than they look: the drinks they sell are the only drinks in
 * the game, and the four guards on the roads into SAFFRON each want one. With
 * the machines dead, Saffron is unreachable.
 *
 * The cartridge draws a four-row menu -- FRESH WATER 200 / SODA POP 300 /
 * LEMONADE 350 / CANCEL -- beside a money box. The lens has no list menu, so
 * it asks the three in the menu's own order and takes the first yes, the same
 * substitution the bike shop's price window gets. Everything after the choice
 * is the cartridge's: not enough money, no room in the bag, the "brrrrr" of
 * SFX_PUSH_BOULDER, "<DRINK> popped out!", and the money taken last.
 */
function vendingMachine(): ScriptCommand[] {
  return [{ op: "call", routine: "vending_machine", argument: "" }] as ScriptCommand[];
}

/**
 * The thirsty girl on the roof (CeladonMartRoof.asm:222-250 and the exchange
 * at CeladonMartRoofScript_GiveDrinkToGirl).
 *
 * She is why the vending machines are worth using twice: each of the three
 * drinks buys a TM, once. With nothing to drink in the bag she only says she
 * is thirsty; with something she asks, and the cartridge then lists exactly
 * the drinks carried. The list is a chain of yes/no boxes here, as the
 * machines' own menu is, and a drink already traded is simply not offered --
 * where the cartridge offers it and then says she is not thirsty.
 */
function drinkForTm(): ScriptCommand[] {
  const trades: any[] = [
    { drink: "FRESH_WATER", tm: "TM_ICE_BEAM", flag: "EVENT_GOT_TM13",
      yay: "_CeladonMartRoofLittleGirlYayFreshWaterText",
      got: "_CeladonMartRoofLittleGirlReceivedTM13Text",
      explain: "_CeladonMartRoofLittleGirlTM13ExplanationText" },
    { drink: "SODA_POP", tm: "TM_ROCK_SLIDE", flag: "EVENT_GOT_TM48",
      yay: "_CeladonMartRoofLittleGirlYaySodaPopText",
      got: "_CeladonMartRoofLittleGirlReceivedTM48Text",
      explain: "_CeladonMartRoofLittleGirlTM48ExplanationText" },
    { drink: "LEMONADE", tm: "TM_TRI_ATTACK", flag: "EVENT_GOT_TM49",
      yay: "_CeladonMartRoofLittleGirlYayLemonadeText",
      got: "_CeladonMartRoofLittleGirlReceivedTM49Text",
      explain: "_CeladonMartRoofLittleGirlTM49ExplanationText" },
  ];
  const out: ScriptCommand[] = [{ op: "face_player" }];
  for (let i = 0; i < trades.length; i++) {
    const row = trades[i];
    out.push({ op: "check_item", item: row.drink });
    out.push({ op: "jump_if_false", to: "next" + i });
    out.push({ op: "check_flag", flag: row.flag });
    out.push({ op: "jump_if_true", to: "next" + i });
    out.push({ op: "ask", textId: "_CeladonMartRoofLittleGirlGiveHerADrinkText", ramItem: row.drink });
    out.push({ op: "jump_if_false", to: "next" + i });
    out.push({ op: "show_text", textId: row.yay });
    out.push({ op: "take_item", item: row.drink, count: 1 });
    out.push({ op: "give_item", item: row.tm, count: 1,
               noRoom: "_CeladonMartRoofLittleGirlNoRoomText" });
    out.push({ op: "show_text", textId: row.got, ramItem: row.tm });
    out.push({ op: "text_sound", name: "Get_Item1" });
    out.push({ op: "show_text", textId: row.explain });
    out.push({ op: "set_flag", flag: row.flag });
    out.push({ op: "jump", to: "end" });
    out.push({ op: "label", name: "next" + i });
  }
  out.push({ op: "show_text", textId: "_CeladonMartRoofLittleGirlImThirstyText" });
  return out;
}

const CELADON_MART_ROOF: MapScriptSet = {
  talk: {
    TEXT_CELADONMARTROOF_VENDING_MACHINE1: vendingMachine(),
    TEXT_CELADONMARTROOF_VENDING_MACHINE2: vendingMachine(),
    TEXT_CELADONMARTROOF_VENDING_MACHINE3: vendingMachine(),
    TEXT_CELADONMARTROOF_LITTLE_GIRL: drinkForTm(),
  },
  onStep: [],
  onFace: [],
};

/**
 * The two doors inside the ROCKET HIDEOUT that open with a sound
 * (RocketHideoutB1F.asm:11-32 and RocketHideoutB4F.asm:11-31).
 *
 * The block swap itself is a flag-driven override and has always worked; what
 * was missing is that the cartridge plays SFX_GO_INSIDE on the map load where
 * the door is open. It plays it on EVERY later load too: the flag that was
 * meant to stop that, EVENT_ENTERED_ROCKET_HIDEOUT, is never set -- a
 * documented bug at RocketHideoutB1F.asm:25 -- so there is nothing to
 * reproduce but the sound itself.
 */
const ROCKET_HIDEOUT_B1F: MapScriptSet = {
  talk: {},
  onStep: [],
  onFace: [],
  onEnter: [
    { op: "check_flag", flag: "EVENT_BEAT_ROCKET_HIDEOUT_1_TRAINER_4" },
    { op: "jump_if_false", to: "end" },
    { op: "text_sound", name: "Go_Inside" },
  ] as ScriptCommand[],
};

/**
 * The two lift panels (CeladonMartElevator.asm:64-73 and
 * RocketHideoutElevator.asm:67-80).
 *
 * The panel is a sign, so this is a talk script: the hideout's asks for the
 * LIFT KEY first and says "It appears to need a key." without it; the Mart's
 * asks for nothing. Both then open the floor list, and the `elevator` routine
 * (Host.ts) does what the cartridge's DisplayElevatorFloorMenu does -- rewrite
 * the car's own two warps so that stepping out arrives on the chosen floor.
 *
 * The shake between floors is not built; the lift travels in silence.
 */
const CELADON_MART_ELEVATOR: MapScriptSet = {
  talk: {
    TEXT_CELADONMARTELEVATOR: [
      { op: "call", routine: "elevator", argument: "" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

const SILPH_CO_ELEVATOR: MapScriptSet = {
  talk: {
    TEXT_SILPHCOELEVATOR_ELEVATOR: [
      { op: "call", routine: "elevator", argument: "" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

const ROCKET_HIDEOUT_ELEVATOR: MapScriptSet = {
  talk: {
    TEXT_ROCKETHIDEOUTELEVATOR: [
      { op: "check_item", item: "LIFT_KEY" },
      { op: "jump_if_false", to: "no_key" },
      { op: "call", routine: "elevator", argument: "" },
      { op: "jump", to: "end" },
      { op: "label", name: "no_key" },
      { op: "show_text", textId: "_RocketHideoutElevatorAppearsToNeedKeyText" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * The GAME CORNER's prize room (engine/events/prize_menu.asm:1-43).
 *
 * Three counters, three prizes each, and the counter a sign stands for is its
 * own position in the room -- the cartridge works it out from the text id.
 */
/**
 * The SAFARI ZONE's gate (Safari.ts).
 *
 * The corridor is two cells wide and the attendants stand behind counters on
 * either side of it, so nothing here is a word with anybody: the counter row
 * is a step trigger, and which of the two scripts it runs depends on whether
 * a hunt is already running. Walking north onto it with no hunt is the desk;
 * walking south onto it with one is leaving early.
 */
/**
 * CINNABAR ISLAND's gym door (CinnabarIsland.asm).
 *
 * The door is locked until the SECRET KEY is out of the burned mansion, and
 * the cartridge says so on the step rather than on a press: a coordinate
 * trigger on the doorway itself, which takes the landing and drops the warp
 * the step would otherwise have fired.
 */
/**
 * The CHAMPION's room (ChampionsRoom.asm, bank $1D $5FD0..$60C7).
 *
 * The end of the game, and the cartridge writes it as nine little scripts
 * chained through wCurrentMapScriptFlags. Read off the movement and facing
 * data it hands the engine:
 *
 *   the RIVAL's line, the fight, and his line after it
 *   OAK walks five cells up ($6014) and says the player's name
 *   the RIVAL turns LEFT, OAK turns DOWN, and OAK congratulates the player
 *   OAK turns RIGHT and tells the RIVAL what he thinks of him
 *   OAK turns DOWN, says come with me, and walks two cells up ($6080)
 *   the RIVAL is gone ($6083's HideObject)
 *   the player is walked up four and left one ($60B4), into the HALL OF FAME
 *
 * OPP_RIVAL3 has three parties and no base to add: the one his starter
 * decides IS the roster.
 */
function championScene(): ScriptCommand[] {
  return [
    { op: "show_text", textId: "_ChampionsRoomRivalIntroText" },
    { op: "call", routine: "rival_battle", argument: "OPP_RIVAL3#1" },
    { op: "check_battle_result" },
    { op: "jump_if_false", to: "end" },
    { op: "set_flag", flag: "EVENT_BEAT_CHAMPION_RIVAL" },
    { op: "show_text", textId: "_ChampionsRoomRivalAfterBattleText" },
    { op: "show_object", map: "CHAMPIONS_ROOM", npc: "CHAMPIONSROOM_OAK" },
    { op: "move", npc: "CHAMPIONSROOM_OAK", path: ["up", "up", "up", "up", "up"] },
    { op: "show_text", textId: "_ChampionsRoomOakText" },
    { op: "face", npc: "CHAMPIONSROOM_RIVAL", direction: "left" },
    { op: "face", npc: "CHAMPIONSROOM_OAK", direction: "down" },
    { op: "show_text", textId: "_ChampionsRoomOakCongratulatesPlayerText" },
    { op: "face", npc: "CHAMPIONSROOM_OAK", direction: "right" },
    { op: "show_text", textId: "_ChampionsRoomOakDisappointedWithRivalText" },
    { op: "face", npc: "CHAMPIONSROOM_OAK", direction: "down" },
    { op: "show_text", textId: "_ChampionsRoomOakComeWithMeText" },
    { op: "move", npc: "CHAMPIONSROOM_OAK", path: ["up", "up"] },
    { op: "hide_object", map: "CHAMPIONS_ROOM", npc: "CHAMPIONSROOM_RIVAL" },
    { op: "move_player", direction: "up", steps: 4 },
    { op: "move_player", direction: "left", steps: 1 },
    // $60B4 is `up four, left one` as simulated presses, which on the
    // cartridge lands the player in the doorway because its own chain has
    // walked them further in by then. The lens's trigger is the doorway
    // itself, so the last of it is the warp rather than two more presses.
    { op: "warp", map: "HALL_OF_FAME", x: 4, y: 7, facing: "up" },
    { op: "move_player", direction: "up", steps: 2 },
  ].concat(hallOfFameScript() as any) as ScriptCommand[];
}

/** What the machine and OAK do once the player is standing in front of it. */
function hallOfFameScript(): ScriptCommand[] {
  return [
    { op: "show_text", textId: "_HallOfFameOakText" },
    { op: "set_flag", flag: "EVENT_HALL_OF_FAME" },
    // HallOfFamePC records the party and heals it on the way out.
    { op: "heal_party" },
    // ...and the credits roll (Credits, bank $1C): the fifteen POKeMON and
    // the thirty-five screens the bundle carries in field.credits.
    { op: "call", routine: "credits", argument: "" },
  ] as ScriptCommand[];
}

const CHAMPIONS_ROOM: MapScriptSet = {
  // Spoken to instead -- only reachable after a lost battle has left him
  // standing there -- he fights from where he is.
  talk: {
    TEXT_CHAMPIONSROOM_RIVAL: [
      { op: "check_flag", flag: "EVENT_BEAT_CHAMPION_RIVAL" },
      { op: "jump_if_true", to: "beaten" },
      { op: "face_player" },
    ].concat(championScene() as any).concat([
      { op: "jump", to: "end" },
      { op: "label", name: "beaten" },
      { op: "show_text", textId: "_ChampionsRoomRivalAfterBattleText" },
    ] as any) as ScriptCommand[],
  },
  // The two cells inside the door: he is waiting whichever one you come in on.
  onStep: [
    stepTrigger({ x: 3, y: 6, unless: "EVENT_BEAT_CHAMPION_RIVAL",
                  turnPlayer: "up", script: championScene() }),
    stepTrigger({ x: 4, y: 6, unless: "EVENT_BEAT_CHAMPION_RIVAL",
                  turnPlayer: "up", script: championScene() }),
  ],
  onFace: [],
};

/**
 * The HALL OF FAME (HallOfFame.asm): the machine records the party, OAK
 * says his piece, and the game is over.
 *
 * The roll of credits the cartridge plays afterwards is the `credits`
 * routine: the lens shows field.credits on the Game Boy screen
 * (play/screen/CreditsScreen.ts) and hands the player back to the room.
 */
const HALL_OF_FAME: MapScriptSet = {
  talk: {},
  onStep: [
    stepTrigger({ x: 4, y: 5, maxX: 5, unless: "EVENT_HALL_OF_FAME",
                  script: hallOfFameScript() }),
  ],
  onFace: [],
};

const CINNABAR_ISLAND: MapScriptSet = {
  talk: {},
  onStep: [
    stepTrigger({
      x: 18, y: 3, unlessItem: "SECRET_KEY",
      script: [
        { op: "show_text", textId: "_CinnabarIslandDoorIsLockedText" },
        { op: "move_player", direction: "down", steps: 1 },
      ] as ScriptCommand[],
    }),
  ],
  onFace: [],
};

const SAFARI_ZONE_GATE: MapScriptSet = {
  talk: {},
  onStep: [
    stepTrigger({ x: 3, y: 2, maxX: 4, unless: EVENT_IN_SAFARI,
                  script: safariJoinScript() }),
    stepTrigger({ x: 3, y: 2, maxX: 4, ifAll: [EVENT_IN_SAFARI],
                  script: safariLeaveScript() }),
  ],
  onFace: [],
  // The clock ran out while the player was inside: the cartridge has already
  // put them in the gate by the time it says a word ($525C).
  onEnter: [
    { op: "check_flag", flag: EVENT_SAFARI_OVER },
    { op: "jump_if_false", to: "end" },
    { op: "clear_flag", flag: EVENT_SAFARI_OVER },
  ].concat(safariOverScript() as any) as ScriptCommand[],
};

const GAME_CORNER_PRIZE_ROOM: MapScriptSet = {
  talk: {
    TEXT_GAMECORNERPRIZEROOM_PRIZE_VENDOR_1: [
      { op: "call", routine: "prize_counter", argument: "1" },
    ] as ScriptCommand[],
    TEXT_GAMECORNERPRIZEROOM_PRIZE_VENDOR_2: [
      { op: "call", routine: "prize_counter", argument: "2" },
    ] as ScriptCommand[],
    TEXT_GAMECORNERPRIZEROOM_PRIZE_VENDOR_3: [
      { op: "call", routine: "prize_counter", argument: "3" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

/**
 * Four people whose talk is a conversation with a list in the middle of it
 * (`text_asm` on the cartridge, so nothing to transcribe): Keepers.ts holds
 * the conversations, these only face the player and hand over.
 */
function keeper(textId: string, routine: string): MapScriptSet {
  const talk: any = {};
  talk[textId] = [
    { op: "face_player" },
    { op: "call", routine: routine, argument: "" },
  ] as ScriptCommand[];
  return { talk: talk, onStep: [], onFace: [] };
}

const CERULEAN_BADGE_HOUSE: MapScriptSet =
  keeper("TEXT_CERULEANBADGEHOUSE_MIDDLE_AGED_MAN", ROUTINE_BADGE_HOUSE);
const NAME_RATERS_HOUSE: MapScriptSet =
  keeper("TEXT_NAMERATERSHOUSE_NAME_RATER", ROUTINE_NAME_RATER);
const DAYCARE: MapScriptSet =
  keeper("TEXT_DAYCARE_GENTLEMAN", ROUTINE_DAY_CARE);

const SCRIPTS: any = {
  CERULEAN_BADGE_HOUSE: CERULEAN_BADGE_HOUSE,
  NAME_RATERS_HOUSE: NAME_RATERS_HOUSE,
  DAYCARE: DAYCARE,
  PALLET_TOWN: PALLET_TOWN,
  REDS_HOUSE_1F: REDS_HOUSE_1F,
  REDS_HOUSE_2F: REDS_HOUSE_2F,
  VIRIDIAN_MART: VIRIDIAN_MART,
  OAKS_LAB: OAKS_LAB,
  PEWTER_GYM: PEWTER_GYM,
  CERULEAN_GYM: CERULEAN_GYM,
  VERMILION_GYM: VERMILION_GYM,
  CELADON_GYM: CELADON_GYM,
  FUCHSIA_GYM: FUCHSIA_GYM,
  SAFFRON_GYM: SAFFRON_GYM,
  CINNABAR_GYM: CINNABAR_GYM,
  VIRIDIAN_GYM: VIRIDIAN_GYM,
  FIGHTING_DOJO: FIGHTING_DOJO,
  ROCKET_HIDEOUT_B4F: ROCKET_HIDEOUT_B4F,
  SILPH_CO_11F: SILPH_CO_11F,
  ROUTE_22: ROUTE_22,
  POKEMON_TOWER_2F: POKEMON_TOWER_2F,
  MT_MOON_B2F: MT_MOON_B2F,
  BILLS_HOUSE: BILLS_HOUSE,
  VIRIDIAN_CITY: VIRIDIAN_CITY,
  PEWTER_CITY: PEWTER_CITY,
  VERMILION_CITY: VERMILION_CITY,
  CERULEAN_CITY: CERULEAN_CITY,
  ROUTE_24: ROUTE_24,
  ROUTE_25: ROUTE_25,
  MUSEUM_1F: MUSEUM_1F,
  BIKE_SHOP: BIKE_SHOP,
  VERMILION_DOCK: VERMILION_DOCK,
  SS_ANNE_KITCHEN: SS_ANNE_KITCHEN,
  POKEMON_FAN_CLUB: POKEMON_FAN_CLUB,
  ROUTE_11_GATE_2F: ROUTE_11_GATE_2F,
  ROUTE_5_GATE: ROUTE_5_GATE,
  ROUTE_6_GATE: ROUTE_6_GATE,
  ROUTE_7_GATE: ROUTE_7_GATE,
  ROUTE_8_GATE: ROUTE_8_GATE,
  ROUTE_16_GATE_1F: ROUTE_16_GATE_1F,
  ROUTE_18_GATE_1F: ROUTE_18_GATE_1F,
  ROUTE_22_GATE: ROUTE_22_GATE,
  ROUTE_23: ROUTE_23,
  MR_FUJIS_HOUSE: MR_FUJIS_HOUSE,
  CELADON_MART_ROOF: CELADON_MART_ROOF,
  CELADON_MANSION_ROOF_HOUSE: CELADON_MANSION_ROOF_HOUSE,
  CELADON_MANSION_3F: CELADON_MANSION_3F,
  ROCKET_HIDEOUT_B1F: ROCKET_HIDEOUT_B1F,
  CELADON_MART_ELEVATOR: CELADON_MART_ELEVATOR,
  ROCKET_HIDEOUT_ELEVATOR: ROCKET_HIDEOUT_ELEVATOR,
  SILPH_CO_ELEVATOR: SILPH_CO_ELEVATOR,
  SILPH_CO_7F: SILPH_CO_7F,
  SAFFRON_CITY: SAFFRON_CITY,
  GAME_CORNER_PRIZE_ROOM: GAME_CORNER_PRIZE_ROOM,
  SAFARI_ZONE_GATE: SAFARI_ZONE_GATE,
  CINNABAR_ISLAND: CINNABAR_ISLAND,
  CHAMPIONS_ROOM: CHAMPIONS_ROOM,
  HALL_OF_FAME: HALL_OF_FAME,
  POKEMON_TOWER_6F: POKEMON_TOWER_6F,
  POKEMON_TOWER_7F: POKEMON_TOWER_7F,
  PEWTER_POKECENTER: PEWTER_POKECENTER,
  SS_ANNE_CAPTAINS_ROOM: SS_ANNE_CAPTAINS_ROOM,
  SS_ANNE_2F: SS_ANNE_2F,
  MT_MOON_POKECENTER: MT_MOON_POKECENTER,
  GAME_CORNER: GAME_CORNER,
};


/**
 * Every host routine the ported data refers to by name.
 *
 * A `call` is the escape hatch for the parts that are control flow rather than a
 * sequence, and an escape hatch with no implementation is a silent hole: a host
 * that returns DONE for an unknown routine skips the starter handoff and the
 * game carries on as if nothing were owed. There is no ScriptHost in the lens
 * yet -- the overworld play loop is F3 -- so this list is the contract the host
 * will have to satisfy, and script.test.mjs checks the data and the list against
 * each other so neither can drift.
 *
 *   rival_first_battle <ID>  -- OPP_RIVAL1, whose party depends on which
 *                               ball was opened.
 *   rival_approach <NPC>     -- walks the rival to the cell above wherever
 *                               the player stands; the row 6 trigger's own
 *                               lead-in, column-agnostic by construction.
 *   rival_beside <NPC>       -- walks the rival in from the door to the cell
 *                               beside the player, for Oak's request.
 *   rival_face_player <NPC>  -- turns him toward the player from that cell.
 *   give_tm <TM>             -- the bag check, the no-room line, and the retry.
 *   intro_stage <who>        -- a sprite on the black title stage, "" clears it.
 *   name_entry <who>         -- the naming screen; DONE once a name is committed.
 *   old_man_demo             -- the Viridian old man's WEEDLE catch, on the
 *                               battle stage; DONE when it has left the screen.
 */
export function requiredRoutines(): string[] {
  return ["rival_first_battle", "rival_battle", "rival_approach", "rival_beside",
          "rival_face_player", "rival_starter", "give_tm", "intro_stage", "name_entry",
          "old_man_demo", "old_man_demo_fail", "oak_demo",
          "sail_ship", "elevator", "prize_counter",
          "safari_start", "safari_end", "vending_machine", "credits",
          "blackboard", "link_cable_board",
          ROUTINE_BADGE_HOUSE, ROUTINE_BILLS_LIST, ROUTINE_NAME_RATER, ROUTINE_DAY_CARE];
}

/**
 * A rectangle of cells where no wild Pokemon appears.
 *
 * The cartridge's BIT_NO_BATTLES (wStatusFlags4), which a map script sets
 * while the player stands somewhere the game does not want interrupted, and
 * clears again on the step out. Two maps in Red use it as a PLACE -- Mt Moon's
 * fossil chamber and the floor of the tower where the ghost stands -- and both
 * only once the fight in the room is over.
 *
 * The cells are inclusive, in the cartridge's own x,y (`dbmapcoord x, y`
 * emits y then x, and ArePlayerCoordsInArray reads y first; the rectangle
 * below is read from the coordinate list, not from the byte order).
 */
interface QuietZone {
  map: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Every one of these must be set before the zone is quiet at all. */
  ifAll: string[];
}

const QUIET_ZONES: QuietZone[] = [
  // MtMoonB2F_Script: `CheckEvent EVENT_BEAT_MT_MOON_EXIT_SUPER_NERD / ret z`
  // first, so the room is only quiet once he is beaten; then the sixteen cells
  // of MtMoonB2FFossilAreaCoords, 11..14 by 5..8, with both fossils (12,6) and
  // (13,6) and his own cell (12,8) inside it. The flag is called
  // EVENT_BEAT_MT_MOON_3_SUPER_NERD in this project's extraction, which is the
  // reference's older name for the same bit.
  { map: "MT_MOON_B2F", x0: 11, x1: 14, y0: 5, y1: 8, ifAll: ["EVENT_BEAT_MT_MOON_3_SUPER_NERD"] },
  // PokemonTower5F.asm:16-50: the 2x2 pad at (10,8)-(11,9) sets BIT_NO_BATTLES
  // on the way in and clears it on the way out, with no flag of its own -- it
  // is quiet from the first visit.
  { map: "POKEMON_TOWER_5F", x0: 10, x1: 11, y0: 8, y1: 9, ifAll: [] },
];

/**
 * The one place in Kanto that heals you for nothing: the purified zone on the
 * fifth floor of the tower (PokemonTower5F.asm:24-43).
 *
 * Standing on the pad latches EVENT_IN_PURIFIED_ZONE, so it heals ONCE per
 * visit and not again while the player walks the four cells; stepping off
 * clears the latch. A plain step trigger on each cell would heal four times
 * over. The heal is silent -- no Center music, no respawn point -- and the
 * party comes back full.
 */
export interface HealZone {
  map: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The latch: set while the player stands on the pad. */
  flag: string;
  textId: string;
}

const HEAL_ZONES: HealZone[] = [
  { map: "POKEMON_TOWER_5F", x0: 10, x1: 11, y0: 8, y1: 9,
    flag: "EVENT_IN_PURIFIED_ZONE", textId: "_PokemonTower5FPurifiedZoneText" },
];

/** The heal zone this cell is on, or null. */
export function healZoneAt(mapId: string, x: number, y: number): HealZone {
  for (let i = 0; i < HEAL_ZONES.length; i++) {
    const zone = HEAL_ZONES[i];
    if (zone.map === mapId && x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1) {
      return zone;
    }
  }
  return null;
}

/** Every latch a heal zone owns, so stepping off any of them clears it. */
export function healZoneFlags(): string[] {
  const out: string[] = [];
  for (let i = 0; i < HEAL_ZONES.length; i++) {
    if (out.indexOf(HEAL_ZONES[i].flag) < 0) {
      out.push(HEAL_ZONES[i].flag);
    }
  }
  return out;
}

/**
 * Maps whose trainers stop watching once a flag is set.
 *
 * A map script runs before anything else on the floor and ends by falling into
 * CheckFightingMapTrainers, which is the sight scan. Twelve of Kanto's scripts
 * route around that call, and eleven of them do it for one frame only -- they
 * are running a coordinate event INSTEAD of the scan, and the scan is back on
 * the next step (Route24.asm:25-27 is the shape).
 *
 * Mt Moon B2F is the one that turns it off for good:
 *
 *   MtMoonB2FCheckGotAFossil:
 *     CheckEitherEventSet EVENT_GOT_DOME_FOSSIL, EVENT_GOT_HELIX_FOSSIL
 *     jp z, CheckFightingMapTrainers   ; NEITHER held -- scan as usual
 *     ret                              ; one in the bag -- nobody sees you
 *
 * So the four Rockets ambush you on the way in and not on the way out. One
 * entry, read from one script; the other eleven belong to their own milestones
 * and are a different shape, so there is nothing here to generalise from yet.
 */
interface SightOff {
  map: string;
  /** Any one of these set stops the scan. */
  ifAny: string[];
}

const SIGHT_OFF: SightOff[] = [
  { map: "MT_MOON_B2F", ifAny: ["EVENT_GOT_DOME_FOSSIL", "EVENT_GOT_HELIX_FOSSIL"] },
];

/** Whether this map's trainers have stopped watching. */
export function sightScanOff(mapId: string, flags: any): boolean {
  for (let i = 0; i < SIGHT_OFF.length; i++) {
    const entry = SIGHT_OFF[i];
    if (entry.map !== mapId) {
      continue;
    }
    for (let j = 0; j < entry.ifAny.length; j++) {
      if (flags[entry.ifAny[j]] === true) {
        return true;
      }
    }
  }
  return false;
}

/** Whether this cell is one the cartridge keeps wild Pokemon out of. */
export function inQuietZone(mapId: string, x: number, y: number, flags: any): boolean {
  for (let i = 0; i < QUIET_ZONES.length; i++) {
    const zone = QUIET_ZONES[i];
    if (zone.map !== mapId || x < zone.x0 || x > zone.x1 || y < zone.y0 || y > zone.y1) {
      continue;
    }
    let armed = true;
    for (let j = 0; j < zone.ifAll.length; j++) {
      if (flags[zone.ifAll[j]] !== true) {
        armed = false;
      }
    }
    if (armed) {
      return true;
    }
  }
  return false;
}

/** The face triggers of a map -- A pressed at an empty cell; [] when none. */
export function faceTriggersFor(mapId: string, version: CartridgeVersion = "red"): StepTrigger[] {
  const set = scriptsFor(mapId, version);
  return set && set.onFace ? set.onFace : [];
}

/** What a map runs on arrival; [] when it has nothing to do. */
export function enterScriptFor(mapId: string, version: CartridgeVersion = "red"): ScriptCommand[] {
  const set = scriptsFor(mapId, version);
  return set && set.onEnter ? set.onEnter : [];
}

/** The step triggers of a map, hand-written; [] when it has none. */
export function stepTriggersFor(mapId: string, version: CartridgeVersion = "red"): StepTrigger[] {
  const set = scriptsFor(mapId, version);
  return set && set.onStep ? set.onStep : [];
}

/** The first trigger on this cell whose flags allow it, or null. */
export function pickStepTrigger(triggers: StepTrigger[], x: number, y: number, flags: any,
                                hasItem?: (item: string) => boolean): StepTrigger {
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    if ((t.x !== -1 && t.x !== x) || (t.y !== -1 && t.y !== y)) {
      continue;
    }
    if (t.maxX !== -1 && x > t.maxX) {
      continue;
    }
    let armed = true;
    for (let k = 0; k < t.ifAll.length; k++) {
      if (flags[t.ifAll[k]] !== true) {
        armed = false;
      }
    }
    for (let k = 0; k < t.unless.length; k++) {
      if (flags[t.unless[k]] === true) {
        armed = false;
      }
    }
    // A key in the bag can hold one back too: CINNABAR's gym door stops
    // saying it is locked once the SECRET KEY is out of the mansion, and the
    // cartridge's own bit for that is set by picking the ball up.
    if (t.unlessItem !== "" && hasItem && hasItem(t.unlessItem)) {
      armed = false;
    }
    if (armed) {
      return t;
    }
  }
  return null;
}

/**
 * What a trainer does once he is beaten, beyond saying his line.
 *
 * The cartridge hangs this off the map script rather than the trainer: the
 * three Rockets on the tower's top floor each walk out of the room and vanish
 * (PokemonTower7F.asm:25-65 and the coordinate-keyed movement table at
 * :88-132, which picks one of five canned walks by where the PLAYER is
 * standing). Keyed "MAP:NPC"; the walk here is the one that reads right from
 * anywhere, since a scripted walk that meets a body simply stops and the hide
 * still runs.
 */
/**
 * Yellow's hand-written ports, keyed like SCRIPTS. Each entry is a map's whole
 * set, ported from pokeyellow; scriptsFor() reads it in Red's place when the
 * cartridge is Yellow.
 */
/**
 * Yellow's Game Corner is Red's with one clerk instead of two, so the coin
 * seller's object is TEXT_GAMECORNER_CLERK rather than CLERK1. The script is
 * Red's own -- his lines are the renames in TextAliases -- keyed the way the
 * Yellow map points at him. The poster and the Rocket are the same object
 * under both names.
 */
function gameCornerYellow(): MapScriptSet {
  const talk: any = {};
  for (const key of Object.keys(GAME_CORNER.talk)) {
    talk[key === "TEXT_GAMECORNER_CLERK1" ? "TEXT_GAMECORNER_CLERK" : key] = GAME_CORNER.talk[key];
  }
  return { talk: talk, onStep: GAME_CORNER.onStep, onFace: GAME_CORNER.onFace };
}

/**
 * Yellow's Viridian City, from pokeyellow's scripts/ViridianCity.asm and
 * ViridianCity_2.asm, read against gen1recomp's yellow_viridian_old_man.lua.
 *
 * Yellow has two old men where Red has one. VIRIDIANCITY_OLD_MAN2 takes the
 * sleeper's cell (18,9) the moment the Pokedex is given, and he is the
 * tutorial: stepping into (19,9), the gap beside him, with the Pokedex and the
 * lesson undone faces the two of you and runs it with no question asked --
 * the apology, a RATTATA he FAILS to catch, "I must be losing my touch", and
 * he walks off. Talking to him does the same; afterwards he only says the
 * losing-my-touch line until the mart hides him. VIRIDIANCITY_OLD_MAN at
 * (17,5), Red's walker, appears once the parcel is delivered and the lesson
 * done (ViridianMart.asm:60-69) and offers the lesson again, Red's way.
 *
 * Not ported: the companion Pikachu stepping out of his way.
 */
function viridianCityYellow(): MapScriptSet {
  const oldMan2: ScriptCommand[] = [
    { op: "check_flag", flag: "EVENT_COMPLETED_CATCH_TRAINING" },
    { op: "jump_if_true", to: "again" },
    { op: "face_player" },
    { op: "show_text", textId: "_ViridianCityOldManHadMyCoffeeNowText" },
    { op: "call", routine: "old_man_demo_fail", argument: "" },
    { op: "set_flag", flag: "EVENT_COMPLETED_CATCH_TRAINING" },
    { op: "show_text", textId: "_ViridianCityOldManLosingMyTouchText" },
    // ViridianCityPostInitialCatchTraining: from (19,9) he walks down the
    // corridor; spoken to from anywhere else he steps right once.
    { op: "check_facing", direction: "left" },
    { op: "jump_if_false", to: "aside" },
    { op: "move", npc: "VIRIDIANCITY_OLD_MAN2", path: ["down", "down", "down", "down", "down", "down"] },
    { op: "jump", to: "gone" },
    { op: "label", name: "aside" },
    { op: "move", npc: "VIRIDIANCITY_OLD_MAN2", path: ["right"] },
    { op: "label", name: "gone" },
    { op: "hide_object", map: "VIRIDIAN_CITY", npc: "VIRIDIANCITY_OLD_MAN2" },
    { op: "jump", to: "end" },
    { op: "label", name: "again" },
    { op: "face_player" },
    { op: "show_text", textId: "_ViridianCityOldManLosingMyTouchText" },
  ];
  // scripts/ViridianCity_2.asm:126: Red's walker, Yellow's words.
  const oldMan: ScriptCommand[] = [
    { op: "face_player" },
    { op: "ask", textId: "_ViridianCityOldManWantMeToShowYouAgainText" },
    { op: "jump_if_false", to: "no_thanks" },
    { op: "show_text", textId: "_ViridianCityOldManWatchCloselyText" },
    { op: "call", routine: "old_man_demo", argument: "" },
    { op: "set_flag", flag: "EVENT_COMPLETED_CATCH_TRAINING_AGAIN" },
    { op: "show_text", textId: "_ViridianCityOldManYouNeedToWeakenTheTargetText" },
    { op: "jump", to: "end" },
    { op: "label", name: "no_thanks" },
    { op: "show_text", textId: "_ViridianCityOldManNotGoodEnoughForYouText" },
  ];
  const talk: any = {};
  for (const key of Object.keys(VIRIDIAN_CITY.talk)) {
    talk[key] = VIRIDIAN_CITY.talk[key];
  }
  talk.TEXT_VIRIDIANCITY_OLD_MAN = oldMan;
  talk.TEXT_VIRIDIANCITY_OLD_MAN2 = oldMan2;
  return {
    talk: talk,
    onStep: VIRIDIAN_CITY.onStep.concat([
      // ViridianCityCheckWaitingOldMan
      stepTrigger({ x: 19, y: 9, ifAll: ["EVENT_GOT_POKEDEX"], unless: ["EVENT_COMPLETED_CATCH_TRAINING"],
                    turnPlayer: "left", talk: "TEXT_VIRIDIANCITY_OLD_MAN2" }),
    ]),
    onFace: VIRIDIAN_CITY.onFace,
  };
}

/** ViridianMart.asm:60-69: Red's walker takes over from the tutorial man. */
function viridianMartYellow(): MapScriptSet {
  return {
    talk: VIRIDIAN_MART.talk,
    onStep: VIRIDIAN_MART.onStep,
    onFace: VIRIDIAN_MART.onFace,
    onEnter: [
      { op: "check_flag", flag: "EVENT_GOT_OAKS_PARCEL" },
      { op: "jump_if_false", to: "end" },
      { op: "check_flag", flag: "EVENT_COMPLETED_CATCH_TRAINING" },
      { op: "jump_if_false", to: "end" },
      { op: "check_flag", flag: "EVENT_SPAWNED_OLD_MAN_1" },
      { op: "jump_if_true", to: "end" },
      { op: "set_flag", flag: "EVENT_SPAWNED_OLD_MAN_1" },
      { op: "hide_object", map: "VIRIDIAN_CITY", npc: "VIRIDIANCITY_OLD_MAN2" },
      { op: "show_object", map: "VIRIDIAN_CITY", npc: "VIRIDIANCITY_OLD_MAN" },
    ] as ScriptCommand[],
  };
}

/**
 * Yellow's Melanie (pokeyellow scripts/CeruleanMelaniesHouse.asm): she nursed
 * a BULBASAUR back to health and hands it to a trainer whose PIKACHU is happy
 * enough (wPikachuHappiness >= 147). The lens keeps no happiness -- the
 * companion PIKACHU is not ported -- so HAVING him in the party stands in for
 * it, and the file says so rather than giving the BULBASAUR to everyone or to
 * no one. Until 20 September her pointer resolved to nothing and talking to
 * her did nothing at all.
 */
const CERULEAN_MELANIES_HOUSE_YELLOW: MapScriptSet = {
  talk: {
    TEXT_CERULEANMELANIESHOUSE_MELANIE: [
      { op: "face_player" },
      { op: "check_flag", flag: "EVENT_GOT_BULBASAUR_IN_CERULEAN" },
      { op: "jump_if_true", to: "after" },
      { op: "show_text", textId: "MelanieText1" },
      { op: "check_party", species: "PIKACHU" },
      { op: "jump_if_false", to: "end" },
      { op: "ask", textId: "MelanieText2" },
      { op: "jump_if_false", to: "refused" },
      { op: "give_pokemon", species: "BULBASAUR", level: 10 },
      { op: "jump_if_false", to: "end" },
      { op: "show_text", textId: "MelanieText3" },
      { op: "hide_object", map: "CERULEAN_MELANIES_HOUSE", npc: "CERULEANMELANIESHOUSE_BULBASAUR" },
      { op: "set_flag", flag: "EVENT_GOT_BULBASAUR_IN_CERULEAN" },
      { op: "jump", to: "end" },
      { op: "label", name: "refused" },
      { op: "show_text", textId: "MelanieText5" },
      { op: "jump", to: "end" },
      { op: "label", name: "after" },
      { op: "show_text", textId: "MelanieText4" },
    ] as ScriptCommand[],
  },
  onStep: [],
  onFace: [],
};

const SCRIPTS_YELLOW: any = {
  CERULEAN_MELANIES_HOUSE: CERULEAN_MELANIES_HOUSE_YELLOW,
  PALLET_TOWN: PALLET_TOWN_YELLOW,
  OAKS_LAB: OAKS_LAB_YELLOW,
  GAME_CORNER: gameCornerYellow(),
  VIRIDIAN_CITY: viridianCityYellow(),
  VIRIDIAN_MART: viridianMartYellow(),
  ROCKET_HIDEOUT_B4F: ROCKET_HIDEOUT_B4F_YELLOW,
};

const TRAINER_EXITS: any = {
  "POKEMON_TOWER_7F:POKEMONTOWER7F_ROCKET1": [
    { op: "move", npc: "POKEMONTOWER7F_ROCKET1",
      path: ["right", "down", "down", "down", "down", "down"] },
    { op: "hide_object", map: "POKEMON_TOWER_7F", npc: "POKEMONTOWER7F_ROCKET1" },
  ] as ScriptCommand[],
  "POKEMON_TOWER_7F:POKEMONTOWER7F_ROCKET2": [
    { op: "move", npc: "POKEMONTOWER7F_ROCKET2",
      path: ["left", "left", "down", "down", "down", "down", "down", "down", "down"] },
    { op: "hide_object", map: "POKEMON_TOWER_7F", npc: "POKEMONTOWER7F_ROCKET2" },
  ] as ScriptCommand[],
  "POKEMON_TOWER_7F:POKEMONTOWER7F_ROCKET3": [
    { op: "move", npc: "POKEMONTOWER7F_ROCKET3",
      path: ["right", "down", "down", "down", "down", "down", "down", "down", "down", "down"] },
    { op: "hide_object", map: "POKEMON_TOWER_7F", npc: "POKEMONTOWER7F_ROCKET3" },
  ] as ScriptCommand[],
};

/** What this trainer does after losing, or [] -- see TRAINER_EXITS. */
export function trainerExitScript(mapId: string, npc: string): ScriptCommand[] {
  const rows = TRAINER_EXITS[mapId + ":" + npc];
  return rows ? rows : [];
}

/**
 * The script set for a map, or null when it has none.
 *
 * Yellow's own maps replace Red's whole set: a map ported for Yellow is read
 * against pokeyellow from top to bottom, so nothing of Red's is left to merge.
 * A map Yellow has no port of reads Red's set, whose lines are Kanto's.
 */
export function scriptsFor(mapId: string, version: CartridgeVersion = "red"): MapScriptSet {
  if (version === "yellow" && SCRIPTS_YELLOW[mapId]) {
    return SCRIPTS_YELLOW[mapId];
  }
  const set = SCRIPTS[mapId];
  return set ? set : null;
}

/**
 * The talk script for a TEXT_* id on a map, or null.
 *
 * Hand-written ports win. They exist because a map needed reading against its
 * source line by line -- the starter, the first badge, the intro -- and the
 * transcriber cannot know which of two ports is the considered one.
 */
export function talkScript(mapId: string, textId: string,
                           version: CartridgeVersion = "red"): ScriptCommand[] {
  const set = scriptsFor(mapId, version);
  if (set && set.talk) {
    const script = set.talk[textId];
    if (script) {
      return script;
    }
  }
  return transcribedScript(mapId, textId, version);
}

/** Map ids that have been ported, for the tests and for reporting progress. */
export function portedMaps(): string[] {
  return Object.keys(SCRIPTS);
}

/** Map ids Yellow has its own port of. */
export function yellowPortedMaps(): string[] {
  return Object.keys(SCRIPTS_YELLOW);
}

/** Every map with a script of any kind, hand-written or transcribed. */
export function allScriptedMaps(version: CartridgeVersion = "red"): string[] {
  const out = Object.keys(SCRIPTS);
  const more = transcribedMaps(version);
  for (let i = 0; i < more.length; i++) {
    if (out.indexOf(more[i]) < 0) {
      out.push(more[i]);
    }
  }
  return out;
}
