// Flare Bells: sparse, glassy celesta chimes from the GOES X-ray flux.
// A quiet sun gives a rare chime every few bars; a rising flux (a flare
// onset) triggers a cascade of chord tones plus a soft shimmer swell.
// Every pitch comes from the harmony (chord tones / safe pentatonic notes).

import BaseLayer from './base.js';
import { midiToHz, lerp, clamp } from '../../music/theory.js';

const CLASS_BASE = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 };
const CLASS_RANK = { A: 0, B: 1, C: 2, M: 3, X: 4 };
const MAX_VOICES = 24;
const COOLDOWN_SECONDS = 45;
const LO = 79;
const HI = 98;

const log10 = (x) => Math.log10(Math.max(x, 1e-9));

/** Parse 'M2.5' into { letter, rank, flux }. Returns null for junk. */
export function parseXrayClass(cls) {
  const m = /^([ABCMX])\s*(\d+(?:\.\d+)?)?/i.exec(String(cls ?? ''));
  if (!m) return null;
  const letter = m[1].toUpperCase();
  return { letter, rank: CLASS_RANK[letter], flux: CLASS_BASE[letter] * (m[2] ? Number(m[2]) : 1) };
}

/** Flare magnitude 0..1 from a flux in W/m² (B-class → 0, X-class → 1). */
export function flareSize(flux) {
  return clamp((log10(flux) + 7) / 3);
}

/**
 * Pure flare-onset detector.
 * An onset is a log10 flux rise of more than `riseThreshold` decades over the
 * recent window (and still near the top of it), or the class letter stepping
 * up into M/X. Returns { onset, reason, rise, size }.
 */
export function detectFlareOnset({ history = [], cls = null, prevCls = null, riseThreshold = 0.25, window = 15, floor = 3e-7 } = {}) {
  const h = history.filter((v) => Number.isFinite(v) && v > 0).slice(-window);
  const cur = parseXrayClass(cls);
  const prev = parseXrayClass(prevCls);
  const last = h.length ? h[h.length - 1] : cur?.flux ?? 0;
  const size = flareSize(Math.max(last, cur?.flux ?? 0));
  let rise = 0;
  if (h.length >= 3) {
    const lo = Math.min(...h);
    const hi = Math.max(...h);
    const nearTop = log10(hi) - log10(last) < 0.15;
    if (nearTop) rise = log10(last) - log10(lo);
  }
  if (rise > riseThreshold && last >= floor) return { onset: true, reason: 'rise', rise, size };
  if (cur && prev && cur.rank > prev.rank && cur.rank >= CLASS_RANK.M) return { onset: true, reason: 'class', rise, size };
  return { onset: false, reason: null, rise, size };
}

/** Cooldown gate (pure). */
export function cooledDown(lastOnsetTime, now, cooldown = COOLDOWN_SECONDS) {
  return lastOnsetTime == null || now - lastOnsetTime >= cooldown;
}

/**
 * Pure cascade builder. `pool` is a sorted array of allowed MIDI notes.
 * Returns [{ t (seconds from start), midi, vel }]: a run of 8–20 notes over
 * 2–4 bars that accelerates, then thins out.
 */
