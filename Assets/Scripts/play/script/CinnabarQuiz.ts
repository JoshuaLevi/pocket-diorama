// CINNABAR GYM's six quiz machines (engine/events/hidden_objects/cinnabar_gym_quiz.asm).
//
// The doors were already there -- block overrides that open on a gate flag OR
// on the room's trainer being beaten -- and the trainers already fought when
// spoken to. What was missing was the machine itself: nothing asked the
// question, so nothing ever set a gate flag and the only way through the gym
// was to beat every trainer in it.
//
// The machines are hidden objects of bank $11, read out of the cartridge on 20
// September 2026 (the run of six at 11:$6DD0, handler 07:$6A17): cell, and one
// byte whose low nibble is the question and whose high nibble is the RIGHT
// ROW of the YES/NO box -- 0 is YES, 1 is NO.
//
//   right:  "You're absolutely correct!", EVENT_CINNABAR_GYM_GATE<n-1>_UNLOCKED,
//           and the door opens with its sound.
//   wrong:  SFX_DENIED, "Sorry! Bad call!", and the room's trainer -- object
//           n+2, whose event is EVENT_BEAT_CINNABAR_GYM_TRAINER_<n> -- fights
//           you, unless he has been beaten already. Beating him opens the
//           same door.
//
// Pure: PlayLoop hands in the map's objects and gets a script back.

import type { ScriptCommand } from "./ScriptVM";

export const QUIZ_MAP: string = "CINNABAR_GYM";

/** One machine: its cell, its question (1..6) and whether YES is right. */
export interface QuizMachine {
  x: number;
  y: number;
  question: number;
  yes: boolean;
}

export const QUIZ_MACHINES: QuizMachine[] = [
  { x: 15, y: 7, question: 1, yes: true },
  { x: 10, y: 1, question: 2, yes: false },
  { x: 9, y: 7, question: 3, yes: false },
  { x: 9, y: 13, question: 4, yes: false },
  { x: 1, y: 13, question: 5, yes: true },
  { x: 1, y: 7, question: 6, yes: false },
];

export const TEXT_QUIZ_INTRO: string = "_CinnabarGymQuizIntroText";
export const TEXT_QUIZ_CORRECT: string = "_CinnabarGymQuizCorrectText";
export const TEXT_QUIZ_INCORRECT: string = "_CinnabarGymQuizIncorrectText";

export function quizQuestionText(question: number): string {
  return "_CinnabarQuizQuestionsText" + question;
}

export function quizGateFlag(question: number): string {
  return "EVENT_CINNABAR_GYM_GATE" + (question - 1) + "_UNLOCKED";
}

export function quizTrainerFlag(question: number): string {
  return "EVENT_BEAT_CINNABAR_GYM_TRAINER_" + question;
}

/** The machine on a cell of the gym, or null. */
export function quizMachineAt(mapId: string, x: number, y: number): QuizMachine {
  if (mapId !== QUIZ_MAP) {
    return null;
  }
  for (let i = 0; i < QUIZ_MACHINES.length; i++) {
    if (QUIZ_MACHINES[i].x === x && QUIZ_MACHINES[i].y === y) {
      return QUIZ_MACHINES[i];
    }
  }
  return null;
}

/**
 * The script for a machine faced from below (PrintCinnabarQuiz returns at
 * once unless the player faces UP), or null.
 *
 * `objects` is the map's own object list: the trainer a wrong answer wakes
 * is object n+2 of it, and his class, party and lines are the bundle's.
 */
export function quizScript(mapId: string, x: number, y: number, facing: string,
                           objects: any[]): ScriptCommand[] {
  const machine = quizMachineAt(mapId, x, y);
  if (machine === null || facing !== "up") {
    return null;
  }
  const n = machine.question;
  let trainer: any = null;
  for (let i = 0; objects && i < objects.length; i++) {
    if (objects[i].index === n + 2) {
      trainer = objects[i];
    }
  }
  const out: ScriptCommand[] = [
    { op: "show_text", textId: TEXT_QUIZ_INTRO },
    { op: "ask", textId: quizQuestionText(n) },
    { op: machine.yes ? "jump_if_false" : "jump_if_true", to: "wrong" },
    { op: "text_sound", name: "Get_Item1" },
    { op: "show_text", textId: TEXT_QUIZ_CORRECT },
    { op: "set_flag", flag: quizGateFlag(n) },
    { op: "text_sound", name: "Go_Inside" },
    { op: "jump", to: "end" },
    { op: "label", name: "wrong" },
    { op: "text_sound", name: "Denied" },
    { op: "show_text", textId: TEXT_QUIZ_INCORRECT },
  ] as ScriptCommand[];
  if (trainer !== null && trainer.trainerClass) {
    const nerd = n + 1;
    out.push({ op: "check_flag", flag: quizTrainerFlag(n) } as ScriptCommand);
    out.push({ op: "jump_if_true", to: "end" } as ScriptCommand);
    out.push({ op: "show_text", textId: "_CinnabarGymSuperNerd" + nerd + "BattleText" } as ScriptCommand);
    out.push({ op: "start_battle", trainer: trainer.trainerClass,
               party: trainer.trainerParty > 0 ? trainer.trainerParty : 1 } as ScriptCommand);
    out.push({ op: "check_battle_result" } as ScriptCommand);
    out.push({ op: "jump_if_false", to: "end" } as ScriptCommand);
    out.push({ op: "beat_trainer", map: QUIZ_MAP, npc: trainer.name, flag: quizTrainerFlag(n) } as ScriptCommand);
    out.push({ op: "show_text", textId: "_CinnabarGymSuperNerd" + nerd + "EndBattleText" } as ScriptCommand);
  }
  return out;
}
