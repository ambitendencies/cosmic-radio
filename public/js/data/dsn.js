// NASA Deep Space Network: a pure XML parser (no DOMParser, so it runs in Node
// and in tests) and a deterministic simulated fleet for offline use.
//
//   parseDsn(xmlText) -> Array<DsnLink>
//   class SimulatedDsn { constructor({ seed }); step(dtReal) -> Array<DsnLink> }
//
//   DsnLink = { id, name, station, dish, rangeKm, rtlt, dataRate, power, band }
//   Unknown numeric values are null (the feed uses "", "none" and "-1" for them).

import { mulberry32 } from './simulator.js';

const C_KM_S = 299792.458;

export const SPACECRAFT_NAMES = {
  VGR1: 'Voyager 1', VGR2: 'Voyager 2', JWST: 'JWST', JNO: 'Juno', MRO: 'MRO',
  M20: 'Perseverance', MSL: 'Curiosity', NHPC: 'New Horizons', PSYC: 'Psyche',
  LUCY: 'Lucy', EMM: 'Hope', MVN: 'MAVEN', M01O: 'Mars Odyssey', TGO: 'ExoMars TGO',
  MEX: 'Mars Express', SOHO: 'SOHO', ACE: 'ACE', WIND: 'Wind', DSCO: 'DSCOVR',
  STA: 'STEREO-A', SPP: 'Parker Solar Probe', ORX: 'OSIRIS-APEX', BEPI: 'BepiColombo',
  JUCE: 'JUICE', EURC: 'Europa Clipper', KPLO: 'Danuri', CH3: 'Chandrayaan-3',
};

const STATION_NAMES = { gdscc: 'Goldstone', mdscc: 'Madrid', cdscc: 'Canberra' };
const IGNORED = new Set(['', 'DSN', 'TEST', 'RFC', 'NONE', 'UNKNOWN', 'N/A']);

export const friendlyName = (id) => SPACECRAFT_NAMES[String(id).toUpperCase()] || String(id);

function attrs(str) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str))) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

/** A positive finite number, or null for ""/none/-1/garbage. */
function num(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /^(none|null|nan)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n !== -1 ? n : null;
}
const positive = (v) => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

export function parseDsn(xml) {
  if (typeof xml !== 'string' || !xml) return [];
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const links = new Map(); // id -> link, deduped by strongest power
  let station = '';
  let dish = null;

  const closeDish = () => {
    if (!dish) return;
    for (const sig of dish.signals) {
      const id = sig.spacecraft.trim();
      if (IGNORED.has(id.toUpperCase())) continue;
      const target =
        dish.targets.find((t) => (t.name || '').toUpperCase() === id.toUpperCase()) ||
        dish.targets.find((t) => String(t.id) === String(sig.spacecraftID)) ||
        (dish.targets.length === 1 ? dish.targets[0] : null);
      const range = target ? positive(target.downlegRange) ?? positive(target.uplegRange) : null;
      let rtlt = target ? positive(target.rtlt) : null;
      if (rtlt == null && range != null) rtlt = (2 * range) / C_KM_S;
      const link = {
        id,
        name: friendlyName(id),
        station,
        dish: dish.name,
        rangeKm: range,
        rtlt,
        dataRate: positive(sig.dataRate),
        power: num(sig.power),
        band: sig.band && sig.band.toLowerCase() !== 'none' ? sig.band : null,
      };
      const prev = links.get(id);
      const p = link.power ?? -Infinity;
      if (!prev || p > (prev.power ?? -Infinity)) links.set(id, link);
    }
    dish = null;
  };

  let m;
  while ((m = tagRe.exec(xml))) {
    const [, closing, tag, body, selfClose] = m;
    if (closing) {
      if (tag === 'dish') closeDish();
      continue;
    }
    if (tag === 'station') {
      closeDish();
      const a = attrs(body);
      station = a.friendlyName || STATION_NAMES[a.name] || a.name || '';
    } else if (tag === 'dish') {
      closeDish();
      dish = { name: attrs(body).name || '', signals: [], targets: [] };
      if (selfClose) closeDish();
    } else if (dish && tag === 'downSignal') {
      const a = attrs(body);
      const type = (a.signalType || '').toLowerCase();
      if (a.active === 'true' && type && type !== 'none' && a.spacecraft) dish.signals.push(a);
    } else if (dish && tag === 'target') {
      dish.targets.push(attrs(body));
    }
  }
  closeDish();
  return [...links.values()];
}

