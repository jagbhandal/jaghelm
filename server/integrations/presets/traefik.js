export default {
  name: 'Traefik',
  icon: 'traefik',
  description: 'Cloud-native reverse proxy and load balancer',
  auth: 'none',
  endpoint: '/api/overview',
  fields: [
    { key: 'routers', label: 'Routers', path: 'http.routers.total', format: 'number' },
    { key: 'services', label: 'Services', path: 'http.services.total', format: 'number' },
    { key: 'middlewares', label: 'Middlewares', path: 'http.middlewares.total', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_TRAEFIK_URL',
  },
};
