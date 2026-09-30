// Overworld state: where the player stands, how they step, and what the grass does.
//
// Every rule is lifted from the reference implementation rather than reconstructed
// from memory, because these are the details that make a Gen 1 world feel right:
//   - a step takes a fixed time and always lands on a cell centre
//   - pressing a direction you are not facing turns you first; the turn costs a beat
//     and does not move you, which is why doorways are enterable at all
//   - an encounter rolls on ARRIVAL in grass: rand(0..255) < rate, then the slot is
//     picked from the original cumulative buckets
//   - crossing a map seam lands at destX = curX - offset * 2, offsets being in blocks

import { MapRuntime } from "../world/MapRuntime";
import { BlockOverrideIndex } from "../world/BlockOverrides";
import type { WorldBundle, MapDef, TilesetDef } from "../world/WorldData";
import type { InputSource } from "./InputSource";
import { turnPress } from "./ViewRelativeInput";
import type { BoulderPush } from "./FieldMoves";
import { BIKE_STEP_FACTOR, isSlopeMap } from "./Bike";
import {
  cutKindOf, cutSwapFor, darkMapsOf, flyWarpOf, isLedgeHop, NO_SHORE_TILESET,
  SHORE_TILES, WATER_TILE, waterTilesetsOf,
} from "./FieldMoves";

/** Cumulative slot thresholds out of 256, from wild_encounters.asm. */
const ENCOUNTER_BUCKETS: number[] = [51, 102, 141, 166, 191, 216, 229, 242, 253, 256];

/** A quarter turn clockwise at a time, as the spinning sprite goes round. */
const SPIN_ORDER: string[] = ["down", "left", "up", "right"];

/** Seconds per walked step, and per turn-in-place. */
const STEP_SECONDS: number = 0.26;
const TURN_SECONDS: number = 0.11;
/** A ledge hop is two ordinary steps back to back: pokered's two 16-frame beats. */
const LEDGE_HOP_SECONDS: number = STEP_SECONDS * 2;

export interface WildEncounter {
  species: string;
  level: number;
}

export interface StepResult {
  /** The map changed this step; the caller must rebuild the diorama. */
  mapChanged: boolean;
  encounter: WildEncounter;
  blocked: boolean;
  /**
   * A walked step finished in this call. cellX/cellY are the landed cell and no
   * new step has started: the frame the play loop reads triggers and warps on.
   */
  landed: boolean;
  /** The step was refused because it left the map with no connection there. */
  blockedAtEdge: boolean;
  /** This step was a ledge hop rather than a walk. */
  hopped: boolean;
  /** Strength moved a boulder this frame, or null. */
  pushed: BoulderPush;
}

export class Overworld {
  private bundle: WorldBundle;

  map: MapRuntime;
  mapId: string;
  cellX: number = 0;
  cellY: number = 0;
  facing: string = "down";

  /** 0..1 through the current step; 1 means standing still. */
  private stepProgress: number = 1;
  private stepFromX: number = 0;
  private stepFromY: number = 0;
  private stepDuration: number = STEP_SECONDS;
  private turning: boolean = false;

  /** Counters the caller can surface; cheap, and they make a silent stall obvious. */
  steps: number = 0;
  lastCellWasGrass: boolean = false;

  /**
   * The cell the player arrived on by warp, inert as a warp until they step
   * off it: a door lands you on the far door's own cell, and without this the
   * next landing would warp you straight back. Positional, not a counter --
   * a counter swallows an adjacent ladder.
   */
  private arrivalX: number = -1;
  private arrivalY: number = -1;

  /**
   * The last OUTSIDE map -- a town or a route -- the player warped away from.
   *
   * 242 of the cartridge's 802 warps name LAST_MAP as their destination: every
   * house, gym, mart and gate exit. Held here, persisted by the caller, and
   * resolved in takeWarp.
   */
  lastMapId: string = "";

  /**
   * Riding on the water. Widens what may be stepped on to water and shore,
   * switches the encounter roll to the map's WATER table, and ends the moment
   * the player lands on a walkable cell (CollisionCheckOnWater .stopSurfing).
   * Persisted, because a save written mid-surf and reloaded without it puts
   * the player on a cell they cannot legally leave.
   */
  surfing: boolean = false;
  /**
   * On the BICYCLE. Halves the time a step takes (DoBikeSpeedup advances the
   * sprite twice a frame) and, like surfing, is the save's rather than this
   * object's -- PlayLoop puts it back on every map entry.
   */
  riding: boolean = false;
  /**
   * On an arrow tile's slide (BIT_SPINNING). The walk itself is the script's;
   * this only changes what the player LOOKS like while it runs. PlayLoop sets
   * it with the slide and clears it when the slide's script ends.
   */
  spinning: boolean = false;

