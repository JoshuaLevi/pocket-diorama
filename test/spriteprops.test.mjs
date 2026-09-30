// Props are not people: what a Pokeball is painted with, and how tall it stands.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/spriteprops.test.mjs Assets/Generated/kanto.json [--selftest]
//
// The three balls on Oak's counter were reported as missing. They were not:
// they were being drawn with the WALKER palette (shade 1 as skin, shade 2 as
// clothes) at a whole character's height, so a red-and-white ball came out as
// a cream-and-lilac blob the size of a child. This holds both halves of the
// fix, and it reads the real sprite data so a ball whose shades move is caught
// rather than assumed.

import { readFileSync } from "node:fs";

const bundlePath = process.argv[2];
const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { spritePaletteFor, spriteHeightUnits } =
  await import("../Assets/Scripts/world/SpritePalettes.ts");
const { unpackShades, unpackMask } =
  await import("../Assets/Scripts/world/WorldData.ts");

const CHARACTER_UNITS = 2.2;
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
}
const isRed = (c) => c[0] > 180 && c[1] < 110 && c[2] < 110;
const isWhitish = (c) => c[0] > 220 && c[1] > 220 && c[2] > 210;
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

console.log("=== the ball is a ball ===");
const ball = spritePaletteFor("SPRITE_POKE_BALL");
const walker = spritePaletteFor("SPRITE_YOUNGSTER");
check("it does not wear the walker palette", !same(ball[1], walker[1]) || !same(ball[2], walker[2]));
check("its light half is white", isWhitish(ball[1]), JSON.stringify(ball[1]));
check("its dark half is red", isRed(ball[2]), JSON.stringify(ball[2]));
check("it stands lower than a person",
      spriteHeightUnits("SPRITE_POKE_BALL", CHARACTER_UNITS) < CHARACTER_UNITS);
check("and not so low it is under the floor",
      spriteHeightUnits("SPRITE_POKE_BALL", CHARACTER_UNITS) > 0.4);

console.log("=== people are still people ===");
for (const who of ["SPRITE_RED", "SPRITE_OAK", "SPRITE_NURSE", "SPRITE_MOM", "SPRITE_YOUNGSTER"]) {
  check(who + " keeps a character's height",
        spriteHeightUnits(who, CHARACTER_UNITS) === CHARACTER_UNITS);
}
// A boulder and a sleeping Snorlax fill their cell the way a person does: they
// are in the prop table for their colours only, and a height of 0 means "as
// tall as anyone else". Getting that wrong shrinks Snorlax to a doorstop.
for (const filler of ["SPRITE_BOULDER", "SPRITE_SNORLAX"]) {
  check(filler + " fills its cell", spriteHeightUnits(filler, CHARACTER_UNITS) === CHARACTER_UNITS);
  check(filler + " has its own colours", !same(spritePaletteFor(filler)[2], walker[2]));
}

if (bundlePath) {
  console.log("=== against the ROM's own pixels ===");
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  // Which shades a sprite actually uses decides which entries of the palette
  // matter. The ball uses 1, 2 and 3 and never 0, so painting shade 0 is
  // painting nothing -- and a fix that "recoloured" only shade 0 would look
  // exactly like no fix at all.
  for (const id of ["SPRITE_POKE_BALL", "SPRITE_POKEDEX"]) {
    const sprite = bundle.sprites[id];
    if (!sprite) { check(id + " is in the bundle", false); continue; }
    const n = sprite.width * sprite.height;
    const shades = unpackShades(sprite.shades, n);
    const alpha = unpackMask(sprite.alpha, n);
    const used = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      if (alpha[i] === 1) used[shades[i]]++;
    }
    check(id + " uses shades 1 and 2", used[1] > 0 && used[2] > 0, used.join(","));
    const palette = spritePaletteFor(id);
    check(id + "'s used shades all have their own colour",
          !same(palette[1], palette[2]) && !same(palette[2], palette[3]));
  }
  const lab = bundle.maps.OAKS_LAB;
  const balls = lab.objects.filter((o) => o.sprite === "SPRITE_POKE_BALL");
  check("Oak's lab still ships three starter balls", balls.length === 3, "found " + balls.length);
}

console.log("=== a battle picture is one frame, not two-and-a-half ===");
{
  const { sheetRows } = await import("../Assets/Scripts/world/SpriteBillboard.ts");
  check("a walker is six frames", sheetRows({ sheetHeight: 96, frameHeight: 16 }) === 6);
  check("a still 16x16 object is one", sheetRows({ sheetHeight: 16, frameHeight: 16 }) === 1);
  // The bug this guards: a 40-pixel battle pic read with a walker's 16-pixel
  // frame says two frames, so the quad draws its top 16 rows and stops. Whoever
  // builds a single-frame sheet has to declare the frame as the whole image.
  check("a 40-pixel pic read as a walker is TWO frames -- the fault",
        sheetRows({ sheetHeight: 40, frameHeight: 16 }) === 2);
  check("and declared whole, it is one",
        sheetRows({ sheetHeight: 40, frameHeight: 40 }) === 1);
  check("a sheet shorter than its frame still draws something",
        sheetRows({ sheetHeight: 8, frameHeight: 16 }) === 1);
}

if (SELFTEST) {
  console.log("=== selftest ===");
  // The bug this file exists for: the walker palette on a ball.
  const asWalker = [[255, 255, 255], [255, 214, 165], [120, 108, 168], [28, 20, 28]];
  check("SELFTEST a ball painted in skin and clothes is caught",
        !isWhitish(asWalker[1]) || !isRed(asWalker[2]));
  // And an unknown sprite must fall through to the walker treatment rather
  // than to a prop's height, or every new NPC arrives knee-high.
  check("SELFTEST an unknown sprite is a person",
        spriteHeightUnits("SPRITE_NOT_IN_ANY_TABLE", CHARACTER_UNITS) === CHARACTER_UNITS);
  check("SELFTEST an unknown sprite wears the default clothes",
        same(spritePaletteFor("SPRITE_NOT_IN_ANY_TABLE")[1], asWalker[1]));
}

console.log("\nSPRITEPROPS  " + pass + " pass, " + fail + " fail\n");
process.exit(fail === 0 ? 0 : 1);
