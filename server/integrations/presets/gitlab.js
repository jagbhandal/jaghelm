export default {
  name: 'GitLab',
  icon: 'gitlab',
  description: 'DevOps platform with Git repos, CI/CD, and more',
  auth: 'header',
  authHeader: 'Private-Token',
  // /api/v4/version returns { version, revision } — an honest, body-readable
  // value. We previously hit /api/v4/projects?per_page=1 and surfaced
  // path '0.id' under the label "Projects": that's the id of an arbitrary
  // first project (a meaningless number), not a project count — and with
  // per_page=1 the body can never carry a real total (it only lives in the
  // x-total response header, which the JSON-body extractor can't read).
  // Show the GitLab version instead — true and useful — rather than a wrong count.
  endpoint: '/api/v4/version',
  testEndpoint: '/api/v4/version',
  fields: [
    { key: 'version', label: 'Version', path: 'version', format: 'string' },
  ],
  envKeys: {
    url: 'GITLAB_URL',
    token: 'GITLAB_TOKEN',
  },
};
