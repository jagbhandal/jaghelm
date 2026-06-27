/**
 * Background refresh loop and per-domain refresh functions.
 *
 * Refresh functions populate the in-memory cache used by the API routes. They
 * run on a configurable interval (default 30s) and are also called as cold-start
 * fallbacks by routes whose cache hasn't been populated yet.
 *
 * Loop control: startBackgroundRefresh() starts the interval (once at boot);
 * restartBackgroundRefresh() re-reads the interval from display-config and
 * restarts it (called after a settings save).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { getConfig } from './config.js';
import { getNodeData } from './discovery.js';
import { recordSamples } from './history.js';
import { fetchMonitors, matchMonitor, markMonitorLogDone, selectOutageMonitors } from './monitors.js';
import { serviceRegistry } from './serviceRegistry.js';
import { containerRegistry } from './containerRegistry.js';
import { fetchIntegration } from './integrations/handler.js';
import { setCache } from './cache.js';
import { safeFetch } from './httpClient.js';
import { dedupe } from './util/dedupe.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';
import { recordRefreshCycle } from './metrics.js';
import { runPushCycle } from './push/dispatch.js';
import { buildSnapshot } from './push/snapshot.js';
import { getPushStore } from './push/store.js';
import * as fcm from './push/fcm.js';

const log = createLogger('refresh');

// Same display-config.json the displayConfig route writes — honor JAGHELM_DATA_DIR.
const DISPLAY_CONFIG_PATH = join(DATA_DIR, 'display-config.json');
const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_SECONDS = 10;

let bgRefreshTimer = null;
let bgRefreshRunning = false;
let lastRefreshComplete = 0; // ms epoch of the last finished cycle (0 = never)

// ── Push pipeline wiring ─────────────────────────────────────────────────
// Snapshot of the prev cycle's state lives beside the other data/ stores.
const PUSH_SNAPSHOT_PATH = join(DATA_DIR, 'push-snapshot.json');
const DEFAULT_PUSH_THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };

// ── Helpers ──────────────────────────────────────────────────────────────

/** Read and parse display-config.json once. Returns the parsed object or null on missing/error. */
function readDisplayConfig() {
  try {
    if (existsSync(DISPLAY_CONFIG_PATH)) {
      return JSON.parse(readFileSync(DISPLAY_CONFIG_PATH, 'utf8'));
    }
  } catch {
    // fall through
  }
  return null;
}

// Thresholds come from display-config when present, else the defaults. Read
// through the same cached file the loop already touches.
function getPushThresholds() {
  const data = readDisplayConfig();
  const t = data?.pushThresholds;
  if (t && typeof t === 'object') {
    return {
      cpu: typeof t.cpu === 'number' ? t.cpu : DEFAULT_PUSH_THRESHOLDS.cpu,
      mem: typeof t.mem === 'number' ? t.mem : DEFAULT_PUSH_THRESHOLDS.mem,
      disk: typeof t.disk === 'number' ? t.disk : DEFAULT_PUSH_THRESHOLDS.disk,
      hysteresis: typeof t.hysteresis === 'number' ? t.hysteresis : DEFAULT_PUSH_THRESHOLDS.hysteresis,
    };
  }
  return DEFAULT_PUSH_THRESHOLDS;
}

