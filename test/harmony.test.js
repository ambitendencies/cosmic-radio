import test from 'node:test';
import assert from 'node:assert/strict';
import { Harmony } from '../public/js/audio/harmony.js';
import { mulberry32 } from '../public/js/data/simulator.js';
import { inScale, fifthsRoot, MODES } from '../public/js/music/theory.js';

const info = (step) => ({ step, bar: Math.floor(step / 16), stepInBar: step % 16 });

test('every note Harmony offers is in the current scale, across key/mode changes', () => {
  const rand = mulberry32(99);
  const h = new Harmony({ rand });
  for (let step = 0; step < 32 * 200; step++) {
    if (step % 97 === 0) h.setTarget({ rootMidi: fifthsRoot(Math.floor(rand() * 10)), modeIndex: Math.floor(rand() * MODES.length), tension: rand() });
    h.tick(0, info(step));
    for (const n of [...h.voicing, ...h.chordTones(), ...h.safeNotes(), h.quantize(60 + rand() * 24)]) {
      assert.ok(inScale(n, h.rootMidi, h.intervals), `step ${step}: ${n} not in ${h.mode.name} on ${h.rootMidi}`);
    }
  }
});

test('chords change every two bars; key changes wait for a phrase boundary', () => {
  const h = new Harmony({ rootMidi: 50, modeIndex: 1, rand: mulberry32(1) });
  let changes = 0;
  h.onChange(() => changes++);
  for (let s = 0; s < 128; s++) h.tick(0, info(s));
  assert.equal(changes, 4);
  h.setTarget({ rootMidi: 45 });
  for (let s = 128; s < 160; s++) h.tick(0, info(s)); // step 128 is a phrase start
  assert.equal(h.rootMidi, 45);
  h.setTarget({ rootMidi: 52 });
  for (let s = 160; s < 200; s++) h.tick(0, info(s)); // no phrase start in range
  assert.equal(h.rootMidi, 45);
});
