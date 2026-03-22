export default {
  name: 'Immich',
  icon: 'immich',
  description: 'Self-hosted photo and video backup',
  auth: 'header',
  authHeader: 'x-api-key',
  endpoint: '/api/server/statistics',
  testEndpoint: '/api/server/ping',
  fields: [
    { key: 'photos', label: 'Photos', path: 'photos', format: 'number' },
    { key: 'videos', label: 'Videos', path: 'videos', format: 'number' },
    { key: 'usage', label: 'Usage', path: 'usage', format: 'bytes' },
  ],
  envKeys: {
    url: 'IMMICH_URL',
    token: 'IMMICH_API_KEY',
  },
};
