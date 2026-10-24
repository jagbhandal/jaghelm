/**
 * What every push device record shares: its fingerprint (deviceIdOf) and its
 * notification prefs (DEFAULT_PREFS, normalizePrefs). The one store behind them
 * is push/webPushStore.js (the installed dashboard's Web Push subscriptions).
 */
import { createHash } from 'node:crypto';

/**
 * A device's fingerprint (#320): the first 12 hex characters of its token's
 * SHA-256. What Settings → Notifications and its routes name a phone by, so no
 * token leaves the server; it can't be turned back into the token.
 * @param {string} token
 */
export function deviceIdOf(token) {
  // A Web Push subscription's pseudo token (webPushStore.js) already is its id.
  const web = /^wp:([0-9a-f]{12})$/.exec(String(token));
  if (web) return web[1];
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

/** Default notification preferences seeded for every newly-registered device. */
export const DEFAULT_PREFS = Object.freeze({
  categories: Object.freeze({ service: true, host: true, ups: true, cron: true, watchtower: true }),
  notifyRecoveries: true,
  enabled: true,
});

/** Deep copy of a prefs object so callers can never mutate stored state. */
export function clonePrefs(prefs) {
  return { ...prefs, categories: { ...prefs.categories } };
}

export const CATEGORY_KEYS = ['service', 'host', 'ups', 'cron', 'watchtower'];

/**
 * Coerce arbitrary input into a valid PREFS object. Unknown keys are dropped,
 * missing keys fall back to DEFAULT_PREFS, all flags coerce to boolean. Pure.
 */
export function normalizePrefs(input) {
  const src = input && typeof input === 'object' ? input : {};
  const srcCats = src.categories && typeof src.categories === 'object' ? src.categories : {};
  const categories = {};
  for (const k of CATEGORY_KEYS) {
    categories[k] = k in srcCats ? Boolean(srcCats[k]) : DEFAULT_PREFS.categories[k];
  }
  return {
    categories,
    notifyRecoveries: 'notifyRecoveries' in src ? Boolean(src.notifyRecoveries) : DEFAULT_PREFS.notifyRecoveries,
    enabled: 'enabled' in src ? Boolean(src.enabled) : DEFAULT_PREFS.enabled,
  };
}
