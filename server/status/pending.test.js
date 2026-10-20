/**
 * #258, closed by #290: Kuma's maintenance and pending no longer read as
 * degraded. A monitor in maintenance is its own neutral state; one pending
 * (Kuma retrying a failed check) is a warning only once it lasts more than
 * one cycle. Run end to end: Kuma's /metrics text through parseKumaMetrics,
 * the board through the real assembleServices, then the model cycle by cycle.
 * /api/services keeps today's 'unknown' for both (spec §6.3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseKumaMetrics } from '../kumaMetrics.js';
import { buildServices } from '../push/snapshot.js';
import { assembleServices } from '../refresh.js';
import { NOW, cycles, entityOf, inputs } from '../testing/statusFixtures.js';

const KUMA_VALUE = { up: 1, down: 0, pending: 2, maintenance: 3 };

/** Kuma's /metrics body for `statuses` ({ name: 'up' | 'down' | 'pending' | 'maintenance' }), ids in order. */
function kumaMetrics(statuses) {
  return Object.entries(statuses)
    .map(
      ([name, s], i) =>
        `monitor_status{monitor_id="${i + 1}",monitor_name="${name}"} ${KUMA_VALUE[s]}`
    )
    .join('\n');
}

/**
 * One services refresh: `app` and `db` run on n1; Kuma has the monitors in
 * `statuses`. "App" matches `app`; "NAS" matches no container and was last
 * seen on n1.
 */
function refresh(statuses) {
  const r = assembleServices({
    nodeResults: [
      [
        'n1',
        { display_name: 'n1' },
        {
          metrics: { cpu: '10', memPercent: '40', diskPercent: '50' },
          reachable: true,
          failedReads: [],
          containers: [
            { container: 'app', status: 'running', docker: {} },
            { container: 'db', status: 'running', docker: {} },
          ],
        },
      ],
    ],
    monitors: parseKumaMetrics(kumaMetrics(statuses)),
    config: { nodes: { n1: {} }, services: {} },
    lastSeenNodeOf: () => 'n1',
    lastSeenContainerOf: () => null,
    containerRegistry: null,
    now: () => NOW,
  });
  return {
    r,
    inputs: inputs({
      nodes: r.nodes,
      internal: {
        upWithoutCard: r.upWithoutCard,
        monitorOf: r.monitorOf,
        kumaStatusOf: r.kumaStatusOf,
        kumaWithoutCard: r.kumaWithoutCard,
        backedBy: r.backedBy,
      },
    }),
  };
}

const appStates = (list) => list.map((s) => entityOf(s, 'services/n1:app').state);

test('#258: Kuma reports pending and maintenance by name; status keeps folding them into unknown', () => {
  const m = parseKumaMetrics(kumaMetrics({ A: 'up', B: 'down', C: 'pending', D: 'maintenance' }));
  assert.deepEqual(
    Object.values(m).map((x) => [x.status, x.kumaStatus]),
    [
      ['up', 'up'],
      ['down', 'down'],
      ['unknown', 'pending'],
      ['unknown', 'maintenance'],
    ]
  );
});

test('#258: pending for one cycle changes nothing; past one cycle it is a warning', () => {
  const run = cycles([
    refresh({ App: 'up' }).inputs,
    refresh({ App: 'pending' }).inputs,
    refresh({ App: 'pending' }).inputs,
    refresh({ App: 'pending' }).inputs,
  ]);
  assert.deepEqual(appStates(run), ['ok', 'ok', 'warn', 'warn']);
  const held = entityOf(run[1], 'services/n1:app');
  assert.deepEqual([held.word, held.reason, held.since], ['Up', 'Kuma: up', NOW], 'held as it was');
  const warn = entityOf(run[2], 'services/n1:app');
  assert.deepEqual([warn.word, warn.reason], ['Pending', 'Kuma: pending (retrying its check)']);
  assert.equal(warn.since, NOW + 30_000, 'since: when it went pending');
  assert.equal(run[1].overall.state, 'ok');
  assert.deepEqual(run[1].issues, []);
  assert.equal(run[2].overall.sentence, '1 service pending');
});

