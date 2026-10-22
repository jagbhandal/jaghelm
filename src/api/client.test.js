import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apiFetch,
  setAuthToken,
  setAuthExpiredHandler,
  revokeSession,
  SIGN_OUT_TIMEOUT_MS,
} from './client.js';
import { setApiBase } from './baseUrl.js';

// client.js calls window.fetch; stub it per test. Returns the recorded calls.
function stubFetch(makeRes) {
  const calls = [];
  global.window = {
    fetch: async (url, opts) => {
      calls.push([url, opts]);
      return makeRes(url, opts);
    },
  };
  return calls;
}
const res = (status) => ({ status, ok: status >= 200 && status < 300 });

test('a protected 401 invokes the auth-expired handler once and still returns the response', async () => {
  setApiBase('http://vm-101:3099/api');
  setAuthToken('tok');
  stubFetch(() => res(401));
  let count = 0;
  setAuthExpiredHandler(() => { count += 1; });
  const r = await apiFetch('http://vm-101:3099/api/dashboard');
  assert.equal(r.status, 401);
  assert.equal(count, 1);
  setAuthExpiredHandler(null);
});

test('a 200 on a protected route does not invoke the handler', async () => {
  setApiBase('http://vm-101:3099/api');
  setAuthToken('tok');
  stubFetch(() => res(200));
  let count = 0;
  setAuthExpiredHandler(() => { count += 1; });
  await apiFetch('http://vm-101:3099/api/dashboard');
  assert.equal(count, 0);
  setAuthExpiredHandler(null);
});

test('a 401 on the login route does not invoke the handler', async () => {
  setApiBase('http://vm-101:3099/api');
  setAuthToken('tok');
  stubFetch(() => res(401));
  let count = 0;
  setAuthExpiredHandler(() => { count += 1; });
  await apiFetch('http://vm-101:3099/api/auth/login', { method: 'POST' });
  assert.equal(count, 0);
  setAuthExpiredHandler(null);
});

test('a protected 401 with no handler registered does not throw (web path unchanged)', async () => {
  setApiBase('http://vm-101:3099/api');
  setAuthToken('tok');
  stubFetch(() => res(401));
  setAuthExpiredHandler(null);
  const r = await apiFetch('http://vm-101:3099/api/dashboard');
  assert.equal(r.status, 401);
});

// ── revokeSession (#507) ─────────────────────────────────────────────────
// The sign-out request both apps send before clearing the session locally. It
// must never stand between the user and a signed-out app: it never rejects and
// gives up after SIGN_OUT_TIMEOUT_MS.

const answer = (status) => Promise.resolve(res(status));

test('posts the token to /auth/logout under the API base (web and Android)', async () => {
  for (const [base, url] of [
    ['/api', '/api/auth/logout'],
    ['http://vm-101:3099/api', 'http://vm-101:3099/api/auth/logout'],
  ]) {
    setApiBase(base);
    const calls = stubFetch(() => answer(204));
    await revokeSession('tok-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], url);
    assert.equal(calls[0][1].method, 'POST');
    assert.deepEqual(calls[0][1].headers, { 'x-auth-token': 'tok-1' });
  }
  setApiBase('/api');
});

test("defaults to the in-memory token, and sends nothing when there isn't one", async () => {
  const calls = stubFetch(() => answer(204));
  setAuthToken('mem-tok');
  await revokeSession();
  assert.equal(calls[0][1].headers['x-auth-token'], 'mem-tok');
  setAuthToken('');
  await revokeSession();
  assert.equal(calls.length, 1);
});

test('resolves on a network error, a throw, a 5xx or a 401, and never reports an expired session', async () => {
  let expired = 0;
  setAuthExpiredHandler(() => {
    expired += 1;
  });
  setAuthToken('tok');
  for (const reply of [
    () => Promise.reject(new TypeError('Failed to fetch')),
    () => {
      throw new Error('fetch threw');
    },
    () => answer(500),
    () => answer(401), // a server older than the route, with a dead token
  ]) {
    const calls = stubFetch(reply);
    await assert.doesNotReject(revokeSession('tok'));
    assert.equal(calls.length, 1);
  }
  assert.equal(expired, 0);
  setAuthExpiredHandler(null);
  setAuthToken('');
});

test('a request that hangs is aborted and given up on after SIGN_OUT_TIMEOUT_MS', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(SIGN_OUT_TIMEOUT_MS, 5000);
  let signal;
  stubFetch((_url, opts) => {
    signal = opts.signal;
    return new Promise(() => {}); // never answers, ignores the abort
  });
  let settled = false;
  const done = revokeSession('tok').then(() => {
    settled = true;
  });
  await Promise.resolve();
  t.mock.timers.tick(SIGN_OUT_TIMEOUT_MS - 1);
  await Promise.resolve();
  assert.equal(settled, false, 'still waiting just before the deadline');
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await done;
  assert.equal(settled, true);
  assert.equal(signal.aborted, true, 'the request is aborted at the deadline');
});

// An Android sign-out keeps what it couldn't finish and retries it later
// (#539), so the revoke says whether it reached the server, and the retry sends
// it to the server that session belongs to.
test('answers true once the server answered below 500, false otherwise', async () => {
  for (const [reply, reached] of [
    [() => answer(204), true],
    [() => answer(401), true], // a dead token: nothing left to revoke
    [() => answer(404), true], // a server older than the route: it never will
    [() => answer(500), false],
    [() => answer(502), false],
    [() => Promise.reject(new TypeError('Failed to fetch')), false],
  ]) {
    stubFetch(reply);
    assert.equal(await revokeSession('tok'), reached);
  }
  assert.equal(await revokeSession(''), true, 'no token: nothing to revoke');
});

test('a request that hangs past the deadline answers false', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  stubFetch(() => new Promise(() => {}));
  const done = revokeSession('tok');
  await Promise.resolve();
  t.mock.timers.tick(SIGN_OUT_TIMEOUT_MS);
  assert.equal(await done, false);
});

test('base sends it to that server, not the current API base', async () => {
  setApiBase('http://vm-101:3099/api');
  const calls = stubFetch(() => answer(204));
  await revokeSession('old-tok', { base: 'http://old-host:3099/api' });
  assert.equal(calls[0][0], 'http://old-host:3099/api/auth/logout');
  assert.deepEqual(calls[0][1].headers, { 'x-auth-token': 'old-tok' });
  setApiBase('/api');
});
