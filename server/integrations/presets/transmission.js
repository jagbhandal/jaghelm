export default {
  name: 'Transmission',
  icon: 'transmission',
  description: 'Lightweight BitTorrent client',
  // TODO(integrations): Transmission's RPC requires POST with a JSON body
  // ({"method":"session-stats"}) and a CSRF dance via X-Transmission-Session-Id.
  // handler.js currently only does GET, so this preset will fail. Previously
  // declared `method: 'POST'`, `body: '...'`, and
  // `extraHeaders: {Content-Type: 'application/json'}` were stripped during
  // preset hygiene — none were read by handler/lib. Restore alongside POST
  // support and 409-retry handling for the CSRF token if Transmission is wanted.
  auth: 'basic',
  endpoint: '/transmission/rpc',
  testEndpoint: '/transmission/rpc',
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
