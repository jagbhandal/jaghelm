/**
 * FCM HTTP v1 client (#235): what JagHelm used firebase-admin for, without its
 * dependency tree. It is the `messaging` that push/fcm.js's messagingFactory
 * builds, so fcm.js, dispatch.js and the token store see the same `send` and
 * the same errors as before.
 *
 *   service account -> RS256 JWT (node:crypto) -> oauth2.googleapis.com/token
 *   -> access token (cached until 5 min before it expires, one exchange at a
 *   time) -> POST fcm.googleapis.com/v1/projects/{project_id}/messages:send
 *
 * Kept as firebase-admin had it, and pinned by the bodies, token request and
 * errors captured from it (fixtures/fcm-wire-golden.json):
 *  - The wire body. buildMessage's message is converted as firebase-admin's
 *    validateMessage did (android.notification.channelId -> channel_id), field
 *    by field: a field this client doesn't know is refused before any request,
 *    never guessed at.
 *  - The error codes (`messaging/...`, `app/...`) and FCM's own message, so
 *    fcm.js prunes on exactly what it pruned on.
 *  - The retries: a 503, a dropped connection or a stalled one (a connect, an
 *    answer that never starts or never ends, the 15 s timeout) is tried up to
 *    4 more times, 0, 1, 2 and 4 s apart (or after Retry-After, up to a
 *    minute); the token exchange 3 more times, also on 408, 429 and 5xx.
 *  - The JWT: header { alg: RS256 }; claims iss, scope, aud, exp, iat (no sub).
 * Changed: the scope is FCM's alone (firebase-admin asked for five, among them
 * cloud-platform); a 401 drops the token and retries once with a new one; every
 * request times out after 15 s; a token exchange Google never answered is
 * app/network-* (firebase-admin called every failed exchange
 * app/invalid-credential); and the raw body of an answer FCM or Google gives is
 * never quoted in an error.
 *
 * Secrets: the private key is held as a KeyObject and only signs. The JWT and
 * the access token go only to their fixed Google URL (no redirect followed,
 * `token_uri` in the file is not used), and never into a log line or an
 * error: upstream text is scrubbed of both before it is kept.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createLogger } from '../util/logger.js';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_ORIGIN = 'https://fcm.googleapis.com';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const JWT_LIFETIME_S = 3600;
/** Exchange a new access token when the cached one has this long left (firebase-admin's margin). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
/** firebase-admin's retry policy for the send (utils/api-request.js defaultRetryConfig). */
const SEND_RETRY = { maxRetries: 4, retryOn: (status) => status === 503 };
/** The token exchange: google-auth-library (gaxios) retried 408, 429 and 5xx, 3 times. */
const TOKEN_RETRY = {
  maxRetries: 3,
  retryOn: (status) => status === 408 || status === 429 || (status >= 500 && status < 600),
};
const MAX_RETRY_DELAY_MS = 60_000;
/**
 * Stalls: firebase-admin's 15 s socket timeout turned a connect that never
 * completes (a black-holed address), an answer that never starts and one that
 * never ends into ETIMEDOUT, retried and reported as app/network-timeout.
 * undici names them apart.
 */
const TIMEOUT_IO_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
/** Retried as firebase-admin retried ECONNRESET and ETIMEDOUT; a refused connection or an unknown host is not. */
const RETRY_IO_CODES = new Set([...TIMEOUT_IO_CODES, 'ECONNRESET', 'UND_ERR_SOCKET']);
// Project IDs are lower-case letters, digits and hyphens; a legacy one has a
// domain prefix (example.com:project). Anything else would change the URL path.
const PROJECT_ID = /^[a-z][a-z0-9.:-]*$/i;

const defaultLog = createLogger('push:fcm-http');

