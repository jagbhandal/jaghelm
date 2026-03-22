export default {
  name: 'Ntfy',
  icon: 'ntfy',
  description: 'Simple push notification service',
  auth: 'none',
  endpoint: '/v1/stats',
  testEndpoint: '/v1/health',
  fields: [
    { key: 'messages', label: 'Messages', path: 'messages', format: 'number' },
    { key: 'topics', label: 'Topics', path: 'topics', format: 'number' },
  ],
  envKeys: {
    url: 'NTFY_URL',
  },
};