  /**
   * The way the player's sprite faces, which is the way they face -- except
   * on a slide, where the cartridge turns the sprite a quarter clockwise on
   * every step (engine/overworld/spinners.asm:54-61) while the movement keeps
   * its direction. Drawing reads this; rules read `facing`.
   */
  spriteFacing(): string {
    if (!this.spinning) {
      return this.facing;
    }
    return SPIN_ORDER[this.steps % SPIN_ORDER.length];
  }

  /** Strength is active until the map is left (ResetUsingStrengthOutOfBattleBit). */
  strengthActive: boolean = false;
  /**
   * The screen is dark: the save's own darkened flag, mirrored here.
   *
   * PlayLoop owns when it turns on and off (the warp in from outside, the warp
   * back out, FLASH); this object only reports it, and a map entry does NOT
   * reset it -- which is the whole point, since the cartridge's palette offset
   * survives the ladders inside the tunnel.
   */
  darkened: boolean = false;
  /**
   * The boulder the player pushed into last frame.
   *
   * pokered's BIT_TRIED_PUSH_BOULDER: the first attempt only arms, the second
   * consecutive one moves it. The frame loop re-evaluates a held direction
   * every frame, so "the next attempt" is the next frame and pushing feels
   * immediate, exactly as it does on hardware.
   */
  private armedBoulder: string = "";

  /**
   * Called at the end of every enterMap, including the one in the constructor.
   * PlayLoop binds it to stamp switch blocks, clear per-map flags and record
   * a town as visited; the constructor's call reaches nothing, so the loop
   * calls it once itself for the boot map.
   */
  onMapEntered: (world: Overworld) => void = null;

  /** Injectable so tests and LEAF scenarios can make encounters deterministic. */
  private random: () => number;

  constructor(bundle: WorldBundle, mapId: string, cellX: number, cellY: number,
              random: () => number) {
    this.bundle = bundle;
    this.random = random ? random : Math.random;
    this.enterMap(mapId, cellX, cellY);
  }

  private mapDef(id: string): MapDef {
    return this.bundle.maps[id] as MapDef;
  }

  private tilesetFor(def: MapDef): TilesetDef {
    return this.bundle.tilesets[def.tileset] as TilesetDef;
  }

  /** Ask the player to walk. DONE is reported through isWalkingScripted(). */
  walkScripted(direction: string, steps: number): void {
    this.scriptedDir = direction;
    this.scriptedSteps = steps > 0 ? steps : 1;
  }

  /** True while a scripted walk still has steps to take. */
  isWalkingScripted(): boolean {
    return this.scriptedSteps > 0;
  }

  /** Abandons a scripted walk, e.g. when it has run into a wall. */
  cancelScriptedWalk(): void {
    this.scriptedSteps = 0;
  }

  /** The script's show/hide overrides, shared with every map this builds. */
  private reveals: any = null;

  setReveals(revealed: any): void {
    this.reveals = revealed;
    if (this.map) {
      this.map.setReveals(revealed);
    }
  }

  /** The bundle's block override table and the flag store it reads, for every map built here. */
  private overrideTable: any = null;
  private overrideFlags: any = null;

  setBlockOverrides(table: any, flags: any): void {
    this.overrideTable = table;
    this.overrideFlags = flags;
    if (this.map) {
      this.applyOverrides(this.map);
    }
  }

  private applyOverrides(map: MapRuntime): void {
    const rows = this.overrideTable && this.overrideFlags ? this.overrideTable[map.def.id] : null;
    // Always set, so taking the table away takes the rows away too.
    map.setOverrides(rows && rows.length > 0 ? new BlockOverrideIndex(rows, map.def.width) : null,
                     rows && rows.length > 0 ? this.overrideFlags : null);
  }

  /** The current map's resolved override ids; '' when it has none. */
  blockSignature(): string {
    return this.map ? this.map.blockSignature() : "";
  }

  private enterMap(id: string, cellX: number, cellY: number): void {
    const def = this.mapDef(id);
    if (!def) {
      throw new Error("overworld: unknown map " + id);
    }
    this.map = new MapRuntime(def, this.tilesetFor(def));
    this.map.setReveals(this.reveals);
    this.applyOverrides(this.map);
    this.mapId = id;
    this.cellX = cellX;
    this.cellY = cellY;
    this.stepProgress = 1;
    this.stepFromX = cellX;
    this.stepFromY = cellY;
    this.arrivalX = cellX;
    this.arrivalY = cellY;
    // A shut warp belongs to the map that shut it; onMapEntered stamps the
    // ones this map's flags still shut.
    this.shutWarps = {};
    this.warpOverrides = {};
    // The warp flag as the cell dictates: a mat keeps it, a staircase drops
    // it -- the same answer the flag carried across the warp would give.
    this.refreshStandingOnWarp();
    // Strength and a half-armed boulder do not survive a map change (EnterMap
    // clears the strength bit). The darkness does: wMapPalOffset is written
    // by the warp that leads into the tunnel and by nothing else.
    this.strengthActive = false;
    this.armedBoulder = "";
    if (this.onMapEntered) {
      this.onMapEntered(this);
    }
  }

