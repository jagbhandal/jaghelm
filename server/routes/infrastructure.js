/**
 * Infrastructure-data routes.
 *
 * Thin proxies around services already running in the homelab. Most are
 * cached; UPS and Gitea use the warm cache populated by the background
 * refresh loop, with cold-start fallbacks.
 *
 *   GET /api/uptime/monitors  → raw Kuma monitor map
 *   GET /api/prometheus/query → ad-hoc PromQL passthrough (cached per query)
 *   GET /api/adguard/stats    → AdGuard Home /control/stats
 *   GET /api/ups              → battery + load (warm-cached via refresh loop)
 *   GET /api/npm/stats        → Nginx Proxy Manager host counts
 *   GET /api/docker/containers → Prometheus first, Docker socket fallback
 *   GET /api/gitea/activity   → recent commits (warm-cached via refresh loop)
 */

import { Router } from 'express';
import http from 'http';

import { fetchMonitors } from '../monitors.js';
import { refreshUPS, refreshGitea } from '../refresh.js';
import { getHistory } from '../history.js';
import { getCached, setCache, jsonWithEtag } from '../cache.js';
import { apiError } from '../errors.js';
import { safeFetch } from '../httpClient.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { requireAuthEnabledInfra } from '../auth/middleware.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('infrastructure');

const router = Router();

// ── Uptime Kuma passthrough ──────────────────────────────────────────────

router.get('/uptime/monitors', requireAuthEnabledInfra, asyncHandler(async (req, res) => {
  try {
    const monitors = await fetchMonitors();
    res.json(monitors);
  } catch (err) {
    apiError(res, 502, 'Uptime Kuma unreachable', err);
  }
}));

// ── Prometheus ad-hoc query ──────────────────────────────────────────────

router.get('/prometheus/query', requireAuthEnabledInfra, asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q) return apiError(res, 400, 'Missing q');
  // Cap the query: bounds the (bounded) cache key and stops an oversized/
  // pathological PromQL string being proxied to the upstream. NOTE: this is a
  // raw passthrough — in no-auth mode it exposes the full metrics backend; a
  // query allowlist is the proper follow-up (see docs/IMPROVEMENT-PLAN.md P2).
  if (typeof q !== 'string' || q.length > 2048) {
    return apiError(res, 400, 'Invalid or oversized query');
  }

  const cacheKey = `prom-${q}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    const r = await safeFetch(`${url}/api/v1/query?query=${encodeURIComponent(q)}`);
    const data = await r.json();
    setCache(cacheKey, data);
    res.json(data);
  } catch (err) {
    apiError(res, 502, 'Prometheus unreachable', err);
  }
}));

// ── AdGuard Home stats ───────────────────────────────────────────────────

router.get('/adguard/stats', requireAuthEnabledInfra, asyncHandler(async (req, res) => {
  const cached = getCached('adguard');
  if (cached) return res.json(cached);

  try {
    // No hardcoded LAN-IP default: a baked-in 192.168.x address is a specific
    // person's box on someone else's deployment. Require explicit config.
    const url = process.env.ADGUARD_URL;
    if (!url) return res.json({ configured: false });
    const u = process.env.ADGUARD_USER || '';
    const p = process.env.ADGUARD_PASS || '';
    const headers = {};
    if (u && p) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
    }
    const r = await safeFetch(`${url}/control/stats`, { headers });
    const data = await r.json();
    setCache('adguard', data);
    res.json(data);
  } catch (err) {
    apiError(res, 502, 'AdGuard unreachable', err);
  }
}));

// ── UPS (warm-cached) ────────────────────────────────────────────────────

router.get('/ups', asyncHandler(async (req, res) => {
  const cached = getCached('ups');
  if (cached) return jsonWithEtag(res, req, 'ups', cached);

  const data = await refreshUPS();
  if (data) return jsonWithEtag(res, req, 'ups', data);

  apiError(res, 502, 'UPS data not yet available');
}));

// ── Nginx Proxy Manager stats ────────────────────────────────────────────

router.get('/npm/stats', requireAuthEnabledInfra, asyncHandler(async (req, res) => {
  const cached = getCached('npm-stats');
  if (cached) return res.json(cached);

  try {
    const url = process.env.NPM_URL;
    if (!url) return res.json({ configured: false });
    const npmUser = process.env.NPM_USER || '';
    const npmPass = process.env.NPM_PASS || '';

    let token = '';
    if (npmPass) {
      try {
        const authR = await safeFetch(`${url}/api/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identity: npmUser, secret: npmPass }),
        });
        const authD = await authR.json();
        token = authD?.token || '';
      } catch (err) {
        log.warn({ err }, 'npm Auth failed');
      }
    }

    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let hosts = 0;
    let online = 0;
    let certs = 0;

    try {
      const r = await safeFetch(`${url}/api/nginx/proxy-hosts`, { headers });
      const data = await r.json();
      if (Array.isArray(data)) {
        hosts = data.length;
        online = data.filter((h) => h.enabled === 1).length;
        certs = data.filter((h) => h.certificate_id > 0).length;
      }
    } catch (err) {
      log.warn({ err }, 'npm Failed to fetch proxy hosts');
    }

    const result = { hosts, online, certs };
    setCache('npm-stats', result);
    res.json(result);
  } catch (err) {
    apiError(res, 502, 'NPM unreachable', err);
  }
}));

