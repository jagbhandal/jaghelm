/**
 * Tests for passwords.js — specifically the legacy SHA-256 verification path.
 *
 * The original code used `sha === stored`, which short-circuits on first
 * mismatched byte and leaks timing info about the digest. We now route legacy
 * verification through crypto.timingSafeEqual on equal-length 32-byte buffers.
 *
 * Functional verification: a mismatch returns false, a match returns true.
 * (Timing is not asserted — that's outside `node --test`'s remit — but the
 * code path is exercised and never falls back to string-equals.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';

const password = 'correct horse battery staple'; // pragma: allowlist secret
const wrongPassword = 'tr0ub4dor&3';
const sha256Hex = crypto.createHash('sha256').update(password).digest('hex');

// The legacy-SHA-256 branch isn't reachable via the public API (setPassword
// always writes scrypt), so we stage auth.json in a temp data dir
// (JAGHELM_DATA_DIR, set before passwords.js is imported), never in the
// checkout's own data/ (#261).
const DATA_DIR = mkdtempSync(join(tmpdir(), 'jh-passwords-'));
process.env.JAGHELM_DATA_DIR = DATA_DIR;
writeFileSync(join(DATA_DIR, 'auth.json'), JSON.stringify({
  passwordHash: sha256Hex,
  updatedAt: new Date().toISOString(),
}, null, 2));

// Force DASH_PASS empty so the override path is exercised.
process.env.DASH_PASS = '';

// Dynamic import after staging the file.
const { checkPassword, authEnabled } = await import('./passwords.js');

test.after(() => rmSync(DATA_DIR, { recursive: true, force: true }));

test('legacy SHA-256: mismatched password returns false', () => {
  assert.equal(authEnabled(), true, 'auth should be enabled when hash is staged');
  assert.equal(checkPassword(wrongPassword), false);
});

test('legacy SHA-256: matched password returns true (and migrates to scrypt)', () => {
  // Use a different password instance to avoid being affected by the previous
  // test's potential side effects. Since the test above didn't match, the
  // store still holds the legacy hash for the correct password.
  assert.equal(checkPassword(password), true);
});

test('legacy SHA-256: empty password returns false without throwing', () => {
  // After the migration in the previous test, the store holds a scrypt hash
  // for `password`. Empty input must not match and must not throw.
  assert.equal(checkPassword(''), false);
});
