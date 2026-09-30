// Map scripts transcribed from gen1recomp's data/scripts, by tools/transcribe.py.
//
// 81 maps, 154 scripts (47 of them expanded from the reference's
// helpers). GENERATED -- edit the transcriber, not this file. Regenerate with:
//
//   python3 tools/transcribe.py "$WORK/g1r/data/scripts" <red bundle.json> \
//       /tmp/ported.json --yellow <yellow bundle.json> \
//       --ts Assets/Scripts/play/script/PortedMaps.ts
//
// The reference's rows are very nearly the shape ScriptVM already reads, and the
// differences are exactly the kind that land INSIDE a program and run the wrong
// command, which is why this is a tool and not a copy-and-paste:
//
//   * Its jump targets are ONE-based. Ours are zero-based indices. A jump past
//     the last row is how it spells "stop", so those become "end".
//   * Its arguments are positional; ours are named, per op.
//   * An object may be named by INDEX, which resolves here against the bundle's
//     own `index` field rather than teaching the VM a second way to name an NPC.
//   * Scripts the reference builds with a helper (gift, badgeGuard, rodGiver...)
//     are expanded from the helper's Lua into label-based command lists. Items
//     in them are named by ID (`ramItem`) and resolved to their display name
//     at runtime from the player's own bundle.
//
// Anything the transcriber could not translate faithfully was SKIPPED and
// reported rather than half-ported: a map that looks finished and behaves wrong
// is worse than one that has no script at all, and a map with no script still
// works -- its NPCs and signs resolve their text straight out of the cartridge.
//
// MapScripts.ts holds the hand-written ports (Pallet Town, Red's house, Oak's
// lab, Pewter Gym, the intro) and takes precedence over anything here.

import type { ScriptCommand } from "./ScriptVM";
import type { CartridgeVersion } from "../../world/Cartridge";

