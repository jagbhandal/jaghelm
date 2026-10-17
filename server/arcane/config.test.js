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
  const warns = [];
  const logger = { warn: (...a) => warns.push(JSON.stringify(a)) };
  const cfg = readArcaneConfig(
    { ARCANE_URL: 'https://user:hunter2@a.test', ARCANE_API_KEY: KEY },
    { logger }
  );
  assert.equal(cfg.enabled, false);
  assert.equal(warns.length, 1);
  assert.equal(/hunter2|a\.test/.test(warns[0]), false);
});

test('intervals never exceed the 2^31-1 ms timer limit', () => {
  const base = { ARCANE_URL: 'https://a', ARCANE_API_KEY: KEY };
  const MAX = 2 ** 31 - 1;
  assert.equal(readArcaneConfig({ ...base, ARCANE_POLL_SECONDS: '99999999' }).pollMs, MAX);
  assert.equal(readArcaneConfig({ ...base, ARCANE_POLL_SECONDS: '2147483' }).pollMs, 2147483000);
  assert.equal(readArcaneConfig({ ...base, ARCANE_RELEASE_CHECK_HOURS: '1000' }).releaseMs, MAX);
  assert.equal(readArcaneConfig({ ...base, ARCANE_RELEASE_CHECK_HOURS: '596' }).releaseMs, 596 * 3600000);
});
