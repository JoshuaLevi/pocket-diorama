// The save ladder: ten places to drop into the game, for testing on the glasses.
//
// Everything after the first badge was built in two nights against the
// cartridge and the headless harness, and none of it has been on the glasses.
// Playing there from Pallet Town to the Hall of Fame is fifteen hours; this is
// how the same ground is covered in two. Each rung is a PlayState at the door
// of a place worth looking at -- a gym, a cave, the Game Corner, the Safari
// Zone, Silph Co, the mansion, the Elite Four -- with the badges, the party and
// the key items that stretch of the game assumes, so the world behaves as it
// would for a player who got there honestly.
//
// Behind an input (PokemonAR.debugLadder) that is OFF in the published build.
// Nothing here is cartridge content: species and item IDENTIFIERS, event bit
// names, and coordinates the bundle itself carries.

import type { PlayState } from "../PlayState";
import { newPlayState, giveItem, markSeen, markOwned } from "../PlayState";
import { makeWildMon } from "../battle/Stats";
import type { BattleMon } from "../battle/types";

export interface Rung {
  /** The row on the list. Label, two spaces and note fit seventeen glyphs. */
  label: string;
  /** What is there to test. */
  note: string;
  /** The building whose outside door the player stands at. */
  building: string;
  /**
   * "down" for a door that is walked onto from above -- the S.S. ANNE's pier
   * sits on the city's south edge -- and absent for every ordinary door,
   * which is entered walking up.
   */
  approach?: string;
  /** Badges held, in gym order: the first `badges` are set. */
  badges: number;
  /** Species and level of each party member; the first is the starter line. */
  party: string[][];
  /** Field moves put on party members, [slot index in the party, move id]. */
  moves: string[][];
  flags: string[];
  /** [item id, count] */
  items: string[][];
  money: number;
  coins: number;
  /** Towns FLY may name from here. */
  towns: string[];
}

const COMMON_FLAGS: string[] = [
  "EVENT_INTRO_DONE", "EVENT_GOT_STARTER", "EVENT_CHOSE_CHARMANDER",
  "EVENT_GOT_POKEDEX", "EVENT_OAK_GOT_PARCEL", "EVENT_GOT_TOWN_MAP",
];
const BROCK: string[] = COMMON_FLAGS.concat(["EVENT_BEAT_BROCK"]);
const MISTY: string[] = BROCK.concat(["EVENT_BEAT_MISTY"]);
const SURGE: string[] = MISTY.concat(["EVENT_BEAT_LT_SURGE", "EVENT_GOT_HM01", "EVENT_GOT_BIKE"]);
const ERIKA: string[] = SURGE.concat(["EVENT_BEAT_ERIKA", "EVENT_GOT_HM05"]);
const HIDEOUT: string[] = ERIKA.concat([
  "EVENT_BEAT_ROCKET_HIDEOUT_GIOVANNI", "EVENT_GOT_SILPH_SCOPE",
  "EVENT_RESCUED_MR_FUJI", "EVENT_GOT_POKE_FLUTE",
]);
const KOGA: string[] = HIDEOUT.concat(["EVENT_BEAT_KOGA", "EVENT_GOT_HM03", "EVENT_GOT_HM04"]);
const SABRINA: string[] = KOGA.concat(["EVENT_BEAT_SILPH_CO_GIOVANNI", "EVENT_BEAT_SABRINA"]);
const BLAINE: string[] = SABRINA.concat(["EVENT_GOT_SECRET_KEY", "EVENT_BEAT_BLAINE"]);
const ALL_EIGHT: string[] = BLAINE.concat(["EVENT_BEAT_VIRIDIAN_GYM_GIOVANNI", "EVENT_GOT_HM02"]);

const WEST: string[] = ["PALLET_TOWN", "VIRIDIAN_CITY", "PEWTER_CITY"];
const NORTH: string[] = WEST.concat(["CERULEAN_CITY"]);
const SOUTH: string[] = NORTH.concat(["VERMILION_CITY"]);
const EAST: string[] = SOUTH.concat(["LAVENDER_TOWN", "CELADON_CITY"]);
const FAR: string[] = EAST.concat(["FUCHSIA_CITY", "SAFFRON_CITY"]);
const ISLAND: string[] = FAR.concat(["CINNABAR_ISLAND"]);
const EVERYWHERE: string[] = ISLAND.concat(["INDIGO_PLATEAU"]);

