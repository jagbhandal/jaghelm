// PhotoPrism uses session-cookie auth (`X-Auth-Token`) in its public API.
// handler.js / lib/session.js only recognise `auth: 'session'` — there's no
// oauth2 path — so session is the only mode that works (and only without 2FA).
// TODO(integrations): when handler.js grows a real oauth2 path (token-refresh +
// 2FA-aware login), use PhotoPrism's oauth2 client-credentials flow as primary
// (POST /api/v1/oauth/token, Bearer token) and demote session to authFallback.
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
    password: 'JAGHELM_PHOTOPRISM_PASS', // pragma: allowlist secret
  },
};
