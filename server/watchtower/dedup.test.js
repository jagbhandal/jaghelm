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

test('maxEntries caps the map: oldest insertion is evicted (no longer deduped)', () => {
  const d = createDedup({ windowMs: 100000, maxEntries: 2 });
  const A = { node: 'a', updated: [{ name: 'a', from: '1', to: '2' }], failed: [] };
  const B = { node: 'b', updated: [{ name: 'b', from: '1', to: '2' }], failed: [] };
  const C = { node: 'c', updated: [{ name: 'c', from: '1', to: '2' }], failed: [] };
  assert.equal(d.isDuplicate(A, 0), false);
  assert.equal(d.isDuplicate(A, 1), true);  // A resident, within window → duplicate
  assert.equal(d.isDuplicate(B, 2), false); // size 2
  assert.equal(d.isDuplicate(C, 3), false); // size 3 > 2 → evicts oldest insertion (A)
  // A was evicted by the cap, so it is NOT a duplicate despite being within window.
  assert.equal(d.isDuplicate(A, 4), false);
});
