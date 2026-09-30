// The category colour table: four colours per tile category, lightest first.
//
// The world's colours do not come from the cartridge's art (Gen 1 is four
// greys) but from the CATEGORY each tile was given at bake time; the map's
// own Super Game Boy palette then tints them (VoxelPalette.MAP_TINT). The
// table lives here, in the lens, rather than only in the bundle it is also
// written into: a colour fixed tonight has to reach a world baked last
// week on the site, so VoxelPalette reads this copy first and the bundle's
// only for a category this one does not know.
//
// tools/build_bundle.py is dead; the live path is BundleFromExtraction,
// which re-exports this, and tools/bake.mjs.

export const TILE_PALETTES: any = {
  GRASS: [[160, 216, 24], [120, 180, 0], [76, 122, 6], [42, 74, 4]],
  TALL_GRASS: [[134, 196, 14], [94, 154, 0], [58, 102, 4], [32, 60, 2]],
  PATH: [[214, 196, 158], [186, 166, 126], [132, 116, 86], [74, 64, 48]],
  SAND: [[240, 224, 180], [220, 200, 150], [168, 148, 106], [96, 82, 64]],
  WATER: [[140, 216, 240], [70, 168, 220], [42, 110, 160], [22, 64, 94]],
  TREE: [[92, 188, 22], [47, 128, 0], [28, 82, 0], [13, 44, 0]],
  STRUCTURE: [[244, 240, 224], [210, 200, 172], [140, 132, 112], [70, 64, 52]],
  LEDGE: [[200, 168, 112], [150, 120, 74], [94, 74, 44], [50, 38, 22]],
  DIRT: [[180, 130, 80], [140, 100, 56], [90, 64, 34], [50, 36, 15]],
  // Indoors and underground. See tools/build_bundle.py, which must agree with
  // this table byte for byte or bundle.test.mjs fails.
  FLOOR: [[214, 178, 132], [176, 136, 88], [118, 88, 52], [64, 46, 26]],
  WALL: [[186, 196, 216], [138, 150, 180], [88, 98, 126], [46, 52, 70]],
  DOOR: [[248, 208, 112], [224, 168, 48], [160, 116, 24], [86, 60, 12]],
  ROCK: [[176, 168, 152], [136, 128, 112], [88, 82, 70], [46, 42, 36]],
  // Indoor furniture: the wood and gold of the reference's rooms (a bed, a
  // bookcase, a counter, a table). WALL, which everything indoors wore
  // before 29 September, is the room's own shell.
  FURNITURE: [[236, 204, 112], [204, 156, 52], [140, 100, 28], [72, 48, 12]],
  // The rest of a room, named tile by tile in world/IndoorKinds.ts: a PC or
  // a television in cool greys, a bed in linen, a plant in leaf green, and a
  // stone floor for the lab and the gyms.
  // Each ramp steps down evenly in luminance, so Legibility's band for it
  // (the ramp's own ends) moves nothing far enough to clip a hue.
  MACHINE: [[232, 236, 240], [196, 204, 216], [144, 152, 168], [52, 58, 70]],
  LINEN: [[250, 246, 240], [240, 234, 232], [244, 165, 155], [96, 40, 40]],
  PLANT: [[164, 224, 96], [92, 176, 48], [48, 120, 28], [20, 64, 14]],
  TILE: [[228, 228, 220], [188, 188, 178], [128, 128, 118], [64, 64, 58]],
  // A bookcase or a cupboard is drawn mostly in the darkest grey -- panels
  // and shadow between the books -- so in FURNITURE's ramp it came out
  // near-black. Its own ramp keeps the dark shade a warm mid-brown, and the
  // shelf reads as the reference's gold cabinet with dark lines.
  CABINET: [[240, 212, 128], [214, 168, 68], [170, 122, 50], [112, 78, 32]],
};
