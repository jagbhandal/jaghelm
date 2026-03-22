export default {
  name: 'Lidarr',
  icon: 'lidarr',
  description: 'Music collection management and automation',
  auth: 'header',
  authHeader: 'X-Api-Key',
  endpoint: '/api/v1/queue?pageSize=1',
  testEndpoint: '/api/v1/system/status',
  fields: [
    { key: 'queued', label: 'Queued', path: 'totalRecords', format: 'number' },
  ],
  envKeys: {
    url: 'LIDARR_URL',
    token: 'LIDARR_API_KEY',
  },
};
