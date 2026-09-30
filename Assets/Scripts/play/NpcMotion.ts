// Scripted NPC walks, as pure state: where each one is, where it is going, and
// how far along the current step it has got.
//
// The lens's walkNpc, moveNpc and moveNpcTo were `() => DONE` stubs: every
// scripted walk -- Oak into the lab, the rival leaving, the Mt Moon nerd --
// completed in the same frame and the sprite either teleported or never moved.
// The headless tests could not see it, because the fakes return DONE too.
//
// This is the part a test CAN see. PokemonAR asks it each frame where every
// walking NPC stands and puts the billboard there; the host's requests come in
// with the poll-until-DONE shape the VM uses for the player's own walk.

export const NPC_STEP_SECONDS: number = 0.26;

/** RUNNING and DONE as the VM spells them; kept local so this file imports nothing. */
const DONE: number = 0;
const RUNNING: number = 1;

export interface NpcPose {
  /** The cell the NPC stands on, or is stepping onto. */
  x: number;
  y: number;
  /** Interpolated, for drawing between two cells. */
  visualX: number;
  visualY: number;
  facing: string;
  walking: boolean;
}

interface NpcMove {
  path: string[];
  index: number;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  progress: number;
  facing: string;
  done: boolean;
}

function delta(direction: string): number[] {
  if (direction === "up") return [0, -1];
  if (direction === "down") return [0, 1];
  if (direction === "left") return [-1, 0];
  if (direction === "right") return [1, 0];
  return [0, 0];
}

export class NpcMotion {
  private moves: any = {};
  private poses: any = {};

  /** Forget everything: the map changed and every NPC is back where it ships. */
  reset(): void {
    this.moves = {};
    this.poses = {};
  }

  /**
   * The host's request, polled every frame until DONE.
   *
   * The first call starts the walk from where the NPC is -- its last pose if
   * it has moved before, else the shipped cell the caller passes -- and
   * answers RUNNING. Later calls answer RUNNING until the last step lands,
   * then DONE once, and the request is forgotten so the same NPC can be asked
   * again. An empty path is DONE at once.
   */
  request(name: string, shippedX: number, shippedY: number, path: string[]): number {
    const inFlight: NpcMove = this.moves[name];
    if (inFlight) {
      if (!inFlight.done) {
        return RUNNING;
      }
      delete this.moves[name];
      return DONE;
    }
    if (!path || path.length === 0) {
      return DONE;
    }
    const pose: NpcPose = this.poses[name];
    const startX = pose ? pose.x : shippedX;
    const startY = pose ? pose.y : shippedY;
    const d = delta(path[0]);
    const move: NpcMove = {
      path: path, index: 0, fromX: startX, fromY: startY,
      x: startX + d[0], y: startY + d[1], progress: 0, facing: path[0], done: false,
    };
    this.moves[name] = move;
    this.poses[name] = { x: move.x, y: move.y, visualX: startX, visualY: startY, facing: move.facing, walking: true };
    return RUNNING;
  }

  /** Horizontal first, then vertical: the straight walk a script expects. */
  pathTo(fromX: number, fromY: number, toX: number, toY: number): string[] {
    const out: string[] = [];
    let x = fromX;
    let y = fromY;
    while (x !== toX) {
      out.push(x < toX ? "right" : "left");
      x += x < toX ? 1 : -1;
    }
    while (y !== toY) {
      out.push(y < toY ? "down" : "up");
      y += y < toY ? 1 : -1;
    }
    return out;
  }

  /**
   * Put an NPC on a cell at once, facing a way, forgetting any walk in flight.
   *
   * The cartridge sets a sprite's coordinates before a cutscene walks it --
   * the rival is placed at the lab door before he comes in for Oak's request
   * -- and `face` cannot do that: it keeps the cell of a pose that already
   * exists, so a rival who had walked about the lab earlier would set off
   * from wherever that left him.
   */
  place(name: string, x: number, y: number, direction: string): void {
    delete this.moves[name];
    this.poses[name] = { x: x, y: y, visualX: x, visualY: y, facing: direction, walking: false };
  }

  /** Turn an NPC without moving it. */
  face(name: string, shippedX: number, shippedY: number, direction: string): void {
    const pose: NpcPose = this.poses[name];
    if (pose) {
      pose.facing = direction;
      return;
    }
    this.poses[name] = { x: shippedX, y: shippedY, visualX: shippedX, visualY: shippedY, facing: direction, walking: false };
  }

  /** Advance every walk by dt seconds. */
  update(dt: number): void {
    for (const name in this.moves) {
      const move: NpcMove = this.moves[name];
      if (move.done) {
        continue;
      }
      move.progress += dt / NPC_STEP_SECONDS;
      while (move.progress >= 1 && !move.done) {
        move.progress -= 1;
        move.index++;
        move.fromX = move.x;
        move.fromY = move.y;
        if (move.index >= move.path.length) {
          move.done = true;
          move.progress = 1;
          break;
        }
        const d = delta(move.path[move.index]);
        move.facing = move.path[move.index];
        move.x = move.fromX + d[0];
        move.y = move.fromY + d[1];
      }
      const t = move.done ? 1 : move.progress;
      this.poses[name] = {
        x: move.x, y: move.y,
        visualX: move.fromX + (move.x - move.fromX) * t,
        visualY: move.fromY + (move.y - move.fromY) * t,
        facing: move.facing,
        walking: !move.done,
      };
    }
  }

  /** Where an NPC that has moved or turned stands now, or null if untouched. */
  pose(name: string): NpcPose {
    const p: NpcPose = this.poses[name];
    return p ? p : null;
  }

  isMoving(name: string): boolean {
    const move: NpcMove = this.moves[name];
    return !!move && !move.done;
  }

  /** Every NPC with a pose of its own, for the lens to place. */
  names(): string[] {
    return Object.keys(this.poses);
  }
}
