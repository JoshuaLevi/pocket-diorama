# Pokemon Red's intro, measured on the cartridge

Power-on through the first frame of the bedroom (`REDS_HOUSE_2F`), recorded
frame-accurately in PyBoy 2.7 from `~/Downloads/Pokemon - Red
Version (USA, Europe).gb`. Every number below is measured off the real
cartridge, not the project's `OAK_SPEECH` script (`Assets/Scripts/play/script/
MapScripts.ts:453-476`), which this report cross-checks against and corrects
in two places (see "Two corrections" below).

**Total length: 5092 frames** (power-on tick 1 through the bedroom's first
20 stable frames), about 85.3 seconds at 59.7275 fps. Fully deterministic:
running the recorder twice produced byte-identical frame numbers for every
beat (see "How to re-run").

## How to re-run

```
tools/oracle/.venv/bin/python tools/oracle/state/intro/record_intro.py \
    --summary tools/oracle/state/intro/summary.json
```

Run from anywhere (paths are absolute inside the script). It powers PyBoy on
fresh (`window="null"`, no boot ROM file, no save state — genuinely from
tick 0), ticks one frame at a time for the entire intro, and drives input
with the same 2-frame-tap convention `oracle.py`/`PLAYTEST.md` use elsewhere
in this project. It does **not** import `oracle.py`. Every frame's quantized
image, both hardware tile maps, `wTileMap`, and `BGP/SCX/SCY/WX/WY/LCDC` are
kept in memory as it goes (a few hundred MB, freed on exit), so any beat's
files are written from data already captured — nothing is re-simulated to
produce them. The whole run (5092 frames, decode + write all files) takes
about 3 seconds.

Pass `--no-write` to get just the beat table and `summary.json` (frame
numbers, full per-frame logs for the slide/fades, every text page's lines)
without writing the 373 PNG/JSON pairs — useful for the determinism check,
which is what `--no-write` was used for here: two runs, diffed, identical
`beats`, `totalFrames`, and `finalState`.

Supporting library files, all under this same directory (gitignored, like
everything else under `state/`):
- `introlib.py` — charmap loader (reads `Assets/Generated/kanto.json`'s
  `font.charmap`, read-only, the same data `oracle.py` uses), the `Screen`
  wTileMap-decoder, and the DMG quantizer.
- `pngwrite.py` — a dependency-free grayscale PNG encoder (stdlib `zlib` +
  `struct` only; Pillow is not installed in the oracle venv and nothing here
  reaches the network to install it).
- `record_intro.py` — the recorder itself: the `Recorder` class, the
  per-phase driver functions, and `main()`.

Outputs: `frames/NN-<beat>[-fFFFF].png` (160x144, one file per beat, or one
per frame for the four beats the task asked for frame-by-frame — see the
naming note below the beat table) and `tilemaps/NN-<beat>[-fFFFF].tilemap.json`
(the matching per-frame data: both hardware tile maps, `wTileMap`, and every
register). `summary.json` carries everything in one place, including every
text page's exact lines and the full frame-by-frame logs for the slide and
both fades.

## Pixel format

Quantized to the 4 DMG shades using PyBoy's own fixed render palette
(`pyboy/pyboy.py`, `color_palette = (0xFFFFFF, 0x999999, 0x555555,
0x000000)` — this is what PyBoy always renders in `window="null"` mode, not
a guess). Every PNG is 8-bit grayscale where **the gray level IS the
shade**, exact, no separate legend needed:

| shade index | BGP color # | gray level written |
|---|---|---|
| 0 | 00 (white)      | 255 |
| 1 | 01 (light gray) | 153 |
| 2 | 10 (dark gray)  | 85  |
| 3 | 11 (black)      | 0   |

## Rendering: two tile maps, and which one is "on screen"

`wTileMap` (WRAM `$C3A0`, what `oracle.py`'s `screen_text()` reads) is a
**text/menu-engine-only** shadow buffer. It carries dialogue box and menu
text faithfully, but it does **not** carry any picture (title screen, Oak/
Nidorino/player/rival portraits) — measured directly: at the title screen
and during Oak's portrait fade-in, `wTileMap` holds unrelated leftover data
(literally the font-loading routine's own scratch content, a stray A-Z
table), while the actual picture is only ever in hardware VRAM. **A
renderer must read hardware VRAM for pictures**, not `wTileMap`.

Two hardware background layers exist, `$9800` and `$9C00`; which one is the
"BG" and which is the "window" is picked by `LCDC` bits 3 (BG map) and 6
(window map), and the window is only actually visible where `LCDC` bit 5 is
set **and** `WY < 144`. Measured across this whole intro:
- **Title screen**: window pushed off-screen (`WY=144`), so the visible
  layer is the plain BG at `$9800`.
- **Oak's speech, both name grids, everything through the shrink**: the
  window is full-screen (`WY=0`, `WX=7` at rest), `LCDC` bit 6 set, so
  **`$9C00` is what's on screen**; `$9800`/`wTileMap` are irrelevant
  underneath it.

Every tilemap JSON this recorder writes includes **both** raw 32x32 maps
(cropped to the visible 20x18, honouring `SCX`/`SCY` for whichever one is
currently the BG) plus `bgMapIs9C00`/`windowMapIs9C00`/`windowVisible`
flags, so a renderer can apply this same rule itself rather than trust an
interpretation baked in.

## Tile-id ranges (pic vs. font vs. box vs. blank)

Measured identically across all four portraits (Oak, Nidorino, the player,
the rival — confirmed by diffing the actual tile grid at a representative
frame of each): the pic is a fixed **7x7 tile block, top-left tile (row 4,
col 0) [screen tile coordinates row,col; this block sits at columns 6-12],
tile ids `$00`-`$30`** (49 tiles, column-major sequential — col 0 is ids
`$00`-`$06`, col 1 is `$07`-`$0D`, etc). This range is reused for the
letter-grid's own A-Z lettering region's *shape* but not its ids (see
below) — `$00`-`$30` always means "the pic," everywhere in this intro.

Other fixed ranges, measured off the actual tile grids in `tilemaps/`:
- **Font (dialogue text)**: ids `$60`+ (this is `introlib.py`'s own
  decode threshold, taken from `oracle.py`).
- **Dialogue/list box border**: top-left `$79`, top edge `$7A`, top-right
  `$7B`, left/right side `$7C`, bottom-left `$7D`, bottom-right `$7E`
  (bottom edge reuses `$7A`). Identical tiles for the Oak-speech dialogue
  box and both naming grids' outer box.
- **Blank/background fill**: `$7F`, used everywhere (this is why a naive
  "is any tile non-zero" check is not the same as "is a picture on
  screen" — `$7F` is `>=$60`-adjacent-range but is not font either; it is
  simply "empty").
- **Name-grid letters A-Z**: ids `$80`-`$99`, sequential, laid out on
  three rows of the grid (see the naming-screen section).
- **List/grid cursor** (`▲`): id `$ED`.
- **Page-advance blink arrow** (`▼`): id `$EE`.
- **Title screen** (measured separately, `$9800`, at the fully-settled
  frame): the "Pokémon" wordmark logo is a 16x6 block at rows 1-6, cols
  2-17, ids `$80`-`$DF` sequential (96 tiles); a shared "short caption"
  range `$31`-$40` is reused for both the copyright line (on the
  copyright/GAME FREAK screens) and "Red Version" (on the settled title);
  the walking sprite + player character at the bottom reuse the *same*
  `$00`-`$30` pic range as the four portraits above, just at a lower
  screen position (rows 10-16); the "©'95.'96.'98 GAME FREAK inc." bottom
  line is its own small range, `$41`-`$4E`.

