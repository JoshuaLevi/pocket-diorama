// The player on the BICYCLE and on the water: which sheet is drawn.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/ride.test.mjs Assets/Generated/kanto.json
//
// LoadPlayerSpriteGraphics picks RedSprite, RedBikeSprite or SeelSprite by
// wWalkBikeSurfState. The bundle now carries all three; this proves they share
// one frame layout, that the rule picks the right one, and that the flat
// screen's view builder follows the same rule.

import { readFileSync } from "node:fs";

const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!bundlePath) {
  console.error("usage: ride.test.mjs <bundle.json>");
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
globalThis.print = () => {};

const P = "../Assets/Scripts/play/";
const { playerSpriteId, playerPaletteId, SPRITE_PLAYER, SPRITE_PLAYER_BIKE, SPRITE_PLAYER_SURF } = await import(P + "PlayerSprite.ts");
const { Overworld } = await import(P + "Overworld.ts");
const { NpcMotion } = await import(P + "NpcMotion.ts");
const { buildGameBoyView } = await import(P + "screen/GameBoyView.ts");
const { spritePaletteFor } = await import("../Assets/Scripts/world/SpritePalettes.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "\n          " + detail : "")); }
}

console.log("== The three sheets ==");
{
  const red = bundle.sprites[SPRITE_PLAYER];
  const bike = bundle.sprites[SPRITE_PLAYER_BIKE];
  const seel = bundle.sprites[SPRITE_PLAYER_SURF];
  check("RED, the bike and the SEEL are all in the bundle", !!red && !!bike && !!seel);
  check("and share one layout: six frames of 16x16", [red, bike, seel].every((s) =>
        s && s.frames === 6 && s.width === 16 && s.height === 96));
  check("the bike's picture is not RED's", bike.shades !== red.shades);
  check("the bike wears RED's colours", playerPaletteId(SPRITE_PLAYER_BIKE) === SPRITE_PLAYER);
  check("the SEEL wears its own", playerPaletteId(SPRITE_PLAYER_SURF) === SPRITE_PLAYER_SURF &&
        spritePaletteFor(SPRITE_PLAYER_SURF)[2][2] > spritePaletteFor(SPRITE_PLAYER)[2][2]);
}

console.log("\n== The rule ==");
{
  check("on foot", playerSpriteId(false, false, bundle) === SPRITE_PLAYER);
  check("on the bike", playerSpriteId(true, false, bundle) === SPRITE_PLAYER_BIKE);
  check("on the water", playerSpriteId(false, true, bundle) === SPRITE_PLAYER_SURF);
  check("on the water beats on the bike", playerSpriteId(true, true, bundle) === SPRITE_PLAYER_SURF);
  const old = { sprites: { SPRITE_RED: bundle.sprites.SPRITE_RED } };
  check("a bundle baked before today keeps RED rather than vanish",
        playerSpriteId(true, false, old) === SPRITE_PLAYER && playerSpriteId(false, true, old) === SPRITE_PLAYER);
  check("and no bundle at all is RED", playerSpriteId(true, true, null) === SPRITE_PLAYER);
}

console.log("\n== The flat screen ==");
{
  const world = new Overworld(bundle, "ROUTE_16", 10, 12, null);
  const motion = new NpcMotion();
  const walk = buildGameBoyView(bundle, world, motion, {}, 0, 0);
  check("on foot it draws RED", walk.player.spriteId === SPRITE_PLAYER, walk.player.spriteId);
  world.riding = true;
  const ride = buildGameBoyView(bundle, world, motion, {}, 0, 0);
  check("riding, the bike", ride.player.spriteId === SPRITE_PLAYER_BIKE, ride.player.spriteId);
  world.riding = false;
  world.surfing = true;
  const surf = buildGameBoyView(bundle, world, motion, {}, 0, 0);
  check("surfing, the SEEL", surf.player.spriteId === SPRITE_PLAYER_SURF, surf.player.spriteId);
}

console.log("\nRIDE " + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
