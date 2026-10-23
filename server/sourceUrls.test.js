/**
 * #419: PROMETHEUS_URL, KUMA_URL and GITEA_URL are read for the monitoring
 * sources in one place (sourceUrls.js). One carrying a credential
 * (urlCredential: a user or password however written, or a key in the query)
 * is refused: never used, and its problem names the variable and where a
 * credential goes instead, never the value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_URLS,
  sourceUrl,
  sourceUrlHealth,
  sourceUrlProblems,
  sourceUrlSet,
  warnRefusedSourceUrls,
} from './sourceUrls.js';

// The longest source error the status model keeps whole (status/rules.js errorText).
const ERROR_MAX = 120;

// Every way a credential can be written into a URL: userinfo as the parser
// reads it, one it can't parse, the host:port shapes (digits, then a raw #, /
// or ?), whitespace or a quote, a user alone, a second URL glued on, no scheme.
const REFUSED = [
  'http://jag:hunter2@host:9090', // pragma: allowlist secret
  'https://ghp_hunter2@host',
  'http://jag:ab#hunter2@host', // pragma: allowlist secret
  'http://jag:1234#hunter2@host', // pragma: allowlist secret
  'http://jag:1234/hunter2@host', // pragma: allowlist secret
  'http://jag:1234?hunter2@host', // pragma: allowlist secret
  'http://jag:hun ter2@host', // pragma: allowlist secret
  'http://jag:hun"ter2@host', // pragma: allowlist secret
  'http://host:9090http://jag:hunter2@other', // pragma: allowlist secret
  'jag:hunter2@host:9090', // pragma: allowlist secret
  'http://jag:1234/x/hunter2@host', // pragma: allowlist secret
  'http://prom:9090/?token=hunter2', // pragma: allowlist secret
];

const INSTEAD = {
  prometheus: /JagHelm can't log in to Prometheus/,
  kuma: /KUMA_API_KEY/,
  gitea: /GITEA_TOKEN/,
};

for (const [name, { variable }] of Object.entries(SOURCE_URLS)) {
  test(`${variable} with a user or password, however written, is refused: no URL, a problem naming the variable (#419)`, () => {
    for (const value of REFUSED) {
      const { url, problem } = sourceUrl(name, { [variable]: value });
      assert.equal(url, null, value);
      assert.ok(problem.startsWith(`${variable} `), problem);
      assert.match(problem, INSTEAD[name]);
      assert.ok(!problem.includes('hunter2') && !problem.includes('host'), `never the value: ${problem}`);
      assert.ok(problem.length <= ERROR_MAX, `the board keeps it whole: ${problem.length}`);
    }
  });

  test(`${variable} without an @ is used as it is (#419)`, () => {
    // An @ in the path of a URL with no port is no credential.
    for (const value of ['http://host:9090', 'https://host.example/sub/path', 'http://192.168.1.5:3001/', 'https://host.example/@scope']) {
      assert.deepEqual(sourceUrl(name, { [variable]: value }), { url: value, problem: null });
    }
  });
}

test('an unset source URL is its default: Prometheus and Kuma on localhost, no Gitea (#419)', () => {
  assert.deepEqual(sourceUrl('prometheus', {}), { url: 'http://localhost:9090', problem: null });
  assert.deepEqual(sourceUrl('kuma', { KUMA_URL: '' }), { url: 'http://localhost:3001', problem: null });
  assert.deepEqual(sourceUrl('gitea', {}), { url: null, problem: null });
  // Set, refused or not, is something set up.
  assert.equal(sourceUrlSet('gitea', {}), false);
  assert.equal(sourceUrlSet('gitea', { GITEA_URL: 'http://jag:pw@git' }), true); // pragma: allowlist secret
  assert.equal(sourceUrlSet('kuma', { KUMA_URL: 'http://kuma' }), true);
});

test('the problems, the /api/health entries and the boot warning list only the refused variables (#419)', () => {
  const env = {
    PROMETHEUS_URL: 'http://prom:9090',
    KUMA_URL: 'http://jag:1234#hunter2@kuma', // pragma: allowlist secret
    GITEA_URL: 'http://jag:hunter2@git', // pragma: allowlist secret
  };
  const problems = sourceUrlProblems(env);
  assert.deepEqual(Object.keys(problems), ['kuma', 'gitea']);
  assert.equal(problems.kuma, sourceUrl('kuma', env).problem);
  assert.deepEqual(sourceUrlHealth(env), {
    kuma: { state: 'refused', variable: 'KUMA_URL', problem: problems.kuma },
    gitea: { state: 'refused', variable: 'GITEA_URL', problem: problems.gitea },
  });
  assert.deepEqual(sourceUrlProblems({ PROMETHEUS_URL: 'http://prom:9090' }), {});
  assert.deepEqual(sourceUrlHealth({}), {});

  const lines = [];
  const logger = { warn: (fields, msg) => lines.push([fields, msg]) };
  warnRefusedSourceUrls(env, logger);
  assert.deepEqual(lines, [
    [{ source: 'kuma', variable: 'KUMA_URL' }, problems.kuma],
    [{ source: 'gitea', variable: 'GITEA_URL' }, problems.gitea],
  ]);
  assert.ok(!JSON.stringify(lines).includes('hunter2'));
});
