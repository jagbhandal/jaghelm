/**
 * The services refresh and Kuma's heartbeat strips (#312): /api/services
 * carries each monitored service's beats (`beats`, by uid, kumaBeats.js
 * encodeBeats), Kuma's own from its status page, else one sampled a cycle
 * from /metrics, at most 50 either way, and none for a service with no
 * monitor. The real refresh runs against a mock Prometheus (two Pis and a
 * vm: adguard on the Pis, gitea and grafana on the vm) and a stubbed Kuma.
 *
 * Tests share module state (config, cache, the Kuma cache, the beat store)
 * and run in order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMockPrometheus, homelabSeries } from './testing/mockPrometheus.js';

const { initDiscovery } = await import('./discovery.js');
const { initMonitors } = await import('./monitors.js');
const { saveConfig } = await import('./config.js');
const { getCached } = await import('./cache.js');
const { refreshServices } = await import('./refresh.js');
const { decodeBeats } = await import('./kumaBeats.js');

const KUMA = 'http://localhost:9996';
const kumaTime = (ms) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');

const { labels, series } = homelabSeries({ nodes: 3 }); // pi1, pi2, vm1
const prometheus = createMockPrometheus(series);
initDiscovery(prometheus.url);
saveConfig({
  nodes: Object.fromEntries(labels.map((l) => [l, { display_name: l }])),
  services: {},
});

// What Kuma answers: `mode` 'status-page' (heartbeatList with `beats`
// beats each), 'metrics', or 'down' (HTTP 500 for everything).
const kuma = { mode: 'status-page', beats: 80, gitea: 1 };

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function kumaAnswer(url) {
  if (kuma.mode === 'down') return json(500, {});
  const { pathname } = new URL(url);
  if (pathname === '/metrics') {
    if (kuma.mode !== 'metrics') return json(404, {});
    const text = [
      `monitor_status{monitor_id="1",monitor_name="AdGuard"} 1`,
      `monitor_response_time{monitor_id="1",monitor_name="AdGuard"} 12`,
      `monitor_status{monitor_id="2",monitor_name="Gitea"} ${kuma.gitea}`,
      `monitor_response_time{monitor_id="2",monitor_name="Gitea"} 40`,
    ].join('\n');
    return new Response(text, { status: 200 });
  }
  const now = Date.now();
  const list = (status, ping) =>
    Array.from({ length: kuma.beats }, (_, i) => ({
      status: i === kuma.beats - 1 ? status : 1,
      ping,
      time: kumaTime(now - (kuma.beats - 1 - i) * 60_000),
    }));
  if (pathname === '/api/status-page/default') {
    return json(200, {
      publicGroupList: [{ monitorList: [{ id: 1, name: 'AdGuard' }, { id: 2, name: 'Gitea' }] }],
    });
  }
  if (pathname === '/api/status-page/heartbeat/default') {
    return json(200, { heartbeatList: { 1: list(1, 12), 2: list(kuma.gitea, 40) }, uptimeList: {} });
  }
  throw new Error(`unexpected Kuma request ${url}`);
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) =>
  String(url).startsWith(KUMA) ? kumaAnswer(String(url)) : prometheus.fetch(url);
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const beatsOf = (uid) => decodeBeats(getCached('services').beats?.[uid]);

test("status page: each monitored service carries Kuma's own beats, the newest 50", async () => {
  initMonitors(KUMA);
  kuma.gitea = 0;
  await refreshServices();
  const services = getCached('services');
  assert.ok(services.beats, '/api/services has beats');
  const gitea = beatsOf('vm1:gitea');
  assert.equal(gitea.length, 50, 'at most 50 whatever Kuma sends (it sent 80)');
  assert.deepEqual(
    gitea.slice(-2).map((b) => [b.word, b.ping]),
    [
      ['Up', 40],
      ['Down', 40],
    ],
    'newest last'
  );
  assert.equal(gitea.at(-1).time - gitea.at(-2).time, 60_000, "at Kuma's interval");
  // AdGuard runs on both Pis: one monitor, on the card that got it.
  assert.equal(beatsOf('pi1:adguard').length, 50);
});

test('a service with no monitor has no beats', async () => {
  const services = getCached('services');
  const cards = Object.values(services.nodes).flatMap((n) => n.services);
  const grafana = cards.find((c) => c.uid === 'vm1:grafana');
  assert.ok(grafana, 'grafana has a card');
  assert.equal(grafana.monitored, false);
  assert.equal(services.beats['vm1:grafana'], undefined);
  for (const uid of Object.keys(services.beats)) {
    assert.ok(['pi1:adguard', 'vm1:gitea'].includes(uid), `${uid} has a monitor`);
  }
});

test('/metrics: one beat a cycle, in a ring that never grows past 50', async () => {
  initMonitors(KUMA, 'uk1_test'); // pragma: allowlist secret
  kuma.mode = 'metrics';
  kuma.gitea = 1;
  await refreshServices();
  // Kuma's beats from the status page were the last answer; a ring starts from them.
  for (let i = 1; i <= 54; i += 1) {
    if (i === 54) kuma.gitea = 0;
    await refreshServices();
    const n = beatsOf('vm1:gitea').length;
    assert.ok(n <= 50, `cycle ${i}: ${n} beats`);
  }
  const gitea = beatsOf('vm1:gitea');
  assert.equal(gitea.length, 50);
  assert.deepEqual(
    gitea.slice(-2).map((b) => [b.word, b.ping]),
    [
      ['Up', 40],
      ['Down', null],
    ]
  );
});

test('a cycle that could not read Kuma adds a beat with no data', async () => {
  kuma.mode = 'down';
  await refreshServices();
  const gitea = beatsOf('vm1:gitea');
  assert.equal(gitea.length, 50);
  assert.deepEqual(
    gitea.slice(-2).map((b) => b.word),
    ['Down', 'No data']
  );
  assert.equal(getCached('services').sources.kuma.ok, false);
});
