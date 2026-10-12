// Render a WAV of Cosmic Radio playing simulated space weather.
//   node scripts/render-sample.mjs [seconds=60] [out=samples/cosmic-radio-sample.wav] [seed=7] [layers]
// A flare is triggered at 40% of the way through, and a storm at 60%.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { startServer, launch } from './_browser.mjs';

const seconds = Number(process.argv[2] ?? 60);
const out = process.argv[3] ?? 'samples/cosmic-radio-sample.wav';
const seed = Number(process.argv[4] ?? 7);
const only = process.argv[5] ? process.argv[5].split(',') : null; // e.g. "pad,drone" to solo layers

const { srv, base } = await startServer();
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${base}/?sim`);
  const result = await page.evaluate(
    async ({ seconds, seed, only }) => {
      const { renderSample } = await import('/js/tools/render.js');
      const events = [{ at: Math.round(seconds * 0.4 / 2) * 2, kind: 'flare' }, { at: Math.round(seconds * 0.6 / 2) * 2, kind: 'storm' }];
      const { wav, stats } = await renderSample({ seconds, seed, events, only });
      let bin = '';
      for (let i = 0; i < wav.length; i += 0x8000) bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
      return { b64: btoa(bin), stats };
    },
    { seconds, seed, only },
  );
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(result.b64, 'base64'));
  const s = result.stats;
  console.log(`wrote ${out}  peak ${s.peakDb.toFixed(1)} dBFS  rms ${s.rmsDb.toFixed(1)} dBFS`);
} finally {
  await browser.close();
  srv.close();
}
