/**
 * Tests for extractValue() in extract.js — the JSON path DSL — and for
 * resolveEndpoint()'s credentialInUrl flag (#224).
 *
 * Focused on two bug fixes:
 *   1. _filter ordering operators (>, <, >=, <=) are numeric-only and must not
 *      silently count 0 when handed a non-numeric value; '=' uses strict
 *      numeric equality (no loose ==).
 *   2. A trailing '._length' segment counts entries on the resolved parent,
 *      including OBJECT maps (caddy/frigate payloads), while the whole-path
 *      '_length' behavior is preserved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractValue, resolveEndpoint, UnresolvedSecretError } from './extract.js';

// ── _filter: numeric ordering guard + strict equality ──────────────────────

test('_filter >: counts items above a numeric threshold', () => {
  const data = [{ cpu: 10 }, { cpu: 90 }, { cpu: 95 }];
  assert.equal(extractValue(data, '_filter:cpu>80'), 2);
});

test('_filter >=: inclusive numeric threshold', () => {
  const data = [{ cpu: 80 }, { cpu: 79 }, { cpu: 81 }];
  assert.equal(extractValue(data, '_filter:cpu>=80'), 2);
});

test('_filter <: counts items below a numeric threshold', () => {
  const data = [{ temp: 5 }, { temp: 50 }, { temp: 100 }];
  assert.equal(extractValue(data, '_filter:temp<60'), 2);
});

test('_filter ordering with a NON-numeric value returns 0 cleanly (not a false match)', () => {
  // BUG: numVal would be NaN, every comparison false → silently 0 with no signal.
  // The guard makes that an explicit, intentional 0 for the misconfiguration.
  const data = [{ status: 'up' }, { status: 'down' }];
  assert.equal(extractValue(data, '_filter:status>online'), 0);
  assert.equal(extractValue(data, '_filter:status<online'), 0);
  assert.equal(extractValue(data, '_filter:status>=online'), 0);
  assert.equal(extractValue(data, '_filter:status<=online'), 0);
});

test('_filter ordering with an empty value returns 0 (Number("") === 0 trap)', () => {
  // Without the trim() guard, Number('') is 0, so 'cpu>' would mean 'cpu>0'.
  const data = [{ cpu: 10 }, { cpu: 0 }];
  assert.equal(extractValue(data, '_filter:cpu>'), 0);
});

test('_filter = numeric: strict equality, no loose ==', () => {
  // itemVal 5 should match numVal 5; '05'/'5.0' coerce to the same number.
  const data = [{ n: 5 }, { n: 5.0 }, { n: 6 }, { n: '5' }];
  // All four coerce: 5, 5, 6, 5 → three equal to 5.
  assert.equal(extractValue(data, '_filter:n=5'), 3);
});

test('_filter = string: compares raw string forms', () => {
  const data = [{ state: 'running' }, { state: 'stopped' }, { state: 'running' }];
  assert.equal(extractValue(data, '_filter:state=running'), 2);
});

test('_filter: ignores items whose field is null/undefined', () => {
  const data = [{ cpu: 90 }, { cpu: null }, {}, { cpu: 95 }];
  assert.equal(extractValue(data, '_filter:cpu>80'), 2);
});

test('_filter: non-array data returns 0', () => {
  assert.equal(extractValue({ not: 'an array' }, '_filter:x>1'), 0);
});

// ── trailing ._length on object maps + arrays ──────────────────────────────

test('trailing ._length on an OBJECT map counts keys (caddy/frigate shape)', () => {
  // caddy: { apps: { http: {...}, tls: {...}, pki: {...} } }
  const data = { apps: { http: {}, tls: {}, pki: {} } };
  assert.equal(extractValue(data, 'apps._length'), 3);
});

test('trailing ._length on an object map — frigate cameras shape', () => {
  const data = { cameras: { front: {}, back: {}, drive: {}, garden: {} } };
  assert.equal(extractValue(data, 'cameras._length'), 4);
});

test('trailing ._length on a nested array counts elements', () => {
  const data = { result: { items: [1, 2, 3, 4, 5] } };
  assert.equal(extractValue(data, 'result.items._length'), 5);
});

test('trailing ._length on a missing parent returns undefined (renders "—")', () => {
  const data = { apps: { http: {} } };
  assert.equal(extractValue(data, 'nope._length'), undefined);
});

test('trailing ._length on a primitive parent returns undefined', () => {
  const data = { count: 7 };
  assert.equal(extractValue(data, 'count._length'), undefined);
});

test('whole-path _length is UNCHANGED: array length', () => {
  assert.equal(extractValue([1, 2, 3], '_length'), 3);
});

test('whole-path _length is UNCHANGED: non-array returns 0', () => {
  assert.equal(extractValue({ a: 1 }, '_length'), 0);
});

// ── standard traversal regression ──────────────────────────────────────────

test('standard dot-notation traversal still works', () => {
  const data = { a: { b: { c: 42 } } };
  assert.equal(extractValue(data, 'a.b.c'), 42);
});

test('array index access still works', () => {
  const data = { list: [{ name: 'x' }, { name: 'y' }] };
  assert.equal(extractValue(data, 'list.1.name'), 'y');
});

test('traversal short-circuits to undefined on a missing branch', () => {
  const data = { a: { b: null } };
  assert.equal(extractValue(data, 'a.b.c'), undefined);
});

// ── resolveEndpoint: placeholders + the credentialInUrl flag (#224) ─────────

test('resolveEndpoint fills a non-credential placeholder without flagging it', () => {
  assert.deepEqual(
    resolveEndpoint('/accounts/{account_id}/x?y={missing}', { account_id: 'a1' }),
    { path: '/accounts/a1/x?y={missing}', credentialInUrl: false },
  );
});

test('resolveEndpoint flags a filled credential placeholder, with or without the underscore', () => {
  const config = { token: 'raw', _token: 't1', _password: 'p1', _username: 'u1' };
  for (const [endpoint, path] of [
    ['/api?key={token}', '/api?key=t1'],
    ['/api?key={_token}', '/api?key=t1'],
    ['/api/{password}', '/api/p1'],
    ['/users/{username}', '/users/u1'],
  ]) {
    assert.deepEqual(resolveEndpoint(endpoint, config), { path, credentialInUrl: true }, endpoint);
  }
});

test('resolveEndpoint does not flag a credential placeholder left unfilled', () => {
  assert.deepEqual(resolveEndpoint('/api?key={token}', {}), { path: '/api?key={token}', credentialInUrl: false });
});

// ── resolveEndpoint: the resolved credential, never a $secret: reference (#425) ──

test('resolveEndpoint takes the resolved _ twin over the raw value it was resolved from', () => {
  const config = {
    token: '$secret:integration_x_token', // pragma: allowlist secret
    _token: 'resolved-tok', // pragma: allowlist secret
    password: '$secret:integration_x_password', // pragma: allowlist secret
    _password: 'resolved-pw',
    // A preset's .env username wins over the one in services.yaml.
    username: 'yaml-user',
    _username: 'env-user',
  };
  assert.deepEqual(resolveEndpoint('/a/{username}?k={token}&p={password}', config), {
    path: '/a/env-user?k=resolved-tok&p=resolved-pw',
    credentialInUrl: true,
  });
});

test('resolveEndpoint falls back to the raw value only when there is no _ twin', () => {
  assert.deepEqual(resolveEndpoint('/api?key={token}', { token: 'plain' }), {
    path: '/api?key=plain',
    credentialInUrl: true,
  });
  // A twin that resolved to nothing, with nothing behind it, leaves the placeholder.
  assert.deepEqual(resolveEndpoint('/api?key={token}', { _token: undefined }), {
    path: '/api?key={token}',
    credentialInUrl: false,
  });
});

test('resolveEndpoint refuses a $secret: reference that did not resolve, without naming it', () => {
  for (const [endpoint, config] of [
    ['/api?key={token}', { token: '$secret:hand_key', _token: null }], // pragma: allowlist secret
    ['/api?key={_token}', { token: '$secret:hand_key', _token: null }], // pragma: allowlist secret
    ['/api/{password}', { password: '$secret:hand_key', _password: null }], // pragma: allowlist secret
    // A value that looks like a reference is never put into a URL, resolved or not.
    ['/users/{username}', { username: '$secret:hand_key', _username: '$secret:hand_key' }], // pragma: allowlist secret
    ['/api?key={token}', { token: ' $secret:hand_key' }], // pragma: allowlist secret
    ['/accounts/{account_id}', { account_id: '$secret:hand_key' }], // pragma: allowlist secret
  ]) {
    assert.throws(
      () => resolveEndpoint(endpoint, config),
      (err) => {
        assert.ok(err instanceof UnresolvedSecretError, endpoint);
        assert.match(err.message, /Couldn't resolve the stored credential for \{\w+\} in the endpoint/);
        assert.ok(!err.message.includes('hand_key') && !err.message.includes('$secret'), err.message);
        return true;
      },
      endpoint
    );
  }
});
