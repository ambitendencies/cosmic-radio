// SpaceState → MusicalParams. This is the composer's brain: it decides
// what each measurement *means* musically. Pure and deterministic apart
// from the hysteresis carried in `prev`.

import { MODES, clamp, lerp, norm, logNorm, fifthsRoot, noteName } from './theory.js';

/**
 * @typedef {Object} MusicalParams
 * @property {number} rootStep     circle-of-fifths step (0 = D)
 * @property {number} rootMidi
 * @property {number} modeIndex    index into MODES (0 brightest … 5 darkest)
 * @property {string} modeName
 * @property {number} tempo        BPM
 * @property {number} density      0..1 note probability
 * @property {number} brightness   0..1 filter openness
 * @property {number} tension      0..1 harmonic colour / detune
 * @property {number} energy       0..1 X-ray activity
 * @property {number} turbulence   0..1 proton flux
 * @property {number} field        0..1 magnetic field strength
 * @property {number} space        0..1 reverb size / wetness
 * @property {Array<{source:string,value:string,effect:string}>} explain
 */

const MODE_HYSTERESIS = 0.65;
const ROOT_HYSTERESIS = 0.7;

/** @returns {MusicalParams} */
export function mapStateToParams(state, prev = null) {
  const sw = state.solarWind;

  // Mode: northward Bz (+) is calm and bright; southward (−) couples to
  // Earth's field, drives storms, and darkens the harmony.
  const bzBright = norm(sw.bz, -10, 6);
  const modeContinuous = (1 - bzBright) * (MODES.length - 1);
  let modeIndex = Math.round(modeContinuous);
  if (prev && Math.abs(modeContinuous - prev.modeIndex) < MODE_HYSTERESIS) modeIndex = prev.modeIndex;

  // Key: Kp walks the circle of fifths. Integer steps, so related keys follow each other.
  const kpStep = clamp(state.kp, 0, 9);
  let rootStep = Math.round(kpStep);
  if (prev && Math.abs(kpStep - prev.rootStep) < ROOT_HYSTERESIS) rootStep = prev.rootStep;
  const rootMidi = fifthsRoot(rootStep);

  const windNorm = norm(sw.speed, 280, 800);
  const tempo = Math.round(lerp(56, 96, windNorm) * 10) / 10;
  const density = lerp(0.18, 0.8, logNorm(sw.density, 0.5, 40));
  const brightness = clamp(0.6 * windNorm + 0.4 * logNorm(sw.temperature, 2e4, 1e6));
  const tension = clamp(norm(-sw.bz, 0, 15) * 0.7 + norm(state.kp, 3, 8) * 0.5);
  const energy = logNorm(state.xray.flux, 1e-8, 1e-4);
  const turbulence = logNorm(state.protons.flux, 0.1, 1000);
  const field = norm(sw.bt, 2, 25);
  const space = lerp(0.35, 0.85, norm(state.kp, 0, 8));
  const modeName = MODES[modeIndex].name;

  const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const explain = [
    { source: 'Solar wind speed', value: `${fmt(sw.speed)} km/s`, effect: `Tempo ${fmt(tempo)} BPM` },
    { source: 'Proton density', value: `${fmt(sw.density, 1)} p/cm³`, effect: `Note density ${fmt(density * 100)}%` },
    { source: 'Plasma temperature', value: `${fmt(sw.temperature / 1000)}k K`, effect: `Brightness ${fmt(brightness * 100)}%` },
    { source: 'Magnetic field Bz', value: `${fmt(sw.bz, 1)} nT`, effect: `${modeName} mode` },
    { source: 'Field strength Bt', value: `${fmt(sw.bt, 1)} nT`, effect: `Drone weight ${fmt(field * 100)}%` },
    { source: 'Kp index', value: fmt(state.kp, 1), effect: `Key of ${noteName(rootMidi).replace(/\d+$/, '')}, space ${fmt(space * 100)}%` },
    { source: 'X-ray flux', value: state.xray.class ?? '—', effect: `Shimmer ${fmt(energy * 100)}%` },
    { source: 'Proton flux ≥10 MeV', value: `${fmt(state.protons.flux, 2)} pfu`, effect: `Texture ${fmt(turbulence * 100)}%` },
  ];

  return { rootStep, rootMidi, modeIndex, modeName, tempo, density, brightness, tension, energy, turbulence, field, space, explain };
}
