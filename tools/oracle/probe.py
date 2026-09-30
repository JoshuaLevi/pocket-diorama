import sys, warnings
warnings.filterwarnings("ignore")
from pyboy import PyBoy
NEW = bytes([0x8D, 0x84, 0x96]); TILEMAP = 0xC3A0
def to_title(pb):
    pb.tick(180, False)
    for i in range(60):
        pb.button_press("start"); pb.tick(2, False); pb.button_release("start"); pb.tick(28, False)
        if any(pb.memory[0x9800 + y*32 + x] >= 0x60 for y in range(18) for x in range(20)): return
def where_new(pb):
    buf = bytes(pb.memory[TILEMAP:TILEMAP + 360])
    if NEW in buf: return ("wTileMap", buf.index(NEW) // 20, buf.index(NEW) % 20)
    for base in (0x9800, 0x9C00):
        for y in range(32):
            row = bytes(pb.memory[base + y*32 : base + y*32 + 32])
            if NEW in row: return (hex(base), y, row.index(NEW))
    return None
for btn in ("a", "start"):
    pb = PyBoy(sys.argv[1], window="null", sound_emulated=False); pb.set_emulation_speed(0)
    to_title(pb); pb.tick(150, False)
    found = None
    for k in range(60):
        pb.button_press(btn); pb.tick(2, False); pb.button_release(btn); pb.tick(8, False)
        hit = where_new(pb)
        if hit: found = (k, hit); break
    print(btn, "taps -> NEW GAME visible:", found, "map", pb.memory[0xD35E])
    pb.stop(save=False)
