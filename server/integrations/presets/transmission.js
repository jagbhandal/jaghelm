export default {
  name: 'Transmission',
  icon: 'transmission',
  description: 'Lightweight BitTorrent client',
  auth: 'basic',
  endpoint: '/transmission/rpc',
  testEndpoint: '/transmission/rpc',
  method: 'POST',
  body: JSON.stringify({ method: 'session-stats' }),
  extraHeaders: { 'Content-Type': 'application/json' },
  fields: [
    { key: 'active', label: 'Active', path: 'arguments.activeTorrentCount', format: 'number' },
    { key: 'paused', label: 'Paused', path: 'arguments.pausedTorrentCount', format: 'number' },
    { key: 'dl_speed', label: 'DL Speed', path: 'arguments.downloadSpeed', format: 'bytes' },
  ],
  envKeys: {
    url: 'TRANSMISSION_URL',
    username: 'TRANSMISSION_USER',
    password: 'TRANSMISSION_PASS',
  },
};
