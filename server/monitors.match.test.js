// Monitor matching (#240): scoreMatch's kinds, and assignMonitors' preference
// order, ties, explicit mappings (monitor, monitor_per_node, false) and
// stopped containers, as tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'silent';
const { scoreMatch, assignMonitors, mappingOf } = await import('./monitors.js');

// ── scoreMatch ───────────────────────────────────────────────────────────

const SCORES = [
  // [container, monitor, kind or null, score, helper]
  ['gitea', 'Gitea', 'exact', 5, false],
  ['home-assistant', 'Home Assistant', 'exact', 13, false],
  ['grafana', 'https://grafana.example.com', 'url', 7, false],
  ['grafana', 'grafana.example.com', 'url', 7, false],
  ['my-app', 'my-app.example.com', 'url', 5, false],
  ['wikijs', 'wiki.example.com', 'contains', 4, false],
  ['gitea-runner', 'Gitea', 'contains', 5, true],
  ['nextcloud-app', 'Nextcloud', 'contains', 9, false],
  ['immich-redis', 'Immich', 'contains', 6, true],
  ['immich-machine-learning', 'Immich', 'contains', 6, true],
  ['npm', 'NPM Proxy', 'contains', 3, false],
  ['gateway-npm', 'Pi Gateway (Ping)', 'word', 7, false],
  ['gateway-npm', 'NPM Gateway Primary', 'word', 10, false],
  ['npm-tool', 'NPM Pi', null], // shares only a 3-letter word
  ['api-gateway', 'Gate keeper', null],
  ['alloy', 'Grafana', null],
  ['node', '192.168.1.5', null], // an IP's first label is no hostname
  ['', 'Gitea', null],
  ['gitea', '', null],
];

for (const [container, monitor, kind, score, helper] of SCORES) {
  test(`scoreMatch: ${container || '(empty)'} vs "${monitor}" is ${kind ?? 'no match'}`, () => {
    const got = scoreMatch(container, monitor);
    if (kind === null) assert.equal(got, null);
    else assert.deepEqual(got, { kind, score, helper });
  });
}

// ── assignMonitors ───────────────────────────────────────────────────────

const mon = (id, name, status = 'up') => ({ id, name, status, ping: 1, uptime24: 1, active: true, lastBeatAt: null });

/**
 * Run assignMonitors on 'node:container' candidates and return
 * { 'node:container': monitor name or null }. A candidate ending in '!' is a
 * container that stopped. Node order is the order nodes first appear in
 * `candidates` unless given. `explicit` is shorthand for `services` entries
 * with only `monitor:`. The monitors go in as the id map fetchMonitors
 * returns, or with `asList` as an array in the given order (an id map lists
 * integer keys in ascending order whatever the insertion order).
 */
function assign(candidates, monitorList, { explicit = {}, services, nodeOrder, asList = false } = {}) {
  const cands = candidates.map((s) => {
    const stopped = s.endsWith('!');
    const [nodeKey, container] = (stopped ? s.slice(0, -1) : s).split(':');
    return stopped ? { nodeKey, container, stopped } : { nodeKey, container };
  });
  const result = assignMonitors({
    candidates: cands,
    monitors: asList ? monitorList : Object.fromEntries(monitorList.map((m) => [m.id, m])),
    services: services ?? Object.fromEntries(Object.entries(explicit).map(([name, monitor]) => [name, { monitor }])),
    nodeOrder: nodeOrder ?? [...new Set(cands.map((c) => c.nodeKey))],
  });
  return Object.fromEntries(candidates.map((s, i) => [s, result[i]?.name ?? null]));
}

