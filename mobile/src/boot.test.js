import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setStorageAdapter, initAuthToken, setApiBase, getItem } = vi.hoisted(() => ({
  setStorageAdapter: vi.fn(),
  initAuthToken: vi.fn().mockResolvedValue(undefined),
  setApiBase: vi.fn(),
  getItem: vi.fn(),
}));

vi.mock('@shared/storage/index.js', () => ({ setStorageAdapter }));
vi.mock('@shared/api/client.js', () => ({ initAuthToken }));
vi.mock('@shared/api/baseUrl.js', () => ({ setApiBase }));
vi.mock('./storage/keystoreAdapter.js', () => ({ keystoreAdapter: { getItem } }));

import { bootMobile } from './boot.js';

beforeEach(() => {
  setStorageAdapter.mockClear();
  initAuthToken.mockClear();
  setApiBase.mockClear();
  getItem.mockReset();
});

describe('bootMobile', () => {
  it('wires keystore adapter, inits token, and reports unconfigured on first run', async () => {
    getItem.mockResolvedValue(null);
    const r = await bootMobile();
    expect(setStorageAdapter).toHaveBeenCalledTimes(1);
    expect(initAuthToken).toHaveBeenCalledTimes(1);
    expect(setApiBase).not.toHaveBeenCalled();
    expect(r).toEqual({ configured: false });
  });

  it('applies the stored base and reports configured', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    const r = await bootMobile();
    expect(setApiBase).toHaveBeenCalledWith('http://vm-101:3099/api');
    expect(r).toEqual({ configured: true });
  });

  it('inits the token AFTER the storage adapter is swapped', async () => {
    getItem.mockResolvedValue(null);
    const order = [];
    setStorageAdapter.mockImplementation(() => order.push('adapter'));
    initAuthToken.mockImplementation(async () => order.push('token'));
    await bootMobile();
    expect(order).toEqual(['adapter', 'token']);
  });
});
