export default {
  name: 'SABnzbd',
  icon: 'sabnzbd',
  description: 'Usenet download client',
  auth: 'query',
  queryParam: 'apikey',
  endpoint: '/api?mode=queue&output=json',
  testEndpoint: '/api?mode=version&output=json',
  fields: [
    { key: 'remaining', label: 'Remaining', path: 'queue.noofslots_total', format: 'number' },
    { key: 'speed', label: 'Speed', path: 'queue.speed', format: 'string' },
    { key: 'size_left', label: 'Left', path: 'queue.sizeleft', format: 'string' },
  ],
  envKeys: {
    url: 'SABNZBD_URL',
    token: 'SABNZBD_API_KEY',
  },
};
