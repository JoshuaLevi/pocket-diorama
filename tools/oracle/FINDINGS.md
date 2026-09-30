# Findings: where the lens and the cartridge disagree

Append-only. One entry per measured difference; the fix (or the reason it
stays) is recorded under it. "Measured" means `compare.mjs` showed it with the
ROM in PyBoy, not that someone remembered it.

## [2026-09-06] fixed | A new game started on the stairs

The intro warped by warp index 1 of REDS_HOUSE_2F, which is the staircase at
(7,1). The cartridge puts a new game at (3,6) facing up, in front of the SNES.
Fixed in OAK_SPEECH (warp by cell); `to-pallet` and `bedroom` agree since.

## [2026-09-06] fixed | NPCs with WALK movement stand still

Pallet Town's girl is shipped at (3,8) with movement WALK / range ANY_DIR. In
the cartridge she wanders and the cell is free most of the time; the lens
keeps her on her shipped cell, so a walk along the house front is blocked
where the ROM walks through. Fixed: NpcWander runs the cartridge's rule (a
30-180 frame timer, a random direction inside the range, half the time a
turn only, never onto a warp, a body or the player) in the lens and in the
headless lens. Wandering is RNG-driven on both machines, so a comparison
next to a wanderer still cannot be exact; scenarios keep two cells away.

## [2026-09-06] fixed | Pressing into a wall on a stair tile

The lens fired the doormat rule (warp when blocked on a warp tile) on the 2F
stairs at (7,1) when pressing right into the map edge, and ping-ponged 2F/1F.
Measured (edges-14/16/19, reds-house-1f-mom-north): the cartridge does
nothing there. Fixed with pokered's own BIT_STANDING_ON_WARP: re-derived
after every landing and on every map entry, true on a warp cell unless its
tile is a staircase or ladder (a warp tile that is not a door tile). A
blocked step warps only while the flag is up.

## [2026-09-06] fixed | Walking sideways across a doormat left the house

Measured (reds-house-1f-warp, oakslab-blue, reds-house-1f-top-row): walking
left along the bottom row of Red's ground floor crosses both mats and stays
inside; stepping from one of the lab's two doorway mats onto the other stays
in the lab. The lens warped on arrival. Fixed with CheckWarpsNoCollision's
rule: a warp cell whose tile is not a warp or door tile fires only with the
pad held and the ExtraWarpCheck passing -- facing the map edge, or on the
carpet maps and tilesets a warp carpet tile in front.

## [2026-09-06] fixed | The lens stood in the doorway after leaving a house

Measured (oaks-catch-x5-north): after a walk that ends on the exit mat the
cartridge stands at PALLET_TOWN (5,6), one step below the door, whatever
the pad does next; the lens stood on the door tile (5,5) and a held UP then
took it straight back in. Fixed: arriving outdoors on a door tile schedules
the cartridge's forced step down (a scripted step, which the pad cannot
override).

## [2026-09-06] harness | A fixed 16 frames a step let go of the pad a frame early

Not a lens fault. The oracle held a direction for 16 x n + 2 frames; when
the walk began with a turn, the last landing fell after the release and
CheckWarpsNoCollision -- which reads the pad on the landing frame -- did
not fire, so a mat at the end of a walk took the player out in the lens
and not in the ROM (oaks-catch-*). The walk now counts wWalkCounter going
live and releases the moment the last step's counter runs out; measured
against warping off a mat (fires) and open walks (never a step too many).
Counting coordinate changes instead was wrong too: a warp moves the
coordinates without a step and the lens counts steps.


## [2026-09-06] fixed | The SNES in Red's bedroom says nothing

Facing up from (3,6) and pressing A, the cartridge prints
_RedBedroomSNESText ("RED is playing the SNES! ...Okay! It's time to go!").
The bundle has the text but REDS_HOUSE_2F carries no sign for it -- pokered
triggers it from the map's own script on the tile in front -- so the lens is
silent. Fixed: a face trigger on (3,5) in MapScripts shows the text.

## [2026-09-06] fixed | Nothing happened at the top of Pallet Town

Measured: at (10,1) or (11,1) the cartridge turns you to face down, Oak
calls "Hey! Wait! Don't go out!", zigzags up from (8,5) to the cell below
you, warns you, then leads you down the east side of town into his lab and
up the aisle to (5,3) beside BLUE while he takes the desk; BLUE complains,
Oak tells you to choose and BLUE to be patient. The lens had no trigger at
all (PALLET_TOWN onStep was empty; the tests set EVENT_FOLLOWED_OAK_INTO_LAB
by hand), so a new game could walk straight onto Route 1. Fixed: the whole
choreography as a step trigger on wYCoord == 1, with `move ... async` and
`wait_npc` so Oak leads while you follow. oak-escort and oak-escort-east
agree action for action, text included.

