# The shape library: what a tile is shaped like

Written 8 September 2026, overnight, after Joshua's "de route lijkt nog niet op
de referenties en ik mis de 3d look en animaties van de objecten in de map zoals
het gras bomen etc."

`docs/RESEARCH-voxel-mods-and-vr.md` §2.3 is the research this implements and
`docs/RESEARCH-voxel-cost.md` is the measurement that said it was affordable.
This is the design and the numbers it actually produced.

---

## 1. The gap, in one sentence

**We extruded every pixel as its own column; the reference detects structures
and gives each tile TYPE an authored shape.**

That one difference is why our fences were solid walls where theirs are posts
with air between them, why our trees were six-pixel pancakes next to
twenty-four-voxel houses, and why a field of tall grass was a lawn with studs
in it.

## 2. What we could not copy

The reference hand-pins a class per tile in `data/voxel_heights.lua`: ground 0,
water −2, ledge 6, fence 10, sign 12, wall 16, tree 16, roof 28, cliff 32, and
so on in world pixels. That table covers one tileset.

Ours has **24 tilesets and 2,105 tiles**, and every one of them is built at run
time from the player's own cartridge. There is no table to ship and no build
step to write one in. So the class has to be **measured** off the same three
things their table encodes:

1. **Is it part of a measured structure?** Then it is a building, and
   `world/Structures.ts` already folds its elevation upright. This comes first,
   and it has to: see the folded door in §4b.
2. **Is the cell walkable?** Then its art is ground texture seen from above,
   and its ink is blades of grass standing on it.
3. **Otherwise it is one cell tall.** If most of it is BACKGROUND it is a thing
   drawn in front of the ground, so it stands up as a thin cutout of its own
   artwork. If it is solid ink it is a mass.

Everything else falls out of those three questions.

### What a tileset calls air

Not always white. Measured off the walkable tiles of each sheet: **nine of the
twenty-four are not drawn on white** — every Mart and Pokémon Center is on
shade 1, the Ship on shade 2. Reading the Ship's deck as if white were air
would have stood the whole thing on end.

### What "outdoors" means

`tileset.grassTile >= 0`. The tilesets with a wild-encounter grass tile are
exactly OVERWORLD, FOREST and PLATEAU — the same three the baker calls outdoor
— and every interior and cave has none. The question needs no list of ours: it
is one field the ROM already answers.

> A trap worth remembering: an interior's `grassTile` arrives from the bundle
> as `null`, and **`null >= 0` is `true` in JavaScript**. The first version of
> that test made every room in Kanto read as outdoors and turned Oak's counter
> into a bush. `typeof grass === "number"` first.

It decides two things: which two-row masses are hedges, and where props may
stand at all. "Mostly background" reads as "drawn in front of the ground"
because outdoor air is the grass showing through a fence — and a cave has no
air. Its floor is a busy dither whose majority shade is 2, its walls are full
of shade 2 too, so its rock passed the prop test and Seafoam Islands B4F stood
its walls up as thin plates: 39% more geometry and pillars Gen 1 never drew.
The Ship's dock is worse — its walkable tiles are mostly BLACK, so black became
air.

Trying to tell the two apart by how strongly the background dominates does not
work, and the measurement says so plainly: over all 24 tilesets the overworld
is 37% background and a cavern is 40%. So props are outdoors only, which is the
same boundary the reference's own prop table has, and it costs almost nothing —
the rule found 0 props in Red's bedroom and 2 in Oak's lab.

## 3. The classes

| Class | What it is | Height | Where it comes from |
|---|---|---|---|
| `SHAPE_FLAT` | ground, path, floor | 0 | walkable |
| `SHAPE_TUFT` | tall grass | 3 voxels, 1 for the thin half | walkable + a TALL_GRASS tile |
| `SHAPE_CANOPY` | a tree | rings 8 / 6 / 4 / 3 | half the cell is TREE, no water |
| `SHAPE_HEDGE` | a bush | the same rings, painted as foliage | outdoors, two rows, too much ink to be a prop |
| `SHAPE_STANDING` | fence, sign, small prop | its own drawing, up to 8 | one cell tall and mostly background |
| `SHAPE_LIP` | a ledge | 2 voxels | a LEDGE tile, not walkable |
| `SHAPE_MASS` | everything else | as before | the fallback |

A voxel is **two Game Boy pixels**, so these are the reference's world-pixel
classes halved.

### Why a canopy is rings and not a dome