function formatContainerName(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Cache the parsed refresh interval. The background loop reads it every tick
// (and again on every restart), so re-running readFileSync + JSON.parse each
// time was pure waste. Cache is invalidated by the displayConfig POST route
// after it writes a new value.
let cachedIntervalMs = null;

export function invalidateRefreshIntervalCache() {
  cachedIntervalMs = null;
}

function getRefreshIntervalMs() {
  if (cachedIntervalMs !== null) return cachedIntervalMs;
  const data = readDisplayConfig();
  const seconds = data?.refreshInterval;
  if (typeof seconds === 'number' && seconds >= MIN_INTERVAL_SECONDS) {
    cachedIntervalMs = seconds * 1000;
    return cachedIntervalMs;
  }
  cachedIntervalMs = DEFAULT_INTERVAL_MS;
  return cachedIntervalMs;
}

// ── Domain refresh functions ─────────────────────────────────────────────

/**
 * Build the unified /api/services payload: node metrics, container stats,
 * Kuma monitor health, and config overrides — merged into one structure.
 */
export async function refreshServices() {
  return dedupe('services', _refreshServices);
}

/**
 * Rank for the canonical per-node sort: down → unknown → up. Both frontends
 * inherit this order (web renders in array order, mobile re-sorts identically).
 */
function serviceRank(s) {
  if (s.status === 'down') return 0;
  if (s.status === 'unknown') return 1;
  return 2;
}

/**
 * Pure assembly of the services cache payload from discovered node data, Kuma
 * monitors, and the container presence registry. Extracted from _refreshServices
 * so it can be unit-tested without the network.
 *
 * Three passes:
 *  (a) Running-container cards — Kuma overlays status; each running container is
 *      recorded into the container registry (last-seen node + timing).
 *  (b) Down-monitor synthesis — active monitors reporting `down` that matched no
 *      running container become red cards on their last-seen node (base spec).
 *  (c) Breadcrumb synthesis — established, UNMONITORED containers that have
 *      vanished (absent past grace, within TTL) become grey `unknown`
 *      `source:'presence'` cards on their last-seen node. Skipped if the
 *      container is running anywhere this cycle, or if ANY monitor matches it
 *      (Kuma owns tracked services entirely).
 *
 * Every node's cards are ordered down → unknown → up.
 *
 * Finally it computes ONE `overallHealth` from the whole assembled board (after
 * sorting) — `down` if any card is down; else `degraded` if any card is unknown
 * (presence breadcrumbs included); else `up` if there are cards; else `unknown`.
 * BOTH frontends read this single server value for their global dot, so they are
 * symmetric and deterministic (no client re-derivation).
 *
 * @returns {{ nodes: object, seen: Array<{monitorId:any, nodeKey:string}>, outageCount: number, breadcrumbCount: number, overallHealth: 'down'|'degraded'|'up'|'unknown' }}
 */
export function assembleServices({ nodeResults, monitors, config, lastSeenNodeOf, containerRegistry, now = Date.now }) {
  const consumed = new Set();
  const seen = [];
  const runningNames = new Set();
  const nowMs = now();

  // (a) Running-container cards.
  const nodeEntries = nodeResults.filter(Boolean).map(([nodeKey, nodeCfg, nodeData]) => {
    const metrics = nodeData.metrics;
    let containers = nodeData.containers;

    const hideList = (nodeCfg.hide || []).map((h) => h.toLowerCase());
    containers = containers.filter(
      (c) => !hideList.some((h) => c.container.toLowerCase().includes(h))
    );

    const services = containers.map((c) => {
      runningNames.add(c.container);
      if (containerRegistry) containerRegistry.recordSeen(c.container, nodeKey, nowMs);
      const override = config.services?.[c.container] || {};
      const displayName = override.display_name || formatContainerName(c.container);
      const explicitMonitor = override.monitor || null;
      const monitor = matchMonitor(c.container, explicitMonitor, monitors);
      if (monitor) {
        consumed.add(monitor.id);
        seen.push({ monitorId: monitor.id, nodeKey });
      }
      const rawStatus = monitor?.status || c.status || 'unknown';
      // Normalise Docker's 'running' to the Kuma-aligned 'up' so the status
      // vocabulary is consistent across container and monitor cards.
      const status = rawStatus === 'running' ? 'up' : rawStatus;

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
        source: 'container',
      };
    });

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
  const nodeKeys = Object.keys(nodes);

  // (b) Down-monitor synthesis — outages whose container left cAdvisor. The
  // down-vs-inactive invariant lives in selectOutageMonitors: it keeps only
  // monitors that are down, active, and FRESH (a paused monitor's heartbeat
  // goes stale and is excluded, so a retired-while-down service can't leave a
  // phantom red card — `active` reads null on real Kuma and can't be relied on).
  const outages = selectOutageMonitors(monitors, consumed, { now: nowMs });
  for (const m of outages) {
    let nodeKey = lastSeenNodeOf(m.id);
    if (!nodeKey || !nodes[nodeKey]) nodeKey = nodeKeys[0];
    if (!nodeKey || !nodes[nodeKey]) continue; // no nodes to attach to
    const override = config.services?.[m.name] || {};
    nodes[nodeKey].services.push({
      container: m.name,
      uid: `${nodeKey}:${m.name}`,
      display_name: override.display_name || m.name,
      icon: override.icon || null,
      status: 'down',
      monitored: true,
      ping: m.ping || null,
      uptime24: m.uptime24 || null,
      docker: null,
      integration: null,
      source: 'monitor',
    });
  }

  // (c) Breadcrumb synthesis — vanished, established, UNMONITORED containers.
  let breadcrumbCount = 0;
  if (containerRegistry) {
    const candidates = containerRegistry.getMissing({ now: nowMs });
    for (const cand of candidates) {
      if (runningNames.has(cand.container)) continue;             // running somewhere this cycle
      const override = config.services?.[cand.container] || {};
      // Kuma owns it — honor the explicit monitor mapping too (mirror pass (a)),
      // so an explicitly-mapped, dissimilar-named monitor never lets a tracked
      // service leak out as a grey breadcrumb (or double as breadcrumb + red card).
      if (matchMonitor(cand.container, override.monitor || null, monitors)) continue;
      let nodeKey = cand.lastSeenNode;
      if (!nodeKey || !nodes[nodeKey]) nodeKey = nodeKeys[0];
      if (!nodeKey || !nodes[nodeKey]) continue; // no nodes to attach to
      nodes[nodeKey].services.push({
        container: cand.container,
        uid: `${nodeKey}:${cand.container}`,
        display_name: override.display_name || formatContainerName(cand.container),
        icon: null,
        status: 'unknown',
        monitored: false,
        source: 'presence',
        lastSeenAt: cand.lastSeenAt,
        ping: null,
        uptime24: null,
        docker: null,
        integration: null,
      });
      breadcrumbCount += 1;
    }
  }

  // Canonical order per node: down → unknown → up, then alphabetical.
  for (const node of Object.values(nodes)) {
    node.services.sort((a, b) => serviceRank(a) - serviceRank(b) || a.display_name.localeCompare(b.display_name));
  }

  // Server-computed global health for BOTH frontends' dot (web NavBar + mobile
  // Overview). Computed ONCE from every assembled card across all nodes so the
  // two clients are symmetric and deterministic — a presence breadcrumb (status
  // 'unknown') drives 'degraded', exactly as a tracked-unknown monitor would.
  let anyCard = false;
  let anyDown = false;
  let anyUnknown = false;
  for (const node of Object.values(nodes)) {
    for (const s of node.services) {
      anyCard = true;
      if (s.status === 'down') anyDown = true;
      else if (s.status === 'unknown') anyUnknown = true;
    }
  }
  const overallHealth = anyDown ? 'down' : anyUnknown ? 'degraded' : anyCard ? 'up' : 'unknown';

  return { nodes, seen, outageCount: outages.length, breadcrumbCount, overallHealth };
}

async function _refreshServices() {
  try {
    const config = getConfig();
    if (!config || !config.nodes || Object.keys(config.nodes).length === 0) {
      setCache('services', { nodes: {}, overallHealth: 'unknown' });
      return { nodes: {}, overallHealth: 'unknown' };
    }

    // Monitors are best-effort; if Kuma is down we still want node data.
    const monitorsSettled = fetchMonitors(true).catch((err) => {
      log.warn({ err }, 'monitors fetch failed');
      return [];
    });
    const nodeDataPromises = Object.entries(config.nodes).map(async ([nodeKey, nodeCfg]) => {
      if (nodeCfg.visible === false) return null;
      const promLabel = nodeCfg.prometheus_node || nodeKey;
      const nodeData = await getNodeData(promLabel);
      return [nodeKey, nodeCfg, nodeData];
    });

    // allSettled (not all) so one unreachable node doesn't sink the whole
    // dashboard. Rejected node results are logged and dropped; the surviving
    // nodes still render.
    const [monitors, ...nodeOutcomes] = await Promise.all([
      monitorsSettled,
      ...nodeDataPromises.map((p) =>
        p.then(
          (val) => ({ status: 'fulfilled', value: val }),
          (reason) => ({ status: 'rejected', reason })
        )
      ),
    ]);

    const nodeResults = [];
    for (const outcome of nodeOutcomes) {
      if (outcome.status === 'fulfilled') {
        nodeResults.push(outcome.value);
      } else {
        const msg = outcome.reason?.message || String(outcome.reason);
        log.warn({ err: msg }, 'node refresh failed');
      }
    }

    const { nodes, seen, overallHealth } = assembleServices({
      nodeResults,
      monitors,
      config,
      lastSeenNodeOf: (id) => serviceRegistry.getLastSeenNode(id),
      containerRegistry,
      now: Date.now,
    });

    // Remember where each running, monitored service lives so an outage that
    // later loses its container still lands on its panel.
    for (const { monitorId, nodeKey } of seen) serviceRegistry.recordSeen(monitorId, nodeKey);
    serviceRegistry.save();
    // containerRegistry was updated in-pass (recordSeen) inside assembleServices;
    // decommission-prune (>TTL) then persist here. prune() is an explicit refresh-loop
    // step (NOT a save() side effect) so persistence never silently deletes by clock.
    containerRegistry.prune();
    containerRegistry.save();

    // overallHealth is server-computed once (above) and shipped in the payload so
    // BOTH frontends' global dots read one truth (web NavBar + mobile Overview).
    const result = { nodes, overallHealth };
    setCache('services', result);

    // Record this cycle's usage into the ring buffer so the UI can draw a
    // glance-context sparkline. Only the bounded usage percents (CPU/RAM/disk);
    // non-finite values are skipped inside history.js.
    for (const [nodeKey, node] of Object.entries(nodes)) {
      const m = node.metrics || {};
      recordSamples({
        [`${nodeKey}:cpu`]: m.cpu,
        [`${nodeKey}:mem`]: m.memPercent,
        [`${nodeKey}:disk`]: m.diskPercent,
      });
    }

    markMonitorLogDone();
    return result;
  } catch (err) {
    log.error({ err }, 'services refresh error');
    return null;
  }
}

/** UPS battery, charge, runtime, load — sourced from NUT via Prometheus. */
export async function refreshUPS() {
  return dedupe('ups', _refreshUPS);
}

async function _refreshUPS() {
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
            d?.data?.result?.[0]?.value?.[1] != null ? parseFloat(d.data.result[0].value[1]) : null
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
    log.error({ err }, 'UPS refresh error');
    return null;
  }
}

/** Recent commits across all Gitea repos (auto-discovers via /api/v1/repos/search). */
export async function refreshGitea() {
  return dedupe('gitea', _refreshGitea);
}

async function _refreshGitea() {
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
    log.error({ err }, 'Gitea refresh error');
    return null;
  }
}

