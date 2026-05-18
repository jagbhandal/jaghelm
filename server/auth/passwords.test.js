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
import { writeFileSync, mkdirSync, rmSync } from 'fs';

// passwords.js reads data/auth.json relative to server/. We don't want to
// stomp on the dev file, so we point the module at a temp data dir before
// import by setting DASH_USER + DASH_PASS to known values for the env path,
// and we exercise legacy SHA-256 via a manually-written auth.json sibling.

const password = 'correct horse battery staple';
const wrongPassword = 'tr0ub4dor&3';
const sha256Hex = crypto.createHash('sha256').update(password).digest('hex');

// Stage a fake data/auth.json before importing passwords.js. The module
// resolves its path as join(__dirname, '..', '..', 'data', 'auth.json'), so
// we need to write to /opt/stacks/jaghelm/data/auth.json — but that would
// collide with dev data. Instead, we re-import after monkey-patching via
// a runtime swap: write a temp auth.json and dynamically set the module's
// internal `storedPasswordHash` through the public setPassword + a follow-up
// hash overwrite. Simpler: spin a child process? Too heavy. We use the
// existing module and call setPassword to install a known scrypt hash, then
// directly test the verifyPassword path through checkPassword.
//
// For the legacy-SHA-256 branch specifically: we cannot reach it cleanly
// from the public API without writing to data/auth.json (setPassword always
// writes scrypt). So we shell out a tiny child Node process that:
//   1. writes a temp data/auth.json with the legacy hash
//   2. dynamically imports passwords.js with cwd pointed at the temp dir
//
// That ends up brittle. Instead, we re-export the internal verifyPassword
// via a side-door: passwords.js doesn't export it, so we test the legacy
// path through behaviour — call setPassword(sha256Hex string as if it were
// the new password). That's wrong though.
//
// Cleanest: directly exercise crypto.timingSafeEqual semantics for the
// legacy branch via a focused integration test that writes auth.json into
// the real data/ dir, imports passwords.js, runs checkPassword, then
// restores the prior file. The fixture is small and we restore at the end.

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, '..', '..', 'data', 'auth.json');
const DATA_DIR = dirname(AUTH_FILE);

// Backup any existing auth.json so we don't disturb dev state.
let backup = null;
if (existsSync(AUTH_FILE)) {
  backup = readFileSync(AUTH_FILE, 'utf8');
}

// Stage the legacy SHA-256 hash before importing the module.
mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(AUTH_FILE, JSON.stringify({
  passwordHash: sha256Hex,
  updatedAt: new Date().toISOString(),
}, null, 2));

// Force DASH_PASS empty so the override path is exercised.
process.env.DASH_PASS = '';

// Dynamic import after staging the file.
const { checkPassword, authEnabled } = await import('./passwords.js');

test.after(() => {
  // Restore prior auth.json (if any) so dev sessions don't break.
  if (backup !== null) {
    writeFileSync(AUTH_FILE, backup);
  } else if (existsSync(AUTH_FILE)) {
    // The module's migration logic may have rewritten this to scrypt during
    // our match-test. Either way, clean it up since we created it.
    unlinkSync(AUTH_FILE);
  }
});

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
