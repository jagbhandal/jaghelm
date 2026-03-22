export default {
  name: 'Cloudflare Tunnels',
  icon: 'cloudflare',
  description: 'Secure tunnels to expose local services',
  auth: 'bearer',
  endpoint: '/client/v4/accounts/{account_id}/tunnels?is_deleted=false',
  testEndpoint: '/client/v4/user/tokens/verify',
  fields: [
    { key: 'tunnels', label: 'Tunnels', path: 'result._length', format: 'number' },
  ],
  envKeys: {
    url: 'CLOUDFLARE_URL',
    token: 'CLOUDFLARE_TOKEN',
  },
  defaultUrl: 'https://api.cloudflare.com',
};
