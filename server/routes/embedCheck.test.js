/**
 * GET /api/embed-check/:tabId (#269), through the real app: the URL comes from
 * the saved display config, looked up by tab id, never from the request. A
 * local server stands in for the app tab.
 */
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-embed-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234'; // pragma: allowlist secret
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh, invalidateDisplayConfigCache } = await import('../refresh.js');
const { createSession } = await import('../auth/sessions.js');

const token = createSession('admin');
const PAGE = 'https://jaghelm.example';

// The app tab: each path answers with its own framing headers.
const seen = [];
const appServer = http.createServer((req, res) => {
  seen.push({ url: req.url, headers: req.headers });
  const headers = {
    '/deny': { 'X-Frame-Options': 'DENY' },
    '/ancestors': { 'Content-Security-Policy': "frame-ancestors 'self'" },
    '/allowed': { 'Content-Security-Policy': `frame-ancestors 'self' ${PAGE}` },
  }[req.url];
  res.writeHead(200, headers || {});
  res.end('<html>app</html>');
});
let base;

before(async () => {
  await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (appServer.address()).port}`;
  writeFileSync(
    join(dataDir, 'display-config.json'),
    JSON.stringify({
      tabs: [
        { id: 'vault', label: 'Vaultwarden', type: 'iframe', url: `${base}/deny` },
        { id: 'grafana', label: 'Grafana', type: 'iframe', url: `${base}/ancestors` },
        { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: `${base}/allowed` },
        { id: 'plain', label: 'Plain', type: 'iframe', url: `${base}/plain` },
        { id: 'meta', label: 'Metadata', type: 'iframe', url: 'http://169.254.169.254/latest/' },
      ],
    })
  );
  invalidateDisplayConfigCache();
});

after(() => {
  stopBackgroundRefresh();
  appServer.closeAllConnections();
  appServer.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

const check = (id, query = { origin: PAGE }) =>
  request(app).get(`/api/embed-check/${id}`).query(query).set('x-auth-token', token);

test('needs a session', async () => {
  const r = await request(app).get('/api/embed-check/vault').query({ origin: PAGE });
  assert.equal(r.status, 401);
});

test('X-Frame-Options: DENY is a block, and the header is named', async () => {
  const r = await check('vault');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { url: `${base}/deny`, verdict: 'blocked', header: 'X-Frame-Options: DENY' });
  assert.equal(r.headers['cache-control'], 'no-store');
});

test("frame-ancestors 'self' blocks JagHelm on another origin", async () => {
  const r = await check('grafana');
  assert.deepEqual(r.body, {
    url: `${base}/ancestors`,
    verdict: 'blocked',
    header: "Content-Security-Policy: frame-ancestors 'self'",
  });
});

test("an app that lists JagHelm's origin, or sends neither header, is allowed", async () => {
  assert.equal((await check('kuma')).body.verdict, 'allowed');
  assert.equal((await check('plain')).body.verdict, 'allowed');
  // The same headers, from a page on another origin: no longer listed.
  const other = await check('kuma', { origin: 'https://other.example' });
  assert.equal(other.body.verdict, 'blocked');
});

test('the request sent to the app carries no session token or cookie', async () => {
  const hit = seen.find((s) => s.url === '/deny');
  assert.ok(hit);
  assert.equal(hit.headers['x-auth-token'], undefined);
  assert.equal(hit.headers.cookie, undefined);
  assert.equal(hit.headers.authorization, undefined);
});

test('a repeat check is answered from the cache', async () => {
  const before = seen.length;
  await check('vault');
  await check('vault');
  assert.equal(seen.length, before);
});

test('an app it cannot read is unknown, not blocked', async () => {
  const r = await check('meta');
  assert.deepEqual(r.body, { url: 'http://169.254.169.254/latest/', verdict: 'unknown', reason: 'refused' });
});

test('only saved tab ids are checked: a URL in the request is ignored', async () => {
  const before = seen.length;
  const r = await check('nope', { origin: PAGE, url: `${base}/deny` });
  assert.equal(r.status, 404);
  const r2 = await request(app)
    .get(`/api/embed-check/${encodeURIComponent(`${base}/deny`)}`)
    .query({ origin: PAGE })
    .set('x-auth-token', token);
  assert.equal(r2.status, 404);
  assert.equal(seen.length, before);
});

test('origin must be a bare http(s) origin', async () => {
  for (const origin of [undefined, '', 'jaghelm.example', 'https://jaghelm.example/path', 'javascript:alert(1)', 'x'.repeat(300)]) {
    const r = await check('vault', origin === undefined ? {} : { origin });
    assert.equal(r.status, 400, String(origin));
  }
});
