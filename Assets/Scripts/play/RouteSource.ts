// A d-pad that walks a route, for the pinch-to-walk.
//
// The wearer pinches a spot on the diorama; PathFind turns it into cells; this
// holds the direction toward the next cell until the player stands on it, then
// the next, and lets go at the end. It is an INPUT SOURCE and nothing more: the
// steps it asks for go through Overworld.update like a thumb on a real pad, so
// grass rolls its encounters, warps fire, triggers fire, a trainer's line of
// sight stops the walk, and a body stepping into the way blocks the step the
// way it blocks a held button. Nothing in the world learns a new way to move.
//
// It yields to a hand at once: any real direction cancels it (the router calls
// cancel() when the active source holds a direction), and so does a step that
// makes no progress for a second -- someone standing in the way, a door that
// warped the player somewhere the route never was.
//
// The overworld turns every press by the wearer's view (Overworld.heldDirection
// through turnPress), because a real thumb thinks in the wearer's frame. A
// route thinks in the map's, so it un-turns its press first; the caller keeps
// it told of the current turn. Pure: a node test walks it.
//
// A route may end with an EXIT: the exit mats along the bottom of every house
// (and the lab's two-wide doorway) are warp cells whose tile is not a door, and
// the cartridge fires them only with the pad held toward the map edge
// (ExtraWarpCheck). Arriving on the mat from the side does nothing, which is
// what a pinch on the mat produced on 19 September: Red standing in the
// doorway. So the caller may name the edge, and the route keeps pressing
// toward it once the last cell is reached, until the warp moves the player
// (the cell changes) or a second passes with nothing happening.
//
// And a route may end FACING something: a pinch on a person, a sign or a
// bookshelf routes to the cell beside it, and then the walk's last step may
// have left Red looking the wrong way. So the caller names the cell, the
// route holds the direction toward it until the overworld reports that facing
// (a turn is a beat, never a step, because the cell is not enterable), and
// then presses A once -- which is what pointing at someone means.
//
// The person may not wait. Both of Pallet Town's NPCs are WALK sprites, and a
// girl who was on the pinched cell is two cells away by the time a seven-cell
// walk ends, so the talk lands on grass (the 29 September LEAF run). So the
// route says whom it meant to face (faceTarget), and the caller, who knows
// where every body stands, plans it again whenever the person has moved
// (personMoved): a pinch on a person is "walk up to her", wherever she goes.

import type { DPadState, InputSource } from "./InputSource";
import { emptyDPad } from "./InputSource";
import { turnPress } from "./ViewRelativeInput";
import { stepToward } from "../world/PathFind";

/** Seconds on one cell without reaching the next before the route is dropped. */
export const ROUTE_STUCK_SECONDS: number = 1.0;

/**
 * Whether the person a route walks up to now stands somewhere else than the
 * cell the route was planned to face. False for a route that faces no one.
 */
export function personMoved(route: RouteSource, personCell: number[]): boolean {
  const face = route.faceTarget();
  if (face === null || !personCell) {
    return false;
  }
  return face[0] !== personCell[0] || face[1] !== personCell[1];
}

export class RouteSource implements InputSource {
  readonly name: string = "route";

  private route: number[][] = [];
  private cellX: number = -1;
  private cellY: number = -1;
  private held: string = "";
  private sinceProgress: number = 0;
  private viewTurns: number = 0;
  /** The map direction to keep pressing once the last cell is reached, or "". */
  private exit: string = "";
  /** The cell the exit press began on; leaving it ends the press. */
  private exitX: number = -1;
  private exitY: number = -1;
  private exiting: boolean = false;
  /** The cell to end up facing (a person, a sign), or null. */
  private faceCell: number[] = null;
  private facingNow: boolean = false;
  /** The one frame A is pressed, once the face is made. */
  private pressA: boolean = false;

  /**
   * Start walking these cells, in order, from wherever the player is now;
   * with `exit`, keep pressing that map direction on the last cell until the
   * player is moved off it (a door mat's warp) or a second passes; with
   * `faceCell`, turn toward that cell at the end and press A once.
   */
  setRoute(cells: number[][], exit: string = "", faceCell: number[] = null): void {
    this.route = cells ? cells.slice() : [];
    this.exit = exit ? exit : "";
    this.exiting = false;
    this.faceCell = faceCell ? [faceCell[0], faceCell[1]] : null;
    this.facingNow = false;
    this.pressA = false;
    this.sinceProgress = 0;
    this.held = "";
  }

  cancel(): void {
    this.route = [];
    this.exit = "";
    this.exiting = false;
    this.faceCell = null;
    this.facingNow = false;
    this.pressA = false;
    this.held = "";
    this.sinceProgress = 0;
  }

  isActive(): boolean {
    return this.route.length > 0 || this.exiting || this.exit !== "" ||
      this.faceCell !== null || this.pressA;
  }

