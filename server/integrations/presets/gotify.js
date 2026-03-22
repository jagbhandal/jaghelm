export default {
  name: 'Gotify',
  icon: 'gotify',
  description: 'Self-hosted push notification server',
  auth: 'header',
  authHeader: 'X-Gotify-Key',
  endpoint: '/application',
  testEndpoint: '/version',
  fields: [
    { key: 'apps', label: 'Apps', path: '_length', format: 'number' },
  ],
  envKeys: {
    url: 'GOTIFY_URL',
    token: 'GOTIFY_TOKEN',
  },
};
