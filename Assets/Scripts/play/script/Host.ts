// The concrete ScriptHost: what actually happens when a ported script runs.
//
// ScriptVM.ts defines the interface and MapScripts.ts holds the data. This is the
// third side, and until now it did not exist -- which is why talking to an NPC
// did nothing at all.
//
// It is deliberately pure logic over a narrow `HostServices` port. Everything
// that needs Lens Studio (a message box, a fade, a naming screen, the battle
// stage) is behind that port, so the whole of a conversation, a badge handover
// and the intro can be driven headlessly in a test. The alternative -- reaching
// for SceneObjects here -- makes the one part of the project with real branching
// the one part that can only be checked by wearing it.
//
// Two things the VM does that every method below has to respect:
//
//   * A command that is not finished is CALLED AGAIN NEXT FRAME with the same
//     arguments. There is no "start" callback; the first call has to notice it is
//     the first one.
//   * After a command returns DONE the VM immediately runs the next one IN THE
//     SAME FRAME. Per-command state must be cleared on the way out, not on the
//     way in, or the following command inherits it.

import { cartridgeVersion } from "../../world/Cartridge";
import type { MapDef, TradeDef, WorldBundle } from "../../world/WorldData";
import type { ScriptHost } from "./ScriptVM";
import { DONE, RUNNING, SUSPENDED } from "./ScriptVM";
import {
  ROUTINE_BLACKBOARD, ROUTINE_LINK_BOARD, SCREEN_PICTURE, TEXT_BLACKBOARD_1, TEXT_BLACKBOARD_2,
  BLACKBOARD_TOPICS, BLACKBOARD_TEXTS, TEXT_LINK_1, TEXT_LINK_2, LINK_TOPICS, LINK_TEXTS,
} from "./Bookshelves";
import { fillSlots, paginate, scriptText } from "./Dialogue";
import { pictureFor } from "../screen/PictureScreen";
import type { KeeperPort } from "./Keepers";
import { Keepers } from "./Keepers";
import type { PlayState } from "../PlayState";
import { newVolatileState } from "../battle/types";
import { canFight, dexOwnedCount, giveItem, hasItem, markOwned, markSeen, markTrainerDefeated, takeItem, TEXT_SPEED_MEDIUM } from "../PlayState";

/** The lab row Oak stands on (OAKSLAB_OAK1 ships at 5,2); see rivalBeside. */
const OAKS_DESK_ROW: number = 2;
import type { BattleMon } from "../battle/types";
import { makeWildMon } from "../battle/Stats";
import type { Victory } from "../battle/Victories";
import { victoryFor } from "../battle/Victories";
import {
  ROUTINE_CUT, ROUTINE_FLASH, ROUTINE_FLY, ROUTINE_STRENGTH, ROUTINE_SURF,
} from "../FieldMoves";
import type { ReceiveResult } from "../Storage";
import { RECEIVE_BOX, RECEIVE_PARTY, receiveMon } from "../Storage";
import { randomByte as randomByteOf } from "../battle/Damage";
import { elevatorFor, TEXT_WHICH_FLOOR } from "./Elevators";
import { ELEVATOR_SHAKE_SECONDS } from "../WorldShake";
import { SHIP_SLIDE_FRAMES, SHIP_SLIDE_STEPS } from "./Sailing";
import type { Prize } from "./Prizes";
import {
  NO_THANKS, prizesForCounter, TEXT_EXCHANGE, TEXT_NEED_COIN_CASE, TEXT_NEED_MORE_COINS,
  TEXT_NO_ROOM, TEXT_OH_FINE_THEN, TEXT_SO_YOU_WANT, TEXT_WHICH_PRIZE,
} from "./Prizes";
import { EVENT_IN_SAFARI, EVENT_SAFARI_OVER, SAFARI_BALLS, SAFARI_STEPS } from "./Safari";
import { SFX_FLY } from "../../audio/Sfx";

/**
 * The steps of an in-game trade: he asks, and what follows depends on the
 * answer and on what is in the party. Held across frames because every page
 * of every line takes as many frames as the player needs to read it.
 */
const TRADE_ASKING: number = 0;
const TRADE_REFUSED: number = 1;
const TRADE_WRONG_MON: number = 2;
const TRADE_CABLE: number = 3;
const TRADE_TRADED: number = 4;
const TRADE_THANKS: number = 5;
/** Scratch: the yes/no answer, removed again so it never lands in the save. */
const TRADE_ANSWER_FLAG: string = "TRADE_ANSWER";

/** The steps of a prize counter; see prizeCounter(). */
const PRIZE_ASKING: number = 0;
const PRIZE_LISTING: number = 1;
const PRIZE_CONFIRMING: number = 2;
const PRIZE_REFUSED: number = 3;
const PRIZE_TOO_POOR: number = 4;
const PRIZE_PAYING: number = 5;
const PRIZE_ANSWER_FLAG: string = "PRIZE_ANSWER";
const PRIZE_COIN_CASE: string = "COIN_CASE";

/** The answer to a yes/no box: still waiting, or the answer itself. */
export const ANSWER_PENDING: number = -1;
export const ANSWER_NO: number = 0;
export const ANSWER_YES: number = 1;

/**
 * Everything the host needs from outside itself.
 *
 * Kept small on purpose: each of these is a thing the lens can do and a test can
 * fake. Nothing here returns a SceneObject or a Material.
 */
export interface HostServices {
  /** Put a page of at most two lines on screen. */
  showLines(lines: string[]): void;
  /** True once the player has acknowledged the page currently shown. */
  pageAcknowledged(): boolean;
  /** Take the message box away. */
  closeBox(): void;
  /** The yes/no answer, or ANSWER_PENDING. */
  answer(): number;
  /** Ask for a yes/no on the page currently shown. */
  requestAnswer(): void;

  /** The map the player is standing on. */
  currentMap(): MapDef;
  /**
   * The last OUTDOOR map the player was on -- wLastMap. Optional: PlayLoop
   * supplies it from the world it is attached to, so no harness has to.
   */
  lastOutdoorMap?(): string;
  /**
   * The S.S. Anne has just sailed: water where she lay, the gangway warp shut
   * (Sailing.ts). PlayLoop supplies it; a host without a world has nothing to stamp.
   */
  shipSailed?(): void;
  /**
   * The S.S. Anne `shift` block columns out to sea, water closing behind her
   * (Sailing.shipBlocksAfter). Called once per column while she slides;
   * shipSailed follows the last. Optional for the same reason shipSailed is.
   */
  shipMoved?(shift: number): void;
  /**
   * Roll the credits. The HALL OF FAME's script asks for it after OAK's last
   * line; the lens takes the screen when the script has finished. Optional:
   * the harness and the oracle have nothing to roll them on.
   */
  rollCredits?(): void;
  /**
   * Jolt the world for `seconds`: the lift travelling (play/WorldShake.ts).
   *
   * Optional, like rollCredits and for the same reason -- a headless harness
   * has no world to shake, and the floor it arrives on must not depend on
   * whether anybody watched it get there.
   */
  shakeWorld?(seconds: number): void;
  /** Turn the NPC being talked to toward the player. */
  facePlayer(): void;
  faceNpc(npc: string, direction: string): void;
  /**
   * Where an NPC is standing and looking RIGHT NOW, or null when it has not
   * moved and its shipped cell still tells the truth.
   *
   * A trainer's line of sight is judged from this rather than from the map,
   * because a trainer who has walked is looking somewhere the map does not
   * know about -- and a sightline that disagreed with the body on screen
   * would be the same fault as a sprite drawn over one it stands behind.
   */
  npcPose(npc: string): any;
  /**
   * Show or hide an NPC for the rest of this session; see Dialogue.facingTarget.
   *
   * `mapId` may name a map the player is not on -- beating Brock hides an NPC in
   * Pewter City and another on Route 22. "" means the current map.
   */
  setNpcRevealed(mapId: string, npc: string, visible: boolean): void;
  movePlayer(direction: string, steps: number): number;
  facePlayerDir(direction: string): void;
  /** Which way the player faces right now: "up", "down", "left" or "right". */
  playerFacing(): string;
  /** The cell the player stands on, [x, y]. */
  playerCell(): number[];
  /** A flag changed a block on this map: redraw the world. */
  blocksChanged(mapId: string): void;
  walkNpc(npc: string, direction: string, steps: number): number;
  /**
   * Raise the mark over an NPC's head and keep the script waiting under it.
   *
   * RUNNING until its frames are up, then DONE -- the cartridge's predef is a
   * blocking call and the walk begins after it, not with it.
   */
  emote(npc: string, kind: string): number;
  moveNpcTo(npc: string, x: number, y: number): number;
  placeNpc(npc: string, x: number, y: number, facing: string): void;
  playMusic(track: string): void;
  stopMusic(): void;
  playDefaultMusic(): void;
  textSound(name: string): void;
  /** DONE once the NPC has finished walking the path. */
  moveNpc(npc: string, path: string[]): number;
  warp(mapId: string, warpIndex: number): void;
  warpTo(mapId: string, x: number, y: number, facing: string): void;

  /**
   * Open the Poke Mart over `stock` (item ids). The lens owns the screen; the
   * host polls shopOpen() and keeps the script suspended until it closes.
   */
  openShop(stock: string[]): void;
  shopOpen(): boolean;

  /**
   * Open the PC the player is facing -- PC_KIND_HOME or PC_KIND_FULL. Same
   * contract as openShop: the lens owns the screen, and the host keeps the
   * script suspended until pcOpen() goes false.
   */
  openPc(kind: string): void;
  pcOpen(): boolean;
  /**
   * A slot machine (SlotController). `chance` is that machine's own
   * seven-and-bar threshold. Suspends the script until the player leaves it.
   */
  openSlots?(chance: number): void;
  slotsOpen?(): boolean;

  /**
   * A list to pick one row from -- a lift's floors, a prize counter's three
   * prizes. Same contract as openShop: the lens owns the screen and the host
   * keeps the script suspended until choiceOpen() goes false, and then
   * choicePicked() is the row, or -1 if the player backed out.
   *
   * Optional: a harness with no screen answers -1 and the routine goes on.
   */
  openChoice?(title: string, labels: string[], notes: string[]): void;
  choiceOpen?(): boolean;
  choicePicked?(): number;

