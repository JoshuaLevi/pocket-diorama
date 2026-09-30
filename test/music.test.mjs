// The music: the banks, the two new channels, the mixer's one rule, and the
// jukebox's policy.
//
//   node --experimental-strip-types --import ./test/register.mjs \
//        test/music.test.mjs Assets/Generated/kanto.json [--selftest]
//
// What a test can and cannot say here is worth being honest about. It cannot
// say the music is RIGHT -- only ears do that, which is what tools/render-audio
// exists for. It can say that every channel a song names actually makes a
// sound, that the mix never clips, that a sound effect takes the channels it is
// supposed to take, and that the policy layer starts the song the map asks for.
// Those are the four things that have broken silently before.

const bundlePath = process.argv[2] || "Assets/Generated/kanto.json";
const SELFTEST = process.argv.includes("--selftest");
globalThis.print = () => {};

const { readFileSync } = await import("node:fs");
const { AudioBanks } = await import("../Assets/Scripts/audio/AudioBank.ts");
const { registerToHz } = await import("../Assets/Scripts/audio/ChannelProgram.ts");
const { waveRegisterToHz, WAVE_STEPS } = await import("../Assets/Scripts/audio/WaveChannel.ts");
const { NoiseChannel, noiseStepHz, noiseIsShort, DrumKit } =
  await import("../Assets/Scripts/audio/NoiseChannel.ts");
const { Mixer, programVoice, eventVoice, MASTER_GAIN } =
  await import("../Assets/Scripts/audio/Mixer.ts");
const { ALL_SFX } = await import("../Assets/Scripts/audio/Sfx.ts");
const { Jukebox, battleRole, victoryRole,
        BATTLE_WILD, BATTLE_TRAINER, BATTLE_GYM, BATTLE_FINAL,
        BATTLE_WILD_WIN, BATTLE_TRAINER_WIN, BATTLE_GYM_WIN } =
  await import("../Assets/Scripts/audio/Jukebox.ts");

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL " + label + (detail !== undefined ? "  -- " + detail : ""));
}

let bundle = null;
try {
  bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
} catch (e) {
  console.log("MUSIC SKIP: no bundle at " + bundlePath);
  process.exit(0);
}
if (!bundle.audio || !bundle.audio.banks || bundle.audio.banks.length === 0) {
  console.log("MUSIC SKIP: this bundle carries no audio banks; re-bake it");
  process.exit(0);
}

const banks = new AudioBanks(bundle.audio);
const RATE = 22050;   // half rate: the same claims, half the test's runtime

console.log("=== the banks came along ===");
{
  check("there are banks", bundle.audio.banks.length >= 3, bundle.audio.banks.length);
  check("and the jukebox will play from them", banks.playable);
  check("every song's bank is carried", banks.musicLabels().every((label) => {
    const h = banks.music(label);
    return bundle.audio.banks.indexOf(h.bank) >= 0;
  }));
  check("45 songs", banks.musicLabels().length === 45, banks.musicLabels().length);
  check("the map table is complete",
        Object.keys(bundle.maps).every((m) => banks.songForMap(m) !== ""));
  check("every map's song exists",
        Object.keys(bundle.maps).every((m) => banks.music(banks.songForMap(m)) !== null));
  check("a bank that was not carried is an error, not a zero", (() => {
    try { banks.byte(3, 0x4000); return false; } catch (e) { return true; }
  })());
  check("and so is an address outside one", (() => {
    try { banks.byte(bundle.audio.banks[0], 0x9999); return false; } catch (e) { return true; }
  })());
  const bank = bundle.audio.banks[0];
  check("a word is little-endian",
        banks.word(bank, 0x4000) === banks.byte(bank, 0x4000) + banks.byte(bank, 0x4001) * 256);
}

console.log("=== the wave channel is the bass ===");
{
  // The register means half what it means on a pulse channel. Getting this
  // wrong puts every bass line in the game an octave high, and nothing else
  // in the render would look wrong.
  check("a wave note is an octave below the same register on a pulse",
        Math.abs(waveRegisterToHz(1500) * 2 - registerToHz(1500)) < 1e-9,
        waveRegisterToHz(1500) + " vs " + registerToHz(1500));
  check("the table is 32 samples", WAVE_STEPS === 32);

  const engines = Object.keys(bundle.audio.wave);
  check("every engine has a wave table", engines.length >= 3, engines.length);
  for (const engine of engines) {
    const samples = banks.waveSamples(Number(engine), 0);
    check("engine " + engine + "'s first instrument is 32 nibbles", samples.length === 32);
    check("engine " + engine + "'s instrument is not silence",
          samples.some((v) => v > 0));
    check("engine " + engine + "'s nibbles are four bits",
          samples.every((v) => v >= 0 && v <= 15));
  }
  check("an instrument no engine has is empty, not a throw",
        banks.waveSamples(99, 0).length === 0);
}

