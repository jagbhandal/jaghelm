/**
 * JagHelm Monitor Matcher
 * Fetches monitors from Uptime Kuma and matches them to discovered containers.
 */

import { createLogger } from './util/logger.js';
import { safeFetch } from './httpClient.js';
import { positiveMs } from './util/env.js';
import { parseKumaMetrics, statusFromValue } from './kumaMetrics.js';

const log = createLogger('monitors');

const KUMA_TIMEOUT = 8000;

let kumaUrl = null;
let kumaApiKey = '';
let cachedMonitors = null;
let cacheTime = 0;
const CACHE_TTL = 15000;
// Ceiling on how long we'll keep serving the last-known statuses while Kuma is
// unreachable. Past this, a sustained Kuma outage would otherwise freeze the
// board on stale "up" statuses; we return empty (unknown) instead.
const STALE_CEILING_MS = 5 * 60 * 1000;

// A monitor reporting `down` only counts as a live OUTAGE if its latest Kuma
// heartbeat is FRESH. A paused/retired monitor stops beating, so its last beat
// goes stale — this is how we tell "actively down" from "paused while down".
// (The status-page `active` field is unreliable: it reads `null` on real Kuma
// setups, so `active !== false` can't distinguish a paused monitor.) Default
// 10min, comfortably above typical check intervals so a real slow-interval
// outage is never mistaken for stale; env-overridable for slower monitors.
const MONITOR_STALE_MS = positiveMs(process.env.JAGHELM_MONITOR_STALE_MS, 10 * 60 * 1000);

