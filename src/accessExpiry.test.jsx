import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from './App.jsx';
import AccessExpired from './ui/access-expired.jsx';
import {
  BOOT_CHECK_TIMEOUT_MS,
  isAccessRedirect,
  probeAccess,
  setAccessExpiredHandler,
  setAuthToken,
} from './api/client.js';
import { HEALTHY } from './testing/statusFixtures.js';

// Cloudflare Access (#653). When its session ends, every fetch from the page
// meets a cross-origin 302 it cannot follow. Asked not to follow, fetch answers
// an opaque redirect: that is "sign in again", never a blank page, and never a
// login form for a JagHelm password that was not the problem. The boot check
// also stops waiting after BOOT_CHECK_TIMEOUT_MS.

const opaque = () => ({ ok: false, status: 0, type: 'opaqueredirect', headers: { get: () => null } });
const json = (body, status = 200) => ({
  ok: status < 300,
  status,
  type: 'basic',
  headers: { get: () => null },
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setAccessExpiredHandler(null);
});

describe('client helpers', () => {
  it('isAccessRedirect is true only for an opaque redirect', () => {
    expect(isAccessRedirect(opaque())).toBe(true);
    expect(isAccessRedirect(json({}))).toBe(false);
    expect(isAccessRedirect(null)).toBe(false);
    expect(isAccessRedirect({ type: 'cors' })).toBe(false);
  });

  it('probeAccess asks /auth/check without following redirects and tells the handler on a redirect', async () => {
    const handler = vi.fn();
    setAccessExpiredHandler(handler);
    const fetchMock = vi.fn(async () => opaque());
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeAccess()).resolves.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/check');
    expect(opts.redirect).toBe('manual');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('probeAccess stays quiet when the server answers, is down, or no handler is set', async () => {
    const handler = vi.fn();
    setAccessExpiredHandler(handler);
    vi.stubGlobal('fetch', vi.fn(async () => json({ authRequired: true })));
    await expect(probeAccess()).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(probeAccess()).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
    setAccessExpiredHandler(null);
    const fetchMock = vi.fn(async () => opaque());
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeAccess()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probeAccess runs one probe at a time', async () => {
    setAccessExpiredHandler(vi.fn());
    let release;
    const fetchMock = vi.fn(() => new Promise((resolve) => { release = () => resolve(opaque()); }));
    vi.stubGlobal('fetch', fetchMock);
    const first = probeAccess();
    await expect(probeAccess()).resolves.toBe(false);
    release();
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the sign-in notice', () => {
  it('says what happened, as one alert, and Reload reloads', () => {
    const onReload = vi.fn();
    render(<AccessExpired onReload={onReload} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Sign in again');
    expect(alert).toHaveTextContent(/Cloudflare Access session has ended/);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

// Step fake time, flushing the fetch promises that resolve along the way.
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('the app at boot', () => {
  beforeEach(() => {
    localStorage.clear();
    setAuthToken('');
    vi.useFakeTimers();
  });

  it('an Access redirect on the first check shows the notice, not a blank page and not the login form', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url) === '/api/auth/check' ? opaque() : json({}))));
    render(<App />);
    await advance(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in again');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('the first check is sent without following redirects and with a timeout', async () => {
    const fetchMock = vi.fn(async (url) =>
      String(url) === '/api/auth/check' ? json({ authRequired: false, authenticated: true }) : json({})
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await advance(0);
    const check = fetchMock.mock.calls.find(([url]) => String(url) === '/api/auth/check');
    expect(check[1].redirect).toBe('manual');
    expect(check[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('a check that never answers is given up after the timeout: the login gate, not a blank page', async () => {
    // AbortSignal.timeout runs on the platform's own clock, not the fake one: take its signal.
    const timeouts = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      timeouts.push({ ms, abort: () => controller.abort(new DOMException('timed out', 'TimeoutError')) });
      return controller.signal;
    });
    vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
      if (String(url) !== '/api/auth/check') return Promise.resolve(json({}));
      return new Promise((_, reject) => {
        opts.signal?.addEventListener('abort', () => reject(opts.signal.reason));
      });
    }));
    const { container } = render(<App />);
    await advance(0);
    expect(container).toBeEmptyDOMElement(); // still waiting
    const boot = timeouts.find((t) => t.ms === BOOT_CHECK_TIMEOUT_MS);
    expect(boot).toBeTruthy();
    boot.abort();
    await advance(0);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('a status poll that fails because Access redirects raises the notice over the page', async () => {
    let expired = false;
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const path = String(url).split('?')[0];
      if (path === '/api/auth/check') {
        if (expired && opts.redirect === 'manual') return opaque();
        return json({ authRequired: false, authenticated: true });
      }
      if (expired) throw new TypeError('Failed to fetch'); // the followed 302, blocked
      if (path === '/api/status') return json(HEALTHY);
      return json(path === '/api/services' ? { nodes: {}, overallHealth: 'up' } : {});
    }));
    render(<App />);
    await advance(1000);
    expect(screen.queryByText('Sign in again')).not.toBeInTheDocument();
    expired = true;
    await advance(35_000);
    expect(screen.getByText('Sign in again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('no notice while the server is merely down', async () => {
    let down = false;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = String(url).split('?')[0];
      if (down) throw new TypeError('Failed to fetch');
      if (path === '/api/auth/check') return json({ authRequired: false, authenticated: true });
      if (path === '/api/status') return json(HEALTHY);
      return json({});
    }));
    render(<App />);
    await advance(1000);
    down = true;
    await advance(35_000);
    expect(screen.queryByText('Sign in again')).not.toBeInTheDocument();
  });
});
