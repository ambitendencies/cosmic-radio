// Instrument panel: every measurement, which instrument it came from, whether
// it is live or simulated, a tiny history sparkline, and what it does to the
// music. Plus a Deep Space Network section listing spacecraft on the line.
// The DOM is built once and then only text/attributes are touched.

const HISTORY = 90;
const AU_KM = 149_597_870.7;
const C_KM_S = 299_792.458;

// One entry per params.explain row (fixed order), grouped by instrument.
const GROUPS = [
  { title: 'Solar wind', sub: 'DSCOVR / ACE at L1', rows: [
    { src: 'plasma', get: (s) => s.solarWind?.speed },
    { src: 'plasma', get: (s) => s.solarWind?.density },
    { src: 'plasma', get: (s) => s.solarWind?.temperature },
  ] },
  { title: 'Magnetic field', sub: 'DSCOVR magnetometer', rows: [
    { src: 'mag', get: (s) => s.solarWind?.bz },
    { src: 'mag', get: (s) => s.solarWind?.bt },
  ] },
  { title: 'Geomagnetic', sub: 'Ground network', rows: [
    { src: 'kp', get: (s) => s.kp },
  ] },
  { title: 'GOES X-ray', sub: 'Solar flares', rows: [
    { src: 'xray', get: (s) => log10(s.xray?.flux) },
  ] },
  { title: 'GOES protons', sub: 'Energetic particles', rows: [
    { src: 'protons', get: (s) => log10(s.protons?.flux) },
  ] },
];

const SVGNS = 'http://www.w3.org/2000/svg';

