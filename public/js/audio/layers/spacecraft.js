// Spacecraft: every spacecraft talking to Earth through the Deep Space Network
// becomes one gentle glass-bell voice.
//   distance      -> register (near = high and bright, Voyager = deep) and echo
//   data rate     -> how often it speaks (slow trickle to a steady shimmer)
//   signal power  -> velocity, squeezed into a narrow range
//   light time    -> number and spacing of echoes: the signal's journey home
// Pitches always come from the current chord, so the ensemble stays consonant.

import BaseLayer from './base.js';
import { midiToHz, lerp, clamp, norm, logNorm } from '../../music/theory.js';

const MAX_VOICES = 6;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}
const unit = (h, salt) => (hash(`${salt}:${h}`) % 10000) / 10000;

/** Per-spacecraft character, deterministic from its id. */
function character(id) {
  return {
    pan: lerp(-0.7, 0.7, unit(id, 'pan')),
    ratio: [1, 2, 2, 3][Math.floor(unit(id, 'ratio') * 4)], // harmonic FM ratios only
    index: lerp(0.6, 1.1, unit(id, 'idx')),
    partial: lerp(0.15, 0.4, unit(id, 'prt')),
    vibRate: lerp(4.2, 5.8, unit(id, 'vib')),
    offset: Math.floor(unit(id, 'off') * 64),
    decay: lerp(3.4, 6.2, unit(id, 'dec')),
  };
}

/** Steps (16ths) between notes: ~3 bars at 10 bps, ~2 bars at 160 bps, 2 beats at Mbps. */
function periodSteps(rate) {
  const l = Math.log10(clamp(rate || 100, 10, 5e6));
  if (l < 1) return 64;
  if (l < 2.2) return Math.round(lerp(64, 32, (l - 1) / 1.2));
  return Math.round(lerp(32, 8, clamp((l - 2.2) / 4, 0, 1)));
}

export default class SpacecraftLayer extends BaseLayer {
  static id = 'spacecraft';
  static label = 'Spacecraft';
  static description = 'Deep Space Network → voices';

