# The cartridge as oracle

`oracle.py` runs the player's own ROM headless in PyBoy and speaks the same
action vocabulary as the lens's headless harness (`test/headless.mjs`):
walk, face, press, wait, text. `compare.mjs` runs a scenario on both and
diffs the state after every action -- map, cell, facing, party, money,
badges, bag. Where they disagree the cartridge is right by definition, and
the difference is a finding to fix in the lens.

    python3 -m venv tools/oracle/.venv && tools/oracle/.venv/bin/pip install pyboy
    node --experimental-strip-types --import ./test/register.mjs \
        tools/oracle/compare.mjs <rom.gb> Assets/Generated/kanto.json tools/oracle/scenarios/bedroom.json

`tools/verify.sh` runs every scenario in `scenarios/` when the venv and the
ROM are there. The first boot writes a save state under `state/` (gitignored,
derived from the ROM) so later runs start in the bedroom at once.

What is compared is deterministic state. The cartridge's RNG cannot be
replayed, so a scenario that walks into grass is compared only up to the
grass; battles have their own harness.

Measured facts the lens had wrong, found here: a new game starts at
REDS_HOUSE_2F (3,6) facing up, not on the stairs.

## Shared starts

Some ground lies behind a dice roll: the rival battle stands between the
lab and the rest of the world. `oracle.py <rom> <bundle> prepare after-rival`
plays a fresh game through the escort, CHARMANDER and a WON rival battle
(retrying with idle frames until the rolls fall right), saves
`state/after-rival-RED-BLUE.state` and writes `state/after-rival.rom.json`
with the party's exact levels and experience. Then

    node --experimental-strip-types --import ./test/register.mjs \
        tools/oracle/lensstate.mjs Assets/Generated/kanto.json after-rival

walks the headless lens down the same road and writes
`state/after-rival.lens.json` with the cartridge's party, money and cell. A
scenario opts in with `"start": "after-rival"`; `"noWild": true` keeps wild
Pokemon away on both machines (a Repel on the cartridge). `state/` is
derived from the ROM and not committed; regenerate it with the two commands.

`prepare after-brock` goes on from there to the first badge: BULBASAUR (VINE
WHIP at level 13 is four times effective on GEODUDE and ONIX), the lab
battle, the clerk's parcel and Oak's Pokedex, Route 2's grass until the
cartridge itself has levelled the starter to 13 (Viridian's Center whenever
HP is low, about forty wild battles), the forest and its one unavoidable Bug
Catcher, Pewter's Center, the gym round the left of its trainer, and Brock
fought with VINE WHIP. It ends outside the gym at PEWTER_CITY (16,18) with
the Boulder Badge and TM34, and writes `state/after-brock.rom.json` with the
party's exact bytes (level, experience, moves and PP, DVs, stat experience),
the badge mask, the Pokedex lists and the waypoints it walked.
`lensstate.mjs ... after-brock` walks the lens over the same waypoints (its
battles resolve as instant wins) and then copies party, money, bag, cell and
the Pokedex lists from the rom.json. Twenty seconds on the cartridge, one on
the lens.

Two pieces of machinery behind it. `road.mjs` plans a road THROUGH maps on
the lens's own map data -- seams, warps, LAST_MAP, the warp-firing rule,
every visible object, a margin round walkers and every cell a trainer can
see -- and both machines plan every leg with it from wherever they stand, so
no cell is hardcoded and an interruption (a trainer's approach) is planned
around again. `Oracle.fight(move)` plays a battle choosing a named move:
the battle menu and the move list are read off the screen (the cursor tile
at its measured cells; the WRAM menu bytes are left behind when a menu
closes and cannot tell), FIGHT is pressed, the list is waited for, the
cursor is steered to the slot, and everything else takes a two-frame A.

What no after-brock scenario can do: walk into Mt Moon. Route 3's map and
the trainers' sight ranges leave no road to Route 4 that fewer than four
trainers see (`road.mjs` proves it; (14,7) is a wall, so the upper path is
entered only through the first Bug Catcher's line), and the lens does not
fight, so levels would part on the first of them. A start on the far side of
Route 3 needs the same machinery run four fights further.
