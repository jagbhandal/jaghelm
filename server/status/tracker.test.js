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
  inputs,
  missing,
  monitored,
  node,
} from '../testing/statusFixtures.js';
import { buildStatus } from './model.js';
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
