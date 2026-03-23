export default {
  name: 'Tailscale',
  icon: 'tailscale',
  description: 'Zero-config mesh VPN',
  auth: 'bearer',
  endpoint: '/api/v2/tailnet/-/devices',
  testEndpoint: '/api/v2/tailnet/-/devices?fields=default',
  fields: [],
  structuredTransform: (raw) => {
    const devices = raw?.devices || [];
    const online = devices.filter(d => d.connectedToControl === true).length;
    const total = devices.length;
    const updates = devices.filter(d => d.updateAvailable === true).length;
    const fields = {
      'Online': `${online}/${total}`,
      'Updates': updates > 0 ? `${updates} available` : 'All current',
    };
    return { fields };
  },
  envKeys: {
    url: 'TAILSCALE_URL',
    token: 'TAILSCALE_API_KEY',
  },
  defaultUrl: 'https://api.tailscale.com',
};
