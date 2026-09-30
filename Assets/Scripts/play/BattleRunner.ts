// The layer between a battle and a player.
//
// BattleState is the engine and knows nothing about frames or buttons.
// BattleStage is the presentation and knows nothing about Pokemon -- it grows the
// diorama to life size, holds, and shrinks again. Between them there was nothing,
// which is why an encounter in this lens has so far been a picture of a Pokemon
// on a six-second timer rather than a fight.
//
// This is that layer, and like PlayHost it is pure logic over a narrow port so a
// whole battle can be played out in a test without a headset.
//
// The shape follows the cartridge: the message box carries the battle, one line
// at a time, and the menu only appears when the engine is waiting for a choice.

import { blackoutSpot } from "./ItemUse";
import type { WorldBundle } from "../world/WorldData";
import type { BattleMon, TurnAction } from "./battle/types";
import { ACTION_BAIT, ACTION_ITEM, ACTION_MOVE, ACTION_ROCK, ACTION_RUN,
         ACTION_SWITCH } from "./battle/types";
import { BALL_SAFARI as SAFARI_BALL } from "./battle/Capture";
import type { Battle, PendingLearn, TurnReport } from "./battle/BattleState";
import { LEARN_UNDECIDED } from "./MoveLearnController";
import {
  PHASE_CHOOSE, PHASE_OVER, PHASE_REPLACE,
  RESULT_CAUGHT, RESULT_FLED, RESULT_LOST, RESULT_ONGOING, RESULT_WON,
  startSafariBattle, startTrainerBattle, startWildBattle,
} from "./battle/BattleState";
import {
  SFX_BALL_POOF, SFX_CAUGHT, SFX_DAMAGE, SFX_FAINT, SFX_NOT_VERY_EFFECTIVE,
  SFX_RUN, SFX_SUPER_EFFECTIVE,
} from "../audio/Sfx";
import { firstHealthy } from "./battle/Party";
import { makeWildMon } from "./battle/Stats";
import { fill, romText } from "./battle/Moves";
import type { PlayState } from "./PlayState";
import { badgeMask, canFight, hasItem, markOwned, markSeen, takeItem } from "./PlayState";
import { GHOST_NAME, GHOST_PICTURE, isGhostBattle, isRestlessSoul, SILPH_SCOPE } from "./battle/Ghost";
import { boxFree, boxNumber, depositToBox } from "./Storage";
import { paginate } from "./script/Dialogue";

/** What the runner is waiting for. */
export const RUNNER_IDLE: number = 0;
/** Showing a line; the player has to acknowledge it. */
export const RUNNER_READING: number = 1;
/** The move menu is open. */
export const RUNNER_CHOOSING: number = 2;
/** The battle is finished and the caller should tear the stage down. */
export const RUNNER_DONE: number = 3;
/** A level-up wants a move forgotten, and the player is deciding. */
export const RUNNER_LEARNING: number = 4;

export interface BattleView {
  /** Put a page of battle text on screen. */
  showLines(lines: string[]): void;
  /** True once the player has acknowledged what is shown. */
  acknowledged(): boolean;
  hideBox(): void;
  /** Offer the four move slots; -1 while nothing is chosen. */
  showMoves(names: string[]): void;
  chosenMove(): number;
  hideMoves(): void;
  /** The player asked to run. */
  wantsToRun(): boolean;
  /** The party slot to switch to, or -1. */
  chosenSwitch(): number;
  /** The bag item to use, or "". */
  chosenBagItem(): string;
  /**
   * A SAFARI ZONE battle's own menu: BALL, BAIT, ROCK and RUN, with the balls
   * left counted on it. Optional -- a view without one never sees a Safari
   * battle, which is every view but the lens's own and the test harness's.
   */
  showSafariMenu?(ballsLeft: number): void;
  /** "ball", "bait", "rock", "run", or "" while nothing is chosen. */
  chosenSafari?(): string;
  /** Who to use it on, or -1 for the Pokemon that is out. */
  chosenBagTarget(): number;
  /** The move slot an ETHER or a PP UP was pointed at, or -1. Optional: older views have no such menu. */
  chosenBagMove?(): number;
  /**
   * A level-up is offering `moveId` to a Pokemon that already knows four.
   *
   * The prompt itself is MoveLearnController, which the lens already drives for
   * a TM; the runner only asks, and waits. Doing it the other way -- the runner
   * owning the controller -- would need raw buttons in this interface, which is
   * choice-shaped everywhere else and better for it.
   */
  askLearn(mon: BattleMon, moveId: string): void;
  /**
   * The slot the player chose, LEARN_ABANDONED to keep what it has, or
   * LEARN_UNDECIDED while they are still reading.
   */
  learnDecision(): number;
  /**
   * Play a sound effect, by its name in the cartridge (see audio/Sfx.ts).
   *
   * ONE a turn, chosen by what mattered most about it. The cartridge plays
   * several -- the hit, then the effectiveness chime, then the faint -- but it
   * plays them against move ANIMATIONS, which space them out over a second or
   * more. With no animations there is nothing to space them against, and three
   * effects on one frame is a noise rather than three sounds.
   */
  sound(key: string): void;
}

