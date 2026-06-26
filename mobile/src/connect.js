/**
 * Test & Connect: validates + canonicalizes the backend URL, sets it as the
 * active base + token, and probes ${base}/auth/check via apiFetch (native HTTP).
 * A 2xx means the host is reachable and the token is accepted (or auth disabled).
 */
import { apiFetch, setAuthToken } from '@shared/api/client.js';
import { setApiBase } from '@shared/api/baseUrl.js';
import { normalizeBaseUrl } from './runtimeConfig.js';

export async function testConnection({ url, token }) {
  let base;
  try {
    base = normalizeBaseUrl(url);
  } catch {
    return { ok: false, error: 'Enter a valid http(s) backend URL' };
  }
  setApiBase(base);
  setAuthToken(token);
  try {
    const r = await apiFetch(`${base}/auth/check`);
    if (!r.ok) return { ok: false, status: r.status, error: `HTTP ${r.status}` };
    return { ok: true, status: r.status };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