## Beat table

Every beat below has a start frame (first frame it is visible) and end
frame (last frame before the next beat), 1-indexed from power-on tick 1.
File names are `frames/NN-<name>.png` / `tilemaps/NN-<name>.tilemap.json`;
where the task asked for every frame (the Nidorino slide, the shrink, both
fades) the beat instead has one numbered file per frame,
`NN-<name>-fFFFF.png`, `fFFFF` counting from 0 at the beat's start frame —
that mapping is 1:1 with `start + fFFFF = the real frame number`.

| # | beat | start | end | frames |
|---|---|---:|---:|---:|
| 01 | nintendo_gamefreak_intro | 1 | 1189 | 1188 |
| 02 | title_screen | 1228 | 1558 | 330 |
| 03 | main_menu | 1678 | 1694 | 16 |
| 04 | oak_portrait_fadein | 1701 | 1827 | 126 |
| 05 | oak_speech_text1_p1 | 1827 | 1913 | 86 |
| 06 | oak_speech_text1_p2 | 1914 | 1979 | 65 |
| 07 | oak_speech_text1_p3 | 1980 | 1997 | 17 |
| 08 | oak_speech_text1_p4 | 1998 | 2091 | 93 |
| 09 | oak_speech_text1_p5 | 2092 | 2171 | 79 |
| 10 | nidorino_appears | 2173 | 2237 | 64 |
| 11 | nidorino_cry_approx | 2238 | 2238 | 0 |
| 12 | oak_speech_text2a_p1 | 2237 | 2320 | 83 |
| 13 | oak_speech_text2a_p2 | 2321 | 2383 | 62 |
| 14 | oak_speech_text2a_p3 | 2384 | 2464 | 80 |
| 15 | oak_speech_text2a_p4 | 2465 | 2482 | 17 |
| 16 | oak_speech_text2b_p1 | 2483 | 2570 | 87 |
| 17 | oak_speech_text2b_p2 | 2571 | 2633 | 62 |
| 18 | oak_speech_text2b_p3 | 2634 | 2696 | 62 |
| 19 | oak_speech_text2b_p4 | 2697 | 2714 | 17 |
| 20 | oak_speech_text2b_p5 | 2715 | 2748 | 33 |
| 21 | oak_speech_text2b_p6 | 2749 | 2766 | 17 |
| 22 | oak_speech_text2b_p7 | 2767 | 2880 | 113 |
| 23 | player_portrait_slide | 2882 | 2948 | 66 |
| 24 | introduce_player_text_p1 | 2948 | 3070 | 122 |
| 25 | your_name_list | 3111 | 3287 | 176 |
| 26 | name_confirmed_player_p1 | 3346 | 3445 | 99 |
| 27 | rival_portrait | 3447 | 3557 | 110 |
| 28 | introduce_rival_text_p1 | 3557 | 3656 | 99 |
| 29 | introduce_rival_text_p2 | 3657 | 3719 | 62 |
| 30 | introduce_rival_text_p3 | 3720 | 3782 | 62 |
| 31 | introduce_rival_text_p4 | 3783 | 3800 | 17 |
| 32 | introduce_rival_text_p5 | 3801 | 3939 | 138 |
| 33 | rivals_name_list | 3980 | 4112 | 132 |
| 34 | name_confirmed_rival_p1 | 4171 | 4272 | 101 |
| 35 | name_confirmed_rival_p2 | 4273 | 4340 | 67 |
| 36 | player_portrait_again | 4342 | 4415 | 73 |
| 37 | oak_speech_text3_p1 | 4415 | 4436 | 21 |
| 38 | oak_speech_text3_p2 | 4437 | 4454 | 17 |
| 39 | oak_speech_text3_p3 | 4455 | 4551 | 96 |
| 40 | oak_speech_text3_p4 | 4552 | 4614 | 62 |
| 41 | oak_speech_text3_p5 | 4615 | 4632 | 17 |
| 42 | oak_speech_text3_p6 | 4633 | 4732 | 99 |
| 43 | oak_speech_text3_p7 | 4733 | 4783 | 50 |
| 44 | oak_speech_text3_p8 | 4784 | 5010 | 226 |
| 45 | shrink | 4875 | 5010 | 135 |
| 46 | fade_to_white | 5011 | 5012 | 1 |
| 47 | fade_into_bedroom | 5013 | 5073 | 60 |

