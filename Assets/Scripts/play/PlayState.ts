// Everything a playthrough is, in one object that survives being closed.
//
// The save that shipped before this held five fields -- where the player stood
// and how many steps they had taken -- because there was nothing else to keep.
// Once there is a party, a bag and a set of story flags, a save is the game, and
// the failure modes change with it:
//
//   * A save that cannot be parsed is NOT the same as no save. Conflating them
//     starts a fresh game and the autosave destroys the damaged one a few frames
//     later, before anyone can be told. WorldSource.saveLoadFailed() exists for
//     this and the loop must honour it.
//   * A save written mid-script is a save of a half-finished event. Pewter Gym
//     sets EVENT_BEAT_BROCK at command 5, shows a message at 6 and hands over the
//     badge at 7; a write inside that window stores the flag without the badge,
//     and the script's own `check_flag` then skips the handover forever. The loop
//     must not write while a script is running.
//   * A save from another cartridge is not this cartridge's save. Species are
//     keyed by name and maps by id, so a Blue save loaded against a Red world
//     restores plausible-looking nonsense rather than failing.
//
// There is deliberately no timestamp. getTime() returns seconds since the LENS
// started, not wall clock, so it restarts near zero every launch: a save written
// ten minutes into yesterday's session would outrank one written thirty seconds
// into today's. `index` counts writes instead, which is what "newer" actually
// needs to mean here.

import { newVolatileState } from "./battle/types";
import { defaultViewSettings, sanitiseViewSettings } from "./screen/ViewOptions";
import type { ViewSettings } from "./screen/ViewOptions";
import type { BattleMon } from "./battle/types";
import type { DayCareSlot } from "./DayCare";
import type { FlagStore } from "./script/ScriptVM";

/**
 * Bumped whenever the shape below changes in a way an old save cannot satisfy.
 *
 * v2 added the PC box (`boxes`, `currentBox`) and `respawnLastMapId`. A v1 save
 * loads with an empty box; a v2 save is refused by a v1 build, which is the
 * intended direction of failure. Raising BOX_COUNT later is a v3.
 *
 * v4 adds `playMode` -- the onboarding page's Game Boy vs. diorama choice,
 * see SPEC.md "Play modes and the onboarding". A save from before v4 has no
 * opinion on it and migrates to PLAY_MODE_DIORAMA, exactly like newPlayState().
 *
 * v6 adds `pcItems`, the item PC the bedroom terminal opens onto, and raises
 * BOX_COUNT from one to the cartridge's twelve. No save in the field has ever
 * had an item PC -- there was no PC screen to spend it at -- so a pre-v6 save
 * migrates to the cartridge's own starting stock: one POTION.
 *
 * v7 adds `playerId` here and `otId`/`otName` on every BattleMon: who the
 * trainer is, and who caught each Pokemon. Nothing in the lens reads them yet.
 * They are here EARLY and on purpose, because they are the one thing that
 * cannot be added later: the moment a save is exported as a cartridge .sav
 * (docs/RESEARCH-SAVE-EXCHANGE.md) every Pokemon needs an owner, and a save
 * exported before the field existed would disagree with every save exported
 * after it. A pre-v7 save rolls an id on load and keeps it from its first
 * step onward, since PokemonAR.persist() writes on every step.
 *
 * v8 adds `repelSteps`: the cartridge's wRepelRemainingSteps, counted down on
 * every step that reaches the wild-encounter roll. A pre-v8 save has no REPEL
 * running, which is also what a missing field reads as.
 *
 * v12 adds `rivalStarter`, Yellow's wRivalStarter. A pre-v12 save is a Red or
 * Blue game and reads 0, which every Red rival battle ignores.
 *
 * v13 adds `dayCare`: the one Pokemon the gentleman on Route 5 is raising, and
 * the level it went in at (wDayCareInUse, wDayCareMon, wDayCareStartLevel). A
 * pre-v13 save has nobody in the DAYCARE, which is what null says.
 */
