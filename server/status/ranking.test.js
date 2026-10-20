/**
 * The status model's summary (#290, spec §6): the ranked issue list, the
 * overall sentence and the subsystem strip, table-driven.
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
  once,
} from '../testing/statusFixtures.js';
import {
  EMPTY as UI_EMPTY,
  EMPTY_SENTENCE as UI_EMPTY_SENTENCE,
  STATES as UI_STATES,
} from '../../src/ui/lib/status.js';
import { STATES } from './rules.js';
import { EMPTY, rankIssues, sentenceOf, subsystemsOf } from './summary.js';

const issue = (id, state, subsystem, since) => ({
  id,
  kind: 'service',
  subsystem,
  state,
  word: 'X',
  reason: 'r',
  since,
});

const rankingRows = [
  [
    'crit before warn before unknown',
    [
      issue('a', 'unknown', 'services', 1),
      issue('b', 'warn', 'services', 1),
      issue('c', 'crit', 'services', 1),
    ],
    ['c', 'b', 'a'],
  ],
  [
    'within a level, by subsystem order',
    [
      issue('int', 'warn', 'integrations', 1),
      issue('job', 'warn', 'jobs', 1),
      issue('svc', 'warn', 'services', 1),
      issue('bak', 'warn', 'backups', 1),
      issue('ups', 'warn', 'power', 1),
      issue('node', 'warn', 'nodes', 1),
    ],
    ['svc', 'node', 'ups', 'job', 'bak', 'int'],
  ],
  [
    'a failed source first in its level',
    [issue('svc', 'warn', 'services', 1), issue('sources/kuma', 'warn', 'sources', 9)],
    ['sources/kuma', 'svc'],
  ],
  [
    'then by age, oldest first',
    [
      issue('new', 'crit', 'services', NOW),
      issue('old', 'crit', 'services', NOW - 60_000),
      issue('mid', 'crit', 'services', NOW - 1),
    ],
    ['old', 'mid', 'new'],
  ],
  [
    'then by id',
    [issue('b', 'crit', 'services', 5), issue('a', 'crit', 'services', 5)],
    ['a', 'b'],
  ],
  [
    'level beats subsystem beats age',
    [
      issue('old-warn-svc', 'warn', 'services', 1),
      issue('new-crit-int', 'crit', 'integrations', 9),
      issue('old-crit-node', 'crit', 'nodes', 1),
      issue('new-crit-svc', 'crit', 'services', 9),
    ],
    ['new-crit-svc', 'old-crit-node', 'new-crit-int', 'old-warn-svc'],
  ],
];

for (const [name, issues, want] of rankingRows) {
  test(`issue ranking: ${name}`, () => {
    assert.deepEqual(
      rankIssues(issues).map((i) => i.id),
      want
    );
    assert.deepEqual(
      rankIssues([...issues].reverse()).map((i) => i.id),
      want,
      'whatever order they come in'
    );
  });
}

test('issue ranking: through the model, maintenance and ok are left out', () => {
  const s = once(
    inputs({
      nodes: {
        n1: node(
          { diskPercent: '92' },
          {
            services: [
              missing('n1:w'),
              monitored('n1:d', 'down'),
              monitored('n1:m', 'unknown'),
              card('n1:ok'),
            ],
          }
        ),
        n2: node({}, { reachable: false }),
      },
      internal: { kumaStatusOf: { 'n1:m': 'maintenance' } },
      ups: { status: 2, charge: 70, ok: true, configured: true },
      cron: [cronNode('n1', { j: cronRun('failure') })],
      integrations: {
        x: { _error: 'HTTP 500', _status: { state: 'backing_off', since: NOW - 10 } },
      },
    })
  );
  assert.deepEqual(
    s.issues.map((i) => `${i.state} ${i.id}`),
    [
      'crit services/n1:d',
      'crit nodes/n2',
      'crit power/ups',
      'warn services/n1:w',
      'warn nodes/n1',
      'warn jobs/n1:j',
      'warn integrations/x',
    ]
  );
  assert.equal(s.overall.state, 'crit');
  assert.equal(
    s.overall.sentence,
    '1 service down · 1 node unreachable · UPS on battery · 1 container missing · 1 node in warning · 1 job failed · 1 integration failing'
  );
});

const sentenceRows = [
  [
    'nothing at all',
    inputs({ nodes: {}, ups: { status: null, ok: true, configured: false } }),
    'empty',
    'Nothing monitored yet',
  ],
  [
    'healthy',
    inputs({
      nodes: { a: node({}, { services: [card('a:x'), card('a:y'), card('a:z')] }), b: node() },
    }),
    'ok',
    'All 3 services up · 2 nodes healthy',
  ],
  [
    'one service',
    inputs({ nodes: { a: node({}, { services: [card('a:x')] }) } }),
    'ok',
    '1 service up · 1 node healthy',
  ],
  [
    'two services down, UPS on battery',
    inputs({
      nodes: {
        a: node(
          {},
          { services: [monitored('a:x', 'down'), monitored('a:y', 'down'), card('a:z')] }
        ),
      },
      ups: { status: 2, charge: 80, ok: true, configured: true },
    }),
    'crit',
    '2 services down · UPS on battery',
  ],
  [
    'problems, then no signal',
    inputs({
      nodes: {
        a: node(
          {},
          {
            services: [
              monitored('a:x', 'down'),
              monitored('a:u', 'unknown'),
              monitored('a:v', 'unknown'),
            ],
          }
        ),
      },
    }),
    'crit',
    '1 service down · 2 no signal',
  ],
  [
    'pending and a refused login',
    inputs({
      nodes: { a: node({}, { services: [monitored('a:p', 'unknown')] }) },
      internal: { kumaStatusOf: { 'a:p': 'pending' } },
      integrations: { q: { _error: 'HTTP 401', _status: { state: 'auth_failed', since: NOW } } },
    }),
    'warn',
    '1 integration with a refused login',
  ],
];

for (const [name, cycleInputs, state, sentence] of sentenceRows) {
  test(`overall sentence: ${name}`, () => {
    const s = once(cycleInputs);
    assert.equal(s.overall.state, state);
    assert.equal(s.overall.sentence, sentence);
  });
}

// #449: with nothing set up, the board isn't ok (nobody checked anything) and
// isn't no signal (nothing is silent): it is empty, said once, in the model.
test('an empty board is its own overall state, empty: not ok, not no signal, and nothing to rank', () => {
  const s = once(inputs({ nodes: {}, ups: { status: null, ok: true, configured: false } }));
  assert.equal(EMPTY, 'empty');
  assert.deepEqual(s.overall, { state: EMPTY, sentence: 'Nothing monitored yet' });
  assert.deepEqual(s.issues, []);
  assert.deepEqual(s.entities, []);
  // It is the board's state, never an entity's or a subsystem's: an empty
  // subsystem stays ok with a total of 0, and no client shows it.
  assert.ok(!STATES.includes(EMPTY));
  assert.ok(s.subsystems.every((sub) => sub.state === 'ok' && sub.counts.total === 0));
});

test('a board with anything on it, or only a failed source, is not empty', () => {
  const sourceOnly = once(
    inputs({
      nodes: {},
      prometheusOk: false,
      ups: { status: null, ok: true, configured: false },
      internal: { sourceErrors: { prometheus: 'Prometheus query failed: fetch failed' } },
    })
  );
  assert.deepEqual(sourceOnly.overall, { state: 'warn', sentence: 'Prometheus unreachable' });
  const oneNode = once(
    inputs({ nodes: { a: node() }, ups: { status: null, ok: true, configured: false } })
  );
  assert.deepEqual(oneNode.overall, { state: 'ok', sentence: '1 node healthy' });
});

test('the empty board is named and worded as src/ui/lib/status.js has it, outside the five states', () => {
  assert.equal(EMPTY, UI_EMPTY);
  assert.ok(!UI_STATES.includes(UI_EMPTY));
  const s = once(inputs({ nodes: {}, ups: { status: null, ok: true, configured: false } }));
  assert.equal(s.overall.sentence, UI_EMPTY_SENTENCE);
});

test('overall sentence: a failed source is named', () => {
  const s = once(
    inputs({
      nodes: { a: node({}, { services: [monitored('a:x', 'up')] }) },
      kumaOk: false,
      internal: { sourceErrors: { kuma: 'Kuma status page answered HTTP 502' } },
    })
  );
  assert.equal(s.overall.sentence, 'Kuma unreachable · 1 no signal');
  assert.equal(s.issues[0].reason, 'Kuma status page answered HTTP 502');
  assert.deepEqual(s.sources.kuma, {
    state: 'failed',
    error: 'Kuma status page answered HTTP 502',
    since: NOW,
  });
});

test('subsystems: worst-of state, counts and detail, in strip order', () => {
  const entities = [
    { id: 's1', subsystem: 'services', state: 'ok', reason: 'Kuma: up' },
    { id: 's2', subsystem: 'services', state: 'maintenance', reason: 'Kuma: in maintenance' },
    { id: 's3', subsystem: 'services', state: 'unknown', reason: 'Kuma: no status' },
    { id: 'n1', subsystem: 'nodes', state: 'warn', reason: 'Disk' },
    { id: 'u', subsystem: 'power', state: 'ok', reason: 'On mains' },
    { id: 'j1', subsystem: 'jobs', state: 'ok', reason: 'ok' },
  ];
  const subs = subsystemsOf(entities);
  assert.deepEqual(
    subs.map((s) => s.id),
    ['services', 'nodes', 'power', 'jobs', 'backups', 'integrations']
  );
  assert.deepEqual(
    subs.map((s) => [s.state, s.detail]),
    [
      ['unknown', '1 / 3 up · 1 in maintenance · 1 no signal'],
      ['warn', '0 / 1 healthy'],
      ['ok', 'On mains'],
      ['ok', '1 / 1 OK'],
      ['ok', 'None'],
      ['ok', 'None'],
    ]
  );
  assert.deepEqual(subs[0].counts, {
    total: 3,
    ok: 1,
    warn: 0,
    crit: 0,
    unknown: 1,
    maintenance: 1,
  });
});

test('sentenceOf: groups by kind and word in issue order', () => {
  const subs = subsystemsOf([]);
  const ranked = [
    { id: 'a', kind: 'service', subsystem: 'services', state: 'crit', word: 'Down' },
    { id: 'b', kind: 'job', subsystem: 'jobs', state: 'warn', word: 'Failed' },
    { id: 'c', kind: 'job', subsystem: 'jobs', state: 'warn', word: 'Overdue' },
    { id: 'd', kind: 'job', subsystem: 'jobs', state: 'warn', word: 'Failed' },
    { id: 'e', kind: 'agent', subsystem: 'integrations', state: 'warn', word: 'Offline' },
  ];
  assert.equal(
    sentenceOf(ranked, ranked, subs),
    '1 service down · 2 jobs failed · 1 job overdue · 1 Arcane agent offline'
  );
});
