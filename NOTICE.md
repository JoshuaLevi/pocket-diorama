# Third-party code and data

## gen1recomp — MIT

`Assets/Manifests/rom_manifest_*.json` are the symbol manifests from
[gen1recomp](https://github.com/bryanthaboi/gen1recomp), carried under its MIT
licence, reproduced at `Assets/Manifests/LICENSE-gen1recomp.md`.

They contain **no ROM bytes**: symbol addresses, ordering and the identifiers
assembly throws away, and nothing else. The tile-category cascade in
`tools/build_bundle.py` and `Assets/Scripts/rom/BundleFromExtraction.ts` follows
that project's reading of `engine/gfx/palettes.asm`, and the extractor was ported
from its `tools/build_rom_data.py`.

gen1recomp is also the reason this project can exist at all: it established that
a Generation 1 world can be rebuilt from a cartridge the player already owns,
without redistributing a byte of it.

## Spectacles GameController — Snap Inc.

`Assets/Scripts/vendor/GameController/` is Snap's BLE Game Controller sample,
vendored so that path-based imports survive the Lens Studio 5.15 downgrade, with
local patches documented in that directory's `PATCHES.md`.

## Spectacles Interaction Kit — Snap Inc.

`Packages/SpectaclesInteractionKit.lspkg` and `Packages/SpectaclesUIKit.lspkg`
ship with Lens Studio and are used under Snap's terms.

## What is NOT here

No ROM. No sprites, maps, text, music or sound effects from any commercial game.
`.gitignore` blocks `*.gb`, `*.gbc`, `*.sav` and `Assets/Generated/`, and every
commit is checked against that before it is made.
