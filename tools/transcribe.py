#!/usr/bin/env python3
"""Transcribe gen1recomp's hand-ported map scripts into this project's format.

    python3 tools/transcribe.py <gen1recomp/data/scripts> <red bundle.json> <out.json>
                                [--yellow <yellow bundle.json>] [--ts <PortedMaps.ts>] [--list]

ONE command does the whole job -- it recurses, and with --ts it also writes the
TypeScript module the lens compiles. Regenerating what ships:

    ./tools/golden.sh                       # clones gen1recomp if needed
    python3 tools/transcribe.py "$WORK/g1r/data/scripts" \
        /path/to/red.json /tmp/ported.json --yellow /path/to/yellow.json \
        --ts Assets/Scripts/play/script/PortedMaps.ts

If it reports only the top-level subset, the glob stopped recursing again.
Without --yellow the Yellow overlay in the output is EMPTY and the run says
so; a regeneration for Red alone must not be committed.

gen1recomp's scripts are Lua tables of command rows, which is very nearly the
shape this project's ScriptVM already reads. Nearly, not exactly, and the
differences are the kind that land INSIDE a program and run the wrong command:

  * Jump targets there are ONE-based (the trailing comments number from 1).
    Ours are zero-based indices. Every target shifts by one.
  * Arguments are positional; ours are named. A row's meaning depends entirely
    on its op, so the table below is the whole translation.
  * `show_text` may carry a LABEL ("_BikeShopYoungsterCoolBikeText") or the
    words themselves, where the cartridge built the line out of pieces at
    runtime and there is no label to point at.
  * `face_object` and `move_npc_to` may name an object by INDEX. The bundle
    carries `index` on every map object, so those resolve to names here rather
    than teaching the VM a second way to name an NPC.

The reference writes a script three ways, and this tool reads two of them:

    TEXT_X = { {"show_text", "_Foo"}, ... }   -- a command list: translated row by row
    TEXT_X = gift({ item = ..., flag = ... }) -- a HELPER builds the rows: expanded here
    TEXT_X = function(game, ow, npc, done)    -- code: reported, not ported

The helpers are Lua functions in the reference that build a script from a few
arguments -- a gift with its flag and texts, a badge check, a rod. Each one has
an EXPANDER below that produces the same script in our vocabulary, read against
the Lua it stands in for (the file:line is on each). The expansions use labels,
which the VM prefers to numeric targets, and they name items by ID: the display
name is looked up in the player's own bundle at runtime, so nothing derived
from the cartridge lands in the output.

Anything this cannot translate faithfully is SKIPPED and reported. A partial
port that silently drops a branch is worse than an absent one -- the map looks
finished and behaves wrong.

Nothing here is derived from the cartridge: the output names labels and ids, and
the words themselves are read from the player's own bundle at runtime.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# op -> the named operands its positional arguments map to, in order.
# None means "the op takes no arguments".
ARGS = {
    "face_player": [],
    "show_text": ["textId"],
    "text": ["textId"],
    "ask": ["textId", "flag"],
    "check_flag": ["flag"],
    "check_item": ["item"],
    "check_money": ["amount"],
    "jump": ["to"],
    "jump_if_true": ["to"],
    "jump_if_false": ["to"],
    "set_flag": ["flag"],
    "clear_flag": ["flag"],
    "give_item": ["item", "count"],
    "take": ["item", "count"],
    "give_pokemon": ["species", "level"],
    "trade": ["index", "flag"],
    "open_mart": ["textId"],
    "push_screen": ["screen", "species"],
    "hide_object": ["map", "npc"],
    "show_object": ["map", "npc"],
    "face_object": ["npc", "direction"],
    "face_player_dir": ["direction"],
    "move_player": ["direction", "steps"],
    "walk_npc": ["npc", "direction", "steps"],
    "move_npc_to": ["npc", "x", "y"],
    "play_music": ["track"],
    "stop_music": [],
    "play_default_music": [],
    "text_sound": ["name"],
    "play_cry": ["species"],
    "heal_party": [],
    # The reference warps by CELL: { "warp", MAP, x, y, facing }. Reading the x
    # as a warp index lands the player on whatever warp sits at that number,
    # which is inside a wall about as often as not.
    "warp": ["map", "x", "y", "facing"],
    "wait": ["frames"],
    "check_battle_result": [],
    # { "static_battle", species, level, flag } -- a fixed Pokemon standing in
    # the world. Snorlax's row passes its flag as a VARIABLE, not a string, so
    # parse_row refuses it and that one script stays skipped rather than being
    # ported with a flag that is the word "beatFlag".
    "static_battle": ["species", "level", "flag"],
    "take_money": ["amount"],
    "fade": ["direction", "colour"],
    "play_once": ["track"],
    "take_item": ["item", "count"],
    "mark_seen": ["species"],
    "label": ["name"],
    "end": [],
}

# Ops we deliberately do not translate. Each one needs behaviour the host does
# not have, and a script containing one is skipped whole rather than half-ported.
UNSUPPORTED = {
    "old_man_demo", "emote", "set_field", "rival_battle",
    "save_end_battle_text", "record_hall_of_fame", "give_poke_balls",
}

JUMP_OPS = {"jump", "jump_if_true", "jump_if_false"}


def strip_comments(text: str) -> str:
    out = []
    for line in text.split("\n"):
        # A -- inside a string is not a comment; the reference never does that,
        # but check anyway rather than corrupting a line silently.
        idx = line.find("--")
        while idx >= 0 and line[:idx].count('"') % 2 == 1:
            idx = line.find("--", idx + 2)
        out.append(line[:idx] if idx >= 0 else line)
    return "\n".join(out)


TOKEN = re.compile(
    r'"((?:[^"\\]|\\.)*)"'      # string
    r"|(-?\d+)"                  # number
    r"|(true|false|nil)"         # keyword
    r"|([{}])"                   # brace
    r"|(,)"
    r"|(\.\.)"                   # lua concat
    r"|([A-Za-z_][\w.]*)"        # bare name (function calls etc.)
)


def parse_rows(body: str):
    """Every `{ "op", ... }` row in a talk-table body, in order -- and the
    rows that could NOT be read, as text.

    A row this cannot read used to vanish: parse_row answered None for a call
    or a nested table and the loop moved on, so `{ "text_opts", captainRubOpts() }`
    in the middle of the SS Anne captain dropped out and the eleven rows around
    it were ported as if it had never been there. The jingle it carried was
    gone and nothing said so. That is the one thing the module's own docstring
    forbids: a partial port that looks finished. The caller now skips the whole
    script, with the row in the reason, when this list is non-empty."""
    rows = []
    unreadable = []
    i = 0
    while i < len(body):
        if body[i] != "{":
            i += 1
            continue
        depth = 1
        j = i + 1
        while j < len(body) and depth > 0:
            if body[j] == "{":
                depth += 1
            elif body[j] == "}":
                depth -= 1
            j += 1
        inner = body[i + 1:j - 1]
        row = parse_row(inner)
        if row is not None:
            rows.append(row)
        else:
            unreadable.append(" ".join(inner.split())[:60])
        i = j
    return rows, unreadable


def parse_row(inner: str):
    """A single row's arguments, or None when it is not a command row."""
    if "{" in inner:            # nested table: an options blob we do not model
        return None
    args = []
    pos = 0
    pending = None
    for m in TOKEN.finditer(inner):
        s, n, kw, brace, comma, concat, name = m.groups()
        if s is not None:
            lit = s.encode().decode("unicode_escape")
            pending = lit if pending is None else pending + lit
        elif concat is not None:
            continue
        elif comma is not None:
            if pending is not None:
                args.append(pending)
                pending = None
        elif n is not None:
            args.append(int(n))
        elif kw is not None:
            args.append({"true": True, "false": False, "nil": None}[kw])
        elif name is not None:
            return None          # a function call or a variable: not data
    if pending is not None:
        args.append(pending)
    if not args or not isinstance(args[0], str):
        return None
    return args