const PORTED: any = {
  "BIKE_SHOP": {
    "talk": {
      "TEXT_BIKESHOP_MIDDLE_AGED_WOMAN": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_BikeShopMiddleAgedWomanText"
        }
      ],
      "TEXT_BIKESHOP_YOUNGSTER": [
        {
          "op": "face_player"
        },
        {
          "item": "BICYCLE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_BikeShopYoungsterTheseBikesAreExpensiveText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_BikeShopYoungsterCoolBikeText"
        }
      ]
    }
  },
  "BILLS_HOUSE": {
    "talk": {
      "TEXT_BILLSHOUSE_BILL_CHECK_OUT_MY_RARE_POKEMON": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_BillsHouseBillCheckOutMyRarePokemonText"
        }
      ],
      "TEXT_BILLSHOUSE_BILL_SS_TICKET": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_SS_TICKET",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 11
        },
        {
          "op": "show_text",
          "textId": "_BillsHouseBillThankYouText"
        },
        {
          "count": 1,
          "item": "S_S_TICKET",
          "noRoom": "_SSTicketNoRoomText",
          "op": "give_item"
        },
        {
          "op": "show_text",
          "textId": "_SSTicketReceivedText"
        },
        {
          "flag": "EVENT_GOT_SS_TICKET",
          "op": "set_flag"
        },
        {
          "map": "CERULEAN_CITY",
          "npc": "CERULEANCITY_GUARD1",
          "op": "show_object"
        },
        {
          "map": "CERULEAN_CITY",
          "npc": "CERULEANCITY_GUARD2",
          "op": "hide_object"
        },
        {
          "op": "show_text",
          "textId": "_BillsHouseBillWhyDontYouGoInsteadOfMeText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_BillsHouseBillWhyDontYouGoInsteadOfMeText"
        }
      ]
    }
  },
  "BLUES_HOUSE": {
    "talk": {
      "TEXT_BLUESHOUSE_DAISY_SITTING": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_TOWN_MAP",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "got_map"
        },
        {
          "flag": "EVENT_GOT_POKEDEX",
          "op": "check_flag"
        },
        {
          "op": "jump_if_false",
          "to": "too_early"
        },
        {
          "op": "show_text",
          "textId": "_BluesHouseDaisyOfferMapText"
        },
        {
          "count": 1,
          "item": "TOWN_MAP",
          "op": "give_item"
        },
        {
          "op": "show_text",
          "textId": "_GotMapText"
        },
        {
          "map": "BLUES_HOUSE",
          "npc": "BLUESHOUSE_TOWN_MAP",
          "op": "hide_object"
        },
        {
          "flag": "EVENT_GOT_TOWN_MAP",
          "op": "set_flag"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "got_map",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_BluesHouseDaisyUseMapText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "too_early",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_BluesHouseDaisyRivalAtLabText"
        }
      ]
    }
  },
  "CELADON_CITY": {
    "talk": {
      "TEXT_CELADONCITY_GRAMPS3": [
        {
          "flag": "EVENT_GOT_TM41",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "ramItem": "TM_SOFTBOILED",
          "textId": "_CeladonCityGramps3Text"
        },
        {
          "count": 1,
          "item": "TM_SOFTBOILED",
          "noRoom": "_CeladonCityGramps3TM41NoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_TM41",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "TM_SOFTBOILED",
          "textId": "_CeladonCityGramps3ReceivedTM41Text"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "TM_SOFTBOILED",
          "textId": "_CeladonCityGramps3TM41ExplanationText"
        }
      ],
      "TEXT_CELADONCITY_POLIWRATH": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_CeladonCityPoliwrathText"
        },
        {
          "op": "play_cry",
          "species": "POLIWRATH"
        }
      ]
    }
  },
  "CELADON_DINER": {
    "talk": {
      "TEXT_CELADONDINER_GYM_GUIDE": [
        {
          "flag": "EVENT_GOT_COIN_CASE",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "ramItem": "COIN_CASE",
          "textId": "_CeladonDinerGymGuideImFlatOutBustedText"
        },
        {
          "count": 1,
          "item": "COIN_CASE",
          "noRoom": "_CeladonDinerGymGuideCoinCaseNoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_COIN_CASE",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "COIN_CASE",
          "textId": "_CeladonDinerGymGuideReceivedCoinCaseText"
        },
        {
          "name": "Get_Key_Item",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "COIN_CASE",
          "textId": "_CeladonDinerGymGuideWinItBackText"
        }
      ]
    }
  },
  "CELADON_MANSION_1F": {
    "talk": {
      "TEXT_CELADONMANSION1F_CLEFAIRY": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_CeladonMansion1FClefairyText"
        },
        {
          "op": "play_cry",
          "species": "CLEFAIRY"
        }
      ],
      "TEXT_CELADONMANSION1F_MEOWTH": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_CeladonMansion1FMeowthText"
        },
        {
          "op": "play_cry",
          "species": "MEOWTH"
        }
      ],
      "TEXT_CELADONMANSION1F_NIDORANF": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_CeladonMansion1FNidoranFText"
        },
        {
          "op": "play_cry",
          "species": "NIDORAN_F"
        }
      ]
    }
  },
  "CELADON_MART_3F": {
    "talk": {
      "TEXT_CELADONMART3F_CLERK": [
        {
          "flag": "EVENT_GOT_TM18",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "ramItem": "TM_COUNTER",
          "textId": "_CeladonMart3FClerkTM18PreReceiveText"
        },
        {
          "count": 1,
          "item": "TM_COUNTER",
          "noRoom": "_CeladonMart3FClerkTM18NoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_TM18",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "TM_COUNTER",
          "textId": "_CeladonMart3FClerkReceivedTM18Text"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "TM_COUNTER",
          "textId": "_CeladonMart3FClerkTM18ExplanationText"
        }
      ]
    }
  },
  "CERULEAN_CAVE_B1F": {
    "talk": {
      "TEXT_CERULEANCAVEB1F_MEWTWO": [
        {
          "flag": "EVENT_BEAT_MEWTWO",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "play_music",
          "track": "Music_MeetMaleTrainer"
        },
        {
          "op": "show_text",
          "textId": "_MewtwoBattleText"
        },
        {
          "op": "play_cry",
          "species": "MEWTWO"
        },
        {
          "flag": "EVENT_BEAT_MEWTWO",
          "level": 70,
          "op": "static_battle",
          "species": "MEWTWO"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_MewtwoBattleText"
        },
        {
          "op": "play_cry",
          "species": "MEWTWO"
        }
      ]
    }
  },
  "CERULEAN_GYM": {
    "talk": {
      "TEXT_CERULEANGYM_GYM_GUIDE": [
        {
          "flag": "EVENT_BEAT_MISTY",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "show_text",
          "textId": "_CeruleanGymGymGuideChampInMakingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_CeruleanGymGymGuideBeatMistyText"
        }
      ]
    }
  },
  "CERULEAN_TRADE_HOUSE": {
    "talk": {
      "TEXT_CERULEANTRADEHOUSE_GAMBLER": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_POLIWHIRL_FOR_JYNX",
          "index": 7,
          "op": "trade"
        }
      ],
      "TEXT_CERULEANTRADEHOUSE_GRANNY": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_CeruleanTradeHouseGrannyText"
        }
      ]
    }
  },
  "CERULEAN_TRASHED_HOUSE": {
    "talk": {
      "TEXT_CERULEANTRASHEDHOUSE_FISHING_GURU": [
        {
          "item": "TM_DIG",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": 4
        },
        {
          "op": "show_text",
          "textId": "_CeruleanTrashedHouseFishingGuruTheyStoleATMText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_CeruleanTrashedHouseFishingGuruWhatsLostIsLostText"
        }
      ]
    }
  },
  "CINNABAR_GYM": {
    "talk": {
      "TEXT_CINNABARGYM_GYM_GUIDE": [
        {
          "flag": "EVENT_BEAT_BLAINE",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "show_text",
          "textId": "_CinnabarGymGymGuideChampInMakingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_CinnabarGymGymGuideBeatBlaineText"
        }
      ]
    }
  },
  "CINNABAR_LAB_FOSSIL_ROOM": {
    "talk": {
      "TEXT_CINNABARLABFOSSILROOM_SCIENTIST2": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_PONYTA_FOR_SEEL",
          "index": 4,
          "op": "trade"
        }
      ]
    }
  },
  "CINNABAR_LAB_METRONOME_ROOM": {
    "talk": {
      "TEXT_CINNABARLABMETRONOMEROOM_SCIENTIST1": [
        {
          "flag": "EVENT_GOT_TM35",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "ramItem": "TM_METRONOME",
          "textId": "_CinnabarLabMetronomeRoomScientist1Text"
        },
        {
          "count": 1,
          "item": "TM_METRONOME",
          "noRoom": "_CinnabarLabMetronomeRoomScientist1TM35NoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_TM35",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "TM_METRONOME",
          "textId": "_CinnabarLabMetronomeRoomScientist1ReceivedTM35Text"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "TM_METRONOME",
          "textId": "_CinnabarLabMetronomeRoomScientist1TM35ExplanationText"
        }
      ]
    }
  },
  "CINNABAR_LAB_TRADE_ROOM": {
    "talk": {
      "TEXT_CINNABARLABTRADEROOM_BEAUTY": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_VENONAT_FOR_TANGELA",
          "index": 9,
          "op": "trade"
        }
      ],
      "TEXT_CINNABARLABTRADEROOM_GRAMPS": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_RAICHU_FOR_ELECTRODE",
          "index": 8,
          "op": "trade"
        }
      ]
    }
  },
  "COPYCATS_HOUSE_1F": {
    "talk": {
      "TEXT_COPYCATSHOUSE1F_CHANSEY": [
        {
          "op": "show_text",
          "textId": "_CopycatsHouse1FChanseyText"
        },
        {
          "op": "play_cry",
          "species": "CHANSEY"
        }
      ]
    }
  },
  "FIGHTING_DOJO": {
    "talk": {
      "TEXT_FIGHTINGDOJO_HITMONCHAN_POKE_BALL": [
        {
          "flag": "EVENT_GOT_HITMONLEE",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "greedy"
        },
        {
          "flag": "EVENT_GOT_HITMONCHAN",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "greedy"
        },
        {
          "flag": "EVENT_BEAT_KARATE_MASTER",
          "op": "check_flag"
        },
        {
          "op": "jump_if_false",
          "to": "not_yet"
        },
        {
          "op": "mark_seen",
          "species": "HITMONCHAN"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "HITMONCHAN"
        },
        {
          "op": "ask",
          "textId": "_FightingDojoHitmonchanPokeBallText"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "level": 30,
          "op": "give_pokemon",
          "species": "HITMONCHAN"
        },
        {
          "op": "jump_if_false",
          "to": "box_full"
        },
        {
          "map": "FIGHTING_DOJO",
          "npc": "FIGHTINGDOJO_HITMONCHAN_POKE_BALL",
          "op": "hide_object"
        },
        {
          "flag": "EVENT_GOT_HITMONCHAN",
          "op": "set_flag"
        },
        {
          "flag": "EVENT_DEFEATED_FIGHTING_DOJO",
          "op": "set_flag"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "box_full",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_BoxIsFullText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "greedy",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_FightingDojoBetterNotGetGreedyText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "not_yet",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "You'll have to\nbeat the master\nfirst!"
        }
      ],
      "TEXT_FIGHTINGDOJO_HITMONLEE_POKE_BALL": [
        {
          "flag": "EVENT_GOT_HITMONLEE",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "greedy"
        },
        {
          "flag": "EVENT_GOT_HITMONCHAN",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "greedy"
        },
        {
          "flag": "EVENT_BEAT_KARATE_MASTER",
          "op": "check_flag"
        },
        {
          "op": "jump_if_false",
          "to": "not_yet"
        },
        {
          "op": "mark_seen",
          "species": "HITMONLEE"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "HITMONLEE"
        },
        {
          "op": "ask",
          "textId": "_FightingDojoHitmonleePokeBallText"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "level": 30,
          "op": "give_pokemon",
          "species": "HITMONLEE"
        },
        {
          "op": "jump_if_false",
          "to": "box_full"
        },
        {
          "map": "FIGHTING_DOJO",
          "npc": "FIGHTINGDOJO_HITMONLEE_POKE_BALL",
          "op": "hide_object"
        },
        {
          "flag": "EVENT_GOT_HITMONLEE",
          "op": "set_flag"
        },
        {
          "flag": "EVENT_DEFEATED_FIGHTING_DOJO",
          "op": "set_flag"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "box_full",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_BoxIsFullText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "greedy",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_FightingDojoBetterNotGetGreedyText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "not_yet",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "You'll have to\nbeat the master\nfirst!"
        }
      ]
    }
  },
  "FUCHSIA_CITY": {
    "talk": {
      "TEXT_FUCHSIACITY_CHANSEY_SIGN": [
        {
          "op": "show_text",
          "textId": "_FuchsiaCityChanseySignText"
        },
        {
          "op": "mark_seen",
          "species": "CHANSEY"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "CHANSEY"
        }
      ],
      "TEXT_FUCHSIACITY_FOSSIL_SIGN": [
        {
          "flag": "EVENT_GOT_DOME_FOSSIL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 6
        },
        {
          "flag": "EVENT_GOT_HELIX_FOSSIL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 10
        },
        {
          "op": "show_text",
          "textId": "_FuchsiaCityFossilSignUndeterminedText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_FuchsiaCityFossilSignOmanyteText"
        },
        {
          "op": "mark_seen",
          "species": "OMANYTE"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "OMANYTE"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_FuchsiaCityFossilSignKabutoText"
        },
        {
          "op": "mark_seen",
          "species": "KABUTO"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "KABUTO"
        }
      ],
      "TEXT_FUCHSIACITY_KANGASKHAN_SIGN": [
        {
          "op": "show_text",
          "textId": "_FuchsiaCityKangaskhanSignText"
        },
        {
          "op": "mark_seen",
          "species": "KANGASKHAN"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "KANGASKHAN"
        }
      ],
      "TEXT_FUCHSIACITY_LAPRAS_SIGN": [
        {
          "op": "show_text",
          "textId": "_FuchsiaCityLaprasSignText"
        },
        {
          "op": "mark_seen",
          "species": "LAPRAS"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "LAPRAS"
        }
      ],
      "TEXT_FUCHSIACITY_SLOWPOKE_SIGN": [
        {
          "op": "show_text",
          "textId": "_FuchsiaCitySlowpokeSignText"
        },
        {
          "op": "mark_seen",
          "species": "SLOWPOKE"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "SLOWPOKE"
        }
      ],
      "TEXT_FUCHSIACITY_VOLTORB_SIGN": [
        {
          "op": "show_text",
          "textId": "_FuchsiaCityVoltorbSignText"
        },
        {
          "op": "mark_seen",
          "species": "VOLTORB"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "VOLTORB"
        }
      ]
    }
  },
  "FUCHSIA_GOOD_ROD_HOUSE": {
    "talk": {
      "TEXT_FUCHSIAGOODRODHOUSE_FISHING_GURU": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_GOOD_ROD",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already_got"
        },
        {
          "op": "ask",
          "textId": "_FuchsiaGoodRodHouseFishingGuruText"
        },
        {
          "op": "jump_if_false",
          "to": "refused"
        },
        {
          "count": 1,
          "item": "GOOD_ROD",
          "noRoom": "_FuchsiaGoodRodHouseFishingGuruNoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_GOOD_ROD",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "GOOD_ROD",
          "textId": "_FuchsiaGoodRodHouseFishingGuruReceivedGoodRodText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "refused",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_FuchsiaGoodRodHouseFishingGuruThatsSoDisappointingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already_got",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_FuchsiaGoodRodHouseFishingGuruHowAreTheFishText"
        }
      ]
    }
  },
  "FUCHSIA_GYM": {
    "talk": {
      "TEXT_FUCHSIAGYM_GYM_GUIDE": [
        {
          "flag": "EVENT_BEAT_KOGA",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "show_text",
          "textId": "_FuchsiaGymGymGuideChampInMakingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_FuchsiaGymGymGuideBeatKogaText"
        }
      ]
    }
  },
  "GAME_CORNER": {
    "talk": {
      "TEXT_GAMECORNER_CLERK2": [
        {
          "flag": "EVENT_GOT_20_COINS_2",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerClerk2WantSomeCoinsText"
        },
        {
          "item": "COIN_CASE",
          "op": "check_item"
        },
        {
          "op": "jump_if_false",
          "to": "no_case"
        },
        {
          "amount": 9990,
          "op": "check_coins"
        },
        {
          "op": "jump_if_true",
          "to": "full"
        },
        {
          "amount": 20,
          "op": "give_coins"
        },
        {
          "flag": "EVENT_GOT_20_COINS_2",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerClerk2Received20CoinsText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "no_case",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerOopsForgotCoinCaseText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "full",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerClerk2YouHaveLotsOfCoinsText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerClerk2INeedMoreCoinsText"
        }
      ],
      "TEXT_GAMECORNER_FISHING_GURU": [
        {
          "flag": "EVENT_GOT_10_COINS",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuruWantToPlayText"
        },
        {
          "item": "COIN_CASE",
          "op": "check_item"
        },
        {
          "op": "jump_if_false",
          "to": "no_case"
        },
        {
          "amount": 9990,
          "op": "check_coins"
        },
        {
          "op": "jump_if_true",
          "to": "full"
        },
        {
          "amount": 10,
          "op": "give_coins"
        },
        {
          "flag": "EVENT_GOT_10_COINS",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuruReceived10CoinsText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "no_case",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerOopsForgotCoinCaseText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "full",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuruDontNeedMyCoinsText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuruWinsComeAndGoText"
        }
      ],
      "TEXT_GAMECORNER_GENTLEMAN": [
        {
          "flag": "EVENT_GOT_20_COINS",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerGentlemanThrowingMeOffText"
        },
        {
          "item": "COIN_CASE",
          "op": "check_item"
        },
        {
          "op": "jump_if_false",
          "to": "no_case"
        },
        {
          "amount": 9990,
          "op": "check_coins"
        },
        {
          "op": "jump_if_true",
          "to": "full"
        },
        {
          "amount": 20,
          "op": "give_coins"
        },
        {
          "flag": "EVENT_GOT_20_COINS",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerGentlemanReceived20CoinsText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "no_case",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerOopsForgotCoinCaseText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "full",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerGentlemanYouGotYourOwnCoinsText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerGentlemanCloselyWatchTheReelsText"
        }
      ],
      "TEXT_GAMECORNER_GYM_GUIDE": [
        {
          "flag": "EVENT_BEAT_ERIKA",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerGymGuideChampInMakingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerGymGuideTheyOfferRarePokemonText"
        }
      ]
    }
  },
  "LAVENDER_CUBONE_HOUSE": {
    "talk": {
      "TEXT_LAVENDERCUBONEHOUSE_BRUNETTE_GIRL": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_RESCUED_MR_FUJI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_LavenderCuboneHouseBrunetteGirlPoorCubonesMotherText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_LavenderCuboneHouseBrunetteGirlGhostIsGoneText"
        }
      ],
      "TEXT_LAVENDERCUBONEHOUSE_CUBONE": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_LavenderCuboneHouseCuboneText"
        },
        {
          "op": "play_cry",
          "species": "CUBONE"
        }
      ]
    }
  },
  "LAVENDER_MART": {
    "talk": {
      "TEXT_LAVENDERMART_COOLTRAINER_M": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_RESCUED_MR_FUJI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_LavenderMartCooltrainerMReviveText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_LavenderMartCooltrainerMNuggetText"
        }
      ]
    }
  },
  "LAVENDER_TOWN": {
    "talk": {
      "TEXT_LAVENDERTOWN_LITTLE_GIRL": [
        {
          "op": "face_player"
        },
        {
          "op": "ask",
          "textId": "_LavenderTownLittleGirlDoYouBelieveInGhostsText"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_LavenderTownLittleGirlHaHaGuessNotText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_LavenderTownLittleGirlSoThereAreBelieversText"
        }
      ]
    }
  },
  "MR_FUJIS_HOUSE": {
    "talk": {
      "TEXT_MRFUJISHOUSE_LITTLE_GIRL": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_RESCUED_MR_FUJI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_MrFujisHouseLittleGirlThisIsMrFujisHouseText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_MrFujisHouseLittleGirlPokemonAreNiceToHugText"
        }
      ],
      "TEXT_MRFUJISHOUSE_MR_FUJI": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_POKE_FLUTE",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 11
        },
        {
          "flag": "EVENT_RESCUED_MR_FUJI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_false",
          "to": 13
        },
        {
          "op": "show_text",
          "textId": "_MrFujisHouseMrFujiIThinkThisMayHelpYourQuestText"
        },
        {
          "count": 1,
          "item": "POKE_FLUTE",
          "op": "give_item"
        },
        {
          "op": "show_text",
          "textId": "_MrFujisHouseMrFujiReceivedPokeFluteText"
        },
        {
          "flag": "EVENT_GOT_POKE_FLUTE",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_MrFujisHouseMrFujiPokeFluteExplanationText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_MrFujisHouseMrFujiHasMyFluteHelpedYouText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_MrFujisHouseMrFujiPokedexText"
        }
      ],
      "TEXT_MRFUJISHOUSE_NIDORINO": [
        {
          "op": "show_text",
          "textId": "_MrFujisHouseNidorinoText"
        },
        {
          "op": "play_cry",
          "species": "NIDORINO"
        }
      ],
      "TEXT_MRFUJISHOUSE_PSYDUCK": [
        {
          "op": "show_text",
          "textId": "_MrFujisHousePsyduckText"
        },
        {
          "op": "play_cry",
          "species": "PSYDUCK"
        }
      ],
      "TEXT_MRFUJISHOUSE_SUPER_NERD": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_RESCUED_MR_FUJI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_MrFujisHouseSuperNerdMrFujiIsntHereText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_MrFujisHouseSuperNerdMrFujiHadBeenPrayingText"
        }
      ]
    }
  },
  "MT_MOON_B2F": {
    "talk": {
      "TEXT_MTMOONB2F_DOME_FOSSIL": [
        {
          "flag": "EVENT_GOT_DOME_FOSSIL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_GOT_HELIX_FOSSIL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_MT_MOON_3_SUPER_NERD",
          "op": "check_flag"
        },
        {
          "op": "jump_if_false",
          "to": "nerd"
        },
        {
          "op": "ask",
          "textId": "_MtMoonB2FDomeFossilYouWantText"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "count": 1,
          "item": "DOME_FOSSIL",
          "noRoom": "_MtMoonB2FYouHaveNoRoomText",
          "op": "give_item"
        },
        {
          "map": "MT_MOON_B2F",
          "npc": "MTMOONB2F_DOME_FOSSIL",
          "op": "hide_object"
        },
        {
          "flag": "EVENT_GOT_DOME_FOSSIL",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "DOME_FOSSIL",
          "textId": "_MtMoonB2FReceivedFossilText"
        },
        {
          "name": "Get_Key_Item",
          "op": "text_sound"
        },
        {
          "direction": "right",
          "npc": "MTMOONB2F_SUPER_NERD",
          "op": "walk_npc",
          "steps": 1
        },
        {
          "op": "show_text",
          "textId": "_MtMoonB2FSuperNerdThenThisIsMineText"
        },
        {
          "name": "Get_Key_Item",
          "op": "text_sound"
        },
        {
          "map": "MT_MOON_B2F",
          "npc": "MTMOONB2F_HELIX_FOSSIL",
          "op": "hide_object"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "nerd",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_MtMoonB2FSuperNerdTheyreBothMineText"
        },
        {
          "op": "start_battle",
          "party": 2,
          "trainer": "OPP_SUPER_NERD"
        },
        {
          "op": "check_battle_result"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_MT_MOON_3_SUPER_NERD",
          "map": "MT_MOON_B2F",
          "npc": "MTMOONB2F_SUPER_NERD",
          "op": "beat_trainer"
        },
        {
          "op": "show_text",
          "textId": "_MtMoonB2FSuperNerdOkIllShareText"
        }
      ],
      "TEXT_MTMOONB2F_HELIX_FOSSIL": [
        {
          "flag": "EVENT_GOT_DOME_FOSSIL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_GOT_HELIX_FOSSIL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_MT_MOON_3_SUPER_NERD",
          "op": "check_flag"
        },
        {
          "op": "jump_if_false",
          "to": "nerd"
        },
        {
          "op": "ask",
          "textId": "_MtMoonB2FHelixFossilYouWantText"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "count": 1,
          "item": "HELIX_FOSSIL",
          "noRoom": "_MtMoonB2FYouHaveNoRoomText",
          "op": "give_item"
        },
        {
          "map": "MT_MOON_B2F",
          "npc": "MTMOONB2F_HELIX_FOSSIL",
          "op": "hide_object"
        },
        {
          "flag": "EVENT_GOT_HELIX_FOSSIL",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "HELIX_FOSSIL",
          "textId": "_MtMoonB2FReceivedFossilText"
        },
        {
          "name": "Get_Key_Item",
          "op": "text_sound"
        },
        {
          "direction": "up",
          "npc": "MTMOONB2F_SUPER_NERD",
          "op": "walk_npc",
          "steps": 1
        },
        {
          "op": "show_text",
          "textId": "_MtMoonB2FSuperNerdThenThisIsMineText"
        },
        {
          "name": "Get_Key_Item",
          "op": "text_sound"
        },
        {
          "map": "MT_MOON_B2F",
          "npc": "MTMOONB2F_DOME_FOSSIL",
          "op": "hide_object"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "nerd",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_MtMoonB2FSuperNerdTheyreBothMineText"
        },
        {
          "op": "start_battle",
          "party": 2,
          "trainer": "OPP_SUPER_NERD"
        },
        {
          "op": "check_battle_result"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_MT_MOON_3_SUPER_NERD",
          "map": "MT_MOON_B2F",
          "npc": "MTMOONB2F_SUPER_NERD",
          "op": "beat_trainer"
        },
        {
          "op": "show_text",
          "textId": "_MtMoonB2FSuperNerdOkIllShareText"
        }
      ]
    }
  },
  "MUSEUM_1F": {
    "talk": {
      "TEXT_MUSEUM1F_GAMBLER": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_Museum1FGamblerText"
        }
      ],
      "TEXT_MUSEUM1F_SCIENTIST3": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_Museum1FScientist3Text"
        }
      ]
    }
  },
  "OAKS_LAB": {
    "talk": {
      "TEXT_OAKSLAB_GIRL": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_OaksLabGirlText"
        }
      ],
      "TEXT_OAKSLAB_POKEDEX1": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_OaksLabPokedexText"
        }
      ],
      "TEXT_OAKSLAB_POKEDEX2": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_OaksLabPokedexText"
        }
      ],
      "TEXT_OAKSLAB_SCIENTIST1": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_OaksLabScientistText"
        }
      ],
      "TEXT_OAKSLAB_SCIENTIST2": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_OaksLabScientistText"
        }
      ]
    }
  },
  "PEWTER_GYM": {
    "talk": {
      "TEXT_PEWTERGYM_GYM_GUIDE": [
        {
          "flag": "EVENT_BEAT_BROCK",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 9
        },
        {
          "op": "ask",
          "textId": "_PewterGymGuidePreAdviceText"
        },
        {
          "op": "jump_if_false",
          "to": 6
        },
        {
          "op": "show_text",
          "textId": "_PewterGymGuideBeginAdviceText"
        },
        {
          "op": "jump",
          "to": 7
        },
        {
          "op": "show_text",
          "textId": "_PewterGymGuideFreeServiceText"
        },
        {
          "op": "show_text",
          "textId": "_PewterGymGuideAdviceText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_PewterGymGuidePostBattleText"
        }
      ]
    }
  },
  "PEWTER_MART": {
    "talk": {
      "TEXT_PEWTERMART_SUPER_NERD": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_PewterMartSuperNerdText"
        }
      ],
      "TEXT_PEWTERMART_YOUNGSTER": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_PewterMartYoungsterText"
        }
      ]
    }
  },
  "PEWTER_NIDORAN_HOUSE": {
    "talk": {
      "TEXT_PEWTERNIDORANHOUSE_NIDORAN": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_PewterNidoranHouseNidoranText"
        },
        {
          "op": "play_cry",
          "species": "NIDORAN_M"
        }
      ]
    }
  },
  "POKEMON_FAN_CLUB": {
    "talk": {
      "TEXT_POKEMONFANCLUB_CHAIRMAN": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_RECEIVED_BIKE_VOUCHER",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "nothing_left"
        },
        {
          "op": "ask",
          "textId": "_PokemonFanClubChairmanIntroText"
        },
        {
          "op": "jump_if_false",
          "to": "no_story"
        },
        {
          "op": "show_text",
          "textId": "_PokemonFanClubChairmanStoryText"
        },
        {
          "count": 1,
          "item": "BIKE_VOUCHER",
          "op": "give_item"
        },
        {
          "op": "show_text",
          "textId": "_PokemonFanClubReceivedBikeVoucherText"
        },
        {
          "flag": "EVENT_RECEIVED_BIKE_VOUCHER",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_PokemonFanClubExplainBikeVoucherText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "no_story",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_PokemonFanClubNoStoryText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "nothing_left",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_PokemonFanClubChairFinalText"
        }
      ],
      "TEXT_POKEMONFANCLUB_PIKACHU": [
        {
          "op": "show_text",
          "textId": "_PokemonFanClubPikachuText"
        },
        {
          "op": "play_cry",
          "species": "PIKACHU"
        }
      ],
      "TEXT_POKEMONFANCLUB_PIKACHU_FAN": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_PIKACHU_FAN_BOAST",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 6
        },
        {
          "op": "show_text",
          "textId": "_PokemonFanClubPikachuFanNormalText"
        },
        {
          "flag": "EVENT_SEEL_FAN_BOAST",
          "op": "set_flag"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_PokemonFanClubPikachuFanBetterText"
        },
        {
          "flag": "EVENT_PIKACHU_FAN_BOAST",
          "op": "clear_flag"
        }
      ],
      "TEXT_POKEMONFANCLUB_SEEL": [
        {
          "op": "show_text",
          "textId": "_PokemonFanClubSeelText"
        },
        {
          "op": "play_cry",
          "species": "SEEL"
        }
      ],
      "TEXT_POKEMONFANCLUB_SEEL_FAN": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_SEEL_FAN_BOAST",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 6
        },
        {
          "op": "show_text",
          "textId": "_PokemonFanClubSeelFanNormalText"
        },
        {
          "flag": "EVENT_PIKACHU_FAN_BOAST",
          "op": "set_flag"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_PokemonFanClubSeelFanBetterText"
        },
        {
          "flag": "EVENT_SEEL_FAN_BOAST",
          "op": "clear_flag"
        }
      ]
    }
  },
  "POKEMON_TOWER_7F": {
    "talk": {
      "TEXT_POKEMONTOWER7F_MR_FUJI": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_PokemonTower7FMrFujiRescueText"
        },
        {
          "flag": "EVENT_RESCUED_MR_FUJI",
          "op": "set_flag"
        },
        {
          "flag": "EVENT_RESCUED_MR_FUJI_2",
          "op": "set_flag"
        },
        {
          "map": "MR_FUJIS_HOUSE",
          "npc": "MRFUJISHOUSE_MR_FUJI",
          "op": "show_object"
        },
        {
          "map": "SAFFRON_CITY",
          "npc": "SAFFRONCITY_ROCKET8",
          "op": "hide_object"
        },
        {
          "map": "SAFFRON_CITY",
          "npc": "SAFFRONCITY_ROCKET9",
          "op": "show_object"
        },
        {
          "facing": "up",
          "map": "MR_FUJIS_HOUSE",
          "op": "warp",
          "x": 3,
          "y": 7
        }
      ]
    }
  },
  "POWER_PLANT": {
    "talk": {
      "TEXT_POWERPLANT_ELECTRODE1": [
        {
          "op": "show_text",
          "textId": "_PowerPlantVoltorbBattleText"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_3",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_3",
          "level": 43,
          "op": "static_battle",
          "species": "ELECTRODE"
        }
      ],
      "TEXT_POWERPLANT_ELECTRODE2": [
        {
          "op": "show_text",
          "textId": "_PowerPlantVoltorbBattleText"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_6",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_6",
          "level": 43,
          "op": "static_battle",
          "species": "ELECTRODE"
        }
      ],
      "TEXT_POWERPLANT_VOLTORB1": [
        {
          "op": "show_text",
          "textId": "_PowerPlantVoltorbBattleText"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_0",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_0",
          "level": 40,
          "op": "static_battle",
          "species": "VOLTORB"
        }
      ],
      "TEXT_POWERPLANT_VOLTORB2": [
        {
          "op": "show_text",
          "textId": "_PowerPlantVoltorbBattleText"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_1",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_1",
          "level": 40,
          "op": "static_battle",
          "species": "VOLTORB"
        }
      ],
      "TEXT_POWERPLANT_VOLTORB3": [
        {
          "op": "show_text",
          "textId": "_PowerPlantVoltorbBattleText"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_2",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_2",
          "level": 40,
          "op": "static_battle",
          "species": "VOLTORB"
        }
      ],
      "TEXT_POWERPLANT_VOLTORB4": [
        {
          "op": "show_text",
          "textId": "_PowerPlantVoltorbBattleText"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_4",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_4",
          "level": 40,
          "op": "static_battle",
          "species": "VOLTORB"
        }
      ],
      "TEXT_POWERPLANT_VOLTORB5": [
        {
          "op": "show_text",
          "textId": "_PowerPlantVoltorbBattleText"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_5",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_5",
          "level": 40,
          "op": "static_battle",
          "species": "VOLTORB"
        }
      ],
      "TEXT_POWERPLANT_VOLTORB6": [
        {
          "op": "show_text",
          "textId": "_PowerPlantVoltorbBattleText"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_7",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "end"
        },
        {
          "flag": "EVENT_BEAT_POWER_PLANT_VOLTORB_7",
          "level": 40,
          "op": "static_battle",
          "species": "VOLTORB"
        }
      ],
      "TEXT_POWERPLANT_ZAPDOS": [
        {
          "flag": "EVENT_BEAT_ZAPDOS",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "play_music",
          "track": "Music_MeetMaleTrainer"
        },
        {
          "op": "show_text",
          "textId": "_PowerPlantZapdosBattleText"
        },
        {
          "op": "play_cry",
          "species": "ZAPDOS"
        },
        {
          "flag": "EVENT_BEAT_ZAPDOS",
          "level": 50,
          "op": "static_battle",
          "species": "ZAPDOS"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_PowerPlantZapdosBattleText"
        },
        {
          "op": "play_cry",
          "species": "ZAPDOS"
        }
      ]
    }
  },
  "ROUTE_1": {
    "talk": {
      "TEXT_ROUTE1_YOUNGSTER1": [
        {
          "flag": "EVENT_GOT_POTION_SAMPLE",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "ramItem": "POTION",
          "textId": "_Route1Youngster1MartSampleText"
        },
        {
          "count": 1,
          "item": "POTION",
          "noRoom": "_Route1Youngster1NoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_POTION_SAMPLE",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "POTION",
          "textId": "_Route1Youngster1GotPotionText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "POTION",
          "textId": "_Route1Youngster1AlsoGotPokeballsText"
        }
      ]
    }
  },
  "ROUTE_11_GATE_2F": {
    "talk": {
      "TEXT_ROUTE11GATE2F_OAKS_AIDE": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_ITEMFINDER",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "num": 30,
          "op": "ask",
          "ramItem": "ITEMFINDER",
          "textId": "_OaksAideHiText"
        },
        {
          "op": "jump_if_false",
          "to": "come_back"
        },
        {
          "count": 30,
          "op": "check_dex_owned"
        },
        {
          "op": "jump_if_false",
          "to": "uh_oh"
        },
        {
          "num": 30,
          "op": "show_text",
          "ramItem": "ITEMFINDER",
          "textId": "_OaksAideHereYouGoText"
        },
        {
          "count": 1,
          "item": "ITEMFINDER",
          "noRoom": "_OaksAideNoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_ITEMFINDER",
          "op": "set_flag"
        },
        {
          "num": 30,
          "op": "show_text",
          "ramItem": "ITEMFINDER",
          "textId": "_OaksAideGotItemText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "ramItem": "ITEMFINDER",
          "textId": "_Route11Gate2FOaksAideItemfinderDescriptionText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "uh_oh",
          "op": "label"
        },
        {
          "num": 30,
          "op": "show_text",
          "ramItem": "ITEMFINDER",
          "textId": "_OaksAideUhOhText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "come_back",
          "op": "label"
        },
        {
          "num": 30,
          "op": "show_text",
          "ramItem": "ITEMFINDER",
          "textId": "_OaksAideComeBackText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "ITEMFINDER",
          "textId": "_Route11Gate2FOaksAideItemfinderDescriptionText"
        }
      ],
      "TEXT_ROUTE11GATE2F_YOUNGSTER": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_NIDORINO_FOR_NIDORINA",
          "index": 1,
          "op": "trade"
        }
      ]
    }
  },
  "ROUTE_12": {
    "talk": {
      "TEXT_ROUTE12_SNORLAX": [
        {
          "op": "show_text",
          "textId": "_Route12SnorlaxText"
        }
      ]
    }
  },
  "ROUTE_12_GATE_2F": {
    "talk": {
      "TEXT_ROUTE12GATE2F_BRUNETTE_GIRL": [
        {
          "flag": "EVENT_GOT_TM39",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "ramItem": "TM_SWIFT",
          "textId": "_Route12Gate2FBrunetteGirlYouCanHaveThisText"
        },
        {
          "count": 1,
          "item": "TM_SWIFT",
          "noRoom": "_Route12Gate2FBrunetteGirlTM39NoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_TM39",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "TM_SWIFT",
          "textId": "_Route12Gate2FBrunetteGirlReceivedTM39Text"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "TM_SWIFT",
          "textId": "_Route12Gate2FBrunetteGirlTM39ExplanationText"
        }
      ],
      "TEXT_ROUTE12GATE2F_LEFT_BINOCULARS": [
        {
          "direction": "up",
          "op": "check_facing"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_Route12Gate2FLeftBinocularsText"
        }
      ],
      "TEXT_ROUTE12GATE2F_RIGHT_BINOCULARS": [
        {
          "direction": "up",
          "op": "check_facing"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_Route12Gate2FRightBinocularsText"
        }
      ]
    }
  },
  "ROUTE_12_SUPER_ROD_HOUSE": {
    "talk": {
      "TEXT_ROUTE12SUPERRODHOUSE_FISHING_GURU": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_SUPER_ROD",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already_got"
        },
        {
          "op": "ask",
          "textId": "_Route12SuperRodHouseFishingGuruDoYouLikeToFishText"
        },
        {
          "op": "jump_if_false",
          "to": "refused"
        },
        {
          "count": 1,
          "item": "SUPER_ROD",
          "noRoom": "_Route12SuperRodHouseFishingGuruNoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_SUPER_ROD",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "SUPER_ROD",
          "textId": "_Route12SuperRodHouseFishingGuruReceivedSuperRodText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_Route12SuperRodHouseFishingGuruFishingWayOfLifeText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "refused",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_Route12SuperRodHouseFishingGuruThatsDisappointingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already_got",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_Route12SuperRodHouseFishingGuruTryFishingText"
        }
      ]
    }
  },
  "ROUTE_15_GATE_2F": {
    "talk": {
      "TEXT_ROUTE15GATE2F_BINOCULARS": [
        {
          "op": "show_text",
          "textId": "_Route15Gate2FBinocularsText"
        }
      ],
      "TEXT_ROUTE15GATE2F_OAKS_AIDE": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_EXP_ALL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "num": 50,
          "op": "ask",
          "ramItem": "EXP_ALL",
          "textId": "_OaksAideHiText"
        },
        {
          "op": "jump_if_false",
          "to": "come_back"
        },
        {
          "count": 50,
          "op": "check_dex_owned"
        },
        {
          "op": "jump_if_false",
          "to": "uh_oh"
        },
        {
          "num": 50,
          "op": "show_text",
          "ramItem": "EXP_ALL",
          "textId": "_OaksAideHereYouGoText"
        },
        {
          "count": 1,
          "item": "EXP_ALL",
          "noRoom": "_OaksAideNoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_EXP_ALL",
          "op": "set_flag"
        },
        {
          "num": 50,
          "op": "show_text",
          "ramItem": "EXP_ALL",
          "textId": "_OaksAideGotItemText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "ramItem": "EXP_ALL",
          "textId": "_Route15Gate2FOaksAideExpAllText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "uh_oh",
          "op": "label"
        },
        {
          "num": 50,
          "op": "show_text",
          "ramItem": "EXP_ALL",
          "textId": "_OaksAideUhOhText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "come_back",
          "op": "label"
        },
        {
          "num": 50,
          "op": "show_text",
          "ramItem": "EXP_ALL",
          "textId": "_OaksAideComeBackText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "EXP_ALL",
          "textId": "_Route15Gate2FOaksAideExpAllText"
        }
      ]
    }
  },
  "ROUTE_16": {
    "talk": {
      "TEXT_ROUTE16_SNORLAX": [
        {
          "op": "show_text",
          "textId": "_Route16Text7"
        }
      ]
    }
  },
  "ROUTE_16_FLY_HOUSE": {
    "talk": {
      "TEXT_ROUTE16FLYHOUSE_FEAROW": [
        {
          "op": "show_text",
          "textId": "_Route16FlyHouseFearowText"
        },
        {
          "op": "play_cry",
          "species": "FEAROW"
        }
      ]
    }
  },
  "ROUTE_16_GATE_1F": {
    "talk": {
      "TEXT_ROUTE16GATE1F_GUARD": [
        {
          "op": "face_player"
        },
        {
          "item": "BICYCLE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_Route16Gate1FGuardNoPedestriansAllowedText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_Route16Gate1FGuardCyclingRoadExplanationText"
        }
      ]
    }
  },
  "ROUTE_16_GATE_2F": {
    "talk": {
      "TEXT_ROUTE16GATE2F_LEFT_BINOCULARS": [
        {
          "op": "show_text",
          "textId": "_Route16Gate2FLeftBinocularsText"
        }
      ],
      "TEXT_ROUTE16GATE2F_LITTLE_BOY": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_Route16Gate2FLittleBoyText"
        }
      ],
      "TEXT_ROUTE16GATE2F_LITTLE_GIRL": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_Route16Gate2FLittleGirlText"
        }
      ],
      "TEXT_ROUTE16GATE2F_RIGHT_BINOCULARS": [
        {
          "op": "show_text",
          "textId": "_Route16Gate2FRightBinocularsText"
        }
      ]
    }
  },
  "ROUTE_18_GATE_1F": {
    "talk": {
      "TEXT_ROUTE18GATE1F_GUARD": [
        {
          "op": "face_player"
        },
        {
          "item": "BICYCLE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_Route18Gate1FGuardYouNeedABicycleText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_Route18Gate1FGuardCyclingRoadUphillText"
        }
      ]
    }
  },
  "ROUTE_18_GATE_2F": {
    "talk": {
      "TEXT_ROUTE18GATE2F_LEFT_BINOCULARS": [
        {
          "direction": "up",
          "op": "check_facing"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_Route18Gate2FLeftBinocularsText"
        }
      ],
      "TEXT_ROUTE18GATE2F_RIGHT_BINOCULARS": [
        {
          "direction": "up",
          "op": "check_facing"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_Route18Gate2FRightBinocularsText"
        }
      ],
      "TEXT_ROUTE18GATE2F_YOUNGSTER": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_SLOWBRO_FOR_LICKITUNG",
          "index": 6,
          "op": "trade"
        }
      ]
    }
  },
  "ROUTE_22_GATE": {
    "talk": {
      "TEXT_ROUTE22GATE_GUARD": [
        {
          "flag": "EVENT_BEAT_BROCK",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_Route22GateGuardNoBoulderbadgeText"
        },
        {
          "op": "show_text",
          "textId": "_Route22GateGuardICantLetYouPassText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_Route22GateGuardGoRightAheadText"
        }
      ]
    }
  },
  "ROUTE_23": {
    "talk": {
      "TEXT_ROUTE23_GUARD1": [
        {
          "item": "EARTHBADGE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": "has_badge"
        },
        {
          "op": "show_text",
          "ramItem": "EARTHBADGE",
          "textId": "_Route23YouDontHaveTheBadgeYetText"
        },
        {
          "name": "Denied",
          "op": "text_sound"
        },
        {
          "direction": "down",
          "op": "move_player",
          "steps": 1
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "has_badge",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "EARTHBADGE",
          "textId": "_Route23OhThatIsTheBadgeText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_Route23GoRightAheadText"
        },
        {
          "flag": "EVENT_PASSED_EARTHBADGE_CHECK",
          "op": "set_flag"
        }
      ],
      "TEXT_ROUTE23_GUARD2": [
        {
          "item": "VOLCANOBADGE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": "has_badge"
        },
        {
          "op": "show_text",
          "ramItem": "VOLCANOBADGE",
          "textId": "_Route23YouDontHaveTheBadgeYetText"
        },
        {
          "name": "Denied",
          "op": "text_sound"
        },
        {
          "direction": "down",
          "op": "move_player",
          "steps": 1
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "has_badge",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "VOLCANOBADGE",
          "textId": "_Route23OhThatIsTheBadgeText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_Route23GoRightAheadText"
        },
        {
          "flag": "EVENT_PASSED_VOLCANOBADGE_CHECK",
          "op": "set_flag"
        }
      ],
      "TEXT_ROUTE23_GUARD3": [
        {
          "item": "RAINBOWBADGE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": "has_badge"
        },
        {
          "op": "show_text",
          "ramItem": "RAINBOWBADGE",
          "textId": "_Route23YouDontHaveTheBadgeYetText"
        },
        {
          "name": "Denied",
          "op": "text_sound"
        },
        {
          "direction": "down",
          "op": "move_player",
          "steps": 1
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "has_badge",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "RAINBOWBADGE",
          "textId": "_Route23OhThatIsTheBadgeText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_Route23GoRightAheadText"
        },
        {
          "flag": "EVENT_PASSED_RAINBOWBADGE_CHECK",
          "op": "set_flag"
        }
      ],
      "TEXT_ROUTE23_GUARD4": [
        {
          "item": "THUNDERBADGE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": "has_badge"
        },
        {
          "op": "show_text",
          "ramItem": "THUNDERBADGE",
          "textId": "_Route23YouDontHaveTheBadgeYetText"
        },
        {
          "name": "Denied",
          "op": "text_sound"
        },
        {
          "direction": "down",
          "op": "move_player",
          "steps": 1
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "has_badge",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "THUNDERBADGE",
          "textId": "_Route23OhThatIsTheBadgeText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_Route23GoRightAheadText"
        },
        {
          "flag": "EVENT_PASSED_THUNDERBADGE_CHECK",
          "op": "set_flag"
        }
      ],
      "TEXT_ROUTE23_GUARD5": [
        {
          "item": "CASCADEBADGE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": "has_badge"
        },
        {
          "op": "show_text",
          "ramItem": "CASCADEBADGE",
          "textId": "_Route23YouDontHaveTheBadgeYetText"
        },
        {
          "name": "Denied",
          "op": "text_sound"
        },
        {
          "direction": "down",
          "op": "move_player",
          "steps": 1
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "has_badge",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "CASCADEBADGE",
          "textId": "_Route23OhThatIsTheBadgeText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_Route23GoRightAheadText"
        },
        {
          "flag": "EVENT_PASSED_CASCADEBADGE_CHECK",
          "op": "set_flag"
        }
      ],
      "TEXT_ROUTE23_SWIMMER1": [
        {
          "item": "MARSHBADGE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": "has_badge"
        },
        {
          "op": "show_text",
          "ramItem": "MARSHBADGE",
          "textId": "_Route23YouDontHaveTheBadgeYetText"
        },
        {
          "name": "Denied",
          "op": "text_sound"
        },
        {
          "direction": "down",
          "op": "move_player",
          "steps": 1
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "has_badge",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "MARSHBADGE",
          "textId": "_Route23OhThatIsTheBadgeText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_Route23GoRightAheadText"
        },
        {
          "flag": "EVENT_PASSED_MARSHBADGE_CHECK",
          "op": "set_flag"
        }
      ],
      "TEXT_ROUTE23_SWIMMER2": [
        {
          "item": "SOULBADGE",
          "op": "check_item"
        },
        {
          "op": "jump_if_true",
          "to": "has_badge"
        },
        {
          "op": "show_text",
          "ramItem": "SOULBADGE",
          "textId": "_Route23YouDontHaveTheBadgeYetText"
        },
        {
          "name": "Denied",
          "op": "text_sound"
        },
        {
          "direction": "down",
          "op": "move_player",
          "steps": 1
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "has_badge",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "SOULBADGE",
          "textId": "_Route23OhThatIsTheBadgeText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_Route23GoRightAheadText"
        },
        {
          "flag": "EVENT_PASSED_SOULBADGE_CHECK",
          "op": "set_flag"
        }
      ]
    }
  },
  "ROUTE_2_GATE": {
    "talk": {
      "TEXT_ROUTE2GATE_OAKS_AIDE": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_HM05",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "flag": "EVENT_GOT_HM_FLASH",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "num": 10,
          "op": "ask",
          "ramItem": "HM_FLASH",
          "textId": "_OaksAideHiText"
        },
        {
          "op": "jump_if_false",
          "to": "come_back"
        },
        {
          "count": 10,
          "op": "check_dex_owned"
        },
        {
          "op": "jump_if_false",
          "to": "uh_oh"
        },
        {
          "num": 10,
          "op": "show_text",
          "ramItem": "HM_FLASH",
          "textId": "_OaksAideHereYouGoText"
        },
        {
          "count": 1,
          "item": "HM_FLASH",
          "noRoom": "_OaksAideNoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_HM05",
          "op": "set_flag"
        },
        {
          "num": 10,
          "op": "show_text",
          "ramItem": "HM_FLASH",
          "textId": "_OaksAideGotItemText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "ramItem": "HM_FLASH",
          "textId": "_Route2GateOaksAideFlashExplanationText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "uh_oh",
          "op": "label"
        },
        {
          "num": 10,
          "op": "show_text",
          "ramItem": "HM_FLASH",
          "textId": "_OaksAideUhOhText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "come_back",
          "op": "label"
        },
        {
          "num": 10,
          "op": "show_text",
          "ramItem": "HM_FLASH",
          "textId": "_OaksAideComeBackText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "HM_FLASH",
          "textId": "_Route2GateOaksAideFlashExplanationText"
        }
      ]
    }
  },
  "ROUTE_2_TRADE_HOUSE": {
    "talk": {
      "TEXT_ROUTE2TRADEHOUSE_GAMEBOY_KID": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_ABRA_FOR_MR_MIME",
          "index": 2,
          "op": "trade"
        }
      ],
      "TEXT_ROUTE2TRADEHOUSE_SCIENTIST": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_Route2TradeHouseScientistText"
        }
      ]
    }
  },
  "SAFARI_ZONE_GATE": {
    "talk": {
      "TEXT_SAFARIZONEGATE_SAFARI_ZONE_WORKER2": [
        {
          "op": "face_player"
        },
        {
          "op": "ask",
          "textId": "_SafariZoneGateSafariZoneWorker2FirstTimeHereText"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_SafariZoneGateSafariZoneWorker2YoureARegularHereText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SafariZoneGateSafariZoneWorker2SafariZoneExplanationText"
        }
      ]
    }
  },
  "SAFARI_ZONE_SECRET_HOUSE": {
    "talk": {
      "TEXT_SAFARIZONESECRETHOUSE_FISHING_GURU": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_HM03",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 8
        },
        {
          "op": "show_text",
          "textId": "_SafariZoneSecretHouseFishingGuruYouHaveWonText"
        },
        {
          "count": 1,
          "item": "HM_SURF",
          "op": "give_item"
        },
        {
          "op": "show_text",
          "textId": "_SafariZoneSecretHouseFishingGuruReceivedHM03Text"
        },
        {
          "flag": "EVENT_GOT_HM03",
          "op": "set_flag"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SafariZoneSecretHouseFishingGuruHM03ExplanationText"
        }
      ]
    }
  },
  "SAFFRON_CITY": {
    "talk": {
      "TEXT_SAFFRONCITY_PIDGEOT": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SaffronCityPidgeotText"
        },
        {
          "op": "play_cry",
          "species": "PIDGEOT"
        }
      ]
    }
  },
  "SAFFRON_GYM": {
    "talk": {
      "TEXT_SAFFRONGYM_GYM_GUIDE": [
        {
          "flag": "EVENT_BEAT_SABRINA",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "show_text",
          "textId": "_SaffronGymGuideChampInMakingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_SaffronGymGuideBeatSabrinaText"
        }
      ]
    }
  },
  "SAFFRON_PIDGEY_HOUSE": {
    "talk": {
      "TEXT_SAFFRONPIDGEYHOUSE_PIDGEY": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SaffronPidgeyHousePidgeyText"
        },
        {
          "op": "play_cry",
          "species": "PIDGEY"
        }
      ]
    }
  },
  "SEAFOAM_ISLANDS_B4F": {
    "talk": {
      "TEXT_SEAFOAMISLANDSB4F_ARTICUNO": [
        {
          "flag": "EVENT_BEAT_ARTICUNO",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "play_music",
          "track": "Music_MeetMaleTrainer"
        },
        {
          "op": "show_text",
          "textId": "_SeafoamIslandsB4FArticunoBattleText"
        },
        {
          "op": "play_cry",
          "species": "ARTICUNO"
        },
        {
          "flag": "EVENT_BEAT_ARTICUNO",
          "level": 50,
          "op": "static_battle",
          "species": "ARTICUNO"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_SeafoamIslandsB4FArticunoBattleText"
        },
        {
          "op": "play_cry",
          "species": "ARTICUNO"
        }
      ]
    }
  },
  "SILPH_CO_10F": {
    "talk": {
      "TEXT_SILPHCO10F_SILPH_WORKER_F": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_SilphCo10FSilphWorkerFImScaredText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo10FSilphWorkerFQuietAboutMyCryingText"
        }
      ]
    }
  },
  "SILPH_CO_11F": {
    "talk": {
      "TEXT_SILPHCO11F_SILPH_PRESIDENT": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_MASTER_BALL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 8
        },
        {
          "op": "show_text",
          "textId": "_SilphCo11FSilphPresidentText"
        },
        {
          "count": 1,
          "item": "MASTER_BALL",
          "op": "give_item"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo11FSilphPresidentReceivedMasterBallText"
        },
        {
          "flag": "EVENT_GOT_MASTER_BALL",
          "op": "set_flag"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo11FSilphPresidentMasterBallDescriptionText"
        }
      ]
    }
  },
  "SILPH_CO_2F": {
    "talk": {
      "TEXT_SILPHCO2F_SILPH_WORKER_F": [
        {
          "flag": "EVENT_GOT_TM36",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "ramItem": "TM_SELFDESTRUCT",
          "textId": "SilphCo2FSilphWorkerFPleaseTakeThisText"
        },
        {
          "count": 1,
          "item": "TM_SELFDESTRUCT",
          "noRoom": "_SilphCo2FSilphWorkerFTM36NoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_TM36",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "TM_SELFDESTRUCT",
          "textId": "_SilphCo2FSilphWorkerFReceivedTM36Text"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "TM_SELFDESTRUCT",
          "textId": "_SilphCo2FSilphWorkerFTM36ExplanationText"
        }
      ]
    }
  },
  "SILPH_CO_3F": {
    "talk": {
      "TEXT_SILPHCO3F_SILPH_WORKER_M": [
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 4
        },
        {
          "op": "show_text",
          "textId": "_SilphCo3FSilphWorkerMWhatShouldIDoText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo3FSilphWorkerMYouSavedUsText"
        }
      ]
    }
  },
  "SILPH_CO_4F": {
    "talk": {
      "TEXT_SILPHCO4F_SILPH_WORKER_M": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_SilphCo4FSilphWorkerMImHidingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo4FSilphWorkerMTeamRocketIsGoneText"
        }
      ]
    }
  },
  "SILPH_CO_5F": {
    "talk": {
      "TEXT_SILPHCO5F_SILPH_WORKER_M": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_SilphCo5FSilphWorkerMThatsYouRightText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo5FSilphWorkerMYoureOurHeroText"
        }
      ]
    }
  },
  "SILPH_CO_6F": {
    "talk": {
      "TEXT_SILPHCO6F_SILPH_WORKER_F1": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerF1SuchACowardText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerF1HaveToMarryHimText"
        }
      ],
      "TEXT_SILPHCO6F_SILPH_WORKER_F2": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerF2TeamRocketConquerWorldText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerF2TeamRocketRanText"
        }
      ],
      "TEXT_SILPHCO6F_SILPH_WORKER_M1": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerM1TookOverTheBuildingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerM1BackToWorkText"
        }
      ],
      "TEXT_SILPHCO6F_SILPH_WORKER_M2": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerMHelpMePleaseText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerMWeGotEngagedText"
        }
      ],
      "TEXT_SILPHCO6F_SILPH_WORKER_M3": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 5
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerM3TargetedSilphText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo6FSilphWorkerM3WorkForSilphText"
        }
      ]
    }
  },
  "SILPH_CO_7F": {
    "talk": {
      "TEXT_SILPHCO7F_SILPH_WORKER_M1": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_LAPRAS",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "has_lapras"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM1HaveThisPokemonText"
        },
        {
          "level": 15,
          "op": "give_pokemon",
          "species": "LAPRAS"
        },
        {
          "op": "jump_if_false",
          "to": "box_full"
        },
        {
          "flag": "EVENT_GOT_LAPRAS",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM1LaprasDescriptionText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "box_full",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_BoxIsFullText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "has_lapras",
          "op": "label"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "saved"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM1IsOurPresidentOkText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "saved",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM1SavedText"
        }
      ],
      "TEXT_SILPHCO7F_SILPH_WORKER_M2": [
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 4
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM2AfterTheMasterBallText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM2CancelledMasterBallText"
        }
      ],
      "TEXT_SILPHCO7F_SILPH_WORKER_M3": [
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 4
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM3ItWouldBeBadText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM3YouChasedOffTeamRocketText"
        }
      ],
      "TEXT_SILPHCO7F_SILPH_WORKER_M4": [
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 4
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM4ItsReallyDangerousHereText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo7FSilphWorkerM4SafeAtLastText"
        }
      ]
    }
  },
  "SILPH_CO_8F": {
    "talk": {
      "TEXT_SILPHCO8F_SILPH_WORKER_M": [
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 4
        },
        {
          "op": "show_text",
          "textId": "_SilphCo8FSilphWorkerMSilphIsFinishedText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_SilphCo8FSilphWorkerMThanksForSavingUsText"
        }
      ]
    }
  },
  "SILPH_CO_9F": {
    "talk": {
      "TEXT_SILPHCO9F_NURSE": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_BEAT_SILPH_CO_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 10
        },
        {
          "op": "show_text",
          "textId": "SilphCo9FNurseYouLookTiredText"
        },
        {
          "op": "heal_party"
        },
        {
          "colour": "white",
          "direction": "out",
          "op": "fade"
        },
        {
          "frames": 3,
          "op": "wait"
        },
        {
          "colour": "white",
          "direction": "in",
          "op": "fade"
        },
        {
          "op": "show_text",
          "textId": "SilphCo9FNurseDontGiveUpText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "SilphCo9FNurseThankYouText"
        }
      ]
    }
  },
  "SS_ANNE_1F_ROOMS": {
    "talk": {
      "TEXT_SSANNE1FROOMS_WIGGLYTUFF": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SSAnne1FRoomsWigglytuffText"
        },
        {
          "op": "play_cry",
          "species": "WIGGLYTUFF"
        }
      ]
    }
  },
  "SS_ANNE_2F_ROOMS": {
    "talk": {
      "TEXT_SSANNE2FROOMS_BEAUTY": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SSAnne2FRoomsBeautyText"
        }
      ],
      "TEXT_SSANNE2FROOMS_BRUNETTE_GIRL": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SSAnne2FRoomsBrunetteGirlText"
        }
      ],
      "TEXT_SSANNE2FROOMS_GENTLEMAN3": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SSAnne2FRoomsGentleman3Text"
        },
        {
          "op": "mark_seen",
          "species": "SNORLAX"
        },
        {
          "op": "push_screen",
          "screen": "DexEntryMenu",
          "species": "SNORLAX"
        }
      ],
      "TEXT_SSANNE2FROOMS_GENTLEMAN4": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SSAnne2FRoomsGentleman4Text"
        }
      ],
      "TEXT_SSANNE2FROOMS_GENTLEMAN5": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SSAnne2FRoomsGentleman5Text"
        }
      ],
      "TEXT_SSANNE2FROOMS_GRAMPS": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SSAnne2FRoomsGrampsText"
        }
      ],
      "TEXT_SSANNE2FROOMS_LITTLE_BOY": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SSAnne2FRoomsLittleBoyText"
        }
      ]
    }
  },
  "SS_ANNE_B1F_ROOMS": {
    "talk": {
      "TEXT_SSANNEB1FROOMS_MACHOKE": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SSAnneB1FRoomsMachokeText"
        },
        {
          "op": "play_cry",
          "species": "MACHOKE"
        }
      ]
    }
  },
  "UNDERGROUND_PATH_ROUTE_5": {
    "talk": {
      "TEXT_UNDERGROUNDPATHROUTE5_LITTLE_GIRL": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_NIDORAN_M_FOR_NIDORAN_F",
          "index": 10,
          "op": "trade"
        }
      ]
    }
  },
  "VERMILION_CITY": {
    "talk": {
      "TEXT_VERMILIONCITY_GAMBLER1": [
        {
          "flag": "EVENT_SS_ANNE_LEFT",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 4
        },
        {
          "op": "show_text",
          "textId": "_VermilionCityGambler1DidYouSeeText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "op": "show_text",
          "textId": "_VermilionCityGambler1SSAnneDepartedText"
        }
      ],
      "TEXT_VERMILIONCITY_MACHOP": [
        {
          "op": "show_text",
          "textId": "_VermilionCityMachopText"
        },
        {
          "op": "play_cry",
          "species": "MACHOP"
        },
        {
          "op": "show_text",
          "textId": "_VermilionCityMachopStompingTheLandFlatText"
        }
      ]
    }
  },
  "VERMILION_GYM": {
    "talk": {
      "TEXT_VERMILIONGYM_GYM_GUIDE": [
        {
          "flag": "EVENT_BEAT_LT_SURGE",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "show_text",
          "textId": "_VermilionGymGymGuideChampInMakingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_VermilionGymGymGuideBeatLTSurgeText"
        }
      ]
    }
  },
  "VERMILION_OLD_ROD_HOUSE": {
    "talk": {
      "TEXT_VERMILIONOLDRODHOUSE_FISHING_GURU": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_OLD_ROD",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already_got"
        },
        {
          "op": "ask",
          "textId": "_VermilionOldRodHouseFishingGuruDoYouLikeToFishText"
        },
        {
          "op": "jump_if_false",
          "to": "refused"
        },
        {
          "count": 1,
          "item": "OLD_ROD",
          "noRoom": "_VermilionOldRodHouseFishingGuruNoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_OLD_ROD",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "OLD_ROD",
          "textId": "_VermilionOldRodHouseFishingGuruTakeThisText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_VermilionOldRodHouseFishingGuruFishingIsAWayOfLifeText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "refused",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_VermilionOldRodHouseFishingGuruThatsSoDisappointingText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already_got",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_VermilionOldRodHouseFishingGuruHowAreTheFishBitingText"
        }
      ]
    }
  },
  "VERMILION_PIDGEY_HOUSE": {
    "talk": {
      "TEXT_VERMILIONPIDGEYHOUSE_PIDGEY": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_VermilionPidgeyHousePidgeyText"
        },
        {
          "op": "play_cry",
          "species": "PIDGEY"
        }
      ]
    }
  },
  "VERMILION_TRADE_HOUSE": {
    "talk": {
      "TEXT_VERMILIONTRADEHOUSE_LITTLE_GIRL": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_SPEAROW_FOR_FARFETCHD",
          "index": 5,
          "op": "trade"
        }
      ]
    }
  },
  "VICTORY_ROAD_2F": {
    "talk": {
      "TEXT_VICTORYROAD2F_MOLTRES": [
        {
          "flag": "EVENT_BEAT_MOLTRES",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "play_music",
          "track": "Music_MeetMaleTrainer"
        },
        {
          "op": "show_text",
          "textId": "_VictoryRoad2FMoltresBattleText"
        },
        {
          "op": "play_cry",
          "species": "MOLTRES"
        },
        {
          "flag": "EVENT_BEAT_MOLTRES",
          "level": 50,
          "op": "static_battle",
          "species": "MOLTRES"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_VictoryRoad2FMoltresBattleText"
        },
        {
          "op": "play_cry",
          "species": "MOLTRES"
        }
      ]
    }
  },
  "VIRIDIAN_CITY": {
    "talk": {
      "TEXT_VIRIDIANCITY_FISHER": [
        {
          "flag": "EVENT_GOT_TM42",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "ramItem": "TM_DREAM_EATER",
          "textId": "ViridianCityFisherYouCanHaveThisText"
        },
        {
          "count": 1,
          "item": "TM_DREAM_EATER",
          "noRoom": "_ViridianCityFisherTM42NoRoomText",
          "op": "give_item"
        },
        {
          "flag": "EVENT_GOT_TM42",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "ramItem": "TM_DREAM_EATER",
          "textId": "_ViridianCityFisherReceivedTM42Text"
        },
        {
          "name": "Get_Item2",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "ramItem": "TM_DREAM_EATER",
          "textId": "_ViridianCityFisherTM42ExplanationText"
        }
      ],
      "TEXT_VIRIDIANCITY_OLD_MAN_SLEEPY": [
        {
          "op": "show_text",
          "textId": "_ViridianCityOldManSleepyPrivatePropertyText"
        },
        {
          "direction": "down",
          "op": "move_player",
          "steps": 1
        }
      ]
    }
  },
  "VIRIDIAN_GYM": {
    "talk": {
      "TEXT_VIRIDIANGYM_GYM_GUIDE": [
        {
          "flag": "EVENT_BEAT_GIOVANNI",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "beaten"
        },
        {
          "op": "show_text",
          "textId": "_ViridianGymGuidePreBattleText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "beaten",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_ViridianGymGuidePostBattleText"
        }
      ]
    }
  },
  "VIRIDIAN_MART": {
    "talk": {
      "TEXT_VIRIDIANMART_CLERK": [
        {
          "flag": "EVENT_OAK_GOT_PARCEL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 10
        },
        {
          "flag": "EVENT_GOT_OAKS_PARCEL",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": 12
        },
        {
          "flag": "EVENT_GOT_STARTER",
          "op": "check_flag"
        },
        {
          "op": "jump_if_false",
          "to": 10
        },
        {
          "op": "show_text",
          "textId": "_ViridianMartClerkYouCameFromPalletTownText"
        },
        {
          "count": 1,
          "item": "OAKS_PARCEL",
          "op": "give_item"
        },
        {
          "op": "show_text",
          "textId": "_ViridianMartClerkParcelQuestText"
        },
        {
          "flag": "EVENT_GOT_OAKS_PARCEL",
          "op": "set_flag"
        },
        {
          "op": "jump",
          "to": 13
        },
        {
          "op": "open_mart",
          "textId": "TEXT_VIRIDIANMART_CLERK"
        },
        {
          "op": "jump",
          "to": 13
        },
        {
          "op": "show_text",
          "textId": "_ViridianMartClerkSayHiToOakText"
        }
      ]
    }
  },
  "VIRIDIAN_NICKNAME_HOUSE": {
    "talk": {
      "TEXT_VIRIDIANNICKNAMEHOUSE_SPEAROW": [
        {
          "op": "show_text",
          "textId": "_ViridianNicknameHouseSpearowText"
        },
        {
          "op": "play_cry",
          "species": "SPEAROW"
        }
      ]
    }
  },
  "WARDENS_HOUSE": {
    "talk": {
      "TEXT_WARDENSHOUSE_DISPLAY_LEFT": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_WardensHouseDisplayPhotosAndFossilsText"
        }
      ],
      "TEXT_WARDENSHOUSE_DISPLAY_RIGHT": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_WardensHouseDisplayMerchandiseText"
        }
      ],
      "TEXT_WARDENSHOUSE_WARDEN": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_GOT_HM04",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "got_hm04"
        },
        {
          "item": "GOLD_TEETH",
          "op": "check_item"
        },
        {
          "op": "jump_if_false",
          "to": "no_teeth"
        },
        {
          "op": "show_text",
          "textId": "_WardensHouseWardenGaveTheGoldTeethText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "show_text",
          "textId": "_WardensHouseWardenTeethPoppedInHisTeethText"
        },
        {
          "count": 1,
          "item": "GOLD_TEETH",
          "op": "take_item"
        },
        {
          "flag": "EVENT_GAVE_GOLD_TEETH",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_WardensHouseWardenThanksText"
        },
        {
          "count": 1,
          "item": "HM_STRENGTH",
          "op": "give_item"
        },
        {
          "op": "show_text",
          "textId": "_WardensHouseWardenReceivedHM04Text"
        },
        {
          "flag": "EVENT_GOT_HM04",
          "op": "set_flag"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "no_teeth",
          "op": "label"
        },
        {
          "op": "ask",
          "textId": "_WardensHouseWardenGibberish1Text"
        },
        {
          "op": "jump_if_true",
          "to": "gibberish_yes"
        },
        {
          "op": "show_text",
          "textId": "_WardensHouseWardenGibberish3Text"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "gibberish_yes",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_WardensHouseWardenGibberish2Text"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "got_hm04",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_WardensHouseWardenHM04ExplanationText"
        }
      ]
    }
  }
};