export function buildCascade(pool, { size = 0.5, secondsPerBar = 3, rand = Math.random } = {}) {
  if (!pool.length) return [];
  const n = Math.round(lerp(8, 20, clamp(size)));
  const duration = lerp(2, 4, clamp(size)) * secondsPerBar;
  const gaps = [];
  for (let i = 0; i < n - 1; i++) {
    const u = i / Math.max(1, n - 2);
    gaps.push(u < 0.7 ? lerp(1, 0.35, u / 0.7) : lerp(0.35, 1.8, (u - 0.7) / 0.3));
  }
  const sum = gaps.reduce((a, b) => a + b, 0) || 1;
  const down = rand() < 0.6;
  let idx = down ? pool.length - 1 - Math.floor(rand() * Math.min(3, pool.length)) : Math.floor(rand() * Math.min(3, pool.length));
  let dir = down ? -1 : 1;
  const events = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const u = i / Math.max(1, n - 1);
    const vel = clamp((u < 0.75 ? lerp(0.55, 0.9, u / 0.75) : lerp(0.9, 0.35, (u - 0.75) / 0.25)) * (0.85 + rand() * 0.25), 0.15, 1);
    events.push({ t: t + (i ? (rand() - 0.5) * 0.02 : 0), midi: pool[idx], vel });
    if (i < n - 1) t += (gaps[i] / sum) * duration;
    const step = rand() < 0.2 ? 2 : 1;
    idx += dir * step;
    if (idx < 0 || idx > pool.length - 1) {
      dir = -dir;
      idx = clamp(idx, 0, pool.length - 1);
    }
  }
  return events;
}

/** Baseline chimes per bar from energy (0..1) and an "elevated" 0..1 flag. */
export function baselineRate(energy, elevated = 0) {
  return (0.25 + 4.75 * Math.pow(clamp(energy), 1.5)) * (1 + 0.8 * elevated);
}

export default class BellsLayer extends BaseLayer {
  static id = 'bells';
  static label = 'Flare Bells';
  static description = 'X-ray flux → chimes';

