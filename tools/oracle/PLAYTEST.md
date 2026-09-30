# Playtesting the lens against the cartridge

You are comparing two machines that run the same game: the lens's headless
build (`test/headless.mjs`) and the real ROM in PyBoy (`tools/oracle/oracle.py`).
Where they disagree, the cartridge is right by definition and the difference
is a FINDING. You do not fix the lens; you find and document.

## Run a scenario

    node --experimental-strip-types --import ./test/register.mjs \
        tools/oracle/compare.mjs "<ROM>" Assets/Generated/kanto.json <scenario.json> [--json]

ROM path: `~/Downloads/Pokemon - Red Version (USA, Europe).gb`.
Always run from the project root.
Every scenario starts at a fresh new game: REDS_HOUSE_2F cell (3,6) facing
up, player RED, rival BLUE, no Pokemon, 3000 money.

## Scenario format

    { "player": "RED", "rival": "BLUE", "actions": [
        { "walk": "down", "n": 3 },     walk n steps (stops early at a wall, on both)
        { "face": "left" },             turn without stepping
        { "talk": true },               press A, read every line until the box closes
        { "press": "start" },           one press of a, b, start, select
        { "wait": 60 },                 frames
        { "text": "have one too!", "max": 400 }
                                        press A on both machines until those
                                        words are on screen (a cutscene that
                                        talks by itself); close it with a press
    ] }