function log10(v) {
  return Number.isFinite(v) && v > 0 ? Math.log10(v) : NaN;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

export class Panel {
  constructor(root) {
    this.root = root;
    this.root.textContent = '';
    this.root.classList.add('panel');
    this.rows = [];
    this.craftRows = new Map();

    const list = el('div', 'readouts');
    let n = 0;
    for (const g of GROUPS) {
      const sec = el('section', 'group');
      const head = el('div', 'group-head');
      head.append(el('span', 'group-title', g.title), el('span', 'group-sub', g.sub));
      sec.append(head);
      for (const def of g.rows) {
        const row = el('div', 'readout');
        const src = el('span', 'src');
        const name = el('span', 'name');
        const tag = el('span', 'tag sim', 'sim');
        src.append(name, tag);
        const val = el('span', 'val');
        const svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('class', 'spark');
        svg.setAttribute('viewBox', '0 0 100 24');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        const line = document.createElementNS(SVGNS, 'polyline');
        line.setAttribute('fill', 'none');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(line);
        const dot = document.createElementNS(SVGNS, 'circle');
        dot.setAttribute('r', '1.8');
        dot.setAttribute('class', 'spark-dot');
        dot.setAttribute('cx', '100');
        dot.setAttribute('cy', '12');
        dot.style.display = 'none';
        svg.append(dot);
        const fx = el('span', 'fx');
        row.append(src, val, svg, fx);
        sec.append(row);
        this.rows.push({ def, name, tag, val, fx, line, dot, hist: new Float32Array(HISTORY), count: 0, head: 0, cache: '' });
        n++;
      }
      list.append(sec);
    }
    this.list = list;

    const dsn = el('section', 'group dsn');
    const head = el('div', 'group-head');
    this.dsnTag = el('span', 'tag sim', 'sim');
    head.append(el('span', 'group-title', 'Deep Space Network'), el('span', 'group-sub', 'Spacecraft talking to Earth'), this.dsnTag);
    this.dsnList = el('div', 'dsn-list');
    this.dsnEmpty = el('div', 'dsn-empty', 'No spacecraft on the line right now');
    dsn.append(head, this.dsnList, this.dsnEmpty);
    this.dsnSection = dsn;

    this.root.append(list, dsn);
  }

  update(state, params) {
    if (!state) return;
    const explain = params?.explain ?? [];
    const sources = state.sources ?? {};
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const ex = explain[i];
      if (ex) {
        setText(r.name, ex.source);
        setText(r.val, ex.value);
        setText(r.fx, '→ ' + ex.effect);
      }
      const live = sources[r.def.src] === 'live';
      const cls = live ? 'tag live' : 'tag sim';
      if (r.tag.className !== cls) r.tag.className = cls;
      setText(r.tag, live ? 'live' : 'sim');
      this._push(r, Number(r.def.get(state)));
    }

    // Section badge for DSN
    const dl = sources.dsn === 'live';
    const dcls = dl ? 'tag live' : 'tag sim';
    if (this.dsnTag.className !== dcls) this.dsnTag.className = dcls;
    setText(this.dsnTag, dl ? 'live' : 'sim');

    this._updateDsn(Array.isArray(state.dsn) ? state.dsn : []);
  }

  _push(r, v) {
    if (Number.isFinite(v)) {
      r.hist[r.head] = v;
      r.head = (r.head + 1) % HISTORY;
      if (r.count < HISTORY) r.count++;
    }
    const n = r.count;
    if (n < 2) {
      r.line.setAttribute('points', '');
      r.dot.style.display = 'none';
      return;
    }
    let min = Infinity;
    let max = -Infinity;
    const start = (r.head - n + HISTORY) % HISTORY;
    for (let i = 0; i < n; i++) {
      const x = r.hist[(start + i) % HISTORY];
      if (x < min) min = x;
      if (x > max) max = x;
    }
    const span = max - min || 1;
    const flat = max - min < 1e-9;
    let pts = '';
    let lastY = 12;
    for (let i = 0; i < n; i++) {
      const x = r.hist[(start + i) % HISTORY];
      const px = (i / (n - 1)) * 100;
      lastY = flat ? 12 : 21 - ((x - min) / span) * 18;
      pts += px.toFixed(1) + ',' + lastY.toFixed(1) + ' ';
    }
    r.line.setAttribute('points', pts);
    r.dot.setAttribute('cy', lastY.toFixed(1));
    r.dot.style.display = '';
  }

  _updateDsn(list) {
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const id = String(d.id ?? d.name ?? i);
      seen.add(id);
      let row = this.craftRows.get(id);
      if (!row) {
        const node = el('div', 'craft');
        const top = el('div', 'craft-top');
        const name = el('span', 'craft-name');
        const station = el('span', 'craft-station');
        top.append(name, station);
        const meta = el('div', 'craft-meta');
        const fx = el('div', 'craft-fx');
        node.append(top, meta, fx);
        row = { node, name, station, meta, fx };
        this.craftRows.set(id, row);
      }
      const km = d.rangeKm == null ? NaN : Number(d.rangeKm);
      setText(row.name, String(d.name ?? id));
      setText(row.station, [d.station, d.dish].filter(Boolean).join(' · '));
      const rate = d.dataRate == null ? NaN : Number(d.dataRate);
      setText(row.meta, `${fmtDistance(km)} · ${fmtRate(rate)}${d.band ? ' · ' + d.band + '-band' : ''}`);
      setText(row.fx, '→ ' + describeCraft(km, rate));
      // keep DOM order equal to data order without rebuilding
      if (this.dsnList.children[i] !== row.node) this.dsnList.insertBefore(row.node, this.dsnList.children[i] ?? null);
    }
    for (const [id, row] of this.craftRows) {
      if (!seen.has(id)) {
        row.node.remove();
        this.craftRows.delete(id);
      }
    }
    this.dsnEmpty.style.display = list.length ? 'none' : '';
  }
}

export function fmtDistance(km) {
  if (!Number.isFinite(km) || km <= 0) return '—';
  if (km < 2_000_000) return `${Math.round(km).toLocaleString('en-US')} km`;
  const au = km / AU_KM;
  const auTxt = au >= 10 ? au.toFixed(0) : au.toFixed(au >= 1 ? 1 : 2);
  return km > 5_000_000 && km >= 0.5 * AU_KM ? `${auTxt} AU · ${fmtLightTime(km / C_KM_S)} light-time` : `${auTxt} AU`;
}

function fmtLightTime(s) {
  if (s >= 3600) return `${Math.round(s / 3600)} h`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${Math.round(s)} s`;
}

export function fmtRate(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return '—';
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(bps >= 1e4 ? 0 : 1)} kbps`;
  return `${Math.round(bps)} bps`;
}

function describeCraft(km, bps) {
  if (!Number.isFinite(km)) return Number.isFinite(bps) ? 'steady notes, medium echoes' : 'listening for a signal';
  const far = km > 1e9;
  const mid = km > 3e7;
  const slow = !(bps >= 2000);
  if (far && slow) return 'lower register, sparse notes, long echoes';
  if (far) return 'lower register, steady notes, long echoes';
  if (mid) return slow ? 'middle register, sparse notes, medium echoes' : 'middle register, flowing notes, medium echoes';
  return slow ? 'higher register, gentle notes, short echoes' : 'higher register, busy bright notes, short echoes';
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