  isMoving(): boolean {
    return this.stepProgress < 1;
  }

  /** Interpolated cell position, for drawing the player between two cells. */
  visualCell(): number[] {
    if (this.stepProgress >= 1 || this.turning) {
      return [this.cellX, this.cellY];
    }
    const t = this.stepProgress;
    return [
      this.stepFromX + (this.cellX - this.stepFromX) * t,
      this.stepFromY + (this.cellY - this.stepFromY) * t,
    ];
  }

  /** Unit step for a facing. Public so the caller can place things ahead of the player. */
  static facingDelta(direction: string): number[] {
    return Overworld.delta(direction);
  }

  private static delta(direction: string): number[] {
    if (direction === "up") return [0, -1];
    if (direction === "down") return [0, 1];
    if (direction === "left") return [-1, 0];
    if (direction === "right") return [1, 0];
    return [0, 0];
  }

  /** Which direction the D-pad is asking for, or "" for none. */
  private static heldDirection(input: InputSource, turns: number): string {
    const pad = input.dpad();
    // Deliberately ordered: the original resolves opposing presses this way.
    let pressed = "";
    if (pad.down) pressed = "down";
    else if (pad.up) pressed = "up";
    else if (pad.left) pressed = "left";
    else if (pad.right) pressed = "right";
    if (pressed === "") {
      return "";
    }
    // The winner is rotated, never the raw buttons. The tie-break above is
    // about the joypad REGISTER -- which physical press beats which -- and
    // rotating first would quietly change that depending on which side of the
    // table the wearer happens to be standing on. See ViewRelativeInput.
    return turnPress(pressed, turns);
  }

  /**
   * How far the wearer's view is turned from the map's north, in quarter turns.
   *
   * Zero is the cartridge exactly: UP is north, as it has been since 1996 and
   * as it must stay on a flat screen. It is only ever anything else because a
   * diorama on a table can be walked round, and a wearer on the far side of
   * the table pressing UP means "away from me". Set from PokemonAR, which owns
   * the camera and the diorama's heading; this class only spends it.
   *
   * It is deliberately NOT applied in input.dpad(). Thirteen other callers
   * read that -- the START menu, the OPTION page, the shop, the naming screen,
   * the fight's menu -- and in every one of them up is a cursor rather than a
   * compass. Rotating at the source would make the menus scroll sideways when
   * the wearer stood on the west side of their own table.
   */
  viewTurns: number = 0;

  /**
   * Advances the walk by `dt` seconds and returns what happened. The caller
   * rebuilds the diorama when mapChanged is set and opens a battle when an
   * encounter comes back.
   */
  /**
   * Whether a step into grass may roll an encounter.
   *
   * Owned by the play loop, which is the only thing that knows whether the party
   * can fight. Defaults to false so a caller that never sets it cannot walk into
   * a throw; the loop turns it on once there is a healthy Pokemon.
   */
  encountersEnabled: boolean = false;

  /**
   * Steps a script has asked the player to take, and in which direction.
   *
   * Driven through the SAME path as a held button rather than teleporting the
   * player, so a scripted walk inherits turning, collision, ledges and map
   * seams exactly as a real one does. A script that walks you into a wall stops
   * there, which is what the cartridge does too.
   */
  private scriptedSteps: number = 0;
  private scriptedDir: string = "";

  /**
   * pokered's BIT_STANDING_ON_WARP, re-derived after every completed step and
   * on every map entry: true on a warp cell unless its tile is a staircase or
   * ladder (a warp tile that is not a door tile). It is what lets you press
   * down on the mat you arrived on and leave, and what stops the stairs from
   * bouncing you between floors when you press into the wall beside them.
   */
  standingOnWarp: boolean = false;
  /** Whether a direction was held on the last update: CheckWarpsNoCollision asks. */
  directionHeld: boolean = false;

  /**
   * Cells whose warp is shut for now: the gangway once the S.S. Anne has gone
   * (`dec [wNumberOfWarps]`, VermilionDock.asm:120-121). Keyed "x,y". Reset
   * on every map entry; PlayLoop stamps them back from the flags.
   */
  private shutWarps: any = {};

  /**
   * Where a warp on THIS map leads, when a script has changed its mind.
   *
   * A lift car rewrites both of its own warp entries -- to the floor the
   * player boarded from, and again to whatever floor they pick (Elevators.ts).
   * Keyed by the warp's own cell, and dropped on every map entry, which is
   * where the cartridge's wWarpEntries are rebuilt too.
   */
  private warpOverrides: any = {};