/**
 * One battle, played a frame at a time.
 *
 * Construct it, call update() every frame, and read state(). When it reports
 * RUNNER_DONE the party in the PlayState has already been written back.
 */
export class BattleRunner {
  private bundle: WorldBundle;
  private play: PlayState;
  private view: BattleView;
  private battle: Battle = null;

  private phase: number = RUNNER_IDLE;
  /** The level-up move being decided, or null. */
  private learning: PendingLearn = null;
  /** Lines the engine produced that the player has not read yet. */
  /**
   * Pages waiting to be read, each already broken into the box's own lines.
   *
   * This used to hold the cartridge's raw strings, and a raw string carries
   * the control codes with it: `Wild PIDGEY\nappeared!` went to the box as ONE
   * line, and the box draws 18 columns and clips. On the glasses that read
   * `Wild PIDGEY appear`, and the rival's `OPP RIVAL1 sent ou` in the
   * 7 September recording was the same fault on the line the whole fight opens
   * with. The overworld never had it because it pages through paginate(); the
   * battle simply did not call it.
   */
  private queue: string[][] = [];
  private showing: boolean = false;
  private wasWild: boolean = true;
  private foeTrainer: string = "";
  /** The prize of a won trainer battle has been paid and announced. */
  private prizePaid: boolean = false;
  /** The blackout line of a lost battle has been read. */
  private farewellSaid: boolean = false;
  private ended: boolean = false;
  /** Whether this battle warped the player to their healing point. See whiteout(). */
  private warpedHome: boolean = false;
  /** Row labels the menu shows, and the move slot each row stands for. */
  private moveLabels: string[] = [];
  private moveSlots: number[] = [];
  /**
   * The old man's catching demonstration (BATTLE_TYPE_OLD_MAN). Not a battle
   * at all as far as the engine is concerned: the cartridge sends out no
   * Pokemon, drives the menu itself and throws a ball that always catches
   * (item_effects.asm ItemUseBall .oldManBattle -> .captured), then hands
   * nothing over and takes nothing from the bag. So there is no BattleState
   * behind it -- only the foe, the lines, and the caught jingle.
   */
  private demoFoe: BattleMon = null;
  private demoStage: number = 0;
  /** Who throws the ball in the demonstration: the old man, or Oak in Yellow's Pallet. */
  private demoThrower: string = DEMO_TRAINER_NAME;
  /** Whether the demonstration's ball holds. Red's always does; Yellow's first does not. */
  private demoCatches: boolean = true;
  /** True for a SAFARI ZONE encounter: a different menu and no fighting. */
  private safari: boolean = false;

  constructor(bundle: WorldBundle, play: PlayState, view: BattleView) {
    this.bundle = bundle;
    this.play = play;
    this.view = view;
  }

  /**
   * A wild encounter. Returns false when there is nothing to send out, which the
   * caller must respect -- startWildBattle throws on an empty or wiped party.
   */
  startWild(species: string, level: number, random: () => number, mapId?: string): boolean {
    if (!canFight(this.play)) {
      return false;
    }
    const wild = makeWild(this.bundle, species, level, random);
    if (wild === null) {
      return false;
    }
    // An unidentified GHOST in the tower (battle/Ghost.ts). The species and
    // its stats are untouched -- only the name the player is shown, and what
    // either side is allowed to do. The dex entry is NOT marked: the cartridge
    // never gets as far as naming it.
    const ghost = mapId !== undefined &&
      isGhostBattle(mapId, hasItem(this.play, SILPH_SCOPE, 1));
    if (!ghost) {
      markSeen(this.play, speciesDex(this.bundle, species));
    } else {
      wild.name = GHOST_NAME;
    }
    const restless = mapId !== undefined && isRestlessSoul(mapId, species);
    this.unveiling = restless && !ghost;
    this.battle = startWildBattle(this.bundle, this.play.party,
                                  badgeMask(this.play), wild, random, ghost, restless);
    // wPlayerID, so a traded Pokemon can disobey (battle/Obedience.ts).
    this.battle.ctx.playerId = this.play.playerId;
    this.battle.ctx.names = { player: this.play.playerName, rival: this.play.rivalName };
    this.wasWild = true;
    this.safari = false;
    this.farewellSaid = false;
    this.foeTrainer = "";
    this.begin();
    return true;
  }

