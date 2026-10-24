/*
 * A stack's main container stops (#642): the real path, assembleServices over
 * Jag's real container names, with a container registry that has watched them
 * run, then the status model. The stack keeps ITS lead, the other web member
 * keeps its own row and its own heartbeats, the rollup says what the lead
 * says, and no row id moves between running and stopped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleServices } from './refresh.js';
import { createContainerRegistry } from './containerRegistry.js';
import { createServiceRegistry } from './serviceRegistry.js';
import { cachesOfAssembled, snapshotAfter } from './testing/pushPipeline.js';

const ctr = (container, project) => ({
  container,
  status: 'running',
  docker: { cpu: 1 },
  ...(project ? { project } : {}),
});
const ALL = [
  ctr('immich-server', 'immich'),
  ctr('immich-machine-learning', 'immich'),
  ctr('immich-postgres', 'immich'),
  ctr('immich-redis', 'immich'),
  ctr('nextcloud-app', 'nextcloud'),
  ctr('nextcloud-cron', 'nextcloud'),
  ctr('nextcloud-db', 'nextcloud'),
  ctr('nextcloud-redis', 'nextcloud'),
  ctr('collabora', 'nextcloud'),
  ctr('wikijs', 'wikijs'),
  ctr('wikijs-postgres', 'wikijs'),
  ctr('wikijs-redis', 'wikijs'),
  ctr('loki', 'loki'),
  ctr('loki-proxy', 'loki'),
  ctr('prometheus', 'prometheus-metrics'),
  ctr('node-exporter', 'prometheus-metrics'),
  ctr('cadvisor', 'prometheus-metrics'),
  ctr('nut-exporter', 'prometheus-metrics'),
  ctr('gitea', 'gitea'),
];
const SERVICES = {
  'immich-server': { monitor: 'Immich' },
  'nextcloud-app': { monitor: 'Nextcloud' },
  collabora: { monitor: 'Collabora' },
  wikijs: { monitor: 'Wiki.js' },
  'loki-proxy': { monitor: 'Loki' },
  gitea: { monitor: 'Gitea' },
};
const MONITOR_ID = {
  'immich-server': 1,
  'nextcloud-app': 2,
  collabora: 3,
  wikijs: 4,
  'loki-proxy': 5,
  gitea: 6,
};
const NAME = {
  'immich-server': 'Immich',
  'nextcloud-app': 'Nextcloud',
  collabora: 'Collabora',
  wikijs: 'Wiki.js',
  'loki-proxy': 'Loki',
  gitea: 'Gitea',
};

const STATE = {
  up: { status: 'up', kumaStatus: 'up' },
  down: { status: 'down', kumaStatus: 'down' },
  pending: { status: 'unknown', kumaStatus: 'pending' },
  paused: { status: 'up', kumaStatus: 'up', active: false },
};

/** One registry that has watched everything run, like a server that has been up a while. */
function watched() {
  let t = 0;
  const registry = createContainerRegistry({
    path: join(tmpdir(), `stack-life-${process.pid}-${Math.random()}.json`),
    now: () => t,
    write: () => {},
  });
  // What the server remembers of each monitor's last container (refresh.js records it every cycle).
  const monitorsSeen = createServiceRegistry({
    path: join(tmpdir(), `stack-life-svc-${process.pid}-${Math.random()}.json`),
    now: () => t,
    write: () => {},
  });
  const cycle = ({ gone = null, monitor = 'up', at }) => {
    t = at;
    const monitors = {};
    for (const [c, id] of Object.entries(MONITOR_ID)) {
      monitors[id] = {
        id,
        name: NAME[c],
        type: 'http',
        ping: 50,
        uptime24: 1,
        active: true,
        ...STATE.up,
      };
    }
    if (gone && MONITOR_ID[gone]) Object.assign(monitors[MONITOR_ID[gone]], STATE[monitor]);
    const r = assembleServices({
      nodeResults: [
        [
          'vm103',
          { display_name: 'Production' },
          {
            reachable: true,
            metrics: { cpu: '5', memPercent: '10', diskPercent: '10' },
            containers: ALL.filter((c) => c.container !== gone),
          },
        ],
      ],
      monitors,
      config: { services: SERVICES },
      lastSeenNodeOf: (id) => monitorsSeen.getLastSeenNode(id),
      lastSeenContainerOf: (id) => monitorsSeen.getLastSeenContainer(id),
      containerRegistry: registry,
      now: () => t,
    });
    for (const { monitorId, nodeKey, container } of r.seen)
      monitorsSeen.recordSeen(monitorId, nodeKey, container);
    const status = snapshotAfter(cachesOfAssembled(r), null, { now: 1_782_345_600_000 }).status;
    const view = status.rows ?? status;
    const rowIds = status.entities
      .filter((e) => e.subsystem === 'services' && !e.foldedInto)
      .map((e) => e.id)
      .sort();
    const leads = Object.fromEntries(
      status.entities.filter((e) => e.stack).map((e) => [e.stack.id, e.id])
    );
    return {
      r,
      status,
      rowIds,
      leads,
      issues: view.issues,
      entity: (id) => status.entities.find((e) => e.id === id),
    };
  };
  // Two cycles with everything up, 2 minutes apart: every container is established.
  cycle({ at: 0 });
  const base = cycle({ at: 120_000 });
  return { cycle, base };
}

