// Decision-grade prototype for F4: does the Gen 1 audio path work, and can the
// Lens runtime afford it?
//
// Runs the shipping Assets/Scripts/audio sources under Node against the real
// cartridge. Nothing here is wired into the lens; the deliverable is the
// measurement at the bottom.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/audio.test.mjs <rom.gb> [--mutate]
//
// --mutate is the discrimination check: it shortens the period the synth is
// given by a tenth while still asserting against the period the decoder read,
// so a run that passes without it and fails with it has proved the frequency
// measurement can tell right from wrong.

import { readFileSync } from "node:fs";

// The lens runtime provides print(); Node does not.
globalThis.print = (...args) => console.log("[lens]", ...args);

const romPath = process.argv[2];
const MUTATE = process.argv.includes("--mutate");
if (!romPath) {
  console.error("usage: audio.test.mjs <rom.gb> [--mutate]");
  process.exit(2);
}

const { Rom } = await import("../Assets/Scripts/rom/core/Rom.ts");
const program = await import("../Assets/Scripts/audio/ChannelProgram.ts");
const pulse = await import("../Assets/Scripts/audio/Pulse.ts");

const rom = new Rom(new Uint8Array(readFileSync(romPath)));
const manifest = JSON.parse(
  readFileSync(new URL("../Assets/Manifests/rom_manifest_red.json", import.meta.url), "utf8"),
);
const audio = manifest.audio;
const speciesOrder = manifest.constants.speciesOrder;

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.log("  FAIL  " + name + (detail ? "  -- " + detail : ""));
  }
}

/* ---------------------------------------------------------------- helpers */

function cryFor(name) {
  const index = speciesOrder.indexOf(name);
  if (index < 0) throw new Error("no species " + name);
  const entry = program.readCryEntry(rom, audio.cryData, index + 1);
  const header = audio.cryHeaders[String(entry.cryId)];
  if (!header) throw new Error(name + " names cry header " + entry.cryId + ", which the manifest lacks");
  return { index: index + 1, entry, header, decoded: program.decodeCry(rom, audio.cryData, header, entry) };
}

/**
 * The register --mutate feeds the synth instead of the decoded one.
 *
 * Shortening the PERIOD by a tenth rather than adding a fixed amount to the
 * register: at register 0 an offset of a few counts moves the pitch by well
 * under a percent, so a fixed offset would let the low notes pass and the
 * mutation would prove nothing about them.
 */
function mutateRegister(register) {
  const period = 2048 - register;
  let next = Math.round(period * 0.9);
  if (next === period) next = period - 1;
  if (next < 1) next = period + 1;
  return 2048 - next;
}

/** Rebase one event to t=0 so it can be rendered on its own. */
function isolate(event) {
  return Object.assign({}, event, { startTicks: 0 });
}

/** Radix-2 FFT, in place, on real input padded to a power of two. */
function fftMagnitude(samples) {
  let n = 1;
  while (n < samples.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // Hann window on the real part; the tail stays zero-padded.
  const len = samples.length;
  let mean = 0;
  for (let i = 0; i < len; i++) mean += samples[i];
  mean /= len || 1;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, len - 1));
    re[i] = (samples[i] - mean) * w;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const i0 = start + k;
        const i1 = i0 + size / 2;
        const tr = re[i1] * cr - im[i1] * ci;
        const ti = re[i1] * ci + im[i1] * cr;
        re[i1] = re[i0] - tr; im[i1] = im[i0] - ti;
        re[i0] += tr; im[i0] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return { mag, n };
}

/** Dominant frequency of a buffer, with parabolic sub-bin interpolation. */
function dominantHz(samples, sampleRate) {
  const { mag, n } = fftMagnitude(samples);
  let peak = 1;
  for (let i = 2; i < mag.length - 1; i++) if (mag[i] > mag[peak]) peak = i;
  const a = Math.log(mag[peak - 1] + 1e-12);
  const b = Math.log(mag[peak] + 1e-12);
  const c = Math.log(mag[peak + 1] + 1e-12);
  const delta = (0.5 * (a - c)) / (a - 2 * b + c || 1e-12);
  return ((peak + Math.max(-1, Math.min(1, delta))) * sampleRate) / n;
}

