// What Settings → Nodes & Services offers for mapping a monitor (#319): per
// running container, the monitor attached now, the one the automatic matcher
// would pick on its own and how it matched, and the monitors with similar names.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'silent';
const { monitorMappingView } = await import('./monitorMapping.js');

const monitor = (id, name) => ({ id, name, status: 'up' });
const MONITORS = {
  1: monitor(1, 'Gitea'),
  2: monitor(2, 'Gitea SSH'),
  3: monitor(3, 'Pi Gateway (Ping)'),
  4: monitor(4, 'Vaultwarden'),
};
const card = (container, extra = {}) => ({ container, source: 'container', ...extra });

test('a container with a same-named monitor is suggested it, matched by name', () => {
  const view = monitorMappingView({
    nodes: { vm103: { services: [card('gitea')] } },
    monitorOf: { 'vm103:gitea': '1' },
    monitors: MONITORS,
  });
  assert.deepEqual(view['vm103:gitea'].attached, 'Gitea');
  assert.equal(view['vm103:gitea'].suggested, 'Gitea');
  assert.equal(view['vm103:gitea'].why, 'exact');
});

test('a container the matcher finds nothing for has no suggestion ("no match") and no attached monitor', () => {
  const view = monitorMappingView({
    nodes: { vm103: { services: [card('loki')] } },
    monitorOf: {},
    monitors: MONITORS,
  });
  assert.deepEqual(view['vm103:loki'], { attached: null, suggested: null, why: null, candidates: [] });
});

test('the attached monitor is the one in force, whatever the matcher would pick', () => {
  // gitea is mapped by hand to "Gitea SSH": that is attached, the suggestion stays Gitea.
  const view = monitorMappingView({
    nodes: { vm103: { services: [card('gitea')] } },
    monitorOf: { 'vm103:gitea': '2' },
    monitors: MONITORS,
  });
  assert.equal(view['vm103:gitea'].attached, 'Gitea SSH');
  assert.equal(view['vm103:gitea'].suggested, 'Gitea');
});

test('candidates are every monitor with a similar name, best match first, each with its kind', () => {
  const view = monitorMappingView({
    nodes: { vm103: { services: [card('gitea')] } },
    monitorOf: {},
    monitors: MONITORS,
  });
  assert.deepEqual(view['vm103:gitea'].candidates, [
    { name: 'Gitea', kind: 'exact' },
    { name: 'Gitea SSH', kind: 'contains' },
  ]);
});

test('the suggestion is the automatic pick, so two containers do not both get one monitor', () => {
  const view = monitorMappingView({
    nodes: { vm103: { services: [card('gitea'), card('gitea-runner')] } },
    monitorOf: {},
    monitors: MONITORS,
  });
  assert.equal(view['vm103:gitea'].suggested, 'Gitea');
  assert.equal(view['vm103:gitea-runner'].suggested, null);
  // The runner still lists Gitea as a similar name, to choose on purpose.
  assert.deepEqual(view['vm103:gitea-runner'].candidates.map((c) => c.name), ['Gitea', 'Gitea SSH']);
});

test('suggestions ignore what is mapped by hand: they are what Auto-match would do', () => {
  const view = monitorMappingView({
    nodes: { pi1: { services: [card('vaultwarden')] }, pi2: { services: [card('vaultwarden')] } },
    monitorOf: { 'pi2:vaultwarden': '4' },
    monitors: MONITORS,
    nodeOrder: ['pi1', 'pi2'],
  });
  assert.equal(view['pi1:vaultwarden'].suggested, 'Vaultwarden'); // first node in order
  assert.equal(view['pi2:vaultwarden'].suggested, null);
  assert.equal(view['pi2:vaultwarden'].attached, 'Vaultwarden');
});

test('only running containers are listed: monitor and presence cards are not', () => {
  const view = monitorMappingView({
    nodes: {
      vm103: {
        services: [card('gitea'), { container: 'Gitea SSH', source: 'monitor' }, { container: 'old', source: 'presence' }],
      },
    },
    monitorOf: {},
    monitors: MONITORS,
  });
  assert.deepEqual(Object.keys(view), ['vm103:gitea']);
});

test('no monitors (Kuma off or down) gives every container nothing to choose from', () => {
  const view = monitorMappingView({
    nodes: { vm103: { services: [card('gitea')] } },
    monitorOf: {},
    monitors: {},
  });
  assert.deepEqual(view['vm103:gitea'], { attached: null, suggested: null, why: null, candidates: [] });
});
