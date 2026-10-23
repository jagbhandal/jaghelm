/**
 * The environment schema (#249): every variable read through one module,
 * checked once at boot, the documented JAGHELM_ names working, and the old
 * unprefixed names working for one release with one warning each. No line
 * ever carries a value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BIND_HOST,
  ENV_SCHEMA,
  INTEGRATION_VARS,
  LEGACY_NAMES,
  checkEnv,
  envFrom,
  envValue,
  readEnv,
  reportEnv,
  resolveBindHost,
} from './env.js';

/** A logger that keeps its lines as [level, fields, msg]. */
function recorder() {
  const lines = [];
  const rec = (level) => (fields, msg) => lines.push([level, fields, msg]);
  return { lines, logger: { warn: rec('warn'), error: rec('error') } };
}

test('every variable is declared once, and no old name is also a variable', () => {
  const names = ENV_SCHEMA.map((d) => d.name);
  assert.equal(new Set(names).size, names.length);
  for (const old of Object.keys(LEGACY_NAMES)) assert.ok(!names.includes(old), old);
  assert.equal(new Set(Object.keys(LEGACY_NAMES)).size, Object.keys(LEGACY_NAMES).length);
});

test('every integration variable takes the JAGHELM_ prefix; the ones that had none answer to the old name', () => {
  for (const [preset, bases] of Object.entries(INTEGRATION_VARS)) {
    for (const base of bases) {
      const d = ENV_SCHEMA.find((x) => x.name === `JAGHELM_${base}`);
      assert.ok(d, `JAGHELM_${base}`);
      const prefixedOnly = ['adguard', 'cloudflare', 'photoprism'].includes(preset);
      assert.deepEqual(d.legacy, prefixedOnly ? [] : [base], `${preset} ${base}`);
    }
  }
  assert.equal(LEGACY_NAMES.GITEA_URL, 'JAGHELM_GITEA_URL');
  assert.equal(LEGACY_NAMES.GITEA_TOKEN, 'JAGHELM_GITEA_TOKEN');
  assert.equal(LEGACY_NAMES.SONARR_API_KEY, 'JAGHELM_SONARR_API_KEY');
  assert.equal(LEGACY_NAMES.ADGUARD_URL, undefined, 'never read unprefixed');
});

test('the server settings keep their names: no JAGHELM_ alias is added for them', () => {
  for (const name of ['PROMETHEUS_URL', 'KUMA_URL', 'KUMA_API_KEY', 'DASH_SECRET', 'DASH_USER', 'DASH_PASS', 'PORT', 'TRUST_PROXY', 'FCM_SERVICE_ACCOUNT', 'ARCANE_URL']) {
    const d = ENV_SCHEMA.find((x) => x.name === name);
    assert.ok(d, name);
    assert.deepEqual(d.legacy, [], name);
  }
});

test('unset or empty reads as the default', () => {
  for (const raw of [{}, { PORT: '', LOG_LEVEL: '', CSP_REPORT_ONLY: '', TRUST_PROXY: '', KUMA_URL: '' }]) {
    assert.equal(envValue('PORT', raw), 3099);
    assert.equal(envValue('LOG_LEVEL', raw), 'info');
    assert.equal(envValue('CSP_REPORT_ONLY', raw), false);
    assert.deepEqual(envValue('TRUST_PROXY', raw), []);
    assert.equal(envValue('KUMA_URL', raw), '');
    assert.equal(envFrom('KUMA_URL', raw), null);
  }
  assert.equal(envValue('JAGHELM_ICON_CACHE_MAX_MB', {}), 50);
  assert.equal(envValue('DEMO_SCENARIO', {}), 'incident');
  assert.equal(envValue('ARCANE_VULN_DIGEST_HOUR', {}), 14);
});

test('each type reads its value', () => {
  const raw = {
    PORT: ' 0 ',
    LOG_LEVEL: 'DEBUG',
    CSP_REPORT_ONLY: 'True',
    JAGHELM_BLOCK_PRIVATE_NETWORKS: 'false',
    TRUST_PROXY: ' 192.168.1.10 , ,loopback ',
    ARCANE_VULN_DIGEST_DAY: '-1',
    JAGHELM_ICON_CACHE_MAX_MB: '0.5',
    DASH_PASS: ' spaced pass ', // pragma: allowlist secret
  };
  assert.equal(envValue('PORT', raw), 0);
  assert.equal(envValue('LOG_LEVEL', raw), 'debug');
  assert.equal(envValue('CSP_REPORT_ONLY', raw), true);
  assert.equal(envValue('JAGHELM_BLOCK_PRIVATE_NETWORKS', raw), false);
  assert.deepEqual(envValue('TRUST_PROXY', raw), ['192.168.1.10', 'loopback']);
  assert.equal(envValue('ARCANE_VULN_DIGEST_DAY', raw), -1, 'the reader keeps it in range');
  assert.equal(envValue('JAGHELM_ICON_CACHE_MAX_MB', raw), 0.5);
  assert.equal(envValue('DASH_PASS', raw), ' spaced pass ', 'a secret is read as it is'); // pragma: allowlist secret
});