export const PLAY_STATE_VERSION: number = 13;

/** The Gen 1 party limit, and the length `party` may never exceed. */
export const MAX_PARTY: number = 6;

/** Kanto's dex, and the length of both dex arrays. */
export const DEX_SIZE: number = 151;

/** The eight badges, in the order the cartridge's stat boosts read them. */
export const BADGE_COUNT: number = 8;

/** MONS_PER_BOX: what one PC box holds. */
export const BOX_SIZE: number = 20;
/**
 * How many boxes this save carries: the cartridge's twelve, since v6, because
 * the PC screen's CHANGE BOX is a menu of exactly these. A v5 save's single box
 * migrates into box 1 and the other eleven arrive empty; sizedBoxes() drops
 * anything past the twelfth and says so.
 */
export const BOX_COUNT: number = 12;

/**
 * How many DISTINCT items the item PC holds: the cartridge's fifty
 * (`field.pcItemCap` in the bundle, from its own MAX_ITEM_CAPACITY), against
 * the bag's twenty. Counts stack to 99 per slot on both.
 */
export const PC_ITEM_CAP: number = 50;

/**
 * One kind of item and how many of it.
 *
 * An ordered array rather than a keyed object: the Gen 1 bag is ordered, JSON
 * object key order is not a contract, and an order that survives round-tripping
 * is what a "move item" screen would need later.
 */
export interface BagSlot {
  id: string;
  count: number;
}

/** Text speed as the cartridge stores it: frames per character. */
export const TEXT_SPEED_FAST: number = 1;
export const TEXT_SPEED_MEDIUM: number = 3;
export const TEXT_SPEED_SLOW: number = 5;
export const BATTLE_STYLE_SHIFT: string = "SHIFT";
export const BATTLE_STYLE_SET: string = "SET";

/**
 * `PlayState.playMode`: the onboarding page's choice (SPEC.md "Play modes
 * and the onboarding"), and the OPTION screen's own fourth row. GAME BOY is
 * the flat cartridge-accurate screen; DIORAMA is the voxel table. There is
 * no third value -- no CUSTOM page, as the design explicitly rules out.
 */
export const PLAY_MODE_GAMEBOY: string = "gameboy";
export const PLAY_MODE_DIORAMA: string = "diorama";

export interface GameOptions {
  textSpeed: number;
  battleAnimations: boolean;
  battleStyle: string;
  /**
   * How the diorama is drawn: tilt, curvature, rim and how much world is
   * built. The cartridge has no such rows, but they are the lens's, and
   * they belong with the rest of what a playthrough remembers rather than
   * on a scene input the wearer cannot reach. See play/screen/ViewOptions.
   */
  view: ViewSettings;
  /**
   * Whether the wearer has been asked how a fight should look.
   *
   * Not a view SETTING -- it decides nothing about what is drawn -- so it does
   * not belong in the ViewSettings block, where every field is an index into a
   * row's labels. It belongs with the rest of what a playthrough remembers,
   * which is here. See play/screen/BattleStyleScreen.
   */
  battleAsked: boolean;
}

/** InitOptions: medium text, animations on, SHIFT. */
export function defaultOptions(): GameOptions {
  return {
    textSpeed: TEXT_SPEED_MEDIUM, battleAnimations: true, battleStyle: BATTLE_STYLE_SHIFT,
    view: defaultViewSettings(), battleAsked: false,
  };
}