/** Least-squares period through edges that are known to be one period apart. */
function fitPeriod(at, from, to) {
  const n = to - from;
  if (n < 3) return 0;
  let sk = 0;
  let st = 0;
  let skk = 0;
  let skt = 0;
  for (let i = from; i < to; i++) {
    const k = i - from;
    sk += k; st += at[i]; skk += k * k; skt += k * at[i];
  }
  const denominator = n * skk - sk * sk;
  if (denominator === 0) return 0;
  return (n * skt - sk * st) / denominator;
}

/**
 * Frequency measured from the rising edges of the rendered note.
 *
 * Each of the four duty patterns has exactly one contiguous high run per
 * period, so one rising edge is one period -- but three things spoil a plain
 * count of them. The buffer starts part way through a run, which adds a
 * spurious first edge, so the first edge is always dropped. An edge lands on a
 * whole sample, so any single interval quantises the answer: 2048 Hz at 44100
 * is 21.53 samples a period and reads back as 22, which is why the period is
 * fitted rather than averaged. And command 0xFC rotates the duty every frame,
 * which moves the edge WITHIN its period -- duty 3 puts it at step 1 and duty 0
 * at step 7, three quarters of a period apart.
 *
 * That last one is why a rotated note is measured a frame at a time. The
 * rotation only ever advances on a 60 Hz boundary, so inside one frame the
 * edges are exactly periodic; each frame gives a period and the median of them
 * is the answer. It needs about four periods to a frame to work, which the
 * caller checks before asking.
 */
function edgeHz(samples, sampleRate, rotated) {
  const at = [];
  let low = true;
  for (let i = 0; i < samples.length; i++) {
    if (low && samples[i] > 0) { at.push(i); low = false; }
    else if (!low && samples[i] === 0) low = true;
  }
  if (at.length < 5) return 0;

  if (!rotated) {
    const period = fitPeriod(at, 1, at.length);
    return period > 0 ? sampleRate / period : 0;
  }

  const frame = sampleRate / 60;
  const periods = [];
  let from = 0;
  for (let i = 1; i <= at.length; i++) {
    const same = i < at.length &&
      Math.floor(at[i] / frame) === Math.floor(at[from] / frame);
    if (same) continue;
    // Drop the first edge of the frame: the duty may have changed under it.
    if (i - from >= 4) {
      const period = fitPeriod(at, from + 1, i);
      if (period > 0) periods.push(period);
    }
    from = i;
  }
  if (periods.length === 0) return 0;
  periods.sort((x, y) => x - y);
  return sampleRate / periods[periods.length >> 1];
}

/**
 * Pitch of a steady tone at the same period.
 *
 * The real note is short, fades, and has its duty rotated under it, so the
 * loudest thing in its spectrum is often the 15 Hz rotation rather than the
 * note. This renders the same period for a fifth of a second with the
 * envelope and every modulation switched off, which is a signal an FFT can
 * answer about. It tests the synth's pitch for that exact register; edgeHz
 * above tests the note as it will actually be heard.
 */
function probeHz(event, sampleRate, mutate) {
  const seconds = event.frequencyHz > 4000 ? 0.05 : 0.2;
  const probe = Object.assign({}, event, {
    startTicks: 0,
    ticks: Math.round(seconds * program.TICKS_PER_SECOND),
    seconds: seconds,
    fade: 0,
    volume: 15,
    dutyCycle: null,
    duty: event.dutyCycle !== null ? event.dutyCycle[0] : event.duty,
    slide: null,
    vibrato: null,
    sweep: null,
  });
  if (mutate) probe.register = mutateRegister(probe.register);
  return dominantHz(pulse.renderPulse([probe], sampleRate), sampleRate);
}

/**
 * A rate at which this note can be measured at all.
 *
 * A pulse period is eight steps, and the narrowest duty puts only one step
 * high, so a period needs about sixteen samples before an edge is reliable.
 * A handful of cry notes sit at the top of the period register -- MAGNETON
 * asks for 131 kHz -- and simply alias at 44100, as they do through the
 * hardware's own filter. Measuring those at an offline rate keeps them in the
 * count instead of quietly dropping them.
 */
function rateFor(frequencyHz) {
  return Math.max(44100, Math.ceil(frequencyHz * 16));
}

/* ---------------------------------------------------- 1. decode the cry */

console.log("\n== Pidgey's cry, decoded from the cartridge ==");