  /**
   * A SAFARI ZONE encounter (script/Safari.ts). Same picture as a wild one,
   * and none of the fighting: the menu is the Zone's own.
   */
  startSafari(species: string, level: number, random: () => number): boolean {
    if (!canFight(this.play)) {
      return false;
    }
    const wild = makeWild(this.bundle, species, level, random);
    if (wild === null) {
      return false;
    }
    markSeen(this.play, speciesDex(this.bundle, species));
    this.battle = startSafariBattle(this.bundle, this.play.party,
                                    badgeMask(this.play), wild, random);
    this.battle.ctx.playerId = this.play.playerId;
    this.battle.ctx.names = { player: this.play.playerName, rival: this.play.rivalName };
    this.wasWild = true;
    this.safari = true;
    this.farewellSaid = false;
    this.foeTrainer = "";
    this.begin();
    return true;
  }

  /** Which of the four rows the player picked, as the engine's own action. */
  private safariAction(picked: string): TurnAction {
    if (picked === "ball") {
      return { kind: ACTION_ITEM, moveIndex: -1, partyIndex: -1, item: SAFARI_BALL };
    }
    if (picked === "bait") {
      return { kind: ACTION_BAIT, moveIndex: -1, partyIndex: -1, item: "" };
    }
    if (picked === "rock") {
      return { kind: ACTION_ROCK, moveIndex: -1, partyIndex: -1, item: "" };
    }
    return this.runAction();
  }

  /**
   * The old man's demonstration in Viridian: a wild WEEDLE at level 5, caught
   * by "OLD MAN" with a POKe BALL, in three pages. See demoFoe.
   */
  startDemo(random: () => number, species: string = DEMO_SPECIES, level: number = DEMO_LEVEL,
            thrower: string = DEMO_TRAINER_NAME, catches: boolean = true): boolean {
    const foe = makeWild(this.bundle, species, level, random);
    if (foe === null) {
      return false;
    }
    this.battle = null;
    this.demoFoe = foe;
    this.demoThrower = thrower;
    this.demoCatches = catches;
    this.demoStage = 0;
    this.wasWild = true;
    this.safari = false;
    this.foeTrainer = "";
    this.ended = false;
    this.warpedHome = false;
    this.queue = [];
    this.drain([slotFill(romText(this.bundle, "_WildMonAppearedText"), foe.name)]);
    this.phase = RUNNER_READING;
    return true;
  }

  /** One frame of the demonstration: read, then the throw, then the catch. */
  private updateDemo(): void {
    if (this.phase !== RUNNER_READING) {
      return;
    }
    if (this.showing) {
      if (!this.view.acknowledged()) {
        return;
      }
      this.queue.shift();
      this.showing = false;
      return;
    }
    if (this.queue.length > 0) {
      this.present(this.queue[0]);
      this.showing = true;
      return;
    }
    if (this.demoStage === 0) {
      // "OLD MAN used POKe BALL!" -- ItemUseText00, with the player's name
      // swapped for the old man's the way core.asm swaps wPlayerName.
      const ball = this.bundle.items && this.bundle.items.POKE_BALL ? this.bundle.items.POKE_BALL.name : "POKe BALL";
      const used = romText(this.bundle, "_ItemUseText001").split("{PLAYER}").join(this.demoThrower) +
        "\n" + slotFill(romText(this.bundle, "_ItemUseText002"), ball);
      this.drain([used]);
      this.demoStage = 1;
      return;
    }
    if (this.demoStage === 1) {
      if (!this.demoCatches) {
        // Yellow's first lesson (EVENT_INITIAL_CATCH_TRAINING): the anim data
        // is $63, three shakes and the ball breaks open, so the line is the
        // three-shake miss, ItemUseBallText04.
        this.drain([romText(this.bundle, "_ItemUseBallText04")]);
        this.demoStage = 2;
        return;
      }
      // .captured, unconditionally: the ball's three shakes end in the caught
      // jingle, then ItemUseBallText05 -- and .oldManCaughtMon skips the dex,
      // the party and the bag.
      this.view.sound(SFX_CAUGHT);
      this.drain([slotFill(romText(this.bundle, "_ItemUseBallText05"), this.demoFoe.name)]);
      this.demoStage = 2;
      return;
    }
    this.view.hideBox();
    this.ended = true;
    this.phase = RUNNER_DONE;
  }

