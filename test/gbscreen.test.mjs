// GAME BOY mode's renderer, headless: no ROM needed here, only pixels in a
// buffer -- the pixel-against-PyBoy proof lives in
// tools/oracle/compare.mjs --screens instead (see PLAYTEST.md's "GAME BOY
// mode" section for the measured facts this file holds to numbers).
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/gbscreen.test.mjs [--selftest]
//
// Every fixture here is synthetic (a tiny hand-built tileset and sprite, not
// the real bundle) so each check controls exactly the pixels it is testing.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { GbCanvas } = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
const { paintOverworld, connectedTileAt } = await import("../Assets/Scripts/play/screen/OverworldCanvas.ts");
const { MapRuntime } = await import("../Assets/Scripts/world/MapRuntime.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

// ---------------------------------------------------------- packing helpers
// The inverse of WorldData.ts's unpackShades/unpackMask -- standard base64,
// four 2-bit values a byte for shades, one bit a pixel for alpha.
function packShades(values) {
  const bytes = new Uint8Array(Math.ceil(values.length / 4));
  for (let i = 0; i < values.length; i++) bytes[i >> 2] |= (values[i] & 3) << ((i & 3) * 2);
  return Buffer.from(bytes).toString("base64");
}
function packMask(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  return Buffer.from(bytes).toString("base64");
}
function solid(n, value) { return new Array(n).fill(value); }

// ------------------------------------------------------------- test tileset
// 4 tiles per row, 2 rows: id0 floor (paper), id1 a marker tile (all ink),
// id2 grass (all ink, shade 1), id3 a second ink tile that is NOT grass --
// same shade as id2, so only `view.grassTile` (never the pixels) tells the
// priority rule apart from an ordinary dark tile.
//
// The packed array is the WHOLE SHEET in row-major pixel order (width 32),
// not one 64-pixel run per tile id -- a tile's row is `sheetWidth` pixels
// away from its next row, not 8.
const TILES_PER_ROW = 4;
const SHEET_WIDTH = TILES_PER_ROW * 8;
const TILESET_SHADES = (() => {
  const px = solid(SHEET_WIDTH * 16, 0);
  const setTile = (id, fn) => {
    const originX = (id % TILES_PER_ROW) * 8;
    const originY = ((id / TILES_PER_ROW) | 0) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px[(originY + y) * SHEET_WIDTH + (originX + x)] = fn(x, y);
  };
  setTile(1, () => 3);
  setTile(2, () => 1);
  setTile(3, () => 1);
  return packShades(px);
})();
const TILESET = {
  id: "TEST", tilesPerRow: 4, tileWidth: 32, tileHeight: 16, shades: TILESET_SHADES,
  grassTile: 2, walkable: [0, 2, 3], warpTiles: [], doorTiles: [], counterTiles: [],
  blocks: [solid(16, 0), solid(16, 1)], // block 0: floor; block 1: the marker, doubling as a border block
};

// -------------------------------------------------------------- test sprite
// 6 frames, 16x16 each, stacked (down, up, left, down-walk, up-walk, left-walk):
//   down:      all paper           (the animation-cycle test's "standing" frame)
//   up:        all ink             (the grass-priority test's sprite, both halves)
//   left:      left half ink, right half paper (the mirroring test)
//   down-walk: all ink             (the animation-cycle test's "walking" frame)
//   up-walk / left-walk: unused, left paper
// Fully opaque throughout, so every pixel drawn is a deliberate paper/ink choice.
function frame(fn) { const px = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.push(fn(x, y)); return px; }
const SPRITE_FRAMES = [
  frame(() => 0),
  frame(() => 3),
  frame((x) => (x < 8 ? 3 : 0)),
  frame(() => 3),
  frame(() => 0),
  frame(() => 0),
];
const SPRITE_PIXELS = [].concat(...SPRITE_FRAMES);
const SPRITE = {
  id: "SPRITE_TEST", frames: 6, walker: true, width: 16, height: 96,
  shades: packShades(SPRITE_PIXELS), alpha: packMask(solid(SPRITE_PIXELS.length, 1)),
};

const BUNDLE = { tilesets: { TEST: TILESET }, sprites: { SPRITE_TEST: SPRITE } };

function sprite(cellX, cellY, facing, walkOffset, walking) {
  return { cellX, cellY, facing, walkOffset: walkOffset || 0, walking: !!walking, spriteId: "SPRITE_TEST" };
}
/** A view whose tileAt is a plain closure -- no MapRuntime needed for tests
 * that are not specifically about the border/connection accessor. -1 (no
 * counter to reproduce) unless a test passes its own. */
function flatView(tileAtFn, player, npcs, animPhase) {
  return {
    tilesetId: "TEST", tileAt: tileAtFn, grassTile: 2, player, npcs: npcs || [],
    frame: 0, animPhase: animPhase === undefined ? -1 : animPhase,
  };
}
function allFloor() { return () => 0; }

// A second, one-frame sprite ("up" only, raw shade 2 -> OBP0 shade 1) so an
// overlap test can tell "the NPC's own leftover ink" (shade 1) apart from
// "the player's own ink" (shade 3, SPRITE_TEST's "up" frame) at the same
// pixel -- same value on both would pass whether or not the mask bug is
// present. down (index 0) is padding `frameFor` never selects for "up".
const NPC_FRAMES = [frame(() => 0), frame(() => 2)];
const NPC_PIXELS = [].concat(...NPC_FRAMES);
const SPRITE_NPC = {
  id: "SPRITE_NPC", frames: 2, walker: false, width: 16, height: 32,
  shades: packShades(NPC_PIXELS), alpha: packMask(solid(NPC_PIXELS.length, 1)),
};
const BUNDLE_WITH_NPC = { tilesets: { TEST: TILESET }, sprites: { SPRITE_TEST: SPRITE, SPRITE_NPC } };

// -------------------------------------------------------- the player anchor
console.log("=== the player's screen anchor ===");
{
  const c = new GbCanvas();
  paintOverworld(c, BUNDLE, flatView(allFloor(), sprite(5, 5, "up", 0, false)));
  // "up" is the all-ink frame: opaque ink wherever the sprite is drawn.
  check("ink starts at pixel row 60 (tile row 8, minus the measured 4px lift)",
        c.shadeAt(64, 60) === 3 && c.shadeAt(64, 59) === 0);
  check("ink starts at pixel column 64 (tile column 8, no horizontal lift)",
        c.shadeAt(64, 65) === 3 && c.shadeAt(63, 65) === 0);
  check("the sprite is 16px: paper again at row 76", c.shadeAt(64, 76) === 0);
  check("and at column 80", c.shadeAt(80, 65) === 0);
}

// ------------------------------------------------------------- walk offset
console.log("=== walk offset scrolls the background ===");
{
  // A marker tile (id 1, all ink) at world tile (12,8); the player at cell
  // (5,5) with offset 0 shows it at screen tile (12-10+8, 8-10+8) = (10,6) --
  // pixel (80,48). walkOffset is how far the CAMERA still lags the landing
  // cell (visualCell()'s own convention, cellX/cellY being the destination
  // Overworld already updates to at the start of a step): walking RIGHT
  // holds the camera BEHIND (to the left), which slides a fixed world point
  // to the RIGHT on screen; walking LEFT/UP/DOWN mirror that per axis.
  const tileAt = (tx, ty) => (tx === 12 && ty === 8 ? 1 : 0);
  const at = (walkOffset, facing) => {
    const c = new GbCanvas();
    paintOverworld(c, BUNDLE, flatView(tileAt, sprite(5, 5, facing, walkOffset, walkOffset > 0)));
    return c;
  };
  check("at rest the marker sits at (80,48)", at(0, "down").shadeAt(80, 48) === 3);
  check("mid-step RIGHT (camera held left) the marker has slid right",
        at(8, "right").shadeAt(88, 48) === 3 && at(8, "right").shadeAt(80, 48) === 0);
  check("mid-step LEFT (camera held right) the marker has slid left",
        at(8, "left").shadeAt(72, 48) === 3 && at(8, "left").shadeAt(80, 48) === 0);
  check("mid-step DOWN (camera held up) the marker has slid down",
        at(8, "down").shadeAt(80, 56) === 3 && at(8, "down").shadeAt(80, 48) === 0);
  check("mid-step UP (camera held down) the marker has slid up",
        at(8, "up").shadeAt(80, 40) === 3 && at(8, "up").shadeAt(80, 48) === 0);
  check("a full 16px offset is exactly one tile over -- standing at the source cell",
        at(16, "right").shadeAt(96, 48) === 3);
}

// -------------------------------------------------------------- the border
console.log("=== the border block beyond the map ===");
{
  const def = {
    id: "TESTMAP", label: "TestMap", palette: "", width: 1, height: 1,
    blocks: [0], borderBlock: 1, tileset: "TEST", connections: {},
    warps: [], signs: [], objects: [],
  };
  const map = new MapRuntime(def, TILESET);
  const neighbours = {};
  const tileAt = (tx, ty) => connectedTileAt(BUNDLE, map, neighbours, tx, ty);
  check("inside the map is floor", tileAt(2, 2) === 0);
  check("ten tiles past the north edge is the border block", tileAt(2, -10) === 1);
  check("ten tiles past the east edge is the border block", tileAt(14, 2) === 1);
  check("ten tiles past a corner is the border block too", tileAt(-10, -10) === 1);

  const c = new GbCanvas();
  // Player at cell (0,0): the top-left of the map, so most of the screen is
  // border -- a real "the whole edge fills in" check, not one probed pixel.
  paintOverworld(c, BUNDLE, { tilesetId: "TEST", tileAt, grassTile: -1, player: sprite(0, 0, "down"), npcs: [], frame: 0 });
  check("the screen's own top-left corner is the border block", c.shadeAt(0, 0) === 3);
}

// ---------------------------------------------------------------- mirroring
console.log("=== a right-facing walker is the left frame mirrored ===");
{
  const c1 = new GbCanvas();
  paintOverworld(c1, BUNDLE, flatView(allFloor(), sprite(5, 5, "left", 0, false)));
  check("facing left: ink on the left half", c1.shadeAt(65, 65) === 3 && c1.shadeAt(75, 65) === 0);

  const c2 = new GbCanvas();
  paintOverworld(c2, BUNDLE, flatView(allFloor(), sprite(5, 5, "right", 0, false)));
  check("facing right: the SAME frame mirrored -- ink on the right half instead",
        c2.shadeAt(75, 65) === 3 && c2.shadeAt(65, 65) === 0);
}

// ------------------------------------------------------------ grass priority
console.log("=== tall grass draws over the bottom half of a standing sprite ===");
{
  // World tile rows 9+ are id 2 (grass, shade 1); rows below 9 are id 3 --
  // the SAME shade 1 ink, but not the grass id -- so a wrong result can only
  // come from the priority rule misfiring, never from the two tiles looking
  // different. Facing "up" is the sprite's own all-ink (shade 3) frame, so
  // every pixel it draws is opaque ink unless the rule steps in.
  const tileAt = (tx, ty) => (ty >= 9 ? 2 : 3);
  // Cell (5,5): cellTile = tileAt(10,11), ty=11 -> grass. Cell (5,2):
  // cellTile = tileAt(10,5), ty=5 -> the non-grass ink tile. Either way the
  // player's own sprite box is the same fixed (64,60)-(79,75) (see the
  // anchor test), so only the background underneath differs between them.
  const onGrass = sprite(5, 5, "up", 0, false);
  const c = new GbCanvas();
  paintOverworld(c, BUNDLE, flatView(tileAt, onGrass));
  check("on grass, the top half still draws the sprite's own ink", c.shadeAt(64, 62) === 3);
  check("on grass, the bottom half shows the grass tile's ink instead (shade 1, not the sprite's 3)",
        c.shadeAt(64, 70) === 1);

  const offGrass = sprite(5, 2, "up", 0, false);
  const c2 = new GbCanvas();
  paintOverworld(c2, BUNDLE, flatView(tileAt, offGrass));
  check("off grass (same ink underneath, wrong id) the sprite's own ink wins on both halves",
        c2.shadeAt(64, 62) === 3 && c2.shadeAt(64, 70) === 3);
}

// ------------------------------------------------- grass mask vs an overlap
console.log("=== the grass mask reads the ground, not an NPC drawn first ===");
{
  // grassTile 0 with `allFloor` as "the grass": every pixel under the
  // player's feet is genuinely paper (shade 0), on a tile that also happens
  // to satisfy the under-feet grassTile check -- so a correct mask must
  // never suppress the player's own ink there, no matter what an NPC drawn
  // moments earlier (paintOverworld always draws NPCs before the player)
  // left behind. An NPC at the SAME cell forces full overlap with the
  // player's own fixed (64,60)-(79,75) sprite box.
  const npc = { ...sprite(5, 5, "up", 0, false), spriteId: "SPRITE_NPC" }; // raw 2 -> OBP0 shade 1
  const player = sprite(5, 5, "up", 0, false); // all ink, shade 3
  const view = flatView(allFloor(), player, [npc]);
  view.grassTile = 0;
  const c = new GbCanvas();
  paintOverworld(c, BUNDLE_WITH_NPC, view);
  check("the player's own ink (shade 3) wins over the NPC's leftover ink (shade 1) on paper ground",
        c.shadeAt(64, 70) === 3);
}

// -------------------------------------------------------- the walk cycle
console.log("=== the walk cycle: standing vs walking picks a different frame ===");
{
  const standing = sprite(5, 5, "down", 0, false);
  const c1 = new GbCanvas();
  paintOverworld(c1, BUNDLE, flatView(allFloor(), standing));
  check("standing (down: all paper) draws no ink", c1.shadeAt(64, 65) === 0);

  const walking = sprite(5, 5, "down", 8, true);
  const c2 = new GbCanvas();
  paintOverworld(c2, BUNDLE, flatView(allFloor(), walking));
  check("walking (down-walk: all ink) draws ink instead", c2.shadeAt(64, 65) === 3);
}

// --------------------------------------------------------- water and flower
console.log("=== the water rotation and flower frame follow view.animPhase ===");
{
  // Tile 1 (all ink, shade 3) doubles as "the water tile" here: its rotation
  // is invisible on a uniform fill, so instead the fixture's own waterFrame
  // is a single ink pixel at column 0 of every row -- a left rotation moves
  // it to a column equal to the rotation amount, which a probe can read off
  // directly. Tile 3 doubles as "the flower tile"; flowerFrames are three
  // ALL-DIFFERENT solid fills (1, 2, 3) so a probe can tell which one drew
  // without decoding a pattern.
  const solidTile = (v) => packShades(solid(64, v));
  const leftColumnTile = () => {
    const px = solid(64, 0);
    for (let row = 0; row < 8; row++) px[row * 8] = 3;
    return packShades(px);
  };
  const ANIM_TILESET = {
    ...TILESET,
    animation: {
      waterTile: 1, waterFrame: leftColumnTile(),
      flowerTile: 3, flowerFrames: [solidTile(1), solidTile(2), solidTile(3)],
    },
  };
  const ANIM_BUNDLE = { tilesets: { TEST: ANIM_TILESET }, sprites: { SPRITE_TEST: SPRITE } };
  // World tile (12,8) is the water tile; (13,8) the flower tile -- both land
  // on screen at a fixed spot for the player fixed at cell (5,5) (see the
  // walk-offset test above for this same layout).
  const tileAt = (tx, ty) => (tx === 12 && ty === 8 ? 1 : tx === 13 && ty === 8 ? 3 : 0);
  const player = sprite(5, 5, "down", 0, false); // all paper -- draws nothing to confuse a probe
  const waterShadeAt = (phase, col) => {
    const c = new GbCanvas();
    paintOverworld(c, ANIM_BUNDLE, flatView(tileAt, player, [], phase));
    return c.shadeAt(80 + col, 48);
  };
  const waterInkColumn = (phase) => {
    for (let col = 0; col < 8; col++) if (waterShadeAt(phase, col) === 3) return col;
    return -1;
  };
  const flowerShade = (phase) => {
    const c = new GbCanvas();
    paintOverworld(c, ANIM_BUNDLE, flatView(tileAt, player, [], phase));
    return c.shadeAt(88, 48);
  };
  check("phase 0 (table entry -1): the ink column has moved right by one",
        waterInkColumn(0) === 1);
  check("phase 7 (table entry 0): no rotation -- the ink column is still 0",
        waterInkColumn(7) === 0);
  check("phase 3 (table entry -4): the ink column has moved right by four",
        waterInkColumn(3) === 4);
  check("phase 0: the flower tile shows frame 0 (shade 1)", flowerShade(0) === 1);
  check("phase 2: the flower tile shows frame 1 (shade 2)", flowerShade(2) === 2);
  check("phase 3: the flower tile shows frame 2 (shade 3)", flowerShade(3) === 3);
  // The tileset's own static tile 1 (the fixture's "water") is ALL ink, not
  // just column 0, and tile 3 (its "flower") is shade 1 -- neither matches
  // any animated override, so seeing them proves the override was skipped
  // rather than coinciding by accident with an override's own output.
  check("no phase to reproduce (-1): the tileset's own static tiles draw untouched",
        waterShadeAt(-1, 4) === 3 && flowerShade(-1) === 1);
  check("a phase out of range (8) is treated the same as none",
        waterShadeAt(8, 4) === 3 && flowerShade(8) === 1);
}

// -------------------------------------------------------------------------
if (SELFTEST) {
  console.log("=== selftest ===");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before;
    fail = before;
    if (noticed) { pass++; } else { fail++; console.log("  FAIL selftest: " + label + " passes even when broken"); }
  }
  expectFailures("a canvas that never draws the sprite", () => {
    const c = new GbCanvas();
    check("sprite detector", c.shadeAt(64, 60) === 3);
  });
  expectFailures("a mirror that does not flip", () => {
    const c = new GbCanvas();
    paintOverworld(c, BUNDLE, flatView(allFloor(), sprite(5, 5, "left", 0, false)));
    check("mirror detector (comparing the unmirrored frame to itself)", c.shadeAt(75, 65) === 3);
  });
  expectFailures("grass that never covers the sprite", () => {
    const tileAt = (tx, ty) => (ty >= 9 ? 2 : 3);
    const c = new GbCanvas();
    // Simulate the regression directly: behindInk requested but ignored.
    const real = c.blitPartMasked.bind(c);
    c.blitPartMasked = (img, sx, sy, w, h, x, y, transparent, hFlip) => real(img, sx, sy, w, h, x, y, transparent, hFlip, false);
    paintOverworld(c, BUNDLE, flatView(tileAt, sprite(5, 5, "up", 0, false)));
    check("priority detector", c.shadeAt(64, 70) === 1);
  });
  expectFailures("an npc's leftover ink read as the ground under the player", () => {
    const npc = { ...sprite(5, 5, "up", 0, false), spriteId: "SPRITE_NPC" };
    const player = sprite(5, 5, "up", 0, false);
    const view = flatView(allFloor(), player, [npc]);
    view.grassTile = 0;
    const c = new GbCanvas();
    // Simulate the regression directly: never freeze a background layer, so
    // blitPartMasked's behindInk test falls back to the live composite --
    // which, by the time the player is drawn, already carries the NPC's own
    // ink drawn moments before.
    c.snapshotBackground = () => {};
    paintOverworld(c, BUNDLE_WITH_NPC, view);
    check("npc-ink-as-ground detector", c.shadeAt(64, 70) === 3);
  });
  expectFailures("an animated tile wired to the wrong id never substitutes", () => {
    const waterTileShades = solid(64, 0);
    for (let row = 0; row < 8; row++) waterTileShades[row * 8] = 3;
    const tileset = {
      ...TILESET,
      // Simulate the regression directly: the animation is wired to a tile
      // id (99) nothing on screen ever names, so paintBackground's override
      // check never matches and tile 1 keeps drawing its own static (all
      // ink) sheet content regardless of phase.
      animation: { waterTile: 99, waterFrame: packShades(waterTileShades), flowerTile: -1, flowerFrames: null },
    };
    const bundle = { tilesets: { TEST: tileset }, sprites: { SPRITE_TEST: SPRITE } };
    const tileAt = (tx, ty) => (tx === 12 && ty === 8 ? 1 : 0);
    const c = new GbCanvas();
    paintOverworld(c, bundle, flatView(tileAt, sprite(5, 5, "down", 0, false), [], 7));
    check("rotation detector (phase 7 should move the ink column off 0)", c.shadeAt(80, 48) !== 3);
  });
  expectFailures("a border that leaks the interior tile", () => {
    const def = { id: "T2", label: "T2", palette: "", width: 1, height: 1, blocks: [0],
                  borderBlock: 1, tileset: "TEST", connections: {}, warps: [], signs: [], objects: [] };
    const map = new MapRuntime(def, TILESET);
    check("border detector", connectedTileAt(BUNDLE, map, {}, 50, 50) === 0);
  });
}

