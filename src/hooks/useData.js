import { apiFetch } from '../api/client.js';
import { iconSlugUrl } from '../utils/iconCdn.js';
import { getApiBase } from '../api/baseUrl.js';
// The server's own allowlist (dependency-free), so the client sends the cache
// exactly the URLs it accepts.
import { canonicalIconUrl } from '../../server/icon-sources.js';

// url → { etag, body, seq }: the last 200 whose body parsed, the ETag it came
// with (null when it had none), and the request's place in send order. Written
// in one step, after the parse, so the ETag sent as If-None-Match always
// describes the body a 304 hands back.
const held = new Map();
// Send order: each fetchJson call takes the next number. When requests for one
// URL overlap, the pair from the one sent last is kept, whichever body finishes
// last.
let lastSent = 0;

/**
 * Sentinel for the 304 cold-start edge (304 with no cached 200 body). Distinct
 * from a thrown failure AND from a legitimate `null` 200 payload. Consumers MUST
 * treat it as a success (server confirmed nothing changed) but leave their data
 * untouched — there is no body to apply. Frozen so callers can compare by ===.
 */
export const NOT_MODIFIED_NO_BODY = Object.freeze({ __jaghelm304NoBody: true });

/**
 * Fetch JSON with ETag support.
 *
 * The 304-stable-identity contract: on a 304 with a cached prior 200, returns
 * the SAME reference as that 200, so downstream useState(ref) bails on Object.is
 * and the subtree does NOT re-render (no per-30s-refresh re-allocation). Three
 * distinguishable outcomes so callers track per-source health without conflating
 * "unchanged" with "failed":
 *   1. 200 → freshly-parsed body (new reference).
 *   2. 304 with prior body → that prior reference (stable identity).
 *   3. 304 cold-start, no prior body → NOT_MODIFIED_NO_BODY sentinel (still a success).
 *   network error / non-2xx / non-304 / a body that fails to parse → THROWS; the
 *   only path a caller reads as error.
 *
 * The ETag and the body are stored together, only once the body has parsed, so
 * the stored ETag always describes the body held. A 200 whose body is empty,
 * malformed or cut off by the timeout throws and leaves the held pair as it was
 * (with none held, the next request stays unconditional). A 200 without an ETag
 * replaces the pair with no ETag, so the next request is unconditional. When
 * requests for one URL overlap, the newest request's pair wins: an older one
 * that finishes later stores nothing and returns the newer body.
 *
 * Pass skipEtag=true to force a full fetch (used on first load when state is empty).
 * A forced fetch also bypasses AND refreshes the browser's HTTP cache, which may
 * hold a copy of a response the server marked cacheable (/cron/status sends a
 * max-age). `reload` (not `no-store`) writes the fresh response back, so a later
 * polled fetch can't be served the older cached copy (e.g. a just-deleted cron
 * job reappearing for up to max-age).
 */
async function fetchJson(url, skipEtag = false) {
  const seq = ++lastSent;
  const headers = {};
  const storedEtag = held.get(url)?.etag;
  if (storedEtag && !skipEtag) {
    headers['If-None-Match'] = storedEtag;
  }

  const r = await apiFetch(url, {
    headers,
    signal: AbortSignal.timeout(12000),
    ...(skipEtag && { cache: 'reload' }),
  });

  if (r.status === 304) {
    return held.has(url) ? held.get(url).body : NOT_MODIFIED_NO_BODY;
  }

  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  // Parse before storing anything: a failed parse throws here and leaves the
  // held pair untouched.
  const body = await r.json();
  const cur = held.get(url);
  // A request sent later already stored its pair: keep it and hand back its
  // body, so the caller doesn't step back to this older one.
  if (cur && cur.seq > seq) return cur.body;
  held.set(url, { etag: r.headers.get('ETag') || null, body, seq });
  return body;
}

/**
 * Send a request and parse its JSON body, throwing on a non-2xx status (mirrors
 * the r.ok check fetchJson does for reads) so a failed mutation surfaces as a
 * clear "HTTP 500" instead of being silently swallowed or throwing an opaque
 * JSON-parse error on an HTML error body. A 204 / empty body resolves to null.
 */
