/**
 * Username/password login over the tailnet. Canonicalizes + safety-checks the
 * backend URL (netGuard), sets it as the active base, then POSTs credentials to
 * the existing `/auth/login` endpoint and returns the issued session token. The
 * token — never the password — is what callers persist. A `noauth` server
 * returns `{ token: 'noauth' }`, which is a normal success here.
 */
import { apiFetch, setAuthToken } from '@shared/api/client.js';
import { setApiBase } from '@shared/api/baseUrl.js';
import { tooManyAttempts } from '@shared/api/retryAfter.js';
import { normalizeBaseUrl } from './runtimeConfig.js';
import { assertSafeBackendUrl } from './netGuard.js';
import { withTimeout } from './withTimeout.js';
import { BOOT_TIMEOUT_MS } from './boot.js';
import { beforeSignIn, noRegistration } from './auth/pendingCleanup.js';

const CANT_REACH =
  "Can't reach JagHelm. If you're away from home, check that Tailscale is connected on this phone.";

export async function login({ url, username, password }) {
  let base;
  try {
    base = normalizeBaseUrl(url); // throws 'invalid url' on bad/non-http input
    assertSafeBackendUrl(url); // throws 'cleartext-public' on http to a public host
  } catch (e) {
    if (e?.message === 'cleartext-public') {
      return {
        ok: false,
        error: 'Plain http is only allowed to your tailnet (100.64.x / *.ts.net). Use https for public hosts.',
      };
    }
    return { ok: false, error: 'Enter a valid http(s) backend URL' };
  }

  // A sign-out that didn't finish is tried first: the sign-in waits for it on
  // this same server (at most 5 s), not on another one (#539).
  await beforeSignIn(base);
  const result = await signIn(base, username, password);
  // Nothing registers after a failed sign-in, so a pending FCM token deletion
  // may run again.
  if (!result.ok) noRegistration();
  return result;
}

async function signIn(base, username, password) {
  setApiBase(base);

  // One deadline (the startup check's) covers the request AND the body read, so
  // a silently dropped connection ends in an error instead of "Signing in…" forever.
  let r;
  let body;
  try {
    ({ r, body } = await withTimeout(
      (async () => {
        const res = await apiFetch(`${base}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        // Only a successful login carries a token body; an unparseable one is null.
        return { r: res, body: res.ok ? await res.json().catch(() => null) : null };
      })(),
      BOOT_TIMEOUT_MS,
    ));
  } catch {
    return { ok: false, error: CANT_REACH }; // timed out or network error
  }

  if (!r.ok) {
    if (r.status === 401) return { ok: false, status: 401, error: 'Invalid credentials' };
    // How long to wait comes from Retry-After (#257): "Too many attempts. Try again in 30 s."
    if (r.status === 429) {
      return { ok: false, status: 429, error: tooManyAttempts(r.headers?.get?.('Retry-After')) };
    }
    return { ok: false, status: r.status, error: `HTTP ${r.status}` };
  }

  const token = body?.token || '';
  if (!token) return { ok: false, status: r.status, error: 'Login succeeded but no token was returned' };

  setAuthToken(token);
  return { ok: true, token };
}
