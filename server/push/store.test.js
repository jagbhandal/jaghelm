import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPushStore } from './store.js';

describe('getPushStore singleton', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getPushStore();
    const b = getPushStore();
    assert.equal(a, b);
  });

  it('exposes registerToken as a function', () => {
    assert.equal(typeof getPushStore().registerToken, 'function');
  });
});
