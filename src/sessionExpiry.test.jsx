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
