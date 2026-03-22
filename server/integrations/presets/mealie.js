export default {
  name: 'Mealie',
  icon: 'mealie',
  description: 'Self-hosted recipe manager and meal planner',
  auth: 'bearer',
  endpoint: '/api/recipes?page=1&perPage=1',
  testEndpoint: '/api/app/about',
  fields: [
    { key: 'recipes', label: 'Recipes', path: 'total', format: 'number' },
  ],
  envKeys: {
    url: 'MEALIE_URL',
    token: 'MEALIE_TOKEN',
  },
};
