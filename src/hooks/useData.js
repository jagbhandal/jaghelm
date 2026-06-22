import { apiFetch } from '../api/client.js';

const BASE = '/api';

const etagStore = new Map();
const resultStore = new Map();

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
 *   network error / non-2xx / non-304 → THROWS; the only path a caller reads as error.
 *
 * Pass skipEtag=true to force a full fetch (used on first load when state is empty).
 */
async function fetchJson(url, skipEtag = false) {
  const headers = {};
  const storedEtag = etagStore.get(url);
  if (storedEtag && !skipEtag) {
    headers['If-None-Match'] = storedEtag;
  }

  const r = await apiFetch(url, { headers, signal: AbortSignal.timeout(12000) });

  if (r.status === 304) {
    return resultStore.has(url) ? resultStore.get(url) : NOT_MODIFIED_NO_BODY;
  }

  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const newEtag = r.headers.get('ETag');
  if (newEtag) etagStore.set(url, newEtag);

  const body = await r.json();
  resultStore.set(url, body);
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
  return fetchJson(`${BASE}/services`, skipEtag);
}

// Metric history (sparklines). Not ETag-cached server-side — it changes every
// cycle by design — so this always returns a fresh body.
export async function getMetricHistory() {
  return fetchJson(`${BASE}/history`);
}

// Dedicated section data (not covered by /api/services or /api/integrations).
export async function getUPSStatus(skipEtag) {
  return fetchJson(`${BASE}/ups`, skipEtag);
}
export async function getGiteaActivity(skipEtag) {
  return fetchJson(`${BASE}/gitea/activity`, skipEtag);
}
export async function getCronStatus(skipEtag) {
  return fetchJson(`${BASE}/cron/status`, skipEtag);
}

// Phase 3: Integration Engine
export async function getAllIntegrations(skipEtag) {
  return fetchJson(`${BASE}/integrations`, skipEtag);
}
export async function getIntegrationPresets() {
  return fetchJson(`${BASE}/integrations/presets`);
}
export async function testIntegration(data) {
  return requestJson(`${BASE}/integrations/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
export async function saveIntegration(data) {
  return requestJson(`${BASE}/integrations/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
export async function deleteIntegration(type) {
  return requestJson(`${BASE}/integrations/${type}`, { method: 'DELETE' });
}

// Legacy functions (kept: getMonitors used by App.jsx health check).
export async function getMonitors() {
  return fetchJson(`${BASE}/uptime/monitors`);
}

export async function getWeather(lat, lon) {
  const r = await apiFetch(`${BASE}/weather?lat=${lat}&lon=${lon}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function getTodos() {
  const r = await apiFetch(`${BASE}/todos`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function saveTodos(todos) {
  // Route through requestJson so a failed save REJECTS (was silently swallowed:
  // the old code awaited the fetch but never checked r.ok, so a 500 looked like
  // a successful save). Caller awaits for completion only; no body is returned.
  await requestJson(`${BASE}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(todos),
  });
}

export async function uploadFile(file, type) {
  const form = new FormData();
  form.append('file', file);
  const r = await apiFetch(`/api/upload?type=${type}`, { method: 'POST', body: form });
  if (!r.ok) throw new Error('Upload failed');
  return r.json();
}

/**
 * Convert an external CDN icon URL to a locally-cached URL.
 * Icons are fetched from the CDN once, saved to data/icon-cache/,
 * and served locally on all subsequent loads. Eliminates 20-30
 * cross-origin CDN round-trips on every cold page load.
 *
 * Non-CDN URLs (local paths, data URIs) pass through unchanged.
 * Emojis and empty strings return null.
 */
export function cachedIconUrl(url) {
  if (!url || typeof url !== 'string') return null;
  // Only proxy external CDN URLs
  if (
    url.startsWith('https://cdn.jsdelivr.net/') ||
    url.startsWith('https://raw.githubusercontent.com/')
  ) {
    return `/api/icons/cached?url=${encodeURIComponent(url)}`;
  }
  // Local paths, data URIs, etc. — pass through
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
  npm: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nginx-proxy-manager.svg',
  nginx: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nginx-proxy-manager.svg',
  adguard: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/adguard-home.svg',
  photoprism: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/photoprism.svg',
  photos: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/photoprism.svg',
  vaultwarden: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/vaultwarden.svg',
  vault: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/vaultwarden.svg',
  gitea: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/gitea.svg',
  nextcloud: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nextcloud.svg',
  cloud: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nextcloud.svg',
  grafana: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/grafana.svg',
  proxmox: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/proxmox.svg',
  dockge: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/dockge.svg',
  uptime: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/uptime-kuma.svg',
  kuma: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/uptime-kuma.svg',
  code: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/vscode.svg',
  'vs code': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/vscode.svg',
  cloudflare: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/cloudflare.svg',
  tunnel: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/cloudflare.svg',
  tailscale: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/tailscale.svg',
  prometheus: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/prometheus.svg',
  nas: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nas.svg',
  synology: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/synology.svg',
  ugreen: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nas.svg',
  ntfy: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/ntfy.svg',
  homebridge: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/homebridge.svg',
  plex: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/plex.svg',
  jellyfin: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/jellyfin.svg',
  pihole: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/pi-hole.svg',
  sonarr: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/sonarr.svg',
  radarr: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/radarr.svg',
  portainer: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/portainer.svg',
  wireguard: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/wireguard.svg',
  backrest: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/backrest.svg',
  casaos: 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/casaos.svg',
  collabora:
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/collabora-online.svg',
  watchtower: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/watchtower.svg',
  nut: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/nut.svg',
  homepage: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/homepage.svg',
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
  for (const [key, url] of SERVICE_ICONS_BY_KEY_LENGTH) {
    if (lower.includes(key)) return cachedIconUrl(url);
  }
  return null;
}
