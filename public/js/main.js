// Cosmic Radio entry point: wires data → mapper → audio engine → UI.

import { DataHub } from './data/feeds.js';
import { FEEDS } from './data/feedConfig.js';
import { mapStateToParams } from './music/mapper.js';
import { noteName } from './music/theory.js';
import { AudioEngine } from './audio/engine.js';
import { LAYERS } from './audio/layers/index.js';
import { Panel, esc } from './ui/panel.js';
import { Visualizer } from './ui/visualizer.js';

const $ = (sel) => document.querySelector(sel);
const query = new URLSearchParams(location.search);

const hub = new DataHub({
  mode: query.has('sim') ? 'sim' : 'auto',
  seed: query.has('seed') ? Number(query.get('seed')) : undefined,
});
const panel = new Panel($('#panel'));
const viz = new Visualizer($('#visualizer'));

let engine = null;
let params = null;
let state = hub.state;

$('#mode').value = hub.mode;

hub.addEventListener('state', (e) => {
  state = e.detail;
  params = mapStateToParams(state, params);
  engine?.update(params, state);
  panel.update(state, params);
  viz.update(state, params);
  renderSources();
  renderNowPlaying();
});
hub.addEventListener('sources', renderSources);

viz.start();
hub.start();

$('#tune').addEventListener('click', async () => {
  const btn = $('#tune');
  if (engine?.running) {
    btn.disabled = true;
    await engine.stop();
    btn.disabled = false;
    btn.setAttribute('aria-pressed', 'false');
    btn.querySelector('.tune-label').textContent = 'Tune in';
    return;
  }
  if (!engine) {
    engine = new AudioEngine();
    LAYERS.forEach((L) => engine.addLayer(L));
    viz.attach(engine);
    renderLayers();
    window.cosmicRadio.engine = engine;
  }
  if (params) engine.update(params, state);
  await engine.start();
  engine.setVolume(Number($('#volume').value));
  btn.setAttribute('aria-pressed', 'true');
  btn.querySelector('.tune-label').textContent = 'Listening';
  renderNowPlaying();
});

$('#volume').addEventListener('input', (e) => engine?.setVolume(Number(e.target.value)));
$('#mode').addEventListener('change', (e) => {
  hub.setMode(e.target.value);
  renderSources();
});
$('#demo').addEventListener('click', (e) => {
  const kind = e.target.closest('button')?.dataset.event;
  if (kind) hub.trigger(kind);
});

function renderLayers() {
  const root = $('#layers');
  root.innerHTML = '';
  for (const layer of engine.layers) {
    const C = layer.constructor;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'layer-toggle';
    b.setAttribute('aria-pressed', String(layer.enabled));
    b.innerHTML = `<span>${esc(C.label)}</span><small>${esc(C.description ?? '')}</small>`;
    b.addEventListener('click', () => {
      layer.setEnabled(!layer.enabled);
      b.setAttribute('aria-pressed', String(layer.enabled));
    });
    root.appendChild(b);
  }
}

function renderSources() {
  const live = state.sources ?? {};
  $('#sources').innerHTML = Object.entries(FEEDS)
    .map(([id, f]) => `<span class="badge ${live[id] === 'live' ? 'live' : 'sim'}" title="${esc(f.label)}">${esc(id)} · ${live[id] === 'live' ? 'live' : 'simulated'}</span>`)
    .join('');
  const anySim = Object.values(live).some((v) => v !== 'live');
  $('#demo').style.display = anySim ? '' : 'none';
}

function renderNowPlaying() {
  if (!params) return;
  const h = engine?.harmony;
  const key = `${noteName(params.rootMidi).replace(/-?\d+$/, '')} ${params.modeName}`;
  $('#np-key').textContent = key;
  const craft = state.dsn?.length ? ` · ${state.dsn.length} spacecraft on the line` : '';
  $('#np-detail').textContent = engine?.running
    ? `${Math.round(engine.scheduler.tempo)} BPM · chord ${roman(h.degree)} · X-ray ${state.xray.class}${craft}`
    : `${Math.round(params.tempo)} BPM · X-ray ${state.xray.class}${craft} · press Tune in`;
}

function roman(d) {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][((d % 7) + 7) % 7];
}

window.cosmicRadio = { hub, engine, get params() { return params; }, get state() { return state; } };
