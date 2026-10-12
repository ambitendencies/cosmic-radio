import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

async function withServer(fn) {
  const srv = createServer().listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    await fn(base);
  } finally {
    srv.close();
  }
}

test('serves index.html and JS modules', () =>
  withServer(async (base) => {
    const html = await fetch(base + '/');
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Cosmic Radio/);
    const js = await fetch(base + '/js/main.js');
    assert.match(js.headers.get('content-type'), /javascript/);
  }));

test('blocks path traversal', () =>
  withServer(async (base) => {
    const res = await fetch(base + '/..%2f..%2fpackage.json');
    assert.notEqual(res.status, 200);
  }));

test('unknown feeds 404, feed list is exposed', () =>
  withServer(async (base) => {
    assert.equal((await fetch(base + '/api/feeds/nope')).status, 404);
    const list = await (await fetch(base + '/api/feeds')).json();
    assert.ok(list.includes('plasma') && list.includes('dsn'));
  }));
