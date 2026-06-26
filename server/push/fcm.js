/**
 * Firebase Cloud Messaging (FCM) push adapter for JagHelm mobile.
 *
 * Design constraints (Phase 4):
 *  - GRACEFUL DISABLE: with no service-account creds, the whole pipeline
 *    silently no-ops. initPush() never throws; isPushEnabled() returns false.
 *  - INJECTABLE SEAM: messagingFactory(serviceAccount) -> messaging is injected
 *    so unit tests NEVER load firebase-admin. The default factory lazy-imports
 *    firebase-admin (getMessaging) and is only reached when valid creds exist.
 *  - buildMessage is PURE (no I/O, no clock) and independently testable.
 *  - SECRETS: never log service-account file contents, private_key, or any
 *    credential material. On init failure log only generic message + error type.
 */
import { readFileSync } from 'fs';

import { createLogger } from '../util/logger.js';

// Module-level singleton: initPush runs once at boot; one FCM messaging instance per process.
let messaging = null;
let log = createLogger('push:fcm');

/**
 * Default messaging factory. Lazy-imports firebase-admin ONLY when valid creds
 * exist, so the graceful-disable path (and all unit tests) never touch the dep.
 * Tests inject their own messagingFactory and never reach this.
 */
async function defaultMessagingFactory(serviceAccount) {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getMessaging } = await import('firebase-admin/messaging');
  const app = initializeApp({ credential: cert(serviceAccount) });
  return getMessaging(app);
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
 * module stays disabled and logs. messagingFactory is sync-or-async; when the
 * default async firebase-admin factory is used, initPush resolves messaging
 * eagerly but tolerates a non-promise return from injected sync factories.
 *
 * NOTE (production race, acceptable): the default messagingFactory is ASYNC and
 * initPush assigns `messaging` in a .then() it does not await. So with valid
 * creds, isPushEnabled() can briefly be false between initPush() returning and
 * the promise resolving — the first refresh cycle(s) may no-op. This SELF-HEALS
 * on the next 30s cycle and never affects tests (which inject SYNC factories).
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
            log.warn('push disabled: messaging factory returned no usable messaging');
          }
        })
        .catch((err) => {
          messaging = null;
          log.warn({ errType: err && err.constructor && err.constructor.name }, 'push disabled: messaging factory rejected');
        });
    } else {
      if (built && typeof built.send === 'function') {
        messaging = built;
        log.info('push enabled: FCM messaging initialized');
      } else {
        log.warn('push disabled: messaging factory returned no usable messaging');
      }
    }
  } catch (err) {
    messaging = null;
    log.warn({ errType: err && err.constructor && err.constructor.name }, 'push disabled: messaging factory threw');
  }
}

/** @returns {boolean} whether push delivery is live (messaging built). */
export function isPushEnabled() {
  return messaging != null;
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

// FCM error codes that mean the token is permanently dead and should be
// pruned from the store. Everything else (network/quota/internal) is transient.
const PRUNE_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

/**
 * Send one event to one token. NEVER throws — classifies the outcome:
 *  - resolve              => { ok: true,  prune: false }
 *  - reject + prune code  => { ok: false, prune: true, error }
 *  - reject (transient)   => { ok: false, prune: false, error }
 *  - push disabled        => { ok: false, prune: false }
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
    const prune = PRUNE_CODES.has(err && err.code);
    log.warn(
      { token: String(token).slice(0, 12), code: err && err.code, prune },
      'fcm send failed',
    );
    return { ok: false, prune, error: err && err.message };
  }
}
