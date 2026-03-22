export default {
  name: 'AdGuard Home',
  icon: 'adguard-home',
  description: 'Network-wide ad and tracker blocking',
  auth: 'basic',
  endpoint: '/control/stats',
  testEndpoint: '/control/status',
  fields: [
    { key: 'queries', label: 'Queries', path: 'num_dns_queries', format: 'number' },
    { key: 'blocked', label: 'Blocked', path: 'num_blocked_filtering', format: 'number' },
    { key: 'block_percent', label: 'Block %', compute: 'percent_of', numerator: 'num_blocked_filtering', denominator: 'num_dns_queries' },
    { key: 'latency', label: 'Latency', path: 'avg_processing_time', format: 'ms' },
  ],
  envKeys: {
    url: 'ADGUARD_URL',
    username: 'ADGUARD_USER',
    password: 'ADGUARD_PASS',
  },
};
