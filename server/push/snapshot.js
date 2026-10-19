/**
 * Pure push-snapshot builder. Reads the warm in-memory caches and the cron
 * store and projects them into the canonical, byte-deterministic Snapshot
 * consumed by the differ. PURE given its injected inputs: no I/O, and the clock
 * enters only through the injected `caches.now` (absent => no overdue).
 *
 * Snapshot shape (every map's keys inserted in ascending sorted order):
 *   services: "NODE:ID" -> "up" | "down" | "unknown"
 *   hosts:    "NODE"    -> { reachable, cpu, mem, disk }  (metrics 0..1 fractions)
 *   ups:      { state: "online" | "on_battery" | "unknown" }
 *   cron:     "NODE:JOB" -> "success" | "failure" | "overdue" | "unknown"
 *
 * Normalization law: anything unrecognized => "unknown" (services/cron),
 * "unknown" ups, or reachable:false (hosts). "unknown" never produces an event.
 *
 * Failed sources (#232): a payload says whether its upstream answered this
 * cycle (services: `sources.prometheus.ok` / `sources.kuma.ok`, and per node
 * `failedReads`; ups: `ok`), and a missing payload means it did not. A source
 * that failed has nothing to say about what it watches, so the part of the
 * snapshot it feeds is kept from the previous snapshot (see buildSnapshot)
 * rather than read as every host, service or the UPS going away.
 */

// At top of file (after header comment), for the default production seam only.
// Tests NEVER hit this path — they inject `caches`.
import { getCached } from '../cache.js';
import { getAllStatuses } from '../cron-store.js';
import { isOverdue } from '../cron-overdue.js';

/** Kuma/container service status -> canonical up|down|unknown. */
export function normalizeServiceStatus(raw) {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.toLowerCase();
  if (s === 'up') return 'up';
  if (s === 'down') return 'down';
  return 'unknown';
}

/** Cron run status -> canonical success|failure|unknown. */
export function normalizeCronStatus(raw) {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.toLowerCase();
  if (s === 'success') return 'success';
  if (s === 'failure') return 'failure';
  return 'unknown';
}

// nut_status (Prometheus, per src/components/Widgets.jsx): 0=Unknown, 1=Online(OL),
// 2=On Battery(OB), 3=Low Battery(LB). LB folds into on_battery so an Online->LowBattery
// jump still pages — a monitor must never drop the most urgent power event.
const UPS_NUMERIC = new Map([
  [1, 'online'],
  [2, 'on_battery'],
  [3, 'on_battery'],
]);

/** UPS status (raw nut_status numeric, or a canonical string) -> canonical state. */
export function normalizeUpsStatus(raw) {
  if (typeof raw === 'string') {
    const s = raw.toLowerCase();
    if (s === 'online') return 'online';
    if (s === 'on_battery') return 'on_battery';
    return 'unknown';
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return UPS_NUMERIC.get(raw) ?? 'unknown';
  }
  return 'unknown';
}

/**
 * Coerce a host metric (percentage string "0".."100" or bare number) into a
 * 0..1 fraction, clamped. Non-finite / null / junk => 0.
 */
export function coerceFraction(raw) {
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  const frac = n / 100;
  if (frac < 0) return 0;
  if (frac > 1) return 1;
  return frac;
}

/** Build the sorted ascending object from entries [key, value]. */
function sortedObject(entries) {
  const out = {};
  for (const [k, v] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    out[k] = v;
  }
  return out;
}

/**
 * Project the cached /api/services payload into the snapshot services map.
 * Keys are the per-service `uid` ("NODE:ID"); values are normalized statuses.
 *
 * The payload's `upWithoutCard` (#390) adds the up Kuma monitors no card is
 * drawn for, each as "up" under the uid its red card has while it is down, so
 * its recovery diffs on the key of its down push. A card with the same uid
 * wins.
 */
export function buildServices(servicesCache) {
  const nodes = servicesCache?.nodes;
  if (!nodes || typeof nodes !== 'object') return {};
  const entries = [];
  for (const node of Object.values(nodes)) {
    const services = node?.services;
    if (!Array.isArray(services)) continue;
    for (const svc of services) {
      if (!svc || typeof svc.uid !== 'string') continue;
      entries.push([svc.uid, normalizeServiceStatus(svc.status)]);
    }
  }
  const upWithoutCard = Array.isArray(servicesCache.upWithoutCard) ? servicesCache.upWithoutCard : [];
  const cards = new Set(entries.map(([uid]) => uid));
  for (const uid of upWithoutCard) {
    if (typeof uid === 'string' && !cards.has(uid)) entries.push([uid, 'up']);
  }
  return sortedObject(entries);
}

