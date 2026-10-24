/**
 * Batched node queries (#234). getNodesData() reads every node with one query
 * per reading across all of them, instead of 14 per node (+2 for a node with no
 * `/` filesystem). These tests run it, and the per-node implementation it
 * replaced (testing/legacyNodeData.js), against a mock Prometheus serving series
 * shaped like the homelab's (testing/mockPrometheus.js).
 *
 * Tests share discovery.js's module state; each starts from initDiscovery(),
 * which forgets the root-filesystem decisions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMockPrometheus, homelabSeries, EVAL_TS } from './testing/mockPrometheus.js';
import { legacyGetNodeData } from './testing/legacyNodeData.js';

const { initDiscovery, getNodesData, promQuery, NODE_QUERIES, VIRTUAL_INTERFACES, OWN_NAMESPACE_INTERFACES } = await import(
  './discovery.js'
);

const realFetch = globalThis.fetch;
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

/** The JSON log lines `fn` writes. */
async function captureLogs(fn) {
  const lines = [];
  const orig = { out: process.stdout.write, err: process.stderr.write };
  const tap = (write) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj?.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not a log line
      }
      return write.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(orig.out);
  process.stderr.write = tap(orig.err);
  try {
    await fn();
  } finally {
    process.stdout.write = orig.out;
    process.stderr.write = orig.err;
  }
  return lines;
}

/** A fresh mock Prometheus with `nodes` homelab nodes, wired in. */
function homelab(nodes = 6) {
  const { labels, series } = homelabSeries({ nodes });
  const mock = createMockPrometheus(series);
  initDiscovery(mock.url);
  globalThis.fetch = mock.fetch;
  return { labels, mock };
}

const MiB = 1048576;
const valuesOf = (mock, name, match) =>
  mock.series.filter((s) => s.labels.__name__ === name && Object.entries(match).every(([k, v]) => s.labels[k] === v));

// ── Query budget ─────────────────────────────────────────────────────────

for (const nodes of [6, 12]) {
  test(`budget: ${nodes} nodes take ${NODE_QUERIES} queries per refresh, the first and every later one`, async () => {
    const { labels, mock } = homelab(nodes);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const before = mock.queries.length;
      const data = await getNodesData(labels);
      assert.equal(mock.queries.length - before, NODE_QUERIES, `cycle ${cycle}`);
      assert.ok(NODE_QUERIES <= 14);
      assert.deepEqual([...data.keys()], labels);
    }
    assert.deepEqual(mock.parseErrors, []);
    assert.equal(mock.targetReads, 0, 'every node has an up series: no targets read (#470)');
  });
}

test('budget: the per-node implementation took 14 queries a node, and 2 more for the NAS', async () => {
  const { labels, mock } = homelab(6);
  for (const label of labels) await legacyGetNodeData(promQuery, label);
  assert.equal(mock.queries.length, 14 * 6 + 2);
});

test('a node label is matched literally, whatever characters it has', async () => {
  const { mock } = homelab(1);
  const odd = ['pi.lan', 'a|b', 'x+(y)', 'quo"te\\'];
  // Each has a lookalike an unescaped regex would match instead, or as well.
  const plain = { 'pi.lan': 'pixlan', 'a|b': 'a', 'x+(y)': 'xxy', 'quo"te\\': 'quote' };
  for (const label of odd) {
    for (const node of [label, plain[label]]) {
      mock.series.push({ labels: { __name__: 'up', node, instance: `${node}:9100`, job: 'x' }, value: node === label ? 1 : 0 });
    }
  }
  const data = await getNodesData(odd);
  assert.deepEqual(mock.parseErrors, []);
  for (const label of odd) assert.equal(data.get(label).reachable, true, label);
});

// ── The same values as before, but for the three corrected ones ──────────

// The fields #234 corrects (temperature, container memory, RX/TX), and the new
// rate and network-mode fields, which the old implementation did not have.
function withoutCorrected(nodeData) {
  const copy = structuredClone(nodeData);
  // Since #605 the batch also keeps the failure's cause beside its error.
  delete copy.failure;
  delete copy.metrics.temp;
  for (const c of copy.containers) {
    for (const f of ['memMB', 'rxMB', 'txMB', 'rxBytesPerSec', 'txBytesPerSec', 'networkMode']) delete c.docker[f];
  }
  return copy;
}