async function requestJson(url, opts) {
  const r = await apiFetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (r.status === 204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Fetch all node + service data in one call.
 * Returns null if data unchanged (304), otherwise:
 * { nodes: { [key]: { display_name, subtitle, icon, border_color, metrics, services } } }
 */
export async function getServices(skipEtag) {
  return fetchJson(`${getApiBase()}/services`, skipEtag);
}

// Dashboard display config (refresh cadence + layout flags). This is the SAME
// endpoint the web dashboard reads its `refreshInterval` from, so the mobile app
// can sync its refresh countdown to the exact cadence the web polls at. Display
// settings only — not the secret-bearing service/integration config.
export async function getDisplayConfig(skipEtag) {
  return fetchJson(`${getApiBase()}/display-config`, skipEtag);
}

// Metric history (sparklines). It changes every refresh cycle, so a 304 only
// comes back when no cycle has run since the last fetch.
export async function getMetricHistory(skipEtag) {
  return fetchJson(`${getApiBase()}/history`, skipEtag);
}

// Dedicated section data (not covered by /api/services or /api/integrations).
export async function getUPSStatus(skipEtag) {
  return fetchJson(`${getApiBase()}/ups`, skipEtag);
}
export async function getGiteaActivity(skipEtag) {
  return fetchJson(`${getApiBase()}/gitea/activity`, skipEtag);
}
export async function getCronStatus(skipEtag) {
  return fetchJson(`${getApiBase()}/cron/status`, skipEtag);
}

// Phase 3: Integration Engine
export async function getAllIntegrations(skipEtag) {
  return fetchJson(`${getApiBase()}/integrations`, skipEtag);
}
export async function getIntegrationPresets() {
  return fetchJson(`${getApiBase()}/integrations/presets`);
}
export async function testIntegration(data) {
  return requestJson(`${getApiBase()}/integrations/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
export async function saveIntegration(data) {
  return requestJson(`${getApiBase()}/integrations/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
export async function deleteIntegration(type) {
  return requestJson(`${getApiBase()}/integrations/${type}`, { method: 'DELETE' });
}

export async function deleteCronJob(node, job) {
  const url = `${getApiBase()}/cron/jobs/${encodeURIComponent(node)}/${encodeURIComponent(job)}`;
  try {
    return await requestJson(url, { method: 'DELETE' });
  } catch (err) {
    // 404 = already gone, which is the outcome the caller wanted.
    if (err?.message === 'HTTP 404') return null;
    throw err;
  }
}

export async function getWeather(lat, lon) {
  const r = await apiFetch(`${getApiBase()}/weather?lat=${lat}&lon=${lon}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function getTodos() {
  const r = await apiFetch(`${getApiBase()}/todos`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function saveTodos(todos) {
  // Route through requestJson so a failed save REJECTS (was silently swallowed:
  // the old code awaited the fetch but never checked r.ok, so a 500 looked like
  // a successful save). Caller awaits for completion only; no body is returned.
  await requestJson(`${getApiBase()}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(todos),
  });
}

export async function uploadFile(file, type) {
  const form = new FormData();
  form.append('file', file);
  // HARNESS-GAP (ledger #1): the one remaining raw '/api' literal that bypasses
  // getApiBase(). Intentionally relative — uploadFile is web-only (mobile does no
  // uploads). Promote through getApiBase() if/when mobile ever uploads.
  const r = await apiFetch(`/api/upload?type=${type}`, { method: 'POST', body: form });
  if (!r.ok) throw new Error('Upload failed');
  return r.json();
}

/**
 * Convert an icon-repository URL to a locally-cached URL.
 * Icons are fetched from the CDN once, saved to icon-cache/ in the data dir,
 * and served locally on all subsequent loads. Eliminates 20-30
 * cross-origin CDN round-trips on every cold page load.
 *
 * Only the URLs the server caches go through it: Dashboard Icons and selfh.st
 * icons on jsDelivr or raw.githubusercontent.com (server/icon-sources.js, #255).
 * Every other URL — another repository, a pinned version, any other host,
 * local paths, data URIs — passes through unchanged and loads directly.
 * Empty strings return null.
 *
 * Base-aware: the proxied URL is built from getApiBase() so on mobile it is an
 * absolute same-base URL that reaches Express over Tailscale. Web is unchanged ('/api').
 */
export function cachedIconUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (canonicalIconUrl(url)) {
    return `${getApiBase()}/icons/cached?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export const WEATHER_CODES = {
  0: { icon: '☀️', label: 'Clear' },
  1: { icon: '🌤', label: 'Mostly Clear' },
  2: { icon: '⛅', label: 'Partly Cloudy' },
  3: { icon: '☁️', label: 'Overcast' },
  45: { icon: '🌫', label: 'Foggy' },
  48: { icon: '🌫', label: 'Rime Fog' },
  51: { icon: '🌦', label: 'Light Drizzle' },
  53: { icon: '🌦', label: 'Drizzle' },
  55: { icon: '🌧', label: 'Heavy Drizzle' },
  61: { icon: '🌧', label: 'Light Rain' },
  63: { icon: '🌧', label: 'Rain' },
  65: { icon: '🌧', label: 'Heavy Rain' },
  71: { icon: '🌨', label: 'Light Snow' },
  73: { icon: '🌨', label: 'Snow' },
  75: { icon: '❄️', label: 'Heavy Snow' },
  80: { icon: '🌦', label: 'Showers' },
  81: { icon: '🌧', label: 'Heavy Showers' },
  95: { icon: '⛈', label: 'Thunderstorm' },
};

export const SEARCH_ENGINES = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'brave', name: 'Brave', url: 'https://search.brave.com/search?q=' },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/search?query=' },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
];

export const SERVICE_ICONS = {
  npm: 'nginx-proxy-manager',
  nginx: 'nginx-proxy-manager',
  adguard: 'adguard-home',
  photoprism: 'photoprism',
  photos: 'photoprism',
  vaultwarden: 'vaultwarden',
  vault: 'vaultwarden',
  gitea: 'gitea',
  nextcloud: 'nextcloud',
  cloud: 'nextcloud',
  grafana: 'grafana',
  proxmox: 'proxmox',
  dockge: 'dockge',
  uptime: 'uptime-kuma',
  kuma: 'uptime-kuma',
  code: 'vscode',
  'vs code': 'vscode',
  cloudflare: 'cloudflare',
  tunnel: 'cloudflare',
  tailscale: 'tailscale',
  prometheus: 'prometheus',
  nas: 'nas',
  synology: 'synology',
  ugreen: 'nas',
  ntfy: 'ntfy',
  homebridge: 'homebridge',
  plex: 'plex',
  jellyfin: 'jellyfin',
  pihole: 'pi-hole',
  sonarr: 'sonarr',
  radarr: 'radarr',
  portainer: 'portainer',
  wireguard: 'wireguard',
  backrest: 'backrest',
  casaos: 'casaos',
  collabora:
    'collabora-online',
  watchtower: 'watchtower',
  nut: 'nut',
  homepage: 'homepage',
  jaghelm: '/logo.svg',
};

// SERVICE_ICONS entries sorted by key length DESCENDING. getServiceIcon does a
// substring match, so a shorter key can shadow a longer, more-specific one if we
// iterate in insertion order (e.g. "nas" would match "synology-nas"/"nasa"
// before "synology" ever gets a chance). Matching the LONGEST key first makes the
// result independent of object-literal order and picks the most specific icon.
const SERVICE_ICONS_BY_KEY_LENGTH = Object.entries(SERVICE_ICONS).sort(
  ([a], [b]) => b.length - a.length
);

export function getServiceIcon(name) {
  const lower = (name || '').toLowerCase();
  for (const [key, slug] of SERVICE_ICONS_BY_KEY_LENGTH) {
    // jaghelm is a local asset path; every other value is a Dashboard Icons slug.
    if (lower.includes(key)) return cachedIconUrl(slug.startsWith('/') ? slug : iconSlugUrl(slug));
  }
  return null;
}
