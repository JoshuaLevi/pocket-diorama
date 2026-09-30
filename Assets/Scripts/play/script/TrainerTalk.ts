// An ordinary trainer, fought by talking to them.
//
// Three hundred and thirty-four map objects carry a trainer class and a party
// index, and until this file nothing fought them: PlayLoop.interact ran a talk
// script or nothing, and only the handful of bosses with a hand-written or
// transcribed script could be battled at all.
//
// The cartridge keys each of them by a TRAINER HEADER (home/trainers.asm
// TalkToTrainer): the label of the challenge line, of the line printed when
// they lose, of the line for every later talk, and the event bit that retires
// them. The manifest carries all 323 of Red's headers by map label and object
// index; the bundle carries them as `trainerHeaders`; this file turns one into a
// command list for the VM, in the cartridge's order:
//
//   face the player -> challenge line -> battle -> (Victory applied inside the
//   host on the win) -> check the result -> record the defeat -> end line ->
//   any Victory dialogue (the Karate Master's prize line)
//
// and, once beaten, face the player -> after line.
//
// The defeat is recorded AFTER check_battle_result and its jump, never before:
// a loss whites the player out with nothing recorded, and the trainer fights
// again -- which is what EndTrainerBattle does when wIsInBattle is $ff. A
// refused battle (nothing in the party can fight) looks the same from here.
//
// No header, no fight from this file. A trainer without one fights with no
// words and no event bit, which is behaviour Red does not have; the twenty-odd
// objects in that position -- leaders, the Elite Four, the rivals, the Cinnabar
// quiz trainers -- get hand entries in MapScripts.ts instead.

import type { MapDef, WorldBundle } from "../../world/WorldData";
import type { ScriptCommand } from "./ScriptVM";
import { victoryFor } from "../battle/Victories";
import { trainerExitScript } from "./MapScripts";

/** One trainer's header, normalised: "" and 0 where the manifest has nothing. */
export interface TrainerHeader {
  battle: string;
  won: string;
  after: string;
  event: string;
  range: number;
}

/**
 * The header for the object at `objectIndex` on `map`, or null.
 *
 * Keyed by the map's LABEL ("CeladonGym", not "CELADON_GYM") and the object's
 * 1-based index as a string, which is how the manifest is written. A bundle
 * baked before trainerHeaders was carried has no table, and every trainer is
 * then talk-only -- bundle.test says so rather than letting it pass.
 */
/**
 * Headers the manifest does not carry, written by hand from the cartridge's
 * scripts: Cinnabar Gym's seven quiz-door trainers, whose battle/end/after
 * lines exist in the text table and whose event bits are the ones Blaine's
 * victory retires. Without these they would fight wordless and never retire.
 */
const EXTRA_HEADERS: any = {
  CinnabarGym: cinnabarHeaders(),
};

function cinnabarHeaders(): any {
  const out: any = {};
  for (let n = 1; n <= 7; n++) {
    out["" + (n + 1)] = {
      battle: "_CinnabarGymSuperNerd" + n + "BattleText",
      won: "_CinnabarGymSuperNerd" + n + "EndBattleText",
      after: "_CinnabarGymSuperNerd" + n + "AfterBattleText",
      event: "EVENT_BEAT_CINNABAR_GYM_TRAINER_" + (n - 1),
      range: 0,
    };
  }
  return out;
}

export function trainerHeaderFor(bundle: WorldBundle, map: MapDef, objectIndex: number): TrainerHeader {
  const fromBundle = bundle.trainerHeaders ? bundle.trainerHeaders[map.label] : null;
  const table = fromBundle ? fromBundle : EXTRA_HEADERS[map.label];
  const row = table ? table["" + objectIndex] : null;
  if (!row) {
    return null;
  }
  return {
    battle: typeof row.battle === "string" ? row.battle : "",
    won: typeof row.won === "string" ? row.won : "",
    after: typeof row.after === "string" ? row.after : "",
    event: typeof row.event === "string" ? row.event : "",
    range: typeof row.range === "number" ? row.range : 0,
  };
}

/**
 * The talk script for a trainer object.
 *
 * `target` is what facingTarget() returned: name, trainerClass, trainerParty.
 * `defeated` decides between the challenge and the after line.
 */
export function trainerTalkScript(map: MapDef, target: any, header: TrainerHeader,
                                  defeated: boolean): ScriptCommand[] {
  if (defeated) {
    const later: ScriptCommand[] = [{ op: "face_player" }];
    if (header.after) {
      later.push({ op: "show_text", textId: header.after });
    }
    return later;
  }
  const party = target.trainerParty > 0 ? target.trainerParty : 1;
  const out: ScriptCommand[] = [{ op: "face_player" }];
  if (header.battle) {
    out.push({ op: "show_text", textId: header.battle });
  }
  out.push({ op: "start_battle", trainer: target.trainerClass, party: party });
  out.push({ op: "check_battle_result" });
  out.push({ op: "jump_if_false", to: "end" });
  out.push({ op: "beat_trainer", map: map.id, npc: target.name, flag: header.event });
  if (header.won) {
    out.push({ op: "show_text", textId: header.won });
  }
  // A boss reached this way (the Karate Master, Giovanni at Silph) has words in
  // the victory table that the host's awardVictory does not print: the prize
  // line, "I lost again". The hand-written leader entries print their own.
  const win = victoryFor(target.trainerClass, party);
  if (win !== null) {
    for (let i = 0; i < win.dialogue.length; i++) {
      out.push({ op: "show_text", textId: win.dialogue[i] });
    }
  }
  // And what he does next, for the few who do not simply stand there
  // (MapScripts.TRAINER_EXITS).
  const exit = trainerExitScript(map.id, target.name);
  for (let i = 0; i < exit.length; i++) {
    out.push(exit[i]);
  }
  return out;
}
