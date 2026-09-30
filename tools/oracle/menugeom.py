"""Where the cartridge puts its menu windows, in tiles.

    tools/oracle/.venv/bin/python tools/oracle/menugeom.py \
        [after-rival] tools/oracle/scenarios/menus/start-menu.json

Not a compare: nothing in the lens draws these yet. This is the measurement
the drawing will be built against, and it is a separate tool because the
question is geometry, not state -- see docs/MENUS.md for what it found.

screen_text() cannot answer this: a ligature ('s) is one tile and two
characters, so a column counted in the decoded string is not a column on the
screen. This reads the raw wTileMap and finds the border tiles themselves --
$79 top-left, $7A horizontal, $7B top-right, $7C vertical, $7D bottom-left,
$7E bottom-right -- so every rect below is measured, not eyeballed.
"""
import json, os, sys, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle import Oracle

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ROM = os.environ.get("CARTRIDGE_ROM",
                     os.path.expanduser("~/Downloads/Pokemon - Red Version (USA, Europe).gb"))
BUNDLE = os.path.join(ROOT, "Pokemon-AR", "Assets", "Generated", "kanto.json")
if not os.path.exists(BUNDLE):
    BUNDLE = os.path.join(os.path.dirname(HERE), "..", "Assets", "Generated", "kanto.json")
TL, HZ, TR, VT, BL, BR = 0x79, 0x7A, 0x7B, 0x7C, 0x7D, 0x7E

def rects(tm):
    out = []
    for y in range(18):
        for x in range(20):
            if tm[y][x] != TL:
                continue
            w = 0
            while x + w + 1 < 20 and tm[y][x + w + 1] == HZ:
                w += 1
            if x + w + 1 >= 20 or tm[y][x + w + 1] != TR:
                continue
            h = 0
            while y + h + 1 < 18 and tm[y + h + 1][x] == VT:
                h += 1
            if y + h + 1 >= 18 or tm[y + h + 1][x] != BL:
                continue
            out.append((x, y, w + 2, h + 2))
    return out

def show(o, tag):
    tm = o.tilemap()
    print("### " + tag)
    for r in rects(tm):
        print("    rect tx=%d ty=%d tw=%d th=%d" % r)
    # Every non-blank run of text, with its true tile column.
    for y in range(18):
        run, start = "", None
        line = []
        for x in range(20):
            t = tm[y][x]
            ch = o.charmap.get(t) if t >= 0x60 else None
            if ch == "　":
                ch = " "
            if not isinstance(ch, str) or ch.startswith("<") or ch == " " or t in (TL, HZ, TR, VT, BL, BR):
                if run:
                    line.append("c%d:%r" % (start, run))
                run, start = "", None
                continue
            if start is None:
                start = x
            run += ch
        if run:
            line.append("c%d:%r" % (start, run))
        if line:
            print("    row %2d  %s" % (y, "  ".join(line)))
    sys.stdout.flush()

if __name__ == "__main__":
    o = Oracle(ROM, BUNDLE)
    o.boot("RED", "BLUE")
    start = sys.argv[1] if len(sys.argv) > 1 else ""
    if start:
        o.load_start(start, "RED", "BLUE")
        o.no_wild = True
    script = json.load(open(sys.argv[2]))
    for step in script:
        if "press" in step:
            o.press(step["press"], None, step.get("settle", 60))
        elif "walk" in step:
            o.walk(step["walk"], step.get("n", 1))
        elif "face" in step:
            o.face(step["face"])
        else:
            o.tick(step.get("wait", 30))
        if step.get("tag"):
            show(o, step["tag"])
    o.pb.stop(save=False)
