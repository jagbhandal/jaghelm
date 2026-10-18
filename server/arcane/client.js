/**
 * Thin read-only Arcane API client over safeFetch. Auth is the X-API-Key
 * header (never Bearer). Only endpoints a read-only key can call: GETs plus one
 * POST that is a batch lookup (vulnerability summaries, vulnerabilities:read);
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

  async function request(path, { method = 'GET', body } = {}) {
    const headers = { 'X-API-Key': apiKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        trusted: true,
        timeoutMs,
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      // undici reports "fetch failed" and keeps the reason (ECONNREFUSED, a TLS code,
      // a timeout) in err.cause.code. Only a code-shaped value is appended.
      const code = err?.cause?.code;
      const why = typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? ` (${code})` : '';
      const what = err?.message || 'network error';
      throw new ArcaneError(`Arcane request failed: ${what}${why}`, null);
    }
    if (!res.ok) throw new ArcaneError(`Arcane HTTP ${res.status} for ${path.split('?')[0]}`, res.status);
    try {
      return await res.json();
    } catch {
      throw new ArcaneError('Arcane returned invalid JSON', null);
    }
  }

  const get = (path) => request(path);

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
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const malformed = (what) => new ArcaneError(`Arcane returned a malformed ${what} payload`, null);

  return {
    listEnvironments: () => getList('/api/environments?limit=-1'),
    // Unfiltered (limit=-1 is "all", pkg/pagination/types.go:14-23), so a container whose
    // update check errored is seen as such rather than dropping out of a has_update list.
    listContainers: (envId) => getList(`/api/environments/${env(envId)}/containers?limit=-1`),
    listActivities: (envId, type, limit = 20, start = 0) =>
      getList(
        `/api/environments/${env(envId)}/activities?type=${encodeURIComponent(type)}` +
          `&order=desc&limit=${limit}${start > 0 ? `&start=${start}` : ''}`
      ),
    updaterHistory: (envId, limit = 200) =>
      getList(`/api/environments/${env(envId)}/updater/history?limit=${limit}`),
    // Vulnerability results (all need vulnerabilities:read; Arcane v2.16.1
    // internal/vulnerability/children/query/module.go). Image id -> ScanSummary
    // { imageId, scanTime, status, summary, error }; ids without a scan are absent.
    async vulnSummaries(envId, imageIds) {
      const data = unwrap(
        await request(`/api/environments/${env(envId)}/images/vulnerabilities/summaries`, {
          method: 'POST',
          body: { imageIds },
        })
      );
      if (!isObj(data) || !isObj(data.summaries)) throw malformed('vulnerability summary');
      return data.summaries;
    },
    // One page of critical and high findings with a fixed version, across the
    // environment's current images (completed scans only, ignored findings left out).
    // Arcane caps a page at 100 rows (pkg/pagination/reflect.go:52-56); totalItems is
    // the filtered count.
    async listVulnerabilities(envId, { start = 0, limit = 100 } = {}) {
      const body = await get(
        `/api/environments/${env(envId)}/vulnerabilities/all` +
          `?severity=CRITICAL,HIGH&fixAvailable=true&start=${start}&limit=${limit}`
      );
      if (!isObj(body) || body.success === false) throw malformed('vulnerability list');
      const total = body.pagination?.totalItems;
      if (!Array.isArray(body.data) || !Number.isInteger(total) || total < 0) {
        throw malformed('vulnerability list');
      }
      return { data: body.data, totalItems: total };
    },
    // RiskOverview: KEV and EPSS drivers, the 7-day delta, the riskiest images.
    async vulnOverview(envId) {
      const data = unwrap(await get(`/api/environments/${env(envId)}/vulnerabilities/overview`));
      if (!isObj(data)) throw malformed('vulnerability overview');
      return data;
    },
    async appVersion() {
      const data = unwrap(await get('/api/app-version'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ArcaneError('Arcane returned a malformed app-version payload', null);
      }
      return data;
    },
  };
}
