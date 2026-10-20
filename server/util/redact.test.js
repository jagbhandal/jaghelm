import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactError } from './redact.js';

test('redacts known secret query params', () => {
  assert.ok(!redactSecrets('failed: https://h/api?apikey=SEKRET123').includes('SEKRET123'));
  assert.ok(!redactSecrets('https://h/api?token=abc').includes('abc'));
  assert.ok(!redactSecrets('https://h/api?api_key=xyz').includes('xyz'));
  assert.ok(!redactSecrets('https://h/?password=hunter2').includes('hunter2'));
});

test('strips the entire query string off URLs (catches unknown param names)', () => {
  const out = redactSecrets('connect ECONNREFUSED https://h:8006/?ticket=PVE:secretvalue');
  assert.ok(!out.includes('secretvalue'), out);
});

test('redacts URL userinfo passwords (user:pass@host)', () => {
  const out = redactSecrets("connect failed to https://admin:SUPERSECRET@host:9000/api");
  assert.ok(!out.includes('SUPERSECRET'), out);
  assert.ok(out.includes('admin'), out);           // username kept as a hint
  assert.ok(out.includes('[redacted]'), out);
});

test('redacts userinfo inside a realistic fetch error message', () => {
  const out = redactError(new Error('request to https://svc:t0k3n@10.0.0.5/v1 failed, ETIMEDOUT'));
  assert.ok(!out.includes('t0k3n'), out);
});

test('leaves non-secret text intact', () => {
  assert.equal(redactSecrets('HTTP 502 Bad Gateway'), 'HTTP 502 Bad Gateway');
});

test('redactError handles Error objects and null/undefined', () => {
  assert.ok(!redactError(new Error('boom https://h/x?token=abc')).includes('abc'));
  assert.equal(redactError(null), null);
  assert.equal(redactError(undefined), undefined);
});

test('redacts userinfo in a URL of any scheme, not only http(s) (#409)', () => {
  for (const url of [
    'ws://svc:t0k3n@10.0.0.5/socket', // pragma: allowlist secret
    'postgres://app:t0k3n@db:5432/jaghelm', // pragma: allowlist secret
    'redis://:t0k3n@cache:6379', // pragma: allowlist secret
  ]) {
    const out = redactSecrets(`connect failed: ${url}`);
    assert.ok(!out.includes('t0k3n'), out);
    assert.ok(out.includes(':[redacted]@'), out);
  }
});

test('a URL with a user and no password loses the user: it is often the token itself (#409)', () => {
  const out = redactSecrets('Request cannot be constructed from a URL that includes credentials: https://ghp_t0k3n@git.test/x'); // pragma: allowlist secret
  assert.ok(!out.includes('t0k3n'), out);
  assert.ok(out.includes('https://[redacted]@git.test/x'), out);
});

test('a password holding an @ is redacted whole, up to the last @ before the host (#409)', () => {
  const out = redactSecrets('to http://jag:hun@ter2@127.0.0.1:9/api failed'); // pragma: allowlist secret
  assert.equal(out, 'to http://jag:[redacted]@127.0.0.1:9/api failed');
});

test('an @ after the host (a path, a query, the text after the URL) is not userinfo (#409)', () => {
  for (const s of [
    'GET http://127.0.0.1:9/users/@me failed',
    'mail admin@example.test about http://127.0.0.1:9',
    'http://127.0.0.1:9#a@b',
  ]) {
    assert.equal(redactSecrets(s), s);
  }
});

test('redacting twice gives the same text (#409)', () => {
  const once = redactSecrets('http://jag:hunter2@127.0.0.1:9 and http://t0k3n@h.test'); // pragma: allowlist secret
  assert.equal(redactSecrets(once), once);
  assert.equal(once, 'http://jag:[redacted]@127.0.0.1:9 and http://[redacted]@h.test');
});