  /** A trainer battle from a roster in the bundle. */
  startTrainer(trainerId: string, partyIndex: number, random: () => number): boolean {
    if (!canFight(this.play)) {
      return false;
    }
    const trainer = this.bundle.trainers ? this.bundle.trainers[trainerId] : null;
    if (!trainer || !trainer.parties) {
      print("[BattleRunner] no roster for " + trainerId);
      return false;
    }
    const roster = trainer.parties[partyIndex - 1];
    if (!roster || roster.length === 0) {
      print("[BattleRunner] " + trainerId + " has no party " + partyIndex);
      return false;
    }
    const foes: BattleMon[] = [];
    for (let i = 0; i < roster.length; i++) {
      const mon = makeWild(this.bundle, roster[i].species, roster[i].level, random);
      if (mon !== null) {
        foes.push(mon);
      }
    }
    if (foes.length === 0) {
      return false;
    }
    this.battle = startTrainerBattle(this.bundle, this.play.party,
                                     badgeMask(this.play), foes, trainerId, random,
                                     { player: this.play.playerName, rival: this.play.rivalName });
    this.battle.ctx.playerId = this.play.playerId;
    this.wasWild = false;
    this.safari = false;
    this.foeTrainer = trainerId;
    this.prizePaid = false;
    this.farewellSaid = false;
    this.begin();
    return true;
  }

  /** True for a wild encounter, false for a trainer. Decides the music. */
  isWild(): boolean {
    return this.wasWild;
  }

  /** The trainer being fought, or "" for a wild battle. */
  trainer(): string {
    return this.foeTrainer;
  }

  private begin(): void {
    this.ended = false;
    this.warpedHome = false;
    this.queue = [];
    // The engine cannot read a save, so it is told how much box room there is
    // before the first turn. Without this call a catch with six in the party is
    // refused at the throw, and every older suite still expects exactly that.
    this.battle.setBoxSpace(boxFree(this.play), boxNumber(this.play));
    // The opening lines -- "A wild X appeared!", "Go! Y!" -- are already on the
    // log by the time the constructor returns.
    this.drain(this.battle.outcome().log);
    this.phase = RUNNER_READING;
  }

  state(): number {
    return this.phase;
  }

  isRunning(): boolean {
    return this.phase !== RUNNER_IDLE && this.phase !== RUNNER_DONE;
  }

  /**
   * The move slot each menu row stands for.
   *
   * A row is not a slot: the engine reads moveIndex as a raw index into
   * mon.moves and a menu can only list the moves that exist.
   */
  moveSlotsForMenu(): number[] {
    return this.moveSlots;
  }

  /**
   * The party to SHOW, which mid-battle is not the one in the save.
   *
   * The active Pokemon is a deep copy the battle made and nothing folds HP back
   * into the PlayState until the battle ends, so a party screen reading the save
   * would show pre-battle HP and offer to heal a Pokemon that is already down.
   */
  displayParty(): BattleMon[] {
    return this.battle === null ? [] : this.battle.party();
  }

  /**
   * The two Pokemon standing on the field: [yours, theirs], by species id.
   *
   * Empty before the battle begins and after it ends. Read every frame by
   * whatever is drawing them, so a faint, a switch or a capture changes who is
   * on the ground without anything having to be told about it.
   */
  /** A page goes up. The one that names the restless soul ends her disguise. */
  private present(lines: string[]): void {
    if (this.unveiling && lines.join(" ").indexOf("Wild ") >= 0) {
      this.unveiling = false;
    }
    this.view.showLines(lines);
  }

  /** True while the restless soul is still the ghost the scope is about to name. */
  private unveiling: boolean = false;

  /**
   * What to DRAW for each side: the species, except that a foe nobody has
   * identified -- a tower ghost, or the restless soul until the scope's line
   * has been read -- is GHOST_PICTURE, the cartridge's own GhostPic.
   */
  picturesOnField(): string[] {
    const out = this.onField();
    if (out.length === 2 && this.battle !== null && this.battle.ctx &&
        (this.battle.ctx.ghost === true || this.unveiling)) {
      out[1] = GHOST_PICTURE;
    }
    return out;
  }

  onField(): string[] {
    if (this.demoFoe !== null) {
      // Nobody on the player's side: the old man sends nothing out, and an
      // empty species draws no billboard (BattleActors.build).
      return ["", this.demoFoe.species];
    }
    if (this.battle === null) {
      return [];
    }
    const ctx = this.battle.ctx;
    const mine = ctx && ctx.player ? ctx.player.active : null;
    const theirs = ctx && ctx.foe ? ctx.foe.active : null;
    if (!mine || !theirs) {
      return [];
    }
    return [mine.species, theirs.species];
  }

