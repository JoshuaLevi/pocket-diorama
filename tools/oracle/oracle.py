#!/usr/bin/env python3
"""The cartridge itself, as an oracle.

PyBoy runs the player's own ROM headless at a few hundred times real speed.
This wraps it in the vocabulary the lens's headless harness speaks -- boot,
walk, face, press, wait, state -- so a scenario can be run on both and the
two states diffed. Where they disagree, the ROM is right by definition.

    .venv/bin/python oracle.py <rom.gb> <bundle.json> boot
    .venv/bin/python oracle.py <rom.gb> <bundle.json> run scenario.json
    .venv/bin/python oracle.py <rom.gb> <bundle.json> prepare after-rival|after-brock

`run` prints one JSON object per action with the state after it; `prepare`
plays a shared start (README.md, "Shared starts") and saves it. WRAM
addresses are pokered's (US Red/Blue); the ones that matter are checked at
boot: a fresh game must stand at REDS_HOUSE_2F (3,6) with the names it chose.
"""
import json
import os
import struct
import subprocess
import sys
import warnings
import zlib

warnings.filterwarnings("ignore")
from pyboy import PyBoy  # noqa: E402
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
STATE_DIR = os.path.join(HERE, "state")

# PyBoy's plain DMG greys, light to dark, measured off a rendered overworld
# frame (screen.ndarray): reading a title/overworld frame's distinct colours
# gave exactly these four, in this order -- tools/oracle, GAME BOY mode pass.
# This is NOT the same table the lens's own DMG_GREYS constant uses (170 vs
# 153 for shade 1): screen_shades() maps PyBoy's own RGB back to a shade
# INDEX, which is what compare.mjs --screens diffs, so the two tables never
# need to agree.
DMG_SHADE_RGB = [(255, 255, 255), (153, 153, 153), (85, 85, 85), (0, 0, 0)]
_SHADE_BY_RGB = {rgb: i for i, rgb in enumerate(DMG_SHADE_RGB)}

# pokered wram.asm, US Red/Blue.
W = {
    "wCurMap": 0xD35E, "wYCoord": 0xD361, "wXCoord": 0xD362,
    "wPlayerName": 0xD158, "wRivalName": 0xD34A,
    "wPartyCount": 0xD163, "wPartySpecies": 0xD164, "wPartyMons": 0xD16B,
    "wPlayerMoney": 0xD347, "wObtainedBadges": 0xD356,
    "wNumBagItems": 0xD31D, "wBagItems": 0xD31E,
    "wEventFlags": 0xD747, "wIsInBattle": 0xD057,
    # The player sprite's facing (wSpritePlayerStateData1FacingDirection):
    # 0 down, 4 up, 8 left, 12 right. wPlayerDirection is the last pad mask.
    "wPlayerFacing": 0xC109,
    "wJoyIgnore": 0xCD6B, "wTileMap": 0xC3A0, "wWalkCounter": 0xCFC5,
    "wRepelRemainingSteps": 0xD0DB,
    # The battle copy of the Pokemon that is out (battle_struct: species, HP,
    # ..., four moves at +8, ..., four PP bytes at +25) and the enemy's HP.
    "wBattleMonMoves": 0xD01C, "wBattleMonPP": 0xD02D, "wBattleMonHP": 0xD015,
    "wEnemyMonHP": 0xCFE6,
    # Where a whiteout returns to, and the two 19-byte Pokedex bitfields.
    "wLastBlackoutMap": 0xD719, "wPokedexOwned": 0xD2F7, "wPokedexSeen": 0xD30A,
    # The last outside map warped away from: what a LAST_MAP warp means.
    "wLastMap": 0xD365,
}
EVENT_FLAG_BYTES = 0x140
PARTY_MON_BYTES = 44
# party_struct offsets (pokered macros/wram.asm): moves, experience, the five
# stat-experience words, the two DV bytes, the four PP bytes, level, max HP.
PARTY_MOVES, PARTY_EXP, PARTY_STAT_EXP, PARTY_DVS, PARTY_PP, PARTY_LEVEL, PARTY_MAX_HP = 8, 0x0E, 0x11, 0x1B, 0x1D, 0x21, 0x22
# The filled menu cursor, $ED in the cartridge's charmap. Measured in a wild
# battle on Route 1 (tools/oracle, 12 sep): the battle menu is MENUS.md's 2x2
# box with this tile at (9,14) FIGHT, (9,16) ITEM, (15,14) PKMN, (15,16) RUN,
# and the move list has it at column 5 of rows 13..16. WRAM agrees while a
# menu is up -- the battle menu is wTopMenuItemY $0E / wTopMenuItemX $09 /
# wMaxMenuItem 1, the move list wTopMenuItemY $0C / wCurrentMenuItem row+1 --
# but the move list's bytes are exactly the resting values between menus and
# are left behind when it closes, so the screen is what decides.
CURSOR_TILE = 0xED
# Item bytes the bundle does not carry: HM01..HM05 are $C4..$C8 and TM01..TM50
# are $C9..$FA (pokered constants/item_constants.asm). Measured: byte 234 in
# the bag after Brock's TM34 (tools/oracle, 12 sep, prepare after-brock).
HM_BASE_BYTE = 0xC3
TM_BASE_BYTE = 0xC8
FACING = {0: "down", 4: "up", 8: "left", 12: "right"}
NAME_END = 0x50
FRAMES_PER_STEP = 16
BUTTON_HOLD_FRAMES = 6
# Measured (tools/oracle, GAME BOY mode pass 2), not a label from any published
# disassembly: cycles 0..7 once every 21 frames and alone determines both the
# water tile's own column rotation and which of the three flower frames shows
# (Assets/Scripts/play/screen/OverworldCanvas.ts's WATER_ROTATION_BY_PHASE /
# FLOWER_FRAME_BY_PHASE tables). The task brief's hMovingBGTilesCounter1/2
# guess (0xFF97/0xFF98) never moved in a 500-frame HRAM watch at Pallet
# Town's pond; this WRAM byte did, in lockstep with both animations.
TILE_ANIM_COUNTER = 0xD085
# Sprite state data: 0xC100+i*16 is slot i's OWN state (facing at +9, the same
# byte wPlayerFacing reads at i=0); 0xC200+i*16 is its "on the map" state
# (still_sprites() already reads +6 there). Slot i, for i 1..15, is the i-th
# object in the CURRENT map's own list (1-based, matching MapObject.index) --
# the player is slot 0, and an empty slot's movement byte (mem(+6) at 0xC200)
# reads 0. Y/X sit at +4/+5, off by a fixed +4 border. Measured tools/oracle,
# GAME BOY mode pass 2 against three STAY npcs at their exact shipped cell and
# facing (Reds House's Mom, Pallet Town's Oak) and two WALK ones (the girl,
# already wandered off her shipped cell by boot; the fisher, still on his).
SPRITE_STATE1 = 0xC100
SPRITE_STATE2 = 0xC200


