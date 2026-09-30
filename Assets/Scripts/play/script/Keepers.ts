// Four people who open a list: the Badge House man, Bill's PC, the NAME RATER
// and the DAYCARE gentleman.
//
// Each is a `text_asm` on the cartridge -- a conversation with a menu in the
// middle of it and a loop round it -- which is why none of them transcribes to
// a command list and why they waited for a list a script could open
// (Host.chooseRow, built for the vending machines). They are step machines
// here, re-entered every frame like every other host routine, over a narrow
// port so a node test can hold the whole conversation.
//
//   badge_house  scripts/CeruleanBadgeHouse.asm: the line, then "Which of the
//                8 BADGEs?" over the badge list for as long as the player
//                keeps picking, and "Come visit me any time" on the way out.
//   bills_list   engine/events/hidden_objects/bills_house_pc.asm: EEVEE and
//                its three evolutions; each pick opens the Pokedex page, and
//                _DisplayPokedex marks the species SEEN on the way back.
//   name_rater   scripts/NameRatersHouse.asm: a Pokemon somebody else caught
//                has "a truly impeccable name" and cannot be renamed.
//   day_care     scripts/Daycare.asm; the arithmetic is play/DayCare.ts.

import type { BattleMon } from "../battle/types";
import type { PlayState } from "../PlayState";
import { MAX_PARTY } from "../battle/Party";
import {
  dayCareCost, dayCareLevelsGrown, depositInDayCare, knowsHmMove, withdrawFromDayCare,
} from "../DayCare";

import { DONE, RUNNING } from "./ScriptVM";

export const ROUTINE_BADGE_HOUSE: string = "badge_house";
export const ROUTINE_BILLS_LIST: string = "bills_list";
export const ROUTINE_NAME_RATER: string = "name_rater";
export const ROUTINE_DAY_CARE: string = "day_care";

export const KEEPER_ROUTINES: string[] = [
  ROUTINE_BADGE_HOUSE, ROUTINE_BILLS_LIST, ROUTINE_NAME_RATER, ROUTINE_DAY_CARE,
];

const CANCEL: string = "CANCEL";

/** CeruleanBadgeHouse.asm .BadgeItemList, in gym order; the names are the items' own. */
export const BADGE_ITEMS: string[] = [
  "BOULDERBADGE", "CASCADEBADGE", "THUNDERBADGE", "RAINBOWBADGE",
  "SOULBADGE", "MARSHBADGE", "VOLCANOBADGE", "EARTHBADGE",
];
export const BADGE_TEXTS: string[] = [
  "_CeruleanBadgeHouseBoulderBadgeText", "_CeruleanBadgeHouseCascadeBadgeText",
  "_CeruleanBadgeHouseThunderBadgeText", "_CeruleanBadgeHouseRainbowBadgeText",
  "_CeruleanBadgeHouseSoulBadgeText", "_CeruleanBadgeHouseMarshBadgeText",
  "_CeruleanBadgeHouseVolcanoBadgeText", "_CeruleanBadgeHouseEarthBadgeText",
];
const TEXT_BADGE_INTRO: string = "_CeruleanBadgeHouseMiddleAgedManText";
const TEXT_BADGE_WHICH: string = "_CeruleanBadgeHouseMiddleAgedManWhichBadgeText";
const TEXT_BADGE_BYE: string = "_CeruleanBadgeHouseMiddleAgedManVisitAnyTimeText";

/** bills_house_pc.asm: the four rows above CANCEL. */
export const BILLS_LIST: string[] = ["EEVEE", "FLAREON", "JOLTEON", "VAPOREON"];
const TEXT_BILLS_2: string = "_BillsHousePokemonListText2";

const TEXT_RATER_WANT: string = "_NameRatersHouseNameRaterWantMeToRateText";
const TEXT_RATER_WHICH: string = "_NameRatersHouseNameRaterWhichPokemonText";
const TEXT_RATER_IMPECCABLE: string = "_NameRatersHouseNameRaterATrulyImpeccableNameText";
const TEXT_RATER_NICE: string = "_NameRatersHouseNameRaterGiveItANiceNameText";
const TEXT_RATER_WHAT: string = "_NameRatersHouseNameRaterWhatShouldWeNameItText";
const TEXT_RATER_RENAMED: string = "_NameRatersHouseNameRaterPokemonHasBeenRenamedText";
const TEXT_RATER_BYE: string = "_NameRatersHouseNameRaterComeAnyTimeYouLikeText";