const BALLS: string[][] = [["POKE_BALL", "10"], ["POTION", "5"], ["ANTIDOTE", "2"]];
const MID: string[][] = [["GREAT_BALL", "10"], ["SUPER_POTION", "8"], ["ESCAPE_ROPE", "2"],
                         ["REPEL", "3"], ["PARLYZ_HEAL", "3"], ["AWAKENING", "3"]];
const LATE: string[][] = [["ULTRA_BALL", "10"], ["HYPER_POTION", "8"], ["FULL_HEAL", "5"],
                          ["REVIVE", "3"], ["ESCAPE_ROPE", "3"], ["MAX_REPEL", "3"]];
const END: string[][] = [["ULTRA_BALL", "10"], ["FULL_RESTORE", "10"], ["MAX_REVIVE", "5"],
                         ["ELIXER", "5"], ["MAX_POTION", "5"]];

/** The rungs, in the order the cartridge visits them. */
export const RUNGS: Rung[] = [
  { label: "PEWTER", note: "BADGE 1", building: "PEWTER_GYM", badges: 0,
    party: [["CHARMANDER", "13"], ["PIDGEY", "10"], ["NIDORAN_M", "9"]], moves: [],
    flags: COMMON_FLAGS, items: BALLS, money: 1500, coins: 0, towns: WEST },
  { label: "MT MOON", note: "THE CAVE", building: "MT_MOON_1F", badges: 1,
    party: [["CHARMANDER", "15"], ["PIDGEY", "13"], ["NIDORAN_M", "12"], ["MANKEY", "10"]], moves: [],
    flags: BROCK, items: BALLS.concat(MID), money: 3000, coins: 0, towns: WEST },
  { label: "CERULEAN", note: "MISTY", building: "CERULEAN_GYM", badges: 1,
    party: [["CHARMELEON", "20"], ["PIDGEOTTO", "19"], ["NIDORINO", "18"], ["MANKEY", "16"], ["CLEFAIRY", "14"]],
    moves: [], flags: MISTY, items: BALLS.concat(MID), money: 4000, coins: 0, towns: NORTH },
  { label: "VERMILION", note: "S.ANNE", building: "VERMILION_DOCK", approach: "down", badges: 2,
    party: [["CHARMELEON", "24"], ["PIDGEOTTO", "22"], ["NIDORINO", "20"], ["MANKEY", "18"], ["CLEFAIRY", "16"], ["ABRA", "12"]],
    moves: [], flags: MISTY, items: MID.concat([["S_S_TICKET", "1"]]), money: 6000, coins: 0, towns: SOUTH },
  { label: "RCK TUNNEL", note: "FLASH", building: "ROCK_TUNNEL_1F", badges: 3,
    party: [["CHARMELEON", "27"], ["PIDGEOTTO", "25"], ["NIDORINO", "23"], ["PRIMEAPE", "28"], ["CLEFAIRY", "20"], ["KADABRA", "22"]],
    moves: [["4", "FLASH"], ["3", "CUT"]], flags: SURGE,
    items: MID.concat([["HM_FLASH", "1"], ["HM_CUT", "1"], ["BICYCLE", "1"]]), money: 7000, coins: 0, towns: SOUTH },
  { label: "CELADON", note: "COINS", building: "GAME_CORNER", badges: 4,
    party: [["CHARMELEON", "31"], ["PIDGEOTTO", "29"], ["NIDOKING", "30"], ["PRIMEAPE", "30"], ["CLEFAIRY", "24"], ["KADABRA", "28"]],
    moves: [["4", "FLASH"], ["3", "CUT"]], flags: ERIKA,
    items: LATE.concat([["COIN_CASE", "1"], ["HM_FLASH", "1"], ["HM_CUT", "1"], ["BICYCLE", "1"]]),
    money: 9000, coins: 500, towns: EAST },
  { label: "FUCHSIA", note: "SAFARI", building: "SAFARI_ZONE_GATE", badges: 4,
    party: [["CHARIZARD", "36"], ["PIDGEOT", "36"], ["NIDOKING", "34"], ["PRIMEAPE", "33"], ["CLEFAIRY", "28"], ["KADABRA", "32"]],
    moves: [["4", "FLASH"], ["3", "CUT"]], flags: HIDEOUT,
    items: LATE.concat([["POKE_FLUTE", "1"], ["SILPH_SCOPE", "1"], ["COIN_CASE", "1"], ["BICYCLE", "1"]]),
    money: 12000, coins: 120, towns: EAST },
  { label: "SAFFRON", note: "SILPH CO", building: "SILPH_CO_1F", badges: 5,
    party: [["CHARIZARD", "40"], ["PIDGEOT", "38"], ["NIDOKING", "38"], ["PRIMEAPE", "36"], ["LAPRAS", "35"], ["ALAKAZAM", "38"]],
    moves: [["4", "SURF"], ["3", "STRENGTH"], ["1", "FLY"]], flags: KOGA,
    items: LATE.concat([["CARD_KEY", "1"], ["HM_SURF", "1"], ["HM_STRENGTH", "1"], ["POKE_FLUTE", "1"], ["BICYCLE", "1"]]),
    money: 15000, coins: 120, towns: FAR },
  { label: "CINNABAR", note: "MANSION", building: "POKEMON_MANSION_1F", badges: 6,
    party: [["CHARIZARD", "44"], ["PIDGEOT", "42"], ["NIDOKING", "42"], ["PRIMEAPE", "40"], ["LAPRAS", "40"], ["ALAKAZAM", "42"]],
    moves: [["4", "SURF"], ["3", "STRENGTH"], ["1", "FLY"]], flags: SABRINA,
    items: LATE.concat([["HM_SURF", "1"], ["HM_STRENGTH", "1"], ["POKE_FLUTE", "1"], ["BICYCLE", "1"]]),
    money: 18000, coins: 120, towns: ISLAND },
  { label: "INDIGO", note: "ELITE 4", building: "INDIGO_PLATEAU_LOBBY", badges: 8,
    party: [["CHARIZARD", "60"], ["PIDGEOT", "55"], ["NIDOKING", "56"], ["SNORLAX", "52"], ["LAPRAS", "54"], ["ALAKAZAM", "57"]],
    moves: [["4", "SURF"], ["3", "STRENGTH"], ["1", "FLY"]], flags: ALL_EIGHT,
    items: END.concat([["HM_SURF", "1"], ["HM_STRENGTH", "1"], ["BICYCLE", "1"]]),
    money: 30000, coins: 120, towns: EVERYWHERE },
];