  /** How many cells are still ahead, for the status line and the tests. */
  remaining(): number {
    return this.route.length;
  }

  /**
   * The cell this walk ends on -- the person or sign it will face, else the
   * last cell of the route -- or null when it is not walking. The marker
   * frames it.
   */
  destination(): number[] {
    if (this.faceCell) {
      return [this.faceCell[0], this.faceCell[1]];
    }
    if (this.route.length > 0) {
      const last = this.route[this.route.length - 1];
      return [last[0], last[1]];
    }
    return null;
  }

  /** The cell of the person or sign this walk ends facing, or null. */
  faceTarget(): number[] {
    return this.faceCell ? [this.faceCell[0], this.faceCell[1]] : null;
  }

  /** The wearer's quarter turns, so the press comes out in map directions. */
  setViewTurns(turns: number): void {
    this.viewTurns = ((turns % 4) + 4) % 4;
  }

  /**
   * One frame: where the player stands now and how long the frame was. Reaching
   * the next cell drops it from the route; standing still too long drops the
   * whole route.
   */
  observe(cellX: number, cellY: number, dt: number, facing: string = "", moving: boolean = false): void {
    // The press fired last frame; the route is over.
    if (this.pressA) {
      this.cancel();
      return;
    }
    if (this.facingNow) {
      const want = stepToward(cellX, cellY, this.faceCell[0], this.faceCell[1]);
      this.sinceProgress += dt;
      if (want === "" || this.sinceProgress > ROUTE_STUCK_SECONDS) {
        this.cancel();
        return;
      }
      if (facing === want && !moving) {
        // Turned, and the turn's beat is over (the overworld ignores A while
        // it runs): let go of the direction and press A, this frame only.
        this.held = "";
        this.faceCell = null;
        this.facingNow = false;
        this.pressA = true;
        return;
      }
      // Facing right but still mid-beat: hold nothing, or the press would
      // become a step into the person. Not yet facing: keep turning.
      this.held = facing === want ? "" : turnPress(want, (4 - this.viewTurns) % 4);
      return;
    }
    if (this.exiting) {
      // Pressing into the edge on the mat: the warp ends it by moving the
      // player; a second of nothing ends it too (a shut door, no warp there).
      if (cellX !== this.exitX || cellY !== this.exitY || this.sinceProgress > ROUTE_STUCK_SECONDS) {
        this.cancel();
        return;
      }
      this.sinceProgress += dt;
      this.held = turnPress(this.exit, (4 - this.viewTurns) % 4);
      return;
    }
    if (this.route.length === 0 && this.exit === "" && this.faceCell === null) {
      this.held = "";
      return;
    }
    if (cellX !== this.cellX || cellY !== this.cellY) {
      this.cellX = cellX;
      this.cellY = cellY;
      this.sinceProgress = 0;
    } else {
      this.sinceProgress += dt;
    }
    while (this.route.length > 0 && this.route[0][0] === cellX && this.route[0][1] === cellY) {
      this.route.shift();
      this.sinceProgress = 0;
    }
    if (this.route.length === 0) {
      if (this.faceCell !== null) {
        // Beside it: turn to it. If already facing it, observe() presses A on
        // the next call through the same path.
        this.facingNow = true;
        this.sinceProgress = 0;
        this.observe(cellX, cellY, 0, facing, moving);
        return;
      }
      if (this.exit !== "") {
        // On the last cell: from here the press is the exit, not a step.
        this.exiting = true;
        this.exitX = cellX;
        this.exitY = cellY;
        this.sinceProgress = 0;
        this.held = turnPress(this.exit, (4 - this.viewTurns) % 4);
        return;
      }
      this.held = "";
      return;
    }
    const next = this.route[0];
    const direction = stepToward(cellX, cellY, next[0], next[1]);
    if (direction === "" || this.sinceProgress > ROUTE_STUCK_SECONDS) {
      // Not beside the next cell -- a warp, a shove, a hop -- or blocked for a
      // second. The route no longer describes where the player is.
      this.cancel();
      return;
    }
    // turnPress adds the turns; adding the complement undoes it.
    this.held = turnPress(direction, (4 - this.viewTurns) % 4);
  }

  update(): void {
    // Everything happens in observe(), which has the player's cell.
  }

  dpad(): DPadState {
    const pad = emptyDPad();
    if (this.held === "up") pad.up = true;
    else if (this.held === "down") pad.down = true;
    else if (this.held === "left") pad.left = true;
    else if (this.held === "right") pad.right = true;
    return pad;
  }

  pressedA(): boolean {
    return this.pressA;
  }

  pressedB(): boolean {
    return false;
  }

  pressedStart(): boolean {
    return false;
  }

  pressedSelect(): boolean {
    return false;
  }

  isConnected(): boolean {
    return this.isActive();
  }
}