def swap_with_next(out, op):
    """Move each `op` row one place later, past the show_text it precedes.

    Once, not repeatedly: a row that has just been moved must not be picked up
    again by the same pass, or a cry written before two lines walks past both
    of them and ends up after the wrong one. Jump targets are still one-based
    here, so rows i and i+1 are numbered i+1 and i+2.
    """
    i = 0
    while i < len(out) - 1:
        if out[i]["op"] != op or out[i + 1]["op"] != "show_text":
            i += 1
            continue
        out[i], out[i + 1] = out[i + 1], out[i]
        for row in out:
            if row["op"] in JUMP_OPS and isinstance(row.get("to"), int):
                if row["to"] == i + 1:
                    row["to"] = i + 2
                elif row["to"] == i + 2:
                    row["to"] = i + 1
        i += 2


def translate(rows, objects_by_index, map_id):
    """Rows -> our commands, or (None, reason)."""
    out = []
    for index, row in enumerate(rows):
        op = row[0]
        if op in UNSUPPORTED:
            return None, f"uses {op}"
        if op == "engage_music":
            # { "engage_music", "Music_MeetMaleTrainer" } -- the reference's name
            # for the encounter song a static battle plays before its text
            # (home/trainers.asm:123). It is a play_music with a different verb;
            # the battle that follows takes the song over the way it always has.
            #
            # The reference writes it between the cry and the line. The cry
            # belongs AFTER the line (see swap_with_next), and the song starts
            # the encounter, so the song goes in front of the cry: the swap then
            # leaves song, line, cry. Only when no numeric jump could be aimed
            # at the cry's row; labels are unaffected.
            music = {"op": "play_music", "track": row[1]}
            numeric = any(isinstance(r[1], int) for r in rows if r[0] in JUMP_OPS and len(r) > 1)
            if out and out[-1]["op"] == "play_cry" and not numeric:
                out.insert(len(out) - 1, music)
            else:
                out.append(music)
            continue
        if op == "no_npc_face_player":
            # The reference brackets a section with this to stop the engine's
            # MakeNPCFacePlayer -- the SS Anne captain keeps his back to you
            # while it is being rubbed. Nothing in this project faces an NPC
            # unless a face_player row says so, so the flag has nothing to do
            # here. A LABEL rather than nothing: jump targets are indices into
            # this list and the reference computes one of them from the row
            # count, so a dropped row would move every target after it.
            out.append({"op": "label", "name": f"no_face_{index}"})
            continue
        if op == "start_battle":
            # { "start_battle", "trainer", "OPP_X", partyIndex }
            ids = [a for a in row[1:] if isinstance(a, str) and a.startswith("OPP_")]
            if not ids:
                return None, "start_battle without a trainer id"
            # The number after the id is the 1-based roster index. Dropping it
            # fought roster 1 for every trainer.
            party = [a for a in row[1:] if isinstance(a, int)]
            battle = {"op": "start_battle", "trainer": ids[0]}
            if party:
                battle["party"] = party[0]
            out.append(battle)
            continue
        if op == "give_item":
            # { "give_item", ITEM, count, gotText, fullText }: gotText is a label
            # to print after the give (false = the script has its own row);
            # fullText is the refusal. The VM shows the refusal and stops.
            gift = {"op": "give_item", "item": row[1], "count": row[2] if len(row) > 2 and isinstance(row[2], int) else 1}
            if len(row) > 4 and isinstance(row[4], str):
                gift["noRoom"] = row[4]
            out.append(gift)
            if len(row) > 3 and isinstance(row[3], str):
                out.append({"op": "show_text", "textId": row[3]})
            continue
        names = ARGS.get(op)
        if names is None:
            return None, f"unknown op {op}"
        cmd = {"op": op}
        for name, value in zip(names, row[1:]):
            if value is None:
                continue
            cmd[name] = value
        # An object named by index becomes the name the bundle gives it.
        if op in ("face_object", "hide_object", "show_object", "walk_npc", "move_npc_to"):
            npc = cmd.get("npc")
            if isinstance(npc, int):
                resolved = objects_by_index.get(npc)
                if resolved is None:
                    return None, f"{op} names object #{npc}, which {map_id} does not have"
                cmd["npc"] = resolved
        if op in ("hide_object", "show_object") and "map" not in cmd:
            cmd["map"] = map_id
        out.append(cmd)

    # The CRY COMES AFTER THE LINE.
    #
    # Every cry in Red is written as a text_asm INSIDE a text: the words are a
    # text_far, and the `ld a, SPECIES / call PlayCry` that follows runs once
    # that page has been read (VermilionCity.asm:224-231, MrFujisHouse.asm:56-68,
    # CeladonMansion1F.asm:16-30, PowerPlant.asm:110-116 -- all twenty-two of
    # them, checked one by one). The reference puts its play_cry row FIRST, so
    # every transcription barked before anyone spoke. Swapping here fixes all of
    # them at once; a jump that lands on either row moves with it.
    swap_with_next(out, "play_cry")

    # THE SOUND FOLLOWS ITS LINE, for the same reason the cry does.
    #
    # A sound_ inside a text block always comes after a text_far: the block IS
    # the line, and the jingle rings once the page has been read
    # (WardensHouse.asm:71-73, CeladonMart3F.asm:29-31, MtMoonB2F.asm:299-303).
    # The reference writes the row before the line instead. The expanders above
    # emit the right order themselves; this is for the hand-written lists.
    swap_with_next(out, "text_sound")

    # ONE-based to zero-based, after the list is final.
    for cmd in out:
        if cmd["op"] in JUMP_OPS and isinstance(cmd.get("to"), int):
            if cmd["to"] == 0:
                # The reference's own sentinel for "I will patch this in at load
                # time": the SS Anne captain's table is written with a 0 and a
                # `do ... end` block afterwards sets it to #rows, the LAST row
                # (src/data/scripts/story.lua). This reads the table, not the
                # block, so the sentinel is resolved the same way here. Row
                # numbers are one-based, so #rows IS the last row.
                cmd["to"] = len(out)
            target = cmd["to"] - 1
            if target < 0:
                return None, f"jump to {cmd['to']} is before the start"
            if target >= len(out):
                # Past the last command is how the reference spells "stop": the
                # rows are numbered from one and a jump to len+1 falls off the
                # end. A larger number is the same intent written as a sentinel.
                cmd["to"] = "end"
            else:
                cmd["to"] = target
    return out, ""


