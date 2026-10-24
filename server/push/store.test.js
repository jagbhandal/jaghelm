import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPushStore } from './store.js';

describe('getPushStore singleton', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getPushStore();
    const b = getPushStore();
    assert.equal(a, b);
  });

  it('is the Web Push subscription store', () => {
    const store = getPushStore();
    assert.equal(typeof store.register, 'function');
    assert.equal(typeof store.getDevices, 'function');
    assert.equal(store.registerToken, undefined, 'the FCM token store is gone');
  });
});
