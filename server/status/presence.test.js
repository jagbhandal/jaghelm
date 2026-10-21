/**
 * #438: a missing container that was a Kuma monitor's last container (a grey
 * presence card with `backedBy`) is judged from the monitor's state, not crit
 * whatever the monitor says. Up: a warning, like any missing container, since
 * the service has its own entity and is fine. Pending: no signal. In
 * maintenance: maintenance. Down: the monitor's card is the one crit on the
 * board. Run end to end: Kuma's /metrics text through parseKumaMetrics, the
 * board through the real assembleServices, then the model and push. A
 * paused monitor (the status-page path: `active: false`, or a stale
 * heartbeat) vouches for nothing: its container is a plain missing one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseKumaMetrics } from '../kumaMetrics.js';
import { diffSnapshots } from '../push/differ.js';
import { cachesOfAssembled, snapshotAfter } from '../testing/pushPipeline.js';
import { assembleServices } from '../refresh.js';
import { NOW, entityOf, inputs, once } from '../testing/statusFixtures.js';

const KUMA_VALUE = { up: 1, down: 0, pending: 2, maintenance: 3 };

/** Kuma's /metrics body for `monitors` ([id, name, 'up' | 'down' | 'pending' | 'maintenance']). */
function kumaMetrics(monitors) {
  return monitors
    .map(
      ([id, name, s]) =>
        `monitor_status{monitor_id="${id}",monitor_name="${name}"} ${KUMA_VALUE[s]}`
    )
    .join('\n');
}

/**
 * One services refresh on n1, where `gitea` runs (Kuma's "Gitea", id 1, is
 * up) and so do the containers in `running`. `immich-server` stopped two
 * minutes ago; it was the last container of Kuma's monitor id 2, the service
 * registry says. `monitors` are Kuma's others, id 2 first, as /metrics gives
 * them; `statusPage` is monitor 2 as the status-page path gives it instead.
 */
function refresh(monitors, { running = [], statusPage = null } = {}) {
  const r = assembleServices({
    nodeResults: [
      [
        'n1',
        { display_name: 'n1' },
        {
          metrics: { cpu: '10', memPercent: '40', diskPercent: '50' },
          reachable: true,
          failedReads: [],
          containers: ['gitea', ...running].map((container) => ({
            container,
            status: 'running',
            docker: {},
          })),
        },
      ],
    ],
    monitors: statusPage
      ? { ...parseKumaMetrics(kumaMetrics([[1, 'Gitea', 'up']])), 2: { id: 2, ...statusPage } }
      : parseKumaMetrics(kumaMetrics([[1, 'Gitea', 'up'], ...monitors])),
    config: { nodes: { n1: {} }, services: {} },
    lastSeenNodeOf: () => 'n1',
    lastSeenContainerOf: (id) => ({ 1: 'gitea', 2: 'immich-server' })[String(id)] ?? null,
    containerRegistry: {
      recordSeen() {},
      getMissing: () => [
        {
          container: 'immich-server',
          lastSeenNode: 'n1',
          lastSeenAt: NOW - 120_000,
          ageMs: 120_000,
        },
      ],
    },
    now: () => NOW,
  });
  return {
    r,
    status: once(
      inputs({
        nodes: r.nodes,
        internal: {
          upWithoutCard: r.upWithoutCard,
          monitorOf: r.monitorOf,
          kumaStatusOf: r.kumaStatusOf,
          kumaWithoutCard: r.kumaWithoutCard,
          backedBy: r.backedBy,
        },
      })
    ),
  };
}

const ID = 'services/n1:immich-server';
const cardsOf = (r, uid) => r.nodes.n1.services.filter((s) => s.uid === uid);
const pushOf = (r, prev = null) => snapshotAfter(cachesOfAssembled(r), prev).snapshot;
/** What push sends from one refresh to the next. */
function pushes(prev, next) {
  const before = pushOf(prev);
  const { snapshot, status } = snapshotAfter(cachesOfAssembled(next), before);
  return diffSnapshots(before, snapshot, status).map((e) => `${e.type} ${e.id}`);
}
const critIssues = (status) =>
  status.issues.filter((i) => i.state === 'crit').map((i) => `${i.kind} ${i.id}`);

