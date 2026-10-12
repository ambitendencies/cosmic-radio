// Solar Breath: a quiet, pitched wind. Looping pink noise (generated in
// code, decorrelated left/right) runs through a few resonant band-pass
// filters tuned to the current chord tones, so the wind "sings" in harmony.
// Proton flux (turbulence) sets the level; solar-wind speed makes the gusts
// faster and deeper. During a geomagnetic storm (Kp >= 5) a faint aurora
// shimmer of slowly sweeping high resonances fades in.

import BaseLayer from './base.js';
import { midiToHz, lerp, clamp } from '../../music/theory.js';

const BANDS = 3;
const NOISE_SECONDS = 12;

/** Pure: choose `n` chord tones spread across ~MIDI 55–84 (low to high). */
export function pickBandNotes(tones, n = BANDS) {
  const pool = [...new Set(tones)].sort((a, b) => a - b);
  if (!pool.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = n === 1 ? 0 : Math.round((i / (n - 1)) * (pool.length - 1));
    out.push(pool[idx]);
  }
  return out;
}

/** Pure: gust timing and depth from solar-wind speed (km/s). */
export function gustParams(speed) {
  const s = clamp(((speed ?? 400) - 250) / 650);
  return { minPeriod: lerp(9, 6, s), maxPeriod: lerp(20, 11, s), depth: lerp(0.35, 0.85, s) };
}

/** Pink noise (Paul Kellet's filter), independent per channel. */
function makeNoise(ctx, seconds, rand) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = rand() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    // Short crossfade at the loop point so there is no click.
    const xf = Math.floor(ctx.sampleRate * 0.5);
    for (let i = 0; i < xf; i++) {
      const a = i / xf;
      d[i] = d[i] * a + d[len - xf + i] * (1 - a);
    }
  }
  return buf;
}

export default class TextureLayer extends BaseLayer {
  static id = 'texture';
  static label = 'Solar Breath';
  static description = 'Proton flux → texture';

  constructor(engine, { rand = Math.random } = {}) {
    super(engine, { gain: 1, reverb: 0.55, delay: 0.1 });
    this.rand = rand;
    const ctx = this.ctx;
    this.params = { turbulence: 0.1, brightness: 0.5 };
    this.speed = 400;
    this.kp = 2;

    this.master = new GainNode(ctx, { gain: this.levelFor(0.1) });
    this.master.connect(this.out);

    this.src = null;
    this.noise = makeNoise(ctx, NOISE_SECONDS, rand);

    // Wind bands: bandpass -> gust gain.
    this.bands = [];
    const mids = [60, 67, 74];
    for (let i = 0; i < BANDS; i++) {
      const filter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: midiToHz(mids[i]), Q: lerp(10, 24, i / (BANDS - 1)) });
      const gust = new GainNode(ctx, { gain: 0.6 });
      const pan = new StereoPannerNode(ctx, { pan: (i - 1) * 0.35 });
      filter.connect(gust).connect(pan).connect(this.master);
      this.bands.push({ filter, gust, nextGust: 0, comp: 14 + i * 4 });
    }

    // Aurora shimmer: two high resonances, silent until Kp >= 5.
    this.auroraGain = new GainNode(ctx, { gain: 0 });
    this.auroraGain.connect(this.master);
    this.aurora = [0, 1].map((i) => {
      const filter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1500 + i * 400, Q: 22 });
      const g = new GainNode(ctx, { gain: 30 });
      filter.connect(g).connect(this.auroraGain);
      return { filter, nextSweep: 0 };
    });

    this.tune(0, true);
    this.unsub = this.harmony.onChange(() => this.tune(this.now));
  }

  /** Level for a given turbulence: ~-38 dBFS at rest up to ~-28 dBFS. */
  levelFor(turb) {
    return lerp(0.25, 0.75, Math.pow(clamp(turb), 0.8));
  }

  tune(time, immediate = false) {
    const tones = this.harmony.chordTones(55, 84);
    const notes = pickBandNotes(tones, BANDS);
    notes.forEach((m, i) => {
      const f = midiToHz(m);
      const p = this.bands[i].filter.frequency;
      if (immediate) p.value = f;
      else p.setTargetAtTime(f, Math.max(time, this.now), 1.2);
    });
  }

  start(time = this.now) {
    if (!this.src) {
      this.src = new AudioBufferSourceNode(this.ctx, { buffer: this.noise, loop: true });
      this.src.loopStart = 0;
      this.src.loopEnd = NOISE_SECONDS;
      for (const b of this.bands) this.src.connect(b.filter);
      for (const a of this.aurora) this.src.connect(a.filter);
      this.src.start(time);
    }
    super.start(time);
  }

  stop(time = this.now) {
    super.stop(time);
    if (this.src) {
      try {
        this.src.stop(time + 1);
      } catch {}
      this.src = null;
    }
  }

  update(params, state) {
    this.params = params;
    this.speed = state?.solarWind?.speed ?? this.speed;
    this.kp = state?.kp ?? this.kp;
    const now = this.now;
    this.master.gain.setTargetAtTime(this.levelFor(params.turbulence ?? 0), now, 4);
    const storm = this.kp >= 5 ? clamp((this.kp - 4) / 4) : 0;
    this.auroraGain.gain.setTargetAtTime(storm * 0.35, now, 5);
    this.setSends({ reverb: lerp(0.45, 0.75, clamp(params.space ?? 0.5)) });
  }

  onStep(time) {
    const g = gustParams(this.speed);
    for (const b of this.bands) {
      if (time < b.nextGust) continue;
      const period = lerp(g.minPeriod, g.maxPeriod, this.rand());
      const target = (1 - g.depth + g.depth * this.rand()) * (b.comp / 14) * 0.6;
      b.gust.gain.setTargetAtTime(target, time, period / 3);
      b.nextGust = time + period * 0.7;
    }
    if (this.kp >= 5) {
      for (const a of this.aurora) {
        if (time < a.nextSweep) continue;
        const tones = this.harmony.chordTones(91, 103);
        if (!tones.length) continue;
        const f = midiToHz(tones[Math.floor(this.rand() * tones.length)]);
        a.filter.frequency.setTargetAtTime(f, time, 3);
        a.nextSweep = time + 6 + this.rand() * 8;
      }
    }
  }
}
