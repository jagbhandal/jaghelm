import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

import { keystoreAdapter } from './keystoreAdapter.js';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

const get = vi.mocked(SecureStoragePlugin.get);
const set = vi.mocked(SecureStoragePlugin.set);
const remove = vi.mocked(SecureStoragePlugin.remove);

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  remove.mockReset();
});

describe('keystoreAdapter', () => {
  it('getItem returns the stored value', async () => {
    get.mockResolvedValue({ value: 'tok123' });
    await expect(keystoreAdapter.getItem('jaghelm-token')).resolves.toBe('tok123');
    expect(get).toHaveBeenCalledWith({ key: 'jaghelm-token' });
  });

  it('getItem returns null (never throws) on a missing key', async () => {
    get.mockRejectedValue(new Error('Item with given key does not exist'));
    await expect(keystoreAdapter.getItem('missing')).resolves.toBeNull();
  });

  it('setItem coerces value to a string', async () => {
    set.mockResolvedValue({ value: true });
    await keystoreAdapter.setItem('k', 42);
    expect(set).toHaveBeenCalledWith({ key: 'k', value: '42' });
  });

  it('removeItem delegates to the plugin', async () => {
    remove.mockResolvedValue({ value: true });
    await keystoreAdapter.removeItem('k');
    expect(remove).toHaveBeenCalledWith({ key: 'k' });
  });

  it('removeItem resolves (never throws) on a missing key', async () => {
    remove.mockRejectedValue(new Error('Item with given key does not exist'));
    await expect(keystoreAdapter.removeItem('missing')).resolves.toBeUndefined();
  });
});
