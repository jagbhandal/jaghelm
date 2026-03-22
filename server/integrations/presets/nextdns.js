export default {
  name: 'NextDNS',
  icon: 'nextdns',
  description: 'Cloud-based DNS firewall and analytics',
  auth: 'header',
  authHeader: 'X-Api-Key',
  endpoint: '/profiles/{profile_id}/analytics/status',
  testEndpoint: '/profiles',
  fields: [
    { key: 'queries', label: 'Queries', path: 'allQueries', format: 'number' },
    { key: 'blocked', label: 'Blocked', path: 'blockedQueries', format: 'number' },
  ],
  envKeys: {
    url: 'NEXTDNS_URL',
    token: 'NEXTDNS_API_KEY',
  },
  defaultUrl: 'https://api.nextdns.io',
};
