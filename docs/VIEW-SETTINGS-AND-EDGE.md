# A view menu, and the edge of the world

Written 7 September 2026. Joshua asked three things: how to render the
buildings as the reference does, how to give the player a menu for the tilt
and the curvature, and what the edge fade is that the reference offers when
curvature is on. The buildings are done and shipped; this covers the other
two, read out of the reference's own source.

## 1. What the reference actually offers

Its settings are a tree, not a list, and the reason is written down. Every
setting used to be spliced into the engine's own OPTIONS list as one block
of fourteen rows, and that widget shows four rows at a time: the block alone
was four screens of scrolling inside a list that already carried twenty
engine rows, and a player looking for one row had to know it was in there.

So one row on the engine's OPTIONS list opens a root screen, and that screen
carries the two rows people touch most, plus three categories:

| Row | Ladder, default first |
|---|---|
| VOXEL | OFF, FULL, 15, 35, 50, 75, first person, third person |
| T-SHIFT | OFF, 1, 2, 3 |
| SHINY ODDS | 1:8192 down to 1:1 |
| 3D WORLD | V-GRID, V-CURVE, RENDER DIST, WATER, DAYTIME |
| BATTLES | 3D-BTL, BACK SPRITES, LET'S GO |
| PERFORMANCE | FOREST FX, SHADOWS, AA |

Four details are worth stealing outright.

**The numbers are camera pitch in degrees, measured off straight down**, eased
over a quarter second. Zero is straight overhead and 75 is nearly level, low
enough to read as a photograph of a model taken from table height.

**FULL is a preset, not an angle.** It writes six other settings at once, and
it is deliberately left OUT of the single-key cycle: a key that changes the
camera should change the camera and nothing else, and landing on a preset
mid-walk would silently rewrite four rows with no indication that a keypress
had done it.

**Ladders, never sliders.** Partly forced -- a row in that engine is a label,
a value string and a step function, with no slider primitive -- but the rungs
are also spaced geometrically rather than evenly, because what a player sees
change between two rungs is an area, and area goes as the square. Even steps
bunch the whole ladder at the near end.

**A row that no longer decides anything disappears** rather than sitting
inert. Their words: a row that can be cycled onto and then does nothing is
indistinguishable from a broken mod, while a row that simply is not there
reads as the mod not offering something, which is the truth. That is also
how the entire 3D WORLD category vanishes under FULL: not a special case,
just nothing left inside to open.

Help is one sentence per row, on SELECT, in a box that never needs
scrolling, because a box you have to scroll is a worse answer to "what does
this do" than a shorter sentence is.

## 2. Curvature, exactly

Six rungs, `0, 0.05, 0.10, 0.18, 0.42, 1.00`, default off. The amount is the
drop one view-height out, so a rung looks the same at any zoom, and because
the drop goes as the square the far edge of visible ground falls four times
that. Their own descriptions: 1 is a hint of roll at the frame edges, 2 is
the Animal Crossing read, 3 is as far as it goes before the horizon closes
inside the next block of the town, 4 is the geometric step to 5, and 5 is a
half sphere -- derived, not eyeballed, from the fact that the parabola
osculating a sphere at its pole is the square over twice the radius.

It is one line in a vertex shader, along Y only, so a column moves as one
piece: the world tips away and the buildings standing on it stay upright.
Not a fisheye, and not a single resampled pixel.

Ours already bakes the same quadratic into the mesh, with a five-rung table
that lands close to theirs. Two corrections worth making: theirs has a rung
at 0.05 below our lowest, and their top rung is derived from the half-sphere
rather than picked.

## 3. The edge fade, and what it is in AR

It is not one effect but two rows working together, and the reason it looks
better with curvature on is that **curvature is what switches the soft rim
on**.

RENDER DIST decides how much world is drawn. The boundary is then a
world-space volume test per fragment, and its rim is hard while the world is
flat and a dissolve as soon as the curve is on at any rung. Their reasoning:
flat, the hard edge IS the sides, and a slab of Kanto with edges is most of
what makes the model-on-a-table read; bent, a hard edge across a curved world
is a lie about what is being looked at. The rim is sixteen per cent of the
shorter half-extent.

The important part for us is one line of theirs: the rim is written as an
ALPHA, so the last of the model blends into whatever the frame opened with.
On a flat screen that is the painted sky; in their mixed-reality mode they
swap the sky for chroma green and change no shader code at all.

**On see-through glasses, alpha going to zero is a fade to the real room.**
The abstraction carries over exactly, and we need no substitute for a sky
because the sky was only ever whatever the frame was cleared to.

Three consequences for this lens.

**Take the round cut, not the rectangle.** A hard rectangular edge earns its
keep on a flat screen because the model is photographed from one side. A
tabletop object is walked around, and its corner seams will show the first
time the wearer moves. The VR build reached the same conclusion for the same
reason.

**Then run curvature ON by default.** The mod's own FULL preset turns it off,
but only because it fights a fixed framing, and in AR there is no fixed
framing. The half sphere at the top rung is designed so the model's rim is
that sphere's equator: a dome, ending where the model ends, which is exactly
the silhouette a physical object on a table wants.

