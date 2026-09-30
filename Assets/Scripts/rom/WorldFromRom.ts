// ROM bytes in, the world bundle the renderer already eats out.
//
// This is the last link in the chain the project exists for: the cartridge arrives
// over the bridge, is decoded here, and becomes a world -- all on the user's own
// device, with nothing Nintendo made ever shipping inside the lens.
//
// The desktop baker (tools/build_bundle.py) does exactly this conversion, and this
// is the same steps in the same order, so the two paths produce the same shape and
// everything downstream cannot tell which one it got.

import { createContext, listDatasets, registerDataset } from "./registry";
import type { RomManifest } from "./types";
import { Rom } from "./core/Rom";
import { Symbols } from "./core/Symbols";
import { encodeBase64 } from "../world/WorldData";

// Node discovers these by scanning the datasets directory; the lens has no
// filesystem, so the same list is written out. Each module exports `builder`.
import { builder as constantsBuilder } from "./datasets/constants";
import { builder as tilesetsBuilder } from "./datasets/tilesets";
import { builder as mapsBuilder } from "./datasets/maps";
import { builder as pokemonBuilder } from "./datasets/pokemon";
import { builder as spritesBuilder } from "./datasets/sprites";
import { builder as fontBuilder } from "./datasets/font";
import { builder as palettesBuilder } from "./datasets/palettes";
import { builder as iconsBuilder } from "./datasets/icons";
import { builder as textBuilder } from "./datasets/text";
import { builder as fieldBuilder } from "./datasets/field";
import { builder as battleAnimsBuilder } from "./datasets/battle_anims";
import { buildItems, buildTrainers, buildEncounters } from "./datasets/battle";

/** The four Game Boy shades the extractor writes, lightest first. */
const SHADE_LEVELS: number[] = [255, 170, 85, 0];

let registered: boolean = false;

/**
 * Registers every dataset once.
 *
 * The registry refuses a second registration of the same name, so this has to be
 * idempotent: a lens that reloads its world would otherwise throw on the second
 * attempt rather than on the first, which is the worse of the two.
 */
function registerAll(): void {
  if (registered) {
    return;
  }
  const all = [
    constantsBuilder, tilesetsBuilder, mapsBuilder, pokemonBuilder,
    spritesBuilder, fontBuilder, palettesBuilder, iconsBuilder,
    textBuilder, fieldBuilder, battleAnimsBuilder,
    // items, trainers and encounters share one module, so they are assembled
    // into builders here rather than being imported as three.
    { name: "items", build: buildItems },
    { name: "trainers", build: buildTrainers },
    { name: "encounters", build: buildEncounters },
  ];
  for (let i = 0; i < all.length; i++) {
    try {
      registerDataset(all[i]);
    } catch (e) {
      print("[WorldFromRom] dataset already registered: " + e);
    }
  }
  registered = true;
}

/** RGBA bytes back to the 2-bit shade index the bundle carries. */
function shadeOf(r: number, g: number, b: number, a: number): number {
  if (a === 0) {
    return 0;
  }
  let best = 0;
  let bestDistance = 1e9;
  for (let s = 0; s < 4; s++) {
    const d = Math.abs(r - SHADE_LEVELS[s]);
    if (d < bestDistance) {
      bestDistance = d;
      best = s;
    }
  }
  return best;
}

/** Four shade indices per byte, as the bundle stores graphics. */
export function packShades(rgba: Uint8Array, pixelCount: number): string {
  const packed = new Uint8Array(Math.floor((pixelCount + 3) / 4));
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const shade = shadeOf(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]);
    packed[i >> 2] |= shade << ((i & 3) * 2);
  }
  return encodeBase64(packed);
}

/** One bit per pixel, 1 = opaque. */
export function packAlpha(rgba: Uint8Array, pixelCount: number): string {
  const mask = new Uint8Array(Math.floor((pixelCount + 7) / 8));
  for (let i = 0; i < pixelCount; i++) {
    if (rgba[i * 4 + 3] !== 0) {
      mask[i >> 3] |= 1 << (i & 7);
    }
  }
  return encodeBase64(mask);
}

export interface ExtractionResult {
  /** Every dataset, keyed by output file basename, as the golden JSON shape. */
  datasets: any;
  /** Decoded RGBA images, keyed by the path the extractor emitted. */
  assets: any;
  elapsedMs: number;
}

/**
 * Runs the full extraction over a verified ROM.
 *
 * The caller must have checked the SHA-1 against the manifest already; decoding an
 * unknown revision with Gen 1 addresses produces garbage that looks like data.
 */
export function extractFromRom(
  romBytes: Uint8Array,
  manifest: RomManifest,
  onStage: (name: string, index: number, total: number) => void
): ExtractionResult {
  registerAll();

  const started = getTime();
  const rom = new Rom(romBytes);
  const symbols = new Symbols(manifest.symbols);

  const assets: any = {};
  const sink = (path: string, bytes: Uint8Array) => {
    assets[path] = bytes;
  };

  const ctx = createContext(rom, symbols, manifest, sink);
  const builders = listDatasets();
  const datasets: any = {};

  for (let i = 0; i < builders.length; i++) {
    const builder = builders[i];
    onStage(builder.name, i, builders.length);
    const produced = builder.build(ctx) as any;
    // A builder either returns one object for its own name, or a map of files.
    if (produced && builder.outputs && builder.outputs.length > 1) {
      for (let k = 0; k < builder.outputs.length; k++) {
        const file = builder.outputs[k];
        datasets[file] = produced[file];
      }
    } else {
      datasets[builder.name] = produced;
    }
  }

  return { datasets: datasets, assets: assets, elapsedMs: (getTime() - started) * 1000 };
}
