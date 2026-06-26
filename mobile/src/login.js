/**
 * Username/password login over the tailnet. Canonicalizes + safety-checks the
 * backend URL (netGuard), sets it as the active base, then POSTs credentials to
 * the existing `/auth/login` endpoint and returns the issued session token. The
 * token — never the password — is what callers persist. A `noauth` server
 * returns `{ token: 'noauth' }`, which is a normal success here.
 */
import { apiFetch, setAuthToken } from '@shared/api/client.js';
import { setApiBase } from '@shared/api/baseUrl.js';
import { normalizeBaseUrl } from './runtimeConfig.js';
import { assertSafeBackendUrl } from './netGuard.js';

export async function login({ url, username, password }) {
  let base;
  try {
    base = normalizeBaseUrl(url);
  } catch {
    return { ok: false, error: 'Enter a valid http(s) backend URL' };
  }
  try {
    assertSafeBackendUrl(url);
  } catch (e) {
    if (e?.message === 'cleartext-public') {
      return {
        ok: false,
        error: 'Plain http is only allowed to your tailnet (100.64.x / *.ts.net). Use https for public hosts.',
      };
    }
    return { ok: false, error: 'Enter a valid http(s) backend URL' };
  }

  setApiBase(base);

  let r;
  try {
    r = await apiFetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }

  if (!r.ok) {
    if (r.status === 401) return { ok: false, status: 401, error: 'Invalid credentials' };
    if (r.status === 429) return { ok: false, status: 429, error: 'Too many login attempts. Try again later.' };
    return { ok: false, status: r.status, error: `HTTP ${r.status}` };
  }

  let token = '';
  try {
    const body = await r.json();
    token = body?.token || '';
  } catch {
    /* fall through to no-token error */
  }
  if (!token) return { ok: false, status: r.status, error: 'Login succeeded but no token was returned' };

  setAuthToken(token);
  return { ok: true, token };
}
