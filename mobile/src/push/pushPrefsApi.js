/**
 * Thin client for the Phase-4 server push endpoints. Every call rides the shared
 * apiFetch transport (injects the x-auth-token SESSION header + applies native
 * HTTP) and builds URLs off getApiBase() (which ends in /api) so the auth guard
 * fires. The `token` in these bodies/queries is the FCM DEVICE token — unrelated
 * to the x-auth-token session token apiFetch injects.
 *
 * PUT /push/prefs is a STRICT full-replace: send the complete prefs object
 * (categories{service,host,ups,cron} + notifyRecoveries + enabled, all boolean),
 * no extra keys, or the server 400s 'malformed prefs'.
 */
import { apiFetch } from '@shared/api/client.js';
import { getApiBase } from '@shared/api/baseUrl.js';

const APP_VERSION = '1.4.0'; // mirrors mobile/package.json version

async function asJson(res) {
  if (!res.ok) {
    // Surface the server's { error } body message (errors.js envelope) so callers
    // can tell 400 'malformed prefs' (client bug) from 404 'token not found'
    // (needs re-register) — both otherwise look like a bare HTTP code.
    let serverMessage;
    try {
      const body = await res.json();
      serverMessage = body && body.error;
    } catch {
      serverMessage = undefined;
    }
    const err = new Error(
      `push API HTTP ${res.status}${serverMessage ? `: ${serverMessage}` : ''}`,
    );
    err.status = res.status;
    err.serverMessage = serverMessage;
    throw err;
  }
  return res.json();
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** GET /push/status -> { enabled }. enabled:false means push delivery unavailable server-side. */
export async function getPushStatus() {
  return asJson(await apiFetch(`${getApiBase()}/push/status`));
}

/** GET /push/prefs?token=<FCM> -> the full prefs object (DEFAULT_PREFS for unknown tokens). */
export async function getPushPrefs(token) {
  const q = encodeURIComponent(token);
  const body = await asJson(await apiFetch(`${getApiBase()}/push/prefs?token=${q}`));
  return body.prefs;
}

/** PUT /push/prefs { token, prefs } (strict full-replace) -> the normalized prefs. */
export async function setPushPrefs(token, prefs) {
  const body = await asJson(
    await apiFetch(`${getApiBase()}/push/prefs`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token, prefs }),
    }),
  );
  return body.prefs;
}

/** POST /push/register { token, platform, appVersion } -> { stored, deliveryEnabled }. */
export async function registerToken(token) {
  return asJson(
    await apiFetch(`${getApiBase()}/push/register`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token, platform: 'android', appVersion: APP_VERSION }),
    }),
  );
}

/** DELETE /push/register { token } (token in BODY) -> { removed }. Idempotent. */
export async function deleteToken(token) {
  return asJson(
    await apiFetch(`${getApiBase()}/push/register`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token }),
    }),
  );
}
