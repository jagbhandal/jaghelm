/**
 * Compose stacks (#642): the grouping rule, the rollup, the counts, the
 * overrides, and that no uid moves. Cases are Jag's live board (vm-103 and the
 * two Pis), through the real assembleServices and the status model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleServices } from './refresh.js';
import { groupStacks, isWebMonitor, leadRank, rollupOf } from './stacks.js';
import { cachesOfAssembled, snapshotAfter } from './testing/pushPipeline.js';

const run = (nodeResults, { monitors = {}, services = {}, stacks, registry = null } = {}) =>
  assembleServices({
    nodeResults,
    monitors,
    config: { services, stacks },
    lastSeenNodeOf: () => null,
    lastSeenContainerOf: () => null,
    containerRegistry: registry,
    now: () => 0,
  });
const ctr = (container, project, extra = {}) => ({
  container,
  status: 'running',
  docker: { cpu: 1 },
  ...(project ? { project } : {}),
  ...extra,
});
const node = (containers) => [
  { display_name: 'Production' },
  { reachable: true, metrics: { cpu: '5', memPercent: '10', diskPercent: '10' }, containers },
];
const up = (id, name, extra = {}) => ({
  id,
  name,
  status: 'up',
  kumaStatus: 'up',
  ping: 5,
  uptime24: 1,
  active: true,
  ...extra,
});

// vm-103, as the live board has it (names from cAdvisor, monitors from Kuma).
const vm103 = () => [
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
  ctr('cadvisor', 'prometheus-metrics'),
  ctr('node-exporter', 'prometheus-metrics'),
  ctr('nut-exporter', 'prometheus-metrics'),
  ctr('gitea', 'gitea'),
  ctr('grafana'),
];
const MAP = {
  'immich-server': { monitor: 'Immich' },
  'nextcloud-app': { monitor: 'Nextcloud' },
  collabora: { monitor: 'Collabora' },
  wikijs: { monitor: 'Wiki.js' },
  gitea: { monitor: 'Gitea' },
};
const MONITORS = {
  1: up(1, 'Immich', { type: 'http' }),
  2: up(2, 'Nextcloud', { type: 'http' }),
  3: up(3, 'Collabora', { type: 'http' }),
  4: up(4, 'Wiki.js', { type: 'http' }),
  5: up(5, 'Gitea', { type: 'http' }),
};
const board = (opts = {}) =>
  run([['vm103', ...node(vm103())]], { monitors: MONITORS, services: MAP, ...opts });
const cards = (r, n = 'vm103') =>
  Object.fromEntries(r.nodes[n].services.map((c) => [c.container, c]));
const rowsOf = (r, n = 'vm103') => r.nodes[n].services.filter((c) => !c.foldedInto);

test('stacks: Immich is one row led by the monitored member, the three others folded', () => {
  const c = cards(board());
  assert.equal(c['immich-server'].stack.members.length, 4);
  assert.equal(c['immich-server'].stack.project, 'immich');
  assert.equal(c['immich-server'].stack.id, 'vm103:immich');
  assert.equal(c['immich-server'].stack.name, 'Immich');
  assert.equal(c['immich-server'].stack.members[0].lead, true);
  for (const m of ['immich-machine-learning', 'immich-postgres', 'immich-redis']) {
    assert.equal(c[m].foldedInto, 'vm103:immich-server');
    assert.equal(c[m].stack, undefined);
  }
});

test('stacks: Nextcloud and Collabora are two rows; the unmonitored members fold into Nextcloud', () => {
  const c = cards(board());
  assert.deepEqual(c['nextcloud-app'].stack.members.map((m) => m.container).sort(), [
    'nextcloud-app',
    'nextcloud-cron',
    'nextcloud-db',
    'nextcloud-redis',
  ]);
  assert.equal(c.collabora.foldedInto, undefined);
  assert.equal(c.collabora.stack, undefined);
});

test('stacks: Wiki.js (3), Loki + loki-proxy and Prometheus metrics (4) group; a lone container does not', () => {
  const r = board();
  const c = cards(r);
  assert.equal(c.wikijs.stack.members.length, 3);
  assert.equal(c.loki.stack.members.length, 2); // no monitor: the project's own name leads
  assert.equal(c['loki-proxy'].foldedInto, 'vm103:loki');
  // No monitor and no member named for the project: the shortest main-less name leads, by name alone.
  const prom = Object.values(c).find((x) => x.stack?.project === 'prometheus-metrics');
  assert.ok(prom);
  assert.equal(prom.stack.members.length, 4);
  assert.equal(c.gitea.stack, undefined, 'a project of one container is no stack');
  assert.equal(c.grafana.foldedInto, undefined, 'no project label: its own row');
  // 20 containers on the node, 12 of them folded: 8 rows.
  assert.equal(r.nodes.vm103.services.length, 20);
  assert.equal(rowsOf(r).length, 8);
});

test('stacks: the same container on two Pis is two rows, never a stack; one project across two nodes is two stacks', () => {
  const r = run(
    [
      ['pi1', ...node([ctr('gateway-npm', 'gateway'), ctr('adguard', 'adguard')])],
      ['pi2', ...node([ctr('gateway-npm', 'gateway'), ctr('adguard', 'adguard')])],
      ['vm1', ...node([ctr('web', 'shared'), ctr('db', 'shared')])],
      ['vm2', ...node([ctr('web2', 'shared')])],
    ],
    { monitors: {}, services: {} }
  );
  for (const n of ['pi1', 'pi2', 'vm2']) {
    for (const c of r.nodes[n].services)
      assert.ok(!c.stack && !c.foldedInto, `${n}:${c.container}`);
  }
  assert.equal(cards(r, 'vm1').web.stack.members.length, 2, 'a stack is one project on ONE node');
});

test('stacks: no project label means no grouping, and a cAdvisor without it degrades to today', () => {
  const r = run([['pi1', ...node([ctr('a'), ctr('b'), ctr('c')])]]);
  assert.ok(r.nodes.pi1.services.every((c) => !c.stack && !c.foldedInto && !('project' in c)));
});

test('stacks: a stopped member (presence card) stays in its stack and rolls the row up to warn', () => {
  const registry = {
    recordSeen() {},
    getMissing: () => [
      {
        container: 'immich-redis',
        lastSeenNode: 'vm103',
        lastSeenAt: 0,
        ageMs: 600_000,
        project: 'immich',
      },
    ],
  };
  const list = vm103().filter((c) => c.container !== 'immich-redis');
  const r = run([['vm103', ...node(list)]], { monitors: MONITORS, services: MAP, registry });
  const c = cards(r);
  assert.equal(c['immich-redis'].source, 'presence');
  assert.equal(c['immich-redis'].foldedInto, 'vm103:immich-server');
  assert.equal(c['immich-server'].stack.rollup.state, 'warn');
  assert.equal(c['immich-server'].stack.rollup.word, 'Degraded');
  assert.equal(c['immich-server'].stack.rollup.reason, 'Immich Redis has stopped');
});

test('stacks: a stack whose only running member is the stopped one is no stack', () => {
  const nodes = {
    n: {
      services: [
        { uid: 'n:a', container: 'a', project: 'p', source: 'presence', status: 'unknown' },
      ],
    },
  };
  groupStacks({ nodes, stacks: null });
  assert.equal(nodes.n.services[0].stack, undefined);
});

test('stacks: ties and order: the lead depends on names alone', () => {
  const make = (order) => {
    const list = order.map((n) => ({
      uid: `n:${n}`,
      container: n,
      display_name: n,
      project: 'app',
      source: 'container',
      status: 'up',
      monitored: false,
    }));
    groupStacks({ nodes: { n: { services: list } } });
    return list.find((c) => c.stack)?.container;
  };
  const a = ['app-db', 'app-redis', 'app-worker', 'app'];
  assert.equal(make(a), 'app');
  assert.equal(make([...a].reverse()), 'app');
  // Equal rank, equal length: the name breaks the tie.
  const b = ['zeta', 'alfa', 'beta'];
  assert.equal(make(b), make([...b].reverse()));
  assert.equal(make(b), 'alfa');
  assert.ok(leadRank('immich-server', 'immich') < leadRank('immich-redis', 'immich'));
  assert.ok(leadRank('loki', 'loki') < leadRank('loki-proxy', 'loki'));
});

test('stacks: two monitored members: the one named for the project leads, the other keeps its row', () => {
  const r = run(
    [
      [
        'n',
        ...node([
          ctr('nextcloud-aio', 'nextcloud'),
          ctr('collabora', 'nextcloud'),
          ctr('nextcloud-redis', 'nextcloud'),
        ]),
      ],
    ],
    {
      monitors: {
        1: up(1, 'Nextcloud', { type: 'http' }),
        2: up(2, 'Collabora', { type: 'http' }),
      },
      services: { 'nextcloud-aio': { monitor: 'Nextcloud' }, collabora: { monitor: 'Collabora' } },
    }
  );
  const c = cards(r, 'n');
  assert.deepEqual(
    c['nextcloud-aio'].stack.members.map((m) => m.container),
    ['nextcloud-aio', 'nextcloud-redis']
  );
  assert.equal(c.collabora.stack, undefined);
});

test('stacks: a monitor that checks a port or a ping is not a web address: the member folds', () => {
  assert.equal(isWebMonitor({ type: 'port' }), false);
  assert.equal(isWebMonitor({ type: 'ping' }), false);
  assert.equal(isWebMonitor({ type: 'http' }), true);
  assert.equal(isWebMonitor({}), true, 'a monitor of unknown kind counts as one');
  const r = run([['n', ...node([ctr('app', 'p'), ctr('db', 'p')])]], {
    monitors: { 1: up(1, 'App', { type: 'http' }), 2: up(2, 'DB tcp', { type: 'port' }) },
    services: { app: { monitor: 'App' }, db: { monitor: 'DB tcp' } },
  });
  assert.equal(cards(r, 'n').db.foldedInto, 'n:app');
});

test('stacks: uids, statuses and the card list are the same with and without grouping', () => {
  const plain = vm103().map(({ project: _p, ...c }) => c);
  const before = run([['vm103', ...node(plain)]], { monitors: MONITORS, services: MAP });
  const after = board();
  const shape = (r) =>
    r.nodes.vm103.services.map((c) => [c.uid, c.status, c.monitored, c.container]);
  assert.deepEqual(shape(after), shape(before));
  assert.deepEqual(after.monitorOf, before.monitorOf);
  assert.deepEqual(after.upWithoutCard, before.upWithoutCard);
  assert.equal(after.containerCount, before.containerCount);
  assert.equal(after.overallHealth, before.overallHealth);
});

// ---- rollup ----

const m = (id, state, word = '', name = id) => ({ id, name, state, word, reason: '' });

test('rollup: the worst member, down over warn over unknown over up; maintenance is none of them', () => {
  const lead = m('lead', 'ok', 'Up');
  assert.equal(rollupOf([lead, m('a', 'ok'), m('b', 'maintenance')], 'lead').state, 'ok');
  assert.equal(rollupOf([lead, m('a', 'unknown')], 'lead').state, 'unknown');
  assert.equal(rollupOf([lead, m('a', 'unknown'), m('b', 'warn')], 'lead').state, 'warn');
  const down = rollupOf([lead, m('a', 'warn'), m('b', 'crit', 'Down', 'Immich Redis')], 'lead');
  assert.deepEqual(
    [down.state, down.word, down.reason, down.id],
    ['crit', 'Degraded', 'Immich Redis is down', 'b']
  );
});

test('rollup: a failing lead keeps its own word, and the order of members changes nothing', () => {
  const lead = {
    id: 'lead',
    name: 'Immich Server',
    state: 'crit',
    word: 'Down',
    reason: 'Kuma: down',
  };
  const rest = [m('a', 'crit', 'Down'), m('b', 'warn', 'Missing')];
  const own = rollupOf([lead, ...rest], 'lead');
  assert.deepEqual([own.state, own.word, own.id], ['crit', 'Down', null]);
  const x = rollupOf([lead2(), m('b', 'crit', 'Down'), m('a', 'crit', 'Down')], 'lead');
  const y = rollupOf([m('a', 'crit', 'Down'), lead2(), m('b', 'crit', 'Down')], 'lead');
  assert.deepEqual(x, y);
  assert.equal(x.id, 'a');
  function lead2() {
    return m('lead', 'ok', 'Up');
  }
});

// ---- the model: rows, counts, push ----

const statusOf = (r) => snapshotAfter(cachesOfAssembled(r)).status;

test('status: a stack is one row; its members stay entities; push keys are untouched', () => {
  const s = statusOf(board());
  const services = s.rows.subsystems.find((x) => x.id === 'services');
  assert.equal(services.counts.total, 8);
  assert.equal(s.entities.filter((e) => e.subsystem === 'services').length, 20);
  const lead = s.entities.find((e) => e.id === 'services/vm103:immich-server');
  assert.equal(lead.stack.count, 4);
  assert.equal(lead.stack.rollup.state, 'ok');
  assert.equal(
    s.entities.find((e) => e.id === 'services/vm103:immich-redis').foldedInto,
    'services/vm103:immich-server'
  );
  assert.equal(s.rows.overall.state, 'ok');
});

test('status: a failing member makes the stack degraded and the issue names it, once', () => {
  const list = vm103();
  const redis = list.find((c) => c.container === 'immich-redis');
  const registry = {
    recordSeen() {},
    getMissing: () => [
      {
        container: 'immich-redis',
        lastSeenNode: 'vm103',
        lastSeenAt: 0,
        ageMs: 600_000,
        project: 'immich',
      },
    ],
  };
  const r = run([['vm103', ...node(list.filter((c) => c !== redis))]], {
    monitors: MONITORS,
    services: MAP,
    registry,
  });
  const s = statusOf(r);
  const own = s.entities.find((e) => e.id === 'services/vm103:immich-redis');
  assert.equal(own.state, 'warn', 'the member is judged as before');
  assert.equal(own.word, 'Missing');
  assert.equal(s.rows.issues.length, 1, 'the member is not a second issue');
  assert.equal(s.rows.issues[0].id, 'services/vm103:immich-server');
  assert.equal(s.rows.issues[0].word, 'Degraded');
  assert.equal(s.rows.issues[0].reason, 'Immich Redis has stopped');
  const tile = s.rows.subsystems.find((x) => x.id === 'services');
  assert.equal(tile.value, '7 / 8');
  assert.equal(tile.sub, '1 degraded');
  assert.equal(s.rows.overall.sentence, 'Immich Redis has stopped');
});

test('status: custom groups hold uids, so a folded member is still found by its own uid', () => {
  const s = statusOf(board());
  assert.ok(s.entities.some((e) => e.id === 'services/vm103:immich-redis' && e.foldedInto));
});

// ---- overrides ----

test('stacks override: lead, ungroup and split, keyed by node:project', () => {
  const lead = cards(board({ stacks: { 'vm103:immich': { lead: 'immich-postgres' } } }));
  assert.deepEqual(lead['immich-postgres'].stack.members.map((x) => x.container).sort(), [
    'immich-machine-learning',
    'immich-postgres',
    'immich-redis',
  ]);
  assert.equal(lead['immich-server'].foldedInto, undefined, 'a monitored member keeps its row');
  assert.equal(lead['immich-server'].stack, undefined);

  const off = cards(board({ stacks: { 'vm103:immich': { ungroup: true } } }));
  assert.ok(
    Object.values(off)
      .filter((c) => c.project === 'immich')
      .every((c) => !c.stack && !c.foldedInto)
  );
  assert.equal(
    cards(board({ stacks: { 'vm103:immich': { ungroup: true } } }))['nextcloud-app'].stack.members
      .length,
    4
  );

  const split = cards(board({ stacks: { 'vm103:immich': { split: ['immich-redis'] } } }));
  assert.equal(split['immich-redis'].foldedInto, undefined);
  assert.equal(split['immich-server'].stack.members.length, 3);
});

test('stacks override: a per-node override leaves the other nodes alone', () => {
  const r = run(
    [
      ['a', ...node([ctr('app', 'p'), ctr('db', 'p')])],
      ['b', ...node([ctr('app', 'p'), ctr('db', 'p')])],
    ],
    { stacks: { 'a:p': { ungroup: true } } }
  );
  assert.equal(cards(r, 'a').db.foldedInto, undefined);
  assert.equal(cards(r, 'b').db.foldedInto, 'b:app');
});

test('stacks override: a stack name, and entries of the wrong type, never throw', () => {
  const named = cards(board({ stacks: { 'vm103:wikijs': { display_name: 'Wiki.js' } } }));
  assert.equal(named.wikijs.stack.name, 'Wiki.js');
  for (const bad of [
    null,
    'x',
    5,
    [],
    { 'vm103:immich': 'oops' },
    { 'vm103:immich': { split: 'a', lead: 3 } },
    { nocolon: {} },
    { 'ghost:nothing': { ungroup: true } },
    { 'vm103:ghost': { lead: 'x' } },
  ]) {
    assert.doesNotThrow(() => board({ stacks: bad }));
  }
  assert.equal(
    cards(board({ stacks: { 'vm103:immich': { lead: 'nope' } } }))['immich-server'].stack.members
      .length,
    4
  );
});

test("stacks: a stack is named for its lead when that is the project's own container, else the project in words", () => {
  const c = cards(
    board({ services: { ...MAP, wikijs: { monitor: 'Wiki.js', display_name: 'Wiki.js' } } })
  );
  assert.equal(
    c.wikijs.stack.name,
    'Wiki.js',
    'the lead is named wikijs and renamed in services.yaml'
  );
  assert.equal(c.loki.stack.name, 'Loki');
  assert.equal(
    c['immich-server'].stack.name,
    'Immich',
    'immich-server leads, the project gives the name'
  );
  assert.equal(
    cards(board({ stacks: { 'vm103:immich': { display_name: 'Photos' } } }))['immich-server'].stack
      .name,
    'Photos'
  );
});

// ---- the fix pass: stability, helpers, no signal, pi-2 ----

const PROJECT_OF = Object.fromEntries(
  vm103()
    .filter((c) => c.project)
    .map((c) => [c.container, c.project])
);
const MONITOR_OF = { 'immich-server': 1, 'nextcloud-app': 2, collabora: 3, wikijs: 4, gitea: 5 };

/** vm-103 with `stopped` not running: its monitor (if any) down, the registry remembering its project. */
function withStopped(stopped, extra = {}) {
  const monitors = structuredClone(MONITORS);
  if (stopped && MONITOR_OF[stopped]) {
    monitors[MONITOR_OF[stopped]] = {
      ...monitors[MONITOR_OF[stopped]],
      status: 'down',
      kumaStatus: 'down',
      ping: null,
    };
  }
  const registry = stopped
    ? {
        recordSeen() {},
        getMissing: () => [
          {
            container: stopped,
            lastSeenNode: 'vm103',
            lastSeenAt: 0,
            ageMs: 600_000,
            project: PROJECT_OF[stopped],
          },
        ],
      }
    : null;
  return run([['vm103', ...node(vm103().filter((c) => c.container !== stopped))]], {
    monitors,
    services: MAP,
    registry,
    ...extra,
  });
}
const leadsOf = (r) =>
  Object.fromEntries(r.nodes.vm103.services.filter((c) => c.stack).map((c) => [c.stack.id, c.uid]));

