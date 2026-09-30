# ROM extractor

Turns a Pokemon Red cart the user already owns into the JSON `WorldData` the
lens renders. The lens ships **zero** game content: no ROM, no ROM-derived file,
and nothing under `Assets/Generated/` is ever committed.

This is a TypeScript port of `tools/build_rom_data.py` from gen1recomp. The port
is not "close enough" -- it is verified byte-for-byte against golden output that
the reference produced from the same cart. `src/verify.ts` is that gate.

```
src/
  cli.ts          extract:  ROM -> <out>/*.json          (Node entry point)
  verify.ts       gate:     ROM -> compare vs golden     (Node entry point)
  verifyDiff.ts   structural diff used by the gate report
  nodeLoader.ts   dataset discovery shared by both entry points
  registry.ts     the dataset contract + canonical JSON serialiser
  types.ts        every output shape, one interface per golden file
  core/           Rom, Symbols, sha1, text, lz3, 2bpp decode
  datasets/       one builder per dataset
test/             per-dataset tests written alongside the ports
```

Only `cli.ts`, `verify.ts` and `nodeLoader.ts` touch the filesystem. Everything
under `core/`, `types.ts`, `registry.ts` and `datasets/` takes a `Uint8Array` in
and returns plain objects out, because the same code has to run unchanged inside
the Lens Studio sandbox: no `node:fs`, no `Buffer`, no `Record`/`Map`/`Set`, no
`export enum`.

## Setup

Node 24 or newer.

```bash
cd tools/extractor
npm install          # tsx + typescript, both dev-only
```

Three inputs, none of which live in this repository:

| Input | What | Where |
|---|---|---|
| ROM | Pokemon Red (USA/Europe), SHA-1 `ea9bcae617fdf159b045185467ae58b2e4a48b9a` | the user's own cart image |
| manifest | `rom_manifest.json` -- 3287 symbols, MIT, contains **no ROM bytes** | the gen1recomp checkout |
| golden | 18 canonical JSON files, gate only | produced by the reference from the same cart |

The extractor refuses to run against any other revision: `openRom` checks the
SHA-1 against `manifest.romSha1` before a single table is read.

## Extract

```bash
npx tsx src/cli.ts \
  --rom "/path/to/Pokemon - Red Version (USA, Europe).gb" \
  --manifest /path/to/gen1recomp/tools/rom_manifest.json \
  --out /tmp/px
```

| Flag | Meaning |
|---|---|
| `--only <dataset>` | build one dataset; repeatable |
| `--assets <dir>` | also dump decoded pixels as `.rgba` (see `datasets/graphics.ts`) |
| `--list` | print which datasets have a module on disk |

Decoded images are **not** part of the JSON contract -- the golden files carry
only asset path strings -- so `--assets` is a debugging aid, not part of the gate.

## Verify (the gate)

```bash
npx tsx src/verify.ts \
  --rom "/path/to/Pokemon - Red Version (USA, Europe).gb" \
  --manifest /path/to/gen1recomp/tools/rom_manifest.json \
  --golden /path/to/golden/json
```

```
dataset         file                        ours    golden  result
------------------------------------------------------------------
battle_anims    battle_anims.json         102428    102428  PASS
constants       constants.json             23451     23451  PASS
...
pokemon         type_chart.json             4830      4830  PASS

--------------------------------------------------------------
18 PASS   0 FAIL   0 SKIP   of 18 contract files
VERIFY OK
```

Exit code 0 when every compared file matched, 1 otherwise. `--only <dataset>`
narrows the run and marks the rest `SKIP`; the summary then prints `PARTIAL RUN`
so a green line can never be mistaken for the full gate. `--write <dir>` also
dumps what was produced, for diffing by hand.

A failing row is followed by a detail block: the first differing byte offset
with the surrounding text from both sides, and the first differing JSON path.

```
battle_anims.json
  first byte differs at offset 3904
    golden : ...,"frameBlocks":{"0":[],"1":[{"tile":44,"x":0,"xflip":false,...
    ours   : ...,"frameBlocks":{"0":[],"1":[{"prio":false,"tile":44,"x":0,...
  first structural difference: $.frameBlocks["1"][0].prio  (extra-key)
    golden : <absent>
    ours   : false
```

### What "identical" means

The golden JSON came out of Python as

```python
json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
```

written with no trailing newline. `canonicalJson()` in `src/registry.ts`
reproduces that exactly. Three consequences bite every port:

1. **An omitted key and a `null` key are different.** The reference passed
   through a Lua table, so a key it dropped is simply absent while `pic = nil`
   became JSON `null`. Return `undefined` to omit, `null` to emit null.
2. **An empty object serialises as `[]`, not `{}`.** Lua cannot tell an empty
   map from an empty list. Handled for you; do not work around it.
