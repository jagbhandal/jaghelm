/**
 * The status model's live seam and its determinism (#290): readStatusInputs
 * reads what the push snapshot reads, the tracker carries the memory, and the
 * same inputs, memory and clock give the same model byte for byte, whatever
 * order the payloads list things in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NOW,
  card,
  cronNode,
  cronRun,
  cycles,
  inputs,
  missing,
  monitored,
  node,
} from '../testing/statusFixtures.js';
import { buildStatus, proxmoxPools } from './model.js';
import { createStatusTracker, memoryFromLevels, readStatusInputs } from './index.js';
import { DEFAULT_THRESHOLDS } from './thresholds.js';

const T = DEFAULT_THRESHOLDS;

test('readStatusInputs: the cached payloads, what is kept beside the services one, the cron store, and the env', () => {
  const services = { nodes: {}, sources: { prometheus: { ok: true }, kuma: { ok: true } } };
  const internal = { upWithoutCard: ['a:b'] };
  const read = [];
  const caches = {
    getCached: (key) => (read.push(key), { services, ups: 'U', integrations: 'I' }[key] ?? null),
    getCachedInternal: (key) => (key === 'services' ? internal : null),
    getAllCronStatuses: () => 'C',
  };
  const got = readStatusInputs(caches, {
    cycleErrors: ['gitea'],
    env: { KUMA_URL: 'http://k', GITEA_URL: '' },
  });
  assert.deepEqual(got, {
    services,
    servicesInternal: internal,
    ups: 'U',
    integrations: 'I',
    cron: 'C',
    backupJobs: [],
    arcaneAgents: null,
    kumaConfigured: true,
    giteaConfigured: false,
    cycleErrors: ['gitea'],
  });
  assert.deepEqual(read.sort(), ['integrations', 'services', 'ups']);
});

test('tracker: current() is null before the first update, then the last status; memory carries across updates', () => {
  const tracker = createStatusTracker();
  assert.equal(tracker.current(), null);
  const hot = inputs({ nodes: { n1: node({ cpu: '97' }) } });
  const first = tracker.update({ inputs: hot, thresholds: T, now: NOW });
  assert.equal(tracker.current(), first);
  const second = tracker.update({ inputs: hot, thresholds: T, now: NOW + 30_000 });
  assert.equal(first.entities[0].state, 'ok');
  assert.equal(
    second.entities.find((e) => e.id === 'nodes/n1').state,
    'warn',
    'the second cycle at 97 % warns'
  );
});

test('tracker: `seed` is asked once, before the first build, with the thresholds; its memory is where the model starts (#361)', () => {
  const asked = [];
  const tracker = createStatusTracker({
    seed: (thresholds) => {
      asked.push(thresholds);
      return memoryFromLevels({ n1: { mem: 'warn', disk: 'crit' } });
    },
  });
  // Memory at 87 %, disk at 91 %: inside the bands, so still over their lines.
  const banded = inputs({ nodes: { n1: node({ memPercent: '87', diskPercent: '91' }) } });
  const first = tracker.update({ inputs: banded, thresholds: T, now: NOW });
  tracker.update({ inputs: banded, thresholds: T, now: NOW + 30_000 });
  assert.deepEqual(asked, [T], 'once');
  const n1 = first.entities.find((e) => e.id === 'nodes/n1');
  assert.deepEqual([n1.conditions.mem, n1.conditions.disk, n1.state], ['warn', 'crit', 'crit']);
  assert.equal(
    n1.reason,
    'Disk 91 % (critical until below 90 %) · Memory 87 % (warning until below 85 %)'
  );

  // Unseeded, the same readings are judged fresh: memory under its line, the
  // disk over its warn line only.
  const fresh = createStatusTracker().update({ inputs: banded, thresholds: T, now: NOW });
  const conditions = fresh.entities.find((e) => e.id === 'nodes/n1').conditions;
  assert.deepEqual([conditions.mem, conditions.disk], ['ok', 'warn']);
  // A seed with nothing for a node (or no seed at all: null) changes nothing.
  const none = createStatusTracker({ seed: () => null }).update({
    inputs: banded,
    thresholds: T,
    now: NOW,
  });
  assert.deepEqual(none, fresh);
});

test('memoryFromLevels: given the configured nodes, it seeds only those', () => {
  const memory = memoryFromLevels(
    { n1: { cpu: 'warn' }, gone: { disk: 'warn' } },
    { nodes: ['n1', 'n2'] }
  );
  assert.deepEqual(Object.keys(memory.entities), ['nodes/n1']);
  assert.deepEqual(Object.keys(memoryFromLevels({ n1: {} }, { nodes: [] }).entities), []);
});

test("memoryFromLevels: only each node's levels; a node it seeds that Prometheus no longer reports is dropped", () => {
  const memory = memoryFromLevels({ n1: { cpu: 'warn' }, gone: { disk: 'warn' }, junk: null });
  assert.deepEqual(Object.keys(memory.entities), ['nodes/n1', 'nodes/gone']);
  assert.deepEqual(memory.entities['nodes/n1'].memo, { levels: { cpu: 'warn' }, streak: {} });
  const tracker = createStatusTracker({ seed: () => memory });
  const status = tracker.update({
    inputs: inputs({ nodes: { n1: node() } }),
    thresholds: T,
    now: NOW,
  });
  assert.deepEqual(
    status.entities.filter((e) => e.kind === 'node').map((e) => e.id),
    ['nodes/n1']
  );
});

function board(order = (list) => list) {
  const services = order([
    missing('n1:redis'),
    monitored('n1:app', 'down'),
    card('n1:alloy'),
    monitored('n1:db', 'up'),
  ]);
  const nodes = Object.fromEntries(
    order([
      ['n1', node({ diskPercent: '92' }, { services })],
      ['n2', node({}, { reachable: false })],
    ])
  );
  return inputs({
    nodes,
    cron: order([
      cronNode('n1', { a: cronRun('failure'), b: cronRun('success') }),
      cronNode('n2', { c: cronRun('success') }),
    ]),
    integrations: Object.fromEntries(
      order([
        ['x', { _error: 'HTTP 500', _status: { state: 'backing_off', since: NOW - 5 } }],
        ['y', { _status: { state: 'ok', since: NOW - 9 } }],
      ])
    ),
  });
}

test('buildStatus: the same inputs, memory and clock give the same model, byte for byte', () => {
  const a = buildStatus({ inputs: board(), thresholds: T, memory: null, now: NOW });
  const b = buildStatus({ inputs: board(), thresholds: T, memory: null, now: NOW });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const a2 = buildStatus({ inputs: board(), thresholds: T, memory: a.memory, now: NOW + 30_000 });
  const b2 = buildStatus({ inputs: board(), thresholds: T, memory: b.memory, now: NOW + 30_000 });
  assert.equal(JSON.stringify(a2), JSON.stringify(b2));
});

test('buildStatus: the order the payloads list nodes, cards, jobs and integrations in changes nothing', () => {
  const forward = buildStatus({ inputs: board(), thresholds: T, now: NOW }).status;
  const reversed = buildStatus({
    inputs: board((list) => [...list].reverse()),
    thresholds: T,
    now: NOW,
  }).status;
  assert.equal(JSON.stringify(reversed), JSON.stringify(forward));
});

test('buildStatus: a steady board gives the same status every cycle (an ETag would hold)', () => {
  const tracker = createStatusTracker();
  const seen = new Set();
  for (let i = 0; i < 5; i++)
    seen.add(
      JSON.stringify(tracker.update({ inputs: board(), thresholds: T, now: NOW + i * 30_000 }))
    );
  // Nothing on it moves (no CPU or pending run in progress), so all five are one.
  assert.equal(seen.size, 1);
});

test('buildStatus: since is when an entity entered its state, kept while it holds', () => {
  const tracker = createStatusTracker();
  const at = (i, d) =>
    tracker.update({
      inputs: inputs({ nodes: { n1: node({ diskPercent: d }) } }),
      thresholds: T,
      now: NOW + i * 30_000,
    });
  const since = (s) => s.entities.find((e) => e.id === 'nodes/n1').since;
  assert.equal(since(at(0, '50')), NOW);
  assert.equal(since(at(1, '91')), NOW + 30_000);
  assert.equal(since(at(2, '93')), NOW + 30_000, 'still warn');
  assert.equal(since(at(3, '96')), NOW + 90_000, 'crit now');
  assert.equal(since(at(4, '40')), NOW + 120_000, 'ok again');
});

test('buildStatus: the memory is not part of the status', () => {
  const { status, memory } = buildStatus({
    inputs: inputs({ nodes: { n1: node({ cpu: '95' }) } }),
    thresholds: T,
    now: NOW,
  });
  assert.equal(JSON.stringify(status).includes('memo'), false);
  assert.ok(memory.entities['nodes/n1'].memo.streak.cpu);
});

// ── #462: a reading with no value for a cycle ────────────────────────────

/** The model over `temps` (°C, null for no reading), one a cycle, on node n1. */
function temperatures(temps, tracker = createStatusTracker(), start = 0) {
  return temps.map((temp, i) => {
    const status = tracker.update({
      inputs: inputs({ nodes: { n1: node({ temp: temp === null ? null : String(temp) }) } }),
      thresholds: T,
      now: NOW + (start + i) * 30_000,
    });
    return status.entities.find((e) => e.id === 'nodes/n1');
  });
}