const pidgey = cryFor("PIDGEY");
console.log(
  `  CryData row ${pidgey.index}: base cry ${pidgey.entry.cryId}` +
  `, pitch 0x${pidgey.entry.pitch.toString(16).toUpperCase()}` +
  `, length ${pidgey.entry.length}` +
  `  ->  header ${pidgey.header.bank.toString(16).padStart(2, "0")}:` +
  `${pidgey.header.address.toString(16).toUpperCase()}` +
  `, tempo ${0x80 + pidgey.entry.length} ticks per unit`,
);

for (const channel of pidgey.decoded.channels) {
  const kind = channel.hardware === 4 ? "noise" : "pulse " + channel.hardware;
  console.log(
    `\n  channel ${channel.number} (${kind}) at ` +
    `${channel.address.toString(16).toUpperCase()}  ` +
    `${channel.events.length} events, ` +
    `${(channel.totalTicks / program.TICKS_PER_SECOND * 1000).toFixed(1)} ms, ` +
    `${channel.complete ? "ran to its end" : "TRUNCATED"}`,
  );
  for (const e of channel.events) {
    const ms = (e.seconds * 1000).toFixed(1).padStart(6);
    if (e.kind === "tone") {
      console.log(
        `    ${ms} ms  tone  period 0x${e.register.toString(16).toUpperCase().padStart(3, "0")}` +
        ` = ${e.frequencyHz.toFixed(1).padStart(7)} Hz   vol ${String(e.volume).padStart(2)}` +
        ` fade ${String(e.fade).padStart(2)}  duty ${e.dutyCycle ? "[" + e.dutyCycle.join(" ") + "]" : e.duty}`,
      );
    } else if (e.kind === "noise") {
      console.log(
        `    ${ms} ms  noise poly 0x${e.noiseParameter.toString(16).toUpperCase().padStart(2, "0")}` +
        `                     vol ${String(e.volume).padStart(2)} fade ${String(e.fade).padStart(2)}`,
      );
    } else {
      console.log(`    ${ms} ms  rest`);
    }
  }
}

console.log("\n== The decode against a hand trace of the same ROM bytes ==");
// Traced by hand from the raw program at 02:49AF/49C2/49D5 (hexdump, then the
// command table), NOT by running this decoder. The frequency arithmetic was
// checked against Audio1_ApplyFrequencyModifier at 02:56B5 in the cartridge.
const expected = {
  5: { duty: [2, 2, 1, 1], tones: [[660, 0x7df, 14, 1], [660, 0x05f, 15, 2], [396, 0x01f, 9, 2], [1188, 0x6df, 14, 1]] },
  6: { duty: [0, 0, 2, 2], tones: [[660, 0x7c0, 11, 1], [528, 0x7c0, 12, 2], [528, 0x760, 6, 2], [1188, 0x6c0, 11, 1]] },
};
for (const number of [5, 6]) {
  const channel = pidgey.decoded.channels.find((c) => c.number === number);
  const want = expected[number];
  check(`channel ${number} decodes ${want.tones.length} events`, channel.events.length === want.tones.length,
        "got " + channel.events.length);
  let ok = true;
  const detail = [];
  for (let i = 0; i < want.tones.length && i < channel.events.length; i++) {
    const e = channel.events[i];
    const [ticks, register, volume, fade] = want.tones[i];
    if (e.ticks !== ticks || e.register !== register || e.volume !== volume || e.fade !== fade) {
      ok = false;
      detail.push(`#${i} got ${e.ticks}/0x${e.register.toString(16)}/${e.volume}/${e.fade}` +
                  ` want ${ticks}/0x${register.toString(16)}/${volume}/${fade}`);
    }
  }
  check(`channel ${number} durations, periods, volumes and fades match the trace`, ok, detail.join("; "));
  check(`channel ${number} picked up its 0xFC duty rotation [${want.duty.join(" ")}]`,
        JSON.stringify(channel.events[0].dutyCycle) === JSON.stringify(want.duty),
        JSON.stringify(channel.events[0].dutyCycle));
}
{
  const noise = pidgey.decoded.channels.find((c) => c.number === 8);
  const want = [[768, 0x11], [768, 0x00], [2304, 0xf0]];
  const got = noise.events.map((e) => [e.ticks, e.noiseParameter]);
  check("channel 8 noise events carry the pitch-shifted polynomial bytes",
        JSON.stringify(got) === JSON.stringify(want),
        JSON.stringify(got));
}

/* ------------------------------------- 2. does the render match the note? */

