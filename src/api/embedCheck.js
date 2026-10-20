/**
 * Ask the server whether an app tab's headers let the browser frame it (#269,
 * server/routes/embedCheck.js). The server looks the URL up by tab id in the
 * saved config; this sends the id and the page's origin, never a URL.
 *
 * Resolves to `{ verdict: 'blocked', header }`, `{ verdict: 'allowed' }` or
 * `{ verdict: 'unknown' }`, never rejects. Unknown covers everything that
 * isn't an answer about this URL: the server couldn't read the app, the call
 * failed, the demo's empty answer, and an answer about another URL. Callers
 * ask only once the server has `url` saved (useEmbedStatus), so that last one
 * is a race with another save, not the normal case.
 *
 * @param {string} tabId
 * @param {string} url the URL the frame shows
 * @param {{ fresh?: boolean }} [opts] fresh: skip the server's cached answer
 */
import { apiFetch } from './client.js';
import { getApiBase } from './baseUrl.js';

const UNKNOWN = Object.freeze({ verdict: 'unknown' });

export async function fetchEmbedCheck(tabId, url, { fresh = false } = {}) {
  const query = new URLSearchParams({ origin: window.location.origin });
  if (fresh) query.set('fresh', '1');
  try {
    const r = await apiFetch(`${getApiBase()}/embed-check/${encodeURIComponent(tabId)}?${query}`);
    if (!r.ok) return UNKNOWN;
    const body = await r.json();
    if (!body || body.url !== url) return UNKNOWN;
    if (body.verdict === 'blocked') {
      return { verdict: 'blocked', header: typeof body.header === 'string' ? body.header : null };
    }
    return body.verdict === 'allowed' ? { verdict: 'allowed' } : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}