// ── Docker containers (Prometheus first, Docker socket fallback) ─────────

router.get('/docker/containers', requireAuthEnabledInfra, asyncHandler(async (req, res) => {
  const cached = getCached('docker-containers');
  if (cached) return res.json(cached);

  const promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';

  // Try Prometheus + cAdvisor first
  try {
    const [namesR, cpuR, memR] = await Promise.all([
      safeFetch(`${promUrl}/api/v1/query?query=${encodeURIComponent('container_last_seen{name!=""}')}`)
        .then((r) => r.json())
        .catch(() => null),
      safeFetch(
        `${promUrl}/api/v1/query?query=${encodeURIComponent(
          'rate(container_cpu_usage_seconds_total{name!=""}[5m]) * 100'
        )}`
      )
        .then((r) => r.json())
        .catch(() => null),
      safeFetch(
        `${promUrl}/api/v1/query?query=${encodeURIComponent(
          'container_memory_usage_bytes{name!=""}'
        )}`
      )
        .then((r) => r.json())
        .catch(() => null),
    ]);

    const containers = {};
    const allResults = [
      ...(namesR?.data?.result || []),
      ...(cpuR?.data?.result || []),
      ...(memR?.data?.result || []),
    ];
    for (const r of allResults) {
      const name = r.metric?.name;
      if (name && !containers[name]) {
        containers[name] = { name, cpu: null, memMB: null, status: 'running' };
      }
    }
    for (const r of cpuR?.data?.result || []) {
      const name = r.metric?.name;
      if (name && containers[name]) {
        containers[name].cpu = r.value?.[1] ? parseFloat(parseFloat(r.value[1]).toFixed(1)) : null;
      }
    }
    for (const r of memR?.data?.result || []) {
      const name = r.metric?.name;
      if (name && containers[name]) {
        containers[name].memMB = r.value?.[1]
          ? parseFloat((parseFloat(r.value[1]) / 1048576).toFixed(1))
          : null;
      }
    }

    if (Object.keys(containers).length > 0) {
      const result = Object.values(containers).sort((a, b) => a.name.localeCompare(b.name));
      setCache('docker-containers', result);
      return res.json(result);
    }
  } catch (err) {
    log.warn({ err }, 'docker Prometheus container query failed, trying Docker socket');
  }

  // Fallback: Docker socket
  try {
    const data = await new Promise((resolve, reject) => {
      const rq = http.get(
        { socketPath: '/var/run/docker.sock', path: '/containers/json' },
        (resp) => {
          let body = '';
          resp.on('data', (c) => (body += c));
          resp.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      rq.on('error', reject);
      rq.setTimeout(5000, () => {
        rq.destroy();
        reject(new Error('timeout'));
      });
    });
    const containers = (data || []).map((c) => ({
      name: (c.Names?.[0] || '').replace(/^\//, ''),
      image: c.Image?.split(':')[0]?.split('/').pop() || c.Image,
      status: c.State || 'unknown',
      state: c.Status || '',
    }));
    setCache('docker-containers', containers);
    res.json(containers);
  } catch {
    res.json([]);
  }
}));

// ── Gitea recent commits (warm-cached) ───────────────────────────────────

router.get('/gitea/activity', asyncHandler(async (req, res) => {
  const cached = getCached('gitea');
  if (cached) return jsonWithEtag(res, req, 'gitea', cached);

  const data = await refreshGitea();
  if (data) return jsonWithEtag(res, req, 'gitea', data);

  apiError(res, 502, 'Gitea data not yet available');
}));

// ── Metric history (sparklines) ──────────────────────────────────────────
// The last ~1h of each node's CPU/RAM/disk usage, recorded by the refresh loop.
// Deliberately NOT ETag-cached: it changes every cycle (that's the point), and a
// 304 path would defeat the live sparkline. Kept off /api/services so the main
// board stays 304-stable.

router.get('/history', (req, res) => {
  res.json(getHistory());
});

export { router as infrastructureRoutes };
