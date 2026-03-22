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
  testEndpoint: '/api/auth',
  fields: [
    { key: 'environments', label: 'Envs', path: '_length', format: 'number' },
  ],
  envKeys: {
    url: 'PORTAINER_URL',
    username: 'PORTAINER_USER',
    password: 'PORTAINER_PASS',
  },
};