const TEXT_CARE_INTRO: string = "_DaycareGentlemanIntroText";
const TEXT_CARE_COME_AGAIN: string = "_DaycareGentlemanComeAgainText";
const TEXT_CARE_ALL_RIGHT: string = "_DaycareGentlemanAllRightThenText";
const TEXT_CARE_ONLY_ONE: string = "_DaycareGentlemanOnlyHaveOneMonText";
const TEXT_CARE_WHICH: string = "_DaycareGentlemanWhichMonText";
const TEXT_CARE_HM: string = "_DaycareGentlemanCantAcceptMonWithHMText";
const TEXT_CARE_LOOK_AFTER: string = "_DaycareGentlemanWillLookAfterMonText";
const TEXT_CARE_IN_A_WHILE: string = "_DaycareGentlemanComeSeeMeInAWhileText";
const TEXT_CARE_GROWN: string = "_DaycareGentlemanMonHasGrownText";
const TEXT_CARE_MORE_TIME: string = "_DaycareGentlemanMonNeedsMoreTimeText";
const TEXT_CARE_NO_ROOM: string = "_DaycareGentlemanNoRoomForMonText";
const TEXT_CARE_OWE: string = "_DaycareGentlemanOweMoneyText";
const TEXT_CARE_NO_MONEY: string = "_DaycareGentlemanNotEnoughMoneyText";
const TEXT_CARE_HERES: string = "_DaycareGentlemanHeresYourMonText";
const TEXT_CARE_GOT_BACK: string = "_DaycareGentlemanGotMonBackText";

const ANSWER_FLAG: string = "KEEPER_ANSWER";

/** Steps shared by the machines below. */
const STEP_LISTING: number = 1;
const STEP_TELLING: number = 2;
/** The closing line is being read; see endWith. */
const STEP_ENDING: number = 99;

/** What a keeper needs of the host. PlayHost is the one implementation. */
export interface KeeperPort {
  state(): PlayState;
  bundle(): any;
  /** A paged line; a label or the words themselves. DONE once read. */
  say(text: string, ram: string, num: number): number;
  /** A yes/no under a line. DONE once answered; the answer is in `answered()`. */
  askYesNo(text: string, flag: string, ram: string, num: number): number;
  answered(flag: string): boolean;
  /** A list. DONE once closed; `pickedRow()` is the row, -1 for a cancel. */
  list(title: string, labels: string[], notes: string[]): number;
  pickedRow(): number;
  /** The Pokedex page of a species, held until closed. Marks it seen. */
  dexPage(species: string): number;
  /** The NICKNAME? screen for a party slot, held until closed. */
  nickname(partyIndex: number): number;
  cry(species: string): void;
  sound(name: string): void;
}

export class Keepers {
  private step: number = 0;
  private row: number = -1;
  private oldName: string = "";
  private line: string = "";
  private lineRam: string = "";
  private lineNum: number = -1;
  private grown: number = 0;

  private port: KeeperPort;

  constructor(port: KeeperPort) {
    this.port = port;
  }

  handles(routine: string): boolean {
    return KEEPER_ROUTINES.indexOf(routine) >= 0;
  }

  call(routine: string): number {
    if (routine === ROUTINE_BADGE_HOUSE) return this.badgeHouse();
    if (routine === ROUTINE_BILLS_LIST) return this.billsList();
    if (routine === ROUTINE_NAME_RATER) return this.nameRater();
    return this.dayCare();
  }

  /** Back to the start, and DONE: every ending of every keeper goes through here. */
  private finish(): number {
    this.step = 0;
    this.row = -1;
    this.oldName = "";
    this.line = "";
    this.lineRam = "";
    this.lineNum = -1;
    this.grown = 0;
    return DONE;
  }

  /**
   * The closing line. Its own step, because `say` runs over many frames and
   * the routine is re-entered on each: a step reset before the last page was
   * read would start the conversation again instead of ending it.
   */
  private endWith(step: number, text: string, ram: string, num: number): number {
    this.step = step;
    this.line = text;
    this.lineRam = ram;
    this.lineNum = num;
    return this.sayLine();
  }

  private sayLine(): number {
    const said = this.port.say(this.line, this.lineRam, this.lineNum);
    return said === DONE ? this.finish() : said;
  }

  private words(label: string): string {
    const text = this.port.bundle().text;
    return text && text[label] ? text[label] : "";
  }

  // -- the Badge House ---------------------------------------------------------

