#!/usr/bin/env python3
"""Top-down colour preview of a baked map, straight from the bundle.

The look of the diorama is decided entirely by tile category -> palette, and
checking that inside Lens Studio costs a preview restart per attempt. This
renders the same colouring buildTileAtlas() applies, top-down, in a second.

    python3 tools/tilepreview.py REDS_HOUSE_2F PALLET_TOWN -o /tmp/out

It is a look check, not a gate: the diorama's geometry, curvature and slab are
only real in the lens.
"""
import base64
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "Assets/Generated/kanto.json"
TILE = 8


def unpack(data: str, count: int) -> list[int]:
    raw = base64.b64decode(data)
    return [(raw[i // 4] >> ((i % 4) * 2)) & 3 for i in range(count)]


def render(bundle: dict, map_id: str, scale: int = 4) -> Image.Image:
    m = bundle["maps"][map_id]
    ts = bundle["tilesets"][m["tileset"]]
    palettes = bundle["palettes"]
    tile_palettes = bundle.get("tilePalettes", {})
    categories = ts.get("categories") or []
    fallback = palettes.get(m.get("palette") or bundle["defaultPalette"])

    width_px, height_px = ts["tileWidth"], ts["tileHeight"]
    shades = unpack(ts["shades"], width_px * height_px)
    across = width_px // TILE

    def tile_image(tile: int) -> Image.Image:
        colours = fallback
        if 0 <= tile < len(categories):
            colours = tile_palettes.get(categories[tile], fallback)
        img = Image.new("RGB", (TILE, TILE))
        px = img.load()
        ox, oy = (tile % across) * TILE, (tile // across) * TILE
        for y in range(TILE):
            for x in range(TILE):
                px[x, y] = tuple(colours[shades[(oy + y) * width_px + ox + x]])
        return img

    # A block is 4x4 tiles and covers 2x2 step cells, which is the grid the
    # voxel builder walks. Out-of-range indices are clamped to 0 exactly as
    # tileUv() clamps them, so this preview shows the same wrong tile the lens
    # draws rather than hiding the fault.
    blocks = ts["blocks"]
    count = (width_px // TILE) * (height_px // TILE)
    w, h = m["width"], m["height"]
    out = Image.new("RGB", (w * 4 * TILE, h * 4 * TILE))
    for by in range(h):
        for bx in range(w):
            block = blocks[m["blocks"][by * w + bx]]
            for i in range(16):
                tile = block[i]
                if tile < 0 or tile >= count:
                    tile = 0
                out.paste(tile_image(tile),
                          ((bx * 4 + i % 4) * TILE, (by * 4 + i // 4) * TILE))
    return out.resize((out.width * scale, out.height * scale), Image.NEAREST)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    out_dir = Path("/tmp")
    if "-o" in sys.argv:
        out_dir = Path(sys.argv[sys.argv.index("-o") + 1])
        args = [a for a in args if a != str(out_dir)]
    out_dir.mkdir(parents=True, exist_ok=True)
    bundle = json.loads(BUNDLE.read_text())
    for map_id in args or ["PALLET_TOWN"]:
        path = out_dir / f"{map_id}.png"
        render(bundle, map_id).save(path)
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
