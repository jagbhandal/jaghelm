import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetch, setAuthToken } = vi.hoisted(() => ({ apiFetch: vi.fn(), setAuthToken: vi.fn() }));
vi.mock('@shared/api/client.js', () => ({ apiFetch, setAuthToken }));

const { setApiBase } = vi.hoisted(() => ({ setApiBase: vi.fn() }));
vi.mock('@shared/api/baseUrl.js', () => ({ setApiBase }));

import { testConnection } from './connect.js';

beforeEach(() => {
  apiFetch.mockReset();
  setAuthToken.mockReset();
  setApiBase.mockReset();
});

describe('testConnection', () => {
  it('returns ok on a 2xx from /auth/check', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200 });
    const r = await testConnection({ url: 'http://h:3099', token: 'tok' });
    expect(setApiBase).toHaveBeenCalledWith('http://h:3099/api');
    expect(setAuthToken).toHaveBeenCalledWith('tok');
    expect(apiFetch).toHaveBeenCalledWith('http://h:3099/api/auth/check');
    expect(r.ok).toBe(true);
  });
  it('returns not-ok with the status on a non-2xx', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 401 });
    const r = await testConnection({ url: 'http://h:3099', token: 'bad' });
    expect(r).toEqual({ ok: false, status: 401, error: 'HTTP 401' });
  });
  it('returns not-ok with an error on a network failure', async () => {
    apiFetch.mockRejectedValue(new Error('Network down'));
    const r = await testConnection({ url: 'http://h:3099', token: 'tok' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Network down/);
  });
  it('returns not-ok on an invalid url without calling fetch', async () => {
    const r = await testConnection({ url: 'nope', token: 'tok' });
    expect(r.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
