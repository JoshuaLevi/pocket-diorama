// A trainer who sees you coming.
//
// Two hundred and ninety-five of Kanto's three hundred and twenty-three
// trainers attack on sight, and until this file not one of them did: every
// trainer in the game waited politely to be spoken to. It is not three
// hundred scripts. It is ONE routine -- engine/overworld/trainer_sight.asm's
// TrainerEngage, run against every sprite on the map after every step -- and
// the twelve bytes it reads are already in the bundle as `trainerHeaders`.
//
// TrainerEngage, in order, with what each test becomes here:
//
//   1. the sprite is on screen                 -- cannot fail at range <= 5
//      (IMAGEINDEX != $ff)                        in a straight line, so it
//                                                 is not transcribed
//   2. lined up: same screen row OR column     -- x === px || y === py
//   3. distance is not zero                    -- the player is not inside him
//   4. CheckSpriteCanSeePlayer:
//        distance <= wTrainerEngageDistance    -- header.range, the twelfth
//                                                 byte of the header
//        and the facing axis matches the       -- facing up/down needs the
//        alignment                                column, left/right the row
//   5. CheckPlayerIsInFrontOfSprite            -- he must be on the side he
//                                                 is looking at, EXCEPT on
//                                                 POWER_PLANT, where the
//                                                 routine returns early so
//                                                 the Voltorb "items" engage
//                                                 from any side
//
// That last exception is carried here and reaches nothing today: our
// extraction models the Power Plant's Voltorbs as STATIC BATTLES rather than
// as trainers, so they have no trainerClass and no reach, and the branch is
// never taken. It stays because it is part of the routine and because the day
// a re-bake emits them as trainers is the day it matters; the suite asserts
// the shape of that data so the day is noticed rather than discovered.
//
// Three things the routine does NOT do, each of which would have been a
// reasonable guess and each of which is wrong:
//
//   * it never tests for a WALL between them. A trainer sees you through the
//     gym's furniture and through Mt Moon's rock, because nothing here looks
//     at the map at all.
//   * it never turns the PLAYER toward the trainer. You keep walking the way
//     you were walking and he arrives at your shoulder.
//   * it does not stop at your cell. TrainerWalkUpToPlayer writes
//     `distance - 1` steps, so he halts on the cell BESIDE you.
//
// The scan order is the sprite order, so the lowest object index wins when two
// trainers see you on the same step. No cell in Kanto is seen by two of them
// at once -- every sight trainer's line was swept against the maps and the
// crossings came to nought -- so the tiebreak never actually has to be taken.
// It is still the cartridge's order, and the suite pins it, because the day a
// script walks a trainer somewhere new is the day it does have to be taken.

import type { MapDef, MapObject, WorldBundle } from "../../world/WorldData";
import { isObjectHidden, shippedFacing } from "../../world/WorldData";
import type { PlayState } from "../PlayState";
import { isTrainerDefeated } from "../PlayState";
import type { ScriptCommand } from "./ScriptVM";
import type { TrainerHeader } from "./TrainerTalk";
import { trainerHeaderFor, trainerTalkScript } from "./TrainerTalk";
import { EMOTE_SHOCK } from "../../world/EmoteBubble";

/** A trainer whose line of sight the player has just stepped into. */
export interface Sighting {
  /** The object, so the caller can hand it back to trainerTalkScript. */
  object: MapObject;
  header: TrainerHeader;
  facing: string;
  /** Cells between them; at least 1, at most header.range. */
  distance: number;
}

/**
 * OPP classes whose meeting music is not the plain one (PlayTrainerMusic and
 * data/trainers/encounter_types.asm). A leader and the three rival classes
 * keep the music already playing; everyone else is male by default.
 */
const EVIL_TRAINERS: string[] = ["OPP_UNUSED_JUGGLER", "OPP_GAMBLER", "OPP_ROCKER",
                                 "OPP_JUGGLER", "OPP_CHIEF", "OPP_SCIENTIST",
                                 "OPP_GIOVANNI", "OPP_ROCKET"];
const FEMALE_TRAINERS: string[] = ["OPP_LASS", "OPP_JR_TRAINER_F", "OPP_BEAUTY",
                                   "OPP_COOLTRAINER_F"];
const RIVAL_TRAINERS: string[] = ["OPP_RIVAL1", "OPP_RIVAL2", "OPP_RIVAL3"];

function listHas(list: string[], value: string): boolean {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) {
      return true;
    }
  }
  return false;
}

