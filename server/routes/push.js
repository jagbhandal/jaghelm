/**
 * Push notification API: Settings → Notifications' devices and test push
 * (#320). The installed dashboard's Web Push subscriptions register under
 * /api/push/web (routes/webPush.js); the Android app's FCM registration, status
 * and prefs routes are gone with it (#659) and answer 404 like any unknown one.
 *
 *   GET    /api/push/devices       → { enabled, channels, stalled, defaults, devices,
 *                                    test, cooldownS }: every registered browser by
 *                                    its fingerprint, never its token or endpoint
 *                                    (push/devices.js), the prefs a new one starts
 *                                    with, whether the push service can't be reached
 *                                    (`stalled`, in words), and the last test push,
 *                                    device by device
 *   DELETE /api/push/devices/:id   → remove the device with that fingerprint (404: none)
 *   POST   /api/push/test          → { device? }: a test push to that device, or every
 *                                    device, through the outbox (push/testPush.js):
 *                                    202 with the test push; 409 with push off or no
 *                                    device; 404 for an unknown device; 429 with
 *                                    Retry-After within 30 s of the last to a device
 *
 * A factory (like createUploadRoutes) so the store and channels are injected:
 * tests pass stubs and never reach a push service. Mounted behind
 * authMiddleware in server/index.js.
 */

import { Router } from 'express';
import { apiError } from '../errors.js';
import { deviceList } from '../push/devices.js';
import { sendFailureWords } from '../push/sendWords.js';
import { TEST_PUSH_COOLDOWN_MS } from '../push/testPush.js';
import { DEFAULT_PREFS } from '../push/prefs.js';

/** Answer a test push's outcome (testPush.send): 202 with its view, or the refusal. */
export function respondTestPush(res, out) {
  if (out.status === 202) return res.status(202).json(out.body);
  if (out.retryAfterS) res.set('Retry-After', String(out.retryAfterS));
  return res.status(out.status).json({
    error: out.error,
    ...(out.code ? { code: out.code } : {}),
    ...(out.retryAfterS ? { retryAfterS: out.retryAfterS } : {}),
  });
}

/**
 * @param {object} deps
 * @param {object} deps.store  the device store
 * @param {object} deps.channels  push/channels.js createChannels: whether Web Push is up, for the device list
 * @param {object} [deps.testPush]  push/testPush.js createTestPush (the test push and its outcome)
 * @param {object} [deps.sender]    the outbox's sender (stalled)
 */
export function createPushRoutes({ store, channels, testPush = null, sender = null }) {
  const router = Router();

  // GET /devices — Settings → Notifications' list (#320): no token, ever.
  router.get('/devices', (req, res) => {
    const stalled = channels.isPushEnabled() ? (sender?.stalled?.() ?? null) : null;
    res.set('Cache-Control', 'no-store');
    res.json({
      enabled: channels.isPushEnabled(),
      channels: channels.status(),
      stalled: stalled
        ? { since: new Date(stalled.since).toISOString(), sentence: sendFailureWords(stalled.code) }
        : null,
      defaults: DEFAULT_PREFS,
      devices: deviceList(store.getDevices()),
      test: testPush?.last() ?? null,
      cooldownS: TEST_PUSH_COOLDOWN_MS / 1000,
    });
  });

  // DELETE /devices/:id — remove one device by its fingerprint (#320).
  router.delete('/devices/:id', (req, res) => {
    if (!store.removeDevice(req.params.id)) {
      return apiError(res, 404, 'No registered phone has that id; reload the list');
    }
    return res.json({ removed: true });
  });

  // POST /test — a test push to one device ({ device }) or every device (#320).
  router.post('/test', (req, res) => {
    const device = (req.body || {}).device ?? null;
    if (device !== null && typeof device !== 'string') {
      return apiError(res, 400, "device must be a phone's id from the list, or left out for every phone");
    }
    if (!testPush) return apiError(res, 503, 'Test push is not available');
    return respondTestPush(res, testPush.send(device));
  });

  return router;
}
