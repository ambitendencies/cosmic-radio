import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStateToParams } from '../public/js/music/mapper.js';
import { defaultState } from '../public/js/data/state.js';
import { MODES } from '../public/js/music/theory.js';
import { SpaceWeatherSimulator } from '../public/js/data/simulator.js';
import { mergeState } from '../public/js/data/state.js';

const withSW = (patch, extra = {}) => {
  const s = defaultState();
  Object.assign(s.solarWind, patch);
  return Object.assign(s, extra);
};

test('northward Bz is bright, southward is dark', () => {
  assert.equal(mapStateToParams(withSW({ bz: 8 })).modeName, 'Lydian');
  assert.equal(mapStateToParams(withSW({ bz: -12 })).modeName, 'Phrygian');
});

test('faster wind → faster tempo, clamped to 56–96', () => {
  const slow = mapStateToParams(withSW({ speed: 250 }));
  const fast = mapStateToParams(withSW({ speed: 1200 }));
  assert.equal(slow.tempo, 56);
  assert.equal(fast.tempo, 96);
});

test('hysteresis: small wobbles do not flip the mode', () => {
  let p = mapStateToParams(withSW({ bz: 0 }));
  const start = p.modeIndex;
  for (const bz of [0.6, -0.6, 0.8, -0.8, 0.3]) p = mapStateToParams(withSW({ bz }), p);
  assert.equal(p.modeIndex, start);
});

test('all outputs finite and in range across a long simulation', () => {
  const sim = new SpaceWeatherSimulator({ seed: 42, timeScale: 600 });
  let s = defaultState();
  let p = null;
  for (let i = 0; i < 2000; i++) {
    s = mergeState(s, sim.step(2));
    p = mapStateToParams(s, p);
    for (const k of ['density', 'brightness', 'tension', 'energy', 'turbulence', 'field', 'space']) {
      assert.ok(p[k] >= 0 && p[k] <= 1, `${k}=${p[k]} at step ${i}`);
    }
    assert.ok(p.tempo >= 56 && p.tempo <= 96);
    assert.ok(p.modeIndex >= 0 && p.modeIndex < MODES.length);
    assert.ok(Number.isInteger(p.rootMidi));
    assert.equal(p.explain.length, 8);
  }
});
