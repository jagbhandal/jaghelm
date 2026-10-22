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

const { startPendingCleanup } = vi.hoisted(() => ({ startPendingCleanup: vi.fn() }));
vi.mock('./auth/pendingCleanup.js', () => ({ startPendingCleanup }));

import { bootMobile, BOOT_TIMEOUT_MS } from './boot.js';

const checkRes = (authenticated, ok = true) => ({ ok, json: async () => ({ authenticated, authRequired: true }) });

beforeEach(() => {
  vi.clearAllMocks();
  removeItem.mockResolvedValue(undefined);
  initAuthToken.mockResolvedValue(undefined);
});

describe('bootMobile', () => {
  it('starts the pending cleanup (#539) after the Keystore and native HTTP, without waiting for it', async () => {
    getItem.mockResolvedValue(null);
    startPendingCleanup.mockImplementation(() => {
      expect(setStorageAdapter).toHaveBeenCalled();
      expect(installNativeHttp).toHaveBeenCalled();
      return new Promise(() => {}); // a retry that never ends doesn't hold boot
    });
    await expect(bootMobile()).resolves.toEqual({ hasUrl: false, hasToken: false, baseUrl: '' });
    expect(startPendingCleanup).toHaveBeenCalledTimes(1);
    expect(startPendingCleanup).toHaveBeenCalledWith({ resumed: false });
  });

  it.each([
    ['a session that revalidates', () => apiFetch.mockResolvedValue(checkRes(true)), true],
    ['a server that can\'t be reached (token kept)', () => apiFetch.mockRejectedValue(new Error('offline')), true],
    ['a session the server ended', () => apiFetch.mockResolvedValue(checkRes(false)), false],
  ])('tells the cleanup whether a session resumes (push registers next): %s', async (_, check, resumed) => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('true');
    getAuthToken.mockReturnValue('tok');
    check();
    await bootMobile();
    expect(startPendingCleanup).toHaveBeenCalledTimes(1);
    expect(startPendingCleanup).toHaveBeenCalledWith({ resumed });
  });

  it('wires the keystore adapter and reports not-configured when no base URL is stored', async () => {
    getItem.mockResolvedValue(null);
    const r = await bootMobile();
    expect(setStorageAdapter).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ hasUrl: false, hasToken: false, baseUrl: '' });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('rejects a poisoned cleartext-public stored base and forces re-setup', async () => {
    getItem.mockResolvedValue('http://8.8.8.8:3099/api');
    getPref.mockResolvedValue('true');
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: false, hasToken: false, baseUrl: '' });
    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
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

  it('reports unreachable (token kept) when revalidation throws', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('true');
    getAuthToken.mockReturnValue('tok');
    apiFetch.mockRejectedValue(new Error('offline'));
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: true, hasToken: true, baseUrl: 'http://vm-101:3099/api', unreachable: true });
    expect(removeItem).not.toHaveBeenCalled();
    expect(setAuthToken).not.toHaveBeenCalled();
  });

  it('reports unreachable after BOOT_TIMEOUT_MS when revalidation hangs, token untouched', async () => {
    vi.useFakeTimers();
    try {
      getItem.mockResolvedValue('http://vm-101:3099/api');
      getPref.mockResolvedValue('true');
      getAuthToken.mockReturnValue('tok');
      apiFetch.mockReturnValue(new Promise(() => {}));
      expect(BOOT_TIMEOUT_MS).toBe(10000);
      let result;
      const p = bootMobile().then((r) => { result = r; });
      await vi.advanceTimersByTimeAsync(BOOT_TIMEOUT_MS - 1);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(result).toEqual({ hasUrl: true, hasToken: true, baseUrl: 'http://vm-101:3099/api', unreachable: true });
      expect(removeItem).not.toHaveBeenCalled();
      expect(setAuthToken).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares one BOOT_TIMEOUT_MS deadline across fetch and body read', async () => {
    vi.useFakeTimers();
    try {
      getItem.mockResolvedValue('http://vm-101:3099/api');
      getPref.mockResolvedValue('true');
      getAuthToken.mockReturnValue('tok');
      // Headers arrive at 6 s, the body never does: a per-step timeout would only
      // fire at 16 s; the shared deadline must fire at 10 s total.
      apiFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: () => new Promise(() => {}) }), 6000)),
      );
      let result;
      const p = bootMobile().then((r) => { result = r; });
      await vi.advanceTimersByTimeAsync(BOOT_TIMEOUT_MS - 1);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(result).toEqual({ hasUrl: true, hasToken: true, baseUrl: 'http://vm-101:3099/api', unreachable: true });
      expect(removeItem).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a 5xx from /auth/check as unreachable and keeps the token', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('true');
    getAuthToken.mockReturnValue('tok');
    apiFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: true, hasToken: true, baseUrl: 'http://vm-101:3099/api', unreachable: true });
    expect(removeItem).not.toHaveBeenCalled();
    expect(setAuthToken).not.toHaveBeenCalled();
  });

  it('still clears the token on a 401 from /auth/check', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('true');
    getAuthToken.mockReturnValue('tok');
    apiFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: true, hasToken: false, baseUrl: 'http://vm-101:3099/api' });
    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
  });

  it('treats an unparseable body as not authenticated (not unreachable)', async () => {
    getItem.mockResolvedValue('http://vm-101:3099/api');
    getPref.mockResolvedValue('true');
    getAuthToken.mockReturnValue('tok');
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad json')) });
    const r = await bootMobile();
    expect(r).toEqual({ hasUrl: true, hasToken: false, baseUrl: 'http://vm-101:3099/api' });
  });
});