test("stacks: the lead and the rows do not move when any member stops (Jag's real names)", () => {
  const settled = withStopped(null);
  const before = leadsOf(settled);
  assert.deepEqual(before, {
    'vm103:immich': 'vm103:immich-server',
    'vm103:nextcloud': 'vm103:nextcloud-app',
    'vm103:wikijs': 'vm103:wikijs',
    'vm103:loki': 'vm103:loki',
    'vm103:prometheus-metrics': 'vm103:prometheus',
  });
  const rowIds = (r) =>
    r.nodes.vm103.services
      .filter((c) => !c.foldedInto)
      .map((c) => c.uid)
      .sort();
  for (const name of vm103().map((c) => c.container)) {
    const r = withStopped(name);
    assert.deepEqual(leadsOf(r), before, `${name} stopped moved a lead`);
    assert.deepEqual(rowIds(r), rowIds(settled), `${name} stopped moved a row`);
  }
});

test('stacks: Nextcloud stopped keeps its own row, Down, and Collabora stays its own row', () => {
  const r = withStopped('nextcloud-app');
  const c = cards(r);
  assert.equal(c['nextcloud-app'].source, 'monitor');
  assert.equal(c['nextcloud-app'].stack.members.length, 4);
  assert.equal(c['nextcloud-app'].stack.rollup.word, 'Down');
  assert.equal(c['nextcloud-app'].stack.rollup.member, null);
  assert.equal(c.collabora.stack, undefined);
  const s = statusOf(r);
  const issue = s.rows.issues.find((i) => i.id === 'services/vm103:nextcloud-app');
  assert.equal(issue.word, 'Down');
});