const RATE = 44100;
console.log("\n== Rendered pitch against decoded period ==");
console.log("  probe  = the note's period held steady for 200 ms, FFT peak");
console.log("  in situ = the note as rendered, period fitted through its rising edges");
if (MUTATE) console.log("  [--mutate] the synth is being fed a period a tenth short; these SHOULD fail");

/**
 * Seconds of this note that actually make sound.
 *
 * A note whose envelope reaches zero goes silent for its remainder, and the
 * programs contain notes written at volume 0 outright -- RHYDON's cry has an
 * 83 ms one. Neither is a fault; both are unmeasurable.
 */
function audibleSeconds(event) {
  if (event.volume === 0) return 0;
  if (event.fade > 0) return Math.min(event.seconds, event.volume * (event.fade / 64));
  return event.seconds;
}

/** Can the note as rendered be read back by counting edges? */
function inSituEligible(event, sampleRate) {
  if (event.slide !== null || event.vibrato !== null || event.sweep !== null) return "modulated";
  if (event.frequencyHz * 16 > sampleRate) return "above rate/16";
  if (event.frequencyHz * audibleSeconds(event) < 5) return "under five audible periods";
  // A rotating duty moves the rising edge inside its period once a frame. Above
  // four periods to the frame there is always a stretch of constant duty long
  // enough to fit a line through; below it the rotation is faster than the note
  // and the edges carry no period to recover.
  if (event.dutyCycle !== null && event.frequencyHz < 4 * 60) return "duty rotates faster than the note";
  return null;
}

check("the period formula is the hardware's: 4194304 / 32 === 131072",
      4194304 / 32 === 131072 && program.registerToHz(1792) === 512);

for (const number of [5, 6]) {
  const channel = pidgey.decoded.channels.find((c) => c.number === number);
  for (let i = 0; i < channel.events.length; i++) {
    const e = channel.events[i];
    if (e.kind !== "tone") continue;
    const rate = rateFor(e.frequencyHz);
    const probe = probeHz(e, rate, MUTATE);
    const probeError = Math.abs(probe - e.frequencyHz) / e.frequencyHz;
    const why = inSituEligible(e, rate);
    let situText = " (in situ: " + why + ")";
    let situOk = true;
    if (why === null) {
      const rendered = isolate(e);
      if (MUTATE) rendered.register = mutateRegister(rendered.register);
      const situ = edgeHz(pulse.renderPulse([rendered], rate), rate, e.dutyCycle !== null);
      if (situ === 0) {
        situText = " (in situ: no steady run of edges)";
      } else {
        const situError = Math.abs(situ - e.frequencyHz) / e.frequencyHz;
        situOk = situError < 0.01;
        situText = ` in situ ${situ.toFixed(1)} Hz (${(situError * 100).toFixed(2)}%)`;
      }
    }
    check(
      `ch${number} note ${i}: asked for ${e.frequencyHz.toFixed(1)} Hz over ${(e.seconds * 1000).toFixed(0)} ms;` +
      ` probe ${probe.toFixed(1)} Hz (${(probeError * 100).toFixed(2)}%)${situText}`,
      probeError < 0.005 && situOk,
    );
  }
}

/* --------------------------- 3. the same check with statistical weight */

