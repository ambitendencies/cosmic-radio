import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDsn, SimulatedDsn } from '../public/js/data/dsn.js';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<dsn>
  <station name="gdscc" friendlyName="Goldstone" timeUTC="1760240000000" timeZoneOffset="-25200000"/>
  <dish name="DSS14" azimuthAngle="120.5" elevationAngle="35.2" windSpeed="5.1" isMSPA="false" isArray="false" isDDOR="false">
    <upSignal active="true" signalType="data" power="18.2" frequency="2115" dataRate="16" band="S" spacecraft="VGR1" spacecraftID="31"/>
    <downSignal active="true" signalType="data" signalTypeDebug="IN LOCK" dataRate="160" frequency="8420430000" band="X" power="-157.33" spacecraft="VGR1" spacecraftID="31"/>
    <target name="VGR1" id="31" uplegRange="2.47e+10" downlegRange="2.47e+10" rtlt="164700.5"/>
  </dish>
  <dish name="DSS24" isMSPA="true">
    <downSignal active="true" signalType="data" dataRate="2000000" band="Ka" power="-120.5" spacecraft="JWST" spacecraftID="170"/>
    <downSignal active="true" signalType="data" dataRate="3000" band="X" power="-140" spacecraft="LUCY" spacecraftID="-49"/>
    <downSignal active="true" signalType="none" dataRate="" band="X" power="" spacecraft="MRO" spacecraftID="-74"/>
    <target name="JWST" id="170" uplegRange="1.5e6" downlegRange="1.5e6" rtlt="10.0"/>
    <target name="LUCY" id="-49" uplegRange="6.1e8" downlegRange="6.1e8" rtlt="-1"/>
  </dish>
  <station name="mdscc" friendlyName="Madrid" timeUTC="1760240000000" timeZoneOffset="7200000"/>
  <dish name="DSS54">
    <downSignal active="true" signalType="data" dataRate="150" band="X" power="-159.9" spacecraft="VGR1" spacecraftID="31"/>
    <target name="VGR1" id="31" uplegRange="2.47e+10" downlegRange="2.47e+10" rtlt="164700.5"/>
  </dish>
  <dish name="DSS55">
    <downSignal active="false" signalType="data" band="X" power="-130" spacecraft="MSL" spacecraftID="-76"/>
    <downSignal active="true" signalType="data" dataRate="" band="X" power="none" spacecraft="TEST" spacecraftID="1"/>
    <downSignal active="true" signalType="data" dataRate="10" band="X" power="-150" spacecraft="XYZ9" spacecraftID="5"/>
    <target name="XYZ9" id="5" uplegRange="none" downlegRange="none" rtlt="none"/>
  </dish>
  <station name="cdscc" friendlyName="Canberra" timeUTC="1760240000000" timeZoneOffset="36000000"/>
  <dish name="DSS43">
    <downSignal active="true" signalType="data" dataRate="1000" band="X" power="-150" spacecraft="NHPC" spacecraftID="98"/>
    <target name="NHPC" id="98" uplegRange="9.0e9" downlegRange="9.0e9" rtlt=""/>
  </dish>
  <timestamp>1760240000000</timestamp>
</dsn>`;

test('parseDsn extracts active links with station, units and friendly names', () => {
  const links = parseDsn(XML);
  const by = Object.fromEntries(links.map((l) => [l.id, l]));
  assert.deepEqual(Object.keys(by).sort(), ['JWST', 'LUCY', 'NHPC', 'VGR1', 'XYZ9']);
  assert.equal(by.VGR1.name, 'Voyager 1');
  assert.equal(by.JWST.station, 'Goldstone');
  assert.equal(by.JWST.dish, 'DSS24');
  assert.equal(by.JWST.band, 'Ka');
  assert.equal(by.JWST.rangeKm, 1.5e6);
  assert.equal(by.JWST.dataRate, 2000000);
  assert.equal(by.NHPC.station, 'Canberra');
});

test('parseDsn dedupes by spacecraft keeping the strongest power', () => {
  const vgr = parseDsn(XML).filter((l) => l.id === 'VGR1');
  assert.equal(vgr.length, 1);
  assert.equal(vgr[0].power, -157.33);
  assert.equal(vgr[0].station, 'Goldstone');
});

test('parseDsn derives rtlt from range when missing, and nulls unknowns', () => {
  const by = Object.fromEntries(parseDsn(XML).map((l) => [l.id, l]));
  assert.ok(Math.abs(by.LUCY.rtlt - (2 * 6.1e8) / 299792.458) < 1e-6);
  assert.ok(Math.abs(by.NHPC.rtlt - (2 * 9e9) / 299792.458) < 1e-3);
  assert.equal(by.VGR1.rtlt, 164700.5);
  assert.equal(by.XYZ9.rangeKm, null);
  assert.equal(by.XYZ9.rtlt, null);
  assert.equal(by.XYZ9.name, 'XYZ9');
});

test('parseDsn skips inactive, none-type and placeholder signals', () => {
  const ids = parseDsn(XML).map((l) => l.id);
  for (const bad of ['MRO', 'MSL', 'TEST']) assert.ok(!ids.includes(bad), bad);
});

test('parseDsn is robust to junk input', () => {
  assert.deepEqual(parseDsn(''), []);
  assert.deepEqual(parseDsn(null), []);
  assert.deepEqual(parseDsn('<html>not xml'), []);
  assert.deepEqual(parseDsn('<dsn></dsn>'), []);
});

test('SimulatedDsn is deterministic for a seed', () => {
  const run = (seed) => {
    const s = new SimulatedDsn({ seed });
    const out = [];
    for (let i = 0; i < 200; i++) out.push(s.step(5));
    return JSON.stringify(out);
  };
  assert.equal(run(3), run(3));
  assert.notEqual(run(3), run(4));
});

test('SimulatedDsn yields 2-5 realistic links and changes slowly', () => {
  const s = new SimulatedDsn({ seed: 7 });
  const seen = new Set();
  let prev = null;
  let changes = 0;
  for (let i = 0; i < 1800; i++) {
    const links = s.step(2);
    assert.ok(links.length >= 2 && links.length <= 5, `count ${links.length}`);
    for (const l of links) {
      seen.add(l.id);
      assert.ok(['Goldstone', 'Madrid', 'Canberra'].includes(l.station));
      assert.ok(l.rangeKm > 1e5 && l.rangeKm < 1e11);
      assert.ok(l.rtlt > 0 && l.dataRate > 0);
      assert.ok(l.power <= -95 && l.power >= -165, `power ${l.power}`);
      assert.ok(['X', 'S', 'Ka'].includes(l.band));
    }
    const key = links.map((l) => l.id).sort().join();
    if (prev !== null && key !== prev) changes++;
    prev = key;
  }
  assert.ok(seen.size >= 6, `variety ${seen.size}`);
  assert.ok(changes >= 3 && changes < 70, `changes ${changes}`);
});

test('SimulatedDsn power falls with range', () => {
  const s = new SimulatedDsn({ seed: 1 });
  const all = new Map();
  for (let i = 0; i < 2000; i++) for (const l of s.step(2)) all.set(l.id, l);
  if (all.has('VGR1') && all.has('JWST')) assert.ok(all.get('VGR1').power < all.get('JWST').power);
});
