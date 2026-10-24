/**
 * Smarter alerts' routes (#669).
 *
 * The notification's buttons, from the service worker (NOT behind the
 * session: the worker cannot read the page's token, which lives in
 * localStorage). The browser's own push subscription endpoint is the proof:
 * a capability only that browser and this server hold, kept in the
 * subscription store and compared there in constant time. An unknown
 * endpoint answers 404 and changes nothing. 60 failed lookups a minute from one address are refused
 * (valid ones are never counted), so junk cannot lock out the real buttons.
 *
 *   POST /api/push/web/alert-action
 *        { endpoint, action: "ack" | "snooze", keys: [tag, ...], minutes? }
 *        → { ok: true, applied, ignored, until? }
 *        ack acks the open incidents among `keys` (a tag whose incident has
 *        recovered is ignored); snooze silences the tags for `minutes`
 *        (1 to 1440, default 60). At most 50 keys.
 *
 * Settings → Notifications (behind the session, mounted at /api/push/alerts):
 *
 *   GET  /api/push/alerts        → { held, snoozed: [{ tag, until }],
 *                                   acked: [{ tag, since }] }: what is held
 *                                   back now for the quiet hours or a
 *                                   burst's window, and what Snooze and Ack
 *                                   have silenced
 *   POST /api/push/alerts/clear  { tag } → { cleared }: lifts a snooze and an ack
 */
import { Router } from 'express';

import { apiError } from '../errors.js';
import { createLogger } from '../util/logger.js';

const defaultLog = createLogger('push-alerts');

const MAX_KEYS = 50;
const KEY_MAX = 200;
const LIMIT_PER_MINUTE = 60;

/** @param {unknown} keys */
function readKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS) return null;
  if (!keys.every((k) => typeof k === 'string' && k !== '' && k.length <= KEY_MAX)) return null;
  return /** @type {string[]} */ (keys);
}

/**
 * @param {object} deps
 * @param {{ idOfEndpoint: (endpoint: unknown) => string | null }} deps.webStore
 * @param {{ state: ReturnType<typeof import('../push/alertState.js').createAlertState>, flush: () => void }} deps.policy
 * @param {() => number} [deps.now]
 * @param {{ info: Function }} [deps.logger]
 */
export function createAlertActionRoute({
  webStore,
  policy,
  now = () => Date.now(),
  logger = defaultLog,
}) {
  const router = Router();
  /** @type {Map<string, { start: number, count: number }>} failed lookups by address */
  const failures = new Map();
  router.post('/', (req, res) => {
    const at = now();
    const from = String(req.ip ?? '');
    const seen = failures.get(from);
    if (seen && at - seen.start >= 60_000) failures.delete(from);
    // Only a lookup that fails counts, per address, so junk from one place cannot
    // lock out the real buttons of a phone that knows its endpoint.
    if ((failures.get(from)?.count ?? 0) >= LIMIT_PER_MINUTE) {
      res.set('Retry-After', '60');
      return apiError(res, 429, 'Too many failed alert actions; try again in a minute');
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const id = webStore.idOfEndpoint(body.endpoint);
    if (id === null) {
      const entry = failures.get(from) ?? { start: at, count: 0 };
      entry.count += 1;
      failures.set(from, entry);
      if (failures.size > 1000) failures.delete(failures.keys().next().value);
      return apiError(res, 404, 'No browser has that subscription');
    }
    const keys = readKeys(body.keys);
    if (!keys) return apiError(res, 400, `keys must be 1 to ${MAX_KEYS} alert tags`);
    if (body.action === 'ack') {
      const result = policy.state.ack(keys);
      policy.flush();
      logger.info(
        { device: id, acked: result.applied.length, ignored: result.ignored.length },
        'alerts acked from a notification'
      );
      return res.json({ ok: true, ...result });
    }
    if (body.action === 'snooze') {
      const minutes = body.minutes === undefined ? 60 : body.minutes;
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
        return apiError(res, 400, 'minutes must be 1 to 1440');
      }
      const { until } = policy.state.snooze(keys, Math.round(minutes) * 60_000);
      policy.flush();
      logger.info(
        { device: id, snoozed: keys.length, minutes },
        'alerts snoozed from a notification'
      );
      return res.json({ ok: true, applied: keys, ignored: [], until });
    }
    return apiError(res, 400, 'action must be ack or snooze');
  });
  return router;
}

/**
 * @param {object} deps
 * @param {{ state: ReturnType<typeof import('../push/alertState.js').createAlertState>, flush: () => void, plan: (entries: any[]) => Array<{ ready: boolean, entries: any[] }> }} deps.policy
 * @param {() => any[]} deps.entries  the outbox's queued entries
 */
export function createAlertsRoutes({ policy, entries }) {
  const router = Router();
  router.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const held = policy
      .plan(entries())
      .filter((unit) => !unit.ready)
      .reduce((n, unit) => n + unit.entries.length, 0);
    res.json({ held, ...policy.state.view() });
  });
  router.post('/clear', (req, res) => {
    const tag = req.body && typeof req.body === 'object' ? req.body.tag : null;
    if (typeof tag !== 'string' || tag === '' || tag.length > KEY_MAX) {
      return apiError(res, 400, 'tag required: an alert tag from the list');
    }
    const cleared = policy.state.clear(tag);
    policy.flush();
    res.json({ cleared });
  });
  return router;
}
