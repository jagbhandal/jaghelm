// @ts-check
/**
 * The Web Push sender (#653): what puts an alert on the installed dashboard
 * (the PWA). It plugs into the outbox through push/channels.js:
 * `sendToToken(token, event)` for a subscription's pseudo token (`wp:<id>`),
 * answering { ok, prune, retry, allPhones, error }, which the outbox's retries,
 * backoff, pruning and test-push follow-up read.
 *
 * Wire (RFC 8030 push, RFC 8291 encryption, RFC 8292 VAPID; push/webPushCrypto.js):
 * POST <endpoint> with `Content-Encoding: aes128gcm`, the VAPID `Authorization`,
 * `TTL` and `Urgency: high` for a critical state (and a test push, which must
 * wake a sleeping phone), `normal` for the rest. The answer:
 *
 *   201 (any 2xx)  accepted
 *   404, 410       the subscription is gone: pruned
 *   429, 5xx       the push service failing or limiting: retried later, for
 *                  this browser only (the outbox's backoff)
 *   no answer      timeout or network failure: retried the same way, for this
 *                  browser only (other push services are unaffected)
 *   a redirect     refused, not followed (an allowlisted host must not lead the
 *                  server elsewhere), never retried
 *   other 4xx      never retried: 400, 413 the message's, 401 and 403 the VAPID
 *                  key's or subject's (the push service refuses JagHelm itself)
 *
 * The endpoint and keys never reach a log line or an error: only a code and
 * the subscription's id (a hash prefix) do. The sender never throws.
 *
 * Web Push is OFF unless a matching VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are
 * set (or, with both unset, the pair JagHelm made itself, vapidStore.js, #698)
 * and fit (readVapid). VAPID_SUBJECT is optional (DEFAULT_VAPID_SUBJECT).
 */
import { envValue } from '../env.js';
import { createLogger } from '../util/logger.js';
import { driveOf, entityOf } from './entity.js';
import { TEST_PUSH, alertKey, alertKind } from './dispatch.js';
import { checkEndpoint } from './pushEndpoint.js';
import { deviceIdOf } from './prefs.js';
import {
  encrypt,
  fromBase64url,
  isUncompressedPoint,
  privateKeyOf,
  toBase64url,
  vapidAuthorization,
} from './webPushCrypto.js';

const defaultLog = createLogger('push-web');

/** The contact in the VAPID token when VAPID_SUBJECT is unset: the project's page (an https: subject push services accept). */
export const DEFAULT_VAPID_SUBJECT = 'https://github.com/jagbhandal/jaghelm';

/** How long the push service gets to answer. */
export const SEND_TIMEOUT_MS = 10_000;

/** Seconds the push service keeps an undelivered message: a page is worth a day, news an hour. */
export const TTL_CRITICAL_S = 24 * 60 * 60;
export const TTL_OTHER_S = 60 * 60;

const COPY_TITLE = 80;
const COPY_BODY = 140;

/**
 * @typedef {object} Vapid
 * @property {true} enabled
 * @property {string} publicKey  base64url of the 65 byte point (also the browser's applicationServerKey)
 * @property {import('node:crypto').KeyObject} privateKey
 * @property {string} subject
 */

/**
 * The VAPID settings from the environment, checked: off with the reason
 * (`unset`: neither key; `incomplete`: one of them; `invalid`: they do not fit,
 * or the private key is not the public key's pair), else the keys. An unset
 * subject is DEFAULT_VAPID_SUBJECT; a set one that is no mailto:/https: is invalid. Reasons say
 * which variable, never a value.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Vapid | { enabled: false, reason: 'unset' | 'incomplete' | 'invalid', detail?: string }}
 */