console.log("=== the noise channel is the drums ===");
{
  // The rate table, against the hardware's own formula.
  check("divisor code 0 is a half step", Math.abs(noiseStepHz(0x00) - 524288 / 0.5 / 2) < 1e-6);
  check("shift and divisor both slow it down",
        noiseStepHz(0x44) < noiseStepHz(0x04) && noiseStepHz(0x04) < noiseStepHz(0x01));
  check("bit 3 asks for the short sequence", noiseIsShort(0x08) && !noiseIsShort(0x07));

  // The register has to actually rattle: a channel stuck on one value is
  // silence or a DC click, and both would pass a "no exception" test.
  const channel = new NoiseChannel(RATE);
  channel.reset();
  const event = { kind: "noise", noiseParameter: 0x33, volume: 15, fade: 0,
                  startTicks: 0, ticks: 1000, seconds: 0, register: -1, frequencyHz: 0,
                  duty: 0, dutyCycle: null, waveInstrument: 0, waveLevel: 1,
                  vibrato: null, slide: null, sweep: null, at: 0 };
  let ones = 0;
  let zeros = 0;
  for (let i = 0; i < 4000; i++) {
    if (channel.sample(event, i / RATE) > 0) ones++; else zeros++;
  }
  check("the register produces both states", ones > 200 && zeros > 200, ones + "/" + zeros);

  // The drum kit: the tables the manifest carries decode into real events.
  for (const engine of Object.keys(bundle.audio.noise)) {
    const kit = new DrumKit(banks, Number(engine));
    let withSound = 0;
    for (let i = 1; i <= 19; i++) {
      const events = kit.events(i);
      if (events.length > 0 && events.some((e) => e.kind === "noise" && e.volume > 0)) {
        withSound++;
      }
    }
    check("engine " + engine + "'s kit decodes drums", withSound >= 15, withSound + "/19");
  }
  check("a drum the kit does not have is empty, not a throw",
        new DrumKit(banks, 1).events(200).length === 0);
}

console.log("=== every channel a song names makes a sound ===");
{
  // The failure this catches: a channel that decodes, occupies its slot, and
  // renders silence. The bass and the drums are new, and both would look
  // exactly like this.
  for (const label of ["Music_PalletTown", "Music_Routes1", "Music_Cities1"]) {
    const header = banks.music(label);
    const used = programVoice(banks, label, header, RATE, true).hardwareInUse();
    for (let hw = 1; hw <= 4; hw++) {
      if (!used[hw - 1]) continue;
      const voice = programVoice(banks, label, header, RATE, true);
      const muted = [true, true, true, true];
      muted[hw - 1] = false;
      const out = new Float32Array(RATE * 4);
      voice.mix(out, out.length, muted);
      let energy = 0;
      for (let i = 0; i < out.length; i++) energy += out[i] * out[i];
      check(label + " channel " + hw + " is audible on its own", energy > 1, energy.toFixed(2));
    }
  }
}

console.log("=== the mix fits ===");
{
  // Peak is measured BEFORE the clamp, so a mix that only fits because it was
  // clipped fails here rather than sounding bad on the glasses.
  let worst = 0;
  let clipped = 0;
  for (const label of banks.musicLabels()) {
    const mixer = new Mixer(RATE);
    mixer.setMusic(programVoice(banks, label, banks.music(label), RATE, true));
    const frame = new Float32Array(1024);
    for (let i = 0; i < 60; i++) mixer.fill(frame);
    if (mixer.peak > worst) worst = mixer.peak;
    clipped += mixer.clamped;
  }
  check("no song clips", clipped === 0, clipped);
  check("and the loudest still has headroom", worst < 0.95, worst.toFixed(3));
  check("but the gain is not so low the lens is quiet", worst > 0.2, worst.toFixed(3));
  check("the gain is the one the mixer ships", MASTER_GAIN > 0 && MASTER_GAIN <= 1);
}