A dome gives all 64 columns of a cell a different height and therefore a side
face on all four of its edges. Rings do not: within a ring the columns are
level and emit nothing, so the cost is the ring boundaries alone. A stepped
hull is also the right answer among voxels, and it is what the reference's
"ronde voxelhull" is a picture of.

### Why a prop's plate folds its own drawing

The first version painted each prop column one colour: the majority of its ink.
For the Pallet Town fence post — tile 14 over tile 85 — that majority is the
black **outline**, so a fence came out as a row of black slabs. Folding the
drawing up the plate's faces instead, exactly the way a building's facade is
folded, gives every voxel the colour the artist put there. That is the
reference's own rule: the sprite is ground truth.

### Why a fence is not a building

A Pallet Town fence is exactly **two tile rows**, so it passes the structure
detector's run test and used to fold into a solid wall with a fence painted on
its south face. `detectStructures` now takes the shape profile and hands props
back. Both sides ask the same function, `isPropCell`, because two answers that
must agree should be one function.

A hedge is the other way round: the detector **keeps** it, because the row
count it measures is the very thing that says "one cell tall". The column
builder takes it back, which is why the shape library runs before the volume
branch rather than after it — and why turning SHAPES off leaves hedges as the
walls they were, with nothing to undo.

## 4a. Three things that were wrong and are not shape questions

Found by putting Route 1 on the table and looking at it. Each one mattered more
than any single class above.

**The ground was a bed of studs.** The relief rule — a pixel lighter than its
tile's usual shade stands a cube proud — was written for obstacles, where it
turns a window outline into a groove and a roof stripe into a tile. On ground
it turned every speck of the dither into a stud: Route 1's verge is tile 44,
whose majority shade is 1, and all **5,232** of its white specks stood up.
Against a carpet like that, nothing else can read as standing. Ground is flat
now, which is the reference's own `ground 0`, and it takes 18,000 quads off
Route 1 because a level cell emits four side faces at its border and none
inside it.

**Route 1 was walled in.** 52 cells of tiles 64/65/80/81 — a dark dither with
no straight edge in it, which is a bush — were measured at two rows and folded
up as walls. They are hulls now, and painted as foliage rather than as masonry:
Gen 1 is four greys, so which category a thing belongs to IS our colour
decision, and those 52 cells were wearing building cream.

**The pond had a wall around it.** A shoreline cell is part water and part
tree, and the hull only asked whether ANY tile of a cell was a tree, so the
shoreline was domed and 192 columns of water were lifted out of their own pond.
A tree needs half the cell and no water in it.

## 4b. Two the sweep found, that no screenshot would have

A rule measured on Route 1 and Pallet Town can be wrong somewhere among the
other 220 maps in a way no picture will ever show. The cheapest thing that
notices is the quad count.

**Seafoam Islands B4F stood its cave walls up** — +39%, described above. Props
are outdoors only now.

**Every doorway in Kanto had a notch punched through it.** A door has to be
walkable, because you step into it, but it is DRAWN in the front wall, so
Structures.ts folds it into the wall above. Moving the shape library above the
volume branch — which the hedge needed — meant "is it walkable" was asked
first, and the doors became flat ground. 192 columns of Cinnabar Lab dropped
from 24 voxels to 0, which is exactly its three doors. The measured building is
asked about first now.

## 5. What it costs

Measured with `tools/voxelview.mjs` and confirmed in the 5.23 preview against
Joshua's own save, which built ROUTE_1 at exactly the number counted here.

| Map | rung | VOXEL | AUTHORED | change |
|---|---|---|---|---|
| PALLET_TOWN | any | 45,533 | 42,008 | **−7.7%** |
| ROUTE_1 | any | 83,683 | 66,877 | **−20.1%** |
| VIRIDIAN_CITY | FIT | 72,079 | 65,841 | −8.7% |
| VIRIDIAN_CITY | ALL | 171,488 | 150,663 | −12.1% |
| VIRIDIAN_FOREST | FIT | 87,420 | 92,231 | **+5.5%** |
| VIRIDIAN_FOREST | ALL | 229,645 | 243,336 | +6.0% |
| REDS_HOUSE_2F | any | 9,516 | 9,480 | −0.4% |
| OAKS_LAB | any | 16,386 | 16,174 | −1.3% |

