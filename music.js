// Betty Lou's farm tune: 8-bit vaporwave bluegrass, synthesized live with WebAudio.
// No audio files. Bluegrass parts (banjo roll, boom-chick bass, mandolin chop,
// fiddle) are played on chiptune voices (thin pulse, triangle, square, noise) over
// jazzy vaporwave chords, then run through a tape wobble, a dusty low-pass, an
// echo and a soft reverb. D major, 84 BPM, 32 bars (about 90 s) on a loop:
// A (band only), A (fiddle comes in), B, A.

const BPM = 84;
const STEP = 60 / BPM / 4;          // one sixteenth note, in seconds
const SWING = 0.06;                 // a touch of lilt on the off-sixteenths

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

const hz = m => 440 * Math.pow(2, (m - 69) / 12);

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
  bus.connect(wobble).connect(dusty).connect(level).connect(out);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 1.6);   // short tail: cheap enough for phones
  const verbIn = ctx.createGain();
  verbIn.gain.value = 0.5;
  verbIn.connect(verb).connect(dusty);

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
  const noiseBuf = (() => {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();

  // ---- voices ----
  function voice(wave, midi, t, dur, vol, { attack = 0.004, to = bus, cutoff = 0, detune = 0, vibrato = 0, slideFrom = 0 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (wave === 'pulse') o.setPeriodicWave(pulse); else o.type = wave;
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
  function kick(t, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + 0.25);
  }
  // chord tones moved into a range, low to high
  const inRange = (chord, lo, hi) => {
    const out = new Set();
    for (const m of chord) for (let o = -24; o <= 36; o += 12) if (m + o >= lo && m + o <= hi) out.add(m + o);
    return [...out].sort((a, b) => a - b);
  };
  const rootOf = chord => { let r = chord[0]; while (r > 45) r -= 12; while (r < 33) r += 12; return r; };

  // ---- the arrangement, one sixteenth at a time ----
  let lastFiddle = 0;
  function play(step, t) {
    const bar = Math.floor(step / 16) % 32, s = step % 16;
    const [prog, tune] = FORM[Math.floor(bar / 8)];
    const i = bar % 8, chord = prog[i], next = prog[(i + 1) % 8];

    // vaporwave pad: the whole chord, slow swell, mostly reverb
    if (s === 0) {
      for (const m of inRange(chord, 50, 66)) {
        for (const dt of [-8, 8]) voice('sawtooth', m, t, STEP * 16 * 1.05, 0.012, { attack: 0.5, cutoff: 1100, detune: dt, to: [bus, verbIn] });
      }
    }
    // banjo roll on a thin pulse, with the echo
    const tones = inRange(chord, 62, 79);
    voice('pulse', tones[ROLL[s] % tones.length], t, 0.2, s % 4 === 0 ? 0.05 : 0.034, { attack: 0.002, cutoff: 3200, to: [bus, echo] });

    // boom-chick bass on a triangle, walking up into the next chord
    const root = rootOf(chord), nr = rootOf(next);
    if (s === 0) voice('triangle', root, t, STEP * 7, 0.2);
    if (s === 8) voice('triangle', root + 7, t, STEP * 3.5, 0.17);
    if (s === 12 && nr !== root) voice('triangle', nr + (nr > root ? -2 : 2), t, STEP * 1.8, 0.15);
    if (s === 14 && nr !== root) voice('triangle', nr + (nr > root ? -1 : 1), t, STEP * 1.8, 0.15);

    // mandolin chop on 2 and 4, kick on 1 and 3, a quiet shaker
    if (s === 4 || s === 12) {
      for (const m of inRange(chord, 60, 72).slice(0, 3)) voice('square', m, t, 0.06, 0.012, { cutoff: 2600 });
      noise(t, 0.07, 0.07, 'bandpass', 2800);
    }
    if (s === 0 || s === 8) kick(t, 0.32);
    if (s % 2 === 0) noise(t, 0.04, s % 4 === 2 ? 0.035 : 0.018, 'highpass', 7000);

    // the fiddle: square wave, sliding into notes, vibrato on the long ones
    if (tune) {
      for (const [at, m, len] of tune[i]) {
        if (at !== s) continue;
        const dur = STEP * len * 0.95;
        voice('square', m, t, dur, 0.04, {
          attack: 0.03, cutoff: 2400, to: [bus, verbIn],
          vibrato: len >= 4 ? 14 : 0, slideFrom: lastFiddle && Math.abs(m - lastFiddle) <= 4 ? m - 1 : 0,
        });
        lastFiddle = m;
      }
    }
  }

  // ---- scheduler: queues notes a little ahead of the audio clock ----
  let step = 0, next = 0, timer = null, playing = false;
  function tick() {
    if (next < ctx.currentTime - 0.1) next = ctx.currentTime + 0.05;   // fell behind (tab was hidden): skip ahead
    while (next < ctx.currentTime + 0.25) {
      play(step, next);
      next += STEP * (1 + (step % 2 ? -SWING : SWING));
      step++;
    }
  }
  return {
    start() {
      if (playing) return;
      playing = true;
      step = 0;
      next = ctx.currentTime + 0.1;
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
      dusty.frequency.setTargetAtTime(1300 + 2900 * d, ctx.currentTime, 0.5);
      verbIn.gain.setTargetAtTime(0.5 + 0.35 * (1 - d), ctx.currentTime, 0.5);
    },
    // Duck under menus (e.g. 0.45 on the game-over sign), back to 1 in play.
    setLevel(v) { level.gain.setTargetAtTime(v, ctx.currentTime, 0.4); },
    // Queue `secs` of music up front, without the timer: for offline previews and tests.
    prime(secs) {
      step = 0;
      next = ctx.currentTime + 0.05;
      bus.gain.value = 1.2;
      while (next < secs) {
        play(step, next);
        next += STEP * (1 + (step % 2 ? -SWING : SWING));
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
