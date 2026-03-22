export default {
  name: 'Gitea',
  icon: 'gitea',
  description: 'Lightweight self-hosted Git service',
  auth: 'bearer',
  endpoint: '/api/v1/repos/search?limit=1',
  testEndpoint: '/api/v1/version',
  fields: [
    { key: 'repos', label: 'Repos', path: 'data._length', format: 'number' },
  ],
  envKeys: {
    url: 'GITEA_URL',
    token: 'GITEA_TOKEN',
  },
};
