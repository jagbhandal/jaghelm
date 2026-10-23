export default {
  name: 'Vaultwarden',
  icon: 'vaultwarden',
  description: 'Lightweight Bitwarden-compatible password manager',
  auth: 'none',
  endpoint: '/alive',
  fields: [],
  structuredTransform: (raw) => {
    const fields = {
      'Status': 'Online',
    };
    return { fields };
  },
  envKeys: {
    url: 'JAGHELM_VAULTWARDEN_URL',
  },
};
