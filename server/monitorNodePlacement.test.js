/**
 * A monitor no container carries is placed on its own node (#644): the order
 * of the rules in assembleServices (placeMonitor), and the push continuity
 * when a rule moves a monitor to another node (a new uid, #395).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assembleServices } from './refresh.js';
import { parseKumaMetrics } from './kumaMetrics.js';
import { cachesOfAssembled, pushPipeline, snapshotAfter } from './testing/pushPipeline.js';
import { liveCaches, NOW } from './push/fixtures/liveShape.js';

/**
 * One cycle on a home lab. `nodes` is node key -> its config in services.yaml
 * (board order is the order of the keys, minus `off`, the nodes missing from
 * the board this cycle); `seen` is the service registry (monitor id -> node,
 * container).
 */
function cycle({ nodes, monitors, monitorNodes, services = {}, seen = {}, off = [], reverse = false }) {
  const keys = Object.keys(nodes).filter((k) => !off.includes(k));
  const ordered = reverse ? [...keys].reverse() : keys;
  return assembleServices({
    nodeResults: ordered.map((k) => [
      k,
      { display_name: k, ...nodes[k] },
      { metrics: { cpu: '10', memPercent: '20', diskPercent: '30' }, reachable: true, failedReads: [], containers: [] },
    ]),
    monitors: Object.fromEntries(
      (reverse ? [...monitors].reverse() : monitors).map((m) => [
        m.id,
        { ping: 1, uptime24: 1, active: true, lastBeatAt: null, kumaStatus: m.status, ...m },
      ])
    ),
    config: { nodes, services, ...(monitorNodes && { monitor_nodes: monitorNodes }) },
    lastSeenNodeOf: (id) => seen[String(id)]?.nodeKey ?? null,
    lastSeenContainerOf: (id) => seen[String(id)]?.container ?? null,
    containerRegistry: { recordSeen() {}, getMissing: () => [] },
    now: () => NOW,
  });
}

const LAB = {
  vm101: { display_name: 'Staging' },
  vm103: { display_name: 'Production', address: '192.168.68.11' },
  pi2: { address: ['192.168.68.14'] },
  pi1: { prometheus_node: 'pi1' },
};
const placedOf = (r) => Object.fromEntries(Object.entries(r.monitorPlaced).map(([uid, p]) => [p.monitor, `${p.node}/${p.by}`]));

test('the four cAdvisor monitors each land on their own node, not all on the first (#644)', () => {
  const r = cycle({
    nodes: LAB,
    monitors: ['pi1', 'pi2', 'vm101', 'vm103'].map((n, i) => ({ id: i + 1, name: `cadvisor-${n}`, status: 'down' })),
  });
  assert.deepEqual(placedOf(r), {
    'cadvisor-pi1': 'pi1/name',
    'cadvisor-pi2': 'pi2/name',
    'cadvisor-vm101': 'vm101/name',
    'cadvisor-vm103': 'vm103/name',
  });
  for (const n of ['pi1', 'pi2', 'vm101', 'vm103']) {
    assert.deepEqual(r.nodes[n].services.map((s) => s.uid), [`${n}:cadvisor-${n}`]);
  }
});

test('precedence: the setting, then the owner or last-seen node, then the target host, then the name, then the first node', () => {
  const m = (extra = {}) => [{ id: 1, name: 'cadvisor-pi1', status: 'up', targetHost: '192.168.68.14', ...extra }];
  const by = (opts) => placedOf(cycle({ nodes: LAB, monitors: m(), ...opts }))['cadvisor-pi1'];
  assert.equal(by({ monitorNodes: { 'cadvisor-pi1': 'vm103' }, seen: { 1: { nodeKey: 'pi1', container: 'x' } } }), 'vm103/setting');
  assert.equal(by({ seen: { 1: { nodeKey: 'vm103', container: 'x' } } }), 'vm103/last-seen');
  assert.equal(by({}), 'pi2/target', 'the host beats the name');
  assert.equal(placedOf(cycle({ nodes: LAB, monitors: [{ id: 1, name: 'cadvisor-pi1', status: 'up', targetHost: '10.9.9.9' }] }))['cadvisor-pi1'], 'pi1/name');
  assert.equal(placedOf(cycle({ nodes: LAB, monitors: [{ id: 1, name: 'cadvisor', status: 'up' }] })).cadvisor, 'vm101/first');
});

