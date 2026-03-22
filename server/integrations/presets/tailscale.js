export default {
  name: 'Tailscale',
  icon: 'tailscale',
  description: 'Zero-config mesh VPN',
  auth: 'bearer',
  endpoint: '/api/v2/tailnet/-/devices',
  testEndpoint: '/api/v2/tailnet/-/devices?fields=default',
  fields: [
    { key: 'devices', label: 'Devices', path: 'devices._length', format: 'number' },
  ],
  envKeys: {
    url: 'TAILSCALE_URL',
    token: 'TAILSCALE_API_KEY',
  },
  defaultUrl: 'https://api.tailscale.com',
};