export function readVapid(env) {
  const pub = envValue('VAPID_PUBLIC_KEY', env);
  const priv = envValue('VAPID_PRIVATE_KEY', env);
  const subject = envValue('VAPID_SUBJECT', env) || DEFAULT_VAPID_SUBJECT;
  const missing = [
    ['VAPID_PUBLIC_KEY', pub],
    ['VAPID_PRIVATE_KEY', priv],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length === 2) return { enabled: false, reason: 'unset' };
  // Names only, never a value.
  if (missing.length > 0) return { enabled: false, reason: 'incomplete', detail: `not set: ${missing.join(', ')}` };
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+[^\s]*)$/.test(subject)) {
    return { enabled: false, reason: 'invalid', detail: 'VAPID_SUBJECT must be a mailto: or https: address' };
  }
  try {
    const point = fromBase64url(pub);
    const scalar = fromBase64url(priv);
    if (!isUncompressedPoint(point) || scalar.length !== 32) throw new Error('size');
    const privateKey = privateKeyOf(scalar, point); // throws when the point is not the scalar's
    // createPrivateKey with a mismatched x,y is accepted by some builds: derive and compare.
    const derived = /** @type {any} */ (privateKey.export({ format: 'jwk' }));
    if (derived.x !== toBase64url(point.subarray(1, 33)) || derived.y !== toBase64url(point.subarray(33, 65))) {
      throw new Error('mismatch');
    }
    return { enabled: true, publicKey: toBase64url(point), privateKey, subject };
  } catch {
    return {
      enabled: false,
      reason: 'invalid',
      detail: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not a valid pair (unset both and JagHelm makes its own, or make a pair with scripts/vapid-keys.mjs)',
    };
  }
}

/**
 * What the notification says, from an event: small, and fit for a lock screen:
 * the state (title), the thing it is about (body: the service or host, never
 * its reason or addresses) and where a tap goes. Pure.
 *
 *   v         payload version, 1
 *   title     "Service down", "Host cpu critical"
 *   body      "Jellyfin on apps", the part of the event's line before its reason
 *   tag       one notification per thing: its entity, so a repeat or a recovery replaces it
 *   url       a relative path, `/?entity=<model id>` (the dashboard's deep link; a
 *             drive's alert adds `&drive=<device>`) or `/`
 *   severity  critical | warning | info
 *   type      the event's type
 *   actions   (#669) true when the notification has Snooze and Ack: a page
 *             does (and a summary of some); a recovery, a test push and news
 *             do not, and carry neither this nor `keys`
 *   keys      (#669) with `actions`, the keys they apply to: the alert's episode
 *             (dispatch.js alertKey), or each of a summary's members (at most 50)
 *
 * A known cause (`event.cause`, a label from Settings) follows the subject in
 * the body, after a " · ", as the label alone: it is the owner's own text.
 *
 * @param {{ type?: unknown, id?: unknown, title?: unknown, body?: unknown, severity?: unknown }} event
 */
export function buildWebPayload(event) {
  const entity = entityOf(/** @type {any} */ (event));
  // A drive's alert opens its node with that drive highlighted (#728).
  const drive = entity ? driveOf(/** @type {any} */ (event)) : null;
  const e = /** @type {any} */ (event);
  const type = String(event.type ?? '');
  // A summary (#669) stands for several alerts: its body is already its own text.
  const summary = Array.isArray(e.members);
  const subject = summary ? String(event.body ?? '') : String(event.body ?? '').split(' · ')[0];
  const cause = typeof e.cause === 'string' && e.cause !== '' ? e.cause : null;
  const text = cause && !summary ? `${subject} · ${cause}` : subject;
  const tag =
    type === TEST_PUSH
      ? TEST_PUSH
      : summary
        ? `${type}:${String(event.id ?? '')}`
        : (entity ?? `${type}:${String(event.id ?? '')}`).slice(0, 200);
  const keys = summary ? e.members.filter((/** @type {unknown} */ k) => typeof k === 'string').slice(0, 50) : [alertKey(e)];
  const actions = type !== TEST_PUSH && (summary ? e.actionable !== false : alertKind(e) === 'page');
  return {
    v: 1,
    title: String(event.title ?? 'JagHelm').slice(0, COPY_TITLE),
    body: text.slice(0, COPY_BODY),
    tag,
    url: summary
      ? '/alerts'
      : entity
        ? `/?entity=${encodeURIComponent(entity).replace(/%2F/g, '/').replace(/%3A/g, ':')}${drive ? `&drive=${encodeURIComponent(drive)}` : ''}`
        : '/',
    severity: ['critical', 'warning', 'info'].includes(String(event.severity)) ? String(event.severity) : 'info',
    type,
    ...(actions ? { keys, actions: true } : {}),
  };
}

/**
 * The push service's delivery options: a critical state, and a test push,
 * go with `Urgency: high` (a phone in Doze gets them at once) and a day's
 * TTL for a page; the rest `normal` with an hour. Pure.
 * @param {{ type?: unknown, severity?: unknown }} event
 * @returns {{ urgency: 'high' | 'normal', ttl: number }}
 */