  /**
   * The two Pokemon as the HUD needs them: [yours, theirs].
   *
   * Separate from onField(), which answers species ids for the two billboards.
   * The HUD wants the LIVING mon -- its nickname, level and current HP -- and
   * reads it every frame, so a hit, a level-up or a switch moves the bar
   * without anything having to be told that it happened.
   */
  hudSides(): BattleMon[] {
    if (this.battle === null) {
      return [];
    }
    const ctx = this.battle.ctx;
    const mine = ctx && ctx.player ? ctx.player.active : null;
    const theirs = ctx && ctx.foe ? ctx.foe.active : null;
    if (!mine || !theirs) {
      return [];
    }
    return [mine, theirs];
  }

  /**
   * True when this battle sent the player back to their healing point.
   *
   * The lens has to move the world when that happens, and it used to work the
   * warp out for itself by comparing play.mapId with the overworld's. That is
   * not a signal, it is a STALE SAVE: play.mapId is written by the twenty
   * second autosave and by nothing else, so the two disagree for most of any
   * walk -- and permanently once the autosave is blocked. After one whiteout
   * the heal point sat in play.mapId, and every battle that ended afterwards,
   * won or lost, read that disagreement and warped the player home. One loss
   * to the rival and every wild encounter afterwards ended in Red's house.
   */
  whiteout(): boolean {
    return this.warpedHome;
  }

  /** True when the player won. Only meaningful once RUNNER_DONE. */
  won(): boolean {
    if (this.battle === null) {
      return false;
    }
    const r = this.battle.outcome().result;
    return r === RESULT_WON || r === RESULT_CAUGHT;
  }

  /**
   * Whether the foe went into a ball rather than down (wBattleResult == 2).
   *
   * A win alone cannot tell a script which happened, and two of them care:
   * a SNORLAX in a ball did not calm down and wander back to the mountains.
   */
  caught(): boolean {
    return this.battle !== null && this.battle.outcome().result === RESULT_CAUGHT;
  }

  update(): void {
    if (this.demoFoe !== null) {
      this.updateDemo();
      return;
    }
    if (this.battle === null || this.phase === RUNNER_DONE) {
      return;
    }

    if (this.phase === RUNNER_READING) {
      if (!this.showing) {
        if (this.queue.length === 0) {
          this.afterReading();
          return;
        }
        this.present(this.queue[0]);
        this.showing = true;
        return;
      }
      if (!this.view.acknowledged()) {
        return;
      }
      this.queue.shift();
      this.showing = false;
      return;
    }

    if (this.phase === RUNNER_LEARNING) {
      const slot = this.view.learnDecision();
      if (slot === LEARN_UNDECIDED) {
        return;
      }
      // LEARN_ABANDONED is a real answer: the cartridge lets you keep what you
      // have, and applyLearn takes any negative slot as exactly that.
      this.battle.applyLearn(this.learning.index, this.learning.moveId, slot);
      this.learning = null;
      // Back through afterReading, which may find another level-up waiting --
      // a Pokemon can cross two levels on one payout.
      this.phase = RUNNER_READING;
      this.afterReading();
      return;
    }

    if (this.phase === RUNNER_CHOOSING && this.safari) {
      const picked = this.view.chosenSafari ? this.view.chosenSafari() : "";
      if (picked === "") {
        return;
      }
      this.view.hideMoves();
      this.takeTurn(this.safariAction(picked));
      return;
    }

    if (this.phase === RUNNER_CHOOSING) {
      if (this.wasWild && this.view.wantsToRun() && this.battle.canRun()) {
        this.view.hideMoves();
        this.takeTurn(this.runAction());
        return;
      }
      // Switching and items come before a move, because the menu can only be
      // offering one of them at a time and a stale move row must not win.
      const switchTo = this.view.chosenSwitch();
      if (switchTo >= 0) {
        this.view.hideMoves();
        this.takeTurn({ kind: ACTION_SWITCH, moveIndex: -1,
                        partyIndex: switchTo, item: "" });
        return;
      }
      const bagItem = this.view.chosenBagItem();
      if (bagItem !== "") {
        this.view.hideMoves();
        this.takeTurn({ kind: ACTION_ITEM,
                        moveIndex: this.view.chosenBagMove ? this.view.chosenBagMove() : -1,
                        partyIndex: this.view.chosenBagTarget(), item: bagItem });
        return;
      }
      const slot = this.view.chosenMove();
      if (slot < 0) {
        return;
      }
      const moveSlot = this.slotForRow(slot);
      if (moveSlot < 0) {
        return;
      }
      this.view.hideMoves();
      this.takeTurn({ kind: ACTION_MOVE, moveIndex: moveSlot, partyIndex: -1, item: "" });
    }
  }

