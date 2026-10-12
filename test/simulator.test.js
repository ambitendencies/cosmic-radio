import test from 'node:test';
import assert from 'node:assert/strict';
import { SpaceWeatherSimulator } from '../public/js/data/simulator.js';

test('simulator is deterministic for a seed', () => {
  const a = new SpaceWeatherSimulator({ seed: 7 });
  const b = new SpaceWeatherSimulator({ seed: 7 });
  for (let i = 0; i < 50; i++) assert.deepEqual(a.step(2), b.step(2));
});

test('simulated values stay physically plausible', () => {
  const sim = new SpaceWeatherSimulator({ seed: 1, timeScale: 3600 });
  for (let i = 0; i < 5000; i++) {
    const p = sim.step(2);
    assert.ok(p.solarWind.speed >= 250 && p.solarWind.speed <= 950);
    assert.ok(p.solarWind.density > 0);
    assert.ok(p.solarWind.bt >= Math.abs(p.solarWind.bz) - 1e-9);
    assert.ok(p.kp >= 0 && p.kp <= 9);
    assert.ok(p.xray.flux > 1e-9 && p.xray.flux < 1e-2);
  }
});

test('triggered flare raises X-ray flux to M/X class', () => {
  const sim = new SpaceWeatherSimulator({ seed: 3, timeScale: 60 });
  sim.trigger('flare');
  let peak = 0;
  for (let i = 0; i < 40; i++) peak = Math.max(peak, sim.step(2).xray.flux);
  assert.ok(peak > 1e-5, `peak ${peak}`);
});

test('triggered storm drives Bz south and Kp up', () => {
  const sim = new SpaceWeatherSimulator({ seed: 5, timeScale: 600 });
  sim.trigger('storm');
  let minBz = Infinity;
  let maxKp = 0;
  for (let i = 0; i < 40; i++) {
    const p = sim.step(2);
    minBz = Math.min(minBz, p.solarWind.bz);
    maxKp = Math.max(maxKp, p.kp);
  }
  assert.ok(minBz < -5, `minBz ${minBz}`);
  assert.ok(maxKp >= 4, `maxKp ${maxKp}`);
});