A YES/NO menu on the cartridge opens on YES: A picks it, B answers NO. A
question that scrolls (three lines, "Do you want to / give a nickname /
to X?") shows its menu only on the last view: `text` up to a word of the
line before, then `press a`, `wait 60`, then your answer.
A starter ball first shows the Pokemon's Pokedex page on the cartridge;
`talk` presses through that page without reading it (the lens has no such
page yet), then reads the question that follows.

`scenarios/oak-escort.json` is a proven prefix: bedroom to the top of town,
through Oak's escort, ending in OAKS_LAB at (5,3) facing Oak's desk, BLUE at
(4,3), the Poke Balls at (6,3) CHARMANDER, (7,3) SQUIRTLE, (8,3) BULBASAUR.
Copy its actions verbatim for anything that happens in the lab.

Coordinates are step cells as the cartridge counts them (wXCoord, wYCoord):
x grows right, y grows down, (0,0) top-left of the map.

## Starting past the rival battle

Battles roll dice on both machines and cannot be compared, and the first
one stands between the lab and the rest of the world. A scenario may start
from a prepared state instead of a fresh game:

    { "start": "after-rival", "noWild": true, "actions": [ ... ] }

`after-rival`: the escort done, CHARMANDER chosen (no nickname), the rival
beaten. Both machines stand in OAKS_LAB at (5,6) facing down with
CHARMANDER L6 (exp 205); BLUE has left. The lab door is at (4,11)/(5,11);
outside you land on (12,12) in Pallet Town; the north exit is (10,1)/(11,1)
onto Route 1. `noWild: true` keeps wild Pokemon away on both machines (a
Repel on the cartridge, the encounter switch on the lens): use it for any
walk through grass, and never compare inside a battle. Trainer battles
(Route 22's rival, Viridian Forest) end a scenario: stop before them.
`stillNpcs: true` pins every wandering NPC to its shipped cell on both
machines; use it on routes with WALK-movement people in the way (Route 1's
youngsters, Viridian's), where the dice would otherwise decide who blocks
whom. `scenarios/after-rival-to-viridian.json` is the proven road from the
shared start up Route 1 (the ledge gaps are at x 6-8 and further up) into
VIRIDIAN_CITY.

Ledges can be hopped down now: facing one and stepping onto it from its
paired standing tile hops two cells and lands, exactly like the cartridge.

## Plan a route

    node --experimental-strip-types --import ./test/register.mjs \
        tools/oracle/route.mjs Assets/Generated/kanto.json PALLET_TOWN 5,6 9,10

prints walk actions between two cells of one map, avoiding object cells.
Doors and stairs are warps: walk ONTO a stair tile; walk down INTO a door
mat; leaving a map through its bottom door puts you on the cell in front of
the building outside. After any warp add `{ "wait": 90 }` before comparing.

Map facts you can read from the bundle (`Assets/Generated/kanto.json`):
`maps[ID].objects` (NPCs with x,y,sprite,movement), `maps[ID].warps`
(x,y,destMap), `maps[ID].signs`, `text[label]` (every line the game can say).
`node -e` with `JSON.parse(require("fs").readFileSync(...))` is fine.

## What is a finding, and what is not

A finding: after the same actions, map / cell / facing / party / money /
badges / bag / spoken text differ. Report the FIRST differing action, both
states, and the scenario that reproduces it. Keep scenarios short: five to
fifteen actions.

Lessons from the first round -- these produced eleven "findings" that were
the harness, not the lens; do not repeat them:
- `face` means TURN. Facing that way already, both machines treat a tap as
  a step, so the harness now ignores such a `face`; do not use it to "make
  sure" of a facing you already have -- look at the state instead.
- After ANY warp (door, stairs, edge) put `{ "wait": 90 }` before the next
  walk. Holding a direction through a warp costs the ROM its fade frames and
  fewer steps land on the other side; that is not a lens difference.
- A cell next to a WALK-movement NPC is not comparable: keep two cells away
  from `objects[].x,y` where `movement` is WALK.
- Never press faster than the cartridge prints. It ignores a button while a
  page is still printing (about a second a page); the lens does not. Put
  `{ "wait": 60 }` between presses, or use `talk` / `text`, which wait for
  a stable page on both machines.

Not a finding (both machines diverge by design):
- Anything after walking into tall grass or fighting a wild Pokemon: the
  cartridge's RNG cannot be replayed. Stop the scenario before the grass.
- Standing next to an NPC whose `movement` is WALK: it wanders in the ROM
  and stands still in the lens (known, FINDINGS.md). Route around them.
- Transient positions mid-warp: compare after a `wait`.

Known and already logged (do not re-report): see tools/oracle/FINDINGS.md.

## GAME BOY mode

`play/screen/OverworldCanvas.ts` draws the overworld the way the cartridge
draws it, on the flat 160x144 screen; `compare.mjs --screens` dumps a
160x144 shade frame from both machines after every settled, box-closed
action and diffs them pixel for pixel, writing `<n>-rom.png`, `<n>-lens.png`
and `<n>-diff.png` under `state/screens/<scenario>/` for anything that
differs:

    node --experimental-strip-types --import ./test/register.mjs \
        tools/oracle/compare.mjs "<ROM>" Assets/Generated/kanto.json <scenario.json> --screens

Facts measured here, not assumed (`tools/oracle/oracle.py`'s `screen_shades`,
`tilemap` and raw OAM/palette-register reads):

- **Screen anchor.** World tile `(tx,ty)` draws at screen tile
  `(tx - cellX*2 + 8, ty - cellY*2 + 8)` -- the player's own 16x16 sprite
  always sits at screen tiles (8,8)-(9,9). Checked byte for byte against the
  whole 20x18 `wTileMap` grid in REDS_HOUSE_2F (player at (3,6)) and in
  Pallet Town (player at (12,12)): zero mismatches either time, no special
  case needed at a map's own edge.
- **The 4px sprite lift.** Every overworld sprite -- player and NPC alike --
  draws 4px HIGHER than that tile-aligned anchor: OAM Y read 76 (screen pixel
  row 60) where the tile-aligned math would put it at row 64. Fixed, not a
  function of facing, direction, or map.
- **Sprites draw through OBP0, not BGP.** The background's palette is the
  identity (BGP = E4: index N is shade N), but every character sprite's OAM
  attribute read bit 4 clear (OBP0) on every tile sampled, and OBP0 itself
  read D0: index 0 and 1 both shade 0 (paper), 2 comes out as shade 1 (not
  2), 3 as shade 3. A sprite's raw 2bpp value is not a shade index the way a
  tile's is; skipping this remap renders every mid-tone pixel one shade too
  dark.
- **Tall grass over feet.** Standing on the tileset's `grassTile` sets the
  OBJ-to-BG priority bit (attr bit 7) on the BOTTOM two OAM tiles only:
  measured off (00) on plain ground and on (10) on Route 1's grass at step
  cell (10,1), with the top two tiles unchanged either way. The grass tile's
  own ink shows through the sprite's lower 8 rows instead of being covered.
- **Connections.** A tile beyond the current map's own edge follows the
  map's `connections` entry for that edge one level, the same
  `cellX/cellY - offset*2` math `Overworld.crossConnection` already uses for
  the exact seam cell, just applied at any distance within the 8-tile
  lookahead a screen needs. Verified for a zero offset (Pallet Town's whole
  viewport into Route 1); a nonzero offset inherits its confidence from that
  same, already-tested production code path rather than a fresh pixel check.
- **Water and flower DO animate, driven by one WRAM byte.** wTileMap itself
  never changes -- Gen 1 animates by rewriting the tile's own pattern-table
  graphic in VRAM -- but the graphic cycles on a measured schedule: a byte at
  **0xD085** (found by scanning WRAM for whatever changes at every water
  tick, both normal and skipped; the task brief's hMovingBGTilesCounter1/2
  guess, 0xFF97/0xFF98, never moved in a 500-frame HRAM watch) increments by
  1 every 21 frames and cycles 0..7. From it, BOTH animations are pure
  lookups (`OverworldCanvas.ts`'s `WATER_ROTATION_BY_PHASE` /
  `FLOWER_FRAME_BY_PHASE`, measured at Pallet Town's pond, byte for byte
  against PyBoy's VRAM one counter value at a time):
  - **Water**: the tileset's own shipped bitmap (`tileset.animation.waterFrame`,
    itself just a slice of `tileset.shades` at the water tile -- no separate
    ROM read needed) rotated `[0,-1,-2,-3,-2,-1,0,1][counter]` columns left
    per row (negative = right), wrapping. Counter 0 needs zero rotation --
    it decodes to exactly the tileset's own shipped bitmap.
  - **Flower**: `tileset.animation.flowerFrames[[0,0,1,2,0,0,1,2][counter]]`
    (`FlowerTile1/2/3` in that order; confirmed by re-encoding each ROM
    asset to 2bpp and matching it against the counter's own observed
    bitmap). The two repeated values in the table (index 0/1 and 4/5) are a
    real hold, not a mistake: the flower does not advance on every water
    tick, only 6 of every 8.
  - `tileset.animation` (WorldData.ts) carries the tile ids (fixed engine
    constants, 0x14/0x03, the same on every animated tileset -- confirmed on
    OVERWORLD/DOJO/GYM (WATER_FLOWER) and FOREST/CAVERN/SHIP/SHIP_PORT/
    FACILITY/PLATEAU (WATER only, `flowerTile`/`flowerFrames` null there)) and
    the packed graphics; it is `null` on every other tileset.
    `BundleFromExtraction.ts` builds it from data already fetched for the
    tileset's own sheet plus the existing `flower1-3.png` assets -- still
    ROM-derived, still gitignored with the rest of the bundle, same as every
    tile in it (never redistributed).
  - `view.animPhase` (0..7, or -1/anything else to mean "no counter to
    reproduce, draw the static tile") carries the counter into
    `paintOverworld`; `compare.mjs --screens` reads the ROM's own counter for
    each dump (`oracle.py`'s `sprite_positions`... `TILE_ANIM_COUNTER`) and
    hands it to `lens.screen(phase)` so both machines paint the same step.
  - **Closed (GAME BOY mode pass 3): `WATER_ROTATION_BY_PHASE` was wrong at
    every entry, off by a uniform one column.** The pass-2 table
    (`[0,-1,-2,-3,-2,-1,0,1]`) was never actually walked through all 8
    counter values against a live frame -- it rested on the assumption
    "counter 0 needs zero rotation... it decodes to exactly the tileset's
    own shipped bitmap", which was never itself checked. Pass 3 did check
    it: park at Viridian's pond (`screens-viridian.json` action 35, the
    `walk left n9` that put the pond on screen) and, with NO `--screens`
    dump involved at all, tick one frame at a time while reading
    `TILE_ANIM_COUNTER` and decoding the water tile's OWN VRAM pattern bytes
    together, every frame, until a full 0..7..0 cycle had gone by (168
    frames, `tools/oracle`'s `water_full_cycle` measurement). Every one of
    the 8 phases held a perfectly STEADY rotation for its whole ~21-frame
    window (no per-frame flicker the way the flower tile has, below) --
    `[7,6,5,4,5,6,7,0]` in 0..7 terms, i.e. `[-1,-2,-3,-4,-3,-2,-1,0]` in the
    file's own signed convention, which is the pass-2 table with exactly 1
    subtracted from every entry: the shape (a ping-pong down to -3/-4 and
    back) was already right, only the phase was off. The tileset's shipped,
    unrotated `waterFrame` bitmap actually corresponds to counter **7**, not
    counter 0 -- a fact about which frame the ROM's tile-graphics bank
    happens to store, not something the counter's own numbering implies.
    Cross-checked against Route 1's own pond at the identical frame
    (`screens-route1.json`, sharing the same `after-rival` start and action
    prefix, so the same counter values land in the same session): every
    steady value agreed with the Viridian sweep. `rotateTileRowsLeft` itself
    was never the bug (re-confirmed once more here); the table it was fed
    was. Fixed in `OverworldCanvas.ts`; `gbscreen.test.mjs`'s water-rotation
    checks re-derived against the corrected table.
  - **A trap for whoever re-measures this: the counter can outpace its OWN
    graphic by one frame.** The flower tile's VRAM pattern briefly shows the
    PREVIOUS phase's frame for exactly the first frame after
    `TILE_ANIM_COUNTER` increments, then the correct one for the rest of
    that ~21-frame window (measured the same way, sampling every frame of
    the flower tile's own VRAM bytes across a full cycle) --
    `FLOWER_FRAME_BY_PHASE` itself came back byte-for-byte correct once the
    transitional first frame was excluded, but a naive "read the instant the
    counter changes" probe (what this pass tried first) sees the STALE frame
    and reports a table that looks broken when it is not. The water tile never
    showed this within-phase flicker in the same sweep, so the two graphics
    are not on the same redraw schedule. `compare.mjs --screens` cannot hit
    this failure mode itself, because it drives its lens-side comparison off
    `Oracle.screen_settled()` now (see the sprite-render lag below, which
    the same fix also covers) rather than sampling the instant a counter
    changes.
- **NPC placement is a harness rule, not a lens feature.** `stillNpcs`
  freezes a WALK npc's ROM-side movement byte, but says nothing about WHERE
  it is: a fresh boot's NEW GAME / naming / Oak's speech runs thousands of
  real frames before a scenario's first action, during which an unpinned
  wanderer (Pallet Town's girl and fisher, Route 1's youngsters) may already
  have taken several random steps the lens -- built with `wanderers: false`
  from frame one -- never replays. `compare.mjs --screens` closes this by
  reading the ROM's own sprite slots after EVERY action (`oracle.py`'s
  `sprite_positions()`: slot `i` is the map's own i-th object, 1-based;
  `0xC200+i*16+4/+5` minus 4 is cell Y/X, `0xC100+i*16+9` is facing, the
  same byte `wPlayerFacing` reads at slot 0 -- cross-checked against two
  STAY npcs at their exact shipped cell+facing and two WALK ones already off
  theirs) and calling `HeadlessLens.placeNpcs(list)` (test-only, in
  `test/headless.mjs`, never production code) with what it reads. This runs
  after every action, not only "at start and after a map change": a STAY npc
  can still spontaneously turn to face a new direction with no map change
  and no scripted trigger (measured: Pallet Town's girl, pinned in place,
  turned left->right mid-scenario) -- placing every action's own read is the
  superset that also covers scenario start and a map change, for the price
  of a `sprite_positions()` call `--screens` already makes for the `npcs`
  field on every dump regardless.
- **The grass mask reads the ground, not whichever sprite was drawn most
  recently.** `GbCanvas.blitPartMasked`'s behindInk test used to read the
  live, still-changing canvas: paintOverworld draws every NPC before the
  player, so an NPC standing where the player's own grass-masked lower half
  lands made that half read "ink already here" from the NPC's own sprite,
  not from a grass blade, and suppressed the player's leg pixel over plain
  ground. Fixed with `GbCanvas.snapshotBackground()`, called once after the
  background is painted and before any sprite -- the mask now tests that
  frozen layer, which cannot contain a sprite's ink by construction.
  `gbscreen.test.mjs`'s "the grass mask reads the ground, not an NPC drawn
  first" case reproduces it with a synthetic overlapping NPC.
- **Closed (GAME BOY mode pass 3): it was never the fisher's own pixels --
  `oracle.py`'s screen capture could read one tick(8)-batch before the
  frame it asked for.** Pallet Town's own fisher (`PALLETTOWN_FISHER`; the
  Route 1 label in the earlier writeup was a misidentification -- he differs
  while the player is still standing in PALLET_TOWN, at `screens-route1.json`
  step 0), pinned by `stillNpcs` over a fence/flower-bed tile, differed from
  the ROM across roughly half his 16x16 box.
  - **The bit-7 hypothesis was tested first, directly, and is false.**
    PyBoy's real OAM (`0xFE00 + slot*4 + 3`, read raw AND through
    `pyboy.get_sprite(i).attr_obj_bg_priority`, both agreeing) showed bit 7
    clear on all four of the fisher's OAM tiles at the exact moment the
    screens differed -- not "only applied to the player" as guessed, since
    `OverworldCanvas.paintSprite` already runs the identical `onGrass` check
    for the player and every NPC alike (it always has, in this codebase).
    Forcibly treating the bit as SET anyway (all four tiles, or just the
    bottom two) barely moved the mismatch count (121/256 wrong pixels stayed
    at 120 or 115) -- decisive proof the priority bit is not the mechanism
    here at all, not just unset.
  - **Every other ingredient was independently re-verified correct too.**
    The fisher's OAM tile ids (0x34-0x37) decode, byte for byte, to the
    bundle's own "up" standing frame -- confirmed against BOTH the extracted
    bundle shades AND a fresh 2bpp decode straight off PyBoy's VRAM at that
    address, matching to the pixel. The alpha mask (transparent only where
    the raw value is 0) is exactly what the extractor already computes and
    is provably right given the shades already match. The background tiles
    under him (44, and the animated flower tile 3 at its correct
    `FLOWER_FRAME_BY_PHASE` frame for that instant) also decode identically
    to the bundle -- checked against every OTHER on-screen occurrence of
    tiles 44/3 elsewhere in the same frame, all 0 mismatches. A from-scratch
    hardware-accurate reconstruction (OAM + BG tilemap + BGP/OBP0 + priority
    rule, pixel by pixel) landed EXACTLY on the lens's own (wrong) output
    for the fisher's box and on the true ROM screen everywhere else on the
    160x144 frame -- proving the mismatch was confined to those 256 pixels
    and that nothing about the compositing MATH was wrong.
  - **The actual cause: `screen_shades()` can return a stale frame even
    once `settle()` has confirmed the game state is not changing.** Reading
    OAM, sprite state bytes, SCX/SCY, BGP/OBP0/OBP1 and the background tile
    bytes all agreed, unchanging, for many frames before AND after the
    differing screen was captured -- yet `screen_shades()` called twice in a
    row with NO tick between returned the SAME wrong frame both times (so it
    was not a one-off race), and a single further `tick(1)` replaced it with
    exactly the frame every other signal already predicted, for good (10+
    more idle frames stayed identical). This is a PyBoy/harness rendering
    lag, not a ROM behaviour or a lens bug: fixed with `Oracle.screen_settled()`,
    which ticks one frame at a time until `screen_shades()` returns the same
    result twice before handing it to a caller, and is now what both
    `st["screen"] = ...` sites in `Oracle.run()` call instead of the bare
    method. The exact same fix also covers the
    flower-tile counter/VRAM lag documented above -- both symptoms are
    "the frame a caller can read is not yet the frame that is actually
    settled", closed by the identical wait-for-two-matching-reads loop.
    `screens-route1.json` and `screens-viridian.json` are 0 differ end to
    end with this in place (were 32/2 and 35/5).

Sprite walk-cycle frames depend on the frame counter, exactly like the state
comparison's own 16n-frame rule: `--screens` only dumps after an action has
settled (nothing mid-step), so this is inherent, not a gap to close.

## Report

Return JSON:
    { "scenariosRun": n,
      "findings": [ { "title": "...", "map": "...", "step": i,
                      "action": {...}, "lens": "...", "rom": "...",
                      "scenario": {...full scenario...},
                      "kind": "text|position|warp|state|missing-content" } ],
      "agreed": [ "one line per scenario that fully agreed" ],
      "notes": "anything a fixer should know" }
Write each scenario you ran to tools/oracle/scenarios/<area>-<n>.json so
the gate keeps it. A scenario that agrees is worth keeping too.