# ---------------------------------------------------------------------------
# Helper calls: `TEXT_X = gift({ ... })`, `TEXT_X = ballMon("VOLTORB", 40, "EVENT_...")`
# ---------------------------------------------------------------------------

class LuaName:
    """A bare identifier in an argument list: a variable, not data."""
    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return f"LuaName({self.name})"


ARG_TOKEN = re.compile(
    r'"((?:[^"\\]|\\.)*)"'      # string
    r"|(-?\d+)"                  # number
    r"|\b(true|false|nil)\b"     # keyword
    r"|([{}])"                   # brace
    r"|(,)"
    r"|(=)"
    r"|(\.\.)"                   # lua concat
    r"|([A-Za-z_][\w.]*)"        # bare name
)


def parse_lua_args(text: str):
    """The argument list of a helper call, as Python values.

    Strings (with `..` concatenation), numbers, true/false/nil, and one level of
    table constructor: `{ k = v, ... }` becomes a dict, `{ v, v }` a list. A bare
    name becomes a LuaName so an expander can refuse it instead of porting the
    word "beatFlag" as a flag.
    """
    tokens = [(m.lastindex, m.group(m.lastindex)) for m in ARG_TOKEN.finditer(text)]
    pos = 0

    def value():
        nonlocal pos
        kind, tok = tokens[pos]
        if kind == 1:                       # string, possibly concatenated
            out = tok.encode().decode("unicode_escape")
            pos += 1
            while pos + 1 < len(tokens) and tokens[pos][0] == 7 and tokens[pos + 1][0] == 1:
                out += tokens[pos + 1][1].encode().decode("unicode_escape")
                pos += 2
            return out
        if kind == 2:
            pos += 1
            return int(tok)
        if kind == 3:
            pos += 1
            return {"true": True, "false": False, "nil": None}[tok]
        if kind == 4 and tok == "{":
            pos += 1
            return table()
        if kind == 8:
            pos += 1
            return LuaName(tok)
        raise ValueError(f"unexpected token {tok!r}")

    def table():
        nonlocal pos
        named = {}
        listed = []
        while pos < len(tokens):
            kind, tok = tokens[pos]
            if kind == 4 and tok == "}":
                pos += 1
                return named if named or not listed else listed
            if kind == 5:
                pos += 1
                continue
            if kind == 8 and pos + 1 < len(tokens) and tokens[pos + 1][0] == 6:
                key = tok
                pos += 2
                named[key] = value()
            else:
                listed.append(value())
        raise ValueError("unterminated table")

    args = []
    while pos < len(tokens):
        kind, tok = tokens[pos]
        if kind == 5:
            pos += 1
            continue
        args.append(value())
    return args


def cmd(op, **operands):
    out = {"op": op}
    for k, v in operands.items():
        if v is not None:
            out[k] = v
    return out


def is_label(text_id) -> bool:
    """A text-table key rather than words: `_FooText`, or the eleven bare ones."""
    return isinstance(text_id, str) and re.fullmatch(r"_?[A-Za-z0-9]+Text\d*", text_id) is not None


def is_key_item(item_id, bundle) -> bool:
    """Price zero is how the cartridge marks a key item; the jingle differs."""
    items = bundle.get("items") or {}
    entry = items.get(item_id)
    return bool(entry) and entry.get("price", 1) == 0


# Read from the cartridge, one script each: CeladonDiner.asm:56-58,
# CeladonMart3F.asm:29-31, Route12Gate2F.asm:37-39, CeladonCity.asm:71-73,
# CinnabarLabMetronomeRoom.asm:39-41, ViridianCity.asm:261-263 (GET_ITEM_2),
# SilphCo2F.asm:138-140, Route1.asm:34-36.
GIFT_SOUNDS = {
    "EVENT_GOT_COIN_CASE": "Get_Key_Item",
    "EVENT_GOT_TM42": "Get_Item2",
}


def expand_gift(args, ctx):
    """story5.lua gift(opts): an item once, with its texts.

    check flag -> already; [pre]; give; probe the bag with check_item -- give_item
    is void, and PlayState.giveItem mutates nothing when it refuses, so the probe
    is exact; then and ONLY then the flag, the jingle, the received text, and the
    explanation. The flag after the probe is the whole point: set it before and
    a full bag loses the item for good, because every later visit takes the
    `already` branch.
    """
    if len(args) != 1 or not isinstance(args[0], dict):
        return None, "gift() without an options table"
    o = args[0]
    for need in ("flag", "item", "received", "noRoom"):
        if not isinstance(o.get(need), str):
            return None, f"gift() without {need}"
    already = o.get("already") or o.get("explain")
    if not isinstance(already, str):
        return None, "gift() with neither already nor explain"
    item = o["item"]
    # The jingle each gift's received text carries, read off the cartridge one
    # script at a time. "A key item rings the key-item fanfare" is a guess and
    # it is wrong: the COIN CASE rings it and the WARDEN's HM04 does not, and
    # the Viridian fisher's TM42 rings SFX_GET_ITEM_2, which nothing else does.
    sound = GIFT_SOUNDS.get(o["flag"], "Get_Item1")
    out = [
        cmd("check_flag", flag=o["flag"]),
        cmd("jump_if_true", to="already"),
    ]
    if isinstance(o.get("pre"), str):
        out.append(cmd("show_text", textId=o["pre"], ramItem=item))
    # A refused give shows `noRoom` and STOPS the script (the VM's rule, the
    # reference's and the cartridge's), so the flag after it cannot burn the
    # gift and no probe is needed.
    out += [
        cmd("give_item", item=item, count=1, noRoom=o["noRoom"]),
        cmd("set_flag", flag=o["flag"]),
        # The received line, THEN the jingle: every one of these is a text_far
        # followed by a sound_ inside the same text block
        # (CeladonMart3F.asm:29-31 is the shape).
        cmd("show_text", textId=o["received"], ramItem=item),
        cmd("text_sound", name=sound),
    ]
    # The `explain` line is the REPEAT-visit line, not a second page of the
    # handover: every one of the six scripts that has one reaches it through
    # `jr c, .got_item` (Route12Gate2F.asm:12-29, CeladonMart3F.asm:3-20), so
    # chaining it after the received text said it twice, once too early.
    out += [
        cmd("jump", to="end"),
        cmd("label", name="already"),
        cmd("show_text", textId=already, ramItem=item),
    ]
    return out, ""


