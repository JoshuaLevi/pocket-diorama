"""The battle HUD's geometry, measured on the cartridge in a real wild battle.

Our lens drew NO battle HUD at all -- no names, no levels, no HP bars -- which
is what the 7 September glasses recording shows: two sprites, a text box, and
nothing that says a Pokemon battle is happening. The reference mod floats the
cartridge's own HUD blocks as panels, so before anything can be floated we have
to know exactly what the cartridge draws and where.

Guessing the coordinates from memory is how the menu work went wrong the first
time, so this reads the real screen: wTileMap during a battle, both decoded
through the font charmap (names, levels, numbers) and raw (HP bar tiles, box
borders, which are NOT font tiles and decode as nothing).

Reuses battlemenu.py's route into a battle -- Route 1's grass, rows 6..8 -- and
its rule that the encounter is the cartridge's own roll rather than a forced
one.

  tools/oracle/.venv/bin/python tools/oracle/battlehud.py
"""
import os, sys, warnings
warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from oracle import Oracle, W
from menugeom import rects, ROM, BUNDLE, TL, HZ, TR, VT, BL, BR

BORDERS = (TL, HZ, TR, VT, BL, BR)


def ruler():
    print("        " + "".join(str(x % 10) for x in range(20)))


def decoded(o, tm):
    """The screen as characters, one cell per tile, with its true column."""
    out = []
    for y in range(18):
        line = ""
        for x in range(20):
            t = tm[y][x]
            if t in BORDERS:
                line += "#"
                continue
            ch = o.charmap.get(t) if t >= 0x60 else None
            if ch == "　":
                ch = " "
            if isinstance(ch, str) and not ch.startswith("<") and len(ch) == 1:
                line += ch
            else:
                line += "." if t == 0x7F else "?"
        out.append(line)
    return out


def raw_block(tm, x0, y0, w, h, tag):
    print("### raw tiles, %s (tx=%d ty=%d tw=%d th=%d)" % (tag, x0, y0, w, h))
    for y in range(y0, min(18, y0 + h)):
        print("    ty=%2d  %s" % (y, " ".join("%02X" % tm[y][x]
                                              for x in range(x0, min(20, x0 + w)))))


def dump(o, tag):
    tm = o.tilemap()
    print("\n### " + tag)
    print("### boxes the border tiles themselves describe:")
    for r in rects(tm):
        print("    rect tx=%d ty=%d tw=%d th=%d" % r)
    print("### the screen, one character per tile (# border, . blank, ? non-font):")
    ruler()
    for y, line in enumerate(decoded(o, tm)):
        print("    ty=%2d %s" % (y, line))
    # The two HUD blocks, raw. The HP bar is drawn from tiles that are not in
    # the font at all, so only the raw ids say where it starts and how long it
    # is -- which is the number this whole probe exists to produce.
    raw_block(tm, 0, 0, 12, 5, "top-left quadrant (the enemy's HUD)")
    raw_block(tm, 8, 6, 12, 6, "lower-right quadrant (your own HUD)")


o = Oracle(ROM, BUNDLE)
o.boot("RED", "BLUE")
o.load_start("after-rival", "RED", "BLUE")
o.run([{"walk": "down", "n": 5}, {"wait": 90},
       {"walk": "left", "n": 3}, {"walk": "up", "n": 10}, {"walk": "right", "n": 1},
       {"walk": "up", "n": 1}, {"walk": "up", "n": 1}, {"wait": 60},
       {"walk": "up", "n": 3}, {"walk": "left", "n": 1}, {"walk": "up", "n": 4}, {"wait": 30},
       {"walk": "up", "n": 5}, {"walk": "left", "n": 2}, {"walk": "up", "n": 4},
       {"walk": "right", "n": 4}, {"walk": "up", "n": 4}, {"walk": "left", "n": 3},
       {"walk": "up", "n": 6}, {"walk": "right", "n": 5}])
st = o.state()
print("### at", st["map"], st["x"], st["y"])

found = False
for i in range(120):
    o.walk("up" if (i // 8) % 2 == 0 else "down", 1)
    if o.mem(W["wIsInBattle"]) != 0:
        found = True
        print("### battle after %d steps" % (i + 1))
        break
if not found:
    print("### no battle in 120 steps")
    o.pb.stop(save=False)
    raise SystemExit(1)

# Let the appearance animation and its text settle, WITHOUT pressing anything:
# the HUD is on screen well before the menu is, and a press would page past it.
o.tick(240)
dump(o, "the battle screen, before any press")

# Then through the text to the menu, where both HUDs and the four options are
# all on screen at once -- the frame the reference floats as panels.
for i in range(40):
    o.tick(20)
    if [r for r in rects(o.tilemap()) if r[1] >= 6 and r[3] <= 8 and r[0] >= 6]:
        break
    o.press("a", None, 20)
dump(o, "the battle menu open")

# What the bar tiles MEAN: fight a turn and watch which cells change. Guessing
# that $6B is "full" and $6C is "empty" would be a guess; this is the cartridge
# telling us. Row ty=2 is the enemy's bar, ty=9 is your own (measured above).
def bars(o):
    tm = o.tilemap()
    return ("enemy ty=2 tx1..10 " + " ".join("%02X" % tm[2][x] for x in range(1, 11)) +
            "  |  yours ty=9 tx10..18 " + " ".join("%02X" % tm[9][x] for x in range(10, 19)))

print("\n### the bars, as a fight goes on")
print("    start   " + bars(o))
for turn in range(6):
    # FIGHT, then the first move, then let the turn play out.
    o.press("a", None, 30)
    o.press("a", None, 30)
    for _ in range(14):
        o.tick(30)
        o.press("a", None, 10)
    print("    turn %d %s" % (turn + 1, bars(o)))
    if o.mem(W["wIsInBattle"]) == 0:
        print("    (battle over)")
        break
o.pb.stop(save=False)
