export default {
  name: 'Gitea',
  icon: 'gitea',
  description: 'Lightweight self-hosted Git service',
  auth: 'header',
  authHeader: 'Authorization',
  authPrefix: 'token ',
  endpoint: '/api/v1/repos/search?limit=50',
  fields: [],
  structuredTransform: (raw) => {
    const repos = raw?.data || (Array.isArray(raw) ? raw : []);
    const repoCount = repos.length;
    const totalStars = repos.reduce((sum, r) => sum + (r.stars_count || 0), 0);
    const totalIssues = repos.reduce((sum, r) => sum + (r.open_issues_count || 0), 0);
    const fields = {
      'Repos': String(repoCount),
      'Issues': String(totalIssues),
      'Stars': String(totalStars),
    };
    return { fields };
  },
  envKeys: {
    url: 'JAGHELM_GITEA_URL',
    token: 'JAGHELM_GITEA_TOKEN',
  },
};
