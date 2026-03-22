export default {
  name: 'Nginx Proxy Manager',
  icon: 'nginx-proxy-manager',
  description: 'Reverse proxy with SSL management',
  auth: 'session',
  session: {
    loginEndpoint: '/api/tokens',
    loginBody: { identity: '{username}', secret: '{password}' },
    tokenPath: 'token',
    tokenHeader: 'Authorization',
    tokenPrefix: 'Bearer ',
  },
  endpoint: '/api/nginx/proxy-hosts',
  testEndpoint: '/api/tokens',
  transform: 'npm',
  fields: [
    { key: 'hosts', label: 'Hosts', path: '_length', format: 'number' },
    { key: 'online', label: 'Online', path: '_filter:enabled=1', format: 'number' },
    { key: 'certs', label: 'Certs', path: '_filter:certificate_id>0', format: 'number' },
  ],
  envKeys: {
    url: 'NPM_URL',
    username: 'NPM_USER',
    password: 'NPM_PASS',
  },
};