def expand_ball_mon(args, ctx):
    """flavor/power_plant.lua ballMon(species, level, flag): a Voltorb posing as an item."""
    if len(args) != 3 or not all(isinstance(a, t) for a, t in zip(args, (str, int, str))):
        return None, "ballMon() with unexpected arguments"
    species, level, flag = args
    return [
        cmd("show_text", textId="_PowerPlantVoltorbBattleText"),
        cmd("check_flag", flag=flag),
        cmd("jump_if_true", to="end"),
        cmd("static_battle", species=species, level=level, flag=flag),
    ], ""


def expand_badge_guard(args, ctx):
    """flavor/route_23.lua badgeGuard(badge, passFlag): the Victory Road gate.

    `check_item BADGE` reaches PlayHost.hasItem, which answers a badge id from
    the badge set rather than the bag. The texts read the badge's name from
    {RAM:wNameBuffer}, so both carry it as ramItem.
    """
    if len(args) != 2 or not all(isinstance(a, str) for a in args):
        return None, "badgeGuard() with unexpected arguments"
    badge, pass_flag = args
    return [
        cmd("check_item", item=badge),
        cmd("jump_if_true", to="has_badge"),
        cmd("show_text", textId="_Route23YouDontHaveTheBadgeYetText", ramItem=badge),
        # Route23YouDontHaveTheBadgeYetText ends in a text_asm that plays
        # SFX_DENIED and waits for it (scripts/Route23.asm:221-227), and
        # Route23CheckForBadgeScript then walks the player one step back down
        # (:206-208, Route23MovePlayerDownScript). Both belong to the guard's
        # own script, so talking to him and walking into his row do the same.
        cmd("text_sound", name="Denied"),
        cmd("move_player", direction="down", steps=1),
        cmd("jump", to="end"),
        cmd("label", name="has_badge"),
        cmd("show_text", textId="_Route23OhThatIsTheBadgeText", ramItem=badge),
        cmd("text_sound", name="Get_Item1"),
        cmd("show_text", textId="_Route23GoRightAheadText"),
        cmd("set_flag", flag=pass_flag),
    ], ""


def expand_badge_branch(args, ctx):
    """story7.lua badgeBranch(beatFlag, champText, beatText): the gym guide."""
    if len(args) != 3 or not all(isinstance(a, str) for a in args):
        return None, "badgeBranch() with unexpected arguments"
    beat_flag, champ, beaten = args
    return [
        cmd("check_flag", flag=beat_flag),
        cmd("jump_if_true", to="beaten"),
        cmd("show_text", textId=champ),
        cmd("jump", to="end"),
        cmd("label", name="beaten"),
        cmd("show_text", textId=beaten),
    ], ""


def expand_rod_giver(args, ctx):
    """story3.lua rodGiver(ask, received, after, rod, flag, refused[, follow]).

    The reference gives the rod without checking the bag. The cartridge does
    check -- each rod house has a NoRoomText, and the bundle carries all three --
    so the port follows the cartridge: probe after the give, flag only once it
    landed. The received text reads the rod's name from {RAM:wStringBuffer}.
    """
    if len(args) not in (6, 7) or not all(isinstance(a, str) for a in args):
        return None, "rodGiver() with unexpected arguments"
    ask_text, received, after, rod, flag, refused = args[:6]
    follow = args[6] if len(args) == 7 else None
    no_room = re.sub(r"FishingGuru.*$", "FishingGuruNoRoomText", ask_text)
    if no_room == ask_text or no_room not in ctx["bundle"]["text"]:
        return None, f"rodGiver() cannot find the no-room text for {ask_text}"
    out = [
        cmd("face_player"),
        cmd("check_flag", flag=flag),
        cmd("jump_if_true", to="already_got"),
        cmd("ask", textId=ask_text),
        cmd("jump_if_false", to="refused"),
        cmd("give_item", item=rod, count=1, noRoom=no_room),
        cmd("set_flag", flag=flag),
        # VermilionOldRodHouse.asm:42-46 and its two brothers: the TakeThis page
        # FIRST, then sound_get_item_1 -- the ordinary item jingle, not the key
        # one -- and only then "Fishing is a way of life!". The rods are key
        # items, which is what the key-item jingle used to be read off, but the
        # cartridge hardcodes SFX_GET_ITEM_1 in the text itself.
        cmd("show_text", textId=received, ramItem=rod),
        cmd("text_sound", name="Get_Item1"),
    ]
    if follow:
        out.append(cmd("show_text", textId=follow))
    out += [
        cmd("jump", to="end"),
        cmd("label", name="refused"),
        cmd("show_text", textId=refused),
        cmd("jump", to="end"),
        cmd("label", name="already_got"),
        cmd("show_text", textId=after),
    ]
    return out, ""


def expand_facing_up(args, ctx):
    """flavor/route18_gate_2f.lua printIfFacingUp(label), route_12_gate_2f.lua binoculars(label).

    The binoculars say something only when you look up through them; facing any
    other way the script ends without a word.
    """
    if len(args) != 1 or not isinstance(args[0], str):
        return None, "binoculars() with unexpected arguments"
    return [
        cmd("check_facing", direction="up"),
        cmd("jump_if_false", to="end"),
        cmd("show_text", textId=args[0]),
    ], ""


COIN_CASE_FULL_AT = 9990


def expand_coin_giver(args, ctx):
    """flavor/game_corner.lua coinGiver(opts): a few coins once, if you can carry them.

    The ask label is a plain line in the Lua (push, not ask): the NPC does not
    take no for an answer. Then, in the reference's order: no COIN CASE refuses,
    9990 or more coins refuses, and only then the coins land, the flag lands and
    the received line plays with the item jingle.
    """
    if len(args) != 1 or not isinstance(args[0], dict):
        return None, "coinGiver() without an options table"
    o = args[0]
    for need in ("event", "amount", "askLabel", "receivedLabel", "coinCaseFullLabel", "alreadyGotLabel"):
        if o.get(need) is None:
            return None, f"coinGiver() without {need}"
    if not isinstance(o["amount"], int):
        return None, "coinGiver() with a non-numeric amount"
    return [
        cmd("check_flag", flag=o["event"]),
        cmd("jump_if_true", to="already"),
        cmd("show_text", textId=o["askLabel"]),
        cmd("check_item", item="COIN_CASE"),
        cmd("jump_if_false", to="no_case"),
        cmd("check_coins", amount=COIN_CASE_FULL_AT),
        cmd("jump_if_true", to="full"),
        cmd("give_coins", amount=o["amount"]),
        cmd("set_flag", flag=o["event"]),
        cmd("show_text", textId=o["receivedLabel"]),
        cmd("text_sound", name="Get_Item1"),
        cmd("jump", to="end"),
        cmd("label", name="no_case"),
        cmd("show_text", textId="_GameCornerOopsForgotCoinCaseText"),
        cmd("jump", to="end"),
        cmd("label", name="full"),
        cmd("show_text", textId=o["coinCaseFullLabel"]),
        cmd("jump", to="end"),
        cmd("label", name="already"),
        cmd("show_text", textId=o["alreadyGotLabel"]),
    ], ""