test('#462: 78 → no reading → 73 → 76 °C is one warning in the model, since its first cycle', () => {
  const n1 = temperatures([78, null, 73, 76, 69]);
  assert.deepEqual(
    n1.map((e) => [e.state, e.conditions.temp, e.reason]),
    [
      ['warn', 'warn', 'Temperature 78 °C (warning above 75 °C)'],
      ['warn', 'unknown', 'Temperature: no reading (warning held until below 70 °C)'],
      ['warn', 'warn', 'Temperature 73 °C (warning until below 70 °C)'],
      ['warn', 'warn', 'Temperature 76 °C (warning above 75 °C)'],
      ['ok', 'ok', 'Healthy'],
    ]
  );
  assert.deepEqual(
    n1.slice(0, 4).map((e) => e.since),
    [NOW, NOW, NOW, NOW],
    'one episode: its since never moves'
  );
});

test("#462: CPU's run of cycles over its line survives a cycle with no reading", () => {
  const tracker = createStatusTracker();
  const cpu = (value, i) =>
    tracker
      .update({
        inputs: inputs({ nodes: { n1: node({ cpu: value }) } }),
        thresholds: T,
        now: NOW + i * 30_000,
      })
      .entities.find((e) => e.id === 'nodes/n1');
  // 95 %, no reading, 95 %: its second cycle over the line, so it warns.
  assert.deepEqual(
    ['95', null, '95'].map((v, i) => cpu(v, i).state),
    ['ok', 'ok', 'warn']
  );
  // A warning it holds survives one too, and so does its hysteresis band.
  assert.deepEqual(
    [null, '87', '84'].map((v, i) => {
      const e = cpu(v, 3 + i);
      return [e.state, e.conditions.cpu];
    }),
    [
      ['warn', 'unknown'],
      ['warn', 'warn'],
      ['ok', 'ok'],
    ]
  );
});

