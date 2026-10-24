/**
 * Drift report store (#674): the latest report per host, in
 * data/drift-reports.json, written atomically like the cron store. A host
 * that is off just keeps its last report; its age is drawn beside it. Nothing
 * here judges a report: the web does, from the age and the status.
 *
 * File shape: { [host]: { checkedAt, receivedAt, status, items } }.
 */
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';
import { DRIFT_LIMITS, DRIFT_PRUNE_DAYS } from './driftReports.js';

const log = createLogger('drift-store');
const STORE_PATH = join(DATA_DIR, 'drift-reports.json');

/** @returns {Record<string, any>} */
function load() {
  try {
    if (!existsSync(STORE_PATH)) return {};
    const data = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

const DAY = 86_400_000;

/** The store without hosts whose last report is over DRIFT_PRUNE_DAYS old. */
function pruned(store, now) {
  const out = {};
  for (const [host, r] of Object.entries(store)) {
    const at = Date.parse(r?.receivedAt);
    if (Number.isFinite(at) && now - at <= DRIFT_PRUNE_DAYS * DAY) out[host] = r;
  }
  return out;
}

/**
 * Keeps `report` as its host's latest. 'full' when the host is new and the
 * store already holds DRIFT_LIMITS.hosts; 'older' when the stored report was
 * checked later than this one (a late or replayed push; nothing is written);
 * else 'stored'.
 * @param {{host: string, checkedAt: string, status: string, items: object[]}} report
 * @param {number} [now]
 * @returns {'stored' | 'older' | 'full'}
 */
export function recordDrift(report, now = Date.now()) {
  const store = pruned(load(), now);
  const known = Object.hasOwn(store, report.host);
  if (!known && Object.keys(store).length >= DRIFT_LIMITS.hosts) return 'full';
  if (known && Date.parse(store[report.host].checkedAt) > Date.parse(report.checkedAt)) return 'older';
  const { host, ...rest } = report;
  store[host] = { ...rest, receivedAt: new Date(now).toISOString() };
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    log.error({ err }, 'Failed to save');
  }
  return 'stored';
}

/** Every host's latest report, hosts sorted: [{ host, checkedAt, receivedAt, status, items }]. */
export function getDriftReports(now = Date.now()) {
  const store = pruned(load(), now);
  return Object.keys(store)
    .sort()
    .filter((h) => store[h] && typeof store[h] === 'object' && Array.isArray(store[h].items))
    .map((host) => ({ host, ...store[host] }));
}