const PREFERENCES = [
  {
    name: 'an explicit mapping beats an exact name, and that monitor goes to no one else',
    candidates: ['vm103:gitea', 'vm103:forge'],
    monitors: [mon(1, 'Gitea')],
    explicit: { forge: 'gitea' },
    want: { 'vm103:gitea': null, 'vm103:forge': 'Gitea' },
  },
  {
    name: 'an explicit mapping matches the monitor name case-insensitively, however unlike the container',
    candidates: ['vm103:postgres'],
    monitors: [mon(1, 'pgmon'), mon(2, 'Postgres')],
    explicit: { postgres: 'PGMON' },
    want: { 'vm103:postgres': 'pgmon' },
  },
  {
    name: 'a mapped monitor stays reserved while its container is absent: a lookalike does not take it',
    candidates: ['vm103:gitea-runner'],
    monitors: [mon(1, 'Gitea')],
    explicit: { forge: 'Gitea' },
    want: { 'vm103:gitea-runner': null },
  },
  {
    name: 'one container on two nodes: the first node in board order',
    candidates: ['vm103:alloy', 'pi1:alloy'],
    monitors: [mon(1, 'Alloy')],
    nodeOrder: ['pi1', 'vm103'],
    want: { 'pi1:alloy': 'Alloy', 'vm103:alloy': null },
  },
  {
    name: 'exact name beats a URL match (a container takes its best monitor)',
    candidates: ['vm103:grafana'],
    monitors: [mon(1, 'grafana.example.com'), mon(2, 'Grafana')],
    want: { 'vm103:grafana': 'Grafana' },
  },
  {
    name: 'exact name beats containment (two containers want one monitor)',
    candidates: ['vm103:gitea-runner', 'vm103:gitea'],
    monitors: [mon(1, 'Gitea')],
    want: { 'vm103:gitea': 'Gitea', 'vm103:gitea-runner': null },
  },
  {
    name: 'a URL match beats containment',
    candidates: ['vm103:wikijs', 'vm103:wiki'],
    monitors: [mon(1, 'wiki.example.com')],
    want: { 'vm103:wiki': 'wiki.example.com', 'vm103:wikijs': null },
  },
  {
    name: 'containment beats a shared word, even a longer one (the kind ranks above the score)',
    candidates: ['vm103:backup-server-tool', 'vm103:media'],
    monitors: [mon(1, 'Media Server Backup')],
    want: { 'vm103:media': 'Media Server Backup', 'vm103:backup-server-tool': null },
  },
  {
    name: 'within a kind, the higher score wins',
    candidates: ['pi1:gateway-tunnel', 'pi1:gateway-npm'],
    monitors: [mon(1, 'NPM Gateway')],
    want: { 'pi1:gateway-npm': 'NPM Gateway', 'pi1:gateway-tunnel': null },
  },
  {
    name: 'a better match on a later node beats board order (the node only breaks ties)',
    candidates: ['vm101:gitea-runner', 'vm103:gitea'],
    monitors: [mon(1, 'Gitea')],
    want: { 'vm103:gitea': 'Gitea', 'vm101:gitea-runner': null },
  },
  {
    name: 'tie: equally good matches, the helper loses (Immich goes to immich-server)',
    candidates: ['vm103:immich-machine-learning', 'vm103:immich-postgres', 'vm103:immich-redis', 'vm103:immich-server'],
    monitors: [mon(1, 'Immich')],
    want: {
      'vm103:immich-machine-learning': null,
      'vm103:immich-postgres': null,
      'vm103:immich-redis': null,
      'vm103:immich-server': 'Immich',
    },
  },
  {
    name: 'tie: helpers on the first node lose to a service on a later node',
    candidates: ['vm103:nextcloud-db', 'pi1:nextcloud-app'],
    monitors: [mon(1, 'Nextcloud')],
    want: { 'pi1:nextcloud-app': 'Nextcloud', 'vm103:nextcloud-db': null },
  },
  {
    name: 'tie: two equally good containers on one node, the name order',
    candidates: ['vm103:foo-beta', 'vm103:foo-alpha'],
    monitors: [mon(1, 'Foo')],
    want: { 'vm103:foo-alpha': 'Foo', 'vm103:foo-beta': null },
  },
  {
    name: 'tie: one container on two nodes and two monitors of its name, one each, lower id to the first node',
    candidates: ['pi2:adguard', 'pi1:adguard'],
    monitors: [mon(2, 'adguard'), mon(1, 'AdGuard')],
    nodeOrder: ['pi1', 'pi2'],
    want: { 'pi1:adguard': 'AdGuard', 'pi2:adguard': 'adguard' },
  },
  {
    name: 'a container takes one monitor, and leaves the others to their own containers',
    candidates: ['vm103:adguard', 'pi2:adguard-secondary', 'pi2:adguard-sync'],
    monitors: [mon(1, 'Adguard Primary'), mon(2, 'Adguard Secondary')],
    want: { 'vm103:adguard': 'Adguard Primary', 'pi2:adguard-secondary': 'Adguard Secondary', 'pi2:adguard-sync': null },
  },
  {
    name: "a service's second monitor does not fall to a weaker lookalike (Gitea SSH is not gitea-runner's)",
    candidates: ['vm103:gitea', 'vm103:gitea-runner'],
    monitors: [mon(1, 'Gitea'), mon(2, 'Gitea SSH')],
    want: { 'vm103:gitea': 'Gitea', 'vm103:gitea-runner': null },
  },
  {
    name: 'a second monitor still goes to a container that matches it as well (Grafana Alloy goes to alloy)',
    candidates: ['vm103:grafana', 'vm103:alloy'],
    monitors: [mon(1, 'Grafana'), mon(2, 'Grafana Alloy')],
    want: { 'vm103:grafana': 'Grafana', 'vm103:alloy': 'Grafana Alloy' },
  },
  {
    name: 'a helper still takes a monitor whose best match is a shared word (Immich ML)',
    candidates: ['vm103:immich-server', 'vm103:immich-machine-learning'],
    monitors: [mon(1, 'Immich'), mon(2, 'Immich ML')],
    want: { 'vm103:immich-server': 'Immich', 'vm103:immich-machine-learning': 'Immich ML' },
  },
  {
    name: 'an explicit mapping to several containers marks each of them',
    candidates: ['vm103:immich-server', 'vm103:immich-machine-learning', 'vm103:immich-redis'],
    monitors: [mon(1, 'Immich')],
    explicit: { 'immich-server': 'Immich', 'immich-machine-learning': 'Immich' },
    want: { 'vm103:immich-server': 'Immich', 'vm103:immich-machine-learning': 'Immich', 'vm103:immich-redis': null },
  },
  {
    name: 'an explicit mapping applies to the container on every node',
    candidates: ['pi1:haproxy', 'pi2:haproxy'],
    monitors: [mon(1, 'HAProxy VIP')],
    explicit: { haproxy: 'HAProxy VIP' },
    want: { 'pi1:haproxy': 'HAProxy VIP', 'pi2:haproxy': 'HAProxy VIP' },
  },
  {
    name: 'an explicit mapping to a missing monitor gets no monitor (no fallback to a name match)',
    candidates: ['pi1:gateway-npm'],
    monitors: [mon(1, 'Pi Gateway (Ping)')],
    explicit: { 'gateway-npm': 'Nginx Proxy Manager' },
    want: { 'pi1:gateway-npm': null },
  },
  {
    name: "an explicit mapping to a missing monitor takes no other container's match",
    candidates: ['pi1:gateway-npm', 'pi1:gateway-tunnel'],
    monitors: [mon(1, 'Pi Gateway (Ping)')],
    explicit: { 'gateway-npm': 'Nginx Proxy Manager' },
    want: { 'pi1:gateway-npm': null, 'pi1:gateway-tunnel': 'Pi Gateway (Ping)' },
  },
  // monitor_per_node (#240, first shipped in 663f2d0)
  {
    name: 'monitor_per_node: the two Pis\' gateway-npm get a monitor each',
    candidates: ['pi1:gateway-npm', 'pi2:gateway-npm'],
    monitors: [mon(1, 'NPM Pi Primary'), mon(2, 'NPM Pi Secondary'), mon(3, 'Pi Gateway (Ping)')],
    services: { 'gateway-npm': { monitor_per_node: { pi1: 'NPM Pi Primary', pi2: 'NPM Pi Secondary' } } },
    want: { 'pi1:gateway-npm': 'NPM Pi Primary', 'pi2:gateway-npm': 'NPM Pi Secondary' },
  },
  {
    name: 'monitor_per_node beats monitor on its node; a node with no entry falls back to monitor',
    candidates: ['pi1:dockge', 'vm101:dockge', 'vm103:dockge'],
    monitors: [mon(1, 'Dockge'), mon(2, 'Dockge (Staging)')],
    services: { dockge: { monitor: 'Dockge', monitor_per_node: { vm101: 'Dockge (Staging)' } } },
    want: { 'pi1:dockge': 'Dockge', 'vm101:dockge': 'Dockge (Staging)', 'vm103:dockge': 'Dockge' },
  },
  {
    name: 'monitor_per_node with no monitor: a node with no entry goes to name matching, without the mapped monitors',
    candidates: ['pi1:vaultwarden', 'pi2:vaultwarden', 'vm101:vaultwarden-backup'],
    monitors: [mon(1, 'Vaultwarden'), mon(2, 'Vaultwarden Backup')],
    services: { vaultwarden: { monitor_per_node: { vm103: 'Vaultwarden' } } },
    want: { 'pi1:vaultwarden': null, 'pi2:vaultwarden': null, 'vm101:vaultwarden-backup': 'Vaultwarden Backup' },
  },
  {
    name: 'monitor_per_node: the pinned node gets it, the replica on another node gets nothing',
    candidates: ['vm103:vaultwarden', 'pi2:vaultwarden'],
    monitors: [mon(1, 'Vaultwarden')],
    services: { vaultwarden: { monitor_per_node: { vm103: 'Vaultwarden' } } },
    nodeOrder: ['pi2', 'vm103'],
    want: { 'vm103:vaultwarden': 'Vaultwarden', 'pi2:vaultwarden': null },
  },
  {
    name: 'monitor_per_node: its monitor is reserved while the pinned node\'s container is absent',
    candidates: ['pi2:vaultwarden'],
    monitors: [mon(1, 'Vaultwarden')],
    services: { vaultwarden: { monitor_per_node: { vm103: 'Vaultwarden' } } },
    want: { 'pi2:vaultwarden': null },
  },
  // monitor: false
  {
    name: 'monitor: false gives no monitor and no name matching',
    candidates: ['pi1:gateway-tunnel', 'pi1:gateway-npm'],
    monitors: [mon(1, 'Pi Gateway (Ping)')],
    services: { 'gateway-tunnel': { monitor: false } },
    want: { 'pi1:gateway-tunnel': null, 'pi1:gateway-npm': 'Pi Gateway (Ping)' },
  },
  {
    name: 'monitor_per_node false opts one node out; the other keeps monitor',
    candidates: ['pi1:haproxy', 'pi2:haproxy'],
    monitors: [mon(1, 'HAProxy VIP')],
    services: { haproxy: { monitor: 'HAProxy VIP', monitor_per_node: { pi2: false } } },
    want: { 'pi1:haproxy': 'HAProxy VIP', 'pi2:haproxy': null },
  },
  {
    name: 'monitor: null or an empty name is no mapping: name matching',
    candidates: ['vm103:gitea', 'vm103:grafana'],
    monitors: [mon(1, 'Gitea'), mon(2, 'Grafana')],
    services: { gitea: { monitor: null }, grafana: { monitor: '', monitor_per_node: { vm103: '' } } },
    want: { 'vm103:gitea': 'Gitea', 'vm103:grafana': 'Grafana' },
  },
  // Stopped containers (a trailing '!')
  {
    name: 'a stopped container keeps its monitor while the monitor is down',
    candidates: ['vm103:gitea!', 'vm103:gitea-runner'],
    monitors: [mon(1, 'Gitea', 'down')],
    want: { 'vm103:gitea!': 'Gitea', 'vm103:gitea-runner': null },
  },
  {
    name: 'a stopped container releases its monitor once the monitor is up (a rename: nextcloud to nextcloud-app)',
    candidates: ['vm103:nextcloud!', 'vm103:nextcloud-app'],
    monitors: [mon(1, 'Nextcloud', 'up')],
    want: { 'vm103:nextcloud!': null, 'vm103:nextcloud-app': 'Nextcloud' },
  },
  {
    name: 'a stopped container mapped explicitly gets its monitor only while it is down',
    candidates: ['vm103:forge!', 'vm103:db!'],
    monitors: [mon(1, 'Gitea', 'up'), mon(2, 'Postgres', 'down')],
    explicit: { forge: 'Gitea', db: 'Postgres' },
    want: { 'vm103:forge!': null, 'vm103:db!': 'Postgres' },
  },
];

