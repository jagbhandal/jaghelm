/**
 * Turns an Arcane run summary into a report for the cron store (recordRun).
 * Pure: validation mirrors server/routes/cron.js.
 */
import { envKey } from './derive.js';

const JOBS = new Set(['arcane-update', 'arcane-prune']);
const STATUSES = new Set(['success', 'failure']);
const ERROR_MAX = 2048;

export function buildCronReport({ job, env, cronStatus, error }) {
  if (!JOBS.has(job) || !STATUSES.has(cronStatus)) return null;
  const node = envKey(env);
  if (!node) return null;
  const report = { job, node, status: cronStatus };
  if (typeof error === 'string' && error) report.error = error.slice(0, ERROR_MAX);
  report.expected_every_seconds = 86400;
  return report;
}