console.log("\n== Every cry in the cartridge ==");
{
  let species = 0;
  let tones = 0;
  let probeMatched = 0;
  let situEligible = 0;
  let situMatched = 0;
  let worstProbe = 0;
  let worstProbeLabel = "";
  let worstSitu = 0;
  let worstSituLabel = "";
  const skipped = {};
  let truncated = 0;
  let offline = 0;
  for (let i = 1; i <= speciesOrder.length; i++) {
    const name = speciesOrder[i - 1];
    if (name.startsWith("MISSINGNO") || name.startsWith("UNUSED")) continue;
    const entry = program.readCryEntry(rom, audio.cryData, i);
    const header = audio.cryHeaders[String(entry.cryId)];
    if (!header) continue;
    species++;
    const decoded = program.decodeCry(rom, audio.cryData, header, entry);
    for (const channel of decoded.channels) {
      if (!channel.complete) truncated++;
      if (channel.hardware === 4) continue;
      for (const e of channel.events) {
        if (e.kind !== "tone") continue;
        tones++;
        const rate = rateFor(e.frequencyHz);
        if (rate !== RATE) offline++;
        const probeError = Math.abs(probeHz(e, rate, MUTATE) - e.frequencyHz) / e.frequencyHz;
        if (probeError < 0.005) probeMatched++;
        if (probeError > worstProbe) { worstProbe = probeError; worstProbeLabel = `${name} ${e.frequencyHz.toFixed(1)} Hz`; }
        const why = inSituEligible(e, rate);
        if (why !== null) { skipped[why] = (skipped[why] || 0) + 1; continue; }
        const rendered = isolate(e);
        if (MUTATE) rendered.register = mutateRegister(rendered.register);
        const situ = edgeHz(pulse.renderPulse([rendered], rate), rate, e.dutyCycle !== null);
        if (situ === 0) {
          // A duty rotation that swaps pattern 3 for pattern 0 moves the edge
          // three quarters of a period, and a low note has too few periods in
          // a 60 Hz frame to leave a steady run either side of the jump.
          skipped["no steady run of edges"] = (skipped["no steady run of edges"] || 0) + 1;
          continue;
        }
        situEligible++;
        const situError = Math.abs(situ - e.frequencyHz) / e.frequencyHz;
        if (situError < 0.01) situMatched++;
        if (situError > worstSitu) { worstSitu = situError; worstSituLabel = `${name} ${e.frequencyHz.toFixed(1)} Hz`; }
      }
    }
  }
  console.log(`  ${species} species, ${tones} tone events on the pulse channels` +
              ` (${offline} probed above 44100 because they alias there)`);
  console.log(`  in situ skipped: ` +
              Object.entries(skipped).map(([k, v]) => `${v} ${k}`).join(", "));
  check(`every note's period renders within 0.5% of what it asked for` +
        ` (probe ${probeMatched}/${tones}, worst ${(worstProbe * 100).toFixed(2)}% on ${worstProbeLabel})`,
        tones > 0 && probeMatched === tones);
  check(`and within 1% measured in place, envelope, duty rotation and all` +
        ` (${situMatched}/${situEligible}, worst ${(worstSitu * 100).toFixed(2)}% on ${worstSituLabel})`,
        situEligible > 0 && situMatched === situEligible);
  check(`the in-place check still covers most of the corpus, so it cannot pass by` +
        ` measuring nothing (${situEligible}/${tones} notes)`,
        situEligible > tones * 0.6);
  check("no cry program hit the event cap or ran off its bank", truncated === 0,
        truncated + " channels truncated");
}

/* ---------------------------------------------- 4. does the buffer fit? */

console.log("\n== Output range ==");
{
  const tone = pidgey.decoded.channels.filter((c) => c.hardware !== 4);
  const samples = Math.max(...tone.map((c) => pulse.pulseSampleCount(c.events, RATE)));
  const mix = new Float32Array(samples);
  for (const c of tone) pulse.mixPulseInto(c.events, RATE, mix);
  let rawPeak = 0;
  for (let i = 0; i < mix.length; i++) rawPeak = Math.max(rawPeak, mix[i]);
  const out = new pulse.ChipOutput(RATE);
  out.processInto(mix);
  let lo = Infinity;
  let hi = -Infinity;
  let dc = 0;
  for (let i = 0; i < mix.length; i++) { lo = Math.min(lo, mix[i]); hi = Math.max(hi, mix[i]); dc += mix[i]; }
  console.log(`  two pulse channels summed: raw DAC peak ${rawPeak.toFixed(3)} (unipolar, 2.0 possible)`);
  console.log(`  after the output stage: ${lo.toFixed(4)} .. ${hi.toFixed(4)}` +
              `, mean ${(dc / mix.length).toExponential(2)}, peak before clamp ${out.peak.toFixed(4)}`);
  check("the buffer stays inside [-1, 1]", lo >= -1 && hi <= 1, `${lo} .. ${hi}`);
  check("and does so without the clamp engaging", out.clamped === 0,
        out.clamped + " samples clipped");
  check("the output stage removed the DC offset", Math.abs(dc / mix.length) < 0.01,
        "mean " + dc / mix.length);
}

/* -------------------------------------------------------- 5. the number */

