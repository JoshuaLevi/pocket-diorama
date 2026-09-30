// Who moves first, and why.
//
// Generation 1 has no priority field on a move. engine/battle/core.asm's
// MainInBattleLoop hard-codes two move ids and then compares Speed:
//
//   player QUICK_ATTACK, foe QUICK_ATTACK  -> compare Speed
//   player QUICK_ATTACK, foe anything else -> player first
//   foe QUICK_ATTACK, player anything else -> foe first
//   player COUNTER, foe COUNTER            -> compare Speed
//   player COUNTER, foe anything else      -> foe first
//   foe COUNTER, player anything else      -> player first
//   otherwise                              -> compare Speed
//
// That ladder is exactly sign(priority(player) - priority(foe)) with Quick Attack
// at +1, Counter at -1 and everything else at 0, so this module models it as a
// number. Check the Counter-versus-Quick-Attack corner if you ever change it: the
// ROM resolves it in the Quick Attack branch, before Counter is ever considered,
// and the numeric model has to agree.
//
// Speed itself is BattleMon.battleStats.speed -- wBattleMonSpeed and
// wEnemyMonSpeed, the working stats. Stat stages, badge boosts and the paralysis
// quarter are all already inside that number, applied by Stats.battleStatsFor and
// Stats.applyStatusDrops; this module deliberately does not re-derive any of them,
// because the ROM compares the stored value and nothing else.

import type { BattleContext, BattleMon, TurnAction } from "./types";
import { ACTION_MOVE, STATUS_PARALYSIS } from "./types";
import { randomByte } from "./Damage";

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/** The only move Gen 1 lets go first. */
export const MOVE_QUICK_ATTACK: string = "QUICK_ATTACK";

/** The only move Gen 1 makes go last. */
export const MOVE_COUNTER: string = "COUNTER";

export const PRIORITY_QUICK: number = 1;
export const PRIORITY_NORMAL: number = 0;
export const PRIORITY_COUNTER: number = -1;

/**
 * Gen 1's whole priority system. `moveId` is a key into bundle.moves, or "" when
 * the side is not using a move at all.
 *
 * This is a table of two, not a data field: the cartridge has no priority byte,
 * and adding one would silently give Gen 2 behaviour to moves that never had it.
 */
