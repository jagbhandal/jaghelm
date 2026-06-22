export default {
  name: 'Watchtower',
  icon: 'watchtower',
  description: 'Automated Docker container image updates',
  // Gated out of the gallery: /v1/update is an update-TRIGGER endpoint, not a
  // read-only status one — polling it on every refresh would force a container
  // image update each cycle (a side effect, not a metric). Recognized but
  // unselectable, so it's never added/polled/connection-tested. There's no
  // safe read-only endpoint to repoint at; restore only if one appears.
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
