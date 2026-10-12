// Shared helpers for the headless-browser scripts: start the server, launch Chromium.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from '../server.js';

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // Fall back to a globally installed copy.
    const root = execSync('npm root -g').toString().trim();
    return createRequire(`${root}/`)('playwright');
  }
}

export async function startServer() {
  const srv = createServer().listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

export async function launch() {
  const { chromium } = await loadPlaywright();
  const opts = { args: ['--autoplay-policy=no-user-gesture-required'] };
  try {
    return await chromium.launch(opts);
  } catch {
    return chromium.launch({ ...opts, executablePath: '/opt/pw-browsers/chromium' });
  }
}