export function priorityOf(moveId: string): number {
  if (moveId === MOVE_QUICK_ATTACK) {
    return PRIORITY_QUICK;
  }
  if (moveId === MOVE_COUNTER) {
    return PRIORITY_COUNTER;
  }
  return PRIORITY_NORMAL;
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

/**
 * The Speed the ROM compares: the working battle stat, floored at 1.
 *
 * The paralysis speed drop lives here only in the sense that it is already baked
 * in: Stats.applyStatusDrops quarters battleStats.speed while the status is
 * STATUS_PARALYSIS, and battleStatsFor runs it on every recalculation. So a
 * paralysed Pokemon compares at a quarter Speed without this function knowing
 * anything about paralysis. `paralysisQuarter` below is the same arithmetic,
 * exported so a caller can show the number it would have had.
 *
 * KNOWN GAP, stated rather than papered over: in the real cartridge the quarter is
 * applied once, when paralysis lands and on switch-in, and CalculateModifiedStat
 * recomputes a stat-stage change from the unmodified Speed WITHOUT re-applying it
 * -- so in Gen 1, Haze or any Speed stage change lifts the paralysis drop until
 * the status is re-applied. Stats.applyStatusDrops in this engine re-applies the
 * drop on every recalculation, so that quirk is not reproduced. Fixing it needs a
 * flag on VolatileState, which this module does not own.
 */
export function effectiveSpeed(mon: BattleMon): number {
  const speed = mon.battleStats.speed;
  return speed < 1 ? 1 : speed;
}

/** The ROM's paralysis drop: a quarter, truncated, floored at 1. */
export function paralysisQuarter(speed: number): number {
  const quartered = Math.floor(speed / 4);
  return quartered < 1 ? 1 : quartered;
}

/** True when this Pokemon's Speed is currently carrying the paralysis quarter. */
export function isParalysisSlowed(mon: BattleMon): boolean {
  return mon.status === STATUS_PARALYSIS;
}

// ---------------------------------------------------------------------------
// The speed tie
// ---------------------------------------------------------------------------

/**
 * `cp 50 percent + 1` on a fresh BattleRandom byte: 0..127 gives the player the
 * turn, 128..255 gives it to the foe. An even split, unlike almost every other
 * threshold in the AI.
 */
export const SPEED_TIE_THRESHOLD: number = 128;

/** The coin flip a Speed tie comes down to. True when the player goes first. */
export function speedTieGoesToPlayer(random: () => number): boolean {
  return randomByte(random) < SPEED_TIE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Why the order came out the way it did. Useful in a log, and in a test. */
export const ORDER_PLAYER_ACTION: string = "player-action";
export const ORDER_PRIORITY: string = "priority";
export const ORDER_SPEED: string = "speed";
export const ORDER_SPEED_TIE: string = "speed-tie";

export interface TurnOrderResult {
  /** True when the player's action resolves before the foe's. */
  playerFirst: boolean;
  /** One of the ORDER_* constants. */
  reason: string;
  playerSpeed: number;
  foeSpeed: number;
  playerPriority: number;
  foePriority: number;
}

/**
 * The order for one turn.
 *
 * `playerAction` decides the first question: in Gen 1 a switch, an item or a run
 * attempt is resolved in the menu phase and the opponent attacks afterwards, so
 * any non-move player action goes first unconditionally. (That is published
 * behaviour rather than a line of assembly transcribed here -- MainInBattleLoop's
 * order ladder only ever sees wPlayerSelectedMove.)
 *
 * `foeMoveId` is the move the foe SELECTED, which is all the ROM has at this
 * point. A trainer AI that ends up using an item or switching instead decides that
 * later, when its slot in this order comes up -- see Ai.classAction. The foe
 * therefore keeps the turn position its selected move earned it, even on a turn it
 * never attacks.
 */
export function decideOrder(
  ctx: BattleContext,
  playerAction: TurnAction,
  playerMoveId: string,
  foeMoveId: string
): TurnOrderResult {
  const playerSpeed = effectiveSpeed(ctx.player.active);
  const foeSpeed = effectiveSpeed(ctx.foe.active);
  const playerPriority = priorityOf(playerMoveId);
  const foePriority = priorityOf(foeMoveId);

  if (playerAction.kind !== ACTION_MOVE) {
    return {
      playerFirst: true,
      reason: ORDER_PLAYER_ACTION,
      playerSpeed: playerSpeed,
      foeSpeed: foeSpeed,
      playerPriority: playerPriority,
      foePriority: foePriority,
    };
  }

  if (playerPriority !== foePriority) {
    return {
      playerFirst: playerPriority > foePriority,
      reason: ORDER_PRIORITY,
      playerSpeed: playerSpeed,
      foeSpeed: foeSpeed,
      playerPriority: playerPriority,
      foePriority: foePriority,
    };
  }

  if (playerSpeed !== foeSpeed) {
    return {
      playerFirst: playerSpeed > foeSpeed,
      reason: ORDER_SPEED,
      playerSpeed: playerSpeed,
      foeSpeed: foeSpeed,
      playerPriority: playerPriority,
      foePriority: foePriority,
    };
  }

  return {
    playerFirst: speedTieGoesToPlayer(ctx.random),
    reason: ORDER_SPEED_TIE,
    playerSpeed: playerSpeed,
    foeSpeed: foeSpeed,
    playerPriority: playerPriority,
    foePriority: foePriority,
  };
}

/** `decideOrder` when all the caller wants is the boolean. */
export function playerMovesFirst(
  ctx: BattleContext,
  playerAction: TurnAction,
  playerMoveId: string,
  foeMoveId: string
): boolean {
  return decideOrder(ctx, playerAction, playerMoveId, foeMoveId).playerFirst;
}
