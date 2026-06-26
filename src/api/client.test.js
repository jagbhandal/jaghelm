import test from 'node:test';
import assert from 'node:assert/strict';

import { apiFetch, setAuthToken, setAuthExpiredHandler } from './client.js';
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
