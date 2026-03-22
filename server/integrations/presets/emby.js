export default {
  name: 'Emby',
  icon: 'emby',
  description: 'Media server for personal streaming',
  auth: 'query',
  queryParam: 'api_key',
  endpoint: '/emby/System/Info',
  testEndpoint: '/emby/System/Ping',
  fields: [
    { key: 'version', label: 'Version', path: 'Version', format: 'string' },
    { key: 'local_address', label: 'Address', path: 'LocalAddress', format: 'string' },
  ],
  envKeys: {
    url: 'EMBY_URL',
    token: 'EMBY_API_KEY',
  },
};
