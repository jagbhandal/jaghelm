export default {
  name: 'PhotoPrism',
  icon: 'photoprism',
  description: 'AI-powered photo management',
  auth: 'bearer',
  endpoint: '/api/v1/config',
  testEndpoint: '/api/v1/status',
  fields: [
    { key: 'photos', label: 'Photos', path: 'count.all', format: 'number' },
    { key: 'videos', label: 'Videos', path: 'count.videos', format: 'number' },
    { key: 'albums', label: 'Albums', path: 'count.albums', format: 'number' },
  ],
  envKeys: {
    url: 'PHOTOPRISM_URL',
    token: 'PHOTOPRISM_TOKEN',
  },
};
