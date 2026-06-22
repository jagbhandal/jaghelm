// TODO(integrations): Deluge's JSON-RPC API needs POST-with-body + cookie-jar
// session handling. handler.js issues GET on session-auth endpoints, and
// lib/session.js extracts a token from the JSON login response — Deluge's
// /json login returns `{result: true, id: 1}` (no token field) and sets a
// session cookie. With tokenPath:null, lib/session.js throws "Login succeeded
// but no token in response" — a loud, predictable failure mode that's been
// left in place intentionally. Previously the preset also declared top-level
// `method: 'POST'`, `body: '...JSON-RPC...'`, `extraHeaders: {Content-Type}`,
// and a session-block `useCookie: true` marker — none read by handler/lib;
// stripped in the preset-hygiene pass. Restore alongside real cookie-session
// support if Deluge is wanted.
export default {
  name: 'Deluge',
  icon: 'deluge',
  description: 'Lightweight BitTorrent client',
  // Gated out of the gallery: the GET-only handler can't drive Deluge's
  // JSON-RPC API (needs POST-with-body + cookie-jar session — see the TODO
  // above). Recognized but unselectable until that support lands.
  unsupported: 'Requires POST/JSON-RPC + cookie-session support the handler lacks',
  auth: 'session',
  session: {
    loginEndpoint: '/json',
    loginBody: { method: 'auth.login', params: ['{password}'], id: 1 },
    tokenPath: null,
  },
  endpoint: '/json',
  testEndpoint: '/json',
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