  /**
   * Point one of THIS map's warps somewhere else for the rest of the visit:
   * a lift car's two doors, once a floor has been chosen (Elevators.ts).
   */
  overrideWarp?(x: number, y: number, destMap: string, destWarp: number): void;

  /** Start a battle against a trainer roster. Called once per battle. */
  beginTrainerBattle(trainerId: string, partyIndex: number): void;
  /** Start a battle against one fixed Pokemon standing in the world. */
  beginStaticBattle(species: string, level: number): void;
  /**
   * The old man's catching demonstration (BattleRunner.startDemo). Optional:
   * a harness with no battle stage skips it and the script goes on, which is
   * also what the headless lens does with every other battle.
   */
  beginDemoBattle?(species?: string, level?: number, thrower?: string, catches?: boolean): void;
  /** True once that battle has left the screen. */
  battleOver(): boolean;
  /** True when the player won the battle that just ended. */
  battleWon(): boolean;
  /** Whether the last battle ended by CATCHING the foe (wBattleResult == 2). */
  battleCaught?(): boolean;

  playCry(species: string): void;
  /** DONE when the fade has finished. */
  fade(direction: string, colour: string): number;
  /** DONE when the jingle has finished. */
  playOnce(track: string): number;
  frames(): number;

  /**
   * The five field moves. Each is one line in the lens over Overworld, and
   * each is reached only through a script that has already shown the
   * cartridge's own message, so none of them prints.
   */
  /** Cut what the player faces. False when there was nothing after all. */
  cutTreeAhead(): boolean;
  startSurf(): void;
  activateStrength(): void;
  flyTo(mapId: string): void;
  lightArea(): void;
  /** A block changed under the player: redraw the terrain, not the NPCs. */
  redrawTerrain(): void;

  /** Put a sprite on the intro's black stage; "" clears it. */
  introStage(who: string): void;
  /** DONE once a name has been committed. Writes it into the PlayState. */
  nameEntry(who: string): number;
  /**
   * The Pokedex data page for `species`. SUSPENDED until the page is closed
   * with its measured presses (one to turn the two-page description, one
   * more to leave it), the same shape as nameEntry(). PlayHost has already
   * checked the species exists in the bundle and recorded the sighting;
   * this only has to show and hold the page.
   */
  dexEntry(species: string): number;
  /**
   * A picture in a box with its caption's pages under it, SUSPENDED until
   * the last page is read. Optional: a host without it says the words.
   */
  picture?(key: string, pages: string[][]): number;

  /** A number in [0,1). The battle engine's stream, so a starter rolls its DVs. */
  random(): number;
}

/** Species the three balls in Oak's lab hold, and the level they come at. */
export const STARTER_LEVEL: number = 5;
/** The coin counter's cap: three BCD bytes on the cartridge. */
export const MAX_COINS: number = 9999;

/**
 * The three drinks and their prices (data/items/vending_prices.asm). The only
 * source of any of them in the game, and four Saffron gates want one each.
 */
const VENDING_DRINKS: any[] = [
  { item: "FRESH_WATER", price: 200, label: "FRESH WATER" },
  { item: "SODA_POP", price: 300, label: "SODA POP" },
  { item: "LEMONADE", price: 350, label: "LEMONADE" },
];
const VENDING_CANCEL: string = "CANCEL";
const TEXT_VENDING_GREETING: string = "_VendingMachineText1";
const TEXT_VENDING_TOO_POOR: string = "_VendingMachineText4";
const TEXT_VENDING_BOUGHT: string = "_VendingMachineText5";
const TEXT_VENDING_NO_ROOM: string = "_VendingMachineText6";
const TEXT_VENDING_CANCELLED: string = "_VendingMachineText7";
/** The clunk of the can landing in the tray. */
const VENDING_CLUNK: string = "Push_Boulder";
const DRINK_GREETING: number = 0;
const DRINK_LISTING: number = 1;
const DRINK_PAYING: number = 2;
const DRINK_SAYING: number = 3;

export class PlayHost implements ScriptHost {
  private bundle: WorldBundle;
  private state: PlayState;
  private services: HostServices;

  /** Which text the box is currently paging through, and where it has got to. */
  private activeText: string = "";
  private pages: string[][] = [];
  private page: number = 0;
  private pagePushed: boolean = false;
  /** services.frames() at the moment the current page was pushed; see textReady(). */
  private pageShownFrame: number = 0;

  /** Set while a `call` routine is mid-flight, so it can tell first call from later. */
  private activeRoutine: string = "";
  private battleStarted: boolean = false;
  /** False when the last start_battle was refused rather than fought. */
  private lastBattleReal: boolean = false;
  /** Set while open_mart has handed the screen to the shop. */
  private shopOpened: boolean = false;
  /** The same, for open_pc. */
  private pcOpened: boolean = false;
  /** The same, for open_slots. */
  private slotsOpened: boolean = false;
  /** The same, for a choice list; see chooseRow(). */
  private choiceOpened: boolean = false;
  /** Where a wall board's reader is: the introduction, the list, or a topic. */
  private boardStep: number = 0;
  private boardRow: number = -1;
  /** The species push_screen is showing, so its sighting and print fire once. */
  private dexEntrySpecies: string = "";
  /**
   * The cartridge's wStringBuffer: the name of the last item given or Pokemon
   * received, which the gift texts read back through {RAM:wStringBuffer}. A
   * text command that carries no ram of its own gets this.
   */
  private stringBuffer: string = "";

  /** Where the in-game trade conversation has got to; see trade(). */
  private tradeStep: number = TRADE_ASKING;

  /** The row the last choice list came back with; -1 for a cancel. */
  private chosenRow: number = -1;

  /** How many columns the S.S. Anne has slid, and the frame the next one is due; see sailShip(). */
  private sailStep: number = 0;
  private sailNextFrame: number = -1;

  /** Where a prize counter's conversation has got to; see prizeCounter(). */
  private prizeStep: number = PRIZE_ASKING;
  private prizeRow: number = -1;
  /**
   * The in-flight give_pokemon, kept across frames while its box line pages,
   * and whether the last one found room at all.
   */
  private giveResult: ReceiveResult = null;
  private landed: boolean = false;

  constructor(bundle: WorldBundle, state: PlayState, services: HostServices) {
    this.bundle = bundle;
    this.state = state;
    this.services = services;
  }

  // -- text ------------------------------------------------------------------

  /**
   * A message, paged, DONE only once the player has read the last page.
   *
   * The body comes from scriptText, not resolveText: a script carries the
   * cartridge's own label for the words, and the TEXT_* pointer table cannot
   * resolve one. Getting that wrong is silent -- every line of every ported map
   * comes back null, which is also how "the words live in a script" is reported.
   */
  showText(textId: string, ram: string, num: number): number {
    if (this.activeText !== textId) {
      // A transcribed script may carry the WORDS rather than a label: the
      // reference inlines a line wherever the cartridge built it out of pieces
      // at runtime, and there is no label to point at. Anything that does not
      // look like a label or a TEXT_* id is taken literally.
      // A label is anything the cartridge's own text table has a key for.
      //
      // Deciding this on a leading underscore was wrong: ELEVEN of the
      // cartridge's labels do not have one -- SilphCo2FSilphWorkerFPleaseTake-
      // ThisText, the four S.S. Anne menu items, and six more -- and every one
      // of them would have had its own NAME printed in the message box as if it
      // were the words. Not a crash and not a blank: a box that reads
      // "SSAnneKitchenCook7EelsAuBarbecueText".
      const body = this.bodyFor(textId);
      if (body === null) {
        // Nothing to show. Say so once, loudly: a missing line is a porting
        // mistake, and silently skipping it hides which one.
        print("[PlayHost] no text for " + textId);
        return DONE;
      }
      this.activeText = textId;
      this.pages = pagesOf(body, this.state, ram ? ram : this.stringBuffer, num);
      this.page = 0;
      this.pagePushed = false;
    }
    return this.pageThrough(false, "");
  }

  /** A yes/no box. The answer lands in the named flag. */
  /**
   * The words behind an id, or the id itself when it is already the words.
   *
   * A transcribed script may carry the WORDS rather than a label: the
   * reference inlines a line wherever the cartridge built it out of pieces at
   * runtime, and there is no label to point at. So does anything this host
   * finishes itself -- a gym plaque with two names in it, a trade line with
   * two species in it -- because fillSlots puts one value in every slot.
   *
   * Deciding this on a leading underscore was wrong: ELEVEN of the cartridge's
   * labels do not have one -- SSAnneKitchenCook7EelsAuBarbecueText and the
   * four S.S. Anne menu items among them -- and every one of them would have
   * had its own NAME printed in the message box as if it were the words.
   */
  private bodyFor(textId: string): string {
    const known = this.bundle.text && this.bundle.text[textId] !== undefined;
    const isName = known || textId.charAt(0) === "_" || textId.indexOf("TEXT_") === 0;
    return isName ? scriptText(this.bundle, this.services.currentMap(), textId) : textId;
  }

  ask(textId: string, flag: string, ram: string, num: number): number {
    if (this.activeText !== textId) {
      const body = this.bodyFor(textId);
      if (body === null) {
        // Same missing-line case showText handles, and it used to show a blank
        // yes/no box here instead of saying anything -- a prompt with no question
        // in it, waiting for an answer. The flag goes to false, so the script
        // takes the branch that hands nothing over.
        print("[PlayHost] no text for " + textId + "; answering no");
        this.flagsOf()[flag] = false;
        return DONE;
      }
      this.activeText = textId;
      this.pages = pagesOf(body, this.state, ram ? ram : this.stringBuffer, num);
      this.page = 0;
      this.pagePushed = false;
    }
    return this.pageThrough(true, flag);
  }

  /** One step of paging. `asking` turns the last page into a yes/no. */
  private pageThrough(asking: boolean, flag: string): number {
    if (!this.pagePushed) {
      this.services.showLines(this.pages[this.page]);
      this.pagePushed = true;
      this.pageShownFrame = this.services.frames();
      if (asking && this.page === this.pages.length - 1) {
        this.services.requestAnswer();
      }
      return RUNNING;
    }

    if (asking && this.page === this.pages.length - 1) {
      const answer = this.services.answer();
      if (answer === ANSWER_PENDING) {
        return RUNNING;
      }
      this.flagsOf()[flag] = answer === ANSWER_YES;
      this.finishText();
      return DONE;
    }

    if (!this.services.pageAcknowledged()) {
      return RUNNING;
    }
    this.page++;
    this.pagePushed = false;
    if (this.page >= this.pages.length) {
      this.finishText();
      return DONE;
    }
    return RUNNING;
  }

