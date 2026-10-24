/**
 * Push notification API — token registration, delivery status, per-token prefs,
 * and Settings → Notifications' devices and test push (#320).
 *
 *   POST   /api/push/register      → register/refresh an FCM token; the phone's
 *                                    model and Android version are kept from its
 *                                    User-Agent when it names them (#320)
 *   DELETE /api/push/register      → remove a token
 *   GET    /api/push/status        → { enabled } delivery-availability probe
 *   GET    /api/push/prefs         → per-token notification prefs (defaults if unset)
 *   PUT    /api/push/prefs         → replace a token's prefs (400 on malformed)
 *   GET    /api/push/devices       → { enabled, stalled, defaults, devices, test,
 *                                    cooldownS }: every registered phone by its
 *                                    fingerprint, never its token (push/devices.js),
 *                                    the prefs a new phone starts with, whether
 *                                    Google can't be reached (`stalled`, in words),
 *                                    and the last test push, phone by phone
 *   DELETE /api/push/devices/:id   → remove the phone with that fingerprint (404: none)
 *   POST   /api/push/test          → { device? }: a test push to that phone, or every
 *                                    phone, through the outbox (push/testPush.js):
 *                                    202 with the test push; 409 with push off or no
 *                                    phone; 404 for an unknown phone; 429 with
 *                                    Retry-After within 30 s of the last to a phone
 *
 * A factory (like createUploadRoutes) so the token store + fcm singletons are
 * injected — tests pass stubs and never build the FCM client or read real creds.
 * Mounted behind authMiddleware in server/index.js.
 */

import { Router } from 'express';
import { apiError } from '../errors.js';
import { deviceFromUserAgent, deviceList } from '../push/devices.js';
import { sendFailureWords } from '../push/sendWords.js';
import { TEST_PUSH_COOLDOWN_MS } from '../push/testPush.js';
import { CATEGORY_KEYS, DEFAULT_PREFS } from '../push/tokenStore.js';

// Defense-in-depth: reject well-known prototype-pollution keys before they
// ever reach the store layer (C1 + I1 defense-in-depth).
const RESERVED_TOKEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// I1: top-level prefs key allowlist — extra keys are rejected, not silently dropped.
const PREFS_TOP_KEYS = new Set(['categories', 'notifyRecoveries', 'enabled']);

/**
 * Validate and extract a token string from raw input.
 * Sends a 400 on error and returns null; returns the token string on success.
 * C1: blocks reserved prototype-pollution keys at the route layer.
 */
function extractToken(raw, res, emptyMsg = 'token required') {
  if (typeof raw !== 'string' || raw.trim() === '') {
    apiError(res, 400, emptyMsg);
    return null;
  }
  if (RESERVED_TOKEN_KEYS.has(raw)) {
    apiError(res, 400, 'invalid token');
    return null;
  }
  if (raw.length > 4096) {
    apiError(res, 400, 'token too long');
    return null;
  }
  return raw;
}

/**
 * Validates the shape of a prefs object. Returns false if malformed.
 * The route owns the 400 contract; malformed bodies never reach persistence.
 */
function validPrefsShape(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  // I1: no extra top-level keys permitted.
  if (!Object.keys(p).every((k) => PREFS_TOP_KEYS.has(k))) return false;
  if (typeof p.notifyRecoveries !== 'boolean') return false;
  if (typeof p.enabled !== 'boolean') return false;
  const c = p.categories;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (Object.keys(c).length !== CATEGORY_KEYS.length) return false;
  return CATEGORY_KEYS.every((k) => typeof c[k] === 'boolean');
}

/**
 * @param {object} deps
 * @param {object} deps.store  the token store
 * @param {object} deps.fcm    fcm module (isPushEnabled)
 * @param {object} [deps.testPush]  push/testPush.js createTestPush (the test push and its outcome)
 * @param {object} [deps.sender]    the outbox's sender (stalled)
 */
