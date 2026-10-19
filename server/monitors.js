/**
 * JagHelm Monitor Matcher
 * Fetches monitors from Uptime Kuma and matches them to discovered containers.
 */

import { createLogger } from './util/logger.js';
import { createSourceHealthLog } from './util/sourceHealthLog.js';
import { safeFetch } from './httpClient.js';
import { positiveMs } from './util/env.js';
import { parseKumaMetrics, statusFromValue } from './kumaMetrics.js';

const log = createLogger('monitors');

const KUMA_TIMEOUT = 8000;

let kumaUrl = null;
let kumaApiKey = '';
let cachedMonitors = null;
let cacheTime = 0;
// What the last successful load looked like, so a reload logs at info only when
// it differs; null before the first load. A Kuma outage and its recovery are
// logged once each by `reportKuma` (#232), not on every failed load.
let lastLoad = null;
const reportKuma = createSourceHealthLog('kuma', log);
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
 * Returns the monitor map. Throws when no monitors could be loaded: the request
 * failed, Kuma answered non-2xx, or the status page lists no monitors.
 */
async function fetchFromStatusPage() {
  const pageR = await safeFetch(`${kumaUrl}/api/status-page/default`, {
    trusted: true,
    timeoutMs: KUMA_TIMEOUT,
  });
  if (!pageR.ok) throw new Error(`Kuma status page answered HTTP ${pageR.status}`);
  const pageData = await pageR.json();

  const monitorList = (pageData?.publicGroupList || []).flatMap((g) => g.monitorList || []);
  if (monitorList.length === 0) throw new Error('Kuma status page lists no monitors');

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
 * Resolves to `{ ok, monitors }`. `ok` is false when no monitors were loaded on
 * this call (#232): the request failed, Kuma answered non-2xx, or it answered
 * with no monitors (Kuma still starting, or nothing on the status page). The
 * caller can then tell "Kuma is down" from "these services are up".
 *
 * On a failed load `monitors` holds the last-known statuses until they are
 * STALE_CEILING_MS old, then {}: the stale-serving ceiling applies to BOTH
 * paths, so a sustained Kuma outage surfaces "unknown" rather than freezing the
 * board on stale "up"s. `error` says why it failed.
 *
 * A failed load logs at debug. The outage is logged once, as a warning on the
 * first failed load and an info line on the first load after it (reportKuma),
 * the same pair as Prometheus.
 */
export async function fetchMonitors(bustCache = false) {
  if (!kumaUrl) return { ok: true, monitors: {} };

  if (!bustCache && cachedMonitors && Date.now() - cacheTime < CACHE_TTL) {
    return { ok: true, monitors: cachedMonitors };
  }

  let monitors = null;
  let source = null;
  try {
    let metricsErr = null;
    if (kumaApiKey) {
      try {
        monitors = await fetchFromMetrics();
        if (monitors) source = 'metrics';
      } catch (err) {
        metricsErr = err;
      }
    }

    if (!monitors) {
      monitors = await fetchFromStatusPage();
      source = 'status-page';
      // Warned only once the fallback has loaded: with both paths failing it
      // is a Kuma outage, logged once below.
      if (metricsErr) log.warn({ err: metricsErr }, 'Kuma /metrics path errored — falling back to status-page API');
    }
  } catch (err) {
    const error = err?.message || String(err);
    log.debug(
      { err, staleCeilingMin: STALE_CEILING_MS / 60_000 },
      'No monitors loaded from Kuma — serving last-known statuses, if any, until they go stale'
    );
    reportKuma({ ok: false, error });
    return { ok: false, error, monitors: staleOrEmpty() };
  }

  reportKuma({ ok: true });
  // Runs every refresh cycle: info only for the first load or a change in what
  // Kuma returned; debug otherwise.
  const load = { count: Object.keys(monitors).length, source };
  const changed = !lastLoad || lastLoad.count !== load.count || lastLoad.source !== load.source;
  (changed ? log.info : log.debug)(load, 'Loaded monitors from Kuma');
  lastLoad = load;
  cachedMonitors = monitors;
  cacheTime = Date.now();
  return { ok: true, monitors };
}

/**
 * Get a flat array of all monitor names (for Settings UI dropdowns).
 */
export async function getMonitorNames() {
  const { monitors } = await fetchMonitors();
  return Object.values(monitors)
    .map((m) => m.name)
    .sort();
}

// ── Matching monitors to containers (#240) ───────────────────────────────
//
// A Kuma monitor is one service, so it marks one container: a down monitor
// paints one card red and sends one push. Matching used to take each
// container's first lookalike monitor without checking whether another
// container already had it, so one down monitor could paint every container
// sharing a word with it red, on every node, and other monitors were never
// matched at all. assignMonitors() now assigns the monitors to the containers
// of a whole cycle at once, best match first.

// How good a kind of name match is, the higher the better. Within a kind, a
// higher score wins.
const KIND_RANK = { exact: 4, url: 3, contains: 2, word: 1 };

// Words that mark a container as a helper of a stack rather than the service
// a monitor checks: a monitor "Immich" matches immich-server, immich-redis,
// immich-postgres and immich-machine-learning equally well by name, and goes to
// immich-server. Only a tie-break between equally good matches.
const HELPER_WORDS = new Set([
  'agent',
  'backup',
  'cron',
  'db',
  'exporter',
  'learning',
  'machine',
  'mariadb',
  'ml',
  'mongo',
  'mysql',
  'postgres',
  'postgresql',
  'proxy',
  'redis',
  'runner',
  'sync',
  'valkey',
  'worker',
]);

const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const wordsOf = (s) =>
  String(s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The first label of a monitor name that is a URL or hostname ("grafana" from
// "https://grafana.example.com" or "grafana.example.com"); null for any other
// name, or for a label with no letter (the "192" of an IP address).
function hostLabel(name) {
  if (!name.includes('.')) return null;
  const m = /(?:https?:\/\/)?([a-z0-9-]+)\./i.exec(name);
  const label = m ? normalize(m[1]) : '';
  return /[a-z]/.test(label) ? label : null;
}

/**
 * How well a container name matches a monitor name: `{ kind, score, helper }`,
 * or null when they don't match. Names compare lowercased with everything but
 * letters and digits removed ("Home Assistant" is "homeassistant").
 *
 * - `exact`: the names are equal.
 * - `url`: the monitor name is a URL or hostname whose first label is the
 *   container name ("grafana.example.com" for grafana).
 * - `contains`: one name contains the other, or the container name and that
 *   first label do; the score is the length of the shorter one.
 * - `word`: the names share a word of 4 letters or more ("gateway" in
 *   gateway-npm and "Pi Gateway (Ping)"); the score is the total length of the
 *   words of 3 letters or more they share.
 *
 * `helper` is true when the container's own words, those not in the monitor
 * name, include one of HELPER_WORDS (redis, db, cron, …).
 */
export function scoreMatch(containerName, monitorName) {
  const cn = normalize(containerName);
  const mn = normalize(monitorName);
  if (!cn || !mn) return null;
  const monitorWords = new Set(wordsOf(monitorName));
  const helper = wordsOf(containerName).some((w) => !monitorWords.has(w) && HELPER_WORDS.has(w));
  if (cn === mn) return { kind: 'exact', score: cn.length, helper };
  const host = hostLabel(String(monitorName));
  if (host === cn) return { kind: 'url', score: cn.length, helper };
  let overlap = 0;
  if (mn.includes(cn) || cn.includes(mn)) overlap = Math.min(cn.length, mn.length);
  if (host && (host.includes(cn) || cn.includes(host))) {
    overlap = Math.max(overlap, Math.min(cn.length, host.length));
  }
  if (overlap > 0) return { kind: 'contains', score: overlap, helper };
  const shared = [...new Set(wordsOf(containerName))].filter((w) => w.length >= 3 && monitorWords.has(w));
  if (shared.some((w) => w.length >= 4)) {
    return { kind: 'word', score: shared.reduce((n, w) => n + w.length, 0), helper };
  }
  return null;
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Kuma's ids are numbers; compare them as numbers when both are.
function compareIds(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  return compareText(String(a), String(b));
}

// The order candidate pairs are assigned in: the better match first, then the
// tie-breaks. A total order, so the result never depends on the order the
// containers or monitors came in.
function comparePairs(a, b) {
  return (
    b.rank - a.rank ||
    b.score - a.score ||
    Number(a.helper) - Number(b.helper) ||
    a.nodeRank - b.nodeRank ||
    compareText(a.nodeKey, b.nodeKey) ||
    compareText(a.container, b.container) ||
    compareIds(a.monitor.id, b.monitor.id)
  );
}

// ── Explicit mappings (services.yaml) ────────────────────────────────────

// A mapping's value: a monitor name, or false for "no monitor". Anything else
// (no key, null, '') is no mapping.
function mappingValue(v) {
  if (v === false) return false;
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * The explicit mapping services.yaml gives `container` on the node `nodeKey`,
 * or null when it gives none:
 *
 *     services:
 *       gateway-npm:
 *         monitor_per_node:      # keyed by the node keys under `nodes:`
 *           pi1: NPM Pi Primary
 *           pi2: NPM Pi Secondary
 *       immich-server:
 *         monitor: Immich        # on every node it runs on
 *       gateway-tunnel:
 *         monitor: false         # no monitor, and no name matching
 *
 * `monitor_per_node[nodeKey]` comes first, then `monitor`: a node with no entry
 * there falls back to `monitor`, and to name matching when that is not set
 * either. A value is a Kuma monitor's name (compared case-insensitively), or
 * `false` for no monitor at all.
 *
 * Returns `{ monitor, setting }`: `monitor` is the name or false, `setting` the
 * key it came from ("monitor" or "monitor_per_node.pi1").
 */
export function mappingOf(services, container, nodeKey) {
  const entry = isPlainObject(services) && Object.hasOwn(services, container) ? services[container] : null;
  if (!isPlainObject(entry)) return null;
  const perNode = entry.monitor_per_node;
  if (isPlainObject(perNode) && nodeKey != null && Object.hasOwn(perNode, nodeKey)) {
    const v = mappingValue(perNode[nodeKey]);
    if (v !== null) return { monitor: v, setting: `monitor_per_node.${nodeKey}` };
  }
  const v = mappingValue(entry.monitor);
  return v === null ? null : { monitor: v, setting: 'monitor' };
}

// Every monitor name services.yaml maps a container to, on any node, lowercased.
// The monitors of these names are left out of name matching whether or not
// their containers are on the board this cycle.
function mappedMonitorNames(services) {
  const names = new Set();
  if (!isPlainObject(services)) return names;
  for (const entry of Object.values(services)) {
    if (!isPlainObject(entry)) continue;
    const values = [entry.monitor, ...(isPlainObject(entry.monitor_per_node) ? Object.values(entry.monitor_per_node) : [])];
    for (const v of values) if (typeof v === 'string' && v !== '') names.add(v.toLowerCase());
  }
  return names;
}

// Warnings already logged: one per problem per boot, however many cycles it
// stays.
const mappingWarned = new Set();
function warnOnce(key, fields, msg) {
  if (mappingWarned.has(key)) return;
  mappingWarned.add(key);
  log.warn(fields, msg);
}

function warnExplicitMissing(containerName, setting, explicitMonitor) {
  warnOnce(
    `missing\u0000${containerName}\u0000${setting}\u0000${explicitMonitor}`,
    { containerName, explicitMonitor, setting },
    'Explicit monitor mapping names no Kuma monitor, or a paused one — the container shows no monitor until the mapping or the monitor is fixed (logged once per mapping)'
  );
}

/**
 * Check the monitor mappings in services.yaml, and warn once per problem: a
 * `monitor_per_node` key that is no node under `nodes:` (the mapping applies
 * nowhere), and a `monitor` or `monitor_per_node` value that is no monitor name
 * and not false (it is ignored). The save route rejects a wrong shape (see
 * util/configSchema.js); this catches a hand-edited file. `nodeKeys` null skips
 * the node check.
 */
export function checkMonitorMappings(services, nodeKeys) {
  if (!isPlainObject(services)) return;
  const known = nodeKeys ? new Set(nodeKeys) : null;
  const valid = (v) => v == null || v === false || typeof v === 'string';
  for (const [containerName, entry] of Object.entries(services)) {
    if (!isPlainObject(entry)) continue;
    if (!valid(entry.monitor)) {
      warnOnce(
        `value\u0000${containerName}\u0000monitor`,
        { containerName, setting: 'monitor' },
        'services.yaml: a monitor mapping must be a monitor name or false — ignored (logged once)'
      );
    }
    const perNode = entry.monitor_per_node;
    if (perNode == null) continue;
    if (!isPlainObject(perNode)) {
      warnOnce(
        `shape\u0000${containerName}`,
        { containerName, setting: 'monitor_per_node' },
        'services.yaml: monitor_per_node must map node keys to monitor names — ignored (logged once)'
      );
      continue;
    }
    for (const [nodeKey, v] of Object.entries(perNode)) {
      const setting = `monitor_per_node.${nodeKey}`;
      if (!valid(v)) {
        warnOnce(
          `value\u0000${containerName}\u0000${setting}`,
          { containerName, setting },
          'services.yaml: a monitor mapping must be a monitor name or false — ignored (logged once)'
        );
      }
      if (known && !known.has(nodeKey)) {
        warnOnce(
          `node\u0000${containerName}\u0000${nodeKey}`,
          { containerName, nodeKey, nodes: [...known] },
          'services.yaml: monitor_per_node names a node that is not under nodes:, so that mapping applies nowhere (logged once)'
        );
      }
    }
  }
}

/**
 * Assign Kuma monitors to the containers of one refresh cycle, all at once.
 *
 * `candidates` are `{ container, nodeKey, stopped }`, one per container on a
 * node (the same name on two nodes is two candidates); `stopped` marks a
 * container that stopped in the last 24 hours. `monitors` is fetchMonitors' id
 * → monitor map. `services` is services.yaml's `services:` (see mappingOf).
 * `nodeOrder` is the board's node order.
 *
 * Returns an array parallel to `candidates`: the monitor each one gets, or null.
 *
 * 1. An explicit mapping gives the container the monitor of that name, compared
 *    case-insensitively, whatever the names; `false` gives it none. A container
 *    with a mapping is left out of name matching. A monitor mapped anywhere in
 *    services.yaml goes only to the containers mapped to it: to several when
 *    several are, and to none while they are all absent, so a lookalike never
 *    takes it meanwhile. When no monitor has the mapped name, the container
 *    gets no monitor, and a warning names the mapping once. Not while Kuma has
 *    given no monitors at all, when every mapping would look broken.
 * 2. Every other monitor goes to one container at most, by name. Every
 *    (container, monitor) pair that matches (scoreMatch) is ranked, and pairs
 *    are taken best first, each only while both its container and its monitor
 *    are still free. A pair ranks by the kind of match (exact, then URL, then
 *    contains, then a shared word), then its score; between equal matches, a
 *    container that is not a helper (redis, db, …), then the board's node
 *    order, then the container name, then the monitor id.
 *
 *    A monitor goes only to a container with the best kind of match any
 *    container has with it. When that container holds a better monitor, the
 *    monitor is left unassigned rather than taken by a weaker lookalike:
 *    "Gitea SSH" does not go to gitea-runner because gitea holds "Gitea".
 *
 * A stopped container gets a monitor only while the monitor is down, so the
 * outage shows on that container's card. Once the monitor is up, a running
 * container can have it.
 *
 * Ties go by the board's node order, so the result depends only on this
 * cycle's inputs. A replica (one container name on two nodes) is pinned to a
 * node with `monitor_per_node`.
 */
export function assignMonitors({ candidates, monitors, services = {}, nodeOrder = [] }) {
  const result = candidates.map(() => null);
  const monitorList = Object.values(monitors || {})
    .filter((m) => m && m.id != null && typeof m.name === 'string')
    .sort((a, b) => compareIds(a.id, b.id));
  if (monitorList.length === 0) return result;

  // Two monitors with one name: an explicit mapping takes the lower id.
  const byName = new Map();
  for (const m of monitorList) {
    const key = m.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, m);
  }
  // A stopped container gets only a down monitor.
  const eligible = (c, m) => !c.stopped || m.status === 'down';

  const reserved = new Set(); // monitor ids mapped explicitly, from the config
  for (const name of mappedMonitorNames(services)) {
    const m = byName.get(name);
    if (m) reserved.add(m.id);
  }

  const byNameMatching = []; // candidate indexes without an explicit mapping
  candidates.forEach((c, i) => {
    const mapping = mappingOf(services, c.container, c.nodeKey);
    if (!mapping) {
      byNameMatching.push(i);
      return;
    }
    if (mapping.monitor === false) return;
    const m = byName.get(mapping.monitor.toLowerCase());
    if (!m) warnExplicitMissing(c.container, mapping.setting, mapping.monitor);
    else if (eligible(c, m)) result[i] = m;
  });

  const nodeRanks = new Map(nodeOrder.map((nodeKey, i) => [nodeKey, i]));
  const scores = new Map(); // container name -> [monitor, match][]
  const scoresOf = (name) => {
    if (!scores.has(name)) {
      const list = [];
      for (const m of monitorList) {
        if (reserved.has(m.id)) continue;
        const match = scoreMatch(name, m.name);
        if (match) list.push([m, match]);
      }
      scores.set(name, list);
    }
    return scores.get(name);
  };

  const pairs = [];
  const bestRank = new Map(); // monitor id -> the best kind of match it has
  for (const i of byNameMatching) {
    const c = candidates[i];
    for (const [monitor, match] of scoresOf(c.container)) {
      if (!eligible(c, monitor)) continue;
      const rank = KIND_RANK[match.kind];
      bestRank.set(monitor.id, Math.max(bestRank.get(monitor.id) ?? 0, rank));
      pairs.push({
        i,
        monitor,
        container: String(c.container),
        nodeKey: String(c.nodeKey ?? ''),
        rank,
        score: match.score,
        helper: match.helper,
        nodeRank: nodeRanks.get(c.nodeKey) ?? nodeOrder.length,
      });
    }
  }
  pairs.sort(comparePairs);

  const taken = new Set(); // monitor ids
  for (const p of pairs) {
    if (result[p.i] || taken.has(p.monitor.id) || p.rank < bestRank.get(p.monitor.id)) continue;
    result[p.i] = p.monitor;
    taken.add(p.monitor.id);
  }
  return result;
}

let unmatchedLogged = false;

/**
 * Log, once per boot, the running containers that matched no Kuma monitor, in a
 * single line (it used to be one line per container), to help debug matching.
 *
 * Waits until there is something to match against: with no monitors loaded (Kuma
 * down or slow at boot) every container would look unmatched, and with no
 * containers discovered (Prometheus or cAdvisor not ready) the list would be
 * empty, so neither uses up the one line. Returns true once the line is spent,
 * including when every container matched and there was nothing to say.
 */
export function logUnmatchedContainers({ unmatched, containerCount, monitors }) {
  if (unmatchedLogged) return false;
  const monitorNames = Object.values(monitors || {}).map((m) => m.name);
  if (monitorNames.length === 0 || !containerCount) return false;
  unmatchedLogged = true;
  if (unmatched.length > 0) {
    log.info(
      { count: unmatched.length, containers: [...unmatched].sort(), monitors: monitorNames.sort() },
      'Containers with no matching Kuma monitor (logged once per boot)'
    );
  }
  return true;
}

/**
 * The monitors no running container got this cycle that are `up` or `down`, in
 * the map's order. assembleServices places all of them in one pass (#390): a
 * down one becomes a synthesised red card, so an outage stays visible after the
 * container disappears from cAdvisor; an up one is an entry only the push
 * snapshot reads, under the same uid, so its recovery is sent.
 *
 * Each has a FRESH heartbeat: a paused/retired monitor stops beating, goes
 * stale and is excluded, so it can't leave a phantom red card or send a false
 * recovery (the status-page `active` flag is unreliable for this, though
 * `active: false` excludes one too). A pending one (`unknown`) and one Kuma no
 * longer has are not in it either, and nor is one already claimed by a running
 * container this cycle.
 *
 * `monitors` is the id→monitor map from fetchMonitors (an array works too:
 * Object.values handles both). `consumedIds` is a Set of
 * monitor ids already rendered as a running container's card. A monitor whose
 * heartbeat time is missing/unparseable (`lastBeatAt == null`) is treated as
 * fresh: we only EXCLUDE on a positively-stale beat, never miss a real outage
 * over a parse gap. Metrics-path monitors (the /metrics source) carry
 * `lastBeatAt: null` + `active: true` by construction — paused monitors are
 * absent from /metrics entirely, so this staleness guard is intentionally INERT
 * for that source.
 */
export function selectUnclaimedMonitors(
  monitors,
  consumedIds,
  { now = Date.now(), staleMs = MONITOR_STALE_MS } = {}
) {
  return Object.values(monitors).filter(
    (m) =>
      m &&
      (m.status === 'down' || m.status === 'up') &&
      m.active !== false &&
      !consumedIds.has(m.id) &&
      (m.lastBeatAt == null || now - m.lastBeatAt <= staleMs)
  );
}
