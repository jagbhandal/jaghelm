/**
 * GET /api/logs (#672) on the real app: 400 and 404 before Loki is asked, the
 * cleaned lines from Loki's query_range, and a Loki that doesn't answer as a
 * 200 `unavailable`, never an error. Loki is a stub behind globalThis.fetch.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-logs-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
process.env.LOKI_URL = 'http://localhost:9995';
process.env.JAGHELM_ALLOW_OPEN_SECRETS = 'true'; // the gate test turns it off

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { saveConfig } = await import('../config.js');
const { setCache } = await import('../cache.js');
const { logPeek } = await import('../lokiLogs.js');

const realFetch = globalThis.fetch;
const loki = { asked: [], down: false };

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.origin !== 'http://localhost:9995' || u.pathname !== '/loki/api/v1/query_range') {
    throw new Error(`unexpected fetch ${url}`);
  }
  loki.asked.push(u.searchParams.get('query'));
  if (loki.down) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const end = BigInt(u.searchParams.get('end'));
  return new Response(
    JSON.stringify({
      status: 'success',
      data: { resultType: 'streams', result: [{ stream: {}, values: [[String(end - 5n), 'ERROR GET /x?token=abc123def456 failed']] }] },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

saveConfig({ nodes: { pve: { display_name: 'Proxmox' }, ghost: { visible: false } } });
setCache('services', { nodes: { pve: { services: [{ uid: 'pve:db', container: 'db' }] } } });

after(() => {
  globalThis.fetch = realFetch;
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  logPeek.clear();
  loki.asked.length = 0;
  loki.down = false;
});

test('a missing or malformed entity is a 400, an unknown node or container a 404, Loki asked nothing', async () => {
  for (const [path, status] of [
    ['/api/logs', 400],
    ['/api/logs?entity=pve/', 400],
    ['/api/logs?entity=pve&entity=pve', 400],
    ['/api/logs?entity=pi9', 404],
    ['/api/logs?entity=ghost', 404],
    ['/api/logs?entity=pve/nope', 404],
    ['/api/logs?entity=pve%22%7D%20or%20%7Bjob%3D~%22.%2B', 404],
  ]) {
    const res = await request(app).get(path);
    assert.equal(res.status, status, path);
  }
  assert.equal(loki.asked.length, 0);
});

test('a container: its error lines, cleaned, uncached by the browser', async () => {
  const res = await request(app).get('/api/logs?entity=pve/db');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.body.state, 'ok');
  assert.equal(res.body.lines[0].text, 'ERROR GET /x?token=[redacted] failed');
  assert.match(loki.asked[0], /^\{host="pve",container_name="db"\}/);
});

test('Loki down is a 200 unavailable, not an error', async () => {
  loki.down = true;
  const res = await request(app).get('/api/logs?entity=pve');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { state: 'unavailable', lines: [], reason: 'Loki refused the connection' });
});

test('with no dashboard password the logs are unavailable and Loki is asked nothing', async () => {
  delete process.env.JAGHELM_ALLOW_OPEN_SECRETS;
  try {
    const res = await request(app).get('/api/logs?entity=pve');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      state: 'unavailable',
      lines: [],
      reason: 'logs stay off until a dashboard password is set (DASH_PASS)',
    });
    assert.equal(loki.asked.length, 0);
  } finally {
    process.env.JAGHELM_ALLOW_OPEN_SECRETS = 'true';
  }
});