for (const c of PREFERENCES) {
  test(`assignMonitors: ${c.name}`, () => {
    assert.deepEqual(assign(c.candidates, c.monitors, c), c.want);
  });
}

// ── mappingOf ────────────────────────────────────────────────────────────

test('mappingOf: monitor_per_node[node], then monitor, then nothing', () => {
  const services = {
    'gateway-npm': { monitor_per_node: { pi1: 'NPM Pi Primary', pi2: 'NPM Pi Secondary' } },
    dockge: { monitor: 'Dockge', monitor_per_node: { vm101: 'Dockge (Staging)', pi1: false } },
    broken: { monitor: 42, monitor_per_node: ['pi1'] },
  };
  assert.deepEqual(mappingOf(services, 'gateway-npm', 'pi1'), { monitor: 'NPM Pi Primary', setting: 'monitor_per_node.pi1' });
  assert.deepEqual(mappingOf(services, 'gateway-npm', 'pi2'), { monitor: 'NPM Pi Secondary', setting: 'monitor_per_node.pi2' });
  assert.equal(mappingOf(services, 'gateway-npm', 'vm103'), null);
  assert.deepEqual(mappingOf(services, 'dockge', 'vm101'), { monitor: 'Dockge (Staging)', setting: 'monitor_per_node.vm101' });
  assert.deepEqual(mappingOf(services, 'dockge', 'vm103'), { monitor: 'Dockge', setting: 'monitor' });
  assert.deepEqual(mappingOf(services, 'dockge', 'pi1'), { monitor: false, setting: 'monitor_per_node.pi1' });
  assert.equal(mappingOf(services, 'broken', 'pi1'), null, 'wrong types are ignored');
  assert.equal(mappingOf(services, 'toString', 'pi1'), null);
  assert.equal(mappingOf(undefined, 'gitea', 'vm103'), null);
});