3. **Key order never matters, array order always does.** Keys are sorted at
   serialisation time.

## Datasets

16 builders, 18 files. `pokemon` writes three (`pokemon`, `moves`, `type_chart`)
and `text` writes three (`text`, `text_pointers`, `trainer_headers`), which is
why `moves`, `type_chart`, `text_pointers` and `trainer_headers` have no module
of their own.

| File | Entries | Covers |
|---|---|---|
| `constants.json` | 8 tables | the canonical orderings everything else indexes by: species, moves, maps, tilesets, sprites, types |
| `tilesets.json` | 24 | per-tileset block definitions (16 tile indices each), walkable tiles, counter tiles, and the tile sheets they load |
| `maps.json` | 222 | every map header: size, tileset, block data, connections, warps, signs, and object events (NPCs, items, trainers) |
| `font.json` | 7 keys | the text font sheet, the extra glyph sheet, and the byte-to-glyph charmap |
| `sprites.json` | 73 | overworld sprite sheets: `SPRITE_RED` through the NPC cast, with frame counts and walk animation layout |
| `moves.json` | 165 | power, type, accuracy, PP, effect, animation and sound for every move |
| `items.json` | 152 | item names, prices (BCD), key-item flags, and TM/HM pricing |
| `type_chart.json` | 3 keys | type names and the super/not-very-effective matchup table |
| `palettes.json` | 4 keys | the SGB palette set and the per-species palette assignment |
| `icons.json` | 3 keys | party menu icons and the dex-index-to-icon mapping |
| `pokemon.json` | 151 | base stats, types, catch rate, learnset, evolutions, front/back pic pointers, dex entry |
| `trainers.json` | 47 | trainer classes with every party they can field, plus prize money and pic |
| `encounters.json` | 59 | wild encounter tables: grass and water slots, per map, with rate and level |
| `text.json` | 2595 | every dialogue string, decoded from the text-command bytecode |
| `text_pointers.json` | 217 | which `TEXT_*` id on which map resolves to which label (manifest metadata) |
| `trainer_headers.json` | 69 | the sight range, battle text and after-battle text that hook a trainer onto a conversation (manifest metadata) |
| `field.json` | 38 keys | overworld systems: badge gates, cut trees, card key doors, dark maps, bike riding, the HUD, credits, trades |
| `battle_anims.json` | 5 tables | move animation scripts, subanimations, OAM frame blocks, base coordinates, and the three tile atlases |

`text_pointers.json` and `trainer_headers.json` are the two files that are *not*
decoded from the cart. Assembly erased the map-to-text association at build time,
so the manifest carries it and the builder passes it through.

## Tests

Each dataset has a test file written alongside its port. They use `node:test`
directly (no runner), so each is a plain script:

```bash
ROM="/path/to/Pokemon - Red Version (USA, Europe).gb"
MAN=/path/to/gen1recomp/tools/rom_manifest.json
GDIR=/path/to/golden/json

PX_ROM="$ROM" PX_MANIFEST=$MAN PX_GOLDEN=$GDIR          npx tsx test/battle.test.ts
PX_ROM="$ROM" PX_MANIFEST=$MAN PX_GOLDEN=$GDIR          npx tsx test/tilesets.test.ts
PX_ROM="$ROM" PX_MANIFEST=$MAN PX_GOLDEN=$GDIR/maps.json npx tsx test/maps.test.ts
CARTRIDGE_ROM="$ROM" CARTRIDGE_MANIFEST=$MAN CARTRIDGE_GOLDEN=$GDIR npx tsx test/pokemon.test.ts
POKEMON_ROM="$ROM" POKEMON_MANIFEST=$MAN POKEMON_GOLDEN=$GDIR          npx tsx test/graphics.test.ts
```

**Known wart.** The five files were written in parallel and picked three
different environment-variable conventions (`PX_*`, `POKEMON_*`, `CARTRIDGE_*`),
and `PX_GOLDEN` means a directory in `battle`/`tilesets` but a single file in
`maps`. There is therefore no one environment that runs all five. Harmonising
them is a small, worthwhile cleanup. `src/verify.ts` does not depend on any of
this -- it takes its paths as flags.

Typecheck (use the local binary; `npx tsc` resolves to an unrelated package that
prints a joke and exits 0):

```bash
./node_modules/.bin/tsc --noEmit
```

## Rules

- **Never commit the ROM or anything derived from it.** `.gitignore` blocks
  `*.gb` and `Assets/Generated/`; `tools/extractor/.gitignore` blocks
  `node_modules/` and local `out/`. Check `git status --short` before every
  commit.
- The manifest is MIT-licensed metadata and contains no ROM bytes. It ships.
- The golden directory is ROM-derived. It does not.
