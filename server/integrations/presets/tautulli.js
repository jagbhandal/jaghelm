export default {
  name: 'Tautulli',
  icon: 'tautulli',
  description: 'Plex media server monitoring',
  auth: 'query',
  queryParam: 'apikey',
  endpoint: '/api/v2?cmd=get_activity',
  fields: [
    { key: 'streams', label: 'Streams', path: 'response.data.stream_count', format: 'number' },
    { key: 'transcode', label: 'Transcode', path: 'response.data.stream_count_transcode', format: 'number' },
    { key: 'bandwidth', label: 'Bandwidth', path: 'response.data.total_bandwidth', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_TAUTULLI_URL',
    token: 'JAGHELM_TAUTULLI_API_KEY',
  },
};
