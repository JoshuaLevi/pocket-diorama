# Getting started

From a clone to a Game Boy world on your own glasses, with your own cartridge.

Every command here was run against this repository before it was written down. Where a
step is not wired up yet, it says so instead of pretending.

---

## Before you start

| | |
|---|---|
| Lens Studio | **5.23** to develop. **5.15.4** as well if you want the device-portability gate, which is what Spectacles (2024) actually runs |
| Node | **24 or newer**. The tests run the shipping TypeScript directly, which needs Node's type stripping |
| Git LFS | Required. Four files in this repository are LFS objects, two of them the Lens Studio packages |
| Cartridge | A dump of **Pokemon Red, Blue or Yellow (USA, Europe)** that you own: SHA-1 `ea9bcae617fdf159b045185467ae58b2e4a48b9a` (Red), `d7037c83e1ae5b39bde3c30787637ba1d4c48ce2` (Blue) or `cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1` (Yellow) |
| Glasses | Spectacles (2024), if you want it off the desk. The Lens Studio preview works without them |

All three play. Red and Blue share an engine, and the whole test suite passes on a Blue
bundle as it does on Red's. Yellow's opening (Oak's Pikachu, the one Eevee), its title,
its rival parties, Viridian's two old men and Jessie and James are the lens's since 19
September; Red's scripts serve everywhere else, with Yellow's own words where a label was
renamed (`play/script/TextAliases.ts`). `test/yellow.test.mjs` runs Yellow's scenes
headless. Not yet: the companion Pikachu behind you, the surfing minigame. A manifest's
addresses pointed at another revision do not fail loudly — they produce plausible-looking
garbage — so the extractor refuses a dump no manifest describes.

Check your Node and your cartridge before anything else:

```sh
node --version                        # v24 or newer
shasum -a 1 "/path/to/your.gb"        # must be ea9bcae6...48b9a
```

---

## 1. Clone

```sh
git lfs install
git clone https://github.com/JoshuaLevi/cartridge-diorama.git
cd cartridge-diorama
```

Confirm LFS actually pulled the packages — four lines, none of them a pointer stub:

```sh
git lfs ls-files
```

```
f1acb4632d * Assets/Image.png
7f718a37e0 * Assets/Render/Echopark.hdr
d40740060f * Packages/SpectaclesInteractionKit.lspkg
641bbfd3a5 * Packages/SpectaclesUIKit.lspkg
```

If those come back as 130-byte text files, Lens Studio will not open the project. Run
`git lfs install` and then `git lfs pull`.

---

## 2. Bake a world from your cartridge

The repository contains no world, because a world is game content. You build one from
your own cartridge before the lens has anything to draw. There are two ways.

**The player's way: the world site.** Open <https://pocket-diorama.vercel.app>, drop
your dump on it, and the page bakes the world in your browser with the same extractor
the lens runs (`web/`, built from `Assets/Scripts/rom`). It parks the baked bundle in a
private store for one day and shows a six-character code. Put the glasses on, read the
three pages the lens opens with, and type the code; the lens fetches the bundle over
https, keeps it in persistent storage, and never asks again. The cartridge itself never
leaves your machine. This is the only path a published lens can use, and it is the one
the lens is built around.

**The developer's way: bake it yourself.** For the Lens Studio preview and the tests you
want the bundle as a file, and the rest of this section is that.

`tools/bake.mjs` runs the lens's own extractor and its audio bakers over the file: the
same functions the glasses and the world site call, and `test/bundle.test.mjs` proves the
paths agree. **Run it from the repository root**, your own path first:

```sh
node --experimental-strip-types --import ./test/register.mjs \
     tools/bake.mjs "/path/to/your.gb" Assets/Generated/kanto.json
```

```
BAKE OK  Assets/Generated/kanto.json
  rom      Pokemon - Red Version (USA, Europe).gb  sha1 ea9bcae617fdf159b045185467ae58b2e4a48b9a
  maps     222
  species  151 (151 front pictures, 151 back)
  trainers 47
  cries    151  (42 KB)
  audio    45 songs, 104 effects, 4 banks (102 KB)
  size     1.63 MB
```

That is about 1.6 MB for all 222 maps, the tilesets, the sprites, 151 species with
their pictures, the trainers, the cries and the music, and it takes well under a second.
`Assets/Generated/` is gitignored, and must stay that way — it is ROM-derived, so it is
game content. The manifest is picked by the cartridge's own SHA-1; pass one explicitly
between the two paths only when you have a reason to.

The hash check is the guard, and it is not optional. Every address in a manifest is valid
for exactly one build; a Virtual Console dump or a revision-1 dump decodes into
plausible-looking garbage rather than failing. Point this at a dump no manifest
describes and it stops before writing a thing:

```
refusing to bake: no manifest describes <your sha1>
```

Prove the bundle is sound before you carry it into Lens Studio:

```sh
node --experimental-strip-types --import ./test/register.mjs \
     test/overworld.test.mjs Assets/Generated/kanto.json
```

```
ALL PASS: 18 passed, 0 failed
```

Those 18 assertions cover Pallet Town's geometry, Route 1's grass and encounter table,
the map seams and collision. If they pass, the world is real.

---

## 3. Open the project

Open **`Pokemon-AR.esproj`** in Lens Studio 5.23. The directory and the project file
still carry the old name; the lens itself is called Pocket Diorama.

Lens Studio will import your freshly baked `Assets/Generated/kanto.json` as a JsonAsset
with a new id, so the scene's reference to it will be empty on a fresh clone. Wire it up
once:

1. Select the scene object carrying the **`PokemonAR`** script component — it is the
   only script in the scene, and it builds everything else in code at start-up.
2. Drag `Assets/Generated/kanto.json` onto its **Baked World** input.
3. Press Preview.

Useful inputs on that same component while you are there:

| Input | What it does |
|---|---|
| `Baked World` | The JsonAsset from step 2. Tried after the persistent cache, before the code page or the bridge |
| `Prefer Cache` | Replay whatever is already in persistent storage before anything else. On in the build that ships |
| `World Site` | Where a world code is redeemed: `https://pocket-diorama.vercel.app` |
| `Use Lan Bridge` | Development only: pull the world from `tools/serve-world.sh` over `ws://` instead of asking for a code. Off in the build that ships, because `ws://` needs Experimental APIs |
| `Debug Force Ingest` | Ignore the cache and the baked world, so the intro pages and the code keyboard can be seen in the preview |
| `Debug Ladder` | SELECT on the title screen lists ten places to drop into the game with the party and badges that stretch assumes. Test builds only |
| `Debug Auto Walk` | Walks a fixed loop with no hardware, for probes and LEAF. Off by default |
| `Start Map`, `Start Cell X/Y` | Where to begin. `PALLET_TOWN` at 5, 6 is where the original starts |
| `Curve Level` | The reference's V-CURVE, 0 (flat) to 5 (half sphere) |
| `Tilt Degrees` | 0 to 75. The original steps through 15, 35, 50, 75 |
| `Render Distance` | 0 FIT, 1 WIDE, 2 WIDER, 3 WIDEST, 4 the whole map |
| `Debug Force Encounter` | Fires one wild encounter a few seconds in, so the transition is testable |
| `Debug Ignore Save` | Ignore the stored position and start from the inputs above |

The preview runs at roughly 3.5 fps on a 3662-quad map. That is the editor, not the
device — anything timed will feel broken when it is not. Judge timing on the glasses.

Set the preview's **Device Type Override to Spectacles**. Several APIs this project
uses, WebSocket included, only behave in the preview window with that set.

---

## 4. Put it on the glasses

**Spectacles (2024) needs the 5.15 build.** Those glasses run from Lens Studio
5.15 and 5.15 will not open a 5.23 project, so the device build is a sibling
project: `../Pokemon-AR-515`, made and kept in step by `tools/make515.sh`
(`bootstrap` once, `sync` after every script change, `gate` to prove the scripts
still compile against the SIK that build actually uses). Its own README-515.md
has the one-time wiring and the send. The rest of this section is the 5.23 path,
which is what SPECS itself will use.

1. **Project Info → Lens Made For Spectacles** must be on. It already is in this
   project, but check it after any project-settings change.
2. Connect your Spectacles to Lens Studio, awake and paired. Snap's own instructions:
   [Connecting Lens Studio to Spectacles](https://developers.snap.com/spectacles/get-started/start-building/connecting-lens-studio-to-spectacles).
3. Click **Preview Lens** in the toolbar, or **Send to Spectacles** in the Additional
   Settings popup.
4. The lens lands in Lens Explorer under **Draft**. Draft lenses are local to your device
   and not visible to anyone else.

The first launch decodes nothing — it reads the baked world you assigned, caches it in
persistent storage, and from then on the glasses do not need the laptop at all. Position
and facing persist too, so closing the lens and reopening it puts you back where you
were.

**Publishing.** Two things need Experimental APIs and cannot be published: the LAN
bridge (`ws://`) and the Bluetooth pad. Both sit behind inputs that are off in the build
that ships; the world comes from the site by code, and the controls are the hands and
the phone. `tools/make515.sh publish` sets the device project to exactly that
configuration (pad off, bridge off, Experimental APIs off, cache on, the site named),
and `make515.sh testbuild` does the same with the save ladder switched on. The
development project keeps the pad and the bridge for the desk.

---

## 5. The bridge

`bridge/` is the one-time pairing tool: you run it on your laptop, drop your cartridge on
its page, and the lens pulls the bytes over the LAN, verifies the hash, and bakes its own
world. After that first bake it is never needed again. Read
[bridge/README.md](../bridge/README.md) for the design and
[bridge/PROTOCOL.md](../bridge/PROTOCOL.md) for the wire format.

**Be clear about what it is now**: a development path. It speaks `ws://`, which a
published Spectacles lens may not open, so the lens only uses it with `Use Lan Bridge`
on. The path a player takes is the world site in section 2 -- the same extractor, run
in their browser, and a code typed into the lens. The bridge remains the quickest way
to push a fresh bake at a desk without leaving Lens Studio.

Run it anyway to see the shape of it — no install, no dependencies:

```sh
node bridge/bin/pokemon-ar-bridge.mjs --open
```

```
  pokemon-ar-bridge 1.0.0
----------------------------------------------------------------
  browser UI    http://127.0.0.1:8780
  lens endpoint ws://192.168.1.42:8781  (en0)
  pairing code  835093
  data dir      ~/Library/Application Support/pokemon-ar-bridge
  library       empty; drop a .gb file on the browser UI
----------------------------------------------------------------
  waiting for a lens. ctrl-c to stop.
```

Drop your `.gb` on the browser UI. Only the three canonical Gen 1 hashes are ever served
to a lens; anything else stays in your library with a red verdict saying why. ROMs and
saves live in the OS user data directory (`%APPDATA%` on Windows, `$XDG_DATA_HOME` on
Linux) — the bridge refuses to start if its data directory would land inside this
checkout.

Two naming leftovers to expect: the data directory is still `pokemon-ar-bridge` even
though `bridge/README.md` calls it `cartridge-diorama-bridge`, and `npm start` inside
`bridge/` fails because `package.json` was renamed ahead of the entry point. Nothing is
published to npm either, so `npx cartridge-diorama-bridge` does not work. Invoke the file
directly, as above.

Prove the bridge end to end, against your own cartridge:

```sh
node bridge/test/verify-transfer.js --rom "/path/to/your.gb"
```

```
  [PASS] every announced chunk arrived  32 of 32
  [PASS] SHA-1 of the reassembled ROM is canonical Red  ea9bcae617fdf159b045185467ae58b2e4a48b9a
  [PASS] the reassembled bytes equal the source file  byte for byte
  ALL GREEN: 31/31 checks passed
```

It spawns the real CLI, drives it with a scripted client that behaves the way the lens
does, pulls the ROM in binary and in base64, reassembles it, round-trips a save, and
asserts on a hash rather than on an impression.

---

## 6. Run the gates

```sh
./tools/verify.sh
```

Both compile gates, the logic tests, and — if it can find your cartridge — the checksum,
extraction, bundle-parity and bridge tests. It ends in `VERIFY: ALL GATES PASS` or names
what failed. Anything it cannot run says `SKIP` rather than passing quietly.

Point it at your own files with two environment variables:

```sh
export CARTRIDGE_ROM="/path/to/your.gb"
export CARTRIDGE_GOLDEN="/path/to/gen1recomp-golden/json"   # optional
./tools/verify.sh
```

`CARTRIDGE_GOLDEN` is the byte-for-byte gate against the reference extractor's output.
You only have it if you have run gen1recomp's own extractor; without it that one gate
skips and everything else still runs.

---

## When it goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Lens Studio will not open the project, or the packages are broken | LFS objects came down as pointer stubs | `git lfs install && git lfs pull`, then reopen |
| `refusing to bake: no manifest describes ...` when baking | Your dump is not canonical Red, Blue or Yellow — a different game, a revision, a Virtual Console rip, or a headered file | Confirm with `shasum -a 1`; the guard is doing its job |
| Preview is black; status says `No InternetModule and no baked world` | Nothing was assigned to **Baked World** and the cache is empty | Do step 2, then drag `kanto.json` onto the input |
| Preview is black; status says `Bundle rejected: ...` | The bundle is truncated or was built from a different revision | Rebuild it, then run `test/overworld.test.mjs` against it before trying again |
| Status sits on `Pairing with bridge at ws://...` | The scene fell through to the bridge path, which is not wired up | See section 5. Assign a baked world instead |
| `ERR_MODULE_NOT_FOUND ... /test/ts-resolver.mjs` | You ran a test from somewhere other than the repository root | `cd` to the repository root and run it again — `--import ./test/register.mjs` is resolved against the working directory |
| `Cannot find module '.../bin/cartridge-diorama-bridge.mjs'` | `npm start` in `bridge/` | Run `node bridge/bin/pokemon-ar-bridge.mjs` directly |
| The bridge refuses your cartridge with a red verdict | Its SHA-1 is not one of the three canonical hashes | Check with `shasum -a 1`. A trimmed, patched or headered dump will not do |
| The bridge starts but the glasses cannot reach it | The lens endpoint is a LAN address; the glasses must be on the same network | Use the `ws://<lan-ip>:8781` line the bridge prints, not `127.0.0.1` |
| `CARTRIDGE-GATE: FAIL - no lensifyts binary found` | Lens Studio is not installed where the gate looks | It expects `/Applications/Lens Studio 5.23.app` or `/Applications/Lens Studio 5.15.app` |
| `CARTRIDGE-GATE-515: SKIP - Lens Studio 5.15 not installed` | Expected, if you only have 5.23 | Install 5.15.4 before claiming a change is device-safe |
| `gate515` reports hundreds of `packages=` diagnostics | Expected. SIK 0.18 is a 5.23-era package | Only `ours=` matters. A 5.15 project takes its own SIK from the 5.15 template |
| Everything is slow and timing feels broken | The editor preview runs at roughly 3.5 fps | Measure on the device. Do not tune timing against the preview |

If you get past all of that and something still does not work, open an issue with the
Logger panel's output from `Lens Opened:` onward.

## Playing in the Lens Studio preview

No hardware is needed. Click the Game Boy plate under the world with the mouse
(hover a button first, then click -- that is how SIK's mouse interactor works),
or use the keyboard: arrows or `I` `J` `K` `L` walk, `Z` is A, `X` is B,
`space` is START. The status line shows which source is driving (`[panel]`).
The preview's own camera also uses the arrows and WASD; IJKL avoids the clash.
An Xbox pad paired to the Mac can drive the preview too, through
`tools/padbridge/run.sh`. All four input paths and how to test each one:
`docs/CONTROLLERS.md`.

The lens boots the way the cartridge does: the title screen, then CONTINUE /
NEW GAME / OPTION. Press START (space) or A (Z) on the title.

NEW GAME now runs Oak's own intro on the Game Boy screen before the world
appears, exactly as the cartridge shows it, rather than building the world
at once: his portrait, Nidorino's cry, your own portrait, the naming screen
(NEW NAME opens the letter grid, START confirms), the rival's portrait and
his naming, the shrink and the fade to white. Then the lens asks its own
question on the same screen -- `HOW DO YOU WANT TO PLAY?`, GAME BOY or
DIORAMA, A or START picks -- before the bedroom appears. CONTINUE skips both
the intro and the question and resumes the save's own choice, as does
`debugSkipTitle`.

**DIORAMA** builds the voxel world as before and turns the Game Boy screen
off. **GAME BOY** does the opposite: no voxels, no billboards, and the
screen stays on, now painting the live overworld every frame the way the
cartridge draws it (`play/screen/OverworldCanvas.ts`) -- the same pad plate
still drives it, and the message box and any yes/no question print to that
same screen instead of the pad's HUD box. The START menu, the party and bag
screens, the Pokedex data page and battles are not part of this pass yet and
keep using the pad HUD (and, for a battle, the 3D growth) exactly as
DIORAMA does; each says so once, in the console, the first time it opens.
Picking one on the onboarding page (a NEW GAME with the boot screens), or
CONTINUE loading a save that already picked one, is the only way to choose
today -- there is no in-world way yet to switch mid-session, though the
mechanism (`rebuildDiorama()`) already tears down or builds whichever one
you leave behind if something later flips `PlayState.playMode` while a game
is running.

Watch the console for one `[PokemonAR]` line per step; a fresh NEW GAME that
picks DIORAMA prints them in this order (the names are whatever you actually
chose; the terrain line's own quad and chunk counts vary with the map, and
are omitted here):

```
[PokemonAR] title screen
[PokemonAR] main menu
[PokemonAR] NEW GAME
[PokemonAR] intro
[PokemonAR] naming: player
[PokemonAR] named player RED
[PokemonAR] naming: rival
[PokemonAR] named rival BLUE
[PokemonAR] onboarding
[PokemonAR] mode picked: diorama
[PokemonAR] REDS_HOUSE_2F: <quads> quads in <chunks> chunks, 16x16 tiles, scale 4.375
[PokemonAR] REDS_HOUSE_2F  [panel]
```

Picking **GAME BOY** instead diverges only after the mode pick -- everything
through `onboarding` is identical:

```
[PokemonAR] mode picked: gameboy
[PokemonAR] REDS_HOUSE_2F  [panel]
```

Notice what is missing: no terrain line. `rebuildDiorama()` skips
`rebuildTerrain()` and `ensurePlayerBillboard()` entirely in this mode --
there is nothing to build, because `OverworldCanvas.paintOverworld` reads
the same live map straight off `MapRuntime` every frame instead of caching
it into a mesh. The bedroom itself carries no NPCs, which is why there is no
"N NPCs on REDS_HOUSE_2F" line to see either way; a map that does have some
(Pallet Town, Route 1) prints it in both modes, right before the status
line, and is where GAME BOY mode is actually worth watching: walk downstairs
and outside, and the flat screen should show Red, the houses and anyone
standing around exactly the way the cartridge would, scrolling in 16-pixel
steps as you walk and updating immediately across a warp or a map seam.

To actually see the diorama, set the preview to **Interactive** with the
**Sunlit Room** environment and the **SPECS 27** device, then tilt the preview
camera about 28 degrees down and step back (`Shift`+`S`, then `S`): the lens
places the world 20 cm below eye height and a level camera cuts it off at the
bottom. `docs/PLAYTEST-AND-DEMO-VIEWING.md` has the full setup, the recording
options (preview recorder, on-device capture and its Experimental-API
watermark, Spectator) and what the MCP tools can capture.
