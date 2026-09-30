# Local patches to the vendored GameController

Source: `Spectacles-Sample/BLE Game Controller` (`GameController.lspkg`).
Vendored under `Assets/` rather than installed as a package so that path-based
imports survive the fresh meta generation of the Lens Studio 5.15 downgrade.

Only the files the lens actually needs were copied: `GameController.ts`, the four
files under `Scripts/`, `Decorators/Singleton.ts`, and the three under
`SupportedControllers/`. The sample's `SceneController` and `AnimationController`
are demo scaffolding and were left behind.

## Patches

The upstream copy does not typecheck against Lens Studio 5.23's `StudioLib.d.ts`,
because the Bluetooth API changed after the sample was published.

1. **`startScan` predicate returns a boolean.** Upstream returns nothing. The
   predicate is what stops the scan, so returning `void` both fails the type check
   and leaves the scan running until it times out.

2. **`onConnectionStateChangedEvent` and `Bluetooth.ConnectionState` are gone.**
   5.23 exposes `BluetoothGatt.onDisconnectedEvent` instead, and `connectGatt`
   resolves only on success, so "connected" is the code path after the `await`
   rather than a state to wait for. The connect body was lifted out of the old
   state callback accordingly.

## Patches of 9 September: everything that failed here failed silently

A recon pass counted **seven** places where a failure in the pad's path
disappeared without a trace, and **zero** prints between `starting scan...` and
`Found device:`. The wearer's whole experience of the pad was one log line and
then nothing, for every possible outcome. These patches do not make a pad pair;
they make the attempt observable. Each one is marked `PATCH:` in the source.

3. **The scan had no reachable end.** `timeoutSeconds: 10000` -- two hours and
   forty-seven minutes -- against `10` in Snap's own current BLE-HID sample
   (`BLEKeyboardManager.ts:216`). The promise that resolves when a scan finishes
   never resolved, so `scan complete...` never printed and "still looking" was
   indistinguishable from "refused immediately". Now `setScanWindow()`, driven by
   the same constant the wearer's countdown shows (`SCAN_WINDOW_SECONDS`, 20 s).

4. **`ScanFilter` and `ScanSettings` were object literals cast with `as`.** A
   cast satisfies the compiler and hands the runtime a plain object where it
   expects a `ScriptObject`. Both are `new`ed now, and `scanMode` is set to
   `Balanced` -- upstream left it at `Unset`, where Snap's sample sets it
   (`BLEKeyboardManager.ts:217`).

5. **The predicate connected, and returned `true` for the first device of any
   kind.** `scanResult.deviceName.includes(...)` on a device with no name throws
   -- `deviceName` is `string | null` by declaration and nameless BLE devices are
   normal -- inside a fire-and-forget `connectGATT(result)` with no `.catch`, and
   the scan had already been stopped by the `return true`. One nameless device in
   the room ended the whole attempt permanently and silently. The predicate now
   logs every raw advertisement (name or `NO NAME`, plus RSSI), returns `false`
   unless a registered controller claims the name, and connecting happens after
   the scan settles, inside a `try`/`catch`.

6. **`currController` was built from a NAME, before any connection.** That object
   answers `getButtonState()` with `BaseController`'s all-false default, so every
   layer above believed a pad was attached the moment one was merely visible. It
   is built after `connectGatt` resolves now, and cleared on disconnect. See also
   `reportCount()`, below, which is what the lens actually trusts.

7. **Notify registration could be skipped in silence.** Upstream tested
   `properties.includes(CharacteristicProperty.Notify)` and, when false, fell
   through to the descriptor branch and registered nothing -- no log, no state
   change. A HID Report characteristic on an encrypted link reports
   `NotifyEncryptionRequired`, a different enum value. Registration is now
   attempted for either, and for `Indicate`/`IndicateEncryptionRequired`, in a
   per-characteristic `try`/`catch`, with the property list logged either way,
   and `linked, but nothing on the pad would notify` reported when nothing took.
   `forEach(async ...)` was replaced by real loops: every `await` inside those
   callbacks was unobserved.

8. **`reportCount()`, `watch()` and `say()` are new.** A delivered HID report is
   the only honest evidence that a pad exists, so the counter is public and the
   owning `GameControllerSource` asks for it instead of for `getButtonState()`.
   `watch()` gives the lens one place to hear `scan` / `seen` / `connecting` /
   `linked` / `report` / `lost` / `error`, which is what `PadScan` turns into the
   panel the wearer reads.

9. **The Bluetooth module is required lazily.** Requiring it disables the camera
   frame, location and audio unless Extended Permissions is on -- and the camera
   frame is what WorldQuery and world tracking live on. Upstream paid that cost
   at module scope, i.e. on import. Snap's sample loads it behind a getter for
   exactly this reason (`BLEKeyboardManager.ts:33-41`).

10. **The disconnect handler no longer rescans when someone is watching.** The
    owning source runs a bounded retry loop of its own, and two concurrent
    `startScan` calls are worse than none.

## Untested

None of this has run on hardware yet. The Bluetooth module does not exist in Lens
Studio preview, so `GameControllerSource` degrades to "not connected" there by
design. On device it additionally needs Experimental APIs and Extended
Permissions, and Spectacles OS v5.63+.

**And it may never work.** The platform's own Bluetooth page says "HID (Input)
devices are not supported at this time"; HID-over-GATT only notifies over a
bonded, encrypted link; the Lens API has no pairing or bonding call, only
`connectGatt`; and Snap's own working HID sample requires the device to be paired
at the OS level first, which a Lens cannot do. The patches above exist so that
one device run can tell those apart rather than guessing -- see
`docs/CONTROLLERS.md` section 4 for the three outcomes and what each one proves.

