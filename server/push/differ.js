/**
 * Pure incident differ — the determinism centerpiece of the push pipeline.
 *
 * diffSnapshots(prev, next, thresholds) compares two normalized snapshots and
 * returns a canonically-sorted, byte-deterministic array of incident events.
 * It is PURE and CLOCK-FREE: no Date.now, no I/O, no module-level mutable
 * state. Same input => same output, same order, every time. All clock/I/O
 * (tokenStore, runPushCycle) lives OUTSIDE this file.
 *
 * Cron states: success | failure | overdue | unknown. "overdue" means the job
 * stopped reporting; it emits once on entry and stays silent while it persists.
 *
 * "unknown" (services/cron) and reachable:false-from-absent are normalized
 * upstream in buildSnapshot; here "unknown" NEVER produces an event, and the
 * first cycle (prev=null) is a silent baseline.
 *
 * A service key is diffed against the state of the Kuma monitor that feeds it,
 * wherever that monitor's key was last cycle (#395): see serviceHistory.
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
  cron_overdue: 'warning',
};

/**
 * Recovery/info types — equivalent to severity==="info", exported explicitly.
 * The Arcane recovery types are built outside the snapshot differ (by the
 * Arcane poller) but are semantically recoveries, so they join the set here to
 * be gated by the notifyRecoveries pref in shouldDeliver.
 */
export const RECOVERY_TYPES = new Set([
  ...Object.keys(SEVERITY).filter((type) => SEVERITY[type] === 'info'),
  'arcane_cleared',
  'arcane_agent_recovered',
]);

