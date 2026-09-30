// A walk from one cell to another over the cells the player may step on.
//
// For the pinch: the wearer pinches a spot on the diorama and Red walks there,
// the way a pointed finger means "over there" and not "press up nine times".
// The search is breadth first over four neighbours, which is the shortest
// route on a grid where every step costs the same, and it goes where the
// player could go by hand: canEnter(), so walls, water, ledges from below and
// the bodies standing about all stop it. Ledges are never hopped here; a hop
// needs a facing and a run-up the route does not have, and a wearer who wants
// the far side of one can pinch beyond it and walk round.
//
// A spot that cannot be stood on -- a sign, a person, a tree -- is still a
// place to go: the route ends on the nearest cell beside it that can be
// reached, facing it, which is exactly where you stand to talk to someone.
// Pure, so a node test can walk any map of the bundle.

/** True when the player may step onto the cell; the map answers this. */
export interface Walkable {
  readonly widthCells: number;
  readonly heightCells: number;
  canEnter(cx: number, cy: number): boolean;
}

/** More cells than any route worth walking: a whole Route 1 is 20 by 36. */
const SEARCH_LIMIT: number = 4096;

const STEPS: number[][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * The cells from `from` (exclusive) to `to` (inclusive), or to the nearest
 * enterable neighbour of `to` when `to` itself cannot be stood on. Empty when
 * already there; null when nothing reaches.
 */
export function findPath(map: Walkable, fromX: number, fromY: number,
                         toX: number, toY: number): number[][] {
  if (fromX === toX && fromY === toY) {
    return [];
  }
  const w = map.widthCells;
  const h = map.heightCells;
  if (toX < 0 || toY < 0 || toX >= w || toY >= h) {
    return null;
  }
  const goals: string[] = [];
  if (map.canEnter(toX, toY)) {
    goals.push(toX + "," + toY);
  } else {
    // Beside it, whichever side the walk reaches first.
    for (let i = 0; i < STEPS.length; i++) {
      const nx = toX + STEPS[i][0];
      const ny = toY + STEPS[i][1];
      if (nx === fromX && ny === fromY) {
        return [];
      }
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && map.canEnter(nx, ny)) {
        goals.push(nx + "," + ny);
      }
    }
  }
  if (goals.length === 0) {
    return null;
  }
  const cameFrom: any = {};
  const start = fromX + "," + fromY;
  cameFrom[start] = "";
  const queue: number[][] = [[fromX, fromY]];
  let head = 0;
  let visited = 1;
  while (head < queue.length && visited < SEARCH_LIMIT) {
    const cell = queue[head++];
    const key = cell[0] + "," + cell[1];
    if (goals.indexOf(key) >= 0) {
      return unwind(cameFrom, key);
    }
    for (let i = 0; i < STEPS.length; i++) {
      const nx = cell[0] + STEPS[i][0];
      const ny = cell[1] + STEPS[i][1];
      const nkey = nx + "," + ny;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || cameFrom[nkey] !== undefined) {
        continue;
      }
      if (!map.canEnter(nx, ny)) {
        continue;
      }
      cameFrom[nkey] = key;
      queue.push([nx, ny]);
      visited++;
    }
  }
  return null;
}

function unwind(cameFrom: any, key: string): number[][] {
  const out: number[][] = [];
  let at = key;
  while (cameFrom[at] !== "") {
    const parts = at.split(",");
    out.push([parseInt(parts[0], 10), parseInt(parts[1], 10)]);
    at = cameFrom[at];
  }
  out.reverse();
  return out;
}

/** The direction from one cell to an adjacent one, or "" when not adjacent. */
export function stepToward(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === -1) return "up";
  if (dx === 0 && dy === 1) return "down";
  if (dx === -1 && dy === 0) return "left";
  if (dx === 1 && dy === 0) return "right";
  return "";
}