test('stacks: Immich Server stopped: Redis does not take the lead; the stack is Down', () => {
  const r = withStopped('immich-server');
  const c = cards(r);
  assert.equal(c['immich-redis'].foldedInto, 'vm103:immich-server');
  assert.equal(c['immich-server'].stack.rollup.word, 'Down');
});

test('stacks: an unmonitored lead that stops keeps the row with its own state', () => {
  const r = withStopped('loki');
  const c = cards(r);
  assert.equal(c.loki.source, 'presence');
  assert.equal(c.loki.stack.members.length, 2);
  assert.equal(c.loki.stack.rollup.word, 'Missing');
  assert.equal(c['loki-proxy'].foldedInto, 'vm103:loki');
});

test('stacks: exporters and cAdvisor never lead while anything else can (vm-101)', () => {
  const list = ['cadvisor', 'node-exporter', 'nut-exporter', 'prometheus'].map((n) =>
    ctr(n, 'prometheus-metrics')
  );
  for (const order of [list, [...list].reverse()]) {
    const r = run([['vm101', ...node(order)]]);
    assert.equal(r.nodes.vm101.services.find((c) => c.stack).container, 'prometheus');
  }
  // With nothing else, a helper leads: deterministic, shortest name first.
  const only = run([['vm101', ...node([ctr('node-exporter', 'm'), ctr('cadvisor', 'm')])]]);
  assert.equal(only.nodes.vm101.services.find((c) => c.stack).container, 'cadvisor');
});

