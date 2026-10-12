// Drone: the low, breathing foundation. A sub sine, detuned saws on the root
// and fifth, and a soft octave triangle, all through a slowly sweeping
// low-pass filter. Magnetic field strength (Bt) gives it weight; solar-wind
// brightness opens the filter; tension widens the detune.

import BaseLayer from './base.js';
import { midiToHz, lerp } from '../../music/theory.js';

export default class DroneLayer extends BaseLayer {
  static id = 'drone';
  static label = 'Drone';
  static description = 'Magnetic field → weight · solar wind → brightness';

  constructor(engine) {
    super(engine, { gain: 0.13, reverb: 0.3 });
    const ctx = this.ctx;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.filter.Q.value = 0.8;

    this.body = ctx.createGain();
    this.body.gain.value = 0.7;
    this.filter.connect(this.body).connect(this.out);

    // Slow filter sweep and amplitude "breath".
    this.lfo = new OscillatorNode(ctx, { frequency: 0.045 });
    this.lfoDepth = new GainNode(ctx, { gain: 120 });
    this.lfo.connect(this.lfoDepth).connect(this.filter.frequency);
    this.breath = new OscillatorNode(ctx, { frequency: 0.07 });
    this.breathDepth = new GainNode(ctx, { gain: 0.12 });
    this.breath.connect(this.breathDepth).connect(this.body.gain);

    this.voices = [];
    this.rootMidi = this.harmony.rootMidi;
    this.detuneCents = 6;
    harmonyRootListener(this);
  }

  /** Voice recipe: [semitone offset from root, type, level, detune multiplier, pan]. */
  static recipe = [
    [-12, 'sine', 0.4, 0, 0],
    [0, 'sawtooth', 0.11, -1, -0.35],
    [0, 'sawtooth', 0.11, 1, 0.35],
    [7, 'sawtooth', 0.07, -0.7, 0.25],
    [7, 'sawtooth', 0.07, 0.7, -0.25],
    [12, 'triangle', 0.09, 0.3, 0],
  ];

  start(time = this.now) {
    if (this.voices.length === 0) {
      for (const [semi, type, level, det, pan] of DroneLayer.recipe) {
        const osc = new OscillatorNode(this.ctx, { type, frequency: midiToHz(this.rootMidi + semi), detune: det * this.detuneCents });
        const gain = new GainNode(this.ctx, { gain: level });
        const panner = new StereoPannerNode(this.ctx, { pan });
        osc.connect(gain).connect(panner).connect(this.filter);
        osc.start(time);
        this.voices.push({ osc, semi, det });
      }
      this.lfo.start(time);
      this.breath.start(time);
    }
    super.start(time);
  }

  stop(time = this.now) {
    super.stop(time);
    const end = time + 0.6;
    for (const v of this.voices) v.osc.stop(end);
    try {
      this.lfo.stop(end);
      this.breath.stop(end);
    } catch {}
    this.voices = [];
    // Oscillators are one-shot; rebuild the LFOs for the next start().
    this.lfo = new OscillatorNode(this.ctx, { frequency: 0.045 });
    this.lfo.connect(this.lfoDepth);
    this.breath = new OscillatorNode(this.ctx, { frequency: 0.07 });
    this.breath.connect(this.breathDepth);
  }

  retune(rootMidi, time) {
    this.rootMidi = rootMidi;
    for (const v of this.voices) {
      // Slow portamento: a key change slides in, like the tide turning.
      v.osc.frequency.setTargetAtTime(midiToHz(rootMidi + v.semi), time, 1.2);
    }
  }

  update(p) {
    const now = this.now;
    const base = lerp(160, 900, p.brightness);
    this.filter.frequency.setTargetAtTime(base, now, 4);
    this.lfoDepth.gain.setTargetAtTime(base * 0.35, now, 4);
    this.body.gain.setTargetAtTime(lerp(0.55, 1.0, p.field), now, 4);
    this.detuneCents = lerp(4, 16, p.tension);
    for (const v of this.voices) v.osc.detune.setTargetAtTime(v.det * this.detuneCents, now, 3);
  }
}

function harmonyRootListener(layer) {
  layer.harmony.onChange((time, h) => {
    if (h.rootMidi !== layer.rootMidi) layer.retune(h.rootMidi, time);
  });
}
