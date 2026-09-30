// What winning a specific battle is worth.
//
// Transcribed from gen1recomp's data/scripts/victories.lua (MIT), which is a
// hand-port of the leaders' and bosses' victory scripts in pokered
// (scripts/PewterGym.asm ... ViridianGym.asm, plus the Elite Four and the
// Fighting Dojo). Keyed "OPP_CLASS#partyIndex", which is exactly the pair a map
// object carries in `trainerClass` and `trainerParty`.
//
// The point of a table is that a reward belongs to WINNING A BATTLE, not to a
// conversation. The first cut of Pewter Gym gave the badge inline in Brock's
// talk script, which works for one gym and does not generalise: the badge is
// also owed when the battle is won some other way, the flags a victory retires
// are not the leader's own, and the NPCs it hides are on other maps entirely.
//
// Every text label below was checked against a full Kanto extraction; all of
// them exist, and test/victories.test.mjs re-checks it so a re-bake cannot
// quietly drop one.
//
// Field notes, from the reference:
//
//   badge        the badge earned. Not a bag item -- see PlayState.badges.
//   flag         EVENT_BEAT_*, set on the win.
//   item         the TM, under its ITEM id. Brock's is TM_BIDE; only the FLAG
//                is called EVENT_GOT_TM34, and reading the flag as the item id
//                is the mistake this table exists to stop.
//   gotFlag      set ONLY when the TM actually goes in the bag. That is what
//                makes a beaten leader retry the hand-over on a later
//                conversation when the bag was full at the time.
//   noRoom       the line shown instead when it is full.
//   deactivate   EVENT_BEAT_* flags the victory sets to retire the gym's other
//                trainers, so an unfought one does not stop you on the way out.
//   clear        EVENT_* flags the victory RESETS. The mirror of deactivate,
//                and it existed nowhere until Brock needed it: his post-battle
//                script closes the first Route 22 rival window with
//                `ResetEvents EVENT_1ST_ROUTE22_RIVAL_BATTLE,
//                EVENT_ROUTE22_RIVAL_WANTS_BATTLE`, and a table that can only
//                ever write true cannot say so.
//   hide         [mapId, objectName] pairs hidden by the victory, on any map.
//   dialogue     the end-battle chain: the badge line, then its explanation.
//   tmPre        the ReceiveTM lead-in, shown at the victory AND on a retry.
//   tmDialogue   shown only when the TM actually lands.
//   badgeSound   the text sound that plays between the pages of the badge line.
//   tmSound      likewise for the TM line.
//
// Brock's and Misty's sounds have been read against their own gym scripts.
// Misty's (CeruleanGym.asm:139-151): sound_get_item_1 inside the TM11 line,
// sound_get_key_item inside the badge line -- the asm notes that the latter
// actually comes out as one channel of SFX_BALL_POOF on the cartridge because
// the wrong music bank is loaded; the row keeps the sound the script asks for.
// Counted across pret/pokered's eight gym scripts on 11 September, for whoever
// gets to the next one: sound_level_up appears in PewterGym and ViridianGym
// and nowhere else, and sound_get_item_1 in all of them EXCEPT VermilionGym
// and FuchsiaGym, which play nothing at all. Several rows below disagree with
// that count. They are left alone rather than corrected from a grep, because
// each belongs to a milestone that will read its own script.

export interface Victory {
  badge: string;
  flag: string;
  item: string;
  gotFlag: string;
  noRoom: string;
  badgeSound: string;
  tmSound: string;
  deactivate: string[];
  clear: string[];
  hide: string[][];
  dialogue: string[];
  tmPre: string[];
  tmDialogue: string[];
}

