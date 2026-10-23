export default {
  name: 'Overseerr',
  icon: 'overseerr',
  description: 'Media request management (also works with Jellyseerr)',
  auth: 'header',
  authHeader: 'X-Api-Key',
  endpoint: '/api/v1/request/count',
  fields: [
    { key: 'pending', label: 'Pending', path: 'pending', format: 'number' },
    { key: 'approved', label: 'Approved', path: 'approved', format: 'number' },
    { key: 'available', label: 'Available', path: 'available', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_OVERSEERR_URL',
    token: 'JAGHELM_OVERSEERR_API_KEY',
  },
};
