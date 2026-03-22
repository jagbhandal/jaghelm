export default {
  name: 'Watchtower',
  icon: 'watchtower',
  description: 'Automated Docker container image updates',
  auth: 'bearer',
  endpoint: '/v1/update',
  testEndpoint: '/v1/update',
  fields: [
    { key: 'scanned', label: 'Scanned', path: 'scanned', format: 'number' },
    { key: 'updated', label: 'Updated', path: 'updated', format: 'number' },
    { key: 'failed', label: 'Failed', path: 'failed', format: 'number' },
  ],
  envKeys: {
    url: 'WATCHTOWER_URL',
    token: 'WATCHTOWER_HTTP_API_TOKEN',
  },
};