/** A copy with every field checked, so a hand-edited or older save cannot poison it. */
export function sanitizeOptions(raw: any): GameOptions {
  const base = defaultOptions();
  if (!raw || typeof raw !== "object") {
    return base;
  }
  const speed = raw.textSpeed;
  return {
    textSpeed: speed === TEXT_SPEED_FAST || speed === TEXT_SPEED_MEDIUM || speed === TEXT_SPEED_SLOW
      ? speed : base.textSpeed,
    battleAnimations: typeof raw.battleAnimations === "boolean" ? raw.battleAnimations : base.battleAnimations,
    battleStyle: raw.battleStyle === BATTLE_STYLE_SET ? BATTLE_STYLE_SET : BATTLE_STYLE_SHIFT,
    // A save written before version 5 carries no view block at all, which
    // sanitiseViewSettings answers with the defaults rather than a hole.
    view: sanitiseViewSettings(raw.view),
    // A save from before the question existed has not been asked it. Anyone
    // mid-playthrough gets it at their next fight, which is the right moment
    // for them too.
    battleAsked: raw.battleAsked === true,
  };
}

export interface PlayState {
  /** PLAY_STATE_VERSION at the time of writing. Read before anything else. */
  version: number;
  /**
   * This trainer's own id, 0..65535. `wPlayerID` on the cartridge, at 0x2605.
   *
   * The cartridge rolls it once at NEW GAME and never again; it is what makes
   * a Pokemon "yours" rather than traded, and two players with the same name
   * still have different ids. Nothing reads it yet -- see PLAY_STATE_VERSION
   * v7 for why it exists anyway.
   */
  playerId: number;
  /** Write counter. Higher is newer; see the note above on why not a clock. */
  index: number;
  /** The cartridge this playthrough belongs to. */
  romSha1: string;

  playerName: string;
  rivalName: string;

  mapId: string;
  cellX: number;
  cellY: number;
  facing: string;
  steps: number;
  /** The last town or route warped away from: what a LAST_MAP exit returns to. */
  lastMapId: string;
  playTimeSeconds: number;
  /** The OPTION screen's three rows; wOptions, saved with the game. */
  options: GameOptions;
  /**
   * PLAY_MODE_GAMEBOY or PLAY_MODE_DIORAMA: the onboarding page's choice,
   * changeable later from the OPTION screen's fourth row. Save version 4.
   */
  playMode: string;

  /** Benched: no stages, no volatiles, no badge passes. See benchedParty(). */
  party: BattleMon[];
  bag: BagSlot[];
  /**
   * The item PC's own store, the bag's twin behind the bedroom terminal.
   * Separate from `bag` because the cartridge's is: different capacity,
   * different screen, and an item in one is not in the other.
   */
  pcItems: BagSlot[];
  money: number;
  /** Game Corner coins, 0..9999. Kept apart from money as the cartridge does. */
  coins: number;
  /**
   * Yellow's wRivalStarter: what the rival's Eevee will become, and so which
   * of his parties each later battle takes. 1 JOLTEON, 2 FLAREON, 3 VAPOREON;
   * 0 until the lab decides it. JOLTEON at the snatch, FLAREON on a lab win,
   * VAPOREON on a lab loss, and a Route 22 win turns FLAREON back to JOLTEON
   * (OaksLabRivalEndBattleScript, Route22Rival1AfterBattleScript). Red and
   * Blue never write it; their rival is read off the player's starter.
   */
  rivalStarter: number;

  /**
   * The Pokemon in the DAYCARE, or null. It is in nobody's party and in no
   * box; it gains a point of experience a step (PlayLoop) and comes back
   * through play/DayCare.ts.
   */
  dayCare: DayCareSlot;

  /**
   * SAFARI BALLs left this visit (wNumSafariBalls, $DA47). Its own counter and
   * not a bag slot, because the cartridge's is: the balls are handed out at
   * the gate, spent only in the Zone's own battles, and taken back at the
   * door. Thirty on entry, zero outside.
   */
  safariBalls: number;
  /**
   * Steps left this visit (wSafariSteps, $D70D/$D70E). 502 on entry -- the two
   * extra are the steps through the gate -- and zero means the game is over,
   * which is the PA calling you back.
   */
  safariSteps: number;

