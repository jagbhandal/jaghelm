import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prefs, secureStore } from './index.js';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('secureStore — backed by localStorage', () => {
  it('round-trips through localStorage (byte-for-byte persistence)', async () => {
    await secureStore.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(await secureStore.getItem('k')).toBe('v');
    await secureStore.removeItem('k');
    expect(await secureStore.getItem('k')).toBe(null);
  });

  it('returns null for a missing key', async () => {
    expect(await secureStore.getItem('nope')).toBe(null);
  });

  it('without localStorage a read is null and a write does nothing', async () => {
    vi.stubGlobal('localStorage', undefined);
    expect(await secureStore.getItem('k')).toBe(null);
    await expect(secureStore.setItem('k', 'v')).resolves.toBeUndefined();
    await expect(secureStore.removeItem('k')).resolves.toBeUndefined();
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