/**
 * Project getAllStatuses() into the snapshot cron map. Key is "NODE:JOB";
 * value is the latest run's normalized status (runs[0]; missing -> unknown),
 * or "overdue" when that run is past its expected schedule at `nowMs`
 * (null/absent nowMs => never overdue).
 */
export function buildCron(cronStatuses, nowMs = null) {
  if (!Array.isArray(cronStatuses)) return {};
  const entries = [];
  for (const nodeEntry of cronStatuses) {
    const node = nodeEntry?.node;
    const jobs = nodeEntry?.jobs;
    if (typeof node !== 'string' || !Array.isArray(jobs)) continue;
    for (const jobEntry of jobs) {
      const job = jobEntry?.job;
      if (typeof job !== 'string') continue;
      const latest = Array.isArray(jobEntry.runs) ? jobEntry.runs[0] : null;
      const state = isOverdue(latest, nowMs) ? 'overdue' : normalizeCronStatus(latest?.status);
      entries.push([`${node}:${job}`, state]);
    }
  }
  return sortedObject(entries);
}

/**
 * Project the cached /api/services node metrics into the snapshot hosts map.
 * A node's `reachable` is the payload's own (Prometheus' `up` for the node)
 * when it is a boolean. Without one (no `up` series carries the node's label,
 * or an older payload) a node is reachable iff at least one of its three
 * metrics parses finite; an all-null/absent-metrics node is treated as
 * unreachable (per the normalization law). Metrics are 0..1 fractions.
 */
export function buildHosts(servicesCache) {
  const nodes = servicesCache?.nodes;
  if (!nodes || typeof nodes !== 'object') return {};
  const entries = [];
  for (const [node, data] of Object.entries(nodes)) {
    const m = data?.metrics || {};
    const hasMetric = (v) => Number.isFinite(typeof v === 'number' ? v : parseFloat(v));
    const reachable =
      typeof data?.reachable === 'boolean'
        ? data.reachable
        : hasMetric(m.cpu) || hasMetric(m.memPercent) || hasMetric(m.diskPercent);
    entries.push([
      node,
      {
        reachable,
        cpu: coerceFraction(m.cpu),
        mem: coerceFraction(m.memPercent),
        disk: coerceFraction(m.diskPercent),
      },
    ]);
  }
  return sortedObject(entries);
}

/** Project the cached UPS payload into the snapshot ups state. */
export function buildUps(upsCache) {
  return { state: normalizeUpsStatus(upsCache?.status) };
}

/**
 * Which upstreams answered this cycle, from the flags their payloads carry. A
 * missing payload (a cold cache after a restart, or one past its TTL because
 * the refresh failed) did not answer. A payload without a flag (an older one, or
 * the one written when no nodes are configured) did.
 */
export function sourcesOk(servicesCache, upsCache) {
  const services = servicesCache != null;
  return {
    prometheus: services && servicesCache.sources?.prometheus?.ok !== false,
    kuma: services && servicesCache.sources?.kuma?.ok !== false,
    ups: upsCache != null && upsCache.ok !== false,
  };
}

const HOST_METRIC_FIELDS = ['cpu', 'mem', 'disk'];

/**
 * The fields of a host's snapshot entry its node's failed reads leave unread
 * this cycle. A metric is unread when its query failed. `reachable` is unread
 * when the `up` query failed, or, for a node with no `up` series (judged by
 * metric presence), when one of its metric queries did. A node without
 * `failedReads` (an older payload) is all read, or all unread while Prometheus
 * failed.
 */
function unreadHostFields(node, prometheusOk) {
  const failed = node?.failedReads;
  if (!Array.isArray(failed)) return prometheusOk ? [] : ['reachable', ...HOST_METRIC_FIELDS];
  const metrics = HOST_METRIC_FIELDS.filter((f) => failed.includes(f));
  const byPresence = typeof node.reachable !== 'boolean';
  const reachable = failed.includes('reachable') || (byPresence && metrics.length > 0);
  return reachable ? ['reachable', ...metrics] : metrics;
}

/**
 * The hosts map to diff. Each host keeps its previous value for every field it
 * could not read this cycle (unreadHostFields) and takes this cycle's for the
 * rest, so one failed query holds only what it feeds. Each query covers every
 * node (#234): a failed CPU query holds every host's cpu (and the reachability
 * of a host with no `up` series), a failed temperature or container query no
 * host field, and a host's `up` at 0 still pages. A
 * host in `prev` but missing from this cycle while Prometheus failed (the
 * refresh threw and dropped every host, or the services payload is missing) is
 * kept whole.
 */
