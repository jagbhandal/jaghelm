export default {
  name: 'Pi-hole',
  icon: 'pi-hole',
  description: 'Network-wide DNS ad blocking',
  auth: 'header',
  authHeader: 'X-FTL-SID',
  endpoint: '/api/stats/summary',
  testEndpoint: '/api/auth',
  fields: [
    { key: 'queries', label: 'Queries', path: 'queries.total', format: 'number' },
    { key: 'blocked', label: 'Blocked', path: 'queries.blocked', format: 'number' },
    { key: 'block_percent', label: 'Block %', path: 'queries.percent_blocked', format: 'decimal' },
    { key: 'clients', label: 'Clients', path: 'clients.total', format: 'number' },
  ],
  envKeys: {
    url: 'PIHOLE_URL',
    token: 'PIHOLE_APP_PASSWORD',
  },
};
