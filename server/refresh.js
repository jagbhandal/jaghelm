/**
 * Background refresh loop and per-domain refresh functions.
 *
 * Refresh functions populate the in-memory cache used by the API routes.
 * They run on a configurable interval (default 30s) and are also called as
 * cold-start fallbacks by routes whose cache hasn't been populated yet.
 *
 * Functions exported here:
 *   - refreshServices     → /api/services payload (nodes + containers + monitors)
 *   - refreshUPS          → /api/ups payload
 *   - refreshGitea        → /api/gitea/activity payload
 *   - refreshIntegrations → /api/integrations payload
 *
 * Loop control:
 *   - startBackgroundRefresh()   → starts the interval (call once at boot)
 *   - restartBackgroundRefresh() → re-reads the interval from display-config
 *                                  and restarts (called after settings save)
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { getConfig } from './config.js';
import { getNodeData } from './discovery.js';
import { fetchMonitors, matchMonitor, markMonitorLogDone } from './monitors.js';
import { fetchIntegration } from './integrations/handler.js';
import { setCache } from './cache.js';
import { safeFetch } from './httpClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISPLAY_CONFIG_PATH = join(__dirname, '..', 'data', 'display-config.json');
const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_SECONDS = 10;

let bgRefreshTimer = null;
let bgRefreshRunning = false;

// ── Helpers ──────────────────────────────────────────────────────────────

function formatContainerName(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRefreshIntervalMs() {
  try {
    if (existsSync(DISPLAY_CONFIG_PATH)) {
      const data = JSON.parse(readFileSync(DISPLAY_CONFIG_PATH, 'utf8'));
      const seconds = data?.refreshInterval;
      if (typeof seconds === 'number' && seconds >= MIN_INTERVAL_SECONDS) {
        return seconds * 1000;
      }
    }
  } catch {
    // Ignore — fall through to default
  }
  return DEFAULT_INTERVAL_MS;
}

// ── Domain refresh functions ─────────────────────────────────────────────

/**
 * Build the unified /api/services payload: node metrics, container stats,
 * Kuma monitor health, and config overrides — merged into one structure.
 */
export async function refreshServices() {
  try {
    const config = getConfig();
    if (!config || !config.nodes || Object.keys(config.nodes).length === 0) {
      setCache('services', { nodes: {} });
      return { nodes: {} };
    }

    const monitorsPromise = fetchMonitors(true);
    const nodeDataPromises = Object.entries(config.nodes).map(async ([nodeKey, nodeCfg]) => {
      if (nodeCfg.visible === false) return null;
      const promLabel = nodeCfg.prometheus_node || nodeKey;
      const nodeData = await getNodeData(promLabel);
      return [nodeKey, nodeCfg, nodeData];
    });

    const [monitors, ...nodeResults] = await Promise.all([monitorsPromise, ...nodeDataPromises]);

    const nodeEntries = nodeResults.filter(Boolean).map(([nodeKey, nodeCfg, nodeData]) => {
      const metrics = nodeData.metrics;
      let containers = nodeData.containers;

      const hideList = (nodeCfg.hide || []).map((h) => h.toLowerCase());
      containers = containers.filter(
        (c) => !hideList.some((h) => c.container.toLowerCase().includes(h))
      );

      const services = containers.map((c) => {
        const override = config.services?.[c.container] || {};
        const displayName = override.display_name || formatContainerName(c.container);
        const explicitMonitor = override.monitor || null;
        const monitor = matchMonitor(c.container, explicitMonitor, monitors);
        const status = monitor?.status || c.status || 'unknown';

        return {
          container: c.container,
          uid: `${nodeKey}:${c.container}`,
          display_name: displayName,
          icon: override.icon || null,
          status,
          monitored: !!monitor,
          ping: monitor?.ping || null,
          uptime24: monitor?.uptime24 || null,
          docker: c.docker,
          integration: null,
        };
      });

      services.sort((a, b) => a.display_name.localeCompare(b.display_name));

      return [
        nodeKey,
        {
          display_name: nodeCfg.display_name || nodeKey,
          subtitle: nodeCfg.subtitle || '',
          icon: nodeCfg.icon || '🖥',
          border_color: nodeCfg.border_color || '#6366f1',
          metrics,
          services,
        },
      ];
    });

    const nodes = Object.fromEntries(nodeEntries.filter(Boolean));
    const result = { nodes };
    setCache('services', result);
    markMonitorLogDone();
    return result;
  } catch (err) {
    console.error('[refresh] Services error:', err.message);
    return null;
  }
}