console.log("=== an effect takes the music's channels ===");
{
  // Gen 1 numbers its channels 1-8 for this: 5-8 ARE 1-4, and an effect
  // silences the music channel whose hardware it claims. Five voices on four
  // channels is a sound no Game Boy ever made.
  const mixer = new Mixer(RATE);
  const music = programVoice(banks, "Music_Cities1", banks.music("Music_Cities1"), RATE, true);
  mixer.setMusic(music);
  const frame = new Float32Array(1024);
  for (let i = 0; i < 10; i++) mixer.fill(frame);

  const effect = programVoice(banks, "Get_Item1", banks.sfx("Get_Item1"), RATE, false);
  const taken = effect.hardwareInUse();
  check("the effect claims at least one channel", taken.some((v) => v));
  mixer.setEffect(effect);
  check("and the mixer knows it", mixer.effectVoice() !== null);

  // The music must keep DECODING while muted, or it would resume mid-note when
  // the effect ends, a bar behind where it should be.
  const before = music.played;
  for (let i = 0; i < 20; i++) mixer.fill(frame);
  check("the music keeps its place while an effect plays",
        music.played === before + 20 * 1024, music.played - before);
}

console.log("=== the jukebox: which song, and why ===");
{
  const box = new Jukebox(banks, bundle.cries, RATE);
  check("it has something to play", box.available);
  check("nothing plays before a map", box.wanted() === "");

  box.setMap("PALLET_TOWN");
  check("a map asks for its own song", box.wanted() === "Music_PalletTown", box.wanted());
  const frame = new Float32Array(512);
  box.fill(frame);
  check("and filling a frame starts it", box.playing() === "Music_PalletTown");
  let energy = 0;
  for (let i = 0; i < 20; i++) {
    box.fill(frame);
    for (let j = 0; j < frame.length; j++) energy += frame[j] * frame[j];
  }
  check("which makes sound", energy > 0.1, energy.toFixed(3));

  box.setOverride(box.battleSong(BATTLE_WILD));
  check("a battle takes the music over", box.wanted() === "Music_WildBattle", box.wanted());
  box.setOverride("");
  check("and giving it back returns the map's", box.wanted() === "Music_PalletTown");

  box.playFanfare(box.battleSong(BATTLE_WILD_WIN));
  check("a fanfare interrupts", box.wanted() === "Music_DefeatedWildMon", box.wanted());
  // It has to END, or the map's music is gone for good. This is the whole
  // reason a fanfare and a song are built differently.
  let frames = 0;
  while (box.wanted() !== "Music_PalletTown" && frames < 4000) {
    box.fill(frame);
    frames++;
  }
  check("and ends, giving the map its music back", box.wanted() === "Music_PalletTown",
        frames + " frames");
  check("in a reasonable time", frames > 1 && frames < 4000, frames);

  // How LONG each victory fanfare runs, because that is what decides where it
  // has to be started rather than whether it can be.
  //
  // The lens played it at the very end of a fight -- after the last message box
  // had closed -- so all of it landed on the overworld and the wearer walked
  // off down the road with battle music following them: "toen ik klaar was met
  // de battle bleef het geluid van de battle winnen doorgaan". It starts at the
  // faint now, as the cartridge does, and the experience lines are read over
  // it. These numbers are the reason, so they are measured rather than assumed.
  for (const role of [BATTLE_WILD, BATTLE_TRAINER, BATTLE_GYM, BATTLE_FINAL]) {
    const win = new Jukebox(banks, bundle.cries, RATE);
    win.setMap("PALLET_TOWN");
    win.fill(frame);
    const label = win.battleSong(victoryRole(role));
    win.playFanfare(label);
    let ran = 0;
    const LIMIT = 20000;
    while (win.wanted() !== "Music_PalletTown" && ran < LIMIT) {
      win.fill(frame);
      ran++;
    }
    const seconds = ran * frame.length / RATE;
    check("the " + role + " victory ends and gives the map its music back",
          ran < LIMIT, "still going after " + seconds.toFixed(1) + "s");
    // Long enough to be worth hearing, short enough that a fight started at
    // the faint is over by the time the box closes. The gym leader's is the
    // long one and always was.
    check("...and " + label + " runs " + seconds.toFixed(1) + "s",
          seconds > 2 && seconds < 60, seconds.toFixed(1) + "s");
  }

  box.silence();
  check("a script can ask for silence", box.wanted() === "");
  box.setMap("VIRIDIAN_CITY");
  check("and walking to a new map ends it", box.wanted() !== "", box.wanted());

  box.playNamed("Get_Item1");
  check("a script's sound is an effect", box.problems() === "", box.problems());
  box.playNamed("Pokecenter_Heal");
  check("and the Pokecenter's jingle, which is music, still plays",
        box.wanted() === "Music_PkmnHealed", box.wanted());
  box.playNamed("No_Such_Sound");
  check("a name in neither table is counted, not thrown", box.problems() !== "");

  const cries = new Jukebox(banks, bundle.cries, RATE);
  cries.playCry("PIKACHU");
  let cryEnergy = 0;
  for (let i = 0; i < 40; i++) {
    cries.fill(frame);
    for (let j = 0; j < frame.length; j++) cryEnergy += frame[j] * frame[j];
  }
  check("a cry still sounds, through the same mixer", cryEnergy > 0.1, cryEnergy.toFixed(3));
}

