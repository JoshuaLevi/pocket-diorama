// The state machine that drives one battle, start to finish.
//
// Everything below this file is a function: Moves.ts resolves one move, Status.ts
// one status rung, Party.ts one payout. None of them knows what a turn is. This
// file is what makes them a battle -- it owns the order the cartridge runs them
// in, the state that lives between them, and the answer the overworld gets back.
//
// Three things it owns that no other module does, because they are sequencing
// rather than arithmetic:
//
//   * The before-move gauntlet. Status.ts documents that its three exported rungs
//     have to be spliced, not called back to back: held-in-place and flinch go
//     after sleep and freeze, the recharge and the Disable countdown after those,
//     and the disabled-move test between confusion and paralysis. canAct() is that
//     splice, in the cartridge's order.
//   * Residual damage AFTER THE ACTING SIDE'S MOVE, not at the end of the round.
//     A fast Pokemon's poison can kill it before the slow one has moved, and the
//     slow one then never moves at all.
//   * Leech Seed. It is the one end-of-turn effect no other module implements,
//     and it advances the SAME counter Toxic uses (Status.toxicTick), so a
//     Pokemon that is both seeded and badly poisoned takes two steps a turn.
//
// The engine works in two styles because the modules below it do: Moves.ts
// mutates the BattleMon it is handed, and Status.ts and Party.ts return fresh
// copies. Every call to the second kind is followed by writing the result back
// into the side, and the MoveEnv is re-aimed before every move so it never holds
// a stale active Pokemon. Getting either wrong loses damage silently, which is why
// setActive() and aim() exist rather than being written out at each call site.
//
// No Record/Map/Set and no enum: Lens Studio's TypeScript has none of them.

import type {
  BattleContext,
  BattleMon,
  BattleSide,
  MoveResult,
  TurnAction,
  BattleNames,
} from "./types";
import { ACTION_BAIT, ACTION_ITEM, ACTION_MOVE, ACTION_ROCK, ACTION_RUN,
         ACTION_SWITCH } from "./types";
import { TEXT_THREW_BAIT, TEXT_THREW_ROCK, addTurns, baitCatchRate, rockCatchRate,
         safariEscapes, safariTurnText, safariTurns } from "../script/Safari";
import { GHOST_NAME, TEXT_APPEARED, TEXT_CANT_BE_IDD, TEXT_GET_OUT, TEXT_SCARED, TEXT_UNVEILED } from "./Ghost";
import { randomByte } from "./Damage";
import { sendOut } from "./Stats";
import {
  applyDamageTo,
  continueBide,
  continueTrapping,
  displayName,
  emptyResult,
  fill,
  moveEnv,
  romText,
  useMove,
  fillSlots,
} from "./Moves";
import type { MoveEnv } from "./Moves";
import {
  confusionCheck,
  confusionSelfHitDamage,
  paralysisCheck,
  residualDamage,
  sleepFreezeCheck,
  toxicTick,
} from "./Status";
import { decideOrder } from "./TurnOrder";
import type { TurnOrderResult } from "./TurnOrder";
import { STATUS_NONE, STATUS_SLEEP } from "./types";
import { clampStage } from "./Stats";
import type { AiClass } from "./Ai";
import { AI_STRUGGLE, HEAL_FULL, aiClassFor, chooseMove, classAction, itemEffect } from "./Ai";
import { applyItemEffect, canUseItemOn } from "./ItemUse";
import { OBEY_HIT, OBEY_NAP, OBEY_RANDOM, OBEY_USE, isTraded, rollDisobedience } from "./Obedience";
import { isPpItem, usePpItem } from "./PpItems";
import {
  attemptCatch,
  BALL_IDS,
  CATCH_ALLOWED,
  CATCH_BLOCKED_TRAINER,
  CATCH_DODGED,
  CATCH_BLOCKED_BOX_FULL,
  catchBlockedReason,
  shakeMessage,
} from "./Capture";
import type { CatchResult } from "./Capture";
import {
  awardBattleExperience,
  benchActive,
  clearParticipant,
  firstHealthy,
  isWiped,
  learnMove,
  LEARN_NEEDS_ROOM,
  replaceMove,
  markParticipant,
  newParticipants,
  partyIsFull,
  prepareCaught,
  receiveCaught,
  switchTo,
} from "./Party";

// ---------------------------------------------------------------------------
// Phases and results
// ---------------------------------------------------------------------------

/** Waiting for the player's action for this turn. */
export const PHASE_CHOOSE: string = "choose";
/** The player's Pokemon fainted and the party is not wiped: choose a replacement. */
export const PHASE_REPLACE: string = "replace";
/** Finished. `result` says how. */
export const PHASE_OVER: string = "over";

export const RESULT_ONGOING: string = "";
export const RESULT_WON: string = "won";
export const RESULT_LOST: string = "lost";
export const RESULT_CAUGHT: string = "caught";
/** The player escaped: a successful run, or Teleport. */
export const RESULT_FLED: string = "fled";
/** The foe left: Roar, Whirlwind, or a wild Pokemon's own Teleport. */
export const RESULT_FOE_FLED: string = "foe-fled";
/** MAX_TURNS was reached. Nothing in play should ever produce this. */
export const RESULT_STALLED: string = "stalled";

/** What is forcing this Pokemon's move, or FORCED_NONE. */
export const FORCED_NONE: string = "";
export const FORCED_BIDE: string = "bide";
export const FORCED_TRAP: string = "trap";
export const FORCED_THRASH: string = "thrash";
export const FORCED_CHARGE: string = "charge";

/** The move a Pokemon with nothing left uses. It is in the ROM's move table. */
export const STRUGGLE: string = "STRUGGLE";

/** A battle that runs past this is wedged. Real ones finish in tens of turns. */
export const MAX_TURNS: number = 1000;

// ---------------------------------------------------------------------------
// What a turn reports
// ---------------------------------------------------------------------------

/**
 * One turn's worth of everything. Unused slots are null rather than absent, in
 * the same style as types.ts: four callers cannot disagree about what undefined
 * meant if it never appears.
 */
export interface TurnReport {
  /** The action was legal for the current phase. */
  ok: boolean;
  /** Every message box line this turn produced, in order. */
  messages: string[];
  /** The player's move, or null on a turn the player did not use one. */
  playerMove: MoveResult;
  /** The foe's move, or null. */
  foeMove: MoveResult;
  /** Why the turn resolved in the order it did, or null on a replacement turn. */
  order: TurnOrderResult;
  /** The ball this turn threw, or null. */
  ball: CatchResult;
  /** The battle is over. */
  ended: boolean;
  /** RESULT_* -- RESULT_ONGOING while the battle continues. */
  result: string;
  /**
   * The item this turn actually CONSUMED, or "".
   *
   * `ok` is not this. `ok` means the action was legal for the phase, and every
   * refusal inside the item path -- a Potion on a fainted Pokemon, an item with
   * no effect, a ball thrown with a full party -- prints its line and still
   * reports ok. A caller that decrements the bag on `ok` deletes items that
   * healed nothing.
   */
  itemConsumed: string;
}

/** What the overworld gets back when the battle ends. */
export interface BattleOutcome {
  /** One of the RESULT_* constants. */
  result: string;
  /** The player's party, with HP, PP, status, experience and levels as they now are. */
  party: BattleMon[];
  /** The species caught, or "". */
  caught: string;
  /**
   * The caught Pokemon when the party was full and it went to the PC box, else
   * null. The engine cannot write a save, so it names the box and hands the
   * Pokemon back for the caller to deposit.
   */
  caughtMon: BattleMon;
  /** The 1-based box it was sent to, or 0 when it joined the party. */
  caughtToBox: number;
  /** Coins Pay Day scattered. */
  payDay: number;
  turns: number;
  /** The whole battle's message log. */
  log: string[];
}

