import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setStorageAdapter, getItem, removeItem } = vi.hoisted(() => ({
  setStorageAdapter: vi.fn(),
  getItem: vi.fn(),
  removeItem: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@shared/storage/index.js', () => ({ setStorageAdapter, secureStore: { getItem, removeItem } }));

vi.mock('./storage/keystoreAdapter.js', () => ({ keystoreAdapter: {} }));

const { installNativeHttp } = vi.hoisted(() => ({ installNativeHttp: vi.fn() }));
vi.mock('./nativeHttp.js', () => ({ installNativeHttp }));

const { getPref } = vi.hoisted(() => ({ getPref: vi.fn() }));
vi.mock('./storage/prefsAdapter.js', () => ({ getPref }));

const { initAuthToken, setAuthToken, getAuthToken, apiFetch } = vi.hoisted(() => ({
  initAuthToken: vi.fn().mockResolvedValue(undefined),
  setAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  apiFetch: vi.fn(),
}));
vi.mock('@shared/api/client.js', () => ({ initAuthToken, setAuthToken, getAuthToken, apiFetch }));

const { setApiBase } = vi.hoisted(() => ({ setApiBase: vi.fn() }));
vi.mock('@shared/api/baseUrl.js', () => ({ setApiBase }));

import { bootMobile } from './boot.js';

const checkRes = (authenticated, ok = true) => ({ ok, json: async () => ({ authenticated, authRequired: true }) });

beforeEach(() => {
  vi.clearAllMocks();
  removeItem.mockResolvedValue(undefined);
  initAuthToken.mockResolvedValue(undefined);
});

describe('bootMobile', () => {
  it('wires the keystore adapter and reports not-configured when no base URL is stored', async () => {
    getItem.mockResolvedValue(null);
    const r = await bootMobile();
    expect(setStorageAdapter).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ hasUrl: false, hasToken: false, baseUrl: '' });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('with remember on + a valid token, applies the base, revalidates, and reports authed', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('true');
    getAuthToken.mockReturnValue('tok');
    apiFetch.mockResolvedValue(checkRes(true));
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: true, hasToken: true, baseUrl: 'http://vm-101:3099/api' });
    expect(setApiBase).toHaveBeenCalledWith('http://vm-101:3099/api');
  });

  it('clears a stale token when the server says not authenticated', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('true');
    getAuthToken.mockReturnValue('stale');
    apiFetch.mockResolvedValue(checkRes(false));
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: true, hasToken: false, baseUrl: 'http://vm-101:3099/api' });
    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
    expect(setAuthToken).toHaveBeenCalledWith('');
  });

  it('with remember off, wipes the token and never revalidates', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('false');
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: true, hasToken: false, baseUrl: 'http://vm-101:3099/api' });
    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('with remember on but no token, reports needs-auth without revalidating', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('true');
    getAuthToken.mockReturnValue('');
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: true, hasToken: false, baseUrl: 'http://vm-101:3099/api' });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('keeps the token optimistically when revalidation throws (offline cold start)', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('true');
    getAuthToken.mockReturnValue('tok');
    apiFetch.mockRejectedValue(new Error('offline'));
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: true, hasToken: true, baseUrl: 'http://vm-101:3099/api' });
  });
});
