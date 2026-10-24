// @ts-check
/**
 * The phones push sends to, as Settings → Notifications lists them (#320):
 * what each is called, when it registered, was last seen, last had a push
 * accepted by Google and last failed, and the categories it chose in the app.
 * Never its token: a phone is named by its fingerprint (tokenStore.js
 * deviceIdOf). Pure.
 *
 * What a phone is called comes from its registration's User-Agent
 * (deviceFromUserAgent): an Android app's requests name the phone's model and
 * Android version ("Dalvik/2.1.0 (Linux; U; Android 15; Pixel 8 Build/…)"),
 * so the installed apps need no change. A phone that registered before #320,
 * or whose User-Agent names none (Chrome's reduced "K"), is an "Android
 * phone" until its app next starts and registers again; two with the same
 * name are told apart by their fingerprint's start.
 */
import { sendFailureWords } from './sendWords.js';

/** A model a browser's reduced User-Agent puts in place of the real one. */
const REDUCED_MODELS = new Set(['K', 'k']);

// "Android 15; Pixel 8 Build/AP3A.241005.015)", "Android 4.4.2; en-us; Nexus 5 Build/KOT49H)",
// "Android 14; SM-S918B Build/UP1A.231005.007; wv)": the version, then the model.
const ANDROID =
  /Android\s+(\d[\d.]*)(?:;\s*[a-z]{2}[-_][a-z]{2})?;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\s*[;)]/i;

/**
 * The phone's model and Android version a User-Agent names, each when it
 * does: `{ model: 'Pixel 8', os: '15' }`.
 *
 * @param {unknown} ua
 * @returns {{ model?: string, os?: string }}
 */
export function deviceFromUserAgent(ua) {
  if (typeof ua !== 'string' || ua.length > 1024) return {};
  const m = ANDROID.exec(ua);
  if (!m) return {};
  const model = m[2].trim();
  return {
    ...(model && !REDUCED_MODELS.has(model) && model.length <= 64 ? { model } : {}),
    os: m[1],
  };
}

const iso = (/** @type {unknown} */ ms) =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

/**
 * "Android phone", "iPhone": what a phone with no model is called.
 * @param {unknown} platform
 */
function platformName(platform) {
  if (platform === 'ios') return 'iPhone';
  if (platform === 'web') return 'Web browser';
  return 'Android phone';
}

/**
 * Each phone as the device list shows it, in the store's order (oldest
 * registration first): its fingerprint, name, model, Android version, app
 * version, when it registered, was last seen and last had a push accepted
 * (ISO 8601, or null), its last failed send in words since then (`lastError`,
 * `{ at, sentence }`, or null) and the push categories it chose in the app
 * (`prefs`, as GET /api/push/prefs gives them).
 *
 * @param {Array<Record<string, any>>} records  tokenStore.getDevices()
 */
export function deviceList(records) {
  const named = records.map(
    (r) =>
      (typeof r.name === 'string' && r.name) ||
      (typeof r.model === 'string' && r.model) ||
      platformName(r.platform)
  );
  const count = new Map();
  for (const n of named) count.set(n, (count.get(n) ?? 0) + 1);
  return records.map((r, i) => ({
    id: r.id,
    name: count.get(named[i]) > 1 ? `${named[i]} (${String(r.id).slice(0, 6)})` : named[i],
    model: typeof r.model === 'string' ? r.model : null,
    os: typeof r.os === 'string' ? r.os : null,
    platform: typeof r.platform === 'string' ? r.platform : null,
    appVersion: typeof r.appVersion === 'string' ? r.appVersion : null,
    registeredAt: iso(r.registeredAt),
    lastSeenAt: iso(r.lastSeenAt),
    lastDeliveredAt: iso(r.lastDeliveredAt),
    lastError: r.lastError
      ? { at: iso(r.lastError.at), sentence: sendFailureWords(r.lastError.code) }
      : null,
    prefs: r.prefs,
  }));
}
