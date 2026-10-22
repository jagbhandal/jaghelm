import { apiFetch } from '../../api/client.js';

/**
 * GET /api/services/config for Settings (#423): `{ config, version }`, the
 * config and its ETag, or `{ error }`, why it can't be shown, in words for the
 * screen. While services.yaml doesn't parse the server says so itself
 * (`config_unparseable`, naming the line); any other failure is prefixed.
 * Never an empty config in place of one that couldn't be read: that would
 * look like a config with nothing in it.
 * @returns {Promise<{ config: any, version: string | null } | { error: string }>}
 */
export async function readServerConfig() {
  try {
    const r = await apiFetch('/api/services/config');
    const data = await r.json().catch(() => null);
    if (r.ok && data && typeof data === 'object') {
      return { config: data, version: r.headers.get('ETag') };
    }
    if (data?.code === 'config_unparseable' && data.error) return { error: data.error };
    return { error: `Couldn't read the config: ${data?.error || `HTTP ${r.status}`}` };
  } catch (err) {
    return { error: `Couldn't read the config: ${err.message}` };
  }
}
