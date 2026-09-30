// Where a battle is staged: a patch of clear ground with two Pokemon on it.
//
// The reference mod does this on the map rather than on a blank screen, and it
// is worth saying why, because it is not obvious. A fight needs a patch open
// enough to stand two Pokemon on and look across, in this shape:
//
//     x x x
//     x O x        O   whoever you are facing
//     x x x
//     x x x
//     x P x        P   your own Pokemon
//     x x x
//
// Every `x` is ground the player could walk onto, with a one-cell apron all
// round so nothing crowds the pair. Where a corridor, a cave or a shop floor
// has no room for that, it relaxes to the same three-cell gap with the apron
// given up, and where even that will not fit it declines and the fight is drawn
// the old way. A mod that cannot find a stage does not invent one.
//
// TWO THINGS ARE DIFFERENT HERE, and both come from the wearer being the
// camera rather than owning one.
//
//   * The reference picks an authored spot per map, often nowhere near the
//     player, and points a virtual camera at it. We cannot move the wearer, so
//     the arena is laid out ALONG THE WAY THEY ARE ALREADY LOOKING: your own
//     Pokemon a cell ahead of you, theirs three cells beyond that. They walked
//     into the encounter facing it; the fight happens in front of them.
//   * Tall grass is excluded from the footprint, which is the reference's own
//     surprising rule and it holds here for the same reason: grass is real
//     geometry, knee-high on a Pokemon, and from anywhere near ground level the
//     tufts stand between the eye and the sprite.
//
// Pure: it reads a map and returns cells. Nothing here moves the player, the
// party or a script -- the fight is staged where they already stand, which is
// what keeps a trainer's dialogue talking to someone still in front of them.

import type { MapRuntime } from "./MapRuntime";

/** How many cells apart the two stand. The reference's own gap. */
export const BATTLE_GAP_CELLS: number = 3;
/** How far ahead of the player their own Pokemon stands. */
export const PLAYER_MON_AHEAD: number = 1;
/** The apron the wide shape wants either side of the axis. */
export const APRON_CELLS: number = 1;

export interface Arena {
  /** "wide" with its apron, "narrow" without it, "forced" when nothing fit. */
  shape: string;
  /** Cell of the player's own Pokemon, and of the one it is facing. */
  playerCell: number[];
  enemyCell: number[];
  /** The direction the pair is laid out along: the player's own facing. */
  facing: string;
}

/** The step a facing takes, in cells. */
export function facingStep(facing: string): number[] {
  if (facing === "up") return [0, -1];
  if (facing === "down") return [0, 1];
  if (facing === "left") return [-1, 0];
  return [1, 0];
}

/**
 * Whether a cell can hold part of an arena.
 *
 * Walkable is the player's own test, so an arena can never be laid over a wall,
 * a counter, a tree or a ledge face. Warps are excluded on top of that: they
 * are walkable by definition -- a doormat is -- and a fight framed in a doorway
 * puts half of it inside the building. And tall grass is excluded, for the
 * reason in the header.
 */
export function openCell(map: MapRuntime, cx: number, cy: number): boolean {
  if (!map.inBounds(cx, cy)) {
    return false;
  }
  if (map.isWarpTile(cx, cy) || map.warpAt(cx, cy)) {
    return false;
  }
  if (map.isGrass(cx, cy)) {
    return false;
  }
  return map.isWalkable(cx, cy);
}

/** The cells the two Pokemon would stand on, laid out from the player. */
export function cellsAhead(cellX: number, cellY: number, facing: string): number[][] {
  const step = facingStep(facing);
  const player = [cellX + step[0] * PLAYER_MON_AHEAD, cellY + step[1] * PLAYER_MON_AHEAD];
  const enemy = [player[0] + step[0] * BATTLE_GAP_CELLS,
                 player[1] + step[1] * BATTLE_GAP_CELLS];
  return [player, enemy];
}

/**
 * Every cell the shape covers: the axis from the player's own Pokemon to the
 * one it faces, plus the apron either side of it when `apron` is on.
 */