for (const nodes of [6, 12]) {
  test(`equivalence (${nodes} nodes): batched results equal the old per-node ones but for temp, memory and RX/TX, the first cycle and the steady one`, async () => {
    const { labels, mock } = homelab(nodes);
    // The first cycle lists every node's filesystems; from the second on, the
    // nodes with `/` are asked for `/` alone (the query production runs).
    for (const pass of ['first', 'steady']) {
      const before = mock.queries.length;
      const batched = await getNodesData(labels);
      const disk = mock.queries.slice(before).filter((q) => q.includes('node_filesystem_size_bytes'));
      assert.equal(disk.length, 1, pass);
      assert.equal(disk[0].includes(' or '), pass === 'steady', `${pass}: ${disk[0]}`);

      const differs = { temp: 0, memMB: 0, rxMB: 0 };
      for (const label of labels) {
        const old = await legacyGetNodeData(promQuery, label);
        const now = batched.get(label);
        assert.deepEqual(withoutCorrected(now), withoutCorrected(old), `${pass} ${label}`);

        // The mock exercises what the three corrections fix.
        if (now.metrics.temp !== old.metrics.temp) differs.temp += 1;
        now.containers.forEach((c, i) => {
          if (c.docker.memMB !== old.containers[i].docker.memMB) differs.memMB += 1;
          if (c.docker.rxMB !== old.containers[i].docker.rxMB) differs.rxMB += 1;
        });
        // and they read real data: every node has its metrics, a pi or vm its containers.
        for (const field of ['cpu', 'memPercent', 'diskUsed', 'diskTotal', 'diskPercent', 'uptime']) {
          assert.ok(now.metrics[field] != null, `${pass} ${label} ${field}`);
        }
        if (/^(pi|vm)/.test(label)) assert.ok(now.containers.length >= 3, label);
        assert.equal(now.reachable, true);
      }
      assert.ok(differs.temp > 0 && differs.memMB > 0 && differs.rxMB > 0, `${pass}: ${JSON.stringify(differs)}`);
    }
  });
}

// ── The corrected readings ──────────────────────────────────────────────

test('temperature is the hottest sensor of the node, not whichever series came first', async () => {
  const { labels, mock } = homelab(6);
  const data = await getNodesData(labels);
  for (const label of labels) {
    const temps = valuesOf(mock, 'node_hwmon_temp_celsius', { node: label }).map((s) => s.value);
    const expected = temps.length ? Math.max(...temps).toFixed(1) : null;
    assert.equal(data.get(label).metrics.temp, expected, label);
  }
  assert.equal(data.get('pve1').metrics.temp, '43.0', 'the NIC at 38 + 5, not the first chip at 31');
  assert.equal(data.get('vm1').metrics.temp, null, 'a VM has no sensors');
  assert.ok(mock.queries.includes('max by (node) (node_hwmon_temp_celsius{node=~"pi1|pi2|vm1|vm2|nas1|pve1"})'));
});

test('container memory is the working set, not usage with its page cache', async () => {
  const { labels, mock } = homelab(6);
  const data = await getNodesData(labels);
  const grafana = data.get('vm1').containers.find((c) => c.container === 'grafana');
  const [ws] = valuesOf(mock, 'container_memory_working_set_bytes', { node: 'vm1', name: 'grafana' });
  const [usage] = valuesOf(mock, 'container_memory_usage_bytes', { node: 'vm1', name: 'grafana' });
  assert.equal(grafana.docker.memMB, parseFloat((ws.value / MiB).toFixed(1)));
  assert.ok(usage.value > ws.value);
  assert.ok(mock.queries.some((q) => q.startsWith('container_memory_working_set_bytes{')));
  assert.ok(!mock.queries.some((q) => q.includes('container_memory_usage_bytes')));
});

const sum = (series, f) => series.reduce((acc, s) => acc + f(s), 0);
const NET_FIELDS = ['rxBytesPerSec', 'txBytesPerSec', 'rxMB', 'txMB'];
const HOST_NETWORK = [
  ['vm1', 'jaghelm'],
  ['vm2', 'jaghelm'],
  ['pi1', 'tailscale'],
  ['pi2', 'tailscale'],
];