  /** Eight flags in gym order. badgeCount() counts them, badgeMask() packs them. */
  badges: boolean[];
  dexSeen: boolean[];
  dexOwned: boolean[];

  /** The live store the script VM mutates in place. */
  flags: FlagStore;
  /**
   * NPCs and item balls a script has shown or hidden, by "MAP:NAME", true for
   * shown. Live like `flags`: PlayLoop reads and writes this object itself.
   *
   * In the save because the cartridge derives visibility from event bits and
   * keeping it in the loop alone meant every hidden NPC -- the youngster Brock's
   * win removes, the rival's taken ball -- came back on reload.
   */
  objectToggles: any;
  /**
   * Trainers beaten through a talk, by "MAP:NAME", true when beaten. Live like
   * `flags`. The cartridge keeps one event bit per trainer; those land in
   * `flags` too (isTrainerDefeated reads both), and this covers the objects
   * whose header the manifest does not carry.
   */
  defeatedTrainers: any;

  /** Where a whiteout returns the player, and heals them. */
  respawnMapId: string;
  respawnCellX: number;
  respawnCellY: number;
  /**
   * The town the respawn Center's LAST_MAP exit should lead to. "" until a
   * nurse has healed the player once; the boot default's exit then falls back
   * to the door geometry.
   */
  respawnLastMapId: string;
  /** Steps of REPEL left, wRepelRemainingSteps; 0 when none is running. */
  repelSteps: number;

  /**
   * The PC: BOX_COUNT boxes of at most BOX_SIZE Pokemon each, stored benched
   * and otherwise exactly as they were -- Gen 1 heals nothing on deposit.
   */
  boxes: BattleMon[][];
  /** Which box catches and deposits go to, 0-based. */
  currentBox: number;

  /**
   * Riding the water. In the save because a reload without it puts the player
   * on a water cell with no legal move: canEnter refuses every neighbour.
   */
  surfing: boolean;
  /**
   * On the BICYCLE (wWalkBikeSurfState 1), and whether the road will let you
   * off (BIT_ALWAYS_ON_BIKE). Saved, like surfing: a save written on CYCLING
   * ROAD and restored on foot would put the player somewhere they cannot be.
   */
  riding: boolean;
  forcedBike: boolean;
  /**
   * The cartridge's wMapPalOffset, as a boolean: the screen is dark.
   *
   * It is NOT "the player is on a dark map". The offset is written once, on
   * the warp from an outside map into ROCK_TUNNEL_1F (home/overworld.asm
   * :495-501), and cleared once, on the warp back out (:530-536) -- so the
   * ladders between the two floors leave it alone, and FLASH lasts the whole
   * tunnel rather than one floor. It sits inside the block the save copies
   * (ram/wram.asm:1778-1780 between wMainDataStart and wMainDataEnd), so
   * saving in a lit tunnel and loading gives back a lit tunnel.
   */
  darkened: boolean;
  /** Towns FLY may name, keyed by map id. Live like `flags`. */
  visitedTowns: any;
}

function falseArray(n: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    out.push(false);
  }
  return out;
}

/**
 * A brand-new game, before the intro has run.
 *
 * The player starts in their own bedroom with nothing, which is also the state a
 * migrated position-only save is brought up to.
 */
/**
 * A trainer id, 0..65535, from a source of randomness.
 *
 * `random` is injectable for the same reason Overworld's and NpcWander's are:
 * a test that cannot pin the roll cannot assert anything about it. The
 * cartridge takes its id from the hardware RNG at the same moment.
 */
export function rollTrainerId(random: () => number): number {
  const roll = random ? random() : Math.random();
  const scaled = Math.floor(roll * 65536);
  return scaled < 0 ? 0 : scaled > 65535 ? 65535 : scaled;
}

