import { apiFetch } from '../../api/client.js';

/** The 503 codes for a services.yaml that has to be fixed by hand (server/errors.js). */
const CONFIG_REFUSALS = new Set(['config_unparseable', 'config_unreadable']);

/**
 * GET /api/services/config for Settings (#423): `{ config, version }`, the
 * config and its ETag, or `{ error }`, why it can't be shown, in words for the
 * screen. While services.yaml doesn't parse, or can't be read (#536), the
 * server says so itself (`config_unparseable`, naming the line, or
 * `config_unreadable`, naming why); any other failure is prefixed.
 * Never an empty config in place of one that couldn't be read: that would
 * look like a config with nothing in it.
 * `signal` ends a read the server doesn't answer.
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ config: any, version: string | null } | { error: string }>}
 */
export async function readServerConfig({ signal } = {}) {
  try {
    const r = await apiFetch('/api/services/config', { signal });
    const data = await r.json().catch(() => null);
    if (r.ok && data && typeof data === 'object') {
      return { config: data, version: r.headers.get('ETag') };
    }
    if (CONFIG_REFUSALS.has(data?.code) && data.error) return { error: data.error };
    return { error: `Couldn't read the config: ${data?.error || `HTTP ${r.status}`}` };
  } catch (err) {
    return { error: `Couldn't read the config: ${err.message}` };
  }
}