test('a setting naming a node that is not on the board is skipped, and an ambiguous name falls to the first node', () => {
  const one = (name, monitorNodes, off = []) =>
    placedOf(cycle({ nodes: LAB, off, monitorNodes, monitors: [{ id: 1, name, status: 'up' }] }))[name];
  assert.equal(one('cadvisor-pi1', { 'cadvisor-pi1': 'nowhere' }), 'pi1/name');
  assert.equal(one('cadvisor-pi1', { 'cadvisor-pi1': 'vm103' }, ['vm103']), 'pi1/name', 'its node is off the board');
  assert.equal(one('pi1 and pi2 link'), 'vm101/first');
});

test('the same placement whatever order the nodes and the monitors come in', () => {
  const monitors = [
    { id: 1, name: 'cadvisor-pi1', status: 'down' },
    { id: 2, name: 'link pi1 pi2', status: 'down' },
    { id: 3, name: 'NAS', status: 'up', targetHost: '192.168.68.11' },
  ];
  const a = cycle({ nodes: LAB, monitors });
  const b = cycle({ nodes: LAB, monitors, reverse: true });
  assert.deepEqual(placedOf(a).NAS, 'vm103/target');
  assert.deepEqual(placedOf(a)['cadvisor-pi1'], placedOf(b)['cadvisor-pi1']);
  assert.deepEqual(placedOf(a)['link pi1 pi2'], 'vm101/first', 'the first node of the board as given');
  assert.deepEqual(placedOf(b)['link pi1 pi2'], 'pi1/first');
});

test('every monitor no container carries is in monitorPlaced, the up and the pending ones too', () => {
  const r = cycle({
    nodes: LAB,
    monitors: [
      { id: 1, name: 'cadvisor-pi1', status: 'up' },
      { id: 2, name: 'cadvisor-pi2', status: 'unknown', kumaStatus: 'pending' },
      { id: 3, name: 'cadvisor-vm103', status: 'down' },
    ],
  });
  assert.deepEqual(r.monitorPlaced, {
    'pi1:cadvisor-pi1': { monitor: 'cadvisor-pi1', node: 'pi1', by: 'name' },
    'pi2:cadvisor-pi2': { monitor: 'cadvisor-pi2', node: 'pi2', by: 'name' },
    'vm103:cadvisor-vm103': { monitor: 'cadvisor-vm103', node: 'vm103', by: 'name' },
  });
  assert.deepEqual(r.upWithoutCard, ['pi1:cadvisor-pi1']);
});

test('the target host comes from the Kuma metrics labels, with no credentials kept (#644)', () => {
  const text = [
    'monitor_status{monitor_id="1",monitor_name="a",monitor_url="https://u:pw@192.168.68.11:8443/x?token=abc",monitor_hostname="null",monitor_port="null"} 1',
    'monitor_status{monitor_id="2",monitor_name="b",monitor_url="https://",monitor_hostname="192.168.68.14",monitor_port="9100"} 1',
    'monitor_response_time{monitor_id="2",monitor_name="b",monitor_url="https://",monitor_hostname="192.168.68.14"} 5',
    'monitor_status{monitor_id="3",monitor_name="c",monitor_url="https://",monitor_hostname="null"} 1',
  ].join('\n');
  const monitors = parseKumaMetrics(text);
  assert.equal(monitors[1].targetHost, '192.168.68.11');
  assert.equal(monitors[2].targetHost, '192.168.68.14');
  assert.equal('targetHost' in monitors[3], false);
  assert.doesNotMatch(JSON.stringify(monitors), /pw|token|abc|8443/);
});

