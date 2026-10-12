// Plausible synthetic space weather for offline use, demos, and tests.
// Each quantity is a mean-reverting random walk (Ornstein–Uhlenbeck), with
// occasional solar flares and CME arrivals layered on top. Time runs faster
// than real life so changes are audible within a listening session.

import { xrayClass } from './parsers.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export class SpaceWeatherSimulator {
  constructor({ seed = Date.now(), timeScale = 30 } = {}) {
    this.rand = mulberry32(seed);
    this.timeScale = timeScale; // simulated seconds per real second
    this.v = { speed: 420, logDensity: Math.log(5), temperature: 90_000, bz: 1, by: 0, bt: 5, logXray: Math.log10(2e-7), logProton: Math.log10(0.3), kp: 2 };
    this.flare = null; // { peak, t, rise, decay }
    this.cme = null; // { t, duration }
    this.xrayHistory = [];
  }

  ou(key, mean, theta, sigma, dt) {
    this.v[key] += theta * (mean - this.v[key]) * dt + sigma * Math.sqrt(dt) * gauss(this.rand);
  }

  /** Advance by `dtReal` real seconds and return a SpaceState patch. */
  step(dtReal = 2) {
    const dt = (dtReal * this.timeScale) / 3600; // in simulated hours
    const r = this.rand;

    // Rare events (rates per simulated hour).
    if (!this.flare && r() < 0.15 * dt) {
      const cls = r();
      const peak = cls < 0.6 ? -5.6 + r() * 0.6 : cls < 0.93 ? -5 + r() : -4 + r() * 0.5; // C, M, X
      this.flare = { peak, t: 0, rise: 0.08 + r() * 0.1, decay: 0.3 + r() * 0.5 };
    }
    if (!this.cme && r() < 0.03 * dt) this.cme = { t: 0, duration: 6 + r() * 10 };

    const storm = this.cme ? Math.sin(Math.min(1, this.cme.t / this.cme.duration) * Math.PI) : 0;

    this.ou('speed', 400 + storm * 300, 0.15, 25, dt);
    this.ou('logDensity', Math.log(5 + storm * 15), 0.3, 0.25, dt);
    this.ou('temperature', 80_000 + storm * 300_000, 0.2, 15_000, dt);
    this.ou('bz', 0.5 - storm * 12, 0.6, 2.5, dt);
    this.ou('by', 0, 0.6, 2.5, dt);
    this.ou('bt', 5 + storm * 15, 0.4, 1.2, dt);
    this.ou('logProton', Math.log10(0.3) + storm * 1.5, 0.3, 0.1, dt);

    let xrayTarget = Math.log10(2e-7);
    if (this.flare) {
      const f = this.flare;
      f.t += dt;
      const env = f.t < f.rise ? f.t / f.rise : Math.exp(-(f.t - f.rise) / f.decay);
      xrayTarget = Math.max(xrayTarget, xrayTarget + (f.peak - xrayTarget) * env);
      if (f.t > f.rise + f.decay * 5) this.flare = null;
      this.v.logXray = xrayTarget + 0.02 * gauss(r);
    } else {
      this.ou('logXray', xrayTarget, 0.5, 0.15, dt);
    }

    // Kp responds to southward Bz × speed (a crude coupling function).
    const coupling = Math.max(0, -this.v.bz) * (this.v.speed / 400);
    this.ou('kp', Math.min(9, 1.5 + coupling * 0.45), 0.5, 0.3, dt);
    this.v.kp = Math.min(9, Math.max(0, this.v.kp));
    this.v.speed = Math.max(250, Math.min(950, this.v.speed));
    this.v.bt = Math.max(Math.abs(this.v.bz), this.v.bt);

    if (this.cme) {
      this.cme.t += dt;
      if (this.cme.t > this.cme.duration) this.cme = null;
    }

    const flux = 10 ** this.v.logXray;
    this.xrayHistory.push(flux);
    if (this.xrayHistory.length > 60) this.xrayHistory.shift();

    return {
      solarWind: {
        speed: this.v.speed,
        density: Math.exp(this.v.logDensity),
        temperature: Math.max(10_000, this.v.temperature),
        bz: this.v.bz,
        by: this.v.by,
        bt: this.v.bt,
      },
      kp: Math.round(this.v.kp * 3) / 3, // Kp is reported in thirds
      xray: { flux, class: xrayClass(flux), history: [...this.xrayHistory] },
      protons: { flux: 10 ** this.v.logProton },
    };
  }

  /** Force an event (for the UI's "demo a flare/storm" buttons). */
  trigger(kind) {
    if (kind === 'flare') this.flare = { peak: -4.3, t: 0, rise: 0.08, decay: 0.4 };
    if (kind === 'storm') this.cme = { t: 0, duration: 8 };
  }
}
