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
import { DRIFT_LIMITS } from './driftReports.js';

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

/**
 * Keeps `report` as its host's latest. False when the host is new and the
 * store already holds DRIFT_LIMITS.hosts (nothing is written).
 * @param {{host: string, checkedAt: string, status: string, items: object[]}} report
 * @param {number} [now]
 */
export function recordDrift(report, now = Date.now()) {
  const store = load();
  const known = Object.hasOwn(store, report.host);
  if (!known && Object.keys(store).length >= DRIFT_LIMITS.hosts) return false;
  const { host, ...rest } = report;
  store[host] = { ...rest, receivedAt: new Date(now).toISOString() };
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    log.error({ err }, 'Failed to save');
  }
  return true;
}

/** Every host's latest report, hosts sorted: [{ host, checkedAt, receivedAt, status, items }]. */
export function getDriftReports() {
  const store = load();
  return Object.keys(store)
    .sort()
    .filter((h) => store[h] && typeof store[h] === 'object' && Array.isArray(store[h].items))
    .map((host) => ({ host, ...store[host] }));
}
