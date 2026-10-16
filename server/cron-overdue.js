/**
 * Pure overdue rule for scheduled jobs. The clock is always passed in.
 */

export const MIN_EXPECTED_EVERY_SECONDS = 60;
export const MAX_EXPECTED_EVERY_SECONDS = 2678400; // 31 days

/** Validate a reported `expected_every_seconds` (number or digit string). */
export function parseExpectedEvery(value) {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\d+$/.test(value)) n = Number(value);
  else return { ok: false };
  if (!Number.isInteger(n) || n < MIN_EXPECTED_EVERY_SECONDS || n > MAX_EXPECTED_EVERY_SECONDS) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

export function graceSeconds(interval) {
  return Math.max(0.25 * interval, 600);
}

export function isOverdue(run, nowMs) {
  if (nowMs == null || !run || !run.expected_every_seconds) return false;
  const last = Date.parse(run.timestamp);
  if (Number.isNaN(last)) return false;
  const interval = run.expected_every_seconds;
  return nowMs > last + (interval + graceSeconds(interval)) * 1000;
}

export function decorateStatuses(statuses, nowMs) {
  return statuses.map((node) => ({
    ...node,
    jobs: node.jobs.map((j) => {
      const latest = j.runs[0];
      const sinceMs = nowMs - Date.parse(latest?.timestamp);
      return {
        ...j,
        overdue: isOverdue(latest, nowMs),
        seconds_since_report: Math.floor(sinceMs / 1000),
        ...(latest?.expected_every_seconds && { expected_every_seconds: latest.expected_every_seconds }),
      };
    }),
  }));
}
