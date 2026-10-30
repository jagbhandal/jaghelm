/**
 * GET /api/monitoring (#751) on the real app: the requests it refuses, its
 * answer from Prometheus query_range, the cache that keeps a second read
 * within the step off Prometheus, the ETag and 304, and a Prometheus that
 * doesn't answer. Prometheus is a stub behind globalThis.fetch. Auth is off
 * here; monitoring.auth.test.js has it on.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-monitoring-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { initDiscovery } = await import('../discovery.js');
const { saveConfig } = await import('../config.js');
const { monitoringCache } = await import('../monitoring.js');
const { energyCost } = await import('../energyCost.js');

const PROM = 'http://localhost:9995';
const realFetch = globalThis.fetch;
const prom = { asked: [], down: false };

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (String(url).startsWith(PROM) && u.pathname === '/api/v1/query') {
    // The container growers' instant reads (#760): no series, or the outage.
    if (prom.down) return new Response('upstream down', { status: 502 });
    return new Response(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!String(url).startsWith(PROM) || u.pathname !== '/api/v1/query_range') {
    throw new Error(`unexpected fetch ${url}`);
  }
  prom.asked.push(u.searchParams.get('query'));
  if (prom.down) return new Response('upstream down', { status: 502 });
  const start = Number(u.searchParams.get('start'));
  const result = [{ metric: { node: 'pve' }, values: [[start, '12.5']] }];
  return new Response(JSON.stringify({ status: 'success', data: { resultType: 'matrix', result } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

initDiscovery(PROM);
saveConfig({ nodes: { pve: { display_name: 'Proxmox' } } });

after(() => {
  globalThis.fetch = realFetch;
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  monitoringCache.clear();
  energyCost.clear();
  prom.asked.length = 0;
  prom.down = false;
});

test('a missing or unknown range is a 400 that asks Prometheus nothing', async () => {
  for (const path of [
    '/api/monitoring',
    '/api/monitoring?range=2h',
    '/api/monitoring?range=1h&range=7d',
    '/api/monitoring?range=constructor',
  ]) {
    const res = await request(app).get(path);
    assert.equal(res.status, 400, path);
    assert.equal(typeof res.body.error, 'string', path);
  }
  assert.equal(prom.asked.length, 0);
});

test('the client names a range only: any other parameter is ignored, never PromQL', async () => {
  const res = await request(app).get('/api/monitoring?range=1h&query=vector(1)&series=node.load');
  assert.equal(res.status, 200);
  assert.ok(prom.asked.length > 0);
  assert.ok(prom.asked.every((q) => !q.includes('vector(1)') && !q.includes('node.load')));
});

test('every range answers every chart of the table', async () => {
  for (const [range, step, count] of [['1h', 60_000, 61], ['24h', 300_000, 289], ['7d', 1_800_000, 337], ['30d', 7_200_000, 361]]) {
    const res = await request(app).get(`/api/monitoring?range=${range}`);
    assert.equal(res.status, 200, range);
    assert.equal(res.body.range, range);
    const cpu = res.body.charts.find((c) => c.id === 'cpu-overview');
    assert.deepEqual([cpu.ok, cpu.stepMs, cpu.count, cpu.section], [true, step, count, 'resources'], range);
    assert.deepEqual(cpu.lines.map((l) => [l.entity, l.values[0]]), [['pve', 12.5]]);
    // The power charts (#753): the mock's one series stands for the UPS.
    const power = res.body.charts.find((c) => c.id === 'power-draw');
    assert.deepEqual([power.ok, power.state, power.unit, power.count, power.section], [true, 'ok', 'W', count, 'power-cost'], range);
    assert.equal(power.values[0], 12.5);
    assert.equal(Array.isArray(power.maxValues), range === '7d' || range === '30d', range);
    const cost = res.body.charts.find((c) => c.id === 'monthly-cost');
    assert.deepEqual([cost.ok, cost.state, cost.currency], [true, 'ok', null], 'no rate set: kWh and no money');
  }
});

test('readers within one step share the cache: one Prometheus query', async () => {
  const path = '/api/monitoring?range=1h';
  const [a, b] = await Promise.all([request(app).get(path), request(app).get(path)]);
  const afterTwo = prom.asked.length;
  const c = await request(app).get(path);
  // Every chart's queries (CPU, power, the cost's hourly read, the restarts' five) went out once, for all three readers.
  assert.equal(prom.asked.length, afterTwo, 'the third reader asked nothing');
  assert.equal(new Set(prom.asked).size, prom.asked.length, 'no query was asked twice');
  assert.equal(prom.asked.filter((q) => q.includes('node_cpu_seconds_total')).length, 1);
  assert.deepEqual(b.body, a.body);
  assert.deepEqual(c.body, a.body);
});

test('a matching If-None-Match is answered 304 with no body', async () => {
  const path = '/api/monitoring?range=1h';
  const first = await request(app).get(path);
  assert.ok(first.headers.etag, 'ETag header');
  const again = await request(app).get(path).set('If-None-Match', first.headers.etag);
  assert.equal(again.status, 304);
  assert.equal(again.text, '');
});

test('a Prometheus that errors: the chart says so in its fixed sentence, and draws no line', async () => {
  prom.down = true;
  const res = await request(app).get('/api/monitoring?range=1h');
  assert.equal(res.status, 200);
  for (const chart of res.body.charts) {
    assert.equal(chart.ok, false, chart.id);
    assert.equal(chart.error, 'Prometheus answered with an error (HTTP 502)', chart.id);
    assert.equal(chart.lines, undefined);
    assert.equal(chart.values, undefined);
    assert.equal(chart.days, undefined);
  }
  // Kept briefly: a second read asks nothing.
  const asked = prom.asked.length;
  await request(app).get('/api/monitoring?range=1h');
  assert.equal(prom.asked.length, asked);
});