test('#438: a missing container whose Kuma monitor is up is a warning, not crit; the headline is not crit', () => {
  const { r, status } = refresh([[2, 'Immich', 'up']]);
  assert.deepEqual(r.backedBy, { 'n1:immich-server': { monitor: 'Immich', status: 'up' } });
  assert.deepEqual(r.upWithoutCard, ['n1:immich-server'], "the monitor's up entry has its uid");
  const e = entityOf(status, ID);
  assert.deepEqual(
    [e.kind, e.state, e.word, e.reason],
    ['container', 'warn', 'Missing', 'Missing: the container is gone; Kuma monitor Immich is up']
  );
  assert.equal(e.since, NOW - 120_000, 'since it was last seen');
  assert.deepEqual(critIssues(status), []);
  assert.equal(status.overall.state, 'warn');
  assert.equal(status.overall.sentence, '1 container missing');
  // Push reads the monitor's up entry, as before: the presence card pages nothing.
  assert.deepEqual(snapshotAfter(cachesOfAssembled(r)).snapshot.services, {
    'n1:gitea': 'up',
    'n1:immich-server': 'up',
  });
});

test('#438: a container redeployed under a new name leaves a warning while the monitor is up', () => {
  // The issue's example: the monitor is served by the new container, and the
  // service registry still names the old one as its last.
  const { r, status } = refresh([[2, 'Immich', 'up']], { running: ['immich-app'] });
  assert.equal(r.nodes.n1.services.find((s) => s.uid === 'n1:immich-app').monitored, true);
  assert.equal(entityOf(status, ID).state, 'warn');
  assert.equal(entityOf(status, 'services/n1:immich-app').state, 'ok');
  assert.deepEqual(critIssues(status), []);
});

test('#438: monitor down: exactly one crit issue, the service; the missing container is no issue', () => {
  // The stopped container holds its down monitor: a red card under its name,
  // and no grey card (Kuma owns the outage).
  const { r, status } = refresh([[2, 'Immich', 'down']]);
  assert.deepEqual(
    cardsOf(r, 'n1:immich-server').map((s) => `${s.source} ${s.status}`),
    ['monitor down']
  );
  assert.deepEqual(r.backedBy, {});
  assert.deepEqual(critIssues(status), ['service services/n1:immich-server']);
  assert.deepEqual(
    status.issues.map((i) => i.id),
    [ID],
    'one issue in all'
  );
  assert.equal(entityOf(status, ID).reason, 'Kuma: down');
  assert.equal(status.overall.sentence, '1 service down');
  assert.deepEqual(snapshotAfter(cachesOfAssembled(r)).snapshot.services, {
    'n1:gitea': 'up',
    'n1:immich-server': 'down',
  });
});

test('#438: monitor down, its red card on the missing container’s uid by placement: one card, one crit, and it pages', () => {
  // "Photos" was mapped to immich-server; the mapping is gone, so the stopped
  // container doesn't get the monitor by name, and its red card is placed
  // under its last container. The grey card would share that uid: Kuma owns it.
  const { r, status } = refresh([[2, 'Photos', 'down']]);
  assert.deepEqual(
    cardsOf(r, 'n1:immich-server').map((s) => `${s.source} ${s.status}`),
    ['monitor down'],
    'no second card with its uid'
  );
  assert.equal(r.breadcrumbCount, 0);
  assert.deepEqual(critIssues(status), ['service services/n1:immich-server']);
  assert.equal(status.issues.length, 1);
  // The grey card used to take the uid in the model as a container, which
  // push doesn't read, so the outage never paged. Now it is the service's.
  assert.deepEqual(pushOf(r).services, { 'n1:gitea': 'up', 'n1:immich-server': 'down' });
  const up = refresh([[2, 'Photos', 'up']]).r;
  assert.deepEqual(pushes(up, r), ['service_down n1:immich-server']);
  assert.deepEqual(pushes(r, up), ['service_recovered n1:immich-server'], 'on the same key');
});

test('#438: monitor down on a new container while the old one is missing: one crit, the old one a warning', () => {
  // Redeployed as `immich` (an exact match, so it takes the down monitor) in
  // the cycle the old one went: Kuma's outage is the new card's.
  const { r, status } = refresh([[2, 'Immich', 'down']], { running: ['immich'] });
  assert.deepEqual(r.backedBy, { 'n1:immich-server': { monitor: 'Immich', status: 'down' } });
  assert.deepEqual(critIssues(status), ['service services/n1:immich']);
  const e = entityOf(status, ID);
  assert.deepEqual(
    [e.kind, e.state, e.reason],
    ['container', 'warn', 'Missing: the container is gone; Kuma monitor Immich is down']
  );
});

