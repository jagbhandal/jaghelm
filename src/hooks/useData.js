/**
 * JagHelm Data Hooks — v8 Phase 1
 * 
 * Primary: getServices() — fetches unified /api/services endpoint
 * Legacy: Individual fetch functions kept for dedicated sections (UPS, Gitea, etc.)
 */

const BASE = '/api';

function addCacheBust(url, bust) {
  if (!bust) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}nocache=${Date.now()}`;
}

async function fetchJson(url, bust) {
  const r = await fetch(addCacheBust(url, bust));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ══════════════════════════════════════════════════════════════
// Phase 1: Unified service data
// ══════════════════════════════════════════════════════════════

/**
 * Fetch all node + service data in one call.
 * Returns: { nodes: { [key]: { display_name, subtitle, icon, border_color, metrics, services } } }
 */
export async function getServices(bust) {
  return fetchJson(`${BASE}/services`, bust);
}

// ══════════════════════════════════════════════════════════════
// Dedicated section data (not yet in /api/services)
// ══════════════════════════════════════════════════════════════

export async function getUPSStatus(bust) { return fetchJson(`${BASE}/ups`, bust); }
export async function getGiteaActivity(bust) { return fetchJson(`${BASE}/gitea/activity`, bust); }
export async function getAdGuardStats(bust) { return fetchJson(`${BASE}/adguard/stats`, bust); }
export async function getNpmStats(bust) { return fetchJson(`${BASE}/npm/stats`, bust); }

// Phase 3: Integration Engine
export async function getAllIntegrations(bust) { return fetchJson(`${BASE}/integrations`, bust); }
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
// Legacy functions (still used by dedicated sections, Widgets, Settings)
// ══════════════════════════════════════════════════════════════

export async function queryPrometheus(query, bust) {
  const d = await fetchJson(`${BASE}/prometheus/query?q=${encodeURIComponent(query)}`, bust);
  return d?.data?.result || [];
}

export async function getMonitors(bust) { return fetchJson(`${BASE}/uptime/monitors`, bust); }
export async function getDockerContainers(bust) { return fetchJson(`${BASE}/docker/containers`, bust); }

export async function getWeather(lat, lon) {
  return fetchJson(`${BASE}/weather?lat=${lat}&lon=${lon}`);
}

export async function getTodos() { return fetchJson(`${BASE}/todos`); }
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
};

export function getServiceIcon(name) {
  const lower = (name || '').toLowerCase();
  for (const [key, url] of Object.entries(SERVICE_ICONS)) {
    if (lower.includes(key)) return url;
  }
  return null;
}
