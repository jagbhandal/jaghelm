export default {
  name: 'qBittorrent',
  icon: 'qbittorrent',
  description: 'Free BitTorrent client',
  auth: 'session',
  session: {
    loginEndpoint: '/api/v2/auth/login',
    loginBody: { username: '{username}', password: '{password}' },
    tokenPath: null,
    useCookie: true,
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
