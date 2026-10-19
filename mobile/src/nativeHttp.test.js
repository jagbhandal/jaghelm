import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { isNativePlatform, request } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  request: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  CapacitorHttp: { request },
}));

import { installNativeHttp, isNativeHttp } from './nativeHttp.js';
import { setApiBase } from '@shared/api/baseUrl.js';
import { getServices, getCronStatus } from '@shared/hooks/useData.js';

const BASE = 'https://helm.tail1234.ts.net/api';
const ETAG = '"abc123"';

// Stands in for Capacitor's own patched fetch (the WebView interceptor path).
let patchedFetch;
let originalFetch;

beforeEach(() => {
  originalFetch = window.fetch;
  patchedFetch = vi.fn(
    async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  );
  window.fetch = patchedFetch;
  isNativePlatform.mockReturnValue(false);
  request.mockReset();
});
afterEach(() => {
  window.fetch = originalFetch;
});

function nativeInstall() {
  isNativePlatform.mockReturnValue(true);
  installNativeHttp();
}

describe('isNativeHttp', () => {
  it('is false in a browser', () => {
    expect(isNativeHttp()).toBe(false);
  });
  it('is true inside the Capacitor app', () => {
    isNativePlatform.mockReturnValue(true);
    expect(isNativeHttp()).toBe(true);
  });
});

describe('installNativeHttp', () => {
  it('leaves fetch alone in a browser', () => {
    installNativeHttp();
    expect(window.fetch).toBe(patchedFetch);
  });

  it('is idempotent: a second install does not wrap twice', async () => {
    nativeInstall();
    const wrapped = window.fetch;
    expect(wrapped).not.toBe(patchedFetch);
    installNativeHttp();
    expect(window.fetch).toBe(wrapped);
    await window.fetch(`${BASE}/services`);
    expect(patchedFetch).toHaveBeenCalledTimes(1);
  });

  it('sends a conditional GET through the native plugin, so a 304 reaches the caller as a 304', async () => {
    nativeInstall();
    request.mockResolvedValue({ status: 304, headers: { ETag: ETAG }, data: '' });
    const r = await window.fetch(`${BASE}/services`, {
      headers: { 'If-None-Match': ETAG, 'x-auth-token': 'tok' },
    });
    expect(patchedFetch).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    const opts = request.mock.calls[0][0];
    expect(opts.url).toBe(`${BASE}/services`);
    expect(opts.method).toBe('GET');
    expect(opts.headers['if-none-match']).toBe(ETAG);
    expect(opts.headers['x-auth-token']).toBe('tok');
    expect(r.status).toBe(304);
    expect(r.body).toBeNull();
    expect(r.headers.get('ETag')).toBe(ETAG);
  });

  it('turns a 200 answer to a conditional GET into a normal JSON response', async () => {
    nativeInstall();
    request.mockResolvedValue({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: '"new"' },
      data: { nodes: { a: 1 } },
    });
    const r = await window.fetch(`${BASE}/services`, { headers: { 'If-None-Match': ETAG } });
    expect(r.status).toBe(200);
    expect(r.ok).toBe(true);
    expect(r.headers.get('etag')).toBe('"new"');
    expect(await r.json()).toEqual({ nodes: { a: 1 } });
  });

  it('keeps a JSON string body valid JSON', async () => {
    nativeInstall();
    request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: 'hello',
    });
    const r = await window.fetch(`${BASE}/x`, { headers: { 'If-None-Match': ETAG } });
    expect(await r.json()).toBe('hello');
  });

  it('passes a non-JSON body through as text', async () => {
    nativeInstall();
    request.mockResolvedValue({
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
      data: 'plain',
    });
    const r = await window.fetch(`${BASE}/x`, { headers: { 'If-None-Match': ETAG } });
    expect(await r.text()).toBe('plain');
  });

  it('keeps the status of an error answer (a 401 still reaches the auth-expired hook)', async () => {
    nativeInstall();
    request.mockResolvedValue({
      status: 401,
      headers: { 'Content-Type': 'application/json' },
      data: { error: 'no' },
    });
    const r = await window.fetch(`${BASE}/services`, { headers: { 'If-None-Match': ETAG } });
    expect(r.status).toBe(401);
    expect(r.ok).toBe(false);
  });

  it('rejects when the native request fails', async () => {
    nativeInstall();
    request.mockRejectedValue(new Error('Unable to resolve host'));
    await expect(
      window.fetch(`${BASE}/services`, { headers: { 'If-None-Match': ETAG } })
    ).rejects.toThrow('Unable to resolve host');
  });

  it('honours an already-aborted signal without calling native', async () => {
    nativeInstall();
    const ac = new AbortController();
    ac.abort(new Error('gone'));
    await expect(
      window.fetch(`${BASE}/services`, { headers: { 'If-None-Match': ETAG }, signal: ac.signal })
    ).rejects.toThrow('gone');
    expect(request).not.toHaveBeenCalled();
  });

  it('settles with the abort reason when the signal fires mid-request (the caller timeout)', async () => {
    nativeInstall();
    request.mockReturnValue(new Promise(() => {})); // native never answers
    const ac = new AbortController();
    const p = window.fetch(`${BASE}/services`, {
      headers: { 'If-None-Match': ETAG },
      signal: ac.signal,
    });
    ac.abort(new Error('timed out'));
    await expect(p).rejects.toThrow('timed out');
  });

  it('leaves an unconditional GET on the normal path', async () => {
    nativeInstall();
    const opts = { headers: { 'x-auth-token': 'tok' }, cache: 'reload' };
    await window.fetch(`${BASE}/services`, opts);
    expect(request).not.toHaveBeenCalled();
    expect(patchedFetch).toHaveBeenCalledWith(`${BASE}/services`, opts);
  });

  it('leaves a non-GET on the normal path even with If-None-Match', async () => {
    nativeInstall();
    await window.fetch(`${BASE}/todos`, { method: 'POST', headers: { 'If-None-Match': ETAG } });
    expect(request).not.toHaveBeenCalled();
    expect(patchedFetch).toHaveBeenCalledTimes(1);
  });

  it("leaves a request to the app's own origin on the normal path", async () => {
    nativeInstall();
    await window.fetch('/assets/x.json', { headers: { 'If-None-Match': ETAG } });
    expect(request).not.toHaveBeenCalled();
    expect(patchedFetch).toHaveBeenCalledTimes(1);
  });
});

