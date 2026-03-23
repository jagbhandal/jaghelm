export default {
  name: 'Vaultwarden',
  icon: 'vaultwarden',
  description: 'Lightweight Bitwarden-compatible password manager',
  auth: 'none',
  endpoint: '/alive',
  testEndpoint: '/alive',
  fields: [],
  structuredTransform: (raw) => {
    const fields = {
      'Status': 'Online',
    };
    return { fields };
  },
  envKeys: {
    url: 'VAULTWARDEN_URL',
  },
};
