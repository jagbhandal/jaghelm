import { createArrPreset } from './createArrPreset.js';

export default createArrPreset({
  name: 'Bazarr',
  icon: 'bazarr',
  description: 'Subtitle management for Sonarr and Radarr',
  envPrefix: 'BAZARR',
  endpoint: '/api/system/status',
  testEndpoint: '/api/system/health',
  fields: [
    { key: 'version', label: 'Version', path: 'data.bazarr_version', format: 'string' },
  ],
});
