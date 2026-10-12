import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, PROGRESSIONS, midiToHz, quantize, inScale, chordOnDegree, voiceLead, pentatonicSubset, fifthsRoot, degreeToMidi, logNorm } from '../public/js/music/theory.js';

test('midiToHz: A4 = 440, C4 ≈ 261.63', () => {
  assert.equal(midiToHz(69), 440);
  assert.ok(Math.abs(midiToHz(60) - 261.626) < 0.01);
});

test('quantize always lands in the scale', () => {
  for (const mode of MODES) {
    for (let root = 43; root < 55; root++) {
      for (let m = 30; m < 100; m++) {
        const q = quantize(m + 0.3, root, mode.intervals);
        assert.ok(inScale(q, root, mode.intervals), `${mode.name} root ${root}: ${m} → ${q}`);
        assert.ok(Math.abs(q - m) <= 2);
      }
    }
  }
});

test('degreeToMidi wraps octaves both ways', () => {
  const ion = MODES[1].intervals;
  assert.equal(degreeToMidi(60, ion, 0), 60);
  assert.equal(degreeToMidi(60, ion, 7), 72);
  assert.equal(degreeToMidi(60, ion, -1), 59);
});

test('chords are diatonic and progressions reference valid degrees', () => {
  for (const mode of MODES) {
    assert.ok(PROGRESSIONS[mode.name], `progression for ${mode.name}`);
    for (const prog of PROGRESSIONS[mode.name]) {
      for (const deg of prog) {
        for (const opts of [{}, { extensions: 4 }, { extensions: 5 }, { extensions: 4, sus: 2 }, { extensions: 4, sus: 4 }]) {
          for (const n of chordOnDegree(50, mode.intervals, deg, opts)) assert.ok(inScale(n, 50, mode.intervals));
        }
      }
    }
  }
});

test('voiceLead keeps pitch classes, stays in range, moves smoothly', () => {
  const ion = MODES[1].intervals;
  const c = chordOnDegree(48, ion, 0, { extensions: 4 });
  const a = voiceLead(c, null, 50, 74);
  const f = chordOnDegree(48, ion, 3, { extensions: 4 });
  const b = voiceLead(f, a, 50, 74);
  for (const n of [...a, ...b]) assert.ok(n >= 50 && n <= 74);
  assert.deepEqual(new Set(b.map((n) => n % 12)), new Set(f.map((n) => n % 12)));
  const centroid = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(centroid(a) - centroid(b)) < 6);
});

test('pentatonic subsets are 5 notes, no semitones, keep root/fifth', () => {
  for (const mode of MODES) {
    const p = pentatonicSubset(mode.intervals);
    assert.equal(p.length, 5, mode.name);
    assert.ok(p.includes(0) && p.includes(7));
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const d = Math.abs(p[i] - p[j]) % 12;
        assert.notEqual(Math.min(d, 12 - d), 1, `${mode.name} semitone ${p}`);
      }
    }
  }
});

test('fifthsRoot covers all 12 keys in a one-octave window', () => {
  const roots = Array.from({ length: 12 }, (_, i) => fifthsRoot(i));
  assert.equal(new Set(roots.map((r) => r % 12)).size, 12);
  for (const r of roots) assert.ok(r >= 43 && r < 55);
  assert.equal(fifthsRoot(0) % 12, 2); // D
});

test('logNorm', () => {
  assert.equal(logNorm(1e-8, 1e-8, 1e-4), 0);
  assert.equal(logNorm(1e-4, 1e-8, 1e-4), 1);
  assert.ok(Math.abs(logNorm(1e-6, 1e-8, 1e-4) - 0.5) < 1e-9);
});
