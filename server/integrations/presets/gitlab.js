export default {
  name: 'GitLab',
  icon: 'gitlab',
  description: 'DevOps platform with Git repos, CI/CD, and more',
  auth: 'header',
  authHeader: 'Private-Token',
  endpoint: '/api/v4/projects?per_page=1&statistics=true',
  testEndpoint: '/api/v4/version',
  fields: [
    { key: 'projects', label: 'Projects', path: '0.id', format: 'number' },
  ],
  envKeys: {
    url: 'GITLAB_URL',
    token: 'GITLAB_TOKEN',
  },
};
