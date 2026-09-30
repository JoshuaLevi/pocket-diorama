// The battle engine's contract. Shapes and constants only -- no logic lives here,
// so every module in play/battle can import this without importing each other.
//
// Every field is derived from the real bundle in Assets/Generated/kanto.json, not
// from memory of what Pokemon has. The bundle keys that matter:
//
//   species[ID] = { types[], baseStats{hp,attack,defense,speed,special}, catchRate,
//                   baseExp, growthRate, level1Moves[], learnset[], evolutions[] }
//   moves[ID]   = { type, power, accuracy (percent), pp, effect, index, anim }
//   typeChart   = { names[], matchups[{attacker,defender,multiplier}], source }
//
// Type ids are the ROM's own constant names, so PSYCHIC is spelled PSYCHIC_TYPE in
// species types, move types and the type chart alike. Never translate them.
//
// Nothing here uses Record/Map/Set or an enum: Lens Studio's TypeScript has none of
// them. Index-signature objects and string constants instead. There are no optional
// properties either -- every field is always present, with a documented sentinel
// ("" or 0 or -1) for "none", so four modules cannot disagree about what undefined
// meant.

// ---------------------------------------------------------------------------
// Bundle shapes the engine reads
// ---------------------------------------------------------------------------

/** bundle.moves[id].anim -- the battle animation program, unused by the engine. */
export interface MoveAnim {
  pitch: number;
  sound: string;
  tempo: number;
}

/** bundle.moves[id]. The ROM's move table, one row per move. */
export interface MoveDef {
  id: string;
  name: string;
  /** The ROM's move number, 1..165. Ai.ts and the script VM key off this. */
  index: number;
  /** A ROM type constant: NORMAL, FIGHTING, ... PSYCHIC_TYPE, ICE, DRAGON. */
  type: string;
  /** Base power. Fixed-damage moves (Seismic Toss, Psywave, ...) carry 1. */
  power: number;
  /** Percent, 0..100. The ROM byte is floor(accuracy * 255 / 100); accuracyByte(). */
  accuracy: number;
  pp: number;
  /** A ROM effect constant, e.g. NO_ADDITIONAL_EFFECT, PARALYZE_SIDE_EFFECT1. */
  effect: string;
  anim: MoveAnim;
  source: string;
}

