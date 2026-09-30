// What happens between the overworld and a script running.
//
// PokemonAR owns the scene: cameras, meshes, the message box, the battle stage.
// This owns the game: the save, the VM, the host, and the rule that while a
// script is running the player is not walking.
//
// Kept out of PokemonAR.ts deliberately. That file is nine hundred lines of
// presentation and the two concerns pull in different directions -- one wants
// SceneObjects, the other wants to be testable without any.

import { dayCareStep } from "./DayCare";
import { cartridgeVersion } from "../world/Cartridge";
import type { CartridgeVersion } from "../world/Cartridge";
import type { MapDef, WorldBundle } from "../world/WorldData";
import type { Overworld, StepResult, WildEncounter } from "./Overworld";
import { facingTarget } from "./script/Dialogue";
import { wallScript, bookshelfScript } from "./script/Bookshelves";
import { quizScript } from "./script/CinnabarQuiz";
import { dexOwnedCount } from "./PlayState";
import { enterScriptFor, faceTriggersFor, healZoneAt, healZoneFlags, introScript, inQuietZone,
         pickStepTrigger, sightScanOff, stepTriggersFor, talkScript } from "./script/MapScripts";
import { sightingAt, sightingScript } from "./script/TrainerSight";
import type { StepTrigger } from "./script/MapScripts";
import { itemBallScript } from "./script/ItemBall";
import type { ItemUseOutcome } from "./ItemUse";
import { itemUsableOutside, repelBlocks, repelStep, useItemOutside } from "./ItemUse";
import { benchGuyScript, gymStatueScript, hiddenCoinScript, hiddenItemScript,
         printTrashScript } from "./script/HiddenThings";
import type { TrashCanState } from "./script/TrashCans";
import { MAP_VERMILION_CITY, canAt, newTrashCanState, rollFirstCan, searchCan } from "./script/TrashCans";
import { itemIdOf } from "../world/WorldData";
import { GANGWAY_CELLS, MAP_VERMILION_DOCK, SHIP_GONE_BLOCKS, shipBlocksAfter, shipHasSailed }
  from "./script/Sailing";
import { bikeAllowed, forcesBike, forcesSurf, isSlopeMap, TEXT_CYCLING_IS_FUN } from "./Bike";
import { spinnerAt, spinnerScript } from "./Spinners";
import { elevatorFor } from "./script/Elevators";
import { EVENT_IN_SAFARI, EVENT_SAFARI_OVER, MAP_SAFARI_GATE, inSafariZone,
         safariOverScript } from "./script/Safari";
import { EVENT_MANSION_SWITCH_ON, mansionOverrides, mansionSwitchAt,
         mansionSwitchScript } from "./script/Mansion";
import { CHANCE_LUCKY, CHANCE_ORDINARY, TEXT_NO_CASE, TEXT_NO_COINS, TEXT_PLAY,
         hasSlotMachines, luckyMachine, slotMachineAt, slotStateText } from "./script/Slots";
import type { ScriptCommand } from "./script/ScriptVM";
import { trainerHeaderFor, trainerTalkScript } from "./script/TrainerTalk";
import { ScriptVM } from "./script/ScriptVM";
import type { HostServices } from "./script/Host";
import { PlayHost } from "./script/Host";
import type { PlayState } from "./PlayState";
import { canFight, hasItem, isTrainerDefeated } from "./PlayState";
import { rowIsOpen } from "../world/BlockOverrides";
import { PC_KIND_FULL, PC_KIND_HOME } from "./PcController";
import type { BoulderPush, FieldMoveOutcome } from "./FieldMoves";
import {
  badgeIndexOf, boulderHolesFor, boulderSwitchesFor, darkEntryMapOf, FIELD_MOVE_BADGES,
  fieldMovesOf, isFlyTown, mapEnterClearsFor, ROUTINE_CUT, ROUTINE_FLASH,
  ROUTINE_FLY, ROUTINE_STRENGTH, ROUTINE_SURF, TEXT_CAN_MOVE_BOULDERS,
  TEXT_CANNOT_FLY_HERE, TEXT_FLASH_LIGHTS, TEXT_NEW_BADGE_REQUIRED,
  TEXT_NO_PLACE_TO_GET_OFF, TEXT_NO_SURFING_HERE, TEXT_NOTHING_TO_CUT,
  TEXT_SURFING_GOT_ON, TEXT_USED_CUT, TEXT_USED_STRENGTH,
} from "./FieldMoves";

/** The bag item the coins on the floor need before they are even noticed. */
const COIN_CASE: string = "COIN_CASE";

export interface LandingOutcome {
  /** A warp was taken; the caller rebuilds the world. */
  warped: boolean;
  /** What to fight, or null. */
  encounter: WildEncounter;
}

export class PlayLoop {
  private bundle: WorldBundle;
  /** Which script family the bundle's cartridge belongs to; asked once, here. */
  private version: CartridgeVersion;
  private state: PlayState;
  private host: PlayHost;
  private vm: ScriptVM;

  /**
   * NPCs a script has shown or hidden, by "MAP:NAME".
   *
   * Separate from MapObject.hidden, which is the state the cartridge SHIPS the
   * object in and never changes. Reading only the shipped flag leaves an NPC a
   * script revealed visible, solid and permanently untalkable.
   *
   * This IS the save's objectToggles, held by reference like the flag store, so
   * a hide survives a save and a reload. It used to be a field of this class,
   * and every hidden NPC came back with the next session.
   */
  private revealed: any;

  private services: HostServices;

  /**
   * Vermilion Gym's two switch cans. WRAM on the cartridge, transient here:
   * the first is rolled on entering Vermilion City (VermilionCity.asm:16-21)
   * and the second when the first is found; the two lock FLAGS are the save's.
   */
  private trashCans: TrashCanState = newTrashCanState();

  /**
   * Whether the map before this one was outdoors, for the one rule that needs
   * it: the tunnel goes dark on the way IN from outside and on no other entry.
   * Remembered as a boolean rather than a map id so this file can keep the
   * world module as a type-only import.
   */
  private cameFromOutside: boolean = false;
  /** Which GAME CORNER machine is the lucky one this visit; see enteredMap. */
  private lucky: number = 0;
  /** The map the last entry came FROM. Overworld.lastMapId is the last
   *  OUTDOOR map, which the palette rule wants and a lift does not. */
  private cameFrom: string = "";
  /** The bundle's overrides with the mansion's merged in; built on first use. */
  private overrides: any = null;

  constructor(bundle: WorldBundle, state: PlayState, services: HostServices) {
    this.bundle = bundle;
    this.version = cartridgeVersion(bundle.romSha1);
    this.state = state;
    this.services = services;
    if (!state.objectToggles) {
      state.objectToggles = {};
    }
    if (!state.defeatedTrainers) {
      state.defeatedTrainers = {};
    }
    this.revealed = state.objectToggles;
    this.applyImpliedToggles();
    this.host = new PlayHost(bundle, state, this.wrapServices(services));
    // The VM holds the flag store BY REFERENCE, so what it writes lands in the
    // save without anything having to copy it across.
    this.vm = new ScriptVM(this.host, state.flags);
  }