const SVC = (c) => `services/vm103:${c}`;
const monitorsOfRows = (r) => ({
  immich: r.monitorOf['vm103:immich-server'],
  nextcloud: r.monitorOf['vm103:nextcloud-app'],
  collabora: r.monitorOf['vm103:collabora'],
});

for (const [label, gone, mon, word, issue] of [
  [
    '(a) nextcloud-app gone, its monitor down',
    'nextcloud-app',
    'down',
    'Down',
    SVC('nextcloud-app'),
  ],
  [
    '(b) nextcloud-app gone, its monitor still up',
    'nextcloud-app',
    'up',
    'Missing',
    SVC('nextcloud-app'),
  ],
  [
    '(b) nextcloud-app gone, its monitor pending',
    'nextcloud-app',
    'pending',
    'No signal',
    SVC('nextcloud-app'),
  ],
  [
    '(b) nextcloud-app gone, its monitor paused',
    'nextcloud-app',
    'paused',
    'Missing',
    SVC('nextcloud-app'),
  ],
  [
    '(c) immich-server gone, its monitor down',
    'immich-server',
    'down',
    'Down',
    SVC('immich-server'),
  ],
  [
    '(d) loki-proxy gone, its monitor down, loki runs',
    'loki-proxy',
    'down',
    'Down',
    SVC('loki-proxy'),
  ],
]) {
  test(`stack lifecycle ${label}: the stack keeps its lead and its row, Collabora keeps its own`, () => {
    const { cycle, base } = watched();
    const stopped = cycle({ gone, monitor: mon, at: 240_000 });
    assert.deepEqual(stopped.rowIds, base.rowIds, 'no row id moved');
    assert.deepEqual(stopped.leads, base.leads, 'no lead moved');
    const project = {
      'nextcloud-app': 'nextcloud',
      'immich-server': 'immich',
      'loki-proxy': 'loki',
    }[gone];
    const lead = stopped.entity(SVC(gone));
    assert.ok(lead?.stack, `${gone} still leads ${project}`);
    assert.equal(lead.stack.project, project);
    assert.equal(lead.stack.count, base.entity(SVC(gone)).stack.count);
    if (word === 'Down') assert.equal(lead.stack.rollup.word, 'Down');
    assert.equal(lead.stack.rollup.state === 'crit' || word !== 'Down', true);
    if (word === 'Missing' || word === 'No signal') assert.equal(lead.stack.rollup.word, word);
    assert.equal(lead.stack.rollup.member, null, 'the lead says it itself, no other row is blamed');
    assert.deepEqual(
      stopped.issues.map((i) => i.id),
      issue ? [issue] : [],
      'Attention names the lead'
    );
    // Collabora is still its own row with its own monitor's heartbeats.
    assert.equal(stopped.entity(SVC('collabora')).stack, undefined);
    assert.equal(stopped.entity(SVC('collabora')).foldedInto, undefined);
    assert.equal(stopped.r.monitorOf['vm103:collabora'], '3');
    if (gone === 'nextcloud-app' && mon === 'down')
      assert.equal(stopped.r.monitorOf['vm103:nextcloud-app'], '2');
    assert.deepEqual(monitorsOfRows(stopped.r).collabora, '3');
  });
}

test('stack lifecycle (e) collabora gone while nextcloud-app runs: Collabora is its own row, Down; Nextcloud is untouched', () => {
  const { cycle, base } = watched();
  const stopped = cycle({ gone: 'collabora', monitor: 'down', at: 240_000 });
  assert.deepEqual(stopped.rowIds, base.rowIds);
  assert.deepEqual(stopped.leads, base.leads);
  assert.equal(stopped.entity(SVC('collabora')).state, 'crit');
  assert.equal(stopped.entity(SVC('collabora')).stack, undefined);
  assert.equal(stopped.entity(SVC('nextcloud-app')).stack.rollup.state, 'ok');
  assert.deepEqual(
    stopped.issues.map((i) => i.id),
    [SVC('collabora')]
  );
});

test('stack lifecycle (f) the container comes back: the board is the board it was', () => {
  const { cycle, base } = watched();
  cycle({ gone: 'nextcloud-app', monitor: 'down', at: 240_000 });
  const back = cycle({ at: 360_000 });
  assert.deepEqual(back.rowIds, base.rowIds);
  assert.deepEqual(back.leads, base.leads);
  assert.deepEqual(back.issues, []);
  assert.equal(back.entity(SVC('nextcloud-app')).stack.rollup.word, 'Up');
});
