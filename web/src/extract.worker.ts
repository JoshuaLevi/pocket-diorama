// The bake, in the visitor's own browser.
//
// This is the lens's extractor, unchanged: the same three calls tools/bake.mjs
// makes on a Mac and PokemonAR.ts made on the glasses when the bridge still
// carried cartridges. It runs in a Web Worker so the page stays responsive,
// and it is the whole reason the cartridge never has to leave the machine: the
// server only ever sees what comes OUT of this file.
//
// Messages in:  { type: "bake", rom: ArrayBuffer, manifest: object }
// Messages out: { type: "stage", name, index, total }
//               { type: "log", text }
//               { type: "done", text, sha1, chars, maps, ms }
//               { type: "error", message }

import { extractFromRom } from "../../Assets/Scripts/rom/WorldFromRom";
import { bundleFromExtraction } from "../../Assets/Scripts/rom/BundleFromExtraction";
import { bakeCryBank } from "../../Assets/Scripts/audio/CryBank";
import { bakeAudioBank } from "../../Assets/Scripts/audio/AudioBank";
import { Rom } from "../../Assets/Scripts/rom/core/Rom";
import { sha1 } from "../../Assets/Scripts/rom/core/sha1";

declare const self: any;

// The extractor was written for the Lens runtime, which has print() and
// getTime() as globals. Here they are a message and the performance clock.
(globalThis as any).print = (message: any) => {
  self.postMessage({ type: "log", text: String(message) });
};
(globalThis as any).getTime = () => performance.now() / 1000;

self.onmessage = (event: any) => {
  const data = event.data || {};
  if (data.type !== "bake") {
    return;
  }
  const started = performance.now();
  try {
    const rom = new Uint8Array(data.rom);
    const manifest = data.manifest;
    const hash = sha1(rom);
    if (manifest.romSha1 && manifest.romSha1 !== hash) {
      self.postMessage({ type: "error", message: "this cartridge is " + hash + ", the manifest expects " + manifest.romSha1 });
      return;
    }
    const extraction = extractFromRom(rom, manifest, (name: string, index: number, total: number) => {
      self.postMessage({ type: "stage", name, index, total });
    });
    let cries: any = null;
    try {
      cries = bakeCryBank(new Rom(rom), manifest.audio, manifest.constants.speciesOrder);
    } catch (e) {
      self.postMessage({ type: "log", text: "cry bank failed, baking without one: " + e });
    }
    let audio: any = null;
    try {
      audio = bakeAudioBank(new Rom(rom), manifest.audio);
    } catch (e) {
      self.postMessage({ type: "log", text: "audio bank failed, baking without one: " + e });
    }
    const mapIds = Object.keys(extraction.datasets.maps);
    const bundle = bundleFromExtraction(extraction, hash, mapIds, cries, audio);
    const text = JSON.stringify(bundle);
    self.postMessage({
      type: "done",
      text,
      sha1: hash,
      chars: text.length,
      maps: mapIds.length,
      ms: Math.round(performance.now() - started),
    });
  } catch (e: any) {
    self.postMessage({ type: "error", message: String(e && e.message ? e.message : e) });
  }
};