console.log("");
console.log("\n== The dark tunnel ==");
{
  // LoadGBPal (home/fade.asm:3-19): wMapPalOffset 6 selects FadePal2, whose
  // BGP and OBP0 are 3,3,3,2 -- every shade but 3 comes out black and 3 comes
  // out as shade 2. Nothing else about the frame changes.
  const { GbCanvas } = await import("../Assets/Scripts/play/screen/GbCanvas.ts");
  const canvas = new GbCanvas();
  canvas.clear(0);
  for (let i = 0; i < 4; i++) { canvas.pixels[i] = i; }
  canvas.remapShades([3, 3, 3, 2]);
  check("paper, light and mid all go black, and black goes to the one grey",
        canvas.pixels[0] === 3 && canvas.pixels[1] === 3 && canvas.pixels[2] === 3 &&
        canvas.pixels[3] === 2, Array.from(canvas.pixels.slice(0, 4)).join(","));
  const before = canvas.stateVersion();
  canvas.remapShades([0, 1, 2, 3]);
  check("an identity palette still counts as a draw", canvas.stateVersion() > before);
  check("and a short palette is refused rather than guessed at",
        (() => { const p = canvas.pixels[0]; canvas.remapShades([0, 1]); return canvas.pixels[0] === p; })());
}


console.log("GBSCREEN  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
