/**
 * Arcane integration config. Pure env -> config, read through the env schema
 * (env.js, which has each default); the feature is off unless both ARCANE_URL
 * and ARCANE_API_KEY are set.
 */

import { envValue } from '../env.js';
import { createLogger } from '../util/logger.js';
import { urlCredential } from '../util/redact.js';

// setInterval takes a signed 32-bit delay; anything larger fires after 1 ms instead.
export const MAX_TIMER_MS = 2 ** 31 - 1;

const timerMs = (ms) => Math.min(ms, MAX_TIMER_MS);

// Arcane's image watcher schedule (its POLLING setting), as the arcane-check job's
// expected interval. Capped at 31 days, the longest interval the cron store accepts.
const MAX_IMAGE_CHECK_HOURS = 744;

/**
 * `env` is the process's environment unless a test or the poll-once script
 * passes its own.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ logger?: { warn: (msg: string) => void } }} [opts]
 */
export function readArcaneConfig(env, { logger } = {}) {
  const read = (name) => envValue(name, env);
  /** A whole-number variable kept between `min` and `max`. */
  const between = (name, min, max = Infinity) => Math.min(Math.max(min, read(name)), max);
  const url = read('ARCANE_URL').trim().replace(/\/+$/, '');
  const apiKey = read('ARCANE_API_KEY').trim();
  const checkOnlyEnvs = new Set(read('ARCANE_CHECK_ONLY_ENVS'));
  // Environments the weekly vulnerability digest reads; empty turns the digest off.
  const vulnDigestEnvs = new Set(read('ARCANE_VULN_DIGEST_ENVS'));
  const pollMs = timerMs(between('ARCANE_POLL_SECONDS', 60) * 1000);
  const releaseMs = timerMs(between('ARCANE_RELEASE_CHECK_HOURS', 1) * 3600 * 1000);
  const checkEverySeconds = between('ARCANE_IMAGE_CHECK_HOURS', 1, MAX_IMAGE_CHECK_HOURS) * 3600;
  // Weekly vulnerability digest slot in UTC: day 0 (Sunday) to 6, hour 0 to 23.
  const vulnDay = between('ARCANE_VULN_DIGEST_DAY', 0, 6);
  const vulnHour = between('ARCANE_VULN_DIGEST_HOUR', 0, 23);
  const shared = {
    checkOnlyEnvs,
    pollMs,
    releaseMs,
    checkEverySeconds,
    vulnDigestEnvs,
    vulnDay,
    vulnHour,
  };
  // Credentials in the URL would leak through any error path; refuse them,
  // however written (urlCredential: `user:pass@`, one the parser reads as
  // host:port, a key in the query, #419), before any request.
  if (urlCredential(url)) {
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