export function createPushRoutes({ store, fcm, testPush = null, sender = null }) {
  const router = Router();

  // GET /status — delivery-availability probe (graceful-disable: false when no creds)
  router.get('/status', (req, res) => {
    res.json({ enabled: fcm.isPushEnabled() });
  });

  // POST /register — register or refresh an FCM token
  router.post('/register', (req, res) => {
    const token = extractToken((req.body || {}).token, res);
    if (token === null) return;
    const platform = typeof (req.body || {}).platform === 'string' ? (req.body || {}).platform.slice(0, 64) : null;
    const appVersion = typeof (req.body || {}).appVersion === 'string' ? (req.body || {}).appVersion.slice(0, 64) : null;
    // What Settings → Notifications calls the phone (#320): its User-Agent names it.
    const { model, os } = deviceFromUserAgent(req.get('user-agent'));
    store.registerToken(token, { platform, appVersion, model, os });
    res.json({ stored: true, deliveryEnabled: fcm.isPushEnabled() });
  });

  // DELETE /register — remove a token
  router.delete('/register', (req, res) => {
    const token = extractToken((req.body || {}).token, res);
    if (token === null) return;
    res.json({ removed: store.removeToken(token) });
  });

  // GET /prefs?token=T — fetch per-token prefs (returns DEFAULT_PREFS if unset)
  router.get('/prefs', (req, res) => {
    const token = extractToken(req.query.token, res, 'token query param required');
    if (token === null) return;
    res.json({ prefs: store.getPrefs(token) });
  });

  // PUT /prefs — replace a token's notification prefs
  router.put('/prefs', (req, res) => {
    const { prefs } = req.body || {};
    const token = extractToken((req.body || {}).token, res);
    if (token === null) return;
    if (!validPrefsShape(prefs)) {
      return apiError(res, 400, 'malformed prefs');
    }
    const record = store.setPrefs(token, prefs);
    if (record === null) {
      return apiError(res, 404, 'token not found');
    }
    // m1: setPrefs always sets prefs; record.prefs is always defined.
    res.json({ prefs: record.prefs });
  });

  // GET /devices — Settings → Notifications' list (#320): no token, ever.
  router.get('/devices', (req, res) => {
    const stalled = fcm.isPushEnabled() ? (sender?.stalled?.() ?? null) : null;
    res.set('Cache-Control', 'no-store');
    res.json({
      enabled: fcm.isPushEnabled(),
      stalled: stalled
        ? { since: new Date(stalled.since).toISOString(), sentence: sendFailureWords(stalled.code) }
        : null,
      defaults: DEFAULT_PREFS,
      devices: deviceList(store.getDevices()),
      test: testPush?.last() ?? null,
      cooldownS: TEST_PUSH_COOLDOWN_MS / 1000,
    });
  });

  // DELETE /devices/:id — remove one phone by its fingerprint (#320).
  router.delete('/devices/:id', (req, res) => {
    if (!store.removeDevice(req.params.id)) {
      return apiError(res, 404, 'No registered phone has that id; reload the list');
    }
    return res.json({ removed: true });
  });

  // POST /test — a test push to one phone ({ device }) or every phone (#320).
  router.post('/test', (req, res) => {
    const device = (req.body || {}).device ?? null;
    if (device !== null && typeof device !== 'string') {
      return apiError(res, 400, "device must be a phone's id from the list, or left out for every phone");
    }
    if (!testPush) return apiError(res, 503, 'Test push is not available');
    const out = testPush.send(device);
    if (out.status === 202) return res.status(202).json(out.body);
    if (out.retryAfterS) res.set('Retry-After', String(out.retryAfterS));
    return res.status(out.status).json({
      error: out.error,
      ...(out.code ? { code: out.code } : {}),
      ...(out.retryAfterS ? { retryAfterS: out.retryAfterS } : {}),
    });
  });

  return router;
}