def expand_oaks_aide(args, ctx):
    """story4.lua oaksAide(threshold, itemId, repeatText[, flagName]): the gate-house aides.

    The Hi line is a yes/no whose {NUM:} is the requirement and whose {RAM:} is
    the item; the here-you-go and uh-oh lines print the LIVE count, which the
    host fills from the save itself. The item lands, the bag is probed, and only
    then the flag; the repeat text doubles as the "I already gave you" line, as
    it does in the reference.
    """
    if len(args) not in (3, 4):
        return None, "oaksAide() with unexpected arguments"
    threshold, item, repeat_text = args[:3]
    if not (isinstance(threshold, int) and isinstance(item, str) and isinstance(repeat_text, str)):
        return None, "oaksAide() with unexpected arguments"
    flag_name = args[3] if len(args) == 4 else None
    if flag_name is not None and not isinstance(flag_name, str):
        return None, "oaksAide() with a non-string flag"
    port_flag = "EVENT_GOT_" + item
    flag = flag_name or port_flag
    out = [
        # DisplayTextID turns every sprite you talk to toward you
        # (home/text_script.asm:42); the three aides ship facing a wall, so
        # without this row they answer with their backs turned.
        cmd("face_player"),
        cmd("check_flag", flag=flag),
        cmd("jump_if_true", to="already"),
    ]
    if flag != port_flag:
        out += [
            cmd("check_flag", flag=port_flag),
            cmd("jump_if_true", to="already"),
        ]
    out += [
        cmd("ask", textId="_OaksAideHiText", ramItem=item, num=threshold),
        cmd("jump_if_false", to="come_back"),
        cmd("check_dex_owned", count=threshold),
        cmd("jump_if_false", to="uh_oh"),
        cmd("show_text", textId="_OaksAideHereYouGoText", ramItem=item, num=threshold),
        cmd("give_item", item=item, count=1, noRoom="_OaksAideNoRoomText"),
        cmd("set_flag", flag=flag),
        # OaksAideGotItemText is text_far + sound_get_item_1
        # (engine/events/oaks_aide.asm:64-67): ONE routine for all three aides,
        # so HM05, the ITEMFINDER and the EXP.ALL all ring the ordinary item
        # jingle however key the reward is.
        cmd("show_text", textId="_OaksAideGotItemText", ramItem=item, num=threshold),
        cmd("text_sound", name="Get_Item1"),
        cmd("show_text", textId=repeat_text, ramItem=item),
        cmd("jump", to="end"),
        cmd("label", name="uh_oh"),
        cmd("show_text", textId="_OaksAideUhOhText", ramItem=item, num=threshold),
        cmd("jump", to="end"),
        cmd("label", name="come_back"),
        cmd("show_text", textId="_OaksAideComeBackText", ramItem=item, num=threshold),
        cmd("jump", to="end"),
        cmd("label", name="already"),
        cmd("show_text", textId=repeat_text, ramItem=item),
    ]
    return out, ""


def own_object_name(ctx, key):
    """The name of the object on this map whose text key is `key`, or ""."""
    for obj in ctx["bundle"]["maps"][ctx["map_id"]]["objects"]:
        if obj.get("text") == key:
            return obj["name"]
    return ""


def object_cell(ctx, name):
    for obj in ctx["bundle"]["maps"][ctx["map_id"]]["objects"]:
        if obj["name"] == name:
            return obj["x"], obj["y"]
    return None


def expand_dojo_ball(args, ctx):
    """story4.lua dojoBall(species, ownBall, otherBall, askKey): the dojo's prize.

    Either prize taken -> greedy line. Master unbeaten -> the reference's own
    refusal (the cartridge has no words here; the balls sit behind him). Else
    the dex entry, the question, the Pokemon at level 30 -- and only if it
    LANDED (give_pokemon sets the condition) the ball goes, the flags land.
    """
    if len(args) != 4 or not all(isinstance(a, str) for a in args):
        return None, "dojoBall() with unexpected arguments"
    species, own_ball, other_ball, ask_key = args
    return [
        cmd("check_flag", flag="EVENT_GOT_HITMONLEE"),
        cmd("jump_if_true", to="greedy"),
        cmd("check_flag", flag="EVENT_GOT_HITMONCHAN"),
        cmd("jump_if_true", to="greedy"),
        cmd("check_flag", flag="EVENT_BEAT_KARATE_MASTER"),
        cmd("jump_if_false", to="not_yet"),
        cmd("mark_seen", species=species),
        cmd("push_screen", screen="DexEntryMenu", species=species),
        cmd("ask", textId=ask_key),
        cmd("jump_if_false", to="end"),
        cmd("give_pokemon", species=species, level=30),
        cmd("jump_if_false", to="box_full"),
        cmd("hide_object", map=ctx["map_id"], npc=own_ball),
        cmd("set_flag", flag="EVENT_GOT_" + species),
        cmd("set_flag", flag="EVENT_DEFEATED_FIGHTING_DOJO"),
        cmd("jump", to="end"),
        cmd("label", name="box_full"),
        cmd("show_text", textId="_BoxIsFullText"),
        cmd("jump", to="end"),
        cmd("label", name="greedy"),
        cmd("show_text", textId="_FightingDojoBetterNotGetGreedyText"),
        cmd("jump", to="end"),
        cmd("label", name="not_yet"),
        # gen1recomp's own line (MIT), not the cartridge's: it has none here.
        cmd("show_text", textId="You'll have to\nbeat the master\nfirst!"),
    ], ""


