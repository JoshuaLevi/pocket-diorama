# The purple, and why the buildings are mounds

Written 7 September 2026, after Joshua played the start town and asked what
the purple squares are and whether the buildings render correctly. Short
answer: the purple is the path tile in a colour we invented, and the
buildings are not modelled at all. Both come from the same root cause, and
the reference solves both the same way.

## 1. The purple is the path tile

It is tile 57 of the OVERWORLD tileset, the only tile there our extractor
classifies as `PATH`. In Pallet Town it is the paved apron in front of each
house and the small squares scattered over the lawn; both are really in the
map. The map data itself is not in doubt: the oracle compares our screen
against PyBoy's on four maps, Pallet included, at zero differing pixels.

The colour comes from `TILE_PALETTES` in
`Assets/Scripts/rom/BundleFromExtraction.ts`, a hand-authored table of
thirteen categories whose header records `#6e46b4` as the path, "sampled
from the reference footage rather than chosen". The sample was taken from a
real frame: at 75 seconds the reference shows a violet road running through
green grass between fence posts, and rendering our own Route 1 top-down puts
a violet road in the same place.

So on a route the colour happens to land. In a town it does not, and the
reason is that **the reference has no colour table at all.**

## 2. The reference never decides a colour

Reading the mod's source settles it. Its vertex format carries position, a
texture coordinate and one scalar shade, with no colour channel, and the
fragment shader is a single multiply: a texel of the tileset atlas times the
face shade times the sun times the time of day. Every visible colour in that
world is a pixel of the cartridge's own tile art.

Which palette recolours that art is decided per map, and in the best path
per tile graphic: a full-colour atlas where one exists, otherwise the raw
four-shade art remapped through that map's own four colours. The same path
tile is therefore violet on a route and something else in a town, because
the map says so.

A search of all 170 source files finds no table anywhere mapping a terrain
category to a colour. The only literal colours in the whole mod are the sky
ramp, the day and night gradient, two particle effects and a menu cursor.
Its rule is written down twice: every visible voxel colour is a real texel
of the drawing, and the only thing geometry may invent is the surfaces the
sprite implies but never paints.

We do the opposite: one global table for the whole cartridge, keyed by what
a tile IS rather than by the map it sits in. That is why Pallet's aprons and
Route 1's road are the same violet when the cartridge would not have them so.

## 3. The buildings are not modelled

A house in our renderer is not a box. `buildColumnField` gives every
2x2-pixel block its own height from a four-line guess in `tileBase`: a
walkable cell is 0, water is -1, a tree is 3, an obstacle whose four
neighbours are also obstacles is 5, anything else is 2, and then a pixel
lighter than its tile's usual shade stands one cube higher.

Dumping the height field for Pallet Town shows what that produces across a
house, in voxels, where `.` is 1 and `*` is 6:

```
:...............========....
:..:::::::::::::++++++++::::
:...............========....
:---...:-::-:...*++**++*:...
```

No flat roof, no vertical wall, no eave. A lumpy field between one and six
voxels, which is exactly the grey mound with stripes on the screen.

The reference builds shapes instead, and its heights are **measured off the
drawing**:

- Terrain is one height per 8x8 tile, not per pixel. A tile column is one
  prism carrying one tile of art on its top and eight-pixel bands of art up
  its sides.
- A wall's height is how tall the thing is actually drawn: flood-fill the
  connected non-walkable region, walk each column's vertical run upward,
  and if the run's tiles repeat, take the repeat period rather than the
  extent. That single rule is what stops a forty-row border forest becoming
  one monolith and lets a six-row house be a six-row house.
- The region then votes: the modal height wins, so a house is one clean mass
  instead of a stepped mound.
- The top two rows split off as a pitched roof only when those two rows
  DIFFER. Gen 1 draws a pitched roof with distinct ridge and eaves rows and
  a flat rooftop as one repeated texture, and tilting a rooftop reads wrong
  at once.
- The fold: side band k of a column shows the tile k rows NORTH of the
  structure's front. The flat map's northward rows are read as elevation.
  That is the whole trick.
- Anything drawn face-on that is not a wall becomes a standing cutout, not a
  box, and background is decided not by whiteness but by which white
  connects to walkable ground in the assembled scene.

Only after all of that does hand-authored data appear, and only as
overrides: about 1360 tile pins and 59 whole-building templates that fix
cases the detector reads wrong.

## 4. What to change here, in order

**First, delete the thirteen-category palette and sample the tile atlas.**
This is the largest gap and the cheapest fix, and it needs nothing but the
ROM. We already build that atlas: GAME BOY mode paints the flat screen from
it every frame. Give a column's top face the atlas rect of its tile and its
side faces the rect of the tile some rows north, and the path stops being
purple the moment it lands, with grass, water and roofs all becoming correct
for free in every palette. Then apply the reference's own face shades: top
1.00, a folded facade's south face 1.00 and an ordinary south face 0.90,
east 0.84, other sides 0.78, west 0.72, north 0.68, underside 0.55.

**Second, replace the height guess with drawn-extent measurement.** Resolve
at 16x16 cell granularity rather than per tile, because collision in this
engine is per cell and judged by the cell's bottom-left tile alone; that one
change stops flowers becoming pillars. Then flood-fill, measure the run,
respect the repeat period, vote per region, and split the roof only when the
top rows differ. All of it is derivable from the tile map, the walkable
list, the water list and the tile art.

**Third, stand props up as cutouts instead of extruding them into boxes.**
Fence rows become posts and plants become plants.

The reference's own height vocabulary is thirty lines long and worth copying
whatever else we do: water sits at -2 so a shoreline shows a lip, ground and
void at 0, relief 3, a ledge 6, a bed 7, stools and counters 8, a fence 10,
tables and signs 12, walls and trees and stairs 16, a desk 24, a roof 28,
cliffs and planters 32, all in world pixels against a 16-pixel cell.