  private badgeHouse(): number {
    if (this.step === STEP_ENDING) return this.sayLine();
    if (this.step === 0) {
      const said = this.port.say(TEXT_BADGE_INTRO, "", -1);
      if (said !== DONE) return said;
      this.step = STEP_LISTING;
    }
    if (this.step === STEP_LISTING) {
      const items = this.port.bundle().items;
      const labels: string[] = [];
      const notes: string[] = [];
      for (let i = 0; i < BADGE_ITEMS.length; i++) {
        const def = items ? items[BADGE_ITEMS[i]] : null;
        labels.push(def && def.name ? def.name : BADGE_ITEMS[i]);
        notes.push("");
      }
      labels.push(CANCEL);
      notes.push("");
      const listed = this.port.list(this.words(TEXT_BADGE_WHICH), labels, notes);
      if (listed !== DONE) return listed;
      this.row = this.port.pickedRow();
      if (this.row < 0 || this.row >= BADGE_TEXTS.length) {
        return this.endWith(STEP_ENDING, TEXT_BADGE_BYE, "", -1);
      }
      this.step = STEP_TELLING;
    }
    const told = this.port.say(BADGE_TEXTS[this.row], "", -1);
    if (told !== DONE) return told;
    // `jr .asm_74e23`: back to "Which of the 8 BADGEs", not out.
    this.step = STEP_LISTING;
    return RUNNING;
  }

  // -- Bill's PC ---------------------------------------------------------------

  private billsList(): number {
    if (this.step === 0) {
      // Text1 is the caller's line ("BILL's favorite POKeMON list!"); the
      // routine begins at the question.
      this.step = 1;
    }
    if (this.step === 1) {
      const names: string[] = [];
      const notes: string[] = [];
      const species = this.port.bundle().species;
      for (let i = 0; i < BILLS_LIST.length; i++) {
        const spec = species ? species[BILLS_LIST[i]] : null;
        names.push(spec && spec.name ? spec.name : BILLS_LIST[i]);
        notes.push("");
      }
      names.push(CANCEL);
      notes.push("");
      const listed = this.port.list(this.words(TEXT_BILLS_2), names, notes);
      if (listed !== DONE) return listed;
      this.row = this.port.pickedRow();
      if (this.row < 0 || this.row >= BILLS_LIST.length) {
        return this.finish();
      }
      this.step = 2;
    }
    const page = this.port.dexPage(BILLS_LIST[this.row]);
    if (page !== DONE) return page;
    this.step = 1;
    return RUNNING;
  }

  // -- the NAME RATER ----------------------------------------------------------

  /** The party as a list: the names, their levels, and the way out. */
  private pickParty(title: string): number {
    const party: BattleMon[] = this.port.state().party;
    const labels: string[] = [];
    const notes: string[] = [];
    for (let i = 0; i < party.length; i++) {
      labels.push(party[i].name);
      notes.push(":L" + party[i].level);
    }
    labels.push(CANCEL);
    notes.push("");
    const listed = this.port.list(title, labels, notes);
    if (listed !== DONE) return listed;
    const row = this.port.pickedRow();
    this.row = row >= 0 && row < party.length ? row : -1;
    return DONE;
  }

  /** .CheckOriginalTrainer: a different OT name or a different OT id. */
  private caughtBySomeoneElse(mon: BattleMon): boolean {
    const state = this.port.state();
    if (!mon.otName) {
      return false;
    }
    return mon.otName !== state.playerName || mon.otId !== state.playerId;
  }

  private nameRater(): number {
    if (this.step === STEP_ENDING) return this.sayLine();
    if (this.step === 0) {
      const asked = this.port.askYesNo(TEXT_RATER_WANT, ANSWER_FLAG, "", -1);
      if (asked !== DONE) return asked;
      if (!this.port.answered(ANSWER_FLAG)) {
        return this.endWith(STEP_ENDING, TEXT_RATER_BYE, "", -1);
      }
      this.step = 1;
    }
    if (this.step === 1) {
      const said = this.port.say(TEXT_RATER_WHICH, "", -1);
      if (said !== DONE) return said;
      this.step = 2;
    }
    if (this.step === 2) {
      const picked = this.pickParty(this.words(TEXT_RATER_WHICH));
      if (picked !== DONE) return picked;
      if (this.row < 0) {
        return this.endWith(STEP_ENDING, TEXT_RATER_BYE, "", -1);
      }
      const mon = this.port.state().party[this.row];
      this.oldName = mon.name;
      if (this.caughtBySomeoneElse(mon)) {
        return this.endWith(STEP_ENDING, TEXT_RATER_IMPECCABLE, mon.name, -1);
      }
      this.step = 3;
    }
    if (this.step === 3) {
      const asked = this.port.askYesNo(TEXT_RATER_NICE, ANSWER_FLAG, this.oldName, -1);
      if (asked !== DONE) return asked;
      if (!this.port.answered(ANSWER_FLAG)) {
        return this.endWith(STEP_ENDING, TEXT_RATER_BYE, "", -1);
      }
      this.step = 4;
    }
    if (this.step === 4) {
      const said = this.port.say(TEXT_RATER_WHAT, "", -1);
      if (said !== DONE) return said;
      this.step = 5;
    }
    // DisplayNameRaterScreen: carry (no rename) when the name comes back empty
    // or unchanged; the lens's screen leaves the old name standing in both.
    const named = this.port.nickname(this.row);
    if (named !== DONE) return named;
    const mon = this.port.state().party[this.row];
    if (!mon || mon.name === this.oldName) {
      return this.endWith(STEP_ENDING, TEXT_RATER_BYE, "", -1);
    }
    return this.endWith(STEP_ENDING, TEXT_RATER_RENAMED, mon.name, -1);
  }