/** What the list shows: one label and one note per rung. */
export function ladderRows(): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < RUNGS.length; i++) {
    out.push([RUNGS[i].label, RUNGS[i].note]);
  }
  return out;
}

/** Outdoors, as the cartridge's map names have it. */
function isOutdoors(mapId: string): boolean {
  return mapId.indexOf("ROUTE_") === 0 ||
    mapId.indexOf("_CITY") > 0 || mapId.indexOf("_TOWN") > 0 ||
    mapId.indexOf("_ISLAND") > 0 || mapId.indexOf("_PLATEAU") > 0;
}

/**
 * Where to stand: one cell below the outside door of `building`, facing it.
 *
 * Read out of the bundle's own warps rather than typed in, so a rung cannot
 * name a cell that is not a door. Falls back to just inside the building's
 * first warp when no outdoor map leads to it.
 */
export function entranceOf(bundle: any, building: string, approach: string = ""): any {
  const fromAbove = approach === "down";
  const ids = Object.keys(bundle.maps);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === building || !isOutdoors(id)) {
      continue;
    }
    const warps = bundle.maps[id].warps;
    for (let w = 0; warps && w < warps.length; w++) {
      if (warps[w].destMap === building) {
        return {
          mapId: id,
          x: warps[w].x,
          y: fromAbove ? warps[w].y - 1 : warps[w].y + 1,
          facing: fromAbove ? "down" : "up",
          lastMapId: id,
        };
      }
    }
  }
  const inside = bundle.maps[building];
  const first = inside && inside.warps && inside.warps.length > 0 ? inside.warps[0] : null;
  return {
    mapId: building,
    x: first ? first.x : 4,
    y: first ? first.y - 1 : 4,
    facing: "down",
    lastMapId: "",
  };
}