  overrideWarp(x: number, y: number, destMap: string, destWarp: number): void {
    this.warpOverrides[x + "," + y] = { map: destMap, warp: destWarp };
  }

  /** The override for a warp's cell, or null. */
  warpOverrideAt(x: number, y: number): any {
    const found = this.warpOverrides[x + "," + y];
    return found ? found : null;
  }

  setShutWarps(cells: number[][]): void {
    this.shutWarps = {};
    for (let i = 0; i < cells.length; i++) {
      this.shutWarps[cells[i][0] + "," + cells[i][1]] = true;
    }
  }

  /** The warp at a cell unless a flag has shut it. */
  private openWarpAt(x: number, y: number): any {
    if (this.shutWarps[x + "," + y] === true) {
      return null;
    }
    return this.map.warpAt(x, y);
  }

  refreshStandingOnWarp(): void {
    const onWarp = this.openWarpAt(this.cellX, this.cellY) !== null;
    const stairLike = this.map.isWarpTile(this.cellX, this.cellY) &&
      !this.map.isDoorTile(this.cellX, this.cellY);
    this.standingOnWarp = onWarp && !stairLike;
  }

  /**
   * ExtraWarpCheck (home/overworld.asm): may a warp under the player fire
   * toward `direction` when the cell's own tile is not a door or warp tile?
   * On the carpet tilesets and maps the tile in front must be a warp carpet
   * for that direction; everywhere else the player must face the map edge.
   */
  extraWarpCheck(direction: string): boolean {
    const facingEdge =
      (direction === "up" && this.cellY === 0) ||
      (direction === "down" && this.cellY === this.map.heightCells - 1) ||
      (direction === "left" && this.cellX === 0) ||
      (direction === "right" && this.cellX === this.map.widthCells - 1);
    const carpets: any = this.bundle.field ? this.bundle.field.warpCarpets : null;
    if (!carpets) {
      return facingEdge;
    }
    let useCarpet: boolean;
    if (Overworld.listHas(carpets.edgeMaps, this.mapId)) {
      useCarpet = false;
    } else if (Overworld.listHas(carpets.function2Maps, this.mapId)) {
      useCarpet = true;
    } else {
      useCarpet = Overworld.listHas(carpets.function2Tilesets, this.map.def.tileset);
    }
    if (!useCarpet) {
      return facingEdge;
    }
    const d = Overworld.delta(direction);
    const front = this.map.cellTile(this.cellX + d[0], this.cellY + d[1]);
    if (carpets.ssAnneBow && this.mapId === carpets.ssAnneBow.map) {
      return front === carpets.ssAnneBow.tile;
    }
    const tiles = carpets.tiles ? carpets.tiles[direction] : null;
    return Overworld.listHas(tiles, front);
  }

  private static listHas(list: any, value: any): boolean {
    if (!list) {
      return false;
    }
    for (let i = 0; i < list.length; i++) {
      if (list[i] === value) {
        return true;
      }
    }
    return false;
  }