// ---------------------------------------------------------------------------
// Simulated fleet

const FLEET = [
  { id: 'VGR1', range: 2.5e10, drift: 17, rate: [160, 160], band: 'X', dbm: -158 },
  { id: 'VGR2', range: 2.1e10, drift: 15, rate: [160, 160], band: 'X', dbm: -157 },
  { id: 'NHPC', range: 9.0e9, drift: 14, rate: [1000, 2000], band: 'X', dbm: -153 },
  { id: 'JNO', range: 8.0e8, drift: 5, rate: [18000, 60000], band: 'X', dbm: -140 },
  { id: 'JWST', range: 1.5e6, drift: 0.01, rate: [2e6, 3.5e6], band: 'Ka', dbm: -118 },
  { id: 'MRO', range: 2.4e8, drift: 8, rate: [0.5e6, 6e6], band: 'X', dbm: -132 },
  { id: 'M20', range: 2.2e8, drift: 7, rate: [2000, 2.5e6], band: 'X', dbm: -135 },
  { id: 'PSYC', range: 3.5e8, drift: 9, rate: [5000, 250000], band: 'X', dbm: -145 },
  { id: 'LUCY', range: 6.5e8, drift: 6, rate: [1000, 20000], band: 'X', dbm: -148 },
  { id: 'SPP', range: 1.6e8, drift: 10, rate: [1000, 167000], band: 'X', dbm: -138 },
  { id: 'MVN', range: 2.3e8, drift: 7, rate: [50000, 2e6], band: 'X', dbm: -133 },
];
const STATIONS = ['Goldstone', 'Madrid', 'Canberra'];

export class SimulatedDsn {
  constructor({ seed = 1 } = {}) {
    this.rand = mulberry32(seed);
    this.t = 0;
    this.craft = FLEET.map((f) => {
      const rate = f.rate[0] === f.rate[1] ? f.rate[0] : Math.exp(Math.log(f.rate[0]) + this.rand() * Math.log(f.rate[1] / f.rate[0]));
      return {
        ...f,
        rangeNow: f.range * (0.97 + this.rand() * 0.06),
        rateNow: Math.round(rate),
        active: false,
        until: 0,
        nextStart: 0,
        station: STATIONS[Math.floor(this.rand() * 3)],
        dishNo: 14 + Math.floor(this.rand() * 40),
        jitter: 0,
      };
    });
    // Start with three passes already under way.
    const order = this.craft.map((c, i) => [this.rand(), i]).sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < 3; k++) this.begin(this.craft[order[k][1]], this.rand() * 120);
    for (const c of this.craft) if (!c.active) c.nextStart = 60 + this.rand() * 400;
  }

  begin(c, elapsed = 0) {
    c.active = true;
    c.until = this.t + 300 + this.rand() * 540 - elapsed; // 5 to 14 minutes
    c.station = STATIONS[Math.floor(this.rand() * 3)];
    c.dishNo = [14, 15, 24, 25, 26, 34, 35, 36, 43, 45, 54, 55, 63, 65][Math.floor(this.rand() * 14)];
    if (c.rate[0] !== c.rate[1]) {
      c.rateNow = Math.round(Math.exp(Math.log(c.rate[0]) + this.rand() * Math.log(c.rate[1] / c.rate[0])));
    }
  }

  step(dt = 2) {
    this.t += dt;
    let active = 0;
    for (const c of this.craft) {
      c.rangeNow += c.drift * dt * 60; // km; tiny relative drift
      if (c.active && this.t >= c.until && this.craft.filter((x) => x.active).length > 2) {
        c.active = false;
        c.nextStart = this.t + 90 + this.rand() * 300;
      }
      if (c.active) active++;
    }
    for (const c of this.craft) {
      if (!c.active && active < 5 && this.t >= c.nextStart && (active < 2 || this.rand() < 0.01 * dt)) {
        this.begin(c);
        active++;
      }
    }
    return this.craft.filter((c) => c.active).map((c) => {
      c.jitter += (this.rand() - 0.5) * 0.4 - c.jitter * 0.1;
      return {
        id: c.id,
        name: friendlyName(c.id),
        station: c.station,
        dish: `DSS${c.dishNo}`,
        rangeKm: c.rangeNow,
        rtlt: (2 * c.rangeNow) / C_KM_S,
        dataRate: c.rateNow,
        power: c.dbm + c.jitter,
        band: c.band,
      };
    });
  }
}