// Kuma status-page heartbeat times are UTC, formatted "YYYY-MM-DD HH:mm:ss.SSS"
// (no zone suffix). Parse as UTC → epoch ms, or null if missing/unparseable.
export function parseBeatTime(t) {
  if (!t || typeof t !== 'string') return null;
  const iso = t.includes('T') ? t : t.replace(' ', 'T');
  const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function staleOrEmpty() {
  if (cachedMonitors && Date.now() - cacheTime < STALE_CEILING_MS) return cachedMonitors;
  return {};
}

// The API key rides an HTTP Basic header (base64 — trivially reversible). Warn
// once at init if it would be transmitted in cleartext to a non-loopback host.
function warnIfCleartext(url, apiKey) {
  if (!apiKey) return;
  try {
    const u = new URL(url);
    const loopback =
      u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
    if (u.protocol === 'http:' && !loopback) {
      log.warn(
        { host: u.hostname },
        'KUMA_API_KEY will be sent over cleartext HTTP to a non-loopback host — use an https:// KUMA_URL'
      );
    }
  } catch {
    // an invalid URL surfaces via the fetch path; nothing to warn about here
  }
}

export function initMonitors(url, apiKey = '') {
  kumaUrl = url;
  kumaApiKey = apiKey || '';
  log.info({ kumaUrl, metrics: !!kumaApiKey }, 'Uptime Kuma URL');
  warnIfCleartext(url, kumaApiKey);
}

/**
 * Fetch monitors from Uptime Kuma's authenticated `/metrics` endpoint.
 *
 * One scrape gives status + response time + 24h uptime for EVERY active monitor
 * (not just status-page ones), keyed on monitor_id. Paused monitors are absent
 * (Kuma stops their metrics), so they drop off the board naturally. Requires
 * Kuma >= 2.1.0 and a configured API key, sent as the HTTP Basic password with a
 * blank username (Kuma's scheme).
 *
 * Returns the monitor map on success, or `null` to signal "fall back to the
 * status-page API": a non-2xx response (e.g. 401 on a bad/missing key), or a
 * pre-2.1 Kuma whose series carry no monitor_id (empty parse).
 */
async function fetchFromMetrics() {
  const auth = Buffer.from(`:${kumaApiKey}`).toString('base64');
  const r = await safeFetch(`${kumaUrl}/metrics`, {
    trusted: true,
    timeoutMs: KUMA_TIMEOUT,
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!r.ok) {
    log.warn({ status: r.status }, 'Kuma /metrics not ok — falling back to status-page API');
    return null;
  }
  const monitors = parseKumaMetrics(await r.text());
  if (Object.keys(monitors).length === 0) {
    log.warn(
      'Kuma /metrics had no monitor_id series (Kuma < 2.1?) — falling back to status-page API'
    );
    return null;
  }
  return monitors;
}

/**
 * Fetch monitors from Kuma's PUBLIC status-page API — the pre-/metrics path, and
 * the fallback when no API key is set. Two calls:
 *   1. /api/status-page/default → monitor names + IDs from publicGroupList
 *   2. /api/status-page/heartbeat/default → heartbeat status, ping, uptime
 * Returns the monitor map, or `null` on a failed/empty fetch.
 */
async function fetchFromStatusPage() {
  const pageR = await safeFetch(`${kumaUrl}/api/status-page/default`, {
    trusted: true,
    timeoutMs: KUMA_TIMEOUT,
  });
  if (!pageR.ok) return null;
  const pageData = await pageR.json();

  const monitorList = (pageData.publicGroupList || []).flatMap((g) => g.monitorList || []);
  if (monitorList.length === 0) {
    log.warn('No monitors found in status page');
    return null;
  }

  // Fetch heartbeat data (separate endpoint in newer Kuma versions)
  let heartbeatList = pageData.heartbeatList || {};
  let uptimeList = pageData.uptimeList || {};

  if (Object.keys(heartbeatList).length === 0) {
    try {
      const hbR = await safeFetch(`${kumaUrl}/api/status-page/heartbeat/default`, {
        trusted: true,
        timeoutMs: KUMA_TIMEOUT,
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
      status: statusFromValue(latest?.status),
      ping: latest?.ping || 0,
      uptime24: uptimeList[`${id}_24`] || 0,
      active: pub.active !== false,
      lastBeatAt: parseBeatTime(latest?.time),
    };
  }
  return monitors;
}

/**
 * Fetch all monitors from Uptime Kuma. Prefers the authenticated `/metrics`
 * endpoint when an API key is set, transparently falling back to the public
 * status-page API otherwise (or when /metrics is unavailable). Both sources
 * produce the SAME monitor-map shape, so every downstream consumer is identical.
 *
 * The stale-serving ceiling (staleOrEmpty) applies to BOTH paths: a sustained
 * Kuma outage surfaces "unknown" rather than freezing the board on stale "up"s.
 */
export async function fetchMonitors(bustCache = false) {
  if (!kumaUrl) return {};

  if (!bustCache && cachedMonitors && Date.now() - cacheTime < CACHE_TTL) {
    return cachedMonitors;
  }

  try {
    let monitors = null;
    let source = null;

    if (kumaApiKey) {
      try {
        monitors = await fetchFromMetrics();
        if (monitors) source = 'metrics';
      } catch (err) {
        log.warn({ err }, 'Kuma /metrics path errored — falling back to status-page API');
      }
    }

    if (!monitors) {
      monitors = await fetchFromStatusPage();
      if (monitors) source = 'status-page';
    }

    if (!monitors) return staleOrEmpty();

    log.info({ count: Object.keys(monitors).length, source }, 'Loaded monitors from Kuma');
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
  return Object.values(monitors)
    .map((m) => m.name)
    .sort();
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
    const exact = monitorList.find((m) => m.name.toLowerCase() === explicitMonitor.toLowerCase());
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
  const containerWords = containerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  for (const m of monitorList) {
    const monitorWords = m.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
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
      { containerName, monitors: monitorList.map((m) => m.name).join(', ') },
      'No match for container among monitors'
    );
  }

  return null;
}

// Call after first full service build to suppress repeat logs
export function markMonitorLogDone() {
  loggedOnce = true;
}

/**
 * Select the monitors that represent a live OUTAGE: reporting `down`, with a
 * FRESH heartbeat (a paused/retired monitor stops beating → goes stale →
 * excluded, so it can't leave a phantom red card — the status-page `active`
 * flag is unreliable for this), and NOT already claimed by a running container
 * this cycle. These become synthesised red "down" cards on the board so an
 * outage stays visible after the container disappears from cAdvisor.
 *
 * `monitors` is the id→monitor map from fetchMonitors (or the `[]` fallback a
 * failed fetch returns — Object.values handles both). `consumedIds` is a Set of
 * monitor ids already rendered as a running container's card. A monitor whose
 * heartbeat time is missing/unparseable (`lastBeatAt == null`) is treated as
 * fresh: we only EXCLUDE on a positively-stale beat, never miss a real outage
 * over a parse gap. Metrics-path monitors (the /metrics source) carry
 * `lastBeatAt: null` + `active: true` by construction — paused monitors are
 * absent from /metrics entirely, so this staleness guard is intentionally INERT
 * for that source.
 */
export function selectOutageMonitors(
  monitors,
  consumedIds,
  { now = Date.now(), staleMs = MONITOR_STALE_MS } = {}
) {
  return Object.values(monitors).filter(
    (m) =>
      m &&
      m.status === 'down' &&
      m.active !== false &&
      !consumedIds.has(m.id) &&
      (m.lastBeatAt == null || now - m.lastBeatAt <= staleMs)
  );
}