  /**
   * Toggles a flag already implies, re-applied on load.
   *
   * A cartridge script that sets a flag and toggles an object with no branch
   * between them makes the two one fact. A save written by a build whose
   * script only set the flag carries the flag and not the toggle, and no
   * later step can put it right: the script that owed the toggle has already
   * run and will never run again. So the implication is asserted here, once,
   * every load -- idempotent, and the place a later one goes.
   *
   * Today there is one. OaksLabOakGivesPokedexScript sets EVENT_GOT_POKEDEX
   * and then HideObject TOGGLE_LYING_OLD_MAN / ShowObject TOGGLE_OLD_MAN,
   * which is what gets the sleeper off Viridian's north road and stands the
   * walking old man on (17,5).
   */
  private applyImpliedToggles(): void {
    const flags = this.state.flags;
    if (flags.EVENT_GOT_POKEDEX !== true) {
      return;
    }
    this.setRevealed("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN_SLEEPY", false);
    if (this.version !== "yellow") {
      this.setRevealed("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN", true);
      return;
    }
    // Yellow's Pokedex stands the tutorial man on the sleeper's cell
    // (TOGGLE_OLD_MAN_2); Red's walker comes later, from the mart, once the
    // lesson is done (ViridianMart.asm:60-69), and the lesson done without
    // the mart yet leaves neither of them standing (ViridianCity.asm:249).
    if (flags.EVENT_SPAWNED_OLD_MAN_1 === true) {
      this.setRevealed("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN2", false);
      this.setRevealed("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN", true);
    } else if (flags.EVENT_COMPLETED_CATCH_TRAINING === true) {
      this.setRevealed("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN2", false);
      this.setRevealed("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN", false);
    } else {
      this.setRevealed("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN", false);
      this.setRevealed("VIRIDIAN_CITY", "VIRIDIANCITY_OLD_MAN2", true);
    }
  }

  /**
   * The services with the reveal write owned HERE.
   *
   * hide_object and a Victory's hidden NPCs both arrive as setNpcRevealed. The
   * lens used to write the save's toggle in its own callback and nothing else
   * did, so in every headless test the hide "happened" in the fake and the
   * save stayed empty -- a Victory whose hides stopped persisting would have
   * stayed green. The loop writes the toggle, then the lens redraws.
   */
  private wrapServices(services: HostServices): HostServices {
    const loop = this;
    // Forwarders, not copies: a caller may swap a service after the loop is
    // built (the tests do, to park a page), and a copy would keep the old one.
    const wrapped: any = {};
    for (const key in services) {
      const name = key;
      if (typeof (services as any)[name] === "function") {
        wrapped[name] = (...args: any[]) => (services as any)[name].apply(services, args);
      } else {
        wrapped[name] = (services as any)[name];
      }
    }
    wrapped.setNpcRevealed = (mapId: string, npc: string, visible: boolean) => {
      const onMap = mapId ? mapId : services.currentMap().id;
      loop.setRevealed(onMap, npc, visible);
      services.setNpcRevealed(onMap, npc, visible);
    };
    // wLastMap, for the nurse's set_respawn: the world this loop is attached
    // to already tracks the last outdoor map, so no harness has to supply it.
    wrapped.lastOutdoorMap = () => (loop.world !== null ? loop.world.lastMapId : "");
    // FLASH: the save remembers the lights are on, so a reload inside the lit
    // tunnel comes back lit (the offset is inside the block save.asm copies).
    wrapped.lightArea = () => {
      loop.state.darkened = false;
      if (loop.world !== null) {
        loop.world.darkened = false;
      }
      services.lightArea();
    };
    // The `sail_ship` routine: the dock's blocks change under a running script,
    // so the terrain is redrawn at once rather than on the next map entry.
    // The world is this loop's to change; the caller's own service still sees
    // it, the way setNpcRevealed's does, so a harness can record the change.
    wrapped.overrideWarp = (x: number, y: number, destMap: string, destWarp: number) => {
      if (loop.world !== null) {
        loop.world.overrideWarp(x, y, destMap, destWarp);
      }
      if (services.overrideWarp) {
        services.overrideWarp(x, y, destMap, destWarp);
      }
    };
    wrapped.shipSailed = () => {
      if (loop.world !== null && loop.world.mapId === MAP_VERMILION_DOCK) {
        loop.stampShipGone(loop.world);
        services.redrawTerrain();
      }
    };
    wrapped.shipMoved = (shift: number) => {
      if (loop.world !== null && loop.world.mapId === MAP_VERMILION_DOCK) {
        loop.stampShipAt(loop.world, shift);
        services.redrawTerrain();
      }
    };
    return wrapped as HostServices;
  }

  /** True while a script is running: the overworld must not move or roll. */
  isBusy(): boolean {
    return this.vm.isRunning();
  }

  /**
   * True once the page on screen right now (if any) has finished printing at
   * the save's own text speed, so a press may acknowledge it. See
   * PlayHost.textReady(); a battle's own box does not run through this host,
   * so this is always true while one is up and callers need no special case
   * for it.
   */
  textReady(): boolean {
    return this.host.textReady();
  }

  /**
   * Hand the world what the save owns: the reveal store, and the block
   * override table read against the live flags. Called once by the lens after
   * constructing both, and by the tests.
   */
  /**
   * Bind the per-map hook and run it once for the map already loaded.
   *
   * Overworld calls onMapEntered at the end of every enterMap, but the first
   * one happens inside its constructor, before anything can be bound. Without
   * this call the boot map is never marked visited and a switch a flag has
   * already opened stays shut until the player leaves and comes back.
   */
  bindWorld(world: Overworld): void {
    const loop = this;
    world.onMapEntered = (w: Overworld) => { loop.enteredMap(w); };
    this.enteredMap(world);
  }

