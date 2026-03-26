/**
 * JagHelm Discovery Engine
 * Discovers nodes and containers from Prometheus + cAdvisor.
 * Returns merged data with config overrides applied.
 * 
 * Performance: getNodeData() fires all node metrics + container queries
 * in a single Promise.all (12 queries) instead of two sequential batches.
 */

const PROM_TIMEOUT = 8000;

let promUrl = null;

export function initDiscovery(prometheusUrl) {
  promUrl = prometheusUrl;
  console.log('[discovery] Prometheus URL: %s', promUrl);
}

/**
 * Query Prometheus instant query API.
 */
async function promQuery(query) {
  if (!promUrl) return [];
  try {
    const r = await fetch(
      `${promUrl}/api/v1/query?query=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(PROM_TIMEOUT) }
    );
    const data = await r.json();
    return data?.data?.result || [];
  } catch {
    return [];
  }
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
      return r.value?.[1] ? parseFloat(r.value[1]) : null;
    }
  }
  return null;
}

/**
 * Discover which Prometheus node labels exist.
 * Returns array of node label strings, e.g. ['pi', 'vm103', 'vm101']
 */
export async function discoverNodes() {
  // Try multiple label patterns — different setups use different labels
  const results = await promQuery('count by (node)(up{node!=""})');
  if (results.length > 0) {
    return results.map(r => r.metric?.node).filter(Boolean);
  }
  // Fallback: try instance labels
  const fallback = await promQuery('count by (instance)(up{job="node"})');
  return fallback.map(r => r.metric?.instance).filter(Boolean);
}

/**
 * Get node metrics AND container data in a single parallel batch.
 * Fires all 12 Prometheus queries simultaneously instead of two sequential batches.
 * Returns { metrics, containers }
 */
export async function getNodeData(nodeLabel) {
  const l = `node="${nodeLabel}"`;

  // Fire ALL queries in one Promise.all — node metrics (9) + container stats (5) = 14 parallel
  const [
    // Node metrics
    cpuR, memTR, memAR, memCachedR, memBuffersR, upR, tempR, diskTR, diskFR,
    // Container stats
    namesR, cCpuR, cMemR, cRxR, cTxR,
  ] = await Promise.all([
    // Node metrics queries
    promQuery(`100 - (avg by(instance)(irate(node_cpu_seconds_total{${l},mode="idle"}[5m])) * 100)`),
    promQuery(`node_memory_MemTotal_bytes{${l}}`),
    promQuery(`node_memory_MemAvailable_bytes{${l}}`),
    promQuery(`node_memory_Cached_bytes{${l}}`),
    promQuery(`node_memory_Buffers_bytes{${l}}`),
    promQuery(`node_time_seconds{${l}} - node_boot_time_seconds{${l}}`),
    promQuery(`node_hwmon_temp_celsius{${l}}`),
    promQuery(`node_filesystem_size_bytes{${l},mountpoint="/",fstype!="tmpfs"}`),
    promQuery(`node_filesystem_free_bytes{${l},mountpoint="/",fstype!="tmpfs"}`),
    // Container stats queries
    promQuery(`container_last_seen{${l},name!=""}`),
    promQuery(`rate(container_cpu_usage_seconds_total{${l},name!=""}[5m]) * 100`),
    promQuery(`container_memory_usage_bytes{${l},name!=""}`),
    promQuery(`container_network_receive_bytes_total{${l},name!=""}`),
    promQuery(`container_network_transmit_bytes_total{${l},name!=""}`),
  ]);

  // ── Build node metrics ──
  const cpu = scalar(cpuR);
  const memTotal = scalar(memTR);
  const memAvail = scalar(memAR);
  const memCached = scalar(memCachedR);
  const memBuffers = scalar(memBuffersR);
  const upSec = scalar(upR);
  const temp = scalar(tempR);
  let diskTotal = scalar(diskTR);
  let diskFree = scalar(diskFR);

  // Fallback: if no mountpoint="/" data (e.g. NAS devices), find the largest filesystem
  if (diskTotal == null) {
    const [allDiskT, allDiskF] = await Promise.all([
      promQuery(`node_filesystem_size_bytes{${l},fstype!="tmpfs",fstype!=""}`),
      promQuery(`node_filesystem_free_bytes{${l},fstype!="tmpfs",fstype!=""}`),
    ]);
    // Pick the largest filesystem by total size
    let maxSize = 0;
    let bestMount = null;
    for (const r of allDiskT) {
      const val = r.value?.[1] ? parseFloat(r.value[1]) : 0;
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
          diskFree = r.value?.[1] ? parseFloat(r.value[1]) : null;
          break;
        }
      }
    }
  }

  const memUsed = memTotal && memAvail ? memTotal - memAvail : null;
  const memCache = (memCached || 0) + (memBuffers || 0);
  // Actual usage = total used minus cache/buffers (what apps actually need)
  const memActual = memUsed && memCache ? memUsed - memCache : memUsed;
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
    memActualGB: memActual ? (memActual / 1073741824).toFixed(1) : null,
    memActualPercent: memTotal && memActual ? ((memActual / memTotal) * 100).toFixed(1) : null,
    memCacheGB: memCache ? (memCache / 1073741824).toFixed(1) : null,
    uptime: upSec ? formatUptime(upSec) : null,
    temp: temp != null ? temp.toFixed(1) : null,
    diskUsed: diskUsedDisplay,
    diskTotal: diskTotalDisplay,
    diskUnit,
    diskPercent: diskTotal && diskUsed ? ((diskUsed / diskTotal) * 100).toFixed(1) : null,
  };

  // ── Build container list ──
  const containerMap = new Map();
  const allResults = [...namesR, ...cCpuR, ...cMemR, ...cRxR, ...cTxR];
  for (const r of allResults) {
    const name = r.metric?.name;
    if (name && !containerMap.has(name)) {
      containerMap.set(name, {
        container: name,
        status: 'running',
        docker: { cpu: null, memMB: null, rxMB: null, txMB: null },
      });
    }
  }

  // Fill CPU
  for (const r of cCpuR) {
    const name = r.metric?.name;
    const c = containerMap.get(name);
    if (c && r.value?.[1]) c.docker.cpu = parseFloat(parseFloat(r.value[1]).toFixed(1));
  }
  // Fill MEM
  for (const r of cMemR) {
    const name = r.metric?.name;
    const c = containerMap.get(name);
    if (c && r.value?.[1]) c.docker.memMB = parseFloat((parseFloat(r.value[1]) / 1048576).toFixed(1));
  }
  // Fill RX
  for (const r of cRxR) {
    const name = r.metric?.name;
    const c = containerMap.get(name);
    if (c && r.value?.[1]) c.docker.rxMB = parseFloat((parseFloat(r.value[1]) / 1048576).toFixed(1));
  }
  // Fill TX
  for (const r of cTxR) {
    const name = r.metric?.name;
    const c = containerMap.get(name);
    if (c && r.value?.[1]) c.docker.txMB = parseFloat((parseFloat(r.value[1]) / 1048576).toFixed(1));
  }

  const containers = Array.from(containerMap.values());

  return { metrics, containers };
}

// ── Keep legacy exports for backward compat (used by /api/docker/containers) ──
export async function getNodeMetrics(nodeLabel) {
  const { metrics } = await getNodeData(nodeLabel);
  return metrics;
}

export async function discoverContainers(nodeLabel) {
  const { containers } = await getNodeData(nodeLabel);
  return containers;
}

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}