  constructor(engine, { rand = Math.random } = {}) {
    super(engine, { gain: 0.32, reverb: 0.7, delay: 0.3 });
    this.rand = rand;
    const ctx = this.ctx;
    // Tame the top end so bells never get piercing.
    this.tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 9000, Q: 0.4 });
    this.tone.connect(this.out);
    this.params = { energy: 0.1 };
    this.state = null;
    this.voices = 0;
    this.queue = []; // pending cascade notes {time, midi, vel}
    this.pendingCascade = null;
    this.lastOnset = null;
    this.lastClass = null;
    this.lastMidi = null;
    this.elevated = 0;
    this.sps = 0.2;
  }

  update(params, state) {
    this.params = params;
    this.state = state;
    const x = state?.xray;
    if (!x) return;
    const det = detectFlareOnset({ history: x.history, cls: x.class, prevCls: this.lastClass });
    this.lastClass = x.class;
    // "Elevated": the flux sits well above its own recent baseline.
    const h = (x.history ?? []).filter((v) => v > 0);
    if (h.length > 5) {
      const sorted = [...h].sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      this.elevated = clamp((log10(h[h.length - 1]) - log10(med)) / 0.6);
    } else this.elevated = 0;
    if (det.onset && cooledDown(this.lastOnset, this.now)) {
      this.lastOnset = this.now;
      this.pendingCascade = { size: Math.max(det.size, 0.15) };
    }
  }

  onStep(time, info) {
    this.sps = info.secondsPerStep;
    const secondsPerBar = info.secondsPerStep * 16;
    if (this.pendingCascade) {
      const { size } = this.pendingCascade;
      this.pendingCascade = null;
      const pool = this.harmony.chordTones(72, HI);
      const events = buildCascade(pool.length ? pool : [this.harmony.quantize(84)], { size, secondsPerBar, rand: this.rand });
      for (const e of events) this.queue.push({ time: time + 0.05 + e.t, midi: e.midi, vel: e.vel });
      this.shimmer(time, size, secondsPerBar);
    }
    // Release queued cascade notes due before the next step.
    const horizon = time + info.secondsPerStep;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (q.time < horizon) {
        this.queue.splice(i, 1);
        this.bell(q.midi, Math.max(q.time, time), q.vel);
      }
    }
    // Baseline chimes.
    const energy = this.params.energy ?? 0;
    const perStep = baselineRate(energy, this.elevated) / 16;
    const weight = info.stepInBar % 4 === 0 ? 1.2 : info.stepInBar % 2 === 0 ? 0.9 : 0.5;
    if (this.queue.length === 0 && this.rand() < perStep * weight) {
      const midi = this.pickBaseline();
      this.bell(midi, time + this.rand() * 0.03, clamp(0.35 + this.rand() * 0.4 + energy * 0.15, 0.2, 0.9));
    }
  }

  pickBaseline() {
    const h = this.harmony;
    const chord = h.chordTones(LO, HI);
    const safe = h.safeNotes(LO, HI);
    const pool = this.rand() < 0.65 && chord.length ? chord : safe.length ? safe : chord;
    if (!pool.length) return h.quantize(88);
    let m = pool[Math.floor(this.rand() * pool.length)];
    if (m === this.lastMidi && pool.length > 1) m = pool[(pool.indexOf(m) + 1) % pool.length];
    this.lastMidi = m;
    return m;
  }

  /** One glass/celesta bell: near-harmonic additive partials with an exponential decay. */
  bell(midi, time, velocity = 0.6) {
    if (this.voices >= MAX_VOICES) return;
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const decay = lerp(4.2, 2.2, clamp((midi - 72) / 28)) * (0.85 + this.rand() * 0.3);
    const partials = [
      [1, 1, 1],
      [2, 0.42, 0.55],
      [3, 0.22, 0.4],
    ];
    if (f < 2300) partials.push([4.07, 0.16, 0.22]); // upper partial gives air; stays below ~9.4 kHz
    const amp = new GainNode(ctx, { gain: 0 });
    const pan = new StereoPannerNode(ctx, { pan: (this.rand() - 0.5) * 1.6 });
    amp.connect(pan).connect(this.tone);
    const peak = 0.3 * velocity;
    const end = time + decay * 1.6;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + 0.004);
    amp.gain.setTargetAtTime(0, time + 0.006, decay / 4.5);
    this.voices++;
    let alive = partials.length;
    for (const [ratio, g, decayScale] of partials) {
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: f * ratio, detune: (this.rand() - 0.5) * 3 });
      const pg = new GainNode(ctx, { gain: 0 });
      pg.gain.setValueAtTime(g, time);
      // Upper partials die faster than the fundamental.
      pg.gain.setTargetAtTime(0, time + 0.01, (decay * decayScale) / 4.5);
      osc.connect(pg).connect(amp);
      osc.start(time);
      osc.stop(end);
      osc.onended = () => {
        pg.disconnect();
        if (--alive === 0) {
          amp.disconnect();
          pan.disconnect();
          this.voices--;
        }
      };
    }
  }

  /** A soft high swell of detuned sines on chord tones. */
  shimmer(time, size, secondsPerBar) {
    const ctx = this.ctx;
    const tones = this.harmony.chordTones(79, 91);
    if (!tones.length) return;
    const count = size > 0.6 ? 5 : 4;
    const hold = lerp(2, 4, size) * secondsPerBar;
    const attack = Math.min(2.5, hold * 0.45);
    const release = 3.5;
    const level = 0.035 * lerp(0.7, 1.2, size);
    const bus = new GainNode(ctx, { gain: 0 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4500, Q: 0.3 });
    bus.connect(lp).connect(this.out);
    bus.gain.setValueAtTime(0, time);
    bus.gain.linearRampToValueAtTime(level, time + attack);
    bus.gain.setTargetAtTime(0, time + hold, release / 3);
    const end = time + hold + release * 1.8;
    let alive = 0;
    for (let i = 0; i < count; i++) {
      const midi = tones[Math.floor(this.rand() * tones.length)];
      for (const cents of [-7, 7]) {
        const pan = new StereoPannerNode(ctx, { pan: (this.rand() - 0.5) * 1.8 });
        const osc = new OscillatorNode(ctx, { type: 'sine', frequency: midiToHz(midi), detune: cents + (this.rand() - 0.5) * 4 });
        osc.connect(pan).connect(bus);
        osc.start(time);
        osc.stop(end);
        alive++;
        osc.onended = () => {
          pan.disconnect();
          if (--alive === 0) {
            bus.disconnect();
            lp.disconnect();
          }
        };
      }
    }
  }
}
