// A small interpreter for the cartridge's event logic.
//
// This is the one part of the project that is written rather than read. The ROM's
// scripts are Game Boy machine code; this does not emulate, so they cannot be
// extracted the way maps and stats are. gen1recomp solved it by hand-porting every
// map's behaviour, and that is the model followed here.
//
// Scripts are therefore DATA -- arrays of commands -- rather than functions. That
// is deliberate: data can be diffed, reviewed and tested without touching the
// interpreter, and a ported map can be checked against the original by reading it.
//
// The VM is a coroutine driven a frame at a time. A command either finishes
// immediately or reports that it is still running, which is how a walking NPC or a
// message box waiting for a keypress suspends the script without blocking the
// render loop.

/** A command has run to completion. */
export const DONE: number = 0;
/** Still running; call again next frame. */
export const RUNNING: number = 1;
/** Suspended until something outside resumes it -- a battle, a menu. */
export const SUSPENDED: number = 2;
/**
 * The command moved the program counter itself; carry on without advancing it.
 *
 * A branch is not "still working", and reporting it as RUNNING made update()
 * return after every jump. The script then advanced one branch per frame, and a
 * loop could never exhaust its budget because the budget was never reached --
 * three separate test failures, one cause.
 */
export const JUMPED: number = 3;

/**
 * Every op `execute` implements.
 *
 * An unknown op is skipped with a print, which is right at runtime -- one bad
 * command should not freeze a lens -- and useless as a safety net, because a
 * script that carries on past a `hide_object` that never happened looks like a
 * working script with a wrong world. In a PORT an unknown op is a transcription
 * mistake, so script.test.mjs holds every ported command against this list and
 * fails the build instead.
 *
 * The names follow gen1recomp's data/scripts, so a port can be read beside its
 * source. The short aliases are what the ports written before that reference was
 * available used.
 */
export const KNOWN_OPS: string[] = [
  "label", "end", "jump", "jump_if_true", "jump_if_false",
  "check_flag", "check_item", "check_money", "set_flag", "clear_flag", "mark_seen",
  "check_coins", "give_coins", "take_coins", "check_dex_owned", "check_facing", "check_party",
  "random_byte", "check_bit", "check_byte",
  "beat_trainer", "set_respawn",
  "show_text", "ask", "text_sound",
  "give", "give_item", "take", "take_item", "take_money", "give_pokemon", "trade",
  "open_mart", "open_pc", "open_slots", "push_screen",
  "face_player", "face_player_dir", "move_player",
  "face", "face_object", "show", "hide_object", "show_object",
  "move", "move_npc", "walk_npc", "move_npc_to", "wait_npc", "place_npc",
  "battle", "start_battle", "check_battle_result", "check_caught", "static_battle",
  "warp", "heal_party", "cry", "play_cry",
  "play_music", "stop_music", "play_default_music",
  "fade", "play_once", "wait", "call", "emote",
];

/** Where an `ask` with no flag of its own parks the answer for one command. */
const ASK_SCRATCH_FLAG: string = "_ASK";

export interface ScriptCommand {
  op: string;
  /** Operand shapes are per-op and documented at each handler below. */
  [key: string]: any;
}

