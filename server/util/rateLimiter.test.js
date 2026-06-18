import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter } from './rateLimiter.js';

test('allows up to max then blocks within the window', () => {
  const allow = createRateLimiter({ max: 3, windowMs: 10_000 });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
});

test('keys are tracked independently', () => {
  const allow = createRateLimiter({ max: 1, windowMs: 10_000 });
  assert.equal(allow('a'), true);
  assert.equal(allow('b'), true);
  assert.equal(allow('a'), false);
});

test('the window slides — old hits expire', async () => {
  const allow = createRateLimiter({ max: 1, windowMs: 30 });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(allow('a'), true);
});

test('FIFO-caps the number of distinct keys', () => {
  const allow = createRateLimiter({ max: 1, windowMs: 10_000, maxKeys: 2 });
  allow('a');
  allow('b');
  allow('c'); // pushes size past maxKeys → evicts the oldest key ('a')
  assert.equal(allow('a'), true, "'a' was evicted, so it starts fresh");
});