test('#462: a reading that never comes back holds its level until its node goes; the node back is new', () => {
  const tracker = createStatusTracker();
  // Over its line, then 40 cycles (20 minutes) with no reading: held throughout.
  const held = temperatures([78, ...Array(40).fill(null)], tracker);
  assert.ok(
    held.slice(1).every((e) => e.state === 'warn' && e.since === NOW),
    'held at warn, one episode, however long'
  );
  // The node leaves services.yaml (Prometheus answering): it is gone, its memory with it.
  const gone = tracker.update({
    inputs: inputs({ nodes: {} }),
    thresholds: T,
    now: NOW + 41 * 30_000,
  });
  assert.equal(
    gone.entities.some((e) => e.id === 'nodes/n1'),
    false
  );
  // Back with the sensor at 73 °C, inside the old band: judged fresh, ok.
  const [back] = temperatures([73], tracker, 42);
  assert.deepEqual([back.state, back.conditions.temp], ['ok', 'ok']);
});

// ── #468: a storage pool whose Proxmox read failed ───────────────────────

const PVE = { pve: node({}, { display_name: 'pve' }) };
const lvm = (percent) => ({ name: 'local-lvm', percent, totalGB: '100.0' });
const proxmox = (extra) => ({
  proxmox: { _preset: 'proxmox', _target: 'pve:pve', _status: { state: 'ok' }, ...extra },
});

