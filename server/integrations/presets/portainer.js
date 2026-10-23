export default {
  name: 'Portainer',
  icon: 'portainer',
  description: 'Docker and Kubernetes management UI',
  auth: 'session',
  session: {
    loginEndpoint: '/api/auth',
    loginBody: { username: '{username}', password: '{password}' },
    tokenPath: 'jwt',
    tokenHeader: 'Authorization',
    tokenPrefix: 'Bearer ',
  },
  endpoint: '/api/endpoints',
  fields: [
    { key: 'environments', label: 'Envs', path: '_length', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_PORTAINER_URL',
    username: 'JAGHELM_PORTAINER_USER',
    password: 'JAGHELM_PORTAINER_PASS', // pragma: allowlist secret
  },
};
