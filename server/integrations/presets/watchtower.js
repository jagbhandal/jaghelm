export default {
  name: 'Watchtower',
  icon: 'watchtower',
  description: 'Automated Docker container image updates',
  // Gated as unsupported: /v1/update is an update-TRIGGER endpoint, not a
  // read-only status one — polling it on every refresh would force a container
  // image update each cycle (a side effect, not a metric). The `unsupported`
  // flag is enforced server-side (resolveIntegrationConfig, testIntegration,
  // /save), so it can't be saved, tested, or polled — not just hidden from the
  // gallery. There's no safe read-only endpoint to repoint at.
  unsupported: '/v1/update is a side-effecting update trigger, unsafe to poll',
  auth: 'bearer',
  endpoint: '/v1/update',
  testEndpoint: '/v1/update',
  fields: [
    { key: 'scanned', label: 'Scanned', path: 'scanned', format: 'number' },
    { key: 'updated', label: 'Updated', path: 'updated', format: 'number' },
    { key: 'failed', label: 'Failed', path: 'failed', format: 'number' },
  ],
  envKeys: {
    url: 'WATCHTOWER_URL',
    token: 'WATCHTOWER_HTTP_API_TOKEN',
  },
};
