/**
 * JagHelm Data Hooks — v8 Phase 4 Performance
 * 
 * Primary: getServices() — fetches unified /api/services endpoint
 * Legacy: Individual fetch functions kept for dedicated sections (UPS, Gitea, etc.)
 * 
 * ETag support: Each endpoint tracks its last ETag. If the server returns
 * 304 Not Modified, the fetch returns null — signaling "no change, skip setState".
 * This eliminates unnecessary React render cascades on every refresh cycle.
 */

const BASE = '/api';

// ETag tracking per endpoint — persists across fetch calls
const etagStore = new Map();

/**
 * Fetch JSON with ETag support.
 * - Sends If-None-Match header if we have a cached ETag for this URL.
 * - Returns null if server responds 304 (data unchanged).
 * - Returns parsed JSON otherwise.
 * - Pass skipEtag=true to force a full fetch (used on first load when state is empty).
 */
async function fetchJson(url, skipEtag = false) {
  const headers = {};
  const storedEtag = etagStore.get(url);
  if (storedEtag && !skipEtag) {
    headers['If-None-Match'] = storedEtag;
  }

  const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });

  // 304 Not Modified — data hasn't changed since last fetch
  if (r.status === 304) return null;

  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  // Store the new ETag for next request
  const newEtag = r.headers.get('ETag');
  if (newEtag) etagStore.set(url, newEtag);

  return r.json();
}

// ══════════════════════════════════════════════════════════════
// Phase 1: Unified service data
// ══════════════════════════════════════════════════════════════

/**
 * Fetch all node + service data in one call.
 * Returns null if data unchanged (304), otherwise:
 * { nodes: { [key]: { display_name, subtitle, icon, border_color, metrics, services } } }
 */
export async function getServices(skipEtag) {
  return fetchJson(`${BASE}/services`, skipEtag);
}

// ══════════════════════════════════════════════════════════════
// Dedicated section data (not covered by /api/services or /api/integrations)
// ══════════════════════════════════════════════════════════════

export async function getUPSStatus(skipEtag) { return fetchJson(`${BASE}/ups`, skipEtag); }
export async function getGiteaActivity(skipEtag) { return fetchJson(`${BASE}/gitea/activity`, skipEtag); }

// Phase 3: Integration Engine
export async function getAllIntegrations(skipEtag) { return fetchJson(`${BASE}/integrations`, skipEtag); }
export async function getIntegrationPresets() { return fetchJson(`${BASE}/integrations/presets`); }
export async function testIntegration(data) {
  const r = await fetch(`${BASE}/integrations/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return r.json();
}
export async function saveIntegration(data) {
  const r = await fetch(`${BASE}/integrations/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return r.json();
}
export async function deleteIntegration(type) {
  const r = await fetch(`${BASE}/integrations/${type}`, { method: 'DELETE' });
  return r.json();
}

// ══════════════════════════════════════════════════════════════
// Legacy functions (kept: getMonitors used by App.jsx health check)
// ══════════════════════════════════════════════════════════════

export async function getMonitors() { return fetchJson(`${BASE}/uptime/monitors`); }

export async function getWeather(lat, lon) {
  const r = await fetch(`${BASE}/weather?lat=${lat}&lon=${lon}`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function getTodos() {
  const r = await fetch(`${BASE}/todos`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function saveTodos(todos) {
  await fetch(`${BASE}/todos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(todos) });
}

export async function uploadFile(file, type) {
  const form = new FormData();
  form.append('file', file);
  const r = await fetch(`/api/upload?type=${type}`, { method: 'POST', body: form });
  if (!r.ok) throw new Error('Upload failed');
  return r.json();
}

// ══════════════════════════════════════════════════════════════
// Icon URL helper — routes external CDN URLs through local cache
// ══════════════════════════════════════════════════════════════

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
  if (url.startsWith('https://cdn.jsdelivr.net/') || url.startsWith('https://raw.githubusercontent.com/')) {
    return `/api/icons/cached?url=${encodeURIComponent(url)}`;
  }
  // Local paths, data URIs, etc. — pass through
  return url;
}

// ══════════════════════════════════════════════════════════════
// Constants (icons, weather codes, search engines)
// ══════════════════════════════════════════════════════════════

export const WEATHER_CODES = {
  0: { icon: '☀️', label: 'Clear' }, 1: { icon: '🌤', label: 'Mostly Clear' },
  2: { icon: '⛅', label: 'Partly Cloudy' }, 3: { icon: '☁️', label: 'Overcast' },
  45: { icon: '🌫', label: 'Foggy' }, 48: { icon: '🌫', label: 'Rime Fog' },
  51: { icon: '🌦', label: 'Light Drizzle' }, 53: { icon: '🌦', label: 'Drizzle' },
  55: { icon: '🌧', label: 'Heavy Drizzle' }, 61: { icon: '🌧', label: 'Light Rain' },
  63: { icon: '🌧', label: 'Rain' }, 65: { icon: '🌧', label: 'Heavy Rain' },
  71: { icon: '🌨', label: 'Light Snow' }, 73: { icon: '🌨', label: 'Snow' },
  75: { icon: '❄️', label: 'Heavy Snow' }, 80: { icon: '🌦', label: 'Showers' },
  81: { icon: '🌧', label: 'Heavy Showers' }, 95: { icon: '⛈', label: 'Thunderstorm' },
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
  'npm': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nginx-proxy-manager.svg',
  'nginx': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nginx-proxy-manager.svg',
  'adguard': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/adguard-home.svg',
  'photoprism': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/photoprism.svg',
  'photos': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/photoprism.svg',
  'vaultwarden': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/vaultwarden.svg',
  'vault': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/vaultwarden.svg',
  'gitea': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/gitea.svg',
  'nextcloud': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nextcloud.svg',
  'cloud': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nextcloud.svg',
  'grafana': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/grafana.svg',
  'proxmox': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/proxmox.svg',
  'dockge': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/dockge.svg',
  'uptime': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/uptime-kuma.svg',
  'kuma': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/uptime-kuma.svg',
  'code': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/vscode.svg',
  'vs code': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/vscode.svg',
  'cloudflare': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/cloudflare.svg',
  'tunnel': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/cloudflare.svg',
  'tailscale': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/tailscale.svg',
  'prometheus': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/prometheus.svg',
  'nas': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nas.svg',
  'synology': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/synology.svg',
  'ugreen': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/nas.svg',
  'ntfy': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/ntfy.svg',
  'homebridge': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/homebridge.svg',
  'plex': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/plex.svg',
  'jellyfin': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/jellyfin.svg',
  'pihole': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/pi-hole.svg',
  'sonarr': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/sonarr.svg',
  'radarr': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/radarr.svg',
  'portainer': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/portainer.svg',
  'wireguard': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/wireguard.svg',
  'backrest': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/backrest.svg',
  'casaos': 'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/casaos.svg',
  'collabora': 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/collabora-online.svg',
  'watchtower': 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/watchtower.svg',
  'nut': 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/nut.svg',
  'homepage': 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/homepage.svg',
  'jaghelm': '/logo.svg',
};

export function getServiceIcon(name) {
  const lower = (name || '').toLowerCase();
  for (const [key, url] of Object.entries(SERVICE_ICONS)) {
    if (lower.includes(key)) return cachedIconUrl(url);
  }
  return null;
}