/** Aggregate data from every configured integration (presets + custom). */
export async function refreshIntegrations() {
  return dedupe('integrations', _refreshIntegrations);
}

async function _refreshIntegrations() {
  try {
    const config = getConfig();
    const integrations = config?.integrations || {};

    const results = {};
    const entries = Object.entries(integrations).filter(([, cfg]) => cfg.enabled !== false);

    const fetchOne = async ([key, cfg]) => {
      try {
        const handlerType = cfg.preset || key;
        const result = await fetchIntegration(handlerType, { ...cfg, _storageKey: key }, true);
        const entry = { ...(result.fields || {}) };
        // Surface fetch/auth failures instead of dropping them — otherwise a
        // down integration renders as silent zeros, not an error state.
        if (result.error) entry._error = result.error;
        if (result.vms) entry._vms = result.vms;
        if (result.storagePools) entry._storagePools = result.storagePools;
        if (result.lastBackup) entry._lastBackup = result.lastBackup;
        if (cfg.target) entry._target = cfg.target;
        if (cfg.instance) entry._instance = cfg.instance;
        // Stamp the preset identity so the client can detect integration type
        // directly (e.g. proxmox child panels) rather than sniffing output fields.
        entry._preset = handlerType;
        results[key] = entry;
      } catch (err) {
        results[key] = { _error: String((err && err.message) || err) };
      }
    };

    // Bounded fan-out: a fully-wired board can have 30-50+ integrations; firing them
    // all at once opened that many concurrent sockets every refresh cycle. Cap the
    // peak (no head-of-line blocking — runners pull from a shared queue).
    const CONCURRENCY = 6;
    const queue = [...entries];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) await fetchOne(queue.shift());
      })
    );
    setCache('integrations', results);
    return results;
  } catch (err) {
    log.error({ err }, 'integrations refresh error');
    return null;
  }
}

