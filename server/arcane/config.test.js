import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readArcaneConfig } from './config.js';

const KEY = 'arc_testkey'; // pragma: allowlist secret

test('disabled when URL or key missing', () => {
  assert.equal(readArcaneConfig({}).enabled, false);
  assert.equal(readArcaneConfig({ ARCANE_URL: 'https://a' }).enabled, false);
  assert.equal(readArcaneConfig({ ARCANE_API_KEY: KEY }).enabled, false);
  assert.equal(readArcaneConfig({ ARCANE_URL: 'https://a', ARCANE_API_KEY: KEY }).enabled, true);
});

test('poll seconds clamp to 60s minimum, default 300s', () => {
  const base = { ARCANE_URL: 'https://a', ARCANE_API_KEY: KEY };
  assert.equal(readArcaneConfig({ ...base, ARCANE_POLL_SECONDS: '10' }).pollMs, 60000);
  assert.equal(readArcaneConfig(base).pollMs, 300000);
  assert.equal(readArcaneConfig({ ...base, ARCANE_POLL_SECONDS: 'abc' }).pollMs, 300000);
});

test('release interval defaults to 6h, min 1h', () => {
  const base = { ARCANE_URL: 'https://a', ARCANE_API_KEY: KEY };
  assert.equal(readArcaneConfig(base).releaseMs, 21600000);
  assert.equal(readArcaneConfig({ ...base, ARCANE_RELEASE_CHECK_HOURS: '0' }).releaseMs, 3600000);
});

test('image check interval defaults to 6h, within 1h to 31 days', () => {
  const base = { ARCANE_URL: 'https://a', ARCANE_API_KEY: KEY };
  const every = (v) => readArcaneConfig({ ...base, ARCANE_IMAGE_CHECK_HOURS: v }).checkEverySeconds;
  assert.equal(readArcaneConfig(base).checkEverySeconds, 21600);
  assert.equal(every('1'), 3600);
  assert.equal(every('24'), 86400);
  assert.equal(every('0'), 3600);
  assert.equal(every('abc'), 21600);
  assert.equal(every('744'), 2678400);
  assert.equal(every('100000'), 2678400);
});

test('check-only envs parse trimmed', () => {
  const c = readArcaneConfig({ ARCANE_CHECK_ONLY_ENVS: ' pi-1, pi-2 ' });
  assert.deepEqual(c.checkOnlyEnvs, new Set(['pi-1', 'pi-2']));
  assert.deepEqual(readArcaneConfig({}).checkOnlyEnvs, new Set());
});

test('cleartext true for http:// URL and trailing slash stripped', () => {
  assert.equal(readArcaneConfig({ ARCANE_URL: 'http://a:3552/' }).cleartext, true);
  assert.equal(readArcaneConfig({ ARCANE_URL: 'http://a:3552/' }).url, 'http://a:3552');
  assert.equal(readArcaneConfig({ ARCANE_URL: 'https://a' }).cleartext, false);
});

test('rejects a URL with userinfo, one warning, no URL echoed', () => {
  // As the parser reads it, and a password of digits then a raw /, # or ?,
  // which it reads as host:port (#419).
  for (const url of [
    'https://user:hunter2@a.test', // pragma: allowlist secret
    'https://user:4321/hunter2@a.test', // pragma: allowlist secret
    'https://user:4321#hunter2@a.test', // pragma: allowlist secret
    'https://user:4321?hunter2@a.test', // pragma: allowlist secret
  ]) {
    const warns = [];
    const logger = { warn: (...a) => warns.push(JSON.stringify(a)) };
    const cfg = readArcaneConfig({ ARCANE_URL: url, ARCANE_API_KEY: KEY }, { logger });
    assert.deepEqual([cfg.enabled, cfg.url, cfg.apiKey], [false, '', ''], url);
    assert.equal(warns.length, 1);
    assert.equal(/hunter2|4321|a\.test/.test(warns[0]), false);
  }
});

test('intervals never exceed the 2^31-1 ms timer limit', () => {
  const base = { ARCANE_URL: 'https://a', ARCANE_API_KEY: KEY };
  const MAX = 2 ** 31 - 1;
  assert.equal(readArcaneConfig({ ...base, ARCANE_POLL_SECONDS: '99999999' }).pollMs, MAX);
  assert.equal(readArcaneConfig({ ...base, ARCANE_POLL_SECONDS: '2147483' }).pollMs, 2147483000);
  assert.equal(readArcaneConfig({ ...base, ARCANE_RELEASE_CHECK_HOURS: '1000' }).releaseMs, MAX);
  assert.equal(readArcaneConfig({ ...base, ARCANE_RELEASE_CHECK_HOURS: '596' }).releaseMs, 596 * 3600000);
});

test('vulnerability digest slot defaults to Sunday 14:00 UTC, clamped to a real day and hour', () => {
  const base = { ARCANE_URL: 'https://a', ARCANE_API_KEY: KEY };
  const slot = (day, hour) => {
    const c = readArcaneConfig({ ...base, ARCANE_VULN_DIGEST_DAY: day, ARCANE_VULN_DIGEST_HOUR: hour });
    return [c.vulnDay, c.vulnHour];
  };
  assert.deepEqual(slot(undefined, undefined), [0, 14]);
  assert.deepEqual(slot('3', '9'), [3, 9]);
  assert.deepEqual(slot('6', '23'), [6, 23]);
  assert.deepEqual(slot('7', '24'), [6, 23]);
  assert.deepEqual(slot('-1', '-5'), [0, 0]);
  assert.deepEqual(slot('sun', 'noon'), [0, 14]);
  // Also present when the integration is off, like the other intervals.
  assert.equal(readArcaneConfig({}).vulnHour, 14);
});

test('vulnerability digest environments parse like the check-only list; empty means off', () => {
  const c = readArcaneConfig({ ARCANE_VULN_DIGEST_ENVS: ' vm-103, pi-1 ,,' });
  assert.deepEqual(c.vulnDigestEnvs, new Set(['vm-103', 'pi-1']));
  assert.deepEqual(readArcaneConfig({}).vulnDigestEnvs, new Set());
  assert.deepEqual(readArcaneConfig({ ARCANE_VULN_DIGEST_ENVS: ' , ' }).vulnDigestEnvs, new Set());
});