  update(dt: number, input: InputSource): StepResult {
    const result: StepResult = { mapChanged: false, encounter: null, blocked: false,
                                 landed: false, blockedAtEdge: false, hopped: false,
                                 pushed: null };
    this.directionHeld = Overworld.heldDirection(input, this.viewTurns) !== "";

    if (this.stepProgress < 1) {
      this.stepProgress += dt / this.stepDuration;
      if (this.stepProgress < 1) {
        return result;
      }
      this.stepProgress = 1;
      if (this.turning) {
        this.turning = false;
      } else {
        // The step has landed, so this is where grass gets to bite.
        this.steps++;
        if (this.scriptedSteps > 0) {
          this.scriptedSteps = this.scriptedSteps - 1;
        }
        this.lastCellWasGrass = this.map.isGrass(this.cellX, this.cellY);
        // Landing on a cell you could have walked to ends the surf, with no
        // prompt -- CollisionCheckOnWater .stopSurfing. Checked here, after the
        // landing, so the encounter below rolls the table the player is ON.
        if (this.surfing && this.map.isWalkable(this.cellX, this.cellY)) {
          this.surfing = false;
        }
        // Grass only bites when there is something to send out. startWildBattle
        // THROWS on an empty or wiped party ("battle: a side has nothing to send
        // out"), and the two states that reach it are ordinary ones: a save
        // migrated from before the party existed, and the walk from the front
        // door to Oak's lab before the player has been given anything.
        result.encounter = this.encountersEnabled ? this.rollEncounter() : null;
        if (this.cellX !== this.arrivalX || this.cellY !== this.arrivalY) {
          this.arrivalX = -1;
          this.arrivalY = -1;
        }
        // The landing is reported BEFORE the next held step starts, so a
        // trigger or a warp on this cell is read while the player stands on it.
        // The cartridge runs the map script before the joypad step too. It
        // costs one frame per step; the alternative is a step that has to be
        // undone.
        this.refreshStandingOnWarp();
        result.landed = true;
        return result;
      }
    }

    // A scripted walk outranks the buttons: the player is not in control while
    // a script is running, and the loop freezes their input anyway.
    let direction = this.scriptedSteps > 0
      ? this.scriptedDir
      : Overworld.heldDirection(input, this.viewTurns);
    // CYCLING ROAD pedals itself (JoypadOverworld, home/overworld.asm): on a
    // slope map, with no direction held and neither A nor B going down, the
    // cartridge writes D_DOWN into the joypad byte. MAP down, whatever way
    // the wearer has turned the world -- the hill does not turn with it.
    if (direction === "" && isSlopeMap(this.bundle, this.mapId) &&
        !input.pressedA() && !input.pressedB()) {
      direction = "down";
    }
    if (direction === "") {
      return result;
    }

    if (direction !== this.facing) {
      // Turn first. Costing a beat here is what makes it possible to face a door
      // without walking into it, exactly as the original does.
      this.facing = direction;
      this.turning = true;
      this.armedBoulder = "";
      this.stepProgress = 0;
      this.stepDuration = TURN_SECONDS;
      this.stepFromX = this.cellX;
      this.stepFromY = this.cellY;
      return result;
    }

    const d = Overworld.delta(direction);
    const targetX = this.cellX + d[0];
    const targetY = this.cellY + d[1];

    if (!this.map.inBounds(targetX, targetY)) {
      if (this.crossConnection(direction, targetX, targetY)) {
        // Measured: the step off the edge IS a step -- Pallet Town's row 0
        // to Route 1's row 35 is one walk, not a teleport and a walk. The
        // cell arrives at once here; it counts as landed so a held pad, a
        // scripted walk and the step counter see one step, as on the
        // cartridge.
        result.mapChanged = true;
        result.landed = true;
        this.steps++;
        if (this.scriptedSteps > 0) {
          this.scriptedSteps = this.scriptedSteps - 1;
        }
        this.refreshStandingOnWarp();
      } else {
        result.blocked = true;
        result.blockedAtEdge = true;
        this.scriptedSteps = 0;
      }
      return result;
    }

    // A ledge hop -- pokered's LedgeTiles, OVERWORLD only. Facing this way
    // already (the turn above ran first), standing on the paired tile with
    // the ledge tile one cell ahead: the step becomes a two-cell hop over it
    // rather than a blocked step. The ledge cell itself is still never
    // entered from any side; only the far cell lands (grass, warps, the
    // step counter all read that arrival, once).
    if (isLedgeHop(this.bundle, this.map.def.tileset, direction,
                   this.map.cellTile(this.cellX, this.cellY),
                   this.map.cellTile(targetX, targetY))) {
      const hopX = targetX + d[0];
      const hopY = targetY + d[1];
      if (!this.map.canEnter(hopX, hopY)) {
        // Must land clear of a body -- blocked exactly like a wall ahead.
        result.blocked = true;
        this.scriptedSteps = 0;
        return result;
      }
      this.armedBoulder = "";
      this.stepFromX = this.cellX;
      this.stepFromY = this.cellY;
      this.cellX = hopX;
      this.cellY = hopY;
      this.stepProgress = 0;
      // A ledge hop is never sped up: DoBikeSpeedup skips the double step
      // while BIT_LEDGE_OR_FISHING is set (home/overworld.asm:376-388).
      this.stepDuration = LEDGE_HOP_SECONDS;
      result.hopped = true;
      return result;
    }

    // A boulder with Strength up is pushed rather than bumped into. It stays a
    // blocked step either way: the player does not move on the frame the
    // boulder does.
    const ahead = this.map.objectAt(targetX, targetY);
    if (ahead !== null && this.map.isBoulder(ahead) && this.strengthActive) {
      result.pushed = this.tryPushBoulder(ahead, d, direction);
      result.blocked = true;
      this.scriptedSteps = 0;
      return result;
    }

    const enterable = this.map.canEnter(targetX, targetY) ||
      (this.surfing && this.canSurfEnter(targetX, targetY));
    if (!enterable) {
      result.blocked = true;
      // A scripted walk into a wall stops there rather than retrying forever.
      // The step never lands, so the counter would never come down, and the
      // script waiting on it would hold the lens for good.
      this.scriptedSteps = 0;
      return result;
    }

    this.armedBoulder = "";
    this.stepFromX = this.cellX;
    this.stepFromY = this.cellY;
    this.cellX = targetX;
    this.cellY = targetY;
    this.stepProgress = 0;
    this.stepDuration = this.riding ? STEP_SECONDS * BIKE_STEP_FACTOR : STEP_SECONDS;
    return result;
  }