class Oracle:
    def __init__(self, rom, bundle_path):
        self.pb = PyBoy(rom, window="null", sound_emulated=False)
        self.pb.set_emulation_speed(0)
        bundle = json.load(open(bundle_path))
        self.map_names = bundle["mapOrder"]
        # For sprite_positions(): which object (name, 1-based slot index) sits
        # on each map, so a live sprite slot can be matched back to a name.
        self.map_objects = {
            mid: [{"index": o["index"], "name": o["name"]} for o in mdef.get("objects", [])]
            for mid, mdef in bundle.get("maps", {}).items()
        }
        species = bundle["species"]
        self.species_by_index = {species[k]["index"]: k for k in species}
        # Several entries share a code (the reference's charmap carries kana
        # aliases). Keep the plain single-character one per code, first seen.
        self.charmap = {}
        for e in bundle["font"]["charmap"]:
            code, seq = e["code"], e["seq"]
            # Plain: printable text, including the 's / 't / 'r ligatures the
            # cartridge writes as one code, but not a <TAG> and not a kana.
            plain = (isinstance(seq, str) and len(seq) > 0 and not seq.startswith("<")
                     and all(ord(ch) < 0x3040 or ord(ch) > 0x30FF for ch in seq))
            if code not in self.charmap or (plain and not self.charmap[code][1]):
                self.charmap[code] = (seq, plain)
        self.charmap = {k: v[0] for k, v in self.charmap.items()}
        # The bundle carries no numeric id for an item -- BundleFromExtraction
        # drops it as ROM provenance the lens itself never needs -- but wBagItems
        # is the raw byte, so the oracle has to rebuild the mapping. buildItems()
        # numbers the regular catalog 1..N in ROM order before appending HM_*/
        # TM_* entries (which "carry no index": their own byte is a separate,
        # derived range, not a continuation of this count), and JSON object order
        # preserves that -- so counting the non-machine entries in bundle order
        # reproduces the same numbering without the field ever being emitted.
        # Measured: byte 70 from a fresh OAK's PARCEL pickup lines up with the
        # 70th such entry (tools/oracle, 6 sep). An HM/TM byte still falls back
        # to its decimal string below; nothing here claims to resolve those.
        items = bundle.get("items", {})
        self.item_by_index = {}
        seq = 0
        for k, v in items.items():
            if isinstance(v, dict) and not v.get("machine"):
                seq += 1
                self.item_by_index[seq] = k
            elif isinstance(v, dict):
                machine = v["machine"]
                base = HM_BASE_BYTE if machine.get("kind") == "HM" else TM_BASE_BYTE
                self.item_by_index[base + int(machine.get("number", 0))] = k
        # Moves by their ROM index, for the party's move slots.
        self.move_by_index = {m["index"]: k for k, m in bundle.get("moves", {}).items()
                              if isinstance(m, dict) and "index" in m}
        self.bundle_path = bundle_path

    # ------------------------------------------------------------ primitives
    def mem(self, addr):
        return self.pb.memory[addr]

    def still_sprites(self):
        """Pin every wandering NPC on the current map: movement byte 1 $FE
        (walk) becomes $FF (stay) in each live sprite slot. The lens's
        wanderers are switched off alongside, so a route past a strolling
        youngster compares."""
        for i in range(1, 16):
            slot = 0xC200 + i * 16
            if self.mem(slot + 6) == 0xFE:
                self.pb.memory[slot + 6] = 0xFF

    def sprite_positions(self):
        """Every NPC on the CURRENT map, cell and facing, read straight off
        the ROM's own sprite slots -- not the shipped x/y the bundle carries,
        because a WALK npc's own boot-time RNG usually has it somewhere else
        by the time a scenario's first action runs (PLAYTEST.md's "GAME BOY
        mode" section: `stillNpcs` only pins an npc from where THIS reads it,
        not back to its shipped cell). See SPRITE_STATE1/SPRITE_STATE2 above
        for the offsets and how they were measured."""
        cur = self.mem(W["wCurMap"])
        map_id = self.map_names[cur] if cur < len(self.map_names) else None
        out = []
        for obj in self.map_objects.get(map_id, []):
            i = obj["index"]
            if i < 1 or i > 15:
                continue
            y = self.mem(SPRITE_STATE2 + i * 16 + 4) - 4
            x = self.mem(SPRITE_STATE2 + i * 16 + 5) - 4
            facing = FACING.get(self.mem(SPRITE_STATE1 + i * 16 + 9) & 0x0C, "down")
            out.append({"name": obj["name"], "x": x, "y": y, "facing": facing})
        return out

    def tick(self, frames):
        if getattr(self, "still_npcs", False):
            self.still_sprites()
        # render=False is the default: memory reads (the whole of the rest of
        # this file) don't need a frame rendered, and skipping it is most of
        # why PyBoy runs "a few hundred times real speed" here. `want_screens`
        # (GAME BOY mode's --screens pass) renders every tick instead, so the
        # exposed screen.ndarray is never stale when screen_shades() reads it
        # -- measured: with no render=True tick ever having run, the ndarray
        # sits at its all-white construction default, not the frame the CPU
        # state describes.
        self.pb.tick(frames, getattr(self, "want_screens", False))

    def press(self, button, hold=None, settle=4):
        # A direction is a two-frame tap: the third frame is a step. A button
        # needs longer: in a room full of sprites the overworld loop runs at
        # 30 fps and hJoyPressed misses a two-frame press between two of its
        # reads -- measured in Oak's lab, where one short A at a Poke Ball
        # did nothing for ten seconds and a longer one opened the choice.
        if hold is None:
            # Inside a text box the engine polls every frame, and a longer A
            # would still be down when the box closes and read a sign twice
            # (measured: seven readings of the town sign). Long presses are
            # for the overworld only.
            direction = button in ("up", "down", "left", "right")
            hold = 2 if (direction or self.box_lines() is not None) else BUTTON_HOLD_FRAMES
        self.pb.button_press(button)
        self.tick(hold)
        self.pb.button_release(button)
        self.tick(settle)

    def hold(self, button, frames):
        self.pb.button_press(button)
        self.tick(frames)
        self.pb.button_release(button)

    def screen_text(self):
        """pokered's own screen buffer (wTileMap, 20x18) as text.

        Font tiles ARE their character codes there. It is read instead of VRAM
        because the buffer is written the frame a menu is drawn while VRAM
        follows a VBlank or two behind, and because the title screen writes
        VRAM directly and would decode as katakana.
        """
        rows = []
        for y in range(18):
            line = ""
            for x in range(20):
                t = self.mem(W["wTileMap"] + y * 20 + x)
                seq = self.charmap.get(t) if t >= 0x60 else None
                # The blank tile $7F decodes as an ideographic space in the
                # reference's charmap; "NEW GAME" has an ordinary one in it.
                if seq == "\u3000":
                    seq = " "
                # A ligature ('s, 'r) is one tile and two characters; the
                # line grows by two, which is what the text says.
                line += seq if isinstance(seq, str) and not seq.startswith("<") else " "
            rows.append(line.rstrip())
        return rows

    def screen_has(self, text):
        return any(text in row for row in self.screen_text())

    def tilemap(self):
        """wTileMap raw, 20x18 -- the RAW tile ids the background shows, not
        decoded through the font charmap. The cheapest way to learn which
        world tile draws where: measured against the bundle's own block/tile
        math, byte for byte, in REDS_HOUSE_2F and Pallet Town (tools/oracle,
        GAME BOY mode pass)."""
        return [[self.mem(W["wTileMap"] + y * 20 + x) for x in range(20)] for y in range(18)]

    def screen_shades(self):
        """The current frame as a 144x160 grid of DMG shade indices 0..3,
        light to dark -- what OverworldCanvas.paintOverworld's GbCanvas holds,
        so this is compared against it pixel for pixel. Requires the last
        tick() to have rendered (see `want_screens`); an unrendered frame is
        blank white and would falsely read as all-shade-0."""
        rgb = self.pb.screen.ndarray[:, :, :3]
        out = np.zeros((144, 160), dtype=np.uint8)
        matched = np.zeros((144, 160), dtype=bool)
        for shade, colour in enumerate(DMG_SHADE_RGB):
            mask = np.all(rgb == colour, axis=2)
            out[mask] = shade
            matched |= mask
        if not matched.all():
            y, x = np.argwhere(~matched)[0]
            raise ValueError(
                "screen_shades: not a plain DMG colour %r at (%d,%d) -- %d pixel(s) affected"
                % (tuple(int(c) for c in rgb[y, x]), int(x), int(y), int((~matched).sum()))
            )
        return out.tolist()

    def screen_settled(self, max_extra=4):
        """screen_shades(), but only once the FRAME BUFFER has caught up to a
        game state that is already stable -- not merely another `settle()`.

        Measured (tools/oracle, GAME BOY mode pass 3): right at the instant
        `settle()`'s own (map,x,y) stability check first passes, PyBoy's
        `screen.ndarray` can still show a render from before the true rest
        state -- while every other reachable signal (OAM, sprite state
        bytes, SCX/SCY, BGP/OBP0/OBP1, and the background tile bytes
        themselves) already reads its final, unchanging value at that exact
        instant. Pallet Town's fisher, pinned by `stillNpcs` over the
        fence/flower-bed tile, reproduced this every time: `screen_shades()`
        called twice in a row with no tick between gave the SAME (wrong)
        frame, proving it was not a fluke read -- but one more rendered
        tick(1) always replaced it with the frame every other signal already
        predicted, and it never changed again afterwards. Separately, the
        cartridge's OWN redraw of the animated water/flower tile can lag its
        WRAM counter (TILE_ANIM_COUNTER) by exactly one frame too (measured:
        the flower tile shows the PREVIOUS phase's frame for the first frame
        after the counter increments, then the correct one for the rest of
        that ~21-frame window) -- a second, independent source of the same
        symptom. Both are caught the same way: keep ticking one frame at a
        time until two consecutive `screen_shades()` reads agree, which is
        what "the frame buffer has caught up" means operationally. A plain
        settled overworld frame has nothing left to animate faster than once
        every 21 frames, so this always terminates in 1-2 extra ticks in
        practice; `max_extra` is a safety cap, not a tuned constant -- if it
        is ever hit, the last (possibly still-transitional) read is returned
        rather than looping forever.
        """
        current = self.screen_shades()
        for _ in range(max_extra):
            self.tick(1)
            next_frame = self.screen_shades()
            if next_frame == current:
                return next_frame
            current = next_frame
        return current

    def save_screen_png(self, path):
        """The current frame as an RGBA PNG, hand-rolled (the venv carries no
        Pillow): scanlines with filter-none, zlib-deflated, three chunks.
        Debugging only -- callers write these under state/screens/, gitignored,
        never anywhere a ROM-derived pixel could leave the machine."""
        arr = self.pb.screen.ndarray
        height, width = arr.shape[0], arr.shape[1]
        raw = bytearray()
        for y in range(height):
            raw.append(0)
            raw.extend(arr[y, :, :4].tobytes())
        compressed = zlib.compress(bytes(raw), 9)

        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
        with open(path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n")
            f.write(chunk(b"IHDR", ihdr))
            f.write(chunk(b"IDAT", compressed))
            f.write(chunk(b"IEND", b""))

    def wait_for_text(self, text, max_frames=600, step=4):
        waited = 0
        while waited < max_frames:
            if self.screen_has(text):
                return True
            self.tick(step)
            waited += step
        return False

    def name_at(self, addr):
        out = ""
        for i in range(11):
            b = self.mem(addr + i)
            if b == NAME_END:
                break
            seq = self.charmap.get(b, "?")
            out += seq if isinstance(seq, str) else "?"
        return out

    def bcd(self, addr, count):
        v = 0
        for i in range(count):
            b = self.mem(addr + i)
            v = v * 100 + (b >> 4) * 10 + (b & 15)
        return v

    # ---------------------------------------------------------------- state
    def state(self):
        party = []
        count = self.mem(W["wPartyCount"])
        for i in range(min(count, 6)):
            base = W["wPartyMons"] + i * PARTY_MON_BYTES
            species = self.mem(base)
            hp = (self.mem(base + 1) << 8) | self.mem(base + 2)
            level = self.mem(base + 33)
            max_hp = (self.mem(base + 34) << 8) | self.mem(base + 35)
            party.append({"species": self.species_by_index.get(species, str(species)),
                          "level": level, "hp": hp, "maxHp": max_hp})
        flags = []
        for i in range(EVENT_FLAG_BYTES * 8):
            if self.mem(W["wEventFlags"] + (i >> 3)) & (1 << (i & 7)):
                flags.append(i)
        bag = []
        n = self.mem(W["wNumBagItems"])
        for i in range(min(n, 20)):
            item = self.mem(W["wBagItems"] + i * 2)
            qty = self.mem(W["wBagItems"] + i * 2 + 1)
            bag.append([self.item_by_index.get(item, str(item)), qty])
        cur = self.mem(W["wCurMap"])
        return {
            "map": self.map_names[cur] if cur < len(self.map_names) else str(cur),
            "x": self.mem(W["wXCoord"]), "y": self.mem(W["wYCoord"]),
            "facing": FACING.get(self.mem(W["wPlayerFacing"]) & 0x0C, "?"),
            "player": self.name_at(W["wPlayerName"]), "rival": self.name_at(W["wRivalName"]),
            "party": party, "money": self.bcd(W["wPlayerMoney"], 3),
            "badges": bin(self.mem(W["wObtainedBadges"])).count("1"),
            "bag": bag, "eventFlags": flags,
            "inBattle": self.mem(W["wIsInBattle"]),
            "textBox": self.screen_has("┌") or self.screen_has("└"),
            "screen": [r for r in self.screen_text() if r.strip()],
            "frame": self.pb.frame_count,
        }

    # ------------------------------------------------------------------ boot
    def boot(self, player="RED", rival="BLUE"):
        """Power on, through the title and Oak's speech, picking preset names."""
        fresh = os.path.join(STATE_DIR, "fresh-%s-%s.state" % (player, rival))
        if os.path.exists(fresh):
            with open(fresh, "rb") as f:
                self.pb.load_state(f)
            return self.state()
        self.tick(60 * 3)
        # The copyright screen ignores input and the Game Freak intro takes a
        # START to skip; VRAM stays empty until the title's logo lands.
        for _ in range(60):
            self.press("start", 2, 28)
            if any(self.mem(0x9800 + y * 32 + x) >= 0x60 for y in range(18) for x in range(20)):
                break
        self.tick(150)
        # Measured, not understood: a single press on the settled title blanks
        # the screen and the menu never draws, while tapping every ten frames
        # brings it up after about five seconds. So tap until it is there.
        for _ in range(200):
            # Two frames on purpose: the six-frame overworld press is still
            # down when the next menu opens and selects its first entry --
            # that is how a regenerated fresh state once named RED "AAAAAAA".
            self.press("a", 2, 8)
            if self.screen_has("NEW GAME"):
                break
        assert self.screen_has("NEW GAME"), "no main menu: %r" % self.screen_text()
        self.press("a", 2, 30)
        # Oak's speech: A through pages; at each naming menu, pick a preset.
        for who, name in (("player", player), ("rival", rival)):
            for _ in range(200):
                if self.screen_has("NEW NAME"):
                    break
                self.press("a", 2, 8)
            assert self.screen_has("NEW NAME"), "no naming menu for %s: %r" % (who, self.screen_text())
            presets = ["RED", "ASH", "JACK"] if who == "player" else ["BLUE", "GARY", "JOHN"]
            for _ in range(1 + presets.index(name)):
                self.press("down", 2, 6)
            self.press("a", 2, 30)
        # NEW GAME writes the map long before Oak has finished talking, so the
        # end of the speech is "no text box for a while", not the map.
        # The speech pauses for its pictures -- the shrink alone is a few
        # seconds with no box -- so "quiet" means five seconds of no box.
        # A is pressed only while a box is up: once Red stands in his room an
        # idle A would read the SNES, and the speech would never look over.
        quiet = 0
        bedroom = self.map_names.index("REDS_HOUSE_2F")
        for _ in range(3000):
            if self.screen_has("\u250c"):
                self.press("a", 2, 6)
                quiet = 0
            else:
                self.tick(8)
                quiet += 1
                if self.mem(W["wCurMap"]) == bedroom and quiet >= 40:
                    break
        self.tick(90)
        st = self.state()
        assert st["map"] == "REDS_HOUSE_2F" and not st["textBox"], st
        assert st["player"] == player and st["rival"] == rival, "boot named %s/%s, wanted %s/%s" % (st["player"], st["rival"], player, rival)
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(fresh, "wb") as f:
            self.pb.save_state(f)
        return st

    # --------------------------------------------------------------- actions
    def walk(self, direction, tiles):
        """Hold a direction until `tiles` steps have landed, the way a thumb
        does and the way the headless lens counts them.

        A fixed 16 frames a step let go of the pad a frame early whenever
        the walk began with a turn, and CheckWarpsNoCollision reads the pad
        on the landing frame: a mat at the end of a walk then took the
        player out on one machine and not the other. Measured: releasing
        the moment wWalkCounter reaches zero warps off a mat and never
        starts a step too many; two frames later it does.
        """
        # Steps are counted as wWalkCounter going live, not as coordinate
        # changes: a warp moves the coordinates without a step, and the lens
        # counts steps. The pad stays down until the last step's counter has
        # run out, then lets go before the next frame's read.
        self.pb.button_press(direction)
        started = 0
        walking = self.mem(W["wWalkCounter"]) != 0
        for _ in range(FRAMES_PER_STEP * tiles + 60):
            self.tick(1)
            now = self.mem(W["wWalkCounter"]) != 0
            if now and not walking:
                started += 1
            walking = now
            if started >= tiles and not walking:
                break
        self.pb.button_release(direction)
        self.settle()

    def settle(self, max_frames=360):
        """Wait until map and cell have been still for a second: a door warp
        fades, reports the new map before the new coordinates, and then walks
        the player one step out of the doorway on its own."""
        last = None
        same = 0
        waited = 0
        while waited < max_frames:
            self.tick(8)
            waited += 8
            now = (self.mem(W["wCurMap"]), self.mem(W["wXCoord"]), self.mem(W["wYCoord"]))
            same = same + 1 if now == last else 0
            last = now
            if same >= 8:
                return

    def face(self, direction):
        # Two frames: one joypad read, never two. The cartridge turns on the
        # first read and STEPS on the next if the pad is still down, so a
        # four-frame tap walked a cell -- which a whole playtest round
        # reported as "the ROM moves the player after talking".
        #
        # Facing that way already, a tap is not a turn but a step (on both
        # machines), so it does nothing here: `face` means turn.
        facing = {0: "down", 4: "up", 8: "left", 12: "right"}[self.mem(W["wPlayerFacing"]) & 0x0C]
        if facing == direction:
            self.tick(12)
            return
        self.press(direction, 2, 12)

    def dex_page(self):
        """The Pokedex data screen: a name at the top right, no text box."""
        rows = self.screen_text()
        if any("\u250c" in r for r in rows):
            return False
        name = rows[2][9:].strip() if len(rows) > 2 else ""
        return len(name) >= 3 and all(c.isalpha() or c in " .'-\u2642\u2640" for c in name)

    def box_lines(self):
        """The two text lines of an open box (rows 14 and 16), or None."""
        rows = self.screen_text()
        if not any("\u250c" in r for r in rows):
            return None
        strip = lambda r: r.replace("\u2502", " ").replace("\u25bc", " ").strip()
        return [strip(rows[14]) if len(rows) > 14 else "", strip(rows[16]) if len(rows) > 16 else ""]

    def talk(self, max_pages=40):
        """A press of A, then every line it produces, in order.

        The box scrolls: line two becomes line one and a new line prints
        below, so what is collected is the stream of distinct lines, not
        pages. A page read mid-print is superseded by the same page read
        stable, so a line is added only when the box has stopped changing.
        """
        lines_out = []
        self.press("a", None, 8)
        for _ in range(max_pages):
            # Wait for a box, up to a second (a script may walk first).
            waited = 0
            while self.box_lines() is None and waited < 90:
                if self.dex_page():
                    # A Pokedex data page (the starter balls open one before
                    # they ask): press through it, page by page, without
                    # reading it -- the lens has no such page yet
                    # (FINDINGS: open).
                    self.tick(30)
                    self.press("a", None, 8)
                    waited = 0
                    continue
                self.tick(6)
                waited += 6
            lines = self.box_lines()
            if lines is None:
                break
            # Let the page finish printing: stable for 12 frames.
            stable = 0
            last = lines
            for _ in range(60):
                self.tick(4)
                now = self.box_lines()
                if now == last:
                    stable += 1
                    if stable >= 3:
                        break
                else:
                    stable = 0
                    last = now
            if last is None:
                break
            for line in last:
                if line and line not in lines_out[-2:]:
                    lines_out.append(line)
            self.press("a", None, 8)
        self.settle(120)
        return lines_out

    # ------------------------------------------------------- shared starts
    def load_start(self, name, player="RED", rival="BLUE"):
        """A prepared state past a point the fresh game cannot compare across
        (the rival battle is RNG). Made by `prepare <name>`."""
        path = os.path.join(STATE_DIR, "%s-%s-%s.state" % (name, player, rival))
        if not os.path.exists(path):
            raise SystemExit("no prepared state %s; run: oracle.py <rom> <bundle> prepare %s" % (path, name))
        with open(path, "rb") as f:
            self.pb.load_state(f)
        return self.state()

    def party_detail(self):
        """Every party Pokemon as the lens copy needs it: level, HP and
        experience, plus the moves with their PP, the DVs and the stat
        experience -- everything the stat formula takes, so a copy at the same
        level can have the same max HP and not merely the same species."""
        out = []
        for i in range(min(self.mem(W["wPartyCount"]), 6)):
            base = W["wPartyMons"] + i * PARTY_MON_BYTES
            dv_ad, dv_ss = self.mem(base + PARTY_DVS), self.mem(base + PARTY_DVS + 1)
            stat_exp = [(self.mem(base + PARTY_STAT_EXP + 2 * k) << 8) | self.mem(base + PARTY_STAT_EXP + 2 * k + 1)
                        for k in range(5)]
            moves = []
            for k in range(4):
                move = self.mem(base + PARTY_MOVES + k)
                if move:
                    # The top two bits of a PP byte count PP Ups.
                    moves.append({"id": self.move_by_index.get(move, str(move)), "pp": self.mem(base + PARTY_PP + k) & 0x3F})
            out.append({
                "species": self.species_by_index.get(self.mem(base), str(self.mem(base))),
                "level": self.mem(base + PARTY_LEVEL),
                "hp": (self.mem(base + 1) << 8) | self.mem(base + 2),
                "maxHp": (self.mem(base + PARTY_MAX_HP) << 8) | self.mem(base + PARTY_MAX_HP + 1),
                "exp": (self.mem(base + PARTY_EXP) << 16) | (self.mem(base + PARTY_EXP + 1) << 8) | self.mem(base + PARTY_EXP + 2),
                "status": self.mem(base + 4),
                "moves": moves,
                "dvs": {"attack": dv_ad >> 4, "defense": dv_ad & 15, "speed": dv_ss >> 4, "special": dv_ss & 15},
                "statExp": dict(zip(("hp", "attack", "defense", "speed", "special"), stat_exp)),
            })
        return out

    def dex_lists(self):
        """The Pokedex numbers marked seen and owned, from the two bitfields."""
        def numbers(addr):
            out = []
            for i in range(151):
                if self.mem(addr + (i >> 3)) & (1 << (i & 7)):
                    out.append(i + 1)
            return out
        return numbers(W["wPokedexSeen"]), numbers(W["wPokedexOwned"])

    # --------------------------------------------------------------- battles
    def battle_menu_cursor(self):
        """The battle menu's entry under the cursor -- FIGHT, ITEM, PKMN or RUN
        -- or None while the menu is not up. See CURSOR_TILE for the measurement;
        PKMN itself never decodes (two ligature tiles), so the box is recognised
        by FIGHT on row 14 and RUN on row 16."""
        rows = self.screen_text()
        if "FIGHT" not in rows[14] or "RUN" not in rows[16]:
            return None
        tm = self.tilemap()
        for name, (x, y) in (("FIGHT", (9, 14)), ("ITEM", (9, 16)), ("PKMN", (15, 14)), ("RUN", (15, 16))):
            if tm[y][x] == CURSOR_TILE:
                return name
        return None

    def move_list_cursor(self):
        """The move list's cursor row, 0..3, or None while the list is not up:
        its TYPE/PP window sits at row 9 and its cursor at column 5."""
        rows = self.screen_text()
        if "TYPE/" not in rows[9]:
            return None
        tm = self.tilemap()
        for i in range(4):
            if tm[13 + i][5] == CURSOR_TILE:
                return i
        return None

    def battle_moves(self):
        """The four move slots of the Pokemon that is out, (move id, PP left)."""
        return [(self.move_by_index.get(self.mem(W["wBattleMonMoves"] + i)), self.mem(W["wBattleMonPP"] + i) & 0x3F)
                for i in range(4)]

    def wanted_slot(self, move):
        """The slot to pick for `move` (an id such as VINE_WHIP, or a 0-based
        slot): that one while it has PP, else the first slot that has any."""
        slots = self.battle_moves()
        want = None
        if isinstance(move, int):
            want = move if 0 <= move < 4 else None
        elif move:
            for i, (mid, _) in enumerate(slots):
                if mid == move:
                    want = i
        if want is None or slots[want][0] is None or slots[want][1] == 0:
            want = 0
            for i, (mid, pp) in enumerate(slots):
                if mid is not None and pp > 0:
                    want = i
                    break
        return want

    def fight(self, move=None, max_frames=60000):
        """Plays the battle that is up through to its end, choosing `move`
        whenever the cartridge offers the move list and A otherwise.

        Every pass reads the screen: the move list up means steer the cursor
        to the wanted slot one press at a time (re-read after each, since the
        list opens on the move used last turn, not on the first) and press A;
        the battle menu up means A on FIGHT (the cursor is moved back there if
        it is anywhere else) and then WAIT for the list to draw before doing
        anything -- an A thrown in between would land on the list at whatever
        slot it remembers. Anything else -- a page, an animation, a level-up
        box -- takes a two-frame A, which a page ignores until it is ready.
        A move that is offered with no PP left, or a Pokemon that has to
        forget a move for a new one, is not handled: the loop would pick the
        first slot and the cartridge's own choice respectively, and neither
        arises before level 20 on the roads this drives.

        Returns {"won", "turns", "frames"}; won is "out of battle on the
        same map" -- a whiteout heals the party on its way to the last
        Center, so HP cannot tell a loss, but the map can.
        """
        frames = 0
        turns = 0
        map_before = self.mem(W["wCurMap"])
        while self.mem(W["wIsInBattle"]) != 0 and frames < max_frames:
            cursor = self.move_list_cursor()
            if cursor is not None:
                want = self.wanted_slot(move)
                if cursor != want:
                    self.press("down" if cursor < want else "up", 2, 8)
                    frames += 10
                    continue
                self.press("a", 2, 8)
                frames += 10
                turns += 1
                continue
            menu = self.battle_menu_cursor()
            if menu is not None:
                if menu != "FIGHT":
                    self.press("left" if menu in ("PKMN", "RUN") else "up", 2, 8)
                    frames += 10
                    continue
                self.press("a", 2, 4)
                frames += 6
                for _ in range(20):
                    if self.move_list_cursor() is not None:
                        break
                    self.tick(4)
                    frames += 4
                continue
            self.press("a", 2, 20)
            frames += 22
        won = self.mem(W["wIsInBattle"]) == 0 and self.mem(W["wCurMap"]) == map_before
        return {"won": won, "turns": turns, "frames": frames}

    def after_landing(self, move=None, max_frames=6000):
        """Whatever a landing set off, seen through: a trainer's approach (the
        pad ignored while he walks), his page, the battle itself, his last
        page; a wild battle; nothing at all. Returns the battles fought."""
        fought = 0
        frames = 0
        while frames < max_frames:
            if self.mem(W["wIsInBattle"]) != 0:
                self.fight(move)
                fought += 1
                frames += 30
            elif self.box_lines() is not None:
                self.press("a", 2, 20)
                frames += 22
            elif self.mem(W["wJoyIgnore"]) != 0:
                self.tick(10)
                frames += 10
            else:
                return fought
        return fought

    # ----------------------------------------------------------------- roads
    def here(self):
        cur = self.mem(W["wCurMap"])
        return (self.map_names[cur] if cur < len(self.map_names) else str(cur),
                self.mem(W["wXCoord"]), self.mem(W["wYCoord"]))

    def plan_road(self, to_map, to_x, to_y, options=None):
        """road.mjs from the cell the player stands on to (to_map, to_x, to_y):
        the lens's own map data, walked by both machines. Returns the
        planner's {actions, ends} or raises when there is no road."""
        map_id, x, y = self.here()
        # Inside a gate or a forest the planner cannot tell which outside
        # map LAST_MAP means; the cartridge's own wLastMap can.
        last = self.mem(W["wLastMap"])
        last_map = self.map_names[last] if last < len(self.map_names) else ""
        args = ["node", "--experimental-strip-types", "--import", os.path.join(ROOT, "test", "register.mjs"),
                os.path.join(HERE, "road.mjs"), self.bundle_path, map_id, "%d,%d" % (x, y), to_map, "%d,%d" % (to_x, to_y),
                json.dumps(dict(options or {}, ends=True, lastMap=last_map))]
        run = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
        lines = [l for l in run.stdout.splitlines() if l.startswith("{")]
        if run.returncode != 0 or not lines:
            raise SystemExit("no road from %s (%d,%d) to %s (%d,%d): %s" % (map_id, x, y, to_map, to_x, to_y, run.stderr.strip()[-400:]))
        return json.loads(lines[-1])

    def walk_leg(self, to_map, to_x, to_y, options=None, move=None, tag=""):
        """Walks to a cell, however many maps away, fighting whatever engages
        on the way. Each planned action is checked against the cell the
        planner said it ends on; an interruption (a trainer's line of sight, a
        wild when no Repel is on, a wanderer in the way) is seen through and
        the road re-planned from wherever the player now stands. Returns the
        actions actually walked, for the record."""
        walked = []
        for attempt in range(12):
            if self.here() == (to_map, to_x, to_y):
                return walked
            road = self.plan_road(to_map, to_x, to_y, options)
            for action, end in zip(road["actions"], road["ends"]):
                if getattr(self, "no_wild", False):
                    self.pb.memory[W["wRepelRemainingSteps"]] = 0xFF
                if "walk" in action:
                    self.walk(action["walk"], action.get("n", 1))
                else:
                    self.tick(action.get("wait", 0))
                walked.append(action)
                fought = self.after_landing(move)
                if fought:
                    print("%s: fought %d on the way, at %s" % (tag or "leg", fought, self.here()), file=sys.stderr)
                if list(self.here()) != end:
                    # Off the plan: a body in the way, or a script moved us.
                    self.tick(60)
                    break
            else:
                if self.here() == (to_map, to_x, to_y):
                    return walked
        raise SystemExit("%s: could not reach %s (%d,%d); standing at %s" % (tag or "leg", to_map, to_x, to_y, self.here()))

    def converse(self, max_frames=6000):
        """A talk seen through to the end: the first page is waited for (it
        opens a good twenty frames after the press, and clear_boxes asked at
        once would find nothing to do and return), then every page is turned
        and every scripted walk waited out, twice over with a pause between,
        since a scene can go quiet for a moment between its parts."""
        waited = 0
        while self.box_lines() is None and self.mem(W["wJoyIgnore"]) == 0 and waited < 120:
            self.tick(4)
            waited += 4
        self.clear_boxes(max_frames)
        self.tick(120)
        self.clear_boxes(900)
        self.settle()

    def heal_at_counter(self):
        """Below a Center's counter: the nurse's whole conversation, YES
        included (A on the box's first entry), until the party is full."""
        self.face("up")
        self.press("a", None, 8)
        self.converse(3000)
        detail = self.party_detail()
        if any(m["hp"] != m["maxHp"] for m in detail):
            raise SystemExit("the nurse did not heal: %r" % detail)

    def clear_boxes(self, max_frames=1800):
        """A press on every page as it becomes ready, until no box is up and
        the pad is no longer ignored."""
        frames = 0
        while frames < max_frames:
            if self.box_lines() is not None:
                self.press("a", 2, 30)
                frames += 32
            elif self.mem(W["wJoyIgnore"]) != 0:
                self.tick(10)
                frames += 10
            else:
                return True
        return False

    # How each starter is taken from where the escort leaves the player, OAKS_LAB
    # (5,3): CHARMANDER's ball is the cell to the right; BULBASAUR's is at (8,3),
    # talked to from below (scenarios/starter-bulbasaur-1-basic-select-no-nickname).
    # Each pick ends on the page where BLUE takes the one that beats it; the
    # approach is what puts the player back over the lab's two-cell aisle
    # (columns 4 and 5, the bundle's own map) so the walk down reaches row 6,
    # where BLUE's challenge is triggered.
    STARTER_PICKS = {
        "CHARMANDER": {
            "pick": [{"face": "right"}, {"text": "CHARMANDER?", "max": 40}, {"press": "a"},
                     {"text": "nickname", "max": 40}, {"press": "a"}, {"wait": 60}, {"press": "b"},
                     {"text": "SQUIRTLE!", "max": 40}],
            "approach": []},
        "BULBASAUR": {
            "pick": [{"walk": "down", "n": 1}, {"walk": "right", "n": 3}, {"face": "up"},
                     {"text": "BULBASAUR?", "max": 40}, {"press": "a"},
                     {"text": "nickname", "max": 40}, {"press": "a"}, {"wait": 60}, {"press": "b"},
                     {"text": "CHARMANDER!", "max": 40}],
            # BLUE stands under the ball he took, (6,4), so row 4 is shut:
            # down to row 5 first, then left to the aisle.
            "approach": [{"walk": "down", "n": 1}, {"walk": "left", "n": 3}]},
    }

    def prepare_after_rival(self, player="RED", rival="BLUE"):
        """From a fresh game: Oak's escort, CHARMANDER without a nickname, and
        the rival battle WON, A-spammed. Saves the state and returns it with
        the party's exact levels, HP and experience for the lens copy."""
        self.play_to_after_rival(player, rival, "CHARMANDER")
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(os.path.join(STATE_DIR, "after-rival-%s-%s.state" % (player, rival)), "wb") as f:
            self.pb.save_state(f)
        st = self.state()
        st["partyDetail"] = self.party_detail()
        with open(os.path.join(STATE_DIR, "after-rival.rom.json"), "w") as f:
            json.dump(st, f, indent=1)
        return st

    def play_to_after_rival(self, player, rival, starter):
        """A fresh game through Oak's escort, the starter without a nickname,
        and the rival battle WON, A-spammed. The battle's rolls come from the
        frame counter, so a lost battle is retried with more idle frames
        before the trigger until one is won. Leaves the player where BLUE's
        parting words left them, a quiet second later."""
        escort = json.load(open(os.path.join(HERE, "scenarios", "oak-escort.json")))["actions"]
        pick = self.STARTER_PICKS[starter]
        for attempt in range(10):
            self.boot(player, rival)
            self.run(escort)
            self.run(pick["pick"])
            self.tick(attempt * 23)
            # BLUE walks to his ball and speaks; his last page waits for its
            # jingle before it takes a button. Press when there is a page,
            # wait while the pad is ignored, stop when both are gone.
            self.clear_boxes()
            self.run(pick["approach"])
            for _ in range(8):
                self.walk("down", 1)
                if self.box_lines() is not None:
                    break
            self.run([{"text": "take", "max": 40}, {"press": "a"}])
            waited = 0
            while self.mem(W["wIsInBattle"]) == 0 and waited < 900:
                self.tick(10); waited += 10
            if self.mem(W["wIsInBattle"]) == 0:
                raise SystemExit("the rival battle never started")
            frames = 0
            while self.mem(W["wIsInBattle"]) != 0 and frames < 20000:
                self.press("a", 6 if self.box_lines() is None else 2, 20)
                frames += 26
            hp = self.party_detail()[0]["hp"] if self.mem(W["wPartyCount"]) else 0
            won = self.mem(W["wIsInBattle"]) == 0 and self.mem(W["wCurMap"]) == 40 and hp > 0
            print("attempt %d: %s (hp %d)" % (attempt, "won" if won else "lost", hp), file=sys.stderr)
            if not won:
                continue
            # BLUE's parting words and his walk out; then a quiet second.
            self.clear_boxes(3600)
            self.tick(120)
            self.clear_boxes(600)
            self.settle()
            return
        raise SystemExit("could not win the rival battle in ten tries")

    # The objects the road to Pewter has to plan around, as they stand once the
    # starter is taken: the escort's Oak and the rival are gone from the lab,
    # so are the two balls, and Oak has left Pallet's road. After the Pokedex
    # the sleeper across Viridian's north path is gone and the walking old man
    # stands on (17,5) (OaksLabOakGivesPokedexScript's two toggles).
    AFTER_STARTER_TOGGLES = {
        "OAKS_LAB:OAKSLAB_OAK2": False, "OAKS_LAB:OAKSLAB_OAK1": True, "OAKS_LAB:OAKSLAB_RIVAL": False,
        "OAKS_LAB:OAKSLAB_CHARMANDER_POKE_BALL": False, "OAKS_LAB:OAKSLAB_BULBASAUR_POKE_BALL": False,
        "PALLET_TOWN:PALLETTOWN_OAK": False,
    }
    AFTER_POKEDEX_TOGGLES = {
        "VIRIDIAN_CITY:VIRIDIANCITY_OLD_MAN_SLEEPY": False, "VIRIDIAN_CITY:VIRIDIANCITY_OLD_MAN": True,
    }
    # The one trainer no road through Viridian Forest can miss: he stands on
    # (2,18) of a two-cell corridor and watches (1,18). Fought with the first
    # slot (TACKLE: VINE WHIP is a quarter against a Bug/Poison WEEDLE).
    FOREST_TOLL = ["VIRIDIANFOREST_YOUNGSTER4"]
    # The grind: Route 2's grass column just north of Viridian, x 8, rows
    # 48..51 (the bundle's own map), paced from the floor cell below it.
    GRIND_FOOT = ("ROUTE_2", 8, 52)
    GRIND_TOP_ROW = 48
    GRIND_LEVEL, GRIND_MOVE = 13, "VINE_WHIP"

    def grind(self, max_battles=150):
        """Wild battles in Route 2's grass, A-spammed, until the lead is at
        least GRIND_LEVEL and knows GRIND_MOVE. Heals at Viridian's Center
        whenever the lead is at or below two thirds, and after a wild has won
        -- a whiteout heals on its own but halves the money and puts the
        player back at the last Center, so it is avoided rather than relied
        on. Every battle is printed to stderr. Returns the number of battles."""
        battles = 0
        going_up = True
        while battles < max_battles:
            lead = self.party_detail()[0]
            if lead["level"] >= self.GRIND_LEVEL and any(m["id"] == self.GRIND_MOVE for m in lead["moves"]):
                return battles
            if lead["hp"] * 3 <= lead["maxHp"] * 2 or self.here()[0] != self.GRIND_FOOT[0]:
                self.no_wild = True
                self.walk_leg("VIRIDIAN_POKECENTER", 3, 3, {"toggles": self.road_toggles}, tag="to the Center")
                self.heal_at_counter()
                self.walk_leg(*self.GRIND_FOOT, {"toggles": self.road_toggles}, tag="back to the grass")
                self.no_wild = False
                self.pb.memory[W["wRepelRemainingSteps"]] = 0
                going_up = True
            # One step at a time along the grass column; a battle ends the pass.
            y = self.here()[2]
            if going_up and y <= self.GRIND_TOP_ROW:
                going_up = False
            elif not going_up and y >= self.GRIND_FOOT[2]:
                going_up = True
            self.walk("up" if going_up else "down", 1)
            if self.mem(W["wIsInBattle"]) != 0:
                enemy_hp = (self.mem(W["wEnemyMonHP"]) << 8) | self.mem(W["wEnemyMonHP"] + 1)
                result = self.fight(None)
                battles += 1
                lead = self.party_detail()[0]
                print("battle %d: %s, %d turns, %s L%d %d/%d exp %d %s" % (
                    battles, "won" if result["won"] else "LOST (whiteout)", result["turns"], lead["species"], lead["level"],
                    lead["hp"], lead["maxHp"], lead["exp"], ",".join(m["id"] for m in lead["moves"])), file=sys.stderr)
                self.after_landing()
        raise SystemExit("still not level %d with %s after %d battles" % (self.GRIND_LEVEL, self.GRIND_MOVE, max_battles))

    def prepare_after_brock(self, player="RED", rival="BLUE"):
        """A fresh game to just outside PEWTER GYM with the Boulder Badge.

        BULBASAUR is the starter -- VINE WHIP at level 13 is four times
        effective on both of Brock's -- and the road is: Oak's escort, the
        lab battle, Route 1, the Viridian clerk's parcel, back to Oak for the
        Pokedex, Route 2's grass until the level and the move are there (the
        Center whenever HP is low), the forest and its one unavoidable Bug
        Catcher, Pewter's Center, the gym round the left of its trainer, and
        Brock with VINE WHIP. Every leg is planned by road.mjs from the
        bundle's own map data and walked step for step; the lens copy
        (lensstate.mjs) walks the same waypoints. Saves the state and writes
        after-brock.rom.json with the party's exact bytes."""
        self.play_to_after_rival(player, rival, "BULBASAUR")
        legs = []

        def leg(name, to_map, x, y, options=None, move=None):
            actions = self.walk_leg(to_map, x, y, options, move, tag=name)
            # The waypoint and the planner's inputs, so the lens copy plans
            # the same road; the actions walked are the record of this run.
            legs.append({"name": name, "to": [to_map, x, y], "options": dict(options or {}), "actions": actions})
            print("%s: at %s" % (name, self.here()), file=sys.stderr)

        # The clerk's errand, in the words of the transcript that already
        # compares (scenarios/viridian-mart-parcel.json, from after-rival).
        errand = json.load(open(os.path.join(HERE, "scenarios", "viridian-mart-parcel.json")))
        self.no_wild = True
        self.run(errand["actions"])
        if self.here()[0] != "VIRIDIAN_MART" or ["OAKS_PARCEL", 1] not in self.state()["bag"]:
            raise SystemExit("the errand did not end with the parcel: %r" % self.state())
        self.road_toggles = dict(self.AFTER_STARTER_TOGGLES)
        leg("mart-to-oak", "OAKS_LAB", 5, 3, {"toggles": self.road_toggles})
        # Oak's request scene: the parcel, BLUE in and out, the Pokedex.
        self.face("up")
        self.press("a", None, 8)
        self.converse(8000)
        if ["OAKS_PARCEL", 1] in self.state()["bag"]:
            raise SystemExit("Oak did not take the parcel: %r" % self.state())
        print("pokedex: flags %s" % self.state()["eventFlags"], file=sys.stderr)
        self.road_toggles.update(self.AFTER_POKEDEX_TOGGLES)

        leg("oak-to-grass", *self.GRIND_FOOT, {"toggles": self.road_toggles})
        self.no_wild = False
        self.pb.memory[W["wRepelRemainingSteps"]] = 0
        battles = self.grind()
        print("grind: %d battles, %s" % (battles, self.party_detail()[0]), file=sys.stderr)
        # Full before the forest, then Pewter's Center before the gym.
        self.no_wild = True
        leg("grass-to-viridian-center", "VIRIDIAN_POKECENTER", 3, 3, {"toggles": self.road_toggles})
        self.heal_at_counter()
        leg("viridian-center-to-pewter-center", "PEWTER_POKECENTER", 3, 3,
            {"toggles": self.road_toggles, "beaten": self.FOREST_TOLL}, move=0)
        self.heal_at_counter()
        leg("pewter-center-to-brock", "PEWTER_GYM", 4, 2, {"toggles": self.road_toggles})
        # Brock: his page, the battle with VINE WHIP, the badge and the TM.
        self.face("up")
        self.press("a", None, 8)
        waited = 0
        while self.mem(W["wIsInBattle"]) == 0 and waited < 1800:
            if self.box_lines() is not None:
                self.press("a", 2, 20)
            else:
                self.tick(10)
            waited += 22
        if self.mem(W["wIsInBattle"]) == 0:
            raise SystemExit("Brock's battle never started: %r" % self.state())
        result = self.fight(self.GRIND_MOVE)
        print("brock: %s in %d turns, %s" % ("won" if result["won"] else "LOST", result["turns"], self.party_detail()[0]), file=sys.stderr)
        if not result["won"]:
            raise SystemExit("lost to Brock: %r" % self.state())
        self.after_landing()
        self.converse(3000)
        st = self.state()
        if not (self.mem(W["wObtainedBadges"]) & 1) or not any(item == "TM_BIDE" for item, _ in st["bag"]):
            raise SystemExit("no badge or no TM34 after Brock: %r" % st)
        leg("brock-to-pewter", "PEWTER_CITY", 16, 18, {"toggles": self.road_toggles})

        os.makedirs(STATE_DIR, exist_ok=True)
        with open(os.path.join(STATE_DIR, "after-brock-%s-%s.state" % (player, rival)), "wb") as f:
            self.pb.save_state(f)
        st = self.state()
        st["partyDetail"] = self.party_detail()
        st["badgeMask"] = self.mem(W["wObtainedBadges"])
        seen, owned = self.dex_lists()
        st["dexSeen"], st["dexOwned"] = seen, owned
        blackout = self.mem(W["wLastBlackoutMap"])
        st["respawnMap"] = self.map_names[blackout] if blackout < len(self.map_names) else str(blackout)
        st["starter"] = "BULBASAUR"
        st["legs"] = legs
        st["grindBattles"] = battles
        with open(os.path.join(STATE_DIR, "after-brock.rom.json"), "w") as f:
            json.dump(st, f, indent=1)
        return st

    def run(self, actions):
        out = []
        is_first_action = True
        for action in actions:
            before_map = self.mem(W["wCurMap"])
            # Scenario start: NPCs the ROM's own boot-time RNG already walked
            # to, before this scenario has run a single action of its own --
            # tools/oracle/compare.mjs --screens places the lens's NPCs here
            # before its own first action (PLAYTEST.md's GAME BOY mode).
            # Named apart from the "text" action's OWN `first` below (first
            # PRESS of that one action, a different question) -- this
            # function's frame is shared, not block-scoped.
            boot_npcs = self.sprite_positions() if is_first_action and getattr(self, "want_screens", False) else None
            if getattr(self, "no_wild", False):
                # A Repel with steps to spare: wild Pokemon below the lead's
                # level stay away, on Route 1, 2, 22 and in the forest alike.
                self.pb.memory[W["wRepelRemainingSteps"]] = 0xFF
            if "walk" in action:
                self.walk(action["walk"], action.get("n", 1))
            elif "face" in action:
                self.face(action["face"])
            elif "press" in action:
                self.press(action["press"], action.get("hold", None), action.get("settle", 12))
            elif "wait" in action:
                self.tick(action["wait"])
            elif "talk" in action:
                pages = self.talk()
                st = self.state()
                st["action"] = action
                st["pages"] = pages
                if getattr(self, "want_screens", False):
                    st["screen"] = self.screen_settled()
                    st["animPhase"] = self.mem(TILE_ANIM_COUNTER)
                    st["npcs"] = self.sprite_positions()
                    st["mapChanged"] = self.mem(W["wCurMap"]) != before_map
                    if boot_npcs is not None:
                        st["bootNpcs"] = boot_npcs
                out.append(st)
                is_first_action = False
                continue
            elif "text" in action:
                # Press A through pages until the screen shows the wanted text.
                # A press counts only when there is a page (or a Pokedex page)
                # to press on; while a script walks someone across the room
                # the action waits instead of spending its presses.
                presses = 0
                frames = 0
                first = True
                while presses < action.get("max", 60) and frames < 3600:
                    if action["text"] and self.screen_has(action["text"]):
                        # The words are on screen before the page is ready for a
                        # button: measured, an A pressed at once is swallowed and
                        # the box (with the pad ignored) stays up for good, while
                        # an A a second later closes it. Give the page its second.
                        self.tick(60)
                        break
                    # The first press may open a talk (a ball, a sign); after
                    # that only a page or a Pokedex page takes a press.
                    if first or self.box_lines() is not None or self.dex_page():
                        self.press("a", None, 8)
                        presses += 1
                    else:
                        self.tick(10)
                    first = False
                    frames += 10
            st = self.state()
            st["action"] = action
            if getattr(self, "want_screens", False):
                st["screen"] = self.screen_settled()
                st["animPhase"] = self.mem(TILE_ANIM_COUNTER)
                st["npcs"] = self.sprite_positions()
                st["mapChanged"] = self.mem(W["wCurMap"]) != before_map
                if boot_npcs is not None:
                    st["bootNpcs"] = boot_npcs
            out.append(st)
            is_first_action = False
        return out


def main():
    rom, bundle, verb = sys.argv[1], sys.argv[2], sys.argv[3]
    o = Oracle(rom, bundle)
    if verb == "boot":
        print(json.dumps(o.boot(), indent=1))
    elif verb == "run":
        scenario = json.load(open(sys.argv[4]))
        player, rival = scenario.get("player", "RED"), scenario.get("rival", "BLUE")
        o.boot(player, rival)
        if scenario.get("start"):
            o.load_start(scenario["start"], player, rival)
        o.no_wild = scenario.get("noWild") is True
        o.still_npcs = scenario.get("stillNpcs") is True
        o.want_screens = "--screens" in sys.argv
        for st in o.run(scenario["actions"]):
            print(json.dumps(st))
    elif verb == "prepare":
        name = sys.argv[4]
        if name == "after-rival":
            print(json.dumps(o.prepare_after_rival(), indent=1))
        elif name == "after-brock":
            print(json.dumps(o.prepare_after_brock(), indent=1))
        else:
            print("unknown start " + name, file=sys.stderr)
            sys.exit(2)
    else:
        print("usage: oracle.py <rom> <bundle> boot | run scenario.json | prepare after-rival|after-brock", file=sys.stderr)
        sys.exit(2)
    o.pb.stop(save=False)


if __name__ == "__main__":
    main()