export interface ScriptHost {
  /** Turn the NPC being talked to toward the player. */
  facePlayer(): void;
  /**
   * Show a message and return DONE only once the player has read it.
   *
   * `ram` fills the line's {RAM:...} slot and `num` its {NUM:...} slot; pass ""
   * and -1 when the line has none. Both exist because the cartridge builds
   * "{PLAYER} got the {RAM}!" and "caught {NUM} kinds" at runtime, and a port
   * that cannot fill them prints the raw token.
   */
  showText(textId: string, ram: string, num: number): number;
  /** Yes/no prompt; sets the named flag from the answer. Slots as showText. */
  ask(textId: string, flag: string, ram: string, num: number): number;
  /** The display name of an item id, for a {RAM:} slot. The id itself if unknown. */
  itemName(item: string): string;
  /** Into the bag; false when it refused (twenty kinds already). */
  giveItem(item: string, count: number): boolean;
  takeItem(item: string, count: number): void;
  hasItem(item: string, count: number): boolean;
  /** True when a Pokemon of this species is in the party. Optional: older hosts answer no. */
  hasInParty?(species: string): boolean;
  /** True when the player can pay at least `amount`; used by check_money. */
  hasMoney(amount: number): boolean;
  /** Game Corner coins. Separate from money, capped at 9999, never negative. */
  hasCoins(amount: number): boolean;
  giveCoins(amount: number): void;
  takeCoins(amount: number): void;
  /** How many species are marked owned; what Oak's aides count. */
  dexOwnedCount(): number;
  /** Which way the player faces: "up", "down", "left" or "right". */
  playerFacing(): string;
  /** A fresh byte of the game's random stream, for a script that rolls (hRandomAdd). */
  randomByte?(): number;
  /** The Poke Mart. RUNNING while the shop is open; DONE once the player leaves. */
  openMart(clerkTextId: string): number;
  openPc(kind: string): number;
  openSlots(chance: number): number;
  /**
   * The one screen push_screen supports: DexEntryMenu, the Pokedex data page.
   * SUSPENDED until the page is closed with its measured presses, DONE at
   * once for an unknown screen or species -- the same shape as nameEntry().
   */
  pushScreen(screen: string, species: string, textId?: string): number;
  /** Walk an npc along a path of directions; DONE when it arrives. */
  moveNpc(npc: string, path: string[]): number;
  faceNpc(npc: string, direction: string): void;
  /**
   * Show or hide an NPC, possibly on ANOTHER map.
   *
   * Beating Brock hides a youngster in Pewter City and the rival on Route 22 --
   * neither of them the map the player is standing on. A reveal keyed by name
   * alone cannot express that, and would hide whatever happened to share the
   * name here.
   */
  showNpc(mapId: string, npc: string, visible: boolean): void;
  /** Walk the PLAYER, as the sleeping old man does when he shoves you back. */
  movePlayer(direction: string, steps: number): number;
  /** Turn the player to face a direction, without moving them. */
  facePlayerDir(direction: string): void;
  /** Walk an npc a number of steps in one direction. */
  walkNpc(npc: string, direction: string, steps: number): number;
  /** Raise the mark over an NPC's head; DONE once its frames are up. */
  emote(npc: string, kind: string): number;
  /** Walk an npc to a cell. */
  moveNpcTo(npc: string, x: number, y: number): number;
  /** Put an NPC on a cell at once; see NpcMotion.place. */
  placeNpc(npc: string, x: number, y: number, facing: string): void;
  playMusic(track: string): void;
  stopMusic(): void;
  /** Back to whatever this map plays. */
  playDefaultMusic(): void;
  /** A one-shot sound played with a text box, e.g. the badge fanfare. */
  textSound(name: string): void;
  /**
   * Put a Pokemon in the party, or in the PC box when the party is full.
   *
   * RUNNING while the box line is on screen, so this is not a one-shot: a
   * boxed gift pages "sent to POKeMON BOX 1 on PC!" before the script goes on.
   * giveLanded() reports whether it landed ANYWHERE, and the scripts that hand
   * a Pokemon over -- the dojo, the fossils, the Magikarp salesman -- branch on
   * exactly that, the way the cartridge's GivePokemon returns carry.
   */
  givePokemon(species: string, level: number): number;
  /** Whether the last givePokemon found room. What give_pokemon compares on. */
  giveLanded(): boolean;
  /** Resolve one cartridge in-game trade. `index` is 1-based. */
  trade(index: number, flag: string): number;
  /** True when the player won the battle that just finished. */
  battleWon(): boolean;
  battleCaught(): boolean;
  /** Record a trainer as beaten: their event bit and the per-object record. */
  beatTrainer(mapId: string, npc: string, flag: string): void;
  /** Record a dex sighting, as the Fuchsia zoo signs do. */
  markSeen(species: string): void;
  /** Hands off to the battle engine; SUSPENDED until it returns. */
  startTrainerBattle(trainer: string, party: number): number;
  /**
   * A fixed Pokemon standing in the world: Mewtwo, the three birds, Snorlax.
   *
   * Not a trainer battle and not a grass roll -- the species and the level are
   * written into the script, and the flag is set only if the player WINS.
   * Running from one leaves it where it stands, which is the whole reason
   * Snorlax and the birds can be fought again.
   */
  startStaticBattle(species: string, level: number, flag: string): number;
  /** Take money from the player. Clamped at zero; the cartridge does not lend. */
  takeMoney(amount: number): void;
  warp(map: string, warp: number): void;
  /** Warp to a cell rather than a warp index; see the `warp` op. */
  warpTo(map: string, x: number, y: number, facing: string): void;
  healParty(): void;
  /** Make here the place a whiteout returns to: the cartridge's SetLastBlackoutMap. */
  setRespawnHere(): void;
  playCry(species: string): void;
  /** Screen fade, as the original uses around healing and cutscenes. */
  fade(direction: string, colour: string): number;
  /** Play a jingle once and wait for it, e.g. the healing chime. */
  playOnce(track: string): number;
  /**
   * Run a named routine the host provides, returning DONE when it finishes.
   *
   * Not every script fits a command list. The reference writes its gym leaders and
   * its intro cutscene as functions, because a TM handoff that must survive a full
   * bag and retry, or a cutscene that drives two actors and the camera at once, is
   * control flow rather than a sequence. Rather than grow the vocabulary until it
   * is a programming language, those live in the host as named routines and the
   * data refers to them -- so the common case stays diffable and the hard case
   * stays honest about being code.
   */
  call(routine: string, argument: string): number;
  /** Frames elapsed, so `wait` does not need its own clock. */
  frames(): number;
}