  /** What to do once every queued line has been read. */
  private afterReading(): void {
    this.view.hideBox();

    // Before anything else, including the end of the battle: the cartridge asks
    // this the moment the level-up line is read, and a battle that ended on the
    // same faint still asks it. Answering it after finish() would be answering
    // it about a party that has already been written back.
    if (this.battle.hasPendingLearn()) {
      this.learning = this.battle.takePendingLearn();
      this.view.askLearn(this.battle.party()[this.learning.index], this.learning.moveId);
      this.phase = RUNNER_LEARNING;
      return;
    }

    if (this.battle.phase === PHASE_OVER) {
      // GetTrainerInformation / _MoneyForWinningText: a beaten trainer pays the
      // class's base money times the level of the LAST Pokemon in his roster,
      // and the line is read before the battle screen goes. Once.
      // _PlayerBlackedOutText, before the whiteout: "<PLAYER> is out of
      // useable POKeMON! <PLAYER> blacked out!" A trainer has no losing
      // line on this cartridge, so this is the whole farewell. Once.
      if (!this.farewellSaid && this.battle.outcome().result === RESULT_LOST) {
        this.farewellSaid = true;
        this.drain([fill(romText(this.bundle, "_PlayerBlackedOutText"),
                         this.play.playerName, this.play.playerName, "", 0)]);
        return;
      }
      if (!this.prizePaid && !this.wasWild && this.foeTrainer !== "" &&
          this.battle.outcome().result === RESULT_WON) {
        this.prizePaid = true;
        const prize = prizeMoneyFor(this.bundle, this.foeTrainer, this.battle.ctx.foe.party);
        if (prize > 0) {
          this.play.money = Math.min(999999, this.play.money + prize);
          this.drain([fill(romText(this.bundle, "_MoneyForWinningText"),
                           this.play.playerName, this.play.playerName, "", prize)]);
          return;
        }
      }
      this.finish();
      return;
    }

    if (this.battle.phase === PHASE_REPLACE) {
      // The lead fainted. Send out the next healthy Pokemon; a party with none
      // left cannot reach here, because that ends the battle.
      const next = firstHealthy(this.battle.party());
      if (next < 0) {
        this.finish();
        return;
      }
      this.takeTurn({ kind: ACTION_SWITCH, moveIndex: -1, partyIndex: next, item: "" });
      return;
    }

    // A locked-in move (Thrash, a charging turn) leaves the player no choice.
    if (this.battle.forcedMove() !== "") {
      this.takeTurn({ kind: ACTION_MOVE, moveIndex: -1, partyIndex: -1, item: "" });
      return;
    }

    if (this.safari) {
      this.offerSafari();
      this.phase = RUNNER_CHOOSING;
      return;
    }
    this.buildMoveRows();
    this.view.showMoves(this.moveLabels);
    this.phase = RUNNER_CHOOSING;
  }

  /** The four rows a SAFARI ZONE battle offers instead of the move list. */
  private offerSafari(): void {
    if (this.view.showSafariMenu) {
      this.view.showSafariMenu(this.play.safariBalls);
    }
  }

  private runAction(): TurnAction {
    return { kind: ACTION_RUN, moveIndex: -1, partyIndex: -1, item: "" };
  }

  /** One turn, and everything it printed. */
  private takeTurn(action: TurnAction): void {
    const before = this.battle.outcome().log.length;
    const report: TurnReport = this.battle.takeTurn(action);
    // The bag comes down HERE and only here. `ok` means the action was legal
    // for the phase, not that the item did anything: a Potion on a fainted
    // Pokemon, an item with no battle effect and a ball thrown with a full
    // party all print a line and still report ok. itemConsumed is the engine
    // saying the item actually left the bag.
    if (report.itemConsumed !== "") {
      takeItem(this.play, report.itemConsumed, 1);
    }
    if (!report.ok) {
      // An illegal action for this phase. Re-offer rather than spin.
      if (this.safari) {
        this.offerSafari();
        this.phase = RUNNER_CHOOSING;
        return;
      }
      this.buildMoveRows();
      this.view.showMoves(this.moveLabels);
      this.phase = RUNNER_CHOOSING;
      return;
    }
    // A SAFARI BALL is not a bag slot: it comes off its own counter, the way
    // wNumSafariBalls does (script/Safari.ts).
    if (this.safari && action.kind === ACTION_ITEM && this.play.safariBalls > 0) {
      this.play.safariBalls = this.play.safariBalls - 1;
    }
    this.drain(this.battle.outcome().log.slice(before));
    this.soundFor(report, action);
    this.phase = RUNNER_READING;
  }

