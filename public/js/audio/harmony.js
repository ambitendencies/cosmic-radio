// Shared harmonic state. Every layer asks Harmony which notes are "allowed"
// right now, so all of the layers stay consonant with one another.
// Chord changes happen every two bars; key and mode changes wait for the
// start of a phrase (a full progression), the way a composer would modulate.

import {
  MODES,
  PROGRESSIONS,
  chordOnDegree,
  degreeToMidi,
  pentatonicSubset,
  quantize,
  voiceLead,
} from '../music/theory.js';

const STEPS_PER_CHORD = 32; // two bars of 16ths

export class Harmony {
  constructor({ rootMidi = 50, modeIndex = 3, rand = Math.random } = {}) {
    this.rand = rand;
    this.rootMidi = rootMidi;
    this.modeIndex = modeIndex;
    this.pending = { rootMidi, modeIndex };
    this.tension = 0;
    this.progression = this.pickProgression();
    this.chordIndex = 0;
    this.voicing = [];
    this.listeners = new Set();
    this.computeChord();
  }

  get mode() {
    return MODES[this.modeIndex];
  }
  get intervals() {
    return this.mode.intervals;
  }
  get pentatonic() {
    return pentatonicSubset(this.intervals);
  }
  get degree() {
    return this.progression[this.chordIndex];
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Queue a key/mode change; applied at the next chord change (mode) or phrase start (key). */
  setTarget({ rootMidi, modeIndex, tension }) {
    if (rootMidi != null) this.pending.rootMidi = rootMidi;
    if (modeIndex != null) this.pending.modeIndex = modeIndex;
    if (tension != null) this.tension = tension;
  }

  pickProgression() {
    const options = PROGRESSIONS[this.mode.name];
    return options[Math.floor(this.rand() * options.length)];
  }

  /** Scheduler hook: call on every 16th step. Returns true if the chord changed. */
  tick(time, info) {
    if (info.step % STEPS_PER_CHORD !== 0) return false;
    const phraseStart = info.step % (STEPS_PER_CHORD * 4) === 0;
    const keyChanged = phraseStart && this.pending.rootMidi !== this.rootMidi;
    const modeChanged = this.pending.modeIndex !== this.modeIndex;
    if (keyChanged) this.rootMidi = this.pending.rootMidi;
    if (modeChanged) {
      this.modeIndex = this.pending.modeIndex;
      this.progression = this.pickProgression();
    }
    if (phraseStart || modeChanged || keyChanged) {
      this.chordIndex = 0;
      if (phraseStart && !modeChanged) this.progression = this.pickProgression();
    } else {
      this.chordIndex = (this.chordIndex + 1) % this.progression.length;
    }
    this.computeChord();
    for (const fn of this.listeners) fn(time, this);
    return true;
  }

  computeChord() {
    // Calm: lush add9 / 7th chords. Tense: suspended chords that "hang" unresolved.
    const t = this.tension;
    const opts = t > 0.6 ? { extensions: 4, sus: this.rand() < 0.5 ? 2 : 4 } : t > 0.3 ? { extensions: 4 } : { extensions: this.rand() < 0.5 ? 5 : 4 };
    let chord = chordOnDegree(this.rootMidi, this.intervals, this.degree, opts);
    if (opts.extensions === 5) chord = [chord[0], chord[1], chord[2], chord[4]]; // add9, no 7th: gentler
    this.chord = chord;
    this.voicing = voiceLead(chord, this.voicing, 50, 74);
  }

  /** Scale note by degree in a given octave offset relative to root. */
  scaleNote(degree, octave = 0) {
    return degreeToMidi(this.rootMidi + 12 * octave, this.intervals, degree);
  }

  /** Chord tones spread across a register. */
  chordTones(lo = 60, hi = 84) {
    const pcs = new Set(this.chord.map((m) => ((m % 12) + 12) % 12));
    const out = [];
    for (let m = lo; m <= hi; m++) if (pcs.has(((m % 12) + 12) % 12)) out.push(m);
    return out;
  }

  /** Pentatonic notes (always safe to play over any chord) in a register. */
  safeNotes(lo = 60, hi = 84) {
    const pcs = new Set(this.pentatonic.map((i) => (this.rootMidi + i) % 12));
    const out = [];
    for (let m = lo; m <= hi; m++) if (pcs.has(((m % 12) + 12) % 12)) out.push(m);
    return out;
  }

  quantize(midi) {
    return quantize(midi, this.rootMidi, this.intervals);
  }
}
