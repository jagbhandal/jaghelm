// server/util/secretAuth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constantTimeEquals, secretOk } from './secretAuth.js';

test('constantTimeEquals matches equal strings only', () => {
  assert.equal(constantTimeEquals('abc', 'abc'), true);
  assert.equal(constantTimeEquals('abc', 'abd'), false);
});

test('secretOk is false when no secret configured', () => {
  assert.equal(secretOk('', 'anything'), false);
  assert.equal(secretOk('s3cret', 's3cret'), true);
  assert.equal(secretOk('s3cret', 'wrong'), false);
  assert.equal(secretOk('s3cret', undefined), false);
});

test('secretOk accepts only a string provided value (#692)', () => {
  // Stringifying would make a one-element list equal the secret.
  for (const bad of [['s3cret'], { a: 1 }, 5, null, true, undefined]) {
    assert.equal(secretOk('s3cret', bad), false);
  }
  assert.equal(secretOk('s3cret', 's3cret'), true);
});