export function newPlayState(romSha1: string, random: () => number = null): PlayState {
  return {
    version: PLAY_STATE_VERSION,
    playerId: rollTrainerId(random),
    index: 1,
    romSha1: romSha1 ? romSha1 : "",
    playerName: "RED",
    rivalName: "BLUE",
    mapId: "REDS_HOUSE_2F",
    cellX: 3,
    cellY: 6,
    facing: "down",
    steps: 0,
    lastMapId: "",
    playTimeSeconds: 0,
    options: defaultOptions(),
    // The onboarding page overwrites this for a brand-new game; diorama is
    // just the value a save has before that page (or CONTINUE) says otherwise.
    playMode: PLAY_MODE_DIORAMA,
    party: [],
    bag: [],
    // Measured on the cartridge: a new game's PC already holds one POTION,
    // and the bedroom terminal's WITHDRAW ITEM is the first thing it offers.
    pcItems: [{ id: "POTION", count: 1 }],
    money: 3000,
    coins: 0,
    rivalStarter: 0,
    dayCare: null,
    safariBalls: 0,
    safariSteps: 0,
    badges: falseArray(BADGE_COUNT),
    dexSeen: falseArray(DEX_SIZE),
    dexOwned: falseArray(DEX_SIZE),
    flags: {},
    objectToggles: {},
    defeatedTrainers: {},
    respawnMapId: "REDS_HOUSE_1F",
    respawnCellX: 3,
    respawnCellY: 6,
    respawnLastMapId: "",
    repelSteps: 0,
    boxes: emptyBoxes(),
    currentBox: 0,
    surfing: false,
    riding: false,
    forcedBike: false,
    darkened: false,
    visitedTowns: {},
  };
}

function emptyBoxes(): BattleMon[][] {
  const out: BattleMon[][] = [];
  for (let i = 0; i < BOX_COUNT; i++) {
    out.push([]);
  }
  return out;
}

/**
 * How many badges the player has earned.
 *
 * A COUNT, for the things that want one -- a badge case, a level cap, a line of
 * text. The battle engine does not: it takes badgeMask() below, because which
 * badge you hold decides which stat is boosted and a count cannot say that.
 */
export function badgeCount(state: PlayState): number {
  let n = 0;
  for (let i = 0; state.badges && i < state.badges.length; i++) {
    if (state.badges[i]) {
      n++;
    }
  }
  return n;
}

/**
 * The badges as the cartridge holds them: bit i for badge i in gym order,
 * which is wObtainedBadges. This, not a count, is what the battle engine's
 * badgeBoostsStat() tests -- see BADGE_BOOST_STAT in battle/Stats.ts.
 */
export function badgeMask(state: PlayState): number {
  let bits = 0;
  for (let i = 0; state.badges && i < state.badges.length && i < 32; i++) {
    if (state.badges[i]) {
      bits = bits | (1 << i);
    }
  }
  return bits;
}

/**
 * True when this save's badges are NOT contiguous.
 *
 * Kept from when the boost walked the table as a prefix and a gap here meant a
 * wrong boost. It no longer does, and the check that proves that uses this to
 * BUILD the out-of-order case rather than to detect a divergence.
 */
export function playStateBadgeGap(state: PlayState): boolean {
  let seenFalse = false;
  for (let i = 0; state.badges && i < state.badges.length; i++) {
    if (!state.badges[i]) {
      seenFalse = true;
    } else if (seenFalse) {
      return true;
    }
  }
  return false;
}

export function hasItem(state: PlayState, id: string, count: number): boolean {
  const want = count > 0 ? count : 1;
  for (let i = 0; i < state.bag.length; i++) {
    if (state.bag[i].id === id) {
      return state.bag[i].count >= want;
    }
  }
  return false;
}

/** Adds to an existing slot or appends a new one. Returns false when full. */
export function giveItem(state: PlayState, id: string, count: number): boolean {
  const n = count > 0 ? count : 1;
  for (let i = 0; i < state.bag.length; i++) {
    if (state.bag[i].id === id) {
      state.bag[i].count = state.bag[i].count + n;
      return true;
    }
  }
  // The cartridge's bag holds twenty distinct items and refuses the twenty-first,
  // which is the whole reason a TM handoff has to be retryable.
  if (state.bag.length >= 20) {
    return false;
  }
  state.bag.push({ id: id, count: n });
  return true;
}

