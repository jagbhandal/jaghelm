// What Settings → Nodes & Services offers for mapping a monitor (#319): per
// container, the monitor it carries, the one Auto-match would pick if its own
// mapping were cleared and how it matched, similar monitors, and the monitors
// other mappings hold. All of it is the refresh's matcher, run on the real
// mappings, so the suggestion is never something the server would not do.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'silent';
const { monitorMappingView } = await import('./monitorMapping.js');

const monitor = (id, name, extra = {}) => ({ id, name, status: 'up', lastBeatAt: Date.now(), ...extra });
const MONITORS = {
  1: monitor(1, 'Gitea'),
  2: monitor(2, 'Gitea SSH'),
  3: monitor(3, 'Pi Gateway (Ping)'),
  4: monitor(4, 'Vaultwarden'),
};
const card = (container, extra = {}) => ({ container, source: 'container', ...extra });
const view = (more) => monitorMappingView({ monitors: MONITORS, ...more });

test('a container with a same-named monitor carries it and is suggested it, matched by name', () => {
  const v = view({ nodes: { vm103: { services: [card('gitea')] } } });
  assert.equal(v['vm103:gitea'].attached, 'Gitea');
  assert.equal(v['vm103:gitea'].suggested, 'Gitea');
  assert.equal(v['vm103:gitea'].why, 'exact');
});

test('a container the matcher finds nothing for has no monitor and no suggestion', () => {
  const v = view({ nodes: { vm103: { services: [card('loki')] } } });
  assert.deepEqual(v['vm103:loki'], {
    attached: null,
    paused: false,
    suggested: null,
    why: null,
    candidates: [],
    held: {},
  });
});

test('candidates are every monitor with a similar name, best match first, each with its kind', () => {
  const v = view({ nodes: { vm103: { services: [card('gitea')] } } });
  assert.deepEqual(v['vm103:gitea'].candidates, [
    { name: 'Gitea', kind: 'exact' },
    { name: 'Gitea SSH', kind: 'contains' },
  ]);
});

test('two containers do not both get one monitor: the runner is suggested nothing', () => {
  const v = view({ nodes: { vm103: { services: [card('gitea'), card('gitea-runner')] } } });
  assert.equal(v['vm103:gitea'].suggested, 'Gitea');
  assert.equal(v['vm103:gitea-runner'].suggested, null);
  assert.equal(v['vm103:gitea-runner'].attached, null);
});

// Reviewer scenario (a): vaultwarden on two Pis, pinned to pi2 by hand (#342).
test('a monitor pinned to pi2 is not suggested to pi1: the matcher keeps it for the mapping', () => {
  const v = view({
    nodes: { pi1: { services: [card('vaultwarden')] }, pi2: { services: [card('vaultwarden')] } },
    services: { vaultwarden: { monitor_per_node: { pi2: 'Vaultwarden' } } },
    nodeOrder: ['pi1', 'pi2'],
  });
  assert.equal(v['pi1:vaultwarden'].attached, null);
  assert.equal(v['pi1:vaultwarden'].suggested, null);
  assert.deepEqual(v['pi1:vaultwarden'].held, { Vaultwarden: { container: 'vaultwarden', node: 'pi2' } });
  // pi2 carries it. Cleared, the matcher would give it to pi1 (first in the node
  // order), so pi2 is suggested nothing: Auto-match there means no monitor.
  assert.equal(v['pi2:vaultwarden'].attached, 'Vaultwarden');
  assert.equal(v['pi2:vaultwarden'].suggested, null);
  assert.deepEqual(v['pi2:vaultwarden'].held, {});
});

test('clearing a container-wide mapping on one node leaves it on the others', () => {
  const v = view({
    nodes: { pi1: { services: [card('vaultwarden')] }, pi2: { services: [card('vaultwarden')] } },
    services: { vaultwarden: { monitor: 'Vaultwarden' } },
    nodeOrder: ['pi1', 'pi2'],
  });
  // Both carry it by the one mapping; clearing pi1's leaves pi2's, which keeps the monitor reserved.
  assert.equal(v['pi1:vaultwarden'].attached, 'Vaultwarden');
  assert.equal(v['pi1:vaultwarden'].suggested, null);
  assert.equal(v['pi2:vaultwarden'].suggested, null);
});

