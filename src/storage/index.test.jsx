import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { prefs, secureStore, setStorageAdapter, webStorage } from './index.js';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

afterEach(() => {
  // Reset to the web default so a swapped adapter can't leak across tests.
  setStorageAdapter(webStorage);
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

describe('prefs — a per-browser preference, read at once, never throwing', () => {
  it('round-trips a string, and removes it with null', () => {
    prefs.set('jh-pref', 'on');
    expect(localStorage.getItem('jh-pref')).toBe('on');
    expect(prefs.get('jh-pref')).toBe('on');
    prefs.set('jh-pref', null);
    expect(prefs.get('jh-pref', 'off')).toBe('off');
  });

  it('works without storage: a read gives the fallback, a write does nothing', () => {
    const throwing = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(throwing);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(throwing);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(throwing);
    expect(prefs.get('jh-pref', 'fallback')).toBe('fallback');
    expect(() => prefs.set('jh-pref', 'on')).not.toThrow();
    expect(() => prefs.set('jh-pref', null)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
    remove.mockRestore();
  });
});