test('assignMonitors: with no monitors loaded every container gets none', () => {
  const result = assignMonitors({
    candidates: [{ container: 'gitea', nodeKey: 'vm103' }],
    monitors: {},
    services: { gitea: { monitor: 'Gitea' } },
  });
  assert.deepEqual(result, [null]);
});

test('assignMonitors: accepts an array of monitors as well as the id map', () => {
  const result = assignMonitors({
    candidates: [{ container: 'gitea', nodeKey: 'vm103' }],
    monitors: [mon(1, 'Gitea')],
  });
  assert.equal(result[0].name, 'Gitea');
});

// Every permutation of the containers and of the monitor map's insertion order
// gives the same assignment: the result depends on the names, not the order.
function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

test('assignMonitors: the assignment does not depend on the order of containers or monitors', () => {
  const candidates = ['pi1:gateway-npm', 'pi2:gateway-npm', 'pi1:gateway-tunnel', 'vm103:immich-server', 'vm103:immich-redis'];
  const monitors = [mon(1, 'Pi Gateway (Ping)'), mon(2, 'NPM Gateway Primary'), mon(3, 'Immich'), mon(4, 'Tunnel')];
  const nodeOrder = ['pi1', 'pi2', 'vm103'];
  const want = assign(candidates, monitors, { nodeOrder });
  assert.deepEqual(want, {
    'pi1:gateway-npm': 'NPM Gateway Primary',
    'pi2:gateway-npm': 'Pi Gateway (Ping)',
    'pi1:gateway-tunnel': 'Tunnel',
    'vm103:immich-server': 'Immich',
    'vm103:immich-redis': null,
  });
  for (const cands of permutations(candidates)) {
    for (const mons of [monitors, [...monitors].reverse(), [monitors[2], monitors[0], monitors[3], monitors[1]]]) {
      assert.deepEqual(assign(cands, mons, { nodeOrder, asList: true }), want);
    }
  }
});

