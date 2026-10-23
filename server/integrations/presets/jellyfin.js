export default {
  name: 'Jellyfin',
  icon: 'jellyfin',
  description: 'Free media server for movies, TV, and music',
  auth: 'header',
  authHeader: 'X-Emby-Token',
  endpoint: '/System/Info',
  fields: [
    { key: 'version', label: 'Version', path: 'Version', format: 'string' },
    { key: 'has_update', label: 'Update', path: 'HasUpdateAvailable', format: 'string' },
  ],
  envKeys: {
    url: 'JAGHELM_JELLYFIN_URL',
    token: 'JAGHELM_JELLYFIN_API_KEY',
  },
};