  /**
   * True once the page on screen right now has finished printing, so a
   * press is allowed to acknowledge it. True with nothing on screen (a
   * battle's own message box does not run through this host at all, so its
   * pages never make pagePushed true here; see PokemonAR's battleView), so a
   * caller can gate a press on this unconditionally.
   *
   * Measured on the cartridge (tools/oracle, 6 sep): a page prints one new
   * letter every textSpeed frames -- FAST 1, MEDIUM 3, SLOW 5 -- including
   * spaces, and a `cont` scroll's line break costs no extra frame, so a page
   * of N new letters takes (N-1)*textSpeed frames from its first letter to
   * its last -- then one more textSpeed-frame beat before a button counts,
   * so N*textSpeed+1 frames after the page first went up. Bisected on the
   * ROM at all three speeds against two different page lengths (23 and 8
   * new letters -- the 23-letter page's own `cont` continuation): zero error.
   */
  textReady(): boolean {
    if (!this.pagePushed || this.page >= this.pages.length) {
      return true;
    }
    const speed = this.state.options ? this.state.options.textSpeed : TEXT_SPEED_MEDIUM;
    const letters = Math.max(this.newLettersOnPage(this.page), 1);
    const printFrames = letters * speed + 1;
    return this.services.frames() - this.pageShownFrame >= printFrames;
  }

  /**
   * How many letters of `pages[index]` are actually typed for THIS page.
   *
   * A `cont` scroll carries its previous page's bottom line up to the top
   * row unchanged (paginate() repeats it verbatim) -- the cartridge does not
   * retype it, it is already sitting there from the page before, so only the
   * page's other line(s) take printing time.
   */
  private newLettersOnPage(index: number): number {
    const page = this.pages[index];
    const prior = index > 0 ? this.pages[index - 1] : null;
    let letters = 0;
    for (let i = 0; i < page.length; i++) {
      const carried = i === 0 && prior !== null && page.length > 1 &&
        prior[prior.length - 1] === page[0];
      if (!carried) {
        letters += page[i].length;
      }
    }
    return letters;
  }

  private finishText(): void {
    this.services.closeBox();
    this.activeText = "";
    this.pages = [];
    this.page = 0;
    this.pagePushed = false;
  }

  private flagsOf(): any {
    return this.state.flags;
  }

  // -- the world -------------------------------------------------------------

  facePlayer(): void {
    this.services.facePlayer();
  }

  faceNpc(npc: string, direction: string): void {
    this.services.faceNpc(npc, direction);
  }

  showNpc(mapId: string, npc: string, visible: boolean): void {
    this.services.setNpcRevealed(mapId, npc, visible);
  }

  movePlayer(direction: string, steps: number): number {
    return this.services.movePlayer(direction, steps);
  }

  facePlayerDir(direction: string): void {
    this.services.facePlayerDir(direction);
  }

  walkNpc(npc: string, direction: string, steps: number): number {
    return this.services.walkNpc(npc, direction, steps);
  }

  emote(npc: string, kind: string): number {
    return this.services.emote(npc, kind);
  }

  moveNpcTo(npc: string, x: number, y: number): number {
    return this.services.moveNpcTo(npc, x, y);
  }

  placeNpc(npc: string, x: number, y: number, facing: string): void {
    this.services.placeNpc(npc, x, y, facing);
  }

  playMusic(track: string): void {
    this.services.playMusic(track);
  }

  stopMusic(): void {
    this.services.stopMusic();
  }

  playDefaultMusic(): void {
    this.services.playDefaultMusic();
  }

  textSound(name: string): void {
    this.services.textSound(name);
  }

  /**
   * Whether the last battle was WON -- and whether there was one.
   *
   * `check_battle_result` runs one command after `start_battle`, and a battle
   * the host REFUSED (nothing that can fight, a species the bundle lacks)
   * returns DONE without ever asking the runner. Reading services.battleWon()
   * there reports whatever the PREVIOUS battle did, so a script would take the
   * victory branch of a fight that never happened.
   */
  battleCaught(): boolean {
    if (!this.lastBattleReal || !this.services.battleCaught) {
      return false;
    }
    return this.services.battleCaught();
  }

  battleWon(): boolean {
    return this.lastBattleReal && this.services.battleWon();
  }

  /** The Fuchsia zoo signs, and anything else that shows you a Pokemon. */
  /**
   * The last Pokemon Center: where a whiteout returns the player, healed. The
   * reference and the cartridge record the cell in front of the nurse.
   */
  setRespawnHere(): void {
    const cell = this.services.playerCell();
    this.state.respawnMapId = this.services.currentMap().id;
    this.state.respawnCellX = cell[0];
    this.state.respawnCellY = cell[1];
    // SetLastBlackoutMap: the last OUTDOOR map at the moment of the heal is
    // where a blackout, an ESCAPE ROPE, DIG and TELEPORT return to -- to its
    // fly spot, outdoors, not to the counter (engine/events/set_blackout_map.asm,
    // special_warps.asm's BIT_ESCAPE_WARP branch). Safari rest houses do not
    // count; that exception lands with the Safari Zone.
    const outdoors = this.services.lastOutdoorMap ? this.services.lastOutdoorMap() : "";
    if (outdoors) {
      this.state.respawnLastMapId = outdoors;
    }
  }

  beatTrainer(mapId: string, npc: string, flag: string): void {
    const onMap = mapId ? mapId : this.services.currentMap().id;
    markTrainerDefeated(this.state, onMap, npc, flag);
  }

  markSeen(species: string): void {
    const spec = this.bundle.species ? this.bundle.species[species] : null;
    if (spec) {
      markSeen(this.state, spec.dex);
    }
  }

  /**
   * DexEntryMenu: the Pokedex data page a starter ball (and any other
   * push_screen) opens before whatever asks about it. SUSPENDED, the way
   * nameEntry() suspends the intro's naming screen -- services.dexEntry()
   * owns showing and holding the page; this owns the state effect (marking
   * the species seen) and the one-line print, each exactly once per opening
   * rather than every frame it stays suspended.
   */
  pushScreen(screen: string, species: string, textId?: string): number {
    // A picture with its caption (PictureScreen.ts): `species` is the picture
    // key. With no picture in the bundle, or no screen to show one on, the
    // words are still said -- which is all the lens did before.
    if (screen === SCREEN_PICTURE) {
      const caption = textId ? textId : "";
      if (!this.services.picture || pictureFor(this.bundle, species) === null) {
        return caption ? this.showText(caption, "", -1) : DONE;
      }
      const body = caption ? this.bodyFor(caption) : null;
      return this.services.picture(species, body ? pagesOf(body, this.state, this.stringBuffer, -1) : []);
    }
    if (screen !== "DexEntryMenu") {
      print("[PlayHost] push_screen: no screen '" + screen + "'");
      return DONE;
    }
    const spec = this.bundle.species ? this.bundle.species[species] : null;
    if (!spec) {
      print("[PlayHost] DexEntryMenu: no species '" + species + "' in this bundle");
      return DONE;
    }
    if (this.dexEntrySpecies !== species) {
      this.dexEntrySpecies = species;
      markSeen(this.state, spec.dex);
      const owned = this.state.dexOwned[spec.dex - 1] === true ? "owned" : "seen";
      print("[PlayHost] DexEntryMenu: #" + spec.dex + " " + spec.name + " (" + owned + ")");
    }
    const result = this.services.dexEntry(species);
    if (result === DONE) {
      this.dexEntrySpecies = "";
    }
    return result;
  }

  /**
   * A Pokemon straight into the party, as Bill's gift and the fossils do.
   *
   * Silently dropped when the party is full, which is what the cartridge does:
   * the six-slot limit is checked by the script that offers it, not here.
   */
  /**
   * A Pokemon a script hands over: Bill's, the fossils', the dojo's prize.
   *
   * Party first, then the current PC box, then nowhere. The box path pages a
   * line, so this is two-phase like trade(): RUNNING until it has been read.
   * It used to refuse outright at six and print, which meant the dojo prize
   * and both fossils could be lost for good by walking in with a full party.
   */
  givePokemon(species: string, level: number): number {
    if (!species || !this.bundle.species || !this.bundle.species[species]) {
      print("[PlayHost] give_pokemon: no species '" + species + "'");
      this.landed = false;
      return DONE;
    }
    if (this.giveResult === null) {
      const mon = makeWildMon(this.bundle, species, level > 0 ? level : 5,
                              this.services.random);
      const spec = this.bundle.species[species];
      // Before receiveMon, so the box line below can name it: wStringBuffer is
      // what every "you got X" line reads back.
      this.stringBuffer = spec && spec.name ? spec.name : species;
      this.giveResult = receiveMon(this.bundle, this.state, mon);
    }
    const result = this.giveResult;
    if (result.where === RECEIVE_PARTY) {
      this.giveResult = null;
      this.landed = true;
      return DONE;
    }
    if (result.where === RECEIVE_BOX) {
      // The filled BODY, not the label: _SentToBoxText carries the nickname and
      // the box number in two different {RAM:} slots, and pagesOf puts one
      // value in every slot it finds.
      const raw = this.bundle.text && typeof this.bundle.text["_SentToBoxText"] === "string"
        ? this.bundle.text["_SentToBoxText"]
        : "{RAM:wBoxMonNicks} was\nsent to BOX {RAM:wStringBuffer}!";
      const body = fillSlots(raw, [["wBoxMonNicks", this.stringBuffer],
                                   ["wStringBuffer", "" + result.box]]);
      const shown = this.showText(body, "", -1);
      if (shown !== DONE) {
        return shown;
      }
      this.giveResult = null;
      this.landed = true;
      return DONE;
    }
    const refused = this.showText("_BoxIsFullText", "", -1);
    if (refused !== DONE) {
      return refused;
    }
    this.giveResult = null;
    this.landed = false;
    return DONE;
  }

  giveLanded(): boolean {
    return this.landed;
  }

