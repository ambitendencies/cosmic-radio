// Zero-dependency static server + feed proxy.
// The proxy sidesteps CORS (the DSN feed has none) and caches upstream
// responses so many listeners don't hammer NOAA/NASA.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEEDS } from './public/js/data/feedConfig.js';

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const CACHE_TTL_MS = 55_000;
const UPSTREAM_TIMEOUT_MS = 15_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

const cache = new Map(); // id -> { body, contentType, fetchedAt }
const inflight = new Map(); // id -> Promise

async function fetchFeed(id) {
  const feed = FEEDS[id];
  const cached = cache.get(id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  if (inflight.has(id)) return inflight.get(id);

  const url = feed.cacheBust ? `${feed.url}?r=${Date.now()}` : feed.url;
  const p = (async () => {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: { 'user-agent': 'cosmic-radio/0.1 (+https://github.com/ambitendencies/cosmic-radio)' },
      });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const entry = {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') || (feed.type === 'json' ? MIME['.json'] : 'text/plain'),
        fetchedAt: Date.now(),
      };
      cache.set(id, entry);
      return entry;
    } catch (err) {
      // Serve stale data rather than nothing when upstream hiccups.
      if (cached) return { ...cached, stale: true };
      throw err;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

async function handleFeed(req, res, id) {
  if (!Object.hasOwn(FEEDS, id)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: `unknown feed '${id}'` }));
  }
  try {
    const entry = await fetchFeed(id);
    res.writeHead(200, {
      'content-type': entry.contentType,
      'cache-control': 'no-store',
      'x-fetched-at': new Date(entry.fetchedAt).toISOString(),
      'x-stale': entry.stale ? '1' : '0',
    });
    res.end(entry.body);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
}

async function handleStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const m = pathname.match(/^\/api\/feeds\/([\w-]+)$/);
    if (m) return handleFeed(req, res, m[1]);
    if (pathname === '/api/feeds') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(Object.keys(FEEDS)));
    }
    return handleStatic(req, res, pathname);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => {
    console.log(`\n  ✦ Cosmic Radio is broadcasting on http://localhost:${PORT}\n`);
  });
}