  /**
   * The one sound this turn gets, in the order the moments matter.
   *
   * A catch outranks a faint outranks how well the move landed, because that is
   * the order a player would name what just happened.
   */
  private soundFor(report: TurnReport, action: TurnAction): void {
    if (report.ball !== null) {
      this.view.sound(report.ball.caught ? SFX_CAUGHT : SFX_BALL_POOF);
      return;
    }
    if (report.result === RESULT_FLED) {
      this.view.sound(SFX_RUN);
      return;
    }
    const moves = [report.playerMove, report.foeMove];
    let fainted = false;
    let best = "";
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (move === null || !move.used || !move.hit) {
        continue;
      }
      if (move.targetFainted || move.userFainted) {
        fainted = true;
      }
      if (move.damage <= 0) {
        continue;
      }
      // Effectiveness beats a plain hit, and a plain hit beats nothing. A
      // no-effect move (0) is not a hit at all and says so in its own line.
      if (move.effectiveness > 1) {
        best = SFX_SUPER_EFFECTIVE;
      } else if (move.effectiveness > 0 && move.effectiveness < 1) {
        if (best !== SFX_SUPER_EFFECTIVE) best = SFX_NOT_VERY_EFFECTIVE;
      } else if (best === "") {
        best = SFX_DAMAGE;
      }
    }
    if (fainted) {
      this.view.sound(SFX_FAINT);
      return;
    }
    if (best !== "") {
      this.view.sound(best);
    }
  }

  /**
   * Queues what the engine just said, broken up the way the box shows it.
   *
   * paginate() is the overworld's own splitter and the cartridge's rules live
   * in it: `\n` starts a line, `\f` starts a page, `\v` scrolls the box up one
   * row. A battle line obeys exactly the same rules -- it comes out of the same
   * ROM -- so it goes through the same function rather than a second copy of
   * those rules that can drift from the first.
   */
  private drain(lines: string[]): void {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i] || lines[i].length === 0) {
        continue;
      }
      const pages = paginate(lines[i]);
      for (let p = 0; p < pages.length; p++) {
        this.queue.push(pages[p].lines);
      }
    }
  }

  /**
   * The rows the menu shows, and the SLOT each one stands for.
   *
   * These are not the same number and reading them as if they were picks the
   * wrong move. The engine treats `moveIndex` as a raw slot into `mon.moves`
   * -- "Move slot 0..3", and it guards `mon.moves[slot].id === ""` at that
   * index -- while a menu can only list the moves that exist. A Pokemon whose
   * slot 0 is empty labels its rows [EMBER, SCRATCH]; picking row 1 (SCRATCH)
   * used to send slot 1, which is EMBER.
   */
  private buildMoveRows(): void {
    this.moveLabels = [];
    this.moveSlots = [];
    const mon = activeMon(this.battle);
    const slots = mon ? mon.moves : [];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].id && slots[i].id.length > 0) {
        // Seventeen columns, because the panel is eighteen and column zero is
        // the cursor. Seventeen of the cartridge's moves are twelve characters
        // long -- THUNDERPUNCH, FLAMETHROWER, SELFDESTRUCT -- so the old
        // "name + two spaces + pp" ran to nineteen and the last two characters
        // simply were not drawn. Nothing shows that; the label just ends early.
        const pp = padLeft("" + slots[i].pp, 2) + "/" + padLeft("" + slots[i].maxPp, 2);
        this.moveLabels.push(padRight(slots[i].id, 12) + pp);
        this.moveSlots.push(i);
      }
    }
  }

  /** The slot behind a menu row, or -1. */
  private slotForRow(row: number): number {
    if (row < 0 || row >= this.moveSlots.length) {
      return -1;
    }
    return this.moveSlots[row];
  }

  /**
   * Writes the result back into the playthrough.
   *
   * The party is the SAME array the battle was handed, so HP, PP, experience and
   * levels are already in the PlayState. What is not is the dex entry for
   * something caught, and the caught Pokemon itself when the party had room.
   */
  private finish(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    const out = this.battle.outcome();

    // The battle owns the party array; take back whatever it ended with.
    this.play.party = out.party;

    // A catch with a full party was announced as boxed and handed back here.
    // Without this the line is shown and the Pokemon is simply lost.
    if (out.caughtToBox > 0 && out.caughtMon !== null) {
      if (depositToBox(this.play, out.caughtMon) === 0) {
        print("[BattleRunner] the box filled mid-battle; " + out.caughtMon.species + " is lost");
      }
    }

    if (out.result === RESULT_CAUGHT && out.caught) {
      markOwned(this.play, speciesDex(this.bundle, out.caught));
    }
    if (out.payDay > 0) {
      this.play.money = this.play.money + out.payDay;
    }
    if (out.result === RESULT_LOST) {
      this.warpedHome = true;
      // A whiteout: back to the last healing point, everything restored, and
      // half the money gone.
      //
      // The halving waited on a line that does not exist. "You panicked and
      // dropped..." is GENERATION 2; this cartridge's text carries nothing at
      // all about losing money (checked against the whole table, 7 September),
      // and ResetStatusAndHalveMoneyOnBlackout simply halves it. So the theft
      // being silent is not a shortcut here -- it is what the game does.
      this.play.money = Math.floor(this.play.money / 2);
      // Where you come to: HandleBlackOut -> PrepareForSpecialWarp reads
      // wLastBlackoutMap and lands on its FLY spot, outdoors -- in front of
      // your own house in Pallet Town until a nurse has healed you, in front
      // of the Center's town square after. Not at the counter: that is Gen 2.
      // The same spot the ESCAPE ROPE uses (ItemUse.blackoutSpot).
      const spot = blackoutSpot(this.bundle, this.play);
      this.play.mapId = spot.mapId;
      this.play.cellX = spot.x;
      this.play.cellY = spot.y;
      for (let i = 0; i < this.play.party.length; i++) {
        const mon = this.play.party[i];
        mon.hp = mon.maxHp;
        mon.status = "";
        mon.sleepTurns = 0;
        for (let m = 0; m < mon.moves.length; m++) {
          mon.moves[m].pp = mon.moves[m].maxPp;
        }
      }
    }
    this.phase = RUNNER_DONE;
  }
}