export function diffSnapshots(prev, next, thresholds) {
  // Baseline: first cycle has no prior state, so nothing has "changed" yet.
  if (prev === null || prev === undefined) return [];
  const events = [];
  diffServices(prev.services || {}, next.services || {}, monitorOfIn(prev), monitorOfIn(next), events);
  diffHosts(prev.hosts || {}, next.hosts || {}, thresholds, events);
  diffUps(prev.ups || { state: 'unknown' }, next.ups || { state: 'unknown' }, events);
  diffCron(prev.cron || {}, next.cron || {}, events);
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

/** A snapshot's monitorOf (service key -> Kuma monitor id); {} when it has none. */
function monitorOfIn(snapshot) {
  const m = snapshot?.monitorOf;
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

/** monitorOf turned around: monitor id -> the keys it fed. */
function keysByMonitor(monitorOf) {
  const keys = new Map();
  for (const [key, id] of Object.entries(monitorOf)) {
    if (!keys.has(id)) keys.set(id, []);
    keys.get(id).push(key);
  }
  return keys;
}

/**
 * The state each service key of `next` is diffed from, given which monitor fed
 * each key in the previous snapshot and in this one (#395). A key's own
 * previous state, except where its monitor changed:
 *
 * - A monitor that fed one key last cycle and feeds one key now brings that
 *   key's state with it, wherever its key moved (a container took it, its
 *   stopped container let it go, the monitor that shared its place dropped
 *   out). So an outage is one service_down and one service_recovered, whatever
 *   card each lands on.
 * - A key whose monitor last cycle feeds another key now starts fresh
 *   ("unknown"), whatever feeds it now: that state went with the monitor, so
 *   the key sends no false recovery and no repeat down push.
 * - A key whose monitor last cycle has gone from the snapshot (paused or
 *   deleted: Kuma no longer lists it) and that no monitor feeds now starts
 *   fresh too: its state was the monitor's, so a running card whose monitor is
 *   paused or deleted while down sends no false recovery, as a monitor with no
 *   container sends nothing then (#390).
 *
 * Otherwise the key keeps its own state, as before #395: a card with no
 * monitor last cycle, a key that a monitor new to the snapshot feeds now (one
 * deleted from Kuma and added again, under a new id), a monitor that feeds
 * several cards (explicit mappings, each card sent on its own), and every key
 * of a snapshot written before #395, which records no monitors (so a deploy
 * sends nothing for it).
 */
function serviceHistory(prev, prevMonitorOf, nextMonitorOf) {
  const prevKeys = keysByMonitor(prevMonitorOf);
  const nextKeys = keysByMonitor(nextMonitorOf);
  const stateOf = (key) => (Object.hasOwn(prev, key) ? prev[key] : 'unknown');
  return (key) => {
    const monitor = Object.hasOwn(nextMonitorOf, key) ? nextMonitorOf[key] : undefined;
    const fed = monitor === undefined ? undefined : prevKeys.get(monitor);
    if (fed) {
      if (fed.includes(key)) return stateOf(key);
      if (fed.length === 1 && nextKeys.get(monitor).length === 1) return stateOf(fed[0]);
    }
    // (A monitor that fed this key last cycle and still does returned above.)
    const before = Object.hasOwn(prevMonitorOf, key) ? prevMonitorOf[key] : undefined;
    if (before !== undefined && nextKeys.has(before)) return 'unknown';
    // Its monitor has gone and nothing feeds it now: the state was the monitor's.
    if (before !== undefined && monitor === undefined) return 'unknown';
    return stateOf(key);
  };
}

function diffServices(prev, next, prevMonitorOf, nextMonitorOf, events) {
  const history = serviceHistory(prev, prevMonitorOf, nextMonitorOf);
  for (const key of Object.keys(next)) {
    const before = history(key);
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

/**
 * What diffSnapshots reads from a snapshot when it is `prev`: the service, cron
 * and UPS states, the monitor that fed each service key, each host's
 * reachability, and which side of its threshold each host metric is on, not the
 * reading itself. Two snapshots with the same key give the same alerts against
 * any `next`, so the persisted snapshot is rewritten only when this changes
 * (createPushSnapshot). Keep it in step with the reads in diffServices,
 * diffHosts, diffUps and diffCron.
 */
export function alertStateKey(snapshot, thresholds) {
  const hosts = {};
  for (const [node, h] of Object.entries(snapshot?.hosts || {})) {
    hosts[node] = [h?.reachable === true, ...HOST_METRICS.map((metric) => h?.[metric] >= thresholds[metric])];
  }
  return JSON.stringify({
    services: snapshot?.services,
    monitorOf: snapshot?.monitorOf,
    hosts,
    ups: snapshot?.ups?.state,
    cron: snapshot?.cron,
  });
}

function diffCron(prev, next, events) {
  for (const key of Object.keys(next)) {
    const before = prev[key] === undefined ? 'unknown' : prev[key];
    const after = next[key];
    if (after === 'unknown') continue; // unknown never emits
    const failed = (before === 'success' || before === 'unknown' || before === 'overdue') && after === 'failure';
    const recovered = (before === 'failure' || before === 'overdue') && after === 'success';
    const wentOverdue = before !== 'overdue' && after === 'overdue';
    if (wentOverdue) {
      events.push({
        type: 'cron_overdue',
        id: key,
        node: nodeOf(key),
        title: 'Cron job overdue',
        body: `${idPart(key)} on ${nodeOf(key)} has not reported on schedule`,
        severity: SEVERITY.cron_overdue,
        prev: before,
        next: after,
      });
    } else if (failed) {
      events.push({
        type: 'cron_failed',
        id: key,
        node: nodeOf(key),
        title: 'Cron job failed',
        body: `${idPart(key)} on ${nodeOf(key)} failed`,
        severity: SEVERITY.cron_failed,
        prev: before,
        next: after,
      });
    } else if (recovered) {
      events.push({
        type: 'cron_recovered',
        id: key,
        node: nodeOf(key),
        title: 'Cron job recovered',
        body: `${idPart(key)} on ${nodeOf(key)} succeeded`,
        severity: SEVERITY.cron_recovered,
        prev: before,
        next: after,
      });
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
