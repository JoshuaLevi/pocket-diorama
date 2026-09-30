// The GAME CORNER's three prize counters.
//
// data/events/prizes.asm:9-67 and data/events/prize_mon_levels.asm:2-10, both
// of which the extraction does not carry -- so the nine rows and the six
// levels are written out here, from Red's own tables (Blue's differ, and are
// not these).
//
// engine/events/prize_menu.asm:1-43 is the counter itself: no COIN CASE and it
// says so and stops; otherwise "We exchange your coins for prizes.", a list of
// three prizes and their prices with NO THANKS under them, "So, you want X?",
// and then the coins, the bag or the party refusing. Coins are taken LAST, and
// a Pokemon that fits nowhere is not paid for (:HandlePrizeChoice).

/** One row of one counter. */
export interface Prize {
  /** A species id, or an item id when `isItem`. */
  id: string;
  /** Coins. */
  price: number;
  /** Level, for a Pokemon; 0 for a TM. */
  level: number;
  isItem: boolean;
}

/**
 * The three counters, in the order their signs stand: (2,2), (4,2), (6,2).
 * The prize-mon levels are the dictionary's, not the price's neighbour.
 */
const COUNTERS: Prize[][] = [
  [
    { id: "ABRA", price: 180, level: 9, isItem: false },
    { id: "CLEFAIRY", price: 500, level: 8, isItem: false },
    { id: "NIDORINA", price: 1200, level: 17, isItem: false },
  ],
  [
    { id: "DRATINI", price: 2800, level: 18, isItem: false },
    { id: "SCYTHER", price: 5500, level: 25, isItem: false },
    { id: "PORYGON", price: 9999, level: 26, isItem: false },
  ],
  [
    { id: "TM_DRAGON_RAGE", price: 3300, level: 0, isItem: true },
    { id: "TM_HYPER_BEAM", price: 5500, level: 0, isItem: true },
    { id: "TM_SUBSTITUTE", price: 7700, level: 0, isItem: true },
  ],
];

export const TEXT_NEED_COIN_CASE: string = "_RequireCoinCaseText";
export const TEXT_EXCHANGE: string = "_ExchangeCoinsForPrizesText";
export const TEXT_WHICH_PRIZE: string = "_WhichPrizeText";
export const TEXT_SO_YOU_WANT: string = "_SoYouWantPrizeText";
export const TEXT_OH_FINE_THEN: string = "_OhFineThenText";
export const TEXT_NEED_MORE_COINS: string = "_SorryNeedMoreCoinsText";
export const TEXT_NO_ROOM: string = "_OopsYouDontHaveEnoughRoomText";

/** NO THANKS, the fourth row the cartridge draws under the three prizes. */
export const NO_THANKS: string = "NO THANKS";

/** The counter a vendor's text id stands for: 1, 2 or 3. */
export function prizesForCounter(counter: number): Prize[] {
  const rows = COUNTERS[counter - 1];
  return rows ? rows : null;
}

export function prizeCounters(): number {
  return COUNTERS.length;
}