/** An error with firebase-admin's code (`messaging/...`, `app/...`), so callers classify it as before. */
export class FcmError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, reason?: string }} [extra]
   */
  constructor(code, message, { status, reason } = {}) {
    super(message);
    this.name = 'FcmError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (reason !== undefined) this.reason = reason;
  }
}

// ─── the service account ─────────────────────────────────────────────────────

function credentialError(reason) {
  return new FcmError('app/invalid-credential', `FCM service account unusable: ${reason}`, {
    reason,
  });
}

const nonEmpty = (v) => typeof v === 'string' && v.length > 0;

/**
 * The three fields the client needs, checked once, at init. firebase-admin
 * read each from its camelCase key first, then the snake_case one Firebase's
 * download has, and checked that the key parses: so does this.
 * @param {unknown} sa
 * @returns {{ projectId: string, clientEmail: string, key: import('node:crypto').KeyObject }}
 */
function readServiceAccount(sa) {
  if (sa === null || typeof sa !== 'object' || Array.isArray(sa))
    throw credentialError('the service account is not a JSON object');
  const projectId = sa.projectId || sa.project_id;
  const clientEmail = sa.clientEmail || sa.client_email;
  const pem = sa.privateKey || sa.private_key;
  if (!nonEmpty(projectId)) throw credentialError('the service account has no project_id');
  if (!PROJECT_ID.test(projectId))
    throw credentialError('the service account project_id is not a project ID');
  if (!nonEmpty(clientEmail)) throw credentialError('the service account has no client_email');
  if (!nonEmpty(pem)) throw credentialError('the service account has no private_key');
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    // No cause: the key's own text is not ours to carry anywhere.
    throw credentialError('the service account private_key does not parse');
  }
  if (key.asymmetricKeyType !== 'rsa')
    throw credentialError('the service account private_key is not an RSA key');
  return { projectId, clientEmail, key };
}

/**
 * The signed JWT the token exchange presents (RFC 7523), as google-auth-library
 * built it, scoped to FCM.
 * @param {{ clientEmail: string, key: import('node:crypto').KeyObject }} account
 * @param {number} nowMs
 */