// ── Background loop ──────────────────────────────────────────────────────

async function runBackgroundRefresh() {
  if (bgRefreshRunning) return; // Skip if previous cycle hasn't finished
  bgRefreshRunning = true;
  const start = Date.now();
  let ok = true;
  try {
    await Promise.allSettled([
      refreshServices(),
      refreshUPS(),
      refreshGitea(),
      refreshIntegrations(),
    ]);
    log.info({ ms: Date.now() - start }, 'background cycle complete');

    // Push cycle: diff this cycle's state vs the last and notify mobile
    // tokens. Self-contained — it can NEVER reject (see runPushCycle), so it
    // cannot flip `ok` or break the loop. No-ops when push is disabled.
    await runPushCycle({
      buildSnapshotFn: buildSnapshot,
      store: getPushStore(),
      fcm,
      snapshotPath: PUSH_SNAPSHOT_PATH,
      thresholds: getPushThresholds(),
      logger: log,
    });
  } catch (err) {
    ok = false;
    log.error({ err }, 'background cycle error');
  } finally {
    bgRefreshRunning = false;
    lastRefreshComplete = Date.now();
    recordRefreshCycle(Date.now() - start, ok);
  }
}

/**
 * Liveness of the background refresh loop, for /api/health (which the Docker
 * HEALTHCHECK + deploy verify gate trust). 'starting' before the first cycle,
 * 'stale' once the loop has missed ~3 expected cycles (wedged), else 'ok'.
 */