test('RX/TX: a rate summed over the container\'s own interfaces, and the old counter fields over the same ones', async () => {
  const { labels, mock } = homelab(6);
  const data = await getNodesData(labels);

  for (const [node, name, interfaces] of [
    ['vm1', 'grafana', ['eth0', 'eth1', 'eth2']], // on three Docker networks: all three count
    ['vm1', 'gitea', ['eth0']],
    ['pi1', 'adguard', ['eth0']],
  ]) {
    const c = data.get(node).containers.find((x) => x.container === name);
    const rx = valuesOf(mock, 'container_network_receive_bytes_total', { node, name });
    const tx = valuesOf(mock, 'container_network_transmit_bytes_total', { node, name });
    assert.deepEqual(rx.map((s) => s.labels.interface), interfaces, `${node} ${name}`);
    assert.equal(c.docker.networkMode, null, `${name} has its own namespace`);
    assert.equal(c.docker.rxBytesPerSec, Math.round(sum(rx, (s) => s.rate)), `${name} rx rate`);
    assert.equal(c.docker.txBytesPerSec, Math.round(sum(tx, (s) => s.rate)), `${name} tx rate`);
    // The old fields keep their meaning (a cumulative counter, in MiB) until P4-4.
    assert.equal(c.docker.rxMB, parseFloat((sum(rx, (s) => s.value) / MiB).toFixed(1)), `${name} rxMB`);
    assert.equal(c.docker.txMB, parseFloat((sum(tx, (s) => s.value) / MiB).toFixed(1)), `${name} txMB`);
  }
  assert.ok(mock.queries.includes(
    'sum by (node, name, interface) (rate(container_network_receive_bytes_total{node=~"pi1|pi2|vm1|vm2|nas1|pve1",name!="",container_label_com_getarcaneapp_internal_resource!="true",name!~"(GITEA-ACTIONS-TASK-|handbook-build-).+"}[5m]))'
  ));
});

test('a container on the host network has no RX/TX of its own: all four fields null, networkMode host', async () => {
  const { labels, mock } = homelab(6);
  const data = await getNodesData(labels);
  for (const [node, name] of HOST_NETWORK) {
    const c = data.get(node).containers.find((x) => x.container === name);
    // cAdvisor reports the host's interfaces for it: the physical one (eth0 on a
    // Pi, ens18 on a VM), a VLAN, tailscale0 and the Docker bridges.
    const ifaces = valuesOf(mock, 'container_network_receive_bytes_total', { node, name }).map((s) => s.labels.interface);
    assert.ok(ifaces.some((i) => i.startsWith('br-')), `${node} ${name}: ${ifaces}`);
    assert.equal(c.docker.networkMode, 'host', `${node} ${name}`);
    for (const f of NET_FIELDS) assert.equal(c.docker[f], null, `${node} ${name} ${f}`);
    assert.ok(c.docker.cpu != null && c.docker.memMB != null, 'its other stats are read');
  }
  // Every other container has its own namespace.
  for (const label of labels) {
    for (const c of data.get(label).containers) {
      if (HOST_NETWORK.some(([n, name]) => n === label && name === c.container)) continue;
      assert.equal(c.docker.networkMode, null, `${label} ${c.container}`);
      assert.ok(c.docker.rxBytesPerSec != null && c.docker.rxMB != null, `${label} ${c.container}`);
    }
  }
});

test('a container with a tunnel of its own is not on the host network, and its tunnel is not counted', async () => {
  const { labels, mock } = homelab(6);
  const vpn = { __name__: 'container_network_receive_bytes_total', node: 'vm1', instance: 'vm1:8080', job: 'cadvisor-vm1', name: 'vpn', id: '/system.slice/docker-vpn.scope', image: 'example/vpn:latest' };
  mock.series.push(
    { labels: { ...vpn, __name__: 'container_last_seen' }, value: EVAL_TS },
    { labels: { ...vpn, interface: 'eth0' }, value: 5 * MiB, rate: 300 },
    { labels: { ...vpn, interface: 'tun0' }, value: 4 * MiB, rate: 250 },
    { labels: { ...vpn, interface: 'wg0' }, value: 3 * MiB, rate: 200 }
  );
  const c = (await getNodesData(labels)).get('vm1').containers.find((x) => x.container === 'vpn');
  assert.equal(c.docker.networkMode, null);
  assert.equal(c.docker.rxBytesPerSec, 300, 'eth0 alone: the tunnels are carried over it');
  assert.equal(c.docker.rxMB, 5);
});