console.log("=== every sound the lens asks for exists ===");
{
  // The failure this catches has already happened once: a script has asked for
  // "Pokecenter_Heal" since long before anything could play a sound, and the
  // cartridge has no effect by that name -- it is a short piece of music. A
  // wrong name is silence, and silence is what audio bugs look like anyway.
  for (const key of ALL_SFX) {
    check(key + " is in the cartridge", banks.sfx(key) !== null);
  }
  check("there are names to check", ALL_SFX.length >= 10, ALL_SFX.length);

  // And the one that is NOT an effect still reaches the right half of the ROM.
  const box = new Jukebox(banks, bundle.cries, RATE);
  box.playNamed("Pokecenter_Heal");
  check("the Pokecenter's jingle resolves as music", box.wanted() === "Music_PkmnHealed");
  check("with nothing reported as missing", box.problems() === "", box.problems());
}

console.log("=== which battle gets which theme ===");
{
  check("a wild encounter", battleRole("") === BATTLE_WILD);
  check("an ordinary trainer", battleRole("OPP_YOUNGSTER") === BATTLE_TRAINER);
  check("a gym leader", battleRole("OPP_BROCK") === BATTLE_GYM);
  check("the Elite Four share it", battleRole("OPP_LANCE") === BATTLE_GYM);
  check("Giovanni too", battleRole("OPP_GIOVANNI") === BATTLE_GYM);
  check("the champion has his own", battleRole("OPP_RIVAL3") === BATTLE_FINAL);
  check("the earlier rival fights do not", battleRole("OPP_RIVAL1") === BATTLE_TRAINER);

  check("a wild win", victoryRole(BATTLE_WILD) === BATTLE_WILD_WIN);
  check("a trainer win", victoryRole(BATTLE_TRAINER) === BATTLE_TRAINER_WIN);
  check("a gym win", victoryRole(BATTLE_GYM) === BATTLE_GYM_WIN);
  check("the champion's win is the gym leader's fanfare",
        victoryRole(BATTLE_FINAL) === BATTLE_GYM_WIN);

  const box = new Jukebox(banks, bundle.cries, RATE);
  for (const role of [BATTLE_WILD, BATTLE_TRAINER, BATTLE_GYM, BATTLE_FINAL,
                      BATTLE_WILD_WIN, BATTLE_TRAINER_WIN, BATTLE_GYM_WIN]) {
    check(role + " names a song the bundle has", banks.music(box.battleSong(role)) !== null,
          box.battleSong(role));
  }
}

console.log("=== it is cheap enough to run every frame ===");
{
  const mixer = new Mixer(RATE);
  mixer.setMusic(programVoice(banks, "Music_Routes1", banks.music("Music_Routes1"), RATE, true));
  const frame = new Float32Array(1024);
  const started = Date.now();
  const blocks = Math.ceil(RATE * 10 / 1024);
  for (let i = 0; i < blocks; i++) mixer.fill(frame);
  const elapsed = Date.now() - started;
  // Ten seconds of audio in well under ten seconds of CPU. The real budget is
  // a fraction of a frame on the headset; this only catches an accident of a
  // different order, like decoding a song per sample.
  check("ten seconds of four-channel music synthesises fast", elapsed < 1500, elapsed + " ms");
}

if (SELFTEST) {
  console.log("=== selftest ===");
  function expectFailures(label, fn) {
    const before = fail;
    const quiet = console.log;
    console.log = () => {};
    try { fn(); } catch (e) { fail++; } finally { console.log = quiet; }
    const noticed = fail > before;
    fail = before;
    if (noticed) { pass++; } else { fail++; console.log("  FAIL selftest: " + label); }
  }
  expectFailures("a silent channel would be noticed", () => {
    // Mute every channel and score it as if one were playing.
    const voice = programVoice(banks, "Music_Routes1", banks.music("Music_Routes1"), RATE, true);
    const out = new Float32Array(RATE);
    voice.mix(out, out.length, [true, true, true, true]);
    let energy = 0;
    for (let i = 0; i < out.length; i++) energy += out[i] * out[i];
    check("silence detector", energy > 1);
  });
  expectFailures("a wave channel read as a pulse would be noticed", () => {
    check("octave detector", Math.abs(waveRegisterToHz(1500) - registerToHz(1500)) < 1e-9);
  });
}

console.log("");
console.log("MUSIC  " + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