  /**
   * A cartridge in-game trade, dialogue and all
   * (engine/events/in_game_trades.asm DoInGameTradeDialogue).
   *
   * Ten of these, one routine, five lines each chosen by the row's dialogset:
   * he asks, you answer, and only then does anything change hands. It used to
   * be one line of invented English and a silent swap -- walk into the Route 2
   * trade house with an ABRA in the party and it was gone before you had
   * agreed to anything.
   *
   * Two departures from the cartridge, both in the party menu it opens:
   *
   *   The mon is chosen for you. DisplayPartyMenu lets the player pick, and a
   *   pick of the wrong species gets WRONG_MON; here the first party member of
   *   the wanted species goes, and WRONG_MON is what an empty search says. The
   *   only case that differs is a player who deliberately offers the wrong one.
   *
   *   Cancelling the party menu prints NO_TRADE on the cartridge. There is
   *   nothing to cancel here; the yes/no before it is the only way out.
   *
   * The trade animation (InternalClockTradeAnim) is not drawn; the line that
   * introduces it, "Okay, connect the cable like so!", is.
   */
  trade(index: number, flag: string): number {
    if (!flag) {
      print("[PlayHost] trade: no completion flag");
      return DONE;
    }
    const trades: TradeDef[] = this.bundle.trades ? this.bundle.trades : [];
    const trade: TradeDef = index > 0 && index <= trades.length ? trades[index - 1] : null;
    if (trade === null) {
      print("[PlayHost] trade: no trade #" + index + " in this bundle");
      return DONE;
    }
    if (!this.bundle.species || !this.bundle.species[trade.get]) {
      print("[PlayHost] trade: no species '" + trade.get + "' in this bundle");
      return DONE;
    }
    const set = trade.dialogset >= 1 && trade.dialogset <= 3 ? trade.dialogset : 1;
    const give = this.monName(trade.give);
    const get = this.monName(trade.get);

    // Once it is done he has one line left, and says it every time.
    //
    // Only from a standing start: the swap itself sets the completion flag,
    // and without the step test this branch would hijack the conversation
    // that is still running -- the trade line half-read and the thanks never
    // said, because the next frame saw a finished trade.
    if (this.state.flags[flag] === true && this.tradeStep === TRADE_ASKING) {
      const after = this.showText(this.tradeText("_AfterTrade" + set + "Text", give, get), "", -1);
      if (after === DONE) {
        this.tradeStep = TRADE_ASKING;
      }
      return after;
    }

    if (this.tradeStep === TRADE_ASKING) {
      const asked = this.ask(this.tradeText("_WannaTrade" + set + "Text", give, get),
                            TRADE_ANSWER_FLAG, "", -1);
      if (asked !== DONE) {
        return RUNNING;
      }
      const yes = this.flagsOf()[TRADE_ANSWER_FLAG] === true;
      delete this.flagsOf()[TRADE_ANSWER_FLAG];
      this.tradeStep = !yes ? TRADE_REFUSED
        : this.partySlotOf(trade.give) >= 0 ? TRADE_CABLE : TRADE_WRONG_MON;
    }

    if (this.tradeStep === TRADE_REFUSED || this.tradeStep === TRADE_WRONG_MON) {
      const id = this.tradeStep === TRADE_REFUSED ? "_NoTrade" + set + "Text" : "_WrongMon" + set + "Text";
      const said = this.showText(this.tradeText(id, give, get), "", -1);
      if (said === DONE) {
        this.tradeStep = TRADE_ASKING;
      }
      return said;
    }

    if (this.tradeStep === TRADE_CABLE) {
      const cable = this.showText(this.tradeText("_ConnectCableText", give, get), "", -1);
      if (cable !== DONE) {
        return RUNNING;
      }
      this.doTrade(trade, flag);
      this.tradeStep = TRADE_TRADED;
    }

    if (this.tradeStep === TRADE_TRADED) {
      const traded = this.showText(this.tradeText("_TradedForText", give, get), "", -1);
      if (traded !== DONE) {
        return RUNNING;
      }
      this.tradeStep = TRADE_THANKS;
    }

    const thanks = this.showText(this.tradeText("_Thanks" + set + "Text", give, get), "", -1);
    if (thanks === DONE) {
      this.tradeStep = TRADE_ASKING;
    }
    return thanks;
  }

