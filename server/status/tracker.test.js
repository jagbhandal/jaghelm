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
import { createStatusTracker, readStatusInputs } from './index.js';
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
