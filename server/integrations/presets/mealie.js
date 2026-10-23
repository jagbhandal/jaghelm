export default {
  name: 'Mealie',
  icon: 'mealie',
  description: 'Self-hosted recipe manager and meal planner',
  auth: 'bearer',
  endpoint: '/api/recipes?page=1&perPage=1',
  fields: [
    { key: 'recipes', label: 'Recipes', path: 'total', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_MEALIE_URL',
    token: 'JAGHELM_MEALIE_TOKEN',
  },
};
