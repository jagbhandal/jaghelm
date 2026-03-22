export default {
  name: 'Caddy',
  icon: 'caddy',
  description: 'Automatic HTTPS reverse proxy',
  auth: 'none',
  endpoint: '/config/',
  testEndpoint: '/config/',
  fields: [
    { key: 'apps', label: 'Apps', path: 'apps._length', format: 'number' },
  ],
  envKeys: {
    url: 'CADDY_URL',
  },
};