  constructor(engine, { rand = Math.random } = {}) {
    super(engine, { gain: 0.3, reverb: 0.5, delay: 0.1 });
    this.rand = rand;
    this.filter = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 4500, Q: 0.4 });
    this.filter.connect(this.out);
    this.voices = new Map(); // id -> voice state
    this.arrivals = [];
    this.brightness = 0.5;
  }

  update(params, state) {
    if (params) {
      this.brightness = params.brightness ?? this.brightness;
      this.filter.frequency.setTargetAtTime(lerp(2200, 7500, this.brightness), this.now, 3);
      if (params.space != null) this.setSends({ reverb: lerp(0.35, 0.75, clamp(params.space)) });
    }
    const links = Array.isArray(state?.dsn) ? state.dsn : [];
    // Strongest six; current voices get a small bonus so the set doesn't flicker.
    const ranked = links
      .filter((l) => l && l.id)
      .map((l) => ({ l, s: (l.power ?? -170) + (this.voices.has(l.id) ? 3 : 0) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_VOICES)
      .map((x) => x.l);
    const ids = new Set(ranked.map((l) => l.id));
    for (const id of this.voices.keys()) if (!ids.has(id)) this.voices.delete(id); // tails keep ringing
    for (const l of ranked) {
      let v = this.voices.get(l.id);
      if (!v) {
        v = { id: l.id, ch: character(l.id), lastMidi: null };
        this.voices.set(l.id, v);
        this.arrivals.push(v);
      }
      v.link = l;
    }
  }

  onStep(time, info) {
    // One arrival motif at a time keeps a cold start from piling up.
    if (this.arrivals.length) {
      const v = this.arrivals.shift();
      if (this.voices.get(v.id) === v) {
        this.arrive(v, time, info);
        v.quietUntil = info.step + 16;
      }
    }
    for (const v of this.voices.values()) {
      const l = v.link;
      const period = periodSteps(l.dataRate);
      if ((info.step + v.ch.offset) % period !== 0) continue;
      if (v.quietUntil && info.step < v.quietUntil) continue;
      if (this.rand() > 0.8) continue;
      this.speak(v, time + this.rand() * 0.02, info);
    }
  }

  register(l) {
    const u = l.rangeKm ? logNorm(l.rangeKm, 2e5, 2.5e10) : 0.5;
    const center = lerp(85, 45, u);
    return { lo: Math.round(center - 4), hi: Math.round(center + 4) };
  }

  pool(l) {
    let { lo, hi } = this.register(l);
    let pool = this.harmony.chordTones(lo, hi);
    for (let k = 0; !pool.length && k < 3; k++) pool = this.harmony.chordTones(--lo, ++hi);
    return pool.length ? pool : [this.harmony.quantize((lo + hi) / 2)];
  }

  velocity(l) {
    return lerp(0.5, 0.85, norm(l.power ?? -140, -160, -100));
  }

  pick(v, pool) {
    if (v.lastMidi == null) return pool[Math.floor(this.rand() * pool.length)];
    let n = 0;
    for (let i = 1; i < pool.length; i++) if (Math.abs(pool[i] - v.lastMidi) < Math.abs(pool[n] - v.lastMidi)) n = i;
    const move = this.rand() < 0.3 ? 0 : this.rand() < 0.5 ? 1 : -1;
    return pool[clamp(n + move, 0, pool.length - 1)];
  }

  speak(v, time, info) {
    const l = v.link;
    const pool = this.pool(l);
    const midi = this.pick(v, pool);
    v.lastMidi = midi;
    const vel = this.velocity(l);
    this.bell(v, midi, time, vel);

    // Echoes: the farther the craft, the more and wider-spaced.
    const u = l.rtlt ? logNorm(l.rtlt, 2, 1e5) : l.rangeKm ? logNorm(l.rangeKm, 1e6, 2.5e10) : 0.5;
    const count = 1 + Math.round(u * 3);
    const gap = clamp(info.secondsPerStep * lerp(2, 6, u), 0.4, 2.2);
    let m = midi;
    for (let i = 1; i <= count; i++) {
      if (this.rand() < 0.4) {
        const k = pool.indexOf(m);
        m = pool[clamp((k < 0 ? 0 : k) + (this.rand() < 0.5 ? 1 : -1), 0, pool.length - 1)];
      }
      this.bell(v, m, time + gap * i, vel * 0.5 ** i, 0.8);
    }
  }

  arrive(v, time, info) {
    const pool = this.pool(v.link);
    const start = Math.max(0, Math.floor(pool.length / 2) - 1);
    const vel = this.velocity(v.link) * 0.9;
    const gap = clamp(info.secondsPerStep * 2, 0.3, 0.7);
    for (let i = 0; i < 3; i++) {
      const m = pool[Math.min(pool.length - 1, start + i)];
      this.bell(v, m, time + i * gap, vel * (0.75 + 0.1 * i));
      v.lastMidi = m;
    }
  }

  /** A soft glass bell: FM with a harmonic ratio, a quiet octave partial, slow vibrato. */
  bell(v, midi, time, velocity, decayScale = 1) {
    const ctx = this.ctx;
    const ch = v.ch;
    const f = midiToHz(midi);
    const decay = ch.decay * decayScale;
    const peak = 0.3 * velocity ** 1.3;
    const end = time + decay * 2.2;

    const carrier = new OscillatorNode(ctx, { type: 'sine', frequency: f });
    const mod = new OscillatorNode(ctx, { type: 'sine', frequency: f * ch.ratio });
    const part = new OscillatorNode(ctx, { type: 'sine', frequency: f * 2 });
    const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: ch.vibRate });
    const modGain = new GainNode(ctx, { gain: 0 });
    const lfoGain = new GainNode(ctx, { gain: 0 });
    const partGain = new GainNode(ctx, { gain: peak * ch.partial });
    const amp = new GainNode(ctx, { gain: 0 });
    const pan = new StereoPannerNode(ctx, { pan: ch.pan });

    mod.connect(modGain).connect(carrier.frequency);
    lfo.connect(lfoGain).connect(carrier.detune);
    carrier.connect(amp);
    part.connect(partGain).connect(amp);
    amp.connect(pan).connect(this.filter);

    // Vibrato fades in after the strike; the FM index mellows over the first second.
    lfoGain.gain.setValueAtTime(0, time);
    lfoGain.gain.linearRampToValueAtTime(5, time + 1.5);
    const index = f * ch.index * lerp(0.6, 1.2, this.brightness) * (0.5 + 0.5 * velocity);
    modGain.gain.setValueAtTime(index, time);
    modGain.gain.exponentialRampToValueAtTime(Math.max(0.5, index * 0.04), time + decay * 0.35);

    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + 0.006);
    amp.gain.setTargetAtTime(0, time + 0.006, decay / 4);
    partGain.gain.setTargetAtTime(0, time + 0.006, decay / 9);

    for (const o of [carrier, mod, part, lfo]) {
      o.start(time);
      o.stop(end);
    }
    carrier.onended = () => {
      for (const n of [mod, part, lfo, modGain, lfoGain, partGain, amp, pan, carrier]) n.disconnect();
    };
  }
}
