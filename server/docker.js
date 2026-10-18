/**
 * Docker container discovery.
 *
 * Prometheus + cAdvisor first (gives CPU/mem stats), Docker socket as a
 * fallback when cAdvisor isn't scraping. Returns a sorted container list, or
 * an empty array if neither source has data. The /api/docker/containers route
 * caches the result; mirrors how refresh.js owns the UPS/Gitea fetch logic.
 */

import http from 'http';

import { safeFetch } from './httpClient.js';
import { createLogger } from './util/logger.js';
import { NOT_HELPER, isHelperSeries } from './util/helperContainers.js';

const log = createLogger('docker');

/**
 * Fetch the container list from Prometheus (preferred) or the Docker socket.
 *
 * @returns {Promise<Array<object>>} sorted container list, or [] if no source
 *   returned data.
 */
export async function getDockerContainers() {
  const promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';

  // Try Prometheus + cAdvisor first
  try {
    const [namesR, cpuR, memR] = await Promise.all([
      safeFetch(`${promUrl}/api/v1/query?query=${encodeURIComponent(`container_last_seen{name!="",${NOT_HELPER}}`)}`)
        .then((r) => r.json())
        .catch(() => null),
      safeFetch(
        `${promUrl}/api/v1/query?query=${encodeURIComponent(
          `rate(container_cpu_usage_seconds_total{name!="",${NOT_HELPER}}[5m]) * 100`
        )}`
      )
        .then((r) => r.json())
        .catch(() => null),
      safeFetch(
        `${promUrl}/api/v1/query?query=${encodeURIComponent(
          `container_memory_usage_bytes{name!="",${NOT_HELPER}}`
        )}`
      )
        .then((r) => r.json())
        .catch(() => null),
    ]);

    const containers = {};
    const live = (x) => (x?.data?.result || []).filter((r) => !isHelperSeries(r));
    const nameSeries = live(namesR);
    const cpuSeries = live(cpuR);
    const memSeries = live(memR);
    const allResults = [...nameSeries, ...cpuSeries, ...memSeries];
    for (const r of allResults) {
      const name = r.metric?.name;
      if (name && !containers[name]) {
        containers[name] = { name, cpu: null, memMB: null, status: 'running' };
      }
    }
    for (const r of cpuSeries) {
      const name = r.metric?.name;
      if (name && containers[name]) {
        containers[name].cpu =
          r.value?.[1] != null ? parseFloat(parseFloat(r.value[1]).toFixed(1)) : null;
      }
    }
    for (const r of memSeries) {
      const name = r.metric?.name;
      if (name && containers[name]) {
        containers[name].memMB =
          r.value?.[1] != null ? parseFloat((parseFloat(r.value[1]) / 1048576).toFixed(1)) : null;
      }
    }

    if (Object.keys(containers).length > 0) {
      return Object.values(containers).sort((a, b) => a.name.localeCompare(b.name));
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
    return (data || []).map((c) => ({
      name: (c.Names?.[0] || '').replace(/^\//, ''),
      image: c.Image?.split(':')[0]?.split('/').pop() || c.Image,
      status: c.State || 'unknown',
      state: c.Status || '',
    }));
  } catch {
    return [];
  }
}