export function takeItem(state: PlayState, id: string, count: number): boolean {
  const n = count > 0 ? count : 1;
  for (let i = 0; i < state.bag.length; i++) {
    if (state.bag[i].id !== id) {
      continue;
    }
    if (state.bag[i].count < n) {
      return false;
    }
    state.bag[i].count = state.bag[i].count - n;
    if (state.bag[i].count <= 0) {
      state.bag.splice(i, 1);
    }
    return true;
  }
  return false;
}

/** True when at least one party member can still fight. */
export function canFight(state: PlayState): boolean {
  for (let i = 0; i < state.party.length; i++) {
    if (state.party[i].hp > 0) {
      return true;
    }
  }
  return false;
}

export function markSeen(state: PlayState, dex: number): void {
  if (dex > 0 && dex <= state.dexSeen.length) {
    state.dexSeen[dex - 1] = true;
  }
}

export function markOwned(state: PlayState, dex: number): void {
  markSeen(state, dex);
  if (dex > 0 && dex <= state.dexOwned.length) {
    state.dexOwned[dex - 1] = true;
  }
}

/** How many species the player has caught. What Oak's aides count. */
export function dexOwnedCount(state: PlayState): number {
  let n = 0;
  for (let i = 0; state.dexOwned && i < state.dexOwned.length; i++) {
    if (state.dexOwned[i]) {
      n++;
    }
  }
  return n;
}

/**
 * Brings anything read out of storage up to the current shape.
 *
 * Returns null when the value cannot be understood at all, which the caller must
 * treat as "refuse to overwrite" rather than "start fresh".
 *
 * The v0 case is the position-only save that is in the field right now. Its five
 * fields carry over; everything else starts empty, and EVENT_INTRO_DONE is set
 * because a v0 saver has already walked around and re-running the intro would
 * ask for their name again and then warp them out of wherever they were.
 */