  /** The cell the player is facing, in or out of bounds. */
  facingCell(): number[] {
    const d = Overworld.delta(this.facing);
    return [this.cellX + d[0], this.cellY + d[1]];
  }

  /**
   * One push. The first attempt only arms (BIT_TRIED_PUSH_BOULDER); the next
   * consecutive one moves the boulder, if the cell beyond it is free. There is
   * no water or hole escape: CheckForCollisionWhenPushingBoulder uses the same
   * walkable list a step does.
   */
  private tryPushBoulder(object: any, d: number[], direction: string): BoulderPush {
    if (this.armedBoulder !== object.name) {
      this.armedBoulder = object.name;
      return null;
    }
    const from = this.map.objectCell(object);
    const toX = from[0] + d[0];
    const toY = from[1] + d[1];
    if (!this.map.inBounds(toX, toY) || !this.map.isWalkable(toX, toY) ||
        this.map.objectAt(toX, toY) !== null) {
      return null;
    }
    this.map.moveObject(object.name, toX, toY);
    this.armedBoulder = "";
    return { name: object.name, fromX: from[0], fromY: from[1],
             toX: toX, toY: toY, direction: direction };
  }

  /** Water or shore on a map that has water at all. Shore is land in SHIP_PORT. */
  private surfableOn(map: MapRuntime, cx: number, cy: number): boolean {
    if (!map.inBounds(cx, cy)) {
      return false;
    }
    if (waterTilesetsOf(this.bundle).indexOf(map.tileset.id) < 0) {
      return false;
    }
    const tile = map.cellTile(cx, cy);
    if (tile === WATER_TILE) {
      return true;
    }
    if (map.tileset.id === NO_SHORE_TILESET) {
      return false;
    }
    return SHORE_TILES.indexOf(tile) >= 0;
  }

  /** Surfable, on this map. */
  isSurfable(cx: number, cy: number): boolean {
    return this.surfableOn(this.map, cx, cy);
  }

  /** Surfable AND free of objects: a cell the player may swim onto. */
  canSurfEnter(cx: number, cy: number): boolean {
    return this.surfableOn(this.map, cx, cy) && this.map.objectAt(cx, cy) === null;
  }

  /** Water ahead, for the SURF prompt. */
  surfableAhead(): boolean {
    const cell = this.facingCell();
    return this.canSurfEnter(cell[0], cell[1]);
  }

  /** Dry land ahead, for the dismount. */
  landAhead(): boolean {
    const cell = this.facingCell();
    return this.map.canEnter(cell[0], cell[1]);
  }

  /**
   * Get on the water: the flag, then one forced step onto it
   * (ItemUseSurfboard writes 2 to wWalkBikeSurfState and steps).
   */
  startSurf(): void {
    this.surfing = true;
    this.walkScripted(this.facing, 1);
  }

  /**
   * The block a Cut would open, as [bx, by, afterBlock], or null.
   *
   * Three gates, in the cartridge's order: the TILESET and its one cuttable
   * tile, the block being in the swap table, and -- for a tree, not for tall
   * grass -- the cell being solid. Without the tile gate every PLATEAU block
   * whose number happens to appear in the swap table is "cuttable", and the
   * swap writes a block id that tileset does not have.
   */
  cutTargetAhead(): number[] {
    const cell = this.facingCell();
    if (!this.map.inBounds(cell[0], cell[1])) {
      return null;
    }
    const kind = cutKindOf(this.map.tileset.id, this.map.cellTile(cell[0], cell[1]));
    if (kind === "") {
      return null;
    }
    if (kind !== "grass" && this.map.isWalkable(cell[0], cell[1])) {
      return null;
    }
    const bx = Math.floor(cell[0] / 2);
    const by = Math.floor(cell[1] / 2);
    const after = cutSwapFor(this.bundle, this.map.blockAt(bx, by));
    if (after < 0) {
      return null;
    }
    return [bx, by, after];
  }

  /** Apply the cut. False when there was nothing to cut after all. */
  cutAhead(): boolean {
    const target = this.cutTargetAhead();
    if (target === null) {
      return false;
    }
    this.map.setBlockOverride(target[0], target[1], target[2]);
    return true;
  }

  /** A map that needs Flash, and has not had it. */
  isDark(): boolean {
    return this.darkened && darkMapsOf(this.bundle).indexOf(this.mapId) >= 0;
  }

  lightArea(): void {
    this.darkened = false;
  }

