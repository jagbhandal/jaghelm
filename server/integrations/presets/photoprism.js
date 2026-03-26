export default {
  name: 'PhotoPrism',
  icon: 'photoprism',
  description: 'AI-powered photo management',
  auth: 'session',
  session: {
    loginEndpoint: '/api/v1/oauth/token',
    loginContentType: 'application/x-www-form-urlencoded',
    loginBody: 'grant_type=client_credentials&client_id={username}&client_secret={password}',
    tokenPath: 'access_token',
    tokenHeader: 'Authorization',
    tokenPrefix: 'Bearer ',
  },
  endpoint: '/api/v1/config',
  testEndpoint: '/api/v1/config',
  fields: [
    { key: 'photos', label: 'Photos', path: 'count.photos', format: 'number' },
    { key: 'videos', label: 'Videos', path: 'count.videos', format: 'number' },
    { key: 'albums', label: 'Albums', path: 'count.albums', format: 'number' },
  ],
  envKeys: {
    url: 'PHOTOPRISM_URL',
    username: 'PHOTOPRISM_CLIENT_ID',
    password: 'PHOTOPRISM_CLIENT_SECRET',
  },
};