/** Story flags. Plain object rather than a Set, which Lens Studio forbids. */
export interface FlagStore {
  [flag: string]: boolean;
}

export class ScriptVM {
  private host: ScriptHost;
  private flags: FlagStore;

  private program: ScriptCommand[] = null;
  private pc: number = 0;
  private waitUntilFrame: number = 0;
  /** Set while a command has told us it is not finished. */
  private busy: boolean = false;
  /**
   * The comparison register.
   *
   * The original's scripts are assembly: they test something, then branch on the
   * result of the last test. Keeping that shape -- check_flag followed by
   * jump_if_true -- rather than folding it into a single branch command is what
   * makes porting the other eighty-odd maps a transcription instead of a
   * translation, and a transcription can be checked against the source line by line.
   */
  private compare: boolean = false;
  /** The byte the last random_byte drew; check_bit reads it. */
  private rolled: number = 0;

  /**
   * Named jump targets, built once when a script starts.
   *
   * A numeric target is an index into an array, so inserting a command silently
   * repoints every jump past it -- and the jump still lands INSIDE the program,
   * so a bounds check cannot see it. Porting Pewter Gym needed one renumbering
   * already; across eighty-odd maps that is a guaranteed source of scripts that
   * run to the wrong place. Numeric targets still work, because the ports that
   * exist use them, but every new port should use labels.
   */
  private labels: any = {};

  constructor(host: ScriptHost, flags: FlagStore) {
    this.host = host;
    this.flags = flags;
  }

  isRunning(): boolean {
    return this.program !== null;
  }

  /** Starts a script. Refuses to interrupt one already running. */
  start(program: ScriptCommand[]): boolean {
    if (this.program !== null || !program || program.length === 0) {
      return false;
    }
    this.program = program;
    this.pc = 0;
    this.busy = false;
    // A fresh program starts with a fresh condition. It used to inherit the
    // previous script's, so a program whose first branch precedes any check
    // read whatever the last conversation left behind.
    this.compare = false;
    this.labels = {};
    for (let i = 0; i < program.length; i++) {
      const c = program[i];
      if (c.op === "label" && c.name) {
        this.labels[c.name] = i;
      }
    }
    return true;
  }

  stop(): void {
    this.program = null;
    this.pc = 0;
    this.busy = false;
  }

  getFlag(flag: string): boolean {
    return this.flags[flag] === true;
  }

  setFlag(flag: string, value: boolean): void {
    this.flags[flag] = value;
  }

