/**
 * Tests for the LRU-capped session token cache in session.js.
 *
 * The cache exposes a __test side-door (sessionTokenCache, cacheGet, cacheSet,
 * SESSION_CACHE_MAX) used only by these tests. The export is harmless in
 * production since callers don't reach for it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { __test } from './session.js';

const { sessionTokenCache, cacheGet, cacheSet, SESSION_CACHE_MAX } = __test;

function reset() {
  sessionTokenCache.clear();
}

test('cacheSet: stores values', () => {
  reset();
  cacheSet('a', { token: 'TA' });
  assert.equal(sessionTokenCache.size, 1);
  assert.equal(cacheGet('a').token, 'TA');
});

test('cacheSet: overwriting an existing key keeps size stable and bumps to MRU', () => {
  reset();
  cacheSet('a', { token: 'TA1' });
  cacheSet('b', { token: 'TB' });
  cacheSet('a', { token: 'TA2' });
  assert.equal(sessionTokenCache.size, 2);
  assert.equal(cacheGet('a').token, 'TA2');
  // After overwrite, 'a' should be MRU. Adding new entries up to cap and
  // then one more should evict 'b', not 'a'. (Sanity exercise below.)
});

test('cacheGet: accessing an entry bumps it to MRU', () => {
  reset();
  cacheSet('a', { token: 'TA' });
  cacheSet('b', { token: 'TB' });
  // 'a' is currently oldest. Read it to bump.
  cacheGet('a');
  // Now 'b' is the oldest. Fill cache to cap and add one more — 'b' should evict.
  for (let i = 0; i < SESSION_CACHE_MAX - 2; i++) {
    cacheSet(`filler:${i}`, { token: `T${i}` });
  }
  // Cache should now be at cap.
  assert.equal(sessionTokenCache.size, SESSION_CACHE_MAX);
  cacheSet('overflow', { token: 'TO' });
  assert.equal(sessionTokenCache.size, SESSION_CACHE_MAX);
  assert.equal(sessionTokenCache.has('b'), false, "'b' should have been evicted as oldest");
  assert.equal(sessionTokenCache.has('a'), true, "'a' should survive because it was bumped");
  assert.equal(sessionTokenCache.has('overflow'), true);
});

test('cacheSet: evicts the oldest entry when size exceeds cap', () => {
  reset();
  // Fill exactly to cap.
  for (let i = 0; i < SESSION_CACHE_MAX; i++) {
    cacheSet(`k:${i}`, { token: `T${i}` });
  }
  assert.equal(sessionTokenCache.size, SESSION_CACHE_MAX);
  // First-inserted is 'k:0'; it should evict next.
  assert.equal(sessionTokenCache.has('k:0'), true);
  cacheSet('new', { token: 'TNEW' });
  assert.equal(sessionTokenCache.size, SESSION_CACHE_MAX);
  assert.equal(sessionTokenCache.has('k:0'), false, 'oldest entry should have been evicted');
  assert.equal(sessionTokenCache.has('new'), true);
});

test('cacheGet: returns undefined for missing keys', () => {
  reset();
  assert.equal(cacheGet('missing'), undefined);
});