function withMove(bundle: any, mon: BattleMon, slot: number, moveId: string): void {
  const move = bundle.moves[moveId];
  if (!move) {
    return;
  }
  // Over the last slot, so the natural moveset is kept as far as it goes.
  const at = mon.moves.length >= 4 ? 3 : mon.moves.length;
  mon.moves[at] = { id: moveId, pp: move.pp, maxPp: move.pp };
}

/**
 * The PlayState of a rung: a fresh game brought forward to that door.
 *
 * `random` is injectable so a test can pin the party's IVs and the trainer
 * id; the lens passes Math.random.
 */
export function ladderState(bundle: any, index: number, random: () => number = null): PlayState {
  const rung = RUNGS[index < 0 ? 0 : index >= RUNGS.length ? RUNGS.length - 1 : index];
  const roll = random ? random : () => Math.random();
  const state = newPlayState(bundle.romSha1, roll);
  const at = entranceOf(bundle, rung.building, rung.approach ? rung.approach : "");
  state.mapId = at.mapId;
  state.cellX = at.x;
  state.cellY = at.y;
  state.facing = at.facing;
  state.lastMapId = at.lastMapId;

  for (let i = 0; i < rung.party.length; i++) {
    const mon = makeWildMon(bundle, rung.party[i][0], parseInt(rung.party[i][1], 10), roll);
    mon.otId = state.playerId;
    mon.otName = state.playerName;
    state.party.push(mon);
    const species = bundle.species[rung.party[i][0]];
    if (species && typeof species.dex === "number") {
      markSeen(state, species.dex);
      markOwned(state, species.dex);
    }
  }
  for (let i = 0; i < rung.moves.length; i++) {
    const slot = parseInt(rung.moves[i][0], 10);
    if (slot >= 0 && slot < state.party.length) {
      withMove(bundle, state.party[slot], slot, rung.moves[i][1]);
    }
  }
  for (let i = 0; i < rung.badges && i < state.badges.length; i++) {
    state.badges[i] = true;
  }
  for (let i = 0; i < rung.flags.length; i++) {
    state.flags[rung.flags[i]] = true;
  }
  for (let i = 0; i < rung.items.length; i++) {
    giveItem(state, rung.items[i][0], parseInt(rung.items[i][1], 10));
  }
  state.money = rung.money;
  state.coins = rung.coins;
  for (let i = 0; i < rung.towns.length; i++) {
    state.visitedTowns[rung.towns[i]] = true;
  }
  // A whiteout from any rung goes to the nearest town's Center rather than
  // back to the bedroom, which is what a player who got here would have.
  // The plateau has no Center of its own on the town map, so the list is
  // walked back to the last town that does.
  for (let t = rung.towns.length - 1; t >= 0; t--) {
    const center = centerOf(bundle, rung.towns[t]);
    if (center) {
      state.respawnMapId = center.mapId;
      state.respawnCellX = center.x;
      state.respawnCellY = center.y;
      state.respawnLastMapId = rung.towns[t];
      break;
    }
  }
  return state;
}

/** The cell just inside a town's POKeMON CENTER door, or null. */
function centerOf(bundle: any, town: string): any {
  const map = bundle.maps[town];
  if (!map || !map.warps) {
    return null;
  }
  for (let w = 0; w < map.warps.length; w++) {
    const dest = map.warps[w].destMap;
    if (typeof dest === "string" && dest.indexOf("POKECENTER") > 0) {
      const inside = bundle.maps[dest];
      const door = inside && inside.warps && inside.warps.length > 0 ? inside.warps[0] : null;
      if (door) {
        return { mapId: dest, x: door.x, y: door.y - 1 };
      }
    }
  }
  return null;
}