  /**
   * Runs until the script blocks or ends.
   *
   * Commands are executed in a loop rather than one per frame, because a run of
   * flag checks and item gives should not each cost a frame. Anything that takes
   * time reports RUNNING and breaks the loop.
   */
  update(): void {
    if (this.program === null) {
      return;
    }
    // A guard against a script that loops without ever blocking. Hitting it is a
    // bug in the script, and stopping loudly beats freezing the lens.
    let budget = 256;
    while (this.program !== null && budget > 0) {
      budget--;
      if (this.pc >= this.program.length) {
        this.stop();
        return;
      }
      const command = this.program[this.pc];
      const state = this.execute(command);
      if (state === DONE) {
        this.pc++;
        this.busy = false;
      } else if (state === JUMPED) {
        // The counter already moved; keep going in this same frame.
        this.busy = false;
      } else {
        this.busy = true;
        return;
      }
    }
    if (budget === 0) {
      print("[ScriptVM] script ran 256 commands without blocking; stopping");
      this.stop();
    }
  }

  /**
   * A jump target as an index, or -1 when the script should simply stop.
   *
   * "end" stops. A name is looked up; a name that is not there is a porting
   * mistake, and stopping loudly beats jumping to command zero and replaying the
   * conversation from the top forever.
   */
  private resolve(to: any): number {
    if (to === "end") {
      this.stop();
      return -1;
    }
    if (typeof to === "number") {
      if (to < 0 || !this.program || to >= this.program.length) {
        print("[ScriptVM] jump to " + to + " is outside the program; stopping");
        this.stop();
        return -1;
      }
      return to;
    }
    const named = this.labels[to];
    if (typeof named !== "number") {
      print("[ScriptVM] no label named '" + to + "'; stopping");
      this.stop();
      return -1;
    }
    return named;
  }

  /**
   * The {RAM:} value for a text command.
   *
   * `ram` is the words themselves; `ramItem` is an item ID the host turns into
   * its display name at runtime. Ports use the second, so that the generated
   * script names "TM_SWIFT" and the cartridge supplies "TM39".
   */
  private ramOf(command: ScriptCommand): string {
    if (command.ram) {
      return command.ram;
    }
    if (command.ramItem) {
      return this.host.itemName(command.ramItem);
    }
    return "";
  }

  /** The {NUM:} value for a text command, or -1 when the command carries none. */
  private numOf(command: ScriptCommand): number {
    return typeof command.num === "number" ? command.num : -1;
  }