/**
 * A move a level-up offered to a Pokemon that already has four.
 *
 * The engine cannot answer "which one do you forget?" -- that is the player's,
 * and this file is pure and synchronous -- so it queues the question and the
 * caller driving the battle asks it.
 */
export interface PendingLearn {
  /** Party slot, not the active Pokemon. A benched one can level up too. */
  index: number;
  moveId: string;
}

/** What one side will do this turn, decided before either has moved. */
export interface MovePlan {
  moveId: string;
  /** The slot the move comes out of, or -1 for a forced move or Struggle. */
  slot: number;
  /** FORCED_* -- which continuation function owns the turn. */
  kind: string;
}

// ---------------------------------------------------------------------------
// Forced moves
// ---------------------------------------------------------------------------

/**
 * What is taking this Pokemon's choice away, if anything. The order is the order
 * the cartridge tests them in: Bide outranks a trapping move, which outranks
 * Thrash, which outranks a stored charge.
 */
export function forcedKind(mon: BattleMon): string {
  if (mon.volatile.bideTurns > 0) {
    return FORCED_BIDE;
  }
  if (mon.volatile.trapping && mon.volatile.trapTurns > 0) {
    return FORCED_TRAP;
  }
  if (mon.volatile.thrashTurns > 0) {
    return FORCED_THRASH;
  }
  if (mon.volatile.chargingMove !== "") {
    return FORCED_CHARGE;
  }
  return FORCED_NONE;
}

/** The move id a forced Pokemon will use, or "" when it is free to choose. */
export function forcedMoveId(mon: BattleMon): string {
  const kind = forcedKind(mon);
  if (kind === FORCED_NONE) {
    return "";
  }
  if (kind === FORCED_BIDE) {
    return "BIDE";
  }
  if (kind === FORCED_CHARGE) {
    return mon.volatile.chargingMove;
  }
  return mon.volatile.lastMoveUsed;
}

/** Held in place by the OPPONENT's Wrap, Bind, Fire Spin or Clamp. */
export function heldInPlace(mon: BattleMon): boolean {
  return !mon.volatile.trapping && mon.volatile.trapTurns > 0;
}

