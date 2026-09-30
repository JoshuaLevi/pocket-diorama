// The hand as a joystick: a pinch held inside the plate walks the player
// toward the hand, for as long as it is held.
//
// Joshua's second way of walking with the hands (29 September): "de positie
// van de hand, zonder visuele D-pad". The player is the fixed point of the
// diorama, so the vector from the plate's centre to the pinch IS the vector
// from the player to the hand; its dominant axis is the direction held, and
// a small dead zone around the player keeps a hand that merely rests there
// from walking anywhere. It is an input source like the route, so the steps
// go through Overworld.update as a thumb's would: encounters, doors,
// collision and triggers all behave, and nothing in the world learned a new
// way to move.
//
// It is NOT the grab. DioramaHands only ever makes a stick of a pinch that
// began inside the plate; a pinch on the handle band moves the world, and a
// pinch let go within TAP_SECONDS is a tap (walk there, or A).

import type { InputSource, DPadState } from "./InputSource";
import { emptyDPad } from "./InputSource";
import { turnPress } from "./ViewRelativeInput";

/** Closer than this to the player, in cells, the stick is centred and holds nothing. */
export const STICK_DEADZONE_CELLS: number = 0.6;

/**
 * The map direction a hand this far from the player asks for: the dominant
 * axis, "" inside the dead zone. +x is east ("right"), +z is south ("down"),
 * the diorama root's own axes.
 */
export function stickDirection(dxCells: number, dzCells: number,
                               deadzone: number = STICK_DEADZONE_CELLS): string {
  const ax = Math.abs(dxCells);
  const az = Math.abs(dzCells);
  if (Math.max(ax, az) < deadzone) {
    return "";
  }
  if (ax >= az) {
    return dxCells > 0 ? "right" : "left";
  }
  return dzCells > 0 ? "down" : "up";
}

export class StickSource implements InputSource {
  readonly name: string = "stick";

  /** The map direction held, or "". */
  private direction: string = "";
  private viewTurns: number = 0;
  private everUsed: boolean = false;

  /** The wearer's quarter turns, so the press comes out in map directions. */
  setViewTurns(turns: number): void {
    this.viewTurns = ((turns % 4) + 4) % 4;
  }

  /** Points the stick: the hand is this far from the player, in cells. Returns what is held. */
  aim(dxCells: number, dzCells: number): string {
    this.direction = stickDirection(dxCells, dzCells);
    if (this.direction !== "") {
      this.everUsed = true;
    }
    return this.direction;
  }

  /** A filtered pinch joystick supplies a map direction without tile-sized dead zones. */
  hold(direction: string): void {
    this.direction = direction;
    if (direction !== "") this.everUsed = true;
  }

  /** The hand opened. */
  release(): void {
    this.direction = "";
  }

  /** The map direction held, for the marker one cell ahead. */
  heldDirection(): string {
    return this.direction;
  }

  isActive(): boolean {
    return this.direction !== "";
  }

  cancel(): void {
    this.release();
  }

  update(): void {
    // Everything happens in aim(), which has the hand.
  }

  dpad(): DPadState {
    const pad = emptyDPad();
    if (this.direction === "") {
      return pad;
    }
    // The overworld turns a press by the view; adding the complement undoes it.
    const press = turnPress(this.direction, (4 - this.viewTurns) % 4);
    if (press === "up") pad.up = true;
    else if (press === "down") pad.down = true;
    else if (press === "left") pad.left = true;
    else if (press === "right") pad.right = true;
    return pad;
  }

  pressedA(): boolean {
    return false;
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
    return this.everUsed;
  }
}
