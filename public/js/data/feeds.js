// DataHub: polls every feed, falls back gracefully, and emits a full
// SpaceState on every tick.
//
// Fetch order per feed: local proxy (/api/feeds/:id), then the upstream URL
// directly (works for NOAA, which sends CORS headers, on static hosting),
// then the simulator. A feed that fails is simulated until it recovers.

import { FEEDS, POLL_INTERVAL_MS } from './feedConfig.js';
import { parsePlasma, parseMag, parseKp, parseXray, parseProtons } from './parsers.js';
import { parseDsn, SimulatedDsn } from './dsn.js';
import { SpaceWeatherSimulator } from './simulator.js';
import { defaultState, mergeState } from './state.js';

const PARSERS = {
  plasma: (raw) => ({ solarWind: pick(parsePlasma(raw), ['speed', 'density', 'temperature']) }),
  mag: (raw) => ({ solarWind: pick(parseMag(raw), ['bz', 'by', 'bt']) }),
  kp: (raw) => {
    const p = parseKp(raw);
    return p ? { kp: p.kp } : null;
  },
  xray: (raw) => {
    const p = parseXray(raw);
    return p ? { xray: { flux: p.flux, class: p.class, history: p.history } } : null;
  },
  protons: (raw) => {
    const p = parseProtons(raw);
    return p ? { protons: { flux: p.flux } } : null;
  },
  dsn: (raw) => {
    const links = parseDsn(raw);
    return links.length ? { dsn: links } : null;
  },
};

// Which simulated fields stand in for each feed while it's down.
const SIM_FIELDS = {
  plasma: (p) => ({ solarWind: pick(p.solarWind, ['speed', 'density', 'temperature']) }),
  mag: (p) => ({ solarWind: pick(p.solarWind, ['bz', 'by', 'bt']) }),
  kp: (p) => ({ kp: p.kp }),
  xray: (p) => ({ xray: p.xray }),
  protons: (p) => ({ protons: p.protons }),
};

function pick(obj, keys) {
  if (!obj) return null;
  return Object.fromEntries(keys.filter((k) => Number.isFinite(obj[k])).map((k) => [k, obj[k]]));
}

export class DataHub extends EventTarget {
  constructor({ mode = 'auto', tickMs = 2000, seed } = {}) {
    super();
    this.mode = mode; // 'auto' | 'sim'
    this.tickMs = tickMs;
    this.state = defaultState();
    this.sim = new SpaceWeatherSimulator({ seed });
    this.dsnSim = new SimulatedDsn({ seed });
    this.live = Object.fromEntries(Object.keys(FEEDS).map((k) => [k, false]));
    this.route = {}; // feed id -> 'proxy' | 'direct'
    this.timers = [];
  }

  async start() {
    this.stop();
    this.tick();
    if (this.mode === 'auto') await this.pollAll();
    this.timers.push(setInterval(() => this.tick(), this.tickMs));
    this.timers.push(setInterval(() => this.mode === 'auto' && this.pollAll(), POLL_INTERVAL_MS));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'sim') Object.keys(this.live).forEach((k) => (this.live[k] = false));
    else this.pollAll();
    this.tick();
  }

  trigger(kind) {
    this.sim.trigger(kind);
  }

  /** Advance simulators and fill in whatever isn't live. */
  tick() {
    const simPatch = this.sim.step(this.tickMs / 1000);
    const dsnSim = this.dsnSim.step(this.tickMs / 1000);
    let next = this.state;
    for (const [id, toPatch] of Object.entries(SIM_FIELDS)) {
      if (!this.live[id]) next = mergeState(next, toPatch(simPatch));
    }
    if (!this.live.dsn) next = mergeState(next, { dsn: dsnSim });
    next.sources = Object.fromEntries(Object.keys(FEEDS).map((k) => [k, this.live[k] ? 'live' : 'sim']));
    this.state = next;
    this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
  }

  async pollAll() {
    await Promise.allSettled(Object.keys(FEEDS).map((id) => this.poll(id)));
    this.dispatchEvent(new CustomEvent('sources', { detail: { ...this.live } }));
  }

  async poll(id) {
    try {
      const raw = await this.fetchFeed(id);
      const patch = PARSERS[id](raw);
      if (!patch || Object.values(patch).every((v) => v == null)) throw new Error('no usable data');
      this.state = mergeState(this.state, patch);
      this.live[id] = this.mode === 'auto';
    } catch (err) {
      if (this.live[id]) console.warn(`[cosmic-radio] ${id} feed lost, simulating:`, err.message);
      this.live[id] = false;
    }
  }

  async fetchFeed(id) {
    const feed = FEEDS[id];
    const read = (res) => (feed.type === 'json' ? res.json() : res.text());
    const attempts = this.route[id] === 'direct' ? ['direct', 'proxy'] : ['proxy', 'direct'];
    let lastErr;
    for (const how of attempts) {
      try {
        const url = how === 'proxy' ? `api/feeds/${id}` : feed.cacheBust ? `${feed.url}?r=${Date.now()}` : feed.url;
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
        if (!res.ok) throw new Error(`${how} ${res.status}`);
        const data = await read(res);
        this.route[id] = how;
        return data;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
}
