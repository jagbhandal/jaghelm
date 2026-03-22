export default {
  name: 'Prowlarr',
  icon: 'prowlarr',
  description: 'Indexer manager for Usenet and BitTorrent',
  auth: 'header',
  authHeader: 'X-Api-Key',
  endpoint: '/api/v1/indexer',
  testEndpoint: '/api/v1/system/status',
  fields: [
    { key: 'indexers', label: 'Indexers', path: '_length', format: 'number' },
  ],
  envKeys: {
    url: 'PROWLARR_URL',
    token: 'PROWLARR_API_KEY',
  },
};
