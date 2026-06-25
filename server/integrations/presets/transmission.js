export default {
  name: 'Transmission',
  icon: 'transmission',
  description: 'Lightweight BitTorrent client',
  // Gated out of the gallery: Transmission's RPC needs POST-with-body plus a
  // CSRF dance (X-Transmission-Session-Id 409-retry) the GET-only handler
  // can't do (see the TODO below). Recognized but unselectable until then.
  unsupported: 'Requires POST + CSRF (X-Transmission-Session-Id) support the handler lacks',
  // TODO(integrations): Transmission's RPC requires POST with a JSON body
  // ({"method":"session-stats"}) and a CSRF dance via X-Transmission-Session-Id.
  // handler.js currently only does GET, so this preset will fail. Restore alongside
  // POST support and 409-retry handling for the CSRF token if Transmission is wanted.
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
    password: 'TRANSMISSION_PASS', // pragma: allowlist secret
  },
};