console.log("\n== Cost, which is what this prototype is for ==");
{
  // A real one-second workload: the two pulse channels of Pallet Town's theme,
  // loops taken, decoded once and rendered continuously.
  const song = program.decodeProgram(rom, audio.musicHeaders.Music_PalletTown, {
    frequencyOffset: 0,
    frameTicks: program.FRAME_TICKS,
    allowLoops: true,
    plainFrames: 0,
    // Enough for well over the four seconds rendered below; the song loops
    // forever, so something has to say when to stop.
    maxEvents: 600,
  });
  const pulses = song.channels.filter((c) => c.hardware === 1 || c.hardware === 2);
  console.log(`  Music_PalletTown: ${song.channels.length} channels, ` +
              `${song.channels.map((c) => c.events.length).join("/")} events, ` +
              `${song.seconds.toFixed(1)} s decoded before the cap`);

  // Every timed loop below accumulates a value that is printed afterwards, so
  // the optimiser cannot decide the work is dead and delete it. A number too
  // good to be true usually means it did.
  const t0 = process.hrtime.bigint();
  let decodes = 0;
  let decodeSink = 0;
  while (Number(process.hrtime.bigint() - t0) < 3e8) {
    const d = program.decodeCry(rom, audio.cryData, pidgey.header, pidgey.entry);
    decodeSink += d.channels[0].events.length;
    decodes++;
  }
  const decodeUs = Number(process.hrtime.bigint() - t0) / 1000 / decodes;
  console.log(`  decode: ${decodeUs.toFixed(1)} us for one cry ` +
              `(${decodes} runs, sink ${decodeSink})`);

  for (const rate of [44100, 22050]) {
    const seconds = 4;
    const total = rate * seconds;
    const buffers = pulses.map((c) => {
      const n = pulse.pulseSampleCount(c.events, rate);
      return { events: c.events, samples: Math.min(n, total) };
    });
    const mix = new Float32Array(total);
    // Warm the JIT before the measurement, the way the render loop would be.
    for (const b of buffers) pulse.mixPulseInto(b.events, rate, mix);
    mix.fill(0);
    const start = process.hrtime.bigint();
    for (const b of buffers) pulse.mixPulseInto(b.events, rate, mix);
    const stage = new pulse.ChipOutput(rate);
    stage.processInto(mix);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    let sink = 0;
    for (let i = 0; i < mix.length; i += 997) sink += mix[i];
    const covered = Math.max(...buffers.map((b) => b.samples)) / rate;
    const perSecond = ms / covered;
    console.log(
      `  ${rate} Hz, ${pulses.length} pulse channels + output stage: ` +
      `${perSecond.toFixed(2)} ms per second of audio ` +
      `(x${(1000 / perSecond).toFixed(0)} realtime); ` +
      `projected to all four channels ~${(perSecond * 2).toFixed(2)} ms/s, ` +
      `${((perSecond * 2) / 1000 * 33.3).toFixed(2)} ms of a 30 fps frame` +
      `  [sink ${sink.toFixed(3)}]`,
    );
  }
  const cryStart = process.hrtime.bigint();
  let cries = 0;
  let crySink = 0;
  while (Number(process.hrtime.bigint() - cryStart) < 3e8) {
    const d = program.decodeCry(rom, audio.cryData, pidgey.header, pidgey.entry);
    const tone = d.channels.filter((c) => c.hardware !== 4);
    const n = Math.max(...tone.map((c) => pulse.pulseSampleCount(c.events, RATE)));
    const buf = new Float32Array(n);
    for (const c of tone) pulse.mixPulseInto(c.events, RATE, buf);
    new pulse.ChipOutput(RATE).processInto(buf);
    crySink += buf[buf.length >> 1];
    cries++;
  }
  const cryMs = Number(process.hrtime.bigint() - cryStart) / 1e6 / cries;
  console.log(`  one whole Pidgey cry, decode + render + output: ${cryMs.toFixed(2)} ms ` +
              `for ${(pidgey.decoded.seconds * 1000).toFixed(0)} ms of audio ` +
              `(${cries} runs, sink ${crySink.toFixed(3)})`);
  console.log("  NOTE: Node/V8 on an M-series Mac. The Lens runtime on device is slower;");
  console.log("  this is an upper bound on speed, not a device measurement.");
  console.log("  NOTE: the four-channel projection doubles a pulse channel, which flatters");
  console.log("  the noise channel: its LFSR is clocked at up to 524 kHz, about twelve shifts");
  console.log("  per output sample at 44100, so it will not cost what a pulse channel costs.");
}

console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILURES") + ": " + passed + " passed, " + failed + " failed\n");
process.exit(failed === 0 ? 0 : 1);