// Reviewer scenario (b): gitea hand-mapped to "Gitea SSH".
test('gitea mapped to Gitea SSH: the runner carries Gitea, and gitea’s own suggestion is what is left', () => {
  const v = view({
    nodes: { vm103: { services: [card('gitea'), card('gitea-runner')] } },
    services: { gitea: { monitor: 'Gitea SSH' } },
  });
  assert.equal(v['vm103:gitea'].attached, 'Gitea SSH');
  // Cleared, gitea would take Gitea back: Auto-match's pick, and what the server would do.
  assert.equal(v['vm103:gitea'].suggested, 'Gitea');
  assert.equal(v['vm103:gitea'].why, 'exact');
  // With the mapping, the runner's best match is the unreserved Gitea, and it carries it.
  assert.equal(v['vm103:gitea-runner'].attached, 'Gitea');
  assert.equal(v['vm103:gitea-runner'].suggested, 'Gitea');
  assert.deepEqual(v['vm103:gitea-runner'].held, { 'Gitea SSH': { container: 'gitea', node: 'vm103' } });
});

test('the suggestion is what the matcher does with the mapping cleared, never a monitor another mapping holds', () => {
  const v = view({
    nodes: { vm103: { services: [card('gitea'), card('wiki')] } },
    services: { wiki: { monitor: 'Gitea' } },
  });
  assert.equal(v['vm103:wiki'].attached, 'Gitea');
  // gitea has no mapping: Gitea is held by wiki's, so the matcher gives it the next best, never Gitea.
  assert.equal(v['vm103:gitea'].attached, 'Gitea SSH');
  assert.equal(v['vm103:gitea'].suggested, 'Gitea SSH');
  assert.deepEqual(v['vm103:gitea'].held, { Gitea: { container: 'wiki', node: 'vm103' } });
});

test('false is a mapping too: clearing it gives Auto-match back', () => {
  const v = view({
    nodes: { vm103: { services: [card('gitea')] } },
    services: { gitea: { monitor: false } },
  });
  assert.equal(v['vm103:gitea'].attached, null);
  assert.equal(v['vm103:gitea'].suggested, 'Gitea');
});

test('a stopped container’s presence card competes in the matching, as in the refresh', () => {
  const v = view({
    nodes: { vm103: { services: [card('gitea'), { container: 'gitea-old', source: 'presence' }] } },
    monitors: { 1: monitor(1, 'Gitea', { status: 'down' }) },
  });
  // The monitor is down: the stopped one competes, and gitea still has the best match.
  assert.equal(v['vm103:gitea'].attached, 'Gitea');
  assert.equal(v['vm103:gitea-old'], undefined);
});

test('a paused (stale) monitor is marked paused', () => {
  const v = view({
    nodes: { vm103: { services: [card('gitea')] } },
    monitors: { 1: monitor(1, 'Gitea', { lastBeatAt: Date.now() - 24 * 3600 * 1000 }) },
  });
  assert.equal(v['vm103:gitea'].attached, 'Gitea');
  assert.equal(v['vm103:gitea'].paused, true);
});

test('a monitor’s own red card names its monitor', () => {
  const v = view({
    nodes: { vm103: { services: [{ container: 'Pi Gateway (Ping)', source: 'monitor', uid: 'vm103:Pi Gateway (Ping)' }] } },
    monitorOf: { 'vm103:Pi Gateway (Ping)': '3' },
  });
  assert.equal(v['vm103:Pi Gateway (Ping)'].attached, 'Pi Gateway (Ping)');
});

test('no monitors (Kuma off or down) gives every container nothing to choose from', () => {
  const v = monitorMappingView({ nodes: { vm103: { services: [card('gitea')] } }, monitors: {} });
  assert.equal(v['vm103:gitea'].attached, null);
  assert.deepEqual(v['vm103:gitea'].candidates, []);
});
