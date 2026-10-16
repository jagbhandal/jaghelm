import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetch, setAuthToken } = vi.hoisted(() => ({ apiFetch: vi.fn(), setAuthToken: vi.fn() }));
vi.mock('@shared/api/client.js', () => ({ apiFetch, setAuthToken }));

const { setApiBase } = vi.hoisted(() => ({ setApiBase: vi.fn() }));
vi.mock('@shared/api/baseUrl.js', () => ({ setApiBase }));

import { login } from './login.js';

const CANT_REACH =
  "Can't reach JagHelm. If you're away from home, check that Tailscale is connected on this phone.";

function res({ ok, status, token }) {
  return { ok, status, json: async () => (token !== undefined ? { token } : {}) };
}

beforeEach(() => {
  apiFetch.mockReset();
  setAuthToken.mockReset();
  setApiBase.mockReset();
});

describe('login', () => {
  it('on 200 returns the token and sets base + auth token, POSTing creds to /auth/login', async () => {
    apiFetch.mockResolvedValue(res({ ok: true, status: 200, token: 'abc' }));
    const r = await login({ url: 'http://100.88.196.41:3099', username: 'admin', password: 'pw' });
    expect(r).toEqual({ ok: true, token: 'abc' });
    expect(setApiBase).toHaveBeenCalledWith('http://100.88.196.41:3099/api');
    expect(setAuthToken).toHaveBeenCalledWith('abc');
    const [calledUrl, opts] = apiFetch.mock.calls[0];
    expect(calledUrl).toBe('http://100.88.196.41:3099/api/auth/login');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ username: 'admin', password: 'pw' });
  });

  it('treats a noauth-server token as success', async () => {
    apiFetch.mockResolvedValue(res({ ok: true, status: 200, token: 'noauth' }));
    const r = await login({ url: 'http://vm-101:3099', username: '', password: '' });
    expect(r).toEqual({ ok: true, token: 'noauth' });
  });

  it('maps 401 to an invalid-credentials error and does not set the token', async () => {
    apiFetch.mockResolvedValue(res({ ok: false, status: 401 }));
    const r = await login({ url: 'http://vm-101:3099', username: 'a', password: 'b' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toMatch(/invalid/i);
    expect(setAuthToken).not.toHaveBeenCalled();
  });

  it('maps 429 to a too-many-attempts error', async () => {
    apiFetch.mockResolvedValue(res({ ok: false, status: 429 }));
    const r = await login({ url: 'http://vm-101:3099', username: 'a', password: 'b' });
    expect(r.status).toBe(429);
    expect(r.error).toMatch(/too many/i);
  });

  it("maps a network throw to the can't-reach message", async () => {
    apiFetch.mockRejectedValue(new Error('Network down'));
    const r = await login({ url: 'http://vm-101:3099', username: 'a', password: 'b' });
    expect(r).toEqual({ ok: false, error: CANT_REACH });
    expect(setAuthToken).not.toHaveBeenCalled();
  });

  it('gives up after BOOT_TIMEOUT_MS when the server never answers', async () => {
    vi.useFakeTimers();
    try {
      apiFetch.mockReturnValue(new Promise(() => {}));
      let result;
      const p = login({ url: 'http://vm-101:3099', username: 'a', password: 'b' }).then((r) => {
        result = r;
      });
      await vi.advanceTimersByTimeAsync(9999);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(result).toEqual({ ok: false, error: CANT_REACH });
      expect(setAuthToken).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('one deadline covers the request and the body read', async () => {
    vi.useFakeTimers();
    try {
      apiFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, status: 200, json: () => new Promise(() => {}) }), 6000),
          ),
      );
      let result;
      const p = login({ url: 'http://vm-101:3099', username: 'a', password: 'b' }).then((r) => {
        result = r;
      });
      await vi.advanceTimersByTimeAsync(9999);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(result).toEqual({ ok: false, error: CANT_REACH });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects cleartext http to a public host WITHOUT fetching', async () => {
    const r = await login({ url: 'http://example.com:3099', username: 'a', password: 'b' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tailnet|https/i);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL without fetching', async () => {
    const r = await login({ url: 'not a url', username: 'a', password: 'b' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/valid http/i);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