function signJwt({ clientEmail, key }, nowMs) {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: 'RS256' };
  const claims = {
    iss: clientEmail,
    scope: FCM_SCOPE,
    aud: TOKEN_URL,
    exp: iat + JWT_LIFETIME_S,
    iat,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${input}.${sign('sha256', Buffer.from(input), key).toString('base64url')}`;
}

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');

// ─── the wire message ────────────────────────────────────────────────────────

function payloadError(message) {
  return new FcmError('messaging/invalid-payload', message);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Copy `from`'s keys, in order, through `fields` (key -> [wire key, convert]); any other key is refused. */
function convert(from, fields, label) {
  if (!isObject(from)) throw payloadError(`${label} must be a non-null object`);
  const out = {};
  for (const [key, value] of Object.entries(from)) {
    if (value === undefined) continue; // JSON.stringify drops it, as it did for firebase-admin
    const field = fields[key];
    if (!field) throw payloadError(`${label}.${key} is not supported by this client`);
    const [wireKey, conv] = field;
    out[wireKey] = conv(value, `${label}.${key}`);
  }
  return out;
}

function string(value, label) {
  if (typeof value !== 'string') throw payloadError(`${label} must be a string`);
  return value;
}

function stringMap(value, label) {
  if (!isObject(value)) throw payloadError(`${label} must be a non-null object`);
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string')
      throw payloadError(`${label} must only contain string values (${k})`);
  }
  return { ...value };
}

const NOTIFICATION = { title: ['title', string], body: ['body', string] };
const ANDROID_NOTIFICATION = { channelId: ['channel_id', string] };
const ANDROID = {
  priority: ['priority', string],
  notification: ['notification', (v, label) => convert(v, ANDROID_NOTIFICATION, label)],
};
const MESSAGE = {
  token: ['token', string],
  notification: ['notification', (v, label) => convert(v, NOTIFICATION, label)],
  data: ['data', stringMap],
  android: ['android', (v, label) => convert(v, ANDROID, label)],
};

/**
 * buildMessage's message as FCM v1's JSON, the body firebase-admin sent for it
 * (fixtures/fcm-wire-golden.json). Only the fields JagHelm sends are known; any
 * other is refused with `messaging/invalid-payload`, which fcm.js never prunes on.
 * @param {object} message
 */
export function toWireMessage(message) {
  if (!isObject(message)) throw payloadError('Message must be a non-null object');
  if (!nonEmpty(message.token)) throw payloadError('message.token must be a non-empty string');
  return convert(message, MESSAGE, 'message');
}

// ─── FCM's errors, mapped as firebase-admin mapped them ──────────────────────

// messaging/error.js MESSAGING_SERVER_TO_CLIENT_CODE (firebase-admin 14.2.0).
const SERVER_TO_CLIENT = {
  InvalidParameters: 'invalid-argument',
  MismatchSenderId: 'mismatched-credential',
  Unavailable: 'server-unavailable',
  InternalServerError: 'internal-error',
  InvalidRegistration: 'invalid-registration-token',
  NotRegistered: 'registration-token-not-registered',
  InvalidPackageName: 'invalid-package-name',
  MessageTooBig: 'payload-size-limit-exceeded',
  InvalidDataKey: 'invalid-data-payload-key',
  InvalidTtl: 'invalid-options',
  DeviceMessageRateExceeded: 'device-message-rate-exceeded',
  TopicsMessageRateExceeded: 'topics-message-rate-exceeded',
  InvalidApnsCredential: 'third-party-auth-error',
  NOT_FOUND: 'registration-token-not-registered',
  PERMISSION_DENIED: 'mismatched-credential',
  RESOURCE_EXHAUSTED: 'message-rate-exceeded',
  UNAUTHENTICATED: 'third-party-auth-error',
  APNS_AUTH_ERROR: 'third-party-auth-error',
  INTERNAL: 'internal-error',
  INVALID_ARGUMENT: 'invalid-argument',
  QUOTA_EXCEEDED: 'message-rate-exceeded',
  SENDER_ID_MISMATCH: 'mismatched-credential',
  THIRD_PARTY_AUTH_ERROR: 'third-party-auth-error',
  UNAVAILABLE: 'server-unavailable',
  UNREGISTERED: 'registration-token-not-registered',
  UNSPECIFIED_ERROR: 'unknown-error',
};

// An answer that is not JSON, by HTTP status (createFirebaseError).
const NON_JSON = {
  400: 'invalid-argument',
  401: 'authentication-error',
  403: 'authentication-error',
  500: 'internal-error',
  503: 'server-unavailable',
};

/** The FCM error code an answer carries (messaging-errors-internal.js getErrorCode), or null. */
function serverErrorCode(body) {
  if (!isObject(body) || !('error' in body)) return null;
  const { error } = body;
  if (typeof error === 'string') return error;
  if (!isObject(error)) return null;
  if (Array.isArray(error.details)) {
    for (const d of error.details) {
      if (isObject(d) && d['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError')
        return d.errorCode;
    }
  }
  return 'status' in error ? error.status : error.message;
}

/**
 * The error for an FCM answer that is not a success: firebase-admin's code,
 * and FCM's own message (fcm.js reads it to tell a bad token from a bad
 * payload). A raw body is never quoted.
 */
function fcmAnswerError(res, scrub) {
  if (res.body !== undefined) {
    const server = serverErrorCode(res.body);
    const code = Object.hasOwn(SERVER_TO_CLIENT, server)
      ? SERVER_TO_CLIENT[server]
      : 'unknown-error';
    const message =
      isObject(res.body.error) && nonEmpty(res.body.error.message) ? res.body.error.message : null;
    const text = message ? scrub(message).slice(0, 1000) : `FCM answered HTTP ${res.status}.`;
    return new FcmError(
      `messaging/${code}`,
      code === 'unknown-error' ? `${text} HTTP status ${res.status}.` : text,
      { status: res.status }
    );
  }
  const code = NON_JSON[res.status] ?? 'unknown-error';
  return new FcmError(
    `messaging/${code}`,
    `FCM answered HTTP ${res.status} with a body that is not JSON.`,
    { status: res.status }
  );
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

/** A fetch that never got an answer: firebase-admin's app/network-timeout or app/network-error. */
function transportError(err, timeoutMs, scrub) {
  if (isTimeout(err))
    return new FcmError(
      'app/network-timeout',
      `Error while making request: timeout of ${timeoutMs}ms exceeded.`
    );
  const codes = ioCodes(err);
  const code = codes[0] ?? 'unknown';
  const why = scrub(String(err?.cause?.message || err?.message || 'no response')).slice(0, 200);
  return new FcmError(
    codes.some((c) => TIMEOUT_IO_CODES.has(c)) ? 'app/network-timeout' : 'app/network-error',
    `Error while making request: ${why}. Error code: ${code}`
  );
}

const isTimeout = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';

/**
 * The system or undici codes a fetch failure carries: its cause's (fetch wraps
 * them in "fetch failed"), its own, and each attempt's when the cause is an
 * AggregateError (one connect per address, Node's happy eyeballs).
 * @returns {string[]}
 */
function ioCodes(err) {
  const found = [err?.cause?.code, err?.code];
  for (const e of [err?.cause, err]) {
    if (Array.isArray(e?.errors)) found.push(...e.errors.map((x) => x?.code));
  }
  return found.filter((c) => typeof c === 'string');
}

const retryableIo = (err) => isTimeout(err) || ioCodes(err).some((c) => RETRY_IO_CODES.has(c));

/** How long to wait before retry `n` (0-based), or -1 for no retry (firebase-admin's getRetryDelayMillis). */
function retryDelay(n, retryAfter, now) {
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    const ms = Number.isNaN(seconds) ? Date.parse(retryAfter) - now : seconds * 1000;
    if (ms > 0) return ms <= MAX_RETRY_DELAY_MS ? ms : -1;
  }
  return n === 0 ? 0 : Math.min(2 ** n * 500, MAX_RETRY_DELAY_MS);
}

const defaultSleep = (ms) => delay(ms, undefined, { ref: false });

/**
 * @param {object} serviceAccount  the parsed service-account JSON
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @param {() => number} [opts.now]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {object} [opts.logger]
 * @param {number} [opts.timeoutMs]  each request's timeout
 * @returns {{ send: (message: object) => Promise<string> }}  throws FcmError
 */
export function createFcmHttpClient(
  serviceAccount,
  {
    fetch = globalThis.fetch,
    now = Date.now,
    sleep = defaultSleep,
    logger = defaultLog,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = {}
) {
  const account = readServiceAccount(serviceAccount);
  const sendUrl = `${FCM_ORIGIN}/v1/projects/${account.projectId}/messages:send`;

  /** @type {{ token: string, expiresAt: number } | null} */
  let cached = null;
  /** @type {Promise<string> | null} */
  let inflight = null;
  // Every value that must never be quoted: the assertion being exchanged and the
  // last few access tokens (a send still in flight can hold the one before).
  const secrets = new Set();
  const issued = [];
  const scrub = (text) => {
    let out = String(text);
    for (const s of secrets) out = out.split(s).join('[redacted]');
    return out
      .replace(/eyJ[\w-]*\.[\w-]+\.[\w-]+/g, '[redacted]')
      .replace(/ya29\.[\w.-]+/g, '[redacted]');
  };

  /** One request, retried per `policy`; resolves with { status, body (parsed JSON or undefined), retryAfter }. */
  async function request(url, init, policy) {
    for (let n = 0; ; n++) {
      let res;
      try {
        const r = await fetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await r.text();
        let body;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = undefined;
        }
        res = { status: r.status, body, retryAfter: r.headers.get('retry-after') };
      } catch (err) {
        const retryable = retryableIo(err);
        const wait = retryable && n < policy.maxRetries ? retryDelay(n, null, now()) : -1;
        if (wait < 0) throw transportError(err, timeoutMs, scrub);
        await sleep(wait);
        continue;
      }
      if (!policy.retryOn(res.status) || n >= policy.maxRetries) return res;
      const wait = retryDelay(n, res.retryAfter, now());
      if (wait < 0) return res;
      await sleep(wait);
    }
  }

  async function exchange() {
    const assertion = signJwt(account, now());
    secrets.add(assertion);
    try {
      let res;
      try {
        res = await request(
          TOKEN_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }).toString(),
          },
          TOKEN_RETRY
        );
      } catch (err) {
        // No answer from Google: a network failure (app/network-*, as for the
        // send), not a refused key. The reason is already scrubbed.
        logTokenFailure(0, err.message);
        throw err;
      }
      const b = res.body;
      if (
        res.status >= 200 &&
        res.status < 300 &&
        isObject(b) &&
        nonEmpty(b.access_token) &&
        Number.isFinite(b.expires_in)
      ) {
        secrets.add(b.access_token);
        return { token: b.access_token, expiresAt: now() + b.expires_in * 1000 };
      }
      throw tokenError(res.status, oauthReason(res));
    } finally {
      secrets.delete(assertion);
    }
  }

  /** Google's OAuth error and its description (RFC 6749 5.2), scrubbed and cut short; never the body. */
  function oauthReason(res) {
    const b = res.body;
    if (!isObject(b)) return `HTTP ${res.status}, an answer that is not JSON`;
    if (!nonEmpty(b.error)) return `HTTP ${res.status}, no access token in the answer`;
    const desc = nonEmpty(b.error_description) ? `: ${b.error_description}` : '';
    return scrub(`${b.error}${desc}`).slice(0, 200);
  }

  function logTokenFailure(status, reason) {
    logger.warn({ status, reason }, 'fcm access token request failed');
  }

  /** Google answered without a token: the code firebase-admin gave any failed exchange. */
  function tokenError(status, reason) {
    logTokenFailure(status, reason);
    return new FcmError(
      'app/invalid-credential',
      `Failed to fetch an FCM access token: ${reason}`,
      { status, reason }
    );
  }

  /** The cached access token, or one exchange shared by every caller waiting for it. */
  function accessToken() {
    if (cached && cached.expiresAt - now() > REFRESH_MARGIN_MS)
      return Promise.resolve(cached.token);
    if (!inflight) {
      inflight = exchange()
        .then((fresh) => {
          issued.push(fresh.token);
          if (issued.length > 3) secrets.delete(issued.shift());
          cached = fresh;
          return fresh.token;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  /** A 401 for `token`: forget it, unless a newer one already took its place. */
  function drop(token) {
    if (cached && cached.token === token) cached = null;
  }

  return {
    /**
     * Send one message (buildMessage's shape). Resolves with FCM's message name;
     * rejects with an FcmError carrying firebase-admin's code.
     * @param {object} message
     */
    async send(message) {
      const body = JSON.stringify({ message: toWireMessage(message) });
      for (let reauthorized = false; ; reauthorized = true) {
        const token = await accessToken();
        const res = await request(
          sendUrl,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json;charset=utf-8',
            },
            body,
          },
          SEND_RETRY
        );
        if (res.status === 401 && !reauthorized) {
          drop(token);
          continue;
        }
        if (
          res.status >= 200 &&
          res.status < 300 &&
          res.body !== undefined &&
          serverErrorCode(res.body) === null
        ) {
          return res.body.name;
        }
        throw fcmAnswerError(res, scrub);
      }
    },
  };
}
