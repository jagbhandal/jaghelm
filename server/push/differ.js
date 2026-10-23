/**
 * Pure incident differ — the determinism centerpiece of the push pipeline.
 *
 * diffSnapshots(prev, next, status) compares two push snapshots and returns a
 * canonically-sorted, byte-deterministic array of incident events. It is PURE
 * and CLOCK-FREE: no Date.now, no I/O, no module-level mutable state. Same
 * input => same output, same order, every time. All clock/I/O (tokenStore,
 * runPushCycle) lives OUTSIDE this file.
 *
 * It judges nothing (#292): the snapshot holds what the status model decided
 * (server/status/, push/snapshot.js), a service's state, each host reading's
 * level, the UPS's and each job's state and which monitoring sources are down,
 * and the differ only sees where that changed. `status`, the model the next
 * snapshot was built from, gives each event its words: the entity's name and
 * the model's reason, so a notification says what the screens say.
 *
 * Cron states: success | failure | overdue | unknown. "overdue" means the job
 * stopped reporting; it emits once on entry and stays silent while it persists.
 *
 * An entity with no previous state (#448), one new to the snapshot or every
 * entity when there is no previous snapshot (prev=null: a first run, or a
 * missing or unreadable file), is diffed from "no previous state": it sends its
 * alert once if it appears in trouble and nothing if it appears ok. So a node
 * added to services.yaml sends no "Host recovered", and one that appears over
 * its line or unreachable pages. "unknown" (what the model can't call) never
 * produces an event; the snapshot holds the last known state through it.
 *
 * A service key is diffed against the state of the Kuma monitor that feeds it,
 * wherever that monitor's key was last cycle (#395), and a monitor is one event
 * however many cards it feeds (#407): see serviceHistory and diffServices.
 */
import { judgeService } from '../status/rules.js';

/**
 * event.type -> severity. host_threshold is 'warning' for a reading that
 * reached its warn line and 'critical' for one that reached its crit line.
 */
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
  source_down: 'warning',
  source_recovered: 'info',
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

/** A snapshot with no previous state for anything: what a missing prev is diffed from (#448). */
const NO_STATE = Object.freeze({
  services: {},
  monitorOf: {},
  hosts: {},
  ups: { state: 'unknown' },
  cron: {},
  sources: {},
});

/**
 * @param {object|null} prev    the previous cycle's snapshot (null: none, so
 *                              every entity is new, #448)
 * @param {object} next         this cycle's snapshot
 * @param {object|null} [status] the status model `next` was built from: the words
 */