  /** Fly to a town's landing spot. False when it has none. */
  flyTo(mapId: string): boolean {
    const spot = flyWarpOf(this.bundle, mapId);
    if (spot === null) {
      print("overworld: no fly landing spot for " + mapId);
      return false;
    }
    this.surfing = false;
    return this.enterMapAt(mapId, spot.x, spot.y, "down");
  }

  /**
   * The warp under the player, if any, and not the one they arrived on.
   * Doors, stairs and holes fire on arrival, not on press.
   */
  pendingWarp(): any {
    if (this.cellX === this.arrivalX && this.cellY === this.arrivalY) {
      return null;
    }
    return this.openWarpAt(this.cellX, this.cellY);
  }

  /** The open warp at any cell, or null; for a route deciding how to end. */
  pendingWarpAt(x: number, y: number): any {
    return this.openWarpAt(x, y);
  }

  /**
   * The warp under the player even on the arrival cell: the mat inside a door.
   * You arrive on it and press into the wall to leave; the cartridge's
   * CheckWarpsCollision path.
   */
  warpUnderPlayer(): any {
    return this.openWarpAt(this.cellX, this.cellY);
  }

  /**
   * Whether the player is outdoors right now.
   *
   * The instance form exists so callers can ask without importing the class as
   * a VALUE: PlayLoop needs the answer for FLY, and a runtime import there
   * would put the whole world module into the script layer's dependency graph.
   */
  isOutside(): boolean {
    return Overworld.isOutside(this.map.def);
  }

  /** A town or a route: the maps LAST_MAP can name. */
  static isOutside(def: MapDef): boolean {
    return def.tileset === "OVERWORLD" || def.tileset === "PLATEAU";
  }

  /**
   * Which outside map a LAST_MAP warp means.
   *
   * The candidates are the outside maps with a warp into this one. Most
   * buildings have one. A gate has two, one per side, and which one you leave
   * toward is decided by geometry: the candidate whose door on THIS map lies
   * on the same row or column as the mat you stand on. Ties go to the map you
   * came from, which is what LAST_MAP literally says.
   */
  private resolveLastMap(warp: any): string {
    const here = this.map.def;
    const myEdge = Overworld.edgeOf(here, warp);
    let best: string = "";
    let bestScore = -1;
    const maps = this.bundle.maps;
    for (const id in maps) {
      const def: MapDef = maps[id];
      if (!Overworld.isOutside(def)) {
        continue;
      }
      for (let k = 0; k < def.warps.length; k++) {
        const w = def.warps[k];
        if (w.destMap !== here.id) {
          continue;
        }
        // The door on THIS map that the candidate's warp lands on. The exact
        // mat is the strongest sign; the same edge of the map the next -- a
        // gate's two mats per side lie on one edge, and the far side's on the
        // other, whichever way the gate runs.
        const mate = here.warps[w.destWarp - 1];
        let score = 1;
        if (mate && mate.x === warp.x && mate.y === warp.y) {
          score += 4;
        } else if (mate && myEdge !== "" && Overworld.edgeOf(here, mate) === myEdge) {
          score += 2;
        }
        if (id === this.lastMapId) {
          score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          best = id;
        }
      }
    }
    if (best === "" && this.lastMapId) {
      return this.lastMapId;
    }
    return best;
  }

  /** Which edge of the map a warp cell lies on: "N", "S", "E", "W" or "". */
  private static edgeOf(def: MapDef, warp: any): string {
    const w = def.width * 2;
    const h = def.height * 2;
    if (warp.y === 0) return "N";
    if (warp.y === h - 1) return "S";
    if (warp.x === 0) return "W";
    if (warp.x === w - 1) return "E";
    return "";
  }

  /**
   * Enter a map at a specific cell.
   *
   * Scripts warp by COORDINATE, not by warp index: the cartridge's own scripted
   * warps name a cell and a facing. takeWarp is for stepping onto a warp tile.
   */
  enterMapAt(mapId: string, x: number, y: number, facing: string): boolean {
    if (!this.mapDef(mapId)) {
      print("overworld: scripted warp to unknown map " + mapId);
      return false;
    }
    this.enterMap(mapId, x, y);
    if (facing) {
      this.facing = facing;
    }
    return true;
  }

