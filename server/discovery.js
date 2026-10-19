/**
 * JagHelm Discovery Engine
 * Discovers nodes and containers from Prometheus + cAdvisor.
 * Returns merged data with config overrides applied.
 *
 * Query budget (#234): getNodesData() reads every node with one query per
 * reading (NODE_QUERIES of them), each matching all the nodes at once
 * (`node=~"a|b|…"`) and split by the `node` label here. The count does not grow
 * with the number of nodes; it used to be 14 queries per node, and 2 more every
 * cycle for a node with no `/` filesystem.
 *
 * A query that fails is never read as "no series" (#232): promQuery() rejects,
 * and getNodesData() reports the failure in each node's result (`ok: false`),
 * so the refresh loop can tell a Prometheus outage from a host that stopped
 * reporting.
 */

import { createLogger } from './util/logger.js';
import { safeFetch } from './httpClient.js';
import { positiveNum } from './util/env.js';
import { NOT_HELPER, isHelperSeries } from './util/helperContainers.js';

const log = createLogger('discovery');

const PROM_TIMEOUT = 8000;

// Seconds after cAdvisor's last `container_last_seen` stamp that we still treat a
// container as running. Prometheus keeps serving a stopped container's series for
// its lookback window (~5m), so metric *presence* is not proof of life — a stale
// stamp is. Must exceed the Prometheus scrape interval (else a slow scrape
// false-flags a live container as stopped) and stay well under the ~5m lookback
// (else a stopped container lingers as a phantom "running" card). Env-overridable.
const CONTAINER_STALE_SEC = positiveNum(process.env.JAGHELM_CONTAINER_STALE_SEC, 90);

const MiB = 1048576;
const GiB = 1073741824;

let promUrl = null;

export function initDiscovery(prometheusUrl) {
  promUrl = prometheusUrl;
  // Another Prometheus may list other filesystems.
  rootFs.clear();
  log.info({ promUrl }, 'Prometheus URL');
}

/** A Prometheus query that produced no result: see promQuery(). */
export class PromQueryError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PromQueryError';
  }
}

/**
 * Run a Prometheus instant query. Resolves to the result array, which is empty
 * when no series match. Rejects with a PromQueryError when there is no result to
 * read: the request failed or timed out, Prometheus answered with a non-2xx
 * status or an error, or the body is not a query result. With no Prometheus URL
 * configured there is nothing to ask, and it resolves to [].
 */
export async function promQuery(query) {
  if (!promUrl) return [];
  let data;
  try {
    const r = await safeFetch(
      `${promUrl}/api/v1/query?query=${encodeURIComponent(query)}`,
      { trusted: true, timeoutMs: PROM_TIMEOUT }
    );
    if (!r.ok) throw new PromQueryError(`Prometheus answered HTTP ${r.status}`);
    data = await r.json();
  } catch (err) {
    if (err instanceof PromQueryError) throw err;
    throw new PromQueryError(`Prometheus query failed: ${err?.message || err}`, { cause: err });
  }
  const result = data?.data?.result;
  if (data?.status === 'error' || !Array.isArray(result)) {
    throw new PromQueryError(`Prometheus returned no query result${data?.error ? `: ${data.error}` : ''}`);
  }
  return result;
}

/**
 * Extract a scalar value from a Prometheus result: the first series whose
 * labels match `matchLabels` (any series when it is empty).
 */
function scalar(results, matchLabels = {}) {
  for (const r of results) {
    const match = Object.entries(matchLabels).every(
      ([k, v]) => r.metric?.[k] === v
    );
    if (match || Object.keys(matchLabels).length === 0) {
      return r.value?.[1] != null ? parseFloat(r.value[1]) : null;
    }
  }
  return null;
}

/**
 * Discover which Prometheus node labels exist.
 * Returns array of node label strings, e.g. ['pi', 'vm103', 'vm101']
 */
