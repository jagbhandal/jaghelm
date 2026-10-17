/**
 * Thin read-only Arcane API client over safeFetch. Auth is the X-API-Key
 * header (never Bearer). Only GET endpoints a Viewer/Monitor key can read;
 * never /jobs* (needs jobs:manage). The key is never logged.
 */

import { safeFetch } from '../httpClient.js';

export class ArcaneError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'ArcaneError';
    this.status = status;
  }
}

export function createArcaneClient({ baseUrl, apiKey, fetchImpl = safeFetch, timeoutMs = 8000 }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');

  async function get(path) {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        trusted: true,
        timeoutMs,
        headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      });
    } catch (err) {
      throw new ArcaneError(`Arcane request failed: ${err?.message || 'network error'}`, null);
    }
    if (!res.ok) throw new ArcaneError(`Arcane HTTP ${res.status} for ${path.split('?')[0]}`, res.status);
    let body;
    try {
      body = await res.json();
    } catch {
      throw new ArcaneError('Arcane returned invalid JSON', null);
    }
    return body;
  }

  function unwrap(body) {
    if (body && typeof body === 'object' && !Array.isArray(body) && 'success' in body) {
      if (body.success === false) throw new ArcaneError('Arcane reported success=false', null);
      return body.data;
    }
    return body;
  }

  async function getList(path) {
    const data = unwrap(await get(path));
    if (!Array.isArray(data)) throw new ArcaneError('Arcane returned a non-array payload', null);
    return data;
  }

  const env = (id) => encodeURIComponent(id);

  return {
    listEnvironments: () => getList('/api/environments?limit=-1'),
    listPendingUpdates: (envId) =>
      getList(`/api/environments/${env(envId)}/containers?updates=has_update&limit=-1`),
    listActivities: (envId, type, limit = 20, start = 0) =>
      getList(
        `/api/environments/${env(envId)}/activities?type=${encodeURIComponent(type)}` +
          `&order=desc&limit=${limit}${start > 0 ? `&start=${start}` : ''}`
      ),
    updaterHistory: (envId, limit = 200) =>
      getList(`/api/environments/${env(envId)}/updater/history?limit=${limit}`),
    async appVersion() {
      const data = unwrap(await get('/api/app-version'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ArcaneError('Arcane returned a malformed app-version payload', null);
      }
      return data;
    },
  };
}
