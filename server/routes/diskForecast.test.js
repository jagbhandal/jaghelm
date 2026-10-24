/**
 * GET /api/disk-forecast (#670) on the real app: the answer from Prometheus
 * query_range, one pair of queries however many readers, the ETag and 304,
 * and a Prometheus that doesn't answer. Prometheus is a stub behind
 * globalThis.fetch. Auth is off here; the route sits on the same router as
 * /api/history, which history.auth.test.js covers.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-forecast-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { initDiscovery } = await import('../discovery.js');
const { saveConfig } = await import('../config.js');
const { diskForecastCache } = await import('../diskForecast.js');

const PROM = 'http://localhost:9995';
const realFetch = globalThis.fetch;
const prom = { asked: [], down: false };
const GB = 1024 ** 3;

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (!String(url).startsWith(PROM) || u.pathname !== '/api/v1/query_range') {
    throw new Error(`unexpected fetch ${url}`);
  }
  const query = u.searchParams.get('query');
  prom.asked.push(query);
  if (prom.down) return new Response('upstream down', { status: 502 });
  const start = Number(u.searchParams.get('start'));
  const end = Number(u.searchParams.get('end'));
  const step = Number(u.searchParams.get('step'));
  const used = query.includes(' - ');
  const values = [];
  for (let t = start; t <= end; t += step) {
    values.push([t, String(used ? 40 * GB + ((t - start) / 86_400) * 2 * GB : 100 * GB)]);
  }
  const result = [{ metric: { node: 'pve-label', mountpoint: '/' }, values }];
  return new Response(
    JSON.stringify({ status: 'success', data: { resultType: 'matrix', result } }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

initDiscovery(PROM);
saveConfig({ nodes: { pve: { display_name: 'Proxmox', prometheus_node: 'pve-label' } } });

after(() => {
  globalThis.fetch = realFetch;
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  diskForecastCache.clear();
  prom.asked.length = 0;
  prom.down = false;
});

test('answers the days left for the node by its services.yaml key, from two queries', async () => {
  const res = await request(app).get('/api/disk-forecast');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.nodes.pve.status, 'ok');
  assert.ok(Math.abs(res.body.nodes.pve.daysLeft - 23) < 1, String(res.body.nodes.pve.daysLeft));
  assert.equal(res.body.nodes.pve.mount, '/');
  assert.equal(prom.asked.length, 2);
  assert.match(prom.asked[0], /node_filesystem_size_bytes/);
});

test('any number of readers within the TTL cost no more queries, and a repeat is a 304', async () => {
  const first = await request(app).get('/api/disk-forecast');
  await Promise.all([
    request(app).get('/api/disk-forecast'),
    request(app).get('/api/disk-forecast'),
  ]);
  assert.equal(prom.asked.length, 2);
  const again = await request(app)
    .get('/api/disk-forecast')
    .set('If-None-Match', first.headers.etag);
  assert.equal(again.status, 304);
});

test('a Prometheus that fails is ok:false with a fixed sentence and no nodes, never a guess', async () => {
  prom.down = true;
  const res = await request(app).get('/api/disk-forecast');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.deepEqual(res.body.nodes, {});
  assert.doesNotMatch(JSON.stringify(res.body), /upstream down/);
});
