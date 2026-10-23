export default {
  name: 'Emby',
  icon: 'emby',
  description: 'Media server for personal streaming',
  auth: 'query',
  queryParam: 'api_key',
  endpoint: '/emby/System/Info',
  fields: [
    { key: 'version', label: 'Version', path: 'Version', format: 'string' },
    { key: 'local_address', label: 'Address', path: 'LocalAddress', format: 'string' },
  ],
  envKeys: {
    url: 'JAGHELM_EMBY_URL',
    token: 'JAGHELM_EMBY_API_KEY',
  },
};