## Patches of 9 September, second pass: following the sample again

Joshua, after the third playtest still could not pair a pad: "je moet volledig
de sample en tutorial volgen". He was right, and the place we had drifted from
it is the one place where drifting is silent.

Snap's sample (`specs-devs/context/packages/GameController`) connects like this:

    predicate sees a device -> connectGatt -> onConnectionStateChangedEvent
    -> state == Connected -> stopScan() -> getService(HID)
    -> getCharacteristics() -> registerNotifications

Every one of the last four is INSIDE the Connected branch. Patch 2 above moved
them out, on the grounds that 5.23 has neither `onConnectionStateChangedEvent`
nor `Bluetooth.ConnectionState` and resolves `connectGatt` only on success.
That reasoning is correct about 5.23 and wrong about the device.

**5.15.4 builds the lens that goes on the glasses, and 5.15.4 is the version
the sample was written against.** Its own `StudioLib.d.ts` says so in the
`connectGatt` documentation: *"Asynchronous call: to detect when the device is
connected listen on the `Bluetooth.BluetoothGatt.onConnectionStateChangedEvent`"*.
`ConnectionState` exists there (`StudioLib.d.ts:2750`) and does not exist in
5.23 at all. So on the device, awaiting `connectGatt` returns before the device
is connected, and the code that ran straight afterwards asked a half-made link
for its HID service. What comes back is nothing, and the lens then reports
`linked, but nothing on the pad would notify` -- a true sentence about a bug in
the caller, which is the worst kind of log to be handed.

9. **The connection is taken where the sample takes it.** `takeConnection()`
   holds the sample's Connected branch; `connectGATT` binds
   `onConnectionStateChangedEvent` and calls it from the `Connected` state,
   preferring that path whenever the runtime has it, and falls back to the
   after-await path only on a runtime with no `ConnectionState` (5.23). It also
   reads `gatt.connectionState` once after binding, because the event can fire
   before there is anything bound to it.

10. **`stopScan()` moved to the connection.** The sample keeps the radio
    looking while it connects and stops it once connected. Stopping on the
    sighting throws away the only thing that can still find the pad if the
    connection does not take.

11. **The scan window is 60 s and the connect window 30 s.** The sample asks
    for 10,000 seconds and never means the scan to end by itself -- the
    predicate connects, returns nothing, and `stopScan()` ends it. A lens
    cannot copy that number (patch 3), but 20 s was the opposite mistake: it is
    gone before a wearer has found the pad and held its pairing button. 15 s
    for a connection was worse than useless on 5.15, where bonding happens
    inside that window: it did not detect a dead connection, it caused one.

`test/padconnect.test.mjs` pins the order, by reading this file as text -- the
decorator and the `Map<>` here mean Node cannot import it, and the thing worth
pinning is an order rather than a return value.

12. **The predicate connects, and the radio keeps looking.** The sample's
    predicate calls `connectGATT` and returns nothing, so the scan runs on
    until the connection stops it. Patch 5 replaced that with `return true`,
    which stops the scan on the SIGHTING -- and a pad whose connection then
    fails is only reachable again while the scan that found it is still
    running. The connection is still caught where it is started, which is the
    half of patch 5 worth keeping: a predicate is not awaited, so a throw there
    is an unhandled rejection and the wearer is told nothing.

13. **A scan ending after a link is not a failure.** BLE Playground is explicit
    about `startScan`'s rejection path: it "Fires on calling
    `bluetoothModule.stopScan()` AND on scan timing out"
    (`BleServiceHandler.ts:132`). Taking a connection calls `stopScan`, so
    success arrives in the catch too.

14. **The editor is never taken near the radio.** BLE Playground branches on
    `global.deviceInfoSystem.isEditor()` before every Bluetooth call, in nine
    places, because "Bluetooth does not work in Lens Studio Preview". Every
    scan spent failing in preview is a scan out of a budget the wearer needed
    on the glasses.

## Still not the sample

One difference is left, and it cannot be settled from code. Snap's Bluetooth
doc says to "add the BluetoothCentralModule to your project", and BLE
Playground takes it as an `@input`
(`BleServiceHandler.ts:23`) -- an ASSET in the project. The GameController
package instead does `require("LensStudio:BluetoothCentralModule")`, which is
what this file does, and neither project here has a `.bluetoothCentralModule`
asset. Whether Lens Studio derives the lens's Bluetooth permission descriptor
from the asset or from the require is not documented anywhere we can read, and
guessing at it would need a scene change in the 5.15 project that no gate here
can verify. It is the first thing to try if a scan on the glasses still reports
`adapter unknown`.

## 10 September: the guard that deadlocked the lens

Patch 1 above refused to scan unless the adapter reported `Available`. On the
glasses that is a deadlock, and it cost a whole test: Joshua landed straight on
the Game Boy screen with "PAD: NO BLUETOOTH HERE" under it, Xbox pad in pairing
mode, nothing ever scanning.

`BluetoothStatus.Unknown` is documented as "the Bluetooth permissions or status
have **not been established**". It is not a refusal. Asking is what establishes
them -- so a lens that waits for `Available` before it asks waits for ever: the
permission is never granted, because nothing ever requests it.

15. **Only a definitive NO blocks a scan.** `adapterBlocked()` is
    `PermissionDenied`, `Unavailable`, or the editor. `Unknown` is tried,
    which is what turns it into an answer. `adapterReady()` still means
    "definitely available" and is no longer what gates the scan.