/** The track that plays when this class spots you, or "" to leave the music. */
export function meetingMusicFor(trainerClass: string): string {
  if (listHas(RIVAL_TRAINERS, trainerClass)) {
    return "";
  }
  if (listHas(EVIL_TRAINERS, trainerClass)) {
    return "Music_MeetEvilTrainer";
  }
  if (listHas(FEMALE_TRAINERS, trainerClass)) {
    return "Music_MeetFemaleTrainer";
  }
  return "Music_MeetMaleTrainer";
}

/**
 * How far along his own line of sight the player is, or 0 for "not in it".
 *
 * Steps 2 to 5 of TrainerEngage in one expression per direction. The facing
 * decides the axis, the sign decides the side, and the caller compares the
 * distance with the header's range.
 */
function sightDistance(facing: string, x: number, y: number,
                       px: number, py: number, anySide: boolean): number {
  if (facing === "down" || facing === "up") {
    if (x !== px) {
      return 0;
    }
    const ahead = facing === "down" ? py - y : y - py;
    return ahead > 0 ? ahead : (anySide && ahead < 0 ? -ahead : 0);
  }
  if (facing === "left" || facing === "right") {
    if (y !== py) {
      return 0;
    }
    const ahead = facing === "right" ? px - x : x - px;
    return ahead > 0 ? ahead : (anySide && ahead < 0 ? -ahead : 0);
  }
  return 0;
}

/**
 * The first trainer on this map who can see the player, or null.
 *
 * `poseOf` answers the live pose of an NPC by name, or null when it has not
 * moved -- only two of Kanto's trainers walk, but a trainer who HAS walked
 * must be judged from where he is standing now and not from where he shipped,
 * which is the whole reason this takes a function rather than reading the map.
 */
export function sightingAt(bundle: WorldBundle, map: MapDef, px: number, py: number,
                           state: PlayState, revealed: any, poseOf: any): Sighting {
  // POWER_PLANT's Voltorbs are drawn as Poke Balls and fight from any side:
  // CheckPlayerIsInFrontOfSprite returns early on this one map so that walking
  // up to a "item" from behind still sets it off.
  const anySide = map.id === "POWER_PLANT";
  for (let i = 0; i < map.objects.length; i++) {
    const object = map.objects[i];
    if (!object.trainerClass) {
      continue;
    }
    if (isObjectHidden(map.id, object, revealed)) {
      continue;
    }
    const header = trainerHeaderFor(bundle, map, object.index);
    if (header === null || header.range <= 0) {
      continue;
    }
    if (isTrainerDefeated(state, map.id, object.name, header.event)) {
      continue;
    }
    const pose = poseOf ? poseOf(object.name) : null;
    const x = pose ? pose.x : object.x;
    const y = pose ? pose.y : object.y;
    const facing = pose ? pose.facing : shippedFacing(object);
    const distance = sightDistance(facing, x, y, px, py, anySide);
    if (distance > 0 && distance <= header.range) {
      return { object: object, header: header, facing: facing, distance: distance };
    }
  }
  return null;
}

/**
 * What happens when he sees you: the music, the walk, then his own talk.
 *
 * The battle itself is the SAME script talking to him would have run --
 * challenge line, battle, defeat recorded, end line -- because on the
 * cartridge it is literally the same routine (EngageMapTrainer sets the
 * script state and TalkToTrainer runs). Only the approach is new.
 */
export function sightingScript(map: MapDef, sighting: Sighting): ScriptCommand[] {
  const out: ScriptCommand[] = [];
  const music = meetingMusicFor(sighting.object.trainerClass);
  if (music) {
    out.push({ op: "play_music", track: music });
  }
  // The mark, before the walk and not with it: CheckFightingMapTrainers raises
  // EXCLAMATION_BUBBLE, locks the d-pad, and only then calls
  // TrainerWalkUpToPlayer. Sixty frames of it, which is the only warning the
  // player gets that the next thing is a fight.
  out.push({ op: "emote", npc: sighting.object.name, kind: EMOTE_SHOCK });
  // TrainerWalkUpToPlayer writes `distance - 1` steps in the direction he is
  // already looking, which is by construction the direction of the player. At
  // distance 1 that is no steps at all and the routine returns early; a
  // walk_npc of zero steps does the same thing here.
  out.push({ op: "walk_npc", npc: sighting.object.name,
             direction: sighting.facing, steps: sighting.distance - 1 });
  const target: any = {
    name: sighting.object.name,
    trainerClass: sighting.object.trainerClass,
    trainerParty: sighting.object.trainerParty,
  };
  const talk = trainerTalkScript(map, target, sighting.header, false);
  for (let i = 0; i < talk.length; i++) {
    out.push(talk[i]);
  }
  return out;
}