  // -- the DAYCARE -------------------------------------------------------------

  /** "All right then," runs straight into "come again." on the cartridge. */
  private allRightThen(): string {
    return this.words(TEXT_CARE_ALL_RIGHT) + this.words(TEXT_CARE_COME_AGAIN);
  }

  private dayCare(): number {
    if (this.step === STEP_ENDING) return this.sayLine();
    const state: PlayState = this.port.state();
    if (this.step >= 20 || (this.step === 0 && state.dayCare)) {
      return this.dayCareReturn();
    }
    if (this.step === 0) {
      const asked = this.port.askYesNo(TEXT_CARE_INTRO, ANSWER_FLAG, "", -1);
      if (asked !== DONE) return asked;
      if (!this.port.answered(ANSWER_FLAG)) {
        return this.endWith(STEP_ENDING, TEXT_CARE_COME_AGAIN, "", -1);
      }
      if (state.party.length < 2) {
        return this.endWith(STEP_ENDING, TEXT_CARE_ONLY_ONE, "", -1);
      }
      this.step = 1;
    }
    if (this.step === 1) {
      const said = this.port.say(TEXT_CARE_WHICH, "", -1);
      if (said !== DONE) return said;
      this.step = 2;
    }
    if (this.step === 2) {
      const picked = this.pickParty(this.words(TEXT_CARE_WHICH));
      if (picked !== DONE) return picked;
      if (this.row < 0) {
        return this.endWith(STEP_ENDING, this.allRightThen(), "", -1);
      }
      const mon: BattleMon = state.party[this.row];
      if (knowsHmMove(mon)) {
        return this.endWith(STEP_ENDING, TEXT_CARE_HM, "", -1);
      }
      this.oldName = mon.name;
      this.step = 3;
    }
    if (this.step === 3) {
      const said = this.port.say(TEXT_CARE_LOOK_AFTER, this.oldName, -1);
      if (said !== DONE) return said;
      const mon: BattleMon = state.party[this.row];
      state.dayCare = depositInDayCare(mon);
      state.party = state.party.filter((m: BattleMon, i: number) => i !== this.row);
      this.port.cry(mon.species);
      return this.endWith(STEP_ENDING, TEXT_CARE_IN_A_WHILE, "", -1);
    }
    return this.finish();
  }

  /** `.daycareInUse`: the report, the bill, and the Pokemon back. */
  private dayCareReturn(): number {
    const state: PlayState = this.port.state();
    const bundle = this.port.bundle();
    if (this.step === 0) {
      this.grown = dayCareLevelsGrown(bundle, state.dayCare);
      this.oldName = state.dayCare.mon.name;
      this.step = 20;
    }
    if (this.step === 20) {
      const report = this.grown > 0 ? TEXT_CARE_GROWN : TEXT_CARE_MORE_TIME;
      const said = this.port.say(report, this.oldName, this.grown);
      if (said !== DONE) return said;
      if (state.party.length >= MAX_PARTY) {
        return this.endWith(STEP_ENDING, TEXT_CARE_NO_ROOM, "", -1);
      }
      this.step = 21;
    }
    if (this.step === 21) {
      const asked = this.port.askYesNo(TEXT_CARE_OWE, ANSWER_FLAG, "", dayCareCost(this.grown));
      if (asked !== DONE) return asked;
      if (!this.port.answered(ANSWER_FLAG)) {
        return this.endWith(STEP_ENDING, this.allRightThen(), "", -1);
      }
      if (state.money < dayCareCost(this.grown)) {
        return this.endWith(STEP_ENDING, TEXT_CARE_NO_MONEY, "", -1);
      }
      state.money = state.money - dayCareCost(this.grown);
      this.port.sound("Purchase");
      this.step = 22;
    }
    if (this.step === 22) {
      const said = this.port.say(TEXT_CARE_HERES, "", -1);
      if (said !== DONE) return said;
      const back: BattleMon = withdrawFromDayCare(bundle, state.dayCare);
      state.party = state.party.concat([back]);
      state.dayCare = null;
      this.port.cry(back.species);
      return this.endWith(STEP_ENDING, TEXT_CARE_GOT_BACK, this.oldName, -1);
    }
    return this.finish();
  }
}