16. **The status is on the panel whatever it is.** `adapterProblem()` names the
    number in every branch ("status 0", "status 1", "status 2"), and
    `PadScan.noteAdapter` keeps it across the scan that follows -- `why` is
    cleared when a scan starts, and the adapter's answer is exactly what a scan
    finding nothing needs to be read against. On the glasses the panel is the
    only place that number exists.

## 10 September, second pass: a pad with no name in its advertisement

Joshua: "ik zie wel apparaten binnenkomen bij de scan maar hij pakt de xbox
controller niet ofzo." The radio works and advertisements arrive. What throws
the pad away is the match.

The scan filters on service UUID 0x1812 -- which is the PLATFORM answering
"does this device advertise HID" -- and then the predicate ALSO required
`deviceName.includes("Xbox")`. Two gates for one question, and the second one
is not answerable from an advertisement: a BLE local name is optional, and on
plenty of peripherals it lives in the SCAN RESPONSE, which a passive scan never
asks for. `ScanResult.deviceName` is `string | undefined` in 5.15's own
declarations for exactly this reason. A pad that passed the filter was dropped
for having no name.

Snap's sample never hit this because it only ever tested against pads that do
advertise one, and its own `ScanResult` handling would throw on a null name
(patch 5).

17. **A nameless device that passed the HID FILTER is adopted.** Only on a
    filtered pass, and only when `isConnectable`. On a sweep there is no
    filter, so a nameless device is any device in the room -- and Snap's
    guidance for this exact sample is that discovery "must not connect to the
    first arbitrary BLE device".

18. **Microsoft's company id (0x0006) counts as a match.** It is the one thing
    about an Xbox pad that survives an advertisement with no name, and it is
    on `ScanResult.manufacturerData` / `manufacturerId`, which 5.15 does expose.

19. **The layout is settled by asking the DEVICE.** `nameOverGatt()` reads
    Generic Access (0x1800) -> Device Name (0x2A00) after connecting, which is
    where the real name lives. A HID device that still matches no registered
    controller is reported as exactly that rather than driven with the wrong
    report layout.

20. **Only the middle attempt sweeps.** A filtered pass is the one that can
    adopt a nameless pad, so two of the three keep the filter up.

### The wall after this one

Discovery is not the only thing standing between this lens and an Xbox pad,
and the next one may not be ours to move. Independent reports from people
doing exactly this from a BLE central agree: you connect, you find the HID
service, you write the CCCD to 0x0100 -- and no notifications arrive, with the
controller's LED still blinking.

> "I can read HID info map and register notification (I checked CCCD become
> 0100 from 0000) but any notification is not published and a led on the
> controller is blinking" -- NimBLE-Arduino issue 172

