# ROM manifests

Symbol addresses and assembly-erased names for each canonical cartridge. From
[gen1recomp](https://github.com/bryanthaboi/gen1recomp) under its MIT licence,
which is included here.

**These contain no ROM bytes.** No graphics, no dialogue, no audio, no complete
symbol file -- only the addresses the extractor reads and the identifiers assembly
throws away: map, species, move, item and trainer ordering, image dimensions, text
labels and substitution markers, and audio header names.

That is exactly why they can live in this repository while the cartridge cannot.
Everything an extraction actually produces is read out of the user's own ROM at
runtime and never leaves their device.

The shipped manifests are:

- `rom_manifest_red.json` — Pokémon Red (USA, Europe), SHA-1
  `ea9bcae617fdf159b045185467ae58b2e4a48b9a`
- `rom_manifest_blue.json` — Pokémon Blue (USA, Europe), SHA-1
  `d7037c83e1ae5b39bde3c30787637ba1d4c48ce2`
- `rom_manifest_yellow.json` — Pokémon Yellow (USA, Europe), SHA-1
  `cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1`

Each SHA-1 identifies the one exact cartridge revision whose addresses that
manifest describes. Callers must refuse a ROM that matches none of these
values; using another revision with a fallback manifest can silently decode
plausible-looking garbage.
