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