test('the interfaces left out of RX/TX, against the names in the homelab', () => {
  const virtual = new RegExp(`^(?:${VIRTUAL_INTERFACES})$`);
  // Every interface cAdvisor reports there (2026-10-19), plus what it drops itself.
  for (const name of ['br-0595e3e371ec', 'br-15956eedb25f', 'eth0.10', 'ens18.10', 'tailscale0', 'lo', 'veth1a2b3c', 'docker0', 'virbr0', 'wg0', 'tun0']) {
    assert.ok(virtual.test(name), `${name} is left out`);
  }
  for (const name of ['eth0', 'eth1', 'eth2', 'ens18', 'enp3s0', 'eno1', 'wlan0']) {
    assert.ok(!virtual.test(name), `${name} counts`);
  }
});

test('the host network, told by an interface only the host has, against the names in the homelab', () => {
  const own = new RegExp(`^(?:${OWN_NAMESPACE_INTERFACES})$`);
  // What a container in its own namespace reports there (2026-10-19: eth0 to
  // eth2), and a tunnel a container can bring up itself.
  for (const name of ['eth0', 'eth1', 'eth2', 'tun0', 'wg0', 'tailscale0']) assert.ok(own.test(name), `${name} can be a container's`);
  // The host's alone: a physical interface not named eth<N>, a Docker bridge, a VLAN.
  for (const name of ['ens18', 'ens18.10', 'eth0.10', 'br-0595e3e371ec', 'br-15956eedb25f', 'enp3s0', 'eno1', 'wlan0', 'virbr0']) {
    assert.ok(!own.test(name), `${name} is the host's`);
  }
});

test('a Prometheus warning is logged at warn once, however often it comes back', async () => {
  const { labels, mock } = homelab(6);
  mock.warnings = (q) => (q.includes('node_hwmon_temp_celsius') ? ['partial response: store b down', 'another'] : ['partial response: store a down']);
  const lines = await captureLogs(async () => {
    await getNodesData(labels);
    await getNodesData(labels);
  });
  const warned = lines.filter((l) => l.level === 'warn' && l.source === 'prometheus');
  assert.deepEqual(warned.map((l) => l.warning).sort(), ['another', 'partial response: store a down', 'partial response: store b down']);
  assert.ok(warned.every((l) => typeof l.query === 'string'));
  const data = await getNodesData(labels);
  assert.equal(data.get('pi1').ok, true, 'an answer with warnings is still an answer');
});

// ── The NAS's missing `/`, decided once ──────────────────────────────────

const diskQueries = (mock) => mock.queries.filter((q) => q.includes('node_filesystem_size_bytes'));

test('the NAS is never asked for a / it lacks: decided from the first answer, then kept', async () => {
  const { labels, mock } = homelab(6);
  const disk = [];
  for (let cycle = 0; cycle < 4; cycle += 1) {
    const data = await getNodesData(labels);
    disk.push(...diskQueries(mock).slice(disk.length));
    assert.equal(data.get('nas1').metrics.diskTotal, '7.2', 'the largest filesystem, /volume1');
    assert.equal(data.get('nas1').metrics.diskUnit, 'TB');
    assert.equal(data.get('vm1').metrics.diskTotal, '98.0', '/, not the larger NFS mount');
  }
  assert.equal(disk.length, 4, 'one disk query a cycle');
  // The first lists every node's filesystems; after it, the nodes with / are
  // asked for / alone and only the NAS for its filesystems.
  assert.ok(!disk[0].includes('mountpoint="/"'));
  assert.ok(disk[0].includes('node=~"pi1|pi2|vm1|vm2|nas1|pve1",fstype!="tmpfs",fstype!=""'));
  for (const q of disk.slice(1)) {
    assert.equal(
      q,
      '{__name__=~"node_filesystem_size_bytes|node_filesystem_free_bytes",node=~"pi1|pi2|vm1|vm2|pve1",mountpoint="/",fstype!="tmpfs"}' +
        ' or {__name__=~"node_filesystem_size_bytes|node_filesystem_free_bytes",node=~"nas1",fstype!="tmpfs",fstype!=""}'
    );
  }
});

