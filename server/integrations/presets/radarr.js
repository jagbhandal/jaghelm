import { createArrPreset } from '../lib/createArrPreset.js';

export default createArrPreset({
  name: 'Radarr',
  icon: 'radarr',
  description: 'Movie management and automation',
  apiVersion: 'v3',
  envPrefix: 'RADARR',
});
