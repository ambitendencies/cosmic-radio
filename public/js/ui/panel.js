// Instrument panel: shows what each measurement is and what it's
// controlling in the music. (Phase 2 Agent C may expand this.)

export class Panel {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = '<div class="readouts"></div>';
    this.list = this.root.querySelector('.readouts');
  }

  update(state, params) {
    this.list.innerHTML = params.explain
      .map(
        (r) => `<div class="readout"><span class="src">${esc(r.source)}</span><span class="val">${esc(r.value)}</span><span class="fx">→ ${esc(r.effect)}</span></div>`,
      )
      .join('');
  }
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
