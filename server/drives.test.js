/**
 * The drive source (drives.js, #727): the queries it makes, the records it
 * builds from the exporter's real output (server/fixtures/smartctl-*.metrics,
 * serials redacted), its optional-module paths and its cache.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHE_TTL_MS,
  FAILURE_TTL_MS,
  createDrivesCache,
  driveQueries,
  drivesEnabled,
  normalise,
} from './drives.js';
import { resolveEntity } from './promHistory.js';
import { smartctlProm, smartctlText } from './testing/smartctlProm.js';

const CONFIG = { nodes: { nas: {}, pve: {}, pi: {} } };
const target = resolveEntity({ kind: 'node', entity: null }, CONFIG);
const NODES = {
  nas: { text: smartctlText('smartctl-nas.metrics') },
  pve: { text: smartctlText('smartctl-pve.metrics') },
};
const silent = { warn() {}, info() {} };

/** The records for the real output of both nodes, with `growth`. */
async function readBoth(growth = {}) {
  const prom = smartctlProm({ nodes: NODES, growth, matcher: target.matcher });
  const cache = createDrivesCache({ query: prom.query, logger: silent });
  return { data: await cache.read(CONFIG), prom };
}

test('no query selects the serial number: the info series is aggregated by name', () => {
  for (const [name, q] of Object.entries(driveQueries('node=~"nas"'))) {
    assert.ok(!/serial/i.test(q), name);
  }
  assert.match(driveQueries('node=~"nas"').info, /^max by \(node, device, model_name, protocol\)/);
});

test('temperature is read for temperature_type="current" only', () => {
  assert.match(driveQueries('node=~"nas"').temperature, /temperature_type="current"/);
});

