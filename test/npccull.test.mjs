// Nobody stands where no terrain was built.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/npccull.test.mjs [--selftest]
//
// The third glasses test, 10 September: "als ik de game speel en er een chunk
// naast me niet geladen is dan zie ik wel de personages en pokemon van die
// niet geladen chunk, dus ik zie dan in de verte in niks ineens personages en
// pokemon en objecten".
//
// The cause is a seam nothing crossed. Bodies are placed from their MAP
// coordinates, which exist for the whole map; terrain is a WINDOW on part of
// it. Neither knew about the other, so an NPC three chunks away was drawn
// exactly as carefully as one at the player's feet, standing on nothing.
//
// Cells are two tiles square, which is the part worth testing: a cell that
// straddles the window's edge is half-built, and half-built is inside -- the
// body is drawn over ground that exists.

const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { windowHasCell } = await import("../Assets/Scripts/world/VoxelTerrain.ts");
const { coverHasTile } = await import("../Assets/Scripts/world/ChunkPlan.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

/** A window over tiles 10..29 on both axes: cells 5..14, with 5 and 14 whole. */
const W = { minTileX: 10, maxTileX: 29, minTileZ: 10, maxTileZ: 29 };

console.log("=== inside is inside ===");
{
  check("the middle", windowHasCell(W, 10, 10));
  check("the first whole cell", windowHasCell(W, 5, 5));
  check("the last whole cell", windowHasCell(W, 14, 14));
  check("a corner", windowHasCell(W, 5, 14));
}

console.log("=== outside is hidden ===");
{
  check("one cell west", windowHasCell(W, 4, 10) === false);
  check("one cell east", windowHasCell(W, 15, 10) === false);
  check("one cell north", windowHasCell(W, 10, 4) === false);
  check("one cell south", windowHasCell(W, 10, 15) === false);
  check("far away", windowHasCell(W, 90, 90) === false);
  check("negative", windowHasCell(W, -3, -3) === false);
  // The one that put characters in mid-air: inside on one axis is not inside.
  check("inside on X only is still outside", windowHasCell(W, 10, 40) === false);
  check("inside on Z only is still outside", windowHasCell(W, 40, 10) === false);
}

console.log("=== a cell straddling the edge counts as inside ===");
{
  // A window that starts mid-cell: tiles 11..28 leaves cell 5 (tiles 10,11)
  // half covered. The body stands on the half that exists, so hiding it would
  // be a character vanishing over ground that is plainly there.
  const half = { minTileX: 11, maxTileX: 28, minTileZ: 11, maxTileZ: 28 };
  check("the half cell at the near edge shows", windowHasCell(half, 5, 5));
  check("the half cell at the far edge shows", windowHasCell(half, 14, 14));
  check("the cell fully outside does not", windowHasCell(half, 4, 4) === false);
}

console.log("=== no window is nothing drawn ===");
{
  // GAME BOY mode builds no terrain at all, and a null window there must not
  // read as "everywhere is fine".
  check("null hides everyone", windowHasCell(null, 10, 10) === false);
}

console.log("=== a queued chunk is a chunk ===");
{
  // 11 September, the recordings: at every chunk boundary the row of chunks
  // ahead is queued and built over a frame or two, and everyone standing on it
  // blinked out and back, because surfaceY() is null until a chunk is BUILT.
  // The cull now also asks the cover, which is the promise: inside it, drawn.
  const C = { minTileX: 12, maxTileX: 41, minTileZ: 6, maxTileZ: 35 };
  check("a tile in the middle of the cover", coverHasTile(C, 20, 20));
  check("the cover's first tile", coverHasTile(C, 12, 6));
  check("the cover's last tile", coverHasTile(C, 41, 35));
  check("one tile past the east edge is not", coverHasTile(C, 42, 20) === false);
  check("one tile past the north edge is not", coverHasTile(C, 20, 5) === false);
  check("inside on one axis only is not", coverHasTile(C, 20, 90) === false);
  check("no cover is nowhere", coverHasTile(null, 20, 20) === false);
}

if (SELFTEST) {
  // The cover test must be able to say no as well.
  const C = { minTileX: 12, maxTileX: 41, minTileZ: 6, maxTileZ: 35 };
  let leaks = 0;
  for (const t of [[11, 6], [42, 6], [12, 5], [12, 36], [-1, -1], [200, 200]]) {
    if (coverHasTile(C, t[0], t[1]) !== false) leaks++;
  }
  check("SELFTEST every tile outside the cover is rejected", leaks === 0, "" + leaks);
  // And it reads the cover it is given: shrinking the east edge drops tile 41.
  check("SELFTEST a narrower cover drops its old last tile",
        coverHasTile({ minTileX: 12, maxTileX: 40, minTileZ: 6, maxTileZ: 35 }, 41, 20) === false);

  // The bounds test is only worth anything if it can say no. A version that
  // returned true everywhere would pass every check in the first block.
  let alwaysTrue = 0;
  const cases = [[4, 10], [15, 10], [10, 4], [10, 15], [90, 90], [-3, -3]];
  for (const c of cases) {
    if (windowHasCell(W, c[0], c[1]) !== false) alwaysTrue++;
  }
  check("SELFTEST every outside case is actually rejected", alwaysTrue === 0, "" + alwaysTrue);

  // And that the window used above really is the one the cells are measured
  // against: cell 14 covers tiles 28 and 29, so shrinking the window by two
  // tiles has to drop it.
  const shrunk = { minTileX: 10, maxTileX: 27, minTileZ: 10, maxTileZ: 27 };
  check("SELFTEST shrinking the window drops the last cell",
        windowHasCell(shrunk, 14, 14) === false);
}

console.log("\nNPCCULL  " + pass + " PASS  " + fail + " FAIL  " +
            (fail === 0 ? "OK" : "BROKEN"));
process.exit(fail === 0 ? 0 : 1);