/**
 * What Yellow says differently: the same shape as PORTED, but a key holding
 * null means Yellow has NO script there and Red's must not run either. Keys
 * absent from this table read from PORTED like any other cartridge. Built
 * from a Yellow bundle by the same run (--yellow); 17 scripts differ,
 * 9 exist in Red only.
 */
const PORTED_YELLOW: any = {
  "CERULEAN_MELANIES_HOUSE": {
    "talk": {
      "TEXT_CERULEANMELANIESHOUSE_BULBASAUR": [
        {
          "op": "show_text",
          "textId": "MelanieBulbasaurText"
        },
        {
          "op": "play_cry",
          "species": "BULBASAUR"
        }
      ],
      "TEXT_CERULEANMELANIESHOUSE_ODDISH": [
        {
          "op": "show_text",
          "textId": "MelanieOddishText"
        },
        {
          "op": "play_cry",
          "species": "ODDISH"
        }
      ],
      "TEXT_CERULEANMELANIESHOUSE_SANDSHREW": [
        {
          "op": "show_text",
          "textId": "MelanieSandshrewText"
        },
        {
          "op": "play_cry",
          "species": "SANDSHREW"
        }
      ]
    }
  },
  "CERULEAN_TRADE_HOUSE": {
    "talk": {
      "TEXT_CERULEANTRADEHOUSE_GAMBLER": null,
      "TEXT_CERULEANTRADEHOUSE_GRANNY": null
    }
  },
  "GAME_CORNER": {
    "talk": {
      "TEXT_GAMECORNER_CLERK2": null,
      "TEXT_GAMECORNER_FISHING_GURU": null,
      "TEXT_GAMECORNER_FISHING_GURU1": [
        {
          "flag": "EVENT_GOT_10_COINS",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuru1WantToPlayText"
        },
        {
          "item": "COIN_CASE",
          "op": "check_item"
        },
        {
          "op": "jump_if_false",
          "to": "no_case"
        },
        {
          "amount": 9990,
          "op": "check_coins"
        },
        {
          "op": "jump_if_true",
          "to": "full"
        },
        {
          "amount": 10,
          "op": "give_coins"
        },
        {
          "flag": "EVENT_GOT_10_COINS",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuru1Received10CoinsText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "no_case",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerOopsForgotCoinCaseText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "full",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuru1DontNeedMyCoinsText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuru1WinsComeAndGoText"
        }
      ],
      "TEXT_GAMECORNER_FISHING_GURU2": [
        {
          "flag": "EVENT_GOT_20_COINS",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuru2ThrowingMeOffText"
        },
        {
          "item": "COIN_CASE",
          "op": "check_item"
        },
        {
          "op": "jump_if_false",
          "to": "no_case"
        },
        {
          "amount": 9990,
          "op": "check_coins"
        },
        {
          "op": "jump_if_true",
          "to": "full"
        },
        {
          "amount": 20,
          "op": "give_coins"
        },
        {
          "flag": "EVENT_GOT_20_COINS",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuru2Received20CoinsText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "no_case",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerOopsForgotCoinCaseText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "full",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuru2YouGotYourOwnCoinsText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerFishingGuru2CloselyWatchTheReelsText"
        }
      ],
      "TEXT_GAMECORNER_GENTLEMAN": null,
      "TEXT_GAMECORNER_MIDDLE_AGED_MAN2": [
        {
          "flag": "EVENT_GOT_20_COINS_2",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "already"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerMiddleAgedMan2WantSomeCoinsText"
        },
        {
          "item": "COIN_CASE",
          "op": "check_item"
        },
        {
          "op": "jump_if_false",
          "to": "no_case"
        },
        {
          "amount": 9990,
          "op": "check_coins"
        },
        {
          "op": "jump_if_true",
          "to": "full"
        },
        {
          "amount": 20,
          "op": "give_coins"
        },
        {
          "flag": "EVENT_GOT_20_COINS_2",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerMiddleAgedMan2Received20CoinsText"
        },
        {
          "name": "Get_Item1",
          "op": "text_sound"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "no_case",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerOopsForgotCoinCaseText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "full",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerMiddleAgedMan2YouHaveLotsOfCoinsText"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "already",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_GameCornerMiddleAgedMan2INeedMoreCoinsText"
        }
      ]
    }
  },
  "MT_MOON_B2F": {
    "talk": {
      "TEXT_MTMOONB2F_JAMES": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_MtMoonJessieJamesText1"
        }
      ],
      "TEXT_MTMOONB2F_JESSIE": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_MtMoonJessieJamesText1"
        }
      ]
    }
  },
  "POKEMON_FAN_CLUB": {
    "talk": {
      "TEXT_POKEMONFANCLUB_PIKACHU": null,
      "TEXT_POKEMONFANCLUB_PIKACHU_FAN": null
    }
  },
  "POKEMON_TOWER_7F": {
    "talk": {
      "TEXT_POKEMONTOWER7F_JAMES": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_PokemonTowerJessieJamesText1"
        }
      ],
      "TEXT_POKEMONTOWER7F_JESSIE": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_PokemonTowerJessieJamesText1"
        }
      ],
      "TEXT_POKEMONTOWER7F_MR_FUJI": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_PokemonTower7FMrFujiRescueText"
        },
        {
          "flag": "EVENT_RESCUED_MR_FUJI",
          "op": "set_flag"
        },
        {
          "flag": "EVENT_RESCUED_MR_FUJI_2",
          "op": "set_flag"
        },
        {
          "map": "MR_FUJIS_HOUSE",
          "npc": "MRFUJISHOUSE_MR_FUJI",
          "op": "show_object"
        },
        {
          "map": "SAFFRON_CITY",
          "npc": "SAFFRONCITY_ROCKET8",
          "op": "hide_object"
        },
        {
          "facing": "up",
          "map": "MR_FUJIS_HOUSE",
          "op": "warp",
          "x": 3,
          "y": 7
        }
      ]
    }
  },
  "ROCKET_HIDEOUT_B4F": {
    "talk": {
      "TEXT_ROCKETHIDEOUTB4F_JAMES": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_RocketHideoutJessieJamesText1"
        }
      ],
      "TEXT_ROCKETHIDEOUTB4F_JESSIE": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_RocketHideoutJessieJamesText1"
        }
      ]
    }
  },
  "ROUTE_18_GATE_2F": {
    "talk": {
      "TEXT_ROUTE18GATE2F_COOK": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_TRADED_SLOWBRO_FOR_LICKITUNG",
          "index": 6,
          "op": "trade"
        }
      ],
      "TEXT_ROUTE18GATE2F_YOUNGSTER": null
    }
  },
  "ROUTE_24": {
    "talk": {
      "TEXT_ROUTE24_COOLTRAINER_M4": [
        {
          "op": "face_player"
        },
        {
          "flag": "EVENT_54F",
          "op": "check_flag"
        },
        {
          "op": "jump_if_true",
          "to": "after"
        },
        {
          "op": "ask",
          "textId": "_Route24DamianText1"
        },
        {
          "op": "jump_if_false",
          "to": "declined"
        },
        {
          "level": 10,
          "op": "give_pokemon",
          "species": "CHARMANDER"
        },
        {
          "op": "jump_if_false",
          "to": "end"
        },
        {
          "flag": "EVENT_54F",
          "op": "set_flag"
        },
        {
          "op": "show_text",
          "textId": "_Route24DamianText2"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "declined",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_Route24DamianText3"
        },
        {
          "op": "jump",
          "to": "end"
        },
        {
          "name": "after",
          "op": "label"
        },
        {
          "op": "show_text",
          "textId": "_Route24DamianText4"
        }
      ]
    }
  },
  "SILPH_CO_11F": {
    "talk": {
      "TEXT_SILPHCO11F_JAMES": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SilphCoJessieJamesText1"
        }
      ],
      "TEXT_SILPHCO11F_JESSIE": [
        {
          "op": "face_player"
        },
        {
          "op": "show_text",
          "textId": "_SilphCoJessieJamesText1"
        }
      ]
    }
  },
  "VERMILION_TRADE_HOUSE": {
    "talk": {
      "TEXT_VERMILIONTRADEHOUSE_LITTLE_GIRL": null
    }
  }
};

