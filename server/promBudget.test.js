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

const { initDiscovery, NODE_QUERIES } = await import('./discovery.js');
const { saveConfig } = await import('./config.js');
const { getCached, getCachedInternal } = await import('./cache.js');
const { refreshServices, refreshUPS } = await import('./refresh.js');
const { snapshotAfter } = await import('./testing/pushPipeline.js');

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
const UPS_TARGET = { ups: 'apcups', instance: 'vm1:9199', job: 'nut-ups' };
// The exporter's info series, with the labels it has live (values made up).
const UPS_INFO = {
  __name__: 'nut_ups_info',
  ...UPS_TARGET,
  description: 'Example UPS 900',
  model: 'UPS 900',
  manufacturer: 'Example Power',
  driver: 'usbhid-ups',
  driver_version: '2.8.1',
  nut_version: '2.8.1',
  usb_vendor_id: '0f0f',
  usb_product_id: '0002',
  ups_firmware: '9.Z1',
  battery_type: 'PbAc',
  device_type: 'ups',
  type: 'ups',
};

/**
 * The homelab with `nodes` nodes behind a fresh mock Prometheus, all configured.
 * `ups`: 'up' (the exporter reports a UPS), 'quiet' (it did within the last
 * 7 days and has gone quiet) or 'none' (never had one).
 */
function homelab(nodes, { ups = 'up' } = {}) {
  const { labels, series } = homelabSeries({ nodes });
  if (ups === 'up') {
    for (const [name, value] of UPS_SERIES) series.push({ labels: { __name__: name, ...UPS_TARGET }, value });
  }
  if (ups !== 'none') series.push({ labels: UPS_INFO, value: 1, quiet: ups === 'quiet' });
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
  test(`a refresh cycle with ${nodes} nodes asks NODE_QUERIES (at most 14) queries, and 1 for the UPS`, async () => {
    const { labels, mock } = homelab(nodes);
    assert.ok(NODE_QUERIES <= 14, `${NODE_QUERIES} node queries`);
    for (let i = 0; i < 3; i += 1) {
      const asked = await cycle(mock);
      // Exactly: a cycle that asked nothing (or skipped the nodes) fails too.
      assert.equal(asked.services, NODE_QUERIES, `cycle ${i}`);
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
    assert.deepEqual(getCached('ups'), {
      status: 1,
      charge: 100,
      runtime: 2100,
      load: 25,
      ok: true,
      configured: true,
      model: 'Example UPS 900',
    });
  });
}

test('the UPS query failing makes the UPS payload not ok, with every value null and configured not known', async () => {
  const { mock } = homelab(6);
  mock.fail = (q) => q.includes('nut_');
  await cycle(mock);
  assert.deepEqual(getCached('ups'), {
    status: null,
    charge: null,
    runtime: null,
    load: null,
    ok: false,
    configured: null,
    model: null,
  });
  assert.equal(getCached('services').sources.prometheus.ok, true, 'the node queries answered');
});

// ── Whether a UPS is set up (#272) ───────────────────────────────────────

test('a UPS whose exporter has gone quiet is still set up: no readings, its model kept', async () => {
  const { mock } = homelab(6, { ups: 'quiet' });
  const asked = await cycle(mock);
  assert.equal(asked.ups, 1, 'still one query');
  assert.deepEqual(mock.parseErrors, []);
  assert.deepEqual(getCached('ups'), {
    status: null,
    charge: null,
    runtime: null,
    load: null,
    ok: true,
    configured: true,
    model: 'Example UPS 900',
  });
});

test('an install that has never had a UPS answers configured false', async () => {
  const { mock } = homelab(6, { ups: 'none' });
  await cycle(mock);
  assert.deepEqual(mock.parseErrors, []);
  assert.deepEqual(getCached('ups'), {
    status: null,
    charge: null,
    runtime: null,
    load: null,
    ok: true,
    configured: false,
    model: null,
  });
});

test('the model falls back to the model label, and nothing else from the info series is sent', async () => {
  const { mock } = homelab(6);
  const info = mock.series.find((s) => s.labels.__name__ === 'nut_ups_info');
  info.labels = { ...info.labels };
  delete info.labels.description;
  await cycle(mock);
  const ups = getCached('ups');
  assert.equal(ups.model, 'UPS 900');
  assert.deepEqual(Object.keys(ups).sort(), ['charge', 'configured', 'load', 'model', 'ok', 'runtime', 'status']);
  const body = JSON.stringify(ups);
  for (const leak of ['vm1:9199', 'usbhid-ups', '0f0f', 'Example Power', 'nut-ups']) {
    assert.ok(!body.includes(leak), `${leak} in ${body}`);
  }
});

// ── #232, batched ────────────────────────────────────────────────────────

const caches = { getCached, getCachedInternal, getAllCronStatuses: () => [] };
// The push snapshot of this cycle's caches after `prev`, built from the model (#292).
const buildSnapshot = (c, prev) => snapshotAfter(c, prev).snapshot;
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
    assert.equal(held.hosts[label].levels.cpu, prev.hosts[label].levels.cpu, `${label} cpu held`);
    assert.equal(held.hosts[label].levels.mem, 'warn', `${label} memory read this cycle: 95 %`);
    assert.equal(held.hosts[label].reachable, true);
  }
});
