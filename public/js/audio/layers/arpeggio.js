// Arpeggio: a soft FM "kalimba" that wanders over safe pentatonic notes and
// chord tones. Solar-wind speed sets the tempo (through the scheduler),
// proton density sets how many notes play, and brightness sets the timbre.
// The melody is a weighted random walk, so it has contour and phrasing
// rather than sounding like noise.

import BaseLayer from './base.js';
import { midiToHz, lerp, clamp } from '../../music/theory.js';

// Probability weight of a note on each 16th of the bar (downbeats strongest).
const GRID = [1, 0.15, 0.5, 0.15, 0.8, 0.15, 0.5, 0.2, 0.95, 0.15, 0.5, 0.15, 0.8, 0.2, 0.55, 0.3];

export default class ArpeggioLayer extends BaseLayer {
  static id = 'arpeggio';
  static label = 'Arpeggio';
  static description = 'Wind speed → tempo · density → notes';

  constructor(engine, { rand = Math.random } = {}) {
    super(engine, { gain: 0.42, reverb: 0.45, delay: 0.32 });
    this.rand = rand;
    this.filter = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 3000, Q: 0.5 });
    this.filter.connect(this.out);
    this.params = { density: 0.4, brightness: 0.5, tension: 0.2, energy: 0.2 };
    this.position = 0.5; // 0..1 position within the note pool
    this.restUntilBar = -1;
    this.lastMidi = null;
  }

  update(p) {
    this.params = p;
    this.filter.frequency.setTargetAtTime(lerp(1400, 6500, p.brightness), this.now, 3);
  }

  onStep(time, info) {
    const { density } = this.params;
    // Breathe: sometimes rest for a bar at a phrase boundary.
    if (info.stepInBar === 0 && info.bar % 4 === 0 && this.rand() < 0.3) this.restUntilBar = info.bar + 1;
    if (info.bar < this.restUntilBar) return;

    const sixteenthsAllowed = density > 0.55;
    const w = GRID[info.stepInBar] * (info.step % 2 && !sixteenthsAllowed ? 0 : 1);
    if (this.rand() > density * w * 1.1) return;

    const chordChange = info.step % 32 === 0;
    const midi = this.nextNote(chordChange || info.stepInBar === 0);
    const accent = info.stepInBar % 4 === 0 ? 1 : 0.7;
    const velocity = clamp((0.45 + this.rand() * 0.35) * accent, 0.2, 1);
    const humanize = this.rand() * 0.012;
    this.pluck(midi, time + humanize, velocity, info.secondsPerStep);
  }

  nextNote(preferChordTone) {
    const h = this.harmony;
    const pool = preferChordTone ? h.chordTones(62, 86) : mergeSorted(h.safeNotes(62, 86), h.chordTones(62, 86));
    if (!pool.length) return h.quantize(72);
    // Random walk: mostly steps, sometimes a skip, rarely a leap.
    const r = this.rand();
    const move = r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.82 ? 2 : r < 0.94 ? -2 : (this.rand() - 0.5) * 8;
    let idx;
    if (this.lastMidi == null) {
      idx = Math.floor(pool.length * this.position);
    } else {
      // Find the nearest pool entry to the last note, then step from there.
      let nearest = 0;
      for (let i = 1; i < pool.length; i++) if (Math.abs(pool[i] - this.lastMidi) < Math.abs(pool[nearest] - this.lastMidi)) nearest = i;
      idx = nearest + Math.round(move);
    }
    // Gravity toward the middle of the range keeps the melody from drifting off.
    const center = pool.length / 2;
    if (Math.abs(idx - center) > pool.length * 0.4) idx += idx > center ? -2 : 2;
    idx = Math.max(0, Math.min(pool.length - 1, idx));
    this.lastMidi = pool[idx];
    return this.lastMidi;
  }

  pluck(midi, time, velocity, secondsPerStep) {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const { brightness, energy } = this.params;
    const decay = clamp(secondsPerStep * 10, 0.9, 2.6);

    const carrier = new OscillatorNode(ctx, { type: 'sine', frequency: f });
    const mod = new OscillatorNode(ctx, { type: 'sine', frequency: f * (energy > 0.6 ? 3 : 2) });
    const modGain = new GainNode(ctx, { gain: 0 });
    const amp = new GainNode(ctx, { gain: 0 });
    const pan = new StereoPannerNode(ctx, { pan: (this.rand() - 0.5) * 0.9 });

    mod.connect(modGain).connect(carrier.frequency);
    carrier.connect(amp).connect(pan).connect(this.filter);

    // FM index sweeps down: the bright "tine" attack mellows into a pure tone.
    const index = f * lerp(1.0, 3.0, brightness) * velocity;
    modGain.gain.setValueAtTime(index, time);
    modGain.gain.exponentialRampToValueAtTime(Math.max(1, index * 0.02), time + decay * 0.5);

    const peak = 0.42 * velocity;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + 0.004);
    amp.gain.setTargetAtTime(0, time + 0.004, decay / 4);

    const end = time + decay * 1.6;
    carrier.start(time);
    mod.start(time);
    carrier.stop(end);
    mod.stop(end);
    carrier.onended = () => {
      amp.disconnect();
      pan.disconnect();
    };
  }
}

function mergeSorted(a, b) {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}
