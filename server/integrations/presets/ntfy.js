export default {
  name: 'Ntfy',
  icon: 'ntfy',
  description: 'Simple push notification service',
  auth: 'none',
  endpoint: '/v1/stats',
  fields: [
    { key: 'messages', label: 'Messages', path: 'messages', format: 'number' },
    { key: 'rate', label: 'Rate', path: 'messages_rate', format: 'decimal' },
  ],
  envKeys: {
    url: 'JAGHELM_NTFY_URL',
  },
};