function keepHosts(prevHosts, hosts, servicesCache, ok) {
  const nodes = servicesCache?.nodes ?? {};
  const entries = Object.entries(hosts).map(([node, host]) => {
    const before = prevHosts[node];
    if (!before) return [node, host];
    const kept = { ...host };
    for (const field of unreadHostFields(nodes[node], ok.prometheus)) kept[field] = before[field];
    return [node, kept];
  });
  if (!ok.prometheus) {
    for (const [node, before] of Object.entries(prevHosts)) {
      if (!Object.hasOwn(hosts, node)) entries.push([node, before]);
    }
  }
  return sortedObject(entries);
}

/**
 * Whether this cycle can be the baseline (the first snapshot, with no `prev`).
 * A baseline is never diffed, so what it records for a host or the UPS is only
 * ever compared against later: a host recorded unreachable because Prometheus
 * was down sends host_recovered once it answers, and an "unknown" UPS keeps a
 * later on_battery silent. So the baseline waits while the UPS read fails, or
 * while Prometheus fails with no host's reachability read. It does not wait for
 * Kuma, or for a Prometheus failure some host was still read through: either
 * can last as long as JagHelm runs (no Kuma at KUMA_URL, a query that always
 * times out), and waiting would leave push without a baseline the whole time.
 */
function baselineReady(hosts, servicesCache, ok) {
  if (!ok.ups) return false;
  if (ok.prometheus) return true;
  const nodes = servicesCache?.nodes ?? {};
  return Object.keys(hosts).some((node) => !unreadHostFields(nodes[node], false).includes('reachable'));
}

/**
 * The services map to diff, given which sources answered. Kuma sets every
 * service status that can page (a container's own status is only ever `up`), so
 * while it fails the previous map is kept whole. While Prometheus fails, the
 * running-container list is incomplete: a service missing from this cycle keeps
 * its previous status, and one present (a Kuma outage card) takes this cycle's,
 * so Kuma keeps paging through a Prometheus outage and a recovery during it is
 * still sent once the container is seen again.
 */
function keepServices(prev, services, ok) {
  if (!ok.kuma) return prev.services ?? {};
  if (!ok.prometheus) return sortedObject(Object.entries({ ...(prev.services ?? {}), ...services }));
  return services;
}

// Default seam: real warm caches + cron store. Kept thin so production wiring
// is parameterless; every test injects fakes instead.
export const liveCaches = {
  getCached,
  getAllCronStatuses: getAllStatuses,
  now: () => Date.now(),
};

/**
 * Build the canonical, byte-deterministic Snapshot from the warm caches.
 * PURE given its injected `caches` and `prev`. The four top-level keys are
 * emitted in a fixed order; every sub-map is ascending-sorted by key.
 *
 * `prev` is the snapshot the result will be diffed against. For a source that
 * failed this cycle (sourcesOk) the part it feeds is kept from `prev`: each
 * host's unread fields (keepHosts) and, as keepServices describes, services
 * while Prometheus fails; services while Kuma fails; the UPS state while its
 * read fails. Cron is pushed to JagHelm and has no upstream to fail.
 *
 * With no `prev` this cycle is the baseline, and its values are all there is.
 * When it cannot be one (baselineReady) the result is null, and the push cycle
 * skips it without taking a baseline.
 *
 * @param {{ getCached: (key: string) => *, getAllCronStatuses: () => *, now?: () => number }} [caches]
 * @param {object|null} [prev]
 * @returns {object|null}
 */
export function buildSnapshot(caches = liveCaches, prev = null) {
  const servicesCache = caches.getCached('services');
  const upsCache = caches.getCached('ups');
  const cronStatuses = caches.getAllCronStatuses();
  const ok = sourcesOk(servicesCache, upsCache);
  const services = buildServices(servicesCache);
  const hosts = buildHosts(servicesCache);
  const ups = buildUps(upsCache);
  if (!prev && !baselineReady(hosts, servicesCache, ok)) return null;
  return {
    services: prev ? keepServices(prev, services, ok) : services,
    hosts: prev ? keepHosts(prev.hosts ?? {}, hosts, servicesCache, ok) : hosts,
    ups: prev && !ok.ups ? (prev.ups ?? { state: 'unknown' }) : ups,
    cron: buildCron(cronStatuses, typeof caches.now === 'function' ? caches.now() : null),
  };
}
