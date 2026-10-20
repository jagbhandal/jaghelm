import { createArrPreset } from '../lib/createArrPreset.js';

export default createArrPreset({
  name: 'Sonarr',
  icon: 'sonarr',
  description: 'TV series management and automation',
  apiVersion: 'v3',
  envPrefix: 'SONARR',
});
