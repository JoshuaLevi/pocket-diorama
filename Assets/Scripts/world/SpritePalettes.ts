// Who wears what.
//
// Gen 1 has no sprite colours: the Super Game Boy tints a whole screen area,
// and every walker takes the map's palette, which is why Red came out
// mint-green in Pallet Town. The reference ships a GBC-style pack for the
// same reason and paints him red. This is that pack, hand-authored like the
// field tables and for the same reason -- it is not in the ROM, so it cannot
// be extracted or golden-checked.
//
// Four colours per sprite, shade 0 first: the paper (masked out where the
// sprite is transparent, white where it shows, as in an eye), skin, the
// clothes, and the outline.

const WHITE: number[] = [255, 255, 255];
const SKIN: number[] = [255, 214, 165];
const OUTLINE: number[] = [28, 20, 28];

const CLOTHES: any = {
  SPRITE_RED: [224, 48, 40],
  SPRITE_BLUE: [72, 112, 216],
  SPRITE_OAK: [176, 120, 72],
  SPRITE_MOM: [232, 120, 152],
  SPRITE_GIRL: [232, 120, 152],
  SPRITE_LASS: [232, 120, 152],
  SPRITE_FISHER: [64, 144, 208],
  SPRITE_FISHING_GURU: [64, 144, 208],
  SPRITE_NURSE: [240, 96, 128],
  SPRITE_CLERK: [80, 160, 216],
  SPRITE_SAILOR: [64, 96, 200],
  SPRITE_COOLTRAINER_F: [96, 176, 96],
  SPRITE_COOLTRAINER_M: [96, 176, 96],
  SPRITE_SUPER_NERD: [120, 200, 120],
  SPRITE_BLACK_HAIR_BOY_1: [104, 136, 200],
  SPRITE_BLACK_HAIR_BOY_2: [104, 136, 200],
  SPRITE_BUG_CATCHER: [128, 184, 72],
  SPRITE_HIKER: [168, 128, 80],
  SPRITE_ROCKET: [72, 72, 88],
  SPRITE_GYM_GUIDE: [120, 108, 168],
  SPRITE_BRUNETTE_GIRL: [216, 128, 168],
  SPRITE_LITTLE_GIRL: [232, 152, 176],
  SPRITE_LITTLE_BOY: [104, 136, 200],
  SPRITE_SCIENTIST: [200, 200, 216],
  SPRITE_BEAUTY: [216, 120, 176],
  SPRITE_BIKER: [72, 72, 88],
  SPRITE_MIDDLE_AGED_WOMAN: [200, 120, 104],
  SPRITE_OLD_MAN: [160, 136, 112],
  SPRITE_OLD_WOMAN: [168, 120, 152],
  SPRITE_GENTLEMAN: [88, 88, 120],
  SPRITE_SWIMMER: [72, 152, 224],
  SPRITE_GAMBLER: [120, 108, 168],
  SPRITE_YOUNGSTER: [104, 160, 216],
  SPRITE_CHANNELER: [136, 96, 168],
  SPRITE_BILL: [136, 168, 104],
  SPRITE_GIOVANNI: [64, 64, 80],
  SPRITE_BROCK: [168, 128, 80],
  SPRITE_MISTY: [240, 152, 88],
  SPRITE_LT_SURGE: [104, 136, 72],
  SPRITE_ERIKA: [216, 136, 176],
  SPRITE_KOGA: [120, 88, 160],
  SPRITE_SABRINA: [160, 96, 168],
  SPRITE_BLAINE: [200, 88, 72],
};
const DEFAULT_CLOTHES: number[] = [120, 108, 168];

/**
 * The props: sprites that are things rather than people.
 *
 * A Pokeball is red and white and stands about as high as your shin. The walker
 * palette above paints shade 1 as SKIN and shade 2 as clothes, so the three
 * balls on Oak's counter came out cream-and-lilac -- and the billboard stood
 * them a whole character tall, which is why they read as neither a ball nor a
 * person and were reported as missing. Both halves of that are wrong here.
 *
 * `units` is the billboard's height in mesh units, where a tile is 1 and a
 * character is 2.2. An item lying on a counter is half a cell. A boulder and a
 * sleeping Snorlax fill their cell the way a person does, so they keep the
 * character height and appear in this table only for their colours.
 *
 * Hand-authored like CLOTHES above, and for the same reason: Gen 1 has no
 * sprite colours, so there is nothing to extract and nothing to golden-check.
 * Shade 0 first, as everywhere else. The ball's shades are 1 for the white
 * half, 2 for the red one and 3 for the outline; 0 never appears in it.
 */
const PROPS: any = {
  SPRITE_POKE_BALL: { palette: [WHITE, [244, 244, 236], [224, 48, 40], OUTLINE], units: 1 },
  SPRITE_POKEDEX: { palette: [WHITE, [232, 232, 216], [200, 72, 64], OUTLINE], units: 1 },
  SPRITE_FOSSIL: { palette: [WHITE, [200, 184, 152], [152, 128, 96], OUTLINE], units: 1 },
  SPRITE_OLD_AMBER: { palette: [WHITE, [248, 216, 120], [216, 152, 48], OUTLINE], units: 1 },
  SPRITE_CLIPBOARD: { palette: [WHITE, [240, 240, 232], [168, 120, 72], OUTLINE], units: 1 },
  SPRITE_PAPER: { palette: [WHITE, [240, 240, 232], [176, 176, 176], OUTLINE], units: 1 },
  // Cell-fillers: their own colours, a person's height.
  SPRITE_BOULDER: { palette: [WHITE, [176, 168, 152], [120, 112, 96], OUTLINE], units: 0 },
  SPRITE_SNORLAX: { palette: [WHITE, [240, 224, 184], [88, 112, 144], OUTLINE], units: 0 },
  // The player, surfing: the cartridge draws the SEEL sheet in the player's
  // place (play/PlayerSprite.ts), so it wears sea colours, not skin and cloth.
  SPRITE_SEEL: { palette: [WHITE, [232, 236, 240], [96, 128, 168], OUTLINE], units: 0 },
};

/** The four colours a sprite is drawn with, shade 0 first. */
export function spritePaletteFor(spriteId: string): number[][] {
  const prop = PROPS[spriteId];
  if (prop) {
    return prop.palette;
  }
  const clothes = CLOTHES[spriteId] ? CLOTHES[spriteId] : DEFAULT_CLOTHES;
  return [WHITE, SKIN, clothes, OUTLINE];
}

/**
 * How tall this sprite's billboard stands, in mesh units.
 *
 * Everything that walks, talks or sleeps is a character height; only the props
 * marked with a height of their own are shorter, and `characterUnits` is what
 * the caller uses for everyone else.
 */
export function spriteHeightUnits(spriteId: string, characterUnits: number): number {
  const prop = PROPS[spriteId];
  return prop && prop.units > 0 ? prop.units : characterUnits;
}