test('#468: proxmoxPools: the pools each node’s reads listed, and whether that is the whole list', () => {
  const poolsOf = proxmoxPools({
    a: { _preset: 'proxmox', _target: 'n1:pve', _storagePools: [lvm(50)] },
    b: { _preset: 'proxmox', _target: 'n2:pve', _storagePools: [lvm(50)] },
    c: { _preset: 'proxmox', _target: 'n2:pve2', _error: 'HTTP 500' },
    d: { _preset: 'proxmox', _target: 'n3:pve' }, // its storage read failed: no list
    e: { _preset: 'proxmox', _storagePools: [] }, // no target: "pve"
    f: { _preset: 'gitea', _target: 'n4:gitea' },
  });
  assert.deepEqual(
    Object.fromEntries(['n1', 'n2', 'n3', 'pve', 'n4', 'n5'].map((n) => [n, poolsOf(n)])),
    {
      n1: { pools: [lvm(50)], read: true },
      n2: { pools: [lvm(50)], read: false }, // one of its two fetches failed
      n3: { pools: [], read: false },
      pve: { pools: [], read: true },
      // No Proxmox entry names them: none is set up for them, so none are listed.
      n4: { pools: [], read: true },
      n5: { pools: [], read: true },
    }
  );
  assert.deepEqual(
    proxmoxPools(null)('n1'),
    { pools: [], read: false },
    'no payload: no node has its pools read'
  );
});

test('#468: pool at warn → its Proxmox fetch fails → back inside the band is one warning in the model, since its first cycle', () => {
  const failed = proxmox({ _error: 'HTTP 500 Internal Server Error' });
  const listed = (percent) => proxmox({ _storagePools: [lvm(percent)] });
  const statuses = cycles(
    [listed(93), failed, null, listed(88), listed(93), listed(80)].map((integrations) =>
      inputs({ nodes: PVE, integrations })
    )
  );
  const pve = statuses.map((s) => s.entities.find((e) => e.id === 'nodes/pve'));
  assert.deepEqual(
    pve.map((e) => [e.state, e.conditions['pool:local-lvm'], e.reason]),
    [
      ['warn', 'warn', 'Storage pool local-lvm 93 % (warning above 90 %)'],
      ['warn', 'unknown', 'Storage pool local-lvm: no reading (warning held until below 85 %)'],
      ['warn', 'unknown', 'Storage pool local-lvm: no reading (warning held until below 85 %)'],
      ['warn', 'warn', 'Storage pool local-lvm 88 % (warning until below 85 %)'],
      ['warn', 'warn', 'Storage pool local-lvm 93 % (warning above 90 %)'],
      ['ok', 'ok', 'Healthy'],
    ]
  );
  assert.deepEqual(
    pve.slice(0, 5).map((e) => e.since),
    Array(5).fill(NOW),
    'one episode: its since never moves'
  );
});

test('#468: a read that succeeds and no longer lists a pool ends its episode in the model', () => {
  const statuses = cycles(
    [
      proxmox({ _storagePools: [lvm(93)] }),
      proxmox({ _storagePools: [] }),
      proxmox({ _storagePools: [lvm(88)] }), // back inside the old band: judged fresh
    ].map((integrations) => inputs({ nodes: PVE, integrations }))
  );
  const pve = statuses.map((s) => s.entities.find((e) => e.id === 'nodes/pve'));
  assert.deepEqual(
    pve.map((e) => [e.state, e.conditions['pool:local-lvm'] ?? null]),
    [
      ['warn', 'warn'],
      ['ok', null],
      ['ok', 'ok'],
    ]
  );
});

test('#468: the Proxmox integration removed: a pool it held ends in the model; no payload holds it', () => {
  const statuses = cycles(
    [proxmox({ _storagePools: [lvm(93)] }), null, {}, {}].map((integrations) =>
      inputs({ nodes: PVE, integrations })
    )
  );
  const pve = statuses.map((s) => s.entities.find((e) => e.id === 'nodes/pve'));
  assert.deepEqual(
    pve.map((e) => [e.state, e.conditions['pool:local-lvm'] ?? null]),
    [
      ['warn', 'warn'],
      ['warn', 'unknown'], // the refresh left no payload: held
      ['ok', null], // the payload has no Proxmox entry for pve: it has ended
      ['ok', null],
    ]
  );
});
