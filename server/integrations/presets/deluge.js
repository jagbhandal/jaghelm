export default {
  name: 'Deluge',
  icon: 'deluge',
  description: 'Lightweight BitTorrent client',
  auth: 'session',
  session: {
    loginEndpoint: '/json',
    loginBody: { method: 'auth.login', params: ['{password}'], id: 1 },
    tokenPath: null,
    useCookie: true,
  },
  endpoint: '/json',
  method: 'POST',
  body: JSON.stringify({ method: 'web.update_ui', params: [['download_rate', 'upload_rate', 'num_torrents'], {}], id: 2 }),
  testEndpoint: '/json',
  extraHeaders: { 'Content-Type': 'application/json' },
  fields: [
    { key: 'torrents', label: 'Torrents', path: 'result.stats.num_torrents', format: 'number' },
    { key: 'dl_speed', label: 'DL Speed', path: 'result.stats.download_rate', format: 'bytes' },
    { key: 'ul_speed', label: 'UL Speed', path: 'result.stats.upload_rate', format: 'bytes' },
  ],
  envKeys: {
    url: 'DELUGE_URL',
    password: 'DELUGE_PASS',
  },
};
