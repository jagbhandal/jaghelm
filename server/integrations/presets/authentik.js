export default {
  name: 'Authentik',
  icon: 'authentik',
  description: 'Identity provider and SSO platform',
  auth: 'bearer',
  endpoint: '/api/v3/core/users/?page_size=1',
  testEndpoint: '/api/v3/root/config/',
  fields: [
    { key: 'users', label: 'Users', path: 'pagination.count', format: 'number' },
  ],
  envKeys: {
    url: 'AUTHENTIK_URL',
    token: 'AUTHENTIK_TOKEN',
  },
};