export function migratePlayState(raw: any, romSha1: string): PlayState {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const version = typeof raw.version === "number" ? raw.version : 0;
  if (version > PLAY_STATE_VERSION) {
    // From a newer build. Loading it would silently drop whatever it added.
    return null;
  }

  if (version === 0) {
    if (typeof raw.mapId !== "string" || raw.mapId.length === 0) {
      return null;
    }
    const fresh = newPlayState(romSha1);
    fresh.mapId = raw.mapId;
    fresh.cellX = typeof raw.cellX === "number" ? raw.cellX : fresh.cellX;
    fresh.cellY = typeof raw.cellY === "number" ? raw.cellY : fresh.cellY;
    fresh.facing = typeof raw.facing === "string" ? raw.facing : fresh.facing;
    fresh.steps = typeof raw.steps === "number" ? raw.steps : 0;
    fresh.flags.EVENT_INTRO_DONE = true;
    return fresh;
  }

  // v1 and v2: present, but not to be trusted field by field -- a truncated
  // write can produce valid JSON with half the object missing.
  const base = newPlayState(romSha1);
  const out: PlayState = {
    version: PLAY_STATE_VERSION,
    index: typeof raw.index === "number" ? raw.index : 1,
    romSha1: typeof raw.romSha1 === "string" ? raw.romSha1 : "",
    // A pre-v7 save has no id. It gets one here and keeps it from the first
    // step onward; until that write it would roll again on each load, which
    // costs nothing while nothing reads it.
    playerId: typeof raw.playerId === "number" && raw.playerId >= 0 && raw.playerId <= 65535
      ? Math.floor(raw.playerId) : base.playerId,
    playerName: typeof raw.playerName === "string" ? raw.playerName : base.playerName,
    rivalName: typeof raw.rivalName === "string" ? raw.rivalName : base.rivalName,
    mapId: typeof raw.mapId === "string" && raw.mapId.length > 0 ? raw.mapId : base.mapId,
    cellX: typeof raw.cellX === "number" ? raw.cellX : base.cellX,
    cellY: typeof raw.cellY === "number" ? raw.cellY : base.cellY,
    facing: typeof raw.facing === "string" ? raw.facing : base.facing,
    steps: typeof raw.steps === "number" ? raw.steps : 0,
    lastMapId: typeof raw.lastMapId === "string" ? raw.lastMapId : "",
    playTimeSeconds: typeof raw.playTimeSeconds === "number" ? raw.playTimeSeconds : 0,
    options: sanitizeOptions(raw.options),
    // A pre-v4 save has no opinion here (raw.playMode is undefined) and
    // migrates to diorama; anything but the literal GAME BOY value does too,
    // which is also what keeps a hand-edited or CUSTOM-page value harmless.
    playMode: raw.playMode === PLAY_MODE_GAMEBOY ? PLAY_MODE_GAMEBOY : PLAY_MODE_DIORAMA,
    party: Array.isArray(raw.party) ? withVolatile(raw.party.slice(0, MAX_PARTY)) : [],
    // A save written while Oak's request scene put a POKEDEX in the bag: the
    // cartridge has no such item (the dex is EVENT_GOT_POKEDEX), so it is
    // dropped on the way in. Nothing ever read it.
    bag: Array.isArray(raw.bag) ? raw.bag.filter((slot: any) => !slot || slot.id !== "POKEDEX") : [],
    // A pre-v6 save has no pcItems at all: it was written by a build with no
    // PC screen, so its POTION was never withdrawable and is still in there.
    pcItems: Array.isArray(raw.pcItems) ? raw.pcItems.slice(0, PC_ITEM_CAP) : base.pcItems,
    money: typeof raw.money === "number" ? raw.money : base.money,
    coins: typeof raw.coins === "number" ? raw.coins : 0,
    // A pre-v12 save is Red's or Blue's: no rival Eevee to have decided.
    rivalStarter: typeof raw.rivalStarter === "number" ? raw.rivalStarter : 0,
    // A pre-v13 save has nobody in the DAYCARE.
    dayCare: raw.dayCare && raw.dayCare.mon && typeof raw.dayCare.startLevel === "number"
      ? { mon: withVolatile([raw.dayCare.mon])[0], startLevel: raw.dayCare.startLevel }
      : null,
    safariBalls: typeof raw.safariBalls === "number" ? raw.safariBalls : 0,
    safariSteps: typeof raw.safariSteps === "number" ? raw.safariSteps : 0,
    badges: sizedBooleans(raw.badges, BADGE_COUNT),
    dexSeen: sizedBooleans(raw.dexSeen, DEX_SIZE),
    dexOwned: sizedBooleans(raw.dexOwned, DEX_SIZE),
    flags: raw.flags && typeof raw.flags === "object" ? raw.flags : {},
    objectToggles: raw.objectToggles && typeof raw.objectToggles === "object" ? raw.objectToggles : {},
    defeatedTrainers: raw.defeatedTrainers && typeof raw.defeatedTrainers === "object" ? raw.defeatedTrainers : {},
    respawnMapId: typeof raw.respawnMapId === "string" && raw.respawnMapId.length > 0
      ? raw.respawnMapId : base.respawnMapId,
    respawnCellX: typeof raw.respawnCellX === "number" ? raw.respawnCellX : base.respawnCellX,
    respawnCellY: typeof raw.respawnCellY === "number" ? raw.respawnCellY : base.respawnCellY,
    respawnLastMapId: typeof raw.respawnLastMapId === "string" ? raw.respawnLastMapId : "",
    repelSteps: typeof raw.repelSteps === "number" && raw.repelSteps > 0 ? Math.floor(raw.repelSteps) : 0,
    boxes: sizedBoxes(raw.boxes),
    currentBox: 0,
    surfing: raw.surfing === true,
    riding: raw.riding === true,
    forcedBike: raw.forcedBike === true,
    darkened: raw.darkened === true,
    visitedTowns: raw.visitedTowns && typeof raw.visitedTowns === "object" ? raw.visitedTowns : {},
  };
  if (typeof raw.currentBox === "number" && raw.currentBox >= 0 && raw.currentBox < BOX_COUNT) {
    out.currentBox = raw.currentBox;
  }
  return out;
}