def expand_mt_moon_fossil(args, ctx):
    """story2.lua mtMoonFossil(itemId, otherName, gotFlag): one of the two fossils.

    Either fossil already taken -> nothing. The Super Nerd unbeaten -> his fight
    (his header's lines; the reference engages him the same way). Else the
    question, the fossil into the bag with the probe, then and only then the
    ball gone and the flag; the nerd walks to the other one, claims it, and it
    goes too.
    """
    if len(args) != 3 or not all(isinstance(a, str) for a in args):
        return None, "mtMoonFossil() with unexpected arguments"
    item, other_name, got_flag = args
    own = own_object_name(ctx, ctx["key"])
    if not own:
        return None, "mtMoonFossil() cannot find its own ball"
    other = object_cell(ctx, other_name)
    if other is None:
        return None, f"mtMoonFossil() cannot find {other_name}"
    want = "_MtMoonB2FDomeFossilYouWantText" if item == "DOME_FOSSIL" else "_MtMoonB2FHelixFossilYouWantText"
    return [
        cmd("check_flag", flag="EVENT_GOT_DOME_FOSSIL"),
        cmd("jump_if_true", to="end"),
        cmd("check_flag", flag="EVENT_GOT_HELIX_FOSSIL"),
        cmd("jump_if_true", to="end"),
        cmd("check_flag", flag="EVENT_BEAT_MT_MOON_3_SUPER_NERD"),
        cmd("jump_if_false", to="nerd"),
        cmd("ask", textId=want),
        cmd("jump_if_false", to="end"),
        cmd("give_item", item=item, count=1, noRoom="_MtMoonB2FYouHaveNoRoomText"),
        cmd("hide_object", map=ctx["map_id"], npc=own),
        cmd("set_flag", flag=got_flag),
        cmd("show_text", textId="_MtMoonB2FReceivedFossilText", ramItem=item),
        cmd("text_sound", name="Get_Key_Item"),
        # ONE step, and its direction is the cartridge's own: MtMoonB2FMoveSuperNerd
        # picks MoveRight when the player stands on a dome-fossil cell and MoveUp
        # when on a helix one (scripts/MtMoonB2F.asm:90-129), which from his own
        # (12,8) means he ends on (13,8) or (12,7). Walking him UNDER the other
        # fossil instead put him a cell north of where the cartridge leaves him,
        # and asked move_npc_to to path around the player standing at (12,7).
        cmd("walk_npc", npc="MTMOONB2F_SUPER_NERD",
            direction="right" if item == "DOME_FOSSIL" else "up", steps=1),
        cmd("show_text", textId="_MtMoonB2FSuperNerdThenThisIsMineText"),
        cmd("text_sound", name="Get_Key_Item"),
        cmd("hide_object", map=ctx["map_id"], npc=other_name),
        cmd("jump", to="end"),
        cmd("label", name="nerd"),
        cmd("show_text", textId="_MtMoonB2FSuperNerdTheyreBothMineText"),
        cmd("start_battle", trainer="OPP_SUPER_NERD", party=2),
        cmd("check_battle_result"),
        cmd("jump_if_false", to="end"),
        cmd("beat_trainer", map=ctx["map_id"], npc="MTMOONB2F_SUPER_NERD", flag="EVENT_BEAT_MT_MOON_3_SUPER_NERD"),
        cmd("show_text", textId="_MtMoonB2FSuperNerdOkIllShareText"),
    ], ""


# name -> expander. Add one per reference helper; a helper without an entry is
# reported as "built by X()" so the count of what is left stays honest.
EXPANDERS = {
    "gift": expand_gift,
    "ballMon": expand_ball_mon,
    "badgeGuard": expand_badge_guard,
    "badgeBranch": expand_badge_branch,
    "rodGiver": expand_rod_giver,
    "printIfFacingUp": expand_facing_up,
    "binoculars": expand_facing_up,
    "coinGiver": expand_coin_giver,
    "oaksAide": expand_oaks_aide,
    "dojoBall": expand_dojo_ball,
    "mtMoonFossil": expand_mt_moon_fossil,
}


def brace_body(text: str, start: int) -> str:
    """The text inside the brace that opens just before `start`, to its match."""
    i = start
    depth = 1
    while i < len(text) and depth > 0:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    return text[start:i - 1]


def talk_tables(text: str):
    """Every (map_id, talk-table body) in a reference file, both spellings.

        M.MAP_ID = { talk = { ... } }     -- most files
        M.MAP_ID.talk = { ... }           -- gyms.lua and the Elite Four rooms
    """
    out = []
    for m in re.finditer(r"(?:^|\s|M\.)([A-Z][A-Z_0-9]{2,})\s*=\s*\{", text):
        body = brace_body(text, m.end())
        talk = re.search(r"talk\s*=\s*\{", body)
        if talk:
            out.append((m.group(1), brace_body(body, talk.end())))
    for m in re.finditer(r"M\.([A-Z][A-Z_0-9]{2,})\.talk\s*=\s*\{", text):
        out.append((m.group(1), brace_body(text, m.end())))
    return out


def check_jumps(cmds):
    """Every label-jump lands on a label or "end"; returns the first bad target or None."""
    labels = {c.get("name") for c in cmds if c["op"] == "label"}
    for c in cmds:
        if c["op"] in JUMP_OPS:
            to = c.get("to")
            if isinstance(to, str) and to != "end" and to not in labels:
                return to
    return None


def without_absent_objects(cmds, bundle):
    """Drop hide/show rows that name an object the bundle's map does not have.

    The versions differ in their object lists -- Yellow's Saffron has eight
    Rockets where Red's has nine -- and a row aimed at a missing one is a no-op
    at runtime that the host reports every time it runs. Dropping it here
    makes the script differ between the versions, which is what puts it in
    the Yellow overlay. Only when the script has no numeric jump, since those
    count rows; returns (cmds, reason) with reason set when it could not.
    """
    absent = []
    for i, c in enumerate(cmds):
        if c["op"] in ("hide_object", "show_object"):
            m = bundle["maps"].get(c.get("map"))
            if m is None or not any(o["name"] == c.get("npc") for o in m["objects"]):
                absent.append(i)
    if not absent:
        return cmds, None
    if any(c["op"] in JUMP_OPS and isinstance(c.get("to"), int) for c in cmds):
        return None, f"names {cmds[absent[0]].get('npc')} which the map lacks, in a script with numeric jumps"
    return [c for i, c in enumerate(cmds) if i not in absent], None


def missing_text(cmds, bundle):
    """The first text id that names a label the bundle does not have, or None."""
    for c in cmds:
        if c["op"] in ("show_text", "text", "ask"):
            tid = c.get("textId")
            if is_label(tid) and tid not in bundle["text"]:
                return tid
    return None


TS_HEADER = """// Map scripts transcribed from gen1recomp's data/scripts, by tools/transcribe.py.
//
// {maps} maps, {scripts} scripts ({expanded} of them expanded from the reference's
// helpers). GENERATED -- edit the transcriber, not this file. Regenerate with:
//
//   python3 tools/transcribe.py "$WORK/g1r/data/scripts" <red bundle.json> \\
//       /tmp/ported.json --yellow <yellow bundle.json> \\
//       --ts Assets/Scripts/play/script/PortedMaps.ts
//
// The reference's rows are very nearly the shape ScriptVM already reads, and the
// differences are exactly the kind that land INSIDE a program and run the wrong
// command, which is why this is a tool and not a copy-and-paste:
//
//   * Its jump targets are ONE-based. Ours are zero-based indices. A jump past
//     the last row is how it spells "stop", so those become "end".
//   * Its arguments are positional; ours are named, per op.
//   * An object may be named by INDEX, which resolves here against the bundle's
//     own `index` field rather than teaching the VM a second way to name an NPC.
//   * Scripts the reference builds with a helper (gift, badgeGuard, rodGiver...)
//     are expanded from the helper's Lua into label-based command lists. Items
//     in them are named by ID (`ramItem`) and resolved to their display name
//     at runtime from the player's own bundle.
//
// Anything the transcriber could not translate faithfully was SKIPPED and
// reported rather than half-ported: a map that looks finished and behaves wrong
// is worse than one that has no script at all, and a map with no script still
// works -- its NPCs and signs resolve their text straight out of the cartridge.
//
// MapScripts.ts holds the hand-written ports (Pallet Town, Red's house, Oak's
// lab, Pewter Gym, the intro) and takes precedence over anything here.

import type {{ ScriptCommand }} from "./ScriptVM";
import type {{ CartridgeVersion }} from "../../world/Cartridge";

const PORTED: any = """

