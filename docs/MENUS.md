# Where the cartridge puts its menus

Measured on a real Pokemon Red cartridge in PyBoy, 7 September, with
`tools/oracle/menugeom.py`. It reads the raw `wTileMap` and finds the border
tiles themselves -- `$79` top-left, `$7A` horizontal, `$7B` top-right, `$7C`
vertical, `$7D` bottom-left, `$7E` bottom-right -- so every rect below is
measured rather than eyeballed. `screen_text()` cannot answer this question: a
ligature (`'s`, `'t`) is one tile and two characters, so a column counted in
the decoded string is not a column on the screen.

    tools/oracle/.venv/bin/python tools/oracle/menugeom.py \
        after-rival tools/oracle/scenarios/menus/start-menu.json

Nothing in the lens draws these yet. The lens's menus are glyph panels
(`play/script/GlyphPanel.ts`) with no frame at all, which is SPEC section 10's
"the menu panel has no frame". This file is the measurement that a
cartridge-faithful menu box will be built against, so the work does not start
with a guess.

## The rule the boxes follow

Coordinates are tiles; the screen is 20 x 18. In every menu measured, the
cursor sits one column inside the border and the label two:

| | |
|---|---|
| cursor column | `tx + 1` |
| label column | `tx + 2` |
| row step | 2 rows per entry |

The FIRST row is **not** a constant offset from the box -- pokered sets
`wTopMenuItemY` per menu and draws the border separately -- so it is measured
per menu below.

## Measured

| Menu | Box `tx,ty,tw,th` | First row | Notes |
|---|---|---|---|
| START menu (6 entries) | `10,0,10,14` | 2 | `th = 2n + 2`; POKeMON / ITEM / RED / SAVE / OPTION / EXIT |
| Item PC menu (4 entries) | `0,0,16,10` | 2 | `th = 2n + 2`; WITHDRAW ITEM / DEPOSIT ITEM / TOSS ITEM / LOG OFF |
| PC top menu (3 entries) | `0,0,16,8` | 2 | SOMEONE's PC / <PLAYER>'s PC / LOG OFF |
| PC box menu (5 entries) | `0,0,14,12` | 2 | WITHDRAW / DEPOSIT / RELEASE / CHANGE BOX / SEE YA! |
| Item list (bag, and the PC's) | `4,2,16,11` | 4 | A FIXED rect, not fitted: four entries visible and it scrolls |
| Quantity window | `15,9,5,3` | 10 | The `x01` sits at column 16 |
| YES/NO | `14,7,6,5` | 8 | Already drawn: `screen/CanvasChoiceBox.ts` |
| Party submenu | `11,11,9,7` | 12 | STATS / SWITCH / CANCEL -- first row is `ty + 1`, not `ty + 2` |
| Message box | `0,12,20,6` | 14 | Already drawn: `screen/CanvasTextBox.ts` |
| Battle menu | `8,12,12,6` | 14 | A 2 x 2 GRID, not a list -- see below |
| Battle move list | `0,12,20,6` | 13 | Rows are ONE apart here, not two -- see below |
| Move type/PP window | `0,8,11,5` | 9 | Beside the move list |

## What an item list actually looks like

Not one row per item. The name is on the entry's row and the count is on the
row BELOW it, pushed right:

```
row 4   c5:'>POTION'
row 5              c14:'x'  c16:'1'
row 6   c6:'CANCEL'
```

So a list entry occupies both of its two rows, and the count is right-aligned
at columns 14-17 of the standard `4,2,16,11` list box. The lens's own
controllers (`ShopController`, `PcController`) format a row as one string with
the count appended, which is the flat-panel shape, not this one.

## The battle menu is a 2 x 2 grid, and the move list is not

Measured in a real wild battle with `tools/oracle/battlemenu.py`, which walks
Route 1's grass rows (6..8, from the lens's own map data) without a Repel until
the cartridge rolls an encounter of its own.

The battle menu's box is `8,12,12,6`, and the four entries are a GRID, not a
list -- which the lens's `MenuController` does not model; it offers a vertical
list of four:

| | column 10 | column 16 |
|---|---|---|
| **row 14** | FIGHT | PKMN |
| **row 16** | ITEM | RUN |

The cursor sits at column 9 for the left entry and column 15 for the right.
(`PKMN` does not appear in a decoded dump: it is the two ligature tiles the
charmap renders as `<PK>` and `<MN>`, which the probe skips along with every
other multi-character sequence.)

The **move list** breaks the two-rows-an-entry rule that every other menu
follows. It is drawn in the standard message box `0,12,20,6`, with the four
moves on rows 13, 14, 15 and 16 -- **one row apart** -- the cursor at column 5
and the labels at column 6. The PP and type of the highlighted move go in a
window of their own above it, `0,8,11,5`: `TYPE/` on row 9, the type on row 10,
the PP on row 11.

## Not measured yet

- The party screen and the bag screen themselves (both are whole screens with
  HP bars and their own layout, not row lists in a box).
- The trainer card: `0,0,20,8` and `1,10,18,8` are its two rects, and the badge
  row is drawn from the card's own tile sheet, not from the font.
- The Poke Mart's BUY / SELL / QUIT box and its stock list. Reaching one from
  `after-rival` is not as short as it looks: the Viridian clerk holds OAK's
  PARCEL open, so a talk from `(2,5)` across the counter only ever repeats
  "Okay! Say hi to PROF.OAK for me!" and never opens the till. The parcel has
  to be delivered to Oak in Pallet first, which is the whole walk back.
