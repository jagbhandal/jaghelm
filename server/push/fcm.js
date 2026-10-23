/**
 * Firebase Cloud Messaging (FCM) push adapter for JagHelm mobile.
 *
 * Design constraints (Phase 4):
 *  - GRACEFUL DISABLE: with no service-account creds, the whole pipeline
 *    silently no-ops. initPush() never throws; isPushEnabled() returns false.
 *  - INJECTABLE SEAM: messagingFactory(serviceAccount) -> messaging is injected
 *    so unit tests never reach Google. The default factory is the FCM HTTP v1
 *    client (push/fcmHttp.js, #235), which checks the service account when it
 *    is built and makes no request until the first send.
 *  - buildMessage is PURE (no I/O, no clock) and independently testable.
 *  - SECRETS: never log service-account file contents, private_key, or any
 *    credential material. On init failure log only generic message + error type
 *    (and the client's reason, which names a field, never a value).
 */
import { readFileSync } from 'fs';

import { createLogger } from '../util/logger.js';
import { createFcmHttpClient, FcmError } from './fcmHttp.js';

// Module-level singleton: initPush runs once at boot; one FCM messaging instance per process.
let messaging = null;
// True from the moment usable creds were read until init fails: push is (or is about to
// be) live. Lets boot-time callers wait for the async factory instead of dropping events.
let configured = false;
let log = createLogger('push:fcm');

/**
 * Default messaging factory: the FCM HTTP v1 client, built synchronously, so
 * push is enabled as initPush returns. It throws on a service account it can't
 * use (initPush then leaves push disabled). Tests inject their own.
 */
function defaultMessagingFactory(serviceAccount) {
  return createFcmHttpClient(serviceAccount, { logger: log });
}

/**
 * Resolve the service-account creds path from explicit arg or env.
 * @param {string|undefined} credsPath
 * @param {object} env
 * @returns {string|null}
 */
function resolveCredsPath(credsPath, env) {
  return (
    credsPath ||
    env.FCM_SERVICE_ACCOUNT ||
    env.GOOGLE_APPLICATION_CREDENTIALS ||
    null
  );
}

/**
 * Initialize push. NEVER throws — on any missing/unreadable/invalid creds the
 * module stays disabled and logs. messagingFactory is sync-or-async. The
 * default one is sync, so with valid creds push is enabled when initPush
 * returns. An async factory's messaging is assigned in a .then() initPush does
 * not await: until it resolves isPushEnabled() is false and isPushConfigured()
 * true (firebase-admin's factory was async, and the first cycles could no-op).
 *
 * @param {object} [opts]
 * @param {string} [opts.credsPath]
 * @param {object} [opts.env]
 * @param {function} [opts.messagingFactory]
 * @param {object} [opts.logger]
 */
export function initPush({
  credsPath,
  env = process.env,
  messagingFactory = defaultMessagingFactory,
  logger,
} = {}) {
  if (logger) log = logger;
  messaging = null;
  configured = false;

  const path = resolveCredsPath(credsPath, env);
  if (!path) {
    log.info('push disabled: no FCM service-account creds configured');
    return;
  }

  let serviceAccount;
  try {
    const raw = readFileSync(path, 'utf8');
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    // Log only error type — never file contents or key material.
    log.warn({ errType: err && err.constructor && err.constructor.name }, 'push disabled: FCM creds unreadable or invalid JSON');
    return;
  }

  configured = true;
  try {
    const built = messagingFactory(serviceAccount);
    // Injected sync factories return messaging directly; the default async
    // factory returns a promise we resolve and assign when ready.
    if (built && typeof built.then === 'function') {
      built
        .then((m) => {
          if (m && typeof m.send === 'function') {
            messaging = m;
            log.info('push enabled: FCM messaging initialized');
          } else {
            configured = false;
            log.warn('push disabled: messaging factory returned no usable messaging');
          }
        })
        .catch((err) => {
          messaging = null;
          configured = false;
          log.warn({ errType: err && err.constructor && err.constructor.name }, 'push disabled: messaging factory rejected');
        });
    } else {
      if (built && typeof built.send === 'function') {
        messaging = built;
        log.info('push enabled: FCM messaging initialized');
      } else {
        configured = false;
        log.warn('push disabled: messaging factory returned no usable messaging');
      }
    }
  } catch (err) {
    messaging = null;
    configured = false;
    // `reason` is the client's own text for an unusable service account (which
    // field), never anything read from the file.
    const fields = { errType: err && err.constructor && err.constructor.name };
    if (err instanceof FcmError && typeof err.reason === 'string') fields.reason = err.reason;
    log.warn(fields, 'push disabled: messaging factory threw');
  }
}