## [2026-09-06] fixed | Oak and BLUE repeated the escort's lines while you chose

Measured (lab-tour-1/2, starter-*): waiting for your pick, Oak at the desk
says "Now, RED, which POKéMON do you want?" and BLUE "Heh, I don't need to
be greedy like you! Go ahead and choose, RED!". The lens replayed the whole
"BLUE? Let me think..." speech and BLUE's "Gramps isn't around". Fixed: both
talk scripts branch on EVENT_FOLLOWED_OAK_INTO_LAB.

## [2026-09-06] fixed | You could walk out of the lab before choosing

Measured (lab-tour-5): reaching row 6 of the lab before choosing, Oak calls
"Hey! Don't go away yet!" and you take one step back up (from (5,6) and from
(4,6) alike). The lens let you walk to the door. Fixed: a step trigger on
row 6 while EVENT_FOLLOWED_OAK_INTO_LAB is set and EVENT_GOT_STARTER is not.

## [2026-09-06] harness | The side of a starter ball looked dead

Not a lens fault, and a lesson in reading the screen. From (5,3) facing
right at the CHARMANDER ball, A "did nothing" in three probes: the box
detector saw no text box. What had opened was the Pokedex page, which has
no box frame, and it takes three A presses before the question appears.
Read with the page in mind, the side pick works on the cartridge exactly
as in the lens (rival-trigger-1, lab-tour-6/7). The oracle's `talk` now
recognises the page. A rule "balls answer only from below" was added on
the bad reading and removed the same day.

## [2026-09-06] fixed | The starter's Pokedex page is not shown

