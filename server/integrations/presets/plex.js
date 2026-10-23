export default {
  name: 'Plex',
  icon: 'plex',
  description: 'Media server for movies, TV, and music',
  auth: 'header',
  authHeader: 'X-Plex-Token',
  extraHeaders: { Accept: 'application/json' },
  endpoint: '/status/sessions',
  fields: [
    { key: 'streams', label: 'Streams', path: 'MediaContainer.size', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_PLEX_URL',
    token: 'JAGHELM_PLEX_TOKEN',
  },
};
