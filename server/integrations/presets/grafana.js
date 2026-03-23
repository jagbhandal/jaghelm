export default {
  name: 'Grafana',
  icon: 'grafana',
  description: 'Observability and data visualization platform',
  auth: 'bearer',
  endpoint: '/api/prometheus/grafana/api/v1/rules',
  testEndpoint: '/api/health',
  fields: [],
  structuredTransform: (raw) => {
    const groups = raw?.data?.groups || [];
    let total = 0;
    let firing = 0;
    let pending = 0;
    for (const group of groups) {
      for (const rule of (group.rules || [])) {
        total++;
        if (rule.state === 'firing') firing++;
        if (rule.state === 'pending') pending++;
      }
    }
    const status = firing > 0 ? `${firing} FIRING` : pending > 0 ? `${pending} pending` : 'All OK';
    const fields = {
      'Alerts': status,
      'Rules': String(total),
    };
    return { fields };
  },
  envKeys: {
    url: 'GRAFANA_URL',
    token: 'GRAFANA_TOKEN',
  },
};
