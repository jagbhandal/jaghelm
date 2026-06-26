import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { secureStore, setStorageAdapter } from './index.js';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

afterEach(() => {
  // Reset to the web default so a swapped adapter can't leak across tests.
  setStorageAdapter({
    async getItem(k) {
      return (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || null;
    },
    async setItem(k, v) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
    },
    async removeItem(k) {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
    },
  });
});

describe('secureStore — web default backed by localStorage', () => {
  it('WEB DEFAULT: round-trips through localStorage (byte-for-byte persistence)', async () => {
    await secureStore.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(await secureStore.getItem('k')).toBe('v');
    await secureStore.removeItem('k');
    expect(await secureStore.getItem('k')).toBe(null);
  });

  it('returns null for a missing key', async () => {
    expect(await secureStore.getItem('nope')).toBe(null);
  });

  it('setStorageAdapter swaps the backing impl (mobile Keystore later)', async () => {
    const mem = new Map();
    setStorageAdapter({
      async getItem(k) { return mem.has(k) ? mem.get(k) : null; },
      async setItem(k, v) { mem.set(k, String(v)); },
      async removeItem(k) { mem.delete(k); },
    });
    await secureStore.setItem('t', 'abc');
    expect(mem.get('t')).toBe('abc');          // went to the swapped adapter
    expect(localStorage.getItem('t')).toBe(null); // NOT to localStorage
    expect(await secureStore.getItem('t')).toBe('abc');
  });
});