/**
 * What a beaten trainer pays: base money for his class times the level of the
 * last Pokemon in his roster, exactly the two bytes GetTrainerInformation
 * multiplies. Zero when the bundle has no row for him.
 */
export function prizeMoneyFor(bundle: any, trainerId: string, roster: BattleMon[]): number {
  const row = bundle && bundle.trainers ? bundle.trainers[trainerId] : null;
  if (!row || typeof row.baseMoney !== "number" || roster.length === 0) {
    return 0;
  }
  return row.baseMoney * roster[roster.length - 1].level;
}

function padRight(text: string, n: number): string {
  let out = text.length > n ? text.substring(0, n) : text;
  while (out.length < n) {
    out = out + " ";
  }
  return out;
}

function padLeft(text: string, n: number): string {
  let out = text.length > n ? text.substring(text.length - n) : text;
  while (out.length < n) {
    out = " " + out;
  }
  return out;
}

/**
 * The Pokemon that is OUT, which is not the same as the first healthy one.
 *
 * This used to scan the party for the first member with HP. That is the same
 * Pokemon only while the player has never switched, which is true today only
 * because nothing can switch voluntarily yet -- so it was a dormant bug that
 * would have woken the moment the party menu did. The side knows who is out.
 */
function activeMon(battle: Battle): BattleMon {
  return battle.ctx.player.active;
}

function speciesDex(bundle: WorldBundle, species: string): number {
  const spec = bundle.species ? bundle.species[species] : null;
  return spec ? spec.dex : 0;
}

/** A wild Pokemon, or null when the bundle does not have that species. */
/** ViridianCityOldManStartCatchTrainingScript: a WEEDLE at level 5, by "OLD MAN". */
const DEMO_SPECIES: string = "WEEDLE";
const DEMO_LEVEL: number = 5;
const DEMO_TRAINER_NAME: string = "OLD MAN";

/** Every {RAM:...} slot of a cartridge line filled with one value. */
function slotFill(text: string, value: string): string {
  let out = text;
  for (let guard = 0; guard < 8; guard++) {
    const start = out.indexOf("{RAM:");
    if (start < 0) {
      return out;
    }
    const end = out.indexOf("}", start);
    if (end < 0) {
      return out;
    }
    out = out.substring(0, start) + value + out.substring(end + 1);
  }
  return out;
}

function makeWild(bundle: WorldBundle, species: string, level: number,
                  random: () => number): BattleMon {
  if (!species || !bundle.species || !bundle.species[species]) {
    print("[BattleRunner] no species " + species + " in this bundle");
    return null;
  }
  return makeWildMon(bundle, species, level, random);
}
