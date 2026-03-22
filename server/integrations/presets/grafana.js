export default {
  name: 'Grafana',
  icon: 'grafana',
  description: 'Observability and data visualization platform',
  auth: 'bearer',
  endpoint: '/api/search?type=dash-db',
  testEndpoint: '/api/health',
  fields: [
    { key: 'dashboards', label: 'Dashboards', path: '_length', format: 'number' },
  ],
  envKeys: {
    url: 'GRAFANA_URL',
    token: 'GRAFANA_TOKEN',
  },
};
