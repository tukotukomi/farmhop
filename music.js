// Betty Lou's farm tune: 8-bit vaporwave bluegrass, synthesized live with WebAudio.
// No audio files. Bluegrass parts (banjo roll, boom-chick bass, mandolin chop,
// fiddle) are played on chiptune voices (thin pulse, triangle, square, noise) over
// jazzy vaporwave chords, then run through a tape wobble, a dusty low-pass, an
// echo and a soft reverb. D major, 84 BPM, 32 bars (about 90 s) on a loop:
// A (band only), A (fiddle comes in), B, A.
//
// Hop Supporters can switch to other versions, all the same chords and fiddle tune:
// drum and bass (a two-step break at double time, 168, a reese bass, no swing), Farm
// House (minimal house at 125) and Psy Farm (psytrance at 144). The tempo changes over
// on a bar line, and the song carries on from the same bar.
//
// Players can buy other keys and scales: setKey(n, scale) moves every note n semitones
// (-6..5) from D and into the scale (see SCALES), on a bar line, and the game's hopper
// sounds follow the same key (see `key` and `scale`).

const SWING = 0.06;                 // a touch of lilt on the off-sixteenths
const STYLES = {
  classic: { bpm: 84, swing: SWING }, dnb: { bpm: 84, swing: 0 }, house: { bpm: 125, swing: 0 }, psy: { bpm: 144, swing: 0 },
  organ: { bpm: 84, swing: SWING },   // the spooky farm's: not a choice, the song goes there by itself
};
export const SONGS = ['classic', 'dnb', 'house', 'psy'];
const stepOf = st => 60 / STYLES[st].bpm / 4;   // one sixteenth note, in seconds

// Chords as MIDI note lists (low to high). A: I-vi-IV-V with sevenths and ninths.
const C = {
  Dmaj7: [50, 54, 57, 61], Bm9: [47, 50, 54, 57, 61], Gmaj7: [43, 47, 50, 54],
  A7sus: [45, 50, 52, 55], A7: [45, 49, 52, 55], Em7: [40, 43, 47, 50],
  Fsm7: [42, 45, 49, 52], Em9: [40, 43, 47, 50, 54], A13: [45, 49, 55, 59, 66],
  DoverFs: [42, 50, 54, 57],
};
const A_PROG = [C.Dmaj7, C.Bm9, C.Gmaj7, C.A7sus, C.Dmaj7, C.Bm9, C.Em7, C.A7];
const B_PROG = [C.Gmaj7, C.Fsm7, C.Em9, C.A13, C.DoverFs, C.Gmaj7, C.A7sus, C.A7];

// Fiddle tune: per bar, [sixteenth, midi note, length in sixteenths].
const A_TUNE = [
  [[0, 74, 4], [4, 73, 2], [6, 71, 2], [8, 69, 6], [14, 66, 2]],
  [[0, 66, 3], [3, 69, 1], [4, 71, 4], [8, 74, 4], [12, 73, 4]],
  [[0, 71, 6], [6, 69, 2], [8, 67, 4], [12, 66, 4]],
  [[0, 64, 4], [4, 66, 2], [6, 67, 2], [8, 69, 8]],
  [[0, 78, 4], [4, 76, 2], [6, 74, 2], [8, 73, 4], [12, 74, 4]],
  [[0, 71, 4], [4, 69, 4], [8, 66, 4], [12, 69, 4]],
  [[0, 67, 4], [4, 71, 2], [6, 69, 2], [8, 67, 4], [12, 64, 4]],
  [[0, 69, 8], [8, 61, 2], [10, 64, 2], [12, 66, 2], [14, 69, 2]],
];
const B_TUNE = [
  [[0, 71, 4], [4, 74, 4], [8, 78, 8]],
  [[0, 76, 4], [4, 73, 4], [8, 69, 8]],
  [[0, 71, 2], [2, 74, 2], [4, 78, 4], [8, 76, 4], [12, 74, 4]],
  [[0, 73, 8], [8, 71, 4], [12, 69, 4]],
  [[0, 66, 4], [4, 69, 4], [8, 74, 8]],
  [[0, 74, 2], [2, 76, 2], [4, 74, 4], [8, 71, 4], [12, 67, 4]],
  [[0, 69, 6], [6, 71, 2], [8, 74, 8]],
  [[0, 73, 4], [4, 71, 4], [8, 69, 4], [12, 67, 4]],
];
// Song form: which progression and whether the fiddle plays, per 8-bar section.
const FORM = [[A_PROG, null], [A_PROG, A_TUNE], [B_PROG, B_TUNE], [A_PROG, A_TUNE]];
// Banjo forward roll: which chord tone (lowest = 0) each sixteenth picks.
const ROLL = [0, 1, 2, 0, 1, 2, 0, 3, 1, 2, 3, 1, 2, 3, 1, 2];