test('stacks: pi-2 gateway-tunnel folds into gateway-npm, and split gives it back its row', () => {
  const pi = (stacks) =>
    run(
      [
        ['pi2', ...node([ctr('gateway-npm', 'gateway-npm'), ctr('gateway-tunnel', 'gateway-npm')])],
        [
          'pi1',
          ...node([
            ctr('gateway-npm', 'gateway-npm'),
            ctr('gateway-tunnel', 'cloudflared'),
            ctr('cadvisor', 'monitoring'),
            ctr('node-exporter', 'monitoring'),
          ]),
        ],
      ],
      { stacks }
    );
  const plain = pi();
  assert.equal(cards(plain, 'pi2')['gateway-tunnel'].foldedInto, 'pi2:gateway-npm');
  assert.equal(cards(plain, 'pi2')['gateway-npm'].stack.chip, undefined);
  assert.equal(cards(plain, 'pi1')['gateway-tunnel'].foldedInto, undefined);
  assert.equal(cards(plain, 'pi1')['gateway-npm'].stack, undefined);
  const split = pi({ 'pi2:gateway-npm': { split: ['gateway-tunnel'] } });
  assert.equal(cards(split, 'pi2')['gateway-tunnel'].foldedInto, undefined);
  assert.equal(cards(split, 'pi2')['gateway-npm'].stack, undefined);
});

