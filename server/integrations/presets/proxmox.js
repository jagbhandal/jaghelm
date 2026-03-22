export default {
  name: 'Proxmox',
  icon: 'proxmox',
  description: 'Virtualization management platform',
  auth: 'header',
  authHeader: 'Authorization',
  authPrefix: 'PVEAPIToken=',
  endpoint: '/api2/json/nodes',
  testEndpoint: '/api2/json/version',
  fields: [
    { key: 'nodes', label: 'Nodes', path: 'data._length', format: 'number' },
  ],
  envKeys: {
    url: 'PROXMOX_URL',
    token: 'PROXMOX_TOKEN',
  },
};
