// The HP bar, against the cartridge's own tiles.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/battlehud.test.mjs [--selftest]
//
// The expectations here are not invented: tools/oracle/battlehud.py fought a
// real wild RATTATA on Route 1 and read wTileMap after every turn. Those exact
// rows are the fixtures below, so if the bar maths drifts, it drifts away from
// something the cartridge actually drew.

const H = await import("../Assets/Scripts/play/screen/BattleHudScreen.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}
const hex = (cells) => cells.map((c) => c.toString(16).toUpperCase()).join(" ");

console.log("\n== the bar the cartridge drew ==");
{
  // Measured: a full bar is six full cells.
  check("full HP is six full cells",
        hex(H.hpBarCells(20, 20)) === "6B 6B 6B 6B 6B 6B", hex(H.hpBarCells(20, 20)));
  // Measured after the enemy fainted: six empty cells.
  check("a fainted Pokemon draws flat",
        hex(H.hpBarCells(0, 20)) === "63 63 63 63 63 63", hex(H.hpBarCells(0, 20)));

  // The cartridge never shows an empty bar for something still standing.
  const sliver = H.hpBarCells(1, 500);
  check("one hit point still shows a sliver", sliver[0] === H.BAR_EMPTY + 1, hex(sliver));
  check("and nothing beyond it", sliver[1] === H.BAR_EMPTY, hex(sliver));

  // Half a bar is three full cells and three empty ones.
  check("half HP fills half the bar",
        hex(H.hpBarCells(10, 20)) === "6B 6B 6B 63 63 63", hex(H.hpBarCells(10, 20)));

  // Every cell is one of the nine codes $63..$6B and never anything else.
  let bad = "";
  for (let maxHp = 1; maxHp <= 60 && !bad; maxHp++) {
    for (let hp = 0; hp <= maxHp; hp++) {
      const cells = H.hpBarCells(hp, maxHp);
      if (cells.length !== H.BAR_CELLS) { bad = hp + "/" + maxHp + " gave " + cells.length + " cells"; break; }
      for (const c of cells) {
        if (c < H.BAR_EMPTY || c > H.BAR_FULL) { bad = hp + "/" + maxHp + ": " + hex(cells); break; }
      }
      // A bar never has a full cell to the right of a partial one.
      for (let i = 1; i < cells.length; i++) {
        if (cells[i] > cells[i - 1]) { bad = "refills to the right at " + hp + "/" + maxHp + ": " + hex(cells); break; }
      }
    }
  }
  check("every bar is six legal cells, falling left to right", bad === "", bad);

  // A zero maximum is a Pokemon that does not exist; it must not divide by it.
  check("no maximum draws flat rather than throwing",
        hex(H.hpBarCells(5, 0)) === "63 63 63 63 63 63");
}

console.log("\n== the bar's colour ==");
{
  // pokered's GetHealthBarColor, exactly: above 24 pixels of 48 green, above 9
  // yellow, at or below that red. Not "a half" and "a fifth" -- 9 of 48 is not
  // a fifth, and rounding it would move the moment the bar turns red.
  const G = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
  check("a full bar is green", H.barShade(H.barPixels(20, 20)) === G.SHADE_HP_GREEN);
  check("just over half is still green", H.barShade(25) === G.SHADE_HP_GREEN);
  check("exactly half is already yellow", H.barShade(24) === G.SHADE_HP_YELLOW);
  check("ten pixels is yellow", H.barShade(10) === G.SHADE_HP_YELLOW);
  check("nine is red", H.barShade(9) === G.SHADE_HP_RED);
  check("and empty is red", H.barShade(0) === G.SHADE_HP_RED);

  // The pixel count is the cartridge's too, including its floor of one.
  check("a full bar is 48 pixels", H.barPixels(20, 20) === H.BAR_PIXELS);
  check("an empty one is none", H.barPixels(0, 20) === 0);
  check("one hit point of many still shows a pixel", H.barPixels(1, 500) === 1);
  check("and a missing maximum shows none", H.barPixels(5, 0) === 0);

  // The three shades must be distinct and none of them a Game Boy shade, or
  // they read as ink after the mask to 0..3.
  const shades = [G.SHADE_HP_GREEN, G.SHADE_HP_YELLOW, G.SHADE_HP_RED];
  check("every HP shade is outside the Game Boy's four", shades.every((v) => v > 3));
  check("and they are distinct", new Set(shades).size === 3);
  check("with a colour each", G.HP_COLOURS.length === 3);
}

console.log("\n== the numbers beside your own bar ==");
{
  check("HP is right-aligned in three columns", H.rightAligned(20, 3) === " 20");
  check("a single digit too", H.rightAligned(7, 3) === "  7");
  check("three digits fill it", H.rightAligned(123, 3) === "123");
  check("and nothing overflows the column", H.rightAligned(4321, 3).length === 3);
}

console.log("\n== where the blocks sit ==");
{
  // Straight from the probe's own table. These are the numbers a painter would
  // otherwise have to be trusted about.
  check("the enemy's name is on the top row at tx=1",
        H.ENEMY_TX === 1 && H.ENEMY_NAME_TY === 0);
  check("its bar is two rows under that", H.ENEMY_BAR_TY === 2);
  check("your own name is at tx=10 ty=7",
        H.PLAYER_NAME_TX === 10 && H.PLAYER_NAME_TY === 7);
  check("your bar is at ty=9", H.PLAYER_BAR_TY === 9);
  check("and your numbers on the row below it", H.PLAYER_NUMBERS_TY === 10);
  // The two blocks must not overlap: the enemy's ends at ty=3, yours starts at 7.
  check("the two blocks do not overlap", H.ENEMY_FRAME_TY < H.PLAYER_NAME_TY);
  // Nothing may land on the message box, which starts at ty=12.
  check("nothing is drawn over the message box", H.PLAYER_FRAME_TY < 12);
}

console.log("\n== what the panel does NOT draw ==");
{
  // The reference's own warning about its battle HUD: an opaque panel would be
  // "the white field back under another name". So the canvas is cleared to a
  // shade that is not one of the Game Boy's four, and the panel uploads that
  // as fully transparent. This proves the HUD leaves it alone.
  const bundlePath = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
  const G = await import("../Assets/Scripts/play/screen/GbCanvas.ts");

  // The trap this whole mechanism has to survive.
  check("the sentinel is not one of the four shades", G.SHADE_NONE > 3);
  check("and masking it would read as white -- so nothing may mask first",
        (G.SHADE_NONE & 3) === 0);

  if (bundlePath) {
    const { readFileSync } = await import("node:fs");
    const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
    if (G.GbFont.available(bundle)) {
      const canvas = new G.GbCanvas();
      const font = new G.GbFont(bundle);
      canvas.clear(G.SHADE_NONE);
      const tiles = new H.BattleHudTiles(bundle);
      // The bug this catches: the HP bar drawn from the FONT sheet, which put
      // "CLLLLLL:" where a bar belongs and a row of kana where the frame does.
      // The tiles live in their own sheets and a bundle has to carry them.
      check("the bundle carries the battle HUD's own tiles", tiles.available(),
            "rebake: the bar will fall back to the text box's border glyphs");
      H.paintPlayerHud(canvas, font, { name: "CHARMANDER", level: 6, hp: 20, maxHp: 20 }, tiles);
      H.paintEnemyHud(canvas, font, { name: "RATTATA", level: 3, hp: 15, maxHp: 15 }, tiles);

      const shadeAt = (tx, ty) =>
        canvas.pixels[(ty * G.TILE + 4) * G.SCREEN_WIDTH + (tx * G.TILE + 4)];
      const drawn = (tx, ty) => shadeAt(tx, ty) !== G.SHADE_NONE;

      // The font only ever writes INK -- it leaves paper alone -- so a tile is
      // "drawn" when any pixel in it is ink, not when its centre is.
      // "Ink" is shade 3 OR one of the HP shades: the bar's own ink is
      // recoloured in place, so looking only for 3 would report a green bar as
      // an absent one.
      const inked = (tx, ty) => {
        for (let py = 0; py < G.TILE; py++) {
          for (let px = 0; px < G.TILE; px++) {
            const v = canvas.pixels[(ty * G.TILE + py) * G.SCREEN_WIDTH + tx * G.TILE + px];
            if (v === 3 || v >= G.SHADE_HP_GREEN) {
              return true;
            }
          }
        }
        return false;
      };
      check("the enemy's bar is drawn", inked(H.ENEMY_TX + 3, H.ENEMY_BAR_TY));
      check("your own bar is drawn", inked(H.PLAYER_BAR_TX + 3, H.PLAYER_BAR_TY));
      check("and so are the names",
            inked(H.ENEMY_TX, H.ENEMY_NAME_TY) && inked(H.PLAYER_NAME_TX, H.PLAYER_NAME_TY));

      // The plate behind each block: translucent, so the glyphs are legible
      // over a dark table without putting the white field back.
      check("the enemy's block sits on a plate",
            shadeAt(H.ENEMY_TX + 8, H.ENEMY_NAME_TY) === G.SHADE_GLASS,
            "shade " + shadeAt(H.ENEMY_TX + 8, H.ENEMY_NAME_TY));
      check("your own block does too",
            shadeAt(H.PLAYER_BAR_TX, H.PLAYER_NUMBERS_TY) === G.SHADE_GLASS,
            "shade " + shadeAt(H.PLAYER_BAR_TX, H.PLAYER_NUMBERS_TY));
      check("the plate is translucent, not the white field again",
            G.GLASS_ALPHA > 0 && G.GLASS_ALPHA < 255, "alpha " + G.GLASS_ALPHA);

      // The bar's ink is recoloured in place: a full bar must be green on the
      // canvas, not merely green in a function nobody calls.
      const barY = H.PLAYER_BAR_TY * G.TILE;
      let greens = 0;
      for (let px = (H.PLAYER_BAR_TX + 2) * G.TILE; px < (H.PLAYER_BAR_TX + 8) * G.TILE; px++) {
        for (let py = barY; py < barY + G.TILE; py++) {
          if (canvas.pixels[py * G.SCREEN_WIDTH + px] === G.SHADE_HP_GREEN) greens++;
        }
      }
      check("a full bar is painted green on the canvas", greens > 0,
            "no green pixels in the bar row");

      // The overlays have to win over the sheet they are loaded on top of. $6E
      // is the level marker and lives in hud1; $6B is a full HP bar cell and
      // lives only in fontBattleExtra. Both must draw, from different sheets.
      const probe = new G.GbCanvas();
      probe.clear(G.SHADE_NONE);
      check("an overlay tile draws", tiles.draw(probe, 0x6e, 0, 0));
      check("a base-sheet tile draws", tiles.draw(probe, 0x6b, 8, 0));
      check("and a code outside every sheet does not", !tiles.draw(probe, 0x20, 16, 0));

      // The gap between the two blocks, where the wearer must see the room.
      check("the space between the blocks is left alone",
            !drawn(2, 5) && !drawn(5, 5), "row 5 was painted");
      // And the right-hand side of the enemy's rows, past its frame.
      check("nothing is drawn past the enemy's block", !drawn(15, 1));
      // Rows 12..17 belong to the message box and the HUD must not touch them.
      let boxTouched = false;
      for (let tx = 0; tx < 20 && !boxTouched; tx++) {
        for (let ty = 12; ty < 18; ty++) {
          if (drawn(tx, ty)) { boxTouched = true; break; }
        }
      }
      check("the HUD paints nothing on the message box's rows", !boxTouched);
    } else {
      console.log("  (bundle has no font sheet; canvas checks skipped)");
    }
  } else {
    console.log("  (no bundle given; canvas checks skipped)");
  }
}

console.log("\n== the blocks' own window onto the screen ==");
{
  const V = await import("../Assets/Scripts/play/screen/HudBlockView.ts");
  const G2 = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  // The canvas stores row 0 at the top; the texture wants it at the bottom. So
  // the ENEMY block -- rows 0..3, the topmost thing on the screen -- must come
  // back with the HIGHEST v. Getting this backwards shows the message box.
  const enemy = V.uvRect(H.ENEMY_PLATE);
  const player = V.uvRect(H.PLAYER_PLATE);
  check("the enemy's block reaches the top of the texture", near(enemy[3], 1),
        "vTop " + enemy[3]);
  check("and your own sits below it", player[3] < enemy[1] || player[3] < enemy[3],
        "yours vTop " + player[3] + " theirs vBottom " + enemy[1]);
  check("the two windows do not overlap", player[3] <= enemy[1],
        "yours vTop " + player[3] + " vs theirs vBottom " + enemy[1]);

  // Neither may reach into the message box, rows 12..17.
  const boxTopV = 1 - (12 * G2.TILE) / G2.SCREEN_HEIGHT;
  check("neither window reaches the message box", player[1] >= boxTopV - 1e-9,
        "yours vBottom " + player[1] + " box top " + boxTopV);

  // Every edge is inside the texture.
  for (const [name, r] of [["enemy", enemy], ["player", player]]) {
    const ok = r.every((v) => v >= 0 && v <= 1) && r[0] < r[2] && r[1] < r[3];
    check("the " + name + " window is a real rectangle inside the texture", ok,
          JSON.stringify(r));
  }

  // A full-screen rectangle must map to the whole texture, which is the
  // sanity check the flip either passes or fails outright.
  const whole = V.uvRect([0, 0, G2.SCREEN_WIDTH / G2.TILE, G2.SCREEN_HEIGHT / G2.TILE]);
  check("a whole-screen window is the whole texture",
        near(whole[0], 0) && near(whole[1], 0) && near(whole[2], 1) && near(whole[3], 1),
        JSON.stringify(whole));
}

if (process.argv.indexOf("--selftest") >= 0) {
  console.log("\n== Selftest: the fixtures must reject a wrong bar ==");
  // A bar that filled from the right instead of the left, which is the mistake
  // this shape of code invites.
  const reversed = H.hpBarCells(10, 20).slice().reverse();
  check("a bar filled from the wrong end is rejected",
        hex(reversed) !== hex(H.hpBarCells(10, 20)));
  check("an off-by-one in the empty code is rejected",
        H.BAR_EMPTY + 8 === H.BAR_FULL);
}

console.log("\nBATTLEHUD  " + pass + " PASS  " + fail + " FAIL  " + (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
