// Whether a traded Pokemon does what it is told.
//
// engine/battle/core.asm CheckForDisobedience, run before every move the
// player picks. A Pokemon whose original trainer is not the player is TRADED,
// and a traded Pokemon above the level the badges vouch for may loaf, nap,
// hit itself or use a different move instead. The Cascade Badge's own text
// promises exactly this -- "makes all POKeMON up to L30 obey! That includes
// even outsiders!" -- and until this file no badge did, because nothing ever
// read otId.
//
// The ladder (:3855-3869): EARTHBADGE 101, MARSHBADGE 70, RAINBOWBADGE 50,
// CASCADEBADGE 30, else 10. A Pokemon at or below it always obeys. Above it
// the routine draws bytes from the battle RNG in a fixed order, and the
// order is kept here so a seeded random reproduces the cartridge's decision:
//
//   1. swap(byte) until below level+c;  under c  -> obeys
//   2. byte       until below level+c;  under c  -> a RANDOM move instead
//   3. swap(byte) - (level - c):  negative -> begins to nap
//                                 >= (level-c) -> does nothing (one of four lines)
//                                 else         -> "won't obey!" and hits itself
//
// `swap` is the Z80's nibble swap, which the routine uses as a second, cheaper
// source of variety. The random-move branch keeps the cartridge's own limits:
// no move if it knows only one, if one is disabled, if it is struggling, or
// if only the chosen move has PP left -- and its off-by-one, which never picks
// the LAST move (`cp wMaxMenuItem / jr nc`). The one thing not reproduced is
// the freeze that off-by-one causes with exactly two moves and the first one
// chosen: that loop is bounded here and falls through to "does nothing".

import type { BattleMon } from "./types";
import { randomByte } from "./Damage";

/** Bits of wObtainedBadges, in gym order (PlayState.badgeMask). */
const BIT_CASCADEBADGE: number = 1;
const BIT_RAINBOWBADGE: number = 3;
const BIT_MARSHBADGE: number = 5;
const BIT_EARTHBADGE: number = 7;

export const OBEY_USE: string = "use";
export const OBEY_RANDOM: string = "random";
export const OBEY_NAP: string = "nap";
export const OBEY_NOTHING: string = "nothing";
export const OBEY_HIT: string = "hit";

export const TEXT_WONT_OBEY: string = "_WontObeyText";
export const TEXT_BEGAN_TO_NAP: string = "_BeganToNapText";
export const TEXT_LOAFING: string = "_LoafingAroundText";
export const TEXT_TURNED_AWAY: string = "_TurnedAwayText";
export const TEXT_IGNORED_ORDERS: string = "_IgnoredOrdersText";

export interface DisobedienceRoll {
  /** OBEY_* */
  outcome: string;
  /** The line to print for anything but OBEY_USE and OBEY_RANDOM. */
  textId: string;
  /** Turns of sleep for OBEY_NAP, 1..7. */
  sleepTurns: number;
  /** The move slot used instead, for OBEY_RANDOM. */
  slot: number;
}

/** The level the badges vouch for: everything at or below it obeys. */
export function obedienceLevel(badgeBits: number): number {
  if ((badgeBits >> BIT_EARTHBADGE) & 1) {
    return 101;
  }
  if ((badgeBits >> BIT_MARSHBADGE) & 1) {
    return 70;
  }
  if ((badgeBits >> BIT_RAINBOWBADGE) & 1) {
    return 50;
  }
  if ((badgeBits >> BIT_CASCADEBADGE) & 1) {
    return 30;
  }
  return 10;
}

/**
 * Traded: the OT id is not the player's. A battle that does not know the
 * player's id (0) checks nothing, which is also the link-battle case.
 *
 * An OT id of 0 is "nobody's yet" (Stats.makeWildMon), and a Pokemon in the
 * player's party in that state is one Storage.claimUnowned will stamp as the
 * player's on the next sweep -- a catch or a gift from this very session. It
 * is the player's own, and it obeys; reading 0 as foreign would have every
 * freshly caught Pokemon loafing until the next load.
 */
export function isTraded(mon: BattleMon, playerId: number): boolean {
  return playerId > 0 && mon.otId !== 0 && mon.otId !== playerId;
}

function swap(a: number): number {
  return ((a & 0x0f) << 4) | ((a >> 4) & 0x0f);
}

function nothingRoll(random: () => number): DisobedienceRoll {
  const pick = randomByte(random) & 3;
  const text = pick === 0 ? TEXT_LOAFING : pick === 1 ? TEXT_WONT_OBEY
    : pick === 2 ? TEXT_TURNED_AWAY : TEXT_IGNORED_ORDERS;
  return { outcome: OBEY_NOTHING, textId: text, sleepTurns: 0, slot: -1 };
}

/**
 * The decision for one move the player picked. `selected` is the slot,
 * `struggling` whether the pick is Struggle, `disabledSlot` -1 or the slot
 * Disable holds.
 */
export function rollDisobedience(mon: BattleMon, badgeBits: number, random: () => number,
                                 selected: number, struggling: boolean,
                                 disabledSlot: number): DisobedienceRoll {
  const c = obedienceLevel(badgeBits);
  const d = mon.level;
  if (c >= d) {
    return { outcome: OBEY_USE, textId: "", sleepTurns: 0, slot: selected };
  }
  const b = d + c > 255 ? 255 : d + c;

  let a = 0;
  do {
    a = swap(randomByte(random));
  } while (a >= b);
  if (a < c) {
    return { outcome: OBEY_USE, textId: "", sleepTurns: 0, slot: selected };
  }
  do {
    a = randomByte(random);
  } while (a >= b);
  if (a < c) {
    return randomMove(mon, random, selected, struggling, disabledSlot);
  }
  const b2 = d - c;
  const diff = swap(randomByte(random)) - b2;
  if (diff < 0) {
    let turns = 0;
    do {
      turns = swap((randomByte(random) * 2) & 0xff) & 7;
    } while (turns === 0);
    return { outcome: OBEY_NAP, textId: TEXT_BEGAN_TO_NAP, sleepTurns: turns, slot: -1 };
  }
  if (diff >= b2) {
    return nothingRoll(random);
  }
  return { outcome: OBEY_HIT, textId: TEXT_WONT_OBEY, sleepTurns: 0, slot: -1 };
}

/** .useRandomMove: another move with PP, under the cartridge's four refusals. */
function randomMove(mon: BattleMon, random: () => number, selected: number,
                    struggling: boolean, disabledSlot: number): DisobedienceRoll {
  let known = 0;
  let totalPp = 0;
  for (let i = 0; i < mon.moves.length; i++) {
    if (mon.moves[i].id !== "") {
      known++;
      totalPp += mon.moves[i].pp;
    }
  }
  const selectedPp = selected >= 0 && selected < mon.moves.length ? mon.moves[selected].pp : 0;
  if (known < 2 || disabledSlot >= 0 || struggling || totalPp === selectedPp) {
    return nothingRoll(random);
  }
  // wMaxMenuItem is known - 1, and `cp b / jr nc` retries at or above it: the
  // last move is never chosen. Bounded, where the cartridge is not.
  const maxItem = known - 1;
  for (let tries = 0; tries < 64; tries++) {
    const pick = randomByte(random) & 3;
    if (pick >= maxItem || pick === selected || mon.moves[pick].pp <= 0) {
      continue;
    }
    return { outcome: OBEY_RANDOM, textId: "", sleepTurns: 0, slot: pick };
  }
  return nothingRoll(random);
}
