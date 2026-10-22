import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from './App.jsx';
import { apiFetch, setAuthToken, setAuthExpiredHandler } from './api/client.js';
import { secureStore } from './storage/index.js';
import { HEALTHY } from './testing/statusFixtures.js';

// An expired session (#492). Sessions last 24 h and die on a server restart;
// a tab left open used to poll every source with the dead token for as long as
// it stayed open, a 401 each time. The stub is a server with auth on: a
// request whose x-auth-token is a live session gets data, any other gets 401.
// Fake timers step the 30 s refresh tick, so each test counts the requests a
// stretch of time costs.

const TICK_MS = 30_000;

let requests; // { path, method, token, status } per request
let sessions; // the live session tokens
let authOn; // false: the server has no password, so every request is served

function answer(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function serve(path, method, token, body) {
  if (!authOn) {
    if (path === '/api/auth/check') return [200, { authRequired: false, authenticated: true }];
    if (path === '/api/status') return [200, HEALTHY];
    return [200, path === '/api/services' ? { nodes: {}, overallHealth: 'up' } : {}];
  }
  const live = sessions.has(token);
  if (path === '/api/auth/check') return [200, { authRequired: true, authenticated: live }];
  if (path === '/api/auth/login') {
    const { password } = JSON.parse(body || '{}');
    if (password !== 'right') return [401, { error: 'Invalid credentials' }];
    sessions.add('new-tok');
    return [200, { token: 'new-tok', user: 'admin' }];
  }
  if (!live) return [401, { error: 'Unauthorized' }];
  if (path === '/api/status') return [200, HEALTHY];
  if (path === '/api/services') return [200, { nodes: {}, overallHealth: 'up' }];
  if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path)) return [200, []];
  return [200, {}];
}

function stubServer() {
  requests = [];
  sessions = new Set(['old-tok']);
  authOn = true;
  vi.stubGlobal(
    'fetch',
    vi.fn((url, opts = {}) => {
      const path = String(url).split('?')[0];
      const method = opts.method || 'GET';
      const token = opts.headers?.['x-auth-token'];
      const [status, body] = serve(path, method, token, opts.body);
      requests.push({ path, method, token, status });
      return answer(status, body);
    })
  );
}

// Step fake time, flushing the fetch promises that resolve along the way.
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Requests made since the last call, emptying the log.
const take = () => requests.splice(0);
const signInButton = () => screen.queryByRole('button', { name: 'Sign In' });

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

// A tab signed in before: its token is in storage, the session still live.
async function renderSignedIn() {
  localStorage.setItem('jaghelm-token', 'old-tok');
  render(<App />);
  await vi.waitFor(() => expect(requests.map((r) => r.path)).toContain('/api/services'));
  await advance(1000);
  expect(requests.every((r) => r.status === 200)).toBe(true);
}

async function signIn(password) {
  fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: password } });
  fireEvent.click(signInButton());
  await advance(0);
}

beforeEach(() => {
  localStorage.clear();
  setAuthToken('');
  vi.useFakeTimers();
  stubServer();
});

afterEach(() => {
  vi.useRealTimers();
  setAuthToken('');
  delete document.hidden;
  delete document.visibilityState;
});

describe('an expired session in the web app (#492)', () => {
  it('gives one round of 401s, shows the sign-in screen, then asks nothing at all', async () => {
    await renderSignedIn();
    take();
    sessions.delete('old-tok'); // 24 h are up, or the server restarted

    await advance(TICK_MS);
    const round = take();
    expect(round.length).toBeGreaterThan(0);
    expect(round.every((r) => r.status === 401 && r.token === 'old-tok')).toBe(true);
    expect(signInButton()).toBeInTheDocument();
    // No header keeps the last status's colours: the shell is gone with its polls.
    expect(screen.queryByRole('banner')).toBeNull();
    expect(localStorage.getItem('jaghelm-token')).toBeNull();

    await advance(10 * TICK_MS);
    expect(take()).toEqual([]);
    expect(signInButton()).toBeInTheDocument();
  });

  it('several 401s landing at once sign out once', async () => {
    await renderSignedIn();
    const removeItem = vi.spyOn(secureStore, 'removeItem');
    setHidden(true);
    sessions.delete('old-tok');
    take();
    // Back on the tab, every source and the status are asked at once.
    setHidden(false);
    await advance(0);
    const round = take();
    expect(round.length).toBeGreaterThan(2);
    expect(round.every((r) => r.status === 401)).toBe(true);
    expect(removeItem.mock.calls.filter(([k]) => k === 'jaghelm-token')).toHaveLength(1);
    expect(signInButton()).toBeInTheDocument();

    await advance(5 * TICK_MS);
    expect(take()).toEqual([]);
  });

  it('a wrong password keeps the sign-in screen; signing in starts the polls again', async () => {
    await renderSignedIn();
    sessions.delete('old-tok');
    await advance(TICK_MS);
    take();

    await signIn('wrong');
    expect(take()).toEqual([
      { path: '/api/auth/login', method: 'POST', token: undefined, status: 401 },
    ]);
    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    await advance(3 * TICK_MS);
    expect(take()).toEqual([]);

    await signIn('right');
    await vi.waitFor(() => expect(requests.map((r) => r.path)).toContain('/api/services'));
    expect(signInButton()).toBeNull();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    await advance(1000);
    take();

    await advance(2 * TICK_MS);
    const polls = take();
    expect(polls.filter((r) => r.path === '/api/services')).toHaveLength(2);
    expect(polls.filter((r) => r.path === '/api/status')).toHaveLength(2);
    expect(polls.every((r) => r.status === 200 && r.token === 'new-tok')).toBe(true);
  });
});

