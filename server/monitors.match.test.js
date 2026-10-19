// Monitor matching (#240): scoreMatch's kinds, and assignMonitors' preference
// order, ties and explicit mappings, as tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'silent';
const { scoreMatch, assignMonitors } = await import('./monitors.js');

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
 * { 'node:container': monitor name or null }. Node order is the order nodes
 * first appear in `candidates` unless given. The monitors go in as the id map
 * fetchMonitors returns, or with `asList` as an array in the given order (an id
 * map lists integer keys in ascending order whatever the insertion order).
 */
function assign(candidates, monitorList, { explicit = {}, home = {}, nodeOrder, asList = false } = {}) {
  const cands = candidates.map((s) => {
    const [nodeKey, container] = s.split(':');
    return { nodeKey, container };
  });
  const result = assignMonitors({
    candidates: cands,
    monitors: asList ? monitorList : Object.fromEntries(monitorList.map((m) => [m.id, m])),
    explicitOf: (name) => explicit[name] ?? null,
    homeNodeOf: (id) => home[id] ?? null,
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
    name: 'same node: one container on two nodes goes to the node the monitor was last matched on',
    candidates: ['pi1:alloy', 'vm103:alloy'],
    monitors: [mon(1, 'Alloy')],
    home: { 1: 'vm103' },
    want: { 'pi1:alloy': null, 'vm103:alloy': 'Alloy' },
  },
  {
    name: 'same node, with no last node: the first node in board order',
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
    name: 'a better match on another node beats the last node (the same node only breaks ties)',
    candidates: ['vm103:gitea-runner', 'vm101:gitea'],
    monitors: [mon(1, 'Gitea')],
    home: { 1: 'vm103' },
    want: { 'vm101:gitea': 'Gitea', 'vm103:gitea-runner': null },
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
    name: 'tie: helpers on the last node lose to a service on another node',
    candidates: ['vm103:nextcloud-db', 'pi1:nextcloud-app'],
    monitors: [mon(1, 'Nextcloud')],
    home: { 1: 'vm103' },
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
];

for (const c of PREFERENCES) {
  test(`assignMonitors: ${c.name}`, () => {
    assert.deepEqual(assign(c.candidates, c.monitors, c), c.want);
  });
}

test('assignMonitors: with no monitors loaded every container gets none', () => {
  const result = assignMonitors({
    candidates: [{ container: 'gitea', nodeKey: 'vm103' }],
    monitors: {},
    explicitOf: () => 'Gitea',
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
