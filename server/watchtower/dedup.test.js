// server/watchtower/dedup.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDedup } from './dedup.js';

const R = { node: 'vm-101', updated: [{ name: 'a', from: '1', to: '2' }], failed: [] };

test('same report inside window is a duplicate; outside is not', () => {
  const d = createDedup({ windowMs: 1000 });
  assert.equal(d.isDuplicate(R, 0), false);
  assert.equal(d.isDuplicate(R, 500), true);
  assert.equal(d.isDuplicate(R, 2000), false); // window elapsed
});

test('different node is not a duplicate', () => {
  const d = createDedup({ windowMs: 1000 });
  assert.equal(d.isDuplicate(R, 0), false);
  assert.equal(d.isDuplicate({ ...R, node: 'vm103' }, 1), false);
});