  takeWarp(warp: any): boolean {
    // A lift car's own two warps are rewritten while the player is inside it
    // (Elevators.ts); everything else leads where the map data says.
    const over = this.warpOverrideAt(warp.x, warp.y);
    const destId = over !== null ? over.map
      : warp.destMap === "LAST_MAP" ? this.resolveLastMap(warp) : warp.destMap;
    const destDef = this.mapDef(destId);
    if (!destDef) {
      print("overworld: warp to unknown map " + warp.destMap + " (" + destId + ")");
      return false;
    }
    if (Overworld.isOutside(this.map.def)) {
      this.lastMapId = this.mapId;
    }
    // A warp ends a scripted walk: the Safari gate walks you in and stops.
    this.scriptedSteps = 0;
    // destWarp is 1-based in the ROM data; an override's warp is an index.
    const index = over !== null ? over.warp : warp.destWarp - 1;
    const target = destDef.warps[index];
    if (!target) {
      this.enterMap(destId, 0, 0);
      return true;
    }
    this.enterMap(destId, target.x, target.y);
    return true;
  }

  /**
   * Steps off the edge onto a connected map. Offsets are in blocks and cells are
   * half-blocks, hence the doubling. The destination cell is collision-checked
   * before the swap, so walking off an edge onto a wall bumps like any other wall
   * instead of stranding the player on an unreachable cell.
   */
  private crossConnection(direction: string, targetX: number, targetY: number): boolean {
    const compass =
      direction === "up" ? "north" :
      direction === "down" ? "south" :
      direction === "left" ? "west" : "east";

    const connection = this.map.connection(compass);
    if (!connection) {
      return false;
    }
    const destDef = this.mapDef(connection.map);
    if (!destDef) {
      print("overworld: connection to unknown map " + connection.map);
      return false;
    }

    const destWidth = destDef.width * 2;
    const destHeight = destDef.height * 2;
    let x = 0;
    let y = 0;
    if (direction === "up") {
      x = this.cellX - connection.offset * 2;
      y = destHeight - 1;
    } else if (direction === "down") {
      x = this.cellX - connection.offset * 2;
      y = 0;
    } else if (direction === "left") {
      x = destWidth - 1;
      y = this.cellY - connection.offset * 2;
    } else {
      x = 0;
      y = this.cellY - connection.offset * 2;
    }
    x = Math.max(0, Math.min(destWidth - 1, x));
    y = Math.max(0, Math.min(destHeight - 1, y));

    const probe = new MapRuntime(destDef, this.tilesetFor(destDef));
    probe.setReveals(this.reveals);
    this.applyOverrides(probe);
    // While surfing the seam cell is usually water: ROUTE_19 into ROUTE_20 is
    // open sea on both sides, and a canEnter-only probe strands the player
    // mid-ocean with no legal move.
    const canCross = probe.canEnter(x, y) ||
      (this.surfing && this.surfableOn(probe, x, y) && probe.objectAt(x, y) === null);
    if (!canCross) {
      return false;
    }

    this.enterMap(connection.map, x, y);
    return true;
  }

  /** Gen 1 wild roll on the cell just entered. Returns null far more often than not. */
  /**
   * Whether wild Pokemon can appear on ANY tile here: caves, the Tower, the
   * Mansion, the Power Plant. Outside and in Viridian Forest only grass bites
   * (wild_encounters.asm checks the tile only for those tilesets). Mt Moon
   * had no wild Pokemon at all until this was written.
   */
  private encountersOnEveryTile(): boolean {
    return !Overworld.isOutside(this.map.def) && this.map.def.tileset !== "FOREST";
  }

  private rollEncounter(): WildEncounter {
    const table = this.bundle.encounters[this.mapId];
    if (!table) {
      return null;
    }
    // Surfing rolls the WATER table on every cell and never asks about grass:
    // wild_encounters.asm selects wWaterMons when wWalkBikeSurfState is 2.
    if (!this.surfing && !this.encountersOnEveryTile() &&
        !this.map.isGrass(this.cellX, this.cellY)) {
      return null;
    }
    const grass = this.surfing ? table.water : table.grass;
    if (!grass || !grass.rate || grass.rate === 0) {
      return null;
    }
    if (Math.floor(this.random() * 256) >= grass.rate) {
      return null;
    }
    const pick = Math.floor(this.random() * 256);
    for (let i = 0; i < ENCOUNTER_BUCKETS.length; i++) {
      if (pick < ENCOUNTER_BUCKETS[i]) {
        const slot = grass.slots[i];
        return slot ? { species: slot.species, level: slot.level } : null;
      }
    }
    return null;
  }

  /**
   * The map's first grass slot, as a deterministic stand-in for a real roll.
   * Used by the debug harness and by LEAF, so the battle transition can be
   * exercised without waiting on a 25/256 chance.
   */
  firstEncounterOfMap(): WildEncounter {
    const table = this.bundle.encounters[this.mapId];
    if (!table || !table.grass || !table.grass.slots.length) {
      return null;
    }
    const slot = table.grass.slots[0];
    return { species: slot.species, level: slot.level };
  }

  /** Display name for a species id, falling back to the id itself. */
  speciesName(id: string): string {
    const species = this.bundle.species[id];
    return species && species.name ? species.name : id;
  }
}
