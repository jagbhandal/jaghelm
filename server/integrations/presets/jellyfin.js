export default {
  name: 'Jellyfin',
  icon: 'jellyfin',
  description: 'Free media server for movies, TV, and music',
  auth: 'header',
  authHeader: 'X-Emby-Token',
  endpoint: '/System/Info',
  testEndpoint: '/System/Ping',
  fields: [
    { key: 'version', label: 'Version', path: 'Version', format: 'string' },
    { key: 'has_update', label: 'Update', path: 'HasUpdateAvailable', format: 'string' },
  ],
  envKeys: {
    url: 'JELLYFIN_URL',
    token: 'JELLYFIN_API_KEY',
  },
};
