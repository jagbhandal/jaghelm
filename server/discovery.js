/**
 * JagHelm Discovery Engine
 * Discovers nodes and containers from Prometheus + cAdvisor.
 * Returns merged data with config overrides applied.
 * 
 * Performance: getNodeData() fires all node metrics + container queries
 * in a single Promise.all (14 queries) instead of two sequential batches.
 *
 * A query that fails is never read as "no series" (#232): promQuery() rejects,
 * and getNodeData() reports the failure in its result (`ok: false`), so the
 * refresh loop can tell a Prometheus outage from a host that stopped reporting.
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

let promUrl = null;

export function initDiscovery(prometheusUrl) {
  promUrl = prometheusUrl;
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
 * Extract a scalar value from a Prometheus result.
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
 * The parts of a node getNodeData reads, each from its own queries: `reachable`
 * (the `up` query), the `cpu`, `mem`, `disk`, `uptime` and `temp` metrics, and
 * the `containers` list. `failedReads` names the ones whose queries failed.
 */
export const NODE_READS = Object.freeze(['containers', 'cpu', 'disk', 'mem', 'reachable', 'temp', 'uptime']);

/**
 * Get node metrics AND container data in a single parallel batch.
 * Fires all 14 Prometheus queries simultaneously instead of two sequential batches.
 *
 * Returns { ok, error, failedReads, reachable, metrics, containers }:
 * - `ok` is false when any query failed (PromQueryError). The failed queries
 *   read as empty, so `metrics` and `containers` hold what the others returned,
 *   and `error` is the first failure's message (null when ok).
 * - `failedReads` names the parts those failed queries feed (NODE_READS, sorted;
 *   [] when ok), so one failed metric query is not taken for the whole node.
 * - `reachable` is from Prometheus' own scrape status, `up{node=…}`: true when
 *   any target of the node answered its last scrape, false when none did, null
 *   when Prometheus has no `up` series with that node label (or the query failed).
 */