/** Keyed "OPP_CLASS#partyIndex". Plain object: Lens Studio forbids Map<>. */
const VICTORIES: any = {
  "OPP_AGATHA#1": {
    badge: "", flag: "EVENT_BEAT_AGATHAS_ROOM_TRAINER_0",
    item: "", gotFlag: "",
    noRoom: "",
    badgeSound: "", tmSound: "",
    deactivate: [],
    clear: [],
    hide: [],
    dialogue: [],
    tmPre: [],
    tmDialogue: [],
  },
  "OPP_BLACKBELT#1": {
    badge: "", flag: "EVENT_BEAT_KARATE_MASTER",
    item: "", gotFlag: "",
    noRoom: "",
    badgeSound: "", tmSound: "",
    deactivate: ["EVENT_BEAT_FIGHTING_DOJO_TRAINER_0", "EVENT_BEAT_FIGHTING_DOJO_TRAINER_1", "EVENT_BEAT_FIGHTING_DOJO_TRAINER_2", "EVENT_BEAT_FIGHTING_DOJO_TRAINER_3"],
    clear: [],
    hide: [],
    dialogue: ["_FightingDojoKarateMasterIWillGiveYouAPokemonText"],
    tmPre: [],
    tmDialogue: [],
  },
  "OPP_BLAINE#1": {
    badge: "VOLCANOBADGE", flag: "EVENT_BEAT_BLAINE",
    item: "TM_FIRE_BLAST", gotFlag: "EVENT_GOT_TM38",
    noRoom: "_CinnabarGymBlaineTM38NoRoomText",
    badgeSound: "Get_Key_Item", tmSound: "Get_Item1",
    deactivate: ["EVENT_BEAT_CINNABAR_GYM_TRAINER_0", "EVENT_BEAT_CINNABAR_GYM_TRAINER_1", "EVENT_BEAT_CINNABAR_GYM_TRAINER_2", "EVENT_BEAT_CINNABAR_GYM_TRAINER_3", "EVENT_BEAT_CINNABAR_GYM_TRAINER_4", "EVENT_BEAT_CINNABAR_GYM_TRAINER_5", "EVENT_BEAT_CINNABAR_GYM_TRAINER_6"],
    clear: [],
    hide: [],
    dialogue: ["_CinnabarGymBlaineReceivedVolcanoBadgeText"],
    tmPre: ["_CinnabarGymBlaineVolcanoBadgeInfoText"],
    tmDialogue: ["_CinnabarGymBlaineReceivedTM38Text", "_CinnabarGymBlaineTM38ExplanationText"],
  },
  "OPP_BROCK#1": {
    badge: "BOULDERBADGE", flag: "EVENT_BEAT_BROCK",
    item: "TM_BIDE", gotFlag: "EVENT_GOT_TM34",
    noRoom: "_PewterGymTM34NoRoomText",
    // sound_level_up, with pokered's own comment beside it that it is probably
    // meant to be SFX_GET_ITEM_1 and the wrong bank is loaded. The cartridge
    // plays what it plays.
    badgeSound: "Level_Up", tmSound: "Get_Item1",
    deactivate: ["EVENT_BEAT_PEWTER_GYM_TRAINER_0"],
    clear: ["EVENT_1ST_ROUTE22_RIVAL_BATTLE", "EVENT_ROUTE22_RIVAL_WANTS_BATTLE"],
    hide: [["PEWTER_CITY", "PEWTERCITY_YOUNGSTER"], ["ROUTE_22", "ROUTE22_RIVAL1"]],
    dialogue: ["_PewterGymBrockReceivedBoulderBadgeText", "_PewterGymBrockBoulderBadgeInfoText"],
    tmPre: ["_PewterGymBrockWaitTakeThisText"],
    tmDialogue: ["_PewterGymReceivedTM34Text", "_TM34ExplanationText"],
  },
  "OPP_BRUNO#1": {
    badge: "", flag: "EVENT_BEAT_BRUNOS_ROOM_TRAINER_0",
    item: "", gotFlag: "",
    noRoom: "",
    badgeSound: "", tmSound: "",
    deactivate: [],
    clear: [],
    hide: [],
    dialogue: [],
    tmPre: [],
    tmDialogue: [],
  },
  "OPP_ERIKA#1": {
    badge: "RAINBOWBADGE", flag: "EVENT_BEAT_ERIKA",
    item: "TM_MEGA_DRAIN", gotFlag: "EVENT_GOT_TM21",
    noRoom: "_CeladonGymTM21NoRoomText",
    badgeSound: "", tmSound: "Get_Item1",
    deactivate: ["EVENT_BEAT_CELADON_GYM_TRAINER_0", "EVENT_BEAT_CELADON_GYM_TRAINER_1", "EVENT_BEAT_CELADON_GYM_TRAINER_2", "EVENT_BEAT_CELADON_GYM_TRAINER_3", "EVENT_BEAT_CELADON_GYM_TRAINER_4", "EVENT_BEAT_CELADON_GYM_TRAINER_5", "EVENT_BEAT_CELADON_GYM_TRAINER_6"],
    clear: [],
    hide: [],
    dialogue: ["_CeladonGymErikaReceivedRainbowBadgeText"],
    tmPre: ["_CeladonGymRainbowBadgeInfoText"],
    tmDialogue: ["_CeladonGymReceivedTM21Text", "_TM21ExplanationText"],
  },
  "OPP_GIOVANNI#2": {
    badge: "", flag: "EVENT_BEAT_SILPH_CO_GIOVANNI",
    item: "", gotFlag: "",
    noRoom: "",
    badgeSound: "", tmSound: "",
    deactivate: [],
    clear: [],
    hide: [],
    dialogue: ["_SilphCo10FGiovanniILostAgainText"],
    tmPre: [],
    tmDialogue: [],
  },
  "OPP_GIOVANNI#3": {
    badge: "EARTHBADGE", flag: "EVENT_BEAT_GIOVANNI",
    item: "TM_FISSURE", gotFlag: "EVENT_GOT_TM27",
    noRoom: "_ViridianGymGiovanniTM27NoRoomText",
    badgeSound: "Get_Item1", tmSound: "Get_Item1",
    deactivate: ["EVENT_BEAT_VIRIDIAN_GYM_TRAINER_0", "EVENT_BEAT_VIRIDIAN_GYM_TRAINER_1", "EVENT_BEAT_VIRIDIAN_GYM_TRAINER_2", "EVENT_BEAT_VIRIDIAN_GYM_TRAINER_3", "EVENT_BEAT_VIRIDIAN_GYM_TRAINER_4", "EVENT_BEAT_VIRIDIAN_GYM_TRAINER_5", "EVENT_BEAT_VIRIDIAN_GYM_TRAINER_6", "EVENT_BEAT_VIRIDIAN_GYM_TRAINER_7"],
    clear: [],
    hide: [],
    dialogue: ["_ViridianGymGiovanniReceivedEarthBadgeText"],
    tmPre: ["_ViridianGymGiovanniEarthBadgeInfoText"],
    tmDialogue: ["_ViridianGymGiovanniReceivedTM27Text", "_ViridianGymGiovanniTM27ExplanationText"],
  },
  "OPP_KOGA#1": {
    badge: "SOULBADGE", flag: "EVENT_BEAT_KOGA",
    item: "TM_TOXIC", gotFlag: "EVENT_GOT_TM06",
    noRoom: "_FuchsiaGymKogaTM06NoRoomText",
    badgeSound: "", tmSound: "Get_Key_Item",
    deactivate: ["EVENT_BEAT_FUCHSIA_GYM_TRAINER_0", "EVENT_BEAT_FUCHSIA_GYM_TRAINER_1", "EVENT_BEAT_FUCHSIA_GYM_TRAINER_2", "EVENT_BEAT_FUCHSIA_GYM_TRAINER_3", "EVENT_BEAT_FUCHSIA_GYM_TRAINER_4", "EVENT_BEAT_FUCHSIA_GYM_TRAINER_5"],
    clear: [],
    hide: [],
    dialogue: ["_FuchsiaGymKogaReceivedSoulBadgeText"],
    tmPre: ["_FuchsiaGymKogaSoulBadgeInfoText"],
    tmDialogue: ["_FuchsiaGymKogaReceivedTM06Text", "_FuchsiaGymKogaTM06ExplanationText"],
  },
  "OPP_LANCE#1": {
    badge: "", flag: "EVENT_BEAT_LANCE",
    item: "", gotFlag: "",
    noRoom: "",
    badgeSound: "", tmSound: "",
    deactivate: [],
    clear: [],
    hide: [],
    dialogue: [],
    tmPre: [],
    tmDialogue: [],
  },
  "OPP_LORELEI#1": {
    badge: "", flag: "EVENT_BEAT_LORELEIS_ROOM_TRAINER_0",
    item: "", gotFlag: "",
    noRoom: "",
    badgeSound: "", tmSound: "",
    deactivate: [],
    clear: [],
    hide: [],
    dialogue: [],
    tmPre: [],
    tmDialogue: [],
  },
  "OPP_LT_SURGE#1": {
    badge: "THUNDERBADGE", flag: "EVENT_BEAT_LT_SURGE",
    item: "TM_THUNDERBOLT", gotFlag: "EVENT_GOT_TM24",
    noRoom: "_VermilionGymLTSurgeTM24NoRoomText",
    badgeSound: "", tmSound: "Get_Key_Item",
    deactivate: ["EVENT_BEAT_VERMILION_GYM_TRAINER_0", "EVENT_BEAT_VERMILION_GYM_TRAINER_1", "EVENT_BEAT_VERMILION_GYM_TRAINER_2"],
    clear: [],
    hide: [],
    dialogue: ["_VermilionGymLTSurgeReceivedThunderBadgeText"],
    tmPre: ["_VermilionGymLTSurgeThunderBadgeInfoText"],
    tmDialogue: ["_VermilionGymLTSurgeReceivedTM24Text", "_TM24ExplanationText"],
  },
  "OPP_MISTY#1": {
    badge: "CASCADEBADGE", flag: "EVENT_BEAT_MISTY",
    item: "TM_BUBBLEBEAM", gotFlag: "EVENT_GOT_TM11",
    noRoom: "_CeruleanGymMistyTM11NoRoomText",
    badgeSound: "Get_Key_Item", tmSound: "Get_Item1",
    deactivate: ["EVENT_BEAT_CERULEAN_GYM_TRAINER_0", "EVENT_BEAT_CERULEAN_GYM_TRAINER_1"],
    clear: [],
    hide: [],
    dialogue: ["_CeruleanGymMistyReceivedCascadeBadgeText"],
    tmPre: ["_CeruleanGymMistyCascadeBadgeInfoText"],
    tmDialogue: ["_CeruleanGymMistyReceivedTM11Text"],
  },
  "OPP_SABRINA#1": {
    badge: "MARSHBADGE", flag: "EVENT_BEAT_SABRINA",
    item: "TM_PSYWAVE", gotFlag: "EVENT_GOT_TM46",
    noRoom: "_SaffronGymSabrinaTM46NoRoomText",
    badgeSound: "Get_Key_Item", tmSound: "Get_Item1",
    deactivate: ["EVENT_BEAT_SAFFRON_GYM_TRAINER_0", "EVENT_BEAT_SAFFRON_GYM_TRAINER_1", "EVENT_BEAT_SAFFRON_GYM_TRAINER_2", "EVENT_BEAT_SAFFRON_GYM_TRAINER_3", "EVENT_BEAT_SAFFRON_GYM_TRAINER_4", "EVENT_BEAT_SAFFRON_GYM_TRAINER_5", "EVENT_BEAT_SAFFRON_GYM_TRAINER_6"],
    clear: [],
    hide: [],
    dialogue: ["_SaffronGymSabrinaReceivedMarshBadgeText"],
    tmPre: ["_SaffronGymSabrinaMarshBadgeInfoText"],
    tmDialogue: ["_SaffronGymSabrinaReceivedTM46Text", "_TM46ExplanationText"],
  },
};

/** The reward for beating this trainer with this roster, or null. */
export function victoryFor(trainerId: string, partyIndex: number): Victory {
  const found = VICTORIES[trainerId + "#" + partyIndex];
  return found ? found : null;
}

/** Every key, for the tests and for reporting how much of the game is covered. */
export function victoryKeys(): string[] {
  return Object.keys(VICTORIES);
}