describe('an expired session, the review cases (#492)', () => {
  it('another tab signed in meanwhile: this tab takes its session from storage and keeps polling', async () => {
    await renderSignedIn(); // tab A
    // The server restarts; tab B signs in, which writes the storage both tabs share.
    sessions.delete('old-tok');
    sessions.add('b-tok');
    localStorage.setItem('jaghelm-token', 'b-tok');
    take();

    await advance(TICK_MS);
    expect(take().some((r) => r.status === 401 && r.token === 'old-tok')).toBe(true);
    expect(localStorage.getItem('jaghelm-token')).toBe('b-tok');
    expect(signInButton()).toBeNull();

    await advance(TICK_MS);
    const next = take();
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((r) => r.status === 200 && r.token === 'b-tok')).toBe(true);
  });

  it('a tab loaded with auth off asks to sign in once a password is set and the server restarts', async () => {
    authOn = false;
    render(<App />);
    await vi.waitFor(() => expect(requests.map((r) => r.path)).toContain('/api/services'));
    await advance(1000);
    expect(take().every((r) => r.status === 200 && r.token === undefined)).toBe(true);

    authOn = true;
    await advance(TICK_MS);
    const round = take();
    expect(round.length).toBeGreaterThan(0);
    expect(round.every((r) => r.status === 401 && r.token === undefined)).toBe(true);
    expect(signInButton()).toBeInTheDocument();
    await advance(5 * TICK_MS);
    expect(take()).toEqual([]);

    await signIn('right');
    await vi.waitFor(() => expect(requests.map((r) => r.path)).toContain('/api/services'));
    await advance(1000);
    take();
    await advance(TICK_MS);
    expect(take().every((r) => r.status === 200 && r.token === 'new-tok')).toBe(true);
  });
});

describe('apiFetch reports an expired session once per token (#492)', () => {
  let calls;
  beforeEach(() => {
    calls = 0;
    setAuthExpiredHandler(() => {
      calls += 1;
    });
  });
  afterEach(() => setAuthExpiredHandler(null));

  it('a 401 on the sign-in request or a password change is about the password, not the session', async () => {
    sessions.clear();
    setAuthToken('tok');
    await apiFetch('/api/auth/login', { method: 'POST', body: '{"password":"wrong"}' });
    await apiFetch('/api/auth/change-password', { method: 'POST', body: '{}' });
    expect(calls).toBe(0);
    await apiFetch('/api/services');
    expect(calls).toBe(1);
  });

  it('two 401s at once call the handler once, even when it leaves the token set', async () => {
    sessions.clear();
    setAuthToken('tok');
    const [a, b] = await Promise.all([apiFetch('/api/services'), apiFetch('/api/status')]);
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(calls).toBe(1);
    await apiFetch('/api/ups');
    expect(calls).toBe(1);
    // A new token is a new session: its own expiry is reported again.
    setAuthToken('tok-2');
    await apiFetch('/api/ups');
    expect(calls).toBe(2);
  });

  it('a handler that rejects is logged, not left unhandled, and retried once on the next 401', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    let attempts = 0;
    setAuthExpiredHandler(async () => {
      attempts += 1;
      throw new Error('keystore busy');
    });
    sessions.clear();
    setAuthToken('tok');
    // Two 401s while the first report is still running: one call.
    await Promise.all([apiFetch('/api/services'), apiFetch('/api/status')]);
    await flush();
    expect(attempts).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    await apiFetch('/api/services');
    await flush();
    expect(attempts).toBe(2);
    await apiFetch('/api/services');
    await flush();
    expect(attempts).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('the handler gets the token the request was sent with, and a tokenless 401 counts', async () => {
    const seen = [];
    setAuthExpiredHandler((sent) => seen.push(sent));
    sessions.clear();
    setAuthToken('tok');
    await apiFetch('/api/services');
    setAuthToken('');
    await apiFetch('/api/services');
    await apiFetch('/api/auth/check');
    expect(seen).toEqual(['tok', '']);
  });

  it('a late 401 for a token since replaced (a new sign-in) is ignored', async () => {
    sessions.clear();
    setAuthToken('tok');
    let release;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => (release = () => resolve(answer(401, {})))))
    );
    const pending = apiFetch('/api/services');
    setAuthToken('fresh-tok');
    release();
    expect((await pending).status).toBe(401);
    expect(calls).toBe(0);
  });
});
