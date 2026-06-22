export default {
  name: 'qBittorrent',
  icon: 'qbittorrent',
  description: 'Free BitTorrent client',
  // Gated out of the gallery: login returns plain-text "Ok." + a SID cookie,
  // which the token-path session model can't extract (see the TODO below).
  // Recognized but unselectable until cookie-session support lands.
  unsupported: 'Requires cookie-session support the handler lacks',
  // TODO(integrations): qBittorrent's /api/v2/auth/login returns plain text
  // "Ok." and sets a SID cookie — there's no token in the JSON response, so
  // lib/session.js's extractValue/tokenPath model fails to find a token and
  // throws "Login succeeded but no token in response" (loud, predictable
  // failure). Wire up real cookie-session handling before this integration works.
  auth: 'session',
  session: {
    loginEndpoint: '/api/v2/auth/login',
    loginBody: { username: '{username}', password: '{password}' },
    tokenPath: null,
  },
  endpoint: '/api/v2/transfer/info',
  testEndpoint: '/api/v2/app/version',
  fields: [
    { key: 'dl_speed', label: 'DL Speed', path: 'dl_info_speed', format: 'bytes' },
    { key: 'ul_speed', label: 'UL Speed', path: 'up_info_speed', format: 'bytes' },
  ],
  envKeys: {
    url: 'QBITTORRENT_URL',
    username: 'QBITTORRENT_USER',
    password: 'QBITTORRENT_PASS',
  },
};
