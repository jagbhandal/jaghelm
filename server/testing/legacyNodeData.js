/**
 * The per-node getNodeData() as it was before #234 (main @ 98678f0), kept
 * verbatim but for its name and `promQuery` passed in, so a test can check
 * that the batched getNodesData() reads the same values from the same
 * Prometheus, except the three readings #234 corrects (temperature, container
 * memory, container RX/TX). Test code only.
 */
import { NOT_HELPER, isHelperSeries } from '../util/helperContainers.js';

// discovery.js's default.
const CONTAINER_STALE_SEC = 90;

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

export async function legacyGetNodeData(promQuery, nodeLabel) {
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
