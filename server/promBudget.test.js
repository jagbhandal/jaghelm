/**
 * The Prometheus queries of one refresh cycle (#234). The services refresh and
 * the UPS refresh run against a mock Prometheus that counts the instant
 * queries it answers (testing/mockPrometheus.js, series shaped like the
 * homelab's), with 6 nodes and with 12. They used to ask 14 per node, 2 more
 * every cycle for the NAS and 4 for the UPS: 90 a cycle with 6 nodes.
 *
 * Then #232's rules on what a failed query holds, with one query covering every
 * node: the push snapshot built from the refreshed caches.
 *
 * Tests share module state (config, cache, registries) and run in order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMockPrometheus, homelabSeries } from './testing/mockPrometheus.js';

const { initDiscovery } = await import('./discovery.js');
const { saveConfig } = await import('./config.js');
const { getCached } = await import('./cache.js');
const { refreshServices, refreshUPS } = await import('./refresh.js');
const { buildSnapshot } = await import('./push/snapshot.js');

const realFetch = globalThis.fetch;
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const UPS_SERIES = [
  ['nut_status', 1],
  ['nut_battery_charge', 1],
  ['nut_battery_runtime_seconds', 2100],
  ['nut_load', 0.25],
];

/** The homelab with `nodes` nodes and a UPS behind a fresh mock Prometheus, all configured. */
function homelab(nodes) {
  const { labels, series } = homelabSeries({ nodes });
  for (const [name, value] of UPS_SERIES) {
    series.push({ labels: { __name__: name, ups: 'apcups', instance: 'vm1:9199', job: 'nut-ups' }, value });
  }
  const mock = createMockPrometheus(series);
  initDiscovery(mock.url);
  globalThis.fetch = mock.fetch;
  saveConfig({ nodes: Object.fromEntries(labels.map((l) => [l, { display_name: l }])), services: {} });
  return { labels, mock };
}

/** One cycle's refreshes; how many queries each asked. */
async function cycle(mock) {
  const before = mock.queries.length;
  await Promise.all([refreshServices(), refreshUPS()]);
  const asked = mock.queries.slice(before);
  const ups = asked.filter((q) => q.includes('nut_')).length;
  return { services: asked.length - ups, ups };
}

for (const nodes of [6, 12]) {
  test(`a refresh cycle with ${nodes} nodes asks at most 14 queries, and 1 for the UPS`, async () => {
    const { labels, mock } = homelab(nodes);
    for (let i = 0; i < 3; i += 1) {
      const asked = await cycle(mock);
      assert.ok(asked.services <= 14, `cycle ${i}: ${asked.services} queries`);
      assert.equal(asked.ups, 1, `cycle ${i}`);
    }
    assert.deepEqual(mock.parseErrors, []);

    const services = getCached('services');
    assert.equal(services.sources.prometheus.ok, true);
    assert.deepEqual(Object.keys(services.nodes), labels);
    for (const label of labels) {
      assert.equal(services.nodes[label].reachable, true, label);
      assert.deepEqual(services.nodes[label].failedReads, []);
    }
    assert.deepEqual(getCached('ups'), { status: 1, charge: 100, runtime: 2100, load: 25, ok: true });
  });
}

test('the UPS query failing makes the UPS payload not ok, with every value null', async () => {
  const { mock } = homelab(6);
  mock.fail = (q) => q.includes('nut_');
  await cycle(mock);
  assert.deepEqual(getCached('ups'), { status: null, charge: null, runtime: null, load: null, ok: false });
  assert.equal(getCached('services').sources.prometheus.ok, true, 'the node queries answered');
});

// ── #232, batched ────────────────────────────────────────────────────────

const caches = { getCached, getAllCronStatuses: () => [], now: () => 0 };
const setValue = (mock, name, node, value) => {
  for (const s of mock.series) if (s.labels.__name__ === name && s.labels.node === node) s.value = value;
};

test('the up query failing holds every host\'s reachability, even one whose up just went to 0', async () => {
  const { labels, mock } = homelab(6);
  await cycle(mock);
  const prev = buildSnapshot(caches, null);
  assert.equal(prev.hosts.pi1.reachable, true);

  setValue(mock, 'up', 'pi1', 0);
  mock.fail = (q) => q.startsWith('max by (node) (up{');
  await cycle(mock);
  const services = getCached('services');
  assert.equal(services.sources.prometheus.ok, false);
  for (const label of labels) assert.deepEqual(services.nodes[label].failedReads, ['reachable'], label);
  const held = buildSnapshot(caches, prev);
  for (const label of labels) assert.equal(held.hosts[label].reachable, true, `${label} held`);

  mock.fail = null;
  await cycle(mock);
  const after = buildSnapshot(caches, held);
  assert.equal(after.hosts.pi1.reachable, false, 'read again once the query answers');
  assert.equal(after.hosts.pi2.reachable, true);
});

test('a metric query failing holds that metric for every host, and only that metric', async () => {
  const { labels, mock } = homelab(6);
  await cycle(mock);
  const prev = buildSnapshot(caches, null);

  for (const label of labels) {
    const total = mock.series.find((s) => s.labels.__name__ === 'node_memory_MemTotal_bytes' && s.labels.node === label).value;
    setValue(mock, 'node_memory_MemAvailable_bytes', label, total * 0.05);
  }
  mock.fail = (q) => q.includes('node_cpu_seconds_total');
  await cycle(mock);
  const held = buildSnapshot(caches, prev);
  for (const label of labels) {
    assert.deepEqual(getCached('services').nodes[label].failedReads, ['cpu'], label);
    assert.equal(held.hosts[label].cpu, prev.hosts[label].cpu, `${label} cpu held`);
    assert.ok(held.hosts[label].cpu > 0);
    assert.equal(held.hosts[label].mem, 0.95, `${label} memory read this cycle`);
    assert.equal(held.hosts[label].reachable, true);
  }
});
