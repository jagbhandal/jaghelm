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
 *
 * Nor is a node Prometheus hasn't scraped yet (#470): a node with no `up`
 * series is looked up in Prometheus's target list (promTargets()), read only
 * on a cycle that has such a node, so the happy path asks nothing more.
 */

import { createLogger } from './util/logger.js';
import { safeFetch } from './httpClient.js';
import { positiveNum } from './util/env.js';
import { NOT_HELPER, NOT_JOB, isHelperSeries, isJobContainer } from './util/helperContainers.js';

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
  // Another Prometheus may list other filesystems, and warn about other things.
  rootFs.clear();
  loggedWarnings.clear();
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
  const data = await promGet(`/api/v1/query?query=${encodeURIComponent(query)}`, 'query');
  const result = data?.data?.result;
  if (data?.status === 'error' || !Array.isArray(result)) {
    throw new PromQueryError(`Prometheus returned no query result${data?.error ? `: ${data.error}` : ''}`);
  }
  if (Array.isArray(data.warnings)) logWarnings(data.warnings, query);
  return result;
}

/**
 * Prometheus's active scrape targets (`GET /api/v1/targets?state=active`, #470),
 * as it lists them: each with its `labels` (after relabelling, the labels its
 * `up` series carries), `health` ("up", "down", or "unknown" before its first
 * scrape) and `lastScrape`. Rejects with a PromQueryError as promQuery() does,
 * naming the targets read. With no Prometheus URL configured, resolves to [].
 */
export async function promTargets() {
  if (!promUrl) return [];
  const data = await promGet('/api/v1/targets?state=active', 'targets read');
  const targets = data?.data?.activeTargets;
  if (data?.status === 'error' || !Array.isArray(targets)) {
    throw new PromQueryError(`Prometheus returned no target list${data?.error ? `: ${data.error}` : ''}`);
  }
  return targets;
}

/**
 * One GET of Prometheus's HTTP API at `path`, the one client every read goes
 * through: the parsed JSON body. Rejects with a PromQueryError when there is
 * none: the request failed or timed out, Prometheus answered non-2xx, or the
 * body is not JSON. `what` names the read in the message; a query's messages
 * are the ones it always had.
 */
async function promGet(path, what) {
  try {
    const r = await safeFetch(`${promUrl}${path}`, { trusted: true, timeoutMs: PROM_TIMEOUT });
    if (!r.ok) {
      throw new PromQueryError(`Prometheus answered HTTP ${r.status}${what === 'query' ? '' : ` to the ${what}`}`);
    }
    return await r.json();
  } catch (err) {
    if (err instanceof PromQueryError) throw err;
    throw new PromQueryError(`Prometheus ${what} failed: ${err?.message || err}`, { cause: err });
  }
}

// The Prometheus warnings logged so far, so each distinct one is logged once.
const loggedWarnings = new Set();
const MAX_LOGGED_WARNINGS = 100;

/**
 * Log each warning Prometheus attaches to an answer, at warn once per distinct
 * text (#234). A warning can mean a partial answer (remote read, or Thanos and
 * Mimir partial responses), in which a node left out reads as "no data"; one
 * query now covers every node. The homelab's single Prometheus sends none.
 * Past MAX_LOGGED_WARNINGS distinct texts, new ones log at debug, so warnings
 * that vary (a count, a time) cannot grow the set without bound.
 */
function logWarnings(warnings, query) {
  for (const w of warnings) {
    const warning = String(w);
    if (loggedWarnings.has(warning)) continue;
    if (loggedWarnings.size >= MAX_LOGGED_WARNINGS) {
      log.debug({ source: 'prometheus', warning, query }, 'Prometheus answered with a warning');
      continue;
    }
    loggedWarnings.add(warning);
    log.warn({ source: 'prometheus', warning, query }, 'Prometheus answered with a warning; its result may be partial');
  }
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
 * wg*, tun*, tap*) and VLAN subinterfaces (eth0.10). cAdvisor already drops
 * lo, veth* and docker*. They carry traffic another interface counts too: a
 * tunnel is encapsulated over the container's eth0, and a VLAN's frames cross
 * its parent. What remains is a container's own eth0, eth1, …
 */
export const VIRTUAL_INTERFACES = 'lo|veth.*|docker.*|br-.*|virbr.*|tailscale.*|wg.*|tun.*|tap.*|.+\\.[0-9]+';

/**
 * The interfaces a container in its own network namespace can have: the eth0,
 * eth1, … Docker gives it, one per network (cAdvisor drops lo), and a tunnel it
 * brings up itself (a VPN client's tun0 or wg0, a tailscale0).
 *
 * A container on the host network has no traffic counters of its own: cAdvisor
 * reports the host's interfaces for it, so every such container on a host
 * would show the host's traffic. It is told apart by an interface outside this
 * list, one only the host's namespace has: a physical interface not named
 * eth<N> (ens18, enp3s0, wlan0), a Docker bridge (br-*; every Compose project
 * creates one), or a VLAN subinterface (eth0.10). In the homelab (2026-10-19)
 * the host-network containers on vm103 report ens18, ens18.10, tailscale0 and
 * 15 br-* bridges, those on pi2 eth0, eth0.10, tailscale0 and 9 bridges, and
 * every other container only eth0 to eth2. Its limit: on a host whose only
 * interfaces are eth<N>, with no VLAN and no Docker network but the default
 * bridge, a host-network container looks like a bridged one.
 */
export const OWN_NAMESPACE_INTERFACES = 'eth[0-9]+|tun.*|tap.*|wg.*|tailscale.*';