/** The first slot with a move, PP left and no Disable on it, or -1. */
export function firstUsableSlot(mon: BattleMon): number {
  for (let i = 0; i < mon.moves.length; i++) {
    if (mon.moves[i].id !== "" && mon.moves[i].pp > 0 && i !== mon.volatile.disabledSlot) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Escape
// ---------------------------------------------------------------------------

/**
 * The published Generation 1 escape odds, out of 256.
 *
 *   A = the player's Speed, low byte      B = (the foe's Speed / 4), low byte
 *   B == 0            -> certain
 *   F = A * 32 / B + 30 * attempts        F > 255 -> certain
 *   otherwise a random byte below F escapes
 *
 * `attempts` counts THIS attempt, so the first run already carries the +30.
 * Returns 256 for "certain", which no byte can reach.
 */
export function escapeOdds(playerSpeed: number, foeSpeed: number, attempts: number): number {
  const divisor = Math.floor(foeSpeed / 4) & 0xff;
  if (divisor === 0) {
    return 256;
  }
  const odds = Math.floor(((playerSpeed & 0xff) * 32) / divisor) + 30 * attempts;
  return odds > 255 ? 256 : odds;
}

/** One escape attempt. Consumes exactly one random byte unless it is certain. */
export function rollEscape(
  playerSpeed: number,
  foeSpeed: number,
  attempts: number,
  random: () => number
): boolean {
  const odds = escapeOdds(playerSpeed, foeSpeed, attempts);
  if (odds >= 256) {
    return true;
  }
  return randomByte(random) < odds;
}

/** Every {RAM:...} placeholder in a cartridge line, replaced with one name. */
export function ramFill(text: string, name: string): string {
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
    out = out.substring(0, start) + name + out.substring(end + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Building a battle
// ---------------------------------------------------------------------------

function makeSide(party: BattleMon[], index: number, badgeBits: number,
                  isPlayer: boolean, trainerId: string): BattleSide {
  return {
    active: sendOut(party[index], badgeBits),
    party: party,
    activeIndex: index,
    badgeBits: badgeBits,
    isPlayer: isPlayer,
    trainerId: trainerId,
    escapeAttempts: 0,
  };
}

/** A new side object with `party` and `active` replaced, everything else kept. */
function withParty(side: BattleSide, party: BattleMon[], active: BattleMon): BattleSide {
  return {
    active: active,
    party: party,
    activeIndex: side.activeIndex,
    badgeBits: side.badgeBits,
    isPlayer: side.isPlayer,
    trainerId: side.trainerId,
    escapeAttempts: side.escapeAttempts,
  };
}

/**
 * A wild encounter. `party` is the player's, in party order; the first Pokemon
 * with HP is sent out, which is what the overworld does when the grass rustles.
 */
/**
 * What the cartridge prints for a side's trainer. The foe's class name comes out
 * of the bundle (JR.TRAINER\u2642, BROCK, LANCE); the rival's three classes print
 * the rival's given name, because RIVAL1 is a class and not a name; the player's
 * side prints the player's name. The raw OPP_ id shows only when the bundle has
 * no row for it, which is a bundle fault and should look like one.
 */
export function trainerDisplayName(ctx: BattleContext, side: BattleSide): string {
  const names = ctx.names;
  if (side.isPlayer) {
    return names && names.player ? names.player : "RED";
  }
  if (side.trainerId === "") {
    return "The foe";
  }
  if (side.trainerId.indexOf("OPP_RIVAL") === 0) {
    return names && names.rival ? names.rival : "RIVAL";
  }
  const row = ctx.bundle && ctx.bundle.trainers ? ctx.bundle.trainers[side.trainerId] : null;
  return row && row.name ? row.name : side.trainerId;
}

/**
 * TrainerClassMoveChoiceModifications for the foe's class, out of the bundle:
 * the layers the AI scores moves with (1 avoids a second status, 2 favours a
 * stat-up on the second turn, 3 favours the super-effective move). A wild
 * Pokemon, or a class the bundle has no row for, gets no layers, which is a
 * uniform pick among the live slots, exactly as the cartridge does for them.
 */
export function moveChoiceMods(ctx: BattleContext): number[] {
  if (ctx.isWild || ctx.foe.trainerId === "") {
    return [];
  }
  const row = ctx.bundle && ctx.bundle.trainers ? ctx.bundle.trainers[ctx.foe.trainerId] : null;
  return row && row.aiMods && row.aiMods.length ? row.aiMods : [];
}

/** The item's name as the cartridge prints it (FULL HEAL, not FULL_HEAL). */
export function itemDisplayName(bundle: any, itemId: string): string {
  const row = bundle && bundle.items ? bundle.items[itemId] : null;
  return row && row.name ? row.name : itemId;
}

export function startWildBattle(
  bundle: any,
  party: BattleMon[],
  badgeBits: number,
  wild: BattleMon,
  random: () => number,
  ghost?: boolean,
  cantBeCaught?: boolean
): Battle {
  // The restless soul, named by the scope: the opening unveils her.
  const unveiled = cantBeCaught === true && ghost !== true;
  const lead = firstHealthy(party);
  if (lead < 0) {
    throw new Error("battle: the party has nothing to send out");
  }
  const ctx: BattleContext = {
    bundle: bundle,
    player: makeSide(party, lead, badgeBits, true, ""),
    foe: makeSide([wild], 0, 0, false, ""),
    isWild: true,
    turn: 1,
    random: random,
    // Decided before the first line is written: the opening IS different for a
    // ghost, so this cannot be set on the battle afterwards.
    ghost: ghost === true,
    cantBeCaught: cantBeCaught === true,
    unveiled: unveiled,
  };
  return new Battle(ctx);
}

/**
 * A SAFARI ZONE encounter (script/Safari.ts).
 *
 * A wild battle with the fighting taken out: neither side has a move, the menu
 * is BALL / BAIT / ROCK / RUN, and the POKeMON decides every turn whether to
 * stay. The catch rate starts as the species' own and is the thing BAIT and
 * ROCK move -- wEnemyMonCatchRate is a byte the cartridge writes over, and
 * restores when the sulking wears off.
 */
export function startSafariBattle(
  bundle: any,
  party: BattleMon[],
  badgeBits: number,
  wild: BattleMon,
  random: () => number
): Battle {
  const lead = firstHealthy(party);
  if (lead < 0) {
    throw new Error("battle: the party has nothing to send out");
  }
  const species = bundle.species ? bundle.species[wild.species] : null;
  const ctx: BattleContext = {
    bundle: bundle,
    player: makeSide(party, lead, badgeBits, true, ""),
    foe: makeSide([wild], 0, 0, false, ""),
    isWild: true,
    turn: 1,
    random: random,
    safari: true,
    safariRate: species && typeof species.catchRate === "number" ? species.catchRate : 0,
    safariEating: 0,
    safariAngry: 0,
  };
  return new Battle(ctx);
}

/**
 * A trainer battle. Neither side can run and neither side can be caught, and the
 * foe sends out its next Pokemon as each one falls.
 *
 * The per-turn trainer AI -- Ai.classAction's items and switches -- is NOT wired
 * in yet: the foe attacks every turn. Ai.ts has the whole of it and this is where
 * it plugs in, at the moment the foe's slot in the turn order comes up.
 */
export function startTrainerBattle(
  bundle: any,
  party: BattleMon[],
  badgeBits: number,
  foeParty: BattleMon[],
  trainerId: string,
  random: () => number,
  names?: BattleNames
): Battle {
  const lead = firstHealthy(party);
  const foeLead = firstHealthy(foeParty);
  if (lead < 0 || foeLead < 0) {
    throw new Error("battle: a side has nothing to send out");
  }
  const ctx: BattleContext = {
    bundle: bundle,
    player: makeSide(party, lead, badgeBits, true, ""),
    foe: makeSide(foeParty, foeLead, 0, false, trainerId),
    names: names,
    isWild: false,
    turn: 1,
    random: random,
  };
  return new Battle(ctx);
}

// ---------------------------------------------------------------------------
// The battle
// ---------------------------------------------------------------------------

export class Battle {
  ctx: BattleContext;
  phase: string = PHASE_CHOOSE;
  result: string = RESULT_ONGOING;
  turn: number = 1;
  log: string[] = [];
  caught: string = "";
  /** Set only when a catch went to the box; see BattleOutcome.caughtMon. */
  private caughtMon: BattleMon = null;
  private caughtToBox: number = 0;
  /**
   * Room in the player's current PC box, and which box it is. Handed in by
   * setBoxSpace, because the box lives in the PlayState and the engine may not
   * know what a save is. 0/0 -- the default -- means "no box at all", which is
   * the pre-box behaviour: a full party then refuses the throw.
   */
  private boxSpace: number = 0;
  private boxNumber: number = 0;

  /** wPartyGainExpFlags: who has been in against the Pokemon now on the field. */
  private flags: boolean[];
  /** How many move selections the foe's current Pokemon has made. Layer 2's input. */
  private foeSelections: number = 0;
  /** wDamage and the Pay Day purse live here for the whole battle. */
  private env: MoveEnv;
  /** This turn's lines, also appended to `log`. */
  private said: string[] = [];
  /** Experience for the Pokemon currently down has already been paid. */
  private paidFor: boolean = false;
  /** Level-up moves waiting on "which one do you forget?". */
  private readonly pending: PendingLearn[] = [];
  /** The item this turn used up, cleared when the turn is reported. */
  private consumedThisTurn: string = "";

  /**
   * The trainer's behaviour class, and how many items they have left.
   *
   * The ROM gives each class a fixed allowance and never refills it, which is why
   * a Gym Leader stops healing after a while and why grinding one down is a real
   * strategy rather than a war of attrition against an infinite bag.
   */
  private aiClass: AiClass = null;
  private aiUsesLeft: number = 0;

  constructor(ctx: BattleContext) {
    this.ctx = ctx;
    if (!ctx.isWild && ctx.foe.trainerId !== "") {
      this.aiClass = aiClassFor(ctx.foe.trainerId);
      this.aiUsesLeft = this.aiClass ? this.aiClass.uses : 0;
    }
    this.flags = markParticipant(newParticipants(ctx.player.party.length), ctx.player.activeIndex);
    this.env = moveEnv(ctx, true);
    // PrintBeginningBattleText (common_text.asm:31-60): an unidentified ghost
    // has no cry and is not named, it simply "appeared" and cannot be ID'd.
    if (ctx.ghost === true) {
      this.line(ramFill(romText(ctx.bundle, TEXT_APPEARED), ctx.foe.active.name));
      this.line(romText(ctx.bundle, TEXT_CANT_BE_IDD));
    } else {
      if (ctx.unveiled === true) {
        // .isMarowak with the scope in the bag: she arrives as the ghost, the
        // scope names her (MarowakAnim is the lens's to draw), and only then
        // is she a wild MAROWAK.
        this.line(ramFill(romText(ctx.bundle, TEXT_APPEARED), GHOST_NAME));
        this.line(romText(ctx.bundle, TEXT_UNVEILED));
      }
      this.line(ctx.isWild
        ? ramFill(romText(ctx.bundle, "_WildMonAppearedText"), ctx.foe.active.name)
        : this.sentOutLine());
    }
    this.line(romText(ctx.bundle, "_GoText") + ctx.player.active.name + "!");
  }

  // -- what the caller reads -------------------------------------------------

  /** The move the player is locked into this turn, or "" when the menu is open. */
  forcedMove(): string {
    return forcedMoveId(this.ctx.player.active);
  }

  /** A wild battle can be run from; a trainer battle cannot. */
  canRun(): boolean {
    return this.ctx.isWild && this.phase === PHASE_CHOOSE;
  }

  /**
   * Tell the engine how much room the PC box has, before the first turn.
   *
   * Without this call a full party still refuses the throw, which is how every
   * suite written before the box behaves and why the default is silence rather
   * than a guess.
   */
  setBoxSpace(free: number, boxNumber: number): void {
    this.boxSpace = free;
    this.boxNumber = boxNumber;
  }

  /** Why a ball cannot be thrown right now, or CATCH_ALLOWED. */
  ballBlockedReason(): string {
    // An unidentified ghost takes the can't-be-caught value rather than the
    // capture calculation (item_effects.asm:149-153); it reads on screen the
    // way a trainer's Pokemon batting the ball away does.
    if (this.ctx.ghost === true || this.ctx.cantBeCaught === true) {
      return CATCH_DODGED;
    }
    return catchBlockedReason(this.ctx.isWild, partyIsFull(this.ctx.player.party), this.boxSpace);
  }

  /** The party as it stands, with the active Pokemon folded back into its slot. */
  party(): BattleMon[] {
    return benchActive(this.ctx.player);
  }

  outcome(): BattleOutcome {
    return {
      result: this.result,
      party: this.party(),
      caught: this.caught,
      caughtMon: this.caughtMon,
      caughtToBox: this.caughtToBox,
      payDay: this.env.payDay,
      turns: this.turn,
      log: this.log,
    };
  }

  // -- the turn --------------------------------------------------------------

  /**
   * Play one turn. In PHASE_REPLACE only ACTION_SWITCH is accepted, and it does
   * not give the foe a free attack -- the cartridge sends the replacement out
   * between rounds, not during one.
   *
   * A Pokemon locked into Bide, Thrash, a trapping move or a stored charge has no
   * menu in Generation 1, so `action` is ignored entirely on those turns.
   */
  takeTurn(action: TurnAction): TurnReport {
    this.said = [];
    if (this.phase === PHASE_OVER) {
      return this.report(false, null, null, null, null);
    }
    if (this.phase === PHASE_REPLACE) {
      return this.replacement(action);
    }
    this.ctx.turn = this.turn;
    if (this.ctx.safari === true) {
      return this.safariTurn(action);
    }

    const locked = forcedKind(this.ctx.player.active) !== FORCED_NONE;
    const chosen: TurnAction = locked
      ? { kind: ACTION_MOVE, moveIndex: -1, partyIndex: -1, item: "" }
      : action;
    if (chosen.kind !== ACTION_MOVE && chosen.kind !== ACTION_SWITCH &&
        chosen.kind !== ACTION_ITEM && chosen.kind !== ACTION_RUN) {
      return this.report(false, null, null, null, null);
    }

    // What each side is committed to before anything resolves. The foe selects
    // here, not when its slot comes up, because the order depends on the move.
    const playerPlan = this.planFor(true, chosen);
    const foePlan = this.planFor(false, null);
    const order = decideOrder(this.ctx, chosen, playerPlan.moveId, foePlan.moveId);

    // Whether the trainer reaches for an item or swaps instead of attacking. The
    // roll happens HERE, after the move selection, because that is the order the
    // cartridge rolls in: MainInBattleLoop calls SelectEnemyMove near the top and
    // only reaches TrainerAI at the enemy's slot in the turn order. Reading the
    // item gate first would shift every subsequent number in the stream.
    const aiAction = this.trainerAction();

    let playerResult: MoveResult = null;
    let foeResult: MoveResult = null;
    let ball: CatchResult = null;

    for (let step = 0; step < 2; step++) {
      const playersStep = order.playerFirst ? step === 0 : step === 1;
      if (playersStep) {
        if (chosen.kind === ACTION_MOVE) {
          playerResult = this.act(true, playerPlan);
        } else {
          ball = this.playerAction(chosen);
        }
      } else if (aiAction !== null) {
        // `jr c, .AIActionUsed` skips the CALL to ExecuteEnemyMove and nothing
        // else: the trainer loses its attack, the player still gets its move,
        // and the round ends normally. Costing the player their turn too would
        // make every item the trainer holds worth two turns instead of one.
        this.foeAiAction(aiAction);
      } else {
        foeResult = this.act(false, foePlan);
      }
      if (this.result !== RESULT_ONGOING) {
        break;
      }
      // A faint stops the round where it stands: the cartridge jumps out of
      // MainInBattleLoop rather than letting the other side answer.
      if (this.ctx.player.active.hp <= 0 || this.ctx.foe.active.hp <= 0) {
        break;
      }
    }

    if (this.result === RESULT_ONGOING) {
      this.endOfTurn();
      this.settleFaints();
    }
    if (this.result === RESULT_ONGOING) {
      this.turn = this.turn + 1;
      if (this.turn > MAX_TURNS) {
        this.finish(RESULT_STALLED, "The battle stalled.");
      }
    }
    return this.report(true, playerResult, foeResult, order, ball);
  }

  // -- planning --------------------------------------------------------------

  /**
   * The move a side will use, and the slot it comes out of. A forced move keeps
   * its slot at -1 because it costs no PP: Generation 1 charges for the turn a
   * move is chosen and never for the turns that move owns afterwards.
   */
  private planFor(isPlayer: boolean, action: TurnAction): MovePlan {
    const side = isPlayer ? this.ctx.player : this.ctx.foe;
    const mon = side.active;
    const kind = forcedKind(mon);
    if (kind !== FORCED_NONE) {
      return { moveId: forcedMoveId(mon), slot: -1, kind: kind };
    }
    if (heldInPlace(mon)) {
      return { moveId: "", slot: -1, kind: FORCED_NONE };
    }
    let slot = -1;
    if (isPlayer) {
      if (action === null || action.kind !== ACTION_MOVE) {
        return { moveId: "", slot: -1, kind: FORCED_NONE };
      }
      slot = action.moveIndex;
      if (slot < 0 || slot >= mon.moves.length || mon.moves[slot].id === "" ||
          mon.moves[slot].pp <= 0 || slot === mon.volatile.disabledSlot) {
        slot = firstUsableSlot(mon);
      }
    } else {
      slot = chooseMove(this.ctx, moveChoiceMods(this.ctx), this.foeSelections);
      this.foeSelections = this.foeSelections + 1;
      if (slot === AI_STRUGGLE || slot < 0 || slot >= mon.moves.length ||
          mon.moves[slot].id === "") {
        slot = -1;
      } else if (mon.moves[slot].pp <= 0) {
        // SelectEnemyMove never reads the foe's PP, so a foe out of PP on the slot
        // it rolled would use the move anyway. It cannot here: a battle that can
        // never end is worse than a foe that reaches for Struggle a turn early.
        slot = firstUsableSlot(mon);
      }
    }
    if (slot < 0) {
      return { moveId: STRUGGLE, slot: -1, kind: FORCED_NONE };
    }
    return { moveId: mon.moves[slot].id, slot: slot, kind: FORCED_NONE };
  }

  /**
   * What the trainer does instead of attacking this turn, or null to attack.
   *
   * Wild Pokemon have no class and never reach here. A trainer whose allowance is
   * spent, or whose class rolls nothing, also returns null.
   */
  private trainerAction(): TurnAction {
    if (this.aiClass === null || this.aiUsesLeft <= 0) {
      return null;
    }
    const action = classAction(this.ctx, this.aiClass, this.aiUsesLeft);
    if (action.kind === ACTION_ITEM || action.kind === ACTION_SWITCH) {
      return action;
    }
    return null;
  }

  /**
   * The trainer spends its attack on an item or a switch. This is the whole of
   * what `jr c` skips in MainInBattleLoop -- the enemy's move -- so it returns
   * nothing and the round carries on around it.
   */
  private foeAiAction(action: TurnAction): void {
    this.aiUsesLeft = this.aiUsesLeft - 1;

    if (action.kind === ACTION_SWITCH) {
      const leaving = this.ctx.foe.active.name;
      const result = switchTo(this.ctx.foe, action.partyIndex);
      if (result.ok) {
        this.ctx.foe = result.side;
        this.foeSelections = 0;
        this.line(trainerDisplayName(this.ctx, this.ctx.foe) + " withdrew " + leaving + "!");
        this.line(this.sentOutLine());
      }
      return;
    }

    const effect = itemEffect(action.item);
    const mon = this.ctx.foe.active;
    const changed = applyItemEffect(mon, effect);
    // The line is gated on HP HAVING RISEN, not on the effect having done
    // something: a FULL_RESTORE on a full-HP but statused Pokemon changes
    // something and must not claim to have healed.
    if (changed.healed > 0) {
      this.line("Enemy " + mon.name + " recovered health!");
    }
    this.line(trainerDisplayName(this.ctx, this.ctx.foe) + " used " +
                  itemDisplayName(this.ctx.bundle, effect.item) + "!");
  }

  // -- acting ----------------------------------------------------------------

  /** One side's move: the status gauntlet, the move itself, then its residuals. */
  private act(isPlayer: boolean, plan: MovePlan): MoveResult {
    const side = isPlayer ? this.ctx.player : this.ctx.foe;
    if (side.active.hp <= 0) {
      return null;
    }
    if (!this.canAct(isPlayer, plan.slot)) {
      this.residuals(isPlayer);
      return null;
    }
    // PrintGhostText (:3281-3300), after the status gauntlet and before the
    // move: neither side does anything. The player is too scared; the ghost
    // only tells them to get out.
    if (this.ctx.ghost === true) {
      this.line(isPlayer
        ? this.about(this.ctx.bundle, TEXT_SCARED, this.active(true), true)
        : romText(this.ctx.bundle, TEXT_GET_OUT));
      this.residuals(isPlayer);
      return null;
    }
    // CheckForDisobedience, where ExecutePlayerMove runs it: after the status
    // gauntlet, before the move -- and not for a charging move's second turn
    // (`bit CHARGING_UP` jumps past it). Only a move the player picked this
    // turn, only a traded Pokemon, only above the badge ladder.
    if (isPlayer && plan.kind === FORCED_NONE && plan.slot >= 0 &&
        this.ctx.playerId > 0 && isTraded(this.active(isPlayer), this.ctx.playerId)) {
      const mon = this.active(isPlayer);
      const roll = rollDisobedience(mon, side.badgeBits, this.ctx.random, plan.slot,
                                    plan.moveId === "", mon.volatile.disabledSlot);
      if (roll.outcome === OBEY_RANDOM) {
        plan = { moveId: mon.moves[roll.slot].id, slot: roll.slot, kind: plan.kind };
      } else if (roll.outcome !== OBEY_USE) {
        if (roll.outcome === OBEY_NAP) {
          mon.status = STATUS_SLEEP;
          mon.sleepTurns = roll.sleepTurns;
        }
        this.line(this.about(this.ctx.bundle, roll.textId, mon, isPlayer));
        if (roll.outcome === OBEY_HIT) {
          this.selfHit(isPlayer);
        }
        this.residuals(isPlayer);
        return null;
      }
    }
    if (plan.slot >= 0) {
      const slot = this.active(isPlayer).moves[plan.slot];
      slot.pp = slot.pp > 0 ? slot.pp - 1 : 0;
    }
    const env = this.aim(isPlayer);
    // "<NAME>\nused <MOVE>!", built the way the cartridge builds it, out of the
    // cartridge's own three fragments. Moves.ts prints what a move DOES and never
    // announces it, because announcing it is a turn-sequencing job: a trapping
    // continuation says "attack continues!" instead, and a Pokemon that never got
    // past the status gauntlet says nothing at all.
    if (plan.kind !== FORCED_TRAP) {
      this.line(this.usedLine(isPlayer, plan.moveId === "" ? STRUGGLE : plan.moveId));
    }
    let result: MoveResult;
    if (plan.kind === FORCED_BIDE) {
      result = continueBide(env);
    } else if (plan.kind === FORCED_TRAP) {
      result = continueTrapping(env);
    } else {
      result = useMove(env, plan.moveId === "" ? STRUGGLE : plan.moveId);
    }
    this.append(result.messages);
    if (env.battleEnded) {
      env.battleEnded = false;
      // Teleport removes the USER; Roar and Whirlwind remove the TARGET. Reading
      // it off the user alone gets two of the three backwards, and the cartridge's
      // own lines say which: "{TARGET} was blown away!" against "{USER} ran from
      // battle!". Whoever is gone decides whether the player fled or the foe did.
      const removesTarget = plan.moveId === "ROAR" || plan.moveId === "WHIRLWIND";
      const playerLeft = removesTarget ? !isPlayer : isPlayer;
      this.finish(playerLeft ? RESULT_FLED : RESULT_FOE_FLED, "");
      return result;
    }
    this.residuals(isPlayer);
    return result;
  }

  /**
   * CheckPlayerStatusConditions, in the cartridge's order, with the rungs
   * Status.ts does not own spliced in where they belong. False means the turn is
   * spent; the messages are already on the log.
   */
  private canAct(isPlayer: boolean, slot: number): boolean {
    const bundle = this.ctx.bundle;
    const side = isPlayer ? this.ctx.player : this.ctx.foe;

    const early = sleepFreezeCheck(bundle, side.active);
    this.setActive(isPlayer, early.mon);
    this.append(early.messages);
    if (!early.canMove) {
      return false;
    }

    let mon = this.active(isPlayer);
    if (heldInPlace(mon)) {
      this.line(this.about(bundle, "_CantMoveText", mon, isPlayer));
      return false;
    }
    if (mon.volatile.flinched) {
      mon.volatile.flinched = false;
      this.line(this.about(bundle, "_FlinchedText", mon, isPlayer));
      return false;
    }
    if (mon.volatile.recharging) {
      mon.volatile.recharging = false;
      this.line(this.about(bundle, "_MustRechargeText", mon, isPlayer));
      return false;
    }
    this.tickDisable(isPlayer);

    const confused = confusionCheck(bundle, this.active(isPlayer), this.ctx.random);
    this.setActive(isPlayer, confused.mon);
    this.append(confused.messages);
    if (confused.selfHit) {
      this.selfHit(isPlayer);
      return false;
    }
    if (!confused.canMove) {
      return false;
    }

    mon = this.active(isPlayer);
    if (slot >= 0 && slot === mon.volatile.disabledSlot) {
      this.line(this.about(bundle, "_MoveIsDisabledText", mon, isPlayer));
      return false;
    }

    const paralysed = paralysisCheck(bundle, mon, this.ctx.random);
    this.setActive(isPlayer, paralysed.mon);
    this.append(paralysed.messages);
    return paralysed.canMove;
  }

  /**
   * A confused Pokemon hitting itself. It goes through the ordinary damage path,
   * so a Substitute takes it, and it is scored against the OPPONENT's Reflect --
   * Status.confusionSelfHitDamage owns that bug, this only feeds it the right
   * flag. The hit writes the shared damage word, as every damage calculation does.
   */
  private selfHit(isPlayer: boolean): void {
    const env = this.aim(isPlayer);
    const damage = confusionSelfHitDamage(env.user, env.target.volatile.reflect, this.ctx.random);
    const result = emptyResult("");
    env.lastDamage = damage;
    applyDamageTo(env, true, damage, result);
    this.append(result.messages);
  }

  /** Disable's countdown, the rung between the recharge and confusion. */
  private tickDisable(isPlayer: boolean): void {
    const mon = this.active(isPlayer);
    if (mon.volatile.disabledTurns <= 0) {
      return;
    }
    mon.volatile.disabledTurns = mon.volatile.disabledTurns - 1;
    if (mon.volatile.disabledTurns <= 0) {
      mon.volatile.disabledSlot = -1;
      this.line(this.about(this.ctx.bundle, "_DisabledNoMoreText", mon, isPlayer));
    }
  }

  // -- the SAFARI ZONE -------------------------------------------------------

  /**
   * One turn of a SAFARI ZONE battle.
   *
   * The order is the cartridge's: what the player throws, then what the
   * POKeMON is doing about the last thing they threw ($4277), then whether it
   * has had enough and bolts ($4182). A ball that catches ends it before
   * either, and RUN always works.
   */
  private safariTurn(action: TurnAction): TurnReport {
    let ball: CatchResult = null;
    if (action.kind === ACTION_RUN) {
      // .runAway in a Safari battle is unconditional: no speed check, no
      // escape counter, no "can't escape!".
      this.line(romText(this.ctx.bundle, "_GotAwayText"));
      this.finish(RESULT_FLED, "");
      return this.report(true, null, null, null, null);
    }
    if (action.kind === ACTION_ITEM) {
      ball = this.throwBall(action.item);
      if (this.phase === PHASE_OVER) {
        return this.report(true, null, null, null, ball);
      }
    } else if (action.kind === ACTION_BAIT) {
      this.line(romText(this.ctx.bundle, TEXT_THREW_BAIT));
      this.ctx.safariRate = baitCatchRate(this.ctx.safariRate);
      this.ctx.safariAngry = 0;
      this.ctx.safariEating = addTurns(this.ctx.safariEating, this.rollTurns());
    } else if (action.kind === ACTION_ROCK) {
      this.line(romText(this.ctx.bundle, TEXT_THREW_ROCK));
      this.ctx.safariRate = rockCatchRate(this.ctx.safariRate);
      this.ctx.safariEating = 0;
      this.ctx.safariAngry = addTurns(this.ctx.safariAngry, this.rollTurns());
    } else {
      return this.report(false, null, null, null, null);
    }

    const doing = safariTurnText(this.ctx.safariEating, this.ctx.safariAngry);
    this.ctx.safariEating = doing.eating;
    this.ctx.safariAngry = doing.angry;
    if (doing.restore) {
      const species = this.ctx.bundle.species
        ? this.ctx.bundle.species[this.ctx.foe.active.species] : null;
      this.ctx.safariRate = species && typeof species.catchRate === "number"
        ? species.catchRate : 0;
    }
    if (doing.textId !== "") {
      this.line(ramFill(romText(this.ctx.bundle, doing.textId),
                        displayName(this.ctx.foe.active, false)));
    }

    const speed = this.foeBaseSpeed();
    if (safariEscapes(speed, this.ctx.safariEating, this.ctx.safariAngry,
                      randomByte(this.ctx.random))) {
      this.line(ramFill(romText(this.ctx.bundle, "_WildRanText"),
                        displayName(this.ctx.foe.active, false)));
      this.finish(RESULT_FOE_FLED, "");
    }
    this.turn = this.turn + 1;
    return this.report(true, null, null, null, ball);
  }

  /** 1 to 5, the cartridge re-rolling anything above four ($5F89). */
  private rollTurns(): number {
    for (let i = 0; i < 64; i++) {
      const turns = safariTurns(randomByte(this.ctx.random));
      if (turns > 0) {
        return turns;
      }
    }
    return 1;
  }

  /** The species' own base SPEED, which is what the escape chance is built on. */
  private foeBaseSpeed(): number {
    const species = this.ctx.bundle.species
      ? this.ctx.bundle.species[this.ctx.foe.active.species] : null;
    const base = species ? species.baseStats : null;
    return base && typeof base.speed === "number" ? base.speed : 0;
  }

  // -- the player's non-move actions -----------------------------------------

  private playerAction(action: TurnAction): CatchResult {
    if (action.kind === ACTION_RUN) {
      this.runAway();
      return null;
    }
    if (action.kind === ACTION_SWITCH) {
      this.switchPlayer(action.partyIndex);
      return null;
    }
    // Not every item is a ball. This used to throw whatever the player reached
    // for -- a Potion, an X Attack, a Full Heal -- at the wild Pokemon, which
    // made a bag decorative at best and destructive at worst.
    //
    // The heal path is the one the trainer AI has always used: itemEffect is
    // transcribed once and applied to whichever side reached for the item. A
    // player's Potion and Brock's Potion are the same Potion.
    if (this.isBall(action.item)) {
      return this.throwBall(action.item);
    }
    this.useHeldItem(action.item, action.partyIndex, action.moveIndex);
    return null;
  }

  /** True when this item is one of the five the catch code accepts. */
  private isBall(item: string): boolean {
    for (let i = 0; i < BALL_IDS.length; i++) {
      if (BALL_IDS[i] === item) {
        return true;
      }
    }
    return false;
  }

  /**
   * A bag item used on one of the player's own Pokemon.
   *
   * `partyIndex` below zero means the Pokemon that is out. Using an item costs
   * the turn -- the foe still attacks -- which is the whole tension of reaching
   * for a Potion at low HP.
   */
  private useHeldItem(item: string, partyIndex: number, moveSlot: number): void {
    const effect = itemEffect(item);
    const onActive = partyIndex < 0 || partyIndex === this.ctx.player.activeIndex;
    const mon = onActive ? this.ctx.player.active : this.ctx.player.party[partyIndex];
    if (!mon) {
      this.line("There is no POKeMON to use it on!");
      return;
    }
    // ETHER, ELIXER, PP UP (PpItems.ts): the move the menu was pointed at
    // rides in on the action's moveIndex. The working Pokemon is written in
    // place, as applyItemEffect writes it.
    if (isPpItem(item)) {
      const pp = usePpItem(this.ctx.bundle, mon, item, moveSlot);
      if (pp.textId === "") {
        this.line(romText(this.ctx.bundle, "_ItemUseNoEffectText"));
        return;
      }
      if (pp.used) {
        this.line(trainerDisplayName(this.ctx, this.ctx.player) + " used " +
                  itemDisplayName(this.ctx.bundle, item) + "!");
        this.consumedThisTurn = item;
        mon.moves = pp.mon.moves;
      }
      const moveDef = pp.move !== "" && this.ctx.bundle.moves ? this.ctx.bundle.moves[pp.move] : null;
      this.line(ramFill(romText(this.ctx.bundle, pp.textId), moveDef && moveDef.name ? moveDef.name : pp.move));
      return;
    }
    if (!canUseItemOn(mon, effect)) {
      this.line("It won't have any effect.");
      return;
    }
    this.line(trainerDisplayName(this.ctx, this.ctx.player) + " used " +
              itemDisplayName(this.ctx.bundle, item) + "!");
    this.consumedThisTurn = item;
    const changed = applyItemEffect(mon, effect);
    if (changed.healed > 0) {
      this.line(mon.name + " recovered health!");
    }
  }

  private runAway(): void {
    const bundle = this.ctx.bundle;
    if (!this.ctx.isWild) {
      this.line(romText(bundle, "_NoRunningText"));
      return;
    }
    // TryRunningFromBattle:1496-1498 -- a ghost lets you go, always, before
    // anything else is asked.
    if (this.ctx.ghost === true) {
      this.line(romText(bundle, "_GotAwayText"));
      this.finish(RESULT_FLED, "");
      return;
    }
    if (heldInPlace(this.ctx.player.active)) {
      this.line(romText(bundle, "_CantEscapeText"));
      return;
    }
    this.ctx.player.escapeAttempts = this.ctx.player.escapeAttempts + 1;
    const escaped = rollEscape(
      this.ctx.player.active.battleStats.speed,
      this.ctx.foe.active.battleStats.speed,
      this.ctx.player.escapeAttempts,
      this.ctx.random
    );
    if (escaped) {
      this.line(romText(bundle, "_GotAwayText"));
      this.finish(RESULT_FLED, "");
      return;
    }
    this.line(romText(bundle, "_CantEscapeText"));
  }

  private switchPlayer(index: number): void {
    const leaving = this.ctx.player.active.name;
    const switched = switchTo(this.ctx.player, index);
    if (!switched.ok) {
      this.line(switched.message);
      return;
    }
    this.ctx.player = switched.side;
    this.flags = markParticipant(this.flags, this.ctx.player.activeIndex);
    this.line(leaving + romText(this.ctx.bundle, "_ComeBackText"));
    this.line(romText(this.ctx.bundle, "_GoText") + this.ctx.player.active.name + "!");
  }

  /** One ball. A failed throw costs the turn; the foe still gets its move. */
  private throwBall(item: string): CatchResult {
    const bundle = this.ctx.bundle;
    let known = false;
    for (let i = 0; i < BALL_IDS.length; i++) {
      if (BALL_IDS[i] === item) {
        known = true;
      }
    }
    if (!known) {
      this.line("There is no " + item + ".");
      return null;
    }
    const blocked = this.ballBlockedReason();
    if (blocked === CATCH_BLOCKED_BOX_FULL) {
      // Nowhere to put another Pokemon at all: refused BEFORE the throw, so
      // the ball stays in the bag (ItemUseBall .checkForBoxFull).
      this.line(romText(bundle, "_BoxFullCannotThrowBallText"));
      return null;
    }
    if (blocked !== CATCH_ALLOWED) {
      // Thrown and wasted. A trainer bats it away (ThrowBallAtTrainerMon ends
      // in RemoveUsedItem); a ghost or the restless soul dodges it (the $10
      // can't-be-caught value, which still reaches .done and the bag). Until
      // 20 September both kept the ball and both said the ghost's line.
      this.consumedThisTurn = item;
      if (blocked === CATCH_BLOCKED_TRAINER) {
        this.line(romText(bundle, "_ThrowBallAtTrainerMonText1"));
        this.line(romText(bundle, "_ThrowBallAtTrainerMonText2"));
      } else {
        this.line(romText(bundle, "_ItemUseBallText00"));
      }
      return null;
    }
    // Past both refusals, so the ball leaves the bag whether or not it holds.
    this.consumedThisTurn = item;
    const override = this.ctx.safari === true && typeof this.ctx.safariRate === "number"
      ? this.ctx.safariRate : -1;
    const thrown = attemptCatch(bundle, item, this.ctx.foe.active, override, this.ctx.random);
    if (!thrown.caught) {
      this.line(shakeMessage(thrown.shakes));
      return thrown;
    }
    const target = this.ctx.foe.active;
    this.caught = target.species;
    this.line(ramFill(romText(bundle, "_ItemUseBallText05"), target.name));
    if (partyIsFull(this.ctx.player.party)) {
      // Six already: the cartridge sends it to the current box and says which.
      // _SentToBoxText carries the nickname AND the box number in two different
      // {RAM:} slots, so ramFill -- which puts one value in every slot -- would
      // read "PIDGEY was sent to POKeMON BOX PIDGEY on PC!".
      this.caughtMon = prepareCaught(bundle, target);
      this.caughtToBox = this.boxNumber;
      this.line(fillSlots(romText(bundle, "_SentToBoxText"),
                          [["wBoxMonNicks", target.name],
                           ["wStringBuffer", "" + this.boxNumber]]));
    } else {
      const joined = receiveCaught(bundle, this.ctx.player.party, target);
      this.ctx.player = withParty(this.ctx.player, joined.party, this.ctx.player.active);
    }
    this.finish(RESULT_CAUGHT, "");
    return thrown;
  }

  // -- end of turn -----------------------------------------------------------

  /**
   * Poison and burn, then Leech Seed, for the side that has just acted. The whole
   * reason this is here and not in an end-of-round block is that Generation 1
   * runs it per move: a poisoned Pokemon that moves first can die before the
   * other side has moved, and then the other side does not move at all.
   */
  private residuals(isPlayer: boolean): void {
    const side = isPlayer ? this.ctx.player : this.ctx.foe;
    if (side.active.hp <= 0) {
      return;
    }
    const tick = residualDamage(this.ctx.bundle, side.active);
    this.setActive(isPlayer, tick.mon);
    this.append(tick.messages);
    if (this.active(isPlayer).hp <= 0) {
      return;
    }
    this.leechSeed(isPlayer);
  }

  /**
   * Leech Seed. No other module implements it, and it is not a copy of the poison
   * tick: it reads and ADVANCES the same badly-poisoned counter, so a Pokemon that
   * is seeded and badly poisoned finishes the turn two steps along instead of one.
   * The HP goes to whichever Pokemon is opposite it now, not to the one that
   * planted the seed.
   */
  private leechSeed(isPlayer: boolean): void {
    const mon = this.active(isPlayer);
    if (!mon.volatile.seeded) {
      return;
    }
    const tick = toxicTick(mon);
    const drain = tick.damage > mon.hp ? mon.hp : tick.damage;
    mon.hp = mon.hp - drain;
    mon.volatile.badlyPoisoned = tick.nextCounter;
    this.line(this.about(this.ctx.bundle, "_HurtByLeechSeedText", mon, isPlayer));
    const other = this.active(!isPlayer);
    const healed = other.hp + drain;
    other.hp = healed > other.maxHp ? other.maxHp : healed;
  }

  /** What is cleared once both sides have acted. */
  private endOfTurn(): void {
    this.ctx.player.active.volatile.flinched = false;
    this.ctx.foe.active.volatile.flinched = false;
  }

  // -- faints ----------------------------------------------------------------

  /**
   * Who is down, and what that means.
   *
   * The player's faint is settled first, because MainInBattleLoop tests it first:
   * a round in which both sides fall still pays the experience out, but a wiped
   * party loses the battle regardless.
   */
  private settleFaints(): void {
    const foeDown = this.ctx.foe.active.hp <= 0;
    const playerDown = this.ctx.player.active.hp <= 0;
    if (!foeDown && !playerDown) {
      return;
    }

    if (playerDown) {
      this.line(this.about(this.ctx.bundle, "_PlayerMonFaintedText",
                           this.ctx.player.active, true));
      this.flags = clearParticipant(this.flags, this.ctx.player.activeIndex);
    }
    if (foeDown) {
      this.line(this.about(this.ctx.bundle, "_EnemyMonFaintedText",
                           this.ctx.foe.active, false));
      this.payExperience();
    }

    if (playerDown && isWiped(this.party())) {
      this.finish(RESULT_LOST, "");
      return;
    }
    if (foeDown) {
      // The next healthy slot has to be looked for in the FOLDED party. Until
      // something benches it, party[activeIndex] is the copy the battle started
      // with -- at full HP -- so asking the raw party finds the Pokemon that just
      // fainted, switchTo refuses "it's already out", and the battle runs forever
      // against a corpse. That is a real bug this file had, and the only reason it
      // never showed is that 1.0 has no trainer battles yet.
      const folded = benchActive(this.ctx.foe);
      const next = this.ctx.isWild ? -1 : firstHealthy(folded);
      const switched = next < 0 ? null : switchTo(this.ctx.foe, next);
      if (switched === null || !switched.ok) {
        this.finish(RESULT_WON, "");
        return;
      }
      this.ctx.foe = switched.side;
      this.foeSelections = 0;
      // wAICount is spent per Pokemon sent out, so the replacement arrives with
      // the class's full allowance. A voluntary switch does NOT refill it: the
      // trainer paid for that switch out of the same allowance, and refilling
      // there would let a Juggler swap on every turn of the battle.
      this.aiUsesLeft = this.aiClass === null ? 0 : this.aiClass.uses;
      this.paidFor = false;
      this.line(this.sentOutLine());
    }
    if (playerDown) {
      this.phase = PHASE_REPLACE;
    }
  }

  /** GainExperience, plus the moves the levels it crossed teach. */
  private payExperience(): void {
    if (this.paidFor) {
      return;
    }
    this.paidFor = true;
    const bundle = this.ctx.bundle;
    const award = awardBattleExperience(
      bundle,
      this.ctx.player,
      this.flags,
      this.ctx.foe.active.species,
      this.ctx.foe.active.level,
      !this.ctx.isWild
    );
    this.ctx.player = award.side;
    for (let i = 0; i < award.awards.length; i++) {
      const slot = award.awards[i];
      const name = this.ctx.player.party[slot.index].name;
      this.line(ramFill(romText(bundle, "_GainedText"), name) +
                fill(romText(bundle, "_ExpPointsText"), "", "", "", slot.gained));
      for (let s = 0; s < slot.steps.length; s++) {
        const step = slot.steps[s];
        this.line(fill(ramFill(romText(bundle, "_GrewLevelText"), name),
                       "", "", "", step.level));
        for (let m = 0; m < step.learned.length; m++) {
          this.teach(slot.index, step.learned[m]);
        }
      }
    }
  }

  /**
   * A move a level-up offers.
   *
   * A free slot is filled here and now. A Pokemon that already has four cannot
   * be: which move to forget is the PLAYER's answer, and this class is pure and
   * synchronous. So it is queued, and whoever is driving the battle asks. Until
   * something asked, a full moveset silently dropped the move -- better than
   * overwriting a slot at random, but still the level-up quietly doing nothing.
   */
  private teach(index: number, moveId: string): void {
    const learned = learnMove(this.ctx.bundle, this.ctx.player.party[index], moveId);
    if (learned.outcome === LEARN_NEEDS_ROOM) {
      this.pending.push({ index: index, moveId: moveId });
      return;
    }
    if (learned.slot < 0) {
      return;
    }
    const party: BattleMon[] = [];
    for (let i = 0; i < this.ctx.player.party.length; i++) {
      party.push(i === index ? learned.mon : this.ctx.player.party[i]);
    }
    const active = this.ctx.player.active;
    if (index === this.ctx.player.activeIndex) {
      active.moves = learned.mon.moves;
    }
    this.ctx.player = withParty(this.ctx.player, party, active);
    const name = learned.mon.name;
    // The move's NAME, not its id: "TAIL WHIP", which the id spells with an
    // underscore. Seen on the first Yellow rival fight, 19 September.
    const def = this.ctx.bundle.moves ? this.ctx.bundle.moves[moveId] : null;
    const line = romText(this.ctx.bundle, "_LearnedMove1Text")
      .split("{RAM:wLearnMoveMonName}").join(name)
      .split("{RAM:wStringBuffer}").join(def && def.name ? def.name : moveId);
    this.line(line);
  }

  /**
   * The next move a level-up wants to teach a full moveset, or null.
   *
   * Popped rather than read: the caller that takes one owes an `applyLearn`
   * for it, and leaving it on the queue would ask the same question forever.
   */
  takePendingLearn(): PendingLearn {
    if (this.pending.length === 0) {
      return null;
    }
    return this.pending.shift();
  }

  /** True while a level-up is still waiting on the player. */
  hasPendingLearn(): boolean {
    return this.pending.length > 0;
  }

  /**
   * The player's answer to one of those.
   *
   * `slot` below zero is "keep what you have", which the cartridge also allows
   * and which is why this returns nothing to say: MoveLearnController has
   * already said all of it, in the ROM's own words.
   */
  applyLearn(index: number, moveId: string, slot: number): void {
    if (slot < 0 || index < 0 || index >= this.ctx.player.party.length) {
      return;
    }
    const replaced = replaceMove(this.ctx.bundle, this.ctx.player.party[index],
                                 slot, moveId);
    if (replaced.slot < 0) {
      return;
    }
    const party: BattleMon[] = [];
    for (let i = 0; i < this.ctx.player.party.length; i++) {
      party.push(i === index ? replaced.mon : this.ctx.player.party[i]);
    }
    const active = this.ctx.player.active;
    // The Pokemon that is OUT is a separate copy from its party slot, so a
    // move learned by the active one has to be written to both or it is
    // forgotten again the moment the battle folds the party back.
    if (index === this.ctx.player.activeIndex) {
      active.moves = replaced.mon.moves;
    }
    this.ctx.player = withParty(this.ctx.player, party, active);
  }

  /** The replacement turn after a faint. The foe does not get to answer it. */
  private replacement(action: TurnAction): TurnReport {
    if (action.kind !== ACTION_SWITCH) {
      return this.report(false, null, null, null, null);
    }
    const switched = switchTo(this.ctx.player, action.partyIndex);
    if (!switched.ok) {
      this.line(switched.message);
      return this.report(false, null, null, null, null);
    }
    this.ctx.player = switched.side;
    this.flags = markParticipant(this.flags, this.ctx.player.activeIndex);
    this.line(romText(this.ctx.bundle, "_GoText") + this.ctx.player.active.name + "!");
    this.phase = PHASE_CHOOSE;
    this.turn = this.turn + 1;
    return this.report(true, null, null, null, null);
  }

  // -- plumbing --------------------------------------------------------------

  private active(isPlayer: boolean): BattleMon {
    return isPlayer ? this.ctx.player.active : this.ctx.foe.active;
  }

  private setActive(isPlayer: boolean, mon: BattleMon): void {
    if (isPlayer) {
      this.ctx.player.active = mon;
    } else {
      this.ctx.foe.active = mon;
    }
  }

  /**
   * The one MoveEnv, re-pointed. It is not rebuilt because `lastDamage` is the
   * shared damage word Counter reads and `payDay` is the purse: both have to
   * outlive the move that wrote them.
   */
  private aim(userIsPlayer: boolean): MoveEnv {
    const us = userIsPlayer ? this.ctx.player : this.ctx.foe;
    const them = userIsPlayer ? this.ctx.foe : this.ctx.player;
    this.env.user = us.active;
    this.env.target = them.active;
    this.env.userSide = us;
    this.env.targetSide = them;
    this.env.callDepth = 0;
    return this.env;
  }

  /**
   * "<TRAINER> sent out <MON>!" The line carries two different RAM placeholders,
   * so it cannot go through ramFill, which fills every one of them with the same
   * name. The trainer is named the way the cartridge names him: by class, by the
   * rival's given name, never by the OPP_ id.
   */
  private sentOutLine(): string {
    const side = this.ctx.foe;
    return romText(this.ctx.bundle, "_TrainerSentOutText")
      .split("{RAM:wTrainerName}").join(trainerDisplayName(this.ctx, side))
      .split("{RAM:wEnemyMonNick}").join(side.active.name);
  }

  /**
   * The announcement, assembled from _UsedMove1Text and _EndUsedMove1Text -- the
   * ROM stores it as three pieces because it prints a name, then a fragment, then
   * a move name out of a different table. A move id with no row in the table falls
   * back to the id, which is only ever a bundle fault.
   */
  private usedLine(isPlayer: boolean, moveId: string): string {
    const side = isPlayer ? this.ctx.player : this.ctx.foe;
    const def = this.ctx.bundle.moves ? this.ctx.bundle.moves[moveId] : null;
    return displayName(side.active, isPlayer) +
      romText(this.ctx.bundle, "_UsedMove1Text") +
      (def && def.name ? def.name : moveId) +
      romText(this.ctx.bundle, "_EndUsedMove1Text");
  }

  /** A cartridge line about one Pokemon, with its name already in place. */
  private about(bundle: any, id: string, mon: BattleMon, isPlayer: boolean): string {
    const shown = displayName(mon, isPlayer);
    return ramFill(fill(romText(bundle, id), shown, shown, mon.name, 0), mon.name);
  }

  private line(text: string): void {
    this.said.push(text);
    this.log.push(text);
  }

  private append(messages: string[]): void {
    for (let i = 0; i < messages.length; i++) {
      this.line(messages[i]);
    }
  }

  /**
   * The battle is over. Both parties are folded here so that `ctx.player.party`
   * and `ctx.foe.party` are true afterwards: until something benches it, a side's
   * party slot still holds the copy the battle STARTED with, at full HP, and a
   * caller that reads the array directly is reading history. `active` deliberately
   * keeps the fainted Pokemon, because the cartridge leaves it on the field until
   * the message box is done with its name.
   */
  private finish(result: string, message: string): void {
    if (message !== "") {
      this.line(message);
    }
    this.ctx.player = withParty(this.ctx.player, benchActive(this.ctx.player),
                                this.ctx.player.active);
    this.ctx.foe = withParty(this.ctx.foe, benchActive(this.ctx.foe), this.ctx.foe.active);
    this.result = result;
    this.phase = PHASE_OVER;
  }

  private report(ok: boolean, playerMove: MoveResult, foeMove: MoveResult,
                 order: TurnOrderResult, ball: CatchResult): TurnReport {
    const consumed = this.consumedThisTurn;
    this.consumedThisTurn = "";
    return {
      ok: ok,
      itemConsumed: consumed,
      messages: this.said,
      playerMove: playerMove,
      foeMove: foeMove,
      order: order,
      ball: ball,
      ended: this.phase === PHASE_OVER,
      result: this.result,
    };
  }
}
