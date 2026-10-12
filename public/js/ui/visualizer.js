// Background visualizer: a calm, slowly evolving space scene.
//   starfield (3 depth layers, drift follows solar-wind speed)
//   central sun glow (breathes with X-ray energy, flashes on class jumps)
//   aurora curtains along the top edge (Kp-driven, hue follows the mode)
//   log-frequency spectrum ring around the sun (when the audio engine is attached)
//   Deep Space Network craft orbiting the center with inward downlink pulses
// Everything is interpolated; nothing jumps. No per-frame allocations in loops
// (a handful of gradients per frame are the only objects created).

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const finite = (v, d) => (Number.isFinite(v) ? v : d);

const STARS = 280;
const RING_POINTS = 120;
const AURORA_COLS = 160;
const MAX_DSN = 24;

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.raf = 0;
    this.running = false;
    this.last = 0;
    this.time = 0;
    this.engine = null;
    this.freq = null;
    this.reduced = false;
    this.mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduced = !!this.mq?.matches;

    // smoothed values (current) and their targets
    this.cur = { wind: 400, energy: 0.1, kp: 2, hue: 160, flash: 0, ring: 0, mode: 0 };
    this.tgt = { wind: 400, energy: 0.1, kp: 2, hue: 160 };
    this.prevXray = null;

    // stars: x,y in 0..1, z = depth 0.2..1, twinkle phase
    this.sx = new Float32Array(STARS);
    this.sy = new Float32Array(STARS);
    this.sz = new Float32Array(STARS);
    this.sp = new Float32Array(STARS);
    for (let i = 0; i < STARS; i++) {
      this.sx[i] = Math.random();
      this.sy[i] = Math.random();
      const layer = i % 3;
      this.sz[i] = 0.2 + layer * 0.35 + Math.random() * 0.1;
      this.sp[i] = Math.random() * TAU;
    }

    // spectrum ring
    this.ringVals = new Float32Array(RING_POINTS);
    this.ringLo = new Uint16Array(RING_POINTS);
    this.ringHi = new Uint16Array(RING_POINTS);
    this.ringXs = new Float32Array(RING_POINTS + 1);
    this.ringYs = new Float32Array(RING_POINTS + 1);

    // DSN craft, keyed by id; slots are reused
    this.craft = new Map();
    this.craftList = [];
    this.craftSeen = 0;

    this._onResize = () => this.resize();
    this._onVis = () => (document.hidden ? this._halt() : this.running && this._kick());
    this._onMq = () => {
      this.reduced = !!this.mq.matches;
    };
    this.resize();
  }

  attach(engine) {
    this.engine = engine;
    const bins = engine?.analyser?.frequencyBinCount ?? 1024;
    this.freq = new Uint8Array(bins);
    const sr = engine?.ctx?.sampleRate ?? 48000;
    const binHz = sr / 2 / bins;
    const fLo = 45;
    const fHi = Math.min(12000, sr / 2 - 100);
    for (let i = 0; i < RING_POINTS; i++) {
      const a = fLo * Math.pow(fHi / fLo, i / RING_POINTS);
      const b = fLo * Math.pow(fHi / fLo, (i + 1) / RING_POINTS);
      const lo = clamp(Math.floor(a / binHz), 0, bins - 1);
      this.ringLo[i] = lo;
      this.ringHi[i] = clamp(Math.max(lo, Math.ceil(b / binHz)), 0, bins - 1);
    }
  }

  update(state, params) {
    if (!state) return;
    const t = this.tgt;
    t.wind = finite(state.solarWind?.speed, 400);
    t.kp = finite(state.kp, 2);
    if (params) {
      t.energy = finite(params.energy, 0.1);
      // 0 = brightest (teal-green ~165deg) .. 5 = darkest (violet-magenta ~295deg)
      t.hue = 165 + clamp(finite(params.modeIndex, 0) / 5) * 130;
    }
    // X-ray class jump -> soft flash
    const f = state.xray?.flux;
    if (Number.isFinite(f) && f > 0) {
      const lvl = Math.log10(f);
      if (this.prevXray !== null && lvl - this.prevXray > 0.3) this.cur.flash = Math.min(1, this.cur.flash + 0.5 + (lvl - this.prevXray) * 0.4);
      this.prevXray = lvl;
    }
    // DSN
    const list = Array.isArray(state.dsn) ? state.dsn : [];
    this.craftSeen++;
    for (let i = 0; i < list.length && i < MAX_DSN; i++) {
      const d = list[i];
      const id = String(d.id ?? d.name ?? i);
      let c = this.craft.get(id);
      if (!c) {
        const a = hash01(id) * TAU;
        c = { id, name: '', angle: a, r: 0.5, rT: 0.5, rate: 0, rateT: 0, hasRate: false, rT0: 0, alpha: 0, aT: 1, pulse: hash01(id + 'p'), speed: 0.4 + hash01(id + 's') * 0.4, seen: 0 };
        this.craft.set(id, c);
        this.craftList.push(c);
      }
      c.name = String(d.name ?? id);
      const hasKm = d.rangeKm != null && Number.isFinite(Number(d.rangeKm)) && Number(d.rangeKm) > 0;
      if (hasKm) c.rT = clamp((Math.log10(Math.max(1e3, Number(d.rangeKm))) - 5.3) / (10.6 - 5.3)); // 0 (Moon) .. 1 (Voyager)
      c.hasRate = d.dataRate != null && Number.isFinite(Number(d.dataRate)) && Number(d.dataRate) > 0;
      if (c.hasRate) c.rateT = Math.log10(Number(d.dataRate));
      c.aT = 1;
      c.seen = this.craftSeen;
    }
    for (const c of this.craftList) if (c.seen !== this.craftSeen) c.aT = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVis);
    this.mq?.addEventListener?.('change', this._onMq);
    this.resize();
    if (!document.hidden) this._kick();
  }

  stop() {
    this.running = false;
    this._halt();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVis);
    this.mq?.removeEventListener?.('change', this._onMq);
  }

  _kick() {
    if (this.raf) return;
    this.last = 0;
    this.raf = requestAnimationFrame((t) => this._frame(t));
  }

  _halt() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.raf === 0 && this.running && !document.hidden) this._kick();
    else this._draw(0);
  }

  _frame(now) {
    this.raf = 0;
    if (!this.running || document.hidden) return;
    let dt = this.last ? (now - this.last) / 1000 : 0.016;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    if (this.reduced) {
      // far fewer frames, and time barely moves
      this.rdAcc = (this.rdAcc || 0) + dt;
      if (this.rdAcc < 0.25) {
        this.raf = requestAnimationFrame((t) => this._frame(t));
        return;
      }
      dt = this.rdAcc;
      this.rdAcc = 0;
    }
    this._draw(dt);
    this.raf = requestAnimationFrame((t) => this._frame(t));
  }

  _draw(dt) {
    const { ctx, w, h, cur, tgt } = this;
    const rm = this.reduced;
    const k = (tau) => 1 - Math.exp(-dt / tau);
    cur.wind += (tgt.wind - cur.wind) * k(6);
    cur.energy += (tgt.energy - cur.energy) * k(4);
    cur.kp += (tgt.kp - cur.kp) * k(5);
    cur.hue += (tgt.hue - cur.hue) * k(8);
    cur.flash *= Math.exp(-dt / 2.2);
    this.time += dt * (rm ? 0.05 : 1);
    const T = this.time;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    const m = Math.min(w, h);
    const cx = w * 0.5;
    const cy = h * 0.36;

    // --- aurora (behind everything else) ---
    const aur = smooth(2.6, 6.6, cur.kp);
    if (aur > 0.01) this._aurora(T, aur);

    // --- stars ---
    const driftBase = rm ? 0 : (0.004 + clamp((cur.wind - 280) / 520) * 0.012) / 1;
    for (let i = 0; i < STARS; i++) {
      const z = this.sz[i];
      let x = this.sx[i] + driftBase * z * z * dt;
      if (x > 1) x -= 1;
      this.sx[i] = x;
      const tw = 0.65 + 0.35 * Math.sin(T * (0.4 + z) + this.sp[i]);
      const a = (0.1 + z * 0.4) * tw;
      ctx.fillStyle = `rgba(214,224,255,${a.toFixed(3)})`;
      const s = 0.5 + z * 1.1;
      ctx.fillRect(x * w, this.sy[i] * h, s, s);
    }

    // --- sun glow ---
    const breathe = rm ? 0 : Math.sin(T * 0.35) * 0.05;
    const e = cur.energy;
    const sunR = m * (0.11 + 0.1 * e + breathe * 0.4) * (1 + cur.flash * 0.35);
    const sunA = 0.1 + 0.16 * e + cur.flash * 0.25;
    ctx.globalCompositeOperation = 'lighter';
    let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sunR * 2.6);
    g.addColorStop(0, `rgba(255,214,140,${(sunA * 1.3).toFixed(3)})`);
    g.addColorStop(0.18, `rgba(255,190,110,${sunA.toFixed(3)})`);
    g.addColorStop(0.5, `rgba(255,150,90,${(sunA * 0.25).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,140,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - sunR * 2.6, cy - sunR * 2.6, sunR * 5.2, sunR * 5.2);

    // --- spectrum ring ---
    const ringR = m * 0.2;
    this._ring(cx, cy, ringR, T);

    // --- DSN ---
    this._dsn(cx, cy, ringR, dt, T);

    // small Earth marker
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(122,167,255,0.7)';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, TAU);
    ctx.fill();
  }

  _aurora(T, amount) {
    const { ctx, w, h, cur } = this;
    const rm = this.reduced;
    const vivid = smooth(5, 7.5, cur.kp);
    const maxH = Math.min(h * 0.4, 360) * (0.55 + 0.45 * vivid);
    const cw = w / AURORA_COLS;
    ctx.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 3; layer++) {
      const hue = cur.hue + (layer - 1) * 24;
      const base = (0.07 + 0.13 * vivid) * amount * (layer === 1 ? 1 : 0.65);
      const g = ctx.createLinearGradient(0, 0, 0, maxH);
      g.addColorStop(0, `hsla(${hue.toFixed(0)},80%,60%,0)`);
      g.addColorStop(0.55, `hsla(${hue.toFixed(0)},85%,62%,${base.toFixed(3)})`);
      g.addColorStop(0.8, `hsla(${(hue + 20).toFixed(0)},80%,55%,${(base * 0.5).toFixed(3)})`);
      g.addColorStop(1, `hsla(${hue.toFixed(0)},80%,50%,0)`);
      ctx.fillStyle = g;
      const sp = 0.12 + layer * 0.05;
      for (let i = 0; i < AURORA_COLS; i++) {
        const u = i / AURORA_COLS;
        const ph = rm ? 0 : T * sp;
        // slow travelling curtain brightness with finer rays
        const band = 0.5 + 0.5 * Math.sin(u * (5 + layer * 2.3) + ph * 2 + layer * 1.7);
        const ray = 0.6 + 0.4 * Math.sin(u * 61 + layer * 3 + (rm ? 0 : T * 0.3));
        const a = band * band * ray;
        if (a < 0.03) continue;
        ctx.globalAlpha = a;
        // columns hang from the top edge; the lower edge undulates via a shorter rect
        const hh = maxH;
        ctx.fillRect(i * cw, 0, cw + 1, hh);
      }
    }
    ctx.globalAlpha = 1;
  }

  _ring(cx, cy, R, T) {
    const { ctx, freq, engine } = this;
    const vals = this.ringVals;
    let active = false;
    if (freq && engine?.analyser) {
      engine.analyser.getByteFrequencyData(freq);
      active = true;
      for (let i = 0; i < RING_POINTS; i++) {
        let mx = 0;
        for (let b = this.ringLo[i]; b <= this.ringHi[i]; b++) if (freq[b] > mx) mx = freq[b];
        const target = mx / 255;
        vals[i] += (target - vals[i]) * (target > vals[i] ? 0.35 : 0.08);
      }
    } else {
      for (let i = 0; i < RING_POINTS; i++) vals[i] *= 0.95;
    }
    let sum = 0;
    for (let i = 0; i < RING_POINTS; i++) sum += vals[i];
    const level = sum / RING_POINTS;
    this.cur.ring += ((active ? 1 : 0) - this.cur.ring) * 0.04;
    const alpha = 0.1 + 0.3 * this.cur.ring;
    const xs = this.ringXs;
    const ys = this.ringYs;
    const rot = this.reduced ? 0 : T * 0.02;
    const amp = R * 0.2;
    for (let i = 0; i <= RING_POINTS; i++) {
      const j = i % RING_POINTS;
      // light neighbour averaging for smoothness
      const v = (vals[j] * 2 + vals[(j + 1) % RING_POINTS] + vals[(j + RING_POINTS - 1) % RING_POINTS]) * 0.25;
      const a = (i / RING_POINTS) * TAU - Math.PI / 2 + rot;
      const r = R + v * amp;
      xs[i] = cx + Math.cos(a) * r;
      ys[i] = cy + Math.sin(a) * r;
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(255,210,122,${(alpha + level * 0.3).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i <= RING_POINTS; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.closePath();
    ctx.stroke();
    // inner reference circle
    ctx.strokeStyle = `rgba(122,167,255,${(0.05 + 0.05 * this.cur.ring).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.92, 0, TAU);
    ctx.stroke();
  }

  _dsn(cx, cy, ringR, dt, T) {
    const { ctx, w, h } = this;
    const list = this.craftList;
    if (!list.length) return;
    const rm = this.reduced;
    const rxMin = ringR * 1.45;
    const rxMax = Math.min(w * 0.47, 620);
    const squash = 0.55;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      c.alpha += (c.aT - c.alpha) * (1 - Math.exp(-dt / 2));
      c.r += (c.rT - c.r) * (1 - Math.exp(-dt / 3));
      c.rate += (c.rateT - c.rate) * (1 - Math.exp(-dt / 3));
      if (c.alpha < 0.01 && c.aT === 0) continue;
      const rx = rxMin + c.r * (rxMax - rxMin);
      const ry = rx * squash;
      if (!rm) c.angle += (c.speed * 0.05 * dt) / (0.4 + c.r * 1.2);
      const x = cx + Math.cos(c.angle) * rx;
      const y = cy + Math.sin(c.angle) * ry;
      const a = c.alpha;

      // faint orbit
      ctx.strokeStyle = `rgba(140,160,255,${(0.05 * a).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      ctx.stroke();

      // downlink pulse travelling inward; rate ~ log(data rate)
      const period = clamp(16 - 2.1 * c.rate, 3, 14);
      if (!rm && c.hasRate) c.pulse = (c.pulse + dt / period) % 1;
      const p = c.hasRate ? c.pulse : 0;
      const px = x + (cx - x) * p;
      const py = y + (cy - y) * p;
      const pa = Math.sin(p * Math.PI) * 0.5 * a;
      if (c.hasRate) {
      ctx.globalCompositeOperation = 'lighter';
      const pg = ctx.createRadialGradient(px, py, 0, px, py, 7);
      pg.addColorStop(0, `rgba(160,210,255,${pa.toFixed(3)})`);
      pg.addColorStop(1, 'rgba(160,210,255,0)');
      ctx.fillStyle = pg;
      ctx.fillRect(px - 7, py - 7, 14, 14);
      ctx.strokeStyle = `rgba(160,200,255,${(0.05 * a * (1 - p)).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(px, py);
      ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';

      // craft dot + label
      ctx.fillStyle = `rgba(255,224,160,${(0.8 * a).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(190,200,235,${(0.38 * a).toFixed(3)})`;
      ctx.textAlign = x > cx ? 'left' : 'right';
      ctx.fillText(c.name, x + (x > cx ? 7 : -7), y);
    }
  }
}