  /**
   * Everything a map entry owes the save: the town is remembered for FLY, the
   * flags this map clears are dropped, and every switch whose flag is already
   * set is stamped back onto the fresh MapRuntime.
   */
  private enteredMap(world: Overworld): void {
    const id = world.mapId;
    const from = this.cameFrom;
    this.cameFrom = id;
    // One machine in the GAME CORNER is the lucky one, re-picked on every
    // entry (bank $12, $4BD7): a random byte, floored at 8, shifted down
    // three. Nothing tells the player which, and it is never the same twice.
    // Only in a room that HAS machines: the roll is the map script's own, and
    // spending a random number on every doorway in Kanto would shift every
    // other roll the world makes.
    if (hasSlotMachines(this.bundle, id)) {
      this.lucky = luckyMachine(Math.floor(this.services.random() * 256));
    }
    if (isFlyTown(this.bundle, id)) {
      if (!this.state.visitedTowns) {
        this.state.visitedTowns = {};
      }
      this.state.visitedTowns[id] = true;
    }
    // wMapPalOffset (home/overworld.asm:495-501 and :530-536): the lights go
    // out on the warp from an OUTSIDE map into the tunnel's entrance, and come
    // back on any warp out to an outside map. A ladder between the tunnel's
    // own floors is neither, which is why FLASH lasts the whole tunnel.
    const wasOutside = this.cameFromOutside;
    this.cameFromOutside = world.isOutside();
    if (id === darkEntryMapOf(this.bundle) && wasOutside) {
      this.state.darkened = true;
    } else if (this.cameFromOutside) {
      this.state.darkened = false;
    }
    world.darkened = this.state.darkened === true;
    // LoadPlayerSpriteGraphics (home/overworld.asm:811-838): a map where
    // riding is not allowed puts the player back on foot, which is how walking
    // into a shop puts the bike away. The forced-bike bit is a map's to clear
    // too -- both gate scripts do it on entry (Route16Gate1F.asm:1-3).
    if (this.state.riding === true && !bikeAllowed(this.bundle, id, world.map.def.tileset)) {
      this.state.riding = false;
      this.state.forcedBike = false;
    }
    if (this.state.forcedBike === true && !isSlopeMap(this.bundle, id) &&
        !forcesBike(this.bundle, id, world.cellX, world.cellY)) {
      this.state.forcedBike = false;
    }
    this.forceBikeHere(world);
    this.boardLift(world, from);
    world.riding = this.state.riding;
    const clears = mapEnterClearsFor(id);
    for (let i = 0; i < clears.length; i++) {
      // Victory Road 2F drops the 1F switch: climbing back down finds that
      // barrier shut again, exactly as VictoryRoad2FResetBoulderEventScript
      // leaves it.
      this.state.flags[clears[i]] = false;
    }
    const switches = boulderSwitchesFor(id);
    for (let i = 0; i < switches.length; i++) {
      if (this.state.flags[switches[i].flag] === true) {
        world.map.setBlockOverride(switches[i].bx, switches[i].by, switches[i].block);
      }
    }
    // The dock once the S.S. Anne has sailed (Sailing.ts): water where she
    // lay and no gangway warp, the end state VermilionDockSSAnneLeavesScript
    // leaves behind. Nothing normally gets back here -- the sailor's cell at
    // (18,30) turns you round -- so this is the cutscene's own frame and a net.
    if (id === MAP_VERMILION_DOCK && shipHasSailed(this.state.flags)) {
      this.stampShipGone(world);
    }
    // The map's own default script, for the two maps that have work to do on
    // arrival (enterScriptFor). Not while another script is running: a warp
    // taken INSIDE a cutscene belongs to that cutscene, and starting a second
    // program would throw the first one away. Neither of the two is reachable
    // that way -- Route 25 is walked into and Pewter's door is a plain door --
    // and a script that needed it would have to say so at the warp.
    //
    // RUN OUT HERE, not over the following frames. The cartridge's default
    // script is not a cutscene: it does not take the joypad, and the player
    // may walk, save or use a field move on the very first frame of the new
    // map. Left to the ordinary loop this one-command program held the VM for
    // a frame, and `vm.isRunning()` is what every one of those asks about --
    // flying into Pewter came back "no destination wanted" because the town
    // was busy voiding a museum ticket. Every command an onEnter carries is a
    // flag or a toggle, which is why it can finish in a loop here; the cap is
    // the safety net, and anything that hits it is a cutscene wearing the
    // wrong hat and finishes in the ordinary way.
    if (id === MAP_VERMILION_CITY) {
      // .setFirstLockTrashCanIndex, on every load of the city.
      this.trashCans.first = rollFirstCan(() => this.services.random());
      this.trashCans.second = -1;
    }
    const onEnter = enterScriptFor(id, this.version);
    if (onEnter.length > 0 && !this.vm.isRunning() && this.vm.start(onEnter)) {
      for (let i = 0; i < 64 && this.vm.isRunning(); i++) {
        this.vm.update();
      }
    }
  }

  /**
   * CheckForceBikeOrSurf (engine/overworld/player_state.asm:34-82): the cells
   * outside both CYCLING ROAD gates put the player on the bike silently, with
   * no line and no choice, and hold them there until a gate takes the bit
   * away again.
   */
  /**
   * The machine the player is facing, as a script, or null.
   *
   * A slot machine is played from BESIDE it. Bank $0B $7F09 tests the facing
   * with `and $08`, which is true for LEFT ($08) and RIGHT ($0C) and false for
   * DOWN ($00) and UP ($04) -- and it has to be, because the thirty-six stand
   * in six columns of six (x = 1, 6, 7, 12, 13 and 18, y = 10 to 15) with an
   * aisle either side. Read from below, five of every six would have another
   * machine in the way.
   *
   * Three of the thirty-six are never playable, and of the rest the cartridge
   * asks for the COIN CASE and then for a coin before it offers a game at all.
   */
  private slotScript(map: MapDef, x: number, y: number, facing: string): ScriptCommand[] {
    if (facing !== "left" && facing !== "right") {
      return null;
    }
    const machine = slotMachineAt(this.bundle, map.id, x, y);
    if (machine === null) {
      return null;
    }
    const excuse = slotStateText(machine.state);
    if (excuse !== "") {
      return [{ op: "show_text", textId: excuse }] as ScriptCommand[];
    }
    const chance = machine.index + 1 === this.lucky ? CHANCE_LUCKY : CHANCE_ORDINARY;
    return [
      { op: "check_item", item: COIN_CASE },
      { op: "jump_if_false", to: "no_case" },
      { op: "check_coins", amount: 1 },
      { op: "jump_if_false", to: "no_coins" },
      { op: "ask", textId: TEXT_PLAY },
      { op: "jump_if_false", to: "end" },
      { op: "open_slots", value: chance },
      { op: "jump", to: "end" },
      { op: "label", name: "no_case" },
      { op: "show_text", textId: TEXT_NO_CASE },
      { op: "jump", to: "end" },
      { op: "label", name: "no_coins" },
      { op: "show_text", textId: TEXT_NO_COINS },
    ] as ScriptCommand[];
  }

  /**
   * One step of the SAFARI ZONE's clock.
   *
   * True when it ran out and the player is on their way to the gate, which
   * takes the landing from everything else -- the cartridge's own
   * SafariZoneGameOver runs before the step's own encounter roll.
   */
  private safariStep(world: Overworld): boolean {
    if (this.state.flags[EVENT_IN_SAFARI] !== true || !inSafariZone(world.mapId)) {
      return false;
    }
    if (this.state.safariSteps > 0) {
      this.state.safariSteps = this.state.safariSteps - 1;
    }
    if (this.state.safariSteps > 0) {
      return false;
    }
    this.state.flags[EVENT_SAFARI_OVER] = true;
    const out: ScriptCommand[] = [
      { op: "warp", map: MAP_SAFARI_GATE, x: 3, y: 0, facing: "down" },
    ] as ScriptCommand[];
    const rest = safariOverScript();
    for (let i = 0; i < rest.length; i++) {
      out.push(rest[i]);
    }
    return this.vm.start(out);
  }

  /** The bundle's block overrides with the mansion's folded in, built once. */
  private overrideTable(): any {
    if (this.overrides !== null) {
      return this.overrides;
    }
    const out: any = {};
    const shipped = this.bundle.blockOverrides ? this.bundle.blockOverrides : {};
    for (const key in shipped) {
      if (Object.prototype.hasOwnProperty.call(shipped, key)) {
        out[key] = shipped[key];
      }
    }
    const mansion = mansionOverrides();
    for (const key in mansion) {
      if (Object.prototype.hasOwnProperty.call(mansion, key)) {
        out[key] = mansion[key];
      }
    }
    this.overrides = out;
    return out;
  }

  /**
   * The switch the player is facing in the POKeMON MANSION, or null.
   *
   * Read from the cell below it and only facing up, which is the whole of
   * its handler on the cartridge. One bit serves the whole building, so which
   * switch it is does not matter -- only that it is one.
   */
  private mansionScript(map: MapDef, x: number, y: number, facing: string): ScriptCommand[] {
    if (facing !== "up" || mansionSwitchAt(map.id, x, y) === null) {
      return null;
    }
    return mansionSwitchScript(this.state.flags[EVENT_MANSION_SWITCH_ON] === true);
  }