**Add the one thing neither of their builds needed: a soft floor.** Both cuts
are deliberately unbounded downward so trees keep their tops. On a screen an
infinitely tall column is invisible because the frame crops it; on a table a
wearer looking from below sees it run on through the tabletop.

How to build the rim without a shader: our material path is an image preset
sampling a palette texture, and a graph shader does not survive the 5.15
downgrade, so a per-fragment cut is not available. Two routes that are:

- **Geometric taper.** Round the built window and step the outer band's
  columns down into the earth over a few tiles, so the slab rolls off into
  its own base instead of ending in a wall. Costs nothing, works on both
  runtimes, and with the curve on it reads as the dissolve does.
- **Alpha through the palette.** The palette texture is sixteen by sixteen
  and we use about forty texels of it. Adding two or three dimmer, more
  transparent copies of every entry and pointing the outer ring's quads at
  them buys a real alpha ramp with no shader change. It needs the terrain
  material to stop writing depth in that ring, which is the part to test.

Start with the taper.

## 3b. What was actually built, 20 September

The taper, and not as a ROW: there is no EDGE setting, because the world is
flat and square by the decision of 9 September and the square's own sides are
what a hand takes hold of. The rim is simply how the world ends now, on every
map, indoors and out.

Three things, all in `world/ViewClip.ts` (`rimQuads`), reached from
`VoxelTerrain.emitChunk` for every chunk that touches the edge of the view --
which, when the view is the whole map, is every chunk at the map's border too.

**The slope.** Half a tile out and half a tile down at 45 degrees, then the
brown side drops to the plinth's floor and an underside closes it. That is the
reference's own diorama edge, read off its clip: "een schuin afgesneden
aardplak met bruine zijkanten".

It slopes OUTSIDE the world rather than eating a tile of it. Cutting the slope
from the last tile of ground would sink whatever stands on it, and at a map's
edge that tile is walkable -- a ditch round the rim of Red's bedroom. Half a
tile is 1.75 cm on a 70 cm plate and DioramaGrab's band reaches 35 per cent of
the half-span past the plate, so the handle did not move.

**The cut is a cross-section.** Where the view saws through the map, the face
wears the colour of what was cut, not earth. A desk sliced by the rim used to
stand on a mud pillar its own height, which is the "leeg object aan de rand"
of the fifth playtest's screenshot.

**The slab has corners.** The earth carries the eight brightness bands now
(sixteen texels where there were two), so the rim's four sides catch different
light -- the same fix, on the same grounds, as the one that stopped a building
reading as a printed card. Its dither goes by TILE on the rim: a one-voxel
checker on a face a metre long at table scale is corduroy.

It costs nothing. The slope and the side are emitted per RUN of columns that
agree rather than per column, and the worst map at each zoom rung comes out
7334 / 13232 / 23738 / 47106 quads against 7366 / 13262 / 23812 / 47086 before.

**And the cast was hidden off the wrong rectangle.** `cullNpcsToWindow` asked
whether the ground under a body was BUILT (`surfaceY`), which stopped meaning
"can the wearer see it" on 11 September: the terrain builds a cover wider than
the view and cuts the view out of it, so anyone standing up to two tiles past
the plate passed the test and stood in mid-air beside the model. That is the
other half of "lege objecten aan de rand", and it was visible in the preview
the moment the rim itself stopped being the thing the eye caught.
`VoxelTerrain.coversPoint` has answered the right question since that day and
nothing called it; the cull and the LEAF measure both do now.

`tools/voxelview.mjs --play N --yaw D` draws it from a laptop, cut and rimmed
exactly as the lens does.

## 4. The menu for this lens

We already have the right widget. The boot OPTION screen draws the
cartridge's own rows on the Game Boy canvas, and PLAY MODE was added to it
in the same style on 6 September. The reference's tree exists because its
widget shows four rows; ours shows more, so one extra screen is enough.

Proposed, as a VIEW row on the OPTION screen that opens its own page:

| Row | Ladder | Note |
|---|---|---|
| VIEW | FLAT, TILTED 15, 35, 50, 75 | the diorama's own tilt, for a wearer who is sitting; the head is still the real angle |
| CURVE | OFF, 1, 2, 3, 4, 5 | six rungs, matching theirs, including the 0.05 they have and we do not |
| EDGE | HARD, SOFT | hard is the slab with sides, soft is the tapered rim; forced to soft while CURVE is on, and then the row disappears |
| WORLD | FIT, WIDE, WIDER, WIDEST, ALL | how much is built, the existing render distance |
| ZOOM | the existing centimetres a tile | already on O and P in the preview and on a pinch on the glasses |

And a FULL row that writes the lot at once, kept out of any single-key cycle
for the reason theirs is.

Reachable twice: on the boot OPTION screen before the world exists, and
in-game through START, which is where a wearer will actually want it. The
in-game OPTION screen does not exist yet and is the prerequisite.

One thing not to copy: their tilt ladder exists because a flat screen has one
viewpoint the player cannot move. Ours has a wearer who leans over the table.
The row is worth having for someone sitting still, but it should not be the
first row, and FLAT should be its default.