/** @returns {boolean} whether push delivery is live (messaging built). */
export function isPushEnabled() {
  return messaging != null;
}

/**
 * @returns {boolean} whether push is set up to come up: usable creds were read and the
 * messaging factory has not failed. While true and isPushEnabled() is still false, the
 * async factory is in flight (the boot race noted on initPush).
 */
export function isPushConfigured() {
  return configured;
}

/**
 * Build the FCM message payload for an event. PURE: no I/O, no clock, no
 * module state. `data` fields are strings per FCM's data-message contract and
 * carry ONLY type/id/node/severity (no title/body/prev/next).
 * @param {string} token
 * @param {{type:string,id:string,node:string,title:string,body:string,severity:string}} event
 * @returns {object}
 */
export function buildMessage(token, event) {
  return {
    token,
    notification: { title: event.title, body: event.body },
    data: {
      type: String(event.type),
      id: String(event.id),
      node: String(event.node),
      severity: String(event.severity),
    },
    android: {
      priority: event.severity === 'critical' ? 'high' : 'normal',
      notification: { channelId: 'jaghelm-incidents' },
    },
  };
}

// FCM error codes that always mean the token is permanently dead.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered', // v1 UNREGISTERED / NOT_FOUND
  'messaging/invalid-registration-token', // legacy InvalidRegistration
]);
const INVALID_ARGUMENT = 'messaging/invalid-argument';

/**
 * Whether a send error means the token is dead and should be pruned. v1 answers a
 * malformed token with INVALID_ARGUMENT, the same code as a bad payload (too big, bad
 * data, bad TTL), and a non-JSON 400 maps to it too (fcmHttp.js, as firebase-admin
 * did): so an invalid-argument prunes only when FCM's message names the registration
 * token. Everything else (payload, network, quota, internal) keeps the token.
 */
function isDeadToken(err) {
  const code = err && err.code;
  if (DEAD_TOKEN_CODES.has(code)) return true;
  return code === INVALID_ARGUMENT && /registration token/i.test(String(err.message ?? ''));
}

/**
 * Send one event to one token. NEVER throws — classifies the outcome:
 *  - resolve                 => { ok: true,  prune: false }
 *  - reject, token dead      => { ok: false, prune: true, error }
 *  - reject (anything else)  => { ok: false, prune: false, error }
 *  - push disabled           => { ok: false, prune: false }
 * @param {string} token
 * @param {object} event
 * @returns {Promise<{ok:boolean, prune:boolean, error?:string}>}
 */
export async function sendToToken(token, event) {
  if (messaging == null) return { ok: false, prune: false };
  try {
    await messaging.send(buildMessage(token, event));
    return { ok: true, prune: false };
  } catch (err) {
    const code = err && err.code;
    const prune = isDeadToken(err);
    const fields = { token: String(token).slice(0, 12), code, prune };
    // A kept invalid-argument is a payload problem: log FCM's reason, truncated.
    if (code === INVALID_ARGUMENT && !prune) fields.message = String(err.message ?? '').slice(0, 200);
    log.warn(fields, 'fcm send failed');
    return { ok: false, prune, error: code };
  }
}
