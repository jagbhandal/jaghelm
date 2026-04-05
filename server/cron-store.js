/**
 * JagHelm Cron Job Store
 *
 * Persists cron job execution reports to data/cron-jobs.json.
 * Keeps the last MAX_RUNS reports per job per node.
 * Exposes read/write helpers used by the cron API endpoints.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const STORE_PATH = join(DATA_DIR, 'cron-jobs.json');
const MAX_RUNS = 3;

// Ensure data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

/**
 * Load the full cron store from disk.
 * Structure: { [node]: { [job]: [ ...runs ] } }
 */
function load() {
  try {
    if (!existsSync(STORE_PATH)) return {};
    return JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Persist the store to disk.
 */
function save(store) {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[cron-store] Failed to save:', err.message);
  }
}

/**
 * Record a new job execution.
 * @param {object} report
 * @param {string} report.job           - Job name (e.g. "npm-sync")
 * @param {string} report.node          - Node name (e.g. "pi2", "vm103")
 * @param {string} report.status        - "success" | "failure"
 * @param {number} [report.duration_seconds]
 * @param {string} [report.schedule]    - Human-readable schedule (e.g. "every 15 min")
 * @param {string} [report.error]       - Error message if status === "failure"
 */
export function recordRun(report) {
  const { job, node, status, duration_seconds, schedule, error } = report;
  if (!job || !node || !status) return;

  const store = load();
  if (!store[node]) store[node] = {};
  if (!store[node][job]) store[node][job] = [];

  const run = {
    status,
    timestamp: new Date().toISOString(),
    ...(duration_seconds != null && { duration_seconds }),
    ...(schedule && { schedule }),
    ...(error && { error }),
  };

  // Prepend newest run, keep only MAX_RUNS
  store[node][job] = [run, ...store[node][job]].slice(0, MAX_RUNS);

  save(store);
}

/**
 * Return all job statuses grouped by node.
 * Each node contains its jobs with their run history.
 * Result is sorted: nodes alphabetically, jobs alphabetically.
 */
export function getAllStatuses() {
  const store = load();
  return Object.entries(store)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([node, jobs]) => ({
      node,
      jobs: Object.entries(jobs)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([job, runs]) => ({ job, runs })),
    }));
}