test('a rename or icon of a monitor no container carries follows it to another node (#644)', () => {
  const mons = [{ id: 1, name: 'cadvisor-pi1', status: 'down' }];
  const cardOf = (services, monitorNodes) =>
    Object.values(cycle({ nodes: LAB, monitors: mons, services, monitorNodes }).nodes)
      .flatMap((n) => n.services)
      .find((x) => x.source === 'monitor');
  const named = { 'cadvisor-pi1': { display_name_per_node: { vm101: 'On Staging' }, icon: 'cadvisor' } };
  assert.equal(cardOf(named, { 'cadvisor-pi1': 'vm101' }).display_name, 'On Staging');
  const moved = cardOf(named, { 'cadvisor-pi1': 'pi2' });
  assert.equal(moved.uid, 'pi2:cadvisor-pi1');
  assert.equal(moved.display_name, 'On Staging', "another node's entry, so a move never loses a rename");
  assert.equal(moved.icon, 'cadvisor', 'container-wide');
  const both = { 'cadvisor-pi1': { display_name_per_node: { vm101: 'A', pi2: 'B' }, display_name: 'C' } };
  assert.equal(cardOf(both, { 'cadvisor-pi1': 'pi2' }).display_name, 'B', 'this node first');
  assert.equal(cardOf(both, { 'cadvisor-pi1': 'pi1' }).display_name, 'B', 'else the first node entry by key');
  assert.equal(cardOf({ 'cadvisor-pi1': { display_name: 'C' } }, undefined).display_name, 'C');
});

test('the status model marks a monitor no container carries, so a custom group can follow it', () => {
  const r = cycle({ nodes: LAB, monitors: [{ id: 1, name: 'cadvisor-pi1', status: 'up' }, { id: 2, name: 'Backups', status: 'down' }] });
  const { status } = snapshotAfter(cachesOfAssembled(r), null);
  const only = status.entities.filter((e) => e.monitorOnly).map((e) => e.id).sort();
  assert.deepEqual(only, ['services/pi1:cadvisor-pi1', 'services/vm101:Backups']);
});

// ---- push continuity: a monitor moved to another node takes a new uid ----

// liveCaches also carries the live fixture's cron jobs: only the services count here.
const serviceSent = (p) => p.sent.filter((e) => e.startsWith('service_'));

function push() {
  const p = pushPipeline();
  return { ...p, run: (r) => p.cycle(liveCaches(r)) };
}

test('an outage that starts before the node is known and recovers after sends one down and one recovery', async () => {
  const p = push();
  try {
    const mon = (status) => [{ id: 7, name: 'cadvisor-pi1', status }];
    // pi1 is not on the board yet: the monitor is on the first node.
    await p.run(cycle({ nodes: LAB, off: ['pi1'], monitors: mon('up') }));
    const down = cycle({ nodes: LAB, off: ['pi1'], monitors: mon('down') });
    assert.deepEqual(Object.keys(down.monitorPlaced), ['vm101:cadvisor-pi1']);
    await p.run(down);
    // pi1 joins the board: the same outage is now on pi1:..., a different uid.
    const moved = cycle({ nodes: LAB, monitors: mon('down') });
    assert.deepEqual(Object.keys(moved.monitorPlaced), ['pi1:cadvisor-pi1']);
    await p.run(moved);
    await p.run(cycle({ nodes: LAB, monitors: mon('down') }));
    await p.run(cycle({ nodes: LAB, monitors: mon('up') }));
    await p.run(cycle({ nodes: LAB, monitors: mon('up') }));
    assert.deepEqual(serviceSent(p), ['service_down vm101:cadvisor-pi1', 'service_recovered pi1:cadvisor-pi1']);
  } finally {
    p.close();
  }
});

test('adding the setting while the monitor is down moves it with no second page; a restart in between changes nothing', async () => {
  const p = push();
  try {
    const mon = (status) => [{ id: 7, name: 'Backups', status }];
    await p.run(cycle({ nodes: LAB, monitors: mon('up') }));
    await p.run(cycle({ nodes: LAB, monitors: mon('down') }));
    await p.restart();
    const set = { Backups: 'pi2' };
    const moved = cycle({ nodes: LAB, monitors: mon('down'), monitorNodes: set });
    assert.deepEqual(Object.keys(moved.monitorPlaced), ['pi2:Backups']);
    await p.run(moved);
    await p.run(cycle({ nodes: LAB, monitors: mon('up'), monitorNodes: set }));
    await p.run(cycle({ nodes: LAB, monitors: mon('up'), monitorNodes: set }));
    assert.deepEqual(serviceSent(p), ['service_down vm101:Backups', 'service_recovered pi2:Backups']);
  } finally {
    p.close();
  }
});
