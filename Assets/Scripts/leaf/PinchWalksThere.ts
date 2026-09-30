// A pinch on the ground walks Red there; a pinch on a person talks to her; a
// pinch beside the world turns the page.
//
// The rules live in test/route.test.mjs and test/dioramahands.test.mjs, which
// run without Lens Studio. This is the half they cannot reach: whether a tap
// at a WORLD POINT becomes the right cell through the diorama's real
// transform, with the view turned however the save left it, and whether the
// route, the turn and the talk then run inside the lens's own frame. The 19
// September preview run found three faults on exactly that path (the handle
// band, the door mats, the hands not running during a page), each invisible
// headless. The hand itself (SIK's TrackedHand) is driven by the preview
// agent, by hand; see PokemonHarness.pinchAt for why not LEAF's rig.
//
// Pallet Town, from Red's front door: pinch a cell of the path north and wait
// for him to stand on it; pinch the girl and wait for her page; pinch far
// beside the plate and wait for the page to close.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { ScenarioConfig } from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig";
import { sleep } from "Leaf.lspkg/Utils/common/Utils";
import { PokemonHarness } from "./PokemonHarness";
import { ZOOM_DEFAULT } from "../world/PlayArea";

const MAP: string = "PALLET_TOWN";
const START_X: number = 5;
const START_Y: number = 6;
/** Two cells up the path from the door: a walk, not a turn. */
const TARGET_X: number = 8;
const TARGET_Y: number = 4;
const GIRL: string = "PALLETTOWN_GIRL";
/** Well beyond the plate's handle band: a press, never a grab. */
const BESIDE_CM: number = 120;

function bodyOf(state: any, name: string): any {
  const cast = state.cast ? state.cast : [];
  for (let i = 0; i < cast.length; i++) {
    if (cast[i].name === name) {
      return cast[i];
    }
  }
  return null;
}

@component
export class PinchWalksThere extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const game = new PokemonHarness();
    await game.untilOverworld();
    await game.ensureDioramaMode();
    await game.useZoom(ZOOM_DEFAULT);

    game.assert("the bundle carries " + MAP, game.warpTo(MAP, START_X, START_Y),
                "testWarp refused " + MAP);
    await game.until(MAP + " to build its window",
                     (s: any) => s.mapId === MAP && s.windowTilesX > 0);
    await game.settleTerrain();
    await game.settleTerrain();

    // 1. The ground.
    const target = game.cellWorldPosition(TARGET_X, TARGET_Y);
    game.assert("the lens can say where a cell is", target !== null, "testCellWorldPosition null");
    await game.pinchAt(target);
    const walked = await game.until("Red to walk to the pinched cell",
                                    (s: any) => s.cellX === TARGET_X && s.cellY === TARGET_Y);
    game.assert("a pinch on the ground walks Red there",
                walked.cellX === TARGET_X && walked.cellY === TARGET_Y,
                "at " + walked.cellX + "," + walked.cellY + " route " + walked.routeActive);
    game.assert("and nothing is talking", walked.pageOpen !== true, "a page is open");

    // 2. The girl: the route ends beside her, turns, and presses A.
    const girl = bodyOf(game.state(), GIRL);
    game.assert("the girl is in the cast", girl !== null, "no " + GIRL);
    if (girl !== null) {
      await game.pinchAt(game.cellWorldPosition(girl.cellX, girl.cellY));
      const spoke = await game.until("the girl to speak",
                                     (s: any) => s.pageOpen === true);
      const beside = Math.abs(spoke.cellX - girl.cellX) + Math.abs(spoke.cellY - girl.cellY);
      game.assert("a pinch on a person walks up to her", beside === 1,
                  "Red at " + spoke.cellX + "," + spoke.cellY + ", she at " + girl.cellX + "," + girl.cellY);
      game.assert("...and talks to her", spoke.pageOpen === true, "no page");

      // 3. Beside the world: the page turns. Her line is two pages; each pinch
      // is one A, and the box closes on the last.
      const eye = game.cellWorldPosition(spoke.cellX, spoke.cellY);
      const beyond = new vec3(eye.x + BESIDE_CM, eye.y + 10, eye.z);
      let pinches = 0;
      let closed = false;
      while (pinches < 6 && !closed) {
        await game.pinchAt(beyond);
        pinches++;
        // A page takes a moment to type; give each pinch two seconds to close
        // the box before the next one turns the page after it.
        for (let waited = 0; waited < 2000 && !closed; waited += 100) {
          await sleep(100);
          closed = game.state().pageOpen !== true;
        }
      }
      game.assert("a pinch beside the world reads the pages (" + pinches + " pinches)", closed,
                  "the box never closed");
    }
  }
}
