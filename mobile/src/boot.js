/**
 * Mobile boot sequence (must run before any data hook fires):
 *   setStorageAdapter(keystoreAdapter)  → swap secrets to the Keystore
 *   installNativeHttp()                 → default transport (native HTTP)
 *   read stored base                    → setApiBase() if configured
 *   honor keep-signed-in                → session-only logins resume no token
 *   seed + revalidate the token         → a 24h-expired / restart-killed token
 *                                         must not boot us straight into a 401
 * The revalidation is bounded by BOOT_TIMEOUT_MS so a silently unreachable
 * server cannot hang boot.
 * Returns { hasUrl, hasToken, baseUrl, unreachable? } so the shell can route
 * (no URL → first-run login, URL but no token → re-auth credentials-only, both
 * → the app) and seed the re-auth screen's URL without re-reading the Keystore.
 * unreachable: true (only with hasUrl + hasToken) means the revalidation timed
 * out, hit a network error or got a 5xx; the token is kept and the shell shows
 * the connection screen instead of entering the app.
 */
import { setStorageAdapter, secureStore } from '@shared/storage/index.js';
import { initAuthToken, setAuthToken, getAuthToken, apiFetch } from '@shared/api/client.js';
import { setApiBase } from '@shared/api/baseUrl.js';
import { keystoreAdapter } from './storage/keystoreAdapter.js';
import { installNativeHttp } from './nativeHttp.js';
import { getPref } from './storage/prefsAdapter.js';
import { BASE_URL_KEY, TOKEN_KEY, REMEMBER_KEY } from './runtimeConfig.js';
import { assertSafeBackendUrl } from './netGuard.js';
import { withTimeout } from './withTimeout.js';

export const BOOT_TIMEOUT_MS = 10000;

export async function bootMobile() {
  setStorageAdapter(keystoreAdapter);
  installNativeHttp();

  const base = await secureStore.getItem(BASE_URL_KEY);
  if (!base) return { hasUrl: false, hasToken: false, baseUrl: '' };
  // Re-validate the stored URL: a poisoned/legacy value (e.g. cleartext http to a
  // public host) must not become the active base. Force re-setup if it fails.
  try {
    assertSafeBackendUrl(base);
  } catch {
    await secureStore.removeItem(TOKEN_KEY);
    setAuthToken('');
    return { hasUrl: false, hasToken: false, baseUrl: '' };
  }
  setApiBase(base);

  // Keep-signed-in is the single source of truth: a session-only login must not
  // resume a persisted token across launches.
  const remember = await getPref(REMEMBER_KEY);
  if (remember !== 'true') {
    await secureStore.removeItem(TOKEN_KEY);
    setAuthToken('');
    return { hasUrl: true, hasToken: false, baseUrl: base };
  }

  await initAuthToken(); // seed apiFetch's in-memory token from the Keystore
  if (!getAuthToken()) return { hasUrl: true, hasToken: false, baseUrl: base };

  // Revalidate against the server. /auth/check always returns 200 with an
  // {authenticated} flag (it never 401s), so inspect the body, not the status.
  try {
    // One shared deadline covers the request AND the body read.
    const { r, body } = await withTimeout(
      (async () => {
        const res = await apiFetch(`${base}/auth/check`);
        return { r: res, body: await res.json().catch(() => ({})) };
      })(),
      BOOT_TIMEOUT_MS,
    );
    // A 5xx (e.g. a proxy's 502/503 while JagHelm is down) means the server
    // can't be reached, not that the session is dead: keep the token.
    if (r.status >= 500) return { hasUrl: true, hasToken: true, baseUrl: base, unreachable: true };
    if (r.ok && body && body.authenticated) return { hasUrl: true, hasToken: true, baseUrl: base };
    await secureStore.removeItem(TOKEN_KEY);
    setAuthToken('');
    return { hasUrl: true, hasToken: false, baseUrl: base };
  } catch {
    // Timed out or network error: keep the token (the runtime 401 hook self-heals
    // if it is dead) but flag the server as unreachable so the shell does not
    // enter the app.
    return { hasUrl: true, hasToken: true, baseUrl: base, unreachable: true };
  }
}