test('the root filesystem decisions: a new node starts undecided, a / that stops answering is re-decided', async () => {
  const { labels, mock } = homelab(6);
  await getNodesData(labels);
  await getNodesData(labels);

  // A node added to the config: the others keep their decision.
  await getNodesData([...labels, 'elsewhere']);
  const added = diskQueries(mock).at(-1);
  assert.ok(added.includes('node=~"pi1|pi2|vm1|vm2|pve1",mountpoint="/"'));
  assert.ok(added.includes('node=~"nas1|elsewhere",fstype!="tmpfs",fstype!=""'));

  // pi1's / stops answering (here: its series are gone): it is undecided, and
  // listed in full next time, which finds / back.
  const removed = mock.series.filter((s) => s.labels.node === 'pi1' && s.labels.mountpoint === '/');
  mock.series = mock.series.filter((s) => !removed.includes(s));
  const gone = await getNodesData(labels);
  assert.equal(gone.get('pi1').metrics.diskTotal, null);
  assert.equal(gone.get('pi1').ok, true, 'no data is not a failure');
  mock.series.push(...removed);
  await getNodesData(labels);
  assert.ok(diskQueries(mock).at(-1).includes('node=~"pi1|nas1",fstype!="tmpfs",fstype!=""'));
  const back = await getNodesData(labels);
  assert.ok(diskQueries(mock).at(-1).includes('node=~"pi1|pi2|vm1|vm2|pve1",mountpoint="/"'));
  assert.equal(back.get('pi1').metrics.diskTotal, '58.0');
});

test('a failed disk query decides nothing', async () => {
  const { labels, mock } = homelab(6);
  mock.fail = (q) => q.includes('node_filesystem_size_bytes');
  const failed = await getNodesData(labels);
  assert.deepEqual(failed.get('pi1').failedReads, ['disk']);
  mock.fail = null;
  await getNodesData(labels);
  assert.ok(!diskQueries(mock).at(-1).includes('mountpoint="/"'), 'still undecided after the failure: every node listed');
});

// ── #232's failure rules, batched ───────────────────────────────────────

test('the up query failing holds every node\'s reachability, and nothing else', async () => {
  const { labels, mock } = homelab(6);
  mock.fail = (q) => q.startsWith('max by (node) (up{');
  const data = await getNodesData(labels);
  for (const label of labels) {
    const d = data.get(label);
    assert.equal(d.ok, false);
    assert.match(d.error, /HTTP 500/);
    assert.deepEqual(d.failedReads, ['reachable'], label);
    assert.equal(d.reachable, null);
    assert.ok(d.metrics.cpu != null, 'the other readings are kept');
  }
});

test('a metric query failing is that metric\'s failure on every node', async () => {
  for (const [match, reads] of [
    ['node_hwmon_temp_celsius', ['temp']],
    ['node_memory_MemAvailable_bytes', ['mem']],
    ['node_boot_time_seconds', ['uptime']],
    ['rate(container_network_transmit_bytes_total', ['containers']],
  ]) {
    const { labels, mock } = homelab(6);
    mock.fail = (q) => q.includes(match);
    const data = await getNodesData(labels);
    for (const label of labels) {
      assert.deepEqual(data.get(label).failedReads, reads, `${match} on ${label}`);
      assert.equal(data.get(label).reachable, true);
    }
  }
});

test('a node missing from an answer that succeeded has no data, which is not a failure', async () => {
  const { labels, mock } = homelab(6);
  const data = await getNodesData([...labels, 'ghost']);
  const ghost = data.get('ghost');
  assert.equal(mock.targetReads, 1, 'no up series and no metric: the target list is read, once (#470)');
  assert.equal(ghost.ok, true, 'Prometheus has no target for it');
  assert.deepEqual(ghost.failedReads, []);
  assert.equal(ghost.reachable, null);
  assert.equal(ghost.metrics.cpu, null);
  assert.deepEqual(ghost.containers, []);
  assert.equal(data.get('pi1').ok, true);
});

test('a node listed twice is asked for once', async () => {
  const { mock } = homelab(6);
  const data = await getNodesData(['pi1', 'pi1', 'nas1']);
  assert.equal(mock.queries.length, NODE_QUERIES);
  assert.ok(mock.queries[0].includes('node=~"pi1|nas1"'));
  assert.deepEqual([...data.keys()], ['pi1', 'nas1']);
});

test('no nodes, no queries', async () => {
  const { mock } = homelab(6);
  assert.equal((await getNodesData([])).size, 0);
  assert.equal(mock.queries.length, 0);
});

test('the mock answers like Prometheus: last-seen stamps carry its evaluation time', async () => {
  const { mock } = homelab(1);
  const [r] = await promQuery('container_last_seen{node="pi1",name="adguard"}');
  assert.equal(r.value[0], EVAL_TS);
  assert.deepEqual(mock.parseErrors, []);
});