const virtualInterface = new RegExp(`^(?:${VIRTUAL_INTERFACES})$`);
const ownNamespaceInterface = new RegExp(`^(?:${OWN_NAMESPACE_INTERFACES})$`);

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
 * - `networkMode`: 'host' for a container on the host network (see
 *   OWN_NAMESPACE_INTERFACES), else null. Such a container has no traffic of
 *   its own to show, so its four RX/TX fields are null.
 *
 * `s.rx`, `s.tx`, `s.rxTotal` and `s.txTotal` are per interface; the others
 * one series per container.
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
    if (isHelperSeries(r) || isJobContainer(r.metric?.name)) continue;
    const name = r.metric?.name;
    if (name && !staleNames.has(name) && !containerMap.has(name)) {
      containerMap.set(name, {
        container: name,
        status: 'running',
        docker: {
          cpu: null,
          memMB: null,
          rxMB: null,
          txMB: null,
          rxBytesPerSec: null,
          txBytesPerSec: null,
          networkMode: null,
        },
      });
    }
  }

  // Fill each container's stats from its matching result set.
  const oneDecimal = (n) => parseFloat(n.toFixed(1));
  const toMiB = (n) => oneDecimal(n / MiB);
  const fill = (results, field, toValue) => {
    for (const r of results) {
      const c = containerMap.get(r.metric?.name);
      if (c && r.value?.[1] != null) c.docker[field] = toValue(parseFloat(r.value[1]));
    }
  };
  fill(s.cpu, 'cpu', oneDecimal);
  fill(s.mem, 'memMB', toMiB);

  // RX/TX: each container's interfaces summed, VIRTUAL_INTERFACES left out; any
  // interface outside OWN_NAMESPACE_INTERFACES puts it on the host network.
  const NET = [
    [s.rx, 'rxBytesPerSec', Math.round],
    [s.tx, 'txBytesPerSec', Math.round],
    [s.rxTotal, 'rxMB', toMiB],
    [s.txTotal, 'txMB', toMiB],
  ];
  const onHost = new Set();
  const sums = NET.map(() => new Map()); // per field: container name → sum
  NET.forEach(([results], i) => {
    for (const r of results) {
      const name = r.metric?.name;
      const iface = r.metric?.interface;
      if (!containerMap.has(name)) continue;
      if (iface && !ownNamespaceInterface.test(iface)) onHost.add(name);
      if ((iface && virtualInterface.test(iface)) || r.value?.[1] == null) continue;
      sums[i].set(name, (sums[i].get(name) ?? 0) + parseFloat(r.value[1]));
    }
  });
  for (const [name, c] of containerMap) {
    if (onHost.has(name)) {
      c.docker.networkMode = 'host';
      continue;
    }
    NET.forEach(([, field, toValue], i) => {
      if (sums[i].has(name)) c.docker[field] = toValue(sums[i].get(name));
    });
  }

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
 *
 * No `up` series is told from Prometheus's own state, not from what this
 * process saw (#470): when the `up` query answered and a node has no `up`
 * series and no CPU, memory or disk reading (so the model would judge it
 * unreachable), Prometheus's target list is read, once for the call
 * (promTargets()). Such a node with a target (the same `node` label) that
 * Prometheus has not scraped yet is unread: every part in `failedReads`, `ok`
 * unchanged, as Prometheus failed at nothing. A node with no target of its own
 * is left as it is. When the targets read fails, each such node is unread, with
 * `ok` false and the targets read's `error`; a node with an `up` series is not
 * touched. A cycle where every node has an `up` series, or metrics, reads no
 * targets.
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
  // Arcane's helpers and CI job containers are no services (helperContainers.js).
  const c = `${n},name!="",${NOT_HELPER},${NOT_JOB}`;
  // Network readings come per interface: buildContainers() needs every
  // interface to tell a host-network container, and sums the others itself.
  const perInterface = (expr) => `sum by (node, name, interface) (${expr})`;
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
    rx: query(perInterface(`rate(container_network_receive_bytes_total{${c}}[5m])`), 'containers'),
    tx: query(perInterface(`rate(container_network_transmit_bytes_total{${c}}[5m])`), 'containers'),
    rxTotal: query(perInterface(`container_network_receive_bytes_total{${c}}`), 'containers'),
    txTotal: query(perInterface(`container_network_transmit_bytes_total{${c}}`), 'containers'),
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
  if (answers[keys.indexOf('up')] !== null) await markUnscraped(out);
  return out;
}

/** Whether a node has a CPU, memory or disk reading: the model reads it as reachable by them. */
function hasUsage(metrics) {
  return ['cpu', 'memPercent', 'diskPercent'].some((f) => Number.isFinite(parseFloat(metrics?.[f])));
}

/** Whether Prometheus has yet to scrape `t`: health "unknown", or no last scrape. */
function notScrapedYet(t) {
  return t?.health === 'unknown' || !(Date.parse(t?.lastScrape) > 0);
}

/**
 * getNodesData's nodes with no `up` series and no usage reading, looked up in
 * Prometheus's target list (#470; see getNodesData). Updates `out` in place.
 */
async function markUnscraped(out) {
  const unsure = [...out].filter(([, d]) => d.reachable === null && !hasUsage(d.metrics));
  if (unsure.length === 0) return;
  let targets;
  try {
    targets = await promTargets();
  } catch (err) {
    for (const [label, d] of unsure) {
      out.set(label, { ...d, ok: false, error: d.error ?? err.message, failedReads: [...NODE_READS] });
    }
    return;
  }
  const pending = new Set(targets.filter(notScrapedYet).map((t) => t?.labels?.node));
  for (const [label, d] of unsure) {
    if (pending.has(label)) out.set(label, { ...d, failedReads: [...NODE_READS] });
  }
}

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}
