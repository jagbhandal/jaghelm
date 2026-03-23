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
  fields: [],
  structuredTransform: (raw) => {
    const hosts = Array.isArray(raw) ? raw : [];
    const online = hosts.filter(h => h.enabled && h.meta?.nginx_online).length;
    const offline = hosts.filter(h => !h.enabled || !h.meta?.nginx_online).length;
    const withCert = hosts.filter(h => h.certificate_id > 0).length;
    const fields = {
      'Online': String(online),
      'Offline': String(offline),
      'Certs': String(withCert),
    };
    return { fields };
  },
  envKeys: {
    url: 'NPM_URL',
    username: 'NPM_USER',
    password: 'NPM_PASS',
  },
};