export async function getNodeData(nodeLabel) {
  const l = `node="${nodeLabel}"`;
  const failures = [];
  const failedReads = new Set();
  // `read` is the NODE_READS part the query feeds.
  const query = (q, read) =>
    promQuery(q).catch((err) => {
      failures.push(err);
      failedReads.add(read);
      return [];
    });

  // Fire ALL queries in one Promise.all — node metrics (9) + container stats (5) = 14 parallel
  const [
    // Node metrics
    targetUpR, cpuR, memTR, memAR, memFreeR, upR, tempR, diskTR, diskFR,
    // Container stats
    namesR, cCpuR, cMemR, cRxR, cTxR,
  ] = await Promise.all([
    // Node metrics queries
    query(`max(up{${l}})`, 'reachable'),
    query(`100 - (avg by(instance)(irate(node_cpu_seconds_total{${l},mode="idle"}[5m])) * 100)`, 'cpu'),
    query(`node_memory_MemTotal_bytes{${l}}`, 'mem'),
    query(`node_memory_MemAvailable_bytes{${l}}`, 'mem'),
    query(`node_memory_MemFree_bytes{${l}}`, 'mem'),
    query(`node_time_seconds{${l}} - node_boot_time_seconds{${l}}`, 'uptime'),
    query(`node_hwmon_temp_celsius{${l}}`, 'temp'),
    query(`node_filesystem_size_bytes{${l},mountpoint="/",fstype!="tmpfs"}`, 'disk'),
    query(`node_filesystem_free_bytes{${l},mountpoint="/",fstype!="tmpfs"}`, 'disk'),
    // Container stats queries
    query(`container_last_seen{${l},name!="",${NOT_HELPER}}`, 'containers'),
    query(`rate(container_cpu_usage_seconds_total{${l},name!="",${NOT_HELPER}}[5m]) * 100`, 'containers'),
    query(`container_memory_usage_bytes{${l},name!="",${NOT_HELPER}}`, 'containers'),
    query(`container_network_receive_bytes_total{${l},name!="",${NOT_HELPER}}`, 'containers'),
    query(`container_network_transmit_bytes_total{${l},name!="",${NOT_HELPER}}`, 'containers'),
  ]);

  // ── Build node metrics ──
  const targetUp = scalar(targetUpR);
  const reachable = Number.isFinite(targetUp) ? targetUp > 0 : null;
  const cpu = scalar(cpuR);
  const memTotal = scalar(memTR);
  const memAvail = scalar(memAR);
  const memFree = scalar(memFreeR);
  const upSec = scalar(upR);
  const temp = scalar(tempR);
  let diskTotal = scalar(diskTR);
  let diskFree = scalar(diskFR);

  // Fallback: if no mountpoint="/" data (e.g. NAS devices), find the largest filesystem
  if (diskTotal == null) {
    const [allDiskT, allDiskF] = await Promise.all([
      query(`node_filesystem_size_bytes{${l},fstype!="tmpfs",fstype!=""}`, 'disk'),
      query(`node_filesystem_free_bytes{${l},fstype!="tmpfs",fstype!=""}`, 'disk'),
    ]);
    // Pick the largest filesystem by total size
    let maxSize = 0;
    let bestMount = null;
    for (const r of allDiskT) {
      const val = r.value?.[1] != null ? parseFloat(r.value[1]) : 0;
      if (val > maxSize) {
        maxSize = val;
        bestMount = r.metric?.mountpoint;
      }
    }
    if (bestMount) {
      diskTotal = maxSize;
      // Find matching free bytes for the same mountpoint
      for (const r of allDiskF) {
        if (r.metric?.mountpoint === bestMount) {
          diskFree = r.value?.[1] != null ? parseFloat(r.value[1]) : null;
          break;
        }
      }
    }
  }

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
  const diskTotalGB = diskTotal ? diskTotal / 1073741824 : null;
  const diskUsedGB = diskUsed ? diskUsed / 1073741824 : null;
  let diskUnit = 'GB';
  let diskTotalDisplay = diskTotalGB ? diskTotalGB.toFixed(1) : null;
  let diskUsedDisplay = diskUsedGB ? diskUsedGB.toFixed(1) : null;
  if (diskTotalGB && diskTotalGB > 1000) {
    diskUnit = 'TB';
    diskTotalDisplay = (diskTotalGB / 1024).toFixed(1);
    diskUsedDisplay = diskUsedGB ? (diskUsedGB / 1024).toFixed(1) : null;
  }

  const metrics = {
    cpu: cpu != null ? cpu.toFixed(1) : null,
    memUsedGB: memUsed ? (memUsed / 1073741824).toFixed(1) : null,
    memTotalGB: memTotal ? (memTotal / 1073741824).toFixed(1) : null,
    memPercent: memTotal && memUsed ? ((memUsed / memTotal) * 100).toFixed(1) : null,
    memWithCachePercent: memTotal && memWithCache ? ((memWithCache / memTotal) * 100).toFixed(1) : null,
    memCacheGB: memCache ? (memCache / 1073741824).toFixed(1) : null,
    uptime: upSec ? formatUptime(upSec) : null,
    temp: temp != null ? temp.toFixed(1) : null,
    diskUsed: diskUsedDisplay,
    diskTotal: diskTotalDisplay,
    diskUnit,
    diskPercent: diskTotal && diskUsed ? ((diskUsed / diskTotal) * 100).toFixed(1) : null,
  };

  // ── Build container list ──
  // `container_last_seen` is cAdvisor's freshness stamp (epoch seconds it last saw
  // the container). A stopped container keeps a series in Prometheus for the
  // lookback window (~5m), so its mere presence is NOT "running" — a stale stamp
  // (the query's eval time minus the value exceeds CONTAINER_STALE_SEC) means it
  // has stopped. Collect those names and exclude them, so a stopped container
  // leaves the running set and the down/breadcrumb synthesis surfaces it instead
  // of a phantom green card. (value[0] is Prometheus' own eval timestamp, so the
  // gap is computed on one clock — no JagHelm-vs-Prometheus skew.)
  const staleNames = new Set();
  for (const r of namesR) {
    const name = r.metric?.name;
    if (!name) continue;
    const evalTs = Number(r.value?.[0]);
    const lastSeen = Number(r.value?.[1]);
    if (Number.isFinite(evalTs) && Number.isFinite(lastSeen) && evalTs - lastSeen > CONTAINER_STALE_SEC) {
      staleNames.add(name);
    }
  }

  const containerMap = new Map();
  const allResults = [...namesR, ...cCpuR, ...cMemR, ...cRxR, ...cTxR];
  for (const r of allResults) {
    if (isHelperSeries(r)) continue;
    const name = r.metric?.name;
    if (name && !staleNames.has(name) && !containerMap.has(name)) {
      containerMap.set(name, {
        container: name,
        status: 'running',
        docker: { cpu: null, memMB: null, rxMB: null, txMB: null },
      });
    }
  }

  // Fill each container's CPU / MEM / RX / TX from its matching result set.
  for (const r of cCpuR) {
    const name = r.metric?.name;
    const c = containerMap.get(name);
    if (c && r.value?.[1] != null) c.docker.cpu = parseFloat(parseFloat(r.value[1]).toFixed(1));
  }
  for (const r of cMemR) {
    const name = r.metric?.name;
    const c = containerMap.get(name);
    if (c && r.value?.[1] != null) c.docker.memMB = parseFloat((parseFloat(r.value[1]) / 1048576).toFixed(1));
  }
  for (const r of cRxR) {
    const name = r.metric?.name;
    const c = containerMap.get(name);
    if (c && r.value?.[1] != null) c.docker.rxMB = parseFloat((parseFloat(r.value[1]) / 1048576).toFixed(1));
  }
  for (const r of cTxR) {
    const name = r.metric?.name;
    const c = containerMap.get(name);
    if (c && r.value?.[1] != null) c.docker.txMB = parseFloat((parseFloat(r.value[1]) / 1048576).toFixed(1));
  }

  const containers = Array.from(containerMap.values());

  const ok = failures.length === 0;
  return {
    ok,
    error: ok ? null : failures[0].message,
    failedReads: [...failedReads].sort(),
    reachable,
    metrics,
    containers,
  };
}

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}