test('stacks: a port-monitored member folds under an unmonitored lead and its monitor still rolls up', () => {
  const r = run([['n', ...node([ctr('app', 'p'), ctr('db', 'p')])]], {
    monitors: { 1: up(1, 'DB tcp', { type: 'port', status: 'down', kumaStatus: 'down' }) },
    services: { db: { monitor: 'DB tcp' } },
  });
  const c = cards(r, 'n');
  assert.equal(c.db.foldedInto, 'n:app');
  const s = statusOf(r);
  const issue = s.rows.issues.find((i) => i.id === 'services/n:app');
  assert.equal(issue.reason, 'Db is down');
  assert.equal(issue.word, 'Degraded');
});

test('rollup: a member with no signal is not "Degraded"', () => {
  const out = rollupOf([m('lead', 'ok', 'Up'), m('a', 'unknown', 'No signal', 'Redis')], 'lead');
  assert.deepEqual(
    [out.state, out.word, out.reason],
    ['unknown', 'No signal', 'Redis has no signal']
  );
});

test('status: the old fields count every container, the new `rows` count stacks', () => {
  const plain = statusOf(withStopped(null)); // stacks present
  assert.ok(plain.rows, 'a board with stacks carries rows');
  const svc = (st) => st.subsystems.find((x) => x.id === 'services').counts.total;
  assert.equal(svc(plain), 20);
  assert.equal(svc(plain.rows), 8);
  const none = statusOf(run([['pi1', ...node([ctr('a'), ctr('b')])]]));
  assert.equal('rows' in none, false, 'a board with no stack is as it was');
});

test('status: overall, issues and subsystems are exactly what a board with no project labels gives (old clients)', () => {
  const stacked = (stopped) => statusOf(withStopped(stopped));
  const bare = (stopped) => {
    const r = withStopped(stopped);
    for (const n of Object.values(r.nodes))
      for (const c of n.services) {
        delete c.project;
        delete c.stack;
        delete c.foldedInto;
      }
    return statusOf(r);
  };
  for (const stopped of [null, 'immich-redis', 'nextcloud-app', 'loki']) {
    const a = stacked(stopped);
    const b = bare(stopped);
    assert.deepEqual(JSON.stringify(a.overall), JSON.stringify(b.overall), String(stopped));
    assert.deepEqual(JSON.stringify(a.issues), JSON.stringify(b.issues), String(stopped));
    assert.deepEqual(JSON.stringify(a.subsystems), JSON.stringify(b.subsystems), String(stopped));
    assert.ok(a.rows && !('rows' in b));
  }
});
