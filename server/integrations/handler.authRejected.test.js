/**
 * #239: fetchIntegration says when an upstream rejected the integration's
 * credentials (`authRejected: true`), so the refresh loop can stop sending them
 * until the config changes. A rejection is a 401 or 403 answer to a session
 * login, or to a data request that carried the integration's own credentials
 * (basic, bearer, header or query auth). Any other failure is not one: it is
 * retried with backoff.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { initRegistry } = await import('./registry.js');
const { fetchIntegration } = await import('./handler.js');
const { __test: sessionTest } = await import('./lib/session.js');

await initRegistry();
for (const v of ['NPM_URL', 'NPM_USER', 'NPM_PASS']) delete process.env[v];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  sessionTest.sessionTokenCache.clear();
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

let n = 0;
const custom = (extra) => ({
  url: `http://svc${++n}.example.test`,
  endpoint: '/status',
  fields: [{ key: 'up', label: 'Up', path: 'up' }],
  _storageKey: `custom_${n}`,
  ...extra,
});

const credentialed = [
  ['basic', { auth: 'basic', username: 'u', password: 'p' }],
  ['bearer', { auth: 'bearer', token: 't' }],
  ['header', { auth: 'header', token: 't' }],
  ['query', { auth: 'query', token: 't' }],
];

for (const [name, auth] of credentialed) {
  for (const status of [401, 403]) {
    test(`${name} auth: a ${status} is a rejected login`, async () => {
      const r = await withFetch(
        async () => json({}, status),
        () => fetchIntegration('custom', custom(auth))
      );
      assert.match(r.error, new RegExp(`HTTP ${status}`));
      assert.equal(r.authRejected, true);
      assert.deepEqual(r.fields, {});
    });
  }
}

test('a 401 to a request that carried no credentials is not a rejected login', async () => {
  for (const auth of [{ auth: 'none' }, { auth: 'basic' }, { auth: 'bearer' }]) {
    const r = await withFetch(
      async () => json({}, 401),
      () => fetchIntegration('custom', custom(auth))
    );
    assert.match(r.error, /HTTP 401/);
    assert.equal(r.authRejected, undefined, JSON.stringify(auth));
  }
});

test('other failures are not rejected logins, and a success has no authRejected', async () => {
  const cfg = custom({ auth: 'basic', username: 'u', password: 'p' });
  const r500 = await withFetch(
    async () => json({}, 500),
    () => fetchIntegration('custom', cfg)
  );
  assert.match(r500.error, /HTTP 500/);
  assert.equal(r500.authRejected, undefined);
  const down = await withFetch(
    async () => {
      throw new Error('connect ECONNREFUSED');
    },
    () => fetchIntegration('custom', cfg)
  );
  assert.equal(down.authRejected, undefined);
  const ok = await withFetch(
    async () => json({ up: 'yes' }),
    () => fetchIntegration('custom', cfg)
  );
  assert.deepEqual(ok, { fields: { Up: 'yes' }, error: null });
});

// Nginx Proxy Manager logs in with POST /api/tokens, then reads /api/nginx/proxy-hosts.
const npmCfg = () => ({
  url: `http://npm${++n}.example.test`,
  username: 'u',
  password: 'p',
  _storageKey: `npm_${n}`,
});
const npmFetch =
  (loginStatus, dataStatus = 200) =>
  async (url, init = {}) => {
    if (init.method === 'POST')
      return loginStatus === 'throw'
        ? Promise.reject(new Error('socket hang up'))
        : json({ token: 'tok' }, loginStatus);
    return json([], dataStatus);
  };

for (const status of [401, 403]) {
  test(`session auth: a login answered ${status} is a rejected login`, async () => {
    const r = await withFetch(npmFetch(status), () => fetchIntegration('npm', npmCfg()));
    assert.match(r.error, /session auth/i);
    assert.equal(r.authRejected, true);
  });
}

test('session auth: a login that fails another way, or a data read after a good login, is not', async () => {
  for (const [login, data] of [
    [500, 200],
    ['throw', 200],
    [200, 401],
    [200, 403],
  ]) {
    const r = await withFetch(npmFetch(login, data), () => fetchIntegration('npm', npmCfg()));
    assert.ok(r.error, `login ${login}, data ${data}: expected an error`);
    assert.equal(r.authRejected, undefined, `login ${login}, data ${data}`);
  }
  const ok = await withFetch(npmFetch(200), () => fetchIntegration('npm', npmCfg()));
  assert.equal(ok.error, null);
  assert.equal(ok.authRejected, undefined);
});

test('session auth with a fallback: rejected only when every login was', async () => {
  const session = (path) => ({
    loginEndpoint: path,
    loginBody: { u: '{username}', p: '{password}' },
    tokenPath: 'token',
    tokenHeader: 'X-Token',
  });
  const cfg = () =>
    custom({
      auth: 'session',
      username: 'u',
      password: 'p',
      session: session('/login'),
      authFallback: 'alt',
      alt: session('/alt-login'),
    });
  const answer =
    (primary, alt) =>
    async (url, init = {}) => {
      if (init.method === 'POST')
        return json({ token: 'tok' }, String(url).endsWith('/alt-login') ? alt : primary);
      return json({ up: 'yes' });
    };
  const both = await withFetch(answer(401, 403), () => fetchIntegration('custom', cfg()));
  assert.equal(both.authRejected, true);
  const one = await withFetch(answer(401, 500), () => fetchIntegration('custom', cfg()));
  assert.ok(one.error);
  assert.equal(one.authRejected, undefined);
  const fellBack = await withFetch(answer(401, 200), () => fetchIntegration('custom', cfg()));
  assert.equal(fellBack.error, null);
});
