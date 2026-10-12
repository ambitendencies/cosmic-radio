// Pad: warm sustained chords that follow the progression, voice-led so each
// note moves as little as possible. Chords crossfade over several seconds.

import BaseLayer from './base.js';
import { midiToHz, lerp } from '../../music/theory.js';

const ATTACK = 2.5;
const RELEASE = 4;

export default class PadLayer extends BaseLayer {
  static id = 'pad';
  static label = 'Pad';
  static description = 'Chord progression · Bz → mode · Kp → key';

  constructor(engine) {
    super(engine, { gain: 0.26, reverb: 0.55, delay: 0.05 });
    const ctx = this.ctx;
    this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1200, Q: 0.6 });
    this.filter.connect(this.out);
    this.lfo = new OscillatorNode(ctx, { frequency: 0.06 });
    this.lfoDepth = new GainNode(ctx, { gain: 300 });
    this.lfo.connect(this.lfoDepth).connect(this.filter.frequency);
    this.lfoStarted = false;
    this.voices = [];
    this.detune = 7;
    this.unsub = this.harmony.onChange((time, h) => this.playChord(h.voicing, time));
  }

  start(time = this.now) {
    if (!this.lfoStarted) {
      this.lfo.start(time);
      this.lfoStarted = true;
    }
    this.playChord(this.harmony.voicing, time);
    super.start(time);
  }

  stop(time = this.now) {
    super.stop(time);
    this.releaseAll(time, 0.5);
  }

  releaseAll(time, release = RELEASE) {
    for (const v of this.voices) {
      v.gain.gain.cancelScheduledValues(time);
      v.gain.gain.setValueAtTime(v.gain.gain.value, time);
      v.gain.gain.setTargetAtTime(0, time, release / 3);
      for (const o of v.oscs) o.stop(time + release * 2);
    }
    this.voices = [];
  }

  playChord(notes, time) {
    if (!notes?.length) return;
    this.releaseAll(time);
    const n = notes.length;
    notes.forEach((midi, i) => {
      const pan = n > 1 ? lerp(-0.55, 0.55, i / (n - 1)) : 0;
      const gain = new GainNode(this.ctx, { gain: 0 });
      const panner = new StereoPannerNode(this.ctx, { pan });
      gain.connect(panner).connect(this.filter);
      const f = midiToHz(midi);
      const oscs = [
        new OscillatorNode(this.ctx, { type: 'sawtooth', frequency: f, detune: -this.detune }),
        new OscillatorNode(this.ctx, { type: 'sawtooth', frequency: f, detune: this.detune }),
        new OscillatorNode(this.ctx, { type: 'triangle', frequency: f * 2, detune: 2 }),
      ];
      const mix = [0.5, 0.5, 0.25];
      oscs.forEach((o, k) => {
        const g = new GainNode(this.ctx, { gain: mix[k] });
        o.connect(g).connect(gain);
        o.start(time);
      });
      // Lower voices a bit louder; keeps the top from getting shrill.
      const level = (0.34 / Math.sqrt(n)) * (1 - i * 0.08);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(level, time + ATTACK + Math.random() * 0.8);
      this.voices.push({ gain, oscs });
    });
  }

  update(p) {
    const now = this.now;
    const cutoff = lerp(500, 3200, p.brightness ** 1.2);
    this.filter.frequency.setTargetAtTime(cutoff, now, 4);
    this.lfoDepth.gain.setTargetAtTime(cutoff * 0.3, now, 4);
    this.detune = lerp(5, 14, p.tension);
    this.setSends({ reverb: lerp(0.4, 0.75, p.space) });
  }
}
