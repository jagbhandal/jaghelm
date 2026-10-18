/**
 * httpClient.safeFetch: its own options (trusted, timeoutMs, credentialInUrl)
 * reach fetchSafe instead of riding along in the fetch init.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { safeFetch } from './httpClient.js';

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// `from` redirects every request (path and query kept) to `to`, another origin.
async function twoOrigins() {
  const state = { to: 0 };
  const to = await listen((req, res) => { state.to++; res.writeHead(200); res.end('ok'); });
  const from = await listen((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${to.address().port}${req.url}` }); res.end();
  });
  return { state, fromUrl: `http://127.0.0.1:${from.address().port}`, close: () => { to.close(); from.close(); } };
}

test('credentialInUrl is forwarded: a cross-origin redirect is refused', async () => {
  const o = await twoOrigins();
  try {
    await assert.rejects(safeFetch(`${o.fromUrl}/api?token=k1`, { credentialInUrl: true }),
      /credential is in the URL/);
    assert.equal(o.state.to, 0, 'the other origin received a request');
  } finally { o.close(); }
});

test('without credentialInUrl the same redirect is followed', async () => {
  const o = await twoOrigins();
  try {
    const r = await safeFetch(`${o.fromUrl}/api?q=1`);
    assert.equal(r.status, 200);
    assert.equal(o.state.to, 1);
  } finally { o.close(); }
});

test('safeFetch\'s own options are not passed to fetch', async () => {
  const real = globalThis.fetch;
  let init = null;
  globalThis.fetch = async (url, i) => { init = i; return new Response('ok', { status: 200 }); };
  try {
    await safeFetch('http://svc.example.test/', { credentialInUrl: true, trusted: true, timeoutMs: 1000 });
  } finally {
    globalThis.fetch = real;
  }
  for (const k of ['credentialInUrl', 'trusted', 'timeoutMs']) assert.equal(k in init, false, `${k} reached fetch`);
});
