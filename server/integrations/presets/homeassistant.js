export default {
  name: 'Home Assistant',
  icon: 'home-assistant',
  description: 'Open-source home automation platform',
  auth: 'bearer',
  endpoint: '/api/states',
  testEndpoint: '/api/',
  fields: [
    { key: 'entities', label: 'Entities', path: '_length', format: 'number' },
  ],
  envKeys: {
    url: 'HASS_URL',
    token: 'HASS_TOKEN',
  },
};
