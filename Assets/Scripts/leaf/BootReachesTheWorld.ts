// The lens gets from nothing to a playable world, and says so on the way.
//
// This is the scenario the third playtest asked for: "nu is het gewoon zwart
// zonder iets als de rom niet goed geladen is." The wizard is what fixed it, and
// its own state machine is unit-tested (89 checks); what only a running lens can
// show is that the wizard is actually WIRED -- that it exists at boot, that a
// world reaches it, and that it hands over instead of sitting there.
//
// It cannot show the black screen itself. In the 5.23 preview the baked world
// loads out of a JsonAsset within a frame or two, so there is no window in which
// to observe "no world" without reaching into the lens and breaking it. That
// half stays with the unit tests, and this says so rather than pretending.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { expect } from "Leaf.lspkg/Utils/common/Expect";
import { PokemonHarness } from "./PokemonHarness";

@component
export class BootReachesTheWorld extends Scenario {
  async run(): Promise<void> {
    const game = new PokemonHarness();

    // The seam answers at all. If this throws, nothing below means anything.
    const first = game.state();
    expect(typeof first.phase).toBe("string");

    const loaded = await game.until("a world to arrive",
                                    (s: any) => s.worldLoaded === true);
    expect(loaded.worldLoaded).toBe(true);

    // The wizard must not be sitting in a failure state with a world in hand.
    // Its failure states all carry an instruction, and none of them is reachable
    // once a bundle has been accepted.
    expect(loaded.wizard.indexOf("fail")).toBe(-1);

    // And the game is somewhere a player can be, rather than stuck on boot.
    // The wizard is a page the wearer dismisses, so dismiss it.
    await game.dismissWizard();
    const playing = await game.until("the title screen or the overworld",
                                     (s: any) => s.phase === "overworld" ||
                                                 s.bootPhase !== "");
    expect(playing.phase === "overworld" || playing.bootPhase !== "").toBe(true);
  }
}
