export default {
  name: 'Radarr',
  icon: 'radarr',
  description: 'Movie management and automation',
  auth: 'header',
  authHeader: 'X-Api-Key',
  endpoint: '/api/v3/queue?pageSize=1',
  testEndpoint: '/api/v3/system/status',
  fields: [
    { key: 'queued', label: 'Queued', path: 'totalRecords', format: 'number' },
  ],
  envKeys: {
    url: 'RADARR_URL',
    token: 'RADARR_API_KEY',
  },
};
