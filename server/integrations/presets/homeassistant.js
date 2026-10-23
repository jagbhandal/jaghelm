export default {
  name: 'Home Assistant',
  icon: 'home-assistant',
  description: 'Open-source home automation platform',
  auth: 'bearer',
  endpoint: '/api/states',
  fields: [
    { key: 'entities', label: 'Entities', path: '_length', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_HASS_URL',
    token: 'JAGHELM_HASS_TOKEN',
  },
};