test('#258: a one-cycle pending blip (Kuma retrying, then up) never warns', () => {
  const run = cycles([
    refresh({ App: 'up' }).inputs,
    refresh({ App: 'pending' }).inputs,
    refresh({ App: 'up' }).inputs,
    refresh({ App: 'pending' }).inputs,
    refresh({ App: 'up' }).inputs,
  ]);
  assert.deepEqual(appStates(run), ['ok', 'ok', 'ok', 'ok', 'ok']);
});

test('#258: pending then down: down is crit at once', () => {
  const run = cycles([
    refresh({ App: 'up' }).inputs,
    refresh({ App: 'pending' }).inputs,
    refresh({ App: 'down' }).inputs,
  ]);
  assert.deepEqual(appStates(run), ['ok', 'ok', 'crit']);
});

test('#258: maintenance is maintenance: not degraded, not an issue, shown in the subsystem detail', () => {
  const [s] = cycles([refresh({ App: 'maintenance' }).inputs]);
  const app = entityOf(s, 'services/n1:app');
  assert.deepEqual(
    [app.state, app.word, app.reason],
    ['maintenance', 'Maintenance', 'Kuma: in maintenance']
  );
  assert.deepEqual(s.issues, []);
  assert.equal(s.subsystems[0].detail, '1 / 2 up · 1 in maintenance');
  assert.equal(s.overall.state, 'maintenance');
  assert.equal(s.overall.sentence, '1 service up · 1 node healthy');
});

test('#258: a monitor no container has, pending or in maintenance, stays a service', () => {
  const up = refresh({ App: 'up', NAS: 'up' });
  const maint = refresh({ App: 'up', NAS: 'maintenance' });
  assert.deepEqual(up.r.upWithoutCard, ['n1:NAS']);
  assert.deepEqual(maint.r.kumaWithoutCard, { 'n1:NAS': 'maintenance' });
  const run = cycles([
    up.inputs,
    maint.inputs,
    refresh({ App: 'up', NAS: 'pending' }).inputs,
    refresh({ App: 'up', NAS: 'pending' }).inputs,
  ]);
  assert.deepEqual(
    run.map((s) => entityOf(s, 'services/n1:NAS')?.state),
    ['ok', 'maintenance', 'maintenance', 'warn']
  );
  assert.deepEqual(
    run.map((s) => s.subsystems[0].counts.total),
    [3, 3, 3, 3],
    'the Services count holds'
  );
});

test('#258: /api/services and the push snapshot read pending and maintenance as before', () => {
  const { r } = refresh({ App: 'pending', NAS: 'maintenance' });
  const app = r.nodes.n1.services.find((s) => s.uid === 'n1:app');
  assert.equal(app.status, 'unknown', 'the served card keeps its status');
  assert.deepEqual(r.kumaStatusOf, { 'n1:app': 'pending' });
  assert.equal('kumaStatus' in app, false, 'nothing new in the served card');
  // Push sees what it saw before: the pending card unknown, the containerless
  // maintenance monitor not at all.
  assert.deepEqual(buildServices({ nodes: r.nodes }, r.upWithoutCard), {
    'n1:app': 'unknown',
    'n1:db': 'up',
  });
});

test('#258: the model holds a pending service only from a Kuma state, never from no signal', () => {
  const kumaFailed = refresh({ App: 'up' }).inputs;
  kumaFailed.services.sources.kuma.ok = false;
  const run = cycles([
    refresh({ App: 'up' }).inputs,
    kumaFailed,
    refresh({ App: 'pending' }).inputs,
  ]);
  assert.deepEqual(appStates(run), ['ok', 'unknown', 'ok']);
  assert.equal(entityOf(run[2], 'services/n1:app').reason, 'Kuma: pending');
});