/** bundle.typeChart.matchups[n]. multiplier is in TENTHS: 0, 5 or 20. */
export interface TypeMatchup {
  attacker: string;
  defender: string;
  multiplier: number;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/** The four stats that can change during a battle. Gen 1 has one Special stat. */
export interface BattleStats {
  attack: number;
  defense: number;
  speed: number;
  special: number;
}

/** Those four plus HP: what the Gen 1 stat formula produces for a Pokemon. */
export interface StatSet {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  special: number;
}

/**
 * Stat stages, -6..+6, zero at send-out. Accuracy and evasion are stages too and
 * live here, but they are not stats -- they modify the accuracy roll, not a value.
 */
export interface StatStages {
  attack: number;
  defense: number;
  speed: number;
  special: number;
  accuracy: number;
  evasion: number;
}

/** Stat keys as strings, for the loops that walk all four. Order is the ROM's. */
export const STAT_ATTACK: string = "attack";
export const STAT_DEFENSE: string = "defense";
export const STAT_SPEED: string = "speed";
export const STAT_SPECIAL: string = "special";
export const STAT_ACCURACY: string = "accuracy";
export const STAT_EVASION: string = "evasion";

/** The four badge-boostable, stage-modifiable stats, in the ROM's own order. */
export const BATTLE_STAT_KEYS: string[] = [
  STAT_ATTACK,
  STAT_DEFENSE,
  STAT_SPEED,
  STAT_SPECIAL,
];

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Major status. A Pokemon has at most one, it survives switching and fainting is
 * the only thing that clears it for free. Badly poisoned is NOT one of these: in
 * Gen 1 Toxic sets STATUS_POISON and a volatile counter, so it becomes ordinary
 * poison the moment the Pokemon switches out. See VolatileState.badlyPoisoned.
 */
export const STATUS_NONE: string = "";
export const STATUS_SLEEP: string = "SLP";
export const STATUS_POISON: string = "PSN";
export const STATUS_BURN: string = "BRN";
export const STATUS_FREEZE: string = "FRZ";
export const STATUS_PARALYSIS: string = "PAR";

// ---------------------------------------------------------------------------
// A Pokemon in a battle
// ---------------------------------------------------------------------------

/** One of the four move slots. maxPp carries the PP Up bonus; there is none in 1.0. */
export interface MoveSlot {
  /** Key into bundle.moves. "" for an empty slot. */
  id: string;
  pp: number;
  maxPp: number;
}

/**
 * Everything that is cleared when the Pokemon leaves the field. Gen 1 keeps some
 * of these across a switch and some not; the rule is stated per field, because
 * getting it wrong is invisible until someone plays a real battle.
 */
export interface VolatileState {
  /** Turns of confusion left. 0 is not confused. Cleared on switch. */
  confusionTurns: number;
  /** Substitute HP. 0 is no substitute. Cleared on switch. */
  substituteHp: number;
  /** Reflect doubles Defense against non-critical physical moves. */
  reflect: boolean;
  /** Light Screen doubles Special against non-critical special moves. */
  lightScreen: boolean;
  /** Mist blocks stat drops. */
  mist: boolean;
  /** Focus Energy. In Gen 1 this QUARTERS the crit rate; see critChance(). */
  focusEnergy: boolean;
  /** Leech Seed. Survives nothing: cleared on switch. */
  seeded: boolean;
  /** Set by a flinch side effect, cleared at the end of the turn. */
  flinched: boolean;
  /** Hyper Beam's recharge turn. */
  recharging: boolean;
  /** Fly / Dig / Solar Beam / Sky Attack / Skull Bash, "" when not charging. */
  chargingMove: string;
  /** The airborne / underground half of Fly and Dig. */
  invulnerable: boolean;
  /** Wrap, Bind, Fire Spin, Clamp: this Pokemon is the one doing the trapping. */
  trapping: boolean;
  /** Turns left of being trapped, or of the user's own trapping move. */
  trapTurns: number;
  /** Thrash / Petal Dance turns left; confusion follows when it hits 0. */
  thrashTurns: number;
  /** Bide turns left, and the damage it has soaked so far. */
  bideTurns: number;
  bideDamage: number;
  /** Rage: every hit taken raises Attack by a stage. */
  rageActive: boolean;
  /** Toxic's counter, 1..15. 0 means ordinary poison. Cleared on switch. */
  badlyPoisoned: number;
  /** Transform copied another Pokemon; stats and moves are borrowed. */
  transformed: boolean;
  /** Disable: the disabled slot index, -1 for none, and turns left. */
  disabledSlot: number;
  disabledTurns: number;
  /** The move this Pokemon used last, for Mirror Move and for Rage. "" for none. */
  lastMoveUsed: string;
  /** Counter for multi-hit and multi-turn moves that the effect owns. */
  effectCounter: number;
}

/** A fresh, all-clear volatile block. Call this on send-out and on switch-in. */
export function newVolatileState(): VolatileState {
  return {
    confusionTurns: 0,
    substituteHp: 0,
    reflect: false,
    lightScreen: false,
    mist: false,
    focusEnergy: false,
    seeded: false,
    flinched: false,
    recharging: false,
    chargingMove: "",
    invulnerable: false,
    trapping: false,
    trapTurns: 0,
    thrashTurns: 0,
    bideTurns: 0,
    bideDamage: 0,
    rageActive: false,
    badlyPoisoned: 0,
    transformed: false,
    disabledSlot: -1,
    disabledTurns: 0,
    lastMoveUsed: "",
    effectCounter: 0,
  };
}

/**
 * One Pokemon, in or out of battle. `stats` is what the stat formula produced and
 * never changes while the battle runs; `battleStats` is the working copy that
 * carries stat stages, badge boosts, burn and paralysis. Damage.ts reads
 * `battleStats` for an ordinary hit and `stats` for a critical one, which is the
 * whole reason they are two fields.
 */
export interface BattleMon {
  /** Key into bundle.species. */
  species: string;
  /** Nickname, or the species name when there is none. */
  name: string;
  /**
   * The ORIGINAL TRAINER: whose id this Pokemon was caught under, and their
   * name. 0 and "" mean nobody owns it yet -- a wild Pokemon on the field.
   *
   * The cartridge carries both per Pokemon (OTID in the 44-byte party struct,
   * the name in the parallel OT list) and uses them for one rule that matters:
   * a Pokemon whose OTID differs from wPlayerID is TRADED, and a traded
   * Pokemon disobeys above your badge level. It is also the whole reason the
   * fields have to exist before any save is exported -- see
   * docs/RESEARCH-SAVE-EXCHANGE.md. Adding them afterwards would make every
   * earlier export disagree with every later one.
   */
  otId: number;
  otName: string;
  level: number;
  /** Current HP. 0 means fainted. */
  hp: number;
  maxHp: number;
  /** Unmodified stats: base + DV + stat experience + level. Never changes in battle. */
  stats: StatSet;
  /** The working stats: stages, badge boosts, burn and paralysis applied. */
  battleStats: BattleStats;
  stages: StatStages;
  /** Current types. Usually the species' own; Conversion rewrites them. */
  types: string[];
  moves: MoveSlot[];
  /** One of the STATUS_* constants. */
  status: string;
  /** Turns of sleep left. Only meaningful while status is STATUS_SLEEP. */
  sleepTurns: number;
  /** Gen 1 DVs, 0..15 each. hp is derived from the other four; see hpDv(). */
  ivs: StatSet;
  /** Stat experience, 0..65535 each. Wild Pokemon have none. */
  evs: StatSet;
  /** Total experience points. Party.ts turns this into a level. */
  exp: number;
  volatile: VolatileState;
  /**
   * How many times the badge boost has been applied to `battleStats`. Gen 1 never
   * resets this, so every stat change adds another 12.5% -- the badge boost bug.
   * 0 before send-out, 1 after it, and one more per recalculation. See Stats.ts.
   */
  badgeBoostPasses: number;
}

// ---------------------------------------------------------------------------
// Sides and the battle itself
// ---------------------------------------------------------------------------

/** One side of a battle: who is out, who is left, and how many badges they carry. */
export interface BattleSide {
  active: BattleMon;
  party: BattleMon[];
  /** Index into party of the active Pokemon. */
  activeIndex: number;
  /**
   * Badges earned, 0..8, in gym order. Only the player's side ever has any: Gen 1
   * boosts one stat per badge and skips the link-battle case entirely.
   */
  badgeBits: number;
  isPlayer: boolean;
  /** Trainer class id for a trainer battle, "" for a wild one. */
  trainerId: string;
  /** How many times the player has tried to run. Gen 1's escape odds use it. */
  escapeAttempts: number;
}

/** Everything a turn needs. `random` returns [0,1) and is the only entropy source. */
/** The two names a battle prints that are not in the bundle. */
export interface BattleNames {
  player: string;
  rival: string;
}

export interface BattleContext {
  /** The world bundle, for species, moves and the type chart. */
  bundle: any;
  player: BattleSide;
  foe: BattleSide;
  /** A wild encounter can be run from and caught; a trainer battle cannot. */
  isWild: boolean;
  /** Turn number, from 1. */
  turn: number;
  random: () => number;
  /**
   * wPlayerID, for CheckForDisobedience: a Pokemon whose otId is not this is
   * traded. Optional -- a battle built without it (every test's, a link one)
   * checks nothing, exactly as the cartridge skips the check in a link battle.
   */
  playerId?: number;
  /**
   * What the cartridge prints where wPlayerName and wRivalName would go: the
   * player's own name on the player's side, the rival's given name for his
   * three trainer classes. Optional -- a battle built without it prints RED
   * and the class name, which is what the tests expect.
   */
  names?: BattleNames;
  /**
   * An unidentified GHOST (battle/Ghost.ts): the tower, no SILPH SCOPE.
   * Neither side's move runs, a ball cannot catch it, and running always
   * works. Recomputed by the caller from the map and the bag, as the
   * cartridge recomputes it -- there is no flag.
   */
  ghost?: boolean;
  /**
   * The restless soul on the tower's sixth floor: MAROWAK, identified by the
   * SILPH SCOPE, fights like any wild Pokemon and still cannot be caught --
   * ItemUseBall tests the map and the species and takes the dodge
   * (item_effects.asm, RESTLESS_SOUL). She has to be beaten.
   */
  cantBeCaught?: boolean;
  /**
   * The restless soul met WITH the scope: the battle opens on the ghost --
   * "GHOST appeared!", "SILPH SCOPE unveiled the GHOST's identity!" -- and
   * only then on "Wild MAROWAK appeared!" (PrintBeginningBattleText .isMarowak).
   */
  unveiled?: boolean;
  /**
   * A SAFARI ZONE battle (script/Safari.ts). Nobody attacks, the menu is
   * BALL / BAIT / ROCK / RUN, running always works, and the POKeMON may bolt
   * at the end of any turn.
   */
  safari?: boolean;
  /** wEnemyMonCatchRate while a Safari battle runs: BAIT halves it, a ROCK doubles it. */
  safariRate?: number;
  /** Turns of eating left (wSafariBaitFactor, $CCE9). */
  safariEating?: number;
  /** Turns of sulking left (wSafariEscapeFactor, $CCE8). */
  safariAngry?: number;
}

// ---------------------------------------------------------------------------
// What a turn produces
// ---------------------------------------------------------------------------

/** A stat stage that a move moved, and by how much. */
export interface StageChange {
  /** One of the STAT_* constants. */
  stat: string;
  /** Signed stage delta actually applied, after clamping to -6..+6. */
  delta: number;
  /** True when the change landed on the user rather than the target. */
  onUser: boolean;
}

/**
 * The result of one Pokemon using one move. Everything the message box, the HP
 * bars and the AI need, and nothing they have to recompute.
 */
export interface MoveResult {
  /** Move id, key into bundle.moves. */
  move: string;
  /** The move was used at all: not asleep, not frozen, not flinched, PP left. */
  used: boolean;
  /** The accuracy roll passed. False when it missed, including the 1/256 miss. */
  hit: boolean;
  /** The move ran but could not do anything: "But it failed!" */
  failed: boolean;
  /** Total damage dealt to the target, summed over every hit. */
  damage: number;
  /** True when any hit of the move was critical. */
  critical: boolean;
  /** Type chart product: 0, 0.25, 0.5, 1, 2 or 4. 1 for a move with no type check. */
  effectiveness: number;
  /** Same-type attack bonus applied. */
  stab: boolean;
  /** How many times the move connected. 1 for an ordinary move, 2..5 for multi-hit. */
  hits: number;
  /** Recoil or crash damage the user took. */
  recoil: number;
  /** HP the user drained back. */
  drained: number;
  /** A STATUS_* the move inflicted on the target, or STATUS_NONE. */
  statusInflicted: string;
  stageChanges: StageChange[];
  targetFainted: boolean;
  userFainted: boolean;
  /** Message box lines, in order, already worded. */
  messages: string[];
}

// ---------------------------------------------------------------------------
// What a player or the AI chooses
// ---------------------------------------------------------------------------

export const ACTION_MOVE: string = "move";
export const ACTION_SWITCH: string = "switch";
export const ACTION_ITEM: string = "item";
export const ACTION_RUN: string = "run";
/** SAFARI ZONE only: the two things you throw that are not a ball. */
export const ACTION_BAIT: string = "bait";
export const ACTION_ROCK: string = "rock";

/** One side's choice for one turn. Unused fields carry -1 or "". */
export interface TurnAction {
  /** One of the ACTION_* constants. */
  kind: string;
  /** Move slot 0..3 for ACTION_MOVE, otherwise -1. */
  moveIndex: number;
  /** Party slot for ACTION_SWITCH, otherwise -1. */
  partyIndex: number;
  /** Item id for ACTION_ITEM, otherwise "". */
  item: string;
}

/** A do-nothing action, so callers never have to spell out the unused fields. */
export function noAction(): TurnAction {
  return { kind: "", moveIndex: -1, partyIndex: -1, item: "" };
}

/** The action for using move slot `slot`. */
export function moveAction(slot: number): TurnAction {
  return { kind: ACTION_MOVE, moveIndex: slot, partyIndex: -1, item: "" };
}

/** The action for switching to party slot `slot`. */
export function switchAction(slot: number): TurnAction {
  return { kind: ACTION_SWITCH, moveIndex: -1, partyIndex: slot, item: "" };
}