The consensus in those threads is that the pad wants BONDING, encryption and
LE privacy before it will send reports; the Linux driver (xpadneo) uses L2CAP
and privacy settings for this. A Lens has no API to initiate bonding, which is
the concrete meaning of Snap's own line that "HID (Input) devices are not
supported at this time". If we get there, `linked, but nothing on the pad would
notify` is the message, and it will be true.

## 10 September, third pass: reading the tutorial again

Joshua had done everything the README asks and the pad was still not seen.
Reading it once more turned up two things, one of them ours.

21. **The scan is asked for at START, not at AWAKE.** Snap's SceneController
    calls `scanForControllers()` from `onStart` (`SceneController.ts:47`); this
    lens called it from `onAwake`. That is not cosmetic. On the glasses the
    adapter reported status **5**, and `BluetoothStatus` has four members
    numbered 0 to 3 in both 5.15 and 5.23. A number outside its own enum is
    what a module that has not finished coming up looks like -- so we were
    asking, and scanning, too early. The source is still built in `onAwake`,
    because the input router needs it before the first frame; only the scan
    moved.

22. **The count on the panel was the length of a capped list.** "N SEEN" read
    `sightings.length`, and `sightings` keeps the last `SEEN_KEPT` only -- so a
    scan that saw four devices and one that saw forty both showed the cap, for
    ever. That is the difference between "the room is quiet and your pad is not
    advertising" and "the room is full and yours is not among the few still on
    screen", which is the exact question being asked. `seenTotal` counts every
    advertisement; the kept list went from three to six.

The line in the README worth repeating, because it is not what this lens does:

> "Simply pair your Bluetooth controller with your Spectacles device before
> launching the lens for optimal experience."

The controller is meant to be bonded to the DEVICE, and the lens then finds an
already-bonded pad. Snap's support documentation covers pairing the glasses to
a phone and says nothing about pairing an accessory to the glasses, so where
that is done -- if it is exposed at all -- is not something this repository can
answer.

## 10 September, fourth pass: asking for the pad by identity

Joshua: "kunnen we met de controller niet actief zoeken naar een xbox
controller inplaats van algemeen bluetooth controllers". We can, and 5.15's
own `ScanFilter` had the two fields for it the whole time.

`startScan` takes a LIST of filters, and the 5.15 documentation is explicit
about how the list is read: *"If a device passes any filter then the predicate
will be invoked for that device."* They are alternatives, not conditions, so
adding one can only widen the net.

23. **Three questions instead of one.** `buildFilters()` asks for the HID
    service (what a game pad IS), for Microsoft's company id
    (`ScanFilter.manufacturerId`, which an Xbox pad puts in its manufacturer
    data and which survives an advertisement with no name), and for each exact
    name a supported pad advertises under (`ScanFilter.deviceName`).

    The name filter is not the same question as the substring test in
    `controllerFor`. That one sifts a result that has already arrived; this one
    tells the PLATFORM what to look for -- and on most stacks a name filter
    means an ACTIVE scan, where the scanner sends a scan request and reads the
    scan RESPONSE. A BLE local name usually lives in the scan response, and a
    passive scan never sees it. That is the whole reason the pad could pass a
    service filter and still arrive with `deviceName` empty.

    `deviceName` is an exact, case-sensitive match (Snap's Bluetooth doc says
    so), so `ADVERTISED_NAMES` holds whole names while `controllerFor` keeps
    its substrings.

    Every filter is built in its own try/catch. A runtime that rejects one
    property costs that one filter, not the scan: the service filter alone is
    where this started and still has to work.

The sweep still passes no filters at all, so it remains the honest measurement
of what is in the room.

## 10 September, fifth pass: what the open-source projects actually do

Three filters and the pad is still not seen. Research into the projects that
demonstrably drive an Xbox pad from a BLE central turned up two things that
change what is worth trying.

**The working client matches on a hardcoded MAC address.**
`asukiaaa/esp32-client-for-xbox-controller-with-nim-ble` filters on
`NimBLEAddress("0a:1b:2c:3d:4e:5f")` and nothing else; its
`isAdvertisingService(uuidServiceHid)` check is present in the source,
commented out. That is not a shortcut taken for convenience -- it is the author
having found that on this pad, discovery is the unreliable half.

**BLE 5 may be required.** `asukiaaa/arduino-XboxSeriesXControllerESP32` states
it plainly: "BLE5 may be needed to communicate with xbox controller", and its
compatibility notes are about which ESP32 variants have it. This matters here
because a BLE 5 EXTENDED advertisement is invisible to a legacy scanner:
`ADV_EXT_IND` is not a PDU type the 4.x specification defines, so a 4.x scanner
does not ignore it by policy, it cannot parse it at all.

That is a hypothesis about the glasses' radio, not a finding -- nothing in
Snap's documentation states which advertising modes their scanner supports, and
this repository cannot inspect it. But it fits the evidence exactly: other
devices arrive, this one never does, under a service filter, a manufacturer
filter, five name filters and an unfiltered sweep.

24. **connectToAddress() connects with no scan at all.** `connectGatt` takes
    the address directly, so a wearer who reads their pad's address off a phone
    scanner can skip discovery. Both byte orders are tried, because the order
    is not documented and six bytes are cheap to reverse. The lens exposes it
    as the `padAddress` input; set it and `startPadScan` never scans.

25. **One adopt path.** `adoptConnection()` holds everything that happens once
    a GATT object exists, so a pad connected to by address is reported exactly
    like a found one -- same states, same panel, same log. `connectGATT` is now
    the thin half that turns a scan result into that object.

26. **Every sighting carries its address.** A pad that advertises nothing else
    is still a row the wearer can match against what a phone scanner shows
    them, and it is what `padAddress` wants.

## 10 September, sixth pass: connectGatt resolves NULL

Read out of the 5.15 log, which is where this should have been read on the
first day rather than the sixth:

    BLE TEST: direct connect failed on order 0:
    TypeError: cannot read property 'onConnectionStateChangedEvent' of null

`connectGatt` does not reject when it cannot connect. It **resolves with
null**. 5.15's own declaration says the opposite -- "The Promise is rejected if
the connection cannot be made" -- and on the device it is not what happens.
Believing a signature over an observation is the whole of that day.

27. **Both paths check for a null GATT.** The direct path skips to the next
    byte order; the scanned path says "the pad refused the connection (no
    GATT)". This is worth stating plainly: the bug was NOT specific to
    connecting by address. A scan that finally found the pad would have died on
    the same line, so every hour spent on discovery was chasing a door that
    would not have opened anyway.

28. **The direct path respects the editor guard.** It walked straight past the
    `adapterBlocked()` check `beginScan` has had since the morning, so in
    preview -- which has no radio at all -- it retried for ever.

29. **And it is bounded.** `connectDirectly` never called `scanStarted()`, so
    `tries` stayed at zero, `MAX_ATTEMPTS` never tripped, and the retry fired
    every five seconds for as long as the lens ran. That is what filled the log.

### Still unproven

Every line quoted above is from `[Preview N]`, in Lens Studio 5.15's own log.
Bluetooth does not work in preview, so a null GATT there proves nothing about
the glasses -- and because of patches 28 and 29 the preview was retrying
continuously, which is what there was to read instead of a device run. There is
still no evidence in this repository about what the pad does on hardware.

## 10 September, seventh pass: what the tutorial video actually says

Joshua downloaded the tutorial ("I hooked up a drone to an Xbox Controller with
Spectacles!", 27 min) and it is now beside the sample under
`examples/specs-devs/samples/BLE Game Controller/`. It carries no subtitle
track, so it was read frame by frame. One caption, on screen at 04:29, is worth
more than everything the README says about pairing:

> **NOTE: There is no system-level pairing yet. This means you must wait till
> the lens loads before you can pair the BLE controller to your specs!**

That contradicts the README's own "Simply pair your Bluetooth controller with
your Spectacles device before launching the lens", which is what this project
had been trying to follow. There IS no pairing before the lens; the lens's own
scan is the pairing.

Which explains the sample's ten-thousand-second scan window, and makes our
budget of three attempts wrong in a way no amount of filtering could fix:

30. **A scan keeps looking.** `PadScan.setUnbounded()`, on for scans. There is
    nothing to find until the wearer holds the pairing button, and that happens
    after the lens is up -- so a lens that has stopped looking by the time the
    wearer is ready has answered a question nobody asked. Still bounded for a
    direct connection to an address, which either answers or does not.

31. **An address that gives no answer hands over to the scan.** `padAddress` is
    the shortcut for when discovery cannot find the pad; it must not become the
    reason discovery is never tried.

Also checked, and both negative:

- The GameController package Joshua installed from the Asset Library is
  **byte-identical** to the copy in `context/packages` that every patch above
  was written against. There is no newer upstream to move to.
- The sample project's `.lspkg` files as he obtained them are 130-byte Git LFS
  pointers, not packages. The README warns about exactly this; a zip download
  or a clone without LFS cannot run.

## 10 September, eighth pass: read off the glasses at last

`tools/padlog.sh` pulled the device run of 14:08 straight out of Lens Studio's
own log. Two findings, one of them ours.

32. **A window running out is how a pass ENDS, not how it fails.** On 5.15
    `startScan` rejects with `Scan failed: TIMEOUT` when the deadline passes,
    and that is how EVERY pass ends. All the counting and every carefully
    worded reason lived below the `try`, so on the device they were unreachable
    and the only thing a wearer ever saw was FAILED over a scan that had done
    exactly what it was asked. `endOfPass()` is reached from both endings now.

### And a second scanner, from the Asset Library

The `GameController` package installed from the Asset Library brings a
`GameControllerExample` SceneObject with it, `Enabled: true`, and its
`SceneController` calls `scanForControllers()` on the package's own singleton
with the upstream ten-thousand-second window. Its prints are in the log under
`[Packages/GameController.lspkg/GameController.ts:274] BLE TEST: starting
scan...`, alongside ours.

Two `startScan` calls on one radio, which patch 6 already warned about in this
very file. It is not the cause of the week -- the pad was already invisible at
13:57, before the package existed in the project -- but it has to go before any
further measurement means anything.

### What the glasses actually see

From the 14:08 run, on hardware, with the pad in pairing mode:

| pass | filters | seen | connectable |
| --- | --- | --- | --- |
| 1 | HID service + Microsoft company id + 5 names | **0** | 0 |
| 2 | none (sweep) | **22** | **2** |

The two connectable devices are `Achtertuin` and `ChargingStation`. Twenty of
the twenty-two advertise non-connectably. `A0:B1:C2:D3:E4:F5` -- the address the
pad presents to a Mac -- appears 3,288 times in that log file and not once in a
sighting: every occurrence is one of our own connect attempts.

So the radio works, the room is full, and this pad is not in it. The same pad
reaches a Mac from the same spot. Nothing further in this file can change that.

## 10 September, ninth pass: the dial that had never been turned

Joshua's pad is a **1708** -- the exact model Snap's own README names as
supported. That makes "the glasses cannot see this pad" a much worse
explanation than it looked an hour ago, and sends the question back to how we
are listening rather than to what it is saying.

33. **`ScanMode.LowLatency`, not `Balanced`.** Balanced DUTY-CYCLES the
    receiver: listen for a window, sleep, listen again. A peripheral that
    advertises rarely, or only for the few seconds a pairing button holds it
    open, can fall entirely into the gaps -- and a scanner that misses it
    reports exactly what a scanner in an empty room reports. Sixty seconds of
    Balanced over a room containing twenty-two devices found all twenty-two and
    never this pad. LowLatency listens continuously.

    Upstream left this at `Unset` and Snap's BLE Playground sets `LowPower`;
    `Balanced` came from patch 4, copying the sample. It was the one dial in
    this file nobody had turned.

34. **`uniqueDevices` is false on a FILTERED pass.** With it true the predicate
    fires once per device for the whole window, so a device whose first
    advertisement was missed is missed for the entire minute. Almost nothing
    gets through the filters -- twenty-two devices in the room, zero through --
    so there is no flood to fear and every repeat is another chance. Left true
    on a sweep, where twenty-two devices advertising several times a second for
    a minute is thousands of lines and no more information.

## 10 September: why none of this could have worked

It is not the lens. It is not the filters, the scan mode, the address, the
timing or the bonding. An Xbox One S controller on firmware below 5.x is a
**Bluetooth CLASSIC (BR/EDR)** HID device, and the Spectacles API is
**BLE GATT only**.

The xpadneo project, which is the reverse-engineered Linux driver for these
pads, states it directly:

> "Kernel maintainers should also include the `uhid` module (`CONFIG_UHID`)
> because otherwise Bluetooth LE devices (**all models with firmware 5.x or
> higher**) cannot create the HID input device"

-- and notes that requirement applies only to firmware 5.x and above, because
below that the controller speaks classic Bluetooth instead.

Every observation this week falls out of that one fact:

| what | sees the pad | why |
| --- | --- | --- |
| macOS Bluetooth | yes | discovers BR/EDR |
| iPhone Settings -> Bluetooth | yes | discovers BR/EDR |
| nRF Connect on the same iPhone | **no** | CoreBluetooth is BLE only |
| Spectacles, 22 devices in the room | **no** | BluetoothCentralModule is BLE GATT only |

Snap's own Bluetooth documentation says the same thing from the other side:
"Bluetooth support is currently limited to GATT devices." A BR/EDR HID pad is
not a GATT device and never appears in a BLE scan -- it is not a weak signal or
a filtered-out one, it is a different radio protocol.

Snap's README does say "XBox Controllers (models 1708 or later **with BLE
support**)". The qualifier is carrying the whole sentence.

### The fix is not in this repository

Updating the controller to firmware 5.x turns it into a BLE device, at which
point everything in this file becomes relevant. That update needs the Xbox
Accessories app on Windows 10/11, or an Xbox console. There is no macOS, iOS or
tvOS route -- Microsoft does not provide one.

Nothing above is wasted: the observability, the null-GATT check, the connection
sequencing and the unbounded scan are all real defects that were fixed, and the
lens now says exactly which of them happened. But a pad that does not speak BLE
cannot be found by a BLE scanner, and no further patch here changes that.

## 10 September: the firmware update worked, and the next wall is ours

Joshua updated the controller to firmware 5.x. It is a BLE device now, and the
glasses see it on the first filtered pass:

    BLE TEST: seen: Xbox Wireless Controller A0:B1:C2:D3:E4:F5 [not connectable]
    BLE TEST: connecting: Xbox Wireless Controller
    BLE TEST: linked: Xbox Wireless Controller
    BLE TEST: characteristic 0x2A4D properties [1,4]
    BLE TEST: registered for notifications on 0x2A4D
    BLE TEST: characteristic 0x2A4D properties [1,2,3]
    BLE TEST: rumble characteristic: 0x2A4D

`[not connectable]` is a label, not a decision -- a device whose NAME matches a
registered controller is connected to regardless, and it was. The properties
decode against `Bluetooth.CharacteristicProperty` as `[Read, Notify]` and
`[Read, WriteWithoutResponse, Write]`: the right characteristic, subscribed
successfully, and the other one correctly taken for rumble.

And then `reports=0`, held in LINKED for as long as the lens ran.

35. **A HID host does five things and we did one.** HID-over-GATT expects the
    host to read HID Information (0x2A4A), read the Report Map (0x2A4B), write
    Protocol Mode (0x2A4E) = 0x01 Report Protocol, subscribe to the report
    characteristics, and write the HID Control Point (0x2A4C) = 0x01 Exit
    Suspend. We subscribed and stopped. A peripheral left in Boot Protocol, or
    one that believes its host is suspended, is entitled to say nothing --
    which is exactly what it said.

    `becomeHidHost()` does the first three before the subscribe loop; Exit
    Suspend is written after it, because it is the host saying "I am listening"
    and there is nothing to listen with until something is subscribed. Every
    step is best effort and logged either way: a device that refuses one is
    telling us something, and none of them is a reason to drop a link that
    might still report.

Whether this is enough is not settled. The independent reports quoted earlier
in this file describe CCCD going 0000 to 0100 and still no notifications,
blamed on bonding; none of them mention having tried the protocol-mode and
control-point writes. This is the standards-defined thing to try before
concluding that a Lens cannot bond.

## 10 September: it played, and then it did not

Reports arrived. Joshua walked around Pallet Town on an Xbox pad and the
controller rumbled. The log says which of the five host jobs did it:

    15:07:44  linked
    15:07:44  HID information (0x2A4A): 4 bytes
    15:07:45  report map (0x2A4B): 283 bytes
    15:07:45  characteristic 0x2A4D properties [1,4]
    15:07:45  report: first HID report from Xbox Wireless Controller
    15:07:45  [pad] live  reports=2

The attempt twenty seconds earlier reached `linked` and then read nothing,
because the link had already dropped -- and it got `reports=0`. The one that
read HID Information and the **Report Map** first got reports in the same
millisecond it subscribed. Reading the report map is a host announcing itself
as a real HID host, and on this pad it is what opens the tap.

Three defects the working session then exposed:

36. **A subscription is handed back when the link drops.** The 15:08 reconnect
    failed on `Operation failed, already registered`: the stack still held the
    registration from a link that no longer existed, so the new one was refused
    and the pad's input went to a callback belonging to a dead connection.
    Without `releaseNotifications()` a pad can be connected to exactly once per
    lens run, which is the whole of "ik probeerde opnieuw te connecten maar dit
    werkte niet".

37. **The HID control point write is not awaited.** On this pad the write to
    0x2A4C never settles: the 15:07 connection's attempt failed thirty seconds
    later, when the link dropped and took it with it. Reports flowed the entire
    time it was pending, so it is not needed -- and awaiting a promise that
    never resolves holds the rest of the function open for as long as the link
    lives.

38. **`getCharacteristic` throws for a characteristic that is absent** --
    "Get GATT characteristic failed, no characteristic found" -- rather than
    returning null, so the null guard never ran and an absence was logged as a
    refusal. An Xbox pad has no Protocol Mode (0x2A4E) at all, which is legal
    for a device that only speaks Report Protocol.

And one in the lens rather than here: the left stick's Y axis was inverted
against the map. The D-pad was always right. Which way round a stick reports is
a property of the hardware and its report layout; it took a working controller
in someone's hands to find, and there was no other way to find it.

### What is still not understood

The pad drops the link on its own after sixteen to thirty seconds. Nothing in
this file asks it to. The likeliest reading remains the one the ESP32 threads
give -- an unbonded link that the peripheral eventually abandons -- and a Lens
has no API to bond. What has changed is that a drop is now recoverable: the
scan re-arms, reconnects, and the subscription is free to be taken again.

## 10 September, evening: the drop is cheap now

The fourth playtest played. Four recordings, thirty seconds each, a pad in his
hands the whole way through -- and the report was not "it disconnects":

> "ik moet constant de controller opnieuw verbinden omdat de verbinding niet
> connected blijft"

The cost was never the drop. It was the RECOVERY. A drop reported a loss, the
machine above re-armed, and the lens spent sixty seconds of LowLatency scanning
looking for an advertisement that a pad only produces while its pairing button
is held. Twice a minute, by hand, with the world stopped.

39. **A drop takes the same link back, without going near the radio.**
    5.15's own `StudioLib.d.ts` has the primitive and we had never called it:

    > `connect()` -- Re-establish connection to the device. Asynchronous call:
    > to detect when the device is connected listen on the
    > `onConnectionStateChangedEvent`.

    Same GATT object, no scan, no advertisement, no button. The
    connection-state listener bound in `adoptConnection` is still attached, so
    the `Connected` it produces lands in `takeConnection` exactly as the first
    one did -- and the subscription is free, because patch 36 hands it back
    before this runs.

    Bounded, or a pad that connects and never speaks would spin here: six
    consecutive relinks with not one HID report between them falls through to
    the honest "lost" and the scan behind it. The budget is per LINK and a link
    that delivered input earns a fresh one, so a pad that drops every twenty
    seconds relinks for as long as the wearer keeps playing.

    Only where a reconnection can be OBSERVED (`relinkable`). The 5.23 path has
    a disconnect signal and no connect signal at all, so a relink there would be
    a call into the dark.

The lens side is `SCAN_RELINKING` in `play/PadScan.ts`: a state with its own
ten-second deadline, which asks for no scan and puts no panel up -- silent was
the point -- and falls through to `lost()` if the link does not come back, so a
pad that has genuinely gone is still found out.

### What is still not understood

Unchanged, and worth restating so it is not mistaken for fixed. The pad drops
the link on its own after sixteen to thirty seconds and nothing in this file
asks it to. The likeliest reading remains the one the ESP32 threads give -- an
unbonded link that the peripheral eventually abandons -- and a Lens has no API
to bond. Patch 39 does not stop it happening; it makes it cost a second instead
of a minute.

## 10 September, later: the link that was up and useless

He tested again and the pad went quiet in a new way: "op de controller zie ik
het xbox logo branden dus dat betekent dat die verbonden moet zijn maar er
gebeurt niks als ik op A klik."

The log said everything in what it did not contain:

    16:41:59.606  seen: Xbox Wireless Controller A0:B1:C2:D3:E4:F5
    16:41:59.606  connecting: Xbox Wireless Controller
    16:42:00.717  linked: Xbox Wireless Controller
    16:42:04.642  [pad] linked try=1/3 seen=1 reports=0
    16:42:14.651  [pad] linked try=1/3 seen=1 reports=0

Nothing after `linked`. No HID information, no report map, no characteristic
line, no error -- and on the connection that worked, `HID information (0x2A4A):
4 bytes` arrived 650 ms after `linked`. Between those two points there is
exactly one call with no try/catch around it.

40. **`gatt.getService()` throws; it does not return null.** Patch 38 learned
    that about `getCharacteristic` -- "Get GATT characteristic failed, no
    characteristic found" is an exception, not an absence -- and this call was
    left with the null check that had already been shown to be the wrong
    shape. It is now caught, and a service that cannot be read is treated as a
    failure of THIS ATTEMPT rather than a verdict on the device: on this stack
    a link can be reported Connected before its GATT database is readable.

41. **Nothing may escape `takeConnection`.** It is called from a
    connection-state listener with no `await`, so the rejection had nowhere to
    go: no log line, no error event, nothing at all. And `this.linked` had
    already been set true at the top, so every later `Connected` returned at
    the guard -- one throw wedged the pad for the whole run. The body moved to
    `openLink` and `takeConnection` is now the wrapper that catches, hands the
    link back and says what happened. The listener catches too, because a
    promise rejected with nobody listening is how this managed to be silent.

42. **A link can be given back.** Nothing in this file had ever disconnected
    anything. That was survivable while a dead link merely stopped being
    mentioned, and it stopped being survivable here: a connected BLE peripheral
    DOES NOT ADVERTISE, so while we held that useless link the pad was off the
    air and no scan could ever have found it. `releaseLink` closes the GATT --
    `close()`, not `disconnect()`, whose own docs say "unpair or disconnect"
    and dropping the bond is not what is meant.

43. **A registration says so** (`ready`), so the lens can tell a link that
    finished its handshake from one that only got as far as being a link.

There are three ways to arrive at "this link is no good" and all three now hand
it back: the handshake deadline, the relink deadline, and patch 41's own error
path -- which is the one the first draft missed, and which is the 16:42 failure
exactly. Fixing the wedge without it would have kept the symptom.

The lens side is the backstop, in `play/PadScan.ts`: `SCAN_LINKED` was the one
state in that machine with no deadline, which is how a single swallowed
exception became a dead session rather than a twelve-second pause. It has one
now, it stops at the SUBSCRIPTION rather than at the first report -- a
subscribed pad lying still on a table is a working pad -- and the link is
handed back BEFORE the scan is asked for, because scanning while still holding
the pad is scanning for something we are ourselves keeping silent.

## 10 September, 17:12: the read that never answers

He tested `0f4b5e5` and the pad still would not connect -- but the log had
changed shape entirely, and the new shape names the cause. Six cycles, and
every one of them identical to the millisecond:

    17:10:16.363  linked: Xbox Wireless Controller
    17:10:28.480  report map (0x2A4B) unreadable: Error: Operation failed
    17:11:07.748  linked: Xbox Wireless Controller
    17:11:19.791  report map (0x2A4B) unreadable: Error: Operation failed
    17:11:26.468  linked: Xbox Wireless Controller
    17:11:38.224  report map (0x2A4B) unreadable: Error: Operation failed

Twelve point one seconds, every time, and twelve is `LINK_WINDOW_SECONDS` --
our own deadline. **The read was not failing. It was hanging**, and it resolved
at the instant `releaseLink` closed the GATT underneath it and took every
queued operation with it.

So `becomeHidHost` awaited a promise that never settles, the handshake blocked
for twelve seconds, and `registerNotifications` -- the one step that actually
produces input -- was never reached at all. The `cannot notify` lines in that
log appear AFTER the release, with everything else that had been queued.

44. **The handshake is ISSUED, not awaited.** The pad receives all three
    requests either way; that is what issuing them means. What awaiting added
    was a dependency on a reply that does not come. Patch 37 had already
    learned this shape about the control point write; it is true of all four.

### Correcting patch 35

Patch 35 concluded that reading the report map is "what opens the tap", because
reports arrived in the same millisecond as the subscribe that followed a
successful read. The fuller evidence does not support it: on a healthy link the
reads return in under a second AND the notifications register, and on a sick
one neither works. The read was a SYMPTOM of a usable link, not the cause of
one. The handshake is still sent -- it is what a HID host is supposed to do,
and it costs nothing now -- but it is no longer believed to be load-bearing.

### What is still not known

Why the link is sick. Every attempt in the 17:09-17:12 log took about a second
between `connecting` and `linked`; the one connection that ever worked, at
15:07:44, took seventy-five milliseconds, and it came six seconds after a
failed attempt on a link the pad had not yet let go of. That is a hint and not
a finding. If subscribing now fails as fast as it should, the retry loop runs
in about a second instead of seventeen, and the next log will say whether the
second attempt on a warm link is reliably the one that works.

## 10 September, 18:05: the call that freezes the lens

Patch 44 got the pad working -- 366 reports in thirty seconds -- and then made
something worse, which is worth writing down carefully because the mechanism is
the interesting part.

The wearer: "ik kon wel het spel zien maar mijn controller deed weer niks als
ik op A klikte. En uiteindelijk stopte de muziek ineens en ging het startscherm
niet meebewegen dus de lens is wel degelijk vastgelopen."

Two runs, and both device logs stop mid-sentence at the SAME line:

    17:44:46.333  characteristic 0x2A4D properties [1,4]   <- end of log
    18:05:07.791  characteristic 0x2A4D properties [1,4]   <- end of log

The AudioDriver heartbeat had been logging every four seconds and stops at the
same instant. That is not a pad going quiet; that is the main thread dying. The
next statement after that log line is `await c.registerNotifications(...)`.

Counted over the afternoon: **sixteen calls, three returns.** And on the one
link where it did return it took 534 milliseconds with no other line logged in
between, so it is not asynchronous in any useful sense either -- it blocks, and
sometimes it never stops.

### Why this appeared only now

Because patch 44 removed the thing that had been hiding it. Awaiting the
handshake used to hang FIRST, so a sick link was released at the twelve-second
deadline and `registerNotifications` was never reached at all. The bug was
shielding us from a worse one.

45. **The subscribe waits for the link to prove itself.** `openLink` arms it;
    the first read that comes BACK runs it. A read that returns is the only
    evidence we have that a link carries GATT traffic, and it separates the
    cases cleanly: on the connection that worked the reads returned four bytes
    and 283 bytes, and on every link that froze no read ever returned. A link
    that proves nothing is released by SCAN_LINKED's deadline with
    registerNotifications never having been called.

    This also restores the order HOGP asks for -- read HID Information, read
    the Report Map, set Protocol Mode, THEN subscribe -- which patch 44 had
    given up to avoid the hang. It gets both now: the order on the wire, and
    nothing ever waiting on a reply that does not come.

The call is still not safe. Nothing here can make it safe. What has changed is
that we no longer roll the dice on every cycle of a retry loop -- only on a
link that has already answered.

---

## Patch 46 -- the write that killed the link

"Daarnaast disconnect mijn controller constant." -- Joshua, 10 September, after
an evening of playtests.

Patch 38 added the four remaining things a HID host is supposed to do, and one
of them was a write of Exit Suspend (0x01) to the HID Control Point (0x2A4C).
It never settled. Patch 40's note read that as harmless and said so:

> Reports flowed the whole time it was pending, so it is not needed.

Reports did flow. For thirty seconds. Every working link in the 10 September
device log died at the same moment, and the write's own rejection arrived in
the same millisecond as the death:

    15:07:45.912 ready ... 15:08:16.072 lost     30.16s
    17:43:52.453 ready ... 17:44:22.503 relink   30.05s
    18:20:06.606 ready ... 18:20:36.677 relink   30.07s

    18:20:36.677  relink: Xbox Wireless Controller
    18:20:36.677  control point: exit suspend (0x2A4C) refused: Operation failed

Three links, three deaths, all at 30.0 seconds, and 1278 HID reports delivered
in between -- so the link was healthy right up to the instant it was taken
away. Thirty seconds is the GATT operation timeout underneath us. An operation
that never completes takes the connection down with it when it expires.

Why this write never completes: the HID Control Point is **Write Without
Response** in the HID Service specification. `writeValue()` is a write WITH
response, so the host sits waiting for an ATT Write Response the pad is not
required to send and does not send.

Correction, 11 September: the first version of this paragraph ended "there is
no way to ask for the other kind through this API". That was wrong. Both the
5.15 and the 5.23 typings have `writeValueWithoutResponse()`, and `sendRumble`
in this very file has used it all along. The write stays gone for the reason
below, not for lack of an API; if a write-without-response characteristic
ever has to be written, that method is the one, never `writeValue()`.

46. **Nothing writes the HID Control Point.** The request is gone rather than
    made safer, because it was never worth having: Exit Suspend means something
    only to a host that put the device into Suspend, and this one never does.
    A HID host here now does four things, not five.

    `test/padconnect.test.mjs` pins the absence against the WHOLE file rather
    than one method body, because moving the call elsewhere is the obvious way
    to lose this.

### What this does not explain

Not proven, only measured: there is no counter-example in the log, because
before this write existed no link ever stayed up long enough to compare. The
next test is the proof. A link that lives past thirty seconds confirms it; one
that still dies at 30.0 means the timer belongs to something else and this
patch cost nothing.
