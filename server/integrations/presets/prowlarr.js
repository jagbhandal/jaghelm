import { createArrPreset } from './createArrPreset.js';

export default createArrPreset({
  name: 'Prowlarr',
  icon: 'prowlarr',
  description: 'Indexer manager for Usenet and BitTorrent',
  apiVersion: 'v1',
  envPrefix: 'PROWLARR',
  endpoint: '/api/v1/indexer',
  fields: [
    { key: 'indexers', label: 'Indexers', path: '_length', format: 'number' },
  ],
});