And over **all 222 maps of Kanto: 12,499,380 → 11,558,007, −7.5%**. Six maps
grow at all — Routes 11, 6 and 12, Viridian Forest, Cinnabar Island and
Vermilion City — every one of them an outdoor map whose tall grass now stands
up, and the worst of them is +19.9%. The worst single chunk anywhere is 4,779
quads against a 16-bit index limit of 16,383. That sweep is a gate: seven
seconds for all of Kanto, both ways, and it is what caught both of the faults
in §4b below.

`RESEARCH-voxel-cost.md` predicted this: 88 to 95 per cent of the vertical
geometry of an outdoor map is STRUCTURE and TREE, so replacing those two with
authored shapes was never going to be a cost. The forest is the one map that
costs more, and it is the one that should — it has no dithered ground to
flatten and its tall grass now stands up in tufts.

## 6. The animations

Neither touches a vertex buffer, because nothing in the material path this
project can rely on across 5.15 and 5.23 can offset a vertex: no graph shader,
no vertex colour, one texture lookup.

**Water.** Gen 1 rotates the water tile's bits every 21 frames so the wave
pattern shifts. A voxel mesh cannot: a column's colour is a UV baked into the
vertex buffer. What CAN move is which colour each shade stands for, and the
pattern is already in the mesh — so turning the water's three ink shades around
a ring trades its crests for its troughs. Shade 0 is held out of the ring: it
is the glints on the surface, and rotating it makes the whole pond flash white.
One 24×24 texture, written about three times a second.

> The animation clock used to tick only inside `updateGameBoyScreen`, so the
> diorama's water was frozen at whatever step the flat screen last left it on —
> step 0 for anyone who never opened the Game Boy view, which is most people.

**Wind.** What can move is a SceneObject, so the blades that move live in their
own small mesh, a child of the chunk, and the ground they stand on does not. A
third of a voxel, on the wall clock rather than the game's, phased off the
chunk's own coordinates so a run of chunks walks through the cycle and the
motion reads as a gust crossing the field rather than one lawn sliding.

A second mesh per chunk is a real cost, so it is bounded by what actually has
grass in it:

| Map | chunks | with grass |
|---|---|---|
| PALLET_TOWN | 25 | 1 |
| ROUTE_1 | 45 | 15 |
| VIRIDIAN_CITY | 90 | 0 |
| VIRIDIAN_FOREST | 108 | 53 |
| REDS_HOUSE_2F | 4 | 0 |

A fence post is decoration that must NOT move, which is why the decor flag is
two bits and not one.

**The reference has no wind at all.** Its world moves because the cartridge's
own tile animations do and because its water is a mirror. This is ours, and it
turns off with SHAPES.

## 7. What is deliberately not done

- **Flowers do not stand up.** The reference gives specific tiles a `relief`
  class of three world pixels by hand. We cannot hand-pin, and the measurement
  that would separate a flower from grass texture does not exist: tile 44,
  which paved Route 1 in studs, has only 4 of its 16 blocks lighter than its
  majority — the same count a flower tile has. Flat is the honest default and
  the flowers are painted on. If they should stand, the answer is a rule that
  identifies flowers, not a threshold that happens to work on Route 1.
- **Trees do not sway.** A crown that translates slides; a crown that bends
  needs a vertex shader, and one authored for 5.23 is not portable to 5.15 —
  `spectacles-522-to-515-migration` is explicit that a tool-built graph can
  import cleanly and still not render. Splitting only a canopy's top ring into
  the sway mesh opens a half-voxel seam at a two-voxel step.
- **Interiors barely change.** Gen 1 draws indoor furniture as solid masses
  rather than as things in front of a background, so the prop test finds almost
  nothing there — 0 cells in Red's bedroom, 2 in Oak's lab. What they did get
  is flat floors. The reference's own interior classes (desk 24 px, bookcase
  32 px) would make furniture TALLER and more in the way, which is the opposite
  of what was asked for on 7 September.

## 8. How to look at it

    node --experimental-strip-types --import ./test/register.mjs \
         tools/voxelview.mjs Assets/Generated/kanto.json ROUTE_1 out.png \
         --tiles 22 --pitch 30 --focus 20,30

`--flat` renders the pixel extrusion this replaced, for a side by side. It
draws the chunk mesh the lens uploads, quad for quad, so what it gets wrong the
glasses would get wrong too. It is a look check, not a gate: there is no
curvature, no edge fade, no passthrough and no shadows in it.

The gate is `test/tileshapes.test.mjs`, which holds every count in this
document.
