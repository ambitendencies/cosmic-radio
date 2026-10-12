// Pure parsers: raw NOAA SWPC payloads → pieces of a normalized SpaceState.
// SWPC serves two shapes: "products" are arrays of arrays with a header row,
// "json" endpoints are arrays of objects. Kp has switched between both over
// the years, so every parser accepts either.

export function rowsToObjects(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) {
    const [header, ...rows] = raw;
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  }
  return raw.filter((r) => r && typeof r === 'object');
}

export function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = typeof v === 'number' ? v : parseFloat(v);
  // SWPC uses sentinels like -9999.9 or -1e5 for missing data.
  return Number.isFinite(n) && n > -9990 ? n : NaN;
}

export function parseTime(t) {
  if (!t) return NaN;
  // Product time tags look like "2026-10-12 03:15:00.000" (UTC, no zone).
  const s = String(t).replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

/** Latest row where every listed field is a finite number. */
function latestValid(rows, fields) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const vals = fields.map((f) => num(rows[i][f]));
    if (vals.every(Number.isFinite)) return { row: rows[i], vals };
  }
  return null;
}

/** Mean of a field across the trailing `n` valid rows (smooths sensor noise). */
function trailingMean(rows, field, n) {
  const out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < n; i--) {
    const v = num(rows[i][field]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out.length ? out.reduce((a, b) => a + b, 0) / out.length : NaN;
}

export function parsePlasma(raw) {
  const rows = rowsToObjects(raw);
  const hit = latestValid(rows, ['density', 'speed']);
  if (!hit) return null;
  return {
    time: parseTime(hit.row.time_tag),
    density: trailingMean(rows, 'density', 5),
    speed: trailingMean(rows, 'speed', 5),
    temperature: num(hit.row.temperature),
  };
}

export function parseMag(raw) {
  const rows = rowsToObjects(raw);
  const hit = latestValid(rows, ['bz_gsm', 'bt']);
  if (!hit) return null;
  return {
    time: parseTime(hit.row.time_tag),
    bz: trailingMean(rows, 'bz_gsm', 5),
    by: num(hit.row.by_gsm),
    bt: trailingMean(rows, 'bt', 5),
  };
}

export function parseKp(raw) {
  const rows = rowsToObjects(raw);
  const key = rows.length && ('Kp' in rows[0] ? 'Kp' : 'kp_index' in rows[0] ? 'kp_index' : 'kp');
  const hit = latestValid(rows, [key]);
  if (!hit) return null;
  return { time: parseTime(hit.row.time_tag), kp: hit.vals[0] };
}

export function xrayClass(flux) {
  if (!Number.isFinite(flux) || flux <= 0) return '—';
  const bands = [['X', 1e-4], ['M', 1e-5], ['C', 1e-6], ['B', 1e-7], ['A', 1e-8]];
  for (const [letter, base] of bands) {
    if (flux >= base) return `${letter}${(flux / base).toFixed(1)}`;
  }
  return `A${(flux / 1e-8).toFixed(1)}`;
}

export function parseXray(raw) {
  // Long channel (0.1–0.8 nm) is the one flare classes are defined on.
  const rows = rowsToObjects(raw).filter((r) => !r.energy || r.energy === '0.1-0.8nm');
  const hit = latestValid(rows, ['flux']);
  if (!hit) return null;
  const history = rows
    .slice(-60)
    .map((r) => num(r.flux))
    .filter((v) => Number.isFinite(v) && v > 0);
  return {
    time: parseTime(hit.row.time_tag),
    flux: hit.vals[0],
    class: xrayClass(hit.vals[0]),
    history,
  };
}

export function parseProtons(raw) {
  const rows = rowsToObjects(raw).filter((r) => !r.energy || r.energy === '>=10 MeV');
  const hit = latestValid(rows, ['flux']);
  if (!hit) return null;
  return { time: parseTime(hit.row.time_tag), flux: hit.vals[0] };
}