TS_MIDDLE = """;

/**
 * What Yellow says differently: the same shape as PORTED, but a key holding
 * null means Yellow has NO script there and Red's must not run either. Keys
 * absent from this table read from PORTED like any other cartridge. Built
 * from a Yellow bundle by the same run (--yellow); {changed} scripts differ,
 * {absent} exist in Red only.
 */
const PORTED_YELLOW: any = """

TS_FOOTER = """;

/**
 * The talk script for a TEXT_* id on a transcribed map, or null.
 *
 * Yellow consults its overlay first: a row there is its own script, a null
 * there is "nothing, not even Red's". Red and Blue never look at the overlay.
 */
export function transcribedScript(mapId: string, textId: string,
                                  version: CartridgeVersion = "red"): ScriptCommand[] {
  if (version === "yellow") {
    const over = PORTED_YELLOW[mapId];
    if (over && over.talk && Object.prototype.hasOwnProperty.call(over.talk, textId)) {
      const own = over.talk[textId];
      return own ? own : null;
    }
  }
  const set = PORTED[mapId];
  if (!set || !set.talk) {
    return null;
  }
  const script = set.talk[textId];
  return script ? script : null;
}

/** Every transcribed map id, for a version. */
export function transcribedMaps(version: CartridgeVersion = "red"): string[] {
  const out = Object.keys(PORTED);
  if (version === "yellow") {
    const more = Object.keys(PORTED_YELLOW);
    for (let i = 0; i < more.length; i++) {
      if (out.indexOf(more[i]) < 0) {
        out.push(more[i]);
      }
    }
  }
  return out;
}

/** The whole Red table, for the tests. */
export function transcribedAll(): any {
  return PORTED;
}

/** The Yellow overlay, for the tests. */
export function transcribedYellowOverlay(): any {
  return PORTED_YELLOW;
}
"""


def write_ts(path: Path, ported: dict, expanded: int, overlay: dict):
    scripts = sum(len(v["talk"]) for v in ported.values())
    changed = sum(1 for m in overlay.values() for v in m["talk"].values() if v is not None)
    absent = sum(1 for m in overlay.values() for v in m["talk"].values() if v is None)
    body = json.dumps(ported, indent=2, sort_keys=True)
    yellow_body = json.dumps(overlay, indent=2, sort_keys=True)
    path.write_text(TS_HEADER.format(maps=len(ported), scripts=scripts, expanded=expanded,
                                     changed=changed, absent=absent)
                    + body + TS_MIDDLE.format(changed=changed, absent=absent)
                    + yellow_body + TS_FOOTER)


def version_files(scripts_dir: Path, version: str) -> list:
    """The reference's script files that belong to a version, subdirectories first.

    RECURSIVE, and subdirectories FIRST.

    The reference splits its scripts across data/scripts/*.lua and
    data/scripts/flavor/*.lua, and a non-recursive glob quietly saw only the
    first: one run produced 16 maps where two runs produced 49. Anyone
    regenerating PortedMaps.ts with the obvious single command would have
    dropped 33 maps and 69 scripts, and the output would have looked fine.

    Top-level files come last so they win: they hold the considered ports of
    maps that also have a flavor entry.

    The reference keeps Yellow as a delta (data/scripts/init.lua): oaks_lab_yellow
    replaces oaks_lab, and the yellow_* files are loaded on top of everything
    else. Read for Red, the yellow files are left out; read for Yellow, the Red
    lab is.
    """
    nested = sorted(p for p in scripts_dir.rglob("*.lua") if p.parent != scripts_dir)
    top = sorted(scripts_dir.glob("*.lua"))
    files = nested + top
    if version == "yellow":
        # the top-level lab only: flavor/oaks_lab.lua (the girl, the dex on the
        # table, the scientists) is shared and stays
        return [p for p in files if not (p.name == "oaks_lab.lua" and p.parent == scripts_dir)]
    return [p for p in files if "yellow" not in p.name]


