import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsToObjects, parsePlasma, parseMag, parseKp, parseXray, parseProtons, xrayClass, parseTime } from '../public/js/data/parsers.js';

const plasma = [
  ['time_tag', 'density', 'speed', 'temperature'],
  ['2026-10-12 03:00:00.000', '4.10', '410.2', '81000'],
  ['2026-10-12 03:01:00.000', '4.30', '412.0', '82000'],
  ['2026-10-12 03:02:00.000', null, null, null],
];

test('rowsToObjects handles header-row arrays and object arrays', () => {
  assert.deepEqual(rowsToObjects([['a', 'b'], [1, 2]]), [{ a: 1, b: 2 }]);
  assert.deepEqual(rowsToObjects([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(rowsToObjects(null), []);
});

test('parseTime treats SWPC tags as UTC', () => {
  assert.equal(parseTime('2026-10-12 03:00:00.000'), Date.UTC(2026, 9, 12, 3));
  assert.equal(parseTime('2026-10-12T03:00:00Z'), Date.UTC(2026, 9, 12, 3));
});

test('parsePlasma skips null rows and averages the trailing samples', () => {
  const p = parsePlasma(plasma);
  assert.equal(p.time, Date.UTC(2026, 9, 12, 3, 1));
  assert.ok(Math.abs(p.speed - 411.1) < 1e-9);
  assert.ok(Math.abs(p.density - 4.2) < 1e-9);
  assert.equal(p.temperature, 82000);
  assert.equal(parsePlasma([]), null);
});

test('parseMag', () => {
  const m = parseMag([
    ['time_tag', 'bx_gsm', 'by_gsm', 'bz_gsm', 'lon_gsm', 'lat_gsm', 'bt'],
    ['2026-10-12 03:00:00.000', '1.0', '2.0', '-3.5', '10', '-20', '6.1'],
  ]);
  assert.equal(m.bz, -3.5);
  assert.equal(m.bt, 6.1);
  assert.equal(m.by, 2);
});

test('parseKp accepts both array and object formats', () => {
  assert.equal(parseKp([['time_tag', 'Kp', 'a_running', 'station_count'], ['2026-10-12 00:00:00.000', '3.33', '18', '8']]).kp, 3.33);
  assert.equal(parseKp([{ time_tag: '2026-10-12T00:00:00', Kp: 4.67, a_running: 39, station_count: 8 }]).kp, 4.67);
});

test('parseXray uses the long channel and classifies', () => {
  const x = parseXray([
    { time_tag: '2026-10-12T03:00:00Z', satellite: 18, flux: 3.2e-6, energy: '0.1-0.8nm' },
    { time_tag: '2026-10-12T03:00:00Z', satellite: 18, flux: 9e-8, energy: '0.05-0.4nm' },
  ]);
  assert.equal(x.flux, 3.2e-6);
  assert.equal(x.class, 'C3.2');
  assert.deepEqual(x.history, [3.2e-6]);
});

test('xrayClass boundaries', () => {
  assert.equal(xrayClass(1e-4), 'X1.0');
  assert.equal(xrayClass(5.5e-5), 'M5.5');
  assert.equal(xrayClass(2e-7), 'B2.0');
  assert.equal(xrayClass(3e-9), 'A0.3');
  assert.equal(xrayClass(NaN), '—');
});

test('parseProtons picks >=10 MeV and ignores sentinels', () => {
  const p = parseProtons([
    { time_tag: 't', flux: 0.5, energy: '>=10 MeV' },
    { time_tag: 't', flux: 12, energy: '>=1 MeV' },
    { time_tag: 't', flux: -99999, energy: '>=10 MeV' },
  ]);
  assert.equal(p.flux, 0.5);
});
