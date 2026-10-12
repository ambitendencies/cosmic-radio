import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFlareOnset, buildCascade, cooledDown, flareSize, parseXrayClass, baselineRate } from '../public/js/audio/layers/bells.js';

const flat = Array(30).fill(2e-7);

test('quiet history is not an onset', () => {
  assert.equal(detectFlareOnset({ history: flat, cls: 'B2.0', prevCls: 'B2.0' }).onset, false);
});

test('rising flux triggers an onset', () => {
  const h = [...flat, 3e-7, 6e-7, 1.5e-6, 4e-6];
  const r = detectFlareOnset({ history: h, cls: 'C4.0', prevCls: 'B2.0' });
  assert.equal(r.onset, true);
  assert.equal(r.reason, 'rise');
});

test('decay after the peak is not an onset', () => {
  const h = [...flat, 1e-5, 8e-6, 5e-6, 3e-6, 2e-6, 1.2e-6];
  assert.equal(detectFlareOnset({ history: h, cls: 'C1.2', prevCls: 'C2.0' }).onset, false);
});

test('class stepping up to M or X is an onset even without history', () => {
  assert.equal(detectFlareOnset({ cls: 'M1.0', prevCls: 'C9.0' }).onset, true);
  assert.equal(detectFlareOnset({ cls: 'C3.0', prevCls: 'B9.0' }).onset, false);
});

test('cooldown gate', () => {
  assert.equal(cooledDown(null, 5), true);
  assert.equal(cooledDown(10, 20), false);
  assert.equal(cooledDown(10, 100), true);
});

test('class parsing and size', () => {
  assert.equal(parseXrayClass('M2.5').flux, 2.5e-5);
  assert.ok(flareSize(1e-4) > flareSize(1e-5));
  assert.ok(baselineRate(1) > baselineRate(0));
});

test('cascade uses only pool notes, is ordered, and scales with size', () => {
  const pool = [72, 76, 79, 84, 88, 91, 96];
  let s = 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const small = buildCascade(pool, { size: 0.1, secondsPerBar: 3, rand });
  const big = buildCascade(pool, { size: 1, secondsPerBar: 3, rand });
  for (const c of [small, big]) {
    assert.ok(c.length >= 8 && c.length <= 20);
    for (const e of c) assert.ok(pool.includes(e.midi));
    for (let i = 1; i < c.length; i++) assert.ok(c[i].t > c[i - 1].t - 0.02);
  }
  assert.ok(big.length > small.length);
  assert.ok(big.at(-1).t > small.at(-1).t);
  assert.ok(big.at(-1).t <= 4 * 3 + 0.1);
});
