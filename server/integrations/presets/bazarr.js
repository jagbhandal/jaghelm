export default {
  name: 'Bazarr',
  icon: 'bazarr',
  description: 'Subtitle management for Sonarr and Radarr',
  auth: 'header',
  authHeader: 'X-API-KEY',
  endpoint: '/api/system/status',
  testEndpoint: '/api/system/health',
  fields: [
    { key: 'version', label: 'Version', path: 'data.bazarr_version', format: 'string' },
  ],
  envKeys: {
    url: 'BAZARR_URL',
    token: 'BAZARR_API_KEY',
  },
};
