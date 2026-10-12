// The normalized snapshot of "what space is doing right now" that the
// music mapper consumes. Every field always has a sane value so the audio
// never sees NaN; `sources` records where each part came from.

export function defaultState() {
  return {
    time: Date.now(),
    solarWind: { speed: 400, density: 5, temperature: 100_000, bz: 0, by: 0, bt: 5 },
    kp: 2,
    xray: { flux: 1e-7, class: 'B1.0', history: [] },
    protons: { flux: 0.3 },
    /** @type {Array<{id:string,name:string,station:string,dish:string,rangeKm:number,rtlt:number,dataRate:number,power:number,band:string}>} */
    dsn: [],
    sources: { plasma: 'sim', mag: 'sim', kp: 'sim', xray: 'sim', protons: 'sim', dsn: 'sim' },
  };
}

/** Merge a partial update into state, keeping old values for anything non-finite. */
export function mergeState(state, patch) {
  const next = structuredClone(state);
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && next[k] && typeof next[k] === 'object' && !Array.isArray(next[k])) {
      for (const [kk, vv] of Object.entries(v)) {
        if (typeof vv === 'number' && !Number.isFinite(vv)) continue;
        next[k][kk] = vv;
      }
    } else if (!(typeof v === 'number' && !Number.isFinite(v))) {
      next[k] = v;
    }
  }
  next.time = Date.now();
  return next;
}
