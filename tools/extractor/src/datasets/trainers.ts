/**
 * Discovery shim for trainers.json.
 *
 * src/cli.ts probes `src/datasets/<dataset>.ts` for every name in
 * DATASET_NAMES, so the builder has to be reachable under this exact filename.
 * The implementation lives in battle.ts alongside the two other battle-side
 * datasets it shares helpers with.
 */

export { trainersBuilder as builder } from "./battle";