export async function discoverNodes() {
  try {
    // Try multiple label patterns — different setups use different labels
    const results = await promQuery('count by (node)(up{node!=""})');
    if (results.length > 0) {
      return results.map(r => r.metric?.node).filter(Boolean);
    }
    // Fallback: try instance labels
    const fallback = await promQuery('count by (instance)(up{job="node"})');
    return fallback.map(r => r.metric?.instance).filter(Boolean);
  } catch (err) {
    log.warn({ err }, 'node discovery could not reach Prometheus; starting with no nodes');
    return [];
  }
}

/**
 * The parts of a node getNodesData reads, each from its own queries: `reachable`
 * (the `up` query), the `cpu`, `mem`, `disk`, `uptime` and `temp` metrics, and
 * the `containers` list. `failedReads` names the ones whose queries failed.
 */
export const NODE_READS = Object.freeze(['containers', 'cpu', 'disk', 'mem', 'reachable', 'temp', 'uptime']);

// ── Query building ──────────────────────────────────────────────────────

/** A PromQL double-quoted string literal holding `s`. */
function promString(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The matcher for series of any of `labels`: node=~"a|b|…" (anchored by Prometheus). */
function nodeMatcher(labels) {
  return `node=~${promString(labels.map(escapeRegex).join('|'))}`;
}

const MEM_METRICS = ['node_memory_MemTotal_bytes', 'node_memory_MemAvailable_bytes', 'node_memory_MemFree_bytes'];
const FS_SIZE = 'node_filesystem_size_bytes';
const FS_FREE = 'node_filesystem_free_bytes';

/**
 * Network interfaces left out of a container's RX/TX: loopback, Docker's own
 * (veth*, docker*, br-* bridges), libvirt's virbr*, VPN tunnels (tailscale*,
 * wg*) and VLAN subinterfaces (eth0.10). cAdvisor already drops lo, veth* and
 * docker*. A container on the host network gets every host interface, and the
 * rest carry traffic the physical interface counts too: bridged container
 * traffic leaves through it, tunnels are encapsulated over it, and a VLAN's
 * frames cross its parent. What remains is eth*, ens* and the like: a bridged
 * container's own interfaces, and the host's physical ones.
 */
export const VIRTUAL_INTERFACES = 'lo|veth.*|docker.*|br-.*|virbr.*|tailscale.*|wg.*|.+\\.[0-9]+';

/**
 * Whether each node has a `/` filesystem, by node label: true reads `/`, false
 * (a NAS) reads its largest filesystem instead (#234). A node is decided from
 * the first answer that lists its filesystems, and after that a node with `/`
 * is asked for `/` alone. An undecided node, or one without `/`, is asked for
 * all of its filesystems, so a node is never asked for a `/` it lacks and then
 * asked again. Keyed by label, so a changed node set needs no invalidation: a
 * new node starts undecided. A node whose `/` stops answering is undecided
 * again, and initDiscovery() forgets every decision.
 */
const rootFs = new Map();

/** The one disk query for `labels`: `/` for the nodes known to have it, every filesystem for the rest. */
function diskQuery(labels) {
  const fs = `__name__=~${promString(`${FS_SIZE}|${FS_FREE}`)}`;
  const withRoot = labels.filter((l) => rootFs.get(l) === true);
  const others = labels.filter((l) => rootFs.get(l) !== true);
  const parts = [];
  if (withRoot.length > 0) parts.push(`{${fs},${nodeMatcher(withRoot)},mountpoint="/",fstype!="tmpfs"}`);
  if (others.length > 0) parts.push(`{${fs},${nodeMatcher(others)},fstype!="tmpfs",fstype!=""}`);
  return parts.join(' or ');
}

/** Record what a disk answer says about each node's `/` (see rootFs). */
function learnRootFs(labels, byNode) {
  for (const label of labels) {
    const series = byNode.get(label) ?? [];
    if (series.length === 0) rootFs.delete(label);
    else if (rootFs.get(label) !== true) rootFs.set(label, series.some((r) => r.metric?.mountpoint === '/'));
  }
}

/** Each node's series of a batched result, in result order. */
function splitByNode(results) {
  const byNode = new Map();
  for (const r of results ?? []) {
    const node = r.metric?.node;
    if (node == null) continue;
    if (!byNode.has(node)) byNode.set(node, []);
    byNode.get(node).push(r);
  }
  return byNode;
}

// ── Node data ───────────────────────────────────────────────────────────

/** Disk size and free bytes: `/` when the node has it, else its largest filesystem. */
function pickDisk(series) {
  if (series.some((r) => r.metric?.__name__ === FS_SIZE && r.metric?.mountpoint === '/')) {
    return {
      diskTotal: scalar(series, { __name__: FS_SIZE, mountpoint: '/' }),
      diskFree: scalar(series, { __name__: FS_FREE, mountpoint: '/' }),
    };
  }
  // No mountpoint="/" (e.g. NAS devices): the largest filesystem by total size.
  let maxSize = 0;
  let bestMount = null;
  for (const r of series) {
    if (r.metric?.__name__ !== FS_SIZE) continue;
    const val = r.value?.[1] != null ? parseFloat(r.value[1]) : 0;
    if (val > maxSize) {
      maxSize = val;
      bestMount = r.metric?.mountpoint;
    }
  }
  if (!bestMount) return { diskTotal: null, diskFree: null };
  return { diskTotal: maxSize, diskFree: scalar(series, { __name__: FS_FREE, mountpoint: bestMount }) };
}

function buildMetrics(s) {
  const cpu = scalar(s.cpu);
  const memTotal = scalar(s.mem, { __name__: 'node_memory_MemTotal_bytes' });
  const memAvail = scalar(s.mem, { __name__: 'node_memory_MemAvailable_bytes' });
  const memFree = scalar(s.mem, { __name__: 'node_memory_MemFree_bytes' });
  const upSec = scalar(s.uptime);
  // The hottest sensor: the query takes the max over the node's hwmon series.
  const temp = scalar(s.temp);
  const { diskTotal, diskFree } = pickDisk(s.disk);

  // Memory breakdown:
  // memUsed     = Total - Available  (real app usage — what the kernel says is "in use")
  // memWithCache = Total - Free      (everything not completely free, including cache/buffers)
  // memCache    = memWithCache - memUsed  (cache/buffers that the OS can reclaim if needed)
  // The bar shows: [solid: memUsed] [striped: memCache] [empty: free]
  const memUsed = memTotal && memAvail ? memTotal - memAvail : null;
  const memWithCache = memTotal && memFree ? memTotal - memFree : null;
  const memCache = memWithCache && memUsed ? Math.max(0, memWithCache - memUsed) : null;
  const diskUsed = diskTotal && diskFree ? diskTotal - diskFree : null;

  // Disk: use TB when total exceeds 1000 GB
  const diskTotalGB = diskTotal ? diskTotal / GiB : null;
  const diskUsedGB = diskUsed ? diskUsed / GiB : null;
  let diskUnit = 'GB';
  let diskTotalDisplay = diskTotalGB ? diskTotalGB.toFixed(1) : null;
  let diskUsedDisplay = diskUsedGB ? diskUsedGB.toFixed(1) : null;
  if (diskTotalGB && diskTotalGB > 1000) {
    diskUnit = 'TB';
    diskTotalDisplay = (diskTotalGB / 1024).toFixed(1);
    diskUsedDisplay = diskUsedGB ? (diskUsedGB / 1024).toFixed(1) : null;
  }

  return {
    cpu: cpu != null ? cpu.toFixed(1) : null,
    memUsedGB: memUsed ? (memUsed / GiB).toFixed(1) : null,
    memTotalGB: memTotal ? (memTotal / GiB).toFixed(1) : null,
    memPercent: memTotal && memUsed ? ((memUsed / memTotal) * 100).toFixed(1) : null,
    memWithCachePercent: memTotal && memWithCache ? ((memWithCache / memTotal) * 100).toFixed(1) : null,
    memCacheGB: memCache ? (memCache / GiB).toFixed(1) : null,
    uptime: upSec ? formatUptime(upSec) : null,
    temp: temp != null ? temp.toFixed(1) : null,
    diskUsed: diskUsedDisplay,
    diskTotal: diskTotalDisplay,
    diskUnit,
    diskPercent: diskTotal && diskUsed ? ((diskUsed / diskTotal) * 100).toFixed(1) : null,
  };
}

/**
 * The node's running containers with their stats. `docker` holds:
 * - `cpu`: percent of one core; `memMB`: the working set (what the kernel
 *   would not reclaim; usage minus inactive page cache), in MiB.
 * - `rxBytesPerSec` / `txBytesPerSec`: network bytes per second over the last
 *   5 minutes, summed over the container's interfaces (VIRTUAL_INTERFACES left
 *   out).
 * - `rxMB` / `txMB`: the cumulative counters, over the same interfaces, in MiB.
 *   Kept for clients that read them until the old endpoints go (overhaul P4-4).
 */
function buildContainers(s) {
  // `container_last_seen` is cAdvisor's freshness stamp (epoch seconds it last saw
  // the container). A stopped container keeps a series in Prometheus for the
  // lookback window (~5m), so its mere presence is NOT "running" — a stale stamp
  // (the query's eval time minus the value exceeds CONTAINER_STALE_SEC) means it
  // has stopped. Collect those names and exclude them, so a stopped container
  // leaves the running set and the down/breadcrumb synthesis surfaces it instead
  // of a phantom green card. (value[0] is Prometheus' own eval timestamp, so the
  // gap is computed on one clock — no JagHelm-vs-Prometheus skew.)
  const staleNames = new Set();
  for (const r of s.seen) {
    const name = r.metric?.name;
    if (!name) continue;
    const evalTs = Number(r.value?.[0]);
    const lastSeen = Number(r.value?.[1]);
    if (Number.isFinite(evalTs) && Number.isFinite(lastSeen) && evalTs - lastSeen > CONTAINER_STALE_SEC) {
      staleNames.add(name);
    }
  }

  const containerMap = new Map();
  const allResults = [...s.seen, ...s.cpu, ...s.mem, ...s.rx, ...s.tx, ...s.rxTotal, ...s.txTotal];
  for (const r of allResults) {
    if (isHelperSeries(r)) continue;
    const name = r.metric?.name;
    if (name && !staleNames.has(name) && !containerMap.has(name)) {
      containerMap.set(name, {
        container: name,
        status: 'running',
        docker: { cpu: null, memMB: null, rxMB: null, txMB: null, rxBytesPerSec: null, txBytesPerSec: null },
      });
    }
  }

  // Fill each container's stats from its matching result set.
  const fill = (results, field, toValue) => {
    for (const r of results) {
      const c = containerMap.get(r.metric?.name);
      if (c && r.value?.[1] != null) c.docker[field] = toValue(parseFloat(r.value[1]));
    }
  };
  const oneDecimal = (n) => parseFloat(n.toFixed(1));
  fill(s.cpu, 'cpu', oneDecimal);
  fill(s.mem, 'memMB', (n) => oneDecimal(n / MiB));
  fill(s.rx, 'rxBytesPerSec', Math.round);
  fill(s.tx, 'txBytesPerSec', Math.round);
  fill(s.rxTotal, 'rxMB', (n) => oneDecimal(n / MiB));
  fill(s.txTotal, 'txMB', (n) => oneDecimal(n / MiB));

  return Array.from(containerMap.values());
}

/** How many instant queries getNodesData() sends per call, whatever the number of nodes. */
export const NODE_QUERIES = 13;

/**
 * Get every node's metrics and containers in one parallel batch: NODE_QUERIES
 * queries, each over all of `nodeLabels` (Prometheus `node` label values).
 *
 * Returns a Map from each label to { ok, error, failedReads, reachable, metrics,
 * containers }:
 * - `ok` is false when any query failed (PromQueryError). A query covers every
 *   node, so a failure is every node's: `ok`, `error` (the first failure's
 *   message, null when ok) and `failedReads` are the same for all of them. The
 *   failed queries read as empty, so `metrics` and `containers` hold what the
 *   others returned.
 * - `failedReads` names the parts those failed queries feed (NODE_READS, sorted;
 *   [] when ok), so one failed metric query is not taken for the whole node.
 * - `reachable` is from Prometheus' own scrape status, `up{node=…}`: true when
 *   any target of the node answered its last scrape, false when none did, null
 *   when Prometheus has no `up` series with that node label (or the query failed).
 *
 * A node missing from an answer that succeeded has no data for that reading,
 * which is not a failure.
 */
export async function getNodesData(nodeLabels) {
  const labels = [...new Set(nodeLabels)];
  const out = new Map();
  if (labels.length === 0) return out;

  const failures = [];
  const failedReads = new Set();
  // `read` is the NODE_READS part the query feeds. A failed query reads as null.
  const query = (q, read) =>
    promQuery(q).catch((err) => {
      failures.push(err);
      failedReads.add(read);
      return null;
    });

  const n = nodeMatcher(labels);
  const c = `${n},name!="",${NOT_HELPER}`;
  const net = `${c},interface!~${promString(VIRTUAL_INTERFACES)}`;
  const queries = {
    // Node metrics
    up: query(`max by (node) (up{${n}})`, 'reachable'),
    cpu: query(`100 - (avg by (node, instance) (irate(node_cpu_seconds_total{${n},mode="idle"}[5m])) * 100)`, 'cpu'),
    mem: query(`{__name__=~${promString(MEM_METRICS.join('|'))},${n}}`, 'mem'),
    uptime: query(`node_time_seconds{${n}} - node_boot_time_seconds{${n}}`, 'uptime'),
    temp: query(`max by (node) (node_hwmon_temp_celsius{${n}})`, 'temp'),
    disk: query(diskQuery(labels), 'disk'),
    // Container stats
    seen: query(`container_last_seen{${c}}`, 'containers'),
    cCpu: query(`rate(container_cpu_usage_seconds_total{${c}}[5m]) * 100`, 'containers'),
    cMem: query(`container_memory_working_set_bytes{${c}}`, 'containers'),
    rx: query(`sum by (node, name) (rate(container_network_receive_bytes_total{${net}}[5m]))`, 'containers'),
    tx: query(`sum by (node, name) (rate(container_network_transmit_bytes_total{${net}}[5m]))`, 'containers'),
    rxTotal: query(`sum by (node, name) (container_network_receive_bytes_total{${net}})`, 'containers'),
    txTotal: query(`sum by (node, name) (container_network_transmit_bytes_total{${net}})`, 'containers'),
  };
  const keys = Object.keys(queries);
  const answers = await Promise.all(Object.values(queries));
  const byNode = Object.fromEntries(keys.map((k, i) => [k, splitByNode(answers[i])]));
  if (answers[keys.indexOf('disk')] !== null) learnRootFs(labels, byNode.disk);

  const ok = failures.length === 0;
  const error = ok ? null : failures[0].message;
  const failed = [...failedReads].sort();
  for (const label of labels) {
    const s = Object.fromEntries(keys.map((k) => [k, byNode[k].get(label) ?? []]));
    const targetUp = scalar(s.up);
    out.set(label, {
      ok,
      error,
      failedReads: [...failed],
      reachable: Number.isFinite(targetUp) ? targetUp > 0 : null,
      metrics: buildMetrics(s),
      containers: buildContainers({
        seen: s.seen,
        cpu: s.cCpu,
        mem: s.cMem,
        rx: s.rx,
        tx: s.tx,
        rxTotal: s.rxTotal,
        txTotal: s.txTotal,
      }),
    });
  }
  return out;
}

/** One node's data: getNodesData() for that node alone. */
export async function getNodeData(nodeLabel) {
  return (await getNodesData([nodeLabel])).get(nodeLabel);
}

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}
