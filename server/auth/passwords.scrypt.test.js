/**
 * verifyPassword must treat a corrupt/truncated scrypt hash as "no match" and
 * NEVER throw. An uncaught throw escapes the synchronous /login handler as a 500
 * on every attempt, permanently locking the admin out (a bad manual edit, a crash
 * mid-write, or a migration bug all produce a malformed auth.json).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPassword, hashPassword } from './passwords.js';

test('verifyPassword round-trips a real scrypt hash', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
});

test('verifyPassword returns false (never throws) for a corrupt scrypt hash', () => {
  const corrupt = [
    'scrypt:',                 // no salt/hash
    'scrypt:onlysalt',         // missing hash segment
    'scrypt:salt:',            // empty hash
    'scrypt:salt:zz',          // non-hex hash
    'scrypt:salt:abc',         // odd-length hex
    'scrypt:salt:0011',        // valid hex but wrong length
  ];
  for (const stored of corrupt) {
    assert.equal(verifyPassword('pw', stored), false, `should be false for ${JSON.stringify(stored)}`);
  }
});
