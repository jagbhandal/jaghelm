// @ts-check
/**
 * The devices push sends to, as Settings → Notifications lists them (#320):
 * what each is called, when it registered, was last seen, last had a push
 * accepted by its push service and last failed, and the categories it chose.
 * Never its token or endpoint: a device is named by its fingerprint
 * (prefs.js deviceIdOf). Pure.
 *
 * What a device is called is the name its browser gave when alerts were turned
 * on (webPushStore.js); two with the same name are told apart by their
 * fingerprint's start.
 */
import { sendFailureWords } from './sendWords.js';

const iso = (/** @type {unknown} */ ms) =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

/**
 * Each device as the device list shows it, in the store's order (oldest
 * registration first): its fingerprint, name, platform, when it registered,
 * was last seen and last had a push accepted (ISO 8601, or null), its last
 * failed send in words since then (`lastError`, `{ at, sentence }`, or null)
 * and the push categories it chose (`prefs`).
 *
 * @param {Array<Record<string, any>>} records  webPushStore.getDevices()
 */
export function deviceList(records) {
  const named = records.map((r) => (typeof r.name === 'string' && r.name) || 'Web browser');
  const count = new Map();
  for (const n of named) count.set(n, (count.get(n) ?? 0) + 1);
  return records.map((r, i) => ({
    id: r.id,
    name: count.get(named[i]) > 1 ? `${named[i]} (${String(r.id).slice(0, 6)})` : named[i],
    platform: typeof r.platform === 'string' ? r.platform : null,
    registeredAt: iso(r.registeredAt),
    lastSeenAt: iso(r.lastSeenAt),
    lastDeliveredAt: iso(r.lastDeliveredAt),
    lastError: r.lastError
      ? { at: iso(r.lastError.at), sentence: sendFailureWords(r.lastError.code) }
      : null,
    prefs: r.prefs,
  }));
}
