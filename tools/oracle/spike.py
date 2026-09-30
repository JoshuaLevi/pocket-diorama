import sys, time
from pyboy import PyBoy
ROM = sys.argv[1]
pb = PyBoy(ROM, window="null", sound_emulated=False)
pb.set_emulation_speed(0)
W = {"wCurMap":0xD35E, "wYCoord":0xD361, "wXCoord":0xD362, "wPartyCount":0xD163,
     "wPlayerName":0xD158, "wRivalName":0xD34A, "wPlayerMoney":0xD347, "wObtainedBadges":0xD356,
     "wNumBagItems":0xD31D}
def mem(a): return pb.memory[a]
def state():
    return {k: mem(v) for k, v in W.items()}
def press(btn, hold=2, wait=6):
    pb.button_press(btn); pb.tick(hold, False); pb.button_release(btn); pb.tick(wait, False)
t0=time.time()
pb.tick(60*4, False)               # copyright + Game Freak intro start
print("after 4s", state())
for i in range(6):                 # skip intro / reach title / menu
    press("start", 2, 30)
print("after starts", state())
for i in range(3):
    press("a", 2, 30)              # NEW GAME (first item when no save) -> Oak speech begins
print("after a's", state())
# hammer A through Oak's speech (name defaults: first preset via A on NEW NAME? no: A on presets menu picks NEW NAME -> grid)
for i in range(400):
    press("a", 2, 4)
print("after 400 A", state(), "frames/s", int(pb.frame_count/(time.time()-t0)))
# read the name bytes
print("player name bytes", [mem(0xD158+i) for i in range(8)])
pb.stop(save=False)
