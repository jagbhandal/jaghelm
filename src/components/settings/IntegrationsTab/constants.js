// ── Category definitions for the preset gallery ──
export const CATEGORIES = [
  { id: 'all', label: 'All', icon: '📋' },
  { id: 'dns', label: 'DNS & Ad Blocking', icon: '🛡' },
  { id: 'proxy', label: 'Proxy & Networking', icon: '🌐' },
  { id: 'media-server', label: 'Media Servers', icon: '🎬' },
  { id: 'media-mgmt', label: 'Media Management', icon: '📺' },
  { id: 'downloads', label: 'Downloads', icon: '⬇' },
  { id: 'infra', label: 'Infrastructure', icon: '📊' },
  { id: 'files', label: 'Files & Docs', icon: '📁' },
  { id: 'security', label: 'Security', icon: '🔐' },
  { id: 'dev', label: 'Dev & Code', icon: '💻' },
  { id: 'home', label: 'Home & Notifications', icon: '🏠' },
];

// Map preset types to categories
export const PRESET_CATEGORIES = {
  adguard: 'dns', pihole: 'dns', nextdns: 'dns',
  npm: 'proxy', traefik: 'proxy', cloudflare: 'proxy', tailscale: 'proxy', caddy: 'proxy',
  plex: 'media-server', jellyfin: 'media-server', emby: 'media-server', tautulli: 'media-server',
  sonarr: 'media-mgmt', radarr: 'media-mgmt', lidarr: 'media-mgmt', readarr: 'media-mgmt',
  prowlarr: 'media-mgmt', bazarr: 'media-mgmt', overseerr: 'media-mgmt',
  qbittorrent: 'downloads', transmission: 'downloads', sabnzbd: 'downloads', nzbget: 'downloads', deluge: 'downloads',
  grafana: 'infra', portainer: 'infra', proxmox: 'infra', speedtest: 'infra',
  nextcloud: 'files', photoprism: 'files', immich: 'files', paperless: 'files',
  vaultwarden: 'security', authentik: 'security',
  gitea: 'dev', gitlab: 'dev',
  homeassistant: 'home', frigate: 'home', gotify: 'home', ntfy: 'home', watchtower: 'home', mealie: 'home',
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