test('#438: monitor pending: no signal; in maintenance: maintenance', () => {
  const pending = refresh([[2, 'Immich', 'pending']]);
  assert.deepEqual(pending.r.kumaWithoutCard, { 'n1:immich-server': 'pending' });
  const p = entityOf(pending.status, ID);
  assert.deepEqual(
    [p.kind, p.state, p.word, p.reason],
    ['container', 'unknown', 'No signal', 'Kuma: Immich pending']
  );
  assert.deepEqual(critIssues(pending.status), []);
  assert.equal(pending.status.overall.state, 'unknown');

  const maint = refresh([[2, 'Immich', 'maintenance']]);
  const m = entityOf(maint.status, ID);
  assert.deepEqual(
    [m.kind, m.state, m.word, m.reason],
    ['container', 'maintenance', 'Maintenance', 'Kuma: Immich in maintenance']
  );
  assert.deepEqual(maint.status.issues, [], 'maintenance is no issue');
  assert.equal(maint.status.overall.state, 'maintenance');
});

// A paused monitor, on Kuma's status-page path (/metrics leaves paused monitors
// out): `active: false`, or a heartbeat older than JAGHELM_MONITOR_STALE_MS.
const STALE_BEAT = NOW - 3_600_000;

test('#438: a container whose monitor was paused while pending is a plain missing one, not no signal', () => {
  for (const paused of [{ lastBeatAt: STALE_BEAT }, { active: false, lastBeatAt: NOW - 30_000 }]) {
    const { r, status } = refresh([], {
      statusPage: { name: 'Immich', status: 'unknown', kumaStatus: 'pending', ...paused },
    });
    assert.deepEqual(r.backedBy, { 'n1:immich-server': { monitor: 'Immich', status: 'unknown' } });
    const e = entityOf(status, ID);
    assert.deepEqual(
      [e.state, e.reason],
      ['warn', 'Missing: no longer running'],
      JSON.stringify(paused)
    );
    assert.equal(status.overall.state, 'warn');
  }
  // Fresh, it is the monitor's pending, as on /metrics.
  const fresh = refresh([], {
    statusPage: {
      name: 'Immich',
      status: 'unknown',
      kumaStatus: 'pending',
      active: true,
      lastBeatAt: NOW - 30_000,
    },
  });
  assert.equal(entityOf(fresh.status, ID).state, 'unknown');
});

test('#438: a container whose monitor was paused while down says nothing of the monitor being down', () => {
  // "Photos" matches no container by name, so nothing holds it; paused, it
  // draws no red card either, and its last container is a plain missing one.
  const { r, status } = refresh([], {
    statusPage: {
      name: 'Photos',
      status: 'down',
      kumaStatus: 'down',
      active: true,
      lastBeatAt: STALE_BEAT,
    },
  });
  assert.deepEqual(
    cardsOf(r, 'n1:immich-server').map((s) => s.source),
    ['presence']
  );
  assert.deepEqual(r.backedBy, { 'n1:immich-server': { monitor: 'Photos', status: 'unknown' } });
  assert.equal(entityOf(status, ID).reason, 'Missing: no longer running');
  assert.deepEqual(critIssues(status), []);
});

test('a monitor paused while down doesn’t hide the stopped container it matches by name', () => {
  // Before: the stopped container took the down monitor by name, which hid its
  // grey card, and the paused monitor draws no red card, so it left the board.
  for (const paused of [
    { active: true, lastBeatAt: STALE_BEAT },
    { active: false, lastBeatAt: NOW - 30_000 },
  ]) {
    const { r, status } = refresh([], {
      statusPage: { name: 'Immich', status: 'down', kumaStatus: 'down', ...paused },
    });
    assert.deepEqual(
      cardsOf(r, 'n1:immich-server').map((s) => `${s.source} ${s.status}`),
      ['presence unknown'],
      JSON.stringify(paused)
    );
    const e = entityOf(status, ID);
    assert.deepEqual(
      [e.kind, e.state, e.reason],
      ['container', 'warn', 'Missing: no longer running']
    );
    assert.deepEqual(critIssues(status), []);
    assert.deepEqual(pushOf(r).services, { 'n1:gitea': 'up' }, 'a paused monitor pages nothing');
  }
  // Fresh and down, the container holds it: the red card, as before.
  const fresh = refresh([], {
    statusPage: {
      name: 'Immich',
      status: 'down',
      kumaStatus: 'down',
      active: true,
      lastBeatAt: NOW - 30_000,
    },
  });
  assert.deepEqual(
    cardsOf(fresh.r, 'n1:immich-server').map((s) => `${s.source} ${s.status}`),
    ['monitor down']
  );
});