describe('conditional polling end to end (shared useData.js over this transport)', () => {
  it('a 304 poll hands back the SAME body reference as the load', async () => {
    nativeInstall();
    const base = `${BASE}/e2e-304`;
    setApiBase(base);
    const body = { nodes: { 'vm-101': { display_name: 'VM 101' } } };
    patchedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: ETAG },
      })
    );
    request.mockResolvedValue({ status: 304, headers: { ETag: ETAG }, data: '' });

    const first = await getServices(true); // load: full fetch, WebView path
    expect(patchedFetch).toHaveBeenCalledTimes(1);
    expect(patchedFetch.mock.calls[0][1].cache).toBe('reload');

    const second = await getServices(false); // poll: conditional, native path
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].headers['if-none-match']).toBe(ETAG);
    expect(second).toBe(first);
  });

  it('cron/status has no ETag, so its polls stay plain GETs on the normal path', async () => {
    nativeInstall();
    const base = `${BASE}/e2e-cron`;
    setApiBase(base);
    patchedFetch.mockImplementation(
      async () =>
        new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' },
        })
    );
    await getCronStatus(true);
    await getCronStatus(false);
    expect(request).not.toHaveBeenCalled();
    expect(patchedFetch).toHaveBeenCalledTimes(2);
    expect(patchedFetch.mock.calls[0][1].cache).toBe('reload');
    expect(patchedFetch.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
  });
});