// ── overrideOf (#636) ────────────────────────────────────────────────────
test('overrideOf: the node\'s entry, then the container-wide value, then null', async () => {
  const { overrideOf } = await import('./monitors.js');
  const services = {
    npm: { display_name: 'Proxy', display_name_per_node: { pi1: 'Primary', pi3: '', pi4: 7 }, icon_per_node: { pi1: 'a' } },
  };
  assert.equal(overrideOf(services, 'npm', 'pi1', 'display_name'), 'Primary');
  assert.equal(overrideOf(services, 'npm', 'pi2', 'display_name'), 'Proxy');
  assert.equal(overrideOf(services, 'npm', 'pi3', 'display_name'), 'Proxy', 'blank entry falls through');
  assert.equal(overrideOf(services, 'npm', 'pi4', 'display_name'), 'Proxy', 'non-string falls through');
  assert.equal(overrideOf(services, 'npm', 'pi1', 'icon'), 'a');
  assert.equal(overrideOf(services, 'npm', 'pi2', 'icon'), null);
  assert.equal(overrideOf(services, 'other', 'pi1', 'icon'), null);
  assert.equal(overrideOf(undefined, 'npm', 'pi1', 'icon'), null);
  assert.equal(overrideOf({ npm: null }, 'npm', 'pi1', 'icon'), null);
  assert.equal(overrideOf(services, 'npm', null, 'display_name'), 'Proxy');
});

test('overrideOf: whitespace-only values count as not set (#636)', async () => {
  const { overrideOf } = await import('./monitors.js');
  const services = { npm: { display_name: 'Proxy', display_name_per_node: { pi1: '   ' }, icon: ' ' } };
  assert.equal(overrideOf(services, 'npm', 'pi1', 'display_name'), 'Proxy');
  assert.equal(overrideOf(services, 'npm', 'pi1', 'icon'), null);
});
