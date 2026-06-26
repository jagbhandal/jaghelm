import { describe, it, expect, afterEach, vi } from 'vitest';
import { apiFetch, setAuthToken } from './client.js';
import { setApiBase } from './baseUrl.js';

function okResp() {
  return { ok: true, status: 200, json: () => Promise.resolve({}) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken('');
  setApiBase('/api');
});

describe('apiFetch — base-aware auth-header injection', () => {
  it('DESKTOP: injects x-auth-token on a relative /api call (byte-for-byte)', async () => {
    setAuthToken('tok123');
    const spy = vi.fn(() => Promise.resolve(okResp()));
    vi.stubGlobal('fetch', spy);
    await apiFetch('/api/services');
    expect(spy.mock.calls[0][1].headers['x-auth-token']).toBe('tok123');
  });

  it('DESKTOP: never injects on the login route (byte-for-byte)', async () => {
    setAuthToken('tok123');
    const spy = vi.fn(() => Promise.resolve(okResp()));
    vi.stubGlobal('fetch', spy);
    await apiFetch('/api/auth/login', { method: 'POST' });
    expect(spy.mock.calls[0][1]?.headers?.['x-auth-token']).toBeUndefined();
  });

  it('MOBILE: injects x-auth-token on an absolute base call', async () => {
    setApiBase('http://vm-101:3099/api');
    setAuthToken('tok123');
    const spy = vi.fn(() => Promise.resolve(okResp()));
    vi.stubGlobal('fetch', spy);
    await apiFetch('http://vm-101:3099/api/services');
    expect(spy.mock.calls[0][1].headers['x-auth-token']).toBe('tok123');
  });

  it('passes non-API URLs straight through with no header', async () => {
    setAuthToken('tok123');
    const spy = vi.fn(() => Promise.resolve(okResp()));
    vi.stubGlobal('fetch', spy);
    await apiFetch('https://cdn.jsdelivr.net/x.svg');
    expect(spy.mock.calls[0][1]).toBeUndefined();
  });
});
