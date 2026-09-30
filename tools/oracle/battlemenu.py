"""The battle menu's geometry, measured in a real wild battle on Route 1.

The grass is rows 6..8 of ROUTE_1 (the lens's own map data says so); walking
into it without a Repel is the only way to reach a battle screen, and the roll
is the cartridge's, so this walks until one happens rather than forcing one.
"""
import os, sys, warnings
warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from oracle import Oracle, W
from menugeom import rects, show

from menugeom import ROM, BUNDLE
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
        print("### battle after %d steps, at %d,%d" % (i + 1, o.state()["x"], o.state()["y"]))
        break
if not found:
    print("### no battle in 120 steps, last cell", o.state()["x"], o.state()["y"])
    o.pb.stop(save=False)
    raise SystemExit(1)

# Through the appearance text to the menu: a press only once a box is up.
for i in range(40):
    o.tick(20)
    found_menu = [r for r in rects(o.tilemap()) if r[1] >= 6 and r[3] <= 8 and r[0] >= 6]
    if found_menu:
        break
    o.press("a", None, 20)
show(o, "the battle menu")
o.press("a", None, 90)
show(o, "the move list")
o.pb.stop(save=False)
