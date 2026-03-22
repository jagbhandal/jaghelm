export default {
  name: 'Overseerr',
  icon: 'overseerr',
  description: 'Media request management (also works with Jellyseerr)',
  auth: 'header',
  authHeader: 'X-Api-Key',
  endpoint: '/api/v1/request/count',
  testEndpoint: '/api/v1/status',
  fields: [
    { key: 'pending', label: 'Pending', path: 'pending', format: 'number' },
    { key: 'approved', label: 'Approved', path: 'approved', format: 'number' },
    { key: 'available', label: 'Available', path: 'available', format: 'number' },
  ],
  envKeys: {
    url: 'OVERSEERR_URL',
    token: 'OVERSEERR_API_KEY',
  },
};
