export default {
  name: 'Immich',
  icon: 'immich',
  description: 'Self-hosted photo and video backup',
  auth: 'header',
  authHeader: 'X-Api-Key',
  endpoint: '/api/server/statistics',
  fields: [
    { key: 'photos', label: 'Photos', path: 'photos', format: 'number' },
    { key: 'videos', label: 'Videos', path: 'videos', format: 'number' },
    { key: 'usage', label: 'Usage', path: 'usage', format: 'bytes' },
  ],
  envKeys: {
    url: 'JAGHELM_IMMICH_URL',
    token: 'JAGHELM_IMMICH_API_KEY',
  },
};