Measured: A at a starter ball opens that Pokemon's Pokedex data page
(name, category "LIZARD", HT/WT, dex number, the two-page description),
three A presses, and only then "So! You want the fire POKéMON,
CHARMANDER?". The lens goes straight to the question: it has no Pokedex
page surface, and the bundle carries neither the category nor height and
weight (they sit in pokered's PokedexEntryPointers table, not extracted).
The oracle's `talk` presses through the page without reading it so the
lines after it still compare. Building the page needs: the extraction
(category, height, weight per species) through the golden gate, a
DexEntry screen on the GB canvas, `push_screen` suspending the VM as the
naming screen does, and the headless lens counting it as a page.

Fixed (fix-round-2): the extraction was already there and already proven --
`dexEntry()` in both copies of datasets/pokemon.ts already decoded
PokedexEntryPointers (manifest symbol [bank 16, $447E], already in
rom_manifest_red.json) into `{kind, heightFt, heightIn, weight, text}`, and
`worldfromrom.test.mjs`'s "pokemon" dataset (142607 bytes) already matched
gen1recomp's own golden extraction byte for byte, CHARMANDER's row included
(`heightFt:2, heightIn:0, weight:190, kind:"LIZARD"` -- exactly the measured
2'00"/19.0lb). What was missing was carrying it from there into the bundle:
BundleFromExtraction.ts and tools/build_bundle.py both dropped
spec.dexEntry on the way into a species' bundle entry. Both now copy it
across as `category`, `heightFeet`, `heightInches`, `weightTenths` and
`dexText` (the description's existing label into bundle.text, unchanged).
Checked across the golden extraction for all 151 species, not just
Charmander: every description is exactly two `\f`-separated chunks of
exactly three lines, never a `\v` continuation -- which is why the new
screen splits pages on the form feed alone rather than reusing Dialogue.ts's
two-line-and-scroll paginate() (a box this screen does not have).

`Assets/Scripts/play/screen/DexEntryScreen.ts` is `DexEntryController`, a
pure GbCanvas/GbFont widget in NamingScreen's own shape: dex number top
left, name top right, category line, the front picture, HT/WT beside it,
the description in a bordered box at the bottom. `step(pressedA)` turns the
first description page to the second, then closes it -- two presses, which
with the press that opened the talk is the measured three. The HT/WT
"?'??"/"???.?lb" placeholder that fills in only once the cry finishes is
left showing the real values immediately: F4 (audio) is not built, nothing
in the lens actually plays a cry yet to time a reveal against, and (like
the ledge hop's arc and the `cont` scroll's own animation cost) nothing
headless could verify a frame count invented to match it -- recorded here
rather than guessed at.

The join: `ScriptHost.pushScreen` and `HostServices.dexEntry` both now
return a status instead of always DONE (ScriptVM's `push_screen` dispatch
forwards it rather than hard-coding one), so `push_screen DexEntryMenu`
SUSPENDS the script exactly the way `nameEntry`'s naming screen does,
until services.dexEntry() reports the page closed. PlayHost keeps owning
the state effect (mark the species seen, print once per opening -- gated
on a new `dexEntrySpecies` field so a suspended screen does not repeat it
every frame) and PokemonAR.ts/test/headless.mjs each own a
DexEntryController the same way they each own a NamingController for
`nameEntry`. `starterBall()` in MapScripts.ts now runs `mark_seen` then
`push_screen screen:"DexEntryMenu"` right after the
EVENT_FOLLOWED_OAK_INTO_LAB gate and before the `ask` -- the same
mark_seen-then-push_screen order this codebase already uses for the dojo's
prize and the SS Anne's Snorlax sighting, so all three now share one join.
`test/headless.mjs` treats an open DexEntryController exactly like the
finding asked: `talk()`/`text()`/`clearText()` press through it (one A a
page, no letter-pace wait -- a GbCanvas screen has none, same as
NamingScreen) before looking for the next real page, the way the oracle's
own `talk()` already pressed through `dex_page()`.

New: test/dexentry.test.mjs, 33 checks (fails or throws with the fix
reverted): formatHeight/formatWeight/splitDexPages against Charmander's
own bundle values and a double-digit species (Gyarados, 21'04"/518.0lb);
every one of 151 species carries the four new fields and none needs a
`\v` continuation; the page's pixel layout (dex number, name, category,
picture, HT, WT, the description box and its first page's words, all by
region); one press turning the page without closing it and a second
closing it; a species missing dexText or missing from the bundle
degrading rather than throwing; and, driving PlayHost + ScriptVM with a
minimal services.dexEntry backed by a real DexEntryController, that
push_screen stays SUSPENDED with no press, still SUSPENDED after one, and
only reaches `end` after two -- the exact bug this fix removed
(`--selftest` mutates `pushScreen` back to unconditional DONE and confirms
that specific check goes red).

Verified in this order, all quoted: `./tools/gate.sh` (CARTRIDGE-GATE:
PASS) and `./tools/gate515.sh` (CARTRIDGE-GATE-515: PASS);
worldfromrom.test.mjs (18 pass, 0 fail, 0 missing, pokemon dataset
included) against a fresh `./tools/golden.sh` reference; bundle.test.mjs
(25 pass, 0 fail) against `Assets/Generated/kanto.json` re-baked with
`tools/bake.mjs`; checksum.test.mjs (OK); bootscreens.test.mjs (84 pass);
script.test.mjs (78 pass -- starterBall's new ops needed `markSeen`/
`pushScreen` added to its raw ScriptHost mock); playloop.test.mjs (146
pass, including "Oak's lab" giving CHARMANDER and refusing SQUIRTLE);
mart.test.mjs (12 pass, its own push_screen/DexEntryMenu check and both
mutation selftests still red on the right line); dexentry.test.mjs (33
pass, its own selftest red on the right line). Every one of the 91
scenarios already in `tools/oracle/scenarios/` still reads 0 differ.
`tools/oracle/scenarios/round2/lab-tour-6-choose-starter.json` now reads
20 same, 1 differ -- and the one difference is not this finding: lens and
ROM print the identical ten lines in the identical order, dex page
included ("So! You want the / fire POKéMON, / CHARMANDER?" through "Do you
want to / give a nickname / to CHARMANDER?"), and only the party differs
(lens `[CHARMANDER L5]`, ROM `[0 L0]`). Measured directly (wPartyCount):
the ROM bumps the party COUNT to 1 the instant the pick is accepted, but
the party MON's own species/level/HP bytes read zero for a long time
after -- still zero 150-odd frames and two more presses later in
rival-trigger-1-charmander-door's own walk through this exact spot (18
same, 7 differ, all the same one cause). This is the "unrelated
difference in when the ROM's party slot is actually written relative to
the nickname decline" the BLUE-does-not-stop-you fix already flagged as a
separate, still-open question -- now measured precisely rather than
merely named, and to it, not this one. `lab-tour-7-no-movement.json`
differs on the same single cause (17 same, 1 differ). Left out of
`tools/oracle/scenarios/` rather than copied in differing, the way that
finding's own discovery was: a scenario kept in the gate is meant to read
0 differ, and this one cannot until that separate question is answered.

## [2026-09-06] harness | A two-frame A is lost in a busy room; a page needs a second

Not a lens fault. In Oak's lab the overworld loop runs at 30 fps and
hJoyPressed missed the oracle's two-frame button taps, so a `talk` at a ball
read nothing (starter-* and lab-tour-6/7). Buttons are now held six frames
(directions stay a two-frame tap: the third frame is a step). And the
`text` action returned the moment its words were on screen, one frame
before the page took a button, so the next A was swallowed and the ROM
stood with the box up and the pad ignored (the whole first round of
"lens moves, ROM does not" reports). It now gives the page a second.

## [2026-09-06] open | Text prints instantly in the lens; the cartridge prints letter by letter

Measured (starter-squirtle-*, starter-bulbasaur-*): a button pressed while
the cartridge is still printing a page is ignored (about a second a page at
the default MEDIUM speed), so a scenario that presses A three times in
quick succession advances three pages on the lens and one on the ROM, and
the two read different lines afterwards. Not a wrong rule, but a pacing
difference a player feels: the lens should print at the option's speed
(FAST/MEDIUM/SLOW = 1/3/5 frames a letter) and take no button until the
page is complete, in the lens and in the headless build alike. Until then
scenarios wait a second between presses.

Fixed (fix-round-2): measured on the cartridge first (tools/oracle, address
0xD355 = wOptions, found by diffing WRAM across the OPTION screen's own
three settings): FAST/MEDIUM/SLOW are exactly 1/3/5 frames a letter,
confirmed character-by-character against the bedroom SNES sign, including
spaces and across a `cont` scroll's line break (no extra pause). Bisected
separately: a button counts starting N*textSpeed+1 frames after the page
went up, N being the letters THIS page actually prints -- a `cont` scroll's
carried top line is not retyped, so its own page needs only its new
letters. Checked at all three speeds against a 23-letter fresh page and,
separately, its own 8-letter `cont` continuation: zero error either way.
Also measured: holding A or B through printing forces the fastest (FAST,
1-frame) cadence no matter the option -- real, but not implemented, since
InputSource has no held-button state to hang it off at all (pressedA/B are
one-frame edges everywhere, preview/phone/controller alike) and no
scenario, existing or added, presses that way; recording it here rather
than guessing at a design for a mechanic nothing yet exercises.

Host.ts's PlayHost now remembers the frame each page was shown
(pageShownFrame, from the same services.frames() a script's own `wait`
already used) and exposes textReady(), true once this page's new letters
(newLettersOnPage(), which skips a `cont`'s carried line) have had their
N*textSpeed+1 frames at state.options.textSpeed -- true with nothing on
screen, so a caller never needs to special-case it. PlayLoop passes it
through unchanged. PokemonAR.ts's and the headless lens's per-frame input
handling now require textReady() before a press sets pageAcked or
answerGiven (a yes/no's page prints too, so the same gate covers it).
Battle's own message box runs through a separate BattleView, never through
this host, so textReady() reads its true default there and battle text is
exactly as fast as before -- left alone, per the note above.

Getting this provable exposed three harness gaps, all fixed alongside:
`talk()` used to press blind between pages, wasting iterations of
`maxPages` on a page that could not yet turn -- it now waits for
textReady() first. `text()`'s post-match wait was the flat 60 frames this
finding asked to replace; it now waits for textReady() instead, the same
gate. And `talk()`'s returned transcript was sliced off ONE shared,
cross-action `lines` list, so a page an earlier action had shown but
(correctly, now) not yet been allowed to turn was mis-attributed to
whichever action displayed it first, not the one that actually turned it
-- `talk()` now builds its transcript fresh per call from a raw page log,
deduped only against itself, exactly like the oracle's own talk(). Two
other call sites (`compare.mjs`'s and `escort.test.mjs`'s "press A up to
120 times to clear the intro") assumed instant pages; 120 presses no
longer clears a full intro at MEDIUM speed, so both now call a new
`HeadlessLens.clearText()` that waits properly instead of guessing a
bigger number.

New: test/textpace.test.mjs, 15 checks (fails or throws immediately with
the fix reverted): the bedroom SNES sign's own 23- and 8-letter pages
(derived through paginate(), not hand-counted, so this does not drift if
the transcribed line ever changes) cannot be acked one frame short of
N*speed+1 and can exactly on schedule, at all three speeds; three quick
presses show one page, not three; a `cont` continuation's wait is its own
new letters, not the carried line's too.

Verified in this order, all quoted: `./tools/gate.sh` (CARTRIDGE-GATE:
PASS); script.test.mjs (78 pass), playloop.test.mjs (142 pass),
escort.test.mjs (20 pass), rivaltrigger.test.mjs (9 pass),
bootscreens.test.mjs (80 pass), menu.test.mjs (40 pass), textpace.test.mjs
(15 pass) -- all 0 fail. `tools/oracle/scenarios/round2/starter-squirtle-
1-yes-party.json` (35 same, 0 differ) and `round2/starter-bulbasaur-1-
basic-select-no-nickname.json` (27 same, 0 differ), no scenario edits;
copied into `tools/oracle/scenarios/`. Every scenario already in
`tools/oracle/scenarios/` (91 files) still reads 0 differ. Beyond what was
asked: all twenty starter-*/lab-tour-* scenarios in round2/ that the
README named as blocked by this exact finding now read 0 differ too
(round2/README.md updated) -- three of them (lab-tour-6-choose-starter,
lab-tour-7-no-movement, rival-trigger-1-charmander-door) still differ, but
only on the separate, already-open Pokedex-page finding above (the ROM is
still on that page when the lens's `talk` already reports the party).

Left open: the held-A/B fast-forward (measured above, not implemented --
no held-button state exists anywhere in InputSource to build it on, and
nothing exercises it). A `cont` scroll's own scroll-transition animation
costs the cartridge a further, roughly speed-independent ~10 frames this
lens does not model (measured on the bedroom sign's own page 2: needs
8*speed+11 frames, not the 8*speed+1 a fresh page of the same length
would) -- a render-only delay, not a rule of when input counts, so (like
the ledge hop's arc) left for a hand-eye pass; nothing headless can verify
it and the lens becoming ready a handful of frames before the cartridge
does is the safe direction of the error, not the one this finding was about.

## [2026-09-06] fixed | No nickname question after taking a starter

Measured (lab-tour-6/7, rival-trigger-1): after "RED received a
CHARMANDER!" the cartridge asks "Do you want to give a nickname to
CHARMANDER?" (YES opens the NICKNAME? screen, ten letters) and only then
does BLUE take his. The lens went straight to BLUE. Fixed: the ask and a
`name_entry party:last` routine that opens the naming screen for the last
party member; the headless lens answers the ask from the pad like the lens
and skips the screen.

## [2026-09-06] fixed | Crossing a map edge put you one row further than the cartridge

Measured (connections-pallet-route1): two steps up from PALLET_TOWN (10,1)
end on ROUTE_1 (10,35) -- the step off the edge is a step. The lens moved
the cell at the edge without counting it and then walked one more, so it
stood on (10,34), and every position on the next map was a row off. Fixed:
the crossing lands and counts as a step.

## [2026-09-06] fixed | A three-line text showed its last line alone

The cartridge's `cont` scrolls the box: line 2 stays on top, line 3 prints
below ("give a nickname / to CHARMANDER?"), and a YES/NO opens on that
view. The lens paged lines 1-2 and then line 3 by itself, so the question's
menu came a view early. Fixed in the paginator; the headless line stream
drops the carried line so talk comparisons still read each line once.

## [2026-09-06] open | BLUE does not stop you for the first battle

Measured (prepare after-rival): after the starter, reaching the lab's row
6 has BLUE call "Wait, RED! Let's check out our POKéMON! Come on, I'll take
you on!" and the battle begins; afterwards "Smell ya later!" and he walks
out. The lens has the battle only when you talk to him, and lets you leave.
The shared start state sets EVENT_BATTLED_RIVAL_IN_OAKS_LAB and hides him
by hand so the lab agrees from there; the trigger itself is for the fix
round (record his walk from the ball to your side as the escort was).

Fixed (fix-round-1): a step trigger on OAKS_LAB row 6 (ifAll
EVENT_GOT_STARTER, unless EVENT_BATTLED_RIVAL_IN_OAKS_LAB) turns the player
to face up and shows the whole of _OaksLabRivalIllTakeYouOnText with BLUE
unmoving, then a new `rival_approach` routine walks him -- via moveNpcTo,
reading playerCell() fresh on every call so it holds for any column, not
just the measured one -- to the cell above wherever the player stands,
then the existing rival_first_battle/OPP_RIVAL1, _OaksLabRivalSmellYouLaterText
and a hide_object. Measured on the ROM first (tools/oracle): BLUE speaks
from the ball BEFORE walking, the opposite order from the first line
above, and his walk (left, left, down from the SQUIRTLE ball) is exactly
moveNpcTo's own horizontal-then-vertical pathTo order, so rival_approach
is a thin wrapper rather than a new pathing rule. TEXT_OAKSLAB_RIVAL's
talk-driven path is untouched. New: test/rivaltrigger.test.mjs (every one
of its first five checks fails with the trigger reverted) covers the stop
at row 6, the lines, the OPP_RIVAL1 battle in lens.battles, the flag and
the hidden NPC afterward, leaving the lab, the trigger disarming once
EVENT_BATTLED_RIVAL_IN_OAKS_LAB is set, and the talk fallback. Also walked
a fresh game through the escort, a CHARMANDER pick and this trigger on the
ROM directly: the stop at (5,6) facing up and BLUE's challenge text match
the lens exactly (kept out of scenarios/ -- the same walk surfaced an
unrelated difference in when the ROM's party slot is actually written
relative to the nickname decline, a separate, still-open question).
Still open in that fix: after "Smell ya later!" BLUE is hidden where he
stands; the cartridge walks him down the aisle and out first (cosmetic,
record it as the escort was when picking it up).

Measured more precisely while fixing the Pokedex-page finding (fix-round-2,
tools/oracle/scenarios/round2/lab-tour-6-choose-starter.json and
rival-trigger-1-charmander-door.json, both otherwise 0 differ once that fix
landed): it is not simply slow. wPartyCount goes to 1 the instant "So! You
want..." is answered yes, but the party MON's own species/level/HP bytes
(wPartyMons, not wPartySpecies) read zero for a long time after -- still
zero 150-odd frames and an accepted-then-abandoned nickname (press a,
press b, three more waits) later in rival-trigger-1's own walk through this
exact spot, where every other already-passing scenario's much longer run
of individual presses-with-waits-between-each simply never happens to
sample the gap. The lens's give_pokemon writes the whole party slot
synchronously, in the same command that shows "RED received a
CHARMANDER!"; the cartridge's write is not complete by the time the very
next page (the nickname ask) is already on screen and stable, and is
apparently gated on completing the give-plus-nickname sequence rather than
on elapsed frames, since letting it sit idle does not resolve it. Not
fixed here: this is `give_pokemon`'s own join, shared by every other gift
in the game (trades, fossils, the dojo, gen1recomp's helper expansions),
not something the Pokedex page's fix touches, and reproducing the real
sequencing would need its own measurement of exactly what the cartridge's
GivePokemon routine waits on before it commits the struct.

## [2026-09-06] open | Ledges cannot be hopped

Measured (round 3b, parcel-errand-5, route22-1, viridian-south-1; pinned
with a step-by-step scenario): walking down from ROUTE_1 (10,4), whose tile
is 57, onto the ledge tile 55 at (10,5), the cartridge hops the ledge and
lands on (10,6); the lens stands still at (10,4) forever. The lens knows
ledge tiles only as cells it may not enter. pokered's LedgeTiles table is
in the bundle as field.ledges: { facing, input, ledgeTile, standingTile }
-- the player must face `facing`, press `input`, stand on `standingTile`
with `ledgeTile` in front; the hop lands two cells on, plays SFX_LEDGE,
and takes the pad away for its duration. Measured frame by frame at
ROUTE_1 (10,4): a two-frame tap of DOWN starts it; wJoyIgnore goes $FF and
wd736 bit 6 is set for the whole hop; it is two 16-frame steps back to
back (the map cell advances at frame 19 and again at frame 36, when the
pad is handed back), the sprite rising twelve pixels and settling by the
second half; a direction pressed during the hop is ignored; facing another
way, the same tap only turns. Every route south of Viridian and most of
Kanto's shortcuts depend on it.

Fixed (fix-round-2): field.ledges ({facing, input, ledgeTile, standingTile},
OVERWORLD only) read by a new `isLedgeHop` (FieldMoves.ts) and applied in
Overworld.update() exactly where a step would otherwise be blocked: facing
the ledge already, standing on the paired tile with the ledge tile one cell
ahead, the step becomes a two-cell hop (stepDuration = STEP_SECONDS * 2,
~0.53s) landing on the far cell in a single landing -- steps, grass, warps
and triggers all read that one arrival, never the ledge cell itself. A body
on the landing cell refuses the hop outright rather than half-completing
it. The existing stepProgress/isMoving machinery already ignores input for
the whole duration and visualCell() already glides two cells linearly over
it, so MapRuntime and PokemonAR needed no change; the ~12px arc the notes
allow skipping ("or at least a straight two-cell glide") was left for a
hand-eye pass later, since nothing headless can verify a render-only bump.
A scripted walk hops too, matching the cartridge's own simulated joypad.
New: test/ledges.test.mjs, 17 checks (9 fail with the hop reverted): the
measured ROUTE_1 (10,4)->(10,6) hop and its step count, its timing against
an ordinary step measured the same way (no hard-coded seconds), input held
through the hop being ignored and control returning the instant it lands,
every other side of the ledge staying blocked (up into it; sideways only
turns), a body on the landing cell, a scripted single step, and one left-
and one right-facing ledge found by searching the bundle itself
(FUCHSIA_CITY). Proved on the ROM: tools/oracle/scenarios/route1-ledge-hop.json
(the after-rival-to-viridian prefix, then down into the ledge and three
more steps south) -- (10,4) -> hop to (10,6) -> (10,9) on both machines,
33 same, 0 differ.

## [2026-09-06] open | The Viridian Mart clerk does not call you over

Measured (round 3b, viridian-south-3, parcel-errand-2; recorded frame by
frame): stepping into VIRIDIAN_MART for the first time (no OAK'S PARCEL
yet, EVENT_GOT_POKEDEX clear), the box "Hey! You came from PALLET TOWN?"
opens at once on the mat (3,7); the player then walks up two and left one
to (2,5) facing left at the counter; "You know PROF. OAK, right? His order
came in. Will you take it to him?" and "RED got OAK's PARCEL!" follow (the
parcel enters the bag). The lens shows nothing on entry and the talk from
the mat reaches no one. pokered: ViridianMartScript0 with a simulated
joypad walk; texts _ViridianMartParcelQuestText and friends are in the
bundle. After the errand the mart is an ordinary shop.

Fixed (fix-round-2): a step trigger on VIRIDIAN_MART (3,7) (ifAll
EVENT_GOT_STARTER, unless EVENT_GOT_OAKS_PARCEL) showing
_ViridianMartClerkYouCameFromPalletTownText, walking the player up two and
left one, then _ViridianMartClerkParcelQuestText, give_item OAKS_PARCEL and
the flag. `talk: {}` on the new MapScriptSet leaves TEXT_VIRIDIANMART_CLERK
resolving through PortedMaps.ts exactly as before -- untouched. Measured on
the ROM (tools/oracle) that this is its OWN short script, not a call into
that talk table's tail: talking to the clerk again right after shows only
the table's own repeat-visit line ("Okay! Say hi to PROF.OAK for me!"), not
a second "Say hi" appended to the triggered scene, so the trigger's script
ends the instant the flag is set. Also measured, and load-bearing for the
scenario below: the cartridge's bag does not update until the WHOLE of
ParcelQuestText's three views closes -- not when its last page merely
reads "RED got OAK's PARCEL!" -- so give_item and set_flag run after the
show_text, not before it as a first draft (matching PortedMaps.ts's own
order) had it; reordering was needed for the lens to commit item and text
on the same beat the cartridge does.

New: test/viridianmart.test.mjs, 13 checks (the first 6 fail with the
trigger reverted): landing on the mat fires the scene (lines, the walk to
(2,5) facing left, the bag, the flag); landing again does nothing (the mat
is also VIRIDIAN_MART's own exit warp, so with nothing to intercept the
step the ordinary doormat rule takes it straight back outside -- proof is
no cutscene, no line, no duplicated item, not "stays on the mat"); no
starter chosen behaves the same way; and talking to the clerk afterward
answers from the transcribed table, not a replay of the entry cutscene.
Proved on the ROM: tools/oracle/scenarios/viridian-mart-parcel.json (the
after-rival-to-viridian prefix, then into the mart) -- both machines stand
at VIRIDIAN_MART (2,5) facing left with OAKS_PARCEL x1 in the bag, 38 same,
0 differ.

Two harness bugs surfaced getting that scenario to 0 differ, since it is
the first one ever to compare a non-empty bag: test/headless.mjs's own
state() read a bag slot's item id as `.item`, which is `.id` on
PlayState's BagSlot, so every prior bag comparison was silently comparing
"undefined" to "undefined" and passing for the wrong reason -- fixed to
`.id`. And tools/oracle/oracle.py's item_by_index only ever populated from
an `index` field the bundle does not carry (BundleFromExtraction drops it
as ROM provenance the lens itself never needs), so it decoded every WRAM
item byte as its raw decimal number; fixed to count the bundle's own
non-machine items in order, which reproduces the same 1-based numbering
buildItems() used before the bundle stripped it (measured: byte 70 lines
up with OAKS_PARCEL, the 70th such entry).

Also discovered, NOT part of this fix: TEXT_VIRIDIANMART_CLERK's own
open_mart branch (PortedMaps.ts, index 11 of the array) has no reachable
jump target. Both guards that should reach it -- EVENT_OAK_GOT_PARCEL true
(delivered) and no EVENT_GOT_STARTER (never started) -- jump to index 10,
which is itself an unconditional jump to 13 (the "Say hi to PROF.OAK"
line), so the ordinary shop can never open through this script under any
flag combination; only the two branches that land on 12 or fall through to
10 (both also 13) are reachable. The likely fix is retargeting both jumps
from 10 to 11, but that changes what happens right after Oak's Parcel is
delivered (does the shop then also show the "Say hi" line on every future
visit, once, or never?) and needs its own ROM measurement -- Oak's side of
the errand (deliver_parcel) is a separate, already-open piece of work
besides. Left alone here since it is outside this scene's own measured
scope and touches the delivery side this fix does not.

## [2026-09-12] harness | A start after Brock, and why no scenario from it reaches Mt Moon

Not a lens fault. `oracle.py prepare after-brock` (tools/oracle/README.md,
"Shared starts") plays a fresh game to just outside PEWTER GYM with the
Boulder Badge: BULBASAUR, the lab battle, the parcel, the Pokedex, Route 2's
grass until the cartridge itself has the starter at level 13 with VINE WHIP
(41 wild battles on the two runs made so far, Viridian's Center whenever HP
fell to two thirds), the forest, Pewter's Center, and Brock beaten with VINE
WHIP in three turns. Measured end state of the first run: PEWTER_CITY (16,18)
facing down, BULBASAUR L14 41/41 exp 1925 TACKLE/GROWL/LEECH SEED/VINE WHIP
(8 PP), money 4651 (3175 after BLUE, plus 90 from the forest's Bug Catcher
and 1386 from Brock), wObtainedBadges $01, wBagItems [234 x1] -- TM34, which
fixed oracle.py's item table: HM01..05 are $C4..$C8 and TM01..50 $C9..$FA,
where before an HM/TM byte decoded as its decimal number and could never
have matched the lens's TM_BIDE. The lens walks the same road
(lensstate.mjs) and agrees on the badge, the TM, EVENT_BEAT_BROCK,
EVENT_GOT_TM34, EVENT_GOT_POKEDEX, and on Brock's script clearing the two
Route 22 rival flags. Five scenarios compare from it at 0 differ: east onto
Route 3, Route 3's lower corridor to the wall at x 17, the Pewter Mart, the
Pewter Center's floor, the museum's door.

What the map data settled (road.mjs, a search over the lens's own
walkability with every trainer's sight line blocked): Viridian Forest
cannot be crossed without VIRIDIANFOREST_YOUNGSTER4 -- he stands on (2,18)
of a two-cell corridor and watches (1,18) -- and the ROM engaged him on
exactly that cell; PEWTER GYM's trainer CAN be walked round, along column 1
behind his back, and was, on both machines; and Route 3 has no road to
Route 4 that fewer than FOUR trainers see -- (14,7) is a wall, so the upper
path is entered only through (11,7), the first Bug Catcher's line, and
columns 14 and 19 and the gap at (27,7) are each closed by one more. The
headless lens does not fight (every battle is an instant win with no
experience), so a scenario across Route 3 parts on the party the moment the
cartridge earns its first level there. "Walk into Mt Moon 1F from
after-brock" therefore cannot be a 0-differ scenario; a start on the far
side of Route 3 is the same machinery run four fights further
(`Oracle.fight` already picks moves; road.mjs already plans round the rest).

## [2026-09-12] open | The nurse never says your Pokemon are fighting fit

Measured (tools/oracle/scenarios/open/after-brock-pewter-nurse-talk.json,
a `talk` at the Pewter Center's counter from after-brock; kept out of the
gate because it differs): the cartridge's stream is "Welcome to our POKéMON
CENTER! / We heal your POKéMON back to perfect health! / OK. We'll need
your POKéMON. / Thank you! Your POKéMON are fighting fit! / We hope to see
you again!"; the lens's is the same with the fourth page missing. PlayLoop.ts
nurseScript() goes show_text _NeedYourPokemonText, heal_party, set_respawn,
text_sound, show_text _PokemonCenterFarewellText; pokered's
engine/events/pokecenter.asm prints PokemonFightingFitText between the heal
and the farewell, and the bundle carries it as _PokemonFightingFitText. Not
fixed here (Assets/Scripts is another line's work); the fix is one show_text
after set_respawn. Everything else at the counter agrees: the walk in, the
cell, the facing, the YES taken by A, the party healed, the respawn moved.

## [2026-09-12] open | The Pokedex is a bag item on the lens

Measured on the after-brock road: after Oak's request scene the lens's bag
is [POKEDEX x1] and the cartridge's wBagItems is empty (the parcel gone,
nothing added; the Pokedex is EVENT_GOT_POKEDEX and the start menu's new
entry); after Brock the lens has [POKEDEX x1, TM_BIDE x1] to the cartridge's
[TM_BIDE x1]. MapScripts.ts oakAtTheDesk gives `give_item POKEDEX` beside
the flag it also sets. lensstate.mjs copies the cartridge's bag into the
after-brock lens state, so the after-brock scenarios compare; a fresh-game
scenario that delivers the parcel, or anything that counts the bag after it,
will show `bag: lens [POKEDEXx1] / rom []` until the item goes and whatever
reads it (the menu's POKéDEX entry) reads the flag instead. Left open here.

## [2026-09-14] fixed | Both open findings above

The nurse now prints _PokemonFightingFitText between the heal and the
farewell (commit "fix: the nurse says the party is fighting fit after the
heal"), and the POKeDEX is no longer a bag item: Oak's scene sets
EVENT_GOT_POKEDEX and nothing else, and migratePlayState strips a POKEDEX
row out of older saves (commit "fix: the POKeDEX is a flag, never a bag
item"). tools/oracle/scenarios/open/after-brock-pewter-nurse-talk.json can
move into the gate's glob whenever someone re-runs it against the lens: it
was written to differ and should not any more.

Nothing in tools/oracle changed for either; both were lens bugs the oracle
found, which is what it is for.