  private execute(command: ScriptCommand): number {
    const op = command.op;

    if (op === "text" || op === "show_text") {
      return this.host.showText(command.textId, this.ramOf(command), this.numOf(command));
    }

    if (op === "face_player") {
      this.host.facePlayer();
      return DONE;
    }

    if (op === "check_flag") {
      this.compare = this.flags[command.flag] === true;
      return DONE;
    }

    if (op === "check_item") {
      this.compare = this.host.hasItem(command.item, command.count ? command.count : 1);
      return DONE;
    }

    // Whether a species is in the party: Yellow's Melanie reads her PIKACHU's
    // happiness, which the lens does not keep -- having him along stands in.
    if (op === "check_party") {
      this.compare = this.host.hasInParty ? this.host.hasInParty(command.species) : false;
      return DONE;
    }

    if (op === "check_money") {
      this.compare = this.host.hasMoney(command.amount);
      return DONE;
    }

    if (op === "check_coins") {
      this.compare = this.host.hasCoins(command.amount ? command.amount : 0);
      return DONE;
    }

    if (op === "give_coins") {
      this.host.giveCoins(command.amount ? command.amount : 0);
      return DONE;
    }

    if (op === "take_coins") {
      this.host.takeCoins(command.amount ? command.amount : 0);
      return DONE;
    }

    // { op: "check_dex_owned", count } -- true when at least `count` species are
    // owned. Oak's aides gate their gifts on it.
    if (op === "check_dex_owned") {
      this.compare = this.host.dexOwnedCount() >= (command.count ? command.count : 0);
      return DONE;
    }

    // { op: "check_facing", direction } -- the binoculars in the gate houses
    // only say something when you look up through them.
    if (op === "check_facing") {
      this.compare = this.host.playerFacing() === command.direction;
      return DONE;
    }

    // { op: "random_byte" } then { op: "check_bit", bit } -- one draw, tested
    // bit by bit, the way le CHEF picks the main course: hRandomAdd is read
    // ONCE and bit 7 then bit 4 of the same byte decide (SSAnneKitchen.asm
    // :43-54). Two draws would give the same odds and a different answer from
    // the cartridge's. A host without a random source rolls 0: every bit
    // clear, the last branch.
    if (op === "random_byte") {
      this.rolled = this.host.randomByte ? this.host.randomByte() & 0xff : 0;
      return DONE;
    }
    if (op === "check_bit") {
      this.compare = (this.rolled & (1 << command.bit)) !== 0;
      return DONE;
    }
    // { op: "check_byte", atLeast } -- the other way the cartridge reads a
    // drawn byte: the woman in Cerulean picks one of three lines by comparing
    // hRandomAdd against 180 and then against 100, both against the SAME byte,
    // which is why the draw is its own op.
    if (op === "check_byte") {
      this.compare = this.rolled >= (command.atLeast ? command.atLeast : 0);
      return DONE;
    }

    if (op === "jump_if_true" || op === "jump_if_false") {
      const wanted = op === "jump_if_true";
      if (this.compare === wanted) {
        const target = this.resolve(command.to);
        if (target < 0) {
          return DONE;
        }
        this.pc = target;
        return JUMPED;
      }
      return DONE;
    }

    // { op: "ask", textId, flag? } -- a yes/no box. The answer lands in the
    // named flag AND in the condition, so both spellings work:
    //
    //   ask / check_flag / jump_if_false      (the hand-written ports)
    //   ask / jump_if_false                   (the reference, and every transcription)
    //
    // It used to set only the flag. Every transcribed question -- the Magikarp
    // salesman, the rod houses, the little girl in Lavender -- then branched on
    // whatever the previous check had left in the condition, which at the top
    // of a script is false: the answer was read and ignored. A question with no
    // flag of its own uses a scratch one that is removed again, so it does not
    // land in the save.
    if (op === "ask") {
      const flag = command.flag ? command.flag : ASK_SCRATCH_FLAG;
      const result = this.host.ask(command.textId, flag, this.ramOf(command), this.numOf(command));
      if (result === DONE) {
        this.compare = this.flags[flag] === true;
        if (flag === ASK_SCRATCH_FLAG) {
          delete this.flags[flag];
        }
      }
      return result;
    }

    // { op: "give_item", item, count?, noRoom? } -- into the bag. When the bag
    // refuses, the no-room line (the script's own, else the cartridge's
    // general one) is shown and the script STOPS, as the reference's does and
    // as pokered's `jr nc, .bag_full` does: a set_flag after this row must
    // not burn the gift. Nine transcribed scripts -- the captain's HM01, the
    // warden's HM04, Mr Fuji's flute, Bill's ticket -- gave and then flagged
    // with nothing in between; they were one full bag away from losing the
    // item for good. Re-executed every frame while the line pages, which is
    // harmless: the bag keeps refusing and the box keeps its place.
    if (op === "give" || op === "give_item") {
      if (this.host.giveItem(command.item, command.count ? command.count : 1)) {
        return DONE;
      }
      const line = command.noRoom ? command.noRoom : "_NoMoreRoomForItemText";
      const paged = this.host.showText(line, "", -1);
      if (paged === DONE) {
        this.stop();
        return DONE;
      }
      return paged;
    }

    if (op === "take" || op === "take_item") {
      this.host.takeItem(command.item, command.count ? command.count : 1);
      return DONE;
    }

    if (op === "setFlag" || op === "set_flag") {
      this.flags[command.flag] = command.value !== false;
      return DONE;
    }

    if (op === "ifFlag") {
      // Jumps to `then` when set, `else` when not. Absent targets fall through.
      const set = this.flags[command.flag] === true;
      const target = set ? command.then : command.otherwise;
      if (typeof target === "number") {
        this.pc = target;
        return JUMPED;
      }
      return DONE;
    }

    if (op === "ifItem") {
      const has = this.host.hasItem(command.item, command.count ? command.count : 1);
      const target = has ? command.then : command.otherwise;
      if (typeof target === "number") {
        this.pc = target;
        return JUMPED;
      }
      return DONE;
    }

    if (op === "label") {
      // A marker, not an instruction.
      return DONE;
    }

    if (op === "jump") {
      const target = this.resolve(command.to);
      if (target < 0) {
        return DONE;
      }
      this.pc = target;
      return JUMPED;
    }

    if (op === "move") {
      // `async: true` starts the walk and moves on, so the player can be
      // walked behind an NPC that leads (Oak to his lab); `wait_npc` below
      // is where such a script catches up with it.
      const status = this.host.moveNpc(command.npc, command.path);
      return command.async === true ? DONE : status;
    }
    if (op === "wait_npc") {
      // NpcMotion answers RUNNING for a walk in flight whatever path is
      // offered, and DONE at once when nothing is.
      return this.host.moveNpc(command.npc, []);
    }

    if (op === "face") {
      this.host.faceNpc(command.npc, command.direction);
      return DONE;
    }

    // The reference's own names, which is what a transcription writes. The
    // shorter aliases below are what the ports written before it used.
    if (op === "hide_object" || op === "show_object") {
      this.host.showNpc(command.map ? command.map : "", command.npc,
                        op === "show_object");
      return DONE;
    }

    if (op === "face_object") {
      this.host.faceNpc(command.npc, command.direction);
      return DONE;
    }

    if (op === "move_player") {
      return this.host.movePlayer(command.direction, command.steps ? command.steps : 1);
    }

    if (op === "face_player_dir") {
      this.host.facePlayerDir(command.direction);
      return DONE;
    }

    // { op: "walk_npc", npc, direction, steps? } -- steps defaults to one, but
    // an explicit zero is zero: TrainerWalkUpToPlayer hands over distance - 1,
    // and a trainer who is already adjacent must not take the step that would
    // put him on the player's tile.
    if (op === "walk_npc") {
      return this.host.walkNpc(command.npc, command.direction,
                               typeof command.steps === "number" ? command.steps : 1);
    }

    // { op: "emote", npc, kind } -- predef EmotionBubble. It BLOCKS on the
    // cartridge (sixty frames of DelayFrames before the walk starts), which is
    // why the status comes back rather than being thrown away: a mark the
    // trainer walks out from under is not a warning.
    if (op === "emote") {
      return this.host.emote(command.npc, command.kind ? command.kind : "shock");
    }

    if (op === "move_npc_to") {
      return this.host.moveNpcTo(command.npc, command.x, command.y);
    }

    // { op: "place_npc", npc, x, y, facing? } -- put an NPC on a cell at once,
    // the way the cartridge sets a sprite's coordinates before a cutscene
    // walks it in. Works on a hidden NPC too, so a show_object right after
    // draws it where it was placed and never, for a frame, where it ships.
    if (op === "place_npc") {
      this.host.placeNpc(command.npc, command.x, command.y,
                         command.facing ? command.facing : "down");
      return DONE;
    }

    if (op === "play_music") {
      this.host.playMusic(command.track);
      return DONE;
    }

    if (op === "stop_music") {
      this.host.stopMusic();
      return DONE;
    }

    if (op === "play_default_music") {
      this.host.playDefaultMusic();
      return DONE;
    }

    if (op === "text_sound") {
      this.host.textSound(command.name ? command.name : command.track);
      return DONE;
    }

    if (op === "give_pokemon") {
      // Sets the condition, like the cartridge's GivePokemon sets carry: a
      // jump_if_false right after it is the "box is full" branch. Two-phase,
      // because a Pokemon sent to the box pages a line before the script goes
      // on; the condition is read only once that line has been read.
      const given = this.host.givePokemon(command.species, command.level ? command.level : 5);
      if (given === RUNNING || given === SUSPENDED) {
        return given;
      }
      this.compare = this.host.giveLanded() === true;
      return DONE;
    }

    if (op === "trade") {
      return this.host.trade(command.index, command.flag);
    }

    if (op === "open_mart") {
      return this.host.openMart(command.textId);
    }

    // { op: "open_pc", kind } -- the PC tile the player is facing. Like
    // open_mart, the screen belongs to the lens and the script waits here
    // until the player logs off.
    if (op === "open_pc") {
      return this.host.openPc(command.kind ? command.kind : "");
    }

    // { op: "open_slots", value } -- a GAME CORNER machine, `value` being its
    // own seven-and-bar threshold. Like open_pc, the screen belongs to the
    // lens and the script waits here until the player walks away from it.
    if (op === "open_slots") {
      return this.host.openSlots(typeof command.value === "number" ? command.value : 0);
    }

    if (op === "push_screen") {
      return this.host.pushScreen(command.screen, command.species, command.textId);
    }

    if (op === "check_battle_result") {
      this.compare = this.host.battleWon();
      return DONE;
    }

    // { op: "check_caught" } -- wBattleResult == 2, which a win alone cannot
    // tell you. The SNORLAX scripts are the reason it exists: caught, it did
    // not calm down and wander back to the mountains.
    if (op === "check_caught") {
      this.compare = this.host.battleCaught();
      return DONE;
    }

    // { op: "beat_trainer", map, npc, flag } -- after check_battle_result and
    // its jump, never before: a loss or a refused battle must record nothing.
    if (op === "set_respawn") {
      this.host.setRespawnHere();
      return DONE;
    }

    if (op === "beat_trainer") {
      this.host.beatTrainer(command.map ? command.map : "", command.npc,
                            command.flag ? command.flag : "");
      return DONE;
    }

    if (op === "mark_seen") {
      this.host.markSeen(command.species);
      return DONE;
    }

    if (op === "static_battle") {
      // The FLAG goes to the host, which is the only thing that knows whether a
      // battle happened at all. Deciding here on battleWon() alone set the flag
      // for a battle that was REFUSED -- an empty party, a species the bundle
      // lacks -- and battleWon() still reported the previous battle. Mewtwo
      // would have been marked beaten because you had nothing to send out.
      return this.host.startStaticBattle(command.species, command.level,
                                         command.flag ? command.flag : "");
    }

    if (op === "take_money") {
      this.host.takeMoney(command.amount ? command.amount : 0);
      return DONE;
    }

    if (op === "clear_flag") {
      this.flags[command.flag] = false;
      return DONE;
    }

    if (op === "show") {
      this.host.showNpc("", command.npc, command.visible !== false);
      return DONE;
    }

    // { op: "start_battle", trainer, party? } -- party is the 1-based roster
    // index the cartridge keys every trainer by (OPP_LASS has eighteen). It
    // used to be dropped on the floor and every scripted battle fought roster 1.
    if (op === "battle" || op === "start_battle") {
      return this.host.startTrainerBattle(command.trainer, command.party ? command.party : 1);
    }

    if (op === "warp") {
      // Two shapes. A transcribed script warps by CELL, because the cartridge's
      // scripted warps name a coordinate and a facing; a hand-written one may
      // warp by warp INDEX, which is what stepping onto a warp tile does. They
      // are not interchangeable: reading a coordinate as an index lands the
      // player on whatever warp happens to sit at that number.
      if (typeof command.x === "number" && typeof command.y === "number") {
        this.host.warpTo(command.map, command.x, command.y,
                         command.facing ? command.facing : "");
      } else {
        this.host.warp(command.map, command.warp);
      }
      return DONE;
    }

    if (op === "call") {
      return this.host.call(command.routine, command.argument);
    }

    if (op === "fade") {
      return this.host.fade(command.direction, command.colour);
    }

    if (op === "play_once") {
      return this.host.playOnce(command.track);
    }

    if (op === "heal" || op === "heal_party") {
      this.host.healParty();
      return DONE;
    }

    if (op === "cry" || op === "play_cry") {
      this.host.playCry(command.species);
      return DONE;
    }

    if (op === "wait") {
      if (!this.busy) {
        this.waitUntilFrame = this.host.frames() + command.frames;
      }
      return this.host.frames() >= this.waitUntilFrame ? DONE : RUNNING;
    }

    if (op === "end") {
      this.stop();
      return DONE;
    }

    print("[ScriptVM] unknown command '" + op + "'; skipping");
    return DONE;
  }
}