export function deliveryOptions(event) {
  const critical = event.severity === 'critical';
  const urgent = critical || event.type === TEST_PUSH;
  return { urgency: urgent ? 'high' : 'normal', ttl: critical ? TTL_CRITICAL_S : TTL_OTHER_S };
}

const shortOutcome = (/** @type {string} */ error, extra = {}) => ({
  ok: false,
  prune: false,
  retry: false,
  allPhones: false,
  error,
  ...extra,
});

/**
 * @param {object} deps
 * @param {Vapid | { enabled: false, reason: string }} deps.vapid  readVapid()'s answer
 * @param {{ subscriptionOf: (token: string) => ({ endpoint: string, p256dh: string, auth: string } | null) }} deps.store
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @param {number} [deps.timeoutMs]
 * @param {{ warn: Function, info: Function }} [deps.logger]
 */
export function createWebPushSender({
  vapid,
  store,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  timeoutMs = SEND_TIMEOUT_MS,
  logger = defaultLog,
}) {
  /**
   * Send `event` to the subscription behind `token`. Never throws.
   * @param {string} token
   * @param {object} event
   */
  async function sendToToken(token, event) {
    const device = deviceIdOf(token);
    /** @param {Record<string, unknown>} fields @param {string} msg */
    const warn = (fields, msg) => logger.warn({ device, ...fields }, msg);
    try {
      if (!vapid.enabled) return shortOutcome('webpush/disabled');
      const sub = store.subscriptionOf(token);
      if (!sub) return shortOutcome('webpush/removed');
      const checked = checkEndpoint(sub.endpoint);
      if (!checked.ok) {
        warn({ code: 'webpush/endpoint-refused' }, 'web push subscription removed: its endpoint is not an allowed push service');
        return shortOutcome('webpush/endpoint-refused', { prune: true });
      }

      let body;
      try {
        body = encrypt(
          Buffer.from(JSON.stringify(buildWebPayload(/** @type {any} */ (event)))),
          { p256dh: fromBase64url(sub.p256dh), auth: fromBase64url(sub.auth) }
        );
      } catch {
        warn({ code: 'webpush/encrypt-failed' }, 'web push message could not be encrypted');
        return shortOutcome('webpush/encrypt-failed');
      }

      const { urgency, ttl } = deliveryOptions(/** @type {any} */ (event));
      const headers = {
        Authorization: vapidAuthorization({
          audience: checked.url.origin,
          subject: vapid.subject,
          publicKey: vapid.publicKey,
          privateKey: vapid.privateKey,
          now: now(),
        }),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
      };

      let res;
      try {
        res = await fetchImpl(checked.url.href, {
          method: 'POST',
          headers,
          body: new Uint8Array(body),
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // Not the error itself: undici's text can name the URL.
        const name = /** @type {any} */ (err)?.name;
        const code = name === 'TimeoutError' || name === 'AbortError' ? 'webpush/network-timeout' : 'webpush/network-error';
        warn({ code }, 'web push not sent: the push service did not answer');
        return shortOutcome(code, { retry: true });
      }
      // The answer's body is never read: a hostile service could make it huge.
      await res.body?.cancel().catch(() => {});

      const status = res.status;
      if (status >= 200 && status < 300) return { ok: true, prune: false };
      if (status === 404 || status === 410) {
        warn({ status, code: 'webpush/gone' }, 'web push subscription is gone, removing it');
        return shortOutcome('webpush/gone', { prune: true });
      }
      if (status === 429 || status >= 500) {
        const code = status === 429 ? 'webpush/rate-limited' : 'webpush/server-error';
        warn({ status, code }, 'web push not sent: the push service is failing, trying again later');
        return shortOutcome(code, { retry: true });
      }
      const code =
        status >= 300 && status < 400
          ? 'webpush/redirect'
          : status === 401 || status === 403
            ? 'webpush/rejected'
            : status === 413
              ? 'webpush/too-large'
              : 'webpush/bad-request';
      warn({ status, code }, 'web push refused by the push service');
      return shortOutcome(code);
    } catch {
      // Nothing is logged from the error: it could hold a subscription.
      warn({ code: 'thrown' }, 'web push send failed inside JagHelm');
      return shortOutcome('thrown');
    }
  }

  return {
    isEnabled: () => vapid.enabled === true,
    publicKey: () => (vapid.enabled ? vapid.publicKey : null),
    sendToToken,
  };
}