test('growth: one delta per sector attribute id, one increase for the media errors, over 7 days', () => {
  const q = driveQueries('node=~"nas"');
  for (const id of [5, 197, 198]) {
    assert.match(q[`growth${id}`], new RegExp(`delta\\(smartctl_device_attribute\\{.*attribute_id="${id}".*\\[7d\\]\\)`));
  }
  assert.match(q.mediaGrowth, /increase\(smartctl_device_media_errors\{.*\[7d\]\)/);
});

test('the NAS: three spinning drives, from the exporter’s real output', async () => {
  const { data } = await readBoth();
  const nas = data.nodes.nas;
  assert.equal(nas.devices, 3);
  assert.equal(nas.scrapeUp, true);
  assert.deepEqual(
    nas.drives.map((d) => [d.device, d.model, d.type, d.smartPassed, d.temperature, d.exitStatus]),
    [
      ['sda', 'ST8000VN004-3CP101', 'hdd', true, 40, 0],
      ['sdb', 'ST8000VN004-3CP101', 'hdd', true, 42, 0],
      ['sdc', 'ST8000VN004-3CP101', 'hdd', true, 39, 0],
    ]
  );
  const sda = nas.drives[0];
  assert.equal(sda.powerOnSeconds, 19_872_000);
  assert.deepEqual(sda.sectors, {
    reallocated: { count: 0, grew: false },
    pending: { count: 0, grew: false },
    uncorrectable: { count: 0, grew: false },
  });
  // Nothing NVMe about a SATA drive.
  assert.equal(sda.mediaErrors, null);
  assert.equal(sda.criticalWarning, null);
  assert.equal(sda.availableSpare, null);
});

test('pve: one NVMe, its temperature the current one, not the drive’s own limits', async () => {
  const { data } = await readBoth();
  const pve = data.nodes.pve;
  assert.equal(pve.devices, 1);
  const [nvme] = pve.drives;
  assert.equal(nvme.device, 'nvme0');
  assert.equal(nvme.model, 'CT1000P310SSD8');
  assert.equal(nvme.type, 'nvme');
  assert.equal(nvme.temperature, 30); // not 83 or 85
  assert.equal(nvme.smartPassed, true);
  assert.equal(nvme.criticalWarning, 0);
  assert.equal(nvme.availableSpare, 100);
  assert.equal(nvme.spareThreshold, 5);
  assert.equal(nvme.percentageUsed, 2);
  assert.deepEqual(nvme.mediaErrors, { count: 0, grew: false });
  assert.equal(nvme.sectors, null);
});

test('a serial number, or anything derived from one, is in no record', async () => {
  const { data } = await readBoth();
  const json = JSON.stringify(data);
  assert.ok(!/serial/i.test(json));
  assert.ok(!json.includes('REDACTED'));
  // The fixtures themselves carry none (the redaction is the label's value).
  for (const f of ['smartctl-nas.metrics', 'smartctl-pve.metrics']) {
    const labels = [...smartctlText(f).matchAll(/serial_number="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(labels.length > 0 && labels.every((v) => v === 'REDACTED'), f);
  }
});

test('growth over the window marks the counter that grew, and only that one', async () => {
  const { data } = await readBoth({
    'nas/sdb': { 5: 3, 197: 0, 198: -2 }, // a drop is a reset, not growth
    'pve/nvme0': { media: 4 },
  });
  assert.deepEqual(data.nodes.nas.drives[1].sectors, {
    reallocated: { count: 0, grew: true },
    pending: { count: 0, grew: false },
    uncorrectable: { count: 0, grew: false },
  });
  assert.equal(data.nodes.nas.drives[0].sectors.reallocated.grew, false);
  assert.equal(data.nodes.pve.drives[0].mediaErrors.grew, true);
});

test('no history, no growth: a window with nothing in it marks nothing', async () => {
  const { data } = await readBoth({});
  for (const d of data.nodes.nas.drives) {
    assert.ok(Object.values(d.sectors).every((s) => s.grew === false));
  }
});

test('the drive kind: NVMe by protocol or device name, else spinning or solid state by the rotation rate', () => {
  const sample = (metric, v) => ({ metric, value: [0, String(v)] });
  const lineOf = () => ['n'];
  const r = {
    info: [
      sample({ node: 'n', device: 'sda', model_name: 'A', protocol: 'ATA' }, 1),
      sample({ node: 'n', device: 'sdb', model_name: 'B', protocol: 'ATA' }, 1),
      sample({ node: 'n', device: 'sdc', model_name: 'C', protocol: 'ATA' }, 1),
      sample({ node: 'n', device: 'nvme1', model_name: 'D', protocol: '' }, 1),
      sample({ node: 'n', device: 'x', model_name: 'E', protocol: 'NVMe' }, 1),
    ],
    values: [
      sample({ __name__: 'smartctl_device_rotation_rate', node: 'n', device: 'sda' }, 7200),
      sample({ __name__: 'smartctl_device_rotation_rate', node: 'n', device: 'sdb' }, 0),
    ],
  };
  const types = Object.fromEntries(normalise(r, lineOf).nodes.n.drives.map((d) => [d.device, d.type]));
  assert.deepEqual(types, { nvme1: 'nvme', sda: 'hdd', sdb: 'ssd', sdc: 'sata', x: 'nvme' });
});

test('a node label no JagHelm node has is ignored and reported', () => {
  const sample = (metric, v) => ({ metric, value: [0, String(v)] });
  const lineOf = (m) => (m.node === 'nas' ? ['nas'] : []);
  const out = normalise(
    {
      info: [
        sample({ node: 'nas', device: 'sda' }, 1),
        sample({ node: 'ghost', device: 'sda' }, 1),
      ],
      devices: [sample({ node: 'ghost' }, 1)],
    },
    lineOf
  );
  assert.deepEqual(Object.keys(out.nodes), ['nas']);
  assert.deepEqual(out.unmatched, ['ghost']);
});

test('a node whose exporter reports no devices is a node with devices 0 and no drives', () => {
  const out = normalise(
    { devices: [{ metric: { node: 'nas' }, value: [0, '0'] }], up: [{ metric: { node: 'nas' }, value: [0, '1'] }] },
    () => ['nas']
  );
  assert.deepEqual(out.nodes.nas, { devices: 0, scrapeUp: true, drives: [] });
});

// ── The optional module ──────────────────────────────────────────────────

test('with no smartctl series, the probe is the only query and the answer is empty', async () => {
  const prom = smartctlProm({ nodes: {}, matcher: target.matcher });
  const cache = createDrivesCache({ query: prom.query, logger: silent });
  assert.deepEqual(await cache.read(CONFIG), { enabled: true, nodes: {} });
  assert.deepEqual(prom.asked, ['probe']);
});

test('JAGHELM_DRIVES=off turns the module off even when series exist: not one query', async () => {
  const prom = smartctlProm({ nodes: NODES, matcher: target.matcher });
  const cache = createDrivesCache({
    query: prom.query,
    enabled: () => drivesEnabled({ env: { JAGHELM_DRIVES: 'off' } }),
    logger: silent,
  });
  assert.deepEqual(await cache.read(CONFIG), { enabled: false });
  assert.deepEqual(prom.asked, []);
});

test('drivesEnabled: on by default, off by the environment or a stored switch', () => {
  assert.equal(drivesEnabled({ env: {} }), true);
  assert.equal(drivesEnabled({ env: { JAGHELM_DRIVES: 'on' } }), true);
  assert.equal(drivesEnabled({ env: { JAGHELM_DRIVES: 'OFF' } }), false);
  assert.equal(drivesEnabled({ env: { JAGHELM_DRIVES: 'junk' } }), true); // the default; the boot warns
  assert.equal(drivesEnabled({ env: {}, stored: false }), false);
  assert.equal(drivesEnabled({ env: {}, stored: true }), true);
  assert.equal(drivesEnabled({ env: { JAGHELM_DRIVES: 'off' }, stored: true }), false);
});

test('no node in services.yaml: nothing to ask', async () => {
  const prom = smartctlProm({ nodes: NODES });
  const cache = createDrivesCache({ query: prom.query, logger: silent });
  assert.deepEqual(await cache.read({ nodes: {} }), { enabled: true, nodes: {} });
  assert.deepEqual(prom.asked, []);
});

// ── The cache ────────────────────────────────────────────────────────────

test('readers share one answer for CACHE_TTL_MS, then ask again', async () => {
  let at = 1_000_000;
  const prom = smartctlProm({ nodes: NODES, matcher: target.matcher });
  const cache = createDrivesCache({ query: prom.query, now: () => at, logger: silent });
  const [a, b] = await Promise.all([cache.read(CONFIG), cache.read(CONFIG)]);
  assert.strictEqual(a, b);
  const first = prom.asked.length;
  assert.equal(first, 11, 'the probe and ten reads');
  at += CACHE_TTL_MS - 1;
  assert.strictEqual(await cache.read(CONFIG), a);
  assert.equal(prom.asked.length, first);
  at += 2;
  await cache.read(CONFIG);
  assert.equal(prom.asked.length, first * 2);
});

test('a failed read is null, kept FAILURE_TTL_MS, logged once until it changes', async () => {
  let at = 1_000_000;
  let calls = 0;
  const warned = [];
  const cache = createDrivesCache({
    query: async () => {
      calls += 1;
      throw Object.assign(new Error('boom'), { failure: 'unreachable' });
    },
    now: () => at,
    logger: { warn: (...a) => warned.push(a), info() {} },
  });
  assert.equal(await cache.read(CONFIG), null);
  assert.equal(await cache.read(CONFIG), null);
  assert.equal(calls, 1, 'kept briefly');
  at += FAILURE_TTL_MS + 1;
  assert.equal(await cache.read(CONFIG), null);
  assert.equal(calls, 2);
  assert.equal(warned.length, 1, 'logged once while the cause holds');
  assert.ok(!JSON.stringify(warned).includes('serial'));
});

test('a node label no node has is warned once, until the set changes', async () => {
  let at = 1_000_000;
  const warned = [];
  const prom = smartctlProm({ nodes: { ...NODES, ghost: NODES.pve }, matcher: target.matcher });
  const cache = createDrivesCache({
    query: prom.query,
    now: () => at,
    logger: { warn: (...a) => warned.push(a), info() {} },
  });
  const data = await cache.read(CONFIG);
  assert.deepEqual(Object.keys(data.nodes).sort(), ['nas', 'pve']);
  at += CACHE_TTL_MS + 1;
  await cache.read(CONFIG);
  assert.equal(warned.length, 1);
});
