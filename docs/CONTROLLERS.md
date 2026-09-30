# Playing it: the four ways in, and how to test each one

The game reads a D-pad, A, B and START. Nothing else. Four things can supply that,
and `InputRouter` picks whichever is actually answering, re-checking every frame, so
a controller that arrives mid-session takes over without a restart. The status line
under the world names the winner: `[panel]`, `[phone]`, `[gamepad]`, `[scripted]`.

The contract is `Assets/Scripts/play/InputSource.ts`. A source that holds a hardware
object but never reports counts as silent -- that distinction is the whole reason
this file exists, because a source that lies about being connected wins the router
and then swallows every input while the character stands still.

| Source | Where it works | Needs |
|---|---|---|
| `panel` -- the Game Boy plate, and the editor's keyboard | preview and glasses | nothing |
| `phone` -- the wearer's phone through the Spectacles App | glasses only | the Spectacles App, paired and calibrated |
| `gamepad` -- an Xbox or SteelSeries pad over Bluetooth | glasses only | Experimental APIs, Extended Permissions, `enableBleController` |
| `scripted` | everywhere | nothing; it is the fallback and the LEAF harness |

## 1. The preview: mouse and keyboard

Click the Game Boy plate under the world (hover a button first, then click -- that is
how SIK's mouse interactor works), or type: `I` `J` `K` `L` walk, `Z` is A, `X` is B,
`space` is START, `shift` is SELECT, `O` and `P` zoom out and in. The arrow keys work
too but the preview's own camera also takes them, so IJKL is the pair that does not
fight.

Proof it is bound, in the preview log at every reset:

    [PokemonAR] keyboard: on (arrows or IJKL walk, Z=A, X=B, space=START, O/P zoom out/in)
    [PokemonAR] input sources: gamepad=silent phone=silent panel=silent scripted=reporting

Both hardware sources construct in the editor and both correctly report silent: the
Bluetooth stack and the Spectacles App are not there. That line is the check. A
source reading `reporting` in preview would be the bug.

## 2. An Xbox pad on the laptop, in the preview

Lens Studio has no gamepad API, and the package the lens uses on the glasses reads
Bluetooth from the GLASSES, so a pad paired to the Mac cannot reach the preview by
any route the lens owns. What the preview does read is the keyboard, so the bridge
types for you:

    tools/padbridge/run.sh            # builds on first run, then stays running

    d-pad / left stick -> I J K L        A -> Z          B -> X
    Menu (start)       -> space          View -> shift   LB / RB -> O / P zoom

Start with `--test`, which reads the pad and posts nothing:

    tools/padbridge/run.sh --test     # press buttons, watch them land

It needs no permission at all, so it tells a pad problem apart from a permission
problem before either can be blamed for the other. A wired pad works: over USB an
Xbox pad arrives through macOS's GameController framework as `pad connected:
Controller`, measured on this Mac. Bluetooth works the same way.

Then two things gate the real run, and it says so rather than failing silently:

- **The pad reaching the Mac.** A USB cable is enough. Over Bluetooth: hold the
  pad's pairing button until the Xbox light flashes fast, then System Settings >
  Bluetooth > Connect. Either way the bridge picks it up while running; it does not
  need restarting.
- **Nothing else in the way.** macOS hands controller input to the frontmost
  APP, and a command-line tool has no application to be frontmost with, so the
  bridge asks for background events explicitly. Without that one line the pad
  connects, names itself, and never delivers a button -- which is exactly what
  "it connects but nothing happens" looks like.
- **Accessibility**, for the app you run it from (Terminal, iTerm, Claude Code):
  System Settings > Privacy & Security > Accessibility. Posting keystrokes is exactly
  the capability that gate exists for. Without it the bridge reads the pad and
  nothing arrives. It asks on first run, which is also what puts it in that list --
  an app that has never requested the permission is not there to be ticked.

It only types while Lens Studio is frontmost, so a nudged stick cannot type into
another app; `--any-app` lifts that and `--verbose` prints every key. Ctrl-C lets go
of everything it is holding.

A held direction is re-posted at 20 Hz because macOS generates key repeat for real
keyboards and not for synthetic events, and the lens reads a hold as a stream of
repeated presses. The buttons are not repeated: a menu confirm must fire once.

## 2b. Hands: pinch to walk, pinch to press

Since 19 September the hands are a controller on their own, not only a way to
move the world:

| Gesture | What it does | Where |
|---|---|---|
| Pinch a cell of the diorama | Red walks there over the cartridge's own collision (`world/PathFind.ts`, `play/RouteSource.ts`) | `PokemonAR.walkTo` |
| Pinch a person, a sign, a shelf | Red walks up to it, turns to it, and presses A: pointing at someone is talking to them | `RouteSource` faceCell |
| Pinch the exit mat of a house | Red walks onto it and presses into the edge until the door takes him -- the mats fire only with the pad held toward the edge | `RouteSource` exit |
| Pinch Red's own cell, or the cell he faces | A | `PokemonAR.pinchAt` |
| Pinch anywhere off the world | A -- on EVERY frame: a page of text, the FIGHT menu, the life-size battle | `play/InputSource.ts` PinchSource, `PokemonAR.driveWorldHands` |
| Pinch the rim and drag | move the world | `play/DioramaHands.ts` |
| Pinch the rim and let go without moving | the same press as beside it (the rim is a third of the plate; the outer cells of every town live there) | `play/DioramaHands.ts` |
| Two hands, pinch and pull | scale, and turn | `play/DioramaHands.ts` |
| The loose buttons (BUTTONS = AUTO, the default) | the Game Boy's own A, B, D-pad, SELECT and START, with no plate, below the line of sight; gone while a phone or a pad is connected, ON and OFF on the OPTION page's VIEW list override that | `play/screen/LooseButtons.ts` |
| A hand on a button | is not also a joystick or a grab of the rim, for as long as the button is down | `PokemonAR.padInUse` |

The route is an input source: its steps go through `Overworld.update` like a
thumb on a pad, so grass rolls encounters, warps and triggers fire, and a body
in the way blocks it. Any real direction cancels it; so does a second without
progress, or a box, a script or a fight taking the frame. It presses in the
map's directions and un-turns them for the wearer's view (`turnPress`).
`test/route.test.mjs` walks Pallet Town and Red's house headless.

Until 19 September the hands were read at the END of the overworld's frame,
after the early returns for a page, a menu, a script and a battle -- so a pinch
did nothing on exactly the frames a pinch is for. `driveWorldHands` now runs
before the router reads its buttons. Oak's escort, the lab, the starter and
the rival battle were played in the preview with nothing but pinches.

### Testing the pinch without glasses

- **Lens Studio MCP, `PreviewInteractTool`** (needs `Packages/AiPreviewAgentInteract.lspkg`,
  installed): `Pinch` at a `worldPosition` puppets SIK's own `TrackedHand` --
  `isTracked` pinned true, `isPinching` and the index tip driven -- which is
  exactly what `DioramaHands` reads. A `Hover` at the point first, then the
  `Pinch` (250 ms), or the pinch begins while the hand is still travelling
  and is thrown away as a drag. The cell under a world point: the plate
  re-centres on the player, so `x = (cx - px) * 7`, `z = -105 + (cy - py) * 7`
  at the default zoom (7 cm per cell), or ask the lens with
  `testCellWorldPosition`. Pinch far outside the plate (`x = 85`) for A.
- **LEAF `pinch-walks-there`** (`Assets/Scripts/leaf/PinchWalksThere.ts`):
  the tap at a world point through the diorama's real transform, the walk,
  the walk-up-and-talk, and three pages read by pinching beside the world.
  It drives the tap the hand produces (`testPinchAt`), not SIK's hand: LEAF's
  own hand rig moved the hand mesh but not its keypoints in this preview (the
  index tip stayed at its hidden position), so the lens never saw it.
- **The keyboard cannot pinch**, and its arrow keys steer the preview camera
  as well as the lens; use I/J/K/L with a start/end pair.

## 3. The phone, through the Spectacles App

This is the publishable controller: no package, no pairing code, no Experimental
APIs. It exists only on the glasses -- the phone talks to the glasses, not to Lens
Studio -- so it cannot be tested in the preview at all, and the decode is covered
offline instead (`test/motioncontroller.test.mjs`, 58 checks, in `tools/verify.sh`).

To test it on the glasses:

1. Send the lens to the connected Spectacles (not Preview in Snapchat).
2. Open the Spectacles App on the phone, run the calibration step, and switch the
   `Controller` toggle on.
3. Touch the phone's screen. The status line should flip to `[phone]`, and the log
   prints the transition with its evidence:

       [phone] reporting available=true queried=true framesSinceTouch=0

   `queried=false` would mean this build has no `isControllerAvailable()` and liveness
   is resting on arriving touches alone -- surprising, since both target SDKs (5.15.4
   and 5.23) declare it. `silent` with `framesSinceTouch` climbing means
   the controller object exists but nothing is coming from the phone -- the toggle is
   off, or the calibration did not finish.

**The buttons are drawn in the glasses, on the phone.** The Spectacles App's
controller screen is the app's own -- a dotted rectangle -- and the API gives a
lens touches, the touchpad's size in centimetres, the phone's pose and its
haptics, but no canvas on the handset. So the pad is drawn where the phone is:
a quad at its tracked position, at the size the phone says its touch surface is,
facing the wearer, with the zone under the thumb lit and a tick through the
phone as each one is entered. Look down and a Game Boy pad is lying on your
handset. Real buttons on the phone's own screen would mean building a companion
app with Spectacles Mobile Kit (BLE, bonded once) -- a separate project.

The touch surface is a D-pad with a button in the middle and two in the corners:

    +-----------------------------+
    |              UP             |    tap the centre         -> A
    |                             |    hold the centre 350ms  -> B
    |    LEFT   ( A / B )   RIGHT |    tap a bottom corner    -> START / SELECT
    |                             |    anywhere else, held    -> a direction
    | [START]     DOWN   [SELECT] |
    +-----------------------------+

START used to be a SECOND FINGER put down anywhere while the first was still on
the glass. A playtest on the glasses (7 September) walked into the nickname
screen and could not get out: an invisible gesture on a surface you cannot draw
on is not a button. Both corners are drawn now, they buzz when you hit them, and
they fire on release only if the finger stayed where it landed -- so a thumb
resting on START does not also walk you into a wall.

## 4. An Xbox pad paired to the glasses

Off by default. Set `enableBleController` on the PokemonAR component, and the lens
needs Experimental APIs plus Extended Permissions in the project settings. Both carry
a price worth knowing before a demo: a lens using them **cannot be published**, and
recordings get an "Experimental Mode" watermark that may not be removed. Pair the pad
to the glasses the way the BLE Game Controller sample does.

**Answered, 7 September, from the Spectacles docs themselves** (the local mirror,
`docs-index/spectacles/.../apis/bluetooth.md` and `.../permission-privacy/
experimental-apis.md`):

- Using the Bluetooth GATT API "will disable access to privacy-sensitive user
  information in that Lens, such as the camera frame, location, and audio."
- Extended Permissions give the camera frame **and the open internet** back at the
  same time -- so BLE and the ROM bridge are NOT exclusive, which was the open
  question -- but "lenses built this way may not be released publicly".
- Experimental mode is unambiguous about it: "When your Lens project uses
  experimental mode, you cannot publish the Lens to a wider audience, and it
  remains self-contained to your Lens project and device." Recordings carry the
  "Experimental Mode" watermark and removing it is prohibited.

**So the pad is a development and demo controller, not a shipping one.** For
anything that has to be published -- the Community Challenge submission included --
the phone (section 3) is the controller: no package, no pairing, no Experimental
APIs, and no watermark.

One flag worth carrying to the device: the same Bluetooth page says "Bluetooth
support is currently limited to GATT devices. HID (Input) devices are not supported
at this time." An Xbox pad is an HID device, and it reaches Spectacles as HID-over-
GATT. The vendored package is built from Snap's own BLE Game Controller sample, so
the sample evidently works -- but nothing here has confirmed it on hardware, and
that sentence is the reason to confirm it before building anything on top.

### What the pairing actually is

There is no pairing screen and no code to type. `GameController.scanForControllers()`
scans and **connects to the first compatible controller it finds** by itself, and
re-scans on disconnect.

**And until 9 September nothing ever called it.** The lens built the singleton and
stopped there, so `enableBleController` turned on an input source that could never
report -- whatever was done with the pad. The package's own re-scan only fires on
DISCONNECT, which cannot happen before a first connection, so there was no second
path either. This paragraph used to say "start the lens and it scans and connects",
which was true of Snap's sample and not of us.

`GameControllerSource.beginScan()` is the call, made from `onAwake` next to the
source it belongs to, and `test/gamepad.test.mjs` is the regression: a source that
was never asked to scan reports `unavailable` and the fake controller counts zero
scans.

The flow, now that there is one:

1. **Unpair the pad from the Mac first** (section 2 pairs it there for the
   bridge). An Xbox pad advertises only in pairing mode and otherwise goes back
   to the host it is bonded to; the Bluetooth page says the same thing --
   "If your device pairs to your phone ... you may need to reset it so it can
   pair to Spectacles".
2. Hold the Xbox pad's pair button until the Xbox light flashes fast.
3. Start the lens with `enableBleController` on.
4. Read the panel. It hangs in front of you, wherever you are looking, from the
   first frame -- title screen included -- and it stays up until a pad reports.

### What the panel says, and what each line means

The panel is `PadStatusPanel`, drawn with the runtime's own font rather than the
cartridge's, so it works with no ROM and no world. Its lines come from `PadScan`,
which is a state machine with ten named states, a deadline on every wait, and a
test that no state is silent (`test/padscan.test.mjs`):

| Line | What it means | What to do |
|---|---|---|
| `PAD: SCANNING 14s (TRY 1/3)` | A scan is running and the number is counting down | Hold the pairing button |
| `PAD: 2 SEEN, 9s LEFT (TRY 1/3)` plus `SEEN <name> -61 dBm` | The radio IS receiving advertisements. This is the line that separates "the glasses cannot see the pad" from "the glasses see it and cannot talk to it" | Keep holding; check whether the pad's own name is in the list |
| `PAD: CONNECTING TO Xbox Wireless Controller` | A GATT connect is in flight, with a 15-second deadline | Keep the pad awake |
| `PAD: LINKED, NO INPUT YET` | The GATT link is up and nothing has been sent | Press a button on the pad |
| `PAD: LIVE, 37 REPORTS` | HID reports are arriving. The panel disappears six seconds later | Play |
| `PAD: NOTHING FOUND (TRY 2/3)` | A scan window ended with no known controller | Unpair from the Mac, then hold pairing |
| `PAD: FAILED` plus `WHY: ...` | Something refused, with its reason | Usually Experimental APIs or Extended Permissions |
| `PAD: NO BLUETOOTH HERE` | The stack does not exist: preview, or the two permissions are off | Use the phone or the pinch |
| `PAD: NO CONTROLLER FOUND` | Three scans, nothing found. It stops asking | Use the phone or the pinch |

Every one of those also carries the last line, in every state:
`Pinch = A. Phone: Spectacles App > Controller.` -- because there is always a way
to play, and saying so only after the pad has failed says it too late.

The same lines go to the log once per change, as
`[PokemonAR] [pad] scanning try=1/3 seen=0 reports=0 left=14.3s`, which is how a
playtest recording can be read afterwards.

**The scan now has an end.** It was 10000 seconds -- two hours and forty-seven
minutes, against 10 in Snap's own current BLE-HID sample -- so the promise that
resolves when a scan finishes never resolved, and "still looking" and "refused in
the first millisecond" produced identical logs. It is 20 seconds now, three
attempts, five seconds apart, and then it says it has stopped. This paragraph
used to say the opposite ("it keeps looking, and a pad put into pairing mode two
minutes later is still found"), and that assumption is what the silence was made
of.

### What is still unproven, and the honest possibility

None of this makes an Xbox pad pair. It makes the attempt observable. Four
things in the platform's own documentation point the other way, and one device
run with the panel above will settle it:

- "Bluetooth support is currently limited to GATT devices. HID (Input) devices
  are not supported at this time."
- HID-over-GATT only notifies over a **bonded, encrypted** link, and the Lens API
  has no pairing or bonding call at all -- `connectGatt` only connects.
- Snap's own working BLE-HID sample states that the device "is now paired/
  connected at the system level" -- it assumes OS-level pairing that a Lens
  cannot perform.
- The pad is bonded to the Mac by section 2 of this very document, so it does not
  advertise to anything else until it is reset.

The three outcomes the panel can now distinguish, and what each one means:

1. **No `SEEN` lines at all.** The radio received nothing. Either the pad is not
   advertising (still bonded to the Mac), or HID advertisements do not reach a
   Lens.
2. **`SEEN` lines, then `NOTHING FOUND`.** The glasses hear devices but none is a
   known controller -- the filter, or the pad advertising without its name.
3. **`LINKED, NO INPUT YET` for ever.** The link works and nothing notifies: the
   encryption requirement above. `linked, but nothing on the pad would notify`
   in the log says the same thing from the vendor's side.

If it is 1 or 2, the answer is that this vendor code cannot pair an Xbox pad from
inside a Lens, the pad stays a development aid behind its flag, and the phone
(section 3) is the controller -- which is what this document already calls the
publishable one.

## What is actually proven, and by what

- The keyboard and the panel: bound and driving the game in the preview, every run.
- The phone's gesture decode and its router takeover: 58 offline checks.
- The panel and the key mapping: 56 offline checks.
- That the lens ASKS for a pad at all: 34 offline checks (`test/gamepad.test.mjs`),
  including the two that were wrong -- a source built but never told to scan, and
  a source that called a merely-SEEN controller "connected" and took the router
  away from the panel with it.
- That the pad's state is never silent: 172 offline checks
  (`test/padscan.test.mjs`). Every one of the ten states is reached through real
  transitions, and each has to produce a title no other state shares, advice, a
  log line, and no blank row.
- The Xbox pad on the laptop: the bridge builds, runs, and finds a wired Xbox pad
  (`pad connected: Controller`). It now also says so when the pad stays silent --
  a line every five seconds until the first input arrives, because a connected
  pad that reports nothing is the failure this had. **The buttons have not been
  through it here**; run `--test` and press each one once.
- The phone on the glasses, and the pad on the glasses: not tested. Neither can be,
  without the hardware in front of them.