export function getRefreshHealth() {
  if (lastRefreshComplete === 0) return { state: 'starting', ageMs: null };
  const ageMs = Date.now() - lastRefreshComplete;
  const intervalMs = getRefreshIntervalMs();
  const state = ageMs > Math.max(3 * intervalMs, 90_000) ? 'stale' : 'ok';
  return { state, ageMs };
}

export function startBackgroundRefresh() {
  const intervalMs = getRefreshIntervalMs();
  if (bgRefreshTimer) clearInterval(bgRefreshTimer);
  bgRefreshTimer = setInterval(runBackgroundRefresh, intervalMs);
  log.info({ intervalSec: intervalMs / 1000 }, 'background loop started');
  // Warm the cache immediately so the first dashboard load isn't a cold miss
  runBackgroundRefresh();
}

export function restartBackgroundRefresh() {
  // The cached interval is stale by definition when this is called (the route
  // that triggers a restart just wrote a new value).
  invalidateRefreshIntervalCache();
  const intervalMs = getRefreshIntervalMs();
  if (bgRefreshTimer) clearInterval(bgRefreshTimer);
  bgRefreshTimer = setInterval(runBackgroundRefresh, intervalMs);
  log.info({ intervalSec: intervalMs / 1000 }, 'background loop restarted');
}

/** Stop the background loop. Called on shutdown so the timer doesn't fire mid-drain. */
export function stopBackgroundRefresh() {
  if (bgRefreshTimer) {
    clearInterval(bgRefreshTimer);
    bgRefreshTimer = null;
  }
}
