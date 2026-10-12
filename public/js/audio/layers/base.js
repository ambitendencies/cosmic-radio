// Base class for sound layers: it handles output routing, the send levels,
// mute ramps, and fading in and out. Subclasses connect their sound to
// `this.out` and implement whichever of update/onStep they need.

export default class BaseLayer {
  static id = 'base';
  static label = 'Base';
  static description = '';

  constructor(engine, { gain = 0.5, reverb = 0.3, delay = 0 } = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.harmony = engine.harmony;
    this.level = gain;
    this.enabled = true;

    this.out = this.ctx.createGain(); // layers connect here
    this.fader = this.ctx.createGain(); // mute + fade
    this.fader.gain.value = 0;
    this.out.connect(this.fader);

    this.dry = this.ctx.createGain();
    this.revSend = this.ctx.createGain();
    this.dlySend = this.ctx.createGain();
    this.dry.gain.value = 1;
    this.revSend.gain.value = reverb;
    this.dlySend.gain.value = delay;
    this.fader.connect(this.dry).connect(engine.bus);
    this.fader.connect(this.revSend).connect(engine.reverbSend);
    this.fader.connect(this.dlySend).connect(engine.delaySend);
  }

  get now() {
    return this.ctx.currentTime;
  }

  start(time = this.now) {
    this.fadeTo(this.enabled ? this.level : 0, time, 3);
  }

  stop(time = this.now) {
    this.fadeTo(0, time, 0.5);
  }

  setEnabled(on) {
    this.enabled = on;
    this.fadeTo(on ? this.level : 0, this.now, on ? 1.5 : 0.6);
  }

  setLevel(v) {
    this.level = v;
    if (this.enabled) this.fadeTo(v, this.now, 1);
  }

  fadeTo(v, time, seconds) {
    const p = this.fader.gain;
    p.cancelScheduledValues(time);
    p.setValueAtTime(p.value, time);
    p.linearRampToValueAtTime(v, time + seconds);
  }

  setSends({ reverb, delay } = {}, timeConstant = 2) {
    if (reverb != null) this.revSend.gain.setTargetAtTime(reverb, this.now, timeConstant);
    if (delay != null) this.dlySend.gain.setTargetAtTime(delay, this.now, timeConstant);
  }

  update(_params, _state) {}
  onStep(_time, _info) {}
}

/** Schedule a percussive ADSR-ish envelope on an AudioParam. */
export function envelope(param, time, { attack = 0.005, peak = 1, decay = 0.3, sustain = 0, release = 0.5, hold = 0 } = {}) {
  param.cancelScheduledValues(time);
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(peak, time + attack);
  param.setTargetAtTime(peak * sustain, time + attack, decay / 3);
  const end = time + attack + decay + hold;
  if (sustain > 0) {
    param.setTargetAtTime(0, end, release / 3);
    return end + release * 1.5;
  }
  return time + attack + decay * 1.5;
}
