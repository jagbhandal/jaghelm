/**
 * Arcane integration config. Pure env -> config; the feature is off unless
 * both ARCANE_URL and ARCANE_API_KEY are set.
 */

import { createLogger } from '../util/logger.js';

// setInterval takes a signed 32-bit delay; anything larger fires after 1 ms instead.
export const MAX_TIMER_MS = 2 ** 31 - 1;

function intOr(raw, dflt, min) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, n);
}

const timerMs = (ms) => Math.min(ms, MAX_TIMER_MS);
const between = (raw, dflt, min, max) => Math.min(intOr(raw, dflt, min), max);

// Arcane's image watcher schedule (its POLLING setting), as the arcane-check job's
// expected interval. Capped at 31 days, the longest interval the cron store accepts.
const MAX_IMAGE_CHECK_HOURS = 744;

export function readArcaneConfig(env = process.env, { logger } = {}) {
  const url = String(env.ARCANE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(env.ARCANE_API_KEY || '').trim();
  const checkOnlyEnvs = new Set(
    String(env.ARCANE_CHECK_ONLY_ENVS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const pollMs = timerMs(intOr(env.ARCANE_POLL_SECONDS, 300, 60) * 1000);
  const releaseMs = timerMs(intOr(env.ARCANE_RELEASE_CHECK_HOURS, 6, 1) * 3600 * 1000);
  const checkEverySeconds =
    Math.min(intOr(env.ARCANE_IMAGE_CHECK_HOURS, 6, 1), MAX_IMAGE_CHECK_HOURS) * 3600;
  // Weekly vulnerability digest slot in UTC: day 0 (Sunday) to 6, hour 0 to 23.
  const vulnDay = between(env.ARCANE_VULN_DIGEST_DAY, 0, 0, 6);
  const vulnHour = between(env.ARCANE_VULN_DIGEST_HOUR, 14, 0, 23);
  const shared = { checkOnlyEnvs, pollMs, releaseMs, checkEverySeconds, vulnDay, vulnHour };
  // Credentials in the URL would leak through any error path; refuse them.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(url)) {
    (logger || createLogger('arcane')).warn(
      'ARCANE_URL must not contain credentials (user:pass@); Arcane integration disabled'
    );
    return { ...shared, enabled: false, url: '', apiKey: '', cleartext: false };
  }
  return {
    ...shared,
    enabled: Boolean(url && apiKey),
    url,
    apiKey,
    cleartext: /^http:\/\//i.test(url),
  };
}
