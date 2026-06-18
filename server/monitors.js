/**
 * JagHelm Monitor Matcher
 * Fetches monitors from Uptime Kuma and matches them to discovered containers.
 */

import { createLogger } from './util/logger.js';

const log = createLogger('monitors');

const KUMA_TIMEOUT = 8000;

let kumaUrl = null;
let cachedMonitors = null;
let cacheTime = 0;
const CACHE_TTL = 15000;
// Ceiling on how long we'll keep serving the last-known statuses while Kuma is
// unreachable. Past this, a sustained Kuma outage would otherwise freeze the
// board on stale "up" statuses; we return empty (unknown) instead.
const STALE_CEILING_MS = 5 * 60 * 1000;

function staleOrEmpty() {
  if (cachedMonitors && Date.now() - cacheTime < STALE_CEILING_MS) return cachedMonitors;
  return {};
}

export function initMonitors(url) {
  kumaUrl = url;
  log.info({ kumaUrl }, 'Uptime Kuma URL');
}

/**
 * Fetch all monitors from Uptime Kuma.
 * Two API calls:
 *   1. /api/status-page/default → monitor names + IDs from publicGroupList
 *   2. /api/status-page/heartbeat/default → heartbeat status, ping, uptime
 * Returns a map of { id: { id, name, status, ping, uptime24 } }
 */
export async function fetchMonitors(bustCache = false) {
  if (!kumaUrl) return {};

  if (!bustCache && cachedMonitors && Date.now() - cacheTime < CACHE_TTL) {
    return cachedMonitors;
  }

  try {
    // Fetch monitor names
    const pageR = await fetch(`${kumaUrl}/api/status-page/default`, {
      signal: AbortSignal.timeout(KUMA_TIMEOUT),
    });
    if (!pageR.ok) return cachedMonitors || {};
    const pageData = await pageR.json();

    const monitorList = (pageData.publicGroupList || []).flatMap(g => g.monitorList || []);
    if (monitorList.length === 0) {
      log.warn('No monitors found in status page');
      return staleOrEmpty();
    }

    // Fetch heartbeat data (separate endpoint in newer Kuma versions)
    let heartbeatList = pageData.heartbeatList || {};
    let uptimeList = pageData.uptimeList || {};

    if (Object.keys(heartbeatList).length === 0) {
      try {
        const hbR = await fetch(`${kumaUrl}/api/status-page/heartbeat/default`, {
          signal: AbortSignal.timeout(KUMA_TIMEOUT),
        });
        if (hbR.ok) {
          const hbData = await hbR.json();
          heartbeatList = hbData.heartbeatList || {};
          uptimeList = hbData.uptimeList || {};
        }
      } catch (err) {
        log.warn({ err }, 'Heartbeat endpoint unavailable');
      }
    }

    // Merge monitor names with heartbeat data
    const monitors = {};
    for (const pub of monitorList) {
      const id = pub.id;
      const beats = heartbeatList[id] || [];
      const latest = beats[beats.length - 1];

      monitors[id] = {
        id,
        name: pub.name,
        status: latest?.status === 1 ? 'up' : latest?.status === 0 ? 'down' : 'unknown',
        ping: latest?.ping || 0,
        uptime24: uptimeList[`${id}_24`] || 0,
      };
    }

    log.info({ count: Object.keys(monitors).length }, 'Loaded monitors from Kuma');
    cachedMonitors = monitors;
    cacheTime = Date.now();
    return monitors;
  } catch (err) {
    log.error({ err }, 'Failed to fetch Kuma monitors');
    return staleOrEmpty();
  }
}

/**
 * Get a flat array of all monitor names (for Settings UI dropdowns).
 */
export async function getMonitorNames() {
  const monitors = await fetchMonitors();
  return Object.values(monitors).map(m => m.name).sort();
}

/**
 * Match a container to an Uptime Kuma monitor.
 *
 * Strategy (in priority order):
 * 1. Explicit mapping from services.yaml → exact name match
 * 2. Exact normalized match → strip non-alphanumeric, compare
 * 3. URL-aware match → extract hostname from URL-based monitor names
 * 4. Containment match → either name contains the other
 * 5. Word-boundary match → split on spaces/hyphens, check overlap
 * 6. No match → return null
 */
let loggedOnce = false;
// Tracks (container, monitor) pairs that have already logged an "explicit miss"
// warning. Process-lifetime — clears on container restart. Prevents log spam
// every refresh cycle when services.yaml references stale monitor names.
const explicitMissWarned = new Set();

export function matchMonitor(containerName, explicitMonitor, monitors) {
  const monitorList = Object.values(monitors);

  // Strategy 1: Explicit mapping
  if (explicitMonitor) {
    const exact = monitorList.find(
      m => m.name.toLowerCase() === explicitMonitor.toLowerCase()
    );
    if (exact) return exact;
    // Log once per unique (container, monitor) pair, then stay silent.
    const key = `${containerName}::${explicitMonitor}`;
    if (!explicitMissWarned.has(key)) {
      log.warn(
        { explicitMonitor, containerName },
        'Explicit monitor not found for container — falling back to fuzzy match (this warning logs once per pair)'
      );
      explicitMissWarned.add(key);
    }
  }

  // Normalize: lowercase, strip non-alphanumeric
  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cn = normalize(containerName);
  if (!cn) return null;

  // Strategy 2: Exact normalized match
  for (const m of monitorList) {
    if (normalize(m.name) === cn) return m;
  }

  // Strategy 3: URL-aware match — extract hostname part from monitor names that look like URLs
  for (const m of monitorList) {
    const name = m.name || '';
    // If monitor name contains a dot (likely a URL or hostname)
    if (name.includes('.')) {
      // Extract the first segment before the first dot: "grafana.jagbhandal.com" → "grafana"
      const urlMatch = name.match(/(?:https?:\/\/)?([a-z0-9-]+)\./i);
      if (urlMatch) {
        const extracted = urlMatch[1].toLowerCase();
        if (extracted === cn || cn.includes(extracted) || extracted.includes(cn)) {
          return m;
        }
      }
    }
  }

  // Strategy 4: Containment match with scoring
  let best = null;
  let bestScore = 0;

  for (const m of monitorList) {
    const mn = normalize(m.name);
    if (!mn) continue;

    if (mn.includes(cn) || cn.includes(mn)) {
      const score = Math.min(cn.length, mn.length);
      if (score > bestScore) {
        best = m;
        bestScore = score;
      }
    }
  }

  if (best) return best;

  // Strategy 5: Word overlap — split both names into words, check if any match
  const containerWords = containerName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(w => w.length >= 3);
  for (const m of monitorList) {
    const monitorWords = m.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(w => w.length >= 3);
    for (const cw of containerWords) {
      for (const mw of monitorWords) {
        if (cw === mw && cw.length >= 4) {
          return m;
        }
      }
    }
  }

  // Log unmatched containers once at startup to help debug
  if (!loggedOnce) {
    log.info(
      { containerName, monitors: monitorList.map(m => m.name).join(', ') },
      'No match for container among monitors'
    );
  }

  return null;
}

// Call after first full service build to suppress repeat logs
export function markMonitorLogDone() {
  loggedOnce = true;
}