/**
 * Exactly BOX_COUNT boxes of at most BOX_SIZE, whatever storage handed back.
 *
 * A save from a build with more boxes loses the extra ones HERE, and says so:
 * the version check only refuses a newer version number, and a later build that
 * raises BOX_COUNT must bump the version rather than rely on this.
 */
function sizedBoxes(raw: any): BattleMon[][] {
  const out = emptyBoxes();
  if (!Array.isArray(raw)) {
    return out;
  }
  let dropped = 0;
  for (let b = 0; b < raw.length; b++) {
    const box = Array.isArray(raw[b]) ? raw[b] : [];
    if (b >= BOX_COUNT) {
      dropped = dropped + box.length;
      continue;
    }
    if (box.length > BOX_SIZE) {
      dropped = dropped + (box.length - BOX_SIZE);
    }
    out[b] = withVolatile(box.slice(0, BOX_SIZE));
  }
  if (dropped > 0) {
    print("[PlayState] save carried " + dropped + " boxed Pokemon this build cannot hold; dropped");
  }
  return out;
}

/** A boolean array of exactly n entries, whatever storage handed back. */
function sizedBooleans(raw: any, n: number): boolean[] {
  const out = falseArray(n);
  if (!Array.isArray(raw)) {
    return out;
  }
  for (let i = 0; i < n && i < raw.length; i++) {
    out[i] = raw[i] === true;
  }
  return out;
}

/**
 * Whether this save belongs to the world it is about to be loaded against.
 *
 * Empty on either side means "unknown", which is allowed: a v0 migration has no
 * hash to offer and refusing it would strand the only saves in the field.
 */
export function matchesWorld(state: PlayState, bundleRomSha1: string): boolean {
  if (!state.romSha1 || !bundleRomSha1) {
    return true;
  }
  return state.romSha1 === bundleRomSha1;
}

/** The key a beaten trainer is recorded under. */
export function trainerDefeatKey(mapId: string, name: string): string {
  return mapId + ":" + name;
}

/**
 * Whether this trainer has been beaten: their own event bit, or the per-object
 * record. Both, because a Victory retires trainers by their event bits
 * (beating the Karate Master retires the four Blackbelts) while the generic
 * path writes the object record -- a reader of one store gets the other wrong.
 */
export function isTrainerDefeated(state: PlayState, mapId: string, name: string, event: string): boolean {
  if (state.defeatedTrainers && state.defeatedTrainers[trainerDefeatKey(mapId, name)] === true) {
    return true;
  }
  return event !== "" && state.flags[event] === true;
}

export function markTrainerDefeated(state: PlayState, mapId: string, name: string, event: string): void {
  if (!state.defeatedTrainers) {
    state.defeatedTrainers = {};
  }
  state.defeatedTrainers[trainerDefeatKey(mapId, name)] = true;
  if (event !== "") {
    state.flags[event] = true;
  }
}

/**
 * Every saved Pokemon carries a volatile block. A truncated or hand-edited save
 * without one threw on the first status cure (ItemUse reads volatile.badlyPoisoned).
 */
function withVolatile(party: BattleMon[]): BattleMon[] {
  for (let i = 0; i < party.length; i++) {
    if (!party[i].volatile) {
      party[i].volatile = newVolatileState();
    }
  }
  return party;
}
