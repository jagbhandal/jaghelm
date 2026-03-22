export default {
  name: 'Readarr',
  icon: 'readarr',
  description: 'Book and audiobook management',
  auth: 'header',
  authHeader: 'X-Api-Key',
  endpoint: '/api/v1/queue?pageSize=1',
  testEndpoint: '/api/v1/system/status',
  fields: [
    { key: 'queued', label: 'Queued', path: 'totalRecords', format: 'number' },
  ],
  envKeys: {
    url: 'READARR_URL',
    token: 'READARR_API_KEY',
  },
};
