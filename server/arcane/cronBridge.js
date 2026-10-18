/**
 * Turns an Arcane run summary into a report for the cron store (recordRun).
 * Pure: validation mirrors server/routes/cron.js.
 */
import { envKey } from './derive.js';
import { MIN_EXPECTED_EVERY_SECONDS, MAX_EXPECTED_EVERY_SECONDS } from '../cron-overdue.js';

// Expected interval per job. arcane-check follows Arcane's POLLING schedule, which the
// caller passes (ARCANE_IMAGE_CHECK_HOURS); 6 hours is the default. The vulnerability
// digest runs weekly.
const DEFAULT_EVERY = {
  'arcane-update': 86400,
  'arcane-prune': 86400,
  'arcane-check': 21600,
  'arcane-vuln-digest': 604800,
};
const STATUSES = new Set(['success', 'failure']);
const ERROR_MAX = 2048;

const validEvery = (n) =>
  Number.isInteger(n) && n >= MIN_EXPECTED_EVERY_SECONDS && n <= MAX_EXPECTED_EVERY_SECONDS;

export function buildCronReport({ job, env, cronStatus, error, expectedEverySeconds }) {
  if (!Object.hasOwn(DEFAULT_EVERY, job) || !STATUSES.has(cronStatus)) return null;
  const node = envKey(env);
  if (!node) return null;
  const report = { job, node, status: cronStatus };
  if (typeof error === 'string' && error) report.error = error.slice(0, ERROR_MAX);
  report.expected_every_seconds = validEvery(expectedEverySeconds)
    ? expectedEverySeconds
    : DEFAULT_EVERY[job];
  return report;
}
