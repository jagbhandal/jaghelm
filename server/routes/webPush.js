/**
 * Web Push subscriptions (#653): the installed dashboard's alerts. All behind
 * authMiddleware (server/index.js mounts them at /api/push/web); no route
 * answers without a signed-in session.
 *
 *   GET    /api/push/web/key                → { enabled, publicKey } or
 *                                             { enabled: false, reason }:
 *                                             what the page needs to subscribe, or
 *                                             that the server has no (usable) VAPID
 *                                             keys. Never the private key.
 *   GET    /api/push/web/subscriptions      → { enabled, subscriptions: [{ id,
 *                                             name, createdAt, lastSeen }] }
 *   POST   /api/push/web/subscriptions      → { subscription: { endpoint, keys:
 *                                             { p256dh, auth } }, name? }: add
 *                                             or refresh (idempotent per endpoint);
 *                                             201 new, 200 refreshed, { id, name }.
 *                                             400 for a subscription that is not
 *                                             one or whose endpoint is not an
 *                                             allowed push service; 409 with Web
 *                                             Push off or 20 browsers kept
 *   DELETE /api/push/web/subscriptions/:id  → remove one; 404 for none
 *   POST   /api/push/web/test               → { id }: a test alert to that
 *                                             browser, through the outbox like
 *                                             POST /api/push/test (202 with the
 *                                             test push's view; the same refusals)
 *
 * The endpoint URL and the keys are capabilities: they are read from the body
 * once, checked, stored, and appear in no response, no log line and no error
 * message. A subscription is its `id` (webPushStore.js subscriptionId).
 */

import { Router } from 'express';
import { apiError } from '../errors.js';
import { checkEndpoint } from '../push/pushEndpoint.js';
import { checkKeys } from '../push/webPushStore.js';
import { createLogger } from '../util/logger.js';
import { respondTestPush } from './push.js';

const defaultLog = createLogger('push-web-routes');

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('../push/webPushStore.js').createWebPushStore>} deps.webStore
 * @param {() => ({ enabled: true, publicKey: string } | { enabled: false, reason: string })} deps.status
 * @param {object} [deps.testPush]  push/testPush.js createTestPush
 * @param {{ info: Function }} [deps.logger]
 */
export function createWebPushRoutes({ webStore, status, testPush = null, logger = defaultLog }) {
  const router = Router();

  router.get('/key', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(status());
  });

  router.get('/subscriptions', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: status().enabled, subscriptions: webStore.list() });
  });

  router.post('/subscriptions', (req, res) => {
    if (!status().enabled) {
      return apiError(res, 409, 'Web Push is off on this server: the VAPID keys are not set up');
    }
    const body = req.body;
    const sub = body && typeof body === 'object' ? body.subscription : null;
    if (!sub || typeof sub !== 'object' || Array.isArray(sub)) {
      return apiError(res, 400, 'subscription required: the browser’s PushSubscription as JSON');
    }
    const endpoint = checkEndpoint(sub.endpoint);
    if (!endpoint.ok) return apiError(res, 400, endpoint.reason);
    const keys = checkKeys(sub.keys);
    if (!keys.ok) return apiError(res, 400, keys.reason);
    if (body.name !== undefined && typeof body.name !== 'string') {
      return apiError(res, 400, 'name must be text');
    }
    const result = webStore.register({
      endpoint: sub.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      name: body.name,
    });
    if (!result.ok) return apiError(res, 409, result.reason);
    logger.info({ id: result.id, created: result.created }, 'web push subscription registered');
    return res
      .status(result.created ? 201 : 200)
      .json({ id: result.id, name: result.name, created: result.created });
  });

  router.delete('/subscriptions/:id', (req, res) => {
    if (!webStore.removeById(req.params.id)) {
      return apiError(res, 404, 'No browser has that id; reload the list');
    }
    logger.info({ id: req.params.id }, 'web push subscription removed');
    return res.json({ removed: true });
  });

  router.post('/test', (req, res) => {
    const id = (req.body || {}).id;
    if (typeof id !== 'string' || id === '') {
      return apiError(res, 400, 'id required: a browser’s id from the list');
    }
    if (!testPush) return apiError(res, 503, 'Test push is not available');
    return respondTestPush(res, testPush.send(id));
  });

  return router;
}
