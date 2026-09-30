// The classic battle layout on the Game Boy screen.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battlescreen.test.mjs Assets/Generated/kanto.json
//
// GAME BOY mode grew the 3D diorama the moment a fight began. BattleScreen
// puts the fight where the cartridge does: the foe top right, you bottom left
// from behind, the two blocks over their corners, and rows 12 to 17 left for
// the message box.

import { readFileSync } from "node:fs";
const bundlePath = process.argv[2];
if (!bundlePath) { console.error("usage: battlescreen.test.mjs <bundle.json>"); process.exit(2); }
globalThis.print = () => {};
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

const { GbCanvas, GbFont, TILE } = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { paintBattleScreen, battlePicture, ENEMY_PIC_TX, ENEMY_PIC_TY, PLAYER_PIC_TX,
        PLAYER_PIC_FLOOR_TY, PIC_BOX_TILES }
  = await import("../Assets/Scripts/play/screen/BattleScreen.ts");
const { BattleHudTiles, ENEMY_TX, ENEMY_NAME_TY, PLAYER_NAME_TX, PLAYER_NAME_TY }
  = await import("../Assets/Scripts/play/screen/BattleHudScreen.ts");
const { GHOST_PICTURE } = await import("../Assets/Scripts/play/battle/Ghost.ts");

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++; console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}
function ink(c, x, y, w, h) {
  let n = 0;
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) if (c.shadeAt(px, py) === 3) n++;
  return n;
}
const font = new GbFont(bundle);
const tiles = new BattleHudTiles(bundle);
const box = PIC_BOX_TILES * TILE;

console.log("=== the layout ===");
{
  const c = new GbCanvas();
  paintBattleScreen(c, font, bundle, tiles,
                    { name: "CHARMANDER", level: 5, hp: 20, maxHp: 20 },
                    { name: "PIDGEY", level: 3, hp: 12, maxHp: 12 },
                    "CHARMANDER", "PIDGEY");
  check("the foe stands top right", ink(c, ENEMY_PIC_TX * TILE, ENEMY_PIC_TY * TILE, box, box) > 40);
  check("you stand bottom left, from behind",
        ink(c, PLAYER_PIC_TX * TILE, (PLAYER_PIC_FLOOR_TY - PIC_BOX_TILES) * TILE, box, box) > 40);
  check("the foe's name is in its block", ink(c, ENEMY_TX * TILE, ENEMY_NAME_TY * TILE, 48, 8) > 0);
  check("your name is in yours", ink(c, PLAYER_NAME_TX * TILE, PLAYER_NAME_TY * TILE, 80, 8) > 0);
  check("rows 12 to 17 are left for the message box", ink(c, 0, 12 * TILE, 160, 6 * TILE) === 0,
        "" + ink(c, 0, 12 * TILE, 160, 6 * TILE));
  check("the top left corner is not the foe's",
        ink(c, 0, 4 * TILE, 8 * TILE, 3 * TILE) === 0, "" + ink(c, 0, 4 * TILE, 8 * TILE, 3 * TILE));
}

console.log("=== the pictures ===");
{
  const front = battlePicture(bundle, "PIDGEY", false);
  const back = battlePicture(bundle, "CHARMANDER", true);
  check("a species has a front and a back", front !== null && back !== null);
  check("the back picture is the smaller one", back.height <= front.height * 1.2 && back.width <= 32);
  check("an unknown name draws nothing, quietly", battlePicture(bundle, "MISSINGNO_X", false) === null);
  if (bundle.pictures && bundle.pictures.ghost) {
    const ghost = battlePicture(bundle, GHOST_PICTURE, false);
    check("the ghost has a picture, from the front", ghost !== null);
    check("and none from behind", battlePicture(bundle, GHOST_PICTURE, true) === null);
  }
  const c = new GbCanvas();
  paintBattleScreen(c, font, bundle, tiles,
                    { name: "A", level: 1, hp: 1, maxHp: 1 }, { name: "B", level: 1, hp: 1, maxHp: 1 },
                    "", "");
  check("no pictures paints the blocks and nothing else in the boxes",
        ink(c, ENEMY_PIC_TX * TILE, 4 * TILE, box, 3 * TILE) === 0);
}

console.log("\nBATTLESCREEN  " + pass + " pass, " + fail + " fail" + (fail === 0 ? "" : "  BROKEN"));
if (fail > 0) process.exit(1);
