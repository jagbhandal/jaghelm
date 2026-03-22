export default {
  name: 'Sonarr',
  icon: 'sonarr',
  description: 'TV series management and automation',
  auth: 'header',
  authHeader: 'X-Api-Key',
  endpoint: '/api/v3/queue?pageSize=1',
  testEndpoint: '/api/v3/system/status',
  fields: [
    { key: 'queued', label: 'Queued', path: 'totalRecords', format: 'number' },
  ],
  envKeys: {
    url: 'SONARR_URL',
    token: 'SONARR_API_KEY',
  },
};
