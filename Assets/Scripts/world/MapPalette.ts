// Which of the cartridge's Super Game Boy palettes a map wears.
//
// SetPal_Overworld (engine/gfx/palettes.asm): a town owns its palette, a
// route takes PAL_ROUTE, and an INTERIOR takes the palette of the last
// outdoor map -- the town you walked in from. The bake cannot know where a
// player walked in from, so an interior is given its town by name: Red's
// house is Pallet's, the Viridian Pokecenter is Viridian's. Before 29
// September every interior fell back to ROUTE, whose green tinted a bed
// olive.
//
// Used at bake time (the map record's `palette`) AND by the lens at run
// time, so a world baked on the site before this rule still wears it.

const PALETTE_BY_MAP: any = {
  PALLET_TOWN: "PALLET", VIRIDIAN_CITY: "VIRIDIAN", PEWTER_CITY: "PEWTER",
  CERULEAN_CITY: "CERULEAN", LAVENDER_TOWN: "LAVENDER", VERMILION_CITY: "VERMILION",
  CELADON_CITY: "CELADON", FUCHSIA_CITY: "FUCHSIA", CINNABAR_ISLAND: "CINNABAR",
  INDIGO_PLATEAU: "INDIGO", SAFFRON_CITY: "SAFFRON",
  LORELEIS_ROOM: "PALLET", BRUNOS_ROOM: "CAVE",
};
const PALETTE_BY_TILESET: any = { CEMETERY: "GRAYMON", CAVERN: "CAVE" };
/** An interior's town, by the start of its name. First match wins. */
const PALETTE_BY_PREFIX: string[][] = [
  ["REDS_HOUSE", "PALLET"], ["BLUES_HOUSE", "PALLET"], ["OAKS_LAB", "PALLET"],
  ["VIRIDIAN", "VIRIDIAN"], ["PEWTER", "PEWTER"], ["MUSEUM", "PEWTER"],
  ["CERULEAN", "CERULEAN"], ["BIKE_SHOP", "CERULEAN"], ["BILLS_HOUSE", "CERULEAN"],
  ["LAVENDER", "LAVENDER"], ["POKEMON_TOWER", "LAVENDER"], ["NAME_RATERS", "LAVENDER"],
  ["VERMILION", "VERMILION"], ["SS_ANNE", "VERMILION"],
  ["CELADON", "CELADON"], ["GAME_CORNER", "CELADON"],
  ["FUCHSIA", "FUCHSIA"], ["SAFARI_ZONE", "FUCHSIA"],
  ["CINNABAR", "CINNABAR"], ["POKEMON_MANSION", "CINNABAR"],
  ["SAFFRON", "SAFFRON"], ["SILPH_CO", "SAFFRON"], ["COPYCATS", "SAFFRON"], ["FIGHTING_DOJO", "SAFFRON"],
  ["INDIGO", "INDIGO"], ["AGATHAS", "INDIGO"], ["LANCES", "INDIGO"], ["CHAMPIONS", "INDIGO"], ["HALL_OF_FAME", "INDIGO"],
];

export function paletteFor(mapId: string, tileset: string): string {
  if (PALETTE_BY_MAP[mapId]) return PALETTE_BY_MAP[mapId];
  if (PALETTE_BY_TILESET[tileset]) return PALETTE_BY_TILESET[tileset];
  for (let i = 0; i < PALETTE_BY_PREFIX.length; i++) {
    if (mapId.indexOf(PALETTE_BY_PREFIX[i][0]) === 0) return PALETTE_BY_PREFIX[i][1];
  }
  return "ROUTE";
}