export function footprint(cellX: number, cellY: number, facing: string,
                          apron: boolean): number[][] {
  const step = facingStep(facing);
  const across = [step[1], -step[0]];
  const out: number[][] = [];
  for (let i = 0; i <= PLAYER_MON_AHEAD + BATTLE_GAP_CELLS; i++) {
    const ax = cellX + step[0] * i;
    const ay = cellY + step[1] * i;
    const span = apron ? APRON_CELLS : 0;
    for (let s = -span; s <= span; s++) {
      out.push([ax + across[0] * s, ay + across[1] * s]);
    }
  }
  return out;
}

/**
 * Whether the shape fits with its near end at (cellX, cellY), facing `facing`.
 *
 * The cell the player is standing on is exempt: it is open by definition, and
 * on the doormat they just walked through, asking would refuse a fight that has
 * to happen anyway.
 */
export function shapeFits(map: MapRuntime, cellX: number, cellY: number, facing: string,
                          apron: boolean, standingX: number, standingY: number): boolean {
  const cells = footprint(cellX, cellY, facing, apron);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i][0] === standingX && cells[i][1] === standingY) {
      continue;
    }
    if (!openCell(map, cells[i][0], cells[i][1])) {
      return false;
    }
  }
  return true;
}

const FACINGS: string[] = ["up", "down", "left", "right"];

/**
 * The arena for a fight, and where it is.
 *
 * Straight ahead of the player first: they walked into this facing that way,
 * and a fight that happens where you are standing needs no explaining. Failing
 * that -- and on a route it usually does fail, because tall grass is exactly
 * where wild battles come from and exactly what an arena may not be laid on --
 * the NEAREST patch that will hold the shape, searched the way the reference
 * searches: both shapes over the whole map, the wide one first, because that is
 * the shot this is framed for. The world travels to the arena when it grows, so
 * a fight staged twenty cells away is still a fight the wearer is standing in.
 *
 * And when nothing anywhere fits, "forced": the pair stands ahead of the player
 * on whatever ground is there. A battle you cannot see is what this replaced,
 * so declining is not on offer.
 */
export function findArena(map: MapRuntime, cellX: number, cellY: number,
                          facing: string): Arena {
  const widthCells = Math.floor(map.widthTiles / 2);
  const heightCells = Math.floor(map.heightTiles / 2);
  for (let s = 0; s < 2; s++) {
    const apron = s === 0;
    // Where they stand, facing the way they are: no travel at all.
    if (shapeFits(map, cellX, cellY, facing, apron, cellX, cellY)) {
      const pair = cellsAhead(cellX, cellY, facing);
      return { shape: apron ? "wide" : "narrow", playerCell: pair[0], enemyCell: pair[1],
               facing: facing };
    }
    // Otherwise the nearest patch anywhere, measured to the middle of the pair
    // so "nearest" means the fight is staged as close to where it was triggered
    // as the ground allows.
    let best: Arena = null;
    let bestDistance = 0;
    for (let cy = 0; cy < heightCells; cy++) {
      for (let cx = 0; cx < widthCells; cx++) {
        for (let f = 0; f < FACINGS.length; f++) {
          if (!shapeFits(map, cx, cy, FACINGS[f], apron, cellX, cellY)) {
            continue;
          }
          const pair = cellsAhead(cx, cy, FACINGS[f]);
          const midX = (pair[0][0] + pair[1][0]) / 2;
          const midY = (pair[0][1] + pair[1][1]) / 2;
          const dx = midX - cellX;
          const dy = midY - cellY;
          const distance = dx * dx + dy * dy;
          if (best === null || distance < bestDistance) {
            best = { shape: apron ? "wide" : "narrow", playerCell: pair[0],
                     enemyCell: pair[1], facing: FACINGS[f] };
            bestDistance = distance;
          }
        }
      }
    }
    if (best !== null) {
      return best;
    }
  }
  const pair = cellsAhead(cellX, cellY, facing);
  return { shape: "forced", playerCell: pair[0], enemyCell: pair[1], facing: facing };
}
