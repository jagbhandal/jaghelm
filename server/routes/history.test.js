/**
 * GET /api/history (#311) on the real app: the requests it refuses, its
 * answer from Prometheus query_range, the cache that keeps a second read
 * within the step off Prometheus, the ETag and 304, and a Prometheus that
 * doesn't answer. Prometheus is a stub behind globalThis.fetch that counts
 * the range queries it answers. Auth is off here; history.auth.test.js has
 * it on. The data dir is set before importing the app.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-history-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { initDiscovery } = await import('../discovery.js');
const { saveConfig } = await import('../config.js');
const { historyCache } = await import('../promHistory.js');

const PROM = 'http://localhost:9996';
const realFetch = globalThis.fetch;
const prom = { asked: [], down: false };

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (!String(url).startsWith(PROM) || u.pathname !== '/api/v1/query_range') {
    throw new Error(`unexpected fetch ${url}`);
  }
  const query = u.searchParams.get('query');
  prom.asked.push(query);
  if (prom.down) return new Response('upstream down', { status: 502 });
  const start = Number(u.searchParams.get('start'));
  const step = Number(u.searchParams.get('step'));
  const result = query.includes('container_')
    ? [
        {
          metric: { name: 'db' },
          values: [
            [start, '104857600'],
            [start + step, '110100480'],
          ],
        },
      ]
    : [
        {
          metric: { node: 'pve' },
          values: [
            [start, '12.5'],
            [start + 2 * step, '14'],
          ],
        },
        { metric: { node: 'nas-label' }, values: [[start, '3']] },
      ];
  return new Response(
    JSON.stringify({ status: 'success', data: { resultType: 'matrix', result } }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

initDiscovery(PROM);
saveConfig({
  nodes: {
    pve: { display_name: 'Proxmox' },
    nas: { display_name: 'NAS', prometheus_node: 'nas-label' },
  },
});

after(() => {
  globalThis.fetch = realFetch;
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  historyCache.clear();
  prom.asked.length = 0;
  prom.down = false;
});

test('an unknown series or range, or a malformed entity, is a 400 that asks Prometheus nothing', async () => {
  for (const path of [
    '/api/history',
    '/api/history?range=1h',
    '/api/history?series=node.load&range=1h',
    '/api/history?series=node.cpu&range=2h',
    '/api/history?series=node.cpu',
    '/api/history?series=node.cpu&series=node.disk&range=1h',
    '/api/history?series=node.cpu&entity=pve/web&range=1h',
    '/api/history?series=container.cpu&entity=pve&range=1h',
    '/api/history?series=container.cpu&entity=pve/bad%20name&range=1h',
    `/api/history?series=node.cpu&entity=${'x'.repeat(201)}&range=1h`,
  ]) {
    const res = await request(app).get(path);
    assert.equal(res.status, 400, path);
    assert.equal(typeof res.body.error, 'string', path);
  }
  assert.equal(prom.asked.length, 0);
});

test('a node services.yaml lacks is a 404', async () => {
  const res = await request(app).get('/api/history?series=node.cpu&entity=pi9&range=1h');
  assert.equal(res.status, 404);
  assert.equal(prom.asked.length, 0);
});

test("every visible node's CPU in one query, each line under its node's key", async () => {
  const res = await request(app).get('/api/history?series=node.cpu&range=1h');
  assert.equal(res.status, 200);
  assert.equal(prom.asked.length, 1);
  assert.match(prom.asked[0], /node=~"pve\|nas-label"/);
  const [cpu] = res.body.series;
  assert.deepEqual(
    [cpu.series, cpu.unit, cpu.ok, cpu.stepMs, cpu.count],
    ['node.cpu', '%', true, 60_000, 61]
  );
  assert.equal(cpu.startMs % 60_000, 0, 'the range starts on a whole step');
  assert.deepEqual(
    cpu.lines.map((l) => [l.entity, l.values.slice(0, 3)]),
    [
      ['pve', [12.5, null, 14]],
      ['nas', [3, null, null]],
    ]
  );
});

test("a node's four readings in one request, a container's two", async () => {
  const node = await request(app).get(
    '/api/history?series=node.cpu,node.memory,node.disk,node.temperature&entity=pve&range=24h'
  );
  assert.equal(node.status, 200);
  assert.deepEqual(
    node.body.series.map((s) => [s.series, s.unit, s.count]),
    [
      ['node.cpu', '%', 289],
      ['node.memory', '%', 289],
      ['node.disk', '%', 289],
      ['node.temperature', '°C', 289],
    ]
  );
  assert.equal(prom.asked.length, 4);
  assert.ok(prom.asked.every((q) => q.includes('node=~"pve"')));

  const box = await request(app).get(
    '/api/history?series=container.cpu,container.memory&entity=nas/db&range=7d'
  );
  assert.equal(box.status, 200);
  assert.ok(prom.asked.slice(4).every((q) => q.includes('node="nas-label",name="db"')));
  const memory = box.body.series.find((s) => s.series === 'container.memory');
  assert.deepEqual([memory.unit, memory.count], ['bytes', 337]);
  assert.deepEqual(memory.lines[0].values.slice(0, 2), [104857600, 110100480]);
});

test('a second call within the step makes no second Prometheus request', async () => {
  const path = '/api/history?series=node.cpu&entity=pve&range=1h';
  const first = await request(app).get(path);
  const second = await request(app).get(path);
  assert.equal(prom.asked.length, 1);
  assert.deepEqual(second.body, first.body);
});

test('a matching If-None-Match is answered 304 with no body', async () => {
  const path = '/api/history?series=node.cpu,node.memory&entity=pve&range=1h';
  const first = await request(app).get(path);
  assert.ok(first.headers.etag, 'ETag header');
  const again = await request(app).get(path).set('If-None-Match', first.headers.etag);
  assert.equal(again.status, 304);
  assert.equal(again.text, '');
  const other = await request(app).get(path).set('If-None-Match', '"something-else"');
  assert.equal(other.status, 200);
});

test("a Prometheus that doesn't answer: each series says so, with its error, and no line", async () => {
  prom.down = true;
  const res = await request(app).get('/api/history?series=node.cpu,node.disk&entity=pve&range=1h');
  assert.equal(res.status, 200);
  for (const s of res.body.series) {
    assert.equal(s.ok, false);
    assert.equal(s.error, 'Prometheus answered HTTP 502');
    assert.equal(s.lines, undefined);
  }
});
