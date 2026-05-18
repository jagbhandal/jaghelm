// PhotoPrism uses session-cookie auth (`X-Auth-Token`) in its public API.
// The previous version of this preset declared `auth: 'oauth2'` with a separate
// `oauth2: { ... }` block, but handler.js / lib/session.js have no oauth2 path —
// only `auth: 'session'` is recognised — so the integration was silently broken.
//
// The oauth2 block declared the following PhotoPrism-specific fields that don't
// translate to the session contract:
//   - loginEndpoint: '/api/v1/oauth/token'
//   - loginContentType: 'application/x-www-form-urlencoded'
//   - loginBody: 'grant_type=client_credentials&client_id={username}&client_secret={password}'
//   - tokenPath: 'access_token'
//   - tokenHeader: 'Authorization'
//   - tokenPrefix: 'Bearer '
// TODO(integrations): when handler.js grows a real oauth2 path (with token-refresh
// + 2FA-aware login), restore the oauth2 client-credentials block as the primary
// and demote session to authFallback. Until then, session-auth is the only mode
// PhotoPrism users without 2FA can rely on.
export default {
  name: 'PhotoPrism',
  icon: 'photoprism',
  description: 'AI-powered photo management',
  auth: 'session',
  session: {
    loginEndpoint: '/api/v1/session',
    loginContentType: 'application/json',
    loginBody: { username: '{username}', password: '{password}' },
    tokenPath: 'id',
    tokenHeader: 'X-Auth-Token',
    tokenPrefix: '',
  },
  oauth2Instructions: 'If you have 2FA enabled, session login will fail. PhotoPrism 2FA support requires oauth2 client credentials, which is not yet implemented in JagHelm. Disable 2FA on the JagHelm-facing account, or use a dedicated read-only PhotoPrism user without 2FA.',
  endpoint: '/api/v1/config',
  testEndpoint: '/api/v1/config',
  fields: [
    { key: 'photos', label: 'Photos', path: 'count.photos', format: 'number' },
    { key: 'videos', label: 'Videos', path: 'count.videos', format: 'number' },
    { key: 'albums', label: 'Albums', path: 'count.albums', format: 'number' },
    { key: 'people', label: 'People', path: 'count.people', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_PHOTOPRISM_URL',
    username: 'JAGHELM_PHOTOPRISM_USER',
    password: 'JAGHELM_PHOTOPRISM_PASS',
  },
};
