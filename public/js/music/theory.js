// Music theory core. Pure functions only; everything here is unit-tested.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Modes ordered from brightest to darkest. The mapper walks this list.
export const MODES = [
  { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'Ionian', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Aeolian', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
];

// Chord progressions as scale degrees (0-based). Chosen per mode so each one
// shows off that mode's character tone and always resolves home.
export const PROGRESSIONS = {
  Lydian: [[0, 1, 0, 4], [0, 1, 6, 0]], // I–II–I–V (the raised 4th lives in II)
  Ionian: [[0, 5, 3, 4], [0, 3, 5, 4]], // I–vi–IV–V, I–IV–vi–V
  Mixolydian: [[0, 6, 3, 0], [0, 3, 6, 3]], // I–♭VII–IV–I
  Dorian: [[0, 3, 0, 6], [0, 1, 3, 0]], // i–IV–i–♭VII (the bright IV)
  Aeolian: [[0, 5, 2, 6], [0, 3, 5, 6]], // i–♭VI–♭III–♭VII
  Phrygian: [[0, 1, 0, 6], [0, 1, 5, 0]], // i–♭II–i–♭vii
};

export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const noteName = (m) => `${NOTE_NAMES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`;

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Map x from [lo,hi] onto 0..1, clamped. */
export const norm = (x, lo, hi) => clamp((x - lo) / (hi - lo));
/** Like norm, but on a log scale (for density, flux, …). */
export const logNorm = (x, lo, hi) => norm(Math.log10(Math.max(x, 1e-30)), Math.log10(lo), Math.log10(hi));
/** Smooth S-curve, for gentle response at the extremes. */
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** MIDI note for a scale degree (can be negative or exceed 7) above root. */
export function degreeToMidi(rootMidi, intervals, degree) {
  const n = intervals.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return rootMidi + octave * 12 + intervals[idx];
}

/** Snap any MIDI note to the nearest note in the scale (ties go down). */
export function quantize(midi, rootMidi, intervals) {
  const m = Math.round(midi);
  for (let d = 0; d <= 6; d++) {
    if (inScale(m - d, rootMidi, intervals)) return m - d;
    if (inScale(m + d, rootMidi, intervals)) return m + d;
  }
  return m;
}

export function inScale(midi, rootMidi, intervals) {
  const pc = (((Math.round(midi) - rootMidi) % 12) + 12) % 12;
  return intervals.includes(pc);
}

/**
 * Chord built by stacking thirds on a scale degree.
 * `extensions`: 3 = triad, 4 = seventh, 5 = ninth. `sus` replaces the 3rd with a 2nd/4th.
 */
export function chordOnDegree(rootMidi, intervals, degree, { extensions = 3, sus = null } = {}) {
  const steps = [0, 2, 4, 6, 8].slice(0, extensions);
  if (sus === 2) steps[1] = 1;
  if (sus === 4) steps[1] = 3;
  return steps.map((s) => degreeToMidi(rootMidi, intervals, degree + s));
}

/**
 * Voice-lead `chord` near `previous`: each voice moves to the closest octave
 * of its pitch class, keeping the voicing smooth and inside [lo, hi].
 */
export function voiceLead(chord, previous, lo = 48, hi = 76) {
  if (!previous || previous.length === 0) return spread(chord, lo, hi);
  const pcs = chord.map((m) => ((m % 12) + 12) % 12);
  const center = previous.reduce((a, b) => a + b, 0) / previous.length;
  const voiced = pcs.map((pc, i) => {
    const target = previous[i % previous.length] ?? center;
    let best = pc;
    let bestDist = Infinity;
    for (let o = 0; o <= 10; o++) {
      const cand = pc + o * 12;
      const d = Math.abs(cand - target);
      if (cand >= lo && cand <= hi && d < bestDist) {
        best = cand;
        bestDist = d;
      }
    }
    return best;
  });
  return [...new Set(voiced)].sort((a, b) => a - b);
}

function spread(chord, lo, hi) {
  return chord.map((m) => {
    let x = m;
    while (x < lo) x += 12;
    while (x > hi) x -= 12;
    return x;
  }).sort((a, b) => a - b);
}

/** Circle-of-fifths walk: step 0 = D, then A, E, B, … (keys sit nicely in synth range). */
export function fifthsRoot(step, base = 50) {
  const pc = (((base + step * 7) % 12) + 12) % 12;
  // Keep the root within a 12-semitone window starting at G2 (MIDI 43).
  return 43 + ((pc - 43 % 12 + 12) % 12);
}

/**
 * Pentatonic subset of a 7-note mode: repeatedly drop the most tense degree
 * (most semitone/tritone clashes) while protecting root, third and fifth.
 * Ionian → major pentatonic, Aeolian/Dorian → minor pentatonic.
 */
export function pentatonicSubset(intervals) {
  const out = [...intervals];
  const isProtected = (i) => i === 0 || i === 3 || i === 4 || i === 7;
  const clashes = (i) =>
    out.filter((j) => j !== i).reduce((n, j) => {
      const d = Math.abs(i - j) % 12;
      const ic = Math.min(d, 12 - d);
      return n + (ic === 1 || ic === 6 ? 1 : 0);
    }, 0);
  while (out.length > 5) {
    let worst = -1;
    let worstScore = -1;
    for (const i of out) {
      if (isProtected(i)) continue;
      const sc = clashes(i);
      if (sc > worstScore) {
        worst = i;
        worstScore = sc;
      }
    }
    if (worst < 0) break;
    out.splice(out.indexOf(worst), 1);
  }
  return out;
}