  /**
   * Stepping into a lift car (Elevators.ts).
   *
   * A car in Red has no destination of its own: on EVERY map load it rewrites
   * both of its own warps to the floor the player boarded from, so stepping
   * straight back out returns them where they were. Without that the shipped
   * bytes decide -- and the shipped bytes are the hideout's B1F, the Mart's
   * 1F, and, for SILPH CO, a map that does not exist.
   */
  private boardLift(world: Overworld, from: string): void {
    const lift = elevatorFor(world.mapId);
    if (lift === null) {
      return;
    }
    let floor = null;
    for (let i = 0; i < lift.floors.length; i++) {
      if (lift.floors[i].map === from) {
        floor = lift.floors[i];
      }
    }
    // Arriving from anywhere else -- a save written inside the car, a FLY
    // gone wrong -- leaves the lowest floor rather than a dead warp.
    if (floor === null) {
      floor = lift.floors[0];
    }
    for (let i = 0; i < lift.doors.length; i++) {
      // Straight at the world: enteredMap runs before `this.world` is the map
      // being entered, and the service wrapper reads that field.
      world.overrideWarp(lift.doors[i][0], lift.doors[i][1], floor.map, floor.warp);
      if (this.services.overrideWarp) {
        this.services.overrideWarp(lift.doors[i][0], lift.doors[i][1], floor.map, floor.warp);
      }
    }
  }

  private forceBikeHere(world: Overworld): void {
    // SEAFOAM's two dives share the table: landing on one puts the player in
    // the water, because the hole above it has already dropped them there.
    if (forcesSurf(this.bundle, world.mapId, world.cellX, world.cellY)) {
      if (!world.surfing) {
        world.surfing = true;
        this.state.surfing = true;
        this.state.riding = false;
        world.riding = false;
      }
      return;
    }
    if (!forcesBike(this.bundle, world.mapId, world.cellX, world.cellY)) {
      return;
    }
    this.state.riding = true;
    this.state.forcedBike = true;
    world.riding = true;
  }

  /** The ship `shift` columns out, water behind her; the gangway stays open until she has gone. */
  private stampShipAt(world: Overworld, shift: number): void {
    const blocks = shipBlocksAfter(shift);
    for (let i = 0; i < blocks.length; i++) {
      world.map.setBlockOverride(blocks[i][0], blocks[i][1], blocks[i][2]);
    }
  }

  /** Water over the eight blocks of the ship, and the gangway warp shut. */
  private stampShipGone(world: Overworld): void {
    for (let i = 0; i < SHIP_GONE_BLOCKS.length; i++) {
      const row = SHIP_GONE_BLOCKS[i];
      world.map.setBlockOverride(row[0], row[1], row[2]);
    }
    world.setShutWarps(GANGWAY_CELLS);
  }

