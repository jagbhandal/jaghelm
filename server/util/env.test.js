import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BIND_HOST, resolveBindHost } from './env.js';

// #261: the listen address, JAGHELM_HOST. Resolved, never bound here.
test('the bind address defaults to 0.0.0.0, as before it was configurable', () => {
  assert.equal(DEFAULT_BIND_HOST, '0.0.0.0');
  assert.equal(resolveBindHost({}), '0.0.0.0');
});

test('a blank JAGHELM_HOST keeps the default', () => {
  for (const v of ['', '   ', '\t']) assert.equal(resolveBindHost({ JAGHELM_HOST: v }), '0.0.0.0');
});

test('JAGHELM_HOST overrides the bind address, trimmed', () => {
  assert.equal(resolveBindHost({ JAGHELM_HOST: '127.0.0.1' }), '127.0.0.1');
  assert.equal(resolveBindHost({ JAGHELM_HOST: ' 192.168.1.20 ' }), '192.168.1.20');
  assert.equal(resolveBindHost({ JAGHELM_HOST: '::' }), '::');
});

test('only JAGHELM_HOST counts, not a generic HOST', () => {
  assert.equal(resolveBindHost({ HOST: 'example-box' }), '0.0.0.0');
});

test('resolveBindHost reads process.env by default', () => {
  const before = process.env.JAGHELM_HOST;
  try {
    process.env.JAGHELM_HOST = '127.0.0.1';
    assert.equal(resolveBindHost(), '127.0.0.1');
  } finally {
    if (before === undefined) delete process.env.JAGHELM_HOST;
    else process.env.JAGHELM_HOST = before;
  }
});
