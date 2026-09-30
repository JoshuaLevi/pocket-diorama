// The scenarios this lens registers with LEAF.
//
// Kept in one place so the panel's list is a table of contents: what is claimed
// about this lens that only a running lens can show. Everything that can be
// proved with arithmetic over the bundle lives in test/ and runs in the gate,
// which is faster and does not need Lens Studio open.

import { scenariosIndex } from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator";
import { ScenarioMetadata } from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata";
import { BootReachesTheWorld } from "./BootReachesTheWorld";
import { PlayAreaIsASquare } from "./PlayAreaIsASquare";
import { WalkingDoesNotStall } from "./WalkingDoesNotStall";
import { CastStaysOnPromisedGround } from "./CastStaysOnPromisedGround";
import { OakStandsAtHisDesk } from "./OakStandsAtHisDesk";
import { TheEdgeHoldsStill } from "./TheEdgeHoldsStill";
import { StandsInAPlace } from "./StandsInAPlace";
import { ATrainerStopsYou } from "./ATrainerStopsYou";
import { PoseInGameBoyMode } from "./PoseInGameBoyMode";
import { PinchWalksThere } from "./PinchWalksThere";

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    { id: "boot-reaches-the-world", typename: BootReachesTheWorld.getTypeName() },
    { id: "play-area-is-a-square", typename: PlayAreaIsASquare.getTypeName() },
    { id: "walking-does-not-stall", typename: WalkingDoesNotStall.getTypeName() },
    { id: "cast-stays-on-promised-ground", typename: CastStaysOnPromisedGround.getTypeName() },
    { id: "oak-stands-at-his-desk", typename: OakStandsAtHisDesk.getTypeName() },
    { id: "the-edge-holds-still", typename: TheEdgeHoldsStill.getTypeName() },
    { id: "a-trainer-stops-you", typename: ATrainerStopsYou.getTypeName() },
    { id: "pinch-walks-there", typename: PinchWalksThere.getTypeName() },
    // Parameterised, and the only one here that is a pose rather than a claim:
    // the caller names a place, the lens stands in it, and the caller takes the
    // picture. Defaults are Pallet Town at the widest rung, which is the shot
    // the comparison sheet opens with.
    {
      id: "pose-in-game-boy-mode",
      typename: PoseInGameBoyMode.getTypeName(),
      parameters: { map_id: "PALLET_TOWN", cell_x: "5", cell_y: "6" },
    },
    {
      id: "stands-in-a-place",
      typename: StandsInAPlace.getTypeName(),
      parameters: {
        map_id: "PALLET_TOWN",
        cell_x: "5",
        cell_y: "6",
        zoom: "3",
      },
    },
  ];
}
