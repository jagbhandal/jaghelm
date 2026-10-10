/**
 * refreshGitea must send GITEA_TOKEN as an Authorization header, never in the
 * query string — Gitea's router log records full request URLs, so a ?token=
 * param leaks the credential into container logs (and anything shipping them).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITEA_URL = 'http://gitea.test:3060';
process.env.GITEA_TOKEN = 'secret-test-token';

const { refreshGitea } = await import('./refresh.js');

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

test('refreshGitea: token goes in the Authorization header, not the URL', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    const body = String(url).includes('/repos/search')
      ? { data: [{ name: 'r', full_name: 'o/r', fork: false, mirror: false, archived: false }] }
      : [{ sha: 'abcdef123', commit: { message: 'm', author: { date: '2026-10-10', name: 'a' } } }];
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };

  const result = await refreshGitea();

  assert.equal(result.length, 1);
  assert.equal(calls.length, 2); // guards against the loop below passing vacuously
  for (const { url, headers } of calls) {
    assert.ok(!url.includes('secret-test-token'), `token leaked into URL: ${url}`);
    assert.equal(headers.get('authorization'), 'token secret-test-token');
  }
});
