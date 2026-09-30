// Renders the cartridge's own music to a WAV, off the headset.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        tools/render-audio.mjs <bundle.json> [options]
//
//     --track Music_PalletTown   a song, an effect, CRY_PIKACHU, or "list"
//                                comma-separate several and they play in turn
//     --seconds 30               how long to render a looping song for
//     --rate 44100
//     --out /tmp/track.wav
//
// This exists because nothing else in this repository can tell you whether the
// music is RIGHT. The gates prove the synth is stable and that it does not
// clip; only a pair of ears proves it is Pallet Town. So the loop is: render,
// listen, fix -- and the numbers it prints (peak, clipped samples, the channels
// each song uses) are the part a gate can keep afterwards.

import { readFileSync, writeFileSync } from "node:fs";

globalThis.print = (m) => console.log(m);

const args = process.argv.slice(2);
const bundlePath = args[0];
function option(name, fallback) {
  const at = args.indexOf("--" + name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
}
if (!bundlePath || bundlePath.startsWith("--")) {
  console.error("usage: render-audio.mjs <bundle.json> [--track X] [--seconds N] [--out F]");
  process.exit(2);
}

const { AudioBanks } = await import("../Assets/Scripts/audio/AudioBank.ts");
const { Mixer, programVoice, eventVoice } = await import("../Assets/Scripts/audio/Mixer.ts");
const { cryEvents } = await import("../Assets/Scripts/audio/CryBank.ts");

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
if (!bundle.audio || !bundle.audio.banks || bundle.audio.banks.length === 0) {
  console.error("this bundle carries no audio banks; re-bake it");
  process.exit(1);
}
const banks = new AudioBanks(bundle.audio);

const track = option("track", "list");
if (track === "list") {
  const songs = banks.musicLabels();
  console.log(songs.length + " songs:");
  for (const name of songs) console.log("  " + name);
  const sfx = Object.keys(bundle.audio.sfx).sort();
  console.log(sfx.length + " effects: " + sfx.join(", "));
  process.exit(0);
}

const rate = Number(option("rate", 44100));
const seconds = Number(option("seconds", 30));
const outPath = option("out", "/tmp/track.wav");
const wanted = track.split(",").map((s) => s.trim()).filter(Boolean);

/** One voice for a name: a song, an effect, or a baked cry. */
function voiceFor(name, mixer) {
  if (name.startsWith("CRY_")) {
    const voice = eventVoice(name, cryEvents(bundle.cries, name.slice(4)), rate);
    mixer.setEffect(voice);
    return voice;
  }
  const header = banks.music(name) || banks.sfx(name);
  if (!header) {
    console.error("no song or effect called " + name);
    process.exit(1);
  }
  // A song loops; an effect and a fanfare end on their own. Asking a song not
  // to loop renders one pass and stops, which is the honest way to hear where
  // its loop point is.
  const loops = banks.music(name) !== null;
  const voice = programVoice(banks, name, header, rate, loops);
  if (loops) mixer.setMusic(voice); else mixer.setEffect(voice);
  return voice;
}

const block = 1024;
const pieces = [];
const started = Date.now();
let written = 0;
let clamped = 0;
for (const name of wanted) {
  const mixer = new Mixer(rate);
  const voice = voiceFor(name, mixer);
  const total = Math.floor(rate * seconds);
  const samples = new Float32Array(total);
  let at = 0;
  while (at < total) {
    const count = Math.min(block, total - at);
    const view = new Float32Array(count);
    mixer.fill(view);
    samples.set(view, at);
    at += count;
    if (!mixer.busy) break;
  }
  clamped += mixer.clamped;
  console.log("  " + name + "  channels " + JSON.stringify(voice.hardwareInUse()) +
              "  " + (at / rate).toFixed(2) + "s" +
              "  peak " + mixer.peak.toFixed(3));
  pieces.push(samples.subarray(0, at));
  written += at;
  // A breath between tracks, so a medley does not run one into the next.
  if (wanted.length > 1) {
    const gap = new Float32Array(Math.floor(rate * 0.4));
    pieces.push(gap);
    written += gap.length;
  }
}
const elapsed = Date.now() - started;

const samples = new Float32Array(written);
{
  let at = 0;
  for (const piece of pieces) {
    samples.set(piece, at);
    at += piece.length;
  }
}

// A quiet render is as much a failure as a clipped one, and neither shows up
// in an exit code.
let peak = 0;
let energy = 0;
for (let i = 0; i < written; i++) {
  const v = Math.abs(samples[i]);
  if (v > peak) peak = v;
  energy += samples[i] * samples[i];
}
const rms = Math.sqrt(energy / Math.max(1, written));

const bytes = Buffer.alloc(44 + written * 2);
bytes.write("RIFF", 0);
bytes.writeUInt32LE(36 + written * 2, 4);
bytes.write("WAVEfmt ", 8);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20);
bytes.writeUInt16LE(1, 22);
bytes.writeUInt32LE(rate, 24);
bytes.writeUInt32LE(rate * 2, 28);
bytes.writeUInt16LE(2, 32);
bytes.writeUInt16LE(16, 34);
bytes.write("data", 36);
bytes.writeUInt32LE(written * 2, 40);
for (let i = 0; i < written; i++) {
  const v = Math.max(-1, Math.min(1, samples[i]));
  bytes.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
writeFileSync(outPath, bytes);

console.log("RENDER " + wanted.join(" + "));
console.log("  " + (written / rate).toFixed(2) + "s at " + rate + " Hz -> " + outPath);
console.log("  peak " + peak.toFixed(3) + "  rms " + rms.toFixed(3) +
            "  clipped " + clamped);
console.log("  synth " + elapsed + " ms for " + (written / rate).toFixed(1) +
            "s of audio (" + (elapsed / (written / rate) / 10).toFixed(1) + "% of one core)");
