/**
 * Focused tests for the Nextcloud preset's auth fix.
 *
 * Run with:  node --test server/integrations/presets/nextcloud.test.js
 *
 * Bug being guarded: the preset used `auth: 'basic'` against the serverinfo
 * endpoint. serverinfo treats every request as a login, so a wrong/rotated
 * admin password made each dashboard poll a failed login — silently tripping
 * Nextcloud's brute-force protection, throttling the proxy IP (HTTP 429
 * "Reached maximum delay"), and flooding the NC log. The fix switches to the
 * serverinfo `NC-Token` header (its purpose-built unattended-monitoring auth),
 * which never touches the login/brute-force path.
 *
 * Style mirrors gitlab.test.js: drive the pure functions directly, no I/O.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import nextcloud from './nextcloud.js';
import { __test__ } from '../registry.js';
import { buildAuthHeaders } from '../lib/auth.js';
import { extractValue } from '../lib/extract.js';

const { validatePreset } = __test__;

test('nextcloud preset passes registry validation', () => {
  const { ok, errors } = validatePreset('nextcloud.js', { ...nextcloud });
  assert.equal(ok, true, `expected valid, got errors: ${JSON.stringify(errors)}`);
});

test('nextcloud authenticates with the NC-Token header, never basic auth', () => {
  assert.equal(nextcloud.auth, 'header', 'must not use basic auth against serverinfo');
  assert.equal(nextcloud.authHeader, 'NC-Token');

  const headers = buildAuthHeaders({ ...nextcloud, _token: 'deadbeef' });
  assert.equal(headers['NC-Token'], 'deadbeef', 'token must be sent as NC-Token');
  assert.ok(!('Authorization' in headers), 'must never emit an Authorization/Basic header');
  // OCS calls still require the OCS-APIREQUEST header.
  assert.equal(headers['OCS-APIREQUEST'], 'true');
});

test('nextcloud takes a token only — no username/password creds', () => {
  assert.ok(nextcloud.envKeys.token, 'must expose a token env key');
  assert.ok(!nextcloud.envKeys.username, 'must not ask for a username');
  assert.ok(!nextcloud.envKeys.password, 'must not ask for a password');
});

test('nextcloud tests against the token-gated endpoint, not capabilities', () => {
  // /ocs/v2.php/cloud/capabilities does NOT honor NC-Token (needs a logged-in
  // user), so testing there would reject a valid token. The connection test
  // must hit the same serverinfo endpoint the poller uses.
  assert.equal(nextcloud.testEndpoint, nextcloud.endpoint);
  assert.ok(nextcloud.testEndpoint.includes('/apps/serverinfo/api/v1/info'));
  assert.ok(!nextcloud.testEndpoint.includes('capabilities'));
});

test('nextcloud fields resolve against a realistic serverinfo body', () => {
  // Shape per Nextcloud GET /ocs/v2.php/apps/serverinfo/api/v1/info.
  const body = {
    ocs: { data: { nextcloud: {
      storage: { num_files: 91234, num_users: 5, size_appdata_storage: 2147483648 },
      system: { freespace: 500107862016 },
    } } },
  };
  const byKey = Object.fromEntries(nextcloud.fields.map(f => [f.key, f]));
  assert.equal(extractValue(body, byKey.files.path), 91234);
  assert.equal(extractValue(body, byKey.users.path), 5);
  assert.equal(extractValue(body, byKey.storage.path), 500107862016);
});
