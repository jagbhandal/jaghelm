export default {
  name: 'Gotify',
  icon: 'gotify',
  description: 'Self-hosted push notification server',
  auth: 'header',
  authHeader: 'X-Gotify-Key',
  endpoint: '/application',
  fields: [
    { key: 'apps', label: 'Apps', path: '_length', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_GOTIFY_URL',
    token: 'JAGHELM_GOTIFY_TOKEN',
  },
};
