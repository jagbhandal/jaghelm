import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from './App.jsx';
import { setAuthToken, SIGN_OUT_TIMEOUT_MS } from './api/client.js';
import { HEALTHY } from './testing/statusFixtures.js';

// Signing out of the web app (#507). The Log out button asks the server to
// revoke the session (POST /api/auth/logout), then clears it in the tab
// whatever the server did: an error, a 5xx or no answer within 5 s never keeps
// anyone signed in. A 401 (the session already dead, #492) clears it without
// asking. The stub is a server with auth on: a request whose x-auth-token is a
// live session gets data, any other gets 401; sign-out deletes the session and
// answers 204, unless `signOutAnswer` says otherwise.

const TICK_MS = 30_000;

let requests; // { path, method, token, status } per request
let sessions; // the live session tokens
let signOutAnswer; // 'ok' | 'error' | 'hang' | 500

function answer(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function serve(path, token) {
  const live = sessions.has(token);
  if (path === '/api/auth/check') return [200, { authRequired: true, authenticated: live }];
  if (!live) return [401, { error: 'Unauthorized' }];
  if (path === '/api/status') return [200, HEALTHY];
  if (path === '/api/services') return [200, { nodes: {}, overallHealth: 'up' }];
  if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path)) return [200, []];
  return [200, {}];
}

function stubServer() {
  requests = [];
  sessions = new Set(['old-tok']);
  signOutAnswer = 'ok';
  vi.stubGlobal(
    'fetch',
    vi.fn((url, opts = {}) => {
      const path = String(url).split('?')[0];
      const method = opts.method || 'GET';
      const token = opts.headers?.['x-auth-token'];
      if (path === '/api/auth/logout') {
        requests.push({ path, method, token, status: signOutAnswer });
        if (signOutAnswer === 'error') return Promise.reject(new TypeError('Failed to fetch'));
        if (signOutAnswer === 'hang') return new Promise(() => {});
        if (signOutAnswer === 500) return answer(500, { error: 'boom' });
        sessions.delete(token);
        return answer(204, null);
      }
      const [status, body] = serve(path, token);
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

const take = () => requests.splice(0);
const signOuts = () => requests.filter((r) => r.path === '/api/auth/logout');
const signInButton = () => screen.queryByRole('button', { name: 'Sign In' });

// A tab signed in before: its token is in storage, the session still live.
async function renderSignedIn() {
  localStorage.setItem('jaghelm-token', 'old-tok');
  render(<App />);
  await vi.waitFor(() => expect(requests.map((r) => r.path)).toContain('/api/services'));
  await advance(1000);
  expect(requests.every((r) => r.status === 200)).toBe(true);
  take();
}

async function clickLogOut() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Log out' })[0]);
  await advance(0);
}

// Signed out in this tab: the sign-in screen, no token kept, no more polls.
async function expectSignedOut() {
  expect(signInButton()).toBeInTheDocument();
  expect(screen.queryByRole('banner')).toBeNull();
  expect(localStorage.getItem('jaghelm-token')).toBeNull();
  take();
  await advance(3 * TICK_MS);
  expect(take()).toEqual([]);
}

beforeEach(() => {
  localStorage.clear();
  setAuthToken('');
  vi.useFakeTimers();
  stubServer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAuthToken('');
});

describe('signing out of the web app (#507)', () => {
  it('Log out revokes the session on the server, then shows the sign-in screen', async () => {
    await renderSignedIn();
    await clickLogOut();
    expect(signOuts()).toEqual([
      { path: '/api/auth/logout', method: 'POST', token: 'old-tok', status: 'ok' },
    ]);
    expect(sessions.has('old-tok')).toBe(false);
    await expectSignedOut();
  });

  it.each([
    ['a network error', 'error'],
    ['a 500', 500],
  ])('a sign-out that meets %s still signs out', async (_what, how) => {
    await renderSignedIn();
    signOutAnswer = how;
    await clickLogOut();
    expect(signOuts()).toHaveLength(1);
    await expectSignedOut();
  });

  it('a sign-out the server never answers signs out after 5 s', async () => {
    await renderSignedIn();
    signOutAnswer = 'hang';
    await clickLogOut();
    expect(signOuts()).toHaveLength(1);
    await advance(SIGN_OUT_TIMEOUT_MS - 1);
    expect(signInButton()).toBeNull();
    await advance(1);
    await expectSignedOut();
  });

  it('an expired session (a 401) signs out without asking the server to revoke it', async () => {
    await renderSignedIn();
    sessions.delete('old-tok'); // 24 h are up, or the server restarted
    await advance(TICK_MS);
    expect(signInButton()).toBeInTheDocument();
    expect(signOuts()).toEqual([]);
  });

  it("a tab that follows another tab's sign-out doesn't send it again", async () => {
    await renderSignedIn();
    // Another tab of this browser signed out: the session is revoked and the
    // storage both tabs share is empty. This tab learns it from its next 401.
    sessions.delete('old-tok');
    localStorage.removeItem('jaghelm-token');
    await advance(TICK_MS);
    expect(signInButton()).toBeInTheDocument();
    expect(signOuts()).toEqual([]);
    await advance(3 * TICK_MS);
    expect(signOuts()).toEqual([]);
  });
});