  /** The towns FLY may name, in the cartridge's own list order. */
  visitedTowns(): string[] {
    const out: string[] = [];
    const order = this.bundle.mapOrder ? this.bundle.mapOrder : [];
    const visited = this.state.visitedTowns ? this.state.visitedTowns : {};
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      if (visited[id] === true && isFlyTown(this.bundle, id) && out.indexOf(id) < 0) {
        out.push(id);
      }
    }
    return out;
  }

  /**
   * A boulder came to rest: a hole swallows it, a switch opens a barrier.
   *
   * Called by the lens with the push the Overworld reported. The hole path
   * hides the boulder here and shows the one that ships on the floor below at
   * the landing cell -- the manifest keys those by TOGGLE_* names this project
   * does not use, so they are resolved by POSITION.
   */
  afterPush(world: Overworld, push: BoulderPush): void {
    const holes = boulderHolesFor(this.bundle, world.mapId);
    for (let i = 0; i < holes.length; i++) {
      const hole = holes[i];
      if (hole.x !== push.toX || hole.y !== push.toY || this.state.flags[hole.flag] === true) {
        continue;
      }
      this.state.flags[hole.flag] = true;
      this.setRevealed(world.mapId, push.name, false);
      this.services.setNpcRevealed(world.mapId, push.name, false);
      const landed = this.boulderAt(hole.destMap, hole.landsX, hole.landsY);
      if (landed !== "") {
        this.setRevealed(hole.destMap, landed, true);
        this.services.setNpcRevealed(hole.destMap, landed, true);
      } else {
        print("[PlayLoop] no boulder on " + hole.destMap + " at " +
              hole.landsX + "," + hole.landsY);
      }
    }
    const switches = boulderSwitchesFor(world.mapId);
    for (let i = 0; i < switches.length; i++) {
      const sw = switches[i];
      if (sw.x !== push.toX || sw.y !== push.toY || this.state.flags[sw.flag] === true) {
        continue;
      }
      this.state.flags[sw.flag] = true;
      world.map.setBlockOverride(sw.bx, sw.by, sw.block);
      this.services.redrawTerrain();
    }
  }

  /** The name of the boulder shipped at this cell on another map, or "". */
  private boulderAt(mapId: string, x: number, y: number): string {
    const def: MapDef = this.bundle.maps ? this.bundle.maps[mapId] : null;
    const objects = def && def.objects ? def.objects : [];
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      if (object.x === x && object.y === y &&
          object.range === "BOULDER_MOVEMENT_BYTE_2") {
        return object.name;
      }
    }
    return "";
  }

  /**
   * Use a field move from the party menu.
   *
   * Everything the player sees is the cartridge's own line, run through the
   * VM like any other script, so the pages, the pacing and the save lock are
   * the ones every other conversation gets. FLY is the one that cannot finish
   * here: it needs a destination, and the caller opens the town list.
   */
  useFieldMove(world: Overworld, partyIndex: number, move: string): FieldMoveOutcome {
    const nothing: FieldMoveOutcome = { started: false, pickFly: false };
    if (this.vm.isRunning()) {
      return nothing;
    }
    const mon = this.state.party[partyIndex];
    if (!mon || fieldMovesOf(mon).indexOf(move) < 0) {
      return nothing;
    }
    const badge = badgeIndexOf(FIELD_MOVE_BADGES[move]);
    if (badge < 0 || this.state.badges[badge] !== true) {
      return this.runField([{ op: "show_text", textId: TEXT_NEW_BADGE_REQUIRED }]);
    }
    const name = mon.name;
    if (move === "CUT") {
      if (world.cutTargetAhead() === null) {
        return this.runField([{ op: "show_text", textId: TEXT_NOTHING_TO_CUT }]);
      }
      return this.runField([
        { op: "show_text", textId: TEXT_USED_CUT, ram: name },
        { op: "call", routine: ROUTINE_CUT, argument: "" },
      ]);
    }
    if (move === "SURF") {
      // IsSurfingAllowed (engine/overworld/field_move_messages.asm:21-48):
      // on CYCLING ROAD the answer is not "no" but "Cycling is fun! Forget
      // SURFing!", and it comes before anything about the water.
      if (this.state.forcedBike === true) {
        return this.runField([{ op: "show_text", textId: TEXT_CYCLING_IS_FUN }]);
      }
      if (world.surfing) {
        // Already on the water: SURF is how you get off, and only where there
        // is somewhere to get off onto.
        if (!world.landAhead()) {
          return this.runField([{ op: "show_text", textId: TEXT_NO_PLACE_TO_GET_OFF }]);
        }
        return this.runField([{ op: "move_player", direction: world.facing, steps: 1 }]);
      }
      if (!world.surfableAhead()) {
        return this.runField([{ op: "show_text", textId: TEXT_NO_SURFING_HERE, ram: name }]);
      }
      return this.runField([
        { op: "show_text", textId: TEXT_SURFING_GOT_ON, ram: name },
        { op: "call", routine: ROUTINE_SURF, argument: "" },
      ]);
    }
    if (move === "STRENGTH") {
      return this.runField([
        { op: "cry", species: mon.species },
        { op: "show_text", textId: TEXT_USED_STRENGTH, ram: name },
        { op: "show_text", textId: TEXT_CAN_MOVE_BOULDERS, ram: name },
        { op: "call", routine: ROUTINE_STRENGTH, argument: "" },
      ]);
    }
    if (move === "FLASH") {
      // The cartridge asks nothing about the map: Flash works anywhere and
      // only matters where it is dark.
      return this.runField([
        { op: "show_text", textId: TEXT_FLASH_LIGHTS },
        { op: "call", routine: ROUTINE_FLASH, argument: "" },
      ]);
    }
    if (move === "FLY") {
      if (!world.isOutside()) {
        return this.runField([{ op: "show_text", textId: TEXT_CANNOT_FLY_HERE, ram: name }]);
      }
      return { started: false, pickFly: true };
    }
    return nothing;
  }

  /** Fly to a town the player has been to. False when they have not. */
  fly(world: Overworld, mapId: string): boolean {
    if (this.vm.isRunning() || this.visitedTowns().indexOf(mapId) < 0) {
      return false;
    }
    return this.runField([{ op: "call", routine: ROUTINE_FLY, argument: mapId }]).started;
  }

  private runField(program: ScriptCommand[]): FieldMoveOutcome {
    return { started: this.vm.start(program), pickFly: false };
  }

  /**
   * Use a bag item outside a battle, on party member `partyIndex` (-1 for a
   * REPEL or an ESCAPE ROPE, which have no target). ItemUse.ts decides what
   * happens and writes the save; this runs its lines through the VM and hands
   * back what the lens still owes on screen -- a move to learn, an evolution.
   * Null when nothing could start: a script already running, an item not in
   * the bag, or one the bag does nothing with out here.
   */
  useItem(world: Overworld, item: string, partyIndex: number, moveSlot: number = -1): ItemUseOutcome {
    if (this.vm.isRunning() || !hasItem(this.state, item, 1) || !itemUsableOutside(item)) {
      return null;
    }
    const outcome = useItemOutside(this.bundle, this.state, item, partyIndex,
                                   { mapId: world.mapId, tileset: world.map.def.tileset,
                                     waterAhead: world.surfableAhead(), surfing: world.surfing,
                                     cellX: world.cellX, cellY: world.cellY },
                                   () => this.services.random(), moveSlot);
    if (outcome.script.length > 0) {
      this.vm.start(outcome.script);
    }
    // Getting on or off changes how fast the next step is.
    world.riding = this.state.riding;
    return outcome;
  }

  attach(world: Overworld): void {
    this.world = world;
    world.setReveals(this.revealed);
    // The bundle's table plus the POKeMON MANSION's, whose doors are not in
    // the extraction at all: the mansion's floors ship with no bg events and
    // the switches are hidden objects (script/Mansion.ts).
    world.setBlockOverrides(this.overrideTable(), this.state.flags);
    this.lastBlockSignature = world.blockSignature();
    this.lastBlockMap = world.mapId;
  }

  private world: Overworld = null;
  private lastBlockSignature: string = "";
  private lastBlockMap: string = "";

  /**
   * A flag that flipped may have opened or closed a block: the model already
   * reads it live, the lens has to be told to redraw. Compared after every VM
   * tick and every landing; a map change resets the baseline (the lens rebuilds
   * on a map change anyway).
   */
  private noticeBlocks(): void {
    if (this.world === null) {
      return;
    }
    const signature = this.world.blockSignature();
    if (this.world.mapId !== this.lastBlockMap) {
      this.lastBlockMap = this.world.mapId;
      this.lastBlockSignature = signature;
      return;
    }
    if (signature !== this.lastBlockSignature) {
      this.lastBlockSignature = signature;
      this.services.blocksChanged(this.world.mapId);
    }
  }

  update(): void {
    this.vm.update();
    this.noticeBlocks();
    // The slide is over when its script is: BIT_SPINNING is cleared at the
    // end of the simulated run (Overworld.spriteFacing).
    if (this.world && this.world.spinning && !this.vm.isRunning()) {
      this.world.spinning = false;
    }
  }

  /** The reveal overrides, for facingTarget and for drawing NPCs. */
  reveals(): any {
    return this.revealed;
  }

  /** Whether a script has hidden or shown this NPC; undefined means "as shipped". */
  revealOf(mapId: string, name: string): any {
    return this.revealed[mapId + ":" + name];
  }

  /** `mapId` may be a map the player is not on; see ScriptHost.showNpc. */
  setRevealed(mapId: string, name: string, visible: boolean): void {
    this.revealed[mapId + ":" + name] = visible;
  }

  /**
   * Try to talk to whatever the player is facing.
   *
   * A hand-written or transcribed script wins. Failing that, an NPC or a sign
   * with words of its own gets them as a one-line script -- face the player,
   * say the line -- through the same VM, so paging, the save gate and the
   * encounter gate all hold. The comment here used to say the caller showed
   * those words itself; the caller never did, and three hundred plain NPCs
   * and every signpost were mute.
   *
   * `cellOf` says where each object stands now (MapRuntime.objectCell): a
   * wanderer is talked to on the cell she has walked to, not the one she
   * shipped on. Without it, the shipped cell.
   *
   * Returns the target that was found, whether or not anything started.
   */
  interact(map: MapDef, cellX: number, cellY: number, facing: string, counterAhead: boolean,
           cellOf: (object: any) => number[] = null): any {
    if (this.vm.isRunning()) {
      return null;
    }
    const target = facingTarget(map, cellX, cellY, facing, this.revealed, counterAhead === true, cellOf);
    if (!target) {
      // Nothing there. A hidden event -- Bill's PC, a poster -- is a face
      // trigger on the cell in front.
      const ahead = facing === "up" ? [cellX, cellY - 1] : facing === "down" ? [cellX, cellY + 1]
        : facing === "left" ? [cellX - 1, cellY] : [cellX + 1, cellY];
      const trigger = pickStepTrigger(faceTriggersFor(map.id, this.version), ahead[0], ahead[1],
        this.state.flags, (item: string) => hasItem(this.state, item, 1));
      if (trigger === null) {
        const door = this.lockedDoorScript(map, ahead[0], ahead[1]);
        if (door !== null && this.vm.start(door)) {
          return { kind: "cell", name: map.id + " door " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        const pc = this.pcScript(map, ahead[0], ahead[1], facing);
        if (pc !== null && this.vm.start(pc)) {
          return { kind: "cell", name: map.id + " PC " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        // The other two hidden events (HiddenThings.ts): the man drawn onto
        // the bench, and whatever is buried under the tile in front.
        const bench = benchGuyScript(this.bundle, map.id, ahead[0], ahead[1], facing);
        if (bench !== null && this.vm.start(bench)) {
          return { kind: "cell", name: map.id + " bench " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        const buried = hiddenItemScript(this.bundle, this.state.flags, map.id, ahead[0], ahead[1]);
        if (buried !== null && this.vm.start(buried)) {
          return { kind: "cell", name: map.id + " hidden " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        // Coins on the floor of the GAME CORNER, before the machines that
        // stand on some of the same cells (HiddenThings.ts).
        const coins = hiddenCoinScript(this.bundle, this.state.flags,
                                       hasItem(this.state, COIN_CASE, 1),
                                       map.id, ahead[0], ahead[1]);
        if (coins !== null && spinnerAt(this.bundle, map.id, ahead[0], ahead[1]) === null &&
            this.vm.start(coins)) {
          return { kind: "cell", name: map.id + " coins " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        // The POKeMON MANSION's switches (Mansion.ts), read facing up.
        const lever = this.mansionScript(map, ahead[0], ahead[1], facing);
        if (lever !== null && this.vm.start(lever)) {
          return { kind: "cell", name: map.id + " switch " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        // A slot machine stands on some of those same cells (Slots.ts), and
        // reads from below it, so it comes after the coins on the floor.
        const slots = this.slotScript(map, ahead[0], ahead[1], facing);
        if (slots !== null && this.vm.start(slots)) {
          return { kind: "cell", name: map.id + " slots " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        // An empty can, and the plaque beside a gym's statues (HiddenThings.ts).
        const trash = printTrashScript(this.bundle, map.id, ahead[0], ahead[1]);
        if (trash !== null && this.vm.start(trash)) {
          return { kind: "cell", name: map.id + " trash " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        const statue = gymStatueScript(this.bundle, map.id, ahead[0], ahead[1], facing, (badge: string) => {
          const index = badgeIndexOf(badge);
          return index >= 0 && this.state.badges[index] === true;
        });
        if (statue !== null && this.vm.start(statue)) {
          return { kind: "cell", name: map.id + " statue " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        // Vermilion Gym's trash cans (TrashCans.ts): GymTrashScript's hidden event.
        const can = canAt(this.bundle, map.id, ahead[0], ahead[1]);
        if (can >= 0 && this.vm.start(searchCan(this.trashCans, this.state.flags, can, () => this.services.random()))) {
          return { kind: "cell", name: map.id + " can " + can, textId: "", x: ahead[0], y: ahead[1] };
        }
        // CINNABAR GYM's quiz machines (CinnabarQuiz.ts): the question, and
        // either the gate or the room's trainer.
        const quiz = quizScript(map.id, ahead[0], ahead[1], facing, map.objects);
        if (quiz !== null && this.vm.start(quiz)) {
          return { kind: "cell", name: map.id + " quiz " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        // What is written on the walls (Bookshelves.ts): the objects the
        // cartridge lists by cell first, then the bookshelf tiles, which are
        // the fallback for A pressed facing up at nothing at all.
        const wall = wallScript(map.id, ahead[0], ahead[1], facing, dexOwnedCount(this.state));
        if (wall !== null && this.vm.start(wall)) {
          return { kind: "cell", name: map.id + " wall " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
        }
        if (this.world && this.world.map) {
          const shelf = bookshelfScript(map.tileset,
                                        this.world.map.tileAt(ahead[0] * 2, ahead[1] * 2 + 1),
                                        this.world.map.tileAt(ahead[0] * 2, ahead[1] * 2),
                                        facing, cellX);
          if (shelf !== null && this.vm.start(shelf)) {
            return { kind: "cell", name: map.id + " shelf " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
          }
        }
        return null;
      }
      const program = trigger.script.length > 0 ? trigger.script : this.scriptForTalkKey(map, trigger.talk);
      if (program !== null && this.vm.start(program)) {
        return { kind: "cell", name: map.id + " " + ahead[0] + "," + ahead[1], textId: "", x: ahead[0], y: ahead[1] };
      }
      return null;
    }
    const script = this.scriptFor(map, target);
    if (script) {
      this.vm.start(script);
    }
    return target;
  }

  /**
   * The PC the player is facing, as a one-command script, or null.
   *
   * The cells come from the manifest's own `hiddenExtras.pcTiles` -- every
   * Pokemon Center's is (13,3) faced from below, Red's bedroom's is (0,1) --
   * so nothing here is a guess about geometry. Which SCREEN it opens is:
   * measured on 7 September, the bedroom terminal goes straight into the item
   * PC with no top menu, while Viridian's Center offers SOMEONE's PC / RED's
   * PC / LOG OFF. Every other terminal in that table shares the Center's tile
   * and its handler, so they get the Center's screen.
   *
   * A script goes through the VM rather than opening the controller directly
   * so that paging, the save gate and the encounter gate all hold, exactly as
   * open_mart does for the Poke Mart.
   */
  private pcScript(map: MapDef, x: number, y: number, facing: string): ScriptCommand[] {
    const extras = this.bundle.field ? this.bundle.field.hiddenExtras : null;
    const byMap = extras && extras.pcTiles ? extras.pcTiles[map.id] : null;
    if (!byMap) {
      return null;
    }
    for (let i = 0; i < byMap.length; i++) {
      const tile = byMap[i];
      if (tile.x === x && tile.y === y && tile.facing === facing) {
        return [{ op: "open_pc", kind: map.id === "REDS_HOUSE_2F" ? PC_KIND_HOME : PC_KIND_FULL }];
      }
    }
    return null;
  }

  /**
   * Arriving outdoors on a door tile, the cartridge walks the player one
   * step down on its own before handing the pad back (a simulated D_DOWN in
   * EnterMap). Measured: after leaving Red's house the ROM stands at (5,6)
   * whatever is held; without this the lens stood in the doorway.
   */
  static stepOutOfDoor(world: Overworld): void {
    if (world.isOutside() && world.map.isDoorTile(world.cellX, world.cellY)) {
      world.facing = "down";
      world.walkScripted("down", 1);
    }
  }

  /**
   * What a landing amounted to, in the cartridge's order: a warp underfoot,
   * else the encounter the step rolled. The lens acts on THIS, never on the
   * StepResult's own encounter, so that a warp or a trigger can drop it.
   */
  afterStep(world: Overworld, result: StepResult, scripted: boolean): LandingOutcome {
    const nothing: LandingOutcome = { warped: false, encounter: null };
    // A blocked step on a warp cell: CheckWarpsCollision. Only while the
    // standing-on-warp flag is up -- a mat keeps it, a staircase drops it, so
    // pressing into the wall beside the stairs never bounces you back down.
    // No ExtraWarpCheck here; the cartridge asks that on arrival only. The
    // arrival guard does not apply: you arrived on this very mat and leave
    // by it, and a door tile you stand on takes you back in.
    if (result.blocked) {
      const under = world.warpUnderPlayer();
      if (under && world.standingOnWarp && world.takeWarp(under)) {
        PlayLoop.stepOutOfDoor(world);
        return { warped: true, encounter: null };
      }
      return nothing;
    }
    if (!result.landed && !result.mapChanged) {
      return nothing;
    }
    // The DAYCARE's Pokemon earns a point for every step taken anywhere
    // (IncrementDayCareMonExp, called from the overworld's own step).
    if (this.state.dayCare) {
      this.state.dayCare = dayCareStep(this.bundle, this.state.dayCare);
    }
    // The SAFARI ZONE's clock, before anything the step found: five hundred
    // and two steps bought at the desk, one spent here, and at zero the PA
    // calls the player back whatever else this cell holds (Safari.ts).
    if (this.safariStep(world)) {
      return { warped: true, encounter: null };
    }
    // A coordinate trigger first: it owns the landing, and the warp and the
    // encounter the step rolled are dropped. Never during a scripted walk --
    // the Safari gate walks you across its own join cell.
    if (!scripted && this.stepped(world.map.def, world.cellX, world.cellY)) {
      return { warped: false, encounter: null };
    }
    // Then the sprite scan. Same rule as a trigger: it owns the landing, so
    // the warp and the encounter this step rolled are dropped -- you do not
    // walk into tall grass and meet a trainer at once.
    if (!scripted && this.spotted(world.map.def, world.cellX, world.cellY)) {
      return { warped: false, encounter: null };
    }
    // Doors, stairs and holes fire on arrival -- for a scripted walk too: the
    // Safari gate and the dock walk you into a warp, and CheckWarpsNoCollision
    // runs after a simulated step as after a real one. A warp cell whose tile
    // is NOT a door or warp tile (the exit mats along the bottom of a house,
    // the lab's two-wide doorway) fires only with the pad held toward the
    // map edge: walking sideways along the mats goes nowhere, as measured.
    const warp = world.pendingWarp();
    const fires = warp !== null && (
      world.map.isWarpTile(world.cellX, world.cellY) ||
      ((world.directionHeld || scripted) && world.extraWarpCheck(world.facing)));
    if (fires && world.takeWarp(warp)) {
      PlayLoop.stepOutOfDoor(world);
      // The arrival cell is read once too: the cartridge's map script runs
      // on the first frame of the new map, which is how Lance's room walks
      // you in and the Safari gate greets you. A trigger there is armed by
      // its flags like any other; a scripted arrival does not read it.
      if (!scripted) {
        if (!this.stepped(world.map.def, world.cellX, world.cellY)) {
          this.spotted(world.map.def, world.cellX, world.cellY);
        }
      }
      return { warped: true, encounter: null };
    }
    this.noticeBlocks();
    this.forceBikeHere(world);
    world.riding = this.state.riding;
    if (scripted) {
      return { warped: false, encounter: null };
    }
    // A REPEL running: TryDoWildEncounter counts one step down on every step
    // that reaches the roll -- grass or not -- and on the step it hits zero
    // says so and rolls nothing. While it runs, a wild Pokemon below the
    // FIRST party member's level is kept away (wild_encounters.asm:19-24,
    // :81-95). A landing on a warp tile never reaches the roll and does not
    // count, which is also the cartridge's rule.
    if (this.state.repelSteps > 0 && !world.map.isWarpTile(world.cellX, world.cellY)) {
      const woreOff = repelStep(this.state);
      if (woreOff !== "") {
        this.vm.start([{ op: "show_text", textId: woreOff }]);
        return { warped: false, encounter: null };
      }
      if (result.encounter !== null && repelBlocks(this.state, result.encounter.level)) {
        return { warped: false, encounter: null };
      }
    }
    return { warped: false, encounter: result.encounter };
  }

  /**
   * What talking to `target` runs: a hand-written or transcribed script, else
   * the trainer's header, else the ball's pickup, else its own line.
   */
  private scriptFor(map: MapDef, target: any): ScriptCommand[] {
    let script = talkScript(map.id, target.textId, this.version);
    // A Pokemon Center nurse: the bundle marks her text pointer, as it marks
    // a mart clerk's. One script for all thirteen.
    if (!script && target.kind === "object" && this.pointerFlag(map, target.textId, "nurse")) {
      script = nurseScript();
    }
    // Her colleague at the other desk, marked the same way: twelve of them.
    if (!script && target.kind === "object" && this.pointerFlag(map, target.textId, "cableClub")) {
      script = cableClubScript();
    }
    // An ordinary trainer: the cartridge's header for this object carries the
    // challenge, end and after lines and the event bit. Without a header there
    // is no fight from here -- a wordless battle is behaviour Red does not have;
    // those few get hand entries instead.
    if (!script && target.kind === "object" && target.trainerClass) {
      const header = trainerHeaderFor(this.bundle, map, target.index);
      if (header !== null) {
        const defeated = isTrainerDefeated(this.state, map.id, target.name, header.event);
        script = trainerTalkScript(map, target, header, defeated);
      }
    }
    // A Poke Ball on the ground. Before the plain words: its TEXT_ pointer is
    // the cartridge's pickup routine and has no words to show.
    if (!script && target.kind === "object" && target.item) {
      script = itemBallScript(map.id, target.name, target.item);
    }
    if (!script && target.textId) {
      script = target.kind === "object"
        ? [{ op: "face_player" }, { op: "show_text", textId: target.textId }]
        : [{ op: "show_text", textId: target.textId }];
    }
    return script;
  }

  /**
   * A landing on a trigger cell. Refused while a script runs (a talk started
   * this frame owns the VM; the cell fires again on the next landing), else
   * the first armed trigger's script starts, after the player is turned.
   */
  stepped(map: MapDef, cellX: number, cellY: number): boolean {
    if (this.vm.isRunning()) {
      return false;
    }
    if (this.healZoneStep(map, cellX, cellY)) {
      return true;
    }
    // An arrow tile takes the floor before anything else does, exactly as the
    // map's default script runs before CheckFightingMapTrainers (Spinners.ts).
    const slide = spinnerAt(this.bundle, map.id, cellX, cellY);
    if (slide !== null && this.vm.start(spinnerScript(slide))) {
      if (this.world) {
        this.world.spinning = true;
      }
      return true;
    }
    const trigger: StepTrigger = pickStepTrigger(stepTriggersFor(map.id, this.version), cellX, cellY,
      this.state.flags, (item: string) => hasItem(this.state, item, 1));
    if (trigger === null) {
      return false;
    }
    let script: ScriptCommand[] = trigger.script.length > 0 ? trigger.script : null;
    if (script === null && trigger.talk) {
      script = this.scriptForTalkKey(map, trigger.talk);
    }
    if (script === null) {
      print("[PlayLoop] trigger on " + map.id + " " + cellX + "," + cellY + " has nothing to run");
      return false;
    }
    if (trigger.turnPlayer) {
      this.host.facePlayerDir(trigger.turnPlayer);
    }
    return this.vm.start(script);
  }

  /**
   * The purified zone on the tower's fifth floor (MapScripts.HEAL_ZONES).
   *
   * A LATCH, not a trigger: PokemonTower5FDefaultScript sets
   * EVENT_IN_PURIFIED_ZONE with CheckAndSetEvent and returns if it was already
   * set, so the pad heals once on the way in and says nothing while the player
   * walks its four cells; stepping off clears it again. Four plain step
   * triggers would heal four times over.
   */
  private healZoneStep(map: MapDef, cellX: number, cellY: number): boolean {
    const zone = healZoneAt(map.id, cellX, cellY);
    if (zone === null) {
      const latches = healZoneFlags();
      for (let i = 0; i < latches.length; i++) {
        this.state.flags[latches[i]] = false;
      }
      return false;
    }
    if (this.state.flags[zone.flag] === true) {
      return false;
    }
    this.state.flags[zone.flag] = true;
    // Silent: no Center jingle and no respawn point, which is what predef
    // HealParty on its own does (PokemonTower5F.asm:33).
    return this.vm.start([
      { op: "heal_party" },
      { op: "show_text", textId: zone.textId },
    ]);
  }

  /**
   * A trainer whose line of sight this landing walked into.
   *
   * Runs after the coordinate triggers and loses to them, which is the
   * cartridge's order: a map script that has taken the frame keeps it, and
   * the sprite scan happens on the frames after. Nothing here turns the
   * player -- TrainerEngage does not, and neither does this.
   */
  spotted(map: MapDef, cellX: number, cellY: number): boolean {
    if (this.vm.isRunning()) {
      return false;
    }
    // A whole floor can stop watching: Mt Moon B2F's script returns before
    // CheckFightingMapTrainers once either fossil is in the bag, so the four
    // Rockets jump you on the way in and not on the way out (sightScanOff).
    if (sightScanOff(map.id, this.state.flags)) {
      return false;
    }
    const poseOf = (name: string) => this.services.npcPose(name);
    const sighting = sightingAt(this.bundle, map, cellX, cellY, this.state,
                                this.revealed, poseOf);
    if (sighting === null) {
      return false;
    }
    return this.vm.start(sightingScript(map, sighting));
  }

  /** Whether this map's text pointer for `textId` carries the named marker. */
  private pointerFlag(map: MapDef, textId: string, marker: string): boolean {
    const byMap = this.bundle.textPointers ? this.bundle.textPointers[map.label] : null;
    const pointer = byMap ? byMap[textId] : null;
    return !!pointer && pointer[marker] === true;
  }

  /**
   * A door that asks for a key: Silph Co.'s card-key doors. The faced cell lies
   * in a block whose override row names a key item and is closed; with the key
   * the row's flags are set (the block opens by derivation), without it the
   * door's refusal. The cartridge's CardKey: _CardKeyFailText, else
   * _CardKeySuccessText1/2 and the unlock event.
   */
  private lockedDoorScript(map: MapDef, x: number, y: number): ScriptCommand[] {
    if (this.world === null || this.world.map.def.id !== map.id) {
      return null;
    }
    const rows = this.world.map.overridesAt(Math.floor(x / 2), Math.floor(y / 2));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.keyItem === "" || rowIsOpen(row, this.state.flags)) {
        continue;
      }
      if (!hasItem(this.state, row.keyItem, 1)) {
        return [{ op: "show_text", textId: "_CardKeyFailText" }];
      }
      const out: ScriptCommand[] = [
        { op: "show_text", textId: "_CardKeySuccessText1" },
        { op: "show_text", textId: "_CardKeySuccessText2" },
      ];
      for (let f = 0; f < row.flags.length; f++) {
        out.push({ op: "set_flag", flag: row.flags[f] });
      }
      out.push({ op: "text_sound", name: "Go_Inside" });
      return out;
    }
    return null;
  }

  /** The script an object's own key would run, as if the player had talked to it. */
  private scriptForTalkKey(map: MapDef, key: string): ScriptCommand[] {
    for (let i = 0; i < map.objects.length; i++) {
      const object = map.objects[i];
      if (object.text !== key) {
        continue;
      }
      return this.scriptFor(map, {
        kind: "object", name: object.name, textId: object.text, x: object.x, y: object.y,
        trainerClass: object.trainerClass ? object.trainerClass : "",
        trainerParty: typeof object.trainerParty === "number" ? object.trainerParty : 0,
        item: itemIdOf(object), index: typeof object.index === "number" ? object.index : 0,
      });
    }
    return talkScript(map.id, key, this.version);
  }

  /** Whether a trainer object has been beaten, by either record. */
  trainerDefeated(mapId: string, name: string, event: string): boolean {
    return isTrainerDefeated(this.state, mapId, name, event);
  }

  /** Whether this save has never seen Oak's speech. */
  needsIntro(): boolean {
    return this.state.flags.EVENT_INTRO_DONE !== true;
  }

  /**
   * Start the intro on a save that has not had it. Returns whether it started.
   *
   * The lens never called introScript(): a fresh game booted straight into the
   * bedroom, and EVENT_INTRO_DONE was set only by the v0 migration. The intro
   * was the fifth thing in this project finished, tested and reachable from
   * nothing.
   */
  startIntroIfNeeded(): boolean {
    if (!this.needsIntro() || this.vm.isRunning()) {
      return false;
    }
    return this.vm.start(introScript(this.version));
  }

  /**
   * Whether grass may bite.
   *
   * Off while a script runs, and off with nothing that can fight -- the second
   * is not a nicety: startWildBattle throws on a party with no healthy member,
   * and both a migrated save and the walk to Oak's lab reach that state.
   *
   * Off, too, on the handful of cells a map script keeps quiet: the cartridge's
   * BIT_NO_BATTLES, which is a PLACE rather than a moment (inQuietZone).
   *
   * That place is the LIVE cell, asked of the services, not state.cellX: the
   * save's cell is written by PokemonAR.persist(), which is throttled and
   * event-driven, while this is read every frame. Reading the save meant the
   * room went quiet a few seconds after the player walked into it, and stayed
   * quiet a few seconds after they left.
   */
  encountersAllowed(): boolean {
    const cell = this.services.playerCell();
    if (inQuietZone(this.services.currentMap().id, cell[0], cell[1], this.state.flags)) {
      return false;
    }
    return !this.vm.isRunning() && canFight(this.state);
  }

  /**
   * Whether the game may be written to storage right now.
   *
   * NOT while a script is running. Pewter Gym sets EVENT_BEAT_BROCK at command 5,
   * shows a message at 6 and hands the badge over at 7; a write inside that
   * window stores the flag without the badge, and the script's own check_flag
   * then skips the handover on every future conversation. The badge is gone for
   * good, and nothing about the save looks wrong. The intro has the same shape
   * around its closing warp.
   */
  canSave(): boolean {
    return !this.vm.isRunning();
  }
}

/**
 * The link receptionist beside the nurse (engine/link/cable_club_npc.asm).
 *
 * Twelve of them, one per Center, and the bundle marks their text pointer
 * `cableClub` exactly as it marks a nurse's -- and, exactly as the nurse's
 * was, it was read by nothing and every one of them was mute.
 *
 * She always welcomes you. Without the POKEDEX she says preparations are
 * being made; with it, the cartridge tries for ninety frames to raise a link
 * partner over the cable and, when nobody answers, says the area is reserved
 * for two friends linked by cable. A lens has no cable and never will, so the
 * timeout is the only branch it can take -- which is the cartridge's own
 * answer for a player with no second Game Boy, and the reason this is a
 * faithful script rather than a stub.
 */
export function cableClubScript(): ScriptCommand[] {
  return [
    { op: "face_player" },
    { op: "show_text", textId: "_CableClubNPCWelcomeText" },
    { op: "check_flag", flag: "EVENT_GOT_POKEDEX" },
    { op: "jump_if_true", to: "try_link" },
    // `ld c, 60 / call DelayFrames` before she speaks again.
    { op: "wait", frames: 60 },
    { op: "show_text", textId: "_CableClubNPCMakingPreparationsText" },
    { op: "jump", to: "end" },
    { op: "label", name: "try_link" },
    { op: "show_text", textId: "_CableClubNPCAreaReservedFor2FriendsLinkedByCableText" },
  ];
}

/**
 * The nurse (engine/events/pokecenter.asm): welcome, the first time also the
 * question, HEAL or not; yes takes the party, heals it, makes this the place
 * a whiteout returns to, and says goodbye; no says goodbye. Nothing here is
 * per-Center: the labels are the cartridge's shared ones.
 */
export function nurseScript(): ScriptCommand[] {
  return [
    { op: "face_player" },
    { op: "check_flag", flag: "EVENT_USED_POKECENTER" },
    { op: "jump_if_true", to: "again" },
    { op: "set_flag", flag: "EVENT_USED_POKECENTER" },
    { op: "show_text", textId: "_PokemonCenterWelcomeText" },
    { op: "ask", textId: "_ShallWeHealYourPokemonText" },
    { op: "jump", to: "answered" },
    { op: "label", name: "again" },
    { op: "ask", textId: "_PokemonCenterWelcomeText" },
    { op: "label", name: "answered" },
    { op: "jump_if_false", to: "bye" },
    { op: "show_text", textId: "_NeedYourPokemonText" },
    { op: "heal_party" },
    { op: "set_respawn" },
    { op: "text_sound", name: "Pokecenter_Heal" },
    // Measured against the cartridge from the after-brock start (FINDINGS,
    // 12 September): pokecenter.asm prints PokemonFightingFitText between the
    // heal and the farewell, and this script went straight to the farewell.
    { op: "show_text", textId: "_PokemonFightingFitText" },
    { op: "label", name: "bye" },
    { op: "show_text", textId: "_PokemonCenterFarewellText" },
  ];
}
