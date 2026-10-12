// Audio engine: owns the AudioContext, the master chain, the shared effects
// (reverb and ping-pong delay), the scheduler, and the harmony, and it
// passes musical parameters on to every layer.
//
//  layers ─┬─► bus (dry) ───────────────────────────────┐
//          ├─► reverbSend ─► convolver ─► reverbReturn ─┤
//          └─► delaySend ─► ping-pong ─► delayReturn ───┤
//                                                       ▼
//        highpass ► glue compressor ► soft clip ► master ► limiter ► analyser ► out

import { createImpulseResponse } from './reverb.js';
import { Scheduler } from './scheduler.js';
import { Harmony } from './harmony.js';
import { lerp } from '../music/theory.js';

export class AudioEngine {
  constructor({ context } = {}) {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = context ?? new Ctx({ latencyHint: 'playback' });
    this.layers = [];
    this.params = null;
    this.state = null;
    this.buildGraph();
    this.scheduler = new Scheduler(this.ctx);
    this.harmony = new Harmony();
    this.scheduler.onStep((time, info) => {
      this.harmony.tick(time, info);
      for (const layer of this.layers) if (layer.enabled !== false) layer.onStep?.(time, info);
    });
  }

  buildGraph() {
    const ctx = this.ctx;
    const g = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };

    // Summing points.
    this.bus = g(1);
    this.reverbSend = g(1);
    this.delaySend = g(1);

    // Mix bus processing.
    this.mixIn = g(1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 28;
    hp.Q.value = 0.5;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.03;
    glue.release.value = 0.4;

    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';

    this.master = g(0); // fades in on start
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.85;

    this.bus.connect(this.mixIn);
    this.mixIn.connect(hp).connect(glue).connect(clip).connect(this.master).connect(limiter).connect(this.analyser).connect(ctx.destination);

    // Reverb.
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createImpulseResponse(ctx, { seconds: 7, decay: 2.8 });
    const revLo = ctx.createBiquadFilter();
    revLo.type = 'highpass';
    revLo.frequency.value = 180; // keep the low end out of the reverb, so it doesn't turn to mud
    this.reverbReturn = g(0.5);
    this.reverbSend.connect(revLo).connect(this.convolver).connect(this.reverbReturn).connect(this.mixIn);

    // Ping-pong delay with a darkening feedback loop.
    this.delayL = ctx.createDelay(4);
    this.delayR = ctx.createDelay(4);
    const fbL = g(0.42);
    const fbR = g(0.42);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    const panL = new StereoPannerNode(ctx, { pan: -0.7 });
    const panR = new StereoPannerNode(ctx, { pan: 0.7 });
    this.delayReturn = g(0.35);
    this.delaySend.connect(tone).connect(this.delayL);
    this.delayL.connect(fbL).connect(this.delayR);
    this.delayR.connect(fbR).connect(this.delayL);
    this.delayL.connect(panL).connect(this.delayReturn);
    this.delayR.connect(panR).connect(this.delayReturn);
    this.delayReturn.connect(this.mixIn);
    this.delayReturn.connect(this.reverbSend); // echoes bloom into the hall
    this.setDelayTime(72);

    this.volume = 0.8;
  }

  /** Dotted-eighth echoes, locked to the tempo. */
  setDelayTime(bpm) {
    const t = (60 / bpm) * 0.75;
    const now = this.ctx.currentTime;
    this.delayL.delayTime.setTargetAtTime(t, now, 1.5);
    this.delayR.delayTime.setTargetAtTime(t, now, 1.5);
  }

  addLayer(LayerClass) {
    const layer = new LayerClass(this);
    this.layers.push(layer);
    if (this.params) layer.update?.(this.params, this.state);
    return layer;
  }

  getLayer(id) {
    return this.layers.find((l) => l.constructor.id === id);
  }

  async start() {
    await this.ctx.resume();
    const now = this.ctx.currentTime;
    for (const layer of this.layers) layer.start?.(now);
    this.scheduler.start();
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.volume, now + 4);
    this.running = true;
  }

  async stop() {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 1.5);
    await new Promise((r) => setTimeout(r, 1600));
    this.scheduler.stop();
    for (const layer of this.layers) layer.stop?.(this.ctx.currentTime);
    await this.ctx.suspend();
    this.running = false;
  }

  setVolume(v) {
    this.volume = v;
    if (this.running) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  /** Receive new MusicalParams (+ the raw state, for layers that want it). */
  update(params, state) {
    this.params = params;
    this.state = state;
    const now = this.ctx.currentTime;
    this.scheduler.setTempo(params.tempo);
    this.setDelayTime(params.tempo);
    this.harmony.setTarget({ rootMidi: params.rootMidi, modeIndex: params.modeIndex, tension: params.tension });
    this.reverbReturn.gain.setTargetAtTime(lerp(0.35, 0.9, params.space), now, 3);
    for (const layer of this.layers) layer.update?.(params, state);
  }
}

function softClipCurve(n = 2048) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(1.5 * x) / Math.tanh(1.5);
  }
  return curve;
}
