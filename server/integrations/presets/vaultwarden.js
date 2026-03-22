export default {
  name: 'Vaultwarden',
  icon: 'vaultwarden',
  description: 'Lightweight Bitwarden-compatible password manager',
  auth: 'header',
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  endpoint: '/admin/users/overview',
  testEndpoint: '/alive',
  fields: [
    { key: 'users', label: 'Users', path: '_length', format: 'number' },
  ],
  envKeys: {
    url: 'VAULTWARDEN_URL',
    token: 'VAULTWARDEN_ADMIN_TOKEN',
  },
};
