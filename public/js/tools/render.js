// Offline renderer: plays the full engine against simulated space weather
// into an OfflineAudioContext and returns a 16-bit WAV. Used by
// scripts/render-sample.mjs, and handy for comparing sound-design changes.

import { AudioEngine } from '../audio/engine.js';
import { LAYERS } from '../audio/layers/index.js';
import { SpaceWeatherSimulator } from '../data/simulator.js';
import { SimulatedDsn } from '../data/dsn.js';
import { defaultState, mergeState } from '../data/state.js';
import { mapStateToParams } from '../music/mapper.js';

export async function renderSample({ seconds = 60, seed = 7, timeScale = 120, events = [], sampleRate = 44100, only = null } = {}) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * sampleRate), sampleRate });
  const engine = new AudioEngine({ context: ctx });
  LAYERS.filter((L) => !only || only.includes(L.id)).forEach((L) => engine.addLayer(L));

  const sim = new SpaceWeatherSimulator({ seed, timeScale });
  const dsn = new SimulatedDsn({ seed });
  let state = defaultState();
  let params = null;
  const TICK = 2;

  const advance = (t) => {
    for (const e of events) if (Math.abs(e.at - t) < TICK / 2) sim.trigger(e.kind);
    state = mergeState(state, { ...sim.step(TICK), dsn: dsn.step(TICK) });
    params = mapStateToParams(state, params);
    engine.update(params, state);
    engine.scheduler.pump();
  };

  // Prime state, start the layers, fade in.
  advance(0);
  engine.scheduler.lookAhead = TICK + 0.2;
  engine.scheduler.running = true;
  engine.scheduler.nextTime = 0.05;
  engine.scheduler.tempo = params.tempo;
  for (const layer of engine.layers) layer.start(0);
  engine.master.gain.setValueAtTime(0, 0);
  engine.master.gain.linearRampToValueAtTime(0.8, 3);
  engine.master.gain.setValueAtTime(0.8, seconds - 3);
  engine.master.gain.linearRampToValueAtTime(0, seconds);
  engine.scheduler.pump();

  for (let t = TICK; t < seconds; t += TICK) {
    ctx.suspend(t).then(() => {
      advance(t);
      ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  return { wav: encodeWav(buffer), stats: levelStats(buffer) };
}

function levelStats(buffer) {
  let peak = 0;
  let sum = 0;
  const n = buffer.length;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
    }
  }
  const rms = Math.sqrt(sum / (n * buffer.numberOfChannels));
  return { peak, rms, peakDb: 20 * Math.log10(peak), rmsDb: 20 * Math.log10(rms) };
}

export function encodeWav(buffer) {
  const chs = buffer.numberOfChannels;
  const n = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + n * chs * 2));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * chs * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, chs, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * chs * 2, true);
  out.setUint16(32, chs * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * chs * 2, true);
  const data = Array.from({ length: chs }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < chs; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}
