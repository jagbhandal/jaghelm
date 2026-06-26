/**
 * Pure push-snapshot builder. Reads the warm in-memory caches and the cron
 * store and projects them into the canonical, byte-deterministic Snapshot
 * consumed by the differ. PURE given its injected inputs: no clock, no I/O.
 *
 * Snapshot shape (every map's keys inserted in ascending sorted order):
 *   services: "NODE:ID" -> "up" | "down" | "unknown"
 *   hosts:    "NODE"    -> { reachable, cpu, mem, disk }  (metrics 0..1 fractions)
 *   ups:      { state: "online" | "on_battery" | "unknown" }
 *   cron:     "NODE:JOB" -> "success" | "failure" | "unknown"
 *
 * Normalization law: anything unrecognized => "unknown" (services/cron),
 * "unknown" ups, or reachable:false (hosts). "unknown" never produces an event.
 */

// At top of file (after header comment), for the default production seam only.
// Tests NEVER hit this path — they inject `caches`.
import { getCached } from '../cache.js';
import { getAllStatuses } from '../cron-store.js';

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
  return sortedObject(entries);
}

/**
 * Project getAllStatuses() into the snapshot cron map. Key is "NODE:JOB";
 * value is the latest run's normalized status (runs[0]; missing -> unknown).
 */
export function buildCron(cronStatuses) {
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
      entries.push([`${node}:${job}`, normalizeCronStatus(latest?.status)]);
    }
  }
  return sortedObject(entries);
}

/**
 * Project the cached /api/services node metrics into the snapshot hosts map.
 * A node is `reachable` iff at least one of its three metrics parses finite;
 * an all-null/absent-metrics node is treated as unreachable (per the
 * normalization law). Metrics are 0..1 fractions.
 */
export function buildHosts(servicesCache) {
  const nodes = servicesCache?.nodes;
  if (!nodes || typeof nodes !== 'object') return {};
  const entries = [];
  for (const [node, data] of Object.entries(nodes)) {
    const m = data?.metrics || {};
    const hasMetric = (v) => Number.isFinite(typeof v === 'number' ? v : parseFloat(v));
    const reachable = hasMetric(m.cpu) || hasMetric(m.memPercent) || hasMetric(m.diskPercent);
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

// Default seam: real warm caches + cron store. Kept thin so production wiring
// is parameterless; every test injects fakes instead.
const _defaultCaches = {
  getCached,
  getAllCronStatuses: getAllStatuses,
};

/**
 * Build the canonical, byte-deterministic Snapshot from the warm caches.
 * PURE given its injected `caches`. The four top-level keys are emitted in a
 * fixed order; every sub-map is ascending-sorted by key.
 *
 * @param {{ getCached: (key: string) => *, getAllCronStatuses: () => * }} [caches]
 */
export function buildSnapshot(caches = _defaultCaches) {
  const servicesCache = caches.getCached('services');
  const upsCache = caches.getCached('ups');
  const cronStatuses = caches.getAllCronStatuses();
  return {
    services: buildServices(servicesCache),
    hosts: buildHosts(servicesCache),
    ups: buildUps(upsCache),
    cron: buildCron(cronStatuses),
  };
}