// The drum and bass break, one bar per string, a character per sixteenth (of the
// 84 grid, so an eighth note at 168): K kick, S the backbeat snare, g a ghost
// snare, r a snare roll. Bar 4 of every 4 is a fill.
const BREAKS = [
  'K.S..KS.K.S..KS.',
  'K.S.gKS.K.Sg.KS.',
  'K.S..KS.KgS..KSg',
  'K.S.gKS.K.SrrSrr',
];
// How hard each hit is to tap along with when fishing (see the game's startReel).
export function breakHit(step) {
  const s = ((step % 16) + 16) % 16, c = BREAKS[Math.floor(step / 16) % 4][s];
  if (c === '.') return 0;
  return c === 'S' ? 1 : c === 'K' ? (s % 4 === 0 ? 2 : 5) : c === 'g' ? 7 : 8;
}

const hz = m => 440 * Math.pow(2, (m - 69) / 12);

// Scales the tune can be played in. The tune is written in D major; deg moves each of
// its seven notes (D E F# G A B C#) by that many semitones, so every part keeps its
// shape. pent is the scale's own five-note (pentatonic) set, in semitones above the
// key note, that the hoppers sing in. More scales (Dorian, Mixolydian...) are one line each.
export const SCALES = {
  major: { deg: [0, 0, 0, 0, 0, 0, 0], pent: [0, 2, 4, 7, 9] },
  minor: { deg: [0, 0, -1, 0, 0, -1, -1], pent: [0, 3, 5, 7, 10] },   // natural minor
  // The spooky farm's: harmonic minor (a flat third and sixth under a raised seventh).
  // Not for sale: the song only goes there while the farm is haunted.
  spooky: { deg: [0, 0, -1, 0, 0, -1, 0], pent: [0, 3, 5, 7, 8], hidden: true },
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
// MIDI note m of the D major tune, moved into scale s and k semitones from D.
export function inScale(m, s, k) {
  const d = MAJOR.indexOf((((m - 62) % 12) + 12) % 12);
  return m + k + (d < 0 ? 0 : (SCALES[s] || SCALES.major).deg[d]);
}

export function createMusic(ctx, out) {
  // ---- signal chain: voices -> bus -> tape wobble -> dusty low-pass -> out, plus reverb ----
  const bus = ctx.createGain();
  bus.gain.value = 0;
  const wobble = ctx.createDelay(0.05);
  wobble.delayTime.value = 0.012;
  const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
  lfo.frequency.value = 0.33;                       // slow tape wow
  lfoAmt.gain.value = 0.0022;
  lfo.connect(lfoAmt).connect(wobble.delayTime);
  lfo.start();
  const dusty = ctx.createBiquadFilter();
  dusty.type = 'lowpass';
  dusty.frequency.value = 4200;
  dusty.Q.value = 0.4;
  const level = ctx.createGain();
  level.gain.value = 1;
  let day = 1, spook = 0;
  const shade = () => {   // daylight and the spooky farm together set the low-pass and the reverb
    dusty.frequency.setTargetAtTime(1300 + 2900 * day, ctx.currentTime, 0.5);
    verbIn.gain.setTargetAtTime(0.5 + 0.35 * (1 - day) + 0.45 * spook, ctx.currentTime, 0.5);
  };
  bus.connect(wobble).connect(dusty).connect(level).connect(out);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 1.6);   // short tail: cheap enough for phones
  const verbIn = ctx.createGain();
  verbIn.gain.value = 0.5;
  verbIn.connect(verb).connect(dusty);

  let STEP = stepOf('classic');
  const echo = ctx.createDelay(1);                  // dotted-eighth echo for the banjo
  echo.delayTime.value = STEP * 3;
  const echoFb = ctx.createGain();
  echoFb.gain.value = 0.3;
  const echoOut = ctx.createGain();
  echoOut.gain.value = 0.35;
  echo.connect(echoFb).connect(echo);
  echo.connect(echoOut).connect(bus);

  // 12.5% pulse: the thin, twangy NES-style wave used for the banjo
  const pulse = (() => {
    const n = 40, real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.125);
    return ctx.createPeriodicWave(real, imag);
  })();
  // a drawbar organ: the fundamental with octaves and a twelfth, a little bright on top
  const organ = (() => {
    const amp = [0, 1, 0.65, 0.45, 0.4, 0, 0.22, 0, 0.28], real = new Float32Array(amp.length), imag = new Float32Array(amp);
    return ctx.createPeriodicWave(real, imag);
  })();
  const noiseBuf = (() => {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();

  // ---- voices ----
  function voice(wave, midi, t, dur, vol, { attack = 0.004, to = bus, cutoff = 0, detune = 0, vibrato = 0, slideFrom = 0 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (wave === 'pulse') o.setPeriodicWave(pulse); else if (wave === 'organ') o.setPeriodicWave(organ); else o.type = wave;
    o.detune.value = detune;
    if (slideFrom) {                                  // fiddle slides up into the note
      o.frequency.setValueAtTime(hz(slideFrom), t);
      o.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.06);
    } else o.frequency.setValueAtTime(hz(midi), t);
    if (vibrato) {
      const v = ctx.createOscillator(), vg = ctx.createGain();
      v.frequency.value = 5.5;
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(vibrato, t + 0.25);   // vibrato blooms after the attack
      v.connect(vg).connect(o.detune);
      v.start(t); v.stop(t + dur + 0.1);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o.connect(g);
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      node = node.connect(f);
    }
    for (const d of [].concat(to)) node.connect(d);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, vol, type, freq, to = bus) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type;
    f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(to);
    s.start(t, Math.random() * 0.5); s.stop(t + dur);
  }
  function kick(t, vol, len = 0.22) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + 0.25);
  }
  // chord tones moved into a range, low to high
  const inRange = (chord, lo, hi) => {
    const out = new Set();
    for (const m of chord) for (let o = -24; o <= 36; o += 12) if (m + o >= lo && m + o <= hi) out.add(m + o);
    return [...out].sort((a, b) => a - b);
  };
  // the bass's fifth: a chord's own (diminished in a minor key's ii chord), else a plain fifth
  const fifthOf = (chord, r) => chord.some(m => (m - r - 7) % 12 === 0) || !chord.some(m => (m - r - 6) % 12 === 0) ? r + 7 : r + 6;
  const rootOf = chord => { let r = chord[0]; while (r > 45) r -= 12; while (r < 33) r += 12; return r; };

  // The house and psy parts that duck out of the kick's way go through here.
  const pump = ctx.createGain();
  pump.connect(bus);
  function duck(t) {
    pump.gain.setValueAtTime(0.3, t);
    pump.gain.linearRampToValueAtTime(1, t + STEP * 3);
  }
  function snare(t, vol) {   // a crack of noise over a short tone
    noise(t, 0.13, vol, 'bandpass', 1900);
    noise(t, 0.05, vol * 0.6, 'highpass', 5000);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    g.gain.setValueAtTime(vol * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + 0.1);
  }
  // The drum and bass parts, in place of the boom-chick bass, the mandolin and the kick.
  function playDnb(step, t, bar, s, chord, next) {
    const c = BREAKS[bar % 4][s];
    if (c === 'K') kick(t, 0.36, 0.18);
    if (c === 'S') snare(t, 0.2);
    if (c === 'g') snare(t, 0.06);
    if (c === 'r') { snare(t, 0.09); snare(t + STEP / 2, 0.11); }
    noise(t, 0.03, s % 2 ? 0.03 : 0.045, 'highpass', 8000);              // hats on every eighth at 168...
    if (s % 4 === 3) noise(t + STEP / 2, 0.025, 0.02, 'highpass', 9000);  // ...and a skip into each beat
    // reese bass: two detuned saws, dark, over a sine sub, following the kick
    const root = rootOf(chord), nr = rootOf(next);
    const bass = (m, at, len, vol) => {
      for (const dt of [-14, 14]) voice('sawtooth', m + 12, at, len, vol * 0.42, { attack: 0.01, cutoff: 520, detune: dt });
      voice('sine', m, at, len, vol, { attack: 0.01 });
    };
    if (s === 0) bass(root, t, STEP * 4.6, 0.17);
    if (s === 5) bass(root, t, STEP * 2.6, 0.14);
    if (s === 8) bass(fifthOf(chord, root), t, STEP * 3.6, 0.14);
    if (s === 13) bass(nr !== root ? nr : root + 12, t, STEP * 2.6, 0.13);
  }

  // Farm House: minimal, a lot of space. Four to the floor, a clap on 2 and 4, an off-beat
  // hat and a rim tick, an off-beat sub, and dub chord stabs that open up as each section
  // goes on. The banjo comes down to a quiet roll, and the tune is a short pluck.
  const HOUSE_RIM = '...x..x...x..x..', HOUSE_BASS = { 2: 0, 6: 0, 10: 0, 13: 7, 14: 12 };
  function playHouse(t, bar, s, chord, tune, i) {
    const sec = Math.floor(bar / 8), root = rootOf(chord), open = 600 + 110 * i + 220 * sec;
    if (s % 4 === 0 && !(i === 7 && s === 12)) { kick(t, 0.4, 0.2); duck(t); }   // (a breath before each new section)
    if (s === 4 || s === 12) { noise(t, 0.11, 0.08, 'bandpass', 1700); noise(t, 0.04, 0.04, 'highpass', 4200); }
    if (s % 4 === 2) noise(t, 0.1, 0.055, 'highpass', 8500);
    else if (s % 2) noise(t, 0.02, 0.014, 'highpass', 9500);
    if (HOUSE_RIM[s] === 'x') noise(t, 0.025, 0.05, 'bandpass', 3400);
    const b = HOUSE_BASS[s];
    if (b !== undefined) {
      voice('sine', root + b, t, STEP * 1.7, 0.2, { attack: 0.006 });
      voice('sawtooth', root + b + 12, t, STEP * 1.3, 0.022, { attack: 0.006, cutoff: 420 });
    }
    if (s === 3 || s === 11 || (sec && s === 6)) {
      for (const m of inRange(chord, 57, 72).slice(0, 4)) voice('sawtooth', m, t, STEP * 1.3, 0.018, { attack: 0.004, cutoff: open, to: [pump, echo, verbIn] });
    }
    if (sec && s % 2 === 0) {
      const tones = inRange(chord, 62, 79);
      voice('pulse', tones[ROLL[s] % tones.length], t, 0.09, s % 4 ? 0.011 : 0.017, { attack: 0.002, cutoff: 1500 + 180 * i, to: [pump, echo] });
    }
    if (tune) {
      for (const [at, m, len] of tune[i]) {
        if (at === s) voice('pulse', note(m), t, Math.min(STEP * len, 0.42), 0.055, { attack: 0.003, cutoff: 2000, to: [bus, echo, verbIn] });
      }
    }
  }
  // Psy Farm: a kick on every beat with the rolling bass filling the three sixteenths
  // between, a squelchy acid line picking the banjo's roll, the tune soaring on a detuned
  // lead, and a rush of noise into each new section. The bridge opens on two bars with no kick.
  const PSY_GATE = 'x.xx.xx.xx.x.xx.';
  function acid(m, t, dur, vol, cut) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(hz(m), t);
    f.type = 'lowpass';
    f.Q.value = 13;
    f.frequency.setValueAtTime(cut * 2.6, t);
    f.frequency.exponentialRampToValueAtTime(cut * 0.7, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g);
    g.connect(pump);
    g.connect(echo);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function riser(t, len) {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noiseBuf;
    n.loop = true;
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(6500, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + len);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.03);
    n.connect(f).connect(g).connect(bus);
    n.start(t); n.stop(t + len + 0.04);
  }
  function playPsy(t, bar, s, chord, tune, i) {
    const sec = Math.floor(bar / 8), root = rootOf(chord), open = bar === 16 || bar === 17;
    if (!open) {
      if (s % 4 === 0) { kick(t, 0.42, 0.15); noise(t, 0.012, 0.1, 'highpass', 3000); duck(t); }
      else {
        voice('sawtooth', root, t, STEP * 0.85, 0.12, { attack: 0.003, cutoff: 300 + 30 * i });
        voice('sine', root, t, STEP * 0.8, 0.09, { attack: 0.003 });
      }
    }
    if (s % 4 === 2) noise(t, 0.07, 0.05, 'highpass', 9000);
    noise(t, 0.014, s % 2 ? 0.01 : 0.016, 'highpass', 10000);
    if (sec && (s === 4 || s === 12)) noise(t, 0.09, 0.05, 'bandpass', 2100);
    if (PSY_GATE[s] === 'x') {
      const tones = inRange(chord, 50, 74);
      acid(tones[ROLL[s] % tones.length], t, STEP * 0.95, 0.042, 420 + 260 * i);
    }
    if (open && s === 0) {   // the bridge: the chord held, wide
      for (const m of inRange(chord, 50, 69)) for (const dt of [-9, 9]) voice('sawtooth', m, t, STEP * 16, 0.016, { attack: 0.25, cutoff: 1600, detune: dt, to: [bus, verbIn] });
    }
    if (i === 7 && s === 0) riser(t, STEP * 16);
    if (i === 0 && s === 0 && bar) noise(t, 1.2, 0.07, 'highpass', 6000);
    if (tune) {
      for (const [at, m, len] of tune[i]) {
        if (at !== s) continue;
        for (const dt of [-8, 8]) voice('sawtooth', note(m) + 12, t, STEP * len * 0.92, 0.021, { attack: 0.012, cutoff: 3000, detune: dt, vibrato: len >= 4 ? 12 : 0, to: [bus, echo, verbIn] });
      }
    }
  }

  // ---- the arrangement, one sixteenth at a time ----
  let lastFiddle = 0, style = 'classic', want = 'classic', swing = SWING, haunted = false, LOOP = 512 * STEP;
  // The key: [semitones from D, scale]. keyAt: when (context time) it took over from lastKey.
  let key = [0, 'major'], wantKey = key, lastKey = key, keyAt = 0;
  const note = m => inScale(m, key[1], key[0]);
  function play(step, t) {
    const bar = Math.floor(step / 16) % 32, s = step % 16;
    if (s === 0 && style !== (haunted ? 'organ' : want)) {   // switch on a bar line, and pick up the same bar at the new tempo
      style = haunted ? 'organ' : want;
      STEP = stepOf(style);
      LOOP = 512 * STEP;
      swing = STYLES[style].swing;
      t0 = t - at(step);
      echo.delayTime.setValueAtTime(STEP * 3, t);
    }
    if (s === 0 && key !== wantKey) { lastKey = key; key = wantKey; keyAt = t; }
    const dnb = style === 'dnb', org = style === 'organ';
    const [prog, tune] = FORM[Math.floor(bar / 8)];
    const i = bar % 8, chord = prog[i].map(note), next = prog[(i + 1) % 8].map(note);

    if (org) { playOrgan(t, s, chord, tune, i); return; }
    if (style === 'house') { playHouse(t, bar, s, chord, tune, i); return; }
    if (style === 'psy') { playPsy(t, bar, s, chord, tune, i); return; }
    // vaporwave pad: the whole chord, slow swell, mostly reverb
    if (s === 0) {
      for (const m of inRange(chord, 50, 66)) {
        for (const dt of [-8, 8]) voice('sawtooth', m, t, STEP * 16 * 1.05, 0.012, { attack: 0.5, cutoff: 1100, detune: dt, to: [bus, verbIn] });
      }
    }
    // banjo roll on a thin pulse, with the echo
    const tones = inRange(chord, 62, 79);
    voice('pulse', tones[ROLL[s] % tones.length], t, 0.2, (s % 4 === 0 ? 0.05 : 0.034) * (dnb ? 0.75 : 1), { attack: 0.002, cutoff: 3200, to: [bus, echo] });

    if (dnb) playDnb(step, t, bar, s, chord, next);
    else playClassic(t, s, chord, next);
    playFiddle(t, s, tune, i);
  }
  function playClassic(t, s, chord, next) {
    // boom-chick bass on a triangle, walking up into the next chord
    const root = rootOf(chord), nr = rootOf(next);
    if (s === 0) voice('triangle', root, t, STEP * 7, 0.2);
    if (s === 8) voice('triangle', fifthOf(chord, root), t, STEP * 3.5, 0.17);
    if (s === 12 && nr !== root) voice('triangle', nr + (nr > root ? -2 : 2), t, STEP * 1.8, 0.15);
    if (s === 14 && nr !== root) voice('triangle', nr + (nr > root ? -1 : 1), t, STEP * 1.8, 0.15);

    // mandolin chop on 2 and 4, kick on 1 and 3, a quiet shaker
    if (s === 4 || s === 12) {
      for (const m of inRange(chord, 60, 72).slice(0, 3)) voice('square', m, t, 0.06, 0.012, { cutoff: 2600 });
      noise(t, 0.07, 0.07, 'bandpass', 2800);
    }
    if (s === 0 || s === 8) kick(t, 0.32);
    if (s % 2 === 0) noise(t, 0.04, s % 4 === 2 ? 0.035 : 0.018, 'highpass', 7000);
  }
  // The spooky organ: the chord held on the organ with a slow wobble, a broken-chord run
  // on the eighths, a pedal note under it, the tune on a lead stop, and a clock ticking.
  function playOrgan(t, s, chord, tune, i) {
    if (s === 0) {
      for (const m of inRange(chord, 50, 67)) voice('organ', m, t, STEP * 16 * 1.02, 0.02, { attack: 0.08, cutoff: 2200, vibrato: 6, to: [bus, verbIn] });
      const root = rootOf(chord);
      voice('organ', root, t, STEP * 15.5, 0.06, { attack: 0.06, cutoff: 700 });       // pedal
      voice('sine', root - 12, t, STEP * 15.5, 0.12, { attack: 0.06 });
      kick(t, 0.16, 0.3);
    }
    if (s % 2 === 0) {
      const tones = inRange(chord, 62, 81);
      voice('organ', tones[ROLL[s] % tones.length], t, STEP * 1.9, 0.016, { attack: 0.01, cutoff: 2800, to: [bus, echo] });
    }
    if (s % 4 === 0) noise(t, 0.025, s % 8 ? 0.012 : 0.02, 'highpass', 6500);   // tick... tock
    if (tune) {
      for (const [at, m, len] of tune[i]) {
        if (at !== s) continue;
        voice('organ', note(m) + 12, t, STEP * len * 0.95, 0.024, { attack: 0.03, cutoff: 3400, to: [bus, verbIn], vibrato: len >= 4 ? 9 : 0 });
      }
    }
  }
  function playFiddle(t, s, tune, i) {
    // the fiddle: square wave, sliding into notes, vibrato on the long ones
    if (tune) {
      for (const [at, m, len] of tune[i]) {
        if (at !== s) continue;
        const dur = STEP * len * 0.95;
        voice('square', note(m), t, dur, 0.04, {
          attack: 0.03, cutoff: 2400, to: [bus, verbIn],
          vibrato: len >= 4 ? 14 : 0, slideFrom: lastFiddle && Math.abs(m - lastFiddle) <= 4 ? note(m) - 1 : 0,
        });
        lastFiddle = m;
      }
    }
  }

  // ---- scheduler: queues notes a little ahead of the audio clock ----
  // Step k of the song starts at t0 + at(k) (swing shifts the odd sixteenths, pairs stay even).
  // (LOOP, above: 32 bars of sixteenths.)
  const at = k => Math.floor(k / 2) * 2 * STEP + (k % 2 ? STEP * (1 + swing) : 0);
  let step = 0, next = 0, timer = null, playing = false, t0 = 0;
  function tick() {
    if (next < ctx.currentTime - 0.1) { next = ctx.currentTime + 0.05; t0 = next - at(step); }   // fell behind (tab was hidden): skip ahead
    while (next < ctx.currentTime + 0.25) {
      play(step, next);
      swing = STYLES[style].swing;
      next += STEP * (1 + (step % 2 ? -swing : swing));
      step++;
    }
  }
  return {
    start() {
      if (playing) return;
      playing = true;
      step = 0;
      next = ctx.currentTime + 0.1;
      t0 = next;
      bus.gain.setTargetAtTime(1.2, ctx.currentTime, 1.2);   // gentle fade-in
      timer = setInterval(tick, 40);
      tick();
    },
    stop() {
      playing = false;
      clearInterval(timer);
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    },
    // Dusk and night make the tune duskier: the low-pass closes and the reverb grows.
    setDay(d) {
      day = d;
      shade();
    },
    // The spooky farm (0..1): the reverb swells, like the tune is echoing round an old church.
    setSpooky(k) {
      spook = k;
      shade();
    },
    // The haunted farm's arrangement: the spooky organ takes over from the band at the next bar line.
    setHaunted(on) { haunted = !!on; },
    get haunted() { return haunted; },
    // One of SONGS (Hop Supporters): changes over at the next bar line.
    setStyle(s) { want = SONGS.includes(s) ? s : 'classic'; },
    get style() { return want; },
    // The song's beat and its 32-bar loop right now, in seconds.
    get beat() { return STEP * 4; },
    get loop() { return LOOP; },
    // Bought keys: n semitones from D, in a scale from SCALES. Changes over at the next bar
    // line, like the style; returns how many seconds from now that is (0 when the tune isn't playing).
    setKey(n, scale = 'major') {
      const same = key[0] === n && key[1] === scale;
      wantKey = same ? key : [n, SCALES[scale] ? scale : 'major'];
      if (!playing) { lastKey = key = wantKey; return 0; }
      const bar = Math.ceil(step / 16) * 16;
      return same ? 0 : Math.max(0, t0 + at(bar) - ctx.currentTime);
    },
    // The key and scale sounding right now, so the hopper sounds are always in tune with the tune.
    get key() { return (ctx.currentTime < keyAt ? lastKey : key)[0]; },
    get scale() { return (ctx.currentTime < keyAt ? lastKey : key)[1]; },
    // The song's sixteenth (counted from the top of the loop) playing at position pos.
    stepAt(pos) { return Math.round(pos / STEP); },
    // Duck under menus (e.g. 0.45 on the game-over sign), back to 1 in play.
    setLevel(v) { level.gain.setTargetAtTime(v, ctx.currentTime, 0.4); },
    // Seconds into the 32-bar loop right now, and jumping to a place in it: so friends
    // jamming on different devices hear the same bar of the tune.
    position() { return (((ctx.currentTime - t0) % LOOP) + LOOP) % LOOP; },
    // What the speakers are playing: the song position, and when (performance.now(),
    // in seconds) it's heard. Audio leaves the speakers a little after it's scheduled
    // (20-60 ms on a PC, far more over Bluetooth); the browser says how much.
    heard() {
      const ts = ctx.getOutputTimestamp?.(), now = performance.now() / 1000;
      let ct = ctx.currentTime, pt = now + (ctx.outputLatency || ctx.baseLatency || 0);
      if (ts && ts.contextTime > 0 && Math.abs(ts.performanceTime / 1000 - now) < 1) { ct = ts.contextTime; pt = ts.performanceTime / 1000; }
      return { pos: (((ct - t0) % LOOP) + LOOP) % LOOP, at: pt, swing };
    },
    // How long (seconds) a sound started right now takes to reach the ears. The output
    // timestamp says when an earlier moment of the context was heard, so add on how far
    // the context has run since; without one, the browser's own latency figure.
    lag() {
      const ts = ctx.getOutputTimestamp?.(), now = performance.now() / 1000;
      if (ts && ts.contextTime > 0 && Math.abs(ts.performanceTime / 1000 - now) < 1) return Math.max(0, ts.performanceTime / 1000 + ctx.currentTime - ts.contextTime - now);
      return ctx.outputLatency || ctx.baseLatency || 0;
    },    seek(pos) {
      if (!playing) return;
      t0 = ctx.currentTime - pos;
      const from = ctx.currentTime + 0.05 - t0;
      step = Math.floor(from / (2 * STEP)) * 2;
      while (at(step) < from) step++;
      next = t0 + at(step);
    },
    // Queue `secs` of music up front, without the timer: for offline previews and tests.
    prime(secs) {
      step = 0;
      next = ctx.currentTime + 0.05;
      bus.gain.value = 1.2;
      while (next < secs) {
        play(step, next);
        swing = STYLES[style].swing;
        next += STEP * (1 + (step % 2 ? -swing : swing));
        step++;
      }
    },
  };
}

// A soft stereo reverb tail: decaying noise.
function impulse(ctx, secs) {
  const len = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return b;
}