test('a value that does not fit its type is a problem naming the variable, and reads as the default', () => {
  const cases = [
    ['PORT', 'http', 'PORT must be a port number from 0 to 65535', 3099],
    ['PORT', '70000', 'PORT must be a port number from 0 to 65535', 3099],
    ['LOG_LEVEL', 'loud', 'LOG_LEVEL must be one of debug, info, warn, error, silent', 'info'],
    ['CSP_REPORT_ONLY', 'yes', 'CSP_REPORT_ONLY must be true or false', false],
    ['ARCANE_POLL_SECONDS', '300s', 'ARCANE_POLL_SECONDS must be a whole number', 300],
    ['JAGHELM_PRESENCE_TTL_MS', '-5', 'JAGHELM_PRESENCE_TTL_MS must be a number above 0', 86_400_000],
    ['JAGHELM_ICON_CACHE_MAX_MB', 'Infinity', 'JAGHELM_ICON_CACHE_MAX_MB must be a number above 0', 50],
    ['DEMO_SCENARIO', 'chaos', 'DEMO_SCENARIO must be one of incident, healthy', 'incident'],
  ];
  for (const [name, text, problem, fallback] of cases) {
    assert.deepEqual(readEnv(name, { [name]: text }), { value: fallback, from: name, problem }, `${name}=${text}`);
  }
});

test('a name the schema does not have throws: a reader can not drift from the schema', () => {
  assert.throws(() => envValue('JAGHELM_NO_SUCH_THING', {}), /JAGHELM_NO_SUCH_THING is not in the environment schema/);
});

test('the JAGHELM_ name works, and so does the old one, which it wins over', () => {
  assert.equal(envValue('JAGHELM_GITEA_URL', { JAGHELM_GITEA_URL: 'http://new:3000' }), 'http://new:3000');
  assert.equal(envValue('JAGHELM_GITEA_URL', { GITEA_URL: 'http://old:3000' }), 'http://old:3000');
  assert.equal(envFrom('JAGHELM_GITEA_URL', { GITEA_URL: 'http://old:3000' }), 'GITEA_URL');
  const both = { JAGHELM_GITEA_URL: 'http://new:3000', GITEA_URL: 'http://old:3000' };
  assert.equal(envValue('JAGHELM_GITEA_URL', both), 'http://new:3000');
  assert.equal(envFrom('JAGHELM_GITEA_URL', both), 'JAGHELM_GITEA_URL');
  // An empty new name doesn't hide the old one.
  assert.equal(envValue('JAGHELM_SONARR_API_KEY', { JAGHELM_SONARR_API_KEY: '', SONARR_API_KEY: 'k' }), 'k');
});

// Distinct values, so a line that carried one would show.
const VALUES = {
  GITEA_URL: 'http://gitea-old.invalid:3000',
  GITEA_TOKEN: 'tok-old-5f1e2d', // pragma: allowlist secret
  JAGHELM_GITEA_TOKEN: 'tok-new-9a8b7c', // pragma: allowlist secret
  NPM_PASS: 'npm-pass-3c4d', // pragma: allowlist secret
  JAGHELM_NPM_PASS: 'npm-pass-3c4d', // pragma: allowlist secret
  PORT: 'port-http-x',
  LOG_LEVEL: 'loud-level-y',
};

