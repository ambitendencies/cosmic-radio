// Headless smoke test: load the app in simulated mode, tune in, and confirm
// that audio is flowing, the UI is updating, and there are no errors.
import { startServer, launch } from './_browser.mjs';

const { srv, base } = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`${base}/?sim&seed=11`);
  await page.click('#tune');
  await page.waitForTimeout(6000);
  await page.click('#demo button[data-event="flare"]');
  await page.waitForTimeout(4000);

  const report = await page.evaluate(() => {
    const { engine, params, state } = window.cosmicRadio;
    const buf = new Float32Array(engine.analyser.fftSize);
    engine.analyser.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length);
    return {
      contextState: engine.ctx.state,
      rms,
      step: engine.scheduler.step,
      layers: engine.layers.map((l) => l.constructor.id),
      key: document.querySelector('#np-key').textContent,
      detail: document.querySelector('#np-detail').textContent,
      readouts: document.querySelectorAll('.readout').length,
      xray: state.xray.class,
      mode: params.modeName,
      dsn: state.dsn.length,
    };
  });
  console.log(JSON.stringify(report, null, 2));
  const fail = [];
  if (report.contextState !== 'running') fail.push('AudioContext not running');
  if (!(report.rms > 1e-4)) fail.push(`no audio (rms ${report.rms})`);
  if (report.step < 20) fail.push('scheduler not advancing');
  if (report.readouts < 8) fail.push('panel not rendered');
  fail.push(...errors);
  if (fail.length) {
    console.error('SMOKE FAILED:\n  ' + fail.join('\n  '));
    process.exitCode = 1;
  } else console.log('SMOKE OK');
} finally {
  await browser.close();
  srv.close();
}
