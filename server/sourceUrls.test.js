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
  sourceUrlUnset,
  sourceUrlUnsets,
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

test('an unset source URL has no default: no URL, no problem, nothing to request (#704)', () => {
  for (const name of ['prometheus', 'kuma', 'gitea']) {
    assert.deepEqual(sourceUrl(name, {}), { url: null, problem: null }, name);
  }
  assert.deepEqual(sourceUrl('kuma', { KUMA_URL: '' }), { url: null, problem: null });
  // Set, refused or not, is something set up.
  assert.equal(sourceUrlSet('gitea', {}), false);
  assert.equal(sourceUrlSet('gitea', { GITEA_URL: 'http://jag:pw@git' }), true); // pragma: allowlist secret
  assert.equal(sourceUrlSet('kuma', { KUMA_URL: 'http://kuma' }), true);
});

test('only Prometheus is needed: unset, it has plain words; Kuma and Gitea unset are quiet; a set URL has none (#704)', () => {
  const words = 'Prometheus is not set. Set PROMETHEUS_URL in .env.';
  assert.equal(sourceUrlUnset('prometheus', {}), words);
  assert.equal(sourceUrlUnset('prometheus', { PROMETHEUS_URL: '' }), words);
  assert.equal(sourceUrlUnset('prometheus', { PROMETHEUS_URL: 'http://prom:9090' }), null);
  // A refused one is set: it has its own words (sourceUrl().problem), not these.
  assert.equal(sourceUrlUnset('prometheus', { PROMETHEUS_URL: 'http://jag:pw@prom' }), null); // pragma: allowlist secret
  assert.equal(sourceUrlUnset('kuma', {}), null);
  assert.equal(sourceUrlUnset('gitea', {}), null);
  assert.deepEqual(sourceUrlUnsets({}), { prometheus: words });
  assert.deepEqual(sourceUrlUnsets({ PROMETHEUS_URL: 'http://prom:9090' }), {});
  // Never in /api/health, which says nothing of what is set up.
  assert.deepEqual(sourceUrlHealth({}), {});
  // The boot says it once.
  const lines = [];
  warnRefusedSourceUrls({ warn: (fields, msg) => lines.push([fields, msg]) }, {});
  assert.deepEqual(lines, [[{ source: 'prometheus', variable: 'PROMETHEUS_URL' }, words]]);
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
  warnRefusedSourceUrls(logger, env);
  assert.deepEqual(lines, [
    [{ source: 'kuma', variable: 'KUMA_URL' }, problems.kuma],
    [{ source: 'gitea', variable: 'GITEA_URL' }, problems.gitea],
  ]);
  assert.ok(!JSON.stringify(lines).includes('hunter2'));
});