/** UPS battery, charge, runtime, load — sourced from NUT via Prometheus. */
export async function refreshUPS() {
  try {
    const url = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    const queryMap = {
      status: 'nut_status{ups="apcups"}',
      charge: 'nut_battery_charge{ups="apcups"}',
      runtime: 'nut_battery_runtime_seconds{ups="apcups"}',
      load: 'nut_load{ups="apcups"}',
    };
    const keys = Object.keys(queryMap);
    const responses = await Promise.all(
      keys.map((k) =>
        safeFetch(`${url}/api/v1/query?query=${encodeURIComponent(queryMap[k])}`)
          .then((r) => r.json())
          .then((d) =>
            d?.data?.result?.[0]?.value?.[1] ? parseFloat(d.data.result[0].value[1]) : null
          )
          .catch(() => null)
      )
    );

    const results = {};
    let found = false;
    keys.forEach((k, i) => {
      let val = responses[i];
      if (val !== null) {
        found = true;
        if (k === 'charge' || k === 'load') val = val * 100;
      }
      results[k] = val;
    });
    if (!found) {
      results.status = null;
      results.charge = null;
      results.runtime = null;
      results.load = null;
    }
    setCache('ups', results);
    return results;
  } catch (err) {
    console.error('[refresh] UPS error:', err.message);
    return null;
  }
}

/** Recent commits across all Gitea repos (auto-discovers via /api/v1/repos/search). */
export async function refreshGitea() {
  try {
    const url = process.env.GITEA_URL || 'http://localhost:3060';
    const token = process.env.GITEA_TOKEN || '';
    const authParam = token ? `token=${token}` : '';

    const reposRes = await safeFetch(
      `${url}/api/v1/repos/search?limit=20${authParam ? '&' + authParam : ''}`
    );
    const reposData = await reposRes.json();
    const repos = (reposData?.data || reposData || [])
      .filter((r) => !r.fork && !r.mirror && !r.archived)
      .map((r) => ({ name: r.name, fullName: r.full_name }));

    if (repos.length === 0) {
      setCache('gitea', []);
      return [];
    }

    const repoCommits = await Promise.allSettled(
      repos.map(async (repo) => {
        const commitsRes = await safeFetch(
          `${url}/api/v1/repos/${repo.fullName}/commits?limit=5&sha=main${authParam ? '&' + authParam : ''}`
        );
        const data = await commitsRes.json();
        const commits = Array.isArray(data)
          ? data.map((c) => ({
              sha: c.sha?.substring(0, 7),
              message: c.commit?.message?.split('\n')[0] || '',
              date: c.commit?.author?.date || '',
              author: c.commit?.author?.name || '',
            }))
          : [];
        return { repo: repo.name, fullName: repo.fullName, commits };
      })
    );

    const result = repoCommits
      .filter((r) => r.status === 'fulfilled' && r.value.commits.length > 0)
      .map((r) => r.value)
      .sort((a, b) => {
        const aDate = a.commits[0]?.date || '';
        const bDate = b.commits[0]?.date || '';
        return new Date(bDate) - new Date(aDate);
      });

    setCache('gitea', result);
    return result;
  } catch (err) {
    console.error('[refresh] Gitea error:', err.message);
    return null;
  }
}

/** Aggregate data from every configured integration (presets + custom). */
export async function refreshIntegrations() {
  try {
    const config = getConfig();
    const integrations = config?.integrations || {};

    const results = {};
    const promises = Object.entries(integrations)
      .filter(([, cfg]) => cfg.enabled !== false)
      .map(async ([key, cfg]) => {
        const handlerType = cfg.preset || key;
        const result = await fetchIntegration(handlerType, { ...cfg, _storageKey: key }, true);
        const entry = { ...(result.fields || {}) };
        if (result.vms) entry._vms = result.vms;
        if (result.storagePools) entry._storagePools = result.storagePools;
        if (result.lastBackup) entry._lastBackup = result.lastBackup;
        if (cfg.target) entry._target = cfg.target;
        if (cfg.instance) entry._instance = cfg.instance;
        results[key] = entry;
      });

    await Promise.allSettled(promises);
    setCache('integrations', results);
    return results;
  } catch (err) {
    console.error('[refresh] Integrations error:', err.message);
    return null;
  }
}

// ── Background loop ──────────────────────────────────────────────────────

async function runBackgroundRefresh() {
  if (bgRefreshRunning) return; // Skip if previous cycle hasn't finished
  bgRefreshRunning = true;
  const start = Date.now();
  try {
    await Promise.allSettled([
      refreshServices(),
      refreshUPS(),
      refreshGitea(),
      refreshIntegrations(),
    ]);
    console.log('[refresh] Background cycle complete in %dms', Date.now() - start);
  } catch (err) {
    console.error('[refresh] Background cycle error:', err.message);
  } finally {
    bgRefreshRunning = false;
  }
}

export function startBackgroundRefresh() {
  const intervalMs = getRefreshIntervalMs();
  if (bgRefreshTimer) clearInterval(bgRefreshTimer);
  bgRefreshTimer = setInterval(runBackgroundRefresh, intervalMs);
  console.log('[refresh] Background loop started — interval %ds', intervalMs / 1000);
  // Warm the cache immediately so the first dashboard load isn't a cold miss
  runBackgroundRefresh();
}

export function restartBackgroundRefresh() {
  const intervalMs = getRefreshIntervalMs();
  if (bgRefreshTimer) clearInterval(bgRefreshTimer);
  bgRefreshTimer = setInterval(runBackgroundRefresh, intervalMs);
  console.log('[refresh] Background loop restarted — interval %ds', intervalMs / 1000);
}
