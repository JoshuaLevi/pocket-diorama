// The two world positions a scrolling diorama has, and which one is the world.
//
// The map scrolls by moving the ROOT. applyDioramaScroll puts it at
//
//     root = anchor - R(yaw) * (playerLocal * scale)
//
// so that the player's own cell always lands on the anchor. `playerLocal` is
// that cell in MAP-CENTRED units, so it ranges over the whole map and the root
// is pushed wherever that sum needs it. Route 17 is 10 x 72 tiles and the plate
// holds 20 tiles across its 70 cm, so a player two thirds down the route puts
// the root three and a third METRES from anything the wearer can see.
//
// So the root is not a place. It is a bookkeeping origin, and the only point on
// the diorama whose world position means anything to a wearer is the ANCHOR:
// the middle of the play area, where the player is standing, which is the one
// point the scroll holds still.
//
// Reading the root and treating it as the world is what the third glasses
// playtest found -- "een gevecht gebeurt heel ergens anders dan op de exacte
// locatie van waar de game zich hoort af te spelen." A battle was framed on the
// root, so on a route it was staged metres away from the town.
//
// Pure: numbers in, numbers out, no scene and no lens types, so the scroll can
// be gated without a headset.

/**
 * The player's cell as an offset from the diorama root, in the diorama's own
 * axes and already multiplied by the scale.
 *
 * Y is zero on purpose. The offset lies in the map's plane and the CALLER
 * rotates it by the root's own world rotation, which is where the OPTION
 * page's tilt comes in -- a tilted diorama lifts a far cell as well as pushing
 * it sideways, and a yaw-only rotation here would silently drop that.
 *
 * The same map-centred formula BattleFraming.cellLocal states, times the
 * scale. Cells may be fractional: the player is drawn between two of them
 * while a step is in progress.
 */
export function playerOffsetLocal(
  cell: number[], widthTiles: number, heightTiles: number, scale: number
): number[] {
  return [
    (-widthTiles / 2 + cell[0] * 2 + 1) * scale,
    0,
    (-heightTiles / 2 + cell[1] * 2 + 1) * scale,
  ];
}