/**
 * The talk script for a TEXT_* id on a transcribed map, or null.
 *
 * Yellow consults its overlay first: a row there is its own script, a null
 * there is "nothing, not even Red's". Red and Blue never look at the overlay.
 */
export function transcribedScript(mapId: string, textId: string,
                                  version: CartridgeVersion = "red"): ScriptCommand[] {
  if (version === "yellow") {
    const over = PORTED_YELLOW[mapId];
    if (over && over.talk && Object.prototype.hasOwnProperty.call(over.talk, textId)) {
      const own = over.talk[textId];
      return own ? own : null;
    }
  }
  const set = PORTED[mapId];
  if (!set || !set.talk) {
    return null;
  }
  const script = set.talk[textId];
  return script ? script : null;
}

/** Every transcribed map id, for a version. */
export function transcribedMaps(version: CartridgeVersion = "red"): string[] {
  const out = Object.keys(PORTED);
  if (version === "yellow") {
    const more = Object.keys(PORTED_YELLOW);
    for (let i = 0; i < more.length; i++) {
      if (out.indexOf(more[i]) < 0) {
        out.push(more[i]);
      }
    }
  }
  return out;
}

/** The whole Red table, for the tests. */
export function transcribedAll(): any {
  return PORTED;
}

/** The Yellow overlay, for the tests. */
export function transcribedYellowOverlay(): any {
  return PORTED_YELLOW;
}
