/**
 * Push notification API — token registration, delivery status, per-token prefs.
 *
 *   POST   /api/push/register  → register/refresh an FCM token
 *   DELETE /api/push/register  → remove a token
 *   GET    /api/push/status    → { enabled } delivery-availability probe
 *   GET    /api/push/prefs     → per-token notification prefs (defaults if unset)
 *   PUT    /api/push/prefs     → replace a token's prefs (400 on malformed)
 *
 * A factory (like createUploadRoutes) so the token store + fcm singletons are
 * injected — tests pass stubs and never load firebase-admin or real creds.
 * Mounted behind authMiddleware in server/index.js.
 */

import { Router } from 'express';
import { apiError } from '../errors.js';

const CATEGORY_KEYS = ['service', 'host', 'ups', 'cron'];

// Defense-in-depth: reject well-known prototype-pollution keys before they
// ever reach the store layer (C1 + I1 defense-in-depth).
const RESERVED_TOKEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// I1: top-level prefs key allowlist — extra keys are rejected, not silently dropped.
const PREFS_TOP_KEYS = new Set(['categories', 'notifyRecoveries', 'enabled']);

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

export function createPushRoutes({ store, fcm }) {
  const router = Router();

  // GET /status — delivery-availability probe (graceful-disable: false when no creds)
  router.get('/status', (req, res) => {
    res.json({ enabled: fcm.isPushEnabled() });
  });

  // POST /register — register or refresh an FCM token
  router.post('/register', (req, res) => {
    const { token, platform, appVersion } = req.body || {};
    if (typeof token !== 'string' || token.trim() === '') {
      return apiError(res, 400, 'token required');
    }
    // C1: block reserved prototype-pollution keys at the route layer.
    if (RESERVED_TOKEN_KEYS.has(token)) return apiError(res, 400, 'invalid token');
    store.registerToken(token, { platform, appVersion });
    res.json({ stored: true, deliveryEnabled: fcm.isPushEnabled() });
  });

  // DELETE /register — remove a token
  router.delete('/register', (req, res) => {
    const { token } = req.body || {};
    if (typeof token !== 'string' || token.trim() === '') {
      return apiError(res, 400, 'token required');
    }
    // C1: block reserved prototype-pollution keys at the route layer.
    if (RESERVED_TOKEN_KEYS.has(token)) return apiError(res, 400, 'invalid token');
    res.json({ removed: store.removeToken(token) });
  });

  // GET /prefs?token=T — fetch per-token prefs (returns DEFAULT_PREFS if unset)
  router.get('/prefs', (req, res) => {
    const token = req.query.token;
    if (typeof token !== 'string' || token.trim() === '') {
      return apiError(res, 400, 'token query param required');
    }
    // C1: block reserved prototype-pollution keys at the route layer.
    if (RESERVED_TOKEN_KEYS.has(token)) return apiError(res, 400, 'invalid token');
    res.json({ prefs: store.getPrefs(token) });
  });

  // PUT /prefs — replace a token's notification prefs
  router.put('/prefs', (req, res) => {
    const { token, prefs } = req.body || {};
    if (typeof token !== 'string' || token.trim() === '') {
      return apiError(res, 400, 'token required');
    }
    // C1: block reserved prototype-pollution keys at the route layer.
    if (RESERVED_TOKEN_KEYS.has(token)) return apiError(res, 400, 'invalid token');
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

  return router;
}