test('the boot report: one warning per old name, the conflict saying which is used, one error per invalid value, no value anywhere', () => {
  const { lines, logger } = recorder();
  const ok = reportEnv(logger, VALUES);

  assert.equal(ok, false, 'an invalid value stops the start');
  assert.deepEqual(lines, [
    ['warn', { variable: 'GITEA_URL', use: 'JAGHELM_GITEA_URL' }, 'GITEA_URL is deprecated: rename it to JAGHELM_GITEA_URL. The next release reads only JAGHELM_GITEA_URL'],
    ['warn', { variable: 'GITEA_TOKEN', use: 'JAGHELM_GITEA_TOKEN' }, 'GITEA_TOKEN and JAGHELM_GITEA_TOKEN are both set and differ: using JAGHELM_GITEA_TOKEN. Remove GITEA_TOKEN, which is deprecated'],
    ['warn', { variable: 'NPM_PASS', use: 'JAGHELM_NPM_PASS' }, 'NPM_PASS is deprecated: rename it to JAGHELM_NPM_PASS. The next release reads only JAGHELM_NPM_PASS'],
    ['error', { variable: 'PORT' }, "PORT must be a port number from 0 to 65535: JagHelm won't start until it is fixed"],
    ['error', { variable: 'LOG_LEVEL' }, "LOG_LEVEL must be one of debug, info, warn, error, silent: JagHelm won't start until it is fixed"],
  ]);
  const text = JSON.stringify(lines);
  for (const value of Object.values(VALUES)) assert.ok(!text.includes(value), `${value} in ${text}`);
});

test('the boot report warns for an old name once per process, however often it runs', () => {
  const { lines, logger } = recorder();
  const raw = { HASS_URL: 'http://ha.invalid:8123', HASS_TOKEN: 'ha-tok' }; // pragma: allowlist secret
  assert.equal(reportEnv(logger, raw), true);
  assert.equal(reportEnv(logger, raw), true);
  assert.deepEqual(
    lines.map(([level, fields]) => [level, fields.variable]),
    [['warn', 'HASS_URL'], ['warn', 'HASS_TOKEN']]
  );
});

test('both names set to the same value: only the deprecation, nothing about a conflict', () => {
  const { problems, notices } = checkEnv({ JAGHELM_GITEA_URL: 'http://g:3000', GITEA_URL: 'http://g:3000' });
  assert.deepEqual(problems, []);
  assert.deepEqual(notices.map((n) => [n.variable, /deprecated: rename/.test(n.message)]), [['GITEA_URL', true]]);
});

test('a clean environment, as an install has it today, reports nothing and may start', () => {
  const { lines, logger } = recorder();
  const live = {
    PROMETHEUS_URL: 'http://prom.invalid:9090',
    KUMA_URL: 'http://kuma.invalid:3001',
    KUMA_API_KEY: 'k',
    DASH_SECRET: 'x'.repeat(64),
    DASH_USER: 'admin',
    DASH_PASS: 'p', // pragma: allowlist secret
    PORT: '3099',
    TRUST_PROXY: '192.168.1.10',
    LOG_LEVEL: '',
    CSP_REPORT_ONLY: '',
    ARCANE_CHECK_ONLY_ENVS: 'pi-1,pi-2',
    ARCANE_VULN_DIGEST_ENVS: 'vm-103',
    FCM_SERVICE_ACCOUNT: '/app/secrets/fcm-service-account.json',
    JAGHELM_CRON_SECRET: 'c',
    PATH: '/usr/bin',
    HOSTNAME: 'jaghelm',
  };
  assert.equal(reportEnv(logger, live), true);
  assert.deepEqual(lines, []);
});

// #261: the listen address, JAGHELM_HOST. Resolved, never bound here.
test('the bind address defaults to 0.0.0.0, as before it was configurable', () => {
  assert.equal(DEFAULT_BIND_HOST, '0.0.0.0');
  assert.equal(resolveBindHost({}), '0.0.0.0');
});

test('a blank JAGHELM_HOST keeps the default', () => {
  for (const v of ['', '   ', '\t']) assert.equal(resolveBindHost({ JAGHELM_HOST: v }), '0.0.0.0');
});

test('JAGHELM_HOST overrides the bind address, trimmed', () => {
  assert.equal(resolveBindHost({ JAGHELM_HOST: '127.0.0.1' }), '127.0.0.1');
  assert.equal(resolveBindHost({ JAGHELM_HOST: ' 192.168.1.20 ' }), '192.168.1.20');
  assert.equal(resolveBindHost({ JAGHELM_HOST: '::' }), '::');
});

test('only JAGHELM_HOST counts, not a generic HOST', () => {
  assert.equal(resolveBindHost({ HOST: 'example-box' }), '0.0.0.0');
});

test('the readers read process.env by default', () => {
  const before = process.env.JAGHELM_HOST;
  try {
    process.env.JAGHELM_HOST = '127.0.0.1';
    assert.equal(resolveBindHost(), '127.0.0.1');
    assert.equal(envValue('JAGHELM_HOST'), '127.0.0.1');
  } finally {
    if (before === undefined) delete process.env.JAGHELM_HOST;
    else process.env.JAGHELM_HOST = before;
  }
});
