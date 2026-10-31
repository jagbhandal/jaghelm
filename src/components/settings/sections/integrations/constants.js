// ── Category definitions for the preset gallery ──
export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'dns', label: 'DNS & Ad Blocking' },
  { id: 'proxy', label: 'Proxy & Networking' },
  { id: 'media-server', label: 'Media Servers' },
  { id: 'media-mgmt', label: 'Media Management' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'infra', label: 'Infrastructure' },
  { id: 'files', label: 'Files & Docs' },
  { id: 'security', label: 'Security' },
  { id: 'dev', label: 'Dev & Code' },
  { id: 'home', label: 'Home & Notifications' },
];

// Presets that were removed from JagHelm, by type, with the name to show. An
// entry saved under one is listed as "No longer supported" so it can be
// deleted; the server skips it (server/integrations/registry.js RETIRED_PRESETS).
export const RETIRED_PRESETS = { nextcloud: 'Nextcloud', grafana: 'Grafana' };

// Map preset types to categories
export const PRESET_CATEGORIES = {
  adguard: 'dns',
  pihole: 'dns',
  nextdns: 'dns',
  npm: 'proxy',
  traefik: 'proxy',
  cloudflare: 'proxy',
  tailscale: 'proxy',
  caddy: 'proxy',
  plex: 'media-server',
  jellyfin: 'media-server',
  emby: 'media-server',
  tautulli: 'media-server',
  sonarr: 'media-mgmt',
  radarr: 'media-mgmt',
  lidarr: 'media-mgmt',
  readarr: 'media-mgmt',
  prowlarr: 'media-mgmt',
  bazarr: 'media-mgmt',
  overseerr: 'media-mgmt',
  qbittorrent: 'downloads',
  transmission: 'downloads',
  sabnzbd: 'downloads',
  nzbget: 'downloads',
  deluge: 'downloads',
  portainer: 'infra',
  proxmox: 'infra',
  speedtest: 'infra',
  photoprism: 'files',
  immich: 'files',
  paperless: 'files',
  vaultwarden: 'security',
  authentik: 'security',
  gitea: 'dev',
  gitlab: 'dev',
  homeassistant: 'home',
  frigate: 'home',
  gotify: 'home',
  ntfy: 'home',
  mealie: 'home',
};

// Auth type labels and field requirements
export const AUTH_LABELS = {
  none: 'No Authentication',
  basic: 'Basic Auth (Username + Password)',
  bearer: 'Bearer Token',
  header: 'API Key (Custom Header)',
  query: 'API Key (Query Parameter)',
  session: 'Session Login (Username + Password)',
  oauth2: 'OAuth2 (Client ID + Secret)',
};

// What credential fields each auth type needs
export const AUTH_FIELDS = {
  none: [],
  basic: ['username', 'password'],
  bearer: ['token'],
  header: ['token'],
  query: ['token'],
  session: ['username', 'password'],
  oauth2: ['username', 'password'],
};

/**
 * True for the marker the config read sends for a stored credential,
 * { "$stored": true } (#413): for an integration's URL, one that carries a
 * credential (#422), which the form never shows.
 */
export const isStoredMarker = (v) =>
  !!v && typeof v === 'object' && Object.keys(v).length === 1 && v.$stored === true;