export function diffSnapshots(prev, next, status = null) {
  if (prev === null || prev === undefined) prev = NO_STATE;
  const words = wordsFrom(status);
  const events = [];
  diffServices(
    prev.services || {},
    next.services || {},
    monitorOfIn(prev),
    monitorOfIn(next),
    words,
    events
  );
  diffHosts(prev.hosts || {}, next.hosts || {}, words, events);
  diffUps(prev.ups, next.ups, words, events);
  diffCron(prev.cron || {}, next.cron || {}, words, events);
  diffSources(prev.sources || {}, next.sources || {}, words, events);
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

// ── Words: the model's names and reasons ─────────────────────────────────

/** "a · b", or just `a` when there is no reason. */
const line = (subject, reason) => (reason ? `${subject} · ${reason}` : subject);

/**
 * What an event says, from the model: each entity by its id, and each failed
 * source's issue. With no model (a test of the differ alone), the keys stand
 * in for names and there is no reason.
 */
function wordsFrom(status) {
  const byId = new Map();
  for (const e of Array.isArray(status?.entities) ? status.entities : []) byId.set(e.id, e);
  for (const e of Array.isArray(status?.issues) ? status.issues : [])
    if (!byId.has(e.id)) byId.set(e.id, e);
  return { entity: (id) => byId.get(id) ?? null };
}

// The name of a node reading in a title (status/rules.js NODE_METRICS, and the pools).
const READING_LABEL = { cpu: 'CPU', mem: 'memory', disk: 'disk', temp: 'temperature' };
function readingLabel(key) {
  if (key.startsWith('pool:')) return `storage pool ${key.slice(5)}`;
  return READING_LABEL[key] ?? key;
}

// ── Services ─────────────────────────────────────────────────────────────

/** The state of several keys of one monitor: down if any is, else up if any is. */
function combined(states) {
  if (states.includes('down')) return 'down';
  if (states.includes('up')) return 'up';
  return 'unknown';
}

/**
 * The state each service key of `next` is diffed from, given which monitor fed
 * each key in the previous snapshot and in this one (#395). A key's own
 * previous state, except where its monitor changed:
 *
 * - A key whose monitor fed keys last cycle takes that monitor's state, from
 *   the keys it fed, wherever its keys moved (a container took it, its stopped
 *   container let it go, the monitor that shared its place dropped out, one of
 *   the cards an explicit mapping gives it left or came back, #407). So an
 *   outage is one service_down and one service_recovered, whatever card each
 *   lands on.
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
 * deleted from Kuma and added again, under a new id), and every key of a
 * snapshot written before #395, which records no monitors (so a deploy sends
 * nothing for it).
 *
 * The snapshot builder holds a key at this state too, while the model gives a
 * service no up or down (push/snapshot.js buildServices).
 *
 * @param {Record<string, string>} prev           the previous snapshot's services
 * @param {Record<string, string>} prevMonitorOf  its monitorOf
 * @param {Record<string, string>} nextMonitorOf  this cycle's monitorOf
 * @returns {(key: string) => string}
 */
export function serviceHistory(prev, prevMonitorOf, nextMonitorOf) {
  const prevKeys = keysByMonitor(prevMonitorOf);
  const nextKeys = keysByMonitor(nextMonitorOf);
  const stateOf = (key) => (Object.hasOwn(prev, key) ? prev[key] : 'unknown');
  return (key) => {
    const monitor = Object.hasOwn(nextMonitorOf, key) ? nextMonitorOf[key] : undefined;
    const fed = monitor === undefined ? undefined : prevKeys.get(monitor);
    if (fed) return combined(fed.map(stateOf));
    const before = Object.hasOwn(prevMonitorOf, key) ? prevMonitorOf[key] : undefined;
    if (before !== undefined && nextKeys.has(before)) return 'unknown';
    // Its monitor has gone and nothing feeds it now: the state was the monitor's.
    if (before !== undefined && monitor === undefined) return 'unknown';
    return stateOf(key);
  };
}

/**
 * One event per Kuma monitor, however many cards it feeds (#407): a monitor
 * that services.yaml maps to a container on several nodes (tailscale on pi2
 * and vm103) is one outage, so one service_down and one service_recovered,
 * even when one of its cards leaves the board or comes back during it. The
 * event goes on the first of its cards (by key), and names every node. A key
 * no monitor feeds is its own.
 */
function diffServices(prev, next, prevMonitorOf, nextMonitorOf, words, events) {
  const history = serviceHistory(prev, prevMonitorOf, nextMonitorOf);
  const groups = new Map();
  for (const key of Object.keys(next).sort()) {
    const group = Object.hasOwn(nextMonitorOf, key)
      ? `monitor ${nextMonitorOf[key]}`
      : `key ${key}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(key);
  }
  for (const keys of groups.values()) {
    const before = combined(keys.map(history));
    const after = combined(keys.map((k) => next[k]));
    if (after === 'unknown') continue; // unknown never emits
    const wentDown = before !== 'down' && after === 'down';
    const recovered = before === 'down' && after === 'up';
    if (!wentDown && !recovered) continue;
    const key = keys.find((k) => next[k] === after);
    const type = wentDown ? 'service_down' : 'service_recovered';
    const entity = words.entity(`services/${key}`);
    const nodes = [...new Set(keys.map(nodeOf))].join(', ');
    // A service's reason is its Kuma state. The one key that is not a service
    // in the model, the up entry a grey breadcrumb shares (#390), takes the
    // model's words for that state.
    const reason =
      entity?.kind === 'service'
        ? entity.reason
        : judgeService({ status: after, kumaOk: true }).reason;
    events.push({
      type,
      id: key,
      node: nodeOf(key),
      title: wentDown ? 'Service down' : 'Service recovered',
      body: line(`${entity?.name ?? idPart(key)} on ${nodes}`, reason),
      severity: SEVERITY[type],
      reason,
      prev: before,
      next: after,
    });
  }
}

// ── Hosts ────────────────────────────────────────────────────────────────

const LEVEL_RANK = { ok: 0, warn: 1, crit: 2 };

/** A host entry's levels, or null for an entry written before #292 (readings, not levels). */
function levelsOf(host) {
  const levels = host?.levels;
  return levels && typeof levels === 'object' && !Array.isArray(levels) ? levels : null;
}

/** When each held reading of a host entry began its hold (#469); none before #469. */
function startsOf(host) {
  const since = host?.heldSince;
  return since && typeof since === 'object' && !Array.isArray(since) ? since : {};
}

/**
 * Reachability, then each reading's level as the model holds it (hysteresis
 * included: status/rules.js levelOf). A level that rises (ok to warn, ok or
 * warn to crit) sends host_threshold; one that returns to ok sends
 * host_threshold_cleared; crit falling back to warn sends nothing. Levels are
 * compared whenever the host is reachable now, including the cycle it comes
 * back, since the model keeps them while it is away.
 *
 * A host new to the snapshot has no previous state (#448): unreachable, it
 * sends host_unreachable; reachable, nothing for that (it never went away),
 * and each of its readings is new. A reading new to the snapshot (a node's
 * first, or a sensor or pool that starts answering) at warn or crit sends
 * host_threshold at its level, and nothing at ok. `prev` is null in those
 * events: there was no previous state.
 *
 * A reading that leaves a reachable host's levels (a storage pool a Proxmox
 * read that succeeded no longer lists: push/snapshot.js buildHosts, #468) at
 * warn or crit sends host_threshold_cleared, with `next` null: it has no state
 * now. At ok it sends nothing. A host that leaves the snapshot sends nothing.
 * Nor does a reading that leaves while it was held with no value (it has a
 * start in `prev`'s `heldSince`, #469): nothing was read, so nothing is
 * cleared. The model forgets such a reading when its 24 h are up, and
 * buildHosts drops it on that cycle.
 */
function diffHosts(prev, next, words, events) {
  for (const node of Object.keys(next)) {
    const known =
      Object.hasOwn(prev, node) && prev[node] !== null && typeof prev[node] === 'object';
    const before = known ? prev[node] : null;
    const after = next[node];
    const beforeReach = before === null ? null : before.reachable === true;
    const afterReach = after.reachable === true;
    const entity = words.entity(`nodes/${node}`);
    const name = entity?.name ?? node;
    const reason = entity?.reason;
    if (beforeReach !== false && !afterReach) {
      events.push({
        type: 'host_unreachable',
        id: node,
        node,
        title: 'Host unreachable',
        body: line(name, reason),
        severity: SEVERITY.host_unreachable,
        reason,
        prev: beforeReach,
        next: false,
      });
      continue; // unreachable supersedes level changes this cycle
    }
    if (beforeReach === false && afterReach) {
      events.push({
        type: 'host_recovered',
        id: node,
        node,
        title: 'Host recovered',
        body: line(name, reason),
        severity: SEVERITY.host_recovered,
        reason,
        prev: false,
        next: true,
      });
    }
    if (!afterReach) continue;
    const was = before === null ? {} : levelsOf(before);
    const now = levelsOf(after);
    // A file written before #292 holds readings: it is upgraded as it is read
    // (push/snapshot.js upgradeSnapshot), so this only skips one that wasn't.
    if (!was || !now) continue;
    for (const key of Object.keys(now).sort()) {
      // A reading with no level before is new: diffed from no state, as from ok.
      const b = Object.hasOwn(was, key) ? was[key] : null;
      const a = now[key];
      if (!Object.hasOwn(LEVEL_RANK, a)) continue;
      if (b !== null && !Object.hasOwn(LEVEL_RANK, b)) continue;
      if (LEVEL_RANK[a] > (b === null ? LEVEL_RANK.ok : LEVEL_RANK[b])) {
        events.push({
          type: 'host_threshold',
          id: `${node}:${key}`,
          node,
          title: `Host ${readingLabel(key)} ${a === 'crit' ? 'critical' : 'high'}`,
          body: line(name, reason),
          severity: a === 'crit' ? 'critical' : SEVERITY.host_threshold,
          reason,
          prev: b,
          next: a,
        });
      } else if (a === 'ok' && b !== null && b !== 'ok') {
        events.push({
          type: 'host_threshold_cleared',
          id: `${node}:${key}`,
          node,
          title: `Host ${readingLabel(key)} normal`,
          body: line(name, reason),
          severity: SEVERITY.host_threshold_cleared,
          reason,
          prev: b,
          next: a,
        });
      }
    }
    // A reading that left the snapshot ended its episode in the model: a
    // storage pool a Proxmox read that succeeded no longer lists (#468). Over
    // its line, that is its clear, as the node on the screen no longer shows it.
    const began = startsOf(before);
    for (const key of Object.keys(was).sort()) {
      const b = was[key];
      if (Object.hasOwn(now, key) || (b !== 'warn' && b !== 'crit')) continue;
      // Held with no value (#469): it leaves silently.
      if (Object.hasOwn(began, key)) continue;
      events.push({
        type: 'host_threshold_cleared',
        id: `${node}:${key}`,
        node,
        title: `Host ${readingLabel(key)} normal`,
        body: line(name, reason),
        severity: SEVERITY.host_threshold_cleared,
        reason,
        prev: b,
        next: null,
      });
    }
  }
}

/**
 * What diffSnapshots reads from a snapshot when it is `prev`: every state, the
 * monitor that fed each service key, each host's reachability and levels and
 * which of its readings are held with no value, with when that began (#469:
 * the file must keep it, so a restart doesn't start the 24 h again), and each
 * source's run of failed cycles. Two snapshots with the same key give the
 * same alerts against any `next`, so the persisted snapshot is rewritten only
 * when this changes (createPushSnapshot). The snapshot holds no readings since
 * #292, so that is all of it. Keep it in step with the reads in diffServices,
 * diffHosts, diffUps, diffCron and diffSources.
 */
export function alertStateKey(snapshot) {
  return JSON.stringify({
    services: snapshot?.services,
    monitorOf: snapshot?.monitorOf,
    hosts: snapshot?.hosts,
    ups: snapshot?.ups?.state,
    cron: snapshot?.cron,
    sources: snapshot?.sources,
  });
}

// ── Cron ─────────────────────────────────────────────────────────────────

const CRON_TEXT = {
  cron_overdue: 'Cron job overdue',
  cron_failed: 'Cron job failed',
  cron_recovered: 'Cron job recovered',
};

function diffCron(prev, next, words, events) {
  for (const key of Object.keys(next)) {
    const before = prev[key] === undefined ? 'unknown' : prev[key];
    const after = next[key];
    if (after === 'unknown') continue; // unknown never emits
    const failed =
      (before === 'success' || before === 'unknown' || before === 'overdue') && after === 'failure';
    const recovered = (before === 'failure' || before === 'overdue') && after === 'success';
    const wentOverdue = before !== 'overdue' && after === 'overdue';
    const type = wentOverdue
      ? 'cron_overdue'
      : failed
        ? 'cron_failed'
        : recovered
          ? 'cron_recovered'
          : null;
    if (!type) continue;
    // A job marked as a backup is a backup in the model (#291); its push is a cron one.
    const entity = words.entity(`jobs/${key}`) ?? words.entity(`backups/${key}`);
    const reason = entity?.reason;
    events.push({
      type,
      id: key,
      node: nodeOf(key),
      title: CRON_TEXT[type],
      body: line(`${entity?.name ?? idPart(key)} on ${nodeOf(key)}`, reason),
      // A failure the model judges crit (a failed backup) pages as critical,
      // as the board shows it (#478); every other cron push keeps its type's.
      severity: type === 'cron_failed' && entity?.state === 'crit' ? 'critical' : SEVERITY[type],
      reason,
      prev: before,
      next: after,
      // The model's id, which only it knows is a job's or a backup's: what the
      // app opens on a tap (#309, androidPayload.js).
      ...(entity ? { entity: entity.id } : {}),
    });
  }
}

// ── UPS ──────────────────────────────────────────────────────────────────

/**
 * The snapshot holds the UPS's last known state through "unknown" (NUT quiet,
 * the UPS read failed: push/snapshot.js buildUps), so "unknown" here means no
 * state is known at all (#448): a UPS new to the snapshot, or one never read.
 * Going on battery from there pages, as from online; coming back on mains from
 * there sends nothing, since no outage was paged. A UPS going unknown sends
 * nothing.
 */
function diffUps(prev, next, words, events) {
  const before = prev?.state ?? 'unknown';
  const after = next?.state ?? 'unknown';
  const type =
    before !== 'on_battery' && after === 'on_battery'
      ? 'ups_on_battery'
      : before === 'on_battery' && after === 'online'
        ? 'ups_restored'
        : null;
  if (!type) return;
  const entity = words.entity('power/ups');
  const reason = entity?.reason;
  events.push({
    type,
    id: 'ups',
    node: 'ups',
    title: type === 'ups_on_battery' ? 'UPS on battery' : 'UPS restored',
    body: line(entity?.name ?? 'UPS', reason),
    severity: SEVERITY[type],
    reason,
    prev: before,
    next: after,
  });
}

// ── Monitoring sources ───────────────────────────────────────────────────

const SOURCE_NAMES = { prometheus: 'Prometheus', kuma: 'Kuma', nut: 'NUT', config: 'JagHelm config' };

/**
 * The status model itself, as a source (#440): its key in the snapshot's
 * `sources`, and the id and node of its source events. While it throws there
 * is no status, so no other push is sent: its source_down says so, at
 * `critical`, and its words are fixed, since there is no model to take them
 * from.
 */
export const STATUS_CHECK = 'status';
const STATUS_CHECK_TEXT = {
  source_down: {
    title: 'JagHelm status check failing',
    body: "JagHelm can't work out the status, so no other alerts are sent until it can. The server log says why.",
    severity: 'critical',
  },
  source_recovered: {
    title: 'JagHelm status check recovered',
    body: 'Alerts are on again. Anything that changed meanwhile is sent now.',
    severity: SEVERITY.source_recovered,
  },
};

/**
 * services.yaml as a source (#505): its key in the snapshot's `sources`, and
 * the id and node of its source events. Its down push has the model's name and
 * reason ("JagHelm config · services.yaml doesn't parse (line 4)") under a
 * title of its own; its recovery's words are fixed (the model lists no config
 * source once the file loads), and true of each way it ends: fixed by hand,
 * readable again, or deleted (#536).
 */
export const CONFIG_SOURCE = 'config';
const CONFIG_TITLE = { source_down: 'JagHelm config broken', source_recovered: 'JagHelm config fixed' };
const CONFIG_RECOVERED = 'services.yaml is no longer broken';

/**
 * A monitoring source that is down (failed for two cycles in a row,
 * push/snapshot.js buildSources) is one source_down, whatever it fed (spec §6):
 * the entities it feeds are unknown in the model, which never pages. Its
 * recovery is one source_recovered. One failed cycle on its own sends nothing.
 * The status check (STATUS_CHECK) and services.yaml (CONFIG_SOURCE) are
 * diffed the same way, with their own words.
 */
function diffSources(prev, next, words, events) {
  for (const name of Object.keys(next)) {
    const before = prev[name] ?? 'ok';
    const after = next[name];
    const down = before !== 'down' && after === 'down';
    const recovered = before === 'down' && after === 'ok';
    if (!down && !recovered) continue;
    const type = down ? 'source_down' : 'source_recovered';
    if (name === STATUS_CHECK) {
      const { title, body, severity } = STATUS_CHECK_TEXT[type];
      events.push({
        type,
        id: name,
        node: name,
        title,
        body,
        severity,
        reason: undefined,
        prev: before,
        next: after,
      });
      continue;
    }
    const issue = words.entity(`sources/${name}`);
    const label = issue?.name ?? SOURCE_NAMES[name] ?? name;
    const reason = down ? issue?.reason : undefined;
    const config = name === CONFIG_SOURCE;
    const backBody = config ? CONFIG_RECOVERED : `${label} is answering again`;
    events.push({
      type,
      id: name,
      node: name,
      title: config
        ? CONFIG_TITLE[type]
        : down
          ? 'Monitoring source down'
          : 'Monitoring source recovered',
      body: down ? line(label, reason) : backBody,
      severity: down ? SEVERITY.source_down : SEVERITY.source_recovered,
      reason,
      prev: before,
      next: after,
    });
  }
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