def transcribe_dir(scripts_dir: Path, bundle: dict, version: str):
    """Every script the reference holds for a version, against one bundle.

    Returns (ported, skipped, expanded): the table keyed by map then TEXT_*
    id, the list of what was skipped and why, and how many scripts came out
    of a helper expander.
    """
    ported = {}
    skipped = []
    expanded = 0

    for path in version_files(scripts_dir, version):
        text = strip_comments(path.read_text())
        # Each file returns a table of MAP_ID = { talk = { TEXT_X = {...} } } --
        # or, for the eight gyms and the Elite Four rooms, assigns the talk table
        # directly: M.CERULEAN_GYM.talk = { ... }. The first pattern alone never
        # saw the second, so the gym leaders were absent from every count.
        for talk_id, talk_body in talk_tables(text):
            map_id = talk_id
            if map_id not in bundle["maps"]:
                continue
            objects_by_index = {}
            for obj in bundle["maps"][map_id]["objects"]:
                objects_by_index[obj["index"]] = obj["name"]
            valid_keys = {o["text"] for o in bundle["maps"][map_id]["objects"]}
            valid_keys |= {s["text"] for s in bundle["maps"][map_id].get("signs", [])}
            ctx = {"map_id": map_id, "objects_by_index": objects_by_index, "bundle": bundle}

            # `= {` is a command list. `= gift({` and `= function(` are not,
            # and matching only the first meant those entries were never even
            # SEEN -- they vanished before any skip could be reported, which is
            # how thirty-nine maps went missing without appearing anywhere. The
            # helper name may carry a digit: e4LeaderTalk() fell out the same way.
            for entry in re.finditer(
                    r"(TEXT_[A-Z_0-9]+)\s*=\s*(\{|[a-zA-Z_][a-zA-Z_0-9]*\s*\()", talk_body):
                key = entry.group(1)
                if entry.group(2).strip() != "{":
                    name = entry.group(2).strip().rstrip("(").strip()
                    if name == "function":
                        skipped.append(f"{map_id}.{key}: written as a function")
                        continue
                    expander = EXPANDERS.get(name)
                    if expander is None:
                        skipped.append(f"{map_id}.{key}: built by {name}()")
                        continue
                    if key not in valid_keys:
                        skipped.append(f"{map_id}.{key}: no object points at it")
                        continue
                    # the call's argument list, to the matching paren
                    k = entry.end()
                    depth = 1
                    while k < len(talk_body) and depth > 0:
                        if talk_body[k] == "(":
                            depth += 1
                        elif talk_body[k] == ")":
                            depth -= 1
                        k += 1
                    try:
                        args = parse_lua_args(talk_body[entry.end():k - 1])
                    except ValueError as e:
                        skipped.append(f"{map_id}.{key}: {name}() arguments unreadable ({e})")
                        continue
                    if any(isinstance(a, LuaName) for a in args):
                        skipped.append(f"{map_id}.{key}: {name}() passes a variable")
                        continue
                    ctx["key"] = key
                    cmds, why = expander(args, ctx)
                    if cmds is None:
                        skipped.append(f"{map_id}.{key}: {why}")
                        continue
                    bad_jump = check_jumps(cmds)
                    if bad_jump is not None:
                        skipped.append(f"{map_id}.{key}: {name}() jumps to no label {bad_jump}")
                        continue
                    bad = missing_text(cmds, bundle)
                    if bad is not None:
                        skipped.append(f"{map_id}.{key}: no such text {bad}")
                        continue
                    ported.setdefault(map_id, {}).setdefault("talk", {})[key] = cmds
                    expanded += 1
                    continue

                k = entry.end()
                depth = 1
                while k < len(talk_body) and depth > 0:
                    if talk_body[k] == "{":
                        depth += 1
                    elif talk_body[k] == "}":
                        depth -= 1
                    k += 1
                script_body = talk_body[entry.end():k - 1]

                if key not in valid_keys:
                    skipped.append(f"{map_id}.{key}: no object points at it")
                    continue
                rows, unreadable = parse_rows(script_body)
                if unreadable:
                    skipped.append(f"{map_id}.{key}: unreadable row {{ {unreadable[0]} }}")
                    continue
                if not rows:
                    # WHY it is not a command list matters. A count that lumps
                    # helper-built and function-written scripts together hides
                    # how much is actually reachable.
                    helper = re.match(r"\s*([a-z][a-zA-Z_]*)\s*\(", script_body)
                    if helper and helper.group(1) != "function":
                        skipped.append(f"{map_id}.{key}: built by {helper.group(1)}()")
                    elif re.match(r"\s*function\s*\(", script_body):
                        skipped.append(f"{map_id}.{key}: written as a function")
                    else:
                        skipped.append(f"{map_id}.{key}: not a command list")
                    continue
                cmds, why = translate(rows, objects_by_index, map_id)
                if cmds is None:
                    skipped.append(f"{map_id}.{key}: {why}")
                    continue
                cmds, why = without_absent_objects(cmds, bundle)
                if cmds is None:
                    skipped.append(f"{map_id}.{key}: {why}")
                    continue
                bad = missing_text(cmds, bundle)
                if bad is not None:
                    skipped.append(f"{map_id}.{key}: no such text {bad}")
                    continue
                ported.setdefault(map_id, {}).setdefault("talk", {})[key] = cmds
    return ported, skipped, expanded


def yellow_overlay(red: dict, yellow: dict) -> dict:
    """What Yellow's table says differently from Red's, and nothing else.

    A key present in both with the same rows is left out. A key whose rows
    differ, or that only Yellow has, carries Yellow's rows. A key only Red has
    is written as null: Yellow has no such script, and the lens must not run
    Red's there -- its texts are the ones Yellow lacks.
    """
    overlay = {}
    maps = set(red) | set(yellow)
    for map_id in sorted(maps):
        red_talk = red.get(map_id, {}).get("talk", {})
        yellow_talk = yellow.get(map_id, {}).get("talk", {})
        for key in sorted(set(red_talk) | set(yellow_talk)):
            if key not in yellow_talk:
                overlay.setdefault(map_id, {}).setdefault("talk", {})[key] = None
            elif key not in red_talk or red_talk[key] != yellow_talk[key]:
                overlay.setdefault(map_id, {}).setdefault("talk", {})[key] = yellow_talk[key]
    return overlay


def report(label: str, ported: dict, skipped: list, expanded: int, list_skipped: bool):
    scripts = sum(len(v["talk"]) for v in ported.values())
    print(f"{label:12} {len(ported)} maps, {scripts} scripts, "
          f"{expanded} from helpers ({', '.join(sorted(EXPANDERS))}), {len(skipped)} skipped")
    reasons = {}
    for line in skipped:
        why = line.split(": ", 1)[1] if ": " in line else line
        reasons[why] = reasons.get(why, 0) + 1
    for why in sorted(reasons, key=lambda k: -reasons[k]):
        print(f"  {reasons[why]:3}  {why}")
    if list_skipped:
        for line in sorted(skipped):
            print(f"    {line}")


def main(argv):
    ts_path = None
    yellow_path = None
    # --list names every skipped script rather than only counting the reasons.
    # The counts say how much is left; the names say WHICH map is missing an
    # event, which is the question every milestone of PLAN-FULL-GAME asks.
    list_skipped = "--list" in argv
    if list_skipped:
        argv = [a for a in argv if a != "--list"]
    if "--ts" in argv:
        i = argv.index("--ts")
        ts_path = Path(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    if "--yellow" in argv:
        i = argv.index("--yellow")
        yellow_path = Path(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    if len(argv) < 4:
        print(__doc__)
        return 2
    scripts_dir = Path(argv[1])
    bundle = json.loads(Path(argv[2]).read_text())
    out_path = Path(argv[3])

    ported, skipped, expanded = transcribe_dir(scripts_dir, bundle, "red")
    out_path.write_text(json.dumps(ported, indent=1, sort_keys=True))
    print(f"TRANSCRIBED  -> {out_path}")
    report("RED", ported, skipped, expanded, list_skipped)

    overlay = {}
    if yellow_path is not None:
        yellow_bundle = json.loads(yellow_path.read_text())
        yellow, yskipped, yexpanded = transcribe_dir(scripts_dir, yellow_bundle, "yellow")
        report("YELLOW", yellow, yskipped, yexpanded, list_skipped)
        overlay = yellow_overlay(ported, yellow)
        changed = sum(1 for m in overlay.values() for v in m["talk"].values() if v is not None)
        absent = sum(1 for m in overlay.values() for v in m["talk"].values() if v is None)
        print(f"OVERLAY      {changed} scripts Yellow says differently, {absent} it does not have")
    elif ts_path is not None:
        print("NOTE         no --yellow bundle: the Yellow overlay is written EMPTY")

    if ts_path is not None:
        write_ts(ts_path, ported, expanded, overlay)
        print(f"WROTE        {ts_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
