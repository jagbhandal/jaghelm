/**
 * Pure incident differ — the determinism centerpiece of the push pipeline.
 *
 * diffSnapshots(prev, next, thresholds) compares two normalized snapshots and
 * returns a canonically-sorted, byte-deterministic array of incident events.
 * It is PURE and CLOCK-FREE: no Date.now, no I/O, no module-level mutable
 * state. Same input => same output, same order, every time. All clock/I/O
 * (tokenStore, runPushCycle) lives OUTSIDE this file.
 *
 * "unknown" (services/cron) and reachable:false-from-absent are normalized
 * upstream in buildSnapshot; here "unknown" NEVER produces an event, and the
 * first cycle (prev=null) is a silent baseline.
 */

/** event.type -> severity. */
export const SEVERITY = {
  service_down: 'critical',
  service_recovered: 'info',
  host_unreachable: 'critical',
  host_recovered: 'info',
  host_threshold: 'warning',
  host_threshold_cleared: 'info',
  ups_on_battery: 'critical',
  ups_restored: 'info',
  cron_failed: 'warning',
  cron_recovered: 'info',
};

/** Recovery/info types — equivalent to severity==="info", exported explicitly. */
export const RECOVERY_TYPES = new Set(
  Object.keys(SEVERITY).filter((type) => SEVERITY[type] === 'info'),
);

export function diffSnapshots(prev, next, thresholds) {
  // Baseline: first cycle has no prior state, so nothing has "changed" yet.
  if (prev === null || prev === undefined) return [];
  const events = [];
  diffServices(prev.services || {}, next.services || {}, events);
  diffHosts(prev.hosts || {}, next.hosts || {}, thresholds, events);
  diffUps(prev.ups || { state: 'unknown' }, next.ups || { state: 'unknown' }, events);
  return sortEvents(events);
}

/** "NODE:ID" -> the NODE portion (substring before the first colon). */
function nodeOf(key) {
  const i = key.indexOf(':');
  return i === -1 ? key : key.slice(0, i);
}

/** "NODE:ID" -> the ID portion (substring after the first colon). */
function idPart(key) {
  const i = key.indexOf(':');
  return i === -1 ? key : key.slice(i + 1);
}

function diffServices(prev, next, events) {
  for (const key of Object.keys(next)) {
    const before = prev[key] === undefined ? 'unknown' : prev[key];
    const after = next[key];
    if (after === 'unknown') continue; // unknown never emits
    const wentDown = (before === 'up' || before === 'unknown') && after === 'down';
    const recovered = before === 'down' && after === 'up';
    if (wentDown) {
      events.push({
        type: 'service_down',
        id: key,
        node: nodeOf(key),
        title: 'Service down',
        body: `${idPart(key)} on ${nodeOf(key)} is down`,
        severity: SEVERITY.service_down,
        prev: before,
        next: after,
      });
    } else if (recovered) {
      events.push({
        type: 'service_recovered',
        id: key,
        node: nodeOf(key),
        title: 'Service recovered',
        body: `${idPart(key)} on ${nodeOf(key)} is back up`,
        severity: SEVERITY.service_recovered,
        prev: before,
        next: after,
      });
    }
  }
}

const HOST_METRICS = ['cpu', 'disk', 'mem']; // iterate sorted so insertion order is deterministic

function pct(fraction) {
  return `${Math.round(fraction * 100)}%`;
}

function diffHosts(prev, next, thresholds, events) {
  for (const node of Object.keys(next)) {
    const before = prev[node] || { reachable: false };
    const after = next[node];
    const beforeReach = before.reachable === true;
    const afterReach = after.reachable === true;
    if (beforeReach && !afterReach) {
      events.push({
        type: 'host_unreachable',
        id: node,
        node,
        title: 'Host unreachable',
        body: `${node} is unreachable`,
        severity: SEVERITY.host_unreachable,
        prev: true,
        next: false,
      });
      continue; // unreachable supersedes metric crossings this cycle
    }
    if (!beforeReach && afterReach) {
      events.push({
        type: 'host_recovered',
        id: node,
        node,
        title: 'Host recovered',
        body: `${node} is reachable again`,
        severity: SEVERITY.host_recovered,
        prev: false,
        next: true,
      });
    }
    // Metric thresholds only meaningful when reachable both cycles.
    if (!beforeReach || !afterReach) continue;
    for (const metric of HOST_METRICS) {
      const limit = thresholds[metric];
      const clearAt = limit - thresholds.hysteresis;
      const b = before[metric];
      const a = after[metric];
      const wasHigh = b >= limit;
      const isHigh = a >= limit;
      if (!wasHigh && isHigh) {
        events.push({
          type: 'host_threshold',
          id: `${node}:${metric}`,
          node,
          title: `Host ${metric} high`,
          body: `${node} ${metric} at ${pct(a)} (threshold ${pct(limit)})`,
          severity: SEVERITY.host_threshold,
          prev: b,
          next: a,
        });
      } else if (wasHigh && a < clearAt) {
        events.push({
          type: 'host_threshold_cleared',
          id: `${node}:${metric}`,
          node,
          title: `Host ${metric} normal`,
          body: `${node} ${metric} back to ${pct(a)} (threshold ${pct(limit)})`,
          severity: SEVERITY.host_threshold_cleared,
          prev: b,
          next: a,
        });
      }
      // staying in [clearAt, limit) band: emit nothing (hysteresis).
    }
  }
}

function diffUps(prev, next, events) {
  const before = prev.state;
  const after = next.state;
  if (before === 'online' && after === 'on_battery') {
    events.push({
      type: 'ups_on_battery',
      id: 'ups',
      node: 'ups',
      title: 'UPS on battery',
      body: 'UPS switched to battery power',
      severity: SEVERITY.ups_on_battery,
      prev: before,
      next: after,
    });
  } else if (before === 'on_battery' && after === 'online') {
    events.push({
      type: 'ups_restored',
      id: 'ups',
      node: 'ups',
      title: 'UPS restored',
      body: 'UPS back on line power',
      severity: SEVERITY.ups_restored,
      prev: before,
      next: after,
    });
  }
  // any state involving "unknown" => no event.
}

/**
 * Canonical sort: ascending by (type, id) via string compare, id as tiebreak.
 * Guarantees two logically-equivalent inputs in different insertion order
 * produce a byte-identical event array.
 */
function sortEvents(events) {
  return events.sort((a, b) => {
    const t = a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
