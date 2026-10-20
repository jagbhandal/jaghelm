/**
 * #413: which values of services.yaml count as credentials, and how the
 * marker that stands in for one goes back to the stored value. The route
 * tests (routes/services.config.test.js) drive these through the real API.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORED_MARKER,
  isStoredMarker,
  maskCredentials,
  restoreCredentials,
} from './configMask.js';

const STORED = { $stored: true };

test('the marker is { "$stored": true } and nothing else', () => {
  assert.deepEqual(STORED_MARKER, STORED);
  assert.ok(Object.isFrozen(STORED_MARKER));
  assert.ok(isStoredMarker({ $stored: true }));
  for (const v of [
    { $stored: true, x: 1 },
    { $stored: 'true' },
    { $stored: false },
    [true],
    '$stored',
    true,
    null,
  ]) {
    assert.ok(!isStoredMarker(v), JSON.stringify(v));
  }
});

test('a password or token is masked at any depth, whatever its value', () => {
  const cfg = {
    integrations: { a: { password: 'p', token: 12345 } }, // pragma: allowlist secret
    // A key older releases wrote, which nothing reads but GET still sends.
    custom_integrations: { old: { token: { nested: 'x' } } },
    nodes: { pi1: { token: '$secret:node_token' } }, // pragma: allowlist secret
  };
  assert.deepEqual(maskCredentials(cfg), {
    integrations: { a: { password: STORED, token: STORED } },
    custom_integrations: { old: { token: STORED } },
    nodes: { pi1: { token: STORED } },
  });
});

test('header values and a session login body are masked; names and the rest are not', () => {
  const cfg = {
    integrations: {
      x: {
        url: 'http://x.test',
        username: 'admin',
        authHeader: 'X-Api-Key',
        authPrefix: 'PVEAPIToken=',
        extraHeaders: { Authorization: 'Bearer abc', 'X-Empty': '' }, // pragma: allowlist secret
        session: { loginEndpoint: '/login', loginBody: 'user={username}&pass={password}' },
        fields: [{ key: 'token', label: 'Token', path: 'data.token' }],
      },
    },
  };
  assert.deepEqual(maskCredentials(cfg), {
    integrations: {
      x: {
        url: 'http://x.test',
        username: 'admin',
        authHeader: 'X-Api-Key',
        authPrefix: 'PVEAPIToken=',
        extraHeaders: { Authorization: STORED, 'X-Empty': '' },
        session: { loginEndpoint: '/login', loginBody: STORED },
        fields: [{ key: 'token', label: 'Token', path: 'data.token' }],
      },
    },
  });
});

test('a credential that is not set stays as it is', () => {
  const cfg = { integrations: { a: { password: '', token: null }, b: { url: 'http://b' } } };
  assert.deepEqual(maskCredentials(cfg), cfg);
});

test('masking copies: the input is not changed, and other values pass through', () => {
  const when = new Date('2026-10-20T00:00:00Z');
  const cfg = { integrations: { a: { password: 'p' } }, created: when }; // pragma: allowlist secret
  const masked = maskCredentials(cfg);
  assert.equal(cfg.integrations.a.password, 'p'); // pragma: allowlist secret
  assert.deepEqual(masked.created, when);
  assert.deepEqual(maskCredentials(null), null);
});

test('restore puts each stored value back in its marker\'s place', () => {
  const stored = {
    nodes: { pi1: { display_name: 'Pi' } },
    integrations: {
      a: { password: 'pa', extraHeaders: { Authorization: 'Bearer h' } }, // pragma: allowlist secret
      b: { token: '$secret:b_token', session: { loginBody: { pass: 'lb' } } }, // pragma: allowlist secret
    },
  };
  const posted = maskCredentials(stored);
  posted.nodes.pi1.display_name = 'Gateway';
  const r = restoreCredentials(posted, stored);
  assert.equal(r.ok, true);
  assert.deepEqual(r.config, {
    ...stored,
    nodes: { pi1: { display_name: 'Gateway' } },
  });
  // The restored values are copies: a later change to one can't reach the stored config.
  r.config.integrations.b.session.loginBody.pass = 'changed'; // pragma: allowlist secret
  assert.equal(stored.integrations.b.session.loginBody.pass, 'lb'); // pragma: allowlist secret
  // The posted body is left as it was.
  assert.deepEqual(posted.integrations.a.password, STORED);
});

test('restore refuses a marker with nothing stored in its place (409), naming only the path', () => {
  const stored = { integrations: { a: { password: 'secret-pa' }, b: {} } }; // pragma: allowlist secret
  const r = restoreCredentials({ integrations: { a: { password: STORED }, b: { password: STORED } } }, stored);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.error, /integrations\.b\.password/);
  assert.ok(!r.error.includes('secret-pa'));
});

test('restore refuses a marker anywhere a credential is not (400)', () => {
  const stored = { nodes: { pi1: { display_name: 'Pi' } } };
  const r = restoreCredentials({ nodes: { pi1: { display_name: STORED } } }, stored);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /nodes\.pi1\.display_name/);
});

test('restore refuses an object with "$stored" that is not the marker (400)', () => {
  const stored = { integrations: { a: { password: 'p' } } }; // pragma: allowlist secret
  const r = restoreCredentials({ integrations: { a: { password: { $stored: true, v: 1 } } } }, stored);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('restore leaves a body without markers as it is', () => {
  const body = { nodes: {}, integrations: { a: { password: 'typed' } } }; // pragma: allowlist secret
  const r = restoreCredentials(body, { integrations: { a: { password: 'old' } } }); // pragma: allowlist secret
  assert.deepEqual(r, { ok: true, config: body });
});

test('a path the error names is cut to 200 characters', () => {
  const key = 'k'.repeat(500);
  const r = restoreCredentials({ integrations: { [key]: { password: STORED } } }, {});
  assert.equal(r.status, 409);
  assert.ok(r.error.length < 320, r.error.length);
});

test('a config nested thousands of levels deep is refused, not a crash', () => {
  const deep = (depth) => JSON.parse('{"x":'.repeat(depth) + '1' + '}'.repeat(depth));
  assert.deepEqual(restoreCredentials({ nodes: {}, deep: deep(20_000) }, {}), {
    ok: false,
    status: 400,
    error: 'Config is nested too deeply',
  });
  // As deep as a copy can go, the walk itself never overflows.
  const masked = maskCredentials({ deep: deep(1_500), integrations: { a: { token: 't' } } });
  assert.deepEqual(masked.integrations.a.token, STORED);
});