Final state (frame 5092, well past the bedroom settling): `wCurMap`=38
(`REDS_HOUSE_2F`, confirmed against `Assets/Generated/kanto.json`'s
`mapOrder[38]`), `wXCoord`=3, `wYCoord`=6, `wSpritePlayerStateData1FacingDirection`
= up. Matches the project's own measured finding (`oracle.py`'s
`PLAYTEST.md` header and `MapScripts.ts:470-473`'s comment) exactly.
**Measured separately and worth noting**: `wCurMap`/`x`/`y` are already
`(38, 3, 6)` by frame **1828** — one frame into `OakSpeechText1`'s first
page, i.e. essentially as soon as Oak starts talking, long before the
screen ever shows the bedroom. This matches `oracle.py`'s own comment
("NEW GAME writes the map long before Oak has finished talking") almost
exactly, just pinned to a frame number.

## The two corrections to the assumed script

> **Correction 1 below is WRONG and is kept only as a record of the
> artefact.** Re-measured on 7 September by the orchestrator with a single
> 2-frame A press after "First, what is..." and then NO input
> (`state/intro/_probe_namelist4.py`, frames `90-player_name_presets*`,
> `93-rival_name_presets*`): the preset list DOES exist. The recorder's
> `phase_name_entry` pressed A in a loop until it saw the grid's title, and
> that loop's second press landed on NEW NAME, which is the list's first
> row, so the list was never seen. Measured shape:
>
> - A pressed at frame 3110 (question page up since 3019). The portrait
>   slides RIGHT one tile column at a time, about every 3 frames, from
>   columns 6-12 to columns 11-17 (new columns appear at frames 3112,
>   3114/3115, 3117, 3120, 3123, 3126); the list box is drawn at frame 3128
>   (+18 after the press) and the slide completes at 3129.
> - List box: top-left tile (row 0, col 0), 12 rows x 11 cols (rows 0-11,
>   cols 0-10), the word NAME set into the top border at cols 3-6, rows
>   NEW NAME / RED / ASH / JACK at rows 2/4/6/8 starting at col 2, the cursor
>   `$ED` at col 1 (on NEW NAME when it opens). The dialogue box below keeps
>   showing the question the whole time. DOWN moves the cursor one row per
>   2-frame tap.
> - A on RED (frame 3186): the list is gone by 3188; after ~13 frames the
>   portrait slides back LEFT to columns 6-12 (columns move at frames 3201,
>   3202, 3204/3205, 3208, 3211, 3214, about 3 frames per tile); the
>   acknowledgement box then prints one page (two lines, "Right! So your...")
>   and is readable by frame 3235; A closes it (measured close at 3331 in
>   the probe's own timing) and the rival's portrait stage begins the frame
>   after.
> - NEW NAME (the first row) is what opens the letter grid described in
>   "The naming screen" below; everything measured there about the grid
>   stands, but it is reached only through NEW NAME.
> - The rival's list is the same box with BLUE / GARY / JOHN, opened by the
>   A that closes the last page of "This is my..." (five pages, "name again?"
>   on the last), with the portrait already slid to columns 11-17 when the
>   list is up (probe frame 3885); the acknowledgement is the two-page
>   "That's right! I..." text. The probe's rival half pressed one A too many
>   and landed on the grid, so its exact rival frames were not kept; re-run
>   with a NEW NAME check before each press if they are needed. A renderer
>   can take the player's numbers for both.

**2026-09-07, from the screen agent (`play/screen/IntroScreen.ts` and
`play/screen/CanvasTextBox.ts`'s own pixel test): three more corrections,
load-bearing for anything that renders this intro pixel-for-pixel.** Each
is quoted against the specific recorded file that proves it, the same way
the correction above is.

- **The name-list portrait slide is SIX tile columns, not the five this
  section's own "columns 6-12 to columns 11-17" implies.** The corrected
  probe's own tilemap, `tilemaps/90-player_name_presets.tilemap.json`
  (frame 3171), reads the picture's sequential, column-major `$00`-`$30`
  ids (row 4, the pic's own top row: `$00 $07 $0E $15 $1C $23 $2A`, each
  value exactly 7 more than the last, one per column) at columns **12-18**,
  not 11-17 -- a column-major id inspection is unambiguous where a
  described range can be off by one. Six columns is also what a pixel
  comparison demands: at five, the rendered portrait sits a full tile (8px)
  left of every measured pixel in this beat (`test/intro.pixel.test.mjs`'s
  own "90-player_name_presets" case, 0 diff at six columns).
- **The rival's portrait DOES fade in.** This section's own "Rival portrait
  (beat 27)" above says "no slide and no fade -- `WX` constant... `BGP`
  constant throughout the whole capture window", but `summary.json`'s own
  `rivalStageLog` (111 entries, the same per-frame register log this
  recorder wrote for every stage change) reads `BGP=$00` for its first 50
  entries (frames 3447-3496) then steps `$54` (3497) `$A8` (3507) `$FC`
  (3517) `$F8` (3527) `$F4` (3537) `$E4` (3547 onward) -- the identical
  seven-value ramp Oak's own reveal uses (see "Oak's portrait fade-in"
  above), just with a longer opening hold (50 frames, not Oak's 10) before
  it starts. `tilemaps/27-rival_portrait.tilemap.json` (frame 3557, this
  beat's own settled reference) confirms the ramp's claimed end value,
  reading `BGP=$E4`. A beat 110 frames long with a genuinely flat palette
  would have no reason to be that long rather than however few frames it
  takes to place tiles.
- **The page-advance blink arrow sits at column 18, not column 19.** This
  document's own "OakSpeechText1" section above places it at "column 19";
  `tilemaps/05-oak_speech_text1_p1.tilemap.json` (frame 1913, a page
  already fully typed and ready) reads tile `$EE` (the arrow) at
  `map9C00` row 16, index **18**, with the plain border/side glyph `$7C`
  sitting at index 19 (the box's own right edge, one column further right)
  -- the arrow is the last of the box's 18 text columns (1-18), not the
  column after them.

1. **There is no "NEW NAME / preset list" screen.** (WRONG — see above.) `MapScripts.ts`'s doc
   comment and `oracle.py`'s own naming code (`presets =
   ["RED","ASH","JACK"]`, pick by pressing down N times) both assume a
   vertical list is shown first, with `NEW NAME` as its first row. On this
   ROM, from a completely idle, zero-input observation of the transition
   out of `IntroducePlayerText`/`IntroduceRivalText`, the very next thing
   drawn is the **upper-case letter grid directly** (title `YOUR NAME?` /
   the rival's own `RIVAL's NAME?`) — there is no intervening list, ever,
   confirmed both by a frame-by-frame idle trace and by checking every
   cursor direction from the grid's top-left cell (UP wraps to the
   "lower case" toggle at the bottom; there is nothing above row 0).
   `RED`/`BLUE` are produced instead by moving the grid cursor onto each
   letter and pressing A, then confirming with START (see below).
2. **Confirming a name plays an acknowledgement that is not a
   `show_text` op.** `OAK_SPEECH` goes directly from `name_entry player`
   (op 8) to `intro_stage rival` (op 9) with no text in between, but the
   cartridge shows "Right! So your..." (and, after the rival's
   name, "That's right! I...") first — this
   is the `name_entry` routine's own business on real hardware, exactly
   as the project's comment already frames `name_entry` as an opaque
   host-provided routine. Captured here as `name_confirmed_player`/
   `name_confirmed_rival`.

## Nintendo/GameFreak intro (beat 01)

No input at all — this project's own convention ("pressing only what the
scripted player would press: START/A **at the title**") means nothing is
pressed before the title exists, and this recorder honours that literally:
frames 1-1189 are 100% unattended. There is no separate physical Game Boy
boot-ROM logo here: PyBoy is given no boot ROM file, so tick 1 starts
directly in the cartridge's own code. What plays out, entirely on its own:

- Frames 1-63: LCD off (`LCDC=$00`).
- Frame ~76: VRAM begins being populated while the screen is still off.
- Frame ~142: screen on, copyright text ("©'95.'96.'98 Nintendo" /
  "Creatures inc." / "GAME FREAK inc.", one line each) visible, `BGP=$E4`.
- Frames ~142-1180: a silhouette pair of two creatures animates in
  (dissolve-style, changing almost every frame, with a few multi-frame
  holds — this is the "GAME FREAK presents"-style company logo sequence
  used across this era's Game Freak titles, not the Nidorino cry demo
  later; no species identification is claimed for it).
- Frame 1189: `BGP` starts ramping away from `$E4` (`$90` → `$40` → `$00`
  by frame 1205) — the fade this beat's end frame is named for.
- Frame ~1218: a fully blank hand-off frame (`LCDC` bit 0 briefly off).
- Frames ~1219-1227: title content redraws (`VRAM` tile count climbs from
  0 back toward its final count).
- Frame 1228: tile count reaches its final, constant 279 and stays there
  from here on (the walking-sprite idle loop that follows never changes
  the *count*, only which tiles are used) — this is `title_screen`'s
  start.

## Title screen (beat 02)

Settles (see above) at frame 1228 with the "Pokémon" wordmark and the
walking-creature+player-character pair visible but "Red Version" still
typing in; by frame ~1450 "Red Version" is fully printed (typed
letter-by-letter, the same engine as dialogue text — see below). The
recorder then waits a further fixed 300 frames (a deliberate margin, not
a measured boundary — chosen so the scripted player only acts once
everything has clearly finished) before pressing A for the first time at
frame 1559. `title_screen`'s marked end (1558) is the frame immediately
before that first press. The screen idles indefinitely with no auto-demo
observed in the 2000+ frames checked here (real Pokemon Red's demo mode
needs much longer than this intro ever idles).

## Main menu (beat 03)

Box: top-left tile (row 0, col 0), 6 rows x 15 cols (`┌─────────────┐` is
15 characters). Items "NEW GAME" (row 2) and "OPTION" (row 4); cursor
(`▲`, tile `$ED`) at column 1, defaulting to NEW GAME (no `CONTINUE` row —
a fresh cart's SRAM correctly fails the save checksum). One A press (frame
1695) selects it.

## Oak's portrait fade-in (beat 04)

Tiles are drawn once, statically, by frame ~1701 (measured: the pic
region's own tile ids stop changing that early) — what continues moving
for another ~100 frames is **`BGP` alone**, ramping the already-drawn
picture up from invisible to normal: `$00` → `$54` → `$A8` → `$FC` → `$F8`
→ `$F4` → `$E4`, each held about 10 frames, settling at frame ~1800. The
box border appears (empty) at frame 1810, and the first letter of
`OakSpeechText1` appears at 1813 — `oak_portrait_fadein`'s marked end
(1827) is pinned to where `oak_speech_text1_p1` starts, i.e. the fade and
the box's appearance are treated as contiguous, not gapped.

## OakSpeechText1 (beats 05-09), and the letter/blink measurements

Text ID `_OakSpeechText1` (`MapScripts.ts:455`), quoted to three words:
"Hello there! Welcome...". Five *measured* states (not four — the source
string's page breaks predicted four real pages plus this hard-clear
blank, matching exactly):

| # | frames | content |
|---|---|---|
| p1 | 1827-1913 | first two lines |
| p2 | 1914-1979 | scrolled by one line |
| p3 | 1980-1997 | **blank** — the hard page-break's own clear, before the next page types in |
| p4 | 1998-2091 | new page, first two lines |
| p5 | 2092-2171 | scrolled by one line |

**Dialogue box, measured once and constant for every text box in this
entire intro** (Oak/Nidorino/player/rival dialogue, both name
confirmations, `IntroducePlayerText`, `IntroduceRivalText`,
`OakSpeechText3`): top-left tile (row 12, col 0), 6 rows x 20 cols (full
screen width). Border on rows 12 and 17; the two text lines are rows 14
and 16 (13 and 15 are blank interior padding); each line holds up to 18
characters (columns 1-18).

**Letter timing at MEDIUM (`wOptions`=3, confirmed — this is the
fresh-game default, never touched here)**: exactly **3 frames per
printed character, including spaces** — measured on page 1 character by
character (`H` at frame 1813, each subsequent character exactly 3 frames
later through `!` at 1846; line 2's `W` at 1849, i.e. also +3, no extra
gap for the line break; measured arithmetic: 12 characters x 3 = 36
frames from the empty box at 1810 to `!` complete at 1846, exact). An
apparent "6-frame gap" before some words is not real — it is a typed
space landing on a screen column that already reads as blank padding, so
back-to-back 3-frame steps are indistinguishable from one 6-frame step
until the next visible glyph.

**Page-advance blink arrow** (`▼`, tile `$EE`, screen position row 16,
column 19 — the last column, right of the text): measured with **zero
button presses** across page 1 to get the true free-running cycle (a
scripted press's own timing would otherwise interrupt it): **on for
33-36 frames, off for 36 frames**, repeating (~69-frame period, ~1.15s).
It only starts once a page has fully finished typing; comparisons here
strip it out of page-stability checks specifically because of this blink
(`box_lines()`'s own `.replace("▼", " ")`).

## Nidorino appearing (beat 10) — every frame

Text control byte `{ op: "cry", species: "NIDORINO" }` (`MapScripts.ts:457`)
confirms the species without relying on sprite identification. Measured,
frame by frame (`SCX` stays **0 throughout — it is `WX` alone that
animates**, not SCX; the earlier assumption that SCX might matter did not
hold):

| frame | BGP | WX | note |
|---:|---|---:|---|
| 2173-2219 | `$00` | 7 | blank hold (screen white, Nidorino's tiles not yet placed) |
| 2220 | `$00` | 119 | tiles placed at the far right, still invisible (BGP still blank) |
| 2221 | `$E4` | 119 | palette restored — Nidorino visible, fully right |
| 2222 | `$E4` | 111 | |
| 2223 | `$E4` | 103 | |
| 2224 | `$E4` | 95 | |
| 2225 | `$E4` | 87 | |
| 2226 | `$E4` | 79 | |
| 2227 | `$E4` | 71 | |
| 2228 | `$E4` | 63 | |
| 2229 | `$E4` | 55 | |
| 2230 | `$E4` | 47 | |
| 2231 | `$E4` | 39 | |
| 2232 | `$E4` | 31 | |
| 2233 | `$E4` | 23 | |
| 2234 | `$E4` | 15 | |
| 2235 | `$E4` | 7 | settled — 8px/frame, one full tile column every frame |
| 2236-2237 | `$E4` | 7 | holds |

So: 14 steps of exactly -8px (one tile) each, frame 2222 through 2235,
right to left, 112px total (119-7) in 14 frames. `WY` is 0 throughout
(full-height window); the pic tile-id block itself (`$00`-`$30`) never
changes shape during the slide, only `WX`.

## The cry (beat 11) — could not be confirmed by a sound register

Structurally the cry plays right after the slide settles and before
`OakSpeechText2A`'s box opens (`nidorino_cry_approx` is placed at frame
2238, the frame after the slide's own capture window ends). **This is a
structural placement, not a confirmed detection**: both leads the task
suggested were checked and neither showed a signal here.
- `wChannelSoundIDs` (`$C026`-`$C029`, 4 bytes): read every frame across
  this whole window with `sound_emulated=False` (this recorder's default,
  matching `oracle.py`) — constant `[239,239,239,239]`, no change.
  Re-checked with `sound_emulated=True` — still constant.
- Raw hardware sound registers (`$FF10`-`$FF3F`, all four channels' NRxx
  plus wave RAM), `sound_emulated=True`: **do** change, but continuously
  and regularly (roughly every 14 frames) across the whole window
  including well after the cry should be long over — this reads as the
  intro's own background music ticking, not a distinguishable one-off
  cry burst, so it gives no usable signal either.

Reported honestly: the *timing* (right after the slide, before the next
text) is solid; the *exact frame* is not independently confirmed.

## OakSpeechText2A / 2B (beats 12-22)

IDs `_OakSpeechText2A`/`_OakSpeechText2B` (`MapScripts.ts:458-459`), quoted
"This world is..." / "For some people,...". Measured as one continuous
11-state run (the box never fully closes between 2A and 2B — 2B's own
leading hard-clear is what produces state p4 below), split at the frame
whose content starts "For some people," (2A = p1-p4, 2B = p5-p11):

| # | frames | content | text |
|---|---|---|---|
| 2a_p1 | 2237-2320 | 2 lines | 2A |
| 2a_p2 | 2321-2383 | scrolled | 2A |
| 2a_p3 | 2384-2464 | scrolled | 2A |
| 2a_p4 | 2465-2482 | **blank** (hard clear into 2B) | — |
| 2b_p1 | 2483-2570 | 2 lines | 2B |
| 2b_p2 | 2571-2633 | scrolled | 2B |
| 2b_p3 | 2634-2696 | scrolled | 2B |
| 2b_p4 | 2697-2714 | **blank** | — |
| 2b_p5 | 2715-2748 | "Myself..." (single line, line 2 blank) | 2B |
| 2b_p6 | 2749-2766 | **blank** | — |
| 2b_p7 | 2767-2880 | final 2 lines | 2B |

This exactly matches predicting page breaks from the source strings'
control codes in `Assets/Generated/kanto.json`'s `text` table (`\n` = same
box next line, a mid-string continuation forces a scroll, `\x0c` = hard
clear) — 3 real pages for 2A, 3+1(single-line)+1(final) for 2B, plus one
blank transition frame-range per hard clear.

## Player's portrait slide (beat 23)

Measured: the player's portrait **also slides**, same mechanism as
Nidorino's (`WX` 119→7, `SCX` constant 0, same 8px/frame), not a plain
fade — captured every frame like Nidorino's for that reason. `BGP` here is
a hard `$00`↔`$E4` cut (no multi-step ramp).

## IntroducePlayerText (beat 24)

ID `_IntroducePlayerText` (`MapScripts.ts:461`), quoted "First, what is...".
One page only (fits in 2 lines, no scroll needed).

## The naming screen (beats 25/33) — the grid, reached through NEW NAME

(The recorder's claim that there is no preset list first is wrong; see the
note above "The two corrections". The grid measurements below stand.
Two corrections from the verifier: the cursor rests at **col 1**, one tile
left of `A` at col 2, the same offset as the main menu; and row 11 holds
**nine** symbol slots at the even columns 2-18, ids `$F1 $9A $9B $9C $9D
$9E $9F $E1 $E2`, the last two being the stacked PK/MN ligature tiles.)

Both `YOUR NAME?` (player) and `RIVAL's NAME?` (rival) are the identical
layout, title only differing:

- Title (font text) on row 1.
- A 7-slot name preview on row 3, columns 10-16 (tile `$77` then six
  `$76` — empty-slot placeholders; the name so far prints into these
  slots left to right as it's typed).
- Outer box: top-left tile (row 4, col 0), 11 rows x 20 cols (rows
  4-14), same border tiles as the dialogue box.
- Letters A-I on row 5, J-R on row 7, S-Z on row 9 (rows 6/8/10/12 are
  blank interior padding), columns 2, 4, 6, ... 18 (even columns only —
  odd columns are the cursor's own resting spot immediately to a
  letter's left). Tile ids `$80`-`$99`, A through Z sequential.
- Symbols on row 11 (`× ( ) : ; [ ]`) and row 13
  (`- ? ! ♂ ♀ / ． , ¥`).
- A "lower case"/"UPPER CASE" toggle on row 15, below the box (SELECT
  flips it; confirmed the letter rows relabel to lowercase and the
  toggle's own text flips to "UPPER CASE").
- Cursor tile `$ED`, resting at (row 5, col 2) — on `A` — when the grid
  first opens.

**Cursor movement wraps as one 6-position cycle** (rows 5, 7, 9, 11, 13,
15 in order) — confirmed by pressing UP from row 5 (wraps to row 15, the
case toggle) and UP again from there (wraps to row 13, the bottom symbol
row). There is nothing reachable outside this cycle; in particular
**there is no preset-name list anywhere** (see "corrections" above).

**Typing a preset**: move the cursor onto each letter and press A (each
selection appends to the row-3 preview); **START confirms whatever has
been typed so far, with no minimum length prompt for a partial name** —
confirmed: typing `R`,`E`,`D` (3 presses, well under the 7-slot cap) then
START goes straight into "Right! So your..." with no
intermediate confirmation dialog. `your_name_list`/`rivals_name_list`'s
marked end is the frame before that START press.

### The separate demo: pressing B, and confirming an empty name

Run once, standalone, not part of the main recording above (frames saved
under `state/intro/naming_demo_frames/`, gitignored, not part of the
numbered `frames/` set since this is the one thing the task asked to be
captured *separately*): on the player's fresh grid, cursor still on `A`,
nothing typed —
- **B**: no visible or memory-state effect at all (screen byte-for-byte
  identical for 20 frames after). B does not back out of this screen.
- **START with zero characters typed**: rejected — the screen blanks for
  a moment then redraws the identical grid from scratch (title, box, and
  cursor all reset to the same opening state, confirmed byte-for-byte
  against the grid's first-open frame). The game requires at least one
  character before START will proceed; there is no separate error
  message, just a silent re-prompt.

## Rival portrait (beat 27)

Measured: **no slide and no fade** here — `WX` constant at 7 and `BGP`
constant throughout the whole capture window; the box for
`IntroduceRivalText` is essentially already open by the time this beat's
own capture starts. Contrast with the player's own slide (beat 23) and
Oak's ramp (beat 04): not every `intro_stage` call animates.

## IntroduceRivalText (beat 28-32)

ID `_IntroduceRivalText` (`MapScripts.ts:464`), quoted "This is my...".
Five states, matching the source string's 4-line-then-hard-clear-then-2-line
structure exactly (3 pages + 1 blank + 1 final page):

| # | frames |
|---|---|
| p1 | 3557-3656 |
| p2 | 3657-3719 |
| p3 | 3720-3782 |
| p4 (blank) | 3783-3800 |
| p5 | 3801-3939 |

## Player again + OakSpeechText3 (beats 36-44)

`player_portrait_again` (beat 36): no slide (`WX` constant, matches the
rival's own re-appearance, not the first player slide), but a real
multi-step `BGP` ramp this time — `$00` → `$40` → `$90` → `$E4` — the same
kind of fade Oak's first reveal used, just fewer/different steps, over
~70 frames.

`OakSpeechText3` (ID `_OakSpeechText3`, `MapScripts.ts:467`; quoted, since
the string opens with a `{PLAYER}` template token rather than prose,
"{PLAYER}! Your very..."): **8 measured states**, matching the source
string's two hard-clear segments exactly (a 1-line segment, a 2-scroll
3-page segment, another hard clear, a 2-scroll 3-page segment):

| # | frames | content |
|---|---|---|
| p1 | 4415-4436 | "RED!" alone, line 2 blank |
| p2 | 4437-4454 | **blank** (hard clear) |
| p3 | 4455-4551 | 2 lines |
| p4 | 4552-4614 | scrolled |
| p5 | 4615-4632 | **blank** (hard clear) |
| p6 | 4633-4732 | 2 lines |
| p7 | 4733-4783 | scrolled |
| p8 | 4784-5010 | final 2 lines — **the shrink plays during this page**, see below |

## The shrink (beat 45) — every frame, inside page 8

**Not a palette effect.** `BGP` is a flat `$E4` for this page's entire
226-frame span — found instead by diffing the pic's own pixel rectangle
against its first frame (frames already captured, no need to re-simulate):
the picture is redrawn smaller, tile by tile, while the text box above
it sits completely still. Page 8 runs 150+ frames longer than its own
typing needs (29 characters x 3 frames ≈ 87 frames vs. 226 measured) —
that gap is the shrink playing out after typing finishes and before the
player would normally press again.

Three visually distinct stages, confirmed both by the pic's tile
bounding box and by looking at the PNGs directly:

| stage | frames (relative to shrink start, frame 4875) | pic tile bbox (rows, cols) | look |
|---|---|---|---|
| full sprite, static | 0-54 | (4,10) x (6,12) — full 7x7 | Red's complete "legendary pose" |
| bare outline | ~55-69 | rows collapsing from 10 toward 5 | a blank white silhouette, no interior detail |
| tiny icon | ~70-134 | rows 4 only (a single row) at cols 6-12 | a small generic humanoid glyph, much smaller than the sprite |
| gone | 135 (frame 5010) | none — fully blank | screen shows only the (still open) text box |

(Row range shrinks from 7 tiles to 1; the column range as measured stays
nominally 6-12 because a few edge tiles in that span remain non-blank
even at the smallest stage — the PNGs are the more reliable read on the
true visual size at each stage than the raw bounding box.) The text box
itself is unaffected until frame 5010, when the whole screen — box
included — cuts to blank in the same frame the shrink completes; that
is `shrink`'s own last captured frame and `oak_speech_text3_p8`'s last
frame (5010) is the same frame.

## Fade to white (beat 46) and fade into the bedroom (beat 47)

**Both are hard cuts, not ramps** — unlike Oak's portrait reveal (beat
04) or the player's second appearance (beat 36), which both step `BGP`
through several intermediate values. Measured, every frame:

- Frame 5010 (last shrink/text frame): `BGP=$E4`.
- Frame 5011: `BGP=$00` — **one single frame**, no intermediate value
  ever observed between `$E4` and `$00`.
- Frames 5011-5072 (62 frames total): `BGP` holds at `$00` (pure white)
  continuously. `wCurMap`/`x`/`y` do not change during this window —
  they were already `(38, 3, 6)` from frame 1828 onward (see "final
  state" above); nothing here is a data warp, only a screen redraw
  happening invisibly under the white hold.
- Frame 5073: `BGP=$E4` — again **one single frame**, no ramp.
- Frames 5073-5092+: stable at `$E4`; the bedroom (`REDS_HOUSE_2F`) is
  drawn and already the frame's content by 5073.

(This recorder's own `fade_to_white`/`fade_into_bedroom` beat split at
frame 5012/5013 is an artifact of the settle-detection margin, not a
second real visual event — the true shape is one continuous 62-frame
white hold between two single-frame cuts, as described above. Both
beats' PNG sequences together cover that whole hold, frame for frame.)

## What could not be captured

- **The exact cry frame** — see "The cry" section above. Timing (right
  after the Nidorino slide, before `OakSpeechText2A`) is solid; no sound
  register gave an independently-confirmable exact frame.
- **A byte-level decode of the source text's `\x0b`/`\x0c` control
  codes** — not needed in the end (every page boundary was found by
  directly measuring the screen, which is authoritative), but for
  completeness: this recorder did not reverse-engineer what
  `Assets/Generated/kanto.json`'s text extractor's `\x0b` vs `\x0c`
  bytes individually mean at the ROM level; the *effect* (scroll vs.
  hard clear) was inferred from matching predicted page counts against
  measured ones, which lined up exactly every time it was checked
  (`OakSpeechText1`, `2A`/`2B`, `IntroduceRivalText`, `OakSpeechText3`
  all matched their predicted page counts from the raw string alone).
- **Full identification of every title-screen tile row** — the pic,
  wordmark, and the two short-caption ranges are pinned down; a few
  minor rows (e.g. exactly which glyphs occupy `$41`-$4E`'s copyright
  line character-by-character) were not individually decoded, since
  they are outside the required beats.
