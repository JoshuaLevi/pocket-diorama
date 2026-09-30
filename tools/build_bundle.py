#!/usr/bin/env python3
"""Bake the golden extraction into the compact bundle the lens consumes.

The lens never receives a PNG. Tile and sprite graphics travel as raw 2-bit
shade indices packed four to a byte, and the lens rebuilds the atlas at runtime
with ProceduralTextureProvider.setPixels() using a palette. That keeps the
payload tiny and skips Lens Studio's asset-import pipeline entirely.

This produces exactly the same shape the in-lens RomExtractor will produce, so
the fallback path and the real path feed identical code downstream.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

from PIL import Image

# The four Game Boy shades, as written by build_rom_data.py.
SHADES = {(255, 255, 255): 0, (170, 170, 170): 1, (85, 85, 85): 2, (0, 0, 0): 3}

# The SGB overworld palette rule, from engine/gfx/palettes.asm SetPal_Overworld:
# towns own theirs, routes take PAL_ROUTE, and the Pokemon Tower and cave tilesets
# override on top. Interiors inherit the last outdoor map, which needs runtime
# state and so is left to the lens; the fallback here is the same ROUTE the
# original falls back to.
#
# This mapping is hand-authored metadata, not ROM content -- it is the assembly's
# own table, recovered by the reference project and carried under its MIT licence.
DEFAULT_PALETTE = "ROUTE"

PALETTE_BY_MAP = {
    "PALLET_TOWN": "PALLET", "VIRIDIAN_CITY": "VIRIDIAN",
    "PEWTER_CITY": "PEWTER", "CERULEAN_CITY": "CERULEAN",
    "LAVENDER_TOWN": "LAVENDER", "VERMILION_CITY": "VERMILION",
    "CELADON_CITY": "CELADON", "FUCHSIA_CITY": "FUCHSIA",
    "CINNABAR_ISLAND": "CINNABAR", "INDIGO_PLATEAU": "INDIGO",
    "SAFFRON_CITY": "SAFFRON",
    "LORELEIS_ROOM": "PALLET", "BRUNOS_ROOM": "CAVE",
}

PALETTE_BY_TILESET = {"CEMETERY": "GRAYMON", "CAVERN": "CAVE"}


def palette_for(map_id: str, tileset: str) -> str:
    """The cascade the original uses: by map, then by tileset, then by prefix."""
    if map_id in PALETTE_BY_MAP:
        return PALETTE_BY_MAP[map_id]
    if tileset in PALETTE_BY_TILESET:
        return PALETTE_BY_TILESET[tileset]
    if map_id.startswith("ROUTE_"):
        return "ROUTE"
    return DEFAULT_PALETTE



# ---------------------------------------------------------------- tile colour
#
# Gen 1 stores four grey shades per tile and colours them with one Super Game Boy
# palette per map. That is faithful, and it is also why Pallet Town renders as pale
# mint and washed-out blue. The reference footage does something else: it colours by
# what a tile IS -- grass green, path violet, water blue, tree dark green -- which
# is what makes a voxel world read at a glance.
#
# These colours are not chosen by taste. They are sampled from the reference video
# itself (frames where the world fills the screen), quantised and taken by area:
#   #6e46b4 the path, #78b400 and #649600 the grass, #dcc896 the sand.
# Everything else is built around those in the same key.
#
# Each entry is the four Game Boy shades, lightest first.
TILE_PALETTES = {
    "GRASS":      [[160, 216, 24], [120, 180, 0], [76, 122, 6], [42, 74, 4]],
    "TALL_GRASS": [[134, 196, 14], [94, 154, 0], [58, 102, 4], [32, 60, 2]],
    "PATH":       [[155, 120, 216], [110, 70, 180], [74, 47, 125], [42, 26, 74]],
    "SAND":       [[240, 224, 180], [220, 200, 150], [168, 148, 106], [96, 82, 64]],
    "WATER":      [[140, 216, 240], [70, 168, 220], [42, 110, 160], [22, 64, 94]],
    "TREE":       [[92, 188, 22], [47, 128, 0], [28, 82, 0], [13, 44, 0]],
    "STRUCTURE":  [[244, 240, 224], [210, 200, 172], [140, 132, 112], [70, 64, 52]],
    "LEDGE":      [[200, 168, 112], [150, 120, 74], [94, 74, 44], [50, 38, 22]],
    "DIRT":       [[180, 130, 80], [140, 100, 56], [90, 64, 34], [50, 36, 15]],
    # Indoors and underground. Gen 1 colours a whole interior with one SGB
    # palette, which is why Red's bedroom came out cream furniture on a cream
    # floor: the only thing separating a bed from the wall it stands against was
    # the black outline. These three split it by what the tileset already knows
    # -- you can stand on it, you walk through it, or it is in your way.
    "FLOOR":      [[214, 178, 132], [176, 136, 88], [118, 88, 52], [64, 46, 26]],
    "WALL":       [[186, 196, 216], [138, 150, 180], [88, 98, 126], [46, 52, 70]],
    "DOOR":       [[248, 208, 112], [224, 168, 48], [160, 116, 24], [86, 60, 12]],
    "ROCK":       [[176, 168, 152], [136, 128, 112], [88, 82, 70], [46, 42, 36]],
}

# Which ground a tileset stands on. The ledge table and the cut-tree swaps are
# OVERWORLD tile ids, so they are only meaningful there: applied by raw index to
# an interior sheet they painted Red's window frames forest green and his bed
# rail brown. A tile id means nothing outside its own tileset.
OUTDOOR_TILESETS = {"OVERWORLD", "FOREST", "PLATEAU"}
CAVE_TILESETS = {"CAVERN", "UNDERGROUND"}

# Which category each overworld tile belongs to. Derived from the ROM's own data
# wherever it can be -- grassTile, the ledge table, the cut-tree swaps, the door
# and warp lists -- and read off the map itself where it cannot: on Route 1 the
# wide middle strip is tile 57 and the ground either side is 44, which is exactly
# the purple path and green verges the footage shows.
OVERWORLD_CATEGORIES = {
    "TALL_GRASS": [82],
    "PATH": [57],
    "GRASS": [44],
    "WATER": [20],
    # 11 and 50-63 are the cuttable trees; 42/43/58/59 are the 2x2 blob the
    # border block is made of, which is every town's and every route's edge.
    # They were STRUCTURE, which drew Kanto's treeline in building cream.
    "TREE": [11, 42, 43, 50, 51, 52, 53, 58, 59, 60, 61, 63, 96],
    "LEDGE": [13, 29, 39, 54, 55],
}


def font_bundle(font: dict, adir: Path) -> dict:
    """The glyph sheet, packed the same way tiles are."""
    image_path = adir / Path(font["image"]).relative_to("assets/generated")
    width, height, data = pack_shades(Image.open(image_path))
    return {
        "glyphsPerRow": font["glyphsPerRow"],
        "mainBase": font["mainBase"],
        "extraBase": font["extraBase"],
        "charmap": font["charmap"],
        "width": width,
        "height": height,
        "shades": data,
    }


def tile_categories(tileset: dict, ledge_tiles: set, tree_tiles: set) -> list[str]:
    """A category per tile index, for the whole sheet."""
    tiles_across = tileset["imageWidth"] // 8
    tiles_down = tileset["imageHeight"] // 8
    count = tiles_across * tiles_down

    walkable = set(tileset.get("walkable", []))
    grass = tileset.get("grassTile", -1)
    doors = set(tileset.get("doorTiles", [])) | set(tileset.get("warpTiles", []))

    explicit = {}
    if tileset["id"] == "OVERWORLD":
        for name, indices in OVERWORLD_CATEGORIES.items():
            for index in indices:
                explicit[index] = name

    is_overworld = tileset["id"] == "OVERWORLD"
    outdoor = tileset["id"] in OUTDOOR_TILESETS
    cave = tileset["id"] in CAVE_TILESETS

    out = []
    for tile in range(count):
        if tile in explicit:
            out.append(explicit[tile])
        elif tile == grass:
            out.append("TALL_GRASS")
        elif is_overworld and tile in ledge_tiles:
            out.append("LEDGE")
        elif is_overworld and tile in tree_tiles:
            out.append("TREE")
        elif tile in doors:
            out.append("STRUCTURE" if outdoor or cave else "DOOR")
        elif tile in walkable:
            out.append("GRASS" if outdoor else "DIRT" if cave else "FLOOR")
        else:
            out.append("STRUCTURE" if outdoor else "ROCK" if cave else "WALL")
    return out


def pack_shades(image: Image.Image) -> tuple[int, int, str]:
    """Return (width, height, base64) with four 2-bit shade indices per byte."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    packed = bytearray((width * height + 3) // 4)
    for index in range(width * height):
        x, y = index % width, index // width
        r, g, b, a = pixels[x, y]
        if a == 0:
            shade = 0
        else:
            shade = SHADES.get((r, g, b))
            if shade is None:
                # Nearest of the four grey levels; the extractor only ever emits
                # exact shades, so this is a guard rather than a code path.
                shade = min(range(4), key=lambda s: abs(r - (255 - s * 85)))
        packed[index // 4] |= shade << ((index % 4) * 2)
    return width, height, base64.b64encode(bytes(packed)).decode("ascii")


def alpha_mask(image: Image.Image) -> str:
    """One bit per pixel, 1 = opaque. Sprites need it; tiles are fully opaque."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    mask = bytearray((width * height + 7) // 8)
    for index in range(width * height):
        if pixels[index % width, index // width][3] != 0:
            mask[index // 8] |= 1 << (index % 8)
    return base64.b64encode(bytes(mask)).decode("ascii")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", required=True, help="golden JSON directory")
    ap.add_argument("--assets", required=True, help="golden assets directory")
    ap.add_argument("--out", required=True, help="bundle output path (.json)")
    ap.add_argument("--maps", default="", help="comma-separated map ids; empty = all")
    args = ap.parse_args(argv[1:])

    jdir, adir, out = Path(args.json), Path(args.assets), Path(args.out)
    load = lambda name: json.loads((jdir / f"{name}.json").read_text(encoding="utf-8"))

    constants = load("constants")
    tilesets = load("tilesets")
    maps = load("maps")
    encounters = load("encounters")
    pokemon = load("pokemon")
    sprites = load("sprites")
    palettes = load("palettes")
    moves = load("moves")
    items = load("items")
    type_chart = load("type_chart")
    field = load("field")
    text = load("text")
    text_pointers = load("text_pointers")
    # Older golden directories predate this dataset; a bundle without it has
    # no fightable ordinary trainers, and bundle.test says so.
    try:
        trainer_headers = load("trainer_headers")
    except FileNotFoundError:
        trainer_headers = {}
    font = load("font")

    ledge_tiles = {row["ledgeTile"] for row in field.get("ledges", [])}
    tree_tiles = {row["before"] for row in field.get("cutTreeSwaps", [])}

    wanted = [m.strip() for m in args.maps.split(",") if m.strip()] or list(maps)
    missing = [m for m in wanted if m not in maps]
    if missing:
        print(f"unknown maps: {', '.join(missing)}", file=sys.stderr)
        return 1

    # Only ship the tilesets the selected maps actually reference.
    used_tilesets = sorted({maps[m]["tileset"] for m in wanted})

    out_tilesets = {}
    for tid in used_tilesets:
        ts = tilesets[tid]
        image_path = adir / Path(ts["image"]).relative_to("assets/generated")
        width, height, data = pack_shades(Image.open(image_path))
        out_tilesets[tid] = {
            "id": tid,
            "blocks": ts["blocks"],
            "walkable": ts["walkable"],
            "grassTile": ts.get("grassTile", -1),
            "warpTiles": ts.get("warpTiles", []),
            "doorTiles": ts.get("doorTiles", []),
            "counterTiles": ts.get("counterTiles", []),
            "tilesPerRow": ts["tilesPerRow"],
            "tileWidth": width,
            "tileHeight": height,
            "shades": data,
            "categories": tile_categories(ts, ledge_tiles, tree_tiles),
        }

    out_maps = {}
    for mid in wanted:
        m = maps[mid]
        out_maps[mid] = {
            "id": mid,
            # The label is how text_pointers is keyed, so dialogue cannot be
            # resolved without it.
            "label": m["label"],
            "palette": palette_for(mid, m["tileset"]),
            "width": m["width"],
            "height": m["height"],
            "blocks": m["blocks"],
            "borderBlock": m["borderBlock"],
            "tileset": m["tileset"],
            "connections": m["connections"],
            "warps": m["warps"],
            "signs": m["signs"],
            "objects": m["objects"],
        }

    # Sprites referenced by the objects on the selected maps, plus the player.
    used_sprites = {"SPRITE_RED"}
    for mid in wanted:
        for obj in maps[mid]["objects"]:
            if obj.get("sprite"):
                used_sprites.add(obj["sprite"])

    out_sprites = {}
    for sid in sorted(used_sprites):
        spec = sprites.get(sid)
        if not spec:
            continue
        image_path = adir / Path(spec["image"]).relative_to("assets/generated")
        if not image_path.exists():
            continue
        image = Image.open(image_path)
        width, height, data = pack_shades(image)
        out_sprites[sid] = {
            "id": sid,
            "frames": spec["frames"],
            "walker": spec.get("walker", False),
            "width": width,
            "height": height,
            "shades": data,
            "alpha": alpha_mask(image),
        }

    out_species = {}
    for name, spec in pokemon.items():
        if not isinstance(spec, dict):
            continue
        entry = {
            "id": name,
            "name": spec.get("name", name),
            "index": spec.get("index"),
            "dex": spec.get("dex"),
            "types": spec.get("types", []),
            "baseStats": spec.get("baseStats", spec.get("base", {})),
            "catchRate": spec.get("catchRate"),
            "baseExp": spec.get("baseExp"),
            "growthRate": spec.get("growthRate"),
            "level1Moves": spec.get("level1Moves", []),
            "learnset": spec.get("learnset", []),
            "evolutions": spec.get("evolutions", []),
        }
        # The Pokedex data page's own fields, mirroring BundleFromExtraction.ts:
        # category, height, weight and the description's text label. The golden
        # pokemon.json already carries these under dexEntry (gen1recomp's own
        # _dex_entry port, keyed the same in both extraction paths) -- guarded
        # for an older golden directory that predates it.
        dex_entry = spec.get("dexEntry")
        if dex_entry:
            entry["category"] = dex_entry.get("kind")
            entry["heightFeet"] = dex_entry.get("heightFt")
            entry["heightInches"] = dex_entry.get("heightIn")
            entry["weightTenths"] = dex_entry.get("weight")
            entry["dexText"] = dex_entry.get("text")
        # Both battle pictures: the front one for whoever you are facing, the
        # back one for your own Pokemon, which is the view the cartridge gives
        # you of it. A back pic is 32x32 against the front's 40x40 and costs
        # about half as much, so carrying both for all 151 is under 300 KB of a
        # bundle that is already 1.7 MB -- and the alternative, working out
        # which species the player can ever own, is a wrong answer waiting to
        # happen: every trainer's party, every gift, every trade and every
        # evolution of all of those.
        for field_name, key in (("spriteFront", "front"), ("spriteBack", "back")):
            source = spec.get(field_name)
            if not source:
                continue
            image_path = adir / Path(source).relative_to("assets/generated")
            if image_path.exists():
                image = Image.open(image_path)
                width, height, data = pack_shades(image)
                entry[key] = {
                    "width": width,
                    "height": height,
                    "shades": data,
                    "alpha": alpha_mask(image),
                }
        out_species[name] = entry

    out_items = {}
    for item_id, item in items.items():
        out_items[item_id] = {
            "id": item["id"],
            "name": item["name"],
            "price": item["price"],
        }

    bundle = {
        "format": 2,
        "source": "baked",
        "romSha1": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
        "palettes": palettes["palettes"],
        "tilePalettes": TILE_PALETTES,
        "defaultPalette": DEFAULT_PALETTE,
        "mapOrder": constants["mapOrder"],
        "tilesets": out_tilesets,
        "maps": out_maps,
        "encounters": {k: v for k, v in encounters.items() if k in out_maps},
        "sprites": out_sprites,
        "species": out_species,
        "items": out_items,
        # Dialogue is read out of the ROM like everything else. It is what makes
        # NPCs and signs worth walking up to, and it is a third of the bundle.
        # The message box draws in the cartridge's own typeface, so the glyph
        # sheet travels like every other graphic: shade indices, not a PNG.
        "font": font_bundle(font, adir),
        "text": text,
        "textPointers": {k: v for k, v in text_pointers.items()},
        "trainerHeaders": trainer_headers,
        "moves": {k: v for k, v in moves.items() if isinstance(v, dict)},
        "typeChart": type_chart,
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    size = out.stat().st_size
    print(f"{out}  {size:,} bytes  "
          f"({len(out_maps)} maps, {len(out_tilesets)} tilesets, "
          f"{len(out_sprites)} sprites, {len(out_species)} species)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