  /** The first party slot holding this species, or -1. */
  private partySlotOf(species: string): number {
    for (let i = 0; i < this.state.party.length; i++) {
      if (this.state.party[i].species === species) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Open a list and wait for it, the way openMart waits for the shop.
   *
   * Returns RUNNING while the list is up, and DONE once it is gone; the row
   * the player picked is in `this.chosenRow` (-1 for a cancel, and -1 too on
   * a harness with no screen at all).
   */
  /**
   * A board with a menu on it: the school's blackboard (17:$5CED) and the
   * roof house's link-cable board (17:$5C29). One page of introduction, then
   * a list whose last row is the way out, and each other row a page that
   * returns to the list -- `jr $5D15` and `jp $5C51` both loop back to the
   * menu, so a reader can take every topic in turn.
   */
  private wallBoard(intro: string, prompt: string, topics: string[], texts: string[]): number {
    if (this.boardStep === 0) {
      const said = this.showText(intro, "", -1);
      if (said !== DONE) {
        return said;
      }
      this.boardStep = 1;
    }
    if (this.boardStep === 1) {
      const asked = this.bundle.text ? this.bundle.text[prompt] : "";
      const listed = this.chooseRow(asked ? asked : "", topics, []);
      if (listed !== DONE) {
        return listed;
      }
      const row = this.chosenRow;
      if (row < 0 || row >= texts.length) {
        this.boardStep = 0;
        return DONE;
      }
      this.boardRow = row;
      this.boardStep = 2;
    }
    const page = this.showText(texts[this.boardRow], "", -1);
    if (page !== DONE) {
      return page;
    }
    this.boardStep = 1;
    return RUNNING;
  }

  private chooseRow(title: string, labels: string[], notes: string[]): number {
    if (this.choiceOpened) {
      if (this.services.choiceOpen && this.services.choiceOpen()) {
        return RUNNING;
      }
      this.choiceOpened = false;
      this.chosenRow = this.services.choicePicked ? this.services.choicePicked() : -1;
      return DONE;
    }
    if (!this.services.openChoice) {
      this.chosenRow = -1;
      return DONE;
    }
    this.services.openChoice(title, labels, notes);
    this.choiceOpened = true;
    return RUNNING;
  }

  /** The cartridge's own name for a species, for a line that prints one. */
  private monName(species: string): string {
    const spec = this.bundle.species ? this.bundle.species[species] : null;
    return spec && spec.name ? spec.name : species;
  }

  /**
   * A trade line with its two names filled in.
   *
   * These are the only lines in Red carrying TWO different {RAM:} slots --
   * wInGameTradeGiveMonName and wInGameTradeReceiveMonName -- and fillSlots
   * puts the one value it is given in every slot it finds. The words are
   * finished here and handed to showText as words; it takes anything the text
   * table does not know as a literal.
   */
  private tradeText(id: string, give: string, get: string): string {
    const body = this.bundle.text ? this.bundle.text[id] : null;
    if (!body) {
      print("[PlayHost] trade: no text " + id);
      return id;
    }
    return body.split("{RAM:wInGameTradeGiveMonName}").join(give)
      .split("{RAM:wInGameTradeReceiveMonName}").join(get);
  }

  /** The swap itself, once he has said to connect the cable. */
  private doTrade(trade: TradeDef, flag: string): void {
    const partyIndex = this.partySlotOf(trade.give);
    if (partyIndex < 0) {
      return;
    }
    const level = this.state.party[partyIndex].level;
    const received = makeWildMon(this.bundle, trade.get, level, this.services.random);
    received.name = trade.nickname ? trade.nickname : received.name;
    // A traded Pokemon belongs to somebody else, and the cartridge says so in
    // as many words: InGameTrade_CopyDataToReceivedMon writes the literal
    // "TRAINER" string into its OT name and a freshly Random-ed value into its
    // OT id (engine/events/in_game_trades.asm:198-202, :211-229). Without it
    // Storage.claimUnowned stamps the player on the way past -- it claims
    // anything whose OT name is empty -- and all ten npctrade Pokemon become
    // home-grown: no 1.5x experience, and nothing for a badge-ladder
    // obedience check to read.
    received.otName = TRADE_OT_NAME;
    received.otId = Math.floor(this.services.random() * 65536);
    this.state.party[partyIndex] = received;
    markOwned(this.state, this.bundle.species[trade.get].dex);
    this.state.flags[flag] = true;
  }

  moveNpc(npc: string, path: string[]): number {
    return this.services.moveNpc(npc, path);
  }

  warp(map: string, warp: number): void {
    this.services.warp(map, warp);
  }

  warpTo(map: string, x: number, y: number, facing: string): void {
    this.services.warpTo(map, x, y, facing);
  }

  playCry(species: string): void {
    this.services.playCry(species);
  }

  fade(direction: string, colour: string): number {
    return this.services.fade(direction, colour);
  }

  playOnce(track: string): number {
    return this.services.playOnce(track);
  }

  frames(): number {
    return this.services.frames();
  }

  // -- the bag ---------------------------------------------------------------

  giveItem(item: string, count: number): boolean {
    // A badge is not a bag item. `give BOULDERBADGE` is the only `give` in the
    // whole ported dataset and it is a badge, so routing it into the bag would
    // have shown a badge in the bag and none on the trainer card.
    const badge = badgeIndexOf(item);
    if (badge >= 0) {
      this.state.badges[badge] = true;
      return true;
    }
    const landed = giveItem(this.state, item, count > 0 ? count : 1);
    if (landed) {
      this.stringBuffer = this.itemName(item);
    }
    return landed;
  }

  takeItem(item: string, count: number): void {
    takeItem(this.state, item, count);
  }

  hasInParty(species: string): boolean {
    return this.partySlotOf(species) >= 0;
  }

  hasItem(item: string, count: number): boolean {
    const badge = badgeIndexOf(item);
    if (badge >= 0) {
      return this.state.badges[badge] === true;
    }
    return hasItem(this.state, item, count);
  }

  /** A comparison, not a debit: take_money remains a separate cartridge op. */
  hasMoney(amount: number): boolean {
    return typeof amount === "number" && amount >= 0 && this.state.money >= amount;
  }

  // -- coins -----------------------------------------------------------------
  //
  // The Game Corner's currency. A separate counter, capped at 9999 like the
  // cartridge's three BCD bytes, and the givers refuse at 9990 because that is
  // where `coinCaseFull` sits in the reference, not at the cap.

  hasCoins(amount: number): boolean {
    return typeof amount === "number" && amount >= 0 && this.state.coins >= amount;
  }

  giveCoins(amount: number): void {
    if (typeof amount !== "number" || amount <= 0) {
      return;
    }
    this.state.coins = Math.min(MAX_COINS, this.state.coins + amount);
  }

  takeCoins(amount: number): void {
    if (typeof amount !== "number" || amount <= 0) {
      return;
    }
    this.state.coins = Math.max(0, this.state.coins - amount);
  }

  dexOwnedCount(): number {
    return dexOwnedCount(this.state);
  }

  playerFacing(): string {
    return this.services.playerFacing();
  }

  randomByte(): number {
    return randomByteOf(this.services.random);
  }

  /**
   * The display name for a {RAM:} slot, from the cartridge's own item table.
   *
   * The generated ports name items by ID so that nothing derived from the ROM
   * is written into the repository; the name is looked up here, at runtime,
   * in the player's own bundle. Unknown ids fall back to the id, which is
   * wrong on screen but says exactly which id was wrong.
   */
  itemName(item: string): string {
    const def = this.bundle.items ? this.bundle.items[item] : null;
    return def && def.name ? def.name : item;
  }

  /**
   * Resolve a mart by the clerk's own TEXT_* id.
   *
   * The inventory is not in field. It is extraction metadata under
   * text_pointers[map.label][clerkTextId].mart and survives in the bundle as
   * textPointers. There is no shop menu renderer yet, so preserve the exact
   * stock/price join and report the handoff rather than inventing a catalogue.
   */
  openMart(clerkTextId: string): number {
    if (this.shopOpened) {
      if (this.services.shopOpen()) {
        return RUNNING;
      }
      this.shopOpened = false;
      return DONE;
    }
    const map = this.services.currentMap();
    const byMap = map && this.bundle.textPointers
      ? this.bundle.textPointers[map.label] : null;
    const pointer = byMap ? byMap[clerkTextId] : null;
    const stock: string[] = pointer && Array.isArray(pointer.mart)
      ? pointer.mart : null;
    if (stock === null) {
      print("[PlayHost] open_mart: no stock for " + clerkTextId +
            " on " + (map ? map.id : "unknown map"));
      return DONE;
    }

    const listing: string[] = [];
    for (let i = 0; i < stock.length; i++) {
      const item = this.bundle.items ? this.bundle.items[stock[i]] : null;
      if (!item || typeof item.price !== "number") {
        print("[PlayHost] open_mart " + clerkTextId +
              ": no item/price for '" + stock[i] + "'");
        return DONE;
      }
      listing.push(item.name + " ¥" + item.price);
    }
    print("[PlayHost] open_mart " + clerkTextId + ": " + listing.join(", "));
    // The screen is the lens's; the script waits here until the player leaves.
    // It used to print the listing above and carry on, which is a mart nobody
    // can buy anything in.
    this.services.openShop(stock);
    this.shopOpened = true;
    return RUNNING;
  }

  /**
   * The PC screen. There is nothing to look up first -- which terminal it is
   * came from the tile -- so this is openMart without the catalogue: hand the
   * screen over, then wait.
   */
  openPc(kind: string): number {
    if (this.pcOpened) {
      if (this.services.pcOpen()) {
        return RUNNING;
      }
      this.pcOpened = false;
      return DONE;
    }
    this.services.openPc(kind);
    this.pcOpened = true;
    return RUNNING;
  }

  /**
   * A slot machine. openPc's shape exactly: hand the screen over, then wait.
   *
   * A lens whose host has no slot screen says so and moves on rather than
   * hanging the script on a service that will never close.
   */
  openSlots(chance: number): number {
    if (this.slotsOpened) {
      if (this.services.slotsOpen && this.services.slotsOpen()) {
        return RUNNING;
      }
      this.slotsOpened = false;
      return DONE;
    }
    if (!this.services.openSlots) {
      print("[PlayHost] open_slots: this host has no slot machine");
      return DONE;
    }
    this.services.openSlots(chance);
    this.slotsOpened = true;
    return RUNNING;
  }

  healParty(): void {
    for (let i = 0; i < this.state.party.length; i++) {
      const mon = this.state.party[i];
      mon.hp = mon.maxHp;
      mon.status = "";
      mon.sleepTurns = 0;
      // A benched Pokemon has no volatile counters: Toxic's climb went home
      // with the status it belonged to.
      mon.volatile = newVolatileState();
      for (let m = 0; m < mon.moves.length; m++) {
        mon.moves[m].pp = mon.moves[m].maxPp;
      }
    }
  }

  // -- battles ---------------------------------------------------------------

  startTrainerBattle(trainer: string, party: number): number {
    return this.runBattle(trainer, party > 0 ? party : 1);
  }

  /**
   * Mewtwo, the birds, Snorlax: one Pokemon written into the script.
   *
   * Refused rather than thrown when the party cannot fight, exactly as a
   * trainer battle is -- startWildBattle throws on an empty or wiped party, and
   * a legendary is the last place to discover that.
   */
  startStaticBattle(species: string, level: number, flag: string): number {
    if (!this.battleStarted) {
      if (!canFight(this.state)) {
        print("[PlayHost] refusing " + species + ": nothing can fight");
        this.lastBattleReal = false;
        return DONE;
      }
      if (!species || !this.bundle.species || !this.bundle.species[species]) {
        print("[PlayHost] static_battle: no species '" + species + "'");
        this.lastBattleReal = false;
        return DONE;
      }
      this.services.beginStaticBattle(species, level > 0 ? level : 5);
      this.battleStarted = true;
      this.lastBattleReal = true;
      return SUSPENDED;
    }
    if (!this.services.battleOver()) {
      return SUSPENDED;
    }
    this.battleStarted = false;
    // Only a battle that HAPPENED and was WON marks the legendary beaten. Both
    // refusals above return before here, so a refused battle cannot set it --
    // which matters, because a legendary you did not beat is still standing
    // there and that is the whole reason you can go back.
    if (flag && this.services.battleWon()) {
      this.state.flags[flag] = true;
    }
    return DONE;
  }

  private demoStarted: boolean = false;

  /**
   * `old_man_demo`: ViridianCityOldManStartCatchTrainingScript. The lens plays
   * the WEEDLE demonstration and the script waits for it, as it waits for any
   * battle; a services table with no stage for it answers DONE at once.
   */
  oldManDemo(): number {
    return this.demoBattle("WEEDLE", 5, "OLD MAN", true);
  }

  /**
   * `old_man_demo_fail`: Yellow's ViridianCityOldManInitialCatchTrainingScript.
   * A RATTATA at level 5, and the ball breaks open on the third shake --
   * EVENT_INITIAL_CATCH_TRAINING turns ItemUseBall's animation into $63.
   */
  oldManDemoFail(): number {
    return this.demoBattle("RATTATA", 5, "OLD MAN", false);
  }

  /**
   * `oak_demo`: Yellow's PalletTownPikachuBattleScript. BATTLE_TYPE_PIKACHU is
   * the old man's demonstration with PROF.OAK throwing at a level-5 PIKACHU,
   * which he always catches; that Pikachu is the one he hands over in the lab.
   */
  oakDemo(): number {
    return this.demoBattle("PIKACHU", 5, "PROF.OAK", true);
  }

  private demoBattle(species: string, level: number, thrower: string, catches: boolean): number {
    if (!this.demoStarted) {
      if (!this.services.beginDemoBattle) {
        return DONE;
      }
      this.services.beginDemoBattle(species, level, thrower, catches);
      this.demoStarted = true;
      return SUSPENDED;
    }
    if (!this.services.battleOver()) {
      return SUSPENDED;
    }
    this.demoStarted = false;
    return DONE;
  }

  /** Money out. Clamped at zero: the cartridge does not lend. */
  takeMoney(amount: number): void {
    const owed = amount > 0 ? amount : 0;
    this.state.money = this.state.money > owed ? this.state.money - owed : 0;
  }

  /** Shared by start_battle and the rival routine. SUSPENDED until it is over. */
  private runBattle(trainerId: string, partyIndex: number): number {
    if (!this.battleStarted) {
      if (!canFight(this.state)) {
        // Nothing to send out. Refusing beats throwing inside the battle
        // constructor, which is what happens if this is not checked.
        print("[PlayHost] refusing " + trainerId + ": nothing can fight");
        // A battle that did not happen has no result. Leaving the last one
        // standing means the very next `check_battle_result` reports a win the
        // player never had -- and Brock's script reads exactly that, one
        // command after start_battle.
        this.lastBattleReal = false;
        return DONE;
      }
      this.services.beginTrainerBattle(trainerId, partyIndex);
      this.battleStarted = true;
      this.lastBattleReal = true;
      return SUSPENDED;
    }
    if (!this.services.battleOver()) {
      return SUSPENDED;
    }
    this.battleStarted = false;
    if (this.services.battleWon()) {
      this.awardVictory(trainerId, partyIndex);
    }
    return DONE;
  }

  /**
   * The badge, the flags, the retired trainers and the hidden NPCs.
   *
   * Applied HERE, on the win, rather than in the conversation that started the
   * battle. The first cut gave Brock's badge inline in his talk script, which
   * works for one gym and generalises to none: the flags a victory retires
   * belong to the gym's other trainers, and the NPCs it hides are on other maps.
   *
   * The TM is deliberately NOT given here. It goes through give_tm, which can
   * fail on a full bag and must leave gotFlag clear so the leader offers it
   * again -- that retry is the whole reason the routine exists.
   */
  private awardVictory(trainerId: string, partyIndex: number): void {
    const win: Victory = victoryFor(trainerId, partyIndex);
    if (win === null) {
      return;
    }
    if (win.flag) {
      this.state.flags[win.flag] = true;
    }
    if (win.badge) {
      const badge = badgeIndexOf(win.badge);
      if (badge >= 0) {
        this.state.badges[badge] = true;
      }
    }
    for (let i = 0; i < win.deactivate.length; i++) {
      this.state.flags[win.deactivate[i]] = true;
    }
    // ResetEvents. Brock's victory closes the first Route 22 rival window;
    // until this existed the table could only ever write true, so the two
    // flags stayed set for the rest of the game.
    for (let i = 0; i < win.clear.length; i++) {
      this.state.flags[win.clear[i]] = false;
    }
    for (let i = 0; i < win.hide.length; i++) {
      this.services.setNpcRevealed(win.hide[i][0], win.hide[i][1], false);
    }
  }

  /** The reward owed for a battle, so a script can ask what to hand over. */
  victory(trainerId: string, partyIndex: number): Victory {
    return victoryFor(trainerId, partyIndex);
  }

  // -- routines --------------------------------------------------------------

  /**
   * The parts that are control flow rather than a sequence.
   *
   * MapScripts.requiredRoutines() is the contract, and script.test.mjs checks the
   * data and that list against each other in both directions. This switch must
   * cover every name on it: an unknown routine returning DONE is exactly the
   * silent hole that contract exists to prevent, so it says so instead.
   */
  call(routine: string, argument: string): number {
    // The four people who open a list (Keepers.ts): the Badge House man,
    // Bill's PC, the NAME RATER and the DAYCARE gentleman.
    if (this.keepers().handles(routine)) {
      return this.keepers().call(routine);
    }
    if (routine === "give_starter") {
      return this.giveStarter(argument);
    }
    if (routine === "rival_first_battle") {
      return this.rivalFirstBattle(argument);
    }
    if (routine === "rival_approach") {
      return this.rivalApproach(argument);
    }
    if (routine === "rival_battle") {
      return this.rivalBattle(argument);
    }
    if (routine === "rival_beside") {
      return this.rivalBeside(argument);
    }
    if (routine === "rival_face_player") {
      this.rivalFacePlayer(argument);
      return DONE;
    }
    if (routine === "give_tm") {
      return this.giveTm(argument);
    }
    if (routine === "old_man_demo") {
      return this.oldManDemo();
    }
    if (routine === "oak_demo") {
      return this.oakDemo();
    }
    if (routine === "old_man_demo_fail") {
      return this.oldManDemoFail();
    }
    if (routine === "rival_starter") {
      // `rival_starter 1|2|3`: Yellow's wRivalStarter, written by the lab.
      const value = parseInt(argument, 10);
      this.state.rivalStarter = value >= 1 && value <= 3 ? value : 0;
      return DONE;
    }
    if (routine === "intro_stage") {
      this.services.introStage(argument);
      return DONE;
    }
    if (routine === "name_entry") {
      return this.services.nameEntry(argument);
    }
    if (routine === ROUTINE_CUT) {
      // The script only reaches this after cutTargetAhead() passed, so a false
      // here is a wiring fault rather than a player mistake.
      if (!this.services.cutTreeAhead()) {
        print("[PlayHost] cut_tree found nothing to cut");
      }
      return DONE;
    }
    if (routine === ROUTINE_SURF) {
      this.services.startSurf();
      return DONE;
    }
    if (routine === ROUTINE_STRENGTH) {
      this.services.activateStrength();
      return DONE;
    }
    // The ship leaves between the dock script's two horns (MapScripts.ts
    // VERMILION_DOCK): one block column further out every SHIP_SLIDE_FRAMES,
    // the water closing behind her, and the berth stamped for good after the
    // last of her has gone. Paced by the same frame count `wait` uses.
    if (routine === "sail_ship") {
      return this.sailShip();
    }
    // A prize counter (Prizes.ts): three prizes, their prices in coins, and
    // NO THANKS. The argument is which counter, 1 to 3.
    if (routine === "prize_counter") {
      return this.prizeCounter(argument);
    }
    // The SAFARI ZONE's desk and door (Safari.ts). The balls and the clock are
    // their own counters in the save, as wNumSafariBalls and wSafariSteps are
    // their own bytes in WRAM.
    if (routine === "safari_start") {
      this.state.safariBalls = SAFARI_BALLS;
      this.state.safariSteps = SAFARI_STEPS;
      this.state.flags[EVENT_IN_SAFARI] = true;
      this.state.flags[EVENT_SAFARI_OVER] = false;
      return DONE;
    }
    if (routine === "safari_end") {
      this.state.safariBalls = 0;
      this.state.safariSteps = 0;
      this.state.flags[EVENT_IN_SAFARI] = false;
      this.state.flags[EVENT_SAFARI_OVER] = false;
      return DONE;
    }
    // A vending machine on the roof of the CELADON MART: the four-row list
    // the cartridge draws (engine/events/vending_machine.asm), not the chain
    // of yes/no boxes that stood in for it while there was no list screen.
    if (routine === "vending_machine") {
      return this.vendingMachine();
    }
    if (routine === ROUTINE_BLACKBOARD) {
      return this.wallBoard(TEXT_BLACKBOARD_1, TEXT_BLACKBOARD_2, BLACKBOARD_TOPICS, BLACKBOARD_TEXTS);
    }
    if (routine === ROUTINE_LINK_BOARD) {
      return this.wallBoard(TEXT_LINK_1, TEXT_LINK_2, LINK_TOPICS, LINK_TEXTS);
    }
    if (routine === "credits") {
      if (this.services.rollCredits) {
        this.services.rollCredits();
      }
      return DONE;
    }
    // The lift's panel (Elevators.ts): the floors, and where each lets you out.
    if (routine === "elevator") {
      return this.elevator();
    }
    if (routine === ROUTINE_FLY) {
      // LeaveMapAnim .flyAnimation: SFX_FLY as the bird takes the player up.
      // The landing plays it again on the cartridge; the lens lands in the
      // same frame, so once is what can be heard.
      this.services.textSound(SFX_FLY);
      this.services.flyTo(argument);
      return DONE;
    }
    if (routine === ROUTINE_FLASH) {
      this.services.lightArea();
      return DONE;
    }
    print("[PlayHost] no routine named '" + routine + "'; the script expected one");
    return DONE;
  }

  private keeperSet: Keepers = null;

  /** Built on first use: the port closes over this host's own methods. */
  private keepers(): Keepers {
    if (this.keeperSet === null) {
      const self = this;
      const port: KeeperPort = {
        state: () => self.state,
        bundle: () => self.bundle,
        say: (text: string, ram: string, num: number) => self.showText(text, ram, num),
        askYesNo: (text: string, flag: string, ram: string, num: number) => self.ask(text, flag, ram, num),
        answered: (flag: string) => {
          const yes = self.flagsOf()[flag] === true;
          delete self.flagsOf()[flag];
          return yes;
        },
        list: (title: string, labels: string[], notes: string[]) => self.chooseRow(title, labels, notes),
        pickedRow: () => self.chosenRow,
        dexPage: (species: string) => self.pushScreen("DexEntryMenu", species),
        nickname: (partyIndex: number) => self.services.nameEntry("party:" + partyIndex),
        cry: (species: string) => self.services.playCry(species),
        sound: (name: string) => self.services.textSound(name),
      };
      this.keeperSet = new Keepers(port);
    }
    return this.keeperSet;
  }

  /** Where a vending machine's sale has got to. */
  private drinkStep: number = 0;
  private drinkRow: number = -1;
  /** The line it is in the middle of saying, when drinkStep is DRINK_SAYING. */
  private drinkLine: string = "";

  /**
   * One use of a vending machine.
   *
   * "Oh! A vending machine!", the list, and then the sale: the drink first,
   * the money after, and the bag's own refusal in between -- which is the
   * cartridge's order and the reason a full bag costs nothing.
   *
   * Every ending goes through DRINK_SAYING rather than printing and resetting
   * in one breath. showText runs over several frames and `call` is re-entered
   * on each of them, so a step reset before the last page was read reopened
   * the list instead of closing the machine.
   */
  private vendingMachine(): number {
    if (this.drinkStep === DRINK_GREETING) {
      const greeting = this.showText(TEXT_VENDING_GREETING, "", -1);
      if (greeting !== DONE) {
        return greeting;
      }
      this.drinkStep = DRINK_LISTING;
    }

    if (this.drinkStep === DRINK_LISTING) {
      const labels: string[] = [];
      const notes: string[] = [];
      for (let i = 0; i < VENDING_DRINKS.length; i++) {
        labels.push(VENDING_DRINKS[i].label);
        notes.push("¥" + VENDING_DRINKS[i].price);
      }
      labels.push(VENDING_CANCEL);
      notes.push("");
      const asked = this.bundle.text ? this.bundle.text[TEXT_VENDING_GREETING] : "";
      const listed = this.chooseRow(asked ? asked : "", labels, notes);
      if (listed !== DONE) {
        return listed;
      }
      this.drinkRow = this.chosenRow;
      if (this.drinkRow < 0 || this.drinkRow >= VENDING_DRINKS.length) {
        return this.endVending(TEXT_VENDING_CANCELLED, "");
      }
      this.drinkStep = DRINK_PAYING;
    }

    if (this.drinkStep === DRINK_PAYING) {
      const drink = VENDING_DRINKS[this.drinkRow];
      if (this.state.money < drink.price) {
        return this.endVending(TEXT_VENDING_TOO_POOR, "");
      }
      if (!this.giveItem(drink.item, 1)) {
        return this.endVending(TEXT_VENDING_NO_ROOM, "");
      }
      this.state.money = this.state.money - drink.price;
      this.services.textSound(VENDING_CLUNK);
      return this.endVending(TEXT_VENDING_BOUGHT, this.itemName(drink.item));
    }

    return this.sayingVending();
  }

  /** Start the last line of a visit, and say the first frame of it. */
  private endVending(textId: string, name: string): number {
    this.drinkStep = DRINK_SAYING;
    this.drinkLine = textId;
    this.drinkItem = name;
    return this.sayingVending();
  }

  private drinkItem: string = "";

  /** One frame of that last line; DONE closes the machine. */
  private sayingVending(): number {
    const said = this.showText(this.drinkLine, this.drinkItem, -1);
    if (said !== DONE) {
      return said;
    }
    this.drinkStep = DRINK_GREETING;
    this.drinkRow = -1;
    this.drinkLine = "";
    this.drinkItem = "";
    return DONE;
  }

  /**
   * One use of a lift panel.
   *
   * The list is the cartridge's own floor list, and picking one rewrites both
   * of the car's warps so that stepping out of it arrives on that floor --
   * which is the whole of how a lift travels in Red. Backing out changes
   * nothing, so the car still leads back where the player boarded.
   */
  private elevator(): number {
    const mapId = this.services.currentMap().id;
    const lift = elevatorFor(mapId);
    if (lift === null) {
      print("[PlayHost] elevator: " + mapId + " is not one");
      return DONE;
    }
    const labels: string[] = [];
    for (let i = 0; i < lift.floors.length; i++) {
      labels.push(lift.floors[i].label);
    }
    // The words, not the label: the list is not a message box and nothing
    // resolves a text id for it.
    const asked = this.bundle.text ? this.bundle.text[TEXT_WHICH_FLOOR] : "";
    const listed = this.chooseRow(asked ? asked : "Which floor?", labels, []);
    if (listed !== DONE) {
      return listed;
    }
    const row = this.chosenRow;
    if (row < 0 || row >= lift.floors.length) {
      return DONE;
    }
    const floor = lift.floors[row];
    if (this.services.overrideWarp) {
      for (let i = 0; i < lift.doors.length; i++) {
        this.services.overrideWarp(lift.doors[i][0], lift.doors[i][1], floor.map, floor.warp);
      }
    }
    // ShakeElevator, straight after the warps are written and before the
    // doors open: the car does not move, so the jolt is the only thing that
    // says you travelled.
    if (this.services.shakeWorld) {
      this.services.shakeWorld(ELEVATOR_SHAKE_SECONDS);
    }
    return DONE;
  }

  /**
   * The S.S. Anne sliding out to sea, a column at a time.
   *
   * RUNNING between columns and DONE after the berth is water. A host with no
   * world (the harness) still walks the same frames, so the horns and the
   * music around it keep their order whether or not anyone drew the ship.
   */
  private sailShip(): number {
    const now = this.services.frames();
    if (this.sailNextFrame < 0) {
      this.sailStep = 0;
      this.sailNextFrame = now;
    }
    if (now < this.sailNextFrame) {
      return RUNNING;
    }
    if (this.sailStep < SHIP_SLIDE_STEPS) {
      this.sailStep++;
      if (this.services.shipMoved) {
        this.services.shipMoved(this.sailStep);
      }
      this.sailNextFrame = now + SHIP_SLIDE_FRAMES;
      return RUNNING;
    }
    if (this.services.shipSailed) {
      this.services.shipSailed();
    }
    this.sailStep = 0;
    this.sailNextFrame = -1;
    return DONE;
  }

  /**
   * One visit to a prize counter (engine/events/prize_menu.asm:1-43 and
   * HandlePrizeChoice).
   *
   * Phased like the trade, because every step of it is a page or a screen:
   * the list, the confirmation, and then the coins. Coins are taken LAST and
   * a prize that fits nowhere is not paid for, both of which are the
   * cartridge's order.
   */
  private prizeCounter(which: string): number {
    const counter = parseInt(which, 10);
    const prizes = prizesForCounter(counter);
    if (prizes === null) {
      print("[PlayHost] prize_counter: no counter " + which);
      return DONE;
    }
    if (this.prizeStep === PRIZE_ASKING) {
      if (!hasItem(this.state, PRIZE_COIN_CASE, 1)) {
        const said = this.showText(TEXT_NEED_COIN_CASE, "", -1);
        return said;
      }
      const greeting = this.showText(TEXT_EXCHANGE, "", -1);
      if (greeting !== DONE) {
        return greeting;
      }
      this.prizeStep = PRIZE_LISTING;
    }

    if (this.prizeStep === PRIZE_LISTING) {
      const labels: string[] = [];
      const notes: string[] = [];
      for (let i = 0; i < prizes.length; i++) {
        labels.push(this.prizeName(prizes[i]));
        notes.push("" + prizes[i].price);
      }
      labels.push(NO_THANKS);
      notes.push("");
      const asked = this.bundle.text ? this.bundle.text[TEXT_WHICH_PRIZE] : "";
      const listed = this.chooseRow(asked ? asked : "Which prize?", labels, notes);
      if (listed !== DONE) {
        return listed;
      }
      this.prizeRow = this.chosenRow;
      if (this.prizeRow < 0 || this.prizeRow >= prizes.length) {
        this.prizeStep = PRIZE_ASKING;
        return DONE;
      }
      this.prizeStep = PRIZE_CONFIRMING;
    }

    const prize = prizes[this.prizeRow];
    if (this.prizeStep === PRIZE_CONFIRMING) {
      const asked = this.ask(TEXT_SO_YOU_WANT, PRIZE_ANSWER_FLAG, this.prizeName(prize), -1);
      if (asked !== DONE) {
        return RUNNING;
      }
      const yes = this.flagsOf()[PRIZE_ANSWER_FLAG] === true;
      delete this.flagsOf()[PRIZE_ANSWER_FLAG];
      if (!yes) {
        this.prizeStep = PRIZE_REFUSED;
      } else if (this.state.coins < prize.price) {
        this.prizeStep = PRIZE_TOO_POOR;
      } else {
        this.prizeStep = PRIZE_PAYING;
      }
    }

    if (this.prizeStep === PRIZE_REFUSED || this.prizeStep === PRIZE_TOO_POOR) {
      const id = this.prizeStep === PRIZE_REFUSED ? TEXT_OH_FINE_THEN : TEXT_NEED_MORE_COINS;
      const said = this.showText(id, "", -1);
      if (said === DONE) {
        this.prizeStep = PRIZE_ASKING;
      }
      return said;
    }

    // PRIZE_PAYING: a TM goes into the bag, a Pokemon into the party or a box,
    // and neither is paid for until it has landed.
    if (prize.isItem) {
      if (!giveItem(this.state, prize.id, 1)) {
        const full = this.showText(TEXT_NO_ROOM, "", -1);
        if (full === DONE) {
          this.prizeStep = PRIZE_ASKING;
        }
        return full;
      }
      this.state.coins = this.state.coins - prize.price;
      this.prizeStep = PRIZE_ASKING;
      return DONE;
    }
    const given = this.givePokemon(prize.id, prize.level);
    if (given === RUNNING || given === SUSPENDED) {
      return given;
    }
    if (this.giveLanded()) {
      this.state.coins = this.state.coins - prize.price;
    }
    this.prizeStep = PRIZE_ASKING;
    return DONE;
  }

  /** What a prize is called on the list: a TM's own name, or the species'. */
  private prizeName(prize: Prize): string {
    if (prize.isItem) {
      return this.itemName(prize.id);
    }
    return this.monName(prize.id);
  }

  /** The starter, and the flags that turn the rest of Oak's lab on. */
  private giveStarter(species: string): number {
    if (this.state.flags.EVENT_GOT_STARTER === true) {
      return DONE;
    }
    // makeWildMon THROWS on a species the bundle does not have, and a throw here
    // takes the whole lens down over a typo in a data file. Refusing is the
    // behaviour a ported script deserves: loud, and survivable.
    if (!species || !this.bundle.species || !this.bundle.species[species]) {
      print("[PlayHost] give_starter: no species '" + species + "' in this bundle");
      return DONE;
    }
    const mon = makeWildMon(this.bundle, species, STARTER_LEVEL, this.services.random);
    this.state.party.push(mon);
    const spec = this.bundle.species[species];
    if (spec) {
      markOwned(this.state, spec.dex);
    }
    this.state.flags.EVENT_GOT_STARTER = true;
    // Which ball was opened decides which Pokemon the rival takes, and therefore
    // which of OPP_RIVAL1's three rosters is fought. Recording it here is what
    // makes that a lookup later instead of a guess.
    this.state.flags["STARTER_" + species] = true;
    return DONE;
  }

  /**
   * The rival walks to stand beside the player, before he challenges you for
   * the first time in Oak's lab.
   *
   * Measured on the cartridge (tools/oracle, 6 sep): stopped at the lab's
   * row 6, BLUE says the whole of his challenge line UNMOVING -- still
   * standing where he took his own Pokemon -- and only once that closes
   * does he walk over, arriving at the cell directly above wherever the
   * player is standing (the trigger fires on any column, so the target is
   * read fresh here rather than baked into the script). `moveNpcTo`'s own
   * pathTo -- horizontal first, then vertical -- reproduced the measured
   * three-step walk exactly, so this is a thin wrapper rather than a new
   * pathing rule: DONE once the rival has arrived, RUNNING while walking,
   * called again next frame with the same argument like every other command.
   */
  private rivalApproach(npc: string): number {
    const cell = this.services.playerCell();
    return this.services.moveNpcTo(npc ? npc : "OAKSLAB_RIVAL", cell[0], cell[1] - 1);
  }

  /**
   * The rival's first battle: he takes the type yours is weak to.
   *
   * Roster order in the cartridge's OPP_RIVAL1 follows the ball the player did
   * NOT open, so the index is derived from the starter rather than stored.
   */
  private rivalFirstBattle(trainerId: string): number {
    // Yellow's OPP_RIVAL1 has one lab party, the Eevee; Red's has three.
    const roster = this.yellow() ? 1 : rivalRosterFor(this.state);
    const result = this.runBattle(trainerId ? trainerId : "OPP_RIVAL1", roster);
    if (result === DONE) {
      this.state.flags.EVENT_BATTLED_RIVAL_IN_OAKS_LAB = true;
      if (this.yellow()) {
        // OaksLabRivalEndBattleScript: his Eevee's future is decided here,
        // FLAREON if the player won and VAPOREON otherwise.
        this.state.rivalStarter = this.services.battleWon() ? 2 : 3;
      }
    }
    return result;
  }

  private yellow(): boolean {
    return cartridgeVersion(this.bundle.romSha1) === "yellow";
  }

  /**
   * `rival_battle OPP_RIVAL1#4`: the rival with the roster the starter decides,
   * counted from a base -- Route 22 is rosters 4, 5 and 6 by BULBASAUR,
   * CHARMANDER, SQUIRTLE, the same order as the lab. Sets no flag: the script
   * does, after check_battle_result, so a loss leaves the ambush armed.
   */
  private rivalBattle(argument: string): number {
    const hash = argument ? argument.indexOf("#") : -1;
    const cls = hash > 0 ? argument.substring(0, hash) : "";
    const base = hash > 0 ? parseInt(argument.substring(hash + 1), 10) : 0;
    if (cls === "" || !(base > 0)) {
      print("[PlayHost] rival_battle needs CLASS#base, got '" + argument + "'");
      this.lastBattleReal = false;
      return DONE;
    }
    if (this.yellow()) {
      return this.yellowRivalBattle(cls, base);
    }
    return this.runBattle(cls, base + rivalRosterFor(this.state) - 1);
  }

  /**
   * Yellow's rival parties, keyed by the Red call site so the shared story
   * scripts carry no version branch. pokeyellow's rosters run: RIVAL1 = lab,
   * Route 22, Cerulean; RIVAL2 = S.S. Anne, then three triplets (Tower, Silph,
   * Route 22 again) by his Eevee's evolution; RIVAL3 = the Champion, one per
   * evolution. wRivalStarter picks inside a triplet: 1 JOLTEON, 2 FLAREON,
   * 3 VAPOREON. Route 22's first win turns FLAREON back to JOLTEON
   * (Route22Rival1AfterBattleScript).
   */
  private yellowRivalBattle(cls: string, base: number): number {
    const starter = this.state.rivalStarter >= 1 ? this.state.rivalStarter : 1;
    let party = 0;
    let upgradeOnWin = false;
    if (cls === "OPP_RIVAL1" && base === 4) { party = 2; upgradeOnWin = true; }
    else if (cls === "OPP_RIVAL1" && base === 7) { party = 3; }
    else if (cls === "OPP_RIVAL2" && base === 1) { party = 1; }
    else if (cls === "OPP_RIVAL2" && base === 4) { party = 1 + starter; }
    else if (cls === "OPP_RIVAL2" && base === 7) { party = 4 + starter; }
    else if (cls === "OPP_RIVAL2" && base === 10) { party = 7 + starter; }
    else if (cls === "OPP_RIVAL3" && base === 1) { party = starter; }
    if (party === 0) {
      print("[PlayHost] no Yellow rival party for " + cls + "#" + base + ", taking Red's rule");
      return this.runBattle(cls, base + rivalRosterFor(this.state) - 1);
    }
    const result = this.runBattle(cls, party);
    if (result === DONE && upgradeOnWin && this.services.battleWon() && this.state.rivalStarter === 2) {
      this.state.rivalStarter = 1;
    }
    return result;
  }

  /** The cell rival_beside sent the rival to, for rival_face_player. */
  private rivalCell: number[] = null;

  /**
   * `rival_beside <NPC>`: the rival walks from wherever he is -- the lab door,
   * once place_npc has put him there -- to the cell beside the player, for
   * Oak's request.
   *
   * The cartridge's OaksLabCalcRivalMovementScript picks that cell from the
   * player's column; the rule here is the same shape read off the room. The
   * cell to the player's left, except when the player is already up on Oak's
   * row talking to him from the side, where "left" would be Oak's own cell or
   * the ball table: then the cell below-left. Every cell that rule can name in
   * the lab is open floor. DONE once he has arrived, RUNNING while walking.
   */
  private rivalBeside(npc: string): number {
    const cell = this.services.playerCell();
    const x = cell[0] - 1;
    const y = cell[1] === OAKS_DESK_ROW ? cell[1] + 1 : cell[1];
    this.rivalCell = [x, y];
    return this.services.moveNpcTo(npc ? npc : "OAKSLAB_RIVAL", x, y);
  }

  /**
   * `rival_face_player <NPC>`: turns the rival toward the player from the cell
   * rival_beside left him on. The cartridge's script faces him right, which is
   * only correct for a player standing where the script assumes; deriving the
   * direction keeps the two looking at each other from either side.
   */
  private rivalFacePlayer(npc: string): void {
    const cell = this.services.playerCell();
    const from = this.rivalCell ? this.rivalCell : [cell[0] - 1, cell[1]];
    const dx = cell[0] - from[0];
    const dy = cell[1] - from[1];
    const direction = Math.abs(dx) >= Math.abs(dy)
      ? (dx >= 0 ? "right" : "left")
      : (dy >= 0 ? "down" : "up");
    this.services.faceNpc(npc ? npc : "OAKSLAB_RIVAL", direction);
  }

  /**
   * A TM handed over only if there is room, and still owed if there is not.
   *
   * This is the reason `call` exists at all. The bag holds twenty distinct items
   * and refuses the twenty-first, so the handover can fail, and a failed handover
   * must leave the flag clear so the next conversation offers it again.
   */
  private giveTm(victoryKey: string): number {
    const hash = victoryKey.indexOf("#");
    const trainerId = hash < 0 ? victoryKey : victoryKey.substring(0, hash);
    const partyIndex = hash < 0 ? 1 : parseInt(victoryKey.substring(hash + 1), 10);
    const win: Victory = victoryFor(trainerId, partyIndex);
    if (win === null || !win.item) {
      print("[PlayHost] give_tm: no victory reward for " + victoryKey);
      return DONE;
    }
    if (this.state.flags[win.gotFlag] === true) {
      return DONE;
    }
    // A save from before this table already holds the item without the flag.
    // Treat it as received rather than handing over a second copy.
    if (hasItem(this.state, win.item, 1)) {
      this.state.flags[win.gotFlag] = true;
      return DONE;
    }
    if (!giveItem(this.state, win.item, 1)) {
      print("[PlayHost] no room for " + win.item + "; it is still owed");
      return DONE;
    }
    this.state.flags[win.gotFlag] = true;
    return DONE;
  }
}

/**
 * Substitutes the player's and rival's names, as the cartridge's box does.
 *
 * Exported for the shop, which pages the mart's own lines through the same
 * box with the same slots.
 */
export function pagesOf(body: string, state: PlayState, ram: string, num: number): string[][] {
  let text = body;
  // {NUM:name, bytes, digits}: a number the cartridge prints from a RAM address.
  // Two of them are a live count this host can answer itself; the rest are
  // whatever the script supplied. A slot with no value is LEFT IN PLACE, so a
  // missing number is visible on screen rather than silently blank.
  let numAt = text.indexOf("{NUM:");
  while (numAt >= 0) {
    const close = text.indexOf("}", numAt);
    if (close < 0) {
      break;
    }
    const slot = text.substring(numAt + 5, close);
    let value = "";
    if (slot.indexOf("hOaksAideNumMonsOwned") === 0) {
      value = "" + dexOwnedCount(state);
    } else if (slot.indexOf("wPlayerCoins") === 0) {
      value = "" + state.coins;
    } else if (num >= 0) {
      value = "" + num;
    }
    if (value === "") {
      print("[PlayHost] no value for {NUM:" + slot + "}");
      break;
    }
    text = text.substring(0, numAt) + value + text.substring(close + 1);
    numAt = text.indexOf("{NUM:");
  }
  // The cartridge's scratch strings: the species just received, the item just
  // found, the gym leader's name. There are SEVENTEEN of them in Red's text --
  // wNameBuffer, wStringBuffer, wOaksAideRewardItemName, wTrainerName and the
  // rest -- and substituting only the first left every other line showing its
  // raw token. Which one a line uses is the cartridge's business; the script
  // supplies the value and this fills whichever slot is there.
  let ramAt = text.indexOf("{RAM:");
  while (ramAt >= 0) {
    const close = text.indexOf("}", ramAt);
    if (close < 0) {
      break;
    }
    text = text.substring(0, ramAt) + (ram ? ram : "") + text.substring(close + 1);
    ramAt = text.indexOf("{RAM:");
  }
  while (text.indexOf("{PLAYER}") >= 0) {
    text = text.replace("{PLAYER}", state.playerName);
  }
  while (text.indexOf("{RIVAL}") >= 0) {
    text = text.replace("{RIVAL}", state.rivalName);
  }
  const pages = paginate(text);
  const out: string[][] = [];
  for (let i = 0; i < pages.length; i++) {
    out.push(pages[i].lines);
  }
  return out.length > 0 ? out : [[""]];
}

/**
 * The badges, in the order battle/Stats.ts BADGE_BOOST_STAT reads them.
 *
 * Written here rather than derived because the bundle has no item table: a full
 * Kanto bundle has seventeen top-level keys and `items` is not one of them, so
 * there is nothing to look "BOULDERBADGE" up in.
 */
const BADGE_IDS: string[] = [
  "BOULDERBADGE", "CASCADEBADGE", "THUNDERBADGE", "RAINBOWBADGE",
  "SOULBADGE", "MARSHBADGE", "VOLCANOBADGE", "EARTHBADGE",
];

/**
 * The OT name every in-game trade stamps on what it hands over.
 *
 * The cartridge's own string, `dname "<TRAINER>"` -- one name for all ten
 * trades, and what makes each of them a foreign Pokemon.
 */
export const TRADE_OT_NAME: string = "TRAINER";

function badgeIndexOf(item: string): number {
  for (let i = 0; i < BADGE_IDS.length; i++) {
    if (BADGE_IDS[i] === item) {
      return i;
    }
  }
  return -1;
}

/**
 * Which OPP_RIVAL1 roster to fight, from the ball the player opened.
 *
 * The rosters are in the cartridge's own order -- Rival1Data is SQUIRTLE,
 * BULBASAUR, CHARMANDER (data/trainers/parties.asm:487-490) -- and every rival
 * script picks between them the same way (OaksLab.asm:387-397,
 * CeruleanCity.asm:146-156, Route22.asm): it reads wRivalStarter, which is what
 * HE took, and STARTER2/SQUIRTLE picks 1, STARTER3/BULBASAUR picks 2, else 3.
 *
 * He takes the one that beats yours, so read from the PLAYER's ball:
 *
 *   player CHARMANDER -> he has SQUIRTLE   -> 1
 *   player SQUIRTLE   -> he has BULBASAUR  -> 2
 *   player BULBASAUR  -> he has CHARMANDER -> 3
 *
 * This was the other way round -- Bulbasaur picked roster 1 -- which handed the
 * rival the type the player's own starter beats, in every rival battle in the
 * game. The suite now names the species rather than the number; asserting the
 * number against this same function is how it went unnoticed.
 */
export function rivalRosterFor(state: PlayState): number {
  if (state.flags.EVENT_CHOSE_CHARMANDER === true) {
    return 1;
  }
  if (state.flags.EVENT_CHOSE_SQUIRTLE === true) {
    return 2;
  }
  return 3;
}
